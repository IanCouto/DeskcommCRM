/**
 * Ponte de eventos WaCalls → Postgres — spec docs/specs/18-spec-voice-calls-wacalls.md §4.2.
 *
 * Mantém 1 conexão SSE persistente contra `${WACALLS_API_BASE_URL}/api/events`
 * (processo do WORKER, não trigger de banco — doutrina "trigger nunca faz
 * HTTP" não se aplica aqui, é o inverso: HTTP alimentando o banco). Reconecta
 * com backoff se cair (anti-morte, §6 da spec).
 *
 * Eventos medidos no código-fonte upstream (cmd/server/broker.go, commit
 * edeb31f): `call-status` é o upsert canônico pras DUAS direções — uma
 * chamada inbound dispara `call-status` (ringing) E `incoming` no mesmo
 * instante (session.go:60-64, mesmo OnIncoming), então `incoming` não
 * precisa gravar nada sozinho: só relaya pro frontend tocar o toque (§5.2).
 */
import type pg from 'pg';

import { emitAgentActivityForContact } from '@/lib/leads/agent-activity';

import type { Logger } from '../agent-engine/obs/logger';

export interface WacallsBridgeConfig {
  baseUrl: string;
  /** Backoff de reconexão da SSE (ms) — sobe até este teto. */
  maxBackoffMs: number;
}

interface WacallsSessionMap {
  channelSessionId: string;
  organizationId: string;
}

/** `5511999999999@s.whatsapp.net` → `5511999999999`. JID sem o domínio. */
function peerToPhone(jid: string): string {
  return jid.split('@')[0] ?? jid;
}

async function resolveSession(
  pool: pg.Pool,
  cache: Map<string, WacallsSessionMap>,
  wacallsSessionId: string,
): Promise<WacallsSessionMap | null> {
  const cached = cache.get(wacallsSessionId);
  if (cached) return cached;
  const { rows } = await pool.query<{ id: string; organization_id: string }>(
    `select id, organization_id from channel_sessions
      where provider = 'wacalls' and wacalls_session_id = $1
        and archived_at is null`,
    [wacallsSessionId],
  );
  const row = rows[0];
  if (!row) return null;
  const mapped = { channelSessionId: row.id, organizationId: row.organization_id };
  cache.set(wacallsSessionId, mapped);
  return mapped;
}

async function handleAuthState(
  pool: pg.Pool,
  sess: WacallsSessionMap,
  ev: { paired: boolean; state: string; qr?: string },
  log: Logger,
): Promise<void> {
  if (!ev.paired) return;
  // Pareado agora — grava jid/paired_at uma vez (idempotente: `is distinct
  // from` evita reescrever a cada tick de heartbeat que o WaCalls também
  // manda como auth-state).
  const { rowCount } = await pool.query(
    `update channel_sessions
        set wacalls_paired_at = coalesce(wacalls_paired_at, now()),
            status = 'WORKING',
            updated_at = now()
      where id = $1 and wacalls_paired_at is distinct from now()`,
    [sess.channelSessionId],
  );
  if ((rowCount ?? 0) > 0) {
    log.info('wacalls: sessão pareada', { channel_session_id: sess.channelSessionId });
  }
}

async function handleCallStatus(
  pool: pg.Pool,
  sess: WacallsSessionMap,
  ev: { id: string; status: string; peer: string; direction?: string; startedAt: number },
  log: Logger,
): Promise<void> {
  const peerPhone = peerToPhone(ev.peer);
  const direction = ev.direction === 'outbound' ? 'outbound' : 'inbound';

  await pool.query(
    `insert into voice_calls
       (organization_id, channel_session_id, contact_id, wacalls_call_id, direction,
        peer_phone, status, started_at)
     values ($1, $2,
             (select id from contacts where organization_id = $1 and phone_number = $5 limit 1),
             $3, $4, $5, $6, to_timestamp($7 / 1000.0))
     on conflict (organization_id, wacalls_call_id) do update
       set status = excluded.status,
           answered_at = case
             when voice_calls.answered_at is null and excluded.status = 'connected'
               then now()
             else voice_calls.answered_at
           end,
           updated_at = now()`,
    [sess.organizationId, sess.channelSessionId, ev.id, direction, peerPhone, ev.status, ev.startedAt],
  );
  log.info('wacalls: call-status', {
    channel_session_id: sess.channelSessionId,
    wacalls_call_id: ev.id,
    status: ev.status,
  });
}

async function handleCallEnded(
  pool: pg.Pool,
  sess: WacallsSessionMap,
  ev: { id: string; reason: string; endedAt: number },
  log: Logger,
): Promise<void> {
  const { rows } = await pool.query<{
    id: string;
    contact_id: string | null;
    started_at: string;
    answered_at: string | null;
  }>(
    `update voice_calls
        set status = 'ended', end_reason = $3, ended_at = to_timestamp($4 / 1000.0),
            duration_ms = case
              when answered_at is not null then $4 - (extract(epoch from answered_at) * 1000)::bigint
              else null
            end,
            updated_at = now()
      where organization_id = $1 and wacalls_call_id = $2
      returning id, contact_id, started_at, answered_at`,
    [sess.organizationId, ev.id, ev.reason, ev.endedAt],
  );
  const row = rows[0];
  if (!row) {
    log.warn('wacalls: call-ended sem linha correspondente em voice_calls', {
      wacalls_call_id: ev.id,
    });
    return;
  }

  // Perdida = nunca atendida. `end_reason` do upstream não distingue "tocou e
  // ninguém pegou" de "operador recusou" — para o inbox os dois merecem
  // alerta igual: alguém precisa ligar de volta.
  if (!row.answered_at) {
    await pool.query(
      `insert into agent_inbox_items (organization_id, kind, severity, title, body, ref_kind, ref_id)
       values ($1, 'voice_call_missed', 'warn', 'Chamada de voz perdida', $2, 'voice_call', $3)`,
      [sess.organizationId, `Motivo: ${ev.reason}`, row.id],
    );
  }

  await pool.query(
    `insert into event_log (organization_id, event_type, entity_kind, entity_id, payload)
     values ($1, 'voice_call.ended', 'voice_call', $2, $3)`,
    [
      sess.organizationId,
      row.id,
      JSON.stringify({ wacalls_call_id: ev.id, end_reason: ev.reason, answered: !!row.answered_at }),
    ],
  );

  if (row.contact_id) {
    const result = await emitAgentActivityForContact({
      pool,
      organizationId: sess.organizationId,
      contactId: row.contact_id,
      type: 'voice_call',
      reason: `Chamada de voz encerrada (${ev.reason})`,
      sourceModule: 'voice_calls',
      sourceId: row.id,
      payload: { end_reason: ev.reason, answered: !!row.answered_at },
    });
    if (!result.routed) {
      log.info('wacalls: call-ended sem lead aberto, sem atividade', {
        contact_id: row.contact_id,
        reason: result.reason,
      });
    }
  }
}

/** Uma linha SSE `data: {...}` já sem o prefixo — parseada e despachada. */
async function dispatch(
  pool: pg.Pool,
  cache: Map<string, WacallsSessionMap>,
  raw: string,
  log: Logger,
): Promise<void> {
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }
  const type = ev['type'];
  const sessionId = ev['sessionId'];
  if (typeof type !== 'string' || typeof sessionId !== 'string') return;
  // call-list/session-list são snapshots completos pro client React do
  // próprio WaCalls reconectar — não precisamos, nossa fonte de verdade é o
  // incremental abaixo.
  if (type === 'call-list' || type === 'session-list') return;

  const sess = await resolveSession(pool, cache, sessionId);
  if (!sess) return; // sessão de outra instalação/teste — não é nossa

  switch (type) {
    case 'auth-state':
      await handleAuthState(pool, sess, ev as { paired: boolean; state: string; qr?: string }, log);
      return;
    case 'call-status':
      await handleCallStatus(
        pool,
        sess,
        ev as { id: string; status: string; peer: string; direction?: string; startedAt: number },
        log,
      );
      return;
    case 'call-ended':
      await handleCallEnded(pool, sess, ev as { id: string; reason: string; endedAt: number }, log);
      return;
    default:
      // session-qr / incoming / incoming-claimed: pura notificação de UI
      // (§5.2/§5.1 da spec) — sem escrita no banco.
      return;
  }
}

/** Lê a stream SSE linha a linha até fechar/errar; devolve quando o corpo acaba. */
async function pumpSse(
  res: Response,
  pool: pg.Pool,
  cache: Map<string, WacallsSessionMap>,
  log: Logger,
  signal: AbortSignal,
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          await dispatch(pool, cache, payload, log);
        } catch (err) {
          log.error('wacalls: evento falhou ao processar', {
            error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
          });
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Loop de vida: conecta, bombeia até cair, reconecta com backoff exponencial
 * (teto `maxBackoffMs`). Sai só quando `signal` aborta (shutdown do worker).
 */
export async function runVoiceCallsBridgeLoop(
  pool: pg.Pool,
  cfg: WacallsBridgeConfig,
  log: Logger,
  signal: AbortSignal,
): Promise<void> {
  const cache = new Map<string, WacallsSessionMap>();
  let backoffMs = 1000;

  while (!signal.aborted) {
    try {
      const res = await fetch(`${cfg.baseUrl}/api/events`, {
        headers: { 'X-Client-Id': 'deskcomm-worker' },
        signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`wacalls_events_${res.status}`);
      }
      log.info('wacalls: conectado ao stream de eventos', {});
      backoffMs = 1000; // conexão boa — reseta o backoff
      await pumpSse(res, pool, cache, log, signal);
      if (signal.aborted) return;
      log.warn('wacalls: stream de eventos caiu, reconectando', {});
    } catch (err) {
      if (signal.aborted) return;
      log.error('wacalls: conexão ao stream de eventos falhou', {
        error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
        next_retry_ms: backoffMs,
      });
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, backoffMs);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
    backoffMs = Math.min(backoffMs * 2, cfg.maxBackoffMs);
  }
}
