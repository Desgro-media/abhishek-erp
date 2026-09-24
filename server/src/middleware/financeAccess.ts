import { RequestHandler } from "express";

// Finance module: FINANCE/Admin get full access. Sales gets a narrow slice
// (submit a collected payment, request/view their own commission) without
// the rest of the module — same "self-service sliver" pattern HR uses for
// the base Employee role. See ACCESS MODEL in the project brief.
export function isFinanceAdmin(roles: string[] | undefined): boolean {
  const r = roles ?? [];
  return r.includes("ADMIN") || r.includes("FINANCE");
}

export const requireFinanceAdmin: RequestHandler = (req, res, next) => {
  if (isFinanceAdmin(req.user?.roles)) return next();
  return res.status(403).json({ error: "Forbidden — Finance/Admin access required" });
};

// Sales may only ever act on their own behalf (their own name as
// salesPerson, their own employeeId for a withdrawal) — Finance/Admin can
// act for/see anyone.
export const requireFinanceAdminOrSales: RequestHandler = (req, res, next) => {
  const roles = req.user?.roles ?? [];
  if (isFinanceAdmin(roles) || roles.includes("SALES") || roles.includes("SALES_HEAD")) return next();
  return res.status(403).json({ error: "Forbidden — Finance/Admin or Sales access required" });
};
