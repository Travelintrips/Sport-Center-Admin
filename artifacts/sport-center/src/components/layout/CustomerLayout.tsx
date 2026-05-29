import { ReactNode, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, LogOut, CalendarDays, UserCircle, ChevronDown, MapPin, Phone, Instagram, Facebook, ShieldCheck, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGetMe, useLogout, getGetMeQueryKey, useGetSettings } from "@workspace/api-client-react";
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
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex font-medium text-foreground/60 hover:text-primary gap-1.5">
          <Link href="/admin/login"><ShieldCheck size={15} /> Admin</Link>
        </Button>
        <Button asChild variant="ghost" className="hidden md:inline-flex font-medium text-foreground/80 hover:text-foreground">
          <Link href="/login">Masuk</Link>
        </Button>
        <Button asChild className="rounded-full shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all font-semibold">
          <Link href="/register">Daftar</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full pl-2 pr-3 py-1.5 hover:bg-accent/50 transition-colors text-sm font-medium border border-border/50 bg-background/50 backdrop-blur-sm shadow-sm"
      >
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
          {user.name?.charAt(0).toUpperCase() ?? "?"}
        </div>
        <span className="hidden sm:block max-w-[120px] truncate font-semibold text-foreground/90">{user.name?.split(" ")[0] ?? ""}</span>
        <ChevronDown size={14} className="text-muted-foreground ml-1" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-56 bg-background border rounded-2xl shadow-xl z-40 overflow-hidden animate-in slide-in-from-top-2">
            <div className="px-4 py-4 border-b bg-muted/20">
              <div className="font-bold text-sm truncate text-foreground">{user.name}</div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">{user.email}</div>
            </div>
            <div className="p-2 space-y-1">
              <Link
                href="/my-bookings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-xl hover:bg-accent transition-colors w-full text-foreground/80 hover:text-foreground"
              >
                <CalendarDays size={16} className="text-primary" /> Booking Saya
              </Link>
              <div className="h-px bg-border/50 my-1 mx-2" />
              <button
                onClick={() => { setOpen(false); doLogoutMenu(); }}
                className="flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-xl hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors w-full text-left text-red-600"
              >
                <LogOut size={16} /> Keluar
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
  const [isScrolled, setIsScrolled] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const [location] = useLocation();

  const { data: user } = useGetMe({
    query: { retry: false, queryKey: getGetMeQueryKey(), staleTime: 60_000 },
  });
  
  const { data: settings } = useGetSettings();

  const logoutMutation = useLogout({
    mutation: { onSuccess: () => { removeToken(); } },
  });

  function doLogout() { logoutMutation.mutate(undefined as void); }

  useEffect(() => {
    const handleScroll = () => { setIsScrolled(window.scrollY > 20); setShowTop(window.scrollY > 400); };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);

  const waPhone = (() => {
    let p = settings?.whatsapp || "";
    if (p.startsWith("0")) p = "62" + p.slice(1);
    return p.replace(/[^0-9]/g, "");
  })();

  const navLinks = [
    { href: "/", label: "Beranda" },
    { href: "/facilities", label: "Fasilitas" },
    { href: "/promos", label: "Promo" },
    { href: "/contact", label: "Hubungi Kami" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20 selection:text-primary font-sans">
      <header 
        className={`fixed top-0 z-50 w-full transition-all duration-300 ${
          isScrolled 
            ? "bg-background/80 backdrop-blur-md border-b border-border/50 shadow-sm py-3" 
            : "bg-transparent py-5"
        }`}
      >
        <div className="container mx-auto px-4 md:px-8 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 font-black text-2xl tracking-tight text-secondary dark:text-foreground group">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20 group-hover:scale-105 transition-transform">
              <span className="font-bold text-xl leading-none">{settings?.centerName?.charAt(0) || "S"}</span>
            </div>
            <span className="hidden sm:inline-block">{settings?.centerName?.split(' ')[0] || "SportCenter"}</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1 bg-background/50 backdrop-blur-md border rounded-full px-2 py-1.5 shadow-sm">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm font-semibold px-4 py-2 rounded-full transition-all duration-200 ${
                  location === link.href 
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20" 
                    : "text-foreground/70 hover:text-foreground hover:bg-accent/50"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-4">
            <UserMenu />
          </div>

          <button
            className="md:hidden p-2 text-foreground bg-background/50 backdrop-blur-md border rounded-full"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden absolute top-full left-0 w-full border-b bg-background/95 backdrop-blur-xl shadow-xl animate-in slide-in-from-top-2 z-50">
            <nav className="flex flex-col p-4 gap-2">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-base font-bold p-4 rounded-2xl transition-colors flex items-center justify-between ${
                    location === link.href
                      ? "bg-primary/10 text-primary"
                      : "text-foreground/80 hover:bg-accent"
                  }`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}

              <div className="h-px bg-border/50 my-2 mx-4" />

              {user && user.role !== "admin" ? (
                <>
                  <div className="flex items-center gap-3 px-4 py-3 bg-muted/30 rounded-2xl mb-2">
                    <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary font-black text-lg">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-base font-bold">{user.name}</div>
                      <div className="text-sm text-muted-foreground">{user.email}</div>
                    </div>
                  </div>
                  <Link
                    href="/my-bookings"
                    className="flex items-center gap-3 text-base font-semibold p-4 rounded-2xl text-foreground/80 hover:bg-accent"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary"><CalendarDays size={16} /></div> 
                    Booking Saya
                  </Link>
                  <button
                    onClick={() => { setIsMobileMenuOpen(false); doLogout(); }}
                    className="flex items-center gap-3 text-base font-semibold p-4 rounded-2xl text-red-600 hover:bg-red-50 w-full text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600"><LogOut size={16} /></div>
                    Keluar Akun
                  </button>
                </>
              ) : (
                <div className="flex flex-col gap-3 p-2 mt-2">
                  <Button asChild variant="outline" className="h-12 rounded-xl text-base font-semibold" onClick={() => setIsMobileMenuOpen(false)}>
                    <Link href="/login">Masuk Akun</Link>
                  </Button>
                  <Button asChild className="h-12 rounded-xl text-base font-bold shadow-lg shadow-primary/20" onClick={() => setIsMobileMenuOpen(false)}>
                    <Link href="/register">Daftar Sekarang</Link>
                  </Button>
                  <Link href="/admin/login" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary mt-2 py-2">
                    <ShieldCheck size={15} /> Login Admin
                  </Link>
                </div>
              )}
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1 pt-20">
        {children}
      </main>

      <footer className="bg-secondary text-secondary-foreground pt-20 pb-10 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/0 via-primary to-primary/0 opacity-20"></div>
        <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-primary/5 blur-3xl pointer-events-none"></div>
        
        <div className="container mx-auto px-4 md:px-8 relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-12 lg:gap-16">
            <div className="col-span-1 md:col-span-5 lg:col-span-4">
              <Link href="/" className="flex items-center gap-3 font-black text-2xl mb-6 text-white group">
                <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
                  <span className="font-bold text-xl leading-none">{settings?.centerName?.charAt(0) || "S"}</span>
                </div>
                {settings?.centerName || "SportCenter"}
              </Link>
              <p className="text-secondary-foreground/70 mb-8 leading-relaxed max-w-sm">
                Fasilitas olahraga premium di Tangerang. Berlokasi strategis dekat Bandara Soekarno-Hatta dengan lapangan berkualitas dan pemesanan yang mudah.
              </p>
              <div className="space-y-4">
                <div className="flex items-start gap-3 text-secondary-foreground/80">
                  <MapPin size={20} className="text-primary shrink-0 mt-0.5" />
                  <span className="text-sm leading-relaxed">{settings?.address || 'Bandara Soekarno-Hatta, Tangerang, Banten'}</span>
                </div>
                <div className="flex items-center gap-3 text-secondary-foreground/80">
                  <Phone size={20} className="text-primary shrink-0" />
                  <span className="text-sm font-medium">{settings?.phone || '021-1234-5678'}</span>
                </div>
              </div>
            </div>

            <div className="col-span-1 md:col-span-3 lg:col-span-2 lg:col-start-7">
              <h3 className="font-bold text-lg mb-6 text-white">Eksplorasi</h3>
              <ul className="space-y-4">
                <li><Link href="/" className="text-secondary-foreground/70 hover:text-primary transition-colors text-sm font-medium inline-block">Beranda</Link></li>
                <li><Link href="/facilities" className="text-secondary-foreground/70 hover:text-primary transition-colors text-sm font-medium inline-block">Daftar Fasilitas</Link></li>
                <li><Link href="/promos" className="text-secondary-foreground/70 hover:text-primary transition-colors text-sm font-medium inline-block">Promo Spesial</Link></li>
                <li><Link href="/contact" className="text-secondary-foreground/70 hover:text-primary transition-colors text-sm font-medium inline-block">Hubungi Kami</Link></li>
              </ul>
            </div>

            <div className="col-span-1 md:col-span-4 lg:col-span-3">
              <h3 className="font-bold text-lg mb-6 text-white">Jam Operasional</h3>
              <div className="bg-white/5 rounded-2xl p-5 border border-white/10">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-secondary-foreground/70 text-sm">Senin - Minggu</span>
                  <span className="font-bold text-primary bg-primary/10 px-3 py-1 rounded-full text-xs">Buka</span>
                </div>
                <div className="text-2xl font-bold text-white mb-1">
                  {settings?.openHour || '06:00'} - {settings?.closeHour || '23:00'}
                </div>
                <p className="text-xs text-secondary-foreground/50">Waktu Indonesia Barat (WIB)</p>
              </div>
              
              <div className="mt-6 flex gap-3">
                <a href="#" className="w-10 h-10 rounded-full bg-white/5 hover:bg-primary hover:text-white flex items-center justify-center transition-all border border-white/10 text-secondary-foreground/70">
                  <Instagram size={18} />
                </a>
                <a href="#" className="w-10 h-10 rounded-full bg-white/5 hover:bg-primary hover:text-white flex items-center justify-center transition-all border border-white/10 text-secondary-foreground/70">
                  <Facebook size={18} />
                </a>
              </div>
            </div>
          </div>

          <div className="mt-16 pt-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm font-medium text-secondary-foreground/50">
              © {new Date().getFullYear()} {settings?.centerName || 'SportCenter'}. Hak cipta dilindungi.
            </p>
            <div className="flex items-center gap-6">
              <Link href="/terms" className="text-sm font-medium text-secondary-foreground/50 hover:text-white transition-colors">Syarat & Ketentuan</Link>
              <Link href="/privacy" className="text-sm font-medium text-secondary-foreground/50 hover:text-white transition-colors">Kebijakan Privasi</Link>
            </div>
          </div>
        </div>
      </footer>

      {/* Floating WhatsApp */}
      <a
        href={waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent('Halo, saya ingin bertanya tentang Sport Center Bandara Soekarno-Hatta')}` : '#'}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat WhatsApp"
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-[#25D366] text-white shadow-xl shadow-green-600/30 flex items-center justify-center hover:scale-110 hover:bg-[#20bd5a] transition-all"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      </a>

      {/* Back to top */}
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Kembali ke atas"
        className={`fixed bottom-24 right-6 z-50 w-12 h-12 rounded-full bg-secondary text-white shadow-lg flex items-center justify-center hover:scale-110 hover:bg-primary transition-all duration-300 ${showTop ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}
      >
        <ArrowUp size={20} />
      </button>
    </div>
  );
}