import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { useLang } from "@/lib/i18n";

export default function Privacy() {
  const { t } = useLang();
  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-4">{t("Kebijakan Privasi", "Privacy Policy")}</h1>
        <p className="text-muted-foreground text-lg">{t("Terakhir diperbarui:", "Last updated:")} {new Date().toLocaleDateString()}</p>
      </div>

      <Card>
        <CardContent className="p-6 md:p-10 prose prose-slate dark:prose-invert max-w-none">
          <h2>{t("1. Informasi yang Kami Kumpulkan", "1. Information We Collect")}</h2>
          <p>
            {t("Saat Anda menggunakan layanan SportCenter, kami mengumpulkan informasi yang membantu kami memberikan Anda pengalaman pemesanan yang lancar. Ini meliputi:", "When you use SportCenter services, we collect information that helps us provide you with a seamless booking experience. This includes:")}
          </p>
          <ul>
            <li><strong>{t("Informasi Pribadi:", "Personal Information:")}</strong> {t("Nama, alamat email, dan nomor telepon (termasuk WhatsApp) yang diberikan saat pemesanan atau pendaftaran.", "Name, email address, and phone number (including WhatsApp) provided during booking or registration.")}</li>
            <li><strong>{t("Data Transaksi:", "Transaction Data:")}</strong> {t("Riwayat pemesanan, preferensi fasilitas, status pembayaran, dan bukti pembayaran yang diunggah.", "Booking history, facility preferences, payment status, and uploaded payment proofs.")}</li>
            <li><strong>{t("Data Penggunaan:", "Usage Data:")}</strong> {t("Informasi tentang bagaimana Anda berinteraksi dengan situs web kami, informasi perangkat, dan alamat IP.", "Information about how you interact with our website, device information, and IP address.")}</li>
          </ul>

          <h2>{t("2. Bagaimana Kami Menggunakan Informasi Anda", "2. How We Use Your Information")}</h2>
          <p>
            {t("Kami menggunakan informasi yang dikumpulkan untuk tujuan berikut:", "We use the collected information for the following purposes:")}
          </p>
          <ul>
            <li>{t("Untuk memproses dan mengelola pemesanan fasilitas Anda.", "To process and manage your facility bookings.")}</li>
            <li>{t("Untuk berkomunikasi dengan Anda terkait pemesanan Anda, termasuk konfirmasi, pengingat, dan verifikasi pembayaran melalui email atau WhatsApp.", "To communicate with you regarding your bookings, including confirmations, reminders, and payment verification via email or WhatsApp.")}</li>
            <li>{t("Untuk menanggapi pertanyaan dan permintaan dukungan pelanggan Anda.", "To respond to your inquiries and customer support requests.")}</li>
            <li>{t("Untuk mengirim penawaran promosi atau pembaruan (jika Anda telah ikut serta).", "To send promotional offers or updates (if you have opted in).")}</li>
            <li>{t("Untuk meningkatkan situs web, layanan, dan operasi fasilitas kami.", "To improve our website, services, and facility operations.")}</li>
          </ul>

          <h2>{t("3. Berbagi dan Pengungkapan Data", "3. Data Sharing and Disclosure")}</h2>
          <p>
            {t("Kami tidak menjual atau menyewakan informasi pribadi Anda kepada pihak ketiga. Kami hanya dapat membagikan informasi Anda dalam keadaan berikut:", "We do not sell or rent your personal information to third parties. We may share your information only in the following circumstances:")}
          </p>
          <ul>
            <li><strong>{t("Penyedia Layanan:", "Service Providers:")}</strong> {t("Dengan vendor pihak ketiga tepercaya yang membantu kami mengoperasikan platform kami (mis. hosting, gateway SMS/WhatsApp).", "With trusted third-party vendors who assist us in operating our platform (e.g., hosting, SMS/WhatsApp gateways).")}</li>
            <li><strong>{t("Persyaratan Hukum:", "Legal Requirements:")}</strong> {t("Jika diwajibkan oleh hukum, regulasi, atau proses hukum.", "If required by law, regulation, or legal process.")}</li>
            <li><strong>{t("Pengalihan Bisnis:", "Business Transfers:")}</strong> {t("Sehubungan dengan merger, akuisisi, atau penjualan aset.", "In connection with a merger, acquisition, or sale of assets.")}</li>
          </ul>

          <h2>{t("4. Keamanan Data", "4. Data Security")}</h2>
          <p>
            {t("Kami menerapkan langkah-langkah teknis dan organisasi yang sesuai untuk melindungi informasi pribadi Anda dari akses, perubahan, pengungkapan, atau pemusnahan yang tidak sah. Namun, tidak ada metode transmisi melalui Internet yang 100% aman, dan kami tidak dapat menjamin keamanan mutlak.", "We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. However, no method of transmission over the Internet is 100% secure, and we cannot guarantee absolute security.")}
          </p>

          <h2>{t("5. Hak Anda", "5. Your Rights")}</h2>
          <p>
            {t("Tergantung pada yurisdiksi Anda, Anda mungkin memiliki hak untuk mengakses, memperbaiki, atau menghapus informasi pribadi Anda. Jika Anda ingin menggunakan salah satu hak ini, silakan hubungi kami menggunakan informasi yang tersedia di", "Depending on your jurisdiction, you may have the right to access, correct, or delete your personal information. If you wish to exercise any of these rights, please contact us using the information provided on our")} <Link href="/contact" className="text-primary hover:underline">{t("halaman Kontak", "Contact page")}</Link>{t(" kami.", ".")}
          </p>

          <h2>{t("6. Tautan Pihak Ketiga", "6. Third-Party Links")}</h2>
          <p>
            {t("Situs web kami mungkin berisi tautan ke situs web pihak ketiga. Kami tidak bertanggung jawab atas praktik privasi atau konten situs eksternal tersebut. Kami menganjurkan Anda untuk membaca kebijakan privasi mereka sebelum memberikan informasi pribadi apa pun.", "Our website may contain links to third-party websites. We are not responsible for the privacy practices or content of such external sites. We encourage you to read their privacy policies before providing any personal information.")}
          </p>

          <h2>{t("7. Hubungi Kami", "7. Contact Us")}</h2>
          <p>
            {t("Jika Anda memiliki pertanyaan atau kekhawatiran tentang Kebijakan Privasi ini atau praktik data kami, silakan hubungi kami melalui", "If you have any questions or concerns about this Privacy Policy or our data practices, please reach out to us via our")} <Link href="/contact" className="text-primary hover:underline">{t("halaman Kontak", "Contact page")}</Link>{t(" kami.", ".")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
