import * as THREE from 'three';
import { loadGirl, setupHair, Skirt, Hat, OUTFIT, addWristGuards } from './girl.js';
import { Rider, EMAX } from './rider.js';

const Q = new URLSearchParams(location.search);
const REC = Q.has('rec');
// ?route=bondi -> ride the real Bondi -> Bronte coastal walk (OSM path + AWS terrain + OSM building blocks)
const RD = Q.get('route') ? await (await fetch('./data/route.json')).json() : null;
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
let TOD = Q.get('tod') || 'golden';
const rimLight = new THREE.DirectionalLight('#ffb978', 0); scene.add(rimLight, rimLight.target);
sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 30 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
// sky
{
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uWarm: { value: 0 }, uSun: { value: new THREE.Vector3(0, 0.2, 1) } },
    vertexShader: 'varying vec3 p;void main(){p=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `uniform float uWarm; uniform vec3 uSun; varying vec3 p;float h(vec2 q){return fract(sin(dot(q,vec2(127.1,311.7)))*43758.5);}
    float n(vec2 q){vec2 i=floor(q),f=fract(q);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
    float fbm(vec2 q){float s=0.,a=.5;for(int k=0;k<5;k++){s+=a*n(q);q*=2.03;a*=.5;}return s;}
    void main(){float y=max(p.y,0.);vec3 c=mix(vec3(.85,.93,.97),vec3(.33,.6,.88),pow(y,.5));
    vec3 warmHor=vec3(1.,.78,.55),warmTop=vec3(.45,.62,.86);vec3 cw=mix(warmHor,warmTop,pow(y,.6));float sd=max(dot(normalize(p),normalize(uSun)),0.);cw+=vec3(1.,.75,.45)*pow(sd,24.)*.9+vec3(1.,.6,.3)*pow(sd,4.)*.25;c=mix(c,cw,uWarm);
    vec2 q=p.xz/(p.y+.15)*1.3;float cl=smoothstep(.5,.78,fbm(q+2.));vec3 cc=mix(vec3(1.),vec3(1.,.86,.72),uWarm);c=mix(c,cc,cl*smoothstep(.03,.2,p.y)*.95);gl_FragColor=vec4(c,1.);}` });
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
{ const r = ribbon(-1.6, 1.6, 0.0, '#ffffff', 0.85); r.material.map = pathTex; r.material.needsUpdate = true; }
if (!RD) { ribbon(1.6, 40, -0.03, '#93bd6c'); ribbon(-1.6, -12, -0.03, '#e8d6a6'); }  // test-track verges      // sand on the right
const seaU = { uT: { value: 0 }, uSun: { value: new THREE.Vector3(0.8, 0.25, 0.2).normalize() }, uSunCol: { value: new THREE.Color('#ffd8a8') }, uSky: { value: new THREE.Color('#bcd9ee') },
  uShore: { value: SHORE?.tex || null }, uSB: { value: new THREE.Vector4(SHORE?.x0 || 0, SHORE?.y0 || 0, SHORE?.w || 1, SHORE?.h || 1) }, uFog: { value: new THREE.Color('#d6ebf5') } };
if (RD) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000, 1, 1), new THREE.ShaderMaterial({ uniforms: seaU, transparent: false,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uT; uniform vec3 uSun, uSunCol, uSky, uFog; uniform sampler2D uShore; uniform vec4 uSB; varying vec3 vW;
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
      vec3 deep = vec3(0.05, 0.27, 0.42), mid = vec3(0.10, 0.45, 0.58), shallow = vec3(0.30, 0.72, 0.70);
      vec3 col = mix(shallow, mid, smoothstep(2., 22., sd)); col = mix(col, deep, smoothstep(25., 70., sd));
      col *= 0.9 + 0.12 * sw;
      // fresnel sky reflection
      float fr = 0.02 + 0.98 * pow(1. - max(dot(N, V), 0.), 5.);
      col = mix(col, mix(uSky, vec3(0.42, 0.62, 0.80), 0.55), clamp(fr, 0., 0.55));
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
      col = mix(col, vec3(0.97, 0.98, 1.), foam * fade);
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
  const PH = new Map();   // spatial hash of path points (8 m cells, with neighbours) for the ground cut
  for (let i = 0; i < track.pts.length; i += 4) { const q = track.pts[i]; const ci = Math.floor(q.x / 8), cj = Math.floor(q.z / 8);
    for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) { const kk = (ci + di) + ',' + (cj + dj); if (!PH.has(kk)) PH.set(kk, []); PH.get(kk).push(q); } }
  const geo = new THREE.PlaneGeometry((T.nx - 1) * T.step, (T.ny - 1) * T.step, T.nx - 1, T.ny - 1); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const cx = T.x0 + (T.nx - 1) * T.step / 2, cy = T.y0 + (T.ny - 1) * T.step / 2;
  const sand = new THREE.Color('#efe2bf'), grass = new THREE.Color('#bfd9a3'), park = new THREE.Color('#a9cf8c'), rock = new THREE.Color('#cfc4b1'), c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k) + cx, y = -pos.getZ(k) + cy; let h = tH(x, y); if (h < 1.3) h = -2.5 + h;
    // the smoothed path runs slightly below crests of the raw terrain: cut the ground away under / beside the path so it never buries the board
    const cell = PH.get(Math.floor(x / 8) + ',' + Math.floor(-y / 8));
    if (cell) { let best = 1e9, py = 0; for (const q of cell) { const d = (q.x - x) ** 2 + (q.z + y) ** 2; if (d < best) { best = d; py = q.y; } } const d = Math.sqrt(best); if (d < 14) h = Math.min(h, py - 0.12 + Math.max(0, d - 2.2) * 0.45); }
    pos.setXYZ(k, x, h, -y);
    const sl = Math.hypot(tH(x + 4, y) - tH(x - 4, y), tH(x, y + 4) - tH(x, y - 4)) / 8;
    if (h < 3.5) c.copy(sand).lerp(grass, clamp((h - 2) / 1.5, 0, 1)); else c.copy(grass).lerp(park, clamp((h - 8) / 40, 0, 1));
    if (sl > 0.55 && h > 0.5) c.lerp(rock, clamp((sl - 0.55) * 2, 0, 1));
    col.set([c.r, c.g, c.b], k * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })); ground.receiveShadow = true; scene.add(ground);
  const skirtG = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ color: '#bfd3a0', roughness: 1 }));   // land beyond the data edge
  skirtG.rotation.x = -Math.PI / 2; skirtG.position.y = -0.5; scene.add(skirtG);
  // buildings: soft off-white blocks, slightly lighter roofs, the way Apple Maps draws a city before photo-3D loads
  const side = new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.95 }), top = new THREE.MeshStandardMaterial({ color: '#fbfaf8', roughness: 0.9 });
  const sideAlt = new THREE.MeshStandardMaterial({ color: '#eef0f3', roughness: 0.95 });
  for (const b of RD.buildings) {
    if (b.poly.length < 4) continue;
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(b.poly.map(([x, y]) => new THREE.Vector2(x, y))), { depth: Math.max(3, b.h), bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, [top, b.poly.length % 3 ? side : sideAlt]); m.position.y = b.base - 0.6; m.castShadow = m.receiveShadow = true; scene.add(m);
    g.computeBoundingSphere(); BLD.push({ m, c: g.boundingSphere.center.clone().add(m.position), r: g.boundingSphere.radius });
  }
}
if (RD) {
  const tH = track.terrainH, polys = RD.buildings.map((b) => b.poly);
  const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
  const spots = []; let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let s = 0; s < track.total; s += 3) {
    const q = track.at(s), l = new THREE.Vector3(Math.cos(q.yaw), 0, -Math.sin(q.yaw));
    for (const sd of [-1, 1]) {
      if (rnd() < 0.55) continue;
      const off = sd * (7 + rnd() * 24), X = q.p.x + l.x * off, Z = q.p.z + l.z * off, x = X, y = -Z, h = tH(x, y);
      if (h < 4) continue;                                    // sand / sea
      const sl = Math.hypot(tH(x + 3, y) - tH(x - 3, y), tH(x, y + 3) - tH(x, y - 3)) / 6; if (sl > 0.5) continue;  // cliffs
      let onPath = false; for (let k = -12; k <= 12 && !onPath; k += 2) { const r = track.at(s + k).p; if ((r.x - X) ** 2 + (r.z - Z) ** 2 < 36) onPath = true; } if (onPath) continue;
      if (polys.some((P) => inPoly(x, y, P))) continue;
      spots.push([X, h - 0.2, Z, 0.7 + rnd() * 0.7, rnd() * 6]);
    }
  }
  const trunkG = new THREE.CylinderGeometry(0.12, 0.18, 2.2, 6); trunkG.translate(0, 1.1, 0);
  const crownG = new THREE.IcosahedronGeometry(1.3, 1); crownG.translate(0, 3.0, 0);
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: '#9a7a5a', roughness: 1 }), spots.length);
  const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color: '#8fbf72', roughness: 1, flatShading: true }), spots.length);
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), cc = new THREE.Color();
  spots.forEach(([x, y, z, s, r], i) => { qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r); m4.compose(new THREE.Vector3(x, y, z), qq, new THREE.Vector3(s, s * (0.9 + (r % 1) * 0.3), s)); trunks.setMatrixAt(i, m4); crowns.setMatrixAt(i, m4); crowns.setColorAt(i, cc.set('#8fbf72').offsetHSL((r % 1) * 0.04 - 0.02, 0, (r % 0.5) * 0.12 - 0.03)); });
  trunks.castShadow = crowns.castShadow = true; scene.add(trunks, crowns);
  window.__trees = spots.length;
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
const ctx = { holes: HOLES, cruise: 3.5, vmax: 6.0, wind: new THREE.Vector3(), lookEvery: RD ? undefined : 999, camera };
async function init() {
  const M = { shino: './models/shino.vrm', sample: './models/girl.vrm', a: './models/cand/AvatarSample_A.vrm', b: './models/sample_b.vrm', vita: './models/cand/Vita.vrm', vic: './models/cand/Victoria_Rubin.vrm' };
  vrm = await loadGirl(M[Q.get('m') || (OUTFIT === 'breeze' ? 'b' : 'shino')] || M.shino);
  scene.add(vrm.scene);                 // temporarily at identity to build the skirt in model space
  vrm.scene.updateMatrixWorld(true);
  const SD = OUTFIT === 'sundress' || OUTFIT === 'shirt';   // reference look: knee-length floral sundress, no hat, hair fully free
  if (OUTFIT === 'shirt') {
    // the open shirt: tails sewn at the ribs, open at the front, flying free over a soft white pleated mini skirt (leggings underneath)
    skirt2 = new Skirt(vrm, scene, { style: 'shirt', pin: 'upperChest', open: 0.62, top: 1.2, hem: 0.66, rows: 16, cols: 34, flare: 0.22, maxSwing: 92, airGain: 1.3, soft: 0.45,
      extraCaps: (w, B, mid, hip, sp) => [[sp, mid.clone().lerp(hip, 0.4), 0.19]] });
  }
  skirt = new Skirt(vrm, scene, OUTFIT === 'shirt' ? { style: 'pleat', top: 0.93, hem: 0.69, rows: 9, cols: 44, flare: 0.95, maxSwing: 84, airGain: 1.1, soft: 0.35 } : SD ? { top: 0.985, hem: 0.5, rows: 14, cols: 40, flare: 0.75, maxSwing: 62, airGain: 0.9 } : { top: 0.985, hem: 0.27, rows: 18, cols: 36, flare: 0.5, maxSwing: 58, airGain: 0.75 });
  if (OUTFIT === 'native' || OUTFIT === 'breeze') skirt.mesh.visible = false;   // the model's own skirt (spring bones) is used instead
  hat = SD || OUTFIT === 'native' || OUTFIT === 'breeze' ? { step() {} } : new Hat(vrm, scene);
  addWristGuards(vrm);
  rider = new Rider(vrm, scene); rider.track = track;
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
let windNow = new THREE.Vector3(), windGust = new THREE.Vector3(), lookIdx = 0, simT = 0;
function restart() {
  rider.s = 0; rider.v = 0; rider.t = 0; rider.push = null; rider.ollie = null; rider.air = 0; rider.look = null; rider.nextLook = RD ? 8 : 1e9; rider.ev.length = 0; rider.mode = 'ride'; rider.dance = null; rider.danceCool = 10; rider.seq = null; rider.m = 0; rider.face = 0; rider.hold = null; rider.boardFixed = false; rider.carry = 0; rider.stam = 0.7; rider.pump = null; rider.lat = 0; rider.slideYaw = 0; rider.bend = 0; rider.armIKw = 0;
  lookIdx = 0; simT = 0; windNow.set(0, 0, 0); camInit = false; anc.init = false; anc.y = undefined; anc.vr = undefined;
  rider.update(1 / 60, (s) => track.at(s), ctx);
  if (!rider.ankleCal) { rider.calibrateFeet(); rider.ankleCal = true; }
  skirt.inited = false; if (skirt2) skirt2.inited = false; vrm.springBoneManager?.reset?.();
}
function windTarget(s) {
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
function stamHUD() {
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
  if (BLD.length) { const a = camera.position, b = rider.board.position.clone().add(new THREE.Vector3(0, 1, 0)), ab = b.clone().sub(a), l2 = ab.lengthSq();
    // hide blocks that sit on the sight line camera -> her -> ~14 m beyond her (they would wall off the view she rides into)
    const far = a.clone().addScaledVector(ab, 1 + 14 / Math.sqrt(l2)), af = far.clone().sub(a), lf = af.lengthSq();
    for (const o of BLD) { const u = clamp(o.c.clone().sub(a).dot(af) / lf, 0, 1), d = o.c.distanceTo(a.clone().addScaledVector(af, u)); o.m.visible = d > o.r * 0.8 + 2; } }
  sunFollow(base);
}
function sunFollow(base) {
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
let slow = 1;
function step(dt) {
  simT += dt; seaU.uT.value = simT;
  // events by position
  if (lookIdx < LOOKS.length && rider.s > LOOKS[lookIdx]) { rider.nextLook = 0; lookIdx++; }
  windNow.lerp(windTarget(rider.s), 1 - Math.exp(-dt * 1.2));
  // gusts: slow swell + occasional puffs, so cloth/hair never settle into a frozen pose
  const gust = 0.5 + 0.5 * Math.sin(simT * 0.37) * Math.sin(simT * 0.83 + 1.1);
  const puff = Math.pow(Math.max(0, Math.sin(simT * 0.21 + 0.4)), 12);
  windGust.copy(windNow).multiplyScalar(0.75 + 0.45 * gust + 0.8 * puff);
  rider.gust = puff;
  ctx.wind = windGust;
  rider.update(dt, (s) => track.at(s), ctx);
  hair.update(rider.airRel, simT);
  const nearBoard = !!rider.hold || rider.mode === 'off' || rider.mode === 'on';
  skirt.setBoard(rider.board, nearBoard); skirt.step(dt, windGust, simT);
  if (skirt2) { skirt2.setBoard(rider.board, nearBoard); skirt2.step(dt, windGust, simT); }
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
  if (rider && !REC) step(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
await init();
requestAnimationFrame(frame);

document.querySelectorAll('[data-cam]').forEach((b) => b.onclick = () => { camMode = b.dataset.cam; camInit = false; document.querySelectorAll('[data-cam]').forEach((x) => x.classList.toggle('on', x === b)); });
$('restart').onclick = restart;
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
}
const sndUI = () => { $('snd').textContent = AC && AC.state === 'running' ? '🔊' : '🔇'; };
$('snd').onclick = (e) => { e.stopPropagation(); if (!AC) startAudio(); else if (AC.state === 'running') AC.suspend(); else AC.resume(); setTimeout(sndUI, 50); };
if (!REC) addEventListener('pointerdown', function first() { removeEventListener('pointerdown', first); if (!AC) { startAudio(); setTimeout(sndUI, 50); } }, { once: true });   // browsers need a tap before audio
$('tod').onclick = () => { TOD = TOD === 'golden' ? 'noon' : 'golden'; $('tod').textContent = TOD === 'golden' ? '☀️ 正午' : '🌅 夕阳'; };
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
  scene, THREE, rider: () => rider, track, skirt: () => skirt, skirt2: () => skirt2, vrm: () => vrm, camera,
  setCam(m) { camMode = m; camInit = false; anc.init = false; anc.y = undefined; anc.vr = undefined; },
  orbit(y, p, d) { camMode = 'orbit'; camInit = false; orbit.yaw = y; orbit.pitch = p ?? orbit.pitch; orbit.dist = d ?? orbit.dist; },
  setTod(x) { TOD = x; },
  restart, jumpTo(s) { restart(); for (let i = 0; i < 4000 && rider.s < s; i++) step(1 / 30); },
  // advance n frames at fps then render; returns state
  adv(n = 1, fps = 30) { const t0 = performance.now(); for (let i = 0; i < n; i++) step(1 / fps); return { s: rider.s, v: rider.v, cap: $('cap').innerText, ms: (performance.now() - t0) / n }; },
  runTo(s, budget = 120000) { const t0 = performance.now(); while (rider.s < s && performance.now() - t0 < budget) step(1 / 30); return { s: rider.s, done: rider.s >= s }; },
  prof() { const r = {}; let t0 = performance.now(); for (let i = 0; i < 10; i++) rider.update(1 / 30, (s) => track.at(s), ctx); r.rider = (performance.now() - t0) / 10; t0 = performance.now(); for (let i = 0; i < 10; i++) skirt.step(1 / 30, windNow, simT); r.skirt = (performance.now() - t0) / 10; t0 = performance.now(); renderer.render(scene, camera); r.render = performance.now() - t0; return r; },
  shot(q = 0.82) { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', q); },
  events: () => rider.ev, setDbg, stam(v) { rider.stam = v; },
};
