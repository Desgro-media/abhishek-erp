// Loads sample CRM (clients/leads/quotes/tasks) and Content Pipeline
// (content items/meta ad campaigns) data matching the shapes in the old
// public/js/app.js prototype. Safe to re-run: no-ops if clients already
// exist. Depends on Finance's bank accounts already being seeded (for
// QUO-04's historical settled payment) — run after seedFinance().
import { PrismaClient, ClientStatus, LeadStatus, QuoteStatus, ClientTaskStatus, ContentStage, MetaAdsCampaignStatus } from "@prisma/client";
import { recordBankTxn } from "../src/services/finance/bankLedger";
import { createCommissionPayable } from "../src/services/finance/commission";

const prisma = new PrismaClient();

const CLIENTS = [
  { code: "CLI-01", name: "Al Noor Interiors", industry: "Interiors & Furnishing", city: "Dubai, UAE", services: ["Marketing Consultation", "Performance Marketing"], status: "ACTIVE", onboarded: "2025-02-10", accountManager: "Hafsa Rahman", salesPerson: "Vishnu Prakash" },
  { code: "CLI-02", name: "Habitos Care", industry: "Health & Wellness Clinic", city: "Kozhikode, India", services: ["Marketing Consultation", "Graphic Design"], status: "ACTIVE", onboarded: "2026-08-01", accountManager: "Thanseem", salesPerson: "Rahul Menon" },
  { code: "CLI-03", name: "Jafer Ali Associates (JAA)", industry: "Architecture", city: "Calicut, India", services: ["Graphic Design", "Marketing Consultation"], status: "ACTIVE", onboarded: "2025-11-20", accountManager: "Fathima Nazrin", salesPerson: "Vishnu Prakash" },
  { code: "CLI-04", name: "Ayat Wall Art", industry: "Home Decor / D2C", city: "Kerala, India", services: ["Web Development"], status: "ACTIVE", onboarded: "2026-07-15", accountManager: "Muhsin Ali", salesPerson: "Rahul Menon" },
  { code: "CLI-05", name: "Qatar Fresh Mart", industry: "Grocery / E-commerce", city: "Doha, Qatar", services: ["Performance Marketing"], status: "ACTIVE", onboarded: "2025-05-06", accountManager: "Aflah", salesPerson: "Vishnu Prakash" },
  { code: "CLI-06", name: "Emerging Buds School", industry: "Education", city: "Kerala, India", services: ["Marketing Consultation", "Web Development"], status: "ACTIVE", onboarded: "2026-03-18", accountManager: "Hafsa Rahman", salesPerson: "Rahul Menon" },
  { code: "CLI-07", name: "Corrivex School of Shipping", industry: "Maritime Education", city: "Kerala, India", services: ["Graphic Design"], status: "PAUSED", onboarded: "2026-04-22", accountManager: "Fathima Nazrin", salesPerson: "Vishnu Prakash" },
  { code: "CLI-08", name: "Bridista Bridal Attire", industry: "Bridal Fashion", city: "Kerala, India", services: ["Marketing Consultation", "Performance Marketing"], status: "ACTIVE", onboarded: "2026-06-05", accountManager: "Shirin Sharaf", salesPerson: "Rahul Menon" },
  { code: "CLI-09", name: "Green Leaf Wellness", industry: "Wellness Spa", city: "Sharjah, UAE", services: ["Marketing Consultation"], status: "CHURNED", onboarded: "2024-09-12", accountManager: "Shirin Sharaf", salesPerson: "Vishnu Prakash" },
  { code: "CLI-10", name: "Sultan Motors", industry: "Automotive Dealership", city: "Doha, Qatar", services: ["Production", "Marketing Consultation"], status: "ACTIVE", onboarded: "2026-01-29", accountManager: "Aflah", salesPerson: "Rahul Menon" },
] as const;

const LEADS = [
  { code: "MLD-01", name: "Farhan Interiors", phone: "9847112233", email: "farhan@farhaninteriors.com", source: "References", serviceInterested: "Marketing Consultation", leadOwner: "Rahul Menon" },
  { code: "MLD-02", name: "Coastal Spice Exports", phone: "9847223344", email: "info@coastalspice.com", source: "Meta", serviceInterested: "Performance Marketing", leadOwner: "Vishnu Prakash" },
  { code: "MLD-03", name: "Zenith Fitness Studio", phone: "9847334455", email: "zenith.fit@gmail.com", source: "Organic", serviceInterested: "Marketing Consultation", leadOwner: "Rahul Menon" },
  { code: "MLD-04", name: "Al Reef Dental Clinic", phone: "+974 3312 4455", email: "admin@alreefdental.qa", source: "References", serviceInterested: "Web Development", leadOwner: "Vishnu Prakash" },
  { code: "MLD-05", name: "Malabar Spices Co.", phone: "9847445566", email: "sales@malabarspices.in", source: "Organic", serviceInterested: "Graphic Design", leadOwner: "Rahul Menon" },
  { code: "MLD-06", name: "Urban Nest Realty", phone: "9847556677", email: "contact@urbannest.in", source: "Meta", serviceInterested: "Performance Marketing", leadOwner: "Vishnu Prakash" },
] as const;

const TASKS = [
  { code: "CLI-01", title: "September content calendar approval", assignedTo: "Shirin Sharaf", due: "2026-09-16", status: "IN_PROGRESS", revisions: 1 },
  { code: "CLI-01", title: "Reel batch 2 — shoot & edit", assignedTo: "Jithin Das", due: "2026-09-19", status: "TODO", revisions: 0 },
  { code: "CLI-02", title: "Logo refinement — round 2", assignedTo: "Risvan", due: "2026-09-16", status: "REVIEW", revisions: 2 },
  { code: "CLI-02", title: "Brand guideline document layout", assignedTo: "Fathima Nazrin", due: "2026-09-18", status: "IN_PROGRESS", revisions: 1 },
  { code: "CLI-03", title: "Typography & color system", assignedTo: "Fathima Nazrin", due: "2026-09-20", status: "IN_PROGRESS", revisions: 0 },
  { code: "CLI-04", title: "Product catalog page build", assignedTo: "Anjali Rose", due: "2026-09-13", status: "REVIEW", revisions: 1 },
  { code: "CLI-04", title: "Checkout & payment integration", assignedTo: "Muhsin Ali", due: "2026-09-12", status: "DONE", doneAt: "2026-09-12", revisions: 0 },
  { code: "CLI-05", title: "Weekend offer creative set", assignedTo: "Devika Menon", due: "2026-09-17", status: "IN_PROGRESS", revisions: 0 },
  { code: "CLI-08", title: "Bridal set launch reel — script", assignedTo: "Lahza Sufad", due: "2026-09-16", status: "TODO", revisions: 0 },
  { code: "CLI-10", title: "Shoot day logistics & shot list", assignedTo: "Nihal", due: "2026-09-16", status: "TODO", revisions: 0 },
] as const;

const CONTENT_ITEMS = [
  { title: "5 AI tools every content creator needs", type: "Reel", platforms: ["Instagram"], assignee: "", stage: "IDEA", due: "2026-09-19" },
  { title: "Agency positioning carousel — what makes DesGro different", type: "Post", platforms: ["Instagram", "Facebook"], assignee: "", stage: "IDEA", due: "2026-09-20" },
  { title: "SEO blog: choosing a content calendar cadence", type: "Blog Post", platforms: ["Blog"], assignee: "", stage: "IDEA", due: "2026-09-24" },
  { title: "Team culture reel — a day at DesGro Media", type: "Reel", platforms: ["Instagram"], assignee: "Lahza Sufad", stage: "SCRIPTING", due: "2026-09-17" },
  { title: "Client results carousel — logo branding case study", type: "Carousel", platforms: ["Instagram", "LinkedIn"], assignee: "Safa Ansari", stage: "SCRIPTING", due: "2026-09-16" },
  { title: "Demand School — course walkthrough video", type: "YouTube Video", platforms: ["YouTube"], assignee: "Jithin Das", stage: "PRODUCTION", due: "2026-09-15" },
  { title: "Behind the scenes — production shoot day", type: "Reel", platforms: ["Instagram"], assignee: "Jithin Das", stage: "PRODUCTION", due: "2026-09-14" },
  { title: "Client testimonial carousel — website development", type: "Carousel", platforms: ["Instagram", "LinkedIn"], assignee: "Risvan", stage: "REVIEW", due: "2026-09-13" },
  { title: "DesGro Media — team spotlight, Graphic Design", type: "Post", platforms: ["LinkedIn"], assignee: "Risvan", stage: "REVIEW", due: "2026-09-12" },
  { title: "Demand School — September enrollment push", type: "Carousel", platforms: ["Instagram"], assignee: "Ameena Farook", stage: "SCHEDULED", due: "2026-09-17" },
  { title: "DesGro Media — Onam greetings post", type: "Post", platforms: ["Instagram", "Facebook"], assignee: "Lahza Sufad", stage: "PUBLISHED", due: "2026-09-06" },
  { title: "Performance marketing results reel — Meta ads case study", type: "Reel", platforms: ["Instagram"], assignee: "Jithin Das", stage: "PUBLISHED", due: "2026-09-04" },
] as const;

const META_CAMPAIGNS = [
  { name: "Logo Branding — Lead Gen", objective: "Lead Generation", platform: "Instagram + Facebook", status: "ACTIVE", spend: 18500, impressions: 214000, clicks: 3120, leads: 42, startAt: "2026-09-01" },
  { name: "Website Development — Lead Gen", objective: "Lead Generation", platform: "Instagram + Facebook", status: "ACTIVE", spend: 22000, impressions: 265000, clicks: 3840, leads: 31, startAt: "2026-09-01" },
  { name: "Marketing Consultation — Lead Gen", objective: "Lead Generation", platform: "Facebook", status: "ACTIVE", spend: 15000, impressions: 158000, clicks: 2260, leads: 19, startAt: "2026-09-05" },
  { name: "Demand School — Course Enrollment", objective: "Conversions", platform: "Instagram", status: "ACTIVE", spend: 12000, impressions: 196000, clicks: 2940, leads: 58, startAt: "2026-08-20" },
  { name: "Logo Branding — Retargeting", objective: "Retargeting", platform: "Instagram", status: "PAUSED", spend: 4200, impressions: 41000, clicks: 610, leads: 6, startAt: "2026-08-10" },
] as const;

export async function seedCrm() {
  const already = await prisma.client.count();
  if (already > 0) {
    console.log("CRM seed skipped — clients already present.");
    return;
  }

  const clientIdByCode = new Map<string, string>();
  for (const c of CLIENTS) {
    const client = await prisma.client.create({
      data: { clientCode: c.code, name: c.name, industry: c.industry, city: c.city, services: [...c.services], status: c.status as ClientStatus, onboardedAt: new Date(c.onboarded), accountManager: c.accountManager, salesPerson: c.salesPerson },
    });
    clientIdByCode.set(c.code, client.id);
  }
  console.log(`Seeded ${CLIENTS.length} clients.`);

  const leadIdByCode = new Map<string, string>();
  for (const l of LEADS) {
    const lead = await prisma.lead.create({ data: { leadCode: l.code, name: l.name, phone: l.phone, email: l.email, source: l.source, serviceInterested: l.serviceInterested, leadOwner: l.leadOwner } });
    leadIdByCode.set(l.code, lead.id);
  }
  console.log(`Seeded ${LEADS.length} leads.`);

  // Quotes — QUO-01 Draft, QUO-02 Sent, QUO-03 Submitted (pending, unapproved),
  // QUO-04 already fully Invoiced historically (real invoice + payment +
  // ledger + commission created directly, same shape approveQuotePendingPayment
  // would produce), QUO-05 Submitted against a lead (still unconverted).
  await prisma.quote.create({
    data: { quoteCode: "QUO-01", clientId: clientIdByCode.get("CLI-06"), title: "October SMM Retainer — renewal", createdBy: "Vishnu Prakash", status: "DRAFT", items: { create: [{ dept: "Marketing Consultation", amount: 22000 }] } },
  });
  await prisma.quote.create({
    data: { quoteCode: "QUO-02", clientId: clientIdByCode.get("CLI-09"), title: "Reactivation Package — Q4", createdBy: "Rahul Menon", status: "SENT", sentAt: new Date("2026-09-11"), items: { create: [{ dept: "Marketing Consultation", amount: 30000 }] } },
  });
  const quo03 = await prisma.quote.create({
    data: { quoteCode: "QUO-03", clientId: clientIdByCode.get("CLI-07"), title: "Prospectus Redesign + Social Refresh", createdBy: "Vishnu Prakash", status: "SUBMITTED_TO_FINANCE", sentAt: new Date("2026-09-06"), items: { create: [{ dept: "Graphic Design", amount: 12000 }, { dept: "Marketing Consultation", amount: 6000 }] } },
  });
  await prisma.quotePendingPayment.create({ data: { quoteId: quo03.id, amount: 18000, paymentDate: new Date("2026-09-12"), note: "Client paid via UPI, ref UTR8827311" } });

  const quo05 = await prisma.quote.create({
    data: { quoteCode: "QUO-05", leadId: leadIdByCode.get("MLD-02"), title: "Meta Ads Launch Package", createdBy: "Vishnu Prakash", status: "SUBMITTED_TO_FINANCE", sentAt: new Date("2026-09-13"), items: { create: [{ dept: "Performance Marketing", amount: 35000 }] } },
  });
  await prisma.quotePendingPayment.create({ data: { quoteId: quo05.id, amount: 15000, paymentDate: new Date("2026-09-14"), note: "Advance paid via UPI — balance on delivery" } });

  const bankAccount = await prisma.bankAccount.findFirst({ orderBy: { name: "asc" } });
  if (bankAccount) {
    const invoice = await prisma.invoice.create({
      data: { invoiceNo: "DG-2026-1049", clientId: clientIdByCode.get("CLI-10")!, issuedAt: new Date("2026-08-25"), dueAt: new Date("2026-08-25"), items: { create: [{ dept: "Production", amount: 25000 }] } },
    });
    const quo04 = await prisma.quote.create({
      data: { quoteCode: "QUO-04", clientId: clientIdByCode.get("CLI-10"), title: "Showroom Launch Video — Add-on", createdBy: "Rahul Menon", status: "INVOICED", sentAt: new Date("2026-08-21"), invoiceId: invoice.id, items: { create: [{ dept: "Production", amount: 25000 }] } },
    });
    await prisma.$transaction(async (tx) => {
      const payment = await tx.invoicePayment.create({ data: { invoiceId: invoice.id, amount: 25000, paidDate: new Date("2026-08-25"), accountId: bankAccount.id, note: "Paid in full via bank transfer" } });
      await recordBankTxn(tx, { accountId: bankAccount.id, date: new Date("2026-08-25"), type: "CREDIT", amount: 25000, note: `Invoice from quote ${quo04.quoteCode}`, refType: "INVOICE_PAYMENT", refId: payment.id });
      await tx.quotePendingPayment.create({ data: { quoteId: quo04.id, amount: 25000, paymentDate: new Date("2026-08-25"), note: "Paid in full via bank transfer", approved: true, approvedAt: new Date("2026-08-25"), invoicePayment: payment.id } });
      await createCommissionPayable(tx, { salesPerson: "Rahul Menon", sourceLabel: quo04.quoteCode, paymentAmount: 25000, dueAt: new Date("2026-08-25") });
    });
    console.log("Seeded 5 quotes (including one fully invoiced historically, with ledger + commission).");
  } else {
    console.log("Seeded 4 quotes — skipped QUO-04 (no bank account found to settle it against; run seedFinance() first).");
  }

  for (const t of TASKS) {
    await prisma.clientTask.create({
      data: { clientId: clientIdByCode.get(t.code)!, title: t.title, assignedTo: t.assignedTo, dueAt: new Date(t.due), status: t.status as ClientTaskStatus, revisions: t.revisions, doneAt: "doneAt" in t ? new Date(t.doneAt as string) : undefined },
    });
  }
  console.log(`Seeded ${TASKS.length} client tasks.`);

  for (const c of CONTENT_ITEMS) {
    await prisma.contentItem.create({ data: { title: c.title, type: c.type, platforms: [...c.platforms], assignee: c.assignee || undefined, stage: c.stage as ContentStage, dueAt: new Date(c.due) } });
  }
  console.log(`Seeded ${CONTENT_ITEMS.length} content items.`);

  for (const c of META_CAMPAIGNS) {
    await prisma.metaAdsCampaign.create({ data: { name: c.name, objective: c.objective, platform: c.platform, status: c.status as MetaAdsCampaignStatus, spend: c.spend, impressions: c.impressions, clicks: c.clicks, leads: c.leads, startAt: new Date(c.startAt) } });
  }
  console.log(`Seeded ${META_CAMPAIGNS.length} Meta ad campaigns.`);
  void LeadStatus; void QuoteStatus;
}

if (require.main === module) {
  seedCrm()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
