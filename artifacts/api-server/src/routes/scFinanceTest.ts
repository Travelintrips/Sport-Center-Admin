import {Router} from "express";
import {db} from "@workspace/db";
import {sql} from "drizzle-orm";
import {superAdminMiddleware} from "../lib/auth";
import {getUserFromReq,logAudit,getClientInfo} from "../lib/auditLog";
import {resultRows} from "../lib/scIncomeOperational";
import {parseTestInput,testNo,testSummary} from "../lib/scFinanceTestValidation";
import {syncScFinanceTestRow,testSheetWritingEnabled,reconcileScFinanceTestSheets} from "../lib/scFinanceTestSheet";

const router=Router();
router.get("/admin/finance-test",superAdminMiddleware,async(req,res)=>{
  try{
    const rows=resultRows(await db.execute(sql`SELECT id,entry_key,direction,
      transaction_date::text AS "transactionDate",source_name AS "sourceName",
      sender_bank AS "senderBank",cash_type AS "cashType",receiving_account AS "receivingAccount",
      method,bank_reference AS "bankReference",notes,amount::text,
      receipt_urls AS "receiptUrls",payment_proof_urls AS "paymentProofUrls",
       supporting_receipt_urls AS "supportingReceiptUrls",expense_kind AS "expenseKind",destination_bank AS "destinationBank",
      destination_account AS "destinationAccount",
      sheet_sync_state AS "sheetSyncState",sheet_row AS "sheetRow",
      sheet_sync_error AS "sheetSyncError",sheet_verified_at AS "sheetVerifiedAt",
      sheet_balance::text AS "sheetBalance",
      created_at AS "createdAt"
      FROM sport_center.sc_finance_test_entries ORDER BY id DESC LIMIT 250`));
    const totals=resultRows(await db.execute(sql`SELECT
      direction,amount::text,sheet_sync_state
      FROM sport_center.sc_finance_test_entries`));
    res.json({entries:rows.map((row:any)=>({...row,
      testNo:testNo(Number(row.id),row.direction)})),
      summary:testSummary(totals.map((row:any)=>({
        direction:row.direction,amount:row.amount,sheet_sync_state:row.sheet_sync_state
      }))),writeEnabled:testSheetWritingEnabled(),
      note:"TEST ONLY — no BizPortal mutation, payment or accounting journal"});
  }catch(e){req.log.error({err:e},"SC test ledger read failed");
    res.status(503).json({error:"SC_TEST_LEDGER_UNAVAILABLE"});}
});
router.post("/admin/finance-test",superAdminMiddleware,async(req,res)=>{
  let input;
  try{input=parseTestInput(req.body)}catch(e){
    res.status(400).json({error:e instanceof Error?e.message:"INVALID_TEST_INPUT"});return;
  }
  try{
    const existing=resultRows(await db.execute(sql`SELECT id,direction,transaction_date::text,
      amount::text,source_name,sheet_sync_state,cash_type,
      sender_bank,receiving_account,method,bank_reference,notes,receipt_urls,payment_proof_urls,supporting_receipt_urls,expense_kind,destination_bank,destination_account
      FROM sport_center.sc_finance_test_entries WHERE entry_key=${input.entryKey}::uuid`))[0];
    if(existing){
      if(existing.direction!==input.direction || existing.transaction_date!==input.transactionDate
        || Number(existing.amount)!==input.amount || existing.source_name!==input.sourceName || existing.cash_type!==input.cashType
        || existing.sender_bank!==input.senderBank || existing.receiving_account!==input.receivingAccount
        || existing.method!==input.method || (existing.bank_reference??"")!==input.bankReference
        || (existing.notes??"")!==input.notes
        || (existing.expense_kind??"")!==input.expenseKind
        || (existing.destination_bank??"")!==input.destinationBank
        || (existing.destination_account??"")!==input.destinationAccount
        || JSON.stringify(existing.receipt_urls??[])!==JSON.stringify(input.receiptUrls)
        || JSON.stringify(existing.payment_proof_urls??[])!==JSON.stringify(input.paymentProofUrls)
        || JSON.stringify(existing.supporting_receipt_urls??[])!==JSON.stringify(input.supportingReceiptUrls)){
        res.status(409).json({error:"TEST_KEY_REUSED_WITH_DIFFERENT_DATA"});return;
      }
      res.json({testNo:testNo(Number(existing.id),existing.direction),
        sheetState:existing.sheet_sync_state,replayed:true});return;
    }
    const row=resultRows(await db.execute(sql`INSERT INTO sport_center.sc_finance_test_entries
      (entry_key,direction,transaction_date,source_name,sender_bank,cash_type,receiving_account,
        method,bank_reference,notes,amount,created_by,receipt_urls,payment_proof_urls,supporting_receipt_urls,expense_kind,destination_bank,destination_account,description_version)
      VALUES(${input.entryKey}::uuid,${input.direction},${input.transactionDate}::date,
        ${input.sourceName},${input.senderBank},${input.cashType},${input.receivingAccount},
        ${input.method},${input.bankReference||null},${input.notes||null},${input.amount},
        ${getUserFromReq(req).userId??null},${JSON.stringify(input.receiptUrls)}::jsonb,
        ${JSON.stringify(input.paymentProofUrls)}::jsonb,${JSON.stringify(input.supportingReceiptUrls)}::jsonb,
        ${input.expenseKind||null},${input.destinationBank||null},${input.destinationAccount||null},${input.direction==="OUT"?2:1})
      ON CONFLICT(entry_key) DO NOTHING RETURNING id,direction`))[0];
    if(!row){res.status(409).json({error:"TEST_ENTRY_ALREADY_EXISTS"});return;}
    await logAudit({...getUserFromReq(req),action:"SC_FINANCE_TEST_CREATED",
      entity:"sc_finance_test_entry",entityId:Number(row.id),
      after:{direction:input.direction,amount:input.amount,transactionDate:input.transactionDate,
        testNo:testNo(Number(row.id),input.direction)},...getClientInfo(req)});
    let sheetState="disabled";
    try{sheetState=await syncScFinanceTestRow(Number(row.id));}
    catch(e){req.log.warn({err:e},"SC test sheet guard not ready");sheetState="pending";}
    res.status(201).json({testNo:testNo(Number(row.id),input.direction),
      sheetState,accountingPosted:false,bankMutationCreated:false,
      balanceIsTestOnly:true});
  }catch(e){req.log.error({err:e},"SC finance test creation failed");
    res.status(503).json({error:"SC_TEST_SAVE_FAILED"});}
});
router.post("/admin/finance-test/reconcile",superAdminMiddleware,async(req,res)=>{
  try{res.json(await reconcileScFinanceTestSheets());}
  catch(e){req.log.warn({err:e},"SC finance test reconciliation unavailable");
    res.status(503).json({error:"SC_TEST_SHEET_RECONCILIATION_UNAVAILABLE"});}
});
router.post("/admin/finance-test/:id/retry",superAdminMiddleware,async(req,res)=>{
  const id=Number(req.params.id);
  if(!Number.isSafeInteger(id)||id<1){res.status(400).json({error:"INVALID_TEST_ID"});return;}
  try{const sheetState=await syncScFinanceTestRow(id);res.json({sheetState});}
  catch(e){req.log.warn({err:e},"SC test sheet guard not ready");
    res.status(503).json({error:"SC_TEST_GUARD_OR_SHEET_UNAVAILABLE"});}
});
export default router;
