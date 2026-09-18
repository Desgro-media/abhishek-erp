import { Response, RequestHandler } from "express";
import { z } from "zod";
import { login, logout, rotateRefreshToken, AuthError } from "../services/auth.service";
import { env } from "../config/env";
import { asyncHandler } from "../utils/asyncHandler";

const REFRESH_COOKIE = "refreshToken";
// Scoping the cookie to /api/auth means the browser only ever sends it on
// login/refresh/logout calls, not on every API request.
const REFRESH_COOKIE_PATH = "/api/auth";

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const loginHandler = asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  }
  try {
    const { accessToken, refreshToken, user } = await login(parsed.data.email, parsed.data.password, req);
    setRefreshCookie(res, refreshToken);
    res.json({ accessToken, user });
  } catch (err) {
    if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

export const refreshHandler = asyncHandler(async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (!presented) return res.status(401).json({ error: "No session" });
  try {
    const { accessToken, refreshToken, user } = await rotateRefreshToken(presented, req);
    setRefreshCookie(res, refreshToken);
    res.json({ accessToken, user });
  } catch (err) {
    clearRefreshCookie(res);
    if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

export const logoutHandler = asyncHandler(async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE];
  await logout(presented, req);
  clearRefreshCookie(res);
  res.json({ ok: true });
});

export const meHandler: RequestHandler = (req, res) => {
  res.json({ user: req.user });
};
