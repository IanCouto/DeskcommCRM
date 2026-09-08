/**
 * Resolve uma chamada (`voice_calls`) da organização + a sessão WaCalls dona
 * dela, num só round-trip — compartilhado pelas rotas de webrtc/accept/
 * reject/end. O `id` do path é sempre o NOSSO uuid, nunca o `wacalls_call_id`
 * upstream (esse não vaza pro frontend).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface VoiceCallWithSession {
  id: string;
  wacallsCallId: string;
  wacallsSessionId: string;
  status: string;
  contactId: string | null;
}

export async function resolveVoiceCall(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  organizationId: string,
  voiceCallId: string,
): Promise<VoiceCallWithSession | null> {
  const { data } = await supabase
    .from("voice_calls")
    .select("id, wacalls_call_id, status, contact_id, channel_sessions!inner(wacalls_session_id)")
    .eq("organization_id", organizationId)
    .eq("id", voiceCallId)
    .maybeSingle();
  const row = data as {
    id: string;
    wacalls_call_id: string;
    status: string;
    contact_id: string | null;
    channel_sessions: { wacalls_session_id: string | null } | null;
  } | null;
  if (!row?.channel_sessions?.wacalls_session_id) return null;
  return {
    id: row.id,
    wacallsCallId: row.wacalls_call_id,
    wacallsSessionId: row.channel_sessions.wacalls_session_id,
    status: row.status,
    contactId: row.contact_id,
  };
}
