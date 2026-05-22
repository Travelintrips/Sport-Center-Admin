import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";

export default function Privacy() {
  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-4">Privacy Policy</h1>
        <p className="text-muted-foreground text-lg">Last updated: {new Date().toLocaleDateString()}</p>
      </div>

      <Card>
        <CardContent className="p-6 md:p-10 prose prose-slate dark:prose-invert max-w-none">
          <h2>1. Information We Collect</h2>
          <p>
            When you use SportCenter services, we collect information that helps us provide you with a seamless booking experience. This includes:
          </p>
          <ul>
            <li><strong>Personal Information:</strong> Name, email address, and phone number (including WhatsApp) provided during booking or registration.</li>
            <li><strong>Transaction Data:</strong> Booking history, facility preferences, payment status, and uploaded payment proofs.</li>
            <li><strong>Usage Data:</strong> Information about how you interact with our website, device information, and IP address.</li>
          </ul>

          <h2>2. How We Use Your Information</h2>
          <p>
            We use the collected information for the following purposes:
          </p>
          <ul>
            <li>To process and manage your facility bookings.</li>
            <li>To communicate with you regarding your bookings, including confirmations, reminders, and payment verification via email or WhatsApp.</li>
            <li>To respond to your inquiries and customer support requests.</li>
            <li>To send promotional offers or updates (if you have opted in).</li>
            <li>To improve our website, services, and facility operations.</li>
          </ul>

          <h2>3. Data Sharing and Disclosure</h2>
          <p>
            We do not sell or rent your personal information to third parties. We may share your information only in the following circumstances:
          </p>
          <ul>
            <li><strong>Service Providers:</strong> With trusted third-party vendors who assist us in operating our platform (e.g., hosting, SMS/WhatsApp gateways).</li>
            <li><strong>Legal Requirements:</strong> If required by law, regulation, or legal process.</li>
            <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets.</li>
          </ul>

          <h2>4. Data Security</h2>
          <p>
            We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. However, no method of transmission over the Internet is 100% secure, and we cannot guarantee absolute security.
          </p>

          <h2>5. Your Rights</h2>
          <p>
            Depending on your jurisdiction, you may have the right to access, correct, or delete your personal information. If you wish to exercise any of these rights, please contact us using the information provided on our <Link href="/contact" className="text-primary hover:underline">Contact page</Link>.
          </p>

          <h2>6. Third-Party Links</h2>
          <p>
            Our website may contain links to third-party websites. We are not responsible for the privacy practices or content of such external sites. We encourage you to read their privacy policies before providing any personal information.
          </p>

          <h2>7. Contact Us</h2>
          <p>
            If you have any questions or concerns about this Privacy Policy or our data practices, please reach out to us via our <Link href="/contact" className="text-primary hover:underline">Contact page</Link>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
