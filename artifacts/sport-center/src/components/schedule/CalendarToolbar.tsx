import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Plus,
  CalendarDays,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ViewMode = "timeGridDay" | "timeGridWeek" | "dayGridMonth";

interface Facility {
  id: number;
  name: string;
}

interface CalendarToolbarProps {
  title: string;
  view: ViewMode;
  facilities: Facility[];
  selectedFacility: string;
  searchQuery: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewChange: (v: ViewMode) => void;
  onFacilityChange: (v: string) => void;
  onSearchChange: (v: string) => void;
  onAddBlock: () => void;
  facilityColorMap: Record<number, string>;
}

const VIEW_OPTIONS: { key: ViewMode; label: string }[] = [
  { key: "timeGridDay", label: "Hari" },
  { key: "timeGridWeek", label: "Minggu" },
  { key: "dayGridMonth", label: "Bulan" },
];

export default function CalendarToolbar({
  title,
  view,
  facilities,
  selectedFacility,
  searchQuery,
  onPrev,
  onNext,
  onToday,
  onViewChange,
  onFacilityChange,
  onSearchChange,
  onAddBlock,
  facilityColorMap,
}: CalendarToolbarProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-2xl border border-slate-200/80 dark:border-slate-700/60 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md shadow-sm p-3 lg:p-4"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <motion.button
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.94 }}
              onClick={onPrev}
              className="w-8 h-8 rounded-lg flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
            >
              <ChevronLeft size={15} />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.94 }}
              onClick={onNext}
              className="w-8 h-8 rounded-lg flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
            >
              <ChevronRight size={15} />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              onClick={onToday}
              className="px-3 h-8 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
            >
              Hari Ini
            </motion.button>
          </div>

          <motion.div
            key={title}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2"
          >
            <CalendarDays size={16} className="text-slate-400" />
            <h2 className="text-sm lg:text-base font-bold text-slate-800 dark:text-slate-100 tracking-tight">
              {title}
            </h2>
          </motion.div>

          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 rounded-xl p-0.5">
            {VIEW_OPTIONS.map((opt) => (
              <motion.button
                key={opt.key}
                whileTap={{ scale: 0.95 }}
                onClick={() => onViewChange(opt.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                  view === opt.key
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                {opt.label}
              </motion.button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-1 min-w-[160px] max-w-[220px]">
            <Filter size={13} className="text-slate-400 shrink-0" />
            <Select value={selectedFacility} onValueChange={onFacilityChange}>
              <SelectTrigger className="h-8 text-xs border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Fasilitas</SelectItem>
                {facilities.map((f) => (
                  <SelectItem key={f.id} value={String(f.id)}>
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: facilityColorMap[f.id] }}
                      />
                      {f.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="relative flex-1 min-w-[140px] max-w-xs">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            />
            <Input
              placeholder="Cari booking..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-8 pl-8 text-xs rounded-lg border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </div>

          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            onClick={onAddBlock}
            className="ml-auto flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors shadow-sm"
          >
            <Plus size={13} />
            Blokir Slot
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
