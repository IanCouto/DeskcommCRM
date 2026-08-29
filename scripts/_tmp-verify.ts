import { createClient } from "@supabase/supabase-js";

async function main() {
  const orgId = "091d0f57-1dae-4b4d-85b6-4613ea08f45d";
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data } = await admin
    .from("ai_agent_versions")
    .select("id, status, followup, agent_id")
    .eq("organization_id", orgId)
    .eq("status", "published");
  console.log(JSON.stringify(data, null, 2));
}

main();
