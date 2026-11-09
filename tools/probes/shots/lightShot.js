
(async () => { const r = LAB.rider(), TH = LAB.THREE, cam = LAB.camera, V = LAB.vrm(), out = {}; LAB.setTod('real'); LAB.restart(); LAB.runTo(330, 60000);
  for (const h of [9, 16.5, 22]) { LAB.light({ timeOverride: h }); for (let i = 0; i < 20; i++) LAB.adv(1);
    const hp = V.humanoid.getRawBoneNode('hips').getWorldPosition(new TH.Vector3()); const f = LAB.track.at(r.s).dir.clone(), sd = new TH.Vector3(-f.z, 0, f.x);
    cam.position.copy(hp).addScaledVector(sd, -3.2).addScaledVector(f, 2.2).add(new TH.Vector3(0, 0.7, 0)); cam.lookAt(hp.clone().add(new TH.Vector3(0, -0.1, 0))); cam.updateMatrixWorld(); out['L' + String(h).replace('.', '_') + '_near'] = LAB.shot(0.88);
    cam.position.copy(hp).addScaledVector(f, -9).add(new TH.Vector3(0, 3.5, 0)); cam.lookAt(LAB.track.at(r.s + 25).p); cam.updateMatrixWorld(); out['L' + String(h).replace('.', '_') + '_wide'] = LAB.shot(0.88); }
  return JSON.stringify(out); })()
