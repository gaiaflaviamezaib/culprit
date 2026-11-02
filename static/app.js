const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Local calendar dates (toISOString would shift to UTC in the evening).
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => isoDay(new Date());
const parseDay = (s) => new Date(`${s}T12:00:00`);
const icons = () => window.lucide && lucide.createIcons();
const VERDICT_LABEL = { reaction: "Reaction", tolerated: "Tolerated", unclear: "Unclear", "not enough data": "Collecting data" };
const VERDICT_ICON = { reaction: "flame", tolerated: "circle-check", unclear: "circle-help", "not enough data": "hourglass" };
const verdictClass = (v) => (v === "not enough data" ? "nodata" : v);

// Photos from Unsplash (free to use), one per product type.
const photo = (id, w = 200) => `https://images.unsplash.com/photo-${id}?w=${w}&h=${w}&fit=crop&q=70&auto=format`;
const CATEGORY_PHOTOS = {
  Cleanser: "1605204350321-cfd0ac0702e1",
  Toner: "1599847987657-881f11b92a75",
  Serum: "1573461160327-b450ce3d8e7f",
  Moisturizer: "1585945037805-5fd82c2e60b1",
  Sunscreen: "1672749489615-2eb286c851e5",
  Makeup: "1512496015851-a90fb38ba796",
  "Body care": "1619451427882-6aaaded0cc61",
  Other: "1583209814683-c023dd293cc6",
};
const productPhoto = (p, w) => (p.image ? p.image : photo(CATEGORY_PHOTOS[p.category] || CATEGORY_PHOTOS.Other, w));

const CONCERNS = {
  redness: { label: "redness", icon: "flame" },
  acne: { label: "breakouts", icon: "circle-dot" },
  texture: { label: "texture", icon: "waves" },
  pore: { label: "pores", icon: "grip" },
  oiliness: { label: "oiliness", icon: "droplet" },
  moisture: { label: "moisture", icon: "droplets" },
};
const LEVEL_WIDTH = { strong: 95, likely: 75, possible: 50, weak: 25, cleared: 5 };

let state = null;
let chart = null;
let highlight = null;

async function api(path, options = {}) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}

const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function toast(msg, icon = "info") {
  const el = $("#toast");
  el.innerHTML = `<i data-lucide="${icon}"></i><span>${esc(msg)}</span>`;
  el.hidden = false;
  icons();
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 3500);
}

function sparkle(x, y, emojis = ["✨", "💖", "🌸", "✨"]) {
  for (let i = 0; i < 16; i++) {
    const s = document.createElement("span");
    s.className = "spark";
    s.textContent = emojis[i % emojis.length];
    const angle = (Math.PI * 2 * i) / 16;
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    s.style.setProperty("--dx", `${Math.cos(angle) * (60 + Math.random() * 60)}px`);
    s.style.setProperty("--dy", `${Math.sin(angle) * (60 + Math.random() * 60)}px`);
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 950);
  }
}

/* ---------- tabs ---------- */
document.querySelectorAll(".tabs button").forEach((btn) =>
  btn.addEventListener("click", () => showTab(btn.dataset.tab))
);
function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === name));
  closePopover();
  if (name === "timeline") { renderChart(); renderDiary(); } else stopDiary();
  if (name === "culprits") requestAnimationFrame(fillMeters);
  if (name === "map") renderMap();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- render ---------- */
function render(newState) {
  state = newState;
  const mode = $("#mode");
  $("#mode-text").textContent = state.mock ? "Demo mode (simulated scores)" : "Live YouCam API";
  mode.classList.toggle("live", !state.mock);
  renderSummary();
  renderProducts();
  renderCulprits();
  renderVisits();
  if ($("#timeline").classList.contains("active")) { renderChart(); renderDiary(); }
  if ($("#map").classList.contains("active")) renderMap();
  icons();
  requestAnimationFrame(() => { fillRings(); fillMeters(); });
}

function scoreClass(v) {
  return v >= 70 ? "good" : v >= 55 ? "warn" : "bad";
}

function scoreCards(scores) {
  const r = 33, circ = 2 * Math.PI * r;
  return `<div class="scores">${Object.keys(CONCERNS)
    .filter((k) => scores[k] != null)
    .map((k, i) => `<div class="score ${scoreClass(scores[k])}" style="animation-delay:${i * 70}ms">
      <div class="ring"><svg viewBox="0 0 78 78"><circle class="track" cx="39" cy="39" r="${r}"/>
        <circle class="fill" cx="39" cy="39" r="${r}" stroke-dasharray="${circ}" stroke-dashoffset="${circ}" data-target="${circ * (1 - scores[k] / 100)}"/></svg>
        <span class="num" data-count="${scores[k]}">0</span></div>
      <div class="label"><i data-lucide="${CONCERNS[k].icon}"></i>${CONCERNS[k].label}</div></div>`)
    .join("")}</div><p class="hint" style="margin-top:8px"><i data-lucide="info"></i>YouCam score out of 100, higher is healthier.</p>`;
}

function fillRings() {
  document.querySelectorAll(".ring .fill[data-target]").forEach((c) => {
    c.style.strokeDashoffset = c.dataset.target;
    c.removeAttribute("data-target");
  });
  document.querySelectorAll(".num[data-count]").forEach((el) => {
    const target = +el.dataset.count;
    el.removeAttribute("data-count");
    const start = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - start) / 900);
      el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function streak(checkins) {
  const days = new Set(checkins.map((c) => c.date));
  let n = 0;
  const d = parseDay(checkins[checkins.length - 1].date);
  while (days.has(isoDay(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function renderSummary() {
  const el = $("#summary");
  const { checkins, products, culprits } = state;
  const hour = new Date().getHours();
  $("#greeting").textContent = `${hour < 12 ? "Good morning" : hour < 18 ? "Hi there" : "Good evening"}! Ready for today's skin check?`;
  if (!checkins.length) {
    el.innerHTML = `<div class="card">
      <div class="card-head"><span class="icon-bubble"><i data-lucide="wand"></i></span><div><h3>How Culprit works</h3>
      <p class="muted small">Like a dermatologist's detective work, done automatically from your own skin data.</p></div></div>
      <div class="steps">
        <div class="step"><span class="n">1</span><span class="icon-bubble"><i data-lucide="camera"></i></span><b>Daily selfie</b><p>YouCam AI scores redness, breakouts and texture.</p></div>
        <div class="step"><span class="n">2</span><span class="icon-bubble"><i data-lucide="flask-conical"></i></span><b>Log products</b><p>Scan the barcode, the ingredients come in automatically.</p></div>
        <div class="step"><span class="n">3</span><span class="icon-bubble"><i data-lucide="fingerprint"></i></span><b>Catch the culprit</b><p>Culprit compares your skin before and after each product.</p></div>
      </div>
      <button class="primary" id="demo-inline"><i data-lucide="play"></i>See a 6-week example</button></div>`;
    $("#demo-inline").addEventListener("click", loadDemo);
    return;
  }
  const last = checkins[checkins.length - 1];
  const testing = products.filter((p) => p.evaluation.verdict === "not enough data" && !p.stop_date);
  const top = culprits.ingredients.filter((i) => ["strong", "likely"].includes(i.level));
  el.innerHTML = `
    <div class="stats">
      <div class="stat"><span class="icon-bubble"><i data-lucide="camera"></i></span><div><b>${checkins.length}</b><span>check-ins</span></div></div>
      <div class="stat"><span class="icon-bubble"><i data-lucide="flame"></i></span><div><b>${streak(checkins)} day${streak(checkins) === 1 ? "" : "s"}</b><span>current streak</span></div></div>
      <div class="stat"><span class="icon-bubble"><i data-lucide="flask-conical"></i></span><div><b>${products.length}</b><span>products tracked</span></div></div>
      <div class="stat"><span class="icon-bubble"><i data-lucide="fingerprint"></i></span><div><b>${top.length}</b><span>main suspect${top.length === 1 ? "" : "s"}</span></div></div>
    </div>
    <div class="card">
      <div class="card-head"><span class="icon-bubble"><i data-lucide="scan-face"></i></span><div><h3>Latest skin scores</h3>
      <p class="muted small">${esc(parseDay(last.date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }))}${last.mock ? " · simulated" : " · YouCam AI"}</p></div></div>
      ${scoreCards(last.scores)}
      ${testing.length ? `<p class="next"><i data-lucide="hourglass"></i><span>Currently testing <b>${testing.map((p) => esc(p.name)).join(", ")}</b>. Keep checking in daily.</span></p>` : ""}
      ${top.length ? `<p class="next"><i data-lucide="fingerprint"></i><span>Top suspects: <b>${top.map((i) => esc(i.name)).join(", ")}</b>. <a href="#" data-goto="culprits">See the investigation</a></span></p>` : ""}
    </div>`;
  el.querySelectorAll("[data-goto]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); showTab(a.dataset.goto); }));
}

function renderProducts() {
  const el = $("#product-list");
  if (!state.products.length) {
    el.innerHTML = `<div class="card muted">No products yet. Add the ones you use, with the date you started each.</div>`;
    return;
  }
  const suspects = new Map(state.culprits.ingredients.map((i) => [i.name, i.level]));
  el.innerHTML = [...state.products].reverse().map((p) => {
    const ev = p.evaluation;
    const chips = p.ingredients.map((i) => {
      const lvl = suspects.get(i);
      const cls = lvl === "strong" || lvl === "likely" ? "bad" : lvl ? "warn" : p.ingredient_families?.[i] ? "fam" : "";
      return `<button type="button" class="chip ${cls}" data-ing="${esc(i)}" data-pid="${p.id}">${esc(i)}</button>`;
    }).join("");
    return `<div class="card product">
      <img class="thumb${p.image ? " real" : ""}" src="${esc(productPhoto(p, 160))}" alt="" loading="lazy">
      <div>
        <div class="name">${esc(p.name)}</div>
        <div class="meta">${p.brand ? `<span><i data-lucide="tag"></i>${esc(p.brand)}</span>` : ""}${p.category ? `<span><i data-lucide="flask-round"></i>${esc(p.category)}</span>` : ""}
          <span><i data-lucide="calendar-days"></i>started ${esc(p.start_date)}${p.stop_date ? `, stopped ${esc(p.stop_date)}` : ""}</span></div>
      </div>
      <span class="badge ${verdictClass(ev.verdict)}"><i data-lucide="${VERDICT_ICON[ev.verdict]}"></i>${VERDICT_LABEL[ev.verdict]}${ev.verdict !== "not enough data" ? ` · ${ev.confidence}` : ""}</span>
      <p class="explain">${esc(ev.explanation)}</p>
      <details><summary>${p.ingredients.length} ingredients${p.flagged.length ? ` · contains ${esc(p.flagged.join(", ").toLowerCase())}` : ""} · tap one to learn more</summary>
        <div class="chips">${chips}</div></details>
      <div class="actions">
        ${p.stop_date ? "" : `<button class="ghost small" data-stop="${p.id}"><i data-lucide="circle-pause"></i>Stopped using</button>`}
        <button class="ghost small" data-del="${p.id}"><i data-lucide="trash-2"></i>Remove</button>
      </div>
    </div>`;
  }).join("");
  el.querySelectorAll("[data-stop]").forEach((b) => b.addEventListener("click", async () => {
    render(await api(`/api/products/${b.dataset.stop}/stop`, json({ stop_date: today() })));
    toast("Marked as stopped", "circle-pause");
  }));
  el.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
    if (confirm("Remove this product?")) render(await api(`/api/products/${b.dataset.del}`, { method: "DELETE" }));
  }));
  el.querySelectorAll(".chip[data-ing]").forEach((c) => c.addEventListener("click", (e) => { e.stopPropagation(); showIngredient(c); }));
}

/* ---------- ingredient popover ---------- */
function showIngredient(chip) {
  const name = chip.dataset.ing;
  const product = state.products.find((p) => String(p.id) === chip.dataset.pid);
  const fams = product?.ingredient_families?.[name] || [];
  const suspect = state.culprits.ingredients.find((i) => i.name === name);
  const others = state.products.filter((p) => p.ingredients.includes(name)).map((p) => p.name);
  const pop = $("#popover");
  pop.innerHTML = `<b>${esc(name)}</b>
    ${suspect ? `<span class="badge ${suspect.level}">${suspect.level} suspect</span>` : `<span class="badge cleared">not a suspect</span>`}
    ${fams.map((f) => `<p><strong>${esc(f)}.</strong> ${esc(state.family_notes?.[f] || "")}</p>`).join("")}
    <p>In ${others.length} of your products: ${others.map(esc).join(", ")}.</p>`;
  const r = chip.getBoundingClientRect();
  pop.hidden = false;
  const left = Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 12);
  pop.style.left = `${Math.max(12, left)}px`;
  pop.style.top = `${window.scrollY + r.bottom + 8}px`;
}
function closePopover() { $("#popover").hidden = true; }
document.addEventListener("click", (e) => { if (!e.target.closest("#popover")) closePopover(); });

function productNames(ids) {
  const byId = new Map(state.products.map((p) => [p.id, p.name]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function renderCulprits() {
  const c = state.culprits;
  const reactive = productNames(c.reactive);
  const tolerated = productNames(c.tolerated);
  // Every ingredient tied at the top level shares the poster.
  const topLevel = ["strong", "likely"].find((l) => c.ingredients.some((i) => i.level === l));
  const primes = c.ingredients.filter((i) => i.level === topLevel).slice(0, 3);
  const prime = primes[0];

  $("#verdict-line").textContent = reactive.length
    ? `${reactive.length} product${reactive.length > 1 ? "s" : ""} caused a reaction. ${tolerated.length} tolerated product${tolerated.length === 1 ? "" : "s"} cleared ${c.cleared_count ?? 0} shared ingredient${c.cleared_count === 1 ? "" : "s"}.`
    : "No reaction detected yet. Keep checking in and logging products.";

  $("#wanted").innerHTML = prime ? `<div class="wanted">
      <span class="stamp">PRIME SUSPECT${primes.length > 1 ? "S" : ""}</span>
      <div class="seal"><i data-lucide="fingerprint"></i></div>
      <div><span class="tag">Most likely culprit${primes.length > 1 ? `s (tied)` : ""}</span><h2>${primes.map((i) => esc(i.name)).join(" + ")}</h2>
        <ul>
          <li><i data-lucide="flame"></i>In ${prime.in_reactive.length} of ${c.reactive.length} products that irritated your skin</li>
          <li><i data-lucide="shield-check"></i>${prime.in_tolerated.length ? `Also in ${prime.in_tolerated.length} product you tolerate` : "In none of the products you tolerate"}</li>
          ${prime.families.length ? `<li><i data-lucide="flower-2"></i>${esc(prime.families.join(", "))}</li>` : ""}
        </ul></div></div>` : "";

  $("#verdict").innerHTML = reactive.length
    ? `<div class="card"><div class="card-head"><span class="icon-bubble"><i data-lucide="file-search"></i></span><div><h3>Evidence</h3>
        <p class="big-verdict">Reactions: <b>${reactive.map(esc).join(", ")}</b></p></div></div>
        <div class="next"><i data-lucide="lightbulb"></i><span>${esc(c.next_step)}</span></div></div>`
    : `<div class="card"><p class="next"><i data-lucide="lightbulb"></i><span>${esc(c.next_step)}</span></p></div>`;

  $("#families").innerHTML = c.families.length
    ? c.families.map((f, i) => `<div class="suspect ${["strong", "likely"].includes(f.level) ? "hot" : ""}" style="animation-delay:${i * 80}ms">
        <span class="s-icon"><i data-lucide="flower-2"></i></span>
        <div><div class="name family">${esc(f.name)}</div>
        <div class="why">${esc(f.note)} In ${f.in_reactive.length} of ${c.reactive.length} reactions, ${f.in_tolerated.length} of ${c.tolerated.length} tolerated.</div>
        <div class="meter"><span data-w="${LEVEL_WIDTH[f.level] || 10}"></span></div></div>
        <span class="badge ${f.level}">${f.level}</span></div>`).join("")
    : `<p class="muted">No known irritant family stands out yet.</p>`;

  $("#suspects").innerHTML = c.ingredients.length
    ? c.ingredients.map((i, n) => `<div class="suspect ${["strong", "likely"].includes(i.level) ? "hot" : ""}" style="animation-delay:${n * 80}ms">
        <span class="s-icon"><i data-lucide="${["strong", "likely"].includes(i.level) ? "fingerprint" : "microscope"}"></i></span>
        <div><div class="name">${esc(i.name)}</div>
        <div class="why">In ${productNames(i.in_reactive).map(esc).join(" and ")}${i.in_tolerated.length ? `, but also in ${productNames(i.in_tolerated).map(esc).join(", ")}` : ". Never in a product you tolerate."}
        ${i.families.length ? ` <em>(${esc(i.families.join(", ").toLowerCase())})</em>` : ""}</div>
        <div class="meter"><span data-w="${LEVEL_WIDTH[i.level] || 10}"></span></div></div>
        <span class="badge ${i.level}">${i.level}</span></div>`).join("")
    : `<p class="muted">Nothing yet.</p>`;
}

function fillMeters() {
  if (!$("#culprits").classList.contains("active")) return;
  document.querySelectorAll(".meter span[data-w]").forEach((s) => {
    s.style.width = `${s.dataset.w}%`;
    s.removeAttribute("data-w");
  });
}

/* ---------- chart ---------- */
const bandPlugin = {
  id: "bands",
  beforeDatasetsDraw(ch) {
    const { ctx, chartArea, scales } = ch;
    const style = getComputedStyle(document.documentElement);
    for (const p of state.products) {
      const v = p.evaluation.verdict;
      if (p.start_date < (state.checkins[0]?.date || "")) continue; // routine products predate tracking
      if (highlight && highlight !== p.id) continue;
      const x1 = scales.x.getPixelForValue(parseDay(p.start_date).getTime());
      // Shade the 10-day window in which the product is judged (or until it was stopped).
      const windowEnd = new Date(parseDay(p.start_date).getTime() + 10 * 864e5);
      const end = p.stop_date && parseDay(p.stop_date) < windowEnd ? parseDay(p.stop_date) : windowEnd;
      const x2 = scales.x.getPixelForValue(end.getTime());
      if (x2 < chartArea.left || x1 > chartArea.right) continue;
      const color = v === "reaction" ? style.getPropertyValue("--bad") : v === "tolerated" ? style.getPropertyValue("--good") : style.getPropertyValue("--warn");
      ctx.save();
      ctx.globalAlpha = highlight ? 0.2 : v === "reaction" ? 0.13 : 0.06;
      ctx.fillStyle = color.trim();
      ctx.fillRect(Math.max(x1, chartArea.left), chartArea.top, Math.min(x2, chartArea.right) - Math.max(x1, chartArea.left), chartArea.bottom - chartArea.top);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color.trim();
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x1, chartArea.top); ctx.lineTo(x1, chartArea.bottom); ctx.stroke();
      if (highlight) {
        ctx.setLineDash([]);
        ctx.fillStyle = color.trim();
        ctx.font = "600 12px Inter, sans-serif";
        ctx.fillText(p.name, Math.max(x1, chartArea.left) + 6, chartArea.top + 14);
      }
      ctx.restore();
    }
  },
};

function renderChart() {
  if (!state || typeof Chart === "undefined") return;
  const style = getComputedStyle(document.documentElement);
  const ink = style.getPropertyValue("--muted").trim();
  const accent = style.getPropertyValue("--accent").trim();
  const pts = (fn) => state.checkins.map((c) => ({ x: parseDay(c.date).getTime(), y: fn(c) }));
  const canvas = $("#chart");
  const grad = canvas.getContext("2d").createLinearGradient(0, 0, 0, 320);
  grad.addColorStop(0, "rgba(194, 82, 122, .28)");
  grad.addColorStop(1, "rgba(194, 82, 122, 0)");
  const data = {
    datasets: [
      { label: "Irritation index", data: pts((c) => c.irritation), borderColor: accent, backgroundColor: grad, fill: true, tension: 0.35, borderWidth: 3, pointRadius: 2.5, pointHoverRadius: 6, pointBackgroundColor: accent },
      { label: "Redness (100 - score)", data: pts((c) => 100 - c.scores.redness), borderColor: style.getPropertyValue("--bad").trim(), borderDash: [5, 4], tension: 0.35, borderWidth: 1.5, pointRadius: 0 },
    ],
  };
  const options = {
    responsive: true, maintainAspectRatio: false, parsing: false,
    interaction: { mode: "index", intersect: false },
    animation: { duration: 900, easing: "easeOutQuart" },
    onClick: (evt, els) => { if (els.length) showDiary(state.checkins[els[0].index].date, true); },
    scales: {
      x: { type: "linear", ticks: { color: ink, callback: (v) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" }), maxTicksLimit: 7 }, grid: { display: false } },
      y: { suggestedMin: Math.max(0, Math.floor((Math.min(100, ...state.checkins.map((c) => c.irritation)) - 8) / 5) * 5), suggestedMax: Math.ceil((Math.max(0, ...state.checkins.map((c) => c.irritation)) + 8) / 5) * 5, ticks: { color: ink }, grid: { color: style.getPropertyValue("--line").trim() } },
    },
    plugins: {
      legend: { labels: { color: ink, boxWidth: 12, usePointStyle: true } },
      tooltip: { backgroundColor: "#2b2024", padding: 10, cornerRadius: 10, callbacks: { title: (items) => new Date(items[0].parsed.x).toLocaleDateString() } },
    },
  };
  if (chart) chart.destroy();
  chart = new Chart(canvas, { type: "line", data, options, plugins: [bandPlugin] });
  const tested = state.products.filter((p) => p.start_date >= (state.checkins[0]?.date || ""));
  $("#legend").innerHTML = tested
    .map((p) => `<button type="button" class="badge ${verdictClass(p.evaluation.verdict)}${highlight === p.id ? " on" : ""}" data-hl="${p.id}"><i data-lucide="${VERDICT_ICON[p.evaluation.verdict]}"></i>${esc(p.name)} · ${esc(p.start_date.slice(5))}</button>`).join("");
  const hp = tested.find((p) => p.id === highlight);
  $("#legend-detail").innerHTML = hp ? `<div class="next"><img class="thumb" style="width:44px;height:44px;border-radius:12px" src="${esc(productPhoto(hp, 100))}" alt=""><span><b>${esc(hp.name)}</b>: ${esc(hp.evaluation.explanation)}</span></div>${compareCard(hp)}` : "";
  $("#legend").querySelectorAll("[data-hl]").forEach((b) => b.addEventListener("click", () => {
    highlight = highlight === +b.dataset.hl ? null : +b.dataset.hl;
    renderChart();
  }));
  icons();
  requestAnimationFrame(() => document.querySelectorAll(".cmp-bar span[data-w]").forEach((s) => { s.style.width = `${s.dataset.w}%`; s.removeAttribute("data-w"); }));
}

/* ---------- photo diary (BeReal-style: today's photo, "before" photo in the corner) ---------- */
let diaryIndex = null;
let diaryTimer = null;
let diarySwap = false;

const diaryShots = () => state.checkins.filter((c) => c.photo);
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5);

// The product being tested on a given day: most recent start within the 10-day window.
function testedOn(date) {
  return state.products
    .filter((p) => p.start_date <= date && daysBetween(p.start_date, date) <= 10 && p.start_date >= (state.checkins[0]?.date || ""))
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
}

function renderDiary() {
  const shots = diaryShots();
  const el = $("#diary");
  if (!shots.length) {
    el.innerHTML = `<p class="muted">No photos yet. Your daily selfies will appear here.</p>`;
    return;
  }
  if (diaryIndex == null || diaryIndex >= shots.length) diaryIndex = shots.length - 1;
  const median = [...state.checkins.map((c) => c.irritation)].sort((a, b) => a - b)[Math.floor(state.checkins.length / 2)];
  el.innerHTML = `
    <div class="diary-stage" id="diary-stage"></div>
    <div class="diary-controls">
      <button type="button" class="ghost" id="diary-prev" aria-label="Previous day"><i data-lucide="chevron-left"></i></button>
      <button type="button" class="primary" id="diary-play"><i data-lucide="play"></i><span>Play</span></button>
      <input type="range" id="diary-range" min="0" max="${shots.length - 1}" value="${diaryIndex}">
      <button type="button" class="ghost" id="diary-next" aria-label="Next day"><i data-lucide="chevron-right"></i></button>
    </div>
    <div class="diary-strip" id="diary-strip">${shots.map((c, i) => `
      <button type="button" class="shot${c.irritation >= median + 6 ? " hot" : ""}" data-i="${i}" title="${esc(c.date)}">
        <img src="/photos/${esc(c.photo)}" alt="" loading="lazy"><span>${parseDay(c.date).getDate()}</span></button>`).join("")}</div>`;
  $("#diary-range").addEventListener("input", (e) => { stopDiary(); diaryIndex = +e.target.value; drawDiary(); });
  $("#diary-prev").addEventListener("click", () => { stopDiary(); diaryIndex = Math.max(0, diaryIndex - 1); drawDiary(); });
  $("#diary-next").addEventListener("click", () => { stopDiary(); diaryIndex = Math.min(shots.length - 1, diaryIndex + 1); drawDiary(); });
  $("#diary-play").addEventListener("click", () => (diaryTimer ? stopDiary() : playDiary()));
  $("#diary-strip").querySelectorAll(".shot").forEach((b) => b.addEventListener("click", () => { stopDiary(); diaryIndex = +b.dataset.i; drawDiary(); }));
  shots.forEach((c) => { new Image().src = `/photos/${c.photo}`; }); // preload for smooth playback
  drawDiary();
  icons();
}

function drawDiary() {
  const shots = diaryShots();
  const c = shots[diaryIndex];
  if (!c) return;
  const product = testedOn(c.date);
  const before = product && [...shots].reverse().find((s) => s.date < product.start_date);
  const big = diarySwap && before ? before : c;
  const small = diarySwap && before ? c : before;
  const demoShot = (s) => s.photo.startsWith("demo-");
  const red = c.scores.redness;
  $("#diary-stage").innerHTML = `
    <img class="diary-main" src="/photos/${esc(big.photo)}" alt="Check-in photo">
    <span class="d-chip d-date"><i data-lucide="calendar-days"></i>${esc(parseDay(big.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))}</span>
    <span class="d-chip d-score ${scoreClass(big.scores.redness)}"><i data-lucide="flame"></i>Redness ${big.scores.redness}</span>
    ${small ? `<button type="button" class="diary-inset" id="diary-inset" title="Swap photos">
      <img src="/photos/${esc(small.photo)}" alt=""><span>${small === before ? "Before" : "Today"}</span></button>` : ""}
    <div class="d-bottom">
      ${product ? `<span class="d-chip"><i data-lucide="flask-conical"></i>Day ${daysBetween(product.start_date, c.date)} of ${esc(product.name)}</span>` : `<span class="d-chip"><i data-lucide="sun"></i>No new product</span>`}
      ${demoShot(big) ? `<span class="d-chip d-sim"><i data-lucide="info"></i>Demo: redness added digitally</span>` : big.mock ? `<span class="d-chip d-sim">Simulated scores</span>` : `<span class="d-chip"><i data-lucide="scan-face"></i>YouCam AI</span>`}
    </div>`;
  $("#diary-inset")?.addEventListener("click", () => { diarySwap = !diarySwap; drawDiary(); });
  $("#diary-range").value = diaryIndex;
  $("#diary-strip").querySelectorAll(".shot").forEach((b) => b.classList.toggle("on", +b.dataset.i === diaryIndex));
  $("#diary-strip .shot.on")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  icons();
}

function playDiary() {
  const shots = diaryShots();
  if (diaryIndex >= shots.length - 1) diaryIndex = 0;
  diarySwap = false;
  $("#diary-play").innerHTML = `<i data-lucide="pause"></i><span>Pause</span>`;
  icons();
  diaryTimer = setInterval(() => {
    if (diaryIndex >= shots.length - 1) return stopDiary();
    diaryIndex++;
    drawDiary();
  }, 280);
}

function stopDiary() {
  clearInterval(diaryTimer);
  diaryTimer = null;
  const btn = $("#diary-play");
  if (btn) { btn.innerHTML = `<i data-lucide="play"></i><span>Play</span>`; icons(); }
}

function showDiary(date, scroll) {
  const i = diaryShots().findIndex((c) => c.date === date);
  if (i < 0) return;
  stopDiary();
  diaryIndex = i;
  diarySwap = false;
  drawDiary();
  if (scroll) $("#diary").scrollIntoView({ behavior: "smooth", block: "center" });
}

// Before/after card: average YouCam scores in the 10 days before vs after starting a product.
function compareCard(p) {
  const ev = p.evaluation;
  if (!ev.before_scores) return "";
  const rows = Object.keys(CONCERNS).filter((k) => ev.before_scores[k] != null && ev.after_scores[k] != null).map((k) => {
    const b = ev.before_scores[k], a = ev.after_scores[k], d = Math.round(a - b);
    const cls = d <= -4 ? "worse" : d >= 4 ? "better" : "same";
    return `<div class="cmp-row ${cls}">
      <span class="cmp-label"><i data-lucide="${CONCERNS[k].icon}"></i>${CONCERNS[k].label}</span>
      <div class="cmp-bars"><div class="cmp-bar before"><span data-w="${b}"></span></div><div class="cmp-bar after"><span data-w="${a}"></span></div></div>
      <span class="cmp-nums">${Math.round(b)} → <b>${Math.round(a)}</b></span>
      <span class="cmp-delta">${d > 0 ? "+" : ""}${d}</span>
    </div>`;
  }).join("");
  const worse = ev.after_index > ev.before_index;
  return `<div class="compare">
    <div class="cmp-head">
      <div><span class="small muted">10 days before</span><b>${ev.before_index}</b><span class="small muted">irritation · ${ev.before_n} check-ins</span></div>
      <i data-lucide="arrow-right"></i>
      <div class="${worse && ev.delta >= 6 ? "up" : ""}"><span class="small muted">10 days after</span><b>${ev.after_index}</b><span class="small muted">irritation · ${ev.after_n} check-ins</span></div>
    </div>
    <div class="cmp-legend small muted"><span><i class="sw before"></i>before</span><span><i class="sw after"></i>after</span><span>YouCam scores, higher is healthier</span></div>
    ${rows}
  </div>`;
}

/* ---------- check-in ---------- */
$("#checkin-date").value = today();
$("#p-start").value = today();
// Checks YouCam's photo requirements in the browser, before any upload (and before spending API units).
let photoProblems = [];
async function checkPhoto(file, img) {
  if (!img.complete || !img.naturalWidth) {
    await new Promise((r) => { img.onload = img.onerror = r; setTimeout(r, 3000); });
  }
  const w = img.naturalWidth, h = img.naturalHeight;
  // Average brightness from a small copy of the photo (0 = black, 255 = white).
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, 64, 64);
  const px = ctx.getImageData(0, 0, 64, 64).data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  const light = sum / (px.length / 4);
  const checks = [
    { ok: ["image/jpeg", "image/png"].includes(file.type), hard: true, yes: `${file.type === "image/png" ? "PNG" : "JPG"} format`, no: "Use a JPG or PNG photo (iPhone HEIC photos are not accepted)" },
    { ok: file.size < 10 * 1024 * 1024, hard: true, yes: `${(file.size / 1048576).toFixed(1)} MB, under the 10 MB limit`, no: "Photo is over 10 MB" },
    { ok: Math.min(w, h) >= 480, hard: true, yes: `${w} × ${h} px, sharp enough`, no: `${w} × ${h} px is too small (480 px minimum on the short side)` },
    { ok: h >= w, hard: false, yes: "Portrait orientation", no: "Landscape photo: portrait works better" },
    { ok: light >= 70, hard: false, yes: "Good lighting", no: "Looks dark: face a window or a lamp" },
  ];
  photoProblems = checks.filter((k) => !k.ok && k.hard).map((k) => k.no);
  const ready = !photoProblems.length;
  $("#photo-check").innerHTML = `<div class="photo-check ${ready ? "ready" : "not-ready"}">
    <b><i data-lucide="${ready ? "circle-check" : "triangle-alert"}"></i>${ready ? "Ready for YouCam" : "Not ready for YouCam yet"}</b>
    <ul>${checks.map((k) => `<li class="${k.ok ? "ok" : k.hard ? "fail" : "warn"}"><i data-lucide="${k.ok ? "check" : k.hard ? "x" : "triangle-alert"}"></i>${esc(k.ok ? k.yes : k.no)}</li>`).join("")}
    <li class="warn"><i data-lucide="scan-face"></i>Make sure your face fills most of the oval</li></ul>
    <p class="small muted">Checked on your device. Nothing was sent.</p></div>`;
  icons();
}

$("#photo").addEventListener("change", () => {
  const file = $("#photo").files[0];
  if (!file) return;
  $("#photo-label").textContent = "Tap to change photo";
  const img = $("#preview");
  img.src = URL.createObjectURL(file);
  img.hidden = false;
  $(".face-frame").classList.add("has-photo");
  checkPhoto(file, img);
});

/* ---------- webcam selfie: live view in the oval, 3-2-1, capture ---------- */
let camStream = null;

function stopWebcam() {
  camStream?.getTracks().forEach((t) => t.stop());
  camStream = null;
  $("#webcam").hidden = true;
  $(".face-frame").classList.remove("live");
  $("#webcam-btn span").textContent = "Use webcam";
  $("#webcam-cancel").hidden = true;
}

async function startWebcam() {
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch {
    return toast("Camera not available or permission denied. Choose a photo instead.", "camera-off");
  }
  const video = $("#webcam");
  video.srcObject = camStream;
  video.hidden = false;
  $("#preview").hidden = true;
  $(".face-frame").classList.remove("has-photo");
  $(".face-frame").classList.add("live");
  await video.play();
  $("#webcam-btn span").textContent = "Take photo";
  $("#webcam-cancel").hidden = false;
  $("#photo-label").textContent = "Center your face in the oval";
}

async function captureWebcam() {
  const cd = $("#countdown");
  cd.hidden = false;
  for (const n of [3, 2, 1]) {
    cd.innerHTML = `<span>${n}</span>`;
    await wait(800);
  }
  cd.hidden = true;
  const video = $("#webcam");
  // Crop a portrait 3:4 frame from the middle of the video, as large as possible.
  const vh = video.videoHeight, vw = video.videoWidth;
  const h = vh, w = Math.min(vw, Math.round(vh * 3 / 4));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.translate(w, 0);
  ctx.scale(-1, 1); // keep the mirror view the user saw
  ctx.drawImage(video, (vw - w) / 2, 0, w, h, 0, 0, w, h);
  const flash = document.createElement("div");
  flash.className = "flash";
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 500);
  stopWebcam();
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.92));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], `selfie-${today()}.jpg`, { type: "image/jpeg" }));
  $("#photo").files = dt.files;
  $("#photo").dispatchEvent(new Event("change"));
}

$("#webcam-btn").addEventListener("click", () => (camStream ? captureWebcam() : startWebcam()));
$("#webcam-cancel").addEventListener("click", stopWebcam);
// While the webcam is live, clicking the oval should not open the file picker.
$("#face-drop").addEventListener("click", (e) => { if (camStream) e.preventDefault(); });

const SCAN_STEPS = ["Uploading to YouCam...", "Finding your face...", "Mapping redness...", "Counting breakouts...", "Reading texture..."];
$("#checkin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = $("#photo").files[0];
  if (!file) { $("#face-drop").animate([{ transform: "translateX(0)" }, { transform: "translateX(-8px)" }, { transform: "translateX(8px)" }, { transform: "translateX(0)" }], { duration: 300 }); return toast("Choose a selfie first", "camera"); }
  if (!state.mock && photoProblems.length) return toast(photoProblems[0], "triangle-alert");
  const btn = $("#analyze-btn");
  const frame = $(".face-frame");
  btn.disabled = true;
  btn.querySelector("span").textContent = "Analyzing...";
  frame.classList.add("scanning");
  let i = 0;
  const steps = state?.mock ? ["Simulating analysis (demo mode)...", ...SCAN_STEPS.slice(1)] : SCAN_STEPS;
  $("#scan-step").textContent = steps[0];
  const ticker = setInterval(() => { $("#scan-step").textContent = steps[++i % steps.length]; }, 700);
  try {
    const fd = new FormData();
    fd.append("photo", file);
    fd.append("day", $("#checkin-date").value);
    const [s] = await Promise.all([api("/api/checkins", { method: "POST", body: fd }), wait(2200)]);
    render(s);
    const last = s.checkins.filter((c) => c.date === $("#checkin-date").value).pop();
    $("#checkin-result").innerHTML = last ? `<div class="card-head" style="margin-top:18px"><span class="icon-bubble"><i data-lucide="sparkles"></i></span><h3>Today's result</h3></div>${scoreCards(last.scores)}` : "";
    icons();
    requestAnimationFrame(fillRings);
    const r = btn.getBoundingClientRect();
    sparkle(r.left + r.width / 2, r.top);
    toast("Check-in saved", "circle-check");
  } catch (err) {
    toast(err.message, "triangle-alert");
  } finally {
    clearInterval(ticker);
    $("#scan-step").textContent = "";
    frame.classList.remove("scanning");
    btn.disabled = false;
    btn.querySelector("span").textContent = "Analyze my skin";
  }
});

/* ---------- products ---------- */
function renderCategoryPicker() {
  $("#cat-picker").innerHTML = Object.entries(CATEGORY_PHOTOS).map(([name, id]) =>
    `<button type="button" class="cat" data-cat="${name}"><img src="${photo(id, 128)}" alt="" loading="lazy">${name}</button>`).join("");
  $("#cat-picker").querySelectorAll(".cat").forEach((b) => b.addEventListener("click", () => {
    const on = !b.classList.contains("on");
    $("#cat-picker").querySelectorAll(".cat").forEach((x) => x.classList.remove("on"));
    b.classList.toggle("on", on);
    $("#p-category").value = on ? b.dataset.cat : "";
  }));
}
renderCategoryPicker();

async function lookupInto(barcode) {
  if (!barcode) return toast("Enter a barcode first", "scan-barcode");
  try {
    const p = await api(`/api/lookup/${encodeURIComponent(barcode)}`);
    $("#p-name").value = p.name;
    $("#p-brand").value = p.brand || "";
    $("#p-ingredients").value = p.ingredients.join(", ");
    $("#p-image").value = p.image || "";
    $("#lookup-preview").innerHTML = `<div class="found">${p.image ? `<img src="${esc(p.image)}" alt="">` : `<span class="icon-bubble"><i data-lucide="circle-check"></i></span>`}
      <div><b>${esc(p.name)}</b><div class="small muted">${esc(p.brand || "")} · ${p.ingredients.length} ingredients from ${esc(p.source)}</div></div></div>`;
    icons();
    toast(`Found ${p.ingredients.length} ingredients`, "circle-check");
  } catch (err) {
    toast(err.message, "triangle-alert");
  }
}
$("#lookup-product").addEventListener("click", () => lookupInto($("#p-barcode").value.trim()));
$("#product-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    render(await api("/api/products", json({
      name: $("#p-name").value, brand: $("#p-brand").value, barcode: $("#p-barcode").value, image: $("#p-image").value,
      category: $("#p-category").value, ingredients_text: $("#p-ingredients").value, start_date: $("#p-start").value,
    })));
    e.target.reset();
    $("#p-start").value = today();
    $("#p-image").value = "";
    $("#lookup-preview").innerHTML = "";
    $("#cat-picker").querySelectorAll(".cat").forEach((x) => x.classList.remove("on"));
    toast("Product added", "circle-check");
  } catch (err) {
    toast(err.message, "triangle-alert");
  }
});

/* ---------- shop check ---------- */
function renderShop(r) {
  const cls = r.verdict === "looks safe" ? "safe" : r.verdict;
  const title = { avoid: "Skip this one", caution: "Be careful", "looks safe": "Looks safe for you" }[r.verdict];
  const icon = { avoid: "octagon-x", caution: "triangle-alert", safe: "circle-check" }[cls];
  const hits = r.hits.map((h) => `<li><strong>${esc(h.name)}</strong> (${h.level} suspect${h.members ? `: ${esc(h.members.join(", "))}` : ""})</li>`).join("");
  $("#shop-result").innerHTML = `<div class="result ${cls}">
    <div class="shot"><img class="${r.product.image ? "real" : ""}" src="${esc(productPhoto(r.product, 240))}" alt=""><span class="verdict-icon"><i data-lucide="${icon}"></i></span></div>
    <div>
      <span class="badge ${cls}">${esc(r.verdict)}</span>
      <h2>${title}</h2>
      <p style="margin:0"><strong>${esc(r.product.name)}</strong>${r.product.brand ? ` · ${esc(r.product.brand)}` : ""} · ${r.ingredient_count} ingredients</p>
      ${hits ? `<ul>${hits}</ul>` : `<p style="margin:6px 0 0">None of your suspects are in it.${state.culprits.reactive.length ? "" : " (You have no suspects yet, so this check is not meaningful.)"}</p>`}
      <button class="ghost small" id="pin-result" style="margin-top:12px"><i data-lucide="map-pin"></i>Pin this store on my map</button>
    </div>
  </div>`;
  icons();
  $("#pin-result").addEventListener("click", () => startPin({ product: r.product.name, verdict: r.verdict }));
  const box = $("#shop-result .result").getBoundingClientRect();
  if (cls === "safe") sparkle(box.left + 70, box.top + 60, ["✨", "💚", "🌿", "✨"]);
  else $("#shop-result .result").animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: 320, delay: 300 });
}
async function checkBarcode() {
  try { renderShop(await api("/api/check", json({ barcode: $("#s-barcode").value }))); } catch (err) { toast(err.message, "triangle-alert"); }
}
$("#check-barcode").addEventListener("click", checkBarcode);
$("#check-text").addEventListener("click", async () => {
  try { renderShop(await api("/api/check", json({ ingredients_text: $("#s-ingredients").value }))); } catch (err) { toast(err.message, "triangle-alert"); }
});
document.querySelectorAll(".code-chip").forEach((b) => b.addEventListener("click", () => {
  $("#s-barcode").value = b.dataset.code;
  checkBarcode();
}));

/* ---------- barcode scanning (Chrome / Android BarcodeDetector) ---------- */
async function scan(videoEl, onCode) {
  if (!("BarcodeDetector" in window)) return toast("Camera scanning is not supported in this browser. Type the barcode instead.", "scan-barcode");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch {
    return toast("Camera permission denied", "camera-off");
  }
  const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
  videoEl.srcObject = stream;
  videoEl.hidden = false;
  await videoEl.play();
  const stop = () => { stream.getTracks().forEach((t) => t.stop()); videoEl.hidden = true; };
  const started = Date.now();
  const tick = async () => {
    if (Date.now() - started > 20000) { stop(); return toast("No barcode found", "scan-barcode"); }
    const codes = await detector.detect(videoEl).catch(() => []);
    if (codes.length) { stop(); onCode(codes[0].rawValue); } else requestAnimationFrame(tick);
  };
  tick();
}
$("#scan-product").addEventListener("click", () => scan($("#scan-video-p"), (code) => { $("#p-barcode").value = code; lookupInto(code); }));
$("#scan-shop").addEventListener("click", () => scan($("#scan-video-s"), (code) => { $("#s-barcode").value = code; checkBarcode(); }));

/* ---------- store map (Leaflet + OpenStreetMap) ---------- */
const VERDICT_COLOR = { avoid: "bad", caution: "warn", "looks safe": "good" };
let map = null;
let markers = null;
let draft = null; // pin being placed: { product, verdict, lat, lng, marker }

function pinIcon(verdict, pending = false) {
  return L.divIcon({ className: "", html: `<span class="pin ${pending ? "pending" : VERDICT_COLOR[verdict] || "plain"}"></span>`, iconSize: [26, 26], iconAnchor: [13, 26], popupAnchor: [0, -24] });
}

function renderMap() {
  if (typeof L === "undefined" || !state) return;
  if (!map) {
    map = L.map("leaflet", { scrollWheelZoom: false }).setView([40.73, -73.97], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    markers = L.layerGroup().addTo(map);
    map.on("click", (e) => { if (draft) placeDraft(e.latlng.lat, e.latlng.lng); });
  }
  setTimeout(() => map.invalidateSize(), 50);
  markers.clearLayers();
  const visits = state.visits || [];
  visits.forEach((v) => {
    L.marker([v.lat, v.lng], { icon: pinIcon(v.verdict) }).addTo(markers)
      .bindPopup(`<b>${esc(v.store)}</b><br>${esc(v.date)}${v.product ? `<br>${esc(v.product)}: <b>${esc(v.verdict)}</b>` : ""}`);
  });
  if (draft?.marker) draft.marker.addTo(markers);
  if (visits.length && !draft) map.fitBounds(visits.map((v) => [v.lat, v.lng]), { padding: [40, 40], maxZoom: 14 });
}

function renderVisits() {
  const visits = state.visits || [];
  const count = (v) => visits.filter((x) => x.verdict === v).length;
  $("#map-stats").innerHTML = `
    <div class="stat"><span class="icon-bubble"><i data-lucide="store"></i></span><div><b>${new Set(visits.map((v) => v.store)).size}</b><span>stores visited</span></div></div>
    <div class="stat"><span class="icon-bubble bad"><i data-lucide="octagon-x"></i></span><div><b>${count("avoid")}</b><span>products to skip</span></div></div>
    <div class="stat"><span class="icon-bubble good"><i data-lucide="circle-check"></i></span><div><b>${count("looks safe")}</b><span>safe picks found</span></div></div>`;
  $("#visit-list").innerHTML = visits.length ? `<div class="card">${[...visits].reverse().map((v) => `
    <div class="visit" data-lat="${v.lat}" data-lng="${v.lng}">
      <span class="pin ${VERDICT_COLOR[v.verdict] || "plain"}"></span>
      <div><b>${esc(v.store)}</b><div class="small muted">${esc(v.date)}${v.product ? ` · ${esc(v.product)}` : ""}</div></div>
      ${v.verdict ? `<span class="badge ${v.verdict === "looks safe" ? "safe" : v.verdict}">${esc(v.verdict)}</span>` : "<span></span>"}
      <button class="ghost small" data-unpin="${v.id}" aria-label="Remove pin"><i data-lucide="trash-2"></i></button>
    </div>`).join("")}</div>` : `<div class="card muted">No stores yet. Do a Shop check and pin the store, or tap "Pin a store".</div>`;
  $("#visit-list").querySelectorAll(".visit").forEach((row) => row.addEventListener("click", (e) => {
    if (e.target.closest("[data-unpin]") || !map) return;
    map.flyTo([+row.dataset.lat, +row.dataset.lng], 15, { duration: 0.8 });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
  $("#visit-list").querySelectorAll("[data-unpin]").forEach((b) => b.addEventListener("click", async () => {
    render(await api(`/api/visits/${b.dataset.unpin}`, { method: "DELETE" }));
  }));
}

function startPin(info = {}) {
  draft = { product: info.product || "", verdict: info.verdict || "" };
  showTab("map");
  $("#pin-form").hidden = false;
  $("#pin-new").hidden = true;
  $("#pin-for").innerHTML = info.product ? `<i data-lucide="shopping-bag"></i>Pinning: ${esc(info.product)} (${esc(info.verdict)})` : "";
  $("#pin-store").value = "";
  icons();
  setTimeout(() => $("#pin-store").focus(), 300);
}

function placeDraft(lat, lng) {
  draft.lat = lat;
  draft.lng = lng;
  if (draft.marker) draft.marker.setLatLng([lat, lng]);
  else draft.marker = L.marker([lat, lng], { icon: pinIcon(draft.verdict, true) }).addTo(markers);
  map.panTo([lat, lng]);
}

function endPin() {
  if (draft?.marker) draft.marker.remove();
  draft = null;
  $("#pin-form").hidden = true;
  $("#pin-new").hidden = false;
}

$("#pin-new").addEventListener("click", () => startPin());
$("#pin-cancel").addEventListener("click", endPin);
$("#pin-locate").addEventListener("click", () => {
  if (!navigator.geolocation) return toast("Location is not available. Tap the map instead.", "map-pin");
  navigator.geolocation.getCurrentPosition(
    (pos) => { placeDraft(pos.coords.latitude, pos.coords.longitude); map.setZoom(16); },
    () => toast("Location permission denied. Tap the map instead.", "map-pin-off"),
    { enableHighAccuracy: true, timeout: 8000 },
  );
});
$("#pin-save").addEventListener("click", async () => {
  const store = $("#pin-store").value.trim();
  if (!store) return toast("Give the store a name", "store");
  if (draft.lat == null) return toast("Tap the map or use your location first", "map-pin");
  try {
    const s = await api("/api/visits", json({ store, lat: draft.lat, lng: draft.lng, date: today(), product: draft.product, verdict: draft.verdict }));
    endPin();
    render(s);
    toast("Store pinned", "map-pin");
  } catch (err) {
    toast(err.message, "triangle-alert");
  }
});

/* ---------- footer ---------- */
async function loadDemo() {
  render(await api("/api/demo", { method: "POST" }));
  toast("Demo loaded: 6 weeks, 7 products", "play");
  showTab("culprits");
}
$("#load-demo").addEventListener("click", loadDemo);
$("#reset").addEventListener("click", async () => {
  if (confirm("Delete all products and check-ins?")) {
    highlight = null;
    render(await api("/api/reset", { method: "POST" }));
    $("#checkin-result").innerHTML = "";
  }
});
$("#print").addEventListener("click", () => window.print());

icons();
api("/api/state").then(render).catch((err) => toast(err.message, "triangle-alert"));
