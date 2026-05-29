import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

const queryClient = new QueryClient();

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
    if (location === "/admin/settings") return <AdminSettings />;
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
      <Route path="/admin/settings" component={AdminRouter} />
      <Route path="/admin" component={AdminRouter} />

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
