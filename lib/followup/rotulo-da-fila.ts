/** Rótulo da fila gravado pelo handoff de follow-up (`conversations.metadata`). */
export function rotuloDaFilaDoFollowup(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const label = (metadata as Record<string, unknown>).followup_queue_label;
  if (typeof label !== "string") return null;
  const t = label.trim();
  return t.length > 0 ? t : null;
}
