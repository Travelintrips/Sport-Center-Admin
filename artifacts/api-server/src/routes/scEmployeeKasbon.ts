import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { syncEmployeeKasbonToSalary } from "../lib/scKasbonSalaryGoogle";
import { db, scEmployeesTable, scEmployeeKasbonTable, auditLogsTable } from "@workspace/db";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";

const router = Router();
const employeePattern = /^SC[0-9]{3,}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const dateValid = (value: unknown): value is string => typeof value === "string" && datePattern.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0,10) === value;
const safeProof = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && value.length <= 2048 && /^https:\/\//.test(value) && !/[\s<>]/.test(value));
function parseInput(body: any) {
 const amount = typeof body?.amount === "string" || typeof body?.amount === "number" ? Number(body.amount) : NaN;
 if (!dateValid(body?.kasbonDate)) return { error: "Tanggal kasbon tidak valid" };
 if (!Number.isFinite(amount) || amount <= 0 || amount > 9999999999999 || Math.round(amount * 100) !== amount * 100) return { error: "Nominal kasbon tidak valid" };
 if (typeof body?.notes !== "string" || body.notes.trim().length > 2000) return { error: "Keterangan maksimal 2000 karakter" };
 if (!safeProof(body?.proofUrl ?? null)) return { error: "Bukti transfer tidak valid" };
 return { data: { kasbonDate: body.kasbonDate as string, amount: amount.toFixed(2), notes: body.notes.trim(), proofUrl: (body.proofUrl ?? null) as string | null } };
}
router.get("/admin/sc-employees/:employeeId/kasbon", adminMiddleware, async (req, res) => {
 const employeeId = String(req.params.employeeId || "").toUpperCase();
 if (!employeePattern.test(employeeId)) { res.status(400).json({error:"ID karyawan tidak valid"}); return; }
 try {
   const [employee] = await db.select({employeeId: scEmployeesTable.employeeId}).from(scEmployeesTable).where(eq(scEmployeesTable.employeeId, employeeId)).limit(1);
   if (!employee) {res.status(404).json({error:"Karyawan tidak ditemukan"}); return;}
   const rows = await db.select().from(scEmployeeKasbonTable).where(eq(scEmployeeKasbonTable.employeeId, employeeId)).orderBy(desc(scEmployeeKasbonTable.kasbonDate), desc(scEmployeeKasbonTable.id));
   res.json(rows);
 } catch {res.status(500).json({error:"Gagal memuat histori kasbon"});}
});
router.post("/admin/sc-employees/:employeeId/kasbon", adminMiddleware, async (req, res) => {
 const employeeId = String(req.params.employeeId || "").toUpperCase();
 if (!employeePattern.test(employeeId)) {res.status(400).json({error:"ID karyawan tidak valid"}); return;}
 if (Object.keys(req.body ?? {}).some(k => !["kasbonDate","amount","notes","proofUrl"].includes(k))) {res.status(400).json({error:"Field kasbon tidak valid"}); return;}
 const parsed = parseInput(req.body);
 if (!parsed.data) {res.status(400).json({error:parsed.error}); return;}
 try {
   const [employee] = await db.select({employeeId: scEmployeesTable.employeeId}).from(scEmployeesTable).where(eq(scEmployeesTable.employeeId, employeeId)).limit(1);
   if (!employee) {res.status(404).json({error:"Karyawan tidak ditemukan"}); return;}
   const [row] = await db.insert(scEmployeeKasbonTable).values({...parsed.data,employeeId}).returning();
   await logAudit({...getUserFromReq(req),action:"SC_KASBON_CREATED",entity:"sc_employee_kasbon",after:row,...getClientInfo(req)});
   res.status(201).json(row);
 } catch {res.status(500).json({error:"Gagal mencatat kasbon"});}
});
router.patch("/admin/sc-employees/:employeeId/kasbon/:id", adminMiddleware, async(req,res)=>{
 const employeeId = String(req.params.employeeId||"").toUpperCase();
 const id = Number(req.params.id);
 if (!employeePattern.test(employeeId) || !Number.isSafeInteger(id) || id < 1) {res.status(400).json({error:"ID tidak valid"});return;}
 if (Object.keys(req.body ?? {}).some(k=>!["kasbonDate","amount","notes","proofUrl"].includes(k))) {res.status(400).json({error:"Field kasbon tidak valid"});return;}
 try {
   const [existing] = await db.select().from(scEmployeeKasbonTable).where(and(eq(scEmployeeKasbonTable.employeeId,employeeId),eq(scEmployeeKasbonTable.id,id))).limit(1);
   if(!existing){res.status(404).json({error:"Catatan tidak ditemukan"});return;}
   const parsed = parseInput({...existing,...req.body});
   if(!parsed.data){res.status(400).json({error:parsed.error});return;}
   const [row] = await db.update(scEmployeeKasbonTable).set(parsed.data).where(and(eq(scEmployeeKasbonTable.employeeId,employeeId),eq(scEmployeeKasbonTable.id,id))).returning();
   await logAudit({...getUserFromReq(req),action:"SC_KASBON_UPDATED",entity:"sc_employee_kasbon",before:existing,after:row,...getClientInfo(req)});
   res.json(row);
 }catch{res.status(500).json({error:"Gagal mengubah kasbon"});}
});
// Delete exactly one record belonging to this employee. The audit write and
// delete share one transaction so neither can silently succeed alone.
router.delete("/admin/sc-employees/:employeeId/kasbon/:id", adminMiddleware, async (req, res) => {
 const employeeId = String(req.params.employeeId || "").toUpperCase();
 const rawId = String(req.params.id || "");
 if (!employeePattern.test(employeeId) || !/^[1-9][0-9]*$/.test(rawId)) {
   res.status(400).json({ error: "ID tidak valid" }); return;
 }
 const id = Number(rawId);
 if (!Number.isSafeInteger(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }
 try {
   const deleted = await db.transaction(async (tx) => {
     const [existing] = await tx.select().from(scEmployeeKasbonTable)
       .where(and(eq(scEmployeeKasbonTable.employeeId, employeeId), eq(scEmployeeKasbonTable.id, id))).limit(1);
     if (!existing) return null;
     const [removed] = await tx.delete(scEmployeeKasbonTable)
       .where(and(eq(scEmployeeKasbonTable.employeeId, employeeId), eq(scEmployeeKasbonTable.id, id))).returning();
     if (!removed) return null;
     const actor = getUserFromReq(req);
     await tx.insert(auditLogsTable).values({
       userId: actor.userId ?? null, userName: actor.userName ?? null, userRole: actor.userRole ?? null,
       action: "SC_KASBON_DELETED", entity: "sc_employee_kasbon", entityId: removed.id,
       before: removed, after: null, ...getClientInfo(req),
     });
     return removed;
   });
   if (!deleted) { res.status(404).json({ error: "Catatan kasbon tidak ditemukan untuk karyawan ini" }); return; }
   res.json({ deleted: true, id: deleted.id, employeeId: deleted.employeeId });
 } catch (error) {
   console.error("[SC_KASBON_DELETE] Failed to delete with audit", error);
   res.status(500).json({ error: "Gagal menghapus kasbon. Data tidak diubah bila audit gagal." });
 }
});

router.post("/admin/sc-employees/:employeeId/kasbon/salary-sync",adminMiddleware,async(req,res)=>{
 const employeeId=String(req.params.employeeId||"").toUpperCase();
 if(!employeePattern.test(employeeId)){res.status(400).json({error:"ID karyawan tidak valid"});return;}
 const action=req.body?.action;
 if(!["preview","sync"].includes(action)||Object.keys(req.body??{}).some(k=>k!=="action")){
  res.status(400).json({error:"Aksi sinkronisasi tidak valid"});return;
 }
 try {
  const [employee]=await db.select({employeeId:scEmployeesTable.employeeId,fullName:scEmployeesTable.fullName}).from(scEmployeesTable).where(eq(scEmployeesTable.employeeId,employeeId)).limit(1);
  if(!employee){res.status(404).json({error:"Karyawan tidak ditemukan"});return;}
  const records=await db.select({amount:scEmployeeKasbonTable.amount}).from(scEmployeeKasbonTable).where(eq(scEmployeeKasbonTable.employeeId,employeeId));
  const total=records.reduce((sum,record)=>sum+Number(record.amount),0);
  if(!Number.isSafeInteger(total)||total<0)throw Error("INVALID_KASBON_TOTAL");
  const outcome=await syncEmployeeKasbonToSalary({employeeId,fullName:employee.fullName,total},action==="preview");
  if(action==="sync")await logAudit({...getUserFromReq(req),action:"SC_KASBON_SALARY_SHEET_SYNCED",entity:"sc_employee_kasbon",after:outcome,...getClientInfo(req)});
  res.json(outcome);
 }catch(e){
  const code=(e as Error).message;
  console.error("[SC_KASBON_SALARY_SYNC]",code);
  res.status(code==="SALARY_SYNC_DISABLED"?503:409).json({error:code});
 }
});

export default router;
