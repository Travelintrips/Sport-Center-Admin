import { useState } from "react";
import { useListFacilities, useCheckAvailability, useListBlockedSchedules, useCreateBlockedSchedule, useDeleteBlockedSchedule, getListBlockedSchedulesQueryKey, getCheckAvailabilityQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Lock, Trash2, Plus } from "lucide-react";

export default function AdminSchedule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const today = new Date().toISOString().split("T")[0];
  const [selectedFacility, setSelectedFacility] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState(today);
  const [blockDialog, setBlockDialog] = useState(false);
  const [blockForm, setBlockForm] = useState({ startTime: "08:00", endTime: "10:00", reason: "Maintenance" });

  const { data: facilities } = useListFacilities({ activeOnly: true });

  const facilityId = selectedFacility ? Number(selectedFacility) : undefined;

  const { data: slots, isLoading: slotsLoading } = useCheckAvailability(
    { facilityId: facilityId ?? 0, date: selectedDate },
    { query: { enabled: !!facilityId && !!selectedDate, queryKey: getCheckAvailabilityQueryKey({ facilityId: facilityId ?? 0, date: selectedDate }) } }
  );

  const { data: blocked } = useListBlockedSchedules(
    { facilityId: facilityId, date: selectedDate },
    { query: { enabled: !!facilityId, queryKey: getListBlockedSchedulesQueryKey({ facilityId, date: selectedDate }) } }
  );

  const createMutation = useCreateBlockedSchedule({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBlockedSchedulesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getCheckAvailabilityQueryKey() });
        toast({ title: "Schedule blocked" });
        setBlockDialog(false);
      },
      onError: () => toast({ title: "Error blocking schedule", variant: "destructive" }),
    }
  });

  const deleteMutation = useDeleteBlockedSchedule({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBlockedSchedulesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getCheckAvailabilityQueryKey() });
        toast({ title: "Block removed" });
      },
      onError: () => toast({ title: "Error removing block", variant: "destructive" }),
    }
  });

  const handleBlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!facilityId) return;
    createMutation.mutate({ data: { facilityId, date: selectedDate, startTime: blockForm.startTime, endTime: blockForm.endTime, reason: blockForm.reason } });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black">Schedule Management</h1>
        <p className="text-muted-foreground">View availability and block time slots</p>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="grid md:grid-cols-3 gap-4 mb-6">
            <div className="space-y-2">
              <Label>Facility</Label>
              <Select value={selectedFacility} onValueChange={setSelectedFacility}>
                <SelectTrigger>
                  <SelectValue placeholder="Select facility..." />
                </SelectTrigger>
                <SelectContent>
                  {facilities?.map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>&nbsp;</Label>
              <Button className="w-full" disabled={!facilityId} onClick={() => setBlockDialog(true)}>
                <Lock size={15} className="mr-2" /> Block Slot
              </Button>
            </div>
          </div>

          {!facilityId ? (
            <div className="text-center py-10 text-muted-foreground">Select a facility to view its schedule</div>
          ) : slotsLoading ? (
            <div className="grid grid-cols-4 gap-2">{[...Array(16)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
              {slots?.map((slot) => (
                <div
                  key={slot.time}
                  className={`p-2 rounded-lg border text-center text-sm font-medium transition-colors ${
                    slot.available
                      ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-950/20 dark:border-green-900 dark:text-green-400"
                      : "bg-red-50 border-red-200 text-red-700 dark:bg-red-950/20 dark:border-red-900 dark:text-red-400"
                  }`}
                >
                  <div>{slot.time}</div>
                  {!slot.available && <div className="text-xs opacity-70 truncate">{slot.reason}</div>}
                </div>
              ))}
              {!slots?.length && <div className="col-span-8 text-center py-6 text-muted-foreground">No time slots for this date</div>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Blocked schedules */}
      {facilityId && blocked && blocked.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold">Blocked Time Slots for {selectedDate}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {blocked.map((b) => (
                <div key={b.id} className="flex items-center justify-between p-3 bg-muted/40 rounded-md">
                  <div className="text-sm">
                    <span className="font-medium">{b.startTime} – {b.endTime}</span>
                    <span className="text-muted-foreground ml-3">{b.reason}</span>
                  </div>
                  <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => deleteMutation.mutate({ id: b.id })}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Block dialog */}
      <Dialog open={blockDialog} onOpenChange={setBlockDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Block Time Slot</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleBlock} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Time</Label>
                <Input type="time" required value={blockForm.startTime} onChange={(e) => setBlockForm(f => ({ ...f, startTime: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>End Time</Label>
                <Input type="time" required value={blockForm.endTime} onChange={(e) => setBlockForm(f => ({ ...f, endTime: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Input required value={blockForm.reason} onChange={(e) => setBlockForm(f => ({ ...f, reason: e.target.value }))} placeholder="Maintenance, Closed, Event..." />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setBlockDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? "Blocking..." : "Block"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
