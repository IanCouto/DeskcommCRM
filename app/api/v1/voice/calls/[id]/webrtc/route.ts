/**
 * POST /api/v1/voice/calls/[id]/webrtc — relay puro do SDP entre o navegador
 * e o WaCalls (§4.1 da spec). A MÍDIA em si (ICE/SRTP) não passa por aqui —
 * só a troca inicial de oferta/resposta.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { getWacallsClient, wacallsFriendlyError } from "@/lib/wacalls/client";
import { resolveVoiceCall } from "@/lib/wacalls/calls";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ sdpOffer: z.string().min(1) });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Acompanhamento administrativo somente-leitura não liga, não atende, não
  // desliga e não pareia: o efeito é do tenant, não de quem observa.
  const suporteNegado = await requireSupportWrite();
  if (suporteNegado) return suporteNegado;

  const requestId = randomUUID();
  const { id } = await params;

  const authz = await requireRole("agent", { requestId, resource: "voice_calls" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("invalid_body", "sdpOffer é obrigatório.", 400, { requestId });

  const wacalls = getWacallsClient();
  if (!wacalls) return fail("wacalls_not_configured", "Chamada de voz não configurada.", 503, { requestId });

  const supabase = await createClient();
  const call = await resolveVoiceCall(supabase, activeOrg.orgId, id);
  if (!call) return fail("not_found", "Chamada não encontrada.", 404, { requestId });

  try {
    const { sdpAnswer } = await wacalls.exchangeWebrtc(
      call.wacallsSessionId,
      call.wacallsCallId,
      parsed.data.sdpOffer,
    );
    return ok({ sdpAnswer }, { requestId });
  } catch (err) {
    return fail("wacalls_error", wacallsFriendlyError(err), 502, { requestId });
  }
}
