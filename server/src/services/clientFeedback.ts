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

export interface RatingInput { dept: string; rating: number; comment: string }

// Save ratings for one client and month: rating a service again replaces the earlier rating for that month.
export async function saveRatings(clientId: string, month: string, ratings: RatingInput[], via: string, by: string) {
  const date = new Date(istDate());
  await prisma.$transaction(ratings.map((r) => prisma.clientFeedback.upsert({
    where: { clientId_dept_month: { clientId, dept: r.dept, month } },
    create: { clientId, dept: r.dept, month, rating: r.rating, comment: r.comment, via, by, date },
    update: { rating: r.rating, comment: r.comment, via, by, date },
  })));
}
export { SERVICE_DEPARTMENTS };
