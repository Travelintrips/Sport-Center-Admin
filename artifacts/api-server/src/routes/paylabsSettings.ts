import { Router } from "express";
import crypto from "crypto";
import { db, paylabsSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { loadPaylabsConfigFromDb, normalizeOptionalPaylabsStoreId } from "../lib/paylabs";

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
// Returns DB values merged with env-var fallbacks so the admin panel always
// shows the effective configuration (env vars seed empty DB fields).
router.get("/admin/paylabs/settings", adminMiddleware, async (req, res) => {
  try {
    const config = await getOrCreate();

    // Merge env var fallbacks into empty fields — read-only, not persisted here.
    // This ensures the admin form pre-populates with whatever is actually in use.
    const merged = {
      ...config,
      sandboxMerchantId: config.sandboxMerchantId || process.env.PAYLABS_SANDBOX_MERCHANT_ID || "",
      sandboxPrivateKey:  config.sandboxPrivateKey  || process.env.PAYLABS_SANDBOX_PRIVATE_KEY  || "",
      sandboxPublicKey:   config.sandboxPublicKey   || process.env.PAYLABS_SANDBOX_PUBLIC_KEY   || "",
      prodMerchantId:    config.prodMerchantId    || process.env.PAYLABS_PROD_MERCHANT_ID    || "",
      prodPrivateKey:     config.prodPrivateKey     || process.env.PAYLABS_PROD_PRIVATE_KEY     || "",
      prodPublicKey:      config.prodPublicKey      || process.env.PAYLABS_PROD_PUBLIC_KEY      || "",
      storeId:            config.storeId            || process.env.PAYLABS_STORE_ID             || "",
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
router.patch("/admin/paylabs/settings", adminMiddleware, async (req, res) => {
  try {
    const current = await getOrCreate();

    const ALLOWED = [
      "title",
      "description",
      "sendInvoice",
      "chargeCustomer",
      "newOrderStatus",
      "debugMode",
      "sandboxMode",
      "storeId",
      "sandboxPublicKey",
      "sandboxPrivateKey",
      "sandboxMerchantId",
      "prodPublicKey",
      "prodPrivateKey",
      "prodMerchantId",
      "paymentMethodsConfig",
    ] as const;

    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (key in req.body) patch[key] = req.body[key];
    }

    // Validate and normalize storeId before saving
    if ("storeId" in patch) {
      const raw = patch.storeId as string | null | undefined;
      const trimmed = typeof raw === "string" ? raw.trim() : "";
      if (!trimmed) {
        // Empty/blank → store as null (omitted from Paylabs payload)
        patch.storeId = null;
      } else {
        try {
          patch.storeId = normalizeOptionalPaylabsStoreId(trimmed);
        } catch (e) {
          return res.status(400).json({
            error: e instanceof Error ? e.message : "Paylabs Store ID tidak valid",
          });
        }
      }
    }

    const [updated] = await db
      .update(paylabsSettingsTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(paylabsSettingsTable.id, current.id))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "PATCH paylabs settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
