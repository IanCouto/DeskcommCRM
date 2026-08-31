/**
 * Dispara a ida ao Google DEPOIS da resposta HTTP.
 *
 * Publicar no POST faria a pessoa esperar o Google para ver "marcado", e faria
 * a marcação falhar quando o Google estiver fora — a linha no CRM é a que
 * importa. `after()` do Next corre depois do 201: a grade já pintou, e a ida
 * tenta. Se o Google recusar, `needs_google_push` continua true e o relógio
 * (Hobby) ou o cron (VPS) retenta.
 *
 * ─── Por que isto existe, além do cron ───────────────────────────────────
 *
 * No self-host o `scheduler` chama `agenda-google-push` a cada 5 min. No Hobby
 * da Vercel esse cron NÃO RODA: o plano aceita 1×/dia, e o `vercel.ts` gasta
 * essa vaga no SLA de LGPD. Medido nos logs de uma instalação Hobby: dezenas
 * de hits em `/app/agenda`, zero em `/api/v1/cron/agenda-google-push`.
 * Compromisso nascia no CRM e nunca saía.
 */
import { after } from "next/server";

import { empurrarAgendamentosAoGoogle } from "@/app/api/v1/cron/agenda-google-push/route";
import { renovarAgendasDoGoogle } from "@/app/api/v1/cron/agenda-google-refresh/route";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export async function correrIdaAoGoogle(): Promise<void> {
  const admin = createAdminClient();
  // Token do Google vive ~1h. Sem o cron de refresh (também fora do Hobby),
  // empurrar com o access_token vencido devolve 401 e a linha fica pendente
  // para sempre. Renovar primeiro é o que o scheduler já faz em cadências
  // separadas; aqui as duas cabem no mesmo `after()`.
  await renovarAgendasDoGoogle(admin, { agora: new Date() });
  await empurrarAgendamentosAoGoogle(admin);
}

export function agendarIdaAoGoogleAposResposta(): void {
  after(async () => {
    try {
      await correrIdaAoGoogle();
    } catch (err) {
      logger.warn("[agenda] ida ao Google após a marcação falhou", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
