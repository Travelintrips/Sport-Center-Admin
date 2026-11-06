/** User-facing Indonesian rupiah input, backed by an unformatted digit-only value. */
export function normalizeKasbonAmount(value: string): string {
  // Dot is a thousands separator in id-ID; never send it to the API.
  return value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}
export function formatKasbonAmount(value: string): string {
  const raw = normalizeKasbonAmount(value);
  return raw ? raw.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "";
}
export function fromDatabaseKasbonAmount(value: string): string {
  // PostgreSQL numeric(15,2) returns, e.g., "1000000.00".
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error("Nominal kasbon database tidak valid");
  }
  return String(amount);
}
