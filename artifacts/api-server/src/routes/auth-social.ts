import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";
import { createToken, authMiddleware, hashPassword, isValidPasswordHash, verifyPassword, verifyToken } from "../lib/auth";
import crypto from "crypto";
import { logger } from "../lib/logger";
import { allowWhatsAppProviderSend } from "../lib/whatsappSafety";
import { getFonnteConfig } from "../lib/fonnteConfig";
import { getBaseUrl } from "../lib/appUrl";
import { createPasswordResetLimiter, createPasswordResetToken, isValidResetPassword, matchesPasswordResetUser, verifyPasswordResetToken } from "../lib/passwordReset";
import { getPasswordResetEmailConfig, sendPasswordResetEmail } from "../lib/passwordResetEmail";

const router = Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const otpStore = new Map<string, { otp: string; expires: number; name?: string }>();
const resetOtpStore = new Map<string, { otpHash: string; expires: number; token: string; attempts: number }>();
const resetRequestLimiter = createPasswordResetLimiter(3, 30);
const resetConfirmLimiter = createPasswordResetLimiter(10, 30);
const RESET_ACCEPTED_MESSAGE = "Jika akun terdaftar, instruksi reset kata sandi akan dikirim. Periksa juga folder spam.";
const RESET_INVALID_MESSAGE = "Tautan atau kode reset tidak valid atau sudah kedaluwarsa. Minta reset baru.";

function normalizeResetEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidResetEmail(email: string): boolean {
  return email.length <= 320 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email);
}

function resetOtpHash(email: string, otp: string): string {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET!)
    .update(JSON.stringify(["wa-password-reset", email, otp])).digest("hex");
}

// Case-insensitive lookup for legacy account emails; refuse ambiguous matches
// rather than creating a duplicate account or granting another user's role.
async function findVerifiedEmailAccount(email: string) {
  const matches = await db.select().from(usersTable)
    .where(sql`lower(trim(${usersTable.email})) = ${email}`).limit(2);
  return { account: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 };
}

function cleanPhone(raw: string): string {
  return raw.replace(/^0/, "62").replace(/\D/g, "");
}

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

router.post("/auth/google", async (req, res) => {
  try {
    const idToken = req.body?.idToken;
    if (typeof idToken !== "string" || !idToken) {
      res.status(400).json({ error: "idToken is required" });
      return;
    }
    const audience = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
    if (!audience) {
      res.status(503).json({ error: "Login Google belum dikonfigurasi." });
      return;
    }
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken, audience });
      payload = ticket.getPayload();
    } catch {
      res.status(401).json({ error: "Invalid Google token" });
      return;
    }
    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      res.status(401).json({ error: "Email Google belum terverifikasi." });
      return;
    }

    const verifiedEmail = payload.email.trim().toLowerCase();
    const [byGoogleId] = await db.select().from(usersTable)
      .where(eq(usersTable.googleId, payload.sub)).limit(1);
    // An existing Google identity must never silently change owners/emails.
    if (byGoogleId && byGoogleId.email?.trim().toLowerCase() !== verifiedEmail) {
      res.status(403).json({ error: "Identitas Google tidak cocok dengan akun terdaftar." });
      return;
    }

    let user = byGoogleId ?? null;
    if (!user) {
      const { account: byEmail, ambiguous } = await findVerifiedEmailAccount(verifiedEmail);
      if (ambiguous) {
        res.status(409).json({ error: "Terdapat akun dengan email duplikat. Hubungi administrator." });
        return;
      }
      if (byEmail) {
        // Pending admin invitations must be accepted through the verified
        // admin invitation flow; a public customer login cannot consume them.
        if (byEmail.accountStatus && byEmail.accountStatus !== "active") {
          res.status(403).json({ error: "Akun tidak aktif atau belum disetujui." });
          return;
        }
        if (byEmail.googleId && byEmail.googleId !== payload.sub) {
          res.status(403).json({ error: "Akun sudah ditautkan ke identitas Google lain." });
          return;
        }
        if (!byEmail.googleId) {
          const [linked] = await db.update(usersTable)
            .set({ googleId: payload.sub, updatedAt: new Date() })
            .where(and(eq(usersTable.id, byEmail.id),
              sql`lower(trim(${usersTable.email})) = ${verifiedEmail}`, isNull(usersTable.googleId)))
            .returning();
          user = linked ?? null;
        } else {
          user = byEmail;
        }
      } else {
        const [created] = await db.insert(usersTable).values({
          name: payload.name ?? verifiedEmail,
          email: verifiedEmail,
          googleId: payload.sub,
          passwordHash: crypto.randomBytes(32).toString("hex"),
          role: "customer",
        }).returning();
        user = created;
      }
    }
    // Role is taken exclusively from the existing account, never from the caller.
    if (!user || (user.accountStatus && user.accountStatus !== "active")) {
      res.status(403).json({ error: "Akun tidak aktif atau belum disetujui." });
      return;
    }
    const token = createToken(user.id, user.role, null);
    res.json({
      user: {
        id: user.id, name: user.name, email: user.email, role: user.role,
        phone: user.phone, tenantId: null, createdAt: user.createdAt,
      },
      token,
    });
  } catch (err) {
    req.log.error({ err }, "Google login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Classify trusted Google library failures without ever logging exception messages,
// tokens, account identifiers, OAuth client identifiers, or token payloads.
function googleAdminVerifyFailureCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/wrong recipient|audience/i.test(message)) return "audience_mismatch";
  if (/expired|expiry date/i.test(message)) return "expired_token";
  if (/not yet valid|used too early|issued at/i.test(message)) return "token_time_invalid";
  if (/wrong number of segments|invalid token|invalid jwt|malformed/i.test(message)) return "malformed_token";
  if (/certificate|signature|invalid signature|no pem found/i.test(message)) return "signature_verification_failed";
  if (/network|fetch|timeout|ETIMEDOUT|ECONNRESET/i.test(message)) return "google_verification_unavailable";
  return "verification_failed_other";
}

// Admin Google sign-in never provisions, links, or promotes accounts.
router.post("/auth/admin-google", async (req, res) => {
  try {
    const idToken = req.body?.idToken;
    if (typeof idToken !== "string" || !idToken) {
      res.status(400).json({ error: "Google login tidak tersedia." });
      return;
    }
    // Resolve the backend audience at request time. A missing Hostinger runtime
    // setting is a configuration fault, not an invalid credential.
    const adminGoogleAudience = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
    if (!adminGoogleAudience) {
      req.log.error({ route: "admin-google", missingConfig: "GOOGLE_CLIENT_ID" }, "Google admin login runtime configuration missing");
      res.status(503).json({ error: "Login Google admin belum dikonfigurasi di server." });
      return;
    }
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken, audience: adminGoogleAudience });
      payload = ticket.getPayload();
    } catch (error) {
      const category = googleAdminVerifyFailureCategory(error);
      req.log.warn({ route: "admin-google", category }, "Google admin credential verification rejected");
      res.status(category === "google_verification_unavailable" ? 503 : 401)
        .json({ error: category === "google_verification_unavailable"
          ? "Verifikasi Google sementara tidak tersedia."
          : "Autentikasi Google gagal." });
      return;
    }
    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      res.status(401).json({ error: "Akun Google belum terverifikasi." });
      return;
    }
    // Accept only an explicitly pre-provisioned invitation after Google verifies
    // the email and subject. A normal Google sign-in can never elevate privileges.
    const verifiedEmail = payload.email.trim().toLowerCase();
    let [user] = await db.select().from(usersTable)
      .where(eq(usersTable.googleId, payload.sub)).limit(1);
    if (user && user.email?.trim().toLowerCase() !== verifiedEmail) {
      res.status(403).json({ error: "Identitas Google tidak cocok dengan akun administrator." });
      return;
    }

    if (!user) {
      const { account: invitation, ambiguous } = await findVerifiedEmailAccount(verifiedEmail);
      if (ambiguous) {
        res.status(409).json({ error: "Email terdaftar lebih dari sekali. Hubungi administrator." });
        return;
      }
      if (invitation?.registrationSource === "admin_invitation" &&
          invitation.accountStatus === "pending_verification" &&
          invitation.role === "customer" && !invitation.googleId) {
        // Compare-and-swap: only a pending invite can be consumed once.
        const [activated] = await db.update(usersTable)
          .set({ googleId: payload.sub, role: "super_admin", accountStatus: "active",
            registrationSource: "admin_invitation_accepted", updatedAt: new Date() })
          .where(and(eq(usersTable.id, invitation.id), sql`lower(trim(${usersTable.email})) = ${verifiedEmail}`,
            eq(usersTable.accountStatus, "pending_verification"),
            eq(usersTable.registrationSource, "admin_invitation"),
            eq(usersTable.role, "customer"), isNull(usersTable.googleId)))
          .returning();
        if (activated) {
          user = activated;
          req.log.info({ route: "admin-google", userId: activated.id },
            "Verified administrator invitation activated");
        }
      }
    }
    // Link existing, approved staff/admin accounts by verified Google email.
    // Never create an admin here or change an existing user's role.
    const adminRoles = ["owner", "admin", "super_admin", "admin_booking", "finance", "staff"];
    if (!user) {
      const { account: existing, ambiguous } = await findVerifiedEmailAccount(verifiedEmail);
      if (ambiguous) {
        res.status(409).json({ error: "Email terdaftar lebih dari sekali. Hubungi administrator." });
        return;
      }
      if (existing && adminRoles.includes(existing.role) &&
          (!existing.accountStatus || existing.accountStatus === "active") &&
          !existing.googleId) {
        const [linked] = await db.update(usersTable)
          .set({ googleId: payload.sub, updatedAt: new Date() })
          .where(and(eq(usersTable.id, existing.id), sql`lower(trim(${usersTable.email})) = ${verifiedEmail}`,
            isNull(usersTable.googleId), eq(usersTable.role, existing.role),
            existing.accountStatus === null ? isNull(usersTable.accountStatus) : eq(usersTable.accountStatus, "active")))
          .returning();
        if (linked) {
          user = linked;
          req.log.info({ route: "admin-google", userId: linked.id }, "Existing admin Google identity linked");
        }
      }
    }
    if (!user || !adminRoles.includes(user.role) ||
        (user.accountStatus && user.accountStatus !== "active")) {
      res.status(403).json({ error: "Akun Google tidak memiliki akses administrator." });
      return;
    }
    const token = createToken(user.id, user.role, null);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email,
      role: user.role, phone: user.phone, tenantId: null, createdAt: user.createdAt } });
  } catch (err) {
    req.log.error({ err }, "Admin Google login error");
    res.status(500).json({ error: "Login Google admin tidak dapat diproses." });
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

    const fonnte = await getFonnteConfig();
    if (
      fonnte.customerToken &&
      fonnte.customerDevice &&
      allowWhatsAppProviderSend({
        channel: "mina",
        recipient: cleaned,
        customerTokenConfigured: true,
      })
    ) {
      try {
        await fetch("https://api.fonnte.com/send", {
          method: "POST",
          headers: {
            Authorization: fonnte.customerToken,
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
      logger.debug(`[DEV] OTP for ${cleaned}: ${otp}`);
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

    let user = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.phone, cleaned))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!user) {
      const displayPhone = "0" + cleaned.slice(2);
      const placeholderEmail = `wa_${cleaned}@wa.sportcenter.local`;
      const [created] = await db
        .insert(usersTable)
        .values({
          name: name ?? displayPhone,
          email: placeholderEmail,
          phone: cleaned,
          passwordHash: crypto.randomBytes(32).toString("hex"),
          role: "customer",
          registrationSource: "whatsapp",
        })
        .returning();
      user = created;
    }

    otpStore.delete(cleaned);

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

router.post("/auth/forgot-password", resetRequestLimiter, async (req, res) => {
  try {
    const email = normalizeResetEmail(req.body?.email);
    const channel = req.body?.channel ?? "whatsapp";
    if (!isValidResetEmail(email) || !["email", "whatsapp"].includes(channel)) {
      res.status(400).json({ error: "Masukkan email dan metode pengiriman yang valid." });
      return;
    }
    // Reject missing transport settings uniformly, including unknown accounts.
    if (channel === "email") {
      try {
        getPasswordResetEmailConfig();
      } catch {
        res.status(503).json({ error: "Layanan email belum tersedia. Gunakan WhatsApp atau hubungi pengelola." });
        return;
      }
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (!user || (user.accountStatus && user.accountStatus !== "active")) {
      res.status(202).json({ success: true, channel, message: RESET_ACCEPTED_MESSAGE });
      return;
    }

    const resetToken = createPasswordResetToken(user);
    if (channel === "email") {
      const baseUrl = new URL(await getBaseUrl());
      if (baseUrl.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && baseUrl.protocol === "http:")) {
        throw new Error("Password reset application URL is invalid");
      }
      const resetUrl = new URL("/reset-password", baseUrl);
      if (req.body?.source === "admin") resetUrl.searchParams.set("source", "admin");
      // Fragments are not sent to the server, access logs, or Referer headers.
      resetUrl.hash = `token=${encodeURIComponent(resetToken)}`;
      try {
        await sendPasswordResetEmail(user.email!, resetUrl.toString());
      } catch {
        // Never log a reset link, SMTP credential, or provider response body.
        req.log.error({ userId: user.id, channel }, "Password reset email delivery failed");
      }
      res.status(202).json({ success: true, channel, message: RESET_ACCEPTED_MESSAGE });
      return;
    }

    if (!user.phone) {
      res.status(202).json({ success: true, channel, message: RESET_ACCEPTED_MESSAGE });
      return;
    }
    const cleaned = cleanPhone(user.phone);
    const fonnte = await getFonnteConfig();
    if (!fonnte.customerToken || !fonnte.customerDevice || !allowWhatsAppProviderSend({
        channel: "mina",
        recipient: cleaned,
        customerTokenConfigured: true,
      })) {
      res.status(503).json({ error: "Layanan WhatsApp belum tersedia. Gunakan email atau hubungi pengelola." });
      return;
    }
    const otp = String(crypto.randomInt(100000, 1000000));
    resetOtpStore.delete(email);
    const provider = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { Authorization: fonnte.customerToken, "Content-Type": "application/json" },
      body: JSON.stringify({ target: cleaned, message: `Kode reset password Sport Center Anda: *${otp}*\n\nBerlaku 5 menit. Jangan bagikan ke siapapun.` }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await provider.json().catch(() => null) as { status?: boolean | string } | null;
    if (!provider.ok || (result?.status !== true && result?.status !== "true")) {
      res.status(503).json({ error: "Kode WhatsApp belum dapat dikirim. Gunakan email atau coba lagi nanti." });
      return;
    }
    const now = Date.now();
    for (const [key, record] of resetOtpStore) if (record.expires <= now) resetOtpStore.delete(key);
    resetOtpStore.set(email, { otpHash: resetOtpHash(email, otp), token: resetToken, attempts: 0, expires: now + 5 * 60 * 1000 });
    res.status(202).json({ success: true, channel, message: RESET_ACCEPTED_MESSAGE });
  } catch {
    req.log.error({ route: "forgot-password" }, "Forgot password request failed");
    res.status(503).json({ error: "Layanan reset belum tersedia. Coba lagi nanti." });
  }
});

router.post("/auth/reset-password", resetConfirmLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body ?? {};
    if (!isValidResetPassword(newPassword)) {
      res.status(400).json({ error: "Kata sandi minimal 8 karakter dan maksimal 72 byte." });
      return;
    }
    let resetToken = token;
    if (token === undefined) {
      const email = normalizeResetEmail(req.body?.email);
      const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
      const record = resetOtpStore.get(email);
      if (!isValidResetEmail(email) || !/^\d{6}$/.test(otp) || !record || record.expires <= Date.now() || record.attempts >= 5) {
        if (record && record.expires <= Date.now()) resetOtpStore.delete(email);
        res.status(400).json({ error: RESET_INVALID_MESSAGE });
        return;
      }
      record.attempts += 1;
      if (!crypto.timingSafeEqual(Buffer.from(record.otpHash, "hex"), Buffer.from(resetOtpHash(email, otp), "hex"))) {
        if (record.attempts >= 5) resetOtpStore.delete(email);
        res.status(400).json({ error: RESET_INVALID_MESSAGE });
        return;
      }
      resetToken = record.token;
      // Claim this OTP synchronously before any asynchronous password work.
      resetOtpStore.delete(email);
    }
    const payload = verifyPasswordResetToken(resetToken);
    if (!payload) {
      res.status(400).json({ error: RESET_INVALID_MESSAGE });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.subject)).limit(1);
    if (!user || !matchesPasswordResetUser(payload, user) || (user.accountStatus && user.accountStatus !== "active")) {
      res.status(400).json({ error: RESET_INVALID_MESSAGE });
      return;
    }

    const passwordHash = await hashPassword(newPassword);
    if (!isValidPasswordHash(passwordHash)) {
      throw new Error("Generated password hash failed validation");
    }

    const [updatedUser] = await db
      .update(usersTable)
      .set({ passwordHash, updatedAt: new Date() })
      // A compare-and-swap makes every link single-use, including two
      // simultaneous requests on different Hostinger instances.
      .where(and(
        eq(usersTable.id, user.id),
        eq(usersTable.email, payload.email),
        user.passwordHash === null ? isNull(usersTable.passwordHash) : eq(usersTable.passwordHash, user.passwordHash),
        user.accountStatus === null ? isNull(usersTable.accountStatus) : eq(usersTable.accountStatus, user.accountStatus),
      ))
      .returning({ id: usersTable.id, passwordHash: usersTable.passwordHash });

    if (!updatedUser) {
      res.status(400).json({ error: RESET_INVALID_MESSAGE });
      return;
    }
    if (updatedUser.id !== user.id || !isValidPasswordHash(updatedUser.passwordHash)) {
      throw new Error("Password hash update was not persisted");
    }

    const verification = await verifyPassword(newPassword, updatedUser.passwordHash);
    if (!verification.valid) {
      throw new Error("Persisted password hash did not verify");
    }

    res.json({ success: true, message: "Password berhasil diubah. Silakan login dengan password baru." });
  } catch {
    req.log.error({ route: "reset-password" }, "Reset password failed");
    res.status(503).json({ error: "Kata sandi belum dapat diubah. Minta reset baru atau coba lagi nanti." });
  }
});

router.put("/auth/profile", authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { name, phone, currentPassword, newPassword } = req.body;

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(401).json({ error: "User not found" }); return; }

    const updates: Record<string, any> = {};

    if (name !== undefined) {
      if (!name.trim()) { res.status(400).json({ error: "Nama tidak boleh kosong" }); return; }
      updates.name = name.trim();
    }

    if (phone !== undefined) {
      updates.phone = phone ? phone.replace(/^0/, "62").replace(/\D/g, "") : null;
    }

    if (newPassword !== undefined) {
      if (newPassword.length < 6) { res.status(400).json({ error: "Password baru minimal 6 karakter" }); return; }
      if (user.passwordHash) {
        if (!currentPassword) { res.status(400).json({ error: "Password saat ini wajib diisi" }); return; }
        const passwordCheck = await verifyPassword(currentPassword, user.passwordHash);
        if (!passwordCheck.valid) {
          res.status(400).json({ error: "Password saat ini salah" }); return;
        }
      }
      updates.passwordHash = hashPassword(newPassword);
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "Tidak ada perubahan" }); return;
    }

    const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();
    res.json({
      id: updated.id, name: updated.name, email: updated.email, role: updated.role,
      phone: updated.phone, googleId: updated.googleId ?? null,
      hasPassword: !!updated.passwordHash, createdAt: updated.createdAt,
    });
  } catch (err) {
    req.log.error({ err }, "Update profile error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/link-google", authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { idToken } = req.body;
    if (!idToken) { res.status(400).json({ error: "idToken is required" }); return; }

    let payload: any;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch {
      res.status(401).json({ error: "Invalid Google token" }); return;
    }
    if (!payload) { res.status(401).json({ error: "Invalid Google token" }); return; }

    const { sub: googleId } = payload;

    const [existing] = await db.select().from(usersTable).where(eq(usersTable.googleId, googleId)).limit(1);
    if (existing && existing.id !== userId) {
      res.status(409).json({ error: "Akun Google ini sudah terhubung ke akun lain" }); return;
    }

    const [updated] = await db.update(usersTable).set({ googleId }).where(eq(usersTable.id, userId)).returning();
    res.json({
      id: updated.id, name: updated.name, email: updated.email, role: updated.role,
      phone: updated.phone, googleId: updated.googleId ?? null,
      hasPassword: !!updated.passwordHash, createdAt: updated.createdAt,
    });
  } catch (err) {
    req.log.error({ err }, "Link Google error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
