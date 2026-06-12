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
  Plane,
  Calendar,
  Shield,
  ShieldCheck,
  DollarSign,
  Wrench,
  TrendingUp,
  QrCode,
  Bell,
  RefreshCw,
  Building2,
  Send,
  Receipt,
  UserCog,
  Landmark,
} from "lucide-react";
import { useGetMe, useLogout, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { removeToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const NAV_GROUPS = [
  {
    label: "Utama",
    items: [
      { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/admin/bookings", label: "Pemesanan", icon: CalendarDays },
      { href: "/admin/calendar", label: "Kalender", icon: Calendar },
      { href: "/admin/qr-checkin", label: "QR Check-In", icon: QrCode },
      { href: "/admin/reschedule", label: "Reschedule", icon: RefreshCw },
      { href: "/admin/extensions", label: "Tambah Waktu", icon: Clock },
    ],
  },
  {
    label: "Fasilitas",
    items: [
      { href: "/admin/facilities", label: "Fasilitas", icon: MapPin },
      { href: "/admin/schedule", label: "Jadwal Blokir", icon: Clock },
      { href: "/admin/maintenance", label: "Pemeliharaan", icon: Wrench },
      { href: "/admin/pricing-rules", label: "Aturan Harga", icon: DollarSign },
    ],
  },
  {
    label: "Pelanggan",
    items: [
      { href: "/admin/customers", label: "Pelanggan", icon: Users },
      { href: "/admin/company-verifications", label: "Verifikasi Karyawan", icon: ShieldCheck },
      { href: "/admin/company-billing", label: "Tagihan Perusahaan", icon: Building2 },
      { href: "/admin/memberships", label: "Member Gym", icon: Dumbbell },
      { href: "/admin/ap-members", label: "Member AP", icon: Plane },
      { href: "/admin/promos", label: "Promo", icon: Tag },
    ],
  },
  {
    label: "Laporan & Sistem",
    items: [
      { href: "/admin/reports", label: "Laporan Keuangan", icon: TrendingUp },
      { href: "/admin/notifications", label: "Kirim WA", icon: Send },
      { href: "/admin/notification-templates", label: "Template WA", icon: Bell },
      { href: "/admin/tax-report", label: "Laporan Pajak PPN", icon: Receipt },
      { href: "/admin/bank-reconciliation", label: "Rekonsiliasi Bank", icon: Landmark },
      { href: "/admin/operator-accounts", label: "Akun Operator", icon: UserCog },
      { href: "/admin/audit-log", label: "Audit Log", icon: Shield },
      { href: "/admin/settings", label: "Pengaturan", icon: SettingsIcon },
    ],
  },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  
  const queryClient = useQueryClient();

  const { data: user, isLoading, isError, isFetching } = useGetMe({
    query: {
      retry: false,
      queryKey: getGetMeQueryKey(),
      staleTime: 0,
    }
  });

  const logoutMutation = useLogout({
    mutation: {
      onSuccess: () => {
        removeToken();
        queryClient.clear();
        setLocation("/");
      }
    }
  });

  useEffect(() => {
    if (isError && location !== "/admin/login") {
      setLocation("/admin/login");
    }
  }, [isError, location, setLocation]);

  const handleLogout = () => { logoutMutation.mutate(); };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 bg-primary/20 rounded-full mb-4"></div>
          <div className="text-muted-foreground font-medium">Memuat portal admin...</div>
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
          {import.meta.env.DEV && (
            <span className="text-[10px] font-black tracking-widest px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-500 border border-amber-400/30 uppercase">
              DEV
            </span>
          )}
        </Link>
        <button onClick={() => setIsMobileOpen(!isMobileOpen)} className="p-2 -mr-2">
          {isMobileOpen ? <X /> : <Menu />}
        </button>
      </header>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-10 w-60 bg-sidebar text-sidebar-foreground border-r border-sidebar-border
        transform transition-transform duration-200 ease-in-out
        md:translate-x-0 md:static md:flex-shrink-0
        flex flex-col
        ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="h-14 hidden md:flex items-center px-4 border-b border-sidebar-border bg-sidebar-primary text-sidebar-primary-foreground">
          <Link href="/admin" className="font-bold text-base flex items-center gap-2 flex-1 min-w-0">
            <img src={logoUrl} alt="Logo" className="w-7 h-7 rounded object-cover shrink-0" />
            <span className="truncate">Admin Portal</span>
          </Link>
          {import.meta.env.DEV && (
            <span className="ml-2 shrink-0 text-[10px] font-black tracking-widest px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30 uppercase">
              DEV
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto py-3">
          <nav className="px-2 space-y-4">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = location === item.href || (location === "/admin" && item.href === "/admin/dashboard");
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`
                          flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors
                          ${isActive 
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground' 
                            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'}
                        `}
                        onClick={() => setIsMobileOpen(false)}
                      >
                        <Icon size={16} className={isActive ? 'text-orange-400' : 'text-sidebar-foreground/40'} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>

        <div className="p-3 border-t border-sidebar-border">
          {import.meta.env.DEV && (
            <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-md bg-amber-400/10 border border-amber-400/20">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 animate-pulse" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Development DB</p>
                <p className="text-[9px] text-amber-400/60 truncate">Supabase CST DEV</p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2.5 px-3 py-2 mb-1">
            <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
              {user?.name?.charAt(0) || 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate text-sidebar-foreground">{user?.name || 'Admin'}</p>
              <p className="text-[10px] text-sidebar-foreground/50 truncate">{user?.role ?? user?.email}</p>
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="sm"
            className="w-full justify-start text-sidebar-foreground/60 hover:text-red-400 hover:bg-red-500/10"
            onClick={handleLogout}
            disabled={logoutMutation.isPending}
          >
            <LogOut size={16} className="mr-2" />
            Keluar
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
