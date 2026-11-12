import { useState, useRef, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronsUpDown } from "lucide-react";
import { getToken } from "@/lib/auth";
import { presentTransactionNarrative } from "@/lib/transactionNarrative";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Search, TrendingDown, Banknote,
  Eye, Edit2, ThumbsUp, ThumbsDown, X, Receipt,
  Upload, Loader2, Trash2,
} from "lucide-react";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" });

const PAYMENT_METHODS = ["Transfer Bank", "BI-FAST", "QRIS", "PLN Prabayar", "E-Commerce", "Tunai", "Kartu Kredit", "Virtual Account", "E-Wallet"];

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Disetujui",
  paid: "Sudah Dibayar",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_approval: "bg-yellow-100 text-yellow-700",
  approved: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  asset: "Aset",
  liability: "Kewajiban",
  equity: "Ekuitas",
  revenue: "Pendapatan",
  expense: "Beban",
};

const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  asset: "bg-blue-50 text-blue-700",
  liability: "bg-purple-50 text-purple-700",
  equity: "bg-indigo-50 text-indigo-700",
  revenue: "bg-green-50 text-green-700",
  expense: "bg-orange-50 text-orange-700",
};


function formatIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

// UI displays digit grouping, but database payload stays an unformatted number.
export function normalizeExpenseRupiahInput(value: string): string {
  const compact = value.trim().replace(/\s/g, "").replace(/^Rp/i, "");
  // Bank screenshot formats: 100.000,00 or 100,000.00; strip cents.
  const noCents = /[.,]\d{2}$/.test(compact)
    ? compact.replace(/[.,]\d{2}$/, "") : compact;
  return noCents.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 15);
}
export function formatExpenseRupiahInput(value: string): string {
  const digits = normalizeExpenseRupiahInput(value);
  return digits ? new Intl.NumberFormat("id-ID").format(Number(digits)) : "";
}

const INCOME_SOURCE_OPTIONS = ["Felicia Justiani", "Cahaya Sejati Teknologi", "Angelia Nirwana"];
const INCOME_BANK_OPTIONS = ["Mandiri", "BCA", "blu by BCA Digital", "BNI", "BRI", "Kas Tunai", "Kas Besar SC"];

type IncomeDropdownProps = {
  id: string;
  value: string;
  options: string[];
  placeholder: string;
  otherPlaceholder: string;
  required?: boolean;
  onChange: (value: string) => void;
};

/** Consistent with the Metode select. Unknown values remain manually editable. */
function IncomeDropdown({ id, value, options, placeholder, otherPlaceholder, required, onChange }: IncomeDropdownProps) {
  const manual = value !== "" && !options.includes(value);
  return (
    <div className="space-y-2">
      <Select
        value={manual ? "__manual__" : value || undefined}
        onValueChange={(next) => onChange(next === "__manual__" ? " " : next)}
      >
        <SelectTrigger id={id} aria-required={required}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
          <SelectItem value="__manual__">Lainnya (isi manual)</SelectItem>
        </SelectContent>
      </Select>
      {manual && (
        <Input
          aria-label={otherPlaceholder}
          value={value.trimStart()}
          onChange={(event) => onChange(event.target.value === "" ? " " : event.target.value)}
          placeholder={otherPlaceholder}
          required={required}
          autoComplete="off"
        />
      )}
    </div>
  );
}

const EMPTY_FORM = {
  expenseDate: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" }),
  coaAccountId: "",
  description: "",
  vendorId: "",
  vendorName: "",
  facilityId: "",
  amount: "",
  ppnAmount: "",
  paymentMethod: "",
  paymentAccount: "",
  receiptUrls: [] as string[],
  notes: "",
  bankReference: "",
};

interface Vendor {
  id: number;
  name: string;
}

interface CoaAccount {
  id: number;
  code: string;
  name: string;
  accountType: string;
  isActive: boolean;
  sortOrder: number;
}

// Explicit cutover gate: normal Finance SC forms are still used for TEST only.
// Releasing real transactions requires a separate reviewed change.
const FINANCE_SC_TEST_ONLY = true;

export default function AdminExpenses() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Separate the income and expense workflows without changing their existing APIs.
  const [financeSection, setFinanceSection] = useState<"income" | "expenses" | "details" | "test">("income");
  const [testDirection, setTestDirection] = useState<"IN" | "OUT">("IN");
  const [testEntryKey, setTestEntryKey] = useState(() => crypto.randomUUID());
  const [testSaving, setTestSaving] = useState(false);
  const [expenseTestSaving,setExpenseTestSaving] = useState(false);
  const [expenseTestEntryKey,setExpenseTestEntryKey] = useState(() => crypto.randomUUID());
  const [testForm, setTestForm] = useState({
    transactionDate: new Date().toLocaleDateString("sv-SE", {timeZone:"Asia/Jakarta"}),
    sourceName:"",senderBank:"",receivingAccount:"",method:"Transfer Bank",
    bankReference:"",notes:"",amount:""
  });
  const [detailKind, setDetailKind] = useState<"all" | "income" | "expense">("all");
  const [unifiedSearch, setUnifiedSearch] = useState("");
  const [expandedTransactionIds, setExpandedTransactionIds] = useState<string[]>([]);
  const [transactionDateMode, setTransactionDateMode] = useState<"all" | "single" | "range">("all");
  const [transactionSingleDate, setTransactionSingleDate] = useState("");
  const [transactionDateFrom, setTransactionDateFrom] = useState("");
  const [transactionDateTo, setTransactionDateTo] = useState("");
  const [masterPageSize,setMasterPageSize] = useState<20|50|100>(20);
  const [masterPage,setMasterPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Saved incoming funds are operational and unverified, never journal postings.
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [incomeHistoryOpen, setIncomeHistoryOpen] = useState(false);
  const [incomeSaving, setIncomeSaving] = useState(false);
  const [incomeDuplicateWarning, setIncomeDuplicateWarning] = useState(false);
  const [incomeEntryKey, setIncomeEntryKey] = useState(() => crypto.randomUUID());
  const [incomePreview, setIncomePreview] = useState(false);
  const [cashReceiptConfirmed, setCashReceiptConfirmed] = useState(false);
  const [incomeForm, setIncomeForm] = useState({
    transactionDate: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" }),
    sourceName: "",
    method: "Transfer Bank",
    bank: "",
    cashType: "",
    receivingAccount: "",
    bankReference: "",
    amount: "",
  });
  const [formOpen, setFormOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [recipientFocused, setRecipientFocused] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const [sheetCheckId, setSheetCheckId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteConfirmNo, setDeleteConfirmNo] = useState("");

  const [expenseKind,setExpenseKind] = useState("Transfer Bank");
  const [destinationBank,setDestinationBank] = useState("");
  const [destinationAccount,setDestinationAccount] = useState("");
  const [autoReadProof, setAutoReadProof] = useState(false);
  const [proofPreview, setProofPreview] = useState<{
    amount: number | null; date: string | null; bankReference: string | null; recipient: string | null;
    paymentMethod: string; engine: string; verified: boolean;
    destinationBank?: string|null;destinationAccount?: string|null;notes?: string|null;sourceBank?: string|null;
  } | null>(null);
  const [proofEvidence,setProofEvidence] = useState<typeof proofPreview>(null);
  const [proofSelection,setProofSelection] = useState({
    amount:true,date:true,recipient:true,bankReference:true,paymentMethod:true,
    notes:true,destinationBank:true,destinationAccount:true,sourceBank:true
  });
  const [proofViewer,setProofViewer] = useState<{testNo:string,urls:string[],index:number}|null>(null);
  const [scanningProof, setScanningProof] = useState(false);
  const [proofReadMessage,setProofReadMessage] = useState("");
  const lastProofFileRef=useRef<File|null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const receiptInputRef = useRef<HTMLInputElement>(null);

  async function previewExpenseProof(file:File) {
    setScanningProof(true);
    setProofReadMessage("");
    try {
      const proofFd = new FormData();
      proofFd.append("proof",file);
      proofFd.append("consent","true");
      const response=await fetch(`${API}/admin/expenses/preview-proof`,{
        method:"POST",headers:{Authorization:`Bearer ${getToken()}`},body:proofFd
      });
      const preview=await response.json();
      if(!response.ok)throw Error(preview.error??"Pembacaan bukti tidak tersedia");
      if(preview.amount!=null || preview.date || preview.recipient || preview.bankReference){
        setProofPreview(preview);
        setProofEvidence(preview);
        if(preview.readStatus==="partial")setProofReadMessage(preview.readMessage??"Sebagian data belum terbaca.");
      }else{
        setProofPreview(null);
        setProofEvidence(null);
        setProofReadMessage(preview.readMessage??"OCR belum berhasil membaca data bukti. File tetap tersimpan.");
      }
    }catch(e){
      setProofPreview(null);
      setProofEvidence(null);
      setProofReadMessage(e instanceof Error?e.message:"OCR belum tersedia. File tetap tersimpan.");
    }finally{setScanningProof(false);}
  }

  async function handleReceiptUpload(files: FileList | File[]) {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"];
    const fileArr = Array.from(files);
    for (const file of fileArr) {
      if (!allowed.includes(file.type)) {
        toast({ title: "Format tidak didukung", description: `${file.name}: Gunakan JPG, PNG, WebP, atau GIF`, variant: "destructive" });
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast({ title: "File terlalu besar", description: `${file.name}: Maksimal 10 MB`, variant: "destructive" });
        return;
      }
    }
    setUploadingReceipt(true);
    try {
      const uploaded: string[] = [];
      for (const file of fileArr) {
        const fd = new FormData();
        fd.append("file", file);
        const resp = await fetch(`${API}/storage/upload-proof`, {
          method: "POST",
          headers: { Authorization: `Bearer ${getToken()}` },
          body: fd,
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error ?? "Upload gagal");
        uploaded.push(data.url);
      }
      setForm((prev) => ({ ...prev, receiptUrls: [...prev.receiptUrls, ...uploaded] }));
      toast({ title: `${uploaded.length} foto nota berhasil diupload` });
      // Keep the original image for OCR retry; never upload it a second time.
      const firstProof = fileArr.find((file) => ["image/jpeg","image/png","image/webp"].includes(file.type));
      if(firstProof)lastProofFileRef.current=firstProof;
      if(firstProof && autoReadProof)await previewExpenseProof(firstProof);
    } catch (err: any) {
      toast({ title: "Upload gagal", description: err.message, variant: "destructive" });
    } finally {
      setUploadingReceipt(false);
    }
  }

  function applyProofPreview() {
    if(!proofPreview)return;
    const p=proofPreview;
    setForm(prev=>({
      ...prev,
      expenseDate:proofSelection.date&&p.date&&/^\d{4}-\d{2}-\d{2}$/.test(p.date)?p.date:prev.expenseDate,
      amount:proofSelection.amount&&p.amount!=null&&Number.isSafeInteger(p.amount)&&p.amount>0?String(p.amount):prev.amount,
      bankReference:proofSelection.bankReference?p.bankReference??prev.bankReference:prev.bankReference,
      vendorName:proofSelection.recipient&&p.recipient?.trim()?p.recipient.trim():prev.vendorName,
      vendorId:proofSelection.recipient&&p.recipient?"":prev.vendorId,
      paymentMethod:proofSelection.paymentMethod&&PAYMENT_METHODS.includes(p.paymentMethod)?p.paymentMethod:prev.paymentMethod,
      notes:proofSelection.notes&&p.notes?.trim()?p.notes.trim():prev.notes,
      paymentAccount:proofSelection.sourceBank&&p.sourceBank?.trim()?p.sourceBank.trim():prev.paymentAccount,
    }));
    if(proofSelection.destinationBank&&p.destinationBank?.trim())setDestinationBank(p.destinationBank.trim());
    if(proofSelection.destinationAccount&&p.destinationAccount?.trim())setDestinationAccount(p.destinationAccount.trim());
    if(proofSelection.paymentMethod&&p.paymentMethod){
      if(p.paymentMethod==="BI-FAST"||p.paymentMethod==="Transfer Bank")setExpenseKind("Transfer Bank");
      else if(["QRIS","PLN Prabayar"].includes(p.paymentMethod))setExpenseKind(p.paymentMethod);
    }
    toast({title:"Saran OCR diterapkan",description:"Periksa kembali tiap field. OCR bukan bukti konfirmasi bank."});
    setProofPreview(null);
  }

  function removeReceiptUrl(idx: number) {
    setForm((prev) => ({ ...prev, receiptUrls: prev.receiptUrls.filter((_, i) => i !== idx) }));
  }

  const params = new URLSearchParams();
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  if (filterCategory !== "all") params.set("category", filterCategory);

  const { data, isLoading } = useQuery({
    queryKey: ["expenses", startDate, endDate, filterCategory],
    queryFn: () =>
      fetch(`${API}/admin/expenses?${params}`, { headers: authHeaders() }).then((r) => r.json()),
  });

  const { data: incomeData, refetch: refetchIncome, isError: incomeHistoryError, isFetching: incomeHistoryLoading } = useQuery<{
    entries: Array<{ id: number; incomeNo: string; cashSheetState: string; cashSheetRow: number | null; transactionDate: string; sourceName: string;
      senderBank: string; receivingAccount: string; amount: string;
      method: string; bankReference: string | null;
      sheetSyncState: string; reconciliationState: string; sheetSyncError: string | null }>;
    summary: { manualThisMonth: number; awaitingSync: number };
  }>({
    queryKey: ["sc-income-entries"],
    queryFn: async () => {
      const response = await fetch(`${API}/admin/income`, { headers: authHeaders() });
      if (!response.ok) throw new Error("Daftar Uang Masuk belum tersedia");
      return response.json();
    },
  });

  const {data:financeTestData,refetch:refetchFinanceTest,isError:financeTestReadError} = useQuery<{
    entries:Array<{id:number;testNo:string;direction:"IN"|"OUT";transactionDate:string;
      sourceName:string;amount:string;sheetSyncState:string;sheetRow:number|null;
      sheetSyncError:string|null;sheetVerifiedAt:string|null;sheetBalance:string|null;
      senderBank:string;receivingAccount:string;
      method:string;bankReference:string|null;notes:string|null;
      receiptUrls?:string[];expenseKind?:string;destinationBank?:string;destinationAccount?:string}>;
    summary:{income:number;expense:number;balance:number;pending:number;count:number};
    writeEnabled:boolean;
  }>({
    queryKey:["sc-finance-test-entries"],
    enabled:FINANCE_SC_TEST_ONLY || financeSection==="test",
    retry:false,
    queryFn:async()=>{
      const r=await fetch(`${API}/admin/finance-test`,{headers:authHeaders()});
      if(!r.ok)throw Error("Ledger uji belum tersedia atau memerlukan Super Admin");
      return r.json();
    }
  });
  async function saveFinanceTest() {
    if(testSaving)return;
    setTestSaving(true);
    try {
      const response=await fetch(`${API}/admin/finance-test`,{
        method:"POST",headers:authHeaders(),
        body:JSON.stringify({
          ...testForm,direction:testDirection,entryKey:testEntryKey,
          amount:Number(normalizeExpenseRupiahInput(testForm.amount))
        })
      });
      const result=await response.json();
      if(!response.ok)throw Error(result.error??"Gagal menyimpan uji");
      toast({title:`Transaksi uji ${result.testNo} tercatat`,
        description:result.sheetState==="synced"
          ?"Baris uji kas besar sc terbaca ulang; bukan mutasi bank resmi."
          :"Belum tertulis ke kas besar sc. Pencatatan hanya ada pada ledger uji."});
      setTestEntryKey(crypto.randomUUID());
      setTestForm(f=>({...f,sourceName:"",amount:"",bankReference:"",notes:""}));
      await refetchFinanceTest();
    }catch(error:any){
      toast({title:"Uji Kas Besar belum berhasil",description:error?.message,variant:"destructive"});
    }finally{setTestSaving(false);}
  }
  async function reconcileFinanceTestRows(){
    try{
      const response=await fetch(`${API}/admin/finance-test/reconcile`,{
        method:"POST",headers:authHeaders()
      });
      const data=await response.json();
      if(!response.ok)throw Error(data.error??"Baca ulang Sheets gagal");
      toast({title:"Ledger uji diperiksa ulang",
        description:`Baris dihapus: ${data.removed}, berubah: ${data.mismatched}, bergeser: ${data.moved}`});
    }catch(error:any){
      toast({title:"Pemeriksaan Sheets gagal",description:error?.message,variant:"destructive"});
    }finally{await refetchFinanceTest();}
  }

  async function retryFinanceTestRow(id:number){
    try {
      const response=await fetch(`${API}/admin/finance-test/${id}/retry`,{
        method:"POST",headers:authHeaders()
      });
      const data=await response.json();
      if(!response.ok)throw Error(data.error??"Pengiriman belum tersedia");
      toast({title:data.sheetState==="synced"?"Baris uji tersinkron":"Uji masih menunggu pengiriman"});
    }catch(error:any){
      toast({title:"Pengiriman uji diblokir",description:error?.message,variant:"destructive"});
    }finally{await refetchFinanceTest();}
  }

  // Both existing input forms use the isolated SC_TEST_ONLY ledger during testing.
  // No operational income/expense, BizPortal bank mutation or journal is created.
  async function postTestEntry(payload: {
    entryKey:string; direction:"IN"|"OUT";transactionDate:string;sourceName:string;
    senderBank:string;receivingAccount:string;cashType?:string;method:string;bankReference:string;
    notes:string;amount:number;receiptUrls?:string[];expenseKind?:string;destinationBank?:string;destinationAccount?:string
  }) {
    const response=await fetch(`${API}/admin/finance-test`,{
      method:"POST",headers:authHeaders(),body:JSON.stringify(payload)
    });
    const result=await response.json();
    if(!response.ok)throw Error(result.error??"Gagal menyimpan transaksi TEST");
    return result as {testNo:string;sheetState:string;replayed?:boolean};
  }

  async function saveIncome(confirmSimilar = false) {
    if (!incomePreview || incomeSaving) return;
    setIncomeSaving(true);
    try {
      if(FINANCE_SC_TEST_ONLY){
        const result=await postTestEntry({
          entryKey:incomeEntryKey,direction:"IN",
          transactionDate:incomeForm.transactionDate,sourceName:incomeForm.sourceName.trim(),
          senderBank:incomeForm.bank.trim(),cashType:incomeForm.cashType,receivingAccount:incomeForm.receivingAccount.trim(),
          method:incomeForm.method,bankReference:incomeForm.bankReference.trim(),
          notes:"INPUT UANG MASUK SC - SIMULASI",amount:Number(incomeForm.amount)
        });
        toast({title:`Uang Masuk TEST: ${result.testNo}`,
          description:result.sheetState==="synced"
            ?"Tercatat ke kas besar sc, bukan ke BizPortal atau jurnal."
            :"Belum tersinkron; cek ledger Uji Kas Besar. Jangan input ulang tanpa memeriksa ID."});
        await refetchFinanceTest();
        setIncomeOpen(false);setIncomePreview(false);setCashReceiptConfirmed(false);
        setIncomeEntryKey(crypto.randomUUID());
        return;
      }
      const response = await fetch(`${API}/admin/income`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          entryKey: incomeEntryKey,
          confirmSimilar,
          transactionDate: incomeForm.transactionDate,
          sourceName: incomeForm.sourceName.trim(),
          senderBank: incomeForm.bank.trim(),
          method: incomeForm.method,
          receivingAccount: incomeForm.receivingAccount.trim(),
          bankReference: incomeForm.bankReference.trim(),
          amount: Number(incomeForm.amount),
          confirmedCashReceived: cashReceiptConfirmed && incomeForm.method === "Tunai" &&
            incomeForm.receivingAccount === "Kas Besar SC",
        }),
      });
      const result = await response.json();
      if (!response.ok && result.error === "POSSIBLE_DUPLICATE_INCOME") {
        setIncomeDuplicateWarning(true);
        return;
      }
      if (!response.ok) throw new Error(result.message || result.error || "Gagal menyimpan");
      setIncomeDuplicateWarning(false);
      toast({
        title: "Uang Masuk berhasil dicatat",
        description: `${result.incomeNo} — ${result.cashSheetStatus === "synced" ? "Kas Besar SC tersinkron (belum direkonsiliasi)." : result.cashSheetStatus === "disabled" ? "Penerimaan kas tersimpan; integrasi Kas Besar SC belum diaktifkan." : result.sheetStatus === "synced"
          ? "Tercatat di tab SC Uang Masuk, belum terverifikasi bank."
          : "Tersimpan di SC. Sinkronisasi Sheets belum selesai."}`,
      });
      await refetchIncome();
      await qc.invalidateQueries({ queryKey: ["expenses"] });
      setIncomeOpen(false);
      setIncomePreview(false);
      setCashReceiptConfirmed(false);
      setIncomeEntryKey(crypto.randomUUID());
    } catch (error: any) {
      toast({ title: "Gagal menyimpan Uang Masuk",
        description: error.message ?? "Periksa daftar sebelum mengulangi.",
        variant: "destructive" });
    } finally { setIncomeSaving(false); }
  }

  async function retryCashLedger(id: number) {
    try {
      const response = await fetch(`${API}/admin/income/${id}/retry-cash-sheet`, {
        method: "POST", headers: authHeaders(),
      });
      if (!response.ok) throw new Error("Pengiriman kas belum tersedia");
      const result = await response.json();
      toast({ title: result.cashSheetStatus === "synced"
        ? "Kas Besar SC tersinkron" : "Pengiriman kas belum selesai" });
      await refetchIncome();
    } catch {
      toast({ title: "Kas Besar SC belum tersinkron", variant: "destructive" });
    }
  }

  const { data: facilities = [] } = useQuery({
    queryKey: ["facilities"],
    queryFn: () => fetch(`${API}/facilities`).then((r) => r.json()),
  });

  const { data: coaAccounts = [] } = useQuery<CoaAccount[]>({
    queryKey: ["coa-accounts"],
    queryFn: () =>
      fetch(`${API}/admin/expenses/coa-accounts`, { headers: authHeaders() })
        .then((r) => r.json())
        .then((d) => (Array.isArray(d) ? d : [])),
  });

  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["vendors"],
    queryFn: () =>
      fetch(`${API}/admin/vendors`, { headers: authHeaders() })
        .then((r) => r.json())
        .then((d) => (Array.isArray(d) ? d.filter((v: any) => v.isActive) : [])),
  });

  const { data: employees = [] } = useQuery<Array<{ employeeId: string; fullName: string; isActive: boolean }>>({
    queryKey: ["sc-employees-expense-recipient"],
    queryFn: () => fetch(`${API}/admin/sc-employees`, { headers: authHeaders() })
      .then((r) => { if (!r.ok) throw new Error("Daftar karyawan gagal dimuat"); return r.json(); })
      .then((rows) => Array.isArray(rows) ? rows.filter((e) => e.isActive) : []),
  });

  const { data: detail } = useQuery({
    queryKey: ["expense-detail", detailId],
    queryFn: () =>
      fetch(`${API}/admin/expenses/${detailId}`, { headers: authHeaders() }).then((r) => r.json()),
    enabled: !!detailId && detailOpen,
  });

  const { data: sheetCandidates, isFetching: checkingSheet, error: sheetCheckError } = useQuery<{
    state: string; verified: boolean; message: string;
    candidates: Array<{ id: number; date: string; amount: number; description: string; reconciliationStatus: string }>;
  }>({
    queryKey: ["expense-sheet-candidates", sheetCheckId],
    enabled: sheetCheckId !== null && detailOpen,
    retry: false,
    queryFn: async () => {
      const response = await fetch(`${API}/admin/expenses/${sheetCheckId}/sheet-candidates`, { headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Gagal mencocokkan mutasi");
      return result;
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: any) =>
      fetch(`${API}/admin/expenses`, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Gagal membuat pengeluaran");
        return d;
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      setFormOpen(false);
      setForm({ ...EMPTY_FORM });
      setEditingId(null);
      toast({ title: "Pengeluaran dibuat" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) =>
      fetch(`${API}/admin/expenses/${id}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify(body) }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Gagal update");
        return d;
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["expense-detail", editingId] });
      setFormOpen(false);
      setForm({ ...EMPTY_FORM });
      setEditingId(null);
      toast({ title: "Pengeluaran diupdate" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, action, rejectedReason }: { id: number; action: string; rejectedReason?: string }) =>
      fetch(`${API}/admin/expenses/${id}/status`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({ action, rejectedReason }),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Gagal update status");
        return d;
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["expense-detail", vars.id] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setRejectOpen(false);
      setRejectReason("");
      const labels: Record<string, string> = {
        submit: "Pengeluaran diajukan untuk approval",
        approve: "Pengeluaran disetujui",
        reject: "Pengeluaran ditolak",
        pay: "Pengeluaran ditandai sudah dibayar",
        cancel: "Pengeluaran dibatalkan",
      };
      toast({ title: labels[vars.action] ?? "Status diupdate" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`${API}/admin/expenses/${id}`, { method: "DELETE", headers: authHeaders() }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Gagal menghapus");
        return d;
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setDeleteConfirmId(null);
      setDeleteConfirmNo("");
      setDetailOpen(false);
      toast({ title: `${data.expenseNo} berhasil dihapus` });
    },
    onError: (e: any) => toast({ title: "Gagal hapus", description: e.message, variant: "destructive" }),
  });

  const summary = data?.summary ?? { totalThisMonth: 0, pendingApproval: 0, paid: 0, unpaid: 0 };
  const allExpenses: any[] = data?.expenses ?? [];

  // Presentation only: reuse the existing SC income/expense reads without creating
  // bank mutations, accounting entries, or extra writes to Google Sheets.
  const unifiedTransactions = FINANCE_SC_TEST_ONLY
    ? (financeTestData?.entries ?? []).map(entry => ({
      key:`test-${entry.id}`, id:entry.testNo,
      kind:entry.direction==="IN"?"income" as const:"expense" as const,
      date:entry.transactionDate,name:entry.sourceName,amount:Number(entry.amount),
      bank:entry.senderBank||"",account:entry.receivingAccount||"",
      destinationBank:entry.direction==="OUT"?entry.destinationBank||"":"",
      destinationAccount:entry.direction==="OUT"?entry.destinationAccount||"":entry.receivingAccount||"",
      expenseKind:entry.direction==="OUT"?entry.expenseKind||"Transfer Bank":"",isTest:true,
      description:entry.notes||"Simulasi Sport Center",
      method:entry.method||"Tidak ditentukan",
      status:entry.sheetSyncState==="synced"?"TEST — Tersinkron":
        entry.sheetSyncState==="removed"?"TEST — Dihapus dari Sheets":
        entry.sheetSyncState==="mismatch"?"TEST — Tidak Cocok":
        `TEST — ${entry.sheetSyncState}`,
      sheet:`kas besar sc — ${entry.sheetSyncState==="synced"?"baris "+entry.sheetRow:entry.sheetSyncState}`,
      sheetBalance:entry.sheetBalance==null?null:Number(entry.sheetBalance),
      cashSheet:entry.sheetSyncState==="synced"?`Baris ${entry.sheetRow} (TEST)`:
        `Status ${entry.sheetSyncState}`,
      reference:entry.bankReference||"",notes:entry.notes||"",receiptUrls:entry.receiptUrls??[],
    }))
    : [
    ...(incomeData?.entries ?? []).map(entry => ({
      key: `income-${entry.id}`, id: entry.incomeNo, kind: "income" as const,
      date: entry.transactionDate, name: entry.sourceName, amount: Number(entry.amount),
      bank: entry.senderBank, account: entry.receivingAccount,
      description: `Dana masuk dari ${entry.sourceName}`, method: entry.method || "Tidak tersedia",
      status: entry.reconciliationState || "UNVERIFIED",
      sheet: entry.sheetSyncState === "synced" ? "SC Uang Masuk — tersinkron (belum diverifikasi)" : entry.sheetSyncState,
      sheetBalance:null as number|null,
      cashSheet: entry.cashSheetState === "synced" ? `kas besar sc — baris ${entry.cashSheetRow}` :
        entry.cashSheetState === "not_applicable" ? "kas besar sc — tidak berlaku" : `kas besar sc — ${entry.cashSheetState}`,
      reference: entry.bankReference || "", notes: "",receiptUrls:[] as string[],
      destinationBank:"",destinationAccount:entry.receivingAccount||"",expenseKind:"",isTest:false,
    })),
    ...allExpenses.map((expense: any) => ({
      key: `expense-${expense.id}`, id: String(expense.expenseNo ?? `EXP-${expense.id}`),
      kind: "expense" as const, date: String(expense.expenseDate ?? ""),
      name: String(expense.vendorName ?? "Penerima belum diisi"),
      amount: Number(expense.totalAmount ?? 0), bank: String(expense.paymentAccount ?? ""),
      account: String(expense.paymentAccount ?? ""),
      description: String(expense.description ?? ""), method: String(expense.paymentMethod ?? ""),
      status: STATUS_LABELS[String(expense.paymentStatus)] ?? String(expense.paymentStatus ?? "Draft"),
      sheet: "Belum dikonfirmasi sebagai mutasi bank",
      sheetBalance:null as number|null,
      cashSheet: "Pemeriksaan mutasi BizPortal terpisah",
      reference: String(expense.bankReference ?? ""), notes: String(expense.notes ?? ""),
      receiptUrls:Array.isArray(expense.receiptUrls)?expense.receiptUrls:[],
      destinationBank:"",destinationAccount:"",expenseKind:"",isTest:false,
    })),
  ];
  const activeTestIncome = (financeTestData?.entries??[]).filter(x=>x.direction==="IN");
  const activeTestExpense = (financeTestData?.entries??[]).filter(x=>x.direction==="OUT");
  const visibleTestExpenses = activeTestExpense.filter(item=>{
    const term=search.trim().toLowerCase();
    return (!startDate||item.transactionDate>=startDate)
      && (!endDate||item.transactionDate<=endDate)
      && (!term||[item.testNo,item.sourceName,item.senderBank,item.receivingAccount,
        item.bankReference??"",item.notes??""].some(x=>x.toLowerCase().includes(term)));
  });
  const transactionDateInvalid = transactionDateMode === "range"
    && Boolean(transactionDateFrom && transactionDateTo && transactionDateFrom > transactionDateTo);
  // Sheet E is the historical-inclusive running balance; it is exposed
  // only after Google Sheets read-back verifies the corresponding TEST row.
  const visibleTransactions = unifiedTransactions.filter(tx =>
    (detailKind === "all" || tx.kind === detailKind)
    && (transactionDateMode !== "single" || !transactionSingleDate || tx.date === transactionSingleDate)
    && (transactionDateMode !== "range" || (
      (!transactionDateFrom || tx.date >= transactionDateFrom)
      && (!transactionDateTo || tx.date <= transactionDateTo)))
    && !transactionDateInvalid
    && (!unifiedSearch.trim() || [tx.id, tx.name, tx.bank, tx.account, tx.description, tx.reference]
      .some(value => value.toLowerCase().includes(unifiedSearch.trim().toLowerCase())))
  ).sort((a,b)=>a.date.localeCompare(b.date) ||
    Number(a.id.match(/\d+$/)?.[0]??0)-Number(b.id.match(/\d+$/)?.[0]??0));
  const masterPageCount=Math.max(1,Math.ceil(visibleTransactions.length/masterPageSize));
  const effectiveMasterPage=Math.min(masterPage,masterPageCount);
  const paginatedTransactions=visibleTransactions.slice(
    (effectiveMasterPage-1)*masterPageSize,effectiveMasterPage*masterPageSize);
  const masterVisibleStart=visibleTransactions.length?
    (effectiveMasterPage-1)*masterPageSize+1:0;
  const masterVisibleEnd=Math.min(effectiveMasterPage*masterPageSize,visibleTransactions.length);
  const toggleExpandedTransaction = (key: string) =>
    setExpandedTransactionIds(current => current.includes(key)
      ? current.filter(id => id !== key) : [...current, key]);

  const recipientSuggestions = [
    ...employees.map((e) => ({ key: `staff-${e.employeeId}`, name: e.fullName, kind: "Karyawan SC", vendorId: "" })),
    ...vendors.map((v) => ({ key: `vendor-${v.id}`, name: v.name, kind: "Vendor", vendorId: String(v.id) })),
  ].filter((entry) => entry.name.toLowerCase().includes(form.vendorName.trim().toLowerCase())).slice(0, 8);

  const filtered = allExpenses.filter((e: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.expenseNo?.toLowerCase().includes(q) ||
      e.description?.toLowerCase().includes(q) ||
      e.notes?.toLowerCase().includes(q) ||
      e.bankReference?.toLowerCase().includes(q) ||
      e.vendorName?.toLowerCase().includes(q) ||
      e.category?.toLowerCase().includes(q) ||
      e.coaAccount?.name?.toLowerCase().includes(q) ||
      e.coaAccount?.code?.toLowerCase().includes(q)
    );
  });

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setShowAdvanced(false);
    setProofPreview(null);setProofEvidence(null);setProofReadMessage("");
    setDestinationBank("");setDestinationAccount("");setExpenseKind("Transfer Bank");
    setAutoReadProof(false);
    setFormOpen(true);
  }

  function openEdit(expense: any) {
    setEditingId(expense.id);
    setForm({
      expenseDate: expense.expenseDate ?? "",
      coaAccountId: expense.coaAccountId ? String(expense.coaAccountId) : "",
      description: expense.description ?? "",
      vendorId: expense.vendorId ? String(expense.vendorId) : "",


      vendorName: expense.vendorName ?? "",
      facilityId: expense.facilityId ? String(expense.facilityId) : "",
      amount: String(expense.amount ?? ""),
      ppnAmount: String(expense.ppnAmount ?? "0"),
      paymentMethod: expense.paymentMethod ?? "",
      paymentAccount: expense.paymentAccount ?? "",
      receiptUrls: Array.isArray(expense.receiptUrls) ? expense.receiptUrls : (expense.receiptUrl ? [expense.receiptUrl] : []),
      notes: expense.notes || expense.description || "",
      bankReference: expense.bankReference ?? "",
    });
    setProofPreview(null);
    setFormOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if(FINANCE_SC_TEST_ONLY && (uploadingReceipt || scanningProof)){
      toast({title:"Bukti masih diproses",description:"Simpan setelah unggahan/OCR selesai agar bukti tidak tertinggal.",variant:"destructive"});
      return;
    }
    if (!form.notes.trim()) {
      toast({ title: "Catatan transaksi wajib diisi", description: "Tuliskan tujuan penggunaan dana sebelum menyimpan.", variant: "destructive" });
      return;
    }
    const selectedV = vendors.find((v) => v.id === Number(form.vendorId));
    const body = {
      expenseDate: form.expenseDate,
      coaAccountId: form.coaAccountId ? Number(form.coaAccountId) : null,
      description: form.notes.trim(),
      vendorId: form.vendorId ? Number(form.vendorId) : null,
      vendorName: selectedV?.name ?? form.vendorName ?? null,
      facilityId: form.facilityId ? Number(form.facilityId) : null,
      amount: Number(normalizeExpenseRupiahInput(form.amount)),
      ppnAmount: Number(form.ppnAmount || 0),
      paymentMethod: form.paymentMethod || null,
      paymentAccount: form.paymentAccount || null,
      receiptUrls: form.receiptUrls,
      notes: form.notes.trim(),
      bankReference: form.bankReference.trim(),
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, body });
    } else if(FINANCE_SC_TEST_ONLY){
      if(expenseTestSaving)return;
      const rawAmount=Number(normalizeExpenseRupiahInput(form.amount));
      const gross=rawAmount+Number(form.ppnAmount||0);
      if(!Number.isSafeInteger(gross)||gross<=0||gross>1000000){
        toast({title:"Nominal uji tidak valid",description:"Total termasuk PPN maksimal Rp1.000.000.",
          variant:"destructive"});return;
      }
      setExpenseTestSaving(true);
      void (async()=>{
        try{
          const result=await postTestEntry({
            entryKey:expenseTestEntryKey,direction:"OUT",
            transactionDate:form.expenseDate,
            sourceName:(selectedV?.name??form.vendorName.trim()) || "PENGELUARAN SC TEST",
            senderBank:form.paymentAccount || "SUMBER DANA TIDAK DIISI",
            receivingAccount:form.vendorName.trim() || "PENERIMA BELUM DIISI",
            method:form.paymentMethod || "Belum ditentukan",
            bankReference:form.bankReference.trim(),
            expenseKind,destinationBank:destinationBank.trim(),destinationAccount:destinationAccount.trim(),
            receiptUrls:form.receiptUrls,
            notes:`${form.notes.trim()}${Number(form.ppnAmount||0)>0
              ?` | Pokok Rp${rawAmount} + PPN Rp${form.ppnAmount}`:""}`,
            amount:gross
          });
          toast({title:`Pengeluaran TEST: ${result.testNo}`,
            description:result.sheetState==="synced"
              ?"Tercatat pada kolom D kas besar sc, tanpa mutasi atau jurnal BizPortal."
              :"Belum tersinkron; cek ledger Uji Kas Besar sebelum mengulangi."});
          await refetchFinanceTest();
          setFormOpen(false);setEditingId(null);setForm({...EMPTY_FORM});
          setExpenseTestEntryKey(crypto.randomUUID());setDestinationBank("");setDestinationAccount("");setExpenseKind("Transfer Bank");setProofEvidence(null);
        }catch(error:any){
          toast({title:"Gagal menyimpan Pengeluaran TEST",description:error.message,variant:"destructive"});
        }finally{setExpenseTestSaving(false);}
      })();
    } else {
      createMutation.mutate(body);
    }
  }

  const proofDifferences=proofEvidence?[
    proofEvidence.amount!=null&&Number(normalizeExpenseRupiahInput(form.amount))>0&&
      Number(normalizeExpenseRupiahInput(form.amount))!==proofEvidence.amount?"Nominal berbeda dari bukti":null,
    proofEvidence.date&&form.expenseDate&&proofEvidence.date!==form.expenseDate?"Tanggal berbeda dari bukti":null,
    proofEvidence.recipient&&form.vendorName.trim()&&
      proofEvidence.recipient.trim().toUpperCase()!==form.vendorName.trim().toUpperCase()?"Penerima berbeda dari bukti":null
  ].filter((x):x is string=>Boolean(x)):[];
  const totalNum = Number(normalizeExpenseRupiahInput(form.amount) || 0) + Number(form.ppnAmount || 0);

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Keuangan Sport Center</h1>
          <p className="text-gray-500 text-sm mt-0.5">Catatan pemasukan dan pengeluaran SC, terpisah dari rekonsiliasi BizPortal.</p>
          {FINANCE_SC_TEST_ONLY && <p className="mt-2 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-900">
            MODE TEST AKTIF — kedua tombol input mengirim ke ledger uji kas besar sc;
            tidak membuat transaksi operasional, mutasi BizPortal, atau jurnal.
          </p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3" role="tablist" aria-label="Jenis transaksi Sport Center">
          <button type="button" role="tab" aria-selected={financeSection === "income"}
            className={`rounded-xl border p-4 text-left transition-colors ${financeSection === "income" ? "bg-emerald-50 border-emerald-500 ring-1 ring-emerald-200" : "bg-white hover:bg-emerald-50"}`}
            onClick={() => setFinanceSection("income")}>
            <span className="flex gap-2 items-center font-semibold text-emerald-800">
              <Banknote className="h-5 w-5" /> Uang Masuk
            </span>
            <span className="block text-sm text-gray-600 mt-1">Input penerimaan, histori, dan status pengiriman Sheets</span>
          </button>
          <button type="button" role="tab" aria-selected={financeSection === "expenses"}
            className={`rounded-xl border p-4 text-left transition-colors ${financeSection === "expenses" ? "bg-orange-50 border-orange-500 ring-1 ring-orange-200" : "bg-white hover:bg-orange-50"}`}
            onClick={() => setFinanceSection("expenses")}>
            <span className="flex gap-2 items-center font-semibold text-orange-800">
              <TrendingDown className="h-5 w-5" /> Pengeluaran
            </span>
            <span className="block text-sm text-gray-600 mt-1">Input biaya, daftar pengeluaran, dan persetujuan</span>
          </button>
          <button type="button" role="tab" aria-selected={financeSection === "details"}
            className={`rounded-xl border p-4 text-left transition-colors ${financeSection === "details" ? "bg-blue-50 border-blue-500 ring-1 ring-blue-200" : "bg-white hover:bg-blue-50"}`}
            onClick={() => setFinanceSection("details")}>
            <span className="flex gap-2 items-center font-semibold text-blue-800">
              <Receipt className="h-5 w-5" /> Detail Transaksi
            </span>
            <span className="block text-sm text-gray-600 mt-1">Lihat seluruh pemasukan dan pengeluaran dalam satu tempat</span>
          </button>
          <button type="button" role="tab" aria-selected={financeSection==="test"}
            className={`rounded-xl border p-4 text-left transition-colors ${financeSection==="test"?"bg-violet-50 border-violet-500 ring-1 ring-violet-200":"bg-white hover:bg-violet-50"}`}
            onClick={()=>setFinanceSection("test")}>
            <span className="flex gap-2 items-center font-semibold text-violet-800">
              <Receipt className="h-5 w-5"/> Uji Kas Besar
            </span>
            <span className="block text-sm text-gray-600 mt-1">
              Pemasukan, pengeluaran, saldo uji. Tidak membuat jurnal.
            </span>
          </button>
        </div>
      </div>

      {financeSection === "income" ? (
        <section role="tabpanel" aria-label="Uang Masuk SC" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-emerald-900">Uang Masuk SC</h2>
              <p className="text-sm text-gray-500">Catatan penerimaan operasional. Tersinkron ke Sheets bukan berarti bank sudah terverifikasi.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => {
                setIncomeForm({
                  transactionDate: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" }),
                  sourceName: "", method: "Transfer Bank", bank: "", cashType:"", receivingAccount: "", bankReference: "", amount: "",
                });
                setIncomePreview(false);
                setCashReceiptConfirmed(false);
                setIncomeDuplicateWarning(false);
                setIncomeEntryKey(crypto.randomUUID());
                setIncomeOpen(true);
              }}>
                <Plus className="w-4 h-4 mr-2" /> {FINANCE_SC_TEST_ONLY?"Input Uang Masuk (TEST)":"Input Uang Masuk"}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-l-4 border-l-emerald-500">
              <CardContent className="p-4">
                <p className="text-sm font-medium text-gray-600">
                  {FINANCE_SC_TEST_ONLY?"Total Uang Masuk TEST Aktif":"Total Input Uang Masuk — Bulan Ini"}
                </p>
                <p className="text-2xl font-bold text-emerald-800 mt-1">
                  {FINANCE_SC_TEST_ONLY
                    ? financeTestReadError?"Tidak tersedia":financeTestData?formatIDR(financeTestData.summary.income):"Memuat..."
                    : incomeHistoryError ? "Tidak tersedia" : incomeData ? formatIDR(incomeData.summary.manualThisMonth) : "Memuat..."}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {FINANCE_SC_TEST_ONLY?"Hanya transaksi TEST yang masih ada di Sheets. Bukan kas resmi.":
                    "Dari register SC, belum tentu cocok dengan mutasi bank."}
                </p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-slate-400">
              <CardContent className="p-4">
                {FINANCE_SC_TEST_ONLY ? <>
                  <p className="text-sm font-medium text-gray-600">Selisih Bersih Transaksi TEST</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">
                    {financeTestReadError?"Tidak tersedia":financeTestData?formatIDR(financeTestData.summary.balance):"Memuat..."}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Pemasukan TEST − pengeluaran TEST, tanpa saldo awal historis. Saldo berjalan ada di Master Tabel.</p>
                </> : <>
                  <p className="text-sm font-medium text-gray-600">Mutasi Masuk Kas Besar CST — BizPortal</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">
                    {typeof summary.incomingThisMonth === "number" ? formatIDR(summary.incomingThisMonth) : "Belum tersedia"}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Sumber terpisah, baca saja; tidak ditambahkan ke total input SC.
                    {summary.incomingSheetSyncedAt && <> Sync terakhir {new Date(summary.incomingSheetSyncedAt).toLocaleString("id-ID", {timeZone:"Asia/Jakarta"})} WIB.</>}
                  </p>
                </>}
              </CardContent>
            </Card>
          </div>
          {FINANCE_SC_TEST_ONLY && <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Histori Uang Masuk (TEST) — {activeTestIncome.length}</CardTitle>
              <p className="text-xs text-gray-500">Termasuk histori yang dihapus dari Sheets, tetapi tidak dihitung dalam total.</p>
            </CardHeader>
            <CardContent>
              {financeTestReadError ? <p role="alert" className="text-red-700 text-sm">Ledger TEST gagal dibaca, jangan ulangi input sebelum memeriksa ID.</p> :
                !financeTestData ? <p className="text-sm text-gray-500">Memuat histori TEST...</p> :
                activeTestIncome.length===0 ? <p className="text-sm text-gray-500">Belum ada uang masuk TEST.</p> :
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b text-left">
                      <th className="p-2">ID</th><th className="p-2">Tanggal</th>
                      <th className="p-2">Pengirim / Bank</th><th className="p-2 text-right">Nominal</th>
                      <th className="p-2">Status Sheets</th>
                    </tr></thead>
                    <tbody>{activeTestIncome.map(x=><tr className="border-b" key={x.id}>
                      <td className="p-2 font-mono">{x.testNo}</td>
                      <td className="p-2">{x.transactionDate}</td>
                      <td className="p-2">{x.sourceName}<span className="block text-xs text-gray-500">{x.senderBank}</span></td>
                      <td className="p-2 text-right">{formatIDR(Number(x.amount))}</td>
                      <td className="p-2">{x.sheetSyncState==="synced"?`Baris ${x.sheetRow} — TEST`:
                        x.sheetSyncState==="removed"?"Dihapus dari Sheets":x.sheetSyncState}</td>
                    </tr>)}</tbody>
                  </table>
                </div>}
            </CardContent>
          </Card>}

        </section>
      ) : financeSection === "details" ? (
        <section role="tabpanel" aria-label="Detail Transaksi Keuangan SC" className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-blue-900">Detail Transaksi Keuangan SC</h2>
            <p className="text-sm text-gray-500">{FINANCE_SC_TEST_ONLY?
              "Riwayat gabungan transaksi TEST dari kas besar sc (tidak membuat mutasi atau jurnal).":
              "Riwayat gabungan baca-saja dari register Uang Masuk dan daftar Pengeluaran SC."}</p>
          </div>
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <div className="flex flex-wrap gap-2" role="group" aria-label="Filter jenis transaksi">
                  {([
                    ["all", "Semua"], ["income", "Uang Masuk"], ["expense", "Pengeluaran"],
                  ] as const).map(([kind, label]) => (
                    <Button key={kind} size="sm" variant={detailKind === kind ? "default" : "outline"}
                      onClick={() => {setDetailKind(kind);setMasterPage(1);setExpandedTransactionIds([]);}}>{label}</Button>
                  ))}
                </div>
                <Input aria-label="Cari transaksi keuangan" className="lg:ml-auto lg:max-w-sm"
                  placeholder="Cari ID, nama, bank, rekening atau referensi..."
                  value={unifiedSearch} onChange={e => {setUnifiedSearch(e.target.value);setMasterPage(1);}} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="finance-date-mode">Filter Tanggal</Label>
                  <Select value={transactionDateMode} onValueChange={v => {setTransactionDateMode(v as "all" | "single" | "range");setMasterPage(1);}}>
                    <SelectTrigger id="finance-date-mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua tanggal</SelectItem>
                      <SelectItem value="single">Tanggal tunggal</SelectItem>
                      <SelectItem value="range">Rentang tanggal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {transactionDateMode === "single" && (
                  <div className="space-y-1">
                    <Label htmlFor="finance-single-date">Tanggal transaksi</Label>
                    <Input id="finance-single-date" type="date" value={transactionSingleDate}
                      onChange={e => {setTransactionSingleDate(e.target.value);setMasterPage(1);}} />
                  </div>
                )}
                {transactionDateMode === "range" && (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor="finance-from-date">Dari tanggal</Label>
                      <Input id="finance-from-date" type="date" value={transactionDateFrom}
                        max={transactionDateTo || undefined}
                        onChange={e => {setTransactionDateFrom(e.target.value);setMasterPage(1);}} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="finance-to-date">Sampai tanggal</Label>
                      <Input id="finance-to-date" type="date" value={transactionDateTo}
                        min={transactionDateFrom || undefined}
                        onChange={e => {setTransactionDateTo(e.target.value);setMasterPage(1);}} />
                    </div>
                  </>
                )}
              </div>
              {transactionDateInvalid && <p role="alert" className="text-sm text-red-700">
                Tanggal awal tidak boleh lebih besar dari tanggal akhir.
              </p>}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-gray-500">
                  Menampilkan {masterVisibleStart}–{masterVisibleEnd} dari {visibleTransactions.length} transaksi
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor="master-page-size" className="text-xs">Baris</Label>
                  <Select value={String(masterPageSize)} onValueChange={v => {
                    setMasterPageSize(Number(v) as 20|50|100);
                    setMasterPage(1);setExpandedTransactionIds([]);
                  }}>
                    <SelectTrigger id="master-page-size" className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm"
                    onClick={() => setExpandedTransactionIds(paginatedTransactions.map(tx => tx.key))}>
                    Buka Semua
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setExpandedTransactionIds([])}>
                    Tutup Semua
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => {
                    setDetailKind("all");setUnifiedSearch("");
                    setTransactionDateMode("all");setTransactionSingleDate("");
                    setTransactionDateFrom("");setTransactionDateTo("");
                    setMasterPage(1);setExpandedTransactionIds([]);
                  }}>Reset Filter</Button>
                </div>
              </div>
            </CardContent>
          </Card>
          {(FINANCE_SC_TEST_ONLY?financeTestReadError:incomeHistoryError) && <p className="text-sm text-red-700">
            {FINANCE_SC_TEST_ONLY?"Ledger TEST gagal dibaca.":"Pemasukan belum berhasil dimuat; daftar gabungan mungkin tidak lengkap."}</p>}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Master Tabel Transaksi</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left border-b">
                      <th className="p-3">ID / Tanggal</th>
                      <th className="p-3">Nama / Jenis</th>
                      <th className="p-3 text-right">Masuk</th>
                      <th className="p-3 text-right">Keluar</th>
                      <th className="p-3 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedTransactions.map(tx => (
                      <Fragment key={tx.key}>
                        <tr role="button" tabIndex={0} aria-expanded={expandedTransactionIds.includes(tx.key)}
                          className={`cursor-pointer border-b hover:bg-blue-50 focus-visible:outline focus-visible:outline-blue-500 ${expandedTransactionIds.includes(tx.key) ? "bg-blue-50" : ""}`}
                          onClick={() => toggleExpandedTransaction(tx.key)}
                          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleExpandedTransaction(tx.key); } }}>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <ChevronsUpDown className="w-4 h-4 text-gray-500 shrink-0" />
                              <div><p className="font-mono font-semibold">{tx.id}</p>
                                <p className="text-xs text-gray-500">{tx.date}</p></div>
                            </div>
                          </td>
                          <td className="p-3"><p className="font-semibold">{tx.name}</p>
                            <p className={`text-xs ${tx.kind === "income" ? "text-emerald-700" : "text-orange-700"}`}>
                              {tx.kind === "income" ? "Uang Masuk" : "Pengeluaran"}
                            </p>
                            <p className="text-xs text-gray-500">{tx.status}</p>
                          </td>
                          <td className="p-3 text-right font-semibold tabular-nums text-emerald-700">
                            {tx.kind==="income"?tx.amount.toLocaleString("id-ID"):"0"}
                          </td>
                          <td className="p-3 text-right font-semibold tabular-nums text-orange-700">
                            {tx.kind==="expense"?tx.amount.toLocaleString("id-ID"):"0"}
                          </td>
                          <td className="p-3 text-right font-bold tabular-nums">
                            {FINANCE_SC_TEST_ONLY
                              ? tx.status==="TEST — Tersinkron" && tx.sheetBalance!=null
                                ? tx.sheetBalance.toLocaleString("id-ID",{minimumFractionDigits:0,maximumFractionDigits:2})
                                : "–"
                              : "–"}
                          </td>
                        </tr>
                        {expandedTransactionIds.includes(tx.key) && (
                          <tr className="bg-slate-50 border-b">
                            <td colSpan={5} className="p-4 sm:p-5">
                              <div className="space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="font-bold">Rincian {tx.kind === "income" ? "Pemasukan" : "Pengeluaran"} — {tx.id}</p>
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline">Baca saja</Badge>
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                  <Badge variant="outline">{tx.isTest?"TRANSAKSI TEST":"TRANSAKSI OPERASIONAL"}</Badge>
                                  <span className="text-slate-600">Status Sheets: <strong>{tx.isTest?tx.status.replace(/^TEST — /,""):tx.sheet}</strong></span>
                                  <span className="text-amber-700">Status verifikasi bank: <strong>Belum diverifikasi</strong></span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                  {(tx.kind==="income"?([
                                    ["Tanggal",tx.date],
                                    ["Pengirim",tx.name],
                                    ["Bank Pengirim",tx.bank||"Tidak diisi"],
                                    ["Metode",tx.method||"Tidak diisi"],
                                    ["Akun Penerima",tx.account||"Tidak diisi"],
                                    ["Referensi Bank",tx.reference||"Tidak diisi"],
                                    ["Lokasi Sheets",tx.sheet]
                                  ] as Array<[string,string]>):([
                                    ["Tanggal",tx.date],
                                    ["Penerima",tx.name],
                                    ["Jenis Pengeluaran",tx.expenseKind||"Tidak diisi"],
                                    ["Metode Pembayaran",tx.method||"Tidak diisi"],
                                    ["Sumber Dana",tx.bank||"Tidak diisi"],
                                    ["Bank Tujuan",tx.destinationBank||"Belum diisi"],
                                    ["Rekening Tujuan",tx.destinationAccount||"Belum diisi"],
                                    ["Referensi Bank",tx.reference||"Tidak diisi"],
                                    ["Lokasi Sheets",tx.sheet]
                                  ] as Array<[string,string]>)).map(([label,value])=>(
                                    <div key={label} className="space-y-1 min-w-0">
                                      <p className="text-xs text-slate-500">{label}</p>
                                      <p className="font-medium text-sm break-words">{value}</p>
                                    </div>
                                  ))}
                                </div>
                                <div className="space-y-1 min-w-0">
                                  <p className="text-xs text-slate-500">Keperluan / Keterangan</p>
                                  <p className="text-sm font-medium break-words">
                                    {presentTransactionNarrative(tx.description,tx.notes).primary}
                                  </p>
                                  {presentTransactionNarrative(tx.description,tx.notes).additional && (
                                    <div className="mt-3">
                                      <p className="text-xs text-slate-500">Catatan Tambahan</p>
                                      <p className="text-sm font-medium break-words">
                                        {presentTransactionNarrative(tx.description,tx.notes).additional}
                                      </p>
                                    </div>
                                  )}
                                </div>
                                {tx.kind==="expense"&&
                                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-3">
                                    <div>
                                      <p className="font-medium text-sm">Bukti Transfer / Nota</p>
                                      <p className="text-xs text-slate-500">{tx.receiptUrls.length>0
                                        ? tx.receiptUrls.length+" lampiran tersedia":"Belum ada bukti terlampir"}</p>
                                    </div>
                                    {tx.receiptUrls.length>0&&<Button type="button" variant="outline" size="sm"
                                      onClick={()=>setProofViewer({testNo:tx.id,urls:tx.receiptUrls,index:0})}>Lihat Bukti</Button>}
                                  </div>}
                                <div className="flex justify-end">
                                  <Button size="sm" variant="outline" onClick={() => toggleExpandedTransaction(tx.key)}>Tutup Rincian</Button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                {(FINANCE_SC_TEST_ONLY?!financeTestData&&!financeTestReadError:isLoading || incomeHistoryLoading) && !unifiedTransactions.length && <p className="text-sm text-gray-500 p-5">Memuat transaksi...</p>}
                {(FINANCE_SC_TEST_ONLY?Boolean(financeTestData):!isLoading && !incomeHistoryLoading) && !visibleTransactions.length && <p className="text-sm text-gray-500 p-5 text-center">Tidak ada transaksi yang sesuai filter.</p>}
              </div>
              <div className="flex items-center justify-between gap-2 border-t p-3 text-sm">
                <span className="text-gray-500">
                  {masterVisibleStart}–{masterVisibleEnd} / {visibleTransactions.length}
                </span>
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" variant="outline"
                    disabled={effectiveMasterPage<=1}
                    onClick={()=>{setMasterPage(Math.max(1,effectiveMasterPage-1));setExpandedTransactionIds([]);}}>
                    Sebelumnya
                  </Button>
                  <span className="tabular-nums">{effectiveMasterPage} / {masterPageCount}</span>
                  <Button type="button" size="sm" variant="outline"
                    disabled={effectiveMasterPage>=masterPageCount}
                    onClick={()=>{setMasterPage(Math.min(masterPageCount,effectiveMasterPage+1));setExpandedTransactionIds([]);}}>
                    Berikutnya
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : financeSection==="test" ? (
        <section role="tabpanel" aria-label="Uji Kas Besar SC" className="space-y-4">
          <div className="rounded-xl border border-violet-300 bg-violet-50 p-4">
            <h2 className="text-lg font-bold text-violet-900">Mode Uji Kas Besar SC</h2>
            <p className="text-sm text-violet-900">
              Semua angka di sini adalah simulasi, bukan transaksi riil.
              Tidak menambah mutasi BizPortal, jurnal, atau saldo resmi.
              Pengiriman Sheets tetap OFF sampai guard BizPortal dan konfigurasi diverifikasi.
            </p>
          </div>
          {financeTestReadError && <p className="text-red-700 text-sm">Akses ledger uji memerlukan Super Admin dan migrasi database yang sudah terpasang.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="border-l-4 border-emerald-500"><CardContent className="p-4">
              <p className="text-xs text-gray-600">Uang Masuk Uji — tersinkron</p>
              <p className="text-xl font-bold text-emerald-700">{formatIDR(financeTestData?.summary.income??0)}</p>
            </CardContent></Card>
            <Card className="border-l-4 border-orange-500"><CardContent className="p-4">
              <p className="text-xs text-gray-600">Pengeluaran Uji — tersinkron</p>
              <p className="text-xl font-bold text-orange-700">{formatIDR(financeTestData?.summary.expense??0)}</p>
            </CardContent></Card>
            <Card className="border-l-4 border-violet-500"><CardContent className="p-4">
              <p className="text-xs text-gray-600">Selisih Bersih Uji (tanpa saldo awal historis)</p>
              <p className="text-xl font-bold">{formatIDR(financeTestData?.summary.balance??0)}</p>
            </CardContent></Card>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Input Transaksi Uji</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={event=>{event.preventDefault();void saveFinanceTest();}} className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant={testDirection==="IN"?"default":"outline"}
                    onClick={()=>setTestDirection("IN")}>Uang Masuk (TEST)</Button>
                  <Button type="button" variant={testDirection==="OUT"?"default":"outline"}
                    onClick={()=>setTestDirection("OUT")}>Pengeluaran (TEST)</Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="test-date">Tanggal</Label>
                    <Input id="test-date" type="date" required value={testForm.transactionDate}
                      onChange={e=>setTestForm({...testForm,transactionDate:e.target.value})}/>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="test-name">{testDirection==="IN"?"Pengirim":"Penerima"}</Label>
                    <Input id="test-name" required value={testForm.sourceName}
                      onChange={e=>setTestForm({...testForm,sourceName:e.target.value})}/>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="test-bank">Bank / Sumber Dana</Label>
                    <Input id="test-bank" value={testForm.senderBank}
                      onChange={e=>setTestForm({...testForm,senderBank:e.target.value})}/>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="test-account">Akun tujuan / Rekening</Label>
                    <Input id="test-account" value={testForm.receivingAccount}
                      onChange={e=>setTestForm({...testForm,receivingAccount:e.target.value})}/>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="test-method">Metode</Label>
                    <Input id="test-method" value={testForm.method}
                      onChange={e=>setTestForm({...testForm,method:e.target.value})}/>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="test-amount">Nominal Uji (Rp, maksimum 1 juta)</Label>
                    <Input id="test-amount" required inputMode="numeric"
                      value={formatExpenseRupiahInput(testForm.amount)}
                      onChange={e=>setTestForm({...testForm,amount:normalizeExpenseRupiahInput(e.target.value)})}/>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="test-reference">Referensi Uji</Label>
                    <Input id="test-reference" value={testForm.bankReference}
                      onChange={e=>setTestForm({...testForm,bankReference:e.target.value})}/>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="test-note">Keterangan</Label>
                    <Input id="test-note" value={testForm.notes}
                      onChange={e=>setTestForm({...testForm,notes:e.target.value})}/>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-xs text-gray-600">
                    {financeTestData?.writeEnabled?"Penulisan uji diaktifkan (guard tetap diperiksa).":"Pengiriman Sheets masih nonaktif."}
                  </p>
                  <Button type="submit" disabled={testSaving || !testForm.sourceName.trim()
                    || Number(testForm.amount)<=0 || Number(testForm.amount)>1000000}>
                    {testSaving?"Menyimpan...":"Simpan Transaksi Uji"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Ledger Uji ({financeTestData?.summary.count??0})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-gray-600">
                  Saldo uji = total masuk yang masih ada di Sheets - total keluar yang masih ada di Sheets.
                  Baris belum sinkron atau sudah dihapus tidak dihitung.
                </p>
                <Button type="button" size="sm" variant="outline"
                  onClick={()=>void reconcileFinanceTestRows()}>
                  Periksa Ulang Sheets
                </Button>
              </div>
              <p className="text-xs text-gray-600">Belum tersinkron: {financeTestData?.summary.pending??0}.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left">
                    <th className="p-2">ID Uji</th><th className="p-2">Tanggal</th>
                    <th className="p-2">Nama / Jenis</th><th className="p-2 text-right">Nominal</th>
                    <th className="p-2">Status Sheets</th><th className="p-2">Aksi</th>
                  </tr></thead>
                  <tbody>{(financeTestData?.entries??[]).map(x=>(
                    <tr key={x.id} className="border-b">
                      <td className="p-2 font-mono">{x.testNo}</td>
                      <td className="p-2">{x.transactionDate}</td>
                      <td className="p-2">{x.sourceName}<span className="block text-xs text-gray-500">
                        {x.direction==="IN"?"Pemasukan Uji":"Pengeluaran Uji"}</span></td>
                      <td className="p-2 text-right whitespace-nowrap">{x.direction==="IN"?"+":"−"}{formatIDR(Number(x.amount))}</td>
                      <td className="p-2">{x.sheetSyncState==="synced"?`Baris ${x.sheetRow}`:
                        x.sheetSyncState==="removed"?"Dihapus dari Sheets":
                        x.sheetSyncState==="mismatch"?"Data Sheets tidak cocok":x.sheetSyncState}
                        {x.sheetVerifiedAt && <span className="block text-xs text-gray-500">
                          Diperiksa {new Date(x.sheetVerifiedAt).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})} WIB
                        </span>}</td>
                      <td className="p-2">{["pending","failed"].includes(x.sheetSyncState) &&
                        <Button type="button" size="sm" variant="outline" onClick={()=>void retryFinanceTestRow(x.id)}>
                          Coba kirim
                        </Button>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : (
        <section role="tabpanel" aria-label="Pengeluaran SC" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-orange-800">Pengeluaran SC</h2>
              <p className="text-sm text-gray-500">Catatan biaya operasional dan alur persetujuan pengeluaran.</p>
            </div>
            <Button onClick={openCreate} className="bg-orange-500 hover:bg-orange-600 text-white font-bold">
              <Plus className="w-4 h-4 mr-2" /> {FINANCE_SC_TEST_ONLY?"Tambah Pengeluaran (TEST)":"Tambah Pengeluaran"}
            </Button>
          </div>
          <Card className="border-l-4 border-l-orange-500">
            <CardContent className="p-4">
              <p className="text-sm font-medium text-gray-600">{FINANCE_SC_TEST_ONLY?"Total Pengeluaran TEST Aktif":"Pengeluaran Bulan Ini"}</p>
              <p className="text-2xl font-bold text-orange-800 mt-1">
                {FINANCE_SC_TEST_ONLY
                  ? financeTestReadError?"Tidak tersedia":financeTestData?formatIDR(financeTestData.summary.expense):"Memuat..."
                  : formatIDR(summary.totalThisMonth)}
              </p>
              <p className="text-xs text-gray-500 mt-1">{FINANCE_SC_TEST_ONLY?
                "Hanya pengeluaran uji yang masih ada di Sheets; bukan pengeluaran resmi.":
                "Catatan operasional SC; berbeda dari mutasi bank BizPortal."}</p>
            </CardContent>
          </Card>
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Cari pengeluaran, cari nama, nomor ref..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[150px]" />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[150px]" />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold">
            {FINANCE_SC_TEST_ONLY?"Histori Pengeluaran (TEST)":"Daftar Pengeluaran"} <span className="text-gray-400 font-normal">({FINANCE_SC_TEST_ONLY?visibleTestExpenses.length:filtered.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {FINANCE_SC_TEST_ONLY ? (
            financeTestReadError ?
              <p role="alert" className="p-5 text-sm text-red-700">Ledger TEST gagal dibaca. Periksa transaksi sebelum input ulang.</p>
              : !financeTestData ? <p className="p-5 text-gray-500 text-sm">Memuat histori TEST...</p> :
              visibleTestExpenses.length===0 ? <p className="p-6 text-center text-gray-500">Belum ada pengeluaran TEST sesuai filter.</p> :
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="bg-gray-50"><tr className="border-b text-left">
                  <th className="p-3">ID / Tanggal</th><th className="p-3">Penerima / Sumber</th>
                  <th className="p-3 text-right">Nominal</th><th className="p-3">Status Sheets</th>
                </tr></thead>
                <tbody>{visibleTestExpenses.map(x=><tr key={x.id} className="border-b">
                  <td className="p-3 font-mono">{x.testNo}<span className="block text-xs text-gray-500">{x.transactionDate}</span></td>
                  <td className="p-3">{x.sourceName}<span className="block text-xs text-gray-500">{x.senderBank}</span>
                    {Array.isArray(x.receiptUrls) && x.receiptUrls.length>0 &&
                      <span className="block text-xs mt-1">
                        <button type="button"
                          onClick={()=>setProofViewer({testNo:x.testNo,urls:x.receiptUrls??[],index:0})}
                          className="text-blue-700 underline">Lihat Bukti ({x.receiptUrls.length} lampiran)</button>
                      </span>}
                  </td>
                  <td className="p-3 text-right">{formatIDR(Number(x.amount))}</td>
                  <td className="p-3">{x.sheetSyncState==="synced"?`Baris ${x.sheetRow} — TEST`:
                    x.sheetSyncState==="removed"?"Dihapus dari Sheets":x.sheetSyncState}</td>
                </tr>)}</tbody>
              </table></div>
          ) : isLoading ? (
            <div className="p-8 text-center text-gray-400">Memuat data...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-400">Belum ada pengeluaran</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">No. Pengeluaran</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Tanggal</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Kategori Internal</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Deskripsi</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Vendor</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600">Total</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-600">Status</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-600">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((expense: any) => (
                    <tr key={expense.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs font-bold text-orange-600">{expense.expenseNo}</td>
                      <td className="px-4 py-3 text-gray-700">{expense.expenseDate}</td>
                      <td className="px-4 py-3">
                        {expense.coaAccount ? (
                          <div>
                            <p className="font-semibold text-xs text-gray-900">
                              {expense.coaAccount.code} — {expense.coaAccount.name}
                            </p>
                            <Badge className={`text-[10px] mt-0.5 ${ACCOUNT_TYPE_COLORS[expense.coaAccount.accountType] ?? "bg-gray-100 text-gray-600"}`}>
                              {ACCOUNT_TYPE_LABELS[expense.coaAccount.accountType] ?? expense.coaAccount.accountType}
                            </Badge>
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-xs">{expense.category}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-[200px] truncate text-gray-700">{expense.description}</td>
                      <td className="px-4 py-3 text-gray-500">{expense.vendorName ?? "-"}</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900">{formatIDR(expense.totalAmount)}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={`text-xs ${STATUS_COLORS[expense.paymentStatus]}`}>
                          {STATUS_LABELS[expense.paymentStatus]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 w-7 p-0 text-gray-400 hover:text-gray-600"
                            onClick={() => { setSheetCheckId(null); setDetailId(expense.id); setDetailOpen(true); }}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 w-7 p-0 text-blue-400 hover:text-blue-600"
                            onClick={() => openEdit(expense)}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                          {expense.paymentStatus === "draft" && (
                            <>
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 px-2 text-xs text-yellow-600 hover:text-yellow-700"
                                onClick={() => statusMutation.mutate({ id: expense.id, action: "submit" })}
                              >
                                Ajukan
                              </Button>
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                                title="Hapus"
                                onClick={() => { setDeleteConfirmId(expense.id); setDeleteConfirmNo(expense.expenseNo); }}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                          {expense.paymentStatus === "pending_approval" && (
                            <>
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 w-7 p-0 text-green-500 hover:text-green-700"
                                onClick={() => statusMutation.mutate({ id: expense.id, action: "approve" })}
                                title="Approve"
                              >
                                <ThumbsUp className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                                onClick={() => { setRejectTargetId(expense.id); setRejectOpen(true); }}
                                title="Reject"
                              >
                                <ThumbsDown className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                          {expense.paymentStatus === "approved" && (
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 px-2 text-xs text-green-600 hover:text-green-800"
                              onClick={() => statusMutation.mutate({ id: expense.id, action: "pay" })}
                            >
                              <Banknote className="w-3 h-3 mr-1" />
                              Bayar
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

        </section>
      )}

      {/* Incoming funds: save to SC operational register, not bank movements. */}
      {/* Historical receipts remain accessible without restoring the removed inline register. */}
      <Dialog open={incomeHistoryOpen} onOpenChange={setIncomeHistoryOpen}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Histori Uang Masuk SC</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            Pencatatan operasional, bukan mutasi bank terverifikasi. Status Tersinkron
            berarti tercatat pada tab SC Uang Masuk, bukan pada tab kas besar sc.
          </p>
          {incomeHistoryLoading && !incomeData ? <p>Memuat histori...</p> :
            incomeHistoryError ? <p className="text-red-700">Histori gagal dibaca. Data lama tidak dihapus.</p> :
            !incomeData?.entries.length ? <p>Belum ada histori Uang Masuk.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left">
                    <th className="p-2">ID Pemasukan</th><th className="p-2">Tanggal</th>
                    <th className="p-2">Pengirim / Bank</th><th className="p-2">Akun Penerima</th>
                    <th className="p-2">Nominal</th><th className="p-2">Status Sheets</th><th className="p-2">Kas Besar SC</th>
                  </tr></thead>
                  <tbody>{incomeData.entries.map((entry) => (
                    <tr key={entry.id} className="border-b">
                      <td className="p-2 font-mono">{entry.incomeNo}</td>
                      <td className="p-2">{entry.transactionDate}</td>
                      <td className="p-2">{entry.sourceName}<span className="block text-xs text-gray-500">{entry.senderBank}</span></td>
                      <td className="p-2">{entry.receivingAccount}</td>
                      <td className="p-2">{formatIDR(Number(entry.amount))}</td>
                      <td className="p-2">{entry.sheetSyncState === "synced" ? "Tersinkron — belum terverifikasi" : entry.sheetSyncState}</td>
                      <td className="p-2">
                        {entry.cashSheetState === "not_applicable" ? "Bukan transaksi kas" :
                          entry.cashSheetState === "synced" ? `Baris ${entry.cashSheetRow}` : entry.cashSheetState}
                        {(entry.cashSheetState === "pending" || entry.cashSheetState === "failed") &&
                          <Button size="sm" variant="outline" onClick={() => retryCashLedger(entry.id)}>
                            Coba sinkron kas
                          </Button>}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          <p className="text-xs text-gray-500">ID pemasukan tetap sama pada database dan respons API; tidak membuat jurnal atau payment.</p>
        </DialogContent>
      </Dialog>

      <Dialog open={incomeOpen} onOpenChange={(open) => {
        setIncomeOpen(open);
        if (!open) setIncomePreview(false);
      }}>
        <DialogContent className="w-[min(94vw,540px)] max-w-[540px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-black">{FINANCE_SC_TEST_ONLY?"Input Uang Masuk (TEST)":"Input Uang Masuk"}</DialogTitle>
          </DialogHeader>
          {FINANCE_SC_TEST_ONLY ?
            <p className="rounded-lg border border-violet-300 bg-violet-50 p-3 text-sm text-violet-900">
              SIMULASI SAJA. Setelah disimpan, nilai masuk ke kolom C tab kas besar sc
              dengan penanda SC_TEST_ONLY. Tidak membuat mutasi BizPortal, jurnal, atau saldo resmi.
              Maksimum Rp1.000.000 per transaksi uji.
            </p> :
            <p className="text-sm text-gray-500">
              Catat pemasukan operasional. Setelah disimpan, data tetap belum terverifikasi bank.
              Pencocokan mutasi dan jurnal tetap melalui BizPortal.
            </p>}
          <form className="space-y-4 pt-1" onSubmit={(event) => {
            event.preventDefault();
            setIncomePreview(true);
          }}>
            <div className="space-y-1.5">
              <Label htmlFor="income-date">Tanggal <span className="text-red-500">*</span></Label>
              <Input id="income-date" type="date" required value={incomeForm.transactionDate}
                onChange={(e) => { setIncomeForm({ ...incomeForm, transactionDate: e.target.value }); setIncomePreview(false); }} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="income-source">Dana Masuk (Dari) <span className="text-red-500">*</span></Label>
              <IncomeDropdown
                id="income-source"
                value={incomeForm.sourceName}
                options={INCOME_SOURCE_OPTIONS}
                placeholder="Pilih pengirim dana"
                otherPlaceholder="Ketik nama pengirim atau perusahaan"
                required
                onChange={(value) => { setIncomeForm({ ...incomeForm, sourceName: value }); setIncomePreview(false); }}
              />
              <p className="text-xs text-gray-500">Contoh dari kas besar sc. Nama lain boleh diketik manual.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="income-bank">Bank Pengirim <span className="text-red-500">*</span></Label>
              <IncomeDropdown
                id="income-bank"
                value={incomeForm.bank}
                options={INCOME_BANK_OPTIONS}
                placeholder="Pilih bank pengirim"
                otherPlaceholder="Ketik bank pengirim"
                required
                onChange={(value) => { setIncomeForm({ ...incomeForm, bank: value }); setIncomePreview(false); }}
              />
              <p className="text-xs text-gray-500">Bank asal dana. Berbeda dengan bank atau akun penerima.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="income-cash-type">Kas (opsional)</Label>
              <Select value={incomeForm.cashType||"none"} onValueChange={value=>{
                setIncomeForm({...incomeForm,cashType:value==="none"?"":value});
                setIncomePreview(false);
              }}>
                <SelectTrigger id="income-cash-type"><SelectValue placeholder="Kosong / tidak dipilih"/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Kosong / tidak dipilih</SelectItem>
                  <SelectItem value="kas kecil">kas kecil</SelectItem>
                  <SelectItem value="kas besar">kas besar</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">Jika dipilih, dicatat di keterangan antara bank pengirim dan akun penerima.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Metode <span className="text-red-500">*</span></Label>
              <Select value={incomeForm.method} onValueChange={(value) => {
                setIncomeForm({ ...incomeForm, method: value }); setIncomePreview(false);
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Transfer Bank">Transfer Bank</SelectItem>
                  <SelectItem value="Tunai">Tunai</SelectItem>
                  <SelectItem value="QRIS">QRIS</SelectItem>
                  <SelectItem value="Lainnya">Lainnya</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="income-receiving-account">
                Bank / Akun Penerima {incomeForm.method === "Transfer Bank" ? <span className="text-red-500">*</span> : "(opsional)"}
              </Label>
              <IncomeDropdown
                id="income-receiving-account"
                value={incomeForm.receivingAccount}
                options={INCOME_BANK_OPTIONS}
                placeholder="Pilih bank atau akun penerima"
                otherPlaceholder="Ketik bank atau akun penerima"
                required={incomeForm.method === "Transfer Bank"}
                onChange={(value) => {
                  setIncomeForm({ ...incomeForm, receivingAccount: value });
                  setIncomePreview(false);
                }}
              />
              <p className="text-xs text-gray-500">Bank atau akun tujuan uang masuk. Pencocokan mutasi dilakukan terpisah.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="income-reference">Nomor Referensi Bank (opsional)</Label>
              <Input id="income-reference" maxLength={120} placeholder="Nomor referensi pada bukti transfer"
                value={incomeForm.bankReference} onChange={(event) => {
                  setIncomeForm({ ...incomeForm, bankReference: event.target.value });
                  setIncomePreview(false);
                }} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="income-amount">Nominal (Rp) <span className="text-red-500">*</span></Label>
              <Input id="income-amount" type="text" inputMode="numeric" required
                placeholder="Contoh: 500.000"
                value={formatExpenseRupiahInput(incomeForm.amount)}
                onChange={(e) => {
                  setIncomeForm({ ...incomeForm, amount: normalizeExpenseRupiahInput(e.target.value) });
                  setIncomePreview(false);
                }} />
            </div>
            {!FINANCE_SC_TEST_ONLY && incomeForm.method === "Tunai" && incomeForm.receivingAccount === "Kas Besar SC" && (
              <label className="flex gap-2 items-start text-sm rounded border p-3">
                <input type="checkbox" checked={cashReceiptConfirmed}
                  onChange={(e) => { setCashReceiptConfirmed(e.target.checked); setIncomePreview(false); }} />
                <span>Saya memastikan kas tunai benar-benar telah diterima. Kirim data ke
                  <strong> kas besar sc</strong> hanya jika pengiriman kas diaktifkan.
                  Pencatatan ini akan masuk alur matching BizPortal; tidak mengisi saldo secara otomatis.</span>
              </label>
            )}
            {incomePreview && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm space-y-1">
                <p className="font-semibold text-emerald-800">Periksa Uang Masuk sebelum disimpan</p>
                <p className="text-xs text-emerald-800">ID unik pemasukan diterbitkan setelah penyimpanan berhasil.</p>
                <p>{incomeForm.transactionDate} · {incomeForm.sourceName.trim()}</p>
                <p>{incomeForm.method}{incomeForm.bank.trim() ? ` · ${incomeForm.bank.trim()}` : ""}</p>
                <p>Kas: {incomeForm.cashType||"Tidak dipilih"}</p>
                <p>Bank / Akun Penerima: {incomeForm.receivingAccount.trim() || "Tidak ditentukan"}</p>
                {incomeForm.bankReference.trim() && <p>Referensi bank: {incomeForm.bankReference.trim()}</p>}
                <p className="font-bold">{formatIDR(Number(incomeForm.amount || 0))}</p>
              </div>
            )}
            {incomeDuplicateWarning && (
              <div className="rounded-md border border-amber-300 p-3 text-sm space-y-2">
                <p className="font-semibold">Ditemukan pencatatan Uang Masuk yang sangat mirip.</p>
                <p>Jika ini transaksi berbeda dengan tanggal, bank, pengirim, dan nominal sama, periksa bukti lalu konfirmasi. Jika duplikat, batalkan.</p>
                <Button type="button" variant="outline" disabled={incomeSaving} onClick={() => saveIncome(true)}>
                  Tetap Simpan — Transaksi Berbeda
                </Button>
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setIncomeOpen(false)}>Batal</Button>
              <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={!incomeForm.transactionDate || !incomeForm.sourceName.trim() ||
                  !incomeForm.bank.trim() ||
                  (incomeForm.method === "Transfer Bank" && !incomeForm.receivingAccount.trim()) ||
                  Number(incomeForm.amount) <= 0 ||
                  (!FINANCE_SC_TEST_ONLY && incomeForm.method === "Tunai" && incomeForm.receivingAccount === "Kas Besar SC" && !cashReceiptConfirmed) ||
                  (FINANCE_SC_TEST_ONLY && Number(incomeForm.amount)>1000000)}>
                Pratinjau Input
              </Button>
              {incomePreview && (
                <Button type="button" disabled={incomeSaving} onClick={() => saveIncome()}
                  className="bg-emerald-700 text-white hover:bg-emerald-800">
                  {incomeSaving ? "Menyimpan..." : FINANCE_SC_TEST_ONLY?"Simpan Uang Masuk (TEST)":"Simpan Uang Masuk"}
                </Button>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(proofViewer)} onOpenChange={open=>{if(!open)setProofViewer(null);}}>
        <DialogContent className="w-[min(96vw,880px)] max-w-[880px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bukti Pengeluaran — {proofViewer?.testNo}</DialogTitle>
          </DialogHeader>
          {proofViewer && proofViewer.urls.length>0 && <>
            <p className="text-sm text-slate-600">
              {proofViewer.urls.length} lampiran pada satu transaksi. Bukti ini belum merupakan verifikasi bank.
            </p>
            <div className="rounded-lg border bg-slate-50 p-2 sm:p-3">
              <img
                src={proofViewer.urls[proofViewer.index]}
                alt={`Bukti pengeluaran ${proofViewer.index+1} dari ${proofViewer.urls.length}`}
                className="mx-auto max-h-[48vh] w-full object-contain"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="outline" size="sm" disabled={proofViewer.index===0}
                onClick={()=>setProofViewer(v=>v?{...v,index:Math.max(0,v.index-1)}:null)}>Sebelumnya</Button>
              <span className="text-sm tabular-nums">Bukti {proofViewer.index+1} dari {proofViewer.urls.length}</span>
              <Button type="button" variant="outline" size="sm" disabled={proofViewer.index===proofViewer.urls.length-1}
                onClick={()=>setProofViewer(v=>v?{...v,index:Math.min(v.urls.length-1,v.index+1)}:null)}>Berikutnya</Button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" aria-label="Daftar lampiran pengeluaran">
              {proofViewer.urls.map((url,index)=>(
                <button type="button" key={url+"-"+index}
                  aria-label={`Lihat bukti ${index+1}`}
                  aria-pressed={proofViewer.index===index}
                  onClick={()=>setProofViewer(v=>v?{...v,index}:null)}
                  className={`overflow-hidden rounded-lg border-2 bg-white text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${proofViewer.index===index?"border-blue-600":"border-slate-200 hover:border-slate-400"}`}>
                  <img src={url} alt={`Pratinjau bukti ${index+1}`} loading="lazy"
                    className="h-28 sm:h-36 w-full object-contain bg-slate-50"/>
                  <div className="px-2 py-1.5 text-xs font-medium">Bukti {index+1}</div>
                </button>
              ))}
            </div>
          </>}
        </DialogContent>
      </Dialog>
      {/* Form Dialog */}
      <Dialog open={formOpen} onOpenChange={(o) => { if (!o) { setFormOpen(false); setEditingId(null); setForm({ ...EMPTY_FORM }); } }}>
        <DialogContent className="w-[min(94vw,860px)] max-w-[860px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-black">{editingId ? "Edit Pengeluaran" : FINANCE_SC_TEST_ONLY ? "Tambah Pengeluaran (TEST)" : "Tambah Pengeluaran"}</DialogTitle>
          </DialogHeader>
          {FINANCE_SC_TEST_ONLY && !editingId ?
            <div className="rounded-lg border border-violet-300 bg-violet-50 p-3 text-sm text-violet-900">
              <p className="font-semibold">Pengeluaran Simulasi — Kas Besar SC</p>
              <p className="mt-1">Nominal dasar + PPN masuk ke kolom D tab kas besar sc
                dengan status SC_TEST_ONLY; tidak membuat jurnal, mutasi BizPortal, atau saldo resmi.
                Maksimum Rp1.000.000 termasuk PPN per transaksi.</p>
            </div> :
            <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
              <p className="font-semibold">Pencatatan Pengeluaran Sport Center</p>
              <p className="mt-1">Catat transaksi yang sudah dilakukan. Catatan tujuan wajib; bukti dapat dilampirkan untuk membantu pencocokan mutasi.</p>
            </div>}
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Bukti Pembayaran / Nota / Struk <span className="text-gray-400 font-normal text-xs">(bisa lebih dari 1, opsional)</span></Label>
              <p className="text-xs text-gray-500">Boleh unggah bukti dulu, lalu isi formulir. Periksa hasil pembacaan sebelum menyimpan.</p>
              <label className="flex items-start gap-2 text-xs text-gray-700">
                <input type="checkbox" checked={autoReadProof} onChange={(e) => setAutoReadProof(e.target.checked)} className="mt-0.5" />
                <span>Isi otomatis dari bukti (opsional, memerlukan persetujuan pemrosesan AI). Admin tetap memeriksa hasilnya.</span>
              </label>
              {scanningProof && <p className="text-xs text-teal-700">Membaca bukti pembayaran untuk saran isian...</p>}
              {proofReadMessage && (
                <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
                  <p>{proofReadMessage}</p>
                  {lastProofFileRef.current && autoReadProof && !scanningProof &&
                    <Button type="button" variant="outline" size="sm"
                      onClick={()=>{const file=lastProofFileRef.current;if(file)void previewExpenseProof(file);}}>
                      Coba Baca Lagi (tanpa unggah ulang)
                    </Button>}
                </div>
              )}
              {proofPreview && (
                <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 space-y-2 text-sm">
                  <p className="font-semibold text-teal-900">Pratinjau bukti (belum terverifikasi bank)</p>
                  <p className="text-xs text-teal-800">Pilih hanya data OCR yang ingin diterapkan. Semua hasil belum terverifikasi bank.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {([
                      ["amount","Nominal",proofPreview.amount==null?null:formatIDR(proofPreview.amount)],
                      ["date","Tanggal",proofPreview.date],
                      ["recipient","Penerima",proofPreview.recipient],
                      ["bankReference","Referensi blu",proofPreview.bankReference],
                      ["paymentMethod","Metode",proofPreview.paymentMethod==="unknown"?null:proofPreview.paymentMethod],
                      ["notes","Catatan",proofPreview.notes],
                      ["destinationBank","Bank tujuan",proofPreview.destinationBank],
                      ["destinationAccount","Rekening tujuan",proofPreview.destinationAccount
                        ? "•••• "+proofPreview.destinationAccount.slice(-4):null],
                      ["sourceBank","Sumber dana",proofPreview.sourceBank]
                    ] as Array<[keyof typeof proofSelection,string,string|null|undefined]>).map(([key,label,value])=>(
                      <label key={key} className="flex items-start gap-2 rounded border border-teal-200 bg-white p-2">
                        <input type="checkbox" disabled={!value} checked={Boolean(value)&&proofSelection[key]}
                          onChange={e=>setProofSelection(prev=>({...prev,[key]:e.target.checked}))}/>
                        <span><strong>{label}:</strong> {value||"Tidak terbaca"}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={applyProofPreview}>Terapkan saran ke form</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setProofPreview(null)}>Abaikan</Button>
                  </div>
                </div>
              )}
              <input
                ref={receiptInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/heic"
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files?.length) handleReceiptUpload(e.target.files); e.target.value = ""; }}
              />
              {form.receiptUrls.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {form.receiptUrls.map((url, idx) => (
                    <div key={idx} className="relative border rounded-lg overflow-hidden bg-gray-50 aspect-square">
                      <img
                        src={url}
                        alt={`Nota ${idx + 1}`}
                        className="w-full h-full object-cover bg-white"
                        onError={(e) => { (e.target as HTMLImageElement).src = ""; }}
                      />
                      <button
                        type="button"
                        className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow"
                        onClick={() => removeReceiptUrl(idx)}
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-[10px] px-1 py-0.5 text-center truncate">
                        Foto {idx + 1}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => receiptInputRef.current?.click()}
                disabled={uploadingReceipt}
                className="w-full border-2 border-dashed border-gray-200 rounded-lg p-4 flex flex-col items-center gap-2 text-gray-400 hover:border-orange-300 hover:text-orange-500 transition-colors disabled:opacity-60 cursor-pointer"
              >
                {uploadingReceipt ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                    <span className="text-sm font-medium text-orange-500">Mengupload...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5" />
                    <span className="text-sm font-medium">{form.receiptUrls.length > 0 ? "Tambah foto lagi" : "Unggah bukti dari blu atau foto nota"}</span>
                    <span className="text-xs">JPG, PNG, WebP — maks 10 MB per foto</span>
                  </>
                )}
              </button>
            </div>



            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Tanggal transaksi <span className="text-red-500">*</span></Label>
                <Input type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} required />
              </div>
              <div className="space-y-1">
                <Label>Nominal (Rp) <span className="text-red-500">*</span></Label>
                <Input type="text" inputMode="numeric" value={formatExpenseRupiahInput(form.amount)}
                  onChange={(e) => setForm({ ...form, amount: normalizeExpenseRupiahInput(e.target.value) })}
                  placeholder="Contoh: 100.000" required />
                <p className="text-xs text-gray-500">Rupiah tanpa desimal — contoh 1.000, 2.500, 10.000, 100.000.</p>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Catatan / Tujuan Pengeluaran <span className="text-red-500">*</span></Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Contoh: Reimburse pengisian daya kendaraan operasional" rows={3} minLength={3} required />
              <p className="text-xs text-gray-500">Jelaskan kegunaan dana. Untuk kasbon atau talangan, tuliskan secara jelas agar tidak dianggap beban biasa.</p>
            </div>
            <div className="space-y-1 relative">
              <Label>Penerima Pembayaran (opsional)</Label>
              <Input value={form.vendorName} onFocus={() => setRecipientFocused(true)}
                onBlur={() => window.setTimeout(() => setRecipientFocused(false), 150)}
                onChange={(e) => setForm({ ...form, vendorName: e.target.value, vendorId: "" })}
                placeholder="Ketik nama karyawan, toko, PLN, atau penerima lainnya" autoComplete="off" />
              {recipientFocused && form.vendorName.trim().length > 0 && recipientSuggestions.length > 0 && (
                <div className="absolute z-20 left-0 right-0 top-full mt-1 rounded-md border bg-white shadow-md max-h-48 overflow-y-auto">
                  {recipientSuggestions.map((entry) => (
                    <button key={entry.key} type="button"
                      className="w-full text-left px-3 py-2 hover:bg-orange-50 text-sm flex justify-between gap-2"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => { setForm({ ...form, vendorName: entry.name, vendorId: entry.vendorId }); setRecipientFocused(false); }}>
                      <span>{entry.name}</span><span className="text-gray-400 text-xs">{entry.kind}</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-500">Boleh pilih dari karyawan/vendor atau gunakan teks sendiri, tanpa membuat master baru.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Metode Pembayaran</Label>
                <Select value={form.paymentMethod || "none"} onValueChange={(v) => setForm({ ...form, paymentMethod: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Pilih metode" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Tidak ditentukan</SelectItem>
                    {PAYMENT_METHODS.map((method) => <SelectItem key={method} value={method}>{method}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Sumber Dana (hanya keterangan)</Label>
                <Select value={["blu by BCA Digital", "Mandiri", "Kas Tunai", "Lainnya"].includes(form.paymentAccount) ? form.paymentAccount : form.paymentAccount ? "Lainnya" : "none"}
                  onValueChange={(value) => setForm({ ...form, paymentAccount: value === "none" ? "" : value })}>
                  <SelectTrigger><SelectValue placeholder="Pilih sumber dana" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Tidak ditentukan</SelectItem>
                    <SelectItem value="blu by BCA Digital">blu by BCA Digital</SelectItem>
                    <SelectItem value="Mandiri">Mandiri</SelectItem>
                    <SelectItem value="Kas Tunai">Kas Tunai</SelectItem>
                    <SelectItem value="Lainnya">Lainnya (isi manual)</SelectItem>
                  </SelectContent>
                </Select>
                {form.paymentAccount === "Lainnya" && <Input className="mt-2" placeholder="Nama sumber dana lainnya"
                  onChange={(e) => setForm({ ...form, paymentAccount: e.target.value ? `Lainnya: ${e.target.value}` : "Lainnya" })} />}
                {form.paymentAccount.startsWith("Lainnya: ") && <Input className="mt-2" placeholder="Nama sumber dana lainnya"
                  value={form.paymentAccount.slice(9)}
                  onChange={(e) => setForm({ ...form, paymentAccount: e.target.value ? `Lainnya: ${e.target.value}` : "Lainnya" })} />}
                <p className="text-xs text-gray-500">Tidak memetakan COA, tidak membuat jurnal, dan bukan bank tujuan penerima.</p>
              </div>
            </div>
            {FINANCE_SC_TEST_ONLY && !editingId && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Jenis Transaksi Keluar</Label>
                  <Select value={expenseKind} onValueChange={setExpenseKind}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>
                      {["Transfer Bank","BI-FAST","QRIS","PLN Prabayar","Top Up E-Wallet",
                        "Biaya Admin","E-Commerce","Tunai","Kartu Kredit","Virtual Account",
                        "Kasbon Karyawan","Lainnya"].map(kind=><SelectItem key={kind} value={kind}>{kind}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Bank Tujuan / Penyedia (opsional)</Label>
                  <Input value={destinationBank} maxLength={100}
                    onChange={e=>setDestinationBank(e.target.value)}
                    placeholder="Contoh: BCA, Mandiri, DANA, PLN"/>
                  <p className="text-xs text-gray-500">Berbeda dari Sumber Dana. Jangan menebak bank tujuan dari akun pengirim.</p>
                </div>
              </div>
            )}
            {FINANCE_SC_TEST_ONLY && !editingId && (
              <div className="space-y-1">
                <Label>Nomor Rekening Tujuan (opsional)</Label>
                <Input inputMode="numeric" value={destinationAccount} maxLength={24}
                  onChange={e=>setDestinationAccount(e.target.value.replace(/\D/g,""))}
                  placeholder="Sesuai bukti jika terbaca jelas"/>
                <p className="text-xs text-gray-500">Metadata internal TEST; tidak dimasukkan ke keterangan Google Sheets.</p>
              </div>
            )}
            <div className="space-y-1">
              <Label>Nomor Referensi Bank (opsional)</Label>
              <Input value={form.bankReference} maxLength={120}
                onChange={(e) => setForm({ ...form, bankReference: e.target.value })}
                placeholder="Nomor referensi pada bukti transfer / QRIS" />
              <p className="text-xs text-gray-500">Digunakan sebagai informasi pemeriksaan, bukan konfirmasi otomatis ke bank.</p>
            </div>
            <div className="rounded-lg border">
              <button type="button" className="w-full text-left p-3 flex justify-between items-center text-sm font-medium"
                onClick={() => setShowAdvanced(!showAdvanced)}>
                <span>Pengaturan tambahan (fasilitas, pajak, kategori)</span>
                <ChevronsUpDown className="h-4 w-4 text-gray-400" />
              </button>
              {showAdvanced && (
                <div className="p-3 pt-0 space-y-3">
                  <div className="space-y-1">
                    <Label>Fasilitas terkait</Label>
                    <Select value={form.facilityId || "none"} onValueChange={(v) => setForm({ ...form, facilityId: v === "none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="Pilih fasilitas (opsional)" /></SelectTrigger>
                      <SelectContent><SelectItem value="none">Tidak terkait fasilitas</SelectItem>
                        {(facilities as any[]).map((f: any) => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>PPN Masukan (Rp)</Label>
                    <Input type="number" min="0" step="0.01" value={form.ppnAmount}
                      onChange={(e) => setForm({ ...form, ppnAmount: e.target.value })} placeholder="0" />
                    <p className="text-xs text-gray-500">Jika diisi, PPN ditambahkan di atas nominal dasar. Biaya admin pada bukti bank dicatat sebagai transaksi terpisah bila merupakan mutasi terpisah.</p>
                  </div>
                </div>
              )}
            </div>
            {FINANCE_SC_TEST_ONLY && !editingId && (
              <div className="rounded-md border bg-gray-50 p-3 space-y-1 text-sm">
                <p className="font-semibold">Pratinjau Keterangan Kolom B (TEST)</p>
                <p className="break-words">{[
                  expenseKind==="Transfer Bank"||expenseKind==="BI-FAST"
                    ? "Transfer ke "+(form.vendorName.trim()||"PENERIMA")
                    : expenseKind==="QRIS"?"Pembayaran QRIS | "+(form.vendorName.trim()||"MERCHANT")
                    : expenseKind==="PLN Prabayar"?"Pembelian PLN Prabayar | "+(form.vendorName.trim()||"PELANGGAN")
                    : expenseKind==="Top Up E-Wallet"?"Top Up E-Wallet | "+(form.vendorName.trim()||"PENERIMA")
                    : expenseKind==="Biaya Admin"?"Biaya Admin | "+(form.vendorName.trim()||"PENERIMA")
                    : expenseKind==="Kasbon Karyawan"?"Kasbon Karyawan | "+(form.vendorName.trim()||"KARYAWAN")
                    : expenseKind==="Tunai"?"Pengeluaran Tunai | "+(form.vendorName.trim()||"PENERIMA")
                    : expenseKind+" | "+(form.vendorName.trim()||"PENERIMA"),
                  [destinationBank.trim(),form.notes.trim()].filter(Boolean).join(" - "),
                  form.bankReference.trim(),
                  "SC-TEST-OUT-(ID otomatis)"
                ].filter(Boolean).join(" | ")}</p>
                <p className="text-xs text-gray-500">
                  Penanda SC_TEST_ONLY disimpan terpisah pada kolom H; bukti tetap dapat dilihat dari histori transaksi.
                </p>
              </div>
            )}
            {FINANCE_SC_TEST_ONLY && proofDifferences.length>0 &&
              <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <strong>Periksa perbedaan terhadap bukti OCR:</strong>
                <ul className="list-disc pl-5">{proofDifferences.map(v=><li key={v}>{v}</li>)}</ul>
                <p className="mt-1 text-xs">OCR hanya saran. Pastikan data yang disimpan benar.</p>
              </div>}
            <div className="text-right font-bold">Total Pengeluaran: {formatIDR(totalNum)}</div>

            <div className="flex gap-3 justify-end pt-2">
              <Button type="button" variant="outline" onClick={() => { setFormOpen(false); setEditingId(null); setForm({ ...EMPTY_FORM }); }}>
                Batal
              </Button>
              <Button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white font-bold" disabled={createMutation.isPending || updateMutation.isPending || expenseTestSaving || uploadingReceipt || scanningProof}>
                {editingId ? "Simpan Perubahan" : FINANCE_SC_TEST_ONLY ? "Simpan Pengeluaran (TEST)" : "Buat Pengeluaran"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-black flex items-center gap-2">
              <Receipt className="w-5 h-5 text-orange-500" />
              Detail Pengeluaran
            </DialogTitle>
          </DialogHeader>
          {detail ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-bold text-orange-600">{detail.expenseNo}</span>
                <Badge className={`${STATUS_COLORS[detail.paymentStatus]}`}>{STATUS_LABELS[detail.paymentStatus]}</Badge>
              </div>

              {detail.coaAccount && (
                <div className="p-3 rounded-lg bg-orange-50 border border-orange-100">
                  <p className="text-xs text-gray-500 mb-1 font-medium">Kategori internal (referensi COA)</p>
                  <p className="font-bold text-gray-900 text-sm">
                    {detail.coaAccount.code} — {detail.coaAccount.name}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge className={`text-[10px] ${ACCOUNT_TYPE_COLORS[detail.coaAccount.accountType] ?? "bg-gray-100"}`}>
                      {ACCOUNT_TYPE_LABELS[detail.coaAccount.accountType] ?? detail.coaAccount.accountType}
                    </Badge>
                    <span className="text-xs text-gray-500">Referensi pencatatan saja, tidak membuat jurnal.</span>
                  </div>
                </div>
              )}

              <div className="rounded-lg border p-3 space-y-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">Pencocokan Google Sheets — kas besar sc</p>
                    <p className="text-xs text-gray-500">Data ini adalah catatan operasional, bukan mutasi bank resmi atau jurnal.</p>
                  </div>
                  <Button type="button" size="sm" variant="outline"
                    disabled={detail.paymentStatus !== "paid" || checkingSheet}
                    onClick={() => setSheetCheckId(detail.id)}>
                    {checkingSheet ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <Search className="w-3 h-3 mr-2" />}
                    Cari mutasi
                  </Button>
                </div>
                {detail.paymentStatus !== "paid" && <p className="text-xs text-amber-700">Tandai pengeluaran sudah dibayar sebelum mencari kandidat mutasi.</p>}
                {sheetCheckId === detail.id && sheetCheckError && <p className="text-xs text-red-600">Gagal membaca mutasi. Data pengeluaran tidak berubah.</p>}
                {sheetCheckId === detail.id && sheetCandidates && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-600">{sheetCandidates.message}</p>
                    {sheetCandidates.candidates.length === 0
                      ? <p className="text-xs font-medium text-amber-700">Tidak ditemukan kandidat mutasi. Jangan membuat baris bank otomatis.</p>
                      : sheetCandidates.candidates.map((candidate) => (
                        <div key={candidate.id} className="rounded border bg-gray-50 p-2 text-xs space-y-1">
                          <p className="font-semibold">{candidate.date} • {formatIDR(candidate.amount)} • {candidate.reconciliationStatus || "Belum direkonsiliasi"}</p>
                          <p className="break-words">{candidate.description}</p>
                          <p className="text-gray-500">ID mutasi BizPortal: {candidate.id} — kandidat belum diverifikasi</p>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">Tanggal</span><p className="font-semibold">{detail.expenseDate}</p></div>
                <div><span className="text-gray-500">Kategori</span><p className="font-semibold">{detail.category}</p></div>
                <div className="col-span-2"><span className="text-gray-500">Catatan / Tujuan</span><p className="font-semibold">{detail.description}</p></div>
                {detail.vendorName && <div><span className="text-gray-500">Penerima</span><p className="font-semibold">{detail.vendorName}</p></div>}
                {detail.bankReference && <div className="col-span-2"><span className="text-gray-500">Referensi bank</span><p className="font-mono break-all">{detail.bankReference}</p></div>}
                {detail.facilityName && <div><span className="text-gray-500">Fasilitas</span><p className="font-semibold">{detail.facilityName}</p></div>}
                <div><span className="text-gray-500">Nominal</span><p className="font-semibold">{formatIDR(detail.amount)}</p></div>
                {detail.ppnAmount > 0 && <div><span className="text-gray-500">PPN Masukan</span><p className="font-semibold">{formatIDR(detail.ppnAmount)}</p></div>}
                <div><span className="text-gray-500">Total</span><p className="font-black text-orange-600 text-base">{formatIDR(detail.totalAmount)}</p></div>
                {detail.paymentMethod && <div><span className="text-gray-500">Metode</span><p className="font-semibold">{detail.paymentMethod}</p></div>}
                {detail.paymentAccount && <div><span className="text-gray-500">Rekening</span><p className="font-semibold">{detail.paymentAccount}</p></div>}
                {detail.journalId && (
                  <div className="col-span-2">
                    <span className="text-gray-500">Jurnal</span>
                    <p className="font-mono text-xs font-bold text-green-700">{detail.journalId}</p>
                  </div>
                )}
                {detail.createdByName && <div><span className="text-gray-500">Dibuat oleh</span><p className="font-semibold">{detail.createdByName}</p></div>}
                {detail.approvedByName && <div><span className="text-gray-500">Disetujui oleh</span><p className="font-semibold">{detail.approvedByName}</p></div>}
                {detail.approvedAt && <div><span className="text-gray-500">Disetujui pada</span><p className="font-semibold">{new Date(detail.approvedAt).toLocaleDateString("id-ID")}</p></div>}
                {detail.paidAt && <div><span className="text-gray-500">Dibayar pada</span><p className="font-semibold">{new Date(detail.paidAt).toLocaleDateString("id-ID")}</p></div>}
                {detail.rejectedReason && <div className="col-span-2"><span className="text-gray-500">Alasan ditolak</span><p className="font-semibold text-red-600">{detail.rejectedReason}</p></div>}
                {detail.notes && <div className="col-span-2"><span className="text-gray-500">Catatan</span><p className="font-semibold">{detail.notes}</p></div>}
                {(() => {
                  const photos: string[] = Array.isArray(detail.receiptUrls) && detail.receiptUrls.length > 0
                    ? detail.receiptUrls
                    : detail.receiptUrl ? [detail.receiptUrl] : [];
                  return photos.length > 0 ? (
                    <div className="col-span-2">
                      <span className="text-gray-500">Nota / Struk ({photos.length} foto)</span>
                      <div className="mt-1 grid grid-cols-2 gap-2">
                        {photos.map((url: string, idx: number) => (
                          <div key={idx} className="border rounded-lg overflow-hidden bg-gray-50">
                            <img
                              src={url}
                              alt={`Nota ${idx + 1}`}
                              className="w-full max-h-40 object-contain bg-white"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })()}
              </div>

              <div className="flex gap-2 pt-2 flex-wrap">
                {detail.paymentStatus === "draft" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => { setDetailOpen(false); openEdit(detail); }}>
                      <Edit2 className="w-3.5 h-3.5 mr-1" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      className="bg-yellow-500 hover:bg-yellow-600 text-white"
                      onClick={() => statusMutation.mutate({ id: detail.id, action: "submit" })}
                    >
                      Ajukan Approval
                    </Button>
                    <Button
                      size="sm" variant="destructive"
                      onClick={() => { setDeleteConfirmId(detail.id); setDeleteConfirmNo(detail.expenseNo); }}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Hapus
                    </Button>
                  </>
                )}
                {detail.paymentStatus === "pending_approval" && (
                  <>
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => statusMutation.mutate({ id: detail.id, action: "approve" })}
                    >
                      <ThumbsUp className="w-3.5 h-3.5 mr-1" /> Setujui
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => { setRejectTargetId(detail.id); setRejectOpen(true); }}>
                      <ThumbsDown className="w-3.5 h-3.5 mr-1" /> Tolak
                    </Button>
                  </>
                )}
                {detail.paymentStatus === "approved" && (
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => statusMutation.mutate({ id: detail.id, action: "pay" })}
                  >
                    <Banknote className="w-3.5 h-3.5 mr-1" /> Tandai Dibayar
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-gray-400">Memuat detail...</div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-black text-red-600">Tolak Pengeluaran</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Alasan Penolakan <span className="text-red-500">*</span></Label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Jelaskan alasan penolakan..."
                rows={3}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setRejectOpen(false)}>Batal</Button>
              <Button
                variant="destructive"
                disabled={!rejectReason.trim() || statusMutation.isPending}
                onClick={() => {
                  if (rejectTargetId) {
                    statusMutation.mutate({ id: rejectTargetId, action: "reject", rejectedReason: rejectReason });
                  }
                }}
              >
                Tolak
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(o) => { if (!o) { setDeleteConfirmId(null); setDeleteConfirmNo(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-black text-red-600">Hapus Pengeluaran</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            Yakin ingin menghapus <span className="font-bold text-orange-600">{deleteConfirmNo}</span>? Tindakan ini tidak bisa dibatalkan.
          </p>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="outline" onClick={() => { setDeleteConfirmId(null); setDeleteConfirmNo(""); }}>Batal</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => { if (deleteConfirmId) deleteMutation.mutate(deleteConfirmId); }}
            >
              Hapus
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
