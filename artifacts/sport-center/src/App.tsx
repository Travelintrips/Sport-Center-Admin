import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import "./lib/auth"; // Initialize auth token getter

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

// Admin Pages
import AdminLogin from "@/pages/admin/Login";
import AdminDashboard from "@/pages/admin/Dashboard";
import AdminBookings from "@/pages/admin/Bookings";
import AdminFacilities from "@/pages/admin/Facilities";
import AdminSchedule from "@/pages/admin/Schedule";
import AdminCustomers from "@/pages/admin/Customers";
import AdminPromos from "@/pages/admin/Promos";
import AdminSettings from "@/pages/admin/Settings";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      {/* Admin Auth */}
      <Route path="/admin/login" component={AdminLogin} />

      {/* Admin Routes */}
      <Route path="/admin*">
        <AdminLayout>
          <Switch>
            <Route path="/admin" component={AdminDashboard} />
            <Route path="/admin/dashboard" component={AdminDashboard} />
            <Route path="/admin/bookings" component={AdminBookings} />
            <Route path="/admin/facilities" component={AdminFacilities} />
            <Route path="/admin/schedule" component={AdminSchedule} />
            <Route path="/admin/customers" component={AdminCustomers} />
            <Route path="/admin/promos" component={AdminPromos} />
            <Route path="/admin/settings" component={AdminSettings} />
            <Route component={NotFound} />
          </Switch>
        </AdminLayout>
      </Route>

      {/* Customer Routes */}
      <Route path="*">
        <CustomerLayout>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/facilities" component={Facilities} />
            <Route path="/facilities/:id" component={FacilityDetail} />
            <Route path="/booking" component={Booking} />
            <Route path="/booking/:orderNumber" component={BookingDetail} />
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
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
