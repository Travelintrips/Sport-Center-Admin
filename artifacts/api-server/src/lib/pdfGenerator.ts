/**
 * pdfGenerator.ts
 * Generate PDF dari URL server lokal menggunakan puppeteer-core + @sparticuz/chromium-min.
 * Puppeteer navigate ke URL yang sudah dirender server (bukan setContent),
 * sehingga font, gambar, dan CSS identik 100% dengan tampilan admin portal.
 */

import { uploadFile } from "./storage";
import { logger } from "./logger";

const BUCKET = "invoice-pdfs";

// ─── getBrowser — singleton lazy browser instance ─────────────────────────────

let _chromium: any = null;
let _puppeteer: any = null;

async function loadDeps() {
  if (!_chromium || !_puppeteer) {
    try {
      _chromium = await import("@sparticuz/chromium-min");
      _puppeteer = await import("puppeteer-core");
    } catch (err) {
      throw new Error(
        `Dependensi PDF tidak tersedia: ${(err as Error).message}. ` +
          `Pastikan @sparticuz/chromium-min dan puppeteer-core sudah terinstall.`,
      );
    }
  }
  return { chromium: _chromium, puppeteer: _puppeteer };
}

async function launchBrowser() {
  const { chromium, puppeteer } = await loadDeps();
  const executablePath = await chromium.default.executablePath(
    "https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.tar",
  );
  return puppeteer.default.launch({
    args: [
      ...chromium.default.args,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
    defaultViewport: { width: 1200, height: 900 },
    executablePath,
    headless: true,
  });
}

// ─── generatePdfBufferFromUrl ─────────────────────────────────────────────────

/**
 * Buka URL dengan puppeteer dan generate PDF buffer.
 * URL harus sudah siap di-render (server lokal).
 * @param url      URL lengkap yang diakses puppeteer
 * @param headers  Extra HTTP headers (misal internal auth token)
 */
export async function generatePdfBufferFromUrl(
  url: string,
  headers?: Record<string, string>,
): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();

    if (headers && Object.keys(headers).length > 0) {
      await page.setExtraHTTPHeaders(headers);
    }

    // Navigasi ke URL — browser engine fetch semua resource (fonts, images, CSS)
    await page.goto(url, {
      waitUntil: "networkidle0",
      timeout: 45_000,
    });

    // Tunggu font Inter dari Google Fonts benar-benar ter-render
    await page.evaluateHandle(() =>
      (document as any).fonts ? document.fonts.ready : Promise.resolve(),
    );

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
 * Generate PDF dari URL server lokal, upload ke storage, kembalikan URL publik.
 * @param url      URL invoice HTML yang akan di-render puppeteer
 * @param filename Nama file tanpa ekstensi — akan ditambah .pdf
 * @param headers  Extra HTTP headers untuk request ke URL tersebut
 */
export async function generateAndStorePdf(
  url: string,
  filename: string,
  headers?: Record<string, string>,
): Promise<string> {
  logger.info({ url, filename }, "[PDF] Mulai generate PDF dari URL");
  const buffer = await generatePdfBufferFromUrl(url, headers);
  logger.info({ filename, sizeBytes: buffer.length }, "[PDF] PDF ter-generate, upload ke storage");

  const objectPath = `${filename}.pdf`;
  const publicUrl = await uploadFile(BUCKET, objectPath, buffer, "application/pdf");
  logger.info({ filename, publicUrl }, "[PDF] PDF tersimpan di storage");
  return publicUrl;
}

// ─── generatePdfBufferFromHtml (fallback — jika URL approach tidak bisa dipakai) ──

export async function generatePdfBufferFromHtml(html: string): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 45_000 });
    await page.evaluateHandle(() =>
      (document as any).fonts ? document.fonts.ready : Promise.resolve(),
    );
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
