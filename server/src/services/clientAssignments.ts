import { prisma } from "../db/prisma";

/* Who handles a client in a service department.

   Set by hand: Performance Marketing uses Client.pmOwnerId (its scorecard was built on it); every other service department
   uses a ClientAssignment row. Not set (or the person set has left): the department member who has most of the client's
   tasks in that department — tasks on its service board, or ordinary tasks given to someone in the department — with the
   most recent task breaking a tie. That one is marked `auto` so the page can say "from tasks". Nobody either way = null. */

export const PM_DEPT = "Performance Marketing";
export type Handler = { id: string; name: string; auto: boolean };

export async function handlersFor(dept: string, clientIds: string[]): Promise<Map<string, Handler | null>> {
  const out = new Map<string, Handler | null>(clientIds.map((id) => [id, null]));
  if (!clientIds.length) return out;

  const live = (e: { employmentStatus: string } | null | undefined) => !!e && e.employmentStatus !== "LEFT";
  if (dept === PM_DEPT) {
    const rows = await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, pmOwner: { select: { id: true, name: true, employmentStatus: true } } } });
    rows.forEach((r) => { if (live(r.pmOwner)) out.set(r.id, { id: r.pmOwner!.id, name: r.pmOwner!.name, auto: false }); });
  } else {
    const rows = await prisma.clientAssignment.findMany({ where: { dept, clientId: { in: clientIds } }, select: { clientId: true, employee: { select: { id: true, name: true, employmentStatus: true } } } });
    rows.forEach((r) => { if (live(r.employee)) out.set(r.clientId, { id: r.employee.id, name: r.employee.name, auto: false }); });
  }

  const open = clientIds.filter((id) => !out.get(id));
  if (!open.length) return out;
  const members = await prisma.employee.findMany({ where: { dept, employmentStatus: { not: "LEFT" } }, select: { id: true, name: true } });
  const byName = new Map(members.map((m) => [m.name, m]));
  const tasks = await prisma.clientTask.findMany({
    where: { clientId: { in: open }, assignedTo: { in: members.map((m) => m.name) }, OR: [{ service: dept }, { service: null }] },
    select: { clientId: true, assignedTo: true, createdAt: true },
  });
  for (const id of open) {
    const tally = new Map<string, { n: number; last: number }>();
    tasks.filter((t) => t.clientId === id).forEach((t) => {
      const cur = tally.get(t.assignedTo!) ?? { n: 0, last: 0 };
      tally.set(t.assignedTo!, { n: cur.n + 1, last: Math.max(cur.last, t.createdAt.getTime()) });
    });
    const best = [...tally.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last)[0];
    const m = best && byName.get(best[0]);
    if (m) out.set(id, { id: m.id, name: m.name, auto: true });
  }
  return out;
}

/** Set (or clear, with null) who handles a client in a department. Returns the employee id it replaced. */
export async function setHandler(dept: string, clientId: string, employeeId: string | null, by: string): Promise<string | null> {
  if (dept === PM_DEPT) {
    const c = await prisma.client.findUnique({ where: { id: clientId }, select: { pmOwnerId: true } });
    await prisma.client.update({ where: { id: clientId }, data: { pmOwnerId: employeeId } });
    return c?.pmOwnerId ?? null;
  }
  const before = await prisma.clientAssignment.findUnique({ where: { clientId_dept: { clientId, dept } } });
  if (employeeId) await prisma.clientAssignment.upsert({ where: { clientId_dept: { clientId, dept } }, create: { clientId, dept, employeeId, updatedBy: by }, update: { employeeId, updatedBy: by } });
  else if (before) await prisma.clientAssignment.delete({ where: { id: before.id } });
  return before?.employeeId ?? null;
}

/* A department's share of invoices, per client: billed (issued that month), received (payments that month) and still
   outstanding — each invoice split across its department-tagged line items, as on the department page. */
export type Money = { billed: number; collected: number; outstanding: number };
export async function revenueByClient(dept: string, month: string, clientIds?: string[]): Promise<Map<string, Money>> {
  const invoices = await prisma.invoice.findMany({ where: { items: { some: { dept } }, ...(clientIds ? { clientId: { in: clientIds } } : {}) }, include: { items: true, payments: true } });
  const out = new Map<string, Money>();
  for (const inv of invoices) {
    const total = inv.items.reduce((s, it) => s + Number(it.amount), 0);
    if (total <= 0) continue;
    const share = inv.items.filter((it) => it.dept === dept).reduce((s, it) => s + Number(it.amount), 0);
    if (!share) continue;
    const frac = share / total;
    const m = out.get(inv.clientId) ?? { billed: 0, collected: 0, outstanding: 0 };
    if (inv.issuedAt.toISOString().slice(0, 7) === month) m.billed += share;
    inv.payments.filter((p) => p.paidDate.toISOString().slice(0, 7) === month).forEach((p) => { m.collected += Number(p.amount) * frac; });
    m.outstanding += Math.max(0, total - inv.payments.reduce((s, p) => s + Number(p.amount), 0)) * frac;
    out.set(inv.clientId, m);
  }
  out.forEach((m) => { m.billed = Math.round(m.billed); m.collected = Math.round(m.collected); m.outstanding = Math.round(m.outstanding); });
  return out;
}
export function sumMoney(list: Iterable<Money>): Money {
  const t = { billed: 0, collected: 0, outstanding: 0 };
  for (const m of list) { t.billed += m.billed; t.collected += m.collected; t.outstanding += m.outstanding; }
  return t;
}
