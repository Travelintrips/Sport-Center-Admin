import { useRef, useState, useMemo, useCallback } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventInput, EventClickArg, DateSelectArg } from "@fullcalendar/core";
import { motion } from "framer-motion";
import {
  useListFacilities,
  useListBookings,
  useListBlockedSchedules,
  useCreateBlockedSchedule,
  useDeleteBlockedSchedule,
  getListBlockedSchedulesQueryKey,
  getCheckAvailabilityQueryKey,
  getListBookingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

import SummaryStats from "@/components/schedule/SummaryStats";
import CalendarToolbar from "@/components/schedule/CalendarToolbar";
import StatusLegend from "@/components/schedule/StatusLegend";
import BookingDrawer from "@/components/schedule/BookingDrawer";
import BlockSlotModal from "@/components/schedule/BlockSlotModal";
import "@/components/schedule/calendar.css";

const PEAK_START = "17:00:00";
const PEAK_END = "21:00:00";

const FACILITY_COLORS = [
  "#6366f1", "#8b5cf6", "#06b6d4", "#10b981",
  "#f59e0b", "#ef4444", "#ec4899", "#3b82f6",
];

const STATUS_COLORS: Record<string, string> = {
  confirmed: "#10b981",
  pending: "#f59e0b",
  cancelled: "#ef4444",
};

type ViewMode = "timeGridDay" | "timeGridWeek" | "dayGridMonth";

function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return (
    timeToMinutes(aStart) < timeToMinutes(bEnd) &&
    timeToMinutes(bStart) < timeToMinutes(aEnd)
  );
}

export default function AdminSchedule() {
  const calendarRef = useRef<FullCalendar>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedFacility, setSelectedFacility] = useState<string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("timeGridWeek");
  const [blockDialog, setBlockDialog] = useState(false);
  const [drawerDetail, setDrawerDetail] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [calendarTitle, setCalendarTitle] = useState("");
  const [blockForm, setBlockForm] = useState({
    date: "",
    startTime: "08:00",
    endTime: "10:00",
    reason: "Maintenance",
  });

  const { data: facilities = [] } = useListFacilities();
  const { data: bookings = [] } = useListBookings({}, { query: { queryKey: getListBookingsQueryKey({}) } });
  const { data: blocked = [] } = useListBlockedSchedules({}, { query: { queryKey: getListBlockedSchedulesQueryKey({}) } });

  const facilityColorMap = useMemo(() => {
    const map: Record<number, string> = {};
    facilities.forEach((f, i) => {
      map[f.id] = FACILITY_COLORS[i % FACILITY_COLORS.length];
    });
    return map;
  }, [facilities]);

  const conflictIds = useMemo(() => {
    const ids = new Set<string>();
    const active = bookings.filter((b) => b.status !== "cancelled");
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j];
        if (a.facilityId !== b.facilityId || a.bookingDate !== b.bookingDate) continue;
        if (overlaps(a.startTime, a.endTime, b.startTime, b.endTime)) {
          ids.add(`booking-${a.id}`);
          ids.add(`booking-${b.id}`);
        }
      }
    }
    return ids;
  }, [bookings]);

  const filteredBookings = useMemo(() => {
    const facilityId = selectedFacility !== "all" ? Number(selectedFacility) : null;
    return bookings.filter((b) => {
      if (facilityId && b.facilityId !== facilityId) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          b.customerName?.toLowerCase().includes(q) ||
          b.facilityName?.toLowerCase().includes(q) ||
          b.orderNumber?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [bookings, selectedFacility, searchQuery]);

  const events = useMemo((): EventInput[] => {
    const facilityId = selectedFacility !== "all" ? Number(selectedFacility) : null;

    const bookingEvents: EventInput[] = filteredBookings.map((b) => {
      const isConflict = conflictIds.has(`booking-${b.id}`);
      const baseColor = isConflict ? "#ef4444" : (STATUS_COLORS[b.status] ?? "#6b7280");
      return {
        id: `booking-${b.id}`,
        title: `${b.customerName} · ${b.facilityName}`,
        start: `${b.bookingDate}T${b.startTime}`,
        end: `${b.bookingDate}T${b.endTime}`,
        backgroundColor: baseColor,
        borderColor: baseColor,
        textColor: "#ffffff",
        extendedProps: { type: "booking", data: b, isConflict },
      };
    });

    const blockedEvents: EventInput[] = blocked
      .filter((b) => !facilityId || b.facilityId === facilityId)
      .map((b) => ({
        id: `blocked-${b.id}`,
        title: `🔒 ${b.reason}${b.facilityName ? ` · ${b.facilityName}` : ""}`,
        start: `${b.date}T${b.startTime}`,
        end: `${b.date}T${b.endTime}`,
        backgroundColor: "#f97316",
        borderColor: "#f97316",
        textColor: "#ffffff",
        extendedProps: { type: "blocked", data: b },
      }));

    const peakBg: EventInput[] = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
      id: `peak-${dow}`,
      startTime: PEAK_START,
      endTime: PEAK_END,
      daysOfWeek: [dow],
      display: "background",
      backgroundColor: "#fef3c7",
      extendedProps: { type: "peak" },
    }));

    return [...peakBg, ...bookingEvents, ...blockedEvents];
  }, [filteredBookings, blocked, selectedFacility, conflictIds]);

  const createMutation = useCreateBlockedSchedule({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBlockedSchedulesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getCheckAvailabilityQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey({}) });
        toast({ title: "Slot berhasil diblokir" });
        setBlockDialog(false);
      },
      onError: () => toast({ title: "Gagal memblokir slot", variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteBlockedSchedule({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBlockedSchedulesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getCheckAvailabilityQueryKey() });
        toast({ title: "Blokir dihapus" });
        setDrawerDetail(null);
      },
      onError: () => toast({ title: "Gagal menghapus blokir", variant: "destructive" }),
    },
  });

  const handleEventClick = (info: EventClickArg) => {
    const { type, data, isConflict } = info.event.extendedProps;
    if (type === "peak") return;
    setDrawerDetail({ type, data, isConflict });
  };

  const handleDateSelect = (info: DateSelectArg) => {
    const dateStr = info.startStr.split("T")[0];
    const startStr = info.startStr.split("T")[1]?.slice(0, 5) || "08:00";
    const endStr = info.endStr.split("T")[1]?.slice(0, 5) || "10:00";
    setBlockForm({ date: dateStr, startTime: startStr, endTime: endStr, reason: "Maintenance" });
    setBlockDialog(true);
  };

  const handleBlock = (e: React.FormEvent) => {
    e.preventDefault();
    const facilityId = selectedFacility !== "all" ? Number(selectedFacility) : undefined;
    if (!facilityId) {
      toast({ title: "Pilih fasilitas terlebih dahulu", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      data: {
        facilityId,
        date: blockForm.date,
        startTime: blockForm.startTime,
        endTime: blockForm.endTime,
        reason: blockForm.reason,
      },
    });
  };

  const handleViewChange = useCallback((v: ViewMode) => {
    setViewMode(v);
    const api = calendarRef.current?.getApi();
    if (api) {
      api.changeView(v);
      setCalendarTitle(api.view.title);
    }
  }, []);

  const handlePrev = () => {
    const api = calendarRef.current?.getApi();
    if (api) { api.prev(); setCalendarTitle(api.view.title); }
  };

  const handleNext = () => {
    const api = calendarRef.current?.getApi();
    if (api) { api.next(); setCalendarTitle(api.view.title); }
  };

  const handleToday = () => {
    const api = calendarRef.current?.getApi();
    if (api) { api.today(); setCalendarTitle(api.view.title); }
  };

  const handleOpenBlock = () => {
    setBlockForm({
      date: new Date().toISOString().split("T")[0],
      startTime: "08:00",
      endTime: "10:00",
      reason: "Maintenance",
    });
    setBlockDialog(true);
  };

  const conflictCount = conflictIds.size / 2;
  const todayStr = new Date().toISOString().split("T")[0];
  const todayBookings = bookings.filter(
    (b) => b.bookingDate === todayStr && b.status !== "cancelled"
  ).length;
  const pendingCount = bookings.filter((b) => (b.status as string) === "pending").length;

  return (
    <div className="space-y-4 lg:space-y-5 pb-20">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex items-start justify-between gap-3"
      >
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            Schedule Calendar
          </h1>
          <p className="text-sm text-slate-400 dark:text-slate-500 mt-0.5">
            Pantau booking, blokir slot, dan peak hour secara visual
          </p>
        </div>
      </motion.div>

      <SummaryStats
        todayBookings={todayBookings}
        pendingCount={pendingCount}
        conflictCount={conflictCount}
        blockedCount={blocked.length}
      />

      <CalendarToolbar
        title={calendarTitle}
        view={viewMode}
        facilities={facilities}
        selectedFacility={selectedFacility}
        searchQuery={searchQuery}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        onViewChange={handleViewChange}
        onFacilityChange={setSelectedFacility}
        onSearchChange={setSearchQuery}
        onAddBlock={handleOpenBlock}
        facilityColorMap={facilityColorMap}
      />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.15 }}
        className="rounded-2xl border border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 lg:px-5 py-3 border-b border-slate-100 dark:border-slate-800">
          <StatusLegend />
        </div>

        <div className="schedule-calendar p-0">
          <FullCalendar
            ref={calendarRef}
            plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={false}
            locale="id"
            slotMinTime="06:00:00"
            slotMaxTime="23:00:00"
            slotDuration="01:00:00"
            slotLabelInterval="01:00"
            slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
            events={events}
            eventClick={handleEventClick}
            selectable={selectedFacility !== "all"}
            select={handleDateSelect}
            height="auto"
            expandRows
            nowIndicator
            allDaySlot={false}
            eventMaxStack={3}
            dayMaxEvents={false}
            businessHours={{
              daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
              startTime: "06:00",
              endTime: "23:00",
            }}
            viewDidMount={(info) => setCalendarTitle(info.view.title)}
            datesSet={(info) => setCalendarTitle(info.view.title)}
          />
        </div>
      </motion.div>

      <BookingDrawer
        detail={drawerDetail}
        onClose={() => setDrawerDetail(null)}
        onDeleteBlock={(id) => deleteMutation.mutate({ id })}
        isDeleting={deleteMutation.isPending}
      />

      <BlockSlotModal
        open={blockDialog}
        onClose={() => setBlockDialog(false)}
        form={blockForm}
        onChange={setBlockForm}
        onSubmit={handleBlock}
        facilities={facilities}
        selectedFacility={selectedFacility}
        onFacilityChange={setSelectedFacility}
        isPending={createMutation.isPending}
      />
    </div>
  );
}
