import { RequestHandler } from "express";
import { prisma } from "../db/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { isCrmUser, seesWholeSalesTeam } from "../middleware/crmAccess";
import { isFinanceAdmin } from "../middleware/financeAccess";
import { isHRAdmin } from "../middleware/hrAccess";

const RESULTS_PER_TYPE = 5;

// Global top-bar search — one endpoint across every entity type the signed-in caller can already
// see elsewhere, each scoped by the exact same rule as that entity's own list endpoint (a plain
// Sales rep gets only their own clients/leads/quotes/invoices, same as Accounts/CRM already
// enforce; Staff/Content roles hold none of CRM/Finance/HR so every section below is skipped and
// they get an empty result set, not an error). Never a new access rule of its own — mirrors
// listClients/listLeads/listQuotes/listInvoices/listEmployees so results can never surface a
// record that page wouldn't.
export const globalSearch: RequestHandler = asyncHandler(async (req, res) => {
  const q = ((req.query.q as string) || "").trim();
  if (q.length < 2) return res.json({ query: q, results: [] });

  const roles = req.user?.roles;
  const name = req.user!.name;
  const insensitive = { contains: q, mode: "insensitive" as const };
  const results: { type: string; id: string; title: string; subtitle: string }[] = [];

  const jobs: Promise<void>[] = [];

  if (isCrmUser(roles)) {
    const admin = seesWholeSalesTeam(roles);
    jobs.push(
      prisma.client
        .findMany({
          where: { OR: [{ name: insensitive }, { clientCode: insensitive }, { city: insensitive }], ...(admin ? {} : { salesPerson: name }) },
          take: RESULTS_PER_TYPE,
          orderBy: { name: "asc" },
        })
        .then((rows) => {
          for (const c of rows) results.push({ type: "Client", id: c.id, title: c.name, subtitle: `${c.clientCode}${c.city ? " · " + c.city : ""}` });
        })
    );
    jobs.push(
      prisma.lead
        .findMany({
          where: { AND: [{ OR: [{ name: insensitive }, { leadCode: insensitive }, { phone: insensitive }, { email: insensitive }] }, admin ? {} : { OR: [{ leadOwner: name }, { leadOwner: null }] }] },
          take: RESULTS_PER_TYPE,
          orderBy: { createdAt: "desc" },
        })
        .then((rows) => {
          for (const l of rows) results.push({ type: "Lead", id: l.id, title: l.name, subtitle: `${l.leadCode} · ${l.serviceInterested}` });
        })
    );
    jobs.push(
      prisma.quote
        .findMany({
          where: { AND: [{ OR: [{ quoteCode: insensitive }, { title: insensitive }, { client: { name: insensitive } }, { lead: { name: insensitive } }] }, admin ? {} : { createdBy: name }] },
          include: { client: true, lead: true },
          take: RESULTS_PER_TYPE,
          orderBy: { createdAt: "desc" },
        })
        .then((rows) => {
          for (const qt of rows) results.push({ type: "Quote", id: qt.id, title: qt.quoteCode, subtitle: `${qt.client?.name ?? qt.lead?.name ?? "—"} · ${qt.title}` });
        })
    );
  }

  if (isFinanceAdmin(roles) || roles?.includes("SALES") || roles?.includes("SALES_HEAD")) {
    const admin = isFinanceAdmin(roles) || seesWholeSalesTeam(roles);
    jobs.push(
      prisma.invoice
        .findMany({
          where: { AND: [{ OR: [{ invoiceNo: insensitive }, { client: { name: insensitive } }] }, admin ? {} : { client: { salesPerson: name } }] },
          include: { client: true },
          take: RESULTS_PER_TYPE,
          orderBy: { issuedAt: "desc" },
        })
        .then((rows) => {
          for (const inv of rows) results.push({ type: "Invoice", id: inv.id, title: inv.invoiceNo, subtitle: inv.client.name });
        })
    );
  }

  if (isHRAdmin(roles)) {
    jobs.push(
      prisma.employee
        .findMany({
          where: { OR: [{ name: insensitive }, { employeeCode: insensitive }, { email: insensitive }] },
          take: RESULTS_PER_TYPE,
          orderBy: { name: "asc" },
        })
        .then((rows) => {
          for (const e of rows) results.push({ type: "Employee", id: e.employeeCode, title: e.name, subtitle: `${e.employeeCode} · ${e.dept}` });
        })
    );
  }

  await Promise.all(jobs);
  res.json({ query: q, results });
});
