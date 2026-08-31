import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CAMINHO_DO_TICK, comandoCurlDoRelogio, TAREFAS_DO_RELOGIO, urlDoTickDoRelogio } from "@/lib/relogio/tarefas";

describe("tarefas do relógio", () => {
  it("inclui o worker de follow-up — sem ele o SIM não anda", () => {
    expect(TAREFAS_DO_RELOGIO.map((t) => t.id)).toContain("followup-flow-worker");
  });

  it("o curl aponta para o tick e não interpola o segredo", () => {
    const cmd = comandoCurlDoRelogio("https://crm.exemplo.com/");
    expect(cmd).toContain("https://crm.exemplo.com" + CAMINHO_DO_TICK);
    expect(cmd).toContain("$INTERNAL_SECRET");
    expect(cmd).not.toMatch(/Bearer [a-zA-Z0-9]{8,}/);
  });

  it("urlDoTickDoRelogio é o que o cron externo cola", () => {
    expect(urlDoTickDoRelogio("https://crm.exemplo.com/")).toBe(`https://crm.exemplo.com${CAMINHO_DO_TICK}`);
  });

  it("cobre a ida ao Google — o Hobby da Vercel não agenda esse cron", () => {
    expect(TAREFAS_DO_RELOGIO.map((t) => t.id)).toEqual(
      expect.arrayContaining(["agenda-google-refresh", "agenda-google-push"]),
    );
  });

  it("cada tarefa listada é de fato chamada no tick — senão a lista mente", () => {
    // Lista sem chamada é o defeito original: a tela (e este teste) diria que
    // a ida ao Google está no relógio, e o tick seguiria sem ela.
    const fonte = readFileSync(join(process.cwd(), "lib/relogio/executar.ts"), "utf8");
    for (const tarefa of TAREFAS_DO_RELOGIO) {
      expect(fonte, `${tarefa.id} está em TAREFAS_DO_RELOGIO e o tick não a chama`).toContain(
        `uma("${tarefa.id}"`,
      );
    }
  });

  it("marcar na tela dispara a ida sem esperar o próximo tick", () => {
    const fonte = readFileSync(
      join(process.cwd(), "app/api/v1/agenda/agendamentos/route.ts"),
      "utf8",
    );
    expect(fonte).toContain("agendarIdaAoGoogleAposResposta");
  });
});
