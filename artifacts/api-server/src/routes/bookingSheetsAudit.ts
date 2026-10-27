import { Router } from "express";
import { google } from "googleapis";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { isGoogleSheetsConfigured } from "../lib/googleSheets";
import { db, bookingsTable, facilitiesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router = Router();
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
router.post("/admin/google-sheets/sync-one", adminMiddleware, async (req, res) => {
  const orderNumber = String(req.body?.orderNumber ?? "").trim();
  if (!/^SC-[A-Z0-9-]{1,40}$/.test(orderNumber)) { res.status(400).json({ error: "Nomor booking tidak valid" }); return; }
  if (!isGoogleSheetsConfigured()) { res.status(503).json({ error: "Google Sheets credentials unavailable" }); return; }
  let claimed: string | undefined;
  try {
    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.orderNumber, orderNumber)).limit(1);
    if (!booking || Number(booking.totalPrice) <= 0) { res.status(404).json({ error: "Booking berbayar tidak ditemukan" }); return; }
    // Group allocation, installment, corporate, and membership bookings require
    // their own event-to-row accounting rules. Never silently include them in pilot.
    if (booking.groupRef || booking.payerType === "company" || booking.membershipId || booking.membershipPaymentId) {
      res.status(409).json({ error: "Booking grup/corporate/membership belum didukung Sync One" }); return;
    }
    const sourcesRaw = await db.execute(sql`
      select source_key,source_type,payment_id,allocation_id,company_invoice_id,
             amount,payment_ts,payment_date_wib,validation_status
      from sport_center.booking_sheets_payment_sources
      where booking_id = ${booking.id}
      order by payment_ts asc
    `);
    const sources = Array.from(sourcesRaw as unknown as Array<Record<string, unknown>>);
    if (sources.length !== 1 || sources[0].source_type !== "direct" || sources[0].validation_status !== "CANDIDATE") {
      res.status(409).json({ error: "Hanya satu pembayaran langsung yang sudah terkonfirmasi yang boleh dipilotkan", eventCount: sources.length }); return;
    }
    const source = sources[0];
    const due = Number(booking.grandTotal ?? booking.totalPrice);
    if (!(Number(source.amount) >= due) || !(due > 0)) {
      res.status(409).json({ error: "Booking belum lunas penuh atau nilai pembayaran tidak valid" }); return;
    }
    const tab = paidTabFromWibDate(String(source.payment_ts));
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
    if (typeof creds.private_key === "string") creds.private_key = creds.private_key.replace(/\\n/g, "\n");
    const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    const sheets = google.sheets({ version: "v4", auth });
    const meta = await sheets.spreadsheets.get({ spreadsheetId: TARGET_ID, fields: "sheets(properties(title))" });
    const paidTabs = (meta.data.sheets ?? []).map(sheet => sheet.properties?.title)
      .filter((name): name is string => !!name && /^PAID /.test(name));
    if (!paidTabs.includes(tab)) {
      res.status(409).json({ error: "Tab bulan pembayaran belum dibuat", targetTab: tab }); return;
    }
    const data = await Promise.all(paidTabs.map(async name => ({
      name,
      values: (await sheets.spreadsheets.values.get({
        spreadsheetId: TARGET_ID, range: `'${name.replace(/'/g,"''")}'!A1:AZ10000`,
        valueRenderOption: "FORMATTED_VALUE",
      })).data.values ?? [],
    })));
    const found = data.flatMap(item => item.values
      .map((row, index) => String(row[0] ?? "").trim() === orderNumber ? {tab: item.name, row: index + 1} : null)
      .filter((v): v is {tab:string;row:number} => v !== null));
    if (found.length) {
      res.json({ ok: true, alreadyPresent: true, locations: found, written: false, targetTab: tab }); return;
    }
    const dest = data.find(item => item.name === tab)!;
    const headerOk = BOOKING_HEADERS.every((h, i) => dest.values[0]?.[i] === h);
    const initiallyEmpty = dest.values.length === 0 || dest.values.every(row => row.every(cell => cell === "" || cell == null));
    if (!headerOk && !initiallyEmpty) {
      res.status(409).json({ error: "Tab mempunyai data dengan header tidak sesuai. Tidak akan ditimpa.", targetTab: tab }); return;
    }
    const sourceKey = String(source.source_key);
    const claim = await db.execute(sql`
      insert into sport_center.booking_sheets_sync_ledger
        (source_key,booking_id,payment_id,payment_date_wib,target_tab,amount,status,attempt_count,last_attempt_at)
      values (${sourceKey},${booking.id},${Number(source.payment_id)},${String(source.payment_date_wib)}::date,${tab},
              ${Number(source.amount)},'writing',1,now())
      on conflict (source_key) do nothing returning source_key
    `);
    if (!(Array.from(claim as unknown as Array<Record<string,unknown>>)).length) {
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
    const appended = await sheets.spreadsheets.values.append({
      spreadsheetId: TARGET_ID, range: `'${tab}'!A:N`, valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS", requestBody: {values:[row]},
    });
    const updated = appended.data.updates?.updatedRange ?? "";
    const match = updated.match(/![A-Z]+(\d+):/);
    if (!match) throw new Error("Append response missing row index; requires reconciliation");
    const sheetRow = Number(match[1]);
    const verify = await sheets.spreadsheets.values.get({
      spreadsheetId: TARGET_ID,range:`'${tab}'!A${sheetRow}:N${sheetRow}`,
      valueRenderOption:"FORMATTED_VALUE",
    });
    if (String(verify.data.values?.[0]?.[0] ?? "") !== orderNumber) {
      throw new Error("Sheet row verification failed; requires reconciliation");
    }
    await db.execute(sql`update sport_center.booking_sheets_sync_ledger
      set status='written',sheet_row=${sheetRow},written_at=now(),updated_at=now()
      where source_key=${sourceKey} and status='writing'`);
    claimed = undefined;
    res.json({ok:true,written:true,orderNumber,targetTab:tab,sheetRow,sourceKey});
  } catch (err) {
    req.log.error({err, orderNumber}, "Sheets Sync One failed");
    // Never auto-release a writing claim: a timeout can happen AFTER Google
    // accepted the append. A reconciliation must check Sheets before retry.
    res.status(502).json({ error: "Sync One gagal; tidak akan mengulang otomatis", needsReconciliation: !!claimed });
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
