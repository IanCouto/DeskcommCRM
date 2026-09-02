import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TODA ROTA DE CRON EXISTE PARA SER CHAMADA POR ALGUÉM.
 *
 * O defeito que este teste existe para impedir já aconteceu e passou meses:
 * `risk-watcher`, `routing-worker` e `attendant-heartbeat` existiam, tinham
 * teste, tinham doc — e NINGUÉM AS AGENDAVA no self-host. O `risk-watcher` até
 * documentava a própria ausência no cabeçalho ("o kit precisa agendar esta
 * rota"), e a nota ficou lá sem virar linha de crontab.
 *
 * E o modo de falha é o pior: NÃO DÁ ERRO. A rota responde 200 quando alguém a
 * chama à mão, o teste unitário passa, o build passa — e a feature simplesmente
 * nunca acontece sozinha em produção. "Nada esfria" é indistinguível de "nada
 * esfriou ainda".
 *
 * A cerca é mecânica de propósito: compara o DIRETÓRIO (fonte da verdade do que
 * existe) com o CRONTAB do serviço `scheduler` (fonte da verdade do que roda).
 * Não pede disciplina de ninguém — quem criar uma rota nova sem agendá-la
 * descobre no CI, não seis meses depois pela ausência de um comportamento.
 */

const RAIZ = join(__dirname, "..", "..");
const DIR_CRON = join(RAIZ, "app", "api", "v1", "cron");
// O crontab saiu do `command:` inline do compose e virou o entrypoint da imagem
// `deskcomm-scheduler` — o `apk add curl tzdata` a cada start amarrava a volta
// do cron à internet da VPS. A cerca continua a mesma; só a fonte da verdade do
// "o que roda" mudou de arquivo.
const CRONTAB = join(RAIZ, "docker", "scheduler", "entrypoint.sh");
const VERCEL_TS = join(RAIZ, "vercel.ts");
/**
 * No-op permanente (Fase 0). O self-host ainda dispara para não quebrar crontab
 * antigo; na Vercel cada `* * * * *` cobra invocação à toa.
 */
const FORA_DA_VERCEL = new Set(["agent-dispatcher"]);

/** As rotas que existem, lidas do disco — não de uma lista mantida à mão. */
function rotasNoCodigo(): string[] {
  return readdirSync(DIR_CRON, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** rota → cadências no crontab do scheduler (UTC). */
function cadenciasDoScheduler(): Map<string, string[]> {
  const sh = readFileSync(CRONTAB, "utf8");
  const mapa = new Map<string, string[]>();
  for (const m of sh.matchAll(/(?:^|\n)([^\n|#][^|\n]*)\|\d+\|api\/v1\/cron\/([a-z0-9-]+)/g)) {
    const quando = m[1]!.trim();
    const rota = m[2]!;
    const atual = mapa.get(rota) ?? [];
    atual.push(quando);
    mapa.set(rota, atual);
  }
  return mapa;
}

/** As rotas que o `scheduler` chama, extraídas do crontab embutido no compose. */
function rotasAgendadas(): string[] {
  return [...cadenciasDoScheduler().keys()].sort();
}

/** rota → cadências no `vercel.ts` (UTC, plano Pro). */
function cadenciasDaVercel(): Map<string, string[]> {
  const ts = readFileSync(VERCEL_TS, "utf8");
  const mapa = new Map<string, string[]>();
  for (const m of ts.matchAll(/path:\s*"\/api\/v1\/cron\/([a-z0-9-]+)"\s*,\s*schedule:\s*"([^"]+)"/g)) {
    const rota = m[1]!;
    const quando = m[2]!;
    const atual = mapa.get(rota) ?? [];
    atual.push(quando);
    mapa.set(rota, atual);
  }
  return mapa;
}

describe("rotas de cron × agendamento no self-host", () => {
  it("o apparato consegue enxergar as duas listas (controle positivo)", () => {
    // Sem isto, um `readdir` que devolvesse [] ou um regex que não casasse nada
    // fariam o teste principal passar por vacuidade — "zero rotas não agendadas"
    // seria verdade e não significaria nada.
    expect(rotasNoCodigo().length).toBeGreaterThan(0);
    expect(rotasAgendadas().length).toBeGreaterThan(0);
  });

  it("toda rota de cron do código está agendada no scheduler", () => {
    const naoAgendadas = rotasNoCodigo().filter((r) => !rotasAgendadas().includes(r));
    expect(
      naoAgendadas,
      `Rota(s) de cron sem linha no crontab de docker/scheduler/entrypoint.sh: ` +
        `${naoAgendadas.join(", ")}. Num self-host elas NUNCA rodam, e a feature não dá erro — ` +
        `só não acontece. Adicione a linha (ou apague a rota, se ela morreu).`,
    ).toEqual([]);
  });

  it("todo agendamento aponta para uma rota que existe", () => {
    // A direção contrária: linha de crontab para rota apagada bate 404 a cada
    // minuto, em silêncio, porque o `curl -fsS` manda tudo para /dev/null.
    const orfas = rotasAgendadas().filter((r) => !rotasNoCodigo().includes(r));
    expect(
      orfas,
      `Crontab agenda rota(s) que não existem mais: ${orfas.join(", ")}. ` +
        `O curl silencia o 404 e ninguém percebe.`,
    ).toEqual([]);
  });
});

describe("rotas de cron × agendamento na Vercel (Pro)", () => {
  it("o apparato consegue enxergar o vercel.ts (controle positivo)", () => {
    expect(cadenciasDaVercel().size).toBeGreaterThan(0);
  });

  it("toda rota viva está no vercel.ts (exceto no-op declarado)", () => {
    const naVercel = [...cadenciasDaVercel().keys()];
    const naoAgendadas = rotasNoCodigo().filter(
      (r) => !FORA_DA_VERCEL.has(r) && !naVercel.includes(r),
    );
    expect(
      naoAgendadas,
      `Rota(s) de cron sem linha em vercel.ts: ${naoAgendadas.join(", ")}. ` +
        `No deploy Vercel elas NUNCA rodam. Adicione a linha (ou a allowlist FORA_DA_VERCEL, se morreu).`,
    ).toEqual([]);
  });

  it("todo cron do vercel.ts aponta para uma rota que existe", () => {
    const orfas = [...cadenciasDaVercel().keys()].filter((r) => !rotasNoCodigo().includes(r));
    expect(orfas, `vercel.ts agenda rota(s) que não existem mais: ${orfas.join(", ")}.`).toEqual([]);
  });

  it("a cadência na Vercel é a mesma do scheduler (UTC)", () => {
    const vps = cadenciasDoScheduler();
    const vercel = cadenciasDaVercel();
    for (const [rota, quando] of vercel) {
      expect(vps.get(rota), `${rota} está no vercel.ts e não no scheduler`).toEqual(quando);
    }
    for (const [rota, quando] of vps) {
      if (FORA_DA_VERCEL.has(rota)) continue;
      expect(vercel.get(rota), `${rota} está no scheduler e não no vercel.ts`).toEqual(quando);
    }
  });
});
