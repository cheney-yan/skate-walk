
(() => { const r = LAB.rider(), TH = LAB.THREE, cam = LAB.camera, V = LAB.vrm(), out = {}; LAB.setTod('real'); LAB.restart(); LAB.runTo(330, 60000);
  for (const fs of [0.45, 0]) { LAB.light({ timeOverride: 16.5, farShadow: fs }); for (let i = 0; i < 14; i++) LAB.adv(1);
    const hp = V.humanoid.getRawBoneNode('hips').getWorldPosition(new TH.Vector3()); const f = LAB.track.at(r.s).dir.clone();
    cam.position.copy(hp).addScaledVector(f, -9).add(new TH.Vector3(0, 3.5, 0)); cam.lookAt(LAB.track.at(r.s + 25).p); cam.updateMatrixWorld(); out['far' + fs] = LAB.shot(0.9); }
  LAB.light({ farShadow: 0.45 }); return JSON.stringify(out); })()
