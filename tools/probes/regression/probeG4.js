(() => {
  // ground-vs-road probe on the ACTUAL ground mesh vertex buffers (coarse grid + fine corridor lattice), exact triangle interpolation
  const Gs = window.__grounds || []; let coarse = null, fine = null;
  LAB.scene.traverse((o) => { if (o.isMesh && o.geometry.attributes.aCls && !o.userData.shelf) { if (o.geometry.parameters?.widthSegments) coarse = o; else fine = o; } });
  const CP = coarse.geometry.attributes.position.array, cn = CP.length / 3; let nx = 1; while (Math.abs(CP[nx * 3 + 2] - CP[2]) < 1e-3) nx++;
  const ny = cn / nx, x0 = CP[0], z0 = CP[2], st = CP[3] - CP[0], dz = CP[nx * 3 + 2] - CP[2];
  // which coarse cells are still drawn
  const drawn = new Set(), ci = coarse.geometry.index.array; for (let t = 0; t < ci.length; t += 6) { const a = ci[t]; drawn.add((a % nx) + ',' + Math.floor(a / nx)); }
  const FM = new Map(); let fst = 1;
  if (fine) { const P = fine.geometry.attributes.position.array; fst = Math.abs(P[3] - P[0]) || 1; for (let k = 0; k < P.length; k += 3) FM.set(Math.round((P[k] - x0) / 1) + ',' + Math.round((P[k + 2] - z0) / 1), P[k + 1]); }
  const tri = (u, v, h00, h10, h01, h11) => (u >= v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h11 - h01) * u + (h01 - h00) * v);
  const gh = (x, z) => { const fx = (x - x0) / st, fz = (z - z0) / dz, ix = Math.floor(fx), iy = Math.floor(fz); if (ix < 0 || iy < 0 || ix >= nx - 1 || iy >= ny - 1) return -99;
    if (drawn.has(ix + ',' + iy)) { // plane cell: a=(ix,iy) b=(ix,iy+1) c=(ix+1,iy+1) d=(ix+1,iy); faces abd, bcd (diag b-d)
      const H = (i, j) => CP[(i + j * nx) * 3 + 1]; const u = fx - ix, w = fz - iy; // route-oriented: v = 1-w (south->north)
      const v = 1 - w; return tri(u, v, H(ix, iy + 1), H(ix + 1, iy + 1), H(ix, iy), H(ix + 1, iy)); }
    // fine lattice, 1 m in route coords; z grows south, so J index from -z
    const gx = x - x0, gz = z - z0, I = Math.floor(gx), Jz = Math.ceil(gz), u = gx - I, v = Jz - gz;
    const f = (a, b) => FM.get((I + a) + ',' + (Jz - b)); const h00 = f(0, 0), h10 = f(1, 0), h01 = f(0, 1), h11 = f(1, 1);
    if ([h00, h10, h01, h11].some((h) => h === undefined)) return -98; return tri(u, v, h00, h10, h01, h11); };
  window.__gh = gh;
  const T = LAB.track; let worst = -1e9, ws = 0, wo = 0, bad = 0, cnt = 0, holes = 0; const over = [];
  const low = { n: 0, list: [] }, sea = { n: 0, list: [] }, edge = { max: -1e9, over20: 0, n: 0 };
  for (let s = 0; s <= T.total; s += 0.5) { const t = T.at(s), lx = Math.cos(t.yaw), lz = -Math.sin(t.yaw); let segMax = -1e9, segLow = 1e9, segSea = false;
    for (let o = -1.6; o <= 1.6001; o += 0.2) { const g0 = gh(t.p.x + lx * o, t.p.z + lz * o); if (g0 < -90) { holes++; continue; } const g = g0 - t.p.y; cnt++; if (g > 0) bad++; segMax = Math.max(segMax, g); if (g > worst) { worst = g; ws = s; wo = o; } }
    for (const o of [-4.6, -3.6, -2.6, -1.6, 0, 1.6, 2.6, 3.6, 4.6]) { const g = gh(t.p.x + lx * o, t.p.z + lz * o); if (Math.abs(o) <= 2.61) segLow = Math.min(segLow, g - t.p.y); if (g < 0.02) segSea = true; }
    if (segMax > 0) over.push([+s.toFixed(1), +segMax.toFixed(2)]);
    if (segLow < -1) { low.n++; if (low.list.length < 400) low.list.push([+s.toFixed(1), +segLow.toFixed(1)]); }
    if (segSea) { sea.n++; if (sea.list.length < 400) sea.list.push(+s.toFixed(1)); }
    for (const sd of [-1, 1]) for (const e of [0.3, 0.8, 1.5]) { const g = gh(t.p.x + lx * sd * (1.6 + e), t.p.z + lz * sd * (1.6 + e)) - t.p.y; edge.n++; edge.max = Math.max(edge.max, g); if (g > 0.2) edge.over20++; } }
  over.sort((a, b) => b[1] - a[1]);
  const runs = (L) => { const r = []; for (const s of L) { const x = Array.isArray(s) ? s[0] : s; if (r.length && x - r[r.length - 1][1] <= 1.01) r[r.length - 1][1] = x; else r.push([x, x]); } return r; };
  return JSON.stringify({ fine: !!fine, samples: cnt, holes, maxGroundMinusRoad: +worst.toFixed(3), at: [ws, +wo.toFixed(1)], samplesAbove: bad, stretchesAbove: over.length, top: over.slice(0, 8),
    lowerThan1m: low.n, lowRuns: runs(low.list).slice(0, 25), seaWithin3mOfEdge: sea.n, seaRuns: runs(sea.list).slice(0, 25), edge: { max: +edge.max.toFixed(2), over20: edge.over20, n: edge.n } });
})()
