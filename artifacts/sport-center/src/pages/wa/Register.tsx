import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, AlertCircle, Loader2, UserPlus } from "lucide-react";

export default function WaRegister() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<"verifying" | "form" | "success" | "error">("verifying");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successName, setSuccessName] = useState("");

  useEffect(() => {
    if (!token) { setState("error"); return; }
    fetch(`/api/wa/register/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.valid) {
          setPhone(data.phone ?? "");
          setState("form");
        } else {
          setState("error");
          setErrorMsg(data.message || "Link tidak valid atau sudah kedaluwarsa.");
        }
      })
      .catch(() => { setState("error"); setErrorMsg("Gagal memverifikasi link."); });
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch(`/api/wa/register/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() || undefined }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessName(name.trim());
        setState("success");
      } else {
        setErrorMsg(data.error || "Terjadi kesalahan. Silakan coba lagi.");
      }
    } catch {
      setErrorMsg("Gagal mengirim data. Periksa koneksi internet Anda.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-red-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 mb-3 shadow-lg">
            <UserPlus className="text-white w-7 h-7" />
          </div>
          <h1 className="text-xl font-black text-gray-900">Sport Center Bandara Soekarno Hatta</h1>
          <p className="text-sm text-gray-500 mt-0.5">Formulir Pendaftaran</p>
        </div>

        <Card className="border-0 shadow-xl rounded-2xl overflow-hidden">
          <CardHeader className="pb-3 bg-gradient-to-r from-orange-500 to-red-600 text-white">
            <CardTitle className="text-base font-black text-center">
              {state === "verifying" ? "Memverifikasi..." :
               state === "form" ? "Isi Data Singkat" :
               state === "success" ? "Pendaftaran Berhasil! 🎉" :
               "Link Tidak Valid"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {state === "verifying" && (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <Loader2 className="w-10 h-10 animate-spin text-orange-500" />
                <p className="text-sm text-gray-500">Memverifikasi link...</p>
              </div>
            )}

            {state === "form" && (
              <form onSubmit={handleSubmit} className="space-y-5">
                <p className="text-sm text-gray-600 text-center">
                  Halo! Sebelum booking, lengkapi data berikut agar kami bisa mengenali Anda lebih baik.
                </p>

                <div className="space-y-1.5">
                  <Label htmlFor="name" className="font-semibold text-sm text-gray-700">
                    Nama Lengkap <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Contoh: Budi Santoso"
                    required
                    className="border-orange-200 focus-visible:ring-orange-400 h-11"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email" className="font-semibold text-sm text-gray-700">
                    Email{" "}
                    <span className="text-gray-400 font-normal text-xs">(opsional)</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="budi@email.com"
                    className="border-orange-200 focus-visible:ring-orange-400 h-11"
                  />
                </div>

                {errorMsg && (
                  <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 p-3 rounded-lg">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    {errorMsg}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading || !name.trim()}
                  className="w-full bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white font-bold h-11 rounded-xl shadow"
                >
                  {loading ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" />Menyimpan...</>
                  ) : (
                    "Daftar & Lanjutkan Booking"
                  )}
                </Button>

                {phone && (
                  <p className="text-xs text-center text-gray-400">
                    No. HP: <span className="font-mono">{phone}</span>
                  </p>
                )}
              </form>
            )}

            {state === "success" && (
              <div className="text-center py-4 space-y-4">
                <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto" />
                <div>
                  <p className="font-black text-gray-900 text-lg">Selamat, {successName}!</p>
                  <p className="text-sm text-gray-500 mt-1">Data Anda berhasil disimpan.</p>
                </div>
                <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-4">
                  <p className="text-sm text-gray-600 mb-2">
                    Kembali ke WhatsApp dan ketik:
                  </p>
                  <p className="font-black text-orange-700 text-2xl tracking-wide">booking</p>
                  <p className="text-xs text-orange-500 mt-1">untuk mulai membuat pesanan 🏅</p>
                </div>
              </div>
            )}

            {state === "error" && (
              <div className="text-center py-4 space-y-4">
                <AlertCircle className="w-16 h-16 text-red-400 mx-auto" />
                <div>
                  <p className="font-bold text-gray-900">Link Tidak Valid</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {errorMsg || "Link pendaftaran sudah kedaluwarsa. Silakan ketik 'booking' di WhatsApp untuk mendapatkan link baru."}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-center text-gray-400 mt-4">
          © Sport Center Bandara Soekarno Hatta — Pendaftaran aman & terenkripsi
        </p>
      </div>
    </div>
  );
}
