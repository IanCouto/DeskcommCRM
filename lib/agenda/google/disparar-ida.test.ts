import { beforeEach, describe, expect, it, vi } from "vitest";

const afterMock = vi.fn((fn: () => Promise<void>) => {
  enfileirado = fn;
});
let enfileirado: (() => Promise<void>) | null = null;

vi.mock("next/server", () => ({
  after: (fn: () => Promise<void>) => afterMock(fn),
}));
vi.mock("@/app/api/v1/cron/agenda-google-push/route", () => ({
  empurrarAgendamentosAoGoogle: vi.fn(async () => ({
    candidatos: 0,
    publicados: 0,
    apagados: 0,
    falhas: 0,
    semConexao: 0,
  })),
}));
vi.mock("@/app/api/v1/cron/agenda-google-refresh/route", () => ({
  renovarAgendasDoGoogle: vi.fn(async () => ({
    examinadas: 0,
    renovadas: 0,
    reautenticar: 0,
    falhas: 0,
    semAppOAuth: false,
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));

import { empurrarAgendamentosAoGoogle } from "@/app/api/v1/cron/agenda-google-push/route";
import { renovarAgendasDoGoogle } from "@/app/api/v1/cron/agenda-google-refresh/route";
import { agendarIdaAoGoogleAposResposta } from "@/lib/agenda/google/disparar-ida";

describe("disparar a ida ao Google depois da resposta", () => {
  beforeEach(() => {
    enfileirado = null;
    vi.clearAllMocks();
  });

  it("renova o token ANTES de publicar — senão o Hobby empurra com token vencido", async () => {
    const ordem: string[] = [];
    vi.mocked(renovarAgendasDoGoogle).mockImplementation(async () => {
      ordem.push("refresh");
      return { examinadas: 0, renovadas: 0, reautenticar: 0, falhas: 0, semAppOAuth: false };
    });
    vi.mocked(empurrarAgendamentosAoGoogle).mockImplementation(async () => {
      ordem.push("push");
      return { candidatos: 0, publicados: 0, apagados: 0, falhas: 0, semConexao: 0 };
    });

    agendarIdaAoGoogleAposResposta();
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(empurrarAgendamentosAoGoogle, "publicou ANTES da resposta sair").not.toHaveBeenCalled();

    await enfileirado!();
    expect(ordem).toEqual(["refresh", "push"]);
  });
});
