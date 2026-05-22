import { useState } from "react";
import { useRoute } from "wouter";
import { 
  useGetBookingByOrder, 
  getGetBookingByOrderQueryKey,
  useGetSettings,
  useCreatePayment
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { 
  CheckCircle2, 
  Clock, 
  CreditCard, 
  Copy, 
  MessageCircle,
  FileImage,
  AlertCircle
} from "lucide-react";

export default function BookingDetail() {
  const [, params] = useRoute("/booking/:orderNumber");
  const orderNumber = params?.orderNumber || "";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: booking, isLoading } = useGetBookingByOrder(orderNumber, {
    query: {
      enabled: !!orderNumber,
      queryKey: getGetBookingByOrderQueryKey(orderNumber)
    }
  });

  const { data: settings } = useGetSettings();

  const [proofUrl, setProofUrl] = useState("");

  const submitPayment = useCreatePayment({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Payment proof uploaded",
          description: "We will verify your payment shortly.",
        });
        queryClient.invalidateQueries({ queryKey: getGetBookingByOrderQueryKey(orderNumber) });
        setProofUrl("");
      },
      onError: (error: any) => {
        toast({
          title: "Upload failed",
          description: error?.message || "Something went wrong",
          variant: "destructive"
        });
      }
    }
  });

  const handleUploadPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!booking || !proofUrl) return;
    
    submitPayment.mutate({
      data: {
        bookingId: booking.id,
        amount: booking.totalPrice,
        proofUrl
      }
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const getWhatsAppLink = () => {
    if (!settings?.whatsapp || !booking) return "#";
    
    let phone = settings.whatsapp;
    if (phone.startsWith('0')) {
      phone = '62' + phone.substring(1);
    }
    
    const message = `Hello SportCenter, I want to confirm my booking:
Order Number: *${booking.orderNumber}*
Name: ${booking.customerName}
Facility: ${booking.facilityName}
Date: ${booking.bookingDate}
Time: ${booking.startTime.substring(0,5)} - ${booking.endTime.substring(0,5)}

Please verify my payment.`;

    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  };

  if (isLoading) return <div className="container py-20 flex justify-center"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  if (!booking) return (
    <div className="container py-20 text-center">
      <h2 className="text-2xl font-bold mb-2">Booking Not Found</h2>
      <p className="text-muted-foreground">Order number {orderNumber} does not exist.</p>
    </div>
  );

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'pending_payment': return { color: 'bg-yellow-100 text-yellow-800 border-yellow-300', icon: Clock, label: 'Pending Payment' };
      case 'paid': return { color: 'bg-blue-100 text-blue-800 border-blue-300', icon: CheckCircle2, label: 'Payment Verifying' };
      case 'confirmed': return { color: 'bg-green-100 text-green-800 border-green-300', icon: CheckCircle2, label: 'Confirmed' };
      case 'completed': return { color: 'bg-slate-100 text-slate-800 border-slate-300', icon: CheckCircle2, label: 'Completed' };
      case 'cancelled': return { color: 'bg-red-100 text-red-800 border-red-300', icon: AlertCircle, label: 'Cancelled' };
      default: return { color: 'bg-gray-100 text-gray-800 border-gray-300', icon: Clock, label: status };
    }
  };

  const statusConfig = getStatusConfig(booking.status);
  const StatusIcon = statusConfig.icon;

  return (
    <div className="container mx-auto px-4 py-8 md:py-12 max-w-4xl">
      <div className="mb-8 text-center">
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border mb-6 ${statusConfig.color}`}>
          <StatusIcon size={20} />
          <span className="font-bold">{statusConfig.label}</span>
        </div>
        <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-2">Order {booking.orderNumber}</h1>
        <p className="text-muted-foreground text-lg">
          {booking.status === 'pending_payment' 
            ? 'Complete your payment to secure this booking.' 
            : 'Thank you for your booking!'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Booking Details */}
        <Card className="border-border">
          <CardHeader className="bg-muted/30 pb-4 border-b">
            <CardTitle>Booking Details</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="space-y-4">
              <div>
                <div className="text-sm text-muted-foreground mb-1">Customer</div>
                <div className="font-semibold">{booking.customerName}</div>
                <div className="text-sm text-muted-foreground">{booking.customerPhone} | {booking.customerEmail}</div>
              </div>
              
              <div className="h-px bg-border" />
              
              <div>
                <div className="text-sm text-muted-foreground mb-1">Facility</div>
                <div className="font-semibold text-lg">{booking.facilityName}</div>
                <div className="text-sm text-primary font-medium">{booking.facilityCategory}</div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Date</div>
                  <div className="font-semibold">{format(new Date(booking.bookingDate), 'MMM d, yyyy')}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Time</div>
                  <div className="font-semibold">{booking.startTime.substring(0,5)} - {booking.endTime.substring(0,5)}</div>
                </div>
              </div>
              
              <div className="h-px bg-border" />
              
              <div className="flex justify-between items-center text-xl font-black">
                <div>Total</div>
                <div className="text-primary">Rp {booking.totalPrice.toLocaleString('id-ID')}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Payment Section */}
        <div className="space-y-6">
          {booking.status === 'pending_payment' && (
            <>
              <Card className="border-primary/30 shadow-md">
                <CardHeader className="bg-primary/5 pb-4 border-b border-primary/10">
                  <CardTitle className="flex items-center gap-2 text-primary">
                    <CreditCard size={20} />
                    Payment Instructions
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <p className="text-sm text-muted-foreground mb-4">
                    Please transfer exactly <strong className="text-foreground text-base">Rp {booking.totalPrice.toLocaleString('id-ID')}</strong> to the following bank account:
                  </p>
                  
                  <div className="bg-muted rounded-lg p-4 mb-6 relative group">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{settings?.bankName || 'BCA'}</div>
                    <div className="text-2xl font-mono tracking-wider mb-1">{settings?.bankAccount || '1234567890'}</div>
                    <div className="text-sm font-medium">a.n {settings?.bankAccountName || 'SportCenter Official'}</div>
                    
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      className="absolute top-2 right-2 opacity-50 group-hover:opacity-100 transition-opacity"
                      onClick={() => copyToClipboard(settings?.bankAccount || '1234567890')}
                    >
                      <Copy size={16} />
                    </Button>
                  </div>

                  <form onSubmit={handleUploadPayment} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="proofUrl">Payment Proof Image URL</Label>
                      <Input 
                        id="proofUrl" 
                        required 
                        value={proofUrl} 
                        onChange={e => setProofUrl(e.target.value)} 
                        placeholder="https://example.com/receipt.jpg"
                      />
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <FileImage size={12} />
                        Upload your receipt to any image host and paste the URL here.
                      </p>
                    </div>
                    <Button type="submit" className="w-full" disabled={submitPayment.isPending}>
                      {submitPayment.isPending ? 'Submitting...' : 'I Have Paid'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </>
          )}

          {/* Contact Support */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Need Help?</CardTitle>
              <CardDescription>Contact our admin via WhatsApp for fast support</CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                asChild 
                variant="outline" 
                className="w-full border-[#25D366] text-[#25D366] hover:bg-[#25D366] hover:text-white"
              >
                <a href={getWhatsAppLink()} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="mr-2" size={18} /> Chat with Admin
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
