import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const SECRET = process.env.SESSION_SECRET || "sport-center-secret-key-2024";
const TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000;

export function createToken(userId: number, role: string): string {
  const payload = { userId, role, exp: Date.now() + TOKEN_EXPIRY };
  const data = JSON.stringify(payload);
  const hmac = crypto.createHmac("sha256", SECRET).update(data).digest("hex");
  return Buffer.from(data).toString("base64") + "." + hmac;
}

export function verifyToken(token: string): { userId: number; role: string } | null {
  try {
    const [dataB64, hmac] = token.split(".");
    if (!dataB64 || !hmac) return null;
    const data = Buffer.from(dataB64, "base64").toString("utf-8");
    const expectedHmac = crypto.createHmac("sha256", SECRET).update(data).digest("hex");
    if (hmac !== expectedHmac) return null;
    const payload = JSON.parse(data);
    if (payload.exp < Date.now()) return null;
    return { userId: payload.userId, role: payload.role };
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  return crypto.createHmac("sha256", SECRET).update(password).digest("hex");
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  (req as any).user = payload;
  next();
}

const ADMIN_ROLES = ["admin", "super_admin", "admin_booking", "finance", "staff"];

export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  authMiddleware(req, res, () => {
    const role = (req as any).user?.role;
    if (!ADMIN_ROLES.includes(role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  });
}

export function superAdminMiddleware(req: Request, res: Response, next: NextFunction): void {
  authMiddleware(req, res, () => {
    const role = (req as any).user?.role;
    if (role !== "admin" && role !== "super_admin") {
      res.status(403).json({ error: "Forbidden: Super Admin only" });
      return;
    }
    next();
  });
}

export function financeMiddleware(req: Request, res: Response, next: NextFunction): void {
  authMiddleware(req, res, () => {
    const role = (req as any).user?.role;
    if (!["admin", "super_admin", "finance"].includes(role)) {
      res.status(403).json({ error: "Forbidden: Finance access required" });
      return;
    }
    next();
  });
}

export function bookingAdminMiddleware(req: Request, res: Response, next: NextFunction): void {
  authMiddleware(req, res, () => {
    const role = (req as any).user?.role;
    if (!["admin", "super_admin", "admin_booking"].includes(role)) {
      res.status(403).json({ error: "Forbidden: Booking Admin access required" });
      return;
    }
    next();
  });
}

export function roleMiddleware(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    authMiddleware(req, res, () => {
      const role = (req as any).user?.role;
      if (!roles.includes(role)) {
        res.status(403).json({ error: `Forbidden: requires one of [${roles.join(", ")}]` });
        return;
      }
      next();
    });
  };
}
