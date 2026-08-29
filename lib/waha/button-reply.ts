/**
 * Extrai o clique em botão/lista do payload WAHA (NOWEB).
 *
 * O `body` do webhook às vezes vem vazio no clique; o id e o texto ficam em
 * `_data.message.buttonsResponseMessage` (ou equivalentes). Sem isto a ingestão
 * descartava a mensagem (`!texto && !media`) e o fluxo nunca avançava.
 */

export type ButtonReply = {
  buttonId: string | null;
  displayText: string | null;
};

function texto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Lê o clique de um payload WAHA já parseado. Devolve nulls quando não há
 * resposta interativa — o chamador segue com `body` normal.
 */
export function extrairRespostaDeBotao(payload: {
  body?: string | null;
  _data?: { message?: unknown } | null;
}): ButtonReply {
  const msg = payload._data?.message;
  if (!msg || typeof msg !== "object") {
    return { buttonId: null, displayText: texto(payload.body) };
  }
  const m = msg as Record<string, unknown>;

  const buttons = m.buttonsResponseMessage;
  if (buttons && typeof buttons === "object") {
    const b = buttons as Record<string, unknown>;
    return {
      buttonId: texto(b.selectedButtonId) ?? texto(b.selectedButtonID),
      displayText: texto(b.selectedDisplayText) ?? texto(payload.body),
    };
  }

  const list = m.listResponseMessage;
  if (list && typeof list === "object") {
    const l = list as Record<string, unknown>;
    const single = l.singleSelectReply;
    const rowId =
      single && typeof single === "object"
        ? texto((single as Record<string, unknown>).selectedRowId)
        : null;
    return {
      buttonId: rowId ?? texto(l.selectedRowId),
      displayText: texto(l.title) ?? texto(payload.body),
    };
  }

  // Formas alternativas vistas em engines WEBJS / versões mais novas.
  const interactive = m.interactiveResponseMessage ?? m.templateButtonReplyMessage;
  if (interactive && typeof interactive === "object") {
    const i = interactive as Record<string, unknown>;
    return {
      buttonId: texto(i.selectedId) ?? texto(i.selectedButtonId) ?? texto(i.id),
      displayText: texto(i.selectedDisplayText) ?? texto(i.title) ?? texto(payload.body),
    };
  }

  return { buttonId: null, displayText: texto(payload.body) };
}
