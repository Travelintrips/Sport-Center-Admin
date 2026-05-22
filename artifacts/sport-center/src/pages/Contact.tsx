import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, Phone, Mail, Clock, MessageSquare } from "lucide-react";
import { useGetSettings } from "@workspace/api-client-react";

export default function Contact() {
  const { data: settings, isLoading } = useGetSettings();

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
        <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-4">Contact Us</h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Have a question about our facilities, booking process, or need help with an existing reservation? We're here to help.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-6">
          <Card className="border-border">
            <CardContent className="p-6">
              <h2 className="text-2xl font-bold mb-6">Get in Touch</h2>
              
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
                      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-1">Address</h3>
                      <p className="font-medium text-lg">{settings?.centerName}</p>
                      <p className="text-muted-foreground mt-1">{settings?.address}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Phone size={20} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-1">Phone</h3>
                      <p className="font-medium text-lg">{settings?.phone || 'Not available'}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Mail size={20} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-1">Email</h3>
                      <p className="font-medium text-lg">{settings?.email || 'Not available'}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Clock size={20} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-1">Operating Hours</h3>
                      <p className="font-medium text-lg">Everyday: {settings?.openHour || '06:00'} - {settings?.closeHour || '23:00'}</p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          
          <Card className="bg-[#25D366]/10 border-[#25D366]/20">
            <CardContent className="p-6 text-center">
              <MessageSquare className="w-12 h-12 text-[#25D366] mx-auto mb-4" />
              <h3 className="text-xl font-bold mb-2">Fastest Response</h3>
              <p className="text-muted-foreground mb-6">
                Need immediate assistance? Contact our customer service team directly via WhatsApp.
              </p>
              <Button 
                onClick={handleWhatsApp} 
                disabled={!settings?.whatsapp || isLoading}
                className="w-full bg-[#25D366] hover:bg-[#20bd5a] text-white"
                size="lg"
              >
                Chat on WhatsApp
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="bg-muted rounded-xl overflow-hidden border border-border h-full min-h-[400px] flex items-center justify-center relative">
          {/* Map placeholder */}
          <div className="absolute inset-0 bg-secondary/50 flex flex-col items-center justify-center text-muted-foreground p-6 text-center">
            <MapPin size={48} className="mb-4 opacity-50 text-primary" />
            <h3 className="text-xl font-bold mb-2">Interactive Map</h3>
            <p>Google Maps integration goes here</p>
          </div>
        </div>
      </div>
    </div>
  );
}
