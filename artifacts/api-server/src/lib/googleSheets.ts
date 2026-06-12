import { google } from "googleapis";

export const SHEET_HEADERS = [
  "ID",
  "Kode Customer",
  "Nama",
  "Email",
  "Telepon",
  "Tipe Akun",
  "Nama Perusahaan",
  "Nama PIC",
  "Telepon PIC",
  "Email PIC",
  "Status Akun",
  "Sumber Registrasi",
  "Total Booking",
  "Total Belanja (IDR)",
  "Tanggal Daftar",
];

function getClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON tidak tersedia");
  const creds = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

export async function verifySheetAccess(sheetId: string): Promise<{ title: string }> {
  const sheets = getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  return { title: meta.data.properties?.title ?? sheetId };
}

export type CustomerRow = {
  id: number;
  customerCode: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  accountType: string;
  companyName: string | null;
  picName: string | null;
  picPhone: string | null;
  picEmail: string | null;
  accountStatus: string;
  registrationSource: string;
  totalBookings: number;
  totalSpent: number;
  createdAt: Date | string;
};

export async function pushCustomersToSheet(sheetId: string, customers: CustomerRow[]): Promise<{ updatedRows: number }> {
  const sheets = getClient();

  const rows: string[][] = customers.map((c) => [
    String(c.id),
    c.customerCode ?? "",
    c.name,
    c.email ?? "",
    c.phone ?? "",
    c.accountType,
    c.companyName ?? "",
    c.picName ?? "",
    c.picPhone ?? "",
    c.picEmail ?? "",
    c.accountStatus,
    c.registrationSource,
    String(c.totalBookings),
    String(c.totalSpent),
    c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
  ]);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: "Sheet1!A1:Z",
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "Sheet1!A1",
    valueInputOption: "RAW",
    requestBody: {
      values: [SHEET_HEADERS, ...rows],
    },
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.96, green: 0.38, blue: 0.05 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat)",
          },
        },
        {
          autoResizeDimensions: {
            dimensions: { sheetId: 0, dimension: "COLUMNS", startIndex: 0, endIndex: SHEET_HEADERS.length },
          },
        },
      ],
    },
  });

  return { updatedRows: rows.length };
}

export type SheetCustomerUpdate = {
  id: number;
  name?: string;
  email?: string;
  phone?: string;
  accountStatus?: string;
  companyName?: string;
  picName?: string;
  picPhone?: string;
  picEmail?: string;
};

export async function pullCustomersFromSheet(sheetId: string): Promise<SheetCustomerUpdate[]> {
  const sheets = getClient();

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Sheet1!A1:Z",
  });

  const values = resp.data.values ?? [];
  if (values.length < 2) return [];

  const header = values[0];
  const idIdx = header.findIndex((h: string) => h === "ID");
  const nameIdx = header.findIndex((h: string) => h === "Nama");
  const emailIdx = header.findIndex((h: string) => h === "Email");
  const phoneIdx = header.findIndex((h: string) => h === "Telepon");
  const statusIdx = header.findIndex((h: string) => h === "Status Akun");
  const companyIdx = header.findIndex((h: string) => h === "Nama Perusahaan");
  const picNameIdx = header.findIndex((h: string) => h === "Nama PIC");
  const picPhoneIdx = header.findIndex((h: string) => h === "Telepon PIC");
  const picEmailIdx = header.findIndex((h: string) => h === "Email PIC");

  if (idIdx === -1) throw new Error("Kolom 'ID' tidak ditemukan di sheet. Pastikan header sheet sesuai format.");

  const updates: SheetCustomerUpdate[] = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const rawId = row[idIdx];
    if (!rawId) continue;
    const id = parseInt(String(rawId));
    if (isNaN(id) || id <= 0) continue;

    const update: SheetCustomerUpdate = { id };
    if (nameIdx >= 0 && row[nameIdx] !== undefined) update.name = String(row[nameIdx]).trim();
    if (emailIdx >= 0 && row[emailIdx] !== undefined) update.email = String(row[emailIdx]).trim() || undefined;
    if (phoneIdx >= 0 && row[phoneIdx] !== undefined) update.phone = String(row[phoneIdx]).trim() || undefined;
    if (statusIdx >= 0 && row[statusIdx] !== undefined) update.accountStatus = String(row[statusIdx]).trim() || undefined;
    if (companyIdx >= 0 && row[companyIdx] !== undefined) update.companyName = String(row[companyIdx]).trim() || undefined;
    if (picNameIdx >= 0 && row[picNameIdx] !== undefined) update.picName = String(row[picNameIdx]).trim() || undefined;
    if (picPhoneIdx >= 0 && row[picPhoneIdx] !== undefined) update.picPhone = String(row[picPhoneIdx]).trim() || undefined;
    if (picEmailIdx >= 0 && row[picEmailIdx] !== undefined) update.picEmail = String(row[picEmailIdx]).trim() || undefined;
    updates.push(update);
  }

  return updates;
}
