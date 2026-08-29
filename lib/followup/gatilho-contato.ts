/**
 * Gatilhos de primeiro contato e retorno após silêncio.
 *
 * Disparam na mensagem inbound (event_log `message.received`), NÃO no webhook
 * de criação de contato: o fluxo só começa quando a pessoa escreve.
 *
 * - `first_contact`: 1º inbound da conversa
 * - `returning_after_silence`: houve inbound anterior e o gap ≥ threshold
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createSupabaseFollowupGateDb,
  resolveAgentForAutomaticTrigger,
} from "@/lib/followup/agent-followup-gate";
import { triggerConfigSchema } from "@/lib/followup/api-schemas";
import { flowGraphSchema } from "@/lib/followup/graph-schema";
import { logger } from "@/lib/logger";

export type ContatoTriggerKind = "first_contact" | "returning_after_silence";

export interface GatilhoContatoSummary {
  enrolled: number;
  skipped: number;
}

async function contarInboundsAnteriores(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
  messageId: string | null,
): Promise<{ total: number; penultimoSentAt: string | null }> {
  const { count, error } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound");
  if (error) throw new Error(error.message);
  const total = count ?? 0;

  // Penúltimo: o mais recente que NÃO é a mensagem atual.
  let q = admin
    .from("messages")
    .select("sent_at")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .order("sent_at", { ascending: false })
    .limit(2);
  if (messageId) q = q.neq("id", messageId);
  const { data, error: err2 } = await q;
  if (err2) throw new Error(err2.message);
  // Se filtramos a atual, [0] é o penúltimo; se não, [1] é.
  const penultimo = messageId ? data?.[0] : data?.[1];
  return {
    total,
    penultimoSentAt: typeof penultimo?.sent_at === "string" ? penultimo.sent_at : null,
  };
}

async function enrollPointer(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    pointerId: string;
    versionId: string;
    contactId: string;
    conversationId: string;
    agentId: string | null;
    triggerNodeId: string;
  },
): Promise<boolean> {
  const { error } = await admin.from("followup_enrollments").insert({
    organization_id: input.organizationId,
    pointer_id: input.pointerId,
    version_id: input.versionId,
    contact_id: input.contactId,
    conversation_id: input.conversationId,
    current_node_id: input.triggerNodeId,
    status: "active",
    agent_id: input.agentId,
  });
  if (error) {
    if (error.code === "23505") return false;
    throw new Error(error.message);
  }
  return true;
}

/**
 * Avalia pointers `first_contact` / `returning_after_silence` da org e enrolla
 * no máximo um (exclusividade org-wide já no índice único).
 */
export async function tentarEnrollPorContato(
  admin: SupabaseClient,
  sinal: {
    organizationId: string;
    contactId: string;
    conversationId: string;
    messageId: string | null;
    agora?: Date;
  },
): Promise<GatilhoContatoSummary> {
  const summary: GatilhoContatoSummary = { enrolled: 0, skipped: 0 };
  const agora = sinal.agora ?? new Date();

  const { data: pointers, error } = await admin
    .from("followup_flow_pointers")
    .select("id, active_version_id, trigger_config")
    .eq("organization_id", sinal.organizationId)
    .eq("status", "active")
    .not("active_version_id", "is", null);
  if (error) throw new Error(error.message);

  const { total, penultimoSentAt } = await contarInboundsAnteriores(
    admin,
    sinal.organizationId,
    sinal.conversationId,
    sinal.messageId,
  );

  const gate = createSupabaseFollowupGateDb(admin);

  for (const p of pointers ?? []) {
    const parsed = triggerConfigSchema.safeParse(p.trigger_config ?? { kind: "manual" });
    if (!parsed.success) continue;
    const cfg = parsed.data;
    if (cfg.kind !== "first_contact" && cfg.kind !== "returning_after_silence") continue;

    if (cfg.kind === "first_contact") {
      // total já inclui a mensagem atual.
      if (total !== 1) {
        summary.skipped++;
        continue;
      }
    } else {
      if (total < 2 || !penultimoSentAt) {
        summary.skipped++;
        continue;
      }
      const thresholdMin = cfg.params.threshold_minutes;
      const gapMs = agora.getTime() - new Date(penultimoSentAt).getTime();
      if (gapMs < thresholdMin * 60_000) {
        summary.skipped++;
        continue;
      }
    }

    const agentId = await resolveAgentForAutomaticTrigger(gate, sinal.organizationId, p.id);
    if (!agentId) {
      summary.skipped++;
      continue;
    }

    const { data: version, error: vErr } = await admin
      .from("followup_flow_versions")
      .select("graph")
      .eq("organization_id", sinal.organizationId)
      .eq("id", p.active_version_id!)
      .maybeSingle();
    if (vErr) throw new Error(vErr.message);
    if (!version) {
      summary.skipped++;
      continue;
    }
    const graph = flowGraphSchema.safeParse(version.graph);
    if (!graph.success) {
      summary.skipped++;
      continue;
    }
    const triggerNode = graph.data.nodes.find((n) => n.type === "trigger");
    if (!triggerNode) {
      summary.skipped++;
      continue;
    }

    try {
      const ok = await enrollPointer(admin, {
        organizationId: sinal.organizationId,
        pointerId: p.id,
        versionId: p.active_version_id!,
        contactId: sinal.contactId,
        conversationId: sinal.conversationId,
        agentId,
        triggerNodeId: triggerNode.id,
      });
      if (ok) summary.enrolled++;
      else summary.skipped++;
    } catch (err) {
      logger.warn("followup.gatilho-contato: enroll falhou", {
        organization_id: sinal.organizationId,
        pointer_id: p.id,
        detail: err instanceof Error ? err.message.slice(0, 160) : "desconhecido",
      });
      summary.skipped++;
    }
  }

  return summary;
}
