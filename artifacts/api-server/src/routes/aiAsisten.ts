import { Router } from "express";
import { adminMiddleware } from "../lib/auth";

const router = Router();
const CHAT_URL = "https://mcp.cstlogistic.co.id/api/ai/core-chat/messages";

router.post("/admin/ai-asisten/chat", adminMiddleware, async (req, res) => {
  const message = req.body?.message;
  if (typeof message !== "string" || !message.trim() || message.length > 2000) { res.status(400).json({ error: "Pesan tidak valid." }); return; }
  const secret = process.env.AI_CORE_CHAT_CONNECTOR_KEY?.trim();
  if (!secret) { res.status(503).json({ error: "Koneksi AI Core belum dikonfigurasi di backend." }); return; }
  try {
    const upstream = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ai-core-connector-key": secret },
      body: JSON.stringify({
        message: "Anda adalah AI Asisten admin Sport Center CST. Berikan jawaban informatif dalam bahasa Indonesia. Jangan menjalankan tindakan, mengubah data, mengarang angka pajak, atau mengklaim akses BizPortal/Coretax tanpa bukti. Pertanyaan: " + message.trim(),
        mode: "ask", modelPolicy: "smart", projectName: "Sport Center Admin - AI Asisten", source: "text"
      }),
      signal: AbortSignal.timeout(25000)
    });
    if (!upstream.ok) { res.status(502).json({ error: "AI Core tidak menerima permintaan. HTTP " + upstream.status }); return; }
    const body: unknown = await upstream.json();
    const result = body as Record<string, unknown> | null;
    const reply = result && typeof result.reply === "string" ? result.reply.trim() : "";
    if (!reply) { res.status(502).json({ error: "AI Core tidak mengembalikan jawaban yang valid." }); return; }
    res.json({ reply, source: "ai-core", mode: "ask" });
  } catch {
    res.status(503).json({ error: "AI Core sementara tidak dapat dihubungi." });
  }
});
export default router;
