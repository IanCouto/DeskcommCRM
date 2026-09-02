import { afterEach, describe, expect, it, vi } from "vitest";

const env = {
  CRON_SECRET: "",
  INTERNAL_CRON_SECRET: "",
  INTERNAL_SECRET: "",
};

vi.mock("@/lib/env", () => ({ env }));

function reqComBearer(valor: string): { headers: Headers } {
  return { headers: new Headers({ authorization: `Bearer ${valor}` }) };
}

describe("cronAutorizado", () => {
  afterEach(() => {
    env.CRON_SECRET = "";
    env.INTERNAL_CRON_SECRET = "";
    env.INTERNAL_SECRET = "";
  });

  it("aceita o CRON_SECRET que a Vercel manda, mesmo distinto do interno", async () => {
    env.CRON_SECRET = "vercel-cron";
    env.INTERNAL_SECRET = "interno";
    const { cronAutorizado } = await import("./cron-bearer");
    expect(cronAutorizado(reqComBearer("vercel-cron"))).toBe(true);
    expect(cronAutorizado(reqComBearer("interno"))).toBe(true);
    expect(cronAutorizado(reqComBearer("outro"))).toBe(false);
  });

  it("fecha quando nenhum segredo está configurado", async () => {
    const { cronAutorizado } = await import("./cron-bearer");
    expect(cronAutorizado(reqComBearer("qualquer"))).toBe(false);
  });

  it("aceita x-cron-secret como alias do Bearer", async () => {
    env.INTERNAL_CRON_SECRET = "dedicado";
    const { cronAutorizado } = await import("./cron-bearer");
    expect(
      cronAutorizado({ headers: new Headers({ "x-cron-secret": "dedicado" }) }),
    ).toBe(true);
  });
});
