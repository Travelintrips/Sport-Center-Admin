import { Router } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { deleteFromStorage } from "../lib/supabaseStorage";
import { uploadFile, BUCKETS } from "../lib/storage";
import { invalidateBaseUrlCache } from "../lib/appUrl";
import { getFonnteConfig, normalizeFonnteDevice } from "../lib/fonnteConfig";
import {
  getCstWaGatewayMinaDeviceId,
  getCstWaGatewayPublicConfig,
  getCstWaGatewayReportDeviceId,
  listCstWaGatewayGroups,
  syncCstWaGatewayGroups,
} from "../lib/cstWaGateway";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"));
  },
});

async function getOrCreateSettings() {
  const [settings] = await db.select().from(settingsTable).limit(1);
  if (settings) return settings;
  const [newSettings] = await db.insert(settingsTable).values({
    centerName: "PT Cahaya Sejati Teknologi",
    address: "Cabang Soekarno Hatta",
    phone: "+62 21 1234567",
    whatsapp: "6281234567890",
    email: "info@sportcenter.com",
    openHour: "06:00",
    closeHour: "22:00",
    bankName: "BCA",
    bankAccount: "1234567890",
    bankAccountName: "PT Cahaya Sejati Teknologi",
    paymentDeadlineHours: "24",
  }).returning();
  return newSettings;
}

function publicSettings(settings: Awaited<ReturnType<typeof getOrCreateSettings>>) {
  const { fonnteToken: _adminToken, fonnteCustomerToken: _customerToken, ...safeSettings } = settings;
  return safeSettings;
}

router.get("/settings/whatsapp-status", adminMiddleware, async (req, res) => {
  try {
    const [fonnte, settings] = await Promise.all([getFonnteConfig(), getOrCreateSettings()]);
    const adminTokenConfigured = Boolean(fonnte.adminToken);
    const minaTokenConfigured = Boolean(fonnte.customerToken);
    const gatewayConfig = getCstWaGatewayPublicConfig();
    const minaGatewayDeviceId = getCstWaGatewayMinaDeviceId();
    const reportGatewayDeviceId = getCstWaGatewayReportDeviceId();
    let gatewayReachable = false;
    let gatewayError: string | null = null;
    let gatewayGroups: Awaited<ReturnType<typeof listCstWaGatewayGroups>> = [];

    if (gatewayConfig.configured) {
      try {
        gatewayGroups = await listCstWaGatewayGroups(reportGatewayDeviceId);
        gatewayReachable = true;
      } catch (error) {
        gatewayError = error instanceof Error ? error.message : "Gateway tidak dapat dihubungi";
        req.log.warn({ err: error, reportGatewayDeviceId }, "CST WA Gateway status check failed");
      }
    }

    const reportGroups = gatewayGroups.filter((group) => group.isActive);
    const selectedGroupId = settings.waGatewayAdminGroupId ?? null;
    const selectedGroup = selectedGroupId
      ? reportGroups.find((group) => group.id === selectedGroupId) ?? null
      : null;
    const minaProvider =
      gatewayConfig.configured && process.env.CST_WA_MINA_PROVIDER !== "fonnte"
        ? "cst_gateway"
        : "fonnte";
    const adminProvider =
      gatewayConfig.configured && process.env.CST_WA_ADMIN_PROVIDER !== "fonnte"
        ? "cst_gateway"
        : "fonnte";

    res.json({
      admin: {
        tokenConfigured: adminProvider === "cst_gateway" ? gatewayConfig.configured : adminTokenConfigured,
        tokenSource: adminProvider === "cst_gateway" ? "gateway" : fonnte.adminTokenSource,
        provider: adminProvider,
        gatewayDeviceId: reportGatewayDeviceId,
        groupProvider: settings.adminGroupProvider ?? "cst_gateway",
      },
      mina: {
        deviceNumber: fonnte.customerDevice || null,
        deviceSource: fonnte.customerDeviceSource,
        tokenConfigured: minaProvider === "cst_gateway" ? gatewayConfig.configured : minaTokenConfigured,
        tokenSource: minaProvider === "cst_gateway" ? "gateway" : fonnte.customerTokenSource,
        provider: minaProvider,
        gatewayDeviceId: minaGatewayDeviceId,
        active:
          minaProvider === "cst_gateway"
            ? Boolean(gatewayConfig.configured && gatewayReachable)
            : Boolean(fonnte.customerDevice && minaTokenConfigured),
        inboundDeviceValidation:
          minaProvider === "cst_gateway"
            ? "stable_gateway_device_id"
            : "when_fonnte_payload_includes_device",
      },
      report: {
        provider: adminProvider,
        gatewayDeviceId: reportGatewayDeviceId,
        active: Boolean(gatewayConfig.configured && gatewayReachable),
      },
      gateway: {
        configured: gatewayConfig.configured,
        reachable: gatewayReachable,
        baseUrl: gatewayConfig.baseUrl || null,
        clientId: "sport-center",
        selectedGroupId,
        selectedGroup,
        groups: reportGroups,
        error: gatewayError,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Get WhatsApp status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/settings/whatsapp-groups/sync", adminMiddleware, async (req, res) => {
  try {
    const gatewayConfig = getCstWaGatewayPublicConfig();
    if (!gatewayConfig.configured) {
      res.status(503).json({ error: "CST WA Gateway belum dikonfigurasi" });
      return;
    }
    const reportGatewayDeviceId = getCstWaGatewayReportDeviceId();
    const result = await syncCstWaGatewayGroups(reportGatewayDeviceId);
    res.status(202).json({
      ...result,
      deviceId: reportGatewayDeviceId,
      message: "Sinkronisasi grup Sport Center Report sedang diproses.",
    });
  } catch (err) {
    req.log.error({ err }, "Sync WhatsApp groups error");
    res.status(502).json({
      error: err instanceof Error ? err.message : "Gagal menyinkronkan grup CST WA Gateway",
    });
  }
});

router.get("/settings", async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    res.json(publicSettings(settings));
  } catch (err) {
    req.log.error({ err }, "Get settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/settings", adminMiddleware, async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    const allowed = [
      "centerName","address","phone","whatsapp","email",
      "openHour","closeHour","logoUrl","bankName","bankAccount","bankAccountName",
      "fonnteToken","fonnteCustomerToken","fonnteAdminWa","adminWaPhones","appUrl","paymentDomain","paymentDeadlineHours",
      "fonnteCustomerDevice","customerServiceWhatsapp",
      "adminGroupProvider","waGatewayAdminGroupId",
      "minaWebChatEnabled","minaWebChatGreeting","minaWebChatQuickActions",
    ];
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        if (key === "fonnteCustomerDevice") {
          const deviceNumber = normalizeFonnteDevice(req.body[key]);
          if (!deviceNumber) {
            res.status(400).json({
              error: "Nomor Device Mina/customer wajib diisi dengan nomor WhatsApp Indonesia yang valid.",
              code: "INVALID_FONNTE_CUSTOMER_DEVICE",
            });
            return;
          }
          patch[key] = deviceNumber;
        } else if (key === "customerServiceWhatsapp") {
          const raw = String(req.body[key] ?? "").trim();
          if (!raw) {
            patch[key] = null;
          } else {
            const customerServiceWhatsapp = normalizeFonnteDevice(raw);
            if (!customerServiceWhatsapp) {
              res.status(400).json({
                error: "Nomor WA Customer Service harus berupa nomor WhatsApp Indonesia yang valid.",
                code: "INVALID_CUSTOMER_SERVICE_WHATSAPP",
              });
              return;
            }
            const minaDevice = normalizeFonnteDevice(
              Object.prototype.hasOwnProperty.call(req.body, "fonnteCustomerDevice")
                ? req.body.fonnteCustomerDevice
                : settings.fonnteCustomerDevice,
            );
            if (minaDevice && customerServiceWhatsapp === minaDevice) {
              res.status(400).json({
                error: "Nomor WA Customer Service harus berbeda dari Device Mina/customer.",
                code: "CUSTOMER_SERVICE_EQUALS_MINA",
              });
              return;
            }
            patch[key] = customerServiceWhatsapp;
          }
        } else if (key === "adminGroupProvider") {
          const provider = String(req.body[key] ?? "").trim();
          if (!["fonnte", "cst_gateway"].includes(provider)) {
            res.status(400).json({
              error: "Provider grup admin harus fonnte atau cst_gateway.",
              code: "INVALID_ADMIN_GROUP_PROVIDER",
            });
            return;
          }
          patch[key] = provider;
        } else if (key === "waGatewayAdminGroupId") {
          const groupId = String(req.body[key] ?? "").trim();
          if (groupId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(groupId)) {
            res.status(400).json({
              error: "Group ID CST WA Gateway tidak valid.",
              code: "INVALID_WA_GATEWAY_GROUP_ID",
            });
            return;
          }
          patch[key] = groupId || null;
        } else if (key === "minaWebChatEnabled") {
          if (typeof req.body[key] !== "boolean") {
            res.status(400).json({
              error: "Status Widget Chat Mina harus berupa boolean.",
              code: "INVALID_MINA_WEB_CHAT_ENABLED",
            });
            return;
          }
          patch[key] = req.body[key];
        } else if (key === "minaWebChatGreeting") {
          const greeting = String(req.body[key] ?? "").trim();
          if (!greeting || greeting.length > 500) {
            res.status(400).json({
              error: "Salam Chat Mina wajib diisi dan maksimal 500 karakter.",
              code: "INVALID_MINA_WEB_CHAT_GREETING",
            });
            return;
          }
          patch[key] = greeting;
        } else if (key === "minaWebChatQuickActions") {
          const actions = String(req.body[key] ?? "")
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean);
          if (actions.length > 6 || actions.some((item) => item.length > 80)) {
            res.status(400).json({
              error: "Quick action Chat Mina maksimal 6 baris dan 80 karakter per baris.",
              code: "INVALID_MINA_WEB_CHAT_QUICK_ACTIONS",
            });
            return;
          }
          patch[key] = actions.join("\n");
        } else {
          patch[key] = req.body[key] ?? null;
        }
      }
    }
    if (Object.keys(patch).length > 0) {
      await db.update(settingsTable).set(patch).where(eq(settingsTable.id, settings.id));
      invalidateBaseUrlCache();
    }
    const [updated] = await db.select().from(settingsTable).where(eq(settingsTable.id, settings.id)).limit(1);
    res.json(publicSettings(updated));
  } catch (err) {
    req.log.error({ err }, "Update settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/settings/qris", adminMiddleware, upload.single("qris"), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const settings = await getOrCreateSettings();
    if (settings.qrisImageUrl) {
      await deleteFromStorage(settings.qrisImageUrl);
    }
    const ext = path.extname(req.file.originalname).toLowerCase() || ".png";
    const objectPath = `qris/qris-${randomUUID()}${ext}`;
    const qrisImageUrl = await uploadFile(
      BUCKETS.facility,
      objectPath,
      req.file.buffer,
      req.file.mimetype,
    );
    await db.update(settingsTable).set({ qrisImageUrl }).where(eq(settingsTable.id, settings.id));
    res.json({ qrisImageUrl });
  } catch (err) {
    req.log.error({ err }, "Upload QRIS error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/settings/qris", adminMiddleware, async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    if (settings.qrisImageUrl) {
      await deleteFromStorage(settings.qrisImageUrl);
    }
    await db.update(settingsTable).set({ qrisImageUrl: null }).where(eq(settingsTable.id, settings.id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete QRIS error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
