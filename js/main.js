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
document.documentElement.classList.add('jsr');   // this file is running: the plate can answer the scroll
if (!reduced) document.documentElement.classList.add('js');

const BASE = 1400, SUMMIT = 8848.86;
const STATIONS = [[1400, 'Kathmandu'], [2846, 'Lukla'], [3440, 'Namche Bazaar'], [3867, 'Tengboche'], [5364, 'Base Camp'], [5644, 'Kala Patthar'], [7906, 'South Col'], [8848.86, 'Sagarmatha']];
const fmt = (m) => (m >= SUMMIT - 1 ? '8,848.86' : Math.round(m).toLocaleString('en-US')) + ' m';

// ink levels: the hero owns the sheet, the letter takes it back, the mask moments open it again
const INK = mobile ? { hero: 0.82, rest: 0.18, open: 0.5 } : { hero: 0.82, rest: 0.64, open: 0.56 };

// ---------- the headline. Never gated on a GPU, on fonts, or on idle time. ----------
const words = $$('.hero-sheet .w i');
function revealWords(base = 540) {
  if (reduced) { words.forEach((w) => { w.style.transform = 'none'; }); return; }
  words.forEach((w, i) => w.animate(
    [{ transform: 'translateY(112%)' }, { transform: 'translateY(0)' }],
    { duration: 500, delay: base + i * 50, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' },
  ));
}
// when the intro plays it knocks the headline up itself, on the reveal beat; otherwise it lands on load
const introArmed = document.documentElement.classList.contains('intro-armed') && !reduced;
addEventListener('load', () => { if (!introArmed) revealWords(); });

// ---------- bar ----------
const nav = $('[data-nav]');
const hero = $('[data-hero]');
// the bar readout takes over just after the spot height fades, at about half a viewport
if (nav && hero) new IntersectionObserver((e) => nav.classList.toggle('is-on', !e[0].isIntersecting), { rootMargin: '-45% 0px 0px 0px' }).observe(hero);
$$('a[href="#door"]').forEach((a) => a.addEventListener('click', (e) => { const d = $('#door'); if (!d) return; e.preventDefault(); d.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); history.replaceState(null, '', '#door'); }));

// ---------- altitude: one number for the readout, the ladder, the red ring and the camera ----------
const readouts = $$('[data-readout]');
const readoutStation = $('[data-readout-station]');
const climbRows = $$('[data-alt]');
const getup = $('#getup');
const canvas = $('#massif');
const still = $('#massif-still');
const spot = $('#spot');
const spotAlt = $('[data-spot-alt]');
const spotStation = $('[data-spot-station]');
let target = BASE, shown = BASE, terrain = null, raf = 0, hereIdx = -1;
let surveying = false, heroK = 0;

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
  if (terrain && !surveying) {
    const drawn = drawAltitude(alt);
    terrain.setAltitude(drawn);
    terrain.setProgress((alt - BASE) / (SUMMIT - BASE));
    applyRed(drawn);
  }
}
// The survey pass leaves the sheet drawn to the summit and the red pen closed as a ring on the peak.
// Over the first viewport the sheet is handed back: the frontier returns to the altitude the reader
// is actually at, and from there the climb is theirs. Continuous, so there is no snap at the handoff.
function drawAltitude(alt) { return SUMMIT + (alt - SUMMIT) * heroK; }
// One writer for the red pen: crisp and full through the hero, faint while the letter reads,
// back to full weight as the ring closes on the summit at "Get up.".
function applyRed(alt) {
  if (!terrain) return;
  const t = Math.max(0, Math.min(1, (alt - 8000) / 848.86));
  // the pen stops climbing at 8,400 m, so the last thing it does is close as a ring around the
  // peak instead of flooding the summit cap with a line too short to read
  terrain.tune('uRedH', Math.min(alt, 8400) / 1000 * 1.2);
  terrain.tune('uRedW', (mobile ? 0.55 : 1.35) + (mobile ? 0.3 : 0.95) * t);   // the 128 grid spans more screen per cell, so the pen has to be finer on a phone
  terrain.tune('uRedA', Math.max(1 - 0.75 * heroK, 0.72 + 0.28 * t));
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
// the spot height rides the real summit vertex, projected through the live camera
function pinSpot() {
  if (!terrain || !spot || !terrain.projectSummit) return;
  const p = terrain.projectSummit();
  spot.style.transform = 'translate(' + (p.x * innerWidth).toFixed(1) + 'px, ' + (p.y * innerHeight).toFixed(1) + 'px)';
  spot.classList.toggle('noflip', p.x <= 0.62);
  spot.style.visibility = 'visible';
}
requestAnimationFrame(pinSpot);
addEventListener('resize', pinSpot, { passive: true });

function onScroll() { target = targetAltitude(); applyShader(); guardNotes(); if (!raf) raf = requestAnimationFrame(tick); }
addEventListener('scroll', onScroll, { passive: true });

// ---------- the mask: contours stop at the reading column, measured from the column's real right edge ----------
const columnEl = $('.block');
let maskRest = [-2, -1.9];
function measureMask() {
  if (!columnEl || innerWidth < 768) { maskRest = [-2, -1.9]; }
  else {
    const right = columnEl.getBoundingClientRect().right;
    // the contours run under the last third of the measure, so the sheet has no visible edge
    maskRest = [(right - 320) / innerWidth, (right + 40) / innerWidth];
  }
}
let maskOpen = 0;
// The only writer for the mask, the ink, the ghost and the spot's opacity. It also owns the hero
// handoff: over the first viewport the sheet goes from full bleed at hero ink to the reading state.
function applyShader() {
  if (!terrain) return;
  const k = Math.max(0, Math.min(1, scrollY / innerHeight));
  heroK = k;
  const km = Math.min(1, k / 0.6);
  const heroL = -2, heroR = -1.9;
  const l0 = mobile ? maskRest[0] : heroL + (maskRest[0] - heroL) * km;
  const r0 = mobile ? maskRest[1] : heroR + (maskRest[1] - heroR) * km;
  terrain.setMask(l0 + (-1.0 - l0) * maskOpen, r0 + (-0.9 - r0) * maskOpen);
  const base = INK.hero + (INK.rest - INK.hero) * k;
  terrain.setInk(base + (INK.open - base) * maskOpen);
  terrain.setGhostBoost(Math.max(0.22 * (1 - k), 0.42 * maskOpen));
  if (spot) {
    const o = Math.max(0, 1 - k / 0.5);
    spot.style.opacity = o.toFixed(3);
    spot.style.visibility = o <= 0.01 ? 'hidden' : 'visible';
  }
}
addEventListener('resize', () => { measureMask(); applyShader(); pinSpot(); onScroll(); });
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
    if (Math.abs(d) < 0.005) { maskOpen = want; applyShader(); raf2 = 0; return; }
    maskOpen += d * 0.18; applyShader(); raf2 = requestAnimationFrame(step);
  };
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { e.target.__in = e.isIntersecting; });
    want = moments.some((m) => m.__in) ? 1 : 0;
    if (reduced) { maskOpen = want; applyShader(); return; }
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
      onUpdate: () => { maskOpen = proxy.v; applyShader(); },
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

// ---------- the intro: survey from the valley floor ----------
// The night veil is up from first paint (armed in the head script). A red survey cross and a mono
// altitude readout climb the STATIONS ladder, physically clamped to the highest station the real load
// has unlocked, never a timer's percentage. At the summit, or a hard 1800ms cap, the camera lifts from
// a near-plan survey rig to the shipped hero oblique in one 900ms move, the veil walks to zero and the
// headline knocks up through it. All the intro does is choreograph parts that already ship.
const HERO_RIG = {
  port: { fov: 33, from: [-1.2, 23, 15], to: [-1.2, 23, 15], look: [-1.2, 3.4, -1], lookTo: [-1.2, 3.4, -1] },
  land: { fov: 26, from: [-1.0, 22, 15], to: [-1.0, 22, 15], look: [-1.0, 6.0, -1], lookTo: [-1.0, 6.0, -1] },
};
// the lift's start: camera nearly overhead, the massif read flat as a plate on the survey table, so
// the reveal is a real plan-to-oblique tilt and not a small nudge
const SURVEY_RIG = {
  port: { fov: 34, from: [-1.2, 48, 2.0], look: [-1.2, 1.0, -1.5] },
  land: { fov: 26, from: [-1.0, 44, 1.5], look: [-1.0, 1.0, -1.5] },
};

const introEl = $('[data-intro]');
const introAltEl = $('[data-intro-alt]');
const introStnEl = $('[data-intro-stn]');
const veilEl = $('[data-veil]');
const debugIntro = new URLSearchParams(location.search).has('introdebug');
const INTRO_STATIONS = [[BASE, 'Kathmandu'], [2846, 'Lukla'], [5364, 'Base Camp'], [7906, 'South Col'], [SUMMIT, 'Sagarmatha']];
const CLIMB_MS = debugIntro ? 2600 : 1500;
const CAP_MS = debugIntro ? 3400 : 1800;
const REVEAL_MS = 900;
let introCeil = 0, introDone = false, introT0 = 0;

// a real cubic-bezier(0.16,1,0.3,1) sampler for the JS-driven camera lift (CSS owns the rest)
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = (t) => ((ax * t + bx) * t + cx) * t;
  const fy = (t) => ((ay * t + by) * t + cy) * t;
  const dfx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => { let t = x; for (let i = 0; i < 6; i++) { const e = fx(t) - x; if (Math.abs(e) < 1e-4) break; const d = dfx(t) || 1e-4; t -= e / d; } return fy(t); };
}
// the veil lifts fast (the dark off the sheet, gone under ~400ms); the camera tilts on a smoother curve
// so the plan-to-oblique move stays trackable across the whole 900ms and settles soft
const easeCam = bezier(0.42, 0, 0.16, 1);
const VEIL_MS = 400;

function introMilestone(stage) {
  const idx = { three: 1, dem: 2, compile: 3, ready: 4 }[stage];
  if (idx != null && idx > introCeil) introCeil = idx;
}
function paintIntro(alt) {
  if (introAltEl) introAltEl.textContent = alt >= SUMMIT - 1 ? '8,848.86' : Math.round(alt).toLocaleString('en-US');
  let stn = INTRO_STATIONS[0][1];
  for (const s of INTRO_STATIONS) if (alt >= s[0] - 1) stn = s[1];
  if (introStnEl && introStnEl.textContent !== stn) introStnEl.textContent = stn;
}
function introTick(now) {
  if (introDone) return;
  if (!introT0) introT0 = now;
  const el = now - introT0;
  const p = 1 - Math.pow(1 - Math.min(1, el / CLIMB_MS), 2.2);      // the survey() draw easing, reused
  const natural = BASE + (SUMMIT - BASE) * p;
  const ceil = INTRO_STATIONS[introCeil][0];
  const alt = Math.min(natural, ceil);                             // never past the station the load unlocked
  paintIntro(alt);
  if (terrain) { terrain.setAltitude(alt); applyRed(alt); }        // the sheet draws under the veil, ready for the lift
  if (alt >= SUMMIT - 1 || el >= CAP_MS) { startReveal(); return; }
  requestAnimationFrame(introTick);
}
function startReveal() {
  if (introDone) return;
  introDone = true;
  try { sessionStorage.setItem('nacc-intro-v1', '1'); } catch (e) {}
  paintIntro(SUMMIT);
  shown = target = targetAltitude();
  const hasCanvas = !!terrain;
  if (hasCanvas) {
    terrain.setAltitude(SUMMIT); applyRed(SUMMIT);
    document.documentElement.classList.add('gl');
    canvas.classList.add('is-ready');
    if (still) still.hidden = true;                // the still-to-canvas swap happens under the opaque veil, no crossfade
    terrain.armReveal(SURVEY_RIG);
  }
  if (introEl) introEl.classList.add('is-revealing');
  const t0 = performance.now();
  let wordsFired = false;
  (function rev(now) {
    const dt = now - t0;
    const k = Math.min(1, dt / REVEAL_MS);
    if (hasCanvas) { terrain.reveal(easeCam(k)); pinSpot(); }   // the table tilts up: survey rig to hero oblique
    if (veilEl) veilEl.style.opacity = String(Math.max(0, 1 - dt / VEIL_MS));   // the dark lifts off the sheet
    if (!wordsFired && dt >= 300) { wordsFired = true; revealWords(0); }        // headline knocks up at the 300ms mark
    if (k < 1) requestAnimationFrame(rev);
    else finishReveal(hasCanvas);
  })(performance.now());
}
function finishReveal(hasCanvas) {
  if (hasCanvas) {
    terrain.endReveal();
    terrain.setProgress(0);
    measureMask(); applyShader(); pinSpot();
  }
  paint(shown);
  if (introEl) introEl.hidden = true;
}
function skipIntro() { if (!introDone) startReveal(); }
if (introArmed) {
  const skipBtn = $('[data-skip]');
  if (skipBtn) skipBtn.addEventListener('click', skipIntro);
  addEventListener('keydown', () => { if (introArmed && !introDone) skipIntro(); });
}

// ---------- terrain ----------
function configureTerrain() {
  // The hero camera: a near-plan oblique, the massif as a sheet on a table and not a horizon.
  // from equals to, so setProgress no longer travels the camera; it still drives the parallax settle.
  terrain.setRig(HERO_RIG);
  // Schneider rhythm read at this camera: a phone frame drowns below 180 m, a desktop frame goes
  // hollow above 120 m. The sheet note states whichever interval is actually drawn.
  const IV_M = mobile ? 160 : 120;
  terrain.tune('uInterval', IV_M / 1000 * 1.2);
  terrain.tune('uThinA', mobile ? 0.28 : 0.30);
  terrain.tune('uIndexW', 2.3);
  terrain.tune('uFogNear', 34); terrain.tune('uFogFar', 110);
  terrain.tune('uWash', 0.03);
  const ci = $('[data-ci]'); if (ci) ci.textContent = 'contours ' + IV_M + ' m, index ' + IV_M * 5 + ' m';
  measureMask();
  terrain.setAltitude(BASE);
  applyShader();
  applyRed(BASE);
  window.__terrain = terrain;                      // QA handle only
}
function attachTerrainPointer() {
  if (!mobile && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    addEventListener('pointermove', (e) => terrain && terrain.setPointer((e.clientX / innerWidth - 0.5) * 2, (e.clientY / innerHeight - 0.5) * -2), { passive: true });
  }
  addEventListener('pagehide', () => terrain && terrain.destroy(), { once: true });
}
async function startTerrain() {
  if (!canvas) return;
  const useStill = () => {
    canvas.hidden = true;
    if (!still) return;
    still.hidden = false;
    // no live sheet to hand over to, so the plate itself drops out of the way of the letter
    const fade = () => { still.style.opacity = Math.max(0.07, 1 - (scrollY / innerHeight) * 0.93).toFixed(3); };
    addEventListener('scroll', fade, { passive: true });
    addEventListener('resize', fade, { passive: true });
    fade();
  };
  if (reduced || no3d || lowEnd || !webglAvailable()) { if (introArmed && !introDone) startReveal(); return useStill(); }
  try {
    const t0 = performance.now();
    // milestones drive the intro's counter through real load events; debug slows them for frame capture
    terrain = await initTerrain({ canvas, mobile, onMilestone: introMilestone, debug: debugIntro });
    if (!introArmed && performance.now() - t0 > 4000) { terrain.destroy(); terrain = null; return useStill(); }
    configureTerrain();
    introMilestone('ready');

    if (introArmed) {
      // the intro's rAF loop owns the reveal. If the 1800ms cap already fired it with no canvas ready,
      // bring the live sheet up now through the ordinary is-ready fade.
      if (introDone) {
        terrain.setAltitude(SUMMIT); applyRed(SUMMIT);
        document.documentElement.classList.add('gl');
        canvas.classList.add('is-ready');
        if (still) { still.style.opacity = '0'; setTimeout(() => { still.hidden = true; }, 420); }
        pinSpot();
        shown = target = targetAltitude(); paint(shown);
      }
      attachTerrainPointer();
      return;
    }

    // no intro this session (repeat visit): the shipped path, sheet surveyed valley-to-summit into the spot
    document.documentElement.classList.add('gl');   // the spot stops being a static plate label
    canvas.classList.add('is-ready');
    if (still) { still.style.opacity = '0'; setTimeout(() => { still.hidden = true; }, 420); }

    // The one orchestrated moment: the sheet is surveyed from the valley floor to the summit in a
    // single second and the red pen closes as a ring on the peak. It writes only to the spot height,
    // because the bar readout and the station ladder carry the reader's altitude and the reader
    // has not moved. When it ends the spot freezes: a spot height is not a live number.
    const SPOT_STATIONS = [[0, 'Kathmandu'], [2846, 'Lukla'], [3440, 'Namche Bazaar'], [5364, 'Base Camp'], [7906, 'South Col'], [8848, 'Sagarmatha']];
    const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
    function paintSpot(m, done) {
      if (!spotAlt) return;
      spotAlt.textContent = done ? '8,848.86' : nf0.format(m);
      let st = SPOT_STATIONS[0][1];
      for (const pair of SPOT_STATIONS) if (m >= pair[0]) st = pair[1];
      if (spotStation && spotStation.textContent !== st) spotStation.textContent = st;
    }
    if (reduced) {
      terrain.setAltitude(SUMMIT); applyRed(SUMMIT); paintSpot(SUMMIT, true); pinSpot();
      shown = target = targetAltitude(); paint(shown);
    } else {
      surveying = true;
      const DUR = 1000, t0b = performance.now(), draw2 = (k) => 1 - Math.pow(1 - k, 2.2);
      (function survey(now) {
        const k = Math.min(1, (now - t0b) / DUR);
        const m = BASE + (SUMMIT - BASE) * draw2(k);
        terrain.setAltitude(m); applyRed(m); paintSpot(k === 1 ? SUMMIT : m, k === 1); pinSpot();
        if (k < 1) requestAnimationFrame(survey);
        else { surveying = false; shown = target = targetAltitude(); paint(shown); }
      })(performance.now());
    }
    attachTerrainPointer();
  } catch (err) { if (introArmed && !introDone) startReveal(); useStill(); }
}
if (introArmed) {
  requestAnimationFrame(introTick);                                  // the readout starts climbing from first paint
  requestAnimationFrame(() => requestAnimationFrame(startTerrain));  // boot terrain a paint later so the veil shows first
} else if ('requestIdleCallback' in window) requestIdleCallback(startTerrain, { timeout: 1500 });
else setTimeout(startTerrain, 200);

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

// ---------- n/acc team panel (decoy: it never grants access) ----------
const panel = document.getElementById('team-panel');
if (panel) {
  const openers = $$('[data-open-panel]');
  const closers = $$('[data-close-panel]', panel);
  const pform = document.getElementById('panel-form');
  const perr = $('[data-panel-err]');
  const pbtn = $('.panel-submit', panel);
  const plabel = pbtn ? pbtn.textContent : 'Sign in';
  let lastFocus = null;
  const open = () => { lastFocus = document.activeElement; panel.hidden = false; document.body.style.overflow = 'hidden'; const u = document.getElementById('p-user'); if (u) setTimeout(() => u.focus(), 30); };
  const close = () => { panel.hidden = true; document.body.style.overflow = ''; if (perr) perr.hidden = true; if (pform) pform.reset(); if (pbtn) { pbtn.disabled = false; pbtn.textContent = plabel; } if (lastFocus && lastFocus.focus) lastFocus.focus(); };
  openers.forEach((b) => b.addEventListener('click', open));
  closers.forEach((b) => b.addEventListener('click', close));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(); });
  if (pform) pform.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (perr) perr.hidden = true;
    const u = (document.getElementById('p-user').value || '').trim();
    const p = document.getElementById('p-pass').value || '';
    if (!u || !p) { if (perr) { perr.textContent = 'Enter your username and password.'; perr.hidden = false; } return; }
    if (pbtn) { pbtn.disabled = true; pbtn.textContent = 'Signing in'; }
    try {
      const r = await fetch('https://mail.nepalaccelerates.com/api/team/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
      const j = await r.json().catch(() => ({}));
      if (perr) { perr.textContent = j.error || 'Invalid username or password.'; perr.hidden = false; }
    } catch {
      if (perr) { perr.textContent = 'Could not reach the server. Try again.'; perr.hidden = false; }
    }
    if (pbtn) { pbtn.disabled = false; pbtn.textContent = plabel; }
    const pp = document.getElementById('p-pass'); if (pp) { pp.value = ''; pp.focus(); }
  });
}
