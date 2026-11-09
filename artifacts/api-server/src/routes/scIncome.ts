import {Router} from "express";
import {db} from "@workspace/db";
import {sql} from "drizzle-orm";
import {adminMiddleware} from "../lib/auth";
import {getUserFromReq,logAudit,getClientInfo} from "../lib/auditLog";
import {validateIncome,incomeFingerprint,resultRows,syncIncomeRow} from "../lib/scIncomeOperational";

const router=Router();
router.get("/admin/income",adminMiddleware,async(req,res)=>{
 try{
  const entries=resultRows(await db.execute(sql`SELECT id,entry_key,transaction_date::text AS "transactionDate",
   source_name AS "sourceName",sender_bank AS "senderBank",method,receiving_account AS "receivingAccount",
   amount::text,bank_reference AS "bankReference",reconciliation_state AS "reconciliationState",
   sheet_sync_state AS "sheetSyncState",sheet_sync_error AS "sheetSyncError",created_at
   FROM sport_center.sc_income_entries ORDER BY transaction_date DESC,id DESC LIMIT 250`));
  const month=resultRows(await db.execute(sql`SELECT COALESCE(SUM(amount),0)::text AS total,
   count(*) FILTER (WHERE sheet_sync_state<>'synced') AS awaiting
   FROM sport_center.sc_income_entries
   WHERE transaction_date>=date_trunc('month',timezone('Asia/Jakarta',now()))::date
     AND transaction_date<(date_trunc('month',timezone('Asia/Jakarta',now()))+interval '1 month')::date`))[0];
  res.json({entries,summary:{manualThisMonth:Number(month?.total??0),awaitingSync:Number(month?.awaiting??0)},
   source:"SC_OPERATIONAL_UNVERIFIED",note:"Manual SC income is not a verified bank mutation or accounting journal"});
 }catch(e){req.log.error({err:e},"SC income list failed");res.status(503).json({error:"Daftar Uang Masuk belum tersedia"});}
});
router.post("/admin/income",adminMiddleware,async(req,res)=>{
 let input;
 try{input=validateIncome(req.body)}catch(e){res.status(400).json({error:e instanceof Error?e.message:"INVALID_INPUT"});return;}
 const fingerprint=incomeFingerprint(input);
 try{
  const existing=resultRows(await db.execute(sql`SELECT id,entry_key,fingerprint,sheet_sync_state FROM sport_center.sc_income_entries WHERE entry_key=${input.entryKey}::uuid`))[0];
  if(existing){
   if(existing.fingerprint!==fingerprint){res.status(409).json({error:"ENTRY_KEY_REUSED_WITH_DIFFERENT_DATA"});return;}
   res.json({id:Number(existing.id),entryKey:input.entryKey,sheetStatus:existing.sheet_sync_state,replayed:true});return;
  }
  // Warn/fail closed for identical manual records, distinct from verified bank mutations.
  const possible=resultRows(await db.execute(sql`SELECT id FROM sport_center.sc_income_entries
   WHERE fingerprint=${fingerprint} AND transaction_date=${input.transactionDate}::date LIMIT 1`))[0];
  if(possible && req.body?.confirmSimilar !== true){
    res.status(409).json({error:"POSSIBLE_DUPLICATE_INCOME",existingId:Number(possible.id)});
    return;
  }
  const saved=resultRows(await db.execute(sql`INSERT INTO sport_center.sc_income_entries
   (entry_key,transaction_date,source_name,sender_bank,method,receiving_account,amount,bank_reference,fingerprint,created_by)
   VALUES (${input.entryKey}::uuid,${input.transactionDate}::date,${input.sourceName},${input.senderBank},
           ${input.method},${input.receivingAccount},${input.amount},${input.bankReference},${fingerprint},
           ${getUserFromReq(req).userId??null})
   ON CONFLICT DO NOTHING RETURNING id,entry_key,fingerprint,sheet_sync_state`))[0];
  if(!saved){
    // Under concurrent requests, either same idempotency key or another bank reference won.
    const winner=resultRows(await db.execute(sql`SELECT id,fingerprint,sheet_sync_state FROM sport_center.sc_income_entries WHERE entry_key=${input.entryKey}::uuid`))[0];
    if(!winner||winner.fingerprint!==fingerprint){res.status(409).json({error:"DUPLICATE_BANK_REFERENCE_OR_TRANSACTION"});return;}
    res.json({id:Number(winner.id),entryKey:input.entryKey,sheetStatus:winner.sheet_sync_state,replayed:true});return;
  }
  await logAudit({...getUserFromReq(req),action:"SC_INCOME_CREATED",entity:"sc_income_entry",entityId:Number(saved.id),
    after:{entryKey:input.entryKey,transactionDate:input.transactionDate,sourceName:input.sourceName,
      senderBank:input.senderBank,method:input.method,receivingAccount:input.receivingAccount,amount:input.amount,
      reconciliationState:"UNVERIFIED"},...getClientInfo(req)});
  const sheetStatus=await syncIncomeRow(Number(saved.id));
  res.status(201).json({id:Number(saved.id),entryKey:input.entryKey,sheetStatus,reconciliationState:"UNVERIFIED"});
 }catch(e){req.log.error({err:e},"SC income save failed");res.status(503).json({error:"Gagal menyimpan Uang Masuk; periksa daftar sebelum mencoba lagi"});}
});
router.post("/admin/income/:id/retry-sheet",adminMiddleware,async(req,res)=>{
 const id=Number(req.params.id);
 if(!Number.isSafeInteger(id)||id<1){res.status(400).json({error:"INVALID_ID"});return;}
 try{const status=await syncIncomeRow(id);res.json({sheetStatus:status});}
 catch(e){req.log.error({err:e},"SC income sheet retry");res.status(503).json({error:"Sinkronisasi belum tersedia"});}
});
// Find candidates only: matching does not approve, reconcile or post to GL.
router.get("/admin/income/:id/mutation-candidates",adminMiddleware,async(req,res)=>{
 const id=Number(req.params.id);
 if(!Number.isSafeInteger(id)||id<1){res.status(400).json({error:"INVALID_ID"});return;}
 try{
  const row=resultRows(await db.execute(sql`SELECT transaction_date,amount FROM sport_center.sc_income_entries WHERE id=${id}`))[0];
  if(!row){res.status(404).json({error:"NOT_FOUND"});return;}
  const candidates=resultRows(await db.execute(sql`SELECT bm.id,bm.transaction_date::text AS date,
    bm.amount::text AS amount,left(bm.description,220) AS description,bm.reconciliation_status
   FROM public.bank_mutations bm JOIN public.bank_sheet_configs bsc ON bsc.id=bm.sheet_config_id
   WHERE bsc.is_active=true AND lower(trim(bsc.tab_name))='kas besar sc'
    AND bm.direction='IN' AND bm.amount=${row.amount}::numeric
    AND bm.transaction_date BETWEEN ${row.transaction_date}::date-interval '1 day'
      AND ${row.transaction_date}::date+interval '1 day'
   ORDER BY bm.transaction_date DESC,bm.id DESC LIMIT 15`));
  res.json({candidates,verified:false,source:"READ_ONLY_SHEET_MUTATIONS"});
 }catch(e){req.log.error({err:e},"SC income candidate search");res.status(503).json({error:"Kandidat belum tersedia"});}
});
export default router;
