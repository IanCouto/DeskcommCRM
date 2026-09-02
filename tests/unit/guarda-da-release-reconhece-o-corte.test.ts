import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * A GUARDA DA RELEASE, MEDIDA CONTRA A FORMA DO CORTE.
 *
 * ═══ O defeito que este teste existe para não ter de novo ═══════════════════
 *
 * A v1.11.1 foi anunciada no CHANGELOG e NUNCA virou tag (issue #472). Sem tag:
 * sem release, sem as três imagens, sem `stable` — nenhuma VPS a recebeu. E o
 * workflow saiu `success`: ele apenas decidiu não cortar.
 *
 * A guarda antiga reconhecia um corte por "o diretório `.changes/` ficou
 * vazio". No run 33494815423 ela viu `antes=4 depois=1` e desistiu — porque o
 * PR #460 mergeou ENTRE o corte e o merge da release, deixando o fragmento
 * dele vivo. Merge comum correndo em paralelo com a release é o estado normal
 * de um repo vivo, não uma anomalia.
 *
 * ═══ Por que este teste EXECUTA o bash do workflow ══════════════════════════
 *
 * Reescrever a regra em TypeScript criaria a segunda verdade sobre o que é um
 * corte, e a segunda envelhece sozinha: alguém ajusta o YAML, o espelho de TS
 * segue verde, e o gate passa a medir uma regra que não roda em lugar nenhum.
 * Aqui o bloco `run:` é EXTRAÍDO do `.github/workflows/release.yml` e
 * executado — o que está sob teste é o arquivo que o CI usa.
 *
 * ═══ Por que repositório SINTÉTICO, e não os commits reais ══════════════════
 *
 * A primeira versão deste teste julgava SHAs desta `main` — inclusive o
 * `f6f91377` que falhou de verdade. Era evidência melhor de ler e PIOR de
 * confiar: o checkout do CI é raso, e lá o teste devolvia
 *
 *     fatal: bad revision '1e3c724f^'
 *
 * em todos os casos. Um gate que só mede na máquina de quem o escreveu é pior
 * que gate nenhum, porque parece cobertura.
 *
 * O repositório abaixo REPRODUZ a forma do #472 em vez de depender de ela ter
 * acontecido: dois fragmentos, um branch de release que os apaga assinado pelo
 * bot, um PR concorrente que acrescenta um terceiro no meio, e o merge com dois
 * pais. Roda igual em qualquer clone, raso ou completo.
 */

const RAIZ = process.cwd();
const BOT = "deskcomm-release[bot]";

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

let repo: string;

function git(args: string[], opts: { autor?: string } = {}): string {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (opts.autor) {
    Object.assign(env, {
      GIT_AUTHOR_NAME: opts.autor,
      GIT_COMMITTER_NAME: opts.autor,
      GIT_AUTHOR_EMAIL: `${opts.autor}@exemplo.test`,
      GIT_COMMITTER_EMAIL: `${opts.autor}@exemplo.test`,
    });
  }
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", env }).trim();
}

function fragmento(nome: string, corpo = "fragmento") {
  mkdirSync(join(repo, ".changes"), { recursive: true });
  writeFileSync(join(repo, ".changes", nome), corpo);
}

function commit(mensagem: string, autor = "Alguém do time") {
  git(["add", "-A"]);
  git(["commit", "-q", "-m", mensagem], { autor });
  return git(["rev-parse", "HEAD"]);
}

/**
 * Roda a guarda como se `HEAD` fosse `sha`, dentro do repositório sintético.
 *
 * `HEAD^2` primeiro, depois `HEAD^`, depois `HEAD`: a ordem importa, senão
 * `HEAD^2` viraria `<sha>^2` só pela metade.
 */
function decisaoPara(sha: string): string {
  const script = bashDaGuarda()
    // A versão vem do CHANGELOG por um script de TS que não existe no repo
    // sintético; ela é irrelevante aqui e fica num número sem tag, para não
    // sair pelo primeiro `if`.
    .replace(/^\s*versao=\$\(.*\)$/m, 'versao="999.999.999"')
    .replace(/HEAD\^2/g, `${sha}^2`)
    .replace(/HEAD\^/g, `${sha}^`)
    .replace(/\bHEAD\b/g, sha);

  const saida = execFileSync("bash", ["-c", script], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: "/dev/stdout" },
  });
  return /cortar=(\w+)/.exec(saida)?.[1] ?? "(nenhuma decisão)";
}

let mergeDaReleaseComCorrida = "";
let mergeDePrComum = "";
let commitDeFeature = "";

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "guarda-release-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.name", "Alguém do time"]);
  git(["config", "user.email", "alguem@exemplo.test"]);
  git(["config", "commit.gpgsign", "false"]);

  writeFileSync(join(repo, "CHANGELOG.md"), "# Changelog\n");
  fragmento(".gitkeep", "");
  commit("chore: raiz");

  // ── Estado antes do corte: dois fragmentos declarados ────────────────────
  fragmento("a.md");
  fragmento("b.md");
  const antesDoCorte = commit("feat: dois fragmentos");

  // ── O branch de release: apaga o que consumiu, assinado pelo App ─────────
  git(["checkout", "-q", "-b", "release/9.9.9", antesDoCorte]);
  rmSync(join(repo, ".changes/a.md"));
  rmSync(join(repo, ".changes/b.md"));
  writeFileSync(join(repo, "CHANGELOG.md"), "# Changelog\n\n## [9.9.9]\n");
  const pontaDaRelease = commit("release(9.9.9): a versão montada a partir dos fragmentos", BOT);

  // ── A CORRIDA: um PR comum mergeia na main enquanto a release espera ─────
  git(["checkout", "-q", "main"]);
  fragmento("c.md");
  const prConcorrente = commit("feat: o PR que chegou no meio");
  git(["merge", "-q", "--no-ff", "-m", "Merge PR #460", prConcorrente]);
  mergeDePrComum = git(["rev-parse", "HEAD"]);

  // ── O merge da release, com o fragmento do concorrente ainda vivo ────────
  git(["merge", "-q", "--no-ff", "-m", "Merge pull request #461 from release/9.9.9", pontaDaRelease]);
  mergeDaReleaseComCorrida = git(["rev-parse", "HEAD"]);

  // ── Um commit qualquer de feature, que não encosta em .changes/ ──────────
  writeFileSync(join(repo, "README.md"), "nada a ver com release\n");
  commitDeFeature = commit("fix: coisa nenhuma");
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe("a guarda reconhece o corte pela forma dele", () => {
  it("CORTA o merge de release que correu junto com um PR comum — a forma exata da #472", () => {
    // A guarda antiga via `depois=1` aqui (o fragmento do concorrente) e
    // desistia. É o caso que a v1.11.1 encontrou, e o único que muda.
    expect(decisaoPara(mergeDaReleaseComCorrida)).toBe("sim");
  });

  it("o diretório NÃO fica vazio nesse merge — é o que enganava a guarda antiga", () => {
    // Sem este caso, o anterior poderia estar passando por um cenário onde a
    // regra velha também funcionaria, e o teste não provaria nada.
    const sobraram = git([
      "ls-tree", "-r", "--name-only", mergeDaReleaseComCorrida, "--", ".changes/",
    ])
      .split("\n")
      .filter((l) => l.endsWith(".md"));
    expect(sobraram).toEqual([".changes/c.md"]);
  });

  it("NÃO corta um merge de PR comum, que só acrescenta fragmento", () => {
    expect(decisaoPara(mergeDePrComum)).toBe("nao");
  });

  it("NÃO corta um commit que nem toca em .changes/", () => {
    expect(decisaoPara(commitDeFeature)).toBe("nao");
  });
});

describe("a guarda recusa ALTO, e não em silêncio, quem apaga fragmento sem ser o App", () => {
  it("apagar fragmento à mão, num commit não assinado pelo App, derruba o passo", () => {
    // A forja que a guarda antiga DEIXAVA passar: escrever a seção no CHANGELOG
    // e esvaziar o diretório criava a tag. Agora não basta apagar — é preciso a
    // identidade do App, que vive em secrets.
    git(["checkout", "-q", "main"]);
    rmSync(join(repo, ".changes/c.md"));
    writeFileSync(join(repo, "CHANGELOG.md"), "# Changelog\n\n## [999.999.999]\n");
    const forjado = commit("feat: parece uma release e não é", "Fulano de Tal");

    expect(() => decisaoPara(forjado)).toThrow();
  });

  it("o mesmo apagar, ASSINADO pelo App, corta (controle positivo)", () => {
    // Sem este, "derruba sempre" satisfaria o caso acima.
    fragmento("d.md");
    commit("feat: mais um fragmento");
    rmSync(join(repo, ".changes/d.md"));
    const legitimo = commit("release(999.999.999): montada dos fragmentos", BOT);

    expect(decisaoPara(legitimo)).toBe("sim");
  });
});
