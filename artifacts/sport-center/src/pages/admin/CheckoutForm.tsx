type CombinedGymReceipt = {
  id:number;amount:number;method:string;paymentDate:string;status:string;
  proofUrl:string;bankMutationId:number|null;allocationCount:number;allocationSum:number;
  allocations:Array<{pin:string;name:string;kind:"new"|"renew";membershipId:number|null;amount:number;status:string}>;
};

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListFacilities, useListCustomers } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ShoppingCart, CheckCircle2, ArrowLeft, RefreshCw, CalendarDays, XCircle, ChevronsUpDown, Check } from "lucide-react";
import { getToken, getCurrentRole } from "@/lib/auth";

type CompletedGymBooking = {
  action: "new" | "renew";
  membershipId: number;
  paymentId: number;
  name: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  paymentMethod: string;
  paymentDate: string;
};

function formatGymCompletionDay(value: string): string {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return value || "—";
  const parsed = new Date(value + "T00:00:00Z");
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC", day: "numeric", month: "long", year: "numeric",
  }).format(parsed);
}

function gymMemberStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    active: "Aktif",
    grace_period: "Masa Tenggang",
    pending_payment: "Menunggu Pembayaran",
    waiting_confirmation: "Menunggu Konfirmasi Pembayaran",
    confirmed: "Lunas",
    expired: "Kedaluwarsa",
    cancelled: "Dibatalkan",
    review_required: "Perlu Verifikasi",
    suspended: "Ditangguhkan",
  };
  return labels[status] ?? status.split("_").map(word => word ? word[0].toUpperCase() + word.slice(1) : "").join(" ");
}

function jakartaDateOnly(): string {
  // formatToParts keeps YYYY-MM-DD stable across browser/ICU locale variations.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/**
 * Mirror resolveGymRenewalStart from the API.
 * A member whose active membership is still inside the 7-day grace window
 * continues from the old end date; a lapsed member starts TODAY in Jakarta.
 * Calendar arithmetic uses UTC to avoid browser timezone rollover.
 * These are ISO calendar dates, not localized display strings.
 */
function previewGymRenewalPeriod(
  status: string,
  previousEnd: string,
  today: string,
  months: number,
  enabled: boolean,
  requestedStart = "",
): {start: string; end: string} {
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(value + "T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
  };
  if (!enabled || !validDate(previousEnd) || !validDate(today) ||
      !Number.isInteger(months) || months < 1 || months > 12) {
    return {start: "", end: ""};
  }
  const endMs = Date.parse(previousEnd + "T00:00:00Z");
  const todayMs = Date.parse(today + "T00:00:00Z");
  const inGrace = status === "active" && todayMs <= endMs + 7 * 86400000;
  // A selected start is only allowed for a fully lapsed membership.
  // The server enforces the same date range and checks it again at submit.
  const earliest = new Date(todayMs - 30 * 86400000).toISOString().slice(0, 10);
  const defaultStart = inGrace
    ? new Date(endMs + 86400000).toISOString().slice(0, 10)
    : today;
  if (requestedStart && (inGrace || !validDate(requestedStart) ||
      requestedStart < earliest || requestedStart > today || requestedStart <= previousEnd)) {
    return {start:"", end:""};
  }
  const startDate = requestedStart || defaultStart;
  const start = new Date(startDate + "T00:00:00Z");
  const targetMonthIndex = start.getUTCMonth() + months;
  const targetYear = start.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(start.getUTCDate(), lastDay);
  const periodEnd = new Date(Date.UTC(targetYear, targetMonth, targetDay))
    .toISOString().slice(0, 10);
  return {start: startDate, end: periodEnd};
}

export default function AdminCheckoutForm() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerPickerListHeight, setCustomerPickerListHeight] = useState(280);
  const [companyCustomerDetail, setCompanyCustomerDetail] = useState<null | {
    id: number; name: string; phone: string | null; email: string | null;
    accountType: string; picEmail?: string | null;
  }>(null);
  const [companyCustomerDetailState, setCompanyCustomerDetailState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [slotOptions, setSlotOptions] = useState<Array<{time: string; available: boolean; reason: string | null}>>([]);
  const [slotState, setSlotState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [selectedFacilityId, setSelectedFacilityId] = useState("");
  const [selectedActivityType, setSelectedActivityType] = useState("");
  const [x904IdentityType, setX904IdentityType] = useState<"pin" | "card">("card");
  const [x904IdentityValue, setX904IdentityValue] = useState("");
  const [x904VisitorName, setX904VisitorName] = useState("");
  const [x904NameSearch, setX904NameSearch] = useState("");
  const [x904MachineUsers, setX904MachineUsers] = useState<Array<{userPin:string;deviceUid:number;displayName:string}>>([]);
  const [x904NameLookupError, setX904NameLookupError] = useState("");
  const [newX904PinMode, setNewX904PinMode] = useState<"manual"|"generate">("generate");
  const [newX904ManualPin, setNewX904ManualPin] = useState("");
  const [newX904CommandId, setNewX904CommandId] = useState("");
  const [newX904ReservedPin, setNewX904ReservedPin] = useState("");
  const [newX904PreviewPin, setNewX904PreviewPin] = useState("");
  const [newX904Busy, setNewX904Busy] = useState(false);
  const [newX904Notice, setNewX904Notice] = useState("");
  const [membershipX904Pin, setMembershipX904Pin] = useState("");
  const [membershipX904Search, setMembershipX904Search] = useState("");
  const [membershipX904Candidates, setMembershipX904Candidates] = useState<Array<{pin:string;uid:number;name:string;available:boolean;mappedMembershipId:number|null;membershipStatus:string|null}>>([]);
  const [membershipX904SelectedUid, setMembershipX904SelectedUid] = useState<number|null>(null);
  const [membershipX904IdentityConfirmed, setMembershipX904IdentityConfirmed] = useState(false);
  const [membershipX904Name, setMembershipX904Name] = useState("");
  const [membershipX904Error, setMembershipX904Error] = useState("");
  const [membershipX904Checking, setMembershipX904Checking] = useState(false);
  const [x904VerifiedName, setX904VerifiedName] = useState("");
  const [x904VerificationError, setX904VerificationError] = useState("");
  const [x904Verifying, setX904Verifying] = useState(false);
  const [startTime, setStartTime] = useState("");
  const [bookingDay, setBookingDay] = useState("");
  const [endTime, setEndTime] = useState("");
  const [duration, setDuration] = useState("1");
  const [bookingKind, setBookingKind] = useState("personal");
  const [eventPayer, setEventPayer] = useState("personal");
  const [memberAction, setMemberAction] = useState("new");
  const [memberId, setMemberId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [memberMonths, setMemberMonths] = useState("1");
  const [renewalStartOverride, setRenewalStartOverride] = useState("");
  const [members, setMembers] = useState<Array<{id:number; name:string; phone:string; status:string; endDate:string}>>([]);
  const [memberLoadError, setMemberLoadError] = useState("");
  const [membershipResult, setMembershipResult] = useState("");
  const [membershipConfirmOpen, setMembershipConfirmOpen] = useState(false);
  const [membershipPaymentTarget, setMembershipPaymentTarget] = useState<null | {
    membershipId: number;
    action: "new" | "renew";
    name: string;
    periodStart: string;
    periodEnd: string;
    amount: number;
  }>(null);
  const [membershipPaymentMethod, setMembershipPaymentMethod] = useState("qris");
  const [membershipProofUploaded, setMembershipProofUploaded] = useState(false);
  const [membershipPaymentDate, setMembershipPaymentDate] = useState(jakartaDateOnly);
  const [membershipPaymentFile, setMembershipPaymentFile] = useState<File | null>(null);
  const [membershipPaymentBusy, setMembershipPaymentBusy] = useState(false);
  const [membershipPaymentDone, setMembershipPaymentDone] = useState(false);
  const [completedGymBooking, setCompletedGymBooking] = useState<CompletedGymBooking | null>(null);
  // One externally received transfer, multiple member allocations; never auto-confirm.
  const [combinedOpen, setCombinedOpen] = useState(false);
  const [combinedDate, setCombinedDate] = useState(jakartaDateOnly);
  const [combinedMethod, setCombinedMethod] = useState("qris");
  const [combinedProof, setCombinedProof] = useState<File | null>(null);
  const [combinedRows, setCombinedRows] = useState<Array<{pin:string;kind:"new"|"renew";membershipId:string}>>([
    {pin:"",kind:"new",membershipId:""},
    {pin:"",kind:"renew",membershipId:""},
  ]);
  const [combinedBusy, setCombinedBusy] = useState(false);
  const [combinedOutcome, setCombinedOutcome] = useState("");
  const [combinedReceipts, setCombinedReceipts] = useState<CombinedGymReceipt[]>([]);
  const [combinedReviewError, setCombinedReviewError] = useState("");
  const [combinedReviewLoading, setCombinedReviewLoading] = useState(false);
  const [combinedApprovingId, setCombinedApprovingId] = useState<number|null>(null);


  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<string | null>(null);
  const [createdBookingId, setCreatedBookingId] = useState<number | null>(null);
  const [createdBookingAmount, setCreatedBookingAmount] = useState<number>(0);
  const [paymentChoice, setPaymentChoice] = useState<"paid" | "unpaid" | null>(null);
  const [suppressCustomerWhatsApp, setSuppressCustomerWhatsApp] = useState(false);
  const [paymentProof, setPaymentProof] = useState<File | null>(null);
  const [paidMethod, setPaidMethod] = useState("Transfer Bank");
  const [bookingPaymentDate, setBookingPaymentDate] = useState(jakartaDateOnly);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentSubmitted, setPaymentSubmitted] = useState(false);
  const [createdPaymentId, setCreatedPaymentId] = useState<number | null>(null);
  const [createdPaymentError, setCreatedPaymentError] = useState("");
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  type BookingPattern = {
    startDate: string; startTime: string; durationHours: number;
    repeatType: "weekly" | "monthly"; repeatCount: number;
    dates: string[]; pricePerSession: number;
  };
  const [multiPatterns, setMultiPatterns] = useState<BookingPattern[]>([]);
  const [repeatType, setRepeatType] = useState<"weekly" | "monthly">("weekly");
  const [repeatCount, setRepeatCount] = useState(4);
  const [repeatPreview, setRepeatPreview] = useState<null | {
    dates: Array<{ date: string; available: boolean; reason: string | null }>;
    validCount: number;
    pricePerSession: number;
    totalPrice: number;
  }>(null);
  const [repeatCheckState, setRepeatCheckState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [repeatPreviewKey, setRepeatPreviewKey] = useState("");
  const [repeatError, setRepeatError] = useState("");
  const [createdRecurringGroupRef, setCreatedRecurringGroupRef] = useState<string | null>(null);
  const [createdRecurringOrders, setCreatedRecurringOrders] = useState<string[]>([]);
  const [createdRecurringSkipped, setCreatedRecurringSkipped] = useState<string[]>([]);
  const [createdRecurringTotal, setCreatedRecurringTotal] = useState(0);

  const { data: facilitiesData } = useListFacilities();
  const { data: customersData } = useListCustomers();

  const facilities = Array.isArray(facilitiesData) ? facilitiesData : [];
  const activeFacilities = facilities.filter((f: any) => f.isActive === true);
  const customers = Array.isArray(customersData) ? customersData : [];
  const isGuest = selectedCustomerId === "__guest__";
  const isPastGuest = selectedCustomerId !== "" && selectedCustomerId !== "__guest__" && Number(selectedCustomerId) < 0;
  const guestBooking = isGuest || isPastGuest;
  const selectedCustomer: any = customers.find((c: any) => String(c.id) === selectedCustomerId);
  const filteredCustomers = customers.filter((c: any) =>
    [c.name, c.phone, c.email].some((field) => String(field ?? "").toLocaleLowerCase("id-ID").includes(customerSearch.trim().toLocaleLowerCase("id-ID")))
  );
  const facility: any = facilities.find((f: any) => String(f.id) === selectedFacilityId);
  const isMultigunaFacility = /multiguna/i.test(String(facility?.name ?? "") + " " + String(facility?.category ?? ""));
  const multigunaActivities = [
    {value:"futsal",label:"Futsal"},
    {value:"basket",label:"Basket"},
    {value:"voli",label:"Voli"},
  ];
  const isWalkIn = /gym|fitness/i.test(String(facility?.name ?? "") + " " + String(facility?.category ?? "")) || facility?.bookingMode === "walk_in";
  const selectedDate = bookingDay;
  const isGymNonmember = bookingKind === "personal" && /gym|fitness/i.test(String(facility?.name ?? "") + " " + String(facility?.category ?? ""));
  // Backdated admin bookings are accounting/history only, never a fresh door entitlement.
  const isHistoricalGymNonmember = isGymNonmember && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate) &&
    selectedDate < jakartaDateOnly();
  // Name search is only a picker for an existing numeric PIN; booking
  // and device authorization still validate the PIN on the server.
  useEffect(() => {
    if (!isGymNonmember || x904IdentityType !== "pin") return;
    const controller = new AbortController();
    setX904NameLookupError("");
    void (async () => {
      try {
        const response = await fetch("/api/admin/gym-x904/users", {
          headers: { Authorization: "Bearer " + (getToken() ?? "") },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Daftar nama mesin belum tersedia. PIN angka tetap dapat digunakan.");
        const data = await response.json();
        if (!controller.signal.aborted) setX904MachineUsers(Array.isArray(data.users)
          ? data.users.filter((u: any) => Number(u.deviceRole) === 0 &&
              /^[0-9]{1,8}$/.test(String(u.userPin)) && Number(u.deviceUid) > 0 &&
              String(u.displayName ?? "").trim())
            .map((u: any) => ({userPin:String(u.userPin),deviceUid:Number(u.deviceUid),
              displayName:String(u.displayName).trim()})) : []);
      } catch (error) {
        if (!controller.signal.aborted) setX904NameLookupError(error instanceof Error ? error.message : "Daftar mesin belum tersedia.");
      }
    })();
    return () => controller.abort();
  }, [isGymNonmember, x904IdentityType]);
  const x904NameMatches = x904NameSearch.trim().length >= 2
    ? x904MachineUsers.filter(u =>
        u.displayName.toLocaleLowerCase("id-ID").includes(x904NameSearch.trim().toLocaleLowerCase("id-ID")) ||
        u.userPin.includes(x904NameSearch.trim())).slice(0, 8)
    : [];
  useEffect(() => {
    if (isGymNonmember && isGuest && x904VerifiedName && !x904VerificationError)
      setGuestName(previous => previous.trim() ? previous : x904VerifiedName);
  }, [isGymNonmember, isGuest, x904VerifiedName, x904VerificationError]);
  useEffect(() => {
    setX904VerifiedName("");
    setX904VerificationError("");
    if (!isGymNonmember || !x904IdentityValue.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setX904Verifying(true);
      try {
        const query = new URLSearchParams({ type: x904IdentityType, value: x904IdentityValue.trim() });
        const response = await fetch("/api/wa/x904-identity?" + query, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || data.valid !== true || !data.displayName) throw new Error(data.error || "Identitas X904 tidak ditemukan");
        if (!controller.signal.aborted) setX904VerifiedName(data.displayName);
      } catch (error) {
        if (!controller.signal.aborted) setX904VerificationError(error instanceof Error ? error.message : "Verifikasi X904 gagal");
      } finally { if (!controller.signal.aborted) setX904Verifying(false); }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [isGymNonmember, x904IdentityType, x904IdentityValue]);
  const isMembership = bookingKind === "membership";
  const hideRegularBookingFields = isMembership && memberAction !== "new";
  const isCompanyPayer = bookingKind === "corporate" || (bookingKind === "event" && eventPayer === "corporate");
  // The admin customer dropdown is a listing cache. The canonical customer
  // details endpoint must establish company ownership before Corporate submit.
  useEffect(() => {
    setCompanyCustomerDetail(null);
    if (!isCompanyPayer || !selectedCustomerId || selectedCustomerId === "__guest__" ||
        !Number.isInteger(Number(selectedCustomerId)) || Number(selectedCustomerId) <= 0) {
      setCompanyCustomerDetailState("idle");
      return;
    }
    const controller = new AbortController();
    setCompanyCustomerDetailState("loading");
    fetch("/api/customers/" + encodeURIComponent(selectedCustomerId), {
      headers: { Authorization: "Bearer " + (getToken() ?? "") },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw Error("Tidak dapat memeriksa akun perusahaan");
      return response.json();
    }).then((data) => {
      if (controller.signal.aborted) return;
      if (Number(data.id) !== Number(selectedCustomerId) || data.accountType !== "company") {
        throw Error("Pemesan tidak terdaftar sebagai akun perusahaan");
      }
      setCompanyCustomerDetail({
        id: Number(data.id), name: String(data.name ?? ""),
        phone: data.phone ?? null, email: data.email ?? null,
        accountType: String(data.accountType), picEmail: data.picEmail ?? null,
      });
      setCompanyCustomerDetailState("ready");
    }).catch(() => {
      if (!controller.signal.aborted) {
        setCompanyCustomerDetail(null);
        setCompanyCustomerDetailState("error");
      }
    });
    return () => controller.abort();
  }, [isCompanyPayer, selectedCustomerId]);
  // The authenticated customer list already contains company account metadata.
  // A failed secondary detail request must not invalidate a listed company.
  // The booking API independently verifies persisted billing authorization.
  const listedCompanyCustomer = isCompanyPayer &&
    Number(selectedCustomer?.id) === Number(selectedCustomerId) &&
    Number(selectedCustomerId) > 0 &&
    selectedCustomer?.accountType === "company"
      ? selectedCustomer : null;
  const detailedCompanyCustomer = isCompanyPayer && companyCustomerDetailState === "ready" &&
    companyCustomerDetail?.id === Number(selectedCustomerId)
      ? companyCustomerDetail : null;
  const verifiedCompanyCustomer = detailedCompanyCustomer ?? listedCompanyCustomer;
  // Prefer the detailed contact, falling back to the authenticated list/PIC
  // for the read-only WhatsApp field and booking contact snapshot.
  const bookingCustomer = verifiedCompanyCustomer
    ? {
        ...selectedCustomer,
        ...verifiedCompanyCustomer,
        phone: detailedCompanyCustomer?.phone?.trim() ||
          selectedCustomer?.phone?.trim() ||
          selectedCustomer?.picPhone?.trim() || null,
      }
    : selectedCustomer;
  const formatRupiah = (amount: number) => "Rp " + amount.toLocaleString("id-ID");
  const estimatedBase = Number(facility?.pricePerHour ?? 0) * (isWalkIn ? 1 : Number(duration));
  const apMember = selectedCustomer?.apMember ?? null;
  const isActiveApMember = Boolean(apMember?.isActive && apMember?.idCardNumber);
  const apDiscountEnabled = Boolean(isActiveApMember && apMember?.discountActive);
  const isApMultiguna = /multiguna/i.test(String(facility?.name ?? "") + " " + String(facility?.category ?? ""));
  const apDiscountForPrice = (basePrice: number) => {
    if (!apDiscountEnabled || basePrice <= 0) return 0;
    if (isApMultiguna) return Math.max(0, basePrice - Math.min(basePrice, 300000 * (isWalkIn ? 1 : Number(duration))));
    const fixed = Number(apMember?.discountAmount ?? 0);
    const percentage = Number(apMember?.discountPercentage ?? 0);
    return fixed > 0
      ? Math.min(Math.round(fixed), basePrice)
      : Math.min(Math.round(basePrice * percentage / 100), basePrice);
  };
  const estimatedEventDiscount = bookingKind === "event" ? Math.round(estimatedBase * 0.214) : 0;
  const estimatedApDiscount = isActiveApMember ? apDiscountForPrice(estimatedBase) : 0;
  const estimatedDiscount = isActiveApMember ? estimatedApDiscount : estimatedEventDiscount;
  const apDiscountLabel = isApMultiguna
    ? "Harga khusus AP Multiguna"
    : Number(apMember?.discountAmount ?? 0) > 0
      ? `Potongan tetap ${formatRupiah(Number(apMember.discountAmount))}`
      : `Diskon Member AP (${Number(apMember?.discountPercentage ?? 0)}%)`;
  const estimatedBeforeTax = Math.max(0, estimatedBase - estimatedDiscount);
  const repeatApDiscount = repeatPreview ? apDiscountForPrice(Number(repeatPreview.pricePerSession)) : 0;
  const repeatBaseTotal = repeatPreview ? Number(repeatPreview.pricePerSession) * repeatCount : 0;
  const repeatAdditionalCharges = repeatPreview ? Math.max(0, Number(repeatPreview.totalPrice) - Number(repeatPreview.pricePerSession) * Number(repeatPreview.validCount)) : 0;
  const repeatApTotal = Math.max(0, repeatBaseTotal - repeatApDiscount * repeatCount + repeatAdditionalCharges);
  const slotValid = isMembership || (isWalkIn ? Boolean(selectedDate) : slotState === "ready" && slotOptions.some((x) => x.available && x.time.slice(0, 5) === startTime.slice(11, 16)));
  const repeatCurrentKey = [selectedFacilityId, selectedDate, startTime.slice(11, 16), duration, repeatType, repeatCount].join("|");
  const repeatAllAvailable = Boolean(repeatPreview && repeatPreview.dates.length === repeatCount && repeatPreview.dates.every((row) => row.available));
  const repeatPreviewCurrent = repeatPreviewKey === repeatCurrentKey && repeatCheckState === "ready";
  // A complete recurring preview is the authoritative availability check for
  // all of its dates. The single-day slot endpoint may disagree for historic
  // admin bookings, so do not gate a recurring submission on that separate API.
  const recurringScheduleValid = repeatEnabled && !isWalkIn &&
    repeatCount >= 2 && repeatCount <= 52 && repeatPreviewCurrent && repeatAllAvailable;
  const bookingScheduleValid = multiPatterns.length > 0 || (repeatEnabled ? recurringScheduleValid : slotValid);
  const customerFormValid = isGuest
    ? Boolean(guestName.trim() && /^\+?[0-9]{9,15}$/.test(guestPhone.replace(/[\s()-]/g, "")))
    : Boolean((!isCompanyPayer || verifiedCompanyCustomer) &&
      bookingCustomer?.name && bookingCustomer?.phone);
  const formPaymentValid = paymentChoice === "unpaid" ||
    (paymentChoice === "paid" && Boolean(paymentProof && bookingPaymentDate && bookingPaymentDate <= jakartaDateOnly() &&
      (paidMethod === "Transfer Bank" || paidMethod === "QRIS")));
  const repeatFormValid = multiPatterns.length > 0 || !repeatEnabled || recurringScheduleValid;
  // bookingKind has a valid default; it is intentionally not an additional
  // explicit-completion requirement for enabling the submit button.
  // Multi-jadwal has no active single-day slot after the admin adds a pattern.
  // Keep the primary action clickable for this mode and explain any remaining
  // validation problem, rather than silently disabling it.
  const multiScheduleBlockers: string[] = multiPatterns.length === 0 ? [] : [
    ...(!selectedCustomerId || !customerFormValid ? ["Pilih pelanggan dengan nama dan nomor WhatsApp yang valid."] : []),
    ...(!selectedFacilityId || !activeFacilities.some((item: any) => String(item.id) === selectedFacilityId)
      ? ["Pilih fasilitas aktif."] : []),
    ...(isMultigunaFacility && !multigunaActivities.some((item) => item.value === selectedActivityType)
      ? ["Pilih jenis olahraga (Futsal, Basket, atau Voli)."] : []),
    ...(multiPatterns.reduce((sum, pattern) => sum + pattern.dates.length, 0) > 52
      ? ["Maksimal 52 sesi dalam satu grup."] : []),
    ...(isSubmitting ? ["Sedang memproses booking."] : []),
    ...(paymentChoice !== "unpaid" && paymentChoice !== "paid" ? ["Pilih status pembayaran."] : []),
    ...(!formPaymentValid ? ["Lengkapi bukti dan tanggal pembayaran."] : []),
    ...(isWalkIn || isActiveApMember || bookingKind === "event"
      ? ["Jenis fasilitas atau pelanggan ini tidak mendukung booking multi-jadwal."] : []),
    ...(isCompanyPayer && (paymentChoice !== "unpaid" || isGuest || !verifiedCompanyCustomer)
      ? [companyCustomerDetailState === "loading"
          ? "Memverifikasi akun perusahaan..."
          : "Corporate harus menggunakan akun perusahaan terdaftar dan Belum Bayar."] : []),
    ...(!isCompanyPayer && selectedCustomer?.accountType === "company"
      ? ["Ubah jenis pemesanan menjadi Corporate untuk pelanggan perusahaan."] : []),
  ];
  // Explicit Corporate validation feedback. The final submit handler and backend
  // retain all original requirements; the button only ceases to hide errors.
  const corporateSubmitBlockers: string[] = !isCompanyPayer || multiPatterns.length > 0 ? [] : [
    ...(!selectedCustomerId ? ["Pilih pelanggan perusahaan."] : []),
    ...(selectedCustomerId && companyCustomerDetailState === "loading" && !verifiedCompanyCustomer
      ? ["Memverifikasi akun perusahaan..."] : []),
    ...(selectedCustomerId && companyCustomerDetailState === "error" && !verifiedCompanyCustomer
      ? ["Verifikasi perusahaan gagal. Pilih ulang pelanggan."] : []),
    ...(selectedCustomerId && companyCustomerDetailState !== "loading" && !verifiedCompanyCustomer
      ? ["Akun perusahaan belum terverifikasi."] : []),
    ...(selectedCustomerId && !bookingCustomer?.phone ? ["Nomor WhatsApp pelanggan belum tersedia."] : []),
    ...(!selectedFacilityId ? ["Pilih fasilitas."] : []),
    ...(selectedFacilityId && !activeFacilities.some((f: any) => String(f.id) === selectedFacilityId)
      ? ["Fasilitas tidak aktif."] : []),
    ...(isMultigunaFacility && !multigunaActivities.some(a => a.value === selectedActivityType)
      ? ["Pilih olahraga Multiguna."] : []),
    ...(!selectedDate ? ["Pilih tanggal booking."] : []),
    ...(selectedDate && !isWalkIn && !startTime ? ["Pilih jam mulai."] : []),
    ...(selectedDate && !isWalkIn && startTime && !bookingScheduleValid
      ? [repeatEnabled
        ? (repeatCheckState === "loading" ? "Memeriksa jadwal berulang..." : "Preview jadwal berulang belum valid.")
        : slotState === "loading" ? "Memeriksa ketersediaan..."
        : slotState === "error" ? "Gagal memeriksa ketersediaan slot."
        : "Jam telah dipilih, tetapi slot belum dinyatakan tersedia oleh server. Periksa tanggal atau jam lain."]
      : []),
    ...(paymentChoice !== "unpaid" ? ["Pilih Belum Bayar untuk perusahaan."] : []),
  ];
  const canSubmitBooking = Boolean(
    selectedCustomerId &&
    customerFormValid &&
    selectedFacilityId &&
    activeFacilities.some((item: any) => String(item.id) === selectedFacilityId) &&
    (!isMultigunaFacility || multigunaActivities.some(a => a.value === selectedActivityType)) &&
    (selectedDate || multiPatterns.length > 0) &&
    bookingScheduleValid &&
    !isSubmitting &&
    paymentChoice !== null &&
    formPaymentValid &&
    (!isGymNonmember || (isHistoricalGymNonmember && !x904IdentityValue.trim()) ||
      (Boolean(x904VerifiedName) && !x904Verifying && !x904VerificationError)) &&
    repeatFormValid &&
    (multiPatterns.length === 0 || (!isWalkIn && !isActiveApMember && bookingKind !== "event")) &&
    (!isCompanyPayer || (paymentChoice === "unpaid" && !isGuest && verifiedCompanyCustomer?.accountType === "company")) &&
    (isCompanyPayer || selectedCustomer?.accountType !== "company")
  );

  useEffect(() => {
    if (!selectedFacilityId || !selectedDate || isWalkIn || !Number.isInteger(Number(duration)) || Number(duration) < 1) {
      setSlotOptions([]);
      setSlotState("idle");
      return;
    }
    const controller = new AbortController();
    setSlotState("loading");
    const q = new URLSearchParams({ facilityId: selectedFacilityId, date: selectedDate, durationHours: duration });
    fetch("/api/availability?" + q.toString(), {
      headers: { Authorization: "Bearer " + (getToken() ?? "") },
      signal: controller.signal,
    }).then(async (r) => {
      if (!r.ok) throw Error("Slot tidak dapat diperiksa");
      return r.json();
    }).then((rows) => {
      if (!controller.signal.aborted) {
        setSlotOptions(Array.isArray(rows) ? rows : []);
        setSlotState("ready");
      }
    }).catch(() => {
      if (!controller.signal.aborted) setSlotState("error");
    });
    return () => controller.abort();
  }, [selectedFacilityId, selectedDate, duration, isWalkIn]);

  useEffect(() => {
    if (!repeatEnabled) {
      setRepeatPreview(null); setRepeatCheckState("idle"); setRepeatPreviewKey(""); setRepeatError("");
      return;
    }
    if (!selectedFacilityId || !selectedDate || !startTime || isWalkIn || !Number.isInteger(Number(duration)) || Number(duration) < 1) {
      setRepeatPreview(null); setRepeatCheckState("idle"); setRepeatPreviewKey("");
      return;
    }
    const controller = new AbortController();
    const previewKey = [selectedFacilityId, selectedDate, startTime.slice(11, 16), duration, repeatType, repeatCount].join("|");
    setRepeatCheckState("loading"); setRepeatPreview(null); setRepeatPreviewKey(""); setRepeatError("");
    fetch("/api/bookings/recurring/check", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (getToken() ?? "") },
      body: JSON.stringify({
        facilityId: Number(selectedFacilityId), startDate: selectedDate, startTime: startTime.slice(11, 16),
        durationHours: Number(duration), repeatType, repeatCount,
      }),
      signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Preview jadwal berulang gagal diperiksa");
      return data;
    }).then((data) => {
      if (controller.signal.aborted) return;
      setRepeatPreview({
        dates: Array.isArray(data.dates) ? data.dates : [],
        validCount: Number(data.validCount ?? 0),
        pricePerSession: Number(data.pricePerSession ?? 0),
        totalPrice: Number(data.totalPrice ?? 0),
      });
      setRepeatPreviewKey(previewKey); setRepeatCheckState("ready");
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setRepeatError(error instanceof Error ? error.message : "Preview jadwal berulang gagal diperiksa");
      setRepeatCheckState("error"); setRepeatPreview(null); setRepeatPreviewKey("");
    });
    return () => controller.abort();
  }, [repeatEnabled, selectedFacilityId, selectedDate, startTime, duration, repeatType, repeatCount, isWalkIn]);

  useEffect(() => {
    if (!isMembership) return;
    let active = true;
    fetch("/api/memberships", {headers:{Authorization: "Bearer " + (getToken() ?? "")}})
      .then(async r => { if (!r.ok) throw Error("Tidak dapat membaca daftar membership"); return r.json(); })
      .then(rows => { if(active) {setMembers(Array.isArray(rows) ? rows : []); setMemberLoadError("");} })
      .catch(e => {if(active) setMemberLoadError(String(e.message || e));});
    return () => {active = false;};
  }, [isMembership]);
  useEffect(() => {
    if (!isMembership || memberAction !== "new" || membershipX904Pin || membershipX904Search.trim().length < 2) {
      setMembershipX904Candidates([]);
      setMembershipX904Checking(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setMembershipX904Checking(true);
      setMembershipX904Error("");
      try {
        const q = new URLSearchParams({q:membershipX904Search.trim()});
        const response = await fetch("/api/memberships/admin-x904-candidates?" + q, {
          headers:{Authorization:"Bearer " + (getToken() ?? "")},
          signal:controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Pencarian mesin gagal");
        if (!controller.signal.aborted) setMembershipX904Candidates(Array.isArray(data.candidates) ? data.candidates : []);
      } catch (error) {
        if (!controller.signal.aborted) {
          setMembershipX904Candidates([]);
          setMembershipX904Error(error instanceof Error ? error.message : "Pencarian X904 gagal");
        }
      } finally {
        if (!controller.signal.aborted) setMembershipX904Checking(false);
      }
    }, 350);
    return () => {window.clearTimeout(timer);controller.abort();};
  },[isMembership,memberAction,membershipX904Search,membershipX904Pin]);
  const matchedMember = members.find(m => String(m.id) === memberId);
  const gymCanConfirm = ["owner","admin","super_admin","finance","admin_booking"].includes(String(getCurrentRole()));
  const {data: currentGymPayments,refetch: refreshGymPayments} = useQuery<Array<{
    id:number;membershipId:number;periodStart:string;periodEnd:string;months:number;
    amount:number;status:string;paymentProofUrl?:string|null;
  }>>({
    queryKey:["membership-checkout-payments",memberId],
    enabled:isMembership && memberAction === "renew" && Boolean(memberId),
    queryFn:async()=>{
      const response=await fetch(`/api/memberships/${memberId}/payments`,{
        headers:{Authorization:`Bearer ${getToken() ?? ""}`},
      });
      if(!response.ok)throw Error("Riwayat pembayaran membership gagal dimuat");
      return response.json();
    },
  });
  const unfinishedGymPayment = (currentGymPayments ?? []).find(p =>
    p.status === "pending_payment" || p.status === "waiting_confirmation");

  async function showGymBookingCompletion(
    membershipId: number,
    paymentId: number,
    action: "new" | "renew",
    fallback: Omit<CompletedGymBooking, "membershipId" | "paymentId" | "action">,
  ) {
    // Show a completed state only after the backend has confirmed the payment.
    // Hydrate the exact period and payment date from the saved transaction,
    // rather than the pre-payment member dropdown (which may still show grace_period).
    let completed: CompletedGymBooking = {membershipId,paymentId,action,...fallback};
    try {
      const headers={Authorization:`Bearer ${getToken() ?? ""}`};
      const [memberResponse,paymentsResponse]=await Promise.all([
        fetch(`/api/memberships/${membershipId}`,{headers}),
        fetch(`/api/memberships/${membershipId}/payments`,{headers}),
      ]);
      if (memberResponse.ok && paymentsResponse.ok) {
        const member=await memberResponse.json();
        const payments=await paymentsResponse.json() as Array<{
          id:number;status:string;periodStart:string;periodEnd:string;
          amount:number;paymentDate?:string|null;paymentMethod?:string|null;
        }>;
        const payment=payments.find(p=>p.id===paymentId && p.status==="confirmed");
        if (payment) {
          completed={
            membershipId,paymentId,action,
            name:String(member.name || fallback.name),
            periodStart:payment.periodStart,periodEnd:payment.periodEnd,
            amount:Number(payment.amount),paymentDate:payment.paymentDate || fallback.paymentDate,
            paymentMethod:payment.paymentMethod || fallback.paymentMethod,
          };
        }
      }
    } catch {
      // The confirmation response already succeeded; summary fetch is best effort.
    }
    setCompletedGymBooking(completed);
  }

  async function retryGymAdminConfirmation(membershipId:number,paymentId:number) {
    if(!gymCanConfirm) return;
    setMembershipPaymentBusy(true);
    try {
      const response=await fetch(`/api/memberships/${membershipId}/admin-finalize-payment`,{
        method:"POST",headers:{
          Authorization:`Bearer ${getToken() ?? ""}`,"Content-Type":"application/json",
        },body:JSON.stringify({paymentId}),
      });
      const data=await response.json();
      if(!response.ok)throw Error(data.error || "Pembayaran belum dapat diselesaikan");
      await showGymBookingCompletion(membershipId,paymentId,"renew",{
        name:membershipPaymentTarget?.name || matchedMember?.name || "Member",
        periodStart:membershipPaymentTarget?.periodStart || unfinishedGymPayment?.periodStart || "",
        periodEnd:membershipPaymentTarget?.periodEnd || unfinishedGymPayment?.periodEnd || "",
        amount:membershipPaymentTarget?.amount || Number(unfinishedGymPayment?.amount || 0),
        paymentMethod:membershipPaymentMethod,paymentDate:membershipPaymentDate,
      });
      setMembershipPaymentDone(true);
      setMembershipProofUploaded(true);
      setMembershipResult("Pembayaran sudah terkonfirmasi. Perpanjangan membership selesai.");
      toast({title:"Pembayaran membership lunas",description:"Transaksi lama berhasil diselesaikan tanpa booking baru."});
      await refreshGymPayments();
    } catch(err) {
      toast({title:"Konfirmasi belum selesai",description:err instanceof Error?err.message:"Silakan ulangi penyelesaian payment yang sama.",variant:"destructive"});
    } finally {setMembershipPaymentBusy(false);}
  }

  const renewalPeriodPreview = previewGymRenewalPeriod(
    matchedMember?.status ?? "",
    matchedMember?.endDate ?? "",
    jakartaDateOnly(),
    Number(memberMonths || 1),
    memberAction === "renew",
    renewalStartOverride,
  );
  const renewalStartDate = renewalPeriodPreview.start;
  const renewalEndDate = renewalPeriodPreview.end;
  const membershipCharge = 300000 * Number(memberMonths || 1);
  const renewalPeriodValid = memberAction !== "renew" ||
    Boolean(renewalStartDate && renewalEndDate && renewalStartDate <= renewalEndDate);

  async function previewNewX904Pin() {
    setNewX904Busy(true);
    setNewX904PreviewPin("");
    setNewX904Notice("");
    try {
      const query = new URLSearchParams({mode:newX904PinMode,pin:newX904ManualPin});
      const response = await fetch("/api/memberships/admin-x904-pin-preview?"+query.toString(),{
        method:"GET",headers:{Authorization:"Bearer "+(getToken()??"")},cache:"no-store",
      });
      const data = await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(data.error||"PIN tidak dapat diperiksa.");
      if(data.previewOnly!==true || data.reserved!==false || data.availableInSnapshot!==true)
        throw new Error("Hasil pemeriksaan PIN tidak valid.");
      if(!/^[1-9][0-9]{2}$/.test(String(data.pin??"")))
        throw new Error("PIN hasil pratinjau tidak valid.");
      setNewX904PreviewPin(String(data.pin));
      setNewX904Notice(data.snapshotStale===true
        ? "PIN "+data.pin+" kandidat dari snapshot "+Number(data.snapshotAgeMinutes)+" menit lalu (belum real-time). Sinkronisasi mesin wajib sebelum membuat user. PIN belum dipesan atau dibuat."
        : "PIN "+data.pin+" belum digunakan dalam snapshot terbaru. Ini hanya pratinjau, belum dipesan atau dibuat di mesin X904.");
    } catch(error){
      setNewX904Notice(error instanceof Error?error.message:"Pemeriksaan PIN gagal.");
    } finally {setNewX904Busy(false);}
  }

  async function queueNewX904User() {
    const name = (isGuest ? guestName : String(selectedCustomer?.name ?? "")).trim();
    if (!/^[A-Za-z0-9 ._-]{2,24}$/.test(name)) {
      setNewX904Notice("Isi nama pemesan terlebih dahulu (2–24 karakter sesuai batas mesin X904).");
      return;
    }
    setNewX904Busy(true); setNewX904Notice("");
    try {
      const response=await fetch("/api/memberships/admin-x904-create-user", {
        method:"POST",
        headers:{Authorization:"Bearer "+(getToken()??""),"Content-Type":"application/json"},
        body:JSON.stringify({mode:newX904PinMode, pin:newX904ManualPin, name}),
      });
      const data=await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(data.error || "Pembuatan user X904 gagal.");
      setNewX904ReservedPin(String(data.pin));
      setNewX904CommandId(String(data.commandId));
      setMembershipX904Pin("");setMembershipX904Name("");
      setMembershipX904SelectedUid(null);setMembershipX904IdentityConfirmed(false);
      setNewX904Notice("PIN "+data.pin+" masuk antrean mesin. Belum boleh digunakan untuk pembayaran. Periksa ACK dan snapshot.");
    } catch(error) {
      setNewX904Notice(error instanceof Error?error.message:"Pembuatan user X904 gagal.");
    } finally {setNewX904Busy(false);}
  }

  async function verifyNewX904User() {
    if (!newX904CommandId || !newX904ReservedPin) return;
    setNewX904Busy(true);setNewX904Notice("");
    try {
      const auth={Authorization:"Bearer "+(getToken()??"")};
      const status=await fetch("/api/admin/gym-x904/user-command/"+encodeURIComponent(newX904CommandId),
        {headers:auth,cache:"no-store"});
      const details=await status.json().catch(()=>({}));
      if(!status.ok) throw new Error(details.error||"Status command belum tersedia.");
      const command=details.command;
      if(command?.state!=="completed" || command?.result?.readBackConfirmed!==true){
        setNewX904Notice("Perintah masih "+String(command?.state??"menunggu")+
          ". Perlu ACK/read-back mesin resmi sebelum membuat membership.");
        return;
      }
      const readinessResponse=await fetch(
        "/api/memberships/admin-x904-create-user/"+encodeURIComponent(newX904CommandId)+"/readiness",
        {headers:auth,cache:"no-store"});
      const readiness=await readinessResponse.json().catch(()=>({}));
      if(!readinessResponse.ok)throw new Error(readiness.error||"Verifikasi keamanan akses X904 gagal.");
      if(readiness.ready!==true || readiness.accessHeld!==true){
        setNewX904Notice("User belum boleh diproses: tunggu snapshot akses Grup 2, Disabled, dan ACK yang cocok.");
        return;
      }
      const candidatesResponse=await fetch(
        "/api/memberships/admin-x904-candidates?q="+encodeURIComponent(newX904ReservedPin),
        {headers:auth,cache:"no-store"});
      const data=await candidatesResponse.json().catch(()=>({}));
      if(!candidatesResponse.ok)throw new Error(data.error||"Snapshot mesin belum dapat dibaca.");
      const expectedName=(isGuest?guestName:String(selectedCustomer?.name??"")).trim();
      const item=(Array.isArray(data.candidates)?data.candidates:[]).find((row:any)=>
        row.pin===newX904ReservedPin && row.name===expectedName &&
        row.available && Number.isSafeInteger(row.uid) && row.uid>0);
      if(!item){setNewX904Notice("ACK ada, tetapi PIN/nama/UID belum ditemukan pada snapshot LAN terbaru. Muat ulang setelah sinkronisasi.");return;}
      setMembershipX904Pin(item.pin);
      setMembershipX904Name(item.name);
      setMembershipX904SelectedUid(item.uid);
      setMembershipX904Search(item.name+" · PIN "+item.pin);
      setMembershipX904IdentityConfirmed(false);
      setMembershipX904Error("");
      setNewX904Notice("PIN "+item.pin+" sudah terverifikasi pada mesin. Centang konfirmasi identitas untuk melanjutkan.");
    }catch(error){
      setNewX904Notice(error instanceof Error?error.message:"Verifikasi user X904 belum selesai.");
    }finally{setNewX904Busy(false);}
  }

  const membershipReady = memberAction === "new"
    ? Boolean((isGuest ? guestName : selectedCustomer?.name)?.trim() && (isGuest ? guestPhone : selectedCustomer?.phone)?.trim()
      && (isGuest ? guestEmail : selectedCustomer?.email)?.trim() && selectedDate && selectedCustomerId
      && membershipX904Name && membershipX904IdentityConfirmed && membershipX904Pin && membershipX904SelectedUid !== null && !membershipX904Checking && !membershipX904Error)
    : Boolean(matchedMember && !memberLoadError && renewalPeriodValid && (memberAction !== "checkin" || matchedMember.status === "active"));
  // Only show the reason the submit button is blocked; this does not
  // bypass any server-side X904, duplicate-member, or payment validation.
  const membershipNewBlockers = memberAction !== "new" ? [] : [
    ...(!selectedCustomerId ? ["Pilih customer baru atau customer yang sudah terdaftar."] : []),
    ...(!(isGuest ? guestName : selectedCustomer?.name)?.trim() ? ["Nama pemesan wajib diisi."] : []),
    ...(!(isGuest ? guestPhone : selectedCustomer?.phone)?.trim() ? ["Nomor WhatsApp wajib diisi."] : []),
    ...(!(isGuest ? guestEmail : selectedCustomer?.email)?.trim() ? ["Email wajib diisi."] : []),
    ...(!selectedDate ? ["Tanggal mulai membership wajib dipilih."] : []),
    ...(!membershipX904Pin || membershipX904SelectedUid === null || !membershipX904Name
      ? ["Pilih user X904 yang sudah ada, atau selesaikan pembuatan user baru dan verifikasi ACK/snapshot terlebih dahulu."] : []),
    ...(!membershipX904IdentityConfirmed ? ["Centang konfirmasi kecocokan pemilik PIN X904."] : []),
    ...(membershipX904Checking ? ["Pemeriksaan inventaris X904 masih berjalan."] : []),
    ...(membershipX904Error ? ["Pemeriksaan X904: " + membershipX904Error] : []),
    ...(getCurrentRole() !== "staff" && !membershipPaymentFile ? ["Pilih bukti pembayaran."] : []),
    ...(getCurrentRole() !== "staff" && !membershipPaymentDate ? ["Tanggal pembayaran wajib diisi."] : []),
    ...(getCurrentRole() !== "staff" && membershipPaymentDate > jakartaDateOnly()
      ? ["Tanggal pembayaran tidak boleh di masa depan."] : []),
  ];
  // Restore the authoritative receipt state when returning after a session
  // redirect or a successful approval. Never rely on a stale client-only card.
  useEffect(() => {
    if (["owner","super_admin","admin","finance","admin_booking"].includes(getCurrentRole()??"")) {
      void loadCombinedReceipts();
    }
  }, []);

  async function loadCombinedReceipts() {
    if (!["owner","super_admin","admin","finance","admin_booking"].includes(getCurrentRole() ?? "")) return;
    setCombinedReviewLoading(true);
    setCombinedReviewError("");
    try {
      const response=await fetch("/api/memberships/admin-combined-receipts",{
        headers:{Authorization:"Bearer "+(getToken()??"")},cache:"no-store",
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(data.error || "Gagal memuat pembayaran gabungan");
      setCombinedReceipts(Array.isArray(data.receipts)?data.receipts:[]);
    } catch(error) {
      setCombinedReviewError(error instanceof Error?error.message:"Tidak dapat memuat daftar bukti");
    } finally {setCombinedReviewLoading(false);}
  }

  async function approveCombinedPhoto(receipt: CombinedGymReceipt) {
    if (combinedApprovingId!=null || receipt.status!=="awaiting_bank_verification" ||
        receipt.allocationCount!==receipt.allocations.length || receipt.allocationSum!==receipt.amount) return;
    if (!window.confirm(`Saya telah memeriksa foto Bukti #${receipt.id} untuk ${receipt.allocations.length} anggota, total ${formatRupiah(receipt.amount)}. Setujui pembayaran BERDASARKAN FOTO (bukan verifikasi bank), proses membership, dan antrikan aktivasi X904?`)) return;
    setCombinedApprovingId(receipt.id);
    setCombinedReviewError("");
    try {
      const resp=await fetch(`/api/memberships/admin-combined-receipts/${receipt.id}/approve-photo`, {
        method:"POST",
        headers:{"Content-Type":"application/json",Authorization:"Bearer "+(getToken()??"")},
        body:JSON.stringify({confirmPhoto:true,acknowledgeNotBankVerified:true}),
      });
      const data=await resp.json().catch(()=>({}));
      if(!resp.ok) throw new Error(data.error||"Persetujuan foto gagal. Tidak ada transaksi yang diulang.");
      setCombinedOutcome(`Bukti #${receipt.id} disetujui berdasarkan foto untuk ${data.allocations?.length??0} membership. Menunggu ACK mesin X904, bukan verifikasi bank.`);
      await loadCombinedReceipts();
    } catch(error) {
      setCombinedReviewError(error instanceof Error?error.message:"Gagal menyetujui bukti gabungan.");
    } finally {setCombinedApprovingId(null);}
  }

  async function submitCombinedReceipt(event: React.FormEvent) {
    event.preventDefault();
    if (combinedBusy) return;
    if (!combinedProof || combinedRows.length < 2 || combinedRows.some(row => !/^[0-9]{1,8}$/.test(row.pin) ||
        (row.kind === "renew" && !/^[1-9][0-9]*$/.test(row.membershipId)))) {
      setCombinedOutcome("Lengkapi bukti, dua PIN terdaftar, dan ID membership untuk perpanjangan.");
      return;
    }
    setCombinedBusy(true);
    setCombinedOutcome("");
    try {
      const payload = new FormData();
      payload.append("paymentMethod",combinedMethod);
      payload.append("paymentDate",combinedDate);
      payload.append("amount",String(combinedRows.length * 300000));
      payload.append("allocations",JSON.stringify(combinedRows.map(row=>({
        userPin:row.pin, kind:row.kind,
        membershipId:row.kind === "renew" ? Number(row.membershipId) : null,
        amount:300000,
      }))));
      payload.append("proof",combinedProof);
      const response=await fetch("/api/memberships/admin-combined-receipt",{
        method:"POST",headers:{Authorization:"Bearer "+(getToken()??"")},body:payload,
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(result.error || "Bukti gabungan belum dapat dicatat.");
      setCombinedOutcome(`Bukti #${result.receiptId} tercatat untuk ${combinedRows.length} penerima: ${formatRupiah(Number(result.amount))}. Nomor internal dibuat otomatis. Status menunggu verifikasi bank; membership belum lunas dan X904 belum aktif.`);
      void loadCombinedReceipts();
    } catch(error) {
      setCombinedOutcome(error instanceof Error ? error.message : "Pencatatan bukti gabungan gagal.");
    } finally {setCombinedBusy(false);}
  }

  async function submitMembership() {
    if (!membershipReady || isSubmitting) return;
    // Authorized admin registration: one request, one DB transaction, one payment.
    if (memberAction === "new" && getCurrentRole() !== "staff") {
      if (!membershipPaymentFile || !membershipPaymentDate || membershipPaymentDate > jakartaDateOnly()) {
        toast({title:"Bukti pembayaran wajib",description:"Unggah bukti dan isi tanggal pembayaran yang benar.",variant:"destructive"});
        return;
      }
      setIsSubmitting(true);
      setMembershipResult("");
      try {
        const form = new FormData();
        form.append("name",isGuest ? guestName.trim() : String(selectedCustomer?.name ?? ""));
        form.append("phone",isGuest ? guestPhone.trim() : String(selectedCustomer?.phone ?? ""));
        form.append("email",isGuest ? guestEmail.trim() : String(selectedCustomer?.email ?? ""));
        form.append("months",memberMonths);
        form.append("startDate",selectedDate);
        form.append("notes",notes);
        form.append("x904Pin",membershipX904Pin.trim());
        form.append("x904VerifiedName",membershipX904Name);
        form.append("x904IdentityConfirmed",String(membershipX904IdentityConfirmed));
        form.append("paymentMethod",membershipPaymentMethod);
        form.append("paymentDate",membershipPaymentDate);
        form.append("proof",membershipPaymentFile);
        const response = await fetch("/api/memberships/admin-register-paid",{
          method:"POST",
          headers:{Authorization:"Bearer " + (getToken() ?? "")},
          body:form,
        });
        const result = await response.json();
        if(!response.ok) throw Error(result.error || "Pendaftaran dan pembayaran gagal");
        await showGymBookingCompletion(Number(result.membershipId),Number(result.paymentId),"new",{
          name:isGuest ? guestName.trim() : String(selectedCustomer?.name ?? "Member"),
          periodStart:selectedDate,periodEnd:"",
          amount:Number(memberMonths)*300000,
          paymentMethod:membershipPaymentMethod,paymentDate:membershipPaymentDate,
        });
        setMembershipPaymentDone(true);
        setMembershipPaymentFile(null);
        setMembershipResult(`Customer #${result.customerId} · Membership #${result.membershipId} · Pembayaran #${result.paymentId} terkonfirmasi. Akses X904 menunggu ACK perangkat.`);
        toast({title:"Pendaftaran & pembayaran berhasil",description:"Customer, membership dan pembayaran telah tersimpan satu kali."});
      } catch(e) {
        toast({title:"Pendaftaran belum berhasil",description:e instanceof Error ? e.message : "Periksa riwayat sebelum mengulangi.",variant:"destructive"});
      } finally {
        setIsSubmitting(false);
      }
      return;
    }
    setIsSubmitting(true);
    setMembershipResult("");
    try {
      const endpoint = memberAction === "new" ? "/api/memberships"
        : "/api/memberships/" + memberId + (memberAction === "renew" ? (gymCanConfirm || renewalStartOverride ? "/admin-renew" : "/renew") : "/checkin");
      const payload = memberAction === "new"
        ? {name:isGuest ? guestName.trim() : selectedCustomer.name,
           phone:isGuest ? guestPhone.trim() : selectedCustomer.phone,
           email:isGuest ? guestEmail.trim() : selectedCustomer.email,
           startDate:selectedDate, months:Number(memberMonths), notes}
        : memberAction === "renew" ? {months:Number(memberMonths), ...(renewalStartOverride ? { startDate: renewalStartOverride } : {})}
          : {checkinDate:selectedDate, notes};
      const response = await fetch(endpoint, {method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer " + (getToken() ?? "")},body:JSON.stringify(payload)});
      const data = await response.json();
      if(!response.ok) throw Error(data.error || "Proses membership gagal");
      if (memberAction !== "checkin" && Number.isInteger(Number(data.id)) && Number(data.id) > 0) {
        const target = memberAction === "renew"
          ? {
              membershipId: Number(data.id),
              action: "renew" as const,
              name: String(data.name ?? matchedMember?.name ?? "Member"),
              periodStart: String(data.renewal?.periodStart ?? renewalStartDate ?? ""),
              periodEnd: String(data.renewal?.periodEnd ?? renewalEndDate ?? ""),
              amount: Number(data.renewal?.amount ?? membershipCharge),
            }
          : {
              membershipId: Number(data.id),
              action: "new" as const,
              name: String(data.name ?? (isGuest ? guestName : selectedCustomer?.name) ?? "Member"),
              periodStart: String(data.startDate ?? selectedDate ?? ""),
              periodEnd: String(data.endDate ?? ""),
              amount: Number(data.totalPrice ?? Number(memberMonths) * 300000),
            };
        setMembershipPaymentTarget(target);
        setMembershipPaymentMethod("qris");
        setMembershipPaymentDate(jakartaDateOnly());
        setMembershipPaymentFile(null);
        setMembershipPaymentDone(false);
        setMembershipResult(memberAction === "renew"
          ? "Perpanjangan berhasil dibuat. Selesaikan pembayaran di bawah ini."
          : "Member berhasil didaftarkan. Selesaikan pembayaran di bawah ini.");
        toast({title:memberAction === "renew" ? "Perpanjangan dibuat" : "Member didaftarkan",description:"Lanjutkan pembayaran pada halaman ini."});
        return;
      }
      setMembershipResult("Kunjungan berhasil dicatat tanpa tagihan baru.");
      toast({title:"Berhasil",description:"Kunjungan member berhasil dicatat."});
    } catch(e) {toast({title:"Membership gagal",description:e instanceof Error ? e.message : "Terjadi kesalahan",variant:"destructive"});}
    finally {setIsSubmitting(false);}
  }

  async function submitMembershipPaymentInline() {
    if (!membershipPaymentTarget || (!membershipPaymentFile && !membershipProofUploaded) || membershipPaymentBusy || membershipPaymentDone) return;
    setMembershipPaymentBusy(true);
    try {
      const token = getToken();
      if (membershipProofUploaded) {
        // Proof was durably saved in an earlier call. Never upload it a second time.
        const current = unfinishedGymPayment ?? (await refreshGymPayments()).data?.find(p => p.status === "waiting_confirmation");
        if (!current) throw Error("Payment ID tertunda belum tersedia; buka riwayat membership terlebih dahulu");
        setMembershipPaymentBusy(false);
        await retryGymAdminConfirmation(membershipPaymentTarget.membershipId,current.id);
        return;
      }
      const form = new FormData();
      if (membershipPaymentFile) form.append("proof", membershipPaymentFile);
      form.append("paymentMethod", membershipPaymentMethod);
      form.append("paymentDate", membershipPaymentDate);
      const response = await fetch(`/api/memberships/${membershipPaymentTarget.membershipId}/admin-payment-proof-upload`, {
        method:"POST",headers:{Authorization:`Bearer ${token ?? ""}`},body:form,
      });
      const result=await response.json();
      if (!response.ok && response.status !== 202)
        throw Error(result.error || "Unggah bukti pembayaran gagal");
      setMembershipProofUploaded(true);
      setMembershipPaymentFile(null);
      await refreshGymPayments();
      if (result.paymentStatus === "confirmed") {
        await showGymBookingCompletion(membershipPaymentTarget.membershipId,Number(result.paymentId),
          membershipPaymentTarget.action,{
            name:membershipPaymentTarget.name,
            periodStart:membershipPaymentTarget.periodStart,
            periodEnd:membershipPaymentTarget.periodEnd,
            amount:membershipPaymentTarget.amount,
            paymentMethod:membershipPaymentMethod,
            paymentDate:membershipPaymentDate,
          });
        setMembershipPaymentDone(true);
        setMembershipResult(membershipPaymentTarget.action === "renew"
          ? "Pembayaran terkonfirmasi. Perpanjangan membership selesai."
          : "Pembayaran terkonfirmasi. Pendaftaran membership selesai.");
        toast({title:"Pembayaran membership lunas",description:"Bukti dan konfirmasi diproses oleh server dalam satu permintaan."});
      } else if (gymCanConfirm) {
        setMembershipResult("Bukti sudah disimpan. Konfirmasi belum selesai — gunakan tombol Selesaikan Konfirmasi.");
        toast({title:"Bukti aman, konfirmasi perlu dilanjutkan",description:"Tidak perlu mengunggah ulang atau membuat tagihan baru.",variant:"destructive"});
      } else {
        setMembershipPaymentDone(true);
        setMembershipResult("Bukti pembayaran berhasil dikirim dan menunggu verifikasi.");
      }
    } catch(err) {
      toast({title:"Periksa status pembayaran",description:err instanceof Error?err.message:"Jangan membuat tagihan baru sebelum memeriksa riwayat.",variant:"destructive"});
      await refreshGymPayments();
    } finally {setMembershipPaymentBusy(false);}
  }

  async function recordBookingPayment(
    bookingId: number,
    amount: number,
    proof: File,
    paymentDate: string,
    method: string,
  ): Promise<boolean> {
    if (!bookingId || !(amount > 0) || !proof || !paymentDate || paymentBusy) return false;
    setPaymentBusy(true);
    setCreatedPaymentError("");
    try {
      const headers = { Authorization: "Bearer " + (getToken() ?? "") };
      let paymentId = createdPaymentId;

      // If the payment row already exists but confirmation failed, retry only
      // the confirmation. Never create a second financial payment row.
      if (!paymentId) {
        const fileForm = new FormData();
        fileForm.append("proof", proof);
        const uploaded = await fetch("/api/payments/proof-upload", { method: "POST", headers, body: fileForm });
        const fileResult = await uploaded.json();
        if (!uploaded.ok) throw Error(fileResult.error || "Upload bukti gagal");

        const detected = String(fileResult.ocrScan?.paymentMethod ?? "").toLowerCase();
        if (fileResult.ocrScan?.confidence === "high" && detected &&
          ((detected === "qris") !== (method === "QRIS"))) {
          throw Error("Metode terpilih tidak sesuai OCR. Periksa bukti lalu pilih metode yang benar.");
        }

        const payload = {
          bookingId,
          amount,
          paymentType: "full_payment",
          paymentMethod: method,
          ...(method === "QRIS" ? { paymentProvider: "mandiri_direct" } : {}),
          paymentDate,
          proofUrl: fileResult.objectPath ?? fileResult.url,
          ocrScanToken: fileResult.ocrScanToken,
        };
        const saved = await fetch("/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(payload),
        });
        const result = await saved.json();
        if (!saved.ok) throw Error(result.error || "Gagal mencatat pembayaran");
        paymentId = Number(result.id);
        if (!Number.isInteger(paymentId) || paymentId <= 0) {
          throw Error("Bukti terkirim, tetapi ID pembayaran tidak diterima. Periksa Detail Pemesanan sebelum mengirim ulang.");
        }
        setCreatedPaymentId(paymentId);
      }

      const currentRole = getCurrentRole();
      if (currentRole && currentRole !== "staff") {
        const confirmed = await fetch(`/api/payments/${paymentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ status: "confirmed" }),
        });
        const confirmedResult = await confirmed.json();
        if (!confirmed.ok) throw Error(confirmedResult.error || "Bukti tersimpan, tetapi konfirmasi pembayaran gagal");
        setPaymentSubmitted(true);
        toast({ title: "Pembayaran dikonfirmasi", description: "Satu pembayaran tercatat untuk booking/grup." });
      } else {
        setPaymentSubmitted(true);
        toast({ title: "Bukti pembayaran dicatat", description: "Menunggu verifikasi admin/finance." });
      }
      setCreatedPaymentError("");
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Silakan periksa bukti pembayaran.";
      setCreatedPaymentError(message);
      toast({ title: "Booking dibuat, pembayaran perlu diperiksa", description: message, variant: "destructive" });
      return false;
    } finally {
      setPaymentBusy(false);
    }
  }


  // Auto-compute endTime whenever startTime or duration changes
  const computedEndTime = (() => {
    if (!startTime) return "";
    const dt = new Date(startTime);
    dt.setHours(dt.getHours() + Number(duration || 1));
    const y = dt.getFullYear();
    const mo = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    const h = String(dt.getHours()).padStart(2, "0");
    const mi = String(dt.getMinutes()).padStart(2, "0");
    return `${y}-${mo}-${d}T${h}:${mi}`;
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Combined membership uses the dedicated proof/allocation transaction,
    // never the regular single-booking submission path.
    if (bookingKind === "membership_combined") {
      setCombinedOpen(true);
      return;
    }
    if (bookingKind === "membership") {
      setLocation("/admin/memberships");
      return;
    }
    if (corporateSubmitBlockers.length > 0) {
      toast({
        title: "Periksa booking perusahaan",
        description: corporateSubmitBlockers.join(" "),
        variant: "destructive",
      });
      return;
    }
    if (multiPatterns.length > 0 && multiScheduleBlockers.length > 0) {
      toast({
        title: "Booking belum dapat dibuat",
        description: multiScheduleBlockers.join(" "),
        variant: "destructive",
      });
      return;
    }
    if (!selectedCustomerId) {
      toast({ title: "Pilih customer terlebih dahulu", variant: "destructive" });
      return;
    }
    if (isGuest && (!guestName.trim() || !/^\+?[0-9]{9,15}$/.test(guestPhone.replace(/[\s()-]/g, "")))) {
      toast({ title: "Nama dan nomor WhatsApp tamu wajib valid", variant: "destructive" });
      return;
    }
    if (isGymNonmember && x904IdentityType === "card" && x904IdentityValue.trim() &&
        !isHistoricalGymNonmember && !/^[\p{L}\p{M}\p{N} .'-]{2,100}$/u.test(x904VisitorName.trim().replace(/\s+/g, " "))) {
      toast({ title: "Isi nama orang yang memakai kartu", description: "Nama pengunjung wajib diisi, berbeda dari identitas kartu VIS.", variant: "destructive" });
      return;
    }
    if (!selectedFacilityId) {
      toast({ title: "Pilih fasilitas terlebih dahulu", variant: "destructive" });
      return;
    }
    if (isMultigunaFacility && !multigunaActivities.some(a => a.value === selectedActivityType)) {
      toast({ title: "Pilih Jenis Fasilitas / Olahraga", description:"Lapangan Multiguna membutuhkan pilihan Futsal, Basket, atau Voli.", variant:"destructive" });
      return;
    }
    if (!activeFacilities.some((f: any) => String(f.id) === selectedFacilityId)) {
      toast({ title: "Fasilitas sedang maintenance atau tidak tersedia untuk booking", variant: "destructive" });
      return;
    }
    if (!multiPatterns.length && (!selectedDate || (!isWalkIn && !startTime))) {
      toast({ title: "Pilih tanggal dan jam booking", variant: "destructive" });
      return;
    }

    if (!bookingScheduleValid) {
      toast({
        title: repeatEnabled ? "Jadwal berulang belum siap" : "Slot tidak tersedia atau belum diperiksa",
        description: repeatEnabled ? "Pastikan seluruh sesi pada preview telah dinyatakan tersedia." : undefined,
        variant: "destructive",
      });
      return;
    }
    if (paymentChoice !== "paid" && paymentChoice !== "unpaid") {
      toast({ title: "Pilih Sudah Bayar atau Belum Bayar", variant: "destructive" });
      return;
    }
    if (isCompanyPayer && paymentChoice === "paid") {
      toast({ title: "Pembayaran perusahaan mengikuti proses invoice", description: "Pilih Belum Bayar untuk membuat booking perusahaan.", variant: "destructive" });
      return;
    }
    if (paymentChoice === "paid" && (!paymentProof || !bookingPaymentDate || bookingPaymentDate > jakartaDateOnly())) {
      toast({ title: "Bukti pembayaran dan tanggal transaksi wajib diisi dengan benar", variant: "destructive" });
      return;
    }
    const corporate = bookingKind === "corporate" || (bookingKind === "event" && eventPayer === "corporate");
    if (!corporate && selectedCustomer?.accountType === "company") {
      toast({ title: "Untuk akun perusahaan, pilih jenis Corporate atau pembayar perusahaan", variant: "destructive" });
      return;
    }
    if (corporate && (isGuest || !verifiedCompanyCustomer)) {
      toast({ title: "Pilih akun perusahaan yang terdaftar", variant: "destructive" });
      return;
    }
    if (!guestBooking && Number(selectedCustomerId) <= 0) {
      toast({ title: "Pilih customer yang terdaftar; data tamu perlu didaftarkan terlebih dahulu", variant: "destructive" });
      return;
    }
    if (!isGuest && (!bookingCustomer?.name || !bookingCustomer?.phone)) {
      toast({ title: "Customer harus memiliki nama dan nomor WhatsApp", variant: "destructive" });
      return;
    }
    if (repeatEnabled && !multiPatterns.length) {
      if (isWalkIn) { toast({ title: "Booking berulang hanya tersedia untuk fasilitas dengan slot waktu", variant: "destructive" }); return; }
      if (repeatCount < 2 || repeatCount > 52) { toast({ title: "Jumlah sesi berulang harus antara 2 sampai 52", variant: "destructive" }); return; }
      if (!repeatPreviewCurrent || !repeatPreview) { toast({ title: "Preview jadwal berulang belum siap", description: "Tunggu pemeriksaan semua tanggal selesai sebelum menyimpan.", variant: "destructive" }); return; }
      if (!repeatAllAvailable) {
        const unavailable = repeatPreview.dates.filter((row) => !row.available).map((row) => row.date);
        toast({ title: "Ada jadwal yang bentrok atau tidak tersedia", description: unavailable.join(", ") || "Periksa kembali preview jadwal.", variant: "destructive" });
        return;
      }
    }
    setIsSubmitting(true);
    try {
      const bookingPayload = {
        customerId: guestBooking ? null : Number(selectedCustomerId),
        customerName: isGuest ? guestName.trim() : bookingCustomer.name,
        customerPhone: isGuest ? guestPhone.trim() : bookingCustomer.phone,
        // Company name is not an email address. Prefer a valid PIC email for corporate bookings.
        customerEmail: isGuest ? guestEmail.trim() : (
          corporate
            ? [bookingCustomer.picEmail, bookingCustomer.email]
                .map((value: unknown) => String(value ?? "").trim())
                .find((value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) ?? ""
            : (bookingCustomer.email ?? "")
        ),
        facilityId: Number(selectedFacilityId),
        ...(isMultigunaFacility ? {activityType:selectedActivityType} : {}),
        ...(!isWalkIn ? { startTime: startTime.slice(11, 16), durationHours: Number(duration) } : { numberOfPeople: 1 }),
        bookingType: bookingKind === "event" ? "event" : "regular",
        payerType: corporate ? "company" : "personal",
        ...(corporate ? { companyCustomerId: Number(selectedCustomerId) } : {}),
        source: "admin",
        ...(isGymNonmember && (!isHistoricalGymNonmember || x904IdentityValue.trim())
          ? { x904IdentityType, x904IdentityValue: x904IdentityValue.trim().toUpperCase(),
              ...(x904IdentityType === "card" ? { x904VisitorName: x904VisitorName.trim().replace(/\s+/g, " ") } : {}) } : {}),
        adminPaymentChoice: paymentChoice,
        ...(bookingKind === "corporate" ? { suppressCustomerWhatsApp } : {}),
        ...(isActiveApMember ? { customerType: "angkasa_pura", idCardNumber: apMember.idCardNumber } : {}),
        notes: notes || undefined,
      };
      const res = multiPatterns.length > 0
        ? await fetch("/api/bookings/admin-multi-schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + (getToken() ?? "") },
            body: JSON.stringify({
              ...bookingPayload,
              startDate: multiPatterns[0].startDate,
              startTime: multiPatterns[0].startTime,
              durationHours: multiPatterns[0].durationHours,
              multiSessions: multiPatterns.flatMap((pattern) =>
                pattern.dates.map((date) => ({
                  date, startTime: pattern.startTime, durationHours: pattern.durationHours,
                })),
              ),
            }),
          })
        : repeatEnabled
        ? await fetch("/api/bookings/recurring", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
            body: JSON.stringify({
              ...bookingPayload, startDate: selectedDate, repeatType, repeatCount,
              specificDates: repeatPreview!.dates.map((row) => row.date),
            }),
          })
        : await fetch("/api/bookings", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
            body: JSON.stringify({ ...bookingPayload, bookingDate: selectedDate }),
          });

      const data = await res.json();

      if (!res.ok) {
        toast({ title: "Booking gagal", description: data.error ?? "Terjadi kesalahan", variant: "destructive" });
        return;
      }

      if (multiPatterns.length > 0 || repeatEnabled) {
        const createdRows = Array.isArray(data.created) ? data.created : [];
        const orders = createdRows.map((row: any) => String(row.orderNumber ?? "").trim()).filter(Boolean);
        if (orders.length === 0) {
          toast({
            title: "Tidak ada sesi booking yang berhasil dibuat",
            description: Array.isArray(data.skipped) && data.skipped.length ? `Jadwal dilewati: ${data.skipped.join(", ")}` : "Periksa kembali ketersediaan jadwal.",
            variant: "destructive",
          });
          return;
        }
        const firstCreatedBookingId = Number(createdRows[0]?.id);
        const actualGroupTotal = Number(data.grandTotal ?? repeatPreview?.totalPrice ?? 0);
        if (!Number.isInteger(firstCreatedBookingId) || firstCreatedBookingId <= 0) {
          toast({ title: "Booking tersimpan, ID booking tidak diterima", description: "Periksa menu Pemesanan sebelum mengulang pembuatan agar tidak duplikat.", variant: "destructive" });
          return;
        }
        setCreatedRecurringOrders(orders);
        setCreatedRecurringGroupRef(typeof data.groupRef === "string" ? data.groupRef : null);
        setCreatedRecurringSkipped(Array.isArray(data.skipped) ? data.skipped : []);
        setCreatedRecurringTotal(actualGroupTotal);
        setCreatedBookingId(firstCreatedBookingId);
        setCreatedBookingAmount(actualGroupTotal);
        setCreatedOrder(orders[0]);
        setPaymentSubmitted(false);
        setCreatedPaymentId(null);
        if (paymentChoice === "paid" && paymentProof) {
          await recordBookingPayment(firstCreatedBookingId, actualGroupTotal, paymentProof, bookingPaymentDate, paidMethod);
        } else {
          toast({ title: `${orders.length} sesi booking berhasil dibuat`, description: data.groupRef ? `Grup ${data.groupRef} dibuat; belum ada record pembayaran.` : "Booking dibuat tanpa pembayaran." });
        }
        return;
      }

      // POST /api/bookings returns the created booking at the response root.
      // Support nested responses for compatibility, but never show Order: undefined.
      const created = data.booking ?? data;
      const order = typeof created.orderNumber === "string" ? created.orderNumber.trim() : "";
      const bookingId = Number(created.id);
      if (!order || !Number.isInteger(bookingId) || bookingId <= 0) {
        toast({ title: "Booking tersimpan, respons nomor order tidak lengkap", description: "Periksa menu Pemesanan sebelum mencoba lagi agar tidak membuat booking ganda.", variant: "destructive" });
        return;
      }
      const actualBookingAmount = Number(created.grandTotal ?? created.totalPrice ?? 0);
      setCreatedOrder(order);
      setCreatedBookingId(bookingId);
      setCreatedBookingAmount(actualBookingAmount);
      setPaymentSubmitted(false);
      setCreatedPaymentId(null);
      if (paymentChoice === "paid" && paymentProof) {
        await recordBookingPayment(bookingId, actualBookingAmount, paymentProof, bookingPaymentDate, paidMethod);
      } else {
        toast({ title: "Booking berhasil dibuat!", description: `Order: ${order}. Status: belum dibayar; belum ada record pembayaran.` });
      }

      // Reset opt-out for each new booking so a previous customer's choice
      // never silently affects the next booking.
      setSuppressCustomerWhatsApp(false);
      // Reset form
      setSelectedCustomerId("");
      setGuestName("");
      setGuestPhone("");
      setGuestEmail("");
      setSelectedFacilityId("");
      setStartTime("");
      setBookingDay("");
      setEndTime("");
      setDuration("1");

      setNotes("");
    } catch {
      toast({ title: "Gagal menghubungi server", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (createdOrder && createdRecurringOrders.length > 0) {
    return (
      <div className="max-w-2xl mx-auto py-16 px-4 space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle2 className="text-green-600 w-10 h-10" />
          </div>
          <h2 className="text-2xl font-black">Booking Berulang Berhasil Dibuat</h2>
          <p className="text-muted-foreground">{createdRecurringOrders.length} sesi berhasil dibuat.</p>
        </div>
        <Card>
          <CardHeader><CardTitle>Ringkasan Grup Booking</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {createdRecurringGroupRef && <div className="flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">Group ID</span><strong className="font-mono">{createdRecurringGroupRef}</strong></div>}
            <div className="flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">Total seluruh sesi</span><strong>{formatRupiah(createdRecurringTotal)}</strong></div>
            <div className="border-t pt-3 space-y-2">
              <p className="text-sm font-semibold">Nomor booking</p>
              {createdRecurringOrders.map((order) => <div key={order} className="flex items-center justify-between rounded-md border px-3 py-2"><span className="font-mono font-semibold">{order}</span><span className="text-xs text-green-700">Dibuat</span></div>)}
            </div>
            {createdRecurringSkipped.length > 0 && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-semibold flex items-center gap-2"><XCircle size={15} /> Sebagian tanggal tidak dibuat</p><p className="mt-1">Periksa tanggal berikut: {createdRecurringSkipped.join(", ")}</p></div>}
            <div className="rounded-md border p-3 space-y-2">
              <p className="font-semibold text-sm">Status pembayaran</p>
              {paymentChoice === "unpaid" ? (
                <p className="text-sm text-muted-foreground">Belum dibayar. Tidak ada record pembayaran yang dibuat. Pembayaran dapat dikelola kemudian dari menu Pemesanan.</p>
              ) : paymentSubmitted ? (
                <p className="text-sm font-medium text-green-700">{getCurrentRole() === "staff" ? "Bukti tercatat dan menunggu verifikasi admin/finance." : "Bukti tercatat dan pembayaran dikonfirmasi."}</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-amber-700">Booking sudah dibuat, tetapi pembayaran belum selesai diproses. Periksa Detail Pemesanan sebelum mencoba mengirim ulang.</p>
                  {createdPaymentError && <p className="text-xs text-destructive">{createdPaymentError}</p>}
                  <Button type="button" variant="outline" onClick={() => setLocation(`/admin/bookings?search=${encodeURIComponent(createdOrder ?? "")}`)}>Periksa Detail Pemesanan</Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Untuk grup, satu bukti pembayaran dicatat terhadap satu booking perwakilan; alokasi dan tagihan dihitung untuk seluruh Group ID.</p>
            </div>
          </CardContent>
          <CardFooter><Button type="button" onClick={() => setLocation("/admin/bookings")}>Buka Pemesanan</Button></CardFooter>
        </Card>
      </div>
    );
  }

  if (createdOrder) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-6">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
          <CheckCircle2 className="text-green-600 w-10 h-10" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-black mb-1">Booking Berhasil!</h2>
          <p className="text-muted-foreground">Order <span className="font-semibold text-foreground">{createdOrder}</span> telah dibuat.</p>
        </div>
        <div className="w-full max-w-xl rounded-xl border p-4 space-y-3">
          <p className="font-semibold">Status pembayaran</p>
          {paymentChoice === "unpaid" ? (
            <p className="text-sm text-muted-foreground">Belum dibayar. Tidak ada record pembayaran yang dibuat.</p>
          ) : paymentSubmitted ? (
            <p className="text-sm font-medium text-green-700">{getCurrentRole() === "staff" ? "Bukti tercatat dan menunggu verifikasi admin/finance." : "Bukti tercatat dan pembayaran dikonfirmasi."}</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-amber-700">Booking berhasil dibuat tetapi pembayaran belum selesai. Periksa Detail Pemesanan sebelum mengirim ulang.</p>
              {createdPaymentError && <p className="text-xs text-destructive">{createdPaymentError}</p>}
              <Button type="button" variant="outline" onClick={() => setLocation(`/admin/bookings?search=${encodeURIComponent(createdOrder ?? "")}`)}>Periksa Detail Pemesanan</Button>
            </div>
          )}

        </div>
        <div className="flex gap-3 flex-wrap justify-center">
          {(paymentChoice === "unpaid" || (paymentSubmitted && getCurrentRole()==="staff")) && (
            <Button onClick={() => setLocation(`/admin/bookings?search=${encodeURIComponent(createdOrder)}`)}>
              {paymentSubmitted ? "Lihat & Konfirmasi Pembayaran" : "Kelola Pembayaran"}
            </Button>
          )}
          <Button variant="outline" onClick={() => setLocation("/admin/bookings")}>Kembali ke Pemesanan</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto py-6 px-4 lg:px-6">
      <div className="mb-8">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-0.5 shrink-0"
            onClick={() => setLocation("/admin/bookings")}
            aria-label="Kembali ke halaman Pemesanan"
            title="Kembali ke Pemesanan"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
              <ShoppingCart className="text-primary w-8 h-8" />
              Buat Booking (Admin)
            </h1>
            <p className="text-muted-foreground mt-1">Booking melalui validasi jadwal, harga, pajak dan status pembayaran pada layanan utama.</p>
          </div>
        </div>
      </div>


      {isMembership && membershipPaymentDone && completedGymBooking ? (
        <Card>
          <CardHeader>
            <CardTitle>Ringkasan Membership Gym</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div role="status" className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-800 font-semibold">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              {completedGymBooking.action === "renew"
                ? "Pembayaran terkonfirmasi. Perpanjangan membership selesai."
                : "Pembayaran terkonfirmasi. Pendaftaran membership selesai."}
            </div>
            <div className="rounded-xl border bg-muted/20 px-4 py-2">
              {([
                ["Member",completedGymBooking.name],
                ["Membership",`#${completedGymBooking.membershipId}`],
                ["Status pembayaran","Lunas"],
                ["Status membership","Aktif Berbayar"],
                ["Periode baru",`${completedGymBooking.periodStart} – ${completedGymBooking.periodEnd || "Lihat Riwayat Membership"}`],
                ["Tagihan",formatRupiah(completedGymBooking.amount)],
                ["Metode pembayaran",completedGymBooking.paymentMethod === "transfer" ? "Transfer Bank" : "QRIS Mandiri"],
                ["Tanggal pembayaran",formatGymCompletionDay(completedGymBooking.paymentDate)],
              ] as Array<[string,string]>).map(([label,value])=>(
                <div key={label} className="flex justify-between gap-4 border-b last:border-b-0 py-2 text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <strong className="text-right">{value}</strong>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-orange-200 bg-orange-50/40 p-4 space-y-2">
              <p className="font-semibold">{completedGymBooking.action === "renew" ? "Pembayaran Perpanjangan Membership" : "Pembayaran Pendaftaran Membership"}</p>
              <p className="text-sm text-muted-foreground">{completedGymBooking.name} · {completedGymBooking.periodStart} s/d {completedGymBooking.periodEnd}</p>
              <div className="flex justify-between gap-4 text-sm"><span>Tagihan</span><strong>{formatRupiah(completedGymBooking.amount)}</strong></div>
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-800">
                {completedGymBooking.action === "renew" ? "Perpanjangan dan pembayaran sudah selesai." : "Pendaftaran dan pembayaran sudah selesai."}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Akses X904 tetap memerlukan ACK/read-back perangkat sebelum dinyatakan aktif.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Button type="button" variant="outline" className="w-full" onClick={()=>setLocation("/admin/memberships")}>
                Lihat Riwayat Membership & Pembayaran
              </Button>
              <Button type="button" className="w-full" onClick={()=>setLocation("/admin/bookings")}>
                Kembali ke Pemesanan
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
      <form onSubmit={handleSubmit} className={isMembership ? "" : "grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(310px,1fr)] xl:items-start"}>
        <Card className="min-w-0 shadow-sm">
          <CardHeader>
            <CardTitle>{bookingKind === "membership_combined" ? "Booking Membership Gym — Pembayaran Gabungan" : isMembership && memberAction === "new" ? "Pendaftaran Member Gym Baru" : "Buat Booking Baru"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">

            <div className="space-y-2">
              <Label>Jenis pemesanan</Label>
              <Select value={bookingKind} onValueChange={(value) => { setBookingKind(value); if(value === "membership_combined") setCombinedOpen(true); setMultiPatterns([]); setRepeatEnabled(false); setSuppressCustomerWhatsApp(false); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal / Umum</SelectItem>
                  <SelectItem value="corporate">Perusahaan / Corporate</SelectItem>
                  <SelectItem value="membership">Membership Gym</SelectItem>
                  {["owner","super_admin","admin","finance","admin_booking"].includes(getCurrentRole() ?? "") &&
                    <SelectItem value="membership_combined">Membership Gym — Pembayaran Gabungan</SelectItem>}
                  <SelectItem value="event">Event / Kegiatan Khusus</SelectItem>
                </SelectContent>
              </Select>
              {bookingKind === "event" && <Select value={eventPayer} onValueChange={setEventPayer}>
                <SelectTrigger><SelectValue placeholder="Pihak pembayar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Dibayar personal</SelectItem>
                  <SelectItem value="corporate">Dibayar perusahaan</SelectItem>
                </SelectContent>
              </Select>}
              {bookingKind === "membership_combined" && (
                <p role="status" className="rounded-md border border-blue-200 p-3 text-sm">
                  Buat 2–10 alokasi member dengan satu bukti pembayaran di bagian Pembayaran Gabungan Membership Gym di bawah.
                  Setiap member mendapat booking sendiri. Satu bukti bukan verifikasi settlement bank.
                </p>
              )}
              {!isMembership && bookingKind !== "membership_combined" && <p className="text-xs text-muted-foreground">{isCompanyPayer ? "Penagihan mengikuti status approval dan konfigurasi invoice perusahaan; bukan otomatis menunggu pembayaran." : "Booking belum dianggap lunas. Bukti pembayaran perlu diverifikasi sebelum konfirmasi."}</p>}
              {bookingKind === "event" && <p className="text-xs text-amber-700">Alur ini untuk satu sesi event. Booking grup multi-sesi harus menggunakan alur grup khusus.</p>}
              {isMembership && <p className="text-xs text-muted-foreground">Kelola pendaftaran, perpanjangan, pembayaran, atau kunjungan member langsung dari halaman ini.</p>}
            </div>

            {bookingKind !== "membership_combined" && <>
            {!hideRegularBookingFields && <>
            {/* Customer */}
            <div className="space-y-2">
              <Label htmlFor="customer">Nama Pemesan <span className="text-destructive">*</span></Label>
              <Popover open={customerPickerOpen} onOpenChange={(open) => {
                if (open) {
                  // Fit the search results in the space below the input. The
                  // popover must remain below the field instead of flipping
                  // above and covering the Booking Admin page header.
                  const triggerBottom = document.getElementById("customer")?.getBoundingClientRect().bottom ?? 0;
                  const available = window.innerHeight - triggerBottom - 76;
                  setCustomerPickerListHeight(Math.max(96, Math.min(280, available)));
                } else {
                  setCustomerSearch("");
                }
                setCustomerPickerOpen(open);
              }}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    id="customer"
                    variant="outline"
                    role="combobox"
                    aria-expanded={customerPickerOpen}
                    aria-label="Nama Pemesan"
                    className="w-full min-w-0 justify-between gap-2 font-normal"
                  >
                    <span className="min-w-0 truncate text-left">
                      {isGuest
                        ? (isMembership ? "+ Customer Baru (Daftar Membership)" : "+ Pemesan belum terdaftar (Tamu)")
                        : selectedCustomer
                          ? `${selectedCustomer.name}${selectedCustomer.phone ? ` (${selectedCustomer.phone})` : ""}`
                          : "Pilih customer..."}
                    </span>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="bottom"
                  sideOffset={4}
                  avoidCollisions={false}
                  className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-24px)] overflow-hidden p-0"
                >
                  <Command shouldFilter={false}>
                    <CommandInput
                      autoFocus
                      aria-label="Cari nama atau nomor telepon pemesan"
                      placeholder="Cari nama / nomor telepon..."
                      value={customerSearch}
                      onValueChange={setCustomerSearch}
                    />
                    <CommandList
                      className="overflow-y-auto overscroll-contain"
                      style={{ maxHeight: customerPickerListHeight }}
                    >
                      <CommandItem value="__guest__" onSelect={() => {
                        setSelectedCustomerId("__guest__");
                        setCustomerPickerOpen(false);
                        setCustomerSearch("");
                      }} className="gap-2 py-2">
                        <Check className={`h-4 w-4 shrink-0 ${isGuest ? "opacity-100" : "opacity-0"}`} />
                        {isMembership ? "+ Customer Baru (Daftar Membership)" : "+ Pemesan belum terdaftar (Tamu)"}
                      </CommandItem>
                      {filteredCustomers.map((c: any) => (
                        <CommandItem key={c.id} value={String(c.id)} onSelect={() => {
                          setSelectedCustomerId(String(c.id));
                          setCustomerPickerOpen(false);
                          setCustomerSearch("");
                        }} className="min-w-0 gap-2 py-2">
                          <Check className={`h-4 w-4 shrink-0 ${selectedCustomerId === String(c.id) ? "opacity-100" : "opacity-0"}`} />
                          <span className="min-w-0 truncate">{c.name}{c.phone ? ` (${c.phone})` : ""}</span>
                        </CommandItem>
                      ))}
                      {filteredCustomers.length === 0 && (
                        <CommandEmpty>{customers.length === 0 ? "Tidak ada customer terdaftar" : "Tidak ada pemesan yang cocok"}</CommandEmpty>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {isGuest && <div className="space-y-3 rounded-lg border p-3">
              <Label htmlFor="guestName">Nama Pemesan Baru *</Label>
              <Input id="guestName" value={isMembership && memberAction === "new" && membershipX904Name ? membershipX904Name : guestName} onChange={(e) => setGuestName(e.target.value)} readOnly={isMembership && memberAction === "new" && Boolean(membershipX904Name)} placeholder={isMembership && memberAction === "new" ? "Pilih nama / PIN mesin X904 di bawah agar nama terisi otomatis" : undefined} required />
              {isMembership && memberAction === "new" && <p className="text-xs text-muted-foreground">Nama mengikuti identitas pada mesin X904. Pilih PIN di bagian Pengelolaan Member Gym; untuk mengganti nama, gunakan tombol Ganti pada PIN.</p>}
              <Label htmlFor="guestPhone">Nomor WhatsApp *</Label>
              <Input id="guestPhone" type="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} required />
              <Label htmlFor="guestEmail">{isMembership ? "Email *" : "Email (opsional)"}</Label>
              <Input id="guestEmail" type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} />
              <p className="text-xs text-muted-foreground">{isMembership ? "Customer akan dibuat tanpa kata sandi login, sekaligus dengan membership dan pembayaran." : "Pemesan tamu disimpan di booking; akun tidak otomatis dibuat."}</p>
            </div>}
            {!isGuest && selectedCustomer && <div className="space-y-2">
              <Label>Nomor Telepon / WhatsApp</Label>
              <Input value={bookingCustomer?.phone ?? ""} readOnly />
              {bookingKind === "corporate" && (
                <label htmlFor="suppress-corporate-customer-wa" className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm cursor-pointer">
                  <Checkbox
                    id="suppress-corporate-customer-wa"
                    checked={suppressCustomerWhatsApp}
                    onCheckedChange={(value) => setSuppressCustomerWhatsApp(value === true)}
                  />
                  <span>
                    <span className="font-medium">Tidak Kirim Pesan</span>
                    <span className="block text-xs text-muted-foreground">
                      Jangan kirim WhatsApp booking baru ke nomor pemesan ini. Laporan ke grup admin tetap dikirim.
                    </span>
                  </span>
                </label>
              )}
              {isCompanyPayer && companyCustomerDetailState === "loading" && (
                <p className="text-xs text-muted-foreground">Memverifikasi data akun perusahaan...</p>
              )}
              {isCompanyPayer && companyCustomerDetailState === "error" && (
                <p role="alert" className="text-xs text-destructive">Akun perusahaan belum dapat diverifikasi. Pilih ulang pelanggan atau periksa data perusahaan.</p>
              )}
              {isActiveApMember && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex rounded-full border border-sky-200 bg-white px-2 py-0.5 text-xs font-semibold text-sky-800">Member Angkasa Pura</span>
                    {apDiscountEnabled
                      ? <span className="inline-flex rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">{apDiscountLabel}</span>
                      : <span className="inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold text-slate-600">Diskon tidak aktif</span>}
                  </div>
                  <p className="text-xs text-slate-700">ID Card: <strong>{apMember.idCardNumber}</strong></p>
                  <p className="text-xs text-slate-600">Identitas cocok dengan nomor WhatsApp Member AP aktif. Harga akhir divalidasi ulang oleh server.</p>
                </div>
              )}
            </div>}
            {/* Facility */}
            {!isMembership && <div className="space-y-2">
              <Label htmlFor="facility">Fasilitas <span className="text-destructive">*</span></Label>
              <Select value={selectedFacilityId} onValueChange={(value) => { setSelectedFacilityId(value); setSelectedActivityType(""); setStartTime(""); setMultiPatterns([]); }}>
                <SelectTrigger id="facility">
                  <SelectValue placeholder="Pilih fasilitas..." />
                </SelectTrigger>
                <SelectContent>
                  {activeFacilities.map((f: any) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.name} — Rp {Number(f.pricePerHour).toLocaleString("id-ID")}{/gym|fitness/i.test(String(f.name ?? "") + " " + String(f.category ?? "")) || f.bookingMode === "walk_in" ? "/kunjungan" : "/jam"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>}

            {!isMembership && isMultigunaFacility && (
              <div className="space-y-2">
                <Label htmlFor="admin-multiguna-activity">Jenis Fasilitas / Olahraga <span className="text-destructive">*</span></Label>
                <Select value={selectedActivityType} onValueChange={setSelectedActivityType}>
                  <SelectTrigger id="admin-multiguna-activity">
                    <SelectValue placeholder="Pilih olahraga untuk Lapangan Multiguna" />
                  </SelectTrigger>
                  <SelectContent>
                    {multigunaActivities.map(activity => (
                      <SelectItem key={activity.value} value={activity.value}>{activity.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Futsal, Basket, dan Voli memakai lapangan dan jadwal yang sama. Harga dan ketersediaan tetap mengikuti Lapangan Multiguna.</p>
              </div>
            )}

            {isGymNonmember && <div className="space-y-3 rounded-lg border p-3">
              <Label>{isHistoricalGymNonmember
                ? "Referensi identitas X904 historis (opsional)"
                : "Identitas akses X904 (nonmember) *"}</Label>
              <Select value={x904IdentityType} onValueChange={(value) => { setX904IdentityType(value as "pin" | "card"); setX904IdentityValue(""); setX904VisitorName(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="card">Kartu pengunjung</SelectItem><SelectItem value="pin">PIN mesin X904</SelectItem></SelectContent>
              </Select>
              {x904IdentityType === "card" ? <Select value={x904IdentityValue} onValueChange={setX904IdentityValue}>
                <SelectTrigger><SelectValue placeholder="Pilih kartu VIS001–VIS006" /></SelectTrigger>
                <SelectContent>{Array.from({length: 6}, (_, i) => `VIS${String(i + 1).padStart(3, "0")}`).map((card) => <SelectItem key={card} value={card}>{card}</SelectItem>)}</SelectContent>
              </Select> : <div className="space-y-2">
                <Label htmlFor="admin-x904-name-search" className="text-xs">Cari nama atau PIN pada mesin</Label>
                <Input id="admin-x904-name-search" aria-label="Cari nama atau PIN pada mesin" autoComplete="off"
                  value={x904NameSearch} onChange={event => setX904NameSearch(event.target.value)}
                  placeholder="Contoh: YUDA atau 8" />
                {x904NameMatches.length > 0 && <div className="max-h-40 overflow-auto rounded-md border" role="listbox" aria-label="Pilih identitas mesin">
                  {x904NameMatches.map(user => <button type="button" key={user.userPin + ":" + user.deviceUid}
                    className="flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
                    onClick={() => {setX904IdentityValue(user.userPin);setX904NameSearch("");setX904VerifiedName("");setX904VerificationError("");}}>
                    <span>{user.displayName}</span><span className="text-muted-foreground">PIN {user.userPin}</span>
                  </button>)}
                </div>}
                {x904NameSearch.trim().length >= 2 && !x904NameMatches.length && !x904NameLookupError &&
                  <p className="text-xs text-muted-foreground">Nama tidak ditemukan dalam snapshot mesin. Masukkan PIN angka di bawah.</p>}
                {x904NameLookupError && <p className="text-xs text-amber-700">{x904NameLookupError}</p>}
                <Label htmlFor="admin-x904-pin" className="text-xs">PIN mesin X904 (angka)</Label>
                <Input id="admin-x904-pin" aria-label="PIN mesin X904" inputMode="numeric"
                  value={x904IdentityValue}
                  onChange={event => setX904IdentityValue(event.target.value.replace(/[^0-9]/g, "").slice(0, 8))}
                  placeholder="Contoh: 8" />
              </div>}
              {x904IdentityType === "card" && x904IdentityValue && (
                <div className="space-y-2 rounded-md bg-muted/40 p-3">
                  <Label htmlFor="x904-card-visitor-name">Nama pengunjung yang memakai kartu *</Label>
                  <Input id="x904-card-visitor-name" aria-label="Nama pengunjung yang memakai kartu"
                    value={x904VisitorName}
                    onChange={(event) => setX904VisitorName(event.target.value)}
                    maxLength={100} autoComplete="off" placeholder="Contoh: Budi Santoso" required={!isHistoricalGymNonmember} />
                  <p className="text-xs text-muted-foreground">Identitas mesin tetap {x904IdentityValue}. Nama orang ini dicatat terpisah pada riwayat booking, bukan mengganti nama atau PIN kartu X904.</p>
                </div>
              )}
              {x904Verifying && <p className="text-xs">Memverifikasi identitas mesin...</p>}
              {x904VerifiedName && <p className="text-xs text-emerald-700">Terverifikasi: {x904VerifiedName}. Lengkapi data pemesan, tanggal, dan status pembayaran untuk melanjutkan.</p>}
              {x904VerificationError && <p className="text-xs text-destructive">{x904VerificationError}</p>}
              {isHistoricalGymNonmember ? (
                <p className="text-xs text-amber-700">Booking tanggal lampau hanya untuk pencatatan. VIS001–VIS006 boleh dipilih kembali sebagai referensi historis, tanpa aktivasi, suspend, atau perpanjangan akses X904. Identitas boleh dikosongkan.</p>
              ) : (
                <p className="text-xs text-muted-foreground">Akses baru aktif setelah pembayaran dikonfirmasi dan mesin memberikan ACK.</p>
              )}
            </div>}
            {!isMembership && <div className="border-t pt-5"><h3 className="flex items-center gap-2 font-semibold"><CalendarDays size={18} className="text-orange-600" /> Jadwal Booking</h3><p className="mt-1 text-xs text-muted-foreground">Pilih tanggal, durasi, dan jam tersedia. Untuk sesi tambahan, aktifkan Booking Berulang.</p></div>}
            {/* Booking date and duration: Gym is per visit, not hourly. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bookingDate">{isMembership ? "Tanggal Mulai Membership *" : "Tanggal Booking *"}</Label>
                <Input id="bookingDate" type="date" value={bookingDay}
                  onChange={(e) => { setBookingDay(e.target.value); setStartTime(""); }} required={bookingKind !== "membership" && multiPatterns.length === 0} />
              </div>
              {!isMembership && !isWalkIn && <div className="space-y-2">
                <Label htmlFor="duration">Durasi (jam) *</Label>
                <Select value={duration} onValueChange={(v) => { setDuration(v); setStartTime(""); }}>
                  <SelectTrigger id="duration"><SelectValue /></SelectTrigger>
                  <SelectContent>{Array.from({length: 12}, (_, i) => i + 1).map((n) =>
                    <SelectItem key={n} value={String(n)}>{n} jam</SelectItem>)}</SelectContent>
                </Select>
              </div>}
            </div>
            {!isMembership && isWalkIn && <p className="text-sm text-muted-foreground rounded-lg border p-3">
              Gym reguler menggunakan tarif per kunjungan, tanpa durasi atau pilihan slot jam.
              Member Gym menggunakan alur Membership terpisah agar kunjungan tidak ditagih ulang.
            </p>}
            </>}
            {!isMembership && !isWalkIn && selectedFacilityId && selectedDate && <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Pilih Jam Mulai</Label>
                <span className="text-xs text-muted-foreground">Durasi {duration} jam</span>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>● Tersedia</span><span>◯ Tidak tersedia</span><span className="text-orange-600">● Dipilih</span>
              </div>
              {slotState === "loading" && <p className="text-sm">Memeriksa ketersediaan...</p>}
              {slotState === "error" && <p className="text-sm text-destructive">Pemeriksaan gagal; booking tidak dapat disimpan.</p>}
              {slotState === "ready" && <div className="space-y-3">
                {[
                  { label: "Pagi", rows: slotOptions.filter((x) => Number(x.time.slice(0,2)) < 12) },
                  { label: "Siang", rows: slotOptions.filter((x) => Number(x.time.slice(0,2)) >= 12 && Number(x.time.slice(0,2)) < 17) },
                  { label: "Sore & Malam", rows: slotOptions.filter((x) => Number(x.time.slice(0,2)) >= 17) },
                ].filter((section) => section.rows.length > 0).map((section) => <div key={section.label}>
                  <p className="text-xs font-medium text-muted-foreground mb-2">{section.label}</p>
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {section.rows.map((slot) => <Button key={slot.time} type="button" size="sm"
                      disabled={!slot.available} title={slot.reason ?? (slot.available ? "Tersedia" : "Tidak tersedia")}
                      className={startTime.slice(11,16) === slot.time.slice(0,5) ? "bg-orange-500 hover:bg-orange-600 text-white" : ""}
                      variant={startTime.slice(11,16) === slot.time.slice(0,5) ? "default" : "outline"}
                      onClick={() => setStartTime(selectedDate + "T" + slot.time.slice(0,5))}>
                      {slot.time.slice(0,5)}
                    </Button>)}
                  </div>
                </div>)}
                {slotOptions.length === 0 && <p className="text-sm">Tidak ada slot dalam jam operasional.</p>}
              </div>}
              <p className="text-xs text-muted-foreground">Status slot dihitung untuk seluruh durasi. Server memeriksa ulang saat menyimpan.</p>
            </div>}
            {!isMembership && !isWalkIn && selectedFacilityId && selectedDate && startTime && (
              <div className={repeatEnabled ? "rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-4" : "rounded-lg border p-4 space-y-3"}>
                <div className="flex items-start gap-3">
                  <Checkbox id="admin-repeat-booking" checked={repeatEnabled} onCheckedChange={(checked) => setRepeatEnabled(Boolean(checked))} />
                  <div className="space-y-1">
                    <Label htmlFor="admin-repeat-booking" className="font-semibold flex items-center gap-2 cursor-pointer"><RefreshCw size={16} /> Booking Berulang</Label>
                    <p className="text-xs text-muted-foreground">Tambahkan beberapa pola mingguan/bulanan. Seluruh sesi masuk satu grup booking dan satu pembayaran.</p>
                  </div>
                </div>
                {repeatEnabled && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Tipe Pengulangan</Label>
                        <Select value={repeatType} onValueChange={(value: "weekly" | "monthly") => setRepeatType(value)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="weekly">Mingguan (setiap hari yang sama)</SelectItem>
                            <SelectItem value="monthly">Bulanan (tanggal yang sama)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="admin-repeat-count">Jumlah Sesi (termasuk tanggal pertama)</Label>
                        <Input id="admin-repeat-count" type="number" min={2} max={52} value={repeatCount}
                          onChange={(event) => setRepeatCount(Math.min(52, Math.max(2, Number.parseInt(event.target.value, 10) || 2)))} />
                      </div>
                    </div>
                    <div className="rounded-md bg-background border p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold flex items-center gap-2"><CalendarDays size={15} /> Preview Jadwal</p>
                        {repeatCheckState === "loading" && <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> Memeriksa...</span>}
                        {repeatCheckState === "ready" && repeatPreviewCurrent && <span className={repeatAllAvailable ? "text-xs font-semibold text-green-700" : "text-xs font-semibold text-amber-700"}>{repeatPreview?.validCount ?? 0}/{repeatPreview?.dates.length ?? 0} tersedia</span>}
                      </div>
                      {repeatCheckState === "error" && <p className="text-sm text-destructive">{repeatError}</p>}
                      {repeatCheckState === "idle" && <p className="text-sm text-muted-foreground">Pilih tanggal dan jam mulai untuk memeriksa sesi.</p>}
                      {repeatPreview && repeatPreviewCurrent && (
                        <div className="space-y-1.5">
                          {repeatPreview.dates.map((row) => (
                            <div key={row.date} className="flex items-center justify-between gap-3 text-sm border-b last:border-0 py-1.5">
                              <span>{new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date(row.date + "T12:00:00+07:00"))}</span>
                              {row.available ? <span className="text-green-700 font-medium">Tersedia</span> : <span className="text-red-700 font-medium text-right">{row.reason || "Tidak tersedia"}</span>}
                            </div>
                          ))}
                          <div className="flex items-center justify-between gap-3 border-t pt-2 text-sm"><span>Estimasi subtotal seluruh sesi</span><strong>{formatRupiah(repeatPreview.totalPrice)}</strong></div>
                          <p className="text-xs text-muted-foreground">Harga akhir dan pajak dihitung ulang server. Preview tidak menyimpan booking.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}



            {!isMembership && !isWalkIn && repeatEnabled && repeatPreviewCurrent && repeatAllAvailable && repeatPreview && (
              <Button type="button" variant="outline" className="w-full border-orange-300"
                disabled={isActiveApMember || bookingKind === "event" ||
                  multiPatterns.reduce((n,p) => n + p.dates.length, 0) + repeatPreview.dates.length > 52}
                onClick={() => {
                  const next: BookingPattern = {
                    startDate: selectedDate, startTime: startTime.slice(11, 16),
                    durationHours: Number(duration), repeatType, repeatCount,
                    dates: repeatPreview.dates.map((row) => row.date),
                    pricePerSession: Number(repeatPreview.pricePerSession),
                  };
                  const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
                  const overlaps = multiPatterns.some((pattern) =>
                    pattern.dates.some((date) => next.dates.includes(date)) &&
                    toMinutes(pattern.startTime) < toMinutes(next.startTime) + next.durationHours * 60 &&
                    toMinutes(next.startTime) < toMinutes(pattern.startTime) + pattern.durationHours * 60
                  );
                  if (overlaps) {
                    toast({ title: "Jadwal bertabrakan", description: "Pola ini bertabrakan dengan pola yang sudah ditambahkan.", variant: "destructive" });
                    return;
                  }
                  setMultiPatterns((prev) => [...prev, next]);
                  setRepeatEnabled(false);
                  setBookingDay("");
                  setStartTime("");
                  toast({ title: "Pola jadwal ditambahkan", description: "Pilih tanggal dan jam lain untuk pola berikutnya." });
                }}>
                + Tambahkan Pola ke Booking
              </Button>
            )}
            {!isMembership && multiPatterns.length > 0 && (
              <div className="rounded-xl border border-orange-200 bg-orange-50/30 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">Pola Jadwal dalam Satu Booking</p>
                  <span className="text-xs text-muted-foreground">{multiPatterns.reduce((sum, pattern) => sum + pattern.dates.length, 0)} sesi</span>
                </div>
                {multiPatterns.map((pattern, index) => (
                  <div key={index} className="rounded-lg bg-background border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold">{pattern.startDate} • {pattern.startTime} • {pattern.durationHours} jam</span>
                      <Button type="button" variant="ghost" size="sm"
                        onClick={() => setMultiPatterns((prev) => prev.filter((_, i) => i !== index))}>Hapus</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">{pattern.dates.length} sesi • {pattern.repeatType === "weekly" ? "Mingguan" : "Bulanan"} • {formatRupiah(pattern.pricePerSession)} / sesi</p>
                    <details className="text-xs"><summary className="cursor-pointer">Lihat tanggal sesi</summary>
                      <p className="pt-2 text-muted-foreground">{pattern.dates.join(" • ")}</p>
                    </details>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">Pola yang ditambahkan akan dibuat menjadi satu GRP. Hapus pola yang salah sebelum menyimpan. Maksimal 52 sesi.</p>
              </div>
            )}
            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Catatan (Opsional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Permintaan khusus atau informasi tambahan..."
                rows={3}
              />
            </div>

            {!isMembership && (
              <div className="rounded-lg border p-4 space-y-3">
                <p className="font-semibold">Status pembayaran</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" disabled={isCompanyPayer} variant={paymentChoice === "paid" ? "default" : "outline"} aria-pressed={paymentChoice === "paid"} onClick={() => setPaymentChoice("paid")}>Sudah Bayar</Button>
                  <Button type="button" variant={paymentChoice === "unpaid" ? "default" : "outline"} aria-pressed={paymentChoice === "unpaid"} onClick={() => setPaymentChoice("unpaid")}>Belum Bayar</Button>
                </div>
                {paymentChoice === "paid" ? (
                  <div className="space-y-3 border-t pt-3">
                    <p className="text-xs text-muted-foreground">Bukti dan tanggal transaksi akan dicatat setelah booking/grup berhasil dibuat. Pembayaran grup hanya dibuat satu record dengan total seluruh sesi.</p>
                    <div className="space-y-1.5">
                      <Label>Metode Pembayaran *</Label>
                      <Select value={paidMethod} onValueChange={setPaidMethod}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Transfer Bank">Transfer Bank</SelectItem>
                          <SelectItem value="QRIS">QRIS Mandiri Direct</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="checkout-payment-date">Tanggal Pembayaran *</Label>
                      <Input id="checkout-payment-date" type="date" value={bookingPaymentDate} max={jakartaDateOnly()}
                        onChange={(event) => setBookingPaymentDate(event.target.value)} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="checkout-payment-proof">Bukti Pembayaran *</Label>
                      <Input id="checkout-payment-proof" type="file" accept="image/*,.pdf"
                        onChange={(event) => setPaymentProof(event.target.files?.[0] ?? null)} required />
                      <p className="text-xs text-muted-foreground">OCR membantu pemeriksaan metode, tetapi tidak menggantikan verifikasi dana masuk.</p>
                    </div>
                    {paymentProof && <p className="text-xs text-muted-foreground">File dipilih: {paymentProof.name}</p>}
                  </div>
                ) : paymentChoice === "unpaid" ? (
                  <p className="text-sm text-muted-foreground">
                    {isCompanyPayer
                      ? "Tagihan perusahaan mengikuti alur invoice perusahaan. Tidak ada pembayaran langsung yang dicatat pada saat booking."
                      : "Booking akan dibuat tanpa record pembayaran. Status pembayaran tetap menunggu pembayaran dan bisa dikelola kemudian."}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Pilih Sudah Bayar atau Belum Bayar untuk melanjutkan.</p>
                )}
              </div>
            )}

            {isMembership && <div className="rounded-lg border p-4 space-y-3">
              <p className="font-semibold">Pengelolaan Member Gym</p>
              <Label>Tindakan Membership</Label>
              <Select value={memberAction} onValueChange={(v) => {setMemberAction(v);setNewX904CommandId("");setNewX904ReservedPin("");setNewX904Notice("");setMemberId("");setRenewalStartOverride("");setMembershipResult("");setMembershipPaymentTarget(null);setMembershipPaymentDone(false);setMembershipPaymentFile(null);}}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Daftar Member Baru</SelectItem>
                  <SelectItem value="renew">Perpanjang Membership</SelectItem>
                  <SelectItem value="checkin">Catat Kunjungan Member Aktif (Rp0)</SelectItem>
                </SelectContent>
              </Select>
              {memberAction === "new" ? <>
                <p className="text-xs text-muted-foreground">Isi nama, WhatsApp dan email di atas. Fasilitas Gym otomatis; tidak ada tarif kunjungan Rp30.000.</p>
                <div className="rounded-lg border p-3 space-y-2">
                  <>
                  <Label>Buat user X904 *</Label>
                  <p className="text-xs text-muted-foreground">Pilih PIN manual 3 digit atau Generate PIN otomatis (100–999). Server menolak PIN yang sudah ada, pernah diantrekan, atau sudah dipetakan. Pendaftaran dan pembayaran belum diproses sampai user terverifikasi di mesin.</p>
                  <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="Metode pembuatan PIN X904">
                    <label className="flex items-center gap-2"><input type="radio" checked={newX904PinMode==="manual"} onChange={()=>{setNewX904PinMode("manual");setNewX904PreviewPin("");setNewX904Notice("");}} disabled={Boolean(newX904CommandId)}/>Masukkan PIN</label>
                    <label className="flex items-center gap-2"><input type="radio" checked={newX904PinMode==="generate"} onChange={()=>{setNewX904PinMode("generate");setNewX904PreviewPin("");setNewX904Notice("");}} disabled={Boolean(newX904CommandId)}/>Generate PIN 3 digit</label>
                  </div>
                  {newX904PinMode==="manual" && <Input aria-label="PIN X904 baru 3 digit" inputMode="numeric" maxLength={3}
                    value={newX904ManualPin} disabled={Boolean(newX904CommandId)}
                    placeholder="Contoh: 318" onChange={e=>{setNewX904ManualPin(e.target.value.replace(/[^0-9]/g,"").slice(0,3));setNewX904PreviewPin("");setNewX904Notice("");}}/>}
                  {import.meta.env.VITE_GYM_X904_NEW_USER_PILOT !== "true" ? (
                    <div className="space-y-2">
                      <p className="text-xs text-amber-700">Mode pratinjau aman: hanya membaca inventaris X904. Belum membuat akun, PIN, membership, booking atau pembayaran.</p>
                      <Button type="button" variant="outline"
                        disabled={newX904Busy || (newX904PinMode==="manual" && !/^[1-9][0-9]{2}$/.test(newX904ManualPin))}
                        onClick={()=>void previewNewX904Pin()}>
                        {newX904Busy?"Memeriksa...":newX904PinMode==="generate"?"Pratinjau Generate PIN 3 Digit":"Periksa Ketersediaan PIN"}
                      </Button>
                      {newX904PreviewPin && <p className="text-sm">PIN pratinjau: <strong>{newX904PreviewPin}</strong> · belum dialokasikan</p>}
                    </div>
                  ) : !newX904CommandId ? (
                    <Button type="button" variant="outline" disabled={newX904Busy || (newX904PinMode==="manual" && !/^[1-9][0-9]{2}$/.test(newX904ManualPin))}
                      onClick={()=>void queueNewX904User()}>{newX904Busy?"Memproses...":newX904PinMode==="generate"?"Generate PIN & Buat User X904":"Buat User X904 dengan PIN Ini"}</Button>
                  ):(
                    <div className="rounded-md border p-2 space-y-2">
                      <p className="text-sm font-medium">PIN {newX904ReservedPin} · Menunggu verifikasi X904</p>
                      <Button type="button" variant="outline" disabled={newX904Busy} onClick={()=>void verifyNewX904User()}>
                        {newX904Busy?"Memeriksa...":"Periksa ACK & Snapshot Mesin"}
                      </Button>
                    </div>
                  )}
                  {newX904Notice && <p className="text-xs" role="status">{newX904Notice}</p>}
                  </>
                  <details open={import.meta.env.VITE_GYM_X904_NEW_USER_PILOT !== "true"} className="rounded-md border p-2">
                    <summary className="cursor-pointer text-xs font-medium">Gunakan user X904 yang sudah ada (alur lama tetap tersedia)</summary>
                    <div className="mt-2 space-y-2">
                  <Label htmlFor="membership-x904-search">Cari nama / PIN mesin X904 *</Label>
                  <Input id="membership-x904-search" autoComplete="off"
                    placeholder="Cari nama mesin atau PIN, mis. BUAN"
                    value={membershipX904Search}
                    onChange={e=>{
                      setMembershipX904Search(e.target.value);
                      setMembershipX904Pin("");
                      setMembershipX904Name("");
                      setMembershipX904SelectedUid(null);
                      setMembershipX904IdentityConfirmed(false);
                      setMembershipX904Error("");
                    }} />
                  {membershipX904Checking && <p className="text-xs">Mencari pengguna di inventaris X904...</p>}
                  {!membershipX904Pin && membershipX904Search.trim().length >= 2 && !membershipX904Checking && !membershipX904Error && (
                    <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-1" role="listbox" aria-label="Hasil pencarian pengguna X904">
                      {membershipX904Candidates.length === 0 && <p className="p-2 text-xs text-muted-foreground">Tidak ada pengguna cocok. Periksa nama atau PIN mesin.</p>}
                      {membershipX904Candidates.map(item=>(
                        <button key={item.pin} type="button" role="option" aria-selected={false}
                          disabled={!item.available || !item.name}
                          className="w-full rounded px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={()=>{
                            setMembershipX904Pin(item.pin);
                            setMembershipX904Name(item.name);
                            if (isGuest && isMembership && memberAction === "new") setGuestName(item.name);
                            setMembershipX904SelectedUid(item.uid);
                            setMembershipX904IdentityConfirmed(false);
                            setMembershipX904Search(item.name + " · PIN " + item.pin);
                            setMembershipX904Error("");
                            setMembershipX904Candidates([]);
                          }}>
                          <span className="font-medium">{item.name}</span>
                          <span className="ml-2 text-xs text-muted-foreground">PIN {item.pin} · UID {item.uid}</span>
                          {!item.available && <span className="block text-xs text-destructive">Sudah dipetakan ke membership #{item.mappedMembershipId}{item.membershipStatus ? " ("+item.membershipStatus+")" : ""}. Periksa riwayat/perpanjangan.</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {membershipX904Pin && membershipX904Name && (
                    <div className="flex items-center justify-between rounded-md border p-2">
                      <p className="text-xs text-emerald-700">Nama di mesin: {membershipX904Name} · PIN {membershipX904Pin} · UID {membershipX904SelectedUid}</p>
                      <Button type="button" variant="ghost" size="sm" onClick={()=>{
                        setMembershipX904Pin("");setMembershipX904Name("");
                        setMembershipX904SelectedUid(null);setMembershipX904IdentityConfirmed(false);
                        setMembershipX904Search("");
                      }}>Ganti</Button>
                    </div>
                  )}
                  {membershipX904Error && <p className="text-xs text-destructive">{membershipX904Error}</p>}
                  {membershipX904Name && !membershipX904Checking && !membershipX904Error && (
                    <label className="flex items-start gap-2 text-xs">
                      <input type="checkbox" checked={membershipX904IdentityConfirmed}
                        onChange={e=>setMembershipX904IdentityConfirmed(e.target.checked)} />
                      <span>Saya telah mencocokkan pemilik PIN dengan identitas pendaftar dan nama di mesin.</span>
                    </label>
                  )}
                    </div>
                  </details>
                  <p className="text-xs text-muted-foreground">PIN harus terdaftar pada X904 dan belum dipetakan ke membership lain. Pembayaran tidak otomatis membuktikan pintu sudah terbuka; tunggu ACK mesin.</p>
                </div>
                <Label>Paket membership</Label>
                <Select value={memberMonths} onValueChange={setMemberMonths}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{[1,2,3,6,12].map(n => <SelectItem key={n} value={String(n)}>{n} bulan</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-sm">Total membership: <strong>{formatRupiah(Number(memberMonths) * 300000)}</strong>.</p>
                {getCurrentRole() !== "staff" && !membershipPaymentDone && <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                  <p className="font-semibold text-sm">Sudah Bayar — Pendaftaran dan Pembayaran Sekaligus</p>
                  <Label>Metode pembayaran *</Label>
                  <Select value={membershipPaymentMethod} onValueChange={setMembershipPaymentMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="qris">QRIS Mandiri</SelectItem>
                      <SelectItem value="transfer">Transfer Bank</SelectItem>
                    </SelectContent>
                  </Select>
                  <Label htmlFor="paid-gym-date">Tanggal Pembayaran *</Label>
                  <Input id="paid-gym-date" type="date" value={membershipPaymentDate}
                    max={jakartaDateOnly()} onChange={e=>setMembershipPaymentDate(e.target.value)} />
                  <Label htmlFor="paid-gym-proof">Bukti Pembayaran *</Label>
                  <Input id="paid-gym-proof" type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    onChange={e=>setMembershipPaymentFile(e.target.files?.[0] ?? null)} />
                  <p className="text-xs text-muted-foreground">Pastikan dana sudah masuk dan cocok dengan bukti. Satu klik akan membuat customer, membership dan pembayaran lunas. X904 menunggu ACK perangkat.</p>
                </div>}
              </> : <>
                <Label>Cari Member Gym</Label>
                <Select value={memberId} onValueChange={(id)=>{setMemberId(id);setRenewalStartOverride("");}}>
                  <SelectTrigger><SelectValue placeholder="Pilih member berdasarkan nama / telepon" /></SelectTrigger>
                  <SelectContent position="popper" side="bottom" sideOffset={4} className="max-h-[min(360px,60vh)] overflow-y-auto">
                    <div className="sticky top-0 z-20 bg-popover px-2 py-2" onKeyDown={e => e.stopPropagation()}>
                      <Input aria-label="Cari nama atau nomor telepon member Gym" placeholder="Cari nama / telepon member..." value={memberSearch} onChange={e => setMemberSearch(e.target.value)} onKeyDown={e => e.stopPropagation()} />
                    </div>
                    {members.filter(m => [m.name,m.phone].some(v => String(v).toLowerCase().includes(memberSearch.trim().toLowerCase()))).map(m =>
                      <SelectItem key={m.id} value={String(m.id)}>{m.name} · {(m as any).displayPhone || m.phone} · {gymMemberStatusLabel((m as any).displayStatus || m.status)}</SelectItem>)}
                    {members.length > 0 && !members.some(m => [m.name,m.phone].some(v => String(v).toLowerCase().includes(memberSearch.trim().toLowerCase()))) &&
                      <div className="px-3 py-2 text-sm text-muted-foreground">Member tidak ditemukan</div>}
                  </SelectContent>
                </Select>
                {matchedMember && (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2">
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Member</span>
                      <strong>{matchedMember.name}</strong>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Status</span>
                      <strong>{gymMemberStatusLabel((matchedMember as any).displayStatus || matchedMember.status)}</strong>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Berlaku hingga</span>
                      <strong>{matchedMember.endDate}</strong>
                    </div>
                    {memberAction === "renew" && (
                      <div className="border-t pt-2 space-y-2">
                        {renewalPeriodValid && renewalStartDate && renewalEndDate ? (
                          <>
                            <div className="flex justify-between gap-4">
                              <span className="text-muted-foreground">Periode baru</span>
                              <strong>{renewalStartDate} – {renewalEndDate}</strong>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-muted-foreground">Tagihan</span>
                              <strong>{formatRupiah(membershipCharge)}</strong>
                            </div>
                          </>
                        ) : (
                          <p className="text-sm text-destructive" role="alert">
                            Periode perpanjangan belum valid. Tombol perpanjangan dinonaktifkan.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {memberAction === "renew" && <>
                  <Label htmlFor="gym-renewal-start">Tanggal mulai membership</Label>
                  <Input id="gym-renewal-start" type="date"
                    value={renewalStartOverride || previewGymRenewalPeriod(
                      matchedMember?.status ?? "", matchedMember?.endDate ?? "", jakartaDateOnly(),
                      Number(memberMonths || 1), true,
                    ).start}
                    min={new Date(Date.parse(jakartaDateOnly()+"T00:00:00Z")-30*86400000).toISOString().slice(0,10)}
                    max={jakartaDateOnly()}
                    disabled={!matchedMember || (matchedMember.status === "active" &&
                      Date.parse(jakartaDateOnly()+"T00:00:00Z") <=
                        Date.parse(matchedMember.endDate+"T00:00:00Z")+7*86400000)}
                    onChange={(e)=>setRenewalStartOverride(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Untuk membership lama yang sudah expired: tanggal mulai dapat disesuaikan hingga 30 hari ke belakang, tanpa mengubah tanggal pembayaran. Tanggal pembayaran diisi setelah tagihan dibuat.</p>
                  <Label>Perpanjangan</Label>
                  <Select value={memberMonths} onValueChange={setMemberMonths}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{[1,2,3,6,12].map(n => <SelectItem key={n} value={String(n)}>{n} bulan</SelectItem>)}</SelectContent>
                  </Select>
                </>}
                {memberAction === "checkin" && <p className="text-sm">Kunjungan member aktif tidak memerlukan durasi dan tidak menimbulkan tagihan baru.</p>}
              </>}
              {memberAction === "renew" && unfinishedGymPayment && !membershipPaymentDone && (
                <div className="rounded-lg border border-amber-300 bg-amber-50/50 p-3 space-y-2">
                  <p className="font-semibold text-sm">Tagihan perpanjangan belum selesai · Payment #{unfinishedGymPayment.id}</p>
                  <p className="text-sm">Periode {unfinishedGymPayment.periodStart} – {unfinishedGymPayment.periodEnd} · {formatRupiah(Number(unfinishedGymPayment.amount))}</p>
                  {unfinishedGymPayment.status === "waiting_confirmation" ? (
                    <>
                      <p className="text-xs">Bukti sudah tersimpan. Jangan unggah ulang atau membuat booking baru.</p>
                      {gymCanConfirm && <Button type="button" disabled={membershipPaymentBusy}
                        onClick={()=>retryGymAdminConfirmation(Number(memberId),unfinishedGymPayment.id)}>
                        Selesaikan Konfirmasi Pembayaran
                      </Button>}
                    </>
                  ) : (
                    <Button type="button" variant="outline" onClick={()=>{
                      setMembershipPaymentDone(false);setMembershipProofUploaded(false);
                      setMembershipPaymentTarget({
                        membershipId:Number(memberId),action:"renew",name:matchedMember?.name ?? "Member",
                        periodStart:unfinishedGymPayment.periodStart,periodEnd:unfinishedGymPayment.periodEnd,
                        amount:Number(unfinishedGymPayment.amount),
                      });
                    }}>Lanjutkan Pembayaran Tagihan Ini</Button>
                  )}
                </div>
              )}
              {memberLoadError && <p className="text-xs text-destructive">{memberLoadError}</p>}
              {membershipResult && <p className="text-sm font-medium text-green-700">{membershipResult}</p>}
              {membershipPaymentTarget && (
                <div className="rounded-xl border border-orange-200 bg-orange-50/40 p-4 space-y-3">
                  <div>
                    <p className="font-semibold">
                      {membershipPaymentTarget.action === "renew" ? "Pembayaran Perpanjangan Membership" : "Pembayaran Member Baru"}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {membershipPaymentTarget.name}
                      {membershipPaymentTarget.periodStart && membershipPaymentTarget.periodEnd
                        ? ` · ${membershipPaymentTarget.periodStart} s/d ${membershipPaymentTarget.periodEnd}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex justify-between gap-4 text-sm">
                    <span>Tagihan</span>
                    <strong>{formatRupiah(membershipPaymentTarget.amount)}</strong>
                  </div>
                  {!membershipPaymentDone ? (
                    <>
                      <Label>Metode pembayaran</Label>
                      <Select value={membershipPaymentMethod} onValueChange={setMembershipPaymentMethod}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="qris">QRIS</SelectItem>
                          <SelectItem value="transfer">Transfer Bank</SelectItem>
                        </SelectContent>
                      </Select>
                      <Label htmlFor="checkout-membership-payment-date">Tanggal pembayaran</Label>
                      <Input
                        id="checkout-membership-payment-date"
                        type="date"
                        value={membershipPaymentDate}
                        max={jakartaDateOnly()}
                        onChange={(e) => setMembershipPaymentDate(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">Isi sesuai tanggal transaksi pada bukti pembayaran. Tanggal input/verifikasi tetap tercatat terpisah untuk audit.</p>
                      <Label htmlFor="checkout-membership-proof">Bukti pembayaran</Label>
                      <Input
                        id="checkout-membership-proof"
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                        onChange={(e) => setMembershipPaymentFile(e.target.files?.[0] ?? null)}
                      />
                      <Button
                        type="button"
                        className="w-full"
                        disabled={(!membershipPaymentFile && !membershipProofUploaded) || !membershipPaymentDate || membershipPaymentBusy}
                        onClick={submitMembershipPaymentInline}
                      >
                        {membershipPaymentBusy
                          ? "Memproses..."
                          : getCurrentRole() === "staff"
                            ? "Unggah Bukti & Kirim Verifikasi"
                            : "Unggah Bukti & Konfirmasi"}
                      </Button>
                    </>
                  ) : (
                    <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm font-medium text-green-700">
                      {getCurrentRole() === "staff"
                        ? "Bukti sudah dikirim. Menunggu verifikasi petugas berwenang."
                        : membershipPaymentTarget.action === "renew"
                          ? "Perpanjangan dan pembayaran sudah selesai."
                          : "Pendaftaran member dan pembayaran sudah selesai."}
                    </div>
                  )}
                </div>
              )}

              {!membershipPaymentTarget && !membershipPaymentDone && memberAction === "new" && membershipNewBlockers.length > 0 && (
                <div role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-semibold">Lengkapi sebelum mendaftarkan member:</p>
                  <ul className="ml-4 list-disc space-y-1">
                    {membershipNewBlockers.map((message) => <li key={message}>{message}</li>)}
                  </ul>
                </div>
              )}
              {!membershipPaymentTarget && !membershipPaymentDone && <Button type="button"
                disabled={!membershipReady || isSubmitting || (memberAction === "new" && getCurrentRole() !== "staff" && (!membershipPaymentFile || !membershipPaymentDate || membershipPaymentDate > jakartaDateOnly()))}
                className="w-full" onClick={() => setMembershipConfirmOpen(true)}>
                {isSubmitting ? "Memproses..." : memberAction === "new" && getCurrentRole() !== "staff" ? "Daftarkan Member & Konfirmasi Pembayaran" : memberAction === "new" ? "Lanjutkan Pendaftaran" : memberAction === "renew" ? "Lanjutkan Perpanjangan" : "Catat Kunjungan (Rp0)"}
              </Button>}
              {(!membershipPaymentTarget || membershipPaymentDone) && <Button type="button" variant="outline" className="w-full" onClick={() => setLocation("/admin/memberships")}>Lihat Riwayat Membership & Pembayaran</Button>}
            </div>}
            </>}
          </CardContent>

          {bookingKind !== "membership_combined" && <CardFooter className="border-t pt-5">
            {!isMembership && <div className="w-full space-y-2">
              {isCompanyPayer && multiPatterns.length === 0 && corporateSubmitBlockers.length > 0 && (
                <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p className="font-semibold">Periksa persyaratan Booking Perusahaan:</p>
                  <ul className="ml-4 list-disc space-y-1">
                    {corporateSubmitBlockers.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                </div>
              )}
              {isGymNonmember && !canSubmitBooking && !isSubmitting && (
                <div role="status" className="rounded-lg border px-3 py-2 text-sm">
                  <p className="font-semibold">Lengkapi untuk melanjutkan booking Gym:</p>
                  <ul className="ml-4 list-disc space-y-1">
                    {(!selectedCustomerId || !customerFormValid) && <li>Isi nama pemesan dan nomor WhatsApp yang valid.</li>}
                    {!selectedDate && <li>Pilih tanggal booking.</li>}
                    {(!x904VerifiedName || x904VerificationError || x904Verifying) && <li>Verifikasi PIN mesin atau pilih nama dari daftar X904.</li>}
                    {!paymentChoice && <li>Pilih status pembayaran (Sudah Bayar / Belum Bayar).</li>}
                    {paymentChoice === "paid" && !formPaymentValid && <li>Lengkapi bukti, metode, dan tanggal pembayaran.</li>}
                  </ul>
                </div>
              )}
              {multiPatterns.length > 0 && multiScheduleBlockers.length > 0 && (
                <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p className="font-semibold">Periksa sebelum membuat booking:</p>
                  <ul className="ml-4 list-disc space-y-1">
                    {multiScheduleBlockers.map((message) => <li key={message}>{message}</li>)}
                  </ul>
                </div>
              )}
              <Button type="submit" className="w-full h-11 text-base font-bold"
                disabled={!canSubmitBooking}>
              {isSubmitting
                ? <><Loader2 size={16} className="mr-2 animate-spin" /> Memproses...</>
                : isMembership ? "Buka Modul Membership" : isCompanyPayer ? "Buat Booking Perusahaan" : "Buat Booking"
              }
              </Button>
            </div>}
          </CardFooter>}
        </Card>
        {!isMembership && bookingKind !== "membership_combined" && (
          <aside className="min-w-0 xl:sticky xl:top-6" aria-label="Ringkasan booking">
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg"><ShoppingCart className="h-5 w-5 text-orange-600" /> Ringkasan Booking</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-lg bg-muted/40 px-2 py-3"><p className="text-lg font-bold">{multiPatterns.length > 0 ? multiPatterns.reduce((n,p) => n + p.dates.length, 0) : repeatEnabled ? (repeatPreviewCurrent ? repeatCount : "—") : (selectedDate && (isWalkIn || slotValid) ? 1 : "—")}</p><p className="text-xs text-muted-foreground">Jumlah sesi</p></div>
                  <div className="rounded-lg bg-muted/40 px-2 py-3"><p className="text-lg font-bold">{multiPatterns.length > 0 ? multiPatterns.reduce((n,p) => n + p.dates.length * p.durationHours, 0) : repeatEnabled ? (repeatPreviewCurrent ? repeatCount * Number(duration) : "—") : (selectedDate && (isWalkIn || slotValid) ? (isWalkIn ? "—" : duration) : "—")}</p><p className="text-xs text-muted-foreground">Total jam</p></div>
                </div>
                {!selectedFacilityId || (!selectedDate && !multiPatterns.length) ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Pilih fasilitas dan jadwal untuk melihat rincian harga.</p> : null}
                {multiPatterns.length > 0 && (
                  <div className="rounded-lg border p-3 space-y-2 text-sm">
                    <p className="font-semibold">Ringkasan Multi-Jadwal</p>
                    {multiPatterns.map((pattern, index) => (
                      <div key={index} className="flex justify-between gap-2">
                        <span>{pattern.startDate} • {pattern.startTime} • {pattern.dates.length} sesi</span>
                        <strong>{formatRupiah(pattern.pricePerSession * pattern.dates.length)}</strong>
                      </div>
                    ))}
                    <div className="flex justify-between gap-2 border-t pt-2 font-semibold">
                      <span>{isCompanyPayer ? "Estimasi sebelum pajak perusahaan" : "Estimasi total"}</span>
                      <strong>{formatRupiah(multiPatterns.reduce((sum, pattern) => sum + pattern.pricePerSession * pattern.dates.length, 0))}</strong>
                    </div>
                    <p className="text-xs text-muted-foreground">Nilai final dan pajak dihitung ulang server. Pola yang belum ditambahkan tidak ikut tersimpan.</p>
                  </div>
                )}
            {!isMembership && multiPatterns.length === 0 && selectedFacilityId && selectedDate &&
              (repeatEnabled ? (repeatPreviewCurrent && Boolean(repeatPreview)) : (isWalkIn || slotValid)) && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2">
                <p className="font-semibold">Rincian Harga</p>
                {isMultigunaFacility && selectedActivityType && <p className="text-muted-foreground">Jenis Fasilitas / Olahraga: <strong className="text-foreground">{multigunaActivities.find(a => a.value === selectedActivityType)?.label}</strong></p>}
                {repeatEnabled && repeatPreview ? (
                  <>
                    <p>{facility?.name} · {startTime.slice(11,16)} – {computedEndTime.slice(11,16)} · {duration} jam per sesi</p>
                    <div className="flex justify-between gap-3"><span>Tarif per sesi</span><strong>{formatRupiah(repeatPreview.pricePerSession)}</strong></div>
                    <div className="flex justify-between gap-3"><span>Jumlah sesi</span><strong>{repeatCount} sesi ({repeatType === "weekly" ? "mingguan" : "bulanan"})</strong></div>
                    <details className="rounded-lg border bg-background px-3 py-2">
                      <summary className="cursor-pointer font-medium">Lihat tanggal seluruh sesi</summary>
                      <div className="mt-2 space-y-1.5 border-t pt-2">
                      {repeatPreview.dates.map((row) => (
                        <div key={row.date} className="flex items-center justify-between gap-3 text-xs">
                          <span>{new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date(row.date + "T12:00:00+07:00"))}</span>
                          <span className={row.available ? "text-green-700 font-medium" : "text-red-700 font-medium"}>
                            {row.available ? "Tersedia" : (row.reason || "Tidak tersedia")}
                          </span>
                        </div>
                      ))}
                      </div>
                    </details>
                    <div className="flex justify-between gap-3 border-t pt-2"><span>{repeatAllAvailable ? "Subtotal seluruh sesi" : "Subtotal jika semua sesi tersedia"}</span><strong>{formatRupiah(repeatBaseTotal + repeatAdditionalCharges)}</strong></div>
                    {isActiveApMember && (
                      <div className="flex justify-between gap-3 text-green-700"><span>{isApMultiguna ? "Potongan harga khusus AP Multiguna" : `Diskon Member AP (${Number(apMember.discountPercentage ?? 0)}%)`}</span><span>− {formatRupiah(repeatApDiscount * repeatCount)}</span></div>
                    )}
                    {!isActiveApMember && bookingKind === "event" && (
                      <div className="flex justify-between gap-3"><span>Estimasi diskon event (21,4%)</span><span>− {formatRupiah(Math.round(repeatPreview.pricePerSession * 0.214) * repeatCount)}</span></div>
                    )}
                    <div className="flex justify-between gap-3 font-semibold text-base">
                      <span>{isCompanyPayer ? "Estimasi sebelum pajak perusahaan" : repeatAllAvailable ? "Estimasi Total Pembayaran" : "Estimasi total jika semua sesi tersedia"}</span>
                      <strong>{formatRupiah(isActiveApMember ? repeatApTotal : Math.max(0, repeatBaseTotal - (bookingKind === "event" ? Math.round(repeatPreview.pricePerSession * 0.214) * repeatCount : 0) + repeatAdditionalCharges))}</strong>
                    </div>
                    {!repeatAllAvailable && (
                      <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                        Ada tanggal yang belum tersedia. Booking belum dapat disimpan sampai seluruh sesi lolos pemeriksaan.
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {isCompanyPayer
                        ? "Estimasi ini belum termasuk perhitungan pajak dan potongan perusahaan. Nilai final dihitung server untuk setiap sesi."
                        : "Pajak Personal/Umum Rp0. Estimasi berdasarkan tarif dan diskon yang berlaku; server memeriksa ulang ketersediaan dan menghitung nilai final saat disimpan."}
                    </p>
                  </>
                ) : (
                  <>
                    <p>{selectedDate} · {isWalkIn ? "Gym per kunjungan (tanpa durasi)" : startTime.slice(11,16) + " – " + computedEndTime.slice(11,16) + " (" + duration + " jam)"}</p>
                    <div className="flex justify-between gap-3"><span>{isWalkIn ? "Tarif per kunjungan" : "Tarif per jam"}</span><strong>{formatRupiah(Number(facility?.pricePerHour ?? 0))}</strong></div>
                    {!isWalkIn && <div className="flex justify-between gap-3"><span>Durasi</span><span>{duration} jam</span></div>}
                    <div className="flex justify-between gap-3"><span>Subtotal</span><strong>{formatRupiah(estimatedBase)}</strong></div>
                    {isActiveApMember && (
                      <div className="flex justify-between gap-3 text-green-700"><span>{apDiscountLabel}</span><span>− {formatRupiah(estimatedApDiscount)}</span></div>
                    )}
                    {!isActiveApMember && bookingKind === "event" && <div className="flex justify-between gap-3"><span>Estimasi diskon event (21,4%)</span><span>− {formatRupiah(estimatedEventDiscount)}</span></div>}
                    <div className="flex justify-between gap-3"><span>{isCompanyPayer ? "Harga sebelum perincian pajak" : "Total Pembayaran"}</span><strong>{formatRupiah(estimatedBeforeTax)}</strong></div>
                    {isCompanyPayer ? <>
                      <p className="text-muted-foreground">DPP, PPN, dan PPh mengikuti konfigurasi perusahaan serta kalkulasi backend; jumlah ini bukan angka invoice final.</p>
                      <p className="text-muted-foreground">Status setelah dibuat: menunggu approval perusahaan atau belum ditagihkan, sesuai akun.</p>
                    </> : <p className="text-muted-foreground">Pajak (Personal / Umum): Rp0</p>}
                  </>
                )}
              </div>
            )}
                <p className="text-xs text-muted-foreground">{isCompanyPayer ? "Pembayaran perusahaan mengikuti approval dan invoice. Tidak ada pembayaran langsung." : "Pilih status pembayaran dan unggah bukti pada form. Harga serta ketersediaan diperiksa ulang oleh server."}</p>
              </CardContent>
            </Card>
          </aside>
        )}
      </form>
      )}

      {["owner","super_admin","admin","finance","admin_booking"].includes(getCurrentRole() ?? "") && (
        <Card id="gym-combined-payment-card" className="mt-6 border-blue-200 shadow-sm">
          <CardHeader className="p-0">
            <button type="button" className="flex w-full items-center justify-between gap-3 rounded-t-lg p-5 text-left font-semibold hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={combinedOpen} aria-controls="gym-combined-payment-content"
              onClick={()=>setCombinedOpen(open=>!open)}>
              <span>Pembayaran Gabungan Membership Gym</span>
              <span className="text-sm font-normal text-muted-foreground">{combinedOpen ? "Tutup" : "Buka"} {combinedOpen ? "▲" : "▼"}</span>
            </button>
          </CardHeader>
          {combinedOpen && <div id="gym-combined-payment-content">
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Bukti gabungan tersimpan</p>
              <Button type="button" variant="outline" size="sm" disabled={combinedReviewLoading}
                onClick={()=>void loadCombinedReceipts()}>{combinedReviewLoading?"Memuat...":"Muat daftar bukti"}</Button>
            </div>
            {combinedReviewError && <p role="alert" className="text-xs text-destructive">{combinedReviewError}</p>}
            {combinedReceipts.map(receipt=>(
              <div key={receipt.id} className="space-y-2 rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>Bukti #{receipt.id} · {formatRupiah(receipt.amount)}</strong>
                  <span className={receipt.status==="verified"?"text-green-700":"text-amber-700"}>
                    {receipt.status==="awaiting_bank_verification"?"Menunggu persetujuan foto":receipt.status==="photo_approved"?"Membership diproses — disetujui dari foto (belum verifikasi bank)":receipt.status}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{receipt.method.toUpperCase()} · {receipt.paymentDate}</span>
                  <a href={receipt.proofUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">Lihat bukti foto</a>
                </div>
                {receipt.allocations.map((allocation,index)=>(
                  <div key={index} className="flex flex-wrap justify-between gap-2 border-t pt-2">
                    <span>{allocation.name} · PIN {allocation.pin} · {allocation.kind==="new"?"Member Gym baru":"Perpanjangan member Gym"}{allocation.status==="confirmed"?" · Terproses":""}</span>
                    <strong>{formatRupiah(allocation.amount)}</strong>
                  </div>
                ))}
                {receipt.allocationSum!==receipt.amount && <p role="alert" className="text-destructive">Jumlah alokasi tidak sesuai: periksa sebelum konfirmasi.</p>}
                {["owner","super_admin","admin","finance"].includes(getCurrentRole()??"") &&
                  receipt.status==="awaiting_bank_verification" && receipt.allocationSum===receipt.amount && (
                  <Button type="button" size="sm" disabled={combinedApprovingId!=null}
                    onClick={()=>void approveCombinedPhoto(receipt)}>
                    {combinedApprovingId===receipt.id?"Memproses...":"Setujui Foto & Proses Membership"}
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  Persetujuan berdasarkan foto adalah keputusan admin, bukan konfirmasi settlement bank. Hanya setelah disetujui, sistem memproses membership dan mengantre aktivasi X904. Bukti sama tidak boleh dicatat sebagai penerimaan bank kedua.
                </p>
              </div>
            ))}
          </CardContent>
          <CardContent>
            <form onSubmit={submitCombinedReceipt} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Satu bukti pembayaran untuk beberapa penerima. Setiap alokasi adalah paket 1 bulan Rp300.000.
                Pencatatan ini belum mengonfirmasi dana, membuat mutasi bank, atau mengaktifkan PIN X904.
              </p>
              <p className="text-xs text-muted-foreground">Tidak perlu nomor referensi bank. Sistem membuat ID bukti internal otomatis dari foto yang diunggah; petugas tetap memverifikasi dana secara terpisah.</p>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1"><Label>Tanggal transaksi</Label>
                  <Input type="date" value={combinedDate} max={jakartaDateOnly()} onChange={e=>setCombinedDate(e.target.value)} required /></div>
                <div className="space-y-1"><Label>Metode</Label>
                  <Select value={combinedMethod} onValueChange={setCombinedMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="qris">QRIS Mandiri</SelectItem><SelectItem value="transfer">Transfer Bank</SelectItem></SelectContent>
                  </Select></div>
              </div>
              <div className="space-y-3">
                {combinedRows.map((row,index)=>(
                  <div key={index} className="grid items-end gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                    <div className="space-y-1"><Label>PIN X904 penerima {index+1}</Label>
                      <Input inputMode="numeric" value={row.pin} maxLength={8}
                        onChange={e=>setCombinedRows(current=>current.map((x,i)=>i===index?{...x,pin:e.target.value.replace(/[^0-9]/g,"")}:x))}
                        placeholder="PIN mesin" required /></div>
                    <div className="space-y-1"><Label>Jenis</Label>
                      <Select value={row.kind} onValueChange={value=>setCombinedRows(current=>current.map((x,i)=>i===index?{...x,kind:value as "new"|"renew",membershipId:""}:x))}>
                        <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                          <SelectItem value="new">Member baru</SelectItem><SelectItem value="renew">Perpanjangan</SelectItem>
                        </SelectContent></Select></div>
                    <div className="space-y-1"><Label>{row.kind==="renew"?"Membership ID":"Alokasi"}</Label>
                      {row.kind==="renew"
                        ? <Input value={row.membershipId} inputMode="numeric" placeholder="ID membership" required
                            onChange={e=>setCombinedRows(current=>current.map((x,i)=>i===index?{...x,membershipId:e.target.value.replace(/[^0-9]/g,"")}:x))}/>
                        : <Input value="Rp300.000 / 1 bulan" disabled />}</div>
                    <Button type="button" variant="outline" disabled={combinedRows.length<=2}
                      onClick={()=>setCombinedRows(current=>current.filter((_,i)=>i!==index))}>Hapus</Button>
                  </div>
                ))}
                <Button type="button" variant="outline" disabled={combinedRows.length>=10}
                  onClick={()=>setCombinedRows(current=>[...current,{pin:"",kind:"new",membershipId:""}])}>Tambah penerima</Button>
              </div>
              <div className="space-y-1"><Label>Satu bukti transfer / QRIS</Label>
                <Input type="file" accept="image/*" required onChange={e=>setCombinedProof(e.target.files?.[0]??null)}/></div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <strong>Total penerimaan: {formatRupiah(combinedRows.length * 300000)}</strong>
                <Button type="submit" disabled={combinedBusy || !combinedProof}>
                  {combinedBusy?"Menyimpan...":"Catat Bukti untuk Verifikasi Bank"}
                </Button>
              </div>
              {combinedOutcome && <p role="status" className="rounded-md border p-3 text-sm">{combinedOutcome}</p>}
            </form>
          </CardContent>
          </div>}
        </Card>
      )}


      <AlertDialog open={membershipConfirmOpen} onOpenChange={setMembershipConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {memberAction === "renew" ? "Konfirmasi Perpanjangan Membership" : memberAction === "new" ? "Konfirmasi Pendaftaran Membership" : "Konfirmasi Kunjungan Member"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                {memberAction === "renew" && matchedMember ? (
                  <>
                    <div className="rounded-lg border p-3 space-y-2 text-foreground">
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Member</span><strong>{matchedMember.name} · {matchedMember.phone}</strong></div>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Perpanjangan</span><strong>{memberMonths} bulan</strong></div>
                      {renewalStartDate && renewalEndDate && <div className="flex justify-between gap-4"><span className="text-muted-foreground">Periode berikutnya</span><strong>{renewalStartDate} – {renewalEndDate}</strong></div>}
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Tagihan</span><strong>{formatRupiah(membershipCharge)}</strong></div>
                    </div>
                    <p>Setelah dikonfirmasi, sistem membuat perpanjangan dan langsung menampilkan pembayaran pada halaman ini.</p>
                  </>
                ) : (
                  <p>{memberAction === "new" && getCurrentRole() !== "staff" ? "Konfirmasi dana sudah masuk. Satu transaksi akan membuat customer, membership dan pembayaran lunas tanpa booking kunjungan tambahan." : memberAction === "new" ? "Member baru akan dibuat dan bukti pembayaran diverifikasi terpisah oleh admin." : "Proses ini akan dicatat di sistem. Pastikan data yang dipilih sudah benar."}</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={isSubmitting}
              onClick={(e) => {
                e.preventDefault();
                setMembershipConfirmOpen(false);
                void submitMembership();
              }}
            >
              {isSubmitting ? "Memproses..." : memberAction === "renew" ? "Ya, Perpanjang Membership" : memberAction === "new" && getCurrentRole() !== "staff" ? "Ya, Daftarkan & Konfirmasi" : memberAction === "new" ? "Ya, Daftarkan Member" : "Ya, Catat Kunjungan"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
