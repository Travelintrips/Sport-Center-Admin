import nodemailer from "nodemailer";

export function getPasswordResetEmailConfig() {
  const from = process.env.SMTP_FROM?.trim();
  const user = process.env.SMTP_USER?.trim() || from;
  const pass = process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD;
  if (!from || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from) || !user || !pass) {
    throw new Error("Password reset SMTP configuration is incomplete");
  }
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT || "587");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Password reset SMTP port is invalid");
  return {
    from,
    options: {
      ...(host ? { host, port, secure: port === 465 || process.env.SMTP_SECURE === "true", requireTLS: port !== 465 && process.env.SMTP_SECURE !== "true" } : { service: "gmail" }),
      auth: { user, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    },
  };
}

export async function sendPasswordResetEmail(recipient: string, resetUrl: string): Promise<void> {
  const config = getPasswordResetEmailConfig();
  const transport = nodemailer.createTransport(config.options);
  try {
    const result = await transport.sendMail({
      from: config.from,
      to: recipient,
      subject: "Reset Kata Sandi Sport Center",
      text: [
        "Kami menerima permintaan untuk mengganti kata sandi akun Sport Center Anda.",
        "",
        "Buka tautan berikut untuk membuat kata sandi baru:",
        resetUrl,
        "",
        "Tautan berlaku selama 15 menit dan tidak dapat dipakai lagi setelah kata sandi diganti.",
        "Jangan bagikan tautan ini kepada siapa pun.",
        "Jika Anda tidak meminta reset, abaikan email ini. Kata sandi Anda tetap sama.",
      ].join("\n"),
    });
    if (!result.accepted?.length) throw new Error("Password reset email was rejected");
  } finally {
    transport.close();
  }
}
