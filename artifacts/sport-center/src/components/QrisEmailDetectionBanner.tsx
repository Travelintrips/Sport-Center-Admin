import { Clock } from "lucide-react";

export type QrisEmailDetection = {
  status?: string | null;
  transactionAt?: string | null;
  confidence?: "high" | "low" | string | null;
};

type Translate = (id: string, en: string) => string;

export function QrisEmailDetectionBanner({
  detection,
  paymentStatus,
  t,
}: {
  detection: QrisEmailDetection | null | undefined;
  paymentStatus: string | null | undefined;
  t: Translate;
}) {
  if (!detection || paymentStatus === "confirmed") return null;
  const highConfidence = detection.confidence === "high";

  return (
    <div className={`flex items-start gap-3 p-3.5 rounded-xl border ${
      highConfidence
        ? "border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800"
        : "border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800"
    }`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
        highConfidence
          ? "bg-blue-100 dark:bg-blue-900/40"
          : "bg-amber-100 dark:bg-amber-900/40"
      }`}>
        <Clock
          size={16}
          className={
            highConfidence
              ? "text-blue-600 dark:text-blue-300"
              : "text-amber-600 dark:text-amber-300"
          }
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className={`font-semibold text-sm ${
          highConfidence
            ? "text-blue-800 dark:text-blue-200"
            : "text-amber-800 dark:text-amber-200"
        }`}>
          {t("Pembayaran QRIS Terdeteksi", "QRIS Payment Detected")}
        </div>
        <div className={`text-xs mt-0.5 ${
          highConfidence
            ? "text-blue-600 dark:text-blue-400"
            : "text-amber-600 dark:text-amber-400"
        }`}>
          {highConfidence
            ? t(
                "Notifikasi transaksi Mandiri sudah cocok dengan referensi dan nominal. Sistem sedang menunggu verifikasi rekonsiliasi sebelum booking dikonfirmasi.",
                "The Mandiri transaction notification matches the reference and amount. Reconciliation verification is still required before confirming the booking.",
              )
            : t(
                "Notifikasi transaksi Mandiri ditemukan, tetapi kecocokannya belum unik. Pembayaran sedang diverifikasi dan booking belum dinyatakan lunas.",
                "A Mandiri transaction notification was found, but the match is not unique yet. The payment is under review and the booking is not marked paid.",
              )}
        </div>
      </div>
    </div>
  );
}
