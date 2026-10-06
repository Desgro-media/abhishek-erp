// External file, not an inline <script> — the server's CSP blocks inline scripts (see careers.js).
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const $ = id => document.getElementById(id);

async function loadServices(){
  const sel = $("f-service");
  try{
    const res = await fetch("/api/public/lead-services");
    const { services } = await res.json();
    sel.innerHTML = `<option value="">Select a service…</option>` + services.map(s => `<option>${esc(s)}</option>`).join("");
  }catch(err){
    sel.innerHTML = `<option value="">Couldn't load services — refresh the page</option>`;
  }
}

$("lead-form").addEventListener("submit", async e => {
  e.preventDefault();
  const errorEl = $("form-error");
  errorEl.innerHTML = "";
  const name = $("f-name").value.trim();
  const email = $("f-email").value.trim();
  const phone = $("f-phone").value.trim();
  const serviceInterested = $("f-service").value;
  const notes = $("f-notes").value.trim();
  const fail = msg => { errorEl.innerHTML = `<div class="error-msg">${esc(msg)}</div>`; };
  if(!name) return fail("Enter your name or business.");
  if(!email && !phone) return fail("Add a phone number or an email so we can reach you.");
  if(!serviceInterested) return fail("Pick the service you're interested in.");

  const btn = $("submit-btn");
  btn.disabled = true; btn.textContent = "Sending…";
  try{
    const res = await fetch("/api/public/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, phone, serviceInterested, notes, website: $("f-website").value }),
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok){
      const field = data.details && Object.values(data.details).flat()[0];
      throw new Error(field || data.error || "Couldn't send your details");
    }
    $("panel").innerHTML = `
      <div class="success">
        <div class="icon-circle">✓</div>
        <h2>Thank you!</h2>
        <div class="lede" style="margin:0;">We've received your details and our team will be in touch soon.</div>
      </div>`;
  }catch(err){
    fail(err.message);
    btn.disabled = false; btn.textContent = "Get in touch";
  }
});

loadServices();
