import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import facilitiesRouter from "./facilities";
import availabilityRouter from "./availability";
import bookingsRouter from "./bookings";
import paymentsRouter from "./payments";
import promosRouter from "./promos";
import schedulesRouter from "./schedules";
import customersRouter from "./customers";
import dashboardRouter from "./dashboard";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(facilitiesRouter);
router.use(availabilityRouter);
router.use(bookingsRouter);
router.use(paymentsRouter);
router.use(promosRouter);
router.use(schedulesRouter);
router.use(customersRouter);
router.use(dashboardRouter);
router.use(settingsRouter);

export default router;
