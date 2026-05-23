import { motion } from "framer-motion";
import { CalendarCheck, Clock, AlertTriangle, Lock } from "lucide-react";

interface SummaryStatsProps {
  todayBookings: number;
  pendingCount: number;
  conflictCount: number;
  blockedCount: number;
}

const stats = (
  todayBookings: number,
  pendingCount: number,
  conflictCount: number,
  blockedCount: number
) => [
  {
    label: "Booking Hari Ini",
    value: todayBookings,
    icon: CalendarCheck,
    gradient: "from-blue-500/10 to-indigo-500/10",
    iconBg: "bg-blue-500/15",
    iconColor: "text-blue-600 dark:text-blue-400",
    valueColor: "text-blue-700 dark:text-blue-300",
    border: "border-blue-200/60 dark:border-blue-800/40",
    trend: "+2 dari kemarin",
    trendUp: true,
  },
  {
    label: "Menunggu Konfirmasi",
    value: pendingCount,
    icon: Clock,
    gradient: "from-amber-500/10 to-yellow-500/10",
    iconBg: "bg-amber-500/15",
    iconColor: "text-amber-600 dark:text-amber-400",
    valueColor: "text-amber-700 dark:text-amber-300",
    border: "border-amber-200/60 dark:border-amber-800/40",
    trend: pendingCount > 0 ? "Perlu tindakan" : "Semua beres",
    trendUp: false,
  },
  {
    label: "Booking Bentrok",
    value: conflictCount,
    icon: AlertTriangle,
    gradient: "from-red-500/10 to-rose-500/10",
    iconBg: "bg-red-500/15",
    iconColor: "text-red-600 dark:text-red-400",
    valueColor: "text-red-700 dark:text-red-300",
    border: "border-red-200/60 dark:border-red-800/40",
    trend: conflictCount > 0 ? "Segera resolusi" : "Tidak ada bentrok",
    trendUp: false,
  },
  {
    label: "Slot Diblokir",
    value: blockedCount,
    icon: Lock,
    gradient: "from-slate-500/10 to-gray-500/10",
    iconBg: "bg-slate-500/15",
    iconColor: "text-slate-600 dark:text-slate-400",
    valueColor: "text-slate-700 dark:text-slate-300",
    border: "border-slate-200/60 dark:border-slate-700/40",
    trend: `${blockedCount} slot tidak tersedia`,
    trendUp: false,
  },
];

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } },
};

export default function SummaryStats({
  todayBookings,
  pendingCount,
  conflictCount,
  blockedCount,
}: SummaryStatsProps) {
  const items = stats(todayBookings, pendingCount, conflictCount, blockedCount);

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <motion.div
            key={item.label}
            variants={cardVariants}
            whileHover={{ y: -2, scale: 1.01 }}
            transition={{ duration: 0.2 }}
            className={`
              relative overflow-hidden rounded-2xl border bg-gradient-to-br ${item.gradient}
              ${item.border} bg-white dark:bg-slate-900 p-4 lg:p-5
              shadow-sm hover:shadow-md transition-shadow duration-200 cursor-default
            `}
          >
            <div className="flex items-start justify-between mb-3">
              <div className={`p-2 rounded-xl ${item.iconBg}`}>
                <Icon size={18} className={item.iconColor} />
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${item.iconBg} ${item.iconColor}`}>
                {item.trendUp ? "↑" : item.value > 0 ? "!" : "✓"}
              </span>
            </div>
            <div className={`text-3xl lg:text-4xl font-black tracking-tight mb-1 ${item.valueColor}`}>
              {item.value}
            </div>
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-0.5">
              {item.label}
            </div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500">
              {item.trend}
            </div>

            <div className={`absolute -bottom-4 -right-4 w-20 h-20 rounded-full ${item.iconBg} opacity-40`} />
          </motion.div>
        );
      })}
    </motion.div>
  );
}
