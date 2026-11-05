// Exact pending title: BOOKING PERPANJANGAN MEMBERSHIP GYM
import { sendWAToAdmins } from "./notifications";
import { getOrCreatePaymentProofShortUrl } from "./paymentProofShortLink";

export interface GymMembershipWaData {
  event: "pending" | "confirmed";
  action?: "new" | "renew";
  bookingId: number;
  orderNumber: string;
  membershipId: number;
  paymentId: number;
  customerName: string;
  customerCode: string;
  whatsapp: string;
  x904Pin?: string | null;
  months: number;
  previousPeriod?: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  paymentMethod?: string | null;
  paymentDate?: string | null;
  proofUrl?: string | null;
}

const day = (value: string) => {
  const d = new Date(value + "T00:00:00Z");
  return Number.isNaN(d.valueOf()) ? value
    : new Intl.DateTimeFormat("id-ID", {timeZone:"UTC",day:"numeric",month:"long",year:"numeric"}).format(d);
};

export async function notifyGymMembershipWa(data: GymMembershipWaData): Promise<void> {
  const bookingKind = data.action === "new" ? "Pendaftaran Member Baru" : "Perpanjangan Membership";
  const common = `👤 *INFORMASI MEMBER*
Nama: ${data.customerName}
Customer: ${data.customerCode}
Membership ID: #${data.membershipId}`;
  const price = "Rp" + data.amount.toLocaleString("id-ID");
  const period = `*${day(data.periodStart)} – ${day(data.periodEnd)}*`;
  // Direct evidence link via the existing branded proof endpoint, never the
  // admin membership detail page. Raw Storage URLs are not exposed on failure.
  const shortProofUrl = data.event === "confirmed" && data.proofUrl
    ? await getOrCreatePaymentProofShortUrl(data.proofUrl)
    : null;
  const proofText = !data.proofUrl
    ? "Belum tersedia"
    : shortProofUrl && shortProofUrl !== data.proofUrl
      ? shortProofUrl
      : "Tersimpan di sistem (tautan bukti belum tersedia)";
  const report = data.event === "pending"
    ? `📋 *BOOKING ${data.action === "new" ? "PENDAFTARAN" : "PERPANJANGAN"} MEMBERSHIP GYM*

${common}
WhatsApp: ${data.whatsapp}

🏋️ *DETAIL MEMBERSHIP*
Jenis: ${bookingKind}
Paket: ${data.months} Bulan
${data.previousPeriod ? "Periode sebelumnya: " + data.previousPeriod + "\n" : ""}Periode baru: ${period}

🧾 *DETAIL BOOKING*
No. Booking: ${data.orderNumber}
Total tagihan: *${price}*
Status: ⏳ MENUNGGU PEMBAYARAN`
    : `*PEMBAYARAN MEMBERSHIP GYM*

👤 *INFORMASI MEMBER*
Nama: ${data.customerName}
Membership ID: #${data.membershipId}

🧾 *DETAIL BOOKING*
No. Booking: ${data.orderNumber}
Jenis: ${bookingKind}
Paket: ${data.months} Bulan

📅 Periode baru:
${period}

💰 *DETAIL PEMBAYARAN*
Nominal: *${price}*
Metode: ${data.paymentMethod === "transfer" ? "Transfer Bank" : "QRIS Mandiri"}
Tanggal pembayaran: ${day(data.paymentDate || "")}
✅ Status pembayaran: LUNAS
Bukti pembayaran: ${proofText}

Status akses X904: Akses mesin akan dinyatakan aktif setelah verifikasi perangkat berhasil.`;
  await sendWAToAdmins(report,{
    bookingId:data.bookingId,orderNumber:data.orderNumber,
    event:data.event === "pending" ? "gym_membership_pending_report" : "gym_membership_paid_report",
  });
}
