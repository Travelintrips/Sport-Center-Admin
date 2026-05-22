import { useRef, useState, useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
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
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Lock, Trash2, CalendarDays, Info } from "lucide-react";

const PEAK_START = "17:00:00";
const PEAK_END = "21:00:00";

const FACILITY_COLORS = [
  "#3b82f6", "#8b5cf6", "#06b6d4", "#10b981",
  "#f59e0b", "#ef4444", "#ec4899", "#6366f1",
];

const STATUS_COLORS: Record<string, string> = {
  confirmed: "#16a34a",
  pending: "#d97706",
  cancelled: "#dc2626",
};

function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) &&
    timeToMinutes(bStart) < timeToMinutes(aEnd);
}

export default function AdminSchedule() {
  const calendarRef = useRef<FullCalendar>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedFacility, setSelectedFacility] = useState<string>("all");
  const [blockDialog, setBlockDialog] = useState(false);
  const [detailDialog, setDetailDialog] = useState<any>(null);
  const [blockForm, setBlockForm] = useState({ date: "", startTime: "08:00", endTime: "10:00", reason: "Maintenance" });

  const { data: facilities = [] } = useListFacilities();
  const { data: bookings = [] } = useListBookings({}, { query: { queryKey: getListBookingsQueryKey({}) } });
  const { data: blocked = [] } = useListBlockedSchedules({}, { query: { queryKey: getListBlockedSchedulesQueryKey({}) } });

  const facilityColorMap = useMemo(() => {
    const map: Record<number, string> = {};
    facilities.forEach((f, i) => { map[f.id] = FACILITY_COLORS[i % FACILITY_COLORS.length]; });
    return map;
  }, [facilities]);

  const conflictIds = useMemo(() => {
    const ids = new Set<string>();
    const active = bookings.filter(b => b.status !== "cancelled");
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

  const events = useMemo((): EventInput[] => {
    const facilityId = selectedFacility !== "all" ? Number(selectedFacility) : null;

    const bookingEvents: EventInput[] = bookings
      .filter(b => !facilityId || b.facilityId === facilityId)
      .map(b => {
        const isConflict = conflictIds.has(`booking-${b.id}`);
        const baseColor = STATUS_COLORS[b.status] ?? "#6b7280";
        return {
          id: `booking-${b.id}`,
          title: `${b.customerName} — ${b.facilityName}`,
          start: `${b.bookingDate}T${b.startTime}`,
          end: `${b.bookingDate}T${b.endTime}`,
          backgroundColor: isConflict ? "#dc2626" : baseColor,
          borderColor: isConflict ? "#991b1b" : baseColor,
          textColor: "#ffffff",
          extendedProps: { type: "booking", data: b, isConflict },
        };
      });

    const blockedEvents: EventInput[] = blocked
      .filter(b => !facilityId || b.facilityId === facilityId)
      .map(b => ({
        id: `blocked-${b.id}`,
        title: `🔒 ${b.reason}${b.facilityName ? ` (${b.facilityName})` : ""}`,
        start: `${b.date}T${b.startTime}`,
        end: `${b.date}T${b.endTime}`,
        backgroundColor: "#f97316",
        borderColor: "#ea580c",
        textColor: "#ffffff",
        extendedProps: { type: "blocked", data: b },
      }));

    const peakBg: EventInput[] = [0, 1, 2, 3, 4, 5, 6].map(dow => ({
      id: `peak-${dow}`,
      startTime: PEAK_START,
      endTime: PEAK_END,
      daysOfWeek: [dow],
      display: "background",
      backgroundColor: "#fef9c3",
      title: "Peak Hour",
      extendedProps: { type: "peak" },
    }));

    return [...peakBg, ...bookingEvents, ...blockedEvents];
  }, [bookings, blocked, selectedFacility, conflictIds]);

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
    }
  });

  const deleteMutation = useDeleteBlockedSchedule({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBlockedSchedulesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getCheckAvailabilityQueryKey() });
        toast({ title: "Blokir dihapus" });
        setDetailDialog(null);
      },
      onError: () => toast({ title: "Gagal menghapus blokir", variant: "destructive" }),
    }
  });

  const handleEventClick = (info: EventClickArg) => {
    const { type, data, isConflict } = info.event.extendedProps;
    if (type === "peak") return;
    setDetailDialog({ type, data, isConflict });
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
    if (!facilityId) { toast({ title: "Pilih fasilitas terlebih dahulu", variant: "destructive" }); return; }
    createMutation.mutate({ data: { facilityId, date: blockForm.date, startTime: blockForm.startTime, endTime: blockForm.endTime, reason: blockForm.reason } });
  };

  const conflictCount = conflictIds.size / 2;
  const todayBookings = bookings.filter(b => b.bookingDate === new Date().toISOString().split("T")[0] && b.status !== "cancelled").length;
  const pendingCount = bookings.filter(b => b.status === "pending").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black">Schedule Calendar</h1>
          <p className="text-muted-foreground text-sm">Lihat booking, slot kosong, dan peak hour secara visual</p>
        </div>
        <Button
          onClick={() => {
            setBlockForm({ date: new Date().toISOString().split("T")[0], startTime: "08:00", endTime: "10:00", reason: "Maintenance" });
            setBlockDialog(true);
          }}
          variant="outline"
        >
          <Lock size={14} className="mr-2" /> Blokir Slot
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="text-2xl font-black">{todayBookings}</div><div className="text-xs text-muted-foreground">Booking Hari Ini</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-black text-amber-500">{pendingCount}</div><div className="text-xs text-muted-foreground">Pending</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-black text-red-500">{conflictCount}</div><div className="text-xs text-muted-foreground">Bentrok</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-black text-orange-500">{blocked.length}</div><div className="text-xs text-muted-foreground">Slot Diblokir</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex items-center gap-2 flex-1 min-w-[180px]">
              <Label className="shrink-0 text-sm">Fasilitas:</Label>
              <Select value={selectedFacility} onValueChange={setSelectedFacility}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Fasilitas</SelectItem>
                  {facilities.map(f => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: facilityColorMap[f.id] }} />
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3 flex-wrap text-xs">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-600 inline-block" /> Confirmed</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-500 inline-block" /> Pending</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-600 inline-block" /> Cancelled / Bentrok</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-orange-500 inline-block" /> Diblokir</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-yellow-100 border border-yellow-300 inline-block" /> Peak Hour (17–21)</span>
            </div>
          </div>

          <FullCalendar
            ref={calendarRef}
            plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "timeGridDay,timeGridWeek,dayGridMonth",
            }}
            locale="id"
            buttonText={{ today: "Hari Ini", day: "Hari", week: "Minggu", month: "Bulan" }}
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
            businessHours={{ daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: "06:00", endTime: "23:00" }}
          />
        </CardContent>
      </Card>

      <Dialog open={blockDialog} onOpenChange={setBlockDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Lock size={16} /> Blokir Slot Waktu</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleBlock} className="space-y-4">
            {selectedFacility === "all" && (
              <div className="space-y-2">
                <Label>Fasilitas *</Label>
                <Select value="" onValueChange={(v) => setSelectedFacility(v)}>
                  <SelectTrigger><SelectValue placeholder="Pilih fasilitas..." /></SelectTrigger>
                  <SelectContent>
                    {facilities.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Tanggal *</Label>
              <Input type="date" required value={blockForm.date} onChange={(e) => setBlockForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Mulai</Label>
                <Input type="time" required value={blockForm.startTime} min="06:00" max="23:00" onChange={(e) => setBlockForm(f => ({ ...f, startTime: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Selesai</Label>
                <Input type="time" required value={blockForm.endTime} min="06:00" max="23:00" onChange={(e) => setBlockForm(f => ({ ...f, endTime: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Alasan</Label>
              <Input required value={blockForm.reason} onChange={(e) => setBlockForm(f => ({ ...f, reason: e.target.value }))} placeholder="Maintenance, Event, Tutup..." />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setBlockDialog(false)}>Batal</Button>
              <Button type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? "Menyimpan..." : "Blokir"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailDialog} onOpenChange={(v) => !v && setDetailDialog(null)}>
        <DialogContent className="max-w-sm">
          {detailDialog?.type === "booking" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CalendarDays size={16} /> Detail Booking
                  {detailDialog.isConflict && <Badge variant="destructive" className="ml-auto text-xs">BENTROK</Badge>}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div><div className="text-xs text-muted-foreground">Pelanggan</div><div className="font-semibold">{detailDialog.data.customerName}</div></div>
                  <div><div className="text-xs text-muted-foreground">Status</div>
                    <Badge className="text-xs" style={{ backgroundColor: STATUS_COLORS[detailDialog.data.status] }}>{detailDialog.data.status}</Badge>
                  </div>
                  <div><div className="text-xs text-muted-foreground">Fasilitas</div><div className="font-semibold">{detailDialog.data.facilityName}</div></div>
                  <div><div className="text-xs text-muted-foreground">Tanggal</div><div className="font-semibold">{detailDialog.data.bookingDate}</div></div>
                  <div><div className="text-xs text-muted-foreground">Waktu</div><div className="font-semibold">{detailDialog.data.startTime} – {detailDialog.data.endTime}</div></div>
                  <div><div className="text-xs text-muted-foreground">Order</div><div className="font-semibold text-xs">{detailDialog.data.orderNumber}</div></div>
                </div>
                {detailDialog.isConflict && (
                  <div className="bg-red-50 border border-red-200 rounded-md p-3 text-red-700 text-xs flex gap-2">
                    <Info size={14} className="shrink-0 mt-0.5" />
                    <span>Booking ini bertabrakan dengan booking lain di fasilitas yang sama pada waktu yang sama.</span>
                  </div>
                )}
              </div>
            </>
          )}
          {detailDialog?.type === "blocked" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Lock size={16} /> Slot Diblokir</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div><div className="text-xs text-muted-foreground">Fasilitas</div><div className="font-semibold">{detailDialog.data.facilityName}</div></div>
                  <div><div className="text-xs text-muted-foreground">Tanggal</div><div className="font-semibold">{detailDialog.data.date}</div></div>
                  <div><div className="text-xs text-muted-foreground">Waktu</div><div className="font-semibold">{detailDialog.data.startTime} – {detailDialog.data.endTime}</div></div>
                  <div><div className="text-xs text-muted-foreground">Alasan</div><div className="font-semibold">{detailDialog.data.reason}</div></div>
                </div>
                <Button variant="destructive" className="w-full" size="sm"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate({ id: detailDialog.data.id })}>
                  <Trash2 size={14} className="mr-2" /> Hapus Blokir
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
