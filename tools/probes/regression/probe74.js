
(() => { const r = LAB.rider(); const out = []; for (const [s0, s1] of [[0, 372]]) { LAB.restart(); let n = 0, ev0 = 0; while (r.s < s1 - 1 && n < 60 * 300) { LAB.adv(1); n++; }
  const ev = LAB.events().map(e => e[0]); const c = {}; ev.forEach(e => c[e] = (c[e] || 0) + 1); out.push('end ' + r.s.toFixed(0) + ' t ' + (n / 60).toFixed(0) + 's ' + JSON.stringify(c)); }
  return out.join(' | '); })()
