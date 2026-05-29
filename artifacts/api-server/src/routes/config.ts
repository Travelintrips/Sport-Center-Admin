import { Router } from "express";

const router = Router();

router.get("/config/public", (_req, res) => {
  res.json({});
});

export default router;
