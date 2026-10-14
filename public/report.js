// Client report page — opened from the link a DesGro account manager shares; no sign-in, read only. Own file because the
// server's CSP blocks inline <script> blocks (see careers.js). The token in the URL (?t=...) is the only credential. Shows the
// client's ad numbers month by month, their campaign brief and the meetings log — nothing else about the account.
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const token = (new URLSearchParams(location.search).get("t") || "").trim();
const root = document.getElementById("root");
const monthName = m => new Date(m + "-01T00:00:00Z").toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const dayName = d => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const inr = n => "₹" + Math.round(n).toLocaleString("en-IN");
const msg = (t, b) => `<div class="panel"><h1>${esc(t)}</h1><div class="muted">${esc(b)}</div></div>`;

async function load(month){
  if(!token){ root.innerHTML = msg("This link isn't valid", "Please ask your DesGro Media account manager for the latest link."); return; }
  let res, d;
  try{ res = await fetch(`/api/public/client-report/${encodeURIComponent(token)}${month ? "?month=" + encodeURIComponent(month) : ""}`); d = await res.json(); }
  catch(e){ root.innerHTML = msg("Couldn't load your report", "Please check your connection and try again."); return; }
  if(!res.ok){ root.innerHTML = msg("This link isn't valid", "It may have been replaced or switched off. Please ask your DesGro Media account manager for the latest link."); return; }
  render(d);
}
// "▲ 12%" against last month; for cost per lead lower is better.
function change(now, was, lowerIsBetter){
  if(now == null || was == null || was === 0) return `<span class="d">no earlier month to compare</span>`;
  const pct = Math.round((now - was) / was * 100); if(pct === 0) return `<span class="d">same as last month</span>`;
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  return `<span class="d"><span class="${good ? "up" : "down"}">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%</span> vs last month</span>`;
}
function render(d){
  const t = d.totals, p = d.prevTotals;
  const kpi = (l, v, sub) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${sub || ""}</div>`;
  const has = t.days > 0;
  root.innerHTML = `<div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;">
      <div><div class="eyebrow">${esc(d.clientName)}</div><h1>Your campaign report</h1><div class="muted">Your ad numbers, campaign brief and our meetings with you.</div></div>
      <label style="font-size:12px;font-weight:700;color:var(--ink-soft);">Month<br><select id="mo">${d.months.map(m => `<option value="${m}" ${m === d.month ? "selected" : ""}>${monthName(m)}</option>`).join("")}</select></label>
    </div>
    ${has ? `<div class="kpis">
      ${kpi("Ad spend", inr(t.spend), change(t.spend, p.spend, false))}
      ${kpi("Leads", t.leads, change(t.leads, p.leads, false))}
      ${kpi("Cost per lead", t.cpl == null ? "—" : inr(t.cpl), change(t.cpl, p.cpl, true))}
      ${kpi("Sales", t.purchases, change(t.purchases, p.purchases, false))}
      ${kpi("Revenue", inr(t.revenue), change(t.revenue, p.revenue, false))}
      ${kpi("Return on ad spend", t.roas == null ? "—" : t.roas.toFixed(1) + "x", change(t.roas, p.roas, false))}
    </div>
    <div class="note">Based on ${t.days} day${t.days === 1 ? "" : "s"} of numbers in ${esc(monthName(d.month))}.</div>` : `<div class="muted" style="margin-top:16px;">No ad numbers have been logged for ${esc(monthName(d.month))} yet.</div>`}
  </div>
  ${has ? `<div class="panel sec"><h2>Day by day</h2><div class="tw"><table><thead><tr><th>Date</th><th class="n">Spend</th><th class="n">Leads</th><th class="n">Cost / lead</th><th class="n">Sales</th><th class="n">Revenue</th><th class="n">ROAS</th></tr></thead><tbody>
    ${d.daily.map(r => `<tr><td>${dayName(r.date)}</td><td class="n">${inr(r.spend)}</td><td class="n">${r.leads}</td><td class="n">${r.leads ? inr(r.spend / r.leads) : "—"}</td><td class="n">${r.purchases}</td><td class="n">${inr(r.revenue)}</td><td class="n">${r.spend > 0 ? (r.revenue / r.spend).toFixed(1) + "x" : "—"}</td></tr>`).join("")}
  </tbody></table></div></div>` : ""}
  ${d.brief ? `<div class="panel sec"><h2>Campaign brief</h2><div class="brief">
    ${[["Objective", d.brief.objective], ["Audience", d.brief.audience], ["Budget", d.brief.budget]].map(([l, v]) => `<div><div class="l">${l}</div><div>${v ? esc(v) : "—"}</div></div>`).join("")}
  </div></div>` : ""}
  ${d.meetings.length ? `<div class="panel sec"><h2>Our meetings</h2>${d.meetings.map(m => `<div class="mtg"><div style="font-weight:700;font-size:13px;">${dayName(m.date)} <span class="muted" style="font-weight:500;">· ${esc(m.attendees)}</span></div><div style="font-size:13px;margin-top:4px;white-space:pre-wrap;">${esc(m.notes)}</div></div>`).join("")}</div>` : ""}
  <div class="note" style="text-align:center;margin-top:18px;">Prepared by DesGro Media · figures are as logged by your campaign team.</div>`;
  const sel = document.getElementById("mo");
  if(sel) sel.addEventListener("change", () => load(sel.value));
}
load();
