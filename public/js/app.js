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
const TODAY = "2026-09-15";
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
const isoDate = s => s ? String(s).slice(0,10) : s;

function mapEmployee(e){
  return {
    id: e.employeeCode, _dbId: e.id, name: e.name, dept: e.dept, role: e.role,
    dob: isoDate(e.dob), joined: isoDate(e.joinedAt), email: e.email,
    phone: e.phone || "", salary: Number(e.salary),
    empType: TITLECASE_FROM_API(e.empType),
    employmentStatus: TITLECASE_FROM_API(e.employmentStatus),
    leavingDate: isoDate(e.leavingDate), noticeGivenDate: isoDate(e.noticeGivenDate), noticeNote: e.noticeNote || "",
  };
}
function mapLeaveRequest(l){
  return {
    id: l.id, empId: employeeCodeByDbId[l.employeeId] || l.employeeId,
    type: TITLECASE_FROM_API(l.type), duration: TITLECASE_FROM_API(l.duration),
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
  };
}
function mapComplaint(c){
  return { id:c.id, category:c.category, dept:c.dept||"", text:c.text, submitted:isoDate(c.submittedAt), status:TITLECASE_FROM_API(c.status), note:c.note||undefined };
}
function mapPosition(p){
  return { id:p.id, role:p.role, dept:p.dept, openings:p.openings, status:TITLECASE_FROM_API(p.status), postedDate:isoDate(p.postedDate) };
}
function mapCandidate(c){
  return { id:c.id, posId:c.positionId, name:c.name, phone:c.phone||"", email:c.email||"", stage:TITLECASE_FROM_API(c.stage), appliedDate:isoDate(c.appliedDate) };
}
function mapNotice(n){
  return { id:n.id, title:n.title, message:n.message, postedBy:n.postedByUser?.name||"", postedDate:isoDate(n.postedDate) };
}
// A precomputed payroll row from the server, kept under the same field
// names the render layer already expects from the old computePayrollRow().
function mapPayrollRow(r){
  return { basic:r.basic, hra:r.hra, special:r.special, gross:r.gross, pf:r.pf, pt:r.pt,
    advDeduction:r.advDeduction, lopDays:r.lopDays, lopDeduction:r.lopDeduction,
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
let hrPolicy = { casualLeaveDays:12, sickLeaveDays:8, earnedLeaveDays:15, weeklyOff:0, notes:"", holidays:[] };
let leavePayPolicy = { notes:"" };
let leaveBalanceCache = {}; // empCode -> {casual:{used,total},sick:{...},earned:{...}}
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
    casualLeaveDays: policy.casualLeaveDays, sickLeaveDays: policy.sickLeaveDays, earnedLeaveDays: policy.earnedLeaveDays,
    weeklyOff: policy.weeklyOff, notes: policy.generalNotes || "",
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
  // Anyone without a record today reads as absent rather than crashing the render layer.
  employees.forEach(e=>{ if(!attendanceToday[e.id]) attendanceToday[e.id] = { status:"absent", in:null }; });
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
  if(!ids.length) return "Adding entries";
  if(ids.length < employees.length) return "Adding entries";
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
      loadArchivedEmployees(),
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

function leaveBalance(empId){
  return leaveBalanceCache[empId] || {
    casual:{used:0,total:hrPolicy.casualLeaveDays}, sick:{used:0,total:hrPolicy.sickLeaveDays}, earned:{used:0,total:hrPolicy.earnedLeaveDays},
  };
}
async function openAdjustLeaveBalance(empId){
  const e = byId(empId);
  showModal(`
    <div class="modal-head"><h3>Add leave balance</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-adjust-balance"><div class="modal-body">
      <div class="person" style="margin-bottom:4px;">${personCell(e)}</div>
      <div class="field-row">
        <div><label class="field-label">Leave type</label><select class="field-input" name="type"><option value="casual">Casual</option><option value="sick">Sick</option><option value="earned">Earned</option></select></div>
        <div><label class="field-label">Days to add</label><input class="field-input" type="number" name="days" step="0.25" required placeholder="e.g. 2 (use a negative number to correct downward)"></div>
      </div>
      <div><label class="field-label">Reason</label><input class="field-input" name="reason" placeholder="e.g. Carried forward from last year, comp-off granted"></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Add to balance</button></div></div>
    </form>`);
  document.getElementById("f-adjust-balance").addEventListener("submit", async ev=>{
    ev.preventDefault();
    const f = new FormData(ev.target);
    const type = f.get("type"); const days = Number(f.get("days"));
    await apiJson("/api/hr/leave-balance-adjustments", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ employeeId: employeeDbIdByCode[empId], type: type.toUpperCase(), days, note: f.get("reason")||undefined }) });
    await loadLeaveBalances();
    toast(`${days>0?"+":""}${days} ${type} day(s) added for ${e.name}`); closeModal(); render();
  });
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

async function loadCrmModule(){
  await Promise.all([loadClients(), loadLeads(), loadQuotes(), loadTasks()]);
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

const CLEAR_ORDER = ["Salary","Rent","Commission","Internal Loan","Vendor"];
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
  return { id:e.id, category:TITLECASE_FROM_API(e.category), description:e.description, amount:Number(e.amount), date:isoDate(e.date), accountId:e.accountId, dept:e.dept||"" };
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
  // Server field names differ slightly (directCost vs directPayroll+directExpense
  // split, no margin) — reshape to what acctProfitability()'s render expects.
  const rows = r.rows.map(row=>({
    dept: row.dept, headcount: row.headcount, revenue: row.revenue,
    directPayroll: row.directCost, directExpense: 0, overheadShare: Math.round(row.overheadShare),
    totalCost: Math.round(row.totalCost), profit: Math.round(row.profit),
    margin: row.revenue ? (row.profit/row.revenue*100) : null,
  }));
  const overheadHeadcount = employees.filter(e=>OVERHEAD_DEPTS.includes(e.dept)).length;
  return { rows, overheadPayroll: r.overheadPool, overheadHeadcount, rent:0, sharedExpenses:0, overheadPool: r.overheadPool, totalHeadcount: rows.reduce((s,x)=>s+x.headcount,0), perHeadOverhead: 0 };
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
    await Promise.all([loadInvoices(), loadPayables(), loadExpenses(), loadJournalEntries(), loadCommissionWithdrawals()]);
    await loadFinanceReports(payroll.selectedMonth);
  } else if(roles.includes('SALES')){
    // Sales' narrow slice: their own invoices (server already scopes reads)
    // and their own commission withdrawals — no payables/expenses/banks/COA.
    await loadInvoices();
    await loadCommissionWithdrawals();
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
    {id:"advances", label:"Advance Salary", icon:"i-coins", count:()=>currentUser?advances.filter(a=>a.empId===currentUser.id && a.status==="Pending").length:0},
  ]},
  {id:"hr", label:"HR", icon:"i-users", sub:[
    {id:"overview", label:"Overview", icon:"i-trend"},
    {id:"directory", label:"Directory", icon:"i-users"},
    {id:"attendance", label:"Attendance", icon:"i-attendance"},
    {id:"leave", label:"Leave Requests", icon:"i-leave", count:()=>leaveRequests.filter(l=>l.status==="Pending").length},
    {id:"hiring", label:"Hiring", icon:"i-target", count:()=>openPositions.filter(p=>p.status==="Open").length},
    {id:"payroll", label:"Payroll", icon:"i-wallet"},
    {id:"advances", label:"Advance Salary", icon:"i-coins", count:()=>advances.filter(a=>a.status==="Pending").length},
    {id:"complaints", label:"Complaints", icon:"i-megaphone", count:()=>complaints.filter(c=>c.status==="New").length},
    {id:"notices", label:"Notices", icon:"i-bell"},
    {id:"policies", label:"HR Settings", icon:"i-sliders"},
  ]},
  {id:"marketing", label:"Marketing and Sales", icon:"i-megaphone", sub:[
    {id:"overview", label:"Overview", icon:"i-trend"},
    {id:"content", label:"Content", icon:"i-board"},
    {id:"performance", label:"Meta Ads", icon:"i-target"},
    {id:"leads", label:"Leads", icon:"i-users"},
    {id:"quotes", label:"Quotes", icon:"i-handshake", count:()=>quotes.filter(q=>q.status==="Submitted to Finance").length},
    {id:"invoices", label:"Invoices", icon:"i-receipt", count:()=>clientsMissingInvoice().length},
  ]},
  {id:"clients", label:"Clients", icon:"i-briefcase", sub:[
    {id:"overview", label:"Overview", icon:"i-trend"},
    {id:"all", label:"All Clients", icon:"i-briefcase"},
  ]},
  {id:"accounts", label:"Accounts", icon:"i-wallet", sub:[
    {id:"overview", label:"Overview", icon:"i-trend"},
    {id:"invoices", label:"Invoices", icon:"i-receipt", count:()=>invoices.filter(i=>invoiceStatus(i)==="Overdue").length},
    {id:"payables", label:"Payables", icon:"i-coins", count:()=>payables.filter(p=>payableStatus(p)!=="Paid").length},
    {id:"expenses", label:"Expenses", icon:"i-file"},
    {id:"banks", label:"Banks", icon:"i-building"},
    {id:"quotes", label:"Quotes", icon:"i-handshake", count:()=>quotes.filter(q=>q.status==="Submitted to Finance").length},
    {id:"commissions", label:"Commissions", icon:"i-percent", count:()=>payables.filter(p=>p.category==="Commission" && payableBalance(p)>0).length},
    {id:"profitability", label:"Profitability", icon:"i-target"},
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
function isSalesRole(emp){ return !!(emp && (emp.roles ? emp.roles.includes('SALES') : emp.dept==='Sales')); }
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
  {id:"commission", label:"My Commission", icon:"i-percent", count:()=>currentUser?payables.filter(p=>p.category==="Commission" && p.salesPerson===currentUser.name && payableBalance(p)>0).length:0},
  {id:"leaderboard", label:"Leaderboard", icon:"i-target"},
];
function visibleModules(){
  if(currentUser && isHRRole(currentUser)) return MODULES.filter(m=>m.id==='hr');
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
function setModule(id){ if(!visibleModules().some(m=>m.id===id)) return; nav.module=id; nav.detail=null; render(); }
function setSub(mid, sid){ const mods=visibleModules(); const mod=mods.find(m=>m.id===mid); if(!mod) return; if(mod.sub && !mod.sub.some(s=>s.id===sid)) return; nav.module=mid; nav.sub[mid]=sid; nav.detail=null; render(); }
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
    advances:["Advance Salary", ()=>currentUser?advances.filter(a=>a.empId===currentUser.id).length+" request(s) on record":""],
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
    complaints:["Complaints", ()=>complaints.filter(c=>c.status==="New").length+" new"],
    notices:["Notices", ()=>notices.length+" posted"],
    policies:["HR Settings","Holidays, leave entitlements and general policy"],
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
    payables:["Payables", ()=>inr(payables.reduce((s,p)=>s+payableBalance(p),0))+" outstanding"],
    expenses:["Expenses", ()=>expenses.length+" logged this month"],
    banks:["Banks", ()=>inr(bankAccounts.reduce((s,b)=>s+bankAccountBalance(b.id),0))+" across "+bankAccounts.length+" accounts"],
    quotes:["Quotes", ()=>quotes.filter(q=>q.status==="Submitted to Finance").length+" awaiting confirmation"],
    commissions:["Sales Commissions", ()=>inr(payables.filter(p=>p.category==="Commission").reduce((s,p)=>s+payableBalance(p),0))+" outstanding"],
    profitability:["Department Profitability", ()=>"Overhead split by headcount · "+MONTH_LABEL[payroll.selectedMonth]],
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
  else if(nav.module==="workspace") root.innerHTML = ({overview:workspaceOverview,tasks:workspaceTasks,attendance:workspaceAttendance,leave:workspaceLeave,advances:workspaceAdvances,commission:workspaceCommission,leaderboard:workspaceLeaderboard})[nav.sub.workspace]();
  else if(nav.module==="hr") root.innerHTML = ({overview:hrOverview,directory:hrDirectory,attendance:hrAttendance,leave:hrLeave,hiring:hrHiring,payroll:hrPayroll,advances:hrAdvances,complaints:hrComplaints,notices:hrNotices,policies:hrPolicies})[nav.sub.hr]();
  else if(nav.module==="marketing") root.innerHTML = ({overview:mktOverview,content:mktContent,performance:mktPerformance,leads:mktLeads,quotes:mktQuotes,invoices:mktInvoices})[nav.sub.marketing]();
  else if(nav.module==="clients") root.innerHTML = ({overview:clientsOverview,all:clientsAll})[nav.sub.clients]();
  else if(nav.module==="accounts") root.innerHTML = ({overview:acctOverview,invoices:acctInvoices,payables:acctPayables,expenses:acctExpenses,profitability:acctProfitability,banks:acctBanks,quotes:acctQuotes,commissions:acctCommissions,coa:acctChartOfAccounts,journal:acctJournal,reports:acctReports})[nav.sub.accounts]();
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
  const myWithdrawals = commissionWithdrawals.filter(w=>w.empId===currentUser.id).slice().sort((a,b)=>{ const order={Pending:0,Approved:1,Rejected:2}; if(order[a.status]!==order[b.status]) return order[a.status]-order[b.status]; return b.requested.localeCompare(a.requested); });
  return `
  <div class="toolbar"><div class="banner muted" style="margin:0;flex:1;min-width:260px;"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>You earn ${Math.round(SALES_COMMISSION_RATE*100)}% on every payment Finance approves against your quotes or invoices. Need it paid out sooner? Request a withdrawal below and Finance will approve and pay it against your outstanding entries.</div></div>${mine.balance>0?`<button class="btn primary" onclick="openRequestCommissionWithdrawal()"><svg class="icon" style="width:13px;height:13px"><use href="#i-coins"/></svg>Request withdrawal</button>`:''}</div>
  <div class="kpi-grid">
    <div class="kpi-card hero"><div class="kpi-label">Outstanding</div><div class="kpi-value mono ${mine.balance>0?'warn':''}">${inr(mine.balance)}</div><div class="kpi-sub">awaiting payout</div></div>
    <div class="kpi-card"><div class="kpi-label">Paid Out</div><div class="kpi-value mono pos">${inr(mine.paid)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Total Earned</div><div class="kpi-value mono">${inr(mine.earned)}</div><div class="kpi-sub">${mine.mine.length} entr${mine.mine.length===1?'y':'ies'}, all time</div></div>
  </div>
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
  const idx = employees.findIndex(e=>e.id===currentUser.id);
  const bal = leaveBalance(currentUser.id, idx);
  return `
  <div class="toolbar"><div></div><button class="btn primary" onclick="openApplyLeave()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Apply for leave</button></div>
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);">
    <div class="kpi-card"><div class="kpi-label">Casual</div><div class="kpi-value mono">${bal.casual.total-bal.casual.used}<span style="font-size:13px;color:var(--ink-soft);"> / ${bal.casual.total}</span></div></div>
    <div class="kpi-card"><div class="kpi-label">Sick</div><div class="kpi-value mono">${bal.sick.total-bal.sick.used}<span style="font-size:13px;color:var(--ink-soft);"> / ${bal.sick.total}</span></div></div>
    <div class="kpi-card"><div class="kpi-label">Earned</div><div class="kpi-value mono">${bal.earned.total-bal.earned.used}<span style="font-size:13px;color:var(--ink-soft);"> / ${bal.earned.total}</span></div></div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Your requests</h3></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Type</th><th>Dates</th><th class="num">Days</th><th>Reason</th><th>Status</th></tr></thead>
      <tbody>${mine.length ? mine.map(l=>{ const range = l.from===l.to ? fmtDateShort(l.from) : `${fmtDateShort(l.from)} – ${fmtDateShort(l.to)}`; return `<tr><td>${esc(l.type)}${l.duration && l.duration!=="Full Day" ? ` <span class="faint">· ${esc(l.duration)}</span>` : ""}</td><td class="muted">${range}</td><td class="num">${l.days}</td><td class="muted">${esc(l.reason)}</td><td>${pill(l.status,statusKind(l.status))}</td></tr>`; }).join("") : `<tr><td colspan="5"><div class="empty">No leave requests yet.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
function openApplyLeave(){
  showModal(`
    <div class="modal-head"><h3>Apply for leave</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-apply-leave"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Submitted to HR for approval.</div></div>
      <div class="field-row">
        <div><label class="field-label">Type</label><select class="field-input" name="type"><option>Casual</option><option>Sick</option><option>Earned</option><option>Unpaid</option></select></div>
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
        type: TITLECASE_TO_API(f.get("type")), duration: TITLECASE_TO_API(from===to?duration:"Full Day"), fromDate:from, toDate:to, days, reason:f.get("reason"),
      })});
      leaveRequests = (await apiJson(`/api/hr/leave-requests?employeeId=${currentUser._dbId}`)).leaveRequests.map(mapLeaveRequest);
      toast("Leave request submitted"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't submit leave request"); }
  });
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
function workspaceAdvances(){
  if(!currentUser) return '';
  const mine = advances.filter(a=>a.empId===currentUser.id).slice().sort((a,b)=>{ const order={Pending:0,Recovering:1,Recovered:2,Rejected:3}; if(order[a.status]!==order[b.status]) return order[a.status]-order[b.status]; return b.requested.localeCompare(a.requested); });
  return `
  <div class="toolbar"><div></div><button class="btn primary" onclick="openRequestAdvance()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Request advance</button></div>
  <div class="panel">
    <div class="panel-head"><h3>Your requests</h3><div class="sub">Approved advances recover automatically from payroll</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th class="num">Amount</th><th>Reason</th><th>Requested</th><th class="num">Balance</th><th>Status</th></tr></thead>
      <tbody>${mine.length ? mine.map(a=>`<tr><td class="num mono">${inr(a.amount)}</td><td class="muted">${esc(a.reason)}</td><td class="muted">${fmtDate(a.requested)}</td><td class="num mono">${a.status==='Rejected'?'—':inr(a.balance)}</td><td>${pill(a.status,statusKind(a.status))}</td></tr>`).join("") : `<tr><td colspan="5"><div class="empty">No advance requests yet.</div></td></tr>`}</tbody>
    </table></div>
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
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Team Size</span><div class="kpi-badge"><svg class="icon" style="width:15px;height:15px"><use href="#i-users"/></svg></div></div><div class="kpi-value mono">${employees.length}</div><div class="kpi-sub">across ${DEPARTMENTS.length} departments</div></div>
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
async function cycleAttendance(id){
  const order=["present","late","half","wfh","absent","leave"];
  const cur=attendanceToday[id];
  const next = order[(order.indexOf(cur.status)+1)%order.length];
  cur.status = next; render(); // optimistic — snappy click feedback
  try{
    await apiJson("/api/hr/attendance", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ employeeId: employeeDbIdByCode[id], date: TODAY, status: ATTENDANCE_TO_API[next] }) });
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
  const rows = employees.map(e=>({emp:e, a:attendanceToday[e.id]}));
  const counts = {present:0,late:0,half:0,absent:0,leave:0,wfh:0};
  rows.forEach(r=>counts[r.a.status]++);
  const selected = byId(selectedAttendanceEmp) || employees[0];
  selectedAttendanceEmp = selected.id;
  const mtdWorkingDays = workingDaysMTD();
  const present = monthPresentDays[selected.id] ?? mtdWorkingDays;
  return `
  <div class="kpi-grid cols-5">
    <div class="kpi-card"><div class="kpi-label">Present</div><div class="kpi-value mono">${counts.present}</div></div>
    <div class="kpi-card"><div class="kpi-label">Late / Half Day</div><div class="kpi-value mono warn">${counts.late+counts.half}</div></div>
    <div class="kpi-card"><div class="kpi-label">WFH</div><div class="kpi-value mono blue">${counts.wfh}</div></div>
    <div class="kpi-card"><div class="kpi-label">On Leave</div><div class="kpi-value mono">${counts.leave}</div></div>
    <div class="kpi-card"><div class="kpi-label">Absent</div><div class="kpi-value mono neg">${counts.absent}</div></div>
  </div>
  <div class="grid-2">
    <div class="panel">
      <div class="panel-head"><h3>Today's roster</h3><div class="sub">${employees.length} team members</div></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Employee</th><th>Department</th><th>Check-in</th><th>Status</th></tr></thead>
        <tbody>${rows.map(r=>`<tr class="row-click" onclick="openAttendanceHistory('${r.emp.id}')"><td>${personCell(r.emp)}</td><td class="muted">${esc(r.emp.dept)}</td><td class="num mono muted">${r.a.in||"—"}</td><td><button class="pill ${statusKind(attendanceLabel(r.a.status))}" onclick="event.stopPropagation();cycleAttendance('${r.emp.id}')">${attendanceLabel(r.a.status)}</button></td></tr>`).join("")}</tbody>
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

function hrLeave(){
  const sorted = leaveRequests.slice().sort((a,b)=>{ const order={Pending:0,Approved:1,Rejected:2}; if(order[a.status]!==order[b.status]) return order[a.status]-order[b.status]; return b.applied.localeCompare(a.applied); });
  return `
  <div class="toolbar"><div></div><button class="btn primary" onclick="openAddLeave()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New request</button></div>
  <div class="panel">
    <div class="panel-head"><h3>Requests</h3></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th class="num">Days</th><th>Reason</th><th>Status</th><th></th></tr></thead>
      <tbody>${sorted.map(l=>{
        const emp=byId(l.empId);
        const range = l.from===l.to ? fmtDateShort(l.from) : `${fmtDateShort(l.from)} – ${fmtDateShort(l.to)}`;
        const actions = l.status==="Pending" ? `<div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm" onclick="decideLeave('${l.id}','Approved')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Approve</button><button class="btn btn-sm danger" onclick="decideLeave('${l.id}','Rejected')">Reject</button></div>` : (l.note ? `<span class="faint" style="font-size:11.5px;">${esc(l.note)}</span>` : "");
        return `<tr><td>${personCell(emp)}</td><td>${esc(l.type)}${l.duration && l.duration!=="Full Day" ? ` <span class="faint">· ${esc(l.duration)}</span>` : ""}</td><td class="muted">${range}</td><td class="num">${l.days}</td><td class="muted">${esc(l.reason)}</td><td>${pill(l.status,statusKind(l.status))}</td><td>${actions}</td></tr>`;
      }).join("")}</tbody>
    </table></div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Leave balances</h3><div class="sub">Base annual entitlement · Casual ${hrPolicy.casualLeaveDays} · Sick ${hrPolicy.sickLeaveDays} · Earned ${hrPolicy.earnedLeaveDays} — set in HR Settings · use Add to grant extra days (carry-forward, comp-off, corrections)</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Employee</th><th class="num">Casual</th><th class="num">Sick</th><th class="num">Earned</th><th></th></tr></thead>
      <tbody>${employees.map((e,i)=>{ const b=leaveBalance(e.id,i); return `<tr><td>${personCell(e)}</td><td class="num">${b.casual.total-b.casual.used} <span class="faint">/ ${b.casual.total}</span></td><td class="num">${b.sick.total-b.sick.used} <span class="faint">/ ${b.sick.total}</span></td><td class="num">${b.earned.total-b.earned.used} <span class="faint">/ ${b.earned.total}</span></td><td><button class="btn btn-sm ghost" onclick="openAdjustLeaveBalance('${e.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Add</button></td></tr>`; }).join("")}</tbody>
    </table></div>
  </div>`;
}

function hrHiring(){
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
    <div class="table-wrap"><table class="data"><thead><tr><th>Role</th><th>Department</th><th class="num">Openings</th><th>Posted</th><th>Status</th><th class="num">Candidates</th></tr></thead>
      <tbody>${openPositions.map(p=>`<tr><td class="cell-strong" style="font-weight:700;">${esc(p.role)}</td><td class="muted">${esc(p.dept)}</td><td class="num">${p.openings}</td><td class="muted">${fmtDate(p.postedDate)}</td><td>${pill(p.status,statusKind(p.status))}</td><td class="num mono">${candidates.filter(c=>c.posId===p.id).length}</td></tr>`).join("") || `<tr><td colspan="6"><div class="empty">No open positions.</div></td></tr>`}</tbody>
    </table></div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Candidates</h3><div class="sub">${candidates.length} in pipeline</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Candidate</th><th>Applying for</th><th>Contact</th><th>Applied</th><th>Stage</th><th></th></tr></thead>
      <tbody>${candidates.map(c=>{ const pos=openPositions.find(p=>p.id===c.posId); return `<tr><td style="font-weight:700;">${esc(c.name)}</td><td class="muted">${pos?esc(pos.role):"—"}</td><td class="muted mono" style="font-size:12px;">${esc(c.phone)}</td><td class="muted">${fmtDate(c.appliedDate)}</td><td>${pill(c.stage,statusKind(c.stage))}</td><td><button class="btn btn-sm ghost" onclick="openOfferLetter('${c.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-file"/></svg>Offer letter</button></td></tr>`; }).join("")}</tbody>
    </table></div>
  </div>`;
}

function hrPayroll(){
  const month = payroll.selectedMonth;
  const includedIds = Object.keys(payroll.history[month].entries);
  const includedEmployees = employees.filter(e=>includedIds.includes(e.id)).sort((a,b)=>a.name.localeCompare(b.name));
  const pendingEmployees = employees.filter(e=>!includedIds.includes(e.id));
  const rows = includedEmployees.map(e=>({emp:e, calc:computePayrollRow(e,month)}));
  const totals = rows.reduce((s,r)=>({gross:s.gross+r.calc.gross, ded:s.ded+r.calc.totalDeductions, net:s.net+r.calc.net, paid:s.paid+r.calc.paid, balance:s.balance+r.calc.balance}),{gross:0,ded:0,net:0,paid:0,balance:0});
  const status = payrollMonthStatus(month);
  return `
  <div class="toolbar">
    <select class="select-sm" onchange="setPayrollMonth(this.value)">${Object.keys(payroll.history).sort().reverse().map(m=>`<option value="${m}" ${m===month?'selected':''}>${MONTH_LABEL[m]}</option>`).join("")}</select>
    <div style="display:flex;align-items:center;gap:10px;">
      <span class="faint" style="font-size:12px;">${includedEmployees.length} of ${employees.length} added</span>
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
      <tbody>${rows.length ? rows.map(r=>`<tr><td>${personCell(r.emp)}</td><td class="num mono">${inr(r.calc.gross)}</td><td class="num mono">${inr(r.calc.totalDeductions)}${r.calc.lopDeduction>0?`<div class="subtext" style="color:var(--neg);text-align:right;">incl. ${r.calc.lopDays}d LOP</div>`:""}</td><td class="num mono" style="font-weight:700;">${inr(r.calc.net)}</td><td class="num mono ${r.calc.paid>0?'':'faint'}">${r.calc.paid>0?inr(r.calc.paid):'—'}</td><td class="num mono ${r.calc.balance>0?'warn':'faint'}">${r.calc.balance>0?inr(r.calc.balance):'—'}</td><td>${pill(r.calc.payStatus,statusKind(r.calc.payStatus))}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;">${r.calc.balance>0?`<button class="btn btn-sm" onclick="openRecordPayment('${r.emp.id}')">Pay</button>`:""}<button class="btn btn-sm ghost" onclick="openPayslip('${r.emp.id}')">Payslip</button><button class="btn btn-sm ghost" onclick="openAddPayrollEntry('${r.emp.id}')" title="Edit gross"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg></button></div></td></tr>`).join("") : `<tr><td colspan="8"><div class="empty">No one added to this month's payroll yet.</div></td></tr>`}</tbody>
    </table></div>
  </div>
  <div class="panel">
    <div class="panel-head">
      <div><h3>Leave &amp; WFH pay policy</h3><div class="sub">Loss of Pay for leave beyond balance is already applied above · WFH's effect is still open</div></div>
    </div>
    <div class="panel-body">
      <div class="banner muted">
        <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
        <div><b>Loss of Pay is live.</b> Casual/Sick/Earned days beyond each employee's HR Settings balance, and any approved Unpaid leave, are already deducted in the Gross → Net figures above. Half/quarter-day leave and Work From Home don't have a fixed salary rule yet — jot it down below as it firms up.</div>
      </div>
      <label class="field-label" style="margin-top:12px;">Policy notes</label>
      <textarea class="field-input" id="policy-notes-textarea" rows="4" style="resize:vertical;font-family:inherit;" placeholder="e.g. WFH counts as full attendance; quarter-day leave deducts 0.25 day's gross...">${esc(leavePayPolicy.notes)}</textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;"><button class="btn btn-sm" onclick="saveLeavePayPolicyNotes()">Save notes</button></div>
    </div>
  </div>`;
}
async function saveLeavePayPolicyNotes(){
  try{
    await apiJson("/api/hr/policy", { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ leavePayNotes: document.getElementById("policy-notes-textarea").value }) });
    await loadPolicy();
    toast("Policy notes saved");
  }catch(err){ toast(err.message || "Couldn't save notes"); }
}

function hrAdvances(){
  const sorted = advances.slice().sort((a,b)=>{ const order={Pending:0,Recovering:1,Recovered:2,Rejected:3}; if(order[a.status]!==order[b.status]) return order[a.status]-order[b.status]; return b.requested.localeCompare(a.requested); });
  return `
  <div class="toolbar"><div></div><button class="btn primary" onclick="openAddAdvance()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New request</button></div>
  <div class="panel">
    <div class="panel-head"><h3>Requests</h3><div class="sub">Approved advances recover automatically from payroll</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Employee</th><th class="num">Amount</th><th>Reason</th><th>Requested</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
      <tbody>${sorted.map(a=>{
        const emp=byId(a.empId);
        const actions = a.status==="Pending" ? `<div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm" onclick="decideAdvance('${a.id}','Recovering')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Approve</button><button class="btn btn-sm danger" onclick="decideAdvance('${a.id}','Rejected')">Reject</button></div>` : `<span class="faint" style="font-size:11.5px;">${a.status==='Rejected'?(a.note||''):inr(a.monthlyDeduction)+'/mo'}</span>`;
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
    <div class="panel-head"><h3>Leave entitlements</h3><div class="sub">Annual days per employee, by leave type — feeds every employee's leave balance</div></div>
    <div class="panel-body">
      <div class="field-row">
        <div><label class="field-label">Casual leave (days/yr)</label><input class="field-input" id="policy-casual" type="number" min="0" value="${hrPolicy.casualLeaveDays}"></div>
        <div><label class="field-label">Sick leave (days/yr)</label><input class="field-input" id="policy-sick" type="number" min="0" value="${hrPolicy.sickLeaveDays}"></div>
        <div><label class="field-label">Earned leave (days/yr)</label><input class="field-input" id="policy-earned" type="number" min="0" value="${hrPolicy.earnedLeaveDays}"></div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button class="btn primary btn-sm" onclick="saveLeaveEntitlements()">Save entitlements</button></div>
      <div class="banner muted" style="margin-top:14px;">
        <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
        <div><b>Loss of Pay, automatic.</b> Once someone's approved Casual/Sick/Earned leave crosses these entitlements — or they take approved Unpaid leave — the extra days are deducted from that month's payroll at gross ÷ working days. Lower an entitlement here and it applies going forward.</div>
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
async function saveLeaveEntitlements(){
  try{
    await apiJson("/api/hr/policy", { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({
      casualLeaveDays: Number(document.getElementById("policy-casual").value) || 0,
      sickLeaveDays: Number(document.getElementById("policy-sick").value) || 0,
      earnedLeaveDays: Number(document.getElementById("policy-earned").value) || 0,
    })});
    await loadPolicy();
    toast("Leave entitlements updated"); render();
  }catch(err){ toast(err.message || "Couldn't save entitlements"); }
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
function openAddEmployee(){
  showModal(`
    <div class="modal-head"><h3>Add employee</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-add-employee"><div class="modal-body">
      <div><label class="field-label">Full name</label><input class="field-input" name="name" required placeholder="e.g. Farhan Kutty"></div>
      <div class="field-row">
        <div><label class="field-label">Department</label><select class="field-input" name="dept">${DEPARTMENTS.map(d=>`<option>${esc(d)}</option>`).join("")}</select></div>
        <div><label class="field-label">Role</label><input class="field-input" name="role" required placeholder="e.g. SMM Executive"></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">Joining date</label><input class="field-input" type="date" name="joined" value="${TODAY}" required></div>
        <div><label class="field-label">Monthly gross (₹)</label><input class="field-input" type="number" name="salary" min="1000" step="500" required placeholder="26000"></div>
      </div>
      <div class="field-row">
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
        <div class="check-row">${["ADMIN","HR","FINANCE","SALES","CONTENT"].map(r=>`<label class="check-chip"><input type="checkbox" name="grantRole" value="${r}">${r.charAt(0)+r.slice(1).toLowerCase()}</label>`).join("")}</div>
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
        name: f.get("name"), dept: f.get("dept"), role: f.get("role"), joinedAt: f.get("joined"),
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
      <div class="person"><div class="mini-avatar" style="width:38px;height:38px;font-size:13px;">${initials(e.name)}</div><div><div style="font-weight:800;font-size:15px;display:flex;align-items:center;gap:8px;">${esc(e.name)} ${pill(e.empType, statusKind(e.empType))}</div><div class="person-role">${esc(e.role)} · ${esc(e.dept)}</div></div></div>
      <button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button>
    </div>
    <div class="modal-body">
      ${e.employmentStatus==="Notice Period" ? `<div class="banner"><svg class="icon" style="width:15px;height:15px"><use href="#i-bell"/></svg><div><b>On notice period.</b> Last working day ${fmtDate(e.leavingDate)}${e.noticeNote?" — "+esc(e.noticeNote):""}.</div></div>` : ""}
      ${e.employmentStatus==="Left" ? `<div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-archive"/></svg><div><b>Archived.</b> Left on ${fmtDate(e.leavingDate)}. They no longer have ERP access.</div></div>` : ""}
      <div class="field-row">
        <div><label class="field-label">Employee ID</label><div class="mono">${e.id}</div></div>
        <div><label class="field-label">Joined</label><div>${fmtDate(e.joined)}</div></div>
        <div><label class="field-label">Email</label><div style="font-size:13px;">${esc(e.email)}</div></div>
        <div><label class="field-label">Phone</label><div class="mono">${esc(e.phone)}</div></div>
        <div><label class="field-label">Monthly gross</label><div class="mono">${inr(e.salary)}</div></div>
        <div><label class="field-label">Today</label><div>${pill(attendanceLabel(a.status),statusKind(attendanceLabel(a.status)))}</div></div>
      </div>
      <div class="section-label">Leave balance</div>
      <div class="field-row">
        <div><label class="field-label">Casual</label><div class="mono">${b.casual.total-b.casual.used} / ${b.casual.total}</div></div>
        <div><label class="field-label">Sick</label><div class="mono">${b.sick.total-b.sick.used} / ${b.sick.total}</div></div>
        <div><label class="field-label">Earned</label><div class="mono">${b.earned.total-b.earned.used} / ${b.earned.total}</div></div>
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
        name: f.get("name"), dept: f.get("dept"), role: f.get("role"), joinedAt: f.get("joined"),
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
        <div><label class="field-label">Type</label><select class="field-input" name="type"><option>Casual</option><option>Sick</option><option>Earned</option><option>Unpaid</option></select></div>
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
        employeeId: employeeDbIdByCode[f.get("empId")], type: TITLECASE_TO_API(f.get("type")),
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
function openPayslip(id){
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
    <div class="modal-foot">${c.balance>0?`<button class="btn primary" onclick="openRecordPayment('${e.id}')"><svg class="icon" style="width:13px;height:13px"><use href="#i-wallet"/></svg>Record payment</button>`:'<div></div>'}<button class="btn ghost" onclick="closeModal()">Close</button></div>`);
}
async function setPayrollMonth(m){
  payroll.selectedMonth=m;
  const jobs = [];
  if(!payroll.history[m] && (isHRRole(currentUser) || (currentUser && currentUser.isAdmin))) jobs.push(loadPayrollMonth(m));
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
function openAddPayrollEntry(id){
  const e = byId(id); const month = payroll.selectedMonth;
  const existing = payroll.history[month].entries[id];
  showModal(`
    <div class="modal-head"><h3>${existing?"Edit":"Add to"} payroll — ${MONTH_LABEL[month]}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-add-payroll-entry"><div class="modal-body">
      <div class="person" style="margin-bottom:4px;">${personCell(e)}</div>
      <div class="field-row">
        <div><label class="field-label">Master monthly gross</label><div class="mono">${inr(e.salary)}</div></div>
        <div><label class="field-label">Gross for ${MONTH_LABEL[month]} (₹)</label><input class="field-input" type="number" name="gross" min="0" step="500" required value="${existing?existing.gross:e.salary}"></div>
      </div>
      <div class="subtext">Adjust this if the month's pay differs from the master salary — unpaid leave deductions, a mid-month joiner, or a pending salary revision. Once added, this employee's figures appear in the payroll list below and can be paid in full or in parts.</div>
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
        <div><label class="field-label">Amount paying now (₹)</label><input class="field-input" type="number" name="amount" min="1" max="${c.balance}" step="500" required value="${c.balance}"></div>
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
  const filtered = clients.filter(c=>clientsMonthFilter==='All' || c.onboarded.slice(0,7)===clientsMonthFilter);
  const hidePayment = isStaffRole(currentUser);
  return `
  <div class="toolbar"><div class="filter-group"><span class="filter-label">Onboarded</span><select class="select-sm" onchange="setClientsMonthFilter(this.value)">${monthFilterOptions(clients.map(c=>c.onboarded), clientsMonthFilter)}</select></div><button class="btn primary" onclick="openAddClient()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Add client</button></div>
  <div class="panel">
    <div class="panel-head"><h3>Clients</h3><div class="sub">${filtered.length} of ${clients.length}${clientsMonthFilter!=='All'?' onboarded in '+monthLabel(clientsMonthFilter):' on record'}</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Client</th><th>Services</th><th>Account Manager</th><th>Sales Person</th>${hidePayment?'':'<th class="num">Payment Due</th>'}<th>Status</th></tr></thead>
      <tbody>${filtered.map(c=>{ const due=clientPaymentDue(c.id); return `<tr class="row-click" onclick="openClientDetail('${c.id}')"><td>${clientCell(c.id)}</td><td class="muted" style="max-width:220px;">${c.services.map(s=>`<span class="tag" style="margin:1px 3px 1px 0;">${esc(s)}</span>`).join('')}</td><td class="muted">${esc(c.accountManager)}</td><td class="muted">${esc(c.salesPerson)}</td>${hidePayment?'':`<td class="num mono" style="${due>0?'color:var(--neg);font-weight:700;':''}">${due>0?inr(due):'—'}</td>`}<td>${pill(c.status,c.status==='Active'?'pos':c.status==='Paused'?'warn':'neg')}</td></tr>`; }).join("") || `<tr><td colspan="${hidePayment?5:6}"><div class="empty">No clients onboarded that month.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
function openClientDetail(id){ nav.detail = {type:'client', id}; render(); }
// A client's whole page IS their workflow — one Payment section (every invoice raised against them)
// and one Task board (every activity done for them), nothing split off into a separate "project".
function clientDetailPage(id){
  const c = clientById(id);
  const billingType = c.billingType || "Prepaid";
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
      <div class="section-label" style="display:flex;align-items:center;justify-content:space-between;">Workflow<div style="display:flex;gap:6px;">${tasksOf(c.id).filter(isTaskArchived).length?`<button class="btn btn-sm ghost" onclick="openTaskArchive('${c.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-archive"/></svg>Archive (${tasksOf(c.id).filter(isTaskArchived).length})</button>`:''}<button class="btn btn-sm ghost" onclick="openAddTask('${c.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Add task</button></div></div>
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
        <div><label class="field-label">Account Manager</label><select class="field-input" name="accountManager">${employees.map(e=>`<option ${e.name===c.accountManager?'selected':''}>${esc(e.name)}</option>`).join('')}</select></div>
        <div><label class="field-label">Sales Person</label><select class="field-input" name="salesPerson">${(()=>{ const s=employees.filter(e=>e.dept==='Sales'); return (s.length?s:employees).map(e=>`<option ${e.name===c.salesPerson?'selected':''}>${esc(e.name)}</option>`).join(''); })()}</select></div>
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
  const filtered = marketingLeads.filter(l=>leadsMonthFilter==='All' || l.createdDate.slice(0,7)===leadsMonthFilter);
  const sorted = filtered.slice().sort((a,b)=>b.createdDate.localeCompare(a.createdDate));
  return `
  <div class="toolbar"><div class="filter-group"><span class="filter-label">Month</span><select class="select-sm" onchange="setLeadsMonthFilter(this.value)">${monthFilterOptions(marketingLeads.map(l=>l.createdDate), leadsMonthFilter)}</select></div><button class="btn primary" onclick="openAddLead()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New lead</button></div>
  <div class="panel">
    <div class="panel-head"><h3>Lead pipeline</h3><div class="sub">${filtered.length} of ${marketingLeads.length}${leadsMonthFilter!=='All'?' in '+monthLabel(leadsMonthFilter):' total'}</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Lead</th><th>Service Interested</th><th>Source</th><th>Lead Owner</th><th>Created</th><th></th></tr></thead>
      <tbody>${sorted.map(l=>`<tr><td><div style="font-weight:700;font-size:13px;">${esc(l.name)}</div><div class="subtext">${esc(l.email)}</div></td><td class="muted">${esc(l.serviceInterested)}</td><td class="muted">${esc(l.source)}</td><td class="muted">${esc(l.leadOwner)}</td><td class="muted">${fmtDate(l.createdDate)}</td><td><button class="btn btn-sm ghost" onclick="openEditLead('${l.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button></td></tr>`).join("") || `<tr><td colspan="6"><div class="empty">No leads that month.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
function salesTeamOptions(){
  const salesEmps = employees.filter(e=>e.dept==='Sales');
  return (salesEmps.length?salesEmps:employees).map(e=>`<option>${esc(e.name)}</option>`).join('');
}
function quoteActionsMkt(q){
  const downloadBtn = `<button class="btn btn-sm ghost" onclick="downloadQuote('${q.id}')" title="Download quote"><svg class="icon" style="width:12px;height:12px"><use href="#i-download"/></svg>Download</button>`;
  if(q.status==="Draft") return `<div style="display:flex;gap:6px;flex-wrap:wrap;"><button class="btn btn-sm" onclick="sendQuote('${q.id}')">Send to client</button><button class="btn btn-sm ghost" onclick="openEditQuote('${q.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button><button class="btn btn-sm ghost" onclick="markQuoteLost('${q.id}')">Mark lost</button>${downloadBtn}</div>`;
  if(q.status==="Sent") return `<div style="display:flex;gap:6px;flex-wrap:wrap;"><button class="btn btn-sm" onclick="openRecordQuotePayment('${q.id}')">Record payment</button><button class="btn btn-sm ghost" onclick="markQuoteLost('${q.id}')">Mark lost</button>${downloadBtn}</div>`;
  if(q.status==="Submitted to Finance"){
    const bal = quoteBalance(q), pending = quotePendingAmount(q);
    return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">${bal>0?`<button class="btn btn-sm" onclick="openRecordQuotePayment('${q.id}')">Record payment</button>`:''}${pending>0?`<span class="faint" style="font-size:11.5px;">${inr(pending)} awaiting Finance</span>`:''}${downloadBtn}</div>`;
  }
  if(q.status==="Invoiced") return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><span class="faint" style="font-size:11.5px;">${esc(q.invoiceId||'')}</span>${downloadBtn}</div>`;
  return downloadBtn;
}
function partyOptions(selectedValue){
  const clientOpts = clients.map(c=>`<option value="client:${c.id}" ${selectedValue==='client:'+c.id?'selected':''}>${esc(c.name)}</option>`).join('');
  const leadOpts = marketingLeads.map(l=>`<option value="lead:${l.id}" ${selectedValue==='lead:'+l.id?'selected':''}>${esc(l.name)} — lead</option>`).join('');
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
  const filtered = quotes.filter(q=>quotesMonthFilter==='All' || q.createdDate.slice(0,7)===quotesMonthFilter);
  const sorted = filtered.slice().sort((a,b)=>b.createdDate.localeCompare(a.createdDate));
  return `
  <div class="toolbar"><div class="filter-group"><span class="filter-label">Month</span><select class="select-sm" onchange="setQuotesMonthFilter(this.value)">${monthFilterOptions(quotes.map(q=>q.createdDate), quotesMonthFilter)}</select></div><button class="btn primary" onclick="openAddQuote()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New quote</button></div>
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>A quote can be for an existing client or a lead, with several services priced independently. As the client pays — in full or in installments — record each payment here to push it to Finance; they confirm the money landed and approve it from Accounts &gt; Quotes. A lead becomes a client automatically the first time Finance approves a payment for them.</div></div>
  <div class="panel">
    <div class="panel-head"><h3>Quotes</h3><div class="sub">${filtered.length} of ${quotes.length}${quotesMonthFilter!=='All'?' in '+monthLabel(quotesMonthFilter):' total'}</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Quote</th><th>For</th><th>Service(s)</th><th class="num">Amount</th><th>Prepared by</th><th>Status</th><th></th></tr></thead>
      <tbody>${sorted.map(q=>{ const party=quoteParty(q); return `<tr><td style="font-weight:700;">${esc(q.title)}</td><td class="muted">${esc(party.name)}${party.kind==='lead'?' '+pill('Lead','blue'):''}</td><td class="muted">${q.items.map(i=>esc(i.dept)).join(', ')}</td><td class="num mono">${inr(quoteTotal(q))}</td><td class="muted">${esc(q.createdBy)}</td><td>${pill(q.status,quoteStatusKind(q.status))}</td><td>${quoteActionsMkt(q)}</td></tr>`; }).join("") || `<tr><td colspan="7"><div class="empty">No quotes that month.</div></td></tr>`}</tbody>
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
function mktInvoices(){
  const missing = clientsMissingInvoice();
  const sorted = invoices.slice().sort((a,b)=>b.issued.localeCompare(a.issued));
  const totalReceivable = invoices.reduce((s,i)=>s+invoiceBalance(i),0);
  return `
  <div class="toolbar"><div></div><button class="btn primary" onclick="openAddInvoice()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New invoice</button></div>
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
    <div class="panel-head"><h3>All invoices</h3><div class="sub">${invoices.length} total · log a payment you've collected here and push it to Finance for confirmation</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Invoice</th><th>Client</th><th>Service(s)</th><th class="num">Amount</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
      <tbody>${sorted.map(i=>{ const st=invoiceStatus(i), bal=invoiceBalance(i), pendingAmt=invoicePendingAmount(i); return `<tr><td class="mono">${esc(i.invoiceNo)}</td><td class="muted">${clientById(i.clientId).name}</td><td class="muted">${(i.items||[]).map(it=>esc(it.dept)).join(', ')||'<span class="faint">—</span>'}</td><td class="num mono">${inr(invoiceTotal(i))}</td><td class="num mono">${bal>0?inr(bal):'<span class="faint">—</span>'}</td><td>${pill(st,invStatusKind(st))}</td><td><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">${bal>0?`<button class="btn btn-sm" onclick="openSubmitInvoicePayment('${i.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-coins"/></svg>Log payment</button>`:''}${pendingAmt>0?`<span class="faint" style="font-size:11.5px;">${inr(pendingAmt)} awaiting Finance</span>`:''}<button class="btn btn-sm ghost" onclick="downloadInvoice('${i.id}')" title="Download invoice"><svg class="icon" style="width:12px;height:12px"><use href="#i-download"/></svg>Download</button>${(i.payments||[]).length?`<button class="btn btn-sm ghost" onclick="openInvoicePayments('${i.id}')" title="Payment receipts"><svg class="icon" style="width:12px;height:12px"><use href="#i-receipt"/></svg>Payments</button>`:''}</div></td></tr>`; }).join("") || `<tr><td colspan="7"><div class="empty">No invoices yet.</div></td></tr>`}</tbody>
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
async function sendQuote(id){
  try{
    await apiJson(`/api/crm/quotes/${id}/send`, { method:"POST" });
    await loadQuotes();
    toast("Quote sent to client"); render();
  }catch(err){ toast(err.message || "Couldn't send quote"); }
}
async function markQuoteLost(id){
  try{
    await apiJson(`/api/crm/quotes/${id}/lost`, { method:"POST" });
    await loadQuotes();
    toast("Quote marked lost"); render();
  }catch(err){ toast(err.message || "Couldn't update quote"); }
}
function openRecordQuotePayment(id){
  const q = quotes.find(x=>x.id===id);
  const bal = quoteBalance(q);
  const party = quoteParty(q);
  showModal(`
    <div class="modal-head"><h3>Record client payment — ${esc(q.title)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-quote-paid"><div class="modal-body">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>${esc(party.name)}${party.kind==='lead'?' (lead)':''} · <b>${inr(quoteTotal(q))}</b> quote total · <b>${inr(bal)}</b> not yet recorded as paid — partial payments are fine. This pushes the payment to Finance, who'll confirm the money landed before it's added to the invoice.</div></div>
      <div class="field-row">
        <div><label class="field-label">Amount paid (₹)</label><input class="field-input" type="number" name="amount" min="1" max="${bal}" step="1" required value="${bal}"></div>
        <div><label class="field-label">Payment date</label><input class="field-input" type="date" name="paymentDate" value="${TODAY}" required></div>
      </div>
      <div><label class="field-label">Note for Finance (optional)</label><input class="field-input" name="note" placeholder="e.g. Paid via UPI, ref UTR..."></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Push to Finance</button></div></div>
    </form>`);
  document.getElementById("f-quote-paid").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const amount = Math.min(bal, Math.max(1, Number(f.get("amount"))));
    try{
      await apiJson(`/api/crm/quotes/${id}/pending-payments`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ amount, paymentDate:f.get("paymentDate"), note:f.get("note").trim()||"Client confirmed payment" }) });
      await loadQuotes();
      toast("Sent to Finance for confirmation"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't submit payment"); }
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
        <div><label class="field-label">Account Manager</label><select class="field-input" name="accountManager">${employees.map(e=>`<option>${esc(e.name)}</option>`).join('')}</select></div>
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
      <div><label class="field-label">Lead Owner</label><select class="field-input" name="leadOwner">${salesTeamOptions()}</select></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Add lead</button></div></div>
    </form>`);
  document.getElementById("f-add-lead").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      await apiJson("/api/crm/leads", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ name:f.get("name"), phone:f.get("phone"), email:f.get("email"), source:f.get("source"), serviceInterested:f.get("serviceInterested"), leadOwner:f.get("leadOwner") }) });
      await loadLeads();
      toast("Lead added"); closeModal(); render();
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
      <div><label class="field-label">Lead Owner</label><select class="field-input" name="leadOwner">${employees.filter(e=>e.dept==='Sales').map(e=>`<option ${e.name===l.leadOwner?'selected':''}>${esc(e.name)}</option>`).join('')}</select></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Save changes</button></div></div>
    </form>`);
  document.getElementById("f-edit-lead").addEventListener("submit", async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      await apiJson(`/api/crm/leads/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ name:f.get("name"), phone:f.get("phone"), email:f.get("email"), source:f.get("source"), serviceInterested:f.get("serviceInterested"), leadOwner:f.get("leadOwner") }) });
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
  const tasks = tasksOf(clientId).filter(t=>!isTaskArchived(t));
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
        <div><label class="field-label">Assignee</label><select class="field-input" name="assignedTo">${employees.map(e=>`<option>${esc(e.name)}</option>`).join('')}</select></div>
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
        <div><label class="field-label">Assignee</label><select class="field-input" name="assignedTo">${employees.map(e=>`<option ${e.name===t.assignedTo?'selected':''}>${esc(e.name)}</option>`).join('')}</select></div>
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
  const totals = d.rows.reduce((s,r)=>({revenue:s.revenue+r.revenue, directPayroll:s.directPayroll+r.directPayroll, directExpense:s.directExpense+r.directExpense, overheadShare:s.overheadShare+r.overheadShare, totalCost:s.totalCost+r.totalCost, profit:s.profit+r.profit}), {revenue:0,directPayroll:0,directExpense:0,overheadShare:0,totalCost:0,profit:0});
  const sorted = d.rows.slice().sort((a,b)=>b.profit-a.profit);
  const totalMargin = totals.revenue ? (totals.profit/totals.revenue*100) : null;
  return `
  <div class="toolbar">
    <select class="select-sm" onchange="setPayrollMonth(this.value)">${Object.keys(payroll.history).sort().reverse().map(m=>`<option value="${m}" ${m===month?'selected':''}>${MONTH_LABEL[m]}</option>`).join("")}</select>
    <span class="faint" style="font-size:12px;">Revenue: every invoice on record · Costs: ${MONTH_LABEL[month]}</span>
  </div>
  <div class="banner muted">
    <svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg>
    <div><b>How the shared overhead is split.</b> Administrative &amp; Sales payroll (${inr(d.overheadPayroll)}, ${d.overheadHeadcount} people) + Rent (${inr(d.rent)}) + untagged/shared expenses (${inr(d.sharedExpenses)}) = ${inr(d.overheadPool)} pooled overhead this month, divided by ${d.totalHeadcount} client-facing heads = ${inr(Math.round(d.perHeadOverhead))} per person. Each department absorbs its own headcount × that rate — tag an expense to a department in Expenses to make it a direct cost instead. Revenue here is every invoice on record (this sample dataset only has a handful logged), while costs are a full month's payroll — real invoice volume will bring margins to realistic levels.</div>
  </div>
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-label">Total Revenue</div><div class="kpi-value mono" style="font-size:20px;">${inr(totals.revenue)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Direct Payroll</div><div class="kpi-value mono" style="font-size:20px;">${inr(totals.directPayroll)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Allocated Overhead</div><div class="kpi-value mono warn" style="font-size:20px;">${inr(totals.overheadShare)}</div></div>
    <div class="kpi-card hero"><div class="kpi-label">Net Profit</div><div class="kpi-value mono ${totals.profit>=0?'pos':'neg'}" style="font-size:20px;">${inr(totals.profit)}</div><div class="kpi-sub">${totalMargin===null?'—':totalMargin.toFixed(1)+'% margin'}</div></div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Department profitability</h3><div class="sub">${MONTH_LABEL[month]} costs · sorted by profit</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Department</th><th class="num">Headcount</th><th class="num">Revenue</th><th class="num">Direct Payroll</th><th class="num">Direct Expense</th><th class="num">Overhead Share</th><th class="num">Total Cost</th><th class="num">Profit</th><th class="num">Margin</th></tr></thead>
      <tbody>${sorted.map(r=>`<tr>
        <td style="font-weight:700;">${esc(r.dept)}</td>
        <td class="num mono">${r.headcount}</td>
        <td class="num mono">${inr(r.revenue)}</td>
        <td class="num mono muted">${inr(r.directPayroll)}</td>
        <td class="num mono muted">${r.directExpense?inr(r.directExpense):'—'}</td>
        <td class="num mono muted">${inr(r.overheadShare)}</td>
        <td class="num mono">${inr(r.totalCost)}</td>
        <td class="num mono" style="font-weight:700;color:${r.profit>=0?'var(--pos)':'var(--neg)'};">${inr(r.profit)}</td>
        <td class="num mono" style="${r.margin===null?'':'color:'+(r.margin>=0?'var(--pos)':'var(--neg)')+';'}">${r.margin===null?'—':r.margin.toFixed(1)+'%'}</td>
      </tr>`).join("")}
      <tr class="total"><td>Total</td><td class="num mono">${d.totalHeadcount}</td><td class="num mono">${inr(totals.revenue)}</td><td class="num mono">${inr(totals.directPayroll)}</td><td class="num mono">${totals.directExpense?inr(totals.directExpense):'—'}</td><td class="num mono">${inr(totals.overheadShare)}</td><td class="num mono">${inr(totals.totalCost)}</td><td class="num mono" style="color:${totals.profit>=0?'var(--pos)':'var(--neg)'};">${inr(totals.profit)}</td><td class="num mono">${totalMargin===null?'—':totalMargin.toFixed(1)+'%'}</td></tr></tbody>
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
function acctOverview(){
  const revenueMTD = invoices.filter(i=>i.issued.slice(0,7)==="2026-09").reduce((s,i)=>s+invoiceTotal(i),0);
  const receivable = invoices.reduce((s,i)=>s+invoiceBalance(i),0);
  const overdueAmt = invoices.filter(i=>invoiceStatus(i)==="Overdue").reduce((s,i)=>s+invoiceBalance(i),0);
  const payableOutstanding = payables.reduce((s,p)=>s+payableBalance(p),0);
  const expenseMTD = expenses.filter(e=>e.date.slice(0,7)==="2026-09").reduce((s,e)=>s+e.amount,0);
  const cashOnHand = bankAccounts.reduce((s,b)=>s+bankAccountBalance(b.id),0);
  const deptRevenue = DEPARTMENTS.map(d=>({d, n: invoices.reduce((s,i)=>s+(i.items||[]).filter(it=>it.dept===d).reduce((s2,it)=>s2+it.amount,0), 0)})).filter(x=>x.n>0).sort((a,b)=>b.n-a.n);
  const maxDept = Math.max(...deptRevenue.map(x=>x.n),1);
  return `
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div><b>Clearing order for payables:</b> Salary &amp; Rent first, then Commission &amp; Internal Loans, then Vendor bills — per the current payables clearance plan.</div></div>
  <div class="kpi-grid cols-5">
    <div class="kpi-card hero"><div class="kpi-label">Revenue — September</div><div class="kpi-value mono">${inr(revenueMTD)}</div><div class="kpi-sub">invoiced this month</div></div>
    <div class="kpi-card"><div class="kpi-label">Receivables</div><div class="kpi-value mono">${inr(receivable)}</div><div class="kpi-sub">${inr(overdueAmt)} overdue</div></div>
    <div class="kpi-card"><div class="kpi-label">Payables Outstanding</div><div class="kpi-value mono warn">${inr(payableOutstanding)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Expenses — September</div><div class="kpi-value mono">${inr(expenseMTD)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Cash &amp; Bank Balance</div><div class="kpi-value mono pos">${inr(cashOnHand)}</div><div class="kpi-sub">across ${bankAccounts.length} accounts</div></div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Revenue by department</h3><div class="sub">Invoiced, all time (this dataset)</div></div>
    <div class="panel-body">${deptRevenue.length?`<div class="barchart">${deptRevenue.map(x=>`<div class="bar-row"><div class="bar-label">${esc(x.d)}</div><div class="bar-track"><div class="bar-fill" style="width:${(x.n/maxDept)*100}%"></div></div><div class="bar-val mono">${inr(x.n)}</div></div>`).join("")}</div>`:'<div class="empty">No invoiced revenue yet.</div>'}</div>
  </div>`;
}
function acctInvoices(){
  const totalReceivable = invoices.reduce((s,i)=>s+invoiceBalance(i),0);
  const overdueAmt = invoices.filter(i=>invoiceStatus(i)==="Overdue").reduce((s,i)=>s+invoiceBalance(i),0);
  return `
  <div class="toolbar"><div></div><button class="btn primary" onclick="openAddInvoice()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New invoice</button></div>
  <div class="kpi-grid">
    <div class="kpi-card hero"><div class="kpi-label">Total Receivable</div><div class="kpi-value mono">${inr(totalReceivable)}</div><div class="kpi-sub">${inr(overdueAmt)} overdue</div></div>
    <div class="kpi-card"><div class="kpi-label">Total Invoiced</div><div class="kpi-value mono">${inr(invoices.reduce((s,i)=>s+invoiceTotal(i),0))}</div><div class="kpi-sub">${invoices.length} invoices, all time</div></div>
  </div>
  ${(()=>{ const pendingRows=[]; invoices.forEach(inv=>{ (inv.pendingPayments||[]).forEach((p,idx)=>{ if(!p.approved) pendingRows.push({inv,p,idx}); }); }); return `
  <div class="panel">
    <div class="panel-head"><h3>Awaiting confirmation</h3><div class="sub">${pendingRows.length} payment${pendingRows.length===1?'':'s'} Sales collected against an existing invoice</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Invoice</th><th>Client</th><th class="num">This payment</th><th class="num">Balance</th><th>Collected by</th><th>Sales note</th><th></th></tr></thead>
      <tbody>${pendingRows.length?pendingRows.map(({inv,p,idx})=>`<tr><td class="mono">${esc(inv.invoiceNo)}</td><td class="muted">${clientById(inv.clientId).name}</td><td class="num mono">${inr(p.amount)}</td><td class="num mono">${inr(invoiceBalance(inv))}</td><td class="muted">${esc(p.salesPerson||'—')}</td><td class="muted">${esc(p.note||'—')} · ${fmtDateShort(p.date)}</td><td><button class="btn btn-sm primary" onclick="openApproveInvoicePayment('${inv.id}',${idx})"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Approve</button></td></tr>`).join(""):'<tr><td colspan="7"><div class="empty">Nothing waiting on Finance right now.</div></td></tr>'}</tbody>
    </table></div>
  </div>`; })()}
  <div class="panel">
    <div class="panel-head"><h3>Invoices</h3><div class="sub">${invoices.length} total</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Invoice</th><th>Client</th><th>Issued</th><th>Due</th><th class="num">Amount</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
      <tbody>${invoices.slice().sort((a,b)=>b.issued.localeCompare(a.issued)).map(i=>{ const st=invoiceStatus(i), bal=invoiceBalance(i); return `<tr><td class="mono">${i.invoiceNo}</td><td class="muted">${clientById(i.clientId).name}</td><td class="muted">${fmtDateShort(i.issued)}</td><td class="muted">${fmtDateShort(i.due)}</td><td class="num mono">${inr(invoiceTotal(i))}</td><td class="num mono">${bal>0?inr(bal):'<span class="faint">—</span>'}</td><td>${pill(st,invStatusKind(st))}</td><td><div style="display:flex;gap:6px;flex-wrap:wrap;">${bal>0?`<button class="btn btn-sm" onclick="openRecordInvoicePayment('${i.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Record payment</button>`:`<span class="faint" style="font-size:11.5px;">paid in full</span>`}<button class="btn btn-sm ghost" onclick="openEditInvoice('${i.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button><button class="btn btn-sm ghost" onclick="downloadInvoice('${i.id}')" title="Download invoice"><svg class="icon" style="width:12px;height:12px"><use href="#i-download"/></svg>Download</button>${(i.payments||[]).length?`<button class="btn btn-sm ghost" onclick="openInvoicePayments('${i.id}')" title="Payment receipts"><svg class="icon" style="width:12px;height:12px"><use href="#i-receipt"/></svg>Payments</button>`:''}</div></td></tr>`; }).join("")}</tbody>
    </table></div>
  </div>`;
}
function acctPayables(){
  const total = payables.reduce((s,p)=>s+p.amount,0);
  const outstanding = payables.reduce((s,p)=>s+payableBalance(p),0);
  return `
  <div class="toolbar"><div></div><button class="btn primary" onclick="openAddPayable()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New payable</button></div>
  <div class="kpi-grid">
    <div class="kpi-card hero"><div class="kpi-label">Total Payable</div><div class="kpi-value mono warn">${inr(outstanding)}</div><div class="kpi-sub">${payables.filter(p=>payableStatus(p)!=='Paid').length} outstanding</div></div>
    <div class="kpi-card"><div class="kpi-label">Total Logged</div><div class="kpi-value mono">${inr(total)}</div><div class="kpi-sub">${payables.length} payables, all time</div></div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Payables</h3><div class="sub">${inr(total)} total logged · cleared Salary &amp; Rent → Commission &amp; Internal Loans → Vendor</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Category</th><th>Liability Account</th><th>Payee / Purpose</th><th>Due</th><th class="num">Amount</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
      <tbody>${payables.slice().sort((a,b)=>CLEAR_ORDER.indexOf(a.category)-CLEAR_ORDER.indexOf(b.category)).map(p=>{ const st=payableStatus(p), bal=payableBalance(p); return `<tr><td><span class="tag type">${esc(p.category)}</span></td><td class="muted">${esc(liabilityAccountFor(p.category))}</td><td class="muted">${esc(p.payee)}</td><td class="muted">${fmtDateShort(p.due)}</td><td class="num mono">${inr(p.amount)}</td><td class="num mono">${bal>0?inr(bal):'<span class="faint">—</span>'}</td><td>${pill(st,payableStatusKind(st))}</td><td><div style="display:flex;gap:6px;">${bal>0?`<button class="btn btn-sm" onclick="openRecordPayablePayment('${p.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Record payment</button>`:`<span class="faint" style="font-size:11.5px;">paid in full</span>`}<button class="btn btn-sm ghost" onclick="openEditPayable('${p.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button></div></td></tr>`; }).join("")}</tbody>
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
  return employees.filter(e=>e.dept==='Sales').map(e=>{
    const row = commission.find(r=>r.name===e.name);
    return { emp:e, name:e.name, earned: row?row.earned:0, clients: clients.filter(c=>c.salesPerson===e.name).length };
  }).sort((a,b)=>b.earned-a.earned);
}
function acctCommissions(){
  const commissionPayables = payables.filter(p=>p.category==="Commission");
  const salesNames = [...new Set(commissionPayables.map(p=>p.salesPerson).filter(Boolean))];
  const rows = commissionRowsByPerson();
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
  ${pendingWithdrawals.length || decidedWithdrawals.length ? `<div class="panel">
    <div class="panel-head"><h3>Withdrawal requests</h3><div class="sub">${pendingWithdrawals.length} pending</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Sales Person</th><th class="num">Amount</th><th>Requested</th><th>Note</th><th>Status</th><th></th></tr></thead>
      <tbody>${pendingWithdrawals.map(w=>`<tr><td>${esc(w.salesPerson)}</td><td class="num mono">${inr(w.amount)}</td><td class="muted">${fmtDate(w.requested)}</td><td class="muted">${esc(w.note||'—')}</td><td>${pill(w.status,statusKind(w.status))}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-sm" onclick="openApproveCommissionWithdrawal('${w.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Approve</button><button class="btn btn-sm danger" onclick="decideCommissionWithdrawalReject('${w.id}')">Reject</button></div></td></tr>`).join('')}${decidedWithdrawals.map(w=>`<tr><td>${esc(w.salesPerson)}</td><td class="num mono">${inr(w.amount)}</td><td class="muted">${fmtDate(w.requested)}</td><td class="muted">${esc(w.note||'—')}</td><td>${pill(w.status,statusKind(w.status))}</td><td></td></tr>`).join('')}</tbody>
    </table></div>
  </div>`:''}
  <div class="panel">
    <div class="panel-head"><h3>Commission by sales person</h3><div class="sub">Expand a name to see every entry and record a payment — partial payments are fine</div></div>
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
              </span>
            </div>`; }).join('')}
          </div>
        </details>
      </td></tr>`; }).join(""):`<tr><td colspan="5"><div class="empty">No commission earned yet.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}
function acctExpenses(){
  const total = expenses.reduce((s,e)=>s+e.amount,0);
  return `
  <div class="toolbar"><div></div><button class="btn primary" onclick="openAddExpense()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Log expense</button></div>
  <div class="panel">
    <div class="panel-head"><h3>Expenses</h3><div class="sub">${inr(total)} logged · untagged expenses count as shared overhead in Department Profitability</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Category</th><th>Description</th><th>Department</th><th>Date</th><th>Account</th><th class="num">Amount</th><th></th></tr></thead>
      <tbody>${expenses.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(e=>`<tr><td><span class="tag type">${esc(e.category)}</span></td><td class="muted">${esc(e.description)}</td><td class="muted">${e.dept?esc(e.dept):'<span class="faint">Shared</span>'}</td><td class="muted">${fmtDateShort(e.date)}</td><td class="muted">${bankById(e.accountId)?esc(bankById(e.accountId).name):'—'}</td><td class="num mono">${inr(e.amount)}</td><td><button class="btn btn-sm ghost" onclick="openEditExpense('${e.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button></td></tr>`).join("")}
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
      await Promise.all([loadInvoices(), loadBankAccounts()]);
      toast("Payment recorded"); closeModal(); render();
    }catch(err){ toast(err.message || "Couldn't record payment"); }
  });
}
// Sales-side: log a payment they personally collected against an EXISTING invoice and push it to
// Finance — mirrors openRecordQuotePayment() exactly, just against an invoice instead of a quote.
// Nothing touches the invoice balance until Finance confirms it with openApproveInvoicePayment().
function openSubmitInvoicePayment(id){
  const inv = invoices.find(x=>x.id===id);
  const bal = invoiceBalance(inv);
  const client = clientById(inv.clientId);
  const salesEmps = employees.filter(e=>e.dept==='Sales');
  const salesOptions = (salesEmps.length?salesEmps:employees).map(e=>`<option ${e.name===client.salesPerson?'selected':''}>${esc(e.name)}</option>`).join('');
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
      await Promise.all([loadInvoices(), loadBankAccounts(), loadPayables()]);
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
        <div><label class="field-label">Category</label><select class="field-input" name="category"><option>Software</option><option>Equipment</option><option>Travel</option><option>Utilities</option><option>Misc</option></select></div>
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
    const accountId = f.get("accountId"), date = f.get("date"), category = f.get("category"), description = f.get("description"), amount = Number(f.get("amount"));
    try{
      await apiJson("/api/finance/expenses", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ category:TITLECASE_TO_API(category), description, amount, date, accountId, dept:f.get("dept")||undefined }) });
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
        <div><label class="field-label">Category</label><select class="field-input" name="category">${["Software","Equipment","Travel","Utilities","Misc"].map(c=>`<option ${c===e.category?'selected':''}>${c}</option>`).join('')}</select></div>
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
    const accountId = f.get("accountId"), date = f.get("date"), category = f.get("category"), description = f.get("description"), amount = Number(f.get("amount"));
    try{
      await apiJson(`/api/finance/expenses/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ category:TITLECASE_TO_API(category), description, amount, date, accountId, dept:f.get("dept")||undefined }) });
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
      <tbody>${bankAccounts.map(b=>`<tr><td>${esc(b.name)}</td><td class="muted">${esc(b.bank)}</td><td class="mono muted">${esc(b.number)}</td><td class="num mono">${inr(b.opening)}</td><td class="num mono" style="color:var(--pos)">${inr(bankAccountBalance(b.id))}</td><td><div style="display:flex;gap:6px;"><button class="btn btn-sm" onclick="openBankLedger('${b.id}')">View ledger</button><button class="btn btn-sm ghost" onclick="openEditBankAccount('${b.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button></div></td></tr>`).join("")}</tbody>
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
  const pendingRows = [];
  quotes.forEach(q=>{ (q.payments||[]).forEach((p,idx)=>{ if(!p.approved) pendingRows.push({q,p,idx}); }); });
  const filtered = quotes.filter(q=>quotesMonthFilter==='All' || q.createdDate.slice(0,7)===quotesMonthFilter);
  const rest = filtered.slice().sort((a,b)=>b.createdDate.localeCompare(a.createdDate));
  return `
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Sales pushes a payment here as soon as the client pays — even a partial one. Confirm which account the money actually landed in before approving — that's what creates (or tops up) the invoice and posts it to the bank ledger. Approving a lead's first payment also turns them into a client automatically.</div></div>
  <div class="panel">
    <div class="panel-head"><h3>Awaiting confirmation</h3><div class="sub">${pendingRows.length} payment${pendingRows.length===1?'':'s'} pushed by Sales · all months</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Quote</th><th>For</th><th class="num">This payment</th><th class="num">Quote total</th><th>Sales note</th><th>Prepared by</th><th></th></tr></thead>
      <tbody>${pendingRows.length?pendingRows.map(({q,p,idx})=>{ const party=quoteParty(q); return `<tr><td style="font-weight:700;">${esc(q.title)}</td><td class="muted">${esc(party.name)}${party.kind==='lead'?' '+pill('Lead','blue'):''}</td><td class="num mono">${inr(p.amount)}</td><td class="num mono">${inr(quoteTotal(q))}</td><td class="muted">${esc(p.note||'—')} · ${fmtDateShort(p.date)}</td><td class="muted">${esc(q.createdBy)}</td><td><button class="btn btn-sm primary" onclick="openApproveQuotePayment('${q.id}',${idx})"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Approve</button></td></tr>`; }).join(""):'<tr><td colspan="7"><div class="empty">Nothing waiting on Finance right now.</div></td></tr>'}</tbody>
    </table></div>
  </div>
  <div class="panel">
    <div class="panel-head" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;"><div><h3>All quotes</h3><div class="sub">${filtered.length} of ${quotes.length}${quotesMonthFilter!=='All'?' in '+monthLabel(quotesMonthFilter):' total'}</div></div><div class="filter-group"><span class="filter-label">Month</span><select class="select-sm" onchange="setQuotesMonthFilter(this.value)">${monthFilterOptions(quotes.map(q=>q.createdDate), quotesMonthFilter)}</select></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Quote</th><th>For</th><th>Service(s)</th><th class="num">Amount</th><th class="num">Approved so far</th><th>Status</th><th></th></tr></thead>
      <tbody>${rest.map(q=>{ const party=quoteParty(q); const paid=quoteApprovedPaid(q); return `<tr><td>${esc(q.title)}</td><td class="muted">${esc(party.name)}${party.kind==='lead'?' '+pill('Lead','blue'):''}</td><td class="muted">${q.items.map(i=>esc(i.dept)).join(', ')}</td><td class="num mono">${inr(quoteTotal(q))}</td><td class="num mono">${paid>0?inr(paid):'<span class="faint">—</span>'}</td><td>${pill(q.status,quoteStatusKind(q.status))}${q.status==='Invoiced'&&q.invoiceId?` <span class="faint" style="font-size:11px;">${esc(q.invoiceId)}</span>`:''}</td><td><button class="btn btn-sm ghost" onclick="downloadQuote('${q.id}')" title="Download quote"><svg class="icon" style="width:12px;height:12px"><use href="#i-download"/></svg>Download</button></td></tr>`; }).join("") || `<tr><td colspan="7"><div class="empty">No quotes that month.</div></td></tr>`}</tbody>
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
      await Promise.all([loadQuotes(), loadClients(), loadLeads(), loadInvoices(), loadPayables(), loadBankAccounts()]);
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
  const sorted = journalEntries.slice().sort((a,b)=>b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  return `
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>For anything the structured forms (Invoices, Payables, Expenses, Banks) don't capture — write-offs, accruals, corrections. Each entry must balance (total debits = total credits). Debit increases an Asset or Expense; Credit increases a Liability or Income. A line against a bank account posts straight to that account's ledger. Entries are permanent once posted — a correction goes in as a new entry, never an edit to history.</div></div>
  <div class="toolbar"><div></div><button class="btn primary" onclick="openAddJournalEntry()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>New journal entry</button></div>
  <div class="panel">
    <div class="panel-head"><h3>Journal entries</h3><div class="sub">${journalEntries.length} entries</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Memo</th><th>Lines</th><th class="num">Amount</th></tr></thead>
      <tbody>${sorted.map(j=>`<tr><td class="muted">${fmtDate(j.date)}</td><td style="font-weight:600;">${esc(j.memo)}</td><td class="muted" style="font-size:12px;">${j.lines.map(l=>`${esc(journalAccountLabel(l.account))} ${l.side==='debit'?'Dr':'Cr'} ${inr(l.amount)}`).join(' · ')}</td><td class="num mono">${inr(journalEntryTotal(j))}</td></tr>`).join("") || `<tr><td colspan="4"><div class="empty">No journal entries yet.</div></td></tr>`}</tbody>
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
  const isSales = roles.includes('SALES');
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
  if(emp.isAdmin || roles.includes('SALES')) crmContentJobs.push(loadCrmModule());
  if(emp.isAdmin || roles.includes('CONTENT')) crmContentJobs.push(loadContentModule());
  await Promise.all([loadHrModule(), loadFinanceModule(), ...crmContentJobs]);
  nav.module = isHRRole(emp) ? 'hr' : ((isStaffRole(emp) || isSalesRole(emp)) ? 'workspace' : 'dashboard');
  const landingMod = visibleModules().find(m=>m.id===nav.module);
  nav.sub[nav.module] = (landingMod && landingMod.sub && landingMod.sub.length) ? landingMod.sub[0].id : (nav.sub[nav.module] || 'overview');
  document.getElementById('app-shell').hidden = false;
  render();
}).catch((err) => { console.error(err); /* Auth.init() already redirects to /login.html on failure */ });
