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
  Quote
} from "lucide-react";
import { useListFacilities, useGetSettings, useListPromos } from "@workspace/api-client-react";

export default function Home() {
  const { data: facilities } = useListFacilities({ activeOnly: true });
  const { data: settings } = useGetSettings();
  const { data: promos } = useListPromos({ activeOnly: true });
  
  // Get top 3 categories
  const categories = [...new Set(facilities?.map(f => f.category))].slice(0, 3);
  
  // Highlight facilities
  const highlightFacilities = facilities?.slice(0, 3) || [];

  return (
    <div className="flex flex-col min-h-screen">
      {/* Hero Section */}
      <section className="relative bg-background overflow-hidden pt-12 pb-24 md:pt-20 md:pb-32">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-background" />
          <div className="absolute top-1/2 left-0 -translate-y-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full blur-[100px] opacity-50" />
        </div>
        
        <div className="container relative z-10 px-4 md:px-8">
          <div className="max-w-3xl">
            <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-6">
              Olahraga Seru di <span className="text-primary">{settings?.centerName || 'Sport Center'}</span>
            </h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl leading-relaxed">
              Lapangan premium, peralatan profesional, dan lokasi strategis dekat bandara. Booking gampang, langsung main, badan bugar!
            </p>
            <div className="flex flex-wrap gap-4">
              <Button size="lg" className="text-base h-14 px-8" asChild>
                <Link href="/facilities">
                  Pesan Sekarang <ArrowRight className="ml-2" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="text-base h-14 px-8" asChild>
                <Link href="/promos">
                  Lihat Promo
                </Link>
              </Button>
            </div>
          </div>
          
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">
            <div className="flex flex-col gap-2">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-2">
                <Trophy size={24} />
              </div>
              <h3 className="font-bold text-lg">Kualitas Premium</h3>
              <p className="text-sm text-muted-foreground">Lapangan & peralatan berstandar internasional</p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-2">
                <Clock size={24} />
              </div>
              <h3 className="font-bold text-lg">Jam Fleksibel</h3>
              <p className="text-sm text-muted-foreground">Buka {settings?.openHour || '06:00'} - {settings?.closeHour || '23:00'} setiap hari</p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-2">
                <ShieldCheck size={24} />
              </div>
              <h3 className="font-bold text-lg">Booking Aman</h3>
              <p className="text-sm text-muted-foreground">Sistem reservasi online yang mudah</p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-2">
                <Target size={24} />
              </div>
              <h3 className="font-bold text-lg">Semua Level</h3>
              <p className="text-sm text-muted-foreground">Dari pemula hingga profesional</p>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="py-20 bg-muted/30">
        <div className="container px-4 md:px-8">
          <div className="flex justify-between items-end mb-10">
            <div>
              <h2 className="text-3xl font-bold tracking-tight mb-2">Our Facilities</h2>
              <p className="text-muted-foreground">Choose from a variety of premium sports courts.</p>
            </div>
            <Button variant="ghost" asChild className="hidden md:flex">
              <Link href="/facilities">See All <ArrowRight className="ml-2 w-4 h-4" /></Link>
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {highlightFacilities.map((facility) => (
              <Card key={facility.id} className="overflow-hidden group cursor-pointer border-border hover:border-primary/50 transition-colors">
                <Link href={`/facilities/${facility.id}`}>
                  <div className="aspect-[4/3] bg-muted relative overflow-hidden">
                    {facility.images && facility.images.length > 0 ? (
                      <img 
                        src={facility.images[0].url} 
                        alt={facility.name}
                        className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-500" 
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-secondary text-muted-foreground">
                        No image
                      </div>
                    )}
                    <div className="absolute top-4 right-4 bg-background/90 backdrop-blur text-foreground px-3 py-1 rounded-full text-sm font-medium">
                      Rp {facility.pricePerHour.toLocaleString('id-ID')}/hr
                    </div>
                  </div>
                  <CardContent className="p-5">
                    <div className="text-xs font-medium text-primary mb-1">{facility.category}</div>
                    <h3 className="font-bold text-lg group-hover:text-primary transition-colors">{facility.name}</h3>
                  </CardContent>
                </Link>
              </Card>
            ))}
          </div>
          <Button variant="outline" asChild className="w-full mt-6 md:hidden">
            <Link href="/facilities">See All Facilities</Link>
          </Button>
        </div>
      </section>

      {/* Promos */}
      {promos && promos.length > 0 && (
        <section className="py-20">
          <div className="container px-4 md:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold tracking-tight mb-2">Special Offers & Events</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">Don't miss out on our latest promotions and upcoming tournaments.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {promos.slice(0, 2).map((promo) => (
                <Card key={promo.id} className="overflow-hidden border-border flex flex-col md:flex-row">
                  <div className="w-full md:w-2/5 aspect-square md:aspect-auto bg-muted">
                    {promo.imageUrl ? (
                      <img src={promo.imageUrl} alt={promo.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-primary/10 text-primary p-6 text-center">
                        <Zap size={48} className="opacity-20" />
                      </div>
                    )}
                  </div>
                  <div className="w-full md:w-3/5 p-6 flex flex-col">
                    <div className="flex gap-2 mb-3">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${promo.type === 'promo' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                        {promo.type.toUpperCase()}
                      </span>
                      {promo.discountPercent && (
                        <span className="px-2 py-1 rounded text-xs font-bold bg-green-100 text-green-700">
                          {promo.discountPercent}% OFF
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold text-xl mb-2">{promo.title}</h3>
                    <p className="text-muted-foreground text-sm mb-6 line-clamp-3">{promo.description}</p>
                    <div className="mt-auto">
                      <Button asChild>
                        <Link href="/promos">Learn More</Link>
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Testimonials */}
      <section className="py-20 bg-muted/30">
        <div className="container px-4 md:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight mb-2">Apa Kata Mereka</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Ribuan pelanggan sudah merasakan serunya berolahraga bersama kami.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                quote: "Lapangan futsalnya empuk, bersih, dan nggak pernah bocor jadwal. Tiap minggu fix main di sini bareng tim!",
                name: "A. Pratama",
                role: "Komunitas Futsal Rutin",
                date: "Mar 2026",
              },
              {
                quote: "Corporate Sport Day kantor kami sukses besar. Panitianya sigap, fasilitas lengkap, peserta semua happy.",
                name: "R. Wijaya",
                role: "HR — Event Korporat",
                date: "Feb 2026",
              },
              {
                quote: "Transit 4 jam di Soetta, sempat nge-gym sebentar. Alatnya lengkap, shower bersih, badan langsung segar lagi.",
                name: "D. Santoso",
                role: "Traveler Transit",
                date: "Apr 2026",
              },
              {
                quote: "Lantai vinyl badmintonnya enak banget di lutut. Ibu-ibu PB kami betah main lama di sini, sejuk dan terang.",
                name: "S. Lestari",
                role: "Komunitas Badminton",
                date: "Jan 2026",
              },
              {
                quote: "Pertama kali coba tennis dan dipandu staf yang ramah. Raket disediain, jadi nggak minder. Pasti balik lagi!",
                name: "M. Iqbal",
                role: "Pemula Tennis",
                date: "Mei 2026",
              },
              {
                quote: "Booking lewat WhatsApp gampang banget, dibalas cepat. Tempatnya strategis dekat bandara, parkir luas.",
                name: "N. Anggraini",
                role: "Pelanggan Setia",
                date: "Apr 2026",
              },
            ].map((t, i) => (
              <Card key={i} className="border-border h-full">
                <CardContent className="p-6 flex flex-col h-full">
                  <Quote className="text-primary/30 mb-3" size={32} />
                  <div className="flex gap-0.5 mb-3">
                    {Array.from({ length: 5 }).map((_, s) => (
                      <Star key={s} size={16} className="fill-primary text-primary" />
                    ))}
                  </div>
                  <p className="text-foreground/90 leading-relaxed mb-6 flex-1">"{t.quote}"</p>
                  <div className="flex items-center gap-3 mt-auto">
                    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                      {t.name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-bold text-sm">{t.name}</div>
                      <div className="text-xs text-muted-foreground">{t.role} · {t.date}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Location / Contact */}
      <section className="py-20 bg-sidebar text-sidebar-foreground">
        <div className="container px-4 md:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold tracking-tight mb-6">Visit Us</h2>
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0">
                    <MapPin size={20} />
                  </div>
                  <div>
                    <h4 className="font-bold text-lg">Location</h4>
                    <p className="text-sidebar-foreground/80 leading-relaxed mt-1">
                      {settings?.address || 'Jakarta, Indonesia'}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0">
                    <Phone size={20} />
                  </div>
                  <div>
                    <h4 className="font-bold text-lg">Contact</h4>
                    <p className="text-sidebar-foreground/80 mt-1">{settings?.phone || '-'}</p>
                    <p className="text-sidebar-foreground/80">{settings?.email || '-'}</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0">
                    <Clock size={20} />
                  </div>
                  <div>
                    <h4 className="font-bold text-lg">Operating Hours</h4>
                    <p className="text-sidebar-foreground/80 mt-1">Everyday</p>
                    <p className="text-sidebar-foreground/80">{settings?.openHour || '06:00'} - {settings?.closeHour || '23:00'}</p>
                  </div>
                </div>
              </div>
              
              <div className="mt-8 pt-8 border-t border-sidebar-border">
                <p className="mb-4 text-sidebar-foreground/80">Have questions or want to book via WhatsApp?</p>
                <Button size="lg" className="bg-[#25D366] hover:bg-[#20bd5a] text-white" asChild>
                  <a href={`https://wa.me/62${settings?.whatsapp?.replace(/^0|^62|\+62/, '')}`} target="_blank" rel="noopener noreferrer">
                    Chat on WhatsApp
                  </a>
                </Button>
              </div>
            </div>
            
            <div className="aspect-[4/3] bg-muted rounded-xl overflow-hidden shadow-lg border border-border">
              <div className="w-full h-full bg-secondary flex items-center justify-center text-muted-foreground">
                <MapPin size={48} className="mb-4 opacity-50" />
                <span className="block mt-4 text-lg">Map View</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
