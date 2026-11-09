
(() => { const r = LAB.rider(), TH = LAB.THREE, cam = LAB.camera, out = {}; LAB.setTod('real'); LAB.light({ timeOverride: 15 }); LAB.restart(); LAB.runTo(150, 200000); for (let i = 0; i < 20; i++) LAB.adv(1);
  for (const s of [150, 900, 1700]) { const t = LAB.track.at(s), L = new TH.Vector3(Math.cos(t.yaw), 0, -Math.sin(t.yaw));
    for (const sd of [1, -1]) { cam.position.copy(t.p).add(new TH.Vector3(0, 6, 0)).addScaledVector(t.dir, -8); cam.lookAt(t.p.clone().addScaledVector(L, sd * 60).add(new TH.Vector3(0, -2, 0))); cam.updateMatrixWorld(); out['sea_' + s + (sd > 0 ? 'L' : 'R')] = LAB.shot(0.85); } }
  return JSON.stringify(out); })()
