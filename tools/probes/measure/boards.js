
(() => { const r = LAB.rider(), out = [];
  for (const id of ['electric']) { LAB.restart(); LAB.board(id); r.battery = 1; let T = 0, pumpT = 0, pushT = 0, walkT = 0, vs = 0, n = 0, bend = 0, minSt = 1, vMax = 0;
    const s0 = r.s; while (T < 240 && r.s < 1500) { LAB.stepLite(1 / 30); T += 1 / 30; if (r.mode === 'ride') { vs += r.v; n++; vMax = Math.max(vMax, r.v); } if (r.pump && r.pump.A > 0.2) pumpT += 1 / 30; if (r.push) pushT += 1 / 30; if (r.mode === 'walk') walkT += 1 / 30; if (r._bendWas) bend += 1 / 30; minSt = Math.min(minSt, r.stam); }
    const dl = (r.dlog || []).filter((d) => /弯道|电动|换板/.test(d.msg)).slice(-2).map((d) => d.msg).join(' ; ');
    out.push(id + ': ' + Math.round(r.s - s0) + ' m in ' + T.toFixed(0) + ' s, ride avg ' + (vs / Math.max(1, n) * 3.6).toFixed(1) + ' max ' + (vMax * 3.6).toFixed(0) + ' km/h, pump ' + pumpT.toFixed(0) + ' s, push ' + pushT.toFixed(0) + ' s, walk ' + walkT.toFixed(0) + ' s, bend-slow ' + bend.toFixed(0) + ' s, min stamina ' + Math.round(minSt * 100) + '%, battery ' + Math.round(r.battery * 100) + '% | ' + dl); }
  LAB.board('cruiser'); return out.join('\n'); })()
