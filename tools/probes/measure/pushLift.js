
(() => { const r = LAB.rider(), V = LAB.THREE.Vector3, H = LAB.vrm().humanoid; const wp = (n) => H.getNormalizedBoneNode(n).getWorldPosition(new V());
  LAB.restart(); let mx = 0, mxAll = [], cur = 0, jerk = 0, a = null, b = null; let wasRec = false;
  for (let i = 0; i < 30 * 8; i++) { LAB.adv(1); const p = r.push; const f = wp('rightFoot'); const h = f.y - r.groundFn(f.x, f.z);
    if (a && b) jerk = Math.max(jerk, f.clone().sub(b.clone().multiplyScalar(2)).add(a).length() * 100); a = b; b = f.clone();
    const rec = p && p.rec; if (rec) cur = Math.max(cur, h); if (wasRec && !rec) { mxAll.push((cur * 100).toFixed(0)); cur = 0; } wasRec = !!rec; }
  return 'recovery peak ankle height above road (cm): ' + mxAll.join(',') + ' | max foot accel ' + jerk.toFixed(1) + ' cm/f2 | v ' + (r.v * 3.6).toFixed(1); })()
