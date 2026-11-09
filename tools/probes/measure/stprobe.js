(() => { const TH = LAB.THREE, S = window.__streets; if (!S) return 'no streets';
  const P = S.mesh.geometry.attributes.position.array, n = P.length / 3, rc = new TH.Raycaster(), G = window.__grounds;
  let dmin = 1e9, over = [], cnt = 0, bad = 0, maxd = -1e9, mind = 1e9;
  for (let k = 0; k < n; k += 37) { const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
    rc.set(new TH.Vector3(x, y + 30, z), new TH.Vector3(0, -1, 0)); const h = rc.intersectObjects(G, false)[0]; if (!h) continue;
    const d = y - h.point.y; cnt++; maxd = Math.max(maxd, d); mind = Math.min(mind, d); if (d < 0.01 || d > 0.06) bad++; }
  /* clearance to the path centre line (every street vertex vs track pts within 6 m) */
  const T = LAB.track, pts = T.pts, H = new Map(); for (const q of pts) { const key = Math.floor(q.x / 6) + ',' + Math.floor(q.z / 6); if (!H.has(key)) H.set(key, []); H.get(key).push(q); }
  let close = 0; for (let k = 0; k < n; k++) { const x = P[k * 3], z = P[k * 3 + 2]; let best = 1e9; const ci = Math.floor(x / 6), cj = Math.floor(z / 6);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const q of H.get((ci + a) + ',' + (cj + b)) || []) best = Math.min(best, Math.hypot(q.x - x, q.z - z));
    dmin = Math.min(dmin, best); if (best < 1.75) close++; }
  /* surface above the road slab anywhere? street y vs road y at the nearest point */
  return JSON.stringify({ verts: n, tris: S.tris, sampled: cnt, liftMin: +mind.toFixed(3), liftMax: +maxd.toFixed(3), outOfBand: bad, minDistToPathCentre: +dmin.toFixed(2), vertsWithin175: close,
    shelf: window.__shelf ? { tris: window.__shelf.tris } : null, bldTris: window.__bld?.tris, info: (() => { const r = LAB.renderer; return r ? r.info.render : null; })() }); })()
