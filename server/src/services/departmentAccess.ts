import { prisma } from "../db/prisma";

// The ERP's department list (kept in step with DEPARTMENTS in public/js/app.js).
export const DEPARTMENTS = [
  "Marketing Consultation", "Web Development", "Production", "Graphic Design",
  "Performance Marketing", "Sales", "Administrative",
] as const;
// Departments a client actually subscribes to (they carry clients and revenue).
export const SERVICE_DEPARTMENTS: string[] = DEPARTMENTS.filter((d) => d !== "Administrative" && d !== "Sales");

const LEADERSHIP_TITLE = /\b(CEO|COO|CMO|CTO|CFO|Chief|Founder)\b/i;

type Caller = { roles?: string[]; name: string; employeeId: string | null };

// Leadership = the Admin role, or a founder/chief job title — the same rule the UI uses (isLeadershipRole).
export async function isLeadership(u: Caller): Promise<boolean> {
  if ((u.roles ?? []).includes("ADMIN")) return true;
  if (!u.employeeId) return false;
  const e = await prisma.employee.findUnique({ where: { id: u.employeeId }, select: { role: true } });
  return !!e && LEADERSHIP_TITLE.test(e.role);
}

// Departments this caller currently heads (normally zero or one).
export async function headedDepartments(u: Caller): Promise<string[]> {
  if (!u.employeeId) return [];
  const rows = await prisma.departmentHead.findMany({ where: { employeeId: u.employeeId }, select: { dept: true } });
  return rows.map((r) => r.dept);
}
