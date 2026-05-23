import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, LogOut, CalendarDays, UserCircle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGetMe, useLogout, getGetMeQueryKey } from "@workspace/api-client-react";
import { removeToken } from "@/lib/auth";

function UserMenu() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();

  const { data: user } = useGetMe({
    query: { retry: false, queryKey: getGetMeQueryKey(), staleTime: 60_000 },
  });

  const logoutMutation = useLogout({
    mutation: {
      onSuccess: () => {
        removeToken();
        setLocation("/");
      },
    },
  });

  function doLogoutMenu() { logoutMutation.mutate(undefined as void); }

  if (!user || user.role === "admin") {
    return (
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
          <Link href="/login">Masuk</Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/register">Daftar</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full px-3 py-1.5 hover:bg-accent transition-colors text-sm font-medium"
      >
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary font-black text-sm">
          {user.name.charAt(0).toUpperCase()}
        </div>
        <span className="hidden sm:block max-w-[100px] truncate">{user.name.split(" ")[0]}</span>
        <ChevronDown size={14} className="text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-48 bg-background border rounded-xl shadow-lg z-40 overflow-hidden">
            <div className="px-4 py-3 border-b">
              <div className="font-semibold text-sm truncate">{user.name}</div>
              <div className="text-xs text-muted-foreground truncate">{user.email}</div>
            </div>
            <div className="p-1">
              <Link
                href="/my-bookings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-accent transition-colors w-full"
              >
                <CalendarDays size={15} /> Booking Saya
              </Link>
              <button
                onClick={() => { setOpen(false); doLogoutMenu(); }}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-accent transition-colors w-full text-left text-red-600 hover:text-red-700"
              >
                <LogOut size={15} /> Keluar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function CustomerLayout({ children }: { children: ReactNode }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [location] = useLocation();

  const { data: user } = useGetMe({
    query: { retry: false, queryKey: getGetMeQueryKey(), staleTime: 60_000 },
  });

  const logoutMutation = useLogout({
    mutation: { onSuccess: () => { removeToken(); } },
  });

  function doLogout() { logoutMutation.mutate(undefined as void); }

  const navLinks = [
    { href: "/", label: "Home" },
    { href: "/facilities", label: "Fasilitas" },
    { href: "/membership", label: "Member Gym" },
    { href: "/promos", label: "Promo" },
    { href: "/contact", label: "Kontak" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-xl tracking-tight text-primary">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground">
              <span className="font-bold text-lg leading-none">S</span>
            </div>
            SportCenter
          </Link>

          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm font-medium transition-colors hover:text-primary ${
                  location === link.href ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <Link href="/admin/login" className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">
              Admin
            </Link>
            <div className="w-px h-4 bg-border" />
            <UserMenu />
            <Button asChild size="sm" className="ml-1">
              <Link href="/facilities">Pesan</Link>
            </Button>
          </div>

          <button
            className="md:hidden p-2 text-foreground"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-t p-4 bg-background">
            <nav className="flex flex-col gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-sm font-medium p-2.5 rounded-lg transition-colors ${
                    location === link.href
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent"
                  }`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}

              <div className="h-px bg-border my-2" />

              {user && user.role !== "admin" ? (
                <>
                  <div className="flex items-center gap-2 px-2.5 py-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-black">
                      {user.name.charAt(0)}
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{user.name}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </div>
                  </div>
                  <Link
                    href="/my-bookings"
                    className="flex items-center gap-2 text-sm p-2.5 rounded-lg text-muted-foreground hover:bg-accent"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <CalendarDays size={15} /> Booking Saya
                  </Link>
                  <button
                    onClick={() => { setIsMobileMenuOpen(false); doLogout(); }}
                    className="flex items-center gap-2 text-sm p-2.5 rounded-lg text-red-600 hover:bg-red-50 w-full text-left"
                  >
                    <LogOut size={15} /> Keluar
                  </button>
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  <Button asChild variant="outline" onClick={() => setIsMobileMenuOpen(false)}>
                    <Link href="/login">Masuk</Link>
                  </Button>
                  <Button asChild onClick={() => setIsMobileMenuOpen(false)}>
                    <Link href="/register">Daftar</Link>
                  </Button>
                </div>
              )}

              <div className="h-px bg-border my-2" />
              <Link
                href="/admin/login"
                className="text-xs p-2 text-muted-foreground/60 hover:text-muted-foreground"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Admin Login
              </Link>
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1">
        {children}
      </main>

      <footer className="bg-secondary text-secondary-foreground border-t mt-auto">
        <div className="container mx-auto px-4 md:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="col-span-1 md:col-span-2">
              <Link href="/" className="flex items-center gap-2 font-bold text-xl mb-4 text-primary">
                <div className="w-6 h-6 rounded bg-primary flex items-center justify-center text-primary-foreground">
                  <span className="font-bold text-sm leading-none">S</span>
                </div>
                SportCenter
              </Link>
              <p className="text-muted-foreground mb-4 max-w-sm">
                Fasilitas olahraga premium di Jakarta. Lapangan berkualitas, peralatan profesional, dan komunitas yang aktif.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-lg mb-4">Link Cepat</h3>
              <ul className="space-y-2">
                <li><Link href="/facilities" className="text-muted-foreground hover:text-primary transition-colors">Fasilitas</Link></li>
                <li><Link href="/membership" className="text-muted-foreground hover:text-primary transition-colors">Member Gym</Link></li>
                <li><Link href="/promos" className="text-muted-foreground hover:text-primary transition-colors">Promo & Events</Link></li>
                <li><Link href="/my-bookings" className="text-muted-foreground hover:text-primary transition-colors">Booking Saya</Link></li>
                <li><Link href="/contact" className="text-muted-foreground hover:text-primary transition-colors">Kontak Kami</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold text-lg mb-4">Legal</h3>
              <ul className="space-y-2">
                <li><Link href="/terms" className="text-muted-foreground hover:text-primary transition-colors">Syarat & Ketentuan</Link></li>
                <li><Link href="/privacy" className="text-muted-foreground hover:text-primary transition-colors">Kebijakan Privasi</Link></li>
              </ul>
            </div>
          </div>

          <div className="mt-12 pt-8 border-t border-border flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} SportCenter Jakarta. Hak cipta dilindungi.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
