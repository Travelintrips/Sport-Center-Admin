import { ReactNode, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, LogOut, CalendarDays, ChevronDown, MapPin, Phone, Instagram, Facebook, ShieldCheck, ArrowUp, UserCircle, BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGetMe, useLogout, getGetMeQueryKey, useGetSettings } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { removeToken } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import logoUrl from "@assets/logosc_1780088803724.png";

function LangToggle({ className = "" }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <div className={`inline-flex items-center rounded-full border border-border/60 bg-background/60 p-0.5 text-xs font-bold ${className}`}>
      <button
        onClick={() => setLang("id")}
        className={`px-2.5 py-1 rounded-full transition-all ${lang === "id" ? "bg-primary text-white shadow-sm" : "text-foreground/50 hover:text-foreground"}`}
      >ID</button>
      <button
        onClick={() => setLang("en")}
        className={`px-2.5 py-1 rounded-full transition-all ${lang === "en" ? "bg-primary text-white shadow-sm" : "text-foreground/50 hover:text-foreground"}`}
      >EN</button>
    </div>
  );
}

function UserMenu() {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: user } = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey(), staleTime: 60_000 } });
  const logoutMutation = useLogout({
    mutation: {
      onSuccess: () => {
        removeToken();
        queryClient.clear();
        setLocation("/");
      },
    },
  });

  if (!user || user.role === "admin") {
    return (
      <div className="flex items-center gap-2">
        <LangToggle className="hidden md:inline-flex" />
        <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex text-foreground/50 hover:text-foreground gap-1.5 text-xs font-semibold px-2">
          <Link href="/admin/login"><ShieldCheck size={13} /> Admin</Link>
        </Button>
        <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex font-semibold text-foreground/70 hover:text-foreground">
          <Link href="/login">{t("Masuk", "Sign In")}</Link>
        </Button>
        <Button asChild size="sm" className="rounded-full px-5 font-bold shadow-md shadow-primary/25 hover:shadow-primary/40 transition-all">
          <Link href="/register">{t("Daftar", "Sign Up")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-2">
      <LangToggle className="hidden md:inline-flex" />
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full pl-1.5 pr-3 py-1.5 hover:bg-accent/60 transition-colors text-sm font-semibold border border-border/50 bg-background/60 backdrop-blur-sm"
      >
        <div className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center font-black text-xs">
          {user.name?.charAt(0).toUpperCase() ?? "?"}
        </div>
        <span className="hidden sm:block max-w-[100px] truncate">{user.name?.split(" ")[0]}</span>
        <ChevronDown size={13} className="text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-52 bg-background border border-border/60 rounded-2xl shadow-xl z-40 overflow-hidden animate-in slide-in-from-top-2 duration-150">
            <div className="px-4 py-3 border-b bg-muted/20">
              <div className="font-bold text-sm truncate">{user.name}</div>
              <div className="text-xs text-muted-foreground truncate">{user.email}</div>
            </div>
            <div className="p-2 space-y-0.5">
              <Link href="/my-bookings" onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-xl hover:bg-accent transition-colors w-full">
                <CalendarDays size={15} className="text-primary" /> {t("Booking Saya", "My Bookings")}
              </Link>
              <Link href="/my-profile" onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-xl hover:bg-accent transition-colors w-full">
                <UserCircle size={15} className="text-primary" /> {t("Profil Saya", "My Profile")}
              </Link>
              {(["staff", "admin", "super_admin", "admin_booking", "ap2_employee"] as string[]).includes(user.role) && (
                <Link href="/verify-id" onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-xl hover:bg-accent transition-colors w-full">
                  <BadgeCheck size={15} className="text-primary" /> {t("Verifikasi ID AP2", "Verify AP2 ID")}
                </Link>
              )}
              <div className="h-px bg-border/40 my-1 mx-2" />
              <button onClick={() => { setOpen(false); logoutMutation.mutate(undefined as void); }}
                className="flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-xl hover:bg-red-50 dark:hover:bg-red-950/30 w-full text-left text-red-500">
                <LogOut size={15} /> {t("Keluar", "Logout")}
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
  const [location, setLocation] = useLocation();

  const queryClient = useQueryClient();
  const { data: user } = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey(), staleTime: 60_000 } });
  const { data: settings } = useGetSettings();
  const { t } = useLang();
  const logoutMutation = useLogout({
    mutation: {
      onSuccess: () => {
        removeToken();
        queryClient.clear();
        setLocation("/");
      },
    },
  });

  useEffect(() => {
    const onScroll = () => { setIsScrolled(window.scrollY > 20); setShowTop(window.scrollY > 400); };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => { window.scrollTo(0, 0); }, [location]);

  const waPhone = (() => {
    let p = settings?.whatsapp || "";
    if (p.startsWith("0")) p = "62" + p.slice(1);
    return p.replace(/[^0-9]/g, "");
  })();

  const navLinks = [
    { href: "/",            label: t("Beranda",      "Home")     },
    { href: "/facilities",  label: t("Fasilitas",    "Venues")   },
    { href: "/promos",      label: t("Promo",        "Promos")   },
    { href: "/contact",     label: t("Hubungi Kami", "Contact")  },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background font-sans selection:bg-primary/20 selection:text-primary">

      {/* ── Topbar ── */}
      <header className={`fixed top-0 z-50 w-full transition-all duration-300 ${
        isScrolled ? "bg-background/90 backdrop-blur-xl border-b border-border/40 shadow-sm py-2.5" : "bg-transparent py-4"
      }`}>
        <div className="container mx-auto px-4 md:px-8 flex items-center justify-between gap-4">

          {/* Brand */}
          <Link href="/" className="flex items-center gap-3 shrink-0 group">
            <div className="relative">
              <img
                src={logoUrl}
                alt="Sport Center"
                className="w-10 h-10 rounded-xl object-cover shadow-md shadow-primary/20 group-hover:shadow-primary/40 group-hover:scale-105 transition-all duration-200"
              />
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full border-2 border-background shadow-sm" />
            </div>
            <div className="hidden sm:block">
              <div className="text-[15px] font-black tracking-tight leading-none text-foreground">Sport Center</div>
              <div className="text-[10px] font-semibold text-primary/80 tracking-widest uppercase leading-tight mt-0.5">Bandara Soekarno-Hatta</div>
            </div>
          </Link>

          {/* Nav pill – desktop */}
          <nav className="hidden md:flex items-center gap-0.5 bg-background/60 backdrop-blur-md border border-border/50 rounded-full px-1.5 py-1 shadow-sm">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-[13px] font-semibold px-4 py-2 rounded-full transition-all duration-200 ${
                  location === link.href
                    ? "bg-primary text-white shadow-sm shadow-primary/30"
                    : "text-foreground/60 hover:text-foreground hover:bg-accent/50"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Actions – desktop */}
          <div className="hidden md:flex items-center gap-2">
            <UserMenu />
          </div>

          {/* Hamburger – mobile */}
          <button
            className="md:hidden w-9 h-9 flex items-center justify-center rounded-full border border-border/50 bg-background/60 backdrop-blur-md text-foreground"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {/* ── Mobile menu ── */}
        {isMobileMenuOpen && (
          <div className="md:hidden absolute top-full left-0 w-full bg-background/97 backdrop-blur-2xl border-b border-border/40 shadow-2xl animate-in slide-in-from-top-1 duration-150 z-50">
            <div className="container mx-auto px-4 py-5 space-y-1">
              {navLinks.map((link) => (
                <Link key={link.href} href={link.href}
                  className={`flex items-center justify-between px-4 py-3.5 rounded-2xl font-semibold text-[15px] transition-colors ${
                    location === link.href ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-muted/60"
                  }`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {link.label}
                  {location === link.href && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                </Link>
              ))}

              <div className="h-px bg-border/40 my-3" />

              {user && user.role !== "admin" ? (
                <>
                  <div className="flex items-center gap-3 px-4 py-3 bg-muted/40 rounded-2xl mb-2">
                    <div className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center font-black">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-bold text-sm">{user.name}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </div>
                  </div>
                  <Link href="/my-bookings" onClick={() => setIsMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-2xl font-semibold text-[15px] text-foreground/80 hover:bg-muted/60">
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary"><CalendarDays size={14} /></div>
                    {t("Booking Saya", "My Bookings")}
                  </Link>
                  <Link href="/my-profile" onClick={() => setIsMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-2xl font-semibold text-[15px] text-foreground/80 hover:bg-muted/60">
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary"><UserCircle size={14} /></div>
                    {t("Profil Saya", "My Profile")}
                  </Link>
                  {(["staff", "admin", "super_admin", "admin_booking", "ap2_employee"] as string[]).includes(user.role as string) && (
                    <Link href="/verify-id" onClick={() => setIsMobileMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-3.5 rounded-2xl font-semibold text-[15px] text-foreground/80 hover:bg-muted/60">
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary"><BadgeCheck size={14} /></div>
                      {t("Verifikasi ID AP2", "Verify AP2 ID")}
                    </Link>
                  )}
                  <button onClick={() => { setIsMobileMenuOpen(false); logoutMutation.mutate(undefined as void); }}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-2xl font-semibold text-[15px] text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 w-full text-left">
                    <div className="w-7 h-7 rounded-full bg-red-100 dark:bg-red-950/40 flex items-center justify-center text-red-500"><LogOut size={14} /></div>
                    {t("Keluar Akun", "Sign Out")}
                  </button>
                </>
              ) : (
                <div className="flex flex-col gap-2.5 px-2 mt-2">
                  <Button asChild className="h-12 rounded-2xl font-bold text-[15px] shadow-md shadow-primary/20" onClick={() => setIsMobileMenuOpen(false)}>
                    <Link href="/register">{t("Daftar Sekarang", "Sign Up Free")}</Link>
                  </Button>
                  <Button asChild variant="outline" className="h-12 rounded-2xl font-semibold text-[15px]" onClick={() => setIsMobileMenuOpen(false)}>
                    <Link href="/login">{t("Masuk Akun", "Sign In")}</Link>
                  </Button>
                  <Link href="/admin/login" onClick={() => setIsMobileMenuOpen(false)}
                    className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-primary py-2 transition-colors">
                    <ShieldCheck size={13} /> {t("Login Admin", "Admin Login")}
                  </Link>
                </div>
              )}

              <div className="h-px bg-border/40 my-3" />
              <div className="flex justify-center pb-1"><LangToggle /></div>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 pt-20">{children}</main>

      {/* ── Footer ── */}
      <footer className="bg-secondary text-secondary-foreground pt-20 pb-10 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
        <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-primary/5 blur-3xl pointer-events-none" />

        <div className="container mx-auto px-4 md:px-8 relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-12 lg:gap-16">

            <div className="col-span-1 md:col-span-5 lg:col-span-4">
              <Link href="/" className="flex items-center gap-3 mb-6 group">
                <img src={logoUrl} alt="Sport Center" className="w-10 h-10 rounded-xl object-cover shadow-md shadow-primary/20" />
                <div>
                  <div className="text-[15px] font-black text-white tracking-tight leading-none">Sport Center</div>
                  <div className="text-[10px] font-semibold text-primary/80 tracking-widest uppercase leading-tight mt-0.5">Bandara Soekarno-Hatta</div>
                </div>
              </Link>
              <p className="text-secondary-foreground/60 mb-8 leading-relaxed text-sm max-w-xs">
                {t(
                  "Fasilitas olahraga premium berstandar internasional di kawasan Bandara Soekarno-Hatta, Tangerang.",
                  "Premium international-standard sports facilities at Soekarno-Hatta Airport area, Tangerang."
                )}
              </p>
              <div className="space-y-3">
                <div className="flex items-start gap-3 text-secondary-foreground/60">
                  <MapPin size={16} className="text-primary shrink-0 mt-0.5" />
                  <span className="text-sm leading-relaxed">{settings?.address || "Bandara Soekarno-Hatta, Tangerang, Banten"}</span>
                </div>
                <div className="flex items-center gap-3 text-secondary-foreground/60">
                  <Phone size={16} className="text-primary shrink-0" />
                  <span className="text-sm font-medium">{settings?.phone || "021-1234-5678"}</span>
                </div>
              </div>
            </div>

            <div className="col-span-1 md:col-span-3 lg:col-span-2 lg:col-start-7">
              <h3 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-5">{t("Navigasi", "Navigate")}</h3>
              <ul className="space-y-3.5">
                {[
                  { href: "/",           label: t("Beranda",          "Home")         },
                  { href: "/facilities", label: t("Daftar Fasilitas", "All Venues")   },
                  { href: "/promos",     label: t("Promo Spesial",    "Special Promos") },
                  { href: "/contact",    label: t("Hubungi Kami",     "Contact Us")   },
                ].map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-secondary-foreground/50 hover:text-primary transition-colors text-sm font-medium inline-flex items-center gap-1.5 group">
                      <span className="w-0 group-hover:w-2 h-px bg-primary transition-all duration-200 inline-block" />
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="col-span-1 md:col-span-4 lg:col-span-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-5">{t("Jam Operasional", "Hours")}</h3>
              <div className="bg-white/5 border border-white/8 rounded-2xl p-5">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-secondary-foreground/50 text-xs">{t("Senin – Minggu", "Mon – Sun")}</span>
                  <span className="text-xs font-bold text-green-400 bg-green-400/10 px-2.5 py-1 rounded-full">● {t("Buka", "Open")}</span>
                </div>
                <div className="text-3xl font-black text-white tracking-tight">
                  {settings?.openHour || "06:00"}<span className="text-white/30 mx-1">–</span>{settings?.closeHour || "23:00"}
                </div>
                <p className="text-xs text-secondary-foreground/30 mt-1.5">{t("Waktu Indonesia Barat", "WIB (UTC+7)")}</p>
              </div>

              <div className="mt-5 flex gap-2.5">
                <a href="#" className="w-9 h-9 rounded-xl bg-white/5 hover:bg-primary border border-white/8 flex items-center justify-center text-secondary-foreground/40 hover:text-white transition-all">
                  <Instagram size={16} />
                </a>
                <a href="#" className="w-9 h-9 rounded-xl bg-white/5 hover:bg-primary border border-white/8 flex items-center justify-center text-secondary-foreground/40 hover:text-white transition-all">
                  <Facebook size={16} />
                </a>
              </div>
            </div>
          </div>

          <div className="mt-16 pt-8 border-t border-white/8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-xs text-secondary-foreground/30">
              © {new Date().getFullYear()} Sport Center Bandara Soekarno-Hatta. {t("Hak cipta dilindungi.", "All rights reserved.")}
            </p>
            <div className="flex items-center gap-6">
              <Link href="/terms" className="text-xs text-secondary-foreground/30 hover:text-white transition-colors">{t("Syarat & Ketentuan", "Terms")}</Link>
              <Link href="/privacy" className="text-xs text-secondary-foreground/30 hover:text-white transition-colors">{t("Privasi", "Privacy")}</Link>
            </div>
          </div>
        </div>
      </footer>

      {/* ── WhatsApp FAB ── */}
      <a
        href={waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent("Halo, saya ingin bertanya tentang Sport Center")}` : "#"}
        target="_blank" rel="noopener noreferrer" aria-label="Chat WhatsApp"
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-2xl bg-[#25D366] text-white shadow-xl shadow-green-600/30 flex items-center justify-center hover:scale-110 hover:bg-[#1fbd5a] transition-all duration-200"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      </a>

      {/* ── Back to top ── */}
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Back to top"
        className={`fixed bottom-24 right-6 z-50 w-10 h-10 rounded-xl bg-secondary/90 text-white shadow-lg flex items-center justify-center hover:bg-primary transition-all duration-300 ${showTop ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"}`}
      >
        <ArrowUp size={17} />
      </button>
    </div>
  );
}
