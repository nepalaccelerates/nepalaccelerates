// n/acc page behaviour. The page reads fully with this file missing.
//   #massif            the terrain canvas (fixed, behind the sheet); #massif-still is the no-WebGL / reduced-motion still.
//   [data-readout]     the mono altitude, in the bar on phones and in the left margin on desktop.
//   [data-climb]       the station ladder in the left margin; each station lights as the reader passes its altitude.
//   #getup             the "Get up." block: the altitude reaches 8,848.86 m as the line centres.
//   [data-moment]      the three break blocks: the shader mask opens across the whole canvas and closes again.
//   [data-reveal]      the three break lines, revealed once.
//   form#door-form     posts JSON to the mail Worker; falls back to a plain POST without JS.
//   [data-nav]         the bar; gets .is-on after the hero scrolls out.

import { initTerrain, webglAvailable } from './terrain.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = matchMedia('(max-width: 767px)').matches;
const lowEnd = (navigator.deviceMemory || 8) <= 2 || (navigator.connection && navigator.connection.saveData);
const no3d = new URLSearchParams(location.search).has('no3d');
if (!reduced) document.documentElement.classList.add('js');

const BASE = 1400, SUMMIT = 8848.86;
const STATIONS = [[1400, 'Kathmandu'], [2846, 'Lukla'], [3440, 'Namche Bazaar'], [3867, 'Tengboche'], [5364, 'Base Camp'], [5644, 'Kala Patthar'], [7906, 'South Col'], [8848.86, 'Sagarmatha']];
const fmt = (m) => (m >= SUMMIT - 1 ? '8,848.86' : Math.round(m).toLocaleString('en-US')) + ' m';

// ink levels: reading state, and the level the mask moments open to
const INK = mobile ? { rest: 0.10, open: 0.34 } : { rest: 0.45, open: 0.34 };

// ---------- bar ----------
const nav = $('[data-nav]');
const hero = $('[data-hero]');
if (nav && hero) new IntersectionObserver((e) => nav.classList.toggle('is-on', !e[0].isIntersecting), { rootMargin: '-80px 0px 0px 0px' }).observe(hero);
$$('a[href="#door"]').forEach((a) => a.addEventListener('click', (e) => { const d = $('#door'); if (!d) return; e.preventDefault(); d.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); history.replaceState(null, '', '#door'); }));

// ---------- altitude: one number for the readout, the ladder, the red ring and the camera ----------
const readouts = $$('[data-readout]');
const readoutStation = $('[data-readout-station]');
const climbRows = $$('[data-alt]');
const getup = $('#getup');
const canvas = $('#massif');
const still = $('#massif-still');
const plate = $('#plate');
let target = BASE, shown = BASE, terrain = null, raf = 0, hereIdx = -1;

// The summit lands as "Get up." centres. The raw scroll target arrives a fraction early so the
// per-frame lerp finishes on the same beat the line reveals.
function scrollEnd() {
  if (!getup) return 1;
  const r = getup.getBoundingClientRect();
  const centre = r.top + window.scrollY + r.height / 2;
  return Math.max(1, centre - 0.56 * innerHeight);
}
function targetAltitude() {
  const p = Math.max(0, Math.min(1, window.scrollY / scrollEnd()));
  return BASE + (SUMMIT - BASE) * p;
}
function paint(alt) {
  const atTop = alt >= SUMMIT - 1;
  const txt = fmt(alt);
  readouts.forEach((el) => { el.textContent = txt; el.classList.toggle('is-summit', atTop); });

  // the climb: every station the reader has passed stays legible, the current one is cream
  let idx = -1;
  for (let i = 0; i < STATIONS.length; i++) if (alt >= STATIONS[i][0] - 1) idx = i;
  if (idx !== hereIdx) {
    hereIdx = idx;
    climbRows.forEach((li, i) => {
      li.classList.toggle('is-passed', i <= idx);
      li.classList.toggle('is-here', i === idx);
    });
    if (readoutStation) readoutStation.textContent = idx >= 0 ? STATIONS[idx][1] : '';
  }
  if (plate) plate.style.opacity = String(Math.max(0, Math.min(1, 1 - (alt - BASE) / 1900)));
  if (terrain) { terrain.setAltitude(alt); terrain.setProgress((alt - BASE) / (SUMMIT - BASE)); }
}
function tick() {
  const d = target - shown;
  if (Math.abs(d) < 0.4) { shown = target; paint(shown); raf = 0; return; }
  shown += d * (reduced ? 1 : 0.12);
  paint(shown);
  raf = requestAnimationFrame(tick);
}
// The ladder owns a band at the bottom of the margin. A note that crosses it steps aside for the
// 200px it takes to pass, so the survey column never sets two texts on top of each other.
const notes = $$('.note');
const climb = $('[data-climb]');
function guardNotes() {
  if (!climb || innerWidth < 1000) return;
  const top = climb.getBoundingClientRect().top - 6;
  const bottom = top + 188;
  notes.forEach((n) => {
    const r = n.getBoundingClientRect();
    n.classList.toggle('is-yield', r.bottom > top && r.top < bottom);
  });
}
function onScroll() { target = targetAltitude(); guardNotes(); if (!raf) raf = requestAnimationFrame(tick); }
addEventListener('scroll', onScroll, { passive: true });

// ---------- the mask: contours stop at the reading column, measured from the column's real right edge ----------
const columnEl = $('.block');
let maskRest = [-2, -1.9];
function measureMask() {
  if (!columnEl || innerWidth < 768) { maskRest = [-2, -1.9]; }
  else {
    const right = columnEl.getBoundingClientRect().right;
    maskRest = [(right - 24) / innerWidth, (right + 120) / innerWidth];
  }
  if (terrain && !maskOpen) terrain.setMask(maskRest[0], maskRest[1]);
}
let maskOpen = 0;
function applyMask() {
  if (!terrain) return;
  const l = maskRest[0] + (-1.0 - maskRest[0]) * maskOpen;
  const r = maskRest[1] + (-0.9 - maskRest[1]) * maskOpen;
  terrain.setMask(l, r);
  terrain.setInk(INK.rest + (INK.open - INK.rest) * maskOpen);
  terrain.setGhostBoost(0.42 * maskOpen);
}
addEventListener('resize', () => { measureMask(); applyMask(); onScroll(); });
measureMask();
onScroll();
if (reduced) { shown = target; paint(shown); }

// ---------- the three moments and the break lines ----------
const moments = $$('[data-moment]');
const reveals = $$('[data-reveal]');

function plainMoments() {
  // no GSAP: an IntersectionObserver opens the mask in one 500ms step instead of scrubbing it
  if (!moments.length) return;
  let raf2 = 0, want = 0;
  const step = () => {
    const d = want - maskOpen;
    if (Math.abs(d) < 0.005) { maskOpen = want; applyMask(); raf2 = 0; return; }
    maskOpen += d * 0.18; applyMask(); raf2 = requestAnimationFrame(step);
  };
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { e.target.__in = e.isIntersecting; });
    want = moments.some((m) => m.__in) ? 1 : 0;
    if (reduced) { maskOpen = want; applyMask(); return; }
    if (!raf2) raf2 = requestAnimationFrame(step);
  }, { rootMargin: '-18% 0px -18% 0px', threshold: 0 });
  moments.forEach((m) => io.observe(m));
}

function plainReveal() {
  if (reduced) return reveals.forEach((el) => el.classList.add('is-in'));
  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -15% 0px' });
  reveals.forEach((el) => io.observe(el));
}

function richMoments() {
  // Each moment scrubs the shader mask open across the whole canvas and closed again.
  // The summit holds open in the middle so the last one culminates instead of passing.
  moments.forEach((m) => {
    const proxy = { v: 0 };
    const summit = m.id === 'getup';
    const tl = gsap.timeline({
      scrollTrigger: { trigger: m, start: 'top 75%', end: 'bottom 25%', scrub: 0.6 },
      onUpdate: () => { maskOpen = proxy.v; applyMask(); },
    });
    tl.to(proxy, { v: 1, duration: 1, ease: 'none' });
    if (summit) tl.to(proxy, { v: 1, duration: 0.9, ease: 'none' });
    tl.to(proxy, { v: 0, duration: 1, ease: 'none' });
  });
}

function richReveal() {
  gsap.registerPlugin(ScrollTrigger, SplitText);
  if (window.Lenis) {
    const lenis = new Lenis({ lerp: 0.11 });
    lenis.on('scroll', () => { ScrollTrigger.update(); onScroll(); });
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    document.documentElement.classList.add('lenis');
    window.__qaSettle = () => new Promise((r) => setTimeout(r, 700));
  }
  richMoments();
  document.fonts.ready.then(() => {
    reveals.forEach((el) => {
      el.classList.add('is-in');
      // "Get up." lands as the number lands: its own trigger is the block's centre, not its top
      const summit = el.classList.contains('getup');
      const st = summit
        ? { trigger: el, start: 'center 52%', once: true }
        : { trigger: el, start: 'top 88%', once: true };
      SplitText.create(el, { type: 'lines', mask: 'lines', autoSplit: true, aria: 'none', onSplit: (s) =>
        gsap.from(s.lines, { yPercent: 108, duration: summit ? 0.7 : 0.85, stagger: 0.07, ease: 'expo.out', scrollTrigger: st }) });
    });
    ScrollTrigger.refresh();
  });
}

addEventListener('load', () => {
  if (!reduced && window.gsap && window.ScrollTrigger && window.SplitText) richReveal();
  else { plainReveal(); plainMoments(); }
});
if (reduced) { plainReveal(); plainMoments(); }

// ---------- terrain ----------
async function startTerrain() {
  if (!canvas) return;
  const useStill = () => { if (still) still.hidden = false; canvas.hidden = true; };
  if (reduced || no3d || lowEnd || !webglAvailable()) return useStill();
  try {
    const t0 = performance.now();
    terrain = await initTerrain({ canvas, mobile });
    if (performance.now() - t0 > 4000) { terrain.destroy(); terrain = null; return useStill(); }
    measureMask();
    applyMask();
    paint(shown);
    canvas.classList.add('is-ready');
    // the plate stays: it is the hero's photograph and it hands over to the survey as the reader climbs
    window.__terrain = terrain;                      // QA handle only
    if (!mobile && matchMedia('(hover: hover) and (pointer: fine)').matches) {
      addEventListener('pointermove', (e) => terrain && terrain.setPointer((e.clientX / innerWidth - 0.5) * 2, (e.clientY / innerHeight - 0.5) * -2), { passive: true });
    }
    addEventListener('pagehide', () => terrain && terrain.destroy(), { once: true });
  } catch (err) { useStill(); }
}
if ('requestIdleCallback' in window) requestIdleCallback(startTerrain, { timeout: 1500 }); else setTimeout(startTerrain, 200);

// ---------- the door ----------
const form = $('#door-form');
if (form) {
  const btn = $('button[type="submit"]', form);
  const label = btn ? btn.textContent : 'Write back';
  const errBox = $('[data-form-error]');
  const sent = $('[data-form-sent]');
  const field = (name) => $(`[name="${name}"]`, form);
  const MSG = { name: 'Add your name.', email: 'That email has a typo. Check the part after the @.', reason: 'Pick one.', message: 'Write something. One line is enough.' };
  const showError = (msg, name) => {
    $$('.is-invalid', form).forEach((el) => el.classList.remove('is-invalid'));
    const f = name && field(name); if (f) { f.classList.add('is-invalid'); f.focus({ preventScroll: false }); }
    if (errBox) { errBox.innerHTML = msg; errBox.hidden = false; }
  };
  const check = (data) => {
    if (!data.name.trim()) return 'name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return 'email';
    if (!data.reason) return 'reason';
    if (data.message.trim().length < 10) return 'message';
    return null;
  };
  const read = () => { const d = Object.fromEntries(new FormData(form).entries()); ['name', 'email', 'reason', 'message', 'website'].forEach((k) => { d[k] = String(d[k] || ''); }); return d; };
  $$('input, select, textarea', form).forEach((el) => {
    el.addEventListener('blur', () => { if (form.dataset.tried) { const bad = check(read()); if (bad !== el.name) el.classList.remove('is-invalid'); } });
    el.addEventListener('focus', () => document.body.classList.add('is-typing'));
    el.addEventListener('blur', () => document.body.classList.remove('is-typing'));
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.dataset.tried = '1';
    const data = read();
    const bad = check(data);
    if (bad) return showError(MSG[bad], bad);
    if (errBox) errBox.hidden = true;
    if (btn) { btn.disabled = true; btn.textContent = btn.dataset.sending || 'Sending'; }
    try {
      const r = await fetch(form.action, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ name: data.name, email: data.email, reason: data.reason, message: data.message, website: data.website }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error || "It didn't send. Try again, or email <a href=\"mailto:hello@nepalaccelerates.com\">hello@nepalaccelerates.com</a>."), { field: j.field });
      form.hidden = true;
      if (sent) { sent.hidden = false; sent.focus(); }
    } catch (err) {
      showError(err.message.includes('fetch') ? "It didn't send. Try again, or email <a href=\"mailto:hello@nepalaccelerates.com\">hello@nepalaccelerates.com</a>." : err.message, err.field);
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  });
  const q = new URLSearchParams(location.search);
  if (q.get('sent') === '1') { form.hidden = true; if (sent) sent.hidden = false; }
  else if (q.get('error')) showError(MSG[q.get('error')] || 'Something was missing. Fill every field and send again.', q.get('error'));
}

// ---------- Nepal time in the footer ----------
const nst = $('#nst');
if (nst) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false });
  const set = () => { nst.textContent = f.format(new Date()) + ' NST'; };
  set(); setInterval(set, 60000);
}
