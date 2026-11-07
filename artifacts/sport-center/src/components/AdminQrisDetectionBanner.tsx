import { CreditCard, ShieldCheck, TriangleAlert } from "lucide-react";

export type AdminQrisEmailDetection = {
  status?: string | null;
  transactionAt?: string | null;
  confidence?: string | null;
  testMode?: boolean | null;
};

function formatDetectedAt(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function AdminQrisDetectionBanner({
  detection,
  paymentStatus,
}: {
  detection: AdminQrisEmailDetection | null | undefined;
  paymentStatus: string | null | undefined;
}) {
  if (!detection || paymentStatus === "confirmed") return null;

  const exact = detection.status === "reference_match_review";
  const ambiguous = detection.status === "ambiguous" || detection.status === "review_required";
  if (!exact && !ambiguous) return null;

  const detectedAt = formatDetectedAt(detection.transactionAt);
  const testMode = detection.testMode === true;

  if (exact) {
    return (
      <div
        data-testid="admin-qris-detection-exact"
        className="rounded-xl border border-sky-200 bg-sky-50 p-3 dark:border-sky-800 dark:bg-sky-900/20"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-sky-100 p-2 dark:bg-sky-900/40">
            <ShieldCheck size={16} className="text-sky-700 dark:text-sky-300" />
          </div>
          <div className="min-w-0 flex-1">
            {testMode && (
              <div className="mb-1 inline-flex rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                Mode Uji Pencocokan
              </div>
            )}
            <div className="text-sm font-bold text-sky-800 dark:text-sky-200">
              QRIS Mandiri Terdeteksi — Cocok
            </div>
            <div className="mt-1 text-xs text-sky-700 dark:text-sky-300">
              Referensi dan nominal transaksi cocok. Payment tetap menunggu konfirmasi Admin / Finance.
            </div>
            {detectedAt && (
              <div className="mt-1.5 text-[11px] text-sky-600 dark:text-sky-400">
                Terdeteksi: {detectedAt} WIB
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="admin-qris-detection-ambiguous"
      className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-amber-100 p-2 dark:bg-amber-900/40">
          <TriangleAlert size={16} className="text-amber-700 dark:text-amber-300" />
        </div>
        <div className="min-w-0 flex-1">
          {testMode && (
            <div className="mb-1 inline-flex rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
              Mode Uji Pencocokan
            </div>
          )}
          <div className="text-sm font-bold text-amber-800 dark:text-amber-200">
            QRIS Mandiri Terdeteksi — Perlu Verifikasi
          </div>
          <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            {testMode
              ? "Booking ini sedang dipakai untuk uji pencocokan historis. Transaksi boleh berada di luar rentang waktu normal dan tidak boleh dikonfirmasi hanya berdasarkan nominal."
              : "Transaksi ditemukan tetapi belum unik untuk booking ini. Jangan konfirmasi hanya berdasarkan nominal."}
          </div>
          {detectedAt && (
            <div className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
              Terdeteksi: {detectedAt} WIB
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
