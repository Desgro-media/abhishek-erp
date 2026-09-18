import { RequestHandler } from "express";
import type { Role } from "@prisma/client";

// Route-level enforcement of the ACCESS MODEL — every Phase 2+ router
// composes `authenticate, requireRole(Role.HR)` etc. on top of this.
// ADMIN always passes, matching "Admin: full access to everything."
// This is the actual security boundary; hiding UI elements is not.
export function requireRole(...allowed: Role[]): RequestHandler {
  return (req, res, next) => {
    const roles = req.user?.roles ?? [];
    if (roles.includes("ADMIN") || roles.some((r) => allowed.includes(r))) {
      return next();
    }
    return res.status(403).json({ error: "Forbidden — your account doesn't have access to this module" });
  };
}
