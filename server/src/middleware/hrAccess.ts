import { RequestHandler } from "express";

// HR module has a two-tier access model beyond the generic requireRole():
// HR/Admin can see and manage every employee; the base Employee role (or any
// role without HR/ADMIN) can only ever reach their own linked record. This
// is the server-side enforcement the brief calls for — never just hidden in
// the UI. See ACCESS MODEL in the project brief.
export function isHRAdmin(roles: string[] | undefined): boolean {
  const r = roles ?? [];
  return r.includes("ADMIN") || r.includes("HR");
}

export const requireHRAdmin: RequestHandler = (req, res, next) => {
  if (isHRAdmin(req.user?.roles)) return next();
  return res.status(403).json({ error: "Forbidden — HR/Admin access required" });
};

// For "my own record" endpoints: HR/Admin may pass any employeeId, everyone
// else is pinned to the employeeId already on their own JWT.
export function resolveScopedEmployeeId(req: { user?: { roles: string[]; employeeId: string | null } }, requestedEmployeeId?: string): string | null {
  if (isHRAdmin(req.user?.roles)) return requestedEmployeeId ?? req.user?.employeeId ?? null;
  return req.user?.employeeId ?? null;
}
