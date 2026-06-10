import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/lib/i18n";
import NotFound from "@/pages/not-found";

import "./lib/auth";

// Layouts
import CustomerLayout from "@/components/layout/CustomerLayout";
import AdminLayout from "@/components/layout/AdminLayout";

// Customer Pages
import Home from "@/pages/Home";
import Facilities from "@/pages/Facilities";
import FacilityDetail from "@/pages/FacilityDetail";
import Booking from "@/pages/Booking";
import BookingDetail from "@/pages/BookingDetail";
import Promos from "@/pages/Promos";
import Terms from "@/pages/Terms";
import Privacy from "@/pages/Privacy";
import Contact from "@/pages/Contact";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import MyBookings from "@/pages/MyBookings";
import MyProfile from "@/pages/MyProfile";
import VerifyId from "@/pages/VerifyId";
import Membership from "@/pages/Membership";
// Admin Pages
import AdminLogin from "@/pages/admin/Login";
import AdminDashboard from "@/pages/admin/Dashboard";
import AdminBookings from "@/pages/admin/Bookings";
import AdminFacilities from "@/pages/admin/Facilities";
import AdminSchedule from "@/pages/admin/Schedule";
import AdminCustomers from "@/pages/admin/Customers";
import AdminPromos from "@/pages/admin/Promos";
import AdminSettings from "@/pages/admin/Settings";
import AdminMemberships from "@/pages/admin/Memberships";
import AdminApMembers from "@/pages/admin/ApMembers";
import AdminAuditLog from "@/pages/admin/AuditLog";
import AdminPricingRules from "@/pages/admin/PricingRules";
import AdminMaintenance from "@/pages/admin/Maintenance";
import AdminReports from "@/pages/admin/Reports";
import AdminQrCheckin from "@/pages/admin/QrCheckin";
import AdminNotificationTemplates from "@/pages/admin/NotificationTemplates";
import AdminRescheduleRequests from "@/pages/admin/RescheduleRequests";
import AdminExtensionRequests from "@/pages/admin/ExtensionRequests";
import AdminCalendar from "@/pages/admin/Calendar";
import AdminCompanyBilling from "@/pages/admin/CompanyBilling";

// WhatsApp Booking Flow Pages (standalone, no auth)
import WaBookingForm from "@/pages/wa/BookingForm";
import WaBookingStatus from "@/pages/wa/BookingStatus";
import WaProofUpload from "@/pages/wa/ProofUpload";
import WaAdminAction from "@/pages/wa/AdminAction";

import { removeToken } from "@/lib/auth";

function handle401(error: unknown) {
  const status = (error as any)?.status ?? (error as any)?.response?.status;
  if (status === 401) {
    removeToken();
    window.location.href = "/admin/login";
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
    return <NotFound />;
  })();

  return <AdminLayout>{content}</AdminLayout>;
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
      <Route path="/admin" component={AdminRouter} />

      {/* WhatsApp Booking Flow — standalone, no layout wrapper */}
      <Route path="/wa/booking/:facilityId" component={WaBookingForm} />
      <Route path="/wa/status/:orderNumber" component={WaBookingStatus} />
      <Route path="/wa/proof/:token" component={WaProofUpload} />
      <Route path="/wa/action/:token" component={WaAdminAction} />

      {/* Customer Routes */}
      <Route path="*">
        <CustomerLayout>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/facilities" component={Facilities} />
            <Route path="/facilities/:id" component={FacilityDetail} />
            <Route path="/booking" component={Booking} />
            <Route path="/booking/:orderNumber" component={BookingDetail} />
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
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}

export default App;
