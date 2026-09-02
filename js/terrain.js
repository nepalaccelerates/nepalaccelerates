// Sagarmatha massif as survey contours. Real SRTM heights (assets/dem), drawn with a contour shader.
// Exposes: initTerrain({ canvas, mobile, onReady }) -> { setAltitude(m), setPointer(x, y), setProgress(p), destroy() }
import * as THREE from 'three';

const EXTENT_KM = 34.56;                 // the grid covers a 34.56 km square, row 0 = north, col 0 = west
const EXAG = 1.2;                        // vertical exaggeration; survey sheets do the same for relief
const BG = new THREE.Color('#060606');
const CREAM = new THREE.Color('#ede8de');
const RED = new THREE.Color('#e8402a');

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

const FRAG = `
  precision highp float;
  varying float vH;
  varying vec3 vPos;
  uniform float uInterval;
  uniform float uWeight;
  uniform float uReveal;
  uniform float uFogNear, uFogFar;
  uniform vec3 uLine, uRed, uBg, uCam;
  void main() {
    float c = vH / uInterval;
    float fw = max(fwidth(c), 1e-4);
    float d = abs(fract(c - 0.5) - 0.5) / fw;
    float idx = mod(floor(c + 0.5), 5.0);
    float w = idx < 0.5 ? uWeight * 1.7 : uWeight;
    float a = 1.0 - smoothstep(w - 0.6, w + 0.6, d);
    float below = smoothstep(uReveal + 0.05, uReveal - 0.05, vH);
    float strength = mix(0.42, 1.0, below);
    a *= strength * (idx < 0.5 ? 1.0 : 0.62);
    float dr = abs(vH - uReveal) / max(fwidth(vH), 1e-4);
    float r = 1.0 - smoothstep(uWeight * 1.6, uWeight * 1.6 + 1.2, dr);
    vec3 col = mix(uBg, uLine, a);
    col = mix(col, uRed, r);
    float dist = distance(vPos, uCam);
    float fog = smoothstep(uFogNear, uFogFar, dist);
    col = mix(col, uBg, fog);
    gl_FragColor = vec4(col, 1.0);
  }`;

export async function initTerrain({ canvas, mobile = false, onReady } = {}) {
  const gridUrl = new URL(mobile ? '../assets/dem/sagarmatha-128.webp' : '../assets/dem/sagarmatha-256.webp', import.meta.url).href;
  const dem = await loadHeights(gridUrl);
  const S = dem.size;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.setClearColor(BG, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 200);

  const geo = new THREE.PlaneGeometry(EXTENT_KM, EXTENT_KM, S - 1, S - 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, dem.h[i] * EXAG);
  pos.needsUpdate = true;
  geo.computeBoundingSphere();

  const lineCol = CREAM.clone().lerp(BG, 0.28);
  const uniforms = {
    uInterval: { value: (mobile ? 0.3 : 0.2) * EXAG },
    uWeight: { value: renderer.getPixelRatio() >= 2 ? 0.6 : 0.5 },
    uReveal: { value: 1.4 * EXAG },
    uFogNear: { value: 16 }, uFogFar: { value: 40 },
    uLine: { value: lineCol }, uRed: { value: RED }, uBg: { value: BG }, uCam: { value: new THREE.Vector3() },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, depthWrite: true, depthTest: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  scene.add(mesh);

  // from the south-west over the Khumbu, 20 degrees up: the summit pyramid sits on the right third at 16:9, centred on a phone
  const base = mobile ? new THREE.Vector3(-13, 9.2, 9) : new THREE.Vector3(-12, 11, 6);
  const target = mobile ? new THREE.Vector3(0.3, 9.9, 0) : new THREE.Vector3(-2.5, 9.2, 0);
  const pointer = { x: 0, y: 0 };
  let progress = 0;
  let dirty = true, visible = true, alive = true;

  function layout() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  const ro = new ResizeObserver(layout);
  ro.observe(canvas);
  layout();

  function draw() {
    const lift = progress * 0.9;                                       // a slow dolly toward the summit as the reader climbs
    camera.position.set(base.x + pointer.x * 0.8 + progress * 1.2, base.y + lift + pointer.y * 0.4, base.z - progress * 1.4);
    camera.lookAt(target.x + progress * 0.8, target.y + progress * 0.5, target.z);
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

  draw();
  if (onReady) onReady();

  return {
    dem,
    setAltitude(m) { uniforms.uReveal.value = (Math.min(m, 8700) / 1000) * EXAG; dirty = true; },   // the mesh tops at 8,719; the ring closes on the peak while the readout says 8,848.86
    setProgress(p) { progress = Math.max(0, Math.min(1, p)); dirty = true; },
    setPointer(x, y) { pointer.x = x; pointer.y = y; dirty = true; },
    setCamera(px, py, pz, tx, ty, tz) { base.set(px, py, pz); target.set(tx, ty, tz); dirty = true; },
    setFog(near, far) { uniforms.uFogNear.value = near; uniforms.uFogFar.value = far; dirty = true; },
    destroy() { alive = false; ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVis); geo.dispose(); mat.dispose(); renderer.dispose(); },
  };
}

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}
