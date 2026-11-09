import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { snapshotKasbonRecords, getKasbonReceiptStatus, type SalarySyncReceipt } from "../lib/scKasbonSalarySnapshot";
import {assertKasbonPeriod,recordsForKasbonPeriod,monthlyKasbonTotal} from "../lib/scKasbonMonthlyPeriod";
import { syncEmployeeKasbonToSalary } from "../lib/scKasbonSalaryGoogle";
import { kasbonPoolTick } from "../lib/scKasbonPoolAutoWorker";
import {verifyKasbonPassword,issueKasbonGrant,checkKasbonGrant} from "../lib/scKasbonActionGate";
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
// Dedicated password gate. A normal admin/owner/super_admin login is never enough.
router.post("/admin/sc-employees/:employeeId/kasbon/:id/unlock",adminMiddleware,async(req,res)=>{
 const employeeId=String(req.params.employeeId??"").toUpperCase(),id=Number(req.params.id);
 const actor=getUserFromReq(req);
 if(!employeePattern.test(employeeId)||!Number.isSafeInteger(id)||id<1||!actor.userId){
  res.status(403).json({error:"KASBON_AUTH_REQUIRED"});return;
 }
 if(!req.body||Object.keys(req.body).some(key=>key!=="password")){
  res.status(400).json({error:"KASBON_PASSWORD_REQUIRED"});return;
 }
 try {
  const [existing]=await db.select({id:scEmployeeKasbonTable.id}).from(scEmployeeKasbonTable)
   .where(and(eq(scEmployeeKasbonTable.id,id),eq(scEmployeeKasbonTable.employeeId,employeeId))).limit(1);
  if(!existing){res.status(404).json({error:"Kasbon tidak ditemukan"});return;}
  const outcome=await verifyKasbonPassword(req.body.password,actor.userId,req.ip??"unknown");
  if(outcome.status!=="ok"){
   await logAudit({...actor,action:"SC_KASBON_ACTION_UNLOCK_DENIED",entity:"sc_employee_kasbon",
    entityId:id,after:{employeeId,reason:outcome.status},...getClientInfo(req)});
   res.status(outcome.status==="disabled"?503:outcome.status==="locked"?429:403)
    .json({error:outcome.status==="disabled"?"KASBON_GATE_NOT_CONFIGURED":outcome.status==="locked"?"KASBON_AUTH_LOCKED":"KASBON_PASSWORD_INVALID"});return;
  }
  const authorization=issueKasbonGrant(actor.userId,employeeId,id);
  await logAudit({...actor,action:"SC_KASBON_ACTION_UNLOCKED",entity:"sc_employee_kasbon",entityId:id,after:{employeeId},...getClientInfo(req)});
  res.setHeader("Cache-Control","no-store");
  res.json({authorization,expiresInSeconds:90});
 }catch(error){
  console.error("[SC_KASBON_UNLOCK] verification failed",error instanceof Error?error.name:"UNKNOWN");
  res.status(503).json({error:"KASBON_AUTH_UNAVAILABLE"});
 }
});
function requireKasbonActionGrant(req:import("express").Request,res:import("express").Response):boolean {
 const actor=getUserFromReq(req),employeeId=String(req.params.employeeId??"").toUpperCase(),id=Number(req.params.id);
 const token=req.get("x-sc-kasbon-authorization");
 if(!actor.userId||!checkKasbonGrant(token,actor.userId,employeeId,id)){
  res.status(403).json({error:"KASBON_ACTION_PASSWORD_REQUIRED"});return false;
 }
 return true;
}
router.patch("/admin/sc-employees/:employeeId/kasbon/:id", adminMiddleware, async(req,res)=>{
 const employeeId = String(req.params.employeeId||"").toUpperCase();
 const id = Number(req.params.id);
 if (!employeePattern.test(employeeId) || !Number.isSafeInteger(id) || id < 1) {res.status(400).json({error:"ID tidak valid"});return;}
 if(!requireKasbonActionGrant(req,res))return;
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
 if(!requireKasbonActionGrant(req,res))return;
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


/** Manual one-record trigger for the EXISTING idempotent Kasbon POOL outbox.
 * It must never bypass the production kill switch or infer Sheets insertion from a DB save.
 */
router.post("/admin/sc-employees/:employeeId/kasbon/:id/pool-sync",adminMiddleware,async(req,res)=>{
 const employeeId=String(req.params.employeeId||"").toUpperCase(), id=Number(req.params.id);
 if(!employeePattern.test(employeeId)||!Number.isSafeInteger(id)||id<1){
  res.status(400).json({error:"ID kasbon tidak valid"});return;
 }
 try{
  const [record]=await db.select({id:scEmployeeKasbonTable.id}).from(scEmployeeKasbonTable)
   .where(and(eq(scEmployeeKasbonTable.id,id),eq(scEmployeeKasbonTable.employeeId,employeeId))).limit(1);
  if(!record){res.status(404).json({error:"Kasbon tidak ditemukan"});return;}
  const readStatus=async()=>{
   const ledger=await db.execute(sql`SELECT sheet_cell,amount,synced_at
    FROM sport_center.sc_kasbon_pool_sync_ledger WHERE kasbon_id=${id} LIMIT 1`);
   const linked=Array.isArray(ledger)?ledger[0]:(ledger as unknown as {rows?:Record<string,unknown>[]}).rows?.[0];
   if(linked)return {status:"synced",cell:String(linked.sheet_cell),amount:Number(linked.amount)};
   const events=await db.execute(sql`SELECT status,last_error_code,event_type FROM sport_center.sc_kasbon_pool_sync_events
    WHERE kasbon_id=${id} ORDER BY id DESC LIMIT 1`);
   const event=Array.isArray(events)?events[0]:(events as unknown as {rows?:Record<string,unknown>[]}).rows?.[0];
   return event?{status:String(event.status),errorCode:event.last_error_code??null,eventType:event.event_type}:
    {status:"needs_review",errorCode:"POOL_OUTBOX_EVENT_MISSING"};
  };
  if(process.env.SC_KASBON_POOL_SYNC_ENABLED!=="true"){
   res.json({status:"disabled",errorCode:"POOL_SYNC_NOT_ENABLED",message:"Kasbon tersimpan, tetapi sync Kasbon POOL belum diaktifkan."});return;
  }
  const initial=await readStatus();
  if(initial.status==="synced" || initial.status==="needs_review"){
   res.json(initial);return;
  }
  if(initial.status==="pending")await kasbonPoolTick(id);
  res.json(await readStatus());
 }catch(error){
  console.error("[SC_KASBON_POOL_MANUAL_SYNC]",error);
  res.status(409).json({error:"POOL_SYNC_STATUS_UNAVAILABLE",detail:error instanceof Error?error.message:"UNKNOWN"});
 }
});

router.post("/admin/sc-employees/:employeeId/kasbon/salary-sync",adminMiddleware,async(req,res)=>{
 const employeeId=String(req.params.employeeId||"").toUpperCase();
 if(!employeePattern.test(employeeId)){res.status(400).json({error:"ID karyawan tidak valid"});return;}
 const action=req.body?.action;
 const period=req.body?.period;
 try {assertKasbonPeriod(period);}catch{res.status(400).json({error:"SALARY_PERIOD_INVALID"});return;}
 if(!["preview","sync"].includes(action)||Object.keys(req.body??{}).some(k=>!["action","period"].includes(k))){
  res.status(400).json({error:"Aksi sinkronisasi tidak valid"});return;
 }
 try {
  const [employee]=await db.select({employeeId:scEmployeesTable.employeeId,fullName:scEmployeesTable.fullName}).from(scEmployeesTable).where(eq(scEmployeesTable.employeeId,employeeId)).limit(1);
  if(!employee){res.status(404).json({error:"Karyawan tidak ditemukan"});return;}
  const records=await db.select({id:scEmployeeKasbonTable.id,amount:scEmployeeKasbonTable.amount,
   kasbonDate:scEmployeeKasbonTable.kasbonDate,updatedAt:scEmployeeKasbonTable.updatedAt})
   .from(scEmployeeKasbonTable).where(eq(scEmployeeKasbonTable.employeeId,employeeId));
  const monthly=recordsForKasbonPeriod(records,period);
  const snapshot=snapshotKasbonRecords(monthly);
  const total=monthlyKasbonTotal(records,period);
  if(!Number.isSafeInteger(total)||total<0)throw Error("INVALID_KASBON_TOTAL");
  const outcome=await syncEmployeeKasbonToSalary({employeeId,fullName:employee.fullName,total},action==="preview",period);
  if(action==="sync"){
   // The Google API already read back the exact G value. Ensure DB hasn't changed
   // during the external request before recording a durable receipt.
   const latest=await db.select({id:scEmployeeKasbonTable.id,amount:scEmployeeKasbonTable.amount,
    kasbonDate:scEmployeeKasbonTable.kasbonDate,updatedAt:scEmployeeKasbonTable.updatedAt})
    .from(scEmployeeKasbonTable).where(eq(scEmployeeKasbonTable.employeeId,employeeId));
   if(JSON.stringify(snapshotKasbonRecords(recordsForKasbonPeriod(latest,period)))!==JSON.stringify(snapshot))
    throw Error("KASBON_CHANGED_DURING_SYNC_RETRY");
   await logAudit({...getUserFromReq(req),action:"SC_KASBON_SALARY_SHEET_SYNCED",entity:"sc_employee_kasbon",
    after:{...outcome,period,records:snapshot},...getClientInfo(req)});
  }
  const [last]=await db.select({after:auditLogsTable.after}).from(auditLogsTable)
   .where(and(eq(auditLogsTable.action,"SC_KASBON_SALARY_SHEET_SYNCED"),
    sql`${auditLogsTable.after}->>'employeeId' = ${employeeId}`,
    sql`(${auditLogsTable.after}->>'period' = ${period} OR (${period} = '2026-11' AND ${auditLogsTable.after}->>'period' IS NULL))`))
   .orderBy(desc(auditLogsTable.id)).limit(1);
  const rawReceipt=(last?.after??null) as SalarySyncReceipt|null;
  // Legacy entries have no per-transaction evidence: keep them unverified.
  const receipt=rawReceipt && Array.isArray(rawReceipt.records) &&
   ((rawReceipt as SalarySyncReceipt & {period?:string}).period===period ||
    (period==="2026-11" && !(rawReceipt as SalarySyncReceipt & {period?:string}).period &&
     rawReceipt.records.every(r=>r.kasbonDate.slice(0,7)==="2026-11"))) ? rawReceipt : null;
  const status=getKasbonReceiptStatus(snapshot,receipt,action==="sync" || (outcome.status==="preview" && outcome.matched));
  res.json({...outcome,...status});
 }catch(e){
  const code=(e as Error).message;
  console.error("[SC_KASBON_SALARY_SYNC]",code);
  res.status(code==="SALARY_SYNC_DISABLED"?503:409).json({error:code});
 }
});

export default router;
