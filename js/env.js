// Bondi route environment: concrete road with worn markings, baked ground classes (sand / rock / dirt / grass),
// instanced low-poly Bondi trees (Norfolk Island pine, gum, banksia, coastal shrub) and painted road symbols.
// All placement/classification comes pre-baked from data/env.json (tools/env.py); this file only builds meshes.
// Procedural textures here (noise, grit, symbols) are art assets, not placement data.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/jsm/utils/BufferGeometryUtils.js';

export const envU = { uT: { value: 0 } };
const S2L = (hex) => new THREE.Color(hex);   // THREE.Color(hex) converts sRGB -> linear working space
const glc = (hex) => { const c = S2L(hex); return `vec3(${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)})`; };
function prng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------- shared textures ----------------
// tileable value-noise RGBA (each channel an independent fbm), 256², mipmapped -> cheap world-space noise in shaders
function noiseTex(seed = 7) {
  const N = 256, rnd = prng(seed), data = new Uint8Array(N * N * 4);
  for (let ch = 0; ch < 4; ch++) {
    const acc = new Float32Array(N * N); let amp = 1, tot = 0;
    for (const P of [4, 8, 16, 32, 64]) {          // lattice periods (tile exactly)
      const L = new Float32Array(P * P); for (let i = 0; i < P * P; i++) L[i] = rnd();
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const fx = x / N * P, fy = y / N * P, i = Math.floor(fx), j = Math.floor(fy); let u = fx - i, v = fy - j; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
        const g = (a, b) => L[((b % P) * P) + (a % P)];
        acc[y * N + x] += amp * (g(i, j) * (1 - u) * (1 - v) + g(i + 1, j) * u * (1 - v) + g(i, j + 1) * (1 - u) * v + g(i + 1, j + 1) * u * v);
      }
      tot += amp; amp *= 0.55;
    }
    let mn = 1e9, mx = -1e9; for (const v of acc) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
    for (let k = 0; k < N * N; k++) data[k * 4 + ch] = Math.round((acc[k] - mn) / (mx - mn) * 255);
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
}
function canvasTex(N, draw, srgb = false) {
  const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'); draw(g, N);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
// short grass seen from above: thousands of tiny blade dashes (wrapping), grey = neutral luminance modulation
const grassTex = () => canvasTex(512, (g, N) => {
  const rnd = prng(11); g.fillStyle = '#808080'; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 7000; i++) {
    const x = rnd() * N, y = rnd() * N, a = rnd() * Math.PI * 2, l = 4 + rnd() * 9, v = rnd();
    g.strokeStyle = v < 0.5 ? `rgba(30,30,30,${0.35 + rnd() * 0.35})` : `rgba(235,235,235,${0.3 + rnd() * 0.35})`; g.lineWidth = 1.4 + rnd() * 1.6;
    for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke(); }
  }
});
// concrete aggregate: fine grit + a few exposed pebbles
const gritTex = () => canvasTex(256, (g, N) => {
  const rnd = prng(5); g.fillStyle = '#808080'; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 7000; i++) { const v = rnd() < 0.5 ? 40 + rnd() * 50 : 170 + rnd() * 70; g.fillStyle = `rgba(${v},${v},${v},${0.15 + rnd() * 0.35})`; const s = rnd() < 0.8 ? 1.5 : 2.5; g.fillRect(rnd() * N, rnd() * N, s, s); }
  for (let i = 0; i < 120; i++) { const v = 90 + rnd() * 90; g.fillStyle = `rgba(${v},${v * 0.98},${v * 0.95},0.45)`; g.beginPath(); g.arc(rnd() * N, rnd() * N, 1 + rnd() * 1.6, 0, 7); g.fill(); }
});

const NOISE = noiseTex(), GRASS = grassTex(), GRIT = gritTex();
export const envTex = { NOISE, GRIT };
const SHADER_NOISE = `uniform sampler2D uNoise; uniform sampler2D uDet;
  float aaBand(float d, float w){ float f = fwidth(d) * 0.9 + 1e-4; return 1. - smoothstep(w - f, w + f, abs(d)); }`;

// ---------------- concrete road ----------------
// ribbon uv: u 0..1 across (u=0 right edge), v = s/2. Everything is procedural in path space (across, along) so the
// lane lines follow the path exactly.
export function roadMaterial(W = 3.2) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNoise = { value: NOISE }; sh.uniforms.uDet = { value: GRIT };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vRd;').replace('#include <uv_vertex>', `#include <uv_vertex>\nvRd = vec2((uv.x - .5) * ${W.toFixed(2)}, uv.y * 2.);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec2 vRd;\n${SHADER_NOISE}`).replace('#include <map_fragment>', `
      float ac = vRd.x, al = vRd.y; vec2 wp = vec2(ac, al);
      vec4 nA = texture2D(uNoise, wp / 13.), nB = texture2D(uNoise, wp / 2.9 + .31), nC = texture2D(uNoise, wp / .83 + .7);
      float gr = texture2D(uDet, wp / 1.7).r * .6 + texture2D(uDet, wp / .63 + .37).r * .4;
      // poured concrete: pale warm grey, broad mottling (curing/wear), fine aggregate
      vec3 col = ${glc('#b4afa5')} * (0.84 + 0.2 * nA.r + 0.1 * (nB.g - .5) + 0.05 * (nC.b - .5)) * (0.8 + 0.4 * gr);
      col = mix(col, ${glc('#a29b8e')}, smoothstep(.5, .8, nA.b) * .5);
      float slab = fract(sin(floor(al / 2.4) * 12.9898) * 43758.55); col *= 0.95 + 0.08 * slab;                // each pour a touch different                              // darker weathered slabs
      // transverse sawn expansion joints every 2.4 m (+ the odd slab offset)
      float J = 2.4, jd = (fract(al / J + .5) - .5) * J;
      float joint = aaBand(jd + (nB.r - .5) * .004, .006);
      // hairline cracks: thin iso-lines of a noise field, only on some slabs
      float cn = texture2D(uNoise, wp / 2.3 + 3.1).r - .5 + (texture2D(uNoise, wp / .21 + 1.3).g - .5) * .035 + (nC.r - .5) * .02;   // jagged
      float crack = aaBand(cn, .0045) * smoothstep(.62, .74, nA.g) * smoothstep(.45, .6, texture2D(uNoise, wp / .9 + 5.7).b) * (1. - smoothstep(1.45, 1.6, abs(ac)));
      col *= 1. - .5 * joint - .4 * crack;
      // grime toward the edges, a little green/brown where grass creeps in
      float ed = smoothstep(1.2, 1.6, abs(ac) + (nB.b - .5) * .25);
      col = mix(col, col * ${glc('#9a9a80')}, ed * .5);
      // worn paint: edge lines + dashed centre line, slight hand-painted wobble, patchy & faded
      float wob = (texture2D(uNoise, vec2(al / 31., .37)).r - .5) * .05 + (texture2D(uNoise, vec2(al / 7., .61)).g - .5) * .015;
      float wv = .045 * (0.8 + 0.4 * texture2D(uNoise, vec2(al / 3.7, .19)).r);
      float pe = max(aaBand(ac - 1.40 - wob, wv), aaBand(ac + 1.40 - wob, wv));
      float dash = smoothstep(.0, .03, fract(al / 3.) ) * (1. - smoothstep(.47, .5, fract(al / 3.)));
      float pc = aaBand(ac - wob * .7, .05) * dash;
      float fade = .45 + .55 * smoothstep(.25, .75, texture2D(uNoise, vec2(al / 90., .83)).g);          // long faded stretches
      float brk = texture2D(uNoise, vec2(al / 6.1, ac * .25 + .5)).b;                                   // long scuffed-off gaps
      float wear = smoothstep(.34, .58, nB.r * .45 + nC.g * .35 + brk * .3) * smoothstep(.3, .46, brk) * fade * (0.7 + 0.3 * gr);
      float paint = max(pe, pc) * wear;
      col = mix(col, ${glc('#efede4')}, paint * .82);
      diffuseColor.rgb *= col;`);
  };
  return m;
}
// vertical concrete edge so the slab doesn't float above the verge
export function roadEdges(track, W = 1.6, depth = 0.35) {
  const v = [], idx = [], P = track.pts;
  for (const sd of [-1, 1]) {
    const base = v.length / 3;
    P.forEach((p, k) => { const lx = Math.cos(p.yaw), lz = -Math.sin(p.yaw), w = sd * W; v.push(p.x + lx * w, p.y, p.z + lz * w, p.x + lx * (w + sd * 0.02), p.y - depth, p.z + lz * (w + sd * 0.02));
      if (k) { const a = base + 2 * k - 2; if (sd > 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#aaa496', roughness: 1, side: THREE.DoubleSide }));
}

// ---------------- painted symbols + stains (one merged decal mesh) ----------------
function decalAtlas() {
  // 4 cells of 256²: 0 bicycle, 1 pedestrian, 2 arrow, 3 stain; white paint, worn by erasing with blotchy noise
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const g = c.getContext('2d'), rnd = prng(23);
  g.strokeStyle = g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  { // bicycle (side view, wheels across the lane, stretched along the road like real path markings)
    g.save(); g.translate(128, 132); g.scale(0.92, 1.25); g.lineWidth = 10;   // side view, upright when read on approach (AS 1742.9 style)
    g.beginPath(); g.arc(-58, 22, 40, 0, 7); g.stroke(); g.beginPath(); g.arc(58, 22, 40, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(-58, 22); g.lineTo(-12, 22); g.lineTo(30, -26); g.lineTo(-24, -26); g.lineTo(-58, 22); g.moveTo(-12, 22); g.lineTo(-30, -44);
    g.moveTo(58, 22); g.lineTo(36, -40); g.lineTo(52, -50); g.moveTo(-42, -46); g.lineTo(-16, -46); g.stroke(); g.restore();
  }
  { // pedestrian (walking figure)
    g.save(); g.translate(384, 128); g.scale(1.0, 1.15);
    g.beginPath(); g.arc(4, -78, 16, 0, 7); g.fill(); g.lineWidth = 22;
    g.beginPath(); g.moveTo(2, -54); g.lineTo(-4, 6); g.stroke(); g.lineWidth = 15;
    g.beginPath(); g.moveTo(-4, 4); g.lineTo(-34, 50); g.lineTo(-44, 84); g.moveTo(-4, 4); g.lineTo(22, 44); g.lineTo(40, 84);
    g.moveTo(0, -44); g.lineTo(-26, -12); g.lineTo(-32, 16); g.moveTo(2, -44); g.lineTo(28, -16); g.lineTo(44, 8); g.stroke(); g.restore();
  }
  { // straight arrow pointing +s (canvas up)
    g.beginPath(); g.moveTo(640, 14); g.lineTo(700, 92); g.lineTo(662, 92); g.lineTo(662, 244); g.lineTo(618, 244); g.lineTo(618, 92); g.lineTo(580, 92); g.closePath(); g.fill();
  }
  // wear: erase paint in blotches (dense small specks + a few large patches)
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(0,0,0,${0.25 + rnd() * 0.6})`; g.beginPath(); g.arc(rnd() * 768, rnd() * 256, 0.8 + rnd() * 3.2, 0, 7); g.fill(); }
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${0.2 + rnd() * 0.4})`; g.beginPath(); g.ellipse(rnd() * 768, rnd() * 256, 6 + rnd() * 22, 4 + rnd() * 12, rnd() * 3, 0, 7); g.fill(); }
  g.globalCompositeOperation = 'source-over';
  { // stain: soft irregular dark blot (water/oil/leaf tannin), alpha only
    for (let i = 0; i < 26; i++) { const a = rnd() * 7, r = rnd() * 52, x = 896 + Math.cos(a) * r, y = 128 + Math.sin(a) * r, R = 18 + rnd() * 42;
      const gr = g.createRadialGradient(x, y, 0, x, y, R); gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, R, 0, 7); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
export function roadDecals(track, decals) {
  const pos = [], uv = [], kd = [], idx = [];
  const quad = (s0, off, L, Wd, cell, flip, stain, yawR) => {
    const N = 4, b = pos.length / 3;
    for (let r = 0; r <= N; r++) {
      const f = r / N, s = s0 + (f - 0.5) * L * (flip ? -1 : 1), q = track.at(s), lx = Math.cos(q.yaw), lz = -Math.sin(q.yaw);
      for (const e of [0, 1]) {   // e=0: viewer's left (+left offset) -> u=0
        let w = off + (flip ? -1 : 1) * (e ? -Wd / 2 : Wd / 2), x = q.p.x + lx * w, z = q.p.z + lz * w;
        if (stain) { const c = Math.cos(yawR), si = Math.sin(yawR), dx = (e ? -0.5 : 0.5) * Wd, dz = (f - 0.5) * L, p0 = track.at(s0); const L0x = Math.cos(p0.yaw), L0z = -Math.sin(p0.yaw), Dx = p0.dir.x, Dz = p0.dir.z;
          const a = dx * c - dz * si, bb = dx * si + dz * c; x = p0.p.x + L0x * (off + a) + Dx * bb; z = p0.p.z + L0z * (off + a) + Dz * bb; }
        pos.push(x, q.p.y + 0.006, z); uv.push((cell + (e ? 1 : 0)) / 4, f); kd.push(stain ? 1 : 0);
      }
      if (r) { const a = b + 2 * r - 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  };
  for (const [s, off, kind, size, rot] of decals) {
    if (s < 1 || s > track.total - 1) continue;
    if (kind === 3) { const o = Math.sign(off) * Math.min(Math.abs(off), 1.5 - size * 0.5); quad(s, o, size, size * (0.7 + (rot % 1) * 0.5), 3, false, true, rot); }
    else if (kind === 4) { quad(s, off, 1.35, 0.95, 0, !!rot, false, 0); quad(s + 2.1, off, 1.35, 0.78, 1, !!rot, false, 0); }
    else quad(s, off, kind === 2 ? 1.9 : 1.35, kind === 2 ? 0.55 : 0.95, kind, !!rot, false, 0);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aStain', new THREE.Float32BufferAttribute(kd, 1)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ map: decalAtlas(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 0.9, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNoise = { value: NOISE };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aStain; varying float vSt; varying vec3 vWq;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSt = aStain; vWq = (modelMatrix * vec4(position, 1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSt; varying vec3 vWq; uniform sampler2D uNoise;').replace('#include <map_fragment>', `
      vec4 tx = texture2D(map, vMapUv); vec4 nz = texture2D(uNoise, vWq.xz / 3.7);
      float wear = smoothstep(.3, .62, nz.r * .6 + texture2D(uNoise, vWq.xz / .9).g * .4);
      if (vSt > .5) { diffuseColor.rgb = ${glc('#5f5a50')}; diffuseColor.a = tx.a * (0.55 + 0.6 * nz.g); }
      else { diffuseColor.rgb = ${glc('#f1efe8')}; diffuseColor.a = tx.a * (0.35 + 0.65 * wear) * .9; }`);
  };
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.renderOrder = 1; return mesh;
}

// ---------------- ground ----------------
// per-vertex weights (sand, rock, dirt, green) from the bake; shader breaks the 8 m grid up with world-space noise
export function groundAttr(ENV, T, x, y) {
  // nearest baked terrain vertex (the ground mesh vertices sit exactly on the terrain grid)
  const G = ENV.__g || (ENV.__g = Uint8Array.from(atob(ENV.ground.b64), (c) => c.charCodeAt(0)));
  const i = Math.max(0, Math.min(T.nx - 1, Math.round((x - T.x0) / T.step))), j = Math.max(0, Math.min(T.ny - 1, Math.round((y - T.y0) / T.step))), k = (j * T.nx + i) * 2;
  return [(G[k] >> 4) / 15, (G[k] & 15) / 15, (G[k + 1] >> 4) / 15, (G[k + 1] & 15) / 15];
}
export function groundMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNoise = { value: NOISE }; sh.uniforms.uDet = { value: GRASS };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aCls; varying vec4 vCls; varying vec3 vWg; varying float vUp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCls = aCls; vWg = (modelMatrix * vec4(position, 1.)).xyz; vUp = normalize(mat3(modelMatrix) * normal).y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec4 vCls; varying vec3 vWg; varying float vUp;\n${SHADER_NOISE}`).replace('#include <map_fragment>', `
      vec2 w = vWg.xz;
      vec4 n1 = texture2D(uNoise, w / 140.), n2 = texture2D(uNoise, w / 23. + .5), n3 = texture2D(uNoise, w / 4.3 + .2), n4 = texture2D(uNoise, w / 1.1);
      float dist = length(vWg - cameraPosition), near = 1. - smoothstep(25., 90., dist);
      float det = texture2D(uDet, w / 3.2).r * .6 + texture2D(uDet, w / 1.3 + .4).r * .4;
      // grass: straw -> olive -> green -> lush (watered park lawn), varied in patches
      float g = clamp(vCls.w + (n1.r - .5) * .55 + (n2.g - .5) * .35 + (n3.b - .5) * .12, 0., 1.);
      vec3 straw = ${glc('#b5a978')}, olive = ${glc('#8a9260')}, green = ${glc('#6c8c4e')}, lush = ${glc('#5b8446')};
      vec3 col = g < .33 ? mix(straw, olive, g / .33) : g < .66 ? mix(olive, green, (g - .33) / .33) : mix(green, lush, (g - .66) / .34);
      col *= 0.9 + 0.16 * n3.r;
      col = mix(col, col * ${glc('#8a9a66')}, smoothstep(.62, .78, n2.a) * .5);                     // low shrubby / clover clumps
      col *= mix(1., 0.5 + 1.0 * det, near) * mix(1., 0.88 + 0.24 * texture2D(uNoise, w / .6).g, near);                                                          // short grass blades up close
      // dirt: bare worn patches with pebbles
      float dw = smoothstep(.5, .66, vCls.z + (n2.b - .5) * .5 + (n3.g - .5) * .3);
      vec3 dirt = ${glc('#9b7a59')} * (0.85 + .2 * n3.a) * mix(1., .85 + .3 * texture2D(uNoise, w / .35).r, near);
      col = mix(col, dirt, dw);
      // rock: Hawkesbury sandstone, ochre-grey with strata bands and dark crevices
      float rw = smoothstep(.35, .6, vCls.y + (n2.a - .5) * .45 + (n3.r - .5) * .2 + (1. - vUp) * .35 * vCls.y);
      // Hawkesbury sandstone: horizontal bedding layers (by world height, gently warped), honey/ochre & grey bands,
      // soft dark recess under each ledge, lichen-grey blotches; no crack veins
      float yy = vWg.y * 1.35 + (n1.g - .5) * 3. + (n2.g - .5) * .9;
      float bed = fract(yy), lid = floor(yy);
      float bandTone = fract(sin(lid * 17.13) * 4375.85);
      vec3 rock = mix(${glc('#9e8d72')}, ${glc('#857f77')}, bandTone * .8 + (n2.r - .5) * .4);
      rock = mix(rock, ${glc('#b4945f')}, smoothstep(.6, .85, n2.b) * .4);                          // iron-stained honey faces
      rock *= 0.8 + 0.22 * smoothstep(0., .25, bed) - 0.18 * smoothstep(.82, 1., bed) * (0.5 + vCls.y * .5);
      rock = mix(rock, ${glc('#8e9088')}, smoothstep(.62, .8, n3.a) * .35);                          // lichen grey
      rock *= 0.92 + .14 * n4.g;
      col = mix(col, rock, rw);
      // sand: dry pale sand, wetter/darker near the waterline
      float sw = smoothstep(.35, .6, vCls.x + (n2.r - .5) * .35 + (n3.a - .5) * .15);
      vec3 sand = ${glc('#e9d8ae')} * (0.95 + .07 * n3.g + .04 * n4.r);
      sand = mix(sand * ${glc('#c8b48e')}, sand, smoothstep(-.4, .9, vWg.y));
      col = mix(col, sand, sw);
      diffuseColor.rgb *= col;`);
  };
  return m;
}

// ---------------- fine road corridor ground (baked in env.py: ENV.corridor) ----------------
// The 8 m terrain grid is too coarse beside the road: a triangle spanning the road interpolates a far vertex and
// rises through the concrete, or drops into the sea. Cells near the road are drawn instead as an fs x fs lattice
// whose heights = coarse bilinear + baked delta (cut under the road, cut bank beside it, embankment fill so the road
// sits on land). rawH(i, j) = coarse vertex height (route grid, j north). Returns { mesh, skip:Set(cell k) }.
export function corridorGround(ENV, T, rawH, material) {
  const C = ENV.corridor, FS = C.fs, NX = T.nx, st = T.step / FS;
  const raw = atob(C.dcm), dcm = new Int16Array(raw.length / 2);
  for (let k = 0; k < dcm.length; k++) { const v = raw.charCodeAt(2 * k) | (raw.charCodeAt(2 * k + 1) << 8); dcm[k] = v > 32767 ? v - 65536 : v; }
  const bil = (I, J) => { const i = Math.min(NX - 2, Math.floor(I / FS)), j = Math.min(T.ny - 2, Math.floor(J / FS)), u = I / FS - i, v = J / FS - j;
    return rawH(i, j) * (1 - u) * (1 - v) + rawH(i + 1, j) * u * (1 - v) + rawH(i, j + 1) * (1 - u) * v + rawH(i + 1, j + 1) * u * v; };
  const cls = (x, y) => { const fi = (x - T.x0) / T.step, fj = (y - T.y0) / T.step, i = Math.min(NX - 2, Math.floor(fi)), j = Math.min(T.ny - 2, Math.floor(fj)), u = fi - i, v = fj - j, o = [0, 0, 0, 0];
    for (const [a, b, w] of [[0, 0, (1 - u) * (1 - v)], [1, 0, u * (1 - v)], [0, 1, (1 - u) * v], [1, 1, u * v]]) { const c = groundAttr(ENV, T, T.x0 + (i + a) * T.step, T.y0 + (j + b) * T.step); for (let q = 0; q < 4; q++) o[q] += c[q] * w; }
    return o; };
  const map = new Map(), pos = [], at = [], idx = [];
  const vid = (I, J) => { const key = I * 100000 + J; let n = map.get(key); if (n !== undefined) return n; n = map.size; map.set(key, n);
    const x = T.x0 + I * st, y = T.y0 + J * st, b = bil(I, J), d = dcm[n] / 100, h = b + d; pos.push(x, h, -y);
    const c = cls(x, y), fill = Math.max(0, d), wall = Math.min(1, Math.max(0, (fill - 0.25) / 0.6));
    // built-up embankment / seawall = sandstone blocks (rock class); deep cut banks show a bit of earth
    c[1] = Math.max(c[1], wall); c[0] *= 1 - wall; c[2] = Math.max(c[2] * (1 - wall), Math.min(0.5, Math.max(0, -d - 0.6) * 0.4)); at.push(...c); return n; };
  for (const k of C.cells) { const i = k % (NX - 1), j = Math.floor(k / (NX - 1));
    for (let b = 0; b <= FS; b++) for (let a = 0; a <= FS; a++) vid(i * FS + a, j * FS + b); }
  for (const k of C.cells) { const i = k % (NX - 1), j = Math.floor(k / (NX - 1));
    for (let b = 0; b < FS; b++) for (let a = 0; a < FS; a++) { const I = i * FS + a, J = j * FS + b;
      const p00 = vid(I, J), p10 = vid(I + 1, J), p01 = vid(I, J + 1), p11 = vid(I + 1, J + 1);
      idx.push(p00, p10, p11, p00, p11, p01); } }   // diagonal (0,0)-(1,1) like the coarse PlaneGeometry; CCW seen from above
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aCls', new THREE.Float32BufferAttribute(at, 4));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, material); m.receiveShadow = true;
  /* h(I, J): drawn height of fine lattice vertex (I, J) (fine steps from the grid origin, J north) or undefined */
  return { mesh: m, skip: new Set(C.cells), fs: FS, h: (I, J) => { const n = map.get(I * 100000 + J); return n === undefined ? undefined : pos[n * 3 + 1]; } };
}

// ---------------- intertidal rock shelves (baked: ENV.shelf, sparse strength per terrain vertex) ----------------
// The coarse ground sinks the sea floor and all land below 1.3 m under the water plane, so the real sandstone
// platforms read as open water. Where the bake found shelf rock, a 2 m lattice is drawn above the water: slab top
// 0.12-0.7 m by strength, broken into bedding steps, with ragged edges (strength + value noise) that dip below the
// water so the platform has a wet lip. Same ground shader (rock class); userData.shelf marks it for probes.
function vnoise2(seed) { const H = (i, j) => { let h = (i * 374761393 + j * 668265263 + seed * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  return (x, y) => { const i = Math.floor(x), j = Math.floor(y); let u = x - i, v = y - j; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
    return H(i, j) * (1 - u) * (1 - v) + H(i + 1, j) * u * (1 - v) + H(i, j + 1) * (1 - u) * v + H(i + 1, j + 1) * u * v; }; }
export function buildShelf(scene, ENV, T, material) {
  const S = ENV.shelf; if (!S || !S.k || !S.k.length) return null;
  const NX = T.nx, NY = T.ny, st = T.step, SV = new Float32Array(NX * NY); let k = 0;
  S.k.forEach((d, n) => { k += d; SV[k] = S.v[n] / 255; });
  const n1 = vnoise2(3), n2 = vnoise2(9), SUB = 4, ss = st / SUB, pos = [], cls = [], idx = [], vmap = new Map();
  const str = (x, y) => { const fi = (x - T.x0) / st, fj = (y - T.y0) / st, i = Math.min(NX - 2, Math.max(0, Math.floor(fi))), j = Math.min(NY - 2, Math.max(0, Math.floor(fj))), u = fi - i, v = fj - j;
    return SV[j * NX + i] * (1 - u) * (1 - v) + SV[j * NX + i + 1] * u * (1 - v) + SV[(j + 1) * NX + i] * (1 - u) * v + SV[(j + 1) * NX + i + 1] * u * v; };
  const vert = (I, J) => { const key = I * 100000 + J; let n = vmap.get(key); if (n !== undefined) return n; n = vmap.size; vmap.set(key, n);
    const x = T.x0 + I * ss, y = T.y0 + J * ss, s0 = str(x, y), e = s0 + (n1(x / 7, y / 7) - 0.5) * 0.55 + (n2(x / 2.3, y / 2.3) - 0.5) * 0.22;
    const top = 0.12 + 0.5 * Math.min(1, Math.max(0, (e - 0.35) / 0.6)), step = Math.floor(n2(x / 11 + 5, y / 11) * 3) * 0.1;
    const h = e > 0.35 ? top + step : -0.25 - 0.6 * Math.min(1, (0.35 - e) / 0.3);
    pos.push(x, h, -y); cls.push(0, 1, 0, 0); return n; };
  const up = [];
  for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
    if (!(SV[j * NX + i] || SV[j * NX + i + 1] || SV[(j + 1) * NX + i] || SV[(j + 1) * NX + i + 1])) continue;
    for (let b = 0; b < SUB; b++) for (let a = 0; a < SUB; a++) { const I = i * SUB + a, J = j * SUB + b;
      const p00 = vert(I, J), p10 = vert(I + 1, J), p01 = vert(I, J + 1), p11 = vert(I + 1, J + 1);
      for (const t of [[p00, p10, p11], [p00, p11, p01]]) if (t.some((q) => pos[q * 3 + 1] > 0)) idx.push(...t); }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aCls', new THREE.Float32BufferAttribute(cls, 4));
  g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, material); m.receiveShadow = true; m.userData.shelf = true; scene.add(m);
  return { mesh: m, tris: idx.length / 3, verts: S.k.length };
}

// ---------------- stone kerb along cut banks (baked: ENV.kerb) ----------------
// low, rounded, irregular Hawkesbury-sandstone blocks bedded in the verge; 3 lumpy shape variants, each one instanced mesh
function kerbStoneGeo(seed) {
  const rnd = prng(seed), g = new THREE.IcosahedronGeometry(0.5, 1), p = g.attributes.position, v = new THREE.Vector3();
  const lobes = [0, 1, 2, 3].map(() => [new THREE.Vector3(rnd() - 0.5, (rnd() - 0.5) * 0.6, rnd() - 0.5).normalize(), 0.05 + rnd() * 0.08]);
  for (let k = 0; k < p.count; k++) { v.fromBufferAttribute(p, k); const n = v.clone().normalize();
    // superellipsoid-ish: flattened top, squarer sides (dressed stone), plus a few broad lumps
    const sq = (x) => Math.sign(x) * Math.pow(Math.abs(x), 0.82);
    v.set(sq(n.x) * 0.5, sq(n.y) * 0.5, sq(n.z) * 0.5); let r = 1; for (const [d, a] of lobes) r += a * Math.max(0, n.dot(d)) ** 2 - a * 0.25;
    v.multiplyScalar(r); if (v.y > 0.22) v.y = 0.22 + (v.y - 0.22) * 0.55;             // flatter, worn top
    p.setXYZ(k, v.x, v.y + 0.3, v.z); }                                                     // base at y ~ -0.2 (sunk), top ~ +0.65
  g.computeVertexNormals(); return g;
}
export function buildKerb(scene, ENV) {
  const A = ENV.kerb || [], n = A.length / 8; if (!n) return 0;
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (sh) => { sh.uniforms.uNoise = { value: NOISE };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWk; varying float vYk;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWk = (modelMatrix * instanceMatrix * vec4(position, 1.)).xyz; vYk = position.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uNoise; varying vec3 vWk; varying float vYk;').replace('#include <map_fragment>', `
      vec4 n1 = texture2D(uNoise, vWk.xz * .7 + vWk.y * .4), n2 = texture2D(uNoise, vWk.xz * 2.6 - vWk.y * 1.3), n3 = texture2D(uNoise, vec2(vWk.x + vWk.z, vWk.y) * 1.7);
      float bed = fract(vWk.y * 9. + n1.g * 1.5);                                           // faint bedding lines
      diffuseColor.rgb *= (0.8 + 0.26 * n1.r) * (0.9 + 0.14 * n2.g) * (0.94 + 0.08 * smoothstep(.1, .3, bed));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.78, .8, .74), smoothstep(.62, .8, n3.b) * .6);   // lichen / grime
      diffuseColor.rgb *= mix(0.72, 1., smoothstep(0.02, 0.22, vYk));                      // earthy foot where it beds into the verge`); };
  const geos = [kerbStoneGeo(11), kerbStoneGeo(23), kerbStoneGeo(37)], buckets = [[], [], []];
  for (let i = 0; i < n; i++) buckets[Math.floor(A[i * 8 + 7] * 997) % 3].push(i);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  const pal = ['#bfa27a', '#a89d8c', '#c9a56f', '#b39a80', '#9f9584'].map((h) => new THREE.Color(h));
  buckets.forEach((list, gi) => { if (!list.length) return;
    const im = new THREE.InstancedMesh(geos[gi], mat, list.length);
    list.forEach((i, j) => { const [x, y, z, yaw, L, H, W, t] = A.slice(i * 8, i * 8 + 8), r = prng(Math.floor(t * 1e4) + i)();
      const flip = r < 0.5 ? 0 : Math.PI;                                                    // turn half of them round
      e.set((r - 0.5) * 0.14, yaw + flip, ((t * 7.7) % 1 - 0.5) * 0.12, 'YXZ'); q.setFromEuler(e);
      // geometry spans y ~-0.2..0.7 at unit scale: scale so the top sits at base + H, the foot well bedded
      m4.compose(new THREE.Vector3(x, y + 0.2 * H / 0.9, z), q, new THREE.Vector3(W * (0.95 + r * 0.2), H / 0.9, L)); im.setMatrixAt(j, m4);
      const a = pal[Math.floor(t * 5) % 5], b = pal[Math.floor(t * 13) % 5]; im.setColorAt(j, c.copy(a).lerp(b, r)); });
    im.computeBoundingSphere(); im.castShadow = false; im.receiveShadow = true; scene.add(im); });   /* kerb stones: ~0.3 m high, their shadow is invisible from the chase cam but cost 3 shadow passes */
  return n;
}

// ---------------- trees ----------------
// helpers: each part gets vertex colours; foliage normals are pushed toward "away from the clump centre + up" for a soft,
// painterly read (no faceted gems).
function part(g, colFn, soft = null) {
  g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv');
  const p = g.attributes.position, n = g.attributes.normal, c = new Float32Array(p.count * 3), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    colFn(col, p.getX(i), p.getY(i), p.getZ(i), i); c.set([col.r, col.g, col.b], i * 3);
    if (soft) { const v = new THREE.Vector3(p.getX(i) - soft.x, (p.getY(i) - soft.y) * 0.8 + 0.35 * soft.r, p.getZ(i) - soft.z).normalize(); n.setXYZ(i, v.x, v.y, v.z); }
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g;
}
function blob(r, sx, sy, sz, x, y, z, seed, det = 1) {
  const g = new THREE.IcosahedronGeometry(r, det), p = g.attributes.position, rnd = prng(seed);
  const m = new Map();   // same jitter for coincident verts so the blob stays closed
  for (let i = 0; i < p.count; i++) { const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`; if (!m.has(k)) m.set(k, 0.82 + rnd() * 0.32); const f = m.get(k); p.setXYZ(i, p.getX(i) * f * sx + x, p.getY(i) * f * sy + y, p.getZ(i) * f * sz + z); }
  g.computeVertexNormals(); return g;
}
function limb(a, b, r0, r1, seg = 5) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length(), g = new THREE.CylinderGeometry(r1, r0, L, seg, 1, true);
  g.translate(0, L / 2, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); g.translate(a.x, a.y, a.z); return g;
}
const C = (h) => new THREE.Color(h);
function pineGeo() {        // Norfolk Island pine, 20 m: tall straight trunk, bare lower third, flat horizontal tiers of upturned branches
  const parts = [], rnd = prng(31), H = 20;
  const bark = C('#6b5847'), barkT = C('#857160');
  parts.push(part(new THREE.CylinderGeometry(0.1, 0.42, H + 0.6, 7, 3, true).translate(0, H / 2 - 0.6, 0), (c, x, y) => c.copy(bark).lerp(barkT, y / H)));
  const dark = C('#2f4d2c'), mid = C('#46683a'), tip = C('#6a8a4c');
  const tiers = 12, y0 = 6.2;
  for (let t = 0; t < tiers; t++) {
    const u = t / (tiers - 1), y = y0 + u * (H - 1.2 - y0), R = 0.5 + 4.4 * Math.pow(1 - u, 0.9) * (0.9 + rnd() * 0.2), nb = u > 0.8 ? 4 : 5, a0 = t * 2.4;
    for (let b = 0; b < nb; b++) {
      if (u < 0.3 && rnd() < 0.18) continue;                              // the odd missing branch -> irregular silhouette
      const a = a0 + b / nb * Math.PI * 2 + (rnd() - 0.5) * 0.5, L = R * (0.85 + rnd() * 0.25), ca = Math.cos(a), sa = Math.sin(a);
      // a branch = a long flat frond pad, root at the trunk, tip slightly raised
      const g = new THREE.SphereGeometry(1, 6, 3); const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { let lx = (p.getX(i) * 0.5 + 0.5) * L, ly = p.getY(i) * (0.32 + 0.12 * (1 - u)), lz = p.getZ(i) * (0.35 + 0.28 * L / 4.8) * Math.min(1, 0.35 + lx / L * 1.2);
        ly += 0.12 * (lx / L) ** 2 * L - 0.25 * Math.sin(Math.PI * lx / L);   // droop in the middle, up-turned tip
        p.setXYZ(i, lx * ca - lz * sa, y + ly, lx * sa + lz * ca); }
      g.computeVertexNormals();
      parts.push(part(g, (c, x, yy, z) => { const r = Math.hypot(x, z) / Math.max(1, L); c.copy(dark).lerp(mid, Math.min(1, r * 1.1)).lerp(tip, Math.max(0, r - 0.6) * 1.6); if (yy < y) c.multiplyScalar(0.75); },
        { x: 0, y: y - 1.2, z: 0, r: 1 }));
    }
  }
  parts.push(part(new THREE.ConeGeometry(0.55, 2.2, 6).translate(0, H - 0.2, 0), (c) => c.copy(mid)));
  return mergeGeometries(parts);
}
function gumGeo() {         // coastal eucalypt, 12 m: pale smooth trunk forking into crooked limbs, open crown of drooping grey-green clumps
  const parts = [], rnd = prng(47), bark = C('#ddd5c4'), barkD = C('#a8987f');
  const V = (x, y, z) => new THREE.Vector3(x, y, z), base = V(0, -0.5, 0), fork = V(0.35, 4.2, -0.1);
  const bc = (c, x, y) => c.copy(barkD).lerp(bark, Math.min(1, 0.35 + y / 7 + 0.25 * Math.sin(x * 7 + y * 2.3)));
  parts.push(part(limb(base, V(0.15, 2.2, 0), 0.38, 0.3, 7), bc)); parts.push(part(limb(V(0.15, 2.2, 0), fork, 0.3, 0.25, 7), bc));
  const leaf = C('#8b9a72'), leafL = C('#b7bf9c'), leafD = C('#64714b');
  // crooked limbs (two segments each, kinked), ending in clumps at different heights -> open, irregular crown
  const ends = [V(-3.2, 8.2, 0.9), V(2.9, 9.0, -1.6), V(0.2, 10.8, 1.9), V(2.3, 7.0, 2.4), V(-1.4, 9.9, -2.3), V(-2.4, 6.6, -1.2)];
  ends.forEach((e) => { const mid = fork.clone().lerp(e, 0.5).add(V((rnd() - 0.5) * 1.4, (rnd() - 0.2) * 0.8, (rnd() - 0.5) * 1.4));
    parts.push(part(limb(fork, mid, 0.19, 0.13, 5), bc)); parts.push(part(limb(mid, e, 0.13, 0.05, 4), bc)); });
  ends.forEach((e, i) => { const n = 2 + (i % 2);
    for (let k = 0; k < n; k++) { const r = 1.0 + rnd() * 0.8, o = V((rnd() - 0.5) * 1.6, -0.2 - k * 0.5 + rnd() * 0.3, (rnd() - 0.5) * 1.6), c0 = e.clone().add(o);
      // flattened, wider-than-tall clumps whose lower half hangs (droop) -> eucalypt foliage masses
      const g = blob(r, 1.35, 0.55, 1.25, c0.x, c0.y, c0.z, 100 + i * 7 + k); const pp = g.attributes.position;
      for (let j = 0; j < pp.count; j++) { const dy = pp.getY(j) - c0.y; if (dy < 0) pp.setY(j, pp.getY(j) + dy * 0.6); }
      g.computeVertexNormals();
      parts.push(part(g, (c, x, y, z) => { const t = (y - c0.y) / r; c.copy(leafD).lerp(leaf, 0.55 + t * 0.5).lerp(leafL, Math.max(0, t) * 0.55 * (0.6 + 0.4 * Math.sin(x * 2.7 + z * 1.9))); }, { x: c0.x, y: c0.y, z: c0.z, r })); } });
  return mergeGeometries(parts);
}
function banksiaGeo() {     // coast banksia, 5 m: gnarly leaning dark trunk, irregular olive crown with silvery undersides, yellow cones
  const parts = [], rnd = prng(59), V = (x, y, z) => new THREE.Vector3(x, y, z), bark = C('#5b5148'), barkL = C('#7a6d5f');
  const bc = (c, x, y) => c.copy(bark).lerp(barkL, 0.5 + 0.5 * Math.sin(y * 9 + x * 5));
  const a = V(0, -0.4, 0), b = V(0.55, 1.4, 0.15), c2 = V(0.2, 2.5, 0.45), c3 = V(1.6, 2.4, -0.5);
  parts.push(part(limb(a, b, 0.24, 0.17, 6), bc)); parts.push(part(limb(b, c2, 0.16, 0.1, 5), bc)); parts.push(part(limb(b, c3, 0.13, 0.07, 5), bc));
  const top = C('#6f7f4f'), und = C('#aab39b'), dk = C('#4a5a37');
  const cl = [V(0.0, 3.1, 0.5), V(1.7, 2.9, -0.6), V(0.9, 3.7, -0.1), V(-0.7, 2.7, -0.2), V(0.6, 2.5, 1.2)];
  cl.forEach((e, i) => { const r = 0.85 + rnd() * 0.45; parts.push(part(blob(r, 1.2, 0.75, 1.1, e.x, e.y, e.z, 200 + i), (c, x, y, z) => { const t = (y - e.y) / r; c.copy(dk).lerp(top, 0.5 + t * 0.55); if (t < -0.3) c.lerp(und, 0.5); }, { x: e.x, y: e.y, z: e.z, r })); });
  for (let k = 0; k < 6; k++) { const e = cl[k % cl.length], th = rnd() * 6.28, ph = 0.2 + rnd() * 0.9, r = 0.95; const p = V(e.x + Math.cos(th) * Math.cos(ph) * r, e.y + Math.sin(ph) * r * 0.7, e.z + Math.sin(th) * Math.cos(ph) * r);
    parts.push(part(new THREE.CylinderGeometry(0.06, 0.07, 0.24, 5).translate(p.x, p.y + 0.08, p.z), (c) => c.set('#c9b052'))); }
  return mergeGeometries(parts.map((g) => { if (!g.attributes.normal) g.computeVertexNormals(); return g; }));
}
function shrubGeo() {       // coastal heath shrub (westringia / coastal rosemary), ~1 m: loose multi-lobed mound, silvery grey-green, tiny pale flowers
  const parts = [], rnd = prng(71), g1 = C('#7f8f66'), g2 = C('#b2b99a'), dk = C('#56643f');
  const lobes = [[0, 0.36, 0, 0.5], [0.45, 0.26, 0.18, 0.36], [-0.36, 0.24, -0.26, 0.34], [0.1, 0.22, -0.48, 0.3], [-0.2, 0.55, 0.22, 0.3], [0.3, 0.5, -0.2, 0.26]];
  lobes.forEach(([x, y, z, r], i) => parts.push(part(blob(r, 1.15, 0.9, 1.1, x, y, z, 300 + i, 0), (c, px, py, pz) => { const t = (py - y) / r; c.copy(dk).lerp(g1, 0.45 + t * 0.5).lerp(g2, Math.max(0, t) * 0.55 * (0.5 + 0.5 * Math.sin(px * 11 + pz * 7))); }, { x, y: y - 0.25, z, r })));
  for (let k = 0; k < 6; k++) { const [x, y, z, r] = lobes[k % lobes.length], th = rnd() * 6.28, ph = 0.15 + rnd() * 1.1;
    parts.push(part(new THREE.OctahedronGeometry(0.045, 0).translate(x + Math.cos(th) * Math.cos(ph) * r * 1.1, y + Math.sin(ph) * r * 0.9, z + Math.sin(th) * Math.cos(ph) * r * 1.05), (c) => c.set('#ece8f2'))); }
  return mergeGeometries(parts);
}
function figGeo() {         // Moreton Bay / Port Jackson fig, 12 m: short massive grey buttressed trunk, low heavy limbs, broad dark glossy dome ~14 m wide
  const parts = [], rnd = prng(83), V = (x, y, z) => new THREE.Vector3(x, y, z), bark = C('#7d776c'), barkL = C('#9a948a');
  const bc = (c, x, y) => c.copy(bark).lerp(barkL, 0.5 + 0.5 * Math.sin(y * 3 + x * 4));
  parts.push(part(new THREE.CylinderGeometry(0.75, 1.25, 3.6, 9, 1, true).translate(0, 1.3, 0), bc));
  const ends = [];
  for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + rnd() * 0.5, L = 3.4 + rnd() * 1.4, e = V(Math.cos(a) * L, 4.8 + rnd() * 1.4, Math.sin(a) * L); ends.push(e);
    parts.push(part(limb(V(0, 2.8, 0), e, 0.5, 0.22, 5), bc)); }
  const dk = C('#2c4a26'), mid = C('#3f6331'), lt = C('#5d7f44');
  // broad dome of overlapping heavy clumps: an outer ring low and wide, an inner ring higher, a crown cap
  const cl = [];
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + rnd() * 0.4, R = 4.4 + rnd() * 0.8; cl.push([Math.cos(a) * R, 6.3 + rnd() * 0.9, Math.sin(a) * R, 3.0 + rnd() * 0.5]); }
  for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2 + rnd() * 0.6, R = 1.8 + rnd() * 0.6; cl.push([Math.cos(a) * R, 8.6 + rnd() * 0.7, Math.sin(a) * R, 3.0 + rnd() * 0.4]); }
  cl.forEach(([x, y, z, r], i) => { const g = blob(r, 1.25, 0.7, 1.25, x, y, z, 400 + i);
    const pp = g.attributes.position; for (let j = 0; j < pp.count; j++) { const dy = pp.getY(j) - y; if (dy < 0) pp.setY(j, pp.getY(j) + dy * 0.35); }
    g.computeVertexNormals();
    parts.push(part(g, (c, px, py, pz) => { const t = (py - y) / r; c.copy(dk).lerp(mid, 0.5 + t * 0.6).lerp(lt, Math.max(0, t) * 0.5 * (0.6 + 0.4 * Math.sin(px * 1.9 + pz * 2.3))); }, { x, y, z, r })); });
  return mergeGeometries(parts);
}
const SPECIES = {
  pine: { geo: pineGeo, H: 20, sway: 0.18, tint: ['#f2fff0', '#ffffff'], shadow: true },
  gum: { geo: gumGeo, H: 11.5, sway: 0.16, tint: ['#eef6f0', '#fff6e2'], shadow: true },
  banksia: { geo: banksiaGeo, H: 5, sway: 0.07, tint: ['#eef8e8', '#ffffff'], shadow: true },
  shrub: { geo: shrubGeo, H: 1, sway: 0.03, tint: ['#dfeacc', '#fff2dc'], shadow: true },
  fig: { geo: figGeo, H: 12, sway: 0.05, tint: ['#e8f2e2', '#ffffff'], shadow: true },
};
function treeMaterial(H, sway) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uT = envU.uT;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uT;').replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec2 ip = instanceMatrix[3].xz; float k = pow(max(position.y, 0.) / ${H.toFixed(1)}, 2.) * ${sway.toFixed(3)} * ${H.toFixed(1)} / 10.;
        transformed.x += k * (sin(uT * 0.9 + ip.x * 0.11 + ip.y * 0.07) + 0.35 * sin(uT * 2.1 + ip.y * 0.3 + position.y));
        transformed.z += k * 0.6 * sin(uT * 0.7 + ip.y * 0.13); }`);
  };
  return m;
}
// instanced, chunked in 400 m tiles so frustum culling (main view + the small sun-shadow frustum) skips far groups
export function buildTrees(scene, ENV) {
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), ql = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), ax = new THREE.Vector3(), col = new THREE.Color(), stats = {};
  for (const [sp, def] of Object.entries(SPECIES)) {
    const A = ENV.trees[sp] || [], n = A.length / 10; stats[sp] = n; if (!n) continue;
    const geo = def.geo(), mat = treeMaterial(def.H, def.sway), tiles = new Map(), WW = ENV.treesW && ENV.treesW[sp];   /* optional crown-width multipliers */
    for (let i = 0; i < n; i++) { const k = Math.floor(A[i * 10] / 400) + "," + Math.floor(A[i * 10 + 2] / 400); if (!tiles.has(k)) tiles.set(k, []); tiles.get(k).push(i); }
    const t0 = new THREE.Color(def.tint[0]), t1 = new THREE.Color(def.tint[1]);
    for (const list of tiles.values()) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((i, j) => {
        const o = i * 10, [x, y, z, sc, ry, lx, lz, tn] = A.slice(o, o + 8), s = sc / def.H, xz = (0.9 + (tn * 7.3 % 1) * 0.2) * (WW ? WW[i] || 1 : 1);
        qy.setFromAxisAngle(up, ry); const L = Math.hypot(lx, lz);
        if (L > 1e-4) { ax.set(lz, 0, -lx).normalize(); ql.setFromAxisAngle(ax, -L); q.copy(ql).multiply(qy); } else q.copy(qy);
        m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s * xz, s, s * xz)); im.setMatrixAt(j, m4);
        im.setColorAt(j, col.copy(t0).lerp(t1, tn));
      });
      im.computeBoundingSphere(); im.castShadow = def.shadow; im.receiveShadow = false; scene.add(im);
    }
  }
  return stats;
}
