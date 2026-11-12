/**
 * Presentation-only: preserve original description and notes for audit/database.
 * Remove visual duplication but retain distinct supplementary information.
 */
export function presentTransactionNarrative(description: string | null | undefined, notes: string | null | undefined): {
  primary: string;
  additional: string | null;
} {
  const clean = (value: string | null | undefined) => String(value ?? "").trim().replace(/\s+/g, " ");
  const primary = clean(description);
  const note = clean(notes);
  if (!primary && !note) return { primary: "Tidak diisi", additional: null };
  if (!primary) return { primary: note, additional: null };
  if (!note || primary.toLocaleLowerCase("id-ID") === note.toLocaleLowerCase("id-ID"))
    return { primary, additional: null };
  return { primary, additional: note };
}
