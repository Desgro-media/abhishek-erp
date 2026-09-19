import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

interface AuditParams {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// Fire-and-forget-shaped but always awaited by callers — a failed audit
// write should surface (500) rather than silently let a money/salary
// action go unlogged. See CROSS-CUTTING SECURITY REQUIREMENTS.
// Pass a transaction client as `db` to make the audit row commit or roll back
// together with the money movement it describes.
export async function recordAudit(params: AuditParams, db: Pick<Prisma.TransactionClient, "auditLog"> = prisma): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: params.userId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      beforeData: params.beforeData === undefined ? undefined : (params.beforeData as object),
      afterData: params.afterData === undefined ? undefined : (params.afterData as object),
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    },
  });
}
