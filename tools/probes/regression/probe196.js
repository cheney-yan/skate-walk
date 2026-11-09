
(() => { const r = LAB.rider(); LAB.restart(); const o = []; let n = 0, last = -1;
  while (r.s < 300 && n < 30 * 200) { LAB.adv(1); n++; if (Math.floor(r.s / 20) !== last) { last = Math.floor(r.s / 20); o.push('s' + r.s.toFixed(0) + ' ' + r.mode + ' st' + (r.stam * 100).toFixed(0) + ' v' + (r.v * 3.6).toFixed(0)); } }
  return o.join(' | ') + ' || ' + (r.dlog || []).map(d => Math.round(d.s) + ':' + d.msg).join(' / '); })()
