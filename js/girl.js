// Avatar: VRM body (pixiv sample, modification allowed) restyled into a white-dress girl:
//  - white stockings painted onto the leg UVs of the body texture
//  - shorts / shoes lightened
//  - a verlet-cloth skirt pinned to the hips that reacts to wind + motion and collides with the legs
//  - long-hair spring bones driven by relative air velocity
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '../vendor/three-vrm.module.min.js';

export async function loadGirl(url) {
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  vrm.scene.traverse((o) => { o.frustumCulled = false; });
  restyle(vrm);
  return vrm;
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
  for (const key of ['Bottoms', 'Shoes']) for (const m of matsByName(vrm, key)) {
    const tint = key === 'Shoes' ? [1, 0.97, 0.93] : [1, 1, 1];
    if (m.map) m.map = lighten(m.map, key === 'Shoes' ? 185 : 215, 0.25, tint);
    if (m.shadeMultiplyTexture) m.shadeMultiplyTexture = lighten(m.shadeMultiplyTexture, 175, 0.2, tint);
    m.needsUpdate = true;
  }
}

// ---------- hair wind ----------
export function setupHair(vrm) {
  const joints = [...(vrm.springBoneManager?.joints || [])];
  const hair = joints.filter((j) => /Hair/.test(j.bone.name));
  const cloth = joints.filter((j) => /Tops/.test(j.bone.name));
  for (const j of hair) { j.settings.stiffness *= 0.4; j.settings.dragForce = 0.28; }
  const base = hair.map((j) => ({ j, gp: j.settings.gravityPower, st: j.settings.stiffness }));
  const tmp = new THREE.Vector3();
  return {
    // air: world-space relative air velocity (wind - body velocity), t: time
    update(air, t) {
      for (let i = 0; i < base.length; i++) {
        const { j } = base[i];
        const flick = Math.sin(t * 5.3 + i * 1.7) * 0.5 + Math.sin(t * 8.1 + i * 2.9) * 0.3;
        tmp.set(0, -1.0, 0).multiplyScalar(0.55).addScaledVector(air, 0.34 * (1 + 0.25 * flick));
        const mag = tmp.length();
        j.settings.gravityDir.copy(tmp).divideScalar(mag || 1);
        j.settings.gravityPower = mag * 0.75;
      }
      for (const j of cloth) { tmp.set(0, -1, 0).addScaledVector(air, 0.08); const m = tmp.length(); j.settings.gravityDir.copy(tmp).divideScalar(m); j.settings.gravityPower = m * 0.15; }
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
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i += 1) { const y = p.getY(i); if (y > 0.3 && y < 1.08) verts.push(p.getX(i), y, p.getZ(i)); }
    });
    const cx = 0, cz = hipRest.z + 0.0;
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
        this.local.push(new THREE.Vector3(cx + Math.cos(a) * rad, y, cz + Math.sin(a) * rad).sub(hipRest));
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
    const mat = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: grad, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_pars_vertex>', '#include <uv_pars_vertex>\nvarying vec2 vSk;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvSk = uv;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <uv_pars_fragment>', '#include <uv_pars_fragment>\nvarying vec2 vSk;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n float hem = smoothstep(0.93, 1.0, vSk.y); gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb*vec3(0.93,0.94,0.99), hem*0.6);');
    };
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.tmp = new THREE.Vector3(); this.m = new THREE.Matrix4();
    this.inited = false;
    this.caps = [];
    this.windT = 0;
  }
  pinWorld(i, out) { return out.copy(this.local[i]).applyMatrix4(this.hips.matrixWorld); }
  reset() {
    const N = this.R * this.C, v = this.tmp;
    for (let i = 0; i < N; i++) { this.pinWorld(i, v); this.p.set([v.x, v.y, v.z], i * 3); this.q.set([v.x, v.y, v.z], i * 3); }
    this.inited = true;
  }
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
  step(dt, air, t, groundY) {
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
        const turb = 0.35 + 0.65 * (r / R);
        const gx = air.x * (1 + 0.35 * Math.sin(tt * 6.1 + c * 0.9 + r * 0.5) * turb) + Math.sin(tt * 3.7 + c * 1.3) * 0.5 * turb;
        const gy = air.y + Math.sin(tt * 4.9 + c * 0.7 + r) * 0.45 * turb;
        const gz = air.z * (1 + 0.35 * Math.sin(tt * 5.3 + c * 1.1 - r * 0.4) * turb) + Math.cos(tt * 4.1 + c) * 0.5 * turb;
        const ax = drag * (gx - vx), ay = g + drag * (gy - vy), az = drag * (gz - vz);
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
    }
    // write mesh (seam duplicate)
    const vp = this.vpos, vC = this.vC;
    for (let r = 0; r < R; r++) for (let c = 0; c <= C; c++) { const s = (r * C + (c % C)) * 3, d = (r * vC + c) * 3; vp[d] = p[s]; vp[d + 1] = p[s + 1]; vp[d + 2] = p[s + 2]; }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}
