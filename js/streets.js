// Streets, car parks, footpaths, plazas and courts from OSM (data/streets.json, baked by tools/streets.py), draped
// flat on the drawn ground. Every polygon is earcut-triangulated, then each triangle is clipped against the ground
// mesh's own triangles (8 m coarse grid, or the 1 m road-corridor lattice where env.js draws that) so the surface
// follows the terrain exactly (no floating, no burying) and sits LIFT m above it. One merged mesh, one material:
// class per vertex (aK) -> worn dark asphalt / pale concrete footpaths / paving / courts, all procedural in world
// space (shared env.js noise). The game's walking path is never covered: the bake cuts everything >= 1.85 m from it.
import * as THREE from 'three';
import { envTex } from './env.js';

const LIFT = 0.035;
const S2L = (hex) => new THREE.Color(hex);
const glc = (hex) => { const c = S2L(hex); return `vec3(${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)})`; };

export function decodeStreets(D) {
  return D.p.map((p) => ({ k: p[0], rings: p.slice(1).map((r) => { const o = []; let x = 0, y = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; o.push([x / 10, y / 10]); } return o; }) }));
}

/* Sutherland-Hodgman: keep the part of convex/simple polygon P where a*x + b*y + c >= 0 */
function clipHalf(P, a, b, c) {
  const out = []; const n = P.length; if (!n) return out;
  for (let i = 0; i < n; i++) { const p = P[i], q = P[(i + 1) % n], dp = a * p[0] + b * p[1] + c, dq = a * q[0] + b * q[1] + c;
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); } }
  return out;
}

function streetMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNoise = { value: envTex.NOISE }; sh.uniforms.uDet = { value: envTex.GRIT };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aK; varying float vK; varying vec3 vWs;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvK = aK; vWs = (modelMatrix * vec4(position, 1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vK; varying vec3 vWs; uniform sampler2D uNoise; uniform sampler2D uDet;').replace('#include <map_fragment>', `
      vec2 w = vWs.xz; float dist = length(vWs - cameraPosition), near = 1. - smoothstep(30., 120., dist);
      vec4 n1 = texture2D(uNoise, w / 47.), n2 = texture2D(uNoise, w / 9.3 + .4), n3 = texture2D(uNoise, w / 2.1 + .7);
      float gr = texture2D(uDet, w / 1.9).r;
      float k = floor(vK + .5); vec3 col;
      if (k < .5 || k > 4.5) {
        /* asphalt: dark grey, sun-faded patches, darker tyre-polished / oil-stained bands, lighter repairs */
        col = ${glc('#787b7e')} * (0.86 + 0.22 * n1.r + 0.1 * (n2.g - .5));
        col = mix(col, ${glc('#8f9192')}, smoothstep(.58, .8, n1.b) * .55);                /* faded, older surface */
        col = mix(col, ${glc('#5d6063')}, smoothstep(.62, .82, n2.r) * .45);                   /* oil / patch-seal */
        col = mix(col, ${glc('#8a8b8b')}, smoothstep(.7, .85, n2.a) * smoothstep(.4, .6, n3.b) * .6);   /* cold-patch repairs */
        if (k > 4.5) col = ${glc('#bdb8ad')} * (0.88 + 0.16 * n1.r + 0.08 * (n2.b - .5));      /* concrete court / skate bowl */
        col *= mix(1., 0.85 + 0.3 * gr, near);
        if (k > .5 && k < 1.5) col *= 1.04;
      } else if (k < 1.5) {
        /* car park asphalt: a touch lighter and blotchier (oil spots under parked cars) */
        col = ${glc('#828486')} * (0.86 + 0.2 * n1.r + 0.1 * (n2.g - .5));
        col = mix(col, ${glc('#626466')}, smoothstep(.6, .78, n3.r) * smoothstep(.45, .7, n2.b) * .6);
        col *= mix(1., 0.85 + 0.3 * gr, near);
      } else if (k < 2.5) {
        col = ${glc('#6f8063')} * (0.9 + 0.14 * n1.g);                                         /* hard court (muted green) */
      } else if (k < 3.5) {
        /* plaza paving: warm pale pavers, faint joints */
        col = ${glc('#bdb8ae')} * (0.88 + 0.14 * n1.r + 0.06 * (n2.g - .5));
        vec2 f = abs(fract(w / vec2(0.6, 0.3)) - .5); col *= 1. - .08 * near * (1. - smoothstep(.44, .49, max(f.x, f.y)));
      } else {
        /* footpath concrete: light grey, slab joints every 1.5 m (world grid, close enough at this scale) */
        col = ${glc('#aeaeab')} * (0.88 + 0.16 * n1.r + 0.06 * (n2.b - .5));
        col = mix(col, ${glc('#97968f')}, smoothstep(.62, .82, n2.a) * .4);
        col *= mix(1., 0.88 + 0.24 * gr, near);
      }
      diffuseColor.rgb *= col;`);
  };
  m.customProgramCacheKey = () => 'streets1';
  return m;
}

/* G: { T (terrain), rawH(i, j) coarse vertex height, cor: corridorGround result (h(I, J), fs, skip) or null } */
export function buildStreets(scene, D, G) {
  const T = G.T, NX = T.nx, NY = T.ny, st = T.step, cor = G.cor, FS = cor ? cor.fs : 8, fst = st / FS;
  const pos = [], kk = [];
  let tris = 0;
  /* every baked polygon is simple (no holes; tools/streets.py cuts them into <= 32 m tiles): clip the whole polygon
     against each ground triangle under it (Sutherland-Hodgman, convex window) and earcut the piece */
  const pushPiece = (P, hz, k) => {
    if (P.length < 3) return;
    if (P.length === 3) { for (const q of P) { pos.push(q[0], hz(q[0], q[1]), -q[1]); kk.push(k); } tris++; return; }
    const V = P.map(([x, y]) => new THREE.Vector2(x, y)), idx = THREE.ShapeUtils.triangulateShape(V, []);
    const cw = THREE.ShapeUtils.isClockWise(V);
    for (const t of idx) { const o = cw ? [t[0], t[2], t[1]] : t; for (const i of o) { pos.push(P[i][0], hz(P[i][0], P[i][1]), -P[i][1]); kk.push(k); } tris++; }
  };
  const cellTris = (P, cx0, cy0, s, h00, h10, h01, h11, k) => {
    const Q = clipHalf(clipHalf(clipHalf(clipHalf(P, 1, 0, -cx0), -1, 0, cx0 + s), 0, 1, -cy0), 0, -1, cy0 + s); if (Q.length < 3) return;
    for (const lower of [true, false]) {
      const R = lower ? clipHalf(Q, 1, -1, -cx0 + cy0) : clipHalf(Q, -1, 1, cx0 - cy0); if (R.length < 3) continue;
      pushPiece(R, (x, y) => { const u = (x - cx0) / s, v = (y - cy0) / s; return (lower ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h11 - h01) * u + (h01 - h00) * v) + LIFT; }, k);
    }
  };
  for (const poly of decodeStreets(D)) {
    const P = poly.rings[0], xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - T.x0) / st)), i1 = Math.min(NX - 2, Math.floor((Math.max(...xs) - T.x0) / st));
    const j0 = Math.max(0, Math.floor((Math.min(...ys) - T.y0) / st)), j1 = Math.min(NY - 2, Math.floor((Math.max(...ys) - T.y0) / st));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const x0 = T.x0 + i * st, y0 = T.y0 + j * st;
      if (cor && cor.skip.has(j * (NX - 1) + i)) {
        const C = clipHalf(clipHalf(clipHalf(clipHalf(P, 1, 0, -x0), -1, 0, x0 + st), 0, 1, -y0), 0, -1, y0 + st); if (C.length < 3) continue;
        const cx = C.map((p) => p[0]), cy = C.map((p) => p[1]);
        const a0 = Math.max(0, Math.floor((Math.min(...cx) - x0) / fst)), a1 = Math.min(FS - 1, Math.floor((Math.max(...cx) - x0) / fst));
        const b0 = Math.max(0, Math.floor((Math.min(...cy) - y0) / fst)), b1 = Math.min(FS - 1, Math.floor((Math.max(...cy) - y0) / fst));
        for (let a2 = a0; a2 <= a1; a2++) for (let b2 = b0; b2 <= b1; b2++) {
          const I = i * FS + a2, J = j * FS + b2, h = (p, q) => { const v = cor.h(I + p, J + q); return v === undefined ? 0 : v; };
          cellTris(C, T.x0 + I * fst, T.y0 + J * fst, fst, h(0, 0), h(1, 0), h(0, 1), h(1, 1), poly.k);
        }
      } else cellTris(P, x0, y0, st, G.rawH(i, j), G.rawH(i + 1, j), G.rawH(i, j + 1), G.rawH(i + 1, j + 1), poly.k);
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aK', new THREE.Float32BufferAttribute(kk, 1));
  g.computeVertexNormals(); g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, streetMaterial()); mesh.receiveShadow = true; mesh.renderOrder = 0; scene.add(mesh);
  return { mesh, tris, polys: D.p.length };
}
