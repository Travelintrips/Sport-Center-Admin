import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import logoUrl from "@assets/logosc_1780088803724.png";
import { 
  LayoutDashboard, 
  CalendarDays, 
  MapPin, 
  Clock, 
  Users, 
  Tag, 
  Settings as SettingsIcon,
  LogOut,
  Menu,
  X,
  Dumbbell,
  Plane
} from "lucide-react";
import { useGetMe, useLogout, getGetMeQueryKey } from "@workspace/api-client-react";
import { removeToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  
  const { data: user, isLoading, isError } = useGetMe({
    query: {
      retry: false,
      queryKey: getGetMeQueryKey(),
      staleTime: 5 * 60 * 1000,
    }
  });

  const logoutMutation = useLogout({
    mutation: {
      onSuccess: () => {
        removeToken();
        setLocation("/");
      }
    }
  });

  useEffect(() => {
    if (isError && location !== "/admin/login") {
      setLocation("/admin/login");
    }
  }, [isError, location, setLocation]);

  const navItems = [
    { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/bookings", label: "Bookings", icon: CalendarDays },
    { href: "/admin/facilities", label: "Facilities", icon: MapPin },
    { href: "/admin/schedule", label: "Schedule", icon: Clock },
    { href: "/admin/customers", label: "Customers", icon: Users },
    { href: "/admin/promos", label: "Promos", icon: Tag },
    { href: "/admin/memberships", label: "Member Gym", icon: Dumbbell },
    { href: "/admin/ap-members", label: "Member AP", icon: Plane },
    { href: "/admin/settings", label: "Settings", icon: SettingsIcon },
  ];

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 bg-primary/20 rounded-full mb-4"></div>
          <div className="text-muted-foreground font-medium">Loading admin portal...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-muted/20">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 bg-background border-b z-20">
        <Link href="/admin" className="font-bold text-lg text-primary flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-primary text-primary-foreground flex items-center justify-center text-xs">S</div>
          Admin Portal
        </Link>
        <button onClick={() => setIsMobileOpen(!isMobileOpen)} className="p-2 -mr-2">
          {isMobileOpen ? <X /> : <Menu />}
        </button>
      </header>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-10 w-64 bg-sidebar text-sidebar-foreground border-r border-sidebar-border
        transform transition-transform duration-200 ease-in-out
        md:translate-x-0 md:static md:flex-shrink-0
        flex flex-col
        ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="h-16 hidden md:flex items-center px-6 border-b border-sidebar-border bg-sidebar-primary text-sidebar-primary-foreground">
          <Link href="/admin" className="font-bold text-lg flex items-center gap-2">
            <img src={logoUrl} alt="Logo" className="w-7 h-7 rounded object-cover" />
            Admin Portal
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto py-4">
          <nav className="space-y-1 px-3">
            {navItems.map((item) => {
              const isActive = location === item.href || (location === "/admin" && item.href === "/admin/dashboard");
              const Icon = item.icon;
              
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`
                    flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors
                    ${isActive 
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground' 
                      : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'}
                  `}
                  onClick={() => setIsMobileOpen(false)}
                >
                  <Icon size={18} className={isActive ? 'text-primary' : 'text-muted-foreground'} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
              {user?.name?.charAt(0) || 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.name || 'Admin'}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
          </div>
          <Button 
            variant="ghost" 
            className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={handleLogout}
            disabled={logoutMutation.isPending}
          >
            <LogOut size={18} className="mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-[100dvh] overflow-y-auto bg-background">
        <div className="flex-1 p-4 md:p-8">
          {children}
        </div>
      </main>
      
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-0 md:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}
    </div>
  );
}
