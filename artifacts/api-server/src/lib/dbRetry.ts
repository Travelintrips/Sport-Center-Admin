const TRANSIENT_DB_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "08000",
  "08003",
  "08006",
  "57P01",
  "57P02",
  "57P03",
]);

export function isTransientDbError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message = typeof candidate?.message === "string" ? candidate.message : String(error ?? "");

  return (
    TRANSIENT_DB_CODES.has(code) ||
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|connection terminated|server closed the connection|ECIRCUITBREAKER|EMAXCONNSESSION|max clients reached|checkout failed/i.test(message)
  );
}

export async function withTransientDbRetry<T>(
  operation: () => Promise<T>,
  attempts = 2,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }

  throw lastError;
}
