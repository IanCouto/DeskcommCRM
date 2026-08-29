import { describe, expect, it } from "vitest";

import { extrairRespostaDeBotao } from "@/lib/waha/button-reply";
import { casarEscolha, textoNumeradoDasEscolhas } from "@/lib/followup/escolhas";

describe("extrairRespostaDeBotao", () => {
  it("lê buttonsResponseMessage", () => {
    const r = extrairRespostaDeBotao({
      body: null,
      _data: {
        message: {
          buttonsResponseMessage: {
            selectedButtonId: "agendar",
            selectedDisplayText: "Agendar consulta",
          },
        },
      },
    });
    expect(r).toEqual({ buttonId: "agendar", displayText: "Agendar consulta" });
  });

  it("lê listResponseMessage", () => {
    const r = extrairRespostaDeBotao({
      _data: {
        message: {
          listResponseMessage: {
            title: "Outro",
            singleSelectReply: { selectedRowId: "outro" },
          },
        },
      },
    });
    expect(r.buttonId).toBe("outro");
    expect(r.displayText).toBe("Outro");
  });

  it("sem interativo devolve o body", () => {
    expect(extrairRespostaDeBotao({ body: "oi" })).toEqual({
      buttonId: null,
      displayText: "oi",
    });
  });
});

describe("escolhas — fallback e casamento", () => {
  const buttons = [
    { id: "agendar", text: "Agendar consulta" },
    { id: "duvida", text: "Esclarecer dúvida" },
    { id: "outro", text: "Outro" },
  ];

  it("monta texto numerado", () => {
    expect(textoNumeradoDasEscolhas("Escolha:", buttons)).toContain("1) Agendar consulta");
    expect(textoNumeradoDasEscolhas("Escolha:", buttons)).toContain("3) Outro");
  });

  it("casa por button_id", () => {
    expect(casarEscolha({ buttonId: "duvida", body: "", buttons })?.id).toBe("duvida");
  });

  it("casa por número no fallback", () => {
    expect(casarEscolha({ buttonId: null, body: "1", buttons })?.id).toBe("agendar");
    expect(casarEscolha({ buttonId: null, body: "2)", buttons })?.id).toBe("duvida");
  });

  it("casa por título contains", () => {
    expect(casarEscolha({ buttonId: null, body: "quero agendar consulta", buttons })?.id).toBe(
      "agendar",
    );
  });
});
