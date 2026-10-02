import pino from "pino";

const log = pino({ name: "hiring-mail" });

export type HiringEmailStage = "APPLIED" | "SHORTLISTED" | "INTERVIEW" | "HIRED" | "REJECTED" | "OFFER";

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Body paragraphs per stage. {name} / {role} are substituted (HTML-escaped) by hiringEmail().
// OFFER is the offer-letter email (sent with the PDF) — there's deliberately no stage-change email for it.
const TEMPLATES: Record<HiringEmailStage, { subject: string; paragraphs: string[] }> = {
  APPLIED: {
    subject: "We've received your application — {role}",
    paragraphs: [
      "Thank you for applying to DesGro Media for the role of {role}. We've received your application.",
      "Our team will review it and get in touch if your profile matches what we're looking for.",
    ],
  },
  SHORTLISTED: {
    subject: "You've been shortlisted — {role}",
    paragraphs: [
      "Thank you for applying to DesGro Media for the role of {role}.",
      "We're pleased to let you know that your application has been shortlisted for the next stage of our hiring process.",
      "Our team will contact you shortly with the next steps.",
    ],
  },
  INTERVIEW: {
    subject: "Interview invitation — {role}",
    paragraphs: [
      "Thank you for your interest in the {role} role at DesGro Media.",
      "We would like to invite you for an interview. Our HR team will contact you shortly to confirm the date, time and format.",
      "Please reply to this email if you have any questions in the meantime.",
    ],
  },
  HIRED: {
    subject: "Welcome to DesGro Media",
    paragraphs: [
      "Congratulations, and welcome to DesGro Media! We're delighted to have you join us as {role}.",
      "Our HR team will share your onboarding details, including your joining date and the documents we'll need from you, very soon.",
      "We look forward to working with you.",
    ],
  },
  REJECTED: {
    subject: "Update on your application — {role}",
    paragraphs: [
      "Thank you for applying to DesGro Media for the role of {role}.",
      "After reviewing your application, we regret to inform you that you have not been selected for this position.",
      "We appreciate your interest in our company and wish you success in your future endeavors.",
    ],
  },
  OFFER: {
    subject: "Offer letter — {role} at DesGro Media",
    paragraphs: [
      "We're pleased to offer you the position of {role} at DesGro Media. Please find your offer letter attached.",
      "Kindly review it and reply to this email to confirm your acceptance.",
    ],
  },
};

// Builds a candidate-facing email. Falls back to "Hi there" / "the position" when the name or role is
// missing — and logs a warning each time, so a data-entry gap in Hiring shows up in the server logs
// instead of silently producing a generic email. `candidateId` is only used in that log line.
export function hiringEmail(stage: HiringEmailStage, c: { name?: string | null; role?: string | null; candidateId?: string }): { subject: string; html: string } {
  const name = c.name?.trim() || "";
  const role = c.role?.trim() || "";
  if (!name || !role) log.warn({ stage, candidateId: c.candidateId, missing: [!name && "name", !role && "position"].filter(Boolean) }, "hiring email sent with missing candidate data — check the Hiring record");

  const roleText = role || "the position";
  const t = TEMPLATES[stage];
  const fill = (s: string, escape: boolean) => s.replace(/\{role\}/g, escape ? esc(roleText) : roleText);
  const p = (s: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1B1515;">${s}</p>`;

  const html = `<div style="background:#F6F4F3;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#FFFFFF;border-radius:8px;overflow:hidden;border:1px solid #E3DDDC;">
    <div style="padding:22px 32px;border-bottom:1px solid #E3DDDC;">
      <div style="width:28px;height:4px;background:#EB2027;margin-bottom:6px;"></div>
      <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#000000;line-height:1;">DESGRO</div>
      <div style="font-size:10px;letter-spacing:3px;color:#6B5F5D;margin-top:3px;">MEDIA</div>
    </div>
    <div style="padding:28px 32px 8px;">
      ${p(`Hi ${name ? esc(name) : "there"},`)}
      ${t.paragraphs.map((x) => p(fill(x, true))).join("\n      ")}
      <p style="margin:24px 0 4px;font-size:15px;line-height:1.6;color:#1B1515;">Best regards,</p>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#1B1515;font-weight:bold;">DesGro Media Hiring Team</p>
    </div>
    <div style="padding:14px 32px;border-top:1px solid #E3DDDC;background:#FAF8F7;font-size:12px;color:#9C908E;">Sent automatically by DesGro ERP.</div>
  </div>
</div>`;
  return { subject: fill(t.subject, false), html };
}
