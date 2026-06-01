import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";

function apiFetch(path: string) {
  return fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${getToken()}` } }).then((r) => r.json());
}

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Menunggu Bayar",
  waiting_confirmation: "Menunggu Konfirmasi",
  paid: "Sudah Bayar",
  confirmed: "Dikonfirmasi",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  rejected: "Ditolak",
  expired: "Expired",
  blocked: "Diblokir",
  maintenance: "Maintenance",
};

const STATUS_COLORS: Record<string, string> = {
  pending_payment: "bg-yellow-400",
  waiting_confirmation: "bg-orange-400",
  paid: "bg-blue-500",
  confirmed: "bg-green-500",
  completed: "bg-gray-500",
  cancelled: "bg-red-500",
  rejected: "bg-red-700",
  expired: "bg-gray-400",
  blocked: "bg-red-600",
  maintenance: "bg-purple-500",
};

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  // Pad start
  for (let i = 0; i < first.getDay(); i++) days.push(new Date(year, month, -i + 0 - first.getDay() + 1));
  for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, month, d));
  return days;
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function getWeekDates(anchor: Date): Date[] {
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

export default function AdminCalendar() {
  const [view, setView] = useState<"month" | "week" | "day">("month");
  const [anchor, setAnchor] = useState(new Date());
  const [facilityId, setFacilityId] = useState<string>("all");
  const [selectedEvent, setSelectedEvent] = useState<any>(null);

  const startDate = useMemo(() => {
    if (view === "month") return formatDate(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    if (view === "week") return formatDate(getWeekDates(anchor)[0]);
    return formatDate(anchor);
  }, [view, anchor]);

  const endDate = useMemo(() => {
    if (view === "month") return formatDate(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0));
    if (view === "week") return formatDate(getWeekDates(anchor)[6]);
    return formatDate(anchor);
  }, [view, anchor]);

  const { data } = useQuery({
    queryKey: ["calendar", startDate, endDate, facilityId],
    queryFn: () => apiFetch(`/admin/calendar?startDate=${startDate}&endDate=${endDate}${facilityId !== "all" ? `&facilityId=${facilityId}` : ""}`),
    staleTime: 30000,
  });

  const events: any[] = data?.events ?? [];
  const facilities: any[] = data?.facilities ?? [];

  function navigate(dir: number) {
    const d = new Date(anchor);
    if (view === "month") d.setMonth(d.getMonth() + dir);
    else if (view === "week") d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setAnchor(d);
  }

  function eventsOnDate(date: string) {
    return events.filter((e) => e.date === date || e.start?.startsWith(date));
  }

  const title = useMemo(() => {
    if (view === "month") return anchor.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
    if (view === "week") {
      const week = getWeekDates(anchor);
      return `${week[0].toLocaleDateString("id-ID", { day: "numeric", month: "short" })} – ${week[6].toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}`;
    }
    return anchor.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }, [view, anchor]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black">Kalender Jadwal</h1>
          <p className="text-muted-foreground mt-1">Tampilan visual semua booking dan jadwal</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={facilityId} onValueChange={setFacilityId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Semua Fasilitas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Fasilitas</SelectItem>
              {facilities.map((f: any) => (
                <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex border rounded-md overflow-hidden">
            {(["month", "week", "day"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${view === v ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                {v === "month" ? "Bulan" : v === "week" ? "Minggu" : "Hari"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(STATUS_LABELS).slice(0, 7).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5 text-xs">
            <div className={`w-3 h-3 rounded-sm ${STATUS_COLORS[key]}`} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <Button variant="outline" size="icon" onClick={() => navigate(-1)}><ChevronLeft size={16} /></Button>
            <CardTitle className="text-lg font-bold">{title}</CardTitle>
            <Button variant="outline" size="icon" onClick={() => navigate(1)}><ChevronRight size={16} /></Button>
          </div>
        </CardHeader>
        <CardContent>
          {view === "month" && (
            <MonthView anchor={anchor} events={events} onEventClick={setSelectedEvent} />
          )}
          {view === "week" && (
            <WeekView anchor={anchor} events={events} onEventClick={setSelectedEvent} />
          )}
          {view === "day" && (
            <DayView date={formatDate(anchor)} events={eventsOnDate(formatDate(anchor))} onEventClick={setSelectedEvent} />
          )}
        </CardContent>
      </Card>

      {/* Event detail modal */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelectedEvent(null)}>
          <div className="bg-background rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <Badge className={`${STATUS_COLORS[selectedEvent.status]} text-white mb-2`}>
                  {STATUS_LABELS[selectedEvent.status] ?? selectedEvent.status}
                </Badge>
                <h2 className="text-xl font-bold">{selectedEvent.facilityName}</h2>
              </div>
              <button onClick={() => setSelectedEvent(null)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="space-y-2 text-sm">
              {selectedEvent.customerName && <div><span className="font-medium">Customer:</span> {selectedEvent.customerName}</div>}
              {selectedEvent.customerPhone && <div><span className="font-medium">Telepon:</span> {selectedEvent.customerPhone}</div>}
              {selectedEvent.orderNumber && <div><span className="font-medium">Order:</span> {selectedEvent.orderNumber}</div>}
              <div><span className="font-medium">Tanggal:</span> {selectedEvent.date}</div>
              <div><span className="font-medium">Waktu:</span> {selectedEvent.start?.split("T")[1]?.slice(0,5)} – {selectedEvent.end?.split("T")[1]?.slice(0,5)}</div>
              {selectedEvent.totalPrice && <div><span className="font-medium">Total:</span> Rp {selectedEvent.totalPrice.toLocaleString("id-ID")}</div>}
              {selectedEvent.reason && <div><span className="font-medium">Alasan:</span> {selectedEvent.reason}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MonthView({ anchor, events, onEventClick }: { anchor: Date; events: any[]; onEventClick: (e: any) => void }) {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const days = getDaysInMonth(year, month);
  const dayNames = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

  return (
    <div>
      <div className="grid grid-cols-7 border-b mb-1">
        {dayNames.map((d) => <div key={d} className="text-center text-xs font-semibold py-2 text-muted-foreground">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const dateStr = formatDate(day);
          const dayEvents = events.filter((e) => e.date === dateStr || e.start?.startsWith(dateStr));
          const isCurrentMonth = day.getMonth() === month;
          const isToday = dateStr === formatDate(new Date());
          return (
            <div key={i} className={`min-h-[80px] border-b border-r p-1 ${!isCurrentMonth ? "bg-muted/30" : ""}`}>
              <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-primary text-primary-foreground" : isCurrentMonth ? "" : "text-muted-foreground"}`}>
                {day.getDate()}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((e) => (
                  <div
                    key={e.id}
                    onClick={() => onEventClick(e)}
                    className={`text-xs px-1 py-0.5 rounded cursor-pointer text-white truncate ${STATUS_COLORS[e.status] ?? "bg-gray-400"}`}
                    title={e.title}
                  >
                    {e.start?.split("T")[1]?.slice(0,5)} {e.facilityName}
                  </div>
                ))}
                {dayEvents.length > 3 && <div className="text-xs text-muted-foreground pl-1">+{dayEvents.length - 3} lagi</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ anchor, events, onEventClick }: { anchor: Date; events: any[]; onEventClick: (e: any) => void }) {
  const weekDays = getWeekDates(anchor);
  const hours = Array.from({ length: 18 }, (_, i) => i + 6);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[700px]">
        <div className="grid grid-cols-8 border-b">
          <div className="text-xs text-muted-foreground p-2">Jam</div>
          {weekDays.map((d) => (
            <div key={d.toISOString()} className="text-center text-xs font-medium p-2 border-l">
              <div>{["Min","Sen","Sel","Rab","Kam","Jum","Sab"][d.getDay()]}</div>
              <div className={`w-6 h-6 mx-auto flex items-center justify-center rounded-full text-xs ${formatDate(d) === formatDate(new Date()) ? "bg-primary text-primary-foreground" : ""}`}>{d.getDate()}</div>
            </div>
          ))}
        </div>
        {hours.map((hour) => (
          <div key={hour} className="grid grid-cols-8 border-b min-h-[48px]">
            <div className="text-xs text-muted-foreground p-1 border-r">{String(hour).padStart(2,"0")}:00</div>
            {weekDays.map((d) => {
              const dateStr = formatDate(d);
              const slotEvents = events.filter((e) => {
                const eStart = e.start?.split("T")[1]?.slice(0,2);
                return e.date === dateStr && parseInt(eStart ?? "0") === hour;
              });
              return (
                <div key={dateStr} className="border-l p-0.5 space-y-0.5">
                  {slotEvents.map((e) => (
                    <div key={e.id} onClick={() => onEventClick(e)}
                      className={`text-xs px-1 py-0.5 rounded cursor-pointer text-white truncate ${STATUS_COLORS[e.status] ?? "bg-gray-400"}`}>
                      {e.start?.split("T")[1]?.slice(0,5)} {e.facilityName?.slice(0,8)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function DayView({ date, events, onEventClick }: { date: string; events: any[]; onEventClick: (e: any) => void }) {
  const hours = Array.from({ length: 18 }, (_, i) => i + 6);
  return (
    <div className="space-y-1">
      {hours.map((hour) => {
        const slotEvents = events.filter((e) => {
          const eStart = e.start?.split("T")[1]?.slice(0,2);
          return parseInt(eStart ?? "0") === hour;
        });
        return (
          <div key={hour} className="flex gap-2 min-h-[48px] border-b pb-1">
            <div className="w-16 text-xs text-muted-foreground pt-1 flex-shrink-0">{String(hour).padStart(2,"0")}:00</div>
            <div className="flex-1 space-y-1">
              {slotEvents.map((e) => (
                <div key={e.id} onClick={() => onEventClick(e)}
                  className={`text-sm px-3 py-2 rounded cursor-pointer text-white ${STATUS_COLORS[e.status] ?? "bg-gray-400"}`}>
                  <div className="font-medium">{e.facilityName} — {e.customerName}</div>
                  <div className="text-xs opacity-90">{e.start?.split("T")[1]?.slice(0,5)} – {e.end?.split("T")[1]?.slice(0,5)} • {e.orderNumber}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
