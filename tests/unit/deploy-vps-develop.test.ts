import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const SCRIPT = readFileSync(join(RAIZ, ".github/scripts/deploy-vps-develop.sh"), "utf8");

describe("deploy da develop na VPS não puxa o registro do upstream", () => {
  const semComentario = SCRIPT.split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");

  it("não chama gravar_imagens — aquilo pinaria o namespace do upstream, que este fork não publica", () => {
    expect(semComentario).not.toMatch(/\bgravar_imagens\b/);
  });

  it("grava as três imagens a partir do DONO do job, não de um literal", () => {
    expect(SCRIPT).toContain("ghcr.io/${DONO}/deskcommcrm:develop");
    expect(SCRIPT).toContain("ghcr.io/${DONO}/deskcomm-worker:develop");
    expect(SCRIPT).toContain("ghcr.io/${DONO}/deskcomm-scheduler:develop");
  });

  it("puxa o código pela URL pública — Bearer no extraHeader faz o git da VPS pedir usuário", () => {
    expect(semComentario).toContain("GIT_TERMINAL_PROMPT=0");
    expect(semComentario).not.toMatch(/http\.extraHeader/);
  });

  it("libera o disco antes do backup e do login — os dois morrem com disco cheio", () => {
    const linhas = semComentario.split("\n").map((l) => l.trim());
    const iLib = linhas.findIndex((l) => l === "liberar_disco");
    const iBackup = linhas.findIndex((l) => l.includes("backup.sh"));
    const iLogin = linhas.findIndex((l) => l.includes("docker login"));
    const iPull = linhas.findIndex((l) => l.includes("dc pull"));
    expect(iLib).toBeGreaterThan(-1);
    expect(iLib).toBeLessThan(iBackup);
    expect(iLib).toBeLessThan(iLogin);
    expect(iLib).toBeLessThan(iPull);
    expect(semComentario).toContain("docker image prune -af");
    expect(semComentario).not.toMatch(/docker (system|network) prune/);
  });
});
