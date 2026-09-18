import { RequestHandler } from "express";
import { verifyAccessToken } from "../utils/tokens";

// Every protected route runs this first. It only trusts the short-lived
// access token in the Authorization header — the refresh cookie is never
// read here, that's refreshHandler's job.
export const authenticate: RequestHandler = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }
  const token = header.slice("Bearer ".length);
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired access token" });
  }
};
