import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/lib/i18n";
import { CartProvider } from "@/lib/cart";
import NotFound from "@/pages/not-found";
import { Component, lazy, Suspense, type ReactNode, type ErrorInfo } from "react";

class AdminErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AdminErrorBoundary] Render error:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 text-center">
          <div className="text-4xl">⚠️</div>
          <h1 className="text-xl font-bold">Terjadi Kesalahan</h1>
          <p className="text-muted-foreground text-sm max-w-md">{this.state.error.message}</p>
          <button
            className="mt-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg"
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
          >
            Muat Ulang
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

import "./lib/auth";

// Layouts
import CustomerLayout from "@/components/layout/CustomerLayout";
import AdminLayout from "@/components/layout/AdminLayout";

// Customer Pages
import Home from "@/pages/Home";
const Facilities = lazy(() => import("@/pages/Facilities"));
const FacilityLanding = lazy(() => import("@/pages/FacilityLanding"));
const FacilityDetail = lazy(() => import("@/pages/FacilityDetail"));
const Booking = lazy(() => import("@/pages/Booking"));
const BookingDetail = lazy(() => import("@/pages/BookingDetail"));
const Promos = lazy(() => import("@/pages/Promos"));
const Terms = lazy(() => import("@/pages/Terms"));
const Privacy = lazy(() => import("@/pages/Privacy"));
const Contact = lazy(() => import("@/pages/Contact"));
const Login = lazy(() => import("@/pages/Login"));
const Register = lazy(() => import("@/pages/Register"));
const MyBookings = lazy(() => import("@/pages/MyBookings"));
const MyProfile = lazy(() => import("@/pages/MyProfile"));
const VerifyId = lazy(() => import("@/pages/VerifyId"));
const Membership = lazy(() => import("@/pages/Membership"));
const Cart = lazy(() => import("@/pages/Cart"));
// Admin Pages
const AdminLogin = lazy(() => import("@/pages/admin/Login"));
const AdminDashboard = lazy(() => import("@/pages/admin/Dashboard"));
const AdminBookings = lazy(() => import("@/pages/admin/Bookings"));
const AdminFacilities = lazy(() => import("@/pages/admin/Facilities"));
const AdminSchedule = lazy(() => import("@/pages/admin/Schedule"));
const AdminCustomers = lazy(() => import("@/pages/admin/Customers"));
const AdminPromos = lazy(() => import("@/pages/admin/Promos"));
const AdminSettings = lazy(() => import("@/pages/admin/Settings"));
const AdminMemberships = lazy(() => import("@/pages/admin/Memberships"));
const AdminApMembers = lazy(() => import("@/pages/admin/ApMembers"));
const AdminAuditLog = lazy(() => import("@/pages/admin/AuditLog"));
const AdminPricingRules = lazy(() => import("@/pages/admin/PricingRules"));
const AdminMaintenance = lazy(() => import("@/pages/admin/Maintenance"));
const AdminReports = lazy(() => import("@/pages/admin/Reports"));
const AdminQrCheckin = lazy(() => import("@/pages/admin/QrCheckin"));
const AdminNotificationTemplates = lazy(() => import("@/pages/admin/NotificationTemplates"));
const AdminRescheduleRequests = lazy(() => import("@/pages/admin/RescheduleRequests"));
const AdminExtensionRequests = lazy(() => import("@/pages/admin/ExtensionRequests"));
const AdminCalendar = lazy(() => import("@/pages/admin/Calendar"));
const AdminCompanyBilling = lazy(() => import("@/pages/admin/CompanyBilling"));
const AdminNotifications = lazy(() => import("@/pages/admin/Notifications"));
const AdminCompanyVerifications = lazy(() => import("@/pages/admin/CompanyVerifications"));
const AdminTaxReport = lazy(() => import("@/pages/admin/TaxReport"));
const AdminCheckoutForm = lazy(() => import("@/pages/admin/CheckoutForm"));
const AdminOperatorAccounts = lazy(() => import("@/pages/admin/OperatorAccounts"));
const AdminBankReconciliation = lazy(() => import("@/pages/admin/BankReconciliation"));
const AdminWaBookings = lazy(() => import("@/pages/admin/WaBookings"));
const AdminWaAiAssistant = lazy(() => import("@/pages/admin/WaAiAssistant"));
const AdminExpenses = lazy(() => import("@/pages/admin/Expenses"));
const AdminDocumentTemplates = lazy(() => import("@/pages/admin/DocumentTemplates"));
const AdminInvoiceSettings = lazy(() => import("@/pages/admin/InvoiceSettings"));
const AdminDocumentSettings = lazy(() => import("@/pages/admin/DocumentSettings"));
const AdminInvoiceView = lazy(() => import("@/pages/admin/InvoiceView"));
const AdminDataConnections = lazy(() => import("@/pages/admin/DataConnections"));
const AdminDiscountSettings = lazy(() => import("@/pages/admin/DiscountSettings"));
const AdminVendors = lazy(() => import("@/pages/admin/Vendors"));
const AdminPaylabsGateway = lazy(() => import("@/pages/admin/PaylabsGateway"));
const AdminPaymentSettlementConfigs = lazy(() => import("@/pages/admin/PaymentSettlementConfigs"));
const AdminCorporateSubscriptions = lazy(() => import("@/pages/admin/CorporateSubscriptions"));
const AdminEvents = lazy(() => import("@/pages/admin/Events"));

// WhatsApp Booking Flow Pages (standalone, no auth)
const WaBookingForm = lazy(() => import("@/pages/wa/BookingForm"));
const WaBookingStatus = lazy(() => import("@/pages/wa/BookingStatus"));
const WaProofUpload = lazy(() => import("@/pages/wa/ProofUpload"));
const WaUploadRedirect = lazy(() => import("@/pages/wa/UploadRedirect"));
const WaAdminAction = lazy(() => import("@/pages/wa/AdminAction"));
const WaAdminReview = lazy(() => import("@/pages/wa/AdminReview"));
const WaRegister = lazy(() => import("@/pages/wa/Register"));
const WaBookingApproval = lazy(() => import("@/pages/wa/BookingApproval"));
const WaKwitansi = lazy(() => import("@/pages/wa/Kwitansi"));

import { removeToken } from "@/lib/auth";

function handle401(error: unknown) {
  const status = (error as any)?.status ?? (error as any)?.response?.status;
  if (status === 401) {
    removeToken();
    const isAdminPath = window.location.pathname.startsWith("/admin");
    if (isAdminPath) {
      window.location.href = "/admin/login";
    }
    // Customer paths: token dihapus, biarkan halaman handle sendiri (tidak redirect paksa)
  }
}

const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: handle401,
  }),
  defaultOptions: {
    queries: { retry: false },
  },
});

function AdminRouter() {
  const [location] = useLocation();

  const content = (() => {
    if (location === "/admin" || location === "/admin/dashboard") return <AdminDashboard />;
    if (location === "/admin/bookings") return <AdminBookings />;
    if (location === "/admin/facilities") return <AdminFacilities />;
    if (location === "/admin/schedule") return <AdminSchedule />;
    if (location === "/admin/customers") return <AdminCustomers />;
    if (location === "/admin/promos") return <AdminPromos />;
    if (location === "/admin/memberships") return <AdminMemberships />;
    if (location === "/admin/ap-members") return <AdminApMembers />;
    if (location === "/admin/settings") return <AdminSettings />;
    if (location === "/admin/audit-log") return <AdminAuditLog />;
    if (location === "/admin/pricing-rules") return <AdminPricingRules />;
    if (location === "/admin/maintenance") return <AdminMaintenance />;
    if (location === "/admin/reports") return <AdminReports />;
    if (location === "/admin/qr-checkin") return <AdminQrCheckin />;
    if (location === "/admin/notification-templates") return <AdminNotificationTemplates />;
    if (location === "/admin/reschedule") return <AdminRescheduleRequests />;
    if (location === "/admin/extensions") return <AdminExtensionRequests />;
    if (location === "/admin/calendar") return <AdminCalendar />;
    if (location === "/admin/company-billing") return <AdminCompanyBilling />;
    if (location === "/admin/notifications") return <AdminNotifications />;
    if (location === "/admin/company-verifications") return <AdminCompanyVerifications />;
    if (location === "/admin/tax-report") return <AdminTaxReport />;
    if (location === "/admin/checkout") return <AdminCheckoutForm />;
    if (location === "/admin/operator-accounts") return <AdminOperatorAccounts />;
    if (location === "/admin/bank-reconciliation") return <AdminBankReconciliation />;
    if (location === "/admin/wa-bookings") return <AdminWaBookings />;
    if (location === "/admin/wa-ai") return <AdminWaAiAssistant />;
    if (location === "/admin/expenses") return <AdminExpenses />;
    if (location === "/admin/vendors") return <AdminVendors />;
    if (location === "/admin/invoice-settings") return <AdminInvoiceSettings />;
    if (location === "/admin/document-settings") return <AdminDocumentSettings />;
    if (location === "/admin/document-templates") return <AdminDocumentTemplates />;
    if (location.startsWith("/admin/invoice/")) return <AdminInvoiceView />;
    if (location === "/admin/data-connections") return <AdminDataConnections />;
    if (location === "/admin/discount-settings") return <AdminDiscountSettings />;
    if (location === "/admin/paylabs") return <AdminPaylabsGateway />;
    if (location === "/admin/payment-settlement") return <AdminPaymentSettlementConfigs />;
    if (location === "/admin/corporate-subscriptions") return <AdminCorporateSubscriptions />;
    if (location === "/admin/events") return <AdminEvents />;
    return <NotFound />;
  })();

  return <AdminLayout><AdminErrorBoundary>{content}</AdminErrorBoundary></AdminLayout>;
}

function Router() {
  return (
    <Switch>
      {/* Admin Auth */}
      <Route path="/admin/login" component={AdminLogin} />

      {/* All admin sub-routes */}
      <Route path="/admin/dashboard" component={AdminRouter} />
      <Route path="/admin/bookings" component={AdminRouter} />
      <Route path="/admin/facilities" component={AdminRouter} />
      <Route path="/admin/schedule" component={AdminRouter} />
      <Route path="/admin/customers" component={AdminRouter} />
      <Route path="/admin/promos" component={AdminRouter} />
      <Route path="/admin/memberships" component={AdminRouter} />
      <Route path="/admin/ap-members" component={AdminRouter} />
      <Route path="/admin/settings" component={AdminRouter} />
      <Route path="/admin/audit-log" component={AdminRouter} />
      <Route path="/admin/pricing-rules" component={AdminRouter} />
      <Route path="/admin/maintenance" component={AdminRouter} />
      <Route path="/admin/reports" component={AdminRouter} />
      <Route path="/admin/qr-checkin" component={AdminRouter} />
      <Route path="/admin/notification-templates" component={AdminRouter} />
      <Route path="/admin/reschedule" component={AdminRouter} />
      <Route path="/admin/extensions" component={AdminRouter} />
      <Route path="/admin/calendar" component={AdminRouter} />
      <Route path="/admin/company-billing" component={AdminRouter} />
      <Route path="/admin/notifications" component={AdminRouter} />
      <Route path="/admin/company-verifications" component={AdminRouter} />
      <Route path="/admin/tax-report" component={AdminRouter} />
      <Route path="/admin/checkout" component={AdminRouter} />
      <Route path="/admin/operator-accounts" component={AdminRouter} />
      <Route path="/admin/bank-reconciliation" component={AdminRouter} />
      <Route path="/admin/wa-bookings" component={AdminRouter} />
      <Route path="/admin/wa-ai" component={AdminRouter} />
      <Route path="/admin/expenses" component={AdminRouter} />
      <Route path="/admin/vendors" component={AdminRouter} />
      <Route path="/admin/invoice-settings" component={AdminRouter} />
      <Route path="/admin/document-settings" component={AdminRouter} />
      <Route path="/admin/document-templates" component={AdminRouter} />
      <Route path="/admin/invoice/:orderNumber" component={AdminRouter} />
      <Route path="/admin/data-connections" component={AdminRouter} />
      <Route path="/admin/discount-settings" component={AdminRouter} />
      <Route path="/admin/paylabs" component={AdminRouter} />
      <Route path="/admin/payment-settlement" component={AdminRouter} />
      <Route path="/admin/corporate-subscriptions" component={AdminRouter} />
      <Route path="/admin/events" component={AdminRouter} />
      <Route path="/admin" component={AdminRouter} />

      {/* WhatsApp Booking Flow — standalone, no layout wrapper */}
      <Route path="/wa/booking/:facilityId" component={WaBookingForm} />
      <Route path="/wa/status/:orderNumber" component={WaBookingStatus} />
      <Route path="/wa/upload/:orderNumber" component={WaUploadRedirect} />
      <Route path="/wa/proof/:token" component={WaProofUpload} />
      <Route path="/wa/action/:token" component={WaAdminAction} />
      <Route path="/wa/review/:token" component={WaAdminReview} />
      <Route path="/wa/register/:token" component={WaRegister} />
      <Route path="/wa/booking-approval/:token" component={WaBookingApproval} />
      <Route path="/kwitansi/:orderNumber" component={WaKwitansi} />
      {/* Short URL aliases — digunakan di pesan WA agar link lebih ringkas */}
      <Route path="/bukti/:token" component={WaProofUpload} />
      <Route path="/status/:orderNumber" component={WaBookingStatus} />
      <Route path="/ulasan/:token" component={WaAdminReview} />
      {/* Customer Routes */}
      <Route path="*">
        <CustomerLayout>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/facilities" component={Facilities} />
            <Route path="/futsal" component={FacilityLanding} />
            <Route path="/badminton" component={FacilityLanding} />
            <Route path="/basket" component={FacilityLanding} />
            <Route path="/gym" component={FacilityLanding} />
            <Route path="/facilities/:id" component={FacilityDetail} />
            <Route path="/booking" component={Booking} />
            <Route path="/booking/:orderNumber" component={BookingDetail} />
            <Route path="/cart" component={Cart} />
            <Route path="/login" component={Login} />
            <Route path="/register" component={Register} />
            <Route path="/my-bookings" component={MyBookings} />
            <Route path="/my-profile" component={MyProfile} />
            <Route path="/verify-id" component={VerifyId} />
            <Route path="/membership" component={Membership} />
            <Route path="/promos" component={Promos} />
            <Route path="/terms" component={Terms} />
            <Route path="/privacy" component={Privacy} />
            <Route path="/contact" component={Contact} />
            <Route component={NotFound} />
          </Switch>
        </CustomerLayout>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <CartProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Memuat halaman…</div>}>
                <Router />
              </Suspense>
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </CartProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}

export default App;
