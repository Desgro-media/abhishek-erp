import type { Request } from "express";
import { prisma } from "../db/prisma";
import { verifyPassword } from "../utils/password";
import { signAccessToken, generateRefreshToken, hashToken } from "../utils/tokens";
import { env } from "../config/env";
import { recordAudit } from "./audit.service";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

const LOCK_MS = env.LOGIN_LOCK_MINUTES * 60 * 1000;
const REFRESH_TTL_MS = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

function publicUser(u: { id: string; name: string; email: string; roles: string[]; department: string | null; employeeId: string | null }) {
  return { id: u.id, name: u.name, email: u.email, roles: u.roles, department: u.department, employeeId: u.employeeId };
}

export async function login(email: string, password: string, req: Request) {
  const ip = req.ip;
  const ua = req.headers["user-agent"] ?? null;
  const normalizedEmail = email.toLowerCase().trim();

  // Case-insensitive: emails saved with capitals (e.g. typed "Name@x.com" when HR granted access) must still match.
  const user = await prisma.user.findFirst({ where: { email: { equals: normalizedEmail, mode: "insensitive" } } });

  // Same generic message whether the account doesn't exist or the password
  // is wrong — don't let login responses confirm which emails have accounts.
  if (!user || !user.active) {
    await recordAudit({
      userId: user?.id ?? null,
      action: "LOGIN_FAILURE",
      entityType: "User",
      entityId: user?.id ?? null,
      ipAddress: ip,
      userAgent: ua,
      afterData: { email: normalizedEmail, reason: user ? "inactive" : "no_such_user" },
    });
    throw new AuthError("Invalid email or password");
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordAudit({ userId: user.id, action: "LOGIN_BLOCKED_LOCKED", entityType: "User", entityId: user.id, ipAddress: ip, userAgent: ua });
    throw new AuthError("Account temporarily locked after repeated failed attempts — try again later", 423);
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const failedLoginCount = user.failedLoginCount + 1;
    const lockedUntil = failedLoginCount >= env.LOGIN_MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MS) : null;
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount, lockedUntil } });
    await recordAudit({
      userId: user.id,
      action: "LOGIN_FAILURE",
      entityType: "User",
      entityId: user.id,
      ipAddress: ip,
      userAgent: ua,
      afterData: { failedLoginCount, locked: !!lockedUntil },
    });
    throw new AuthError("Invalid email or password");
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });

  const accessToken = signAccessToken({ sub: user.id, email: user.email, name: user.name, roles: user.roles, department: user.department, employeeId: user.employeeId });
  const { token: refreshToken, tokenHash } = generateRefreshToken();
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + REFRESH_TTL_MS), createdByIp: ip },
  });

  await recordAudit({ userId: user.id, action: "LOGIN_SUCCESS", entityType: "User", entityId: user.id, ipAddress: ip, userAgent: ua });

  return { accessToken, refreshToken, user: publicUser(user) };
}

// Refresh tokens rotate on every use: the presented token is revoked and a
// new one issued in the same transaction. If a token is presented that's
// already revoked, that means either the rightful owner's browser raced
// this call (rare) or the token was stolen and someone else already used
// it — either way we can't tell which, so every session for that user is
// killed and they're forced to log in again.
export async function rotateRefreshToken(presentedToken: string, req: Request) {
  const ip = req.ip;
  const ua = req.headers["user-agent"] ?? null;
  const tokenHash = hashToken(presentedToken);

  const record = await prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });

  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    if (record?.userId) {
      await prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await recordAudit({ userId: record.userId, action: "REFRESH_REUSE_DETECTED", entityType: "User", entityId: record.userId, ipAddress: ip, userAgent: ua });
    }
    throw new AuthError("Session expired — please log in again", 401);
  }

  if (!record.user.active) {
    throw new AuthError("Account disabled", 403);
  }

  const { token: newRefreshToken, tokenHash: newHash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  await prisma.$transaction([
    prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date(), replacedBy: newHash } }),
    prisma.refreshToken.create({ data: { userId: record.userId, tokenHash: newHash, expiresAt, createdByIp: ip } }),
  ]);

  const accessToken = signAccessToken({
    sub: record.user.id,
    email: record.user.email,
    name: record.user.name,
    roles: record.user.roles,
    department: record.user.department,
    employeeId: record.user.employeeId,
  });

  await recordAudit({ userId: record.userId, action: "TOKEN_REFRESH", entityType: "User", entityId: record.userId, ipAddress: ip, userAgent: ua });

  return { accessToken, refreshToken: newRefreshToken, user: publicUser(record.user) };
}

export async function logout(presentedToken: string | undefined, req: Request): Promise<void> {
  if (!presentedToken) return;
  const tokenHash = hashToken(presentedToken);
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (record && !record.revokedAt) {
    await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
    await recordAudit({
      userId: record.userId,
      action: "LOGOUT",
      entityType: "User",
      entityId: record.userId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] ?? null,
    });
  }
}
