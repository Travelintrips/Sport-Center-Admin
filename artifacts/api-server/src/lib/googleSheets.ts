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

export function isGoogleSheetsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

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

export async function verifySheetAccess(sheetId: string): Promise<{ title: string; sheetName: string; sheetNames: string[] }> {
  const sheets = getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const allSheets = meta.data.sheets ?? [];
  const sheetNames = allSheets.map((s) => s.properties?.title ?? "Sheet1").filter(Boolean) as string[];
  const sheetName = sheetNames[0] ?? "Sheet1";
  return { title: meta.data.properties?.title ?? sheetId, sheetName, sheetNames };
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

// ─── Bank Reconciliation Sheet ────────────────────────────────────────────────

export const RECON_SHEET_HEADERS = [
  "ID", "Tanggal", "Keterangan", "Kredit", "Debit", "Nominal", "Arah",
  "Status", "Order ID Cocok", "Nama Provider", "Rekening", "Diunggah",
];

export type ReconMutationRow = {
  id: number;
  transactionDate: string;
  description: string;
  creditAmount: string | number;
  debitAmount: string | number;
  amount: string | number;
  direction: string;
  status: string;
  providerOrderId: string | null;
  providerName: string | null;
  bankAccountId: string | null;
  createdAt: Date | string;
};

export async function pushReconciliationToSheet(
  sheetId: string,
  mutations: ReconMutationRow[],
  sheetName?: string
): Promise<{ updatedRows: number }> {
  const sheets = getClient();
  const resolvedSheetName = sheetName ?? (await getFirstSheetName(sheets, sheetId));

  const rows: string[][] = mutations.map((m) => [
    String(m.id),
    m.transactionDate,
    m.description,
    String(m.creditAmount ?? 0),
    String(m.debitAmount ?? 0),
    String(m.amount),
    m.direction,
    m.status,
    m.providerOrderId ?? "",
    m.providerName ?? "",
    m.bankAccountId ?? "",
    m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
  ]);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: `${resolvedSheetName}!A1:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${resolvedSheetName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [RECON_SHEET_HEADERS, ...rows] },
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
                backgroundColor: { red: 0.1, green: 0.45, blue: 0.85 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat)",
          },
        },
        {
          autoResizeDimensions: {
            dimensions: { sheetId: 0, dimension: "COLUMNS", startIndex: 0, endIndex: RECON_SHEET_HEADERS.length },
          },
        },
      ],
    },
  });

  return { updatedRows: rows.length };
}

export type SheetMutationRow = {
  transactionDate: string;
  description: string;
  creditAmount: number;
  debitAmount: number;
  bankAccountId?: string;
};

export async function pullMutationsFromSheet(sheetId: string, sheetName?: string): Promise<SheetMutationRow[]> {
  const sheets = getClient();
  const resolvedSheetName = sheetName ?? (await getFirstSheetName(sheets, sheetId));

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${resolvedSheetName}!A1:Z`,
  });

  const values = resp.data.values ?? [];
  if (values.length < 2) return [];

  const header: string[] = (values[0] as string[]).map((h) => h.toLowerCase().replace(/[\s\-\.]+/g, "_"));

  const idxOf = (names: string[]) => {
    for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; }
    return -1;
  };

  const dateIdx  = idxOf(["tanggal", "transaction_date", "date", "tgl"]);
  const descIdx  = idxOf(["keterangan", "description", "ket", "narasi", "deskripsi"]);
  const creditIdx = idxOf(["kredit", "credit", "credit_amount", "masuk", "cr"]);
  const debitIdx  = idxOf(["debit", "debit_amount", "keluar", "dr"]);
  // "jumlah" di Mandiri = saldo berjalan, bukan nominal transaksi → tidak dipakai sebagai nominal
  const nominalIdx = idxOf(["nominal", "amount"]);
  const bankIdx   = idxOf(["rekening", "bank_account_id", "bank_account", "account"]);

  /** Parse angka IDR: titik sebagai pemisah ribuan (1.360.410 → 1360410) */
  const parseIDR = (raw: string): number => {
    const s = String(raw ?? "").trim().replace(/\s/g, "");
    if (!s) return 0;
    // Hapus semua titik (pemisah ribuan), ganti koma → titik (desimal)
    const cleaned = s.replace(/\./g, "").replace(/,/g, ".");
    return parseFloat(cleaned) || 0;
  };

  /** Normalisasi tanggal ke YYYY-MM-DD.
   *  Mendukung: YYYY-MM-DD, M/D/YYYY (format Mandiri), D/M/YYYY, YYYY/MM/DD */
  const normalizeDate = (raw: string): string => {
    const s = String(raw ?? "").trim();
    if (!s) return s;
    // Sudah ISO
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    // Slash-separated
    const parts = s.split("/");
    if (parts.length === 3) {
      const a = parseInt(parts[0]!, 10);
      const b = parseInt(parts[1]!, 10);
      const c = parseInt(parts[2]!, 10);
      if (parts[2]!.length === 4) {
        // a/b/YYYY — jika a > 12 pasti hari, pakai d/m/yyyy; jika b > 12 pasti bulan, pakai m/d/yyyy
        // Default Mandiri: m/d/yyyy
        let month = a, day = b;
        if (a > 12) { day = a; month = b; }
        return `${parts[2]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
      if (parts[0]!.length === 4) {
        // YYYY/MM/DD
        return `${parts[0]}-${String(b).padStart(2, "0")}-${String(c).padStart(2, "0")}`;
      }
    }
    // Fallback: native Date
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return s;
  };

  const result: SheetMutationRow[] = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i] as string[];
    const dateRaw = dateIdx >= 0 ? normalizeDate(String(row[dateIdx] ?? "")) : "";
    const desc = descIdx >= 0 ? String(row[descIdx] ?? "").trim() : "";
    if (!dateRaw && !desc) continue;

    let creditAmount = 0;
    let debitAmount  = 0;
    if (creditIdx >= 0) creditAmount = parseIDR(String(row[creditIdx] ?? "0"));
    if (debitIdx >= 0)  debitAmount  = parseIDR(String(row[debitIdx]  ?? "0"));
    // Kolom nominal (bukan saldo) hanya dipakai jika tidak ada kolom debit/kredit
    if (creditIdx < 0 && debitIdx < 0 && nominalIdx >= 0) {
      const nom = parseIDR(String(row[nominalIdx] ?? "0"));
      creditAmount = nom > 0 ? nom : 0;
    }
    const bankAccountId = bankIdx >= 0 ? String(row[bankIdx] ?? "").trim() || undefined : undefined;

    result.push({ transactionDate: dateRaw, description: desc, creditAmount, debitAmount, bankAccountId });
  }

  return result;
}

/**
 * Tulis status rekonsiliasi ke kolom H dari baris yang cocok di Google Sheet.
 * Cocokkan berdasarkan tanggal (kolom yg mengandung "tanggal"/"date") dan
 * keterangan (kolom yg mengandung "keterangan"/"description"). Jika tidak
 * ada header yang cocok, scan semua kolom dan cari nilai yang identik.
 * Row 1 = header → data mulai row 2.
 */
export async function writeApprovalToSheetRow(
  sheetId: string,
  sheetName: string | undefined,
  transactionDate: string,
  description: string,
  statusLabel: string = "DISETUJUI",
  extraNote: string = "",
): Promise<{ updated: boolean; rowIndex: number | null }> {
  const sheets = getClient();
  const resolvedSheetName = sheetName ?? (await getFirstSheetName(sheets, sheetId));

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${resolvedSheetName}!A:Z`,
  });

  const values = resp.data.values ?? [];
  if (values.length < 2) return { updated: false, rowIndex: null };

  const header = (values[0] as string[]).map((h) =>
    String(h ?? "").toLowerCase().replace(/[\s\-\.]+/g, "_"),
  );

  const dateIdx = header.findIndex((h) =>
    ["tanggal", "transaction_date", "date", "tgl"].includes(h),
  );
  const descIdx = header.findIndex((h) =>
    ["keterangan", "description", "ket", "narasi", "deskripsi"].includes(h),
  );

  const normalizeDate = (raw: string) => {
    const s = String(raw ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const parts = s.split("/");
    if (parts.length === 3 && parts[2]!.length === 4) {
      const a = parseInt(parts[0]!, 10);
      const b = parseInt(parts[1]!, 10);
      const month = a > 12 ? b : a;
      const day   = a > 12 ? a : b;
      return `${parts[2]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    const d = new Date(s);
    return !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : s;
  };

  for (let i = 1; i < values.length; i++) {
    const row = values[i] as string[];
    const rowDate = dateIdx >= 0 ? normalizeDate(String(row[dateIdx] ?? "")) : "";
    const rowDesc = descIdx >= 0 ? String(row[descIdx] ?? "").trim() : "";

    const dateMatch = rowDate === transactionDate;
    const descMatch = rowDesc.toLowerCase() === description.toLowerCase();

    if (dateMatch && descMatch) {
      const sheetRowIndex = i + 1; // 1-based
      const cellValue = extraNote ? `${statusLabel} (${extraNote})` : statusLabel;
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${resolvedSheetName}!H${sheetRowIndex}`,
        valueInputOption: "RAW",
        requestBody: { values: [[cellValue]] },
      });
      return { updated: true, rowIndex: sheetRowIndex };
    }
  }

  // Fallback: jika header tidak dikenali, coba cari baris yang mengandung tanggal + keterangan
  for (let i = 1; i < values.length; i++) {
    const row = values[i] as string[];
    const hasDate = row.some((cell) => normalizeDate(String(cell ?? "")) === transactionDate);
    const hasDesc = row.some((cell) => String(cell ?? "").trim().toLowerCase() === description.toLowerCase());
    if (hasDate && hasDesc) {
      const sheetRowIndex = i + 1;
      const cellValue = extraNote ? `${statusLabel} (${extraNote})` : statusLabel;
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${resolvedSheetName}!H${sheetRowIndex}`,
        valueInputOption: "RAW",
        requestBody: { values: [[cellValue]] },
      });
      return { updated: true, rowIndex: sheetRowIndex };
    }
  }

  return { updated: false, rowIndex: null };
}

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
