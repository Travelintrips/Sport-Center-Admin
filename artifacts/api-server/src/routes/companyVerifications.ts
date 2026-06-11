import { Router } from "express";
import { randomBytes } from "crypto";
import { db, usersTable, companyUsersTable, companyVerificationsTable, companyVerificationTokensTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { adminMiddleware, authMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";

const router = Router();
const APP_URL = process.env.APP_URL ?? "";

// ─── GET /companies — public: list all company accounts ──────────────────────
router.get("/companies", async (req, res) => {
  try {
    const companies = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      companyName: usersTable.companyName,
    }).from(usersTable).where(eq(usersTable.accountType, "company"));
    res.json(companies);
  } catch (err) {
    req.log.error({ err }, "List companies error");
    res.status(500).json({ error: "Internal server error" });
  }
});

async function sendWA(phone: string, message: string): Promise<void> {
  const fonnteToken = process.env.FONNTE_TOKEN || "";
  if (!fonnteToken || !phone) return;
  try {
    const cleanPhone = phone.replace(/^0/, "62").replace(/\D/g, "");
    await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { Authorization: fonnteToken, "Content-Type": "application/json" },
      body: JSON.stringify({ target: cleanPhone, message }),
    });
  } catch { /* non-critical */ }
}

function createVerifToken(): string {
  return randomBytes(32).toString("hex");
}

async function generateTokenPair(verificationId: number): Promise<{ approveToken: string; rejectToken: string }> {
  const approveToken = createVerifToken();
  const rejectToken = createVerifToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 jam

  await db.insert(companyVerificationTokensTable).values([
    { token: approveToken, verificationId, action: "approve", expiresAt },
    { token: rejectToken, verificationId, action: "reject", expiresAt },
  ]);

  return { approveToken, rejectToken };
}

// ─── GET /company-verifications — admin: list all ─────────────────────────────
router.get("/company-verifications", adminMiddleware, async (req, res) => {
  try {
    const { status, companyId } = req.query;

    let verifications = await db.select().from(companyVerificationsTable)
      .orderBy(desc(companyVerificationsTable.requestedAt));

    if (status) verifications = verifications.filter((v) => v.status === status);
    if (companyId) verifications = verifications.filter((v) => v.companyId === parseInt(String(companyId)));

    const userIds = Array.from(new Set([
      ...verifications.map((v) => v.customerId),
      ...verifications.map((v) => v.companyId),
      ...verifications.filter((v) => v.approvedBy).map((v) => v.approvedBy!),
    ]));

    const users = userIds.length > 0
      ? await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, phone: usersTable.phone, companyName: usersTable.companyName })
          .from(usersTable).where(eq(usersTable.id, userIds[0]))
      : [];
    const allUsers = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, phone: usersTable.phone, companyName: usersTable.companyName }).from(usersTable);
    const userMap = Object.fromEntries(allUsers.map((u) => [u.id, u]));

    const result = verifications.map((v) => ({
      ...v,
      customerName: userMap[v.customerId]?.name ?? "",
      customerEmail: userMap[v.customerId]?.email ?? "",
      customerPhone: userMap[v.customerId]?.phone ?? "",
      companyName: userMap[v.companyId]?.companyName ?? userMap[v.companyId]?.name ?? "",
      approvedByName: v.approvedBy ? (userMap[v.approvedBy]?.name ?? "") : null,
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List company verifications error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /company-verifications/my — customer: get own verifications ──────────
router.get("/company-verifications/my", authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user;
    const verifications = await db.select().from(companyVerificationsTable)
      .where(eq(companyVerificationsTable.customerId, userId))
      .orderBy(desc(companyVerificationsTable.requestedAt));

    const companyIds = [...new Set(verifications.map((v) => v.companyId))];
    const companies = await db.select({ id: usersTable.id, name: usersTable.name, companyName: usersTable.companyName })
      .from(usersTable);
    const companyMap = Object.fromEntries(companies.map((c) => [c.id, c.companyName ?? c.name]));

    // Also fetch companyUser record for billing status
    const companyUsers = await db.select().from(companyUsersTable).where(eq(companyUsersTable.customerId, userId));
    const companyUserMap = Object.fromEntries(companyUsers.map((cu) => [cu.companyId, cu]));

    const result = verifications.map((v) => ({
      ...v,
      companyName: companyMap[v.companyId] ?? "",
      corporateBillingEnabled: companyUserMap[v.companyId]?.corporateBillingEnabled ?? false,
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Get my verifications error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /company-verifications/billing-status — customer: check if can use corporate billing
router.get("/company-verifications/billing-status", authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user;
    const [companyUser] = await db.select().from(companyUsersTable)
      .where(and(eq(companyUsersTable.customerId, userId), eq(companyUsersTable.verificationStatus, "approved"), eq(companyUsersTable.corporateBillingEnabled, true)))
      .limit(1);

    if (!companyUser) {
      res.json({ eligible: false });
      return;
    }

    const [company] = await db.select({ id: usersTable.id, name: usersTable.name, companyName: usersTable.companyName })
      .from(usersTable).where(eq(usersTable.id, companyUser.companyId)).limit(1);

    res.json({
      eligible: true,
      companyId: companyUser.companyId,
      companyName: company?.companyName ?? company?.name ?? "",
      employeeId: companyUser.employeeId,
    });
  } catch (err) {
    req.log.error({ err }, "Check billing status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /company-verifications/:id — admin: get detail ──────────────────────
router.get("/company-verifications/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [v] = await db.select().from(companyVerificationsTable).where(eq(companyVerificationsTable.id, id)).limit(1);
    if (!v) { res.status(404).json({ error: "Not found" }); return; }

    const allUsers = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, phone: usersTable.phone, companyName: usersTable.companyName }).from(usersTable);
    const userMap = Object.fromEntries(allUsers.map((u) => [u.id, u]));

    res.json({
      ...v,
      customerName: userMap[v.customerId]?.name ?? "",
      customerEmail: userMap[v.customerId]?.email ?? "",
      customerPhone: userMap[v.customerId]?.phone ?? "",
      companyName: userMap[v.companyId]?.companyName ?? userMap[v.companyId]?.name ?? "",
      approvedByName: v.approvedBy ? (userMap[v.approvedBy]?.name ?? "") : null,
    });
  } catch (err) {
    req.log.error({ err }, "Get company verification error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /company-verifications — customer submits request ───────────────────
router.post("/company-verifications", authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user;
    const { companyId, employeeId, officeEmail, idCardUrl } = req.body;

    if (!companyId || !employeeId) {
      res.status(400).json({ error: "companyId dan employeeId wajib diisi" });
      return;
    }

    // Validate company exists and is company type
    const [company] = await db.select().from(usersTable)
      .where(and(eq(usersTable.id, parseInt(String(companyId))), eq(usersTable.accountType, "company")))
      .limit(1);
    if (!company) {
      res.status(404).json({ error: "Perusahaan tidak ditemukan" });
      return;
    }

    const trimmedEmployeeId = String(employeeId).trim().toUpperCase();

    // Check duplicate employee ID in same company
    const [dupEmployee] = await db.select().from(companyUsersTable)
      .where(and(eq(companyUsersTable.companyId, company.id), eq(companyUsersTable.employeeId, trimmedEmployeeId)))
      .limit(1);
    if (dupEmployee) {
      res.status(409).json({ error: "ID karyawan sudah terdaftar di perusahaan ini" });
      return;
    }

    // Check if customer already has a pending/approved verification for this company
    const [existing] = await db.select().from(companyVerificationsTable)
      .where(and(eq(companyVerificationsTable.customerId, userId), eq(companyVerificationsTable.companyId, company.id)))
      .orderBy(desc(companyVerificationsTable.requestedAt))
      .limit(1);
    if (existing && (existing.status === "pending" || existing.status === "approved")) {
      res.status(409).json({ error: "Anda sudah memiliki permintaan verifikasi aktif untuk perusahaan ini" });
      return;
    }

    // Get customer info
    const [customer] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);

    // Create company_user record
    const [companyUser] = await db.insert(companyUsersTable).values({
      companyId: company.id,
      customerId: userId,
      employeeId: trimmedEmployeeId,
      officeEmail: officeEmail?.trim() || null,
      idCardUrl: idCardUrl || null,
      verificationStatus: "pending",
      corporateBillingEnabled: false,
    }).returning();

    // Create verification record
    const [verification] = await db.insert(companyVerificationsTable).values({
      companyUserId: companyUser.id,
      companyId: company.id,
      customerId: userId,
      employeeId: trimmedEmployeeId,
      officeEmail: officeEmail?.trim() || null,
      idCardUrl: idCardUrl || null,
      status: "pending",
    }).returning();

    // Generate approve/reject tokens
    const { approveToken, rejectToken } = await generateTokenPair(verification.id);

    // Send WA to company PIC
    const picPhone = company.picPhone;
    if (picPhone) {
      const approveUrl = `${APP_URL}/wa/verify/${approveToken}`;
      const rejectUrl = `${APP_URL}/wa/verify/${rejectToken}`;
      const msg =
        `🔔 *Permintaan Verifikasi Karyawan*\n\n` +
        `Karyawan *${customer?.name ?? ""}* mengajukan verifikasi untuk bergabung sebagai karyawan *${company.companyName ?? company.name}*.\n\n` +
        `📋 *Detail:*\n` +
        `• Nama: ${customer?.name ?? ""}\n` +
        `• ID Karyawan: ${trimmedEmployeeId}\n` +
        `${officeEmail ? `• Email Kantor: ${officeEmail}\n` : ""}` +
        `\n✅ Setujui: ${approveUrl}\n❌ Tolak: ${rejectUrl}\n\n` +
        `_Link berlaku 24 jam_`;
      sendWA(picPhone, msg);
    }

    // Audit log
    const clientInfo = getClientInfo(req);
    await logAudit({
      ...getUserFromReq(req),
      action: "COMPANY_VERIFICATION_REQUESTED",
      entity: "company_verification",
      entityId: verification.id,
      after: { companyId: company.id, companyName: company.companyName ?? company.name, employeeId: trimmedEmployeeId },
      ...clientInfo,
    });

    res.status(201).json({
      ...verification,
      companyName: company.companyName ?? company.name,
    });
  } catch (err) {
    req.log.error({ err }, "Submit company verification error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /company-verifications/:id/approve — admin inline approve ──────────
router.patch("/company-verifications/:id/approve", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const adminUser = (req as any).user;

    const [v] = await db.select().from(companyVerificationsTable).where(eq(companyVerificationsTable.id, id)).limit(1);
    if (!v) { res.status(404).json({ error: "Not found" }); return; }
    if (v.status !== "pending") { res.status(400).json({ error: "Hanya permintaan pending yang bisa disetujui" }); return; }

    // Update verification
    const [updated] = await db.update(companyVerificationsTable)
      .set({ status: "approved", approvedAt: new Date(), approvedBy: adminUser.userId })
      .where(eq(companyVerificationsTable.id, id))
      .returning();

    // Update company_user
    if (v.companyUserId) {
      await db.update(companyUsersTable)
        .set({ verificationStatus: "approved", corporateBillingEnabled: true, verifiedAt: new Date(), verifiedBy: adminUser.userId })
        .where(eq(companyUsersTable.id, v.companyUserId));
    }

    // Notify customer
    const [customer] = await db.select().from(usersTable).where(eq(usersTable.id, v.customerId)).limit(1);
    const [company] = await db.select().from(usersTable).where(eq(usersTable.id, v.companyId)).limit(1);
    if (customer?.phone) {
      sendWA(customer.phone,
        `✅ *Verifikasi Karyawan Disetujui!*\n\n` +
        `Halo *${customer.name}*,\n` +
        `Permintaan verifikasi Anda sebagai karyawan *${company?.companyName ?? company?.name ?? ""}* (ID: ${v.employeeId}) telah *DISETUJUI* ✅\n\n` +
        `Anda sekarang bisa menggunakan tagihan perusahaan saat booking. 🏆`
      );
    }

    const clientInfo = getClientInfo(req);
    await logAudit({
      ...getUserFromReq(req),
      action: "COMPANY_VERIFICATION_APPROVED",
      entity: "company_verification",
      entityId: id,
      after: { companyId: v.companyId, customerId: v.customerId, employeeId: v.employeeId },
      ...clientInfo,
    });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Approve company verification error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /company-verifications/:id/reject — admin inline reject ────────────
router.patch("/company-verifications/:id/reject", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const adminUser = (req as any).user;
    const { rejectionReason } = req.body;

    const [v] = await db.select().from(companyVerificationsTable).where(eq(companyVerificationsTable.id, id)).limit(1);
    if (!v) { res.status(404).json({ error: "Not found" }); return; }
    if (v.status !== "pending") { res.status(400).json({ error: "Hanya permintaan pending yang bisa ditolak" }); return; }

    const [updated] = await db.update(companyVerificationsTable)
      .set({ status: "rejected", rejectionReason: rejectionReason ?? null, approvedBy: adminUser.userId })
      .where(eq(companyVerificationsTable.id, id))
      .returning();

    if (v.companyUserId) {
      await db.update(companyUsersTable)
        .set({ verificationStatus: "rejected", rejectionReason: rejectionReason ?? null, verifiedBy: adminUser.userId })
        .where(eq(companyUsersTable.id, v.companyUserId));
    }

    const [customer] = await db.select().from(usersTable).where(eq(usersTable.id, v.customerId)).limit(1);
    const [company] = await db.select().from(usersTable).where(eq(usersTable.id, v.companyId)).limit(1);
    if (customer?.phone) {
      sendWA(customer.phone,
        `❌ *Verifikasi Karyawan Ditolak*\n\n` +
        `Halo *${customer.name}*,\n` +
        `Maaf, permintaan verifikasi Anda sebagai karyawan *${company?.companyName ?? company?.name ?? ""}* (ID: ${v.employeeId}) *DITOLAK* ❌\n` +
        (rejectionReason ? `\nAlasan: _${rejectionReason}_\n` : "") +
        `\nSilakan hubungi admin untuk informasi lebih lanjut.`
      );
    }

    const clientInfo = getClientInfo(req);
    await logAudit({
      ...getUserFromReq(req),
      action: "COMPANY_VERIFICATION_REJECTED",
      entity: "company_verification",
      entityId: id,
      after: { companyId: v.companyId, customerId: v.customerId, employeeId: v.employeeId, rejectionReason },
      ...clientInfo,
    });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Reject company verification error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /company-verifications/:id/revoke — admin revoke ───────────────────
router.patch("/company-verifications/:id/revoke", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));

    const [v] = await db.select().from(companyVerificationsTable).where(eq(companyVerificationsTable.id, id)).limit(1);
    if (!v) { res.status(404).json({ error: "Not found" }); return; }

    const [updated] = await db.update(companyVerificationsTable)
      .set({ status: "revoked" })
      .where(eq(companyVerificationsTable.id, id))
      .returning();

    if (v.companyUserId) {
      await db.update(companyUsersTable)
        .set({ verificationStatus: "revoked", corporateBillingEnabled: false })
        .where(eq(companyUsersTable.id, v.companyUserId));
    }

    const [customer] = await db.select().from(usersTable).where(eq(usersTable.id, v.customerId)).limit(1);
    const [company] = await db.select().from(usersTable).where(eq(usersTable.id, v.companyId)).limit(1);
    if (customer?.phone) {
      sendWA(customer.phone,
        `⚠️ *Akses Tagihan Perusahaan Dicabut*\n\n` +
        `Halo *${customer.name}*,\n` +
        `Akses Anda sebagai karyawan *${company?.companyName ?? company?.name ?? ""}* telah *DICABUT*.\n\n` +
        `Anda tidak bisa lagi menggunakan tagihan perusahaan. Silakan hubungi admin untuk informasi lebih lanjut.`
      );
    }

    const clientInfo = getClientInfo(req);
    await logAudit({
      ...getUserFromReq(req),
      action: "COMPANY_ACCESS_REVOKED",
      entity: "company_verification",
      entityId: id,
      after: { companyId: v.companyId, customerId: v.customerId, employeeId: v.employeeId },
      ...clientInfo,
    });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Revoke company verification error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /company-users/:id/toggle-billing — admin toggle corporate_billing_enabled ──
router.patch("/company-users/:id/toggle-billing", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const { enabled } = req.body;

    const [cu] = await db.select().from(companyUsersTable).where(eq(companyUsersTable.id, id)).limit(1);
    if (!cu) { res.status(404).json({ error: "Not found" }); return; }
    if (cu.verificationStatus !== "approved") { res.status(400).json({ error: "Hanya karyawan approved yang bisa toggle billing" }); return; }

    const [updated] = await db.update(companyUsersTable)
      .set({ corporateBillingEnabled: Boolean(enabled) })
      .where(eq(companyUsersTable.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Toggle billing error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /company-users/by-company/:companyId — admin: list approved members ──
router.get("/company-users/by-company/:companyId", adminMiddleware, async (req, res) => {
  try {
    const companyId = parseInt(String(req.params.companyId));
    const members = await db.select().from(companyUsersTable)
      .where(eq(companyUsersTable.companyId, companyId));

    const allUsers = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, phone: usersTable.phone })
      .from(usersTable);
    const userMap = Object.fromEntries(allUsers.map((u) => [u.id, u]));

    const result = members.map((m) => ({
      ...m,
      customerName: userMap[m.customerId]?.name ?? "",
      customerEmail: userMap[m.customerId]?.email ?? "",
      customerPhone: userMap[m.customerId]?.phone ?? "",
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Get company members error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /wa/verify/:token — HTML approve/reject page ────────────────────────
router.get("/wa/verify/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const [tokenRow] = await db.select().from(companyVerificationTokensTable)
      .where(eq(companyVerificationTokensTable.token, token)).limit(1);

    if (!tokenRow) {
      res.status(404).send(htmlPage("Token Tidak Valid", `<p style="color:#ef4444">Link tidak valid atau sudah kedaluwarsa.</p>`));
      return;
    }
    if (tokenRow.usedAt) {
      res.send(htmlPage("Sudah Diproses", `<p style="color:#64748b">Permintaan ini sudah diproses sebelumnya.</p>`));
      return;
    }
    if (tokenRow.expiresAt && tokenRow.expiresAt < new Date()) {
      res.send(htmlPage("Link Kedaluwarsa", `<p style="color:#ef4444">Link ini sudah kedaluwarsa (berlaku 24 jam).</p>`));
      return;
    }

    const [v] = await db.select().from(companyVerificationsTable)
      .where(eq(companyVerificationsTable.id, tokenRow.verificationId)).limit(1);
    if (!v || v.status !== "pending") {
      res.send(htmlPage("Sudah Diproses", `<p style="color:#64748b">Permintaan ini sudah diproses sebelumnya.</p>`));
      return;
    }

    const allUsers = await db.select({ id: usersTable.id, name: usersTable.name, companyName: usersTable.companyName })
      .from(usersTable);
    const userMap = Object.fromEntries(allUsers.map((u) => [u.id, u]));
    const customerName = userMap[v.customerId]?.name ?? "";
    const companyName = userMap[v.companyId]?.companyName ?? userMap[v.companyId]?.name ?? "";
    const action = tokenRow.action;

    const actionLabel = action === "approve" ? "Setujui" : "Tolak";
    const btnColor = action === "approve" ? "#22c55e" : "#ef4444";

    res.send(htmlPage(
      `${actionLabel} Verifikasi Karyawan`,
      `<div style="max-width:420px;margin:0 auto;padding:24px">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:20px">
          <p style="margin:0 0 8px"><strong>Karyawan:</strong> ${escHtml(customerName)}</p>
          <p style="margin:0 0 8px"><strong>Perusahaan:</strong> ${escHtml(companyName)}</p>
          <p style="margin:0"><strong>ID Karyawan:</strong> ${escHtml(v.employeeId)}</p>
          ${v.officeEmail ? `<p style="margin:8px 0 0"><strong>Email Kantor:</strong> ${escHtml(v.officeEmail)}</p>` : ""}
          ${v.idCardUrl ? `<p style="margin:8px 0 0"><a href="${escHtml(v.idCardUrl)}" target="_blank" style="color:#3b82f6">📎 Lihat ID Card</a></p>` : ""}
        </div>
        <form method="POST" action="/api/wa/verify-action/${escHtml(token)}">
          ${action === "reject" ? `
          <div style="margin-bottom:16px">
            <label style="display:block;margin-bottom:6px;font-weight:600">Alasan Penolakan (opsional):</label>
            <textarea name="rejectionReason" rows="3" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box" placeholder="Misal: ID tidak valid, bukan karyawan aktif..."></textarea>
          </div>` : ""}
          <button type="submit" style="background:${btnColor};color:#fff;border:none;padding:14px 28px;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;width:100%">
            ${actionLabel} Verifikasi
          </button>
        </form>
      </div>`
    ));
  } catch (err) {
    console.error("[wa/verify] error:", err);
    res.status(500).send(htmlPage("Error", `<p>Terjadi kesalahan. Silakan coba lagi.</p>`));
  }
});

// ─── POST /wa/verify-action/:token — process approve/reject ──────────────────
router.post("/wa/verify-action/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { rejectionReason } = req.body;

    const [tokenRow] = await db.select().from(companyVerificationTokensTable)
      .where(eq(companyVerificationTokensTable.token, token)).limit(1);

    if (!tokenRow) {
      res.send(htmlPage("Token Tidak Valid", `<p style="color:#ef4444">Link tidak valid.</p>`));
      return;
    }
    if (tokenRow.usedAt) {
      res.send(htmlPage("Sudah Diproses", `<p style="color:#64748b">Permintaan ini sudah diproses sebelumnya.</p>`));
      return;
    }
    if (tokenRow.expiresAt && tokenRow.expiresAt < new Date()) {
      res.send(htmlPage("Link Kedaluwarsa", `<p style="color:#ef4444">Link ini sudah kedaluwarsa.</p>`));
      return;
    }

    const [v] = await db.select().from(companyVerificationsTable)
      .where(eq(companyVerificationsTable.id, tokenRow.verificationId)).limit(1);

    if (!v || v.status !== "pending") {
      res.send(htmlPage("Sudah Diproses", `<p style="color:#64748b">Permintaan ini sudah diproses sebelumnya.</p>`));
      return;
    }

    // Mark token as used
    await db.update(companyVerificationTokensTable).set({ usedAt: new Date() }).where(eq(companyVerificationTokensTable.token, token));

    // Mark other token for same verification as used too
    await db.update(companyVerificationTokensTable).set({ usedAt: new Date() })
      .where(and(eq(companyVerificationTokensTable.verificationId, v.id)));

    const allUsers = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, companyName: usersTable.companyName })
      .from(usersTable);
    const userMap = Object.fromEntries(allUsers.map((u) => [u.id, u]));
    const customer = userMap[v.customerId];
    const company = userMap[v.companyId];

    if (tokenRow.action === "approve") {
      await db.update(companyVerificationsTable)
        .set({ status: "approved", approvedAt: new Date() })
        .where(eq(companyVerificationsTable.id, v.id));

      if (v.companyUserId) {
        await db.update(companyUsersTable)
          .set({ verificationStatus: "approved", corporateBillingEnabled: true, verifiedAt: new Date() })
          .where(eq(companyUsersTable.id, v.companyUserId));
      }

      if (customer?.phone) {
        sendWA(customer.phone,
          `✅ *Verifikasi Karyawan Disetujui!*\n\n` +
          `Halo *${customer.name}*,\n` +
          `Anda telah *DISETUJUI* sebagai karyawan *${company?.companyName ?? company?.name ?? ""}* (ID: ${v.employeeId}) ✅\n\n` +
          `Anda sekarang bisa menggunakan tagihan perusahaan saat booking. 🏆`
        );
      }

      await logAudit({
        action: "COMPANY_VERIFICATION_APPROVED",
        entity: "company_verification",
        entityId: v.id,
        after: { companyId: v.companyId, customerId: v.customerId, employeeId: v.employeeId, method: "wa_link" },
      });

      res.send(htmlPage("✅ Verifikasi Disetujui", `
        <div style="text-align:center;padding:32px">
          <div style="font-size:64px">✅</div>
          <h2 style="color:#22c55e">Verifikasi Disetujui!</h2>
          <p>Karyawan <strong>${escHtml(customer?.name ?? "")}</strong> (ID: ${escHtml(v.employeeId)}) sudah dapat menggunakan tagihan perusahaan <strong>${escHtml(company?.companyName ?? company?.name ?? "")}</strong>.</p>
        </div>
      `));
    } else {
      await db.update(companyVerificationsTable)
        .set({ status: "rejected", rejectionReason: rejectionReason || null })
        .where(eq(companyVerificationsTable.id, v.id));

      if (v.companyUserId) {
        await db.update(companyUsersTable)
          .set({ verificationStatus: "rejected", rejectionReason: rejectionReason || null })
          .where(eq(companyUsersTable.id, v.companyUserId));
      }

      if (customer?.phone) {
        sendWA(customer.phone,
          `❌ *Verifikasi Karyawan Ditolak*\n\n` +
          `Halo *${customer.name}*,\n` +
          `Maaf, verifikasi Anda sebagai karyawan *${company?.companyName ?? company?.name ?? ""}* (ID: ${v.employeeId}) *DITOLAK* ❌\n` +
          (rejectionReason ? `\nAlasan: _${rejectionReason}_\n` : "") +
          `\nHubungi admin untuk informasi lebih lanjut.`
        );
      }

      await logAudit({
        action: "COMPANY_VERIFICATION_REJECTED",
        entity: "company_verification",
        entityId: v.id,
        after: { companyId: v.companyId, customerId: v.customerId, employeeId: v.employeeId, rejectionReason, method: "wa_link" },
      });

      res.send(htmlPage("❌ Verifikasi Ditolak", `
        <div style="text-align:center;padding:32px">
          <div style="font-size:64px">❌</div>
          <h2 style="color:#ef4444">Verifikasi Ditolak</h2>
          <p>Karyawan <strong>${escHtml(customer?.name ?? "")}</strong> (ID: ${escHtml(v.employeeId)}) telah diberitahu.</p>
          ${rejectionReason ? `<p style="color:#64748b">Alasan: ${escHtml(rejectionReason)}</p>` : ""}
        </div>
      `));
    }
  } catch (err) {
    console.error("[wa/verify-action] error:", err);
    res.status(500).send(htmlPage("Error", `<p>Terjadi kesalahan. Silakan coba lagi.</p>`));
  }
});

function escHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)} — Sport Center</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f2f5; margin: 0; padding: 20px; color: #1e293b; }
  .card { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); max-width: 480px; margin: 40px auto; overflow: hidden; }
  .header { background: linear-gradient(135deg, #ea580c, #f97316); color: #fff; padding: 20px 24px; }
  .header h1 { margin: 0; font-size: 18px; font-weight: 700; }
  .header p { margin: 4px 0 0; font-size: 13px; opacity: 0.8; }
  .content { padding: 24px; }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <h1>Sport Center Jakarta</h1>
    <p>Verifikasi Karyawan</p>
  </div>
  <div class="content">
    <h2 style="margin:0 0 16px;font-size:18px">${escHtml(title)}</h2>
    ${body}
  </div>
</div>
</body>
</html>`;
}

export default router;
