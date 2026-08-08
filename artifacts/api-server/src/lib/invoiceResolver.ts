/**
 * invoiceResolver.ts
 * Mengambil dan merakit data invoice dari DB — digunakan oleh routes/invoices.ts
 * maupun lib/invoiceDelivery.ts sehingga tidak ada duplikasi logika.
 */

import {
  db,
  bookingsTable,
  bookingGroupsTable,
  facilitiesTable,
  settingsTable,
  taxSettingsTable,
  companyDocumentSettingsTable,
  corporateBookingDocumentationTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import type { InvoiceSession, InvoiceData } from "./invoiceTemplate";

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatInvoiceNumber(orderNumber: string, bookingDate: string): string {
  const datePart = bookingDate.replace(/-/g, "").substring(0, 8);
  const seq = orderNumber.replace(/[^0-9]/g, "").slice(-6).padStart(6, "0");
  return `INV/SC/${datePart}/${seq}`;
}

function pick<T>(invoice: T | null | undefined, general: T | null | undefined, fallback: T): T {
  return (invoice !== null && invoice !== undefined && invoice !== "" as unknown as T)
    ? invoice as T
    : (general !== null && general !== undefined && general !== "" as unknown as T)
      ? general as T
      : fallback;
}

async function loadDocSettings() {
  const docRows = await db
    .select()
    .from(companyDocumentSettingsTable)
    .where(inArray(companyDocumentSettingsTable.documentType, ["invoice", "general"]));
  return {
    invoiceDoc: docRows.find((r) => r.documentType === "invoice"),
    generalDoc: docRows.find((r) => r.documentType === "general"),
  };
}

async function resolvePpnRate(
  bookingPpnRate: string | null | undefined,
  fallback = 11,
): Promise<number> {
  if (bookingPpnRate) return Number(bookingPpnRate);
  const [taxSetting] = await db
    .select()
    .from(taxSettingsTable)
    .where(eq(taxSettingsTable.isActive, true))
    .limit(1);
  return taxSetting ? Number(taxSetting.taxRate) : fallback;
}

function calcDpp(grandTotal: number, ppnRate: number) {
  if (ppnRate <= 0) return { dpp: grandTotal, dppNilaiLain: 0, ppnAmount: 0, grandTotal };
  const rate = ppnRate / 100;
  const dpp = Math.round(grandTotal / (1 + rate));
  const dppNilaiLain = Math.round((dpp * 11) / 12);
  const ppnAmount = Math.round(dppNilaiLain * 0.12);
  return { dpp, dppNilaiLain, ppnAmount, grandTotal: dpp + ppnAmount };
}

// ─── resolveInvoiceData — invoice booking tunggal ────────────────────────────

export async function resolveInvoiceData(orderNumber: string): Promise<InvoiceData | null> {
  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.orderNumber, orderNumber))
    .limit(1);
  if (!booking) return null;

  const [facility] = await db
    .select()
    .from(facilitiesTable)
    .where(eq(facilitiesTable.id, booking.facilityId))
    .limit(1);

  const [settings] = await db.select().from(settingsTable).limit(1);
  const { invoiceDoc, generalDoc } = await loadDocSettings();

  const ppnRate = await resolvePpnRate(booking.ppnRate);
  const baseGrandTotal = booking.grandTotal ? Number(booking.grandTotal) : Number(booking.totalPrice ?? 0);
  const { dpp, dppNilaiLain, ppnAmount, grandTotal } = calcDpp(baseGrandTotal, ppnRate);
  const invoiceNumber = formatInvoiceNumber(booking.orderNumber, booking.bookingDate);

  return {
    invoiceNumber,
    invoiceDate: new Date().toISOString().split("T")[0]!,
    orderNumber: booking.orderNumber,
    status: booking.status,

    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    customerEmail: booking.customerEmail,

    facilityName: facility?.name ?? "—",
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    durationHours: booking.durationHours,

    pricePerHour: facility ? Number(facility.pricePerHour) : 0,
    dpp,
    dppNilaiLain,
    ppnRate,
    ppnAmount,
    grandTotal,

    promoCode: booking.promoCode ?? null,
    discountAmount: Number(booking.discountAmount ?? 0),
    bookingType: booking.bookingType ?? "regular",

    centerName: settings?.centerName || "Sport Center Soekarno-Hatta",
    centerAddress: settings?.address || "Kawasan Bandara Soekarno-Hatta, Tangerang 19110",
    centerPhone: settings?.phone || "",
    bankName: pick(invoiceDoc?.bankName, generalDoc?.bankName, settings?.bankName || "Bank Mandiri"),
    bankAccount: pick(invoiceDoc?.bankAccount, generalDoc?.bankAccount, settings?.bankAccount || ""),
    bankAccountName: pick(invoiceDoc?.bankHolder, generalDoc?.bankHolder, settings?.bankAccountName || "Sport Center Soekarno-Hatta"),

    logoUrl: invoiceDoc?.logoUrl ?? generalDoc?.logoUrl ?? (settings as any)?.logoUrl ?? null,
    kopSuratHtml: invoiceDoc?.kopSuratHtml ?? generalDoc?.kopSuratHtml ?? null,
    financeName: pick(invoiceDoc?.financeName, generalDoc?.financeName, ""),
    financeTitle: pick(invoiceDoc?.financeTitle, generalDoc?.financeTitle, "Finance Manager"),
    signatureUrl: invoiceDoc?.signatureUrl ?? generalDoc?.signatureUrl ?? null,
    footerText: invoiceDoc?.footerHtml ?? generalDoc?.footerHtml ?? null,
    invoicePrefix: pick(invoiceDoc?.prefixNumber, generalDoc?.prefixNumber, "INV"),

    documentation:
      booking.payerType === "company"
        ? await db
            .select({
              fileUrl: corporateBookingDocumentationTable.fileUrl,
              fileName: corporateBookingDocumentationTable.fileName,
              caption: corporateBookingDocumentationTable.caption,
            })
            .from(corporateBookingDocumentationTable)
            .where(eq(corporateBookingDocumentationTable.bookingId, booking.id))
        : undefined,
  };
}

// ─── resolveGroupInvoiceData — invoice repeat booking ────────────────────────

export async function resolveGroupInvoiceData(groupRef: string): Promise<InvoiceData | null> {
  const [group] = await db
    .select()
    .from(bookingGroupsTable)
    .where(eq(bookingGroupsTable.groupRef, groupRef))
    .limit(1);
  if (!group) return null;

  const groupBookings = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.groupRef, groupRef));
  if (!groupBookings.length) return null;

  groupBookings.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
  const firstBooking = groupBookings[0]!;

  const [facility] = await db
    .select()
    .from(facilitiesTable)
    .where(eq(facilitiesTable.id, firstBooking.facilityId))
    .limit(1);

  const [settings] = await db.select().from(settingsTable).limit(1);
  const { invoiceDoc, generalDoc } = await loadDocSettings();

  const ppnRate = await resolvePpnRate(firstBooking.ppnRate);
  const totalGrandTotal = groupBookings.reduce((sum, b) => {
    return sum + (b.grandTotal != null ? Number(b.grandTotal) : Number(b.totalPrice));
  }, 0);
  const { dpp, dppNilaiLain, ppnAmount, grandTotal } = calcDpp(totalGrandTotal, ppnRate);

  // Nama fasilitas per booking (bisa berbeda jika multi-fasilitas)
  const facilityNames: Record<number, string> = {};
  const facilityIds = [...new Set(groupBookings.map((b) => b.facilityId))];
  if (facilityIds.length > 1) {
    const facilities = await db
      .select({ id: facilitiesTable.id, name: facilitiesTable.name })
      .from(facilitiesTable)
      .where(inArray(facilitiesTable.id, facilityIds));
    for (const f of facilities) facilityNames[f.id] = f.name;
  } else {
    facilityNames[firstBooking.facilityId] = facility?.name ?? "—";
  }

  const sessions: InvoiceSession[] = groupBookings.map((b) => {
    const discountAmt = Number(b.discountAmount ?? 0);
    const grandTotalVal = b.grandTotal != null ? Number(b.grandTotal) : Number(b.totalPrice);
    const basePriceVal =
      b.basePrice != null
        ? Number(b.basePrice)
        : discountAmt > 0
          ? Number(b.totalPrice) + discountAmt
          : grandTotalVal;
    return {
      orderNumber: b.orderNumber,
      facilityName: facilityNames[b.facilityId] ?? facility?.name ?? "—",
      bookingDate: b.bookingDate,
      startTime: b.startTime,
      endTime: b.endTime,
      durationHours: b.durationHours,
      basePrice: basePriceVal,
      grandTotal: grandTotalVal,
      discountAmount: discountAmt,
      bookingType: b.bookingType ?? "regular",
      status: b.status,
    };
  });

  const totalDiscount = sessions.reduce((sum, s) => sum + (s.discountAmount ?? 0), 0);
  const datePart = firstBooking.bookingDate.replace(/-/g, "").substring(0, 8);
  const groupSeq = groupRef.replace(/[^0-9]/g, "").padStart(6, "0");
  const invoiceNumber = `INV/SC/GRP/${datePart}/${groupSeq}`;

  return {
    invoiceNumber,
    invoiceDate: new Date().toISOString().split("T")[0]!,
    orderNumber: groupRef,
    status: firstBooking.status,

    customerName: firstBooking.customerName,
    customerPhone: firstBooking.customerPhone,
    customerEmail: firstBooking.customerEmail ?? "",

    facilityName: facility?.name ?? "—",
    bookingDate: firstBooking.bookingDate,
    startTime: firstBooking.startTime,
    endTime: firstBooking.endTime,
    durationHours: firstBooking.durationHours,

    pricePerHour: facility ? Number(facility.pricePerHour) : 0,
    dpp,
    dppNilaiLain,
    ppnRate,
    ppnAmount,
    grandTotal,

    promoCode: firstBooking.promoCode ?? null,
    discountAmount: totalDiscount,
    groupRef,
    sessions,

    centerName: settings?.centerName || "Sport Center Soekarno-Hatta",
    centerAddress: settings?.address || "Kawasan Bandara Soekarno-Hatta, Tangerang 19110",
    centerPhone: settings?.phone || "",
    bankName: pick(invoiceDoc?.bankName, generalDoc?.bankName, settings?.bankName || "Bank Mandiri"),
    bankAccount: pick(invoiceDoc?.bankAccount, generalDoc?.bankAccount, settings?.bankAccount || ""),
    bankAccountName: pick(invoiceDoc?.bankHolder, generalDoc?.bankHolder, settings?.bankAccountName || "Sport Center Soekarno-Hatta"),

    logoUrl: invoiceDoc?.logoUrl ?? generalDoc?.logoUrl ?? (settings as any)?.logoUrl ?? null,
    kopSuratHtml: invoiceDoc?.kopSuratHtml ?? generalDoc?.kopSuratHtml ?? null,
    financeName: pick(invoiceDoc?.financeName, generalDoc?.financeName, ""),
    financeTitle: pick(invoiceDoc?.financeTitle, generalDoc?.financeTitle, "Finance Manager"),
    signatureUrl: invoiceDoc?.signatureUrl ?? generalDoc?.signatureUrl ?? null,
    footerText: invoiceDoc?.footerHtml ?? generalDoc?.footerHtml ?? null,
    invoicePrefix: pick(invoiceDoc?.prefixNumber, generalDoc?.prefixNumber, "INV"),
  };
}
