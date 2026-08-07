import { Router } from "express";
import crypto from "crypto";
import { db, paylabsSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { loadPaylabsConfigFromDb, normalizeOptionalPaylabsStoreId, normalizePaylabsPublicKey, normalizePaylabsPrivateKey, isPrivateKeyValid } from "../lib/paylabs";
import { logger } from "../lib/logger";

const router = Router();

// ── helpers ───────────────────────────────────────────────────────────────────

async function getOrCreate() {
  const [existing] = await db
    .select()
    .from(paylabsSettingsTable)
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(paylabsSettingsTable)
    .values({})
    .returning();
  return created;
}

// GET /api/admin/paylabs/settings
// SECURITY:
//   - Paylabs public keys (sandboxPublicKey / prodPublicKey) are NEVER returned — only boolean flags.
//   - Merchant private keys are NEVER returned — only boolean flags indicating whether a valid key exists.
//     The admin UI uses a badge + explicit "Set / Ganti" button flow; private keys are write-only.
router.get("/admin/paylabs/settings", adminMiddleware, async (req, res) => {
  try {
    const config = await getOrCreate();

    // Effective values (DB takes priority, env vars are fallback for seeds)
    const sandboxPublicKeyEffective  = config.sandboxPublicKey  || process.env.PAYLABS_SANDBOX_PUBLIC_KEY  || "";
    const prodPublicKeyEffective     = config.prodPublicKey     || process.env.PAYLABS_PROD_PUBLIC_KEY     || "";

    // For private keys: check DB first, then env var. Validate with crypto to detect corrupted/masked values.
    const sandboxPrivateKeyRaw = config.sandboxPrivateKey || process.env.PAYLABS_SANDBOX_PRIVATE_KEY || "";
    const prodPrivateKeyRaw    = config.prodPrivateKey    || process.env.PAYLABS_PROD_PRIVATE_KEY    || "";

    const merged = {
      ...config,
      sandboxMerchantId: config.sandboxMerchantId || process.env.PAYLABS_SANDBOX_MERCHANT_ID || "",
      prodMerchantId:    config.prodMerchantId    || process.env.PAYLABS_PROD_MERCHANT_ID    || "",
      storeId:           config.storeId           || process.env.PAYLABS_STORE_ID            || "",
      // NEVER return private keys to the client — write-only, validated before storing
      sandboxPrivateKey: undefined,
      prodPrivateKey:    undefined,
      sandboxPrivateKeyConfigured: isPrivateKeyValid(sandboxPrivateKeyRaw),
      productionPrivateKeyConfigured: isPrivateKeyValid(prodPrivateKeyRaw),
      // Redact public keys — send only configured status
      sandboxPublicKey: undefined,
      prodPublicKey:    undefined,
      sandboxPublicKeyConfigured: Boolean(sandboxPublicKeyEffective.trim()),
      prodPublicKeyConfigured:    Boolean(prodPublicKeyEffective.trim()),
    };

    res.json(merged);
  } catch (err) {
    req.log.error({ err }, "GET paylabs settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/paylabs/test-config
// Diagnostic: shows effective config (merchant IDs, key lengths, key format) without exposing the raw keys.
// Also attempts a test sign to confirm the private key is valid.
router.get("/admin/paylabs/test-config", adminMiddleware, async (req, res) => {
  try {
    const cfg = await loadPaylabsConfigFromDb();

    function keyInfo(key: string) {
      if (!key) return { present: false, length: 0, format: "empty" };
      // Normalise literal \n
      const normalized = key.trim().replace(/\\n/g, "\n").replace(/\\r/g, "");
      const hasPem = normalized.includes("-----BEGIN");
      const base64 = normalized.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
      return {
        present : true,
        rawLength: key.length,
        base64Length: base64.length,
        hasPemHeader: hasPem,
        format: hasPem
          ? (normalized.includes("RSA PRIVATE KEY") ? "PKCS#1 PEM" :
             normalized.includes("PRIVATE KEY")     ? "PKCS#8 PEM" :
             normalized.includes("PUBLIC KEY")      ? "PUBLIC PEM"  : "PEM (unknown)")
          : "raw base64",
        firstChars: base64.slice(0, 12) + "…",
      };
    }

    // Attempt a test sign with the effective private key
    let signTest: { ok: boolean; method?: string; error?: string } = { ok: false };
    if (cfg.privateKey) {
      const testPayload = "TEST:sign:check:2026-01-01T00:00:00.000+07:00";
      const raw = cfg.privateKey.trim().replace(/\\n/g, "\n").replace(/\\r/g, "");
      const base64 = raw.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
      const body64 = (base64.match(/.{1,64}/g) ?? [base64]).join("\n");
      const derBuf  = Buffer.from(base64, "base64");
      const attempts: Array<[string, () => crypto.KeyObject]> = [
        ["pkcs8-pem-explicit",  () => crypto.createPrivateKey({ key: `-----BEGIN PRIVATE KEY-----\n${body64}\n-----END PRIVATE KEY-----`,     format: "pem", type: "pkcs8" })],
        ["pkcs1-pem-explicit",  () => crypto.createPrivateKey({ key: `-----BEGIN RSA PRIVATE KEY-----\n${body64}\n-----END RSA PRIVATE KEY-----`, format: "pem", type: "pkcs1" })],
        ...(raw.includes("-----BEGIN") ? [["raw-auto", () => crypto.createPrivateKey(raw)] as [string, () => crypto.KeyObject]] : []),
        ["pkcs8-der",           () => crypto.createPrivateKey({ key: derBuf, format: "der", type: "pkcs8" })],
        ["pkcs1-der",           () => crypto.createPrivateKey({ key: derBuf, format: "der", type: "pkcs1" })],
      ];
      const errs: string[] = [];
      for (const [label, attempt] of attempts) {
        try {
          const keyObj = attempt();
          const s = crypto.createSign("RSA-SHA256");
          s.update(testPayload, "utf8");
          s.sign(keyObj, "base64");
          signTest = { ok: true, method: label };
          break;
        } catch (e) {
          errs.push(`[${label}] ${String(e).split("\n")[0]}`);
        }
      }
      if (!signTest.ok) signTest.error = errs.join(" | ");
    }

    res.json({
      sandboxMode        : cfg.sandboxMode,
      effectiveMerchantId: cfg.merchantId,
      sandboxMerchantId  : cfg.merchantId,   // same as above when sandboxMode=true
      prodMerchantId     : cfg.merchantId,   // same as above when sandboxMode=false
      storeId            : cfg.storeId || "(not set)",
      privateKey         : keyInfo(cfg.privateKey),
      publicKey          : keyInfo(cfg.paylabsPublicKey),
      signTest,
      envOverrides: {
        PAYLABS_SANDBOX_MERCHANT_ID: !!process.env.PAYLABS_SANDBOX_MERCHANT_ID,
        PAYLABS_PROD_MERCHANT_ID   : !!process.env.PAYLABS_PROD_MERCHANT_ID,
        PAYLABS_SANDBOX_PRIVATE_KEY: !!process.env.PAYLABS_SANDBOX_PRIVATE_KEY,
        PAYLABS_PROD_PRIVATE_KEY   : !!process.env.PAYLABS_PROD_PRIVATE_KEY,
      },
    });
  } catch (err) {
    req.log.error({ err }, "GET paylabs test-config error");
    res.status(500).json({ error: String(err) });
  }
});

// PATCH /api/admin/paylabs/settings
// NOTE: sandboxPublicKey / prodPublicKey are Paylabs-owned public keys used for
// VERIFYING webhook signatures (not merchant keys). They are normalized here
// and stored, but never returned to the client in GET (only boolean flags are sent).
router.patch("/admin/paylabs/settings", adminMiddleware, async (req, res) => {
  try {
    const current = await getOrCreate();

    const ALLOWED_NON_KEY = [
      "title",
      "description",
      "sendInvoice",
      "chargeCustomer",
      "newOrderStatus",
      "debugMode",
      "sandboxMode",
      "storeId",
      "sandboxMerchantId",
      "prodMerchantId",
      "paymentMethodsConfig",
    ] as const;

    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED_NON_KEY) {
      if (key in req.body) patch[key] = req.body[key];
    }

    const adminUser = (req as any).user?.username ?? (req as any).user?.id ?? "unknown_admin";

    // ── Private key handling — write-only, validated before storing ──────────
    // Reject mask/placeholder values immediately (422).
    // Only update if the field is present AND passes normalization + crypto validation.
    const MASK_REGEX = /^[•*·]+$/;
    const PLACEHOLDER_REGEX = /^(configured|\[redacted\]|\*{4,})$/i;

    async function applyPrivateKey(
      fieldName: "sandboxPrivateKey" | "prodPrivateKey",
      label: string,
    ): Promise<boolean> {
      if (!(fieldName in req.body)) return true; // not provided — keep existing, OK
      const raw: unknown = req.body[fieldName];
      // Empty string or null — do not overwrite existing key, but don't error
      if (!raw || (typeof raw === "string" && !raw.trim())) return true;
      const rawStr = String(raw).trim();
      // Reject masked / placeholder values
      if (MASK_REGEX.test(rawStr) || PLACEHOLDER_REGEX.test(rawStr)) {
        res.status(422).json({ error: `${label} tidak valid — nilai masked atau placeholder tidak diterima` });
        return false;
      }

      // Detect PEM type for logging
      const detectedType = rawStr.includes("-----BEGIN RSA PRIVATE KEY-----")
        ? "PKCS#1 RSA PRIVATE KEY"
        : rawStr.includes("-----BEGIN PRIVATE KEY-----")
          ? "PKCS#8 PRIVATE KEY"
          : rawStr.includes("-----BEGIN")
            ? "PEM (unknown header)"
            : "raw base64";

      // Normalize
      let normalized: string;
      try {
        normalized = normalizePaylabsPrivateKey(rawStr);
      } catch (e) {
        logger.warn(
          { admin: adminUser, field: fieldName, action: "normalize_failed", inputLength: rawStr.length, detectedType, error: String(e) },
          "[paylabs-settings] private key normalization failed",
        );
        res.status(422).json({ error: `${label} tidak dapat dinormalisasi: ${e instanceof Error ? e.message : String(e)}` });
        return false;
      }

      // Cryptographic validation
      const valid = isPrivateKeyValid(normalized);
      logger.info(
        {
          admin: adminUser,
          field: fieldName,
          action: "private_key_received",
          received: true,
          inputLength: rawStr.length,
          detectedType,
          normalizedLength: normalized.length,
          cryptoValid: valid,
        },
        "[paylabs-settings] sandbox private key update",
      );

      if (!valid) {
        res.status(422).json({ error: `${label} tidak valid — pastikan private key PKCS#8 atau PKCS#1 RSA 2048-bit (PEM atau base64).` });
        return false;
      }
      patch[fieldName] = normalized;
      logger.info(
        { admin: adminUser, field: fieldName, action: "private_key_stored", normalizedLength: normalized.length },
        "[paylabs-settings] private key stored to DB",
      );
      return true;
    }

    // Validate and normalize storeId before saving
    if ("storeId" in patch) {
      const raw = patch.storeId as string | null | undefined;
      const trimmed = typeof raw === "string" ? raw.trim() : "";
      if (!trimmed) {
        // Empty/blank → "" (column is NOT NULL; empty string = no storeId used in payload)
        patch.storeId = "";
      } else {
        try {
          patch.storeId = normalizeOptionalPaylabsStoreId(trimmed) ?? "";
        } catch (e) {
          return res.status(422).json({
            error: e instanceof Error ? e.message : "Paylabs Store ID tidak valid",
          });
        }
      }
    }

    // Process private key updates (write-only, validated before storing)
    const sbOk = await applyPrivateKey("sandboxPrivateKey", "Merchant Private Key Sandbox");
    if (!sbOk) return;
    const prodOk = await applyPrivateKey("prodPrivateKey", "Merchant Private Key Produksi");
    if (!prodOk) return;

    // Handle Paylabs public keys separately — normalize PEM + audit log
    // Only update if client sends a non-empty value (empty string = "don't change")
    if ("sandboxPublicKey" in req.body && req.body.sandboxPublicKey !== "") {
      const normalized = normalizePaylabsPublicKey(String(req.body.sandboxPublicKey));
      if (!normalized) {
        res.status(422).json({ error: "Paylabs sandbox public key tidak valid — harus PEM lengkap atau base64 dari dashboard Paylabs" });
        return;
      }
      patch.sandboxPublicKey = normalized;
      logger.info(
        { admin: adminUser, field: "sandboxPublicKey", action: "pending_write", received: true, normalizedLength: normalized.length },
        "[paylabs-settings] sandbox public key pending DB write",
      );
    }

    if ("prodPublicKey" in req.body && req.body.prodPublicKey !== "") {
      const normalized = normalizePaylabsPublicKey(String(req.body.prodPublicKey));
      if (!normalized) {
        res.status(422).json({ error: "Paylabs production public key tidak valid — harus PEM lengkap atau base64 dari dashboard Paylabs" });
        return;
      }
      patch.prodPublicKey = normalized;
      logger.info(
        { admin: adminUser, field: "prodPublicKey", action: "pending_write", received: true, normalizedLength: normalized.length },
        "[paylabs-settings] production public key pending DB write",
      );
    }

    const [updated] = await db
      .update(paylabsSettingsTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(paylabsSettingsTable.id, current.id))
      .returning();

    if (!updated) {
      req.log.error({ rowId: current.id }, "PATCH paylabs settings: DB update returned no rows");
      res.status(500).json({ error: "Gagal menyimpan — settings row tidak ditemukan" });
      return;
    }

    // Log confirmation of DB write for public keys (no key values logged)
    if ("sandboxPublicKey" in patch) {
      const storedLength = updated.sandboxPublicKey?.trim().length ?? 0;
      const configuredAfterSave = storedLength > 0;
      logger.info(
        { admin: adminUser, field: "sandboxPublicKey", stored: configuredAfterSave, storedLength, configuredAfterSave },
        "[paylabs-settings] sandbox public key update",
      );
    }
    if ("prodPublicKey" in patch) {
      const storedLength = updated.prodPublicKey?.trim().length ?? 0;
      const configuredAfterSave = storedLength > 0;
      logger.info(
        { admin: adminUser, field: "prodPublicKey", stored: configuredAfterSave, storedLength, configuredAfterSave },
        "[paylabs-settings] production public key update",
      );
    }

    // Return safe response — NEVER return private keys or public keys; only boolean configured flags
    const safeResponse = {
      ...updated,
      sandboxPrivateKey: undefined,
      prodPrivateKey:    undefined,
      sandboxPublicKey:  undefined,
      prodPublicKey:     undefined,
      sandboxPrivateKeyConfigured:    isPrivateKeyValid(updated.sandboxPrivateKey),
      productionPrivateKeyConfigured: isPrivateKeyValid(updated.prodPrivateKey),
      sandboxPublicKeyConfigured:     Boolean(updated.sandboxPublicKey?.trim()),
      prodPublicKeyConfigured:        Boolean(updated.prodPublicKey?.trim()),
    };

    return res.json(safeResponse);
  } catch (err) {
    req.log.error({ err }, "PATCH paylabs settings error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
