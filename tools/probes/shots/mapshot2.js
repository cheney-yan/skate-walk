(async () => {
  const M = window.__MAP, P = window.__mapProj, out = {}; document.getElementById('mapBtn').click(); M.follow = false;
  const LM = JSON.parse(localStorage.__lm || 'null') || [["marks_park", -33.8986, 151.2752, 2.2], ["bronte_park", -33.9032, 151.2672, 2.2], ["tamarama", -33.8995, 151.2695, 2.2]];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const [name, lat, lon, z] of LM) { M.cx = (lon - P.lon0) * P.kx; M.cy = -(lat - P.lat0) * P.ky; M.z = z;
    for (const [mode, left, lines] of [["o3d", "o3d", false], ["sat", "ours", false], ["cmp", "o3d", false]]) { M.mode = mode; M.left = left; M.lines = lines; M.v3 = null; window.__drawMap(); await sleep(mode === 'ours' ? 50 : 2500); window.__drawMap(); await sleep(300); window.__drawMap();
      out[name + '_' + mode + (mode === 'cmp' ? left : '') + (lines ? 'L' : '')] = document.getElementById('mapC').toDataURL('image/jpeg', 0.85); } }
  out.satZ = M.satZ; return JSON.stringify(out);
})()