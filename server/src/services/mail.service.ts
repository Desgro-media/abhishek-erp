import nodemailer, { Transporter } from "nodemailer";
import pino from "pino";
import { env } from "../config/env";

const log = pino({ name: "mail" });

// "hr" sends leave/hiring mail, "company" sends finance mail.
export type Mailbox = "hr" | "company";

let transport: Transporter | null | undefined;

function getTransport(): Transporter | null {
  if (transport !== undefined) return transport;
  transport =
    env.SMTP_USER && env.SMTP_PASS
      ? nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_PORT === 465,
          auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
        })
      : null;
  return transport;
}

const fromAddress = (box: Mailbox) => (box === "hr" ? env.HR_MAIL_USER : env.COMPANY_MAIL_USER);

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

export interface MailOptions {
  to: string | string[];
  subject: string;
  html: string;
  cc?: string | string[];
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

// For callers that must tell the user whether it went out (e.g. an offer letter):
// rejects if SMTP isn't configured or the send fails.
export async function sendMailNow(box: Mailbox, opts: MailOptions): Promise<void> {
  const t = getTransport();
  if (!t) throw new Error("Email isn't configured on the server (SMTP_USER / SMTP_PASS missing)");
  await t.sendMail({ from: `"DesGro Media" <${fromAddress(box)}>`, ...opts });
}

// Fire-and-forget: a mail failure must never fail or slow the API request that
// triggered it, so this never throws and callers don't await it.
export function sendMail(box: Mailbox, opts: MailOptions): void {
  if (!getTransport()) {
    log.debug({ box, subject: opts.subject }, "mail skipped — SMTP not configured");
    return;
  }
  sendMailNow(box, opts).catch((err) => log.error({ err, box, subject: opts.subject }, "mail send failed"));
}

export const HR_MAIL = () => env.HR_MAIL_USER;
export const COMPANY_MAIL = () => env.COMPANY_MAIL_USER;
