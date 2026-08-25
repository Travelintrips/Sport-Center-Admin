import SEOHead from "@/components/SEOHead";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { useLang } from "@/lib/i18n";

export default function Terms() {
  const { t } = useLang();
  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <SEOHead
        title="Syarat & Ketentuan | Sport Center Soekarno-Hatta"
        description="Syarat dan ketentuan penggunaan layanan Sport Center Soekarno-Hatta. Harap baca dengan seksama sebelum menggunakan layanan pemesanan lapangan kami."
        path="/terms"
      />
      <div className="mb-8">
        <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-4">{t("Ketentuan Layanan", "Terms of Service")}</h1>
        <p className="text-muted-foreground text-lg">{t("Terakhir diperbarui:", "Last updated:")} {new Date().toLocaleDateString()}</p>
      </div>

      <Card>
        <CardContent className="p-6 md:p-10 prose prose-slate dark:prose-invert max-w-none">
          <h2>{t("1. Pendahuluan", "1. Introduction")}</h2>
          <p>
            {t("Selamat datang di SportCenter. Ketentuan Layanan (\"Ketentuan\") ini mengatur penggunaan Anda atas situs web kami, sistem pemesanan fasilitas, dan layanan terkait. Dengan mengakses atau menggunakan layanan kami, Anda setuju untuk terikat oleh Ketentuan ini.", "Welcome to SportCenter. These Terms of Service (\"Terms\") govern your use of our website, facility booking system, and related services. By accessing or using our services, you agree to be bound by these Terms.")}
          </p>

          <h2>{t("2. Pemesanan dan Pembayaran", "2. Booking and Payments")}</h2>
          <p>
            {t("Semua pemesanan tergantung ketersediaan. Saat Anda melakukan pemesanan, Anda diwajibkan menyelesaikan pembayaran dalam jangka waktu yang ditentukan (biasanya 1 jam) untuk mengonfirmasi reservasi Anda. Jika pembayaran tidak diterima dan diverifikasi, pemesanan akan dibatalkan secara otomatis.", "All bookings are subject to availability. When you make a booking, you are required to complete payment within the specified timeframe (usually 1 hour) to confirm your reservation. If payment is not received and verified, the booking will be automatically cancelled.")}
          </p>
          <ul>
            <li>{t("Harga tercantum dalam Rupiah Indonesia (IDR) dan sudah termasuk pajak yang berlaku kecuali dinyatakan lain.", "Prices are listed in Indonesian Rupiah (IDR) and include applicable taxes unless stated otherwise.")}</li>
            <li>{t("Pembayaran harus dilakukan melalui transfer bank atau metode lain yang disetujui.", "Payment must be made via bank transfer or other approved methods.")}</li>
            <li>{t("Anda harus mengunggah bukti pembayaran yang sah melalui portal kami untuk verifikasi.", "You must upload valid proof of payment through our portal for verification.")}</li>
          </ul>

          <h2>{t("3. Pembatalan dan Pengembalian Dana", "3. Cancellations and Refunds")}</h2>
          <p>
            {t("Kami memahami bahwa rencana dapat berubah. Kebijakan pembatalan kami adalah sebagai berikut:", "We understand that plans can change. Our cancellation policy is as follows:")}
          </p>
          <ul>
            <li>{t("Pembatalan yang dilakukan lebih dari 24 jam sebelum waktu pemesanan berhak atas pengembalian dana penuh atau penjadwalan ulang.", "Cancellations made more than 24 hours before the booked time are eligible for a full refund or reschedule.")}</li>
            <li>{t("Pembatalan yang dilakukan antara 12-24 jam sebelum waktu pemesanan berhak atas pengembalian dana 50%.", "Cancellations made between 12-24 hours before the booked time are eligible for a 50% refund.")}</li>
            <li>{t("Pembatalan yang dilakukan kurang dari 12 jam sebelum waktu pemesanan tidak dapat dikembalikan.", "Cancellations made less than 12 hours before the booked time are non-refundable.")}</li>
            <li>{t("Dalam hal penutupan fasilitas karena pemeliharaan, cuaca, atau keadaan tak terduga, kami akan memberikan pengembalian dana penuh atau penjadwalan ulang gratis.", "In the event of facility closure due to maintenance, weather, or unforeseen circumstances, we will provide a full refund or free reschedule.")}</li>
          </ul>

          <h2>{t("4. Peraturan Fasilitas", "4. Facility Rules")}</h2>
          <p>
            {t("Untuk memastikan pengalaman yang aman dan menyenangkan bagi semua pengunjung, harap patuhi peraturan fasilitas kami:", "To ensure a safe and enjoyable experience for all patrons, please adhere to our facility rules:")}
          </p>
          <ul>
            <li>{t("Kenakan pakaian olahraga yang sesuai dan sepatu olahraga yang tidak meninggalkan bekas.", "Wear appropriate sports attire and non-marking sports shoes.")}</li>
            <li>{t("Dilarang merokok, minuman beralkohol, atau zat terlarang di area fasilitas.", "No smoking, alcohol, or illegal substances on the premises.")}</li>
            <li>{t("Hormati pemain lain, staf, dan peralatan.", "Respect other players, staff, and the equipment.")}</li>
            <li>{t("Segala kerusakan yang ditimbulkan pada fasilitas atau peralatan karena kelalaian atau kesalahan akan dibebankan kepada orang yang melakukan pemesanan.", "Any damage caused to the facility or equipment due to negligence or misconduct will be charged to the person who made the booking.")}</li>
            <li>{t("Harap segera meninggalkan lapangan tepat waktu pada akhir sesi pemesanan Anda.", "Please vacate the court promptly at the end of your booked session.")}</li>
          </ul>

          <h2>{t("5. Tanggung Jawab", "5. Liability")}</h2>
          <p>
            {t("SportCenter tidak bertanggung jawab atas cedera, kecelakaan, atau kehilangan barang pribadi yang mungkin terjadi di area fasilitas. Pengguna mengikuti aktivitas olahraga atas risiko mereka sendiri dan disarankan untuk memastikan bahwa mereka cukup bugar secara fisik untuk melakukan aktivitas tersebut.", "SportCenter is not liable for any injuries, accidents, or loss of personal property that may occur on the premises. Users participate in sports activities at their own risk and are advised to ensure they are physically fit to engage in such activities.")}
          </p>

          <h2>{t("6. Privasi", "6. Privacy")}</h2>
          <p>
            {t("Privasi Anda penting bagi kami. Silakan merujuk ke", "Your privacy is important to us. Please refer to our")} <Link href="/privacy" className="text-primary hover:underline">{t("Kebijakan Privasi", "Privacy Policy")}</Link> {t("kami untuk informasi tentang bagaimana kami mengumpulkan, menggunakan, dan melindungi data pribadi Anda.", "for information on how we collect, use, and protect your personal data.")}
          </p>

          <h2>{t("7. Perubahan Ketentuan", "7. Changes to Terms")}</h2>
          <p>
            {t("Kami berhak mengubah Ketentuan ini kapan saja. Perubahan akan berlaku segera setelah diposting di situs web kami. Penggunaan layanan kami yang berkelanjutan merupakan persetujuan atas Ketentuan yang telah diubah.", "We reserve the right to modify these Terms at any time. Changes will be effective immediately upon posting on our website. Continued use of our services constitutes acceptance of the modified Terms.")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
