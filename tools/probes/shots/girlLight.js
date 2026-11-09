
(() => { const r = LAB.rider(), TH = LAB.THREE, cam = LAB.camera, V = LAB.vrm(), out = {}; LAB.setTod('real'); LAB.restart(); LAB.runTo(60, 200000);
  for (const h of [16.5]) { LAB.light({ timeOverride: h, cloudOverride: 0.1 }); for (let i = 0; i < 6; i++) LAB.adv(1);
    const hp = V.humanoid.getRawBoneNode('hips').getWorldPosition(new TH.Vector3()), f = LAB.track.at(r.s).dir.clone(), sd = new TH.Vector3(-f.z, 0, f.x);
    for (const [nm, a, b] of [['L', 1, 0.6], ['R', -1, 0.6], ['F', 0, 2.4]]) { cam.position.copy(hp).addScaledVector(sd, a * 2.3).addScaledVector(f, b).add(new TH.Vector3(0, 0.25, 0)); cam.lookAt(hp.clone().add(new TH.Vector3(0, -0.05, 0))); cam.updateMatrixWorld(); out['g' + h + nm] = LAB.shot(0.88); } }
  return JSON.stringify(out); })()
