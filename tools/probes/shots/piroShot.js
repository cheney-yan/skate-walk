
(() => { const r = LAB.rider(), TH = LAB.THREE, cam = LAB.camera, V = LAB.vrm(), out = {}; LAB.setTod('noon'); LAB.light({ timeOverride: 15 }); LAB.restart(); LAB.runTo(40, 200000);
  r.stam = 1; let k = 0; while (!r.trickReady && k < 600) { LAB.adv(1); k++; } r.startPirouette('probe'); let n = 0, sh = 0;
  const hips = () => V.humanoid.getRawBoneNode('hips').getWorldPosition(new TH.Vector3());
  while (r.piro && n < 150) { LAB.adv(1); n++; if (n % 6 === 0 && sh < 16) { const h = hips(), f = LAB.track.at(r.s).dir.clone(), sd = new TH.Vector3(-f.z, 0, f.x);
      cam.position.copy(h).addScaledVector(sd, -2.6).addScaledVector(f, 1.6).add(new TH.Vector3(0, 0.3, 0)); cam.lookAt(h.clone().add(new TH.Vector3(0, -0.1, 0))); cam.updateMatrixWorld(); out['p' + String(sh).padStart(2, '0')] = LAB.shot(0.85); sh++; } }
  return JSON.stringify(out); })()
