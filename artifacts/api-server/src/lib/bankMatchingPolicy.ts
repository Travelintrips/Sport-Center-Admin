/**
 * A rerun replaces only active, unevaluated candidates.
 * Rejected matches remain historical audit evidence and are never reused.
 */
export const REPLACEABLE_MATCH_STATUSES = ["candidate"] as const;

export function isReplaceableMatchOnRerun(status: string): boolean {
  return (REPLACEABLE_MATCH_STATUSES as readonly string[]).includes(status);
}