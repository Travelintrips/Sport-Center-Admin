import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { 
  useGetFacility, 
  getGetFacilityQueryKey,
  useCreateBooking
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { MapPin, Calendar, Clock, Receipt, ChevronLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Booking() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  
  // Parse query params
  const [queryParams, setQueryParams] = useState<URLSearchParams | null>(null);
  
  useEffect(() => {
    // A bit hacky but works for wouter query params since it doesn't have a native hook
    const search = window.location.search;
    setQueryParams(new URLSearchParams(search));
  }, []);

  const facilityId = queryParams?.get("facilityId") ? parseInt(queryParams.get("facilityId")!) : 0;
  const date = queryParams?.get("date") || "";
  const startTime = queryParams?.get("startTime") || "";
  const durationStr = queryParams?.get("duration") || "1";
  const duration = parseInt(durationStr);

  const { data: facility, isLoading: isLoadingFacility } = useGetFacility(facilityId, {
    query: {
      enabled: !!facilityId,
      queryKey: getGetFacilityQueryKey(facilityId)
    }
  });

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const createBooking = useCreateBooking({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "Booking Created",
          description: "Please proceed to payment.",
        });
        setLocation(`/booking/${data.orderNumber}`);
      },
      onError: (error: any) => {
        toast({
          title: "Booking Failed",
          description: error?.message || "Failed to create booking",
          variant: "destructive",
        });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!facilityId || !date || !startTime || !duration) return;

    createBooking.mutate({
      data: {
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        facilityId,
        bookingDate: date,
        startTime,
        durationHours: duration,
        notes
      }
    });
  };

  // Redirect if missing params
  useEffect(() => {
    if (queryParams && (!facilityId || !date || !startTime)) {
      toast({
        title: "Missing booking details",
        description: "Please select a facility and time first.",
        variant: "destructive",
      });
      setLocation("/facilities");
    }
  }, [queryParams, facilityId, date, startTime, setLocation, toast]);

  if (isLoadingFacility || !queryParams) {
    return <div className="container py-20 flex justify-center"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  if (!facility) return null;

  const totalPrice = facility.pricePerHour * duration;

  // Calculate end time
  const [hours, minutes] = startTime.split(':').map(Number);
  const endHours = hours + duration;
  const endTime = `${endHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <Button variant="ghost" onClick={() => window.history.back()} className="mb-6 -ml-4">
        <ChevronLeft className="mr-2 h-4 w-4" /> Back to Schedule
      </Button>

      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-black tracking-tight">Checkout</h1>
        <p className="text-muted-foreground">Complete your booking details below.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column - Form */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Your Details</CardTitle>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name <span className="text-destructive">*</span></Label>
                  <Input 
                    id="name" 
                    required 
                    value={name} 
                    onChange={e => setName(e.target.value)} 
                    placeholder="John Doe"
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address <span className="text-destructive">*</span></Label>
                    <Input 
                      id="email" 
                      type="email" 
                      required 
                      value={email} 
                      onChange={e => setEmail(e.target.value)}
                      placeholder="john@example.com" 
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="phone">WhatsApp Number <span className="text-destructive">*</span></Label>
                    <Input 
                      id="phone" 
                      required 
                      value={phone} 
                      onChange={e => setPhone(e.target.value)}
                      placeholder="08123456789" 
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="notes">Additional Notes (Optional)</Label>
                  <Textarea 
                    id="notes" 
                    value={notes} 
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Any special requests..."
                  />
                </div>
              </CardContent>
              <CardFooter className="bg-muted/30 pt-6">
                <Button 
                  type="submit" 
                  size="lg" 
                  className="w-full text-base font-bold h-12"
                  disabled={createBooking.isPending}
                >
                  {createBooking.isPending ? "Processing..." : "Confirm Booking"}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>

        {/* Right Column - Summary */}
        <div>
          <Card className="sticky top-24 border-primary/20 shadow-md">
            <CardHeader className="bg-muted/30 pb-4 border-b">
              <CardTitle className="text-lg flex items-center gap-2">
                <Receipt className="text-primary w-5 h-5" />
                Booking Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              
              <div>
                <h4 className="font-bold text-lg mb-1">{facility.name}</h4>
                <div className="text-sm font-medium text-primary uppercase tracking-wider mb-3">{facility.category}</div>
                
                <div className="space-y-3 text-sm">
                  <div className="flex items-start gap-3">
                    <Calendar className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">Date</div>
                      <div className="text-muted-foreground">{date ? format(new Date(date), 'EEEE, MMMM d, yyyy') : ''}</div>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <Clock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">Time & Duration</div>
                      <div className="text-muted-foreground">
                        {startTime.substring(0,5)} - {endTime} ({duration} {duration === 1 ? 'hour' : 'hours'})
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">Location</div>
                      <div className="text-muted-foreground">SportCenter Main</div>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="border-t pt-4">
                <div className="flex justify-between items-center mb-2 text-sm">
                  <span className="text-muted-foreground">Rate</span>
                  <span>Rp {facility.pricePerHour.toLocaleString('id-ID')} / hr</span>
                </div>
                <div className="flex justify-between items-center mb-4 text-sm">
                  <span className="text-muted-foreground">Duration</span>
                  <span>x {duration}</span>
                </div>
                
                <div className="flex justify-between items-center font-bold text-lg pt-4 border-t">
                  <span>Total</span>
                  <span className="text-primary">Rp {totalPrice.toLocaleString('id-ID')}</span>
                </div>
              </div>
              
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
