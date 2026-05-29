import { useState } from "react";
import { useListPromos, useRegisterPromo } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Calendar, Tag, Info, Gift, MapPin, ArrowRight, Zap } from "lucide-react";
import { format } from "date-fns";
import { id } from "date-fns/locale";
import { getFacilityImage } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

export default function Promos() {
  const { data: promos, isLoading } = useListPromos({ activeOnly: true });
  const { toast } = useToast();
  const { t } = useLang();
  
  const [selectedPromo, setSelectedPromo] = useState<number | null>(null);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  
  // Registration form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");

  const registerMutation = useRegisterPromo({
    mutation: {
      onSuccess: () => {
        toast({
          title: t("Pendaftaran Berhasil!", "Registration Successful!"),
          description: t("Tim kami akan segera menghubungi Anda melalui WhatsApp.", "Our team will contact you shortly via WhatsApp."),
        });
        setIsRegisterOpen(false);
        resetForm();
      },
      onError: (error: any) => {
        toast({
          title: t("Pendaftaran Gagal", "Registration Failed"),
          description: error?.message || t("Terjadi kesalahan. Silakan coba lagi.", "An error occurred. Please try again."),
          variant: "destructive",
        });
      }
    }
  });

  const resetForm = () => {
    setName("");
    setEmail("");
    setPhone("");
    setMessage("");
    setSelectedPromo(null);
  };

  const handleRegisterClick = (promoId: number) => {
    setSelectedPromo(promoId);
    setIsRegisterOpen(true);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPromo) return;

    registerMutation.mutate({
      data: {
        promoId: selectedPromo,
        name,
        email,
        phone,
        message
      }
    });
  };

  const activePromo = promos?.find(p => p.id === selectedPromo);

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-slate-950 pb-20">
      <div className="bg-primary/10 dark:bg-primary/5 pt-16 pb-24 rounded-b-[40px] md:rounded-b-[80px] mb-12 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/20 rounded-full blur-[80px] pointer-events-none" />
        
        <div className="container mx-auto px-4 md:px-8 relative z-10">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary font-bold text-sm mb-6 border border-primary/20 shadow-sm">
              <Gift size={16} /> {t("Penawaran Terbatas", "Limited Offer")}
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-secondary dark:text-white mb-6 leading-tight">
              {t("Promo &", "Promos &")} <span className="text-primary">{t("Acara Spesial", "Special Events")}</span>
            </h1>
            <p className="text-lg md:text-xl font-medium text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              {t("Berolahraga lebih hemat! Temukan penawaran menarik bulan ini atau daftar untuk turnamen dan event seru kami.", "Work out for less! Discover this month's great offers or sign up for our exciting tournaments and events.")}
            </p>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-8">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : promos && promos.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl mx-auto">
            {promos.map((promo) => (
              <div key={promo.id} className="bg-white dark:bg-slate-900 rounded-3xl overflow-hidden border border-border shadow-lg hover:shadow-xl transition-all duration-500 flex flex-col h-full group transform hover:-translate-y-1">
                {/* Visual Header */}
                <div className="aspect-[16/9] sm:aspect-[2/1] relative overflow-hidden bg-muted p-3 pb-0">
                  <div className="w-full h-full rounded-t-2xl rounded-b-lg overflow-hidden relative">
                    <img 
                      src={promo.imageUrl || getFacilityImage(promo.title)} 
                      alt={promo.title} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" 
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                    
                    <div className="absolute top-4 left-4 flex gap-2">
                      <span className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider shadow-lg flex items-center gap-1.5 ${
                        promo.type === 'promo' 
                          ? 'bg-orange-500 text-white' 
                          : 'bg-blue-600 text-white'
                      }`}>
                        {promo.type === 'promo' ? <Tag size={14} /> : <Zap size={14} />}
                        {promo.type === 'promo' ? t('Promo', 'Promo') : t('Event', 'Event')}
                      </span>
                    </div>

                    {promo.discountPercent && (
                      <div className="absolute bottom-0 right-4 translate-y-1/2 z-10">
                        <div className="w-20 h-20 bg-primary text-white rounded-full flex flex-col items-center justify-center font-black shadow-xl border-4 border-white dark:border-slate-900 transform rotate-12 group-hover:rotate-0 transition-transform">
                          <span className="text-2xl leading-none">{promo.discountPercent}%</span>
                          <span className="text-[10px] tracking-wider">{t("DISKON", "DISCOUNT")}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Content */}
                <div className="p-6 sm:p-8 flex-1 flex flex-col">
                  <h3 className="text-2xl font-black text-secondary dark:text-white mb-4 pr-16">{promo.title}</h3>
                  
                  <div className="space-y-3 mb-6">
                    {(promo.startDate || promo.endDate) && (
                      <div className="flex items-center gap-3 text-sm font-semibold text-muted-foreground bg-[#F8FAFC] dark:bg-slate-950 p-3 rounded-xl border border-border/50">
                        <Calendar size={18} className="text-primary shrink-0" />
                        <div>
                          {promo.startDate && format(new Date(promo.startDate), 'dd MMMM yyyy', { locale: id })}
                          {promo.startDate && promo.endDate && ' - '}
                          {promo.endDate && format(new Date(promo.endDate), 'dd MMMM yyyy', { locale: id })}
                        </div>
                      </div>
                    )}
                  </div>

                  <p className="text-muted-foreground font-medium whitespace-pre-line mb-8 flex-1 leading-relaxed">{promo.description}</p>
                  
                  <div className="mt-auto pt-6 border-t border-border flex justify-between items-center gap-4">
                    <Button 
                      className="w-full h-14 rounded-full font-bold text-base shadow-md shadow-primary/20 group-hover:bg-primary/90" 
                      onClick={() => handleRegisterClick(promo.id)}
                      variant={promo.type === 'event' ? 'default' : 'outline'}
                    >
                      {promo.type === 'event' ? (
                        <>{t("Daftar Event Ini", "Register for This Event")} <ArrowRight size={18} className="ml-2" /></>
                      ) : (
                        <>{t("Ambil Diskon", "Claim Discount")} <Tag size={18} className="ml-2" /></>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-24 bg-white dark:bg-slate-900 rounded-3xl max-w-2xl mx-auto border border-dashed shadow-sm">
            <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
              <Info className="w-8 h-8 text-muted-foreground opacity-50" />
            </div>
            <h3 className="text-2xl font-black text-secondary dark:text-white mb-2">{t("Belum Ada Promo", "No Promos Yet")}</h3>
            <p className="text-muted-foreground font-medium px-6">{t("Maaf, saat ini belum ada promo atau event yang aktif. Silakan kembali lagi nanti untuk penawaran menarik lainnya!", "Sorry, there are currently no active promos or events. Please check back later for other great offers!")}</p>
          </div>
        )}
      </div>

      {/* Registration Dialog */}
      <Dialog open={isRegisterOpen} onOpenChange={setIsRegisterOpen}>
        <DialogContent className="sm:max-w-[425px] p-0 border-0 rounded-3xl overflow-hidden">
          <div className="bg-primary/5 p-6 border-b border-primary/10">
            <DialogTitle className="text-2xl font-black text-secondary dark:text-white mb-2">
              {activePromo?.type === 'event' ? t('Pendaftaran Event', 'Event Registration') : t('Klaim Penawaran', 'Claim Offer')}
            </DialogTitle>
            <DialogDescription className="text-primary font-bold text-sm">
              {activePromo?.title}
            </DialogDescription>
          </div>
          
          <form onSubmit={onSubmit} className="p-6 space-y-5 bg-white dark:bg-slate-950">
            <div className="space-y-2">
              <Label htmlFor="name" className="font-bold">{t("Nama Lengkap", "Full Name")} <span className="text-destructive">*</span></Label>
              <Input id="name" required value={name} onChange={e => setName(e.target.value)} className="h-12 rounded-xl bg-[#F8FAFC] dark:bg-slate-900 border-border" placeholder={t("Ketik nama Anda", "Type your name")} />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email" className="font-bold">{t("Email Aktif", "Active Email")} <span className="text-destructive">*</span></Label>
              <Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} className="h-12 rounded-xl bg-[#F8FAFC] dark:bg-slate-900 border-border" placeholder="nama@email.com" />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="phone" className="font-bold">{t("No. WhatsApp", "WhatsApp Number")} <span className="text-destructive">*</span></Label>
              <Input id="phone" required placeholder="08xxxxxxxxxx" value={phone} onChange={e => setPhone(e.target.value)} className="h-12 rounded-xl bg-[#F8FAFC] dark:bg-slate-900 border-border" />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="message" className="font-bold">{t("Pesan (Opsional)", "Message (Optional)")}</Label>
              <Textarea 
                id="message" 
                placeholder={activePromo?.type === 'event' ? t('Contoh: Nama tim, pertanyaan...', 'Example: Team name, questions...') : t('Catatan tambahan', 'Additional notes')} 
                value={message} 
                onChange={e => setMessage(e.target.value)} 
                className="rounded-xl bg-[#F8FAFC] dark:bg-slate-900 border-border min-h-[100px]"
              />
            </div>
            
            <DialogFooter className="pt-4 gap-3 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setIsRegisterOpen(false)} className="rounded-full font-bold h-12">{t("Batal", "Cancel")}</Button>
              <Button type="submit" disabled={registerMutation.isPending} className="rounded-full font-bold h-12 shadow-md shadow-primary/20">
                {registerMutation.isPending ? t('Memproses...', 'Processing...') : t('Kirim Pendaftaran', 'Submit Registration')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}