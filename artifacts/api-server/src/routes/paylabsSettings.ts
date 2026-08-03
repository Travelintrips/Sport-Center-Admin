import { Router } from "express";
import fs from "fs";
import path from "path";
import { adminMiddleware } from "../lib/auth";

const router = Router();

// Config file stored alongside the server — persists across restarts
const CONFIG_PATH = path.resolve(
  process.env.PAYLABS_CONFIG_PATH ??
    path.join(process.cwd(), "paylabs.config.json"),
);

interface PaylabsConfig {
  title: string;
  description: string;
  sendInvoice: boolean;
  chargeCustomer: boolean;
  newOrderStatus: string;
  debugMode: boolean;
  sandboxMode: boolean;
  storeId: string;
  sandboxPublicKey: string;
  sandboxPrivateKey: string;
  sandboxMerchantId: string;
  prodPublicKey: string;
  prodPrivateKey: string;
  prodMerchantId: string;
  paymentMethodsConfig: unknown[] | null;
  updatedAt: string;
}

const DEFAULTS: PaylabsConfig = {
  title: "Online Payment (Bank Transfer, Virtual Account, QRIS)",
  description: "",
  sendInvoice: true,
  chargeCustomer: false,
  newOrderStatus: "completed",
  debugMode: false,
  sandboxMode: true,
  storeId: process.env.PAYLABS_STORE_ID ?? "",
  sandboxPublicKey: process.env.PAYLABS_SANDBOX_PUBLIC_KEY ?? "",
  sandboxPrivateKey: process.env.PAYLABS_SANDBOX_PRIVATE_KEY ?? "",
  sandboxMerchantId: process.env.PAYLABS_SANDBOX_MERCHANT_ID ?? "",
  prodPublicKey: process.env.PAYLABS_PROD_PUBLIC_KEY ?? "",
  prodPrivateKey: process.env.PAYLABS_PROD_PRIVATE_KEY ?? "",
  prodMerchantId: process.env.PAYLABS_PROD_MERCHANT_ID ?? "",
  paymentMethodsConfig: null,
  updatedAt: new Date().toISOString(),
};

function readConfig(): PaylabsConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf8");
      return { ...DEFAULTS, ...JSON.parse(raw) };
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULTS };
}

function writeConfig(config: PaylabsConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

// GET /api/admin/paylabs/settings
router.get("/admin/paylabs/settings", adminMiddleware, (req, res) => {
  try {
    const config = readConfig();
    res.json(config);
  } catch (err) {
    req.log.error({ err }, "GET paylabs settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/admin/paylabs/settings
router.patch("/admin/paylabs/settings", adminMiddleware, (req, res) => {
  try {
    const current = readConfig();

    const ALLOWED = [
      "title", "description", "sendInvoice", "chargeCustomer",
      "newOrderStatus", "debugMode", "sandboxMode", "storeId",
      "sandboxPublicKey", "sandboxPrivateKey", "sandboxMerchantId",
      "prodPublicKey", "prodPrivateKey", "prodMerchantId",
      "paymentMethodsConfig",
    ] as const;

    const updated: PaylabsConfig = { ...current, updatedAt: new Date().toISOString() };
    for (const key of ALLOWED) {
      if (key in req.body) (updated as Record<string, unknown>)[key] = req.body[key];
    }

    writeConfig(updated);

    // Also update process.env so the current process reflects the new values
    // immediately (useful if other parts of the server read PAYLABS_* env vars)
    process.env.PAYLABS_STORE_ID = updated.storeId;
    process.env.PAYLABS_SANDBOX_PUBLIC_KEY = updated.sandboxPublicKey;
    process.env.PAYLABS_SANDBOX_PRIVATE_KEY = updated.sandboxPrivateKey;
    process.env.PAYLABS_SANDBOX_MERCHANT_ID = updated.sandboxMerchantId;
    process.env.PAYLABS_PROD_PUBLIC_KEY = updated.prodPublicKey;
    process.env.PAYLABS_PROD_PRIVATE_KEY = updated.prodPrivateKey;
    process.env.PAYLABS_PROD_MERCHANT_ID = updated.prodMerchantId;

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "PATCH paylabs settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
