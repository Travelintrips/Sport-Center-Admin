import { Router } from "express";
import { google } from "googleapis";
import { adminMiddleware } from "../lib/auth";
import { isGoogleSheetsConfigured } from "../lib/googleSheets";

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
