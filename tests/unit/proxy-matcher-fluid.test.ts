import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * O PROXY DO NEXT 16 É NODE, NÃO EDGE.
 *
 * Cada path que casa o matcher vira Function Fluid + Active CPU. A inbox
 * polla `/api/v1/conversations` dezenas de milhares de vezes por mês no Hobby;
 * o túnel `/monitoring` do Sentry idem. Auth dessas rotas mora DENTRO delas
 * (cookie + getUser, ou bearer). O proxy só somava JWT de novo.
 */

function regexDoMatcher(): RegExp {
  const fonte = readFileSync("proxy.ts", "utf8");
  const m = fonte.match(/matcher:\s*\[[^\]]*?"([^"]+)"/s);
  if (!m?.[1]) throw new Error("matcher do proxy.ts não encontrado");
  return new RegExp(`^${m[1]}$`);
}

describe("matcher do proxy — o que NÃO pode pagar Function", () => {
  const re = regexDoMatcher();

  it("API autenticada e cron/webhook não entram", () => {
    expect(re.test("/api/v1/conversations")).toBe(false);
    expect(re.test("/api/v1/cron/event-log-drain")).toBe(false);
    expect(re.test("/api/v1/webhooks/waha")).toBe(false);
    expect(re.test("/api/v1/system/relogio/tick")).toBe(false);
  });

  it("o túnel do Sentry não entra", () => {
    expect(re.test("/monitoring")).toBe(false);
    expect(re.test("/monitoring/envelope")).toBe(false);
  });

  it("a UI autenticada continua no proxy — senão o cookie não refresca na navegação", () => {
    expect(re.test("/app/inbox")).toBe(true);
    expect(re.test("/login")).toBe(true);
    expect(re.test("/icon")).toBe(true);
  });
});
