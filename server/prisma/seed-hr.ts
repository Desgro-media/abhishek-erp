// Loads the same sample HR data that used to live in public/js/app.js's
// in-memory arrays into real tables, so Phase 2 ships with a working demo
// instead of an empty database. Safe to re-run: no-ops if employees already
// exist. A handful of employees also get real ERP logins (replacing the old
// per-employee plaintext "password" field) so each role can be tried live.
import { PrismaClient, Role, EmploymentType, LeaveType, LeaveDuration, LeaveStatus, AdvanceStatus, CandidateStage } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const DEV_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "ChangeMe!2026";

const EMPLOYEES = [
  { code: "EMP-101", name: "Nisam", dept: "Administrative", role: "CEO & Co-Founder", joined: "2019-04-01", email: "nisam@desgromedia.com", phone: "+91 94950 10101", salary: 65000, empType: "PERMANENT" },
  { code: "EMP-102", name: "Thanseem", dept: "Administrative", role: "COO & Co-Founder", joined: "2019-04-01", email: "thanseemca@gmail.com", phone: "+91 94950 10102", salary: 65000, empType: "PERMANENT", grantAccess: [Role.ADMIN] },
  { code: "EMP-103", name: "Aflah", dept: "Performance Marketing", role: "Chief Marketing Officer", joined: "2021-02-10", email: "aflah@desgromedia.com", phone: "+91 94950 10103", salary: 48000, empType: "PERMANENT" },
  { code: "EMP-104", name: "Shirin Sharaf", dept: "Marketing Consultation", role: "SMM Head", joined: "2021-06-14", email: "shirin@desgromedia.com", phone: "+91 94950 10104", salary: 38000, empType: "PERMANENT" },
  { code: "EMP-105", name: "Nihal", dept: "Production", role: "Multimedia / QC Lead", joined: "2021-09-02", email: "nihal@desgromedia.com", phone: "+91 94950 10105", salary: 34000, empType: "PERMANENT" },
  { code: "EMP-106", name: "Fardeen PP", dept: "Performance Marketing", role: "Performance Marketing Executive", joined: "2023-01-16", email: "fardeen@desgromedia.com", phone: "+91 94950 10106", salary: 26000, empType: "PERMANENT" },
  { code: "EMP-107", name: "Devika Menon", dept: "Performance Marketing", role: "Performance Marketing Executive", joined: "2024-03-11", email: "devika@desgromedia.com", phone: "+91 94950 10107", salary: 24000, empType: "PERMANENT", grantAccess: [Role.EMPLOYEE] },
  { code: "EMP-108", name: "Lahza Sufad", dept: "Marketing Consultation", role: "Content Creator", joined: "2023-07-01", email: "lahza@desgromedia.com", phone: "+91 94950 10108", salary: 24000, empType: "PERMANENT" },
  { code: "EMP-109", name: "Rishab K", dept: "Marketing Consultation", role: "SMM Executive", joined: "2024-08-19", email: "rishab@desgromedia.com", phone: "+91 94950 10109", salary: 21000, empType: "PERMANENT" },
  { code: "EMP-110", name: "Safa Ansari", dept: "Marketing Consultation", role: "Content Lead", joined: "2022-11-07", email: "safa@desgromedia.com", phone: "+91 94950 10110", salary: 28000, empType: "PERMANENT" },
  { code: "EMP-111", name: "Ameena Farook", dept: "Marketing Consultation", role: "Content Writer", joined: "2024-02-05", email: "ameena@desgromedia.com", phone: "+91 94950 10111", salary: 20000, empType: "PERMANENT" },
  { code: "EMP-112", name: "Jithin Das", dept: "Production", role: "Video Editor", joined: "2023-05-22", email: "jithin@desgromedia.com", phone: "+91 94950 10112", salary: 25000, empType: "PERMANENT" },
  { code: "EMP-113", name: "Risvan", dept: "Graphic Design", role: "Graphic Designer", joined: "2022-06-01", email: "risvan@desgromedia.com", phone: "+91 94950 10113", salary: 26000, empType: "PERMANENT" },
  { code: "EMP-114", name: "Afeefa P", dept: "Graphic Design", role: "Graphic Designer", joined: "2026-06-15", email: "afeefa@desgromedia.com", phone: "+91 94950 10114", salary: 19000, empType: "PROBATION" },
  { code: "EMP-115", name: "Muhsin Ali", dept: "Web Development", role: "Lead Developer", joined: "2022-01-10", email: "muhsin@desgromedia.com", phone: "+91 94950 10115", salary: 38000, empType: "PERMANENT" },
  { code: "EMP-116", name: "Anjali Rose", dept: "Web Development", role: "Web Developer", joined: "2024-06-16", email: "anjali@desgromedia.com", phone: "+91 94950 10116", salary: 26000, empType: "PERMANENT" },
  { code: "EMP-117", name: "Fathima Nazrin", dept: "Marketing Consultation", role: "Brand Strategist", joined: "2023-02-27", email: "nazrin@desgromedia.com", phone: "+91 94950 10117", salary: 30000, empType: "PERMANENT" },
  { code: "EMP-118", name: "Sudheesh Kumar", dept: "Production", role: "Photographer", joined: "2023-09-18", email: "sudheesh@desgromedia.com", phone: "+91 94950 10118", salary: 24000, empType: "PERMANENT" },
  { code: "EMP-119", name: "Hafsa Rahman", dept: "Marketing Consultation", role: "Account Manager", joined: "2022-10-03", email: "hafsa@desgromedia.com", phone: "+91 94950 10119", salary: 28000, empType: "PERMANENT" },
  { code: "EMP-120", name: "Vishnu Prakash", dept: "Sales", role: "Sales Manager", joined: "2024-04-08", email: "vishnu@desgromedia.com", phone: "+91 94950 10120", salary: 22000, empType: "PERMANENT", grantAccess: [Role.SALES] },
  { code: "EMP-121", name: "Reshma Beegum", dept: "Administrative", role: "HR Executive", joined: "2023-08-14", email: "reshma@desgromedia.com", phone: "+91 94950 10121", salary: 23000, empType: "PERMANENT", grantAccess: [Role.HR] },
  { code: "EMP-122", name: "Naveen Kumar", dept: "Administrative", role: "Accounts Executive", joined: "2022-12-01", email: "naveen@desgromedia.com", phone: "+91 94950 10122", salary: 25000, empType: "PERMANENT", grantAccess: [Role.FINANCE] },
  { code: "EMP-123", name: "Rahul Menon", dept: "Sales", role: "Sales Executive", joined: "2025-03-10", email: "rahul@desgromedia.com", phone: "+91 94950 10123", salary: 20000, empType: "PERMANENT" },
] as const;

const HOLIDAYS = [
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-01-26", name: "Republic Day" },
  { date: "2026-08-15", name: "Independence Day" },
  { date: "2026-10-02", name: "Gandhi Jayanti" },
  { date: "2026-10-20", name: "Deepavali" },
  { date: "2026-12-25", name: "Christmas" },
];

const LEAVE_REQUESTS = [
  { code: "EMP-107", type: "SICK", duration: "FULL_DAY", from: "2026-09-14", to: "2026-09-16", days: 3, reason: "Viral fever", status: "APPROVED" },
  { code: "EMP-118", type: "CASUAL", duration: "FULL_DAY", from: "2026-09-18", to: "2026-09-18", days: 1, reason: "Personal work", status: "PENDING" },
  { code: "EMP-109", type: "EARNED", duration: "FULL_DAY", from: "2026-09-25", to: "2026-09-27", days: 3, reason: "Family function", status: "PENDING" },
  { code: "EMP-114", type: "CASUAL", duration: "FULL_DAY", from: "2026-09-08", to: "2026-09-08", days: 1, reason: "Personal", status: "APPROVED" },
  { code: "EMP-112", type: "UNPAID", duration: "FULL_DAY", from: "2026-08-20", to: "2026-08-20", days: 1, reason: "Personal", status: "REJECTED", note: "Client deadline week — all hands needed" },
];

const ADVANCES = [
  { code: "EMP-111", amount: 8000, reason: "Medical expense", installments: 2, status: "RECOVERING", monthlyDeduction: 4000, balance: 4000 },
  { code: "EMP-116", amount: 6000, reason: "Bike repair", installments: 1, status: "PENDING", monthlyDeduction: 6000, balance: 6000 },
  { code: "EMP-113", amount: 5000, reason: "Personal emergency", installments: 1, status: "RECOVERED", monthlyDeduction: 5000, balance: 0 },
];

const COMPLAINTS = [
  { category: "Work Environment", dept: "Production", text: "Editing bay AC has been down for two weeks — gets very hard to focus by afternoon.", status: "REVIEWED", note: "Flagged to admin for repair; vendor visit scheduled." },
  { category: "Management / Leadership", dept: null, text: "Feedback on a project is sometimes given in the team group instead of one-on-one, which is discouraging in front of others.", status: "NEW" },
];

const POSITIONS = [
  { code: "POS-01", role: "Performance Marketing Executive", dept: "Performance Marketing", openings: 1 },
  { code: "POS-02", role: "Video Editor", dept: "Production", openings: 1 },
  { code: "POS-03", role: "Client Servicing Intern", dept: "Administrative", openings: 2 },
];

const CANDIDATES = [
  { posCode: "POS-01", name: "Athul Krishnan", phone: "9847001122", email: "athul.k@gmail.com", stage: "INTERVIEW" },
  { posCode: "POS-01", name: "Neha Balakrishnan", phone: "9847002233", email: "neha.b@gmail.com", stage: "APPLIED" },
  { posCode: "POS-02", name: "Sarath Menon", phone: "9847003344", email: "sarath.m@gmail.com", stage: "OFFER" },
  { posCode: "POS-03", name: "Fidha Rasheed", phone: "9847004455", email: "fidha.r@gmail.com", stage: "APPLIED" },
];

const SEPT_PENDING = new Set(["EMP-109", "EMP-114", "EMP-116", "EMP-120", "EMP-122"]);
const SEPT_PARTIAL = new Set(["EMP-101", "EMP-103"]);

function pfPtDeduction(gross: number) {
  const basic = Math.round(gross * 0.6);
  return Math.round(basic * 0.12) + 200; // PF + flat PT, no advance/LOP for this seed's simplified net
}

export async function seedHr() {
  const already = await prisma.employee.count();
  if (already > 0) {
    console.log(`HR seed skipped — ${already} employees already present.`);
    return;
  }

  const byCode = new Map<string, string>(); // employeeCode -> Employee.id

  for (const e of EMPLOYEES) {
    const employee = await prisma.employee.create({
      data: {
        employeeCode: e.code,
        name: e.name,
        dept: e.dept,
        role: e.role,
        joinedAt: new Date(e.joined),
        email: e.email,
        phone: e.phone,
        salary: e.salary,
        empType: e.empType as EmploymentType,
      },
    });
    byCode.set(e.code, employee.id);

    if ("grantAccess" in e && e.grantAccess) {
      const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);
      await prisma.user.create({
        data: { name: e.name, email: e.email, passwordHash, roles: e.grantAccess as Role[], employeeId: employee.id },
      });
    }
  }
  console.log(`Seeded ${EMPLOYEES.length} employees.`);

  await prisma.hrPolicy.upsert({
    where: { id: 1 },
    create: { id: 1, casualLeaveDays: 12, sickLeaveDays: 8, earnedLeaveDays: 15, weeklyOff: 0 },
    update: {},
  });
  for (const h of HOLIDAYS) {
    await prisma.holiday.upsert({ where: { date: new Date(h.date) }, create: { date: new Date(h.date), name: h.name }, update: {} });
  }

  for (const l of LEAVE_REQUESTS) {
    await prisma.leaveRequest.create({
      data: {
        employeeId: byCode.get(l.code)!,
        type: l.type as LeaveType,
        duration: l.duration as LeaveDuration,
        fromDate: new Date(l.from),
        toDate: new Date(l.to),
        days: l.days,
        reason: l.reason,
        status: l.status as LeaveStatus,
        note: "note" in l ? l.note : undefined,
      },
    });
  }
  console.log(`Seeded ${LEAVE_REQUESTS.length} leave requests.`);

  for (const a of ADVANCES) {
    await prisma.advance.create({
      data: {
        employeeId: byCode.get(a.code)!,
        amount: a.amount,
        reason: a.reason,
        installments: a.installments,
        monthlyDeduction: a.monthlyDeduction,
        balance: a.balance,
        status: a.status as AdvanceStatus,
      },
    });
  }
  console.log(`Seeded ${ADVANCES.length} advances.`);

  for (const c of COMPLAINTS) {
    await prisma.complaint.create({ data: { category: c.category, dept: c.dept ?? undefined, text: c.text, status: c.status as any, note: "note" in c ? c.note : undefined } });
  }
  console.log(`Seeded ${COMPLAINTS.length} complaints.`);

  const posIdByCode = new Map<string, string>();
  for (const p of POSITIONS) {
    const pos = await prisma.openPosition.create({ data: { positionCode: p.code, role: p.role, dept: p.dept, openings: p.openings, status: "OPEN" } });
    posIdByCode.set(p.code, pos.id);
  }
  for (const c of CANDIDATES) {
    await prisma.candidate.create({ data: { positionId: posIdByCode.get(c.posCode)!, name: c.name, phone: c.phone, email: c.email, stage: c.stage as CandidateStage } });
  }
  console.log(`Seeded ${POSITIONS.length} open positions and ${CANDIDATES.length} candidates.`);

  const reshmaId = byCode.get("EMP-121")!;
  const thanseemId = byCode.get("EMP-102")!;
  const reshmaUser = await prisma.user.findUnique({ where: { employeeId: reshmaId } });
  const thanseemUser = await prisma.user.findUnique({ where: { employeeId: thanseemId } });
  await prisma.notice.create({
    data: { title: "Diwali holiday schedule", message: "Office will be closed Oct 20–21 for Diwali. Regular hours resume Oct 22.", postedById: (reshmaUser ?? thanseemUser)!.id },
  });
  await prisma.notice.create({
    data: { title: "Updated reimbursement process", message: "Expense reimbursements now route through the Accounts Executive — see HR Settings for the full policy.", postedById: (thanseemUser ?? reshmaUser)!.id },
  });
  console.log("Seeded 2 notices.");

  // Payroll: August fully settled at (simplified) net for everyone; September
  // mid-review — some employees not yet added, two partially paid, two fully
  // paid — same shape as the old prototype's seed, not byte-identical figures
  // (advance/LOP deductions are now computed for real instead of hardcoded).
  for (const e of EMPLOYEES) {
    const employeeId = byCode.get(e.code)!;
    const augEntry = await prisma.payrollEntry.create({ data: { employeeId, month: "2026-08", gross: e.salary } });
    const augNet = e.salary - pfPtDeduction(e.salary);
    await prisma.payrollPayment.create({ data: { payrollEntryId: augEntry.id, amount: augNet, paidDate: new Date("2026-08-31"), note: "Full settlement" } });

    if (!SEPT_PENDING.has(e.code)) {
      const septEntry = await prisma.payrollEntry.create({ data: { employeeId, month: "2026-09", gross: e.salary } });
      const septNet = e.salary - pfPtDeduction(e.salary);
      if (SEPT_PARTIAL.has(e.code)) {
        await prisma.payrollPayment.create({ data: { payrollEntryId: septEntry.id, amount: Math.round(septNet * 0.5), paidDate: new Date("2026-09-10"), note: "Partial — fund shortage this cycle" } });
      } else {
        await prisma.payrollPayment.create({ data: { payrollEntryId: septEntry.id, amount: septNet, paidDate: new Date("2026-09-12"), note: "Full settlement" } });
      }
    }
  }
  console.log("Seeded August (fully settled) and September (mid-review) payroll.");

  console.log(`HR module logins (password: ${DEV_PASSWORD}): thanseemca@gmail.com (Admin), reshma@desgromedia.com (HR), vishnu@desgromedia.com (Sales), naveen@desgromedia.com (Finance), devika@desgromedia.com (base Employee).`);
}

if (require.main === module) {
  seedHr()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
