import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  CalendarDays,
  Clock,
  User,
  Building2,
  Hash,
  AlertTriangle,
  Lock,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  confirmed: {
    bg: "bg-emerald-100 dark:bg-emerald-900/40",
    text: "text-emerald-700 dark:text-emerald-300",
    label: "Confirmed",
  },
  pending: {
    bg: "bg-amber-100 dark:bg-amber-900/40",
    text: "text-amber-700 dark:text-amber-300",
    label: "Pending",
  },
  cancelled: {
    bg: "bg-red-100 dark:bg-red-900/40",
    text: "text-red-700 dark:text-red-300",
    label: "Cancelled",
  },
};

interface DrawerData {
  type: "booking" | "blocked";
  data: any;
  isConflict?: boolean;
}

interface BookingDrawerProps {
  detail: DrawerData | null;
  onClose: () => void;
  onDeleteBlock: (id: number) => void;
  isDeleting: boolean;
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0">
        <Icon size={13} className="text-slate-500 dark:text-slate-400" />
      </div>
      <div>
        <div className="text-[11px] text-slate-400 dark:text-slate-500 font-medium uppercase tracking-wide mb-0.5">
          {label}
        </div>
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{value}</div>
      </div>
    </div>
  );
}

export default function BookingDrawer({
  detail,
  onClose,
  onDeleteBlock,
  isDeleting,
}: BookingDrawerProps) {
  return (
    <AnimatePresence>
      {detail && (
        <>
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/20 dark:bg-black/40 z-40 lg:hidden"
          />

          <motion.div
            key="drawer"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="fixed right-0 top-0 h-full w-[320px] z-50 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden lg:static lg:h-auto lg:rounded-2xl lg:shadow-md lg:border"
          >
            <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                {detail.type === "booking" ? (
                  <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30">
                    <CalendarDays size={15} className="text-blue-600 dark:text-blue-400" />
                  </div>
                ) : (
                  <div className="p-1.5 rounded-lg bg-orange-50 dark:bg-orange-900/30">
                    <Lock size={15} className="text-orange-600 dark:text-orange-400" />
                  </div>
                )}
                <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  {detail.type === "booking" ? "Detail Booking" : "Slot Diblokir"}
                </span>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {detail.type === "booking" && (
                <>
                  {detail.isConflict && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex items-start gap-2.5 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50"
                    >
                      <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-red-700 dark:text-red-300 font-medium">
                        Booking ini bertabrakan dengan booking lain di fasilitas yang sama.
                      </p>
                    </motion.div>
                  )}

                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-bold text-sm shadow-sm">
                      {detail.data.customerName?.charAt(0)?.toUpperCase() ?? "?"}
                    </div>
                    <div>
                      <div className="font-bold text-sm text-slate-800 dark:text-slate-100">
                        {detail.data.customerName}
                      </div>
                      <div className="text-xs text-slate-400">Customer</div>
                    </div>
                    {(() => {
                      const s = STATUS_COLORS[detail.data.status];
                      return s ? (
                        <span
                          className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${s.bg} ${s.text}`}
                        >
                          {detail.isConflict ? "BENTROK" : s.label}
                        </span>
                      ) : null;
                    })()}
                  </div>

                  <div className="grid gap-3">
                    <DetailRow
                      icon={Building2}
                      label="Fasilitas"
                      value={detail.data.facilityName}
                    />
                    <DetailRow
                      icon={CalendarDays}
                      label="Tanggal"
                      value={new Date(detail.data.bookingDate).toLocaleDateString("id-ID", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    />
                    <DetailRow
                      icon={Clock}
                      label="Waktu"
                      value={`${detail.data.startTime.slice(0, 5)} – ${detail.data.endTime.slice(0, 5)}`}
                    />
                    <DetailRow
                      icon={Hash}
                      label="Order Number"
                      value={detail.data.orderNumber ?? "-"}
                    />
                  </div>
                </>
              )}

              {detail.type === "blocked" && (
                <div className="grid gap-3">
                  <DetailRow icon={Building2} label="Fasilitas" value={detail.data.facilityName ?? "-"} />
                  <DetailRow
                    icon={CalendarDays}
                    label="Tanggal"
                    value={new Date(detail.data.date).toLocaleDateString("id-ID", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  />
                  <DetailRow
                    icon={Clock}
                    label="Waktu"
                    value={`${detail.data.startTime.slice(0, 5)} – ${detail.data.endTime.slice(0, 5)}`}
                  />
                  <DetailRow icon={Lock} label="Alasan" value={detail.data.reason} />
                </div>
              )}
            </div>

            {detail.type === "blocked" && (
              <div className="p-4 border-t border-slate-100 dark:border-slate-800">
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full rounded-xl gap-2"
                  disabled={isDeleting}
                  onClick={() => onDeleteBlock(detail.data.id)}
                >
                  <Trash2 size={14} />
                  {isDeleting ? "Menghapus..." : "Hapus Blokir"}
                </Button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
