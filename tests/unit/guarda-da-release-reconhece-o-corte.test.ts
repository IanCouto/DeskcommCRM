import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A GUARDA DA RELEASE, MEDIDA CONTRA OS COMMITS QUE ELA JÁ JULGOU.
 *
 * ═══ O defeito que este teste existe para não ter de novo ═══════════════════
 *
 * A v1.11.1 foi anunciada no CHANGELOG e NUNCA virou tag (issue #472). Sem
 * tag: sem release, sem as três imagens, sem `stable` — nenhuma VPS a recebeu.
 * E o workflow saiu `success`: ele apenas decidiu não cortar.
 *
 * A guarda antiga reconhecia um corte por "o diretório `.changes/` ficou
 * vazio". No run 33494815423 ela viu `antes=4 depois=1` e desistiu — porque o
 * PR #460 mergeou ENTRE o corte e o merge da release, deixando o fragmento
 * dele vivo. Um merge comum correndo em paralelo com a release é o estado
 * normal de um repo vivo, não uma anomalia.
 *
 * ═══ Por que este teste EXECUTA o bash do workflow ══════════════════════════
 *
 * Reescrever a regra em TypeScript criaria a segunda verdade sobre o que é um
 * corte, e a segunda envelhece sozinha: alguém ajusta o YAML, o espelho de TS
 * segue verde, e o gate passa a medir uma regra que não roda em lugar nenhum.
 * Aqui o bloco `run:` é EXTRAÍDO do `.github/workflows/release.yml` e
 * executado — o que está sob teste é o arquivo que o CI usa.
 *
 * A única transformação é trocar `HEAD` pelo commit sob julgamento (o script
 * fala em `HEAD`, e o teste precisa julgar cinco commits sem mexer no worktree)
 * e fixar a versão, que viria de `cortar-release.ts` e não é o que se mede aqui.
 */

const RAIZ = process.cwd();

/** O bloco `run:` do passo que decide se este push foi um corte. */
function bashDaGuarda(): string {
  const yml = readFileSync(join(RAIZ, ".github/workflows/release.yml"), "utf8");
  const inicio = yml.indexOf("Este push foi um corte de release?");
  expect(inicio, "o passo da guarda sumiu do release.yml").toBeGreaterThan(-1);
  const run = yml.indexOf("run: |", inicio);
  expect(run, "o passo da guarda não tem bloco run").toBeGreaterThan(-1);

  const linhas = yml.slice(run + "run: |".length).split("\n").slice(1);
  const corpo: string[] = [];
  for (const l of linhas) {
    // O bloco acaba na primeira linha não-vazia com indentação menor que a dele.
    if (l.trim() !== "" && !l.startsWith("          ")) break;
    corpo.push(l.slice(10));
  }
  return corpo.join("\n");
}

/**
 * Roda a guarda como se `HEAD` fosse `sha`, e devolve o que ela decidiu.
 *
 * `HEAD^2` primeiro, depois `HEAD^`, depois `HEAD`: a ordem importa, senão
 * `HEAD^2` viraria `<sha>^2` só pela metade.
 */
function decisaoPara(sha: string): { cortar: string; saida: string } {
  const script = bashDaGuarda()
    // A versão vem do CHANGELOG por um script de TS; aqui ela é irrelevante e
    // fixada num número que não tem tag, para não pular no primeiro `if`.
    .replace(/^\s*versao=\$\(.*\)$/m, 'versao="999.999.999"')
    .replace(/HEAD\^2/g, `${sha}^2`)
    .replace(/HEAD\^/g, `${sha}^`)
    .replace(/\bHEAD\b/g, sha);

  const saida = execFileSync("bash", ["-c", script], {
    cwd: RAIZ,
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: "/dev/stdout" },
  });

  const m = /cortar=(\w+)/.exec(saida);
  return { cortar: m?.[1] ?? "(nenhuma decisão)", saida };
}

/**
 * Commits reais desta `main`, e o que a guarda TEM de decidir sobre cada um.
 *
 * SHAs fixos de propósito: são os fatos históricos que o defeito produziu, e a
 * `main` deste repo não é reescrita. Um deles é o commit que falhou.
 */
const CASOS = [
  {
    sha: "1e3c724f",
    o_que_e: "release 1.11.0 — o corte que funcionou",
    espera: "sim",
  },
  {
    sha: "f6f91377",
    o_que_e: "release 1.11.1 — O CORTE QUE A GUARDA ANTIGA RECUSOU (issue #472)",
    espera: "sim",
  },
  {
    sha: "3b6832fa",
    o_que_e: "PR comum que ACRESCENTA fragmento (o catálogo, #475)",
    espera: "nao",
  },
  {
    sha: "b305a47b",
    o_que_e: "PR comum que acrescentou o fragmento da corrida (#460)",
    espera: "nao",
  },
  {
    sha: "a3ae300d",
    o_que_e: "commit solto de feature, sem tocar em .changes/",
    espera: "nao",
  },
] as const;

describe("a guarda da release, contra os commits que ela já julgou", () => {
  for (const c of CASOS) {
    it(`${c.sha} (${c.o_que_e}) → cortar=${c.espera}`, () => {
      expect(decisaoPara(c.sha).cortar).toBe(c.espera);
    });
  }

  it("o caso da #472 é o ÚNICO que muda de veredito — os outros quatro seguem iguais", () => {
    // Sem este caso, uma guarda que dissesse "sim" para tudo passaria nos dois
    // primeiros e o teste pareceria verde por competência.
    const vereditos = CASOS.map((c) => decisaoPara(c.sha).cortar);
    expect(vereditos).toEqual(["sim", "sim", "nao", "nao", "nao"]);
  });
});

describe("a guarda recusa alto, e não em silêncio, quem apaga fragmento sem ser o App", () => {
  it("um commit que apaga fragmento sem a assinatura do App derruba o passo", () => {
    // É o buraco que a #472 deixou à vista: o workflow saiu `success` sem tag,
    // e ninguém viu por dias. Apagar fragmento fora do corte é o caso em que
    // silêncio é o pior desfecho possível.
    const script = bashDaGuarda()
      .replace(/^\s*versao=\$\(.*\)$/m, 'versao="999.999.999"')
      .replace(/^\s*removidos=\$\(.*\)$/m, "removidos=3")
      .replace(/^\s*assinante=\$\(.*\)$/m, 'assinante="Fulano de Tal"')
      .replace(/^\s*\[ -n "\$\{assinante\}" \].*$/m, ":");

    expect(() =>
      execFileSync("bash", ["-c", script], {
        cwd: RAIZ,
        encoding: "utf8",
        stdio: "pipe",
        env: { ...process.env, GITHUB_OUTPUT: "/dev/null" },
      }),
    ).toThrow();
  });

  it("o mesmo commit COM a assinatura do App corta (controle positivo)", () => {
    // Sem este, "derruba sempre" satisfaria o caso acima.
    const script = bashDaGuarda()
      .replace(/^\s*versao=\$\(.*\)$/m, 'versao="999.999.999"')
      .replace(/^\s*removidos=\$\(.*\)$/m, "removidos=3")
      .replace(/^\s*assinante=\$\(.*\)$/m, 'assinante="deskcomm-release[bot]"')
      .replace(/^\s*\[ -n "\$\{assinante\}" \].*$/m, ":");

    const saida = execFileSync("bash", ["-c", script], {
      cwd: RAIZ,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: "/dev/stdout" },
    });
    expect(saida).toMatch(/cortar=sim/);
  });
});
