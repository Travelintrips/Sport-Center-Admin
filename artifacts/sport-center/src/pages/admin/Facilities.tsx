import { useState } from "react";
import { useListFacilities, useCreateFacility, useUpdateFacility, useDeleteFacility, getListFacilitiesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2 } from "lucide-react";

const CATEGORIES = ["Futsal", "Basketball", "Volley", "Tennis", "Badminton", "Gym", "Billiard", "Other"];

const emptyForm = { name: "", category: "Futsal", description: "", pricePerHour: "", openTime: "06:00", closeTime: "22:00", minDuration: 1, capacity: "", imageUrls: "" };

function formatCurrency(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

export default function AdminFacilities() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editFacility, setEditFacility] = useState<any>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: facilities, isLoading } = useListFacilities();

  const createMutation = useCreateFacility({
    mutation: {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListFacilitiesQueryKey() }); toast({ title: "Facility created" }); setDialogOpen(false); },
      onError: () => toast({ title: "Error creating facility", variant: "destructive" }),
    }
  });

  const updateMutation = useUpdateFacility({
    mutation: {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListFacilitiesQueryKey() }); toast({ title: "Facility updated" }); setDialogOpen(false); },
      onError: () => toast({ title: "Error updating facility", variant: "destructive" }),
    }
  });

  const deleteMutation = useDeleteFacility({
    mutation: {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListFacilitiesQueryKey() }); toast({ title: "Facility deleted" }); setDeleteId(null); },
      onError: () => toast({ title: "Error deleting facility", variant: "destructive" }),
    }
  });

  const handleToggleActive = (f: any) => {
    updateMutation.mutate({ id: f.id, data: { isActive: !f.isActive } });
  };

  const openCreate = () => {
    setEditFacility(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (f: any) => {
    setEditFacility(f);
    setForm({
      name: f.name, category: f.category, description: f.description ?? "",
      pricePerHour: String(f.pricePerHour), openTime: f.openTime, closeTime: f.closeTime,
      minDuration: f.minDuration, capacity: f.capacity ? String(f.capacity) : "",
      imageUrls: f.images?.map((img: any) => img.url).join("\n") ?? "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = {
      name: form.name, category: form.category, description: form.description,
      pricePerHour: Number(form.pricePerHour), openTime: form.openTime, closeTime: form.closeTime,
      minDuration: Number(form.minDuration), isActive: true,
      imageUrls: form.imageUrls.split("\n").map(u => u.trim()).filter(Boolean),
    };
    if (form.capacity) payload.capacity = Number(form.capacity);
    if (editFacility) {
      updateMutation.mutate({ id: editFacility.id, data: payload });
    } else {
      createMutation.mutate({ data: payload });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black">Facilities</h1>
          <p className="text-muted-foreground">Manage sport facilities and courts</p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} className="mr-2" /> Add Facility
        </Button>
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 gap-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {facilities?.map((f) => (
            <Card key={f.id} className={!f.isActive ? "opacity-60" : ""}>
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  {f.images?.[0] && (
                    <img src={f.images[0].url} alt={f.name} className="w-20 h-20 rounded-lg object-cover shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div>
                        <h3 className="font-bold truncate">{f.name}</h3>
                        <Badge variant="secondary" className="text-xs mt-0.5">{f.category}</Badge>
                      </div>
                      <Switch checked={f.isActive} onCheckedChange={() => handleToggleActive(f)} />
                    </div>
                    <div className="text-sm font-semibold text-primary">{formatCurrency(f.pricePerHour)} / hour</div>
                    <div className="text-xs text-muted-foreground">{f.openTime} – {f.closeTime} · min {f.minDuration}h{f.capacity ? ` · max ${f.capacity} people` : ""}</div>
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" variant="outline" onClick={() => openEdit(f)}>
                        <Pencil size={13} className="mr-1" /> Edit
                      </Button>
                      <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setDeleteId(f.id)}>
                        <Trash2 size={13} className="mr-1" /> Delete
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {!facilities?.length && (
            <div className="col-span-2 py-12 text-center text-muted-foreground">No facilities yet. Click "Add Facility" to get started.</div>
          )}
        </div>
      )}

      {/* Create/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editFacility ? "Edit Facility" : "Add Facility"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-2">
                <Label>Name *</Label>
                <Input required value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Lapangan Futsal A" />
              </div>
              <div className="space-y-2">
                <Label>Category *</Label>
                <select className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Price/hour (IDR) *</Label>
                <Input required type="number" value={form.pricePerHour} onChange={(e) => setForm(f => ({ ...f, pricePerHour: e.target.value }))} placeholder="150000" />
              </div>
              <div className="space-y-2">
                <Label>Open Time</Label>
                <Input type="time" value={form.openTime} onChange={(e) => setForm(f => ({ ...f, openTime: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Close Time</Label>
                <Input type="time" value={form.closeTime} onChange={(e) => setForm(f => ({ ...f, closeTime: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Min Duration (hours)</Label>
                <Input type="number" min={1} value={form.minDuration} onChange={(e) => setForm(f => ({ ...f, minDuration: Number(e.target.value) }))} />
              </div>
              <div className="space-y-2">
                <Label>Capacity (persons)</Label>
                <Input type="number" value={form.capacity} onChange={(e) => setForm(f => ({ ...f, capacity: e.target.value }))} placeholder="Optional" />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="Optional description..." />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Image URLs (one per line)</Label>
                <Textarea value={form.imageUrls} onChange={(e) => setForm(f => ({ ...f, imageUrls: e.target.value }))} rows={3} placeholder="https://example.com/image1.jpg&#10;https://example.com/image2.jpg" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isPending}>{isPending ? "Saving..." : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Facility?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone. All related bookings may be affected.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteId && deleteMutation.mutate({ id: deleteId })}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
