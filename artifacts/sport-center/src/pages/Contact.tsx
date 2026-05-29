import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, Phone, Mail, Clock, MessageSquare } from "lucide-react";
import { useGetSettings } from "@workspace/api-client-react";
import { useLang } from "@/lib/i18n";

export default function Contact() {
  const { data: settings, isLoading } = useGetSettings();
  const { t } = useLang();

  const handleWhatsApp = () => {
    if (!settings?.whatsapp) return;
    
    // Clean up number
    let phone = settings.whatsapp;
    if (phone.startsWith('0')) {
      phone = '62' + phone.substring(1);
    }
    
    window.open(`https://wa.me/${phone}?text=Hello, I have a question about SportCenter`, '_blank');
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <div className="text-center mb-12">
        <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-4">{t("Hubungi Kami", "Contact Us")}</h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          {t("Punya pertanyaan tentang fasilitas kami, proses pemesanan, atau butuh bantuan dengan reservasi yang sudah ada? Kami siap membantu.", "Have a question about our facilities, booking process, or need help with an existing reservation? We're here to help.")}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-6">
          <Card className="border-border">
            <CardContent className="p-6">
              <h2 className="text-2xl font-bold mb-6">{t("Hubungi Kami", "Get in Touch")}</h2>
              
              {isLoading ? (
                <div className="space-y-4 animate-pulse">
                  {[1,2,3,4].map(i => (
                    <div key={i} className="flex gap-4">
                      <div className="w-10 h-10 bg-muted rounded-full" />
                      <div className="flex-1">
                        <div className="h-4 bg-muted w-1/4 mb-2 rounded" />
                        <div className="h-5 bg-muted w-3/4 rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <MapPin size={20} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-1">{t("Alamat", "Address")}</h3>
                      <p className="font-medium text-lg">{settings?.centerName}</p>
                      <p className="text-muted-foreground mt-1">{settings?.address}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Phone size={20} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-1">{t("Telepon", "Phone")}</h3>
                      <p className="font-medium text-lg">{settings?.phone || t('Tidak tersedia', 'Not available')}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Mail size={20} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-1">{t("Email", "Email")}</h3>
                      <p className="font-medium text-lg">{settings?.email || t('Tidak tersedia', 'Not available')}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Clock size={20} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-1">{t("Jam Operasional", "Operating Hours")}</h3>
                      <p className="font-medium text-lg">{t("Setiap hari", "Everyday")}: {settings?.openHour || '06:00'} - {settings?.closeHour || '23:00'}</p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          
          <Card className="bg-[#25D366]/10 border-[#25D366]/20">
            <CardContent className="p-6 text-center">
              <MessageSquare className="w-12 h-12 text-[#25D366] mx-auto mb-4" />
              <h3 className="text-xl font-bold mb-2">{t("Respons Tercepat", "Fastest Response")}</h3>
              <p className="text-muted-foreground mb-6">
                {t("Butuh bantuan segera? Hubungi tim layanan pelanggan kami langsung melalui WhatsApp.", "Need immediate assistance? Contact our customer service team directly via WhatsApp.")}
              </p>
              <Button 
                onClick={handleWhatsApp} 
                disabled={!settings?.whatsapp || isLoading}
                className="w-full bg-[#25D366] hover:bg-[#20bd5a] text-white"
                size="lg"
              >
                {t("Chat via WhatsApp", "Chat on WhatsApp")}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="rounded-xl overflow-hidden border border-border h-full min-h-[400px] relative">
          <iframe
            title="Lokasi Sport Center Bandara Soekarno-Hatta"
            src="https://www.google.com/maps?q=Jl.%20C3%20No.%20831%2C%20Pajang%2C%20Benda%2C%20Kota%20Tangerang%2C%20Banten%2015126&output=embed"
            className="w-full h-full min-h-[400px] border-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
          <a
            href="https://maps.app.goo.gl/iiXurNzUPFZpEA5s6"
            target="_blank"
            rel="noopener noreferrer"
            className="absolute bottom-4 left-4 right-4 bg-primary text-primary-foreground font-semibold text-sm py-3 rounded-xl shadow-lg flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors"
          >
            <MapPin size={16} /> {t("Buka di Google Maps", "Open in Google Maps")}
          </a>
        </div>
      </div>
    </div>
  );
}
