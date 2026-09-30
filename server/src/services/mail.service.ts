import nodemailer, { Transporter } from "nodemailer";
import pino from "pino";
import { env } from "../config/env";

const log = pino({ name: "mail" });

// "hr" sends leave/hiring mail, "company" sends finance mail.
export type Mailbox = "hr" | "company";

const transports: Partial<Record<Mailbox, Transporter>> = {};

function credentials(box: Mailbox) {
  return box === "hr"
    ? { user: env.HR_MAIL_USER, pass: env.HR_MAIL_PASS }
    : { user: env.COMPANY_MAIL_USER, pass: env.COMPANY_MAIL_PASS };
}

function transportFor(box: Mailbox): Transporter | null {
  const { user, pass } = credentials(box);
  if (!pass) return null;
  return (transports[box] ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user, pass },
  }));
}

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Simple "label: value" table so every notification looks the same.
export function detailsHtml(intro: string, rows: Record<string, string | number | null | undefined>): string {
  const body = Object.entries(rows)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${escapeHtml(k)}</td><td style="padding:4px 0"><b>${escapeHtml(String(v))}</b></td></tr>`)
    .join("");
  return `<div style="font-family:Arial,sans-serif;font-size:14px"><p>${escapeHtml(intro)}</p><table>${body}</table><p style="color:#999;font-size:12px">Sent automatically by DesGro ERP.</p></div>`;
}

// Fire-and-forget: a mail failure must never fail or slow the API request that
// triggered it, so this never throws and callers don't await it.
export function sendMail(box: Mailbox, opts: { to: string | string[]; subject: string; html: string; cc?: string | string[] }): void {
  const transport = transportFor(box);
  if (!transport) {
    log.debug({ box, subject: opts.subject }, "mail skipped — mailbox password not configured");
    return;
  }
  const { user } = credentials(box);
  transport
    .sendMail({ from: `"DesGro Media" <${user}>`, ...opts })
    .catch((err) => log.error({ err, box, subject: opts.subject }, "mail send failed"));
}

export const HR_MAIL = () => env.HR_MAIL_USER;
export const COMPANY_MAIL = () => env.COMPANY_MAIL_USER;
