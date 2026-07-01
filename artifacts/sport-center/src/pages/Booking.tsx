import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  useGetFacility,
  getGetFacilityQueryKey,
  useCreateBooking,
  useCheckRecurringBooking,
  useCreateRecurringBooking,
  useGetMe,
  getGetMeQueryKey,
  useListVendors,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronsUpDown, Check } from "lucide-react";
import { format, parseISO } from "date-fns";
import { id as idLocale, enUS } from "date-fns/locale";
import {
  MapPin, Calendar, Clock, Receipt, ChevronLeft,
  RefreshCw, CheckCircle2, XCircle, AlertTriangle, Loader2, Pencil, X as IconX,
  Plane, ShieldCheck, User, Building2, CreditCard, Banknote
} from "lucide-react";
import { getToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/lib/i18n";

function formatCurrency(n: number) {
  return "Rp " + n.toLocaleString("id-ID");
}

function formatDate(dateStr: string, lang: string = "id") {
  try {
    return format(parseISO(dateStr), "EEEE, d MMMM yyyy", { locale: lang === "en" ? enUS : idLocale });
  } catch {
    return dateStr;
  }
}

type RepeatType = "weekly" | "monthly";

export default function Booking() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const { t, lang } = useLang();

  const queryParams = new URLSearchParams(search);
  const facilityId = queryParams.get("facilityId") ? parseInt(queryParams.get("facilityId")!) : 0;
  const date = queryParams.get("date") || "";
  const startTime = queryParams.get("startTime") || "";
  const durationStr = queryParams.get("duration") || "1";
  const duration = parseInt(durationStr) || 1;
  const mode = queryParams.get("mode") || "time_slot";
  const isWalkIn = mode === "walk_in";
  const urlActivityType = queryParams.get("activityType") || "";
  const bookingSource = queryParams.get("source") || "";

  const { data: facility, isLoading: isLoadingFacility } = useGetFacility(facilityId, {
    query: { enabled: !!facilityId, queryKey: getGetFacilityQueryKey(facilityId) },
  });

  // --- Auth user ---
  const { data: currentUser, isLoading: isLoadingUser } = useGetMe({
    query: { retry: false, queryKey: getGetMeQueryKey(), staleTime: 60_000 },
  });
  const isLoggedIn = !!currentUser && currentUser.role !== "admin";
  // Akun admin_booking: bisa booking atas nama customer lain
  const isAdminBooking = currentUser?.role === "admin_booking";
  // Akun perusahaan: user IS the company account
  const isCompanyAccount = (currentUser as any)?.accountType === "company";

  // --- Customer selector (hanya untuk admin_booking) ---
  const [customers, setCustomers] = useState<{ id: number; name: string; email: string | null; phone: string | null }[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [comboOpen, setComboOpen] = useState(false);
  const [comboQuery, setComboQuery] = useState("");

  useEffect(() => {
    if (!isAdminBooking) return; // hanya fetch jika role admin_booking
    const token = getToken();
    if (!token) return;
    fetch("/api/customers/simple", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setCustomers(data); })
      .catch(() => {});
  }, [isAdminBooking]);

  // --- Customer form ---
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // Auto-fill dari dropdown (admin_booking) atau dari akun sendiri (customer biasa)
  useEffect(() => {
    if (isAdminBooking) {
      if (selectedCustomerId) {
        const picked = customers.find((c) => String(c.id) === selectedCustomerId);
        if (picked) {
          setName(picked.name);
          setEmail(picked.email ?? "");
          setPhone(picked.phone ?? "");
        }
      }
      // Jika kosong (new customer mode), biarkan user isi manual
    } else if (currentUser) {
      setName(currentUser.name ?? "");
      setEmail(currentUser.email ?? "");
      setPhone((currentUser as any).phone ?? "");
    }
  }, [isAdminBooking, selectedCustomerId, customers, currentUser]);
  const [notes, setNotes] = useState("");
  const [numberOfPeople, setNumberOfPeople] = useState<string>("1");
  const [vendorId, setVendorId] = useState<string>("");

  const { data: vendors = [] } = useListVendors();

  // --- Booking mode: umum / angkasa_pura / perusahaan ---
  const [bookingMode, setBookingMode] = useState<"umum" | "angkasa_pura" | "perusahaan">("umum");
  const isAP = bookingMode === "angkasa_pura";
  const isCompanyMode = bookingMode === "perusahaan";
  const [idCardNumber, setIdCardNumber] = useState("");

  // --- Company mode state ---
  const [companies, setCompanies] = useState<{ id: number; name: string; companyName: string | null; allowMonthlyBilling: boolean | null; picPhone: string | null; picName: string | null }[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [companyComboOpen, setCompanyComboOpen] = useState(false);
  const [companyCustomerName, setCompanyCustomerName] = useState("");
  const [companyCustomerPhone, setCompanyCustomerPhone] = useState("");
  const [companyEmployeeId, setCompanyEmployeeId] = useState("");
  const [bookedForName, setBookedForName] = useState("");
  const [isPreparing, setIsPreparing] = useState(false);

  // Fetch daftar perusahaan aktif saat login (hanya untuk non-company account)
  useEffect(() => {
    if (!isLoggedIn || isCompanyAccount) return;
    const token = getToken();
    fetch("/api/companies?status=active", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setCompanies(data); })
      .catch(() => {});
  }, [isLoggedIn, isCompanyAccount]);

  // Auto-fill company jika user adalah akun perusahaan
  useEffect(() => {
    if (isCompanyMode && isCompanyAccount && currentUser) {
      setSelectedCompanyId(String((currentUser as any).id));
    }
  }, [isCompanyMode, isCompanyAccount, currentUser]);

  // Track audit event ketika user ganti payer mode
  function trackPayerSelection(selection: "personal" | "corporate") {
    const token = getToken();
    if (!token) return;
    fetch("/api/bookings/track-payer-selection", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ selection }),
    }).catch(() => {});
  }

  // --- Corporate billing ---
  const [isCompanyBilling, setIsCompanyBilling] = useState(false);
  const { data: billingStatus } = useQuery({
    queryKey: ["billing-status"],
    queryFn: async () => {
      const token = getToken();
      const res = await fetch("/api/company-verifications/billing-status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { eligible: false };
      return res.json() as Promise<{ eligible: boolean; companyId?: number; companyName?: string; employeeId?: string }>;
    },
    enabled: isLoggedIn,
    staleTime: 60_000,
  });

  // --- Repeat Booking state ---
  const [isRepeat, setIsRepeat] = useState(false);
  const [repeatType, setRepeatType] = useState<RepeatType>("weekly");
  const [repeatCount, setRepeatCount] = useState(4);
  const [checkResult, setCheckResult] = useState<{
    dates: { date: string; available: boolean; reason?: string | null }[];
    pricePerSession: number;
    validCount: number;
    totalPrice: number;
  } | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [skippedDates, setSkippedDates] = useState<Set<string>>(new Set());
  // overriddenDates: index → { date, available, checking }
  const [overriddenDates, setOverriddenDates] = useState<Record<number, { date: string; available: boolean | null; checking: boolean }>>({});
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");

  // --- Coupon ---
  const [couponInput, setCouponInput] = useState("");
  const [isValidatingCoupon, setIsValidatingCoupon] = useState(false);
  const [couponResult, setCouponResult] = useState<{
    valid: boolean;
    code: string;
    title: string;
    discountType: string;
    discountPercent: number | null;
    discountAmount: number;
  } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  // --- DP (Down Payment) ---
  const [paymentType, setPaymentType] = useState<"full" | "dp">("full");
  const [dpAmount, setDpAmount] = useState("");

  // --- Submit success ---
  const [recurringResult, setRecurringResult] = useState<{
    totalBookings: number;
    grandTotal: number;
    skipped: string[];
    firstOrder?: string;
    groupRef?: string;
  } | null>(null);

  // ---- Single booking ----
  const createBooking = useCreateBooking({
    mutation: {
      onSuccess: async (data: any) => {
        if (data.customerAutoCreated) {
          toast({ title: t("Customer baru berhasil dibuat otomatis.", "New customer auto-created."), description: data.customerName });
        } else if (data.customerReused) {
          toast({ title: t("Nomor WA sudah terdaftar, booking menggunakan akun customer yang sudah ada.", "WA number found, using existing customer.") });
        }
        if (paymentType === "dp" && dpAmount && data.id) {
          const parsedDp = parseFloat(dpAmount.replace(/[^0-9]/g, ""));
          if (parsedDp > 0) {
            await fetch(`/api/bookings/${data.id}/dp`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ downPaymentAmount: parsedDp }),
            }).catch(() => {});
          }
        }
        toast({ title: t("Booking Berhasil", "Booking Successful"), description: t("Silakan lanjutkan ke pembayaran.", "Please proceed to payment.") });
        setLocation(`/booking/${data.orderNumber}`);
      },
      onError: (error: any) => {
        toast({ title: t("Booking Gagal", "Booking Failed"), description: error?.message || t("Gagal membuat booking", "Failed to create booking"), variant: "destructive" });
      },
    },
  });

  // ---- Recurring check ----
  const checkRecurring = useCheckRecurringBooking();
  const checkRecurringMutate = checkRecurring.mutate;

  // ---- Recurring create ----
  const createRecurring = useCreateRecurringBooking({
    mutation: {
      onSuccess: (data) => {
        setRecurringResult({
          totalBookings: data.totalBookings,
          grandTotal: data.grandTotal,
          skipped: data.skipped,
          firstOrder: data.created[0]?.orderNumber,
          groupRef: (data as any).groupRef ?? undefined,
        });
      },
      onError: (error: any) => {
        toast({ title: t("Gagal membuat booking berulang", "Failed to create recurring booking"), description: error?.message || t("Terjadi kesalahan", "An error occurred"), variant: "destructive" });
      },
    },
  });

  // Auto-check whenever repeat settings change and all params ready
  useEffect(() => {
    if (!isRepeat || !facilityId || !date || !startTime || !duration) {
      setCheckResult(null);
      setIsChecking(false);
      return;
    }
    setIsChecking(true);
    setCheckResult(null);
    const timer = setTimeout(() => {
      checkRecurringMutate(
        {
          data: {
            facilityId,
            startDate: date,
            startTime,
            durationHours: duration,
            repeatType,
            repeatCount,
          },
        },
        {
          onSuccess: (data) => {
            setCheckResult(data);
            setSkippedDates(new Set());
            setOverriddenDates({});
            setEditingIdx(null);
            setIsChecking(false);
          },
          onError: () => {
            setIsChecking(false);
          },
        }
      );
    }, 400);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRepeat, repeatType, repeatCount, facilityId, date, startTime, duration, checkRecurringMutate]);

  // Redirect if missing params
  useEffect(() => {
    if (search && (!facilityId || !date)) {
      toast({ title: t("Detail booking tidak lengkap", "Incomplete booking details"), description: t("Silakan pilih fasilitas dan waktu terlebih dahulu.", "Please select a facility and time first."), variant: "destructive" });
      setLocation("/facilities");
      return;
    }
    if (search && !isWalkIn && !startTime) {
      toast({ title: t("Detail booking tidak lengkap", "Incomplete booking details"), description: t("Silakan pilih jam terlebih dahulu.", "Please select a time slot first."), variant: "destructive" });
      setLocation("/facilities");
    }
  }, [search, facilityId, date, startTime, isWalkIn, setLocation, toast]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoadingUser && !currentUser) {
      toast({
        title: t("Login diperlukan", "Login required"),
        description: t("Silakan login terlebih dahulu untuk melanjutkan booking.", "Please log in first to continue booking."),
        variant: "destructive",
      });
      setLocation(`/login?redirect=/booking${search ? "?" + search : ""}`);
    }
  }, [isLoadingUser, currentUser, setLocation, toast, search]);

  // --- Validate coupon ---
  const validateCoupon = async () => {
    if (!couponInput.trim()) return;
    setIsValidatingCoupon(true);
    setCouponError(null);
    setCouponResult(null);
    try {
      const baseAmt = facility ? facility.pricePerHour * duration : 0;
      const purchaseAmount = isRepeat ? baseAmt * effectiveCount : baseAmt;
      const res = await fetch("/api/promos/validate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponInput.trim().toUpperCase(), purchaseAmount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCouponError(data.error || t("Kode tidak valid", "Invalid code"));
      } else {
        setCouponResult(data);
      }
    } catch {
      setCouponError(t("Gagal menghubungi server", "Failed to reach server"));
    } finally {
      setIsValidatingCoupon(false);
    }
  };

  function normalizePhoneInput(raw: string): string {
    let p = raw.replace(/\D/g, "");
    if (p.startsWith("0")) p = "62" + p.slice(1);
    else if (!p.startsWith("62")) p = p ? "62" + p : "";
    return p;
  }

  function isValidPhone(raw: string): boolean {
    const p = normalizePhoneInput(raw);
    return /^62[0-9]{7,13}$/.test(p);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!facilityId || !date) return;
    if (!isWalkIn && (!startTime || !duration)) return;

    // ─── Mode Perusahaan ────────────────────────────────────────────────────
    if (isCompanyMode) {
      if (!selectedCompanyId) {
        toast({ title: t("Pilih perusahaan", "Select company"), description: t("Harap pilih perusahaan dari daftar.", "Please select a company from the list."), variant: "destructive" });
        return;
      }
      const effPhone = isAdminBooking ? companyCustomerPhone.trim() : phone.trim();
      const effName = isAdminBooking ? companyCustomerName.trim() : name.trim();
      if (isAdminBooking && !effPhone) {
        toast({ title: t("Nomor WhatsApp customer wajib", "Customer WhatsApp required"), variant: "destructive" });
        return;
      }
      if (!effName) {
        toast({ title: t("Nama customer wajib diisi", "Customer name required"), variant: "destructive" });
        return;
      }
      if (!email && !isAdminBooking) {
        toast({ title: t("Form tidak lengkap", "Incomplete form"), variant: "destructive" });
        return;
      }

      setIsPreparing(true);
      try {
        const token = getToken();
        const prepRes = await fetch("/api/company-bookings/prepare-customer", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            companyId: Number(selectedCompanyId),
            customerName: effName,
            customerPhone: effPhone,
            employeeId: companyEmployeeId.trim() || undefined,
          }),
        });
        const prepData = await prepRes.json();
        if (!prepRes.ok) {
          toast({ title: prepData.error || t("Gagal memverifikasi data perusahaan", "Failed to verify company data"), variant: "destructive" });
          return;
        }

        if (isRepeat && checkResult && effectiveCount > 0) {
          createRecurring.mutate({
            data: {
              customerName: effName,
              customerEmail: email || "",
              customerPhone: effPhone,
              facilityId,
              startDate: date,
              startTime,
              durationHours: duration,
              notes,
              repeatType,
              repeatCount,
              specificDates: selectedDates,
              payerType: "company",
              companyCustomerId: Number(selectedCompanyId),
              customerId: isAdminBooking ? prepData.customerId : undefined,
              bookedForName: bookedForName.trim() || effName,
              bookedForPhone: effPhone,
              vendorId: (vendorId && vendorId !== "__none__") ? Number(vendorId) : undefined,
            } as any,
          });
        } else {
          createBooking.mutate({
            data: {
              customerName: effName,
              customerEmail: email || undefined,
              customerPhone: effPhone,
              facilityId,
              bookingDate: date,
              ...(isWalkIn ? {} : { startTime, durationHours: duration }),
              activityType: urlActivityType || undefined,
              numberOfPeople: isWalkIn ? parseInt(numberOfPeople) || 1 : undefined,
              notes,
              customerType: "umum",
              payerType: "company",
              companyCustomerId: Number(selectedCompanyId),
              customerId: isAdminBooking ? prepData.customerId : undefined,
              bookedForName: bookedForName.trim() || effName,
              bookedForPhone: effPhone,
              vendorId: (vendorId && vendorId !== "__none__") ? Number(vendorId) : undefined,
            } as any,
          });
        }
      } catch {
        toast({ title: t("Gagal menghubungi server", "Failed to reach server"), variant: "destructive" });
      } finally {
        setIsPreparing(false);
      }
      return;
    }

    // ─── Mode Umum & Angkasa Pura ────────────────────────────────────────────
    if (isAdminBooking && !selectedCustomerId && !name.trim()) {
      toast({ title: t("Pilih nama pelanggan", "Select customer name"), description: t("Harap pilih nama dari daftar pelanggan atau ketik nama baru.", "Please select a customer or type a new name."), variant: "destructive" });
      return;
    }
    e.preventDefault();
    if (!facilityId || !date) return;
    if (!isWalkIn && (!startTime || !duration)) return;
    if (!name.trim()) {
      toast({ title: t("Nama pelanggan wajib diisi", "Customer name required"), variant: "destructive" });
      return;
    }
    if (!phone.trim()) {
      toast({ title: t("No. WhatsApp wajib diisi", "WhatsApp number required"), variant: "destructive" });
      return;
    }
    if (!isValidPhone(phone)) {
      toast({ title: t("Format nomor tidak valid", "Invalid phone format"), description: t("Gunakan format Indonesia, contoh: 08123456789", "Use Indonesian format, e.g. 08123456789"), variant: "destructive" });
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: t("Format email tidak valid", "Invalid email format"), description: t("Masukkan email yang benar, contoh: nama@email.com", "Enter a valid email, e.g. nama@email.com"), variant: "destructive" });
      return;
    }
    const normalizedPhone = normalizePhoneInput(phone);
    if (isAP && !idCardNumber.trim()) {
      toast({ title: t("Nomor ID Card wajib", "ID Card number required"), description: t("Masukkan nomor ID Card Angkasa Pura kamu.", "Enter your Angkasa Pura ID Card number."), variant: "destructive" });
      return;
    }

    const discountPerSession = couponResult?.discountAmount
      ? isRepeat
        ? Math.round(couponResult.discountAmount / (effectiveCount || 1))
        : couponResult.discountAmount
      : 0;

    if (isRepeat) {
      if (!checkResult || effectiveCount === 0) {
        toast({ title: t("Tidak ada slot dipilih", "No slot selected"), description: t("Pilih setidaknya satu tanggal untuk booking.", "Select at least one date for booking."), variant: "destructive" });
        return;
      }
      createRecurring.mutate({
        data: {
          customerName: name,
          customerEmail: email,
          customerPhone: normalizedPhone,
          facilityId,
          startDate: date,
          startTime,
          durationHours: duration,
          repeatType,
          repeatCount,
          notes,
          specificDates: selectedDates,
          customerType: bookingMode === "angkasa_pura" ? "angkasa_pura" : "umum",
          idCardNumber: isAP ? idCardNumber.trim() : undefined,
          promoCode: isAP ? undefined : couponResult?.code || undefined,
          discountAmountPerSession: isAP ? undefined : discountPerSession || undefined,
          payerType: isCompanyBilling ? "company" : "personal",
          companyCustomerId: isCompanyBilling && billingStatus?.companyId ? billingStatus.companyId : undefined,
          vendorId: vendorId ? Number(vendorId) : undefined,
        } as any,
      });
    } else {
      const existingCustomerId = selectedCustomerId && parseInt(selectedCustomerId) > 0 ? parseInt(selectedCustomerId) : undefined;
      createBooking.mutate({
        data: {
          customerName: name,
          customerEmail: email,
          customerPhone: normalizedPhone,
          facilityId,
          bookingDate: date,
          ...(isWalkIn ? {} : { startTime, durationHours: duration }),
          activityType: urlActivityType || undefined,
          numberOfPeople: isWalkIn ? parseInt(numberOfPeople) || 1 : undefined,
          notes,
          customerType: bookingMode === "angkasa_pura" ? "angkasa_pura" : "umum",
          idCardNumber: isAP ? idCardNumber.trim() : undefined,
          promoCode: isAP ? undefined : couponResult?.code || undefined,
          discountAmount: isAP ? undefined : discountPerSession || undefined,
          payerType: isCompanyBilling ? "company" : "personal",
          companyCustomerId: isCompanyBilling && billingStatus?.companyId ? billingStatus.companyId : undefined,
          ...(existingCustomerId ? { customerId: existingCustomerId } : {}),
          ...(bookingSource ? { source: bookingSource } : {}),
          vendorId: vendorId ? Number(vendorId) : undefined,
        } as any,
      });
    }
  };

  // --- Check availability for a specific overridden date ---
  const checkOverrideDate = (idx: number, newDate: string) => {
    if (!newDate || !facilityId || !startTime || !duration) return;
    setOverriddenDates((prev) => ({ ...prev, [idx]: { date: newDate, available: null, checking: true } }));
    setEditingIdx(null);
    checkRecurringMutate(
      { data: { facilityId, startDate: newDate, startTime, durationHours: duration, repeatType, repeatCount: 1 } },
      {
        onSuccess: (data) => {
          const available = data.dates[0]?.available ?? false;
          setOverriddenDates((prev) => ({ ...prev, [idx]: { date: newDate, available, checking: false } }));
        },
        onError: () => {
          setOverriddenDates((prev) => ({ ...prev, [idx]: { date: newDate, available: null, checking: false } }));
          toast({ title: t("Gagal cek tanggal", "Failed to check date"), variant: "destructive" });
        },
      }
    );
  };

  // --- Derived selected dates (available and not manually skipped) ---
  const selectedDates = checkResult
    ? checkResult.dates
        .map((d, idx) => overriddenDates[idx] ?? d)
        .filter((d) => d.available && !skippedDates.has(d.date))
        .map((d) => d.date)
    : [];
  const effectiveCount = selectedDates.length;
  const effectiveTotalPrice = checkResult ? checkResult.pricePerSession * effectiveCount : 0;

  // --- End time ---
  const [hours, minutes] = startTime ? startTime.split(":").map(Number) : [0, 0];
  const endHours = hours + duration;
  const endTime = `${endHours.toString().padStart(2, "0")}:${(minutes || 0).toString().padStart(2, "0")}`;

  const totalPrice = facility ? facility.pricePerHour * duration : 0;

  if (isLoadingFacility || isLoadingUser) {
    return (
      <div className="container py-20 flex justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!facility) return null;

  // --- Recurring success screen ---
  if (recurringResult) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-lg text-center">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="text-green-600 w-10 h-10" />
        </div>
        <h1 className="text-2xl font-bold mb-2">{t("Booking Berhasil Dibuat!", "Booking Created Successfully!")}</h1>
        <p className="text-muted-foreground mb-6">
          <span className="font-semibold text-foreground">{recurringResult.totalBookings}</span> {t("booking berhasil dibuat untuk", "bookings successfully created for")} <span className="font-semibold text-foreground">{facility.name}</span>.
        </p>
        {recurringResult.groupRef && (
          <div className="mb-4 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-violet-50 border border-violet-200 dark:bg-violet-900/20 dark:border-violet-700">
            <span className="text-violet-600 dark:text-violet-400 text-sm font-semibold">
              🔗 {t("Semua booking digabung dalam 1 grup bayar", "All bookings grouped under one payment group")}:
            </span>
            <span className="font-mono font-bold text-violet-700 dark:text-violet-300 text-sm">{recurringResult.groupRef}</span>
          </div>
        )}
        <Card className="mb-6 text-left">
          <CardContent className="p-5 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("Total Booking Dibuat", "Total Bookings Created")}</span>
              <span className="font-semibold">{recurringResult.totalBookings} {t("booking", "bookings")}</span>
            </div>
            {recurringResult.skipped.length > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("Dilewati (konflik)", "Skipped (conflict)")}</span>
                <span className="text-orange-600 font-semibold">{recurringResult.skipped.length} {t("booking", "bookings")}</span>
              </div>
            )}
            {recurringResult.groupRef && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("Kode Grup Bayar", "Payment Group")}</span>
                <span className="font-mono font-bold text-violet-600">{recurringResult.groupRef}</span>
              </div>
            )}
            <div className="border-t pt-3 flex justify-between font-bold text-lg">
              <span>{t("Grand Total", "Grand Total")}</span>
              <span className="text-primary">{formatCurrency(recurringResult.grandTotal)}</span>
            </div>
          </CardContent>
        </Card>
        {recurringResult.skipped.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6 text-left">
            <div className="flex items-center gap-2 text-orange-700 font-semibold text-sm mb-2">
              <AlertTriangle size={15} /> {t("Slot yang dilewati karena konflik:", "Slots skipped due to conflict:")}
            </div>
            {recurringResult.skipped.map((d) => (
              <div key={d} className="text-sm text-orange-600">{formatDate(d, lang)}</div>
            ))}
          </div>
        )}
        <div className="flex gap-3">
          {recurringResult.firstOrder && (
            <Button className="flex-1" onClick={() => setLocation(`/booking/${recurringResult.firstOrder}`)}>
              {t("Lihat Detail Pembayaran", "View Payment Details")}
            </Button>
          )}
          <Button variant="outline" className="flex-1" onClick={() => setLocation("/my-bookings")}>
            {t("Booking Saya", "My Bookings")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <Button variant="ghost" onClick={() => window.history.back()} className="mb-6 -ml-4">
        <ChevronLeft className="mr-2 h-4 w-4" /> {t("Kembali", "Back")}
      </Button>

      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-black tracking-tight">{t("Checkout", "Checkout")}</h1>
        <p className="text-muted-foreground">{t("Lengkapi detail booking kamu di bawah ini.", "Complete your booking details below.")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left - Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Details */}
          <Card>
            <CardHeader>
              <CardTitle>{t("Data Pemesan", "Customer Details")}</CardTitle>
            </CardHeader>
            <form onSubmit={handleSubmit} id="booking-form">
              <CardContent className="space-y-4">
                {/* Nama Pemesan — dikunci ke akun yang login, tidak bisa diubah */}
                {isLoggedIn && (
                  <div className="space-y-2">
                    <Label>{t("Nama Pemesan", "Account Holder")}</Label>
                    <div className="flex items-center gap-2 h-10 px-3 rounded-md border bg-muted/50 text-foreground font-medium text-sm cursor-not-allowed select-none">
                      <ShieldCheck size={14} className="text-primary shrink-0" />
                      <span>{currentUser?.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{t("Nama akun tidak dapat diubah.", "Account name cannot be changed.")}</p>
                  </div>
                )}

                {/* Nama Lengkap — creatable combobox untuk admin_booking, read-only untuk customer biasa */}
                <div className="space-y-2">
                  <Label htmlFor="namaPelanggan">{t("Nama Lengkap", "Full Name")} <span className="text-destructive">*</span></Label>
                  {isAdminBooking ? (
                    <>
                      <Popover open={comboOpen} onOpenChange={(open) => { setComboOpen(open); if (!open) setComboQuery(""); }}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={comboOpen}
                            className="w-full justify-between font-normal h-10"
                          >
                            <span className="truncate">
                              {selectedCustomerId
                                ? (() => { const c = customers.find((c) => String(c.id) === selectedCustomerId); return c ? `${c.name}${c.phone ? ` — ${c.phone}` : ""}` : name || t("Pilih atau ketik customer baru...", "Select or type new customer..."); })()
                                : name
                                  ? <span className="flex items-center gap-1.5"><span className="text-xs bg-primary/15 text-primary rounded px-1.5 py-0.5 font-medium">Baru</span>{name}</span>
                                  : t("Pilih atau ketik nama customer baru...", "Select or type new customer...")}
                            </span>
                            <ChevronsUpDown size={14} className="ml-2 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                          <Command filter={(value, search) => {
                            if (value === "__create__") return 1;
                            return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
                          }}>
                            <CommandInput
                              placeholder={t("Cari nama / nomor, atau ketik nama baru...", "Search name/phone or type new name...")}
                              value={comboQuery}
                              onValueChange={setComboQuery}
                            />
                            <CommandList>
                              <CommandEmpty>{t("Tidak ditemukan", "No results found")}</CommandEmpty>
                              <CommandGroup>
                                {customers
                                  .filter(c => !comboQuery.trim() || `${c.name} ${c.phone ?? ""}`.toLowerCase().includes(comboQuery.toLowerCase()))
                                  .map((c) => (
                                    <CommandItem
                                      key={c.id}
                                      value={`${c.name} ${c.phone ?? ""}`}
                                      onSelect={() => {
                                        setSelectedCustomerId(String(c.id));
                                        setComboQuery("");
                                        setComboOpen(false);
                                      }}
                                    >
                                      <Check size={14} className={`mr-2 shrink-0 ${String(c.id) === selectedCustomerId ? "opacity-100" : "opacity-0"}`} />
                                      <span>{c.name}{c.phone ? ` — ${c.phone}` : ""}</span>
                                    </CommandItem>
                                  ))}
                              </CommandGroup>
                              {comboQuery.trim() && (
                                <CommandGroup>
                                  <CommandItem
                                    value="__create__"
                                    onSelect={() => {
                                      setSelectedCustomerId("");
                                      setName(comboQuery.trim());
                                      setEmail("");
                                      setPhone("");
                                      setComboQuery("");
                                      setComboOpen(false);
                                    }}
                                    className="text-primary font-medium"
                                  >
                                    <span className="mr-2 text-base">＋</span>
                                    {t(`Buat customer baru: "${comboQuery.trim()}"`, `Create new customer: "${comboQuery.trim()}"`)}
                                  </CommandItem>
                                </CommandGroup>
                              )}
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      {/* Jika customer baru (belum terdaftar), tampilkan input nama yang bisa diedit */}
                      {!selectedCustomerId && name && (
                        <Input
                          value={name}
                          onChange={e => setName(e.target.value)}
                          placeholder={t("Nama lengkap customer baru", "New customer full name")}
                          className="mt-1"
                        />
                      )}
                      {/* Tombol reset ke mode pilih */}
                      {(selectedCustomerId || name) && (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-foreground underline mt-0.5"
                          onClick={() => { setSelectedCustomerId(""); setName(""); setEmail(""); setPhone(""); setComboQuery(""); }}
                        >
                          {t("Bersihkan pilihan", "Clear selection")}
                        </button>
                      )}
                    </>
                  ) : isLoggedIn ? (
                    <div className="flex items-center gap-2 h-10 px-3 rounded-md border bg-muted/50 text-foreground font-medium text-sm cursor-not-allowed select-none">
                      <span>{name || currentUser?.name}</span>
                    </div>
                  ) : (
                    <Input
                      id="namaPelanggan"
                      required
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder={t("Nama lengkap", "Full name")}
                    />
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">{t("Alamat Email", "Email Address")} <span className="text-destructive">*</span></Label>
                    <Input
                      id="email"
                      type="email"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder={t("email@kamu.com", "your@email.com")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">{t("No. WhatsApp", "WhatsApp No.")} <span className="text-destructive">*</span></Label>
                    <Input id="phone" required value={phone} onChange={e => setPhone(e.target.value)} placeholder="08123456789" />
                  </div>
                </div>
                {vendors.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="vendor">{t("Vendor (Opsional)", "Vendor (Optional)")}</Label>
                    <Select value={vendorId} onValueChange={setVendorId}>
                      <SelectTrigger id="vendor">
                        <SelectValue placeholder={t("Pilih vendor...", "Select vendor...")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("— Tanpa vendor —", "— No vendor —")}</SelectItem>
                        {vendors.map((v) => (
                          <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="notes">{t("Catatan Tambahan (Opsional)", "Additional Notes (Optional)")}</Label>
                  <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder={t("Permintaan khusus...", "Special requests...")} />
                </div>
              </CardContent>
            </form>
          </Card>

          {/* Customer Type */}
          <Card className={isAP ? "border-primary/40 bg-primary/5" : isCompanyMode ? "border-blue-400/40 bg-blue-50/40" : ""}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck size={16} className="text-primary" /> {t("Tipe Pemesan", "Customer Type")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className={`grid gap-2 ${isLoggedIn ? "grid-cols-3" : "grid-cols-2"}`}>
                <button
                  type="button"
                  onClick={() => { setBookingMode("umum"); if (isLoggedIn) trackPayerSelection("personal"); }}
                  className={`flex flex-col items-center gap-2 p-3 rounded-lg border text-center transition-colors ${bookingMode === "umum" ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/50"}`}
                >
                  <User size={18} className="shrink-0" />
                  <div>
                    <div className="font-semibold text-xs">{t("Umum", "General")}</div>
                    <div className={`text-xs ${bookingMode === "umum" ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{t("Harga normal", "Standard")}</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => { setBookingMode("angkasa_pura"); if (isLoggedIn) trackPayerSelection("personal"); }}
                  className={`flex flex-col items-center gap-2 p-3 rounded-lg border text-center transition-colors ${isAP ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/50"}`}
                >
                  <Plane size={18} className="shrink-0" />
                  <div>
                    <div className="font-semibold text-xs">{t("Angkasa Pura", "Angkasa Pura")}</div>
                    <div className={`text-xs ${isAP ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{t("Diskon khusus", "Discount")}</div>
                  </div>
                </button>
                {isLoggedIn && (
                  <button
                    type="button"
                    onClick={() => { setBookingMode("perusahaan"); trackPayerSelection("corporate"); }}
                    className={`flex flex-col items-center gap-2 p-3 rounded-lg border text-center transition-colors relative ${isCompanyMode ? "bg-blue-600 text-white border-blue-600" : "bg-background border-border hover:border-blue-400/50"}`}
                  >
                    <Building2 size={18} className="shrink-0" />
                    <div>
                      <div className="font-semibold text-xs">{t("Perusahaan", "Company")}</div>
                      <div className={`text-xs ${isCompanyMode ? "text-blue-100" : "text-muted-foreground"}`}>
                        {isCompanyAccount
                          ? t("Tagihan bulanan", "Monthly bill")
                          : billingStatus?.eligible
                          ? t("Tagihan bulanan", "Monthly bill")
                          : t("Perlu verifikasi", "Needs verification")}
                      </div>
                    </div>
                  </button>
                )}
              </div>

              {isAP && (
                <div className="space-y-2">
                  <Label htmlFor="idCard">{t("Nomor ID Card Angkasa Pura", "Angkasa Pura ID Card Number")} <span className="text-destructive">*</span></Label>
                  <Input
                    id="idCard"
                    value={idCardNumber}
                    onChange={(e) => setIdCardNumber(e.target.value.toUpperCase())}
                    placeholder="AP-2024-001"
                    className="font-mono tracking-wider"
                  />
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-orange-500" />
                    <span>{t("Booking akan menunggu verifikasi ID Card oleh admin. Diskon diterapkan setelah ID Card terverifikasi.", "Booking will await ID Card verification by admin. Discount is applied once the ID Card is verified.")}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Company Form */}
          {isCompanyMode && (
            <Card className="border-blue-400/40 bg-blue-50/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 size={16} className="text-blue-600" /> {t("Detail Pemesanan Perusahaan", "Company Booking Details")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Company Selector */}
                <div className="space-y-2">
                  <Label>{t("Nama Perusahaan", "Company Name")} <span className="text-destructive">*</span></Label>
                  {isCompanyAccount ? (
                    <div className="flex items-center gap-2 rounded-md border border-input bg-muted/50 px-3 py-2 h-10">
                      <Building2 size={14} className="text-blue-600 shrink-0" />
                      <span className="text-sm font-medium">
                        {(currentUser as any)?.companyName || currentUser?.name || t("Perusahaan Anda", "Your Company")}
                      </span>
                      <Badge variant="outline" className="ml-auto text-xs text-blue-600 border-blue-300 bg-blue-50">{t("Akun Perusahaan", "Company Account")}</Badge>
                    </div>
                  ) : (
                    <Popover open={companyComboOpen} onOpenChange={setCompanyComboOpen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          role="combobox"
                          aria-expanded={companyComboOpen}
                          className="w-full flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 h-10"
                        >
                          <span className={!selectedCompanyId ? "text-muted-foreground" : ""}>
                            {selectedCompanyId
                              ? (companies.find((c) => String(c.id) === selectedCompanyId)?.companyName || companies.find((c) => String(c.id) === selectedCompanyId)?.name || t("Pilih perusahaan...", "Select company..."))
                              : t("Pilih perusahaan...", "Select company...")}
                          </span>
                          <ChevronsUpDown size={14} className="ml-2 shrink-0 text-muted-foreground" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-full p-0" align="start">
                        <Command>
                          <CommandInput placeholder={t("Cari perusahaan...", "Search company...")} />
                          <CommandList>
                            <CommandEmpty>{t("Perusahaan tidak ditemukan.", "Company not found.")}</CommandEmpty>
                            <CommandGroup>
                              {companies.map((c) => (
                                <CommandItem
                                  key={c.id}
                                  value={c.companyName || c.name}
                                  onSelect={() => { setSelectedCompanyId(String(c.id)); setCompanyComboOpen(false); }}
                                >
                                  <Check size={14} className={`mr-2 ${selectedCompanyId === String(c.id) ? "opacity-100" : "opacity-0"}`} />
                                  <div>
                                    <div className="font-medium text-sm">{c.companyName || c.name}</div>
                                    {c.picName && <div className="text-xs text-muted-foreground">PIC: {c.picName}</div>}
                                    {!c.allowMonthlyBilling && <div className="text-xs text-orange-500">{t("Billing belum aktif", "Billing not active")}</div>}
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  )}
                  {!isCompanyAccount && companies.length === 0 && (
                    <p className="text-xs text-muted-foreground">{t("Belum ada perusahaan aktif terdaftar.", "No active companies registered yet.")}</p>
                  )}
                </div>

                {/* Admin booking: input customer */}
                {isAdminBooking && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>{t("Nama Customer", "Customer Name")} <span className="text-destructive">*</span></Label>
                      <Input
                        value={companyCustomerName}
                        onChange={(e) => setCompanyCustomerName(e.target.value)}
                        placeholder={t("Nama lengkap customer", "Customer full name")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("No. WhatsApp Customer", "Customer WhatsApp")} <span className="text-destructive">*</span></Label>
                      <Input
                        value={companyCustomerPhone}
                        onChange={(e) => setCompanyCustomerPhone(e.target.value)}
                        placeholder="08123456789"
                      />
                    </div>
                  </div>
                )}

                {/* Employee ID + Dipakai untuk */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>{t("ID Karyawan (opsional)", "Employee ID (optional)")}</Label>
                    <Input
                      value={companyEmployeeId}
                      onChange={(e) => setCompanyEmployeeId(e.target.value)}
                      placeholder="EMP-001"
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">{t("Untuk verifikasi keanggotaan perusahaan.", "For company membership verification.")}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>{t("Dipakai untuk (nama pengguna)", "Used by (player name)")}</Label>
                    <Input
                      value={bookedForName}
                      onChange={(e) => setBookedForName(e.target.value)}
                      placeholder={t("Nama yang menggunakan lapangan", "Name of facility user")}
                    />
                  </div>
                </div>

                {/* Warning: belum diverifikasi sebagai karyawan (hanya untuk non-company account) */}
                {!isCompanyAccount && !billingStatus?.eligible && (
                  <div className="flex items-start gap-2 text-xs bg-orange-50 border border-orange-200 rounded-md p-3">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-orange-500" />
                    <span className="text-orange-700">
                      {t(
                        "Akun Anda belum terverifikasi sebagai karyawan perusahaan. Status booking akan menjadi Menunggu Konfirmasi dan perlu approval admin.",
                        "Your account is not yet verified as a company employee. Booking status will be Waiting Confirmation and requires admin approval."
                      )}
                    </span>
                  </div>
                )}

                <div className="flex items-start gap-2 text-xs text-muted-foreground bg-blue-50 border border-blue-200 rounded-md p-3">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-blue-500" />
                  <span>
                    {billingStatus?.eligible
                      ? t(
                          "Booking akan ditagihkan ke perusahaan. Tidak perlu bayar sekarang — masuk dalam tagihan bulanan.",
                          "Booking will be billed to the company. No payment needed now — included in monthly billing."
                        )
                      : t(
                          "Booking akan ditagihkan ke perusahaan. Jika verifikasi belum selesai, status booking menjadi Menunggu Konfirmasi.",
                          "Booking will be billed to the company. If verification is pending, booking status will be Waiting Confirmation."
                        )}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Corporate Billing */}
          {isLoggedIn && billingStatus?.eligible && !isAP && !isCompanyMode && (
            <Card className={isCompanyBilling ? "border-primary/40 bg-primary/5" : ""}>
              <CardContent className="p-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox
                    id="company-billing"
                    checked={isCompanyBilling}
                    onCheckedChange={(v) => setIsCompanyBilling(Boolean(v))}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Building2 size={15} className="text-primary" />
                      <span className="font-semibold text-sm">Tagihkan ke Perusahaan</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Bayar via tagihan bulanan <strong>{billingStatus.companyName}</strong> (ID: {billingStatus.employeeId})
                    </p>
                  </div>
                  {isCompanyBilling && (
                    <Badge className="bg-primary/10 text-primary border-primary/20 shrink-0 text-xs">Aktif</Badge>
                  )}
                </label>
              </CardContent>
            </Card>
          )}

          {/* Coupon Code */}
          {!isAP && (
          <Card className={couponResult ? "border-green-300 bg-green-50/50" : ""}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt size={16} className="text-primary" /> {t("Kode Kupon", "Coupon Code")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {couponResult ? (
                <div className="flex items-center justify-between bg-green-100 border border-green-300 rounded-lg px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 size={18} className="text-green-600 shrink-0" />
                    <div>
                      <div className="font-semibold text-green-800 text-sm">{couponResult.code}</div>
                      <div className="text-xs text-green-700">{couponResult.title}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-green-700">−{formatCurrency(couponResult.discountAmount)}</span>
                    <button
                      type="button"
                      onClick={() => { setCouponResult(null); setCouponInput(""); setCouponError(null); }}
                      className="text-green-600 hover:text-green-800 p-1 rounded hover:bg-green-200 transition-colors"
                    >
                      <IconX size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    value={couponInput}
                    onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCouponError(null); }}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), validateCoupon())}
                    placeholder={t("Masukkan kode kupon...", "Enter coupon code...")}
                    className={`font-mono tracking-wider ${couponError ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                    disabled={isValidatingCoupon}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={validateCoupon}
                    disabled={!couponInput.trim() || isValidatingCoupon}
                    className="shrink-0"
                  >
                    {isValidatingCoupon ? <Loader2 size={15} className="animate-spin" /> : t("Terapkan", "Apply")}
                  </Button>
                </div>
              )}
              {couponError && (
                <div className="flex items-center gap-2 text-sm text-red-600">
                  <XCircle size={14} /> {couponError}
                </div>
              )}
            </CardContent>
          </Card>
          )}

          {/* Repeat Booking */}
          <Card className={isRepeat ? "border-primary/40 bg-primary/5" : ""}>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="repeat-check"
                  checked={isRepeat}
                  onCheckedChange={(v) => setIsRepeat(!!v)}
                />
                <Label htmlFor="repeat-check" className="text-base font-semibold cursor-pointer flex items-center gap-2">
                  <RefreshCw size={16} className={isRepeat ? "text-primary" : "text-muted-foreground"} />
                  {t("Repeat Booking", "Repeat Booking")}
                  {isRepeat && <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">{t("Aktif", "Active")}</Badge>}
                </Label>
              </div>
              {!isRepeat && (
                <p className="text-xs text-muted-foreground ml-7">
                  {t("Aktifkan untuk membuat booking berulang secara otomatis (mingguan / bulanan).", "Enable to automatically create recurring bookings (weekly / monthly).")}
                </p>
              )}
            </CardHeader>

            {isRepeat && (
              <CardContent className="space-y-5 pt-0">
                {/* Repeat Type */}
                <div>
                  <Label className="text-sm font-semibold mb-2 block">{t("Tipe Pengulangan", "Repeat Type")}</Label>
                  <div className="flex gap-2">
                    {(["weekly", "monthly"] as RepeatType[]).map((rt) => (
                      <button
                        key={rt}
                        type="button"
                        onClick={() => setRepeatType(rt)}
                        className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${repeatType === rt ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/50"}`}
                      >
                        {rt === "weekly" ? t("🗓 Weekly (Mingguan)", "🗓 Weekly") : t("📅 Monthly (Bulanan)", "📅 Monthly")}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Repeat Count */}
                <div>
                  <Label htmlFor="repeat-count" className="text-sm font-semibold mb-2 block">
                    {t("Jumlah Pengulangan", "Number of Repeats")}
                    <span className="text-muted-foreground font-normal ml-1">{t("(maks. 52)", "(max. 52)")}</span>
                  </Label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setRepeatCount(Math.max(1, repeatCount - 1))}
                      className="w-10 h-10 rounded-lg border border-border hover:bg-accent flex items-center justify-center text-lg font-bold"
                    >−</button>
                    <Input
                      id="repeat-count"
                      type="number"
                      min={1}
                      max={52}
                      value={repeatCount}
                      onChange={e => setRepeatCount(Math.min(52, Math.max(1, parseInt(e.target.value) || 1)))}
                      className="w-20 text-center font-bold text-lg"
                    />
                    <button
                      type="button"
                      onClick={() => setRepeatCount(Math.min(52, repeatCount + 1))}
                      className="w-10 h-10 rounded-lg border border-border hover:bg-accent flex items-center justify-center text-lg font-bold"
                    >+</button>
                    <span className="text-sm text-muted-foreground">
                      {repeatType === "weekly" ? t("minggu", "weeks") : t("bulan", "months")}
                    </span>
                  </div>
                </div>

                {/* Preview */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <Label className="text-sm font-semibold">{t("Preview Jadwal Booking", "Booking Schedule Preview")}</Label>
                    {isChecking && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 size={13} className="animate-spin" /> {t("Mengecek ketersediaan...", "Checking availability...")}
                      </div>
                    )}
                  </div>

                  {isChecking && (
                    <div className="space-y-2">
                      {[...Array(repeatCount > 6 ? 6 : repeatCount)].map((_, i) => (
                        <div key={i} className="h-11 rounded-lg bg-muted animate-pulse" />
                      ))}
                    </div>
                  )}

                  {!isChecking && checkResult && (
                    <div className="space-y-2">
                      {checkResult.dates.map((original, idx) => {
                        const override = overriddenDates[idx];
                        const item = override ?? original;
                        const isManuallySkipped = skippedDates.has(item.date);
                        const isEditing = editingIdx === idx;
                        const isCheckingOverride = override?.checking === true;
                        const wasOverridden = !!override && !override.checking;

                        let rowBg = "bg-green-50 border-green-200";
                        if (isCheckingOverride) rowBg = "bg-blue-50 border-blue-200";
                        else if (item.available === null) rowBg = "bg-muted border-border";
                        else if (!item.available) rowBg = "bg-red-50 border-red-200 opacity-70";
                        else if (isManuallySkipped) rowBg = "bg-muted border-border opacity-50";

                        return (
                          <div key={idx} className="space-y-1.5">
                            <div className={`flex items-center justify-between px-4 py-3 rounded-lg border text-sm transition-all ${rowBg}`}>
                              <div className="flex items-center gap-2.5 min-w-0">
                                {isCheckingOverride
                                  ? <Loader2 size={16} className="text-blue-500 shrink-0 animate-spin" />
                                  : item.available === null
                                    ? <AlertTriangle size={16} className="text-muted-foreground shrink-0" />
                                    : !item.available
                                      ? <XCircle size={16} className="text-red-500 shrink-0" />
                                      : isManuallySkipped
                                        ? <XCircle size={16} className="text-muted-foreground shrink-0" />
                                        : <CheckCircle2 size={16} className="text-green-600 shrink-0" />
                                }
                                <div className="min-w-0">
                                  <span className={`font-medium ${
                                    isCheckingOverride ? "text-blue-700" :
                                    item.available === null ? "text-muted-foreground" :
                                    !item.available ? "text-red-700" :
                                    isManuallySkipped ? "text-muted-foreground line-through" :
                                    "text-green-800"
                                  }`}>
                                    {formatDate(item.date, lang)}
                                  </span>
                                  {wasOverridden && <span className="ml-2 text-xs text-blue-500">{t("(diubah)", "(changed)")}</span>}
                                  {isCheckingOverride && <span className="ml-2 text-xs text-blue-500">{t("Mengecek...", "Checking...")}</span>}
                                  {!item.available && (item as any).reason && !isCheckingOverride && (
                                    <span className="ml-2 text-xs text-red-500">({(item as any).reason})</span>
                                  )}
                                  {isManuallySkipped && <span className="ml-2 text-xs text-muted-foreground">{t("(dilewati)", "(skipped)")}</span>}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0 ml-2">
                                <span className="text-xs font-medium text-muted-foreground">{startTime} – {endTime}</span>
                                {!isCheckingOverride && (
                                  <button
                                    type="button"
                                    title={t("Ubah tanggal", "Change date")}
                                    onClick={() => { setEditingIdx(isEditing ? null : idx); setEditingValue(item.date); }}
                                    className="p-1 rounded hover:bg-black/5 text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    {isEditing ? <IconX size={14} /> : <Pencil size={14} />}
                                  </button>
                                )}
                                {!isCheckingOverride && (
                                  <button
                                    type="button"
                                    disabled={!item.available && !isManuallySkipped}
                                    onClick={() => setSkippedDates((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(item.date)) next.delete(item.date); else next.add(item.date);
                                      return next;
                                    })}
                                    className={`text-xs px-2 py-1 rounded border transition-colors ${
                                      isManuallySkipped ? "border-green-300 text-green-700 hover:bg-green-50" :
                                      !item.available ? "border-gray-200 text-gray-400 cursor-not-allowed" :
                                      "border-red-200 text-red-500 hover:bg-red-50"
                                    }`}
                                  >
                                    {isManuallySkipped ? t("Sertakan", "Include") : t("Lewati", "Skip")}
                                  </button>
                                )}
                              </div>
                            </div>

                            {isEditing && (
                              <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
                                <Calendar size={14} className="text-blue-500 shrink-0" />
                                <input
                                  type="date"
                                  value={editingValue}
                                  min={new Date().toISOString().split("T")[0]}
                                  onChange={(e) => setEditingValue(e.target.value)}
                                  className="flex-1 text-sm bg-transparent border-none outline-none text-blue-800"
                                />
                                <button
                                  type="button"
                                  disabled={!editingValue || editingValue === item.date}
                                  onClick={() => checkOverrideDate(idx, editingValue)}
                                  className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                  {t("Cek & Simpan", "Check & Save")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingIdx(null)}
                                  className="text-xs px-2 py-1 border border-blue-200 text-blue-600 rounded hover:bg-blue-100 transition-colors"
                                >
                                  {t("Batal", "Cancel")}
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {effectiveCount < checkResult.dates.length && effectiveCount > 0 && (
                        <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-700">
                          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                          <span>
                            {t("Hanya", "Only")} <strong>{effectiveCount} {t("dari", "of")} {checkResult.dates.length} {t("sesi", "sessions")}</strong> {t("yang akan dibooking.", "will be booked.")}
                          </span>
                        </div>
                      )}

                      {effectiveCount === 0 && (
                        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                          <XCircle size={15} />
                          <span>{t("Tidak ada sesi yang dipilih. Aktifkan minimal satu tanggal.", "No sessions selected. Enable at least one date.")}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            )}
          </Card>

          {/* Down Payment Option */}
          <Card className={paymentType === "dp" ? "border-violet-300 bg-violet-50/50 dark:bg-violet-900/10" : ""}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Banknote size={16} className="text-primary" /> {t("Pilihan Pembayaran", "Payment Option")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentType("full")}
                    className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${paymentType === "full" ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/50 bg-background"}`}
                  >
                    <CheckCircle2 size={15} />
                    {t("Bayar Penuh", "Full Payment")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentType("dp")}
                    className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${paymentType === "dp" ? "border-violet-500 bg-violet-600 text-white" : "border-border hover:border-violet-400/60 bg-background"}`}
                  >
                    <CreditCard size={15} />
                    {t("Bayar DP", "Down Payment")}
                  </button>
                </div>
                {paymentType === "dp" && (
                  <div className="space-y-2.5 pt-1">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-semibold">{t("Jumlah Down Payment", "Down Payment Amount")} <span className="text-destructive">*</span></Label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={dpAmount ? Number(dpAmount).toLocaleString("id-ID") : ""}
                        onChange={(e) => setDpAmount(e.target.value.replace(/[^0-9]/g, ""))}
                        placeholder="Contoh: 150.000"
                        className="font-mono"
                      />
                    </div>
                    {dpAmount && Number(dpAmount) > 0 && (
                      <div className="text-sm bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg p-3 space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{t("DP Dibayar Sekarang", "DP Paid Now")}</span>
                          <span className="font-bold text-violet-700 dark:text-violet-300">Rp {Number(dpAmount).toLocaleString("id-ID")}</span>
                        </div>
                        {facility && (
                          <div className="flex justify-between border-t border-violet-200 dark:border-violet-800 pt-1.5">
                            <span className="text-muted-foreground">{t("Sisa Pembayaran", "Remaining")}</span>
                            <span className="font-bold text-foreground">Rp {Math.max(0, facility.pricePerHour * duration - Number(dpAmount)).toLocaleString("id-ID")}</span>
                          </div>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">{t("Sisa pembayaran harus dilunasi sebelum sesi dimulai.", "Remaining payment must be settled before the session starts.")}</p>
                  </div>
                )}
              </CardContent>
            </Card>

          {/* Submit Button (mobile) */}
          <div className="lg:hidden">
            <Button
              type="submit"
              form="booking-form"
              size="lg"
              className="w-full text-base font-bold h-12"
              disabled={createBooking.isPending || createRecurring.isPending || (isRepeat && isChecking)}
              onClick={handleSubmit}
            >
              {(createBooking.isPending || createRecurring.isPending)
                ? t("Memproses...", "Processing...")
                : isRepeat
                  ? `${t("Konfirmasi", "Confirm")} ${isChecking ? "..." : effectiveCount || (checkResult?.validCount ?? repeatCount)} ${t("Booking", "Bookings")}`
                  : t("Konfirmasi Booking", "Confirm Booking")
              }
            </Button>
          </div>
        </div>

        {/* Right - Summary */}
        <div>
          <Card className="sticky top-24 border-primary/20 shadow-md">
            <CardHeader className="bg-muted/30 pb-4 border-b">
              <CardTitle className="text-lg flex items-center gap-2">
                <Receipt className="text-primary w-5 h-5" />
                {t("Ringkasan Booking", "Booking Summary")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-5">
              <div>
                <h4 className="font-bold text-lg mb-1">{facility.name}</h4>
                <div className="text-sm font-medium text-primary uppercase tracking-wider mb-3">{facility.category}</div>
                <div className="space-y-3 text-sm">
                  <div className="flex items-start gap-3">
                    <Calendar className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">{t("Tanggal", "Date")}</div>
                      <div className="text-muted-foreground">{date ? formatDate(date, lang) : ""}</div>
                      {isRepeat && (
                        <div className="text-xs text-primary mt-0.5">
                          +{repeatCount - 1} {repeatType === "weekly" ? t("sesi mingguan berikutnya", "more weekly sessions") : t("sesi bulanan berikutnya", "more monthly sessions")}
                        </div>
                      )}
                    </div>
                  </div>
                  {isWalkIn ? (
                    <div className="flex items-start gap-3">
                      <Clock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div>
                        <div className="font-medium">{t("Akses", "Access")}</div>
                        <div className="text-muted-foreground">06:00 – 22:00 {t("(bebas masuk)", "(open access)")}</div>
                        <div className="mt-1">
                          <label className="text-xs font-medium text-muted-foreground block mb-1">{t("Jumlah orang", "Number of people")}</label>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => setNumberOfPeople(String(Math.max(1, parseInt(numberOfPeople) - 1)))} className="w-7 h-7 rounded border border-border flex items-center justify-center text-sm font-bold hover:bg-accent">−</button>
                            <span className="font-bold w-8 text-center">{numberOfPeople}</span>
                            <button type="button" onClick={() => setNumberOfPeople(String(Math.min(20, parseInt(numberOfPeople) + 1)))} className="w-7 h-7 rounded border border-border flex items-center justify-center text-sm font-bold hover:bg-accent">+</button>
                            <span className="text-xs text-muted-foreground">{t("orang", "people")}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <Clock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div>
                        <div className="font-medium">{t("Waktu & Durasi", "Time & Duration")}</div>
                        <div className="text-muted-foreground">
                          {startTime.substring(0, 5)} – {endTime} ({duration} {t("jam", "hours")})
                        </div>
                        {urlActivityType && (
                          <div className="text-xs text-primary font-medium mt-0.5 capitalize">
                            🏅 {urlActivityType}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">{t("Lokasi", "Location")}</div>
                      <div className="text-muted-foreground">SportCenter Main</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("Harga/jam", "Price/hour")}</span>
                  <span>{formatCurrency(facility.pricePerHour)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("Durasi", "Duration")}</span>
                  <span>× {duration} {t("jam", "hours")}</span>
                </div>
                {isRepeat && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("Harga/sesi", "Price/session")}</span>
                      <span>{formatCurrency(totalPrice)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("Sesi dipilih", "Sessions selected")}</span>
                      <span>
                        {isChecking
                          ? <span className="text-muted-foreground">...</span>
                          : `× ${effectiveCount > 0 ? effectiveCount : (checkResult?.validCount ?? repeatCount)}`
                        }
                      </span>
                    </div>
                  </>
                )}
                {couponResult && (
                  <div className="flex justify-between text-green-700 font-medium">
                    <span className="flex items-center gap-1">
                      <Receipt size={12} /> {t("Diskon", "Discount")} ({couponResult.code})
                    </span>
                    <span>−{formatCurrency(couponResult.discountAmount)}</span>
                  </div>
                )}
                {(() => {
                  const disc = couponResult?.discountAmount ?? 0;
                  const grand = isRepeat
                    ? (isChecking ? null : Math.max(0, (checkResult ? effectiveTotalPrice : totalPrice * repeatCount) - disc))
                    : Math.max(0, totalPrice - disc);
                  return (
                    <>
                      <div className="flex justify-between font-bold text-lg pt-2 border-t">
                        <span>{t("Grand Total", "Grand Total")}</span>
                        <span className="text-primary">{grand == null ? "..." : formatCurrency(grand)}</span>
                      </div>
                      {isRepeat && !isChecking && checkResult && effectiveCount > 0 && (
                        <div className="text-xs text-muted-foreground text-right">
                          {effectiveCount} {t("sesi", "sessions")} × {formatCurrency(grand! / effectiveCount)}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </CardContent>

            <CardFooter className="bg-muted/30 pt-4 border-t hidden lg:block">
              <Button
                type="submit"
                form="booking-form"
                size="lg"
                className="w-full text-base font-bold h-12"
                disabled={createBooking.isPending || createRecurring.isPending || (isRepeat && isChecking) || isPreparing}
                onClick={handleSubmit}
              >
                {(createBooking.isPending || createRecurring.isPending || isPreparing)
                  ? <><Loader2 size={16} className="mr-2 animate-spin" /> {t("Memproses...", "Processing...")}</>
                  : isRepeat
                    ? `${t("Konfirmasi", "Confirm")} ${isChecking ? "..." : effectiveCount || (checkResult?.validCount ?? repeatCount)} ${t("Booking", "Bookings")}`
                    : t("Konfirmasi Booking", "Confirm Booking")
                }
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
