import { motion, AnimatePresence } from "framer-motion";
import { X, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Facility {
  id: number;
  name: string;
}

interface BlockForm {
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
}

interface BlockSlotModalProps {
  open: boolean;
  onClose: () => void;
  form: BlockForm;
  onChange: (f: BlockForm) => void;
  onSubmit: (e: React.FormEvent) => void;
  facilities: Facility[];
  selectedFacility: string;
  onFacilityChange: (v: string) => void;
  isPending: boolean;
}

export default function BlockSlotModal({
  open,
  onClose,
  form,
  onChange,
  onSubmit,
  facilities,
  selectedFacility,
  onFacilityChange,
  isPending,
}: BlockSlotModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm z-50"
          />
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: "spring", stiffness: 340, damping: 28 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm"
          >
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200/80 dark:border-slate-700/60 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800">
                    <Lock size={14} className="text-slate-600 dark:text-slate-400" />
                  </div>
                  <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100">
                    Blokir Slot Waktu
                  </h3>
                </div>
                <button
                  onClick={onClose}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              <form onSubmit={onSubmit} className="p-5 space-y-4">
                {selectedFacility === "all" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                      Fasilitas <span className="text-red-500">*</span>
                    </Label>
                    <Select value="" onValueChange={onFacilityChange}>
                      <SelectTrigger className="h-9 text-sm rounded-xl border-slate-200 dark:border-slate-700">
                        <SelectValue placeholder="Pilih fasilitas..." />
                      </SelectTrigger>
                      <SelectContent>
                        {facilities.map((f) => (
                          <SelectItem key={f.id} value={String(f.id)}>
                            {f.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                    Tanggal <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="date"
                    required
                    value={form.date}
                    onChange={(e) => onChange({ ...form, date: e.target.value })}
                    className="h-9 text-sm rounded-xl border-slate-200 dark:border-slate-700"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                      Mulai
                    </Label>
                    <Input
                      type="time"
                      required
                      value={form.startTime}
                      min="06:00"
                      max="23:00"
                      onChange={(e) => onChange({ ...form, startTime: e.target.value })}
                      className="h-9 text-sm rounded-xl border-slate-200 dark:border-slate-700"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                      Selesai
                    </Label>
                    <Input
                      type="time"
                      required
                      value={form.endTime}
                      min="06:00"
                      max="23:00"
                      onChange={(e) => onChange({ ...form, endTime: e.target.value })}
                      className="h-9 text-sm rounded-xl border-slate-200 dark:border-slate-700"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                    Alasan
                  </Label>
                  <Input
                    required
                    value={form.reason}
                    onChange={(e) => onChange({ ...form, reason: e.target.value })}
                    placeholder="Maintenance, Event, Tutup..."
                    className="h-9 text-sm rounded-xl border-slate-200 dark:border-slate-700"
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 rounded-xl text-xs"
                    onClick={onClose}
                  >
                    Batal
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isPending}
                    className="flex-1 rounded-xl text-xs bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100"
                  >
                    {isPending ? "Menyimpan..." : "Blokir Slot"}
                  </Button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
