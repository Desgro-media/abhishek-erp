import { RequestHandler } from "express";

// CRM (clients/leads/quotes/tasks) is Sales/Admin only, Content Pipeline is
// Content/Admin only — a deliberate tightening versus the old prototype,
// which let any non-HR, non-Sales "Staff" employee view Marketing/Content
// (just with quotes/invoices hidden) with no real server-side boundary.
// See ACCESS MODEL in the project brief.
export function isCrmUser(roles: string[] | undefined): boolean {
  const r = roles ?? [];
  return r.includes("ADMIN") || r.includes("SALES") || r.includes("SALES_HEAD");
}
// The Sales Head oversees the whole sales team, so — like Admin — they see every
// lead/client/quote/task rather than just their own book. Plain Sales stay scoped
// to their own name.
export function seesWholeSalesTeam(roles: string[] | undefined): boolean {
  const r = roles ?? [];
  return r.includes("ADMIN") || r.includes("SALES_HEAD");
}
// A Clients-module login sees the whole client list (it's their job), not just a sales book.
export function seesAllClients(roles: string[] | undefined): boolean {
  return seesWholeSalesTeam(roles) || (roles ?? []).includes("CLIENTS");
}
export function isContentUser(roles: string[] | undefined): boolean {
  const r = roles ?? [];
  return r.includes("ADMIN") || r.includes("CONTENT");
}

export const requireCrmUser: RequestHandler = (req, res, next) => {
  if (isCrmUser(req.user?.roles)) return next();
  return res.status(403).json({ error: "Forbidden — Sales/Admin access required" });
};

export const requireContentUser: RequestHandler = (req, res, next) => {
  if (isContentUser(req.user?.roles)) return next();
  return res.status(403).json({ error: "Forbidden — Content/Admin access required" });
};

// The Clients module (client list + their delivery tasks) can be granted on its own,
// without the Leads/Quotes/Invoices side of CRM that Sales gets.
export function isClientsUser(roles: string[] | undefined): boolean {
  return isCrmUser(roles) || (roles ?? []).includes("CLIENTS");
}

export const requireClientsUser: RequestHandler = (req, res, next) => {
  if (isClientsUser(req.user?.roles)) return next();
  return res.status(403).json({ error: "Forbidden — Clients access required" });
};
