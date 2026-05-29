import { useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { 
  useGetFacility, 
  getGetFacilityQueryKey,
  useCheckAvailability,
  getCheckAvailabilityQueryKey 
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { format } from "date-fns";
import { id } from "date-fns/locale";
import { 
  Clock, 
  Users, 
  MapPin, 
  ChevronLeft,
  CalendarDays,
  CheckCircle2,
  AlertCircle,
  Star
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import AvailabilityCalendar from "@/components/AvailabilityCalendar";
import { getFacilityImage } from "@/lib/utils";

export default function FacilityDetail() {
  const [, params] = useRoute("/facilities/:id");
  const [, setLocation] = useLocation();
  const facilityId = params?.id ? parseInt(params.id) : 0;
  
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [duration, setDuration] = useState<string>("1");
  
  const { data: facility, isLoading: isLoadingFacility } = useGetFacility(facilityId, {
    query: {
      enabled: !!facilityId,
      queryKey: getGetFacilityQueryKey(facilityId)
    }
  });

  const formattedDate = date ? format(date, "yyyy-MM-dd") : "";

  const { data: slots, isLoading: isLoadingSlots } = useCheckAvailability(
    { facilityId, date: formattedDate },
    {
      query: {
        enabled: !!facilityId && !!formattedDate,
        queryKey: getCheckAvailabilityQueryKey({ facilityId, date: formattedDate })
      }
    }
  );

  const handleBook = () => {
    if (!facility || !date || !selectedTime) return;
    
    // Create checkout url with params
    const searchParams = new URLSearchParams({
      facilityId: facility.id.toString(),
      date: formattedDate,
      startTime: selectedTime,
      duration: duration
    });
    
    setLocation(`/booking?${searchParams.toString()}`);
  };

  if (isLoadingFacility) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <Skeleton className="h-10 w-40 mb-8 rounded-lg" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
          <div className="lg:col-span-7 space-y-6">
            <Skeleton className="w-full aspect-[4/3] md:aspect-[16/9] rounded-3xl" />
            <Skeleton className="h-12 w-3/4 rounded-xl mt-8" />
            <Skeleton className="h-6 w-1/2 rounded-lg" />
            <div className="space-y-3 mt-8">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
          <div className="lg:col-span-5">
            <Skeleton className="w-full h-[600px] rounded-3xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!facility) {
    return (
      <div className="container mx-auto px-4 py-32 text-center max-w-md">
        <div className="w-24 h-24 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="w-10 h-10 text-muted-foreground opacity-50" />
        </div>
        <h2 className="text-3xl font-black mb-4">Fasilitas Tidak Ditemukan</h2>
        <p className="text-muted-foreground mb-8">Maaf, data fasilitas yang Anda cari tidak dapat ditemukan atau telah dihapus.</p>
        <Button size="lg" asChild className="rounded-full font-bold h-14 px-8 w-full"><Link href="/facilities">Kembali ke Daftar Fasilitas</Link></Button>
      </div>
    );
  }

  const totalPrice = facility.pricePerHour * parseInt(duration);

  return (
    <div className="bg-[#F8FAFC] dark:bg-slate-950 min-h-screen pb-24">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <Link href="/facilities" className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors mb-8 bg-white dark:bg-slate-900 px-4 py-2 rounded-full border shadow-sm">
          <ChevronLeft className="w-4 h-4" /> Kembali ke Daftar
        </Link>
        
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
          {/* Left Column - Details */}
          <div className="lg:col-span-7 xl:col-span-8">
            {/* Main Image */}
            <div className="aspect-[4/3] md:aspect-[16/9] bg-muted rounded-3xl overflow-hidden relative shadow-lg group">
              <img 
                src={getFacilityImage(facility.category, facility.images)} 
                alt={facility.name} 
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-80" />
              
              <div className="absolute top-6 left-6 bg-white/90 backdrop-blur-md text-primary px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-wider shadow-md">
                {facility.category}
              </div>
            </div>

            <div className="mt-10 bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-sm border border-border/50">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8">
                <div>
                  <h1 className="text-3xl md:text-4xl lg:text-5xl font-black tracking-tight text-secondary dark:text-white mb-4 leading-tight">{facility.name}</h1>
                  
                  <div className="flex flex-wrap items-center gap-4 text-sm font-semibold text-muted-foreground">
                    <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5 rounded-lg text-foreground/80">
                      <Clock className="w-4 h-4 text-primary" /> {facility.openTime.substring(0,5)} - {facility.closeTime.substring(0,5)} WIB
                    </div>
                    {facility.capacity && (
                      <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5 rounded-lg text-foreground/80">
                        <Users className="w-4 h-4 text-primary" /> Kapasitas {facility.capacity} pax
                      </div>
                    )}
                    <div className="flex items-center gap-1 text-yellow-500 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-1.5 rounded-lg">
                      <Star className="w-4 h-4 fill-yellow-500" />
                      <span className="font-bold">4.9/5</span>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="h-px w-full bg-border/50 my-8" />
              
              <div>
                <h2 className="text-xl font-black mb-4 text-secondary dark:text-white flex items-center gap-2">
                  <div className="w-1.5 h-6 bg-primary rounded-full"></div>
                  Tentang Lapangan Ini
                </h2>
                <div className="text-foreground/80 font-medium leading-relaxed prose dark:prose-invert max-w-none">
                  <p className="whitespace-pre-line">{facility.description || "Fasilitas premium berstandar internasional yang dirawat dengan sangat baik. Cocok untuk semua kalangan dari pemula hingga profesional."}</p>
                </div>
                
                <div className="mt-8 grid grid-cols-2 gap-4">
                  {[
                    "Lantai berstandar internasional",
                    "Penerangan LED maksimal",
                    "Sirkulasi udara baik",
                    "Loker & Shower room gratis"
                  ].map((feat, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm font-medium">
                      <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center text-green-600 shrink-0">
                        <CheckCircle2 className="w-4 h-4" />
                      </div>
                      {feat}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Booking Widget */}
          <div className="lg:col-span-5 xl:col-span-4">
            <Card className="sticky top-28 border-0 shadow-2xl shadow-primary/5 rounded-3xl overflow-hidden">
              <div className="bg-secondary dark:bg-slate-900 p-6 text-white text-center relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/20 rounded-full blur-[40px]" />
                <div className="relative z-10">
                  <div className="text-sm font-bold text-white/70 uppercase tracking-widest mb-1">Tarif Sewa</div>
                  <div className="text-3xl md:text-4xl font-black text-white mb-1">
                    <span className="text-xl mr-1 text-primary">Rp</span>
                    {facility.pricePerHour.toLocaleString('id-ID')}
                  </div>
                  <div className="text-sm font-medium text-white/70">per jam bermain</div>
                </div>
              </div>
              
              <CardContent className="p-6 md:p-8 bg-white dark:bg-slate-950">
                <h3 className="text-lg font-black mb-6 flex items-center gap-2 text-secondary dark:text-white">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <CalendarDays className="w-4 h-4" />
                  </div>
                  Atur Jadwal Bermain
                </h3>
                
                <div className="space-y-6">
                  <div className="space-y-3">
                    <label className="text-sm font-bold text-foreground/80 block">1. Pilih Tanggal</label>
                    <div className="border rounded-2xl p-3 flex justify-center bg-[#F8FAFC] dark:bg-slate-900 shadow-inner">
                      <Calendar
                        mode="single"
                        selected={date}
                        onSelect={setDate}
                        disabled={(d) => d < new Date(new Date().setHours(0,0,0,0))}
                        className="rounded-xl bg-transparent"
                        locale={id}
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm font-bold text-foreground/80 block">2. Durasi Bermain</label>
                    <Select value={duration} onValueChange={setDuration}>
                      <SelectTrigger className="h-14 rounded-xl bg-[#F8FAFC] dark:bg-slate-900 border-border font-bold">
                        <SelectValue placeholder="Pilih durasi" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        <SelectItem value="1" className="font-medium py-3">1 Jam</SelectItem>
                        <SelectItem value="2" className="font-medium py-3">2 Jam</SelectItem>
                        <SelectItem value="3" className="font-medium py-3">3 Jam</SelectItem>
                        <SelectItem value="4" className="font-medium py-3">4 Jam</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm font-bold text-foreground/80 block flex justify-between items-end">
                      <span>3. Jam Tersedia</span>
                      {selectedTime && <span className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-md">Terpilih: {selectedTime}</span>}
                    </label>
                    
                    {!date ? (
                      <div className="text-sm text-center font-medium text-muted-foreground py-10 border-2 border-dashed rounded-2xl bg-muted/30">
                        Pilih tanggal terlebih dahulu
                      </div>
                    ) : (
                      <div className="bg-[#F8FAFC] dark:bg-slate-900 rounded-2xl p-4 border shadow-inner max-h-[250px] overflow-y-auto">
                        <AvailabilityCalendar
                          facilityId={facilityId}
                          date={formattedDate}
                          slots={slots as any}
                          isLoading={isLoadingSlots}
                          selectedTime={selectedTime}
                          duration={parseInt(duration)}
                          onSelectTime={setSelectedTime}
                        />
                      </div>
                    )}
                  </div>

                  <div className="pt-6 mt-4 border-t border-dashed">
                    <div className="flex justify-between items-end mb-6 bg-primary/5 p-4 rounded-2xl border border-primary/10">
                      <span className="font-bold text-foreground/80">Total Tagihan</span>
                      <span className="text-2xl font-black text-primary">
                        Rp {totalPrice.toLocaleString('id-ID')}
                      </span>
                    </div>
                    
                    <Button 
                      size="lg" 
                      className="w-full text-base font-bold h-14 rounded-full shadow-lg shadow-primary/20 transition-all hover:-translate-y-1" 
                      onClick={handleBook}
                      disabled={!selectedTime || !date}
                    >
                      {selectedTime ? "Lanjut ke Pembayaran" : "Lengkapi Jadwal Dulu"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}