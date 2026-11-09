
(() => { LAB.restart(); LAB.runTo(30, 60000); const r = LAB.rider(); const t0 = performance.now(); const s0 = r.s; for (let i = 0; i < 300; i++) LAB.stepLite(1 / 30); const ms = (performance.now() - t0) / 300;
  return 'lite step ' + ms.toFixed(2) + ' ms per 1/30 s -> in a 25 ms budget: ' + (25 / ms / 30).toFixed(1) + ' sim-s per frame (= ' + (25 / ms * 2).toFixed(0) + 'x at 60 fps) | moved ' + (r.s - s0).toFixed(0) + ' m in 10 sim-s, v ' + (r.v * 3.6).toFixed(0); })()
