import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLang } from "@/lib/i18n";

export function isValidNewPassword(password: string): boolean {
  return password.length >= 8 && new TextEncoder().encode(password).length <= 72;
}

export function PasswordResetFields({ password, confirmation, onPasswordChange, onConfirmationChange, disabled = false }: {
  password: string;
  confirmation: string;
  onPasswordChange: (value: string) => void;
  onConfirmationChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const { t } = useLang();
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="reset-new-password">{t("Kata sandi baru", "New password")}</Label>
        <div className="relative">
          <Input id="reset-new-password" type={visible ? "text" : "password"} value={password}
            onChange={(event) => onPasswordChange(event.target.value)} required minLength={8}
            autoComplete="new-password" aria-describedby="reset-password-help" disabled={disabled} className="pr-11" />
          <button type="button" onClick={() => setVisible(!visible)} disabled={disabled}
            aria-label={visible ? t("Sembunyikan kata sandi", "Hide password") : t("Tampilkan kata sandi", "Show password")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <p id="reset-password-help" className="text-xs text-muted-foreground">
          {t("Minimal 8 karakter, maksimal 72 byte.", "At least 8 characters, up to 72 bytes.")}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="reset-confirm-password">{t("Ulangi kata sandi baru", "Confirm new password")}</Label>
        <Input id="reset-confirm-password" type="password" value={confirmation}
          onChange={(event) => onConfirmationChange(event.target.value)} required minLength={8}
          autoComplete="new-password" disabled={disabled} />
      </div>
    </>
  );
}
