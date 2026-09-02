// n/acc page behaviour. The page reads fully with this file missing.
//   #massif            the terrain canvas (fixed, behind the sheet); #massif-still is the no-WebGL / reduced-motion still.
//   #altitude          mono readout; [data-station] the margin station in the hero.
//   #getup             the "Get up." block: the altitude reaches 8,848.86 m when it is centred.
//   [data-moment]      the three break blocks: while one is in view the massif fills the screen.
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
const fmt = (m) => (m >= SUMMIT - 0.01 ? '8,848.86' : Math.round(m).toLocaleString('en-US')) + ' m';

// ---------- bar ----------
const nav = $('[data-nav]');
const hero = $('[data-hero]');
if (nav && hero) new IntersectionObserver((e) => nav.classList.toggle('is-on', !e[0].isIntersecting), { rootMargin: '-80px 0px 0px 0px' }).observe(hero);
$$('a[href="#door"]').forEach((a) => a.addEventListener('click', (e) => { const d = $('#door'); if (!d) return; e.preventDefault(); d.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); history.replaceState(null, '', '#door'); }));

// ---------- altitude: one number for the readout, the red contour and the camera ----------
const readout = $('#altitude');
const station = $('[data-station]');
const getup = $('#getup');
const canvas = $('#massif');
const still = $('#massif-still');
let target = BASE, shown = BASE, terrain = null, raf = 0;

function targetAltitude() {
  if (!getup) return BASE;
  const top = getup.getBoundingClientRect().top + window.scrollY;
  const end = top + getup.offsetHeight / 2 - innerHeight / 2;
  const p = Math.max(0, Math.min(1, window.scrollY / Math.max(1, end)));
  return BASE + (SUMMIT - BASE) * p;
}
function paint(alt) {
  if (readout) { readout.textContent = fmt(alt); readout.classList.toggle('is-summit', alt >= SUMMIT - 0.01); }
  if (station) {
    const near = STATIONS.find(([m]) => Math.abs(m - alt) < 60);
    station.innerHTML = fmt(alt) + '<br>' + (near ? near[1] : '&nbsp;');
    station.classList.toggle('is-summit', alt >= SUMMIT - 0.01);
  }
  if (terrain) { terrain.setAltitude(alt); terrain.setProgress((alt - BASE) / (SUMMIT - BASE)); }
}
function tick() {
  const d = target - shown;
  if (Math.abs(d) < 0.5) { shown = target; paint(shown); raf = 0; return; }
  shown += d * (reduced ? 1 : 0.12);
  paint(shown);
  raf = requestAnimationFrame(tick);
}
function onScroll() { target = targetAltitude(); if (!raf) raf = requestAnimationFrame(tick); }
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll);
onScroll();
if (reduced) { shown = target; paint(shown); }

// the three moments: the massif fills the screen while a break line is in view
const moments = $$('[data-moment]');
if (moments.length) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { e.target.__in = e.isIntersecting; });
    document.body.classList.toggle('is-moment', moments.some((m) => m.__in));
  }, { rootMargin: '-20% 0px -20% 0px', threshold: 0 });
  moments.forEach((m) => io.observe(m));
}

// the break lines: masked line reveal with GSAP when it is there, a plain fade otherwise
const reveals = $$('[data-reveal]');
function plainReveal() {
  if (reduced) return reveals.forEach((el) => el.classList.add('is-in'));
  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -15% 0px' });
  reveals.forEach((el) => io.observe(el));
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
  document.fonts.ready.then(() => {
    reveals.forEach((el) => {
      el.classList.add('is-in');
      SplitText.create(el, { type: 'lines', mask: 'lines', autoSplit: true, onSplit: (s) =>
        gsap.from(s.lines, { yPercent: 108, duration: 0.85, stagger: 0.07, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 88%', once: true } }) });
    });
  });
}
addEventListener('load', () => { (!reduced && window.gsap && window.SplitText) ? richReveal() : plainReveal(); });
if (reduced) plainReveal();

// ---------- terrain ----------
async function startTerrain() {
  if (!canvas) return;
  const useStill = () => { if (still) still.hidden = false; canvas.hidden = true; };
  if (reduced || no3d || lowEnd || !webglAvailable()) return useStill();
  try {
    const t0 = performance.now();
    terrain = await initTerrain({ canvas, mobile });
    if (performance.now() - t0 > 4000) { terrain.destroy(); terrain = null; return useStill(); }
    paint(shown);
    canvas.classList.add('is-ready');
    if (!mobile) addEventListener('pointermove', (e) => terrain && terrain.setPointer((e.clientX / innerWidth - 0.5) * 2, (e.clientY / innerHeight - 0.5) * -2), { passive: true });
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
  $$('input, select, textarea', form).forEach((el) => {
    el.addEventListener('blur', () => { if (form.dataset.tried) { const bad = check(read()); if (bad !== el.name) el.classList.remove('is-invalid'); } });
    el.addEventListener('focus', () => document.body.classList.add('is-typing'));
    el.addEventListener('blur', () => document.body.classList.remove('is-typing'));
  });
  const read = () => { const d = Object.fromEntries(new FormData(form).entries()); ['name', 'email', 'reason', 'message', 'website'].forEach((k) => { d[k] = String(d[k] || ''); }); return d; };
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
