import { describe, expect, it } from "vitest";

/**
 * Critério puro dos gatilhos first_contact / returning_after_silence —
 * espelha a decisão em `lib/followup/gatilho-contato.ts` sem DB.
 */
function deveArmar(input: {
  kind: "first_contact" | "returning_after_silence";
  totalInbounds: number;
  penultimoSentAt: string | null;
  thresholdMinutes: number;
  agora: Date;
}): boolean {
  if (input.kind === "first_contact") return input.totalInbounds === 1;
  if (input.totalInbounds < 2 || !input.penultimoSentAt) return false;
  const gapMs = input.agora.getTime() - new Date(input.penultimoSentAt).getTime();
  return gapMs >= input.thresholdMinutes * 60_000;
}

describe("critério first_contact / returning_after_silence", () => {
  const agora = new Date("2026-08-29T12:00:00.000Z");

  it("first_contact só com 1 inbound", () => {
    expect(
      deveArmar({
        kind: "first_contact",
        totalInbounds: 1,
        penultimoSentAt: null,
        thresholdMinutes: 1440,
        agora,
      }),
    ).toBe(true);
    expect(
      deveArmar({
        kind: "first_contact",
        totalInbounds: 2,
        penultimoSentAt: "2026-08-28T12:00:00.000Z",
        thresholdMinutes: 1440,
        agora,
      }),
    ).toBe(false);
  });

  it("returning_after_silence exige gap ≥ threshold", () => {
    expect(
      deveArmar({
        kind: "returning_after_silence",
        totalInbounds: 2,
        penultimoSentAt: "2026-08-28T12:00:00.000Z",
        thresholdMinutes: 1440,
        agora,
      }),
    ).toBe(true);
    expect(
      deveArmar({
        kind: "returning_after_silence",
        totalInbounds: 2,
        penultimoSentAt: "2026-08-29T11:00:00.000Z",
        thresholdMinutes: 1440,
        agora,
      }),
    ).toBe(false);
  });

  it("conversa quente (2+ inbounds recentes) não arma nenhum", () => {
    expect(
      deveArmar({
        kind: "first_contact",
        totalInbounds: 3,
        penultimoSentAt: "2026-08-29T11:50:00.000Z",
        thresholdMinutes: 1440,
        agora,
      }),
    ).toBe(false);
    expect(
      deveArmar({
        kind: "returning_after_silence",
        totalInbounds: 3,
        penultimoSentAt: "2026-08-29T11:50:00.000Z",
        thresholdMinutes: 1440,
        agora,
      }),
    ).toBe(false);
  });
});
