import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import type { Role } from "@prisma/client";
import { env } from "../config/env";

export interface AccessTokenPayload {
  sub: string;
  email: string;
  name: string;
  roles: Role[];
  department: string | null;
  // Which Employee row (if any) this login is linked to — lets HR-module
  // routes resolve "my own record" for the base Employee role without an
  // extra DB round trip on every request. Null if HR hasn't linked one.
  employeeId: string | null;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: `${env.ACCESS_TOKEN_TTL_MIN}m`,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

// Refresh tokens are deliberately NOT JWTs: they're a random opaque string
// handed to the browser (httpOnly cookie) while only its SHA-256 hash is
// stored in refresh_tokens. That way a leaked DB row is useless on its own,
// and revoking a session is a single UPDATE instead of a blocklist.
export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(48).toString("hex");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
