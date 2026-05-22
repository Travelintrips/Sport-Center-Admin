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
import { 
  Clock, 
  Users, 
  MapPin, 
  ChevronLeft,
  CalendarDays
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import AvailabilityCalendar from "@/components/AvailabilityCalendar";

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
      <div className="container mx-auto px-4 py-8">
        <Skeleton className="h-8 w-32 mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="w-full aspect-[16/9] rounded-xl" />
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
          <div>
            <Skeleton className="w-full h-[500px] rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!facility) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl font-bold mb-4">Facility Not Found</h2>
        <Button asChild><Link href="/facilities">Back to Facilities</Link></Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <Button variant="ghost" asChild className="mb-6 -ml-4">
        <Link href="/facilities"><ChevronLeft className="mr-2 h-4 w-4" /> Back to Facilities</Link>
      </Button>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column - Details */}
        <div className="lg:col-span-2 space-y-8">
          {/* Main Image */}
          <div className="aspect-[16/9] bg-muted rounded-xl overflow-hidden relative border border-border">
            {facility.images && facility.images.length > 0 ? (
              <img 
                src={facility.images[0].url} 
                alt={facility.name} 
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground bg-secondary">
                No image available
              </div>
            )}
            <div className="absolute top-4 left-4 bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm font-bold uppercase tracking-wider shadow-md">
              {facility.category}
            </div>
          </div>
          
          {/* Thumbnail Gallery (if multiple) */}
          {facility.images && facility.images.length > 1 && (
            <div className="grid grid-cols-4 gap-4">
              {facility.images.slice(1, 5).map((img, idx) => (
                <div key={idx} className="aspect-[4/3] rounded-lg overflow-hidden border border-border bg-muted">
                  <img src={img.url} alt={`${facility.name} ${idx + 2}`} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}

          <div>
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-4">
              <div>
                <h1 className="text-3xl md:text-4xl font-black tracking-tight">{facility.name}</h1>
                <div className="flex items-center gap-4 text-muted-foreground mt-2">
                  <div className="flex items-center gap-1.5">
                    <MapPin size={16} /> SportCenter Main
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock size={16} /> {facility.openTime.substring(0,5)} - {facility.closeTime.substring(0,5)}
                  </div>
                  {facility.capacity && (
                    <div className="flex items-center gap-1.5">
                      <Users size={16} /> Up to {facility.capacity} pax
                    </div>
                  )}
                </div>
              </div>
              <div className="text-left md:text-right">
                <div className="text-3xl font-bold text-primary">
                  Rp {facility.pricePerHour.toLocaleString('id-ID')}
                </div>
                <div className="text-sm text-muted-foreground font-medium">per hour</div>
              </div>
            </div>
            
            <div className="h-px w-full bg-border my-6" />
            
            <h2 className="text-xl font-bold mb-3">About this facility</h2>
            <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
              {facility.description || "No description provided."}
            </p>
          </div>
        </div>

        {/* Right Column - Booking Widget */}
        <div>
          <Card className="sticky top-24 border-primary/20 shadow-lg">
            <CardContent className="p-6">
              <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                <CalendarDays className="text-primary" />
                Book Schedule
              </h3>
              
              <div className="space-y-6">
                <div>
                  <label className="text-sm font-semibold mb-2 block">Select Date</label>
                  <div className="border rounded-md p-2 flex justify-center bg-card">
                    <Calendar
                      mode="single"
                      selected={date}
                      onSelect={setDate}
                      disabled={(d) => d < new Date(new Date().setHours(0,0,0,0))}
                      className="rounded-md"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-semibold mb-2 block">Duration</label>
                  <Select value={duration} onValueChange={setDuration}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select duration" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 Hour</SelectItem>
                      <SelectItem value="2">2 Hours</SelectItem>
                      <SelectItem value="3">3 Hours</SelectItem>
                      <SelectItem value="4">4 Hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-semibold mb-2 block">
                    Available Time Slots
                  </label>
                  {!date ? (
                    <div className="text-sm text-center text-muted-foreground py-6 border border-dashed rounded-lg">
                      Please select a date first
                    </div>
                  ) : (
                    <AvailabilityCalendar
                      facilityId={facilityId}
                      date={formattedDate}
                      slots={slots}
                      isLoading={isLoadingSlots}
                      selectedTime={selectedTime}
                      duration={parseInt(duration)}
                      onSelectTime={setSelectedTime}
                    />
                  )}
                </div>

                <div className="pt-4 border-t">
                  <div className="flex justify-between items-center mb-4">
                    <span className="font-semibold">Total Price</span>
                    <span className="text-xl font-bold text-primary">
                      Rp {(facility.pricePerHour * parseInt(duration)).toLocaleString('id-ID')}
                    </span>
                  </div>
                  
                  <Button 
                    size="lg" 
                    className="w-full text-base font-bold h-14" 
                    onClick={handleBook}
                    disabled={!selectedTime || !date}
                  >
                    Proceed to Checkout
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
