
(() => { const r = LAB.rider(); LAB.restart(); let n = 0, sitT = 0, rests = 0, was = false, minSt = 1; const o = [];
  while (r.s < 371 && n < 30 * 300) { LAB.adv(1); n++; if (r.rest) { sitT += 1 / 30; if (!was) rests++; } was = !!r.rest; minSt = Math.min(minSt, r.stam);
    if (n % 300 === 0) o.push(r.s.toFixed(0) + ':' + r.mode + (r.pump ? '/pump' : r.push ? '/push' : '') + ' ' + (r.v * 3.6).toFixed(0) + 'kmh st' + (r.stam * 100).toFixed(0)); }
  return 'end ' + r.s.toFixed(0) + ' t' + (n / 30).toFixed(0) + 's rests ' + rests + ' sit ' + sitT.toFixed(1) + 's minStam ' + (minSt * 100).toFixed(0) + '% | ' + o.join(' '); })()
