import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";
import { createToken } from "../lib/auth";
import crypto from "crypto";

const router = Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const FONNTE_TOKEN = process.env.FONNTE_TOKEN || "";

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const otpStore = new Map<string, { otp: string; expires: number; name?: string }>();

function cleanPhone(raw: string): string {
  return raw.replace(/^0/, "62").replace(/\D/g, "");
}

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

router.post("/auth/google", async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      res.status(400).json({ error: "idToken is required" });
      return;
    }

    let payload: any;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch {
      res.status(401).json({ error: "Invalid Google token" });
      return;
    }

    if (!payload) {
      res.status(401).json({ error: "Invalid Google token" });
      return;
    }

    const { sub: googleId, email, name, picture } = payload;

    let user = await db
      .select()
      .from(usersTable)
      .where(
        or(
          eq(usersTable.googleId, googleId),
          ...(email ? [eq(usersTable.email, email)] : [])
        )
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!user) {
      const [created] = await db
        .insert(usersTable)
        .values({
          name: name ?? email ?? "Google User",
          email: email ?? null,
          googleId,
          passwordHash: null,
          role: "customer",
        })
        .returning();
      user = created;
    } else if (!user.googleId) {
      const [updated] = await db
        .update(usersTable)
        .set({ googleId })
        .where(eq(usersTable.id, user.id))
        .returning();
      user = updated;
    }

    const token = createToken(user.id, user.role, null);
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        tenantId: null,
        createdAt: user.createdAt,
      },
      token,
    });
  } catch (err) {
    req.log.error({ err }, "Google login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      res.status(400).json({ error: "Nomor HP wajib diisi" });
      return;
    }

    const cleaned = cleanPhone(phone);
    if (cleaned.length < 10) {
      res.status(400).json({ error: "Nomor HP tidak valid" });
      return;
    }

    const otp = generateOtp();
    const expires = Date.now() + 5 * 60 * 1000;
    otpStore.set(cleaned, { otp, expires });

    if (FONNTE_TOKEN) {
      try {
        await fetch("https://api.fonnte.com/send", {
          method: "POST",
          headers: {
            Authorization: FONNTE_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            target: cleaned,
            message: `Kode OTP Sport Center Anda: *${otp}*\n\nBerlaku 5 menit. Jangan bagikan ke siapapun.`,
          }),
        });
      } catch {
        // swallow
      }
    } else {
      console.log(`[DEV] OTP for ${cleaned}: ${otp}`);
    }

    res.json({ success: true, message: "OTP berhasil dikirim via WhatsApp" });
  } catch (err) {
    req.log.error({ err }, "Send OTP error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/verify-otp", async (req, res) => {
  try {
    const { phone, otp, name } = req.body;
    if (!phone || !otp) {
      res.status(400).json({ error: "Nomor HP dan OTP wajib diisi" });
      return;
    }

    const cleaned = cleanPhone(phone);
    const record = otpStore.get(cleaned);

    if (!record) {
      res.status(400).json({ error: "OTP tidak ditemukan. Minta OTP baru." });
      return;
    }
    if (Date.now() > record.expires) {
      otpStore.delete(cleaned);
      res.status(400).json({ error: "OTP sudah kadaluarsa. Minta OTP baru." });
      return;
    }
    if (record.otp !== String(otp)) {
      res.status(400).json({ error: "OTP salah" });
      return;
    }

    otpStore.delete(cleaned);

    let user = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.phone, cleaned))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!user) {
      const displayPhone = "0" + cleaned.slice(2);
      const [created] = await db
        .insert(usersTable)
        .values({
          name: name ?? displayPhone,
          email: null,
          phone: cleaned,
          passwordHash: null,
          role: "customer",
        })
        .returning();
      user = created;
    }

    const token = createToken(user.id, user.role, null);
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        tenantId: null,
        createdAt: user.createdAt,
      },
      token,
    });
  } catch (err) {
    req.log.error({ err }, "Verify OTP error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
