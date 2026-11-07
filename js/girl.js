// Avatar: VRM body (pixiv sample, modification allowed) restyled into a white-dress girl:
//  - white stockings painted onto the leg UVs of the body texture
//  - shorts / shoes lightened
//  - a verlet-cloth skirt pinned to the hips that reacts to wind + motion and collides with the legs
//  - long-hair spring bones driven by relative air velocity
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '../vendor/three-vrm.module.min.js';

export const OUTFIT = new URLSearchParams(location.search).get('outfit') || 'shirt';
export async function loadGirl(url) {
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  vrm.userData = { vrm0: vrm.meta?.metaVersion === '0' };
  if (vrm.userData.vrm0) VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((o) => { o.frustumCulled = false; });
  restyle(vrm);
  if (OUTFIT === 'shirt') proportions(vrm);
  return vrm;
}

// longer legs (+6% shin, +4% thigh) — done on the raw skeleton before anything measures the body, so IK, skirt and stance all see the new lengths
function proportions(vrm) {
  const H = vrm.humanoid, K = Number(new URLSearchParams(location.search).get('legs') || 1);
  for (const [n, f] of [['leftLowerLeg', 1.04], ['rightLowerLeg', 1.04], ['leftFoot', 1.06], ['rightFoot', 1.06]]) {
    const b = H.getRawBoneNode(n); if (b) b.position.multiplyScalar(1 + (f - 1) * K);
  }
  vrm.scene.updateMatrixWorld(true);
}
// ---------- texture helpers ----------
function texToCanvas(tex) {
  const img = tex.image, c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}
function canvasTex(c, like) {
  const t = new THREE.CanvasTexture(c);
  t.flipY = like ? like.flipY : false; t.colorSpace = like ? like.colorSpace : THREE.SRGBColorSpace;
  t.wrapS = like ? like.wrapS : THREE.RepeatWrapping; t.wrapT = like ? like.wrapT : THREE.RepeatWrapping;
  t.needsUpdate = true; return t;
}
function lighten(tex, base = 200, k = 0.22, tint = [1, 1, 1]) {
  const c = texToCanvas(tex), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) for (let j = 0; j < 3; j++) p[i + j] = Math.min(255, (base + p[i + j] * k) * tint[j]);
  g.putImageData(d, 0, 0); return canvasTex(c, tex);
}
function paintTris(tex, geom, pick, fill) {
  const c = texToCanvas(tex), g = c.getContext('2d'), W = c.width, H = c.height;
  const pos = geom.attributes.position, uv = geom.attributes.uv, idx = geom.index;
  g.fillStyle = fill; g.strokeStyle = fill; g.lineWidth = 2.5; g.lineJoin = 'round';
  const n = idx ? idx.count : pos.count;
  for (let t = 0; t < n; t += 3) {
    const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, cc = idx ? idx.getX(t + 2) : t + 2;
    const ys = [pos.getY(a), pos.getY(b), pos.getY(cc)];
    const st = pick(ys);
    if (!st) continue;
    if (typeof st === 'string') { g.fillStyle = st; g.strokeStyle = st; } else { g.fillStyle = fill; g.strokeStyle = fill; }
    g.beginPath();
    g.moveTo(uv.getX(a) * W, uv.getY(a) * H); g.lineTo(uv.getX(b) * W, uv.getY(b) * H); g.lineTo(uv.getX(cc) * W, uv.getY(cc) * H);
    g.closePath(); g.fill(); g.stroke();
  }
  return canvasTex(c, tex);
}

// white cotton with pink roses + mint leaves (the reference sundress)
export function floralCanvas(W = 1024, H = 1024, scale = 1, seed = 7) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#fbf8f3'; g.fillRect(0, 0, W, H);
  const N = Math.round(150 * scale * scale);
  const rose = (x, y, r) => {
    const cols = [['#f4a7b4', '#e77f93', '#c95d74'], ['#f7c1c9', '#ef9aaa', '#d77489'], ['#f2b38f', '#e8907a', '#cf6c62']][Math.floor(rnd() * 3)];
    for (let k = 0; k < 3; k++) { // leaves
      const a = rnd() * 6.28; g.fillStyle = rnd() < 0.5 ? '#8fcfbf' : '#6fb7a6';
      g.beginPath(); g.ellipse(x + Math.cos(a) * r * 1.15, y + Math.sin(a) * r * 1.15, r * 0.75, r * 0.32, a, 0, 6.28); g.fill();
    }
    for (let ring = 0; ring < 3; ring++) { const rr = r * (1 - ring * 0.3); g.fillStyle = cols[ring];
      for (let k = 0; k < 6; k++) { const a = k * 1.047 + ring * 0.5 + rnd() * 0.3; g.beginPath(); g.arc(x + Math.cos(a) * rr * 0.45, y + Math.sin(a) * rr * 0.45, rr * 0.55, 0, 6.28); g.fill(); } }
    g.fillStyle = cols[2]; g.beginPath(); g.arc(x, y, r * 0.18, 0, 6.28); g.fill();
  };
  for (let i = 0; i < N; i++) {
    const x = rnd() * W, y = rnd() * H, r = (W / 46) * (0.6 + rnd() * 0.8) / scale;
    if (rnd() < 0.28) { g.fillStyle = rnd() < 0.5 ? '#a9ddd2' : '#f6d0d6'; g.beginPath(); g.arc(x, y, r * 0.3, 0, 6.28); g.fill(); continue; } // tiny buds
    for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) if (Math.abs(dx) + Math.abs(dy) === 0 || x + dx > -r * 2 && x + dx < W + r * 2 && y + dy > -r * 2 && y + dy < H + r * 2) rose(x + dx, y + dy, r);
  }
  return c;
}
function meshesByMat(vrm, key) {
  const out = [];
  vrm.scene.traverse((o) => {
    if (!o.isMesh) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    if (ms.some((m) => (m.name || '').includes(key))) out.push(o);
  });
  return out;
}
function matsByName(vrm, key) {
  const s = new Set();
  vrm.scene.traverse((o) => { if (!o.isMesh) return; (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if ((m.name || '').includes(key)) s.add(m); }); });
  return [...s];
}

export const STOCKING_TOP = 0.80; // metres in bind pose (thigh-high)
function restyle(vrm) {
  if (OUTFIT === 'sundress') return restyleSundress(vrm);
  if (OUTFIT === 'shirt') return restyleShirt(vrm);
  // white stockings: every body triangle fully below the stocking top
  const body = meshesByMat(vrm, 'Body')[0];
  if (body) {
    const pick = (ys) => {
      const hi = Math.max(...ys);
      if (hi < STOCKING_TOP - 0.035) return true;
      if (hi < STOCKING_TOP) return 'rgba(255,255,255,0.97)'; // lace band
      return false;
    };
    for (const m of matsByName(vrm, 'Body')) {
      if (m.map) m.map = paintTris(m.map, body.geometry, pick, 'rgba(250,248,252,0.86)');
      if (m.shadeMultiplyTexture) m.shadeMultiplyTexture = paintTris(m.shadeMultiplyTexture, body.geometry, pick, 'rgba(222,220,236,0.86)');
      m.needsUpdate = true;
    }
  }
  for (const key of ['Bottoms', 'Shoes', 'Tops']) for (const m of matsByName(vrm, key)) {
    const tint = key === 'Shoes' ? [1, 0.97, 0.93] : [1, 1, 1];
    if (key === 'Tops' && m.color) m.color.set('#ffffff');
    if (m.map) m.map = lighten(m.map, key === 'Shoes' ? 185 : 222, 0.2, tint);
    if (m.shadeMultiplyTexture) m.shadeMultiplyTexture = lighten(m.shadeMultiplyTexture, 175, 0.2, tint);
    m.needsUpdate = true;
  }
}

// long pale-blue linen shirt worn loose over a short white pleated skirt; bare legs, white sneakers
function restyleShirt(vrm) {
  const SKIN = [248, 218, 199];
  for (const m of matsByName(vrm, 'Body')) for (const k of ['map', 'shadeMultiplyTexture']) if (m[k]) {   // bare legs (stock texture has black tights)
    const c = texToCanvas(m[k]), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height), p = d.data, W = c.width, H = c.height, sk = k === 'map' ? SKIN : [235, 190, 180];
    for (let y = Math.floor(H * 0.6); y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, lum = (p[i] + p[i + 1] + p[i + 2]) / 3; if (lum < 150) { const f = Math.min(1, (150 - lum) / 60); for (let j = 0; j < 3; j++) p[i + j] = p[i + j] * (1 - f) + sk[j] * f; } }
    // the visible blouse is painted on the BODY texture (white, unsaturated) -> dye it the shirt's pale sky blue
    const blue = k === 'map' ? [150, 194, 236] : [118, 156, 200];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, r0 = p[i], g0 = p[i + 1], b0 = p[i + 2], mx = Math.max(r0, g0, b0), mn = Math.min(r0, g0, b0);
      if (mx > 170 && mx - mn < 22 && b0 >= r0 - 4) { const l = mx / 255; for (let j = 0; j < 3; j++) p[i + j] = blue[j] * (0.75 + 0.25 * l); } }
    g.putImageData(d, 0, 0); m[k] = canvasTex(c, m[k]); m.needsUpdate = true;
  }
  const tint = (m, k, rgb, lo) => { const c = texToCanvas(m[k]), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) { const l = (p[i] + p[i + 1] + p[i + 2]) / 765, s = lo + (1 - lo) * Math.min(1, l * 1.5); for (let j = 0; j < 3; j++) p[i + j] = rgb[j] * s; }
    g.putImageData(d, 0, 0); m[k] = canvasTex(c, m[k]); };
  for (const m of [...matsByName(vrm, 'Tops'), ...matsByName(vrm, 'Accessory')]) { if (m.color) m.color.set('#ffffff'); if (m.uniforms?.litFactor) m.uniforms.litFactor.value.set(0.72, 0.84, 1.0); if (m.uniforms?.shadeColorFactor) m.uniforms.shadeColorFactor.value.set(0.5, 0.62, 0.82); if (m.map) tint(m, 'map', [128, 180, 230], 0.6); if (m.shadeMultiplyTexture) tint(m, 'shadeMultiplyTexture', [128, 168, 205], 0.8); m.needsUpdate = true; }
  for (const m of matsByName(vrm, 'Bottoms')) { if (m.map) m.map = lighten(m.map, 228, 0.15); m.needsUpdate = true; }
  for (const m of matsByName(vrm, 'Shoes')) { if (m.map) m.map = lighten(m.map, 236, 0.12); if (m.shadeMultiplyTexture) m.shadeMultiplyTexture = lighten(m.shadeMultiplyTexture, 205, 0.12); m.needsUpdate = true; }
}
function restyleSundress(vrm) {
  // bare legs: the stock texture paints black tights on the legs -> repaint those regions with the skin tone
  const SKIN = [248, 218, 199];
  for (const m of matsByName(vrm, 'Body')) for (const k of ['map', 'shadeMultiplyTexture']) if (m[k]) {
    const c = texToCanvas(m[k]), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height), p = d.data, W = c.width, H = c.height;
    const sk = k === 'map' ? SKIN : [235, 190, 180];
    for (let y = Math.floor(H * 0.6); y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, lum = (p[i] + p[i + 1] + p[i + 2]) / 3;
      if (lum < 150) { const f = Math.min(1, (150 - lum) / 60); for (let j = 0; j < 3; j++) p[i + j] = p[i + j] * (1 - f) + sk[j] * f; }
    }
    g.putImageData(d, 0, 0); m[k] = canvasTex(c, m[k]);
    // strappy sandals: thin tan leather straps around the ankle + across the instep (bind-pose heights)
    const body = meshesByMat(vrm, 'Body')[0];
    if (body) m[k] = paintTris(m[k], body.geometry, (ys) => { const lo = Math.min(...ys), hi = Math.max(...ys); return (hi > 0.085 && lo < 0.1) || (hi > 0.135 && lo < 0.145) ? true : false; }, k === 'map' ? 'rgb(150,98,62)' : 'rgb(110,70,45)');
    m.needsUpdate = true;
  }
  // floral bodice; tan strappy sandals
  const fl = floralCanvas(1024, 1024, 1.6, 11);
  for (const m of matsByName(vrm, 'Tops')) {
    if (m.color) m.color.set('#ffffff');
    for (const k of ['map', 'shadeMultiplyTexture']) if (m[k]) {
      const c = texToCanvas(m[k]), g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height);
      const f = document.createElement('canvas'); f.width = c.width; f.height = c.height; const fg = f.getContext('2d'); fg.drawImage(fl, 0, 0, c.width, c.height);
      const fd = fg.getImageData(0, 0, c.width, c.height).data, p = d.data;
      for (let i = 0; i < p.length; i += 4) { const lum = (p[i] + p[i + 1] + p[i + 2]) / 765; const sh = k === 'map' ? 0.55 + 0.45 * Math.min(1, lum * 1.6) : 0.82; for (let j = 0; j < 3; j++) p[i + j] = fd[i + j] * sh; }
      g.putImageData(d, 0, 0); m[k] = canvasTex(c, m[k]);
    }
    m.needsUpdate = true;
  }
  for (const m of matsByName(vrm, 'Bottoms')) { if (m.map) m.map = lighten(m.map, 222, 0.2); m.needsUpdate = true; }
  for (const m of matsByName(vrm, 'Shoes')) {
    if (m.map) m.map = lighten(m.map, 120, 0.25, [1.25, 0.92, 0.66]);
    if (m.shadeMultiplyTexture) m.shadeMultiplyTexture = lighten(m.shadeMultiplyTexture, 95, 0.25, [1.2, 0.88, 0.62]);
    m.needsUpdate = true;
  }
}

// ---------- hair wind ----------
export function setupHair(vrm) {
  const joints = [...(vrm.springBoneManager?.joints || [])];
  const hair = joints.filter((j) => /Hair/i.test(j.bone.name));
  const cloth = joints.filter((j) => /Tops|Skirt|Bust/i.test(j.bone.name) && !/Bust/i.test(j.bone.name));
  // softer, lighter strands: low stiffness near the tips, a little drag so they swing instead of snapping
  hair.forEach((j, i) => { j.settings.stiffness = Math.min(j.settings.stiffness, 0.35) * 0.6; j.settings.dragForce = 0.22; j._ph = i * 2.399; j._k = 0.8 + ((i * 37) % 10) / 25; });
  const tmp = new THREE.Vector3(), side = new THREE.Vector3();
  return {
    // air = relative air velocity (wind - body velocity), world space
    update(air, t) {
      const sp = air.length();
      side.set(-air.z, 0, air.x).normalize();
      for (const j of hair) {
        // each strand sees its own turbulent eddy: speed flicker + sideways and vertical lift
        const a = t * (3.1 + j._k * 2.3) + j._ph, b = t * (7.7 + j._k * 3.1) + j._ph * 1.7;
        const flick = 1 + 0.35 * Math.sin(a) + 0.2 * Math.sin(b);
        const lift = (0.25 * Math.sin(a * 0.7 + 1) + 0.15 * Math.sin(b * 1.3)) * Math.min(1, sp / 4);
        tmp.set(0, -0.6, 0).addScaledVector(air, 0.32 * j._k * flick).addScaledVector(side, Math.sin(a * 1.3) * 0.18 * sp * 0.25);
        tmp.y += lift * sp * 0.25;
        const mag = tmp.length();
        j.settings.gravityDir.copy(tmp).divideScalar(mag || 1);
        j.settings.gravityPower = mag * 0.8;
      }
      for (const j of cloth) { tmp.set(0, -1, 0).addScaledVector(air, 0.1); const m = tmp.length(); j.settings.gravityDir.copy(tmp).divideScalar(m); j.settings.gravityPower = m * 0.2; }
    },
  };
}

// ---------- cloth skirt ----------
export class Skirt {
  constructor(vrm, scene, opt = {}) {
    this.vrm = vrm; this.R = opt.rows || 14; this.C = opt.cols || 30;
    const hum = vrm.humanoid;
    this.hips = hum.getNormalizedBoneNode('hips');
    this.bones = ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'hips', 'spine', 'leftLowerArm', 'leftHand', 'rightLowerArm', 'rightHand'].reduce((o, n) => (o[n] = hum.getNormalizedBoneNode(n), o), {});
    vrm.scene.updateMatrixWorld(true);
    const hipRest = new THREE.Vector3(); this.hips.getWorldPosition(hipRest);
    // measure body radius per angle at heights (bind pose) so the skirt never starts inside the body
    const verts = [];
    vrm.scene.traverse((o) => {
      if (!o.isMesh) return; const n = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => m.name).join();
      if (!/Body|Tops|Bottoms/.test(n)) return;
      const p = o.geometry.attributes.position, v3 = new THREE.Vector3();
      for (let i = 0; i < p.count; i += 1) { v3.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (v3.y > 0.3 && v3.y < 1.08) verts.push(v3.x, v3.y, v3.z); }
    });
    const cx = hipRest.x, cz = hipRest.z;
    const invHips = this.hips.matrixWorld.clone().invert();
    const C = this.C, R = this.R;
    const y0 = opt.top ?? 1.0, y1 = opt.hem ?? 0.40;
    const radAt = (yA, yB) => {
      const r = new Float32Array(C).fill(0.05);
      for (let i = 0; i < verts.length; i += 3) {
        const y = verts[i + 1]; if (y < yA || y > yB) continue;
        const x = verts[i] - cx, z = verts[i + 2] - cz, a = Math.atan2(z, x);
        const k = ((Math.round((a / (Math.PI * 2)) * C) % C) + C) % C, d = Math.hypot(x, z);
        for (const kk of [k - 1, k, k + 1]) { const q = ((kk % C) + C) % C; if (d > r[q]) r[q] = d; }
      }
      return r;
    };
    const rTop = radAt(y0 - 0.03, y0 + 0.03);
    const rHip = radAt(0.78, 0.97);
    this.local = []; // rest positions in hips space
    this.rest = [];
    const N = R * C;
    this.p = new Float32Array(N * 3); this.q = new Float32Array(N * 3);
    for (let r = 0; r < R; r++) {
      const f = r / (R - 1), y = y0 + (y1 - y0) * f;
      for (let c = 0; c < C; c++) {
        const a = (c / C) * Math.PI * 2;
        let rad = rTop[c] + 0.014;
        if (y < 0.97) rad = Math.max(rad, rHip[c] + 0.025);
        rad += Math.max(0, (y0 - y) - 0.05) * (opt.flare ?? 0.42);
        this.local.push(new THREE.Vector3(cx + Math.cos(a) * rad, y, cz + Math.sin(a) * rad).applyMatrix4(invHips));
      }
    }
    // constraints
    const cons = [];
    const id = (r, c) => r * C + ((c + C) % C);
    const d = (a, b) => this.local[a].distanceTo(this.local[b]);
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const a = id(r, c);
      cons.push([a, id(r, c + 1), d(a, id(r, c + 1)), 1]);
      if (r + 1 < R) { cons.push([a, id(r + 1, c), d(a, id(r + 1, c)), 1]); cons.push([a, id(r + 1, c + 1), d(a, id(r + 1, c + 1)), 0.5]); cons.push([a, id(r + 1, c - 1), d(a, id(r + 1, c - 1)), 0.5]); }
      if (r + 2 < R) cons.push([a, id(r + 2, c), d(a, id(r + 2, c)), 0.25]);
      if (c % 2 === 0) cons.push([a, id(r, c + 2), d(a, id(r, c + 2)), 0.3]);
    }
    this.cons = cons;
    this.maxDist = this.local.map((v, i) => v.distanceTo(this.local[i % C]) * 1.04);
    // geometry
    const geo = new THREE.BufferGeometry();
    const vC = C + 1; // duplicate seam column for uvs
    this.vpos = new Float32Array(R * vC * 3);
    const uvs = new Float32Array(R * vC * 2), idx = [];
    for (let r = 0; r < R; r++) for (let c = 0; c <= C; c++) { uvs[(r * vC + c) * 2] = c / C; uvs[(r * vC + c) * 2 + 1] = r / (R - 1); }
    for (let r = 0; r < R - 1; r++) for (let c = 0; c < C; c++) { const a = r * vC + c, b = a + 1, e = a + vC, f2 = e + 1; idx.push(a, e, b, b, e, f2); }
    geo.setAttribute('position', new THREE.BufferAttribute(this.vpos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    this.geo = geo; this.vC = vC;
    const grad = new THREE.DataTexture(new Uint8Array([150, 160, 205, 255, 214, 216, 236, 255, 252, 252, 255, 255, 255, 255, 255, 255]), 4, 1);
    grad.minFilter = grad.magFilter = THREE.LinearFilter; grad.needsUpdate = true;
    // hem shading: slightly translucent-looking lower edge via uv-based tint
    this.rimU = { value: new THREE.Color(0, 0, 0) };
    const mat = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: grad, side: THREE.DoubleSide, transparent: true });
    this.floral = OUTFIT === 'sundress'; this.shirt = OUTFIT === 'shirt';
    if (this.shirt) mat.color.set('#6fa6dc');
    if (this.floral) { const ft = new THREE.CanvasTexture(floralCanvas(1024, 512, 1.0, 5)); ft.colorSpace = THREE.SRGBColorSpace; ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(3, 1); ft.anisotropy = 4; mat.map = ft; }
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_pars_vertex>', '#include <uv_pars_vertex>\nvarying vec2 vSk;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvSk = uv;');
      sh.uniforms.uRim = this.rimU; sh.fragmentShader = sh.fragmentShader.replace('#include <uv_pars_fragment>', '#include <uv_pars_fragment>\nvarying vec2 vSk;\nuniform vec3 uRim;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + (this.shirt ?
          // shirt tail (pale blue linen, faint weave) over a short white pleated skirt that peeks out below the hem band
          ' float wv = 0.97 + 0.03 * sin(vSk.x * 3.14159 * 220.0) * sin(vSk.y * 90.0); gl_FragColor.rgb *= wv; float sk = smoothstep(0.86, 0.89, vSk.y) + (gl_FrontFacing ? 0.0 : step(0.86, vSk.y)); sk = clamp(sk, 0., 1.); float pl = 0.86 + 0.14 * abs(sin(vSk.x * 3.14159 * 48.0)); gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.985, 0.98, 0.975) * pl, sk); gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.82, (1. - sk) * smoothstep(0.82, 0.86, vSk.y));' : '') + (this.floral ?
          // sundress: inside (and the last band) is the white ruffled petticoat with a scalloped lace edge
          ' float pet = gl_FrontFacing ? 0.0 : 1.0; float sc = 0.955 + 0.03 * abs(sin(vSk.x * 3.14159 * 72.0)); pet = max(pet, step(sc, vSk.y)); gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.98, 0.97, 0.95) * (0.82 + 0.18 * abs(sin(vSk.x * 3.14159 * 144.0))) * (gl_FrontFacing ? 1.0 : 0.9), pet);' : '') + '\n float hem = smoothstep(0.78, 1.0, vSk.y); gl_FragColor.rgb = mix(gl_FragColor.rgb, min(vec3(1.), gl_FragColor.rgb*vec3(1.02,1.02,1.05)+0.04), hem); gl_FragColor.a = mix(0.97, 0.72, hem); vec3 vd = normalize(vViewPosition); float fr = pow(1.0 - abs(dot(normalize(vNormal), vd)), 2.5); gl_FragColor.rgb += uRim * (fr * 0.9 + hem * 0.35);');
    };
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.tmp = new THREE.Vector3(); this.m = new THREE.Matrix4();
    this.inited = false;
    this.caps = [];
    this.windT = 0;
    this.cosMax = Math.cos((opt.maxSwing ?? 50) * Math.PI / 180);
    this.airGain = opt.airGain ?? 0.6;
  }
  pinWorld(i, out) { return out.copy(this.local[i]).applyMatrix4(this.hips.matrixWorld); }
  reset() {
    const N = this.R * this.C, v = this.tmp;
    for (let i = 0; i < N; i++) { this.pinWorld(i, v); this.p.set([v.x, v.y, v.z], i * 3); this.q.set([v.x, v.y, v.z], i * 3); }
    this.inited = true;
  }
  setBoard(obj, on) { if (!on) { this.boardBox = null; return; } obj.updateMatrixWorld(true); const m = obj.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.07, 0)); this.boardBox = { m, inv: m.clone().invert(), hx: 0.125, hy: 0.06, hz: 0.5 }; }
  colliders() {
    const B = this.bones, w = (b) => b.getWorldPosition(new THREE.Vector3());
    const hip = w(B.hips), sp = w(B.spine);
    const lU = w(B.leftUpperLeg), lL = w(B.leftLowerLeg), lF = w(B.leftFoot), rU = w(B.rightUpperLeg), rL = w(B.rightLowerLeg), rF = w(B.rightFoot);
    const mid = lU.clone().add(rU).multiplyScalar(0.5);
    return [
      [sp, mid.clone().lerp(hip, 0.2), 0.135],
      [lU.clone().lerp(mid, 0.25), lL, 0.082], [lL, lF, 0.058],
      [rU.clone().lerp(mid, 0.25), rL, 0.082], [rL, rF, 0.058],
      [w(B.leftLowerArm), w(B.leftHand), 0.04], [w(B.rightLowerArm), w(B.rightHand), 0.04],
    ];
  }
  // air(world vec3): wind velocity in world; groundY(x,z) for floor collision
  step(dt, air0, t, groundY) {
    const air = this.airv || (this.airv = new THREE.Vector3()); air.copy(air0).multiplyScalar(this.airGain);
    this.hips.updateWorldMatrix(true, false);
    if (!this.inited) this.reset();
    const R = this.R, C = this.C, N = R * C, p = this.p, q = this.q, v = this.tmp;
    const sub = 3, h = Math.min(dt, 1 / 30) / sub, caps = this.colliders();
    const drag = 2.6, g = -9.8;
    for (let s = 0; s < sub; s++) {
      for (let i = C; i < N; i++) {
        const k = i * 3, r = Math.floor(i / C), c = i % C;
        const vx = (p[k] - q[k]) / h, vy = (p[k + 1] - q[k + 1]) / h, vz = (p[k + 2] - q[k + 2]) / h;
        const tt = t + s * h;
        const rr = r / (R - 1), turb = 0.25 + 0.75 * rr, hemF = rr * rr * rr; // flutter concentrates at the hem
        const gx = air.x * (1 + 0.45 * Math.sin(tt * 6.1 + c * 0.9 + r * 0.5) * turb) + Math.sin(tt * 3.7 + c * 1.3) * 0.5 * turb + Math.sin(tt * 11 + c * 2.3) * (0.3 + Math.abs(air.z) * 0.25) * hemF;
        const sp = Math.hypot(air.x, air.z);
        const gy = air.y + Math.sin(tt * 4.9 + c * 0.7 + r) * 0.45 * turb + Math.sin(tt * 13 + c * 1.9 - r * 0.8) * (0.4 + sp * 0.35) * hemF;
        const gz = air.z * (1 + 0.45 * Math.sin(tt * 5.3 + c * 1.1 - r * 0.4) * turb) + Math.cos(tt * 4.1 + c) * 0.5 * turb + Math.cos(tt * 12 + c * 2.1) * (0.3 + Math.abs(air.x) * 0.25) * hemF;
        const dg = drag * (0.8 + 0.5 * rr);
        const ax = dg * (gx - vx), ay = g * (1 - 0.25 * rr) + dg * (gy - vy), az = dg * (gz - vz);
        const nx = p[k] + (p[k] - q[k]) * 0.995 + ax * h * h, ny = p[k + 1] + (p[k + 1] - q[k + 1]) * 0.995 + ay * h * h, nz = p[k + 2] + (p[k + 2] - q[k + 2]) * 0.995 + az * h * h;
        q[k] = p[k]; q[k + 1] = p[k + 1]; q[k + 2] = p[k + 2];
        p[k] = nx; p[k + 1] = ny; p[k + 2] = nz;
      }
      for (let i = 0; i < C; i++) { this.pinWorld(i, v); const k = i * 3; q[k] = p[k]; q[k + 1] = p[k + 1]; q[k + 2] = p[k + 2]; p[k] = v.x; p[k + 1] = v.y; p[k + 2] = v.z; }
      for (let it = 0; it < 5; it++) {
        for (const [a, b, L, st] of this.cons) {
          const ka = a * 3, kb = b * 3;
          const dx = p[kb] - p[ka], dy = p[kb + 1] - p[ka + 1], dz = p[kb + 2] - p[ka + 2];
          const d = Math.hypot(dx, dy, dz) || 1e-6, diff = ((d - L) / d) * 0.5 * st;
          const wa = a < C ? 0 : 1, wb = b < C ? 0 : 1, ws = wa + wb; if (!ws) continue;
          const fa = (diff * 2 * wa) / ws, fb = (diff * 2 * wb) / ws;
          p[ka] += dx * fa; p[ka + 1] += dy * fa; p[ka + 2] += dz * fa;
          p[kb] -= dx * fb; p[kb + 1] -= dy * fb; p[kb + 2] -= dz * fb;
        }
        // long-range attachment (no stretching away from the waistband)
        for (let i = C; i < N; i++) {
          const k = i * 3, kt = (i % C) * 3, dx = p[k] - p[kt], dy = p[k + 1] - p[kt + 1], dz = p[k + 2] - p[kt + 2], d = Math.hypot(dx, dy, dz), m = this.maxDist[i];
          if (d > m) { const f = m / d; p[k] = p[kt] + dx * f; p[k + 1] = p[kt + 1] + dy * f; p[k + 2] = p[kt + 2] + dz * f; }
        }
        // modest skirt: a panel may swing out but never flips above ~50° from hanging (hem stays below the knee line)
        for (let i = C; i < N; i++) {
          const k = i * 3, kt = (i % C) * 3, dx = p[k] - p[kt], dy = p[k + 1] - p[kt + 1], dz = p[k + 2] - p[kt + 2];
          const d = Math.hypot(dx, dy, dz) || 1e-6, minDrop = d * this.cosMax;
          if (-dy < minDrop) { const hz = Math.hypot(dx, dz) || 1e-6, want = Math.sqrt(Math.max(0, d * d - minDrop * minDrop)); p[k] = p[kt] + dx / hz * want; p[k + 2] = p[kt + 2] + dz / hz * want; p[k + 1] = p[kt + 1] - minDrop; }
        }
        // body capsules
        for (const [A, B, rad] of caps) {
          const bx = B.x - A.x, by = B.y - A.y, bz = B.z - A.z, bl = bx * bx + by * by + bz * bz || 1e-6;
          const rr = rad + 0.012;
          for (let i = C; i < N; i++) {
            const k = i * 3;
            let u = ((p[k] - A.x) * bx + (p[k + 1] - A.y) * by + (p[k + 2] - A.z) * bz) / bl; u = u < 0 ? 0 : u > 1 ? 1 : u;
            const cx = A.x + bx * u, cy = A.y + by * u, cz = A.z + bz * u;
            const dx = p[k] - cx, dy = p[k + 1] - cy, dz = p[k + 2] - cz, d = Math.hypot(dx, dy, dz);
            if (d < rr && d > 1e-6) { const f = rr / d; p[k] = cx + dx * f; p[k + 1] = cy + dy * f; p[k + 2] = cz + dz * f; }
          }
        }
      }
      if (groundY) for (let i = C; i < N; i++) { const k = i * 3, gy = groundY(p[k], p[k + 2]) + 0.01; if (p[k + 1] < gy) p[k + 1] = gy; }
      // the board (when carried / near her): oriented box, particles inside are pushed out through the nearest face
      const BB = this.boardBox;
      if (BB) for (let i = C; i < N; i++) {
        const k = i * 3; v.set(p[k], p[k + 1], p[k + 2]).applyMatrix4(BB.inv);
        const ex = BB.hx + 0.015 - Math.abs(v.x), ey = BB.hy + 0.02 - Math.abs(v.y), ez = BB.hz + 0.015 - Math.abs(v.z);
        if (ex > 0 && ey > 0 && ez > 0) { if (ey <= ex && ey <= ez) v.y = Math.sign(v.y || 1) * (BB.hy + 0.02); else if (ex <= ez) v.x = Math.sign(v.x || 1) * (BB.hx + 0.015); else v.z = Math.sign(v.z || 1) * (BB.hz + 0.015);
          v.applyMatrix4(BB.m); p[k] = v.x; p[k + 1] = v.y; p[k + 2] = v.z; }
      }
    }
    // write mesh (seam duplicate)
    const vp = this.vpos, vC = this.vC;
    for (let r = 0; r < R; r++) for (let c = 0; c <= C; c++) { const s = (r * C + (c % C)) * 3, d = (r * vC + c) * 3; vp[d] = p[s]; vp[d + 1] = p[s + 1]; vp[d + 2] = p[s + 2]; }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}


// ---------- straw sun hat with ribbon tails ----------
// Sized from the hair mesh at runtime so the crown sits on the hair, not inside it.
export class Hat {
  constructor(vrm, scene) {
    this.vrm = vrm;
    const head = vrm.humanoid.getNormalizedBoneNode('head');
    this.head = head;
    vrm.scene.updateMatrixWorld(true);
    const hp = head.getWorldPosition(new THREE.Vector3());
    // measure hair extent around the head (bind pose, model space == world here)
    let top = hp.y + 0.15, rad = 0.11, cz = hp.z;
    const pts = [];
    vrm.scene.traverse((o) => {
      if (!o.isMesh) return; const n = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => m.name).join();
      if (!/Hair/.test(n) || /Back/.test(n)) return;
      const p = o.geometry.attributes.position, v3 = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) { v3.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (v3.y > hp.y + 0.02) pts.push([v3.x, v3.y, v3.z]); }
    });
    if (pts.length) {
      top = Math.max(...pts.map((q) => q[1]));
      const band = pts.filter((q) => q[1] > top - 0.09 && q[1] < top - 0.05);
      cz = band.reduce((a, q) => a + q[2], 0) / (band.length || 1);
      rad = Math.max(...band.map((q) => Math.hypot(q[0] - hp.x, q[2] - cz)), 0.1);
    }
    const straw = (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
      g.fillStyle = '#efdcae'; g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 256; y += 4) { g.fillStyle = `rgba(150,115,60,${0.10 + Math.random() * 0.08})`; g.fillRect(0, y, 256, 1.4); }
      for (let x = 0; x < 256; x += 6) { g.fillStyle = 'rgba(255,248,225,0.18)'; g.fillRect(x, 0, 2, 256); }
      const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(6, 2); tx.colorSpace = THREE.SRGBColorSpace; return tx;
    })();
    const mat = new THREE.MeshStandardMaterial({ color: '#f0dfb4', map: straw, roughness: 1, metalness: 0, side: THREE.DoubleSide, emissive: '#6b5a36', emissiveIntensity: 0.35 });
    this.root = new THREE.Group();
    // crown: soft dome, brim: wide, gently drooping at the edge
    const cr = rad + 0.012, ch = 0.085;
    const crownPts = []; for (let i = 0; i <= 12; i++) { const a = i / 12; crownPts.push(new THREE.Vector2(cr * (1 - 0.12 * a * a) * Math.cos(a * a * 1.2), ch * Math.sin(a * Math.PI / 2))); }
    crownPts.push(new THREE.Vector2(0.0001, ch));
    const crown = new THREE.Mesh(new THREE.LatheGeometry(crownPts, 40), mat);
    const brimPts = []; const R0 = cr - 0.004, R1 = 0.205;
    for (let i = 0; i <= 10; i++) { const a = i / 10; brimPts.push(new THREE.Vector2(R0 + (R1 - R0) * a, -0.028 * a * a)); }
    this.brimGeo = new THREE.LatheGeometry(brimPts, 64);
    this.brimBase = this.brimGeo.attributes.position.array.slice();
    const brim = new THREE.Mesh(this.brimGeo, mat);
    const ribbonMat = new THREE.MeshLambertMaterial({ color: '#6fb3e0', emissive: '#2c5f86', emissiveIntensity: 0.55, side: THREE.DoubleSide });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(cr * 0.995, cr * 1.0, 0.024, 40, 1, true), ribbonMat); band.position.y = 0.014;
    this.root.add(crown, brim, band);
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    // place relative to head bone: crown base sits ~4.5 cm below hair top, tilted slightly back
    // place in world (model faces +z here), brim level and tipped slightly back, then attach to the head
    // facing from anatomy (robust to VRM0's 180° root): (leftLeg - rightLeg) x up
    const lL = vrm.humanoid.getNormalizedBoneNode('leftUpperLeg').getWorldPosition(new THREE.Vector3());
    const rL = vrm.humanoid.getNormalizedBoneNode('rightUpperLeg').getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3().crossVectors(lL.sub(rL), new THREE.Vector3(0, 1, 0)).normalize();
    const yaw = Math.atan2(fwd.x, fwd.z);
    scene.add(this.root);
    this.root.position.set(hp.x, top - 0.05, cz).addScaledVector(fwd, -0.006);
    this.root.rotation.set(0, yaw, 0); this.root.rotateX(-0.12);
    this.root.updateMatrixWorld(true);
    head.attach(this.root);
    // ribbon tails (two verlet strips, pinned at the back of the band)
    this.tails = [];
    for (const side of [-1, 1]) {
      const N = 26, seg = 0.019, w = 0.05;
      const pts = [], prev = [];
      const g = new THREE.BufferGeometry(); const pos = new Float32Array(N * 2 * 3), idx = [];
      for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
      const m = new THREE.Mesh(g, ribbonMat); m.frustumCulled = false; m.castShadow = true; scene.add(m);
      for (let i = 0; i < N; i++) { pts.push(new THREE.Vector3()); prev.push(new THREE.Vector3()); }
      this.tails.push({ side, N, seg, w, pts, prev, g, pos, anchorLocal: new THREE.Vector3(side * 0.025, 0.0, -cr * 1.02), inited: false });
    }
    this.tmp = new THREE.Vector3();
  }
  step(dt, air, t) {
    this.root.updateMatrixWorld(true);
    const h = Math.min(dt, 1 / 30), wind = air.length();
    // brim flutter: travelling wave around the rim, stronger with relative air speed
    const a = this.brimGeo.attributes.position, b = this.brimBase;
    const amp = Math.min(0.018, 0.002 + wind * 0.0016);
    for (let i = 0; i < a.count; i++) {
      const x = b[i * 3], y = b[i * 3 + 1], z = b[i * 3 + 2], r = Math.hypot(x, z), e = Math.max(0, (r - 0.14) / 0.065);
      a.setY(i, y + Math.sin(Math.atan2(z, x) * 3 - t * (6 + wind)) * amp * e * e);
    }
    a.needsUpdate = true;
    // Ribbon tails: procedural, not free verlet (free strips at this scale tangle into polygons).
    // Base direction lags toward a blend of gravity and downwind; a travelling wave rides along the length.
    const down = new THREE.Vector3(0, -1, 0);
    const wdir = wind > 0.05 ? air.clone().divideScalar(wind) : new THREE.Vector3();
    const k = Math.min(0.7, wind / 8);
    const want = down.clone().multiplyScalar(1 - k).addScaledVector(wdir, k * 1.15).normalize();
    const headQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    const headRight = new THREE.Vector3(1, 0, 0).applyQuaternion(headQ);
    for (const tl of this.tails) {
      const anchor = this.root.localToWorld(tl.anchorLocal.clone());
      tl.base = tl.base || want.clone();
      tl.base.lerp(want, 1 - Math.exp(-h * 3.5)).normalize();
      // wave plane: perpendicular to base, mostly along the head's left-right axis (ribbons flutter sideways)
      const perp = headRight.clone().addScaledVector(tl.base, -headRight.dot(tl.base)); if (perp.lengthSq() < 1e-4) perp.set(0, 0, 1); perp.normalize();
      const perp2 = new THREE.Vector3().crossVectors(tl.base, perp).normalize();
      const amp = 0.35 + Math.min(0.5, wind * 0.06);
      const f = 6 + wind * 1.2;
      const P = anchor.clone();
      for (let i = 0; i < tl.N; i++) {
        tl.pts[i].copy(P);
        const u = i / (tl.N - 1);
        const ph = t * f - i * 0.32 + tl.side * 1.3;
        const d = tl.base.clone()
          .addScaledVector(perp, Math.sin(ph) * amp * u + tl.side * 0.12)
          .addScaledVector(perp2, Math.cos(ph * 0.8) * amp * 0.45 * u).normalize();
        P.addScaledVector(d, tl.seg);
      }
      for (let pass = 0; pass < 2; pass++) for (let i = 1; i < tl.N - 1; i++) tl.pts[i].lerp(tl.pts[i - 1].clone().add(tl.pts[i + 1]).multiplyScalar(0.5), 0.5);
      // width frame: twist slowly along the ribbon, starting flat against the head's side
      for (let i = 0; i < tl.N; i++) {
        const Pi = tl.pts[i], dir = (i < tl.N - 1 ? tl.pts[i + 1].clone().sub(Pi) : Pi.clone().sub(tl.pts[i - 1])).normalize();
        const refv = Math.abs(dir.y) < 0.6 ? new THREE.Vector3(0, 1, 0).cross(dir) : perp2.clone();
        const side = refv.addScaledVector(dir, -refv.dot(dir)); if (side.lengthSq() < 1e-5) side.copy(perp); side.normalize();
        side.applyAxisAngle(dir, Math.sin(t * 4 + i * 0.5 + tl.side) * 0.5 * (i / tl.N));
        const wv = tl.w * 0.5 * (1 - 0.35 * i / tl.N);
        const notch = i === tl.N - 1 ? 0.012 : 0; // swallow-tail cut at the end
        tl.pos.set([Pi.x + side.x * wv + dir.x * notch, Pi.y + side.y * wv + dir.y * notch, Pi.z + side.z * wv + dir.z * notch,
                    Pi.x - side.x * wv + dir.x * notch, Pi.y - side.y * wv + dir.y * notch, Pi.z - side.z * wv + dir.z * notch], i * 6);
      }
      tl.g.attributes.position.needsUpdate = true; tl.g.computeVertexNormals();
    }
  }
}

// ---------- wrist guards (护手板): pale grey palm/back plates + two velcro straps on each forearm/hand ----------
export function addWristGuards(vrm) {
  const H = vrm.humanoid, mat = new THREE.MeshStandardMaterial({ color: '#e9ecef', roughness: 0.75 }), strap = new THREE.MeshStandardMaterial({ color: '#6fb6c9', roughness: 0.8 }), plate = new THREE.MeshStandardMaterial({ color: '#cfd6dc', roughness: 0.4, metalness: 0.1 });
  vrm.scene.updateMatrixWorld(true);
  for (const side of ['left', 'right']) {
    const la = H.getNormalizedBoneNode(side + 'LowerArm'), hd = H.getNormalizedBoneNode(side + 'Hand');
    const raw = H.getRawBoneNode(side + 'Hand'), rawLa = H.getRawBoneNode(side + 'LowerArm');
    const a = rawLa.getWorldPosition(new THREE.Vector3()), h = raw.getWorldPosition(new THREE.Vector3());
    const len = a.distanceTo(h);
    // sleeve: tapered tube over the distal 45% of the forearm, built along the forearm axis in the raw bone's frame
    const g = new THREE.Group(); rawLa.add(g);
    const axisW = h.clone().sub(a).normalize(), inv = rawLa.getWorldQuaternion(new THREE.Quaternion()).invert(), axL = axisW.clone().applyQuaternion(inv);
    const qAlign = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axL);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.029, len * 0.46, 14, 1, true), mat); tube.material.side = THREE.DoubleSide;
    tube.quaternion.copy(qAlign); tube.position.copy(axL.clone().multiplyScalar(len * 0.74)); g.add(tube);
    for (const f of [0.6, 0.88]) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0335, 0.0335, 0.016, 14, 1, true), strap); s.material.side = THREE.DoubleSide; s.quaternion.copy(qAlign); s.position.copy(axL.clone().multiplyScalar(len * f)); g.add(s); }
    // palm plate on the hand
    const hg = new THREE.Group(); raw.add(hg);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.016, 0.06), mat); hand.position.set(0, 0, 0); hg.add(hand);
    const pl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.006, 0.07), plate); pl.position.set(0, -0.012, 0); hg.add(pl);
    // orient hand pad along the hand bone direction (towards middle finger)
    const mid = H.getRawBoneNode(side + 'MiddleProximal');
    if (mid) { const mp = mid.getWorldPosition(new THREE.Vector3()).applyMatrix4(raw.matrixWorld.clone().invert()); const dir = mp.clone().normalize(); hg.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir); hg.position.copy(mp.multiplyScalar(0.45)); }
    [g, hg].forEach((o) => o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } }));
  }
}
