/* =============================================================================
   DESGRO MEDIA ERP — UI reference build. Single-file HTML/CSS/JS, in-memory
   data seeded on load. Sessions: Dashboard · HR · Marketing · Clients · Accounts.
   Swap the seed arrays + the CRUD functions below for real API calls to go live;
   the render layer above the data can stay as-is.
   ============================================================================= */

/* ===================== SHARED HELPERS ===================== */
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inr = n => "₹" + Math.round(Number(n)||0).toLocaleString("en-IN");
const fmtDate = iso => iso ? new Date(iso+"T00:00:00").toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}) : "—";
const fmtDateShort = iso => iso ? new Date(iso+"T00:00:00").toLocaleDateString("en-IN",{day:"numeric",month:"short"}) : "—";
const initials = name => String(name||"").split(" ").map(p=>p[0]).filter(Boolean).slice(0,2).join("").toUpperCase();
// Real current date (UTC-based, matching the server's own todayStr()) — was a
// hardcoded "2026-09-15" left over from the original static-seed-data
// prototype, so every "today" default/cap across the app (Attendance's date
// picker, month filters, etc.) was frozen on that one date instead of
// tracking the real clock.
const TODAY = new Date().toISOString().slice(0,10);
function daysBetween(a,b){ return Math.round((new Date(b)-new Date(a))/86400000); }
function toast(msg){
  const root = document.getElementById("toast-root");
  root.innerHTML = `<div class="toast"><svg class="icon" style="width:15px;height:15px"><use href="#i-check"/></svg><span>${esc(msg)}</span></div>`;
  clearTimeout(window.__t); window.__t = setTimeout(()=>{ root.innerHTML=""; }, 3200);
}
function pill(text, kind){ return `<span class="pill ${kind}">${esc(text)}</span>`; }
function showModal(html, wide){ document.getElementById("modal").className = "modal" + (wide?" wide":""); document.getElementById("modal").innerHTML = html; document.getElementById("overlay").hidden = false; }
function closeModal(){ document.getElementById("overlay").hidden = true; }
document.addEventListener("keydown", e=>{ if(e.key==="Escape") closeModal(); });

/* ===================== SHARED MASTER DATA ===================== */
const DEPARTMENTS = [
  "Marketing Consultation","Web Development","Production","Graphic Design",
  "Performance Marketing","Sales","Administrative"
];
// Client-facing delivery departments — the ones a client actually subscribes to (used for
// Services/Service Interested pickers, invoice line items, and as the revenue-attributed departments
// in deptProfitability()). Sales and Administrative are internal/enabling functions with no direct
// client revenue of their own, so their cost is pooled into shared overhead instead — see deptProfitability().
const SERVICE_DEPARTMENTS = DEPARTMENTS.filter(d=>d!=='Administrative' && d!=='Sales');

/* ===================== HR MODULE — DATA LAYER =====================
   Phase 2: employees/leaveRequests/advances/etc are no longer in-memory
   seed arrays — they're loaded from the server (see server/src/routes/
   hr.routes.ts) into module-shaped caches below, so the render layer
   further down this file (hrOverview, hrDirectory, hrAttendance, ...)
   can stay exactly as it was: synchronous functions reading plain JS
   arrays/objects. Only the loading and the mutation functions are async.

   Field-shape note: the API uses uuids and UPPERCASE enums; the render
   layer expects "EMP-101"-style codes and old Title Case strings ("Full
   Day", "Permanent", "Approved"...) — the map*() functions below do that
   translation once, at load time, so nothing downstream has to care. */
let employees = [];
// Lightweight name+dept roster for CRM pickers (Account Manager / Sales Person) —
// populated for roles that can reach CRM but not full HR (e.g. Sales), since
// listEmployees() itself is HR/Admin only. See loadEmployeeDirectory()/assignableEmployees().
let employeeDirectory = [];
function assignableEmployees(){ return employees.length ? employees : employeeDirectory; }
let employeeDbIdByCode = {}; // "EMP-101" -> real Employee uuid
let employeeCodeByDbId = {}; // real Employee uuid -> "EMP-101"
const byId = id => employees.find(e=>e.id===id) || archivedEmployees.find(e=>e.id===id);
function personCell(emp){
  return `<div class="person"><div class="mini-avatar">${initials(emp.name)}</div>
    <div><div class="person-name">${esc(emp.name)}</div><div class="person-role">${esc(emp.role)}</div></div></div>`;
}
function salaryHistoryFor(emp){
  const hist = (emp.salaryHistory && emp.salaryHistory.length) ? emp.salaryHistory : [{amount:emp.salary, effectiveDate:emp.joined, note:"Joining salary"}];
  return hist.slice().sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate));
}

// UPPERCASE_WITH_UNDERSCORES <-> "Title Case With Spaces" — covers empType,
// leave type/duration/status, advance/complaint status, position status and
// candidate stage; every one of those enums round-trips through this pair.
const TITLECASE_FROM_API = s => s==null ? s : String(s).split('_').map(w=>w.charAt(0)+w.slice(1).toLowerCase()).join(' ');
const TITLECASE_TO_API = s => s==null ? s : String(s).toUpperCase().replace(/ /g,'_');
// Attendance is the one enum that doesn't round-trip through a simple case
// transform (old "half"/"leave" vs API "HALF_DAY"/"ON_LEAVE").
const ATTENDANCE_FROM_API = {PRESENT:"present", LATE:"late", HALF_DAY:"half", ABSENT:"absent", ON_LEAVE:"leave", WFH:"wfh"};
const ATTENDANCE_TO_API = {present:"PRESENT", late:"LATE", half:"HALF_DAY", absent:"ABSENT", leave:"ON_LEAVE", wfh:"WFH"};
// LeaveRequest.type doesn't round-trip through TITLECASE either (WFH is an
// all-caps abbreviation, not a title-cased word).
const LEAVE_TYPE_FROM_API = {CASUAL_SICK:"Casual/Sick", WFH:"WFH"};
const LEAVE_TYPE_TO_API = {"Casual/Sick":"CASUAL_SICK", WFH:"WFH"};
const isoDate = s => s ? String(s).slice(0,10) : s;

function mapEmployee(e){
  return {
    id: e.employeeCode, _dbId: e.id, name: e.name, dept: e.dept, role: e.role,
    dob: isoDate(e.dob), joined: isoDate(e.joinedAt), email: e.email,
    phone: e.phone || "", salary: Number(e.salary),
    empType: TITLECASE_FROM_API(e.empType),
    employmentStatus: TITLECASE_FROM_API(e.employmentStatus),
    leavingDate: isoDate(e.leavingDate), noticeGivenDate: isoDate(e.noticeGivenDate), noticeNote: e.noticeNote || "",
    hasErpAccess: !!e.hasErpAccess,
  };
}
function mapLeaveRequest(l){
  return {
    id: l.id, empId: employeeCodeByDbId[l.employeeId] || l.employeeId,
    type: LEAVE_TYPE_FROM_API[l.type] || l.type, duration: TITLECASE_FROM_API(l.duration),
    from: isoDate(l.fromDate), to: isoDate(l.toDate), days: Number(l.days),
    reason: l.reason, status: TITLECASE_FROM_API(l.status),
    applied: isoDate(l.appliedAt), note: l.note || undefined,
  };
}
function mapAdvance(a){
  return {
    id: a.id, empId: employeeCodeByDbId[a.employeeId] || a.employeeId,
    amount: Number(a.amount), reason: a.reason, requested: isoDate(a.requestedAt),
    installments: a.installments, status: TITLECASE_FROM_API(a.status),
    monthlyDeduction: Number(a.monthlyDeduction), balance: Number(a.balance),
    paidDate: a.paidDate ? isoDate(a.paidDate) : undefined,
  };
}
function mapComplaint(c){
  return { id:c.id, category:c.category, dept:c.dept||"", text:c.text, submitted:isoDate(c.submittedAt), status:TITLECASE_FROM_API(c.status), note:c.note||undefined };
}
function mapPosition(p){
  return { id:p.id, role:p.role, dept:p.dept, openings:p.openings, status:TITLECASE_FROM_API(p.status), postedDate:isoDate(p.postedDate), archived:!!p.archived };
}
function mapCandidate(c){
  return { id:c.id, posId:c.positionId, name:c.name, phone:c.phone||"", email:c.email||"", stage:TITLECASE_FROM_API(c.stage), appliedDate:isoDate(c.appliedDate), archived:!!c.archived };
}
function mapNotice(n){
  return { id:n.id, title:n.title, message:n.message, postedBy:n.postedByUser?.name||"", postedDate:isoDate(n.postedDate) };
}
// A precomputed payroll row from the server, kept under the same field
// names the render layer already expects from the old computePayrollRow().
function mapPayrollRow(r){
  return { basic:r.basic, hra:r.hra, special:r.special, gross:r.gross, pf:r.pf, pt:r.pt,
    advDeduction:r.advDeduction, lopDays:r.lopDays, lopDeduction:r.lopDeduction,
    wfhExcessDays:r.wfhExcessDays||0, wfhDeduction:r.wfhDeduction||0,
    monthWorkingDays:r.monthWorkingDays, totalDeductions:r.totalDeductions, net:r.net,
    paid:r.paid, balance:r.balance, payStatus:r.payStatus,
    payments:(r.payments||[]).map(p=>({amount:Number(p.amount), date:isoDate(p.paidDate), note:p.note})) };
}

async function apiJson(url, opts){
  const res = await Auth.apiFetch(url, opts);
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/* ===================== HR MODULE — LOADERS ===================== */
let hrPolicy = { weeklyOff:0, paidLeavesPerMonth:1, paidWfhPerMonth:1, notes:"", holidays:[] };
let leavePayPolicy = { notes:"" };
// empCode -> computeMonthlyLeaveUsage() shape for whatever month was last fetched
// ({month, leaveDays, leaveCap, leaveRemaining, lopDays, wfhDays, wfhCap, wfhRemaining, wfhExcessDays}).
// A monthly cap, not a running balance — there's no single "current" figure
// without a month attached, unlike the old annual entitlement this replaced.
let leaveBalanceCache = {};
let attendanceToday = {};   // empCode -> {status,in}
// Fake per-employee MTD override in the old prototype — real MTD attendance
// isn't tracked yet beyond "today", so every lookup below just falls back to
// "full attendance assumed" (mtdWorkingDays) via the `?? mtdWorkingDays` it
// was already written with.
const monthPresentDays = {};
let leaveRequests = [];
let advances = [];
let complaints = [];
let openPositions = [];
let candidates = [];
let notices = [];
let payroll = { selectedMonth: TODAY.slice(0,7), history: {} };

async function loadPolicy(){
  const { policy, holidays } = await apiJson("/api/hr/policy");
  hrPolicy = {
    weeklyOff: policy.weeklyOff, paidLeavesPerMonth: policy.paidLeavesPerMonth, paidWfhPerMonth: policy.paidWfhPerMonth,
    notes: policy.generalNotes || "",
    holidays: holidays.map(h=>({date:isoDate(h.date), name:h.name})),
  };
  leavePayPolicy = { notes: policy.leavePayNotes || "" };
}
async function loadEmployees(){
  const { employees: list } = await apiJson("/api/hr/employees");
  employeeDbIdByCode = {}; employeeCodeByDbId = {};
  list.forEach(e=>{ employeeDbIdByCode[e.employeeCode]=e.id; employeeCodeByDbId[e.id]=e.employeeCode; });
  employees = list.map(mapEmployee);
}
let archivedEmployees = [];
async function loadArchivedEmployees(){
  const { employees: list } = await apiJson("/api/hr/employees?employmentStatus=LEFT");
  list.forEach(e=>{ employeeDbIdByCode[e.employeeCode]=e.id; employeeCodeByDbId[e.id]=e.employeeCode; });
  archivedEmployees = list.map(mapEmployee);
}
async function loadLeaveRequests(){
  const { leaveRequests: list } = await apiJson("/api/hr/leave-requests");
  leaveRequests = list.map(mapLeaveRequest);
}
async function loadAdvances(){
  const { advances: list } = await apiJson("/api/hr/advances");
  advances = list.map(mapAdvance);
}
async function loadComplaints(){
  const { complaints: list } = await apiJson("/api/hr/complaints");
  complaints = list.map(mapComplaint);
}
async function loadHiring(){
  const { positions } = await apiJson("/api/hr/positions");
  openPositions = positions.map(mapPosition);
  candidates = positions.flatMap(p=>(p.candidates||[]).map(mapCandidate));
}
// Matches the server's CandidateStage enum exactly.
const CANDIDATE_STAGES = ["Applied","Shortlisted","Interview","Offer","Hired","Rejected"];
async function updateCandidateStage(id, stage){
  const c = candidates.find(x=>x.id===id);
  if(!c) return;
  const prevStage = c.stage;
  c.stage = stage; render(); // optimistic — snappy dropdown feedback, same pattern as cycleAttendance
  try{
    await apiJson(`/api/hr/candidates/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ stage: TITLECASE_TO_API(stage) }) });
    toast(c.name+" moved to "+stage);
  }catch(err){
    c.stage = prevStage; render();
    toast(err.message || "Couldn't update candidate stage");
  }
}
async function loadNotices(){
  const { notices: list } = await apiJson("/api/hr/notices");
  notices = list.map(mapNotice);
}
async function loadLeaveBalances(){
  const { balances } = await apiJson("/api/hr/leave-balance");
  leaveBalanceCache = {};
  Object.entries(balances).forEach(([empDbId, b])=>{ leaveBalanceCache[employeeCodeByDbId[empDbId] || empDbId] = b; });
}
async function loadAttendanceToday(){
  const { records } = await apiJson(`/api/hr/attendance?date=${TODAY}`);
  attendanceToday = {};
  records.forEach(r=>{ attendanceToday[employeeCodeByDbId[r.employee.id] || r.employee.id] = { status: ATTENDANCE_FROM_API[r.status], in: r.checkIn || null }; });
  // Anyone without a record today reads as present by default — exceptions (absent/leave/etc.)
  // get marked, not confirmations of everyone showing up.
  employees.forEach(e=>{ if(!attendanceToday[e.id]) attendanceToday[e.id] = { status:"present", in:null }; });
  attendanceByDate[TODAY] = attendanceToday; // same object — HR Attendance's date picker defaults to today with no extra fetch
}
// HR Attendance's "pick a date" control — date -> {empCode: {status, in}}, fetched on demand per date.
let selectedAttendanceDate = TODAY;
let attendanceByDate = {};
async function loadAttendanceForDate(date){
  const { records } = await apiJson(`/api/hr/attendance?date=${date}`);
  const map = {};
  records.forEach(r=>{ map[employeeCodeByDbId[r.employee.id] || r.employee.id] = { status: ATTENDANCE_FROM_API[r.status], in: r.checkIn || null }; });
  employees.forEach(e=>{ if(!map[e.id]) map[e.id] = { status:"present", in:null }; });
  attendanceByDate[date] = map;
}
async function setAttendanceDate(date){
  selectedAttendanceDate = date;
  if(!attendanceByDate[date]) await loadAttendanceForDate(date).catch(()=>{ toast("Couldn't load attendance for that date"); });
  render();
}
// Month -> {empCode: {leave, wfh}} — company-wide ON_LEAVE/WFH day counts from
// real Attendance, for HR > Leave Requests' "Leave & WFH this month" panel.
// Read-only overview; doesn't feed payroll's Loss of Pay (computeLopDays,
// balance-based) or the annual leave-balance panel — see that endpoint's
// server-side comment for why the two aren't the same figure.
let attendanceMonthSummary = {};
async function loadAttendanceMonthSummary(month){
  const { byEmployee } = await apiJson(`/api/hr/attendance/summary?month=${month}`);
  const byCode = {};
  Object.entries(byEmployee).forEach(([dbId, counts])=>{ byCode[employeeCodeByDbId[dbId] || dbId] = counts; });
  attendanceMonthSummary[month] = byCode;
}
async function loadPayrollMonth(month){
  const { rows } = await apiJson(`/api/hr/payroll?month=${month}`);
  payroll.history[month] = { entries: {} };
  rows.forEach(r=>{ payroll.history[month].entries[employeeCodeByDbId[r.employeeId] || r.employeeId] = mapPayrollRow(r); });
}
function computePayrollRow(emp, month){
  return (payroll.history[month] && payroll.history[month].entries[emp.id]) || null;
}
function payrollMonthStatus(month){
  const ids = Object.keys(payroll.history[month].entries);
  const payrollEligible = employees.filter(e=>e.dept!=='Sales').length;
  if(!ids.length) return "Adding entries";
  if(ids.length < payrollEligible) return "Adding entries";
  const allSettled = ids.every(id=>computePayrollRow(byId(id),month).balance===0);
  return allSettled ? "Paid" : "Payments pending";
}

// HR/Admin get the whole module; every other role only gets what its own
// "own record" self-service views need — see ACCESS MODEL. The module nav
// itself already hides the rest (visibleModules()), this is the data-side
// half of that same restriction.
async function loadHrModule(){
  const admin = isHRRole(currentUser) || (currentUser && currentUser.isAdmin);
  if(admin){
    await loadEmployees();
    await Promise.all([
      loadPolicy(), loadLeaveRequests(), loadAdvances(), loadComplaints(),
      loadHiring(), loadNotices(), loadLeaveBalances(), loadAttendanceToday(),
      loadArchivedEmployees(), loadAttendanceMonthSummary(TODAY.slice(0,7)),
    ]);
    const prevMonth = (()=>{ const [y,m]=TODAY.slice(0,7).split('-').map(Number); const d=new Date(y,m-2,1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; })();
    await Promise.all([loadPayrollMonth(TODAY.slice(0,7)), loadPayrollMonth(prevMonth)]);
  } else {
    await loadPolicy();
    await loadNotices(); // broadcast notices are visible company-wide
    if(currentUser && currentUser._dbId){
      // mapLeaveRequest/mapAdvance translate employeeId (uuid) -> empId (code)
      // via this map, which loadEmployees() would normally build — but
      // non-admin roles never call it, so at least our own entry needs to
      // exist here for our own records to resolve correctly.
      employeeCodeByDbId[currentUser._dbId] = currentUser.id;
      employeeDbIdByCode[currentUser.id] = currentUser._dbId;
      leaveRequests = (await apiJson(`/api/hr/leave-requests?employeeId=${currentUser._dbId}`)).leaveRequests.map(mapLeaveRequest);
      advances = (await apiJson(`/api/hr/advances?employeeId=${currentUser._dbId}`)).advances.map(mapAdvance);
      const bal = await apiJson(`/api/hr/leave-balance/${currentUser._dbId}`);
      leaveBalanceCache[currentUser.id] = bal.balance;
      const { records } = await apiJson(`/api/hr/attendance/${currentUser._dbId}/history?month=${TODAY.slice(0,7)}`);
      const todayRec = records.find(r=>isoDate(r.date)===TODAY);
      attendanceToday[currentUser.id] = todayRec ? { status: ATTENDANCE_FROM_API[todayRec.status], in: todayRec.checkIn||null } : { status:"absent", in:null };
    }
  }
}

const WEEKDAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
// Working days are derived, not hardcoded: every calendar day counts as a working day unless it's the
// configured weekly off or a date marked as a holiday in HR Settings — mark a holiday there and every
// attendance/leave/payroll calculation below picks it up automatically.
function isHolidayDate(dateStr){ return hrPolicy.holidays.some(h=>h.date===dateStr); }
function workingDaysInRange(startStr, endStr){
  let count = 0;
  let d = new Date(startStr+"T00:00:00");
  const end = new Date(endStr+"T00:00:00");
  while(d<=end){
    const ds = d.toISOString().slice(0,10);
    if(d.getDay()!==hrPolicy.weeklyOff && !isHolidayDate(ds)) count++;
    d.setDate(d.getDate()+1);
  }
  return count;
}
function daysInCalendarMonth(y,m){ return new Date(y, m, 0).getDate(); }
function workingDaysInMonth(monthStr){ // "2026-09"
  const [y,m] = monthStr.split("-").map(Number);
  const last = daysInCalendarMonth(y,m);
  return workingDaysInRange(`${monthStr}-01`, `${monthStr}-${String(last).padStart(2,'0')}`);
}
function workingDaysMTD(){ return workingDaysInRange(TODAY.slice(0,7)+"-01", TODAY); }

// Loss of Pay days for an employee, for a given payroll month — mirrors the server's computeLopDays
// (leaveBalance.ts): ON_LEAVE attendance days that month, beyond hrPolicy.paidLeavesPerMonth. Reads
// attendanceMonthSummary, the same counts endpoint that service reads from, so a preview shown here
// before an employee is even added to payroll lines up with what the server will actually deduct.
function lopDaysFor(empId, month){
  const counts = attendanceMonthSummary[month] && attendanceMonthSummary[month][empId];
  return Math.max(0, (counts?.leave||0) - hrPolicy.paidLeavesPerMonth);
}
// WFH days beyond the monthly paid-WFH allowance — mirrors computeWfhExcessDays, paid at 75% (a 25% cut)
// rather than a full Loss of Pay.
function wfhExcessDaysFor(empId, month){
  const counts = attendanceMonthSummary[month] && attendanceMonthSummary[month][empId];
  return Math.max(0, (counts?.wfh||0) - hrPolicy.paidWfhPerMonth);
}
// Salary for a month is disbursed on the 5th of the following month, so the most recently CLOSED
// month (the one before the current calendar month) is always fully earned — this is that month,
// regardless of which payroll month HR happens to be adding entries for right now.
function closedPayrollMonth(){
  const [y,m] = TODAY.slice(0,7).split('-').map(Number);
  const d = new Date(y, m-1, 1); d.setMonth(d.getMonth()-1);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,'0');
}
// What an employee has actually earned-and-not-yet-been-paid: the balance on their most recently
// closed month's payroll entry, minus anything they already have a Pending withdrawal request in for.
function earnedUnpaidFor(emp){
  const month = closedPayrollMonth();
  const rec = payroll.history[month] && payroll.history[month].entries[emp.id];
  if(!rec) return {month, net:0, paid:0, balance:0, requestable:0};
  const c = computePayrollRow(emp, month);
  const pendingRequested = withdrawalRequests.filter(w=>w.empId===emp.id && w.month===month && w.status==='Pending').reduce((s,w)=>s+w.amount,0);
  return {month, net:c.net, paid:c.paid, balance:c.balance, requestable: Math.max(0, c.balance-pendingRequested)};
}

// ---- HR calendar: holidays (click a day to mark/remove) plus birthdays & work anniversaries ----
let hrCalendarMonth = TODAY.slice(0,7);
function setHrCalendarMonth(delta){
  const [y,m] = hrCalendarMonth.split("-").map(Number);
  let ny=y, nm=m+delta;
  if(nm<1){ nm=12; ny--; } else if(nm>12){ nm=1; ny++; }
  hrCalendarMonth = `${ny}-${String(nm).padStart(2,'0')}`;
  if(document.getElementById("content")) document.getElementById("content").innerHTML = hrPolicies();
}
function calendarEventsForMonth(monthStr){
  const [y,m] = monthStr.split("-").map(Number);
  const last = daysInCalendarMonth(y,m);
  const map = {};
  for(let d=1; d<=last; d++) map[d] = {holidays:[], birthdays:[], anniversaries:[]};
  hrPolicy.holidays.forEach(h=>{
    const [hy,hm,hd] = h.date.split("-").map(Number);
    if(hy===y && hm===m) map[hd].holidays.push(h.name);
  });
  employees.forEach(e=>{
    if(e.dob){
      const [,dm,dd] = e.dob.split("-").map(Number);
      if(dm===m && map[dd]) map[dd].birthdays.push(e);
    }
    const [jy,jm,jd] = e.joined.split("-").map(Number);
    if(jm===m && jy<y && map[jd]) map[jd].anniversaries.push({emp:e, years:y-jy});
  });
  return map;
}

// Monthly cap usage (computeMonthlyLeaveUsage() shape), not an annual
// balance — see leaveBalanceCache above. Falls back to a zero-usage default
// against the org-wide caps if nothing's been fetched for this employee yet.
function leaveBalance(empId){
  return leaveBalanceCache[empId] || {
    month: TODAY.slice(0,7),
    leaveDays:0, leaveCap:hrPolicy.paidLeavesPerMonth, leaveRemaining:hrPolicy.paidLeavesPerMonth, lopDays:0,
    wfhDays:0, wfhCap:hrPolicy.paidWfhPerMonth, wfhRemaining:hrPolicy.paidWfhPerMonth, wfhExcessDays:0,
  };
}

function monthLabel(m){ const [y,mm] = m.split('-').map(Number); return new Date(y, mm-1, 1).toLocaleDateString('en-US', {month:'long', year:'numeric'}); }
// Used all over Payroll/Finance as MONTH_LABEL["2026-09"] — was a hardcoded
// 2-entry object; a Proxy computes it for any month via monthLabel() instead,
// so every existing call site keeps working without being touched here.
const MONTH_LABEL = new Proxy({}, { get: (_,m) => monthLabel(m) });
function monthFilterOptions(dates, current){
  const months = [...new Set(dates.filter(Boolean).map(d=>d.slice(0,7)))].sort().reverse();
  return `<option value="All" ${current==='All'?'selected':''}>All months</option>` + months.map(m=>`<option value="${m}" ${m===current?'selected':''}>${monthLabel(m)}</option>`).join('');
}
let leadsMonthFilter = "All";
function setLeadsMonthFilter(v){ leadsMonthFilter = v; render(); }
let quotesMonthFilter = "All";
function setQuotesMonthFilter(v){ quotesMonthFilter = v; render(); }
let clientsMonthFilter = "All";
function setClientsMonthFilter(v){ clientsMonthFilter = v; render(); }
// "Today / month-wise / All time" filter — a superset of monthFilterOptions
// above (adds a Today option) for lists where "just today" is a common ask
// (Advances, Expenses, Invoices, Payables, Commissions, Journal, Client Task
// Board). Left the older monthFilterOptions()/*MonthFilter above untouched
// rather than migrating them, to keep this additive.
function dateFilterOptions(dates, current){
  const months = [...new Set(dates.filter(Boolean).map(d=>d.slice(0,7)))].sort().reverse();
  return `<option value="Today" ${current==='Today'?'selected':''}>Today</option>`
    + `<option value="All" ${current==='All'?'selected':''}>All time</option>`
    + months.map(m=>`<option value="${m}" ${m===current?'selected':''}>${monthLabel(m)}</option>`).join('');
}
function matchesDateFilter(dateStr, filterValue){
  if(!dateStr) return false;
  if(filterValue==='Today') return dateStr===TODAY;
  if(filterValue==='All') return true;
  return dateStr.slice(0,7)===filterValue;
}
function dateFilterSuffix(filterValue, verb){
  const v = verb || 'in';
  if(filterValue==='Today') return ' today';
  if(filterValue==='All') return ' total';
  return ' '+v+' '+monthLabel(filterValue);
}
let invoicesMonthFilter = "All";
function setInvoicesMonthFilter(v){ invoicesMonthFilter = v; render(); }
let payablesMonthFilter = "All";
function setPayablesMonthFilter(v){ payablesMonthFilter = v; render(); }
let expensesMonthFilter = "All";
function setExpensesMonthFilter(v){ expensesMonthFilter = v; render(); }
let commissionsMonthFilter = "All";
function setCommissionsMonthFilter(v){ commissionsMonthFilter = v; render(); }
let journalMonthFilter = "All";
function setJournalMonthFilter(v){ journalMonthFilter = v; render(); }
let advancesMonthFilter = "All";
function setAdvancesMonthFilter(v){ advancesMonthFilter = v; render(); }
let clientTaskBoardMonthFilter = {}; // per-client — {clientId: "All"|"Today"|"YYYY-MM"}
function setClientTaskBoardMonthFilter(clientId, v){ clientTaskBoardMonthFilter[clientId] = v; render(); }

const COMPLAINT_CATEGORIES = ["Workplace Behavior","Harassment","Management / Leadership","Compensation & Benefits","Work Environment","Policy Violation","Other"];

/* ===================== CLIENTS — DATA LAYER =====================
   Phase 4: clients/marketingLeads/quotes/clientTasks/contentItems/
   metaAdsCampaigns are no longer in-memory seed arrays — loaded from the
   server (see server/src/routes/{crm,content}.routes.ts) into the same
   module-shaped caches the render layer already expects, same pattern as
   HR/Finance. Ids are real uuids straight from the API (unlike Employees,
   nothing here displays its raw id to users, so no code<->uuid map needed —
   clientById()/leadById() just match against the cached array's real id). */
let clients = [];
const clientById = id => clients.find(c=>c.id===id);
function clientCell(id){ const c=clientById(id); if(!c) return "—"; return `<div><div style="font-weight:700;font-size:13px;">${esc(c.name)}</div><div class="subtext">${esc(c.city)}</div></div>`; }

// Enums that round-trip cleanly through the generic TITLECASE helpers
// (ClientStatus, BillingType, LeadStatus, ContentStage, MetaAdsCampaignStatus
// are all single words or already underscore-free) don't need a bespoke map.
// QuoteStatus and ClientTaskStatus don't round-trip cleanly (the old strings
// have lowercase joiners — "Submitted to Finance", "To Do" — that the
// generic Title-Case-every-word transform would get wrong), so those two
// get the same explicit-map treatment attendance status got in Phase 2.
const QUOTE_STATUS_FROM_API = { DRAFT:"Draft", SENT:"Sent", SUBMITTED_TO_FINANCE:"Submitted to Finance", INVOICED:"Invoiced", LOST:"Lost" };
const QUOTE_STATUS_TO_API = { Draft:"DRAFT", Sent:"SENT", "Submitted to Finance":"SUBMITTED_TO_FINANCE", Invoiced:"INVOICED", Lost:"LOST" };
const TASK_STATUS_FROM_API = { TODO:"To Do", IN_PROGRESS:"In Progress", REVIEW:"Review", DONE:"Done" };
const TASK_STATUS_TO_API = { "To Do":"TODO", "In Progress":"IN_PROGRESS", Review:"REVIEW", Done:"DONE" };

function mapClient(c){
  return {
    id: c.id, name: c.name, industry: c.industry||"", city: c.city||"",
    services: c.services||[], status: TITLECASE_FROM_API(c.status),
    billingType: TITLECASE_FROM_API(c.billingType),
    onboarded: isoDate(c.onboardedAt), accountManager: c.accountManager||"", salesPerson: c.salesPerson||"",
  };
}
async function loadClients(){ clients = (await apiJson("/api/crm/clients")).clients.map(mapClient); }
async function loadEmployeeDirectory(){
  const { employees: list } = await apiJson("/api/hr/employees/directory");
  employeeDirectory = list.map(e=>({ id: e.employeeCode, _dbId: e.id, name: e.name, dept: e.dept }));
}

async function loadCrmModule(){
  await Promise.all([loadClients(), loadLeads(), loadQuotes(), loadTasks(), loadEmployeeDirectory()]);
}
async function loadContentModule(){
  await Promise.all([loadContentItems(), loadMetaCampaigns()]);
}

/* ===================== MARKETING ===================== */
const STAGES = ['Idea','Scripting','Production','Review','Scheduled','Published'];
const PLATFORMS = [
  {key:'Instagram', icon:'i-instagram'}, {key:'LinkedIn', icon:'i-linkedin'},
  {key:'YouTube', icon:'i-youtube'}, {key:'Facebook', icon:'i-facebook'}, {key:'Blog', icon:'i-globe'},
];

let contentItems = [];
let contentPlatformFilter = 'All';
function mapContentItem(c){
  return { id:c.id, title:c.title, type:c.type, platforms:c.platforms||[], assignee:c.assignee||'', stage:TITLECASE_FROM_API(c.stage), due:isoDate(c.dueAt), notes:c.notes||'' };
}
async function loadContentItems(){ contentItems = (await apiJson("/api/content/items")).items.map(mapContentItem); }

let metaAdsCampaigns = [];
function mapMetaCampaign(c){
  return { id:c.id, name:c.name, objective:c.objective, platform:c.platform, status:TITLECASE_FROM_API(c.status), spend:Number(c.spend), impressions:c.impressions, clicks:c.clicks, leads:c.leads, startDate:isoDate(c.startAt) };
}
async function loadMetaCampaigns(){ metaAdsCampaigns = (await apiJson("/api/content/meta-campaigns")).campaigns.map(mapMetaCampaign); }
function adMetrics(c){
  const ctr = c.impressions ? (c.clicks/c.impressions*100) : 0;
  const cpc = c.clicks ? c.spend/c.clicks : 0;
  const cpl = c.leads ? c.spend/c.leads : 0;
  return {...c, ctr, cpc, cpl};
}

const LEAD_SOURCES = ["Meta","Organic","References"];
let marketingLeads = [];
function mapLead(l){
  return { id:l.id, name:l.name, phone:l.phone||"", email:l.email||"", source:l.source, serviceInterested:l.serviceInterested, leadOwner:l.leadOwner||"", createdDate:isoDate(l.createdAt), status:TITLECASE_FROM_API(l.status), convertedClientId:l.convertedClientId||null };
}
async function loadLeads(){ marketingLeads = (await apiJson("/api/crm/leads")).leads.map(mapLead); }

/* ===================== QUOTES =====================
   Sales lifecycle: Sales creates a quote for an existing client OR a lead (Draft), possibly quoting
   several services at once (each priced independently, summing to the quote total) → sends it to the
   client (Sent) → as the client pays — in full or in installments — Sales records each payment, which
   pushes it to Finance for confirmation (Submitted to Finance) → Finance confirms the money actually
   landed in the bank and approves it — see openApproveQuotePayment() under Accounts > Quotes, which
   now really does create (or top up) the real invoice and post to the bank ledger via the server. */
let quotes = [];
function mapQuote(q){
  return {
    id: q.id, clientId: q.clientId||null, leadId: q.leadId||null,
    items: q.items.map(i=>({dept:i.dept, amount:Number(i.amount)})),
    title: q.title, createdBy: q.createdBy||"", createdDate: isoDate(q.createdAt),
    status: QUOTE_STATUS_FROM_API[q.status] || q.status,
    sentDate: q.sentAt ? isoDate(q.sentAt) : undefined,
    invoiceId: q.invoiceId||null,
    payments: q.pendingPayments.map(p=>({id:p.id, amount:Number(p.amount), date:isoDate(p.paymentDate), note:p.note, approved:p.approved, approvedDate:p.approvedAt?isoDate(p.approvedAt):undefined})),
  };
}
async function loadQuotes(){ quotes = (await apiJson("/api/crm/quotes")).quotes.map(mapQuote); }
function quoteStatusKind(s){ return {Draft:"neutral",Sent:"blue","Submitted to Finance":"warn",Invoiced:"pos",Lost:"neg"}[s] || "neutral"; }
function leadById(id){ return marketingLeads.find(l=>l.id===id); }
function quoteTotal(q){ return q.items.reduce((s,i)=>s+i.amount,0); }
function quoteParty(q){ return q.clientId ? {kind:"client", id:q.clientId, name:(clientById(q.clientId)||{name:"—"}).name} : (q.leadId ? {kind:"lead", id:q.leadId, name:(leadById(q.leadId)||{name:"—"}).name} : {kind:"none", id:null, name:"—"}); }
function quoteApprovedPaid(q){ return (q.payments||[]).filter(p=>p.approved).reduce((s,p)=>s+p.amount,0); }
function quotePendingAmount(q){ return (q.payments||[]).filter(p=>!p.approved).reduce((s,p)=>s+p.amount,0); }
function quoteBalance(q){ return Math.max(0, quoteTotal(q) - quoteApprovedPaid(q) - quotePendingAmount(q)); }

/* ===================== CLIENT WORKFLOW (TASKS) ===================== */
// Work is tracked directly against the client — no separate "Project" layer. Every task/activity for
// a client shows up on their one workflow board (see renderClientTaskBoard()), so there's nowhere
// else to look for "what have we done for this client".
let clientTasks = [];
function mapTask(t){
  return {
    id: t.id, clientId: t.clientId, title: t.title, assignedTo: t.assignedTo||"",
    due: isoDate(t.dueAt), status: TASK_STATUS_FROM_API[t.status] || t.status,
    revisions: t.revisions, doneDate: t.doneAt ? isoDate(t.doneAt) : undefined,
    attachments: (t.attachments||[]).map(a=>({id:a.id, name:a.name, size:a.size, addedDate:isoDate(a.addedAt)})),
  };
}
async function loadTasks(){ clientTasks = (await apiJson("/api/crm/tasks")).tasks.map(mapTask); }
function tasksOf(clientId){ return clientTasks.filter(t=>t.clientId===clientId); }
// A completed task stays visible on its board for 3 days, then moves to the archive — reachable via
// the "Archive" button on the client's Workflow header (or on My Tasks for a Staff sign-in) rather
// than cluttering the live board. doneDate is stamped by moveTask() the moment a task hits Done.
function isTaskArchived(t){ return t.status==="Done" && !!t.doneDate && (new Date(TODAY)-new Date(t.doneDate))/86400000 >= 3; }

/* ===================== ACCOUNTS ===================== */

/* ---- Invoices ---- */
// Invoices are settled with one or more dated payments (each tagged to the bank account it landed
// in) rather than a single Paid/Pending flag — see invoicePaid()/invoiceBalance()/invoiceStatus().
// Like quotes, an invoice can bundle several services each priced independently — items:[{dept,amount}]
// — and its total is always the sum of those (see invoiceTotal()); there's no single "amount" field.
/* ===================== ACCOUNTS — DATA LAYER =====================
   Phase 3: invoices/payables/expenses/bankAccounts/chartOfAccounts/
   journalEntries are no longer in-memory seed arrays — they're loaded from
   the server (see server/src/routes/finance.routes.ts) into module-shaped
   caches below, so the render layer further down (acctOverview, acctInvoices,
   acctPayables, ...) can stay exactly as it was. Only loading and mutation
   are async. Ids are real uuids straight from the API — unlike Employees,
   none of these ever had a meaningful human-facing code the UI displays
   (invoiceNo is already that field, kept as-is), so there's no separate
   code<->uuid translation layer needed here. */
let invoices = [];
let payables = [];
let expenses = [];
let bankAccounts = [];
let chartOfAccounts = [];
let journalEntries = [];
let commissionWithdrawals = [];
const bankById = id => bankAccounts.find(b=>b.id===id);

/* ---- Pure computed-figure helpers — unchanged from the original prototype,
   now operating on the mapped/cached arrays instead of raw seed data ---- */
function invoiceTotal(inv){ return (inv.items||[]).reduce((s,i)=>s+i.amount,0); }
function invoicePaid(inv, asOf){ return (inv.payments||[]).filter(p=>!asOf||p.date<=asOf).reduce((s,p)=>s+p.amount,0); }
function invoiceBalance(inv, asOf){ return Math.max(0, invoiceTotal(inv) - invoicePaid(inv, asOf)); }
function invoicePendingAmount(inv){ return (inv.pendingPayments||[]).filter(p=>!p.approved).reduce((s,p)=>s+p.amount,0); }
function invoiceStatus(inv){
  const paid = invoicePaid(inv), bal = invoiceBalance(inv);
  if(bal<=0) return "Paid";
  if(paid>0) return "Partially Paid";
  return inv.due < TODAY ? "Overdue" : "Pending";
}
const invStatusKind = s => ({Paid:"pos","Partially Paid":"warn",Pending:"warn",Overdue:"neg"}[s]||"neutral");

const CLEAR_ORDER = ["Salary","Rent","Commission","Sales Bonus","Internal Loan","Vendor"];
function payablePaid(p, asOf){ return (p.payments||[]).filter(pm=>!asOf||pm.date<=asOf).reduce((s,pm)=>s+pm.amount,0); }
function payableBalance(p, asOf){ return Math.max(0, p.amount - payablePaid(p, asOf)); }
function payableStatus(p){
  const paid = payablePaid(p), bal = payableBalance(p);
  if(bal<=0) return "Paid";
  if(paid>0) return "Partially Paid";
  return "Pending";
}
function payableStatusKind(s){ return {Paid:"pos","Partially Paid":"warn",Pending:"warn"}[s] || "neutral"; }
function liabilityAccountFor(category){
  if(category==="Internal Loan") return "Internal Loan";
  if(category==="Salary") return "Payroll Payable";
  return category+" Payable";
}
const PAYABLE_LIABILITY_CATEGORIES = ["Rent","Commission","Vendor"];
// Flat 10%, hardcoded server-side too (server/src/services/finance/commission.ts)
// — not per-employee or per-client configurable anywhere.
const SALES_COMMISSION_RATE = 0.10;

function mapInvoice(i){
  return {
    id: i.id, clientId: i.clientId, invoiceNo: i.invoiceNo,
    items: i.items.map(it=>({dept: it.dept, amount: Number(it.amount)})),
    issued: isoDate(i.issuedAt), due: isoDate(i.dueAt),
    payments: i.payments.map(p=>({id:p.id, amount:Number(p.amount), date:isoDate(p.paidDate), accountId:p.accountId, note:p.note})),
    pendingPayments: i.pendingPayments.map(p=>({id:p.id, amount:Number(p.amount), date:isoDate(p.paymentDate), salesPerson:p.salesPerson, note:p.note, approved:p.approved, approvedDate:p.approvedAt?isoDate(p.approvedAt):undefined})),
  };
}
function mapPayable(p){
  return {
    id: p.id, category: TITLECASE_FROM_API(p.category), payee: p.payee, salesPerson: p.salesPerson || undefined,
    amount: Number(p.amount), due: isoDate(p.dueAt),
    payments: p.payments.map(pm=>({id:pm.id, amount:Number(pm.amount), date:isoDate(pm.paidDate), accountId:pm.accountId, note:pm.note})),
  };
}
function mapExpense(e){
  return { id:e.id, category:e.coaAccount.name, coaAccountId:e.coaAccountId, description:e.description, amount:Number(e.amount), date:isoDate(e.date), accountId:e.accountId, dept:e.dept||"" };
}
function mapBankAccount(b){
  return { id:b.id, name:b.name, bank:b.bank, number:b.number, opening:Number(b.opening), openedOn:isoDate(b.openedAt), balance:Number(b.balance) };
}
function mapCommissionWithdrawal(w){
  return { id:w.id, salesPerson: w.employee?.name || w.salesPerson, amount:Number(w.amount), note:w.note||undefined, requested:isoDate(w.requestedAt), status:TITLECASE_FROM_API(w.status), decidedDate: w.decidedAt?isoDate(w.decidedAt):undefined, accountId:w.accountId||undefined, paidAmount: w.paidAmount!=null?Number(w.paidAmount):undefined };
}
// Balances are now server-computed (bulk endpoint already returns `.balance`
// for each account) — no more client-side ledger summing.
function bankAccountBalance(accountId){ const b = bankById(accountId); return b ? b.balance : 0; }

async function loadInvoices(){ invoices = (await apiJson("/api/finance/invoices")).invoices.map(mapInvoice); }
async function loadPayables(){ payables = (await apiJson("/api/finance/payables")).payables.map(mapPayable); }
async function loadExpenses(){ expenses = (await apiJson("/api/finance/expenses")).expenses.map(mapExpense); }
async function loadBankAccounts(){ bankAccounts = (await apiJson("/api/finance/bank-accounts")).accounts.map(mapBankAccount); }
async function loadCommissionWithdrawals(){
  const admin = isFinanceAdminUser(currentUser);
  const url = admin ? "/api/finance/commission-withdrawals" : `/api/finance/commission-withdrawals?employeeId=${currentUser._dbId||''}`;
  commissionWithdrawals = (await apiJson(url)).withdrawals.map(mapCommissionWithdrawal);
}
// Monthly sales target + bonus commission — see server/src/services/finance/salesTarget.ts.
// salesPolicy is the two editable settings; salesTargets is this-month standing per
// salesperson (server scopes it to "just me" for a Sales caller, everyone for Finance/Admin).
let salesPolicy = {monthlyTarget:500000, bonusRate:0.10};
let salesTargets = [];
async function loadSalesPolicy(){ salesPolicy = await apiJson("/api/finance/sales-policy"); }
async function loadSalesTargets(){ salesTargets = (await apiJson("/api/finance/sales-targets")).rows; }

/* ---- Commission Withdrawals — self-service (Sales requests, Finance approves) ---- */
function openRequestCommissionWithdrawal(){
  if(!currentUser) return;
  const mine = commissionRowsByPerson().find(r=>r.name===currentUser.name) || {balance:0};
  if(mine.balance<=0){ toast("No outstanding commission to withdraw"); return; }
  showModal(`
    <div class="modal-head"><h3>Request commission withdrawal</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-request-withdrawal"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${inr(mine.balance)} outstanding. Submitted to Finance for approval — once approved, it's paid out against your commission entries.</div></div>
      <div><label class="field-label">Amount to withdraw (₹)</label><input class="field-input" type="number" name="amount" min="1" max="${mine.balance}" step="1" required value="${mine.balance}"></div>
      <div><label class="field-label">Note (optional)</label><textarea class="field-input" name="note" placeholder="Anything Finance should know"></textarea></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Submit request</button></div></div>
    </form>`);
  document.getElementById("f-request-withdrawal").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const amount = Math.min(mine.balance, Math.max(1, Number(f.get("amount"))));
    try{
      await apiJson("/api/finance/commission-withdrawals", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ amount, note:f.get("note")||undefined }) });
      await loadCommissionWithdrawals();
      toast("Withdrawal request submitted"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't submit withdrawal request"); }
  });
}
function openApproveCommissionWithdrawal(id){
  const w = commissionWithdrawals.find(x=>x.id===id);
  showModal(`
    <div class="modal-head"><h3>Approve withdrawal — ${esc(w.salesPerson)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-approve-withdrawal"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${esc(w.salesPerson)} requested <b>${inr(w.amount)}</b>${w.note?' — '+esc(w.note):''}. This pays out against their outstanding commission entries, oldest due date first.</div></div>
      <div class="field-row">
        <div><label class="field-label">Paid from account</label><select class="field-input" name="accountId">${bankAccounts.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
        <div><label class="field-label">Date</label><input class="field-input" type="date" name="date" value="${TODAY}" required></div>
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Approve &amp; pay out</button></div></div>
    </form>`);
  document.getElementById("f-approve-withdrawal").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const accountId = f.get("accountId"), date = f.get("date");
    try{
      const { paidAmount } = await apiJson(`/api/finance/commission-withdrawals/${id}/approve`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ accountId, date }) });
      await Promise.all([loadCommissionWithdrawals(), loadPayables(), loadBankAccounts()]);
      toast("Withdrawal approved — "+inr(paidAmount)+" paid to "+w.salesPerson); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't approve withdrawal"); }
  });
}
async function decideCommissionWithdrawalReject(id){
  try{
    await apiJson(`/api/finance/commission-withdrawals/${id}/reject`, { method:"POST" });
    await loadCommissionWithdrawals();
    toast("Withdrawal request rejected"); render();
  }catch(err){ toast(err.message || "Couldn't reject withdrawal"); }
}

/* ===================== PAYMENT REQUESTS ===================== */
// Money OUT to an employee for anything other than salary (reimbursement, travel,
// a purchase they fronted). Any employee raises one; it skips HR and lands in
// Accounts > Payment Requests for Finance/Admin to approve-and-pay or reject.
// The server scopes the list itself — Finance/Admin get everyone's, everyone
// else only their own — so this one loader is right for every role.
const PAYMENT_REQUEST_CATEGORIES = [
  {api:"REIMBURSEMENT", label:"Reimbursement"}, {api:"TRAVEL", label:"Travel"},
  {api:"PURCHASE_VENDOR", label:"Purchase / Vendor"}, {api:"OTHER", label:"Other"},
];
const paymentRequestCategoryLabel = api => (PAYMENT_REQUEST_CATEGORIES.find(c=>c.api===api)||{label:api}).label;
let paymentRequests = [];
function mapPaymentRequest(r){
  return {
    id:r.id, empId:r.employee.employeeCode, empName:r.employee.name,
    category:paymentRequestCategoryLabel(r.category), amount:Number(r.amount), reason:r.reason,
    requested:isoDate(r.requestedAt), status:TITLECASE_FROM_API(r.status),
    decidedDate: r.decidedAt?isoDate(r.decidedAt):undefined, paidDate: r.paidDate?isoDate(r.paidDate):undefined,
    accountId: r.accountId||undefined,
  };
}
async function loadPaymentRequests(){ paymentRequests = (await apiJson("/api/finance/payment-requests")).requests.map(mapPaymentRequest); }
function pendingPaymentRequests(){ return paymentRequests.filter(r=>r.status==="Pending").slice().sort((a,b)=>a.requested.localeCompare(b.requested)); }

// Personal area for every role — My Workspace for Leadership/Staff/Sales/Content, and the HR
// module's own tab for HR sign-ins (who only see that module). Only ever looks at currentUser.
function workspacePaymentRequests(){
  if(!currentUser) return '';
  const order = {Pending:0,Approved:1,Rejected:2};
  const mine = paymentRequests.filter(r=>r.empId===currentUser.id).slice().sort((a,b)=> order[a.status]!==order[b.status] ? order[a.status]-order[b.status] : b.requested.localeCompare(a.requested));
  return `
  ${hasEmployeeRecord() ? `<div class="toolbar"><div></div><button class="btn primary" onclick="openRequestPayment()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Request payment</button></div>` : noEmployeeRecordBanner("payment requests")}
  <div class="panel">
    <div class="panel-head"><h3>Your requests</h3><div class="sub">Goes straight to Accounts — no HR approval needed. For salary advances, use Advance Salary instead.</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Category</th><th class="num">Amount</th><th>Reason</th><th>Requested</th><th>Status</th></tr></thead>
      <tbody>${mine.length ? mine.map(r=>`<tr><td><span class="tag type">${esc(r.category)}</span></td><td class="num mono">${inr(r.amount)}</td><td class="muted">${esc(r.reason)}</td><td class="muted">${fmtDate(r.requested)}</td><td>${pill(r.status==='Approved'?'Paid':r.status, r.status==='Approved'?'pos':statusKind(r.status))}${r.status==='Approved'&&r.paidDate?`<div class="subtext">${fmtDateShort(r.paidDate)}</div>`:''}</td></tr>`).join("") : `<tr><td colspan="5"><div class="empty">No payment requests yet.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
function openRequestPayment(){
  showModal(`
    <div class="modal-head"><h3>Request a payment</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-request-payment"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>For anything other than a salary advance — a reimbursement, a purchase you fronted, travel, etc. This goes straight to Accounts, not HR.</div></div>
      <div class="field-row">
        <div><label class="field-label">Category</label><select class="field-input" name="category">${PAYMENT_REQUEST_CATEGORIES.map(c=>`<option value="${c.api}">${esc(c.label)}</option>`).join('')}</select></div>
        <div><label class="field-label">Amount (₹)</label><input class="field-input" type="number" name="amount" min="0.01" step="0.01" required placeholder="2500"></div>
      </div>
      <div><label class="field-label">Reason</label><textarea class="field-input" name="reason" required maxlength="500" placeholder="What's this for?"></textarea></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Submit request</button></div></div>
    </form>`);
  document.getElementById("f-request-payment").addEventListener("submit", async e=>{
    e.preventDefault();
    const submit = e.target.querySelector('button[type="submit"]');
    submit.disabled = true; // a double-click would otherwise file the request twice
    const f = new FormData(e.target);
    try{
      await apiJson("/api/finance/payment-requests", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ category:f.get("category"), amount:Number(f.get("amount")), reason:f.get("reason").trim() }) });
      await loadPaymentRequests();
      toast("Payment request submitted"); closeModal(); render();
    }catch(err){ submit.disabled = false; toast(err.message || "Couldn't submit payment request"); }
  });
}

// Finance/Admin queue — oldest first, plus the most recent decisions so a paid or
// rejected request doesn't just vanish from view. Two sources feed the same queue: advance
// salaries HR has already approved but Finance hasn't paid out yet, and payment requests anyone
// raised for something other than salary — see pendingAdvanceDisbursements/loadPendingAdvanceDisbursements above.
function acctPaymentRequests(){
  const advRows = pendingAdvanceDisbursements.slice().sort((a,b)=>a.requested.localeCompare(b.requested));
  const reqRows = pendingPaymentRequests();
  const totalPending = advRows.length + reqRows.length;
  const decided = paymentRequests.filter(r=>r.status!=="Pending").slice().sort((a,b)=>(b.decidedDate||b.requested).localeCompare(a.decidedDate||a.requested)).slice(0,8);
  return `
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Two queues in one: advance salaries HR has already approved but Finance hasn't paid out yet — recovery afterward happens automatically out of payroll, nothing to track here — and payment requests anyone in the company raised for something other than salary, which skip HR and land here directly. Rejecting only applies to payment requests; an advance salary decision is HR's — reject it from HR &gt; Advance Salary instead. Every decision is logged with who made it and when.</div></div>
  <div class="panel">
    <div class="panel-head"><h3>Payment Requests</h3><div class="sub">${totalPending} awaiting Finance</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Type</th><th>Raised by</th><th class="num">Amount</th><th>Reason</th><th>Requested</th><th></th></tr></thead>
      <tbody>${totalPending?[
        ...advRows.map(a=>`<tr><td>${pill('Advance Salary','blue')}<div class="subtext">HR-approved</div></td><td class="muted">${esc(a.empName)}</td><td class="num mono">${inr(a.amount)}</td><td class="muted">${esc(a.reason)}</td><td class="muted">${fmtDateShort(a.requested)}</td><td><button class="btn btn-sm primary" onclick="openDisburseAdvance('${a.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Pay</button></td></tr>`),
        ...reqRows.map(r=>`<tr><td><span class="tag type">${esc(r.category)}</span></td><td class="muted">${esc(r.empName)}</td><td class="num mono">${inr(r.amount)}</td><td class="muted">${esc(r.reason)}</td><td class="muted">${fmtDateShort(r.requested)}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;"><button class="btn btn-sm primary" onclick="openApprovePaymentRequest('${r.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Approve &amp; pay</button><button class="btn btn-sm danger" onclick="rejectPaymentRequest('${r.id}')">Reject</button></div></td></tr>`)
      ].join(""):'<tr><td colspan="6"><div class="empty">Nothing waiting on Finance right now.</div></td></tr>'}</tbody>
    </table></div>
  </div>
  ${decided.length?`<div class="panel">
    <div class="panel-head"><h3>Recently decided</h3><div class="sub">Last ${decided.length}</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Type</th><th>Raised by</th><th class="num">Amount</th><th>Reason</th><th>Decided</th><th>Status</th></tr></thead>
      <tbody>${decided.map(r=>`<tr><td><span class="tag type">${esc(r.category)}</span></td><td class="muted">${esc(r.empName)}</td><td class="num mono">${inr(r.amount)}</td><td class="muted">${esc(r.reason)}</td><td class="muted">${r.decidedDate?fmtDateShort(r.decidedDate):'—'}</td><td>${pill(r.status==='Approved'?'Paid':r.status, r.status==='Approved'?'pos':statusKind(r.status))}${r.status==='Approved'&&bankById(r.accountId)?`<div class="subtext">${esc(bankById(r.accountId).name)}</div>`:''}</td></tr>`).join("")}</tbody>
    </table></div>
  </div>`:''}`;
}
function openApprovePaymentRequest(id){
  const r = paymentRequests.find(x=>x.id===id);
  if(!r) return;
  showModal(`
    <div class="modal-head"><h3>Approve &amp; pay — ${esc(r.category)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-approve-payment-request"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${esc(r.empName)} · ${esc(r.reason)} · <b>${inr(r.amount)}</b> requested ${fmtDateShort(r.requested)}. Paid in full from the account below.</div></div>
      <div class="field-row">
        <div><label class="field-label">Paid from account</label><select class="field-input" name="accountId">${bankAccounts.map(b=>`<option value="${b.id}">${esc(b.name)} — ${inr(b.balance)}</option>`).join('')}</select></div>
        <div><label class="field-label">Date</label><input class="field-input" type="date" name="date" value="${TODAY}" required></div>
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Approve &amp; pay</button></div></div>
    </form>`);
  document.getElementById("f-approve-payment-request").addEventListener("submit", async e=>{
    e.preventDefault();
    const submit = e.target.querySelector('button[type="submit"]');
    submit.disabled = true;
    const f = new FormData(e.target);
    try{
      await apiJson(`/api/finance/payment-requests/${id}/approve`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ accountId:f.get("accountId"), date:f.get("date") }) });
      await Promise.all([loadPaymentRequests(), loadBankAccounts()]);
      toast("Payment request approved and paid"); closeModal(); render();
    }catch(err){
      submit.disabled = false; toast(err.message || "Couldn't approve payment request");
      // "Already decided" means someone else got there first — show the current state.
      if(/already decided/i.test(err.message||"")){ await loadPaymentRequests().catch(()=>{}); closeModal(); render(); }
    }
  });
}
async function rejectPaymentRequest(id){
  try{
    await apiJson(`/api/finance/payment-requests/${id}/reject`, { method:"POST" });
    await loadPaymentRequests();
    toast("Payment request rejected"); render();
  }catch(err){
    toast(err.message || "Couldn't reject payment request");
    if(/already decided/i.test(err.message||"")){ await loadPaymentRequests().catch(()=>{}); render(); }
  }
}

// HR already decided pending/approved/rejected (see decideAdvance in the HR module) — these are
// advances HR has approved ("Recovering") that Finance hasn't actually paid out yet. A one-time
// lump sum, not a balance paid down over multiple visits — recovery out of payroll afterward is
// automatic (advDeduction) and unrelated to this. Shown alongside Payment Requests below since
// both are the same kind of queue: money HR/an employee cleared that Finance still needs to pay.
let pendingAdvanceDisbursements = [];
function mapAdvanceDisbursement(a){
  return { id:a.id, empId:a.employee.employeeCode, empName:a.employee.name, amount:Number(a.amount),
    reason:a.reason, requested:isoDate(a.requestedAt) };
}
async function loadPendingAdvanceDisbursements(){
  pendingAdvanceDisbursements = (await apiJson("/api/finance/advances/pending-disbursement")).advances.map(mapAdvanceDisbursement);
}
function openDisburseAdvance(id){
  const a = pendingAdvanceDisbursements.find(x=>x.id===id);
  if(!a) return;
  showModal(`
    <div class="modal-head"><h3>Pay advance salary — ${esc(a.empName)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-disburse-advance"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>HR-approved · ${esc(a.reason)} · <b>${inr(a.amount)}</b> requested ${fmtDateShort(a.requested)}. Paid in full from the account below — recovery from payroll happens automatically afterward.</div></div>
      <div class="field-row">
        <div><label class="field-label">Paid from account</label><select class="field-input" name="accountId">${bankAccounts.map(b=>`<option value="${b.id}">${esc(b.name)} — ${inr(b.balance)}</option>`).join('')}</select></div>
        <div><label class="field-label">Date</label><input class="field-input" type="date" name="date" value="${TODAY}" required></div>
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Pay out</button></div></div>
    </form>`);
  document.getElementById("f-disburse-advance").addEventListener("submit", async e=>{
    e.preventDefault();
    const submit = e.target.querySelector('button[type="submit"]');
    submit.disabled = true;
    const f = new FormData(e.target);
    try{
      await apiJson(`/api/finance/advances/${id}/disburse`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ accountId:f.get("accountId"), date:f.get("date") }) });
      await Promise.all([loadPendingAdvanceDisbursements(), loadBankAccounts()]);
      toast(a.empName+"'s advance paid out"); closeModal(); render();
    }catch(err){
      submit.disabled = false; toast(err.message || "Couldn't pay out advance");
      if(/already paid|already decided/i.test(err.message||"")){ await loadPendingAdvanceDisbursements().catch(()=>{}); closeModal(); render(); }
    }
  });
}

/* ===================== WITHDRAWAL REQUESTS + MY PAYROLL ===================== */
// Two different things, kept apart on purpose:
//  - Advance Salary: money against THIS, still-open month, before it's fully earned. HR approves.
//  - Withdrawal Request: salary already EARNED in a CLOSED month but not yet paid out on the
//    scheduled run, paid early. Nothing to recover. Finance/Admin approve it.
// The month and the ceiling on the amount are decided by the server (it derives the closed month
// and checks the earned-but-unpaid balance) — the client only ever names an amount.
let withdrawalRequests = [];
let myPayroll = [];           // the signed-in employee's own months, newest first
let withdrawalEligibility = null; // last fetch of "what can I withdraw right now"
function mapWithdrawalRequest(r){
  return {
    id:r.id, empId:r.employee.employeeCode, empName:r.employee.name, month:r.month, amount:Number(r.amount),
    requested:isoDate(r.requestedAt), status:TITLECASE_FROM_API(r.status), decidedDate: r.decidedAt?isoDate(r.decidedAt):undefined,
  };
}
async function loadWithdrawalRequests(){ withdrawalRequests = (await apiJson("/api/finance/withdrawal-requests")).requests.map(mapWithdrawalRequest); }
async function loadMyPayroll(){ myPayroll = (await apiJson("/api/hr/payroll/mine")).rows; }
async function loadWithdrawalEligibility(){ withdrawalEligibility = await apiJson("/api/finance/withdrawal-requests/eligibility"); return withdrawalEligibility; }
// A bare Admin login (or any login HR hasn't linked to an employee) has no payroll or requests of
// its own — the server refuses to file anything for it, so the UI shouldn't offer to.
const hasEmployeeRecord = () => !!(currentUser && currentUser._dbId);
const noEmployeeRecordBanner = what => `<div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>This login isn't linked to an employee record, so it has no ${what} of its own. Sign in as a linked employee to raise one, or ask HR to link this account.</div></div>`;

// Employee-facing read view of their own payroll — deliberately three numbers (salary, pay cuts, final
// salary) rather than the internal Basic/HRA/PF/PT breakdown HR/Accounts work with.
function workspacePayroll(){
  if(!currentUser) return '';
  const e = currentUser;
  const latest = myPayroll[0] || null;
  const payCuts = latest ? latest.lopDeduction + (latest.wfhDeduction||0) : 0;

  const myAdvances = advances.filter(a=>a.empId===e.id).map(a=>({type:"Advance", date:a.requested, amount:a.amount, paid:0, balance: a.status==="Recovering"?a.balance:0, status:a.status}));
  const myWithdrawals = withdrawalRequests.filter(w=>w.empId===e.id).map(w=>({type:"Withdrawal", date:w.requested, amount:w.amount, paid: w.status==="Approved"?w.amount:0, balance: w.status==="Pending"?w.amount:0, status: w.status==="Approved"?"Paid":w.status}));
  const order = {Pending:0, Recovering:1, Paid:2, Recovered:2, Rejected:3};
  const myRequests = [...myAdvances, ...myWithdrawals].sort((a,b)=>{
    const oa = order[a.status] ?? 1, ob = order[b.status] ?? 1;
    return oa!==ob ? oa-ob : b.date.localeCompare(a.date);
  });

  return `
  ${hasEmployeeRecord() ? `<div class="toolbar"><div></div><button class="btn primary" onclick="openChooseWithdrawalType()"><svg class="icon" style="width:13px;height:13px"><use href="#i-wallet"/></svg>Withdrawal</button></div>` : noEmployeeRecordBanner("payroll")}
  ${latest ? `
  <div class="panel">
    <div class="panel-head"><h3>${esc(MONTH_LABEL[latest.month]||latest.month)}</h3><div class="sub">Your latest salary</div></div>
    <div class="panel-body">
      <div class="calc-line"><span>Salary</span><span class="mono">${inr(latest.gross)}</span></div>
      <div class="calc-line"><span>Pay cuts</span><span class="mono ${payCuts>0?'':'faint'}" style="${payCuts>0?'color:var(--neg);':''}">${payCuts>0?'−'+inr(payCuts):'none'}</span></div>
      ${latest.lopDeduction>0?`<div class="calc-line" style="padding-left:14px;"><span class="faint" style="font-size:12.5px;">Loss of Pay — ${latest.lopDays} day${latest.lopDays===1?"":"s"} beyond your leave balance</span><span class="mono faint" style="font-size:12.5px;">−${inr(latest.lopDeduction)}</span></div>`:""}
      ${latest.wfhDeduction>0?`<div class="calc-line" style="padding-left:14px;"><span class="faint" style="font-size:12.5px;">WFH — ${latest.wfhExcessDays} day${latest.wfhExcessDays===1?"":"s"} beyond your paid WFH allowance, at 75% pay</span><span class="mono faint" style="font-size:12.5px;">−${inr(latest.wfhDeduction)}</span></div>`:""}
      <div class="calc-line total"><span>Final salary</span><span class="mono">${inr(latest.net)}</span></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;padding-top:10px;border-top:1px solid var(--line);">
        <span class="sub">Payment status</span>
        <div style="display:flex;align-items:center;gap:8px;">${pill(latest.payStatus,statusKind(latest.payStatus))}${latest.balance>0?`<span class="mono faint" style="font-size:12px;">${inr(latest.balance)} pending</span>`:''}</div>
      </div>
    </div>
  </div>` : `<div class="panel"><div class="panel-body"><div class="empty">You haven't been added to a payroll cycle yet — check back once HR sets up your salary for the month.</div></div></div>`}
  ${myPayroll.length ? `
  <div class="panel">
    <div class="panel-head"><h3>History</h3><div class="sub">Every cycle you've been part of</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Month</th><th class="num">Salary</th><th class="num">Pay cuts</th><th class="num">Final salary</th><th>Status</th></tr></thead>
      <tbody>${myPayroll.map(r=>{ const cuts=r.lopDeduction+(r.wfhDeduction||0); return `<tr><td>${esc(MONTH_LABEL[r.month]||r.month)}</td><td class="num mono">${inr(r.gross)}</td><td class="num mono ${cuts>0?'warn':'faint'}">${cuts>0?'−'+inr(cuts):'—'}</td><td class="num mono" style="font-weight:700;">${inr(r.net)}</td><td>${pill(r.payStatus,statusKind(r.payStatus))}</td></tr>`; }).join("")}</tbody>
    </table></div>
  </div>` : ``}
  <div class="panel">
    <div class="panel-head"><h3>Your requests</h3><div class="sub">Advance Salary and Withdrawal Request, together</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Type</th><th class="num">Amount</th><th>Requested</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th></tr></thead>
      <tbody>${myRequests.length ? myRequests.map(r=>`<tr><td><span class="tag type">${esc(r.type)}</span></td><td class="num mono">${inr(r.amount)}</td><td class="muted">${fmtDate(r.date)}</td><td class="num mono">${r.paid>0?inr(r.paid):'—'}</td><td class="num mono">${r.balance>0?inr(r.balance):'—'}</td><td>${pill(r.status,statusKind(r.status))}</td></tr>`).join("") : `<tr><td colspan="6"><div class="empty">No advance or withdrawal requests yet.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
// Entry point for the merged "Withdrawal" button — the employee picks Advance Salary (against this
// month, before it's fully earned) or Withdrawal Request (already-earned salary from a closed month,
// only available when there's actually an unpaid balance to draw against). Eligibility comes fresh
// from the server each time the chooser opens.
async function openChooseWithdrawalType(){
  let eu;
  try{ eu = await loadWithdrawalEligibility(); }catch(err){ toast(err.message || "Couldn't check your withdrawal options"); return; }
  const canWithdraw = eu.requestable > 0;
  showModal(`
    <div class="modal-head"><h3>Withdrawal</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Two different things: Advance Salary is money against this month before it's fully earned — HR-approved, then recovered from your payroll. Withdrawal Request is salary you've already earned in a closed month, just paid out ahead of the scheduled run — nothing to recover.</div></div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button type="button" class="btn ghost" style="height:auto;padding:14px 16px;justify-content:flex-start;text-align:left;" onclick="closeModal();openRequestAdvance();">
          <div><div style="font-weight:700;">Advance Salary</div><div class="sub" style="margin-top:2px;">Against this month, before it's fully earned</div></div>
        </button>
        <button type="button" class="btn ghost" style="height:auto;padding:14px 16px;justify-content:flex-start;text-align:left;${canWithdraw?'':'opacity:0.5;cursor:not-allowed;'}" ${canWithdraw?`onclick="closeModal();openRequestWithdrawal();"`:'disabled'}>
          <div><div style="font-weight:700;">Withdrawal Request</div><div class="sub" style="margin-top:2px;">${canWithdraw?`${inr(eu.requestable)} earned and unpaid from ${esc(MONTH_LABEL[eu.month]||eu.month)}, available now`:'Only available once you have earned salary from a closed month still unpaid'}</div></div>
        </button>
      </div>
    </div>
    <div class="modal-foot"><div></div><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button></div>`);
}
// Request form — reached from the chooser above, which has just refreshed withdrawalEligibility.
function openRequestWithdrawal(){
  const eu = withdrawalEligibility;
  if(!eu || eu.requestable<=0) return;
  showModal(`
    <div class="modal-head"><h3>Request withdrawal — ${esc(MONTH_LABEL[eu.month]||eu.month)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-request-withdrawal-salary"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${inr(eu.requestable)} of your ${esc(MONTH_LABEL[eu.month]||eu.month)} salary is earned and still unpaid. This isn't Advance Salary — nothing is recovered later, it's simply paid out early. Finance approves it.</div></div>
      <div><label class="field-label">Amount to withdraw (₹)</label><input class="field-input" type="number" name="amount" min="1" max="${eu.requestable}" step="0.01" required value="${eu.requestable}"></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Submit request</button></div></div>
    </form>`);
  document.getElementById("f-request-withdrawal-salary").addEventListener("submit", async e=>{
    e.preventDefault();
    const submit = e.target.querySelector('button[type="submit"]');
    submit.disabled = true; // a double-click would otherwise file it twice
    const f = new FormData(e.target);
    try{
      await apiJson("/api/finance/withdrawal-requests", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ amount:Number(f.get("amount")) }) });
      await loadWithdrawalRequests();
      toast("Withdrawal request submitted"); closeModal(); render();
    }catch(err){ submit.disabled = false; toast(err.message || "Couldn't submit withdrawal request"); }
  });
}

// HR/Finance view — parallel to hrAdvances(). HR (who run payroll) can see every request; only
// Finance/Admin can approve or reject, since approving moves real money out.
let withdrawalsMonthFilter = "All";
function setWithdrawalsMonthFilter(v){ withdrawalsMonthFilter = v; render(); }
function hrWithdrawals(){
  const canDecide = isFinanceAdminUser(currentUser);
  const months = [...new Set(withdrawalRequests.map(w=>w.month))].sort().reverse();
  const filtered = withdrawalsMonthFilter==='All' ? withdrawalRequests : withdrawalRequests.filter(w=>w.month===withdrawalsMonthFilter);
  const order = {Pending:0,Approved:1,Rejected:2};
  const sorted = filtered.slice().sort((a,b)=> order[a.status]!==order[b.status] ? order[a.status]-order[b.status] : b.requested.localeCompare(a.requested));
  return `
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Requests against a month that's already closed and fully earned — not a loan like Advance Salary. Approving records an early payment against that month's payroll entry; the scheduled run then only owes whatever's left.${canDecide?'':' Approving or rejecting is Finance/Admin only — you can see everything here but not decide.'}</div></div>
  <div class="toolbar"><div class="filter-group"><span class="filter-label">Month</span><select class="select-sm" onchange="setWithdrawalsMonthFilter(this.value)"><option value="All" ${withdrawalsMonthFilter==='All'?'selected':''}>All time</option>${months.map(m=>`<option value="${m}" ${m===withdrawalsMonthFilter?'selected':''}>${esc(MONTH_LABEL[m]||m)}</option>`).join("")}</select></div><div></div></div>
  <div class="panel">
    <div class="panel-head"><h3>Requests</h3><div class="sub">Approving pays out immediately, against that month's payroll</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Employee</th><th>Month</th><th class="num">Amount</th><th>Requested</th><th>Status</th><th></th></tr></thead>
      <tbody>${sorted.length ? sorted.map(w=>{
        const actions = (w.status==="Pending" && canDecide) ? `<div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm" onclick="decideWithdrawal('${w.id}','Approved')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Approve &amp; pay</button><button class="btn btn-sm danger" onclick="decideWithdrawal('${w.id}','Rejected')">Reject</button></div>` : "";
        return `<tr><td>${esc(w.empName)}<div class="subtext mono">${esc(w.empId)}</div></td><td class="muted">${esc(MONTH_LABEL[w.month]||w.month)}</td><td class="num mono">${inr(w.amount)}</td><td class="muted">${fmtDate(w.requested)}</td><td>${pill(w.status==='Approved'?'Paid':w.status, w.status==='Approved'?'pos':statusKind(w.status))}</td><td>${actions}</td></tr>`;
      }).join("") : `<tr><td colspan="6"><div class="empty">No withdrawal requests${withdrawalsMonthFilter==='All'?'':' for this month'}.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
async function decideWithdrawal(id, decision){
  const w = withdrawalRequests.find(x=>x.id===id);
  try{
    await apiJson(`/api/finance/withdrawal-requests/${id}/${decision==='Approved'?'approve':'reject'}`, { method:"POST" });
    await loadWithdrawalRequests();
    // An approval writes a payroll payment, so refresh that month's payroll view too (HR/Admin only —
    // a Finance-only login has no access to it and doesn't need it).
    if(decision==='Approved' && w && (isHRRole(currentUser) || (currentUser && currentUser.isAdmin))) await loadPayrollMonth(w.month).catch(()=>{});
    toast(decision==="Approved"?"Withdrawal paid out":"Withdrawal request rejected"); render();
  }catch(err){
    toast(err.message || "Couldn't update withdrawal request");
    // "Already decided" means someone else got there first — show the current state.
    if(/already decided/i.test(err.message||"")){ await loadWithdrawalRequests().catch(()=>{}); render(); }
  }
}

/* ===================== BRANDED DOCUMENTS (Quote / Invoice / Payment Receipt) ===================== */
// Dependency-free "download": we open a standalone print-styled page in a new tab and let the browser's
// own Print / Save-as-PDF handle the export — no PDF library, so the output is vector text that matches
// the reference DESGRO documents exactly rather than a canvas screenshot.
function numberToWordsINR(amount){
  const ones = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  function twoDigits(n){ return n<20 ? ones[n] : tens[Math.floor(n/10)] + (n%10 ? " "+ones[n%10] : ""); }
  function threeDigits(n){ const h=Math.floor(n/100), r=n%100; return (h?ones[h]+" Hundred"+(r?" ":""):"") + (r?twoDigits(r):""); }
  let n = Math.round(Math.abs(Number(amount)||0));
  if(n===0) return "Indian Rupee Zero Only";
  const crore = Math.floor(n/10000000); n %= 10000000;
  const lakh = Math.floor(n/100000); n %= 100000;
  const thousand = Math.floor(n/1000); n %= 1000;
  const hundred = n;
  const parts = [];
  if(crore) parts.push(threeDigits(crore)+" Crore");
  if(lakh) parts.push(threeDigits(lakh)+" Lakh");
  if(thousand) parts.push(threeDigits(thousand)+" Thousand");
  if(hundred) parts.push(threeDigits(hundred));
  return "Indian Rupee "+parts.join(" ")+" Only";
}
function openDocumentPrint(bodyHtml, title){
  const w = (typeof window!=="undefined" && window.open) ? window.open('', '_blank') : null;
  if(!w){ toast("Please allow pop-ups to download this document"); return; }
  w.document.open();
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(title)}</title>
  <style>
    *{box-sizing:border-box;}
    body{font-family:Manrope,Arial,sans-serif;color:#1a1a1a;margin:0;background:#f0f0f0;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .print-bar{max-width:760px;margin:18px auto 0;text-align:right;padding:0 8px;}
    .print-bar button{background:#e0292e;color:#fff;border:none;padding:10px 22px;border-radius:6px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit;}
    .page{max-width:760px;margin:16px auto 40px;background:#fff;padding:50px 54px;box-shadow:0 2px 16px rgba(0,0,0,.10);}
    table{border-collapse:collapse;}
    .mono{font-variant-numeric:tabular-nums;}
    @media print{ .print-bar{display:none;} body{background:#fff;} .page{box-shadow:none;margin:0;padding:0;max-width:none;} @page{size:A4;margin:14mm;} }
  </style></head><body>
  <div class="print-bar"><button onclick="window.print()">Print / Save as PDF</button></div>
  <div class="page">${bodyHtml}</div>
  </body></html>`);
  w.document.close();
}
function desgroHeaderHTML(docTitle){
  return `
  <div style="display:flex;justify-content:space-between;align-items:flex-start;">
    <div>
      <div style="width:64px;height:6px;background:#e0292e;margin-bottom:8px;"></div>
      <div style="font-size:32px;font-weight:800;letter-spacing:-0.5px;line-height:1;color:#111;">DESGRO</div>
      <div style="font-size:10.5px;letter-spacing:3.5px;color:#666;margin-top:4px;">MEDIA</div>
    </div>
    <div style="text-align:right;font-size:12px;line-height:1.65;color:#444;">
      <div style="font-weight:700;color:#111;">DESGRO INTERNATIONAL LLP</div>
      <div>CALICUT Kerala 673582</div>
      <div>India</div>
      <div>7736328234</div>
      <div>hi@desgrocreatives.com</div>
      <div>https://desgrocreatives.com/</div>
    </div>
  </div>
  <div style="border-top:1px solid #e2e2e2;margin:22px 0 20px;"></div>
  <div style="display:flex;align-items:center;gap:18px;margin-bottom:30px;">
    <div style="flex:1;border-top:1px solid #d5d5d5;"></div>
    <div style="font-size:19px;font-weight:800;letter-spacing:4px;color:#111;">${esc(docTitle)}</div>
    <div style="flex:1;border-top:1px solid #d5d5d5;"></div>
  </div>`;
}
function desgroReceiptHeaderHTML(){
  return `
  <div style="display:flex;justify-content:space-between;align-items:flex-start;">
    <div>
      <div style="width:64px;height:6px;background:#e0292e;margin-bottom:8px;"></div>
      <div style="font-size:32px;font-weight:800;letter-spacing:-0.5px;line-height:1;color:#111;">DESGRO</div>
      <div style="font-size:10.5px;letter-spacing:3.5px;color:#666;margin-top:4px;">MEDIA</div>
    </div>
    <div style="text-align:right;font-size:11.5px;line-height:1.65;color:#888;">
      <div style="font-weight:700;color:#555;">DESGRO INTERNATIONAL LLP</div>
      <div>CALICUT Kerala 673582, India</div>
      <div>7736328234</div>
      <div>hi@desgrocreatives.com</div>
    </div>
  </div>
  <div style="border-top:1px solid #e2e2e2;margin:22px 0 20px;"></div>
  <div style="text-align:center;margin-bottom:30px;">
    <div style="display:inline-block;font-size:19px;font-weight:800;letter-spacing:4px;color:#111;border-bottom:2px solid #111;padding-bottom:6px;">PAYMENT RECEIPT</div>
  </div>`;
}
function desgroItemsTableHTML(items){
  return `
  <table style="width:100%;font-size:12.5px;margin-top:6px;">
    <thead><tr style="background:#f6f6f6;">
      <th style="text-align:left;padding:10px 12px;border-bottom:2px solid #222;width:34px;">#</th>
      <th style="text-align:left;padding:10px 12px;border-bottom:2px solid #222;">Description</th>
      <th style="text-align:right;padding:10px 12px;border-bottom:2px solid #222;">Amount</th>
    </tr></thead>
    <tbody>${items.map((it,i)=>`<tr><td style="padding:9px 12px;border-bottom:1px solid #eee;">${i+1}</td><td style="padding:9px 12px;border-bottom:1px solid #eee;">${esc(it.dept)}</td><td class="mono" style="padding:9px 12px;border-bottom:1px solid #eee;text-align:right;">${inr(it.amount)}</td></tr>`).join('')}</tbody>
  </table>`;
}
function desgroBankDetailsHTML(){
  return `
  <div style="margin-top:26px;font-size:12px;line-height:1.75;color:#333;">
    <div style="font-weight:700;color:#111;margin-bottom:4px;">Bank Details</div>
    <div>DESGRO INTERNATIONAL LLP</div>
    <div>ACCOUNT No :924020025078319</div>
    <div>IFSC:UTIB0003585</div>
    <div>SWIFT : AXISINBB</div>
  </div>`;
}
const DESGRO_TERMS = "Payment due within 7 days of the document date unless otherwise agreed. Work commences / continues on receipt of payment where advance billing applies. All services are subject to DesGro Media's standard terms of engagement. For billing queries, contact hi@desgrocreatives.com.";
function desgroSignatureHTML(){
  return `
  <div style="margin-top:44px;text-align:right;">
    <div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:25px;color:#333;margin-bottom:2px;">DesGro</div>
    <div style="border-top:1px solid #999;width:180px;margin-left:auto;padding-top:6px;font-size:11.5px;color:#555;">Authorized Signature</div>
  </div>`;
}
function quoteDocumentHTML(q){
  const party = quoteParty(q);
  const total = quoteTotal(q);
  return desgroHeaderHTML("QUOTE") + `
  <div style="display:flex;justify-content:space-between;margin-bottom:26px;font-size:12.5px;">
    <div>
      <div style="font-size:10.5px;letter-spacing:1px;color:#888;text-transform:uppercase;margin-bottom:4px;">Quote For</div>
      <div style="font-weight:700;font-size:14px;color:#111;">${esc(party.name)}</div>
    </div>
    <div style="text-align:right;">
      <div><span style="color:#888;">Quote #</span> <b>${esc(q.id)}</b></div>
      <div><span style="color:#888;">Date</span> <b>${fmtDate(q.createdDate)}</b></div>
    </div>
  </div>
  ${desgroItemsTableHTML(q.items)}
  <div style="display:flex;justify-content:flex-end;margin-top:14px;">
    <div style="width:260px;font-size:13px;">
      <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:2px solid #222;font-weight:800;font-size:15px;"><span>Total</span><span class="mono">${inr(total)}</span></div>
    </div>
  </div>
  <div style="margin-top:8px;font-size:11.5px;color:#666;">Total In Words: <b>${numberToWordsINR(total)}</b></div>
  ${desgroBankDetailsHTML()}
  <div style="margin-top:18px;font-size:11px;color:#777;line-height:1.6;"><b>Terms &amp; Conditions</b><br>${DESGRO_TERMS}</div>
  ${desgroSignatureHTML()}`;
}
function invoiceDocumentHTML(inv){
  const client = clientById(inv.clientId);
  const total = invoiceTotal(inv), paid = invoicePaid(inv), bal = invoiceBalance(inv);
  return desgroHeaderHTML("INVOICE") + `
  <div style="display:flex;justify-content:space-between;margin-bottom:26px;font-size:12.5px;">
    <div>
      <div style="font-size:10.5px;letter-spacing:1px;color:#888;text-transform:uppercase;margin-bottom:4px;">Bill To</div>
      <div style="font-weight:700;font-size:14px;color:#111;">${esc(client.name)}</div>
    </div>
    <div style="text-align:right;">
      <div><span style="color:#888;">Invoice #</span> <b>${esc(inv.invoiceNo)}</b></div>
      <div><span style="color:#888;">Issued</span> <b>${fmtDate(inv.issued)}</b></div>
      <div><span style="color:#888;">Due</span> <b>${fmtDate(inv.due)}</b></div>
    </div>
  </div>
  ${desgroItemsTableHTML(inv.items||[])}
  <div style="display:flex;justify-content:flex-end;margin-top:14px;">
    <div style="width:260px;font-size:13px;">
      <div style="display:flex;justify-content:space-between;padding:6px 0;"><span>Subtotal</span><span class="mono">${inr(total)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:2px solid #222;font-weight:800;font-size:15px;"><span>Total</span><span class="mono">${inr(total)}</span></div>
      ${paid>0?`<div style="display:flex;justify-content:space-between;padding:6px 0;color:#0a7a4a;"><span>Payment Made</span><span class="mono">-${inr(paid)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-weight:700;"><span>Balance Due</span><span class="mono">${inr(bal)}</span></div>`:''}
    </div>
  </div>
  <div style="margin-top:8px;font-size:11.5px;color:#666;">Total In Words: <b>${numberToWordsINR(total)}</b></div>
  ${desgroBankDetailsHTML()}
  <div style="margin-top:18px;font-size:11px;color:#777;line-height:1.6;"><b>Terms &amp; Conditions</b><br>${DESGRO_TERMS}</div>
  ${desgroSignatureHTML()}`;
}
function paymentReceiptDocumentHTML(inv, payment){
  const client = clientById(inv.clientId);
  const accName = payment.accountId ? ((bankById(payment.accountId)||{}).name||payment.accountId) : '';
  const mode = payment.accountId==='BANK-03' ? 'Cash' : ('Bank Transfer'+(accName?' — '+accName:''));
  const ref = payment.ref || ("DG-RCPT-"+inv.invoiceNo+"-"+((inv.payments||[]).indexOf(payment)+1));
  return desgroReceiptHeaderHTML() + `
  <div style="display:flex;justify-content:space-between;gap:24px;margin-bottom:26px;">
    <div style="flex:1;">
      <div style="font-size:10.5px;letter-spacing:1px;color:#888;text-transform:uppercase;margin-bottom:6px;">Received From</div>
      <div style="font-weight:700;font-size:14px;color:#111;">${esc(client.name)}</div>
    </div>
    <div style="flex:1;background:#eafaf0;border:1px solid #bfe8cf;border-radius:8px;padding:16px 18px;text-align:right;">
      <div style="font-size:10.5px;letter-spacing:1px;color:#227a4d;text-transform:uppercase;margin-bottom:4px;">Amount Received</div>
      <div class="mono" style="font-size:24px;font-weight:800;color:#166534;">${inr(payment.amount)}</div>
    </div>
  </div>
  <div style="font-size:12.5px;line-height:2;margin-bottom:22px;">
    <div style="display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:6px 0;"><span style="color:#888;">Payment Date</span><b>${fmtDate(payment.date)}</b></div>
    <div style="display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:6px 0;"><span style="color:#888;">Reference Number</span><b>${esc(ref)}</b></div>
    <div style="display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:6px 0;"><span style="color:#888;">Payment Mode</span><b>${esc(mode)}</b></div>
    <div style="display:flex;justify-content:space-between;padding:6px 0;"><span style="color:#888;">Amount In Words</span><b>${numberToWordsINR(payment.amount)}</b></div>
  </div>
  <div style="font-size:10.5px;letter-spacing:1px;color:#888;text-transform:uppercase;margin-bottom:8px;">Payment For</div>
  <table style="width:100%;font-size:12.5px;margin-bottom:10px;">
    <thead><tr style="background:#f6f6f6;">
      <th style="text-align:left;padding:9px 12px;border-bottom:2px solid #222;">Invoice Number</th>
      <th style="text-align:left;padding:9px 12px;border-bottom:2px solid #222;">Date</th>
      <th style="text-align:right;padding:9px 12px;border-bottom:2px solid #222;">Invoice Amount</th>
      <th style="text-align:right;padding:9px 12px;border-bottom:2px solid #222;">Payment Amount</th>
    </tr></thead>
    <tbody><tr>
      <td style="padding:9px 12px;border-bottom:1px solid #eee;">${esc(inv.invoiceNo)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #eee;">${fmtDateShort(inv.issued)}</td>
      <td class="mono" style="padding:9px 12px;border-bottom:1px solid #eee;text-align:right;">${inr(invoiceTotal(inv))}</td>
      <td class="mono" style="padding:9px 12px;border-bottom:1px solid #eee;text-align:right;">${inr(payment.amount)}</td>
    </tr></tbody>
  </table>
  ${desgroSignatureHTML()}`;
}
function downloadQuote(id){
  const q = quotes.find(x=>x.id===id);
  if(!q) return;
  openDocumentPrint(quoteDocumentHTML(q), "Quote — "+q.id);
}
function downloadInvoice(id){
  const inv = invoices.find(x=>x.id===id);
  if(!inv) return;
  openDocumentPrint(invoiceDocumentHTML(inv), "Invoice — "+inv.invoiceNo);
}
function downloadReceipt(invId, paymentIdx){
  const inv = invoices.find(x=>x.id===invId);
  const payment = inv && inv.payments[paymentIdx];
  if(!payment){ toast("Payment not found"); return; }
  openDocumentPrint(paymentReceiptDocumentHTML(inv, payment), "Receipt — "+inv.invoiceNo);
}
function openInvoicePayments(invId){
  const inv = invoices.find(x=>x.id===invId);
  const client = clientById(inv.clientId);
  showModal(`
    <div class="modal-head"><h3>Payments — ${esc(inv.invoiceNo)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${esc(client.name)} · ${(inv.payments||[]).length} payment${(inv.payments||[]).length===1?'':'s'} recorded against ${esc(inv.invoiceNo)}</div></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th class="num">Amount</th><th>Account</th><th>Note</th><th></th></tr></thead>
        <tbody>${(inv.payments||[]).map((p,idx)=>`<tr><td class="muted">${fmtDate(p.date)}</td><td class="num mono">${inr(p.amount)}</td><td class="muted">${esc(p.accountId?((bankById(p.accountId)||{}).name||p.accountId):'—')}</td><td class="muted">${esc(p.note||'—')}</td><td><button class="btn btn-sm ghost" onclick="downloadReceipt('${inv.id}',${idx})"><svg class="icon" style="width:12px;height:12px"><use href="#i-download"/></svg>Receipt</button></td></tr>`).join("") || `<tr><td colspan="5"><div class="empty">No payments recorded yet.</div></td></tr>`}</tbody>
      </table></div>
    </div>
    <div class="modal-foot"><div></div><div><button class="btn ghost" onclick="closeModal()">Close</button></div></div>`);
}

/* ---- Chart of Accounts ---- */
// Accounts can nest one level: a "main" account (no parent) carries the Asset/Liability/Income/Expense
// classification, and a "sub-account" (parent set to a main account's name) rolls up under it and always
// shares its parent's type — e.g. every employee's own salary line is a sub-account of "Salaries".
// Reclassify a main account here and everything under it, plus everything in Payables/Expenses using
// its name, regroups in Reports automatically. Payroll (Salaries & Wages) itself is always included in
// P&L since it's sourced directly from Payroll, not from these sub-accounts (see acctChartOfAccounts()).
const COA_TYPES = ["Asset","Liability","Income","Expense"];
// Chart of accounts keeps its old {name,type} / {name,parent} shape — every
// downstream render function (acctChartOfAccounts, journalAccountOptions,
// coaTypeOf...) matches by exact name, same as the old prototype. `_dbId`
// carries the real uuid for API calls.
let coaDbIdByName = {};
async function loadChartOfAccounts(){
  const list = (await apiJson("/api/finance/coa")).accounts;
  const nameById = Object.fromEntries(list.map(a=>[a.id, a.name]));
  coaDbIdByName = Object.fromEntries(list.map(a=>[a.name, a.id]));
  chartOfAccounts = list.map(a=>({ name:a.name, type:TITLECASE_FROM_API(a.type), parent: a.parentId ? nameById[a.parentId] : undefined, _dbId:a.id }));
}
function coaTypeOf(name){
  const a = chartOfAccounts.find(c=>c.name===name);
  if(!a) return "Expense";
  return a.parent ? coaTypeOf(a.parent) : (a.type || "Expense");
}
async function setCoaType(name, type){
  const a = chartOfAccounts.find(c=>c.name===name);
  if(!a || a.parent) return;
  try{
    await apiJson(`/api/finance/coa/${a._dbId}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ type: TITLECASE_TO_API(type) }) });
    await loadChartOfAccounts();
    toast(name+" reclassified as "+type); render();
  }catch(err){ toast(err.message || "Couldn't reclassify account"); }
}
async function removeCoaAccount(name){
  const a = chartOfAccounts.find(c=>c.name===name);
  if(!a) return;
  try{
    await Auth.apiFetch(`/api/finance/coa/${a._dbId}`, { method:"DELETE" });
    await loadChartOfAccounts();
    toast("Removed "+name); render();
  }catch(err){ toast("Couldn't remove "+name+" — it may have journal history against it"); }
}

// Journal entries are append-only per the project brief (no update/delete
// endpoint exists) — the old prototype's editable entries were a straight
// port away from real accounting practice, fixed here rather than kept.
function mapJournalEntry(j){
  return {
    id: j.id, date: isoDate(j.date), memo: j.memo,
    lines: j.lines.map(l=>({ account: l.coaAccountId ? "coa:"+l.coaAccountId : "bank:"+l.bankAccountId, side: l.side.toLowerCase(), amount: Number(l.amount) })),
  };
}
async function loadJournalEntries(){ journalEntries = (await apiJson("/api/finance/journal")).entries.map(mapJournalEntry); }
function journalAccountLabel(value){
  if(value.startsWith("bank:")) return bankById(value.slice(5)).name;
  const id = value.slice(4);
  const acc = chartOfAccounts.find(c=>c._dbId===id);
  return acc ? acc.name : "(removed account)";
}
function journalAccountOptions(selected){
  const bankOpts = bankAccounts.map(b=>`<option value="bank:${b.id}" ${selected==='bank:'+b.id?'selected':''}>${esc(b.name)} (Bank)</option>`);
  const coaOpts = [];
  chartOfAccounts.filter(c=>!c.parent && c.name!=="Bank Balances").forEach(m=>{
    coaOpts.push(`<option value="coa:${m._dbId}" ${selected==='coa:'+m._dbId?'selected':''}>${esc(m.name)} (${m.type})</option>`);
    chartOfAccounts.filter(c=>c.parent===m.name).forEach(k=>coaOpts.push(`<option value="coa:${k._dbId}" ${selected==='coa:'+k._dbId?'selected':''}>&nbsp;&nbsp;↳ ${esc(k.name)}</option>`));
  });
  return bankOpts.concat(coaOpts).join("");
}
// Category options for logging an expense — every Chart-of-Accounts main
// account classified as Expense or Liability (with its sub-accounts
// indented beneath), so a logged expense always lands on a real COA account
// instead of the old fixed 5-option list that could drift out of sync with
// whatever Settings > Chart of Accounts actually has. Value is the account
// _dbId (resolved back to a name via coaDbIdByName's inverse at submit) so
// the option list matches journalAccountOptions' id-based selection.
function expenseCoaOptions(selectedId){
  const opts = [];
  chartOfAccounts.filter(c=>!c.parent && (c.type==="Expense"||c.type==="Liability")).forEach(m=>{
    opts.push(`<option value="${m._dbId}" ${selectedId===m._dbId?'selected':''}>${esc(m.name)}</option>`);
    chartOfAccounts.filter(c=>c.parent===m.name).forEach(k=>opts.push(`<option value="${k._dbId}" ${selectedId===k._dbId?'selected':''}>&nbsp;&nbsp;↳ ${esc(k.name)}</option>`));
  });
  return opts.join("");
}

/* ===================== ACCOUNTS — REPORTS (server-computed) =====================
   computePL/computeBalanceSheet/deptProfitability now just read a cache the
   server has already fully computed (same pattern as Phase 2's payroll rows)
   instead of recalculating from raw records client-side — including reading
   across into HR's payroll data, which only the server can do directly. */
let financeReportsCache = { pl: {}, bs: {}, deptProfit: {} };
async function loadFinanceReports(month){
  const [pl, bs, dp] = await Promise.all([
    apiJson(`/api/finance/reports/pl?month=${month}`),
    apiJson(`/api/finance/reports/balance-sheet?month=${month}`),
    apiJson(`/api/finance/reports/dept-profitability?month=${month}`),
  ]);
  financeReportsCache.pl[month] = pl;
  financeReportsCache.bs[month] = bs;
  financeReportsCache.deptProfit[month] = dp;
}
// Revenue in the reports only changes when Finance approves/records a payment, and those reports are
// cached per month — so after any such action, drop every cached month and refetch the one on screen.
async function refreshFinanceReports(){
  financeReportsCache = { pl: {}, bs: {}, deptProfit: {} };
  await loadFinanceReports(payroll.selectedMonth);
}
function computePL(month){
  const r = financeReportsCache.pl[month];
  if(!r) return { month, income:0, invoicedIncome:0, incomeDetail:[], journalIncome:0, lines:[], totalExpense:0, netProfit:0, commissionBySales:{} };
  return {
    ...r,
    incomeDetail: r.incomeDetail.map(d=>({ desc: (clientById(d.clientId)?.name||d.clientId)+" — "+d.invoiceNo, amount:d.amount, date:isoDate(d.date) })),
    lines: r.lines.map(l=>({ name:l.name, amount:l.amount, detail:(l.detail||[]).map(x=>({desc:x.desc, amount:x.amount, date:x.date?isoDate(x.date):null})) })),
  };
}
function computeBalanceSheet(month){
  const r = financeReportsCache.bs[month];
  if(!r) return { asOf:TODAY, cashAndBank:[], cashAndBankTotal:0, receivable:0, receivableDetail:[], otherAssetAdj:0, totalAssets:0, payrollPayable:0, payrollPayableDetail:[], payableLines:[], accountsPayable:0, internalLoan:0, internalLoanDetail:[], journalLiabilityAdj:0, totalLiabilities:0, equity:0 };
  return {
    ...r,
    receivableDetail: r.receivableDetail.map(d=>({ desc:d.invoiceNo, amount:d.balance })),
    payrollPayableDetail: r.payrollPayableDetail.map(d=>({ desc:d.name, amount:d.balance })),
    internalLoanDetail: r.internalLoanDetail.map(d=>({ desc:d.payee, amount:d.balance })),
    payableLines: r.payableLines.map(l=>({ ...l, detail:(l.detail||[]).map(x=>({desc:x.desc, amount:x.amount, date:x.date?isoDate(x.date):null})) })),
  };
}
function deptProfitability(month){
  const r = financeReportsCache.deptProfit[month];
  if(!r) return { rows:[], overheadPayroll:0, overheadHeadcount:0, rent:0, sharedExpenses:0, overheadPool:0, totalHeadcount:0, perHeadOverhead:0 };
  return r;
}

// currentUser.roles is the raw backend role list, set alongside .isAdmin in
// the INIT block — separate from isHRRole()/isSalesRole(), which match on
// the display-only .role/.dept strings the HR preview logic uses.
function isFinanceAdminUser(u){ return !!(u && (u.isAdmin || (u.roles||[]).includes('FINANCE'))); }

async function loadFinanceModule(){
  const admin = isFinanceAdminUser(currentUser);
  const roles = (currentUser && currentUser.roles) || [];
  if(admin){
    await Promise.all([loadBankAccounts(), loadChartOfAccounts()]);
    await Promise.all([loadInvoices(), loadPayables(), loadExpenses(), loadJournalEntries(), loadCommissionWithdrawals(), loadPendingAdvanceDisbursements(), loadSalesPolicy(), loadSalesTargets()]);
    await loadFinanceReports(payroll.selectedMonth);
  } else if(roles.includes('SALES') || roles.includes('SALES_HEAD')){
    // Sales' narrow slice: their own invoices, their own Commission/Sales
    // Bonus payables (server now scopes listPayables to just those two
    // categories + their own name for a non-admin caller — previously this
    // never loaded at all, which silently zeroed out commissionRowsByPerson()
    // everywhere it's used on this workspace), and their own withdrawals.
    // No expenses/banks/COA/other payable categories.
    await Promise.all([loadInvoices(), loadPayables(), loadCommissionWithdrawals(), loadSalesTargets()]);
  }
  // Every other role (HR-only, Content-only, base Employee...) has no
  // Finance module access at all — visibleModules() already hides the nav,
  // this just avoids firing requests the server would 403 anyway.
}

/* ===================== NAV MODEL ===================== */
const MODULES = [
  {id:"dashboard", label:"Dashboard", icon:"i-home"},
  {id:"workspace", label:"My Workspace", icon:"i-briefcase", sub:[
    {id:"overview", label:"Overview", icon:"i-trend"},
    {id:"tasks", label:"My Tasks", icon:"i-board", count:()=>currentUser?clientTasks.filter(t=>t.assignedTo===currentUser.name && t.status!=="Done").length:0},
    {id:"attendance", label:"My Attendance", icon:"i-attendance"},
    {id:"leave", label:"Leave", icon:"i-leave", count:()=>currentUser?leaveRequests.filter(l=>l.empId===currentUser.id && l.status==="Pending").length:0},
    {id:"payroll", label:"My Payroll", icon:"i-wallet", count:()=>currentUser?advances.filter(a=>a.empId===currentUser.id && a.status==="Pending").length + withdrawalRequests.filter(w=>w.empId===currentUser.id && w.status==="Pending").length:0},
    {id:"payments", label:"Payment Requests", icon:"i-receipt", count:()=>currentUser?paymentRequests.filter(r=>r.empId===currentUser.id && r.status==="Pending").length:0},
    {id:"complaints", label:"Complaints", icon:"i-megaphone"},
  ]},
  {id:"hr", label:"HR", icon:"i-users", sub:[
    {id:"overview", label:"Overview", icon:"i-trend"},
    {id:"directory", label:"Directory", icon:"i-users"},
    {id:"attendance", label:"Attendance", icon:"i-attendance"},
    {id:"leave", label:"Leave Requests", icon:"i-leave", count:()=>leaveRequests.filter(l=>l.status==="Pending").length},
    {id:"hiring", label:"Hiring", icon:"i-target", count:()=>openPositions.filter(p=>p.status==="Open").length},
    {id:"payroll", label:"Payroll", icon:"i-wallet"},
    {id:"advances", label:"Advance Salary", icon:"i-coins", count:()=>advances.filter(a=>a.status==="Pending").length},
    {id:"withdrawals", label:"Withdrawal Requests", icon:"i-wallet", count:()=>withdrawalRequests.filter(w=>w.status==="Pending").length},
    {id:"complaints", label:"Complaints", icon:"i-megaphone", count:()=>complaints.filter(c=>c.status==="New").length},
    {id:"notices", label:"Notices", icon:"i-bell"},
    {id:"policies", label:"HR Settings", icon:"i-sliders"},
  ]},
  {id:"marketing", label:"Marketing and Sales", icon:"i-megaphone", sub:[
    {id:"overview", label:"Overview", icon:"i-trend"},
    {id:"content", label:"Content", icon:"i-board"},
    {id:"performance", label:"Meta Ads", icon:"i-target"},
    {id:"leads", label:"Leads", icon:"i-users", count:()=>marketingLeads.filter(l=>!l.leadOwner).length},
    {id:"quotes", label:"Quotes", icon:"i-handshake", count:()=>quotes.filter(q=>q.status==="Sent").length},
    {id:"invoices", label:"Invoices", icon:"i-receipt", count:()=>clientsMissingInvoice().length},
  ]},
  {id:"clients", label:"Clients", icon:"i-briefcase", sub:[
    {id:"overview", label:"Overview", icon:"i-trend"},
    {id:"all", label:"All Clients", icon:"i-briefcase"},
  ]},
  {id:"accounts", label:"Accounts", icon:"i-wallet", sub:[
    {id:"overview", label:"Overview", icon:"i-trend"},
    {id:"invoices", label:"Invoices", icon:"i-receipt", count:()=>invoices.filter(i=>invoiceStatus(i)==="Overdue").length},
    {id:"receipts", label:"Payment Receipts", icon:"i-receipt", count:()=>pendingSalesPayments().length},
    {id:"requests", label:"Payment Requests", icon:"i-coins", count:()=>pendingAdvanceDisbursements.length+pendingPaymentRequests().length},
    {id:"payroll", label:"Payroll", icon:"i-wallet", count:()=>{ const m = payroll.history[payroll.selectedMonth]; return m ? employees.filter(e=>e.dept!=='Sales' && !(e.id in m.entries)).length : 0; }},
    {id:"payables", label:"Payables", icon:"i-coins", count:()=>payables.filter(p=>payableStatus(p)!=="Paid").length},
    {id:"expenses", label:"Expenses", icon:"i-file"},
    {id:"banks", label:"Banks", icon:"i-building"},
    {id:"quotes", label:"Quotes", icon:"i-handshake", count:()=>quotes.filter(q=>q.status==="Submitted to Finance").length},
    {id:"commissions", label:"Commissions", icon:"i-percent", count:()=>payables.filter(p=>p.category==="Commission" && payableBalance(p)>0).length},
    {id:"coa", label:"Chart of Accounts", icon:"i-sliders"},
    {id:"journal", label:"Journal", icon:"i-edit"},
    {id:"reports", label:"Reports", icon:"i-file"},
  ]},
];
let nav = {module:"dashboard", sub:{workspace:"overview", hr:"overview", marketing:"overview", clients:"overview", accounts:"overview"}, detail:null};

// An "HR Executive" (role containing "HR") only manages HR — hiring, attendance, leave, payroll,
// advances, complaints, policies — so their sidebar shows nothing else. Their payroll work already
// flows into Accounts (payroll cost/payable in P&L & Balance Sheet, sales excluded per commission
// model) without them needing the Accounts module itself — see computePL()/computeBalanceSheet().
// Prefers the real backend roles array (authoritative — and immune to a free-text job title like
// "Chief HR Officer" colliding with the leadership check below); the /HR/i title regex is only a
// fallback for the rare case .roles isn't set yet.
function isHRRole(emp){ return !!(emp && (emp.roles ? emp.roles.includes('HR') : /HR/i.test(emp.role||""))); }
// Leadership (founders/CXOs) keep full, unrestricted access — same as the pre-login default.
function isLeadershipRole(emp){ return !!(emp && (emp.isAdmin || /\b(CEO|COO|CMO|CTO|CFO|Chief|Founder)\b/i.test(emp.role||""))); }
// Sales gets its own restricted view: My Workspace (attendance, commission, leaderboard — see
// SALES_WORKSPACE_SUB) + Clients + Marketing and Sales, with full quotes/invoices/payment visibility
// there (unlike Staff) since that's their day-to-day. No Dashboard, HR or Accounts.
// Same real-roles preference as isHRRole above — an Employee's display dept and their User.roles
// grant are independently editable and can otherwise drift out of sync.
function isSalesRole(emp){ return !!(emp && (emp.roles ? (emp.roles.includes('SALES') || emp.roles.includes('SALES_HEAD')) : emp.dept==='Sales')); }
// The one Sales Head oversees the whole team: same restricted sidebar as Sales, but the server hands
// them every lead/client/quote/invoice (not just their own book), so the "My …" labels and the
// own-leads-only filters below don't apply to them.
function isSalesHeadRole(emp){ return !!(emp && emp.roles && emp.roles.includes('SALES_HEAD')); }
// A plain Sales rep — Sales, but not the head and not Leadership/Admin (a COO who also holds the Sales
// role still gets everyone's data from the server, so the own-book filters must not hide it) — sees only
// their own book.
function isSalesRepRole(emp){ return isSalesRole(emp) && !isSalesHeadRole(emp) && !isLeadershipRole(emp); }
// Everyone else (marketing/production/design/dev/account-management — the people who work on DesGro's
// own client delivery) gets the restricted "Staff" view: My Workspace + Clients + Marketing and Sales,
// with no payment/financial detail and no Accounts/HR.
function isStaffRole(emp){ return !!emp && !isHRRole(emp) && !isLeadershipRole(emp) && !isSalesRole(emp); }
// A Sales sign-in's "My Workspace" is about their own performance, not client delivery work — swapped
// in for the default (Staff-flavored) workspace sub-array by visibleModules() below.
const SALES_WORKSPACE_SUB = [
  {id:"overview", label:"Overview", icon:"i-trend"},
  {id:"attendance", label:"My Attendance", icon:"i-attendance"},
  {id:"leave", label:"Leave", icon:"i-leave", count:()=>currentUser?leaveRequests.filter(l=>l.empId===currentUser.id && l.status==="Pending").length:0},
  {id:"payments", label:"Payment Requests", icon:"i-receipt", count:()=>currentUser?paymentRequests.filter(r=>r.empId===currentUser.id && r.status==="Pending").length:0},
  {id:"commission", label:"My Commission", icon:"i-percent", count:()=>currentUser?payables.filter(p=>p.category==="Commission" && p.salesPerson===currentUser.name && payableBalance(p)>0).length:0},
  {id:"leaderboard", label:"Leaderboard", icon:"i-target"},
  {id:"complaints", label:"Complaints", icon:"i-megaphone"},
];
function visibleModules(){
  // Leadership/Admin must win ties — someone can legitimately hold both HR
  // and ADMIN (or any other combination), and Admin always means full,
  // unrestricted access regardless of what else is checked.
  if(currentUser && isLeadershipRole(currentUser)) return MODULES;
  if(currentUser && isHRRole(currentUser)){
    // HR-only sign-ins never see My Workspace, so the personal Payment Requests tab
    // (any employee can raise one) lives here for them.
    const paymentsSub = {id:"payments", label:"Payment Requests", icon:"i-receipt", count:()=>currentUser?paymentRequests.filter(r=>r.empId===currentUser.id && r.status==="Pending").length:0};
    return MODULES.filter(m=>m.id==='hr').map(m=>({...m, sub:[...m.sub, paymentsSub]}));
  }
  if(currentUser && isSalesRole(currentUser)){
    const order = ['workspace','clients','marketing'];
    return order.map(id=>MODULES.find(m=>m.id===id)).filter(Boolean).map(m=>
      m.id==='workspace' ? {...m, sub:SALES_WORKSPACE_SUB} : m
    );
  }
  // Content role: only their own HR self-service plus Marketing's Content
  // Pipeline tab — no Clients, no Leads/Quotes/Invoices. Checked via the
  // real backend role list (Content-team employees have ordinary depts like
  // "Production"/"Marketing Consultation", so isStaffRole's dept-based
  // heuristic can't tell them apart — this can't be display-string-based).
  if(currentUser && (currentUser.roles||[]).includes('CONTENT')){
    const marketing = MODULES.find(m=>m.id==='marketing');
    const contentOnly = {...marketing, sub: marketing.sub.filter(s=>s.id==='content')};
    return [MODULES.find(m=>m.id==='workspace'), contentOnly];
  }
  if(currentUser && isStaffRole(currentUser)){
    // Base Employee with no elevated department role: only their own HR
    // self-service — no Clients/Marketing at all. A deliberate tightening
    // versus the old prototype (whose "Staff" catch-all let any non-HR,
    // non-Sales employee browse Marketing/Clients) to match the brief's
    // ACCESS MODEL, which the server now actually enforces — CRM requires
    // SALES, Content Pipeline requires CONTENT, and there's no fallback.
    return [MODULES.find(m=>m.id==='workspace')];
  }
  return MODULES;
}
// Data is otherwise loaded once at page load, so a request someone else just raised wouldn't show up
// until a reload. Tabs that hold other people's actionable requests re-fetch each time they're opened.
const TAB_REFRESH = {
  "workspace/payments":[loadPaymentRequests], "hr/payments":[loadPaymentRequests], "accounts/requests":[loadPaymentRequests, loadPendingAdvanceDisbursements],
  "workspace/payroll":[loadWithdrawalRequests, loadMyPayroll], "hr/withdrawals":[loadWithdrawalRequests],
  // Finance sees what Sales just pushed without a reload; Overview always reflects the latest approvals.
  // Quotes live behind CRM access, so a Finance-only sign-in (no CRM role) skips that fetch.
  "accounts/receipts":[loadInvoices, ()=>canLoadQuotes()?loadQuotes():null, ()=>isFinanceAdminUser(currentUser)?loadApprovedReceipts():null],
  "accounts/overview":[()=>isFinanceAdminUser(currentUser)?refreshFinanceReports():null],
};
function canLoadQuotes(){ return !!(currentUser && (currentUser.isAdmin || (currentUser.roles||[]).some(r=>r==='SALES'||r==='SALES_HEAD'))); }
function refreshTab(mid, sid){
  const jobs = TAB_REFRESH[mid+"/"+sid];
  if(!jobs) return;
  Promise.all(jobs.map(j=>j())).then(()=>{ if(nav.module===mid && nav.sub[mid]===sid && !nav.detail) render(); }).catch(err=>console.error("Couldn't refresh "+mid+"/"+sid, err));
}
function setModule(id){ if(!visibleModules().some(m=>m.id===id)) return; nav.module=id; nav.detail=null; render(); refreshTab(id, nav.sub[id]); }
function setSub(mid, sid){ const mods=visibleModules(); const mod=mods.find(m=>m.id===mid); if(!mod) return; if(mod.sub && !mod.sub.some(s=>s.id===sid)) return; nav.module=mid; nav.sub[mid]=sid; nav.detail=null; render(); refreshTab(mid, sid); }
function closeDetail(){ nav.detail=null; render(); }

function renderNav(){
  const mods = visibleModules();
  let html;
  if(mods.length===1 && mods[0].sub){
    // Only one module visible (e.g. an HR-restricted sign-in, or a build dedicated to a single
    // module) — the module header would just be a redundant, unclickable label, so skip it and
    // promote its sections straight to the top level instead.
    const m = mods[0];
    html = m.sub.map(s=>{
      const active = nav.sub[m.id]===s.id;
      const c = s.count ? s.count() : 0;
      return `<button class="nav-item ${active?'active':''}" onclick="setSub('${m.id}','${s.id}')"><svg class="icon"><use href="#${s.icon}"/></svg>${s.label}${c>0?`<span class="count">${c}</span>`:""}</button>`;
    }).join("");
  } else {
    html = mods.map(m=>{
      const active = nav.module===m.id;
      let subnav = "";
      if(m.sub && active){
        subnav = `<div class="nav-sub">${m.sub.map(s=>{
          const cur = nav.sub[m.id]===s.id ? "current" : "";
          const c = s.count ? s.count() : 0;
          return `<button class="sub-item ${cur}" onclick="setSub('${m.id}','${s.id}')"><svg class="icon" style="width:13px;height:13px"><use href="#${s.icon}"/></svg>${s.label}${c>0?`<span class="count">${c}</span>`:""}</button>`;
        }).join("")}</div>`;
      }
      return `<button class="nav-item ${active?'active':''}" onclick="setModule('${m.id}')"><svg class="icon"><use href="#${m.icon}"/></svg>${m.label}</button>${subnav}`;
    }).join("");
  }
  document.getElementById("main-nav").innerHTML = html;
}

const TOPBAR_TITLES = {
  dashboard: ["Dashboard","Company overview · DesGro Media"],
  workspace: {
    overview:["My Workspace", ()=>currentUser?currentUser.role+" · "+currentUser.name:"Your personal snapshot"],
    tasks:["My Tasks", ()=>currentUser?clientTasks.filter(t=>t.assignedTo===currentUser.name && t.status!=="Done").length+" open across your clients":""],
    attendance:["My Attendance","Your check-in status and this month's record"],
    leave:["Leave", ()=>currentUser?leaveRequests.filter(l=>l.empId===currentUser.id).length+" request(s) on record":""],
    payroll:["My Payroll", ()=>{ const m=myPayroll[0]; return m ? MONTH_LABEL[m.month]+" · "+m.payStatus : "Your salary and requests"; }],
    payments:["Payment Requests", ()=>currentUser?paymentRequests.filter(r=>r.empId===currentUser.id).length+" request(s) on record":""],
    commission:["My Commission", ()=>{ if(!currentUser) return ""; const mine=commissionRowsByPerson().find(r=>r.name===currentUser.name); return mine&&mine.balance>0 ? inr(mine.balance)+" outstanding" : "All settled"; }],
    leaderboard:["Leaderboard", ()=>salesLeaderboardRows().length+" sales team member(s)"],
  },
  hr: {
    overview:["People Overview","Team snapshot · "+employees.length+" people"],
    directory:["Team Directory", employees.length+" people across "+DEPARTMENTS.length+" departments"],
    attendance:["Attendance","Today · click a status to update it"],
    leave:["Leave Requests", ()=>leaveRequests.filter(l=>l.status==="Pending").length+" pending approval"],
    hiring:["Hiring", ()=>openPositions.filter(p=>p.status==="Open").length+" open positions"],
    payroll:["Payroll", ()=>MONTH_LABEL[payroll.selectedMonth]+" · "+payrollMonthStatus(payroll.selectedMonth)],
    advances:["Advance Salary", ()=>inr(advances.filter(a=>a.status==="Recovering").reduce((s,a)=>s+a.balance,0))+" outstanding"],
    withdrawals:["Withdrawal Requests", ()=>withdrawalRequests.filter(w=>w.status==="Pending").length+" pending"],
    complaints:["Complaints", ()=>complaints.filter(c=>c.status==="New").length+" new"],
    notices:["Notices", ()=>notices.length+" posted"],
    policies:["HR Settings","Holidays, leave entitlements and general policy"],
    payments:["Payment Requests", ()=>currentUser?paymentRequests.filter(r=>r.empId===currentUser.id).length+" request(s) on record":""],
  },
  marketing: {
    overview:["Marketing and Sales Overview","Content, campaigns and pipeline · DesGro Media"],
    content:["Content Pipeline","Organic content · script to publish"],
    performance:["Meta Ads","DesGro Media's own ad performance"],
    leads:["Leads", ()=>marketingLeads.length+" total leads"],
    quotes:["Quotes", ()=>quotes.filter(q=>q.status==="Submitted to Finance").length+" awaiting Finance"],
    invoices:["Invoices", ()=>clientsMissingInvoice().length+" client"+(clientsMissingInvoice().length===1?"":"s")+" awaiting an invoice"],
  },
  clients: {
    overview:["Clients Overview","Activity and delivery status across clients"],
    all:["All Clients", ()=>clients.length+" on record"],
  },
  accounts: {
    overview:["Accounts Overview","Revenue, receivables and payables"],
    invoices:["Invoices", ()=>invoices.filter(i=>invoiceStatus(i)!=="Paid").length+" awaiting payment"],
    receipts:["Payment Receipts", ()=>pendingSalesPayments().length+" pushed by Sales, awaiting confirmation"],
    requests:["Payment Requests", ()=>(pendingAdvanceDisbursements.length+pendingPaymentRequests().length)+" awaiting Finance"],
    payroll:["Payroll", ()=>payroll.history[payroll.selectedMonth] ? MONTH_LABEL[payroll.selectedMonth]+" · "+payrollMonthStatus(payroll.selectedMonth) : MONTH_LABEL[payroll.selectedMonth]],
    payables:["Payables", ()=>inr(payables.reduce((s,p)=>s+payableBalance(p),0))+" outstanding"],
    expenses:["Expenses", ()=>expenses.length+" logged this month"],
    banks:["Banks", ()=>inr(bankAccounts.reduce((s,b)=>s+bankAccountBalance(b.id),0))+" across "+bankAccounts.length+" accounts"],
    quotes:["Quotes", ()=>quotes.filter(q=>q.status==="Submitted to Finance").length+" awaiting confirmation"],
    commissions:["Sales Commissions", ()=>inr(payables.filter(p=>p.category==="Commission").reduce((s,p)=>s+payableBalance(p),0))+" outstanding"],
    coa:["Chart of Accounts","Main accounts and sub-accounts, classified as Asset, Liability, Income or Expense"],
    journal:["Journal", ()=>journalEntries.length+" manual entries"],
    reports:["Reports", ()=>"P&L and Balance Sheet · "+MONTH_LABEL[payroll.selectedMonth]],
  },
};
function renderTopbar(){
  let h, sub;
  if(nav.module==="dashboard"){ [h,sub] = TOPBAR_TITLES.dashboard; }
  else{
    const s = nav.sub[nav.module];
    const t = TOPBAR_TITLES[nav.module][s];
    h = t[0]; sub = typeof t[1]==="function" ? t[1]() : t[1];
  }
  document.getElementById("topbar-title").innerHTML = `<h2>${h}</h2><span>${sub}</span>`;
}

/* ===================== RENDER DISPATCH ===================== */
function renderDetailTopbar(){
  if(nav.detail.type==='client'){
    const c = clientById(nav.detail.id);
    document.getElementById("topbar-title").innerHTML = `<h2>${esc(c.name)}</h2><span>${esc(c.industry)} · ${esc(c.city)}</span>`;
  }
}
function render(){
  renderNav();
  const root = document.getElementById("content");
  if(nav.detail){
    renderDetailTopbar();
    if(nav.detail.type==='client'){ root.innerHTML = clientDetailPage(nav.detail.id); renderClientTaskBoard(nav.detail.id); return; }
  }
  renderTopbar();
  if(nav.module==="dashboard") root.innerHTML = viewDashboard();
  else if(nav.module==="workspace") root.innerHTML = ({overview:workspaceOverview,tasks:workspaceTasks,attendance:workspaceAttendance,leave:workspaceLeave,payroll:workspacePayroll,payments:workspacePaymentRequests,commission:workspaceCommission,leaderboard:workspaceLeaderboard,complaints:workspaceComplaints})[nav.sub.workspace]();
  else if(nav.module==="hr") root.innerHTML = ({overview:hrOverview,directory:hrDirectory,attendance:hrAttendance,leave:hrLeave,hiring:hrHiring,payroll:hrPayroll,advances:hrAdvances,withdrawals:hrWithdrawals,payments:workspacePaymentRequests,complaints:hrComplaints,notices:hrNotices,policies:hrPolicies})[nav.sub.hr]();
  else if(nav.module==="marketing") root.innerHTML = ({overview:mktOverview,content:mktContent,performance:mktPerformance,leads:mktLeads,quotes:mktQuotes,invoices:mktInvoices})[nav.sub.marketing]();
  else if(nav.module==="clients") root.innerHTML = ({overview:clientsOverview,all:clientsAll})[nav.sub.clients]();
  else if(nav.module==="accounts") root.innerHTML = ({overview:acctOverview,invoices:acctInvoices,receipts:acctPaymentReceipts,requests:acctPaymentRequests,payroll:acctPayroll,payables:acctPayables,expenses:acctExpenses,banks:acctBanks,quotes:acctQuotes,commissions:acctCommissions,coa:acctChartOfAccounts,journal:acctJournal,reports:acctReports})[nav.sub.accounts]();
  if(nav.module==="marketing" && nav.sub.marketing==="content") initContentBoard();
  if(nav.module==="workspace" && nav.sub.workspace==="tasks") renderMyTaskBoard();
}

/* ===================== DASHBOARD ===================== */
function viewDashboard(){
  const openTasks = clientTasks.filter(t=>t.status!=="Done").length;
  const overdueTasks = clientTasks.filter(t=>t.status!=="Done" && t.due && t.due<TODAY).length;
  const activeClients = clients.filter(c=>c.status==="Active").length;
  const pendingLeave = leaveRequests.filter(l=>l.status==="Pending").length;
  const pendingAdvances = advances.filter(a=>a.status==="Pending").length;
  const receivable = invoices.reduce((s,i)=>s+invoiceBalance(i),0);
  const overdueInv = invoices.filter(i=>invoiceStatus(i)==="Overdue").reduce((s,i)=>s+invoiceBalance(i),0);
  const payableOutstanding = payables.reduce((s,p)=>s+payableBalance(p),0);
  const revenueMTD = invoices.filter(i=>i.issued.slice(0,7)==="2026-09").reduce((s,i)=>s+invoiceTotal(i),0);
  const publishedMTD = contentItems.filter(c=>c.stage==="Published" && c.due.slice(0,7)==="2026-09").length;

  const needsReview = [
    ...leaveRequests.filter(l=>l.status==="Pending").map(l=>({txt:`${byId(l.empId).name} requested ${l.days} day${l.days>1?'s':''} ${l.type.toLowerCase()} leave`, sub:`applied ${fmtDateShort(l.applied)}`})),
    ...advances.filter(a=>a.status==="Pending").map(a=>({txt:`${byId(a.empId).name} requested a ${inr(a.amount)} advance`, sub:esc(a.reason)})),
    ...invoices.filter(i=>invoiceStatus(i)==="Overdue").map(i=>({txt:`${clientById(i.clientId).name} — invoice ${i.invoiceNo} overdue`, sub:`${inr(invoiceBalance(i))} · due ${fmtDateShort(i.due)}`})),
    ...clientTasks.filter(t=>t.status!=="Done" && t.due && t.due<TODAY).map(t=>({txt:`${t.title} is overdue`, sub:`${clientById(t.clientId).name} · ${t.assignedTo} · due ${fmtDateShort(t.due)}`})),
  ].slice(0,6);

  const deptCounts = DEPARTMENTS.map(d=>({d,n:employees.filter(e=>e.dept===d).length})).sort((a,b)=>b.n-a.n);
  const maxDept = Math.max(...deptCounts.map(x=>x.n));

  return `
  <div class="banner">
    <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
    <div><b>Sample data.</b> Figures across every module below are placeholders so you can see DesGro Media's ERP working end to end. Swap the seed data for live API calls to go into production.</div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-top"><span class="kpi-label">Team</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-users"/></svg></div></div>
      <div class="kpi-value mono">${employees.length}</div>
      <div class="kpi-sub">across ${DEPARTMENTS.length} departments</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-top"><span class="kpi-label">Open Tasks</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-board"/></svg></div></div>
      <div class="kpi-value mono ${overdueTasks>0?'warn':''}">${openTasks}</div>
      <div class="kpi-sub">${overdueTasks} overdue</div>
    </div>
    <div class="kpi-card hero">
      <div class="kpi-top"><span class="kpi-label">Revenue — September</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-receipt"/></svg></div></div>
      <div class="kpi-value mono">${inr(revenueMTD)}</div>
      <div class="kpi-sub">invoiced this month</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-top"><span class="kpi-label">Active Clients</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-building"/></svg></div></div>
      <div class="kpi-value mono">${activeClients}</div>
      <div class="kpi-sub">of ${clients.length} total on record</div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-top"><span class="kpi-label">Receivables</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-coins"/></svg></div></div>
      <div class="kpi-value mono">${inr(receivable)}</div>
      <div class="kpi-sub">${inr(overdueInv)} overdue</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-top"><span class="kpi-label">Payables</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-wallet"/></svg></div></div>
      <div class="kpi-value mono warn">${inr(payableOutstanding)}</div>
      <div class="kpi-sub">outstanding</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-top"><span class="kpi-label">Content Published</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-megaphone"/></svg></div></div>
      <div class="kpi-value mono">${publishedMTD}</div>
      <div class="kpi-sub">this month, across clients</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-top"><span class="kpi-label">Pending Approvals</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-bell"/></svg></div></div>
      <div class="kpi-value mono ${pendingLeave+pendingAdvances>0?'warn':''}">${pendingLeave+pendingAdvances}</div>
      <div class="kpi-sub">${pendingLeave} leave · ${pendingAdvances} advance</div>
    </div>
  </div>

  <div class="grid-2">
    <div class="panel">
      <div class="panel-head"><div><h3>Headcount by department</h3><div class="sub">${employees.length} active team members</div></div></div>
      <div class="panel-body">
        <div class="barchart">
          ${deptCounts.map(x=>`<div class="bar-row"><div class="bar-label">${esc(x.d)}</div><div class="bar-track"><div class="bar-fill" style="width:${(x.n/maxDept)*100}%"></div></div><div class="bar-val">${x.n}</div></div>`).join("")}
        </div>
      </div>
    </div>
    <div class="stack">
      <div class="panel">
        <div class="panel-head"><h3>Needs your review</h3></div>
        <div class="panel-body">${needsReview.length ? needsReview.map(n=>`<div class="feed-item"><div class="feed-dot"></div><div><div class="feed-text"><strong>${n.txt}</strong></div><div class="feed-time">${n.sub}</div></div></div>`).join("") : '<div class="empty">All caught up.</div>'}</div>
      </div>
    </div>
  </div>`;
}

/* ===================== MY WORKSPACE (Staff / Sales self-service) ===================== */
// Deliberately minimal — just what a Staff sign-in needs day to day: their own attendance, their
// open tasks, and Notices posted by administration/HR (see hrNotices()). Nothing else belongs here.
// A Sales sign-in gets a different overview entirely — see workspaceOverviewSales() below — since
// their workspace is about attendance, commission and leaderboard rank, not client delivery tasks.
function workspaceOverview(){
  if(!currentUser) return '';
  if(isSalesRole(currentUser)) return workspaceOverviewSales();
  const myTasks = clientTasks.filter(t=>t.assignedTo===currentUser.name);
  const openTasks = myTasks.filter(t=>t.status!=="Done");
  const overdueTasks = myTasks.filter(t=>t.status!=="Done" && t.due && t.due<TODAY);
  const att = attendanceToday[currentUser.id];
  const mtdWorkingDays = workingDaysMTD();
  const present = monthPresentDays[currentUser.id] ?? mtdWorkingDays;
  const recentNotices = notices.slice().sort((a,b)=>b.postedDate.localeCompare(a.postedDate)).slice(0,5);
  return `
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Today</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-attendance"/></svg></div></div><div class="kpi-value mono" style="font-size:19px;">${att?attendanceLabel(att.status):'—'}</div><div class="kpi-sub">${att&&att.in?'checked in '+att.in:''}</div></div>
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">This Month</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-calendar"/></svg></div></div><div class="kpi-value mono">${present}<span style="font-size:13px;color:var(--ink-soft);font-family:Manrope;"> / ${mtdWorkingDays}</span></div><div class="kpi-sub">days present</div></div>
    <div class="kpi-card hero"><div class="kpi-top"><span class="kpi-label">Open Tasks</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-board"/></svg></div></div><div class="kpi-value mono ${overdueTasks.length>0?'warn':''}">${openTasks.length}</div><div class="kpi-sub">${overdueTasks.length} overdue</div></div>
  </div>
  <div class="grid-2">
    <div class="panel">
      <div class="panel-head"><h3>Your tasks</h3></div>
      <div class="panel-body">${openTasks.length ? openTasks.slice().sort((a,b)=>(a.due||'').localeCompare(b.due||'')).slice(0,6).map(t=>`<div class="feed-item row-click" onclick="openClientDetail('${t.clientId}')"><div class="feed-dot" style="${t.due&&t.due<TODAY?'background:var(--neg);':''}"></div><div><div class="feed-text"><strong>${esc(t.title)}</strong></div><div class="feed-time">${esc(clientById(t.clientId).name)} · due ${t.due?fmtDateShort(t.due):'no date'}</div></div></div>`).join("") : '<div class="empty">No open tasks.</div>'}</div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Notices</h3><div class="sub">From administration and HR</div></div>
      <div class="panel-body">${recentNotices.length ? recentNotices.map(n=>`<div class="feed-item"><div class="feed-dot" style="background:var(--brand);"></div><div><div class="feed-text"><strong>${esc(n.title)}</strong></div><div class="feed-time">${esc(n.message)}</div><div class="feed-time" style="margin-top:2px;">${esc(n.postedBy)} · ${fmtDateShort(n.postedDate)}</div></div></div>`).join("") : '<div class="empty">No notices right now.</div>'}</div>
    </div>
  </div>`;
}
function workspaceOverviewSales(){
  const att = attendanceToday[currentUser.id];
  const mtdWorkingDays = workingDaysMTD();
  const present = monthPresentDays[currentUser.id] ?? mtdWorkingDays;
  const mine = commissionRowsByPerson().find(r=>r.name===currentUser.name) || {earned:0, paid:0, balance:0, mine:[]};
  const board = salesLeaderboardRows();
  const myRank = board.findIndex(r=>r.name===currentUser.name)+1;
  const recentNotices = notices.slice().sort((a,b)=>b.postedDate.localeCompare(a.postedDate)).slice(0,5);
  return `
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Today</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-attendance"/></svg></div></div><div class="kpi-value mono" style="font-size:19px;">${att?attendanceLabel(att.status):'—'}</div><div class="kpi-sub">${att&&att.in?'checked in '+att.in:''}</div></div>
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Commission Earned</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-percent"/></svg></div></div><div class="kpi-value mono" style="font-size:17px;">${inr(mine.earned)}</div><div class="kpi-sub">${mine.balance>0?inr(mine.balance)+' outstanding':'all settled'}</div></div>
    <div class="kpi-card hero"><div class="kpi-top"><span class="kpi-label">Leaderboard Rank</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-target"/></svg></div></div><div class="kpi-value mono">${myRank?'#'+myRank:'—'}</div><div class="kpi-sub">of ${board.length} on the sales team</div></div>
  </div>
  <div class="grid-2">
    <div class="panel">
      <div class="panel-head"><h3>Leaderboard</h3><div class="sub">By commission earned, all time</div></div>
      <div class="panel-body">${board.slice(0,5).map((r,i)=>`<div class="feed-item"><div class="feed-dot" style="${currentUser&&r.name===currentUser.name?'background:var(--brand);':''}"></div><div><div class="feed-text"><strong>#${i+1} ${esc(r.name)}</strong></div><div class="feed-time">${inr(r.earned)} earned · ${r.clients} client${r.clients===1?'':'s'}</div></div></div>`).join('')}</div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Notices</h3><div class="sub">From administration and HR</div></div>
      <div class="panel-body">${recentNotices.length ? recentNotices.map(n=>`<div class="feed-item"><div class="feed-dot" style="background:var(--brand);"></div><div><div class="feed-text"><strong>${esc(n.title)}</strong></div><div class="feed-time">${esc(n.message)}</div><div class="feed-time" style="margin-top:2px;">${esc(n.postedBy)} · ${fmtDateShort(n.postedDate)}</div></div></div>`).join("") : '<div class="empty">No notices right now.</div>'}</div>
    </div>
  </div>`;
}
// A Sales sign-in's own commission — same underlying Commission payables as Accounts > Commissions,
// scoped to just this person (read-only here; payout is still recorded by Finance in Accounts).
function workspaceCommission(){
  if(!currentUser) return '';
  const mine = commissionRowsByPerson().find(r=>r.name===currentUser.name) || {name:currentUser.name, mine:[], earned:0, paid:0, balance:0};
  const myTarget = salesTargets.find(r=>r.salesPerson===currentUser.name);
  const myWithdrawals = commissionWithdrawals.filter(w=>w.empId===currentUser.id).slice().sort((a,b)=>{ const order={Pending:0,Approved:1,Rejected:2}; if(order[a.status]!==order[b.status]) return order[a.status]-order[b.status]; return b.requested.localeCompare(a.requested); });
  return `
  <div class="toolbar"><div class="banner muted" style="margin:0;flex:1;min-width:260px;"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>You earn ${Math.round(SALES_COMMISSION_RATE*100)}% on every payment Finance approves against your quotes or invoices. Need it paid out sooner? Request a withdrawal below and Finance will approve and pay it against your outstanding entries.</div></div>${mine.balance>0?`<button class="btn primary" onclick="openRequestCommissionWithdrawal()"><svg class="icon" style="width:13px;height:13px"><use href="#i-coins"/></svg>Request withdrawal</button>`:''}</div>
  <div class="kpi-grid">
    <div class="kpi-card hero"><div class="kpi-label">Outstanding</div><div class="kpi-value mono ${mine.balance>0?'warn':''}">${inr(mine.balance)}</div><div class="kpi-sub">awaiting payout</div></div>
    <div class="kpi-card"><div class="kpi-label">Paid Out</div><div class="kpi-value mono pos">${inr(mine.paid)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Total Earned</div><div class="kpi-value mono">${inr(mine.earned)}</div><div class="kpi-sub">${mine.mine.length} entr${mine.mine.length===1?'y':'ies'}, all time</div></div>
  </div>
  ${myTarget?(()=>{
    const pct = myTarget.target>0 ? Math.min(100, Math.round(myTarget.monthlySales/myTarget.target*100)) : 0;
    const over = myTarget.monthlySales>=myTarget.target;
    return `<div class="panel">
      <div class="panel-head"><h3>This month's sales target</h3><div class="sub">${Math.round(myTarget.bonusRate*100)}% bonus commission on every rupee past target, separate from your flat ${Math.round(SALES_COMMISSION_RATE*100)}% above</div></div>
      <div class="panel-body">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;"><span style="font-weight:700;font-size:15px;">${inr(myTarget.monthlySales)}</span><span class="faint">of ${inr(myTarget.target)} target</span></div>
        <div class="bar-track" style="height:10px;"><div class="bar-fill" style="width:${pct}%;${over?'background:var(--pos);':''}"></div></div>
        ${over ? `<div class="banner" style="margin-top:14px;"><svg class="icon" style="width:15px;height:15px"><use href="#i-target"/></svg><div><b>Target crossed.</b> Bonus commission earned this month: <b>${inr(myTarget.bonusEarnedThisMonth)}</b> — logged as its own Sales Bonus entry, separate from your regular commission above.</div></div>` : `<div class="subtext" style="margin-top:10px;">${inr(myTarget.target-myTarget.monthlySales)} more to start earning bonus commission this month.</div>`}
      </div>
    </div>`;
  })():''}
  ${myWithdrawals.length?`<div class="panel">
    <div class="panel-head"><h3>Your withdrawal requests</h3></div>
    <div class="table-wrap"><table class="data"><thead><tr><th class="num">Amount</th><th>Requested</th><th>Note</th><th>Status</th></tr></thead>
      <tbody>${myWithdrawals.map(w=>`<tr><td class="num mono">${inr(w.amount)}</td><td class="muted">${fmtDate(w.requested)}</td><td class="muted">${esc(w.note||'—')}</td><td>${pill(w.status,statusKind(w.status))}</td></tr>`).join('')}</tbody>
    </table></div>
  </div>`:''}
  <div class="panel">
    <div class="panel-head"><h3>Your commission entries</h3></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Source</th><th>Due</th><th class="num">Amount</th><th class="num">Balance</th><th>Status</th></tr></thead>
      <tbody>${mine.mine.length ? mine.mine.slice().sort((a,b)=>b.due.localeCompare(a.due)).map(p=>{ const bal=payableBalance(p); const status = bal<=0?'Paid':(payablePaid(p)>0?'Partially Paid':'Pending'); return `<tr><td>${esc(p.payee)}</td><td class="muted">${fmtDateShort(p.due)}</td><td class="num mono">${inr(p.amount)}</td><td class="num mono">${bal>0?inr(bal):'<span class="faint">—</span>'}</td><td>${pill(status,statusKind(status))}</td></tr>`; }).join('') : `<tr><td colspan="5"><div class="empty">No commission earned yet.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
// Every Sales-dept employee ranked by all-time commission earned — see salesLeaderboardRows().
function workspaceLeaderboard(){
  const rows = salesLeaderboardRows();
  const myRank = currentUser ? rows.findIndex(r=>r.name===currentUser.name)+1 : 0;
  return `
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Ranked by total commission earned, all time.</div></div>
  <div class="panel">
    <div class="panel-head"><h3>Sales leaderboard</h3>${myRank?`<div class="sub">You're ranked #${myRank} of ${rows.length}</div>`:''}</div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Rank</th><th>Sales Person</th><th class="num">Clients</th><th class="num">Commission Earned</th></tr></thead>
      <tbody>${rows.map((r,i)=>{ const mine = currentUser && r.name===currentUser.name; return `<tr style="${mine?'background:var(--brand-soft);':''}"><td class="mono" style="font-weight:800;${i<3?'color:var(--brand-strong);':''}">#${i+1}</td><td>${personCell(r.emp)}${mine?' <span class="tag type">You</span>':''}</td><td class="num">${r.clients}</td><td class="num mono" style="font-weight:700;">${inr(r.earned)}</td></tr>`; }).join('')}</tbody>
    </table></div>
  </div>`;
}
// Anonymous complaints, opened up to every non-HR sign-in — HR already has this inside the HR module,
// which most staff don't have access to. No "your submissions" list here — a submission carries no
// employee ID, so there's nothing to tie back to currentUser without breaking the anonymity itself.
function workspaceComplaints(){
  return `
  <div class="banner muted">
    <svg class="icon" style="width:15px;height:15px"><use href="#i-megaphone"/></svg>
    <div><b>Anonymous by design.</b> A submission carries no name, employee ID or contact detail — only the category, an optional department, and the message. Because nothing identifies you, there's no "your submissions" list here either — once it's sent, it's out of your hands the same way it would be for anyone else.</div>
  </div>
  <div class="panel">
    <div class="panel-body" style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
      <div>
        <div style="font-weight:700;margin-bottom:4px;">Something to raise?</div>
        <div class="sub">Workplace behavior, management, compensation, work environment, policy — whatever it is</div>
      </div>
      <button class="btn primary" onclick="openSubmitComplaint()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Submit a complaint</button>
    </div>
  </div>`;
}
function workspaceTasks(){
  const archivedCount = currentUser ? clientTasks.filter(t=>t.assignedTo===currentUser.name && isTaskArchived(t)).length : 0;
  return `
  <div class="toolbar">
    <div class="banner muted" style="margin:0;flex:1;min-width:260px;"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Every task assigned to you, across every client — drag a card between columns, or use the stage dropdown on each card. Completed tasks move to the archive after 3 days.</div></div>
    ${archivedCount?`<button class="btn ghost" onclick="openTaskArchive()"><svg class="icon" style="width:13px;height:13px"><use href="#i-archive"/></svg>Archive (${archivedCount})</button>`:''}
  </div>
  <div class="board-scroll"><div class="board" id="my-task-board"></div></div>`;
}
function workspaceLeave(){
  if(!currentUser) return '';
  const mine = leaveRequests.filter(l=>l.empId===currentUser.id).slice().sort((a,b)=>{ const order={Pending:0,Approved:1,Rejected:2}; if(order[a.status]!==order[b.status]) return order[a.status]-order[b.status]; return b.applied.localeCompare(a.applied); });
  const bal = leaveBalance(currentUser.id);
  const hasImpact = bal.lopDays>0 || bal.wfhExcessDays>0;
  return `
  <div class="toolbar"><div></div><button class="btn primary" onclick="openApplyLeave()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Apply for leave</button></div>
  <div class="panel">
    <div class="panel-head"><h3>This month's leave &amp; WFH</h3><div class="sub">${esc(monthLabel(bal.month))} · ${hrPolicy.paidLeavesPerMonth} paid leave day &amp; ${hrPolicy.paidWfhPerMonth} paid WFH day per month</div></div>
    <div class="panel-body">
      <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);">
        <div class="kpi-card" style="box-shadow:none;"><div class="kpi-label">Paid leave left</div><div class="kpi-value mono ${bal.leaveRemaining<=0?'warn':''}">${bal.leaveRemaining} <span style="font-size:14px;color:var(--ink-soft);font-family:Manrope;">/ ${hrPolicy.paidLeavesPerMonth}</span></div><div class="kpi-sub">${bal.leaveDays} taken so far this month</div></div>
        <div class="kpi-card" style="box-shadow:none;"><div class="kpi-label">Paid WFH left</div><div class="kpi-value mono ${bal.wfhRemaining<=0?'warn':''}">${bal.wfhRemaining} <span style="font-size:14px;color:var(--ink-soft);font-family:Manrope;">/ ${hrPolicy.paidWfhPerMonth}</span></div><div class="kpi-sub">${bal.wfhDays} taken so far this month</div></div>
      </div>
      ${hasImpact ? `
      <div class="banner" style="margin-top:12px;">
        <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
        <div><b>This is already affecting your payroll.</b> ${bal.lopDays>0?`${bal.lopDays} leave day${bal.lopDays===1?"":"s"} beyond your ${hrPolicy.paidLeavesPerMonth}/month allowance means a full Loss of Pay deduction for ${bal.lopDays===1?"that day":"those days"}.`:""} ${bal.wfhExcessDays>0?`${bal.wfhExcessDays} WFH day${bal.wfhExcessDays===1?"":"s"} beyond your ${hrPolicy.paidWfhPerMonth}/month allowance is paid at 75% instead of full pay.`:""} See exactly how much in My Payroll.</div>
      </div>` : `
      <div class="banner muted" style="margin-top:12px;">
        <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
        <div>You're within your paid leave and WFH allowance for ${esc(monthLabel(bal.month))} — no pay impact yet.</div>
      </div>`}
    </div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Your requests</h3></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Type</th><th>Dates</th><th class="num">Days</th><th>Reason</th><th>Status</th></tr></thead>
      <tbody>${mine.length ? mine.map(l=>{ const range = l.from===l.to ? fmtDateShort(l.from) : `${fmtDateShort(l.from)} – ${fmtDateShort(l.to)}`; return `<tr><td>${esc(l.type)}${l.duration && l.duration!=="Full Day" ? ` <span class="faint">· ${esc(l.duration)}</span>` : ""}</td><td class="muted">${range}</td><td class="num">${l.days}</td><td class="muted">${esc(l.reason)}</td><td>${pill(l.status,statusKind(l.status))}</td></tr>`; }).join("") : `<tr><td colspan="5"><div class="empty">No leave requests yet.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
function openApplyLeave(){
  applyLeaveMonthUsage = {}; // fresh cache per modal open
  showModal(`
    <div class="modal-head"><h3>Apply for leave</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-apply-leave"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Submitted to HR for approval.</div></div>
      <div class="field-row">
        <div><label class="field-label">Type</label><select class="field-input" id="leave-type" name="type" onchange="updateLeaveImpactNote()"><option value="Casual/Sick">Casual/Sick</option><option value="WFH">WFH</option></select></div>
        <div><label class="field-label">Duration</label><select class="field-input" id="leave-duration" name="duration" onchange="updateLeaveImpactNote()"><option value="Full Day">Full Day</option><option value="Half Day">Half Day</option><option value="Quarter Day">Quarter Day</option></select></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">From</label><input class="field-input" id="leave-from" type="date" name="from" value="${TODAY}" required onchange="updateLeaveImpactNote()"></div>
        <div><label class="field-label">To</label><input class="field-input" id="leave-to" type="date" name="to" value="${TODAY}" required onchange="updateLeaveImpactNote()"></div>
      </div>
      <div class="subtext">Half Day and Quarter Day apply only when From and To are the same date — a multi-day range is always counted as full days.</div>
      <div id="leave-impact-note"></div>
      <div><label class="field-label">Reason</label><textarea class="field-input" name="reason" required placeholder="Brief reason for the request"></textarea></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Submit request</button></div></div>
    </form>`);
  updateLeaveImpactNote();
  document.getElementById("f-apply-leave").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const from=f.get("from"), to=f.get("to");
    const duration = f.get("duration");
    let days = Math.max(1, Math.round((new Date(to)-new Date(from))/86400000)+1);
    if(from===to && duration==="Half Day") days = 0.5;
    if(from===to && duration==="Quarter Day") days = 0.25;
    try{
      await apiJson("/api/hr/leave-requests", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({
        type: LEAVE_TYPE_TO_API[f.get("type")] || f.get("type"), duration: TITLECASE_TO_API(from===to?duration:"Full Day"), fromDate:from, toDate:to, days, reason:f.get("reason"),
      })});
      leaveRequests = (await apiJson(`/api/hr/leave-requests?employeeId=${currentUser._dbId}`)).leaveRequests.map(mapLeaveRequest);
      toast("Leave request submitted"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't submit leave request"); }
  });
}
// Live "will this cause a pay cut" preview inside the Apply for Leave form — recalculated on every
// Type/From/To/Duration change so staff see the Loss of Pay/WFH pay-cut consequence before they
// submit, not after HR approves it. Computed the same way the real deduction is: days already marked
// in Attendance this month (per computeMonthlyLeaveUsage) plus the newly requested days, split by
// calendar month in case the range straddles a month boundary, against the org-wide monthly cap. Only
// Full Day requests are previewed — Half/Quarter Day never touch Attendance (see decideLeaveRequest),
// so they never affect this. The real deduction still only applies once HR approves the request.
let applyLeaveMonthUsage = {}; // month -> {leaveDays,leaveCap,wfhDays,wfhCap,...} for the signed-in employee, cached for this modal
async function updateLeaveImpactNote(){
  const fromEl = document.getElementById('leave-from');
  const toEl = document.getElementById('leave-to');
  const durationEl = document.getElementById('leave-duration');
  const typeEl = document.getElementById('leave-type');
  const noteEl = document.getElementById('leave-impact-note');
  if(!fromEl || !toEl || !noteEl || !currentUser) return;
  const from = fromEl.value, to = toEl.value;
  const duration = durationEl ? durationEl.value : 'Full Day';
  const isWfh = typeEl ? typeEl.value === 'WFH' : false;
  if(!from || !to || to<from){ noteEl.innerHTML = ''; return; }
  if(from===to && duration!=='Full Day'){
    noteEl.innerHTML = `<div class="banner muted" style="margin-top:2px;margin-bottom:10px;">
      <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
      <div>Half Day and Quarter Day requests don't affect Loss of Pay or the WFH pay-cut — only Full Day requests do.</div>
    </div>`;
    return;
  }

  // Split the requested (new) days by calendar month.
  const newDaysByMonth = {};
  for(let d=new Date(from+"T00:00:00Z"), end=new Date(to+"T00:00:00Z"); d<=end; d=new Date(d.getTime()+86400000)){
    const m = d.toISOString().slice(0,7);
    newDaysByMonth[m] = (newDaysByMonth[m]||0) + 1;
  }
  const months = Object.keys(newDaysByMonth);

  noteEl.innerHTML = `<div class="banner muted" style="margin-top:2px;margin-bottom:10px;"><div>Checking your allowance…</div></div>`;
  await Promise.all(months.map(async m=>{
    if(!applyLeaveMonthUsage[m]){
      applyLeaveMonthUsage[m] = await apiJson(`/api/hr/leave-balance/${currentUser._dbId}?month=${m}`).then(r=>r.balance).catch(()=>null);
    }
  }));
  // The form may have changed again while that fetch was in flight — bail rather than show a stale preview.
  if(fromEl.value!==from || toEl.value!==to || !document.getElementById('leave-impact-note')) return;

  const dayKey = isWfh ? 'wfhDays' : 'leaveDays', capKey = isWfh ? 'wfhCap' : 'leaveCap';
  const withExcess = months.map(m=>{
    const usage = applyLeaveMonthUsage[m];
    if(!usage) return null;
    const newTotal = usage[dayKey] + newDaysByMonth[m];
    const excess = Math.max(0, newTotal - usage[capKey]);
    return excess>0 ? {month:m, excess, cap:usage[capKey]} : null;
  }).filter(Boolean);

  if(withExcess.length){
    noteEl.innerHTML = `<div class="banner" style="margin-top:2px;margin-bottom:10px;">
      <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
      <div><b>This request will cause a pay cut.</b> ${withExcess.map(m=>`${m.excess} day${m.excess===1?"":"s"} in ${esc(monthLabel(m.month))} beyond your ${m.cap}/month ${isWfh?"paid-WFH":"paid-leave"} allowance — expect ${isWfh?"a 25% pay cut (paid at 75%)":"a Loss of Pay deduction"} for ${m.excess===1?"that day":"those days"} once approved.`).join(' ')}</div>
    </div>`;
  } else {
    noteEl.innerHTML = `<div class="banner muted" style="margin-top:2px;margin-bottom:10px;">
      <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
      <div>Within your paid ${isWfh?"WFH":"leave"} allowance — no pay impact expected.</div>
    </div>`;
  }
}
function workspaceAttendance(){
  if(!currentUser) return '';
  const att = attendanceToday[currentUser.id];
  const mtdWorkingDays = workingDaysMTD();
  const present = monthPresentDays[currentUser.id] ?? mtdWorkingDays;
  return `
  <div class="kpi-grid cols-5">
    <div class="kpi-card"><div class="kpi-label">Today's Status</div><div class="kpi-value mono" style="font-size:18px;">${att?attendanceLabel(att.status):'—'}</div></div>
    <div class="kpi-card"><div class="kpi-label">Checked In</div><div class="kpi-value mono" style="font-size:18px;">${att&&att.in?att.in:'—'}</div></div>
    <div class="kpi-card"><div class="kpi-label">Days Present (MTD)</div><div class="kpi-value mono">${present}</div></div>
    <div class="kpi-card"><div class="kpi-label">Working Days (MTD)</div><div class="kpi-value mono">${mtdWorkingDays}</div></div>
    <div class="kpi-card"><div class="kpi-label">Missed</div><div class="kpi-value mono ${mtdWorkingDays-present>0?'warn':''}">${Math.max(0,mtdWorkingDays-present)}</div></div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>This month</h3></div>
    <div class="panel-body"><div class="kpi-card" style="box-shadow:none;"><div class="kpi-label">Attendance</div><div class="kpi-value mono">${present}<span style="font-size:14px;color:var(--ink-soft);font-family:Manrope;"> / ${mtdWorkingDays} working days</span></div><div class="kpi-sub">${present>=mtdWorkingDays?'full attendance this month':(mtdWorkingDays-present)+' day(s) missed'}</div></div></div>
  </div>`;
}
function openRequestAdvance(){
  showModal(`
    <div class="modal-head"><h3>Request advance salary</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-request-advance"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Submitted to HR for approval — once approved, it recovers automatically from your payroll over the months you choose.</div></div>
      <div class="field-row">
        <div><label class="field-label">Amount (₹)</label><input class="field-input" type="number" name="amount" min="500" step="500" required placeholder="10000"></div>
        <div><label class="field-label">Recovery in (months)</label><input class="field-input" type="number" name="installments" min="1" max="6" value="2" required></div>
      </div>
      <div><label class="field-label">Reason</label><textarea class="field-input" name="reason" required placeholder="Brief reason for the request"></textarea></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Submit request</button></div></div>
    </form>`);
  document.getElementById("f-request-advance").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const amount = Number(f.get("amount")); const installments = Number(f.get("installments"));
    try{
      await apiJson("/api/hr/advances", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ amount, reason:f.get("reason"), installments }) });
      advances = (await apiJson(`/api/hr/advances?employeeId=${currentUser._dbId}`)).advances.map(mapAdvance);
      toast("Advance request submitted"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't submit advance request"); }
  });
}

/* ===================== HR ===================== */
function statusKind(s){
  const map = {Present:"pos",Late:"warn","Half Day":"warn","On Leave":"neutral",Absent:"neg","Work From Home":"blue",
    Approved:"pos",Pending:"warn",Rejected:"neg",Recovering:"warn",Recovered:"pos",Paid:"pos",Open:"blue",Interview:"warn",Offer:"pos",Hired:"pos",Applied:"neutral",
    Permanent:"pos",Probation:"warn",
    Unpaid:"neg","Partially Paid":"warn","Payments pending":"warn","Adding entries":"neutral",
    New:"warn",Reviewed:"blue",Resolved:"pos"};
  return map[s] || "neutral";
}
function attendanceLabel(s){ return {present:"Present",late:"Late",half:"Half Day",absent:"Absent",leave:"On Leave",wfh:"Work From Home"}[s]; }

function hrOverview(){
  const present = Object.values(attendanceToday).filter(a=>a.status==="present").length;
  const late = Object.values(attendanceToday).filter(a=>a.status==="late").length;
  const half = Object.values(attendanceToday).filter(a=>a.status==="half").length;
  const onLeave = Object.values(attendanceToday).filter(a=>a.status==="leave").length;
  const pendingLeave = leaveRequests.filter(l=>l.status==="Pending").length;
  const pendingAdvances = advances.filter(a=>a.status==="Pending").length;
  const payrollStatus = payrollMonthStatus(payroll.selectedMonth);
  const netPayroll = Object.keys(payroll.history[payroll.selectedMonth].entries).reduce((s,id)=>s+computePayrollRow(byId(id),payroll.selectedMonth).net,0);
  const onNotice = employees.filter(e=>e.employmentStatus==="Notice Period").length;
  const deptCounts = DEPARTMENTS.map(d=>({d,n:employees.filter(e=>e.dept===d).length})).sort((a,b)=>b.n-a.n);
  const maxDept = Math.max(...deptCounts.map(x=>x.n));
  const needsReview = [
    ...leaveRequests.filter(l=>l.status==="Pending").map(l=>({txt:`${byId(l.empId).name} requested ${l.days} day${l.days>1?'s':''} ${l.type.toLowerCase()} leave`, sub:`${fmtDateShort(l.from)}${l.from!==l.to?' – '+fmtDateShort(l.to):''} · applied ${fmtDateShort(l.applied)}`})),
    ...advances.filter(a=>a.status==="Pending").map(a=>({txt:`${byId(a.empId).name} requested a ${inr(a.amount)} advance`, sub:esc(a.reason)+" · "+fmtDateShort(a.requested)})),
  ].slice(0,5);

  return `
  <div class="banner">
    <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
    <div><b>Sample data.</b> Approving a leave or advance updates its status live; fully paying an employee's salary for the month recovers their approved advance automatically.</div>
  </div>
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Team Size</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-users"/></svg></div></div><div class="kpi-value mono">${employees.length}</div><div class="kpi-sub">${onNotice ? onNotice+" on notice period" : "across "+DEPARTMENTS.length+" departments"}</div></div>
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Present Today</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-check"/></svg></div></div><div class="kpi-value mono">${present+late+half}<span style="font-size:14px;color:var(--ink-soft);font-family:Manrope;"> / ${employees.length}</span></div><div class="kpi-sub">${onLeave} on leave</div></div>
    <div class="kpi-card hero"><div class="kpi-top"><span class="kpi-label">Payroll — ${MONTH_LABEL[payroll.selectedMonth]}</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-wallet"/></svg></div></div><div class="kpi-value mono">${inr(netPayroll)}</div><div class="kpi-sub">${payrollStatus==='Paid'?'fully paid':payrollStatus==='Payments pending'?'payments pending':'entries in progress'}</div></div>
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Pending Approvals</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-bell"/></svg></div></div><div class="kpi-value mono ${pendingLeave+pendingAdvances>0?'warn':''}">${pendingLeave+pendingAdvances}</div><div class="kpi-sub">${pendingLeave} leave · ${pendingAdvances} advance</div></div>
  </div>
  <div class="grid-2">
    <div class="panel">
      <div class="panel-head"><div><h3>Headcount by department</h3><div class="sub">${employees.length} active team members</div></div></div>
      <div class="panel-body"><div class="barchart">${deptCounts.map(x=>`<div class="bar-row"><div class="bar-label">${esc(x.d)}</div><div class="bar-track"><div class="bar-fill" style="width:${(x.n/maxDept)*100}%"></div></div><div class="bar-val">${x.n}</div></div>`).join("")}</div></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Needs your review</h3></div>
      <div class="panel-body">${needsReview.length ? needsReview.map(n=>`<div class="feed-item"><div class="feed-dot"></div><div><div class="feed-text"><strong>${n.txt}</strong></div><div class="feed-time">${n.sub}</div></div></div>`).join("") : '<div class="empty">All caught up.</div>'}</div>
    </div>
  </div>`;
}

let employeeSearch = "", employeeDept = "All";
function setDeptFilter(d){ employeeDept=d; render(); }
function setEmployeeSearch(v){ employeeSearch=v; document.getElementById("content").innerHTML = hrDirectory(); }
function hrDirectory(){
  let list = employees.filter(e=>{
    const matchesSearch = (e.name+e.role+e.id).toLowerCase().includes(employeeSearch.toLowerCase());
    const matchesDept = employeeDept==="All" || e.dept===employeeDept;
    return matchesSearch && matchesDept;
  }).sort((a,b)=>a.name.localeCompare(b.name));
  const chips = ["All",...DEPARTMENTS].map(d=>`<button class="chip ${employeeDept===d?'active':''}" onclick="setDeptFilter('${esc(d)}')">${esc(d)}</button>`).join(" ");
  return `
  <div class="toolbar">
    <div class="filter-group"><span class="filter-label">Department</span>${chips}</div>
    <div class="filter-group">
      <div class="search" style="width:200px;"><svg class="icon" style="width:14px;height:14px"><use href="#i-search"/></svg><input placeholder="Search name, role, ID" value="${esc(employeeSearch)}" oninput="setEmployeeSearch(this.value)"></div>
      ${archivedEmployees.length?`<button class="btn ghost" onclick="openEmployeeArchive()"><svg class="icon" style="width:13px;height:13px"><use href="#i-archive"/></svg>Archived (${archivedEmployees.length})</button>`:''}
      <button class="btn primary" onclick="openAddEmployee()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Add employee</button>
    </div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Team directory</h3><div class="sub">${list.length} shown</div></div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Employee</th><th>ID</th><th>Department</th><th>Status</th><th>Employment</th><th>Joined</th><th class="num">Monthly gross</th></tr></thead>
      <tbody>${list.length ? list.map(e=>`<tr class="row-click" onclick="openEmployeeDetail('${e.id}')"><td>${personCell(e)}</td><td class="muted mono">${e.id}</td><td>${esc(e.dept)}</td><td>${pill(e.empType, statusKind(e.empType))}</td><td>${e.employmentStatus==="Notice Period" ? pill("Notice · "+fmtDate(e.leavingDate), "warn") : `<span class="faint">Active</span>`}</td><td class="muted">${fmtDate(e.joined)}</td><td class="num mono">${inr(e.salary)}</td></tr>`).join("") : `<tr><td colspan="7"><div class="empty">No one matches your search.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
function openEmployeeArchive(){
  const list = archivedEmployees.slice().sort((a,b)=>(b.leavingDate||'').localeCompare(a.leavingDate||''));
  showModal(`
    <div class="modal-head"><h3>Archived employees</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      ${list.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Employee</th><th>ID</th><th>Department</th><th>Joined</th><th>Left</th><th></th></tr></thead>
        <tbody>${list.map(e=>`<tr><td>${personCell(e)}</td><td class="muted mono">${e.id}</td><td class="muted">${esc(e.dept)}</td><td class="muted">${fmtDate(e.joined)}</td><td class="muted">${fmtDate(e.leavingDate||e.joined)}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm ghost" onclick="openEmployeeDetail('${e.id}')">View</button><button class="btn btn-sm ghost" onclick="reinstateEmployee('${e.id}')">Reinstate</button></div></td></tr>`).join("")}</tbody>
      </table></div>` : `<div class="empty">No one archived yet — confirming an employee's departure moves them here.</div>`}
    </div>
    <div class="modal-foot"><div></div><button type="button" class="btn ghost" onclick="closeModal()">Close</button></div>`);
}

let selectedAttendanceEmp = null;
function setAttendanceEmp(id){ selectedAttendanceEmp=id; render(); }
async function cycleAttendance(id, date){
  date = date || selectedAttendanceDate;
  const order=["present","late","half","wfh","absent","leave"];
  const dayMap = attendanceByDate[date];
  if(!dayMap) return;
  const cur=dayMap[id];
  const next = order[(order.indexOf(cur.status)+1)%order.length];
  cur.status = next; render(); // optimistic — snappy click feedback
  try{
    await apiJson("/api/hr/attendance", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ employeeId: employeeDbIdByCode[id], date, status: ATTENDANCE_TO_API[next] }) });
  }catch(err){
    cur.status = order[(order.indexOf(next)-1+order.length)%order.length]; // revert on failure
    toast(err.message || "Couldn't update attendance"); render();
  }
}

const MONTH_NAMES = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function attendanceHistoryFor(empId){
  const idx = employees.findIndex(x=>x.id===empId);
  const [jy,jm] = byId(empId).joined.split("-").map(Number);
  const [ty,tm] = TODAY.split("-").map(Number);
  const months = [];
  let y=jy, m=jm, i=0;
  while(y<ty || (y===ty && m<=tm)){
    const isCurrent = (y===ty && m===tm);
    const monthStr = `${y}-${String(m).padStart(2,'0')}`;
    const workingDays = isCurrent ? workingDaysMTD() : workingDaysInMonth(monthStr);
    const present = isCurrent ? (monthPresentDays[empId] ?? workingDays) : workingDays - ((idx*3 + i*5 + 2) % 4);
    const missed = workingDays - present;
    const leaveDays = Math.ceil(missed*0.6);
    const absentDays = missed - leaveDays;
    months.push({y, m, workingDays, present, leaveDays, absentDays});
    i++; m++; if(m>12){ m=1; y++; }
  }
  return months.reverse();
}
function openAttendanceHistory(empId){
  const e = byId(empId); const a = attendanceToday[empId];
  const months = attendanceHistoryFor(empId);
  const totals = months.reduce((s,mo)=>({working:s.working+mo.workingDays, present:s.present+mo.present, leave:s.leave+mo.leaveDays, absent:s.absent+mo.absentDays}), {working:0,present:0,leave:0,absent:0});
  const rate = totals.working ? ((totals.present/totals.working)*100).toFixed(1) : "0.0";
  showModal(`
    <div class="modal-head">
      <div class="person"><div class="mini-avatar" style="width:38px;height:38px;font-size:13px;">${initials(e.name)}</div><div><div style="font-weight:800;font-size:15px;">${esc(e.name)}</div><div class="person-role">${esc(e.role)} · ${esc(e.dept)}</div></div></div>
      <button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button>
    </div>
    <div class="modal-body">
      <div class="field-row">
        <div><label class="field-label">Joined</label><div>${fmtDate(e.joined)}</div></div>
        <div><label class="field-label">Today</label><div>${pill(attendanceLabel(a.status),statusKind(attendanceLabel(a.status)))}</div></div>
        <div><label class="field-label">Attendance rate since joining</label><div class="mono">${rate}%</div></div>
      </div>
      <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin:14px 0 18px;">
        <div class="kpi-card" style="box-shadow:none;padding:12px;"><div class="kpi-label">Working days</div><div class="kpi-value mono" style="font-size:18px;">${totals.working}</div></div>
        <div class="kpi-card" style="box-shadow:none;padding:12px;"><div class="kpi-label">Present</div><div class="kpi-value mono" style="font-size:18px;">${totals.present}</div></div>
        <div class="kpi-card" style="box-shadow:none;padding:12px;"><div class="kpi-label">On leave</div><div class="kpi-value mono" style="font-size:18px;">${totals.leave}</div></div>
        <div class="kpi-card" style="box-shadow:none;padding:12px;"><div class="kpi-label">Absent</div><div class="kpi-value mono neg" style="font-size:18px;">${totals.absent}</div></div>
      </div>
      <div class="section-label">Month-by-month, since joining</div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Month</th><th class="num">Working days</th><th class="num">Present</th><th class="num">Leave</th><th class="num">Absent</th><th class="num">Rate</th></tr></thead>
        <tbody>${months.map(mo=>{
          const mrate = mo.workingDays ? Math.round(mo.present/mo.workingDays*100) : 0;
          return `<tr><td>${MONTH_NAMES[mo.m]} ${mo.y}</td><td class="num mono">${mo.workingDays}</td><td class="num mono">${mo.present}</td><td class="num mono ${mo.leaveDays?"":"faint"}">${mo.leaveDays||"—"}</td><td class="num mono ${mo.absentDays?"neg":"faint"}">${mo.absentDays||"—"}</td><td class="num mono">${mrate}%</td></tr>`;
        }).join("")}</tbody>
      </table></div>
    </div>
    <div class="modal-foot"><div></div><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
}
function hrAttendance(){
  const date = selectedAttendanceDate;
  const isToday = date===TODAY;
  const dayMap = attendanceByDate[date] || {};
  const rows = employees.map(e=>({emp:e, a:dayMap[e.id] || {status:"present", in:null}}));
  const counts = {present:0,late:0,half:0,absent:0,leave:0,wfh:0};
  rows.forEach(r=>counts[r.a.status]++);
  const selected = byId(selectedAttendanceEmp) || employees[0];
  selectedAttendanceEmp = selected.id;
  const mtdWorkingDays = workingDaysMTD();
  const present = monthPresentDays[selected.id] ?? mtdWorkingDays;
  return `
  <div class="toolbar">
    <div style="display:flex;align-items:center;gap:10px;">
      <label class="field-label" style="margin:0;">Date</label>
      <input class="field-input" style="width:auto;" type="date" value="${date}" max="${TODAY}" onchange="setAttendanceDate(this.value)">
      ${!isToday ? `<button class="btn btn-sm ghost" onclick="setAttendanceDate('${TODAY}')">Back to today</button>` : ""}
    </div>
    <div></div>
  </div>
  <div class="kpi-grid cols-5">
    <div class="kpi-card"><div class="kpi-label">Present</div><div class="kpi-value mono">${counts.present}</div></div>
    <div class="kpi-card"><div class="kpi-label">Late / Half Day</div><div class="kpi-value mono warn">${counts.late+counts.half}</div></div>
    <div class="kpi-card"><div class="kpi-label">WFH</div><div class="kpi-value mono blue">${counts.wfh}</div></div>
    <div class="kpi-card"><div class="kpi-label">On Leave</div><div class="kpi-value mono">${counts.leave}</div></div>
    <div class="kpi-card"><div class="kpi-label">Absent</div><div class="kpi-value mono neg">${counts.absent}</div></div>
  </div>
  <div class="grid-2">
    <div class="panel">
      <div class="panel-head"><h3>${isToday?"Today's roster":fmtDate(date)+"'s roster"}</h3><div class="sub">${employees.length} team members${isToday?"":" · click a status to correct it for this date"}</div></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Employee</th><th>Department</th><th>Check-in</th><th>Status</th></tr></thead>
        <tbody>${rows.map(r=>`<tr class="row-click" onclick="openAttendanceHistory('${r.emp.id}')"><td>${personCell(r.emp)}</td><td class="muted">${esc(r.emp.dept)}</td><td class="num mono muted">${r.a.in||"—"}</td><td><button class="pill ${statusKind(attendanceLabel(r.a.status))}" onclick="event.stopPropagation();cycleAttendance('${r.emp.id}','${date}')">${attendanceLabel(r.a.status)}</button></td></tr>`).join("")}</tbody>
      </table></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>This month</h3></div>
      <div class="panel-body">
        <div class="field-label" style="margin-top:0;">Employee</div>
        <select class="field-input" style="margin-bottom:14px;" onchange="setAttendanceEmp(this.value)">${employees.map(e=>`<option value="${e.id}" ${e.id===selected.id?'selected':''}>${esc(e.name)}</option>`).join("")}</select>
        <div class="kpi-card" style="box-shadow:none;"><div class="kpi-label">Days present</div><div class="kpi-value mono">${present}<span style="font-size:14px;color:var(--ink-soft);font-family:Manrope;"> / ${mtdWorkingDays} working days</span></div><div class="kpi-sub">${present>=mtdWorkingDays?'full attendance this month':(mtdWorkingDays-present)+' day(s) missed'}</div></div>
      </div>
    </div>
  </div>`;
}

let leaveRequestsMonthFilter = "All";
async function setLeaveRequestsMonthFilter(v){
  leaveRequestsMonthFilter = v;
  const summaryMonth = (v!=='All' && v!=='Today') ? v : TODAY.slice(0,7);
  if(!attendanceMonthSummary[summaryMonth]) await loadAttendanceMonthSummary(summaryMonth).catch(()=>{});
  render();
}
function hrLeave(){
  const filtered = leaveRequests.filter(l=>matchesDateFilter(l.from, leaveRequestsMonthFilter));
  const sorted = filtered.slice().sort((a,b)=>{ const order={Pending:0,Approved:1,Rejected:2}; if(order[a.status]!==order[b.status]) return order[a.status]-order[b.status]; return b.applied.localeCompare(a.applied); });
  return `
  <div class="toolbar"><div class="filter-group"><span class="filter-label">Show</span><select class="select-sm" onchange="setLeaveRequestsMonthFilter(this.value)">${dateFilterOptions(leaveRequests.map(l=>l.from), leaveRequestsMonthFilter)}</select></div><button class="btn primary" onclick="openAddLeave()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New request</button></div>
  <div class="panel">
    <div class="panel-head"><h3>Requests</h3><div class="sub">${filtered.length} of ${leaveRequests.length}${dateFilterSuffix(leaveRequestsMonthFilter,'starting in')}</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th class="num">Days</th><th>Reason</th><th>Status</th><th></th></tr></thead>
      <tbody>${sorted.map(l=>{
        const emp=byId(l.empId);
        const range = l.from===l.to ? fmtDateShort(l.from) : `${fmtDateShort(l.from)} – ${fmtDateShort(l.to)}`;
        const actions = l.status==="Pending" ? `<div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm" onclick="decideLeave('${l.id}','Approved')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Approve</button><button class="btn btn-sm danger" onclick="decideLeave('${l.id}','Rejected')">Reject</button></div>` : (l.note ? `<span class="faint" style="font-size:11.5px;">${esc(l.note)}</span>` : "");
        return `<tr><td>${personCell(emp)}</td><td>${esc(l.type)}${l.duration && l.duration!=="Full Day" ? ` <span class="faint">· ${esc(l.duration)}</span>` : ""}</td><td class="muted">${range}</td><td class="num">${l.days}</td><td class="muted">${esc(l.reason)}</td><td>${pill(l.status,statusKind(l.status))}</td><td>${actions}</td></tr>`;
      }).join("") || `<tr><td colspan="7"><div class="empty">No leave requests${leaveRequestsMonthFilter==='All'?' yet':' for this range'}.</div></td></tr>`}</tbody>
    </table></div>
  </div>
  ${(()=>{
    // Marked "On Leave"/"WFH" in Attendance for the chosen month — computed the same way payroll's
    // Loss of Pay / WFH pay-cut are (computeLopDays()/computeWfhExcessDays()), both against the
    // org-wide monthly caps set in HR Settings. Monthly caps, not an annual balance — there's no
    // "Leave balances" table anymore, since that concept no longer exists in this policy.
    const summaryMonth = (leaveRequestsMonthFilter!=='All' && leaveRequestsMonthFilter!=='Today') ? leaveRequestsMonthFilter : TODAY.slice(0,7);
    const summary = attendanceMonthSummary[summaryMonth] || {};
    return `
  <div class="panel">
    <div class="panel-head"><h3>Leave &amp; WFH — ${esc(monthLabel(summaryMonth))}</h3><div class="sub">${hrPolicy.paidLeavesPerMonth} paid leave day${hrPolicy.paidLeavesPerMonth===1?'':'s'} &amp; ${hrPolicy.paidWfhPerMonth} paid WFH day${hrPolicy.paidWfhPerMonth===1?'':'s'} per employee per month — set in HR Settings</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Employee</th><th class="num">On Leave</th><th class="num">LOP days</th><th class="num">WFH</th><th class="num">WFH pay-cut days</th></tr></thead>
      <tbody>${employees.map(e=>{ const c=summary[e.id]||{leave:0,wfh:0}; const lop=Math.max(0,c.leave-hrPolicy.paidLeavesPerMonth); const wfhCut=Math.max(0,c.wfh-hrPolicy.paidWfhPerMonth); return `<tr><td>${personCell(e)}</td><td class="num">${c.leave||'—'}</td><td class="num ${lop>0?'warn':''}">${lop||'—'}</td><td class="num">${c.wfh||'—'}</td><td class="num ${wfhCut>0?'warn':''}">${wfhCut||'—'}</td></tr>`; }).join("")}</tbody>
    </table></div>
  </div>`;
  })()}`;
}

function hrHiring(){
  const activePositions = openPositions.filter(p=>!p.archived);
  const archivedPositions = openPositions.filter(p=>p.archived);
  const activeCandidates = candidates.filter(c=>!c.archived);
  const archivedCandidates = candidates.filter(c=>c.archived);
  const shortlisted = activeCandidates.filter(c=>c.stage==="Shortlisted");
  return `
  <div class="toolbar">
    <div></div>
    <div style="display:flex;gap:8px;">
      <button class="btn ghost" onclick="openApplicationLink()"><svg class="icon" style="width:13px;height:13px"><use href="#i-link"/></svg>Get application link</button>
      <button class="btn ghost" onclick="openOfferLetter()"><svg class="icon" style="width:13px;height:13px"><use href="#i-file"/></svg>Generate offer letter</button>
      <button class="btn primary" onclick="openAddPosition()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New position</button>
    </div>
  </div>
  <div class="panel">
    <div class="panel-head"><div><h3>Open positions</h3><div class="sub">One application link covers every open role below — share it on hiring posts and WhatsApp broadcasts</div></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Role</th><th>Department</th><th class="num">Openings</th><th>Posted</th><th>Status</th><th class="num">Candidates</th><th></th></tr></thead>
      <tbody>${activePositions.map(p=>`<tr><td class="cell-strong" style="font-weight:700;">${esc(p.role)}</td><td class="muted">${esc(p.dept)}</td><td class="num">${p.openings}</td><td class="muted">${fmtDate(p.postedDate)}</td><td>${pill(p.status,statusKind(p.status))}</td><td class="num mono">${activeCandidates.filter(c=>c.posId===p.id).length}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm ghost" onclick="openEditPosition('${p.id}')" title="Edit"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg></button>${p.status==="Closed"?`<button class="btn btn-sm ghost" onclick="archivePosition('${p.id}')" title="Archive"><svg class="icon" style="width:12px;height:12px"><use href="#i-archive"/></svg></button>`:""}</div></td></tr>`).join("") || `<tr><td colspan="7"><div class="empty">No open positions.</div></td></tr>`}</tbody>
    </table></div>
  </div>
  ${archivedPositions.length ? `
  <div class="panel">
    <div class="panel-head"><div><h3>Archived positions</h3><div class="sub">Closed roles, kept for the record</div></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Role</th><th>Department</th><th>Posted</th><th>Status</th><th></th></tr></thead>
      <tbody>${archivedPositions.map(p=>`<tr><td class="muted">${esc(p.role)}</td><td class="muted">${esc(p.dept)}</td><td class="muted">${fmtDate(p.postedDate)}</td><td>${pill(p.status,statusKind(p.status))}</td><td><button class="btn btn-sm ghost" onclick="unarchivePosition('${p.id}')">Reopen</button></td></tr>`).join("")}</tbody>
    </table></div>
  </div>` : ""}
  ${shortlisted.length ? `
  <div class="panel">
    <div class="panel-head"><div><h3>Shortlisted candidates</h3><div class="sub">${shortlisted.length} ready for the next round</div></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Candidate</th><th>Applying for</th><th>Contact</th><th>Applied</th><th></th></tr></thead>
      <tbody>${shortlisted.map(c=>{ const pos=openPositions.find(p=>p.id===c.posId); return `<tr><td style="font-weight:700;">${esc(c.name)}</td><td class="muted">${pos?esc(pos.role):"—"}</td><td class="muted mono" style="font-size:12px;">${esc(c.phone)}</td><td class="muted">${fmtDate(c.appliedDate)}</td><td><button class="btn btn-sm ghost" onclick="openOfferLetter('${c.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-file"/></svg>Offer letter</button></td></tr>`; }).join("")}</tbody>
    </table></div>
  </div>` : ""}
  <div class="panel">
    <div class="panel-head"><h3>Candidates</h3><div class="sub">${activeCandidates.length} in pipeline</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Candidate</th><th>Applying for</th><th>Contact</th><th>Applied</th><th>Stage</th><th></th></tr></thead>
      <tbody>${activeCandidates.map(c=>{ const pos=openPositions.find(p=>p.id===c.posId); return `<tr><td style="font-weight:700;">${esc(c.name)}</td><td class="muted">${pos?esc(pos.role):"—"}</td><td class="muted mono" style="font-size:12px;">${esc(c.phone)}</td><td class="muted">${fmtDate(c.appliedDate)}</td><td><select class="select-sm" onchange="updateCandidateStage('${c.id}',this.value)">${CANDIDATE_STAGES.map(s=>`<option value="${s}" ${s===c.stage?'selected':''}>${s}</option>`).join("")}</select></td><td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm ghost" onclick="openOfferLetter('${c.id}')" title="Offer letter"><svg class="icon" style="width:12px;height:12px"><use href="#i-file"/></svg></button><button class="btn btn-sm ghost" onclick="archiveCandidate('${c.id}')" title="Archive"><svg class="icon" style="width:12px;height:12px"><use href="#i-archive"/></svg></button></div></td></tr>`; }).join("") || `<tr><td colspan="6"><div class="empty">No candidates in the pipeline.</div></td></tr>`}</tbody>
    </table></div>
  </div>
  ${archivedCandidates.length ? `
  <div class="panel">
    <div class="panel-head"><div><h3>Archived candidates</h3><div class="sub">${archivedCandidates.length} out of the active pipeline</div></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Candidate</th><th>Applying for</th><th>Stage when archived</th><th></th></tr></thead>
      <tbody>${archivedCandidates.map(c=>{ const pos=openPositions.find(p=>p.id===c.posId); return `<tr><td class="muted">${esc(c.name)}</td><td class="muted">${pos?esc(pos.role):"—"}</td><td>${pill(c.stage,statusKind(c.stage))}</td><td><button class="btn btn-sm ghost" onclick="unarchiveCandidate('${c.id}')">Restore</button></td></tr>`; }).join("")}</tbody>
    </table></div>
  </div>` : ""}`;
}
function openEditPosition(id){
  const p = openPositions.find(x=>x.id===id);
  showModal(`
    <div class="modal-head"><h3>Edit position</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-edit-position"><div class="modal-body">
      <div><label class="field-label">Role</label><input class="field-input" name="role" required value="${esc(p.role)}"></div>
      <div class="field-row">
        <div><label class="field-label">Department</label><select class="field-input" name="dept">${DEPARTMENTS.map(d=>`<option ${d===p.dept?'selected':''}>${esc(d)}</option>`).join("")}</select></div>
        <div><label class="field-label">Openings</label><input class="field-input" type="number" name="openings" min="1" value="${p.openings}" required></div>
      </div>
      <div><label class="field-label">Status</label><select class="field-input" name="status"><option value="Open" ${p.status==='Open'?'selected':''}>Open</option><option value="On Hold" ${p.status==='On Hold'?'selected':''}>On Hold</option><option value="Closed" ${p.status==='Closed'?'selected':''}>Closed</option></select></div>
      <div class="subtext">Mark it Closed once hiring is done — that's what unlocks the archive option.</div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save</button></div></div>
    </form>`);
  document.getElementById("f-edit-position").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      await apiJson(`/api/hr/positions/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ role:f.get("role"), dept:f.get("dept"), openings:Number(f.get("openings")), status:TITLECASE_TO_API(f.get("status")) }) });
      await loadHiring();
      toast("Position updated"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't update position"); }
  });
}
async function archivePosition(id){
  const p = openPositions.find(x=>x.id===id);
  try{
    await apiJson(`/api/hr/positions/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ archived:true }) });
    await loadHiring();
    toast(p.role+" archived"); render();
  }catch(err){ toast(err.message || "Couldn't archive position"); }
}
async function unarchivePosition(id){
  const p = openPositions.find(x=>x.id===id);
  try{
    await apiJson(`/api/hr/positions/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ archived:false }) });
    await loadHiring();
    toast(p.role+" reopened"); render();
  }catch(err){ toast(err.message || "Couldn't reopen position"); }
}
async function archiveCandidate(id){
  const c = candidates.find(x=>x.id===id);
  try{
    await apiJson(`/api/hr/candidates/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ archived:true }) });
    await loadHiring();
    toast(c.name+" archived"); render();
  }catch(err){ toast(err.message || "Couldn't archive candidate"); }
}
async function unarchiveCandidate(id){
  const c = candidates.find(x=>x.id===id);
  try{
    await apiJson(`/api/hr/candidates/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ archived:false }) });
    await loadHiring();
    toast(c.name+" restored"); render();
  }catch(err){ toast(err.message || "Couldn't restore candidate"); }
}

// The payroll table itself — shared by HR > Payroll and Accounts > Payroll (same data, same
// actions: add to payroll, pay, payslip, edit). Only HR's copy also carries the leave-pay policy notes.
// readOnly hides the Pay action — Accounts/Finance is the only one who
// records an actual payroll payment; HR can add people to a cycle and
// adjust gross pay, but paying is Accounts' call (see hrPayroll()).
function payrollView(readOnly){
  const month = payroll.selectedMonth;
  const includedIds = Object.keys(payroll.history[month].entries);
  // A departed employee's already-recorded entry (e.g. a final settlement) should stay visible here
  // even after they're archived and drop out of `employees` — so look them up in both pools.
  const includedEmployees = [...employees, ...archivedEmployees].filter(e=>includedIds.includes(e.id)).sort((a,b)=>a.name.localeCompare(b.name));
  // Sales draws no salary (commission-only, see SALES_COMMISSION_RATE) — never
  // nag to "add them to payroll"; if one already has an entry (e.g. left over
  // from before this was fixed), it still shows above via includedEmployees.
  const pendingEmployees = employees.filter(e=>!includedIds.includes(e.id) && e.dept!=='Sales');
  const rows = includedEmployees.map(e=>({emp:e, calc:computePayrollRow(e,month)}));
  const totals = rows.reduce((s,r)=>({gross:s.gross+r.calc.gross, ded:s.ded+r.calc.totalDeductions, net:s.net+r.calc.net, paid:s.paid+r.calc.paid, balance:s.balance+r.calc.balance}),{gross:0,ded:0,net:0,paid:0,balance:0});
  const status = payrollMonthStatus(month);
  return `
  <div class="toolbar">
    <select class="select-sm" onchange="setPayrollMonth(this.value)">${Object.keys(payroll.history).sort().reverse().map(m=>`<option value="${m}" ${m===month?'selected':''}>${MONTH_LABEL[m]}</option>`).join("")}</select>
    <div style="display:flex;align-items:center;gap:10px;">
      <span class="faint" style="font-size:12px;">${includedEmployees.length} of ${employees.filter(e=>e.dept!=='Sales').length} added</span>
      ${pill(status,statusKind(status))}
    </div>
  </div>
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-label">Gross pay</div><div class="kpi-value mono" style="font-size:20px;">${inr(totals.gross)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Deductions</div><div class="kpi-value mono" style="font-size:20px;">${inr(totals.ded)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Paid so far</div><div class="kpi-value mono pos" style="font-size:20px;">${inr(totals.paid)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Balance due</div><div class="kpi-value mono ${totals.balance>0?'warn':''}" style="font-size:20px;">${inr(totals.balance)}</div></div>
  </div>
  ${pendingEmployees.length ? `
  <div class="panel">
    <div class="panel-head"><div><h3>Not yet added</h3><div class="sub">Check and confirm each employee's salary for ${MONTH_LABEL[month]} — nothing here counts toward payroll until it's added</div></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Employee</th><th>Department</th><th class="num">Master salary</th><th></th></tr></thead>
      <tbody>${pendingEmployees.map(e=>`<tr><td>${personCell(e)}</td><td class="muted">${esc(e.dept)}</td><td class="num mono">${inr(e.salary)}</td><td><button class="btn btn-sm primary" onclick="openAddPayrollEntry('${e.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Add to payroll</button></td></tr>`).join("")}</tbody>
    </table></div>
  </div>` : ""}
  <div class="panel">
    <div class="panel-head"><h3>Payroll — ${MONTH_LABEL[month]}</h3><div class="sub">${includedEmployees.length} added</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Employee</th><th class="num">Gross</th><th class="num">Deductions</th><th class="num">Net pay</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.length ? rows.map(r=>`<tr><td>${personCell(r.emp)}</td><td class="num mono">${inr(r.calc.gross)}</td><td class="num mono">${inr(r.calc.totalDeductions)}${r.calc.lopDeduction>0?`<div class="subtext" style="color:var(--neg);text-align:right;">incl. ${r.calc.lopDays}d LOP</div>`:""}${r.calc.wfhDeduction>0?`<div class="subtext" style="color:var(--neg);text-align:right;">incl. ${r.calc.wfhExcessDays}d WFH</div>`:""}</td><td class="num mono" style="font-weight:700;">${inr(r.calc.net)}</td><td class="num mono ${r.calc.paid>0?'':'faint'}">${r.calc.paid>0?inr(r.calc.paid):'—'}</td><td class="num mono ${r.calc.balance>0?'warn':'faint'}">${r.calc.balance>0?inr(r.calc.balance):'—'}</td><td>${pill(r.calc.payStatus,statusKind(r.calc.payStatus))}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;">${(!readOnly && r.calc.balance>0)?`<button class="btn btn-sm" onclick="openRecordPayment('${r.emp.id}')">Pay</button>`:""}<button class="btn btn-sm ghost" onclick="openPayslip('${r.emp.id}',${!!readOnly})">Payslip</button><button class="btn btn-sm ghost" onclick="openAddPayrollEntry('${r.emp.id}')" title="Edit gross"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg></button></div></td></tr>`).join("") : `<tr><td colspan="8"><div class="empty">No one added to this month's payroll yet.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
function hrPayroll(){
  return `
  <div class="banner muted">
    <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
    <div><b>Payments are Accounts' call.</b> You can add employees to a cycle and adjust gross pay here — Finance handles recording the actual payments in Accounts &gt; Payroll, and it shows up here the moment they do.</div>
  </div>` + payrollView(true) + `
  <div class="panel">
    <div class="panel-head">
      <div><h3>Leave &amp; WFH pay policy</h3><div class="sub">Loss of Pay for leave beyond balance, and the WFH pay cut, are already applied above · half/quarter-day leave is still open</div></div>
    </div>
    <div class="panel-body">
      <div class="banner muted">
        <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
        <div><b>Loss of Pay and WFH pay cut are both live.</b> Casual/Sick/Earned days beyond each employee's HR Settings balance, and any approved Unpaid leave, are already deducted in the Gross → Net figures above — and so are WFH days beyond the HR Settings cap, at 75% pay. Half/quarter-day leave doesn't have a fixed salary rule yet — jot it down below as it firms up.</div>
      </div>
      <label class="field-label" style="margin-top:12px;">Policy notes</label>
      <textarea class="field-input" id="policy-notes-textarea" rows="4" style="resize:vertical;font-family:inherit;" placeholder="e.g. WFH counts as full attendance; quarter-day leave deducts 0.25 day's gross...">${esc(leavePayPolicy.notes)}</textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;"><button class="btn btn-sm" onclick="saveLeavePayPolicyNotes()">Save notes</button></div>
    </div>
  </div>`;
}
function acctPayroll(){ return payrollView(); }
async function saveLeavePayPolicyNotes(){
  try{
    await apiJson("/api/hr/policy", { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ leavePayNotes: document.getElementById("policy-notes-textarea").value }) });
    await loadPolicy();
    toast("Policy notes saved");
  }catch(err){ toast(err.message || "Couldn't save notes"); }
}

function hrAdvances(){
  const filtered = advances.filter(a=>matchesDateFilter(a.requested, advancesMonthFilter));
  const sorted = filtered.slice().sort((a,b)=>{ const order={Pending:0,Recovering:1,Recovered:2,Rejected:3}; if(order[a.status]!==order[b.status]) return order[a.status]-order[b.status]; return b.requested.localeCompare(a.requested); });
  return `
  <div class="toolbar"><div class="filter-group"><span class="filter-label">Show</span><select class="select-sm" onchange="setAdvancesMonthFilter(this.value)">${dateFilterOptions(advances.map(a=>a.requested), advancesMonthFilter)}</select></div><button class="btn primary" onclick="openAddAdvance()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New request</button></div>
  <div class="panel">
    <div class="panel-head"><h3>Requests</h3><div class="sub">${filtered.length} of ${advances.length}${dateFilterSuffix(advancesMonthFilter,'requested in')} · approved advances recover automatically from payroll</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Employee</th><th class="num">Amount</th><th>Reason</th><th>Requested</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
      <tbody>${sorted.map(a=>{
        const emp=byId(a.empId);
        const actions = a.status==="Pending" ? `<div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm" onclick="decideAdvance('${a.id}','Recovering')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Approve</button><button class="btn btn-sm danger" onclick="decideAdvance('${a.id}','Rejected')">Reject</button></div>` : a.status==='Rejected' ? `<span class="faint" style="font-size:11.5px;">${a.note||''}</span>` : `<span class="faint" style="font-size:11.5px;">${inr(a.monthlyDeduction)}/mo</span>${a.paidDate?`<div class="subtext">Paid out ${fmtDateShort(a.paidDate)}</div>`:`<div class="subtext" style="color:var(--warn);">Awaiting payout — Accounts &gt; Payment Requests</div>`}`;
        return `<tr><td>${personCell(emp)}</td><td class="num mono">${inr(a.amount)}</td><td class="muted">${esc(a.reason)}</td><td class="muted">${fmtDate(a.requested)}</td><td class="num mono">${a.status==='Rejected'?'—':inr(a.balance)}</td><td>${pill(a.status,statusKind(a.status))}</td><td>${actions}</td></tr>`;
      }).join("")}</tbody>
    </table></div>
  </div>`;
}

function hrComplaints(){
  const sorted = complaints.slice().sort((a,b)=>{ const order={New:0,Reviewed:1,Resolved:2}; if(order[a.status]!==order[b.status]) return order[a.status]-order[b.status]; return b.submitted.localeCompare(a.submitted); });
  return `
  <div class="banner muted">
    <svg class="icon" style="width:15px;height:15px"><use href="#i-megaphone"/></svg>
    <div><b>Anonymous by design.</b> A submission carries no name, employee ID or contact detail — only the category, an optional department, and the message. Share this page with the team so anyone can raise something without being identified.</div>
  </div>
  <div class="toolbar">
    <span class="faint" style="font-size:12px;">${complaints.filter(c=>c.status==="New").length} new · ${complaints.length} total</span>
    <button class="btn primary" onclick="openSubmitComplaint()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Submit a complaint</button>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Submissions</h3></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Category</th><th>Department</th><th>Message</th><th>Submitted</th><th>Status</th><th></th></tr></thead>
      <tbody>${sorted.length ? sorted.map(c=>`<tr><td><span class="tag type">${esc(c.category)}</span></td><td class="muted">${c.dept?esc(c.dept):'—'}</td><td class="muted" style="max-width:280px;">${esc(c.text)}</td><td class="muted">${fmtDate(c.submitted)}</td><td>${pill(c.status,statusKind(c.status))}</td><td><button class="btn btn-sm ghost" onclick="openReviewComplaint('${c.id}')">${c.status==='New'?'Review':'View'}</button></td></tr>`).join("") : `<tr><td colspan="6"><div class="empty">No complaints submitted yet.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
function openSubmitComplaint(){
  showModal(`
    <div class="modal-head"><h3>Submit a complaint</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-submit-complaint"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-megaphone"/></svg><div>This form doesn't ask for your name or employee ID — nothing here can identify who submitted it.</div></div>
      <div class="field-row">
        <div><label class="field-label">Category</label><select class="field-input" name="category">${COMPLAINT_CATEGORIES.map(c=>`<option>${esc(c)}</option>`).join('')}</select></div>
        <div><label class="field-label">Department (optional)</label><select class="field-input" name="dept"><option value="">— Prefer not to say —</option>${DEPARTMENTS.map(d=>`<option>${esc(d)}</option>`).join('')}</select></div>
      </div>
      <div><label class="field-label">What happened</label><textarea class="field-input" name="text" rows="5" required placeholder="Describe the issue — as much detail as you're comfortable sharing"></textarea></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Submit anonymously</button></div></div>
    </form>`);
  document.getElementById("f-submit-complaint").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      await apiJson("/api/hr/complaints", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ category:f.get("category"), dept:f.get("dept")||undefined, text:f.get("text") }) });
      if(isHRRole(currentUser) || (currentUser && currentUser.isAdmin)) await loadComplaints();
      toast("Complaint submitted anonymously"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't submit complaint"); }
  });
}
function openReviewComplaint(id){
  const c = complaints.find(x=>x.id===id);
  showModal(`
    <div class="modal-head"><h3>${esc(c.category)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div class="field-row">
        <div><label class="field-label">Department</label><div>${c.dept?esc(c.dept):'Not specified'}</div></div>
        <div><label class="field-label">Submitted</label><div>${fmtDate(c.submitted)}</div></div>
      </div>
      <label class="field-label" style="margin-top:10px;">Message</label>
      <div class="panel" style="background:var(--surface-sunk);box-shadow:none;padding:12px;font-size:13px;line-height:1.5;">${esc(c.text)}</div>
      <label class="field-label" style="margin-top:12px;">HR notes</label>
      <textarea class="field-input" id="complaint-note" rows="3" placeholder="Internal notes — action taken, follow-up needed">${esc(c.note||"")}</textarea>
    </div>
    <div class="modal-foot">
      <div></div>
      <div style="display:flex;gap:8px;">
        ${c.status==="New"?`<button class="btn" onclick="setComplaintStatus('${c.id}','Reviewed')">Mark reviewed</button>`:""}
        ${c.status!=="Resolved"?`<button class="btn primary" onclick="setComplaintStatus('${c.id}','Resolved')">Mark resolved</button>`:`<button class="btn ghost" onclick="setComplaintStatus('${c.id}','Resolved')">Save notes</button>`}
      </div>
    </div>`);
}
async function setComplaintStatus(id, status){
  const noteEl = document.getElementById("complaint-note");
  const note = noteEl ? noteEl.value : undefined;
  try{
    await apiJson(`/api/hr/complaints/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ status: TITLECASE_TO_API(status), note }) });
    await loadComplaints();
    toast(`Complaint marked ${status.toLowerCase()}`); closeModal(); render();
  }catch(err){ toast(err.message || "Couldn't update complaint"); }
}

/* ===================== HR NOTICES (broadcast to every team member) ===================== */
function hrNotices(){
  const sorted = notices.slice().sort((a,b)=>b.postedDate.localeCompare(a.postedDate));
  return `
  <div class="toolbar"><div></div><button class="btn primary" onclick="openPostNotice()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Post notice</button></div>
  <div class="panel">
    <div class="panel-head"><h3>Notices</h3><div class="sub">Shown on every team member's workspace overview</div></div>
    <div class="panel-body" style="display:flex;flex-direction:column;gap:10px;">
      ${sorted.length ? sorted.map(n=>`
        <div class="panel" style="box-shadow:none;background:var(--surface-sunk);padding:14px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
            <div>
              <div style="font-weight:800;font-size:13.5px;">${esc(n.title)}</div>
              <div class="subtext" style="margin-top:2px;">${esc(n.postedBy)} · ${fmtDate(n.postedDate)}</div>
            </div>
            <div style="display:flex;gap:6px;flex:none;">
              <button class="btn btn-sm ghost" onclick="openEditNotice('${n.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg></button>
              <button class="btn btn-sm danger" onclick="deleteNotice('${n.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button>
            </div>
          </div>
          <div style="font-size:13px;color:var(--ink-soft);margin-top:8px;line-height:1.5;">${esc(n.message)}</div>
        </div>`).join('') : '<div class="empty">No notices posted yet.</div>'}
    </div>
  </div>`;
}
function openPostNotice(){
  showModal(`
    <div class="modal-head"><h3>Post a notice</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-post-notice"><div class="modal-body">
      <div><label class="field-label">Title</label><input class="field-input" name="title" required placeholder="e.g. Diwali holiday schedule"></div>
      <div><label class="field-label">Message</label><textarea class="field-input" name="message" rows="4" required placeholder="What everyone needs to know"></textarea></div>
      <div class="subtext">Posted as ${currentUser?esc(currentUser.name):'you'} — the real signed-in account, not a free-typed name.</div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Post notice</button></div></div>
    </form>`);
  document.getElementById("f-post-notice").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      await apiJson("/api/hr/notices", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ title:f.get("title"), message:f.get("message") }) });
      await loadNotices();
      toast("Notice posted"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't post notice"); }
  });
}
function openEditNotice(id){
  const n = notices.find(x=>x.id===id);
  showModal(`
    <div class="modal-head"><h3>Edit notice</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-edit-notice"><div class="modal-body">
      <div><label class="field-label">Title</label><input class="field-input" name="title" required value="${esc(n.title)}"></div>
      <div><label class="field-label">Message</label><textarea class="field-input" name="message" rows="4" required>${esc(n.message)}</textarea></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save changes</button></div></div>
    </form>`);
  document.getElementById("f-edit-notice").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      await apiJson(`/api/hr/notices/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ title:f.get("title"), message:f.get("message") }) });
      await loadNotices();
      toast("Notice updated"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't update notice"); }
  });
}
async function deleteNotice(id){
  try{
    await Auth.apiFetch(`/api/hr/notices/${id}`, { method:"DELETE" });
    await loadNotices();
    toast("Notice removed"); render();
  }catch(err){ toast("Couldn't remove notice"); }
}

function hrCalendarPanel(){
  const monthStr = hrCalendarMonth;
  const [y,m] = monthStr.split("-").map(Number);
  const last = daysInCalendarMonth(y,m);
  const firstDow = new Date(`${monthStr}-01T00:00:00`).getDay();
  const events = calendarEventsForMonth(monthStr);
  const cells = [];
  for(let i=0;i<firstDow;i++) cells.push(`<div class="cal-day empty"></div>`);
  for(let d=1; d<=last; d++){
    const dateStr = `${monthStr}-${String(d).padStart(2,'0')}`;
    const ev = events[d];
    const isToday = dateStr===TODAY;
    const isOff = new Date(dateStr+"T00:00:00").getDay()===hrPolicy.weeklyOff;
    const isHoliday = ev.holidays.length>0;
    const badges = [];
    if(isHoliday) badges.push(`<div class="cal-badge holiday" title="${esc(ev.holidays.join(', '))}">${esc(ev.holidays[0])}</div>`);
    if(ev.birthdays.length) badges.push(`<div class="cal-badge birthday" title="${esc(ev.birthdays.map(e=>e.name).join(', '))}">🎂 ${ev.birthdays.length===1?esc(ev.birthdays[0].name.split(' ')[0]):ev.birthdays.length+' birthdays'}</div>`);
    if(ev.anniversaries.length) badges.push(`<div class="cal-badge anniversary" title="${esc(ev.anniversaries.map(a=>a.emp.name+' — '+a.years+'yr').join(', '))}">🎉 ${ev.anniversaries.length===1?esc(ev.anniversaries[0].emp.name.split(' ')[0])+' · '+ev.anniversaries[0].years+'yr':ev.anniversaries.length+' anniversaries'}</div>`);
    cells.push(`<div class="cal-day ${isOff?'off':''} ${isHoliday?'holiday':''} ${isToday?'today':''}" onclick="openCalendarDay('${dateStr}')">
      <div class="cal-daynum">${d}</div>
      <div class="cal-badges">${badges.join('')}</div>
    </div>`);
  }
  return `
  <div class="panel">
    <div class="panel-head">
      <div><h3>Calendar</h3><div class="sub">Holidays, birthdays and work anniversaries — click a day to mark or view</div></div>
      <div style="display:flex;align-items:center;gap:10px;">
        <button class="btn btn-sm ghost" onclick="setHrCalendarMonth(-1)">‹</button>
        <span style="font-weight:700;font-size:13px;min-width:110px;text-align:center;">${MONTH_NAMES[m]} ${y}</span>
        <button class="btn btn-sm ghost" onclick="setHrCalendarMonth(1)">›</button>
      </div>
    </div>
    <div class="panel-body">
      <div class="cal-legend">
        <span class="cal-legend-item"><span class="dot holiday"></span>Holiday</span>
        <span class="cal-legend-item"><span class="dot off"></span>Weekly off</span>
        <span class="cal-legend-item"><span class="dot birthday"></span>🎂 Birthday</span>
        <span class="cal-legend-item"><span class="dot anniversary"></span>🎉 Work anniversary</span>
      </div>
      <div class="cal-weekdays">${WEEKDAY_NAMES.map(w=>`<div>${w.slice(0,3)}</div>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
    </div>
  </div>`;
}
function openCalendarDay(dateStr){
  const [y,m,d] = dateStr.split("-").map(Number);
  const events = calendarEventsForMonth(`${y}-${String(m).padStart(2,'0')}`)[d];
  const holiday = hrPolicy.holidays.find(h=>h.date===dateStr);
  showModal(`
    <div class="modal-head"><h3>${fmtDate(dateStr)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      ${holiday ? `
        <div class="banner"><svg class="icon" style="width:15px;height:15px"><use href="#i-calendar"/></svg><div><b>${esc(holiday.name)}</b> is marked as a company holiday.</div></div>
        <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button class="btn btn-sm danger" onclick="removeHoliday('${dateStr}'); closeModal();">Remove holiday</button></div>
      ` : `
        <label class="field-label">Mark this day as a holiday</label>
        <form onsubmit="return quickAddHoliday(event,'${dateStr}')" style="display:flex;gap:8px;">
          <input class="field-input" id="quick-holiday-name" placeholder="Holiday name" required style="flex:1;">
          <button type="submit" class="btn btn-sm primary">Add</button>
        </form>
      `}
      ${events.birthdays.length ? `<div class="section-label" style="margin-top:16px;">Birthdays 🎂</div>${events.birthdays.map(e=>`<div class="calc-line"><span>${personCell(e)}</span></div>`).join('')}` : ""}
      ${events.anniversaries.length ? `<div class="section-label" style="margin-top:16px;">Work anniversaries 🎉</div>${events.anniversaries.map(a=>`<div class="calc-line"><span>${personCell(a.emp)}</span><span class="mono">${a.years} yr${a.years===1?"":"s"}</span></div>`).join('')}` : ""}
      ${(!events.birthdays.length && !events.anniversaries.length && !holiday) ? `<div class="empty" style="margin-top:10px;">No birthdays or anniversaries on this day.</div>` : ""}
    </div>
    <div class="modal-foot"><div></div><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
}
function quickAddHoliday(e, dateStr){
  e.preventDefault();
  const name = document.getElementById("quick-holiday-name").value.trim();
  if(!name) return false;
  apiJson("/api/hr/policy/holidays", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ date:dateStr, name }) })
    .then(async ()=>{
      await loadPolicy();
      toast("Holiday added"); closeModal();
      if(document.getElementById("content")) document.getElementById("content").innerHTML = hrPolicies();
    })
    .catch(err=>toast(err.message || "Couldn't add holiday"));
  return false;
}
function hrPolicies(){
  const sortedHolidays = hrPolicy.holidays.slice().sort((a,b)=>a.date.localeCompare(b.date));
  return `
  <div class="banner">
    <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
    <div><b>HR Settings.</b> One place for HRM to set company-wide rules — leave entitlements, the holiday calendar and other general policy — instead of it being hardcoded per screen. Changes here apply everywhere they're used.</div>
  </div>
  ${hrCalendarPanel()}
  <div class="panel">
    <div class="panel-head"><h3>Monthly paid leave &amp; WFH allowance</h3><div class="sub">What actually drives payroll's Loss of Pay and WFH pay-cut, every month</div></div>
    <div class="panel-body">
      <div class="field-row">
        <div><label class="field-label">Paid leave (days/month)</label><input class="field-input" id="policy-paid-leaves" type="number" min="0" step="1" value="${hrPolicy.paidLeavesPerMonth}"></div>
        <div><label class="field-label">Paid WFH (days/month)</label><input class="field-input" id="policy-paid-wfh" type="number" min="0" step="1" value="${hrPolicy.paidWfhPerMonth}"></div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button class="btn primary btn-sm" onclick="saveLeavePayCaps()">Save caps</button></div>
      <div class="banner muted" style="margin-top:14px;">
        <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
        <div><b>Loss of Pay &amp; WFH cut, automatic.</b> Any day beyond the paid-leave cap, marked "On Leave" in Attendance that same month, is a full day's Loss of Pay. Any day beyond the paid-WFH cap, marked "Work From Home", is paid at 75% instead of full pay. Both are calculated straight from Attendance and apply the moment someone's added to that month's payroll. Leave is tracked monthly only — there's no separate annual entitlement to configure.</div>
      </div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-head"><div><h3>Working days</h3><div class="sub">Weekly off + marked holidays — every other day counts as a working day, automatically, across Attendance, Leave and Payroll</div></div></div>
    <div class="panel-body" style="padding-bottom:6px;">
      <div class="field-row cols-3">
        <div><label class="field-label">Weekly off</label><select class="field-input" id="policy-weekly-off" onchange="saveWeeklyOff(this.value)">${WEEKDAY_NAMES.map((d,i)=>`<option value="${i}" ${hrPolicy.weeklyOff===i?'selected':''}>${d}</option>`).join('')}</select></div>
        <div><label class="field-label">This month's working days</label><div class="field-input" style="background:var(--surface);display:flex;align-items:center;">${workingDaysInMonth(TODAY.slice(0,7))} days</div></div>
        <div><label class="field-label">Holidays on record</label><div class="field-input" style="background:var(--surface);display:flex;align-items:center;">${sortedHolidays.length}</div></div>
      </div>
    </div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Holiday</th><th></th><th></th></tr></thead>
      <tbody>${sortedHolidays.length ? sortedHolidays.map(h=>`<tr><td class="mono ${h.date<TODAY?"faint":""}">${fmtDate(h.date)}</td><td>${esc(h.name)}</td><td>${h.date<TODAY?'<span class="faint" style="font-size:11px;">Past</span>':""}</td><td><button class="btn btn-sm ghost" onclick="removeHoliday('${h.date}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button></td></tr>`).join("") : `<tr><td colspan="4"><div class="empty">No holidays added yet.</div></td></tr>`}</tbody>
    </table></div>
    <form onsubmit="return addHoliday(event)" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:14px 18px;border-top:1px solid var(--line);">
      <input class="field-input" type="date" id="new-holiday-date" required style="width:160px;">
      <input class="field-input" id="new-holiday-name" placeholder="Holiday name" required style="flex:1;min-width:160px;">
      <button type="submit" class="btn primary btn-sm"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Add holiday</button>
    </form>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>General HR policy notes</h3><div class="sub">Anything else HRM wants documented as it's decided — probation length, notice period, comp-off rules, late-marking grace time</div></div>
    <div class="panel-body">
      <textarea class="field-input" id="policy-general-notes" rows="5" style="resize:vertical;font-family:inherit;" placeholder="e.g. Probation period: 3 months. Notice period: 30 days. Comp-off must be used within 30 days of the worked weekend...">${esc(hrPolicy.notes)}</textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;"><button class="btn btn-sm" onclick="saveGeneralPolicyNotes()">Save notes</button></div>
    </div>
  </div>`;
}
async function saveLeavePayCaps(){
  try{
    await apiJson("/api/hr/policy", { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({
      paidLeavesPerMonth: Number(document.getElementById("policy-paid-leaves").value) || 0,
      paidWfhPerMonth: Number(document.getElementById("policy-paid-wfh").value) || 0,
    })});
    await loadPolicy();
    toast("Monthly leave & WFH caps updated"); render();
  }catch(err){ toast(err.message || "Couldn't save leave & WFH caps"); }
}
async function saveWeeklyOff(val){
  try{
    await apiJson("/api/hr/policy", { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ weeklyOff: Number(val) }) });
    await loadPolicy();
    toast(`Weekly off set to ${WEEKDAY_NAMES[hrPolicy.weeklyOff]}`); render();
  }catch(err){ toast(err.message || "Couldn't save weekly off"); }
}
function addHoliday(e){
  e.preventDefault();
  const date = document.getElementById("new-holiday-date").value;
  const name = document.getElementById("new-holiday-name").value.trim();
  if(!date || !name) return false;
  apiJson("/api/hr/policy/holidays", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ date, name }) })
    .then(async ()=>{ await loadPolicy(); toast("Holiday added"); render(); })
    .catch(err=>toast(err.message || "A holiday is already set for that date"));
  return false;
}
async function removeHoliday(date){
  try{
    await Auth.apiFetch(`/api/hr/policy/holidays/${date}`, { method:"DELETE" });
    await loadPolicy();
    toast("Holiday removed"); render();
  }catch(err){ toast("Couldn't remove holiday"); }
}
async function saveGeneralPolicyNotes(){
  try{
    await apiJson("/api/hr/policy", { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ generalNotes: document.getElementById("policy-general-notes").value }) });
    await loadPolicy();
    toast("Policy notes saved");
  }catch(err){ toast(err.message || "Couldn't save notes"); }
}

/* ---- HR modals & actions ---- */
// Sales is commission-only (see SALES_COMMISSION_RATE) — no fixed salary,
// so the salary field is hidden and defaults to 0 rather than being forced
// to a minimum ₹1000 like every other department. Shared by Add and Edit.
function toggleSalaryField(dept){
  const field = document.getElementById('salary-field');
  const input = field.querySelector('input[name="salary"]');
  const note = document.getElementById('salary-note');
  const isSales = dept==='Sales';
  input.hidden = isSales; note.hidden = !isSales;
  input.required = !isSales;
  // min must drop too: a hidden input holding 0 would otherwise fail min="1000"
  // validation on an unfocusable field, and the browser silently blocks submit.
  input.min = isSales ? '0' : '1000';
  if(isSales) input.value = '0';
}
function openAddEmployee(){
  showModal(`
    <div class="modal-head"><h3>Add employee</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-add-employee"><div class="modal-body">
      <div><label class="field-label">Full name</label><input class="field-input" name="name" required placeholder="e.g. Farhan Kutty"></div>
      <div class="field-row">
        <div><label class="field-label">Department</label><select class="field-input" name="dept" onchange="toggleSalaryField(this.value)">${DEPARTMENTS.map(d=>`<option>${esc(d)}</option>`).join("")}</select></div>
        <div><label class="field-label">Role</label><input class="field-input" name="role" required placeholder="e.g. SMM Executive"></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">Joining date</label><input class="field-input" type="date" name="joined" value="${TODAY}" required></div>
        <div><label class="field-label">Date of birth</label><input class="field-input" type="date" name="dob" max="${TODAY}"></div>
      </div>
      <div class="field-row">
        <div id="salary-field">
          <label class="field-label">Monthly gross (₹)</label>
          <input class="field-input" type="number" name="salary" min="1000" step="500" required placeholder="26000">
          <div class="subtext" id="salary-note" hidden>Sales is commission-only — no fixed salary. See Accounts &gt; Commissions for their target and bonus rate.</div>
        </div>
        <div><label class="field-label">Employment status</label><select class="field-input" name="empType"><option value="Probation">Probation</option><option value="Permanent">Permanent</option></select></div>
      </div>
      <div><label class="field-label">Email</label><input class="field-input" type="email" name="email" required placeholder="name@desgromedia.com"></div>
      <div><label class="field-label">Phone</label><input class="field-input" name="phone" required placeholder="+91 9xxxx xxxxx"></div>
      <div class="section-label">ERP access</div>
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Grant them a login now (email above + a password you set), or skip this and add it later — not every employee needs ERP access. Every login gets the base Employee role (their own attendance/leave/payslips) automatically; check any module roles they also need — a person can hold more than one (e.g. Sales + Content).</div></div>
      <div class="field-row">
        <div><label class="field-label">Grant ERP access</label><select class="field-input" name="grant" onchange="document.getElementById('grant-role-row').hidden = this.value!=='yes'">${'<option value="no">No login for now</option><option value="yes">Yes — set a password</option>'}</select></div>
        <div><label class="field-label">Password (if granting access)</label><input class="field-input" type="password" name="password" minlength="8" placeholder="At least 8 characters"></div>
      </div>
      <div id="grant-role-row" hidden>
        <label class="field-label">Module roles (base Employee always included)</label>
        <div class="check-row">${["ADMIN","HR","FINANCE","SALES","SALES_HEAD","CONTENT"].map(r=>`<label class="check-chip"><input type="checkbox" name="grantRole" value="${r}">${r.charAt(0)+r.slice(1).toLowerCase().replace("_"," ")}</label>`).join("")}</div>
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Add employee</button></div></div>
    </form>`);
  document.getElementById("f-add-employee").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const grantAccess = f.get("grant")==="yes" ? { password: f.get("password"), roles: [...new Set(["EMPLOYEE", ...f.getAll("grantRole")])] } : undefined;
    if(grantAccess && (!grantAccess.password || grantAccess.password.length<8)){ toast("Password must be at least 8 characters"); return; }
    try{
      await apiJson("/api/hr/employees", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({
        name: f.get("name"), dept: f.get("dept"), role: f.get("role"), joinedAt: f.get("joined"), dob: f.get("dob")||undefined,
        email: f.get("email"), phone: f.get("phone"), salary: Number(f.get("salary")), empType: TITLECASE_TO_API(f.get("empType")),
        grantAccess,
      })});
      await loadEmployees();
      toast("Employee added"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't add employee"); }
  });
}
async function openEmployeeDetail(id){
  const e = byId(id); const a = attendanceToday[id];
  const b = leaveBalance(id);
  const empAdvances = advances.filter(x=>x.empId===id);
  const { revisions } = await apiJson(`/api/hr/employees/${employeeDbIdByCode[id]}/salary-revisions`);
  e.salaryHistory = revisions.map(r=>({amount:Number(r.amount), effectiveDate:isoDate(r.effectiveDate), note:r.note||undefined}));
  showModal(`
    <div class="modal-head">
      <div class="person"><div class="mini-avatar" style="width:38px;height:38px;font-size:13px;">${initials(e.name)}</div><div><div style="font-weight:800;font-size:15px;display:flex;align-items:center;gap:8px;">${esc(e.name)} ${pill(e.empType, statusKind(e.empType))} ${e.employmentStatus!=="Active"?pill(e.employmentStatus==="Notice Period"?"Notice · leaving "+fmtDate(e.leavingDate):e.employmentStatus, e.employmentStatus==="Notice Period"?"warn":"neg"):""}</div><div class="person-role">${esc(e.role)} · ${esc(e.dept)}</div></div></div>
      <button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button>
    </div>
    <div class="modal-body">
      ${e.employmentStatus==="Notice Period" ? `<div class="banner"><svg class="icon" style="width:15px;height:15px"><use href="#i-bell"/></svg><div><b>On notice period.</b> Last working day ${fmtDate(e.leavingDate)}${e.noticeNote?" — "+esc(e.noticeNote):""}.</div></div>` : ""}
      ${e.employmentStatus==="Left" ? `<div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-archive"/></svg><div><b>Archived.</b> Left on ${fmtDate(e.leavingDate)}. They no longer have ERP access.</div></div>` : ""}
      <div class="field-row">
        <div><label class="field-label">Employee ID</label><div class="mono">${e.id}</div></div>
        <div><label class="field-label">Joined</label><div>${fmtDate(e.joined)}</div></div>
        <div><label class="field-label">Date of birth</label><div>${e.dob?fmtDate(e.dob):'<span class="faint">Not on file</span>'}</div></div>
        <div><label class="field-label">Email</label><div style="font-size:13px;">${esc(e.email)}</div></div>
        <div><label class="field-label">Phone</label><div class="mono">${esc(e.phone)}</div></div>
        <div><label class="field-label">Monthly gross</label><div class="mono">${inr(e.salary)}</div></div>
        <div><label class="field-label">Today</label><div>${a?pill(attendanceLabel(a.status),statusKind(attendanceLabel(a.status))):'<span class="faint">—</span>'}</div></div>
      </div>
      <div class="section-label" style="display:flex;align-items:center;justify-content:space-between;">ERP access<button class="btn btn-sm ghost" onclick="openGrantAccess('${e.id}')">${e.hasErpAccess?"Reset password":"Grant access"}</button></div>
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${e.hasErpAccess ? "They already have an ERP login." : "No ERP login yet — they can't sign in until you grant access."}</div></div>
      <div class="section-label">This month's leave &amp; WFH</div>
      <div class="field-row">
        <div><label class="field-label">Leave taken</label><div class="mono">${b.leaveDays} / ${b.leaveCap} paid</div></div>
        <div><label class="field-label">Loss of Pay</label><div class="mono ${b.lopDays>0?'neg':''}">${b.lopDays} day${b.lopDays===1?'':'s'}</div></div>
        <div><label class="field-label">WFH taken</label><div class="mono">${b.wfhDays} / ${b.wfhCap} paid</div></div>
        <div><label class="field-label">WFH pay-cut days</label><div class="mono ${b.wfhExcessDays>0?'neg':''}">${b.wfhExcessDays} day${b.wfhExcessDays===1?'':'s'}</div></div>
      </div>
      <div class="section-label" style="display:flex;align-items:center;justify-content:space-between;">Salary history<button class="btn btn-sm ghost" onclick="openSalaryRevision('${e.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Record revision</button></div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Effective from</th><th class="num">Monthly gross</th><th class="num">Change</th><th>Note</th><th></th></tr></thead>
        <tbody>${salaryHistoryFor(e).map((h,i,arr)=>{
          const prev = arr[i-1];
          const diff = prev ? h.amount-prev.amount : 0;
          const pct = prev && prev.amount ? (diff/prev.amount*100).toFixed(1) : null;
          const upcoming = h.effectiveDate > TODAY;
          return `<tr><td class="muted">${fmtDate(h.effectiveDate)}</td><td class="num mono">${inr(h.amount)}</td><td class="num mono ${diff>0?'pos':diff<0?'neg':'faint'}">${prev ? (diff===0?'—':(diff>0?'+':'')+inr(diff)+' ('+(pct>0?'+':'')+pct+'%)') : '—'}</td><td class="muted">${esc(h.note||"—")}</td><td>${upcoming?pill('Scheduled','blue'):''}</td></tr>`;
        }).join("")}</tbody>
      </table></div>
      ${empAdvances.length ? `<div class="section-label">Advance history</div>${empAdvances.map(a=>`<div class="calc-line"><span>${esc(a.reason)} · ${fmtDateShort(a.requested)}</span><span class="mono">${inr(a.amount)} · ${a.status}</span></div>`).join("")}` : ""}
    </div>
    <div class="modal-foot">
      <div style="display:flex;gap:8px;">
        ${e.employmentStatus==="Active" ? `<button class="btn btn-sm ghost" onclick="openMarkNoticePeriod('${e.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-bell"/></svg>Mark notice period</button>` : ""}
        ${e.employmentStatus==="Notice Period" ? `<button class="btn btn-sm ghost" onclick="cancelNoticePeriod('${e.id}')">Cancel notice period</button><button class="btn btn-sm danger" onclick="openConfirmDeparture('${e.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-archive"/></svg>Confirm departure</button>` : ""}
        ${e.employmentStatus==="Left" ? `<button class="btn btn-sm ghost" onclick="reinstateEmployee('${e.id}')">Reinstate</button>` : ""}
      </div>
      <div style="display:flex;gap:8px;"><button class="btn ghost" onclick="closeModal()">Close</button><button class="btn primary" onclick="openEditEmployee('${e.id}')"><svg class="icon" style="width:13px;height:13px"><use href="#i-edit"/></svg>Edit details</button></div>
    </div>`);
}
function openGrantAccess(id){
  const e = byId(id);
  showModal(`
    <div class="modal-head"><h3>${e.hasErpAccess?"Reset password":"Grant ERP access"}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-grant-access"><div class="modal-body">
      <div class="person" style="margin-bottom:4px;">${personCell(e)}</div>
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${e.hasErpAccess ? "Their login is "+esc(e.email)+" — this sets a new password, it doesn't change their existing module roles." : "Their login will be "+esc(e.email)+" — set a password and pick which module roles they need. The base Employee role (their own attendance/leave/payslips) is always included."}</div></div>
      <div><label class="field-label">${e.hasErpAccess?"New password":"Set password"}</label><input class="field-input" type="password" name="password" required minlength="8" placeholder="At least 8 characters"></div>
      ${e.hasErpAccess ? "" : `<div><label class="field-label">Module roles (base Employee always included)</label><div class="check-row">${["ADMIN","HR","FINANCE","SALES","SALES_HEAD","CONTENT"].map(r=>`<label class="check-chip"><input type="checkbox" name="grantRole" value="${r}">${r.charAt(0)+r.slice(1).toLowerCase().replace("_"," ")}</label>`).join("")}</div></div>`}
    </div>
    <div class="modal-foot"><button type="button" class="btn ghost" onclick="openEmployeeDetail('${e.id}')">Back</button><button type="submit" class="btn primary">${e.hasErpAccess?"Reset password":"Grant access"}</button></div>
    </form>`);
  document.getElementById("f-grant-access").addEventListener("submit", async ev=>{
    ev.preventDefault();
    const f = new FormData(ev.target);
    try{
      await apiJson(`/api/hr/employees/${employeeDbIdByCode[id]}/grant-access`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ password: f.get("password"), roles: [...new Set(["EMPLOYEE", ...f.getAll("grantRole")])] }) });
      await loadEmployees();
      toast(e.hasErpAccess ? "Password reset" : "ERP access granted");
      await openEmployeeDetail(id); render();
    }catch(err){ toast(err.message || "Couldn't update ERP access"); }
  });
}
function openMarkNoticePeriod(id){
  const e = byId(id);
  showModal(`
    <div class="modal-head"><h3>Mark notice period</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-notice-period"><div class="modal-body">
      <div class="person" style="margin-bottom:4px;">${personCell(e)}</div>
      <div><label class="field-label">Last working day</label><input class="field-input" type="date" name="leavingDate" value="${e.leavingDate||TODAY}" required></div>
      <div><label class="field-label">Note (optional)</label><input class="field-input" name="note" value="${esc(e.noticeNote||"")}" placeholder="e.g. Resigned, relocating"></div>
      <div class="subtext" style="margin-top:8px;">They stay active and keep full access until you confirm their departure — this is reversible any time before then.</div>
    </div>
    <div class="modal-foot"><button type="button" class="btn ghost" onclick="openEmployeeDetail('${e.id}')">Back</button><button type="submit" class="btn primary">Mark notice period</button></div>
    </form>`);
  document.getElementById("f-notice-period").addEventListener("submit", async ev=>{
    ev.preventDefault();
    const f = new FormData(ev.target);
    try{
      await apiJson(`/api/hr/employees/${employeeDbIdByCode[id]}/notice-period`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ leavingDate: f.get("leavingDate"), note: f.get("note")||undefined }) });
      await loadEmployees();
      toast(e.name+" marked on notice period"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't mark notice period"); }
  });
}
async function cancelNoticePeriod(id){
  try{
    await apiJson(`/api/hr/employees/${employeeDbIdByCode[id]}/cancel-notice-period`, { method:"POST" });
    await loadEmployees();
    toast("Notice period cancelled"); await openEmployeeDetail(id); render();
  }catch(err){ toast(err.message || "Couldn't cancel notice period"); }
}
function openConfirmDeparture(id){
  const e = byId(id);
  showModal(`
    <div class="modal-head"><h3>Confirm departure</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div class="person" style="margin-bottom:4px;">${personCell(e)}</div>
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-archive"/></svg><div>This moves them out of the active directory into the archive and blocks their sign-in immediately. You can reinstate them from the archive later if needed.</div></div>
      <div><label class="field-label">Last working day</label><input class="field-input" type="date" id="departure-date" value="${e.leavingDate||TODAY}"></div>
    </div>
    <div class="modal-foot"><button type="button" class="btn ghost" onclick="openEmployeeDetail('${e.id}')">Back</button><button type="button" class="btn danger" onclick="confirmDeparture('${e.id}')">Confirm &amp; archive</button></div>`);
}
async function confirmDeparture(id){
  const e = byId(id);
  const dateInput = document.getElementById('departure-date');
  try{
    await apiJson(`/api/hr/employees/${employeeDbIdByCode[id]}/confirm-departure`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ leavingDate: (dateInput && dateInput.value) || undefined }) });
    await Promise.all([loadEmployees(), loadArchivedEmployees()]);
    toast(e.name+" archived"); closeModal(); render();
  }catch(err){ toast(err.message || "Couldn't confirm departure"); }
}
async function reinstateEmployee(id){
  const e = byId(id);
  try{
    await apiJson(`/api/hr/employees/${employeeDbIdByCode[id]}/reinstate`, { method:"POST" });
    await Promise.all([loadEmployees(), loadArchivedEmployees()]);
    toast(e.name+" reinstated"); closeModal(); render();
  }catch(err){ toast(err.message || "Couldn't reinstate"); }
}
function openSalaryRevision(id){
  const e = byId(id);
  showModal(`
    <div class="modal-head"><h3>Record salary revision</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-salary-revision"><div class="modal-body">
      <div class="person" style="margin-bottom:4px;">${personCell(e)}</div>
      <div class="field-row">
        <div><label class="field-label">Current monthly gross</label><div class="mono">${inr(e.salary)}</div></div>
        <div><label class="field-label">New monthly gross (₹)</label><input class="field-input" type="number" name="amount" min="1000" step="500" required value="${e.salary}"></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">Effective from</label><input class="field-input" type="date" name="effectiveDate" value="${TODAY}" required></div>
      </div>
      <div><label class="field-label">Reason</label><input class="field-input" name="note" placeholder="e.g. Annual increment, Promotion, Performance review"></div>
      <div class="subtext" style="margin-top:8px;">A future-dated revision is logged as scheduled — it won't change the current payroll amount until that date arrives.</div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="openEmployeeDetail('${e.id}')">Cancel</button><button type="submit" class="btn primary">Save revision</button></div></div>
    </form>`);
  document.getElementById("f-salary-revision").addEventListener("submit", async ev=>{
    ev.preventDefault();
    const f = new FormData(ev.target);
    const amount = Number(f.get("amount"));
    const effectiveDate = f.get("effectiveDate");
    const note = f.get("note").trim();
    try{
      await apiJson(`/api/hr/employees/${employeeDbIdByCode[id]}/salary-revisions`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ amount, effectiveDate, note: note || undefined }) });
      await loadEmployees();
      toast(effectiveDate <= TODAY ? "Salary updated" : "Revision scheduled for "+fmtDate(effectiveDate));
      await openEmployeeDetail(e.id); render();
    }catch(err){ toast(err.message || "Couldn't save revision"); }
  });
}
function openEditEmployee(id){
  const e = byId(id);
  showModal(`
    <div class="modal-head"><h3>Edit employee</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-edit-employee"><div class="modal-body">
      <div><label class="field-label">Full name</label><input class="field-input" name="name" required value="${esc(e.name)}"></div>
      <div class="field-row">
        <div><label class="field-label">Department</label><select class="field-input" name="dept">${DEPARTMENTS.map(d=>`<option ${d===e.dept?"selected":""}>${esc(d)}</option>`).join("")}</select></div>
        <div><label class="field-label">Role</label><input class="field-input" name="role" required value="${esc(e.role)}"></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">Joining date</label><input class="field-input" type="date" name="joined" value="${e.joined}" required></div>
        <div><label class="field-label">Date of birth</label><input class="field-input" type="date" name="dob" value="${e.dob||''}" max="${TODAY}"></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">Employment status</label><select class="field-input" name="empType"><option value="Probation" ${e.empType==="Probation"?"selected":""}>Probation</option><option value="Permanent" ${e.empType==="Permanent"?"selected":""}>Permanent</option></select></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">Monthly gross</label><div class="mono field-input" style="background:var(--surface-sunk);">${inr(e.salary)}</div></div>
        <div><label class="field-label">&nbsp;</label><button type="button" class="btn ghost btn-sm" onclick="openSalaryRevision('${e.id}')">Change via salary revision →</button></div>
      </div>
      <div><label class="field-label">Email</label><input class="field-input" type="email" name="email" required value="${esc(e.email)}"></div>
      <div><label class="field-label">Phone</label><input class="field-input" name="phone" required value="${esc(e.phone)}"></div>
    </div>
    <div class="modal-foot"><button type="button" class="btn ghost" onclick="openEmployeeDetail('${e.id}')">Back</button><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save changes</button></div></div>
    </form>`);
  document.getElementById("f-edit-employee").addEventListener("submit", async ev=>{
    ev.preventDefault();
    const f = new FormData(ev.target);
    try{
      await apiJson(`/api/hr/employees/${employeeDbIdByCode[id]}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({
        name: f.get("name"), dept: f.get("dept"), role: f.get("role"), joinedAt: f.get("joined"), dob: f.get("dob")||undefined,
        email: f.get("email"), phone: f.get("phone"), empType: TITLECASE_TO_API(f.get("empType")),
      })});
      await loadEmployees();
      toast("Employee details updated"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't save changes"); }
  });
}
function openAddLeave(){
  showModal(`
    <div class="modal-head"><h3>New leave request</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-add-leave"><div class="modal-body">
      <div><label class="field-label">Employee</label><select class="field-input" name="empId">${employees.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join("")}</select></div>
      <div class="field-row">
        <div><label class="field-label">Type</label><select class="field-input" name="type"><option value="Casual/Sick">Casual/Sick</option><option value="WFH">WFH</option></select></div>
        <div><label class="field-label">Duration</label><select class="field-input" name="duration"><option value="Full Day">Full Day</option><option value="Half Day">Half Day</option><option value="Quarter Day">Quarter Day</option></select></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">From</label><input class="field-input" type="date" name="from" value="${TODAY}" required></div>
        <div><label class="field-label">To</label><input class="field-input" type="date" name="to" value="${TODAY}" required></div>
      </div>
      <div class="subtext">Half Day and Quarter Day apply only when From and To are the same date — a multi-day range is always counted as full days.</div>
      <div><label class="field-label">Reason</label><textarea class="field-input" name="reason" required placeholder="Brief reason for the request"></textarea></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Submit request</button></div></div>
    </form>`);
  document.getElementById("f-add-leave").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const from=f.get("from"), to=f.get("to");
    const duration = f.get("duration");
    let days = Math.max(1, Math.round((new Date(to)-new Date(from))/86400000)+1);
    if(from===to && duration==="Half Day") days = 0.5;
    if(from===to && duration==="Quarter Day") days = 0.25;
    try{
      await apiJson("/api/hr/leave-requests", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({
        employeeId: employeeDbIdByCode[f.get("empId")], type: LEAVE_TYPE_TO_API[f.get("type")] || f.get("type"),
        duration: TITLECASE_TO_API(from===to?duration:"Full Day"), fromDate:from, toDate:to, days, reason:f.get("reason"),
      })});
      await loadLeaveRequests();
      toast("Leave request submitted"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't submit leave request"); }
  });
}
function openAddAdvance(){
  showModal(`
    <div class="modal-head"><h3>New advance salary request</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-add-advance"><div class="modal-body">
      <div><label class="field-label">Employee</label><select class="field-input" name="empId">${employees.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join("")}</select></div>
      <div class="field-row">
        <div><label class="field-label">Amount (₹)</label><input class="field-input" type="number" name="amount" min="500" step="500" required placeholder="10000"></div>
        <div><label class="field-label">Recovery in (months)</label><input class="field-input" type="number" name="installments" min="1" max="6" value="2" required></div>
      </div>
      <div><label class="field-label">Reason</label><textarea class="field-input" name="reason" required placeholder="Brief reason for the request"></textarea></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Submit request</button></div></div>
    </form>`);
  document.getElementById("f-add-advance").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const amount = Number(f.get("amount")); const installments = Number(f.get("installments"));
    try{
      await apiJson("/api/hr/advances", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({
        employeeId: employeeDbIdByCode[f.get("empId")], amount, reason:f.get("reason"), installments,
      })});
      await loadAdvances();
      toast("Advance request submitted"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't submit advance request"); }
  });
}
function openAddPosition(){
  showModal(`
    <div class="modal-head"><h3>New open position</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-add-position"><div class="modal-body">
      <div><label class="field-label">Role</label><input class="field-input" name="role" required placeholder="e.g. SMM Executive"></div>
      <div class="field-row">
        <div><label class="field-label">Department</label><select class="field-input" name="dept">${DEPARTMENTS.map(d=>`<option>${esc(d)}</option>`).join("")}</select></div>
        <div><label class="field-label">Openings</label><input class="field-input" type="number" name="openings" min="1" value="1" required></div>
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Post position</button></div></div>
    </form>`);
  document.getElementById("f-add-position").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      await apiJson("/api/hr/positions", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ role:f.get("role"), dept:f.get("dept"), openings:Number(f.get("openings")) }) });
      await loadHiring();
      toast("Position posted"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't post position"); }
  });
}
function openApplicationLink(){
  const link = "https://careers.desgromedia.com/apply";
  const open = openPositions.filter(p=>p.status==="Open");
  const listing = open.map(p=>`• ${p.role} (${p.dept}) — ${p.openings} opening${p.openings>1?"s":""}`).join("\n");
  const message = open.length
    ? `We're hiring at DesGro Media 🚀\n\n${listing}\n\nApply here: ${link}`
    : `We're hiring at DesGro Media 🚀\n\nSee current openings and apply here: ${link}`;
  showModal(`
    <div class="modal-head"><h3>Application link</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div class="section-label">One link for every current opening</div>
      <label class="field-label">Shareable link</label>
      <div style="display:flex;gap:8px;">
        <input class="field-input mono" id="apply-link-input" readonly value="${esc(link)}" style="flex:1;font-size:12.5px;">
        <button type="button" class="btn btn-sm" onclick="copyApplyText('apply-link-input','Link copied')"><svg class="icon" style="width:12px;height:12px"><use href="#i-link"/></svg>Copy</button>
      </div>
      <label class="field-label" style="margin-top:14px;display:block;">Ready-to-share message</label>
      <textarea class="field-input" id="apply-msg-textarea" rows="${5+open.length}" readonly style="resize:vertical;font-family:inherit;">${esc(message)}</textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;">
        <button type="button" class="btn btn-sm" onclick="copyApplyText('apply-msg-textarea','Message copied')"><svg class="icon" style="width:12px;height:12px"><use href="#i-link"/></svg>Copy message</button>
      </div>
      <div class="subtext" style="margin-top:10px;">Paste the link or the full message into your Instagram/LinkedIn hiring post or WhatsApp broadcast — the page lists every open role and lets applicants pick which one they're applying for.</div>
    </div>
    <div class="modal-foot"><div></div><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
}
function copyApplyText(elId, msg){
  const el = document.getElementById(elId);
  el.removeAttribute("readonly"); el.focus(); el.select();
  const done = ()=>{ toast(msg); el.setAttribute("readonly","readonly"); };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(el.value).then(done).catch(()=>{ try{document.execCommand("copy");}catch(err){} done(); });
  } else {
    try{ document.execCommand("copy"); }catch(err){}
    done();
  }
}
function openOfferLetter(candidateId){
  const cand = candidateId ? candidates.find(c=>c.id===candidateId) : null;
  const pos = cand ? openPositions.find(p=>p.id===cand.posId) : null;
  showModal(`
    <div class="modal-head"><h3>Generate offer letter</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-offer-letter"><div class="modal-body">
      <div><label class="field-label">Candidate</label><select class="field-input" name="candidateId" onchange="openOfferLetter(this.value)">
        <option value="">— Manual entry —</option>
        ${candidates.map(c=>`<option value="${c.id}" ${cand&&cand.id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}
      </select></div>
      <div class="field-row">
        <div><label class="field-label">Candidate name</label><input class="field-input" name="name" required value="${cand?esc(cand.name):''}"></div>
        <div><label class="field-label">Role</label><input class="field-input" name="role" required value="${pos?esc(pos.role):''}"></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">Department</label><select class="field-input" name="dept">${DEPARTMENTS.map(d=>`<option ${pos&&pos.dept===d?'selected':''}>${esc(d)}</option>`).join('')}</select></div>
        <div><label class="field-label">Monthly salary (₹)</label><input class="field-input" type="number" name="salary" min="0" required placeholder="22000"></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">Date of joining</label><input class="field-input" type="date" name="joinDate" required></div>
        <div><label class="field-label">Probation period (months)</label><input class="field-input" type="number" name="probationMonths" min="0" value="3" required></div>
      </div>
      <div><label class="field-label">Reporting to</label><select class="field-input" name="reportingTo">${employees.map(e=>`<option>${esc(e.name)}</option>`).join('')}</select></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Generate letter</button></div></div>
    </form>`, true);
  document.getElementById("f-offer-letter").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const data = { name:f.get("name"), role:f.get("role"), dept:f.get("dept"), salary:Number(f.get("salary")), joinDate:f.get("joinDate"), probationMonths:Number(f.get("probationMonths")), reportingTo:f.get("reportingTo") };
    const cId = f.get("candidateId");
    if(cId){
      try{ await apiJson(`/api/hr/candidates/${cId}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ stage:"OFFER" }) }); await loadHiring(); }
      catch(err){ toast(err.message || "Couldn't update candidate stage"); }
    }
    showOfferLetterPreview(data);
  });
}
function buildOfferLetterText(d){
  return `DESGRO MEDIA
HiLITE Business Park, Kozhikode, Kerala

Date: ${fmtDate(TODAY)}

Dear ${d.name},

We are pleased to offer you the position of ${d.role} in the ${d.dept} department at DesGro Media.

Key terms of this offer:

Position: ${d.role}
Department: ${d.dept}
Date of Joining: ${fmtDate(d.joinDate)}
Monthly Salary: ${inr(d.salary)}
Reporting To: ${d.reportingTo}
Probation Period: ${d.probationMonths} month${d.probationMonths===1?'':'s'} from the date of joining

This offer is subject to the accuracy of the information shared during the interview process. Your employment will be governed by DesGro Media's HR policies, communicated separately on joining.

Please confirm your acceptance by replying to this letter.

We look forward to having you on the team.

Warm regards,
HR Team
DesGro Media`;
}
function showOfferLetterPreview(d){
  const text = buildOfferLetterText(d);
  showModal(`
    <div class="modal-head"><h3>Offer letter — ${esc(d.name)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <textarea class="field-input" id="offer-letter-textarea" rows="18" readonly style="resize:vertical;font-family:inherit;white-space:pre-wrap;">${esc(text)}</textarea>
    </div>
    <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">Close</button><button class="btn primary" onclick="copyApplyText('offer-letter-textarea','Offer letter copied')"><svg class="icon" style="width:13px;height:13px"><use href="#i-link"/></svg>Copy letter</button></div>`, true);
  toast(`Offer letter ready for ${d.name}`);
}
function openPayslip(id, readOnly){
  const e = byId(id); const month = payroll.selectedMonth; const c = computePayrollRow(e, month);
  if(!c){ toast("Add "+e.name+" to this month's payroll first"); return; }
  showModal(`
    <div class="modal-head"><h3>Payslip — ${MONTH_LABEL[month]}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div class="person" style="margin-bottom:4px;">${personCell(e)}</div>
      <div class="section-label">Earnings</div>
      <div class="calc-line"><span>Basic</span><span class="mono">${inr(c.basic)}</span></div>
      <div class="calc-line"><span>HRA</span><span class="mono">${inr(c.hra)}</span></div>
      <div class="calc-line"><span>Special allowance</span><span class="mono">${inr(c.special)}</span></div>
      <div class="calc-line total"><span>Gross pay</span><span class="mono">${inr(c.gross)}</span></div>
      <div class="section-label">Deductions</div>
      <div class="calc-line"><span>Provident fund</span><span class="mono">−${inr(c.pf)}</span></div>
      <div class="calc-line"><span>Professional tax</span><span class="mono">−${inr(c.pt)}</span></div>
      ${c.advDeduction>0?`<div class="calc-line"><span>Advance recovery</span><span class="mono">−${inr(c.advDeduction)}</span></div>`:""}
      ${c.lopDeduction>0?`<div class="calc-line"><span>Loss of Pay (${c.lopDays} day${c.lopDays===1?"":"s"} · ${MONTH_LABEL[month]} has ${c.monthWorkingDays} working days)</span><span class="mono" style="color:var(--neg);">−${inr(c.lopDeduction)}</span></div>`:""}
      <div class="calc-line total"><span>Net pay</span><span class="mono">${inr(c.net)}</span></div>
      <div class="section-label">Payments</div>
      ${c.payments.length ? c.payments.map(p=>`<div class="calc-line"><span>${fmtDateShort(p.date)}${p.note?" · "+esc(p.note):""}</span><span class="mono">${inr(p.amount)}</span></div>`).join("") : `<div class="empty" style="padding:12px 0;">No payments recorded yet.</div>`}
      <div class="calc-line total"><span>Balance due</span><span class="mono" style="${c.balance>0?'color:var(--warn);':''}">${inr(c.balance)}</span></div>
    </div>
    <div class="modal-foot">${(!readOnly && c.balance>0)?`<button class="btn primary" onclick="openRecordPayment('${e.id}')"><svg class="icon" style="width:13px;height:13px"><use href="#i-wallet"/></svg>Record payment</button>`:'<div></div>'}<button class="btn ghost" onclick="closeModal()">Close</button></div>`);
}
async function setPayrollMonth(m){
  payroll.selectedMonth=m;
  const jobs = [];
  if(!payroll.history[m] && (isHRRole(currentUser) || (currentUser && currentUser.isAdmin))) jobs.push(loadPayrollMonth(m));
  if(!attendanceMonthSummary[m] && (isHRRole(currentUser) || (currentUser && currentUser.isAdmin))) jobs.push(loadAttendanceMonthSummary(m));
  if(!financeReportsCache.pl[m] && isFinanceAdminUser(currentUser)) jobs.push(loadFinanceReports(m));
  await Promise.all(jobs);
  render();
}
async function decideLeave(id,decision){
  try{
    await apiJson(`/api/hr/leave-requests/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ status: TITLECASE_TO_API(decision) }) });
    await Promise.all([loadLeaveRequests(), loadLeaveBalances()]);
    toast(`Leave request ${decision.toLowerCase()}`); render();
  }catch(err){ toast(err.message || "Couldn't update leave request"); }
}
async function decideAdvance(id,decision){
  try{
    await apiJson(`/api/hr/advances/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ status: TITLECASE_TO_API(decision) }) });
    await loadAdvances();
    toast(decision==="Recovering"?"Advance approved":"Advance rejected"); render();
  }catch(err){ toast(err.message || "Couldn't update advance"); }
}
async function openAddPayrollEntry(id){
  const e = byId(id); const month = payroll.selectedMonth;
  if(!attendanceMonthSummary[month]) await loadAttendanceMonthSummary(month).catch(()=>{});
  const existing = payroll.history[month].entries[id];
  const startGross = existing ? existing.gross : e.salary;

  // Context so HR isn't setting this month's gross blind — last closed month's attendance, what's
  // already been paid out against an advance, what's still owed from the last closed payroll month,
  // and the LOP/WFH pay-cut this employee's excess leave already implies at the proposed gross.
  const closedMonth = closedPayrollMonth();
  const lastMonthAttendance = attendanceHistoryFor(id).find(mo=>`${mo.y}-${String(mo.m).padStart(2,'0')}`===closedMonth);
  const empAdvances = advances.filter(a=>a.empId===id);
  const advPaidTotal = empAdvances.reduce((s,a)=>s+(a.amount-a.balance),0);
  const advOutstanding = empAdvances.filter(a=>a.status==="Approved").reduce((s,a)=>s+a.balance,0);
  const eu = earnedUnpaidFor(e);
  const lopDays = lopDaysFor(id, month);
  const monthWorkingDays = workingDaysInMonth(month);
  const perDayRateForContext = monthWorkingDays ? startGross/monthWorkingDays : 0;
  const lopDeduction = Math.round(perDayRateForContext * lopDays);
  const wfhExcessDays = wfhExcessDaysFor(id, month);
  const wfhDeduction = Math.round(perDayRateForContext * 0.25 * wfhExcessDays);

  showModal(`
    <div class="modal-head"><h3>${existing?"Edit":"Add to"} payroll — ${MONTH_LABEL[month]}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-add-payroll-entry"><div class="modal-body">
      <div class="person" style="margin-bottom:4px;">${personCell(e)}</div>
      <div class="section-label">Before you set this month's pay</div>
      <div class="calc-line"><span>Attendance — ${esc(MONTH_LABEL[closedMonth]||closedMonth)}</span><span class="mono">${lastMonthAttendance ? `${lastMonthAttendance.present}/${lastMonthAttendance.workingDays} present${lastMonthAttendance.absentDays?`, ${lastMonthAttendance.absentDays} absent`:""}` : "no record"}</span></div>
      <div class="calc-line"><span>Advance salary paid to date</span><span class="mono">${advPaidTotal>0?inr(advPaidTotal):"—"}${advOutstanding>0?` <span class="faint" style="font-size:11.5px;">(${inr(advOutstanding)} still owed)</span>`:""}</span></div>
      <div class="calc-line"><span>Balance payable — ${esc(MONTH_LABEL[eu.month]||eu.month)}</span><span class="mono ${eu.balance>0?'warn':''}">${eu.balance>0?inr(eu.balance):"settled"}</span></div>
      ${lopDays>0 ? `<div class="calc-line"><span>Leave beyond ${hrPolicy.paidLeavesPerMonth}/month allowance</span><span class="mono" style="color:var(--neg);">${lopDays} day${lopDays===1?"":"s"} · est. −${inr(lopDeduction)} LOP</span></div>` : `<div class="calc-line"><span>Leave beyond ${hrPolicy.paidLeavesPerMonth}/month allowance</span><span class="mono faint">none</span></div>`}
      ${wfhExcessDays>0 ? `<div class="calc-line"><span>WFH beyond ${hrPolicy.paidWfhPerMonth}/month allowance</span><span class="mono" style="color:var(--neg);">${wfhExcessDays} day${wfhExcessDays===1?"":"s"} · est. −${inr(wfhDeduction)} (paid at 75%)</span></div>` : `<div class="calc-line"><span>WFH beyond ${hrPolicy.paidWfhPerMonth}/month allowance</span><span class="mono faint">none</span></div>`}
      <div class="field-row" style="margin-top:10px;">
        <div><label class="field-label">Master monthly gross</label><div class="mono">${inr(e.salary)}</div></div>
        <div><label class="field-label">Gross for ${MONTH_LABEL[month]} (₹)</label><input class="field-input" type="number" name="gross" min="0" step="500" required value="${startGross}"></div>
      </div>
      <div class="subtext">Adjust this if the month's pay differs from the master salary — unpaid leave deductions, a mid-month joiner, or a pending salary revision. Loss of Pay for excess leave and the 75%-pay cut for excess WFH are both applied automatically once added. Once added, this employee's figures appear in the payroll list below and can be paid in full or in parts.</div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">${existing?"Save":"Add to payroll"}</button></div></div>
    </form>`);
  document.getElementById("f-add-payroll-entry").addEventListener("submit", async ev=>{
    ev.preventDefault();
    const f = new FormData(ev.target);
    const gross = Number(f.get("gross"));
    try{
      await apiJson("/api/hr/payroll/entries", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ employeeId: employeeDbIdByCode[id], month, gross }) });
      await loadPayrollMonth(month);
      toast(existing ? "Payroll entry updated" : e.name+" added to "+monthLabel(month)+" payroll");
      closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't save payroll entry"); }
  });
}
function openRecordPayment(id){
  const e = byId(id); const month = payroll.selectedMonth; const c = computePayrollRow(e, month);
  showModal(`
    <div class="modal-head"><h3>Record payment</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-record-payment"><div class="modal-body">
      <div class="person" style="margin-bottom:4px;">${personCell(e)}</div>
      <div class="field-row">
        <div><label class="field-label">Net pay</label><div class="mono">${inr(c.net)}</div></div>
        <div><label class="field-label">Balance due</label><div class="mono">${inr(c.balance)}</div></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">Amount paying now (₹)</label><input class="field-input" type="number" name="amount" min="1" max="${c.balance}" step="1" required value="${c.balance}"></div>
        <div><label class="field-label">Date</label><input class="field-input" type="date" name="date" value="${TODAY}" required></div>
      </div>
      <div><label class="field-label">Note</label><input class="field-input" name="note" placeholder="e.g. Partial — fund shortage, rest next cycle"></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="openPayslip('${e.id}')">Cancel</button><button type="submit" class="btn primary">Record payment</button></div></div>
    </form>`);
  document.getElementById("f-record-payment").addEventListener("submit", async ev=>{
    ev.preventDefault();
    const f = new FormData(ev.target);
    const amount = Math.max(1, Math.min(Number(f.get("amount")), c.balance));
    try{
      const { isFull } = await apiJson(`/api/hr/payroll/${employeeDbIdByCode[id]}/${month}/payments`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ amount, paidDate:f.get("date"), note:f.get("note").trim()||undefined }) });
      await Promise.all([loadPayrollMonth(month), loadAdvances()]);
      toast(isFull ? "Marked fully paid" : "Partial payment recorded");
      closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't record payment"); }
  });
}

/* ===================== MARKETING ===================== */
function mktOverview(){
  const activeContent = contentItems.filter(c=>c.stage!=="Published").length;
  const overdueContent = contentItems.filter(c=>c.stage!=="Published" && c.due<TODAY).length;
  const publishedMTD = contentItems.filter(c=>c.stage==="Published" && c.due.slice(0,7)==="2026-09").length;
  const adRows = metaAdsCampaigns.map(adMetrics);
  const totalAdSpend = adRows.reduce((s,r)=>s+r.spend,0);
  const totalAdLeads = adRows.reduce((s,r)=>s+r.leads,0);
  const totalLeads = marketingLeads.length;
  const bySource = {};
  marketingLeads.forEach(l=>{ bySource[l.source]=(bySource[l.source]||0)+1; });
  const sourceRows = Object.entries(bySource).sort((a,b)=>b[1]-a[1]);
  const maxSource = Math.max(...sourceRows.map(x=>x[1]),1);
  return `
  <div class="banner">
    <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
    <div><b>Internal marketing.</b> This module tracks DesGro Media's own brand content and ad campaigns — not client work, which lives under Clients.</div>
  </div>
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Content In Flight</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-board"/></svg></div></div><div class="kpi-value mono">${activeContent}</div><div class="kpi-sub">${overdueContent} overdue</div></div>
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Published This Month</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-check"/></svg></div></div><div class="kpi-value mono">${publishedMTD}</div><div class="kpi-sub">our own channels</div></div>
    <div class="kpi-card hero"><div class="kpi-top"><span class="kpi-label">Meta Ads Spend</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-target"/></svg></div></div><div class="kpi-value mono">${inr(totalAdSpend)}</div><div class="kpi-sub">${totalAdLeads} leads generated</div></div>
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Total Leads</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-handshake"/></svg></div></div><div class="kpi-value mono">${totalLeads}</div><div class="kpi-sub">${sourceRows.length?sourceRows[0][0]+" is the top source":"no leads yet"}</div></div>
  </div>
  <div class="grid-2">
    <div class="panel">
      <div class="panel-head"><h3>Content by stage</h3><div class="sub">${contentItems.length} items in the pipeline</div></div>
      <div class="panel-body"><div class="barchart">${STAGES.map(s=>{ const n=contentItems.filter(c=>c.stage===s).length; const max=Math.max(...STAGES.map(x=>contentItems.filter(c=>c.stage===x).length),1); return `<div class="bar-row"><div class="bar-label">${s}</div><div class="bar-track"><div class="bar-fill" style="width:${(n/max)*100}%"></div></div><div class="bar-val">${n}</div></div>`; }).join("")}</div></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Leads by source</h3></div>
      <div class="panel-body">${sourceRows.length ? `<div class="barchart">${sourceRows.map(([s,n])=>`<div class="bar-row"><div class="bar-label">${esc(s)}</div><div class="bar-track"><div class="bar-fill" style="width:${(n/maxSource)*100}%"></div></div><div class="bar-val">${n}</div></div>`).join("")}</div>` : '<div class="empty">No leads yet.</div>'}</div>
    </div>
  </div>`;
}

function mktContent(){
  return `
  <div class="banner"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div><b>Sample data.</b> Drag a card between columns, or use the stage dropdown on each card — both update the same record.</div></div>
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Active Content</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-board"/></svg></div></div><div class="kpi-value mono" id="kpi-active">0</div><div class="kpi-sub">not yet published</div></div>
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">In Production</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-edit"/></svg></div></div><div class="kpi-value mono" id="kpi-production">0</div><div class="kpi-sub">scripting + production</div></div>
    <div class="kpi-card hero"><div class="kpi-top"><span class="kpi-label">Published This Month</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-check"/></svg></div></div><div class="kpi-value mono" id="kpi-published">0</div><div class="kpi-sub">across all platforms</div></div>
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Overdue</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-calendar"/></svg></div></div><div class="kpi-value mono" id="kpi-overdue">0</div><div class="kpi-sub">past due, not yet published</div></div>
  </div>
  <div class="toolbar">
    <div class="filter-group"><span class="filter-label">Platform</span><div id="platform-chips"></div></div>
    <div class="filter-group"><select class="select-sm" id="assignee-filter" onchange="renderBoard()"></select><button class="btn primary" onclick="openContentModal()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New Content</button></div>
  </div>
  <div class="board-scroll"><div class="board" id="board"></div></div>
  `;
}
function initContentBoard(){
  const chipWrap = document.getElementById('platform-chips');
  const all = ['All', ...PLATFORMS.map(p=>p.key)];
  chipWrap.innerHTML = all.map(k=>`<button class="chip ${k===contentPlatformFilter?'active':''}" onclick="setPlatformFilter('${k}')">${k}</button>`).join(' ');
  const sel = document.getElementById('assignee-filter');
  sel.innerHTML = '<option value="All">All assignees</option>' + employees.map(e=>`<option>${esc(e.name)}</option>`).join('') + '<option value="Unassigned">Unassigned</option>';
  renderBoard();
}
function setPlatformFilter(k){ contentPlatformFilter = k; initContentBoard(); }
function isContentOverdue(item){ return item.stage!=='Published' && item.due && item.due < TODAY; }
function platformIcon(name){ const p = PLATFORMS.find(x=>x.key===name); return p ? p.icon : 'i-globe'; }
function contentCardHTML(item){
  const filterOk = (contentPlatformFilter==='All' || item.platforms.includes(contentPlatformFilter));
  if(!filterOk) return '';
  const assigneeFilter = document.getElementById('assignee-filter').value;
  if(assigneeFilter && assigneeFilter!=='All'){
    if(assigneeFilter==='Unassigned' && item.assignee) return '';
    if(assigneeFilter!=='Unassigned' && item.assignee!==assigneeFilter) return '';
  }
  const overdue = isContentOverdue(item);
  const dueLabel = item.stage==='Published'
    ? `<span class="due published-on"><svg class="icon" style="width:10px;height:10px;display:inline;vertical-align:-1px"><use href="#i-check"/></svg> ${item.due}</span>`
    : `<span class="due ${overdue?'overdue':''}">${overdue?'overdue · ':''}${item.due||'no date'}</span>`;
  const inits = item.assignee ? initials(item.assignee) : '—';
  const stageOptions = STAGES.map(s=>`<option value="${s}" ${s===item.stage?'selected':''}>${s}</option>`).join('');
  return `
    <div class="card ${item.stage==='Published'?'published':''}" draggable="true" data-id="${item.id}" ondragstart="onDragStart(event,${item.id})">
      <div class="card-title">${esc(item.title)}</div>
      <div class="card-meta"><span class="tag type">${esc(item.type)}</span>${item.platforms.map(p=>`<span class="tag"><svg class="icon"><use href="#${platformIcon(p)}"/></svg>${p}</span>`).join('')}</div>
      <div class="card-foot"><span class="assignee"><span class="mini-avatar sm ${item.assignee?'':'unassigned'}">${inits}</span>${esc(item.assignee||'Unassigned')}</span>${dueLabel}</div>
      <div class="card-move"><select onchange="moveContentCard(${item.id}, this.value)">${stageOptions}</select><button class="card-edit" title="Edit" onclick="openContentModal(${item.id})"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg></button></div>
    </div>`;
}
function renderBoard(){
  const board = document.getElementById('board');
  if(!board) return;
  board.innerHTML = STAGES.map(stage=>{
    const inStage = contentItems.filter(i=>i.stage===stage);
    const cards = inStage.map(contentCardHTML).join('');
    const visibleCount = inStage.filter(i=>contentCardHTML(i)!=='').length;
    return `<div class="col" data-stage="${stage}" ondragover="onDragOver(event)" ondrop="onDrop(event,'${stage}')" ondragleave="onDragLeave(event)">
      <div class="col-head"><span class="name">${stage}</span><span class="count">${visibleCount}</span></div>
      <div class="col-cards">${cards}</div>
      <button class="col-add" onclick="openContentModal(null,'${stage}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Add</button>
    </div>`;
  }).join('');
  renderContentKPIs();
}
function renderContentKPIs(){
  const active = contentItems.filter(i=>i.stage!=='Published').length;
  const production = contentItems.filter(i=>i.stage==='Scripting'||i.stage==='Production').length;
  const thisMonth = TODAY.slice(0,7);
  const published = contentItems.filter(i=>i.stage==='Published' && i.due && i.due.slice(0,7)<=thisMonth).length;
  const overdue = contentItems.filter(isContentOverdue).length;
  document.getElementById('kpi-active').textContent = active;
  document.getElementById('kpi-production').textContent = production;
  document.getElementById('kpi-published').textContent = published;
  const overdueEl = document.getElementById('kpi-overdue');
  overdueEl.textContent = overdue;
  overdueEl.classList.toggle('warn', overdue>0);
}
let dragId = null;
function onDragStart(e,id){ dragId=id; e.dataTransfer.effectAllowed='move'; }
function onDragOver(e){ e.preventDefault(); e.currentTarget.classList.add('drop-hover'); }
function onDragLeave(e){ e.currentTarget.classList.remove('drop-hover'); }
function onDrop(e, stage){ e.preventDefault(); e.currentTarget.classList.remove('drop-hover'); if(dragId!=null) moveContentCard(dragId, stage); dragId=null; }
async function moveContentCard(id, stage){
  const item = contentItems.find(i=>i.id===id);
  if(!item) return;
  const prevStage = item.stage;
  item.stage = stage; renderBoard(); // optimistic — snappy drag/drop feedback
  try{
    await apiJson(`/api/content/items/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ stage: TITLECASE_TO_API(stage) }) });
  }catch(err){ item.stage = prevStage; toast(err.message || "Couldn't move card"); renderBoard(); }
}
let editingContentId = null;
function openContentModal(id, presetStage){
  editingContentId = id || null;
  const item = id ? contentItems.find(i=>i.id===id) : null;
  showModal(`
    <div class="modal-head"><h3>${id?'Edit Content':'New Content'}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div><label class="field-label">Title</label><input class="field-input" id="f-title" value="${item?esc(item.title):''}" placeholder="e.g. 5 AI tools every content creator needs"></div>
      <div class="field-row">
        <div><label class="field-label">Type</label><select class="field-input" id="f-type"><option>Reel</option><option>Carousel</option><option>Post</option><option>Story</option><option>Blog Post</option><option>YouTube Video</option><option>Short</option></select></div>
        <div><label class="field-label">Stage</label><select class="field-input" id="f-stage">${STAGES.map(s=>`<option>${s}</option>`).join('')}</select></div>
      </div>
      <div><label class="field-label">Platforms</label><div class="check-row" id="f-platforms">${PLATFORMS.map(p=>`<label class="check-chip" id="chip-${p.key}"><input type="checkbox" value="${p.key}" onchange="onPlatformCheck('${p.key}')"><svg class="icon" style="width:12px;height:12px"><use href="#${p.icon}"/></svg>${p.key}</label>`).join('')}</div></div>
      <div class="field-row">
        <div><label class="field-label">Assignee</label><select class="field-input" id="f-assignee"><option value="">Unassigned</option>${employees.map(e=>`<option>${esc(e.name)}</option>`).join('')}</select></div>
        <div><label class="field-label">Due date</label><input class="field-input" type="date" id="f-due" value="${item?item.due:''}"></div>
      </div>
      <div><label class="field-label">Brief / notes</label><textarea class="field-input" id="f-notes" placeholder="Angle, references, key points…">${item?esc(item.notes):''}</textarea></div>
    </div>
    <div class="modal-foot">
      ${id?'<button class="btn danger" onclick="deleteContentCard()">Delete</button>':'<div></div>'}
      <div style="display:flex;gap:8px;"><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveContentCard()">Save</button></div>
    </div>`);
  document.getElementById('f-type').value = item ? item.type : 'Reel';
  document.getElementById('f-stage').value = item ? item.stage : (presetStage || 'Idea');
  document.getElementById('f-assignee').value = item ? item.assignee : '';
  document.querySelectorAll('#f-platforms input').forEach(cb=>{ cb.checked = item ? item.platforms.includes(cb.value) : false; onPlatformCheck(cb.value); });
}
function onPlatformCheck(key){ document.getElementById('chip-'+key).classList.toggle('checked', document.querySelector(`#chip-${key} input`).checked); }
async function saveContentCard(){
  const title = document.getElementById('f-title').value.trim();
  if(!title){ document.getElementById('f-title').focus(); return; }
  const platforms = Array.from(document.querySelectorAll('#f-platforms input:checked')).map(cb=>cb.value);
  const payload = { title, type: document.getElementById('f-type').value, stage: TITLECASE_TO_API(document.getElementById('f-stage').value), assignee: document.getElementById('f-assignee').value||undefined, dueAt: document.getElementById('f-due').value, notes: document.getElementById('f-notes').value||undefined, platforms };
  try{
    if(editingContentId) await apiJson(`/api/content/items/${editingContentId}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) });
    else await apiJson("/api/content/items", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) });
    await loadContentItems();
    toast("Content saved"); closeModal(); renderBoard();
  }catch(err){ toast(err.message || "Couldn't save content"); }
}
async function deleteContentCard(){
  if(!editingContentId) return;
  try{
    await Auth.apiFetch(`/api/content/items/${editingContentId}`, { method:"DELETE" });
    await loadContentItems();
    toast("Content deleted"); closeModal(); renderBoard();
  }catch(err){ toast("Couldn't delete content"); }
}

function clientPaymentDue(clientId){ return invoices.filter(i=>i.clientId===clientId).reduce((s,i)=>s+invoiceBalance(i),0); }
function clientsAll(){
  // The server already scopes `clients` to just this Sales caller's own book when they're a plain
  // Sales role (see listClients) — this just labels the view to match what's actually being shown.
  const isSalesViewer = isSalesRepRole(currentUser);
  const filtered = clients.filter(c=>clientsMonthFilter==='All' || c.onboarded.slice(0,7)===clientsMonthFilter);
  const hidePayment = isStaffRole(currentUser);
  return `
  <div class="toolbar"><div class="filter-group"><span class="filter-label">Onboarded</span><select class="select-sm" onchange="setClientsMonthFilter(this.value)">${monthFilterOptions(clients.map(c=>c.onboarded), clientsMonthFilter)}</select></div><button class="btn primary" onclick="openAddClient()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Add client</button></div>
  <div class="panel">
    <div class="panel-head"><h3>${isSalesViewer?'My clients':'Clients'}</h3><div class="sub">${filtered.length} of ${clients.length}${clientsMonthFilter!=='All'?' onboarded in '+monthLabel(clientsMonthFilter):' on record'}</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Client</th><th>Services</th><th>Account Manager</th><th>Sales Person</th>${hidePayment?'':'<th class="num">Payment Due</th>'}<th>Status</th><th></th></tr></thead>
      <tbody>${filtered.map(c=>{ const due=clientPaymentDue(c.id); return `<tr class="row-click" onclick="openClientDetail('${c.id}')"><td>${clientCell(c.id)}</td><td class="muted" style="max-width:220px;">${c.services.map(s=>`<span class="tag" style="margin:1px 3px 1px 0;">${esc(s)}</span>`).join('')}</td><td class="muted">${esc(c.accountManager)}</td><td class="muted">${esc(c.salesPerson)}</td>${hidePayment?'':`<td class="num mono" style="${due>0?'color:var(--neg);font-weight:700;':''}">${due>0?inr(due):'—'}</td>`}<td>${pill(c.status,c.status==='Active'?'pos':c.status==='Paused'?'warn':'neg')}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm ghost" onclick="event.stopPropagation();openEditClient('${c.id}')" title="Edit client"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button>${canDeleteClients()?`<button class="btn btn-sm ghost" onclick="event.stopPropagation();openConfirmDelete('client','${c.id}')" title="Delete client"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button>`:''}</div></td></tr>`; }).join("") || `<tr><td colspan="${hidePayment?6:7}"><div class="empty">${isSalesViewer?'No clients assigned to you yet.':'No clients onboarded that month.'}</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
// Mirrors deleteClient() server-side: only Admin / Sales Head may delete (a Sales rep can still edit).
function canDeleteClients(){ return !!(currentUser && (currentUser.isAdmin || (currentUser.roles||[]).includes('SALES_HEAD'))); }
function openClientDetail(id){ nav.detail = {type:'client', id}; render(); }
// A client's whole page IS their workflow — one Payment section (every invoice raised against them)
// and one Task board (every activity done for them), nothing split off into a separate "project".
function clientDetailPage(id){
  const c = clientById(id);
  const billingType = c.billingType || "Prepaid";
  const boardFilter = clientTaskBoardMonthFilter[id] || "All";
  const boardTasks = tasksOf(id).filter(t=>!isTaskArchived(t));
  const boardTasksFiltered = boardTasks.filter(t=>matchesDateFilter(t.due, boardFilter));
  const clientInvoices = invoices.filter(i=>i.clientId===id).slice().sort((a,b)=>b.issued.localeCompare(a.issued));
  const billed = clientInvoices.reduce((s,i)=>s+invoiceTotal(i),0);
  const pending = clientInvoices.reduce((s,i)=>s+invoiceBalance(i),0);
  const received = billed - pending;
  const isUnbilledPostpaid = billingType==="Postpaid" && clientInvoices.length===0;
  const hidePayment = isStaffRole(currentUser);
  return `
    <div class="toolbar"><button class="btn ghost" onclick="closeDetail()"><svg class="icon" style="width:13px;height:13px"><use href="#i-chevron-left"/></svg>Back</button><button class="btn primary" onclick="openEditClient('${c.id}')"><svg class="icon" style="width:13px;height:13px"><use href="#i-edit"/></svg>Edit client</button></div>
    <div class="panel">
      <div class="panel-head"><h3>${esc(c.name)}</h3><div class="sub">${esc(c.industry)} · ${esc(c.city)}</div></div>
      <div class="modal-body">
      <div class="field-row cols-3">
        <div><label class="field-label">Status</label><div>${pill(c.status,c.status==='Active'?'pos':c.status==='Paused'?'warn':'neg')}</div></div>
        <div><label class="field-label">Account Manager</label><div>${esc(c.accountManager)}</div></div>
        <div><label class="field-label">Sales Person</label><div>${esc(c.salesPerson)}</div></div>
        <div><label class="field-label">Onboarded</label><div>${fmtDate(c.onboarded)}</div></div>
        <div><label class="field-label">Billing</label><div>${billingType==='Postpaid'?pill('Postpaid','blue'):esc(billingType)}</div></div>
        <div><label class="field-label">Services</label><div>${c.services.map(s=>`<span class="tag" style="margin:1px 3px 1px 0;">${esc(s)}</span>`).join('')}</div></div>
      </div>
      ${hidePayment ? '' : `
      <div class="section-label">Payment</div>
      ${isUnbilledPostpaid ? `<div class="banner"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div><b>Post-paid client.</b> Amount is only finalized and invoiced once the work is complete.</div></div>` : `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">Billed</div><div class="kpi-value mono" style="font-size:19px;">${inr(billed)}</div><div class="kpi-sub">${clientInvoices.length} invoice${clientInvoices.length===1?'':'s'}</div></div>
        <div class="kpi-card"><div class="kpi-label">Received</div><div class="kpi-value mono pos" style="font-size:19px;">${inr(received)}</div></div>
        <div class="kpi-card hero"><div class="kpi-label">Pending</div><div class="kpi-value mono ${pending>0?'warn':''}" style="font-size:19px;">${inr(pending)}</div><div class="kpi-sub">${pending>0?'awaiting payment':'fully settled'}</div></div>
      </div>
      ${clientInvoices.length?`<div class="table-wrap"><table class="data"><thead><tr><th>Invoice</th><th>Issued</th><th class="num">Amount</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
        <tbody>${clientInvoices.map(i=>{ const st=invoiceStatus(i), bal=invoiceBalance(i), pendingAmt=invoicePendingAmount(i); return `<tr><td class="mono">${esc(i.invoiceNo)}</td><td class="muted">${fmtDateShort(i.issued)}</td><td class="num mono">${inr(invoiceTotal(i))}</td><td class="num mono">${bal>0?inr(bal):'<span class="faint">—</span>'}</td><td>${pill(st,invStatusKind(st))}${pendingAmt>0?' '+pill(inr(pendingAmt)+' pending Finance','warn'):''}</td><td><div style="display:flex;gap:6px;flex-wrap:wrap;">${bal>0?`<button class="btn btn-sm ghost" onclick="openSubmitInvoicePayment('${i.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-coins"/></svg>Log payment</button>`:''}<button class="btn btn-sm ghost" onclick="downloadInvoice('${i.id}')" title="Download invoice"><svg class="icon" style="width:12px;height:12px"><use href="#i-download"/></svg>Download</button>${(i.payments||[]).length?`<button class="btn btn-sm ghost" onclick="openInvoicePayments('${i.id}')" title="Payment receipts"><svg class="icon" style="width:12px;height:12px"><use href="#i-receipt"/></svg>Payments</button>`:''}</div></td></tr>`; }).join("")}</tbody>
      </table></div>`:`<div class="empty">No invoice raised for this client yet.</div>`}`}`}
      <div class="section-label" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div style="display:flex;align-items:center;gap:8px;">Workflow<span class="faint" style="font-weight:600;font-size:11.5px;text-transform:none;letter-spacing:0;">${boardTasksFiltered.length} of ${boardTasks.length}${dateFilterSuffix(boardFilter)}</span></div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <div class="filter-group"><span class="filter-label">Show</span><select class="select-sm" onchange="setClientTaskBoardMonthFilter('${c.id}', this.value)">${dateFilterOptions(tasksOf(c.id).map(t=>t.due), boardFilter)}</select></div>
          ${tasksOf(c.id).filter(isTaskArchived).length?`<button class="btn btn-sm ghost" onclick="openTaskArchive('${c.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-archive"/></svg>Archive (${tasksOf(c.id).filter(isTaskArchived).length})</button>`:''}
          <button class="btn btn-sm ghost" onclick="openAddTask('${c.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Add task</button>
        </div>
      </div>
      <div class="board-scroll"><div class="board" id="client-task-board"></div></div>
      </div>
    </div>`;
}
function openEditClient(id){
  const c = clientById(id);
  showModal(`
    <div class="modal-head"><h3>Edit client</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-edit-client"><div class="modal-body">
      <div><label class="field-label">Client name</label><input class="field-input" name="name" required value="${esc(c.name)}"></div>
      <div class="field-row">
        <div><label class="field-label">Industry</label><input class="field-input" name="industry" required value="${esc(c.industry)}"></div>
        <div><label class="field-label">City</label><input class="field-input" name="city" required value="${esc(c.city)}"></div>
      </div>
      <div><label class="field-label">Services</label><div class="check-row">${SERVICE_DEPARTMENTS.map(d=>`<label class="check-chip"><input type="checkbox" name="services" value="${esc(d)}" ${c.services.includes(d)?'checked':''}>${esc(d)}</label>`).join('')}</div></div>
      <div class="field-row">
        <div><label class="field-label">Account Manager</label><select class="field-input" name="accountManager">${assignableEmployees().map(e=>`<option ${e.name===c.accountManager?'selected':''}>${esc(e.name)}</option>`).join('')}</select></div>
        <div><label class="field-label">Sales Person</label><select class="field-input" name="salesPerson">${(()=>{ const pool=assignableEmployees(); const s=pool.filter(e=>e.dept==='Sales'); return (s.length?s:pool).map(e=>`<option ${e.name===c.salesPerson?'selected':''}>${esc(e.name)}</option>`).join(''); })()}</select></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">Status</label><select class="field-input" name="status">${["Active","Paused","Churned"].map(s=>`<option ${s===c.status?'selected':''}>${s}</option>`).join('')}</select></div>
        <div><label class="field-label">Billing</label><select class="field-input" name="billingType">${["Prepaid","Postpaid"].map(b=>`<option ${b===(c.billingType||"Prepaid")?'selected':''}>${b}</option>`).join('')}</select></div>
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save changes</button></div></div>
    </form>`);
  document.getElementById("f-edit-client").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      await apiJson(`/api/crm/clients/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({
        name:f.get("name"), industry:f.get("industry"), city:f.get("city"), services:f.getAll("services"),
        accountManager:f.get("accountManager")||undefined, salesPerson:f.get("salesPerson")||undefined,
        status:TITLECASE_TO_API(f.get("status")), billingType:TITLECASE_TO_API(f.get("billingType")),
      })});
      await loadClients();
      toast("Client updated"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't update client"); }
  });
}
function mktPerformance(){
  const rows = metaAdsCampaigns.map(adMetrics);
  const totals = rows.reduce((s,r)=>({spend:s.spend+r.spend, impressions:s.impressions+r.impressions, clicks:s.clicks+r.clicks, leads:s.leads+r.leads}),{spend:0,impressions:0,clicks:0,leads:0});
  const avgCtr = totals.impressions ? (totals.clicks/totals.impressions*100) : 0;
  const avgCpl = totals.leads ? totals.spend/totals.leads : 0;
  const activeCount = rows.filter(r=>r.status==="Active").length;
  return `
  <div class="banner">
    <svg class="icon" style="width:15px;height:15px"><use href="#i-target"/></svg>
    <div><b>Our own Meta Ads.</b> Performance of DesGro Media's own Facebook/Instagram campaigns — lead generation for our services and Demand School enrollment. This is not client ad spend.</div>
  </div>
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-label">Active Campaigns</div><div class="kpi-value mono">${activeCount}<span style="font-size:14px;color:var(--ink-soft);font-family:Manrope;"> / ${rows.length}</span></div></div>
    <div class="kpi-card"><div class="kpi-label">Total Spend</div><div class="kpi-value mono" style="font-size:20px;">${inr(totals.spend)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Avg. CTR</div><div class="kpi-value mono" style="font-size:20px;">${avgCtr.toFixed(2)}%</div></div>
    <div class="kpi-card hero"><div class="kpi-label">Cost per Lead</div><div class="kpi-value mono" style="font-size:20px;">${inr(avgCpl)}</div><div class="kpi-sub">${totals.leads} leads total</div></div>
  </div>
  <div class="panel">
    <div class="panel-head"><div><h3>Campaigns</h3><div class="sub">DesGro Media's own Meta Ads accounts</div></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Campaign</th><th>Objective</th><th>Platform</th><th class="num">Spend</th><th class="num">Impressions</th><th class="num">Clicks</th><th class="num">CTR</th><th class="num">CPC</th><th class="num">Leads</th><th class="num">Cost / Lead</th><th>Status</th></tr></thead>
      <tbody>${rows.map(r=>`<tr><td style="font-weight:700;">${esc(r.name)}</td><td class="muted">${esc(r.objective)}</td><td class="muted">${esc(r.platform)}</td><td class="num mono">${inr(r.spend)}</td><td class="num mono">${r.impressions.toLocaleString("en-IN")}</td><td class="num mono">${r.clicks.toLocaleString("en-IN")}</td><td class="num mono">${r.ctr.toFixed(2)}%</td><td class="num mono">${inr(r.cpc)}</td><td class="num mono" style="font-weight:700;">${r.leads}</td><td class="num mono">${inr(r.cpl)}</td><td>${pill(r.status, r.status==="Active"?"pos":"neutral")}</td></tr>`).join("")}</tbody>
    </table></div>
  </div>`;
}
function mktLeads(){
  // A sales person's own pipeline is just that — theirs (the server already
  // scopes marketingLeads for a Sales caller to their own + Open — see
  // listLeads). They still see the shared Open leads queue below to claim
  // from. Anyone else (Leadership, Marketing/Staff, Admin) sees everyone's.
  const isSalesViewer = isSalesRepRole(currentUser);
  const pipelineSource = isSalesViewer ? marketingLeads.filter(l=>l.leadOwner===currentUser.name) : marketingLeads;
  const filtered = pipelineSource.filter(l=>matchesDateFilter(l.createdDate, leadsMonthFilter));
  const sorted = filtered.slice().sort((a,b)=>b.createdDate.localeCompare(a.createdDate));
  // Open leads — organic sign-ups nobody's claimed yet. Surfaced across the
  // whole pipeline, not just this month's filter, so one never quietly ages
  // out of sight. Shared across everyone, Sales included — it's the queue
  // they claim from.
  const openLeads = marketingLeads.filter(l=>!l.leadOwner).slice().sort((a,b)=>b.createdDate.localeCompare(a.createdDate));
  const canClaim = isSalesRole(currentUser);
  return `
  <div class="toolbar"><div class="filter-group"><span class="filter-label">Show</span><select class="select-sm" onchange="setLeadsMonthFilter(this.value)">${dateFilterOptions(pipelineSource.map(l=>l.createdDate), leadsMonthFilter)}</select></div><button class="btn primary" onclick="openAddLead()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New lead</button></div>
  ${openLeads.length ? `
  <div class="panel">
    <div class="panel-head">
      <div><h3>Open leads</h3><div class="sub">Came in through the website / Instagram / WhatsApp form — not yet assigned to anyone${canClaim?'. Claim one to start working it.':'.'}</div></div>
      ${pill(openLeads.length+" open", "warn")}
    </div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Lead</th><th>Service Interested</th><th>Source</th><th>Created</th><th></th></tr></thead>
      <tbody>${openLeads.map(l=>`<tr><td><div style="font-weight:700;font-size:13px;">${esc(l.name)}</div><div class="subtext">${esc(l.email)}</div></td><td class="muted">${esc(l.serviceInterested)}</td><td class="muted">${esc(l.source)}</td><td class="muted">${fmtDate(l.createdDate)}</td><td>${leadOwnerActionsCell(l)}</td></tr>`).join("")}</tbody>
    </table></div>
  </div>` : ''}
  <div class="panel">
    <div class="panel-head"><h3>${isSalesViewer?'My leads':'Lead pipeline'}</h3><div class="sub">${filtered.length} of ${pipelineSource.length}${dateFilterSuffix(leadsMonthFilter)}</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Lead</th><th>Service Interested</th><th>Source</th>${isSalesViewer?'':'<th>Lead Owner</th>'}<th>Created</th><th></th></tr></thead>
      <tbody>${sorted.map(l=>`<tr><td><div style="font-weight:700;font-size:13px;">${esc(l.name)}</div><div class="subtext">${esc(l.email)}</div></td><td class="muted">${esc(l.serviceInterested)}</td><td class="muted">${esc(l.source)}</td>${isSalesViewer?'':`<td>${l.leadOwner ? `<span class="muted">${esc(l.leadOwner)}</span>` : pill("Open","warn")}</td>`}<td class="muted">${fmtDate(l.createdDate)}</td><td>${leadOwnerActionsCell(l)}</td></tr>`).join("") || `<tr><td colspan="${isSalesViewer?5:6}"><div class="empty">${isSalesViewer?'No leads assigned to you yet — claim one above.':'No leads match this filter.'}</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
// Any Sales caller can claim an unowned lead for themselves — Leadership/Admin
// don't get the claim button since they're not the ones working the pipeline.
function leadOwnerActionsCell(l){
  const canClaim = !l.leadOwner && currentUser && isSalesRole(currentUser);
  const assignBtn = canClaim ? `<button class="btn btn-sm primary" onclick="assignLeadToMe('${l.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Assign to me</button>` : '';
  // Mirrors deleteLead() server-side: Admin / Sales Head delete any; a Sales rep only their own claimed leads.
  const canDelete = currentUser && (currentUser.isAdmin || (currentUser.roles||[]).includes('SALES_HEAD') || (l.leadOwner && l.leadOwner===currentUser.name));
  const delBtn = canDelete ? `<button class="btn btn-sm ghost" onclick="openConfirmDelete('lead','${l.id}')" title="Delete lead"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button>` : '';
  return `<div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;">${assignBtn}<button class="btn btn-sm ghost" onclick="openEditLead('${l.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button>${delBtn}</div>`;
}
async function assignLeadToMe(id){
  if(!currentUser) return;
  const l = marketingLeads.find(x=>x.id===id);
  if(!l || l.leadOwner) return;
  try{
    await apiJson(`/api/crm/leads/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ leadOwner: currentUser.name }) });
    await loadLeads();
    toast(l.name+" assigned to you"); render();
  }catch(err){ toast(err.message || "Couldn't assign lead"); }
}
function salesTeamOptions(){
  const pool = assignableEmployees();
  const salesEmps = pool.filter(e=>e.dept==='Sales');
  return (salesEmps.length?salesEmps:pool).map(e=>`<option>${esc(e.name)}</option>`).join('');
}
function quoteActionsMkt(q){
  const downloadBtn = `<button class="btn btn-sm ghost" onclick="downloadQuote('${q.id}')" title="Download quote"><svg class="icon" style="width:12px;height:12px"><use href="#i-download"/></svg>Download</button>`;
  const editBtn = `<button class="btn btn-sm ghost" onclick="openEditQuote('${q.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button>`;
  // The server refuses to delete once a quote has been invoiced (append-only ledger) — don't offer it then.
  const delBtn = q.invoiceId ? '' : `<button class="btn btn-sm ghost" onclick="openConfirmDelete('quote','${q.id}')" title="Delete quote"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button>`;
  // No "Send to client" / "Record payment" on a quote: it goes straight from Draft to an invoice, and
  // payments are recorded on the invoice (Finance approves them from Payment Receipts). "Sent" only
  // remains for quotes that were sent before this — same actions as a Draft.
  if(q.status==="Draft" || q.status==="Sent") return `<div style="display:flex;gap:6px;flex-wrap:wrap;"><button class="btn btn-sm primary" onclick="openConvertQuoteToInvoice('${q.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-receipt"/></svg>Convert to invoice</button>${editBtn}<button class="btn btn-sm ghost" onclick="markQuoteLost('${q.id}')">Mark lost</button>${downloadBtn}${delBtn}</div>`;
  if(q.status==="Submitted to Finance"){
    const pending = quotePendingAmount(q);
    return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">${pending>0?`<span class="faint" style="font-size:11.5px;">${inr(pending)} awaiting Finance</span>`:''}${downloadBtn}${delBtn}</div>`;
  }
  if(q.status==="Invoiced"){
    const inv = q.invoiceId ? invoices.find(x=>x.id===q.invoiceId) : null;
    return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><span class="faint" style="font-size:11.5px;">${esc(inv?inv.invoiceNo:(q.invoiceId||''))}</span>${downloadBtn}</div>`;
  }
  return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">${downloadBtn}${delBtn}</div>`;
}
function partyOptions(selectedValue){
  // A Sales quote-creator can only quote leads they've actually claimed —
  // no picking an unclaimed Open lead nobody's accountable for yet (they
  // still see clients scoped the same way, but that's already handled by
  // the server — see listClients).
  const isSalesCreator = isSalesRepRole(currentUser);
  const leadPool = isSalesCreator ? marketingLeads.filter(l=>l.leadOwner===currentUser.name) : marketingLeads;
  const clientOpts = clients.map(c=>`<option value="client:${c.id}" ${selectedValue==='client:'+c.id?'selected':''}>${esc(c.name)}</option>`).join('');
  const leadOpts = leadPool.map(l=>`<option value="lead:${l.id}" ${selectedValue==='lead:'+l.id?'selected':''}>${esc(l.name)} — lead</option>`).join('');
  return `<optgroup label="Existing clients">${clientOpts}</optgroup><optgroup label="Leads (not yet a client)">${leadOpts}</optgroup>`;
}
function quoteServiceRows(items){
  const rows = [];
  for(let i=1;i<=4;i++) rows.push(items[i-1] || {dept:"", amount:""});
  return rows.map((it,idx)=>{ const i=idx+1; return `
  <div class="field-row" style="align-items:flex-end;">
    <div style="flex:2;"><label class="field-label">${i===1?'Service':''}</label><select class="field-input" name="dept${i}" onchange="updateQuoteTotal()" ${i===1?'required':''}><option value="">— none —</option>${SERVICE_DEPARTMENTS.map(d=>`<option ${d===it.dept?'selected':''}>${esc(d)}</option>`).join('')}</select></div>
    <div><label class="field-label">${i===1?'Amount (₹)':''}</label><input class="field-input" type="number" min="0" name="amount${i}" value="${it.amount||''}" placeholder="0" oninput="updateQuoteTotal()" ${i===1?'required':''}></div>
  </div>`; }).join("");
}
function updateQuoteTotal(){
  let total=0;
  for(let i=1;i<=4;i++){ const amt = document.querySelector(`[name="amount${i}"]`); total += Number((amt&&amt.value)||0); }
  const el = document.getElementById("quote-total-indicator");
  if(el) el.innerHTML = "Total: <b>"+inr(total)+"</b>";
}
function mktQuotes(){
  // Same story as clientsAll(): the server already scopes `quotes` to just this Sales caller's own
  // (createdBy===them) when they're a plain Sales role (see listQuotes) — this just labels it.
  const isSalesViewer = isSalesRepRole(currentUser);
  const filtered = quotes.filter(q=>matchesDateFilter(q.createdDate, quotesMonthFilter));
  const sorted = filtered.slice().sort((a,b)=>b.createdDate.localeCompare(a.createdDate));
  return `
  <div class="toolbar"><div class="filter-group"><span class="filter-label">Show</span><select class="select-sm" onchange="setQuotesMonthFilter(this.value)">${dateFilterOptions(quotes.map(q=>q.createdDate), quotesMonthFilter)}</select></div><button class="btn primary" onclick="openAddQuote()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New quote</button></div>
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>A quote can be for an existing client or a lead, with several services priced independently. Convert it to an invoice when the client accepts — a lead becomes a client at that point. Record the client's payments on the invoice (Marketing &gt; Invoices); Finance confirms each one from Accounts &gt; Payment Receipts.</div></div>
  <div class="panel">
    <div class="panel-head"><h3>${isSalesViewer?'My quotes':'Quotes'}</h3><div class="sub">${filtered.length} of ${quotes.length}${dateFilterSuffix(quotesMonthFilter)}</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Quote</th><th>For</th><th>Service(s)</th><th class="num">Amount</th><th>Prepared by</th><th>Status</th><th></th></tr></thead>
      <tbody>${sorted.map(q=>{ const party=quoteParty(q); return `<tr><td style="font-weight:700;">${esc(q.title)}</td><td class="muted">${esc(party.name)}${party.kind==='lead'?' '+pill('Lead','blue'):''}</td><td class="muted">${q.items.map(i=>esc(i.dept)).join(', ')}</td><td class="num mono">${inr(quoteTotal(q))}</td><td class="muted">${esc(q.createdBy)}</td><td>${pill(q.status,quoteStatusKind(q.status))}</td><td>${quoteActionsMkt(q)}</td></tr>`; }).join("") || `<tr><td colspan="7"><div class="empty">${isSalesViewer?'No quotes prepared by you yet.':'No quotes that month.'}</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
// Every client is expected to carry at least one invoice unless they're Postpaid — a Postpaid
// client's amount is only finalized once the service is complete, so it's fine (and expected) to
// have none yet. Anything Prepaid (the default) with zero invoices raised against it is a gap
// Sales/Finance should close.
function clientsMissingInvoice(){
  return clients.filter(c => (c.billingType||"Prepaid")!=="Postpaid" && !invoices.some(i=>i.clientId===c.id));
}
// Invoices are Finance's ledger — the server only lets Finance/Admin edit or delete them (Sales can log payments).
function canEditInvoices(){ return isFinanceAdminUser(currentUser); }
function mktInvoices(){
  const missing = clientsMissingInvoice();
  // Shares invoicesMonthFilter with Accounts > Invoices — same "Today / month-wise / All time" filter either page sets carries to the other.
  const filtered = invoices.filter(i=>matchesDateFilter(i.issued, invoicesMonthFilter));
  const sorted = filtered.slice().sort((a,b)=>b.issued.localeCompare(a.issued));
  const totalReceivable = invoices.reduce((s,i)=>s+invoiceBalance(i),0);
  return `
  <div class="toolbar"><div class="filter-group"><span class="filter-label">Show</span><select class="select-sm" onchange="setInvoicesMonthFilter(this.value)">${dateFilterOptions(invoices.map(i=>i.issued), invoicesMonthFilter)}</select></div><button class="btn primary" onclick="openAddInvoice()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New invoice</button></div>
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Every client should have a corresponding invoice — unless they're Postpaid, where the amount is only finalized once the service is complete. Use this to spot Prepaid clients Sales hasn't invoiced yet.</div></div>
  <div class="kpi-grid">
    <div class="kpi-card hero"><div class="kpi-label">Total Receivable</div><div class="kpi-value mono">${inr(totalReceivable)}</div><div class="kpi-sub">${invoices.length} invoices raised</div></div>
    <div class="kpi-card"><div class="kpi-label">Clients awaiting an invoice</div><div class="kpi-value mono ${missing.length?'warn':''}">${missing.length}</div><div class="kpi-sub">Prepaid only — Postpaid excluded</div></div>
  </div>
  ${missing.length?`<div class="panel">
    <div class="panel-head"><h3>Clients without an invoice</h3><div class="sub">${missing.length} Prepaid client${missing.length===1?'':'s'} with nothing raised yet</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Client</th><th>Services</th><th>Status</th><th></th></tr></thead>
      <tbody>${missing.map(c=>`<tr><td style="font-weight:700;">${esc(c.name)}</td><td class="muted">${c.services.map(s=>esc(s)).join(', ')}</td><td>${pill(c.status,c.status==='Active'?'pos':c.status==='Paused'?'warn':'neg')}</td><td><button class="btn btn-sm primary" onclick="openAddInvoice('${c.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Raise invoice</button></td></tr>`).join("")}</tbody>
    </table></div>
  </div>`:`<div class="banner"><svg class="icon" style="width:15px;height:15px"><use href="#i-check"/></svg><div>Every Prepaid client has a corresponding invoice.</div></div>`}
  <div class="panel">
    <div class="panel-head"><h3>All invoices</h3><div class="sub">${filtered.length} of ${invoices.length}${dateFilterSuffix(invoicesMonthFilter,'issued in')} · log a payment you've collected here and push it to Finance for confirmation</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Invoice</th><th>Client</th><th>Service(s)</th><th class="num">Amount</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
      <tbody>${sorted.map(i=>{ const st=invoiceStatus(i), bal=invoiceBalance(i), pendingAmt=invoicePendingAmount(i); return `<tr><td class="mono">${esc(i.invoiceNo)}</td><td class="muted">${clientById(i.clientId).name}</td><td class="muted">${(i.items||[]).map(it=>esc(it.dept)).join(', ')||'<span class="faint">—</span>'}</td><td class="num mono">${inr(invoiceTotal(i))}</td><td class="num mono">${bal>0?inr(bal):'<span class="faint">—</span>'}</td><td>${pill(st,invStatusKind(st))}</td><td><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">${bal>0?`<button class="btn btn-sm" onclick="openSubmitInvoicePayment('${i.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-coins"/></svg>Log payment</button>`:''}${pendingAmt>0?`<span class="faint" style="font-size:11.5px;">${inr(pendingAmt)} awaiting Finance</span>`:''}<button class="btn btn-sm ghost" onclick="downloadInvoice('${i.id}')" title="Download invoice"><svg class="icon" style="width:12px;height:12px"><use href="#i-download"/></svg>Download</button>${(i.payments||[]).length?`<button class="btn btn-sm ghost" onclick="openInvoicePayments('${i.id}')" title="Payment receipts"><svg class="icon" style="width:12px;height:12px"><use href="#i-receipt"/></svg>Payments</button>`:''}${canEditInvoices()?`<button class="btn btn-sm ghost" onclick="openEditInvoice('${i.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button>${(i.payments||[]).length?'':`<button class="btn btn-sm ghost" onclick="openConfirmDelete('invoice','${i.id}')" title="Delete"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button>`}`:''}</div></td></tr>`; }).join("") || `<tr><td colspan="7"><div class="empty">No invoices yet.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
function openAddQuote(){
  showModal(`
    <div class="modal-head"><h3>New quote</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-add-quote"><div class="modal-body">
      <div><label class="field-label">For</label><select class="field-input" name="party">${partyOptions()}</select></div>
      <div class="section-label">Services — priced independently, total shown below</div>
      ${quoteServiceRows([])}
      <div id="quote-total-indicator" style="font-size:13px;padding-top:2px;">Total: <b>₹0</b></div>
      <div><label class="field-label">Title / description</label><input class="field-input" name="title" required placeholder="e.g. Q4 SMM Retainer"></div>
      <div class="subtext">Prepared by ${currentUser?esc(currentUser.name):'you'} — the real signed-in account, not a free-typed name.</div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save as draft</button></div></div>
    </form>`);
  document.getElementById("f-add-quote").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const [kind, partyId] = (f.get("party")||"").split(":");
    const items = [];
    for(let i=1;i<=4;i++){ const dept=f.get("dept"+i), amount=Number(f.get("amount"+i))||0; if(dept && amount>0) items.push({dept, amount}); }
    if(!items.length){ toast("Add at least one service with an amount"); return; }
    try{
      await apiJson("/api/crm/quotes", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ clientId: kind==='client'?partyId:undefined, leadId: kind==='lead'?partyId:undefined, items, title:f.get("title") }) });
      await loadQuotes();
      toast("Quote saved as draft"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't save quote"); }
  });
}
function openEditQuote(id){
  const q = quotes.find(x=>x.id===id);
  const partyValue = q.clientId ? "client:"+q.clientId : "lead:"+q.leadId;
  showModal(`
    <div class="modal-head"><h3>Edit quote</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-edit-quote"><div class="modal-body">
      <div><label class="field-label">For</label><select class="field-input" name="party">${partyOptions(partyValue)}</select></div>
      <div class="section-label">Services — priced independently, total shown below</div>
      ${quoteServiceRows(q.items)}
      <div id="quote-total-indicator" style="font-size:13px;padding-top:2px;">Total: <b>${inr(quoteTotal(q))}</b></div>
      <div><label class="field-label">Title / description</label><input class="field-input" name="title" required value="${esc(q.title)}"></div>
      <div class="subtext">Prepared by ${esc(q.createdBy||'—')}.</div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save changes</button></div></div>
    </form>`);
  document.getElementById("f-edit-quote").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const [kind, partyId] = (f.get("party")||"").split(":");
    const items = [];
    for(let i=1;i<=4;i++){ const dept=f.get("dept"+i), amount=Number(f.get("amount"+i))||0; if(dept && amount>0) items.push({dept, amount}); }
    if(!items.length){ toast("Add at least one service with an amount"); return; }
    try{
      // Explicit null (not omitted/undefined, which JSON.stringify would drop
      // anyway) clears whichever party field isn't the one selected here —
      // otherwise reassigning a quote from a lead to a client would leave
      // the stale leadId in place server-side.
      await apiJson(`/api/crm/quotes/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ clientId: kind==='client'?partyId:null, leadId: kind==='lead'?partyId:null, items, title:f.get("title") }) });
      await loadQuotes();
      toast("Quote updated"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't update quote"); }
  });
}
async function markQuoteLost(id){
  try{
    await apiJson(`/api/crm/quotes/${id}/lost`, { method:"POST" });
    await loadQuotes();
    toast("Quote marked lost"); render();
  }catch(err){ toast(err.message || "Couldn't update quote"); }
}
// How a quote becomes money: convert it to an invoice, then payments are recorded on the invoice
// (Invoices / Payment Receipts) and Finance approves them there.
function openConvertQuoteToInvoice(id){
  const q = quotes.find(x=>x.id===id);
  const party = quoteParty(q);
  showModal(`
    <div class="modal-head"><h3>Convert to invoice — ${esc(q.title)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-convert-quote"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${esc(party.name)}${party.kind==='lead'?' — a new lead, becomes a client the moment this is converted':''} · <b>${inr(quoteTotal(q))}</b> carried over exactly as quoted. Payments happen on the invoice from here — log and confirm them from Invoices / Payment Receipts, not on the quote.</div></div>
      <div class="field-row">
        <div><label class="field-label">Issued</label><input class="field-input" type="date" name="issued" value="${TODAY}" required></div>
        <div><label class="field-label">Due</label><input class="field-input" type="date" name="due" value="${TODAY}" required></div>
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Convert to invoice</button></div></div>
    </form>`);
  document.getElementById("f-convert-quote").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      const result = await apiJson(`/api/crm/quotes/${id}/convert-to-invoice`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ issuedAt:f.get("issued"), dueAt:f.get("due") }) });
      await Promise.all([loadQuotes(), loadClients(), loadLeads(), loadInvoices()]);
      toast("Converted to invoice "+result.invoiceNo+(result.convertedClientName?" · "+result.convertedClientName+" is now a client":"")); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't convert quote"); }
  });
}
function openAddClient(){
  showModal(`
    <div class="modal-head"><h3>Add client</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-add-client"><div class="modal-body">
      <div><label class="field-label">Client name</label><input class="field-input" name="name" required placeholder="e.g. Malabar Spices Co."></div>
      <div class="field-row">
        <div><label class="field-label">Industry</label><input class="field-input" name="industry" required placeholder="e.g. FMCG"></div>
        <div><label class="field-label">City</label><input class="field-input" name="city" required placeholder="e.g. Kozhikode, India"></div>
      </div>
      <div><label class="field-label">Services</label><div class="check-row">${SERVICE_DEPARTMENTS.map(d=>`<label class="check-chip"><input type="checkbox" name="services" value="${esc(d)}">${esc(d)}</label>`).join('')}</div></div>
      <div class="field-row">
        <div><label class="field-label">Account Manager</label><select class="field-input" name="accountManager">${assignableEmployees().map(e=>`<option>${esc(e.name)}</option>`).join('')}</select></div>
        <div><label class="field-label">Sales Person</label><select class="field-input" name="salesPerson">${salesTeamOptions()}</select></div>
      </div>
      <div><label class="field-label">Billing</label><select class="field-input" name="billingType"><option value="Prepaid">Prepaid — amount agreed up front</option><option value="Postpaid">Postpaid — amount finalized once work is complete</option></select></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Add client</button></div></div>
    </form>`);
  document.getElementById("f-add-client").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      await apiJson("/api/crm/clients", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({
        name:f.get("name"), industry:f.get("industry"), city:f.get("city"), services:f.getAll("services"),
        accountManager:f.get("accountManager"), salesPerson:f.get("salesPerson"), billingType:TITLECASE_TO_API(f.get("billingType")),
      })});
      await loadClients();
      toast("Client added"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't add client"); }
  });
}
function openAddLead(){
  showModal(`
    <div class="modal-head"><h3>New lead</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-add-lead"><div class="modal-body">
      <div><label class="field-label">Name / business</label><input class="field-input" name="name" required placeholder="e.g. Coastal Spice Exports"></div>
      <div class="field-row">
        <div><label class="field-label">Phone</label><input class="field-input" name="phone" required placeholder="9847xxxxxx"></div>
        <div><label class="field-label">Email</label><input class="field-input" type="email" name="email" required></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">Source</label><select class="field-input" name="source">${LEAD_SOURCES.map(s=>`<option>${s}</option>`).join('')}</select></div>
        <div><label class="field-label">Service Interested</label><select class="field-input" name="serviceInterested">${SERVICE_DEPARTMENTS.map(d=>`<option>${esc(d)}</option>`).join('')}</select></div>
      </div>
      <div><label class="field-label">Lead Owner</label><select class="field-input" name="leadOwner"><option value="">— Open, unassigned —</option>${salesTeamOptions()}</select><div class="subtext">Leave as Open for organic website/Instagram/WhatsApp sign-ups — they'll sit in the Open leads queue until a Sales rep claims one.</div></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Add lead</button></div></div>
    </form>`);
  document.getElementById("f-add-lead").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      await apiJson("/api/crm/leads", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ name:f.get("name"), phone:f.get("phone"), email:f.get("email"), source:f.get("source"), serviceInterested:f.get("serviceInterested"), leadOwner:f.get("leadOwner")||undefined }) });
      await loadLeads();
      toast(f.get("leadOwner") ? "Lead added" : "Lead added as open"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't add lead"); }
  });
}
function openEditLead(id){
  const l = marketingLeads.find(x=>x.id===id);
  showModal(`
    <div class="modal-head"><h3>Edit lead</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-edit-lead"><div class="modal-body">
      <div><label class="field-label">Name / business</label><input class="field-input" name="name" required value="${esc(l.name)}"></div>
      <div class="field-row">
        <div><label class="field-label">Phone</label><input class="field-input" name="phone" required value="${esc(l.phone)}"></div>
        <div><label class="field-label">Email</label><input class="field-input" type="email" name="email" required value="${esc(l.email)}"></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">Source</label><select class="field-input" name="source">${LEAD_SOURCES.map(s=>`<option ${s===l.source?'selected':''}>${s}</option>`).join('')}</select></div>
        <div><label class="field-label">Service Interested</label><select class="field-input" name="serviceInterested">${SERVICE_DEPARTMENTS.map(d=>`<option ${d===l.serviceInterested?'selected':''}>${esc(d)}</option>`).join('')}</select></div>
      </div>
      <div><label class="field-label">Lead Owner</label><select class="field-input" name="leadOwner"><option value="" ${!l.leadOwner?'selected':''}>— Open, unassigned —</option>${assignableEmployees().filter(e=>e.dept==='Sales').map(e=>`<option ${e.name===l.leadOwner?'selected':''}>${esc(e.name)}</option>`).join('')}</select></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save changes</button></div></div>
    </form>`);
  document.getElementById("f-edit-lead").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      await apiJson(`/api/crm/leads/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ name:f.get("name"), phone:f.get("phone"), email:f.get("email"), source:f.get("source"), serviceInterested:f.get("serviceInterested"), leadOwner:f.get("leadOwner")||null }) });
      await loadLeads();
      toast("Lead updated"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't update lead"); }
  });
}

/* ===================== CLIENTS OVERVIEW ===================== */
function clientsOverview(){
  const activeClients = clients.filter(c=>c.status==="Active").length;
  const openTasks = clientTasks.filter(t=>t.status!=="Done");
  const overdueTasks = clientTasks.filter(t=>t.status!=="Done" && t.due && t.due<TODAY);
  const doneTasks = clientTasks.filter(t=>t.status==="Done").length;
  const deptCounts = SERVICE_DEPARTMENTS.map(d=>({d,n:clients.filter(c=>c.status==="Active" && c.services.includes(d)).length})).filter(x=>x.n>0).sort((a,b)=>b.n-a.n);
  const maxDept = Math.max(...deptCounts.map(x=>x.n),1);
  return `
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-label">Active Clients</div><div class="kpi-value mono">${activeClients}</div></div>
    <div class="kpi-card"><div class="kpi-label">Open Tasks</div><div class="kpi-value mono">${openTasks.length}</div></div>
    <div class="kpi-card"><div class="kpi-label">Overdue Tasks</div><div class="kpi-value mono ${overdueTasks.length?'neg':''}">${overdueTasks.length}</div></div>
    <div class="kpi-card hero"><div class="kpi-label">Completed Tasks</div><div class="kpi-value mono">${doneTasks}</div><div class="kpi-sub">all-time, this dataset</div></div>
  </div>
  <div class="grid-2">
    <div class="panel">
      <div class="panel-head"><h3>Active clients by service</h3></div>
      <div class="panel-body">${deptCounts.length?`<div class="barchart">${deptCounts.map(x=>`<div class="bar-row"><div class="bar-label">${esc(x.d)}</div><div class="bar-track"><div class="bar-fill" style="width:${(x.n/maxDept)*100}%"></div></div><div class="bar-val">${x.n}</div></div>`).join("")}</div>`:'<div class="empty">Nothing active.</div>'}</div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Overdue tasks</h3></div>
      <div class="panel-body">${overdueTasks.length ? overdueTasks.map(t=>`<div class="feed-item row-click" onclick="openClientDetail('${t.clientId}')"><div class="feed-dot" style="background:var(--neg);"></div><div><div class="feed-text"><strong>${esc(t.title)}</strong></div><div class="feed-time">${clientById(t.clientId).name} · ${esc(t.assignedTo)} · due ${fmtDateShort(t.due)}</div></div></div>`).join("") : '<div class="empty">Nothing overdue.</div>'}</div>
    </div>
  </div>`;
}
/* ===================== CLIENT WORKFLOW BOARD ===================== */
const TASK_STAGES = ["To Do","In Progress","Review","Done"];
function taskCardHTML(t, showClient){
  const overdue = t.status!=='Done' && t.due && t.due<TODAY;
  const attachments = t.attachments || [];
  const dueLabel = t.status==='Done'
    ? `<span class="due published-on"><svg class="icon" style="width:10px;height:10px;display:inline;vertical-align:-1px"><use href="#i-check"/></svg> ${fmtDateShort(t.due)}</span>`
    : `<span class="due ${overdue?'overdue':''}">${overdue?'overdue · ':''}${fmtDateShort(t.due)}</span>`;
  const stageOptions = TASK_STAGES.map(s=>`<option value="${s}" ${s===t.status?'selected':''}>${s}</option>`).join('');
  const clientTag = showClient ? `<span class="tag type">${esc(clientById(t.clientId).name)}</span>` : '';
  return `
    <div class="card ${t.status==='Done'?'published':''}" draggable="true" data-id="${t.id}" ondragstart="onTaskDragStart(event,'${t.id}')">
      <div class="card-title">${esc(t.title)}</div>
      ${(clientTag || t.revisions>0 || attachments.length>0)?`<div class="card-meta">${clientTag}${t.revisions>0?`<span class="tag type">${t.revisions} revision${t.revisions>1?'s':''}</span>`:''}${attachments.length>0?`<span class="tag"><svg class="icon" style="width:10px;height:10px"><use href="#i-paperclip"/></svg>${attachments.length}</span>`:''}</div>`:''}
      <div class="card-foot"><span class="assignee"><span class="mini-avatar sm">${initials(t.assignedTo)}</span>${esc(t.assignedTo)}</span>${dueLabel}</div>
      <div class="card-move">
        <select onchange="moveTask('${t.id}', this.value)">${stageOptions}</select>
        <input type="file" id="task-file-${t.id}" style="display:none" multiple onchange="handleTaskFileSelect(event,'${t.id}')">
        <button type="button" class="card-edit" title="Attach file" onclick="document.getElementById('task-file-${t.id}').click()"><svg class="icon" style="width:12px;height:12px"><use href="#i-paperclip"/></svg></button>
        <button type="button" class="card-edit" title="Edit task" onclick="openEditTask('${t.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg></button>
      </div>
    </div>`;
}
// A task archived 3+ days after completion (see isTaskArchived) drops off the live board — it's
// still there, just reachable via the "Archive" button instead of taking up space in the Done column.
function renderClientTaskBoard(clientId){
  const board = document.getElementById('client-task-board');
  if(!board) return;
  const boardFilter = clientTaskBoardMonthFilter[clientId] || "All";
  const tasks = tasksOf(clientId).filter(t=>!isTaskArchived(t)).filter(t=>matchesDateFilter(t.due, boardFilter));
  board.innerHTML = TASK_STAGES.map(stage=>{
    const inStage = tasks.filter(t=>t.status===stage);
    return `<div class="col" data-stage="${stage}" ondragover="onTaskDragOver(event)" ondrop="onTaskDrop(event,'${stage}','${clientId}')" ondragleave="onTaskDragLeave(event)">
      <div class="col-head"><span class="name">${stage}</span><span class="count">${inStage.length}</span></div>
      <div class="col-cards">${inStage.map(t=>taskCardHTML(t)).join('')}</div>
    </div>`;
  }).join('');
}
// Cross-client board for a signed-in Staff member's own tasks ("My Tasks" under My Workspace) —
// same stages/drag-drop machinery as a client's board, just sourced from clientTasks filtered to
// this person and rendered into a different container so both boards can coexist across views.
function renderMyTaskBoard(){
  const board = document.getElementById('my-task-board');
  if(!board || !currentUser) return;
  const tasks = clientTasks.filter(t=>t.assignedTo===currentUser.name && !isTaskArchived(t));
  board.innerHTML = TASK_STAGES.map(stage=>{
    const inStage = tasks.filter(t=>t.status===stage);
    return `<div class="col" data-stage="${stage}" ondragover="onTaskDragOver(event)" ondrop="onTaskDrop(event,'${stage}','')" ondragleave="onTaskDragLeave(event)">
      <div class="col-head"><span class="name">${stage}</span><span class="count">${inStage.length}</span></div>
      <div class="col-cards">${inStage.map(t=>taskCardHTML(t, true)).join('')}</div>
    </div>`;
  }).join('');
}
// Read-only list of a client's (or, with no clientId, the signed-in Staff member's own) completed
// tasks that have aged into the archive — opened from the "Archive" button next to Workflow / My Tasks.
function openTaskArchive(clientId){
  const scopeTasks = clientId ? tasksOf(clientId) : clientTasks.filter(t=>currentUser && t.assignedTo===currentUser.name);
  const list = scopeTasks.filter(isTaskArchived).sort((a,b)=>(b.doneDate||'').localeCompare(a.doneDate||''));
  showModal(`
    <div class="modal-head"><h3>Completed tasks archive</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      ${list.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Task</th>${clientId?'':'<th>Client</th>'}<th>Assignee</th><th>Completed</th></tr></thead>
        <tbody>${list.map(t=>`<tr><td style="font-weight:700;">${esc(t.title)}</td>${clientId?'':`<td class="muted">${esc(clientById(t.clientId).name)}</td>`}<td class="muted">${esc(t.assignedTo)}</td><td class="muted">${fmtDateShort(t.doneDate)}</td></tr>`).join("")}</tbody>
      </table></div>` : `<div class="empty">Nothing archived yet — completed tasks move here 3 days after they're marked Done.</div>`}
    </div>
    <div class="modal-foot"><div></div><button type="button" class="btn ghost" onclick="closeModal()">Close</button></div>`);
}
let taskDragId = null;
function onTaskDragStart(e,id){ taskDragId=id; e.dataTransfer.effectAllowed='move'; }
function onTaskDragOver(e){ e.preventDefault(); e.currentTarget.classList.add('drop-hover'); }
function onTaskDragLeave(e){ e.currentTarget.classList.remove('drop-hover'); }
function onTaskDrop(e, stage, clientId){ e.preventDefault(); e.currentTarget.classList.remove('drop-hover'); if(taskDragId!=null) moveTask(taskDragId, stage); taskDragId=null; }
// Re-renders whichever board is currently on screen — a client's own task board, or the cross-client
// "My Tasks" board — since a moved task could belong to either depending on which view is open.
// Stamps/clears doneDate as a task enters or leaves Done — that stamp is what the 3-day archive clock
// (isTaskArchived) counts from.
async function moveTask(taskId, stage){
  const t = clientTasks.find(x=>x.id===taskId); if(!t) return;
  const prevStatus = t.status, prevDone = t.doneDate;
  t.status = stage; t.doneDate = stage==='Done' ? TODAY : null; // optimistic
  if(document.getElementById('my-task-board')) renderMyTaskBoard();
  else renderClientTaskBoard(t.clientId);
  renderNav(); // the "My Tasks" sidebar badge counts by status — refresh it alongside the board
  try{
    await apiJson(`/api/crm/tasks/${taskId}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ status: TASK_STATUS_TO_API[stage] }) });
  }catch(err){
    t.status = prevStatus; t.doneDate = prevDone;
    toast(err.message || "Couldn't move task");
    if(document.getElementById('my-task-board')) renderMyTaskBoard();
    else renderClientTaskBoard(t.clientId);
    renderNav();
  }
}
function openAddTask(clientId){
  showModal(`
    <div class="modal-head"><h3>Add task</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-add-task"><div class="modal-body">
      <div><label class="field-label">Task</label><input class="field-input" name="title" required placeholder="e.g. First draft — homepage copy"></div>
      <div class="field-row">
        <div><label class="field-label">Assignee</label><select class="field-input" name="assignedTo">${assignableEmployees().map(e=>`<option>${esc(e.name)}</option>`).join('')}</select></div>
        <div><label class="field-label">Due</label><input class="field-input" type="date" name="due" value="${TODAY}" required></div>
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Add task</button></div></div>
    </form>`);
  document.getElementById("f-add-task").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      await apiJson(`/api/crm/clients/${clientId}/tasks`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ title:f.get("title"), assignedTo:f.get("assignedTo"), dueAt:f.get("due") }) });
      await loadTasks();
      toast("Task added"); closeModal(); openClientDetail(clientId);
    }catch(err){ toast(err.message || "Couldn't add task"); }
  });
}
function fmtFileSize(bytes){
  if(bytes==null) return '';
  if(bytes < 1024) return bytes+' B';
  if(bytes < 1024*1024) return (bytes/1024).toFixed(1)+' KB';
  return (bytes/(1024*1024)).toFixed(1)+' MB';
}
function taskAttachmentsListHTML(t){
  const atts = t.attachments || [];
  if(!atts.length) return `<div class="empty" style="padding:8px 0;">No files attached.</div>`;
  return `<div style="display:flex;flex-direction:column;gap:6px;">${atts.map((a,i)=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 9px;border:1px solid var(--line);border-radius:7px;font-size:12.5px;">
    <span style="display:flex;align-items:center;gap:6px;overflow:hidden;"><svg class="icon" style="width:12px;height:12px;flex:none;color:var(--ink-faint);"><use href="#i-paperclip"/></svg><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.name)}</span><span class="faint">${fmtFileSize(a.size)}</span></span>
    <button type="button" class="btn btn-sm ghost" onclick="removeTaskAttachment('${t.id}',${i})"><svg class="icon" style="width:11px;height:11px"><use href="#i-x"/></svg></button>
  </div>`).join('')}</div>`;
}
// Files are captured client-side only (no backend in this mockup) — picking a file just records its
// name/size against the task so the UI reflects "attached", the same way every other record here is
// client-side seed/session data. Shared by both the card's own paperclip button and the Edit task modal.
async function handleTaskFileSelect(e, taskId){
  const t = clientTasks.find(x=>x.id===taskId);
  if(!t) return;
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  try{
    for(const file of files){
      const { attachment } = await apiJson(`/api/crm/tasks/${taskId}/attachments`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ name:file.name, size:file.size }) });
      t.attachments = t.attachments || [];
      t.attachments.push({id:attachment.id, name:attachment.name, size:attachment.size, addedDate:isoDate(attachment.addedAt)});
    }
    const listEl = document.getElementById('task-attachments-list');
    if(listEl) listEl.innerHTML = taskAttachmentsListHTML(t);
    renderClientTaskBoard(t.clientId);
    if(files.length) toast(files.length>1 ? files.length+" files attached" : "File attached");
  }catch(err){ toast(err.message || "Couldn't attach file"); }
}
async function removeTaskAttachment(taskId, idx){
  const t = clientTasks.find(x=>x.id===taskId);
  if(!t || !t.attachments || !t.attachments[idx]) return;
  const attachmentId = t.attachments[idx].id;
  try{
    await Auth.apiFetch(`/api/crm/tasks/${taskId}/attachments/${attachmentId}`, { method:"DELETE" });
    t.attachments.splice(idx,1);
    const listEl = document.getElementById('task-attachments-list');
    if(listEl) listEl.innerHTML = taskAttachmentsListHTML(t);
    renderClientTaskBoard(t.clientId);
  }catch(err){ toast("Couldn't remove attachment"); }
}
function openEditTask(id){
  const t = clientTasks.find(x=>x.id===id);
  if(!t) return;
  t.attachments = t.attachments || [];
  showModal(`
    <div class="modal-head"><h3>Edit task</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-edit-task"><div class="modal-body">
      <div><label class="field-label">Task</label><input class="field-input" name="title" required value="${esc(t.title)}"></div>
      <div class="field-row">
        <div><label class="field-label">Assignee</label><select class="field-input" name="assignedTo">${assignableEmployees().map(e=>`<option ${e.name===t.assignedTo?'selected':''}>${esc(e.name)}</option>`).join('')}</select></div>
        <div><label class="field-label">Due</label><input class="field-input" type="date" name="due" value="${t.due}" required></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">Stage</label><select class="field-input" name="status">${TASK_STAGES.map(s=>`<option ${s===t.status?'selected':''}>${s}</option>`).join('')}</select></div>
        <div><label class="field-label">Revisions</label><input class="field-input" type="number" name="revisions" min="0" value="${t.revisions||0}"></div>
      </div>
      <div>
        <label class="field-label">Attachments</label>
        <div id="task-attachments-list">${taskAttachmentsListHTML(t)}</div>
        <input type="file" id="task-edit-file-input" style="display:none" multiple onchange="handleTaskFileSelect(event,'${t.id}')">
        <button type="button" class="btn btn-sm ghost" style="margin-top:8px;" onclick="document.getElementById('task-edit-file-input').click()"><svg class="icon" style="width:12px;height:12px"><use href="#i-paperclip"/></svg>Attach file</button>
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save changes</button></div></div>
    </form>`);
  document.getElementById("f-edit-task").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      await apiJson(`/api/crm/tasks/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ title:f.get("title"), assignedTo:f.get("assignedTo"), dueAt:f.get("due"), status:TASK_STATUS_TO_API[f.get("status")], revisions:Number(f.get("revisions"))||0 }) });
      await loadTasks();
      toast("Task updated"); closeModal(); renderClientTaskBoard(t.clientId);
    }catch(err){ toast(err.message || "Couldn't update task"); }
  });
}

/* ===================== ACCOUNTS ===================== */
// A department's monthly cost of a person is what HR has actually put through payroll for that
// month if it's been added yet, falling back to their master salary otherwise (see hrPayroll()).
// Department-wise profitability — see the real deptProfitability() in the
// data layer above, which now calls the server (the computation needs
// cross-module payroll data only the server can read directly).
const OVERHEAD_DEPTS = ["Administrative","Sales"];
function acctProfitability(){
  const month = payroll.selectedMonth;
  const d = deptProfitability(month);
  const totals = d.rows.reduce((s,r)=>({grossRevenue:s.grossRevenue+r.grossRevenue, commission:s.commission+r.commission, revenue:s.revenue+r.revenue, directPayroll:s.directPayroll+r.directPayroll, directExpense:s.directExpense+r.directExpense, overheadShare:s.overheadShare+r.overheadShare, totalCost:s.totalCost+r.totalCost, profit:s.profit+r.profit}), {grossRevenue:0,commission:0,revenue:0,directPayroll:0,directExpense:0,overheadShare:0,totalCost:0,profit:0});
  const sorted = d.rows.slice().sort((a,b)=>b.profit-a.profit);
  const totalMargin = totals.revenue ? (totals.profit/totals.revenue*100) : null;
  return `
  <div class="toolbar">
    <select class="select-sm" onchange="setPayrollMonth(this.value)">${Object.keys(payroll.history).sort().reverse().map(m=>`<option value="${m}" ${m===month?'selected':''}>${MONTH_LABEL[m]}</option>`).join("")}</select>
    <span class="faint" style="font-size:12px;">Revenue: Finance-approved payments received in ${MONTH_LABEL[month]}, net of sales commission · Costs: ${MONTH_LABEL[month]}</span>
  </div>
  <div class="banner muted">
    <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
    <div><b>How the shared overhead is split.</b> Administrative &amp; Sales payroll (${inr(d.overheadPayroll)}, ${d.overheadHeadcount} people) + Rent (${inr(d.rent)}) + untagged/shared expenses (${inr(d.sharedExpenses)}) = ${inr(d.overheadPool)} pooled overhead this month, divided by ${d.totalHeadcount} client-facing heads = ${inr(Math.round(d.perHeadOverhead))} per person. Each department absorbs its own headcount × that rate — tag an expense to a department in Expenses to make it a direct cost instead. Revenue here is actual money in the door: only invoice payments Finance has approved (Accounts → Payment Receipts → Approve &amp; confirm), counted the month they were received — not the month invoiced — split across each invoice's department-tagged line items in proportion to their share of the bill, minus the ${Math.round(SALES_COMMISSION_RATE*100)}% sales commission it earns, since Sales draws no salary of its own. An invoice still awaiting approval contributes nothing yet — while costs are a full month's payroll.</div>
  </div>
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-label">Total Revenue</div><div class="kpi-value mono" style="font-size:20px;">${inr(totals.revenue)}</div><div class="kpi-sub">${inr(totals.grossRevenue)} gross − ${inr(totals.commission)} commission</div></div>
    <div class="kpi-card"><div class="kpi-label">Direct Payroll</div><div class="kpi-value mono" style="font-size:20px;">${inr(totals.directPayroll)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Allocated Overhead</div><div class="kpi-value mono warn" style="font-size:20px;">${inr(totals.overheadShare)}</div></div>
    <div class="kpi-card hero"><div class="kpi-label">Net Profit</div><div class="kpi-value mono ${totals.profit>=0?'pos':'neg'}" style="font-size:20px;">${inr(totals.profit)}</div><div class="kpi-sub">${totalMargin===null?'—':totalMargin.toFixed(1)+'% margin'}</div></div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Department profitability</h3><div class="sub">${MONTH_LABEL[month]} costs · revenue shown net of ${Math.round(SALES_COMMISSION_RATE*100)}% sales commission · sorted by profit</div></div>
    <div class="table-wrap"><table class="data" style="min-width:920px;"><thead><tr><th>Department</th><th class="num">Headcount</th><th class="num">Revenue</th><th class="num">Direct Payroll</th><th class="num">Direct Expense</th><th class="num">Overhead Share</th><th class="num">Total Cost</th><th class="num">Profit</th><th class="num">Margin</th></tr></thead>
      <tbody>${sorted.map(r=>`<tr>
        <td style="font-weight:700;">${esc(r.dept)}</td>
        <td class="num mono">${r.headcount}</td>
        <td class="num mono">${inr(r.revenue)}${r.commission?`<div class="subtext" style="white-space:nowrap;">${inr(r.grossRevenue)} gross − ${inr(r.commission)} comm.</div>`:''}</td>
        <td class="num mono muted">${inr(r.directPayroll)}</td>
        <td class="num mono muted">${r.directExpense?inr(r.directExpense):'—'}</td>
        <td class="num mono muted">${inr(r.overheadShare)}</td>
        <td class="num mono">${inr(r.totalCost)}</td>
        <td class="num mono" style="font-weight:700;color:${r.profit>=0?'var(--pos)':'var(--neg)'};">${inr(r.profit)}</td>
        <td class="num mono" style="${r.margin===null?'':'color:'+(r.margin>=0?'var(--pos)':'var(--neg)')+';'}">${r.margin===null?'—':r.margin.toFixed(1)+'%'}</td>
      </tr>`).join("")}
      <tr class="total"><td>Total</td><td class="num mono">${d.totalHeadcount}</td><td class="num mono">${inr(totals.revenue)}<div class="subtext" style="white-space:nowrap;">${inr(totals.grossRevenue)} gross − ${inr(totals.commission)} comm.</div></td><td class="num mono">${inr(totals.directPayroll)}</td><td class="num mono">${totals.directExpense?inr(totals.directExpense):'—'}</td><td class="num mono">${inr(totals.overheadShare)}</td><td class="num mono">${inr(totals.totalCost)}</td><td class="num mono" style="color:${totals.profit>=0?'var(--pos)':'var(--neg)'};">${inr(totals.profit)}</td><td class="num mono">${totalMargin===null?'—':totalMargin.toFixed(1)+'%'}</td></tr></tbody>
    </table></div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Overhead pool breakdown</h3><div class="sub">What's going into the shared pool for ${MONTH_LABEL[month]}</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Component</th><th class="num">Amount</th></tr></thead>
      <tbody>
        <tr><td>Administrative &amp; Sales payroll (${d.overheadHeadcount} people)</td><td class="num mono">${inr(d.overheadPayroll)}</td></tr>
        <tr><td>Office rent</td><td class="num mono">${inr(d.rent)}</td></tr>
        <tr><td>Shared / untagged expenses</td><td class="num mono">${inr(d.sharedExpenses)}</td></tr>
        <tr class="total"><td>Total overhead pool</td><td class="num mono">${inr(d.overheadPool)}</td></tr>
      </tbody>
    </table></div>
  </div>`;
}
// Overview shows exactly what Department Profitability shows — that's the
// number that actually matters at a glance, more than a raw revenue/
// receivables/payables/expenses/cash snapshot.
function acctOverview(){
  return acctProfitability();
}
// ---- Delete confirmation (quotes/invoices/payables/expenses/bank accounts) ----
// Each kind maps to its own DELETE endpoint; the server is the real gatekeeper
// on whether a delete is actually allowed (e.g. blocked once a payment's been
// recorded against it — the payment ledger is append-only), this just gives a
// clear heads-up before asking.
function deleteWarningFor(kind, id){
  const fallback = "This permanently removes it from the records. This can't be undone.";
  if(kind==='client'){
    const c = clientById(id); if(!c) return {label:"this client", warning:fallback};
    const inv = invoices.filter(i=>i.clientId===id).length, qs = quotes.filter(x=>x.clientId===id).length, tasks = tasksOf(id).length;
    let w = `${esc(c.name)}.`;
    if(inv||qs) w += ` They have ${[inv&&inv+' invoice'+(inv===1?'':'s'), qs&&qs+' quote'+(qs===1?'':'s')].filter(Boolean).join(' and ')} — the payment ledger is append-only, so this will be refused. Set their status to Churned instead (Edit).`;
    else w += (tasks?` Their ${tasks} workflow task${tasks===1?'':'s'} will be deleted too.`:'')+" This can't be undone.";
    return {label:"this client", warning:w};
  }
  if(kind==='lead'){
    const l = marketingLeads.find(x=>x.id===id); if(!l) return {label:"this lead", warning:fallback};
    const qs = quotes.filter(x=>x.leadId===id).length;
    const w = `${esc(l.name)}.` + (qs ? ` ${qs} quote${qs===1?' is':'s are'} raised against them, so this will be refused — delete those quotes first, or mark the lead Lost instead.` : " This can't be undone.");
    return {label:"this lead", warning:w};
  }
  if(kind==='quote'){
    const q = quotes.find(x=>x.id===id); if(!q) return {label:"this quote", warning:fallback};
    const party = quoteParty(q);
    let w = `"${esc(q.title)}" for ${esc(party.name)}.`;
    w += q.invoiceId ? ` It's already been invoiced (${esc(q.invoiceId)}) — the payment ledger is append-only, so this can't be deleted.` : (quotePendingAmount(q)>0 ? ` The ${inr(quotePendingAmount(q))} payment waiting on Finance is discarded with it.` : "") + " This can't be undone.";
    return {label:"this quote", warning:w};
  }
  if(kind==='invoice'){
    const inv = invoices.find(x=>x.id===id); if(!inv) return {label:"this invoice", warning:fallback};
    const blocked = (inv.payments||[]).length>0;
    let w = `${esc(inv.invoiceNo)} for ${esc(clientById(inv.clientId).name)}.`;
    w += blocked ? " It has recorded payments — the payment ledger is append-only, so this can't be deleted." : " This can't be undone.";
    return {label:"this invoice", warning:w};
  }
  if(kind==='payable'){
    const p = payables.find(x=>x.id===id); if(!p) return {label:"this payable", warning:fallback};
    const blocked = (p.payments||[]).length>0;
    let w = `${esc(p.category)} — ${esc(p.payee)}.`;
    if(p.category==='Commission') w += " This is a sales commission entry — deleting it removes that person's earned commission record.";
    w += blocked ? " It has recorded payments — the payment ledger is append-only, so this can't be deleted." : " This can't be undone.";
    return {label:"this payable", warning:w};
  }
  if(kind==='expense'){
    const e = expenses.find(x=>x.id===id); if(!e) return {label:"this expense", warning:fallback};
    return {label:"this expense", warning:`${esc(e.category)} — ${esc(e.description)}, ${inr(e.amount)}. Its bank ledger entry is removed too.`};
  }
  if(kind==='bank'){
    const b = bankAccounts.find(x=>x.id===id); if(!b) return {label:"this bank account", warning:fallback};
    return {label:"this bank account", warning:`${esc(b.name)} (${esc(b.bank)}), current balance ${inr(bankAccountBalance(id))}. Only allowed while it has zero ledger transactions — if anything's ever been posted to it, this will be refused.`};
  }
  return {label:"this record", warning:fallback};
}
function openConfirmDelete(kind, id){
  const {label, warning} = deleteWarningFor(kind, id);
  showModal(`
    <div class="modal-head"><h3>Delete ${esc(label)}?</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-archive"/></svg><div>${warning}</div></div>
    </div>
    <div class="modal-foot"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="button" class="btn danger" onclick="performDelete('${kind}','${esc(id)}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg>Delete</button></div>`);
}
async function performDelete(kind, id){
  const ENDPOINTS = {
    lead: { url:`/api/crm/leads/${id}`, reload: loadLeads, label:"Lead" },
    client: { url:`/api/crm/clients/${id}`, reload: async ()=>{ nav.detail=null; await Promise.all([loadClients(), loadTasks()]); }, label:"Client" },
    quote: { url:`/api/crm/quotes/${id}`, reload: loadQuotes, label:"Quote" },
    // Deleting an unpaid invoice puts the quote that produced it back to Sent, so refresh quotes as well.
    invoice: { url:`/api/finance/invoices/${id}`, reload: async ()=>{ await loadInvoices(); if(canLoadQuotes()) await loadQuotes(); }, label:"Invoice" },
    payable: { url:`/api/finance/payables/${id}`, reload: loadPayables, label:"Payable" },
    expense: { url:`/api/finance/expenses/${id}`, reload: loadExpenses, label:"Expense" },
    bank: { url:`/api/finance/bank-accounts/${id}`, reload: loadBankAccounts, label:"Bank account" },
  };
  const ep = ENDPOINTS[kind];
  if(!ep) return;
  try{
    await apiJson(ep.url, { method:"DELETE" });
    await ep.reload();
    toast(ep.label+" deleted"); closeModal(); render();
  }catch(err){ toast(err.message || "Couldn't delete"); }
}
// Payment Receipts: discards a not-yet-approved pending payment Sales pushed —
// for a duplicate or mistaken submission, not a real payment simply not yet
// confirmed. The server refuses this once the entry's been approved.
function openConfirmDeleteReceipt(source, parentId, pendingId){
  const parent = source==='quote' ? quotes.find(x=>x.id===parentId) : invoices.find(x=>x.id===parentId);
  const payment = parent && (source==='quote' ? (parent.payments||[]) : (parent.pendingPayments||[])).find(p=>p.id===pendingId);
  const desc = payment ? `${inr(payment.amount)} pushed ${source==='quote'?'against quote '+esc(parentId):'against invoice '+esc(parentId)}` : "this payment entry";
  showModal(`
    <div class="modal-head"><h3>Delete this payment entry?</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-archive"/></svg><div>${desc} — nothing has been posted to the ledger yet, so this just discards the entry Sales pushed. Use it for a duplicate or mistaken submission, not a real payment you simply haven't confirmed.</div></div>
    </div>
    <div class="modal-foot"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="button" class="btn danger" onclick="performDeleteReceipt('${source}','${esc(parentId)}','${esc(pendingId)}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg>Delete</button></div>`);
}
async function performDeleteReceipt(source, parentId, pendingId){
  try{
    if(source==='quote'){
      await apiJson(`/api/crm/quotes/${parentId}/pending-payments/${pendingId}`, { method:"DELETE" });
      await loadQuotes();
    } else {
      await apiJson(`/api/finance/invoices/${parentId}/pending-payments/${pendingId}`, { method:"DELETE" });
      await loadInvoices();
    }
    toast("Payment entry deleted"); closeModal(); render();
  }catch(err){ toast(err.message || "Couldn't delete payment entry"); }
}
// Every payment Sales has pushed and Finance hasn't confirmed yet — whether it's against a quote
// (before it's become an invoice) or logged against an already-raised invoice. Both used to be
// listed inline on their own Quotes/Invoices tabs, which meant Finance had two separate queues to
// check; this rolls them into one single "Payment Receipts" queue instead.
function pendingSalesPayments(){
  const rows = [];
  invoices.forEach(inv=>{ (inv.pendingPayments||[]).forEach((p,idx)=>{ if(!p.approved) rows.push({source:'invoice', inv, p, idx}); }); });
  quotes.forEach(q=>{ (q.payments||[]).forEach((p,idx)=>{ if(!p.approved) rows.push({source:'quote', q, p, idx}); }); });
  return rows.sort((a,b)=>(b.p.date||'').localeCompare(a.p.date||''));
}
// Payment Receipts has two views: Pending (what Sales pushed and Finance hasn't confirmed yet — the
// queue above) and Approved (history of every confirmed payment, so a row doesn't just vanish once
// approved). Approved comes from its own endpoint, which joins pusher / approver / bank / commission
// server-side — see server/src/controllers/finance/paymentReceipts.controller.ts.
let receiptsTab = "pending";
let approvedReceipts = [], approvedReceiptsTotal = 0, approvedReceiptsLoaded = false;
async function loadApprovedReceipts(){
  const d = await apiJson("/api/finance/payment-receipts/approved?limit=200");
  approvedReceipts = d.receipts; approvedReceiptsTotal = d.total; approvedReceiptsLoaded = true;
}
function setReceiptsTab(t){
  receiptsTab = t; render();
  if(t==='approved') loadApprovedReceipts().then(()=>{ if(receiptsTab==='approved') render(); }).catch(err=>toast(err.message || "Couldn't load approved payments"));
}
const fmtDateTime = iso => iso ? new Date(iso).toLocaleString("en-IN",{day:"numeric",month:"short",year:"numeric",hour:"numeric",minute:"2-digit"}) : "—";
function acctApprovedReceipts(){
  const rows = approvedReceipts;
  const dash = '<span class="faint">—</span>';
  return `
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Every payment Finance has confirmed, newest first — pushed by Sales (against a quote or an invoice) or recorded straight on the invoice by Finance (<b>Direct</b>, no Sales person and so no commission). The commission shown is what that payment generated, linked to it directly, so editing or splitting a commission in Accounts &gt; Commissions updates it here too.</div></div>
  <div class="panel">
    <div class="panel-head"><h3>Approved payments</h3><div class="sub">${approvedReceiptsLoaded?`${approvedReceiptsTotal} confirmed payment${approvedReceiptsTotal===1?'':'s'}${approvedReceiptsTotal>rows.length?' · showing the latest '+rows.length:''}`:'Loading…'}</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Source</th><th>For</th><th class="num">Amount</th><th>Pushed by</th><th>Approved by</th><th>Bank account</th><th>Commission</th><th></th></tr></thead>
      <tbody>${rows.length?rows.map(r=>`<tr>
        <td class="mono">${esc(r.invoiceNo)}<div class="subtext">${r.source==='Direct'?pill('Direct','neutral'):r.source==='Quote'?'Quote '+esc(r.quoteCode||''):'Invoice'}</div></td>
        <td class="muted">${esc(r.clientName)}</td>
        <td class="num mono">${inr(r.amount)}<div class="subtext" style="white-space:nowrap;">paid ${fmtDateShort(isoDate(r.paidDate))}</div></td>
        <td class="muted">${r.pushedBy?esc(r.pushedBy):dash}</td>
        <td class="muted">${r.approvedBy?esc(r.approvedBy):dash}<div class="subtext" style="white-space:nowrap;">${fmtDateTime(r.approvedAt)}</div></td>
        <td class="muted">${esc(r.bankAccount.name)}</td>
        <td>${r.commissions.length?r.commissions.map(c=>`<div class="mono">${inr(c.amount)} <span class="faint" style="font-family:inherit;">→ ${esc(c.salesPerson||'—')}</span></div>`).join(''):dash}</td>
        <td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm ghost" onclick="openEditApprovedReceipt('${r.paymentId}')" title="Edit payment"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button><button class="btn btn-sm ghost" onclick="openReverseApprovedReceipt('${r.paymentId}')" title="Delete payment"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button></div></td>
      </tr>`).join(""):`<tr><td colspan="8"><div class="empty">${approvedReceiptsLoaded?'No payments confirmed yet.':'Loading…'}</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
// Editing / deleting a confirmed payment goes through the server, which keeps the bank ledger, invoice
// balance, revenue and commission in sync (or refuses with a reason and changes nothing) — see
// updateApprovedReceipt / deleteApprovedReceipt in paymentReceipts.controller.ts.
async function reloadAfterReceiptChange(){
  await Promise.all([loadApprovedReceipts(), loadInvoices(), loadBankAccounts(), loadPayables(), refreshFinanceReports(), canLoadQuotes()?loadQuotes():null]);
}
function openEditApprovedReceipt(paymentId){
  const r = approvedReceipts.find(x=>x.paymentId===paymentId); if(!r) return;
  const rate = Math.round(SALES_COMMISSION_RATE*100);
  showModal(`
    <div class="modal-head"><h3>Edit payment — ${esc(r.invoiceNo)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-edit-receipt"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${esc(r.clientName)} · confirmed ${fmtDateTime(r.approvedAt)}. Saving updates the bank-ledger entry, the invoice balance and revenue to match.${r.commissions.length?` Changing the <b>amount</b> also recalculates the ${rate}% commission (${r.commissions.map(c=>inr(c.amount)+' → '+esc(c.salesPerson||'—')).join(', ')}) — unless it was edited, split or paid out since, in which case the change is refused. Date, bank account and note never touch it.`:''}</div></div>
      <div class="field-row">
        <div><label class="field-label">Amount (₹)</label><input class="field-input" type="number" name="amount" min="1" step="1" required value="${r.amount}"></div>
        <div><label class="field-label">Payment date</label><input class="field-input" type="date" name="paidDate" required value="${isoDate(r.paidDate)}"></div>
      </div>
      <div><label class="field-label">Credited to account</label><select class="field-input" name="accountId">${bankAccounts.map(b=>`<option value="${b.id}" ${b.id===r.bankAccount.id?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
      <div><label class="field-label">Note</label><input class="field-input" name="note" value="${esc(r.note||'')}"></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save changes</button></div></div>
    </form>`);
  document.getElementById("f-edit-receipt").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      await apiJson(`/api/finance/payment-receipts/approved/${paymentId}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({
        amount:Number(f.get("amount")), paidDate:f.get("paidDate"), accountId:f.get("accountId"), note:f.get("note").trim()||null,
      })});
      await reloadAfterReceiptChange();
      toast("Payment updated"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't update payment"); }
  });
}
function openReverseApprovedReceipt(paymentId){
  const r = approvedReceipts.find(x=>x.paymentId===paymentId); if(!r) return;
  const back = r.source==='Direct' ? "It was recorded directly by Finance, so it is simply removed." : "It goes back to the <b>Pending</b> tab exactly as Sales pushed it, where you can approve it again or discard it.";
  showModal(`
    <div class="modal-head"><h3>Delete this payment?</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-archive"/></svg><div><b>${inr(r.amount)}</b> on ${esc(r.invoiceNo)} (${esc(r.clientName)}) is reversed: the credit to <b>${esc(r.bankAccount.name)}</b> is removed from the bank ledger, ${r.commissions.length?`the ${r.commissions.map(c=>inr(c.amount)+' commission for '+esc(c.salesPerson||'—')).join(' and ')} is removed, `:''}the invoice balance goes back up and revenue drops. ${back} Refused if its commission has already been paid out or a sales bonus depends on it.</div></div>
    </div>
    <div class="modal-foot"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="button" class="btn danger" onclick="performReverseApprovedReceipt('${paymentId}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg>Delete payment</button></div>`);
}
async function performReverseApprovedReceipt(paymentId){
  const r = approvedReceipts.find(x=>x.paymentId===paymentId);
  try{
    await apiJson(`/api/finance/payment-receipts/approved/${paymentId}`, { method:"DELETE" });
    await reloadAfterReceiptChange();
    toast(r && r.source!=='Direct' ? "Payment reversed — back in Pending" : "Payment deleted"); closeModal(); render();
  }catch(err){ toast(err.message || "Couldn't delete payment"); }
}
function acctPaymentReceipts(){
  const pending = pendingSalesPayments().length;
  const tab = (id, label, n) => `<button class="chip ${receiptsTab===id?'active':''}" onclick="setReceiptsTab('${id}')">${label}${n?' · '+n:''}</button>`;
  return `<div class="filter-group" style="margin-bottom:14px;">${tab('pending','Pending',pending)}${tab('approved','Approved',approvedReceiptsLoaded?approvedReceiptsTotal:0)}</div>`
    + (receiptsTab==='approved' ? acctApprovedReceipts() : acctPendingReceipts());
}
function acctPendingReceipts(){
  const rows = pendingSalesPayments();
  return `
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Sales pushes a payment here the moment a client pays — even a partial one — whether it's against a quote or an existing invoice. Confirm which account the money actually landed in before approving; that's what creates (or tops up) the invoice and posts it to the bank ledger. Approving a lead's first payment also turns them into a client automatically.</div></div>
  <div class="panel">
    <div class="panel-head"><h3>Payment Receipts</h3><div class="sub">${rows.length} payment${rows.length===1?'':'s'} pushed by Sales, awaiting confirmation</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Source</th><th>For</th><th class="num">This payment</th><th class="num">Total</th><th>Pushed by</th><th>Sales note</th><th></th></tr></thead>
      <tbody>${rows.length?rows.map(r=>{
        if(r.source==='quote'){
          const party = quoteParty(r.q);
          return `<tr><td class="mono">${esc(r.q.title)}<div class="subtext">Quote</div></td><td class="muted">${esc(party.name)}${party.kind==='lead'?' '+pill('Lead','blue'):''}</td><td class="num mono">${inr(r.p.amount)}</td><td class="num mono">${inr(quoteTotal(r.q))}</td><td class="muted">${esc(r.q.createdBy)}</td><td class="muted">${esc(r.p.note||'—')} · ${fmtDateShort(r.p.date)}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm primary" onclick="openApproveQuotePayment('${r.q.id}',${r.idx})"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Approve</button><button class="btn btn-sm ghost" onclick="openConfirmDeleteReceipt('quote','${r.q.id}','${r.p.id}')" title="Discard"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button></div></td></tr>`;
        }
        return `<tr><td class="mono">${esc(r.inv.invoiceNo)}<div class="subtext">Invoice</div></td><td class="muted">${esc(clientById(r.inv.clientId).name)}</td><td class="num mono">${inr(r.p.amount)}</td><td class="num mono">${inr(invoiceBalance(r.inv))}</td><td class="muted">${esc(r.p.salesPerson||'—')}</td><td class="muted">${esc(r.p.note||'—')} · ${fmtDateShort(r.p.date)}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm primary" onclick="openApproveInvoicePayment('${r.inv.id}',${r.idx})"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Approve</button><button class="btn btn-sm ghost" onclick="openConfirmDeleteReceipt('invoice','${r.inv.id}','${r.p.id}')" title="Discard"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button></div></td></tr>`;
      }).join(""):'<tr><td colspan="7"><div class="empty">Nothing waiting on Finance right now.</div></td></tr>'}</tbody>
    </table></div>
  </div>`;
}
function acctInvoices(){
  const totalReceivable = invoices.reduce((s,i)=>s+invoiceBalance(i),0);
  const overdueAmt = invoices.filter(i=>invoiceStatus(i)==="Overdue").reduce((s,i)=>s+invoiceBalance(i),0);
  // Shares invoicesMonthFilter with Marketing > Invoices — same "Today / month-wise / All time" filter either page sets carries to the other.
  const filtered = invoices.filter(i=>matchesDateFilter(i.issued, invoicesMonthFilter));
  return `
  <div class="toolbar"><div class="filter-group"><span class="filter-label">Show</span><select class="select-sm" onchange="setInvoicesMonthFilter(this.value)">${dateFilterOptions(invoices.map(i=>i.issued), invoicesMonthFilter)}</select></div><button class="btn primary" onclick="openAddInvoice()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New invoice</button></div>
  <div class="kpi-grid">
    <div class="kpi-card hero"><div class="kpi-label">Total Receivable</div><div class="kpi-value mono">${inr(totalReceivable)}</div><div class="kpi-sub">${inr(overdueAmt)} overdue</div></div>
    <div class="kpi-card"><div class="kpi-label">Total Invoiced</div><div class="kpi-value mono">${inr(invoices.reduce((s,i)=>s+invoiceTotal(i),0))}</div><div class="kpi-sub">${invoices.length} invoices, all time</div></div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Invoices</h3><div class="sub">${filtered.length} of ${invoices.length}${dateFilterSuffix(invoicesMonthFilter,'issued in')}</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Invoice</th><th>Client</th><th>Issued</th><th>Due</th><th class="num">Amount</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
      <tbody>${filtered.slice().sort((a,b)=>b.issued.localeCompare(a.issued)).map(i=>{ const st=invoiceStatus(i), bal=invoiceBalance(i); return `<tr><td class="mono">${i.invoiceNo}</td><td class="muted">${clientById(i.clientId).name}</td><td class="muted">${fmtDateShort(i.issued)}</td><td class="muted">${fmtDateShort(i.due)}</td><td class="num mono">${inr(invoiceTotal(i))}</td><td class="num mono">${bal>0?inr(bal):'<span class="faint">—</span>'}</td><td>${pill(st,invStatusKind(st))}</td><td><div style="display:flex;gap:6px;flex-wrap:wrap;">${bal>0?`<button class="btn btn-sm" onclick="openRecordInvoicePayment('${i.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Record payment</button>`:`<span class="faint" style="font-size:11.5px;">paid in full</span>`}<button class="btn btn-sm ghost" onclick="openEditInvoice('${i.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button><button class="btn btn-sm ghost" onclick="downloadInvoice('${i.id}')" title="Download invoice"><svg class="icon" style="width:12px;height:12px"><use href="#i-download"/></svg>Download</button>${(i.payments||[]).length?`<button class="btn btn-sm ghost" onclick="openInvoicePayments('${i.id}')" title="Payment receipts"><svg class="icon" style="width:12px;height:12px"><use href="#i-receipt"/></svg>Payments</button>`:`<button class="btn btn-sm ghost" onclick="openConfirmDelete('invoice','${i.id}')" title="Delete"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button>`}</div></td></tr>`; }).join("") || `<tr><td colspan="8"><div class="empty">No invoices${invoicesMonthFilter==='All'?'':' for this range'}.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
function acctPayables(){
  const filtered = payables.filter(p=>matchesDateFilter(p.due, payablesMonthFilter));
  const total = filtered.reduce((s,p)=>s+p.amount,0);
  const outstanding = filtered.reduce((s,p)=>s+payableBalance(p),0);
  return `
  <div class="toolbar"><div class="filter-group"><span class="filter-label">Show</span><select class="select-sm" onchange="setPayablesMonthFilter(this.value)">${dateFilterOptions(payables.map(p=>p.due), payablesMonthFilter)}</select></div><button class="btn primary" onclick="openAddPayable()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New payable</button></div>
  <div class="kpi-grid">
    <div class="kpi-card hero"><div class="kpi-label">Total Payable</div><div class="kpi-value mono warn">${inr(outstanding)}</div><div class="kpi-sub">${filtered.filter(p=>payableStatus(p)!=='Paid').length} outstanding</div></div>
    <div class="kpi-card"><div class="kpi-label">Total Logged</div><div class="kpi-value mono">${inr(total)}</div><div class="kpi-sub">${filtered.length} payables${dateFilterSuffix(payablesMonthFilter,'due in')}</div></div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Payables</h3><div class="sub">${inr(total)}${dateFilterSuffix(payablesMonthFilter,'due in')} · cleared Salary &amp; Rent → Commission &amp; Internal Loans → Vendor</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Category</th><th>Liability Account</th><th>Payee / Purpose</th><th>Due</th><th class="num">Amount</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
      <tbody>${filtered.slice().sort((a,b)=>CLEAR_ORDER.indexOf(a.category)-CLEAR_ORDER.indexOf(b.category)).map(p=>{ const st=payableStatus(p), bal=payableBalance(p); return `<tr><td><span class="tag type">${esc(p.category)}</span></td><td class="muted">${esc(liabilityAccountFor(p.category))}</td><td class="muted">${esc(p.payee)}</td><td class="muted">${fmtDateShort(p.due)}</td><td class="num mono">${inr(p.amount)}</td><td class="num mono">${bal>0?inr(bal):'<span class="faint">—</span>'}</td><td>${pill(st,payableStatusKind(st))}</td><td><div style="display:flex;gap:6px;">${bal>0?`<button class="btn btn-sm" onclick="openRecordPayablePayment('${p.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Record payment</button>`:`<span class="faint" style="font-size:11.5px;">paid in full</span>`}<button class="btn btn-sm ghost" onclick="openEditPayable('${p.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button>${(p.payments||[]).length?'':`<button class="btn btn-sm ghost" onclick="openConfirmDelete('payable','${p.id}')" title="Delete"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button>`}</div></td></tr>`; }).join("") || `<tr><td colspan="7"><div class="empty">No payables${payablesMonthFilter==='All'?'':' for this range'}.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
// Commission is just a regular Payable (category "Commission", tagged with salesPerson) auto-created
// whenever Finance approves a quote or invoice payment — see openApproveQuotePayment()/
// openApproveInvoicePayment(). This view rolls those up per sales person; paying one out (in full or
// in installments) reuses the exact same openRecordPayablePayment() every other payable uses, so a
// partial payment here behaves identically and updates the balance immediately.
// Shared by Accounts > Commissions and a Sales sign-in's own My Commission / Leaderboard tabs — one
// row per sales person who has at least one Commission payable, aggregated across all of them.
function commissionRowsByPerson(){
  const commissionPayables = payables.filter(p=>p.category==="Commission");
  const salesNames = [...new Set(commissionPayables.map(p=>p.salesPerson).filter(Boolean))];
  return salesNames.map(name=>{
    const mine = commissionPayables.filter(p=>p.salesPerson===name);
    return {name, mine, earned: mine.reduce((s,p)=>s+p.amount,0), paid: mine.reduce((s,p)=>s+payablePaid(p),0), balance: mine.reduce((s,p)=>s+payableBalance(p),0)};
  }).sort((a,b)=> b.balance-a.balance || b.earned-a.earned);
}
// Every Sales-dept employee, ranked by all-time commission earned (₹0 for anyone with none yet, so a
// new hire still appears) — powers the Leaderboard tab and the rank shown on a Sales sign-in's overview.
function salesLeaderboardRows(){
  const commission = commissionRowsByPerson();
  return assignableEmployees().filter(e=>e.dept==='Sales').map(e=>{
    const row = commission.find(r=>r.name===e.name);
    return { emp:e, name:e.name, earned: row?row.earned:0, clients: clients.filter(c=>c.salesPerson===e.name).length };
  }).sort((a,b)=>b.earned-a.earned);
}
function acctCommissions(){
  const commissionPayables = payables.filter(p=>p.category==="Commission");
  const salesNames = [...new Set(commissionPayables.map(p=>p.salesPerson).filter(Boolean))];
  // "Commission by sales person" below respects the month filter (by each entry's due date); the KPI
  // cards above stay all-time, same as Total Receivable does on Accounts > Invoices. Filtered locally
  // rather than through commissionRowsByPerson(), which stays unfiltered — it's shared with a Sales
  // sign-in's own My Commission / Leaderboard tabs, which should always show their real running balance.
  const filteredPayables = commissionPayables.filter(p=>matchesDateFilter(p.due, commissionsMonthFilter));
  const filteredNames = [...new Set(filteredPayables.map(p=>p.salesPerson).filter(Boolean))];
  const rows = filteredNames.map(name=>{
    const mine = filteredPayables.filter(p=>p.salesPerson===name);
    return {name, mine, earned: mine.reduce((s,p)=>s+p.amount,0), paid: mine.reduce((s,p)=>s+payablePaid(p),0), balance: mine.reduce((s,p)=>s+payableBalance(p),0)};
  }).sort((a,b)=> b.balance-a.balance || b.earned-a.earned);
  const totalEarned = commissionPayables.reduce((s,p)=>s+p.amount,0);
  const totalPaid = commissionPayables.reduce((s,p)=>s+payablePaid(p),0);
  const totalBalance = commissionPayables.reduce((s,p)=>s+payableBalance(p),0);
  const pendingWithdrawals = commissionWithdrawals.filter(w=>w.status==="Pending").slice().sort((a,b)=>a.requested.localeCompare(b.requested));
  const decidedWithdrawals = commissionWithdrawals.filter(w=>w.status!=="Pending").slice().sort((a,b)=>b.requested.localeCompare(a.requested)).slice(0,8);
  return `
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Sales earns ${Math.round(SALES_COMMISSION_RATE*100)}% commission on every payment Finance approves — from a quote or from a client's existing invoice. Each entry below is its own Commission payable, so it pays out in full or in installments exactly like any other payable — record a partial payment here and the balance updates immediately. A sales person can also request a withdrawal themselves — approve it below to pay it out.</div></div>
  <div class="kpi-grid">
    <div class="kpi-card hero"><div class="kpi-label">Outstanding Commission</div><div class="kpi-value mono ${totalBalance>0?'warn':''}">${inr(totalBalance)}</div><div class="kpi-sub">across ${salesNames.length} sales person${salesNames.length===1?'':'s'}</div></div>
    <div class="kpi-card"><div class="kpi-label">Paid Out</div><div class="kpi-value mono pos">${inr(totalPaid)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Total Earned</div><div class="kpi-value mono">${inr(totalEarned)}</div><div class="kpi-sub">${commissionPayables.length} commission entr${commissionPayables.length===1?'y':'ies'}, all time</div></div>
  </div>
  <div class="panel">
    <div class="panel-head" style="display:flex;align-items:center;justify-content:space-between;">
      <div><h3>Monthly sales target &amp; bonus</h3><div class="sub">Target ${inr(salesPolicy.monthlyTarget)} · ${Math.round(salesPolicy.bonusRate*100)}% bonus on sales past target, on top of the ${Math.round(SALES_COMMISSION_RATE*100)}% flat commission above</div></div>
      <button class="btn btn-sm ghost" onclick="openEditSalesPolicy()"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button>
    </div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Sales Person</th><th class="num">This month</th><th class="num">Target</th><th></th><th class="num">Bonus earned</th></tr></thead>
      <tbody>${salesTargets.length ? salesTargets.map(r=>{
        const pct = r.target>0 ? Math.min(100, Math.round(r.monthlySales/r.target*100)) : 0;
        const over = r.monthlySales>=r.target;
        return `<tr>
          <td>${esc(r.salesPerson)}</td>
          <td class="num mono">${inr(r.monthlySales)}</td>
          <td class="num mono muted">${inr(r.target)}</td>
          <td style="min-width:120px;"><div class="bar-track"><div class="bar-fill" style="width:${pct}%;${over?'background:var(--pos);':''}"></div></div></td>
          <td class="num mono ${r.bonusEarnedThisMonth>0?'pos':''}">${r.bonusEarnedThisMonth>0?inr(r.bonusEarnedThisMonth):'—'}</td>
        </tr>`;
      }).join('') : `<tr><td colspan="5"><div class="empty">No Sales-dept employees yet.</div></td></tr>`}</tbody>
    </table></div>
  </div>
  ${pendingWithdrawals.length || decidedWithdrawals.length ? `<div class="panel">
    <div class="panel-head"><h3>Withdrawal requests</h3><div class="sub">${pendingWithdrawals.length} pending</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Sales Person</th><th class="num">Amount</th><th>Requested</th><th>Note</th><th>Status</th><th></th></tr></thead>
      <tbody>${pendingWithdrawals.map(w=>`<tr><td>${esc(w.salesPerson)}</td><td class="num mono">${inr(w.amount)}</td><td class="muted">${fmtDate(w.requested)}</td><td class="muted">${esc(w.note||'—')}</td><td>${pill(w.status,statusKind(w.status))}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm" onclick="openApproveCommissionWithdrawal('${w.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Approve</button><button class="btn btn-sm danger" onclick="decideCommissionWithdrawalReject('${w.id}')">Reject</button></div></td></tr>`).join('')}${decidedWithdrawals.map(w=>`<tr><td>${esc(w.salesPerson)}</td><td class="num mono">${inr(w.amount)}</td><td class="muted">${fmtDate(w.requested)}</td><td class="muted">${esc(w.note||'—')}</td><td>${pill(w.status,statusKind(w.status))}</td><td></td></tr>`).join('')}</tbody>
    </table></div>
  </div>`:''}
  <div class="panel">
    <div class="panel-head" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;"><div><h3>Commission by sales person</h3><div class="sub">Expand a name to see every entry and record a payment — partial payments are fine</div></div><div class="filter-group"><span class="filter-label">Show</span><select class="select-sm" onchange="setCommissionsMonthFilter(this.value)">${dateFilterOptions(commissionPayables.map(p=>p.due), commissionsMonthFilter)}</select></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Sales Person</th><th class="num">Earned</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th></tr></thead>
      <tbody>${rows.length?rows.map(r=>{ const statusLabel = r.balance<=0?'Settled':(r.paid>0?'Partially Paid':'Outstanding'); return `<tr><td colspan="5" style="padding:0;border-bottom:1px solid var(--line);">
        <details class="report-details">
          <summary class="report-line" style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;align-items:center;padding:10px 14px;">
            <span class="name" style="font-weight:700;color:var(--ink);"><svg class="icon chev" style="width:10px;height:10px"><use href="#i-chevron-right"/></svg>${esc(r.name)}</span>
            <span class="num mono">${inr(r.earned)}</span>
            <span class="num mono muted">${r.paid>0?inr(r.paid):'—'}</span>
            <span class="num mono" style="${r.balance>0?'color:var(--neg);font-weight:700;':''}">${r.balance>0?inr(r.balance):'—'}</span>
            <span>${pill(statusLabel, r.balance<=0?'pos':'warn')}</span>
          </summary>
          <div class="report-detail">
            ${r.mine.slice().sort((a,b)=>b.due.localeCompare(a.due)).map(p=>{ const bal=payableBalance(p); return `<div class="report-detail-row" style="align-items:center;">
              <span>${esc(p.payee)} <span class="faint">· ${fmtDateShort(p.due)}</span></span>
              <span style="display:flex;gap:10px;align-items:center;">
                <span class="amt mono">${inr(p.amount)}${bal>0 && bal<p.amount?` <span class="faint">(${inr(bal)} left)</span>`:''}</span>
                ${bal>0?`<button class="btn btn-sm" onclick="openRecordPayablePayment('${p.id}')"><svg class="icon" style="width:11px;height:11px"><use href="#i-check"/></svg>Record payment</button>`:`<span class="faint" style="font-size:11px;">paid in full</span>`}
                ${(p.payments||[]).length?'':`<button class="btn btn-sm ghost" onclick="openConfirmDelete('payable','${p.id}')" title="Delete"><svg class="icon" style="width:11px;height:11px"><use href="#i-x"/></svg></button>`}
              </span>
            </div>`; }).join('')}
          </div>
        </details>
      </td></tr>`; }).join(""):`<tr><td colspan="5"><div class="empty">No commission earned${commissionsMonthFilter==='All'?' yet':' for this range'}.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
function openEditSalesPolicy(){
  showModal(`
    <div class="modal-head"><h3>Sales target &amp; bonus settings</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-sales-policy"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Applies to the current and future months immediately — past months' bonus payables already generated aren't recalculated.</div></div>
      <div class="field-row">
        <div><label class="field-label">Monthly sales target (₹)</label><input class="field-input" type="number" name="monthlyTarget" min="1" step="1000" required value="${salesPolicy.monthlyTarget}"></div>
        <div><label class="field-label">Bonus commission on excess (%)</label><input class="field-input" type="number" name="bonusRate" min="0" max="100" step="0.5" required value="${salesPolicy.bonusRate*100}"></div>
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save</button></div></div>
    </form>`);
  document.getElementById("f-sales-policy").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      await apiJson("/api/finance/sales-policy", { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({
        monthlyTarget: Number(f.get("monthlyTarget")), bonusRate: Number(f.get("bonusRate"))/100,
      })});
      await Promise.all([loadSalesPolicy(), loadSalesTargets()]);
      toast("Sales target settings saved"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't save settings"); }
  });
}
function acctExpenses(){
  const filtered = expenses.filter(e=>matchesDateFilter(e.date, expensesMonthFilter));
  const total = filtered.reduce((s,e)=>s+e.amount,0);
  return `
  <div class="toolbar"><div class="filter-group"><span class="filter-label">Show</span><select class="select-sm" onchange="setExpensesMonthFilter(this.value)">${dateFilterOptions(expenses.map(e=>e.date), expensesMonthFilter)}</select></div><button class="btn primary" onclick="openAddExpense()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Log expense</button></div>
  <div class="panel">
    <div class="panel-head"><h3>Expenses</h3><div class="sub">${inr(total)}${dateFilterSuffix(expensesMonthFilter,'logged in')} · untagged expenses count as shared overhead in Department Profitability</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Category</th><th>Description</th><th>Department</th><th>Date</th><th>Account</th><th class="num">Amount</th><th></th></tr></thead>
      <tbody>${filtered.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(e=>`<tr><td><span class="tag type">${esc(e.category)}</span></td><td class="muted">${esc(e.description)}</td><td class="muted">${e.dept?esc(e.dept):'<span class="faint">Shared</span>'}</td><td class="muted">${fmtDateShort(e.date)}</td><td class="muted">${bankById(e.accountId)?esc(bankById(e.accountId).name):'—'}</td><td class="num mono">${inr(e.amount)}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm ghost" onclick="openEditExpense('${e.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button><button class="btn btn-sm ghost" onclick="openConfirmDelete('expense','${e.id}')" title="Delete"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button></div></td></tr>`).join("") || `<tr><td colspan="6"><div class="empty">No expenses${expensesMonthFilter==='All'?'':' for this range'}.</div></td></tr>`}
      <tr class="total"><td colspan="6">Total</td><td class="num mono">${inr(total)}</td></tr></tbody>
    </table></div>
  </div>`;
}
// Invoice creation mirrors quote creation exactly: pick a client, price one or more services
// independently (quoteServiceRows()/updateQuoteTotal() are shared with the quote form), see the
// running total live, then save — the invoice's amount is always the sum of its items.
function openAddInvoice(preselectClientId){
  showModal(`
    <div class="modal-head"><h3>New invoice</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-add-invoice"><div class="modal-body">
      <div><label class="field-label">Client</label><select class="field-input" name="clientId">${clients.map(c=>`<option value="${c.id}" ${preselectClientId===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="section-label">Services — priced independently, total shown below</div>
      ${quoteServiceRows([])}
      <div id="quote-total-indicator" style="font-size:13px;padding-top:2px;">Total: <b>₹0</b></div>
      <div class="field-row">
        <div><label class="field-label">Invoice No.</label><input class="field-input" name="invoiceNo" required placeholder="DG-2026-1049"></div>
        <div><label class="field-label">Issued</label><input class="field-input" type="date" name="issued" value="${TODAY}" required></div>
        <div><label class="field-label">Due</label><input class="field-input" type="date" name="due" required></div>
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Create invoice</button></div></div>
    </form>`);
  document.getElementById("f-add-invoice").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const items = [];
    for(let n=1;n<=4;n++){ const dept=f.get("dept"+n), amount=Number(f.get("amount"+n))||0; if(dept && amount>0) items.push({dept, amount}); }
    if(!items.length){ toast("Add at least one service with an amount"); return; }
    try{
      await apiJson("/api/finance/invoices", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ clientId:f.get("clientId"), invoiceNo:f.get("invoiceNo"), issuedAt:f.get("issued"), dueAt:f.get("due"), items }) });
      await loadInvoices();
      toast("Invoice created"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't create invoice"); }
  });
}
function openEditInvoice(id){
  const i = invoices.find(x=>x.id===id);
  const paidSoFar = i.payments.reduce((s,p)=>s+p.amount,0);
  showModal(`
    <div class="modal-head"><h3>Edit invoice</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-edit-invoice"><div class="modal-body">
      ${paidSoFar>0?`<div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${inr(paidSoFar)} already received against this invoice — total can't be edited below that.</div></div>`:''}
      <div><label class="field-label">Client</label><select class="field-input" name="clientId">${clients.map(c=>`<option value="${c.id}" ${c.id===i.clientId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="section-label">Services — priced independently, total shown below</div>
      ${quoteServiceRows(i.items||[])}
      <div id="quote-total-indicator" style="font-size:13px;padding-top:2px;">Total: <b>${inr(invoiceTotal(i))}</b></div>
      <div class="field-row">
        <div><label class="field-label">Invoice No.</label><input class="field-input" name="invoiceNo" required value="${esc(i.invoiceNo)}"></div>
        <div><label class="field-label">Issued</label><input class="field-input" type="date" name="issued" value="${i.issued}" required></div>
        <div><label class="field-label">Due</label><input class="field-input" type="date" name="due" value="${i.due}" required></div>
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save changes</button></div></div>
    </form>`);
  document.getElementById("f-edit-invoice").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const items = [];
    for(let n=1;n<=4;n++){ const dept=f.get("dept"+n), amount=Number(f.get("amount"+n))||0; if(dept && amount>0) items.push({dept, amount}); }
    if(!items.length){ toast("Add at least one service with an amount"); return; }
    const newTotal = items.reduce((s,it)=>s+it.amount,0);
    if(newTotal < paidSoFar){ toast("Total can't be less than "+inr(paidSoFar)+" already received"); return; }
    try{
      await apiJson(`/api/finance/invoices/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ clientId:f.get("clientId"), items, invoiceNo:f.get("invoiceNo"), issuedAt:f.get("issued"), dueAt:f.get("due") }) });
      await loadInvoices();
      toast("Invoice updated"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't update invoice"); }
  });
}
function openRecordInvoicePayment(id){
  const inv = invoices.find(x=>x.id===id);
  const bal = invoiceBalance(inv);
  showModal(`
    <div class="modal-head"><h3>Record payment — ${inv.invoiceNo}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-inv-payment"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${esc(clientById(inv.clientId).name)} · ${inr(invoiceTotal(inv))} invoiced · <b>${inr(bal)}</b> balance remaining</div></div>
      <div class="field-row">
        <div><label class="field-label">Amount received (₹)</label><input class="field-input" type="number" name="amount" min="1" max="${bal}" step="1" required value="${bal}"></div>
        <div><label class="field-label">Date</label><input class="field-input" type="date" name="date" value="${TODAY}" required></div>
      </div>
      <div><label class="field-label">Credited to account</label><select class="field-input" name="accountId">${bankAccounts.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
      <div><label class="field-label">Note (optional)</label><input class="field-input" name="note" placeholder="e.g. Partial payment, UPI transfer"></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Record payment</button></div></div>
    </form>`);
  document.getElementById("f-inv-payment").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const amount = Math.min(bal, Math.max(1, Number(f.get("amount"))));
    const accountId = f.get("accountId"), date = f.get("date");
    const note = f.get("note").trim() || (amount>=bal?"Full settlement":"Partial payment");
    try{
      await apiJson(`/api/finance/invoices/${id}/payments`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ amount, paidDate:date, accountId, note }) });
      await Promise.all([loadInvoices(), loadBankAccounts(), refreshFinanceReports(), loadApprovedReceipts()]);
      toast("Payment recorded"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't record payment"); }
  });
}
// Sales-side: log a payment they personally collected against an EXISTING invoice and push it to
// Finance.
// Nothing touches the invoice balance until Finance confirms it with openApproveInvoicePayment().
function openSubmitInvoicePayment(id){
  const inv = invoices.find(x=>x.id===id);
  const bal = invoiceBalance(inv);
  const client = clientById(inv.clientId);
  const assignablePool = assignableEmployees();
  const salesEmps = assignablePool.filter(e=>e.dept==='Sales');
  const salesOptions = (salesEmps.length?salesEmps:assignablePool).map(e=>`<option ${e.name===client.salesPerson?'selected':''}>${esc(e.name)}</option>`).join('');
  showModal(`
    <div class="modal-head"><h3>Log payment collected — ${esc(inv.invoiceNo)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-submit-invoice-payment"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${esc(client.name)} · <b>${inr(bal)}</b> balance remaining — full or partial is fine. This pushes the payment to Finance, who'll confirm the money landed before it's added to the invoice — the credited sales person earns ${Math.round(SALES_COMMISSION_RATE*100)}% commission once approved.</div></div>
      <div class="field-row">
        <div><label class="field-label">Amount collected (₹)</label><input class="field-input" type="number" name="amount" min="1" max="${bal}" step="1" required value="${bal}"></div>
        <div><label class="field-label">Payment date</label><input class="field-input" type="date" name="paymentDate" value="${TODAY}" required></div>
      </div>
      <div><label class="field-label">Collected by</label><select class="field-input" name="salesPerson">${salesOptions}</select></div>
      <div><label class="field-label">Note for Finance (optional)</label><input class="field-input" name="note" placeholder="e.g. Paid via UPI, ref UTR..."></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Push to Finance</button></div></div>
    </form>`);
  document.getElementById("f-submit-invoice-payment").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const amount = Math.min(bal, Math.max(1, Number(f.get("amount"))));
    try{
      await apiJson(`/api/finance/invoices/${id}/pending-payments`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ amount, paymentDate:f.get("paymentDate"), note:f.get("note").trim()||"Sales confirmed payment", salesPerson:f.get("salesPerson") }) });
      await loadInvoices();
      toast("Sent to Finance for confirmation"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't submit payment"); }
  });
}
// Finance-side: confirm which bank account the money landed in, then it lands in inv.payments and
// the bank ledger — mirrors openApproveQuotePayment() exactly, minus the lead-conversion step
// (an invoice always already belongs to an existing client).
function openApproveInvoicePayment(id, idx){
  const inv = invoices.find(x=>x.id===id);
  const payment = inv.pendingPayments[idx];
  showModal(`
    <div class="modal-head"><h3>Approve payment — ${esc(inv.invoiceNo)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-approve-invoice-payment"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${esc(clientById(inv.clientId).name)} · this payment <b>${inr(payment.amount)}</b> · Sales reported collected ${fmtDateShort(payment.date)}${payment.note?' — '+esc(payment.note):''}</div></div>
      <div class="field-row">
        <div><label class="field-label">Credited to account</label><select class="field-input" name="accountId">${bankAccounts.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
        <div><label class="field-label">Date confirmed</label><input class="field-input" type="date" name="date" value="${payment.date||TODAY}" required></div>
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Approve &amp; confirm</button></div></div>
    </form>`);
  document.getElementById("f-approve-invoice-payment").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const accountId = f.get("accountId"), date = f.get("date");
    try{
      await apiJson(`/api/finance/invoices/${id}/pending-payments/${payment.id}/approve`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ accountId, date }) });
      await Promise.all([loadInvoices(), loadBankAccounts(), loadPayables(), refreshFinanceReports(), loadApprovedReceipts()]);
      const updated = invoices.find(x=>x.id===id);
      const commissionAmount = payment.salesPerson ? Math.round(payment.amount * SALES_COMMISSION_RATE) : 0;
      toast("Payment approved"+(invoiceBalance(updated)<=0?" — invoice fully settled":" — "+inr(invoiceBalance(updated))+" still outstanding")+(commissionAmount>0?" · "+inr(commissionAmount)+" commission credited to "+payment.salesPerson:"")); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't approve payment"); }
  });
}
function openAddPayable(){
  showModal(`
    <div class="modal-head"><h3>New payable</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-add-payable"><div class="modal-body">
      <div class="field-row">
        <div><label class="field-label">Category</label><select class="field-input" name="category">${CLEAR_ORDER.map(c=>`<option>${c}</option>`).join('')}</select></div>
        <div><label class="field-label">Amount (₹)</label><input class="field-input" type="number" name="amount" min="0" required placeholder="15000"></div>
      </div>
      <div><label class="field-label">Payee / Purpose</label><input class="field-input" name="payee" required placeholder="e.g. Office rent — September"></div>
      <div><label class="field-label">Due date</label><input class="field-input" type="date" name="due" value="${TODAY}" required></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Add payable</button></div></div>
    </form>`);
  document.getElementById("f-add-payable").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      await apiJson("/api/finance/payables", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ category:TITLECASE_TO_API(f.get("category")), payee:f.get("payee"), amount:Number(f.get("amount")), dueAt:f.get("due") }) });
      await loadPayables();
      toast("Payable added"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't add payable"); }
  });
}
function openEditPayable(id){
  const p = payables.find(x=>x.id===id);
  const paidSoFar = payablePaid(p);
  showModal(`
    <div class="modal-head"><h3>Edit payable</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-edit-payable"><div class="modal-body">
      ${paidSoFar>0?`<div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${inr(paidSoFar)} already recorded against this payable — amount can't be edited below that.</div></div>`:''}
      <div class="field-row">
        <div><label class="field-label">Category</label><select class="field-input" name="category">${CLEAR_ORDER.map(c=>`<option ${c===p.category?'selected':''}>${c}</option>`).join('')}</select></div>
        <div><label class="field-label">Amount (₹)</label><input class="field-input" type="number" name="amount" min="${paidSoFar||0}" required value="${p.amount}"></div>
      </div>
      <div><label class="field-label">Payee / Purpose</label><input class="field-input" name="payee" required value="${esc(p.payee)}"></div>
      <div><label class="field-label">Due date</label><input class="field-input" type="date" name="due" value="${p.due}" required></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save changes</button></div></div>
    </form>`);
  document.getElementById("f-edit-payable").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const amount = Math.max(paidSoFar||0, Number(f.get("amount")));
    try{
      await apiJson(`/api/finance/payables/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ category:TITLECASE_TO_API(f.get("category")), payee:f.get("payee"), amount, dueAt:f.get("due") }) });
      await loadPayables();
      toast("Payable updated"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't update payable"); }
  });
}
function openRecordPayablePayment(id){
  const p = payables.find(x=>x.id===id);
  const bal = payableBalance(p);
  showModal(`
    <div class="modal-head"><h3>Record payment — ${esc(p.category)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-pay-payable"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${esc(p.payee)} · ${inr(p.amount)} owed · <b>${inr(bal)}</b> balance remaining · liability account <b>${esc(liabilityAccountFor(p.category))}</b></div></div>
      <div class="field-row">
        <div><label class="field-label">Amount paid (₹)</label><input class="field-input" type="number" name="amount" min="1" max="${bal}" step="1" required value="${bal}"></div>
        <div><label class="field-label">Date</label><input class="field-input" type="date" name="date" value="${TODAY}" required></div>
      </div>
      <div><label class="field-label">Paid from account</label><select class="field-input" name="accountId">${bankAccounts.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Record payment</button></div></div>
    </form>`);
  document.getElementById("f-pay-payable").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const amount = Math.min(bal, Math.max(1, Number(f.get("amount"))));
    const accountId = f.get("accountId"), date = f.get("date");
    try{
      await apiJson(`/api/finance/payables/${id}/payments`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ amount, paidDate:date, accountId, note: amount>=bal ? "Full settlement" : "Partial payment" }) });
      await Promise.all([loadPayables(), loadBankAccounts()]);
      toast("Payment recorded — liability reduced, not re-expensed"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't record payment"); }
  });
}
function openAddExpense(){
  showModal(`
    <div class="modal-head"><h3>Log expense</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-add-expense"><div class="modal-body">
      <div class="field-row">
        <div><label class="field-label">Category</label><select class="field-input" name="coaAccountId">${expenseCoaOptions()}</select></div>
        <div><label class="field-label">Amount (₹)</label><input class="field-input" type="number" name="amount" min="0" required placeholder="5000"></div>
      </div>
      <div><label class="field-label">Description</label><input class="field-input" name="description" required placeholder="What was this for?"></div>
      <div class="field-row">
        <div><label class="field-label">Date</label><input class="field-input" type="date" name="date" value="${TODAY}" required></div>
        <div><label class="field-label">Paid from account</label><select class="field-input" name="accountId">${bankAccounts.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
      </div>
      <div><label class="field-label">Department (optional)</label><select class="field-input" name="dept"><option value="">— Shared / company-wide —</option>${SERVICE_DEPARTMENTS.map(d=>`<option>${esc(d)}</option>`).join('')}</select><div class="subtext">Leave as Shared for office-wide costs (including Sales &amp; Administrative) — it'll be pooled into overhead and split by headcount. Pick a client-facing department if this expense belongs to that department alone.</div></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Log expense</button></div></div>
    </form>`);
  document.getElementById("f-add-expense").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const accountId = f.get("accountId"), date = f.get("date"), coaAccountId = f.get("coaAccountId"), description = f.get("description"), amount = Number(f.get("amount"));
    try{
      await apiJson("/api/finance/expenses", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ coaAccountId, description, amount, date, accountId, dept:f.get("dept")||undefined }) });
      await Promise.all([loadExpenses(), loadBankAccounts()]);
      toast("Expense logged"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't log expense"); }
  });
}
function openEditExpense(id){
  const e = expenses.find(x=>x.id===id);
  showModal(`
    <div class="modal-head"><h3>Edit expense</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-edit-expense"><div class="modal-body">
      <div class="field-row">
        <div><label class="field-label">Category</label><select class="field-input" name="coaAccountId">${expenseCoaOptions(e.coaAccountId)}</select></div>
        <div><label class="field-label">Amount (₹)</label><input class="field-input" type="number" name="amount" min="0" required value="${e.amount}"></div>
      </div>
      <div><label class="field-label">Description</label><input class="field-input" name="description" required value="${esc(e.description)}"></div>
      <div class="field-row">
        <div><label class="field-label">Date</label><input class="field-input" type="date" name="date" value="${e.date}" required></div>
        <div><label class="field-label">Paid from account</label><select class="field-input" name="accountId">${bankAccounts.map(b=>`<option value="${b.id}" ${b.id===e.accountId?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
      </div>
      <div><label class="field-label">Department (optional)</label><select class="field-input" name="dept"><option value="" ${!e.dept?'selected':''}>— Shared / company-wide —</option>${SERVICE_DEPARTMENTS.map(d=>`<option ${d===e.dept?'selected':''}>${esc(d)}</option>`).join('')}</select></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save changes</button></div></div>
    </form>`);
  document.getElementById("f-edit-expense").addEventListener("submit", async ev=>{
    ev.preventDefault();
    const f = new FormData(ev.target);
    const accountId = f.get("accountId"), date = f.get("date"), coaAccountId = f.get("coaAccountId"), description = f.get("description"), amount = Number(f.get("amount"));
    try{
      await apiJson(`/api/finance/expenses/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ coaAccountId, description, amount, date, accountId, dept:f.get("dept")||undefined }) });
      await Promise.all([loadExpenses(), loadBankAccounts()]);
      toast("Expense updated"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't update expense"); }
  });
}

/* ---- Banks ---- */
function acctBanks(){
  const total = bankAccounts.reduce((s,b)=>s+bankAccountBalance(b.id),0);
  return `
  <div class="toolbar"><div></div><div style="display:flex;gap:8px;"><button class="btn ghost" onclick="openTransferFunds()"><svg class="icon" style="width:13px;height:13px"><use href="#i-refresh"/></svg>Transfer funds</button><button class="btn primary" onclick="openAddBankAccount()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Add bank account</button></div></div>
  <div class="kpi-grid">
    <div class="kpi-card hero"><div class="kpi-label">Total cash &amp; bank balance</div><div class="kpi-value mono">${inr(total)}</div><div class="kpi-sub">across ${bankAccounts.length} accounts</div></div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Accounts</h3><div class="sub">Opening balance + every credit/debit recorded against it</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Account</th><th>Bank</th><th>Number</th><th class="num">Opening balance</th><th class="num">Current balance</th><th></th></tr></thead>
      <tbody>${bankAccounts.map(b=>`<tr><td>${esc(b.name)}</td><td class="muted">${esc(b.bank)}</td><td class="mono muted">${esc(b.number)}</td><td class="num mono">${inr(b.opening)}</td><td class="num mono" style="color:var(--pos)">${inr(bankAccountBalance(b.id))}</td><td><div style="display:flex;gap:6px;"><button class="btn btn-sm" onclick="openBankLedger('${b.id}')">View ledger</button><button class="btn btn-sm ghost" onclick="openEditBankAccount('${b.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button><button class="btn btn-sm ghost" onclick="openConfirmDelete('bank','${b.id}')" title="Delete"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button></div></td></tr>`).join("")}</tbody>
    </table></div>
  </div>`;
}
function openAddBankAccount(){
  showModal(`
    <div class="modal-head"><h3>Add bank account</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-add-bank"><div class="modal-body">
      <div><label class="field-label">Account name</label><input class="field-input" name="name" required placeholder="e.g. Axis Bank — Current A/c"></div>
      <div class="field-row">
        <div><label class="field-label">Bank</label><input class="field-input" name="bank" required placeholder="e.g. Axis Bank"></div>
        <div><label class="field-label">Account number (last 4 digits)</label><input class="field-input" name="number" placeholder="e.g. 9021"></div>
      </div>
      <div><label class="field-label">Opening balance (₹)</label><input class="field-input" type="number" name="opening" min="0" step="1" required placeholder="0"></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Add account</button></div></div>
    </form>`);
  document.getElementById("f-add-bank").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const num = f.get("number").trim();
    try{
      await apiJson("/api/finance/bank-accounts", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ name:f.get("name"), bank:f.get("bank"), number:num?("•••• "+num):"—", opening:Number(f.get("opening")) }) });
      await loadBankAccounts();
      toast("Bank account added"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't add bank account"); }
  });
}
function openEditBankAccount(id){
  const b = bankAccounts.find(x=>x.id===id);
  const rawNumber = (b.number.match(/(\d+)$/)||[])[1] || "";
  showModal(`
    <div class="modal-head"><h3>Edit bank account</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-edit-bank"><div class="modal-body">
      <div><label class="field-label">Account name</label><input class="field-input" name="name" required value="${esc(b.name)}"></div>
      <div class="field-row">
        <div><label class="field-label">Bank</label><input class="field-input" name="bank" required value="${esc(b.bank)}"></div>
        <div><label class="field-label">Account number (last 4 digits)</label><input class="field-input" name="number" value="${esc(rawNumber)}"></div>
      </div>
      <div><label class="field-label">Opening balance</label><div class="mono field-input" style="background:var(--surface-sunk);">${inr(b.opening)}</div><div class="subtext">Locked once transactions exist against this account — it would silently reshape every historical balance otherwise.</div></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save changes</button></div></div>
    </form>`);
  document.getElementById("f-edit-bank").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const num = f.get("number").trim();
    try{
      await apiJson(`/api/finance/bank-accounts/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ name:f.get("name"), bank:f.get("bank"), number:num?("•••• "+num):"—" }) });
      await loadBankAccounts();
      toast("Bank account updated"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't update bank account"); }
  });
}
function openTransferFunds(){
  showModal(`
    <div class="modal-head"><h3>Transfer between accounts</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-transfer"><div class="modal-body">
      <div class="field-row">
        <div><label class="field-label">From</label><select class="field-input" name="from">${bankAccounts.map(b=>`<option value="${b.id}">${esc(b.name)} (${inr(bankAccountBalance(b.id))})</option>`).join('')}</select></div>
        <div><label class="field-label">To</label><select class="field-input" name="to">${bankAccounts.map((b,i)=>`<option value="${b.id}" ${i===1?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">Amount (₹)</label><input class="field-input" type="number" name="amount" min="1" required placeholder="10000"></div>
        <div><label class="field-label">Date</label><input class="field-input" type="date" name="date" value="${TODAY}" required></div>
      </div>
      <div><label class="field-label">Note (optional)</label><input class="field-input" name="note" placeholder="e.g. Petty cash top-up"></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Transfer</button></div></div>
    </form>`);
  document.getElementById("f-transfer").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const from = f.get("from"), to = f.get("to"), amount = Number(f.get("amount")), date = f.get("date"), note = f.get("note").trim();
    if(from===to){ toast("Pick two different accounts"); return; }
    try{
      await apiJson("/api/finance/transfers", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ fromAccountId:from, toAccountId:to, amount, date, note:note||undefined }) });
      await loadBankAccounts();
      toast("Transfer recorded"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't record transfer"); }
  });
}
async function openBankLedger(accountId){
  const b = bankById(accountId);
  const { transactions } = await apiJson(`/api/finance/bank-accounts/${accountId}/ledger`);
  // Server returns newest-first with running balance already computed —
  // reverse back to chronological (oldest first) for display, matching the
  // original ledger reading order.
  const rows = transactions.slice().reverse().map(t=>({ date: isoDate(t.date), note: t.note, type: t.type==="CREDIT"?"credit":"debit", amount: Number(t.amount), running: t.runningBalance }));
  showModal(`
    <div class="modal-head"><h3>${esc(b.name)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-wallet"/></svg><div>Opening balance <b>${inr(b.opening)}</b> · current balance <b>${inr(bankAccountBalance(accountId))}</b></div></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Note</th><th class="num">Credit</th><th class="num">Debit</th><th class="num">Balance</th></tr></thead>
        <tbody>${rows.length?rows.map(t=>`<tr><td class="muted">${fmtDateShort(t.date)}</td><td class="muted">${esc(t.note)}</td><td class="num mono" style="color:var(--pos)">${t.type==='credit'?inr(t.amount):''}</td><td class="num mono" style="color:var(--neg)">${t.type==='debit'?inr(t.amount):''}</td><td class="num mono">${inr(t.running)}</td></tr>`).join(""):'<tr><td colspan="5" class="empty">No transactions yet.</td></tr>'}</tbody>
      </table></div>
    </div>
    <div class="modal-foot"><div></div><button type="button" class="btn ghost" onclick="closeModal()">Close</button></div>`, true);
}

/* ---- Quotes (Finance side — see the Marketing > Quotes functions for the Sales side) ---- */
function acctQuotes(){
  const filtered = quotes.filter(q=>quotesMonthFilter==='All' || q.createdDate.slice(0,7)===quotesMonthFilter);
  const rest = filtered.slice().sort((a,b)=>b.createdDate.localeCompare(a.createdDate));
  return `
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Payments Sales pushes against a quote are confirmed from Accounts &gt; Payment Receipts, not here — approving one there is what creates (or tops up) the invoice and posts it to the bank ledger, and turns a lead into a client on their first approved payment.</div></div>
  <div class="panel">
    <div class="panel-head" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;"><div><h3>All quotes</h3><div class="sub">${filtered.length} of ${quotes.length}${quotesMonthFilter!=='All'?' in '+monthLabel(quotesMonthFilter):' total'}</div></div><div class="filter-group"><span class="filter-label">Month</span><select class="select-sm" onchange="setQuotesMonthFilter(this.value)">${monthFilterOptions(quotes.map(q=>q.createdDate), quotesMonthFilter)}</select></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Quote</th><th>For</th><th>Service(s)</th><th class="num">Amount</th><th class="num">Approved so far</th><th>Status</th><th></th></tr></thead>
      <tbody>${rest.map(q=>{ const party=quoteParty(q); const paid=quoteApprovedPaid(q); return `<tr><td>${esc(q.title)}</td><td class="muted">${esc(party.name)}${party.kind==='lead'?' '+pill('Lead','blue'):''}</td><td class="muted">${q.items.map(i=>esc(i.dept)).join(', ')}</td><td class="num mono">${inr(quoteTotal(q))}</td><td class="num mono">${paid>0?inr(paid):'<span class="faint">—</span>'}</td><td>${pill(q.status,quoteStatusKind(q.status))}${q.status==='Invoiced'&&q.invoiceId?` <span class="faint" style="font-size:11px;">${esc(q.invoiceId)}</span>`:''}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm ghost" onclick="downloadQuote('${q.id}')" title="Download quote"><svg class="icon" style="width:12px;height:12px"><use href="#i-download"/></svg>Download</button>${q.invoiceId?'':`<button class="btn btn-sm ghost" onclick="openConfirmDelete('quote','${q.id}')" title="Delete"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button>`}</div></td></tr>`; }).join("") || `<tr><td colspan="7"><div class="empty">No quotes that month.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
function openApproveQuotePayment(quoteId, idx){
  const q = quotes.find(x=>x.id===quoteId);
  const payment = q.payments[idx];
  const party = quoteParty(q);
  const total = quoteTotal(q);
  showModal(`
    <div class="modal-head"><h3>Approve payment — ${esc(q.title)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-approve-quote-payment"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${esc(party.name)}${party.kind==='lead'?' — new lead, becomes a client on approval':''} · this payment <b>${inr(payment.amount)}</b> of ${inr(total)} total · Sales reported paid ${fmtDateShort(payment.date)}${payment.note?' — '+esc(payment.note):''}</div></div>
      <div class="field-row">
        <div><label class="field-label">Credited to account</label><select class="field-input" name="accountId">${bankAccounts.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
        <div><label class="field-label">Date confirmed</label><input class="field-input" type="date" name="date" value="${payment.date||TODAY}" required></div>
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Approve &amp; confirm</button></div></div>
    </form>`);
  document.getElementById("f-approve-quote-payment").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const accountId = f.get("accountId"), date = f.get("date");
    // The one real fix this migration owed the old prototype: this used to
    // mutate the local invoices/payables/clients caches directly (no bank
    // ledger entry, no persistence, invisible to other users). Now it's a
    // single real server transaction — lead→client conversion, invoice
    // create-or-topup, ledger entry and commission payable all happen
    // together, or not at all. See approveQuotePendingPayment() server-side.
    try{
      const wasLead = !q.clientId && q.leadId;
      const leadName = wasLead ? (leadById(q.leadId)||{}).name : null;
      const result = await apiJson(`/api/crm/quotes/${quoteId}/pending-payments/${payment.id}/approve`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ accountId, date }) });
      await Promise.all([loadQuotes(), loadClients(), loadLeads(), loadInvoices(), loadPayables(), loadBankAccounts(), refreshFinanceReports(), loadApprovedReceipts()]);
      const commissionAmount = q.createdBy ? Math.round(payment.amount * SALES_COMMISSION_RATE) : 0;
      toast("Payment approved"+(result.balance<=0?" — quote fully invoiced":" — "+inr(result.balance)+" still outstanding")+(wasLead?" · "+leadName+" is now a client":"")+(commissionAmount>0?" · "+inr(commissionAmount)+" commission credited to "+q.createdBy:""));
      closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't approve payment"); }
  });
}

/* ---- Chart of Accounts ---- */
function acctChartOfAccounts(){
  const mains = chartOfAccounts.filter(c=>!c.parent);
  return `
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Classify each main account as Asset, Liability, Income or Expense — Reports (P&amp;L and Balance Sheet) group everything by this. A sub-account (e.g. <b>Shirin Salary</b> under <b>Salaries</b>) always inherits its parent's type — reclassify the main account and every sub-account moves with it. Payroll (Salaries &amp; Wages) as a lump figure is always counted in P&amp;L straight from Payroll, not from these categories.</div></div>
  <div class="toolbar"><div></div><button class="btn primary" onclick="openAddCoaAccount()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Add account</button></div>
  <div class="panel">
    <div class="panel-head"><h3>Chart of accounts</h3><div class="sub">${mains.length} main accounts · ${chartOfAccounts.length-mains.length} sub-accounts</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Account</th><th>Type</th><th></th></tr></thead>
      <tbody>${mains.map(m=>{
        const subs = chartOfAccounts.filter(c=>c.parent===m.name);
        return `<tr><td style="font-weight:700;">${esc(m.name)}</td><td><select class="select-sm" onchange="setCoaType('${esc(m.name)}', this.value)">${COA_TYPES.map(t=>`<option ${t===m.type?'selected':''}>${t}</option>`).join('')}</select></td><td><button class="btn btn-sm ghost" onclick="removeCoaAccount('${esc(m.name)}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg>Remove</button></td></tr>`
          + subs.map(s=>`<tr><td class="muted" style="padding-left:28px;">↳ ${esc(s.name)}</td><td class="muted">${esc(m.type)} <span class="faint">(inherited)</span></td><td><button class="btn btn-sm ghost" onclick="removeCoaAccount('${esc(s.name)}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg>Remove</button></td></tr>`).join("");
      }).join("")}</tbody>
    </table></div>
  </div>`;
}
function openAddCoaAccount(){
  showModal(`
    <div class="modal-head"><h3>Add account</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-add-coa"><div class="modal-body">
      <div><label class="field-label">Account name</label><input class="field-input" name="name" required placeholder="e.g. Subscriptions, or Rahul Salary"></div>
      <div><label class="field-label">Parent account (optional)</label><select class="field-input" name="parent" onchange="document.getElementById('coa-type-row').hidden = !!this.value">
        <option value="">— None, this is a main account —</option>
        ${chartOfAccounts.filter(c=>!c.parent).map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}
      </select></div>
      <div id="coa-type-row"><label class="field-label">Type</label><select class="field-input" name="type">${COA_TYPES.map(t=>`<option>${t}</option>`).join('')}</select></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Add</button></div></div>
    </form>`);
  document.getElementById("f-add-coa").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const name = f.get("name").trim();
    if(!name) return;
    const parent = f.get("parent");
    try{
      const parentAcc = parent ? chartOfAccounts.find(c=>c.name===parent) : null;
      await apiJson("/api/finance/coa", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(parentAcc ? { name, parentId: parentAcc._dbId } : { name, type: TITLECASE_TO_API(f.get("type")) }) });
      await loadChartOfAccounts();
      toast(parent ? "Sub-account added under "+parent : "Main account added");
      closeModal(); render();
    }catch(err){ toast(err.message || "That account already exists"); }
  });
}

/* ---- Manual Journal ---- */
function journalEntryTotal(j){ return j.lines.reduce((s,l)=>s+(l.side==="debit"?l.amount:0),0); }
function acctJournal(){
  const filtered = journalEntries.filter(j=>matchesDateFilter(j.date, journalMonthFilter));
  const sorted = filtered.slice().sort((a,b)=>b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  return `
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>For anything the structured forms (Invoices, Payables, Expenses, Banks) don't capture — write-offs, accruals, corrections. Each entry must balance (total debits = total credits). Debit increases an Asset or Expense; Credit increases a Liability or Income. A line against a bank account posts straight to that account's ledger. Entries are permanent once posted — a correction goes in as a new entry, never an edit to history.</div></div>
  <div class="toolbar"><div class="filter-group"><span class="filter-label">Show</span><select class="select-sm" onchange="setJournalMonthFilter(this.value)">${dateFilterOptions(journalEntries.map(j=>j.date), journalMonthFilter)}</select></div><button class="btn primary" onclick="openAddJournalEntry()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New journal entry</button></div>
  <div class="panel">
    <div class="panel-head"><h3>Journal entries</h3><div class="sub">${filtered.length} of ${journalEntries.length}${dateFilterSuffix(journalMonthFilter,'posted in')}</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Memo</th><th>Lines</th><th class="num">Amount</th></tr></thead>
      <tbody>${sorted.map(j=>`<tr><td class="muted">${fmtDate(j.date)}</td><td style="font-weight:600;">${esc(j.memo)}</td><td class="muted" style="font-size:12px;">${j.lines.map(l=>`${esc(journalAccountLabel(l.account))} ${l.side==='debit'?'Dr':'Cr'} ${inr(l.amount)}`).join(' · ')}</td><td class="num mono">${inr(journalEntryTotal(j))}</td></tr>`).join("") || `<tr><td colspan="4"><div class="empty">No journal entries${journalMonthFilter==='All'?' yet':' for this range'}.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
function journalBalanceHTML(debit, credit, filled){
  if(filled<2) return `<div style="display:flex;align-items:center;gap:16px;padding:10px 12px;background:var(--surface-sunk);border-radius:10px;font-size:13px;"><span class="faint">Enter at least two lines to check the balance.</span></div>`;
  const diff = Math.round((debit-credit)*100)/100;
  return `<div style="display:flex;align-items:center;gap:16px;padding:10px 12px;background:var(--surface-sunk);border-radius:10px;font-size:13px;">
    <span>Debits <b class="mono">${inr(debit)}</b></span>
    <span>Credits <b class="mono">${inr(credit)}</b></span>
    <span style="margin-left:auto;">${diff===0?pill('Balanced ✓','pos'):pill('Off by '+inr(Math.abs(diff)),'neg')}</span>
  </div>`;
}
function updateJournalBalance(){
  let debit=0, credit=0, filled=0;
  for(let i=1;i<=4;i++){
    const side = document.querySelector(`[name="side${i}"]`);
    const amt = document.querySelector(`[name="amount${i}"]`);
    const v = Number((amt&&amt.value)||0);
    if(side && side.value && v>0){ filled++; if(side.value==='debit') debit+=v; else credit+=v; }
  }
  const el = document.getElementById("journal-balance-indicator");
  if(el) el.innerHTML = journalBalanceHTML(debit, credit, filled);
}
function journalRowHTML(i, line){
  const hidden = (i>2 && !line);
  return `
  <div class="field-row" id="jrn-row-${i}" style="align-items:center;${hidden?'display:none;':''}">
    <div style="flex:2;"><select class="field-input" name="account${i}" onchange="updateJournalBalance()"><option value="">— select account —</option>${journalAccountOptions(line?line.account:null)}</select></div>
    <div style="width:116px;"><select class="field-input" name="side${i}" onchange="updateJournalBalance()"><option value="">Type</option><option value="debit" ${line&&line.side==='debit'?'selected':''}>Debit</option><option value="credit" ${line&&line.side==='credit'?'selected':''}>Credit</option></select></div>
    <div style="width:120px;"><input class="field-input" type="number" min="0" step="0.01" name="amount${i}" placeholder="0" value="${line?line.amount:''}" oninput="updateJournalBalance()"></div>
    <button type="button" class="btn btn-sm ghost" title="Remove line" onclick="clearJournalRow(${i})" style="flex:none;${i<=2?'visibility:hidden;':''}"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button>
  </div>`;
}
function addJournalRow(){
  for(let i=3;i<=4;i++){
    const row = document.getElementById('jrn-row-'+i);
    if(row && row.style && row.style.display==='none'){
      row.style.display='';
      if(i===4){ const btn=document.getElementById('jrn-add-line-btn'); if(btn) btn.style.display='none'; }
      return;
    }
  }
}
function clearJournalRow(i){
  const acc = document.querySelector(`[name="account${i}"]`), side = document.querySelector(`[name="side${i}"]`), amt = document.querySelector(`[name="amount${i}"]`);
  if(acc) acc.value=''; if(side) side.value=''; if(amt) amt.value='';
  const row = document.getElementById('jrn-row-'+i);
  if(row && row.style) row.style.display='none';
  const btn = document.getElementById('jrn-add-line-btn');
  if(btn && btn.style) btn.style.display='';
  updateJournalBalance();
}
function journalEntryModalBody(entry){
  const lines = entry ? entry.lines : [];
  const rowsHtml = [1,2,3,4].map(i=>journalRowHTML(i, lines[i-1])).join("");
  const initDebit = lines.filter(l=>l.side==='debit').reduce((s,l)=>s+l.amount,0);
  const initCredit = lines.filter(l=>l.side==='credit').reduce((s,l)=>s+l.amount,0);
  return `
    <div class="field-row">
      <div><label class="field-label">Date</label><input class="field-input" type="date" name="date" value="${entry?entry.date:TODAY}" required></div>
      <div style="flex:2;"><label class="field-label">Memo</label><input class="field-input" name="memo" required value="${entry?esc(entry.memo):''}" placeholder="e.g. Accrued audit fee for September"></div>
    </div>
    <div class="section-label" style="margin-top:2px;">Lines — pick an account, whether it's debited or credited, and the amount</div>
    <div class="field-row" style="margin-bottom:-10px;">
      <div style="flex:2;"><label class="field-label">Account</label></div>
      <div style="width:116px;"><label class="field-label">Type</label></div>
      <div style="width:120px;"><label class="field-label">Amount (₹)</label></div>
      <div style="width:30px;"></div>
    </div>
    ${rowsHtml}
    <button type="button" class="btn btn-sm ghost" id="jrn-add-line-btn" onclick="addJournalRow()" ${lines.length>=4?'style="display:none;"':''}><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Add another line</button>
    <div id="journal-balance-indicator">${journalBalanceHTML(initDebit, initCredit, lines.length)}</div>
  `;
}
// Append-only: this only ever creates. The client-side balance check here
// is just fast feedback — the server re-validates and is the real guard.
async function submitJournalForm(e){
  e.preventDefault();
  const f = new FormData(e.target);
  const date = f.get("date"), memo = f.get("memo").trim();
  const lines = [];
  for(let i=1;i<=4;i++){
    const account = f.get("account"+i), side = f.get("side"+i), amount = Number(f.get("amount"+i))||0;
    if(!account || !side || amount<=0) continue;
    lines.push({account, side, amount});
  }
  if(lines.length<2){ toast("Add at least two lines"); return; }
  const totalDebit = lines.filter(l=>l.side==="debit").reduce((s,l)=>s+l.amount,0);
  const totalCredit = lines.filter(l=>l.side==="credit").reduce((s,l)=>s+l.amount,0);
  if(totalDebit<=0 || Math.round((totalDebit-totalCredit)*100)!==0){ toast("Entry is out of balance — debits must equal credits"); return; }
  try{
    await apiJson("/api/finance/journal", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ date, memo, lines: lines.map(l=>({ account:l.account, side:l.side.toUpperCase(), amount:l.amount })) }) });
    await Promise.all([loadJournalEntries(), loadBankAccounts()]);
    toast("Journal entry posted"); closeModal(); render();
  }catch(err){ toast(err.message || "Couldn't post journal entry"); }
}
function openAddJournalEntry(){
  showModal(`
    <div class="modal-head"><h3>New journal entry</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-journal"><div class="modal-body">${journalEntryModalBody(null)}</div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Post entry</button></div></div>
    </form>`);
  document.getElementById("f-journal").addEventListener("submit", submitJournalForm);
}
// Journal entries are append-only (see the data layer above) — there's no
// edit path anymore. A correction is posted as a new entry instead.

/* ---- Reports (month-wise P&L and Balance Sheet) ---- */
function monthEndDate(month){ const [y,m]=month.split("-").map(Number); const last=new Date(y,m,0).getDate(); return `${month}-${String(last).padStart(2,'0')}`; }
// A report line renders as a plain two-cell row when it has no itemized detail behind it, or as a
// collapsible <details> row (still inside the same table) when it does — click to expand and see every
// payable/expense/journal/invoice/payroll record that rolled up into that head, instead of just the total.
function reportLineHTML(name, amount, detail, color){
  const style = color?` style="color:${color}"`:'';
  if(!detail || !detail.length){
    return `<tr><td class="muted">${esc(name)}</td><td class="num mono"${style}>${inr(amount)}</td></tr>`;
  }
  return `<tr><td colspan="2" style="padding:0 4px;">
    <details class="report-details">
      <summary class="report-line"><span class="name"><svg class="icon chev" style="width:10px;height:10px"><use href="#i-chevron-right"/></svg>${esc(name)}<span class="faint" style="font-weight:600;">(${detail.length})</span></span><span class="num mono"${style}>${inr(amount)}</span></summary>
      <div class="report-detail">${detail.map(d=>`<div class="report-detail-row"><span>${esc(d.desc)}${d.date?` <span class="faint">· ${fmtDateShort(d.date)}</span>`:''}</span><span class="amt mono">${inr(d.amount)}</span></div>`).join('')}</div>
    </details>
  </td></tr>`;
}
// computePL/computeBalanceSheet: see the server-backed versions in the data
// layer above — they replace this straight port, which read `payroll.history`
// directly and would silently shadow the real ones since function
// declarations later in the file win.
function acctReports(){
  const month = payroll.selectedMonth;
  const pl = computePL(month);
  const bs = computeBalanceSheet(month);
  const commissionRows = Object.keys(pl.commissionBySales).sort((a,b)=>pl.commissionBySales[b]-pl.commissionBySales[a]);
  return `
  <div class="toolbar"><select class="select-sm" onchange="setPayrollMonth(this.value)">${Object.keys(payroll.history).sort().reverse().map(m=>`<option value="${m}" ${m===month?'selected':''}>${MONTH_LABEL[m]}</option>`).join("")}</select><div></div></div>
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>P&amp;L is accrual-basis (income when invoiced, expenses when incurred) for ${MONTH_LABEL[month]}. Click any line to see the individual records behind it. Liabilities below are grouped by their own liability account and only count what's due by the report date — recording a payment in Payables pays one down (and moves the bank balance) without ever touching P&amp;L again, since the expense was already recognized when it was incurred. Sales don't draw a salary — they earn ${Math.round(SALES_COMMISSION_RATE*100)}% commission on every payment Finance approves, logged automatically as a Commission payable. Payroll paid out through HR isn't posted to the bank ledger yet, so cash balances reflect invoice payments, payable settlements, expenses, transfers and journal entries only.</div></div>
  <div class="grid-2">
    <div class="panel">
      <div class="panel-head"><h3>Profit &amp; Loss — ${MONTH_LABEL[month]}</h3><div class="sub">Accrual basis</div></div>
      <div class="table-wrap"><table class="data">
        <tbody>
          ${reportLineHTML("Income — Service Revenue", pl.invoicedIncome, pl.incomeDetail)}
          ${pl.journalIncome?`<tr><td class="muted">Other income (Journal)</td><td class="num mono">${inr(pl.journalIncome)}</td></tr>`:''}
          ${pl.lines.map(l=>reportLineHTML(l.name, l.amount, l.detail, "var(--neg)")).join("")}
          <tr class="total"><td>Total expenses</td><td class="num mono" style="color:var(--neg)">−${inr(pl.totalExpense)}</td></tr>
          <tr class="total"><td>Net profit</td><td class="num mono" style="color:${pl.netProfit>=0?'var(--pos)':'var(--neg)'}">${inr(pl.netProfit)}</td></tr>
        </tbody>
      </table></div>
      ${commissionRows.length?`<div class="report-subpanel">
        <div class="section-label">Commission earned by sales person — ${MONTH_LABEL[month]}</div>
        <div class="table-wrap"><table class="data"><tbody>
          ${commissionRows.map(name=>`<tr><td class="muted">${esc(name)}</td><td class="num mono">${inr(pl.commissionBySales[name])}</td></tr>`).join("")}
        </tbody></table></div>
      </div>`:''}
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Balance Sheet</h3><div class="sub">As of ${fmtDateShort(bs.asOf)}</div></div>
      <div class="table-wrap"><table class="data">
        <tbody>
          <tr class="total"><td colspan="2">Assets</td></tr>
          ${bs.cashAndBank.map(b=>`<tr><td class="muted">${esc(b.name)}</td><td class="num mono">${inr(b.balance)}</td></tr>`).join("")}
          ${reportLineHTML("Accounts Receivable", bs.receivable, bs.receivableDetail)}
          ${bs.otherAssetAdj?`<tr><td class="muted">Other assets (Journal)</td><td class="num mono">${inr(bs.otherAssetAdj)}</td></tr>`:''}
          <tr class="total"><td>Total assets</td><td class="num mono">${inr(bs.totalAssets)}</td></tr>
          <tr class="total"><td colspan="2">Liabilities</td></tr>
          ${bs.payableLines.map(l=>reportLineHTML(l.name, l.amount, l.detail)).join("")}
          ${reportLineHTML("Payroll Payable", bs.payrollPayable, bs.payrollPayableDetail)}
          ${reportLineHTML("Internal Loan", bs.internalLoan, bs.internalLoanDetail)}
          ${bs.journalLiabilityAdj?`<tr><td class="muted">Other liabilities (Journal)</td><td class="num mono">${inr(bs.journalLiabilityAdj)}</td></tr>`:''}
          <tr class="total"><td>Total liabilities</td><td class="num mono">${inr(bs.totalLiabilities)}</td></tr>
          <tr class="total"><td>Equity (Assets − Liabilities)</td><td class="num mono">${inr(bs.equity)}</td></tr>
        </tbody>
      </table></div>
    </div>
  </div>`;
}

/* ===================== LOGIN GATE =====================
   Real auth now lives server-side (server/src) — see public/login.html and
   public/js/auth.js. This just adapts the authenticated session into the
   {id,name,role,dept} shape applyCurrentUser()/isHRRole()/isSalesRole()/
   isStaffRole() already expect from a mock `employees` row, so the existing
   per-role nav/landing logic above keeps working unchanged until Phase 2
   replaces `employees` with real API data. */
let currentUser = null;
function applyCurrentUser(emp){
  currentUser = emp;
  const ini = initials(emp.name);
  document.getElementById('sidebar-avatar').textContent = ini;
  document.getElementById('sidebar-name').textContent = emp.name;
  document.getElementById('sidebar-role').textContent = emp.role;
  document.getElementById('topbar-avatar').textContent = ini;
}
function authUserToPreviewEmployee(u){
  const roles = u.roles || [];
  const isAdmin = roles.includes('ADMIN');
  const isHR = roles.includes('HR');
  const isSales = roles.includes('SALES') || roles.includes('SALES_HEAD');
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: isAdmin ? 'Administrator' : isHR ? 'HR Executive' : isSales ? 'Sales Executive' : (u.department || 'Team Member'),
    dept: isSales ? 'Sales' : (u.department || ''),
    isAdmin,
  };
}
function doLogout(){
  Auth.logout();
}

/* ===================== INIT =====================
   Phase 2: a login linked to a real Employee row (User.employeeId) now
   resolves to that ACTUAL record — not the synthetic preview shape above —
   so its id matches the "EMP-101" codes the rest of the HR module already
   keys everything by. Logins with no linked employee (e.g. a bare Admin
   account) still fall back to the synthetic mapping. */
Auth.init().then(async (authUser) => {
  let emp;
  if(authUser.employeeId){
    try{
      const { employee } = await apiJson("/api/hr/employees/me");
      emp = mapEmployee(employee);
      emp._dbId = employee.id;
      emp.isAdmin = (authUser.roles||[]).includes('ADMIN');
    }catch(err){ emp = authUserToPreviewEmployee(authUser); }
  } else {
    emp = authUserToPreviewEmployee(authUser);
  }
  // Raw backend roles — separate from isHRRole()/isSalesRole(), which match
  // on the display-only .role/.dept strings the HR preview logic uses. The
  // Finance data layer needs the real role list to know whether it's
  // talking to a Finance/Admin (full module) or Sales (narrow slice) login.
  emp.roles = authUser.roles || [];
  applyCurrentUser(emp);
  const crmContentJobs = [];
  const roles = emp.roles || [];
  if(emp.isAdmin || roles.includes('SALES') || roles.includes('SALES_HEAD')) crmContentJobs.push(loadCrmModule());
  if(emp.isAdmin || roles.includes('CONTENT')) crmContentJobs.push(loadContentModule());
  // Payment requests are a side feature for boot purposes: if their load fails
  // (e.g. migration not applied yet) every other module should still come up.
  await Promise.all([loadHrModule(), loadFinanceModule(), loadPaymentRequests().catch(err=>console.error("Payment requests failed to load", err)), loadWithdrawalRequests().catch(err=>console.error("Withdrawal requests failed to load", err)), loadMyPayroll().catch(err=>console.error("My payroll failed to load", err)), ...crmContentJobs]);
  nav.module = isLeadershipRole(emp) ? 'dashboard' : (isHRRole(emp) ? 'hr' : ((isStaffRole(emp) || isSalesRole(emp)) ? 'workspace' : 'dashboard'));
  const landingMod = visibleModules().find(m=>m.id===nav.module);
  nav.sub[nav.module] = (landingMod && landingMod.sub && landingMod.sub.length) ? landingMod.sub[0].id : (nav.sub[nav.module] || 'overview');
  document.getElementById('app-shell').hidden = false;
  render();
}).catch((err) => { console.error(err); /* Auth.init() already redirects to /login.html on failure */ });
