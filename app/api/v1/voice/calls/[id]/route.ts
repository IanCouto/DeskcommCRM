/**
 * DELETE /api/v1/voice/calls/[id] — encerra uma chamada ativa (§5.3).
 * O fechamento definitivo de `voice_calls` (status/duration/end_reason) é
 * feito pela ponte de eventos do worker ao receber `call-ended` via SSE
 * (§4.2 da spec) — esta rota só pede pro WaCalls desligar.
 */
import { randomUUID } from "node:crypto";

import { noContent, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { getWacallsClient, wacallsFriendlyError } from "@/lib/wacalls/client";
import { resolveVoiceCall } from "@/lib/wacalls/calls";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  const authz = await requireRole("agent", { requestId, resource: "voice_calls" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const wacalls = getWacallsClient();
  if (!wacalls) return fail("wacalls_not_configured", "Chamada de voz não configurada.", 503, { requestId });

  const supabase = await createClient();
  const call = await resolveVoiceCall(supabase, activeOrg.orgId, id);
  if (!call) return fail("not_found", "Chamada não encontrada.", 404, { requestId });

  try {
    await wacalls.endCall(call.wacallsSessionId, call.wacallsCallId);
    return noContent(requestId);
  } catch (err) {
    return fail("wacalls_error", wacallsFriendlyError(err), 502, { requestId });
  }
}
