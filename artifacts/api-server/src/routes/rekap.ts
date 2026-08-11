import { Router } from "express";
import { adminMiddleware } from "../lib/auth";
import { sendRekapPemakaianToAdmin, generateRekapPemakaian, formatRekapWhatsapp } from "../lib/rekapPemakaian";

const router = Router();

// POST /admin/rekap-pemakaian/send — manual trigger kirim rekap ke grup WA admin
// Full path: POST /api/admin/rekap-pemakaian/send
router.post("/admin/rekap-pemakaian/send", adminMiddleware, async (req, res) => {
  try {
    const wibNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const todayWIB = wibNow.toISOString().split("T")[0];
    const tanggal: string = (req.body as any)?.date ?? todayWIB;

    await sendRekapPemakaianToAdmin(tanggal);
    return res.json({ success: true, message: `Rekap pemakaian untuk ${tanggal} berhasil dikirim ke grup WA admin.` });
  } catch (err) {
    console.error("[rekap-pemakaian/send]", err);
    return res.status(500).json({ error: "Gagal mengirim rekap pemakaian" });
  }
});

// GET /admin/rekap-pemakaian/preview — preview isi rekap tanpa kirim WA
// Full path: GET /api/admin/rekap-pemakaian/preview
router.get("/admin/rekap-pemakaian/preview", adminMiddleware, async (req, res) => {
  try {
    const wibNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const todayWIB = wibNow.toISOString().split("T")[0];
    const tanggal: string = (req.query.date as string) ?? todayWIB;

    const data = await generateRekapPemakaian(tanggal);
    const text = formatRekapWhatsapp(data, tanggal);
    return res.json({ tanggal, text, data });
  } catch (err) {
    console.error("[rekap-pemakaian/preview]", err);
    return res.status(500).json({ error: "Gagal generate rekap pemakaian" });
  }
});

export default router;
