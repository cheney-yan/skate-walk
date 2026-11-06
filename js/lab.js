import * as THREE from 'three';
import { loadGirl, setupHair, Skirt } from './girl.js';
import { Rider } from './rider.js';

const Q = new URLSearchParams(location.search);
const REC = Q.has('rec');
if (REC) document.body.classList.add('rec');
const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------- test track ----------------
// [length, kappa, grade, label, wind: null | 'left' | 'right' | 'front']
const SEG = [
  [18, 0, 0, '站直滑行'], [9, 0.26, 0, '压弯转向'], [9, -0.26, 0, '压弯转向'], [9, 0.26, 0, '压弯转向'], [6, 0, 0, ''],
  [20, 0, 0, '前面有坑'], [40, 0.015, -0.07, '下坡'], [12, 0, 0, ''], [32, 0, 0.06, '上坡'],
  [24, 0, 0, '左边来风', 'left'], [24, 0, 0, '右边来风', 'right'], [24, 0, 0, '迎面来风', 'front'], [33, -0.02, 0, '回头看你一眼'],
];
const HOLES = [60, 240];
const LOOKS = [13, 226];
const DS = 0.25;
const track = (() => {
  const pts = []; let s = 0, x = 0, y = 0, z = 0, yaw = 0;
  const segAt = (s) => { let a = 0; for (const g of SEG) { if (s < a + g[0]) return { g, a }; a += g[0]; } return { g: SEG[SEG.length - 1], a: a - SEG[SEG.length - 1][0] }; };
  const total = SEG.reduce((a, g) => a + g[0], 0);
  // smoothed kappa/grade (4 m blend between segments)
  const raw = (s, k) => segAt(s).g[k];
  const smooth = (s, k) => { let acc = 0, n = 0; for (let d = -3; d <= 3; d += 0.5) { acc += raw(clamp(s + d, 0, total - 0.01), k); n++; } return acc / n; };
  while (s <= total + 20) {
    const kap = smooth(Math.min(s, total - 0.01), 1), gr = smooth(Math.min(s, total - 0.01), 2);
    pts.push({ s, x, y, z, yaw, kap, gr });
    yaw += kap * DS; x += Math.sin(yaw) * DS; z += Math.cos(yaw) * DS; y += gr * DS; s += DS;
  }
  const at = (s) => {
    const f = clamp(s / DS, 0, pts.length - 2), i = Math.floor(f), u = f - i, a = pts[i], b = pts[i + 1];
    const yaw = a.yaw + (b.yaw - a.yaw) * u;
    return { p: new THREE.Vector3(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u), dir: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), yaw, grade: a.gr + (b.gr - a.gr) * u, kappa: a.kap + (b.kap - a.kap) * u };
  };
  return { pts, at, total, segAt };
})();
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
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#d6ebf5', 40, 260);
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 1500);
scene.add(new THREE.HemisphereLight('#e4f3ff', '#c9b892', 1.35));
const sun = new THREE.DirectionalLight('#fff3dc', 2.4);
sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 30 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
// sky
{
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 p;void main(){p=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 p;float h(vec2 q){return fract(sin(dot(q,vec2(127.1,311.7)))*43758.5);}
    float n(vec2 q){vec2 i=floor(q),f=fract(q);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
    float fbm(vec2 q){float s=0.,a=.5;for(int k=0;k<5;k++){s+=a*n(q);q*=2.03;a*=.5;}return s;}
    void main(){float y=max(p.y,0.);vec3 c=mix(vec3(.85,.93,.97),vec3(.33,.6,.88),pow(y,.5));
    vec2 q=p.xz/(p.y+.15)*1.3;float cl=smoothstep(.5,.78,fbm(q+2.));c=mix(c,vec3(1.),cl*smoothstep(.03,.2,p.y)*.95);gl_FragColor=vec4(c,1.);}` });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), m));
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
ribbon(1.6, 40, -0.03, '#93bd6c');
ribbon(-1.6, -12, -0.03, '#e8d6a6');      // sand on the right
{ // sea
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: '#3f9fc2', roughness: 0.25, metalness: 0.1 }));
  m.rotation.x = -Math.PI / 2; m.position.y = -6; scene.add(m);
}
// trees + flags along the left verge
const flags = [];
{
  const trunk = new THREE.MeshStandardMaterial({ color: '#8a6a4a' }), leaf = new THREE.MeshStandardMaterial({ color: '#6fa25a', roughness: 1 });
  for (let s = 6; s < track.total; s += 9 + (s * 7 % 5)) {
    const p = track.at(s), l = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw)), off = 4 + (s * 13 % 7);
    const t = new THREE.Group(); t.position.copy(p.p).addScaledVector(l, off);
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 2.2, 8), trunk); tr.position.y = 1.1; t.add(tr);
    for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 - k * 0.15, 1), leaf); b.position.set((k - 1) * 0.5, 2.6 + k * 0.4, (k % 2) * 0.4); t.add(b); }
    t.traverse((o) => { if (o.isMesh) { o.castShadow = true; } }); scene.add(t);
  }
  // little pennant flags on poles at the wind segments (show wind direction)
  const pole = new THREE.MeshStandardMaterial({ color: '#f4f4f4' });
  for (const s of [150, 162, 174, 186, 198, 210, 222]) {
    const p = track.at(s), l = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const g = new THREE.Group(); g.position.copy(p.p).addScaledVector(l, 2.3);
    const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.4, 6), pole); pl.position.y = 1.2; g.add(pl);
    const fgeo = new THREE.PlaneGeometry(0.7, 0.35, 8, 1); fgeo.translate(0.35, 0, 0);
    const f = new THREE.Mesh(fgeo, new THREE.MeshStandardMaterial({ color: '#ff8a5c', side: THREE.DoubleSide })); f.position.y = 2.2; g.add(f);
    scene.add(g); flags.push({ f, base: fgeo.attributes.position.array.slice() });
  }
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
let vrm, rider, skirt, hair;
const ctx = { holes: HOLES, cruise: 3.5, vmax: 6.0, wind: new THREE.Vector3(), lookEvery: 999, camera };
async function init() {
  vrm = await loadGirl('./models/girl.vrm');
  scene.add(vrm.scene);                 // temporarily at identity to build the skirt in model space
  vrm.scene.updateMatrixWorld(true);
  skirt = new Skirt(vrm, scene, { top: 0.985, hem: 0.47, rows: 14, cols: 32, flare: 0.62 });
  rider = new Rider(vrm, scene);
  rider.groundFn = (x, z) => { const c = Math.round(rider.s / DS); let best = 1e9, y = 0; for (let i = Math.max(0, c - 30); i < Math.min(track.pts.length, c + 30); i++) { const p = track.pts[i], d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < best) { best = d; y = p.y; } } return y; };
  hair = setupHair(vrm);
  restart();
  $('load').style.display = 'none';
}
let windNow = new THREE.Vector3(), lookIdx = 0, simT = 0;
function restart() {
  rider.s = 0; rider.v = 0; rider.t = 0; rider.push = null; rider.ollie = null; rider.air = 0; rider.look = null; rider.nextLook = 1e9; rider.ev.length = 0;
  lookIdx = 0; simT = 0; windNow.set(0, 0, 0); camInit = false;
  rider.update(1 / 60, (s) => track.at(s), ctx);
  skirt.inited = false; vrm.springBoneManager?.reset?.();
}
function windTarget(s) {
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
  if (r.ollie) a = 'Ollie 跳过坑';
  else if (r.look) a = '回头看你一眼';
  else if (r.hairHand) a = '风大，拢一下头发';
  else if (r.push) a = g[2] > 0.03 ? '上坡，用力蹬' : '蹬地';
  else if (r.w.tuck > 0.4) a = '下坡，压低重心';
  else if (Math.abs(r.lean) > 0.06) a = `压弯 ${r.lean > 0 ? '向左' : '向右'}（侧倾 ${Math.round(Math.abs(r.lean) * 57.3)}°）`;
  const grade = Math.round(g[2] * 100);
  $('cap').innerHTML = `${a}<small>${(r.v * 3.6).toFixed(1)} km/h · 坡度 ${grade > 0 ? '+' : ''}${grade}% · ${r.s.toFixed(0)}/${track.total} m</small>`;
}

// ---------------- camera ----------------
let camMode = Q.get('cam') || 'chase', camInit = false;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function updateCamera(dt) {
  const p = track.at(rider.s), left = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
  const base = rider.board.position.clone(); base.y -= rider.air * 0.6;
  let want, look;
  if (camMode === 'side') { want = base.clone().addScaledVector(left, 3.6).add(new THREE.Vector3(0, 1.1, 0)).addScaledVector(p.dir, 0.3); look = base.clone().add(new THREE.Vector3(0, 0.85, 0)); }
  else if (camMode === 'front') { want = base.clone().addScaledVector(p.dir, 4.2).addScaledVector(left, 0.9).add(new THREE.Vector3(0, 1.3, 0)); look = base.clone().add(new THREE.Vector3(0, 0.9, 0)); }
  else { const ahead = track.at(rider.s + 2.5).p; const side = -0.55 - 0.7 * (rider.w.look > 0 ? Math.min(1, rider.w.look * 1.6) : 0); want = base.clone().addScaledVector(p.dir, -3.3 + rider.w.look * 0.6).addScaledVector(left, side).add(new THREE.Vector3(0, 1.45 - rider.w.look * 0.15, 0)); look = base.clone().lerp(ahead, 0.35).add(new THREE.Vector3(0, 0.95, 0)); }
  if (!camInit) { camPos.copy(want); camLook.copy(look); camInit = true; }
  const k = 1 - Math.exp(-dt * 4.5);
  camPos.lerp(want, k); camLook.lerp(look, 1 - Math.exp(-dt * 8));
  camera.position.copy(camPos); camera.lookAt(camLook);
  sun.position.copy(base).add(new THREE.Vector3(-6, 12, -4)); sun.target.position.copy(base);
}

// ---------------- loop ----------------
let slow = 1;
function step(dt) {
  simT += dt;
  // events by position
  if (lookIdx < LOOKS.length && rider.s > LOOKS[lookIdx]) { rider.nextLook = 0; lookIdx++; }
  windNow.lerp(windTarget(rider.s), 1 - Math.exp(-dt * 1.2));
  ctx.wind = windNow;
  rider.update(dt, (s) => track.at(s), ctx);
  hair.update(rider.airRel, simT);
  skirt.step(dt, windNow, simT);
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
$('slow').onclick = () => { slow = slow === 1 ? 0.35 : 1; $('slow').classList.toggle('on', slow !== 1); };
let hideT; addEventListener('pointerdown', () => { $('ui').style.opacity = 1; clearTimeout(hideT); hideT = setTimeout(() => $('ui').style.opacity = 0.25, 6000); });

// deterministic recording hooks
window.LAB = {
  rider: () => rider, track, skirt: () => skirt, vrm: () => vrm, camera,
  setCam(m) { camMode = m; camInit = false; },
  restart, jumpTo(s) { restart(); for (let i = 0; i < 4000 && rider.s < s; i++) step(1 / 30); },
  // advance n frames at fps then render; returns state
  adv(n = 1, fps = 30) { const t0 = performance.now(); for (let i = 0; i < n; i++) step(1 / fps); return { s: rider.s, v: rider.v, cap: $('cap').innerText, ms: (performance.now() - t0) / n }; },
  runTo(s, budget = 120000) { const t0 = performance.now(); while (rider.s < s && performance.now() - t0 < budget) step(1 / 30); return { s: rider.s, done: rider.s >= s }; },
  prof() { const r = {}; let t0 = performance.now(); for (let i = 0; i < 10; i++) rider.update(1 / 30, (s) => track.at(s), ctx); r.rider = (performance.now() - t0) / 10; t0 = performance.now(); for (let i = 0; i < 10; i++) skirt.step(1 / 30, windNow, simT); r.skirt = (performance.now() - t0) / 10; t0 = performance.now(); renderer.render(scene, camera); r.render = performance.now() - t0; return r; },
  shot(q = 0.82) { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', q); },
  events: () => rider.ev,
};
