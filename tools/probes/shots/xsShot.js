
(() => { const r = LAB.rider(), TH = LAB.THREE, cam = LAB.camera, V = LAB.vrm(), out = {}; LAB.setTod('real'); LAB.light({ timeOverride: 15 }); LAB.restart(); LAB.runTo(40, 200000);
  r.stam = 1; let k = 0; while ((r.pump || r.push) && k < 300) { LAB.adv(1); k++; } r.startDance('cross'); let n = 0, sh = 0;
  const hips = () => V.humanoid.getRawBoneNode('hips').getWorldPosition(new TH.Vector3());
  while (r.dance && n < 300 && sh < 24) { LAB.adv(1); n++; if (n % 4 === 0) { const h = hips(), f = LAB.track.at(r.s).dir.clone(), sd = new TH.Vector3(-f.z, 0, f.x);
      cam.position.copy(h).addScaledVector(sd, -2.4).addScaledVector(f, 0.3).add(new TH.Vector3(0, 0.1, 0)); cam.lookAt(h.clone().add(new TH.Vector3(0, -0.4, 0))); cam.updateMatrixWorld(); out['x' + String(sh).padStart(2, '0')] = LAB.shot(0.85); sh++; } }
  return JSON.stringify(out); })()
