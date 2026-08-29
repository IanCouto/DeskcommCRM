import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guardas da migração para o Tailwind 4 (config em CSS).
 *
 * O `tailwind.config.ts` deixou de existir: o que era `theme.extend` virou um
 * bloco `@theme inline` dentro de `app/globals.css`. Isso troca um arquivo que
 * o TypeScript conferia por um arquivo que ninguém confere — e três coisas
 * passam a poder quebrar em silêncio, com build verde e tela errada. Cada uma
 * tem um teste aqui.
 */

const RAIZ = process.cwd();
const CSS = fs.readFileSync(path.join(RAIZ, "app/globals.css"), "utf8");

/** Recorta `<seletor> { … }` por casamento de chave, ancorado em início de linha. */
function bloco(seletor: string): string {
  const rx = new RegExp(`^${seletor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m");
  const i = CSS.search(rx);
  if (i < 0) throw new Error(`não achei o bloco \`${seletor}\` em globals.css`);
  const fim = CSS.indexOf("\n}", i);
  if (fim < 0) throw new Error(`bloco \`${seletor}\` sem fechamento em globals.css`);
  return CSS.slice(i, fim);
}

/** Nomes de custom property declarados dentro de um bloco. */
function propsDe(texto: string): string[] {
  return [...texto.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].flatMap((m) => (m[1] ? [m[1]] : []));
}

describe("Tailwind 4 — a ponte token → utilitário", () => {
  it("não voltou a existir config em JS nem diretiva `@tailwind`", () => {
    // Os dois convivem tecnicamente (`@config` existe no v4), mas conviver é o
    // problema: com um `tailwind.config.ts` de volta, metade dos tokens passa a
    // vir de um arquivo e metade do outro, e a divergência só aparece na tela.
    expect(fs.existsSync(path.join(RAIZ, "tailwind.config.ts"))).toBe(false);
    expect(fs.existsSync(path.join(RAIZ, "tailwind.config.js"))).toBe(false);
    expect(CSS).not.toMatch(/^@tailwind\s/m);
    expect(CSS).toMatch(/^@import "tailwindcss"/m);
  });

  it("mantém os blocos de token FORA de `@layer` — é o que neutraliza a auto-referência", () => {
    // `@theme inline` emite, dentro de `@layer theme`, linhas do tipo
    // `--color-bg: var(--color-bg)`, porque os nomes de token do produto já
    // ocupam o namespace `--color-*` do Tailwind. Elas são inofensivas por UM
    // motivo só: declaração sem layer vence declaração em layer, e o `:root`
    // autoral está sem layer. Embrulhar `:root` num `@layer` inverteria a
    // precedência, a auto-referência passaria a valer, e TODA cor do produto
    // viraria inválida — tela em branco e preto, com build verde.
    // O que se procura é o bloco que DECLARA token. `@layer base` legitimamente
    // tem um `[data-theme="dark"] { color-scheme: dark }` — regra de tema, não
    // definição de token; ela pode morar em layer sem consequência nenhuma.
    for (const l of CSS.matchAll(/^@layer\s+([a-z]+)\s*\{/gim)) {
      const inicio = l.index ?? 0;
      const fim = CSS.indexOf("\n}", inicio);
      const corpo = CSS.slice(inicio, fim < 0 ? CSS.length : fim);
      const regras = corpo.matchAll(/^\s*(:root|\[data-theme="(?:light|dark)"\])\s*\{/gm);
      for (const r of regras) {
        const de = r.index ?? 0;
        const ate = corpo.indexOf("}", de);
        const dentro = corpo.slice(de, ate < 0 ? corpo.length : ate);
        expect(
          /^\s*--[a-z0-9-]+\s*:/im.test(dentro),
          `\`${r[1]}\` declara token dentro de @layer ${l[1]} — isso liga a auto-referência`,
        ).toBe(false);
      }
    }
  });

  it("todo token que o `@theme inline` consome existe no `:root`", () => {
    // Um `var(--color-foo)` no @theme apontando para nada não gera erro: o
    // utilitário nasce, aplica um valor vazio, e o elemento fica sem cor. Este
    // teste é o que transforma o erro de digitação em falha de CI.
    const raiz = new Set(propsDe(bloco(":root")));
    const tema = bloco("@theme inline");
    const consumidos = [...tema.matchAll(/var\((--[a-z0-9-]+)\)/gi)].flatMap((m) =>
      m[1] ? [m[1]] : [],
    );

    expect(consumidos.length).toBeGreaterThan(50);

    // As duas fontes são injetadas pelo `next/font` como custom property no
    // `<html>` (app/layout.tsx), não pelo `:root` do CSS — por isso não caem na
    // regra acima. A isenção não é um buraco: o teste confere logo abaixo que
    // elas continuam sendo declaradas lá.
    const DE_FORA_DO_CSS = ["--font-atkinson", "--font-mono"];
    const layout = fs.readFileSync(path.join(RAIZ, "app/layout.tsx"), "utf8");
    for (const v of DE_FORA_DO_CSS) {
      expect(layout, `${v} deixou de ser declarada pelo next/font`).toContain(`"${v}"`);
    }

    const orfaos = [...new Set(consumidos)].filter(
      (v) => !raiz.has(v) && !DE_FORA_DO_CSS.includes(v),
    );
    expect(orfaos, `tokens referenciados no @theme mas ausentes do :root`).toEqual([]);
  });

  it("o `@source` cobre toda pasta que realmente escreve className", () => {
    // `source(none)` desliga a descoberta automática. O preço é este: pasta de
    // UI nova fora da lista perde TODAS as classes, sem erro de build — a tela
    // simplesmente renderiza sem estilo.
    const declarados = [...CSS.matchAll(/^@source\s+"\.\.\/([a-z-]+)"/gim)].flatMap((m) =>
      m[1] ? [m[1]] : [],
    );
    expect(declarados.length).toBeGreaterThan(0);

    const raizesComClasse = fs
      .readdirSync(RAIZ, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
      .map((d) => d.name)
      .filter((nome) => {
        // Só interessa pasta que entrega UI ao browser. `tests/` e `docs/`
        // escrevem className em fixture e em exemplo, e ficam de fora de
        // propósito — varrê-las publicaria CSS que nenhuma tela usa.
        if (["tests", "docs", "scripts", "supabase", "public", "tasks", "loop"].includes(nome)) {
          return false;
        }
        return temClassName(path.join(RAIZ, nome));
      });

    const faltando = raizesComClasse.filter((n) => !declarados.includes(n));
    expect(faltando, "pasta com className fora do @source de app/globals.css").toEqual([]);
  });
});

describe("Tailwind 4 — utilitários que mudaram de significado", () => {
  const ARQUIVOS = listarFontes(["app", "components", "lib", "hooks"]);

  it("não usa `rounded` puro — no v4 ele é 0.25rem, não o `--radius-md` do produto", () => {
    // No v3 este projeto redefinia o DEFAULT de borderRadius para
    // `var(--radius-md)` (8px). O v4 não tem esse DEFAULT sobrescrevível — nem
    // por `@utility rounded`, que o embutido vence. Deixar `rounded` puro
    // encolhe o raio de 8px para 4px em silêncio.
    //
    // O `:` dentro do lookbehind é CARGA, não enfeite — quem "simplificar"
    // essa classe de caractere reabre um buraco que este PR já pagou uma vez.
    // Sem ele a guarda só enxerga `rounded` precedido de espaço ou aspas, e
    // passa VERDE por `hover:rounded`, `md:rounded` e
    // `data-[state=active]:rounded`, que encolhem o raio exatamente igual — só
    // que sob condição, que é pior, porque nem na tela salta.
    //
    // A história é o argumento, e ela está no `git log` deste arquivo. As
    // guardas de `outline-none` e `flex-*` têm o `:` desde o PRIMEIRO commit
    // da migração (72d2ed4c): quem as escreveu já conhecia a variante. A linha
    // do `rounded` — a troca principal do PR, 60 linhas varridas contra o
    // merge-base 165e8f0f — nasceu sem ele. Depois o
    // `data-[state=active]:shadow` de `components/ui/tabs.tsx` escapou por
    // essa ausência exata e ganhou o commit 966d8f93, cujo assunto diz
    // literalmente "a sombra da aba ativa tinha o mesmo defeito do `rounded`";
    // a guarda nova nasceu COM o `:` e a do `rounded` continuou sem. Ou seja:
    // consertou-se a instância e não a classe, e esta linha era a instância
    // que sobrou. Para reprovar de novo, se alguém duvidar: plante
    // `hover:rounded` num `className` de `components/` e rode este arquivo.
    const culpados = ocorrencias(ARQUIVOS, /(?<=[\s"'`:])rounded(?=[\s"'`])/g);
    expect(culpados, "use `rounded-md` (8px) ou o grau explícito").toEqual([]);
  });

  it("não usa `outline-none` — no v4 esse nome virou `outline-hidden`", () => {
    // O `outline-none` do v4 é outra coisa (`outline-style: none`) e não
    // preserva o contorno transparente que o modo de alto contraste do sistema
    // precisa. Trocar por engano degrada acessibilidade sem quebrar nada.
    const culpados = ocorrencias(ARQUIVOS, /(?<=[\s"'`:])outline-none(?=[\s"'`])/g);
    expect(culpados, "use `outline-hidden`").toEqual([]);
  });

  it("não usa `shadow` puro — o v4 embute um preto fixo, cego ao tema escuro", () => {
    // Irmão exato do caso `rounded` acima, e a razão de ele existir: o v3
    // redefinia DOIS defaults contra token do produto —
    // `borderRadius.DEFAULT: var(--radius-md)` e `boxShadow.DEFAULT:
    // var(--shadow-sm)`. A migração varreu o primeiro e passou reto pelo
    // segundo, porque `shadow` não tem hífen e não casa nenhuma varredura de
    // `shadow-*`.
    //
    // Medido com o `@tailwindcss/cli` 4.3.3 contra este mesmo globals.css:
    //   .shadow    → 0 1px 3px 0 rgb(0 0 0 / 0.1), …   ← literal, FIXO
    //   .shadow-sm → var(--shadow-sm)                  ← o token, que muda no escuro
    // O `--shadow-sm` do produto é rgba(20,18,14,…) no claro e rgba(0,0,0,.40)
    // no escuro. `shadow` puro perde a diferença sem erro nenhum: build verde,
    // aba ativa com sombra errada em 11 telas.
    //
    // Não dá para consertar pelo `@theme`: o `.shadow` do v4 é embutido com
    // valor literal e o embutido vence — igual ao `rounded`.
    const culpados = ocorrencias(ARQUIVOS, /(?<=[\s"'`:])shadow(?=[\s"'`])/g);
    expect(culpados, "use `shadow-sm` (o `--shadow-sm` do produto) ou o grau explícito").toEqual([]);
  });

  it("não usa `flex-shrink-*` / `flex-grow-*` — renomeados para `shrink-*` / `grow-*`", () => {
    const culpados = ocorrencias(ARQUIVOS, /(?<=[\s"'`:])flex-(shrink|grow)(-\d+)?(?=[\s"'`])/g);
    expect(culpados, "use `shrink-*` / `grow-*`").toEqual([]);
  });
});

describe("Tailwind 4 — `space-*` põe a margem no filho ANTERIOR", () => {
  it("o rótulo declara display de bloco — senão a margem do grupo evapora", () => {
    // O v3 gerava `.space-y-N > :not([hidden]) ~ :not([hidden]) { margin-top }`
    // — margem no filho SEGUINTE. O v4 gera
    // `:where(.space-y-N > :not(:last-child)) { margin-block-end }` — margem no
    // filho ANTERIOR. Num grupo `<Label>` + campo, o anterior é o rótulo; e
    // `<label>` nasce `display: inline`, que IGNORA margem vertical.
    //
    // Resultado medido na migração: todo grupo de formulário perdia exatamente
    // um `--space-N`, colando rótulo e campo. Não gera erro, não muda teste, e
    // some no meio de 91 arquivos alterados.
    const fonte = fs.readFileSync(path.join(RAIZ, "components/ui/label.tsx"), "utf8");
    const classes = /cva\(\s*\n?\s*"([^"]+)"/.exec(fonte)?.[1] ?? "";
    expect(classes, "não achei a string de classe do labelVariants").not.toBe("");
    expect(
      /\b(block|inline-block|flex|inline-flex|grid|inline-grid|table)\b/.test(classes),
      `labelVariants voltou a ser inline: "${classes}"`,
    ).toBe(true);
  });

  it("nenhum `<label>` cru dentro de container espaçado fica sem display", () => {
    // A mesma armadilha do `Label`, na forma solta. Um `<label>` escrito à mão
    // como primeiro filho de um `space-y-*` perde o respiro do grupo — e o
    // componente consertado não o alcança. Achados 10 assim na migração
    // (audit, CapturasTab, onboarding/funil).
    //
    // A heurística é a janela de 3 linhas acima: em JSX o container espaçado
    // abre logo antes do rótulo. Ela erra para menos (rótulo longe do
    // container abridor passa), nunca para mais — e o complemento é a sonda
    // `tests/sonda-tailwind-4-antes-depois.ts`, que mede na TELA quem é inline
    // de verdade. Estática acha barato, sonda acha certo.
    const DISPLAY = /\b(block|inline-block|flex|inline-flex|grid|inline-grid|table)\b/;
    const suspeitos: string[] = [];
    for (const f of listarFontes(["app", "components"])) {
      if (!f.endsWith(".tsx")) continue;
      const linhas = fs.readFileSync(f, "utf8").split("\n");
      linhas.forEach((linha, i) => {
        const m = /<label[^>]*className="([^"]*)"/.exec(linha);
        if (!m || DISPLAY.test(m[1] ?? "")) return;
        const contexto = linhas.slice(Math.max(0, i - 3), i).join("\n");
        if (/space-[xy]-[0-9.]+/.test(contexto)) {
          suspeitos.push(`${path.relative(RAIZ, f)}:${i + 1}`);
        }
      });
    }
    expect(suspeitos, "adicione `block` — senão a margem do grupo evapora").toEqual([]);
  });

  it("nenhum componente de rótulo do design system fica sem display", () => {
    // Generaliza o de cima: qualquer `<label` cru que este projeto renderize
    // dentro de um grupo espaçado tem o mesmo problema. Aqui a guarda é sobre
    // os componentes de UI, que são os reusados; rótulo solto em tela é achado
    // de sonda (`tests/sonda-tailwind-4-antes-depois.ts`), não de unidade.
    const dir = path.join(RAIZ, "components/ui");
    const suspeitos: string[] = [];
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".tsx"))) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      for (const m of src.matchAll(/<label\s+className="([^"]*)"/g)) {
        const c = m[1] ?? "";
        if (!/\b(block|inline-block|flex|inline-flex|grid|table)\b/.test(c)) {
          suspeitos.push(`components/ui/${f}: <label className="${c.slice(0, 50)}">`);
        }
      }
    }
    expect(suspeitos, "rótulo inline dentro de componente de UI").toEqual([]);
  });
});

// ── auxiliares ────────────────────────────────────────────────────────────

function listarFontes(raizes: string[]): string[] {
  const saida: string[] = [];
  const anda = (dir: string) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (d.name === "node_modules" || d.name.startsWith(".")) continue;
        anda(p);
      } else if (/\.tsx?$/.test(d.name) && !/\.(test|spec)\.tsx?$/.test(d.name)) {
        saida.push(p);
      }
    }
  };
  for (const r of raizes) {
    const p = path.join(RAIZ, r);
    if (fs.existsSync(p)) anda(p);
  }
  return saida;
}

function ocorrencias(arquivos: string[], rx: RegExp): string[] {
  const achados: string[] = [];
  for (const f of arquivos) {
    const linhas = fs.readFileSync(f, "utf8").split("\n");
    linhas.forEach((linha, i) => {
      // Prosa não é classe. `lib/ai/cost.ts` documenta "rounded up" e viraria
      // culpado; a heurística de linha de comentário é grosseira mas suficiente,
      // porque nenhuma classe do produto mora em linha iniciada por `*` ou `//`.
      const cru = linha.trimStart();
      if (cru.startsWith("*") || cru.startsWith("//") || cru.startsWith("/*")) return;
      if (new RegExp(rx.source, rx.flags.replace("g", "")).test(linha)) {
        achados.push(`${path.relative(RAIZ, f)}:${i + 1}`);
      }
    });
  }
  return achados;
}

function temClassName(dir: string): boolean {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name === "node_modules" || d.name.startsWith(".")) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) {
      if (temClassName(p)) return true;
    } else if (/\.tsx$/.test(d.name) && fs.readFileSync(p, "utf8").includes("className=")) {
      return true;
    }
  }
  return false;
}
