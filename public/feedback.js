// Client feedback page — opened from the link an account manager shares; no sign-in. Kept in its own file because the
// server's CSP blocks inline <script> blocks (see careers.js). The token in the URL (?t=...) is the only credential:
// it names one client and month and lists the services to rate. ?preview=1 shows the form without saving anything.
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const params = new URLSearchParams(location.search);
const token = (params.get("t") || "").trim();
const preview = params.get("preview") === "1";
const root = document.getElementById("root");
const LABELS = ["Poor", "Fair", "Good", "Great", "Excellent"];
const monthName = m => new Date(m + "-01T00:00:00Z").toLocaleString("en-US", { month: "long", timeZone: "UTC" });
const previewBanner = () => preview ? `<div class="preview"><b>Preview.</b> This is what the client sees when they open the link. Nothing is saved.</div>` : "";
const message = (title, body) => `${previewBanner()}<div class="panel"><h1>${esc(title)}</h1><div class="muted">${esc(body)}</div></div>`;

async function load(){
  if(!token){ root.innerHTML = message("This link isn't valid", "Please ask your DesGro Media account manager for the latest link."); return; }
  let res, data;
  try{ res = await fetch("/api/public/client-feedback/" + encodeURIComponent(token)); data = await res.json(); }
  catch(e){ root.innerHTML = message("Couldn't load this page", "Please check your connection and try again."); return; }
  if(!res.ok){ root.innerHTML = message("This link isn't valid", "It may have been replaced by a newer one. Please ask your DesGro Media account manager for the latest link."); return; }
  if(!data.open){ root.innerHTML = message(`Feedback for ${monthName(data.month)} has closed`, "Thank you for working with us. Your account manager will share a new link next month."); return; }
  render(data);
}

function render(d){
  const M = monthName(d.month);
  root.innerHTML = `${previewBanner()}<div class="panel">
    <div class="eyebrow">${esc(d.clientName)}</div>
    <h1>How did we do in ${esc(M)}?</h1>
    <div class="muted">Rate each service from 1 (poor) to 5 (excellent). It takes under a minute, and it goes straight to the team handling that work.</div>
    <form id="f">
      ${d.depts.map((dept, i) => `<fieldset><legend>${esc(dept)}</legend>
        ${d.rated[dept] ? `<div class="note">You rated this ${d.rated[dept]} ★ already this month — rating again replaces it.</div>` : ""}
        <div class="stars" role="radiogroup" aria-label="${esc(dept)} rating">${[1,2,3,4,5].map(n => `<label class="star"><input type="radio" name="r${i}" value="${n}" ${d.rated[dept] === n ? "checked" : ""}><span class="s">${"★".repeat(n)}</span><span class="l">${LABELS[n-1]}</span></label>`).join("")}</div>
        <textarea name="c${i}" rows="2" maxlength="1000" placeholder="What worked, and what should we do better? (optional)"></textarea>
      </fieldset>`).join("")}
      <label class="f" for="nm">Your name (optional)</label>
      <input type="text" id="nm" name="name" maxlength="80" placeholder="So we know who to thank">
      <div id="err" class="err" hidden></div>
      <button class="btn" type="submit" id="send">Send feedback</button>
    </form></div>`;
  document.getElementById("f").addEventListener("submit", e => submit(e, d));
}

async function submit(e, d){
  e.preventDefault();
  const f = new FormData(e.target), err = document.getElementById("err"), btn = document.getElementById("send");
  const ratings = d.depts.map((dept, i) => ({ dept, rating: Number(f.get("r" + i)), comment: (f.get("c" + i) || "").trim() })).filter(x => x.rating);
  const name = (f.get("name") || "").trim();
  if(!ratings.length){ err.textContent = "Please pick a rating for at least one service."; err.hidden = false; return; }
  err.hidden = true; btn.disabled = true;
  if(!preview){
    try{
      const res = await fetch("/api/public/client-feedback/" + encodeURIComponent(token), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ratings, name }) });
      const out = await res.json().catch(() => ({}));
      if(!res.ok){ err.textContent = out.error || "Couldn't send your feedback — please try again."; err.hidden = false; btn.disabled = false; return; }
    }catch(ex){ err.textContent = "Couldn't send your feedback — please check your connection and try again."; err.hidden = false; btn.disabled = false; return; }
  }
  root.innerHTML = `${previewBanner()}<div class="panel done"><div class="big">★★★★★</div><h1>Thank you${name ? ", " + esc(name.split(" ")[0]) : ""}!</h1><div class="muted">${preview ? "Preview only — nothing was saved." : `Your feedback on ${ratings.length} service${ratings.length > 1 ? "s" : ""} has reached the team.`}</div></div>`;
}
load();
