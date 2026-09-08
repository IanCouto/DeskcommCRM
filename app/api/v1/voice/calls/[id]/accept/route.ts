/**
 * POST /api/v1/voice/calls/[id]/accept — atende uma chamada recebida (§5.2).
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { getWacallsClient, wacallsFriendlyError } from "@/lib/wacalls/client";
import { resolveVoiceCall } from "@/lib/wacalls/calls";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  const authz = await requireRole("agent", { requestId, resource: "voice_calls" });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  const wacalls = getWacallsClient();
  if (!wacalls) return fail("wacalls_not_configured", "Chamada de voz não configurada.", 503, { requestId });

  const supabase = await createClient();
  const call = await resolveVoiceCall(supabase, activeOrg.orgId, id);
  if (!call) return fail("not_found", "Chamada não encontrada.", 404, { requestId });

  if (call.status === "connected") {
    return ok({ id, status: "connected" }, { requestId });
  }

  try {
    await wacalls.acceptCall(call.wacallsSessionId, call.wacallsCallId, user.id);
    return ok({ id, status: "connected" }, { requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("409") || msg.includes("already")) {
      return ok({ id, status: "connected" }, { requestId });
    }
    return fail("wacalls_error", wacallsFriendlyError(err), 502, { requestId });
  }
}
