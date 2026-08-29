import { describe, expect, it } from "vitest";

import { grafoRecepcao, grafoRetorno } from "@/lib/followup/presets/recepcao-retorno";
import { validateFlowForPublish } from "@/lib/followup/validate-publish";
import { flowGraphSchema } from "@/lib/followup/graph-schema";

describe("presets recepção/retorno", () => {
  it("grafo de recepção parseia e publica", () => {
    const g = grafoRecepcao();
    expect(flowGraphSchema.safeParse(g).success).toBe(true);
    const v = validateFlowForPublish(g);
    expect(v.ok, JSON.stringify(v)).toBe(true);
  });

  it("grafo de retorno parseia e publica", () => {
    const g = grafoRetorno();
    expect(flowGraphSchema.safeParse(g).success).toBe(true);
    const v = validateFlowForPublish(g);
    expect(v.ok, JSON.stringify(v)).toBe(true);
  });
});
