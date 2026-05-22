import { useState } from "react";
import { useListPromos, useRegisterPromo, getListPromosQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Calendar, Tag, Info } from "lucide-react";
import { format } from "date-fns";

export default function Promos() {
  const { data: promos, isLoading } = useListPromos({ activeOnly: true });
  const { toast } = useToast();
  
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
          title: "Registration successful",
          description: "We will contact you shortly with more details.",
        });
        setIsRegisterOpen(false);
        resetForm();
      },
      onError: (error: any) => {
        toast({
          title: "Registration failed",
          description: error?.message || "Something went wrong. Please try again.",
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
    <div className="container mx-auto px-4 py-8 md:py-12">
      <div className="mb-10 text-center max-w-2xl mx-auto">
        <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-4">Promos & Events</h1>
        <p className="text-muted-foreground text-lg">
          Join our upcoming tournaments, classes, or grab a special discount for your next booking.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : promos && promos.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {promos.map((promo) => (
            <Card key={promo.id} className="overflow-hidden flex flex-col border-border">
              {promo.imageUrl && (
                <div className="aspect-[2/1] relative overflow-hidden bg-muted">
                  <img src={promo.imageUrl} alt={promo.title} className="w-full h-full object-cover" />
                </div>
              )}
              
              <CardHeader>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${promo.type === 'promo' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                    {promo.type}
                  </span>
                  {promo.discountPercent && (
                    <span className="px-2 py-1 rounded text-xs font-bold bg-green-100 text-green-700 flex items-center gap-1">
                      <Tag size={12} />
                      {promo.discountPercent}% OFF
                    </span>
                  )}
                </div>
                <CardTitle className="text-2xl">{promo.title}</CardTitle>
                {(promo.startDate || promo.endDate) && (
                  <CardDescription className="flex items-center gap-2 mt-2 text-foreground font-medium">
                    <Calendar size={14} className="text-muted-foreground" />
                    {promo.startDate && format(new Date(promo.startDate), 'MMM d, yyyy')}
                    {promo.startDate && promo.endDate && ' - '}
                    {promo.endDate && format(new Date(promo.endDate), 'MMM d, yyyy')}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="flex-1">
                <p className="text-muted-foreground whitespace-pre-line">{promo.description}</p>
              </CardContent>
              <CardFooter className="pt-4 border-t bg-muted/10">
                <Button 
                  className="w-full" 
                  onClick={() => handleRegisterClick(promo.id)}
                  variant={promo.type === 'event' ? 'default' : 'secondary'}
                >
                  {promo.type === 'event' ? 'Register Now' : 'Claim Offer'}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 bg-muted/30 rounded-xl max-w-2xl mx-auto border border-dashed">
          <Info className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-xl font-bold mb-2">No active promos</h3>
          <p className="text-muted-foreground">Check back later for exciting events and special offers!</p>
        </div>
      )}

      {/* Registration Dialog */}
      <Dialog open={isRegisterOpen} onOpenChange={setIsRegisterOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {activePromo?.type === 'event' ? 'Register for Event' : 'Claim Offer'}
            </DialogTitle>
            <DialogDescription>
              {activePromo?.title}
            </DialogDescription>
          </DialogHeader>
          
          <form onSubmit={onSubmit} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name <span className="text-destructive">*</span></Label>
              <Input id="name" required value={name} onChange={e => setName(e.target.value)} />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email">Email <span className="text-destructive">*</span></Label>
              <Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number <span className="text-destructive">*</span></Label>
              <Input id="phone" required placeholder="08xxxxxxxxxx" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="message">Message (Optional)</Label>
              <Textarea 
                id="message" 
                placeholder={activePromo?.type === 'event' ? 'Any questions or team details?' : 'Additional notes'} 
                value={message} 
                onChange={e => setMessage(e.target.value)} 
              />
            </div>
            
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setIsRegisterOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={registerMutation.isPending}>
                {registerMutation.isPending ? 'Submitting...' : 'Submit'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
