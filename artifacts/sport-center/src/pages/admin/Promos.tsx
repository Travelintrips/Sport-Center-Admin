import { useState } from "react";
import { useListPromos, useCreatePromo, useUpdatePromo, useDeletePromo, getListPromosQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2 } from "lucide-react";

const emptyForm = { title: "", description: "", type: "promo" as "promo" | "event", discountPercent: "", startDate: "", endDate: "", imageUrl: "", isActive: true };

export default function AdminPromos() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editPromo, setEditPromo] = useState<any>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: promos, isLoading } = useListPromos();

  const createMutation = useCreatePromo({
    mutation: {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListPromosQueryKey() }); toast({ title: "Promo created" }); setDialogOpen(false); },
      onError: () => toast({ title: "Error creating promo", variant: "destructive" }),
    }
  });

  const updateMutation = useUpdatePromo({
    mutation: {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListPromosQueryKey() }); toast({ title: "Promo updated" }); setDialogOpen(false); },
      onError: () => toast({ title: "Error updating promo", variant: "destructive" }),
    }
  });

  const deleteMutation = useDeletePromo({
    mutation: {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListPromosQueryKey() }); toast({ title: "Promo deleted" }); setDeleteId(null); },
      onError: () => toast({ title: "Error deleting promo", variant: "destructive" }),
    }
  });

  const handleToggleActive = (p: any) => {
    updateMutation.mutate({ id: p.id, data: { isActive: !p.isActive } });
  };

  const openCreate = () => {
    setEditPromo(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (p: any) => {
    setEditPromo(p);
    setForm({
      title: p.title, description: p.description ?? "", type: p.type,
      discountPercent: p.discountPercent ? String(p.discountPercent) : "",
      startDate: p.startDate ?? "", endDate: p.endDate ?? "",
      imageUrl: p.imageUrl ?? "", isActive: p.isActive,
    });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = {
      title: form.title, description: form.description, type: form.type,
      startDate: form.startDate || undefined, endDate: form.endDate || undefined,
      imageUrl: form.imageUrl || undefined, isActive: form.isActive,
    };
    if (form.discountPercent) payload.discountPercent = Number(form.discountPercent);
    if (editPromo) {
      updateMutation.mutate({ id: editPromo.id, data: payload });
    } else {
      createMutation.mutate({ data: payload });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black">Promos & Events</h1>
          <p className="text-muted-foreground">Manage promotions and events</p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} className="mr-2" /> Add Promo
        </Button>
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 gap-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {promos?.map((p) => (
            <Card key={p.id} className={!p.isActive ? "opacity-60" : ""}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold">{p.title}</h3>
                      <Badge variant={p.type === "event" ? "default" : "secondary"}>{p.type}</Badge>
                    </div>
                    {p.discountPercent && (
                      <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 border-0">
                        {p.discountPercent}% OFF
                      </Badge>
                    )}
                  </div>
                  <Switch checked={p.isActive} onCheckedChange={() => handleToggleActive(p)} />
                </div>
                {p.description && <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{p.description}</p>}
                {(p.startDate || p.endDate) && (
                  <div className="text-xs text-muted-foreground mb-3">
                    {p.startDate && `From: ${p.startDate}`}{p.startDate && p.endDate && " · "}{p.endDate && `To: ${p.endDate}`}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(p)}><Pencil size={13} className="mr-1" /> Edit</Button>
                  <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setDeleteId(p.id)}><Trash2 size={13} className="mr-1" /> Delete</Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {!promos?.length && (
            <div className="col-span-2 py-12 text-center text-muted-foreground">No promos yet. Click "Add Promo" to get started.</div>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editPromo ? "Edit Promo" : "Add Promo"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input required value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Promo Weekend 20% Off" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm(f => ({ ...f, type: v as "promo" | "event" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="promo">Promo</SelectItem>
                    <SelectItem value="event">Event</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Discount %</Label>
                <Input type="number" min={0} max={100} value={form.discountPercent} onChange={(e) => setForm(f => ({ ...f, discountPercent: e.target.value }))} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" value={form.endDate} onChange={(e) => setForm(f => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="Optional..." />
            </div>
            <div className="space-y-2">
              <Label>Image URL</Label>
              <Input value={form.imageUrl} onChange={(e) => setForm(f => ({ ...f, imageUrl: e.target.value }))} placeholder="https://..." />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm(f => ({ ...f, isActive: v }))} />
              <Label>Active</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isPending}>{isPending ? "Saving..." : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Promo?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => deleteId && deleteMutation.mutate({ id: deleteId })}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
