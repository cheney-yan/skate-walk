import * as THREE from 'three';
import { loadGirl, setupHair, Skirt, Hat, OUTFIT, addWristGuards, flutterUpdate } from './girl.js';
import { Rider, EMAX } from './rider.js';
import { envU, roadMaterial, roadEdges, roadDecals, groundAttr, groundMaterial, buildTrees, corridorGround, buildKerb, buildShelf } from './env.js';
import { buildBuildings } from './buildings.js';
import { buildStreets } from './streets.js';

const Q = new URLSearchParams(location.search);
const REC = Q.has('rec');
// ?route=bondi -> ride the real Bondi -> Bronte coastal walk (OSM path + AWS terrain + OSM building blocks)
const RD = Q.get('route') ? await (await fetch('./data/route.json')).json() : null;
// baked environment (tools/env.py): ground classes, tree/shrub instances, road symbols & stains
const ENV = RD ? await (await fetch('./data/env.json')).json() : null;
/* all building footprints (tools/buildings.py: OSM + Microsoft ML footprints, merged blocks); ?bld=old -> the 218 route.json polys */
const BLDD = RD && Q.get('bld') !== 'old' ? await fetch('./data/buildings.json').then((r) => r.ok ? r.json() : null).catch(() => null) : null;
/* OSM streets / car parks / footpaths draped on the ground (tools/streets.py -> data/streets.json, js/streets.js); ?streets=0 hides them */
const STRD = RD && Q.get('streets') !== '0' ? await fetch('./data/streets.json').then((r) => r.ok ? r.json() : null).catch(() => null) : null;
if (REC) document.body.classList.add('rec');
const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const damp1 = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------- test track ----------------
// [length, kappa, grade, label, wind: null | 'left' | 'right' | 'front']
const SEG = [
  [18, 0, 0, '站直滑行'], [10, 0.34, 0, '压弯转向'], [10, -0.34, 0, '压弯转向'], [10, 0.34, 0, '压弯转向'], [6, 0, 0, ''],
  [20, 0, 0, '前面有坑'], [40, 0.015, -0.07, '下坡'], [12, 0, 0, ''], [32, 0, 0.06, '上坡'],
  [24, 0, 0, '左边来风', 'left'], [24, 0, 0, '右边来风', 'right'], [24, 0, 0, '迎面来风', 'front'], [33, -0.02, 0, '回头看你一眼'],
  [14, 0, 0, ''], [22, 0, 0.14, '陡坡（>6°）下来走'], [16, 0, 0, '坡顶，上板'], [30, 0, -0.06, '下坡，太快就飞板减速'], [30, 0, 0, '平路'],
];
const HOLES = RD ? [] : [60, 240];
const LOOKS = RD ? [] : [13, 226];
const DS = 0.25;
const track = RD ? routeTrack(RD) : (() => {
  const pts = []; let s = 0, x = 0, y = 0, z = 0, yaw = 0;
  const segAt = (s) => { let a = 0; for (const g of SEG) { if (s < a + g[0]) return { g, a }; a += g[0]; } return { g: SEG[SEG.length - 1], a: a - SEG[SEG.length - 1][0] }; };
  const total = SEG.reduce((a, g) => a + g[0], 0);
  // smoothed kappa/grade (4 m blend between segments)
  const raw = (s, k) => segAt(s).g[k];
  const smooth = (s, k) => { let acc = 0, n = 0; for (let d = -3; d <= 3; d += 0.5) { acc += raw(clamp(s + d, 0, total - 0.01), k); n++; } return acc / n; };
  while (s <= total + 20) {
    const kap = smooth(Math.min(s, total - 0.01), 1), gr = smooth(Math.min(s, total - 0.01), 2);
    pts.push({ s, x, y, z, yaw, kap, gr: smooth(Math.min(s, total - 0.01), 2) });
    yaw += kap * DS; x += Math.sin(yaw) * DS; z += Math.cos(yaw) * DS; y += gr * DS; s += DS;
  }
  const at = (s) => {
    const f = clamp(s / DS, 0, pts.length - 2), i = Math.floor(f), u = f - i, a = pts[i], b = pts[i + 1];
    const yaw = a.yaw + (b.yaw - a.yaw) * u;
    return { p: new THREE.Vector3(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u), dir: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), yaw, grade: a.gr + (b.gr - a.gr) * u, kappa: a.kap + (b.kap - a.kap) * u };
  };
  return { pts, at, total, segAt };
})();
// ---------------- real route -> uniform track (same shape as the test track) ----------------
function terrainFn(T) {
  return (x, y) => {
    const fi = (x - T.x0) / T.step, fj = (y - T.y0) / T.step;
    const i = Math.max(0, Math.min(T.nx - 2, Math.floor(fi))), j = Math.max(0, Math.min(T.ny - 2, Math.floor(fj)));
    const u = Math.min(1, Math.max(0, fi - i)), v = Math.min(1, Math.max(0, fj - j));
    const g = (ii, jj) => Math.max(-4, T.h[jj * T.nx + ii] / 10);
    return g(i, j) * (1 - u) * (1 - v) + g(i + 1, j) * u * (1 - v) + g(i, j + 1) * (1 - u) * v + g(i + 1, j + 1) * u * v;
  };
}
function routeTrack(R) {
  const P = R.pts, L = R.length, tH = terrainFn(R.terrain);
  const lin = (s) => { let k = 0; while (k < P.length - 2 && P[k + 1].s < s) k++; const a = P[k], b = P[k + 1], u = b.s > a.s ? clamp((s - a.s) / (b.s - a.s), 0, 1) : 0; return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, e: a.e + (b.e - a.e) * u }; };
  // dense 0.5 m polyline in three coords (X = east, Z = -north), height = path or ground, whichever is higher
  let D = []; for (let s = 0; s <= L; s += 0.5) { const q = lin(s); D.push({ X: q.x, Z: -q.y, Y: Math.max(q.e, tH(q.x, q.y)) + 0.08 }); }
  const blur = (arr, key, r, passes) => { for (let p = 0; p < passes; p++) { const src = arr.map((o) => o[key]); for (let i = 0; i < arr.length; i++) { let a = 0, n = 0; for (let j = Math.max(0, i - r); j <= Math.min(arr.length - 1, i + r); j++) { a += src[j]; n++; } arr[i][key] = a / n; } } };
  blur(D, 'X', 8, 3); blur(D, 'Z', 8, 3); blur(D, 'Y', 16, 3);          // round off polyline corners (a board can't turn on a point)
  const cum = [0]; for (let i = 1; i < D.length; i++) cum.push(cum[i - 1] + Math.hypot(D[i].X - D[i - 1].X, D[i].Z - D[i - 1].Z));
  const total = cum[cum.length - 1], pts = []; let k = 0;
  for (let s = 0; s <= total; s += DS) {
    while (k < D.length - 2 && cum[k + 1] < s) k++;
    const u = (s - cum[k]) / ((cum[k + 1] - cum[k]) || 1), a = D[k], b = D[k + 1];
    pts.push({ s, x: a.X + (b.X - a.X) * u, y: a.Y + (b.Y - a.Y) * u, z: a.Z + (b.Z - a.Z) * u });
  }
  for (let i = 0; i < pts.length; i++) { const a = pts[Math.max(0, i - 4)], b = pts[Math.min(pts.length - 1, i + 4)]; pts[i].yaw = Math.atan2(b.x - a.x, b.z - a.z); }
  for (let i = 1; i < pts.length; i++) { let d = pts[i].yaw - pts[i - 1].yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; pts[i].yaw = pts[i - 1].yaw + d; }
  for (let i = 0; i < pts.length; i++) { const a = pts[Math.max(0, i - 8)], b = pts[Math.min(pts.length - 1, i + 8)], ds = b.s - a.s || 1; pts[i].kap = clamp((b.yaw - a.yaw) / ds, -0.35, 0.35); pts[i].gr = clamp((b.y - a.y) / ds, -0.2, 0.2); }   // real grade (steps/ramps > 6° make her walk)
  // place names along the way (for the caption)
  const names = []; let cur = 'Bondi'; for (const q of P) { if (q.name) cur = q.name; names.push([q.s, cur]); }
  const nameAt = (s) => { let n = 'Bondi'; for (const [a, m] of names) { if (a > s * (L / total)) break; n = m; } return n; };
  const at = (s) => {
    const f = clamp(s / DS, 0, pts.length - 2), i = Math.floor(f), u = f - i, a = pts[i], b = pts[i + 1];
    const yaw = a.yaw + (b.yaw - a.yaw) * u;
    return { p: new THREE.Vector3(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u), dir: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), yaw, grade: a.gr + (b.gr - a.gr) * u, kappa: a.kap + (b.kap - a.kap) * u };
  };
  const segAt = (s) => ({ g: [0, at(s).kappa, at(s).grade, nameAt(s)], a: 0 });
  return { pts, at, total: Math.floor(total), segAt, terrainH: tH };
}
let SHORE = null; const BLD = [];
if (RD && RD.shore) {
  // sea mask + distance-to-shore, baked offline from the OSM coastline (tools/shore.py): 0 = land, else metres*4
  const T = RD.terrain, raw = atob(RD.shore.b64), N = raw.length, tex = new Uint8Array(N);
  for (let k = 0; k < N; k++) tex[k] = raw.charCodeAt(k);
  T.hSea = T.h.map((v, k) => tex[k] ? Math.min(v, -10 - Math.min(tex[k] / 4, 60) * 2.5) : v);   // seabed shelves down (decimetres)
  const st = new THREE.DataTexture(tex, T.nx, T.ny, THREE.RedFormat, THREE.UnsignedByteType); st.minFilter = st.magFilter = THREE.LinearFilter; st.needsUpdate = true;
  SHORE = { tex: st, x0: T.x0, y0: T.y0, w: (T.nx - 1) * T.step, h: (T.ny - 1) * T.step };
  window.__coast = { sea: tex.reduce((a, b) => a + (b ? 1 : 0), 0) };
}
// height of ground anywhere: nearest track point's height (road + verge)
function groundY(x, z) {
  let best = 1e9, y = 0;
  for (let i = 0; i < track.pts.length; i += 8) { const p = track.pts[i], d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < best) { best = d; y = p.y; } }
  return y;
}

// ---------------- scene ----------------
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, preserveDrawingBuffer: REC });
renderer.setPixelRatio(REC ? 1 : Math.min(2, devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.fog = RD ? new THREE.Fog('#d6ebf5', 650, 2600) : new THREE.Fog('#d6ebf5', 40, 260);
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, RD ? 3200 : 1500);
const hemi = new THREE.HemisphereLight('#eef6ff', '#d8c49a', 1.4); scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffe9c8', 2.5);
let TOD = Q.get('tod') || 'real';
// ---- NATURE (Cheney): real sun for the route's place + the current time, real wind from the local weather.
// Sun: NOAA-style solar position from lat/lon + clock. Wind/cloud: Open-Meteo current weather (free, no key).
// Wind moves hair/cloth/body sway only (not her speed, Cheney); cloud softens the sun.
const NAT = { lat: -33.8915, lon: 151.2767, wind: null, cloud: 0.2, src: '默认', t: null };
function solarPos(date, lat, lon) { const rad = Math.PI / 180, d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * rad, q = 280.459 + 0.98564736 * d, L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad, e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24, ha = ((gmst * 15 + lon) * rad - ra), la = lat * rad;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));   // from north, clockwise
  return { el, az }; }
async function loadWeather() { try {
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${NAT.lat}&longitude=${NAT.lon}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,temperature_2m&wind_speed_unit=ms&timezone=Australia%2FSydney`);
  const c = (await r.json()).current; const to = (c.wind_direction_10m + 180) * Math.PI / 180, sp = c.wind_speed_10m * 0.55;   // 10 m wind -> ~1.5 m above ground
  NAT.wind = new THREE.Vector3(Math.sin(to) * sp, 0, -Math.cos(to) * sp); NAT.cloud = (c.cloud_cover ?? 20) / 100; NAT.raw = c; NAT.src = 'Open-Meteo ' + (c.time || ''); } catch (e) { NAT.src = '天气读取失败，用默认海风'; } }
if (!REC) loadWeather();
const rimLight = new THREE.DirectionalLight('#ffb978', 0); scene.add(rimLight, rimLight.target);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);   /* near cascade: her and the road around her, sharp */
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.5, far: 80 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
/* FAR cascade (Cheney: shadows only near her looked cut off): a second light that adds NO light of its own, it only darkens -
   implemented as a shadow-only directional light (ShadowMaterial ground pass is too costly), so: a weak copy of the sun whose
   shadow covers the whole visible area around the camera; its light intensity is taken out of the main sun so the total stays. */
const sunFar = new THREE.DirectionalLight('#ffffff', 0); sunFar.castShadow = true; sunFar.shadow.mapSize.set(2048, 2048);
Object.assign(sunFar.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 1, far: 500 }); sunFar.shadow.bias = -0.0012; sunFar.shadow.normalBias = 0.25;
scene.add(sunFar, sunFar.target);
/* HEADLAMP (night): a spot from her head along the path; range tunable in the 光影 tab */

scene.add(sun, sun.target);
// sky
{
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uWarm: { value: 0 }, uSun: { value: new THREE.Vector3(0, 0.2, 1) }, uNight: { value: 0 }, uMoon: { value: new THREE.Vector3(0, 0.5, 1) }, uMoonA: { value: 0 } },
    vertexShader: 'varying vec3 p;void main(){p=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `uniform float uWarm; uniform vec3 uSun; uniform float uNight; uniform vec3 uMoon; uniform float uMoonA; varying vec3 p;float h(vec2 q){return fract(sin(dot(q,vec2(127.1,311.7)))*43758.5);}
    float n(vec2 q){vec2 i=floor(q),f=fract(q);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
    float fbm(vec2 q){float s=0.,a=.5;for(int k=0;k<5;k++){s+=a*n(q);q*=2.03;a*=.5;}return s;}
    void main(){float y=max(p.y,0.);vec3 c=mix(vec3(.85,.93,.97),vec3(.33,.6,.88),pow(y,.5));
    vec3 warmHor=vec3(1.,.78,.55),warmTop=vec3(.45,.62,.86);vec3 cw=mix(warmHor,warmTop,pow(y,.6));float sd=max(dot(normalize(p),normalize(uSun)),0.);cw+=vec3(1.,.75,.45)*pow(sd,24.)*.9+vec3(1.,.6,.3)*pow(sd,4.)*.25;c=mix(c,cw,uWarm);
    vec2 q=p.xz/(p.y+.15)*1.3;float cl=smoothstep(.5,.78,fbm(q+2.));vec3 cc=mix(vec3(1.),vec3(1.,.86,.72),uWarm);c=mix(c,cc,cl*smoothstep(.03,.2,p.y)*.95);vec3 nc=mix(vec3(.06,.10,.22),vec3(.01,.02,.07),pow(y,.45));vec2 sq=floor(p.xz/(p.y+.02)*180.);float st=step(.9975,h(sq))*smoothstep(.05,.3,p.y)*(1.-cl*.9);nc+=vec3(.85,.9,1.)*st*.9;float md=dot(normalize(p),normalize(uMoon));nc+=vec3(.75,.82,1.)*(smoothstep(.9994,.9997,md)*1.2+pow(max(md,0.),60.)*.18)*uMoonA;nc=mix(nc,vec3(.12,.15,.24),cl*smoothstep(.03,.2,p.y)*.6);c=mix(c,nc,uNight);gl_FragColor=vec4(c,1.);}` });
  window.__sky = m; const skyM = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), m); skyM.onBeforeRender = (r, s, cam) => { skyM.position.copy(cam.position); skyM.updateMatrixWorld(); }; skyM.frustumCulled = false; scene.add(skyM);   // follows the camera (route is 1.4 km from origin)
}
// road + verge ribbons
function ribbon(w0, w1, yOff, color, rough = 0.9) {
  const v = [], uv = [], idx = [];
  track.pts.forEach((p, k) => {
    // never wider than the local turn radius on the inside (avoids folded ground on tight curves)
    let kmax = 0; for (let j = Math.max(0, k - 120); j < Math.min(track.pts.length, k + 120); j++) kmax = Math.max(kmax, Math.abs(track.pts[j].kap));
    const lim = kmax > 1e-3 ? 0.85 / kmax : 1e9; const cw = (w) => Math.sign(w) * Math.min(Math.abs(w), Math.max(1.7, lim));
    const W0 = cw(w0), W1 = cw(w1);
    const lx = Math.cos(p.yaw), lz = -Math.sin(p.yaw);  // left = (cos, -sin)?? (dir=(sin,cos)) left=(cos,0,-sin)
    v.push(p.x + lx * W0, p.y + yOff, p.z + lz * W0, p.x + lx * W1, p.y + yOff, p.z + lz * W1);
    uv.push(0, p.s / 2, 1, p.s / 2);
    if (k) { const a = 2 * k - 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: rough, side: THREE.DoubleSide }));
  m.receiveShadow = true; scene.add(m); return m;
}
// concrete path texture
const pathTex = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#d9d4ca'; g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '90,85,80' : '255,255,250'},${Math.random() * .08})`; g.fillRect(Math.random() * 256, Math.random() * 512, 2, 2); }
  g.strokeStyle = 'rgba(120,112,100,.35)'; g.lineWidth = 2; for (let y = 0; y < 512; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
})();
{ const r = ribbon(-1.6, 1.6, 0.0, '#ffffff', 0.85);
  if (ENV) { r.material = roadMaterial(3.2); const e = roadEdges(track, 1.6); scene.add(e); const d = roadDecals(track, ENV.decals); scene.add(d); window.__decals = ENV.decals.length; }
  else { r.material.map = pathTex; r.material.needsUpdate = true; } }
if (!RD) { ribbon(1.6, 40, -0.03, '#93bd6c'); ribbon(-1.6, -12, -0.03, '#e8d6a6'); }  // test-track verges      // sand on the right
const seaU = { uT: { value: 0 }, uSun: { value: new THREE.Vector3(0.8, 0.25, 0.2).normalize() }, uSunCol: { value: new THREE.Color('#ffd8a8') }, uSky: { value: new THREE.Color('#bcd9ee') },
  uShore: { value: SHORE?.tex || null }, uSB: { value: new THREE.Vector4(SHORE?.x0 || 0, SHORE?.y0 || 0, SHORE?.w || 1, SHORE?.h || 1) }, uFog: { value: new THREE.Color('#d6ebf5') }, uNight: { value: 0 }, uLamp: { value: new THREE.Vector4(0, 0, 0, 0) } };
if (RD) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000, 1, 1), new THREE.ShaderMaterial({ uniforms: seaU, transparent: false,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uT; uniform vec3 uSun, uSunCol, uSky, uFog; uniform sampler2D uShore; uniform vec4 uSB; uniform float uNight; uniform vec4 uLamp; varying vec3 vW;
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+1.), f.x), f.y); }
    // sum of directional swells -> height gradient (normal); a few scales so it holds up near and far
    vec2 grad(vec2 p, float t){ vec2 g = vec2(0.);
      vec2 D[6]; D[0]=normalize(vec2(-1.,.15)); D[1]=normalize(vec2(-1.,-.35)); D[2]=normalize(vec2(-.6,.8)); D[3]=normalize(vec2(-1.,.6)); D[4]=normalize(vec2(.3,1.)); D[5]=normalize(vec2(-.8,-.9));
      float L[6]; L[0]=38.; L[1]=21.; L[2]=9.; L[3]=5.3; L[4]=2.7; L[5]=1.6;
      for (int i = 0; i < 6; i++) { float k = 6.2831/L[i], a = L[i]*0.012, w = sqrt(9.8*k); g += D[i] * a * k * cos(dot(D[i], p) * k - w * t + float(i)*1.7); }
      return g; }
    void main(){
      vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;
      float fade = clamp(1. - dist / 900., 0.15, 1.);                     // calm the small ripples far away (no aliasing)
      vec2 g = grad(vW.xz, uT) * vec2(1.) ; g *= mix(0.35, 1., fade);
      vec3 N = normalize(vec3(-g.x, 1., -g.y));
      float sw = sin(dot(vW.xz, normalize(vec2(-1., .15))) * 0.165 - uT * 1.27) * 0.5 + sin(dot(vW.xz, normalize(vec2(-1., -.35))) * 0.3 - uT * 1.7) * 0.5;
      // shore distance (metres) from the baked field
      vec2 uv = vec2((vW.x - uSB.x) / uSB.z, ((-vW.z) - uSB.y) / uSB.w);
      float inB = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
      float sd = mix(80., texture2D(uShore, uv).r * 255. / 4., inB); if (inB > 0.5 && texture2D(uShore, uv).r < 0.002) sd = 0.;
      // water colour: turquoise over the sand shelf, deep blue offshore
      vec3 deep = vec3(0.004, 0.022, 0.045), mid = vec3(0.012, 0.06, 0.09), shallow = vec3(0.07, 0.30, 0.32);   /* LINEAR values (the shader converts to sRGB): sRGB ~ #0b2a3d deep navy, as in the aerial */   /* Sydney ocean in the aerial: deep navy offshore, turquoise only over the sand shelf */
      vec3 col = mix(shallow, mid, smoothstep(1.5, 14., sd)); col = mix(col, deep, smoothstep(14., 45., sd));
      col *= 0.9 + 0.12 * sw;
      col = mix(col, col * vec3(0.10, 0.13, 0.22), uNight);   /* night: the water itself goes ink-blue/black */
      // fresnel sky reflection
      float fr = 0.02 + 0.98 * pow(1. - max(dot(N, V), 0.), 5.);
      col = mix(col, mix(uSky, vec3(0.42, 0.62, 0.80), 0.55), clamp(fr, 0., 0.55) * smoothstep(-0.2, 0.6, V.y < 0.5 ? 0.0 : V.y) * 0. + clamp(fr, 0., 0.55) * (1. - smoothstep(0.55, 0.95, V.y)));   /* looking straight down (aerial) the sky reflection fades -> the water's own deep colour */
      // sun: broad sheen + tight glints = the glittering path toward the sun
      vec3 H = normalize(uSun + V); float nh = max(dot(N, H), 0.);
      col += uSunCol * (pow(nh, 80.) * 0.18 + pow(nh, 1400.) * 4.);
      // sun path: the band of water whose mirror direction is near the sun (wide at the horizon), broken into sparkles
      vec3 Rf = reflect(-V, vec3(0., 1., 0.)); float rs = max(dot(normalize(Rf), uSun), 0.);
      float path = pow(rs, 18.) * 0.9 + pow(rs, 120.) * 1.6;
      float tw = vn(vW.xz * vec2(0.9, 2.6) + uT * vec2(1.3, -0.8)) * vn(vW.xz * vec2(3.1, 1.2) - uT * vec2(0.6, 1.7)) * vn(vW.xz * 6.0 + uT * 2.2);
      col += uSunCol * path * smoothstep(0.12, 0.42, tw) * 3.2 + uSunCol * path * 0.12;
      float sp = vn(vW.xz * 1.9 + uT * vec2(0.7, -0.4)) * vn(vW.xz * 3.7 - uT * vec2(0.5, 0.9));
      col += uSunCol * smoothstep(0.55, 0.75, sp) * pow(nh, 140.) * 9.;      // twinkles
      // surf: 2-3 broken crests rolling in (bright leading edge + fading lace behind), then the wash on the sand
      float n = vn(vW.xz * 0.06 + vec2(uT * 0.03, 0.)), n2 = vn(vW.xz * 0.55 + uT * 0.25), n3 = vn(vW.xz * 2.3 - uT * 0.4);
      float band = 0.;
      for (int i = 0; i < 3; i++) {                                              // three sets of breakers, out of step
        float fi = float(i);
        float ph = fract((sd + n * 9. + fi * 3.7 + vn(vW.xz * 0.2 + fi * 7.) * 4.) / 12. + uT * (0.10 + fi * 0.013) + fi * 0.31);
        float crest = smoothstep(0.80, 0.92, ph) * (1. - smoothstep(0.92, 1., ph));
        float lace = smoothstep(0.92, 0.55, ph) * step(ph, 0.92) * 0.6 * smoothstep(0.35, 0.7, n3 + 0.15 * fi);
        float along = smoothstep(0.2, 0.6, vn(vW.xz * 0.5 + fi * 13. + uT * 0.2));
        band = max(band, (crest + lace) * along);
      }
      band *= smoothstep(34., 12., sd) * smoothstep(0.3, 3., sd);
      float wash = smoothstep(3.5, 0.4, sd + (sin(uT * 0.8 + n * 7.) * 0.5 + 0.5) * 2.2) * (0.55 + 0.45 * n3);
      float foam = clamp(band + wash, 0., 1.);
      col = mix(col, mix(vec3(0.97, 0.98, 1.), vec3(0.30, 0.36, 0.50), uNight), foam * fade);   /* foam at night: faint blue-grey, not white */
      { float ld = length(vW.xz - uLamp.xy); col += vec3(1., .93, .8) * uLamp.w * 0.25 * smoothstep(uLamp.z, uLamp.z * 0.2, ld) * (0.4 + 0.6 * foam); }   /* headlamp spill on nearby water */
      // distance haze
      col = mix(col, uFog, smoothstep(900., 3000., dist) * 0.55);
      gl_FragColor = vec4(col, 1.);
      #include <colorspace_fragment>
    }` }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.0; scene.add(m); window.__sea = m;
}
if (!RD) { // sea
  const m = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: RD ? '#2f9fc4' : '#3f9fc2', roughness: 0.18, metalness: 0.15, fog: !RD }));
  m.rotation.x = -Math.PI / 2; m.position.y = RD ? 0.9 : -6; scene.add(m);
}
// trees + flags along the left verge
const flags = [];
{
  const trunk = new THREE.MeshStandardMaterial({ color: '#8a6a4a' }), leaf = new THREE.MeshStandardMaterial({ color: '#6fa25a', roughness: 1 });
  for (let s = 6; !RD && s < track.total; s += 9 + (s * 7 % 5)) {
    const p = track.at(s), l = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw)), off = 4 + (s * 13 % 7);
    const t = new THREE.Group(); t.position.copy(p.p).addScaledVector(l, off);
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 2.2, 8), trunk); tr.position.y = 1.1; t.add(tr);
    for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 - k * 0.15, 1), leaf); b.position.set((k - 1) * 0.5, 2.6 + k * 0.4, (k % 2) * 0.4); t.add(b); }
    t.traverse((o) => { if (o.isMesh) { o.castShadow = true; } }); scene.add(t);
  }
  // little pennant flags on poles at the wind segments (show wind direction)
  const pole = new THREE.MeshStandardMaterial({ color: '#f4f4f4' });
  for (const s of RD ? [] : [150, 162, 174, 186, 198, 210, 222]) {
    const p = track.at(s), l = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const g = new THREE.Group(); g.position.copy(p.p).addScaledVector(l, 2.3);
    const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.4, 6), pole); pl.position.y = 1.2; g.add(pl);
    const fgeo = new THREE.PlaneGeometry(0.7, 0.35, 8, 1); fgeo.translate(0.35, 0, 0);
    const f = new THREE.Mesh(fgeo, new THREE.MeshStandardMaterial({ color: '#ff8a5c', side: THREE.DoubleSide })); f.position.y = 2.2; g.add(f);
    scene.add(g); flags.push({ f, base: fgeo.attributes.position.array.slice() });
  }
}
// ---------------- real-world blocks (Apple-Maps style): terrain, OSM building footprints as clean extruded boxes ----------------
if (RD) {
  const T = RD.terrain, tH = terrainFn({ ...T, h: T.hSea || T.h });
  // coarse 8 m terrain = raw heights; the cells near the road are cut out and drawn as a baked 1 m corridor lattice
  // (env.py 'ground mesh height': ground never above the road, cut banks + stone kerb, embankment so the road sits on land)
  const rawH = (i, j) => { const g = Math.max(-4, (T.hSea || T.h)[j * T.nx + i] / 10); return g < 1.3 ? g - 2.5 : g; };
  const geo = new THREE.PlaneGeometry((T.nx - 1) * T.step, (T.ny - 1) * T.step, T.nx - 1, T.ny - 1); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 4);
  const cx = T.x0 + (T.nx - 1) * T.step / 2, cy = T.y0 + (T.ny - 1) * T.step / 2;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k) + cx, y = -pos.getZ(k) + cy, i = k % T.nx, j = T.ny - 1 - Math.floor(k / T.nx);
    pos.setXYZ(k, x, ENV?.corridor ? rawH(i, j) : (() => { let h = tH(x, y); return h < 1.3 ? h - 2.5 : h; })(), -y);
    col.set(groundAttr(ENV, T, x, y), k * 4);   // baked sand / rock / dirt / green weights
  }
  geo.setAttribute('aCls', new THREE.BufferAttribute(col, 4)); geo.computeVertexNormals();
  const gMat = groundMaterial(), grounds = []; let cor = null;
  if (ENV?.corridor) {
    cor = corridorGround(ENV, T, rawH, gMat); const src = geo.index.array, keep = [];
    for (let iy = 0; iy < T.ny - 1; iy++) for (let ix = 0; ix < T.nx - 1; ix++) { if (cor.skip.has((T.ny - 2 - iy) * (T.nx - 1) + ix)) continue;
      const o = 6 * (iy * (T.nx - 1) + ix); for (let q = 0; q < 6; q++) keep.push(src[o + q]); }
    geo.setIndex(keep); scene.add(cor.mesh); grounds.push(cor.mesh);
    window.__kerb = buildKerb(scene, ENV);
  }
  const ground = new THREE.Mesh(geo, gMat); ground.receiveShadow = true; scene.add(ground); grounds.push(ground);
  window.__grounds = grounds;
  if (STRD) { try { window.__streets = buildStreets(scene, STRD, { T, rawH, cor }); } catch (e) { console.warn('streets', e); } }
  if (ENV?.shelf) window.__shelf = buildShelf(scene, ENV, T, gMat);   /* intertidal sandstone platforms above the water (env.py 'shelf') */
  const skirtG = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ color: '#bfd3a0', roughness: 1 }));   // land beyond the data edge
  skirtG.rotation.x = -Math.PI / 2; skirtG.position.y = -0.5; scene.add(skirtG);
  // buildings: soft off-white blocks, slightly lighter roofs, the way Apple Maps draws a city before photo-3D loads
  const side = new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.95 }), top = new THREE.MeshStandardMaterial({ color: '#fbfaf8', roughness: 0.9 });
  const sideAlt = new THREE.MeshStandardMaterial({ color: '#eef0f3', roughness: 0.95 });
  if (BLDD) { window.__bld = buildBuildings(scene, BLDD); BLD.gpu = window.__bld.U; }
  for (const b of BLDD ? [] : RD.buildings) {
    if (b.poly.length < 4) continue;
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(b.poly.map(([x, y]) => new THREE.Vector2(x, y))), { depth: Math.max(3, b.h), bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, [top, b.poly.length % 3 ? side : sideAlt]); m.position.y = b.base - 0.6; m.castShadow = m.receiveShadow = true; scene.add(m);
    g.computeBoundingSphere(); BLD.push({ m, c: g.boundingSphere.center.clone().add(m.position), r: g.boundingSphere.radius });
  }
}
if (RD) {   // baked Bondi trees: Norfolk Island pines, coastal gums, banksias, heath shrubs (instanced, tiled)
  window.__trees = buildTrees(scene, ENV);
}
// potholes (dark, slightly sunk) + a little cone so the eye reads them
for (const h of HOLES) {
  const p = track.at(h);
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshStandardMaterial({ color: '#5a554f', roughness: 1 }));
  m.rotation.x = -Math.PI / 2; m.scale.set(1.4, 0.9, 1); m.position.copy(p.p).add(new THREE.Vector3(0, 0.004, 0)); m.rotation.z = p.yaw; scene.add(m);
  const rim = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 24), new THREE.MeshStandardMaterial({ color: '#8d877d', roughness: 1 }));
  rim.rotation.x = -Math.PI / 2; rim.scale.set(1.4, 0.9, 1); rim.position.copy(m.position).add(new THREE.Vector3(0, 0.001, 0)); rim.rotation.z = p.yaw; scene.add(rim);
}
// wind particles (petals / streaks)
const PN = 260;
const petals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.035, 0.022), new THREE.MeshBasicMaterial({ color: '#fff4f6', side: THREE.DoubleSide, transparent: true, opacity: 0.9 }), PN);
const pdata = []; for (let i = 0; i < PN; i++) pdata.push({ p: new THREE.Vector3(1e5, 0, 0), r: Math.random() * 6, s: 0.5 + Math.random() });
scene.add(petals);

// ---------------- girl ----------------
let vrm, rider, skirt, skirt2 = null, hair, hat;
const ctx = { holes: HOLES, cruise: 6.4, vmax: 8.3, vFloor: 20 / 3.6, wind: new THREE.Vector3(), lookEvery: RD ? undefined : 999, camera };
async function init() {
  const M = { shino: './models/shino.vrm', sample: './models/girl.vrm', a: './models/cand/AvatarSample_A.vrm', b: './models/sample_b.vrm', vita: './models/cand/Vita.vrm', vic: './models/cand/Victoria_Rubin.vrm' };
  vrm = await loadGirl(M[Q.get('m') || (OUTFIT === 'breeze' || OUTFIT === 'native' ? 'b' : 'shino')] || M.shino);
  scene.add(vrm.scene);                 // temporarily at identity to build the skirt in model space
  vrm.scene.updateMatrixWorld(true);
  const SD = OUTFIT === 'sundress' || OUTFIT === 'shirt';   // reference look: knee-length floral sundress, no hat, hair fully free
  if (OUTFIT === 'breeze') {
    // shirt tails: light cotton (σ ≈ 0.11 kg/m²) with per-triangle drag/lift, sewn to the coat hem, open at the front
    skirt2 = new Skirt(vrm, scene, { style: 'shirt', pin: 'spine', open: 0.62, top: 1.03, hem: 0.74, rows: 14, cols: 40, flare: 0.3, maxSwing: 105, airGain: 1.0, soft: 0.25, bend: 0.15,
      aero: { cd: 1.0, cl: 0.55, rho: 1.2, sigma: 0.17, gust: 0.4, bulge: 0.2 }, extraCaps: (w, B, mid, hip, sp) => [[sp, mid.clone().lerp(hip, 0.4), 0.17]] });
    skirt2.mesh.material.color.set('#c4def6');
  }
  if (OUTFIT === 'shirt') {
    // the open shirt: tails sewn at the ribs, open at the front, flying free over a soft white pleated mini skirt (leggings underneath)
    skirt2 = new Skirt(vrm, scene, { style: 'shirt', pin: 'upperChest', open: 0.62, top: 1.2, hem: 0.66, rows: 16, cols: 34, flare: 0.22, maxSwing: 92, airGain: 1.3, soft: 0.45,
      extraCaps: (w, B, mid, hip, sp) => [[sp, mid.clone().lerp(hip, 0.4), 0.19]] });
  }
  skirt = new Skirt(vrm, scene, OUTFIT === 'shirt' ? { style: 'pleat', top: 0.93, hem: 0.69, rows: 9, cols: 44, flare: 0.95, maxSwing: 84, airGain: 1.1, soft: 0.35 } : SD ? { top: 0.985, hem: 0.5, rows: 14, cols: 40, flare: 0.75, maxSwing: 62, airGain: 0.9 } : { top: 0.985, hem: 0.27, rows: 18, cols: 36, flare: 0.5, maxSwing: 58, airGain: 0.75 });
  if (OUTFIT === 'native' || OUTFIT === 'breeze') skirt.mesh.visible = false;   // the model's own skirt (spring bones) is used instead
  hat = SD || OUTFIT === 'native' || OUTFIT === 'breeze' ? { step() {} } : new Hat(vrm, scene);
  addWristGuards(vrm);
  vrm.scene.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = true; } });   /* self-shadow: skirt hem shades the thighs, arms shade the body */
  rider = new Rider(vrm, scene); rider.track = track;
  try { rider.applyProfile(await (await fetch('./data/rider_profile.json')).json()); } catch (e) { console.warn('rider profile', e); }   // who she is & what she likes (tunable)
  try { const td = await (await fetch('./data/moves/throwdown.json')).json(); for (const k in td.game) if (typeof td.game[k] === 'number') rider.TD[k] = td.game[k]; } catch (e) { console.warn('throwdown.json', e); }   /* throwdown mount params */
  for (const mv of ['push', 'pirouette', 'arm_styling', 'cross_step']) { try { rider.applyMoves(mv, await (await fetch('./data/moves/' + mv + '.json')).json()); } catch (e) { console.warn(mv + '.json', e); } }   /* reference moves -> rider.MV */
  // ground height under (x,z): project onto the nearest track SEGMENT and interpolate (snapping to the nearest sample
  // made the walking body hop ~3.5 cm at every sample on slopes)
  rider.groundFn = (x, z) => { const c = Math.round(rider.s / DS), P = track.pts; let best = 1e9, y = 0;
    for (let i = Math.max(0, c - 30); i < Math.min(P.length - 1, c + 30); i++) { const a = P[i], b = P[i + 1], ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez || 1e-9;
      const u = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / L2)), px = a.x + ex * u, pz = a.z + ez * u, d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < best) { best = d; y = a.y + (b.y - a.y) * u; } }
    return y; };
  hair = setupHair(vrm);
  restart();
  $('load').style.display = 'none';
}
const LAB_WIND = { v: null }; const _sw = new THREE.Vector3(), _hk = { ay: 0 }; let windNow = new THREE.Vector3(), windGust = new THREE.Vector3(), lookIdx = 0, simT = 0;
function restart() {
  rider.s = 0; rider.v = 0; rider.t = 0; rider.push = null; rider.ollie = null; rider.air = 0; rider.look = null; rider.nextLook = RD ? 8 : 1e9; rider.ev.length = 0; rider.mode = 'ride'; rider.dance = null; rider.danceCool = 10; rider.seq = null; rider.m = 0; rider.face = 0; rider.hold = null; rider.boardFixed = false; rider.carry = 0; rider.stam = 0.7; rider.pump = null; rider.lat = 0; rider.slideYaw = 0; rider.bend = 0; rider.armIKw = 0;
  lookIdx = 0; simT = 0; drone.t = 0; drone.on = false; drone.next = 8; windNow.set(0, 0, 0); camInit = false; anc.init = false; anc.y = undefined; anc.vr = undefined;
  rider.update(1 / 60, (s) => track.at(s), ctx);
  if (!rider.ankleCal) { rider.calibrateFeet(); rider.ankleCal = true; }
  skirt.inited = false; if (skirt2) skirt2.inited = false; vrm.springBoneManager?.reset?.();
}
function windTarget(s) {
  if (RD && NAT.wind && !REC) return NAT.wind.clone().multiplyScalar(1 + 0.25 * Math.sin(s * 0.013));   // real local wind
  if (RD) return new THREE.Vector3(-2.2 - 1.2 * Math.sin(s * 0.013), 0, 0.6 * Math.sin(s * 0.021));   // onshore sea breeze from the east
  const { g } = track.segAt(s), p = track.at(s), left = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
  const W = 6.5;
  if (g[4] === 'left') return left.multiplyScalar(-W);     // blows from left to right
  if (g[4] === 'right') return left.multiplyScalar(W);
  if (g[4] === 'front') return p.dir.clone().multiplyScalar(-W);
  return new THREE.Vector3(0.6, 0, 0.3);                    // light breeze
}
function caption() {
  const r = rider, { g } = track.segAt(r.s);
  let a = g[3] || '巡航';
  if (r.mode === 'off') a = r.seq?.ph === 'brake' ? ({ slide: '板打横刹停', heel: '脚后跟蹭地刹车', roll: '慢慢滑停' })[r.seq.kind] + ({ steep: '（前面坡太陡）', long: '（坡太长，力气不够）', tired: '（没力气了）', slow: '（速度起不来）' })[r.offWhy] || '' : r.seq?.pick === 'kick' ? '踢板，转一圈接住' : '弯腰捡板';
  else if (r.mode === 'walk') a = '拿着板走路' + ({ steep: '（陡坡）', long: '（长坡，走上去）', tired: '（歇一歇）', slow: '（速度起不来，走一段）' })[r.offWhy];
  else if (r.mode === 'on') a = r.seq?.ph === 'run' ? '助跑几步' : r.seq?.ph === 'step' ? '跳上板' : '放板';
  else if (r.dance) a = r.dance.t < 1.8 ? '交叉步走到板头' : r.dance.t < 4.4 ? 'Peter Pan 单脚滑行' : '交叉步走回来';
  else if (r.ollie?.kind === 'shove') a = r.ollie.why === 'speed' ? '太快了，飞板耗点力减速' : '蓄力满了，飞板！';
  else if (r.ollie) a = 'Ollie 跳过坑';
  else if (r.look) a = '回头看你一眼';
  else if (r.hairHand) a = '风大，拢一下头发';
  else if (r.push) a = g[2] > 0.03 ? '上坡，用力蹬' : '蹬地';
  else if (r.w.tuck > 0.4) a = '下坡，压低重心';
  else if (Math.abs(r.lean) > 0.06) a = `压弯 ${r.lean > 0 ? '向左' : '向右'}（侧倾 ${Math.round(Math.abs(r.lean) * 57.3)}°）`;
  if (RD && a === g[3] && Math.abs(r.lean) <= 0.06) a = g[3];
  const grade = Math.round(g[2] * 100);
  $('cap').innerHTML = `${a}<small>${(r.v * 3.6).toFixed(1)} km/h · 坡度 ${grade > 0 ? '+' : ''}${grade}% · ${r.s.toFixed(0)}/${track.total} m</small>`;
}

// ---------------- stamina bar (always on) ----------------
// TRICK RING (always on, debug or not): outer ring = stamina, inner ring = speed toward the trick threshold.
// When both are met she waits and looks at us; tap the ring / Space / Enter / click the scene to release the trick (board spin).
{ const fire = (e) => { if (e) e.preventDefault?.(); rider.requestTrick && rider.requestTrick(); };
  $('trick')?.addEventListener('click', (e) => { e.stopPropagation(); fire(e); });
  addEventListener('keydown', (e) => { if (e.code === 'Enter') fire(e); });   /* Space = pause now */
  let down = null; $('c').addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  $('c').addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && performance.now() - down.t < 300) fire(); down = null; }); }
function trickHUD() { const r = rider, P = r.trickProg || { stam: r.stam, speed: 0, ready: false }, el = $('trick'); if (!el) return;
  $('trS').setAttribute('stroke-dashoffset', (276.5 * (1 - Math.min(1, P.stam / 0.95))).toFixed(1));
  $('trV').setAttribute('stroke-dashoffset', (213.6 * (1 - P.speed)).toFixed(1));
  $('trS').setAttribute('stroke', P.stam >= 0.95 ? '#ff8a5c' : '#6cbfb0');
  el.classList.toggle('ready', !!P.ready); $('trL').textContent = P.ready ? '转板!' : r.ollie?.kind === 'shove' ? '✨' : P.stam >= 0.95 ? '再快点' : '蓄力'; }
// BRAIN panel (debug only): what she sees and why she does what she does
const PROFILE_LA = () => rider.profile?.mind?.lookAheadM ?? 150;
// ---------------- DEBUG PANEL (Cheney): everything lives here — 女孩 (body/preferences/mind + live state),
// 自然 (sun, wind, road), 决策 (plan + history), 全图 (god's-eye list of the whole route, current stretch highlighted)
let brainTab = localStorage.sw_tab || 'girl';
document.querySelectorAll('#brain .tabs button').forEach((b) => { b.classList.toggle('on', b.dataset.t === brainTab);
  b.onclick = (ev) => { ev.stopPropagation(); brainTab = b.dataset.t; localStorage.sw_tab = brainTab; brainHUD.map = null; brainHUD.mapBuilt = false; brainHUD.force = true; $('brainPane').dataset.lt = ''; document.querySelectorAll('#brain .tabs button').forEach((x) => x.classList.toggle('on', x === b)); brainHUD(); }; });
$('brainPane').addEventListener('scroll', () => { brainHUD.userScroll = true; clearTimeout(brainHUD.us); brainHUD.us = setTimeout(() => brainHUD.userScroll = false, 4000); }, { passive: true });
['pointerdown', 'touchstart', 'wheel'].forEach((ev) => $('brain').addEventListener(ev, (e) => e.stopPropagation(), { passive: true }));
const deg = (gr) => (Math.atan(gr) * 57.3).toFixed(1) + '°';
const row = (k, v, hl) => `<div class="row${hl ? ' hl' : ''}"><span>${k}</span><span>${v}</span></div>`;
const barH = (f, col) => `<div class="bar"><i style="width:${(Math.max(0, Math.min(1, f)) * 100).toFixed(0)}%;background:${col}"></i></div>`;
// whole-route segments (god's eye): runs of similar grade, built once
function routeSegs() { if (routeSegs.c) return routeSegs.c; const out = []; const cls = (g) => g < -0.035 ? '下坡' : g < -0.01 ? '缓下' : g <= 0.01 ? '平' : g <= Math.tan(6 * Math.PI / 180) ? '上坡' : '陡坡';
  let a = 0, c = cls(track.at(0).grade);
  for (let s = 2; s <= track.total; s += 2) { const k = s >= track.total ? null : cls(track.at(s).grade); if (k !== c || s >= track.total) { if (s - a >= 6 || !out.length) { let mx = 0, dh = track.at(Math.min(s, track.total - 0.01)).p.y - track.at(a).p.y; for (let q = a; q < s; q += 1) { const g = track.at(q).grade; if (Math.abs(g) > Math.abs(mx)) mx = g; } out.push({ a, b: s, c, dh, mx }); } else { const p = out[out.length - 1]; p.b = s; } a = s; c = k; } }
  return (routeSegs.c = out); }
const LTDEF = [['timeOverride', '时间（时）', 0, 24, 0.25], ['cloudOverride', '云量', 0, 1, 0.05], ['shadowK', '阴影强度', 0, 1, 0.02], ['toony', '明暗边界硬度', 0.3, 1, 0.02], ['sunMul', '阳光', 0, 2, 0.05], ['fillMul', '天光补光', 0, 2, 0.05], ['exposure', '曝光', 0.5, 1.8, 0.02], ['nightMul', '夜色', 0, 1, 0.05], ['shadowFar', '远处阴影范围（米）', 30, 300, 5], ['farShadow', '远处阴影浓度', 0, 1, 0.05]];
function lightPane(el) { if (el.dataset.lt === '1') { LTDEF.forEach(([k]) => { const o = el.querySelector(`[data-v="${k}"]`); if (o) o.textContent = LT[k] == null ? '实时' : (+LT[k]).toFixed(2); }); return; }
  el.dataset.lt = '1'; el.innerHTML = '<div class="sec">光影（可调，自动保存）</div>' + LTDEF.map(([k, n, a, b, st]) => `<div class="row"><span>${n}</span><span data-v="${k}"></span></div><input type="range" data-k="${k}" min="${a}" max="${b}" step="${st}" value="${LT[k] ?? (k === 'timeOverride' ? 12 : k === 'cloudOverride' ? NAT.cloud : 1)}" style="width:100%">` + (k.endsWith('Override') ? `<button data-r="${k}" style="font-size:10px">用实时</button>` : '')).join('') + '<button id="ltReset" style="margin-top:6px">全部恢复默认</button>';
  el.querySelectorAll('input[type=range]').forEach((i) => i.oninput = () => { LT[i.dataset.k] = +i.value; localStorage.sw_lt = JSON.stringify(LT); });
  el.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { LT[b.dataset.r] = null; localStorage.sw_lt = JSON.stringify(LT); });
  el.querySelector('#ltReset').onclick = () => { Object.assign(LT, { sunMul: 1, fillMul: 1, shadowK: 0.62, toony: 0.82, exposure: 1.08, nightMul: 1, timeOverride: null, cloudOverride: null, lampRange: 25, lampPow: 1, farShadow: 0.45, shadowFar: 110 }); localStorage.sw_lt = '{}'; el.dataset.lt = ''; };
  ['pointerdown', 'touchstart'].forEach((ev) => el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true })); }
function brainHUD() { const r = rider, el = $('brainPane'); if (!el || document.body.classList.contains('nodbg')) return;
  const now = performance.now(); if (now - (brainHUD.tw || 0) < 250 && !brainHUD.force) return; brainHUD.tw = now; brainHUD.force = false;   /* 4 Hz: rebuilding the panel every few frames stalled phones */
  const g = track.at(r.s).grade, pl = r.plan || {}, kmh = (r.v * 3.6).toFixed(1), P = r.profile || {}, ph = P.physical || {}, pref = P.preference || {}, mind = P.mind || {};
  const act = r.rest ? (r.rest.sit ? '坐着休息' : '准备休息') : r.mode === 'walk' ? '拿板走路' : r.mode === 'on' ? '上板中' : r.mode === 'off' ? '下板中' : r.push ? '推板' : r.pump ? 'pump' : r.ollie ? (r.ollie.kind === 'shove' ? '转板' : 'ollie') : '滑行';
  const planTxt = { flat: '看得见的路都能滑', coast: '惯性就能过', carry: '借速度 + pump 冲上去', push: '推板上坡', pushThenWalk: `预计 ${pl.start}m 处会停住`, walk: `${pl.start}m 处太陡，要下板` }[pl.kind] || '-';
  const vm = ctx.vmax ?? 8.3, barJ = ph.energy?.barJ || 15000;
  const head = `<b>${act}</b> · ${kmh} km/h · 坡 ${deg(g)} · ${r.s.toFixed(0)}/${track.total.toFixed(0)} m` + `<div>速度</div>${barH(r.v / vm, '#6d9fe0')}<div>体力 ${Math.round(r.stam * 100)}%（${(r.stam * barJ / 1000).toFixed(1)}/${(barJ / 1000).toFixed(0)} kJ）</div>${barH(r.stam, r.stam < 0.15 ? '#e8a0a0' : '#6cbfb0')}`;
  let body = '';
  if (brainTab === 'girl') {
    const sec = (t, o) => `<div class="sec">${t}</div>` + Object.entries(o || {}).filter(([k]) => k[0] !== '_').map(([k, v]) => row(k, typeof v === 'object' ? JSON.stringify(v) : v)).join('');
    body = head + `<div class="sec">此刻</div>` + row('动作', act, true) + row('pump 强度', r.pump ? `${r.pump.A.toFixed(2)} / ${r.pump.I.toFixed(2)}` : '-') + row('蹬地冷却', (r.pushCool || 0).toFixed(1) + 's') + row('身体侧倾', ((r.lean || 0) * 57.3).toFixed(0) + '°') + row('花样', r.trickReady ? '<b>可以</b>' : r.stam < (pref.trickMinStamina ?? 0.7) ? '体力不够' : r.v < (pref.trickMinKmh ?? 9.4) / 3.6 ? '速度不够' : r.v > vm + 1.2 ? '太快不安全' : '不合适') +
      sec('身体', ph.body) + sec('体力', ph.energy) + sec('技术', ph.skill) + sec('喜好', pref) + sec('头脑', mind);
  } else if (brainTab === 'nature') {
    const T = track.at(r.s); const ws = ctx.wind ? Math.hypot(ctx.wind.x, ctx.wind.z) : 0; body = head + `<div class="sec">自然</div>` + row('光照模式', $('tod')?.textContent || '-') + row('当地时间', new Date().toLocaleTimeString('zh-CN', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit' })) + (NAT.sun ? row('太阳高度 / 方位', `${(NAT.sun.el * 57.3).toFixed(0)}° / ${(((NAT.sun.az * 57.3) % 360 + 360) % 360).toFixed(0)}°`, true) : '') + (NAT.phase ? row('天色', NAT.phase) : '') + (NAT.moon ? row('月亮 高度 / 亮面', `${(NAT.moon.el * 57.3).toFixed(0)}° / ${Math.round(NAT.moon.illum * 100)}%`) : '') + row('天气来源', NAT.src) + (NAT.raw ? row('气温 / 云量', `${NAT.raw.temperature_2m}°C / ${NAT.raw.cloud_cover}%`) + row('10 m 风 / 阵风', `${NAT.raw.wind_speed_10m} / ${NAT.raw.wind_gusts_10m} m/s 来自 ${NAT.raw.wind_direction_10m}°`) : '') + row('她身边的风', ws.toFixed(1) + ' m/s（只吹头发衣服）') + row('坡度', deg(g), true) + row('弯曲 κ', T.kappa.toFixed(3)) + row('海拔', T.p.y.toFixed(1) + ' m') +
      row('空气阻力', (0.5 * 1.2 * 0.23 * r.v * r.v).toFixed(1) + ' N') + row('滚阻', (60 * 9.81 * 0.004).toFixed(1) + ' N') + row('重力沿坡', (60 * 9.81 * Math.sin(Math.atan(g))).toFixed(0) + ' N') + row('动能', (0.5 * 60 * r.v * r.v / 1000).toFixed(2) + ' kJ') +
      `<div class="sec">前方 60 m</div>` + [10, 20, 30, 45, 60].map((d) => row(`+${d} m`, deg(track.at(Math.min(track.total - 0.1, r.s + d)).grade))).join('');
  } else if (brainTab === 'light') { lightPane(el); return;
  } else if (brainTab === 'mind') {
    body = head + `<div class="sec">计划（看 ${PROFILE_LA()} m）</div>` + row('结论', planTxt, true) + (pl.climbAt != null ? row('下一段上坡', `${pl.climbAt} m 后 · 长 ${pl.L ?? '?'} m · 爬 ${(pl.dh ?? 0).toFixed(1)} m · 最陡 ${deg(pl.maxG || 0)}`) : '') +
      (pl.need !== undefined ? row('模拟耗能', `${(pl.need / 1000).toFixed(1)} / ${(pl.have / 1000).toFixed(1)} kJ`) : '') + (pl.vEnd !== undefined ? row(`${PROFILE_LA()} m 后速度`, pl.vEnd + ' km/h') : '') + row('速度目标', ((r.vTarget || 0) * 3.6).toFixed(0) + ' km/h') +
      `<div class="sec">历史决策</div>` + (r.dlog || []).slice().reverse().slice(0, 40).map((d, i) => `<div class="${i ? '' : 'hl'}">${Math.round(d.s)}m · ${d.msg}</div>`).join('');
  } else {
    const S = routeSegs(); let cur = 0; S.forEach((q, i) => { if (r.s >= q.a && r.s < q.b) cur = i; });
    const col = { 下坡: '#3b8f6a', 缓下: '#6cbfb0', 平: '#999', 上坡: '#d08a3c', 陡坡: '#c4512f' };
    if (!brainHUD.mapBuilt) { brainHUD.mapBuilt = true; el.innerHTML = `<div id="mapHead"></div><div class="sec">全图 ${S.length} 段（天眼）</div>` + S.map((q, i) => `<div class="seg${i === cur ? ' cur' : i < cur ? ' done' : ''}" ${i === cur ? 'id="segCur"' : ''}><span style="color:${col[q.c]}">■</span> ${q.a.toFixed(0)}–${q.b.toFixed(0)} m · ${q.c} ${(q.b - q.a).toFixed(0)} m · ${q.dh >= 0 ? '+' : ''}${q.dh.toFixed(1)} m · 最陡 ${deg(q.mx)}${pl.start != null && (pl.kind === 'walk' || pl.kind === 'pushThenWalk') && r.s + pl.start >= q.a && r.s + pl.start < q.b ? ' · <b>⚠ 计划下板</b>' : ''}</div>`).join(''); brainHUD.map = null; }
    $('mapHead').innerHTML = head;
    if (brainHUD.map !== cur) { const segs = el.querySelectorAll('.seg'); segs.forEach((d, i) => { d.classList.toggle('cur', i === cur); d.classList.toggle('done', i < cur); });
      if (!brainHUD.userScroll) { const c = segs[cur]; if (c) el.scrollTop = c.offsetTop - el.clientHeight / 2; } brainHUD.map = cur; } return;
  }
  if (!brainHUD.userScroll) el.innerHTML = body; }
function stamHUD() {
  trickHUD(); brainHUD();
  const r = rider, f = r.stam;
  $('stamF').style.width = (f * 100).toFixed(1) + '%';
  const vm = ctx.vmax ?? 6, sp = Math.min(1, (r.v * r.v) / (vm * vm));   // speed bar = kinetic energy share of the top speed
  $('spdF').style.width = (sp * 100).toFixed(1) + '%';
  $('spdT').textContent = `💨 速度 ${(r.v * 3.6).toFixed(1)} km/h · 动能 ${(0.5 * 52 * r.v * r.v / 1000).toFixed(2)} kJ`;
  $('stamF').style.background = f > 0.999 ? 'linear-gradient(90deg,#ffb36b,#ff7a59)' : f < 0.15 ? '#e8a0a0' : 'linear-gradient(90deg,#9fd8c8,#6cbfb0)';
  const pl = r.plan; $('stamT').textContent = `🪶 耐力 ${Math.round(f * EMAX / 1000 * 10) / 10} / ${EMAX / 1000} kJ` + (pl && pl.kind !== 'flat' && pl.start < 60 ? ` · 前方坡 ${Math.round(pl.L)}m 需 ${(pl.need / 1000).toFixed(1)}kJ` : '');
}
// ---------------- camera ----------------
let camMode = Q.get('cam') || 'chase', camInit = false;
const drone = { t: 0, next: 8, on: false, side: 1, u: 0 };
const frameK = { back: 0, aim: 0 }; const dampF = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
const orbit = { yaw: Math.PI, pitch: 0.18, dist: 3.2, drag: null, pinch: null };
// DRONE anchor: a point on the path that glides along with her progress (critically damped), never the board itself,
// so walking bob, carrying, ollies and dismounts move HER inside a calm frame instead of shaking the frame.
const anc = { s: 0, v: 0, p: new THREE.Vector3(), init: false };
const spring = (st, key, target, w, dt) => { const x = st[key], v = st[key + 'v'] || 0; const a = w * w * (target - x) - 2 * w * v; st[key + 'v'] = v + a * dt; st[key] = x + st[key + 'v'] * dt; };
const camS = {};
window.__ancS = () => anc.s;
function anchorStep(dt) {
  if (!anc.init) { anc.s = rider.s; anc.v = 0; anc.init = true; }
  // track her progress with velocity feed-forward: no steady lag at speed, but sudden starts/stops and gait surges are smoothed
  anc.vr = anc.vr === undefined ? rider.v : anc.vr + (rider.v - anc.vr) * (1 - Math.exp(-dt * 2.5));
  const W = 1.6, a = W * W * (rider.s - anc.s) + 2 * W * (anc.vr - anc.v); anc.v += a * dt; anc.s += anc.v * dt;
  anc.p.copy(track.at(anc.s).p);
  // vertical: low-pass the path height so steps / bumps don't bounce the frame
  anc.y = anc.y === undefined ? anc.p.y : anc.y + (anc.p.y - anc.y) * (1 - Math.exp(-dt * 1.5)); anc.p.y = anc.y;
}
function updateCamera(dt) {
  if (camMode === 'none') return;
  anchorStep(dt);
  if (camMode === 'orbit') {
    const low = Math.max(0, -orbit.pitch) / 0.5, c = anc.p.clone().add(new THREE.Vector3(0, 0.95 - 0.25 * low, 0));
    const p = track.at(anc.s), base = Math.atan2(p.dir.x, p.dir.z) + orbit.yaw;
    const want = c.clone().add(new THREE.Vector3(Math.sin(base) * Math.cos(orbit.pitch), Math.sin(orbit.pitch), Math.cos(base) * Math.cos(orbit.pitch)).multiplyScalar(orbit.dist));
    const gy = (rider?.groundFn ? rider.groundFn(want.x, want.z) : anc.p.y) + 0.12; if (want.y < gy) want.y = gy;   // never below the road
    if (!camInit) { camPos.copy(want); camInit = true; }
    camPos.lerp(want, 1 - Math.exp(-dt * 10)); camera.position.copy(camPos); camera.lookAt(c);
    sunFollow(anc.p);
    return;
  }
  const p = track.at(anc.s), left = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
  const base = anc.p.clone();   // drone anchor: path point, not the board
  let want, look;
  if (camMode === 'side') { want = base.clone().addScaledVector(left, 3.6).add(new THREE.Vector3(0, 1.1, 0)).addScaledVector(p.dir, 0.3); look = base.clone().add(new THREE.Vector3(0, 0.85, 0)); }
  else if (camMode === 'front') { want = base.clone().addScaledVector(p.dir, 4.2).addScaledVector(left, 0.9).add(new THREE.Vector3(0, 1.3, 0)); look = base.clone().add(new THREE.Vector3(0, 0.9, 0)); }
  else if (RD && rider.w.look < 0.05) {
    // view direction = along the path, swung toward the sea (east, +X): she rides in the lower third, ocean fills the far frame
    const fwd = track.at(anc.s + 10).p.clone().sub(track.at(anc.s - 10).p).setY(0).normalize();
    // pick the heading (path direction swung up to ~60° either way) with the most open sea / least terrain in the way
    if (!rider.__vdT || simT - (rider.__vdAt || -9) > 0.5) {
      rider.__vdAt = simT; let best = -1e9, bestV = fwd;
      const shoreAt = (x, z) => { if (!SHORE) return 0; const T = RD.terrain, i = Math.round((x - T.x0) / T.step), j = Math.round((-z - T.y0) / T.step); return (i >= 0 && j >= 0 && i < T.nx && j < T.ny && RD.terrain.hSea && RD.terrain.hSea[j * T.nx + i] < -5) ? 1 : 0; };
      for (const ang of [-1.05, -0.7, -0.35, 0, 0.35, 0.7, 1.05]) {
        const v = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang); let block = 0, sea = 0;
        for (let d = 10; d <= 160; d += 10) { const q = base.clone().addScaledVector(v, d); const gq = track.terrainH(q.x, -q.z); block = Math.max(block, (gq - base.y - 2.2) / d); sea += shoreAt(q.x, q.z); }
        const score = sea * 1.0 - Math.max(0, block) * 60 - Math.abs(ang) * 1.5;
        if (score > best) { best = score; bestV = v; }
      }
      rider.__vdT = bestV;
    }
    const vd = rider.__vdT.clone();
    rider.__vd = rider.__vd ? rider.__vd.lerp(vd, 1 - Math.exp(-dt * 0.7)).normalize() : vd.clone();
    want = base.clone().addScaledVector(rider.__vd, -(window.__cd ?? 5.0)).add(new THREE.Vector3(0, window.__ch ?? 2.9, 0));
    look = base.clone().addScaledVector(rider.__vd, 6).add(new THREE.Vector3(0, 0.2, 0));
  }
  else { const ahead = track.at(anc.s + 2.5).p; const side = -0.55 - 0.7 * (rider.w.look > 0 ? Math.min(1, rider.w.look * 1.6) : 0); want = base.clone().addScaledVector(p.dir, -3.1 + rider.w.look * 0.6).addScaledVector(left, side).add(new THREE.Vector3(0, 1.08 - rider.w.look * 0.1, 0)); look = base.clone().lerp(ahead, 0.35).add(new THREE.Vector3(0, 0.95, 0)); }
  // AERIAL MOVES (chase only): every ~30 s on a calm stretch the drone slowly swings out to her side-front, rises, holds
  // while she glances at it, then returns behind her. Smooth in/out, ~11 s, alternating sides.
  if (camMode === 'chase' && Q.get('drone') !== '0') {
    const D = drone; D.t += dt;
    const calm = rider.mode === 'ride' && !rider.ollie && !rider.dance && rider.v > 1.5;
    if (!D.on && D.t > D.next && calm) { D.on = true; D.u = 0; D.side = -D.side; D.T = 13 + Math.random() * 4; D.amp = 2.0 + Math.random() * 0.5; D.up = 0.6 + Math.random() * 0.8; D.glance = false; }
    if (D.on) { D.u += dt / D.T; const u = Math.min(1, D.u), e = sstep(0, 0.38, u) * (1 - sstep(0.66, 1, u));
      const off = want.clone().sub(base), ang = D.side * D.amp * e; off.applyAxisAngle(new THREE.Vector3(0, 1, 0), ang); off.multiplyScalar(1 + 0.25 * e); off.y += D.up * e;
      want = base.clone().add(off); look = look.clone().lerp(base.clone().add(new THREE.Vector3(0, 0.9, 0)), e);
      if (!D.glance && u > 0.42 && !rider.look) { D.glance = true; rider.nextLook = 0; }
      if (u >= 1) { D.on = false; D.t = 0; D.next = 14 + Math.random() * 10; } }
  }
  if (RD && track.terrainH) {
    // keep the camera (and the sight line to her) above the real terrain: lift it, and pull it in on steep hillsides
    const gh = (v) => track.terrainH(v.x, -v.z);
    for (let it = 0; it < 6; it++) {
      let worst = 0; for (let k = 0; k <= 8; k++) { const q = want.clone().lerp(look, k / 8 * 0.8); worst = Math.max(worst, gh(q) + 0.9 - q.y); }
      if (worst <= 0) break;
      want.y += worst; if (want.y - base.y > 5) { want.lerp(look, 0.2); }
    }
  }
  // spring the camera's OFFSET from the anchor (the anchor already moves smoothly with her), so there is no
  // speed-proportional lag: framing composition stays put, only changes of composition are eased
  const oP = want.clone().sub(base), oL = look.clone().sub(base);
  if (!camInit) { camS.px = oP.x; camS.py = oP.y; camS.pz = oP.z; camS.lx = oL.x; camS.ly = oL.y; camS.lz = oL.z; for (const k of ['px', 'py', 'pz', 'lx', 'ly', 'lz']) camS[k + 'v'] = 0; camInit = true; }
  const W = 2.2, WL = 2.6;
  spring(camS, 'px', oP.x, W, dt); spring(camS, 'py', oP.y, W * 0.8, dt); spring(camS, 'pz', oP.z, W, dt);
  spring(camS, 'lx', oL.x, WL, dt); spring(camS, 'ly', oL.y, WL * 0.8, dt); spring(camS, 'lz', oL.z, WL, dt);
  camPos.set(camS.px, camS.py, camS.pz).add(base); camLook.set(camS.lx, camS.ly, camS.lz).add(base);
  camera.position.copy(camPos); camera.lookAt(camLook);
  // KEEP HER IN FRAME (Cheney: not centred on her, but always on screen — if needed pull back): project her head, hips,
  // feet and board ends; if any falls outside a safe margin, ease the camera back along its view line (and re-aim a bit
  // toward her). The pull-back relaxes slowly when she is comfortably inside again.
  { camera.updateMatrixWorld(); const pts = [rider.b.head, rider.b.hips, rider.b.leftFoot, rider.b.rightFoot].map((o) => o.getWorldPosition(new THREE.Vector3()));
    rider.board.updateMatrixWorld(); pts.push(rider.board.localToWorld(new THREE.Vector3(0, 0.1, 0.56)), rider.board.localToWorld(new THREE.Vector3(0, 0.1, -0.56)));
    let worst = 0, cx = 0, cy = 0; for (const q of pts) { const n = q.clone().project(camera); cx += n.x / pts.length; cy += n.y / pts.length; const o = Math.max(Math.abs(n.x) - 0.82, Math.abs(n.y) - 0.86, n.z > 1 ? 1 : 0); worst = Math.max(worst, o); }
    frameK.back = worst > 0 ? Math.min(6, frameK.back + worst * 6 * dt * 10) : Math.max(0, frameK.back - dt * 0.25);
    frameK.aim = dampF(frameK.aim, worst > 0 ? 1 : 0, worst > 0 ? 3 : 0.5, dt);
    if (frameK.back > 0 || frameK.aim > 0.01) { const vd = camLook.clone().sub(camPos).normalize(); camPos.addScaledVector(vd, -frameK.back).add(new THREE.Vector3(0, frameK.back * 0.35, 0));
      const hip = pts[1]; camLook.lerp(hip, 0.5 * frameK.aim); camera.position.copy(camPos); camera.lookAt(camLook); } }
  if (BLD.gpu) { const a = camera.position, b = rider.board.position.clone().add(new THREE.Vector3(0, 1, 0)), ab = b.clone().sub(a);
    /* same rule as below, evaluated per building in the vertex shader (merged meshes) */
    BLD.gpu.uCamA.value.copy(a); BLD.gpu.uCamF.value.copy(a).addScaledVector(ab, 1 + 14 / Math.max(ab.length(), 1e-3)); BLD.gpu.uHide.value = 1; }
  if (BLD.length) { const a = camera.position, b = rider.board.position.clone().add(new THREE.Vector3(0, 1, 0)), ab = b.clone().sub(a), l2 = ab.lengthSq();
    // hide blocks that sit on the sight line camera -> her -> ~14 m beyond her (they would wall off the view she rides into)
    const far = a.clone().addScaledVector(ab, 1 + 14 / Math.sqrt(l2)), af = far.clone().sub(a), lf = af.lengthSq();
    for (const o of BLD) { const u = clamp(o.c.clone().sub(a).dot(af) / lf, 0, 1), d = o.c.distanceTo(a.clone().addScaledVector(af, u)); o.m.visible = d > o.r * 0.8 + 2; } }
  sunFollow(base);
}
// LIGHT TUNING (debug 光影 tab): shadow strength = how dark the side away from the sun gets (sky fill), sun power, exposure...
const LT = { sunMul: 1, fillMul: 1, shadowK: 0.62, toony: 0.82, exposure: 1.08, nightMul: 1, timeOverride: null, cloudOverride: null, lampRange: 25, lampPow: 1, farShadow: 0.45, shadowFar: 110 };
try { Object.assign(LT, JSON.parse(localStorage.sw_lt || '{}')); } catch (e) {}
function moonPos(date, lat, lon) { /* low-precision lunar position (Meeus-lite) + phase */ const rad = Math.PI / 180, d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const L = (218.316 + 13.176396 * d) * rad, M = (134.963 + 13.064993 * d) * rad, F = (93.272 + 13.229350 * d) * rad;
  const lam = L + 6.289 * rad * Math.sin(M), bet = 5.128 * rad * Math.sin(F), e = 23.439 * rad;
  const ra = Math.atan2(Math.sin(lam) * Math.cos(e) - Math.tan(bet) * Math.sin(e), Math.cos(lam)), dec = Math.asin(Math.sin(bet) * Math.cos(e) + Math.cos(bet) * Math.sin(e) * Math.sin(lam));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24, ha = (gmst * 15 + lon) * rad - ra, la = lat * rad;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)), az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));
  const sunL = (280.459 + 0.98564736 * d) * rad + 1.915 * rad * Math.sin((357.529 + 0.98560028 * d) * rad), illum = 0.5 * (1 - Math.cos(lam - sunL));
  return { el, az, illum }; }
const dirOf = (el, az) => new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
// GIRL SHADING (Cheney: real sun = a visible light/shade split on her, but the shade side not too dark).
// The native VRM materials came with shadeColor == lit and shift 1 (= no shade at all). Here: shade = lit x shadeK (slightly
// cool), a crisp-ish terminator, less GI flattening. Re-applied whenever the tuning changes. Face stays soft.
function girlShading() { const v = rider?.vrm; if (!v) return; const k = LT.shadowK, sh = 1 - 0.55 * k, key = k + ':' + LT.toony;
  if (girlShading.key === key) return; girlShading.key = key;
  v.scene.traverse((o) => { if (!o.isMesh) return; (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { const U = m.uniforms; if (!U || !U.shadeColorFactor) return;
    const n = m.name || ''; if (/EYE|Eyeline|Eyelash|Brow|Highlight|FaceMouth/.test(n)) return;
    const face = /Face_00_SKIN/.test(n), hair = /HAIR/.test(n), s = face ? 1 - 0.3 * k : sh;
    U.shadeColorFactor.value.setRGB(s * 0.97, s * 0.95, s * 1.04);
    if (U.shadingShiftFactor) U.shadingShiftFactor.value = face ? -0.2 : hair ? -0.25 : -0.12;
    if (U.shadingToonyFactor) U.shadingToonyFactor.value = face ? 0.5 : LT.toony;
    if ('giEqualizationFactor' in m) m.giEqualizationFactor = 0.45; else if (U.giEqualizationFactor) U.giEqualizationFactor.value = 0.45;
    if (!m.shadeMultiplyTexture && m.map) { m.shadeMultiplyTexture = m.map; m.needsUpdate = true; }   /* shade keeps the cloth/skin texture */ }); }); }
function sunFollow(base) {
  girlShading();
  if (TOD === 'real') { const now = LT.timeOverride != null ? (() => { const d = new Date(); const syd = new Date(d.toLocaleString('en-US', { timeZone: 'Australia/Sydney' })); const off = d - syd; const t = new Date(syd); t.setHours(Math.floor(LT.timeOverride), Math.round((LT.timeOverride % 1) * 60), 0, 0); return new Date(t.getTime() + off); })() : (NAT.t || new Date());
    const sp = solarPos(now, NAT.lat, NAT.lon), mp = moonPos(now, NAT.lat, NAT.lon); NAT.sun = sp; NAT.moon = mp; NAT.now = now;
    const elD = sp.el * 180 / Math.PI, cl = LT.cloudOverride != null ? LT.cloudOverride : NAT.cloud;
    /* phases: day (sun > 6°) -> golden (6..-1) -> twilight (-1..-8, blue hour) -> night (< -8°, moon/stars) */
    const day = Math.min(1, Math.max(0, (elD + 1) / 7)), night = Math.min(1, Math.max(0, (-elD - 1) / 7)) * LT.nightMul;
    const low = 1 - Math.min(1, Math.max(0, (elD - 4) / 30));
    const sdir = dirOf(Math.max(sp.el, 3 * Math.PI / 180), sp.az), mdir = dirOf(Math.max(mp.el, 5 * Math.PI / 180), mp.az);
    const moonUp = Math.min(1, Math.max(0, mp.el * 180 / Math.PI / 5)), moonI = moonUp * (0.25 + 0.75 * mp.illum) * (1 - 0.7 * cl);
    const kdir = night > 0.5 && moonI > 0.05 ? mdir : sdir;   /* the shadow-casting light: sun by day, moon at night */
    sun.position.copy(base).addScaledVector(kdir, 14); sun.target.position.copy(base);
    const sc = new THREE.Color(1, 0.93 - 0.17 * low, 0.82 - 0.3 * low), mc = new THREE.Color('#9fb6ff');
    sun.color.copy(sc).lerp(mc, night); const keyI = LT.sunMul * ((2.9 + 0.3 * low) * (1 - 0.6 * cl) * day * (1 - night) + 0.55 * moonI * night);
    /* near + far cascade share the key light: far part = farShadow share, so distant trees/houses cast shadow over everything in view */
    const fs = LT.farShadow; sun.intensity = keyI * (1 - fs); sunFar.intensity = keyI * fs; sunFar.color.copy(sun.color);
    { const F = LT.shadowFar, cm = sunFar.shadow.camera; if (cm.right !== F) { cm.left = -F; cm.right = F; cm.top = F; cm.bottom = -F; cm.far = F * 4.5; cm.updateProjectionMatrix(); }
      const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize(); const ctr = base.clone().addScaledVector(fwd, F * 0.6);   /* centre the far map ahead of the camera: that is what is visible */
      const step = (2 * F) / 2048; ctr.x = Math.round(ctr.x / step) * step; ctr.z = Math.round(ctr.z / step) * step;   /* snap to texels: no shimmering */
      sunFar.position.copy(ctr).addScaledVector(kdir, F * 2); sunFar.target.position.copy(ctr); }
    seaU.uLamp.value.set(0, 0, 0, 0);   /* no head lamp (Cheney); a board-nose light is in docs/ideas.md */
    seaU.uNight.value = Math.max(night, (1 - day) * 0.5);
    /* sky fill: this is what lights the shade side. Lower fill = stronger light/shade split (Cheney: real sun casts real shade;
       not too dark). Overcast: fill rises and the sun fades -> soft. */
    const fill = (1 - LT.shadowK) * 1.6 + 1.1 * cl;
    hemi.color.set(low > 0.6 ? '#ffe2c4' : '#eef6ff').lerp(new THREE.Color('#4a63a8'), night); hemi.groundColor.set('#c8b08a').lerp(new THREE.Color('#1c2846'), night);
    hemi.intensity = LT.fillMul * (fill * (1 - night) * Math.max(0.35, day) + (0.85 + 0.5 * moonI) * night);
    scene.fog.color.set(low > 0.6 ? '#f4d9bd' : '#d6ebf5').lerp(new THREE.Color('#0d1730'), Math.max(night, (1 - day) * 0.6));
    renderer.toneMappingExposure = LT.exposure * (1 + 0.1 * night);
    const S = window.__sky.uniforms; S.uWarm.value = low * (1 - night); S.uSun.value.copy(sdir); S.uNight.value = Math.max(night, (1 - day) * 0.55); S.uMoon.value.copy(mdir); S.uMoonA.value = moonUp * (0.4 + 0.6 * mp.illum);
    seaU.uSun.value.copy(kdir); seaU.uSunCol.value.copy(sun.color); seaU.uSky.value.set(low > 0.6 ? '#c9d6e0' : '#a8cdea').lerp(new THREE.Color('#0c1630'), night); seaU.uFog.value.copy(scene.fog.color);
    const rim = low * (1 - cl) * (1 - night) * day; if (skirt) skirt.rimU.value.set(0.75 * rim, 0.52 * rim, 0.3 * rim); if (skirt2) skirt2.rimU.value.set(0.6 * rim, 0.45 * rim, 0.3 * rim);
    rimLight.position.copy(base).addScaledVector(sdir, 10).add(new THREE.Vector3(0, 2, 0)); rimLight.target.position.copy(base).add(new THREE.Vector3(0, 1.2, 0)); rimLight.intensity = 2.2 * rim;
    NAT.phase = night > 0.5 ? '夜' : day < 1 ? (sp.el > 0 ? '黄昏/清晨' : '蓝调') : '白天';
    return; }
  sunFar.intensity = 0; seaU.uNight.value = 0; seaU.uLamp.value.set(0, 0, 0, 0);
  if (TOD === 'golden') {
    const ahead = track.at(rider.s + 30).dir; const sdir = RD ? (() => { const v = (rider.__vd || new THREE.Vector3(1, 0, 0)).clone(); v.y = 0; v.normalize(); return new THREE.Vector3(v.x * 0.9 + 0.35, 0.16, v.z * 0.9).normalize(); })() : new THREE.Vector3(ahead.x * 0.9 + 0.35, 0.32, ahead.z * 0.9).normalize();
    sun.position.copy(base).addScaledVector(sdir, 14); sun.target.position.copy(base);
    sun.color.set('#ffc98a'); sun.intensity = 2.9; hemi.color.set('#ffe2c4'); hemi.groundColor.set('#b89a72'); hemi.intensity = 1.25;
    scene.fog.color.set('#f4d9bd'); renderer.toneMappingExposure = 1.05; window.__sky.uniforms.uWarm.value = 1; window.__sky.uniforms.uSun.value.copy(sdir).setY(0.06);
    if (skirt) skirt.rimU.value.set(0.75, 0.52, 0.3); if (skirt2) skirt2.rimU.value.set(0.6, 0.45, 0.3);
    seaU.uSun.value.copy(sdir); seaU.uSunCol.value.set('#ffcf98'); seaU.uSky.value.set('#c9d6e0'); seaU.uFog.value.copy(scene.fog.color);
    rimLight.position.copy(base).addScaledVector(sdir, 10).add(new THREE.Vector3(0, 2, 0)); rimLight.target.position.copy(base).add(new THREE.Vector3(0, 1.2, 0)); rimLight.intensity = 2.2;
  } else {
    sun.position.copy(base).add(new THREE.Vector3(-6, 12, -4)); sun.target.position.copy(base);
    sun.color.set('#ffe9c8'); sun.intensity = 2.5; hemi.color.set('#eef6ff'); hemi.groundColor.set('#d8c49a'); hemi.intensity = 1.4;
    seaU.uSun.value.set(0.55, 0.75, -0.2).normalize(); seaU.uSunCol.value.set('#fff3dc'); seaU.uSky.value.set('#a8cdea');
    scene.fog.color.set('#d6ebf5'); seaU.uFog.value.set('#d6ebf5'); renderer.toneMappingExposure = 1.12; window.__sky.uniforms.uWarm.value = 0; if (skirt) skirt.rimU.value.set(0, 0, 0); if (skirt2) skirt2.rimU.value.set(0, 0, 0); rimLight.intensity = 0;
  }
}

// ---------------- loop ----------------
let slow = 1, paused = false;
let REFV = null;   /* ?ref=<move>[/<sample>] skeleton replay (js/refview.js) */
function step(dt) {
  simT += dt; seaU.uT.value = simT; envU.uT.value = simT;
  if (REFV) REFV.step(dt);
  // events by position
  if (lookIdx < LOOKS.length && rider.s > LOOKS[lookIdx]) { rider.nextLook = 0; lookIdx++; }
  windNow.lerp(LAB_WIND.v || windTarget(rider.s), 1 - Math.exp(-dt * 1.2));   // LAB_WIND.v: test override (world m/s)
  // gusts: slow swell + occasional puffs, so cloth/hair never settle into a frozen pose
  const gust = 0.5 + 0.5 * Math.sin(simT * 0.37) * Math.sin(simT * 0.83 + 1.1);
  const puff = Math.pow(Math.max(0, Math.sin(simT * 0.21 + 0.4)), 12);
  windGust.copy(windNow).multiplyScalar(0.75 + 0.45 * gust + 0.8 * puff);
  rider.gust = puff;
  ctx.wind = windGust;
  rider.update(dt, (s) => track.at(s), ctx);
  { // body kinematics for the hair/cloth rig: travel direction, lateral (centripetal) accel v²κ, vertical accel
    const tr = track.at(rider.s), hp = vrm.scene.position; const vy = (hp.y - (_hk.y0 ?? hp.y)) / dt; _hk.y0 = hp.y;
    const ay = (vy - (_hk.vy ?? vy)) / dt; _hk.vy = vy; _hk.ay += (Math.max(-20, Math.min(20, ay)) - _hk.ay) * 0.2;
    const lat = new THREE.Vector3(-tr.dir.z, 0, tr.dir.x).multiplyScalar(rider.aLat || 0);   // the rider's real sideways acceleration (CoM physics)
    hair.update(rider.airRel, simT, { dt, fwd: tr.dir, latAcc: lat, vAcc: _hk.ay }); }
  flutterUpdate(rider.airRel, simT);
  const nearBoard = !!rider.hold || rider.mode === 'off' || rider.mode === 'on';
  skirt.setBoard(rider.board, nearBoard); skirt.step(dt, windGust, simT);
  if (skirt2) { skirt2.setBoard(rider.board, nearBoard);
    // shirt tails: the world wind is softened (×0.55) so her own motion dominates — the tails stream BACK along her travel,
    // and lift in gusts, instead of being flung sideways by a crosswind
    skirt2.step(dt, skirt2.aero ? _sw.copy(windGust).multiplyScalar(0.55) : windGust, simT); }
  hat.step(dt, rider.airRel, simT);
  if (rider.s > track.total - 2) restart();
  // petals
  const cam = camera.position, m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < PN; i++) {
    const d = pdata[i];
    if (d.p.distanceTo(cam) > 14) {
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 10;
      d.p.set(cam.x + Math.cos(a) * r, rider.board.position.y + Math.random() * 3, cam.z + Math.sin(a) * r).addScaledVector(windNow, -0.8);
    }
    d.p.addScaledVector(windNow, dt * d.s * 0.9); d.p.y += Math.sin(simT * 2 + i) * dt * 0.3 - dt * 0.15;
    d.r += dt * 3 * d.s;
    e.set(d.r, d.r * 1.3, 0); qq.setFromEuler(e);
    const vis = sstep(1.5, 6, windNow.length());
    m4.compose(d.p, qq, new THREE.Vector3(vis, vis, vis)); petals.setMatrixAt(i, m4);
  }
  petals.instanceMatrix.needsUpdate = true;
  // flags flutter downwind
  const wl = windNow.length(), wd = Math.atan2(windNow.x, windNow.z);
  for (const f of flags) {
    f.f.rotation.y = wd - Math.PI / 2;
    const a = f.f.geometry.attributes.position, b = f.base;
    for (let i = 0; i < a.count; i++) { const x = b[i * 3]; a.setZ(i, Math.sin(x * 9 - simT * (4 + wl)) * 0.06 * x * (0.3 + wl / 6)); a.setY(i, b[i * 3 + 1] - x * Math.max(0, 0.6 - wl / 8) * 0.8); }
    a.needsUpdate = true;
  }
  updateCamera(dt);
  caption();
  stamHUD();
}
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 55 : 40; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000) * slow; last = now;
  if (rider && !REC && !paused) { step(dt); sndTick(); }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
await init();
if (Q.get('ref')) { try { REFV = await (await import('./refview.js')).attach({ renderer, camera, THREE, Q }); window.REFV = REFV; } catch (e) { console.error('refview', e); } }
requestAnimationFrame(frame);

document.querySelectorAll('[data-cam]').forEach((b) => b.onclick = () => { camMode = b.dataset.cam; camInit = false; document.querySelectorAll('[data-cam]').forEach((x) => x.classList.toggle('on', x === b)); });
$('restart').onclick = restart;
// ---- MAP VIEW (Cheney): our own baked data drawn top-down — terrain hillshade, sea, coast/cliffs, buildings, the route
// (coloured by grade) and where she is; drag to pan, pinch/wheel to zoom. Links open the same spot in Google Maps / Earth 3D.
// Modes: 'ours' (2D baked data) | 'o3d' (the real three.js scene rendered straight down, orthographic, same view) |
// 'sat' (open aerial imagery tiles, display only) | 'cmp' (swipe: left = ours 2D/3D, right = imagery, drag the bar).
// Imagery is for VISUAL comparison only; nothing is read back from it (Google's terms forbid deriving content; NSW
// Spatial Services imagery is CC BY 4.0, Esri World Imagery needs its attribution line).
const MAP = { on: false, z: 1.2, cx: 0, cy: 0, base: null, mode: 'ours', left: 'ours', split: 0.5, lines: false, src: 'nsw', tiles: new Map(), c3: null, v3: null, t3: 0 };
const SAT = {
  nsw: { url: (z, y, x) => `https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/${z}/${y}/${x}`, max: 21, attr: 'Imagery © Spatial Services NSW, Dept of Customer Service (CC BY 4.0)' },
  esri: { url: (z, y, x) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, max: 19, attr: 'Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community' },
};
/* local projection used by every bake script (build_route.py / terrain.py): x = (lon-lon0)*kx, y(north) = (lat-lat0)*ky */
const MPROJ = RD ? { lat0: RD.start[0], lon0: RD.start[1], kx: 111320 * Math.cos(RD.start[0] * Math.PI / 180), ky: 110540 } : null;
function routeLatLon(s) { if (!RD) return null; const P = RD.pts, f = s / track.total * RD.length; let k = 0; while (k < P.length - 2 && P[k + 1].s < f) k++;
  const a = P[k], b = P[k + 1], t = b.s > a.s ? Math.min(1, Math.max(0, (f - a.s) / (b.s - a.s))) : 0; return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t }; }
function mapBase() { if (MAP.base || !RD) return MAP.base; const T = RD.terrain, H = terrainFn(T), W = T.nx, Hh = T.ny, c = document.createElement('canvas'); c.width = W; c.height = Hh;
  const g = c.getContext('2d'), im = g.createImageData(W, Hh);
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) { const x = T.x0 + i * T.step, y = T.y0 + j * T.step, h = H(x, y), dx = H(x + T.step, y) - H(x - T.step, y), dy = H(x, y + T.step) - H(x, y - T.step);
    const shade = Math.max(0.55, Math.min(1.25, 1 + (-dx * 0.7 + dy * 0.7) / (2 * T.step) * 2.2)), o = ((Hh - 1 - j) * W + i) * 4;
    let r, gg, b; if (h <= 0.2) { r = 150; gg = 196; b = 224; } else { const k = Math.min(1, h / 80); r = 196 - 60 * k; gg = 214 - 50 * k; b = 168 - 50 * k; }
    im.data[o] = r * shade; im.data[o + 1] = gg * shade; im.data[o + 2] = b * shade; im.data[o + 3] = 255; }
  g.putImageData(im, 0, 0); MAP.base = c; return c; }
/* route line coloured by grade (green down .. grey flat .. orange up .. red too steep) */
function mapRoute(g, P, w = 4, plain = null) { g.lineWidth = w; g.lineCap = 'round'; const col = (gr) => gr < -0.035 ? '#3b8f6a' : gr < -0.01 ? '#6cbfb0' : gr <= 0.01 ? '#888' : gr <= Math.tan(6 * Math.PI / 180) ? '#d08a3c' : '#c4512f';
  for (let s = 0; s < track.total - 2; s += 2) { const a = track.at(s).p, b = track.at(s + 2).p; g.strokeStyle = plain || col(track.at(s + 1).grade); g.globalAlpha = plain ? 0.9 : s < rider.s ? 0.45 : 1; g.beginPath(); g.moveTo(...P(a.x, a.z)); g.lineTo(...P(b.x, b.z)); g.stroke(); }
  g.globalAlpha = 1; }
function mapCoast(g, P, thin = false) { for (const c of RD.coast || []) { g.strokeStyle = thin ? (c.kind === 'cliff' ? '#ff9a3c' : '#ffe14a') : c.kind === 'cliff' ? '#8a6a4a' : '#e8d6a0'; g.lineWidth = thin ? 1.4 : c.kind === 'cliff' ? 2 : 1.5;
  g.beginPath(); c.line.forEach(([x, y], i) => { const [a, b2] = P(x, -y); i ? g.lineTo(a, b2) : g.moveTo(a, b2); }); g.stroke(); } }
function mapOurs2D(g, P, sc, Wc, Hc) { g.fillStyle = '#96c4e0'; g.fillRect(0, 0, Wc, Hc); if (!RD) return;
  const T = RD.terrain, b = mapBase(); const [x0, y0] = P(T.x0, -(T.y0 + (T.ny - 1) * T.step)); g.imageSmoothingEnabled = true; g.drawImage(b, x0, y0, (T.nx - 1) * T.step * sc, (T.ny - 1) * T.step * sc);
  if (STRD) { const SC = ['#8d8f92', '#9a9c9e', '#7f9a74', '#d6d0c4', '#d2d0ca', '#c9c5bb'];   /* OSM streets / car parks / courts / plazas / footpaths */
    for (const p of STRD.p) { g.fillStyle = SC[p[0]] || '#999'; g.beginPath();
      for (const r of p.slice(1)) { let x = 0, y = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; const [a, c] = P(x / 10, -y / 10); i ? g.lineTo(a, c) : g.moveTo(a, c); } g.closePath(); }
      g.fill('evenodd'); } }
  g.fillStyle = 'rgba(214,196,170,.95)'; g.strokeStyle = 'rgba(120,100,80,.6)'; g.lineWidth = 0.6;
  for (const bd of window.__bld ? window.__bld.list : RD.buildings || []) { g.beginPath(); (bd.P || bd.poly).forEach(([x, y], i) => { const [a, c] = P(x, -y); i ? g.lineTo(a, c) : g.moveTo(a, c); }); g.closePath(); g.fill(); g.stroke(); }
  mapCoast(g, P); mapRoute(g, P); }
/* the actual 3D scene seen straight down (orthographic, north up, same centre/scale); re-rendered when the view settles,
   the last render is reused (shifted/scaled) while dragging */
function map3DRender(Wc, Hc) { const cam = MAP.ocam || (MAP.ocam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 3000)), hw = Wc / 2 / MAP.z, hh = Hc / 2 / MAP.z;
  cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh; cam.position.set(MAP.cx, 520, MAP.cy); cam.up.set(0, 0, -1); cam.lookAt(MAP.cx, 0, MAP.cy); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  const fog = scene.fog, bh = BLD.gpu ? BLD.gpu.uHide.value : 0; scene.fog = null; if (BLD.gpu) BLD.gpu.uHide.value = 0; renderer.render(scene, cam); scene.fog = fog; if (BLD.gpu) BLD.gpu.uHide.value = bh;
  const d = devicePixelRatio || 1, c = MAP.c3 || (MAP.c3 = document.createElement('canvas')); c.width = Wc * d; c.height = Hc * d; c.getContext('2d').drawImage(renderer.domElement, 0, 0, c.width, c.height);
  MAP.v3 = { cx: MAP.cx, cy: MAP.cy, z: MAP.z, W: Wc, H: Hc }; MAP.t3 = performance.now(); }
function mapOurs3D(g, P, sc, Wc, Hc) { const v = MAP.v3, fresh = v && v.cx === MAP.cx && v.cy === MAP.cy && v.z === MAP.z && v.W === Wc && v.H === Hc;
  if (!fresh && (!MAP.drag || !v)) { map3DRender(Wc, Hc); }
  else if (!fresh) { clearTimeout(MAP.t3h); MAP.t3h = setTimeout(() => { if (MAP.on) drawMap(); }, 180); }
  else if (MAP.follow && performance.now() - MAP.t3 > 1000) map3DRender(Wc, Hc);
  const u = MAP.v3; g.fillStyle = '#7fa9c4'; g.fillRect(0, 0, Wc, Hc); const [x0, y0] = P(u.cx - u.W / 2 / u.z, u.cy - u.H / 2 / u.z); g.drawImage(MAP.c3, x0, y0, u.W / u.z * sc, u.H / u.z * sc); }
/* web-mercator tiles placed through the same lat/lon <-> local metres projection (piecewise per tile, < 1 cm error) */
function mapSat(g, P, sc, Wc, Hc, ox, oy) { const S = SAT[MAP.src], M = MPROJ, d = devicePixelRatio || 1; g.fillStyle = '#3b4a52'; g.fillRect(0, 0, Wc, Hc); if (!M) return;
  const z = Math.max(10, Math.min(S.max, Math.round(Math.log2(156543.034 * Math.cos(M.lat0 * Math.PI / 180) * sc * d)))), n = 2 ** z;
  const lonOf = (X) => M.lon0 + X / M.kx, latOf = (Z) => M.lat0 - Z / M.ky;
  const tx = (lon) => (lon + 180) / 360 * n, ty = (lat) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n;
  const lonT = (x) => x / n * 360 - 180, latT = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
  const X0 = -ox / sc, X1 = (Wc - ox) / sc, Z0 = -oy / sc, Z1 = (Hc - oy) / sc;
  const i0 = Math.floor(tx(lonOf(X0))), i1 = Math.floor(tx(lonOf(X1))), j0 = Math.floor(ty(latOf(Z0))), j1 = Math.floor(ty(latOf(Z1)));
  const get = (zz, x, y) => { const k = MAP.src + '/' + zz + '/' + y + '/' + x; let t = MAP.tiles.get(k);
    if (!t) { if (MAP.tiles.size > 400) MAP.tiles.delete(MAP.tiles.keys().next().value); t = new Image(); t.crossOrigin = 'anonymous'; t.onload = () => { t.ok = true; if (MAP.on) drawMap(); }; t.src = S.url(zz, y, x); MAP.tiles.set(k, t); }
    return t; };
  const peek = (zz, x, y) => MAP.tiles.get(MAP.src + '/' + zz + '/' + y + '/' + x);
  g.imageSmoothingEnabled = true;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { if (j1 - j0 > 24 || i1 - i0 > 24) break;
    const [ax, ay] = P((lonT(i) - M.lon0) * M.kx, -(latT(j) - M.lat0) * M.ky), [bx, by] = P((lonT(i + 1) - M.lon0) * M.kx, -(latT(j + 1) - M.lat0) * M.ky);
    const t = get(z, i, j); if (t.ok) { g.drawImage(t, ax, ay, bx - ax + 0.5, by - ay + 0.5); continue; }
    /* placeholder: crop of an already-loaded parent tile */
    for (let up = 1; up <= 5; up++) { const f = 2 ** up, p = peek(z - up, Math.floor(i / f), Math.floor(j / f)); if (p && p.ok) { const s = 256 / f; g.drawImage(p, (i % f) * s, (j % f) * s, s, s, ax, ay, bx - ax + 0.5, by - ay + 0.5); break; } } }
  MAP.satZ = z; }
function drawMap() { const cv = $('mapC'), d = devicePixelRatio || 1; cv.width = cv.clientWidth * d; cv.height = cv.clientHeight * d; const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
  const Wc = cv.clientWidth, Hc = cv.clientHeight, pos = track.at(rider.s).p, sc = MAP.z, ox = Wc / 2 - (MAP.cx) * sc, oy = Hc / 2 - (MAP.cy) * sc;
  /* world X east, world Z south (-north) */
  const P = (X, Z) => [ox + X * sc, oy + Z * sc];
  const left = (MAP.mode === 'o3d' || (MAP.mode === 'cmp' && MAP.left === 'o3d')) ? mapOurs3D : mapOurs2D;
  if (MAP.mode === 'sat') { mapSat(g, P, sc, Wc, Hc, ox, oy); if (MAP.lines && RD) { mapCoast(g, P, true); mapRoute(g, P, 1.6, '#ff3df0'); } }
  else if (MAP.mode === 'cmp') { const sx = Math.round(Wc * MAP.split); left(g, P, sc, Wc, Hc);
    g.save(); g.beginPath(); g.rect(sx, 0, Wc - sx, Hc); g.clip(); mapSat(g, P, sc, Wc, Hc, ox, oy); if (MAP.lines && RD) { mapCoast(g, P, true); mapRoute(g, P, 1.6, '#ff3df0'); } g.restore();
    g.fillStyle = '#fff'; g.fillRect(sx - 1.5, 0, 3, Hc); g.beginPath(); g.arc(sx, Hc / 2, 15, 0, Math.PI * 2); g.fill(); g.fillStyle = '#3d3630'; g.font = '600 13px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('⇆', sx, Hc / 2 + 1); }
  else left(g, P, sc, Wc, Hc);
  /* her: dot + heading */
  const [hx, hy] = P(pos.x, pos.z), dir = track.at(rider.s).dir; g.fillStyle = '#ff5a8a'; g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.beginPath(); g.arc(hx, hy, 7, 0, Math.PI * 2); g.fill(); g.stroke();
  g.strokeStyle = '#ff5a8a'; g.lineWidth = 3; g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + dir.x * 20, hy + dir.z * 20); g.stroke();
  /* scale bar */
  { const m = [5, 10, 20, 50, 100, 200, 500, 1000].find((v) => v * sc > 60) || 1000; g.fillStyle = 'rgba(255,250,240,.85)'; g.fillRect(8, Hc - 54, m * sc + 16, 20); g.fillStyle = '#3d3630'; g.fillRect(16, Hc - 42, m * sc, 3); g.font = '600 10px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(m + ' m', 18, Hc - 45); }
  const ll = routeLatLon(rider.s); $('mapInfo').textContent = `${rider.s.toFixed(0)}/${track.total.toFixed(0)} m` + (ll ? ` · ${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)}` : ' · 练习场');
  if (ll) { $('mapG').href = `https://www.google.com/maps/@${ll.lat},${ll.lon},19z`; $('mapE').href = `https://earth.google.com/web/@${ll.lat},${ll.lon},40a,300d,35y,0h,60t,0r`; }
  $('mapG').style.display = $('mapE').style.display = ll ? '' : 'none';
  const satOn = MAP.mode === 'sat' || MAP.mode === 'cmp'; $('mapAttr').textContent = satOn ? SAT[MAP.src].attr + ' · 仅供目视对比' : (MAP.mode === 'o3d' || (MAP.mode === 'cmp' && MAP.left === 'o3d')) ? '我们的 3D 场景俯视' : '我们的烘焙数据';
  document.querySelectorAll('#map [data-mm]').forEach((b) => b.classList.toggle('on', b.dataset.mm === MAP.mode || (MAP.mode === 'cmp' && b.dataset.mm === MAP.left)));
  $('mapSrc').textContent = MAP.src === 'nsw' ? 'NSW 航拍' : 'Esri'; $('mapSrc').style.display = $('mapLn').style.display = satOn ? '' : 'none'; $('mapLn').classList.toggle('on', MAP.lines); }
function mapLoop() { if (!MAP.on) return; if (MAP.follow) { const p = track.at(rider.s).p; MAP.cx = p.x; MAP.cy = p.z; } drawMap(); setTimeout(() => requestAnimationFrame(mapLoop), 200); }
$('mapBtn').onclick = (e) => { e.stopPropagation(); MAP.on = !MAP.on; $('map').classList.toggle('on', MAP.on); $('mapBtn').classList.toggle('on', MAP.on); if (MAP.on) { MAP.follow = true; mapLoop(); } };
$('mapX').onclick = (e) => { e.stopPropagation(); MAP.on = false; $('map').classList.remove('on'); $('mapBtn').classList.remove('on'); };
document.querySelectorAll('#map [data-mm]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); const m = b.dataset.mm;
  if (m === 'ours' || m === 'o3d') { MAP.left = m; if (MAP.mode !== 'cmp') MAP.mode = m; } else if (m === 'cmp') MAP.mode = MAP.mode === 'cmp' ? MAP.left : 'cmp'; else MAP.mode = 'sat';
  MAP.v3 = null; drawMap(); });
window.__MAP = MAP; window.__drawMap = drawMap; window.__mapProj = MPROJ;
$('mapSrc').onclick = (e) => { e.stopPropagation(); MAP.src = MAP.src === 'nsw' ? 'esri' : 'nsw'; drawMap(); };
$('mapLn').onclick = (e) => { e.stopPropagation(); MAP.lines = !MAP.lines; drawMap(); };
{ const mp = new Map(); const cv = $('mapC');
  cv.addEventListener('pointerdown', (e) => { mp.set(e.pointerId, { x: e.clientX, y: e.clientY }); cv.setPointerCapture(e.pointerId); MAP.drag = true;
    const r = cv.getBoundingClientRect(); MAP.splitDrag = MAP.mode === 'cmp' && mp.size === 1 && Math.abs(e.clientX - r.left - r.width * MAP.split) < 24; });
  cv.addEventListener('pointermove', (e) => { const p = mp.get(e.pointerId); if (!p) return;
    if (MAP.splitDrag && mp.size === 1) { const r = cv.getBoundingClientRect(); MAP.split = Math.min(0.97, Math.max(0.03, (e.clientX - r.left) / r.width)); }
    else if (mp.size === 1) { MAP.follow = false; MAP.cx -= (e.clientX - p.x) / MAP.z; MAP.cy -= (e.clientY - p.y) / MAP.z; }
    else if (mp.size === 2) { const [a, b] = [...mp.values()], d0 = Math.hypot(a.x - b.x, a.y - b.y); p.x = e.clientX; p.y = e.clientY; const [c, f] = [...mp.values()], d1 = Math.hypot(c.x - f.x, c.y - f.y); if (d0 > 0) MAP.z = Math.min(16, Math.max(0.15, MAP.z * d1 / d0)); }
    p.x = e.clientX; p.y = e.clientY; drawMap(); });
  const up = (e) => { mp.delete(e.pointerId); if (!mp.size) { MAP.drag = false; MAP.splitDrag = false; drawMap(); } }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => { e.preventDefault(); MAP.z = Math.min(16, Math.max(0.15, MAP.z * Math.exp(-e.deltaY * 0.0015))); drawMap(); }, { passive: false });
  cv.addEventListener('dblclick', () => { MAP.follow = true; }); }
/* pause / resume (Cheney): freezes the simulation; camera still orbits so you can look around */
const setPause = (p) => { paused = p; $('pause').textContent = p ? '▶' : '⏸'; $('pause').classList.toggle('on', p); };
$('pause').onclick = (e) => { e.stopPropagation(); setPause(!paused); };
$('restart2').onclick = (e) => { e.stopPropagation(); restart(); setPause(false); };
addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); setPause(!paused); } });
// debug switch: hides everything except the stamina bar (and the switch itself)
const setDbg = (on) => { document.body.classList.toggle('nodbg', !on); $('dbg').classList.toggle('on', on); localStorage.sw_dbg = on ? '1' : '0'; };
setDbg(Q.has('debug') ? Q.get('debug') !== '0' : localStorage.sw_dbg !== '0');
$('dbg').onclick = () => setDbg(document.body.classList.contains('nodbg'));
// ---- music: the old demo's procedural soundtrack (soft waves + Cmaj7-Am7-Fmaj7-G6 fingerpicking, ~66 bpm)
let AC = null, master;
function pluck(freq, t, vol = .12, dur = 2.2) {
  const o = AC.createOscillator(), o2 = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter();
  o.type = 'triangle'; o.frequency.value = freq; o2.type = 'sine'; o2.frequency.value = freq * 2.001;
  f.type = 'lowpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(500, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .006); g.gain.exponentialRampToValueAtTime(.0005, t + dur);
  o.connect(f); o2.connect(f); f.connect(g); g.connect(master); o.start(t); o2.start(t); o.stop(t + dur); o2.stop(t + dur);
}
function music() {
  const N = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const prog = [[48, 55, 64, 71, 67], [45, 52, 60, 67, 64], [41, 48, 57, 64, 60], [43, 50, 59, 64, 62]];
  const beat = 60 / 66 / 2; let bar = 0;
  const loop = () => { if (!AC) return; const t0 = AC.currentTime + .1, ch = prog[bar % 4]; [0, 2, 3, 4, 1, 3, 2, 4].forEach((k, i) => { if (Math.random() < .9) pluck(N(ch[k]), t0 + i * beat + Math.random() * .02, k ? .06 : .1, 2.6); }); bar++; setTimeout(loop, beat * 8 * 1000); };
  loop();
}
function startAudio() {
  AC = new AudioContext(); master = AC.createGain(); master.gain.value = .6; master.connect(AC.destination);
  const len = AC.sampleRate * 4, buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0); let b = 0;
  for (let i = 0; i < len; i++) { b = (b + .02 * (Math.random() * 2 - 1)) / 1.02; d[i] = b * 3.5; }
  const src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
  const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
  const gw = AC.createGain(); gw.gain.value = .25; const lfo = AC.createOscillator(); lfo.frequency.value = .11; const lg = AC.createGain(); lg.gain.value = .18;
  lfo.connect(lg); lg.connect(gw.gain); src.connect(f); f.connect(gw); gw.connect(master); src.start(); lfo.start();
  music();
  /* SPEED SOUNDS (Cheney): wind rush around her ears and the wheels' roll, both driven by speed every frame (sndTick).
     wind: band-passed noise, louder + brighter with airspeed (her speed + real wind); wheels: low rumble whose pitch/level
     follow speed, plus a soft click at each concrete expansion joint (every 2.4 m). */
  const nb = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const mk = () => { const s = AC.createBufferSource(); s.buffer = nb; s.loop = true; s.start(); return s; };
  const wf = AC.createBiquadFilter(); wf.type = 'bandpass'; wf.Q.value = 0.6; const wg = AC.createGain(); wg.gain.value = 0; mk().connect(wf); wf.connect(wg); wg.connect(master);
  const rf = AC.createBiquadFilter(); rf.type = 'lowpass'; rf.Q.value = 3; const rg = AC.createGain(); rg.gain.value = 0; mk().connect(rf); rf.connect(rg); rg.connect(master);
  SND = { wf, wg, rf, rg, lastJ: 0 };
}
let SND = null;
function sndTick() { if (!SND || !AC || AC.state !== 'running' || !rider) return; const t = AC.currentTime, v = rider.v, on = rider.mode === 'ride' ? 1 : 0;
  const air = rider.airRel ? rider.airRel.length() : v, a = Math.min(1, air / 9);
  SND.wg.gain.setTargetAtTime(0.02 + 0.22 * a * a, t, 0.15); SND.wf.frequency.setTargetAtTime(300 + 1500 * a, t, 0.2);
  const rv = Math.min(1, v / 8) * on; SND.rg.gain.setTargetAtTime(0.18 * rv, t, 0.08); SND.rf.frequency.setTargetAtTime(90 + 260 * rv, t, 0.1);
  const j = Math.floor(rider.s / 2.4); if (on && j !== SND.lastJ && v > 1.5) { const o = AC.createOscillator(), g = AC.createGain(); o.type = 'square'; o.frequency.value = 70 + 40 * Math.random();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 * Math.min(1, v / 6), t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.06);
    setTimeout(() => { if (!AC) return; const t2 = AC.currentTime, o2 = AC.createOscillator(), g2 = AC.createGain(); o2.type = 'square'; o2.frequency.value = 65; g2.gain.setValueAtTime(0.0001, t2); g2.gain.exponentialRampToValueAtTime(0.04 * Math.min(1, v / 6), t2 + 0.004); g2.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.05); o2.connect(g2); g2.connect(master); o2.start(t2); o2.stop(t2 + 0.06); }, 0.8 / Math.max(v, 0.5) * 1000); }   /* front then back trucks over the joint */
  SND.lastJ = j; }
const sndUI = () => { $('snd').textContent = AC && AC.state === 'running' ? '🔊' : '🔇'; };
$('snd').onclick = (e) => { e.stopPropagation(); if (!AC) startAudio(); else if (AC.state === 'running') AC.suspend(); else AC.resume(); setTimeout(sndUI, 50); };
if (!REC) addEventListener('pointerdown', function first() { removeEventListener('pointerdown', first); if (!AC) { startAudio(); setTimeout(sndUI, 50); } }, { once: true });   // browsers need a tap before audio
const TODS = ['real', 'noon', 'golden'], TODL = { real: '🕒 实时', noon: '☀️ 正午', golden: '🌅 夕阳' };
$('tod').textContent = TODL[TOD] || TOD; $('tod').onclick = () => { TOD = TODS[(TODS.indexOf(TOD) + 1) % 3]; $('tod').textContent = TODL[TOD]; };
$('slow').onclick = () => { slow = slow === 1 ? 0.35 : 1; $('slow').classList.toggle('on', slow !== 1); };
// 360° orbit: drag to spin around her (any angle), pinch / wheel to zoom; double-tap to go back behind her
const ptrs = new Map();
$('c').addEventListener('pointerdown', (e) => { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (camMode !== 'orbit') { camMode = 'orbit'; camInit = false; document.querySelectorAll('[data-cam]').forEach((x) => x.classList.toggle('on', x.dataset.cam === 'orbit')); } });
addEventListener('pointermove', (e) => {
  const p = ptrs.get(e.pointerId); if (!p) return;
  if (ptrs.size === 1) { orbit.yaw -= (e.clientX - p.x) * 0.008; orbit.pitch = Math.max(-0.5, Math.min(1.2, orbit.pitch + (e.clientY - p.y) * 0.006)); }
  else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d0 = Math.hypot(a.x - b.x, a.y - b.y); p.x = e.clientX; p.y = e.clientY; const [c, d] = [...ptrs.values()]; const d1 = Math.hypot(c.x - d.x, c.y - d.y); orbit.dist = Math.max(1.2, Math.min(9, orbit.dist * d0 / (d1 || d0))); return; }
  p.x = e.clientX; p.y = e.clientY;
});
const endPtr = (e) => ptrs.delete(e.pointerId); addEventListener('pointerup', endPtr); addEventListener('pointercancel', endPtr);
addEventListener('wheel', (e) => { if (camMode === 'orbit') orbit.dist = Math.max(1.2, Math.min(9, orbit.dist * Math.exp(e.deltaY * 0.001))); }, { passive: true });
let lastTap = 0; $('c').addEventListener('pointerup', () => { const n = performance.now(); if (n - lastTap < 300) { orbit.yaw = Math.PI; orbit.pitch = 0.18; orbit.dist = 3.2; } lastTap = n; });
let hideT; addEventListener('pointerdown', () => { $('ui').style.opacity = 1; clearTimeout(hideT); hideT = setTimeout(() => $('ui').style.opacity = 0.25, 6000); });

// deterministic recording hooks
window.LAB = {
  scene, THREE, rider: () => rider, hairState: () => hair.state, setWind: (v) => { LAB_WIND.v = v; }, track, skirt: () => skirt, skirt2: () => skirt2, vrm: () => vrm, camera,
  drone: () => drone, ref: () => REFV,
  setCam(m) { camMode = m; camInit = false; anc.init = false; anc.y = undefined; anc.vr = undefined; },
  orbit(y, p, d) { camMode = 'orbit'; camInit = false; orbit.yaw = y; orbit.pitch = p ?? orbit.pitch; orbit.dist = d ?? orbit.dist; },
  setTod(x) { TOD = x; },
  light(o) { Object.assign(LT, o || {}); girlShading.key = null; return LT; },
  restart, jumpTo(s) { restart(); for (let i = 0; i < 4000 && rider.s < s; i++) step(1 / 30); },
  // advance n frames at fps then render; returns state
  adv(n = 1, fps = 30) { const t0 = performance.now(); for (let i = 0; i < n; i++) step(1 / fps); return { s: rider.s, v: rider.v, cap: $('cap').innerText, ms: (performance.now() - t0) / n }; },
  runTo(s, budget = 120000) { const t0 = performance.now(); while (rider.s < s && performance.now() - t0 < budget) step(1 / 30); return { s: rider.s, done: rider.s >= s }; },
  prof() { const r = {}; let t0 = performance.now(); for (let i = 0; i < 10; i++) rider.update(1 / 30, (s) => track.at(s), ctx); r.rider = (performance.now() - t0) / 10; t0 = performance.now(); for (let i = 0; i < 10; i++) skirt.step(1 / 30, windNow, simT); r.skirt = (performance.now() - t0) / 10; t0 = performance.now(); renderer.render(scene, camera); r.render = performance.now() - t0; return r; },
  shot(q = 0.82) { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', q); },
  events: () => rider.ev, setDbg, stam(v) { rider.stam = v; },
  mount(n = 27) { const r = rider; r.board.updateMatrixWorld(true); r.grab(r.board.position.clone(), r.board.quaternion.clone(), new THREE.Vector3(-0.117, 0.118, 0), 0.3); r.toWalk(); r.v = 1.3; r.push = r.pump = r.ollie = r.dance = null; for (let i = 0; i < n; i++) step(1 / 30); r.startOn(); },   /* throwdown on demand (probes/demo) */
};
