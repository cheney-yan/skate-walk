
(() => { const r = LAB.rider(), TH = LAB.THREE, V = LAB.vrm(), H = V.humanoid; LAB.restart(); LAB.runTo(40, 200000);
  r.stam = 1; let k = 0; while (!r.trickReady && k < 600) { LAB.adv(1); k++; } r.startPirouette('probe'); let n = 0; const o = [];
  const wp = (b) => H.getRawBoneNode(b).getWorldPosition(new TH.Vector3());
  const ang = (a, b, c) => { const u = wp(a).sub(wp(b)).normalize(), v = wp(c).sub(wp(b)).normalize(); return Math.acos(Math.max(-1, Math.min(1, u.dot(v)))) * 57.3; };
  while (r.piro && n < 150) { LAB.adv(1); n++; if (n % 6) continue; const ps = r.psP || {};
    const kn = ang('leftUpperLeg', 'leftLowerLeg', 'leftFoot'), span = wp('leftHand').distanceTo(wp('rightHand'));
    const sp = wp('hips'), hd = wp('head'), tilt = Math.atan2(Math.hypot(hd.x - sp.x, hd.z - sp.z), hd.y - sp.y) * 57.3;
    o.push('t' + (n / 30).toFixed(1) + ' u' + (ps.u || 0).toFixed(2) + ' g' + (ps.gather || 0).toFixed(2) + ' knee' + kn.toFixed(0) + ' span' + span.toFixed(2) + ' tilt' + tilt.toFixed(0) + ' spot' + ((r.spotY || 0) * 57.3).toFixed(0) + ' hipOff' + (()=>{ const hp = wp('hips'), lf = wp('leftFoot'), rf = wp('rightFoot'); const c = lf.add(rf).multiplyScalar(0.5); return Math.hypot(hp.x - c.x, hp.z - c.z).toFixed(2); })() + ' feet' + wp('leftFoot').distanceTo(wp('rightFoot')).toFixed(2) + ' bodyQ' + (()=>{ const e = new TH.Euler().setFromQuaternion(r.body.quaternion); return (e.x*57.3).toFixed(0)+','+(e.z*57.3).toFixed(0); })() + ' lean' + ((r.lean||0)*57.3).toFixed(0)); }
  return o.join(' | '); })()
