
(() => { const r = LAB.rider(), TH = LAB.THREE, cam = LAB.camera, V = LAB.vrm(), out = {}; LAB.setTod('noon'); LAB.light({ timeOverride: 15 }); LAB.restart(); LAB.runTo(272, 200000);
  let n = 0; while (r.mode !== 'walk' && n < 900) { LAB.adv(1); n++; }
  r.s = 170; r.lat = 0; r.modeT = 0; LAB.adv(3); r.stam = 0.0; r.startRest((s) => LAB.track.at(s)); let k = 0, shots = 0, phs = [];
  const hips = () => V.humanoid.getRawBoneNode('hips').getWorldPosition(new TH.Vector3());
  while (r.rest && k < 30 * 40) { LAB.adv(1); k++; if (!r.rest) break; const ph = r.rest.ph;
    if ((ph === 'turn' || ph === 'sit' || ph === 'up' || ph === 'unturn') && k % 5 === 0 && shots < 32) { const h = hips(), f = LAB.track.at(r.s).dir.clone(), sd = new TH.Vector3(-f.z, 0, f.x);
      const ang = -1; cam.position.copy(h).addScaledVector(sd, 2.2 * ang).addScaledVector(f, 1.4).add(new TH.Vector3(0, 0.6, 0)); cam.lookAt(h.clone().add(new TH.Vector3(0, -0.2, 0))); cam.updateMatrixWorld();
      out['r' + String(shots).padStart(2, '0') + '_' + ph] = LAB.shot(0.85); shots++; } }
  return JSON.stringify(out); })()
