import type { Prisma } from "@prisma/client";

// DG/DDMMYY/serial — serial resets each day (IST), same scheme as the quote title (QT/DDMMYY/serial).
// Every invoice created anywhere (Finance, Sales, quote conversion, quote payment approval) takes its number
// here, inside the create transaction: one atomic INSERT … ON CONFLICT DO UPDATE bumps the day's counter, so
// concurrent creates always get different serials, and invoices.invoice_no stays UNIQUE as the backstop.
// A rolled-back create rolls the counter back with it, so there are no gaps.
export async function nextInvoiceNo(tx: Prisma.TransactionClient): Promise<string> {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const day = `${get("day")}${get("month")}${get("year")}`;
  const rows = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO invoice_daily_counters (day, last) VALUES (${day}, 1)
    ON CONFLICT (day) DO UPDATE SET last = invoice_daily_counters.last + 1
    RETURNING last`;
  return `DG/${day}/${String(rows[0].last).padStart(3, "0")}`;
}
