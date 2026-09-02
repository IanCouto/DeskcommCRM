import { timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

/**
 * Segredos que autenticam `/api/v1/cron/*`, o relógio e o agente do host.
 *
 * A Vercel manda `Authorization: Bearer $CRON_SECRET` em cada tick nativo.
 * Os handlers olhavam só INTERNAL_CRON_SECRET|INTERNAL_SECRET; se o dashboard
 * não copiasse o valor, o tick chegava e saía 403 sem fazer o trabalho.
 */
export function segredosDeCron(): string[] {
  return [env.CRON_SECRET, env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(
    (s): s is string => Boolean(s),
  );
}

export function bearerDeCron(req: { headers: Headers }): string {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  return bearer || (req.headers.get("x-cron-secret")?.trim() ?? "");
}

function confereEmTempoConstante(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cronAutorizado(req: { headers: Headers }): boolean {
  const provided = bearerDeCron(req);
  if (!provided) return false;
  const aceitos = segredosDeCron();
  if (aceitos.length === 0) return false;
  return aceitos.some((esperado) => confereEmTempoConstante(provided, esperado));
}
