const $ = (sel) => document.querySelector(sel);
lucide.createIcons();

/* ---------- nav turns solid after the hero ---------- */
const nav = $("#nav");
const onScroll = () => nav.classList.toggle("solid", scrollY > innerHeight * 0.6);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

/* ---------- hero carousel ---------- */
const SLIDE_MS = 6000;
const slides = [...document.querySelectorAll(".slide")];
const hero = $("#hero");
let current = 0;
let timer = null;

$("#dots").innerHTML = slides.map((_, i) => `<button aria-label="Photo ${i + 1}"></button>`).join("");
const dots = [...document.querySelectorAll("#dots button")];
hero.style.setProperty("--dur", `${SLIDE_MS}ms`);

function go(i) {
  current = (i + slides.length) % slides.length;
  slides.forEach((s, n) => s.classList.toggle("active", n === current));
  dots.forEach((d, n) => {
    d.classList.remove("active");
    if (n === current) { void d.offsetWidth; d.classList.add("active"); } // restart the progress bar
  });
  const caption = $("#caption");
  caption.style.opacity = 0;
  setTimeout(() => { caption.textContent = slides[current].querySelector("figcaption").textContent; caption.style.opacity = 1; }, 300);
  restart();
}
function restart() {
  clearTimeout(timer);
  if (!hero.classList.contains("paused")) timer = setTimeout(() => go(current + 1), SLIDE_MS);
}
dots.forEach((d, i) => d.addEventListener("click", () => go(i)));
$("#prev").addEventListener("click", () => go(current - 1));
$("#next").addEventListener("click", () => go(current + 1));
$(".hero-controls").addEventListener("mouseenter", () => { hero.classList.add("paused"); clearTimeout(timer); });
$(".hero-controls").addEventListener("mouseleave", () => { hero.classList.remove("paused"); restart(); });
addEventListener("keydown", (e) => {
  if (scrollY > innerHeight) return;
  if (e.key === "ArrowRight") go(current + 1);
  if (e.key === "ArrowLeft") go(current - 1);
});
let touchX = null;
hero.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
hero.addEventListener("touchend", (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50) go(current + (dx < 0 ? 1 : -1));
  touchX = null;
});
go(0);

/* ---------- scroll reveal and counters ---------- */
function countUp(el) {
  const target = +el.dataset.count;
  const prefix = el.dataset.prefix || "";
  const suffix = el.dataset.suffix || "";
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / 1400);
    const v = Math.round(target * (1 - Math.pow(1 - k, 3)));
    el.textContent = `${prefix}${v.toLocaleString("en-US")}${suffix}`;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    const siblings = [...e.target.parentElement.children].filter((c) => c.classList.contains("reveal"));
    e.target.style.transitionDelay = `${Math.max(0, siblings.indexOf(e.target)) * 90}ms`;
    e.target.classList.add("in");
    e.target.querySelectorAll("[data-count]").forEach(countUp);
    io.unobserve(e.target);
  });
}, { threshold: 0.15 });
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

/* ---------- the detective walkthrough (same data as the in-app demo) ---------- */
const GLOW = ["water", "ascorbic acid", "glycerin", "propanediol", "ferulic acid", "tocopherol", "phenoxyethanol", "fragrance", "linalool", "limonene", "citric acid", "xanthan gum"];
const ROSE = ["water", "caprylic/capric triglyceride", "glycerin", "cetearyl alcohol", "shea butter", "dimethicone", "rosa damascena flower water", "fragrance", "citronellol", "geraniol", "linalool", "phenoxyethanol", "ethylhexylglycerin", "xanthan gum", "tocopherol"];
const TOLERATED = [
  { name: "Gentle Cream Cleanser", photo: "1605204350321-cfd0ac0702e1", has: ["water", "glycerin", "xanthan gum", "phenoxyethanol"] },
  { name: "Barrier Repair Moisturizer", photo: "1619451427882-6aaaded0cc61", has: ["water", "glycerin", "tocopherol", "phenoxyethanol"] },
  { name: "Mineral Sunscreen", photo: "1672749489615-2eb286c851e5", has: ["water", "glycerin", "tocopherol", "xanthan gum"] },
];
const ALL = [...new Set([...GLOW, ...ROSE])];
const SHARED = GLOW.filter((i) => ROSE.includes(i));
const CLEARED = new Set(TOLERATED.flatMap((t) => t.has));
const GUILTY = SHARED.filter((i) => !CLEARED.has(i));

const NOTES = [
  `Both products made this person's skin red within days of starting them. Between them: <b>${ALL.length} different ingredients</b>. Any of them could be the culprit.`,
  `If one ingredient causes both reactions, it has to be in <b>both</b> products. That leaves <b>${SHARED.length} suspects</b>.`,
  `This person also uses ${TOLERATED.length} products without any problem. Every suspect found in them is <b>cleared</b>: their skin already tolerates it.`,
  `<b>${GUILTY.join(" and ")}</b> remain, both fragrance allergens. Next step: a fragrance-free routine, and a patch test with a dermatologist to confirm.`,
];

$("#lineup").innerHTML = ALL.map((i) => `<span class="ing" data-ing="${i}">${i}</span>`).join("");
let caseStep = 0;

function showStep(n) {
  caseStep = Math.max(0, Math.min(3, n));
  document.querySelectorAll(".case-step").forEach((b, i) => {
    b.classList.toggle("active", i === caseStep);
    b.classList.toggle("done", i < caseStep);
  });
  document.querySelectorAll(".ing").forEach((el) => {
    const i = el.dataset.ing;
    el.className = "ing";
    if (caseStep >= 1) el.classList.add(SHARED.includes(i) ? "shared" : "dim");
    if (caseStep >= 2 && SHARED.includes(i) && CLEARED.has(i)) el.classList.add("cleared");
    if (caseStep >= 3 && GUILTY.includes(i)) el.classList.add("guilty");
  });
  // Non-suspects leave the lineup after step 1 so the board stays readable.
  document.querySelectorAll(".ing.dim").forEach((el) => { el.style.display = caseStep >= 2 ? "none" : ""; });
  document.querySelectorAll(".ing:not(.dim)").forEach((el) => { el.style.display = ""; });
  $("#cleared-by").innerHTML = caseStep >= 2 ? TOLERATED.map((t, i) =>
    `<div class="clear-card" style="animation-delay:${i * 180}ms"><img src="https://images.unsplash.com/photo-${t.photo}?w=100&h=100&fit=crop&q=70&auto=format" alt="">Tolerated: ${t.name}</div>`).join("") : "";
  $("#case-note").innerHTML = NOTES[caseStep];
  $("#case-prev").disabled = caseStep === 0;
  $("#case-next").innerHTML = caseStep === 3 ? `Start over <i data-lucide="rotate-ccw"></i>` : `Next step <i data-lucide="arrow-right"></i>`;
  lucide.createIcons();
}
document.querySelectorAll(".case-step").forEach((b) => b.addEventListener("click", () => showStep(+b.dataset.step)));
$("#case-next").addEventListener("click", () => showStep(caseStep === 3 ? 0 : caseStep + 1));
$("#case-prev").addEventListener("click", () => showStep(caseStep - 1));
showStep(0);
