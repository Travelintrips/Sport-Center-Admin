import { sendWAToAdmins } from "./notifications";

export interface GymMembershipWaData {
  event: "pending" | "confirmed";
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
  const common = `👤 *INFORMASI MEMBER*
Nama: ${data.customerName}
Customer: ${data.customerCode}
Membership ID: #${data.membershipId}`;
  const price = "Rp" + data.amount.toLocaleString("id-ID");
  const period = `*${day(data.periodStart)} – ${day(data.periodEnd)}*`;
  const report = data.event === "pending"
    ? `📋 *BOOKING PERPANJANGAN MEMBERSHIP GYM*

${common}
WhatsApp: ${data.whatsapp}

🏋️ *DETAIL MEMBERSHIP*
Jenis: Perpanjangan Membership
Paket: ${data.months} Bulan
${data.previousPeriod ? "Periode sebelumnya: " + data.previousPeriod + "\n" : ""}Periode baru: ${period}

🧾 *DETAIL BOOKING*
No. Booking: ${data.orderNumber}
Total tagihan: *${price}*
Status: ⏳ MENUNGGU PEMBAYARAN`
    : `*PEMBAYARAN MEMBERSHIP GYM*

${common}
PIN X904: ${data.x904Pin || "Belum diverifikasi"}

🧾 *DETAIL BOOKING*
No. Booking: ${data.orderNumber}
Jenis: Perpanjangan Membership
Paket: ${data.months} Bulan

📅 Periode baru:
${period}

💰 *DETAIL PEMBAYARAN*
Nominal: *${price}*
Metode: ${data.paymentMethod === "transfer" ? "Transfer Bank" : "QRIS Mandiri"}
Tanggal pembayaran: ${day(data.paymentDate || "")}
✅ Status pembayaran: LUNAS
Bukti pembayaran: ${data.proofUrl || "Tersimpan"}

⏳ Status akses X904: MENUNGGU ACK/READ-BACK
Akses mesin X904 akan dinyatakan aktif setelah verifikasi perangkat berhasil.`;
  await sendWAToAdmins(report,{
    bookingId:data.bookingId,orderNumber:data.orderNumber,
    event:data.event === "pending" ? "gym_membership_pending_report" : "gym_membership_paid_report",
  });
}
