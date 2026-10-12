import { Router } from "express";
import { adminMiddleware } from "../lib/auth";

/**
 * Operator-visible X904 integration state. Never infer device connectivity
 * from Wi-Fi, the SC checkin table, or a merged GitHub commit.
 * The physical door and enrolments remain exclusively under local X904 control.
 */
const router = Router();
router.get("/admin/gym-x904/integration", adminMiddleware, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    device: "Solution X904",
    attendanceSource: "sport-center-manual",
    legacyGymService: "retired",
    receiver: "not-connected",
    hardware: "unverified",
    synchronizing: false,
    doorControl: "device-local",
    connectionTestedAt: null,
    lastDeviceEventAt: null,
    note: "Log X904 belum dikirim ke Sport Center. Data check-in yang tampil berasal dari SC.",
  });
});
export default router;
