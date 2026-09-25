import { Router, type IRouter } from "express";
import path from "node:path";
import { resolvePaymentProofShortUrl } from "../lib/paymentProofShortLink";
import { downloadFromStorageUrl } from "../lib/supabaseStorage";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function filenameFor(contentType: string, sourceUrl: string): string {
  const extFromMime: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
  };
  const fromMime = extFromMime[contentType.toLowerCase()];
  if (fromMime) return `bukti-pembayaran${fromMime}`;
  const ext = path.extname(new URL(sourceUrl).pathname);
  return `bukti-pembayaran${ext || ""}`;
}

router.get("/proof/:code", async (req, res) => {
  try {
    const code = String(req.params.code ?? "");
    const proofUrl = await resolvePaymentProofShortUrl(code);
    if (!proofUrl) {
      res.status(404).send("Bukti pembayaran tidak ditemukan.");
      return;
    }

    const { buffer, contentType } = await downloadFromStorageUrl(proofUrl);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `inline; filename="${filenameFor(contentType, proofUrl)}"`);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).send(buffer);
  } catch (error) {
    logger.warn({ err: error, code: req.params.code }, "[proof-short-link] proof fetch failed");
    res.status(404).send("Bukti pembayaran tidak ditemukan.");
  }
});

export default router;
