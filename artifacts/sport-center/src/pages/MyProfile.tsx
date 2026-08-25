import { useState, useEffect, useCallback } from "react";
import { useGetMe, useUpdateProfile, useLinkGoogle, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/lib/i18n";
import { User, Phone, Lock, Eye, EyeOff, CheckCircle2, Link2, Mail, ShieldCheck, Building2, Plus, ExternalLink } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { useLocation } from "wouter";
import { getToken } from "@/lib/auth";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;


export default function MyProfile() {
  const { t } = useLang();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: user, isLoading, isError } = useGetMe({ query: { retry: false, staleTime: 0, queryKey: getGetMeQueryKey() } });

  const [nameForm, setNameForm] = useState({ name: "", phone: "" });
  const [pwForm, setPwForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [showPw, setShowPw] = useState(false);
  const [linkingGoogle, setLinkingGoogle] = useState(false);

  useEffect(() => {
    if (user) {
      setNameForm({
        name: user.name ?? "",
        phone: user.phone
          ? user.phone.startsWith("62") ? "0" + user.phone.slice(2) : user.phone
          : "",
      });
    }
  }, [user]);

  useEffect(() => {
    if (isError) setLocation("/login");
  }, [isError]);

  const updateMutation = useUpdateProfile({
    mutation: {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetMeQueryKey(), updated);
        toast({ title: t("Profil diperbarui!", "Profile updated!") });
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error ?? t("Gagal memperbarui profil.", "Failed to update profile.");
        toast({ title: t("Gagal", "Failed"), description: msg, variant: "destructive" });
      },
    },
  });

  const linkGoogleMutation = useLinkGoogle({
    mutation: {
      onSuccess: (updated) => {
        setLinkingGoogle(false);
        queryClient.setQueryData(getGetMeQueryKey(), updated);
        toast({ title: t("Google terhubung!", "Google linked!"), description: t("Akun Google Anda berhasil dihubungkan.", "Your Google account has been linked.") });
      },
      onError: (err: any) => {
        setLinkingGoogle(false);
        const msg = err?.response?.data?.error ?? t("Gagal menghubungkan Google.", "Failed to link Google.");
        toast({ title: t("Gagal", "Failed"), description: msg, variant: "destructive" });
      },
    },
  });

  const handleGoogleLinkCallback = useCallback((response: { credential: string }) => {
    linkGoogleMutation.mutate({ data: { idToken: response.credential } });
  }, []);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      (window as any).google?.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleLinkCallback,
        auto_select: false,
      });
    };
    document.head.appendChild(script);
    return () => { document.head.removeChild(script); };
  }, [handleGoogleLinkCallback]);

  function handleInfoSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nameForm.name.trim()) return;
    updateMutation.mutate({ data: { name: nameForm.name, phone: nameForm.phone || undefined } });
  }

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      toast({ title: t("Password tidak cocok", "Passwords do not match"), variant: "destructive" }); return;
    }
    if (pwForm.newPassword.length < 6) {
      toast({ title: t("Password minimal 6 karakter", "Password must be at least 6 characters"), variant: "destructive" }); return;
    }
    updateMutation.mutate({ data: { currentPassword: pwForm.currentPassword || undefined, newPassword: pwForm.newPassword } });
    setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
  }

  function handleLinkGoogle() {
    if (!GOOGLE_CLIENT_ID) {
      toast({ title: t("Google login belum dikonfigurasi", "Google login not configured"), variant: "destructive" }); return;
    }
    setLinkingGoogle(true);
    (window as any).google?.accounts.id.prompt();
  }

  // ── Company verification ───────────────────────────────────────────────────
  const [showVerifDialog, setShowVerifDialog] = useState(false);
  const [verifForm, setVerifForm] = useState({ companyId: "", employeeId: "", officeEmail: "", idCardUrl: "" });
  const [idCardFile, setIdCardFile] = useState<File | null>(null);
  const [idCardUploading, setIdCardUploading] = useState(false);

  const { data: myVerifications, isLoading: isLoadingVerif, refetch: refetchVerif } = useQuery({
    queryKey: ["my-verifications"],
    queryFn: async () => {
      const token = getToken();
      const res = await fetch("/api/company-verifications/my", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{
        id: number; companyId: number; companyName: string; employeeId: string;
        officeEmail: string | null; status: string; requestedAt: string;
        rejectionReason: string | null; corporateBillingEnabled: boolean;
      }[]>;
    },
    enabled: !!user && !isLoading,
  });

  const { data: companyList } = useQuery({
    queryKey: ["company-list"],
    queryFn: async () => {
      const res = await fetch("/api/companies");
      if (!res.ok) return [];
      return res.json() as Promise<{ id: number; name: string; companyName: string | null }[]>;
    },
    enabled: showVerifDialog,
  });

  async function uploadIdCardFile(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/storage/upload-proof", { method: "POST", body: formData });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Upload gagal"); }
    const { url } = await res.json();
    return url;
  }

  const submitVerifMutation = useMutation({
    mutationFn: async () => {
      const token = getToken();
      let finalIdCardUrl = verifForm.idCardUrl.trim() || undefined;
      if (idCardFile) {
        setIdCardUploading(true);
        try {
          finalIdCardUrl = await uploadIdCardFile(idCardFile);
        } finally {
          setIdCardUploading(false);
        }
      }
      const res = await fetch("/api/company-verifications", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          companyId: parseInt(verifForm.companyId),
          employeeId: verifForm.employeeId.trim(),
          officeEmail: verifForm.officeEmail.trim() || undefined,
          idCardUrl: finalIdCardUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mengirim permintaan");
      return data;
    },
    onSuccess: () => {
      toast({ title: "Permintaan terkirim!", description: "Menunggu konfirmasi dari perusahaan." });
      setShowVerifDialog(false);
      setVerifForm({ companyId: "", employeeId: "", officeEmail: "", idCardUrl: "" });
      setIdCardFile(null);
      refetchVerif();
    },
    onError: (err: any) => {
      toast({ title: "Gagal", description: err.message, variant: "destructive" });
    },
  });

  const statusConfig: Record<string, { label: string; color: string }> = {
    pending: { label: "Menunggu", color: "text-amber-600 bg-amber-50 border-amber-200" },
    approved: { label: "Disetujui ✅", color: "text-green-600 bg-green-50 border-green-200" },
    rejected: { label: "Ditolak ❌", color: "text-red-600 bg-red-50 border-red-200" },
    revoked: { label: "Dicabut", color: "text-gray-500 bg-gray-50 border-gray-200" },
  };

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  const displayPhone = user.phone
    ? user.phone.startsWith("62") ? "0" + user.phone.slice(2) : user.phone
    : "";

  return (
    <div className="container mx-auto px-4 py-10 max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary font-black text-2xl shadow-inner">
          {user.name?.charAt(0).toUpperCase() ?? "?"}
        </div>
        <div>
          <h1 className="text-2xl font-black">{user.name}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="secondary" className="text-xs font-semibold capitalize">
              <ShieldCheck size={11} className="mr-1" />
              {user.role}
            </Badge>
            {user.googleId && (
              <Badge variant="secondary" className="text-xs font-semibold bg-blue-50 text-blue-700 border-blue-200">
                <FcGoogle size={12} className="mr-1" /> Google
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Info card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <User size={16} className="text-primary" />
            {t("Informasi Akun", "Account Information")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInfoSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">{t("Nama Lengkap", "Full Name")}</Label>
              <Input
                id="name"
                value={nameForm.name}
                onChange={(e) => setNameForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t("Nama lengkap Anda", "Your full name")}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Input id="email" value={user.email ?? t("(Tidak ada email)", "(No email)")} disabled className="pr-10 bg-muted/40 text-muted-foreground" />
                {user.email && <Mail size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />}
              </div>
              {!user.email && (
                <p className="text-xs text-muted-foreground">{t("Akun ini login via nomor HP atau Google", "This account uses phone or Google login")}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">
                {t("No. WhatsApp", "WhatsApp No.")}
                <span className="text-muted-foreground font-normal ml-1 text-xs">{t("(opsional)", "(optional)")}</span>
              </Label>
              <div className="relative">
                <Input
                  id="phone"
                  type="tel"
                  placeholder="08xxxxxxxxxx"
                  value={nameForm.phone}
                  onChange={(e) => setNameForm((f) => ({ ...f, phone: e.target.value }))}
                />
                <Phone size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>

            <Button type="submit" disabled={updateMutation.isPending} className="w-full">
              {updateMutation.isPending ? t("Menyimpan...", "Saving...") : t("Simpan Perubahan", "Save Changes")}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Password card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Lock size={16} className="text-primary" />
            {user.hasPassword ? t("Ubah Password", "Change Password") : t("Buat Password", "Create Password")}
          </CardTitle>
          {!user.hasPassword && (
            <CardDescription>{t("Akun Anda belum memiliki password. Tambahkan untuk bisa login via email.", "Your account has no password yet. Add one to enable email login.")}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            {user.hasPassword && (
              <div className="space-y-1.5">
                <Label htmlFor="current-pw">{t("Password Saat Ini", "Current Password")}</Label>
                <div className="relative">
                  <Input
                    id="current-pw"
                    type={showPw ? "text" : "password"}
                    value={pwForm.currentPassword}
                    onChange={(e) => setPwForm((f) => ({ ...f, currentPassword: e.target.value }))}
                    required
                    className="pr-10"
                    placeholder="••••••••"
                  />
                  <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="new-pw">{t("Password Baru", "New Password")}</Label>
              <Input
                id="new-pw"
                type={showPw ? "text" : "password"}
                value={pwForm.newPassword}
                onChange={(e) => setPwForm((f) => ({ ...f, newPassword: e.target.value }))}
                required
                minLength={6}
                placeholder={t("Min. 6 karakter", "Min. 6 characters")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-pw">{t("Konfirmasi Password Baru", "Confirm New Password")}</Label>
              <Input
                id="confirm-pw"
                type={showPw ? "text" : "password"}
                value={pwForm.confirmPassword}
                onChange={(e) => setPwForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                required
                placeholder={t("Ulangi password baru", "Repeat new password")}
              />
            </div>
            <Button type="submit" variant="outline" disabled={updateMutation.isPending} className="w-full">
              {updateMutation.isPending ? t("Menyimpan...", "Saving...") : user.hasPassword ? t("Ubah Password", "Change Password") : t("Buat Password", "Create Password")}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Company connection card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Building2 size={16} className="text-primary" />
              Hubungkan ke Perusahaan
            </CardTitle>
            <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" onClick={() => setShowVerifDialog(true)}>
              <Plus size={13} /> Ajukan Verifikasi
            </Button>
          </div>
          <CardDescription>Verifikasi karyawan untuk gunakan tagihan perusahaan saat booking</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingVerif ? (
            <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : !myVerifications?.length ? (
            <div className="text-center py-6 text-muted-foreground text-sm border-2 border-dashed rounded-xl">
              <Building2 size={28} className="mx-auto mb-2 opacity-30" />
              <p>Belum terhubung ke perusahaan manapun</p>
              <p className="text-xs mt-1">Ajukan verifikasi untuk gunakan tagihan perusahaan</p>
            </div>
          ) : (
            <div className="space-y-3">
              {myVerifications.map((v) => {
                const cfg = statusConfig[v.status] ?? statusConfig.pending;
                return (
                  <div key={v.id} className="flex items-start justify-between p-3.5 rounded-xl border bg-muted/20 gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <Building2 size={16} className="text-primary mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate">{v.companyName}</div>
                        <div className="text-xs text-muted-foreground">ID: <span className="font-mono">{v.employeeId}</span></div>
                        {v.officeEmail && <div className="text-xs text-muted-foreground">{v.officeEmail}</div>}
                        {v.rejectionReason && (
                          <div className="text-xs text-red-600 mt-1">Alasan: {v.rejectionReason}</div>
                        )}
                        {v.corporateBillingEnabled && (
                          <div className="text-xs text-green-600 font-medium mt-1">✅ Tagihan perusahaan aktif</div>
                        )}
                      </div>
                    </div>
                    <Badge variant="secondary" className={`${cfg.color} text-xs shrink-0`}>{cfg.label}</Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Company verification dialog */}
      <Dialog open={showVerifDialog} onOpenChange={setShowVerifDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Ajukan Verifikasi Karyawan</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Pilih Perusahaan</Label>
              <Select value={verifForm.companyId} onValueChange={(v) => setVerifForm((f) => ({ ...f, companyId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih perusahaan..." />
                </SelectTrigger>
                <SelectContent>
                  {(companyList ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.companyName ?? c.name}
                    </SelectItem>
                  ))}
                  {!companyList?.length && <SelectItem value="_" disabled>Tidak ada perusahaan terdaftar</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>ID Karyawan <span className="text-red-500">*</span></Label>
              <Input
                placeholder="Contoh: EMP-001"
                value={verifForm.employeeId}
                onChange={(e) => setVerifForm((f) => ({ ...f, employeeId: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email Kantor <span className="text-muted-foreground text-xs">(opsional)</span></Label>
              <Input
                type="email"
                placeholder="nama@perusahaan.com"
                value={verifForm.officeEmail}
                onChange={(e) => setVerifForm((f) => ({ ...f, officeEmail: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Foto ID Card / KTP <span className="text-muted-foreground text-xs">(opsional)</span></Label>
              {idCardFile ? (
                <div className="flex items-center gap-2 p-2 border rounded-lg bg-muted/30 text-sm">
                  <span className="flex-1 truncate text-muted-foreground">{idCardFile.name}</span>
                  <button type="button" className="text-red-500 text-xs font-medium" onClick={() => setIdCardFile(null)}>Hapus</button>
                </div>
              ) : (
                <Input
                  type="file"
                  accept="image/*"
                  className="cursor-pointer"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) { setIdCardFile(f); setVerifForm((prev) => ({ ...prev, idCardUrl: "" })); }
                  }}
                />
              )}
            </div>
            <Button
              className="w-full"
              onClick={() => submitVerifMutation.mutate()}
              disabled={!verifForm.companyId || !verifForm.employeeId.trim() || submitVerifMutation.isPending || idCardUploading}
            >
              {idCardUploading ? "Mengupload ID Card..." : submitVerifMutation.isPending ? "Mengirim..." : "Kirim Permintaan Verifikasi"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Linked accounts card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Link2 size={16} className="text-primary" />
            {t("Akun Terhubung", "Linked Accounts")}
          </CardTitle>
          <CardDescription>{t("Hubungkan akun untuk login lebih mudah", "Link accounts for easier login")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Google */}
          <div className="flex items-center justify-between p-3.5 rounded-xl border bg-muted/20">
            <div className="flex items-center gap-3">
              <FcGoogle size={22} />
              <div>
                <div className="text-sm font-semibold">Google</div>
                <div className="text-xs text-muted-foreground">
                  {user.googleId ? t("Terhubung", "Connected") : t("Belum terhubung", "Not connected")}
                </div>
              </div>
            </div>
            {user.googleId ? (
              <Badge className="bg-green-100 text-green-700 border-green-200 text-xs font-semibold gap-1">
                <CheckCircle2 size={11} /> {t("Aktif", "Active")}
              </Badge>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={handleLinkGoogle}
                disabled={linkingGoogle || linkGoogleMutation.isPending}
                className="text-xs h-8"
              >
                {linkingGoogle || linkGoogleMutation.isPending ? t("Menghubungkan...", "Linking...") : t("Hubungkan", "Connect")}
              </Button>
            )}
          </div>

          {/* Phone */}
          <div className="flex items-center justify-between p-3.5 rounded-xl border bg-muted/20">
            <div className="flex items-center gap-3">
              <div className="w-[22px] h-[22px] flex items-center justify-center text-green-600">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
              </div>
              <div>
                <div className="text-sm font-semibold">WhatsApp OTP</div>
                <div className="text-xs text-muted-foreground">
                  {user.phone ? displayPhone : t("Belum ada nomor HP", "No phone number")}
                </div>
              </div>
            </div>
            {user.phone ? (
              <Badge className="bg-green-100 text-green-700 border-green-200 text-xs font-semibold gap-1">
                <CheckCircle2 size={11} /> {t("Aktif", "Active")}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">{t("Tidak aktif", "Inactive")}</Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
