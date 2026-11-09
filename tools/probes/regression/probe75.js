
(() => { const r = LAB.rider(); LAB.restart(); LAB.runTo(380, 300000); let n = 0, stuck = 0, rested = 0, last = r.s, restSeen = false; const modes = {};
  while (r.s < 520 && n < 60 * 200) { LAB.adv(1); n++; modes[r.mode] = (modes[r.mode] || 0) + 1; if (r.rest) restSeen = true; if (n % 300 === 0) { if (r.s - last < 0.5) { if (restSeen) rested++; else stuck++; } last = r.s; restSeen = !!r.rest; } }
  return 'bondi 380->' + r.s.toFixed(0) + ' in ' + (n / 60).toFixed(0) + 's stuckWindows ' + stuck + ' ' + JSON.stringify(modes); })()
