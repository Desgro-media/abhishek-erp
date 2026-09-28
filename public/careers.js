// Split out of careers.html into its own file — the server's CSP allows external scripts
// (script-src 'self') but blocks inline <script> tags entirely (only inline onclick=/onchange=
// attributes are relaxed, via script-src-attr — see app.ts's helmet() comment). An inline
// <script> block here would silently never execute at all: the page would sit frozen on its
// static "Loading current openings…" text forever, with no error visible anywhere but the
// browser console's own CSP violation log.
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let positions = [];
const MAX_RESUME_BYTES = 5 * 1024 * 1024; // matches MAX_RESUME_BYTES in server/src/config/uploads.ts — checked here too so a
                                           // too-large file never reaches the network at all, not just the server's own check.

async function loadPositions(){
  const panel = document.getElementById("positions-panel");
  const lede = document.getElementById("lede");
  try{
    const res = await fetch("/api/public/positions");
    const data = await res.json();
    positions = data.positions || [];
    if(!positions.length){
      lede.textContent = "No open roles right now — check back soon.";
      panel.innerHTML = `<div class="empty">Nothing open at the moment.</div>`;
      return;
    }
    lede.textContent = "We're hiring — pick a role below to apply.";
    panel.innerHTML = positions.map(p => `
      <div class="role-row">
        <div>
          <div class="role-name">${esc(p.role)}</div>
          <div class="role-meta">${esc(p.dept)} · ${p.openings} opening${p.openings===1?"":"s"}</div>
        </div>
        <button class="btn primary" onclick="openApplyModal('${p.id}')">Apply</button>
      </div>`).join("");
  }catch(err){
    lede.textContent = "";
    panel.innerHTML = `<div class="error-msg">Couldn't load openings right now — please try again shortly.</div>`;
  }
}

function openApplyModal(positionId){
  const p = positions.find(x => x.id === positionId);
  if(!p) return;
  document.getElementById("f-position-id").value = p.id;
  document.getElementById("apply-role-title").textContent = "Apply — " + p.role;
  document.getElementById("apply-role-meta").textContent = p.dept;
  document.getElementById("f-name").value = "";
  document.getElementById("f-phone").value = "";
  document.getElementById("f-email").value = "";
  document.getElementById("f-resume").value = "";
  document.getElementById("apply-error").innerHTML = "";
  document.getElementById("apply-submit-btn").disabled = false;
  document.getElementById("apply-submit-btn").textContent = "Submit application";
  document.getElementById("apply-modal").hidden = false;
}
function closeApplyModal(){ document.getElementById("apply-modal").hidden = true; }

document.getElementById("apply-form").addEventListener("submit", async e => {
  e.preventDefault();
  const positionId = document.getElementById("f-position-id").value;
  const name = document.getElementById("f-name").value.trim();
  const phone = document.getElementById("f-phone").value.trim();
  const email = document.getElementById("f-email").value.trim();
  const resumeFile = document.getElementById("f-resume").files[0];
  const errorEl = document.getElementById("apply-error");
  errorEl.innerHTML = "";
  if(!name){ errorEl.innerHTML = `<div class="error-msg">Enter your name.</div>`; return; }
  if(!phone && !email){ errorEl.innerHTML = `<div class="error-msg">Add a phone number or an email.</div>`; return; }
  if(resumeFile){
    if(resumeFile.type !== "application/pdf"){ errorEl.innerHTML = `<div class="error-msg">Resume must be a PDF.</div>`; return; }
    if(resumeFile.size > MAX_RESUME_BYTES){ errorEl.innerHTML = `<div class="error-msg">Resume must be 5MB or smaller.</div>`; return; }
  }
  const btn = document.getElementById("apply-submit-btn");
  btn.disabled = true; btn.textContent = "Submitting…";
  try{
    // multipart/form-data, not JSON — the resume file has to travel as a real file part, and
    // fetch sets the correct boundary header itself once the body is a FormData (setting
    // Content-Type by hand here would drop that boundary and break parsing server-side).
    const form = new FormData();
    form.set("positionId", positionId);
    form.set("name", name);
    if(phone) form.set("phone", phone);
    if(email) form.set("email", email);
    if(resumeFile) form.set("resume", resumeFile);
    const res = await fetch("/api/public/apply", { method: "POST", body: form });
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || "Couldn't submit your application");
    closeApplyModal();
    document.getElementById("positions-panel").innerHTML = `
      <div class="success">
        <div class="icon-circle">✓</div>
        <div style="font-weight:800;font-size:17px;margin-bottom:6px;">Application received</div>
        <div class="lede">Thanks for applying — we'll be in touch if it's a fit.</div>
      </div>`;
    document.getElementById("lede").textContent = "";
  }catch(err){
    errorEl.innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
    btn.disabled = false; btn.textContent = "Submit application";
  }
});

loadPositions();
