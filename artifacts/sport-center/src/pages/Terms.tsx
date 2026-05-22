import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";

export default function Terms() {
  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-4">Terms of Service</h1>
        <p className="text-muted-foreground text-lg">Last updated: {new Date().toLocaleDateString()}</p>
      </div>

      <Card>
        <CardContent className="p-6 md:p-10 prose prose-slate dark:prose-invert max-w-none">
          <h2>1. Introduction</h2>
          <p>
            Welcome to SportCenter. These Terms of Service ("Terms") govern your use of our website, facility booking system, and related services. By accessing or using our services, you agree to be bound by these Terms.
          </p>

          <h2>2. Booking and Payments</h2>
          <p>
            All bookings are subject to availability. When you make a booking, you are required to complete payment within the specified timeframe (usually 1 hour) to confirm your reservation. If payment is not received and verified, the booking will be automatically cancelled.
          </p>
          <ul>
            <li>Prices are listed in Indonesian Rupiah (IDR) and include applicable taxes unless stated otherwise.</li>
            <li>Payment must be made via bank transfer or other approved methods.</li>
            <li>You must upload valid proof of payment through our portal for verification.</li>
          </ul>

          <h2>3. Cancellations and Refunds</h2>
          <p>
            We understand that plans can change. Our cancellation policy is as follows:
          </p>
          <ul>
            <li>Cancellations made more than 24 hours before the booked time are eligible for a full refund or reschedule.</li>
            <li>Cancellations made between 12-24 hours before the booked time are eligible for a 50% refund.</li>
            <li>Cancellations made less than 12 hours before the booked time are non-refundable.</li>
            <li>In the event of facility closure due to maintenance, weather, or unforeseen circumstances, we will provide a full refund or free reschedule.</li>
          </ul>

          <h2>4. Facility Rules</h2>
          <p>
            To ensure a safe and enjoyable experience for all patrons, please adhere to our facility rules:
          </p>
          <ul>
            <li>Wear appropriate sports attire and non-marking sports shoes.</li>
            <li>No smoking, alcohol, or illegal substances on the premises.</li>
            <li>Respect other players, staff, and the equipment.</li>
            <li>Any damage caused to the facility or equipment due to negligence or misconduct will be charged to the person who made the booking.</li>
            <li>Please vacate the court promptly at the end of your booked session.</li>
          </ul>

          <h2>5. Liability</h2>
          <p>
            SportCenter is not liable for any injuries, accidents, or loss of personal property that may occur on the premises. Users participate in sports activities at their own risk and are advised to ensure they are physically fit to engage in such activities.
          </p>

          <h2>6. Privacy</h2>
          <p>
            Your privacy is important to us. Please refer to our <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link> for information on how we collect, use, and protect your personal data.
          </p>

          <h2>7. Changes to Terms</h2>
          <p>
            We reserve the right to modify these Terms at any time. Changes will be effective immediately upon posting on our website. Continued use of our services constitutes acceptance of the modified Terms.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
