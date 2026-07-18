/**
 * pdfGenerator.ts
 * Generate PDF dari HTML menggunakan puppeteer-core + @sparticuz/chromium-min,
 * lalu upload ke storage dan kembalikan URL publik.
 */

import { uploadFile } from "./storage";
import { logger } from "./logger";

const BUCKET = "invoice-pdfs";

// ─── generatePdfBuffer ────────────────────────────────────────────────────────

export async function generatePdfBuffer(html: string): Promise<Buffer> {
  // Dynamic import agar build tetap ringan jika module tidak tersedia
  let chromium: any;
  let puppeteer: any;
  try {
    chromium = await import("@sparticuz/chromium-min");
    puppeteer = await import("puppeteer-core");
  } catch (err) {
    throw new Error(
      `Dependensi PDF tidak tersedia: ${(err as Error).message}. Pastikan @sparticuz/chromium-min dan puppeteer-core sudah terinstall.`,
    );
  }

  // URL chromium remote — gunakan build resmi @sparticuz
  const executablePath = await chromium.default.executablePath(
    "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar",
  );

  const browser = await puppeteer.default.launch({
    args: chromium.default.args,
    defaultViewport: chromium.default.defaultViewport,
    executablePath,
    headless: chromium.default.headless,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30_000 });
    const pdfUint8 = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
    });
    return Buffer.from(pdfUint8);
  } finally {
    await browser.close();
  }
}

// ─── generateAndStorePdf ─────────────────────────────────────────────────────

/**
 * Buat PDF dari HTML, upload ke storage, dan kembalikan URL publik.
 * @param html    HTML invoice yang sudah dirender
 * @param filename Nama file tanpa ekstensi — akan ditambah .pdf
 */
export async function generateAndStorePdf(html: string, filename: string): Promise<string> {
  logger.info({ filename }, "[PDF] Mulai generate PDF");
  const buffer = await generatePdfBuffer(html);
  logger.info({ filename, sizeBytes: buffer.length }, "[PDF] PDF ter-generate, upload ke storage");

  const objectPath = `${filename}.pdf`;
  const url = await uploadFile(BUCKET, objectPath, buffer, "application/pdf");
  logger.info({ filename, url }, "[PDF] PDF tersimpan di storage");
  return url;
}
