import { Router } from "express";
import crypto from "crypto";
import { db, paylabsSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { loadPaylabsConfigFromDb, normalizePaylabsPublicKey } from "../lib/paylabs";
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
// Returns DB values merged with env-var fallbacks.
// SECURITY: Paylabs public keys (sandboxPublicKey / prodPublicKey) are NEVER returned
// to the client — only boolean "configured" flags are sent instead.
// Merchant private keys ARE returned so the admin form can pre-populate them (they are
// already stored in DB and the admin has write access to change them).
router.get("/admin/paylabs/settings", adminMiddleware, async (req, res) => {
  try {
    const config = await getOrCreate();

    // Effective values (DB takes priority, env vars are fallback for seeds)
    const sandboxPublicKeyEffective  = config.sandboxPublicKey  || process.env.PAYLABS_SANDBOX_PUBLIC_KEY  || "";
    const prodPublicKeyEffective     = config.prodPublicKey     || process.env.PAYLABS_PROD_PUBLIC_KEY     || "";

    const merged = {
      ...config,
      sandboxMerchantId: config.sandboxMerchantId || process.env.PAYLABS_SANDBOX_MERCHANT_ID || "",
      sandboxPrivateKey:  config.sandboxPrivateKey  || process.env.PAYLABS_SANDBOX_PRIVATE_KEY  || "",
      prodMerchantId:    config.prodMerchantId    || process.env.PAYLABS_PROD_MERCHANT_ID    || "",
      prodPrivateKey:     config.prodPrivateKey     || process.env.PAYLABS_PROD_PRIVATE_KEY     || "",
      storeId:            config.storeId            || process.env.PAYLABS_STORE_ID             || "",
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
      "sandboxPrivateKey",
      "sandboxMerchantId",
      "prodPrivateKey",
      "prodMerchantId",
      "paymentMethodsConfig",
    ] as const;

    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED_NON_KEY) {
      if (key in req.body) patch[key] = req.body[key];
    }

    // Handle Paylabs public keys separately — normalize PEM + audit log
    // Only update if client sends a non-empty value (empty string = "don't change")
    const adminUser = (req as any).user?.username ?? (req as any).user?.id ?? "unknown_admin";

    if ("sandboxPublicKey" in req.body && req.body.sandboxPublicKey !== "") {
      const normalized = normalizePaylabsPublicKey(String(req.body.sandboxPublicKey));
      if (!normalized) {
        res.status(400).json({ error: "Invalid Paylabs sandbox public key — must be valid PEM or base64" });
        return;
      }
      patch.sandboxPublicKey = normalized;
      // Audit log: record change WITHOUT logging the key value
      logger.info(
        { admin: adminUser, field: "sandboxPublicKey", action: "updated", keyLength: normalized.length },
        "[paylabs-settings] Paylabs sandbox public key updated by admin",
      );
    }

    if ("prodPublicKey" in req.body && req.body.prodPublicKey !== "") {
      const normalized = normalizePaylabsPublicKey(String(req.body.prodPublicKey));
      if (!normalized) {
        res.status(400).json({ error: "Invalid Paylabs production public key — must be valid PEM or base64" });
        return;
      }
      patch.prodPublicKey = normalized;
      logger.info(
        { admin: adminUser, field: "prodPublicKey", action: "updated", keyLength: normalized.length },
        "[paylabs-settings] Paylabs production public key updated by admin",
      );
    }

    const [updated] = await db
      .update(paylabsSettingsTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(paylabsSettingsTable.id, current.id))
      .returning();

    // Return safe response — redact public keys, send only configured status
    const safeResponse = {
      ...updated,
      sandboxPublicKey: undefined,
      prodPublicKey:    undefined,
      sandboxPublicKeyConfigured: Boolean(updated.sandboxPublicKey?.trim()),
      prodPublicKeyConfigured:    Boolean(updated.prodPublicKey?.trim()),
    };

    res.json(safeResponse);
  } catch (err) {
    req.log.error({ err }, "PATCH paylabs settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
