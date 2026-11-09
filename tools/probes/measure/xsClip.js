
(() => { const r = LAB.rider(), TH = LAB.THREE, V = LAB.vrm(), H = V.humanoid; LAB.restart(); LAB.runTo(40, 200000);
  let k = 0; while ((r.pump || r.push) && k < 300) { LAB.adv(1); k++; } r.startDance('cross'); let n = 0, minD = 9, at = 0, off = 0;
  const wp = (b) => H.getRawBoneNode(b).getWorldPosition(new TH.Vector3());
  const seg = (a1, a2, b1, b2) => { let m = 9; for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) m = Math.min(m, a1.clone().lerp(a2, i / 10).distanceTo(b1.clone().lerp(b2, j / 10))); return m; };
  while (r.dance && n < 400) { LAB.adv(1); n++; const d = seg(wp('leftLowerLeg'), wp('leftFoot'), wp('rightLowerLeg'), wp('rightFoot')); if (d < minD) { minD = d; at = n / 30; } if (d < 0.09) { const F = r.danceFeet(); window.__lowlog = (window.__lowlog || []); if (window.__lowlog.length < 12) window.__lowlog.push((n/30).toFixed(2) + ' d' + (d*100).toFixed(0) + ' k' + F.k + ' lz' + F.lz.toFixed(2) + ' rz' + F.rz.toFixed(2) + ' lx' + F.lx.toFixed(2) + ' rx' + F.rx.toFixed(2)); }
    const inv = r.deck.matrixWorld.clone().invert(); for (const s of ['leftFoot', 'rightFoot']) { const lp = wp(s).applyMatrix4(inv); if (Math.abs(lp.x) > 0.13 && lp.y < 0.25) off++; } }
  return 'min shin-shin distance ' + (minD * 100).toFixed(1) + ' cm @' + at.toFixed(2) + 's (calf radius ~5 cm -> < 10 cm = touching) | foot-off-deck frames ' + off + ' || ' + (window.__lowlog || []).join(' / '); })()
