import { describe, expect, it } from "vitest";

import { rotuloDaFilaDoFollowup } from "@/lib/followup/rotulo-da-fila";

describe("rotuloDaFilaDoFollowup", () => {
  it("lê followup_queue_label", () => {
    expect(rotuloDaFilaDoFollowup({ followup_queue_label: "Recepção" })).toBe("Recepção");
  });

  it("ignora vazio e tipos ruins", () => {
    expect(rotuloDaFilaDoFollowup(null)).toBeNull();
    expect(rotuloDaFilaDoFollowup({})).toBeNull();
    expect(rotuloDaFilaDoFollowup({ followup_queue_label: "  " })).toBeNull();
    expect(rotuloDaFilaDoFollowup({ followup_queue_label: 1 })).toBeNull();
  });
});
