/**
 * Mensagens de escolha (botões WhatsApp) no follow-up.
 *
 * O WAHA tenta `sendButtons`; se falhar, o corpo numerado abaixo é o fallback
 * que o lead vê — e o `match_reply` casa tanto o `button_id` quanto "1"/"2"/"3".
 */

export type BotaoDeEscolha = { id: string; text: string };

/** Corpo numerado idêntico ao que o fallback envia e o match_reply espera. */
export function textoNumeradoDasEscolhas(body: string, buttons: BotaoDeEscolha[]): string {
  const linhas = buttons.map((b, i) => `${i + 1}) ${b.text}`);
  const base = body.trim();
  return base.length > 0 ? `${base}\n\n${linhas.join("\n")}` : linhas.join("\n");
}

/**
 * Casa a resposta do lead com um botão: primeiro pelo id nativo do clique,
 * depois por número ("1") ou pelo texto do botão (contains).
 */
export function casarEscolha(input: {
  buttonId: string | null | undefined;
  body: string;
  buttons: BotaoDeEscolha[];
}): BotaoDeEscolha | null {
  const id = input.buttonId?.trim();
  if (id) {
    const porId = input.buttons.find((b) => b.id === id);
    if (porId) return porId;
  }
  const body = input.body.trim().toLowerCase();
  if (!body) return null;
  for (let i = 0; i < input.buttons.length; i++) {
    const b = input.buttons[i]!;
    const n = String(i + 1);
    if (body === n || body === `${n})` || body.startsWith(`${n})`) || body.startsWith(`${n}.`)) {
      return b;
    }
    const titulo = b.text.trim().toLowerCase();
    if (titulo.length > 0 && body.includes(titulo)) return b;
  }
  return null;
}
