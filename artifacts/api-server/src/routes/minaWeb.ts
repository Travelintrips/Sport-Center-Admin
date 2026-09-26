import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, facilitiesTable, settingsTable } from "@workspace/db";
import {
  generateAiReply,
  type AiPageContext,
} from "../services/aiSportCenterService";
import { getHistory, appendTurn } from "../lib/aiConversationMemory";
import { logAudit } from "../lib/auditLog";
import {
  cleanMinaText,
  createMinaRateLimiter,
  isValidMinaSessionId,
  MAX_MESSAGE_LENGTH,
  MAX_PAGE_URL_LENGTH,
  MINA_SESSION_COOKIE,
  normalizeMinaPagePath,
  readCookieHeader,
} from "../lib/minaWebSecurity";

const router = Router();
const isRateLimited = createMinaRateLimiter();

function getOrCreateSession(req: Request, res: Response): string {
  const existing = readCookieHeader(req.headers.cookie, MINA_SESSION_COOKIE);
  if (isValidMinaSessionId(existing)) return existing;

  const sessionId = randomUUID();
  setSessionCookie(res, sessionId);
  return sessionId;
}

function getRateKey(req: Request, sessionId: string): string {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.ip || "unknown";
  return `${ip}:${sessionId}`;
}

function setSessionCookie(res: Response, sessionId: string): void {
  if (typeof res.cookie === "function") {
    res.cookie(MINA_SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 60 * 1000,
      path: "/",
    });
    return;
  }
  res.setHeader(
    "Set-Cookie",
    `${MINA_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}; Max-Age=1800`,
  );
}

router.post("/mina/web/message", async (req, res) => {
  const [webChatSettings] = await db
    .select({ minaWebChatEnabled: settingsTable.minaWebChatEnabled })
    .from(settingsTable)
    .limit(1);

  if (webChatSettings?.minaWebChatEnabled === false) {
    res.status(503).json({
      error: "Chat Mina sedang dinonaktifkan.",
      code: "MINA_WEB_DISABLED",
      fallbackToWhatsapp: false,
    });
    return;
  }

  const sessionId = getOrCreateSession(req, res);
  const rateKey = getRateKey(req, sessionId);
  if (isRateLimited(rateKey)) {
    res.status(429).json({
      error: "Terlalu banyak pesan. Silakan coba lagi dalam satu menit.",
      code: "MINA_RATE_LIMITED",
    });
    return;
  }

  const message = cleanMinaText(req.body?.message, MAX_MESSAGE_LENGTH);
  if (!message) {
    res.status(400).json({ error: "Pesan wajib diisi.", code: "MINA_MESSAGE_REQUIRED" });
    return;
  }

  const rawCurrentUrl = cleanMinaText(req.body?.pageContext?.currentUrl, MAX_PAGE_URL_LENGTH);
  const currentUrl = normalizeMinaPagePath(rawCurrentUrl, req.get("host") || "sport-center.local");
  const requestedFacilityId = Number(req.body?.pageContext?.facilityId);
  let facilityId: number | undefined;
  let facilityName: string | undefined;

  if (Number.isInteger(requestedFacilityId) && requestedFacilityId > 0) {
    const [facility] = await db
      .select({ id: facilitiesTable.id, name: facilitiesTable.name })
      .from(facilitiesTable)
      .where(and(eq(facilitiesTable.id, requestedFacilityId), eq(facilitiesTable.isActive, true)))
      .limit(1);
    if (facility) {
      facilityId = facility.id;
      facilityName = facility.name;
    }
  }

  const pageContext: AiPageContext = {
    currentUrl,
    ...(facilityId ? { facilityId } : {}),
    ...(facilityName ? { facilityName } : {}),
  };
  const sessionKey = `web:${sessionId}`;
  const history = getHistory(sessionKey);
  appendTurn(sessionKey, "user", message);

  try {
    const result = await generateAiReply("", message, history, {
      channel: "web",
      pageContext,
    });

    if (result.fallbackToAdmin || !result.reply) {
      appendTurn(sessionKey, "assistant", "Maaf, Mina sedang tidak tersedia. Silakan lanjutkan melalui WhatsApp untuk bantuan admin.");
      res.status(503).json({
        error: "Mina sedang tidak tersedia.",
        code:
          result.fallbackReason === "configuration_missing"
            ? "MINA_CONFIGURATION_UNAVAILABLE"
            : "MINA_PROVIDER_UNAVAILABLE",
        fallbackToWhatsapp: true,
      });
      return;
    }

    appendTurn(sessionKey, "assistant", result.reply);
    await logAudit({
      action: "ai_web_message_processed",
      entity: "mina_web",
      after: {
        sessionId,
        intent: result.intent,
        replyLength: result.reply.length,
        pageUrl: currentUrl || null,
        facilityId: facilityId ?? null,
      },
    }).catch(() => {});

    res.json({
      reply: result.reply,
      intent: result.intent,
      sessionId,
      fallbackToWhatsapp: false,
    });
  } catch (error) {
    console.error("[minaWeb] message error:", error);
    res.status(500).json({
      error: "Mina mengalami kendala sementara. Silakan coba lagi atau lanjutkan melalui WhatsApp.",
      code: "MINA_MESSAGE_FAILED",
      fallbackToWhatsapp: true,
    });
  }
});

export default router;