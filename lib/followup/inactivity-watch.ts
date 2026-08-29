/**
 * Após handoff do follow-up: conversas `pending` com watch de inatividade.
 * Se ninguém (lead nem humano) falou em 24h, manda a mensagem de inatividade
 * UMA vez — bypass do bot_silenced (só neste caminho).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { logger } from "@/lib/logger";

const MSG_PADRAO =
  "Esta conversa ficou inativa. O atendimento será redirecionado para a fila.";

export interface InactivityWatchSummary {
  scanned: number;
  sent: number;
}

export async function runFollowupInactivityWatch(
  admin: SupabaseClient,
  agora: Date = new Date(),
): Promise<InactivityWatchSummary> {
  const summary: InactivityWatchSummary = { scanned: 0, sent: 0 };
  const agoraIso = agora.toISOString();

  // Postgres jsonb filter: watch_until <= agora e ainda não enviou.
  const { data: rows, error } = await admin
    .from("conversations")
    .select("id, organization_id, contact_id, metadata, last_inbound_at, last_outbound_at")
    .eq("status", "pending")
    .not("metadata->>followup_inactivity_watch_until", "is", null)
    .limit(50);

  if (error) {
    logger.warn("followup.inactivity-watch: query falhou", { detail: error.message.slice(0, 160) });
    return summary;
  }

  for (const conv of rows ?? []) {
    summary.scanned++;
    const meta =
      conv.metadata && typeof conv.metadata === "object" && !Array.isArray(conv.metadata)
        ? { ...(conv.metadata as Record<string, unknown>) }
        : {};
    if (meta.followup_inactivity_sent === true) continue;
    const until = typeof meta.followup_inactivity_watch_until === "string"
      ? meta.followup_inactivity_watch_until
      : null;
    if (!until || until > agoraIso) continue;

    // Alguém falou depois do handoff? Cancela o watch.
    const handoffAt = until; // watch_until = handoff + 24h; se houve atividade recente, aborta
    const lastIn = conv.last_inbound_at as string | null;
    const lastOut = conv.last_outbound_at as string | null;
    // Se houve inbound/outbound humano depois de (watch_until - 24h) ≈ handoff,
    // não envia. Simplificação: se last activity > (agora - 24h) e status pending
    // com watch vencido, ainda assim se last_inbound ou outbound for muito recente
    // (< 1h do agora) pula — atendente já respondeu.
    const recente =
      (lastIn && new Date(lastIn).getTime() > agora.getTime() - 60 * 60 * 1000) ||
      (lastOut && new Date(lastOut).getTime() > agora.getTime() - 60 * 60 * 1000);
    if (recente) {
      meta.followup_inactivity_sent = true;
      await admin
        .from("conversations")
        .update({ metadata: meta })
        .eq("id", conv.id)
        .eq("organization_id", conv.organization_id);
      continue;
    }

    const body =
      typeof meta.followup_inactivity_message === "string" && meta.followup_inactivity_message.trim()
        ? meta.followup_inactivity_message.trim()
        : MSG_PADRAO;

    try {
      // Limpa o silêncio só o suficiente para o handler enviar, depois restaura.
      await admin
        .from("conversations")
        .update({ bot_silenced_until: null })
        .eq("id", conv.id)
        .eq("organization_id", conv.organization_id);

      await sendMessageHandler(
        admin,
        {
          organization_id: conv.organization_id as string,
          actor: { type: "webhook_source", id: "followup-inactivity-watch" },
          requestId: `inactivity:${conv.id}`,
        },
        { conversation_id: conv.id as string, type: "text", body },
      );

      meta.followup_inactivity_sent = true;
      meta.followup_queue_label = "Inatividade 24h";
      await admin
        .from("conversations")
        .update({
          metadata: meta,
          bot_silenced_until: "infinity",
          last_handoff_reason: "followup",
        })
        .eq("id", conv.id)
        .eq("organization_id", conv.organization_id);

      summary.sent++;
    } catch (err) {
      logger.warn("followup.inactivity-watch: envio falhou", {
        conversation_id: conv.id,
        detail: err instanceof Error ? err.message.slice(0, 160) : "desconhecido",
      });
      // Restaura silêncio se o envio falhou.
      await admin
        .from("conversations")
        .update({ bot_silenced_until: "infinity" })
        .eq("id", conv.id)
        .eq("organization_id", conv.organization_id);
    }
  }

  return summary;
}
