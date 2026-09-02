/**
 * Config do projeto na Vercel (forma TS canônica).
 *
 * Crons: a mesma cadência do scheduler self-host (docker/scheduler/entrypoint.sh,
 * TZ=UTC). Hobby só aceita 1x/dia e estoura o deploy com cron de minuto; isto
 * assume Pro.
 *
 * agent-dispatcher fica de fora de propósito: a rota é no-op permanente (Fase 0)
 * e no Pro cada minuto cobra invocação. O self-host ainda a chama para não
 * quebrar crontab antigo.
 *
 * Auth: a Vercel manda Authorization Bearer CRON_SECRET. Os handlers aceitam
 * CRON_SECRET, INTERNAL_CRON_SECRET ou INTERNAL_SECRET (`lib/auth/cron-bearer.ts`).
 */

import type { VercelConfig } from "@vercel/config/v1";

const config: VercelConfig = {
  // Pro: functions no Brasil. Hobby ficava preso em iad1.
  regions: ["gru1"],
  git: {
    // Unspecified branches default to true. Catch-all off; so develop deploys.
    deploymentEnabled: {
      "*": false,
      "**": false,
      develop: true,
    },
  },
  crons: [
    // minuto — fila, follow-up, roteamento, envio preso
    { path: "/api/v1/cron/followup-flow-worker", schedule: "* * * * *" },
    { path: "/api/v1/cron/event-log-drain", schedule: "* * * * *" },
    { path: "/api/v1/cron/routing-worker", schedule: "* * * * *" },
    { path: "/api/v1/cron/recover-stuck-messages", schedule: "* * * * *" },
    // 5 min
    { path: "/api/v1/cron/storage-redaction", schedule: "*/5 * * * *" },
    { path: "/api/v1/cron/snooze-watcher", schedule: "*/5 * * * *" },
    { path: "/api/v1/cron/attendant-heartbeat", schedule: "*/5 * * * *" },
    { path: "/api/v1/cron/webhook-log-retention", schedule: "*/5 * * * *" },
    { path: "/api/v1/cron/channel-health", schedule: "*/5 * * * *" },
    { path: "/api/v1/cron/agenda-google-push", schedule: "*/5 * * * *" },
    // 10 min — token Google vive ~1h; 10 min deixa folga na janela de 15
    { path: "/api/v1/cron/contact-avatars", schedule: "*/10 * * * *" },
    { path: "/api/v1/cron/agenda-google-refresh", schedule: "*/10 * * * *" },
    // 15 min — sync da agenda é caro (um request por calendário)
    { path: "/api/v1/cron/agenda-google-sync", schedule: "*/15 * * * *" },
    { path: "/api/v1/cron/risk-watcher", schedule: "*/15 * * * *" },
    { path: "/api/v1/cron/contact-phones", schedule: "*/30 * * * *" },
    { path: "/api/v1/cron/contact-proposals-watcher", schedule: "17 * * * *" },
    // diários UTC — iguais ao crontab da VPS
    { path: "/api/v1/cron/lgpd-sla-watcher", schedule: "0 12 * * *" },
    { path: "/api/v1/cron/kb-conversations-batch", schedule: "30 3 * * *" },
    { path: "/api/v1/cron/sync-model-catalog", schedule: "15 4 * * *" },
    { path: "/api/v1/cron/data-retention", schedule: "40 4 * * *" },
  ],
  functions: {
    // EPIC-13 S-13.08: ToolLoopAgent runtime can issue multiple tool calls per
    // step. 300s max keeps Fluid Compute within bounds; the runtime's own
    // step/token/cost guards usually finish much earlier.
    "app/api/internal/agents/run/route.ts": { maxDuration: 300 },
  },
};

export default config;
