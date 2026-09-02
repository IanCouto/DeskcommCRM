/**
 * Centralised handler registration for the event_log dispatcher.
 *
 * Imported by the cron drain route (and the workers entry point) so a single
 * call wires every consumer. Keep it lightweight — no DB calls at import time.
 */

import { aiResponseHandler } from "@/workers/ai-response-worker.handler";
import { aiSentimentHandler } from "@/workers/ai-sentiment-worker.handler";
import { aiHandoffFromSentimentHandler } from "@/workers/ai-handoff-from-sentiment.handler";
import { ragIndexerHandler } from "@/workers/rag-indexer.handler";
import { lgpdExportHandler } from "@/workers/lgpd-export-worker.handler";
import { lgpdRedactHandler } from "@/workers/lgpd-redact-worker.handler";
import { automationRulesHandler } from "@/lib/automation/engine.handler";
import { followupReactivityHandler } from "@/lib/followup/reactivity.handler";
import { followupGatilhoEtapaHandler } from "@/lib/followup/gatilho-etapa.handler";
import { followupGatilhoCasoHandler } from "@/lib/followup/gatilho-caso.handler";
import { mediaPersistHandler } from "@/workers/media-persist-worker.handler";
import { mediaDeriveHandler } from "@/workers/media-derive-worker.handler";
import { webPushInboundHandler } from "@/lib/notifications/push.handler";
import { isAiGatewayConfigured } from "@/lib/ai/gateway";
import { registerHandler, type EventHandler } from "@/lib/event-log/dispatcher";

let _registered = false;

/**
 * Chat da plataforma (response/sentiment/handoff-por-clima) só roda com chave
 * de env. Sem ela, o worker ainda era chamado, devolvia `skipped` com detail e
 * o drain gravava isso em `last_error` — processamento e log à toa. BYOK da
 * org não entra aqui: esses três workers leem o env, não `ai_provider_credentials`.
 * Indexação e derivação de mídia ficam de fora de propósito — resolvem chave
 * por organização.
 */
export function soComIaDaPlataforma(handler: EventHandler): EventHandler {
  return {
    key: handler.key,
    events: handler.events,
    async handle(row) {
      if (!isAiGatewayConfigured()) {
        return { consumer_key: handler.key, status: "skipped" };
      }
      return handler.handle(row);
    },
  };
}

export function ensureHandlersRegistered(): void {
  if (_registered) return;
  // Follow-up de inbound ANTES do LLM: no Hobby o drain da mensagem
  // estourava no worker de IA e o match_reply nunca lia a resposta.
  registerHandler(followupReactivityHandler);
  registerHandler(soComIaDaPlataforma(aiResponseHandler));
  registerHandler(soComIaDaPlataforma(aiSentimentHandler));
  registerHandler(soComIaDaPlataforma(aiHandoffFromSentimentHandler));
  registerHandler(ragIndexerHandler);
  registerHandler(lgpdExportHandler);
  registerHandler(lgpdRedactHandler);
  registerHandler(automationRulesHandler);
  registerHandler(followupGatilhoEtapaHandler);
  registerHandler(followupGatilhoCasoHandler);
  registerHandler(mediaPersistHandler);
  registerHandler(mediaDeriveHandler);
  registerHandler(webPushInboundHandler);
  _registered = true;
}
