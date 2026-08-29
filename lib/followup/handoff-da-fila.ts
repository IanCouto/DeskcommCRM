/**
 * Handoff pedido por um nó de ação `mode=handoff` do follow-up.
 * Rótulo da fila vai em `conversations.metadata.followup_queue_label`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { triggerHandoff } from "@/lib/ai/handoff/orchestrator";
import { ensureConversation, sessaoProntaParaEnvio } from "@/lib/automation/start-conversation";
import { logger } from "@/lib/logger";

export const HANDOFF_REASON_FOLLOWUP = "followup" as const;

const INATIVIDADE_MS = 24 * 60 * 60 * 1000;

export async function handoffDaFilaDoFollowup(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    contactId: string;
    conversationId: string | null;
    queueLabel: string;
    enrollmentId: string;
    /** Mensagem de inatividade a enviar se ninguém falar em 24h. */
    inactivityMessage?: string;
  },
): Promise<{ ok: boolean; conversationId: string | null }> {
  let conversationId = input.conversationId;
  if (!conversationId) {
    const sessionId = await sessaoProntaParaEnvio(admin, input.organizationId);
    if (!sessionId) {
      logger.warn("followup.handoff: sem sessão de canal", {
        organization_id: input.organizationId,
        enrollment_id: input.enrollmentId,
      });
      return { ok: false, conversationId: null };
    }
    conversationId = await ensureConversation(
      admin,
      input.organizationId,
      input.contactId,
      sessionId,
    );
  }

  const { data: conv } = await admin
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  const meta =
    conv?.metadata && typeof conv.metadata === "object" && !Array.isArray(conv.metadata)
      ? { ...(conv.metadata as Record<string, unknown>) }
      : {};
  meta.followup_queue_label = input.queueLabel;
  meta.followup_inactivity_watch_until = new Date(Date.now() + INATIVIDADE_MS).toISOString();
  meta.followup_inactivity_sent = false;
  meta.followup_inactivity_message =
    input.inactivityMessage?.trim() ||
    "Esta conversa ficou inativa. O atendimento será redirecionado para a fila.";

  await admin
    .from("conversations")
    .update({ metadata: meta })
    .eq("id", conversationId)
    .eq("organization_id", input.organizationId);

  const result = await triggerHandoff({
    conversationId,
    organizationId: input.organizationId,
    reason: HANDOFF_REASON_FOLLOWUP,
    metadata: {
      queue_label: input.queueLabel,
      followup_enrollment_id: input.enrollmentId,
    },
  });

  return { ok: result.triggered, conversationId };
}
