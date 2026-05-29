import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { useLang } from "@/lib/i18n";

export default function NotFound() {
  const { t } = useLang();
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">{t("404 Halaman Tidak Ditemukan", "404 Page Not Found")}</h1>
          </div>

          <p className="mt-4 text-sm text-gray-600">
            {t("Apakah Anda lupa menambahkan halaman ke router?", "Did you forget to add the page to the router?")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
