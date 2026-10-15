import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { isCrmUser, seesAllClients } from "../middleware/crmAccess";
import type { AccessTokenPayload } from "../utils/tokens";

// The one place that decides which client tasks / content cards a login can see. My Tasks, the Overview, the
// sidebar badge, the dashboard and the calendar all read through here, so they cannot disagree.
// Assignment is by user ID (assigneeUserId) — the assignedTo/assignee name column is display text only.

export function isAdmin(user: AccessTokenPayload) {
  return user.roles.includes("ADMIN");
}

export function clientTaskWhereForUser(user: AccessTokenPayload): Prisma.ClientTaskWhereInput {
  // Admin, Sales Head and Clients-module logins see every task (unchanged).
  if (seesAllClients(user.roles)) return {};
  return {
    OR: [
      // Anyone always sees what's assigned to them or what they created, whatever their role.
      { assigneeUserId: user.sub },
      { createdByUserId: user.sub },
      // A plain Sales login keeps seeing tasks on their own book of clients (unchanged).
      ...(isCrmUser(user.roles) ? [{ client: { salesPerson: user.name } }] : []),
    ],
  };
}

// Task cards carry the client's id + name only — never invoices, quotes or any finance data.
export function tasksForUser(user: AccessTokenPayload, extra: Prisma.ClientTaskWhereInput = {}) {
  return prisma.clientTask.findMany({
    where: { AND: [clientTaskWhereForUser(user), extra] },
    include: { attachments: true, client: { select: { id: true, name: true } } },
    orderBy: { dueAt: "asc" },
  });
}

export function contentItemsForUser(user: AccessTokenPayload) {
  return prisma.contentItem.findMany({ where: { assigneeUserId: user.sub }, orderBy: { dueAt: "asc" } });
}

// Resolves the assignee a caller named into { userId, name }. Prefers the stable ID; a bare name (older clients)
// only resolves when exactly one login has that exact name — otherwise the ID stays null, never a guess.
export async function resolveAssignee(input: { assigneeUserId?: string | null; name?: string | null }) {
  if (input.assigneeUserId) {
    const u = await prisma.user.findUnique({ where: { id: input.assigneeUserId }, select: { id: true, name: true, active: true } });
    if (!u || !u.active) return null;
    return { userId: u.id, name: u.name };
  }
  if (input.name) {
    const matches = await prisma.user.findMany({ where: { name: input.name, active: true }, select: { id: true, name: true } });
    return { userId: matches.length === 1 ? matches[0].id : null, name: input.name };
  }
  return { userId: null, name: null };
}

export async function notifyUser(userId: string | null | undefined, n: { kind: string; title: string; body?: string; link?: string }, exceptUserId?: string) {
  if (!userId || userId === exceptUserId) return;
  await prisma.notification.create({ data: { userId, ...n } });
}
