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

async function getFirstSheetName(sheets: ReturnType<typeof google.sheets>, sheetId: string): Promise<string> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  return meta.data.sheets?.[0]?.properties?.title ?? "Sheet1";
}

export async function verifySheetAccess(sheetId: string): Promise<{ title: string; sheetName: string }> {
  const sheets = getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const sheetName = meta.data.sheets?.[0]?.properties?.title ?? "Sheet1";
  return { title: meta.data.properties?.title ?? sheetId, sheetName };
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
  const sheetName = await getFirstSheetName(sheets, sheetId);

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
    range: `${sheetName}!A1:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${sheetName}!A1`,
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
  id: number | null;
  name?: string;
  email?: string;
  phone?: string;
  accountStatus?: string;
  companyName?: string;
  picName?: string;
  picPhone?: string;
  picEmail?: string;
  accountType?: string;
};

export async function pullCustomersFromSheet(sheetId: string): Promise<SheetCustomerUpdate[]> {
  const sheets = getClient();
  const sheetName = await getFirstSheetName(sheets, sheetId);

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${sheetName}!A1:Z`,
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
  const typeIdx = header.findIndex((h: string) => h === "Tipe Akun");

  if (idIdx === -1) throw new Error("Kolom 'ID' tidak ditemukan di sheet. Pastikan header sheet sesuai format.");

  const updates: SheetCustomerUpdate[] = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];

    const name = nameIdx >= 0 ? String(row[nameIdx] ?? "").trim() : "";
    const email = emailIdx >= 0 ? String(row[emailIdx] ?? "").trim() : "";
    const phone = phoneIdx >= 0 ? String(row[phoneIdx] ?? "").trim() : "";

    if (!name && !email && !phone) continue;

    const rawId = idIdx >= 0 ? row[idIdx] : undefined;
    const parsedId = rawId ? parseInt(String(rawId)) : NaN;
    const id = !isNaN(parsedId) && parsedId > 0 ? parsedId : null;

    const update: SheetCustomerUpdate = { id };
    if (name) update.name = name;
    if (email) update.email = email;
    if (phone) update.phone = phone;
    if (statusIdx >= 0 && row[statusIdx]) update.accountStatus = String(row[statusIdx]).trim();
    if (companyIdx >= 0 && row[companyIdx]) update.companyName = String(row[companyIdx]).trim();
    if (picNameIdx >= 0 && row[picNameIdx]) update.picName = String(row[picNameIdx]).trim();
    if (picPhoneIdx >= 0 && row[picPhoneIdx]) update.picPhone = String(row[picPhoneIdx]).trim();
    if (picEmailIdx >= 0 && row[picEmailIdx]) update.picEmail = String(row[picEmailIdx]).trim();
    if (typeIdx >= 0 && row[typeIdx]) update.accountType = String(row[typeIdx]).trim();
    updates.push(update);
  }

  return updates;
}
