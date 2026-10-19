import crypto from "node:crypto";
import { prisma } from "../db/prisma";
import { SERVICE_DEPARTMENTS } from "./departmentAccess";

// IST calendar date / month — the company's "today".
export const istDate = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const istMonth = () => istDate().slice(0, 7);
// A feedback link for a month stays open until 7 days after that month ends.
export function linkClosesOn(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0));
  end.setUTCDate(end.getUTCDate() + 7);
  return end.toISOString().slice(0, 10);
}
export const linkIsOpen = (month: string) => istDate() <= linkClosesOn(month);
export const newToken = () => crypto.randomBytes(9).toString("base64url");

// Web Development is a one-off project, not a monthly service: it is rated once, after the website is delivered, and the rating is
// tied to that project. Every other service is rated monthly.
export const PROJECT_FEEDBACK_SERVICES = ["Web Development"];
export const isProjectFeedback = (dept: string) => PROJECT_FEEDBACK_SERVICES.includes(dept);

// A project is delivered once every one of its tasks is Done; it was delivered on its last finish date.
export async function deliveredProjects(clientId: string, dept: string) {
  const tasks = await prisma.clientTask.findMany({ where: { clientId, service: dept, projectId: { not: null } }, select: { projectId: true, projectName: true, status: true, doneAt: true, dueAt: true } });
  const by = new Map<string, typeof tasks>();
  for (const t of tasks) by.set(t.projectId!, [...(by.get(t.projectId!) ?? []), t]);
  return [...by.entries()]
    .filter(([, ts]) => ts.every((t) => t.status === "DONE"))
    .map(([projectId, ts]) => ({ projectId, title: ts[0].projectName ?? "Project", deliveredOn: ts.map((t) => (t.doneAt ?? t.dueAt).toISOString().slice(0, 10)).sort().pop()! }))
    .sort((a, b) => b.deliveredOn.localeCompare(a.deliveredOn));
}
// What a project service's ask covers: the newest delivered project that isn't rated yet, else the latest delivered one (a re-rating).
export async function projectToRate(clientId: string, dept: string) {
  const delivered = await deliveredProjects(clientId, dept);
  if (!delivered.length) return null;
  const rated = new Set((await prisma.clientFeedback.findMany({ where: { projectId: { in: delivered.map((d) => d.projectId) } }, select: { projectId: true } })).map((f) => f.projectId));
  return delivered.find((d) => !rated.has(d.projectId)) ?? delivered[0];
}

export interface RatingInput { dept: string; rating: number; comment: string; projectId?: string | null }

// Save ratings for one client: rating a service again replaces the earlier rating for that month (or, for a project service, for
// that project).
export async function saveRatings(clientId: string, month: string, ratings: RatingInput[], via: string, by: string) {
  const date = new Date(istDate());
  await prisma.$transaction(async (tx) => {
    for (const r of ratings) {
      const projectId = r.projectId ?? null;
      const data = { rating: r.rating, comment: r.comment, via, by, date };
      const existing = await tx.clientFeedback.findFirst({ where: projectId ? { projectId } : { clientId, dept: r.dept, month, projectId: null }, select: { id: true } });
      if (existing) await tx.clientFeedback.update({ where: { id: existing.id }, data });
      else await tx.clientFeedback.create({ data: { clientId, dept: r.dept, month, projectId, ...data } });
    }
  });
}

// For a batch of ratings: a project service's rating is pinned to a delivered project (the one named, else the one to rate); a rating
// for a project service with nothing delivered is refused.
export async function pinProjects(clientId: string, ratings: RatingInput[]): Promise<{ ratings: RatingInput[] } | { error: string }> {
  const out: RatingInput[] = [];
  for (const r of ratings) {
    if (!isProjectFeedback(r.dept)) { out.push({ ...r, projectId: null }); continue; }
    const delivered = await deliveredProjects(clientId, r.dept);
    const p = r.projectId ? delivered.find((d) => d.projectId === r.projectId) : await projectToRate(clientId, r.dept);
    if (!p) return { error: `${r.dept} is rated once, after the project is delivered` };
    out.push({ ...r, projectId: p.projectId });
  }
  return { ratings: out };
}
export { SERVICE_DEPARTMENTS };
