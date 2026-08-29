/**
 * Aplica os presets Recepção + Retorno numa organização (uma vez).
 * Uso:
 *   pnpm exec tsx --env-file=.env.local scripts/aplicar-fluxos-recepcao-retorno.ts <organization_id>
 *
 * Também habilita os dois pointers em todo agente publicado da org.
 */
import { createClient } from "@supabase/supabase-js";

import { grafoRecepcao, grafoRetorno } from "../lib/followup/presets/recepcao-retorno";
import { publishFollowupFlowVersion } from "../lib/followup/publish";
import { validateFlowForPublish } from "../lib/followup/validate-publish";

async function main() {
  const orgId = process.argv[2];
  if (!orgId) {
    console.error(
      "Uso: tsx --env-file=.env.local scripts/aplicar-fluxos-recepcao-retorno.ts <organization_id>",
    );
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: member } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", orgId)
    .limit(1)
    .maybeSingle();
  const createdBy = member?.user_id as string | undefined;
  if (!createdBy) {
    console.error("Nenhum usuário na org para created_by do versionamento.");
    process.exit(1);
  }

  const fluxos = [
    {
      name: "Recepção",
      trigger: { kind: "first_contact" as const },
      handoff_policy: "cancel" as const,
      graph: grafoRecepcao(),
    },
    {
      name: "Retorno após 24h",
      trigger: {
        kind: "returning_after_silence" as const,
        params: { threshold_minutes: 1440 },
      },
      handoff_policy: "cancel" as const,
      graph: grafoRetorno(),
    },
  ];

  const pointerIds: string[] = [];

  for (const f of fluxos) {
    const v = validateFlowForPublish(f.graph);
    if (!v.ok) {
      console.error(`Grafo inválido (${f.name}):`, v.errors);
      process.exit(1);
    }

    const { data: existing } = await admin
      .from("followup_flow_pointers")
      .select("id")
      .eq("organization_id", orgId)
      .eq("name", f.name)
      .maybeSingle();

    let pointerId = existing?.id as string | undefined;
    if (!pointerId) {
      const { data: created, error } = await admin
        .from("followup_flow_pointers")
        .insert({
          organization_id: orgId,
          name: f.name,
          status: "draft",
          draft_graph: f.graph,
          trigger_config: f.trigger,
          handoff_policy: f.handoff_policy,
        })
        .select("id")
        .single();
      if (error || !created) {
        console.error("criar pointer", f.name, error?.message);
        process.exit(1);
      }
      pointerId = created.id;
    } else {
      await admin
        .from("followup_flow_pointers")
        .update({
          draft_graph: f.graph,
          trigger_config: f.trigger,
          handoff_policy: f.handoff_policy,
        })
        .eq("id", pointerId)
        .eq("organization_id", orgId);
    }

    const published = await publishFollowupFlowVersion(admin, {
      orgId,
      pointerId: pointerId!,
      graph: f.graph,
      createdBy,
    });
    if (!published.ok) {
      console.error("publish", f.name, published.message);
      process.exit(1);
    }
    console.log(`OK ${f.name} → pointer ${pointerId} version ${published.version_id}`);
    pointerIds.push(pointerId!);
  }

  const { data: versions } = await admin
    .from("ai_agent_versions")
    .select("id, agent_id, followup")
    .eq("organization_id", orgId)
    .eq("status", "published");

  if (!versions?.length) {
    // Org ainda no agente legado (rag_bot sem ai_agent_versions): o gate
    // automático só lê versões publicadas. Cria uma versão mínima publicada
    // apontando para a sessão WORKING, com os dois fluxos armados.
    const { data: agent } = await admin
      .from("ai_agents")
      .select("id, system_prompt, model, created_by")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("is_default", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: session } = await admin
      .from("channel_sessions")
      .select("id")
      .eq("organization_id", orgId)
      .eq("status", "WORKING")
      .limit(1)
      .maybeSingle();
    if (!agent || !session) {
      console.warn(
        "Sem agente/sessão WORKING — fluxos publicados, mas o gate automático fica off até publicar um agente.",
      );
    } else {
      const modelRaw = String(agent.model ?? "anthropic/claude-sonnet-4-6");
      const slash = modelRaw.indexOf("/");
      const provider = slash > 0 ? modelRaw.slice(0, slash) : "anthropic";
      const model = slash > 0 ? modelRaw.slice(slash + 1) : modelRaw;
      const { data: ver, error: verErr } = await admin
        .from("ai_agent_versions")
        .insert({
          organization_id: orgId,
          agent_id: agent.id,
          version_number: 1,
          status: "published",
          published_at: new Date().toISOString(),
          system_prompt: agent.system_prompt || "Você é o atendente virtual da clínica.",
          provider,
          model,
          credential_id: null,
          channel_session_id: session.id,
          tool_ids: [],
          followup: { enabled: true, flow_pointer_ids: pointerIds },
          created_by: createdBy,
        })
        .select("id")
        .single();
      if (verErr || !ver) {
        console.error("criar versão do agente", verErr?.message);
        process.exit(1);
      }
      await admin
        .from("ai_agents")
        .update({
          published_version_id: ver.id,
          kind: "mcp_agent",
          updated_at: new Date().toISOString(),
        })
        .eq("id", agent.id)
        .eq("organization_id", orgId);
      console.log(`Agente ${agent.id}: versão publicada ${ver.id} com followup`);
    }
  } else {
    for (const ver of versions) {
      const fu =
        ver.followup && typeof ver.followup === "object" && !Array.isArray(ver.followup)
          ? { ...(ver.followup as Record<string, unknown>) }
          : {};
      const ids = Array.isArray(fu.flow_pointer_ids)
        ? [...(fu.flow_pointer_ids as string[])]
        : [];
      for (const id of pointerIds) {
        if (!ids.includes(id)) ids.push(id);
      }
      await admin
        .from("ai_agent_versions")
        .update({ followup: { ...fu, enabled: true, flow_pointer_ids: ids } })
        .eq("id", ver.id)
        .eq("organization_id", orgId);
      console.log(`Agente ${ver.agent_id}: followup enabled + ${ids.length} fluxo(s)`);
    }
  }

  console.log("Pronto.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
