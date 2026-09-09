"use server";
/**
 * Server Action: accept a team invite token.
 *
 * Steps:
 *   1. Verify HMAC token (signature + expiry).
 *   2. Get current authenticated user from cookie session.
 *   3. Email mismatch → return error (UI tells user to sign out / use the right account).
 *   4. INSERT user_organizations (organization_id, user_id, role, accepted_at, invited_by assinado).
 *      Replay preserva vínculo ativo; revogado exige convite posterior à revogação.
 *   5. Audit `member.accepted` and redirect to /app/inbox.
 */
import { readSupportContext } from "@/lib/impersonate/support";
import { cookies } from "next/headers";
import { cookieSecure } from "@/lib/supabase/cookie-secure";
import { redirect } from "next/navigation";

import { audit } from "@/lib/audit";
import { verifyInviteToken } from "@/lib/auth/invite-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type AcceptInviteResult =
  | { ok: true }
  | {
      ok: false;
      error: "invalid_or_expired" | "email_mismatch" | "not_authenticated" | "internal_error";
      message?: string;
      expectedEmail?: string;
    };

export async function acceptInviteAction(token: string): Promise<AcceptInviteResult> {
  const payload = verifyInviteToken(token);
  if (!payload) return { ok: false, error: "invalid_or_expired" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not_authenticated" };

  if (await readSupportContext(supabase))
    return {
      ok: false,
      error: "internal_error",
      message: "Saia do acompanhamento antes de aceitar o convite.",
    };
  const userEmail = (user.email ?? "").trim().toLowerCase();
  const inviteEmail = payload.email.trim().toLowerCase();
  if (userEmail !== inviteEmail) {
    return { ok: false, error: "email_mismatch", expectedEmail: payload.email };
  }

  const admin = createAdminClient();

  // Convite REVOGADO na tela de Equipe (migration 0232): o token ainda tem
  // assinatura e validade boas, mas a linha diz que foi cancelado. Sem linha
  // (convite antigo, ou instalação sem service-role no envio) segue o fluxo —
  // a checagem de revogação de MEMBERSHIP no `fn_accept_team_invite` continua.
  const { data: conviteRow } = await admin
    .from("team_invites")
    .select("revoked_at")
    .eq("id", payload.invite_id)
    .eq("organization_id", payload.organization_id)
    .maybeSingle();
  if (conviteRow?.revoked_at) return { ok: false, error: "invalid_or_expired" };

  // Org/papel/convidador vêm exclusivamente do token assinado; usuário do JWT.
  const { data: result, error } = await admin.rpc("fn_accept_team_invite", {
    p_interface_settings: payload.interface_settings ?? { preset: "completa" },
    p_user: user.id,
    p_org: payload.organization_id,
    p_role: payload.role,
    p_invited_by: payload.invited_by ?? null,
    p_issued_at: payload.iat ? new Date(payload.iat * 1000).toISOString() : null,
    p_invited_at: new Date((payload.iat ?? payload.exp - 86400) * 1000).toISOString(),
  });
  if (error)
    return { ok: false, error: error.code === "42501" ? "invalid_or_expired" : "internal_error" };
  if (result.changed) {
    await audit({
      action: "member.accepted",
      actorUserId: user.id,
      organizationId: payload.organization_id,
      resourceType: "membership",
      resourceId: result.id,
      metadata: { invite_id: payload.invite_id, role: payload.role },
    });
  }

  // Fecha o convite na tela de Equipe. Idempotente: `is("accepted_at", null)`
  // faz o replay do mesmo token não mexer em nada.
  await admin
    .from("team_invites")
    .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
    .eq("id", payload.invite_id)
    .eq("organization_id", payload.organization_id)
    .is("accepted_at", null)
    .is("revoked_at", null);
  (await cookies()).set("active_org", payload.organization_id, {
    httpOnly: true,
    sameSite: "strict",
    secure: cookieSecure(),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/app");
}
