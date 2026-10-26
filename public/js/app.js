/* =============================================================================
   DESGRO MEDIA ERP — UI reference build. Single-file HTML/CSS/JS, in-memory
   data seeded on load. Sessions: Dashboard · HR · Marketing · Clients · Accounts.
   Swap the seed arrays + the CRUD functions below for real API calls to go live;
   the render layer above the data can stay as-is.
   ============================================================================= */

/* ===================== SHARED HELPERS ===================== */
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inr = n => "₹" + Math.round(Number(n)||0).toLocaleString("en-IN");
// Ad numbers can be tracked in a client's own currency (GCC clients). INR keeps the whole-rupee look; others show the
// ISO code with 2 decimals, since per-lead costs there are small.
const AD_CURRENCIES = ["INR","AED","SAR","QAR","KWD","BHD","OMR","USD"];
const AD_CURRENCY_NAMES = {INR:"Indian Rupee (₹)",AED:"UAE Dirham (AED)",SAR:"Saudi Riyal (SAR)",QAR:"Qatari Riyal (QAR)",KWD:"Kuwaiti Dinar (KWD)",BHD:"Bahraini Dinar (BHD)",OMR:"Omani Rial (OMR)",USD:"US Dollar (USD)"};
const adMoney = (n, cur) => (!cur || cur==="INR") ? inr(n) : cur+" "+(Number(n)||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
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
/* ---- Notifications (the bell) ---- */
let notifications = [], notifUnread = 0;
async function loadNotifications(){
  const r = await apiJson("/api/notifications");
  notifications = r.notifications; notifUnread = r.unread; renderBell();
}
function renderBell(){
  const b = document.getElementById("bell-badge"); if(!b) return;
  b.hidden = !notifUnread; b.textContent = notifUnread>9 ? "9+" : String(notifUnread);
  const p = document.getElementById("notif-panel"); if(!p || p.hidden) return;
  p.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border,#ddd);"><b style="font-size:13px;">Notifications</b>${notifUnread?`<button class="btn btn-sm ghost" onclick="markAllNotifRead()">Mark all read</button>`:''}</div>`
    + (notifications.length ? notifications.map(n=>`<div class="row-click" onclick="openNotif('${n.id}')" style="padding:10px 12px;border-bottom:1px solid var(--border,#eee);${n.readAt?'opacity:.6;':''}"><div style="font-size:13px;font-weight:${n.readAt?500:700};">${esc(n.title)}</div>${n.body?`<div class="faint" style="font-size:12px;">${esc(n.body)}</div>`:''}<div class="faint" style="font-size:11px;">${fmtDateShort(isoDate(n.createdAt))}</div></div>`).join("") : `<div class="empty" style="padding:18px;">No notifications yet.</div>`);
}
function toggleNotifPanel(ev){
  const p = document.getElementById("notif-panel"); if(!p) return;
  p.hidden = !p.hidden; if(!p.hidden) renderBell();
}
async function openNotif(id){
  const n = notifications.find(x=>x.id===id); if(!n) return;
  if(!n.readAt){ n.readAt = new Date().toISOString(); notifUnread = Math.max(0, notifUnread-1); Auth.apiFetch(`/api/notifications/${id}/read`, { method:"POST" }).catch(()=>{}); }
  document.getElementById("notif-panel").hidden = true; renderBell();
  const [mid, sid] = (n.link||"").split("/"); if(mid && sid) setSub(mid, sid);
}
async function markAllNotifRead(){
  notifications.forEach(n=>{ n.readAt = n.readAt || new Date().toISOString(); }); notifUnread = 0; renderBell();
  Auth.apiFetch("/api/notifications/read-all", { method:"POST" }).catch(()=>{});
}
document.addEventListener("click", e=>{ const p = document.getElementById("notif-panel"); if(p && !p.hidden && !e.target.closest("#bell-btn")) p.hidden = true; });
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
const ATTENDANCE_FROM_API = {PRESENT:"present", LATE:"late", HALF_DAY:"half", ABSENT:"absent", ON_LEAVE:"leave", WFH:"wfh", WFH_PARTIAL:"wfhp", UNPAID_LEAVE:"unpaid"};
const ATTENDANCE_TO_API = {present:"PRESENT", late:"LATE", half:"HALF_DAY", absent:"ABSENT", leave:"ON_LEAVE", wfh:"WFH", wfhp:"WFH_PARTIAL", unpaid:"UNPAID_LEAVE"};
// LeaveRequest.type doesn't round-trip through TITLECASE either (WFH is an
// all-caps abbreviation, not a title-cased word).
const LEAVE_TYPE_FROM_API = {CASUAL_SICK:"Casual/Sick", WFH:"WFH", PARTIAL_WFH:"Partially Paid WFH (75% payout)", UNPAID_LEAVE:"Unpaid Leave"};
const LEAVE_TYPE_TO_API = {"Casual/Sick":"CASUAL_SICK", WFH:"WFH", "Partially Paid WFH (75% payout)":"PARTIAL_WFH", "Unpaid Leave":"UNPAID_LEAVE"};
const isoDate = s => s ? String(s).slice(0,10) : s;

function mapEmployee(e){
  return {
    id: e.employeeCode, _dbId: e.id, name: e.name, dept: e.dept, role: e.role,
    dob: isoDate(e.dob), joined: isoDate(e.joinedAt), email: e.email,
    phone: e.phone || "", salary: Number(e.salary),
    empType: TITLECASE_FROM_API(e.empType),
    employmentStatus: TITLECASE_FROM_API(e.employmentStatus),
    leavingDate: isoDate(e.leavingDate), noticeGivenDate: isoDate(e.noticeGivenDate), noticeNote: e.noticeNote || "",
    hasErpAccess: !!e.hasErpAccess, erpRoles: e.erpRoles || [], userId: e.userId || null,
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
    installments: a.installments, deductFromMonth: a.deductFromMonth||"", status: TITLECASE_FROM_API(a.status),
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
  return { id:c.id, posId:c.positionId, name:c.name, phone:c.phone||"", email:c.email||"", stage:TITLECASE_FROM_API(c.stage), appliedDate:isoDate(c.appliedDate), archived:!!c.archived, hasResume:!!c.resumeFilename };
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
    payments:(r.payments||[]).map(p=>({id:p.id, amount:Number(p.amount), date:isoDate(p.paidDate), note:p.note, locked:false})),
    schedule:r.schedule||{scheduled:false,instalments:[],nextDue:null,overpayment:0} };
}

async function apiJson(url, opts){
  const res = await Auth.apiFetch(url, opts);
  const data = await res.json().catch(()=>({}));
  if(!res.ok){ const err = new Error(data.error || "Request failed"); err.data = data; throw err; }
  return data;
}

/* ===================== HR MODULE — LOADERS ===================== */
let hrPolicy = { weeklyOff:0, paidLeavesPerMonth:1, paidWfhPerMonth:1, carryForwardMaxDays:0, carryForwardStartMonth:null, notes:"", holidays:[] };
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
    carryForwardMaxDays: policy.carryForwardMaxDays||0, carryForwardStartMonth: policy.carryForwardStartMonth||null,
    notes: policy.generalNotes || "",
    payrollDefaultSplit: policy.payrollDefaultSplit || [{percent:100, day:0}],
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
  const { byEmployee, caps, wfhCaps } = await apiJson(`/api/hr/attendance/summary?month=${month}`);
  const byCode = {};
  Object.entries(byEmployee).forEach(([dbId, counts])=>{ byCode[employeeCodeByDbId[dbId] || dbId] = counts; });
  // Server-computed effective paid-leave cap (org cap + carried-forward + HR adjustments) where it differs.
  Object.entries(caps||{}).forEach(([dbId, cap])=>{ const code = employeeCodeByDbId[dbId] || dbId; byCode[code] = { leave:0, wfh:0, ...(byCode[code]||{}), leaveCap:cap }; });
  Object.entries(wfhCaps||{}).forEach(([dbId, cap])=>{ const code = employeeCodeByDbId[dbId] || dbId; byCode[code] = { leave:0, wfh:0, ...(byCode[code]||{}), wfhCap:cap }; });
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
      loadMyLeaveBalance().catch(()=>{});
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
// UTC throughout: stepping a local-midnight date and reading it back with toISOString() gives the PREVIOUS day in India, so holidays
// were matched against the wrong date.
function workingDaysInRange(startStr, endStr){
  let count = 0;
  for(let d = new Date(startStr+"T00:00:00Z"), end = new Date(endStr+"T00:00:00Z"); d<=end; d = new Date(d.getTime()+86400000)){
    if(d.getUTCDay()!==hrPolicy.weeklyOff && !isHolidayDate(d.toISOString().slice(0,10))) count++;
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
  return Math.max(0, (counts?.leave||0) - (counts?.leaveCap ?? hrPolicy.paidLeavesPerMonth)) + (counts?.unpaidLeave||0);
}
// WFH days beyond the monthly paid-WFH allowance, plus every Partially Paid WFH day — mirrors computeWfhExcessDays, paid at 75% (a 25% cut)
// rather than a full Loss of Pay.
function wfhExcessDaysFor(empId, month){
  const counts = attendanceMonthSummary[month] && attendanceMonthSummary[month][empId];
  return Math.max(0, (counts?.wfh||0) - (counts?.wfhCap ?? hrPolicy.paidWfhPerMonth)) + (counts?.partialWfh||0);
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
// All Clients filters (client-side, AND-combined with the Onboarded month). "All" = no filter.
let clientsFilters = { manager:"All", sales:"All", service:"All", status:"All" };
function setClientsFilter(key, v){ clientsFilters[key] = v; render(); }
function clearClientsFilters(){ clientsMonthFilter = "All"; clientsFilters = { manager:"All", sales:"All", service:"All", status:"All" }; render(); }
function clientsFilterSelect(label, key, values){
  const cur = clientsFilters[key];
  const opts = values.includes(cur) || cur==="All" ? values : [...values, cur];
  return `<div class="filter-group"><span class="filter-label">${label}</span><select class="select-sm" onchange="setClientsFilter('${key}',this.value)"><option value="All">All</option>${opts.map(v=>`<option value="${esc(v)}" ${v===cur?'selected':''}>${esc(v)}</option>`).join('')}</select></div>`;
}
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
let commissionsMonthFilter = TODAY.slice(0,7);
function setCommissionsMonthFilter(v){ commissionsMonthFilter = v; commissionDetails = {}; loadCommissionSummary().then(render).catch(err=>toast(err.message||"Couldn't load commissions")); }
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
// `clients` keeps archived rows too (invoices, quotes and tasks still resolve their client through
// clientById). Every working list, count and dropdown goes through this instead.
const liveClients = () => clients.filter(c=>!c.archivedAt);
// Clickable client name → that client's detail page. A missing client record (deleted, or an
// informal name that never mapped to one) renders as plain text, never a dead link.
function clientLink(id, fallback){
  const c = id ? clientById(id) : null;
  if(!c) return esc(fallback || "—");
  return `<a class="client-link" href="#" onclick="event.stopPropagation();event.preventDefault();openClientDetail('${c.id}')">${esc(c.name)}</a>`;
}
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
    archivedAt: c.archivedAt ? isoDate(c.archivedAt) : null,
  };
}
async function loadClients(){ clients = (await apiJson("/api/crm/clients")).clients.map(mapClient); }
async function loadEmployeeDirectory(){
  const { employees: list } = await apiJson("/api/hr/employees/directory");
  employeeDirectory = list.map(e=>({ id: e.employeeCode, _dbId: e.id, name: e.name, dept: e.dept, userId: e.userId||null }));
}

async function loadCrmModule(){
  // Let every loader finish even if one fails (a partial CRM beats none), then report the first failure.
  const results = await Promise.allSettled([loadClients(), loadLeads(), loadQuotes(), loadTasks(), loadServiceBoards(), loadEmployeeDirectory()]);
  const failed = results.find(r=>r.status==="rejected");
  if(failed) throw failed.reason;
}
async function loadContentModule(){
  // Content-only logins (e.g. SMM) can't call the HR employee list; the name-only directory feeds the assignee pickers.
  await Promise.all([loadContentItems(), loadMetaCampaigns(), loadOwnAdMetrics(), loadEmployeeDirectory().catch(err=>console.error("Employee directory failed to load", err))]);
}
function contentAssignees(){ return employees.length ? employees : employeeDirectory; }

/* ===================== MARKETING ===================== */
const STAGES = ['Idea','Scripting','Production','Edit','Graphic','Review','Scheduled','Published'];
const PLATFORMS = [
  {key:'Instagram', icon:'i-instagram'}, {key:'LinkedIn', icon:'i-linkedin'},
  {key:'YouTube', icon:'i-youtube'}, {key:'Facebook', icon:'i-facebook'}, {key:'Blog', icon:'i-globe'},
];

let contentItems = [];
let contentPlatformFilter = 'All';
function mapContentItem(c){
  return { id:c.id, title:c.title, type:c.type, platforms:c.platforms||[], assignee:c.assignee||'', stage:TITLECASE_FROM_API(c.stage), due:isoDate(c.dueAt), notes:c.notes||'' };
}
// Cards assigned to the signed-in employee — open to everyone (the full board is Admin/Content only).
let myContentItems = [];
async function loadMyContentItems(){ myContentItems = (await apiJson("/api/content/items/mine")).items.map(mapContentItem); }
async function loadContentItems(){ contentItems = (await apiJson("/api/content/items")).items.map(mapContentItem); }

let metaAdsCampaigns = [];
function mapMetaCampaign(c){
  return { id:c.id, name:c.name, objective:c.objective, platform:c.platform, status:TITLECASE_FROM_API(c.status), spend:Number(c.spend), impressions:c.impressions, clicks:c.clicks, leads:c.leads, startDate:isoDate(c.startAt) };
}
async function loadMetaCampaigns(){ metaAdsCampaigns = (await apiJson("/api/content/meta-campaigns")).campaigns.map(mapMetaCampaign); }
// DesGro's own daily Meta ad numbers (Marketing > Meta Ads > Daily Tracking). CPL/CPA/ROAS come from the
// server (null when there's nothing to divide by) so every screen shows the same figures.
let ownAdMetrics = [];
async function loadOwnAdMetrics(){ ownAdMetrics = (await apiJson("/api/content/own-ad-metrics")).metrics; }
function adMetrics(c){
  const ctr = c.impressions ? (c.clicks/c.impressions*100) : 0;
  const cpc = c.clicks ? c.spend/c.clicks : 0;
  const cpl = c.leads ? c.spend/c.leads : 0;
  return {...c, ctr, cpc, cpl};
}

const LEAD_SOURCES = ["Meta","Organic","References"];
let marketingLeads = [];
function mapLead(l){
  return { id:l.id, name:l.name, phone:l.phone||"", email:l.email||"", source:l.source, serviceInterested:l.serviceInterested, leadOwner:l.leadOwner||"", createdDate:isoDate(l.createdAt), status:TITLECASE_FROM_API(l.status), stage:TITLECASE_FROM_API(l.stage), lostReason:l.lostReason||null, lostNote:l.lostNote||null, stageSetBy:l.stageSetBy||null, paidTotal:Number(l.paidTotal||0), convertedClientId:l.convertedClientId||null, notes:l.notes||"" };
}
let leadConversionThreshold = 5000;
async function loadLeads(){
  const [d, settings] = await Promise.all([apiJson("/api/crm/leads"), apiJson("/api/crm/lead-settings").catch(()=>null)]);
  marketingLeads = d.leads.map(mapLead);
  if(settings) leadConversionThreshold = Number(settings.conversionThreshold);
}
// Pipeline stages. "Won" is only ever reached by converting the lead into a client (today: quote -> invoice),
// never by moving a card; "Lost" needs a reason. The server enforces both.
const LEAD_STAGES = ["New","Contacted","Meeting","Proposal Sent","Negotiation","Won","Lost"];
const LEAD_OPEN_STAGES = ["New","Contacted","Meeting","Proposal Sent","Negotiation"];
const LEAD_STAGE_KIND = {"New":"neutral","Contacted":"blue","Meeting":"blue","Proposal Sent":"blue","Negotiation":"warn","Won":"pos","Lost":"neg"};
const LEAD_LOST_REASONS = ["Budget","Went with a competitor","No response","Not a fit","Other"];
let leadsView = "board";
function setLeadsView(v){ leadsView = v; render(); }
// A converted lead is Won no matter what; a lead the old status field already marked Lost shows as Lost even
// before the one-off backfill has staged it.
function leadStage(l){
  if(l.convertedClientId) return "Won";
  if(l.stage==="Lost" || (l.status==="Lost" && !l.stageSetBy)) return "Lost";
  return l.stage || "New";
}
// Reps work their own leads; Admin / Sales Head any. (The server enforces this; the UI just hides what won't work.)
function canWorkLead(l){
  if(!currentUser) return false;
  if(currentUser.isAdmin || (currentUser.roles||[]).includes('SALES_HEAD')) return true;
  return !!l.leadOwner && l.leadOwner===currentUser.name;
}
async function setLeadStage(id, stage){
  const l = leadById(id);
  if(!l || l.convertedClientId || !canWorkLead(l)) { render(); return; }
  if(stage==="Lost"){ render(); openMarkLeadLost(id); return; }
  try{
    await apiJson(`/api/crm/leads/${id}/stage`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ stage: TITLECASE_TO_API(stage) }) });
    await loadLeads();
    toast(l.name+" moved to "+stage);
  }catch(err){ toast(err.message || "Couldn't move lead"); }
  render();
}
function openMarkLeadLost(id){
  const l = leadById(id);
  if(!l || l.convertedClientId || !canWorkLead(l)) return;
  showModal(`
    <div class="modal-head"><h3>Mark as lost — ${esc(l.name)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-lead-lost"><div class="modal-body">
      <div><label class="field-label">Reason</label><select class="field-input" name="reason">${LEAD_LOST_REASONS.map(r=>`<option>${esc(r)}</option>`).join('')}</select></div>
      <div><label class="field-label">Note</label><input class="field-input" name="note" maxlength="500" placeholder="Optional"></div>
      <div class="subtext">You can move it back into the pipeline later if it comes back.</div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Mark lost</button></div></div>
    </form>`);
  document.getElementById("f-lead-lost").addEventListener("submit", async e=>{
    e.preventDefault(); const f = new FormData(e.target);
    try{
      await apiJson(`/api/crm/leads/${id}/lost`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ reason:f.get("reason"), note:f.get("note") }) });
      await loadLeads(); toast(l.name+" marked lost"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't mark lost"); }
  });
}
// ---- Lead advance payments, convert, threshold ----
// A lead payment is only a record: it moves no money. It waits for an invoice, then becomes a pending payment on
// it that Finance approves like any other (Accounts > Payment Receipts) — bank entry, commission and revenue
// follow the received date Finance sets. The server enforces all of this; these screens just explain it.
const LEAD_PAYMENT_MODES = [["BANK_TRANSFER","Bank transfer"],["UPI","UPI"],["CASH","Cash"],["CHEQUE","Cheque"]];
const LEAD_PAYMENT_STATUS = {AWAITING_INVOICE:["Awaiting invoice","warn"], ON_INVOICE_PENDING:["With Finance","blue"], APPROVED:["Approved","pos"]};
const isAdminUser = () => !!(currentUser && currentUser.isAdmin);
const localToday = ()=>{ const d=new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); };
async function openRecordLeadPayment(id){
  const l = leadById(id);
  if(!l || l.convertedClientId || !canWorkLead(l)) return;
  let hist = [];
  try{ hist = (await apiJson(`/api/crm/leads/${id}/payments`)).payments; }catch(err){ toast(err.message || "Couldn't load payments"); return; }
  const paid = hist.reduce((a,p)=>a+p.amount,0), today = localToday();
  showModal(`
    <div class="modal-head"><h3>Record payment — ${esc(l.name)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-lead-payment"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Paid so far: <b>${inr(paid)}</b>. When total payments reach <b>${inr(leadConversionThreshold)}</b> this lead becomes a client automatically. <b>This only records the payment</b> — nothing is booked until an invoice is raised and Finance approves it.</div></div>
      ${hist.length?`<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Mode</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead><tbody>${hist.map(p=>{ const st=LEAD_PAYMENT_STATUS[p.status]; return `<tr><td class="muted">${fmtDateShort(p.paymentDate)}</td><td class="muted">${esc(p.modeLabel)}${p.note?`<div class="subtext">${esc(p.note)}</div>`:''}</td><td class="num mono">${inr(p.amount)}</td><td>${pill(st[0],st[1])}${p.invoiceNo?`<div class="subtext mono">${esc(p.invoiceNo)}</div>`:''}</td><td>${p.status==='AWAITING_INVOICE'?`<button type="button" class="btn btn-sm ghost" title="Remove this entry" onclick="deleteLeadPayment('${l.id}','${p.id}')"><svg class="icon" style="width:11px;height:11px"><use href="#i-x"/></svg></button>`:''}</td></tr>`; }).join('')}</tbody></table></div>`:''}
      <div class="field-row">
        <div><label class="field-label">Amount (₹)</label><input class="field-input" type="number" min="0.01" step="0.01" name="amount" required></div>
        <div><label class="field-label">Date received</label><input class="field-input" type="date" name="paymentDate" value="${today}" max="${today}" required></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">Mode</label><select class="field-input" name="mode">${LEAD_PAYMENT_MODES.map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></div>
        <div><label class="field-label">Note</label><input class="field-input" name="note" maxlength="500" placeholder="e.g. Token advance"></div>
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Close</button><button type="submit" class="btn primary">Record payment</button></div></div>
    </form>`, true);
  document.getElementById("f-lead-payment").addEventListener("submit", async e=>{
    e.preventDefault(); const f = new FormData(e.target);
    try{
      const r = await apiJson(`/api/crm/leads/${id}/payments`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ amount:Number(f.get("amount")), paymentDate:f.get("paymentDate"), mode:f.get("mode"), note:f.get("note") }) });
      await loadLeads(); if(r.converted) await loadClients();
      closeModal();
      toast(r.converted ? l.name+" has paid "+inr(r.paidTotal)+" — converted to a client automatically" : "Payment recorded · "+inr(Math.max(0,leadConversionThreshold-r.paidTotal))+" more auto-converts");
      render();
    }catch(err){ toast(err.message || "Couldn't record payment"); }
  });
}
async function deleteLeadPayment(leadId, paymentId){
  try{
    await apiJson(`/api/crm/leads/${leadId}/payments/${paymentId}`, { method:"DELETE" });
    await loadLeads(); toast("Payment entry removed"); closeModal(); render(); openRecordLeadPayment(leadId);
  }catch(err){ toast(err.message || "Couldn't remove"); }
}
function openConvertLead(id){
  const l = leadById(id);
  if(!l || l.convertedClientId || !canWorkLead(l)) return;
  const today = localToday();
  showModal(`
    <div class="modal-head"><h3>Convert to client — ${esc(l.name)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-convert-lead"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>You can convert any time, paid or not. ${l.paidTotal>0?`The <b>${inr(l.paidTotal)}</b> they've paid so far goes onto their first invoice for Finance to approve.`:''} If a client with this name already exists, the lead is linked to them instead of creating a duplicate.</div></div>
      <div><label class="field-label">Client name</label><input class="field-input" name="name" maxlength="200" required value="${esc(l.name)}"></div>
      <div class="field-row">
        <div><label class="field-label">Industry</label><input class="field-input" name="industry" maxlength="100" placeholder="e.g. FMCG"></div>
        <div><label class="field-label">City</label><input class="field-input" name="city" maxlength="100" placeholder="e.g. Kozhikode, India"></div>
      </div>
      <div><label class="field-label">Services</label><div class="check-row">${SERVICE_DEPARTMENTS.map(d=>`<label class="check-chip"><input type="checkbox" name="services" value="${esc(d)}" ${d===l.serviceInterested?'checked':''}>${esc(d)}</label>`).join('')}</div></div>
      <div class="field-row">
        <div><label class="field-label">Billing</label><select class="field-input" name="billingType"><option value="PREPAID">Prepaid — amount agreed up front</option><option value="POSTPAID">Postpaid — finalized once work is complete</option></select></div>
        <div><label class="field-label">Onboarded</label><input class="field-input" type="date" name="onboardedAt" value="${today}" max="${today}" required></div>
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Convert to client</button></div></div>
    </form>`, true);
  document.getElementById("f-convert-lead").addEventListener("submit", async e=>{
    e.preventDefault(); const f = new FormData(e.target);
    try{
      const r = await apiJson(`/api/crm/leads/${id}/convert`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ name:f.get("name"), industry:f.get("industry"), city:f.get("city"), services:f.getAll("services"), billingType:f.get("billingType"), onboardedAt:f.get("onboardedAt") }) });
      await Promise.all([loadLeads(), loadClients()]);
      closeModal(); toast(l.name+(r.created?" converted to a new client":" linked to an existing client")); render();
    }catch(err){ toast(err.message || "Couldn't convert"); }
  });
}
function openLeadThresholdSetting(){
  if(!isAdminUser()) return;
  showModal(`
    <div class="modal-head"><h3>Auto-convert threshold</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-lead-threshold"><div class="modal-body">
      <div class="field-label">Convert a lead to a client once it has paid (₹)</div>
      <input class="field-input" type="number" min="1" step="1" name="threshold" required value="${leadConversionThreshold}">
      <div class="subtext" id="threshold-hint"></div>
      <div class="subtext">Lowering it converts any lead that has already paid at least the new amount. Only Admin can change this; every change is logged.</div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save</button></div></div>
    </form>`);
  const f = document.getElementById("f-lead-threshold");
  const hint = ()=>{ const v=Number(f.threshold.value); const n = v>0 ? marketingLeads.filter(l=>!l.convertedClientId && l.paidTotal>0 && l.paidTotal>=v).length : 0; document.getElementById("threshold-hint").textContent = n ? `${n} lead${n===1?'':'s'} already paid this much and will convert now.` : ''; };
  f.threshold.addEventListener("input", hint); hint();
  f.addEventListener("submit", async e=>{
    e.preventDefault();
    try{
      const r = await apiJson("/api/crm/lead-settings", { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ conversionThreshold:Number(f.threshold.value) }) });
      await Promise.all([loadLeads(), loadClients()]);
      closeModal(); toast("Threshold set to "+inr(r.conversionThreshold)+(r.converted.length?` · ${r.converted.length} lead${r.converted.length===1?'':'s'} converted`:'')); render();
    }catch(err){ toast(err.message || "Couldn't save"); }
  });
}
// What a client's lead paid before becoming a client, and where each advance is now (client detail page).
let clientLeadAdvances = {};
async function loadClientLeadAdvances(id){
  try{ clientLeadAdvances[id] = await apiJson(`/api/crm/clients/${id}/lead-advances`); }catch(err){ clientLeadAdvances[id] = null; }
  if(nav.detail && nav.detail.type==='client' && nav.detail.id===id) render();
}
function leadAdvanceBannerHTML(c){
  const d = clientLeadAdvances[c.id];
  if(!d || !d.payments.length) return '';
  const t = d.totals, parts = [];
  if(t.awaitingInvoice>0) parts.push(`<b>${inr(t.awaitingInvoice)}</b> waiting for their next invoice`);
  if(t.onInvoicePending>0) parts.push(`<b>${inr(t.onInvoicePending)}</b> with Finance for approval (Accounts → Payment Receipts)`);
  if(t.approved>0) parts.push(`<b>${inr(t.approved)}</b> approved`);
  return `<div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-coins"/></svg><div><b>Advance paid while they were a lead:</b> ${parts.join(' · ')}.</div></div>`;
}
// Finance: advances leads have paid that haven't reached the books yet, so none is forgotten. Read-only.
let leadAdvances = null;
async function loadLeadAdvances(){ leadAdvances = await apiJson("/api/finance/lead-advances"); }
function leadAdvancesPanelHTML(){
  const rows = leadAdvances ? leadAdvances.advances : [];
  if(!rows.length) return '';
  const total = rows.reduce((a,r)=>a+r.amount,0), old = rows.filter(r=>r.olderThanApprovalWindow).length;
  return `<div class="panel">
    <div class="panel-head"><div><h3>Lead advances not yet on the books</h3><div class="sub">Money leads paid before becoming clients — ${rows.length} entr${rows.length===1?'y':'ies'}, ${inr(total)}. Nothing is booked until an invoice exists and you approve it above.</div></div>${old?pill(old+' older than '+leadAdvances.maxBackdateDays+' days','warn'):''}</div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Lead / client</th><th class="num">Amount</th><th>Reported</th><th>Mode</th><th>Sales person</th><th>Where it is</th></tr></thead>
      <tbody>${rows.map(r=>{ const st=LEAD_PAYMENT_STATUS[r.status]; return `<tr><td><div style="font-weight:700;font-size:13px;">${esc(r.lead.name)}</div><div class="subtext">${r.clientId?`Client: ${clientLink(r.clientId, r.clientName||'client')}`:'Not a client yet'}</div></td><td class="num mono">${inr(r.amount)}</td><td class="muted">${fmtDateShort(r.reportedDate)}${r.olderThanApprovalWindow?`<div class="subtext" style="color:var(--warn);">${r.ageDays} days old</div>`:''}</td><td class="muted">${esc(r.mode)}</td><td class="muted">${esc(r.salesPerson)}</td><td>${pill(st[0],st[1])}${r.invoiceNo?`<div class="subtext mono">${esc(r.invoiceNo)}</div>`:''}</td></tr>`; }).join('')}</tbody>
    </table></div>
  </div>`;
}
function goToClient(id){ setSub('clients','all'); openClientDetail(id); }
// Stage control: a dropdown for leads you can work, a plain pill otherwise (Won/Lost-by-someone-else, other reps' leads).
function leadStageControl(l){
  const stage = leadStage(l);
  if(l.convertedClientId || !canWorkLead(l)) return pill(stage, LEAD_STAGE_KIND[stage]);
  const opts = (stage==='Lost' ? ["Lost"] : []).concat(LEAD_OPEN_STAGES, stage==='Lost' ? [] : ["Lost"]);
  return `<select class="select-sm" onchange="setLeadStage('${l.id}', this.value)" title="Move along the pipeline">${opts.map(o=>`<option value="${o}" ${o===stage?'selected':''}>${o==='Lost'&&stage!=='Lost'?'Lost…':o}</option>`).join('')}</select>`;
}
function leadCardHTML(l){
  const stage = leadStage(l), claimable = !l.leadOwner && currentUser && isSalesRole(currentUser);
  return `
  <div class="card" style="cursor:default;">
    <div class="card-title">${esc(l.name)}</div>
    <div class="card-meta"><span class="tag type">${esc(l.serviceInterested)}</span><span class="tag">${esc(l.source)}</span></div>
    ${l.phone?`<div class="subtext mono"><a href="tel:${esc(l.phone)}" style="color:inherit;text-decoration:none;">${esc(l.phone)}</a></div>`:''}
    ${stage==='Lost' && l.lostReason ? `<div class="subtext">Lost — ${esc(l.lostReason)}${l.lostNote?': '+esc(l.lostNote):''}</div>` : ''}
    <div class="card-foot"><span class="assignee">${l.leadOwner?`<span class="mini-avatar sm">${initials(l.leadOwner)}</span>${esc(l.leadOwner)}`:pill('Open','warn')}</span><span class="due">${fmtDateShort(l.createdDate)}</span></div>
    ${l.paidTotal>0 ? `<div style="font-size:11.5px;color:var(--ink-soft);"><b class="mono" style="color:var(--ink);">${inr(l.paidTotal)}</b> paid${l.convertedClientId?'':` · <span class="faint">${inr(Math.max(0,leadConversionThreshold-l.paidTotal))} more auto-converts</span>`}</div>` : ''}
    ${(!l.convertedClientId && canWorkLead(l)) ? `<div class="card-move">${leadStageControl(l)}<button type="button" class="card-edit" title="Edit lead" onclick="openEditLead('${l.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg></button></div>
    ${(!l.convertedClientId && canWorkLead(l) && isSalesRole(currentUser)) ? `<button type="button" class="btn btn-sm ghost" style="justify-content:center;" onclick="openLogSalesMeeting('${l.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-calendar"/></svg>Log meeting</button>` : ''}
    <div style="display:flex;gap:6px;">${stage!=='Lost'?`<button type="button" class="btn btn-sm ghost" style="flex:1;justify-content:center;" onclick="openRecordLeadPayment('${l.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-coins"/></svg>Payment</button>`:''}<button type="button" class="btn btn-sm ghost" style="flex:1;justify-content:center;" onclick="openConvertLead('${l.id}')">Convert</button></div>` : ''}
    ${l.convertedClientId ? `<button type="button" class="btn btn-sm ghost" style="justify-content:center;" onclick="goToClient('${l.convertedClientId}')">Open client</button>` : ''}
    ${claimable ? `<button type="button" class="btn btn-sm primary" style="justify-content:center;" onclick="assignLeadToMe('${l.id}')">Assign to me</button>` : ''}
  </div>`;
}

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
// Assignment is matched by login ID, never by display name.
function isMyTask(t){ return !!currentUser && !!currentUser.userId && t.assigneeUserId===currentUser.userId; }
function assigneeFromSelect(el){ const o=el.options[el.selectedIndex]; return { assignedTo:o.value, assigneeUserId:o.dataset.uid||undefined }; }
// A plain Employee can't load the Clients list, so the client name travels with the task itself.
function taskClientName(t){ const c = clientById(t.clientId); return (c&&c.name) || t.clientName || "Client"; }
function mapTask(t){
  return {
    id: t.id, clientId: t.clientId, title: t.title, assignedTo: t.assignedTo||"", assigneeUserId: t.assigneeUserId||null, clientName: (t.client&&t.client.name)||"",
    due: isoDate(t.dueAt), status: TASK_STATUS_FROM_API[t.status] || t.status,
    revisions: t.revisions, doneDate: t.doneAt ? isoDate(t.doneAt) : undefined,
    attachments: (t.attachments||[]).map(a=>({id:a.id, name:a.name, size:a.size, addedDate:isoDate(a.addedAt)})),
    // Service-board cards (Client > Services); all empty on an ordinary task.
    service: t.service||null, stage: t.stage||null, type: t.taskType||'', platforms: t.platforms||[], start: t.startAt ? isoDate(t.startAt) : '', maxDays: t.maxDays||null,
    cycle: t.cycle||null, retained: !!t.retained, project: t.projectId||null, projectName: t.projectName||'', projectType: t.projectKind||'', clientAssigned: !!t.clientAssigned, notes: t.notes||'',
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
// What to show as a payable's category/liability account: the real Chart-of-Accounts account it sits
// on, falling back to the legacy name guess only for old rows that couldn't be matched.
function payableAccountLabel(p){ return p.accountName || liabilityAccountFor(p.category); }
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
    id: p.id, category: TITLECASE_FROM_API(p.category), accountId: p.accountId || "", accountName: p.account ? p.account.name : "",
    payee: p.payee, salesPerson: p.salesPerson || undefined,
    amount: Number(p.amount), due: isoDate(p.dueAt), createdAt: isoDate(p.createdAt),
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
async function loadPayables(){
  payables = (await apiJson("/api/finance/payables")).payables.map(mapPayable);
  // Commission entries are Payables, so any payment/delete here changes the commission numbers too.
  if(isFinanceAdminUser(currentUser)) await loadCommissionSummary();
}
// Sales Commissions page numbers (previous balance / earned / paid / balance / entries) are computed
// on the server from the real commission + payment records for the chosen period — see
// getCommissionSummary(). The browser only displays them.
let commissionSummary = { period:"all", months:[], totals:{earned:0,paid:0,balance:0,entries:0,salesPersons:0}, rows:[] };
const commissionPeriod = () => commissionsMonthFilter==="All" ? "all" : commissionsMonthFilter==="Today" ? "today" : commissionsMonthFilter;
async function loadCommissionSummary(){
  commissionSummary = await apiJson(`/api/finance/commissions/summary?period=${encodeURIComponent(commissionPeriod())}`);
  // Any expanded sales person's breakdown follows the same filter / data change.
  await Promise.all([...openCommissionPeople].map(n=>loadCommissionDetail(n).catch(()=>{})));
}
// Expanded sales person panel — summary, clients and transactions all come from one server response.
let commissionDetails = {}, openCommissionPeople = new Set(), commissionMonthOpen = {};
async function loadCommissionDetail(name){
  commissionDetails[name] = await apiJson(`/api/finance/commissions/person?salesPerson=${encodeURIComponent(name)}&period=${encodeURIComponent(commissionPeriod())}`);
}
function onCommissionToggle(el, i){
  const r = commissionSummary.rows[i]; if(!r) return;
  if(el.open){ openCommissionPeople.add(r.salesPerson); if(!commissionDetails[r.salesPerson]) loadCommissionDetail(r.salesPerson).then(render).catch(err=>toast(err.message||"Couldn't load the breakdown")); }
  else openCommissionPeople.delete(r.salesPerson);
}
function onCommissionMonthToggle(el, key){ commissionMonthOpen[key] = el.open; }
function toggleCommissionClient(key){ const el=document.getElementById(key); if(el) el.style.display = el.style.display==='none' ? '' : 'none'; }
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
let targetsMonth = TODAY.slice(0,7), targetsView = null;
async function loadSalesPolicy(){ salesPolicy = await apiJson("/api/finance/sales-policy"); }
async function loadSalesTargets(){ salesTargets = (await apiJson("/api/finance/sales-targets")).rows; await loadTargetsView(); }
// The Sales Commissions "Monthly sales target & bonus" table has its own month picker (default: this
// month); the shared salesTargets above stays on the current month for the dashboards.

async function loadTargetsView(){
  targetsView = targetsMonth===TODAY.slice(0,7) ? null : (await apiJson("/api/finance/sales-targets?month="+targetsMonth)).rows;
}
function setTargetsMonth(m){ targetsMonth = m; loadTargetsView().then(render).catch(err=>toast(err.message||"Couldn't load that month")); }
function targetsMonthOptions(){
  const months = new Set([targetsMonth]);
  const [y,m] = TODAY.slice(0,7).split('-').map(Number);
  for(let i=0;i<12;i++){ const d=new Date(y,m-1-i,1); months.add(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')); }
  (commissionSummary.months||[]).forEach(x=>months.add(x));
  return [...months].sort().reverse().map(x=>`<option value="${x}" ${x===targetsMonth?'selected':''}>${monthLabel(x)}</option>`).join('');
}

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
      ${latest.wfhDeduction>0?`<div class="calc-line" style="padding-left:14px;"><span class="faint" style="font-size:12.5px;">WFH — ${latest.wfhExcessDays} day${latest.wfhExcessDays===1?"":"s"} paid at 75% (beyond your paid WFH allowance or Partially Paid WFH)</span><span class="mono faint" style="font-size:12.5px;">−${inr(latest.wfhDeduction)}</span></div>`:""}
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
    <div class="table-wrap"><table class="data"><thead><tr><th>Month</th><th class="num">Salary</th><th class="num">Pay cuts</th><th class="num">Final salary</th><th>Status</th><th>Payout schedule</th></tr></thead>
      <tbody>${myPayroll.map(r=>{ const cuts=r.lopDeduction+(r.wfhDeduction||0); return `<tr><td>${esc(MONTH_LABEL[r.month]||r.month)}</td><td class="num mono">${inr(r.gross)}</td><td class="num mono ${cuts>0?'warn':'faint'}">${cuts>0?'−'+inr(cuts):'—'}</td><td class="num mono" style="font-weight:700;">${inr(r.net)}</td><td>${pill(r.payStatus,statusKind(r.payStatus))}</td><td>${(r.schedule&&r.schedule.instalments.length)?r.schedule.instalments.map(i=>`<div style="font-size:12px;white-space:nowrap;">${inr(i.amount)} · ${i.status==='Paid'?'paid '+fmtDateShort(i.paidDate||i.dueDate):(i.status==='Overdue'?'overdue, due ':'due ')+fmtDateShort(i.dueDate)}</div>`).join(''):'<span class="faint">—</span>'}${r.schedule&&r.schedule.overpayment>0?`<div class="subtext">Overpaid ${inr(r.schedule.overpayment)} — HR will resolve</div>`:''}</td></tr>`; }).join("")}</tbody>
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

// Category options for a payable — Liability accounts only, main accounts with their sub-accounts
// indented beneath (same shape as expenseCoaOptions). The server re-validates the account is a Liability.
function payableCoaOptions(selectedId){
  const opts = [];
  chartOfAccounts.filter(c=>!c.parent && c.type==="Liability").forEach(m=>{
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

async function loadFinancePayroll(){
  await loadEmployees();
  await loadArchivedEmployees();
  const [y,m] = TODAY.slice(0,7).split('-').map(Number);
  const d = new Date(y,m-2,1);
  const prevMonth = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  await Promise.all([loadPayrollMonth(TODAY.slice(0,7)), loadPayrollMonth(prevMonth)]);
}
async function loadFinanceModule(){
  const admin = isFinanceAdminUser(currentUser);
  const roles = (currentUser && currentUser.roles) || [];
  if(admin){
    await Promise.all([loadBankAccounts(), loadChartOfAccounts()]);
    await Promise.all([loadInvoices(), loadPayables(), loadExpenses(), loadJournalEntries(), loadCommissionWithdrawals(), loadPendingAdvanceDisbursements(), loadSalesPolicy(), loadSalesTargets()]);
    await loadFinanceReports(payroll.selectedMonth);
    // Accounts > Payroll needs the employee list and payroll months; HR/Admin already loaded them in loadHrModule().
    if(!(isHRRole(currentUser) || currentUser.isAdmin)) await loadFinancePayroll();
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

/* ===================== CALENDAR =====================
   One company calendar: client tasks (drag to reschedule), events & meetings (HR/Admin add them), holidays,
   leave & WFH, birthdays/anniversaries and content due dates — each a layer that can be switched off. Month
   view, plus a Team week with a Company row and one row per person. Leave shows what the signed-in user's
   data already allows (HR/Admin see everyone; others see their own). */
const EVENT_KINDS = {"Meeting":"blue", "Company event":"pos", "Deadline":"neg", "Other":"neutral"};
let companyEvents = [];
async function loadCompanyEvents(){ companyEvents = (await apiJson("/api/calendar/events")).events; }
const CAL_LAYERS = [
  {k:"tasks", label:"Client tasks", sw:"var(--ink-faint)"},
  {k:"events", label:"Events & meetings", sw:"var(--blue)"},
  {k:"meetings", label:"Client meetings", sw:"var(--blue)"},
  {k:"programs", label:"HR programs", sw:"var(--pos)"},
  {k:"holidays", label:"Holidays", sw:"var(--neg)"},
  {k:"leave", label:"Leave & WFH", sw:"var(--ink-soft)"},
  {k:"people", label:"Birthdays & anniversaries", sw:"var(--warn)"},
  {k:"content", label:"Content", sw:"var(--ink)"},
];
let calLayersOff = new Set();
function toggleCalLayer(k){ if(calLayersOff.has(k)) calLayersOff.delete(k); else calLayersOff.add(k); render(); }
function calOn(k){ return !calLayersOff.has(k); }
function addDays(ds, n){ const d = new Date(ds+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
function isPlanWorkingDay(ds){ return new Date(ds+"T00:00:00").getDay()!==hrPolicy.weeklyOff && !isHolidayDate(ds); }
function activeEmployees(){ return employees.filter(e=>e.employmentStatus!=="Left" && e.employmentStatus!=="Terminated" && e.employmentStatus!=="Resigned"); }
// The server only lets HR/Admin write events and holidays; the UI mirrors that so nobody sees buttons that would 403.
function calManagesAll(){ return !!currentUser && (currentUser.isAdmin || isHRRole(currentUser) || isLeadershipRole(currentUser)); }
function canEditCalendar(){ return calManagesAll() || isDeptHead(currentUser); }
// Holidays change working days for everyone, so they stay with HR/Admin (the server enforces this too).
function canManageHolidays(){ return !!currentUser && (currentUser.isAdmin || isHRRole(currentUser)); }
// A department head can change only the events they added; HR/Admin/leadership any.
function canEditEvent(ev){ return canEditCalendar() && (!ev || calManagesAll() || ev.createdBy===currentUser.name); }
// Moving a task needs the same access as editing it (Clients/Sales/Admin).
function canMoveCalTasks(){ return !!currentUser && (currentUser.isAdmin || (currentUser.roles||[]).some(r=>r==='SALES'||r==='SALES_HEAD'||r==='CLIENTS')); }

let taskCalView = "month";
let taskCalMonth = TODAY.slice(0,7);
let taskCalWeekStart = addDays(TODAY, -new Date(TODAY+"T00:00:00").getDay());
let taskCalPerson = null;
let taskCalClient = "All";
let taskCalService = "All";   // "All", a service name, or "Content" (DesGro's own content)
// Two-letter service codes shown on every client-work chip, so the calendar says at a glance what kind of work it is.
const SERVICE_SHORT = {"Content":"CT","Marketing Consultation":"MC","Web Development":"WD","Graphic Design":"GD","Production":"PR","Performance Marketing":"PM"};
let taskCalHideDone = false;
let taskCalSelected = TODAY;
// Calendar "Staff" filter value: "All", a person's name, or "dept:<Department>" (everyone in that department).
// Staff open on their own department's calendar by default; leadership on everyone.
function taskCalPersonValue(){
  if(taskCalPerson!=null) return taskCalPerson;
  if(!currentUser) return "All";
  if(isLeadershipRole(currentUser)) return "All";
  return currentUser.dept ? "dept:"+currentUser.dept : currentUser.name;
}
// Name + department of everyone the signed-in user can see: the HR list, else the directory, else their own colleagues.
let colleagues = [], deptTasks = [], deptContent = [];
function calPeople(){ return employees.length ? employees : (employeeDirectory.length ? employeeDirectory : colleagues); }
function calDeptOf(name){ const e = calPeople().find(x=>x.name===name); return e ? e.dept : null; }
function calPersonMatch(name, p){ return p==="All" || p==="__client__" || (p.startsWith("dept:") ? (calDeptOf(name)===p.slice(5) || (currentUser && name===currentUser.name && currentUser.dept===p.slice(5))) : name===p); }
function calPersonLabel(p){ return p==="All" ? "whole team" : (p.startsWith("dept:") ? p.slice(5)+" department" : p); }
// Read-only sight of what the signed-in user's own department is working on (client tasks + content cards).
async function loadCalendarDept(){
  const [people, tasks, content] = await Promise.all([
    apiJson("/api/hr/employees/colleagues"),
    apiJson("/api/crm/tasks?scope=department"),
    apiJson("/api/content/items/mine?scope=department"),
  ]);
  colleagues = people.employees.map(e=>({ id:e.employeeCode, _dbId:e.id, name:e.name, dept:e.dept, userId:e.userId }));
  deptTasks = tasks.tasks.map(mapTask);
  deptContent = content.items.map(mapContentItem);
}
// Client tasks for the calendar: everything the user already has, plus their department's.
function calTaskSource(){ const seen = new Set(clientTasks.map(t=>t.id)); return [...clientTasks, ...deptTasks.filter(t=>!seen.has(t.id))]; }
function calContentSource(){ const base = contentItems.length ? contentItems : myContentItems; const seen = new Set(base.map(c=>c.id)); return [...base, ...deptContent.filter(c=>!seen.has(c.id))]; }
function setTaskCal(k, v){
  if(k==="view") taskCalView = v;
  else if(k==="person") taskCalPerson = v;
  else if(k==="client") taskCalClient = v;
  else if(k==="service") taskCalService = v;
  else if(k==="hideDone") taskCalHideDone = !!v;
  else if(k==="select") taskCalSelected = v;
  render();
}
function shiftTaskCal(delta){
  if(taskCalView==="month"){ const [y,m] = taskCalMonth.split("-").map(Number); taskCalMonth = new Date(Date.UTC(y, m-1+delta, 1)).toISOString().slice(0,7); }
  else taskCalWeekStart = addDays(taskCalWeekStart, 7*delta);
  render();
}
function taskCalToday(){ taskCalMonth = TODAY.slice(0,7); taskCalWeekStart = addDays(TODAY, -new Date(TODAY+"T00:00:00").getDay()); taskCalSelected = TODAY; render(); }
function taskCalTasks(){
  const person = taskCalPersonValue();
  if(taskCalService==="Content") return [];   // only DesGro's own content is wanted; it shows as calendar items
  return calTaskSource().filter(t=>t.due
    && (person==="__client__" ? t.clientAssigned : calPersonMatch(t.assignedTo, person))
    && (taskCalService==="All" || t.service===taskCalService)
    && (taskCalClient==="All" || t.clientId===taskCalClient)
    && (!taskCalHideDone || t.status!=="Done"));
}
function taskCalChipClass(t){
  if(t.status==="Done") return "done";
  if(t.due<TODAY) return "overdue";
  return t.status==="In Progress" ? "progress" : t.status==="Review" ? "review" : "todo";
}
function clientShortName(c){ const w = c ? c.name.split(" ") : []; return w.slice(0, w[0] && w[0].length<=3 ? 2 : 1).join(" "); }
function taskCalChip(t, showWho, showClient){
  const c = clientById(t.clientId);
  const who = t.clientAssigned ? "Client" : initials(t.assignedTo);
  const cname = c ? c.name : (t.clientName||"");
  const svc = t.service ? (SERVICE_SHORT[t.service] || t.service.slice(0,2).toUpperCase()) : "";
  const label = `${svc?svc+" · ":""}${showWho?who+" · ":""}${showClient&&cname?clientShortName({name:cname})+" · ":""}${t.title}`;
  const tip = `${t.title} — ${cname} · ${t.service||""}${t.projectName?" › "+t.projectName:""}${t.cycle?" › "+monthLabel(t.cycle):""} · ${t.stage?"stage: "+t.stage:t.status} · ${t.assignedTo}${t.status!=="Done"&&t.due<TODAY?" · overdue":""}`;
  const canMove = canMoveCalTasks();
  return `<span class="tcal-chip ${taskCalChipClass(t)}" title="${esc(tip)}" ${canMove?`draggable="true" ondragstart="taskCalDragStart(event,'${t.id}')"`:''} ${canMove?`onclick="event.stopPropagation();openEditTask('${t.id}')"`:''}>${esc(label)}</span>`;
}
let taskCalDragId = null;
function taskCalDragStart(e, id){ taskCalDragId = id; e.dataTransfer.effectAllowed = "move"; e.stopPropagation(); }
function taskCalDragOver(e){ e.preventDefault(); e.currentTarget.classList.add("drop-hover"); }
function taskCalDragLeave(e){ e.currentTarget.classList.remove("drop-hover"); }
// Reschedule (and in Team week, hand over when dropped on another person's row).
function taskCalDrop(e, date, person){
  e.preventDefault(); e.currentTarget.classList.remove("drop-hover");
  const t = clientTasks.find(x=>x.id===taskCalDragId); taskCalDragId = null;
  if(!t || !canMoveCalTasks()) return;
  moveTaskOnCalendar(t, date, person);
}
async function moveTaskOnCalendar(t, date, person){
  const body = {}; const changes = [];
  if(t.due!==date){ body.dueAt = date; changes.push("moved to "+fmtDateShort(date)); }
  if(person && person!=="__client__" && t.assignedTo!==person){ body.assignedTo = person; changes.push("assigned to "+person); }
  if(!changes.length) return;
  try{
    await apiJson(`/api/crm/tasks/${t.id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
    if(body.dueAt) t.due = body.dueAt;
    if(body.assignedTo){ t.assignedTo = body.assignedTo; t.clientAssigned = false; }
    toast(t.title+" "+changes.join(", "));
  }catch(err){ toast(err.message || "Couldn't move the task"); }
  render();
}
function taskCalFilterBar(){
  const people = [...new Set(calPeople().filter(e=>!e.employmentStatus || !["Left","Terminated","Resigned"].includes(e.employmentStatus)).map(e=>e.name))].sort();
  const depts = [...new Set(calPeople().map(e=>e.dept).filter(Boolean))].sort();
  const myDept = currentUser && currentUser.dept;
  const p = taskCalPersonValue();
  const me = currentUser ? currentUser.name : null;
  const title = taskCalView==="month" ? monthLabel(taskCalMonth) : `${fmtDateShort(taskCalWeekStart)} – ${fmtDateShort(addDays(taskCalWeekStart,6))}`;
  const clientOpts = (typeof liveClients==="function" ? liveClients() : clients);
  return `
  <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
      <button class="btn btn-sm ghost" onclick="shiftTaskCal(-1)" title="Previous"><svg class="icon" style="width:12px;height:12px"><use href="#i-chevron-left"/></svg></button>
      <div style="font-weight:800;font-size:14px;min-width:150px;text-align:center;">${title}</div>
      <button class="btn btn-sm ghost" onclick="shiftTaskCal(1)" title="Next"><svg class="icon" style="width:12px;height:12px;transform:rotate(180deg)"><use href="#i-chevron-left"/></svg></button>
      <button class="btn btn-sm ghost" onclick="taskCalToday()">Today</button>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <div class="filter-group"><span class="filter-label">Staff</span><select class="select-sm" onchange="setTaskCal('person', this.value)">
        <option value="All" ${p==="All"?'selected':''}>Everyone</option>
        ${me?`<option value="${esc(me)}" ${p===me?'selected':''}>Me (${esc(me)})</option>`:''}
        ${myDept?`<option value="dept:${esc(myDept)}" ${p==="dept:"+myDept?'selected':''}>My department (${esc(myDept)})</option>`:''}
        ${depts.filter(d=>d!==myDept).map(d=>`<option value="dept:${esc(d)}" ${p==="dept:"+d?'selected':''}>Department: ${esc(d)}</option>`).join('')}
        ${people.filter(n=>n!==me).map(n=>`<option value="${esc(n)}" ${p===n?'selected':''}>${esc(n)}</option>`).join('')}
        <option value="__client__" ${p==="__client__"?'selected':''}>Client actions</option>
      </select></div>
      <div class="filter-group"><span class="filter-label">Service</span><select class="select-sm" onchange="setTaskCal('service', this.value)"><option value="All">All services</option>${Object.keys(SERVICE_BOARDS).map(sv=>`<option value="${esc(sv)}" ${taskCalService===sv?'selected':''}>${esc(sv)}</option>`).join('')}<option value="Content" ${taskCalService==="Content"?'selected':''}>Content (DesGro's own)</option></select></div>
      <div class="filter-group"><span class="filter-label">Client</span><select class="select-sm" onchange="setTaskCal('client', this.value)"><option value="All">All clients</option>${clientOpts.map(c=>`<option value="${c.id}" ${taskCalClient===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
      <label class="check-chip" style="padding:5px 9px;"><input type="checkbox" ${taskCalHideDone?'checked':''} onchange="setTaskCal('hideDone', this.checked)">Hide done</label>
      <div style="display:flex;gap:4px;"><button class="btn btn-sm ${taskCalView==='month'?'primary':'ghost'}" onclick="setTaskCal('view','month')">Month</button><button class="btn btn-sm ${taskCalView==='team'?'primary':'ghost'}" onclick="setTaskCal('view','team')">Team week</button></div>
    </div>
  </div>`;
}
const TASK_STATUS_KIND = {"To Do":"neutral","In Progress":"blue","Review":"warn","Done":"pos"};
function taskCalAgendaHTML(date, tasks){
  const list = tasks.filter(t=>t.due===date).sort((a,b)=>a.assignedTo.localeCompare(b.assignedTo));
  const content = calContentOn(date);
  const total = list.length + content.length;
  const contentRows = content.map(c=>`<tr>
      <td><div style="font-weight:700;">${esc(c.title)}</div><div class="faint" style="font-size:11px;">${esc(c.type||"Content")}</div></td>
      <td class="muted">DesGro</td>
      <td style="white-space:nowrap;"><b class="mono" style="font-size:11px;">${SERVICE_SHORT.Content||"CT"}</b> <span class="muted" style="font-size:12.5px;">Content</span></td>
      <td>${c.assignee?`<span class="assignee"><span class="mini-avatar sm">${initials(c.assignee)}</span>${esc(c.assignee)}</span>`:'<span class="muted">Unassigned</span>'}</td>
      <td>${pill(c.stage||"—", c.stage==="Published"?"pos":"neutral")}</td>
      <td></td>
    </tr>`).join('');
  return `
  <div class="panel">
    <div class="panel-head"><div><h3>Tasks due</h3><div class="sub">${total} task${total===1?'':'s'}</div></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Task</th><th>Client</th><th>Service</th><th>Assigned to</th><th>Stage</th><th></th></tr></thead><tbody>${list.map(t=>{ const c=clientById(t.clientId); return `<tr>
      <td><div style="font-weight:700;">${esc(t.title)}${t.status!=="Done"&&t.due<TODAY?' '+pill('Overdue','neg'):''}</div>${t.projectName||t.cycle?`<div class="faint" style="font-size:11px;">${esc(t.projectName||monthLabel(t.cycle)+' month')}</div>`:''}</td>
      <td class="muted">${c?esc(c.name):(t.clientName?esc(t.clientName):'—')}</td>
      <td style="white-space:nowrap;"><b class="mono" style="font-size:11px;">${SERVICE_SHORT[t.service]||''}</b> <span class="muted" style="font-size:12.5px;">${esc(t.service||'—')}</span></td>
      <td>${t.clientAssigned?pill('Client action','warn'):`<span class="assignee"><span class="mini-avatar sm">${initials(t.assignedTo)}</span>${esc(t.assignedTo)}</span>`}</td>
      <td>${pill(t.stage||t.status, TASK_STATUS_KIND[t.status]||'neutral')}</td>
      <td class="num"><div style="display:flex;gap:6px;justify-content:flex-end;">${canMoveCalTasks()?`<button class="btn btn-sm ghost" onclick="openEditTask('${t.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button>`:''}${c&&canMoveCalTasks()?`<button class="btn btn-sm ghost" onclick="goToClient('${t.clientId}')">Open client</button>`:''}</div></td>
    </tr>`; }).join('')}${contentRows}</tbody></table></div>
  </div>`;
}
// Everything except client tasks for one date, in display order.
function calContentOn(ds){
  if(!calOn("content") || !(taskCalService==="All" || taskCalService==="Content")) return [];
  const p = taskCalPersonValue();
  return calContentSource().filter(c=>c.due===ds && calPersonMatch(c.assignee, p));
}
function calItemsOn(ds){
  const out = [], p = taskCalPersonValue();
  const personOk = name => calPersonMatch(name, p);
  if(calOn("holidays")) hrPolicy.holidays.filter(h=>h.date===ds).forEach(h=>out.push({kind:"Holiday", label:h.name, tip:"Holiday · "+h.name, cls:"holiday"}));
  if(calOn("events")) companyEvents.filter(e=>e.date===ds).forEach(e=>{ const k = EVENT_KINDS[e.kind]||"neutral";
    out.push({kind:e.kind, label:(e.time?e.time+" ":"")+e.title, tip:`${e.kind} · ${e.title}${e.time?" · "+e.time:""}${e.venue?" · "+e.venue:""}`, style:k==="neutral"?"background:var(--surface-sunk);color:var(--ink);":`background:var(--${k}-soft);color:var(--${k});`, onclick:`openCompanyEvent('${e.id}')`, sub:[e.time, e.venue].filter(Boolean).join(" · ")}); });
  if(calOn("meetings")) calendarClientMeetings.filter(m=>m.date===ds).forEach(m=>out.push({kind:"Client meeting", label:(m.time?m.time+" ":"")+m.clientName.split(" ")[0]+" · "+m.service.split(" ")[0], tip:`Client meeting · ${m.clientName} · ${m.service}${m.time?" · "+m.time:""}${m.mode?" · "+m.mode:""} · ${m.status==='HELD'?'held':'scheduled'}`, style:m.status==='HELD'?"background:var(--surface-sunk);color:var(--ink-soft);":"background:var(--blue-soft);color:var(--blue);", onclick:`goToClient('${m.clientId}')`}));
  if(calOn("programs")) calendarPrograms.filter(pr=>pr.date===ds).forEach(pr=>{ const k = PROGRAM_TYPE_KIND[pr.type]; out.push({kind:pr.type, label:(pr.time?pr.time+" ":"")+pr.title, tip:`${pr.type} · ${pr.title} · ${pr.status}`, style:`background:var(--${k}-soft);color:var(--${k});`, onclick:canManagePrograms()?`setSub('hr','programs')`:"", sub:[pr.time, pr.mode, pr.venue].filter(Boolean).join(" · ")}); });
  if(calOn("people")) activeEmployees().forEach(e=>{
    if(e.dob && e.dob.slice(5)===ds.slice(5)) out.push({kind:"Birthday", label:"🎂 "+e.name.split(" ")[0], tip:e.name+"'s birthday", cls:"people", sub:e.name});
    if(e.joined && e.joined.slice(5)===ds.slice(5) && e.joined.slice(0,4)<ds.slice(0,4)){ const y = Number(ds.slice(0,4))-Number(e.joined.slice(0,4)); out.push({kind:"Work anniversary", label:"🎉 "+e.name.split(" ")[0]+" · "+y+"y", tip:`${e.name} · ${y}-year work anniversary`, cls:"people", sub:`${e.name} · ${y} year${y>1?"s":""}`}); }
  });
  if(calOn("leave")) leaveRequests.filter(l=>l.from<=ds && l.to>=ds && (l.status==="Approved" || (l.status==="Pending" && (canManageHolidays() || (currentUser && l.empId===currentUser.id))))).forEach(l=>{ const e = byId(l.empId); if(!e || !personOk(e.name)) return;
    const wfh = l.type==="WFH" || /WFH/.test(l.type); out.push({kind:wfh?"WFH":"Leave", label:`${wfh?"WFH":"Off"} · ${e.name.split(" ")[0]}${l.status==="Pending"?" (pending)":""}`, tip:`${e.name} · ${wfh?"work from home":"leave"} · ${l.status}`, cls:"leave"+(l.status==="Pending"?" pending":""), sub:`${e.name} · ${l.status}`}); });
  if(calOn("content") && (taskCalService==="All" || taskCalService==="Content")) calContentSource().filter(c=>c.due===ds && personOk(c.assignee)).forEach(c=>out.push({kind:"Content", label:(c.stage==="Published"?"✓ ":"")+c.title, tip:`Content · ${c.title} · ${c.stage}${c.assignee?" · "+c.assignee:""}`, cls:"ci-content", sub:`${c.type} · ${c.stage}${c.assignee?" · "+c.assignee:""}`}));
  return out;
}
function calItemChip(it){
  return `<span class="cal-item ${it.cls||""}" style="${it.style||""}" title="${esc(it.tip)}" ${it.onclick?`onclick="event.stopPropagation();${it.onclick}"`:""}>${esc(it.label)}</span>`;
}
function calLayerBarHTML(){
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">${CAL_LAYERS.map(l=>`<button class="chip ${calOn(l.k)?"active":""}" style="display:inline-flex;align-items:center;gap:6px;" onclick="toggleCalLayer('${l.k}')" aria-pressed="${calOn(l.k)}"><span style="width:8px;height:8px;border-radius:50%;background:${l.sw};"></span>${l.label}</button>`).join("")}</div>`;
}
function calKpisHTML(days, tasks, rangeLabel){
  const open = tasks.filter(t=>t.status!=="Done"), overdue = open.filter(t=>t.due<TODAY);
  const evs = days.reduce((s,d)=>s+companyEvents.filter(e=>e.date===d).length+calendarPrograms.filter(p=>p.date===d).length, 0);
  const hols = days.filter(d=>isHolidayDate(d));
  const offToday = leaveRequests.filter(l=>l.status==="Approved" && !/WFH/.test(l.type) && l.from<=TODAY && l.to>=TODAY).length;
  return `<div class="kpi-grid cols-5">
    <div class="kpi-card"><div class="kpi-label">Tasks ${rangeLabel}</div><div class="kpi-value mono">${tasks.length}</div><div class="kpi-sub">${open.length} open</div></div>
    <div class="kpi-card"><div class="kpi-label">Overdue tasks</div><div class="kpi-value mono ${overdue.length?"neg":""}">${overdue.length}</div><div class="kpi-sub">past due, not done</div></div>
    <div class="kpi-card"><div class="kpi-label">Events & programs</div><div class="kpi-value mono">${evs}</div><div class="kpi-sub">${rangeLabel}</div></div>
    <div class="kpi-card"><div class="kpi-label">Holidays</div><div class="kpi-value mono">${hols.length}</div><div class="kpi-sub">${hols.length?hols.map(d=>fmtDateShort(d)).join(", "):rangeLabel}</div></div>
    <div class="kpi-card"><div class="kpi-label">Off today</div><div class="kpi-value mono">${offToday}</div><div class="kpi-sub">on approved leave</div></div>
  </div>`;
}
function calMonthHTML(){
  const month = taskCalMonth;
  const tasks = calOn("tasks") ? taskCalTasks().filter(t=>t.due.slice(0,7)===month) : [];
  const p = taskCalPersonValue(), showWho = p==="All" || p==="__client__" || p.startsWith("dept:");
  const [y,m] = month.split("-").map(Number);
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstDow = new Date(`${month}-01T00:00:00`).getDay();
  const days = Array.from({length:daysIn}, (_,i)=>`${month}-${String(i+1).padStart(2,"0")}`);
  const cells = [];
  for(let i=0;i<firstDow;i++) cells.push(`<div class="cal-day empty"></div>`);
  days.forEach((ds,i)=>{
    const dayTasks = tasks.filter(t=>t.due===ds).sort((a,b)=>(a.status==="Done")-(b.status==="Done"));
    const items = calItemsOn(ds);
    const hol = items.some(x=>x.cls==="holiday");
    const all = [...items.map(calItemChip), ...dayTasks.map(t=>taskCalChip(t, showWho, true))];
    cells.push(`<div class="cal-day ${!isPlanWorkingDay(ds)?"off":""} ${hol?"holiday":""} ${ds===TODAY?"today":""} ${ds===taskCalSelected?"selected":""}" style="min-height:112px;" onclick="setTaskCal('select','${ds}')" ondragover="taskCalDragOver(event)" ondragleave="taskCalDragLeave(event)" ondrop="taskCalDrop(event,'${ds}')">
      <div style="display:flex;justify-content:space-between;align-items:center;"><span class="cal-daynum">${i+1}</span>${all.length?`<span class="faint" style="font-size:10px;font-weight:700;">${all.length}</span>`:""}</div>
      ${all.slice(0,4).join("")}
      ${all.length>4?`<span class="tcal-more">+${all.length-4} more</span>`:""}
    </div>`);
  });
  const sel = taskCalSelected.slice(0,7)===month ? taskCalSelected : (TODAY.slice(0,7)===month ? TODAY : month+"-01");
  return `
  ${calKpisHTML(days, tasks, "this month")}
  <div class="panel"><div class="modal-body">
    <div class="cal-legend">
      <span class="cal-legend-item"><b style="color:var(--ink);">Tasks:</b></span>
      <span class="cal-legend-item"><span class="dot" style="background:var(--ink-faint);"></span>To Do</span>
      <span class="cal-legend-item"><span class="dot" style="background:var(--blue);"></span>In Progress</span>
      <span class="cal-legend-item"><span class="dot" style="background:var(--warn);"></span>Review</span>
      <span class="cal-legend-item"><span class="dot" style="background:var(--pos);"></span>Done</span>
      <span class="cal-legend-item"><span class="dot" style="background:var(--neg);"></span>Overdue</span>
      <span class="faint">· ${canMoveCalTasks()?"Drag a task to reschedule · ":""}click a day for everything on it · shaded = holiday or weekly off</span>
    </div>
    <div class="cal-weekdays">${WEEKDAY_NAMES.map(w=>`<div>${w.slice(0,3)}</div>`).join("")}</div>
    <div class="cal-grid">${cells.join("")}</div>
  </div></div>
  ${calAgendaHTML(sel)}`;
}
// Team week: a "Company" row for everything that isn't a task, then one row per person's tasks.
function calTeamHTML(){
  const days = Array.from({length:7}, (_,i)=>addDays(taskCalWeekStart, i));
  const tasks = calOn("tasks") ? taskCalTasks().filter(t=>t.due>=days[0] && t.due<=days[6]) : [];
  const p = taskCalPersonValue();
  let rows = [];
  if(calOn("tasks")){
    if(p==="All" || p.startsWith("dept:")){
      rows = [...new Set(tasks.filter(t=>!t.clientAssigned).map(t=>t.assignedTo))].sort().map(n=>({key:n, label:n}));
      if(tasks.some(t=>t.clientAssigned)) rows.push({key:"__client__", label:"Client actions"});   // work waiting on the client, not on staff
    } else rows = [{key:p, label:p==="__client__"?"Client actions":p}];
  }
  const rowTasks = r => tasks.filter(t=> r.key==="__client__" ? t.clientAssigned : (!t.clientAssigned && t.assignedTo===r.key));
  const head = `<div class="tcal-head">Who</div>${days.map(d=>`<div class="tcal-head ${d===TODAY?"today":""}">${WEEKDAY_NAMES[new Date(d+"T00:00:00").getDay()].slice(0,3)} ${Number(d.slice(8))}</div>`).join("")}`;
  const company = `<div class="tcal-person"><span style="font-weight:800;">Company</span><span class="faint" style="font-size:11px;font-weight:600;">events, leave, holidays</span></div>
    ${days.map(d=>`<div class="tcal-cell ${!isPlanWorkingDay(d)?"off":""} ${d===TODAY?"today":""}">${calItemsOn(d).map(calItemChip).join("")}</div>`).join("")}`;
  const people = rows.map(r=>{ const rt = rowTasks(r), open = rt.filter(t=>t.status!=="Done").length; return `
    <div class="tcal-person"><span class="assignee"><span class="mini-avatar sm">${initials(r.label)}</span>${esc(r.label)}</span><span class="faint" style="font-size:11px;font-weight:600;">${rt.length} task${rt.length===1?"":"s"} · ${open} open</span></div>
    ${days.map(d=>`<div class="tcal-cell ${!isPlanWorkingDay(d)?"off":""} ${d===TODAY?"today":""}" ondragover="taskCalDragOver(event)" ondragleave="taskCalDragLeave(event)" ondrop="taskCalDrop(event,'${d}','${esc(r.key)}')">${rt.filter(t=>t.due===d).map(t=>taskCalChip(t, false, true)).join("")}</div>`).join("")}`; }).join("");
  return `
  ${calKpisHTML(days, tasks, "this week")}
  <div class="panel"><div class="modal-body">
    ${canMoveCalTasks()?`<div class="faint" style="font-size:12px;">Drag a task to another day to reschedule it, or onto someone else's row to hand it to them.</div>`:""}
    <div style="overflow-x:auto;"><div class="tcal-week">${head}${company}${people}</div></div>
    ${calOn("tasks") && !rows.length ? `<div class="empty">No client tasks due this week${p!=="All"?" for this filter":""}.</div>` : ""}
  </div></div>`;
}
function calAgendaHTML(date){
  const items = calItemsOn(date).filter(it=>it.kind!=="Content");   // content pieces live on the grid, not in the day's event list
  const dayTasks = calOn("tasks") ? taskCalTasks().filter(t=>t.due===date) : [];
  const dayContent = calContentOn(date);
  const hol = hrPolicy.holidays.find(h=>h.date===date);
  const btns = [
    canEditCalendar() ? `<button class="btn btn-sm primary" onclick="openCompanyEvent(null,'${date}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Add event</button>` : "",
    canManageHolidays() ? (hol ? `<button class="btn btn-sm ghost" onclick="removeHoliday('${date}')">Remove holiday</button>` : `<button class="btn btn-sm ghost" onclick="openMarkHoliday('${date}')">Add holiday</button>`) : "",
  ].join("");
  return `
  <div class="panel">
    <div class="panel-head" style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;"><div><h3>${fmtDate(date)}${date===TODAY?" · Today":""}</h3><div class="sub">${items.length} event${items.length===1?"":"s"} & updates · ${dayTasks.length+dayContent.length} task${dayTasks.length+dayContent.length===1?"":"s"}${!isPlanWorkingDay(date)?" · non-working day":""}</div></div><div style="display:flex;gap:6px;flex-wrap:wrap;">${btns}</div></div>
    ${items.length ? `<div class="panel-body" style="display:flex;flex-direction:column;gap:0;padding-top:4px;padding-bottom:4px;">${items.map(it=>`<div style="display:grid;grid-template-columns:130px minmax(0,1fr) auto;gap:12px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line);">
      <div style="display:flex;"><span class="cal-item ${it.cls||""}" style="${it.style||""};display:inline-block;width:auto;max-width:100%;cursor:default;">${esc(it.kind)}</span></div>
      <div style="min-width:0;"><div style="font-weight:700;font-size:13px;">${esc(it.label.replace(/^(🎂|🎉|✓) /u,""))}</div>${it.sub?`<div class="subtext">${esc(it.sub)}</div>`:""}</div>
      ${it.onclick?`<button class="btn btn-sm ghost" onclick="${it.onclick}">Open</button>`:"<span></span>"}
    </div>`).join("")}</div>` : (dayTasks.length||dayContent.length ? "" : `<div class="empty">Nothing on this day.</div>`)}
  </div>
  ${dayTasks.length||dayContent.length ? taskCalAgendaHTML(date, taskCalTasks()) : ""}`;
}
function calendarView(){
  if(!currentUser) return "";
  const undated = 0;
  return `
  ${taskCalFilterBar()}
  <div class="panel" style="padding:12px 16px;"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;"><span class="filter-label">Show</span>${calLayerBarHTML()}</div>
    ${calOn("tasks")||calOn("content")?`<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:10px;padding-top:10px;border-top:1px solid var(--line);font-size:11.5px;color:var(--ink-soft);">
      <span class="filter-label">Client work codes</span>
      <span>${[...Object.keys(SERVICE_BOARDS),"Content"].map(sv=>`<b class="mono" style="color:var(--ink);">${SERVICE_SHORT[sv]||sv}</b> ${sv==="Content"?"DesGro content":esc(sv)}`).join(' &nbsp;·&nbsp; ')}</span>
    </div>`:""}</div>
  ${taskCalView==="month" ? calMonthHTML() : calTeamHTML()}`;
}
function openCompanyEvent(id, date){
  const ev = id ? companyEvents.find(x=>x.id===id) : null;
  if(id && !ev) return;
  if(ev && !canEditEvent(ev)){
    showModal(`
      <div class="modal-head"><h3>${esc(ev.title)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
      <div class="modal-body">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">${pill(ev.kind, EVENT_KINDS[ev.kind]||"neutral")}<span style="font-size:13px;">${fmtDate(ev.date)}${ev.time?" · "+esc(ev.time):""}${ev.venue?" · "+esc(ev.venue):""}</span></div>
        ${ev.notes?`<div style="font-size:13px;line-height:1.55;">${esc(ev.notes)}</div>`:""}
        <div class="subtext">For ${ev.audience.includes("All")?"everyone":esc(ev.audience.join(", "))} · added by ${esc(ev.createdBy)}</div>
      </div>
      <div class="modal-foot"><div></div><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
    return;
  }
  if(!canEditEvent(ev)) return;
  const aud = ev ? ev.audience : ["All"];
  showModal(`
    <div class="modal-head"><h3>${ev?"Edit event":"Add event"}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-company-event"><div class="modal-body">
      <div><label class="field-label" for="ev-title">Title</label><input class="field-input" id="ev-title" name="title" required value="${esc(ev?ev.title:"")}" placeholder="e.g. Monthly all-hands"></div>
      <div class="field-row cols-3">
        <div><label class="field-label" for="ev-date">Date</label><input class="field-input" type="date" id="ev-date" name="date" required value="${ev?ev.date:(date||TODAY)}"></div>
        <div><label class="field-label" for="ev-time">Time (optional)</label><input class="field-input" type="time" id="ev-time" name="time" value="${ev?ev.time:""}"></div>
        <div><label class="field-label" for="ev-kind">Type</label><select class="field-input" id="ev-kind" name="kind">${Object.keys(EVENT_KINDS).map(k=>`<option ${ev&&ev.kind===k?"selected":""}>${k}</option>`).join("")}</select></div>
      </div>
      <div><label class="field-label" for="ev-where">Where (optional)</label><input class="field-input" id="ev-where" name="venue" value="${esc(ev?ev.venue:"")}" placeholder="Conference room, Google Meet link…"></div>
      <div><label class="field-label">Who's it for</label><div class="check-row">
        <label class="check-chip"><input type="checkbox" name="audience" value="All" ${aud.includes("All")?"checked":""}>Everyone</label>
        ${DEPARTMENTS.map(d=>`<label class="check-chip"><input type="checkbox" name="audience" value="${esc(d)}" ${!aud.includes("All")&&aud.includes(d)?"checked":""}>${esc(d)}</label>`).join("")}
      </div></div>
      <div><label class="field-label" for="ev-notes">Notes (optional)</label><textarea class="field-input" id="ev-notes" name="notes" rows="2">${esc(ev?ev.notes:"")}</textarea></div>
    </div>
    <div class="modal-foot"><div>${ev?`<button type="button" class="btn ghost" style="color:var(--neg);" onclick="deleteCompanyEvent('${ev.id}')">Delete</button>`:""}</div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">${ev?"Save":"Add event"}</button></div></div>
    </form>`);
  document.getElementById("f-company-event").addEventListener("submit", async e=>{
    e.preventDefault(); const f = new FormData(e.target);
    let audience = f.getAll("audience"); if(!audience.length || audience.includes("All")) audience = ["All"];
    const data = {title:(f.get("title")||"").trim(), date:f.get("date"), time:f.get("time")||"", kind:f.get("kind"), venue:(f.get("venue")||"").trim(), audience, notes:(f.get("notes")||"").trim()};
    try{
      await apiJson(ev?`/api/calendar/events/${ev.id}`:"/api/calendar/events", { method:ev?"PUT":"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(data) });
      await loadCompanyEvents();
      taskCalSelected = data.date; taskCalMonth = data.date.slice(0,7);
      toast(ev?"Event updated":"Added to the calendar"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't save the event"); }
  });
}
async function deleteCompanyEvent(id){
  if(!canEditCalendar()) return;
  if(!confirm("Delete this event?")) return;
  try{ await Auth.apiFetch(`/api/calendar/events/${id}`, { method:"DELETE" }); await loadCompanyEvents(); toast("Event removed"); closeModal(); render(); }
  catch(err){ toast("Couldn't delete the event"); }
}
function openMarkHoliday(date){
  if(!canManageHolidays()) return;
  showModal(`
    <div class="modal-head"><h3>Add holiday</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-mark-holiday"><div class="modal-body">
      <div class="field-row">
        <div><label class="field-label" for="mh-date">Date</label><input class="field-input" type="date" id="mh-date" name="date" required value="${date||TODAY}"></div>
        <div><label class="field-label" for="mh-name">Holiday name</label><input class="field-input" id="mh-name" name="name" required placeholder="e.g. Diwali"></div>
      </div>
      <div class="subtext">Holidays count as non-working days everywhere — attendance, leave and payroll. Only HR and Admin can add them.</div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Add holiday</button></div></div>
    </form>`);
  document.getElementById("f-mark-holiday").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target), d = f.get("date"), name = (f.get("name")||"").trim(); if(!d || !name) return;
    try{
      await apiJson("/api/hr/policy/holidays", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ date:d, name }) });
      await loadPolicy(); taskCalSelected = d; taskCalMonth = d.slice(0,7);
      toast("Holiday added"); closeModal(); render();
    }catch(err){ toast(err.message || "A holiday is already set for that date"); }
  });
}

/* ===================== DEPARTMENTS =====================
   Overview: one tile per department. Each department then has its own page: head, team, clients and
   revenue in one place. Leadership sees every department; a department head sees their own. Figures come
   from /api/departments (computed server-side, so a head doesn't need Clients or Finance access). Score,
   client feedback and the action plan attach to this page in later packages. */
let deptHeads = {};            // dept -> head's name | null
let deptLeads = {};            // dept -> team leads' names
let deptHeadSince = {};        // dept -> IST date the current head was assigned
let deptOverviewTiles = [];
let deptSummaries = {};        // dept -> last loaded /summary
async function loadDeptHeads(){ const r = await apiJson("/api/departments/heads"); deptHeads = r.heads; deptHeadSince = r.since || {}; deptLeads = r.leads || {}; }
async function loadDeptOverview(){ deptOverviewTiles = (await apiJson("/api/departments/overview")).tiles; }
async function loadDeptSummary(d){ deptSummaries[d] = await apiJson(`/api/departments/${encodeURIComponent(d)}/summary`); }
function deptSlug(d){ return d.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function deptFromSlug(sl){ return DEPARTMENTS.find(d=>deptSlug(d)===sl) || null; }
function deptHeadOf(d){ return deptHeads[d] || null; }
function headDeptOf(name){ return DEPARTMENTS.find(d=>deptHeads[d]===name) || null; }
function isDeptHead(u){ return !!(u && headDeptOf(u.name)); }
function isTeamLeadOf(d){ return !!currentUser && (deptLeads[d]||[]).includes(currentUser.name); }
function canSeeDeptPage(d){ return !!currentUser && (isLeadershipRole(currentUser) || headDeptOf(currentUser.name)===d || isTeamLeadOf(d)); }
function deptsVisibleTo(){ return DEPARTMENTS.filter(canSeeDeptPage); }
function prevMonth(m){ const [y,mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo-2, 1)).toISOString().slice(0,7); }
function shortInr(n){ n = Math.round(n||0); return n>=100000 ? '₹'+(n/100000).toFixed(n>=1000000?1:2).replace(/\.?0+$/,'')+'L' : n>=1000 ? '₹'+(n/1000).toFixed(n>=10000?0:1).replace(/\.0$/,'')+'K' : '₹'+n; }
// "▲3 vs Sep" style change marker; `neutral` for figures where up/down isn't good or bad.
function deltaHTML(now, was, opts){
  opts = opts || {};
  if(now==null || was==null) return '';
  const d = now-was; if(Math.abs(d) < (opts.eps||0.5)) return `<span class="faint">no change</span>`;
  const good = opts.neutral ? null : d>0;
  const col = good==null ? 'var(--ink-soft)' : good ? 'var(--pos)' : 'var(--neg)';
  return `<b style="color:${col};">${d>0?'▲':'▼'}${opts.fmt?opts.fmt(Math.abs(d)):Math.abs(Math.round(d*10)/10)}</b>`;
}
function openAssignDeptHead(dept){
  if(!isLeadershipRole(currentUser)) return;
  const cur = deptHeadOf(dept);
  const people = employees.filter(e=>e.employmentStatus!=="Left").sort((a,b)=>(b.dept===dept)-(a.dept===dept) || a.name.localeCompare(b.name));
  showModal(`
    <div class="modal-head"><h3>${esc(dept)} — head</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-dept-head"><div class="modal-body">
      <div><label class="field-label">Who heads ${esc(dept)}?</label><select class="field-input" name="employeeId"><option value="">— No head —</option>${people.map(e=>`<option value="${esc(e._dbId)}" ${e.name===cur?"selected":""}>${esc(e.name)} · ${esc(e.dept)}${e.dept===dept?"":" (other dept)"}</option>`).join("")}</select></div>
      <div class="subtext">The head sees this department's page under Departments and can add calendar events. Only leadership can change this.</div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save</button></div></div>
    </form>`);
  document.getElementById("f-dept-head").addEventListener("submit", async ev=>{
    ev.preventDefault();
    const id = new FormData(ev.target).get("employeeId") || null;
    try{
      await apiJson(`/api/departments/${encodeURIComponent(dept)}/head`, { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ employeeId:id }) });
      await Promise.all([loadDeptHeads(), loadDeptOverview(), loadDeptSummary(dept).catch(()=>{})]);
      toast(id?"Head updated":"Head cleared"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't update the head"); }
  });
}
function openAssignDeptTeamLeads(dept){
  if(!isLeadershipRole(currentUser)) return;
  const cur = deptLeads[dept] || [];
  const people = employees.filter(e=>e.employmentStatus!=="Left").sort((a,b)=>(b.dept===dept)-(a.dept===dept) || a.name.localeCompare(b.name));
  showModal(`
    <div class="modal-head"><h3>${esc(dept)} — team leads</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-dept-leads"><div class="modal-body">
      <div class="check-row">${people.map(e=>`<label class="check-chip"><input type="checkbox" name="lead" value="${esc(e._dbId)}" ${cur.includes(e.name)?"checked":""}>${esc(e.name)}${e.dept===dept?"":" · "+esc(e.dept)}</label>`).join("")}</div>
      <div class="subtext">A team lead sees this department's page under Departments: its staff, today's attendance, open and overdue work, clients and ratings. It's view-only, with no money figures. Only leadership can change this.</div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save</button></div></div>
    </form>`);
  document.getElementById("f-dept-leads").addEventListener("submit", async ev=>{
    ev.preventDefault();
    const ids = new FormData(ev.target).getAll("lead");
    try{
      await apiJson(`/api/departments/${encodeURIComponent(dept)}/team-leads`, { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ employeeIds:ids }) });
      await Promise.all([loadDeptHeads(), loadDeptSummary(dept).catch(()=>{})]);
      toast("Team leads updated"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't update the team leads"); }
  });
}
function deptTile(d){
  const t = deptOverviewTiles.find(x=>x.dept===d) || {};
  const head = deptHeadOf(d);
  return `<div class="panel row-click" style="padding:16px;display:flex;flex-direction:column;gap:10px;" onclick="setSub('departments','${deptSlug(d)}')">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;"><div><div style="font-weight:800;font-size:14px;">${esc(d)}</div><div class="subtext">${head?'Head: '+esc(head):'No head assigned'}</div></div>${isLeadershipRole(currentUser)?`<button class="btn btn-sm ghost" onclick="event.stopPropagation();openAssignDeptHead('${esc(d)}')">${head?'Change':'Assign head'}</button>`:''}</div>
    ${(()=>{ const sc = deptScoreOf(d); if(!sc) return ''; const diff = sc.now.score!=null && sc.prev.score!=null ? sc.now.score-sc.prev.score : null; return `<div style="display:flex;align-items:baseline;gap:8px;"><span class="mono" style="font-size:26px;font-weight:800;color:${scoreTone(sc.now.score==null?null:sc.now.score/100)};">${sc.now.score==null?'—':sc.now.score}</span><span style="font-size:11.5px;">${diff==null?'':`<b style="color:${diff>=0?'var(--pos)':'var(--neg)'};">${diff>=0?'▲':'▼'}${Math.abs(diff)}</b> <span class="faint">vs ${monthLabel(prevMonth(deptScores.month)).slice(0,3)}</span>`}</span>${scoreGradePill(sc.now.score)}</div>`; })()}
    <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--ink-soft);">
      <span><b class="mono" style="color:var(--ink);">${t.people==null?'—':t.people}</b> people</span>
      ${t.clients!=null?`<span><b class="mono" style="color:var(--ink);">${t.clients}</b> clients</span>`:''}
    </div>
  </div>`;
}
function deptsOverview(){
  const list = deptsVisibleTo();
  return `
  ${isLeadershipRole(currentUser)?deptScoresPanelHTML():''}
  <div>
    <div style="margin-bottom:12px;"><h3 style="margin:0;font-size:15px;">${isLeadershipRole(currentUser)?'All departments':'Your department'}</h3><div class="subtext" style="font-size:12px;">Open a department for its team, clients and revenue</div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;">${list.map(deptTile).join('') || '<div class="empty">No departments to show.</div>'}</div>
  </div>`;
}
function deptInsightsHTML(s){
  const a = s.insights.now, b = s.insights.prev, P = monthLabel(prevMonth(s.month)).slice(0,3);
  const tiles = [
    s.service ? {label:"Clients", now:a.clients, was:b.clients, fmt:x=>String(x)} : null,
    s.canSeeMoney && a.paid!=null ? {label:"Payments", now:a.paid, was:b.paid, fmt:shortInr, dfmt:shortInr, tip:`Payments received · ${inr(a.paid)} vs ${inr(b.paid)}`} : null,
    {label:"Team", now:a.team, was:b.team, fmt:x=>String(x), neutral:true},
    s.service ? {label:"Rating", tip:"Average client satisfaction rating (1–5)", now:a.rating, was:b.rating, fmt:x=>x.toFixed(1)+" ★", dfmt:x=>x.toFixed(1), eps:0.05} : null,
    s.service ? {label:"Feedbacks", now:a.feedbacks, was:b.feedbacks, fmt:x=>String(x)} : null,
  ].filter(Boolean);
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;">${tiles.map(t=>`
    <div style="padding:8px 10px;border-radius:8px;background:var(--surface-sunk);min-width:0;" ${t.tip?`title="${esc(t.tip)}"`:''}>
      <div style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-faint);">${t.label}</div>
      <div class="mono" style="font-size:15px;font-weight:800;margin-top:2px;">${t.fmt(t.now)}</div>
      <div style="font-size:11px;margin-top:1px;">${deltaHTML(t.now, t.was, {neutral:t.neutral, fmt:t.dfmt, eps:t.label==="Payments"?1:0.5})} <span class="faint">vs ${P}</span></div>
    </div>`).join("")}</div>`;
}

/* ---- Departments → Board setup: the columns, work types and task lists a service's client boards use ---- */
function canEditDeptItems(d){ return !!currentUser && !currentUser.isClient && (isLeadershipRole(currentUser) || headDeptOf(currentUser.name)===d); }
function deptBoardPanelHTML(d){
  const cfg = SERVICE_BOARDS[d], edit = canEditDeptItems(d);
  const open = clientTasks.filter(t=>t.service===d && t.status!=="Done");
  return `<div class="panel">
    <div class="panel-head"><div><h3>Board setup</h3><div class="sub">The columns every ${esc(d.toLowerCase())} client board uses, and the types of work. The last column counts as done.</div></div>
      ${edit?`<button class="btn btn-sm ghost" onclick="openDeptBoard('${esc(d)}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button>`:''}</div>
    <div class="panel-body" style="display:flex;flex-direction:column;gap:14px;">
      <div><div class="kpi-label" style="margin-bottom:8px;">Stages</div><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">${cfg.stages.map((s2,i)=>{ const n = open.filter(t=>t.stage===s2).length, late = 0, max = null; return `${i?'<span class="faint">→</span>':''}<span class="chip" style="cursor:default;${i===cfg.stages.length-1?'border-color:var(--pos);color:var(--pos);':''}">${esc(s2)}${max?` <span class="mono" style="font-size:10.5px;font-weight:800;">${max}d</span>`:''}${n?` <span class="mono" style="font-size:10.5px;opacity:.75;">· ${n} open</span>`:''}${late?` <span style="font-size:10.5px;color:var(--neg);font-weight:800;">· ${late} delayed</span>`:''}</span>`; }).join('')}</div></div>
      <div ${cfg.projectTasks?'hidden':''}><div class="kpi-label" style="margin-bottom:8px;">Types of work</div><div style="display:flex;flex-wrap:wrap;gap:6px;">${cfg.types.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div></div>
      ${cfg.monthlyTasks?`<div><div class="kpi-label" style="margin-bottom:8px;">Monthly tasks · created in Open for every client month</div><div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Task</th><th class="num">Max working days</th><th>For</th></tr></thead><tbody>${cfg.monthlyTasks.map((r,i)=>`<tr><td class="mono faint">${i+1}</td><td style="font-weight:700;">${esc(r.name)}</td><td class="num mono">${r.days}</td><td>${r.newOnly?pill('New clients only','warn'):pill('Every month','neutral')}</td></tr>`).join('')}</tbody></table></div><div class="subtext">Retained clients start from the first “every month” task. A task still open after its days is flagged on the client board.</div></div>`:''}
      ${cfg.projectTasks?`<div><div class="kpi-label" style="margin-bottom:8px;">Task lists by project type · created in Open when a project starts</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;">${Object.entries(cfg.projectTasks).map(([ty,list],i)=>`<div style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;"><div style="display:flex;justify-content:space-between;gap:6px;align-items:baseline;"><b style="font-size:13px;">${esc(ty)}${i===0?' <span class="faint" style="font-weight:600;font-size:11px;">· default</span>':''}</b><span class="faint mono" style="font-size:11px;">${list.reduce((n,x)=>n+x.days,0)}d</span></div><ol style="margin:6px 0 0;padding-left:18px;font-size:12px;display:flex;flex-direction:column;gap:2px;">${list.map(x=>`<li style="display:flex;justify-content:space-between;gap:6px;"><span>${esc(x.name)}</span><span class="mono faint">${x.days}d</span></li>`).join('')}</ol></div>`).join('')}</div><div class="subtext">The default type is used when this service is first added to a client. A task still open after its days is flagged on the client board.</div></div>`:''}
      ${(cfg.platforms||[]).length?`<div><div class="kpi-label" style="margin-bottom:8px;">Platforms</div><div style="display:flex;flex-wrap:wrap;gap:6px;">${cfg.platforms.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div></div>`:''}
    </div>
  </div>`;
}
function openDeptBoard(d){
  const cfg = SERVICE_BOARDS[d]; if(!cfg || !canEditDeptItems(d)) return;
  const row = (v, old) => `<div class="bs-row" data-old="${esc(old||'')}" style="display:grid;grid-template-columns:minmax(0,1fr) 30px;gap:6px;"><input class="field-input" name="stage" value="${esc(v)}" required placeholder="Stage name"><button type="button" class="btn btn-sm ghost" style="padding:4px;" title="Remove" onclick="this.closest('.bs-row').remove()"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button></div>`;
  window.__bsRow = row;
  window.__mtRow = r => `<div class="mt-row" data-type="${esc(r.type||'Other')}" style="display:grid;grid-template-columns:minmax(0,1fr) 70px auto 30px;gap:6px;align-items:center;"><input class="field-input" name="mt-name" value="${esc(r.name)}" placeholder="Task" required><input class="field-input mono" name="mt-days" type="number" min="1" step="1" value="${r.days||1}" title="Most working days allowed"><label class="check-chip" style="padding:6px 9px;font-size:11.5px;"><input type="checkbox" name="mt-new" ${r.newOnly?'checked':''}>New only</label><button type="button" class="btn btn-sm ghost" style="padding:4px;" title="Remove" onclick="this.closest('.mt-row').remove()"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button></div>`;
  showModal(`
    <div class="modal-head"><h3>Board setup — ${esc(d)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-dept-board"><div class="modal-body">
      <div><span class="field-label">Stages, in order</span><div id="bs-rows" style="display:flex;flex-direction:column;gap:6px;margin-top:6px;">${cfg.stages.map(s2=>row(s2, s2)).join('')}</div>
        <button type="button" class="btn btn-sm ghost" style="margin-top:8px;" onclick="document.getElementById('bs-rows').insertAdjacentHTML('beforeend', window.__bsRow('', ''))"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Add stage</button>
        <div class="subtext">Renaming a stage moves its cards with it. Cards in a removed stage go to the stage before it. The last stage counts as done.</div></div>
      ${cfg.monthlyTasks?`<div><span class="field-label">Monthly tasks, in order</span><div id="mt-rows" style="display:flex;flex-direction:column;gap:6px;margin-top:6px;">${cfg.monthlyTasks.map(r=>window.__mtRow(r)).join('')}</div>
        <button type="button" class="btn btn-sm ghost" style="margin-top:8px;" onclick="document.getElementById('mt-rows').insertAdjacentHTML('beforeend', window.__mtRow({name:'',days:1,type:'Other'}))"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Add task</button>
        <div class="subtext">Days = most working days allowed. “New only” tasks are skipped when a client is retained. Changes apply to months started from now on.</div></div>`:''}
      ${cfg.projectTasks?`<div><span class="field-label">Task lists by project type</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;"><select class="field-input" id="pt-type" style="flex:1;min-width:160px;" onchange="ptSwitch(this.value)"></select><button type="button" class="btn btn-sm ghost" onclick="ptAddType()"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>New type</button><button type="button" class="btn btn-sm ghost" style="color:var(--neg);" onclick="ptRemoveType()">Remove type</button></div>
        <div style="margin-top:8px;"><label class="field-label" for="pt-name">Type name</label><input class="field-input" id="pt-name"></div>
        <div id="pt-rows" style="display:flex;flex-direction:column;gap:6px;margin-top:8px;"></div>
        <button type="button" class="btn btn-sm ghost" style="margin-top:8px;" onclick="ptAddRow()"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Add task</button>
        <div class="subtext">Days = most working days allowed. The first type is the default. Changes apply to projects started from now on.</div></div>`:''}
      <div ${cfg.projectTasks?'hidden':''}><label class="field-label" for="bs-types">Types of work</label><input class="field-input" id="bs-types" name="types" value="${esc(cfg.types.join(', '))}"><div class="subtext">Separate with commas.</div></div>
      <div><label class="field-label" for="bs-plats">Platforms</label><input class="field-input" id="bs-plats" name="platforms" value="${esc((cfg.platforms||[]).join(', '))}" placeholder="Leave empty if not needed"></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save</button></div></div>
    </form>`);
  if(cfg.projectTasks){ window.__pt = {work: JSON.parse(JSON.stringify(cfg.projectTasks)), order: Object.keys(cfg.projectTasks), sel: Object.keys(cfg.projectTasks)[0]}; ptRender(); }
  document.getElementById("f-dept-board").addEventListener("submit", async e=>{
    e.preventDefault();
    const body = {};
    if(cfg.projectTasks){ if(!ptCollect()) return; const w = window.__pt, out = {}; w.order.forEach(k=>{ const l = (w.work[k]||[]).filter(r=>r.name); if(l.length) out[k] = l; }); if(!Object.keys(out).length){ toast("Keep at least one project type"); return; } body.projectTasks = out; }
    const rows = [...document.querySelectorAll('#bs-rows .bs-row')].map(r=>({was:r.dataset.old||undefined, name:r.querySelector('input[name=stage]').value.trim()})).filter(r=>r.name);
    const names = rows.map(r=>r.name);
    if(names.length < 2){ toast("Keep at least two stages"); return; }
    if(new Set(names).size !== names.length){ toast("Two stages have the same name"); return; }
    body.stages = rows;
    const list = k => (new FormData(e.target).get(k)||"").split(',').map(x=>x.trim()).filter(Boolean);
    if(!cfg.projectTasks) body.types = list("types");
    body.platforms = list("platforms");
    if(cfg.monthlyTasks){ const mt = [...document.querySelectorAll('#mt-rows .mt-row')].map(r=>({name:r.querySelector('input[name=mt-name]').value.trim(), days:Math.max(1, Math.round(Number(r.querySelector('input[name=mt-days]').value))||1), type:r.dataset.type||'Other', newOnly:r.querySelector('input[name=mt-new]').checked})).filter(r=>r.name);
      if(!mt.length){ toast("Keep at least one monthly task"); return; } body.monthlyTasks = mt; }
    try{
      await apiJson(`/api/crm/service-boards/${encodeURIComponent(d)}`, {method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
      await Promise.all([loadServiceBoards(), loadTasks()]);
      toast("Board updated"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't save the board"); }
  });
}
// Board setup editor: one task list per project type (kept in window.__pt while the modal is open).
function ptRowHTML(r){ return `<div class="pt-row" style="display:grid;grid-template-columns:minmax(0,1fr) 70px 30px;gap:6px;"><input class="field-input" name="pt-task" value="${esc(r.name||'')}" placeholder="Task"><input class="field-input mono" name="pt-days" type="number" min="1" step="1" value="${r.days||1}" title="Most working days allowed"><button type="button" class="btn btn-sm ghost" style="padding:4px;" title="Remove" onclick="this.closest('.pt-row').remove()"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button></div>`; }
function ptRender(){ const w = window.__pt; if(!w) return;
  document.getElementById('pt-type').innerHTML = w.order.map((k,i)=>`<option value="${esc(k)}" ${k===w.sel?'selected':''}>${esc(k)}${i===0?' (default)':''}</option>`).join('');
  document.getElementById('pt-name').value = w.sel || '';
  document.getElementById('pt-rows').innerHTML = (w.work[w.sel]||[]).map(ptRowHTML).join(''); }
function ptCollect(){ const w = window.__pt; if(!w || !w.sel) return true;
  const rows = [...document.querySelectorAll('#pt-rows .pt-row')].map(r=>({name:r.querySelector('input[name=pt-task]').value.trim(), days:Math.max(1, Number(r.querySelector('input[name=pt-days]').value)||1)})).filter(r=>r.name);
  const nm = document.getElementById('pt-name').value.trim() || w.sel;
  if(nm!==w.sel && w.order.includes(nm)){ toast(`There's already a type called “${nm}”`); return false; }
  delete w.work[w.sel]; w.work[nm] = rows; w.order = w.order.map(k=>k===w.sel?nm:k); w.sel = nm; return true; }
function ptSwitch(v){ const w = window.__pt; const keep = v; if(!ptCollect()){ ptRender(); return; } w.sel = keep; ptRender(); }
function ptAddType(){ const w = window.__pt; if(!ptCollect()) return; let n = 'New type', i = 2; while(w.order.includes(n)) n = 'New type '+(i++); w.order.push(n); w.work[n] = [{name:'Brief',days:1}]; w.sel = n; ptRender(); }
function ptRemoveType(){ const w = window.__pt; if(w.order.length<=1){ toast("Keep at least one project type"); return; } w.order = w.order.filter(k=>k!==w.sel); delete w.work[w.sel]; w.sel = w.order[0]; ptRender(); }
function ptAddRow(){ document.getElementById('pt-rows').insertAdjacentHTML('beforeend', ptRowHTML({name:'',days:1})); }
function deptPage(d){
  if(!d || !canSeeDeptPage(d)) return `<div class="empty">You don't have access to this department.</div>`;
  const s = deptSummaries[d];
  if(!s) return `<div class="empty">Loading ${esc(d)}…</div>`;
  const M = monthLabel(s.month).split(' ')[0], head = s.head;
  const ps = head ? planScore(d, s.month) : null, psP = head ? planScore(d, prevMonth(s.month)) : null;
  const attLabel = id => { const a = attendanceToday[id]; if(a) return attendanceLabel(a.status); const m = s.team.find(e=>e.id===id); return m && m.today ? attendanceLabel(ATTENDANCE_FROM_API[m.today]) : null; };
  const showToday = s.team.some(e=>attendanceToday[e.id] || e.today);
  const header = `<div class="panel" style="padding:16px 18px;display:flex;flex-wrap:wrap;gap:18px;align-items:center;justify-content:space-between;">
    <div style="display:flex;align-items:center;gap:12px;"><div class="mini-avatar" style="width:40px;height:40px;font-size:13px;">${head?initials(head):'—'}</div><div><div class="kpi-label">Department head</div><div style="font-weight:800;font-size:14px;">${head?esc(head):'Not assigned'}</div></div></div>
    <div><div class="kpi-label">Team leads</div><div style="font-weight:700;font-size:13px;">${(s.teamLeads||[]).length?(s.teamLeads).map(esc).join(', '):'<span class="faint">None</span>'}</div></div>
    <div style="display:flex;gap:22px;flex-wrap:wrap;">
      <div><div class="kpi-label">Team</div><div class="mono" style="font-size:18px;font-weight:800;">${s.team.length}</div></div>
      ${s.service?`<div><div class="kpi-label">Clients · ${M}</div><div class="mono" style="font-size:18px;font-weight:800;">${s.clients.length}</div></div>`:''}
      ${ps&&ps.score!=null?`<div><div class="kpi-label">Action plan score</div><div class="mono" style="font-size:18px;font-weight:800;">${ps.score}${psP&&psP.score!=null?` <span style="font-size:11px;">${deltaHTML(ps.score, psP.score)}</span>`:''}</div></div>`:''}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      ${head && isLeadershipRole(currentUser) ? `<button class="btn btn-sm ghost" onclick="setSub('workspace','plans')">Action plans</button>` : (head && currentUser.name===head ? `<button class="btn btn-sm ghost" onclick="setSub('workspace','plan')">My action plan</button>` : '')}
      ${isLeadershipRole(currentUser)?`<button class="btn btn-sm ghost" onclick="openAssignDeptHead('${esc(d)}')">${head?'Change head':'Assign head'}</button><button class="btn btn-sm ghost" onclick="openAssignDeptTeamLeads('${esc(d)}')">Team leads</button>`:''}
    </div>
  </div>`;
  const insights = `<div class="panel"><div class="panel-head"><div><h3>${esc(d)} · ${monthLabel(s.month)}</h3><div class="sub">This month against last month</div></div></div><div class="panel-body">${deptInsightsHTML(s)}</div></div>`;
  const teamPanel = `<div class="panel">
    <div class="panel-head"><div><h3>Team</h3><div class="sub">${s.team.length} people · open client work${showToday?" and today's attendance":""}</div></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Person</th>${showToday?'<th>Today</th>':''}<th class="num">Open tasks</th><th class="num">Overdue</th>${s.service?'<th class="num">Clients</th>':''}</tr></thead><tbody>${s.team.map(e=>{ const st = attLabel(e.id); return `<tr>
      <td>${personCell(e)}${e.name===head?' '+pill('Head','blue'):''}${(s.teamLeads||[]).includes(e.name)?' '+pill('Team lead','neutral'):''}</td>
      ${showToday?`<td>${st?pill(st, statusKind(st)):pill('Not marked','neutral')}</td>`:''}
      <td class="num mono">${e.openTasks||'—'}</td><td class="num mono ${e.overdue?'neg':'faint'}">${e.overdue||'—'}</td>${s.service?`<td class="num mono">${e.clients||'—'}</td>`:''}
    </tr>`; }).join('') || `<tr><td colspan="5"><div class="empty">No one in this department.</div></td></tr>`}</tbody></table></div>
  </div>`;
  const clientsPanel = s.service ? `<div class="panel">
    <div class="panel-head"><div><h3>Clients</h3><div class="sub">${s.clients.length} active client${s.clients.length===1?'':'s'} taking ${esc(d.toLowerCase())}</div></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Client</th><th>Rating · ${M}</th><th class="num">Open tasks</th><th></th></tr></thead><tbody>${s.clients.map(c=>`<tr class="row-click" ${(clientById(c.id)?`onclick="goToClient('${c.id}')"`:'')}>
      <td><div style="font-weight:700;">${esc(c.name)}</div><div class="subtext">${esc(c.accountManager||'')}</div></td>
      <td style="white-space:nowrap;">${c.rating!=null?`${starBarHTML(c.rating, 11)} <b class="mono">${c.rating}</b>`:'<span class="faint" style="font-size:11.5px;">not rated</span>'}</td>
      <td class="num mono">${c.openTasks||'—'}</td>
      <td class="num">${c.rating==null?`<button class="btn btn-sm ghost" onclick="event.stopPropagation();openClientFeedbackLink('${c.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-link"/></svg>Ask</button>`:''}</td></tr>`).join('') || `<tr><td colspan="4"><div class="empty">No active clients.</div></td></tr>`}</tbody></table></div>
  </div>` : '';
  const feedbackPanel = s.service ? `<div class="panel">
    <div class="panel-head"><div><h3>Client feedback · ${M}</h3><div class="sub">${s.feedback.length} rating${s.feedback.length===1?'':'s'}</div></div></div>
    <div class="panel-body" style="display:flex;flex-direction:column;gap:10px;">${s.feedback.map(f=>`<div style="padding:10px 12px;border-radius:10px;background:var(--surface-sunk);"><div style="display:flex;justify-content:space-between;gap:8px;"><b style="font-size:12.5px;">${esc(f.client)}</b>${starBarHTML(f.rating, 11)}</div>${f.comment?`<div style="font-size:12.5px;margin-top:4px;line-height:1.5;">“${esc(f.comment)}”</div>`:''}<div class="subtext" style="margin-top:4px;">${fmtDateShort(f.date)} · ${esc(f.via)}</div></div>`).join('') || '<div class="empty">No feedback this month yet.</div>'}</div>
  </div>` : '';
  const rev = s.revenue;
  const revenuePanel = rev ? `<div class="panel">
    <div class="panel-head"><div><h3>Revenue · ${monthLabel(s.month)}</h3><div class="sub">${esc(d)}'s share of every invoice, split by its line items</div></div></div>
    <div class="panel-body"><div class="kpi-grid" style="margin:0;">
      <div class="kpi-card"><div class="kpi-label">Billed</div><div class="kpi-value mono">${inr(rev.billed)}</div><div class="kpi-sub">invoiced this month</div></div>
      <div class="kpi-card"><div class="kpi-label">Received</div><div class="kpi-value mono" style="color:var(--pos);">${inr(rev.collected)}</div><div class="kpi-sub">payments this month</div></div>
      <div class="kpi-card hero"><div class="kpi-label">Outstanding</div><div class="kpi-value mono">${inr(rev.outstanding)}</div><div class="kpi-sub">still to collect</div></div>
    </div></div></div>` : '';
  return `${header}${deptScorePanel(d)}${insights}${revenuePanel}${s.service?`<div class="grid-2" style="align-items:start;">${clientsPanel}${feedbackPanel}</div>`:''}${SERVICE_BOARDS[d]?deptBoardPanelHTML(d):''}${teamPanel}`;
}

/* ===================== DEPARTMENT ACTION PLANS =====================
   Each department head files a plan every working day: a one-line focus, their research notes, and items tagged
   Improve / Optimise / Introduce (a new service). Unfinished items carry over when they start the next day's plan.
   Leadership reads everything under My Workspace → Dept Action Plans and only steps in when needed — a comment, an
   item added to a head's plan, or an answer to a "Needs your input" question the head raised. Plans are stored
   server-side (/api/action-plans); a head only ever sees their own department's. Tracking for a department starts the
   day its current head was assigned, so nobody is marked down for days before they had the job. */
const PLAN_ITEM_TYPES = ["Improve","Optimise","Introduce"];
const PLAN_TYPE_KIND = {Improve:"blue", Optimise:"warn", Introduce:"pos"};
const PLAN_TYPE_HINT = {Improve:"make an existing service better", Optimise:"same output, less time / cost", Introduce:"a new service or offer"};
const PLAN_ITEM_STATUSES = ["Planned","In progress","Done","Dropped"];
const PLAN_STATUS_KIND = {"Planned":"neutral","In progress":"blue","Done":"pos","Dropped":"neg"};
let actionPlans = [];
async function loadActionPlans(){ actionPlans = (await apiJson("/api/action-plans")).plans; }
function canSeePlans(u){ return !!u && isLeadershipRole(u); }
function planTrackStart(dept){ return (deptHeadSince[dept]) || TODAY; }
function dateRange(a, b){ const out = []; for(let d=a; d<=b; d=addDays(d,1)) out.push(d); return out; }
function monthLastDay(m){ const [y,mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0,10); }
// Past working days (newest first) whose plan was due — today isn't included, it's still open.
function pastPlanDays(n, dept){ const out=[]; const from = planTrackStart(dept); let d=addDays(TODAY,-1); while(out.length<n && d>=from){ if(isPlanWorkingDay(d)) out.push(d); d=addDays(d,-1); } return out; }
function planFor(dept, date){ return actionPlans.find(p=>p.dept===dept && p.date===date); }
function plansOf(dept){ return actionPlans.filter(p=>p.dept===dept).sort((a,b)=>b.date.localeCompare(a.date)); }
function latestPlanBefore(dept, date){ return plansOf(dept).find(p=>p.date<date) || null; }
function openNeedsInput(){ return actionPlans.filter(p=>p.needsInput && !p.needsInput.resolved).sort((a,b)=>b.date.localeCompare(a.date)); }
function planCompliance(dept, n){
  const days = pastPlanDays(n||14, dept);
  const missed = deptHeads[dept] ? days.filter(d=>!planFor(dept,d)) : [];
  return {days, missed, filed: days.length-missed.length, today: !!planFor(dept, TODAY)};
}
// Action plan score for the month, out of 100:
//   60% — filing: plans filed ÷ working days they were due (from the 1st, or tracking start, to yesterday;
//          today counts only once it's filed, so a morning without a plan yet isn't a penalty)
//   40% — follow-through: items finished ÷ items taken on this month (an item is tracked by title across
//          days, using its latest status; Dropped items don't count either way)
function planScore(dept, month){
  month = month || TODAY.slice(0,7);
  if(!deptHeads[dept]) return {score:null, filed:0, due:0, done:0, taken:0, introduced:0, filing:null, follow:null};
  const start = [month+"-01", planTrackStart(dept)].sort().pop();
  const end = [addDays(TODAY,-1), monthLastDay(month)].sort()[0];
  const due = start>end ? [] : dateRange(start, end).filter(isPlanWorkingDay);
  if(month===TODAY.slice(0,7) && planFor(dept,TODAY)) due.push(TODAY);
  const filed = due.filter(d=>planFor(dept,d)).length;
  const plans = actionPlans.filter(p=>p.dept===dept && p.date.slice(0,7)===month).sort((a,b)=>a.date.localeCompare(b.date));
  const latest = {};
  plans.forEach(p=>p.items.forEach(it=>{ latest[it.title.trim().toLowerCase()] = it; }));
  const items = Object.values(latest).filter(it=>it.status!=="Dropped");
  const done = items.filter(it=>it.status==="Done").length;
  const filing = due.length ? filed/due.length : null;
  const follow = items.length ? done/items.length : null;
  const score = filing==null ? null : Math.round(100*(0.6*filing + 0.4*(follow==null?0:follow)));
  return {score, filed, due:due.length, done, taken:items.length, introduced:items.filter(it=>it.type==="Introduce").length, filing, follow};
}
function planScoreKind(s){ return s==null ? "neutral" : s>=85 ? "pos" : s>=65 ? "warn" : "neg"; }
function planScoreLabel(s){ return s==null ? "No data" : s>=85 ? "Strong" : s>=65 ? "Fair" : "Weak"; }
function myPlanPending(){ const d = currentUser ? headDeptOf(currentUser.name) : null; return d && isPlanWorkingDay(TODAY) && !planFor(d, TODAY) ? 1 : 0; }
function canEditPlan(p){ return !!(currentUser && p && deptHeads[p.dept]===currentUser.name && p.date===TODAY); }
async function planApi(method, path, body, okMsg){
  try{
    await apiJson("/api/action-plans"+path, { method, headers:{"Content-Type":"application/json"}, body: body?JSON.stringify(body):undefined });
    await loadActionPlans();
    if(okMsg) toast(okMsg);
    return true;
  }catch(err){ toast(err.message || "Couldn't save"); return false; }
}
function planItemsHTML(p, editable){
  if(!p.items.length) return `<div class="empty" style="padding:10px 0;">No items yet.</div>`;
  return `<div style="display:flex;flex-direction:column;gap:6px;">${p.items.map(it=>`
    <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;${it.status==='Done'||it.status==='Dropped'?'opacity:.72;':''}">
      <span class="pill ${PLAN_TYPE_KIND[it.type]}" style="flex:none;">${it.type}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;${it.status==='Dropped'?'text-decoration:line-through;':''}">${esc(it.title)}</div>
        ${it.detail?`<div class="subtext" style="font-size:12px;">${esc(it.detail)}</div>`:''}
        ${(it.carriedFrom||it.addedBy)?`<div class="subtext">${it.carriedFrom?'Carried over from '+fmtDateShort(it.carriedFrom):''}${it.carriedFrom&&it.addedBy?' · ':''}${it.addedBy?'Added by '+esc(it.addedBy):''}</div>`:''}
      </div>
      ${editable
        ? `<select class="select-sm" style="flex:none;padding:4px 6px;font-size:11.5px;" onchange="setPlanItemStatus('${p.id}','${it.id}',this.value)">${PLAN_ITEM_STATUSES.map(s=>`<option ${s===it.status?'selected':''}>${s}</option>`).join('')}</select>
           <button type="button" class="card-edit" title="Edit item" onclick="openPlanItem('${p.id}','${it.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg></button>`
        : pill(it.status, PLAN_STATUS_KIND[it.status])}
    </div>`).join('')}</div>`;
}
function planCommentsHTML(p){
  if(!p.comments.length) return '';
  return `<div style="display:flex;flex-direction:column;gap:6px;margin-top:2px;">${p.comments.map(c=>`
    <div style="padding:8px 10px;border-radius:8px;background:var(--surface-sunk);font-size:12.5px;"><b>${esc(c.by)}</b> <span class="faint" style="font-size:11px;">${fmtDateShort(c.date)}</span><div style="margin-top:2px;">${esc(c.text)}</div></div>`).join('')}</div>`;
}
// One plan, full detail. mode: "head" (their own, editable today) or "lead" (leadership — comment / add item).
function planCardHTML(p, mode){
  const editable = mode==="head" && canEditPlan(p);
  const ni = p.needsInput;
  return `
  <div class="panel" style="${ni&&!ni.resolved?'border-color:var(--warn);':''}">
    <div class="panel-head">
      <div><h3>${mode==="lead"?esc(p.dept):fmtDate(p.date)}</h3><div class="sub">${mode==="lead"?esc(p.head||'')+' · ':''}Filed ${fmtDateShort(p.date)}${p.submittedAt?' at '+p.submittedAt:''} · ${p.items.length} item${p.items.length===1?'':'s'}</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
        ${editable?`<button class="btn btn-sm ghost" onclick="openPlanEdit('${p.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit focus</button><button class="btn btn-sm ghost" onclick="openPlanNeedsInput('${p.id}')">${ni&&!ni.resolved?'Edit question':'Ask leadership'}</button><button class="btn btn-sm primary" onclick="openPlanItem('${p.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Add item</button>`:''}
        ${mode==="lead"?`<button class="btn btn-sm ghost" onclick="openPlanItem('${p.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Add to their plan</button><button class="btn btn-sm ${ni&&!ni.resolved?'primary':'ghost'}" onclick="openPlanComment('${p.id}')">${ni&&!ni.resolved?'Answer':'Comment'}</button>`:''}
      </div>
    </div>
    <div class="modal-body">
      <div style="font-size:14px;font-weight:700;">${esc(p.focus)}</div>
      ${p.research?`<div style="font-size:12.5px;color:var(--ink-soft);"><b style="color:var(--ink);">Research:</b> ${esc(p.research)}</div>`:''}
      ${ni?`<div class="banner" style="${ni.resolved?'':'background:var(--warn-soft);color:var(--ink);'}"><svg class="icon" style="width:15px;height:15px"><use href="#i-megaphone"/></svg><div><b>${ni.resolved?'Answered':'Needs your input'}:</b> ${esc(ni.question)}</div></div>`:''}
      ${planItemsHTML(p, editable)}
      ${planCommentsHTML(p)}
      ${mode==="head" && p.comments.length ? `<div><button class="btn btn-sm ghost" onclick="openPlanComment('${p.id}')">Reply</button></div>` : ''}
    </div>
  </div>`;
}
// Last-n working days as a strip of filed / missed / today marks.
function planStripHTML(dept, n){
  const days = pastPlanDays(n, dept).slice().reverse();
  const marks = days.map(d=>{ const ok = !!planFor(dept,d); return `<span title="${fmtDate(d)} — ${ok?'filed':'missed'}" style="width:14px;height:14px;border-radius:4px;display:inline-block;background:${ok?'var(--pos)':'var(--neg-soft)'};border:1px solid ${ok?'var(--pos)':'var(--neg)'};"></span>`; });
  if(isPlanWorkingDay(TODAY)) marks.push(`<span title="Today — ${planFor(dept,TODAY)?'filed':'not yet'}" style="width:14px;height:14px;border-radius:4px;display:inline-block;background:${planFor(dept,TODAY)?'var(--pos)':'transparent'};border:1px dashed var(--ink-faint);"></span>`);
  return `<span style="display:inline-flex;gap:3px;align-items:center;">${marks.join('')}</span>`;
}

/* ---- Head's own page: My Workspace → My Action Plan ---- */
function workspacePlan(){
  const dept = currentUser ? headDeptOf(currentUser.name) : null;
  if(!dept) return `<div class="empty">You're not set as a department head, so there's no action plan to file.</div>`;
  const today = planFor(dept, TODAY);
  const comp = planCompliance(dept, 10);
  const history = plansOf(dept).filter(p=>p.date<TODAY).slice(0,10);
  const weekItems = plansOf(dept).filter(p=>p.date>=addDays(TODAY,-6)).flatMap(p=>p.items);
  const doneThisWeek = new Set(weekItems.filter(i=>i.status==='Done').map(i=>i.title)).size;
  const last = latestPlanBefore(dept, TODAY);
  const carry = last ? last.items.filter(i=>i.status==='Planned'||i.status==='In progress') : [];
  const sc = planScore(dept);
  return `
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-label">${monthLabel(TODAY.slice(0,7)).split(' ')[0]} Score</div><div class="kpi-value mono ${sc.score==null?'':planScoreKind(sc.score)}">${sc.score==null?'—':sc.score}<span style="font-size:13px;color:var(--ink-soft);font-family:Manrope;"> / 100</span></div><div class="kpi-sub">60% filing (${sc.filed}/${sc.due} days) · 40% follow-through (${sc.done}/${sc.taken} done)</div></div>
    <div class="kpi-card"><div class="kpi-label">Plans Filed</div><div class="kpi-value mono ${comp.missed.length?'warn':''}">${comp.filed} / ${comp.days.length}</div><div class="kpi-sub">last ${comp.days.length} working days · ${planStripHTML(dept,10)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Done This Week</div><div class="kpi-value mono pos">${doneThisWeek}</div><div class="kpi-sub">items completed</div></div>
    <div class="kpi-card hero"><div class="kpi-label">Today</div><div class="kpi-value" style="font-size:17px;">${today?'Filed':(isPlanWorkingDay(TODAY)?'Not filed yet':'Day off')}</div><div class="kpi-sub">${today?'at '+today.submittedAt:'due today'}</div></div>
  </div>
  ${today ? planCardHTML(today, "head") : `
  <div class="panel" style="border-color:var(--neg);">
    <div class="panel-head"><div><h3>Today's action plan isn't in yet</h3><div class="sub">What will you research, improve, optimise or introduce in ${esc(dept)} today?${carry.length?` ${carry.length} unfinished item${carry.length>1?'s':''} from ${fmtDateShort(last.date)} will carry over.`:''}</div></div>
      <button class="btn primary" onclick="openStartPlan()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Start today's plan</button></div>
  </div>`}
  <div class="section-label" style="margin:6px 2px;">Previous plans</div>
  ${history.length ? history.map(p=>planCardHTML(p,"head")).join('') : `<div class="empty">No earlier plans yet.</div>`}`;
}
function openStartPlan(){
  const dept = currentUser ? headDeptOf(currentUser.name) : null;
  if(!dept || planFor(dept, TODAY)) return;
  const last = latestPlanBefore(dept, TODAY);
  const carry = last ? last.items.filter(i=>i.status==='Planned'||i.status==='In progress') : [];
  showModal(`
    <div class="modal-head"><h3>Today's action plan — ${esc(dept)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-start-plan"><div class="modal-body">
      <div><label class="field-label">Today's focus</label><input class="field-input" name="focus" required placeholder="One line — e.g. Price and pilot the brand audit add-on"></div>
      <div><label class="field-label">Research notes</label><textarea class="field-input" name="research" rows="3" placeholder="What you looked into — competitors, pricing, tools, numbers, links"></textarea></div>
      ${carry.length?`<div><label class="field-label">Carry over from ${fmtDateShort(last.date)}</label><div style="display:flex;flex-direction:column;gap:6px;">${carry.map(i=>`<label class="check-chip" style="justify-content:flex-start;"><input type="checkbox" name="carry" value="${i.id}" checked><span class="pill ${PLAN_TYPE_KIND[i.type]}">${i.type}</span> ${esc(i.title)} <span class="faint">· ${i.status}</span></label>`).join('')}</div></div>`:''}
      <div class="section-label" style="margin-top:4px;">New item${carry.length?' (optional)':''}</div>
      <div class="field-row">
        <div><label class="field-label">Type</label><select class="field-input" name="type">${PLAN_ITEM_TYPES.map(t=>`<option value="${t}">${t} — ${PLAN_TYPE_HINT[t]}</option>`).join('')}</select></div>
        <div><label class="field-label">Status</label><select class="field-input" name="status">${PLAN_ITEM_STATUSES.slice(0,2).map(s=>`<option>${s}</option>`).join('')}</select></div>
      </div>
      <div><label class="field-label">What</label><input class="field-input" name="title" ${carry.length?'':'required'} placeholder="e.g. Website maintenance retainer"></div>
      <div><label class="field-label">Detail</label><input class="field-input" name="detail" placeholder="Optional"></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">File today's plan</button></div></div>
    </form>`);
  document.getElementById("f-start-plan").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const keep = f.getAll("carry");
    const items = carry.filter(i=>keep.includes(i.id)).map(i=>({type:i.type, title:i.title, detail:i.detail, status:i.status, carriedFrom:last.date}));
    const title = (f.get("title")||"").trim();
    if(title) items.push({type:f.get("type"), title, detail:(f.get("detail")||"").trim(), status:f.get("status")});
    if(!items.length){ toast("Add at least one item"); return; }
    if(await planApi("POST", "", { focus:f.get("focus"), research:(f.get("research")||"").trim(), items }, "Today's plan filed")){ closeModal(); render(); }
  });
}
function planById(id){ return actionPlans.find(p=>p.id===id); }
async function setPlanItemStatus(planId, itemId, status){
  const p = planById(planId); if(!canEditPlan(p)) return;
  await planApi("PATCH", `/${planId}/items/${itemId}`, { status });
  render();
}
// Add / edit an item. The head edits today's plan; leadership can add an item to any head's plan.
function openPlanItem(planId, itemId){
  const p = planById(planId); if(!p) return;
  const lead = canSeePlans(currentUser) && !canEditPlan(p);
  if(!canEditPlan(p) && !lead) return;
  const it = itemId ? p.items.find(i=>i.id===itemId) : null;
  if(it && !canEditPlan(p)) return;
  showModal(`
    <div class="modal-head"><h3>${it?'Edit item':(lead?'Add to '+esc(p.head||p.dept)+"'s plan":'Add item')}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-plan-item"><div class="modal-body">
      <div class="field-row">
        <div><label class="field-label">Type</label><select class="field-input" name="type">${PLAN_ITEM_TYPES.map(t=>`<option value="${t}" ${it&&it.type===t?'selected':''}>${t} — ${PLAN_TYPE_HINT[t]}</option>`).join('')}</select></div>
        <div><label class="field-label">Status</label><select class="field-input" name="status">${PLAN_ITEM_STATUSES.map(s=>`<option ${it&&it.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
      </div>
      <div><label class="field-label">What</label><input class="field-input" name="title" required value="${esc(it?it.title:'')}"></div>
      <div><label class="field-label">Detail</label><textarea class="field-input" name="detail" rows="2">${esc(it?it.detail:'')}</textarea></div>
    </div>
    <div class="modal-foot"><div>${it?`<button type="button" class="btn ghost" style="color:var(--neg);" onclick="removePlanItem('${p.id}','${it.id}')">Remove</button>`:''}</div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">${it?'Save':'Add'}</button></div></div>
    </form>`);
  document.getElementById("f-plan-item").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const data = {type:f.get("type"), status:f.get("status"), title:f.get("title"), detail:(f.get("detail")||"").trim()};
    const ok = it ? await planApi("PATCH", `/${p.id}/items/${it.id}`, data, "Item updated") : await planApi("POST", `/${p.id}/items`, data, lead?"Added to "+(p.head||p.dept)+"'s plan":"Item added");
    if(ok){ closeModal(); render(); }
  });
}
async function removePlanItem(planId, itemId){
  const p = planById(planId); if(!canEditPlan(p)) return;
  if(await planApi("DELETE", `/${planId}/items/${itemId}`)){ closeModal(); render(); }
}
function openPlanEdit(planId){
  const p = planById(planId); if(!canEditPlan(p)) return;
  showModal(`
    <div class="modal-head"><h3>Edit today's focus</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-plan-edit"><div class="modal-body">
      <div><label class="field-label">Today's focus</label><input class="field-input" name="focus" required value="${esc(p.focus)}"></div>
      <div><label class="field-label">Research notes</label><textarea class="field-input" name="research" rows="4">${esc(p.research)}</textarea></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save</button></div></div>
    </form>`);
  document.getElementById("f-plan-edit").addEventListener("submit", async e=>{
    e.preventDefault(); const f = new FormData(e.target);
    if(await planApi("PATCH", `/${p.id}`, { focus:f.get("focus"), research:(f.get("research")||"").trim() }, "Plan updated")){ closeModal(); render(); }
  });
}
// The head's way to pull leadership in — only when they actually need a decision.
function openPlanNeedsInput(planId){
  const p = planById(planId); if(!canEditPlan(p)) return;
  const q = p.needsInput && !p.needsInput.resolved ? p.needsInput.question : '';
  showModal(`
    <div class="modal-head"><h3>Ask leadership</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-plan-ask"><div class="modal-body">
      <div class="subtext" style="font-size:12px;margin-top:0;">Only for decisions you can't make yourself — it goes to the top of Dept Action Plans until it's answered.</div>
      <div><label class="field-label">What do you need decided?</label><textarea class="field-input" name="question" rows="3" placeholder="Leave empty to withdraw the question">${esc(q)}</textarea></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save</button></div></div>
    </form>`);
  document.getElementById("f-plan-ask").addEventListener("submit", async e=>{
    e.preventDefault(); const f = new FormData(e.target);
    const question = (f.get("question")||"").trim();
    if(await planApi("PATCH", `/${p.id}`, { needsQuestion: question||null }, question?"Sent to Dept Action Plans":"Question withdrawn")){ closeModal(); render(); }
  });
}
// Comment / answer. Leadership answering an open question marks it answered (unless they untick it);
// the head can reply on their own plan's thread.
function openPlanComment(planId){
  const p = planById(planId); if(!p) return;
  const lead = canSeePlans(currentUser);
  const isHead = currentUser && deptHeads[p.dept]===currentUser.name;
  if(!lead && !isHead) return;
  const openQ = p.needsInput && !p.needsInput.resolved;
  showModal(`
    <div class="modal-head"><h3>${lead&&openQ?'Answer':'Comment'} — ${esc(p.dept)}, ${fmtDateShort(p.date)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-plan-comment"><div class="modal-body">
      ${openQ?`<div class="banner" style="background:var(--warn-soft);color:var(--ink);"><div><b>${esc(p.head||'')} asked:</b> ${esc(p.needsInput.question)}</div></div>`:''}
      <div><label class="field-label">Your ${lead&&openQ?'answer':'comment'}</label><textarea class="field-input" name="text" rows="3" required></textarea></div>
      ${lead&&openQ?`<label class="check-chip" style="align-self:flex-start;"><input type="checkbox" name="resolve" value="1" checked>This answers their question</label>`:''}
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Post</button></div></div>
    </form>`);
  document.getElementById("f-plan-comment").addEventListener("submit", async e=>{
    e.preventDefault(); const f = new FormData(e.target);
    if(await planApi("POST", `/${p.id}/comments`, { text:f.get("text"), resolve: !!(lead && openQ && f.get("resolve")) }, "Posted")){ closeModal(); render(); }
  });
}

/* ---- Leadership: My Workspace → Dept Action Plans ---- */
let planHistoryDept = "All";
function setPlanHistoryDept(v){ planHistoryDept = v; render(); }
function plansToday(){
  if(!canSeePlans(currentUser)) return `<div class="empty">Only Leadership can see every department's action plans.</div>`;
  const headed = DEPARTMENTS.filter(d=>deptHeads[d]);
  const filed = headed.filter(d=>planFor(d,TODAY));
  const questions = openNeedsInput();
  const week = actionPlans.filter(p=>p.date>=addDays(TODAY,-6));
  const uniq = (items)=>new Set(items.map(i=>i.dept+'|'+i.title)).size;
  const weekItems = week.flatMap(p=>p.items.map(i=>({...i, dept:p.dept})));
  const doneWeek = uniq(weekItems.filter(i=>i.status==='Done'));
  const introduce = uniq(weekItems.filter(i=>i.type==='Introduce' && i.status!=='Dropped'));
  return `
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-label">Filed Today</div><div class="kpi-value mono ${filed.length<headed.length?'warn':'pos'}">${filed.length}<span style="font-size:13px;color:var(--ink-soft);font-family:Manrope;"> / ${headed.length}</span></div><div class="kpi-sub">${headed.filter(d=>!planFor(d,TODAY)).map(d=>esc(deptHeads[d])).join(', ')||'all heads filed'}</div></div>
    <div class="kpi-card"><div class="kpi-label">Needs Your Input</div><div class="kpi-value mono ${questions.length?'warn':''}">${questions.length}</div><div class="kpi-sub">${questions.length?'questions waiting on you':'nothing waiting'}</div></div>
    <div class="kpi-card"><div class="kpi-label">Done This Week</div><div class="kpi-value mono pos">${doneWeek}</div><div class="kpi-sub">items across departments</div></div>
    <div class="kpi-card hero"><div class="kpi-label">New Services in Progress</div><div class="kpi-value mono">${introduce}</div><div class="kpi-sub">"Introduce" items this week</div></div>
  </div>
  ${questions.length ? `
  <div class="panel" style="border-color:var(--warn);">
    <div class="panel-head"><div><h3>Needs your input</h3><div class="sub">The only things heads have asked you to decide</div></div></div>
    <div class="panel-body">${questions.map(p=>`<div class="feed-item" style="align-items:center;"><div class="feed-dot" style="background:var(--warn);"></div><div style="flex:1;"><div class="feed-text"><strong>${esc(p.head||'')}</strong> · ${esc(p.dept)}</div><div style="font-size:13px;margin-top:2px;">${esc(p.needsInput.question)}</div><div class="feed-time">${fmtDateShort(p.date)} · ${esc(p.focus)}</div></div><button class="btn btn-sm primary" style="flex:none;" onclick="openPlanComment('${p.id}')">Answer</button></div>`).join('')}</div>
  </div>` : ''}
  <div class="panel">
    <div class="panel-head"><div><h3>Filing record</h3><div class="sub">Last 10 working days since the head was assigned · green = filed, red = missed, dashed = today</div></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Department</th><th>Head</th><th>Record</th><th class="num">Filed</th><th class="num">${monthLabel(TODAY.slice(0,7)).split(' ')[0]} score</th><th>Today</th><th></th></tr></thead>
      <tbody>${DEPARTMENTS.map(d=>{ const c = planCompliance(d,10); const sc = planScore(d); return `<tr>
        <td style="font-weight:700;">${esc(d)}</td>
        <td>${deptHeads[d]?esc(deptHeads[d]):pill('No head','warn')}</td>
        <td>${deptHeads[d]?planStripHTML(d,10):'<span class="faint">—</span>'}</td>
        <td class="num mono" style="${c.missed.length?'color:var(--neg);font-weight:700;':''}">${deptHeads[d]?c.filed+' / '+c.days.length:'—'}</td>
        <td class="num">${deptHeads[d]&&sc.score!=null?`<span class="mono" style="font-weight:800;">${sc.score}</span> ${pill(planScoreLabel(sc.score),planScoreKind(sc.score))}`:'<span class="faint">—</span>'}</td>
        <td>${!deptHeads[d]?'—':c.today?pill('Filed '+planFor(d,TODAY).submittedAt,'pos'):pill('Not filed','neg')}</td>
        <td class="num"><button class="btn btn-sm ghost" onclick="openAssignDeptHead('${esc(d)}')">${deptHeads[d]?'Change head':'Assign head'}</button></td>
      </tr>`; }).join('')}</tbody>
    </table></div>
  </div>
  <div class="section-label" style="margin:6px 2px;">Today's plans · ${fmtDate(TODAY)}</div>
  ${filed.length ? `<div class="grid-2" style="align-items:start;">${filed.map(d=>planCardHTML(planFor(d,TODAY),"lead")).join('')}</div>` : `<div class="empty">No plans filed yet today.</div>`}`;
}
function plansHistory(){
  if(!canSeePlans(currentUser)) return `<div class="empty">Only Leadership can see every department's action plans.</div>`;
  const list = actionPlans.filter(p=>p.date<TODAY && (planHistoryDept==='All' || p.dept===planHistoryDept)).sort((a,b)=>b.date.localeCompare(a.date) || a.dept.localeCompare(b.dept));
  const byDate = [...new Set(list.map(p=>p.date))];
  const missedRows = (planHistoryDept==='All'?DEPARTMENTS:[planHistoryDept]).filter(d=>deptHeads[d]).map(d=>({d, m:planCompliance(d,14).missed})).filter(x=>x.m.length);
  return `
  <div class="toolbar"><div class="filter-group"><span class="filter-label">Department</span><select class="select-sm" onchange="setPlanHistoryDept(this.value)"><option ${planHistoryDept==='All'?'selected':''}>All</option>${DEPARTMENTS.map(d=>`<option ${d===planHistoryDept?'selected':''}>${esc(d)}</option>`).join('')}</select></div></div>
  ${missedRows.length?`<div class="banner"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div><b>Missed plans (last 14 working days):</b> ${missedRows.map(x=>`${esc(x.d)} — ${x.m.map(fmtDateShort).join(', ')}`).join(' · ')}</div></div>`:''}
  ${byDate.length ? byDate.map(date=>`
    <div class="section-label" style="margin:6px 2px;">${fmtDate(date)}</div>
    <div class="grid-2" style="align-items:start;">${list.filter(p=>p.date===date).map(p=>planCardHTML(p,"lead")).join('')}</div>`).join('') : `<div class="empty">No earlier plans for this department yet.</div>`}`;
}
let planTeamView = "today";
function setPlanTeamView(v){ planTeamView = v; render(); }
function workspacePlansTeam(){
  if(!canSeePlans(currentUser)) return `<div class="empty">Only Leadership can see every department's action plans.</div>`;
  return `
  <div class="toolbar"><div style="display:flex;gap:6px;">
    <button class="btn btn-sm ${planTeamView==='today'?'primary':'ghost'}" onclick="setPlanTeamView('today')">Today${openNeedsInput().length?` · ${openNeedsInput().length} need${openNeedsInput().length===1?'s':''} you`:''}</button>
    <button class="btn btn-sm ${planTeamView==='history'?'primary':'ghost'}" onclick="setPlanTeamView('history')">History</button>
  </div></div>
  ${planTeamView==='history' ? plansHistory() : plansToday()}`;
}
// Small nudge at the top of a head's My Workspace when today's plan isn't filed.
function planReminderHTML(){
  if(!myPlanPending()) return '';
  const dept = headDeptOf(currentUser.name);
  return `<div class="banner" style="background:var(--neg-soft);color:var(--ink);align-items:center;"><svg class="icon" style="width:15px;height:15px"><use href="#i-target"/></svg><div style="flex:1;"><b>Today's ${esc(dept)} action plan isn't filed yet.</b> What will you improve, optimise or introduce today?</div><button class="btn btn-sm primary" style="flex:none;" onclick="setSub('workspace','plan')">Open action plan</button></div>`;
}

/* ===================== MONTHLY SCORES =====================
   Each score is out of 100 from weighted parts; a part with nothing to measure is left out and the rest re-weighted
   (so a part that reads "n/a" costs nobody anything). They're computed on the server (/api/scores) so a department
   head sees their own numbers without needing Finance or Clients access:
     Department  Client growth 25 · Client satisfaction 30 · Feedback coverage 15 · Revenue 30
     Sales       Target completion 45 · Lead conversion 30 · Meetings 25
     Meta Ads    Return on ad spend 30 · Cost per lead 25 · Lead→sale 15 · Lead pace 15 · Daily tracking 15
   Leadership sets the targets. Satisfaction/coverage fill in once client feedback exists; Meetings once sales meetings are logged. */
let scoreTargets = null;
let deptScores = null;      // {month, scores:{dept:{now,prev}}}
let metaScoreData = null;   // {month, now, prev, totals, targets}
async function loadDeptScores(){ const r = await apiJson("/api/scores/departments"); deptScores = r; scoreTargets = r.targets; }
async function loadMetaScore(){ metaScoreData = await apiJson("/api/scores/meta-ads"); }
function scoreGradePill(s){ return s==null ? pill('No data','neutral') : s>=85 ? pill('Strong','pos') : s>=65 ? pill('Fair','warn') : pill('Needs work','neg'); }
function scoreTone(v){ return v==null ? 'var(--ink-faint)' : v>=0.85 ? 'var(--pos)' : v>=0.65 ? 'var(--warn)' : 'var(--neg)'; }
function scoreRingHTML(score, size){
  size = size || 112; const r = size/2-9, c = 2*Math.PI*r, v = score==null?0:Math.max(0,Math.min(100,score));
  const color = score==null ? 'var(--ink-faint)' : score>=85 ? 'var(--pos)' : score>=65 ? 'var(--warn)' : 'var(--neg)';
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex:none;">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--surface-sunk)" stroke-width="10"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${c*v/100} ${c}" transform="rotate(-90 ${size/2} ${size/2})"/>
    <text x="50%" y="48%" text-anchor="middle" dominant-baseline="middle" style="font:800 28px Manrope,sans-serif;fill:var(--ink);">${score==null?'—':score}</text>
    <text x="50%" y="70%" text-anchor="middle" style="font:700 10px Manrope,sans-serif;fill:var(--ink-faint);letter-spacing:.06em;">/ 100</text>
  </svg>`;
}
// A score ring + its parts, each with its mark out of its weight and last month's mark. `extra` is HTML slotted above the ring.
function monthScorePanelHTML(title, sub, sc, scPrev, P, extra){
  const col = v => v==null ? 'var(--ink-faint)' : v>=0.85 ? 'var(--pos)' : v>=0.65 ? 'var(--warn)' : 'var(--neg)';
  const delta = (a,b) => b==null ? '' : a==null ? '' : a===b ? `<span class="faint">same</span>` : `<span style="color:${a>b?'var(--pos)':'var(--neg)'};font-weight:700;">${a>b?'▲':'▼'} ${Math.abs(a-b)}</span>`;
  return `
  <div class="panel">
    <div class="panel-head"><div><h3>${title}</h3><div class="sub">${sub}</div></div>${scoreGradePill(sc.score)}</div>
    ${extra?`<div class="panel-body" style="padding-bottom:0;">${extra}</div>`:''}
    <div class="modal-body" style="flex-direction:row;flex-wrap:wrap;align-items:center;gap:24px;">
      <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
        ${scoreRingHTML(sc.score, 128)}
        <div style="font-size:12px;color:var(--ink-soft);">${scPrev.score==null?`${P}: no data`:`${P}: <b>${scPrev.score}</b> ${delta(sc.score, scPrev.score)}`}</div>
      </div>
      <div style="flex:1;min-width:280px;display:flex;flex-direction:column;gap:9px;">
        ${sc.parts.map(p=>{ const q = scPrev.parts.find(x=>x.key===p.key); const a = p.v==null?null:Math.round(p.v*p.w), b = (q&&q.v!=null)?Math.round(q.v*q.w):null; return `<div style="display:grid;grid-template-columns:150px 1fr 86px;gap:10px;align-items:center;font-size:12.5px;${p.v==null?'opacity:.55;':''}">
          <div><b>${p.label}</b><div class="subtext">${esc(p.detail)}</div></div>
          <div class="bar-track" style="height:8px;"><div class="bar-fill" style="width:${p.v==null?0:p.v*100}%;background:${col(p.v)};"></div></div>
          <div style="text-align:right;"><div class="mono" style="font-weight:700;">${a==null?'n/a':a+'/'+p.w}</div><div style="font-size:10.5px;">${b==null?`<span class="faint">${P}: n/a</span>`:`${(a==null||a===b)?'':delta(a,b)+' '}<span class="faint">${P}: ${b}</span>`}</div></div>
        </div>`; }).join('')}
      </div>
    </div>
  </div>`;
}
function deptScoreOf(d){ return deptScores && deptScores.scores[d] ? deptScores.scores[d] : null; }
function deptScorePanel(d){
  const sc = deptScoreOf(d); if(!sc) return '';
  const month = deptScores.month, P = monthLabel(prevMonth(month)).split(' ')[0];
  const t = deptScores.targets;
  const foot = isLeadershipRole(currentUser) ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;color:var(--ink-soft);"><span>${d==="Sales"?`Targets: ${shortInr(t.sales.revenue)} a month · ${t.sales.conversion}% conversion · ${t.sales.meetings} meetings`:`Targets: ${shortInr(t.deptRevenue[d]||0)} revenue a month · +${t.deptClientGrowth}% clients a month`}</span><button class="btn btn-sm ghost" onclick="openScoreTargets()">Set targets</button></div>` : '';
  const title = d==="Sales" ? `Sales Score · ${monthLabel(month)}` : `${esc(d)} score · ${monthLabel(month)}`;
  const sub = d==="Sales" ? `Target completion, lead conversion and meetings · vs ${P}` : `Client growth, client satisfaction, feedback coverage and revenue · vs ${P}`;
  return monthScorePanelHTML(title, sub, sc.now, sc.prev, P, foot);
}
// Leadership's overview of every department's score.
function deptScoresPanelHTML(){
  if(!deptScores) return '';
  const list = DEPARTMENTS.filter(d=>deptScoreOf(d));
  if(!list.length) return '';
  const P = monthLabel(prevMonth(deptScores.month)).slice(0,3);
  return `<div class="panel">
    <div class="panel-head" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;"><div><h3>Department scores · ${monthLabel(deptScores.month)}</h3><div class="sub">Out of 100 · open a department for the full breakdown</div></div>${isLeadershipRole(currentUser)?`<button class="btn btn-sm ghost" onclick="openScoreTargets()">Set targets</button>`:''}</div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Department</th><th class="num">Score</th><th class="num">vs ${P}</th><th>Grade</th>${['Client growth','Satisfaction','Feedback','Revenue'].map(h=>`<th class="num">${h}</th>`).join('')}</tr></thead><tbody>${list.map(d=>{ const s = deptScoreOf(d), diff = s.now.score!=null && s.prev.score!=null ? s.now.score-s.prev.score : null; const pv = k => { const p = s.now.parts.find(x=>x.key===k); return p && p.v!=null ? Math.round(p.v*p.w)+'/'+p.w : 'n/a'; };
      const keys = d==="Sales" ? ['target','conversion','meetings'] : ['growth','satisfaction','feedback','revenue'];
      return `<tr class="row-click" onclick="setSub('departments','${deptSlug(d)}')"><td style="font-weight:700;">${esc(d)}</td><td class="num mono" style="font-weight:800;color:${scoreTone(s.now.score==null?null:s.now.score/100)};">${s.now.score==null?'—':s.now.score}</td><td class="num">${diff==null?'<span class="faint">—</span>':`<b style="color:${diff>=0?'var(--pos)':'var(--neg)'};">${diff>=0?'▲':'▼'}${Math.abs(diff)}</b>`}</td><td>${scoreGradePill(s.now.score)}</td>${d==="Sales"?`<td class="num mono faint" colspan="4" style="text-align:left;">Target ${pv('target')} · Conversion ${pv('conversion')} · Meetings ${pv('meetings')}</td>`:keys.map(k=>`<td class="num mono">${pv(k)}</td>`).join('')}</tr>`; }).join('')}</tbody></table></div>
  </div>`;
}
// A head's own score card at the top of My Workspace → Overview.
function myDeptScoreHTML(){
  const d = currentUser ? headDeptOf(currentUser.name) : null;
  const sc = d ? deptScoreOf(d) : null; if(!sc) return '';
  const diff = sc.now.score!=null && sc.prev.score!=null ? sc.now.score-sc.prev.score : null;
  return `<div class="panel" style="padding:14px 18px;display:flex;align-items:center;gap:18px;flex-wrap:wrap;cursor:pointer;" onclick="setSub('departments','${deptSlug(d)}')">
    ${scoreRingHTML(sc.now.score, 78)}
    <div style="flex:1;min-width:200px;"><div class="kpi-label">${esc(d)} score · ${monthLabel(deptScores.month)}</div><div style="margin-top:4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">${scoreGradePill(sc.now.score)}${diff==null?'':`<span style="font-size:12px;"><b style="color:${diff>=0?'var(--pos)':'var(--neg)'};">${diff>=0?'▲':'▼'}${Math.abs(diff)}</b> <span class="faint">vs ${monthLabel(prevMonth(deptScores.month)).slice(0,3)}</span></span>`}</div><div class="subtext" style="margin-top:4px;">Open the department for the breakdown</div></div>
  </div>`;
}
// One modal for every target (leadership only).
function openScoreTargets(){
  if(!isLeadershipRole(currentUser) || !scoreTargets) return;
  const t = scoreTargets;
  showModal(`
    <div class="modal-head"><h3>Score targets</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-score-targets"><div class="modal-body">
      <div class="subtext" style="font-size:12px;margin-top:0;">Scores measure each month against these. Changing them re-scores every month, past ones included.</div>
      <div class="section-label">Department revenue received (₹ / month)</div>
      <div class="field-row">${SERVICE_DEPARTMENTS.map(d=>`<div><label class="field-label">${esc(d)}</label><input class="field-input" type="number" min="0" step="5000" name="rev:${esc(d)}" value="${t.deptRevenue[d]||0}" required></div>`).join('')}</div>
      <div><label class="field-label">Client growth target (% a month)</label><input class="field-input" type="number" min="0" max="100" step="1" name="growth" value="${t.deptClientGrowth}" required></div>
      <div class="section-label">Sales</div>
      <div class="field-row cols-3">
        <div><label class="field-label">Sales target (₹ / month)</label><input class="field-input" type="number" min="10000" step="10000" name="srev" value="${t.sales.revenue}" required></div>
        <div><label class="field-label">Lead conversion (%)</label><input class="field-input" type="number" min="1" max="100" step="1" name="sconv" value="${t.sales.conversion}" required></div>
        <div><label class="field-label">Meetings / month</label><input class="field-input" type="number" min="1" step="1" name="smeet" value="${t.sales.meetings}" required></div>
      </div>
      <div class="section-label">Meta Ads (our own)</div>
      <div class="field-row cols-3">
        <div><label class="field-label">ROAS target (x)</label><input class="field-input" type="number" min="0.5" step="0.1" name="mroas" value="${t.meta.roas}" required></div>
        <div><label class="field-label">Cost per lead (₹)</label><input class="field-input" type="number" min="1" step="10" name="mcpl" value="${t.meta.cpl}" required></div>
        <div><label class="field-label">Lead → sale (%)</label><input class="field-input" type="number" min="0.5" step="0.5" name="mconv" value="${t.meta.conv}" required></div>
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save targets</button></div></div>
    </form>`);
  document.getElementById("f-score-targets").addEventListener("submit", async ev=>{
    ev.preventDefault(); const f = new FormData(ev.target);
    const body = {
      deptRevenue: Object.fromEntries(SERVICE_DEPARTMENTS.map(d=>[d, Number(f.get("rev:"+d))])),
      deptClientGrowth: Number(f.get("growth")),
      sales: { revenue:Number(f.get("srev")), conversion:Number(f.get("sconv")), meetings:Number(f.get("smeet")) },
      meta: { roas:Number(f.get("mroas")), cpl:Number(f.get("mcpl")), conv:Number(f.get("mconv")) },
    };
    try{
      await apiJson("/api/scores/targets", { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
      await Promise.all([loadDeptScores().catch(()=>{}), loadMetaScore().catch(()=>{})]);
      toast("Targets saved"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't save the targets"); }
  });
}
// Meta Ads tab: our own ads' month-vs-month tiles and score.
function metaAdsScorePanelHTML(){
  const d = metaScoreData; if(!d) return '';
  const P = monthLabel(prevMonth(d.month)).split(' ')[0], Ps = P.slice(0,3);
  const a = d.totals.now, b = d.totals.prev, partial = d.month===TODAY.slice(0,7);
  const r = x => x.spend ? x.revenue/x.spend : null, c = x => x.leads ? x.spend/x.leads : null;
  const tiles = [
    {label:"Spend", now:a.spend, was:b.spend, fmt:shortInr, neutral:true, total:true},
    {label:"Leads", now:a.leads, was:b.leads, fmt:String, total:true},
    {label:"Cost per lead", now:c(a)==null?null:Math.round(c(a)), was:c(b)==null?null:Math.round(c(b)), fmt:inr, lower:true},
    {label:"Sales", now:a.purchases, was:b.purchases, fmt:String, total:true},
    {label:"Revenue", now:a.revenue, was:b.revenue, fmt:shortInr, total:true},
    {label:"ROAS", now:r(a), was:r(b), fmt:x=>x.toFixed(1)+'x', eps:0.05},
  ];
  const tilesHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;">${tiles.map(x=>`<div style="padding:10px 12px;border-radius:8px;background:var(--surface-sunk);min-width:0;">
    <div style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-faint);">${x.label}</div>
    <div class="mono" style="font-size:17px;font-weight:800;margin-top:2px;">${x.now==null?'—':x.fmt(x.now)}</div>
    <div style="font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${partial&&x.total?`<span class="faint">${Ps} full month ${x.was==null?'—':x.fmt(x.was)}</span>`:`${x.now!=null&&x.was!=null?deltaHTML(x.now, x.was, {neutral:x.neutral, fmt:v=>x.fmt(v), eps:x.eps})+' ':''}<span class="faint">${Ps} ${x.was==null?'—':x.fmt(x.was)}</span>`}</div>
  </div>`).join('')}</div>`;
  const t = d.targets;
  const foot = `<div style="display:flex;flex-direction:column;gap:8px;">${tilesHTML}<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;color:var(--ink-soft);"><span>Targets: ROAS ${t.roas}x · CPL ${inr(t.cpl)} · lead → sale ${t.conv}%</span>${isLeadershipRole(currentUser)?`<button class="btn btn-sm ghost" onclick="openScoreTargets()">Set targets</button>`:''}</div></div>`;
  return monthScorePanelHTML(`Meta Ads Score · ${monthLabel(d.month)}`, `Return, cost per lead, conversion, lead pace and daily tracking · vs ${P}${partial?` · ${a.days} days logged so far`:''}`, d.now, d.prev, P, foot);
}

/* ===================== CLIENT FEEDBACK =====================
   One rating (1–5) per client, per service department, per month. The client gives it through a shareable link
   (public/feedback.html — no sign-in); the account manager or leadership can also log what a client said on a call or
   WhatsApp. It feeds each department's score and the Departments pages. A link stays open until 7 days after its month
   ends, and making a new link for the same client and month replaces the old one. */
let clientFeedbackData = {};   // clientId -> {feedback, link, canLog} | {forbidden:true}
async function loadClientFeedback(id){
  try{ clientFeedbackData[id] = await apiJson(`/api/crm/clients/${id}/feedback`); }
  catch(err){ clientFeedbackData[id] = { forbidden:true }; }
  if(nav.detail && nav.detail.type==='client' && nav.detail.id===id) render();
}
function starBarHTML(r, size){
  size = size || 13; const pct = r==null ? 0 : r/5*100;
  return `<span title="${r==null?'No rating':r.toFixed(1)+' / 5'}" style="position:relative;display:inline-block;font-size:${size}px;line-height:1;letter-spacing:1px;white-space:nowrap;"><span style="color:var(--line);">★★★★★</span><span style="position:absolute;left:0;top:0;width:${pct}%;overflow:hidden;color:var(--warn);">★★★★★</span></span>`;
}
const feedbackLinkUrl = l => `${location.origin}/feedback.html?t=${encodeURIComponent(l.token)}`;
function feedbackLinkMessage(c, l){
  return `Hi ${c.name} team,\n\nHow did we do this ${monthLabel(l.month).split(' ')[0]}? Please rate our ${l.depts.length>1?'services':l.depts[0].toLowerCase()+' work'} — it takes under a minute:\n${feedbackLinkUrl(l)}\n\nYour feedback goes straight to the team handling each service.\n— DesGro Media`;
}
// History + the Feedback link / Log feedback buttons, on the client's page.
function clientFeedbackSectionHTML(c){
  const d = clientFeedbackData[c.id];
  if(!d || d.forbidden) return '';
  const month = TODAY.slice(0,7);
  const list = d.feedback;
  const cur = list.filter(f=>f.month===month);
  const avg = cur.length ? cur.reduce((s,f)=>s+f.rating,0)/cur.length : null;
  return `<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;"><span>Client feedback${avg!=null?` · ${monthLabel(month).split(' ')[0]} average ${avg.toFixed(1)} ★`:''}</span><span style="display:flex;gap:6px;flex-wrap:wrap;"><button class="btn btn-sm" onclick="openClientFeedbackLink('${c.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-link"/></svg>Feedback link</button>${d.canLog?`<button class="btn btn-sm ghost" onclick="openClientFeedback('${c.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Log feedback</button>`:''}</span></div>
  ${list.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Month</th><th>Service</th><th>Rating</th><th>Comment</th><th>Source</th></tr></thead><tbody>${list.slice(0,8).map(f=>`<tr><td class="muted" style="white-space:nowrap;">${monthLabel(f.month)}</td><td>${esc(f.dept)}${f.projectId?` <span class="faint" style="font-weight:600;">· ${esc((clientTasks.find(t=>t.project===f.projectId)||{}).projectName||'project')}</span>`:''}</td><td style="white-space:nowrap;">${starBarHTML(f.rating, 12)} <b class="mono">${f.rating}</b></td><td class="muted">${f.comment?esc(f.comment):'—'}</td><td class="faint" style="font-size:11.5px;">${esc(f.via)}${f.by&&f.by!=="Client"&&!f.via.startsWith('Logged')?' · '+esc(f.by):''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">No feedback yet — send the client a feedback link.</div>`}`;
}
// Web Development is a one-off project, not a monthly service: it is rated once, after the project is delivered, and that rating is
// tied to the project. Every other service is rated monthly.
const PROJECT_FEEDBACK_SERVICES = ["Web Development"];
const isProjectFeedback = d => PROJECT_FEEDBACK_SERVICES.includes(d);
// Projects with every task Done, newest delivery first: [{id, title, doneDate}]
function deliveredProjects(clientId, dept){
  return boardProjects(clientId, dept).filter(p=>p.tasks.length && p.tasks.every(t=>t.status==="Done"))
    .map(p=>({id:p.id, title:p.title, doneDate:p.tasks.map(t=>t.doneDate||t.due).sort().pop()})).sort((a,b)=>(b.doneDate||'').localeCompare(a.doneDate||''));
}
// What one service's ask covers right now: the newest unrated delivered project, else the latest delivered one (re-rating); null = nothing to rate yet.
function feedbackAsk(c, dept, fbList){
  if(!isProjectFeedback(dept)) return {d:dept, project:null, existing:(fbList||[]).find(f=>f.dept===dept && f.month===TODAY.slice(0,7) && !f.projectId)||null};
  const done = deliveredProjects(c.id, dept); if(!done.length) return null;
  const p = done.find(x=>!(fbList||[]).some(f=>f.projectId===x.id)) || done[0];
  return {d:dept, project:p, existing:(fbList||[]).find(f=>f.projectId===p.id)||null};
}
// Staff logging: what the client said this month, per service. Replaces any rating already logged for that service.
function openClientFeedback(clientId){
  const c = clientById(clientId), d = clientFeedbackData[clientId]; if(!c || !d || !d.canLog) return;
  const month = TODAY.slice(0,7);
  const asks = c.services.filter(s=>SERVICE_DEPARTMENTS.includes(s)).map(s=>feedbackAsk(c, s, d.feedback)).filter(Boolean);
  if(!asks.length){ toast("Nothing to rate yet — website feedback opens once the project is delivered"); return; }
  const depts = asks.map(a=>a.d);
  const stars = s => `<div style="display:flex;gap:6px;flex-wrap:wrap;">${[1,2,3,4,5].map(n=>`<label class="check-chip" style="min-width:44px;justify-content:center;"><input type="radio" name="r-${esc(s)}" value="${n}">${n} ★</label>`).join('')}<span class="faint" style="font-size:11px;align-self:center;">leave blank to skip</span></div>`;
  showModal(`
    <div class="modal-head"><h3>Log client feedback — ${esc(c.name)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-client-feedback"><div class="modal-body">
      <div class="subtext" style="font-size:12px;margin-top:0;">What ${esc(c.name)} said — on a call, in a meeting or on WhatsApp. Monthly services are rated for this month; a website is rated once, for the delivered project. Replaces any rating already logged.</div>
      ${asks.map(a=>{ const s = a.d, ex = a.existing; return `<fieldset style="border:1px solid var(--line);border-radius:10px;padding:10px 12px 12px;margin:0;display:flex;flex-direction:column;gap:8px;">
        <legend style="font-weight:700;font-size:13px;padding:0 6px;">${esc(s)}${a.project?` <span class="faint" style="font-weight:600;">· ${esc(a.project.title)}</span>`:''}${ex?` <span class="faint" style="font-weight:600;">· currently ${ex.rating} ★</span>`:''}</legend>
        ${a.project?`<div class="faint" style="font-size:11.5px;">Delivered ${fmtDate(a.project.doneDate)} — one rating for the whole project.</div>`:''}
        ${stars(s)}
        <input class="field-input" name="c-${esc(s)}" placeholder="${a.project?'How was the project overall? (optional)':'Anything to add? (optional)'}" value="${ex?esc(ex.comment):''}">
      </fieldset>`; }).join('')}
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save</button></div></div>
    </form>`);
  document.getElementById("f-client-feedback").addEventListener("submit", async e=>{
    e.preventDefault(); const f = new FormData(e.target);
    const ratings = asks.map(a=>({dept:a.d, rating:Number(f.get("r-"+a.d)), comment:(f.get("c-"+a.d)||"").trim(), ...(a.project?{projectId:a.project.id}:{})})).filter(x=>x.rating);
    if(!ratings.length){ toast("Pick a rating for at least one service"); return; }
    try{
      await apiJson(`/api/crm/clients/${clientId}/feedback`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ ratings }) });
      await loadClientFeedback(clientId);
      if(nav.module==="departments") refreshTab("departments", nav.sub.departments);
      toast("Feedback logged"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't save the feedback"); }
  });
}
// The shareable link: pick the services, then copy / WhatsApp it.
async function openClientFeedbackLink(clientId, regenerate, depts){
  const c = clientById(clientId); if(!c) return;
  let link;
  try{
    const r = await apiJson(`/api/crm/clients/${clientId}/feedback-link`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ regenerate: !!regenerate, ...(depts?{depts}:{}) }) });
    link = r.link;
  }catch(err){ toast(err.message || "Couldn't make the link"); return; }
  const month = link.month;
  const rated = {}; ((clientFeedbackData[clientId]||{}).feedback||[]).filter(f=>f.month===month).forEach(f=>{ rated[f.dept] = f.rating; });
  const services = c.services.filter(s=>SERVICE_DEPARTMENTS.includes(s));
  showModal(`
    <div class="modal-head"><h3>Feedback link — ${esc(c.name)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;"><div class="subtext" style="margin:0;max-width:380px;">The client opens it without signing in and rates each service for ${monthLabel(month)}. Open till ${fmtDate(link.closesOn)}.</div>${pill(link.open?'Open':'Closed', link.open?'pos':'neutral')}</div>
      <div><label class="field-label">Services on this link</label>
        <div style="display:flex;flex-direction:column;gap:6px;">${services.map(s=>`<label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;cursor:pointer;"><input type="checkbox" ${link.depts.includes(s)?'checked':''} onchange="toggleFeedbackLinkDept('${clientId}','${esc(s)}', this.checked)"><span style="flex:1;font-weight:600;font-size:13px;">${esc(s)}</span>${rated[s]?`<span style="font-size:12px;white-space:nowrap;">${starBarHTML(rated[s], 11)} <b class="mono">${rated[s]}</b> <span class="faint">rated</span></span>`:'<span class="faint" style="font-size:11.5px;">not rated yet</span>'}</label>`).join('')}</div></div>
      <div><label class="field-label" for="cfl-input">Shareable link</label>
        <div style="display:flex;gap:8px;"><input class="field-input mono" id="cfl-input" readonly value="${esc(feedbackLinkUrl(link))}" style="flex:1;min-width:0;font-size:12.5px;"><button type="button" class="btn btn-sm" onclick="copyApplyText('cfl-input','Link copied')"><svg class="icon" style="width:12px;height:12px"><use href="#i-link"/></svg>Copy</button></div></div>
      <div><label class="field-label" for="cfl-msg">Ready-to-share message</label>
        <textarea class="field-input" id="cfl-msg" rows="9" readonly style="resize:vertical;font-family:inherit;">${esc(feedbackLinkMessage(c, link))}</textarea>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm ghost" onclick="window.open('https://wa.me/?text='+encodeURIComponent(document.getElementById('cfl-msg').value),'_blank')">Share on WhatsApp</button>
          <button type="button" class="btn btn-sm" onclick="copyApplyText('cfl-msg','Message copied')"><svg class="icon" style="width:12px;height:12px"><use href="#i-link"/></svg>Copy message</button>
        </div></div>
    </div>
    <div class="modal-foot"><div style="display:flex;gap:8px;flex-wrap:wrap;"><button type="button" class="btn ghost" onclick="window.open('${esc(feedbackLinkUrl(link))}&preview=1','_blank')">Preview form</button><button type="button" class="btn ghost" onclick="openClientFeedbackLink('${clientId}', true)" title="Makes a fresh link; the old one stops working">New link</button></div><button type="button" class="btn ghost" onclick="closeModal()">Close</button></div>`);
  if(!clientFeedbackData[clientId]) loadClientFeedback(clientId);
}
async function toggleFeedbackLinkDept(clientId, dept, on){
  const c = clientById(clientId);
  // Read the current set from the open modal's checkboxes' source of truth: the server's link for this month.
  const cur = (((clientFeedbackData[clientId]||{}).link)||null);
  let depts;
  try{ depts = (await apiJson(`/api/crm/clients/${clientId}/feedback-link`, { method:"POST", headers:{"Content-Type":"application/json"}, body:"{}" })).link.depts; }catch(err){ toast(err.message || "Couldn't update the link"); return; }
  depts = on ? [...new Set([...depts, dept])] : depts.filter(x=>x!==dept);
  if(!depts.length){ toast("Keep at least one service on the link"); openClientFeedbackLink(clientId); return; }
  depts.sort((a,b)=>c.services.indexOf(a)-c.services.indexOf(b));
  openClientFeedbackLink(clientId, false, depts);
}

/* ===================== HR PROGRAMS — team building, upskilling, training =====================
   HR plans each month's programs under HR → Programs. A month is "covered" when it has at least one of each type.
   Once a program has happened HR closes it out with who attended, what it cost and what came of it. Attendees (and
   only they) are then asked to rate it — anonymously, once, for 14 days — in their My Workspace or from a link HR
   shares. Staff see what they're invited to under "Coming up at DesGro"; programs also show on the Calendar. */
const PROGRAM_TYPES = ["Team Building","Upskilling","Training"];
const PROGRAM_TYPE_KIND = {"Team Building":"pos","Upskilling":"blue","Training":"warn"};
const PROGRAM_TYPE_HINT = {"Team Building":"bonding, offsites, celebrations","Upskilling":"new skills for the market — tools, platforms, trends","Training":"how we do things here — process, quality, conduct"};
const PROGRAM_STATUSES = ["Planned","Confirmed","Completed","Cancelled"];
const PROGRAM_STATUS_KIND = {Planned:"neutral",Confirmed:"blue",Completed:"pos",Cancelled:"neg"};
const PROGRAM_MODES = ["In office","Offsite","Online"];
const FEEDBACK_WINDOW_DAYS = 14;
let hrProgramMonth = TODAY.slice(0,7);
let hrPrograms = [];
let myProgramsData = { upcoming:[], feedbackDue:[] };
let calendarPrograms = [];
async function loadHrPrograms(){ try{ hrPrograms = (await apiJson("/api/hr/programs")).programs; }catch(err){ hrPrograms = []; } }
async function loadMyPrograms(){ myProgramsData = await apiJson("/api/hr/programs/mine"); }
async function loadCalendarPrograms(){ calendarPrograms = (await apiJson("/api/hr/programs/calendar")).programs; }
function canManagePrograms(){ return !!currentUser && (currentUser.isAdmin || isHRRole(currentUser) || isLeadershipRole(currentUser)); }
const programById = id => hrPrograms.find(p=>p.id===id);
function programInvitees(p){ return employees.filter(e=>e.employmentStatus!=="Left" && (p.audience.includes("All") || p.audience.includes(e.dept))); }
function programAudienceLabel(p){ return p.audience.includes("All") ? "All staff" : p.audience.length>2 ? p.audience.length+" departments" : p.audience.join(", "); }
function programsInMonth(month){ return hrPrograms.filter(p=>p.date.slice(0,7)===month).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)); }
function shiftHrProgramMonth(d){ const [y,m]=hrProgramMonth.split("-").map(Number); hrProgramMonth = new Date(Date.UTC(y,m-1+d,1)).toISOString().slice(0,7); render(); }
function starsHTML(r){ if(r==null) return '<span class="faint">—</span>'; const full = Math.round(r); return `<span style="color:var(--warn);letter-spacing:1px;">${'★'.repeat(full)}<span style="color:var(--line);">${'★'.repeat(5-full)}</span></span>`; }
const feedbackClosesOn = p => addDays(p.date, FEEDBACK_WINDOW_DAYS);
const feedbackIsOpen = p => p.status==="Completed" && TODAY <= feedbackClosesOn(p);
const programFeedbackLink = p => `${location.origin}/index.html#feedback/${p.id}`;
async function programApi(method, path, body, okMsg){
  try{
    const r = await apiJson("/api/hr/programs"+path, { method, headers:{"Content-Type":"application/json"}, body: body?JSON.stringify(body):undefined });
    if(okMsg) toast(okMsg);
    return r || true;
  }catch(err){ toast(err.message || "Couldn't save"); return null; }
}
const refreshPrograms = async ()=>{ await Promise.all([loadHrPrograms(), loadMyPrograms().catch(()=>{}), loadCalendarPrograms().catch(()=>{})]); };

function hrProgramsView(){
  const month = hrProgramMonth;
  const list = programsInMonth(month);
  const live = list.filter(p=>p.status!=="Cancelled");
  const done = list.filter(p=>p.status==="Completed");
  const budget = live.reduce((s,p)=>s+(p.budget||0),0), spent = live.reduce((s,p)=>s+(p.spent||0),0);
  const attRate = done.length ? Math.round(done.reduce((s,p)=>s+(p.attendees.length/Math.max(1,programInvitees(p).length)),0)/done.length*100) : null;
  const rated = done.filter(p=>p.rating!=null);
  const avgRating = rated.length ? rated.reduce((s,p)=>s+p.rating,0)/rated.length : null;
  const respAll = done.reduce((s,p)=>s+p.responses,0), attAll = done.reduce((s,p)=>s+p.attendees.length,0);
  const covered = PROGRAM_TYPES.map(t=>({t, n:live.filter(p=>p.type===t).length}));
  const manage = canManagePrograms();
  const months = [-1,0,1,2,3,4].map(d=>{ const [y,m]=month.split("-").map(Number); return new Date(Date.UTC(y,m-1+d,1)).toISOString().slice(0,7); });
  return `
  <div class="toolbar">
    <div style="display:flex;align-items:center;gap:6px;">
      <button class="btn btn-sm ghost" onclick="shiftHrProgramMonth(-1)">‹</button>
      <div style="font-weight:800;font-size:14px;min-width:140px;text-align:center;">${monthLabel(month)}</div>
      <button class="btn btn-sm ghost" onclick="shiftHrProgramMonth(1)">›</button>
    </div>
    ${manage?`<button class="btn primary" onclick="openProgram()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Plan a program</button>`:''}
  </div>
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-label">Programs</div><div class="kpi-value mono">${live.length}</div><div class="kpi-sub">${done.length} completed${list.length-live.length?` · ${list.length-live.length} cancelled`:''}</div></div>
    <div class="kpi-card"><div class="kpi-label">Attendance</div><div class="kpi-value mono">${attRate==null?'—':attRate+'%'}</div><div class="kpi-sub">of invited, completed programs</div></div>
    <div class="kpi-card"><div class="kpi-label">Feedback</div><div class="kpi-value mono">${avgRating==null?'—':avgRating.toFixed(1)}<span style="font-size:13px;color:var(--ink-soft);font-family:Manrope;"> / 5</span></div><div class="kpi-sub">from ${respAll} response${respAll===1?'':'s'}${attAll?' · '+Math.round(respAll/attAll*100)+'% replied':''}</div></div>
    <div class="kpi-card hero"><div class="kpi-label">Budget</div><div class="kpi-value mono" style="font-size:19px;">${inr(budget)}</div><div class="kpi-sub">${inr(spent)} spent so far</div></div>
  </div>
  <div class="banner ${covered.every(c=>c.n)?'muted':''}" style="align-items:center;flex-wrap:wrap;">
    <svg class="icon" style="width:15px;height:15px"><use href="#i-target"/></svg>
    <div style="flex:1;"><b>${monthLabel(month)} plan:</b> ${covered.every(c=>c.n)?'covers all three — team building, upskilling and training.':'missing '+covered.filter(c=>!c.n).map(c=>c.t.toLowerCase()).join(' and ')+'.'}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">${covered.map(c=>`<span class="pill ${c.n?PROGRAM_TYPE_KIND[c.t]:'neg'}">${c.t} · ${c.n}</span>`).join('')}</div>
  </div>
  <div class="panel">
    <div class="panel-head"><div><h3>${monthLabel(month)} programs</h3><div class="sub">${list.length?'In date order':'Nothing planned yet'}</div></div></div>
    ${list.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Program</th><th>Type</th><th>Audience</th><th class="num">Budget</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(p=>{ const inv = programInvitees(p).length; return `<tr style="${p.status==='Cancelled'?'opacity:.6;':''}">
        <td style="white-space:nowrap;"><div style="font-weight:700;">${fmtDateShort(p.date)}</div><div class="subtext">${WEEKDAY_NAMES[new Date(p.date+"T00:00:00").getDay()].slice(0,3)} · ${esc(p.time||'')}</div><div class="subtext">${esc(p.duration||'')}</div></td>
        <td style="min-width:300px;"><div style="font-weight:700;">${esc(p.title)}</div><div class="subtext" style="color:var(--ink-soft);">${esc(p.mode)}${p.venue?' · '+esc(p.venue):''}${p.facilitator?' · with '+esc(p.facilitator):''}</div>${p.objective?`<div class="subtext" style="max-width:300px;white-space:normal;">${esc(p.objective)}</div>`:''}${p.status==='Completed'&&p.outcome?`<div class="subtext" style="max-width:300px;white-space:normal;color:var(--ink-soft);"><b>Outcome:</b> ${esc(p.outcome)}</div>`:''}</td>
        <td>${pill(p.type, PROGRAM_TYPE_KIND[p.type])}</td>
        <td class="muted" title="${esc(p.audience.includes('All')?'All staff':p.audience.join(', '))}">${esc(programAudienceLabel(p))}<div class="subtext">${p.status==='Completed'?`${p.attendees.length} of ${inv} attended${p.rating!=null?` · <a href="#" onclick="openProgramResponses('${p.id}');return false;" style="color:inherit;text-decoration:underline;">★ ${p.rating.toFixed(1)} (${p.responses})</a>`:''}`:`${inv} invited`}</div></td>
        <td class="num mono">${p.budget?inr(p.budget):'—'}${p.status==='Completed'&&p.spent?`<div class="subtext">${inr(p.spent)} spent</div>`:''}</td>
        <td>${pill(p.status, PROGRAM_STATUS_KIND[p.status])}</td>
        <td class="num">${manage?`<div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;">${p.status!=='Completed'&&p.status!=='Cancelled'&&p.date<=TODAY?`<button class="btn btn-sm primary" onclick="openCompleteProgram('${p.id}')">Close out</button>`:''}${p.status==='Completed'?`<button class="btn btn-sm ${feedbackIsOpen(p)?'':'ghost'}" onclick="openProgramFeedbackLink('${p.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-link"/></svg>Feedback link</button>`:''}<button class="btn btn-sm ghost" onclick="openProgram('${p.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg></button></div>`:''}</td>
      </tr>`; }).join('')}
    </tbody></table></div>` : `<div class="empty">No programs planned for ${monthLabel(month)}.${manage?' Plan at least one team building, one upskilling and one training session.':''}</div>`}
  </div>
  <div class="panel">
    <div class="panel-head"><div><h3>Plan ahead</h3><div class="sub">Programs by month — click a month to open it</div></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Month</th>${PROGRAM_TYPES.map(t=>`<th class="num">${t}</th>`).join('')}<th class="num">Budget</th><th>Covered</th></tr></thead><tbody>
      ${months.map(mm=>{ const l = programsInMonth(mm).filter(p=>p.status!=="Cancelled"); const counts = PROGRAM_TYPES.map(t=>l.filter(p=>p.type===t).length); const ok = counts.every(n=>n>0); const b = l.reduce((s,p)=>s+(p.budget||0),0); return `<tr class="row-click" style="${mm===month?'background:var(--surface-sunk);':''}" onclick="hrProgramMonth='${mm}';render();">
        <td style="font-weight:700;">${monthLabel(mm)}${mm===TODAY.slice(0,7)?' <span class="faint" style="font-weight:600;">· this month</span>':''}</td>
        ${counts.map(n=>`<td class="num mono" style="${n?'':'color:var(--ink-faint);'}">${n||'—'}</td>`).join('')}
        <td class="num mono">${b?inr(b):'—'}</td>
        <td>${ok?pill('All three','pos'):pill(counts.filter(n=>n).length+' of 3','warn')}</td>
      </tr>`; }).join('')}
    </tbody></table></div>
  </div>`;
}
function openProgram(id){
  if(!canManagePrograms()) return;
  const p = id ? programById(id) : null;
  const aud = p ? p.audience : ["All"];
  showModal(`
    <div class="modal-head"><h3>${p?'Edit program':'Plan a program'}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-program"><div class="modal-body">
      <div><label class="field-label">Title</label><input class="field-input" name="title" required value="${esc(p?p.title:'')}" placeholder="e.g. AI tools for content production"></div>
      <div class="field-row">
        <div><label class="field-label">Type</label><select class="field-input" name="type">${PROGRAM_TYPES.map(t=>`<option value="${t}" ${p&&p.type===t?'selected':''}>${t} — ${PROGRAM_TYPE_HINT[t]}</option>`).join('')}</select></div>
        <div><label class="field-label">Status</label><select class="field-input" name="status">${PROGRAM_STATUSES.filter(s=>s!=='Completed'||(p&&p.status==='Completed')).map(s=>`<option ${p&&p.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
      </div>
      <div class="field-row cols-3">
        <div><label class="field-label">Date</label><input class="field-input" type="date" name="date" required value="${p?p.date:(hrProgramMonth===TODAY.slice(0,7)?TODAY:hrProgramMonth+'-01')}"></div>
        <div><label class="field-label">Time</label><input class="field-input" type="time" name="time" value="${p?p.time:'15:00'}"></div>
        <div><label class="field-label">Duration</label><input class="field-input" name="duration" value="${esc(p?p.duration:'2 hours')}"></div>
      </div>
      <div class="field-row cols-3">
        <div><label class="field-label">Mode</label><select class="field-input" name="mode">${PROGRAM_MODES.map(m=>`<option ${p&&p.mode===m?'selected':''}>${m}</option>`).join('')}</select></div>
        <div><label class="field-label">Venue / link</label><input class="field-input" name="venue" value="${esc(p?p.venue:'')}" placeholder="Conference room"></div>
        <div><label class="field-label">Facilitator</label><input class="field-input" name="facilitator" list="program-facilitators" value="${esc(p?p.facilitator:'')}" placeholder="Staff or external trainer"><datalist id="program-facilitators">${activeEmployees().map(e=>`<option value="${esc(e.name)}">`).join('')}</datalist></div>
      </div>
      <div><label class="field-label">Who's it for</label><div class="check-row">
        <label class="check-chip"><input type="checkbox" name="audience" value="All" ${aud.includes("All")?'checked':''}>All staff</label>
        ${DEPARTMENTS.map(d=>`<label class="check-chip"><input type="checkbox" name="audience" value="${esc(d)}" ${!aud.includes("All")&&aud.includes(d)?'checked':''}>${esc(d)}</label>`).join('')}
      </div></div>
      <div><label class="field-label">Objective</label><input class="field-input" name="objective" value="${esc(p?p.objective:'')}" placeholder="What should people be able to do afterwards?"></div>
      <div><label class="field-label">Budget (₹)</label><input class="field-input" type="number" min="0" step="500" name="budget" value="${p?p.budget||0:0}"></div>
    </div>
    <div class="modal-foot"><div>${p?`<button type="button" class="btn ghost" style="color:var(--neg);" onclick="deleteProgram('${p.id}')">Delete</button>`:''}</div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">${p?'Save':'Add to plan'}</button></div></div>
    </form>`);
  document.getElementById("f-program").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    let audience = f.getAll("audience");
    if(!audience.length || audience.includes("All")) audience = ["All"];
    const data = {title:f.get("title"), type:f.get("type"), status:f.get("status"), date:f.get("date"), time:f.get("time")||"", duration:f.get("duration")||"", mode:f.get("mode"), venue:f.get("venue")||"", facilitator:f.get("facilitator")||"", audience, objective:f.get("objective")||"", budget:Number(f.get("budget"))||0};
    const ok = p ? await programApi("PUT", `/${p.id}`, data, "Program updated") : await programApi("POST", "", data, "Added to the plan");
    if(ok){ hrProgramMonth = data.date.slice(0,7); await refreshPrograms(); closeModal(); render(); }
  });
}
async function deleteProgram(id){
  if(!canManagePrograms() || !confirm("Delete this program? Its attendance and feedback go with it.")) return;
  if(await programApi("DELETE", `/${id}`, null, "Program removed")){ await refreshPrograms(); closeModal(); render(); }
}
// Close out a program once it has happened: who came, what it cost, what came of it.
function openCompleteProgram(id){
  const p = programById(id);
  if(!p || !canManagePrograms()) return;
  const invited = programInvitees(p);
  const presentIds = p.attendees.length ? p.attendees.map(a=>a.id) : invited.map(e=>e._dbId);
  showModal(`
    <div class="modal-head"><h3>Close out — ${esc(p.title)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-program-done"><div class="modal-body">
      <div class="subtext" style="font-size:12px;margin-top:0;">${fmtDate(p.date)} · ${esc(programAudienceLabel(p))} · ${invited.length} invited</div>
      <div><label class="field-label">Who attended <span class="faint">(untick anyone who didn't)</span></label>
        <div class="check-row" style="max-height:200px;overflow:auto;">${invited.map(e=>`<label class="check-chip"><input type="checkbox" name="att" value="${esc(e._dbId)}" ${presentIds.includes(e._dbId)?'checked':''}>${esc(e.name)}</label>`).join('')}</div></div>
      <div><label class="field-label">Actual spend (₹)</label><input class="field-input" type="number" min="0" step="100" name="spent" value="${p.spent||0}"></div>
      <div class="subtext">Once it's closed out, everyone ticked above is asked to rate it in their My Workspace — the program's rating comes from them.</div>
      <div><label class="field-label">Outcome</label><textarea class="field-input" name="outcome" rows="2" placeholder="What came out of it — follow-ups, what to repeat or drop">${esc(p.outcome||'')}</textarea></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Mark completed</button></div></div>
    </form>`);
  document.getElementById("f-program-done").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    if(await programApi("POST", `/${p.id}/complete`, {attendeeIds:f.getAll("att"), spent:Number(f.get("spent"))||0, outcome:(f.get("outcome")||"").trim()}, "Program closed out — share the feedback link")){
      await refreshPrograms(); closeModal(); render(); openProgramFeedbackLink(p.id);
    }
  });
}
// An attendee's anonymous rating (or, with preview, HR looking at the form without saving anything).
function openProgramFeedback(programId, preview){
  const p = programById(programId) || myProgramsData.feedbackDue.find(x=>x.id===programId);
  if(preview && !canManagePrograms()) preview = false;
  if(!p || !currentUser) return;
  const scale = (name, label, lo, hi) => `<div><label class="field-label">${label}</label><div style="display:flex;gap:6px;flex-wrap:wrap;">${[1,2,3,4,5].map(n=>`<label class="check-chip" style="min-width:44px;justify-content:center;"><input type="radio" name="${name}" value="${n}" ${n===4?'checked':''} required>${n}</label>`).join('')}<span class="faint" style="font-size:11px;align-self:center;">1 = ${lo} · 5 = ${hi}</span></div></div>`;
  showModal(`
    <div class="modal-head"><h3>How was it? — ${esc(p.title)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-program-feedback"><div class="modal-body">
      ${preview?`<div class="banner" style="background:var(--warn-soft);color:var(--ink);"><div><b>Preview.</b> This is what attendees see when they open the feedback link. Nothing you enter here is saved.</div></div>`:''}
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Anonymous — HR sees the ratings and comments, not who wrote them.</div></div>
      ${scale("rating","Overall, how was this program?","poor","excellent")}
      ${scale("useful", p.type==="Team Building" ? "Did it bring the team closer?" : "How useful is it for your work?", "not at all","very")}
      <div><label class="field-label">Anything to keep, change or drop?</label><textarea class="field-input" name="comment" rows="3" placeholder="Optional"></textarea></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;">${preview?`<button type="button" class="btn ghost" onclick="openProgramFeedbackLink('${p.id}')">Back to link</button>`:`<button type="button" class="btn ghost" onclick="closeModal()">Later</button>`}<button type="submit" class="btn primary">Send feedback</button></div></div>
    </form>`);
  document.getElementById("f-program-feedback").addEventListener("submit", async e=>{
    e.preventDefault();
    if(preview){ toast("Preview only — nothing saved"); openProgramFeedbackLink(p.id); return; }
    const f = new FormData(e.target);
    if(await programApi("POST", `/${p.id}/feedback`, {rating:Number(f.get("rating"))||4, useful:Number(f.get("useful"))||4, comment:(f.get("comment")||"").trim()}, "Thanks — feedback sent")){
      await Promise.all([loadMyPrograms().catch(()=>{}), loadHrPrograms()]); closeModal(); render();
    }
  });
}
function programFeedbackMessage(p){
  return `Hi team, thanks for joining "${p.title}" on ${fmtDate(p.date)}.\n\nPlease rate it here. It takes 20 seconds and it's anonymous:\n${programFeedbackLink(p)}\n\nOpen till ${fmtDate(feedbackClosesOn(p))}.`;
}
async function openProgramFeedbackLink(id){
  const p = programById(id);
  if(!p || !canManagePrograms()) return;
  const n = p.attendees.length;
  const state = p.status!=="Completed" ? {k:'warn', t:'Opens after close-out', d:`The link works once you close out the program and tick who attended — only they can rate it.`}
    : feedbackIsOpen(p) ? {k:'pos', t:'Open till '+fmtDateShort(feedbackClosesOn(p)), d:`Anyone marked as attending can rate it once, up to ${FEEDBACK_WINDOW_DAYS} days after the program.`}
    : {k:'neutral', t:'Closed '+fmtDateShort(feedbackClosesOn(p)), d:`Feedback closed ${FEEDBACK_WINDOW_DAYS} days after the program. The link now tells people it has closed.`};
  showModal(`
    <div class="modal-head"><h3>Feedback link — ${esc(p.title)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
        <div style="min-width:0;"><div style="font-size:12.5px;color:var(--ink-soft);">${fmtDate(p.date)} · ${pill(p.type, PROGRAM_TYPE_KIND[p.type])}</div><div class="subtext" style="margin-top:4px;max-width:360px;">${state.d}</div></div>
        ${pill(state.t, state.k)}
      </div>
      ${p.status==="Completed" ? `<div><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;"><span class="field-label" style="margin:0;">Responses</span><span><b class="mono">${p.responses}</b> <span class="faint">of ${n} attendees · ${n?Math.round(p.responses/n*100):0}%</span></span></div><div class="bar-track" style="height:8px;"><div class="bar-fill" style="width:${n?Math.min(100,p.responses/n*100):0}%;background:var(--blue);"></div></div><div class="subtext">${n-p.responses>0?`${n-p.responses} still to reply. They also see a reminder in their My Workspace.`:'Everyone has replied.'}</div></div>` : ''}
      <div><label class="field-label" for="fb-link-input">Shareable link</label>
        <div style="display:flex;gap:8px;"><input class="field-input mono" id="fb-link-input" readonly value="${esc(programFeedbackLink(p))}" style="flex:1;min-width:0;font-size:12.5px;"><button type="button" class="btn btn-sm" onclick="copyApplyText('fb-link-input','Link copied')"><svg class="icon" style="width:12px;height:12px"><use href="#i-link"/></svg>Copy</button></div></div>
      <div><label class="field-label" for="fb-msg-textarea">Ready-to-share message</label>
        <textarea class="field-input" id="fb-msg-textarea" rows="8" readonly style="resize:vertical;font-family:inherit;">${esc(programFeedbackMessage(p))}</textarea>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm ghost" onclick="window.open('https://wa.me/?text='+encodeURIComponent(document.getElementById('fb-msg-textarea').value),'_blank')">Share on WhatsApp</button>
          <button type="button" class="btn btn-sm" onclick="copyApplyText('fb-msg-textarea','Message copied')"><svg class="icon" style="width:12px;height:12px"><use href="#i-link"/></svg>Copy message</button>
        </div></div>
    </div>
    <div class="modal-foot"><div><button type="button" class="btn ghost" onclick="openProgramFeedback('${p.id}', true)">Preview form</button></div><div style="display:flex;gap:8px;">${p.status==="Completed"&&p.responses?`<button type="button" class="btn ghost" onclick="openProgramResponses('${p.id}')">See responses</button>`:''}${p.status!=="Completed"&&p.status!=="Cancelled"&&p.date<=TODAY?`<button type="button" class="btn primary" onclick="openCompleteProgram('${p.id}')">Close out</button>`:`<button type="button" class="btn ghost" onclick="closeModal()">Close</button>`}</div></div>`);
}
// What someone sees after opening a feedback link and signing in.
async function openFeedbackFromLink(id){
  try{ history.replaceState(null, '', location.pathname+location.search); }catch(e){}
  if(!currentUser) return;
  const note = (title, body) => showModal(`
    <div class="modal-head"><h3>${title}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body"><div style="font-size:13px;line-height:1.55;">${body}</div></div>
    <div class="modal-foot"><div></div><button type="button" class="btn primary" onclick="closeModal()">OK</button></div>`);
  try{ await loadMyPrograms(); }catch(e){}
  const due = myProgramsData.feedbackDue.find(x=>x.id===id);
  if(due) return openProgramFeedback(id);
  note("Nothing to rate here", "This feedback link isn't open for you — it may have closed (feedback stays open for 14 days), you may have rated it already, or HR didn't mark you as attending. Check with HR if you were there.");
}
// HR's view of a program's responses — distribution + comments, no names.
async function openProgramResponses(programId){
  const p = programById(programId); if(!p) return;
  let r; try{ r = await apiJson(`/api/hr/programs/${programId}/responses`); }catch(err){ toast(err.message || "Couldn't load responses"); return; }
  const max = Math.max(1, ...r.distribution.map(d=>d.count));
  showModal(`
    <div class="modal-head"><h3>Feedback — ${esc(p.title)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);">
        <div class="kpi-card"><div class="kpi-label">Overall</div><div class="kpi-value mono">${r.rating==null?'—':r.rating.toFixed(1)}<span style="font-size:13px;color:var(--ink-soft);font-family:Manrope;"> / 5</span></div><div class="kpi-sub">${starsHTML(r.rating)}</div></div>
        <div class="kpi-card"><div class="kpi-label">${p.type==="Team Building"?"Team bonding":"Usefulness"}</div><div class="kpi-value mono">${r.useful==null?'—':r.useful.toFixed(1)}<span style="font-size:13px;color:var(--ink-soft);font-family:Manrope;"> / 5</span></div></div>
        <div class="kpi-card"><div class="kpi-label">Responses</div><div class="kpi-value mono">${r.responses}<span style="font-size:13px;color:var(--ink-soft);font-family:Manrope;"> / ${r.attendees}</span></div><div class="kpi-sub">${r.attendees?Math.round(r.responses/r.attendees*100):0}% of attendees</div></div>
      </div>
      <div class="barchart">${r.distribution.map(d=>`<div class="bar-row" style="grid-template-columns:60px 1fr 28px;"><div class="bar-label">${'★'.repeat(d.rating)}</div><div class="bar-track"><div class="bar-fill" style="width:${d.count/max*100}%;background:var(--warn);"></div></div><div class="bar-val">${d.count}</div></div>`).join('')}</div>
      <div class="section-label">Who has responded</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12.5px;">
        <div><div style="font-weight:700;color:var(--pos);margin-bottom:4px;">Rated · ${r.submitted.length}</div>${r.submitted.length?r.submitted.map(n=>`<div>${esc(n)}</div>`).join(''):'<div class="faint">Nobody yet</div>'}</div>
        <div><div style="font-weight:700;color:var(--warn);margin-bottom:4px;">Yet to rate · ${r.pending.length}</div>${r.pending.length?r.pending.map(n=>`<div>${esc(n)}</div>`).join(''):'<div class="faint">Everyone has rated</div>'}</div>
      </div>
      <div class="subtext">Names show only who has rated — comments and ratings below are never linked to a person.</div>
      <div class="section-label">Comments</div>
      ${r.comments.length ? r.comments.map(c=>`<div style="padding:8px 10px;border-radius:8px;background:var(--surface-sunk);font-size:12.5px;">“${esc(c.text)}” <span class="faint" style="font-size:11px;">· ${c.rating}★</span></div>`).join('') : `<div class="empty" style="padding:10px;">No comments yet.</div>`}
    </div>
    <div class="modal-foot"><div style="display:flex;gap:8px;flex-wrap:wrap;"><button type="button" class="btn ghost" onclick="openProgramFeedbackLink('${p.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-link"/></svg>Feedback link</button>
      <button type="button" class="btn" onclick="shareProgramFeedbackWhatsApp('${p.id}')">Share results on WhatsApp</button>${r.pending.length?`<button type="button" class="btn ghost" onclick="remindProgramFeedbackWhatsApp('${p.id}')">Remind ${r.pending.length} on WhatsApp</button>`:''}</div><button type="button" class="btn ghost" onclick="closeModal()">Close</button></div>`);
  programResponsesCache = {id:programId, r};
}
let programResponsesCache = null;
// WhatsApp has no ERP integration here, so these open WhatsApp with the message filled in — HR picks the group or people to send it to.
function shareProgramFeedbackWhatsApp(id){
  const p = programById(id), r = programResponsesCache && programResponsesCache.id===id ? programResponsesCache.r : null; if(!p || !r) return;
  const lines = [`*Feedback — ${p.title}* (${fmtDate(p.date)})`, `Overall ${r.rating==null?'—':r.rating.toFixed(1)}/5 · ${p.type==="Team Building"?"Team bonding":"Usefulness"} ${r.useful==null?'—':r.useful.toFixed(1)}/5 · ${r.responses} of ${r.attendees} responded`];
  if(r.comments.length) lines.push('', 'What people said:', ...r.comments.map(c=>`• "${c.text}" (${c.rating}★)`));
  lines.push('', 'Thank you all for the feedback — it shapes our next programs.');
  window.open('https://wa.me/?text='+encodeURIComponent(lines.join('\n')), '_blank');
}
function remindProgramFeedbackWhatsApp(id){
  const p = programById(id); if(!p) return;
  window.open('https://wa.me/?text='+encodeURIComponent(programFeedbackMessage(p)), '_blank');
}
// Staff My Workspace: programs they attended and haven't rated.
function feedbackDueHTML(){
  const due = myProgramsData.feedbackDue;
  if(!currentUser || !due.length) return '';
  return `<div class="banner" style="background:var(--warn-soft);color:var(--ink);align-items:center;flex-wrap:wrap;"><svg class="icon" style="width:15px;height:15px"><use href="#i-megaphone"/></svg><div style="flex:1;min-width:220px;"><b>Rate ${due.length>1?due.length+' programs':'a program'} you attended</b> — 20 seconds, anonymous. Open for ${FEEDBACK_WINDOW_DAYS} days after each program.</div><div style="display:flex;gap:6px;flex-wrap:wrap;">${due.slice(0,2).map(p=>`<button class="btn btn-sm primary" onclick="openProgramFeedback('${p.id}')">${esc(p.title.length>26?p.title.slice(0,25)+'…':p.title)}</button>`).join('')}</div></div>`;
}
// Everyone's My Workspace: what's coming up that they're invited to.
function upcomingProgramsHTML(){
  const list = myProgramsData.upcoming.slice(0,3);
  if(!currentUser || !list.length) return '';
  return `
  <div class="panel">
    <div class="panel-head"><div><h3>Coming up at DesGro</h3><div class="sub">Team building, upskilling and training you're invited to</div></div></div>
    <div class="panel-body">${list.map(p=>`<div class="feed-item"><div class="feed-dot" style="background:var(--${PROGRAM_TYPE_KIND[p.type]==='pos'?'pos':PROGRAM_TYPE_KIND[p.type]==='blue'?'blue':'warn'});"></div><div style="flex:1;"><div class="feed-text"><strong>${esc(p.title)}</strong> ${pill(p.type, PROGRAM_TYPE_KIND[p.type])}</div><div class="feed-time">${fmtDate(p.date)} · ${esc(p.time||'')} · ${esc(p.mode)}${p.venue?' · '+esc(p.venue):''}${p.facilitator?' · with '+esc(p.facilitator):''}</div></div></div>`).join('')}</div>
  </div>`;
}

/* ---- Sales meetings: logged by the salesperson, counted in the Sales score ---- */
function openLogSalesMeeting(leadId){
  if(!currentUser) return;
  const l = leadId ? leadById(leadId) : null;
  const mine = marketingLeads.filter(x=>!x.convertedClientId && leadStage(x)!=="Lost" && canWorkLead(x));
  showModal(`
    <div class="modal-head"><h3>Log sales meeting</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-sales-meeting"><div class="modal-body">
      <div><label class="field-label" for="sm-lead">With</label><select class="field-input" id="sm-lead" name="lead"><option value="">A prospect not in leads yet</option>${mine.map(x=>`<option value="${x.id}" ${l&&l.id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div><label class="field-label" for="sm-with">Prospect name (if not a lead)</label><input class="field-input" id="sm-with" name="with" placeholder="e.g. Kozhikode hospital group"></div>
      <div class="field-row">
        <div><label class="field-label" for="sm-date">Date</label><input class="field-input" type="date" id="sm-date" name="date" value="${TODAY}" max="${TODAY}" required></div>
        <div><label class="field-label" for="sm-mode">How</label><select class="field-input" id="sm-mode" name="mode"><option>In person</option><option>Video</option><option>Call</option></select></div>
      </div>
      <div><label class="field-label" for="sm-notes">Notes (optional)</label><textarea class="field-input" id="sm-notes" name="notes" rows="2" placeholder="What was discussed, next step"></textarea></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Log meeting</button></div></div>
    </form>`);
  document.getElementById("f-sales-meeting").addEventListener("submit", async e=>{
    e.preventDefault(); const f = new FormData(e.target);
    const lid = f.get("lead")||null, who = (f.get("with")||"").trim();
    if(!lid && !who){ toast("Pick a lead or type who the meeting was with"); return; }
    try{
      await apiJson("/api/crm/sales-meetings", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ date:f.get("date"), mode:f.get("mode"), leadId:lid, withName:lid?"":who, notes:(f.get("notes")||"").trim() }) });
      toast("Meeting logged"); closeModal();
      if(deptScores) loadDeptScores().catch(()=>{});
      render();
    }catch(err){ toast(err.message || "Couldn't log the meeting"); }
  });
}

/* ===================== CLIENT REPORT LINK =====================
   A Performance Marketing client's page can be shared as a no-login, read-only report (public/report.html): their ad
   numbers month by month, the campaign brief and the meetings log — never invoices, payments, quotes, tasks, ad-account
   access or who on our side logged anything. One permanent link per client; "New link" replaces it (the old one stops
   working) and "Turn off" removes the report. */
let clientReportLinks = {};   // clientId -> {token,createdBy,createdAt} | null (none) | undefined (not loaded)
async function loadClientReportLink(id){
  try{ clientReportLinks[id] = (await apiJson(`/api/crm/clients/${id}/report-link`)).link; }
  catch(err){ clientReportLinks[id] = undefined; }
  if(nav.detail && nav.detail.type==='client' && nav.detail.id===id) render();
}
const clientReportUrl = l => `${location.origin}/report.html?t=${encodeURIComponent(l.token)}`;
function clientReportMessage(c, l){
  return `Hi ${c.name} team,\n\nHere's your live campaign report — your ad numbers month by month, your campaign brief and our meetings:\n${clientReportUrl(l)}\n\nIt updates as we log your numbers.\n— DesGro Media`;
}
function clientReportSectionHTML(c){
  if(!isPerformanceMarketingClient(c)) return '';
  const l = clientReportLinks[c.id];
  if(l===undefined) return '';
  return collabHead('Client report', null, collabBtn(`openClientReportLink('${c.id}')`,'i-link', l?'Share link':'Create share link')) +
    `<div class="subtext" style="margin:0 0 6px;">${l?`A read-only page your client can open without signing in — ad numbers, campaign brief and meetings. Link made ${fmtDateShort(l.createdAt)} by ${esc(l.createdBy)}.`:'Give the client a link to see their ad numbers, campaign brief and meetings in one page — no sign-in needed.'}</div>`;
}
async function openClientReportLink(clientId, regenerate){
  const c = clientById(clientId); if(!c) return;
  try{
    const r = await apiJson(`/api/crm/clients/${clientId}/report-link`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ regenerate: !!regenerate }) });
    clientReportLinks[clientId] = r.link;
  }catch(err){ toast(err.message || "Couldn't make the link"); return; }
  const l = clientReportLinks[clientId];
  showModal(`
    <div class="modal-head"><h3>Client report — ${esc(c.name)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Anyone with this link can see ${esc(c.name)}'s <b>ad numbers</b> (by month and by day), <b>campaign brief</b> and <b>meetings log</b> — including the meeting notes. They can't see invoices, payments, quotes, tasks or ad-account details. The page updates as you log numbers.</div></div>
      <div><label class="field-label" for="crl-input">Shareable link</label>
        <div style="display:flex;gap:8px;"><input class="field-input mono" id="crl-input" readonly value="${esc(clientReportUrl(l))}" style="flex:1;min-width:0;font-size:12.5px;"><button type="button" class="btn btn-sm" onclick="copyApplyText('crl-input','Link copied')"><svg class="icon" style="width:12px;height:12px"><use href="#i-link"/></svg>Copy</button></div></div>
      <div><label class="field-label" for="crl-msg">Ready-to-share message</label>
        <textarea class="field-input" id="crl-msg" rows="7" readonly style="resize:vertical;font-family:inherit;">${esc(clientReportMessage(c, l))}</textarea>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm ghost" onclick="window.open('https://wa.me/?text='+encodeURIComponent(document.getElementById('crl-msg').value),'_blank')">Share on WhatsApp</button>
          <button type="button" class="btn btn-sm" onclick="copyApplyText('crl-msg','Message copied')"><svg class="icon" style="width:12px;height:12px"><use href="#i-link"/></svg>Copy message</button>
        </div></div>
    </div>
    <div class="modal-foot"><div style="display:flex;gap:8px;flex-wrap:wrap;"><button type="button" class="btn ghost" onclick="window.open('${esc(clientReportUrl(l))}','_blank')">Preview report</button><button type="button" class="btn ghost" onclick="openClientReportLink('${clientId}', true)" title="Makes a fresh link; the old one stops working">New link</button><button type="button" class="btn ghost" style="color:var(--neg);" onclick="removeClientReportLink('${clientId}')">Turn off</button></div><button type="button" class="btn ghost" onclick="closeModal()">Close</button></div>`);
  render();
}
async function removeClientReportLink(clientId){
  if(!confirm("Turn off this report link? The client's current link stops working straight away.")) return;
  try{ await Auth.apiFetch(`/api/crm/clients/${clientId}/report-link`, { method:"DELETE" }); clientReportLinks[clientId] = null; toast("Report link turned off"); closeModal(); render(); }
  catch(err){ toast("Couldn't turn the link off"); }
}

/* ===================== NAV MODEL ===================== */
const MODULES = [
  {id:"dashboard", label:"Dashboard", icon:"i-home"},
  {id:"workspace", label:"My Workspace", icon:"i-briefcase", sub:[
    {id:"overview", label:"Overview", icon:"i-trend"},
    {id:"plan", label:"My Action Plan", icon:"i-target", when:()=>isDeptHead(currentUser), count:()=>myPlanPending()},
    {id:"plans", label:"Dept Action Plans", icon:"i-target", when:()=>canSeePlans(currentUser), count:()=>openNeedsInput().length},
    {id:"tasks", label:"My Tasks", icon:"i-board", count:()=>currentUser?clientTasks.filter(t=>isMyTask(t) && t.status!=="Done").length+myContentItems.filter(i=>i.stage!=="Published").length:0},
    {id:"attendance", label:"My Attendance", icon:"i-attendance", count:()=>currentUser?leaveRequests.filter(l=>l.empId===currentUser.id && l.status==="Pending").length:0},
    {id:"payroll", label:"My Payroll", icon:"i-wallet", count:()=>currentUser?advances.filter(a=>a.empId===currentUser.id && a.status==="Pending").length + withdrawalRequests.filter(w=>w.empId===currentUser.id && w.status==="Pending").length:0},
    {id:"payments", label:"Payment Requests", icon:"i-receipt", count:()=>currentUser?paymentRequests.filter(r=>r.empId===currentUser.id && r.status==="Pending").length:0},
    {id:"complaints", label:"Complaints", icon:"i-megaphone"},
  ]},
  {id:"calendar", label:"Calendar", icon:"i-calendar"},
  {id:"departments", label:"Departments", icon:"i-building", sub:[
    {id:"overview", label:"Overview", icon:"i-trend"},
    ...DEPARTMENTS.map(d=>({id:deptSlug(d), label:d, icon:"i-users", when:()=>canSeeDeptPage(d)})),
  ]},
  {id:"hr", label:"HR", icon:"i-users", sub:[
    {id:"overview", label:"Overview", icon:"i-trend"},
    {id:"directory", label:"Directory", icon:"i-users"},
    {id:"attendance", label:"Attendance & Leave", icon:"i-attendance", count:()=>leaveRequests.filter(l=>l.status==="Pending").length},
    {id:"hiring", label:"Hiring", icon:"i-target", count:()=>openPositions.filter(p=>p.status==="Open").length},
    {id:"programs", label:"Programs", icon:"i-users"},
    {id:"payroll", label:"Payroll", icon:"i-wallet"},
    {id:"advances", label:"Advances & Withdrawals", icon:"i-coins", count:()=>advances.filter(a=>a.status==="Pending").length + withdrawalRequests.filter(w=>w.status==="Pending").length},
    {id:"complaints", label:"Complaints", icon:"i-megaphone", count:()=>complaints.filter(c=>c.status==="New").length},
    {id:"notices", label:"Notices", icon:"i-bell"},
    {id:"policies", label:"HR Settings", icon:"i-sliders"},
  ]},
  {id:"marketing", label:"Marketing", icon:"i-megaphone", sub:[
    {id:"overview", label:"Overview", icon:"i-trend"},
    {id:"content", label:"Content", icon:"i-board"},
    {id:"performance", label:"Meta Ads", icon:"i-target"},
  ]},
  {id:"sales", label:"Sales", icon:"i-handshake", sub:[
    {id:"overview", label:"Overview", icon:"i-trend"},
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
    {id:"quotes", label:"Quotes", icon:"i-handshake", count:()=>quotes.filter(q=>q.status==="Submitted to Finance").length},
    {id:"invoices", label:"Invoices", icon:"i-receipt", count:()=>invoices.filter(i=>invoiceStatus(i)==="Overdue").length},
    {id:"receipts", label:"Payment Receipts", icon:"i-receipt", count:()=>pendingSalesPayments().length},
    {id:"requests", label:"Payment Requests", icon:"i-coins", count:()=>pendingAdvanceDisbursements.length+pendingPaymentRequests().length},
    {id:"payroll", label:"Payroll", icon:"i-wallet", count:()=>{ const m = payroll.history[payroll.selectedMonth]; return m ? employees.filter(e=>e.dept!=='Sales' && !(e.id in m.entries)).length : 0; }},
    {id:"payables", label:"Payables", icon:"i-coins", count:()=>payables.filter(p=>payableStatus(p)!=="Paid").length},
    {id:"expenses", label:"Expenses", icon:"i-file"},
    {id:"banks", label:"Banks", icon:"i-building"},
    {id:"commissions", label:"Commissions", icon:"i-percent", count:()=>payables.filter(p=>p.category==="Commission" && payableBalance(p)>0).length},
    {id:"coa", label:"Chart of Accounts", icon:"i-sliders"},
    {id:"journal", label:"Journal", icon:"i-edit"},
    {id:"reports", label:"Reports", icon:"i-file"},
  ]},
];
let nav = {module:"dashboard", sub:{workspace:"overview", calendar:"main", departments:"overview", hr:"overview", marketing:"overview", sales:"overview", clients:"overview", accounts:"overview"}, detail:null};

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
  {id:"plan", label:"My Action Plan", icon:"i-target", when:()=>isDeptHead(currentUser), count:()=>myPlanPending()},
  {id:"tasks", label:"My Tasks", icon:"i-board", count:()=>currentUser?clientTasks.filter(t=>isMyTask(t) && t.status!=="Done").length+myContentItems.filter(i=>i.stage!=="Published").length:0},
  {id:"attendance", label:"My Attendance", icon:"i-attendance", count:()=>currentUser?leaveRequests.filter(l=>l.empId===currentUser.id && l.status==="Pending").length:0},
  {id:"payroll", label:"My Payroll", icon:"i-wallet", count:()=>currentUser?advances.filter(a=>a.empId===currentUser.id && a.status==="Pending").length + withdrawalRequests.filter(w=>w.empId===currentUser.id && w.status==="Pending").length:0},
  {id:"payments", label:"Payment Requests", icon:"i-receipt", count:()=>currentUser?paymentRequests.filter(r=>r.empId===currentUser.id && r.status==="Pending").length:0},
  {id:"commission", label:"My Commission", icon:"i-percent", count:()=>currentUser?payables.filter(p=>p.category==="Commission" && p.salesPerson===currentUser.name && payableBalance(p)>0).length:0},
  {id:"leaderboard", label:"Leaderboard", icon:"i-target"},
  {id:"complaints", label:"Complaints", icon:"i-megaphone"},
];
// Module access HR can hand out (Add/Edit Employee). Each checkbox maps to one stored User role; the
// sidebar is the union of whatever is ticked, and the API enforces the same roles server-side.
// Roles not listed here (ADMIN, SALES_HEAD, EMPLOYEE) are never touched by these checkboxes.
const ACCESS_MODULES = [
  {label:"HR", role:"HR"},
  {label:"Marketing and Sales", role:"SALES"},
  {label:"Clients", role:"CLIENTS"},
  {label:"Accounts", role:"FINANCE"},
  {label:"Content pipeline only", role:"CONTENT"},
];
function accessCheckboxes(selected){
  const sel = selected || [];
  return `<div class="check-row">${ACCESS_MODULES.map(m=>`<label class="check-chip"><input type="checkbox" name="grantRole" value="${m.role}" ${sel.includes(m.role)?"checked":""}>${m.label}</label>`).join("")}</div>`;
}
// Ticked modules + everything the checkboxes don't manage (so saving never strips e.g. Sales Head).
function accessRolesFromForm(f, existing){
  const managed = ACCESS_MODULES.map(m=>m.role);
  return [...new Set(["EMPLOYEE", ...(existing||[]).filter(r=>!managed.includes(r)), ...f.getAll("grantRole")])];
}
function visibleModules(){
  let mods = visibleModulesBase();
  if(!currentUser) return mods;
  const place = (id)=>{
    if(mods.some(m=>m.id===id)) return;
    const mod = MODULES.find(m=>m.id===id);
    const after = [...mods].reverse().find(m=>m.id==='calendar' || m.id==='workspace');
    const i = after ? mods.indexOf(after) : -1;
    mods = i>=0 ? [...mods.slice(0,i+1), mod, ...mods.slice(i+1)] : [mod, ...mods];
  };
  place('calendar');
  // Departments: leadership and department heads only; each department's tab shows for those who may open it.
  if(deptsVisibleTo().length) place('departments'); else mods = mods.filter(m=>m.id!=='departments');
  return mods.map(m=> (m.sub && m.sub.some(s=>s.when)) ? {...m, sub:m.sub.filter(s=>!s.when || s.when())} : m);
}
function visibleModulesBase(){
  // Real stored roles drive the sidebar (Admin = everything; otherwise the union of the modules
  // granted, always with My Workspace) — not the job-title guessing the legacy branch below does.
  if(currentUser && Array.isArray(currentUser.roles) && currentUser.roles.length){
    if(currentUser.isAdmin) return MODULES;
    const r = currentUser.roles;
    const sales = r.includes('SALES') || r.includes('SALES_HEAD');
    const show = { workspace:true, calendar:true, hr:r.includes('HR'), marketing:r.includes('CONTENT'), sales, clients:sales||r.includes('CLIENTS'), accounts:r.includes('FINANCE') };
    return MODULES.filter(m=>show[m.id]).map(m=>{
      if(m.id==='workspace' && sales) return {...m, sub:SALES_WORKSPACE_SUB};
      // The Content board and Meta Ads are Admin/Content-only on the server, so Marketing only shows for the
      // Content role; without Sales on top, that role gets just the board.
      if(m.id==='marketing' && !sales) return {...m, sub:m.sub.filter(s=>s.id==='content')};
      return m;
    });
  }
  return visibleModulesLegacy();
}
function visibleModulesLegacy(){
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
    const order = ['workspace','clients','sales'];
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
  "hr/programs":[loadHrPrograms], "hr/overview":[loadHrPrograms],
  "marketing/performance":[()=>loadMetaScore().catch(()=>{})], "marketing/overview":[()=>loadMetaScore().catch(()=>{}), ()=>loadOwnAdMetrics().catch(()=>{}), ()=>loadSocial().catch(()=>{})], "workspace/overview":[()=>loadSocialStatus().catch(()=>{})],
  "sales/overview":[()=>loadSalesOverview().catch(()=>{}), ()=>loadLeads().catch(()=>{})],
  "workspace/plan":[loadDeptHeads, loadActionPlans], "workspace/plans":[loadDeptHeads, loadActionPlans],
  "calendar/main":[()=>loadCalendarDept().catch(()=>{}), ()=>loadCalendarPrograms().catch(()=>{}), ()=>loadCompanyEvents().catch(()=>{}), ()=>loadCalendarClientMeetings(), ()=>loadServiceBoards().catch(()=>{}), ()=>loadTasks().catch(()=>{}), ()=>loadPolicy().catch(()=>{})],
  "workspace/payments":[loadPaymentRequests], "hr/payments":[loadPaymentRequests], "accounts/requests":[loadPaymentRequests, loadPendingAdvanceDisbursements],
  "workspace/tasks":[loadTasks, loadMyContentItems], "marketing/content":[loadContentItems],
  "workspace/payroll":[loadWithdrawalRequests, loadMyPayroll], "workspace/attendance":[loadMyLeaveBalance], "hr/advances":[loadWithdrawalRequests],
  // Finance sees what Sales just pushed without a reload; Overview always reflects the latest approvals.
  // Quotes live behind CRM access, so a Finance-only sign-in (no CRM role) skips that fetch.
  "accounts/receipts":[loadInvoices, ()=>canLoadQuotes()?loadQuotes():null, ()=>isFinanceAdminUser(currentUser)?loadApprovedReceipts():loadReceiptsSummary(), ()=>isFinanceAdminUser(currentUser)?loadLeadAdvances().catch(()=>{}):null],
  "accounts/overview":[()=>isFinanceAdminUser(currentUser)?refreshFinanceReports():null],
  "accounts/commissions":[()=>isFinanceAdminUser(currentUser)?loadCommissionSummary():null],
};
function canLoadQuotes(){ return !!(currentUser && (currentUser.isAdmin || (currentUser.roles||[]).some(r=>r==='SALES'||r==='SALES_HEAD'))); }
function refreshTab(mid, sid){
  let jobs = TAB_REFRESH[mid+"/"+sid];
  if(!jobs && mid==="departments") jobs = sid==="overview" ? [loadDeptHeads, loadDeptOverview, ()=>loadDeptScores().catch(()=>{})] : (deptFromSlug(sid) ? [loadDeptHeads, ()=>loadActionPlans().catch(()=>{}), ()=>loadDeptScores().catch(()=>{}), ()=>loadDeptSummary(deptFromSlug(sid))] : null);
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
  calendar: { main:["Calendar", ()=>{ const p = taskCalPersonValue(); return "Tasks, events, holidays and leave · "+calPersonLabel(p); }] },
  workspace: {
    overview:["My Workspace", ()=>currentUser?currentUser.role+" · "+currentUser.name:"Your personal snapshot"],
    plan:["My Action Plan", ()=>{ const d = currentUser?headDeptOf(currentUser.name):null; return d ? d+" · file today's plan" : ""; }],
    plans:["Dept Action Plans", ()=>{ const h = DEPARTMENTS.filter(d=>deptHeads[d]); return h.filter(d=>planFor(d,TODAY)).length+" of "+h.length+" heads filed today"; }],
    tasks:["My Tasks", ()=>currentUser?clientTasks.filter(t=>isMyTask(t) && t.status!=="Done").length+" open across your clients":""],
    attendance:["My Attendance","Check-in, this month's record, and your leave & WFH"],
    payroll:["My Payroll", ()=>{ const m=myPayroll[0]; return m ? MONTH_LABEL[m.month]+" · "+m.payStatus : "Your salary and requests"; }],
    advance:["Advance Salary", ()=>currentUser?advances.filter(a=>a.empId===currentUser.id).length+" request(s) on record":""],
    payments:["Payment Requests", ()=>currentUser?paymentRequests.filter(r=>r.empId===currentUser.id).length+" request(s) on record":""],
    commission:["My Commission", ()=>{ if(!currentUser) return ""; const mine=commissionRowsByPerson().find(r=>r.name===currentUser.name); return mine&&mine.balance>0 ? inr(mine.balance)+" outstanding" : "All settled"; }],
    leaderboard:["Leaderboard", ()=>salesLeaderboardRows().length+" sales team member(s)"],
    // No count here (unlike hr.complaints below) — complaints[] is only ever loaded for HR/Admin
    // (see loadHrModule()), and anonymity means there's no "yours" subset to count for anyone else.
    complaints:["Complaints","Submit something anonymously — no name or ID attached"],
  },
  hr: {
    overview:["People Overview","Team snapshot · "+employees.length+" people"],
    directory:["Team Directory", employees.length+" people across "+DEPARTMENTS.length+" departments"],
    attendance:["Attendance & Leave", ()=>{ const n = leaveRequests.filter(l=>l.status==="Pending").length; return "Daily roster and leave requests"+(n?" · "+n+" leave pending":""); }],
    hiring:["Hiring", ()=>openPositions.filter(p=>p.status==="Open").length+" open positions"],
    programs:["Programs", ()=>programsInMonth(hrProgramMonth).filter(p=>p.status!=="Cancelled").length+" planned in "+monthLabel(hrProgramMonth)],
    payroll:["Payroll", ()=>MONTH_LABEL[payroll.selectedMonth]+" · "+payrollMonthStatus(payroll.selectedMonth)],
    advances:["Advances & Withdrawals", ()=>(advances.filter(a=>a.status==="Pending").length + withdrawalRequests.filter(w=>w.status==="Pending").length)+" pending · "+inr(advances.filter(a=>a.status==="Recovering").reduce((s,a)=>s+a.balance,0))+" of advances still to recover"],
    complaints:["Complaints", ()=>complaints.filter(c=>c.status==="New").length+" new"],
    notices:["Notices", ()=>notices.length+" posted"],
    policies:["HR Settings","Holidays, leave entitlements and general policy"],
    payments:["Payment Requests", ()=>currentUser?paymentRequests.filter(r=>r.empId===currentUser.id).length+" request(s) on record":""],
  },
  marketing: {
    overview:["Marketing Overview","Content and our own Meta Ads · DesGro Media"],
    content:["Content Pipeline","Organic content · script to publish"],
    performance:["Meta Ads","DesGro Media's own ad performance"],
  },
  sales: {
    overview:["Sales Overview","Targets, meetings, pipeline and the sales team · DesGro Media"],
    leads:["Leads", ()=>marketingLeads.length+" total leads"],
    quotes:["Quotes", ()=>quotes.filter(q=>q.status==="Submitted to Finance").length+" awaiting Finance"],
    invoices:["Invoices", ()=>clientsMissingInvoice().length+" client"+(clientsMissingInvoice().length===1?"":"s")+" awaiting an invoice"],
  },
  clients: {
    overview:["Clients Overview","Activity and delivery status across clients"],
    all:["All Clients", ()=>liveClients().length+" on record"],
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
  else if(nav.module==="departments"){
    const d = deptFromSlug(nav.sub.departments);
    [h,sub] = d ? [d, deptHeadOf(d) ? "Head: "+deptHeadOf(d) : "No head assigned"] : ["Departments", isLeadershipRole(currentUser) ? "Every department in one place" : "Your department"];
  }
  else{
    const s = nav.sub[nav.module];
    // Falls back to the raw tab id instead of throwing on a missing entry — this exact gap (a tab
    // added to a module's sub[] with no matching title here) previously threw mid-render, which
    // aborted the whole render() before it reached the content swap below and silently froze the
    // page on whatever was showing before (nav looked like it navigated; nothing else did).
    const t = TOPBAR_TITLES[nav.module][s] || (console.warn(`No TOPBAR_TITLES entry for ${nav.module}/${s}`), [s, ""]);
    h = t[0]; sub = typeof t[1]==="function" ? t[1]() : t[1];
  }
  document.getElementById("topbar-title").innerHTML = `<h2>${h}</h2><span>${sub}</span>`;
}

/* ===================== GLOBAL SEARCH (topbar) ===================== */
// One shared box, same on every page, searching across every entity type the signed-in caller can
// already see elsewhere — /api/search itself scopes each type by the exact same rule its own list
// endpoint uses, so results here can never show more than that role already can. By the time this
// runs, whichever arrays a given role is allowed to search (clients/marketingLeads/quotes/invoices/
// employees) are already loaded from the initial boot sequence, so a result's "open" action can
// call straight into the existing edit/detail modal for it — no extra fetch needed.
let globalSearchDebounce = null, globalSearchResults = [], globalSearchActive = -1;
function onGlobalSearchInput(v){
  clearTimeout(globalSearchDebounce);
  const q = v.trim();
  if(q.length < 2){ closeGlobalSearch(); return; }
  globalSearchDebounce = setTimeout(async ()=>{
    try{
      const { results } = await apiJson(`/api/search?q=${encodeURIComponent(q)}`);
      globalSearchResults = results; globalSearchActive = -1;
      renderGlobalSearchResults();
    }catch(err){ console.error("Search failed", err); }
  }, 250);
}
function renderGlobalSearchResults(){
  const box = document.getElementById("global-search-results");
  if(!box) return;
  if(!globalSearchResults.length){ box.innerHTML = `<div class="empty-msg">No matches.</div>`; box.hidden = false; return; }
  const groups = {};
  globalSearchResults.forEach(r=>{ (groups[r.type] ||= []).push(r); });
  box.innerHTML = Object.entries(groups).map(([type, rows])=>`
    <div class="group-label">${esc(type)}${rows.length>1?"s":""}</div>
    ${rows.map(r=>{ const i = globalSearchResults.indexOf(r); return `<button type="button" class="result-row ${i===globalSearchActive?'active':''}" onmousedown="event.preventDefault();openGlobalSearchResult('${r.type}','${esc(r.id)}')"><span class="title">${esc(r.title)}</span><span class="subtitle">${esc(r.subtitle)}</span></button>`; }).join("")}
  `).join("");
  box.hidden = false;
}
function closeGlobalSearch(){
  const box = document.getElementById("global-search-results");
  if(box){ box.hidden = true; box.innerHTML = ""; }
  globalSearchResults = []; globalSearchActive = -1;
}
function onGlobalSearchKeydown(e){
  if(e.key==="Escape"){ e.target.blur(); closeGlobalSearch(); return; }
  if(!globalSearchResults.length) return;
  if(e.key==="ArrowDown"){ e.preventDefault(); globalSearchActive = Math.min(globalSearchActive+1, globalSearchResults.length-1); renderGlobalSearchResults(); }
  else if(e.key==="ArrowUp"){ e.preventDefault(); globalSearchActive = Math.max(globalSearchActive-1, 0); renderGlobalSearchResults(); }
  else if(e.key==="Enter" && globalSearchActive>=0){ e.preventDefault(); const r = globalSearchResults[globalSearchActive]; openGlobalSearchResult(r.type, r.id); }
}
document.addEventListener("click", e=>{ if(!e.target.closest(".search")) closeGlobalSearch(); });
// Each branch reuses the exact existing "view/edit" modal for that entity (Accounts > Invoices'
// own edit modal, HR Directory's own employee detail modal, etc.) — global search is a shortcut to
// records that already have a home elsewhere, not a new detail view of its own.
function openGlobalSearchResult(type, id){
  closeGlobalSearch();
  const input = document.getElementById("global-search"); if(input) input.value = "";
  if(type==="Client"){ setModule("clients"); openClientDetail(id); }
  else if(type==="Lead"){ setSub("sales","leads"); openEditLead(id); }
  else if(type==="Quote"){ setSub("sales","quotes"); openEditQuote(id); }
  else if(type==="Invoice"){
    // A plain Sales sign-in has no Accounts module at all — their invoices live inline on the
    // client's own page instead (see clientDetailPage), so fall back to that when Accounts isn't
    // in their nav rather than navigating to a tab that doesn't exist for them.
    if(visibleModules().some(m=>m.id==="accounts")){ setSub("accounts","invoices"); openEditInvoice(id); }
    else{ const inv = invoices.find(x=>x.id===id); if(inv){ setModule("clients"); openClientDetail(inv.clientId); } }
  }
  else if(type==="Employee"){ setSub("hr","directory"); openEmployeeDetail(id); }
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
  else if(nav.module==="calendar") root.innerHTML = calendarView();
  else if(nav.module==="departments") root.innerHTML = nav.sub.departments==="overview" ? deptsOverview() : deptPage(deptFromSlug(nav.sub.departments));
  else if(nav.module==="workspace") root.innerHTML = ({overview:workspaceOverview,plan:workspacePlan,plans:workspacePlansTeam,tasks:workspaceTasks,attendance:workspaceAttendance,payroll:workspacePayroll,advance:workspaceAdvance,payments:workspacePaymentRequests,commission:workspaceCommission,leaderboard:workspaceLeaderboard,complaints:workspaceComplaints})[nav.sub.workspace]();
  else if(nav.module==="hr") root.innerHTML = ({overview:hrOverview,directory:hrDirectory,attendance:hrAttendance,hiring:hrHiring,programs:hrProgramsView,payroll:hrPayroll,advances:hrAdvances,payments:workspacePaymentRequests,complaints:hrComplaints,notices:hrNotices,policies:hrPolicies})[nav.sub.hr]();
  else if(nav.module==="marketing") root.innerHTML = ({overview:mktOverview,content:mktContent,performance:mktPerformance})[nav.sub.marketing]();
  else if(nav.module==="sales") root.innerHTML = ({overview:salesOverview,leads:mktLeads,quotes:mktQuotes,invoices:mktInvoices})[nav.sub.sales]();
  else if(nav.module==="clients") root.innerHTML = ({overview:clientsOverview,all:clientsAll})[nav.sub.clients]();
  else if(nav.module==="accounts") root.innerHTML = ({overview:acctOverview,invoices:acctInvoices,receipts:acctPaymentReceipts,requests:acctPaymentRequests,payroll:acctPayroll,payables:acctPayables,expenses:acctExpenses,banks:acctBanks,quotes:acctQuotes,commissions:acctCommissions,coa:acctChartOfAccounts,journal:acctJournal,reports:acctReports})[nav.sub.accounts]();
  if(nav.module==="marketing" && nav.sub.marketing==="content") initContentBoard();
  if(nav.module==="workspace" && nav.sub.workspace==="tasks") renderMyTaskBoard();
}

/* ===================== DASHBOARD ===================== */
function viewDashboard(){
  const openTasks = clientTasks.filter(t=>t.status!=="Done").length;
  const overdueTasks = clientTasks.filter(t=>t.status!=="Done" && t.due && t.due<TODAY).length;
  const activeClients = liveClients().filter(c=>c.status==="Active").length;
  const pendingLeave = leaveRequests.filter(l=>l.status==="Pending").length;
  const pendingAdvances = advances.filter(a=>a.status==="Pending").length;
  const receivable = invoices.reduce((s,i)=>s+invoiceBalance(i),0);
  const overdueInv = invoices.filter(i=>invoiceStatus(i)==="Overdue").reduce((s,i)=>s+invoiceBalance(i),0);
  const payableOutstanding = payables.reduce((s,p)=>s+payableBalance(p),0);
  const thisMonth = TODAY.slice(0,7);
  // Same figure as Accounts → Overview "Total Revenue": Finance-approved payments received this
  // month, net of sales commission (server report, not a local re-sum of invoices). If that month's
  // report isn't cached yet (e.g. the Accounts page was left on another month), fetch and redraw.
  const revenueMTD = deptProfitability(thisMonth).rows.reduce((sum,r)=>sum+r.revenue,0);
  if(!financeReportsCache.deptProfit[thisMonth] && isFinanceAdminUser(currentUser)){
    loadFinanceReports(thisMonth).then(()=>{ if(nav.module==="dashboard") render(); }).catch(err=>console.error("Couldn't load dashboard revenue", err));
  }
  const publishedMTD = contentItems.filter(c=>c.stage==="Published" && c.due.slice(0,7)===thisMonth).length;

  const needsReview = [
    ...payrollInstalmentsDue(),
    ...leaveRequests.filter(l=>l.status==="Pending").map(l=>({txt:`${byId(l.empId).name} requested ${l.days} day${l.days>1?'s':''} ${l.type.toLowerCase()} leave`, sub:`applied ${fmtDateShort(l.applied)}`})),
    ...advances.filter(a=>a.status==="Pending").map(a=>({txt:`${byId(a.empId).name} requested a ${inr(a.amount)} advance`, sub:esc(a.reason)})),
    ...invoices.filter(i=>invoiceStatus(i)==="Overdue").map(i=>({txt:`${clientById(i.clientId).name} — invoice ${i.invoiceNo} overdue`, sub:`${inr(invoiceBalance(i))} · due ${fmtDateShort(i.due)}`})),
    ...clientTasks.filter(t=>t.status!=="Done" && t.due && t.due<TODAY).map(t=>({txt:`${t.title} is overdue`, sub:`${taskClientName(t)} · ${t.assignedTo} · due ${fmtDateShort(t.due)}`})),
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
      <div class="kpi-top"><span class="kpi-label">Revenue — ${MONTH_LABEL[thisMonth]||thisMonth}</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-receipt"/></svg></div></div>
      <div class="kpi-value mono">${inr(revenueMTD)}</div>
      <div class="kpi-sub">received this month, net of commission</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-top"><span class="kpi-label">Active Clients</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-building"/></svg></div></div>
      <div class="kpi-value mono">${activeClients}</div>
      <div class="kpi-sub">of ${liveClients().length} total on record</div>
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
  </div>
  ${dashboardModuleOverviews()}`;
}

/* ---- Dashboard: per-module overview cards ----
   Everything here reads the same in-memory arrays (and the same invoiceBalance / invoiceStatus /
   payableBalance helpers) that each module's own page renders from — all of which are fetched once,
   in parallel, at sign-in — so there is no extra request and nothing to drift out of sync. A card is
   only built for modules visibleModules() says this user can open; clicking it goes to that module. */
function dashStat(label, value, tone){ return `<div class="mod-stat"><div class="v mono ${tone||''}">${value}</div><div class="l">${label}</div></div>`; }
function dashCard(mid, title, icon, stats, note){
  return `<div class="panel mod-card" onclick="setModule('${mid}')" title="Open ${esc(title)}">
    <div class="panel-head"><div style="display:flex;align-items:center;gap:8px;"><svg class="icon" style="width:15px;height:15px"><use href="#${icon}"/></svg><h3>${esc(title)}</h3></div><span class="sub" style="color:var(--brand);">View all →</span></div>
    <div class="panel-body"><div class="mod-stats">${stats.join("")}</div>${note?`<div class="mod-note">${note}</div>`:""}</div>
  </div>`;
}
// Next occurrence of a month/day (from a YYYY-MM-DD) within `days` of today; null if none.
function dashUpcoming(iso, days){
  if(!iso) return null;
  const now = new Date(TODAY+"T00:00:00Z");
  let d = new Date(Date.UTC(now.getUTCFullYear(), +iso.slice(5,7)-1, +iso.slice(8,10)));
  if(d<now) d = new Date(Date.UTC(now.getUTCFullYear()+1, +iso.slice(5,7)-1, +iso.slice(8,10)));
  const diff = Math.round((d-now)/864e5);
  return diff<=days ? {date:d.toISOString().slice(0,10), diff} : null;
}
function dashboardModuleOverviews(){
  const vis = new Set(visibleModules().map(m=>m.id));
  const month = TODAY.slice(0,7);
  const cards = [];

  if(vis.has("workspace") && currentUser){
    const mine = clientTasks.filter(t=>isMyTask(t));
    const weekAgo = new Date(Date.now()-6*864e5).toISOString().slice(0,10);
    const open = mine.filter(t=>t.status!=="Done").length;
    const overdue = mine.filter(t=>t.status!=="Done" && t.due && t.due<TODAY).length;
    const doneWeek = mine.filter(t=>t.status==="Done" && t.doneDate && t.doneDate>=weekAgo).length;
    cards.push(dashCard("workspace","My Workspace","i-briefcase",[
      dashStat("open tasks", open), dashStat("overdue", overdue, overdue?"neg":""), dashStat("completed this week", doneWeek, doneWeek?"pos":""),
    ]));
  }

  if(vis.has("hr")){
    const pendingLeave = leaveRequests.filter(l=>l.status==="Pending").length;
    const joiners = employees.filter(e=>e.joined && e.joined.slice(0,7)===month).length;
    const bdays = employees.map(e=>({e, u:dashUpcoming(e.dob,30)})).filter(x=>x.u).sort((a,b)=>a.u.diff-b.u.diff);
    const annis = employees.filter(e=>e.joined && +e.joined.slice(0,4)<+TODAY.slice(0,4)).map(e=>({e, u:dashUpcoming(e.joined,30)})).filter(x=>x.u).sort((a,b)=>a.u.diff-b.u.diff);
    const next = bdays[0] ? `Next birthday: ${esc(bdays[0].e.name)} · ${fmtDateShort(bdays[0].u.date)}` : "";
    cards.push(dashCard("hr","HR — People","i-users",[
      dashStat("people", employees.length), dashStat("pending leave requests", pendingLeave, pendingLeave?"warn":""),
      dashStat("new joiners this month", joiners), dashStat("birthdays · anniversaries (30 days)", bdays.length+" · "+annis.length),
    ], next));
  }

  if(vis.has("marketing")){
    const inFlight = contentItems.filter(c=>c.stage!=="Published").length;
    const adSpend = metaAdsCampaigns.map(adMetrics).reduce((s,r)=>s+r.spend,0);
    cards.push(dashCard("marketing","Marketing","i-megaphone",[
      dashStat("content in progress", inFlight), dashStat("Meta Ads spend", inr(adSpend)),
    ]));
  }

  if(vis.has("sales")){
    const lead = s=>marketingLeads.filter(l=>l.status===s).length;
    const quote = s=>quotes.filter(q=>q.status===s).length;
    const soldMTD = salesTargets.reduce((s,r)=>s+r.monthlySales,0);
    const targetMTD = salesTargets.reduce((s,r)=>s+r.target,0);
    cards.push(dashCard("sales","Sales","i-handshake",[
      dashStat("sales vs target (month)", targetMTD ? `${inr(soldMTD)}<span style="font-size:12px;color:var(--ink-soft);font-family:Manrope;"> / ${inr(targetMTD)}</span>` : "—"),
      dashStat("leads: new · contacted · qualified", `${lead("New")} · ${lead("Contacted")} · ${lead("Qualified")}`),
      dashStat("quotes: draft · sent · with finance", `${quote("Draft")} · ${quote("Sent")} · ${quote("Submitted to Finance")}`),
    ]));
  }

  if(vis.has("clients")){
    const active = liveClients().filter(c=>c.status==="Active").length;
    const overdueClients = new Set(invoices.filter(i=>invoiceStatus(i)==="Overdue").map(i=>i.clientId)).size;
    const cutoff = new Date(Date.now()-30*864e5).toISOString().slice(0,10);
    const recent = liveClients().filter(c=>c.onboarded && c.onboarded>=cutoff).sort((a,b)=>b.onboarded.localeCompare(a.onboarded));
    cards.push(dashCard("clients","Clients","i-building",[
      dashStat("active clients", `${active}<span style="font-size:12px;color:var(--ink-soft);font-family:Manrope;"> / ${liveClients().length}</span>`),
      dashStat("with overdue invoices", overdueClients, overdueClients?"neg":""),
      dashStat("added in last 30 days", recent.length),
    ], recent[0] ? `Latest: ${esc(recent[0].name)} · ${fmtDateShort(recent[0].onboarded)}` : ""));
  }

  if(vis.has("accounts")){
    const receivable = invoices.reduce((s,i)=>s+invoiceBalance(i),0);
    const overdueInv = invoices.filter(i=>invoiceStatus(i)==="Overdue").reduce((s,i)=>s+invoiceBalance(i),0);
    const payable = payables.reduce((s,p)=>s+payableBalance(p),0);
    const overduePay = payables.filter(p=>p.due<TODAY).reduce((s,p)=>s+payableBalance(p),0);
    const receivedMTD = invoices.reduce((s,i)=>s+i.payments.filter(p=>p.date.slice(0,7)===month).reduce((a,p)=>a+p.amount,0),0);
    cards.push(dashCard("accounts","Accounts","i-coins",[
      dashStat("receivables", inr(receivable)), dashStat("payables", inr(payable), payable?"warn":""),
      dashStat("overdue receivables", inr(overdueInv), overdueInv?"neg":""), dashStat("approved payments this month", inr(receivedMTD), receivedMTD?"pos":""),
    ], overduePay ? `${inr(overduePay)} of payables are past due` : ""));
  }

  return cards.length ? `<div class="mod-grid">${cards.join("")}</div>` : "";
}

/* ===================== MY WORKSPACE (Staff / Sales self-service) ===================== */
// Deliberately minimal — just what a Staff sign-in needs day to day: their own attendance, their
// open tasks, and Notices posted by administration/HR (see hrNotices()). Nothing else belongs here.
// A Sales sign-in gets a different overview entirely — see workspaceOverviewSales() below — since
// their workspace is about attendance, commission and leaderboard rank, not client delivery tasks.
function workspaceOverview(){
  if(!currentUser) return '';
  if(isSalesRole(currentUser)) return workspaceOverviewSales();
  const myTasks = clientTasks.filter(t=>isMyTask(t));
  const openTasks = myTasks.filter(t=>t.status!=="Done");
  const overdueTasks = myTasks.filter(t=>t.status!=="Done" && t.due && t.due<TODAY);
  const att = attendanceToday[currentUser.id];
  const mtdWorkingDays = workingDaysMTD();
  const present = monthPresentDays[currentUser.id] ?? mtdWorkingDays;
  const recentNotices = notices.slice().sort((a,b)=>b.postedDate.localeCompare(a.postedDate)).slice(0,5);
  return `
  ${planReminderHTML()}
  ${socialReminderHTML()}
  ${feedbackDueHTML()}
  ${myDeptScoreHTML()}
  ${upcomingProgramsHTML()}
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Today</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-attendance"/></svg></div></div><div class="kpi-value mono" style="font-size:19px;">${att?attendanceLabel(att.status):'—'}</div><div class="kpi-sub">${att&&att.in?'checked in '+att.in:''}</div></div>
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">This Month</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-calendar"/></svg></div></div><div class="kpi-value mono">${present}<span style="font-size:13px;color:var(--ink-soft);font-family:Manrope;"> / ${mtdWorkingDays}</span></div><div class="kpi-sub">days present</div></div>
    <div class="kpi-card hero"><div class="kpi-top"><span class="kpi-label">Open Tasks</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-board"/></svg></div></div><div class="kpi-value mono ${overdueTasks.length>0?'warn':''}">${openTasks.length}</div><div class="kpi-sub">${overdueTasks.length} overdue</div></div>
  </div>
  <div class="grid-2">
    <div class="panel">
      <div class="panel-head"><h3>Your tasks</h3></div>
      <div class="panel-body">${openTasks.length ? openTasks.slice().sort((a,b)=>(a.due||'').localeCompare(b.due||'')).slice(0,6).map(t=>`<div class="feed-item row-click" onclick="openClientDetail('${t.clientId}')"><div class="feed-dot" style="${t.due&&t.due<TODAY?'background:var(--neg);':''}"></div><div><div class="feed-text"><strong>${esc(t.title)}</strong></div><div class="feed-time">${esc(taskClientName(t))} · due ${t.due?fmtDateShort(t.due):'no date'}</div></div></div>`).join("") : '<div class="empty">No open tasks.</div>'}</div>
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
  ${planReminderHTML()}
  ${socialReminderHTML()}
  ${feedbackDueHTML()}
  ${myDeptScoreHTML()}
  ${upcomingProgramsHTML()}
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
  const archivedCount = currentUser ? clientTasks.filter(t=>isMyTask(t) && isTaskArchived(t)).length : 0;
  return `
  <div class="toolbar">
    <div class="banner muted" style="margin:0;flex:1;min-width:260px;"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Every task assigned to you, across every client — drag a card between columns, or use the stage dropdown on each card. Completed tasks move to the archive after 3 days.</div></div>
    ${archivedCount?`<button class="btn ghost" onclick="openTaskArchive()"><svg class="icon" style="width:13px;height:13px"><use href="#i-archive"/></svg>Archive (${archivedCount})</button>`:''}
  </div>
  ${myContentItems.length ? `
  <div class="panel" style="margin-bottom:16px;">
    <div class="panel-head"><h3>Content assigned to you</h3><div class="sub">${myContentItems.filter(i=>i.stage!=='Published').length} in progress · from the Content Pipeline</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Title</th><th>Type</th><th>Platforms</th><th>Stage</th><th>Due</th></tr></thead>
      <tbody>${myContentItems.map(i=>`<tr><td>${esc(i.title)}${i.notes?`<div class="subtext">${esc(i.notes)}</div>`:''}</td><td class="muted">${esc(i.type)}</td><td class="muted">${esc(i.platforms.join(', '))||'—'}</td><td>${pill(i.stage, i.stage==='Published'?'pos':'warn')}</td><td class="muted ${isContentOverdue(i)?'neg':''}">${fmtDate(i.due)}</td></tr>`).join("")}</tbody>
    </table></div>
  </div>` : ''}
  <div class="board-scroll"><div class="board" id="my-task-board"></div></div>`;
}
// ---- Paid-leave balance, carry-forward & history (all numbers computed server-side) ----
let leaveLedgerCache = {}; // employee code -> {carryForwardMaxDays, months[], entries[]}
async function loadMyLeaveBalance(){
  if(!currentUser || !currentUser._dbId) return;
  const r = await apiJson(`/api/hr/leave-balance/${currentUser._dbId}?history=1`);
  leaveBalanceCache[currentUser.id] = r.balance; leaveLedgerCache[currentUser.id] = r.ledger;
}
function leaveCarryNote(b){
  const bits = [];
  if(b.leaveCarriedIn>0) bits.push(`${b.leaveCarriedIn} carried forward`);
  if(b.leaveAdjustment) bits.push(`${b.leaveAdjustment>0?'+':''}${b.leaveAdjustment} adjusted by HR`);
  return bits.length ? ` · ${bits.join(' · ')}` : '';
}
function leaveLedgerTable(ledger){
  if(!ledger) return `<div class="empty">Loading…</div>`;
  const rows = ledger.months.map(m=>`<tr><td>${esc(monthLabel(m.month))}</td><td class="num">${m.granted}</td><td class="num">${m.carriedIn||'—'}</td><td class="num">${m.adjustment?(m.adjustment>0?'+':'')+m.adjustment:'—'}</td><td class="num">${m.used||'—'}</td><td class="num ${m.lop>0?'warn':''}">${Math.max(0,m.cap-m.used)}${m.lop>0?` <span class="faint">(${m.lop} LOP)</span>`:''}</td><td class="num">${ledger.carryForwardMaxDays>0 ? (m.carriedOut||'—')+(m.closed?'':' <span class="faint">(so far)</span>')+(m.lapsed>0?` <span class="faint">· ${m.lapsed} lapsed</span>`:'') : '—'}</td></tr>`).join("");
  return `<div class="table-wrap"><table class="data"><thead><tr><th>Month</th><th class="num">Granted</th><th class="num">Carried in</th><th class="num">Adjusted</th><th class="num">Used</th><th class="num">Left</th><th class="num">Carried out</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function leaveLedgerPanel(ledger){
  const off = ledger && ledger.carryForwardMaxDays<=0;
  return `<div class="panel">
    <div class="panel-head"><h3>Leave balance history</h3><div class="sub">${off ? 'Carry-forward is off — unused paid-leave days do not roll over' : `Unused paid-leave days roll into the next month, up to ${ledger?ledger.carryForwardMaxDays:hrPolicy.carryForwardMaxDays} day${(ledger?ledger.carryForwardMaxDays:hrPolicy.carryForwardMaxDays)===1?'':'s'}`}</div></div>
    ${leaveLedgerTable(ledger)}
  </div>`;
}
// HR: any employee's leave & WFH balances for a month — breakdown, computed usage, history, and the audit trail of
// manual changes — plus "Update Balances". Usage is always computed from Attendance/LeaveRequests, never stored.
async function openLeaveBalance(id, month){
  const e = byId(id); const dbId = employeeDbIdByCode[id];
  showModal(`<div class="modal-head"><h3>Leave balance — ${esc(e.name)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div><div class="modal-body"><div class="empty">Loading…</div></div>`);
  try{
    const r = await apiJson(`/api/hr/leave-balance/${dbId}?history=1${month?`&month=${month}`:''}`);
    const b = r.balance, l = r.ledger;
    const num = n => Math.round(n*100)/100;
    const leaveBal = num(b.leaveCap - b.leaveDays), wfhBal = num(b.wfhCap - b.wfhDays);
    const row = (label, val, cls) => `<div class="calc-line"><span>${label}</span><span class="mono ${cls||''}">${val}</span></div>`;
    const bucketLabel = x => x==='WFH' ? 'WFH' : 'Paid leave';
    const overrides = (l.overrides||[]).map(o=>`<tr><td class="muted">${fmtDateShort(isoDate(o.at))}</td><td>${esc(o.by||'—')}</td><td>${bucketLabel(o.bucket)} · ${esc(monthLabel(o.month))}</td><td class="num mono">${o.oldValue==null?'—':o.oldValue} → ${o.newValue==null?'—':o.newValue}</td><td class="num mono">${o.days>0?'+':''}${o.days}</td><td class="muted">${esc(o.note||'')}</td></tr>`).join('') || `<tr><td colspan="6"><div class="empty">No manual changes yet.</div></td></tr>`;
    const carry = (l.entries||[]).filter(x=>x.kind==='CARRY_FORWARD' && (x.days>0||x.lapsedDays>0)).slice(0,6).map(x=>`<div class="calc-line"><span>${esc(monthLabel(x.month))} — carried in ${x.days} (${x.unusedDays} unused in ${esc(monthLabel(x.sourceMonth))}${x.lapsedDays>0?`, ${x.lapsedDays} lapsed over the ${x.capApplied}-day cap`:''})${x.superseded?' <span class="faint">(superseded)</span>':''}</span><span class="mono faint">${fmtDateShort(isoDate(x.createdAt))}</span></div>`).join('');
    showModal(`
      <div class="modal-head"><h3>Leave balance — ${esc(e.name)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
      <div class="modal-body">
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:10px;">
          <div><label class="field-label">Month</label><input class="field-input" type="month" id="lb-month" value="${b.month}" onchange="openLeaveBalance('${id}', this.value)"></div>
          <button class="btn primary btn-sm" onclick="openUpdateBalances('${id}','${b.month}')">Update Balances</button>
        </div>
        <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);margin-top:10px;">
          <div class="kpi-card" style="box-shadow:none;"><div class="kpi-label">Paid leave balance</div><div class="kpi-value mono ${leaveBal<=0?'warn':''}">${leaveBal}</div><div class="kpi-sub">${b.leaveDays} used of ${b.leaveCap}</div></div>
          <div class="kpi-card" style="box-shadow:none;"><div class="kpi-label">WFH balance</div><div class="kpi-value mono ${wfhBal<=0?'warn':''}">${wfhBal}</div><div class="kpi-sub">${b.wfhDays} used of ${b.wfhCap}</div></div>
        </div>
        <div class="section-label">Paid leave</div>
        ${row('Carried over from previous month', b.leaveCarriedIn)}
        ${row('Earned this month', b.leaveBaseCap)}
        ${row('HR adjustment', (b.leaveAdjustment>0?'+':'')+b.leaveAdjustment)}
        ${row('Used (approved)', b.leaveDays)}
        <div class="section-label">WFH</div>
        ${row('Carried over', '— (WFH never carries forward)', 'faint')}
        ${row('Earned this month', b.wfhBaseCap)}
        ${row('HR adjustment', (b.wfhAdjustment>0?'+':'')+b.wfhAdjustment)}
        ${row('Used (approved)', b.wfhDays)}
        <div class="section-label">${esc(monthLabel(b.month))} usage — from Leave &amp; Attendance records</div>
        ${row('Approved leave days', b.leaveDays)}
        ${row('Pending leave requests (not deducted until approved)', b.pendingLeaveDays, b.pendingLeaveDays>0?'warn':'')}
        ${row('Paid leave deducted', Math.min(b.leaveDays, b.leaveCap))}
        ${row('WFH used', b.wfhDays)}
        ${row('Pending WFH requests (not deducted until approved)', b.pendingWfhDays, b.pendingWfhDays>0?'warn':'')}
        ${row('Unpaid leave taken (Loss of Pay)', b.lopDays, b.lopDays>0?'neg':'')}
        ${row('WFH pay-cut days (25%)', b.wfhExcessDays, b.wfhExcessDays>0?'neg':'')}
        <div class="section-label">History</div>
        ${leaveLedgerTable(l)}
        ${carry ? `<div class="section-label">Carry-forward entries</div>${carry}` : ''}
        <div class="section-label">Manual balance changes</div>
        <div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>By</th><th>Balance</th><th class="num">Old → New</th><th class="num">Adj.</th><th>Reason</th></tr></thead><tbody>${overrides}</tbody></table></div>
      </div>`);
  }catch(err){ toast(err.message || "Couldn't load leave balance"); closeModal(); }
}
// HR-only (this whole view is behind the HR/Admin gate on the server too). Enter the remaining balance you want
// for the month; the server stores the difference as an adjustment on top of the computed value.
function openUpdateBalances(id, month){
  const e = byId(id); const dbId = employeeDbIdByCode[id];
  apiJson(`/api/hr/leave-balance/${dbId}?month=${month}`).then(({balance:b})=>{
    showModal(`
      <div class="modal-head"><h3>Update balances — ${esc(e.name)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
      <form id="f-update-balances"><div class="modal-body">
        <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>A manual correction for <b>${esc(monthLabel(month))}</b> only. It's saved as an adjustment on top of what's calculated from attendance, with your reason, so later attendance corrections still flow through. Not for normal accrual.</div></div>
        <div class="field-row">
          <div><label class="field-label">Paid leave balance</label><input class="field-input" type="number" name="paidLeave" step="0.5" required value="${Math.round((b.leaveCap-b.leaveDays)*100)/100}"></div>
          <div><label class="field-label">WFH balance</label><input class="field-input" type="number" name="wfh" step="0.5" required value="${Math.round((b.wfhCap-b.wfhDays)*100)/100}"></div>
        </div>
        <div><label class="field-label">Reason (kept in the history)</label><input class="field-input" name="reason" required minlength="3" placeholder="e.g. Data entry error / policy exception"></div>
      </div>
      <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="openLeaveBalance('${id}','${month}')">Cancel</button><button type="submit" class="btn primary">Save changes</button></div></div>
      </form>`);
    document.getElementById("f-update-balances").addEventListener("submit", async ev=>{
      ev.preventDefault();
      const f = new FormData(ev.target);
      const cur = { paidLeave: Math.round((b.leaveCap-b.leaveDays)*100)/100, wfh: Math.round((b.wfhCap-b.wfhDays)*100)/100 };
      const body = { month, reason:f.get("reason") };
      if(Number(f.get("paidLeave"))!==cur.paidLeave) body.paidLeaveBalance = Number(f.get("paidLeave"));
      if(Number(f.get("wfh"))!==cur.wfh) body.wfhBalance = Number(f.get("wfh"));
      if(body.paidLeaveBalance===undefined && body.wfhBalance===undefined){ toast("Change at least one balance"); return; }
      try{
        await apiJson(`/api/hr/leave-balance/${dbId}/update-balances`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
        toast("Balances updated");
        await loadAttendanceMonthSummary(TODAY.slice(0,7)).catch(()=>{});
        render(); openLeaveBalance(id, month);
      }catch(err){ toast(err.message || "Couldn't update balances"); }
    });
  }).catch(err=>toast(err.message || "Couldn't load balances"));
}
function workspaceLeave(){
  if(!currentUser) return '';
  const mine = leaveRequests.filter(l=>l.empId===currentUser.id).slice().sort((a,b)=>{ const order={Pending:0,Approved:1,Rejected:2,Cancelled:3}; if(order[a.status]!==order[b.status]) return order[a.status]-order[b.status]; return b.applied.localeCompare(a.applied); });
  const bal = leaveBalance(currentUser.id);
  const hasImpact = bal.lopDays>0 || bal.wfhExcessDays>0;
  return `
  <div class="toolbar"><div></div><button class="btn primary" onclick="openApplyLeave()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Apply for leave</button></div>
  <div class="panel">
    <div class="panel-head"><h3>This month's leave &amp; WFH</h3><div class="sub">${esc(monthLabel(bal.month))} · ${hrPolicy.paidLeavesPerMonth} paid leave day &amp; ${hrPolicy.paidWfhPerMonth} paid WFH day per month</div></div>
    <div class="panel-body">
      <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);">
        <div class="kpi-card" style="box-shadow:none;"><div class="kpi-label">Paid leave left</div><div class="kpi-value mono ${bal.leaveRemaining<=0?'warn':''}">${bal.leaveRemaining} <span style="font-size:14px;color:var(--ink-soft);font-family:Manrope;">/ ${bal.leaveCap ?? hrPolicy.paidLeavesPerMonth}</span></div><div class="kpi-sub">${bal.leaveDays} taken so far this month${leaveCarryNote(bal)}</div></div>
        <div class="kpi-card" style="box-shadow:none;"><div class="kpi-label">Paid WFH left</div><div class="kpi-value mono ${bal.wfhRemaining<=0?'warn':''}">${bal.wfhRemaining} <span style="font-size:14px;color:var(--ink-soft);font-family:Manrope;">/ ${bal.wfhCap ?? hrPolicy.paidWfhPerMonth}</span></div><div class="kpi-sub">${bal.wfhDays} taken so far this month</div></div>
      </div>
      ${hasImpact ? `
      <div class="banner" style="margin-top:12px;">
        <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
        <div><b>This is already affecting your payroll.</b> ${bal.lopDays>0?(()=>{
          const over = Math.max(0, bal.leaveDays-(bal.leaveCap ?? hrPolicy.paidLeavesPerMonth)), un = bal.unpaidLeaveDays||0, wd = workingDaysInMonth(bal.month), est = (currentUser.salary && wd) ? Math.round(currentUser.salary/wd*bal.lopDays) : 0;
          const parts = [over>0?`${over} paid-leave day${over===1?"":"s"} beyond your ${bal.leaveCap ?? hrPolicy.paidLeavesPerMonth}-day allowance`:"", un>0?`${un} unpaid leave day${un===1?"":"s"} (always deducted in full)`:""].filter(Boolean).join(" and ");
          return `Loss of Pay: ${parts} = ${bal.lopDays} day${bal.lopDays===1?"":"s"} of salary${est?`, about ${inr(est)}`:""}.`; })():""} ${bal.wfhExcessDays>0?`${bal.wfhExcessDays} WFH day${bal.wfhExcessDays===1?"":"s"} beyond your ${hrPolicy.paidWfhPerMonth}/month allowance is paid at 75% instead of full pay.`:""} It appears in My Payroll once this month's payroll is processed.</div>
      </div>` : `
      <div class="banner muted" style="margin-top:12px;">
        <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
        <div>You're within your paid leave and WFH allowance for ${esc(monthLabel(bal.month))} — no pay impact yet.</div>
      </div>`}
    </div>
  </div>
  ${leaveLedgerPanel(leaveLedgerCache[currentUser.id])}
  <div class="panel">
    <div class="panel-head"><h3>Your requests</h3></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Type</th><th>Dates</th><th class="num">Days</th><th>Reason</th><th>Status</th></tr></thead>
      <tbody>${mine.length ? mine.map(l=>{ const range = l.from===l.to ? fmtDateShort(l.from) : `${fmtDateShort(l.from)} – ${fmtDateShort(l.to)}`; return `<tr><td>${esc(l.type)}${l.duration && l.duration!=="Full Day" ? ` <span class="faint">· ${esc(l.duration)}</span>` : ""}</td><td class="muted">${range}</td><td class="num">${l.days}</td><td class="muted">${esc(l.reason)}</td><td>${pill(l.status,statusKind(l.status))}${l.status==="Pending"?` <button class="btn btn-sm ghost" style="padding:2px 8px;" onclick="cancelLeave('${l.id}')">Cancel</button>`:''}</td></tr>`; }).join("") : `<tr><td colspan="5"><div class="empty">No leave requests yet.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
function openApplyLeave(){
  applyLeaveMonthUsage = {}; // fresh cache per modal open
  showModal(`
    <div class="modal-head"><h3>Apply for leave</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-apply-leave"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Submitted to HR for approval. <b>Your balance for ${esc(monthLabel(leaveBalance(currentUser.id).month))}:</b> ${leaveBalance(currentUser.id).leaveRemaining} paid leave day${leaveBalance(currentUser.id).leaveRemaining===1?'':'s'} left${leaveCarryNote(leaveBalance(currentUser.id))} · ${leaveBalance(currentUser.id).wfhRemaining} paid WFH day${leaveBalance(currentUser.id).wfhRemaining===1?'':'s'} left.</div></div>
      <div class="field-row">
        <div><label class="field-label">Type</label><select class="field-input" id="leave-type" name="type" onchange="updateLeaveImpactNote()"><option value="Casual/Sick">Casual/Sick</option><option value="WFH">WFH</option><option value="Partially Paid WFH (75% payout)">Partially Paid WFH (75% payout)</option><option value="Unpaid Leave">Unpaid Leave</option></select></div>
        <div><label class="field-label">Duration</label><select class="field-input" id="leave-duration" name="duration" onchange="updateLeaveImpactNote()"><option value="Full Day">Full Day</option><option value="Half Day">Half Day</option><option value="Quarter Day">Quarter Day</option></select></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">From</label><input class="field-input" id="leave-from" type="date" name="from" value="${TODAY}" required onchange="updateLeaveImpactNote()"></div>
        <div><label class="field-label">To</label><input class="field-input" id="leave-to" type="date" name="to" value="${TODAY}" required onchange="updateLeaveImpactNote()"></div>
      </div>
      <div class="subtext">Half Day and Quarter Day apply only when From and To are the same date — a multi-day range is counted as full days. Weekly offs and holidays inside a range aren't counted.</div>
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
// calendar month in case the range straddles a month boundary, against the org-wide monthly cap. Half and
// Quarter Day requests count as 0.5 / 0.25 of a day. The real deduction still only applies once HR approves the request.
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
  const isPartial = typeEl ? typeEl.value === 'Partially Paid WFH (75% payout)' : false;
  const isUnpaid = typeEl ? typeEl.value === 'Unpaid Leave' : false;
  const isWfh = isPartial || (typeEl ? typeEl.value === 'WFH' : false);
  if(!from || !to || to<from){ noteEl.innerHTML = ''; return; }
  if(isUnpaid){
    noteEl.innerHTML = `<div class="banner" style="margin-top:2px;margin-bottom:10px;">
      <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
      <div><b>Unpaid leave.</b> Every approved day is deducted from salary (Loss of Pay) and doesn't use your paid-leave allowance.</div>
    </div>`;
    return;
  }

  // Split the requested (new) days by calendar month — working days only (a weekly off or holiday isn't a day taken), and a single-day
  // Half / Quarter Day counts as that fraction of a day.
  const fraction = duration==='Half Day' ? 0.5 : duration==='Quarter Day' ? 0.25 : 1;
  const newDaysByMonth = {};
  for(let d=new Date(from+"T00:00:00Z"), end=new Date(to+"T00:00:00Z"); d<=end; d=new Date(d.getTime()+86400000)){
    const ds = d.toISOString().slice(0,10);
    if(!isPlanWorkingDay(ds)) continue;
    const m = ds.slice(0,7);
    newDaysByMonth[m] = (newDaysByMonth[m]||0) + (from===to ? fraction : 1);
  }
  const months = Object.keys(newDaysByMonth);
  if(!months.length){
    noteEl.innerHTML = `<div class="banner" style="margin-top:2px;margin-bottom:10px;"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div><b>Nothing to apply for.</b> ${from===to?'That day is':'Every day in that range is'} a weekly off or holiday.</div></div>`;
    return;
  }

  noteEl.innerHTML = `<div class="banner muted" style="margin-top:2px;margin-bottom:10px;"><div>Checking your allowance…</div></div>`;
  await Promise.all(months.map(async m=>{
    if(!applyLeaveMonthUsage[m]){
      applyLeaveMonthUsage[m] = await apiJson(`/api/hr/leave-balance/${currentUser._dbId}?month=${m}`).then(r=>r.balance).catch(()=>null);
    }
  }));
  // The form may have changed again while that fetch was in flight — bail rather than show a stale preview.
  if(fromEl.value!==from || toEl.value!==to || !document.getElementById('leave-impact-note')) return;

  const dayKey = isWfh ? 'wfhDays' : 'leaveDays', capKey = isWfh ? 'wfhCap' : 'leaveCap';
  const perDay = m=>{ const wd = workingDaysInMonth(m); return (currentUser.salary && wd) ? currentUser.salary/wd : 0; };
  const withExcess = months.map(m=>{
    const usage = applyLeaveMonthUsage[m];
    if(!usage) return null;
    const newTotal = usage[dayKey] + newDaysByMonth[m];
    // Partially Paid WFH never uses the free allowance — every requested day is a 25% cut.
    const excess = isPartial ? newDaysByMonth[m] : Math.max(0, newTotal - usage[capKey]);
    return excess>0 ? {month:m, excess, cap:usage[capKey], partial:isPartial, cost:Math.round(perDay(m)*excess*(isWfh?0.25:1))} : null;
  }).filter(Boolean);

  if(withExcess.length){
    noteEl.innerHTML = `<div class="banner" style="margin-top:2px;margin-bottom:10px;">
      <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
      <div><b>This request will cause a pay cut.</b> ${withExcess.map(m=>`${m.excess} day${m.excess===1?"":"s"} in ${esc(monthLabel(m.month))} ${m.partial?"of Partially Paid WFH":`beyond your ${m.cap}/month ${isWfh?"paid-WFH":"paid-leave"} allowance`} — expect ${isWfh?"a 25% pay cut (paid at 75%)":"a Loss of Pay deduction"} for ${m.excess===1?"that day":"those days"} once approved${m.cost>0?` — about <b>−${inr(m.cost)}</b> from that month's pay`:''}.`).join(' ')}</div>
    </div>`;
  } else {
    noteEl.innerHTML = `<div class="banner muted" style="margin-top:2px;margin-bottom:10px;">
      <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
      <div>Within your paid ${isWfh?"WFH":"leave"} allowance — no pay impact expected.${months.length===1&&applyLeaveMonthUsage[months[0]]?` You'll have <b>${Math.max(0,applyLeaveMonthUsage[months[0]][capKey]-applyLeaveMonthUsage[months[0]][dayKey]-newDaysByMonth[months[0]])}</b> paid ${isWfh?"WFH":"leave"} day(s) left after this request.`:''}</div>
    </div>`;
  }
}
// My Attendance holds leave too: check-in and the month's record first, then leave & WFH balance, "Apply for leave" and the
// request history (workspaceLeave), all on one page.
function workspaceAttendance(){ return workspaceAttendanceCore() + workspaceLeave(); }
function workspaceAttendanceCore(){
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
// Employee-facing Advance Salary page: same requests as My Payroll's list (one source — the HR advances
// API), just on its own page with the recovery plan visible. Approval is HR's (Pending → Recovering), Finance
// pays it out, and the monthly deduction comes off payroll automatically.
function workspaceAdvance(){
  if(!currentUser) return '';
  const mine = advances.filter(a=>a.empId===currentUser.id).slice().sort((a,b)=>b.requested.localeCompare(a.requested));
  const outstanding = mine.filter(a=>a.status==="Recovering").reduce((s,a)=>s+a.balance,0);
  const kind = st => st==="Pending"?"warn":st==="Rejected"?"neg":st==="Recovering"?"blue":"pos";
  return `
  ${hasEmployeeRecord() ? `<div class="toolbar"><div></div><button class="btn primary" onclick="openRequestAdvance()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Request advance</button></div>` : noEmployeeRecordBanner("advance")}
  <div class="kpi-grid">
    <div class="kpi-card hero"><div class="kpi-label">Still to recover</div><div class="kpi-value mono ${outstanding>0?'warn':''}">${inr(outstanding)}</div><div class="kpi-sub">deducted from your payroll</div></div>
    <div class="kpi-card"><div class="kpi-label">Requests</div><div class="kpi-value mono">${mine.length}</div><div class="kpi-sub">${mine.filter(a=>a.status==="Pending").length} awaiting HR</div></div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Your advances</h3><div class="sub">Request history and recovery</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Requested</th><th class="num">Amount</th><th>Reason</th><th>Recovery plan</th><th class="num">Balance</th><th>Status</th></tr></thead>
      <tbody>${mine.length ? mine.map(a=>`<tr><td class="muted">${fmtDate(a.requested)}</td><td class="num mono">${inr(a.amount)}</td><td class="muted" style="max-width:240px;">${esc(a.reason)}</td><td class="muted">${a.deductFromMonth?`Deduct from ${monthLabel(a.deductFromMonth)}${a.installments>1?` · ${inr(a.monthlyDeduction)} × ${a.installments} months`:''}`:(a.installments>1?`${inr(a.monthlyDeduction)} × ${a.installments} months`:'Full, next payroll')}</td><td class="num mono">${a.status==="Recovering"?inr(a.balance):'—'}</td><td>${pill(a.status,kind(a.status))}</td></tr>`).join("") : `<tr><td colspan="6"><div class="empty">No advance requests yet.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
// Salary months an advance can be deducted from: this month and the next three, minus any month whose
// payroll for this employee already has money paid against it (own payroll only — the server re-checks).
// The first remaining month is the default.
function advanceMonthOptions(selected, empCode){
  const now = new Date();
  const closed = new Set(empCode===undefined ? myPayroll.filter(r=>r.payStatus!=="Unpaid").map(r=>r.month) : []);
  const months = [0,1,2,3].map(i=>{ const d=new Date(now.getFullYear(), now.getMonth()+i, 1); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); }).filter(m=>!closed.has(m) || m===selected);
  const pick = selected || months[0];
  return months.map(m=>`<option value="${m}" ${m===pick?'selected':''}>${monthLabel(m)}</option>`).join("");
}
function openRequestAdvance(){
  showModal(`
    <div class="modal-head"><h3>Request advance salary</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-request-advance"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Submitted to HR for approval — once approved, it is deducted automatically from the salary month you choose.</div></div>
      <div class="field-row">
        <div><label class="field-label">Amount (₹)</label><input class="field-input" type="number" name="amount" min="500" step="500" required placeholder="10000"></div>
        <div><label class="field-label">Deduct from salary of</label><select class="field-input" name="deductMonth" required>${advanceMonthOptions()}</select></div>
      </div>
      <div><label class="field-label">Reason</label><textarea class="field-input" name="reason" required placeholder="Brief reason for the request"></textarea></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Submit request</button></div></div>
    </form>`);
  document.getElementById("f-request-advance").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const amount = Number(f.get("amount")); const deductFromMonth = f.get("deductMonth");
    try{
      await apiJson("/api/hr/advances", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ amount, reason:f.get("reason"), deductFromMonth }) });
      advances = (await apiJson(`/api/hr/advances?employeeId=${currentUser._dbId}`)).advances.map(mapAdvance);
      toast("Advance request submitted"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't submit advance request"); }
  });
}

/* ===================== HR ===================== */
function statusKind(s){
  const map = {Present:"pos",Late:"warn","Half Day":"warn","On Leave":"neutral",Absent:"neg","Work From Home":"blue","Partially Paid WFH":"blue","Unpaid Leave":"neg",
    Approved:"pos",Pending:"warn",Rejected:"neg",Cancelled:"neutral",Recovering:"warn",Recovered:"pos",Paid:"pos",Open:"blue",Interview:"warn",Offer:"pos",Hired:"pos",Applied:"neutral",
    Permanent:"pos",Probation:"warn",
    Unpaid:"neg",Overpaid:"neg","Partially Paid":"warn","Payments pending":"warn","Adding entries":"neutral",
    New:"warn",Reviewed:"blue",Resolved:"pos"};
  return map[s] || "neutral";
}
function attendanceLabel(s){ return {present:"Present",late:"Late",half:"Half Day",absent:"Absent",leave:"On Leave",wfh:"Work From Home",wfhp:"Partially Paid WFH",unpaid:"Unpaid Leave"}[s]; }

/* ===================== HR SCORE =====================
   Out of 100:  Programs run 40 (each of the 3 program types run, or still scheduled) · Feedback rating 25 · Feedback
   response rate 10 · Requests handled on time 15 (leave / advance / withdrawal decided, or under 2 days old) ·
   Complaints picked up 10. A part with nothing to measure is left out and the rest re-weighted. */
function hrMonthScore(month){
  const asOf = [TODAY, monthEndOf(month)].sort()[0], mEnd = monthEndOf(month);
  const progs = programsInMonth(month).filter(p=>p.status!=="Cancelled");
  const done = progs.filter(p=>p.status==="Completed");
  const ratings = done.map(p=>p.rating).filter(r=>r!=null);
  const att = done.reduce((t,p)=>t+p.attendees.length,0), resp = done.reduce((t,p)=>t+p.responses,0);
  const reqs = [
    ...leaveRequests.filter(l=>(l.applied||'').slice(0,7)===month).map(r=>({status:r.status, d:r.applied})),
    ...advances.filter(a=>(a.requested||'').slice(0,7)===month).map(r=>({status:r.status, d:r.requested})),
    ...withdrawalRequests.filter(w=>(w.requested||'').slice(0,7)===month).map(r=>({status:r.status, d:r.requested})),
  ];
  const onTime = reqs.filter(r=>r.status!=="Pending" || r.d>=addDays(asOf,-2)).length;
  const comps = complaints.filter(c=>(c.submitted||'').slice(0,7)===month || (c.status==="New" && (c.submitted||'')<=mEnd));
  const typeOk = PROGRAM_TYPES.map(t=>({t, ok: progs.some(p=>p.type===t && (p.status==="Completed" || p.date>asOf)), overdue: progs.filter(p=>p.type===t && p.status!=="Completed" && p.date<=asOf).length}));
  const okCount = typeOk.filter(x=>x.ok).length, overdueCount = typeOk.reduce((t,x)=>t+x.overdue,0);
  const avg = ratings.length ? ratings.reduce((a,b)=>a+b,0)/ratings.length : null;
  const parts = [
    {key:"programs", label:"Programs run", w:40, v: okCount/PROGRAM_TYPES.length, detail:`${okCount} of ${PROGRAM_TYPES.length} types run or on schedule${overdueCount?` · ${overdueCount} not run on its date`:''}${okCount<PROGRAM_TYPES.length?` · missing ${typeOk.filter(x=>!x.ok).map(x=>x.t.toLowerCase()).join(', ')}`:''}`},
    {key:"feedback", label:"Feedback rating", w:25, v: avg==null ? null : avg/5, detail: avg==null ? "no feedback yet" : `${avg.toFixed(1)} / 5 average`},
    {key:"response", label:"Feedback response rate", w:10, v: att ? Math.min(1, resp/att) : null, detail: att ? `${resp} of ${att} attendees replied` : "—"},
    {key:"requests", label:"Requests handled on time", w:15, v: reqs.length ? onTime/reqs.length : null, detail: reqs.length ? `${onTime} of ${reqs.length} decided or under 2 days old` : "no requests this month"},
    {key:"complaints", label:"Complaints picked up", w:10, v: comps.length ? comps.filter(c=>c.status!=="New").length/comps.length : 1, detail: comps.length ? `${comps.filter(c=>c.status!=="New").length} of ${comps.length} reviewed` : "no complaints — full marks"},
  ];
  return {score: weightedScoreOf(parts), parts};
}
function hrOverview(){
  const hrMonth = TODAY.slice(0,7), hrPrev = prevMonth(hrMonth), hrP = monthLabel(hrPrev).split(' ')[0];
  const present = Object.values(attendanceToday).filter(a=>a.status==="present").length;
  const late = Object.values(attendanceToday).filter(a=>a.status==="late").length;
  const half = Object.values(attendanceToday).filter(a=>a.status==="half").length;
  const onLeave = Object.values(attendanceToday).filter(a=>a.status==="leave"||a.status==="unpaid").length;
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
  ${monthScorePanelHTML(`HR Score · ${monthLabel(hrMonth)}`, `Programs, feedback, requests and complaints · vs ${hrP}`, hrMonthScore(hrMonth), hrMonthScore(hrPrev), hrP)}
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
function setEmployeeSearch(v){
  employeeSearch = v;
  // The whole directory re-renders on each keystroke, which replaces the input itself — put the cursor back
  // where it was, or the box loses focus after every character.
  const box = document.activeElement, pos = box && box.id==="employee-search" ? box.selectionStart : null;
  document.getElementById("content").innerHTML = hrDirectory();
  const fresh = document.getElementById("employee-search");
  if(fresh && pos!==null){ fresh.focus(); fresh.setSelectionRange(pos, pos); }
}
function hrDirectory(){
  let list = employees.filter(e=>{
    const matchesSearch = [e.name, e.role, e.id, e.dept, e.email].join(" ").toLowerCase().includes(employeeSearch.trim().toLowerCase());
    const matchesDept = employeeDept==="All" || e.dept===employeeDept;
    return matchesSearch && matchesDept;
  }).sort((a,b)=>a.name.localeCompare(b.name));
  const chips = ["All",...DEPARTMENTS].map(d=>`<button class="chip ${employeeDept===d?'active':''}" onclick="setDeptFilter('${esc(d)}')">${esc(d)}</button>`).join(" ");
  return `
  <div class="toolbar">
    <div class="filter-group"><span class="filter-label">Department</span>${chips}</div>
    <div class="filter-group">
      <div class="search" style="width:200px;"><svg class="icon" style="width:14px;height:14px"><use href="#i-search"/></svg><input id="employee-search" placeholder="Search name, role, ID" value="${esc(employeeSearch)}" oninput="setEmployeeSearch(this.value)"></div>
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
  const order=["present","late","half","wfh","wfhp","absent","leave","unpaid"];
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
  const leave = hrLeaveParts();
  const date = selectedAttendanceDate;
  const isToday = date===TODAY;
  const dayMap = attendanceByDate[date] || {};
  const rows = employees.map(e=>({emp:e, a:dayMap[e.id] || {status:"present", in:null}}));
  const counts = {present:0,late:0,half:0,absent:0,leave:0,wfh:0,wfhp:0,unpaid:0};
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
  ${leave.requests}
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
  </div>
  ${leave.summary}`;
}

let leaveRequestsMonthFilter = "All";
async function setLeaveRequestsMonthFilter(v){
  leaveRequestsMonthFilter = v;
  const summaryMonth = (v!=='All' && v!=='Today') ? v : TODAY.slice(0,7);
  if(!attendanceMonthSummary[summaryMonth]) await loadAttendanceMonthSummary(summaryMonth).catch(()=>{});
  render();
}
// The two halves of the merged Attendance & Leave page: the requests list, and each employee's leave / WFH month.
function hrLeaveParts(){
  const filtered = leaveRequests.filter(l=>matchesDateFilter(l.from, leaveRequestsMonthFilter));
  const sorted = filtered.slice().sort((a,b)=>{ const order={Pending:0,Approved:1,Rejected:2,Cancelled:3}; if(order[a.status]!==order[b.status]) return order[a.status]-order[b.status]; return b.applied.localeCompare(a.applied); });
  const requests = `
  <div class="panel">
    <div class="panel-head" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;"><div><h3>Leave requests</h3><div class="sub">${leaveRequests.filter(l=>l.status==="Pending").length} pending · ${filtered.length} of ${leaveRequests.length}${dateFilterSuffix(leaveRequestsMonthFilter,'starting in')}</div></div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><div class="filter-group"><span class="filter-label">Show</span><select class="select-sm" onchange="setLeaveRequestsMonthFilter(this.value)">${dateFilterOptions(leaveRequests.map(l=>l.from), leaveRequestsMonthFilter)}</select></div><button class="btn primary" onclick="openAddLeave()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New leave request</button></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th class="num">Days</th><th>Reason</th><th>Status</th><th></th></tr></thead>
      <tbody>${sorted.map(l=>{
        const emp=byId(l.empId);
        const range = l.from===l.to ? fmtDateShort(l.from) : `${fmtDateShort(l.from)} – ${fmtDateShort(l.to)}`;
        const actions = l.status==="Pending" ? `<div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm" onclick="decideLeave('${l.id}','Approved')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Approve</button><button class="btn btn-sm danger" onclick="decideLeave('${l.id}','Rejected')">Reject</button></div>` : (l.note ? `<span class="faint" style="font-size:11.5px;">${esc(l.note)}</span>` : "");
        return `<tr><td>${personCell(emp)}</td><td>${esc(l.type)}${l.duration && l.duration!=="Full Day" ? ` <span class="faint">· ${esc(l.duration)}</span>` : ""}</td><td class="muted">${range}</td><td class="num">${l.days}</td><td class="muted">${esc(l.reason)}</td><td>${pill(l.status,statusKind(l.status))}</td><td>${actions}</td></tr>`;
      }).join("") || `<tr><td colspan="7"><div class="empty">No leave requests${leaveRequestsMonthFilter==='All'?' yet':' for this range'}.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
  const summary = (()=>{
    // Marked "On Leave"/"WFH" in Attendance for the chosen month — computed the same way payroll's
    // Loss of Pay / WFH pay-cut are (computeLopDays()/computeWfhExcessDays()), both against the
    // org-wide monthly caps set in HR Settings. Monthly caps, not an annual balance — there's no
    // "Leave balances" table anymore, since that concept no longer exists in this policy.
    const summaryMonth = (leaveRequestsMonthFilter!=='All' && leaveRequestsMonthFilter!=='Today') ? leaveRequestsMonthFilter : TODAY.slice(0,7);
    const summary = attendanceMonthSummary[summaryMonth] || {};
    return `
  <div class="panel">
    <div class="panel-head"><h3>Leave &amp; WFH — ${esc(monthLabel(summaryMonth))}</h3><div class="sub">${hrPolicy.paidLeavesPerMonth} paid leave day${hrPolicy.paidLeavesPerMonth===1?'':'s'} &amp; ${hrPolicy.paidWfhPerMonth} paid WFH day${hrPolicy.paidWfhPerMonth===1?'':'s'} per employee per month — set in HR Settings</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Employee</th><th class="num">On Leave</th><th class="num">LOP days</th><th class="num">WFH</th><th class="num">WFH pay-cut days</th><th></th></tr></thead>
      <tbody>${employees.map(e=>{ const c=summary[e.id]||{leave:0,wfh:0}; const lop=Math.max(0,c.leave-(c.leaveCap ?? hrPolicy.paidLeavesPerMonth)); const wfhCut=Math.max(0,c.wfh-(c.wfhCap ?? hrPolicy.paidWfhPerMonth))+(c.partialWfh||0); return `<tr><td>${personCell(e)}</td><td class="num">${c.leave||'—'}</td><td class="num ${lop>0?'warn':''}">${lop||'—'}</td><td class="num">${c.wfh||'—'}</td><td class="num ${wfhCut>0?'warn':''}">${wfhCut||'—'}</td><td class="num"><button class="btn btn-sm ghost" onclick="openLeaveBalance('${e.id}')">Balance</button></td></tr>`; }).join("")}</tbody>
    </table></div>
  </div>`;
  })();
  return {requests, summary};
}

let hiringFilter = { dept:"", role:"" };
function setHiringFilter(key, val){
  hiringFilter[key] = val;
  if(key==="dept" && hiringFilter.role && !openPositions.some(p=>p.dept===val && p.role===hiringFilter.role) && val) hiringFilter.role = "";
  render();
}
function clearHiringFilter(){ hiringFilter = { dept:"", role:"" }; render(); }
function hiringFilterBar(){
  const depts = [...new Set(openPositions.map(p=>p.dept).filter(Boolean))].sort();
  const roles = [...new Set(openPositions.filter(p=>!hiringFilter.dept || p.dept===hiringFilter.dept).map(p=>p.role).filter(Boolean))].sort();
  const opt = (v,cur)=>`<option value="${esc(v)}" ${v===cur?"selected":""}>${esc(v)}</option>`;
  return `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
    <div class="filter-group"><span class="filter-label">Department</span><select class="select-sm" onchange="setHiringFilter('dept',this.value)"><option value="">All departments</option>${depts.map(d=>opt(d,hiringFilter.dept)).join("")}</select></div>
    <div class="filter-group"><span class="filter-label">Role</span><select class="select-sm" onchange="setHiringFilter('role',this.value)"><option value="">All roles</option>${roles.map(r=>opt(r,hiringFilter.role)).join("")}</select></div>
    ${(hiringFilter.dept||hiringFilter.role)?`<button class="btn btn-sm ghost" onclick="clearHiringFilter()">Clear filters</button>`:""}
  </div>`;
}
function hrHiring(){
  const filtering = !!(hiringFilter.dept || hiringFilter.role);
  const posMatch = p => (!hiringFilter.dept || p.dept===hiringFilter.dept) && (!hiringFilter.role || p.role===hiringFilter.role);
  const candMatch = c => { if(!filtering) return true; const pos=openPositions.find(p=>p.id===c.posId); return !!pos && posMatch(pos); };
  const activePositions = openPositions.filter(p=>!p.archived);
  const archivedPositions = openPositions.filter(p=>p.archived);
  const allActiveCandidates = candidates.filter(c=>!c.archived);
  const activeCandidates = allActiveCandidates.filter(candMatch);
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
    <div class="panel-head" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;"><div><h3>Candidates</h3><div class="sub">${filtering?`${activeCandidates.length} of ${allActiveCandidates.length} shown`:`${allActiveCandidates.length} in pipeline`}</div></div>${hiringFilterBar()}</div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Candidate</th><th>Applying for</th><th>Contact</th><th>Applied</th><th>Stage</th><th></th></tr></thead>
      <tbody>${(activeCandidates.length||!filtering)?"":`<tr><td colspan="6"><div class="empty">No candidates match the filter.</div></td></tr>`}${activeCandidates.map(c=>{ const pos=openPositions.find(p=>p.id===c.posId); return `<tr><td style="font-weight:700;">${esc(c.name)}</td><td class="muted">${pos?esc(pos.role):"—"}</td><td class="muted mono" style="font-size:12px;">${esc(c.phone)}</td><td class="muted">${fmtDate(c.appliedDate)}</td><td><select class="select-sm" onchange="updateCandidateStage('${c.id}',this.value)">${CANDIDATE_STAGES.map(s=>`<option value="${s}" ${s===c.stage?'selected':''}>${s}</option>`).join("")}</select></td><td><div style="display:flex;gap:6px;justify-content:flex-end;">${c.hasResume?`<button class="btn btn-sm ghost" onclick="downloadCandidateResume('${c.id}')" title="Download resume"><svg class="icon" style="width:12px;height:12px"><use href="#i-download"/></svg>Resume</button>`:""}<button class="btn btn-sm ghost" onclick="openOfferLetter('${c.id}')" title="Offer letter"><svg class="icon" style="width:12px;height:12px"><use href="#i-file"/></svg></button><button class="btn btn-sm ghost" onclick="archiveCandidate('${c.id}')" title="Archive"><svg class="icon" style="width:12px;height:12px"><use href="#i-archive"/></svg></button></div></td></tr>`; }).join("") || `<tr><td colspan="6"><div class="empty">No candidates in the pipeline.</div></td></tr>`}</tbody>
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
// Authenticated file download — plain <a href> can't carry the Bearer token, so fetch it as a
// blob through the same Auth.apiFetch() every other call uses, then hand the browser a throwaway
// object URL to save. Mirrors what a "download the actual bytes" action looks like here; every
// other download in this app (invoice/receipt) instead prints a client-generated document, since
// this is the one case where a real file exists on the server to fetch.
async function downloadCandidateResume(id){
  // Looked up rather than passed in through the onclick string — a name is free text (an
  // apostrophe in it, e.g. "D'Souza", would break out of the single-quoted inline argument the
  // same way an unquoted UUID did elsewhere on this board; see the Content Pipeline fix above).
  const c = candidates.find(x=>x.id===id);
  try{
    const res = await Auth.apiFetch(`/api/hr/candidates/${id}/resume`);
    if(!res.ok){ const d = await res.json().catch(()=>({})); throw new Error(d.error || "Couldn't download resume"); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = ((c && c.name) || "resume").replace(/[^\w.-]+/g,"_") + ".pdf";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
  }catch(err){ toast(err.message || "Couldn't download resume"); }
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
  if(!payroll.history[month]) return `<div class="panel"><div class="panel-body"><div class="empty">Payroll for ${MONTH_LABEL[month]||month} isn't available — you may not have access, or it failed to load.</div></div></div>`;
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
    <div class="table-wrap"><table class="data"><thead><tr><th>Employee</th><th class="num">Gross</th><th class="num">Deductions</th><th class="num">Net pay</th><th class="num">Paid</th><th class="num">Balance</th><th>Next due</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.length ? rows.map(r=>`<tr><td>${personCell(r.emp)}</td><td class="num mono">${inr(r.calc.gross)}</td><td class="num mono">${inr(r.calc.totalDeductions)}${r.calc.lopDeduction>0?`<div class="subtext" style="color:var(--neg);text-align:right;">incl. ${r.calc.lopDays}d LOP</div>`:""}${r.calc.wfhDeduction>0?`<div class="subtext" style="color:var(--neg);text-align:right;">incl. ${r.calc.wfhExcessDays}d WFH</div>`:""}</td><td class="num mono" style="font-weight:700;">${inr(r.calc.net)}</td><td class="num mono ${r.calc.paid>0?'':'faint'}">${r.calc.paid>0?inr(r.calc.paid):'—'}</td><td class="num mono ${r.calc.balance>0?'warn':r.calc.paid>r.calc.net?'':'faint'}" ${r.calc.paid>r.calc.net?'style="color:var(--neg);" title="Paid more than net pay"':''}>${r.calc.balance>0?inr(r.calc.balance):(r.calc.paid>r.calc.net?'Extra '+inr(r.calc.paid-r.calc.net):'—')}</td><td>${nextDueCell(r.calc)}</td><td>${pill(r.calc.payStatus,statusKind(r.calc.payStatus))}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;">${(!readOnly && r.calc.balance>0)?`<button class="btn btn-sm" onclick="openRecordPayment('${r.emp.id}')">Pay</button>`:""}<button class="btn btn-sm ghost" onclick="openPayslip('${r.emp.id}',${!!readOnly})">Payslip</button>${(!readOnly&&(isHRRole(currentUser)||isFinanceAdminUser(currentUser)))?`<button class="btn btn-sm ghost" onclick="openDeletePayroll('${r.emp.id}')" title="Delete a payment or remove from this month's payroll" style="color:var(--neg);">Delete</button>`:""}<button class="btn btn-sm ghost" onclick="openAddPayrollEntry('${r.emp.id}')" title="Edit this month's gross salary (not payments — use Payslip to fix payments)"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg></button></div></td></tr>`).join("") : `<tr><td colspan="9"><div class="empty">No one added to this month's payroll yet.</div></td></tr>`}</tbody>
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

// One page for both kinds of early-pay request: an Advance (against this month's salary, HR approves, recovered from
// payroll) and a Withdrawal (a closed, earned month paid early, Finance/Admin approve). Pending first, then newest.
let advancesTypeFilter = "All";
function setAdvancesTypeFilter(v){ advancesTypeFilter = v; render(); }
function hrAdvances(){
  const canDecideWithdrawal = isFinanceAdminUser(currentUser);
  const rows = [
    ...advances.map(a=>({kind:"Advance", id:a.id, empId:a.empId, amount:a.amount, requested:a.requested, status:a.status,
      detail:esc(a.reason||'')+(a.deductFromMonth?`<div class="subtext">Deduct from ${monthLabel(a.deductFromMonth)} salary</div>`:''),
      balance:a.status==='Rejected'?null:a.balance})),
    ...withdrawalRequests.map(w=>({kind:"Withdrawal", id:w.id, empId:w.empId, empName:w.empName, amount:w.amount, requested:w.requested, status:w.status, decided:w.decidedDate,
      detail:`Against ${esc(MONTH_LABEL[w.month]||monthLabel(w.month))} salary`, balance:w.status==='Approved'?0:null})),
  ];
  const inView = rows.filter(r=>(advancesTypeFilter==='All' || r.kind===advancesTypeFilter) && matchesDateFilter(r.requested, advancesMonthFilter));
  const order = {Pending:0, Recovering:1, Recovered:2, Approved:2, Rejected:3};
  inView.sort((a,b)=>(order[a.status]-order[b.status]) || b.requested.localeCompare(a.requested));
  const pend = rows.filter(r=>r.status==="Pending");
  const toRecover = advances.filter(a=>a.status==="Recovering").reduce((t,a)=>t+a.balance,0);
  const month = TODAY.slice(0,7);
  const wdPaid = withdrawalRequests.filter(w=>w.status==="Approved" && (w.decidedDate||w.requested||'').slice(0,7)===month).reduce((t,w)=>t+w.amount,0);
  const kindPill = k => `<span class="tag type" style="${k==='Withdrawal'?'background:var(--blue-soft);color:var(--blue);':''}">${k}</span>`;
  const btns = (ok, no) => `<div style="display:flex;gap:6px;justify-content:flex-end;">${ok}<button class="btn btn-sm danger" onclick="${no}">Reject</button></div>`;
  const actions = r => {
    if(r.kind==="Advance") return r.status==="Pending" ? btns(`<button class="btn btn-sm" onclick="openApproveAdvance('${r.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Approve</button>`, `decideAdvance('${r.id}','Rejected')`) : '';
    return r.status==="Pending" && canDecideWithdrawal ? btns(`<button class="btn btn-sm" onclick="decideWithdrawal('${r.id}','Approved')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Approve &amp; pay</button>`, `decideWithdrawal('${r.id}','Rejected')`) : '';
  };
  return `
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div><b>Advance</b> — money against this month's salary, before it's fully earned. HR approves, then it's recovered from payroll. <b>Withdrawal</b> — an early payout from a month that's already closed and earned. Approving pays it at once against that month's payroll.${canDecideWithdrawal?'':' Approving or rejecting a withdrawal is Finance/Admin only — you can see everything here.'}</div></div>
  <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
    <div class="kpi-card"><div class="kpi-label">Waiting on approval</div><div class="kpi-value mono ${pend.length?'warn':''}">${pend.length}</div><div class="kpi-sub">${pend.filter(r=>r.kind==='Advance').length} advance · ${pend.filter(r=>r.kind==='Withdrawal').length} withdrawal</div></div>
    <div class="kpi-card"><div class="kpi-label">Advances to recover</div><div class="kpi-value mono">${inr(toRecover)}</div><div class="kpi-sub">approved, still being deducted</div></div>
    <div class="kpi-card"><div class="kpi-label">Withdrawals paid · ${monthLabel(month).split(' ')[0]}</div><div class="kpi-value mono">${inr(wdPaid)}</div><div class="kpi-sub">taken off payroll this month</div></div>
  </div>
  <div class="toolbar">
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;">
      <div class="filter-group"><span class="filter-label">Type</span><div>${["All","Advance","Withdrawal"].map(t=>`<button class="chip ${advancesTypeFilter===t?'active':''}" onclick="setAdvancesTypeFilter('${t}')">${t==='All'?'All':t+'s'}</button>`).join(' ')}</div></div>
      <div class="filter-group"><span class="filter-label">Show</span><select class="select-sm" onchange="setAdvancesMonthFilter(this.value)">${dateFilterOptions(rows.map(r=>r.requested), advancesMonthFilter)}</select></div>
    </div>
    <button class="btn primary" onclick="openAddAdvance()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New advance</button>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Requests</h3><div class="sub">${inView.length} of ${rows.length}${dateFilterSuffix(advancesMonthFilter,'requested in')} · pending first, then newest</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Employee</th><th>Type</th><th class="num">Amount</th><th>Details</th><th>Requested</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
      <tbody>${inView.length ? inView.map(r=>{ const emp = byId(r.empId); const shown = r.kind==="Withdrawal" && r.status==="Approved" ? "Paid" : r.status; return `<tr><td>${emp?personCell(emp):`${esc(r.empName||r.empId)}<div class="subtext mono">${esc(r.empId)}</div>`}</td><td>${kindPill(r.kind)}</td><td class="num mono">${inr(r.amount)}</td><td class="muted">${r.detail}</td><td class="muted">${fmtDate(r.requested)}</td><td class="num mono">${r.balance==null?'—':inr(r.balance)}</td><td>${pill(shown, statusKind(shown))}</td><td>${actions(r)}</td></tr>`; }).join('') : `<tr><td colspan="8"><div class="empty">No requests${advancesMonthFilter==='All'&&advancesTypeFilter==='All'?' yet':' for this view'}.</div></td></tr>`}</tbody>
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
  ${payrollSplitPanel()}
  <div class="panel">
    <div class="panel-head"><h3>Monthly paid leave &amp; WFH allowance</h3><div class="sub">What actually drives payroll's Loss of Pay and WFH pay-cut, every month</div></div>
    <div class="panel-body">
      <div class="field-row">
        <div><label class="field-label">Paid leave (days/month)</label><input class="field-input" id="policy-paid-leaves" type="number" min="0" step="1" value="${hrPolicy.paidLeavesPerMonth}"></div>
        <div><label class="field-label">Paid WFH (days/month)</label><input class="field-input" id="policy-paid-wfh" type="number" min="0" step="1" value="${hrPolicy.paidWfhPerMonth}"></div>
      </div>
      <div class="field-row" style="margin-top:10px;">
        <div><label class="field-label">Carry-forward cap (paid-leave days, 0 = off)</label><input class="field-input" id="policy-carry-forward" type="number" min="0" max="31" step="1" value="${hrPolicy.carryForwardMaxDays||0}"></div>
        <div class="subtext" style="align-self:end;">Unused paid-leave days roll into the next month, up to this many. ${hrPolicy.carryForwardMaxDays>0&&hrPolicy.carryForwardStartMonth?`Active from ${esc(monthLabel(hrPolicy.carryForwardStartMonth))} — earlier months are never re-priced.`:'Once switched on it starts next month. WFH days never carry forward.'}</div>
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
      carryForwardMaxDays: Number(document.getElementById("policy-carry-forward").value) || 0,
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
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Grant them a login now (email above + a password you set), or skip this and add it later — not every employee needs ERP access. Every login gets the base Employee role (their own attendance/leave/payslips) automatically; choose “Yes” below, then tick the modules they should see — a person can hold more than one.</div></div>
      <div class="field-row">
        <div><label class="field-label">Grant ERP access</label><select class="field-input" name="grant" onchange="document.getElementById('grant-role-row').hidden = this.value!=='yes'">${'<option value="no">No login for now</option><option value="yes">Yes — set a password</option>'}</select></div>
        <div><label class="field-label">Password (if granting access)</label><input class="field-input" type="password" name="password" minlength="8" placeholder="At least 8 characters"></div>
      </div>
      <div id="grant-role-row" hidden>
        <label class="field-label">Modules they can access (My Workspace is always included)</label>
        ${accessCheckboxes([])}
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Add employee</button></div></div>
    </form>`);
  document.getElementById("f-add-employee").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const grantAccess = f.get("grant")==="yes" ? { password: f.get("password"), roles: accessRolesFromForm(f, []) } : undefined;
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
        ${e.employmentStatus==="Active" ? `<button class="btn btn-sm ghost" onclick="openMarkNoticePeriod('${e.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-bell"/></svg>Mark notice period</button><button class="btn btn-sm danger" onclick="openConfirmDeparture('${e.id}', true)"><svg class="icon" style="width:12px;height:12px"><use href="#i-archive"/></svg>Terminate</button>` : ""}
        ${e.employmentStatus==="Notice Period" ? `<button class="btn btn-sm ghost" onclick="cancelNoticePeriod('${e.id}')">Cancel notice period</button><button class="btn btn-sm danger" onclick="openConfirmDeparture('${e.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-archive"/></svg>Confirm departure</button><button class="btn btn-sm danger" onclick="openConfirmDeparture('${e.id}', true)">Terminate now</button>` : ""}
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
      ${e.hasErpAccess ? "" : `<div><label class="field-label">Modules they can access (My Workspace is always included)</label>${accessCheckboxes([])}</div>`}
    </div>
    <div class="modal-foot"><button type="button" class="btn ghost" onclick="openEmployeeDetail('${e.id}')">Back</button><button type="submit" class="btn primary">${e.hasErpAccess?"Reset password":"Grant access"}</button></div>
    </form>`);
  document.getElementById("f-grant-access").addEventListener("submit", async ev=>{
    ev.preventDefault();
    const f = new FormData(ev.target);
    try{
      await apiJson(`/api/hr/employees/${employeeDbIdByCode[id]}/grant-access`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ password: f.get("password"), roles: accessRolesFromForm(f, []) }) });
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
function openConfirmDeparture(id, terminate){
  const e = byId(id);
  showModal(`
    <div class="modal-head"><h3>${terminate?"Terminate employee":"Confirm departure"}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div class="person" style="margin-bottom:4px;">${personCell(e)}</div>
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-archive"/></svg><div>This removes them from the ERP: they leave the active directory, and their sign-in is blocked immediately. Their records are kept in the archive and you can reinstate them later if needed.</div></div>
      <div><label class="field-label">${terminate?"Termination date":"Last working day"}</label><input class="field-input" type="date" id="departure-date" value="${e.leavingDate||TODAY}"></div>
      ${terminate?`<div><label class="field-label">Reason (optional)</label><textarea class="field-input" id="departure-reason" rows="3" style="resize:vertical;font-family:inherit;" placeholder="Why is this person being terminated?"></textarea></div>`:""}
    </div>
    <div class="modal-foot"><button type="button" class="btn ghost" onclick="openEmployeeDetail('${e.id}')">Back</button><button type="button" class="btn danger" onclick="confirmDeparture('${e.id}')">${terminate?"Terminate &amp; remove from ERP":"Confirm &amp; archive"}</button></div>`);
}
async function confirmDeparture(id){
  const e = byId(id);
  const dateInput = document.getElementById('departure-date');
  const reasonInput = document.getElementById('departure-reason');
  try{
    await apiJson(`/api/hr/employees/${employeeDbIdByCode[id]}/confirm-departure`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ leavingDate: (dateInput && dateInput.value) || undefined, reason: (reasonInput && reasonInput.value.trim()) || undefined }) });
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
      <div class="section-label">ERP access</div>
      ${e.hasErpAccess
        ? `<div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Tick the modules ${esc(e.name)} can open. My Workspace is always included. Changes apply on their next request — no logout needed.</div></div>`
        : `<div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>No ERP login yet. Tick the modules and set a password to create their login (login email: ${esc(e.email)}), or leave both empty to skip.</div></div>
      <div><label class="field-label">Password (to create their login)</label><input class="field-input" type="password" name="password" minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></div>`}
      <div><label class="field-label">Modules they can access (My Workspace is always included)</label>${accessCheckboxes(e.erpRoles)}</div>
    </div>
    <div class="modal-foot"><button type="button" class="btn ghost" onclick="openEmployeeDetail('${e.id}')">Back</button><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save changes</button></div></div>
    </form>`);
  document.getElementById("f-edit-employee").addEventListener("submit", async ev=>{
    ev.preventDefault();
    const f = new FormData(ev.target);
    const wantLogin = !e.hasErpAccess && (f.get("password") || f.getAll("grantRole").length);
    if(wantLogin && (f.get("password")||"").length<8){ toast("Set a password of at least 8 characters to create their login"); return; }
    try{
      await apiJson(`/api/hr/employees/${employeeDbIdByCode[id]}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({
        name: f.get("name"), dept: f.get("dept"), role: f.get("role"), joinedAt: f.get("joined"), dob: f.get("dob")||undefined,
        email: f.get("email"), phone: f.get("phone"), empType: TITLECASE_TO_API(f.get("empType")),
      })});
      if(wantLogin){
        await apiJson(`/api/hr/employees/${employeeDbIdByCode[id]}/grant-access`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ password: f.get("password"), roles: accessRolesFromForm(f, []) }) });
      } else if(e.hasErpAccess){
        const roles = accessRolesFromForm(f, e.erpRoles);
        if([...roles].sort().join() !== [...new Set(["EMPLOYEE",...e.erpRoles])].sort().join())
          await apiJson(`/api/hr/employees/${employeeDbIdByCode[id]}/access`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ roles }) });
      }
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
        <div><label class="field-label">Type</label><select class="field-input" name="type"><option value="Casual/Sick">Casual/Sick</option><option value="WFH">WFH</option><option value="Partially Paid WFH (75% payout)">Partially Paid WFH (75% payout)</option><option value="Unpaid Leave">Unpaid Leave</option></select></div>
        <div><label class="field-label">Duration</label><select class="field-input" name="duration"><option value="Full Day">Full Day</option><option value="Half Day">Half Day</option><option value="Quarter Day">Quarter Day</option></select></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">From</label><input class="field-input" type="date" name="from" value="${TODAY}" required></div>
        <div><label class="field-label">To</label><input class="field-input" type="date" name="to" value="${TODAY}" required></div>
      </div>
      <div class="subtext">Half Day and Quarter Day apply only when From and To are the same date — a multi-day range is counted as full days. Weekly offs and holidays inside a range aren't counted.</div>
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
        <div><label class="field-label">Deduct from salary of</label><select class="field-input" name="deductMonth" required>${advanceMonthOptions(null,"hr")}</select></div>
      </div>
      <div><label class="field-label">Reason</label><textarea class="field-input" name="reason" required placeholder="Brief reason for the request"></textarea></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Submit request</button></div></div>
    </form>`);
  document.getElementById("f-add-advance").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const amount = Number(f.get("amount")); const deductFromMonth = f.get("deductMonth");
    try{
      await apiJson("/api/hr/advances", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({
        employeeId: employeeDbIdByCode[f.get("empId")], amount, reason:f.get("reason"), deductFromMonth,
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
  // Wherever this ERP is actually deployed (test.desgromedia.com today, the real domain in
  // prod) — careers.html is served from the same origin, no separate hosting/DNS needed, and
  // this can never drift into a fake/dead link the way a hardcoded domain string would.
  const link = window.location.origin + "/careers.html";
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
    showOfferLetterPreview(data, cId);
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
let currentOffer = null;
function showOfferLetterPreview(d, candidateId){
  currentOffer = { data:d, candidateId:candidateId||null };
  const cand = candidateId ? candidates.find(c=>c.id===candidateId) : null;
  const text = buildOfferLetterText(d);
  const canSend = !!(cand && cand.email);
  showModal(`
    <div class="modal-head"><h3>Offer letter — ${esc(d.name)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <textarea class="field-input" id="offer-letter-textarea" rows="18" readonly style="resize:vertical;font-family:inherit;white-space:pre-wrap;">${esc(text)}</textarea>
      <div class="muted" style="font-size:12px;margin-top:8px;">${canSend ? `Will be emailed as a PDF to <b>${esc(cand.email)}</b> (HR copied).` : (cand ? "This candidate has no email address, so it can't be sent." : "Manual entry — pick a candidate to email it.")}</div>
    </div>
    <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">Close</button><div style="display:flex;gap:8px;"><button class="btn ghost" onclick="copyApplyText('offer-letter-textarea','Offer letter copied')"><svg class="icon" style="width:13px;height:13px"><use href="#i-link"/></svg>Copy</button><button class="btn ghost" onclick="downloadOfferLetterPdf()"><svg class="icon" style="width:13px;height:13px"><use href="#i-download"/></svg>Download PDF</button><button class="btn primary" id="btn-send-offer" ${canSend?"":"disabled"} onclick="sendOfferLetter()">Send to candidate</button></div></div>`, true);
  toast(`Offer letter ready for ${d.name}`);
}
async function downloadOfferLetterPdf(){
  if(!currentOffer) return;
  try{
    const res = await Auth.apiFetch("/api/hr/offer-letter/pdf", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(currentOffer.data) });
    if(!res.ok){ const d = await res.json().catch(()=>({})); throw new Error(d.error || "Couldn't generate the PDF"); }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = "Offer letter - " + currentOffer.data.name.replace(/[^\w.-]+/g,"_") + ".pdf";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
  }catch(err){ toast(err.message || "Couldn't generate the PDF"); }
}
async function sendOfferLetter(){
  if(!currentOffer || !currentOffer.candidateId) return;
  const btn = document.getElementById("btn-send-offer");
  if(btn){ btn.disabled = true; btn.textContent = "Sending…"; }
  try{
    const r = await apiJson(`/api/hr/candidates/${currentOffer.candidateId}/offer-letter/send`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(currentOffer.data) });
    toast("Offer letter sent to " + r.to);
    closeModal();
  }catch(err){
    toast(err.message || "Couldn't send the offer letter");
    if(btn){ btn.disabled = false; btn.textContent = "Send to candidate"; }
  }
}

// ---- Payout schedule (instalments). The plan is stored; paid / balance / status are derived server-side
// from the payment records — see server/src/services/hr/payrollSchedule.ts.
// Finance dashboard reminder: salary instalments due today or overdue, from whatever payroll months are loaded.
function payrollInstalmentsDue(){
  if(!isFinanceAdminUser(currentUser)) return [];
  const out = [];
  Object.keys(payroll.history).forEach(m=>{ Object.entries(payroll.history[m].entries).forEach(([code,c])=>{
    const n = c.schedule && c.schedule.nextDue; const e = byId(code);
    if(n && e && n.dueDate<=TODAY) out.push({txt:`${esc(e.name)} — salary instalment ${n.status==='Overdue'?'overdue':'due today'}`, sub:`${inr(n.amount)} · ${MONTH_LABEL[m]||m} · due ${fmtDateShort(n.dueDate)}`, d:n.dueDate});
  }); });
  return out.sort((a,b)=>a.d.localeCompare(b.d));
}
function nextDueCell(c){
  const sc = c.schedule;
  if(c.paid>c.net) return '<span class="faint">—</span>';
  if(!sc || !sc.nextDue) return c.balance>0 ? '<span class="faint" style="font-size:12px;">No schedule</span>' : '<span class="faint">—</span>';
  const n = sc.nextDue;
  return `<div class="mono" style="font-size:12.5px;">${inr(n.amount)}</div><div class="subtext" style="${n.status==='Overdue'?'color:var(--neg);':''}">${n.status==='Overdue'?'overdue · ':''}${fmtDateShort(n.dueDate)}</div>`;
}
function scheduleTableHTML(c){
  const sc = c.schedule;
  if(!sc || !sc.instalments.length) return `<div class="empty" style="padding:12px 0;">No payout schedule — the full ${inr(c.net)} is due.</div>`;
  return `<table class="data" style="margin:0;"><thead><tr><th>#</th><th>Due</th><th class="num">Amount</th><th class="num">Paid</th><th>Status</th></tr></thead><tbody>${sc.instalments.map(i=>`<tr><td>${i.adjustment?'Adj.':i.seq}</td><td class="muted">${fmtDateShort(i.dueDate)}</td><td class="num mono">${inr(i.amount)}</td><td class="num mono ${i.paid>0?'':'faint'}">${i.paid>0?inr(i.paid):'—'}${i.paidDate?`<div class="subtext">${fmtDateShort(i.paidDate)}</div>`:''}</td><td>${pill(i.status, i.status==='Paid'?'pos':i.status==='Overdue'?'neg':'neutral')}</td></tr>`).join('')}</tbody></table>`
    + (sc.overpayment>0?`<div class="banner muted" style="margin-top:8px;"><div><b>Overpayment ${inr(sc.overpayment)}.</b> Net pay is now lower than what was already paid — resolve it (recover or carry it forward) rather than editing paid instalments.</div></div>`:'');
}
let scheduleDraft = [];
function openEditSchedule(id){
  const e = byId(id), month = payroll.selectedMonth, c = computePayrollRow(e, month);
  if(!c) return;
  scheduleDraft = (c.schedule.instalments||[]).map(i=>({amount:i.amount, dueDate:i.dueDate, paid:i.status==='Paid'}));
  if(!scheduleDraft.length) scheduleDraft = [{amount:c.net, dueDate:month+'-28', paid:false}];
  renderScheduleModal(id);
}
function renderScheduleModal(id){
  const e = byId(id), month = payroll.selectedMonth, c = computePayrollRow(e, month);
  const sum = scheduleDraft.reduce((s,r)=>s+(Number(r.amount)||0),0);
  const diff = Math.round((c.net-sum)*100)/100;
  showModal(`
    <div class="modal-head"><h3>Payout schedule — ${esc(e.name)} · ${MONTH_LABEL[month]}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Net payable <b>${inr(c.net)}</b> · paid so far <b>${inr(c.paid)}</b>. The instalments must add up to the net payable. Paid instalments are locked. Recording a payment (Pay) settles instalments oldest first.</div></div>
      ${scheduleDraft.map((r,i)=>`<div class="field-row" style="align-items:end;margin-top:8px;">
        <div><label class="field-label">Instalment ${i+1}${r.paid?' · paid':''}</label><input class="field-input" type="number" min="1" step="0.01" value="${r.amount}" ${r.paid?'disabled':''} oninput="scheduleDraft[${i}].amount=Number(this.value)" onchange="renderScheduleModal('${id}')"></div>
        <div><label class="field-label">Due date</label><input class="field-input" type="date" value="${r.dueDate}" ${r.paid?'disabled':''} onchange="scheduleDraft[${i}].dueDate=this.value"></div>
        ${r.paid?'':`<button class="btn btn-sm ghost" onclick="scheduleDraft.splice(${i},1);renderScheduleModal('${id}')" ${scheduleDraft.length<=1?'disabled':''}>Remove</button>`}
      </div>`).join('')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;">
        <button class="btn btn-sm ghost" onclick="scheduleDraft.push({amount:Math.max(1,${diff}),dueDate:'${month}-28',paid:false});renderScheduleModal('${id}')">+ Add instalment</button>
        <span class="mono ${Math.abs(diff)<0.005?'pos':'warn'}">${Math.abs(diff)<0.005?'Adds up to net pay':'Off by '+inr(diff)}</span>
      </div>
    </div>
    <div class="modal-foot"><button class="btn ghost" onclick="saveSchedule('${id}',true)">Reset to company default</button><div style="display:flex;gap:8px;"><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveSchedule('${id}')">Save schedule</button></div></div>`);
}
async function saveSchedule(id, useDefault){
  const e = byId(id), month = payroll.selectedMonth;
  try{
    await apiJson(`/api/hr/payroll/${employeeDbIdByCode[id]}/${month}/schedule`, { method:"PUT", headers:{"Content-Type":"application/json"},
      body: JSON.stringify(useDefault ? {useDefault:true} : {instalments: scheduleDraft.map(r=>({amount:Number(r.amount), dueDate:r.dueDate}))}) });
    await loadPayrollMonth(month);
    toast("Payout schedule saved"); closeModal(); render();
  }catch(err){ toast(err.message || "Couldn't save schedule"); }
}
// Company default split (HR Settings): rows of {percent, day}, day 0 = last day of the month.
let splitDraft = null;
function splitRows(){ return splitDraft || (hrPolicy.payrollDefaultSplit && hrPolicy.payrollDefaultSplit.length ? hrPolicy.payrollDefaultSplit : [{percent:100, day:0}]); }
function payrollSplitPanel(){
  const rows = splitRows();
  const total = rows.reduce((s,r)=>s+(Number(r.percent)||0),0);
  return `<div class="panel">
    <div class="panel-head"><h3>Payroll payout schedule</h3><div class="sub">Default split applied when an employee is added to a payroll month — HR/Finance can override it per employee or month</div></div>
    <div class="panel-body">
      ${rows.map((r,i)=>`<div class="field-row" style="align-items:end;margin-bottom:8px;">
        <div><label class="field-label">Payment ${i+1} — % of net pay</label><input class="field-input" type="number" min="1" max="100" step="1" value="${r.percent}" oninput="splitRowsEdit(${i},'percent',this.value)"></div>
        <div><label class="field-label">Day of month</label><select class="field-input" onchange="splitRowsEdit(${i},'day',this.value)">${[0,...Array.from({length:31},(_,k)=>k+1)].map(d=>`<option value="${d}" ${Number(r.day)===d?'selected':''}>${d===0?'Last day':d}</option>`).join('')}</select></div>
        <button class="btn btn-sm ghost" ${rows.length<=1?'disabled':''} onclick="splitRowsRemove(${i})">Remove</button>
      </div>`).join('')}
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <button class="btn btn-sm ghost" ${rows.length>=4?'disabled':''} onclick="splitRowsAdd()">+ Add payment</button>
        <span class="mono ${total===100?'pos':'warn'}">${total}% of net pay</span>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button class="btn primary btn-sm" onclick="savePayrollSplit()">Save default</button></div>
    </div>
  </div>`;
}
function splitRowsEdit(i,k,v){ splitDraft = splitRows().map(r=>({...r})); splitDraft[i][k] = Number(v); }
function splitRowsAdd(){ splitDraft = splitRows().map(r=>({...r})); splitDraft.push({percent:1, day:15}); document.getElementById("content").innerHTML = hrPolicies(); }
function splitRowsRemove(i){ splitDraft = splitRows().map(r=>({...r})); splitDraft.splice(i,1); document.getElementById("content").innerHTML = hrPolicies(); }
async function savePayrollSplit(){
  try{
    await apiJson("/api/hr/policy", { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ payrollDefaultSplit: splitRows().map(r=>({percent:Number(r.percent), day:Number(r.day)})) })});
    splitDraft = null; await loadPolicy();
    toast("Default payout split saved — applies to months added from now on"); render();
  }catch(err){ toast(err.message || "Couldn't save the split"); }
}
function openPayslip(id, readOnly){
  const e = byId(id); const month = payroll.selectedMonth; const c = computePayrollRow(e, month);
  if(!c){ toast("Add "+e.name+" to this month's payroll first"); return; }
  const canEditPayrollPayments = isHRRole(currentUser)||isFinanceAdminUser(currentUser);
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
      ${c.pf ? `<div class="calc-line"><span>Provident fund</span><span class="mono">−${inr(c.pf)}</span></div>` : ""}
      ${c.pt ? `<div class="calc-line"><span>Professional tax</span><span class="mono">−${inr(c.pt)}</span></div>` : ""}
      ${c.advDeduction>0?`<div class="calc-line"><span>Advance recovery</span><span class="mono">−${inr(c.advDeduction)}</span></div>`:""}
      ${c.lopDeduction>0?`<div class="calc-line"><span>Loss of Pay (${c.lopDays} day${c.lopDays===1?"":"s"} · ${MONTH_LABEL[month]} has ${c.monthWorkingDays} working days)</span><span class="mono" style="color:var(--neg);">−${inr(c.lopDeduction)}</span></div>`:""}
      <div class="calc-line total"><span>Net pay</span><span class="mono">${inr(c.net)}</span></div>
      <div class="section-label">Payments</div>
      ${c.payments.length ? c.payments.map(p=>`<div class="calc-line"><span>${fmtDateShort(p.date)}${p.note?" · "+esc(p.note):""}</span><span style="display:flex;align-items:center;gap:6px;"><span class="mono">${inr(p.amount)}</span>${canEditPayrollPayments&&!readOnly&&p.id?`<button class="btn btn-sm ghost" title="Edit payment" onclick="openEditPayrollPayment('${e.id}','${p.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg></button><button class="btn btn-sm ghost" title="Delete payment" onclick="deletePayrollPayment('${e.id}','${p.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button>`:""}</span></div>`).join("") : `<div class="empty" style="padding:12px 0;">No payments recorded yet.</div>`}
      <div class="calc-line total"><span>Balance due</span><span class="mono" style="${c.balance>0?'color:var(--warn);':''}">${inr(c.balance)}</span></div>
      <div class="section-label">Payout schedule</div>
      ${scheduleTableHTML(c)}
    </div>
    <div class="modal-foot">${(isHRRole(currentUser)||isFinanceAdminUser(currentUser))?`<button class="btn ghost" onclick="openEditSchedule('${e.id}')">Edit schedule</button>`:''}${(!readOnly && c.balance>0)?`<button class="btn primary" onclick="openRecordPayment('${e.id}')"><svg class="icon" style="width:13px;height:13px"><use href="#i-wallet"/></svg>Record payment</button>`:'<div></div>'}<button class="btn ghost" onclick="closeModal()">Close</button></div>`);
}
async function setPayrollMonth(m){
  payroll.selectedMonth=m;
  const jobs = [];
  if(!payroll.history[m] && (isHRRole(currentUser) || isFinanceAdminUser(currentUser))) jobs.push(loadPayrollMonth(m));
  if(!attendanceMonthSummary[m] && (isHRRole(currentUser) || (currentUser && currentUser.isAdmin))) jobs.push(loadAttendanceMonthSummary(m));
  if(!financeReportsCache.pl[m] && isFinanceAdminUser(currentUser)) jobs.push(loadFinanceReports(m));
  await Promise.all(jobs);
  render();
}
async function decideLeave(id,decision,overwriteAttendance){
  try{
    await apiJson(`/api/hr/leave-requests/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ status: TITLECASE_TO_API(decision), ...(overwriteAttendance?{overwriteAttendance:true}:{}) }) });
    await Promise.all([loadLeaveRequests(), loadLeaveBalances()]);
    toast(`Leave request ${decision.toLowerCase()}`); closeModal(); render();
  }catch(err){
    // The employee is marked Present / Late / Half day on a day this leave covers: HR decides whether the leave replaces that.
    if(err.data && err.data.code==="ATTENDANCE_CONFLICT"){
      showModal(`
        <div class="modal-head"><h3>Replace attendance?</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
        <div class="modal-body"><div class="banner"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${esc(err.data.error)}.</div></div>
        <div class="subtext">Approving turns ${err.data.conflicts.length===1?'that day':'those days'} into leave, so ${err.data.conflicts.length===1?'it counts':'they count'} against the allowance. If the employee actually worked, reject the request instead.</div></div>
        <div class="modal-foot"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="button" class="btn danger" onclick="decideLeave('${id}','${decision}',true)">Approve and replace attendance</button></div>`);
      return;
    }
    toast(err.message || "Couldn't update leave request");
  }
}
// An employee (or HR) withdraws a request that hasn't been decided yet.
async function cancelLeave(id){
  try{
    await apiJson(`/api/hr/leave-requests/${id}/cancel`, { method:"POST" });
    await Promise.all([loadLeaveRequests().catch(()=>{}), loadLeaveBalances().catch(()=>{})]);
    toast("Leave request cancelled"); render();
  }catch(err){ toast(err.message || "Couldn't cancel the request"); }
}
// Approving opens a small confirm step so HR sees (and can change) the month the employee asked for.
function openApproveAdvance(id){
  const a = advances.find(x=>x.id===id); if(!a) return;
  showModal(`
    <div class="modal-head"><h3>Approve advance — ${esc(byId(a.empId).name)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-approve-advance"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${inr(a.amount)} — ${esc(a.reason)}. ${a.deductFromMonth?`Requested to be deducted from <b>${monthLabel(a.deductFromMonth)}</b> salary.`:'No deduction month was chosen.'} Change it below if that month's payroll is tight.</div></div>
      <div><label class="field-label">Deduct from salary of</label><select class="field-input" name="deductMonth">${advanceMonthOptions(a.deductFromMonth||null,"hr")}</select></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Approve</button></div></div>
    </form>`);
  document.getElementById("f-approve-advance").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    await decideAdvance(id, "Recovering", f.get("deductMonth"));
  });
}
async function decideAdvance(id,decision,deductFromMonth){
  try{
    await apiJson(`/api/hr/advances/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ status: TITLECASE_TO_API(decision), deductFromMonth: deductFromMonth||undefined }) });
    closeModal();
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
      ${existing && payroll.history[month].entries[id] && computePayrollRow(e,month) && computePayrollRow(e,month).paid>0 ? `<div class="banner muted"><div>This only changes the <b>salary</b>. Already paid: <b>${inr(computePayrollRow(e,month).paid)}</b>. To correct a payment amount, close this and open <b>Payslip</b> — each payment has an edit/delete button.</div></div>` : ""}
      <div class="section-label">Before you set this month's pay</div>
      <div class="calc-line"><span>Attendance — ${esc(MONTH_LABEL[closedMonth]||closedMonth)}</span><span class="mono">${lastMonthAttendance ? `${lastMonthAttendance.present}/${lastMonthAttendance.workingDays} present${lastMonthAttendance.absentDays?`, ${lastMonthAttendance.absentDays} absent`:""}` : "no record"}</span></div>
      <div class="calc-line"><span>Advance salary paid to date</span><span class="mono">${advPaidTotal>0?inr(advPaidTotal):"—"}${advOutstanding>0?` <span class="faint" style="font-size:11.5px;">(${inr(advOutstanding)} still owed)</span>`:""}</span></div>
      <div class="calc-line"><span>Balance payable — ${esc(MONTH_LABEL[eu.month]||eu.month)}</span><span class="mono ${eu.balance>0?'warn':''}">${eu.balance>0?inr(eu.balance):"settled"}</span></div>
      ${lopDays>0 ? `<div class="calc-line"><span>Leave beyond ${hrPolicy.paidLeavesPerMonth}/month allowance</span><span class="mono" style="color:var(--neg);">${lopDays} day${lopDays===1?"":"s"} · est. −${inr(lopDeduction)} LOP</span></div>` : `<div class="calc-line"><span>Leave beyond ${hrPolicy.paidLeavesPerMonth}/month allowance</span><span class="mono faint">none</span></div>`}
      ${wfhExcessDays>0 ? `<div class="calc-line"><span>WFH beyond ${hrPolicy.paidWfhPerMonth}/month allowance + Partially Paid WFH</span><span class="mono" style="color:var(--neg);">${wfhExcessDays} day${wfhExcessDays===1?"":"s"} · est. −${inr(wfhDeduction)} (paid at 75%)</span></div>` : `<div class="calc-line"><span>WFH beyond ${hrPolicy.paidWfhPerMonth}/month allowance</span><span class="mono faint">none</span></div>`}
      <div class="field-row" style="margin-top:10px;">
        <div><label class="field-label">Master monthly gross</label><div class="mono">${inr(e.salary)}</div></div>
        <div><label class="field-label">Gross for ${MONTH_LABEL[month]} (₹)</label><input class="field-input" type="number" name="gross" min="0" step="any" required value="${startGross}"></div>
      </div>
      <div class="subtext">Adjust this if the month's pay differs from the master salary — unpaid leave deductions, a mid-month joiner, or a pending salary revision. Loss of Pay for excess leave and the 75%-pay cut for excess WFH are both applied automatically once added. Once added, this employee's figures appear in the payroll list below and can be paid in full or in parts.</div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">${existing?"Save":"Add to payroll"}</button></div></div>
    </form>`);
  document.getElementById("f-add-payroll-entry").addEventListener("submit", async ev=>{
    ev.preventDefault();
    const f = new FormData(ev.target);
    const gross = Number(f.get("gross"));
    const paidSoFar = existing ? (computePayrollRow(e,month)||{paid:0}).paid : 0;
    if(paidSoFar>gross && !confirm(`${e.name} has already been paid ${inr(paidSoFar)}, which is more than the ${inr(gross)} you entered.\n\nThis field is the month's SALARY, not the amount paid. Saving will mark them as overpaid.\n\nSave anyway?`)) return;
    try{
      await apiJson("/api/hr/payroll/entries", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ employeeId: employeeDbIdByCode[id], month, gross }) });
      await loadPayrollMonth(month);
      toast(existing ? "Payroll entry updated" : e.name+" added to "+monthLabel(month)+" payroll");
      closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't save payroll entry"); }
  });
}
function openEditPayrollPayment(id, paymentId){
  const e = byId(id); const month = payroll.selectedMonth; const c = computePayrollRow(e, month);
  const p = c && c.payments.find(x=>x.id===paymentId); if(!p) return;
  showModal(`
    <div class="modal-head"><h3>Edit payment</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-edit-payroll-payment"><div class="modal-body">
      <div class="person" style="margin-bottom:4px;">${personCell(e)}</div>
      <div class="field-row">
        <div><label class="field-label">Amount (₹)</label><input class="field-input" type="number" name="amount" min="1" step="1" required value="${p.amount}"></div>
        <div><label class="field-label">Date</label><input class="field-input" type="date" name="date" value="${p.date}" required></div>
      </div>
      <div><label class="field-label">Note</label><input class="field-input" name="note" value="${esc(p.note||"")}"></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="openPayslip('${e.id}')">Cancel</button><button type="submit" class="btn primary">Save</button></div></div>
    </form>`);
  document.getElementById("f-edit-payroll-payment").addEventListener("submit", async ev=>{
    ev.preventDefault();
    const f = new FormData(ev.target);
    try{
      await apiJson(`/api/hr/payroll/payments/${paymentId}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ amount:Number(f.get("amount")), paidDate:f.get("date"), note:f.get("note").trim() }) });
      await loadPayrollMonth(month);
      toast("Payment updated"); render(); openPayslip(id);
    }catch(err){ toast(err.message || "Couldn't update payment"); }
  });
}
function openDeletePayroll(id){
  const e = byId(id); const month = payroll.selectedMonth; const c = computePayrollRow(e, month);
  if(!c) return;
  showModal(`
    <div class="modal-head"><h3>Delete — ${MONTH_LABEL[month]}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div class="person" style="margin-bottom:4px;">${personCell(e)}</div>
      <div class="calc-line"><span>Net pay</span><span class="mono">${inr(c.net)}</span></div>
      <div class="calc-line"><span>Paid</span><span class="mono">${inr(c.paid)}</span></div>
      <div class="section-label">Payments — delete one</div>
      ${c.payments.length ? c.payments.map(p=>`<div class="calc-line"><span>${fmtDateShort(p.date)}${p.note?" · "+esc(p.note):""} · <span class="mono">${inr(p.amount)}</span></span><button class="btn btn-sm ghost" style="color:var(--neg);" onclick="deletePayrollPayment('${e.id}','${p.id}',true)">Delete</button></div>`).join("") : `<div class="empty" style="padding:12px 0;">No payments recorded.</div>`}
      <div class="section-label">Remove from payroll</div>
      <div class="faint" style="font-size:12.5px;margin-bottom:8px;">Removes ${esc(e.name)} from ${MONTH_LABEL[month]}'s payroll along with all their payments and payout schedule. They go back to "Not yet added".</div>
      <button class="btn" style="color:var(--neg);" onclick="deletePayrollEntry('${e.id}')">Remove from ${MONTH_LABEL[month]} payroll</button>
    </div>
    <div class="modal-foot"><div></div><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
}
async function deletePayrollEntry(id){
  const e = byId(id); const month = payroll.selectedMonth;
  if(!confirm(`Remove ${e.name} from ${MONTH_LABEL[month]} payroll?\n\nAll their payments for this month are deleted too. This can't be undone.`)) return;
  try{
    await apiJson(`/api/hr/payroll/${employeeDbIdByCode[id]}/${month}`, { method:"DELETE" });
    await Promise.all([loadPayrollMonth(month), loadAdvances()]);
    toast(e.name+" removed from "+monthLabel(month)+" payroll"); closeModal(); render();
  }catch(err){ toast(err.message || "Couldn't remove payroll entry"); }
}
async function deletePayrollPayment(id, paymentId, fromDeleteModal){
  const month = payroll.selectedMonth;
  if(!confirm("Delete this payment? The balance due will go back up by that amount.")) return;
  try{
    await apiJson(`/api/hr/payroll/payments/${paymentId}`, { method:"DELETE" });
    await loadPayrollMonth(month);
    toast("Payment deleted"); render(); if(fromDeleteModal) openDeletePayroll(id); else openPayslip(id);
  }catch(err){ toast(err.message || "Couldn't delete payment"); }
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
      ${c.schedule&&c.schedule.nextDue?`<div class="banner muted"><div>Next instalment: <b>${inr(c.schedule.nextDue.amount)}</b> due ${fmtDateShort(c.schedule.nextDue.dueDate)}${c.schedule.nextDue.status==='Overdue'?' (overdue)':''} — paying it marks that instalment Paid with the date below.</div></div>`:''}
      <div class="field-row">
        <div><label class="field-label">Amount paying now (₹)</label><input class="field-input" type="number" name="amount" min="1" max="${c.balance}" step="1" required value="${(c.schedule&&c.schedule.nextDue&&c.schedule.nextDue.amount>0)?Math.min(c.balance,c.schedule.nextDue.amount):c.balance}"></div>
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
// Month-on-month helpers shared by the Marketing and Sales overviews.
function lastMonths(month, n){ const out=[month]; while(out.length<n) out.unshift(prevMonth(out[0])); return out; }
function vsHTML(now, prev, opts){
  opts = opts || {};
  const mon = opts.mon || monthLabel(prevMonth(TODAY.slice(0,7))).split(' ')[0];
  const fmt = opts.fmt || (x=>x);
  if(now==null || prev==null) return `<span class="faint">${mon}: ${prev==null?'—':fmt(prev)}</span>`;
  const d = now - prev;
  if(Math.abs(d) < (opts.eps||1e-9)) return `<span class="faint">same as ${mon}</span>`;
  const good = opts.neutral ? null : (opts.lowerIsBetter ? d<0 : d>0);
  const color = good==null ? 'var(--ink-soft)' : good ? 'var(--pos)' : 'var(--neg)';
  return `<span style="color:${color};font-weight:700;">${d>0?'▲':'▼'} ${fmt(Math.abs(d))}</span> <span class="faint">vs ${mon} (${fmt(prev)})</span>`;
}
// Tiny bar trend for a KPI card — the last bar (this month) in the accent, earlier months faint.
function sparkBarsHTML(vals, months){
  const max = Math.max(1, ...vals.map(v=>v||0));
  return `<div style="display:flex;align-items:flex-end;gap:4px;height:34px;margin-top:8px;">${vals.map((v,i)=>`<div title="${monthLabel(months[i])}: ${v==null?'—':v}" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;"><div style="width:100%;height:${v?Math.max(3,v/max*26):2}px;border-radius:3px;background:${i===vals.length-1?'var(--brand)':'var(--ink-faint)'};opacity:${i===vals.length-1?1:.35};"></div><span style="font-size:9px;color:var(--ink-faint);">${monthLabel(months[i]).slice(0,3)}</span></div>`).join('')}</div>`;
}
// Two bars per row — this month (solid) over last month (faint) — with both values.
function compareBarsHTML(rows, fmt){
  fmt = fmt || (x=>x);
  const max = Math.max(1, ...rows.flatMap(r=>[r.now||0, r.prev||0]));
  return `<div style="display:flex;flex-direction:column;gap:10px;">${rows.map(r=>`
    <div style="display:grid;grid-template-columns:150px 1fr 92px;gap:10px;align-items:center;">
      <div class="bar-label" title="${esc(r.label)}" style="font-size:12.5px;">${esc(r.label)}</div>
      <div style="display:flex;flex-direction:column;gap:3px;">
        <div class="bar-track" style="height:8px;"><div class="bar-fill" style="width:${(r.now||0)/max*100}%;"></div></div>
        <div class="bar-track" style="height:4px;background:transparent;"><div class="bar-fill" style="width:${(r.prev||0)/max*100}%;background:var(--ink-faint);opacity:.45;"></div></div>
      </div>
      <div style="text-align:right;font-size:12px;"><b class="mono">${r.now==null?'—':fmt(r.now)}</b> <span class="faint mono">/ ${r.prev==null?'—':fmt(r.prev)}</span></div>
    </div>`).join('')}</div>`;
}
function compareLegendHTML(month, prev){
  return `<div style="display:flex;gap:14px;font-size:11px;color:var(--ink-soft);"><span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:14px;height:6px;border-radius:3px;background:var(--brand);display:inline-block;"></span>${monthLabel(month).split(' ')[0]}</span><span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:14px;height:4px;border-radius:2px;background:var(--ink-faint);opacity:.45;display:inline-block;"></span>${monthLabel(prev).split(' ')[0]}</span></div>`;
}
// One KPI card with this month vs last month and a 4-month bar trend.
function monthCardHTML(label, series, months, fmt, opts, extra){
  const now = series[series.length-1], before = series[series.length-2];
  return `<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-value mono" style="font-size:21px;">${now==null?'—':fmt(now)}</div>
    <div class="kpi-sub">${vsHTML(now, before, Object.assign({fmt}, opts||{}))}</div>${extra||''}${sparkBarsHTML(series, months)}</div>`;
}
// Our own ads' spend / leads for a month, from the daily tracker; null when nothing was logged.
function ownAdsForMonth(month){
  const rows = ownAdMetrics.filter(m=>m.date.slice(0,7)===month);
  return rows.length ? { days:rows.length, spend:rows.reduce((s,m)=>s+m.spend,0), leads:rows.reduce((s,m)=>s+m.leads,0) } : null;
}

/* ===================== SOCIAL MEDIA NUMBERS + MARKETING SCORE =====================
   Once a month the marketing owner (or leadership) copies each platform's followers, reach and engagements from its
   insights. The Marketing Score is out of 100:  Content delivered 50 · Follower growth 30 (target 3% a month) ·
   Engagement rate 20 (target 5% of reach). A part with nothing to measure is left out and the rest re-weighted. */
const MKT_FOLLOWER_GROWTH_TARGET = 0.03, MKT_ENGAGEMENT_TARGET = 0.05;
const SOCIAL_METRICS = [
  {k:"followers", label:"Followers", req:true}, {k:"reach", label:"Reach"}, {k:"impressions", label:"Impressions"},
  {k:"engagements", label:"Engagements"}, {k:"profileVisits", label:"Profile visits"}, {k:"linkClicks", label:"Link clicks"},
];
let socialData = null;                                   // {owner, canUpdate, platforms, stats, notes} from /api/scores/social
let socialStatus = {isOwner:false, pending:false};       // light read for the owner's My Workspace nudge
async function loadSocial(){ socialData = await apiJson("/api/scores/social"); }
async function loadSocialStatus(){ socialStatus = await apiJson("/api/scores/social/status"); }
const socialPlatforms = ()=> socialData ? socialData.platforms : ["Instagram","LinkedIn"];
const socialFor = (month, platform)=> (socialData && socialData.stats.find(x=>x.month===month && x.platform===platform)) || null;
function socialTotal(month, key){ const rows = socialData ? socialData.stats.filter(x=>x.month===month) : []; return rows.length ? rows.reduce((t,x)=>t+(x[key]||0),0) : null; }
const socialPendingNow = ()=> !!socialData && !socialData.stats.some(x=>x.month===TODAY.slice(0,7));
function monthEndOf(month){ const [y,m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0,10); }
function weightedScoreOf(parts){ const live = parts.filter(p=>p.v!=null), w = live.reduce((t,p)=>t+p.w,0); return w ? Math.round(live.reduce((t,p)=>t+p.v*p.w,0)/w*100) : null; }
function marketingScore(month){
  const asOf = [TODAY, monthEndOf(month)].sort()[0];
  const due = contentItems.filter(c=>(c.due||'').slice(0,7)===month && c.due<=asOf), done = due.filter(c=>c.stage==="Published");
  const f = socialTotal(month,'followers'), fp = socialTotal(prevMonth(month),'followers');
  const reach = socialTotal(month,'reach'), eng = socialTotal(month,'engagements');
  const growth = (f!=null && fp) ? (f-fp)/fp : null, er = reach ? eng/reach : null;
  const parts = [
    {key:"content", label:"Content delivered", w:50, v: due.length ? done.length/due.length : null, detail: due.length ? `${done.length} of ${due.length} due so far published` : "nothing due yet"},
    {key:"followers", label:"Follower growth", w:30, v: growth==null ? null : Math.max(0, Math.min(1, growth/MKT_FOLLOWER_GROWTH_TARGET)), detail: growth==null ? "no numbers to compare" : `${growth>=0?'+':''}${(growth*100).toFixed(1)}% · target ${MKT_FOLLOWER_GROWTH_TARGET*100}%`},
    {key:"engagement", label:"Engagement rate", w:20, v: er==null ? null : Math.min(1, er/MKT_ENGAGEMENT_TARGET), detail: er==null ? "no numbers yet" : `${(er*100).toFixed(1)}% of reach · target ${MKT_ENGAGEMENT_TARGET*100}%`},
  ];
  return {score: weightedScoreOf(parts), parts};
}
function socialPanelHTML(){
  if(!socialData) return '';
  const month = TODAY.slice(0,7), prev = prevMonth(month), M = monthLabel(month).split(' ')[0];
  const owner = socialData.owner ? socialData.owner.name : "Nobody yet";
  const pending = socialPendingNow(), note = socialData.notes[month];
  const last = socialData.stats.filter(x=>x.month===month).map(x=>x.updatedOn).sort().pop();
  const er = x => x && x.reach ? x.engagements/x.reach*100 : null;
  const num = x => x.toLocaleString('en-IN');
  return `<div class="panel">
    <div class="panel-head"><div><h3>Social media · ${M}</h3><div class="sub">Updated by ${esc(owner)} each month from platform insights${last?` · last update ${fmtDateShort(last)}`:''}</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">${isLeadershipRole(currentUser)?`<button class="btn btn-sm ghost" onclick="openMarketingOwner()">Change owner</button>`:''}${socialData.canUpdate?`<button class="btn btn-sm ${pending?'primary':'ghost'}" onclick="openSocialUpdate()">${pending?'Update '+M+' numbers':'Edit '+M+' numbers'}</button>`:''}</div></div>
    ${pending?`<div class="banner" style="margin:12px 16px 0;background:var(--warn-soft);color:var(--ink);"><div><b>${M}'s numbers aren't in yet.</b> ${esc(owner)} updates followers, reach and engagements for each platform.</div></div>`:''}
    <div class="table-wrap"><table class="data"><thead><tr><th>Platform</th><th class="num">Followers</th><th class="num">Growth</th><th class="num">Reach</th><th class="num">Engagements</th><th class="num">Engagement rate</th></tr></thead>
      <tbody>${socialPlatforms().map(pl=>{ const a = socialFor(month, pl), b = socialFor(prev, pl); const g = a&&b&&b.followers ? (a.followers-b.followers)/b.followers*100 : null; return `<tr>
        <td style="font-weight:700;">${esc(pl)}</td>
        <td class="num"><div class="mono" style="font-weight:700;">${a?num(a.followers):'—'}</div><div style="font-size:10.5px;">${vsHTML(a?a.followers:null, b?b.followers:null, {fmt:num})}</div></td>
        <td class="num mono" style="font-weight:700;color:${g!=null&&g>=0?'var(--pos)':'var(--neg)'};">${g==null?'—':(g>=0?'+':'')+g.toFixed(1)+'%'}</td>
        <td class="num"><div class="mono">${a?num(a.reach):'—'}</div><div style="font-size:10.5px;">${vsHTML(a?a.reach:null, b?b.reach:null, {fmt:num})}</div></td>
        <td class="num"><div class="mono">${a?num(a.engagements):'—'}</div><div style="font-size:10.5px;">${vsHTML(a?a.engagements:null, b?b.engagements:null, {fmt:num})}</div></td>
        <td class="num"><div class="mono">${er(a)==null?'—':er(a).toFixed(1)+'%'}</div><div style="font-size:10.5px;">${vsHTML(er(a), er(b), {fmt:x=>x.toFixed(1)+'%', eps:0.05})}</div></td>
      </tr>`; }).join('')}</tbody>
    </table></div>
    ${note?`<div class="panel-body" style="padding-top:8px;"><div class="subtext"><b>What the insights say</b> · ${esc(note.by)}, ${fmtDateShort(note.on)}</div><div style="margin-top:4px;font-size:13px;">${esc(note.text)}</div></div>`:''}
  </div>`;
}
function openSocialUpdate(){
  if(!socialData || !socialData.canUpdate) return;
  const month = TODAY.slice(0,7), prev = prevMonth(month), pm = monthLabel(prev).slice(0,3), note = socialData.notes[month];
  showModal(`
    <div class="modal-head"><h3>Followers &amp; insights — ${monthLabel(month)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-social"><div class="modal-body">
      <div class="subtext" style="font-size:12px;margin-top:0;">Copy these from each platform's insights for the month. Only followers is required. ${pm} numbers are shown under each box.</div>
      ${socialPlatforms().map(pl=>{ const a = socialFor(month, pl), b = socialFor(prev, pl); return `
        <fieldset style="border:1px solid var(--line);border-radius:10px;padding:10px 12px 12px;margin:0;">
          <legend style="font-weight:700;font-size:13px;padding:0 6px;">${esc(pl)}</legend>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;">
            ${SOCIAL_METRICS.map(m=>`<div><label class="field-label" for="soc-${pl}-${m.k}">${m.label}${m.req?' *':''}</label><input class="field-input" type="number" min="0" step="1" id="soc-${pl}-${m.k}" name="${pl}-${m.k}" value="${a&&a[m.k]!=null?a[m.k]:''}" ${m.req?'required':''}><div class="subtext">${pm}: ${b&&b[m.k]!=null?b[m.k].toLocaleString('en-IN'):'—'}</div></div>`).join('')}
          </div>
        </fieldset>`; }).join('')}
      <div><label class="field-label" for="soc-note">What the insights say (optional)</label><textarea class="field-input" id="soc-note" name="note" rows="3" placeholder="What worked, what didn't, what we change next month">${note?esc(note.text):''}</textarea></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save</button></div></div>
    </form>`);
  document.getElementById("f-social").addEventListener("submit", async e=>{
    e.preventDefault(); const f = new FormData(e.target);
    const val = (pl,k)=>{ const v = f.get(pl+'-'+k); return v===''||v==null ? null : Number(v); };
    // followers, reach and engagements feed the score, so blanks there count as 0
    const stats = socialPlatforms().map(pl=>({ platform:pl, followers:val(pl,'followers')||0, reach:val(pl,'reach')||0, engagements:val(pl,'engagements')||0, impressions:val(pl,'impressions'), profileVisits:val(pl,'profileVisits'), linkClicks:val(pl,'linkClicks') }));
    try{
      await apiJson(`/api/scores/social/${month}`, { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ stats, note:(f.get('note')||'').trim() }) });
      await Promise.all([loadSocial(), loadSocialStatus().catch(()=>{})]);
      toast("Followers & insights saved for "+monthLabel(month)); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't save the numbers"); }
  });
}
function openMarketingOwner(){
  if(!isLeadershipRole(currentUser) || !socialData) return;
  showModal(`
    <div class="modal-head"><h3>Who updates social media numbers?</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-mkt-owner"><div class="modal-body">
      <div><label class="field-label">Marketing owner</label><select class="field-input" name="owner">${employees.filter(e=>e.employmentStatus!=="Left").map(e=>`<option value="${e.id}" ${socialData.owner&&socialData.owner.code===e.id?'selected':''}>${esc(e.name)}</option>`).join('')}</select></div>
      <div class="subtext">They get a reminder in My Workspace until each month's numbers are in.</div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save</button></div></div>
    </form>`);
  document.getElementById("f-mkt-owner").addEventListener("submit", async e=>{
    e.preventDefault();
    try{
      const r = await apiJson("/api/scores/social-owner", { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ employeeId: employeeDbIdByCode[new FormData(e.target).get("owner")] }) });
      await loadSocial(); toast(r.owner.name+" now updates social numbers"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't change the owner"); }
  });
}
// The owner's My Workspace nudge.
function socialReminderHTML(){
  if(!currentUser || !socialStatus.isOwner || !socialStatus.pending) return '';
  return `<div class="banner" style="background:var(--warn-soft);color:var(--ink);align-items:center;"><svg class="icon" style="width:15px;height:15px"><use href="#i-megaphone"/></svg><div style="flex:1;"><b>Update ${monthLabel(TODAY.slice(0,7))}'s social media numbers</b> — followers, reach and engagements for each platform.</div>${visibleModules().some(m=>m.id==='marketing')?`<button class="btn btn-sm primary" onclick="setSub('marketing','overview')">Open</button>`:''}</div>`;
}

// Marketing → Overview: our own Meta Ads score and month-on-month content and ad numbers, with the content pipeline.
function mktOverview(){
  const month = TODAY.slice(0,7), prev = prevMonth(month), P = monthLabel(prev).split(' ')[0], M = monthLabel(month).split(' ')[0];
  const months = lastMonths(month, 4);
  const published = months.map(m=>contentItems.filter(c=>c.stage==="Published" && (c.due||'').slice(0,7)===m).length);
  const adSpend = months.map(m=>{ const a = ownAdsForMonth(m); return a ? a.spend : null; });
  const adLeads = months.map(m=>{ const a = ownAdsForMonth(m); return a ? a.leads : null; });
  const adNow = ownAdsForMonth(month);
  const activeContent = contentItems.filter(c=>c.stage!=="Published").length;
  const overdueContent = contentItems.filter(c=>c.stage!=="Published" && c.due && c.due<TODAY).length;
  const maxStage = Math.max(...STAGES.map(x=>contentItems.filter(c=>c.stage===x).length),1);
  return `
  <div class="banner">
    <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
    <div><b>Internal marketing.</b> This tracks DesGro Media's own brand content and ad campaigns — not client work, which lives under Clients. Leads and quotes are under Sales.</div>
  </div>
  ${monthScorePanelHTML(`Marketing Score · ${monthLabel(month)}`, `Content, followers and engagement · vs ${P}`, marketingScore(month), marketingScore(prev), P)}
  ${metaAdsScorePanelHTML()}

  <div class="panel">
    <div class="panel-head"><div><h3>${M} vs ${P}</h3><div class="sub">${M} is month to date · bars show the last 4 months</div></div></div>
    <div class="modal-body">
      <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));">
        ${monthCardHTML("Content published", published, months, x=>x)}
        ${socialData ? monthCardHTML("Total followers", months.map(m=>socialTotal(m,'followers')), months, x=>x.toLocaleString('en-IN'), {}, socialPendingNow()?`<div class="kpi-sub" style="color:var(--warn);">${M} not updated yet</div>`:'') : ''}
        ${monthCardHTML("Meta ads spend", adSpend, months, inr, {neutral:true}, adNow?`<div class="kpi-sub faint">${adNow.days} day${adNow.days===1?'':'s'} logged · ${adNow.leads} leads</div>`:'')}
        ${monthCardHTML("Leads from ads", adLeads, months, x=>x)}
        <div class="kpi-card"><div class="kpi-label">Content in flight</div><div class="kpi-value mono" style="font-size:21px;">${activeContent}</div><div class="kpi-sub ${overdueContent?'neg':''}">${overdueContent?overdueContent+' overdue':'none overdue'}</div></div>
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><div><h3>Content by stage</h3><div class="sub">${contentItems.length} items in the pipeline</div></div><button class="btn btn-sm ghost" onclick="setSub('marketing','content')">Open</button></div>
    <div class="panel-body"><div class="barchart">${STAGES.map(st=>{ const n=contentItems.filter(c=>c.stage===st).length; return `<div class="bar-row"><div class="bar-label">${st}</div><div class="bar-track"><div class="bar-fill" style="width:${n/maxStage*100}%"></div></div><div class="bar-val mono">${n}</div></div>`; }).join('')}</div></div>
  </div>
  ${socialPanelHTML()}`;
}

// Sales → Overview: the sales score, month-on-month pipeline numbers, the team and where leads stand.
let salesOverviewData = null;   // {month, now, prev, targets, people} from /api/scores/sales
async function loadSalesOverview(){ salesOverviewData = await apiJson("/api/scores/sales"); }
function salesScorePanelHTML(){
  const d = salesOverviewData; if(!d) return '';
  const month = d.month, P = monthLabel(prevMonth(month)).split(' ')[0], Ps = P.slice(0,3);
  const sc = d.now, sp = d.prev, partial = month===TODAY.slice(0,7);
  const share = new Date(TODAY+"T00:00:00Z").getUTCDate()/new Date(Date.UTC(+month.slice(0,4), +month.slice(5,7), 0)).getUTCDate();
  const tile = (label, now, was, fmt, opts) => { opts = opts||{}; return `<div style="padding:10px 12px;border-radius:8px;background:var(--surface-sunk);min-width:0;">
    <div style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-faint);">${label}</div>
    <div class="mono" style="font-size:17px;font-weight:800;margin-top:2px;">${now==null?'—':fmt(now)}</div>
    <div style="font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${opts.sub!=null?opts.sub:(partial&&opts.total?`<span class="faint">${Ps} full month ${was==null?'—':fmt(was)}</span>`:`${now!=null&&was!=null?deltaHTML(now, was, {fmt}):''} <span class="faint">${Ps} ${was==null?'—':fmt(was)}</span>`)}</div>
  </div>`; };
  const rate = x => { const m = /· (\d+)% · target/.exec(x.parts.find(p=>p.key==="conversion").detail); return m ? +m[1] : null; };
  const meetsOf = x => { const m = /^(\d+) of/.exec(x.parts.find(p=>p.key==="meetings").detail); return m ? +m[1] : 0; };
  const tiles = [
    tile("Sales booked", sc.booked, sp.booked, shortInr, {total:true}),
    tile("Target", Math.round(sc.booked/d.targets.revenue*100), null, x=>x+'%', {sub:`<span class="faint">of ${shortInr(d.targets.revenue)}${partial?` · ${Math.round(share*100)}% of month gone`:''}</span>`}),
    tile("Meetings", meetsOf(sc), meetsOf(sp), String, {total:true}),
    tile("Lead conversion", rate(sc), rate(sp), x=>x+'%'),
    tile("New leads", sc.stats.leadsNew, sp.stats.leadsNew, String, {total:true}),
    tile("Won", sc.stats.won, sp.stats.won, String, {total:true}),
  ].join('');
  const foot = `<div style="display:flex;flex-direction:column;gap:8px;"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;">${tiles}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;color:var(--ink-soft);"><span>Targets: ${shortInr(d.targets.revenue)} a month · ${d.targets.conversion}% lead conversion · ${d.targets.meetings} meetings</span><span style="display:flex;gap:6px;">${isSalesRole(currentUser)?`<button class="btn btn-sm ghost" onclick="setSub('sales','leads')">Log meeting</button>`:''}${isLeadershipRole(currentUser)?`<button class="btn btn-sm ghost" onclick="openScoreTargets()">Edit targets</button>`:''}</span></div></div>`;
  return monthScorePanelHTML(`Sales Score · ${monthLabel(month)}`, `Target completion, lead conversion and meetings · vs ${P}`, sc, sp, P, foot);
}
function salesOverview(){
  const month = TODAY.slice(0,7), prev = prevMonth(month), P = monthLabel(prev).split(' ')[0], M = monthLabel(month).split(' ')[0];
  const months = lastMonths(month, 4);
  const showMoney = !!currentUser && (isLeadershipRole(currentUser) || isSalesRole(currentUser));
  const inM = (d,m) => (d||'').slice(0,7)===m;
  const series = {
    leads: months.map(m=>marketingLeads.filter(l=>inM(l.createdDate,m)).length),
    quotes: months.map(m=>quotes.filter(q=>inM(q.createdDate,m)).length),
    invoices: months.map(m=>invoices.filter(i=>inM(i.issued,m)).length),
    invoiced: months.map(m=>invoices.filter(i=>inM(i.issued,m)).reduce((s,i)=>s+invoiceTotal(i),0)),
    revenue: months.map(m=>invoices.reduce((s,i)=>s+(i.payments||[]).filter(p=>inM(p.date,m)).reduce((a,p)=>a+p.amount,0),0)),
  };
  const people = salesOverviewData ? salesOverviewData.people.slice().sort((a,b)=>(b.now.revenue-a.now.revenue)||(b.now.billed-a.now.billed)||(b.now.converted-a.now.converted)) : [];
  const best = people[0] && (people[0].now.revenue || people[0].now.billed || people[0].now.converted) ? people[0] : null;
  const cell = (a, b, fmt) => `<td class="num"><div class="mono" style="font-weight:700;">${fmt?fmt(a):a}</div><div style="font-size:10.5px;">${vsHTML(a, b, {fmt:fmt||(x=>x)})}</div></td>`;
  const sourceRows = LEAD_SOURCES.map(s=>({label:s, now:marketingLeads.filter(l=>l.source===s && inM(l.createdDate,month)).length, prev:marketingLeads.filter(l=>l.source===s && inM(l.createdDate,prev)).length})).filter(r=>r.now||r.prev).sort((a,b)=>b.now-a.now);
  const stageCounts = LEAD_STAGES.map(s=>({label:s, n:marketingLeads.filter(l=>leadStage(l)===s).length}));
  const maxStage = Math.max(1, ...stageCounts.map(x=>x.n));
  return `
  ${salesScorePanelHTML()}

  <div class="panel">
    <div class="panel-head"><div><h3>${M} vs ${P}</h3><div class="sub">${M} is month to date · bars show the last 4 months</div></div></div>
    <div class="modal-body">
      <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));">
        ${monthCardHTML("New leads", series.leads, months, x=>x)}
        ${monthCardHTML("Quotes generated", series.quotes, months, x=>x)}
        ${monthCardHTML("Invoices generated", series.invoices, months, x=>x, {}, showMoney?`<div class="kpi-sub faint">${inr(series.invoiced[3])} invoiced</div>`:'')}
        ${showMoney ? monthCardHTML("Revenue received", series.revenue, months, inr) : ''}
      </div>
    </div>
  </div>

  ${salesOverviewData ? `<div class="panel">
    <div class="panel-head"><div><h3>Sales team · ${M}</h3><div class="sub">Each person against their own ${P} · ranked by revenue received from their clients</div></div>${best?`<div style="display:flex;align-items:center;gap:8px;"><span class="faint" style="font-size:12px;">Best this month</span>${pill('★ '+best.name,'pos')}</div>`:''}</div>
    <div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Salesperson</th><th class="num">Leads</th><th class="num">Meetings</th><th class="num">Quotes</th><th class="num">Invoices</th>${showMoney?'<th class="num">Invoiced</th><th class="num">Revenue received</th>':''}<th class="num">Converted</th></tr></thead>
      <tbody>${people.map((p,i)=>`<tr style="${best&&p===best?'background:var(--pos-soft);':''}">
        <td class="mono" style="font-weight:800;">${i+1}</td>
        <td><span class="assignee"><span class="mini-avatar sm">${initials(p.name)}</span><b>${esc(p.name)}</b></span>${best&&p===best?' '+pill('Best','pos'):''}</td>
        ${cell(p.now.leads, p.prev.leads)}${cell(p.now.meetings, p.prev.meetings)}${cell(p.now.quotes, p.prev.quotes)}${cell(p.now.invoices, p.prev.invoices)}
        ${showMoney?cell(p.now.billed, p.prev.billed, inr)+cell(p.now.revenue, p.prev.revenue, inr):''}
        ${cell(p.now.converted, p.prev.converted)}
      </tr>`).join('') || `<tr><td colspan="9"><div class="empty">No one in the Sales department yet.</div></td></tr>`}</tbody>
    </table></div>
  </div>` : ''}

  <div class="grid-2" style="align-items:start;">
    <div class="panel">
      <div class="panel-head"><div><h3>New leads by source</h3><div class="sub">${M} vs ${P}</div></div><button class="btn btn-sm ghost" onclick="setSub('sales','leads')">Open</button></div>
      <div class="panel-body" style="display:flex;flex-direction:column;gap:12px;">
        ${sourceRows.length ? compareLegendHTML(month, prev)+compareBarsHTML(sourceRows) : '<div class="empty">No leads either month.</div>'}
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><div><h3>Sales pipeline</h3><div class="sub">Where every lead is today</div></div><button class="btn btn-sm ghost" onclick="setSub('sales','leads')">Open</button></div>
      <div class="panel-body"><div style="display:flex;flex-direction:column;gap:6px;">${stageCounts.map(f=>`<div style="display:grid;grid-template-columns:110px 1fr 28px;gap:10px;align-items:center;font-size:12.5px;"><span class="muted">${f.label}</span><div class="bar-track" style="height:8px;"><div class="bar-fill" style="width:${f.n/maxStage*100}%;background:var(--${{neutral:'ink-faint',blue:'brand',warn:'warn',pos:'pos',neg:'neg'}[LEAD_STAGE_KIND[f.label]]||'brand'});"></div></div><b class="mono" style="text-align:right;">${f.n}</b></div>`).join('')}</div></div>
    </div>
  </div>`;
}

// Content pipeline month filter — by each card's due date, like the Leads / Quotes / Invoices filters.
let contentMonthFilter = "All";
function setContentMonthFilter(v){ contentMonthFilter = v; render(); }
const contentInView = ()=>contentItems.filter(i=>matchesDateFilter(i.due, contentMonthFilter));
function mktContent(){
  const scoreMonth = TODAY.slice(0,7), scorePrev = prevMonth(scoreMonth), scoreP = monthLabel(scorePrev).split(' ')[0];
  return `
  <div class="banner"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div><b>Sample data.</b> Drag a card between columns, or use the stage dropdown on each card — both update the same record.</div></div>
  ${monthScorePanelHTML(`Marketing Score · ${monthLabel(scoreMonth)}`, `Content, followers and engagement · vs ${scoreP}`, marketingScore(scoreMonth), marketingScore(scorePrev), scoreP)}
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Active Content</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-board"/></svg></div></div><div class="kpi-value mono" id="kpi-active">0</div><div class="kpi-sub">not yet published</div></div>
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">In Production</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-edit"/></svg></div></div><div class="kpi-value mono" id="kpi-production">0</div><div class="kpi-sub">scripting, production, edit + graphic</div></div>
    <div class="kpi-card hero"><div class="kpi-top"><span class="kpi-label">Published This Month</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-check"/></svg></div></div><div class="kpi-value mono" id="kpi-published">0</div><div class="kpi-sub">across all platforms</div></div>
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Overdue</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-calendar"/></svg></div></div><div class="kpi-value mono" id="kpi-overdue">0</div><div class="kpi-sub">past due, not yet published</div></div>
  </div>
  <div class="toolbar">
    <div class="filter-group"><span class="filter-label">Show</span><select class="select-sm" onchange="setContentMonthFilter(this.value)">${dateFilterOptions(contentItems.map(i=>i.due), contentMonthFilter)}</select></div>
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
  sel.innerHTML = '<option value="All">All assignees</option>' + contentAssignees().map(e=>`<option>${esc(e.name)}</option>`).join('') + '<option value="Unassigned">Unassigned</option>';
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
    <div class="card ${item.stage==='Published'?'published':''}" draggable="true" data-id="${item.id}" ondragstart="onDragStart(event,'${item.id}')">
      <div class="card-title">${esc(item.title)}</div>
      <div class="card-meta"><span class="tag type">${esc(item.type)}</span>${item.platforms.map(p=>`<span class="tag"><svg class="icon"><use href="#${platformIcon(p)}"/></svg>${p}</span>`).join('')}</div>
      <div class="card-foot"><span class="assignee"><span class="mini-avatar sm ${item.assignee?'':'unassigned'}">${inits}</span>${esc(item.assignee||'Unassigned')}</span>${dueLabel}</div>
      <div class="card-move"><select onchange="moveContentCard('${item.id}', this.value)">${stageOptions}</select><button class="card-edit" title="Edit" onclick="openContentModal('${item.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg></button></div>
    </div>`;
}
function renderBoard(){
  const board = document.getElementById('board');
  if(!board) return;
  board.innerHTML = STAGES.map(stage=>{
    const inStage = contentInView().filter(i=>i.stage===stage);
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
  const items = contentInView();
  const active = items.filter(i=>i.stage!=='Published').length;
  const production = items.filter(i=>['Scripting','Production','Edit','Graphic'].includes(i.stage)).length;
  const thisMonth = TODAY.slice(0,7);
  // No filter: published up to this month (as before). With a month/day picked: published cards in that view.
  const published = contentMonthFilter==='All' ? items.filter(i=>i.stage==='Published' && i.due && i.due.slice(0,7)<=thisMonth).length : items.filter(i=>i.stage==='Published').length;
  const overdue = items.filter(isContentOverdue).length;
  document.getElementById('kpi-active').textContent = active;
  document.getElementById('kpi-production').textContent = production;
  document.getElementById('kpi-published').textContent = published;
  const lbl = document.getElementById('kpi-published-label');
  if(lbl) lbl.textContent = contentMonthFilter==='All' ? 'Published This Month' : contentMonthFilter==='Today' ? 'Published Today' : 'Published · '+monthLabel(contentMonthFilter);
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
        <div><label class="field-label">Assignee</label><select class="field-input" id="f-assignee"><option value="">Unassigned</option>${contentAssignees().map(e=>`<option>${esc(e.name)}</option>`).join('')}</select></div>
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
  const live = liveClients();
  const F = clientsFilters;
  const filtered = live.filter(c=>(clientsMonthFilter==='All' || c.onboarded.slice(0,7)===clientsMonthFilter)
    && (F.manager==='All' || c.accountManager===F.manager)
    && (F.sales==='All' || c.salesPerson===F.sales)
    && (F.service==='All' || (c.services||[]).includes(F.service))
    && (F.status==='All' || c.status===F.status));
  const distinct = arr => [...new Set(arr.filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const anyFilter = clientsMonthFilter!=='All' || Object.values(F).some(v=>v!=='All');
  const archived = clients.filter(c=>c.archivedAt).sort((a,b)=>b.archivedAt.localeCompare(a.archivedAt));
  const hidePayment = isStaffRole(currentUser);
  return `
  <div class="toolbar"><div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;"><div class="filter-group"><span class="filter-label">Onboarded</span><select class="select-sm" onchange="setClientsMonthFilter(this.value)">${monthFilterOptions(live.map(c=>c.onboarded), clientsMonthFilter)}</select></div>${clientsFilterSelect('Account Manager','manager',distinct(live.map(c=>c.accountManager)))}${clientsFilterSelect('Sales Person','sales',distinct(live.map(c=>c.salesPerson)))}${clientsFilterSelect('Service','service',distinct(live.flatMap(c=>c.services||[])))}${clientsFilterSelect('Status','status',distinct(live.map(c=>c.status)))}${anyFilter?'<button class="btn ghost" onclick="clearClientsFilters()">Clear filters</button>':''}</div><button class="btn primary" onclick="openAddClient()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Add client</button></div>
  <div class="panel">
    <div class="panel-head"><h3>${isSalesViewer?'My clients':'Clients'}</h3><div class="sub">${filtered.length} of ${live.length}${clientsMonthFilter!=='All'?' onboarded in '+monthLabel(clientsMonthFilter):' on record'}${Object.values(F).some(v=>v!=='All')?' · filtered':''}</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Client</th><th>Services</th><th>Account Manager</th><th>Sales Person</th>${hidePayment?'':'<th class="num">Payment Due</th>'}<th>Status</th><th></th></tr></thead>
      <tbody>${filtered.map(c=>{ const due=clientPaymentDue(c.id); return `<tr class="row-click" onclick="openClientDetail('${c.id}')"><td>${clientCell(c.id)}</td><td class="muted" style="max-width:220px;">${c.services.map(s=>`<span class="tag" style="margin:1px 3px 1px 0;">${esc(s)}</span>`).join('')}</td><td class="muted">${esc(c.accountManager)}</td><td class="muted">${esc(c.salesPerson)}</td>${hidePayment?'':`<td class="num mono" style="${due>0?'color:var(--neg);font-weight:700;':''}">${due>0?inr(due):'—'}</td>`}<td>${pill(c.status,c.status==='Active'?'pos':c.status==='Paused'?'warn':'neg')}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm ghost" onclick="event.stopPropagation();openEditClient('${c.id}')" title="Edit client"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button>${canArchiveClients()?`<button class="btn btn-sm ghost" onclick="event.stopPropagation();archiveClient('${c.id}')" title="Archive client — hides them from the working lists, keeps every invoice, quote and payment"><svg class="icon" style="width:12px;height:12px"><use href="#i-archive"/></svg>Archive</button>`:''}${canDeleteClients()?`<button class="btn btn-sm ghost" onclick="event.stopPropagation();openConfirmDelete('client','${c.id}')" title="Delete client (only for records added by mistake)"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button>`:''}</div></td></tr>`; }).join("") || `<tr><td colspan="${hidePayment?6:7}"><div class="empty">${isSalesViewer&&!anyFilter?'No clients assigned to you yet.':'No clients match these filters.'}</div></td></tr>`}</tbody>
    </table></div>
  </div>
  ${archived.length ? `
  <details class="panel" style="margin-top:14px;" ${clientsArchivedOpen?'open':''} ontoggle="clientsArchivedOpen=this.open">
    <summary class="panel-head" style="cursor:pointer;list-style:none;"><div><h3>Archived clients</h3><div class="sub">${archived.length} out of the working lists · invoices, quotes and payments are kept</div></div><span class="sub">Show / hide</span></summary>
    <div class="table-wrap"><table class="data"><thead><tr><th>Client</th><th>Services</th><th>Account Manager</th><th>Sales Person</th><th>Status</th><th>Archived</th><th></th></tr></thead>
      <tbody>${archived.map(c=>`<tr class="row-click" onclick="openClientDetail('${c.id}')"><td>${clientCell(c.id)}</td><td class="muted" style="max-width:220px;">${c.services.map(s=>`<span class="tag" style="margin:1px 3px 1px 0;">${esc(s)}</span>`).join('')}</td><td class="muted">${esc(c.accountManager)}</td><td class="muted">${esc(c.salesPerson)}</td><td>${pill(c.status,c.status==='Active'?'pos':c.status==='Paused'?'warn':'neg')}</td><td class="muted">${fmtDate(c.archivedAt)}</td><td><div style="display:flex;justify-content:flex-end;">${canArchiveClients()?`<button class="btn btn-sm ghost" onclick="event.stopPropagation();restoreClient('${c.id}')">Restore</button>`:''}</div></td></tr>`).join("")}</tbody>
    </table></div>
  </details>` : ""}`;
}
let clientsArchivedOpen = false;
async function archiveClient(id){
  const c = clientById(id); if(!c) return;
  if(!confirm(`Archive ${c.name}?\n\nThey'll disappear from the working lists and dropdowns, but every invoice, quote and payment stays. You can restore them any time.`)) return;
  try{
    await apiJson(`/api/crm/clients/${id}/archive`, { method:"PATCH" });
    await loadClients(); clientsArchivedOpen = true;
    toast(c.name+" archived"); render();
  }catch(err){ toast(err.message || "Couldn't archive client"); }
}
async function restoreClient(id){
  const c = clientById(id); if(!c) return;
  try{
    await apiJson(`/api/crm/clients/${id}/restore`, { method:"PATCH" });
    await loadClients();
    toast(c.name+" restored"); render();
  }catch(err){ toast(err.message || "Couldn't restore client"); }
}
// Mirrors deleteClient() server-side: only Admin / Sales Head may delete (a Sales rep can still edit).
// ---- Client collaboration data: brand assets, ad account access, campaign brief, meetings ----
// Loaded per client when its page opens (GET /api/crm/clients/:id/collab) and cached here; every save
// reloads it. The server scopes and validates everything — these helpers only draw and submit.
let clientCollab = {};
const AD_ACCESS_STATUSES = ["Granted","Pending","Revoked"];
function isPerformanceMarketingClient(c){ return !!(c && c.services && c.services.includes("Performance Marketing")); }
async function loadClientCollab(id){
  try{
    clientCollab[id] = await apiJson(`/api/crm/clients/${id}/collab`);
    if(isPerformanceMarketingClient(clientById(id))){
      const am = await apiJson(`/api/crm/clients/${id}/ad-metrics`);
      clientCollab[id].adMetrics = am.metrics; clientCollab[id].adCurrency = am.currency || "INR";
    }
  }catch(err){ clientCollab[id] = { error: err.message || "Couldn't load" }; }
  // Redraw only if the user is still looking at this client's page.
  if(nav.detail && nav.detail.type==='client' && nav.detail.id===id) render();
}
const collabHead = (title, count, btn)=>`<div class="section-label" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
    <div>${title}${count!=null?`<span class="faint" style="font-weight:600;font-size:11.5px;text-transform:none;letter-spacing:0;"> · ${count}</span>`:''}</div>${btn||''}</div>`;
const collabBtn = (onclick, icon, label)=>`<button class="btn btn-sm ghost" onclick="${onclick}"><svg class="icon" style="width:12px;height:12px"><use href="#${icon}"/></svg>${label}</button>`;
// Only http(s) links become clickable (the server enforces the same rule on save).
const safeHref = u => /^https?:\/\//i.test(u||'') ? esc(u) : null;
function clientCollabHTML(c){
  const d = clientCollab[c.id];
  if(!d) return collabHead('Client details') + `<div class="empty">Loading…</div>`;
  if(d.error) return collabHead('Client details') + `<div class="empty">${esc(d.error)}</div>`;
  return brandAssetsSectionHTML(c, d) + (isPerformanceMarketingClient(c) ? clientReportSectionHTML(c) + adPerformanceSectionHTML(c, d) + adAccessSectionHTML(c, d) + campaignBriefSectionHTML(c, d) : '') + meetingsSectionHTML(c, d);
}
function brandAssetsSectionHTML(c, d){
  const assets = d.brandAssets || [];
  return collabHead('Brand Assets', assets.length, collabBtn(`openAddBrandAsset('${c.id}')`,'i-plus','Add asset')) +
  (assets.length ? `<div style="display:flex;flex-direction:column;gap:6px;">${assets.map(a=>{ const href = safeHref(a.link); return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:7px;font-size:12.5px;">
      <span style="overflow:hidden;">
        ${href?`<a href="${href}" target="_blank" rel="noopener noreferrer" style="font-weight:700;">${esc(a.name)}</a>`:`<span style="font-weight:700;">${esc(a.name)}</span>`}
        ${a.notes?`<div class="subtext">${esc(a.notes)}</div>`:''}
      </span>
      <button type="button" class="btn btn-sm ghost" title="Remove asset" onclick="removeBrandAsset('${c.id}','${esc(a.id)}')"><svg class="icon" style="width:11px;height:11px"><use href="#i-x"/></svg></button>
    </div>`; }).join('')}</div>` : `<div class="empty">No brand assets shared yet.</div>`);
}
// A Performance Marketing client's daily ad numbers, typed in from what their ad platform reports. Same
// tracker and log form as DesGro's own Meta Ads (adDailyTrackerHTML / logAdMetricModal); rows carry a
// "clientId|metricId" id so the shared edit/delete buttons know which client they belong to.
function adPerformanceSectionHTML(c, d){
  const rows = (d.adMetrics||[]).slice(0,30).map(m=>({...m, id:`${c.id}|${m.id}`}));
  return adDailyTrackerHTML(rows, "Ad Performance", {logFn:`openLogClientAdMetric('${c.id}')`, editFn:"openLogClientAdMetric", deleteKind:"clientAdMetric", currency:d.adCurrency, currencyFn:`setClientAdCurrency.bind(null,'${c.id}')`});
}
async function setClientAdCurrency(clientId, currency){
  try{
    await apiJson(`/api/crm/clients/${clientId}/ad-currency`, { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify({currency}) });
    toast(`Ad numbers now shown in ${currency}`); await loadClientCollab(clientId);
  }catch(err){ toast(err.message || "Couldn't change currency"); await loadClientCollab(clientId); }
}
function openLogClientAdMetric(arg){
  const [clientId, metricId] = arg.split('|');
  const c = clientById(clientId);
  const existing = metricId ? ((clientCollab[clientId]||{}).adMetrics||[]).find(m=>m.id===metricId) : null;
  logAdMetricModal(c ? c.name : "Client", existing, async payload=>{
    await apiJson(`/api/crm/clients/${clientId}/ad-metrics`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) });
    await loadClientCollab(clientId);
  }, (clientCollab[clientId]||{}).adCurrency);
}
function adAccessSectionHTML(c, d){
  const a = d.adAccess;
  return collabHead('Ad Account Access', null, collabBtn(`openEditAdAccess('${c.id}')`,'i-edit','Update access')) +
  (a ? `<div class="field-row cols-3">
    <div><label class="field-label">Platform</label><div>${esc(a.platform)}</div></div>
    <div><label class="field-label">Account ID</label><div class="mono">${esc(a.accountId||'—')}</div></div>
    <div><label class="field-label">Access Email</label><div class="mono">${esc(a.accessEmail||'—')}</div></div>
    <div><label class="field-label">Status</label><div>${pill(TITLECASE_FROM_API(a.status), a.status==='GRANTED'?'pos':a.status==='PENDING'?'warn':'neg')}</div></div>
    <div style="grid-column:span 2;"><label class="field-label">Notes</label><div>${a.notes?esc(a.notes):'<span class="faint">—</span>'}</div></div>
  </div><div class="subtext">Updated by ${esc(a.updatedBy)} · ${fmtDateShort(isoDate(a.updatedAt))}</div>` : `<div class="empty">No ad account access on record yet.</div>`);
}
function campaignBriefSectionHTML(c, d){
  const b = d.campaignBrief;
  const has = b && (b.objective||b.audience||b.budget);
  const val = v => v ? esc(v) : '<span class="faint">—</span>';
  return collabHead('Campaign Brief', null, collabBtn(`openEditCampaignBrief('${c.id}')`,'i-edit','Edit brief')) +
  (has ? `<div class="field-row cols-3">
    <div><label class="field-label">Objective</label><div>${val(b.objective)}</div></div>
    <div><label class="field-label">Audience</label><div>${val(b.audience)}</div></div>
    <div><label class="field-label">Budget</label><div>${val(b.budget)}</div></div>
  </div><div class="subtext">Updated by ${esc(b.updatedBy)} · ${fmtDateShort(isoDate(b.updatedAt))}</div>` : `<div class="empty">No campaign brief set yet.</div>`);
}
function meetingsSectionHTML(c, d){
  const ms = d.meetings || [];
  return collabHead('Weekly Client Meetings', ms.length, collabBtn(`openLogMeeting('${c.id}')`,'i-plus','Log meeting')) +
  (ms.length ? `<div style="display:flex;flex-direction:column;gap:8px;">${ms.map(m=>`
    <div style="padding:9px 11px;border:1px solid var(--line);border-radius:7px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap;"><b style="font-size:12.5px;">${fmtDate(m.date)}</b><span class="subtext">Logged by ${esc(m.loggedBy)}${canDeleteClients()?` <button type="button" class="btn btn-sm ghost" title="Delete this meeting log" onclick="openConfirmDelete('clientMeeting','${c.id}|${esc(m.id)}')"><svg class="icon" style="width:11px;height:11px"><use href="#i-x"/></svg></button>`:''}</span></div>
      <div class="subtext" style="margin-top:3px;">${esc(m.attendees)}</div>
      <div style="font-size:12.5px;margin-top:5px;white-space:pre-wrap;">${esc(m.notes)}</div>
    </div>`).join('')}</div>` : `<div class="empty">No meetings logged yet.</div>`);
}
const collabModalHead = t => `<div class="modal-head"><h3>${t}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>`;
const collabModalFoot = label => `<div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">${label}</button></div></div>`;
// Shared submit plumbing: send, reload this client's collab data, toast, close.
async function collabSave(clientId, method, path, payload, okMsg){
  try{
    await apiJson(`/api/crm/clients/${clientId}${path}`, { method, headers:{"Content-Type":"application/json"}, body: payload?JSON.stringify(payload):undefined });
    await loadClientCollab(clientId);
    toast(okMsg); closeModal();
  }catch(err){ toast(err.message || "Couldn't save"); }
}
function openEditAdAccess(clientId){
  const a = (clientCollab[clientId]||{}).adAccess || {};
  showModal(`${collabModalHead('Update ad account access')}
    <form id="f-edit-ad-access"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Record who has access and where. <b>Never enter a password here</b> — access is granted on the ad platform itself.</div></div>
      <div class="field-row">
        <div><label class="field-label">Platform</label><input class="field-input" name="platform" maxlength="100" value="${esc(a.platform||'Meta Business Manager')}" required></div>
        <div><label class="field-label">Account ID</label><input class="field-input" name="accountId" maxlength="100" value="${esc(a.accountId||'')}" placeholder="act_xxxxxxxxxx"></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">Access Email</label><input class="field-input" type="email" name="accessEmail" maxlength="200" value="${esc(a.accessEmail||'')}" placeholder="ads@desgromedia.com"></div>
        <div><label class="field-label">Status</label><select class="field-input" name="status">${AD_ACCESS_STATUSES.map(s=>`<option value="${s.toUpperCase()}" ${s.toUpperCase()===(a.status||'PENDING')?'selected':''}>${s}</option>`).join('')}</select></div>
      </div>
      <div><label class="field-label">Notes</label><textarea class="field-input" name="notes" rows="2" maxlength="1000" placeholder="Anything about how access is set up">${esc(a.notes||'')}</textarea></div>
    </div>${collabModalFoot('Save')}</form>`);
  document.getElementById("f-edit-ad-access").addEventListener("submit", e=>{
    e.preventDefault(); const f = new FormData(e.target);
    collabSave(clientId, "PUT", "/ad-access", { platform:f.get("platform"), accountId:f.get("accountId"), accessEmail:f.get("accessEmail"), status:f.get("status"), notes:f.get("notes") }, "Ad account access updated");
  });
}
function openEditCampaignBrief(clientId){
  const b = (clientCollab[clientId]||{}).campaignBrief || {};
  showModal(`${collabModalHead('Edit campaign brief')}
    <form id="f-edit-campaign-brief"><div class="modal-body">
      <div><label class="field-label">Objective</label><input class="field-input" name="objective" maxlength="500" value="${esc(b.objective||'')}" placeholder="e.g. Lead generation — showroom visits"></div>
      <div><label class="field-label">Audience</label><input class="field-input" name="audience" maxlength="500" value="${esc(b.audience||'')}" placeholder="e.g. Homeowners, 28–55, UAE"></div>
      <div><label class="field-label">Budget</label><input class="field-input" name="budget" maxlength="200" value="${esc(b.budget||'')}" placeholder="e.g. AED 15,000 / month"></div>
    </div>${collabModalFoot('Save')}</form>`);
  document.getElementById("f-edit-campaign-brief").addEventListener("submit", e=>{
    e.preventDefault(); const f = new FormData(e.target);
    collabSave(clientId, "PUT", "/campaign-brief", { objective:f.get("objective"), audience:f.get("audience"), budget:f.get("budget") }, "Campaign brief updated");
  });
}
function openAddBrandAsset(clientId){
  showModal(`${collabModalHead('Add brand asset')}
    <form id="f-add-brand-asset"><div class="modal-body">
      <div><label class="field-label">Name</label><input class="field-input" name="name" maxlength="200" required placeholder="e.g. Logo pack"></div>
      <div><label class="field-label">Link</label><input class="field-input" type="url" name="link" maxlength="2000" placeholder="https://drive.google.com/..."></div>
      <div><label class="field-label">Notes</label><input class="field-input" name="notes" maxlength="500" placeholder="Optional"></div>
    </div>${collabModalFoot('Add')}</form>`);
  document.getElementById("f-add-brand-asset").addEventListener("submit", e=>{
    e.preventDefault(); const f = new FormData(e.target);
    collabSave(clientId, "POST", "/brand-assets", { name:f.get("name"), link:f.get("link"), notes:f.get("notes") }, "Brand asset added");
  });
}
function removeBrandAsset(clientId, assetId){ collabSave(clientId, "DELETE", `/brand-assets/${assetId}`, null, "Brand asset removed"); }
function openLogMeeting(clientId){
  const d = new Date(); const local = new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
  showModal(`${collabModalHead('Log client meeting')}
    <form id="f-log-meeting"><div class="modal-body">
      <div><label class="field-label">Date</label><input class="field-input" type="date" name="date" value="${local}" max="${local}" required></div>
      <div><label class="field-label">Attendees</label><input class="field-input" name="attendees" maxlength="500" required placeholder="e.g. Hafsa Rahman, Client Ops Manager"></div>
      <div><label class="field-label">Notes</label><textarea class="field-input" name="notes" rows="3" maxlength="5000" required placeholder="What was discussed / decided"></textarea></div>
    </div>${collabModalFoot('Save')}</form>`);
  document.getElementById("f-log-meeting").addEventListener("submit", e=>{
    e.preventDefault(); const f = new FormData(e.target);
    collabSave(clientId, "POST", "/meetings", { date:f.get("date"), attendees:f.get("attendees"), notes:f.get("notes") }, "Meeting logged");
  });
}
// A Clients-only login manages client details but can't archive, delete or change a client's status (the server enforces the same).
function canArchiveClients(){ return !!(currentUser && (currentUser.isAdmin || (currentUser.roles||[]).some(r=>r==='SALES'||r==='SALES_HEAD'))); }
function canDeleteClients(){ return !!(currentUser && (currentUser.isAdmin || (currentUser.roles||[]).includes('SALES_HEAD'))); }
function openClientDetail(id){ nav.detail = {type:'client', id}; render(); loadClientCollab(id); loadClientLeadAdvances(id); loadClientFeedback(id); { const c = clientById(id); if(c && isPerformanceMarketingClient(c)) loadClientReportLink(id); } }
// A client's whole page IS their workflow — one Payment section (every invoice raised against them)
// and one Task board (every activity done for them), nothing split off into a separate "project".

/* ===================== CLIENT SERVICES — a board per service =====================
   Each service the client takes (Production, Web Development, Graphic Design) gets a tab with a board of that service's work:
   one card per deliverable / task, in that service's own columns. A card's status follows its column, so My Tasks, the Calendar
   and the dashboards read the same cards. Columns, types and each project type's task list come from the server (/crm/service-boards). */
let SERVICE_BOARDS = {};
async function loadServiceBoards(){ SERVICE_BOARDS = (await apiJson("/api/crm/service-boards")).boards; }
const boardStages = service => (SERVICE_BOARDS[service]||{}).stages || [];
const boardLast = service => { const st = boardStages(service); return st[st.length-1]; };
function boardStageStatus(service, stage){
  const st = boardStages(service), i = st.indexOf(stage);
  if(i === st.length-1) return "Done"; if(i <= 0) return "To Do";
  return /review|approval/i.test(stage) ? "Review" : "In Progress";
}
// Server access is the client-page guard (a Sales rep's own book; Admin / Sales Head / Clients role see all).
function canEditBoard(){ return !!currentUser && !currentUser.isClient; }
// Swap a card the server returned into the task list.
function putTask(raw){ const t = mapTask(raw), i = clientTasks.findIndex(x=>x.id===t.id); if(i>=0) clientTasks[i] = Object.assign(clientTasks[i], t); else clientTasks.push(t); }
async function moveBoardCard(id, stage){
  const t = clientTasks.find(x=>x.id===id); if(!t || t.stage===stage) return;
  const prev = {stage:t.stage, status:t.status, doneDate:t.doneDate};
  t.stage = stage; t.status = boardStageStatus(t.service, stage); t.doneDate = t.status==="Done" ? TODAY : undefined; render();   // optimistic
  try{ putTask((await apiJson(`/api/crm/board-cards/${id}`, {method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({stage})})).task); }
  catch(err){ Object.assign(t, prev); toast(err.message || "Couldn't move this card"); }
  render();
}

function wdInclusive(a, b){ return b < a ? 0 : workingDaysBetween(a, b) + (isPlanWorkingDay(a) ? 1 : 0); }
function addWorkingDays(date, n){
  let d = date; while(!isPlanWorkingDay(d)) d = addDays(d, 1);
  let left = Math.max(0, Math.ceil(n) - 1);
  while(left>0){ d = addDays(d, 1); if(isPlanWorkingDay(d)) left--; }
  return d;
}
function workingDaysBetween(a, b){ // working days after a up to and including b (negative when b < a)
  if(a===b) return 0; const sign = b>a ? 1 : -1; let d = a, n = 0;
  while(d!==b){ d = addDays(d, sign); if(isPlanWorkingDay(d)) n += sign; }
  return n;
}
// Working-day schedule for a project's tasks: back-to-back from the start date, each with its allowed days.
function projectSchedule(svc, type, startDate){
  let d = nextWorkingDay(startDate);
  return SERVICE_BOARDS[svc].projectTasks[type].map(r=>{ const start = d, due = addWorkingDays(start, r.days); d = nextWorkingDay(addDays(due, 1)); return {title:r.name, start, due}; });
}

/* ---- Marketing Consultation: one cycle of tasks per client per month ---- */
const MC_SVC = "Marketing Consultation";
function mcCycles(clientId){ return [...new Set(clientTasks.filter(t=>t.clientId===clientId && t.service===MC_SVC && t.cycle).map(t=>t.cycle))].sort(); }
function mcIsRetained(clientId, month){ return mcCycles(clientId).some(m=>m < month); }
function mcCycleTasks(retained){ return ((SERVICE_BOARDS[MC_SVC]||{}).monthlyTasks||[]).filter(r=>!(retained && r.newOnly)); }
function cycleSchedule(retained, startDate){
  let d = nextWorkingDay(startDate);
  return mcCycleTasks(retained).map(r=>{ const start = d, due = addWorkingDays(start, r.days); d = nextWorkingDay(addDays(due, 1)); return {title:r.name, start, due}; });
}
function deptDefaultOwner(svc){ const h = typeof deptHeads!=="undefined" && deptHeads[svc]; if(h) return h; const e = activeEmployees().find(x=>x.dept===svc); return e ? e.name : ""; }
function nextWorkingDay(d){ let i = 0; while(!isPlanWorkingDay(d) && i++ < 30) d = addDays(d, 1); return d; }
function serviceMeetingsHTML(c, service, readOnly, opts){
  opts = opts || {};
  const list = ((clientCollab[c.id]||{}).serviceMeetings||[]).filter(m=>m.service===service && (!opts.scheduledOnly || m.status==="SCHEDULED") && (!opts.month || (m.date||'').slice(0,7)===opts.month));
  const upcoming = list.filter(m=>m.status==="SCHEDULED").sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||'')));
  const held = list.filter(m=>m.status!=="SCHEDULED").sort((a,b)=>b.date.localeCompare(a.date));
  const can = !readOnly && canEditBoard();
  const card = m => `<div style="padding:10px 12px;border:1px solid var(--line);border-radius:8px;${m.status==='SCHEDULED'?'background:var(--blue-soft);border-color:transparent;':''}">
    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline;"><b style="font-size:12.5px;${m.status==='CANCELLED'?'text-decoration:line-through;color:var(--ink-faint);':''}">${fmtDate(m.date)}${m.time?' · '+esc(m.time):''}${m.mode?` <span class="faint" style="font-weight:600;">· ${esc(m.mode)}</span>`:''}</b>
      <span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">${m.status==='SCHEDULED'?pill(m.date<TODAY?'Minutes pending':'Scheduled', m.date<TODAY?'warn':'blue'):m.status==='CANCELLED'?pill('Cancelled','neutral'):pill(m.scheduledFor?'Held · was scheduled':'Held','pos')}${can&&m.status==='SCHEDULED'?`<button class="btn btn-sm primary" onclick="openServiceMeeting('${c.id}','${esc(service)}','${m.id}','held')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Mark as held</button><button class="btn btn-sm ghost" onclick="openServiceMeeting('${c.id}','${esc(service)}','${m.id}','reschedule')">Reschedule</button><button class="btn btn-sm ghost" onclick="cancelServiceMeeting('${c.id}','${m.id}')">Cancel</button>`:''}</span></div>
    ${m.scheduledFor&&m.scheduledFor!==m.date?`<div class="faint" style="font-size:11px;margin-top:2px;">Originally scheduled for ${fmtDate(m.scheduledFor)}</div>`:''}
    ${m.attendees?`<div class="subtext" style="margin-top:3px;">${esc(m.attendees)}</div>`:''}
    ${m.agenda?`<div style="font-size:12.5px;margin-top:5px;"><b>Agenda:</b> ${esc(m.agenda)}</div>`:''}
    ${m.notes?`<div style="font-size:12.5px;margin-top:5px;">${esc(m.notes)}</div>`:''}
    ${m.actionItems?`<div style="font-size:12px;margin-top:5px;color:var(--ink-soft);"><b>Action items:</b> ${esc(m.actionItems)}</div>`:''}
  </div>`;
  return `<div style="display:flex;flex-direction:column;gap:8px;">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;"><b style="font-size:13px;">${opts.scheduledOnly?'Scheduled meetings':'Client meetings · '+esc(service)}</b>${can?`<span style="display:flex;gap:6px;"><button class="btn btn-sm ghost" onclick="openServiceMeeting('${c.id}','${esc(service)}',null,'schedule')"><svg class="icon" style="width:12px;height:12px"><use href="#i-calendar"/></svg>Schedule</button>${opts.scheduledOnly?'':`<button class="btn btn-sm ghost" onclick="openServiceMeeting('${c.id}','${esc(service)}',null,'log')"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Log meeting</button>`}</span>`:''}</div>
    ${upcoming.map(card).join('')}${held.map(card).join('')}
    ${!list.length?`<div class="empty" style="padding:10px;">${opts.scheduledOnly?'Nothing scheduled.':opts.month?`No ${esc(service.toLowerCase())} meetings in ${monthLabel(opts.month)}.`:`No ${esc(service.toLowerCase())} meetings yet.`}${can?' Schedule one — it shows in the Calendar, and you mark it as held with the minutes once it happens.':''}</div>`:''}
  </div>`;
}
function webDetailsHTML(c, readOnly){
  const d = (clientCollab[c.id]||{}).webDetails || {}, edit = !readOnly && canEditBoard();
  if(!Object.values(d).some(Boolean) && !edit) return '';
  const row = (k, v, link) => `<div style="display:grid;grid-template-columns:120px minmax(0,1fr);gap:10px;padding:7px 0;border-bottom:1px solid var(--line);font-size:12.5px;"><span class="muted">${k}</span><span style="min-width:0;overflow-wrap:anywhere;">${v ? (link ? `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>` : esc(v)) : '<span class="faint">—</span>'}</span></div>`;
  return `<div style="border:1px solid var(--line);border-radius:12px;padding:12px 16px;">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;"><b style="font-size:13px;">Website details</b>${edit?`<button class="btn btn-sm ghost" onclick="openWebDetails('${c.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button>`:''}</div>
    ${row('Staging link', d.stagingUrl, true)}${row('Live site', d.liveUrl, true)}${row('Domain', d.domain)}${row('Hosting', d.hosting)}${row('Platform', d.platform)}
    ${d.notes?`<div style="font-size:12px;margin-top:8px;color:var(--ink-soft);"><b style="color:var(--ink);">Notes:</b> ${esc(d.notes)}</div>`:''}
  </div>`;
}

// Schedule a meeting (shows in the Calendar), log one that happened, or add minutes to a scheduled one.
function openServiceMeeting(clientId, service, meetingId, mode){
  const c = clientById(clientId); if(!c || !canEditBoard()) return;
  const m = meetingId ? ((clientCollab[clientId]||{}).serviceMeetings||[]).find(x=>x.id===meetingId) : null;
  // schedule = new or rescheduled future meeting; otherwise we're recording one that happened (incl. marking a scheduled one as held)
  const schedule = m ? mode==='reschedule' : mode==='schedule';
  showModal(`
    <div class="modal-head"><h3>${schedule?(m?'Reschedule meeting':'Schedule client meeting'):(m&&m.status==='SCHEDULED'?'Mark meeting as held':m?'Edit meeting minutes':'Log client meeting')}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-svc-meeting"><div class="modal-body">
      <div class="subtext" style="font-size:12px;margin-top:0;">${esc(c.name)} · ${esc(service)}${schedule?' · shows in the Calendar until it happens':m&&m.status==='SCHEDULED'?` · scheduled for ${fmtDate(m.date)}${m.time?' '+esc(m.time):''} — confirm the actual date and add the minutes`:''}</div>
      <div class="field-row cols-3">
        <div><label class="field-label" for="sm2-date">Date</label><input class="field-input" type="date" id="sm2-date" name="date" required value="${m?(schedule||m.date<=TODAY?m.date:TODAY):TODAY}" ${schedule?`min="${TODAY}"`:`max="${TODAY}"`}></div>
        <div><label class="field-label" for="sm2-time">Time</label><input class="field-input" type="time" id="sm2-time" name="time" value="${m&&m.time?m.time:'11:00'}"></div>
        <div><label class="field-label" for="sm2-mode">How</label><select class="field-input" id="sm2-mode" name="mode">${["Google Meet","In person","Call"].map(x=>`<option ${m&&m.mode===x?'selected':''}>${x}</option>`).join('')}</select></div>
      </div>
      <div><label class="field-label" for="sm2-att">Attendees</label><input class="field-input" id="sm2-att" name="attendees" value="${esc(m?m.attendees||'':'')}" placeholder="e.g. Muhsin Ali, client founder"></div>
      <div><label class="field-label" for="sm2-agenda">Agenda</label><input class="field-input" id="sm2-agenda" name="agenda" value="${esc(m?m.agenda||'':'')}" placeholder="What the meeting is for"></div>
      ${schedule?'':`<div><label class="field-label" for="sm2-notes">Minutes of the meeting</label><textarea class="field-input" id="sm2-notes" name="notes" rows="3" required placeholder="What was reviewed, discussed and decided">${esc(m?m.notes||'':'')}</textarea></div>
      <div><label class="field-label" for="sm2-ai">Action items</label><textarea class="field-input" id="sm2-ai" name="actionItems" rows="2" placeholder="Who does what, by when (optional)">${esc(m?m.actionItems||'':'')}</textarea></div>`}
    </div>
    <div class="modal-foot">${m?`<button type="button" class="btn ghost" style="color:var(--neg);" onclick="openConfirmDelete('serviceMeeting','${clientId}|${m.id}')">Delete</button>`:'<div></div>'}<div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">${schedule?'Schedule':'Save minutes'}</button></div></div>
    </form>`);
  document.getElementById("f-svc-meeting").addEventListener("submit", async e=>{
    e.preventDefault(); const f = new FormData(e.target);
    const body = {service, status:schedule?"SCHEDULED":"HELD", date:f.get("date"), time:f.get("time")||"", mode:f.get("mode"), attendees:(f.get("attendees")||"").trim(), agenda:(f.get("agenda")||"").trim()};
    if(!schedule){ body.notes = (f.get("notes")||"").trim(); body.actionItems = (f.get("actionItems")||"").trim(); }
    try{
      await apiJson(m ? `/api/crm/clients/${clientId}/service-meetings/${m.id}` : `/api/crm/clients/${clientId}/service-meetings`, {method:m?"PUT":"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
      await Promise.all([loadClientCollab(clientId), loadCalendarClientMeetings()]);
      toast(schedule?(m?"Meeting rescheduled — Calendar updated":"Meeting scheduled — it's on the Calendar"):(m&&m.status==='SCHEDULED'?"Recorded as held":"Meeting minutes saved")); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't save the meeting"); }
  });
}
async function cancelServiceMeeting(clientId, id){
  try{ await apiJson(`/api/crm/clients/${clientId}/service-meetings/${id}/cancel`, {method:"POST"}); await Promise.all([loadClientCollab(clientId), loadCalendarClientMeetings()]); toast("Meeting cancelled — removed from the Calendar"); render(); }
  catch(err){ toast(err.message || "Couldn't cancel the meeting"); }
}
// Meetings on the Calendar: every scheduled or held service meeting on the clients this login can see (empty for logins without Clients access).
let calendarClientMeetings = [];
async function loadCalendarClientMeetings(){ try{ calendarClientMeetings = (await apiJson("/api/crm/client-meetings")).meetings; }catch(err){ calendarClientMeetings = []; } }
function openWebDetails(clientId){
  const c = clientById(clientId); if(!c || !canEditBoard()) return;
  const d = (clientCollab[clientId]||{}).webDetails || {};
  const f = (k, label, ph) => `<div><label class="field-label" for="wd-${k}">${label}</label><input class="field-input" id="wd-${k}" name="${k}" value="${esc(d[k]||'')}" placeholder="${ph}"></div>`;
  showModal(`
    <div class="modal-head"><h3>Website details</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-web-details"><div class="modal-body">
      <div class="field-row">${f('stagingUrl','Staging link','https://…')}${f('liveUrl','Live site','https://…')}</div>
      <div class="field-row">${f('domain','Domain','example.com')}${f('hosting','Hosting','e.g. Hostinger (client account)')}</div>
      ${f('platform','Platform','e.g. WordPress + Elementor, Shopify')}
      <div><label class="field-label" for="wd-notes">Notes</label><textarea class="field-input" id="wd-notes" name="notes" rows="2">${esc(d.notes||'')}</textarea></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save</button></div></div>
    </form>`);
  document.getElementById("f-web-details").addEventListener("submit", async e=>{
    e.preventDefault(); const fd = new FormData(e.target);
    const body = Object.fromEntries(["stagingUrl","liveUrl","domain","hosting","platform","notes"].map(k=>[k, (fd.get(k)||"").trim()]));
    try{ await apiJson(`/api/crm/clients/${clientId}/web-details`, {method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)}); await loadClientCollab(clientId); toast("Website details saved"); closeModal(); render(); }
    catch(err){ toast(err.message || "Couldn't save the website details"); }
  });
}
function clientServicesHTML(c){
  const svcs = c.services.filter(s=>SERVICE_BOARDS[s]);
  if(!svcs.length) return '';
  const tab = svcs.includes(clientServiceTab[c.id]) ? clientServiceTab[c.id] : svcs[0];
  return `<div class="section-label">Services</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;">${svcs.map(s=>{ const n = boardCards(c.id, s).filter(x=>x.status!=="Done").length;
    return `<button class="chip ${s===tab?'active':''}" onclick="setClientServiceTab('${c.id}','${esc(s)}')" style="display:inline-flex;align-items:center;gap:6px;">${esc(s)}${n?`<span class="mono" style="font-size:10.5px;opacity:.8;">${n} active</span>`:''}</button>`; }).join('')}</div>
  <div style="display:flex;flex-direction:column;gap:12px;">${serviceBoardHTML(c, tab)}${tab==="Web Development" ? webDetailsHTML(c, false) : ''}${serviceMeetingsHTML(c, tab, false)}</div>`;
}
let clientServiceTab = {};
function setClientServiceTab(clientId, svc){ clientServiceTab[clientId] = svc; render(); }

function boardProjects(clientId, svc){
  const m = {}; clientTasks.filter(t=>t.clientId===clientId && t.service===svc && t.project).forEach(t=>{ const p = m[t.project] || (m[t.project] = {id:t.project, title:t.projectName||t.project, type:t.projectType||'', clientId, service:svc, tasks:[]}); p.tasks.push(t); });
  return Object.values(m).map(p=>{ const done = p.tasks.every(t=>t.status==="Done"); return Object.assign(p, {done, doneDate: done ? p.tasks.map(t=>t.doneDate||t.due).sort().pop() : null, start: p.tasks.map(t=>t.start).filter(Boolean).sort()[0]}); }).sort((a,b)=>(b.start||'').localeCompare(a.start||''));
}
function boardCards(cid, service){ return clientTasks.filter(t=>t.clientId===cid && t.service===service); }
let boardState = {};
function bState(cid, svc){ const k = cid+'|'+svc; return boardState[k] || (boardState[k] = {month:TODAY.slice(0,7), platform:"All", assignee:"All", project:"All"}); }
function setBoardFilter(cid, svc, k, v){ bState(cid, svc)[k] = v; render(); }
function cardMonth(t){ return t.cycle || (t.due||'').slice(0,7); }
function boardMonthList(cid, svc){
  const ms = [...boardCards(cid, svc).map(cardMonth).filter(Boolean), TODAY.slice(0,7)].sort();
  const out = []; let m = ms[0]; const last = ms[ms.length-1];
  while(m <= last){ out.push(m); const [y,mm] = m.split('-').map(Number); m = new Date(Date.UTC(y, mm, 1)).toISOString().slice(0,7); }
  return out.reverse();
}
function shiftBoardMonth(cid, svc, step){ const list = boardMonthList(cid, svc), i = list.indexOf(bState(cid, svc).month), j = i - step; if(j>=0 && j<list.length) setBoardFilter(cid, svc, 'month', list[j]); }
function cardInMonth(t, month){
  const due = cardMonth(t);
  if(due===month) return true;
  return month===TODAY.slice(0,7) && t.status!=="Done" && (!due || due < month);
}
function cardOverdue(t){ return t.status!=="Done" && t.due && t.due < TODAY; }
let boardDragId = null;
function boardDragStart(e, id){ boardDragId = id; e.dataTransfer.effectAllowed = 'move'; }
function boardDrop(e, stage){ e.preventDefault(); e.currentTarget.classList.remove('drop-hover'); if(boardDragId) moveBoardCard(boardDragId, stage); boardDragId = null; }

function serviceBoardHTML(c, svc, readOnly){
  const cfg = SERVICE_BOARDS[svc], stages = cfg.stages, last = stages[stages.length-1];
  const st = bState(c.id, svc), list = boardMonthList(c.id, svc); if(!list.includes(st.month)) st.month = TODAY.slice(0,7);
  const i = list.indexOf(st.month), M = monthLabel(st.month), prev = prevMonth(st.month);
  const edit = !readOnly && canEditBoard(), q = s2 => esc(s2).replace(/'/g,"\\'");
  const mine = boardCards(c.id, svc), plats = cfg.platforms||[];
  const inMonth = mine.filter(x=>cardInMonth(x, st.month) || (cfg.projectTasks && st.project && st.project!=='All' && x.project===st.project));
  const projs = cfg.projectTasks ? boardProjects(c.id, svc) : []; if(st.project && st.project!=='All' && !projs.some(p2=>p2.id===st.project)) st.project = 'All';
  const shown = inMonth.filter(x=>(st.platform==='All' || (x.platforms||[]).includes(st.platform)) && (st.assignee==='All' || x.assignedTo===st.assignee) && (!st.project || st.project==='All' || x.project===st.project));
  const delivered = x=>x.status==="Done" && x.stage===last;   // Done in an earlier column only means that step is finished
  const doneNow = mine.filter(x=>delivered(x) && cardMonth(x)===st.month).length, donePrev = mine.filter(x=>delivered(x) && cardMonth(x)===prev).length;
  const toDo = inMonth.filter(x=>!delivered(x)), overdue = toDo.filter(cardOverdue);
  const team = [...new Set([...activeEmployees().filter(e=>e.dept===svc).map(e=>e.name), ...mine.map(x=>x.assignedTo).filter(Boolean)])];
  const kpi = (label, v, sub) => `<div class="kpi-card" style="padding:12px 14px;"><div class="kpi-label">${label}</div><div class="kpi-value mono" style="font-size:20px;">${v}</div><div class="kpi-sub">${sub}</div></div>`;
  const card = t => { const od = cardOverdue(t), done = delivered(t), stepDone = t.status==="Done" && !done, k = null;
    const lateBy = cfg.flagLate && od ? Math.max(1, wdInclusive(addDays(t.due,1), TODAY)) : 0, doneLate = cfg.flagLate && done && t.doneDate && t.due && t.doneDate > t.due;
    return `
    <div class="card ${done?'published':''}" ${edit?`draggable="true" ondragstart="boardDragStart(event,'${t.id}')"`:''} ${(k&&k.late)||lateBy?'data-delayed="1"':''} style="${(k&&k.late)||lateBy?'border-color:var(--neg);box-shadow:inset 3px 0 0 var(--neg);':''}${edit?'':'cursor:default;'}">
      <div class="card-title">${esc(t.title)}</div>
      ${stepDone?`<div style="font-size:11px;font-weight:700;color:var(--pos);">✓ ${esc(t.stage)} done · ready for the next step</div>`:''}
      ${lateBy?`<div style="display:flex;justify-content:space-between;gap:6px;font-size:11px;font-weight:700;padding:5px 7px;border-radius:6px;background:var(--neg-soft);color:var(--neg);"><span>⚑ Delayed · was due ${fmtDateShort(t.due)}</span><span class="mono">+${lateBy}d</span></div>`:''}
      ${doneLate?`<div style="font-size:11px;font-weight:700;color:var(--warn);">Finished ${Math.max(1, wdInclusive(addDays(t.due,1), t.doneDate))}d late</div>`:''}
      ${k?`<div style="display:flex;justify-content:space-between;gap:6px;font-size:11px;font-weight:700;padding:5px 7px;border-radius:6px;${k.late?'background:var(--neg-soft);color:var(--neg);':'background:var(--surface-sunk);color:var(--ink-soft);'}"><span>${k.late?'⚑ Delayed':'In stage'} · since ${fmtDateShort(k.start)}</span><span class="mono">${k.taken}${k.max?' / '+k.max:''}d</span></div>`:''}
      <div class="card-meta">${t.projectName?`<span class="tag type">${esc(t.projectName)}</span>`:t.type?`<span class="tag type">${esc(t.type)}</span>`:''}${t.maxDays?`<span class="tag mono" title="Most working days allowed">${t.maxDays}d max</span>`:''}${t.clientAssigned?`<span class="tag type">Client action</span>`:''}${(t.platforms||[]).map(p2=>`<span class="tag">${esc(p2)}</span>`).join('')}</div>
      <div class="card-foot"><span class="assignee"><span class="mini-avatar sm ${t.assignedTo?'':'unassigned'}">${t.clientAssigned?'CL':t.assignedTo?initials(t.assignedTo):'—'}</span>${esc(t.assignedTo||'Unassigned')}</span>${done?`<span class="due published-on"><svg class="icon" style="width:10px;height:10px;display:inline;vertical-align:-1px"><use href="#i-check"/></svg> ${fmtDateShort(t.doneDate||t.due)}</span>`:`<span class="due ${od?'overdue':''}">${od?'overdue · ':''}${t.start&&t.due&&t.start!==t.due?fmtDateShort(t.start)+' → '+fmtDateShort(t.due):t.due?fmtDateShort(t.due):'no date'}</span>`}</div>
      ${edit?`<div class="card-move"><select onchange="moveBoardCard('${t.id}', this.value)">${stages.map(s2=>`<option value="${esc(s2)}" ${s2===t.stage?'selected':''}>${esc(s2)}</option>`).join('')}</select><button class="card-edit" title="Edit" onclick="openBoardCard('${c.id}','${q(svc)}','${t.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg></button></div>`:''}
    </div>`; };
  return `
  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
    <div style="display:flex;align-items:center;gap:8px;"><span class="filter-label">Month</span>
      <button class="btn btn-sm ghost" onclick="shiftBoardMonth('${c.id}','${q(svc)}',-1)" ${i>=list.length-1?'disabled':''} aria-label="Previous month">‹</button>
      <select class="select-sm" onchange="setBoardFilter('${c.id}','${q(svc)}','month',this.value)">${list.map(m=>`<option value="${m}" ${m===st.month?'selected':''}>${monthLabel(m)}${m===TODAY.slice(0,7)?' (this month)':''}</option>`).join('')}</select>
      <button class="btn btn-sm ghost" onclick="shiftBoardMonth('${c.id}','${q(svc)}',1)" ${i<=0?'disabled':''} aria-label="Next month">›</button></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      ${edit && cfg.monthlyTasks ? (()=>{ const cyc = mcCycles(c.id), has = cyc.includes(st.month), nm = (()=>{ const [y,m] = st.month.split('-').map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0,7); })();
        return has ? (!cyc.includes(nm) && st.month===list[0] ? `<button class="btn btn-sm ghost" onclick="openStartCycle('${c.id}','${nm}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-refresh"/></svg>Retain for ${monthLabel(nm).split(' ')[0]}</button>` : '')
          : `<button class="btn btn-sm ghost" onclick="openStartCycle('${c.id}','${st.month}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-calendar"/></svg>Start ${monthLabel(st.month).split(' ')[0]} tasks</button>`; })() : ''}
      ${edit && cfg.projectTasks ? `<button class="btn btn-sm ghost" onclick="openStartProject('${c.id}','${q(svc)}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Start project</button>` : ''}
      ${edit?`<button class="btn btn-sm primary" onclick="openBoardCard('${c.id}','${q(svc)}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>New ${esc(cfg.noun)}</button>`:''}
    </div>
  </div>
  <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));">
    ${kpi(`${esc(last)} · ${M.split(' ')[0].slice(0,3)}`, doneNow, vsHTML(doneNow, donePrev, {mon:monthLabel(prev).slice(0,3)}))}
    ${kpi('Still to deliver', toDo.length, overdue.length?`<span style="color:var(--neg);font-weight:600;">${overdue.length} overdue</span>`:'none overdue')}
    ${kpi('In progress', inMonth.filter(x=>x.status==="In Progress").length, 'being worked on')}
    ${kpi('In review', inMonth.filter(x=>x.status==="Review").length, 'waiting on sign-off')}
    ${cfg.flagLate ? kpi('Delayed', `<span style="${overdue.length?'color:var(--neg);':''}">${overdue.length}</span>`, 'past their allowed days') : ''}
  </div>
  <div style="display:flex;justify-content:${plats.length?'space-between':'flex-end'};gap:10px;flex-wrap:wrap;align-items:center;">
    ${plats.length?`<div class="filter-group"><span class="filter-label">Platform</span><div>${['All',...plats].map(p2=>`<button class="chip ${st.platform===p2?'active':''}" onclick="setBoardFilter('${c.id}','${q(svc)}','platform','${q(p2)}')">${esc(p2)}</button>`).join(' ')}</div></div>`:''}
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
    ${projs.length ? `<select class="select-sm" onchange="setBoardFilter('${c.id}','${q(svc)}','project',this.value)"><option value="All">All projects</option>${projs.map(p2=>`<option value="${esc(p2.id)}" ${st.project===p2.id?'selected':''}>${esc(p2.title)}${p2.done?' (done)':''}</option>`).join('')}</select>${edit && st.project && st.project!=='All' ? `<button class="btn btn-sm ghost" style="color:var(--neg);" onclick="openConfirmDelete('boardProject','${c.id}|${esc(st.project)}|${q(svc)}')">Remove project</button>` : ''}` : ''}
    <select class="select-sm" onchange="setBoardFilter('${c.id}','${q(svc)}','assignee',this.value)"><option value="All">All assignees</option>${team.map(t2=>`<option ${st.assignee===t2?'selected':''}>${esc(t2)}</option>`).join('')}</select>
    </div>
  </div>
  <div class="subtext" style="margin-top:-4px;">Showing work due in ${M}${st.month===TODAY.slice(0,7)?', plus anything unfinished from earlier':''}.${edit?' Drag a card between columns or use its dropdown.':''}</div>
  <div class="board-scroll"><div class="board">${stages.map(stage=>{ const cards = shown.filter(x=>x.stage===stage); return `
    <div class="col" data-stage="${esc(stage)}" ${edit?`ondragover="onDragOver(event)" ondragleave="onDragLeave(event)" ondrop="boardDrop(event,'${q(stage)}')"`:''}>
      <div class="col-head"><span class="name">${esc(stage)}</span><span class="count">${cards.length}</span></div>
      <div class="col-cards">${cards.map(card).join('')}</div>
      ${edit?`<button class="col-add" onclick="openBoardCard('${c.id}','${q(svc)}',null,'${q(stage)}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Add</button>`:''}
    </div>`; }).join('')}</div></div>`;
}

function openBoardCard(clientId, svc, id, presetStage){
  const c = clientById(clientId), cfg = SERVICE_BOARDS[svc]; if(!c || !cfg || !canEditBoard()) return;
  const it = id ? clientTasks.find(x=>x.id===id) : null;
  const act = assignableEmployees().filter(e=>!['Left','Terminated','Resigned'].includes(e.employmentStatus)), team = act.filter(e=>e.dept===svc), rest = act.filter(e=>e.dept!==svc);
  const who = it ? it.assignedTo : '';
  const opt = e => `<option value="${esc(e.name)}" ${e.name===who?'selected':''}>${esc(e.name)}</option>`;
  showModal(`
    <div class="modal-head"><h3>${it?'Edit':'New'} ${esc(cfg.noun)} — ${esc(c.name)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-board-card"><div class="modal-body">
      <div class="subtext" style="font-size:12px;margin-top:0;">${esc(svc)}</div>
      <div><label class="field-label" for="bc-title">Title</label><input class="field-input" id="bc-title" name="title" required value="${it?esc(it.title):''}"></div>
      <div class="field-row">
        <div><label class="field-label" for="bc-type">Type</label><select class="field-input" id="bc-type" name="type">${[...new Set([...cfg.types, ...(it&&it.type?[it.type]:[])])].map(t=>`<option ${it&&it.type===t?'selected':''}>${esc(t)}</option>`).join('')}</select></div>
        <div><label class="field-label" for="bc-stage">Stage</label><select class="field-input" id="bc-stage" name="stage">${cfg.stages.map(s2=>`<option ${(it?it.stage:(presetStage||cfg.stages[0]))===s2?'selected':''}>${esc(s2)}</option>`).join('')}</select></div>
      </div>
      ${(cfg.platforms||[]).length?`<div><label class="field-label">Platforms</label><div class="check-row">${cfg.platforms.map(p2=>`<label class="check-chip"><input type="checkbox" name="platforms" value="${esc(p2)}" ${it&&(it.platforms||[]).includes(p2)?'checked':''}>${esc(p2)}</label>`).join('')}</div></div>`:''}
      <div><label class="field-label" for="bc-who">Assignee</label><select class="field-input" id="bc-who" name="assignedTo"><option value="">Unassigned</option><optgroup label="${esc(svc)} team">${team.map(opt).join('')}</optgroup><optgroup label="Others">${rest.map(opt).join('')}</optgroup><optgroup label="Client"><option value="${esc(c.name)}" ${it&&it.clientAssigned?'selected':''}>${esc(c.name)} (client action)</option></optgroup></select></div>
      <div class="field-row">
        <div><label class="field-label" for="bc-start">Start date</label><input class="field-input" type="date" id="bc-start" name="start" value="${it&&it.start?it.start:''}"></div>
        <div><label class="field-label" for="bc-due">Due date</label><input class="field-input" type="date" id="bc-due" name="due" value="${it?it.due||'':''}"></div>
      </div>
      <div><label class="field-label" for="bc-notes">Brief / notes</label><textarea class="field-input" id="bc-notes" name="notes" rows="3">${it?esc(it.notes||''):''}</textarea></div>
    </div>
    <div class="modal-foot">${it?`<button type="button" class="btn danger" onclick="openConfirmDelete('boardCard','${it.id}')">Delete</button>`:'<div></div>'}<div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save</button></div></div>
    </form>`);
  document.getElementById("f-board-card").addEventListener("submit", async e=>{
    e.preventDefault(); const f = new FormData(e.target);
    if(f.get("start") && f.get("due") && f.get("due") < f.get("start")){ toast("Due date can't be before the start date"); return; }
    const assignedTo = f.get("assignedTo")||"", clientAssigned = assignedTo===c.name;
    const body = {title:(f.get("title")||"").trim(), type:f.get("type"), stage:f.get("stage"), platforms:f.getAll("platforms"), assignedTo, clientAssigned,
      start:f.get("start")||null, notes:(f.get("notes")||"").trim()};
    if(f.get("due")) body.due = f.get("due");
    try{
      const r = it ? await apiJson(`/api/crm/board-cards/${it.id}`, {method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)})
                   : await apiJson(`/api/crm/clients/${clientId}/board-cards`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({...body, service:svc})});
      putTask(r.task); toast(it ? "Saved" : `${cfg.noun[0].toUpperCase()+cfg.noun.slice(1)} added`); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't save"); }
  });
}

function openStartCycle(clientId, month){
  const c = clientById(clientId); if(!c || !canEditBoard()) return;
  const retained = mcIsRetained(clientId, month);
  const first = month===c.onboarded.slice(0,7) && !retained ? c.onboarded : (month===TODAY.slice(0,7) && !retained ? TODAY : month+'-01');
  const preview = r => `<ol style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:3px;font-size:12.5px;">${mcCycleTasks(r).map(x=>`<li>${esc(x.name)} <span class="faint mono">· ${x.days}d</span></li>`).join('')}</ol>`;
  showModal(`
    <div class="modal-head"><h3>${retained?'Retain':'Start'} consultation — ${monthLabel(month)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-start-cycle"><div class="modal-body">
      <div class="subtext" style="font-size:12px;margin-top:0;">${esc(c.name)}</div>
      <div class="field-row">
        <div><label class="field-label" for="cy-start">Start date</label><input class="field-input" type="date" id="cy-start" name="start" required value="${first}"></div>
        <div><label class="field-label" for="cy-owner">Assign to</label><select class="field-input" id="cy-owner" name="owner">${activeEmployees().map(e=>`<option ${e.name===c.accountManager?'selected':''}>${esc(e.name)}</option>`).join('')}</select></div>
      </div>
      <label class="check-chip" style="align-self:flex-start;"><input type="checkbox" id="cy-ret" name="retained" ${retained?'checked':''}>Retained client — start from Plan presentation</label>
      <div><span class="field-label">Tasks created in Open</span><div id="cy-preview">${preview(retained)}</div><div class="subtext">Dated back-to-back from the start date; each gets its allowed working days. Set the list in Departments → Marketing Consultation.</div></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Create tasks</button></div></div>
    </form>`);
  document.getElementById("cy-ret").addEventListener("change", e=>{ document.getElementById("cy-preview").innerHTML = preview(e.target.checked); });
  document.getElementById("f-start-cycle").addEventListener("submit", async e=>{
    e.preventDefault(); const f = new FormData(e.target), start = f.get("start"), ret = !!f.get("retained");
    if(start.slice(0,7)!==month){ toast(`Pick a date in ${monthLabel(month)}`); return; }
    try{
      const r = await apiJson(`/api/crm/clients/${clientId}/board-cycles`, {method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({start, retained:ret, assignedTo:f.get("owner")||"", tasks:cycleSchedule(ret, start)})});
      r.tasks.forEach(putTask); bState(clientId, MC_SVC).month = month; toast(`${monthLabel(month).split(' ')[0]} tasks created`); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't create the tasks"); }
  });
}
function openStartProject(clientId, svc){
  const c = clientById(clientId), cfg = SERVICE_BOARDS[svc]; if(!c || !cfg || !cfg.projectTasks || !canEditBoard()) return;
  const types = Object.keys(cfg.projectTasks);
  if(!types.length){ toast(`No project types set up — add them in Departments → ${svc}`); return; }
  const preview = ty => `<ol style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:3px;font-size:12.5px;">${(cfg.projectTasks[ty]||[]).map(x=>`<li>${esc(x.name)} <span class="faint mono">· ${x.days}d</span></li>`).join('')}</ol><div class="faint" style="font-size:11.5px;margin-top:6px;">${(cfg.projectTasks[ty]||[]).length} tasks · about ${(cfg.projectTasks[ty]||[]).reduce((n,x)=>n+x.days,0)} working days</div>`;
  showModal(`
    <div class="modal-head"><h3>Start ${esc(svc.toLowerCase())} project</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-start-project"><div class="modal-body">
      <div class="subtext" style="font-size:12px;margin-top:0;">${esc(c.name)}</div>
      <div class="field-row">
        <div><label class="field-label" for="pj-type">Type</label><select class="field-input" id="pj-type" name="type">${types.map(t=>`<option>${esc(t)}</option>`).join('')}</select></div>
        <div><label class="field-label" for="pj-name">Project name</label><input class="field-input" id="pj-name" name="name" required value="${esc(types[0])}"></div>
      </div>
      <div class="field-row">
        <div><label class="field-label" for="pj-start">Start date</label><input class="field-input" type="date" id="pj-start" name="start" required value="${TODAY}"></div>
        <div><label class="field-label" for="pj-owner">Assign to</label><select class="field-input" id="pj-owner" name="owner">${activeEmployees().map(e=>`<option ${e.name===deptDefaultOwner(svc)?'selected':''}>${esc(e.name)}</option>`).join('')}</select></div>
      </div>
      <div><span class="field-label">Tasks created in Open</span><div id="pj-preview">${preview(types[0])}</div><div class="subtext">Dated back-to-back from the start date; each gets its allowed working days. Set the lists in Departments → ${esc(svc)}.</div></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Create tasks</button></div></div>
    </form>`);
  let named = false;
  document.getElementById("pj-name").addEventListener("input", ()=>{ named = true; });
  document.getElementById("pj-type").addEventListener("change", e=>{ document.getElementById("pj-preview").innerHTML = preview(e.target.value); if(!named) document.getElementById("pj-name").value = e.target.value; });
  document.getElementById("f-start-project").addEventListener("submit", async e=>{
    e.preventDefault(); const f = new FormData(e.target), type = f.get("type"), start = f.get("start");
    const body = {service:svc, type, name:(f.get("name")||"").trim(), start, assignedTo:f.get("owner")||"", tasks:projectSchedule(svc, type, start)};
    try{
      const r = await apiJson(`/api/crm/clients/${clientId}/board-projects`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
      r.tasks.forEach(putTask); const s2 = bState(clientId, svc); s2.project = r.projectId; s2.month = start.slice(0,7);
      toast("Project tasks created"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't create the project"); }
  });
}

function clientDetailPage(id){
  const c = clientById(id);
  const billingType = c.billingType || "Prepaid";
  const boardFilter = clientTaskBoardMonthFilter[id] || "All";
  const boardTasks = tasksOf(id).filter(t=>!t.service && !isTaskArchived(t));
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
      ${hidePayment ? '' : leadAdvanceBannerHTML(c)}
      ${hidePayment ? '' : `
      <div class="section-label">Payment</div>
      ${isUnbilledPostpaid ? `<div class="banner"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div><b>Post-paid client.</b> Amount is only finalized and invoiced once the work is complete.</div></div>` : `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">Billed</div><div class="kpi-value mono" style="font-size:19px;">${inr(billed)}</div><div class="kpi-sub">${clientInvoices.length} invoice${clientInvoices.length===1?'':'s'}</div></div>
        <div class="kpi-card"><div class="kpi-label">Received</div><div class="kpi-value mono pos" style="font-size:19px;">${inr(received)}</div></div>
        <div class="kpi-card hero"><div class="kpi-label">Pending</div><div class="kpi-value mono ${pending>0?'warn':''}" style="font-size:19px;">${inr(pending)}</div><div class="kpi-sub">${pending>0?'awaiting payment':'fully settled'}</div></div>
      </div>
      ${clientInvoices.length?`<div class="table-wrap"><table class="data"><thead><tr><th>Invoice</th><th>Issued</th><th class="num">Amount</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
        <tbody>${clientInvoices.map(i=>{ const st=invoiceStatus(i), bal=invoiceBalance(i), pendingAmt=invoicePendingAmount(i); return `<tr><td class="mono">${esc(i.invoiceNo)}</td><td class="muted">${fmtDateShort(i.issued)}</td><td class="num mono">${inr(invoiceTotal(i))}</td><td class="num mono">${bal>0?inr(bal):'<span class="faint">—</span>'}</td><td>${pill(st,invStatusKind(st))}${pendingAmt>0?' '+pill(inr(pendingAmt)+' pending Finance','warn'):''}</td><td><div style="display:flex;gap:6px;flex-wrap:wrap;">${bal>0?`<button class="btn btn-sm ghost" onclick="openSubmitInvoicePayment('${i.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-coins"/></svg>Log payment</button>`:''}<button class="btn btn-sm ghost" onclick="downloadInvoice('${i.id}')" title="Download invoice"><svg class="icon" style="width:12px;height:12px"><use href="#i-download"/></svg>Download</button>${(i.payments||[]).length?`<button class="btn btn-sm ghost" onclick="openInvoicePayments('${i.id}')" title="Payment receipts"><svg class="icon" style="width:12px;height:12px"><use href="#i-receipt"/></svg>Payments</button>`:''}${canEditInvoices()?`<button class="btn btn-sm ghost" onclick="openEditInvoice('${i.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button>`:''}</div></td></tr>`; }).join("")}</tbody>
      </table></div>`:`<div class="empty">No invoice raised for this client yet.</div>`}`}`}
      ${(()=>{ const cq = quotes.filter(q=>q.clientId===id); return cq.length ? `<div class="section-label">Quotes</div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Quote</th><th>Services</th><th class="num">Total</th>${hidePayment?'':'<th class="num">Paid</th>'}<th>Status</th></tr></thead>
        <tbody>${cq.map(q=>`<tr><td style="font-weight:700;">${esc(q.title)}</td><td class="muted">${q.items.map(i=>esc(i.dept)).join(', ')}</td><td class="num mono">${inr(quoteTotal(q))}</td>${hidePayment?'':`<td class="num mono">${quoteApprovedPaid(q)>0?inr(quoteApprovedPaid(q)):'<span class="faint">—</span>'}</td>`}<td>${pill(q.status,quoteStatusKind(q.status))}</td></tr>`).join("")}</tbody>
      </table></div>` : ''; })()}
      ${clientServicesHTML(c)}
      ${clientCollabHTML(c)}
      ${clientFeedbackSectionHTML(c)}
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
        <div><label class="field-label">Status</label><select class="field-input" name="status" ${canArchiveClients()?'':'disabled title="Only Sales or Admin can change a client\'s status"'}>${["Active","Paused","Churned"].map(s=>`<option ${s===c.status?'selected':''}>${s}</option>`).join('')}</select></div>
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
        status:canArchiveClients()?TITLECASE_TO_API(f.get("status")):undefined, billingType:TITLECASE_TO_API(f.get("billingType")),
      })});
      await loadClients();
      toast("Client updated"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't update client"); }
  });
}
// Daily ad-performance tracker, shared by DesGro's own Meta Ads page and (later) per-client ad logs.
// `rows` are API rows ({id,date,spend,leads,purchases,revenue,cpl,cpa,roas}); opts: logFn (adds the
// "Log" button), editFn (name of a function taking the row id), deleteKind (openConfirmDelete kind).
function adDailyTrackerHTML(rows, label, opts){
  opts = opts || {};
  const t = rows.reduce((a,m)=>({spend:a.spend+m.spend, leads:a.leads+m.leads, purchases:a.purchases+m.purchases, revenue:a.revenue+m.revenue}), {spend:0,leads:0,purchases:0,revenue:0});
  const avgCpl = t.leads>0 ? t.spend/t.leads : null;
  const avgCpa = t.purchases>0 ? t.spend/t.purchases : null;
  const roas = t.spend>0 ? t.revenue/t.spend : null;
  const inr = n => adMoney(n, opts.currency);
  const dash = v => v==null ? '—' : inr(v);
  const hasActions = !!(opts.editFn || opts.deleteKind);
  return `
  <div class="section-label" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
    <div>${esc(label)}<span class="faint" style="font-weight:600;font-size:11.5px;text-transform:none;letter-spacing:0;"> · ${rows.length} day${rows.length===1?'':'s'} shown</span></div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
    ${opts.currencyFn?`<select class="field-input" style="width:auto;padding:4px 8px;font-size:12px;" title="Currency these numbers are in" onchange="${opts.currencyFn}(this.value)">${AD_CURRENCIES.map(k=>`<option value="${k}" ${k===(opts.currency||'INR')?'selected':''}>${esc(AD_CURRENCY_NAMES[k])}</option>`).join('')}</select>`:''}
    ${opts.logFn?`<button class="btn btn-sm ghost" onclick="${opts.logFn}"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Log today's numbers</button>`:''}
    </div>
  </div>
  ${rows.length ? `
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-label">Total Spend</div><div class="kpi-value mono" style="font-size:18px;">${inr(t.spend)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Leads / Purchases</div><div class="kpi-value mono" style="font-size:18px;">${t.leads} / ${t.purchases}</div></div>
    <div class="kpi-card"><div class="kpi-label">Avg. CPL / CPA</div><div class="kpi-value mono" style="font-size:18px;">${dash(avgCpl)} / ${dash(avgCpa)}</div></div>
    <div class="kpi-card hero"><div class="kpi-label">ROAS</div><div class="kpi-value mono" style="font-size:18px;">${roas!=null?roas.toFixed(2)+'x':'—'}</div><div class="kpi-sub">${inr(t.revenue)} revenue tracked</div></div>
  </div>
  <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th class="num">Spend</th><th class="num">Leads</th><th class="num">Purchases</th><th class="num">Revenue</th><th class="num">CPL</th><th class="num">CPA</th><th class="num">ROAS</th>${hasActions?'<th></th>':''}</tr></thead>
    <tbody>${rows.map(m=>`<tr><td class="muted">${fmtDateShort(m.date)}</td><td class="num mono">${inr(m.spend)}</td><td class="num mono">${m.leads}</td><td class="num mono">${m.purchases}</td><td class="num mono">${inr(m.revenue)}</td><td class="num mono">${dash(m.cpl)}</td><td class="num mono">${dash(m.cpa)}</td><td class="num mono">${m.roas!=null?m.roas.toFixed(2)+'x':'—'}</td>${hasActions?`<td><div style="display:flex;gap:6px;justify-content:flex-end;">${opts.editFn?`<button class="btn btn-sm ghost" onclick="${opts.editFn}('${esc(m.id)}')" title="Edit this day"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg></button>`:''}${opts.deleteKind?`<button class="btn btn-sm ghost" onclick="openConfirmDelete('${opts.deleteKind}','${esc(m.id)}')" title="Delete this day"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button>`:''}</div></td>`:''}</tr>`).join('')}</tbody>
  </table></div>` : `<div class="empty">No ad performance logged yet.</div>`}`;
}
// Log (or correct) one day's numbers. Saving a date that already exists updates it. `save` receives the
// validated payload and POSTs it; the server re-validates everything (no future dates, no negatives).
function logAdMetricModal(forLabel, existing, save, currency){
  const d = new Date(); const local = new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
  const v = existing || {date:local, spend:'', revenue:'', leads:'', purchases:''};
  showModal(`
    <div class="modal-head"><h3>${existing?'Edit':'Log'} ad performance</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-log-ad-metric"><div class="modal-body">
      <div class="subtext" style="font-size:12px;margin-top:0;">${esc(forLabel)}</div>
      <div><label class="field-label">Date</label><input class="field-input" type="date" name="date" value="${esc(v.date)}" max="${local}" required ${existing?'readonly':''}></div>
      ${existing?'':'<div class="subtext" style="font-size:12px;">Logging a date that already has numbers replaces them.</div>'}
      <div class="field-row">
        <div><label class="field-label">Spend${currency&&currency!=='INR'?` (${esc(currency)})`:''}</label><input class="field-input" type="number" step="0.01" min="0" name="spend" value="${esc(v.spend)}" required></div>
        <div><label class="field-label">Revenue${currency&&currency!=='INR'?` (${esc(currency)})`:''}</label><input class="field-input" type="number" step="0.01" min="0" name="revenue" value="${esc(v.revenue)}" placeholder="Optional — saved as 0"></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">Leads</label><input class="field-input" type="number" step="1" min="0" name="leads" value="${esc(v.leads)}" placeholder="Optional — saved as 0"></div>
        <div><label class="field-label">Purchases</label><input class="field-input" type="number" step="1" min="0" name="purchases" value="${esc(v.purchases)}" placeholder="Optional — saved as 0"></div>
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save</button></div></div>
    </form>`);
  document.getElementById("f-log-ad-metric").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const payload = { date:f.get("date"), spend:Number(f.get("spend")), revenue:Number(f.get("revenue")), leads:Number(f.get("leads")), purchases:Number(f.get("purchases")) };
    try{ await save(payload); toast("Ad performance saved"); closeModal(); render(); }
    catch(err){ toast(err.message || "Couldn't save ad performance"); }
  });
}
function openLogOwnAdMetric(id){
  const existing = id ? ownAdMetrics.find(m=>m.id===id) : null;
  logAdMetricModal("DesGro Media — own Meta Ads", existing, async payload=>{
    await apiJson("/api/content/own-ad-metrics", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) });
    await loadOwnAdMetrics();
  });
}
// Daily "ad numbers not logged" reminders (Admin only). Sending is automatic once the server has it switched on;
// this panel only SHOWS what would be sent — it never sends anything.
function adRemindersPanelHTML(){
  if(!(currentUser && currentUser.isAdmin)) return '';
  return `<div class="panel"><div class="modal-body">
    <div class="section-label" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
      <div>Daily update reminders</div>
      <button class="btn btn-sm ghost" onclick="openAdReminderPreview()"><svg class="icon" style="width:12px;height:12px"><use href="#i-bell"/></svg>Check status &amp; preview</button>
    </div>
    <div class="subtext">If a Performance Marketing client's numbers (or our own) aren't logged for a working day, the account manager — and for our own ads, the Performance Marketing team — gets one email each morning listing what's missing. Admins are copied once it's been missing 3 working days in a row.</div>
  </div></div>`;
}
async function openAdReminderPreview(){
  let d;
  try{ d = await apiJson("/api/ad-reminders/preview"); }catch(err){ toast(err.message || "Couldn't load preview"); return; }
  const dl = a => a.map(x=>fmtDateShort(x)).join(', ');
  showModal(`
    <div class="modal-head"><h3>Daily update reminders</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        ${pill(d.enabled?'Switched on':'Switched off', d.enabled?'pos':'neg')}
        ${pill(d.emailConfigured?'Email configured':'Email NOT configured', d.emailConfigured?'pos':'warn')}
        <span class="subtext">Runs daily at ${String(d.hourIst).padStart(2,'0')}:00 IST${d.lastRun?` · last run ${fmtDateShort(d.lastRun.date)}`:' · has not run yet'}</span>
      </div>
      ${d.enabled && d.emailConfigured ? '' : `<div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${!d.enabled?'Reminders are <b>off</b> on this server, so nothing is being sent.':''} ${!d.emailConfigured?'Email isn’t configured here, so nothing could be sent.':''} The list below is only a preview.</div></div>`}
      <div class="section-label">Would be sent today · checking ${d.checkedDates.length?dl(d.checkedDates.slice().reverse()):'no working days yet'}</div>
      ${d.digests.length ? d.digests.map(g=>`
        <div style="padding:9px 11px;border:1px solid var(--line);border-radius:7px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><b style="font-size:12.5px;">${esc(g.to.name)}</b><span class="subtext mono">${esc(g.to.email)}</span></div>
          ${g.fallback?`<div class="subtext">Sent to Admin because no account manager / team member was found.</div>`:''}
          ${g.items.map(i=>`<div style="font-size:12.5px;margin-top:4px;">${esc(i.label)} <span class="faint">— ${dl(i.dates)}${i.streak>=d.escalateAfter?` · ${i.streak} days in a row`:''}</span></div>`).join('')}
          ${g.cc.length?`<div class="subtext" style="margin-top:4px;">Admin copied: ${g.cc.map(esc).join(', ')}</div>`:''}
        </div>`).join('') : `<div class="empty">Nothing is missing — nobody would be emailed.</div>`}
    </div>
    <div class="modal-foot"><div></div><button type="button" class="btn ghost" onclick="closeModal()">Close</button></div>`, true);
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
  ${metaAdsScorePanelHTML()}
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-label">Active Campaigns</div><div class="kpi-value mono">${activeCount}<span style="font-size:14px;color:var(--ink-soft);font-family:Manrope;"> / ${rows.length}</span></div></div>
    <div class="kpi-card"><div class="kpi-label">Total Spend</div><div class="kpi-value mono" style="font-size:20px;">${inr(totals.spend)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Avg. CTR</div><div class="kpi-value mono" style="font-size:20px;">${avgCtr.toFixed(2)}%</div></div>
    <div class="kpi-card hero"><div class="kpi-label">Cost per Lead</div><div class="kpi-value mono" style="font-size:20px;">${inr(avgCpl)}</div><div class="kpi-sub">${totals.leads} leads total</div></div>
  </div>
  <div class="panel"><div class="modal-body">
    ${adDailyTrackerHTML(ownAdMetrics.slice(0,30), "Daily Tracking", {logFn:"openLogOwnAdMetric()", editFn:"openLogOwnAdMetric", deleteKind:"ownAdMetric"})}
  </div></div>
  ${adRemindersPanelHTML()}
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
  const activeCount = pipelineSource.filter(l=>!['Won','Lost'].includes(leadStage(l))).length;
  const wonCount = pipelineSource.filter(l=>leadStage(l)==='Won').length;
  const lostCount = pipelineSource.filter(l=>leadStage(l)==='Lost').length;
  const winRate = (wonCount+lostCount) ? Math.round(wonCount/(wonCount+lostCount)*100) : null;
  const paidWaiting = pipelineSource.filter(l=>!l.convertedClientId && l.paidTotal>0);
  return `
  <div class="toolbar"><div class="filter-group"><span class="filter-label">Show</span><select class="select-sm" onchange="setLeadsMonthFilter(this.value)">${dateFilterOptions(pipelineSource.map(l=>l.createdDate), leadsMonthFilter)}</select></div><div style="display:flex;gap:6px;"><button class="btn btn-sm ${leadsView==='board'?'primary':'ghost'}" onclick="setLeadsView('board')"><svg class="icon" style="width:12px;height:12px"><use href="#i-board"/></svg>Flow</button><button class="btn btn-sm ${leadsView==='list'?'primary':'ghost'}" onclick="setLeadsView('list')">List</button></div><button class="btn primary" onclick="openAddLead()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New lead</button></div>
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-label">In Pipeline</div><div class="kpi-value mono">${activeCount}</div><div class="kpi-sub">not yet won or lost</div></div>
    <div class="kpi-card"><div class="kpi-label">Converted to Client</div><div class="kpi-value mono pos">${wonCount}</div></div>
    <div class="kpi-card"><div class="kpi-label">Paid, Not Yet Client</div><div class="kpi-value mono ${paidWaiting.length?'warn':''}">${paidWaiting.length}</div><div class="kpi-sub">${paidWaiting.length?inr(paidWaiting.reduce((a,l)=>a+l.paidTotal,0))+' recorded':'nothing pending'}</div></div>
    <div class="kpi-card hero"><div class="kpi-label">Win Rate</div><div class="kpi-value mono">${winRate==null?'—':winRate+'%'}</div><div class="kpi-sub">${wonCount} won · ${lostCount} lost</div></div>
  </div>
  <div class="banner muted" style="align-items:center;"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div style="flex:1;"><b>Conversion rule.</b> Convert a lead to a client any time — paid or not. Once a lead's recorded payments reach <b>${inr(leadConversionThreshold)}</b> it converts automatically. Payments are only recorded here; they reach the books through Finance when an invoice is raised.</div>${isAdminUser()?`<button class="btn btn-sm ghost" onclick="openLeadThresholdSetting()">Change</button>`:''}</div>
  ${openLeads.length ? `
  <div class="panel">
    <div class="panel-head">
      <div><h3>Open leads</h3><div class="sub">Came in through the website / Instagram / WhatsApp form — not yet assigned to anyone${canClaim?'. Claim one to start working it.':'.'}</div></div>
      ${pill(openLeads.length+" open", "warn")}
    </div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Lead</th><th>Phone</th><th>Service Interested</th><th>Source</th><th>Created</th><th></th></tr></thead>
      <tbody>${openLeads.map(l=>`<tr><td><div style="font-weight:700;font-size:13px;">${esc(l.name)}</div>${l.email?`<div class="subtext">${esc(l.email)}</div>`:''}${l.notes?`<div class="subtext" style="white-space:normal;max-width:320px;">“${esc(l.notes)}”</div>`:''}</td><td class="muted mono" style="font-size:12px;white-space:nowrap;">${l.phone?`<a href="tel:${esc(l.phone)}" style="color:inherit;text-decoration:none;">${esc(l.phone)}</a>`:"—"}</td><td class="muted">${esc(l.serviceInterested)}</td><td class="muted">${esc(l.source)}</td><td class="muted">${fmtDate(l.createdDate)}</td><td>${leadOwnerActionsCell(l)}</td></tr>`).join("")}</tbody>
    </table></div>
  </div>` : ''}
  ${leadsView==='board' ? `
  <div class="panel">
    <div class="panel-head"><div><h3>${isSalesViewer?'My lead flow':'Lead flow'}</h3><div class="sub">${filtered.length} of ${pipelineSource.length}${dateFilterSuffix(leadsMonthFilter)} · move each lead along as it progresses</div></div></div>
    <div class="board-scroll" style="padding:0 14px 14px;"><div class="board">${LEAD_STAGES.map(st=>{ const inSt = sorted.filter(l=>leadStage(l)===st); return `<div class="col"><div class="col-head"><span class="name">${st}</span><span class="count">${inSt.length}</span></div><div class="col-cards">${inSt.map(leadCardHTML).join('') || '<div class="empty" style="padding:14px 6px;">None</div>'}</div></div>`; }).join('')}</div></div>
  </div>
  ` : `
  <div class="panel">
    <div class="panel-head"><h3>${isSalesViewer?'My leads':'Lead pipeline'}</h3><div class="sub">${filtered.length} of ${pipelineSource.length}${dateFilterSuffix(leadsMonthFilter)}</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Lead</th><th>Phone</th><th>Service Interested</th><th>Source</th><th>Stage</th>${isSalesViewer?'':'<th>Lead Owner</th>'}<th>Created</th><th></th></tr></thead>
      <tbody>${sorted.map(l=>`<tr><td><div style="font-weight:700;font-size:13px;">${esc(l.name)}</div>${l.email?`<div class="subtext">${esc(l.email)}</div>`:''}${l.notes?`<div class="subtext" style="white-space:normal;max-width:320px;">“${esc(l.notes)}”</div>`:''}</td><td class="muted mono" style="font-size:12px;white-space:nowrap;">${l.phone?`<a href="tel:${esc(l.phone)}" style="color:inherit;text-decoration:none;">${esc(l.phone)}</a>`:"—"}</td><td class="muted">${esc(l.serviceInterested)}</td><td class="muted">${esc(l.source)}</td><td>${leadStageControl(l)}${leadStage(l)==='Lost'&&l.lostReason?`<div class="subtext">${esc(l.lostReason)}</div>`:''}</td>${isSalesViewer?'':`<td>${l.leadOwner ? `<span class="muted">${esc(l.leadOwner)}</span>` : pill("Open","warn")}</td>`}<td class="muted">${fmtDate(l.createdDate)}</td><td>${leadOwnerActionsCell(l)}</td></tr>`).join("") || `<tr><td colspan="${isSalesViewer?7:8}"><div class="empty">${isSalesViewer?'No leads assigned to you yet — claim one above.':'No leads match this filter.'}</div></td></tr>`}</tbody>
    </table></div>
  </div>
  `}`;
}
// Any Sales caller can claim an unowned lead for themselves — Leadership/Admin
// don't get the claim button since they're not the ones working the pipeline.
function leadOwnerActionsCell(l){
  const canClaim = !l.leadOwner && currentUser && isSalesRole(currentUser);
  const assignBtn = canClaim ? `<button class="btn btn-sm primary" onclick="assignLeadToMe('${l.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Assign to me</button>` : '';
  // Admin / Sales Head (the ones who see the whole team) hand an unassigned lead to any Sales member.
  const canAssignOthers = !l.leadOwner && currentUser && (currentUser.isAdmin || (currentUser.roles||[]).includes('SALES_HEAD'));
  const assignPick = canAssignOthers ? `<select class="select-sm" onchange="assignLeadTo('${l.id}', this.value)" title="Assign to a Sales team member"><option value="">Assign to…</option>${salesTeamOptions()}</select>` : '';
  // Mirrors deleteLead() server-side: Admin / Sales Head delete any; a Sales rep only their own claimed leads.
  const canDelete = currentUser && (currentUser.isAdmin || (currentUser.roles||[]).includes('SALES_HEAD') || (l.leadOwner && l.leadOwner===currentUser.name));
  const delBtn = canDelete ? `<button class="btn btn-sm ghost" onclick="openConfirmDelete('lead','${l.id}')" title="Delete lead"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button>` : '';
  const flowBtns = (!l.convertedClientId && canWorkLead(l)) ? `${leadStage(l)!=='Lost'?`<button class="btn btn-sm ghost" onclick="openRecordLeadPayment('${l.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-coins"/></svg>Payment</button>`:''}<button class="btn btn-sm primary" onclick="openConvertLead('${l.id}')">Convert</button>` : '';
  const clientBtn = l.convertedClientId ? `<button class="btn btn-sm ghost" onclick="goToClient('${l.convertedClientId}')">Open client</button>` : '';
  return `<div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;">${assignPick}${assignBtn}${flowBtns}${clientBtn}<button class="btn btn-sm ghost" onclick="openEditLead('${l.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button>${delBtn}</div>`;
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
async function assignLeadTo(id, owner){
  if(!owner) return;
  const l = marketingLeads.find(x=>x.id===id);
  if(!l || l.leadOwner) return;
  try{
    await apiJson(`/api/crm/leads/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ leadOwner: owner }) });
    await loadLeads();
    toast(l.name+" assigned to "+owner); render();
  }catch(err){ toast(err.message || "Couldn't assign lead"); render(); }
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
  const clientOpts = liveClients().map(c=>`<option value="client:${c.id}" ${selectedValue==='client:'+c.id?'selected':''}>${esc(c.name)}</option>`).join('');
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
      <tbody>${sorted.map(q=>{ const party=quoteParty(q); return `<tr><td style="font-weight:700;">${esc(q.title)}</td><td class="muted">${party.kind==='client'?clientLink(party.id):esc(party.name)}${party.kind==='lead'?' '+pill('Lead','blue'):''}</td><td class="muted">${q.items.map(i=>esc(i.dept)).join(', ')}</td><td class="num mono">${inr(quoteTotal(q))}</td><td class="muted">${esc(q.createdBy)}</td><td>${pill(q.status,quoteStatusKind(q.status))}</td><td>${quoteActionsMkt(q)}</td></tr>`; }).join("") || `<tr><td colspan="7"><div class="empty">${isSalesViewer?'No quotes prepared by you yet.':'No quotes that month.'}</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
// Every client is expected to carry at least one invoice unless they're Postpaid — a Postpaid
// client's amount is only finalized once the service is complete, so it's fine (and expected) to
// have none yet. Anything Prepaid (the default) with zero invoices raised against it is a gap
// Sales/Finance should close.
function clientsMissingInvoice(){
  return liveClients().filter(c => (c.billingType||"Prepaid")!=="Postpaid" && !invoices.some(i=>i.clientId===c.id));
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
      <tbody>${sorted.map(i=>{ const st=invoiceStatus(i), bal=invoiceBalance(i), pendingAmt=invoicePendingAmount(i); return `<tr><td class="mono">${esc(i.invoiceNo)}</td><td class="muted">${clientLink(i.clientId)}</td><td class="muted">${(i.items||[]).map(it=>esc(it.dept)).join(', ')||'<span class="faint">—</span>'}</td><td class="num mono">${inr(invoiceTotal(i))}</td><td class="num mono">${bal>0?inr(bal):'<span class="faint">—</span>'}</td><td>${pill(st,invStatusKind(st))}</td><td><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">${bal>0?`<button class="btn btn-sm" onclick="openSubmitInvoicePayment('${i.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-coins"/></svg>Log payment</button>`:''}${pendingAmt>0?`<span class="faint" style="font-size:11.5px;">${inr(pendingAmt)} awaiting Finance</span>`:''}<button class="btn btn-sm ghost" onclick="downloadInvoice('${i.id}')" title="Download invoice"><svg class="icon" style="width:12px;height:12px"><use href="#i-download"/></svg>Download</button>${(i.payments||[]).length?`<button class="btn btn-sm ghost" onclick="openInvoicePayments('${i.id}')" title="Payment receipts"><svg class="icon" style="width:12px;height:12px"><use href="#i-receipt"/></svg>Payments</button>`:''}${canEditInvoices()?`<button class="btn btn-sm ghost" onclick="openEditInvoice('${i.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button>${(i.payments||[]).length?'':`<button class="btn btn-sm ghost" onclick="openConfirmDelete('invoice','${i.id}')" title="Delete"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button>`}`:''}</div></td></tr>`; }).join("") || `<tr><td colspan="7"><div class="empty">No invoices yet.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
// Read-only preview of the number the server will assign (serial is final only on save).
function quoteTitlePreview(){
  const p = new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",day:"2-digit",month:"2-digit",year:"2-digit"}).formatToParts(new Date());
  const g = t=>p.find(x=>x.type===t).value;
  return `QT/${g("day")}${g("month")}${g("year")}/<span class="faint">NNN</span>`;
}
function openAddQuote(){
  showModal(`
    <div class="modal-head"><h3>New quote</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-add-quote"><div class="modal-body">
      <div><label class="field-label">For</label><select class="field-input" name="party">${partyOptions()}</select></div>
      <div class="section-label">Services — priced independently, total shown below</div>
      ${quoteServiceRows([])}
      <div id="quote-total-indicator" style="font-size:13px;padding-top:2px;">Total: <b>₹0</b></div>
      <div><label class="field-label">Quote number</label><div class="field-input" style="background:var(--surface-sunk);color:var(--ink-soft);">${quoteTitlePreview()}</div><div class="subtext">Assigned automatically when you save.</div></div>
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
      await apiJson("/api/crm/quotes", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ clientId: kind==='client'?partyId:undefined, leadId: kind==='lead'?partyId:undefined, items }) });
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
      <div><label class="field-label">Quote number</label><div class="field-input" style="background:var(--surface-sunk);color:var(--ink-soft);">${esc(q.title)}</div></div>
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
      await apiJson(`/api/crm/quotes/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ clientId: kind==='client'?partyId:null, leadId: kind==='lead'?partyId:null, items }) });
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
      <div><label class="field-label">Phone</label><input class="field-input" name="phone" required placeholder="9847xxxxxx"></div>
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
      await apiJson("/api/crm/leads", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ name:f.get("name"), phone:f.get("phone"), source:f.get("source"), serviceInterested:f.get("serviceInterested"), leadOwner:f.get("leadOwner")||undefined }) });
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
        <div><label class="field-label">Email</label><input class="field-input" type="email" name="email" placeholder="Optional" value="${esc(l.email)}"></div>
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
      await apiJson(`/api/crm/leads/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ name:f.get("name"), phone:f.get("phone"), email:f.get("email")||undefined, source:f.get("source"), serviceInterested:f.get("serviceInterested"), leadOwner:f.get("leadOwner")||null }) });
      await loadLeads();
      toast("Lead updated"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't update lead"); }
  });
}

/* ===================== CLIENTS OVERVIEW ===================== */
function clientsOverview(){
  const activeClients = liveClients().filter(c=>c.status==="Active").length;
  const openTasks = clientTasks.filter(t=>t.status!=="Done");
  const overdueTasks = clientTasks.filter(t=>t.status!=="Done" && t.due && t.due<TODAY);
  const doneTasks = clientTasks.filter(t=>t.status==="Done").length;
  const deptCounts = SERVICE_DEPARTMENTS.map(d=>({d,n:liveClients().filter(c=>c.status==="Active" && c.services.includes(d)).length})).filter(x=>x.n>0).sort((a,b)=>b.n-a.n);
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
      <div class="panel-body">${overdueTasks.length ? overdueTasks.map(t=>`<div class="feed-item row-click" onclick="openClientDetail('${t.clientId}')"><div class="feed-dot" style="background:var(--neg);"></div><div><div class="feed-text"><strong>${esc(t.title)}</strong></div><div class="feed-time">${taskClientName(t)} · ${esc(t.assignedTo)} · due ${fmtDateShort(t.due)}</div></div></div>`).join("") : '<div class="empty">Nothing overdue.</div>'}</div>
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
  const clientTag = showClient ? `<span class="tag type">${esc(taskClientName(t))}</span>` : '';
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
  const tasks = tasksOf(clientId).filter(t=>!t.service && !isTaskArchived(t)).filter(t=>matchesDateFilter(t.due, boardFilter));
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
  const tasks = clientTasks.filter(t=>isMyTask(t) && !isTaskArchived(t));
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
  const scopeTasks = clientId ? tasksOf(clientId) : clientTasks.filter(t=>isMyTask(t));
  const list = scopeTasks.filter(isTaskArchived).sort((a,b)=>(b.doneDate||'').localeCompare(a.doneDate||''));
  showModal(`
    <div class="modal-head"><h3>Completed tasks archive</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      ${list.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Task</th>${clientId?'':'<th>Client</th>'}<th>Assignee</th><th>Completed</th></tr></thead>
        <tbody>${list.map(t=>`<tr><td style="font-weight:700;">${esc(t.title)}</td>${clientId?'':`<td class="muted">${clientLink(t.clientId, t.clientName)}</td>`}<td class="muted">${esc(t.assignedTo)}</td><td class="muted">${fmtDateShort(t.doneDate)}</td></tr>`).join("")}</tbody>
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
    const r = await apiJson(`/api/crm/tasks/${taskId}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ status: TASK_STATUS_TO_API[stage] }) });
    if(t.service && r.task) t.stage = r.task.stage;   // a service-board card lands in the matching column
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
        <div><label class="field-label">Assignee</label><select class="field-input" name="assignedTo">${assignableEmployees().map(e=>`<option value="${esc(e.name)}" data-uid="${e.userId||''}">${esc(e.name)}${e.userId?'':' (no login)'}</option>`).join('')}</select></div>
        <div><label class="field-label">Due</label><input class="field-input" type="date" name="due" value="${TODAY}" required></div>
      </div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Add task</button></div></div>
    </form>`);
  document.getElementById("f-add-task").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      await apiJson(`/api/crm/clients/${clientId}/tasks`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ title:f.get("title"), ...assigneeFromSelect(e.target.elements.assignedTo), dueAt:f.get("due") }) });
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
        <div><label class="field-label">Assignee</label><select class="field-input" name="assignedTo">${assignableEmployees().map(e=>`<option value="${esc(e.name)}" data-uid="${e.userId||''}" ${(e.userId?e.userId===t.assigneeUserId:e.name===t.assignedTo)?'selected':''}>${esc(e.name)}${e.userId?'':' (no login)'}</option>`).join('')}</select></div>
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
      await apiJson(`/api/crm/tasks/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ title:f.get("title"), ...assigneeFromSelect(e.target.elements.assignedTo), dueAt:f.get("due"), status:TASK_STATUS_TO_API[f.get("status")], revisions:Number(f.get("revisions"))||0 }) });
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
  if(kind==='clientMeeting'){
    const [cid, mid] = id.split('|'); const m = ((clientCollab[cid]||{}).meetings||[]).find(x=>x.id===mid); if(!m) return {label:"this meeting log", warning:fallback};
    return {label:"this meeting log", warning:`${fmtDate(m.date)} — ${esc(m.attendees)}. The notes are permanently removed. This can't be undone.`};
  }
  if(kind==='serviceMeeting'){
    const [cid, mid] = id.split('|'); const m = ((clientCollab[cid]||{}).serviceMeetings||[]).find(x=>x.id===mid); if(!m) return {label:"this meeting", warning:fallback};
    return {label:"this meeting", warning:`${fmtDate(m.date)}${m.time?' · '+esc(m.time):''} — ${esc(m.service)}. ${m.status==='HELD'?'The minutes are permanently removed. ':''}This can't be undone.`};
  }
  if(kind==='boardCard'){
    const t = clientTasks.find(x=>x.id===id); if(!t) return {label:"this card", warning:fallback};
    return {label:"this card", warning:`${esc(t.title)}. It's removed from the board and from the assignee's My Tasks. This can't be undone.`};
  }
  if(kind==='boardProject'){
    const pid = id.split('|')[1]; const n = clientTasks.filter(t=>t.project===pid).length, nm = (clientTasks.find(t=>t.project===pid)||{}).projectName||'this project';
    return {label:"this project", warning:`${esc(nm)} and all ${n} of its tasks are removed, including any already done. This can't be undone.`};
  }
  if(kind==='clientAdMetric'){
    const [cid, mid] = id.split('|'); const m = ((clientCollab[cid]||{}).adMetrics||[]).find(x=>x.id===mid); if(!m) return {label:"this entry", warning:fallback};
    return {label:"this day's ad numbers", warning:`${fmtDateShort(m.date)} — ${adMoney(m.spend, (clientCollab[cid]||{}).adCurrency)} spend, ${m.leads} leads. This only removes the tracking entry; you can log the day again afterwards.`};
  }
  if(kind==='ownAdMetric'){
    const m = ownAdMetrics.find(x=>x.id===id); if(!m) return {label:"this entry", warning:fallback};
    return {label:"this day's ad numbers", warning:`${fmtDateShort(m.date)} — ${inr(m.spend)} spend, ${m.leads} leads. This only removes the tracking entry; you can log the day again afterwards.`};
  }
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
  if(kind==='journal'){
    const j = journalEntries.find(x=>x.id===id); if(!j) return {label:"this journal entry", warning:fallback};
    const bankLine = j.lines.some(l=>l.account && l.account.startsWith('bank:'));
    return {label:"this journal entry", warning:`"${esc(j.memo)}" — ${inr(journalEntryTotal(j))}.${bankLine?' Its bank ledger posting is removed with it, so the account balance updates too.':''} This can't be undone.`};
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
    let w = `${esc(payableAccountLabel(p))} — ${esc(p.payee)}.`;
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
    clientMeeting: (()=>{ const [cid, mid] = id.split('|'); return { url:`/api/crm/clients/${cid}/meetings/${mid}`, reload: ()=>loadClientCollab(cid), label:"Meeting log" }; })(),
    payable: { url:`/api/finance/payables/${id}`, reload: loadPayables, label:"Payable" },
    expense: { url:`/api/finance/expenses/${id}`, reload: loadExpenses, label:"Expense" },
    bank: { url:`/api/finance/bank-accounts/${id}`, reload: loadBankAccounts, label:"Bank account" },
    // A bank-line journal entry also posted a real ledger row, so its removal changes account
    // balances — refresh banks and the finance reports (which read off the ledger) alongside it.
    serviceMeeting: (()=>{ const [cid, mid] = id.split('|'); return { url:`/api/crm/clients/${cid}/service-meetings/${mid}`, reload: async ()=>{ await Promise.all([loadClientCollab(cid), loadCalendarClientMeetings()]); }, label:"Meeting" }; })(),
    boardCard: { url:`/api/crm/board-cards/${id}`, reload: loadTasks, label:"Card" },
    boardProject: (()=>{ const [cid, pid, svc] = id.split('|'); return { url:`/api/crm/clients/${cid}/board-projects/${pid}`, reload: async ()=>{ await loadTasks(); bState(cid, svc).project = 'All'; }, label:"Project" }; })(),
    clientAdMetric: (()=>{ const [cid, mid] = id.split('|'); return { url:`/api/crm/clients/${cid}/ad-metrics/${mid}`, reload: ()=>loadClientCollab(cid), label:"Ad performance entry" }; })(),
    ownAdMetric: { url:`/api/content/own-ad-metrics/${id}`, reload: loadOwnAdMetrics, label:"Ad performance entry" },
    journal: { url:`/api/finance/journal/${id}`, reload: async ()=>{ await Promise.all([loadJournalEntries(), loadBankAccounts()]); await refreshFinanceReports(); }, label:"Journal entry" },
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
// Month + sales person filters, applied server-side to both tabs. Month is the approval date on
// Approved and the date Sales pushed it on Pending. A Sales login is pinned to their own name.
let receiptsMonth = "All", receiptsSalesPerson = "";
let receiptsSummary = null;
const receiptsPinnedToSelf = () => !isFinanceAdminUser(currentUser);
function receiptsQuery(){
  const q = new URLSearchParams();
  if(receiptsMonth!=="All") q.set("month", receiptsMonth);
  if(!receiptsPinnedToSelf() && receiptsSalesPerson) q.set("salesPerson", receiptsSalesPerson);
  return q;
}
async function loadReceiptsSummary(){
  receiptsSummary = await apiJson("/api/finance/payment-receipts/summary?"+receiptsQuery());
}
async function loadApprovedReceipts(){
  const q = receiptsQuery(); q.set("limit","200");
  const [d] = await Promise.all([apiJson("/api/finance/payment-receipts/approved?"+q), loadReceiptsSummary()]);
  approvedReceipts = d.receipts; approvedReceiptsTotal = d.total; approvedReceiptsLoaded = true;
}
function setReceiptsFilter(kind, v){
  if(kind==='month') receiptsMonth = v; else receiptsSalesPerson = v;
  loadApprovedReceipts().then(render).catch(err=>toast(err.message || "Couldn't load payments"));
}
const receiptsFiltered = () => receiptsMonth!=="All" || (!receiptsPinnedToSelf() && !!receiptsSalesPerson);
// Pending rows live in the invoices/quotes already loaded; the server says which of them match.
function filteredPendingPayments(){
  const rows = pendingSalesPayments();
  if(!receiptsFiltered() || !receiptsSummary) return rows;
  const ids = new Set(receiptsSummary.pending.ids);
  return rows.filter(r=>ids.has(r.p.id));
}
function receiptsToolbar(){
  const s = receiptsSummary;
  const months = new Set((s?s.months:[]).concat(receiptsMonth!=="All"?[receiptsMonth]:[]));
  const monthOpts = `<option value="All" ${receiptsMonth==='All'?'selected':''}>All time</option>` + [...months].sort().reverse().map(m=>`<option value="${m}" ${m===receiptsMonth?'selected':''}>${monthLabel(m)}</option>`).join('');
  const people = s?s.salesPersons:[];
  const spOpts = `<option value="" ${!receiptsSalesPerson?'selected':''}>All sales persons</option>` + people.map(n=>`<option value="${esc(n)}" ${n===receiptsSalesPerson?'selected':''}>${esc(n)}</option>`).join('')
    + (s&&s.hasDirect?`<option value="__direct__" ${receiptsSalesPerson==='__direct__'?'selected':''}>Direct (no sales person)</option>`:'');
  return `<div class="toolbar"><div class="filter-group"><span class="filter-label">Show</span><select class="select-sm" onchange="setReceiptsFilter('month',this.value)">${monthOpts}</select></div>`
    + (receiptsPinnedToSelf() ? '' : `<div class="filter-group"><span class="filter-label">Sales person</span><select class="select-sm" onchange="setReceiptsFilter('sp',this.value)">${spOpts}</select></div>`)
    + `</div>`;
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
    <div class="panel-head"><h3>Approved payments</h3><div class="sub">${approvedReceiptsLoaded?`${approvedReceiptsTotal} confirmed payment${approvedReceiptsTotal===1?'':'s'}${receiptsSummary?` · ${inr(receiptsSummary.approved.amount)} received · ${inr(receiptsSummary.approved.commission)} commission`:''}${receiptsFiltered()?' (filtered)':''}${approvedReceiptsTotal>rows.length?' · showing the latest '+rows.length:''}`:'Loading…'}</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Source</th><th>For</th><th class="num">Amount</th><th>Pushed by</th><th>Approved by</th><th>Bank account</th><th>Commission</th><th></th></tr></thead>
      <tbody>${rows.length?rows.map(r=>`<tr>
        <td class="mono">${esc(r.invoiceNo)}<div class="subtext">${r.source==='Direct'?pill('Direct','neutral'):r.source==='Quote'?'Quote '+esc(r.quoteCode||''):'Invoice'}</div></td>
        <td class="muted">${clientLink(r.clientId, r.clientName)}</td>
        <td class="num mono">${inr(r.amount)}<div class="subtext" style="white-space:nowrap;">paid ${fmtDateShort(isoDate(r.paidDate))}</div></td>
        <td class="muted">${r.pushedBy?esc(r.pushedBy):dash}</td>
        <td class="muted">${r.approvedBy?esc(r.approvedBy):dash}<div class="subtext" style="white-space:nowrap;">${fmtDateTime(r.approvedAt)}</div></td>
        <td class="muted">${esc(r.bankAccount.name)}</td>
        <td>${r.commissions.length?r.commissions.map(c=>`<div class="mono">${inr(c.amount)} <span class="faint" style="font-family:inherit;">→ ${esc(c.salesPerson||'—')}</span></div>`).join(''):dash}</td>
        <td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm ghost" onclick="openEditApprovedReceipt('${r.paymentId}')" title="Edit payment"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button><button class="btn btn-sm ghost" onclick="openReverseApprovedReceipt('${r.paymentId}')" title="Delete payment"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button></div></td>
      </tr>`).join(""):`<tr><td colspan="8"><div class="empty">${approvedReceiptsLoaded?(receiptsFiltered()?'No confirmed payments match these filters.':'No payments confirmed yet.'):'Loading…'}</div></td></tr>`}</tbody>
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
  const pending = filteredPendingPayments().length;
  const tab = (id, label, n) => `<button class="chip ${receiptsTab===id?'active':''}" onclick="setReceiptsTab('${id}')">${label}${n?' · '+n:''}</button>`;
  return `<div class="filter-group" style="margin-bottom:14px;">${tab('pending','Pending',pending)}${tab('approved','Approved',approvedReceiptsLoaded?approvedReceiptsTotal:0)}</div>`
    + receiptsToolbar()
    + (receiptsTab==='approved' ? acctApprovedReceipts() : acctPendingReceipts() + leadAdvancesPanelHTML());
}
function acctPendingReceipts(){
  const rows = filteredPendingPayments();
  return `
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Sales pushes a payment here the moment a client pays — even a partial one — whether it's against a quote or an existing invoice. Confirm which account the money actually landed in before approving; that's what creates (or tops up) the invoice and posts it to the bank ledger. Approving a lead's first payment also turns them into a client automatically.</div></div>
  <div class="panel">
    <div class="panel-head"><h3>Payment Receipts</h3><div class="sub">${rows.length} payment${rows.length===1?'':'s'} pushed by Sales, awaiting confirmation${receiptsSummary&&receiptsFiltered()?` · ${inr(receiptsSummary.pending.amount)} (filtered)`:''}</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Source</th><th>For</th><th class="num">This payment</th><th class="num">Total</th><th>Pushed by</th><th>Sales note</th><th></th></tr></thead>
      <tbody>${rows.length?rows.map(r=>{
        if(r.source==='quote'){
          const party = quoteParty(r.q);
          return `<tr><td class="mono">${esc(r.q.title)}<div class="subtext">Quote</div></td><td class="muted">${party.kind==='client'?clientLink(party.id):esc(party.name)}${party.kind==='lead'?' '+pill('Lead','blue'):''}</td><td class="num mono">${inr(r.p.amount)}</td><td class="num mono">${inr(quoteTotal(r.q))}</td><td class="muted">${esc(r.q.createdBy)}</td><td class="muted">${esc(r.p.note||'—')} · ${fmtDateShort(r.p.date)}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm primary" onclick="openApproveQuotePayment('${r.q.id}',${r.idx})"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Approve</button><button class="btn btn-sm ghost" onclick="openConfirmDeleteReceipt('quote','${r.q.id}','${r.p.id}')" title="Discard"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button></div></td></tr>`;
        }
        return `<tr><td class="mono">${esc(r.inv.invoiceNo)}<div class="subtext">Invoice</div></td><td class="muted">${clientLink(r.inv.clientId)}</td><td class="num mono">${inr(r.p.amount)}</td><td class="num mono">${inr(invoiceBalance(r.inv))}</td><td class="muted">${esc(r.p.salesPerson||'—')}</td><td class="muted">${esc(r.p.note||'—')} · ${fmtDateShort(r.p.date)}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm primary" onclick="openApproveInvoicePayment('${r.inv.id}',${r.idx})"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Approve</button><button class="btn btn-sm ghost" onclick="openConfirmDeleteReceipt('invoice','${r.inv.id}','${r.p.id}')" title="Discard"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button></div></td></tr>`;
      }).join(""):`<tr><td colspan="7"><div class="empty">${receiptsFiltered()?'No pending payments match these filters.':'Nothing waiting on Finance right now.'}</div></td></tr>`}</tbody>
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
      <tbody>${filtered.slice().sort((a,b)=>b.issued.localeCompare(a.issued)).map(i=>{ const st=invoiceStatus(i), bal=invoiceBalance(i); return `<tr><td class="mono">${i.invoiceNo}</td><td class="muted">${clientLink(i.clientId)}</td><td class="muted">${fmtDateShort(i.issued)}</td><td class="muted">${fmtDateShort(i.due)}</td><td class="num mono">${inr(invoiceTotal(i))}</td><td class="num mono">${bal>0?inr(bal):'<span class="faint">—</span>'}</td><td>${pill(st,invStatusKind(st))}</td><td><div style="display:flex;gap:6px;flex-wrap:wrap;">${bal>0?`<button class="btn btn-sm" onclick="openRecordInvoicePayment('${i.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Record payment</button>`:`<span class="faint" style="font-size:11.5px;">paid in full</span>`}<button class="btn btn-sm ghost" onclick="openEditInvoice('${i.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button><button class="btn btn-sm ghost" onclick="downloadInvoice('${i.id}')" title="Download invoice"><svg class="icon" style="width:12px;height:12px"><use href="#i-download"/></svg>Download</button>${(i.payments||[]).length?`<button class="btn btn-sm ghost" onclick="openInvoicePayments('${i.id}')" title="Payment receipts"><svg class="icon" style="width:12px;height:12px"><use href="#i-receipt"/></svg>Payments</button>`:`<button class="btn btn-sm ghost" onclick="openConfirmDelete('invoice','${i.id}')" title="Delete"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button>`}</div></td></tr>`; }).join("") || `<tr><td colspan="8"><div class="empty">No invoices${invoicesMonthFilter==='All'?'':' for this range'}.</div></td></tr>`}</tbody>
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
      <tbody>${filtered.slice().sort((a,b)=>CLEAR_ORDER.indexOf(a.category)-CLEAR_ORDER.indexOf(b.category)).map(p=>{ const st=payableStatus(p), bal=payableBalance(p); return `<tr><td><span class="tag type">${esc(payableAccountLabel(p))}</span></td><td class="muted">${p.accountName ? esc((chartOfAccounts.find(c=>c._dbId===p.accountId)||{}).parent || "—") : "Unassigned — edit to fix"}</td><td class="muted">${esc(p.payee)}</td><td class="muted">${fmtDateShort(p.due)}</td><td class="num mono">${inr(p.amount)}</td><td class="num mono">${bal>0?inr(bal):'<span class="faint">—</span>'}</td><td>${pill(st,payableStatusKind(st))}</td><td><div style="display:flex;gap:6px;">${bal>0?`<button class="btn btn-sm" onclick="openRecordPayablePayment('${p.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Record payment</button>`:`<span class="faint" style="font-size:11.5px;">paid in full</span>`}<button class="btn btn-sm ghost" onclick="openEditPayable('${p.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button>${(p.payments||[]).length?'':`<button class="btn btn-sm ghost" onclick="openConfirmDelete('payable','${p.id}')" title="Delete"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button>`}</div></td></tr>`; }).join("") || `<tr><td colspan="7"><div class="empty">No payables${payablesMonthFilter==='All'?'':' for this range'}.</div></td></tr>`}</tbody>
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
// Groups one sales person's commission payables by month (the YYYY-MM of
// each entry's due date), newest first, with a subtotal per month — powers
// the monthly breakdown shown when a name is expanded in "Commission by
// sales person" below (Accounts > Commissions), answering "how much did
// they earn each month" without needing the page's own month filter.
function groupCommissionsByMonth(mine){
  const byMonth = {};
  mine.forEach(p=>{ const m = p.due && p.due.length>=7 ? p.due.slice(0,7) : 'Unknown'; (byMonth[m] ||= []).push(p); });
  return Object.keys(byMonth).sort().reverse().map(m=>({
    label: m==='Unknown' ? 'Unknown date' : monthLabel(m),
    items: byMonth[m].slice().sort((a,b)=>b.due.localeCompare(a.due)),
    total: byMonth[m].reduce((s,p)=>s+p.amount,0),
  }));
}

// ---- Expanded sales person panel (Accounts > Commissions): everything shown here is server-computed by
// GET /api/finance/commissions/person; this only lays it out.
function commissionDetailHTML(i, r){
  const d = commissionDetails[r.salesPerson];
  if(!d) return '<div class="faint" style="padding:8px 0;">Loading…</div>';
  const S = d.summary, T = S.target;
  const pct = T.target>0 ? Math.min(100, Math.round(T.sales/T.target*100)) : 0;
  const periodLabel = d.period==='all' ? 'All time' : d.period==='today' ? 'Today' : monthLabel(d.period);
  const card = (label, val, sub, cls) => `<div class="kpi-card" style="box-shadow:none;"><div class="kpi-label">${label}</div><div class="kpi-value mono ${cls||''}" style="font-size:18px;">${val}</div>${sub?`<div class="kpi-sub">${sub}</div>`:''}</div>`;
  const filteredMonth = /^\d{4}-\d{2}$/.test(d.period);
  const monthBalance = r.balance;
  const settleBar = (filteredMonth && monthBalance>0.005) ? `<div style="display:flex;justify-content:flex-end;margin:0 0 10px;"><button class="btn btn-sm" onclick="openSettleCommission(${i},'${d.period}')" title="Pay only the entries received in ${esc(periodLabel)}, oldest first"><svg class="icon" style="width:11px;height:11px"><use href="#i-check"/></svg>Settle this month only · ${inr(monthBalance)}</button></div>` : '';
  const cards = `<div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:10px;">
    ${card('Total sales ('+esc(periodLabel)+')', inr(S.totalSales), 'approved payments, by date received')}
    ${card('Deals', S.deals, 'invoices with a payment')}
    ${card('Clients', S.clients)}
    ${card('Commission earned', inr(S.earned))}
    ${card('Commission paid', inr(S.paid), '', 'pos')}
    ${card('Commission balance', inr(S.balance), '', S.balance>0?'warn':'')}
    ${card('Client pending', inr(S.clientPending), 'still unpaid by clients', S.clientPending>0?'warn':'')}
  </div>
  <div style="margin-bottom:14px;"><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px;"><span><b>${monthLabel(T.month)}</b> target progress</span><span class="mono">${inr(T.sales)} of ${inr(T.target)} · bonus earned so far ${inr(T.bonusEarned)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${pct}%;${T.sales>=T.target?'background:var(--pos);':''}"></div></div></div>`;

  const txByClient = {}; d.months.forEach(m=>m.rows.forEach(t=>{ if(t.clientId) (txByClient[t.clientId] ||= []).push(t); }));
  const statusKind2 = st => st==='Fully paid'?'pos':st==='Partially paid'?'warn':'neg';
  const clientsHTML = d.clients.length ? `<div class="section-label" style="margin:6px 0;">Clients &amp; sales</div><div class="table-wrap"><table class="data"><thead><tr><th>Client</th><th>What was sold</th><th>Reference</th><th class="num">Deal value</th><th class="num">Received</th><th class="num">Pending</th><th class="num">Commission</th><th>Status</th></tr></thead><tbody>${d.clients.map((c,ci)=>{ const key='cl-'+i+'-'+ci, txs=txByClient[c.clientId]||[]; return `<tr style="cursor:pointer;" onclick="toggleCommissionClient('${key}')"><td>${clientLink(c.clientId, c.clientName)}</td><td class="muted">${c.services.map(esc).join(', ')||'—'}${c.titles.length?`<div class="subtext">${c.titles.map(esc).join(', ')}</div>`:''}</td><td class="mono muted">${c.references.map(esc).join('<br>')}</td><td class="num mono">${inr(c.totalDeal)}</td><td class="num mono">${inr(c.received)}</td><td class="num mono ${c.pending>0?'warn':'faint'}">${c.pending>0?inr(c.pending):'—'}</td><td class="num mono">${inr(c.commissionEarned)}</td><td>${pill(c.status, statusKind2(c.status))}</td></tr>
      <tr id="${key}" style="display:none;"><td colspan="8" style="background:var(--surface);padding:6px 14px;">${txs.length?txs.map(t=>`<div class="report-detail-row"><span>${fmtDateShort(t.date)} · ${esc(t.reference||'—')} · ${t.kind}</span><span class="amt mono">${t.paymentAmount!=null?inr(t.paymentAmount)+' → ':''}${inr(t.earned)}</span></div>`).join(''):'<span class="faint">No payments in this period.</span>'}</td></tr>`; }).join('')}</tbody></table></div>` : '';

  const monthsHTML = d.months.length ? `<div class="section-label" style="margin:14px 0 6px;">Transactions by month</div>` + d.months.map(m=>{
    const key = r.salesPerson+'|'+m.month;
    const open = key in commissionMonthOpen ? commissionMonthOpen[key] : m.month===TODAY.slice(0,7);
    return `<details class="report-details" ${open?'open':''} ontoggle="onCommissionMonthToggle(this,'${esc(key).replace(/'/g,"&#39;")}')" style="border:1px solid var(--line);border-radius:8px;margin-bottom:8px;">
      <summary class="report-line" style="padding:8px 12px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;"><span class="name" style="font-weight:700;"><svg class="icon chev" style="width:10px;height:10px"><use href="#i-chevron-right"/></svg>${esc(monthLabel(m.month))}</span>
        <span class="mono" style="font-size:12.5px;">Received ${inr(m.paymentsReceived)} · Earned ${inr(m.earned)} · Paid ${inr(m.paid)} · Balance <b style="${m.balance>0?'color:var(--neg);':''}">${inr(m.balance)}</b>${m.bonusEarned>0?` · Target bonus ${inr(m.bonusEarned)}`:''}</span></summary>
      <div class="table-wrap"><table class="data"><thead><tr><th>Date received</th><th>Client</th><th>Reference</th><th class="num">Payment</th><th class="num">%</th><th class="num">Commission</th><th class="num">Paid</th><th class="num">Balance</th><th></th></tr></thead><tbody>${m.rows.map(t=>`<tr>
        <td class="muted">${fmtDateShort(t.date)}</td>
        <td>${t.kind==='Target bonus'?pill('Target bonus','blue'):(t.clientId?clientLink(t.clientId,t.clientName):'<span class="faint">—</span>')}</td>
        <td class="mono muted">${t.kind==='Target bonus'?'<span class="faint">monthly target</span>':esc(t.reference||'—')}</td>
        <td class="num mono ${t.kind==='Target bonus'?'faint':''}">${t.paymentAmount!=null?inr(t.paymentAmount):'—'}</td>
        <td class="num mono" title="${t.kind==='Target bonus'?'% of sales past target':t.edited?'Amount was edited or split after it was created':''}">${t.rate!=null?t.rate+'%':'—'}${t.edited?' <span class="faint">(edited)</span>':''}${t.kind==='Target bonus'&&t.rate!=null?'<div class="subtext">of excess</div>':''}</td>
        <td class="num mono">${inr(t.earned)}</td>
        <td class="num mono muted">${t.paid>0?inr(t.paid):'—'}</td>
        <td class="num mono" style="${t.balance>0?'color:var(--neg);font-weight:700;':''}">${t.balance>0?inr(t.balance):'—'}</td>
        <td><div style="display:flex;gap:6px;justify-content:flex-end;">${t.balance>0?`<button class="btn btn-sm" onclick="openRecordPayablePayment('${t.payableId}')"><svg class="icon" style="width:11px;height:11px"><use href="#i-check"/></svg>Record payment</button>`:`<span class="faint" style="font-size:11px;">paid in full</span>`}${t.hasPayments?'':`<button class="btn btn-sm ghost" onclick="openConfirmDelete('payable','${t.payableId}')" title="Delete"><svg class="icon" style="width:11px;height:11px"><use href="#i-x"/></svg></button>`}</div></td></tr>`).join('')}</tbody></table></div></details>`;
  }).join('') : `<div class="empty">No commissions in this period</div>`;

  return settleBar + cards + clientsHTML + monthsHTML;
}
function salesLeaderboardRows(){
  const commission = commissionRowsByPerson();
  return assignableEmployees().filter(e=>e.dept==='Sales').map(e=>{
    const row = commission.find(r=>r.name===e.name);
    return { emp:e, name:e.name, earned: row?row.earned:0, clients: liveClients().filter(c=>c.salesPerson===e.name).length };
  }).sort((a,b)=>b.earned-a.earned);
}
function acctCommissions(){
  // Everything numeric comes from commissionSummary (server-computed). "Commission by sales person"
  // follows the Show filter; the KPI cards use the summary's all-time totals; "Previous balance" is the
  // still-unpaid balance of entries due before the selected period.
  const rows = commissionSummary.rows;
  const filtered = commissionsMonthFilter!=="All";
  const totalEarned = commissionSummary.totals.earned, totalPaid = commissionSummary.totals.paid, totalBalance = commissionSummary.totals.balance;
  const salesCount = commissionSummary.totals.salesPersons, entryCount = commissionSummary.totals.entries;
  // Only for the "Monthly sales target & bonus" table below, which is pinned to the current month
  // (targets/bonuses are a this-month standing, not something that has a history) — not the filter.
  const pendingWithdrawals = commissionWithdrawals.filter(w=>w.status==="Pending").slice().sort((a,b)=>a.requested.localeCompare(b.requested));
  const decidedWithdrawals = commissionWithdrawals.filter(w=>w.status!=="Pending").slice().sort((a,b)=>b.requested.localeCompare(a.requested)).slice(0,8);
  return `
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Sales earns ${Math.round(SALES_COMMISSION_RATE*100)}% commission on every payment Finance approves — from a quote or from a client's existing invoice. Each entry below is its own Commission payable, so it pays out in full or in installments exactly like any other payable — record a partial payment here and the balance updates immediately. A sales person can also request a withdrawal themselves — approve it below to pay it out.</div></div>
  <div class="kpi-grid">
    <div class="kpi-card hero"><div class="kpi-label">Outstanding Commission</div><div class="kpi-value mono ${totalBalance>0?'warn':''}">${inr(totalBalance)}</div><div class="kpi-sub">across ${salesCount} sales person${salesCount===1?'':'s'}</div></div>
    <div class="kpi-card"><div class="kpi-label">Paid Out</div><div class="kpi-value mono pos">${inr(totalPaid)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Total Earned</div><div class="kpi-value mono">${inr(totalEarned)}</div><div class="kpi-sub">${entryCount} commission entr${entryCount===1?'y':'ies'}, all time</div></div>
  </div>
  <div class="panel">
    <div class="panel-head" style="display:flex;align-items:center;justify-content:space-between;">
      <div><h3>Monthly sales target &amp; bonus</h3><div class="sub">Counted by the date the client's money was received · Target ${inr(salesPolicy.monthlyTarget)} · ${Math.round(salesPolicy.bonusRate*100)}% bonus on sales past target, on top of the ${Math.round(SALES_COMMISSION_RATE*100)}% flat commission above</div></div>
      <div style="display:flex;gap:8px;align-items:center;"><div class="filter-group"><span class="filter-label">Month</span><select class="select-sm" onchange="setTargetsMonth(this.value)">${targetsMonthOptions()}</select></div>
      <button class="btn btn-sm ghost" onclick="openEditSalesPolicy()"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button></div>
    </div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Sales Person</th><th class="num">${targetsMonth===TODAY.slice(0,7)?'This month':'Received in '+monthLabel(targetsMonth)}</th><th class="num">Target</th><th></th><th class="num">Commission (${Math.round(SALES_COMMISSION_RATE*100)}%)</th><th class="num">Bonus earned</th></tr></thead>
      <tbody>${(targetsView||salesTargets).length ? (targetsView||salesTargets).map(r=>{
        const pct = r.target>0 ? Math.min(100, Math.round(r.monthlySales/r.target*100)) : 0;
        const over = r.monthlySales>=r.target;
        // Server-computed: commission entries dated in this month (the month the money was received).
        const commissionThisMonth = r.commissionThisMonth||0;
        return `<tr>
          <td>${esc(r.salesPerson)}</td>
          <td class="num mono">${inr(r.monthlySales)}</td>
          <td class="num mono muted">${inr(r.target)}</td>
          <td style="min-width:120px;"><div class="bar-track"><div class="bar-fill" style="width:${pct}%;${over?'background:var(--pos);':''}"></div></div></td>
          <td class="num mono ${commissionThisMonth>0?'pos':''}">${commissionThisMonth>0?inr(commissionThisMonth):'—'}</td>
          <td class="num mono ${r.bonusEarnedThisMonth>0?'pos':''}">${r.bonusEarnedThisMonth>0?inr(r.bonusEarnedThisMonth):'—'}</td>
        </tr>`;
      }).join('') : `<tr><td colspan="6"><div class="empty">No Sales-dept employees yet.</div></td></tr>`}</tbody>
    </table></div>
  </div>
  ${pendingWithdrawals.length || decidedWithdrawals.length ? `<div class="panel">
    <div class="panel-head"><h3>Withdrawal requests</h3><div class="sub">${pendingWithdrawals.length} pending</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Sales Person</th><th class="num">Amount</th><th>Requested</th><th>Note</th><th>Status</th><th></th></tr></thead>
      <tbody>${pendingWithdrawals.map(w=>`<tr><td>${esc(w.salesPerson)}</td><td class="num mono">${inr(w.amount)}</td><td class="muted">${fmtDate(w.requested)}</td><td class="muted">${esc(w.note||'—')}</td><td>${pill(w.status,statusKind(w.status))}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm" onclick="openApproveCommissionWithdrawal('${w.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Approve</button><button class="btn btn-sm danger" onclick="decideCommissionWithdrawalReject('${w.id}')">Reject</button></div></td></tr>`).join('')}${decidedWithdrawals.map(w=>`<tr><td>${esc(w.salesPerson)}</td><td class="num mono">${inr(w.amount)}</td><td class="muted">${fmtDate(w.requested)}</td><td class="muted">${esc(w.note||'—')}</td><td>${pill(w.status,statusKind(w.status))}</td><td></td></tr>`).join('')}</tbody>
    </table></div>
  </div>`:''}
  <div class="panel">
    <div class="panel-head" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;"><div><h3>Commission by sales person</h3><div class="sub">Expand a name to see every entry and record a payment — partial payments are fine, or settle everything at once${filtered?` · showing ${commissionsMonthFilter==='Today'?'today':monthLabel(commissionsMonthFilter)}, plus what was carried over from before`:''}</div></div><div class="filter-group"><span class="filter-label">Show</span><select class="select-sm" onchange="setCommissionsMonthFilter(this.value)">${dateFilterOptions(commissionSummary.months.map(m=>m+'-01').concat(TODAY), commissionsMonthFilter)}</select></div></div>
    <div class="table-wrap"><table class="data" style="min-width:980px;"><thead><tr><th colspan="7" style="padding:0;"><div class="com-grid com-head"><span>Sales Person</span><span class="m">Previous balance</span><span class="m">Earned</span><span class="m">Paid</span><span class="m">Balance</span><span>Status</span><span>Action</span></div></th></tr></thead>
      <tbody>${rows.length?rows.map((r,i)=>{ const owed = r.totalOutstanding; const statusLabel = owed<=0.005?'Settled':(r.paid>0?'Partially Paid':'Outstanding'); return `<tr><td colspan="7" style="padding:0;border-bottom:1px solid var(--line);">
        <details class="report-details" ${openCommissionPeople.has(r.salesPerson)?'open':''} ontoggle="onCommissionToggle(this,${i})">
          <summary class="report-line com-grid">
            <span class="name" style="font-weight:700;color:var(--ink);"><svg class="icon chev" style="width:10px;height:10px"><use href="#i-chevron-right"/></svg>${esc(r.salesPerson)}</span>
            <span class="m mono ${r.previousBalance>0?'warn':'muted'}" title="Unpaid from entries due before this period">${r.previousBalance>0?inr(r.previousBalance):'—'}</span>
            <span class="m mono">${inr(r.earned)}</span>
            <span class="m mono muted">${r.paid>0?inr(r.paid):'—'}</span>
            <span class="m mono" style="${r.balance>0?'color:var(--neg);font-weight:700;':''}">${r.balance>0?inr(r.balance):'—'}</span>
            <span>${pill(statusLabel, owed<=0.005?'pos':'warn')}</span>
            <span style="display:flex;justify-content:flex-start;">${owed>0.005?`<button class="btn btn-sm primary" style="white-space:nowrap;" onclick="event.preventDefault();event.stopPropagation();openSettleCommission(${i})" title="Pay every outstanding entry for ${esc(r.salesPerson)} across ALL months, or an amount applied oldest first"><svg class="icon" style="width:11px;height:11px"><use href="#i-check"/></svg>Settle all · ${inr(owed)} (all months)</button>`:''}</span>
          </summary>
          <div class="report-detail" style="padding:12px 14px;">${commissionDetailHTML(i, r)}</div>
        </details>
      </td></tr>`; }).join(""):`<tr><td colspan="7"><div class="empty">No commission earned${commissionsMonthFilter==='All'?' yet':' for this range'}.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
function openSettleCommission(i, month){
  const r = commissionSummary.rows[i]; if(!r) return;
  const owed = month ? r.balance : r.totalOutstanding;
  showModal(`
    <div class="modal-head"><h3>Settle commission — ${esc(r.salesPerson)}${month?' · '+esc(monthLabel(month)):''}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-settle-commission"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div><b>${inr(owed)}</b> outstanding ${month?'in '+esc(monthLabel(month))+' only':'across all months of'} ${esc(r.salesPerson)}'s commission entries. Each entry gets its own payment record, <b>oldest due date first</b>. Enter less than the full amount to pay only the oldest entries that it covers.</div></div>
      <div class="field-row">
        <div><label class="field-label">Amount to pay (₹)</label><input class="field-input" type="number" name="amount" min="1" max="${owed}" step="0.01" required value="${owed}"></div>
        <div><label class="field-label">Date</label><input class="field-input" type="date" name="date" value="${TODAY}" required></div>
      </div>
      <div><label class="field-label">Paid from account</label><select class="field-input" name="accountId">${bankAccounts.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Settle</button></div></div>
    </form>`);
  document.getElementById("f-settle-commission").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const amount = Number(f.get("amount"));
    const body = { salesPerson:r.salesPerson, accountId:f.get("accountId"), paidDate:f.get("date") };
    if(month) body.month = month;
    if(amount < owed - 0.005) body.amount = amount;   // omitted = settle everything
    try{
      const res = await apiJson("/api/finance/commissions/settle", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
      await Promise.all([loadPayables(), loadBankAccounts()]);
      toast(`Paid ${inr(res.paid)} to ${r.salesPerson} across ${res.payments.length} entr${res.payments.length===1?'y':'ies'}` + (res.remaining>0 ? ` — ${inr(res.remaining)} still outstanding` : ' — fully settled'));
      closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't settle commission"); }
  });
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
      <div><label class="field-label">Client</label><select class="field-input" name="clientId">${clients.filter(c=>!c.archivedAt||c.id===preselectClientId).map(c=>`<option value="${c.id}" ${preselectClientId===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="section-label">Services — priced independently, total shown below</div>
      ${quoteServiceRows([])}
      <div id="quote-total-indicator" style="font-size:13px;padding-top:2px;">Total: <b>₹0</b></div>
      <div class="field-row">
        <div><label class="field-label">Invoice No.</label><div class="field-input" style="color:var(--ink-soft);background:var(--surface-sunk);cursor:default;">Auto-generated on save</div></div>
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
      await apiJson("/api/finance/invoices", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ clientId:f.get("clientId"), issuedAt:f.get("issued"), dueAt:f.get("due"), items }) });
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
      <div><label class="field-label">Client</label><select class="field-input" name="clientId">${clients.filter(c=>!c.archivedAt||c.id===i.clientId).map(c=>`<option value="${c.id}" ${c.id===i.clientId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="section-label">Services — priced independently, total shown below</div>
      ${quoteServiceRows(i.items||[])}
      <div id="quote-total-indicator" style="font-size:13px;padding-top:2px;">Total: <b>${inr(invoiceTotal(i))}</b></div>
      <div class="field-row">
        <div><label class="field-label">Invoice No.</label><div class="field-input mono" style="color:var(--ink-soft);background:var(--surface-sunk);cursor:default;">${esc(i.invoiceNo)}</div></div>
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
      await apiJson(`/api/finance/invoices/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ clientId:f.get("clientId"), items, issuedAt:f.get("issued"), dueAt:f.get("due") }) });
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
// Live-updates the ₹ preview next to the Commission % input in the approve-payment
// modals as Finance edits the rate — amount comes off the input's own data-amount.
function updateCommissionPreview(el){
  const out = document.getElementById('commission-amount-preview');
  if(!out) return;
  const amount = Number(el.dataset.amount)||0;
  const rate = Number(el.value)||0;
  out.textContent = inr(Math.round(amount*rate/100));
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
        <div><label class="field-label">Date received</label><input class="field-input" type="date" name="date" value="${payment.date||TODAY}" max="${TODAY}" required><div class="sub" style="margin-top:4px;">The day the money reached the account — decides which month the sale, bonus and commission count in.</div></div>
      </div>
      ${payment.salesPerson?`<div class="field-row">
        <div><label class="field-label">Salesperson</label><input class="field-input" value="${esc(payment.salesPerson)}" disabled></div>
        <div><label class="field-label">Commission %</label><input class="field-input" type="number" name="commissionRate" min="0" max="100" step="0.1" value="${SALES_COMMISSION_RATE*100}" data-amount="${payment.amount}" oninput="updateCommissionPreview(this)" required><div class="sub" style="margin-top:4px;"><span id="commission-amount-preview">${inr(Math.round(payment.amount*SALES_COMMISSION_RATE))}</span> commission</div></div>
      </div>`:''}
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Approve &amp; confirm</button></div></div>
    </form>`);
  document.getElementById("f-approve-invoice-payment").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const accountId = f.get("accountId"), date = f.get("date");
    const commissionRate = payment.salesPerson ? Number(f.get("commissionRate")) : undefined;
    try{
      await apiJson(`/api/finance/invoices/${id}/pending-payments/${payment.id}/approve`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ accountId, date, commissionRate }) });
      await Promise.all([loadInvoices(), loadBankAccounts(), loadPayables(), refreshFinanceReports(), loadApprovedReceipts()]);
      const updated = invoices.find(x=>x.id===id);
      const commissionAmount = payment.salesPerson ? Math.round(payment.amount * (commissionRate/100)) : 0;
      toast("Payment approved"+(invoiceBalance(updated)<=0?" — invoice fully settled":" — "+inr(invoiceBalance(updated))+" still outstanding")+(commissionAmount>0?" · "+inr(commissionAmount)+" commission credited to "+payment.salesPerson:"")); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't approve payment"); }
  });
}
function openAddPayable(){
  showModal(`
    <div class="modal-head"><h3>New payable</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-add-payable"><div class="modal-body">
      <div class="field-row">
        <div><label class="field-label">Category</label><select class="field-input" name="accountId">${payableCoaOptions()}</select></div>
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
      await apiJson("/api/finance/payables", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ accountId:f.get("accountId"), payee:f.get("payee"), amount:Number(f.get("amount")), dueAt:f.get("due") }) });
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
        <div><label class="field-label">Category</label><select class="field-input" name="accountId">${p.accountId?'':'<option value="" selected disabled>Choose an account…</option>'}${payableCoaOptions(p.accountId)}</select></div>
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
      await apiJson(`/api/finance/payables/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ accountId:f.get("accountId")||undefined, payee:f.get("payee"), amount, dueAt:f.get("due") }) });
      await loadPayables();
      toast("Payable updated"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't update payable"); }
  });
}
function openRecordPayablePayment(id){
  const p = payables.find(x=>x.id===id);
  const bal = payableBalance(p);
  showModal(`
    <div class="modal-head"><h3>Record payment — ${esc(payableAccountLabel(p))}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-pay-payable"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${esc(p.payee)} · ${inr(p.amount)} owed · <b>${inr(bal)}</b> balance remaining · liability account <b>${esc(payableAccountLabel(p))}</b></div></div>
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
      <tbody>${rest.map(q=>{ const party=quoteParty(q); const paid=quoteApprovedPaid(q); return `<tr><td>${esc(q.title)}</td><td class="muted">${party.kind==='client'?clientLink(party.id):esc(party.name)}${party.kind==='lead'?' '+pill('Lead','blue'):''}</td><td class="muted">${q.items.map(i=>esc(i.dept)).join(', ')}</td><td class="num mono">${inr(quoteTotal(q))}</td><td class="num mono">${paid>0?inr(paid):'<span class="faint">—</span>'}</td><td>${pill(q.status,quoteStatusKind(q.status))}${q.status==='Invoiced'&&q.invoiceId?` <span class="faint" style="font-size:11px;">${esc(q.invoiceId)}</span>`:''}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm ghost" onclick="downloadQuote('${q.id}')" title="Download quote"><svg class="icon" style="width:12px;height:12px"><use href="#i-download"/></svg>Download</button>${q.invoiceId?'':`<button class="btn btn-sm ghost" onclick="openConfirmDelete('quote','${q.id}')" title="Delete"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button>`}</div></td></tr>`; }).join("") || `<tr><td colspan="7"><div class="empty">No quotes that month.</div></td></tr>`}</tbody>
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
        <div><label class="field-label">Date received</label><input class="field-input" type="date" name="date" value="${payment.date||TODAY}" max="${TODAY}" required><div class="sub" style="margin-top:4px;">The day the money reached the account — decides which month the sale, bonus and commission count in.</div></div>
      </div>
      ${q.createdBy?`<div class="field-row">
        <div><label class="field-label">Salesperson</label><input class="field-input" value="${esc(q.createdBy)}" disabled></div>
        <div><label class="field-label">Commission %</label><input class="field-input" type="number" name="commissionRate" min="0" max="100" step="0.1" value="${SALES_COMMISSION_RATE*100}" data-amount="${payment.amount}" oninput="updateCommissionPreview(this)" required><div class="sub" style="margin-top:4px;"><span id="commission-amount-preview">${inr(Math.round(payment.amount*SALES_COMMISSION_RATE))}</span> commission</div></div>
      </div>`:''}
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Approve &amp; confirm</button></div></div>
    </form>`);
  document.getElementById("f-approve-quote-payment").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const accountId = f.get("accountId"), date = f.get("date");
    const commissionRate = q.createdBy ? Number(f.get("commissionRate")) : undefined;
    // The one real fix this migration owed the old prototype: this used to
    // mutate the local invoices/payables/clients caches directly (no bank
    // ledger entry, no persistence, invisible to other users). Now it's a
    // single real server transaction — lead→client conversion, invoice
    // create-or-topup, ledger entry and commission payable all happen
    // together, or not at all. See approveQuotePendingPayment() server-side.
    try{
      const wasLead = !q.clientId && q.leadId;
      const leadName = wasLead ? (leadById(q.leadId)||{}).name : null;
      const result = await apiJson(`/api/crm/quotes/${quoteId}/pending-payments/${payment.id}/approve`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ accountId, date, commissionRate }) });
      await Promise.all([loadQuotes(), loadClients(), loadLeads(), loadInvoices(), loadPayables(), loadBankAccounts(), refreshFinanceReports(), loadApprovedReceipts()]);
      const commissionAmount = q.createdBy ? Math.round(payment.amount * (commissionRate/100)) : 0;
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
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>For anything the structured forms (Invoices, Payables, Expenses, Banks) don't capture — write-offs, accruals, corrections. Each entry must balance (total debits = total credits). Debit increases an Asset or Expense; Credit increases a Liability or Income. A line against a bank account posts straight to that account's ledger. There's no editing a posted entry — a correction is best made as a new entry, though a genuine mistake can be deleted.</div></div>
  <div class="toolbar"><div class="filter-group"><span class="filter-label">Show</span><select class="select-sm" onchange="setJournalMonthFilter(this.value)">${dateFilterOptions(journalEntries.map(j=>j.date), journalMonthFilter)}</select></div><button class="btn primary" onclick="openAddJournalEntry()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New journal entry</button></div>
  <div class="panel">
    <div class="panel-head"><h3>Journal entries</h3><div class="sub">${filtered.length} of ${journalEntries.length}${dateFilterSuffix(journalMonthFilter,'posted in')}</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Memo</th><th>Lines</th><th class="num">Amount</th><th></th></tr></thead>
      <tbody>${sorted.map(j=>`<tr><td class="muted">${fmtDate(j.date)}</td><td style="font-weight:600;">${esc(j.memo)}</td><td class="muted" style="font-size:12px;">${j.lines.map(l=>`${esc(journalAccountLabel(l.account))} ${l.side==='debit'?'Dr':'Cr'} ${inr(l.amount)}`).join(' · ')}</td><td class="num mono">${inr(journalEntryTotal(j))}</td><td><div style="display:flex;justify-content:flex-end;"><button class="btn btn-sm ghost" onclick="openConfirmDelete('journal','${j.id}')" title="Delete"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg></button></div></td></tr>`).join("") || `<tr><td colspan="5"><div class="empty">No journal entries${journalMonthFilter==='All'?' yet':' for this range'}.</div></td></tr>`}</tbody>
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
  emp.userId = authUser.sub || authUser.id || null;
  applyCurrentUser(emp);
  const crmContentJobs = [];
  const roles = emp.roles || [];
  if(emp.isAdmin || roles.includes('SALES') || roles.includes('SALES_HEAD')) crmContentJobs.push(loadCrmModule());
  else if(roles.includes('CLIENTS')) crmContentJobs.push(Promise.all([loadClients(), loadTasks(), loadServiceBoards()]));
  else crmContentJobs.push(loadTasks().catch(err=>console.error("My tasks failed to load", err)));
  if(emp.isAdmin || roles.includes('CONTENT')) crmContentJobs.push(loadContentModule());
  crmContentJobs.push(loadMyContentItems().catch(err=>console.error("My content failed to load", err)));
  crmContentJobs.push(loadCompanyEvents().catch(err=>console.error("Calendar events failed to load", err)));
  crmContentJobs.push(loadMyPrograms().catch(err=>console.error("Programs failed to load", err)));
  crmContentJobs.push(loadSocialStatus().catch(()=>{}));
  crmContentJobs.push(loadNotifications().catch(()=>{}));
  crmContentJobs.push(loadCalendarDept().catch(err=>console.error("Department calendar failed to load", err)));
  setInterval(()=>{ loadNotifications().catch(()=>{}); }, 60000);
  crmContentJobs.push(loadCalendarPrograms().catch(err=>console.error("Calendar programs failed to load", err)));
  crmContentJobs.push(loadDeptHeads().then(()=>Promise.all([loadActionPlans(), loadDeptScores().catch(()=>{})])).catch(err=>console.error("Department heads / action plans failed to load", err)));
  // Payment requests are a side feature for boot purposes: if their load fails
  // (e.g. migration not applied yet) every other module should still come up.
  // One failing request must never blank the whole app: every boot job is isolated, failures are listed, and the
  // shell still opens with whatever did load (a banner says what didn't).
  const bootFailures = [];
  const guard = (job, label) => Promise.resolve(job).catch(err=>{ console.error(label+" failed to load", err); bootFailures.push(label); });
  const bootJobs = [loadHrModule(), loadFinanceModule(), loadPaymentRequests(), loadWithdrawalRequests(), loadMyPayroll(), ...crmContentJobs];
  await Promise.all(bootJobs.map((j,i)=>guard(j, ["HR","Finance","Payment requests","Withdrawal requests","My payroll"][i] || "Clients / content / calendar")));
  nav.module = isLeadershipRole(emp) ? 'dashboard' : (isHRRole(emp) ? 'hr' : ((isStaffRole(emp) || isSalesRole(emp)) ? 'workspace' : 'dashboard'));
  if(!visibleModules().some(m=>m.id===nav.module)) nav.module = visibleModules()[0].id;
  const landingMod = visibleModules().find(m=>m.id===nav.module);
  nav.sub[nav.module] = (landingMod && landingMod.sub && landingMod.sub.length) ? landingMod.sub[0].id : (nav.sub[nav.module] || 'overview');
  document.getElementById('app-shell').hidden = false;
  render();
  if(bootFailures.length) toast("Some data couldn't load ("+[...new Set(bootFailures)].join(", ")+") — try reloading; tell an admin if it keeps happening.");
  { const m = /^#feedback\/([\w-]+)$/i.exec(location.hash||''); if(m) openFeedbackFromLink(m[1]); }
}).catch((err) => {
  console.error(err); /* Auth.init() already redirects to /login.html on failure */
  // Never leave a blank screen: if the app shell never opened, say so.
  const shell = document.getElementById('app-shell');
  if(shell && shell.hidden && !document.getElementById('boot-error')){
    document.body.insertAdjacentHTML('beforeend', '<div id="boot-error" style="max-width:420px;margin:15vh auto;padding:24px;font-family:sans-serif;text-align:center;"><h3>Couldn\'t load the ERP</h3><p style="color:#666;">Something went wrong while starting up. Please reload; if it keeps happening, tell an admin.</p><button onclick="location.reload()" style="padding:8px 16px;">Reload</button></div>');
  }
});
