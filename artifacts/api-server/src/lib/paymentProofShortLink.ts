import { randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { getBaseUrl } from "./appUrl";
import { logger } from "./logger";

const SHORT_CODE_RE = /^[A-Za-z0-9_-]{8}$/;

export function generatePaymentProofShortCode(): string {
  return randomBytes(6).toString("base64url");
}

export function isValidPaymentProofShortCode(code: string): boolean {
  return SHORT_CODE_RE.test(code);
}

export async function getOrCreatePaymentProofShortUrl(
  proofUrl: string,
): Promise<string> {
  const normalized = String(proofUrl ?? "").trim();
  if (!normalized) return normalized;

  try {
    const existing = await pool.query<{ code: string }>(
      `select code
         from sport_center.payment_proof_short_links
        where proof_url = $1
        limit 1`,
      [normalized],
    );
    const existingCode = existing.rows[0]?.code;
    if (existingCode && isValidPaymentProofShortCode(existingCode)) {
      return `${await getBaseUrl()}/proof/${existingCode}`;
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const code = generatePaymentProofShortCode();
      try {
        const inserted = await pool.query<{ code: string }>(
          `insert into sport_center.payment_proof_short_links (code, proof_url)
           values ($1, $2)
           on conflict (proof_url)
           do update set proof_url = excluded.proof_url
           returning code`,
          [code, normalized],
        );
        const resolvedCode = inserted.rows[0]?.code;
        if (resolvedCode && isValidPaymentProofShortCode(resolvedCode)) {
          return `${await getBaseUrl()}/proof/${resolvedCode}`;
        }
      } catch (error: any) {
        // A random 8-char code collision is extremely unlikely. Retry only
        // for PostgreSQL unique-violation; surface anything else.
        if (error?.code !== "23505") throw error;
      }
    }
  } catch (error) {
    logger.warn({ err: error }, "[proof-short-link] unable to create branded proof URL");
  }

  // Notification delivery is more important than URL branding. If the short
  // link table is temporarily unavailable, retain the original proof URL.
  return normalized;
}

export async function resolvePaymentProofShortUrl(
  code: string,
): Promise<string | null> {
  if (!isValidPaymentProofShortCode(code)) return null;

  const result = await pool.query<{ proof_url: string }>(
    `select proof_url
       from sport_center.payment_proof_short_links
      where code = $1
      limit 1`,
    [code],
  );
  return result.rows[0]?.proof_url ?? null;
}
