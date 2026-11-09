
(() => { const out = {}; LAB.setTod('real'); LAB.restart(); LAB.runTo(400, 200000); for (let i = 0; i < 12; i++) LAB.adv(1);
  const R = LAB.renderer, sc = LAB.scene, cam = LAB.camera; const m = () => { R.render(sc, cam); const t0 = performance.now(); for (let i = 0; i < 30; i++) R.render(sc, cam); return ((performance.now() - t0) / 30).toFixed(1); };
  out.render = m(); out.calls = R.info.render.calls; out.tris = R.info.render.triangles; return JSON.stringify(out); })()
