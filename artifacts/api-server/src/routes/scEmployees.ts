import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import { db, scEmployeesTable } from "@workspace/db";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";
import { parseEmployeeSalary } from "./scEmployeeSalary";

const router = Router();
const employeeIdPattern = /^[A-Z0-9_-]{2,32}$/;
const phonePattern = /^62[0-9]{8,13}$/;

export function normalizeEmployeePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const input = value.replace(/[\s()+.-]/g, "");
  const normalized = input.startsWith("0") ? "62" + input.slice(1) : input;
  return phonePattern.test(normalized) ? normalized : null;
}

function validateEmployee(input: any) {
  const employeeId = typeof input?.employeeId === "string" ? input.employeeId.trim().toUpperCase() : "";
  const fullName = typeof input?.fullName === "string" ? input.fullName.trim() : "";
  const whatsappNumber = normalizeEmployeePhone(input?.whatsappNumber);
  const notes = typeof input?.notes === "string" ? input.notes.trim() : "";
  const isActive = input?.isActive === undefined ? true : input.isActive;
  const checkedSalary = parseEmployeeSalary(input?.salary);
  if ("error" in checkedSalary) return { error: checkedSalary.error };
  const salary = checkedSalary.salary;
  if (employeeId && ! employeeIdPattern.test(employeeId)) return { error: "ID Karyawan tidak valid" };
  if (fullName.length < 2 || fullName.length > 150) return { error: "Nama lengkap wajib diisi (2-150 karakter)" };
  if (!whatsappNumber) return { error: "Nomor WhatsApp tidak valid. Gunakan nomor Indonesia, misalnya 081234567890" };
  if (typeof isActive !== "boolean") return { error: "Status harus Aktif atau Nonaktif" };
  if (notes.length > 2000) return { error: "Keterangan maksimal 2000 karakter" };
  return { data: { employeeId, fullName, whatsappNumber, isActive, notes: notes || null, salary } };
}

router.get("/admin/sc-employees", adminMiddleware, async (_req, res) => {
  try {
    const rows = await db.select().from(scEmployeesTable).orderBy(asc(scEmployeesTable.employeeId));
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Gagal memuat Data Karyawan SC" });
  }
});

router.post("/admin/sc-employees", adminMiddleware, async (req, res) => {
  if (req.body?.employeeId !== undefined) { res.status(400).json({ error: "ID Karyawan dibuat otomatis oleh sistem" }); return; }
  const validation = validateEmployee(req.body);
  if (!validation.data) { res.status(400).json({ error: validation.error }); return; }
  try {
    const { employeeId: _generated, ...data } = validation.data;
    const [row] = await db.insert(scEmployeesTable).values(data).returning();
    const actor = getUserFromReq(req);
    await logAudit({ ...actor, action: "SC_EMPLOYEE_CREATED", entity: "sc_employee",  after: row, ...getClientInfo(req) });
    res.status(201).json(row);
  } catch (error: any) {
    res.status(error?.code === "23505" ? 409 : 500).json({ error: error?.code === "23505" ? "ID Karyawan atau nomor WhatsApp sudah digunakan" : "Gagal menambah karyawan" });
  }
});

router.patch("/admin/sc-employees/:id", adminMiddleware, async (req, res) => {
  const employeeId = String(req.params.id ?? "").toUpperCase();
  if (!employeeIdPattern.test(employeeId)) { res.status(400).json({ error: "ID tidak valid" }); return; }
  try {
    const [existing] = await db.select().from(scEmployeesTable).where(eq(scEmployeesTable.employeeId, employeeId)).limit(1);
    if (!existing) { res.status(404).json({ error: "Karyawan tidak ditemukan" }); return; }
    const permitted = ["fullName", "whatsappNumber", "isActive", "notes", "salary"];
    if (!Object.keys(req.body ?? {}).length || Object.keys(req.body ?? {}).some((key) => !permitted.includes(key))) {
      res.status(400).json({ error: "Field perubahan tidak valid" }); return;
    }
    const validation = validateEmployee({ ...existing, ...req.body, employeeId });
    if (!validation.data) { res.status(400).json({ error: validation.error }); return; }
    const { employeeId: _immutable, ...updates } = validation.data;
    const [row] = await db.update(scEmployeesTable).set(updates).where(eq(scEmployeesTable.employeeId, employeeId)).returning();
    await logAudit({ ...getUserFromReq(req), action: existing.isActive && !row!.isActive ? "SC_EMPLOYEE_DEACTIVATED" : "SC_EMPLOYEE_UPDATED", entity: "sc_employee",  before: existing, after: row, ...getClientInfo(req) });
    res.json(row);
  } catch (error: any) {
    res.status(error?.code === "23505" ? 409 : 500).json({ error: error?.code === "23505" ? "Nomor WhatsApp sudah digunakan" : "Gagal memperbarui karyawan" });
  }
});

export default router;

