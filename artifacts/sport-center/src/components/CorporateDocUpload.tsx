import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  ImageIcon,
  Trash2,
  Upload,
  X,
  Loader2,
  FolderOpen,
  Eye,
} from "lucide-react";

interface Doc {
  id: number;
  bookingId: number;
  fileUrl: string;
  fileName: string | null;
  caption: string | null;
  uploadedBy: string;
  createdAt: string;
}

interface Props {
  bookingId: number;
  /** true = user ini adalah admin, bisa hapus */
  isAdmin?: boolean;
  /** false = sembunyikan form upload (mis. booking sudah selesai lama) */
  canUpload?: boolean;
}

const MAX_FILES = 5;
const MAX_SIZE_MB = 10;

function isPdf(url: string) {
  return url.toLowerCase().includes(".pdf") || url.toLowerCase().includes("application/pdf");
}

function DocPreview({ doc, onDelete, isAdmin }: { doc: Doc; onDelete: () => void; isAdmin?: boolean }) {
  const isImage = !isPdf(doc.fileUrl);
  const shortName = doc.fileName ?? doc.fileUrl.split("/").pop() ?? "File";

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
      {isImage ? (
        <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
          <img
            src={doc.fileUrl}
            alt={doc.caption ?? "Dokumentasi"}
            className="w-14 h-14 object-cover rounded-md border border-slate-200 dark:border-slate-600 hover:opacity-80 transition-opacity"
          />
        </a>
      ) : (
        <a
          href={doc.fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 w-14 h-14 flex flex-col items-center justify-center rounded-md border border-slate-200 dark:border-slate-600 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 transition-colors"
        >
          <FileText size={22} className="text-red-500" />
          <span className="text-[9px] text-red-500 font-bold mt-0.5">PDF</span>
        </a>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
              {shortName}
            </p>
            {doc.caption && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                {doc.caption}
              </p>
            )}
            <p className="text-[10px] text-slate-400 mt-1">
              Diupload oleh: <span className="capitalize font-medium">{doc.uploadedBy}</span>
              {" · "}
              {new Date(doc.createdAt).toLocaleDateString("id-ID", {
                day: "numeric", month: "short", year: "numeric",
              })}
            </p>
          </div>

          <div className="flex gap-1 shrink-0">
            <a
              href={doc.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors"
              title="Lihat file"
            >
              <Eye size={14} />
            </a>
            {isAdmin && (
              <button
                type="button"
                onClick={onDelete}
                className="p-1.5 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 dark:text-red-400 transition-colors"
                title="Hapus"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CorporateDocUpload({ bookingId, isAdmin = false, canUpload = true }: Props) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  const fetchDocs = async () => {
    try {
      const res = await fetch(`/api/bookings/${bookingId}/documentation`);
      if (res.ok) {
        const data = await res.json();
        setDocs(data);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (bookingId) fetchDocs();
  }, [bookingId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast({ title: `File terlalu besar (maks ${MAX_SIZE_MB}MB)`, variant: "destructive" });
      return;
    }

    const allowed = ["image/jpeg", "image/png", "application/pdf"];
    if (!allowed.includes(file.type) && !file.type.startsWith("image/")) {
      toast({ title: "Format tidak didukung. Gunakan JPG, PNG, atau PDF.", variant: "destructive" });
      return;
    }

    setSelectedFile(file);
    if (file.type.startsWith("image/")) {
      setPreview(URL.createObjectURL(file));
    } else {
      setPreview(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    if (docs.length >= MAX_FILES) {
      toast({ title: `Maksimal ${MAX_FILES} file per booking`, variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", selectedFile);
      if (caption.trim()) fd.append("caption", caption.trim());

      const res = await fetch(`/api/bookings/${bookingId}/documentation`, {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Gagal mengunggah file");
      }

      toast({ title: "Dokumentasi berhasil diunggah ✓" });
      setSelectedFile(null);
      setCaption("");
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await fetchDocs();
    } catch (err: any) {
      toast({ title: err.message ?? "Gagal mengunggah", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (docId: number) => {
    if (!confirm("Hapus file dokumentasi ini?")) return;
    try {
      const res = await fetch(`/api/bookings/${bookingId}/documentation/${docId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Gagal menghapus");
      toast({ title: "Dokumentasi dihapus" });
      setDocs((prev) => prev.filter((d) => d.id !== docId));
    } catch {
      toast({ title: "Gagal menghapus dokumentasi", variant: "destructive" });
    }
  };

  const canUploadMore = canUpload && docs.length < MAX_FILES;

  return (
    <Card className="border-blue-200 dark:border-blue-800">
      <CardHeader className="bg-blue-50 dark:bg-blue-900/20 pb-3 border-b border-blue-100 dark:border-blue-800">
        <CardTitle className="flex items-center gap-2 text-sm text-blue-800 dark:text-blue-200">
          <FolderOpen size={16} />
          Dokumentasi Kegiatan
          {docs.length > 0 && (
            <span className="ml-auto text-xs bg-blue-200 dark:bg-blue-800 text-blue-700 dark:text-blue-200 px-2 py-0.5 rounded-full font-medium">
              {docs.length}/{MAX_FILES}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        {/* Daftar dokumen yang sudah ada */}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
            <Loader2 size={14} className="animate-spin" />
            Memuat dokumentasi...
          </div>
        ) : docs.length === 0 && !canUploadMore ? (
          <p className="text-sm text-slate-400 dark:text-slate-500 py-2 text-center">
            Belum ada dokumentasi.
          </p>
        ) : (
          <div className="space-y-2">
            {docs.map((doc) => (
              <DocPreview
                key={doc.id}
                doc={doc}
                isAdmin={isAdmin}
                onDelete={() => handleDelete(doc.id)}
              />
            ))}
          </div>
        )}

        {/* Form upload */}
        {canUploadMore && (
          <div className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              className="hidden"
              onChange={handleFileChange}
            />

            {!selectedFile ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center gap-2 py-5 border-2 border-dashed border-blue-300 dark:border-blue-700 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors cursor-pointer"
              >
                <Upload size={20} />
                <span className="text-sm font-medium">Upload Dokumentasi</span>
                <span className="text-xs text-slate-400">JPG, PNG, PDF · Maks {MAX_SIZE_MB}MB</span>
              </button>
            ) : (
              <div className="space-y-2">
                {/* Preview */}
                <div className="flex items-center gap-3 p-2.5 rounded-lg border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20">
                  {preview ? (
                    <img src={preview} alt="" className="w-12 h-12 object-cover rounded-md shrink-0" />
                  ) : (
                    <div className="w-12 h-12 flex items-center justify-center rounded-md bg-red-100 dark:bg-red-900/30 shrink-0">
                      <FileText size={20} className="text-red-500" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
                      {selectedFile.name}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedFile(null); setPreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                    className="p-1 rounded text-slate-400 hover:text-slate-600 shrink-0"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Caption */}
                <input
                  type="text"
                  placeholder="Keterangan / caption (opsional)"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  maxLength={200}
                  className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    <ImageIcon size={14} className="mr-1" />
                    Ganti
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="flex-1"
                    onClick={handleUpload}
                    disabled={uploading}
                  >
                    {uploading ? (
                      <><Loader2 size={14} className="mr-1 animate-spin" />Mengunggah...</>
                    ) : (
                      <><Upload size={14} className="mr-1" />Upload</>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {docs.length > 0 && !selectedFile && (
              <p className="text-xs text-slate-400 text-center">
                {MAX_FILES - docs.length} slot tersisa
              </p>
            )}
          </div>
        )}

        {!canUpload && docs.length === 0 && !loading && (
          <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-1">
            Belum ada dokumentasi yang diunggah.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
