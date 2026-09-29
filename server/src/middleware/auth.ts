import { RequestHandler } from "express";
import { verifyAccessToken } from "../utils/tokens";
import { prisma } from "../db/prisma";

// Every protected route runs this first. It only trusts the short-lived
// access token in the Authorization header for identity — the refresh cookie
// is never read here, that's refreshHandler's job. Roles, though, are
// re-read from the database on every request so an HR edit to someone's
// module access (or deactivating them) takes effect immediately instead of
// after the token's TTL — no logout or cache clear needed.
export const authenticate: RequestHandler = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }
  const token = header.slice("Bearer ".length);
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return res.status(401).json({ error: "Invalid or expired access token" });
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { roles: true, active: true } });
    if (!user || !user.active) return res.status(401).json({ error: "Invalid or expired access token" });
    req.user = { ...payload, roles: user.roles };
    next();
  } catch (err) {
    next(err);
  }
};
