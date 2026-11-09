
(() => { const r = LAB.rider(), TH = LAB.THREE; LAB.restart(); LAB.runTo(268, 300000); let n = 0, worst = 9, ws = 0, cnt = 0, fr = 0;
  const shoes = []; r.vrm.scene.traverse(o => { if (o.isSkinnedMesh) shoes.push(o); });
  const v = new TH.Vector3();
  const lf = r.b.leftFoot, rf = r.b.rightFoot;
  while (r.s < 300 && n < 30 * 60) { LAB.adv(1); n++; if (r.mode !== 'walk' || n % 3) continue; fr++;
    let low = 9;
    for (const m of shoes) { const P = m.geometry.attributes.position; m.skeleton.update();
      for (let i = 0; i < P.count; i += 2) { m.getVertexPosition ? m.getVertexPosition(i, v) : v.fromBufferAttribute(P, i); v.applyMatrix4(m.matrixWorld);
        const fl = lf.getWorldPosition(new TH.Vector3()), fr2 = rf.getWorldPosition(new TH.Vector3());
        if (Math.min(v.distanceTo(fl), v.distanceTo(fr2)) > 0.22 || v.y > Math.min(fl.y, fr2.y) + 0.05) continue;
        const gy = r.groundFn ? r.groundFn(v.x, v.z) : LAB.track.at(r.s).p.y; const d = v.y - gy; if (d < low) low = d; } }
    if (low < -0.005) cnt++; if (low < worst) { worst = low; ws = r.s; } }
  return 'walk frames ' + fr + ' sunk>5mm ' + cnt + ' worst ' + (worst * 100).toFixed(1) + 'cm @' + ws.toFixed(0) + ' grade ' + (Math.atan(LAB.track.at(ws).grade) * 57.3).toFixed(1); })()
