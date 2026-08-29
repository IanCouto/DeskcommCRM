/**
 * Enrollment vivo cala o turno LLM — o fluxo manda na conversa até handoff/fim.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";

const LIVE = ["active", "waiting_reply"] as const;

export async function contatoTemFollowupVivo(
  admin: SupabaseClient,
  organizationId: string,
  contactId: string,
): Promise<boolean> {
  const { count, error } = await admin
    .from("followup_enrollments")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .in("status", [...LIVE]);
  if (error) return false;
  return (count ?? 0) > 0;
}

/** Versão pg (agent-engine). */
export async function contatoTemFollowupVivoPg(
  pool: pg.Pool,
  tenantId: string,
  contactId: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ n: string }>(
    `select count(*)::text as n from followup_enrollments
     where organization_id = $1 and contact_id = $2
       and status = any($3::text[])`,
    [tenantId, contactId, [...LIVE]],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}
