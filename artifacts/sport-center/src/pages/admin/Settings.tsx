import { useState, useEffect } from "react";
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Save } from "lucide-react";

export default function AdminSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: settings, isLoading } = useGetSettings();

  const [form, setForm] = useState({
    centerName: "", address: "", phone: "", whatsapp: "", email: "",
    openHour: "", closeHour: "", logoUrl: "", bankName: "", bankAccount: "", bankAccountName: "",
  });

  useEffect(() => {
    if (settings) {
      setForm({
        centerName: settings.centerName ?? "",
        address: settings.address ?? "",
        phone: settings.phone ?? "",
        whatsapp: settings.whatsapp ?? "",
        email: settings.email ?? "",
        openHour: settings.openHour ?? "",
        closeHour: settings.closeHour ?? "",
        logoUrl: settings.logoUrl ?? "",
        bankName: settings.bankName ?? "",
        bankAccount: settings.bankAccount ?? "",
        bankAccountName: settings.bankAccountName ?? "",
      });
    }
  }, [settings]);

  const updateMutation = useUpdateSettings({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        toast({ title: "Settings saved" });
      },
      onError: () => toast({ title: "Error saving settings", variant: "destructive" }),
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = { ...form };
    Object.keys(payload).forEach(k => { if (!payload[k]) delete payload[k]; });
    updateMutation.mutate({ data: payload });
  };

  if (isLoading) return <div className="space-y-6"><Skeleton className="h-96" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black">Settings</h1>
        <p className="text-muted-foreground">Configure your sport center information</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold">Center Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Center Name</Label>
                <Input value={form.centerName} onChange={(e) => setForm(f => ({ ...f, centerName: e.target.value }))} placeholder="Sport Center" />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} placeholder="info@sportcenter.com" />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+62 21 1234567" />
              </div>
              <div className="space-y-2">
                <Label>WhatsApp Number (with country code, no +)</Label>
                <Input value={form.whatsapp} onChange={(e) => setForm(f => ({ ...f, whatsapp: e.target.value }))} placeholder="6281234567890" />
              </div>
              <div className="md:col-span-2 space-y-2">
                <Label>Address</Label>
                <Input value={form.address} onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Full address..." />
              </div>
              <div className="space-y-2">
                <Label>Opening Hour</Label>
                <Input type="time" value={form.openHour} onChange={(e) => setForm(f => ({ ...f, openHour: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Closing Hour</Label>
                <Input type="time" value={form.closeHour} onChange={(e) => setForm(f => ({ ...f, closeHour: e.target.value }))} />
              </div>
              <div className="md:col-span-2 space-y-2">
                <Label>Logo URL</Label>
                <Input value={form.logoUrl} onChange={(e) => setForm(f => ({ ...f, logoUrl: e.target.value }))} placeholder="https://..." />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold">Bank Information (for manual transfer)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Bank Name</Label>
                <Input value={form.bankName} onChange={(e) => setForm(f => ({ ...f, bankName: e.target.value }))} placeholder="BCA, BNI, Mandiri..." />
              </div>
              <div className="space-y-2">
                <Label>Account Number</Label>
                <Input value={form.bankAccount} onChange={(e) => setForm(f => ({ ...f, bankAccount: e.target.value }))} placeholder="1234567890" />
              </div>
              <div className="space-y-2">
                <Label>Account Name</Label>
                <Input value={form.bankAccountName} onChange={(e) => setForm(f => ({ ...f, bankAccountName: e.target.value }))} placeholder="PT Sport Center" />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={updateMutation.isPending} className="px-8">
            <Save size={16} className="mr-2" />
            {updateMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </form>
    </div>
  );
}
