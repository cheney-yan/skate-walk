// Real building footprints as calm massed blocks (data/buildings.json, baked by tools/buildings.py from OSM +
// Microsoft Global ML Building Footprints). Everything is merged into a few BufferGeometries (walls / flat roofs /
// hipped roofs, chunked in 300 m tiles for frustum culling); colours are per-vertex (warm whites, cream, a little
// sandstone; terracotta or grey hipped roofs). A per-building attribute aB (centre xyz + radius) lets the vertex
// shader fold away any building that sits on the camera -> her sight line (replaces the old per-mesh hiding).
import * as THREE from 'three';

export function decodeBuildings(D) {
  const out = []; let o = 0, h = 0;
  for (let k = 0; k < D.n.length; k++) {
    const n = D.n[k], P = []; let x = 0, y = 0;
    for (let i = 0; i < n; i++) { x += D.xy[(o + i) * 2]; y += D.xy[(o + i) * 2 + 1]; P.push([x / 10, y / 10]); }
    o += n;
    const b = { P, base: D.z[k * 2] / 10, top: D.z[k * 2 + 1] / 10, roof: D.roof[k], t: D.t[k], src: D.src[k] };
    if (b.roof === 1) { const q = D.hip.slice(h * 6, h * 6 + 6); h++; b.hip = { cx: q[0] / 10, cy: q[1] / 10, a: q[2] / 1000, L: q[3] / 10, W: q[4] / 10, rise: q[5] / 10 }; }
    out.push(b);
  }
  return out;
}

const WALLS = ['#f3eee6', '#efe7da', '#f6f2ec', '#ebe2d4', '#e9dccb', '#f1ebe3', '#dccbb5', '#efe9e1'];
const FLAT = ['#e4ded5', '#d9d4cc', '#ece7df', '#cfcac2'];
const TILE = ['#b8664a', '#c07656', '#a95d45', '#b98068', '#8e8780', '#9a6a58'];

function bldMaterial(U) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCamA = U.uCamA; sh.uniforms.uCamF = U.uCamF; sh.uniforms.uHide = U.uHide;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aB; uniform vec3 uCamA, uCamF; uniform float uHide;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec3 af = uCamF - uCamA; float u = clamp(dot(aB.xyz - uCamA, af) / max(dot(af, af), 1e-3), 0., 1.);
          float d = distance(aB.xyz, uCamA + af * u);
          if (uHide > 0.5 && d < aB.w * 0.8 + 2.) transformed.y = aB.y - 50.; }`);
  };
  m.customProgramCacheKey = () => 'bld1';
  return m;
}

export function buildBuildings(scene, D) {
  const B = decodeBuildings(D), U = { uCamA: { value: new THREE.Vector3() }, uCamF: { value: new THREE.Vector3() }, uHide: { value: 0 } };
  const mat = bldMaterial(U), tiles = new Map(), col = new THREE.Color(), c2 = new THREE.Color();
  const tile = (x, z) => { const k = Math.floor(x / 300) + ',' + Math.floor(z / 300); if (!tiles.has(k)) tiles.set(k, { p: [], c: [], b: [] }); return tiles.get(k); };
  let tris = 0;
  for (const b of B) {
    const P = b.P, n = P.length; let cx = 0, cy = 0; for (const [x, y] of P) { cx += x; cy += y; } cx /= n; cy /= n;
    let r = 0; for (const [x, y] of P) r = Math.max(r, Math.hypot(x - cx, y - cy));
    const T = tile(cx, -cy), aB = [cx, (b.base + b.top) / 2, -cy, Math.max(r, (b.top - b.base) / 2)];
    const v = (x, y, z, c) => { T.p.push(x, y, -z); T.c.push(c.r, c.g, c.b); T.b.push(...aB); };
    // walls: slightly lighter toward the top, per-building tint
    const wc = col.set(WALLS[b.t % WALLS.length]).multiplyScalar(0.96 + (b.t % 7) * 0.012).clone(), wcTop = wc.clone().lerp(c2.set('#ffffff'), 0.12), wcLow = wc.clone().multiplyScalar(0.86);
    for (let i = 0; i < n; i++) {
      const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % n];
      v(x1, b.base, y1, wcLow); v(x2, b.base, y2, wcLow); v(x2, b.top, y2, wcTop);
      v(x1, b.base, y1, wcLow); v(x2, b.top, y2, wcTop); v(x1, b.top, y1, wcTop); tris += 2;
    }
    if (b.roof === 1 && b.hip) {
      // hipped roof over the oriented rectangle: eaves at wall top (slight overhang), ridge along the long axis
      const { cx: hx, cy: hy, a, L, W, rise } = b.hip, ca = Math.cos(a), sa = Math.sin(a), ov = 0.35;
      const p = (u, w) => [hx + u * ca - w * sa, hy + u * sa + w * ca];
      const hl = L / 2 + ov, hw = W / 2 + ov, rl = Math.max(0, L / 2 - W / 2), y0 = b.top, y1 = b.top + rise;
      const e0 = p(-hl, -hw), e1 = p(hl, -hw), e2 = p(hl, hw), e3 = p(-hl, hw), r0 = p(-rl, 0), r1 = p(rl, 0);
      const rc = col.set(TILE[(b.t >> 1) % TILE.length]).multiplyScalar(0.94 + (b.t % 5) * 0.025).clone(), rs = rc.clone().multiplyScalar(0.82);
      const tri = (A, yA, Bp, yB, Cp, yC, c) => { v(A[0], yA, A[1], c); v(Bp[0], yB, Bp[1], c); v(Cp[0], yC, Cp[1], c); tris++; };
      // counter-clockwise seen from above (route coords are y-north; the z flip keeps the winding outward)
      tri(e0, y0, e1, y0, r1, y1, rc); tri(e0, y0, r1, y1, r0, y1, rc);          // long side -w
      tri(e2, y0, e3, y0, r0, y1, rs); tri(e2, y0, r0, y1, r1, y1, rs);          // long side +w
      tri(e1, y0, e2, y0, r1, y1, rc.clone().multiplyScalar(0.9));                // hip ends
      tri(e3, y0, e0, y0, r0, y1, rs.clone().multiplyScalar(1.05));
      // soffit / ceiling under the overhang so it never reads as a hollow lid from a low camera
      const sc = wc.clone().multiplyScalar(0.7); tri(e0, y0, e2, y0, e1, y0, sc); tri(e0, y0, e3, y0, e2, y0, sc);
    } else {
      const rc = col.set(FLAT[b.t % FLAT.length]).multiplyScalar(0.97 + (b.t % 3) * 0.02).clone();
      const idx = THREE.ShapeUtils.triangulateShape(P.map(([x, y]) => new THREE.Vector2(x, y)), []);
      const ccw = THREE.ShapeUtils.isClockWise(P.map(([x, y]) => new THREE.Vector2(x, y))) ? -1 : 1;
      for (const [i0, i1, i2] of idx) { const a = ccw > 0 ? [i0, i1, i2] : [i0, i2, i1]; for (const i of a) v(P[i][0], b.top, P[i][1], rc); tris++; }
    }
  }
  const meshes = [];
  for (const T of tiles.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(T.p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(T.c, 3)); g.setAttribute('aB', new THREE.Float32BufferAttribute(T.b, 4));
    g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.material.side = THREE.DoubleSide; m.castShadow = m.receiveShadow = true; scene.add(m); meshes.push(m);
  }
  return { U, meshes, list: B, tris, count: B.length };
}
