/**
 * Grafos prontos dos fluxos Recepção e Retorno (clínica).
 * Não são seed global — aplicar na org via API/construtor + habilitar no agente.
 */
import type { FlowGraph } from "@/lib/followup/graph-schema";

const INATIVIDADE =
  "Esta conversa ficou inativa. O atendimento será redirecionado para a secretária da Dra. Gabrielle.";

const MS_24H = 86_400_000;

/** Fluxo 1 — primeiro contato no WhatsApp. */
export function grafoRecepcao(): FlowGraph {
  return {
    nodes: [
      {
        id: "t1",
        type: "trigger",
        label: "Primeiro contato",
        position: { x: 0, y: 0 },
        config: {},
      },
      {
        id: "c_nome",
        type: "condition",
        label: "Tem nome?",
        position: { x: 220, y: 0 },
        config: {
          combinator: "and",
          branching: "combined",
          checks: [{ id: "chk_nome", label: "sem nome", field: "contact_name", op: "eq", value: "" }],
        },
      },
      {
        id: "a_ola_nome",
        type: "action",
        label: "Acolhida com nome",
        position: { x: 440, y: -120 },
        config: {
          mode: "text",
          body: "Olá, {{primeiro_nome}}! Seja bem-vindo(a).",
        },
      },
      {
        id: "a_ola_sem",
        type: "action",
        label: "Acolhida sem nome",
        position: { x: 440, y: 120 },
        config: { mode: "text", body: "Olá! Seja bem-vindo(a)." },
      },
      {
        id: "a_pede_nome",
        type: "action",
        label: "Pedir nome",
        position: { x: 660, y: 120 },
        config: { mode: "text", body: "Qual é o seu nome?" },
      },
      {
        id: "m_nome",
        type: "match_reply",
        label: "Guardar nome",
        position: { x: 880, y: 120 },
        config: {
          branches: [{ id: "qualquer", label: "Resposta", op: "contains", pattern: " " }],
          grace_timeout_ms: MS_24H,
          save_to: { kind: "contact_name" },
          if_exists: "overwrite",
        },
      },
      {
        id: "a_ajuda",
        type: "action",
        label: "Como posso ajudar?",
        position: { x: 1100, y: 0 },
        config: { mode: "text", body: "Como posso ajudar?" },
      },
      {
        id: "a_fila",
        type: "action",
        label: "Fila — Recepção",
        position: { x: 1320, y: 0 },
        config: { mode: "handoff", queue_label: "Recepção", inactivity_message: INATIVIDADE },
      },
      {
        id: "a_inativ",
        type: "action",
        label: "Aviso inatividade",
        position: { x: 1100, y: 280 },
        config: { mode: "text", body: INATIVIDADE },
      },
      {
        id: "a_fila_inativ",
        type: "action",
        label: "Fila — Inatividade",
        position: { x: 1320, y: 280 },
        config: { mode: "handoff", queue_label: "Inatividade 24h", inactivity_message: INATIVIDADE },
      },
      {
        id: "end_ok",
        type: "end",
        label: "Fim",
        position: { x: 1540, y: 0 },
        config: { outcome: "converted" },
      },
      {
        id: "end_inativ",
        type: "end",
        label: "Fim inatividade",
        position: { x: 1540, y: 280 },
        config: { outcome: "exhausted", note: "inatividade 24h" },
      },
    ],
    edges: [
      { id: "e1", source: "t1", target: "c_nome", priority: 0, condition: { type: "always" } },
      // Sem nome (check eq "") → true; com nome → false
      {
        id: "e2",
        source: "c_nome",
        target: "a_ola_sem",
        priority: 0,
        condition: { type: "cond_result", value: true },
      },
      {
        id: "e3",
        source: "c_nome",
        target: "a_ola_nome",
        priority: 0,
        condition: { type: "cond_result", value: false },
      },
      { id: "e4", source: "a_ola_nome", target: "a_ajuda", priority: 0, condition: { type: "always" } },
      { id: "e5", source: "a_ola_sem", target: "a_pede_nome", priority: 0, condition: { type: "always" } },
      { id: "e6", source: "a_pede_nome", target: "m_nome", priority: 0, condition: { type: "always" } },
      // Qualquer texto: ramo declarado + Sempre (save_to grava o nome)
      {
        id: "e7a",
        source: "m_nome",
        target: "a_ajuda",
        priority: 0,
        condition: { type: "branch", branch_id: "qualquer" },
      },
      { id: "e7", source: "m_nome", target: "a_ajuda", priority: 1, condition: { type: "always" } },
      {
        id: "e8",
        source: "m_nome",
        target: "a_inativ",
        priority: 0,
        condition: { type: "branch", branch_id: "no_reply" },
      },
      { id: "e9", source: "a_ajuda", target: "a_fila", priority: 0, condition: { type: "always" } },
      { id: "e10", source: "a_fila", target: "end_ok", priority: 0, condition: { type: "always" } },
      { id: "e11", source: "a_inativ", target: "a_fila_inativ", priority: 0, condition: { type: "always" } },
      { id: "e12", source: "a_fila_inativ", target: "end_inativ", priority: 0, condition: { type: "always" } },
    ],
  };
}

/** Fluxo 2 — retorno após ≥24h sem inbound. */
export function grafoRetorno(): FlowGraph {
  return {
    nodes: [
      {
        id: "t1",
        type: "trigger",
        label: "Retorno",
        position: { x: 0, y: 0 },
        config: {},
      },
      {
        id: "a_obrigado",
        type: "action",
        label: "Agradecer",
        position: { x: 220, y: 0 },
        config: { mode: "text", body: "Obrigado por entrar em contato!" },
      },
      {
        id: "a_escolhas",
        type: "action",
        label: "Filtro de opções",
        position: { x: 440, y: 0 },
        config: {
          mode: "choices",
          body: "Como podemos ajudar?",
          buttons: [
            { id: "agendar", text: "Agendar consulta" },
            { id: "duvida", text: "Esclarecer dúvida" },
            { id: "outro", text: "Outro" },
          ],
        },
      },
      {
        id: "m_escolha",
        type: "match_reply",
        label: "Casar escolha",
        position: { x: 660, y: 0 },
        config: {
          branches: [
            { id: "agendar", label: "Agendar consulta", op: "eq", pattern: "1" },
            { id: "duvida", label: "Esclarecer dúvida", op: "eq", pattern: "2" },
            { id: "outro", label: "Outro", op: "eq", pattern: "3" },
          ],
          grace_timeout_ms: MS_24H,
        },
      },
      {
        id: "h_agendar",
        type: "action",
        label: "Fila — Agendar",
        position: { x: 880, y: -160 },
        config: { mode: "handoff", queue_label: "Agendar consulta", inactivity_message: INATIVIDADE },
      },
      {
        id: "h_duvida",
        type: "action",
        label: "Fila — Dúvida",
        position: { x: 880, y: 0 },
        config: {
          mode: "handoff",
          queue_label: "Esclarecer dúvida com a Dra. Gabrielle",
          inactivity_message: INATIVIDADE,
        },
      },
      {
        id: "h_outro",
        type: "action",
        label: "Fila — Outro",
        position: { x: 880, y: 160 },
        config: { mode: "handoff", queue_label: "Outro", inactivity_message: INATIVIDADE },
      },
      {
        id: "a_inativ",
        type: "action",
        label: "Aviso inatividade",
        position: { x: 880, y: 320 },
        config: { mode: "text", body: INATIVIDADE },
      },
      {
        id: "h_inativ",
        type: "action",
        label: "Fila — Inatividade",
        position: { x: 1100, y: 320 },
        config: { mode: "handoff", queue_label: "Inatividade 24h", inactivity_message: INATIVIDADE },
      },
      {
        id: "end_ok",
        type: "end",
        label: "Fim",
        position: { x: 1100, y: 0 },
        config: { outcome: "converted" },
      },
      {
        id: "end_inativ",
        type: "end",
        label: "Fim inatividade",
        position: { x: 1320, y: 320 },
        config: { outcome: "exhausted", note: "inatividade 24h" },
      },
    ],
    edges: [
      { id: "e1", source: "t1", target: "a_obrigado", priority: 0, condition: { type: "always" } },
      { id: "e2", source: "a_obrigado", target: "a_escolhas", priority: 0, condition: { type: "always" } },
      { id: "e3", source: "a_escolhas", target: "m_escolha", priority: 0, condition: { type: "always" } },
      {
        id: "e4",
        source: "m_escolha",
        target: "h_agendar",
        priority: 0,
        condition: { type: "branch", branch_id: "agendar" },
      },
      {
        id: "e5",
        source: "m_escolha",
        target: "h_duvida",
        priority: 0,
        condition: { type: "branch", branch_id: "duvida" },
      },
      {
        id: "e6",
        source: "m_escolha",
        target: "h_outro",
        priority: 0,
        condition: { type: "branch", branch_id: "outro" },
      },
      {
        id: "e7",
        source: "m_escolha",
        target: "a_inativ",
        priority: 0,
        condition: { type: "branch", branch_id: "no_reply" },
      },
      // Fallback else → outro
      { id: "e8", source: "m_escolha", target: "h_outro", priority: 1, condition: { type: "always" } },
      { id: "e9", source: "h_agendar", target: "end_ok", priority: 0, condition: { type: "always" } },
      { id: "e10", source: "h_duvida", target: "end_ok", priority: 0, condition: { type: "always" } },
      { id: "e11", source: "h_outro", target: "end_ok", priority: 0, condition: { type: "always" } },
      { id: "e12", source: "a_inativ", target: "h_inativ", priority: 0, condition: { type: "always" } },
      { id: "e13", source: "h_inativ", target: "end_inativ", priority: 0, condition: { type: "always" } },
    ],
  };
}
