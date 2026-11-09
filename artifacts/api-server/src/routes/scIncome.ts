import {Router} from "express";
import {db} from "@workspace/db";
import {sql} from "drizzle-orm";
import {adminMiddleware} from "../lib/auth";
import {getUserFromReq,logAudit,getClientInfo} from "../lib/auditLog";
import {validateIncome,incomeFingerprint,listIncome,resultRows,syncIncomeRow} from "../lib/scIncomeOperational";

const router=Router();
// All entries are operational/unverified: no payments, journals, or bank_mutations writes.
router.get("/admin/income",adminMiddleware,async(req,res)=>{
 try{
  const entries=await listIncome();
  const summary=resultRows(await db.execute(sql`
    SELECT COALESCE(SUM(amount) FILTER(
      WHERE transaction_date >= date_trunc('month',timezone('Asia/Jakarta',now()))::date
        AND transaction_date < (date_trunc('month',timezone('Asia/Jakarta',now()))+interval '1 month')::date
    ),0)::text AS manual_total,
    COUNT(*) FILTER (WHERE sheet_sync_state<>'synced')::int AS awaiting_sync
    FROM sport_center.sc_income_entries
  `))[0];
  res.json({entries,summary:{manualThisMonth:Number(summary?.manual_total??0),awaitingSync:Number(summary?.awaiting_sync??0)},
    bankVerified:false});
 }catch(e){req.log.error({err:e},"income list failed");res.status(503).json({error:"Daftar Uang Masuk belum tersedia"});}
});
router.post("/admin/income",adminMiddleware,async(req,res)=>{
 let data;
 try{data=validateIncome(req.body)}catch(e){
  res.status(400).json({error:e instanceof Error?e.message:"VALIDATION_ERROR"});return;
 }
 try{
  const fingerprint=incomeFingerprint(data);
  const actor=getUserFromReq(req);
  const inserted=resultRows(await db.execute(sql`
    INSERT INTO sport_center.sc_income_entries
    (entry_key,fingerprint,transaction_date,source_name,sender_bank,method,receiving_account,amount,bank_reference,created_by)
    VALUES (${data.entryKey}::uuid,${fingerprint},${data.transactionDate}::date,
      ${data.sourceName},${data.senderBank},${data.method},${data.receivingAccount},
      ${data.amount},${data.bankReference||null},${actor.userId??null})
    ON CONFLICT DO NOTHING RETURNING id
  `))[0];
  let id=Number(inserted?.id);
  if(!id){
   const duplicate=resultRows(await db.execute(sql`
     SELECT id,entry_key::text AS entry_key,fingerprint FROM sport_center.sc_income_entries
     WHERE entry_key=${data.entryKey}::uuid OR fingerprint=${fingerprint} LIMIT 1
   `))[0];
   if(!duplicate){res.status(409).json({error:"DUPLICATE_CONFLICT"});return;}
   if(duplicate.entry_key!==data.entryKey||duplicate.fingerprint!==fingerprint){
    res.status(409).json({error:"POSSIBLE_DUPLICATE",existingId:duplicate.id,
      message:"Transaksi serupa sudah dicatat. Periksa daftar sebelum membuat ulang."});return;
   }
   id=Number(duplicate.id);
  }else{
   await logAudit({action:"SC_INCOME_CREATED",entity:"sc_income_entries",entityId:id,
     userId:actor.userId??null,after:{date:data.transactionDate,amount:data.amount,
       bankVerified:false},...getClientInfo(req)});
  }
  let candidateCount=0;
  try{
   const candidates=resultRows(await db.execute(sql`
    SELECT bm.id FROM public.bank_mutations bm JOIN public.bank_sheet_configs bsc
      ON bsc.id=bm.sheet_config_id AND bsc.company_id=bm.company_id
      AND bm.bank_account_id=bsc.bank_account_id::text
    WHERE lower(trim(bsc.tab_name))='kas besar sc' AND bsc.is_active=true
      AND bm.direction='IN' AND bm.amount=${data.amount}::numeric
      AND bm.transaction_date BETWEEN ${data.transactionDate}::date-interval '1 day'
                                  AND ${data.transactionDate}::date+interval '1 day'
    LIMIT 11
  `));
   candidateCount=Math.min(candidates.length,10);
  }catch(e){
   req.log.warn({err:e},"Bank candidates unavailable; SC income entry preserved");
  }
  // Sync is independently idempotent. Failed sync keeps the saved record intact.
  const sheetStatus=await syncIncomeRow(id);
  res.status(inserted?201:200).json({ok:true,id,sheetStatus,bankVerified:false,
    candidateCount,
    note:"Mutasi cocok perlu diverifikasi di BizPortal; pencatatan SC belum terverifikasi bank."});
 }catch(e){
  req.log.error({err:e},"income save failed");
  res.status(503).json({error:"Pencatatan belum berhasil; cek daftar Uang Masuk sebelum mengulangi."});
 }
});
router.post("/admin/income/:id/retry-sheet",adminMiddleware,async(req,res)=>{
 const id=Number(req.params.id);
 if(!Number.isSafeInteger(id)||id<1){res.status(400).json({error:"ID_INVALID"});return;}
 try{
  const result=await syncIncomeRow(id);
  res.json({ok:true,sheetStatus:result});
 }catch(e){req.log.error({err:e},"income retry sync failed");res.status(503).json({error:"Sinkronisasi belum tersedia"});}
});
export default router;
