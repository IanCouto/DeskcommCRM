/**
 * POST /api/v1/voice/calls — inicia chamada de voz outbound (§5.1 da spec).
 *
 * Body: `{ contactId }`. O telefone NUNCA vem do frontend — é lido do
 * contato, escopado pela org, igual todo resto do sistema resolve
 * destinatário a partir de dado próprio, nunca do que o cliente mandou.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { getWacallsClient, wacallsFriendlyError } from "@/lib/wacalls/client";
import { resolveWacallsSession } from "@/lib/wacalls/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ contactId: z.string().uuid() });

export async function POST(req: Request): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("agent", { requestId, resource: "voice_calls" });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("invalid_body", "contactId é obrigatório (uuid).", 400, { requestId });
  }

  const wacalls = getWacallsClient();
  if (!wacalls) {
    return fail("wacalls_not_configured", "Chamada de voz não está configurada.", 503, { requestId });
  }

  const supabase = await createClient();

  const session = await resolveWacallsSession(supabase, activeOrg.orgId);
  if (!session) {
    return fail(
      "wacalls_not_paired",
      "Chamada de voz ainda não foi pareada para esta organização. Configure em Configurações › Canais.",
      409,
      { requestId },
    );
  }

  const { data: contactRaw } = await supabase
    .from("contacts")
    .select("id, phone_number, name")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", parsed.data.contactId)
    .maybeSingle();
  const contact = contactRaw as { id: string; phone_number: string | null; name: string | null } | null;
  if (!contact) return fail("not_found", "Contato não encontrado.", 404, { requestId });
  if (!contact.phone_number) {
    return fail("contact_without_phone", "Este contato não tem telefone cadastrado.", 422, { requestId });
  }

  try {
    const call = await wacalls.startCall(session.wacallsSessionId, user.id, contact.phone_number);

    const { data: inserted, error: insertErr } = await supabase
      .from("voice_calls")
      .insert({
        organization_id: activeOrg.orgId,
        channel_session_id: session.channelSessionId,
        contact_id: contact.id,
        wacalls_call_id: call.callId,
        direction: "outbound",
        peer_phone: contact.phone_number,
        status: "starting",
        created_by: user.id,
      })
      .select("id")
      .single();
    if (insertErr || !inserted) throw new Error(`voice_calls insert: ${insertErr?.message}`);

    return ok(
      { id: (inserted as { id: string }).id, callId: call.callId, status: "starting" },
      { requestId, status: 201 },
    );
  } catch (err) {
    logger.error("wacalls: chamada outbound falhou", {
      request_id: requestId,
      organization_id: activeOrg.orgId,
      contact_id: contact.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return fail("wacalls_error", wacallsFriendlyError(err), 502, { requestId });
  }
}
