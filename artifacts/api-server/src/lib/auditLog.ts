import { Request } from "express";
import { db, auditLogsTable } from "@workspace/db";

export interface AuditLogEntry {
  userId?: number | null;
  userName?: string | null;
  userRole?: string | null;
  action: string;
  entity?: string | null;
  entityId?: number | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      userId: entry.userId ?? null,
      userName: entry.userName ?? null,
      userRole: entry.userRole ?? null,
      action: entry.action,
      entity: entry.entity ?? null,
      entityId: entry.entityId ?? null,
      before: entry.before as any ?? null,
      after: entry.after as any ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    });
  } catch {
    // Non-critical — don't break the main flow
  }
}

export function getClientInfo(req: Request): { ipAddress: string; userAgent: string } {
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.ip ||
    "";
  const ua = req.headers["user-agent"] || "";
  return { ipAddress: ip, userAgent: ua };
}

export function getUserFromReq(req: Request): { userId?: number; userName?: string; userRole?: string } {
  const user = (req as any).user;
  if (!user) return {};
  return {
    userId: user.userId,
    userName: user.name || user.email,
    userRole: user.role,
  };
}
