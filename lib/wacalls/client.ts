/**
 * Cliente mínimo REST do WaCalls (chamada de voz WhatsApp) — spec
 * docs/specs/18-spec-voice-calls-wacalls.md §4.1.
 *
 * Contrato medido no código-fonte upstream (cmd/server/httpapi.go, commit
 * edeb31f, o mesmo vendorizado em Dockerfile.wacalls), não na tabela do
 * README — ela erra o nome de campo (`state`, não `status`, em SessionInfo).
 *
 * A API do WaCalls não tem autenticação própria — por isso este cliente só é
 * instanciado server-side, contra `http://wacalls:8080` na rede interna do
 * compose, nunca exposto ao browser.
 */
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export interface WacallsSessionInfo {
  id: string;
  name: string;
  jid: string;
  state: string;
  paired: boolean;
}

export interface WacallsCallRecord {
  sessionId: string;
  callId: string;
  owner: string | null;
  direction: "inbound" | "outbound";
  peer: string;
  startedAt: number;
  status: "starting" | "ringing" | "connected" | "ended";
  endedAt?: number;
  endReason?: string;
}

export class WacallsClient {
  constructor(private readonly baseUrl: string) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`wacalls_${res.status}: ${body.slice(0, 200)}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** POST /api/sessions — cria a conta (não pareia ainda). */
  async createSession(name: string): Promise<{ id: string }> {
    return this.req("/api/sessions", { method: "POST", body: JSON.stringify({ name }) });
  }

  /**
   * POST /api/sessions/{sid}/pair — inicia o pareamento (QR).
   * Não devolve QR síncrono: chega via SSE (`session-qr`), ver
   * `lib/wacalls/events.ts`. 204 no sucesso.
   */
  async pairSession(sessionId: string): Promise<void> {
    await this.req(`/api/sessions/${encodeURIComponent(sessionId)}/pair`, { method: "POST" });
  }

  /** GET /api/sessions — lista todas as contas conhecidas pelo processo. */
  async listSessions(): Promise<WacallsSessionInfo[]> {
    const out = await this.req<{ sessions: WacallsSessionInfo[] }>("/api/sessions");
    return out.sessions;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.req(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  }

  async logoutSession(sessionId: string): Promise<void> {
    await this.req(`/api/sessions/${encodeURIComponent(sessionId)}/logout`, { method: "POST" });
  }

  /**
   * POST /api/sessions/{sid}/calls — inicia chamada outbound.
   * `clientId` vira o dono da chamada (exclusividade) — SEMPRE o user.id da
   * sessão autenticada, nunca escolhido pelo frontend.
   */
  async startCall(
    sessionId: string,
    clientId: string,
    phone: string,
  ): Promise<{ callId: string }> {
    const out = await this.req<{ call: { callId: string } }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/calls`,
      {
        method: "POST",
        headers: { "X-Client-Id": clientId },
        // record NUNCA true aqui — gravação fora de escopo desta versão
        // (spec §1.2 item 2, LGPD).
        // DÍGITOS PUROS, sem o '+'. `contacts.phone_number` guarda E.164 com
        // '+' (constraint `contacts_phone_e164_format`), e é de lá que a rota
        // tira o número — mas o identificador do WhatsApp nunca tem o sinal.
        // Mandar '+5511999998888' faz o upstream montar um JID inválido, e a
        // ligação falha num ponto onde a mensagem de erro não diz por quê.
        // É a mesma normalização que `lib/waha/send.ts` faz no envio de texto,
        // e o espelho do `'+' || $5` na ponte de eventos, que LÊ.
        body: JSON.stringify({ phone: phone.replace(/^\+/, "") }),
      },
    );
    return out.call;
  }

  /** POST /api/sessions/{sid}/calls/{id}/webrtc — relay puro do SDP. */
  async exchangeWebrtc(
    sessionId: string,
    callId: string,
    sdpOffer: string,
  ): Promise<{ sdpAnswer: string }> {
    const out = await this.req<{ sdp_answer: string }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/calls/${encodeURIComponent(callId)}/webrtc`,
      { method: "POST", body: JSON.stringify({ sdp_offer: sdpOffer }) },
    );
    return { sdpAnswer: out.sdp_answer };
  }

  async acceptCall(sessionId: string, callId: string, clientId: string): Promise<void> {
    await this.req(
      `/api/sessions/${encodeURIComponent(sessionId)}/calls/${encodeURIComponent(callId)}/accept`,
      { method: "POST", headers: { "X-Client-Id": clientId } },
    );
  }

  async rejectCall(sessionId: string, callId: string): Promise<void> {
    await this.req(
      `/api/sessions/${encodeURIComponent(sessionId)}/calls/${encodeURIComponent(callId)}/reject`,
      { method: "POST" },
    );
  }

  async endCall(sessionId: string, callId: string): Promise<void> {
    await this.req(
      `/api/sessions/${encodeURIComponent(sessionId)}/calls/${encodeURIComponent(callId)}`,
      { method: "DELETE" },
    );
  }

  async history(sessionId: string): Promise<WacallsCallRecord[]> {
    const out = await this.req<{ rows: WacallsCallRecord[] }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/history`,
    );
    return out.rows;
  }
}

/** `null` quando não configurado — chamador degrada para banner "indisponível". */
export function getWacallsClient(): WacallsClient | null {
  const url = env.WACALLS_API_BASE_URL;
  if (!url) {
    logger.debug("wacalls: WACALLS_API_BASE_URL ausente, cliente indisponível");
    return null;
  }
  return new WacallsClient(url);
}

export function wacallsFriendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("operator already on a call")) {
    return "Você já está em outra chamada. Encerre-a antes de iniciar uma nova.";
  }
  if (msg.includes("not paired")) {
    return "O número de chamada de voz ainda não foi pareado. Configure em Configurações › Canais.";
  }
  if (msg.includes("no such session")) {
    return "Sessão de chamada de voz não encontrada.";
  }
  return "Não foi possível completar a chamada. Tente novamente em instantes.";
}
