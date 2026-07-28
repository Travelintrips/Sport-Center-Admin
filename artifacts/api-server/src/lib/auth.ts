import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  throw new Error("[auth] SESSION_SECRET environment variable is required but not set. Set it before starting the server.");
}
const TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000;

export function createToken(userId: number, role: string, tenantId?: number | null): string {
  const payload = { userId, role, tenantId: tenantId ?? null, exp: Date.now() + TOKEN_EXPIRY };
  const data = JSON.stringify(payload);
  const hmac = crypto.createHmac("sha256", SECRET).update(data).digest("hex");
  return Buffer.from(data).toString("base64") + "." + hmac;
}

export function verifyToken(token: string): { userId: number; role: string; tenantId: number | null } | null {
  try {
    const [dataB64, hmac] = token.split(".");
    if (!dataB64 || !hmac) return null;
    const data = Buffer.from(dataB64, "base64").toString("utf-8");
    const expectedHmac = crypto.createHmac("sha256", SECRET).update(data).digest("hex");
    if (hmac !== expectedHmac) return null;
    const payload = JSON.parse(data);
    if (payload.exp < Date.now()) return null;
    return { userId: payload.userId, role: payload.role, tenantId: payload.tenantId ?? null };
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  return crypto.createHmac("sha256", SECRET).update(password).digest("hex");
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const rawToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!rawToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const payload = verifyToken(rawToken);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  (req as any).user = payload;
  next();
}

/**
 * Like authMiddleware but also accepts ?_token= query param.
 * Scoped ONLY to document preview/pdf endpoints where window.open()
 * makes it impossible to set custom headers. Never use globally.
 */
export function authMiddlewareWithQueryToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query._token === "string" ? req.query._token : null;
  const rawToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : queryToken;
  if (!rawToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const payload = verifyToken(rawToken);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  (req as any).user = payload;
  next();
}

const ADMIN_ROLES = ["admin", "super_admin", "admin_booking", "finance", "staff"];

/**
 * Admin middleware that also accepts ?_token= query param.
 * Use ONLY for document preview/pdf endpoints (window.open() flows).
 */
export function adminDocumentPreviewMiddleware(req: Request, res: Response, next: NextFunction): void {
  authMiddlewareWithQueryToken(req, res, () => {
    const role = (req as any).user?.role;
    if (!ADMIN_ROLES.includes(role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  });
}

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

export function tenantMiddleware(req: Request, res: Response, next: NextFunction): void {
  authMiddleware(req, res, () => {
    const role = (req as any).user?.role;
    if (role !== "tenant") {
      res.status(403).json({ error: "Forbidden: Tenant access required" });
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
