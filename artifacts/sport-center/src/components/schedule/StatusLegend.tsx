import { motion } from "framer-motion";

const LEGEND = [
  { label: "Confirmed", color: "bg-emerald-500", dot: true },
  { label: "Pending", color: "bg-amber-400", dot: true },
  { label: "Cancelled / Bentrok", color: "bg-red-500", dot: true },
  { label: "Diblokir", color: "bg-orange-500", dot: true },
  { label: "Peak Hour (17–21)", color: "bg-yellow-100 border border-yellow-300", dot: false },
];

export default function StatusLegend() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.3 }}
      className="flex items-center gap-3 flex-wrap"
    >
      {LEGEND.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${item.color}`} />
          {item.label}
        </span>
      ))}
    </motion.div>
  );
}
