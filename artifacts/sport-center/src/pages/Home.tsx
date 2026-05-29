import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Trophy, 
  Clock, 
  MapPin, 
  Phone,
  ArrowRight,
  ShieldCheck,
  Zap,
  Target,
  Star,
  Quote,
  CheckCircle2,
  Users,
  CreditCard,
  Building,
  TrendingUp,
  Activity
} from "lucide-react";
import { useListFacilities, useGetSettings, useListPromos } from "@workspace/api-client-react";
import { getFacilityImage } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

function AnimatedCounter({ end, label, suffix = "+" }: { end: number, label: string, suffix?: string }) {
  // A simple static representation that implies a counter
  return (
    <div className="flex flex-col items-center justify-center p-6 bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-border/50">
      <div className="text-4xl md:text-5xl font-black text-primary mb-2 flex items-center">
        {end}{suffix}
      </div>
      <div className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">{label}</div>
    </div>
  );
}

export default function Home() {
  const { t } = useLang();
  const { data: facilities } = useListFacilities({ activeOnly: true });
  const { data: settings } = useGetSettings();
  const { data: promos } = useListPromos({ activeOnly: true });
  
  // Highlight facilities
  const highlightFacilities = facilities?.slice(0, 3) || [];

  return (
    <div className="flex flex-col min-h-screen">
      {/* Hero Section */}
      <section className="relative bg-[#F8FAFC] dark:bg-slate-950 overflow-hidden pt-12 pb-24 md:pt-24 md:pb-32 lg:pt-32 lg:pb-40">
        <div className="absolute top-0 right-0 w-[60%] h-full bg-gradient-to-l from-primary/5 to-transparent hidden lg:block" />
        
        <div className="container relative z-10 px-4 md:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-8 items-center">
            
            {/* Hero Content */}
            <div className="max-w-2xl animate-in fade-in slide-in-from-bottom-8 duration-700">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary font-bold text-sm mb-6 border border-primary/20">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                {t("Fasilitas Olahraga Premium Tangerang", "Premium Sports Facilities in Tangerang")}
              </div>
              
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-secondary dark:text-white leading-[1.1] mb-6">
                Sport Center <span className="text-primary relative inline-block">Bandara Soekarno-Hatta<svg className="absolute -bottom-2 left-0 w-full h-3 text-primary/30" viewBox="0 0 100 10" preserveAspectRatio="none"><path d="M0,5 Q50,10 100,5" stroke="currentColor" strokeWidth="8" fill="none" strokeLinecap="round"/></svg></span>
              </h1>
              
              <p className="text-lg md:text-xl text-muted-foreground mb-8 leading-relaxed font-medium max-w-xl">
                {t("Tingkatkan pengalaman berolahraga Anda. Booking lapangan futsal, basket, tenis, hingga gym premium dengan mudah dalam hitungan detik.", "Elevate your sports experience. Easily book futsal, basketball, and tennis courts, even a premium gym, in a matter of seconds.")}
              </p>
              
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <Button size="lg" className="w-full sm:w-auto h-14 px-8 text-base font-bold shadow-xl shadow-primary/25 hover:shadow-primary/40 transition-all rounded-full group" asChild>
                  <Link href="/facilities">
                    {t("Booking Sekarang", "Book Now")} <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="w-full sm:w-auto h-14 px-8 text-base font-bold rounded-full bg-white dark:bg-slate-900 border-border shadow-sm hover:bg-accent" asChild>
                  <Link href="/facilities">
                    {t("Lihat Fasilitas", "View Facilities")}
                  </Link>
                </Button>
              </div>
              
              <div className="mt-10 flex items-center gap-6">
                <div className="flex -space-x-4">
                  {[1,2,3,4].map(i => (
                    <div key={i} className="w-10 h-10 rounded-full border-2 border-white dark:border-slate-950 bg-muted flex items-center justify-center overflow-hidden">
                      <img src={`https://api.dicebear.com/7.x/notionists/svg?seed=${i}&backgroundColor=f97316,f8fafc`} alt="User" />
                    </div>
                  ))}
                </div>
                <div className="text-sm font-semibold">
                  <span className="text-primary block font-black">1,000+</span> 
                  <span className="text-muted-foreground">{t("Atlet lokal bergabung", "Local athletes joined")}</span>
                </div>
              </div>
            </div>
            
            {/* Hero Visual */}
            <div className="relative animate-in fade-in slide-in-from-right-12 duration-1000 delay-150">
              <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 to-transparent rounded-3xl transform rotate-3 scale-105" />
              <div className="relative rounded-3xl overflow-hidden shadow-2xl border-4 border-white dark:border-slate-900 bg-muted aspect-[4/3] group">
                <img 
                  src="/api/uploads/facility-1780070935997-xzu8f.png" 
                  alt="Sport Center Bandara Soekarno-Hatta" 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                />
                
                <div className="absolute bottom-6 left-6 right-6 p-4 rounded-2xl bg-white/90 dark:bg-slate-950/90 backdrop-blur-md shadow-lg border border-white/20 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center text-green-600">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="font-bold text-secondary dark:text-white">{t("Buka Hari Ini", "Open Today")}</div>
                      <div className="text-xs font-semibold text-muted-foreground">{settings?.openHour || '06:00'} - {settings?.closeHour || '23:00'} WIB</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center justify-end gap-1 text-yellow-500 mb-1">
                      <Star className="w-4 h-4 fill-yellow-500" />
                      <Star className="w-4 h-4 fill-yellow-500" />
                      <Star className="w-4 h-4 fill-yellow-500" />
                      <Star className="w-4 h-4 fill-yellow-500" />
                      <Star className="w-4 h-4 fill-yellow-500" />
                    </div>
                    <div className="text-xs font-bold text-secondary dark:text-white">4.9/5 {t("Rating", "Rating")}</div>
                  </div>
                </div>
              </div>
            </div>
            
          </div>
        </div>
      </section>
      
      {/* Stats Section */}
      <section className="relative z-20 -mt-10 mb-16 px-4 md:px-8 max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
          <AnimatedCounter end={5000} label={t("Total Booking", "Total Bookings")} />
          <AnimatedCounter end={20} label={t("Fasilitas Premium", "Premium Facilities")} suffix="+" />
          <AnimatedCounter end={1200} label={t("Member Aktif", "Active Members")} suffix="+" />
          <div className="flex flex-col items-center justify-center p-6 bg-primary rounded-3xl shadow-lg shadow-primary/30 text-white">
            <div className="text-4xl md:text-5xl font-black mb-2 flex items-center">
              4.9<span className="text-2xl opacity-70">/5</span>
            </div>
            <div className="text-sm font-bold uppercase tracking-widest opacity-90 text-center">{t("Kepuasan Pelanggan", "Customer Satisfaction")}</div>
          </div>
        </div>
      </section>

      {/* Facilities Highlight */}
      <section className="py-20 md:py-28 bg-white dark:bg-slate-950">
        <div className="container px-4 md:px-8">
          <div className="flex flex-col md:flex-row justify-between items-end mb-12 gap-6">
            <div className="max-w-2xl">
              <h2 className="text-3xl md:text-5xl font-black tracking-tight text-secondary dark:text-white mb-4">
                {t("Fasilitas", "The Best")} <span className="text-primary">{t("Terbaik", "Facilities")}</span> {t("Untuk Anda", "For You")}
              </h2>
              <p className="text-lg text-muted-foreground font-medium">
                {t("Pilih dari beragam lapangan olahraga standar profesional yang dirawat dengan sempurna setiap harinya.", "Choose from a variety of professional-standard sports courts that are perfectly maintained every day.")}
              </p>
            </div>
            <Button size="lg" variant="outline" asChild className="rounded-full hidden md:flex items-center gap-2 border-border font-bold">
              <Link href="/facilities">{t("Lihat Semua Kategori", "View All Categories")} <ArrowRight className="w-4 h-4" /></Link>
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {highlightFacilities.map((facility, idx) => (
              <Card key={facility.id} className="group border-none shadow-lg hover:shadow-xl transition-all duration-500 rounded-3xl overflow-hidden bg-white dark:bg-slate-900 h-full flex flex-col translate-y-0 hover:-translate-y-2">
                <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                  <img 
                    src={getFacilityImage(facility.category, facility.images)} 
                    alt={facility.name}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-in-out" 
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-60" />
                  
                  {/* Tags */}
                  <div className="absolute top-4 left-4 flex gap-2">
                    <div className="bg-primary text-white px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider shadow-md">
                      {t("Populer", "Popular")}
                    </div>
                  </div>
                  
                  {/* Category */}
                  <div className="absolute bottom-4 left-4 right-4">
                    <div className="bg-white/20 backdrop-blur-md text-white border border-white/20 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider inline-block mb-2">
                      {facility.category}
                    </div>
                  </div>
                </div>
                
                <CardContent className="p-6 md:p-8 flex-1 flex flex-col">
                  <h3 className="text-2xl font-black text-secondary dark:text-white mb-2 line-clamp-1 group-hover:text-primary transition-colors">{facility.name}</h3>
                  <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground mb-4">
                    <Users className="w-4 h-4" /> 
                    <span>{t("Kapasitas", "Capacity")} {facility.capacity || 10} {t("Orang", "People")}</span>
                  </div>
                  
                  <div className="mt-auto pt-6 border-t border-border flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">{t("Mulai Dari", "Starting From")}</div>
                      <div className="text-xl font-black text-primary">Rp {facility.pricePerHour.toLocaleString('id-ID')}</div>
                    </div>
                    <Button className="rounded-full shadow-md shadow-primary/20 font-bold" asChild>
                      <Link href={`/facilities/${facility.id}`}>{t("Booking", "Book")}</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          
          <Button size="lg" asChild className="w-full mt-8 rounded-xl h-14 font-bold md:hidden text-base">
            <Link href="/facilities">{t("Jelajahi Semua Fasilitas", "Explore All Facilities")}</Link>
          </Button>
        </div>
      </section>

      {/* Trust Section / Why Choose Us */}
      <section className="py-20 md:py-28 bg-[#F8FAFC] dark:bg-slate-950">
        <div className="container px-4 md:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl md:text-5xl font-black tracking-tight text-secondary dark:text-white mb-4">
              {t("Mengapa Memilih Kami?", "Why Choose Us?")}
            </h2>
            <p className="text-lg text-muted-foreground font-medium">
              {t("Kami berkomitmen memberikan pengalaman olahraga terbaik dari awal pemesanan hingga sesi Anda berakhir.", "We are committed to providing the best sports experience from the start of your booking until the end of your session.")}
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {[
              { Icon: Trophy, title: t("Fasilitas Premium", "Premium Facilities"), desc: t("Standar lapangan dan peralatan profesional yang dirawat ketat setiap hari.", "Professional-standard courts and equipment that are strictly maintained every day.") },
              { Icon: Zap, title: t("Booking Online Mudah", "Easy Online Booking"), desc: t("Cek jadwal real-time dan pesan lapangan langsung dari smartphone Anda.", "Check real-time schedules and book courts directly from your smartphone.") },
              { Icon: CreditCard, title: t("Harga Transparan", "Transparent Pricing"), desc: t("Tidak ada biaya tersembunyi. Bayar sesuai harga yang tertera di sistem.", "No hidden fees. Pay according to the price shown in the system.") },
              { Icon: MapPin, title: t("Lokasi Strategis", "Strategic Location"), desc: t("Sangat mudah diakses, berdekatan dengan area Bandara Soekarno-Hatta.", "Very easy to access, close to the Soekarno-Hatta Airport area.") },
              { Icon: Phone, title: t("Customer Support 24/7", "24/7 Customer Support"), desc: t("Tim kami siap membantu Anda kapan saja melalui WhatsApp.", "Our team is ready to help you anytime via WhatsApp.") },
              { Icon: ShieldCheck, title: t("Pembayaran Aman", "Secure Payment"), desc: t("Transaksi terjamin dengan berbagai metode pembayaran digital yang aman.", "Transactions guaranteed with various secure digital payment methods.") },
            ].map((feature, i) => (
              <div key={i} className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-border/50 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-6">
                  <feature.Icon className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-secondary dark:text-white mb-3">{feature.title}</h3>
                <p className="text-muted-foreground font-medium leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Promos */}
      {promos && promos.length > 0 && (
        <section className="py-20 md:py-28 bg-white dark:bg-slate-950 overflow-hidden">
          <div className="container px-4 md:px-8">
            <div className="flex flex-col md:flex-row justify-between items-end mb-12 gap-6">
              <div className="max-w-2xl">
                <h2 className="text-3xl md:text-5xl font-black tracking-tight text-secondary dark:text-white mb-4">
                  {t("Promo &", "Promos &")} <span className="text-primary">{t("Event", "Events")}</span>
                </h2>
                <p className="text-lg text-muted-foreground font-medium">{t("Jangan lewatkan kesempatan hemat dan acara seru dari kami bulan ini.", "Don't miss out on savings and exciting events from us this month.")}</p>
              </div>
              <Button size="lg" variant="ghost" asChild className="font-bold text-primary hover:text-primary hover:bg-primary/10 rounded-full hidden md:flex items-center gap-2">
                <Link href="/promos">{t("Lihat Semua Promo", "View All Promos")} <ArrowRight className="w-4 h-4" /></Link>
              </Button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {promos.slice(0, 2).map((promo) => (
                <div key={promo.id} className="group relative bg-[#F8FAFC] dark:bg-slate-900 rounded-3xl overflow-hidden border border-border/50 flex flex-col sm:flex-row shadow-sm hover:shadow-xl transition-all duration-500">
                  <div className="w-full sm:w-2/5 aspect-square sm:aspect-auto relative overflow-hidden bg-muted shrink-0">
                    <img 
                      src={promo.imageUrl || '/hero.png'} 
                      alt={promo.title} 
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" 
                    />
                    {promo.discountPercent && (
                      <div className="absolute top-4 left-4 bg-red-500 text-white px-3 py-1.5 rounded-xl text-sm font-black shadow-lg transform -rotate-2">
                        DISUKON {promo.discountPercent}%
                      </div>
                    )}
                  </div>
                  
                  <div className="w-full sm:w-3/5 p-6 md:p-8 flex flex-col justify-center">
                    <div className="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest mb-4 w-fit
                      bg-primary/10 text-primary">
                      {promo.type === 'promo' ? t('Penawaran Spesial', 'Special Offer') : t('Acara Spesial', 'Special Event')}
                    </div>
                    
                    <h3 className="font-black text-2xl text-secondary dark:text-white mb-3 line-clamp-2">{promo.title}</h3>
                    <p className="text-muted-foreground font-medium text-sm mb-6 line-clamp-3 leading-relaxed">{promo.description}</p>
                    
                    <div className="mt-auto">
                      <Button asChild className="rounded-full font-bold shadow-md shadow-primary/20 w-full sm:w-auto">
                        <Link href="/promos">{t("Ambil Promo", "Get Promo")}</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Testimonials */}
      <section className="py-20 md:py-28 bg-secondary dark:bg-slate-950 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
        
        <div className="container relative z-10 px-4 md:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
              {t("Apa Kata", "What")} <span className="text-primary">{t("Atlet Kami", "Our Athletes Say")}</span>
            </h2>
            <p className="text-lg text-secondary-foreground/70 font-medium max-w-2xl mx-auto">
              {t("Testimoni nyata dari pelanggan yang telah membuktikan kualitas fasilitas dan pelayanan kami.", "Real testimonials from customers who have proven the quality of our facilities and service.")}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {[
              {
                quote: t("Lantai lapangan futsalnya berstandar tinggi, empuk di lutut. Sistem bookingnya juga cepat tanpa antri. Fix jadi tempat rutin tim kami!", "The futsal court flooring is high-standard, gentle on the knees. The booking system is also fast with no queues. Definitely our team's regular spot!"),
                name: "Bima Arya",
                role: t("Kapten Tim Futsal", "Futsal Team Captain"),
                rating: 5
              },
              {
                quote: t("Transit 4 jam nunggu pesawat? Nge-gym di sini solusinya. Alatnya lengkap, shower room-nya sekelas hotel. Badan langsung segar!", "A 4-hour transit waiting for a flight? Hitting the gym here is the solution. The equipment is complete, the shower room is hotel-class. Instantly refreshing!"),
                name: "Dian Sastrowardoyo",
                role: t("Frequent Traveler", "Frequent Traveler"),
                rating: 5
              },
              {
                quote: t("Sangat rekomended untuk event korporat. Panitia dibantu dari awal, fasilitas parkir luas, dan lapangannya terang benderang.", "Highly recommended for corporate events. The committee was helped from the start, ample parking facilities, and the courts are brightly lit."),
                name: "Reza Rahadian",
                role: t("HRD Manager", "HR Manager"),
                rating: 5
              },
            ].map((t, i) => (
              <div key={i} className="bg-white/5 border border-white/10 p-8 rounded-3xl backdrop-blur-sm relative hover:bg-white/10 transition-colors">
                <Quote className="absolute top-8 right-8 text-primary/30 w-12 h-12" />
                <div className="flex gap-1 mb-6">
                  {Array.from({ length: t.rating }).map((_, s) => (
                    <Star key={s} className="w-5 h-5 fill-primary text-primary" />
                  ))}
                </div>
                <p className="text-lg text-white/90 font-medium leading-relaxed mb-8 relative z-10">"{t.quote}"</p>
                <div className="flex items-center gap-4 mt-auto">
                  <div className="w-12 h-12 rounded-full bg-primary/20 border border-primary/30 text-primary flex items-center justify-center font-black text-lg">
                    {t.name.charAt(0)}
                  </div>
                  <div>
                    <div className="font-bold text-white text-lg">{t.name}</div>
                    <div className="text-sm text-white/60 font-medium">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}