import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, facilitiesTable } from "@workspace/db";
import {
  generateAiReply,
  type AiPageContext,
} from "../services/aiSportCenterService";
import { getHistory, appendTurn } from "../lib/aiConversationMemory";
import { logAudit } from "../lib/auditLog";

const router = Router();
const SESSION_COOKIE = "mina_web_session";
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_PAGE_URL_LENGTH = 2_048;
const MAX_FACILITY_NAME_LENGTH = 160;
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;

interface RateEntry {
  count: number;
  resetAt: number;
}

const rateEntries = new Map<string, RateEntry>();

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const pair = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : undefined;
}

function getOrCreateSession(req: Request, res: Response): string {
  const existing = readCookie(req, SESSION_COOKIE);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;

  const sessionId = randomUUID();
  setSessionCookie(res, sessionId);
  return sessionId;
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const current = rateEntries.get(key);
  if (!current || current.resetAt <= now) {
    rateEntries.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    if (rateEntries.size > 10_000) {
      for (const [entryKey, entry] of rateEntries) {
        if (entry.resetAt <= now) rateEntries.delete(entryKey);
      }
    }
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS_PER_WINDOW;
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function getRateKey(req: Request, sessionId: string): string {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.ip || "unknown";
  return `${ip}:${sessionId}`;
}

function setSessionCookie(res: Response, sessionId: string): void {
  if (typeof res.cookie === "function") {
    res.cookie(SESSION_COOKIE, sessionId, {
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
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}; Max-Age=1800`,
  );
}

router.post("/mina/web/message", async (req, res) => {
  const sessionId = getOrCreateSession(req, res);
  const rateKey = getRateKey(req, sessionId);
  if (isRateLimited(rateKey)) {
    res.status(429).json({
      error: "Terlalu banyak pesan. Silakan coba lagi dalam satu menit.",
      code: "MINA_RATE_LIMITED",
    });
    return;
  }

  const message = cleanText(req.body?.message, MAX_MESSAGE_LENGTH);
  if (!message) {
    res.status(400).json({ error: "Pesan wajib diisi.", code: "MINA_MESSAGE_REQUIRED" });
    return;
  }

  const rawCurrentUrl = cleanText(req.body?.pageContext?.currentUrl, MAX_PAGE_URL_LENGTH);
  let currentUrl = "";
  try {
    currentUrl = new URL(rawCurrentUrl, `https://${req.get("host") || "sport-center.local"}`).pathname;
  } catch {
    currentUrl = "";
  }
  const requestedFacilityId = Number(req.body?.pageContext?.facilityId);
  const requestedFacilityName = cleanText(req.body?.pageContext?.facilityName, MAX_FACILITY_NAME_LENGTH);
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
        code: "MINA_UNAVAILABLE",
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

    setSessionCookie(res, sessionId);
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