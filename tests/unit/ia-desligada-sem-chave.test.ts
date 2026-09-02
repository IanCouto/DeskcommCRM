/**
 * Sem chave de plataforma, o drain NÃO pode chamar o worker de chat.
 *
 * O worker já pulava com `ai_gateway_key_missing`, mas o detail ia para
 * `event_log.last_error` a cada mensagem. O wrapper devolve skipped sem
 * detail — e sem chamar o handler interno.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock: Record<string, string> = {};
vi.mock("@/lib/env", () => ({
  get env() {
    return envMock;
  },
}));

import type { EventHandler, EventRow } from "@/lib/event-log/dispatcher";
import { soComIaDaPlataforma } from "@/lib/event-log/register-handlers";

const row: EventRow = {
  id: "ev1",
  organization_id: "org1",
  event_type: "message.received",
  entity_kind: "message",
  entity_id: "msg1",
  payload: {},
  metadata: {},
  consumed_by: [],
  attempts: 0,
};

function fakeHandler(handle: EventHandler["handle"]): EventHandler {
  return { key: "ai-response-worker.v1", events: ["message.received"], handle };
}

describe("soComIaDaPlataforma", () => {
  beforeEach(() => {
    for (const k of Object.keys(envMock)) delete envMock[k];
  });

  it("sem chave não chama o worker e não deixa detail (não vira last_error)", async () => {
    const handle = vi.fn(async () => ({
      consumer_key: "ai-response-worker.v1",
      status: "ok" as const,
    }));
    const r = await soComIaDaPlataforma(fakeHandler(handle)).handle(row);
    expect(handle).not.toHaveBeenCalled();
    expect(r).toEqual({ consumer_key: "ai-response-worker.v1", status: "skipped" });
    expect(r.detail).toBeUndefined();
  });

  it("com chave o worker roda", async () => {
    envMock.ANTHROPIC_API_KEY = "sk-ant-x";
    const handle = vi.fn(async () => ({
      consumer_key: "ai-response-worker.v1",
      status: "ok" as const,
    }));
    const r = await soComIaDaPlataforma(fakeHandler(handle)).handle(row);
    expect(handle).toHaveBeenCalledOnce();
    expect(r.status).toBe("ok");
  });
});
