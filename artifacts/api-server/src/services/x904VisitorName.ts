/** Name of the person borrowing a VIS card, not the immutable device user name. */
export function normalizeX904VisitorName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 100) return null;
  if (!/^[\p{L}\p{M}\p{N} .'-]+$/u.test(name)) return null;
  return name;
}
