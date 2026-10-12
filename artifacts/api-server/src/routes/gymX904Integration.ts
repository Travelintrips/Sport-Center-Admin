import { Router } from "express";
import { adminMiddleware } from "../lib/auth";
import { getX904ReceiverState } from "./x904AdmsGate";

/**
 * Operator-visible X904 integration state. Never infer device connectivity
 * from Wi-Fi, the SC checkin table, or a merged GitHub commit.
 * The physical door and enrolments remain exclusively under local X904 control.
 */
const router = Router();
router.get("/admin/gym-x904/integration", adminMiddleware, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const receiverState = getX904ReceiverState();
  res.json({
    device: "Solution X904",
    attendanceSource: "sport-center-manual",
    legacyGymService: "retired",
    receiver: receiverState.ready ? "diagnostic-ready" : "not-connected",
    hardware: "unverified",
    synchronizing: false,
    doorControl: "device-local",
    connectionTestedAt: null,
    lastDeviceEventAt: null,
    note: receiverState.ready ? "Receiver diagnostik aktif. Kontak yang tercatat belum membuktikan mesin fisik online; absensi X904 belum diimpor." : "Receiver diagnostik belum siap. Data check-in yang tampil berasal dari SC.",
  });
});
export default router;
