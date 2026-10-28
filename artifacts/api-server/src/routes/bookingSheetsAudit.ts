import { Router } from "express";
import { google } from "googleapis";
import { adminMiddleware } from "../lib/auth";
import { isGoogleSheetsConfigured } from "../lib/googleSheets";
import { db, bookingsTable, facilitiesTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

const router = Router();
// DB adapters differ: postgres-js returns an array, node-postgres returns { rows }.
function sqlResultRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === "object" && "rows" in value) {
    const rows = (value as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  }
  throw new Error("Unexpected SQL result shape");
}

const TARGET_ID = "1ZvHAydlYhdfnDZmOCcPNKtOnj-O3-l9bY84927bYN7E";
const MONTHS = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];
export const paidTabFromWibDate = (value: Date | string): string => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Tanggal pembayaran tidak valid");
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jakarta", year: "numeric", month: "numeric" }).formatToParts(date);
  const year = parts.find(p => p.type === "year")?.value;
  const month = Number(parts.find(p => p.type === "month")?.value);
  if (!year || !month || month < 1 || month > 12) throw new Error("Tanggal pembayaran tidak valid");
  return `PAID ${MONTHS[month - 1]} ${year}`;
};

const BOOKING_HEADERS = ["Order Number","Customer Name","Customer Email","Customer Phone","Facility","Date","Start Time","End Time","Duration (hours)","Total Price","Status","Notes","Admin Notes","Created At"];
const MONTH_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])$/;
export function monthTarget(month: string): string {
  if (!MONTH_PATTERN.test(month)) throw new Error("Invalid payment month");
  const [year, number] = month.split("-").map(Number);
  return `PAID ${MONTHS[number - 1]} ${year}`;
}
// Explicit admin action. Never repair or overwrite a populated tab.
router.post("/admin/google-sheets/create-header", adminMiddleware, async (req, res) => {
  const month = String(req.body?.month ?? "");
  if (!MONTH_PATTERN.test(month)) { res.status(400).json({ error: "Bulan tidak valid" }); return; }
  const tab = monthTarget(month);
  if (!isGoogleSheetsConfigured()) { res.status(503).json({ error: "Service account belum tersedia" }); return; }
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
    if (typeof credentials.private_key === "string") credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    const sheets = google.sheets({ version: "v4", auth });
    const metadata = await sheets.spreadsheets.get({ spreadsheetId: TARGET_ID, fields: "sheets(properties(title))" });
    if (!(metadata.data.sheets ?? []).some(sheet => sheet.properties?.title === tab)) {
      res.status(409).json({ error: "Tab belum tersedia. Tidak ada tab yang dibuat.", code: "MONTH_TAB_MISSING", tab }); return;
    }
    const range = `'${tab.replace(/'/g, "''")}'`;
    // Entire-sheet FORMULA read detects used values and formulas beyond the initial rows/columns.
    const current = await sheets.spreadsheets.values.get({
      spreadsheetId: TARGET_ID, range, valueRenderOption: "FORMULA",
    });
    const values = current.data.values ?? [];
    if (BOOKING_HEADERS.every((header, i) => values[0]?.[i] === header)) {
      res.json({ ok: true, alreadyPresent: true, tab, headerRow: 1, written: false }); return;
    }
    if (values.some(row => row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== ""))) {
      res.status(409).json({ error: "Tab memiliki data atau rumus; header tidak akan ditimpa", code: "TAB_NOT_EMPTY", tab }); return;
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId: TARGET_ID, range: `'${tab}'!A1:N1`, valueInputOption: "RAW",
      requestBody: { values: [BOOKING_HEADERS] },
    });
    const check = await sheets.spreadsheets.values.get({
      spreadsheetId: TARGET_ID, range: `'${tab}'!A1:N1`, valueRenderOption: "FORMATTED_VALUE",
    });
    if (!BOOKING_HEADERS.every((header, i) => check.data.values?.[0]?.[i] === header)) {
      res.status(502).json({ error: "Header ditulis tetapi verifikasi belum sesuai; periksa sebelum mencoba ulang", code: "HEADER_VERIFY_FAILED", tab }); return;
    }
    res.json({ ok: true, written: true, tab, headerRow: 1, columns: BOOKING_HEADERS.length });
  } catch (error) {
    req.log.error({ err: error, tab }, "Google Sheets header creation failed");
    res.status(502).json({ error: "Gagal menyiapkan header Google Sheets. Tidak ada sinkronisasi booking.", tab });
  }
});
router.get("/admin/google-sheets/month-readiness", adminMiddleware, async (req, res) => {
  const month = String(req.query.month ?? "");
  if (!MONTH_PATTERN.test(month)) { res.status(400).json({ error: "Bulan pembayaran tidak valid" }); return; }
  const tab = monthTarget(month);
  if (!isGoogleSheetsConfigured()) { res.status(503).json({ tab, ready: false, reason: "SERVICE_ACCOUNT_NOT_CONFIGURED" }); return; }
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
    if (typeof credentials.private_key === "string") credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
    const sheets = google.sheets({ version: "v4", auth });
    const meta = await sheets.spreadsheets.get({ spreadsheetId: TARGET_ID, fields: "sheets(properties(title))" });
    const exists = (meta.data.sheets || []).some(s => s.properties?.title === tab);
    if (!exists) { res.json({ tab, ready: false, reason: "MONTH_TAB_MISSING", expectedHeaders: BOOKING_HEADERS, writeEnabled: false }); return; }
    const [header, rows] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: TARGET_ID, range: `'${tab}'!A1:N5`, valueRenderOption: "FORMATTED_VALUE" }),
      sheets.spreadsheets.values.get({ spreadsheetId: TARGET_ID, range: `'${tab}'!A1:A10000`, valueRenderOption: "UNFORMATTED_VALUE" }),
    ]);
    const foundAt = (header.data.values || []).findIndex(row => BOOKING_HEADERS.every((name, i) => row[i] === name));
    const ready = foundAt >= 0;
    res.json({ tab, ready, reason: ready ? null : "BOOKING_HEADER_MISSING", headerRow: ready ? foundAt+1 : null, populatedFirstColumn: (rows.data.values || []).filter(r => r[0] != null && String(r[0]).trim() !== "").length, expectedHeaders: BOOKING_HEADERS, writeEnabled: false });
  } catch (error) {
    req.log.error({ err: error }, "Google Sheets month readiness failed");
    res.status(502).json({ tab, ready: false, reason: "MONTH_READ_FAILED", writeEnabled: false });
  }
});
// Read-only reconciliation. Never append/write, even when candidates appear new.
// Duplicate check includes all PAID tabs to prevent a booking silently moving months.
router.post("/admin/google-sheets/reconcile", adminMiddleware, async (req, res) => {
  const month = String(req.body?.month ?? "");
  const candidateIds = req.body?.orderNumbers;
  if (!MONTH_PATTERN.test(month) || !Array.isArray(candidateIds) || candidateIds.length > 2000 ||
    candidateIds.some((id: unknown) => typeof id !== "string" || !/^SC-[A-Z0-9-]{1,40}$/.test(id))) {
    res.status(400).json({ error: "Invalid reconciliation request" }); return;
  }
  const tab = monthTarget(month);
  if (!isGoogleSheetsConfigured()) { res.status(503).json({ error: "Service account not configured" }); return; }
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
    if (typeof credentials.private_key === "string") credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
    const sheets = google.sheets({ version: "v4", auth });
    const metadata = await sheets.spreadsheets.get({ spreadsheetId: TARGET_ID, fields: "sheets(properties(title))" });
    const names = (metadata.data.sheets ?? []).map(s => s.properties?.title).filter((name): name is string => Boolean(name));
    const paidNames = names.filter(name => /^PAID (JANUARI|FEBRUARI|MARET|APRIL|MEI|JUNI|JULI|AGUSTUS|SEPTEMBER|OKTOBER|NOVEMBER|DESEMBER) 20\d{2}$/.test(name));
    if (!names.includes(tab)) { res.json({ ready: false, tab, reason: "MONTH_TAB_MISSING", writeEnabled: false }); return; }
    const rowsByTab = await Promise.all(paidNames.map(async name => {
      const data = await sheets.spreadsheets.values.get({ spreadsheetId: TARGET_ID, range: `'${name}'!A1:N10000`, valueRenderOption: "UNFORMATTED_VALUE" });
      return { name, rows: data.data.values ?? [] };
    }));
    const target = rowsByTab.find(item => item.name === tab)!;
    const headerRow = target.rows.findIndex(row => BOOKING_HEADERS.every((h, i) => row[i] === h));
    if (headerRow < 0) { res.json({ ready: false, tab, reason: "BOOKING_HEADER_MISSING", writeEnabled: false }); return; }
    const existing = new Map<string, string[]>();
    for (const item of rowsByTab) {
      for (const row of item.rows) {
        const id = String(row[0] ?? "").trim();
        if (/^SC-[A-Z0-9-]{1,40}$/.test(id)) existing.set(id, [...(existing.get(id) ?? []), item.name]);
      }
    }
    const counts = new Map<string, number>();
    for (const id of candidateIds) counts.set(id, (counts.get(id) ?? 0)+1);
    const blocked = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
    const duplicates = [...counts.keys()].filter(id => existing.has(id)).map(id => ({ orderNumber: id, tabs: existing.get(id) }));
    const newIds = [...counts.keys()].filter(id => !existing.has(id) && !blocked.includes(id));
    res.json({ ready: true, tab, candidateCount: candidateIds.length, uniqueCount: counts.size, newCount: newIds.length,
      existingCount: duplicates.length, repeatedInPreviewCount: blocked.length, duplicates, repeatedInPreview: blocked,
      note: "Dry run only: no payment allocation ledger, partial-payment validation or Sheets writes", writeEnabled: false });
  } catch (error) {
    req.log.error({err:error}, "Read-only Sheets reconciliation failed");
    res.status(502).json({ error: "Reconciliation read failed", writeEnabled: false });
  }
});
// A read-only audit of actual payment/allocation sources. Uses existing tables,
// so PROD can diagnose partial and grouped payments before the ledger migration.
router.get("/admin/google-sheets/payment-sources", adminMiddleware, async (req, res) => {
  const month=String(req.query.month ?? "");
  if(!MONTH_PATTERN.test(month)){res.status(400).json({error:"Invalid payment month"});return;}
  try {
    const start = `${month}-01`;
    const result = await db.execute(sql`
      with allocated as (
        select 'allocation'::text as source_type, a.booking_id, a.amount,
          coalesce(p.paid_at,p.confirmed_at) as payment_ts
        from sport_center.sport_payments p join sport_center.sport_payment_allocations a
          on a.payment_id=p.id where p.status='confirmed'
      ), direct as (
        select 'direct'::text as source_type, p.booking_id, p.amount,
          coalesce(p.paid_at,p.confirmed_at) as payment_ts
        from sport_center.sport_payments p
        where p.status='confirmed' and not exists
          (select 1 from sport_center.sport_payment_allocations a where a.payment_id=p.id)
      ), company as (
        select 'corporate_invoice'::text as source_type, item.booking_id,
          item.total_amount as amount, i.paid_at as payment_ts
        from sport_center.company_invoices i join sport_center.company_invoice_items item
          on item.invoice_id=i.id
        where i.status='paid' and item.booking_id is not null
      ), all_sources as (
        select * from allocated union all select * from direct union all select * from company
      )
      select source_type,
        case when payment_ts is null then 'MISSING_PAYMENT_DATE'
          when amount is null or amount <= 0 then 'INVALID_AMOUNT'
          when source_type='corporate_invoice' and b.payer_type::text<>'company' then 'PAYER_MISMATCH'
          when source_type<>'corporate_invoice' and b.payer_type::text='company' then 'CORPORATE_PAYMENT_NEEDS_REVIEW'
          else 'CANDIDATE'
        end as validation_status,
        count(*)::integer as event_count,
        coalesce(sum(amount),0)::text as allocated_amount
      from all_sources s join sport_center.sport_bookings b on b.id=s.booking_id
      where b.total_price>0
        and (payment_ts at time zone 'Asia/Jakarta')::date >= ${start}::date
        and (payment_ts at time zone 'Asia/Jakarta')::date < (${start}::date + interval '1 month')
      group by source_type,validation_status
      order by source_type,validation_status
    `);
    const rows = (result as unknown as {rows?: unknown[]}).rows ?? result;
    res.json({ month, tab: monthTarget(month), breakdown: rows, writeEnabled: false });
  } catch(error) {
    req.log.error({err:error},"Google Sheets payment source audit failed");
    res.status(502).json({error:"Cannot audit payment sources",writeEnabled:false});
  }
});
/**
 * Narrow manual pilot: a single confirmed, fully settled, non-group personal
 * booking. Does not bulk-sync or auto-sync. Guarded by persistent ledger.
 */
// Admin-only read-only DB diagnostics; never reveal connection strings, secrets or role names.
router.get("/admin/google-sheets/ledger-health", adminMiddleware, async (req, res) => {
  try {
    const result = sqlResultRows(await db.execute(sql`
      select
        to_regclass('sport_center.booking_sheets_sync_ledger') is not null as table_exists,
        has_schema_privilege(current_user, 'sport_center', 'USAGE') as schema_usage,
        has_table_privilege(current_user, 'sport_center.booking_sheets_sync_ledger', 'INSERT') as can_insert,
        has_table_privilege(current_user, 'sport_center.booking_sheets_sync_ledger', 'SELECT') as can_select,
        pg_has_role(current_user, 'service_role', 'MEMBER') as service_role_member
    `));
    const item = result[0] ?? {};
    res.json({ ok: true, checks: item, writeAttempted: false });
  } catch (error) {
    req.log.error({err: error}, "Sheets ledger health check failed");
    res.status(502).json({ok:false,writeAttempted:false,error:"Ledger health check failed"});
  }
});
// Read-only status of bookings already shown in the paid preview.
// Ledger is authoritative for the stored sync result; optional live check compares Sheets column A.
router.post("/admin/google-sheets/status-check", adminMiddleware, async (req, res) => {
  const orderNumbers = req.body?.orderNumbers;
  const verifySheets = req.body?.verifySheets === true;
  if (!Array.isArray(orderNumbers) || orderNumbers.length > 200 ||
      orderNumbers.some(x => typeof x !== "string" || !/^SC-[0-9]{1,12}$/.test(x))) {
    res.status(400).json({error:"Invalid orderNumbers (max 200)"}); return;
  }
  const unique = [...new Set(orderNumbers as string[])];
  if (!unique.length) { res.json({items:[],checkedSheets:false}); return; }
  try {
    const rows = sqlResultRows(await db.execute(sql`
      select b.order_number, l.status, l.target_tab, l.sheet_row, l.written_at
      from sport_center.sport_bookings b
      left join lateral (
        select status,target_tab,sheet_row,written_at
        from sport_center.booking_sheets_sync_ledger l
        where l.booking_id=b.id
        order by l.written_at desc nulls last, l.id desc limit 1
      ) l on true
      where b.order_number in (${sql.join(unique.map(value => sql`${value}`),sql`,`)})
    `));
    const items = unique.map(order => {
      const found = rows.find(row => row.order_number === order);
      return {orderNumber:order,status:found?.status === "written" ? "synced" :
        found?.status === "writing" ? "needs_review" : found?.status ? "error" : "not_synced",
        targetTab: found?.target_tab ?? null, sheetRow:found?.sheet_row ?? null};
    });
    if (!verifySheets) {res.json({items,checkedSheets:false});return;}
    if (!isGoogleSheetsConfigured()) {res.status(503).json({error:"Google Sheets belum dikonfigurasi"});return;}
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
    if (typeof creds.private_key === "string") creds.private_key = creds.private_key.replace(/\\n/g,"\n");
    const auth = new google.auth.GoogleAuth({credentials:creds,scopes:["https://www.googleapis.com/auth/spreadsheets.readonly"]});
    const sheets = google.sheets({version:"v4",auth});
    const tabs = [...new Set(items.filter(x=>x.status==="synced"&&x.targetTab).map(x=>String(x.targetTab)))];
    if(tabs.length>12){res.status(400).json({error:"Terlalu banyak tab untuk satu pemeriksaan"});return;}
    const results = await Promise.all(tabs.map(async tab => ({
      tab,
      values:(await sheets.spreadsheets.values.get({spreadsheetId:TARGET_ID,range:`'${tab.replace(/'/g,"''")}'!A1:A10000`,valueRenderOption:"FORMATTED_VALUE"})).data.values ?? [],
    })));
    for (const item of items) {
      if(item.status!=="synced")continue;
      const tab=results.find(t=>t.tab===item.targetTab);
      if(!tab){item.status="needs_review";continue;}
      const locations:number[]=[];
      tab.values.forEach((row,i)=>{if(row[0]===item.orderNumber)locations.push(i+1);});
      if(locations.length===0)item.status="missing";
      else if(locations.length>1 || locations[0]!==Number(item.sheetRow))item.status="needs_review";
    }
    // Compare the full booking row only after its identity and recorded position match.
    // Read-only; differences are informational and never modify the ledger.
    const confirmed = items.filter(item => item.status === "synced");
    if (confirmed.length) {
      const sheetsRows = await Promise.all(tabs.map(async tab => ({
        tab,
        values: (await sheets.spreadsheets.values.get({
          spreadsheetId: TARGET_ID, range: `'${tab.replace(/'/g,"''")}'!A1:N10000`,
          valueRenderOption: "UNFORMATTED_VALUE",
        })).data.values ?? [],
      })));
      const bookings = await db.select().from(bookingsTable).where(inArray(bookingsTable.orderNumber,confirmed.map(item=>item.orderNumber)));
      const facilities = await db.select().from(facilitiesTable);
      for (const item of confirmed) {
        const booking = bookings.find(row => row.orderNumber === item.orderNumber);
        const tab = sheetsRows.find(t => t.tab === item.targetTab);
        const actual = tab?.values[Number(item.sheetRow)-1];
        if (!booking || !actual) {item.status="needs_review";continue;}
        const facility = facilities.find(row=>row.id === booking.facilityId);
        const dateParts = new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Jakarta",
          day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(booking.createdAt));
        const datePart=(type:string)=>dateParts.find(part=>part.type===type)?.value??"";
        const createdAt=`${datePart("day")}/${datePart("month")}/${datePart("year")} ${datePart("hour")}:${datePart("minute")}:${datePart("second")} WIB`;
        const expected=[booking.orderNumber,booking.customerName,booking.customerEmail,booking.customerPhone,
          facility?.name??"",booking.bookingDate,booking.startTime,booking.endTime,booking.durationHours,
          booking.totalPrice,booking.status,booking.notes??"",booking.adminNotes??"",createdAt];
        const differences=BOOKING_HEADERS.filter((_,i)=>String(actual[i]??"").trim()!==String(expected[i]??"").trim());
        if (differences.length){item.status="changed";(item as typeof item & {changedColumns?:string[]}).changedColumns=differences;}
      }
    }
    res.json({items,checkedSheets:true,checkedAt:new Date().toISOString()});
  } catch(error) {
    req.log.error({err:error},"Google Sheets read-only status check failed");
    res.status(502).json({error:"Pemeriksaan status gagal; ledger dan Sheets tidak diubah"});
  }
});
// Recovery is deliberately separate from Sync One. It is ONLY for a previously
// written direct-payment source whose row was manually removed from the report.
router.post("/admin/google-sheets/recover-one", adminMiddleware, async (req, res) => {
  const orderNumber=String(req.body?.orderNumber??"").trim();
  if(!/^SC-[0-9]{1,12}$/.test(orderNumber)){res.status(400).json({error:"Nomor booking tidak valid"});return;}
  if(!isGoogleSheetsConfigured()){res.status(503).json({error:"Google Sheets tidak terkonfigurasi"});return;}
  let stage="BOOKING";
  let claimed=false;
  try {
    const [booking]=await db.select().from(bookingsTable).where(eq(bookingsTable.orderNumber,orderNumber)).limit(1);
    if(!booking || booking.groupRef || booking.payerType==="company" || booking.membershipId || booking.membershipPaymentId){
      res.status(409).json({error:"Pemulihan hanya untuk booking personal langsung non-grup",code:"NOT_ELIGIBLE"});return;
    }
    stage="PAYMENT";
    const sources=sqlResultRows(await db.execute(sql`
      select source_key,source_type,payment_id,amount,payment_ts,payment_date_wib::text as payment_date_wib,validation_status
      from sport_center.booking_sheets_payment_sources where booking_id=${booking.id}
    `));
    const due=Number(booking.grandTotal??booking.totalPrice);
    if(sources.length!==1 || sources[0].source_type!=="direct" ||
       sources[0].validation_status!=="CANDIDATE" || Number(sources[0].amount)<due || due<=0){
      res.status(409).json({error:"Pembayaran bukan satu pelunasan langsung yang valid",code:"PAYMENT_NOT_ELIGIBLE"});return;
    }
    const source=sources[0], sourceKey=String(source.source_key);
    const ledger=sqlResultRows(await db.execute(sql`
      select id,status,target_tab,sheet_row,attempt_count from sport_center.booking_sheets_sync_ledger
      where source_key=${sourceKey} and booking_id=${booking.id}
    `))[0];
    const tab=paidTabFromWibDate(String(source.payment_ts));
    if(!ledger || ledger.status!=="written" || ledger.target_tab!==tab){
      res.status(409).json({error:"Ledger belum berstatus written atau bulan tujuan berbeda; perlu investigasi",code:"LEDGER_NOT_ELIGIBLE"});return;
    }
    stage="SHEETS_READ";
    const creds=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
    if(typeof creds.private_key==="string")creds.private_key=creds.private_key.replace(/\\n/g,"\n");
    const auth=new google.auth.GoogleAuth({credentials:creds,scopes:["https://www.googleapis.com/auth/spreadsheets"]});
    const sheets=google.sheets({version:"v4",auth});
    const metadata=await sheets.spreadsheets.get({spreadsheetId:TARGET_ID,fields:"sheets(properties(title))"});
    const paidTabs=(metadata.data.sheets??[]).map(s=>s.properties?.title).filter((n):n is string=>!!n&&/^PAID /.test(n));
    if(!paidTabs.includes(tab)||paidTabs.length>60){
      res.status(409).json({error:"Tab tujuan tidak ditemukan atau terlalu banyak tab untuk pemeriksaan aman",code:"TAB_NOT_READY"});return;
    }
    const scan=async()=>Promise.all(paidTabs.map(async name=>({
      name, values:(await sheets.spreadsheets.values.get({spreadsheetId:TARGET_ID,
        range:`'${name.replace(/'/g,"''")}'!A:A`,valueRenderOption:"FORMATTED_VALUE"})).data.values??[],
    })));
    const matches=(data:Awaited<ReturnType<typeof scan>>)=>data.flatMap(item=>item.values
      .map((row,i)=>String(row[0]??"").trim()===orderNumber?{tab:item.name,row:i+1}:null)
      .filter((v):v is {tab:string;row:number}=>v!==null));
    const existing=matches(await scan());
    if(existing.length){
      res.status(409).json({error:"Booking masih ditemukan dalam Google Sheets; pemulihan ditolak",code:"ROW_ALREADY_PRESENT",locations:existing});return;
    }
    const h=await sheets.spreadsheets.values.get({spreadsheetId:TARGET_ID,range:`'${tab}'!A1:N1`});
    if(!BOOKING_HEADERS.every((v,i)=>h.data.values?.[0]?.[i]===v)){
      res.status(409).json({error:"Header tab tujuan tidak sesuai",code:"INVALID_HEADER"});return;
    }
    stage="LEDGER_RECOVERY_CLAIM";
    // Atomic claim prevents two admins restoring the same source simultaneously.
    // A crashed claim stays writing and requires manual reconciliation.
    const locked=sqlResultRows(await db.execute(sql`
      update sport_center.booking_sheets_sync_ledger
      set status='writing',attempt_count=attempt_count+1,last_attempt_at=now(),updated_at=now()
      where source_key=${sourceKey} and status='written' and booking_id=${booking.id}
      returning source_key
    `));
    if(!locked.length){res.status(409).json({error:"Pemulihan sedang diproses atau status sudah berubah",code:"RECOVERY_CLAIM_CONFLICT"});return;}
    claimed=true;
    stage="SECOND_READ";
    // Recheck after acquiring claim to reduce race with manual Sheets edits.
    if(matches(await scan()).length) {
      res.status(409).json({error:"Baris muncul kembali saat pemulihan. Klaim tertahan untuk rekonsiliasi.",code:"ROW_REAPPEARED",needsReconciliation:true});return;
    }
    const facility=(await db.select().from(facilitiesTable)).find(item=>item.id===booking.facilityId);
    const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Jakarta",day:"2-digit",month:"2-digit",
      year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(booking.createdAt));
    const part=(name:string)=>parts.find(p=>p.type===name)?.value??"";
    const created=`${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}:${part("second")} WIB`;
    const row=[booking.orderNumber,booking.customerName,booking.customerEmail,booking.customerPhone,
      facility?.name??"",booking.bookingDate,booking.startTime,booking.endTime,booking.durationHours,
      booking.totalPrice,booking.status,booking.notes??"",booking.adminNotes??"",created].map(v=>v==null?"":String(v));
    stage="SHEETS_RESTORE_APPEND";
    const response=await sheets.spreadsheets.values.append({spreadsheetId:TARGET_ID,
      range:`'${tab}'!A:N`,insertDataOption:"INSERT_ROWS",valueInputOption:"RAW",requestBody:{values:[row]}});
    const m=(response.data.updates?.updatedRange??"").match(/![A-Z]+(\d+):/);
    if(!m)throw new Error("No append position returned; manual reconciliation required");
    const sheetRow=Number(m[1]);
    stage="SHEETS_VERIFY";
    const verify=await sheets.spreadsheets.values.get({spreadsheetId:TARGET_ID,
      range:`'${tab}'!A${sheetRow}:N${sheetRow}`,valueRenderOption:"UNFORMATTED_VALUE"});
    if(!row.every((v,i)=>String(verify.data.values?.[0]?.[i]??"")===v)){
      throw new Error("Restored row not verified; manual reconciliation required");
    }
    stage="LEDGER_FINALIZE";
    const finalized=sqlResultRows(await db.execute(sql`
      update sport_center.booking_sheets_sync_ledger
      set status='written',sheet_row=${sheetRow},written_at=now(),updated_at=now(),last_error_code=null
      where source_key=${sourceKey} and status='writing' and booking_id=${booking.id}
      returning source_key
    `));
    if(!finalized.length)throw new Error("Ledger finalization failed");
    claimed=false;
    try {
      await db.execute(sql`
        insert into sport_center.booking_sheets_recovery_history
          (source_key,booking_id,order_number,target_tab,old_sheet_row,new_sheet_row)
        values (${sourceKey},${booking.id},${orderNumber},${tab},${Number(ledger.sheet_row)||null},${sheetRow})
      `);
    }catch(error){req.log.error({err:error,orderNumber},"Recovery succeeded but history insert failed");}
    res.json({ok:true,recovered:true,orderNumber,targetTab:tab,sheetRow});
  }catch(error){
    req.log.error({err:error,orderNumber,stage},"Sheets recovery failed");
    res.status(502).json({error:"Pemulihan gagal; tidak akan mengulang otomatis",stage,needsReconciliation:claimed});
  }
});
router.get("/admin/google-sheets/recovery-history",adminMiddleware,async(req,res)=>{
  const orderNumber=String(req.query.orderNumber??"").trim();
  if(!/^SC-[0-9]{1,12}$/.test(orderNumber)){res.status(400).json({error:"Nomor booking tidak valid"});return;}
  try{
    const rows=sqlResultRows(await db.execute(sql`
      select order_number,target_tab,old_sheet_row,new_sheet_row,created_at
      from sport_center.booking_sheets_recovery_history
      where order_number=${orderNumber} order by id desc limit 20
    `));
    res.json({items:rows});
  }catch(error){req.log.error({err:error},"Recovery history unavailable");res.status(502).json({error:"Riwayat belum tersedia"});}
});
router.post("/admin/google-sheets/sync-one", adminMiddleware, async (req, res) => {
  const orderNumber = String(req.body?.orderNumber ?? "").trim();
  if (!/^SC-[A-Z0-9-]{1,40}$/.test(orderNumber)) { res.status(400).json({ error: "Nomor booking tidak valid" }); return; }
  if (!isGoogleSheetsConfigured()) { res.status(503).json({ error: "Google Sheets credentials unavailable" }); return; }
  let claimed: string | undefined;
  let stage = "BOOKING_LOOKUP";
  try {
    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.orderNumber, orderNumber)).limit(1);
    if (!booking || Number(booking.totalPrice) <= 0) { res.status(404).json({ error: "Booking berbayar tidak ditemukan" }); return; }
    // Group allocation, installment, corporate, and membership bookings require
    // their own event-to-row accounting rules. Never silently include them in pilot.
    if (booking.groupRef || booking.payerType === "company" || booking.membershipId || booking.membershipPaymentId) {
      res.status(409).json({ error: "Booking grup/corporate/membership belum didukung Sync One" }); return;
    }
    stage = "SOURCE_LOOKUP";
    const sourcesRaw = await db.execute(sql`
      select source_key,source_type,payment_id,allocation_id,company_invoice_id,
             amount,payment_ts,payment_date_wib::text as payment_date_wib,validation_status
      from sport_center.booking_sheets_payment_sources
      where booking_id = ${booking.id}
      order by payment_ts asc
    `);
    const sources = sqlResultRows(sourcesRaw);
    if (sources.length !== 1 || sources[0].source_type !== "direct" || sources[0].validation_status !== "CANDIDATE") {
      res.status(409).json({ error: "Hanya satu pembayaran langsung yang sudah terkonfirmasi yang boleh dipilotkan", eventCount: sources.length, reason: "SOURCE_NOT_SINGLE_CONFIRMED_DIRECT" }); return;
    }
    const source = sources[0];
    const due = Number(booking.grandTotal ?? booking.totalPrice);
    if (!(Number(source.amount) >= due) || !(due > 0)) {
      res.status(409).json({ error: "Booking belum lunas penuh atau nilai pembayaran tidak valid" }); return;
    }
    const tab = paidTabFromWibDate(String(source.payment_ts));
    stage = "SHEETS_AUTH";
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
    if (typeof creds.private_key === "string") creds.private_key = creds.private_key.replace(/\\n/g, "\n");
    const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    const sheets = google.sheets({ version: "v4", auth });
    stage = "SHEETS_METADATA";
    const meta = await sheets.spreadsheets.get({ spreadsheetId: TARGET_ID, fields: "sheets(properties(title))" });
    const paidTabs = (meta.data.sheets ?? []).map(sheet => sheet.properties?.title)
      .filter((name): name is string => !!name && /^PAID /.test(name));
    if (!paidTabs.includes(tab)) {
      res.status(409).json({ error: "Tab bulan pembayaran belum dibuat", targetTab: tab }); return;
    }
    stage = "SHEETS_DUPLICATE_READ";
    const data = await Promise.all(paidTabs.map(async name => ({
      name,
      values: (await sheets.spreadsheets.values.get({
        spreadsheetId: TARGET_ID, range: `'${name.replace(/'/g,"''")}'!A1:A10000`,
        valueRenderOption: "FORMATTED_VALUE",
      })).data.values ?? [],
    })));
    const found = data.flatMap(item => item.values
      .map((row, index) => String(row[0] ?? "").trim() === orderNumber ? {tab: item.name, row: index + 1} : null)
      .filter((v): v is {tab:string;row:number} => v !== null));
    if (found.length) {
      // A pre-existing row in a different month is not a successful sync.
      // Never silently accept an October row for a November payment.
      if (found.some(location => location.tab !== tab) || found.length > 1) {
        res.status(409).json({
          error: "Booking ditemukan di tab lain atau lebih dari satu kali; perlu rekonsiliasi manual",
          targetTab: tab, locations: found, written: false, reason: "WRONG_MONTH_OR_DUPLICATE",
        }); return;
      }
      res.json({ ok: true, alreadyPresent: true, locations: found, written: false, targetTab: tab }); return;
    }
    stage = "SHEETS_HEADER_READ";
    const header = await sheets.spreadsheets.values.get({
      spreadsheetId: TARGET_ID, range: `'${tab}'!A1:N1`, valueRenderOption: "FORMATTED_VALUE",
    });
    const headerOk = BOOKING_HEADERS.every((h, i) => header.data.values?.[0]?.[i] === h);
    // Header preparation is a separate admin action. Fail closed, never overwrite.
    const initiallyEmpty = false;
    if (!headerOk && !initiallyEmpty) {
      res.status(409).json({ error: "Tab mempunyai data dengan header tidak sesuai. Tidak akan ditimpa.", targetTab: tab }); return;
    }
    const sourceKey = String(source.source_key);
    stage = "LEDGER_CLAIM";
    const claim = await db.execute(sql`
      insert into sport_center.booking_sheets_sync_ledger
        (source_key,booking_id,payment_id,payment_date_wib,target_tab,amount,status,attempt_count,last_attempt_at)
      values (${sourceKey},${booking.id},${Number(source.payment_id)},${String(source.payment_date_wib)}::date,${tab},
              ${Number(source.amount)},'writing',1,now())
      on conflict (source_key) do nothing returning source_key
    `);
    if (!sqlResultRows(claim).length) {
      res.status(409).json({ error: "Sumber pembayaran telah diklaim ledger; perlu rekonsiliasi, bukan menulis ulang", sourceKey }); return;
    }
    claimed = sourceKey;
    if (initiallyEmpty) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: TARGET_ID, range: `'${tab}'!A1:N1`, valueInputOption: "RAW",
        requestBody: { values: [BOOKING_HEADERS] },
      });
    }
    const facilities = await db.select().from(facilitiesTable);
    const fac = facilities.find(item => item.id === booking.facilityId);
    const createdParts = new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Jakarta",
      day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(booking.createdAt));
    const part = (type:string) => createdParts.find(p => p.type === type)?.value ?? "";
    const createdAt = `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}:${part("second")} WIB`;
    const row = [booking.orderNumber,booking.customerName,booking.customerEmail,booking.customerPhone,
      fac?.name ?? "",booking.bookingDate,booking.startTime,booking.endTime,booking.durationHours,
      booking.totalPrice,booking.status,booking.notes ?? "",booking.adminNotes ?? "",createdAt]
      .map(value => value == null ? "" : String(value));
    stage = "SHEETS_APPEND";
    const appended = await sheets.spreadsheets.values.append({
      spreadsheetId: TARGET_ID, range: `'${tab}'!A:N`, valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS", requestBody: {values:[row]},
    });
    const updated = appended.data.updates?.updatedRange ?? "";
    const match = updated.match(/![A-Z]+(\d+):/);
    if (!match) throw new Error("Append response missing row index; requires reconciliation");
    const sheetRow = Number(match[1]);
    stage = "SHEETS_VERIFY";
    const verify = await sheets.spreadsheets.values.get({
      spreadsheetId: TARGET_ID,range:`'${tab}'!A${sheetRow}:N${sheetRow}`,
      valueRenderOption:"FORMATTED_VALUE",
    });
    if (String(verify.data.values?.[0]?.[0] ?? "") !== orderNumber) {
      throw new Error("Sheet row verification failed; requires reconciliation");
    }
    stage = "LEDGER_FINALIZE";
    await db.execute(sql`update sport_center.booking_sheets_sync_ledger
      set status='written',sheet_row=${sheetRow},written_at=now(),updated_at=now()
      where source_key=${sourceKey} and status='writing'`);
    claimed = undefined;
    res.json({ok:true,written:true,orderNumber,targetTab:tab,sheetRow,sourceKey});
  } catch (err) {
    const cause = err && typeof err === "object" && "cause" in err ? err.cause : undefined;
    const dbCode = [err, cause].map(value => value && typeof value === "object" && "code" in value ? value.code : undefined)
      .find(value => typeof value === "string" && /^[0-9A-Z]{5}$/.test(value));
    req.log.error({err, orderNumber, stage, dbCode}, "Sheets Sync One failed");
    // Never auto-release a writing claim: a timeout can happen AFTER Google
    // accepted the append. A reconciliation must check Sheets before retry.
    res.status(502).json({ error: "Sync One gagal; tidak akan mengulang otomatis", needsReconciliation: !!claimed, stage, ...(stage === "LEDGER_CLAIM" && dbCode ? { dbCode } : {}) });
  }
});
router.get("/admin/google-sheets/audit", adminMiddleware, async (req, res) => {
  // Read-only: never clear, append or update the destination spreadsheet.
  if (!isGoogleSheetsConfigured()) {
    res.json({ connected: false, reason: "Kredensial Google service account belum tersedia", spreadsheetId: TARGET_ID, tabs: [], writeEnabled: false });
    return;
  }
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
    if (typeof credentials.private_key === "string") credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
    const sheets = google.sheets({ version: "v4", auth });
    const meta = await sheets.spreadsheets.get({ spreadsheetId: TARGET_ID, fields: "properties(title),sheets(properties(title,gridProperties))" });
    const names = (meta.data.sheets || []).map(s => s.properties?.title).filter((s): s is string => Boolean(s));
    const paidNames = names.filter(n => /^PAID (JANUARI|FEBRUARI|MARET|APRIL|MEI|JUNI|JULI|AGUSTUS|SEPTEMBER|OKTOBER|NOVEMBER|DESEMBER) 20\d\d$/i.test(n));
    const tabs = await Promise.all(paidNames.map(async name => {
      const escaped = name.replace(/'/g, "''");
      const [header, formulas] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId: TARGET_ID, range: `'${escaped}'!A1:AZ3`, valueRenderOption: "FORMATTED_VALUE" }),
        sheets.spreadsheets.values.get({ spreadsheetId: TARGET_ID, range: `'${escaped}'!A1:AZ3`, valueRenderOption: "FORMULA" }),
      ]);
      const rows = header.data.values || [];
      const formulaCount = (formulas.data.values || []).flat().filter(x => typeof x === "string" && x.startsWith("=")).length;
      return { name, sampleHeaders: rows.slice(0, 3), formulaCountInFirst3Rows: formulaCount, headerNeedsReview: true };
    }));
    res.json({ connected: true, title: meta.data.properties?.title, spreadsheetId: TARGET_ID, tabs, writeEnabled: false, rules: { paidMonthTimezone: "Asia/Jakarta", sampleSepBookingOctPaymentTab: paidTabFromWibDate("2026-10-26T00:00:00+07:00") } });
  } catch (err) {
    req.log.error({ err }, "Booking sheets read-only audit failed");
    const status = Number((err as { code?: number; response?: { status?: number } })?.response?.status ?? (err as { code?: number })?.code);
    const reason = status === 403 ? "GOOGLE_PERMISSION_DENIED"
      : status === 404 ? "SPREADSHEET_NOT_FOUND"
      : status === 401 ? "GOOGLE_AUTH_REJECTED"
      : status === 429 ? "GOOGLE_QUOTA_EXCEEDED"
      : err instanceof SyntaxError ? "SERVICE_ACCOUNT_JSON_INVALID"
      : "SHEETS_READ_FAILED";
    res.status(502).json({
      connected: false,
      error: "Tidak dapat membaca spreadsheet. Periksa izin service account dan konfigurasi server.",
      reason,
      writeEnabled: false,
    });
  }
});
export default router;
