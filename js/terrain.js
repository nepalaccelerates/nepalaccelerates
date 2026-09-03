// Sagarmatha massif as a survey sheet. Real SRTM heights (assets/dem), drawn as contour lines.
// One scene, one idea: the sheet is a 34.56 km square of the Khumbu, drawn only up to the reader's altitude.
// Exposes: initTerrain({ canvas, mobile }) -> handle with setAltitude / setProgress / setMask / setInk / setPointer / destroy
import * as THREE from 'three';

const EXTENT_KM = 34.56;                 // the grid covers a 34.56 km square, row 0 = north, col 0 = west
const EXAG = 1.2;                        // vertical exaggeration; survey sheets do the same for relief

// sRGB triplets, passed straight through: the shader mixes in sRGB so uAlpha 0.45 is exactly --contour-ink.
const srgb = (hex) => new THREE.Vector3(
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
);
const BG = srgb('#060606');
const CREAM = srgb('#ede8de');
const RED = srgb('#e8402a');

// the highest closed contour the mesh can hold: 256 grid tops at 8,719 m, 128 grid at 8,688 m
const RING_CAP = { 256: 8700, 128: 8640 };

async function loadHeights(url) {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const n = c.width * c.height;
  const h = new Float32Array(n);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = (d[i * 4] * 256 + d[i * 4 + 1] - 32768) / 1000;   // km
    h[i] = v; if (v < min) min = v; if (v > max) max = v;
  }
  return { h, size: c.width, min, max };
}

const VERT = `
  varying float vH;
  varying vec3 vPos;
  void main() {
    vH = position.z;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

// Survey rhythm: a thin line every uInterval, an index line every fifth (Schneider 1:5).
// The density fade keeps steep faces from filling in: where one screen pixel spans more than
// about half a contour the ink drops to a flat wash instead of a slab.
const FRAG = `
  precision highp float;
  varying float vH;
  varying vec3 vPos;
  uniform float uInterval, uWeight, uReveal, uAlpha;
  uniform float uWash, uFadeA, uFadeB, uGhost;
  uniform float uThinA, uIndexW, uIndexA;
  uniform float uMaskL, uMaskR;
  uniform float uRedH, uRedW, uRedA;
  uniform float uFogNear, uFogFar;
  uniform vec2 uResolution;
  uniform vec3 uLine, uRed, uBg, uCam;

  float band(float c, float w) {
    float d = abs(fract(c - 0.5) - 0.5) / max(fwidth(c), 1e-4);
    return 1.0 - smoothstep(w - 0.5, w + 0.5, d);
  }

  void main() {
    float c = vH / uInterval;
    float fw = fwidth(c);
    float thin = band(c, uWeight) * uThinA;
    float index = band(c / 5.0, uWeight * uIndexW) * uIndexA;
    float a = max(thin, index);
    a = mix(a, uWash, smoothstep(uFadeA, uFadeB, fw));

    // ground above the reader's altitude is not surveyed yet: it stays a ghost, so the drawn
    // edge reads as the frontier the climb is pushing upward
    a *= mix(uGhost, 1.0, smoothstep(uReveal + 0.02, uReveal - 0.02, vH));

    // the reading column keeps its own paper: the mask is a shader uniform, in normalised x
    float m = smoothstep(uMaskL, uMaskR, gl_FragCoord.x / uResolution.x);
    a *= uAlpha * m;

    // the one red contour, clamped so at the summit it closes as a ring on the peak
    float dr = abs(vH - uRedH) / max(fwidth(vH), 1e-4);
    float r = (1.0 - smoothstep(uRedW - 0.5, uRedW + 0.5, dr)) * uRedA * m;
    r *= smoothstep(uReveal + 0.02, uReveal - 0.02, vH);

    vec3 col = mix(uBg, uLine, clamp(a, 0.0, 1.0));
    col = mix(col, uRed, clamp(r, 0.0, 1.0));
    float fog = smoothstep(uFogNear, uFogFar, distance(vPos, uCam));
    col = mix(col, uBg, fog);
    gl_FragColor = vec4(col, 1.0);
  }`;

export async function initTerrain({ canvas, mobile = false, onReady } = {}) {
  const gridUrl = new URL(mobile ? '../assets/dem/sagarmatha-128.webp' : '../assets/dem/sagarmatha-256.webp', import.meta.url).href;
  const dem = await loadHeights(gridUrl);
  const S = dem.size;
  const ringCap = RING_CAP[S] || 8640;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'default' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.setClearColor(0x060606, 0);   // transparent sky, so the hero photograph shows above the ridge line
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(19, 1, 1, 70);

  const geo = new THREE.PlaneGeometry(EXTENT_KM, EXTENT_KM, S - 1, S - 1);
  const arr = geo.attributes.position.array;                 // row-major, matches ImageData 1:1
  for (let i = 0; i < dem.h.length; i++) arr[i * 3 + 2] = dem.h[i] * EXAG;
  geo.attributes.position.needsUpdate = true;
  geo.computeBoundingSphere();

  // 40 m interval with an index line every 200 m on the 256 grid; 80 / 400 on the 128 grid
  const interval = (mobile ? 0.08 : 0.04) * EXAG;
  const dpr = renderer.getPixelRatio();
  const uniforms = {
    uInterval: { value: interval },
    uWeight: { value: dpr >= 2 ? 0.62 : (mobile ? 0.52 : 0.56) },
    uReveal: { value: 1.4 * EXAG },
    uAlpha: { value: mobile ? 0.10 : 0.50 },
    uWash: { value: mobile ? 0.10 : 0.075 },
    uFadeA: { value: 0.22 }, uFadeB: { value: 0.62 }, uGhost: { value: 0.0 },
    uThinA: { value: 0.55 }, uIndexW: { value: 1.55 }, uIndexA: { value: 1.0 },
    uMaskL: { value: -2 }, uMaskR: { value: -1.9 },
    uRedH: { value: 0 }, uRedW: { value: 1.3 }, uRedA: { value: 0.8 },
    uFogNear: { value: 22 }, uFogFar: { value: 46 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uLine: { value: CREAM.clone() }, uRed: { value: RED.clone() },
    uBg: { value: BG.clone() }, uCam: { value: new THREE.Vector3() },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, depthWrite: true, depthTest: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;              // row 0 (north) lies at -z, the camera sits south of the sheet
  scene.add(mesh);

  // the highest vertex in world space, so a spot height can be pinned to the real peak
  scene.updateMatrixWorld(true);
  let best = 0;
  for (let i = 1; i < dem.h.length; i++) if (dem.h[i] > dem.h[best]) best = i;
  const summitWorld = mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(geo.attributes.position, best));
  const _p = new THREE.Vector3();

  // From the Dudh Kosi side looking north. The Nuptse-Everest-Lhotse ridge reads as one line and the
  // summit lands right of the reading column. y climbs with the reader, then stops at the summit.
  // Numbers, not taste. Landscape: fov 19, 20 km south of the sheet, tilted 16 degrees down so the
  // contours read as nested loops rather than strata. The summit (world 0.114, 10.46 exaggerated,
  // 0.70) lands at 78% of the width and 29% from the top; portrait puts it at 79% and 38%.
  const land = {
    fov: 19,
    from: new THREE.Vector3(-2.85, 9.5, 20.0), to: new THREE.Vector3(-2.85, 14.5, 20.0),
    look: new THREE.Vector3(-2.85, 4.2, 0.0), lookTo: new THREE.Vector3(-2.85, 8.8, 0.0),
  };
  const port = {
    fov: 44,
    from: new THREE.Vector3(-1.98, 8.6, 20.0), to: new THREE.Vector3(-1.98, 13.6, 20.0),
    look: new THREE.Vector3(-1.98, 4.2, 0.0), lookTo: new THREE.Vector3(-1.98, 8.4, 0.0),
  };
  let rig = land;
  const aim = new THREE.Vector3();
  const pointer = { x: 0, y: 0 };
  let progress = 0, ghostAlt = 0, ghostBoost = 0;
  let dirty = true, visible = true, alive = true;

  function layout() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    uniforms.uResolution.value.set(renderer.domElement.width, renderer.domElement.height);
    camera.aspect = w / h;
    rig = camera.aspect < 1 ? port : land;
    camera.fov = rig.fov;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  const ro = new ResizeObserver(layout);
  ro.observe(canvas);
  layout();

  function draw() {
    // the camera is the same number as everything else: linear in altitude, and it stops when it stops
    const cp = progress;
    const settle = 1 - Math.max(0, Math.min(1, (progress - 0.86) / 0.14));   // parallax fades out at the summit
    camera.position.set(
      rig.from.x + (rig.to.x - rig.from.x) * cp + pointer.x * 0.35 * settle,
      rig.from.y + (rig.to.y - rig.from.y) * cp + pointer.y * 0.22 * settle,
      rig.from.z + (rig.to.z - rig.from.z) * cp,
    );
    aim.lerpVectors(rig.look, rig.lookTo, cp);
    camera.lookAt(aim);
    uniforms.uCam.value.copy(camera.position);
    renderer.render(scene, camera);
    dirty = false;
  }
  function frame() {
    if (!alive) return;
    if (dirty && visible) draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const io = new IntersectionObserver((e) => { visible = e[0].isIntersecting; if (visible) dirty = true; }, { threshold: 0 });
  io.observe(canvas);
  const onVis = () => { visible = !document.hidden; if (visible) dirty = true; };
  document.addEventListener('visibilitychange', onVis);
  const onLost = (e) => { e.preventDefault(); alive = false; };
  canvas.addEventListener('webglcontextlost', onLost);

  draw();
  if (onReady) onReady();

  return {
    dem, ringCap,
    // one number drives the reveal, the red ring and its weight
    setAltitude(m) {
      uniforms.uReveal.value = (m / 1000) * EXAG;
      uniforms.uRedH.value = (Math.min(m, ringCap) / 1000) * EXAG;
      ghostAlt = 0.17 + 0.13 * Math.max(0, Math.min(1, (m - 2200) / 1600));   // the unsurveyed sheet is never fully dark
      uniforms.uGhost.value = Math.min(0.75, ghostAlt + ghostBoost);
      const t = Math.max(0, Math.min(1, (m - 8000) / 848.86));   // the ring thickens over the last 848 m
      uniforms.uRedW.value = 1.0 + 1.1 * t;
      uniforms.uRedA.value = 0.72 + 0.28 * t;
      dirty = true;
    },
    setProgress(p) { progress = Math.max(0, Math.min(1, p)); dirty = true; },
    setMask(l, r) { uniforms.uMaskL.value = l; uniforms.uMaskR.value = r; dirty = true; },
    setInk(a) { uniforms.uAlpha.value = a; dirty = true; },
    // at a break moment the unsurveyed ground comes up too, so the sheet fills the screen
    setGhostBoost(b) { ghostBoost = b; uniforms.uGhost.value = Math.min(0.75, ghostAlt + b); dirty = true; },
    setPointer(x, y) { pointer.x = x; pointer.y = y; dirty = true; },
    summitM: dem.max * 1000,
    // normalised screen position of the summit, so a mono spot height can be pinned to the peak
    projectSummit() {
      camera.updateMatrixWorld();
      _p.copy(summitWorld).project(camera);
      return { x: _p.x * 0.5 + 0.5, y: -_p.y * 0.5 + 0.5 };
    },
    // the hero owns its own camera: numbers in, no taste in the module
    setRig(next) {
      const v = (a) => new THREE.Vector3(a[0], a[1], a[2]);
      if (next.land) Object.assign(land, { fov: next.land.fov ?? land.fov, from: v(next.land.from), to: v(next.land.to), look: v(next.land.look), lookTo: v(next.land.lookTo) });
      if (next.port) Object.assign(port, { fov: next.port.fov ?? port.fov, from: v(next.port.from), to: v(next.port.to), look: v(next.port.look), lookTo: v(next.port.lookTo) });
      rig = camera.aspect < 1 ? port : land;
      camera.fov = rig.fov; camera.updateProjectionMatrix(); dirty = true;
    },
    tune(k, v) { if (uniforms[k]) { uniforms[k].value = v; dirty = true; } },
    destroy() {
      alive = false; ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onLost);
      geo.dispose(); mat.dispose(); renderer.dispose();
    },
  };
}

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); } catch { return false; }
}
