// Longboard + rider controller.
// Layer 1 (board): physics — gravity on slope, rolling resistance, air drag, pushes; lean angle from
//   v^2*kappa/g (a real board steers by leaning), deck tilt, truck steer, wheel spin, ollie ballistics.
// Layer 2 (body): authored pose layers blended by state weights (cruise / push / tuck / effort / ollie /
//   wind / look-back), then 2-bone IK pins both feet to the deck (or the push foot to the ground,
//   world-stationary while in contact, so feet never skate).
import * as THREE from 'three';

const V = THREE.Vector3, Q = THREE.Quaternion;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (cur, tgt, k, dt) => cur + (tgt - cur) * (1 - Math.exp(-k * dt));
const D = Math.PI / 180;

export const DECK_Y = 0.118;          // deck top above ground (m)
const WHEEL_R = 0.035, HALF_WB = 0.31;

export function buildLongboard() {
  const g = new THREE.Group();
  const L = 0.98, W = 0.235;
  const sh = new THREE.Shape();
  // pintail-ish cruiser outline (x = width, y = length)
  sh.moveTo(0, -L / 2);
  sh.bezierCurveTo(W * 0.42, -L / 2, W / 2, -L * 0.3, W / 2, -L * 0.1);
  sh.lineTo(W / 2, L * 0.18);
  sh.bezierCurveTo(W / 2, L * 0.38, W * 0.36, L / 2, 0, L / 2);
  sh.bezierCurveTo(-W * 0.36, L / 2, -W / 2, L * 0.38, -W / 2, L * 0.18);
  sh.lineTo(-W / 2, -L * 0.1);
  sh.bezierCurveTo(-W / 2, -L * 0.3, -W * 0.42, -L / 2, 0, -L / 2);
  const deckGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.011, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.003, bevelSegments: 2, curveSegments: 24 });
  deckGeo.rotateX(-Math.PI / 2);
  const wood = new THREE.MeshStandardMaterial({ color: '#e2c79c', roughness: 0.6 });
  const deck = new THREE.Mesh(deckGeo, wood); deck.position.y = DECK_Y - 0.013; deck.castShadow = true; g.add(deck);
  const gripGeo = new THREE.ShapeGeometry(sh, 24); gripGeo.rotateX(-Math.PI / 2);
  const grip = new THREE.Mesh(gripGeo, new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.95 }));
  grip.position.y = DECK_Y + 0.0006; grip.scale.set(0.97, 1, 0.985); g.add(grip);
  // bottom graphic: soft wave stripe
  const art = new THREE.Mesh(gripGeo.clone(), new THREE.MeshStandardMaterial({ color: '#8fd3d6', roughness: 0.5 }));
  art.rotation.x = Math.PI; art.position.y = DECK_Y - 0.0145; art.scale.set(0.7, 1, 0.55); g.add(art);
  const metal = new THREE.MeshStandardMaterial({ color: '#c9ccd1', metalness: 0.8, roughness: 0.35 });
  const urethane = new THREE.MeshStandardMaterial({ color: '#ffd7a3', roughness: 0.55 });
  const trucks = [];
  for (const z of [HALF_WB, -HALF_WB]) {
    const t = new THREE.Group(); t.position.set(0, DECK_Y - 0.014, z);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.08), metal); base.position.y = -0.006; t.add(base);
    const hanger = new THREE.Group(); hanger.position.y = -0.045; t.add(hanger);
    const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.17, 10), metal); hb.rotation.z = Math.PI / 2; hanger.add(hb);
    const kp = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 8), metal); kp.position.y = 0.022; kp.rotation.x = 0.5; hanger.add(kp);
    const wheels = [];
    for (const x of [-0.105, 0.105]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.046, 20), urethane);
      w.rotation.z = Math.PI / 2; const wg = new THREE.Group(); wg.position.set(x, 0, 0); wg.add(w);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.048, 10), metal); hub.rotation.z = Math.PI / 2; wg.add(hub);
      w.castShadow = true; hanger.add(wg); wheels.push(wg);
    }
    // wheel centre must sit at WHEEL_R above ground
    hanger.position.y = WHEEL_R - (DECK_Y - 0.014);
    g.add(t); trucks.push({ t, hanger, wheels });
  }
  // split: deck parts roll on the bushings, hangers+wheels stay flat on the road
  const deckG = new THREE.Group(); const chassis = new THREE.Group();
  for (const c of [...g.children]) { if (trucks.some((tk) => tk.t === c)) chassis.add(c); else deckG.add(c); }
  for (const tk of trucks) { // baseplate rides with the deck; hanger stays with the chassis
    const base = tk.t.children[0]; tk.t.remove(base); const bp = new THREE.Group(); bp.position.copy(tk.t.position); bp.add(base); deckG.add(bp);
  }
  g.add(chassis, deckG);
  g.userData = { trucks, deck: deckG, chassis };
  return g;
}

const BONES = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'];
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];

export class Rider {
  constructor(vrm, scene) {
    this.vrm = vrm;
    this.board = buildLongboard(); scene.add(this.board);
    this.board.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.deck = this.board.userData.deck;
    this.body = new THREE.Group(); this.deck.add(this.body);   // rider stands on the (rolled) deck
    this.body.add(vrm.scene);
    this.flip = vrm.userData?.vrm0 ? -1 : 1;   // VRM0: model space is mirrored in x/z
    this.yaw0 = this.flip < 0 ? Math.PI : 0;
    vrm.scene.rotation.y = -Math.PI / 2 + this.yaw0;     // regular stance: left shoulder leads, chest faces board's right side
    vrm.scene.position.y = DECK_Y;
    vrm.scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const H = vrm.humanoid; this.b = {};
    for (const n of BONES) this.b[n] = H.getNormalizedBoneNode(n);
    this.fing = [];
    for (const side of ['left', 'right']) for (const f of FINGERS) for (const seg of ['Proximal', 'Intermediate', 'Distal', 'Metacarpal']) {
      const n = H.getNormalizedBoneNode(side + f + seg); if (n) this.fing.push({ n, side, f, seg });
    }
    this.hipRest = this.b.hips.position.clone();
    // state
    this.s = 0; this.v = 0; this.pos = new V(); this.dir = new V(0, 0, 1);
    this.lean = 0; this.tilt = 0; this.steer = 0; this.pitch = 0;
    this.push = null; this.pushCount = 0; this.pushCool = 0;
    this.ollie = null; this.air = 0; this.airV = 0; this.boardPitch = 0;
    this.w = { push: 0, tuck: 0, effort: 0, crouch: 0, wind: 0, look: 0, hair: 0 };
    this.look = null; this.nextLook = 7; this.blinkT = 2; this.t = 0;
    this.windLocal = new V(); this.airRel = new V();
    this.hairHand = null; this.nextHair = 4;
    this.breath = 0; this.footPlant = new V();
    this.camAnchor = new V();
    this.ev = [];
  }

  // track: (s) -> {p:V3 ground point, dir:V3 unit forward, up:V3, grade, kappa}
  update(dt, track, ctx) {
    this.t += dt; const t = this.t;
    const tr = track(this.s), grade = tr.grade, kappa = tr.kappa;
    // ---------------- layer 1: board physics ----------------
    const g = 9.81, m = 52;
    const theta = Math.atan(grade);
    let a = -g * Math.sin(theta) - 0.009 * g * Math.cos(theta) - (0.5 * 1.2 * 0.42 * this.v * this.v) / m;
    // autopilot: cruise target, pushes when slow; speed-check (carve/foot drag) when too fast downhill
    const cruise = ctx.cruise ?? 3.0;
    const holeSoon = (ctx.holes || []).some((h) => h - this.s > 0 && h - this.s < this.v * 0.42 + 0.35 + this.v * 1.3 + 0.5);
    const wantPush = !holeSoon && !this.ollie && this.air <= 0 && (this.v < cruise - 1.3 || (grade > 0.025 && this.v < cruise - 0.4));
    if (!this.push && wantPush && this.pushCool <= 0) this.startPush(grade);
    if (this.push) a += this.pushAccel();
    if (this.v > (ctx.vmax ?? 5.2)) a -= 1.6 * (this.v - (ctx.vmax ?? 5.2)) + 0.8;
    this.pushCool -= dt;
    this.v = Math.max(0, this.v + a * dt);
    this.s += this.v * dt;
    // ollie trigger: obstacle ahead
    if (!this.ollie && ctx.holes) for (const h of ctx.holes) {
      const d = h - this.s, lead = this.v * 0.42 + 0.35;
      if (d > 0 && d < lead + this.v * 0.12 && !this.push) { this.ollie = { t: 0, h }; this.ev.push(['ollie', this.s]); break; }
    }
    // lean from turning physics
    const leanT = clamp(Math.atan((this.v * this.v * kappa) / g) * 1.6, -30 * D, 30 * D);
    this.lean = damp(this.lean, leanT, 6, dt);
    this.tilt = clamp(this.lean * 0.8, -19 * D, 19 * D);   // deck rolls on the bushings, less than the rider leans
    this.steer = damp(this.steer, clamp(Math.atan(kappa * HALF_WB) + this.tilt * 0.35, -0.32, 0.32), 10, dt); // RKP: lean -> hanger yaw
    // ollie ballistics (board + rider leave the ground)
    let popPitch = 0;
    if (this.ollie) {
      const o = this.ollie; o.t += dt;
      if (o.t >= 0.38 && !o.popped) { o.popped = true; this.airV = 2.75; }
      if (o.popped) {
        this.air += this.airV * dt; this.airV -= g * dt;
        if (this.air <= 0 && this.airV < 0) { this.air = 0; this.airV = 0; o.landT = o.landT ?? o.t; }
      }
      // pitch: tail snaps down (nose up) at pop, front foot levels it at apex
      const tp = o.t - 0.38;
      if (tp > -0.05 && tp <= 0.05) popPitch = sstep(-0.05, 0.04, tp) * 28 * D;         // tail snaps down, nose shoots up
      else if (tp > 0.05 && tp <= 0.13) popPitch = 28 * D;                                // rising nose-up
      else if (tp > 0.13 && tp <= 0.32) popPitch = (1 - sstep(0.13, 0.3, tp)) * 28 * D;  // front foot drags it level by the peak
      else if (o.popped && !o.landT && tp > 0.32) popPitch = -2 * D + Math.min(0, this.airV) * -0.012; // level, tail a touch low on the way down
      if (o.landT && o.t - o.landT > 0.6) this.ollie = null;
    }
    this.boardPitch = damp(this.boardPitch, popPitch, 40, dt);
    // place board
    const up = new V(0, 1, 0);
    this.pos.copy(tr.p).addScaledVector(up, this.air);
    this.dir.copy(tr.dir);
    const yaw = Math.atan2(tr.dir.x, tr.dir.z);
    this.pitch = damp(this.pitch, Math.atan(grade), 12, dt);
    const qY = new Q().setFromAxisAngle(up, yaw);
    const qP = new Q().setFromAxisAngle(new V(1, 0, 0), -this.pitch - this.boardPitch);
    const qR = new Q().setFromAxisAngle(new V(0, 0, 1), -this.tilt);
    this.board.position.copy(this.pos);
    // pop: the tail drops until its tip strikes the road, then the board pivots on the tail (centre rises);
    // board height = max(ballistic air, tail-on-ground pivot lift) so the tail never goes through the ground
    const th = this.boardPitch, tailLift = Math.max(0, 0.49 * Math.sin(th) - 0.105 * (1 - Math.cos(th)) - 0.095);
    this.board.position.y = tr.p.y + Math.max(this.air, tailLift);
    this.board.quaternion.copy(qY).multiply(qP);
    const PIV = new V(0, DECK_Y - 0.05, 0);
    this.deck.quaternion.copy(qR);
    this.deck.position.copy(PIV).sub(PIV.clone().applyQuaternion(qR));
    // rider frame: stay ~upright against slope pitch, lean with the turn beyond deck tilt
    this.body.quaternion.setFromEuler(new THREE.Euler(this.pitch + this.boardPitch * 0.85, 0, -(this.lean - this.tilt), 'XYZ'));
    // wheels + trucks
    for (const [k, tk] of this.board.userData.trucks.entries()) {
      tk.hanger.rotation.y = (k === 0 ? 1 : -1) * this.steer;
      for (const w of tk.wheels) w.rotation.x += (this.v * dt) / WHEEL_R;
    }
    // wind relative to rider (board frame)
    const wind = ctx.wind || new V();
    const vel = tr.dir.clone().multiplyScalar(this.v);
    this.airRel.copy(wind).sub(vel);
    const inv = new Q().copy(qY).invert();
    this.windLocal.copy(wind).applyQuaternion(inv);    // board frame: +x left, +z forward

    // ---------------- layer 2: body ----------------
    this.stateWeights(dt, grade, ctx);
    this.pose(dt, ctx);
    this.board.updateMatrixWorld(true);
    this.solveLegs(dt);
    this.events(dt, ctx);
    this.vrm.update(dt);
  }

  startPush(grade) {
    const T = grade > 0.03 ? 0.92 : 1.12;
    this.push = { t: 0, T, contact: null };
    this.pushCount++;
  }
  pushAccel() {
    const p = this.push;
    // contact window inside the cycle
    const c0 = 0.3 * p.T, c1 = c0 + clamp(0.42 / Math.max(this.v, 0.6), 0.16, 0.36);
    p.c0 = c0; p.c1 = c1;
    return p.t > c0 && p.t < c1 && !p.abort ? 2.9 : 0;
  }

  stateWeights(dt, grade, ctx) {
    const w = this.w;
    if (this.push) {
      this.push.t += dt;
      if (this.push.t >= this.push.T) {
        this.push = null; this.pushCool = 0.25;
      }
    }
    w.push = damp(w.push, this.push ? 1 : 0, 7, dt);
    w.tuck = damp(w.tuck, sstep(-0.02, -0.06, grade) * sstep(2.6, 4.2, this.v), 2.5, dt);
    w.effort = damp(w.effort, sstep(0.02, 0.055, grade), 2, dt);
    const wl = this.windLocal; const ws = Math.hypot(wl.x, wl.z);
    w.wind = damp(w.wind, sstep(1.5, 6, ws), 1.5, dt);
    // look-back: occasionally turn over the trailing (right) shoulder toward the camera
    this.nextLook -= dt;
    if (!this.look && this.nextLook <= 0 && !this.push && !this.ollie && Math.abs(this.lean) < 8 * D && w.tuck < 0.3 && w.effort < 0.5) {
      this.look = { t: 0, T: 2.6 }; this.ev.push(['look', this.s]);
    }
    if (this.nextLook <= 0 && !this.look) this.nextLook = 0.5;
    let lk = 0;
    if (this.look) {
      this.look.t += dt; const u = this.look.t;
      lk = sstep(0, 0.55, u) * (1 - sstep(this.look.T - 0.6, this.look.T, u));
      if (u > this.look.T) { this.look = null; this.nextLook = ctx.lookEvery ?? (14 + Math.random() * 8); }
    }
    w.look = lk;
    // hand tucks hair in sustained wind
    this.nextHair -= dt;
    if (!this.hairHand && w.wind > 0.55 && this.nextHair <= 0 && !this.push && !this.look && !this.ollie && w.tuck < 0.3) { this.hairHand = { t: 0, T: 2.0 }; this.ev.push(['hair', this.s]); }
    let hh = 0;
    if (this.hairHand) { this.hairHand.t += dt; const u = this.hairHand.t; hh = sstep(0, 0.45, u) * (1 - sstep(this.hairHand.T - 0.5, this.hairHand.T, u)); if (u > this.hairHand.T) { this.hairHand = null; this.nextHair = 9; } }
    w.hair = hh;
  }

  rot(name, x, y, z) { const b = this.b[name]; if (!b) return; b.quaternion.setFromEuler(new THREE.Euler(x, y, z, 'YXZ')); if (this.flip < 0) { b.quaternion.x *= -1; b.quaternion.z *= -1; } }

  pose(dt, ctx) {
    const w = this.w, t = this.t, b = this.b;
    const P = this.push ? this.push.t / this.push.T : 0;
    // push sub-phase envelope: down (0..0.3 reach), contact, recover
    const reach = this.push ? sstep(0.05, 0.32, P) * (1 - sstep(0.7, 0.98, P)) : 0;
    const ol = this.ollie ? this.ollie.t : -1;
    // ollie body phases (from longboard-ollie reference: deep ~90° knee wind-up, explosive extension with arms
    // sweeping up, knees pulled toward chest in the air, then reach down and absorb on landing)
    const OP = 0.38;
    const crouchO = ol >= 0 ? (ol < OP ? sstep(0, OP * 0.9, ol) : 0) : 0;                 // wind-up
    const extend = ol >= OP && ol < OP + 0.12 ? Math.sin(((ol - OP) / 0.12) * Math.PI) : 0; // explosive extension
    const tuckAir = ol >= OP + 0.08 && this.air > 0 ? sstep(OP + 0.08, OP + 0.2, ol) * (1 - sstep(0.75, 1, -this.airV / 2.75)) : 0;
    const landAbs = this.ollie && this.ollie.landT ? Math.sin(Math.min(1, (ol - this.ollie.landT) / 0.18) * Math.PI / 2) * (1 - sstep(0.18, 0.6, ol - this.ollie.landT)) : 0;
    const carve = clamp(this.lean / 0.16, -1, 1), heel = Math.max(0, carve), toe = Math.max(0, -carve);
    this.carve = carve;
    const crouchT = clamp(heel * 0.38 + toe * 0.3 + w.tuck * 1.05 + crouchO * 1.55 - extend * 0.2 + tuckAir * 1.15 + landAbs * 1.1 + w.effort * 0.25 + reach * 0.15, -0.35, 1.6);
    this.crouch = damp(this.crouch ?? crouchT, crouchT, this.ollie ? 18 : 9, dt);
    const breathe = Math.sin(t * (w.effort > 0.3 ? 4.2 : 1.6)) * (0.012 + w.effort * 0.03);
    // ---- hips placement (vrm model frame: +z facing, +x = board forward)
    const sway = Math.sin(t * 0.9) * 0.008;
    const hipX = 0.0 + reach * 0.1 - w.tuck * 0.02 + this.windLocal.z * -0.002;   // over the front foot when pushing
    this.oTuck = tuckAir;
    this.oDrop = damp(this.oDrop ?? 0, crouchO * 0.16 + tuckAir * 0.27 + landAbs * 0.12, 22, dt);
    const hipDrop = 0.06 + this.oDrop + w.effort * 0.05 + this.crouch * 0.17 + reach * 0.2 + breathe * 0.3;
    const hipZ = 0.015 + reach * 0.06 - w.tuck * 0.03 + w.effort * 0.02 - heel * 0.06 + toe * 0.035;
    b.hips.position.set(this.hipRest.x + hipX * this.flip, this.hipRest.y - hipDrop, this.hipRest.z + (hipZ + sway) * this.flip);
    // ---- torso: open toward the nose; push opens fully; look-back twists the other way
    const open = 30 * D + reach * 34 * D + w.tuck * 6 * D;
    const lb = w.look;
    const leanIn = -this.windSideLean() ;
    this.rot('hips', 0.0 + w.tuck * 0.15, open * 0.6 - lb * 12 * D, leanIn * 0.3);
    const fwd = -0.02 + heel * 0.28 + toe * 0.05 + w.tuck * 0.48 + w.effort * 0.5 + reach * 0.32 + crouchO * 0.42 + tuckAir * 0.3 - extend * 0.15 + landAbs * 0.35;
    this.rot('spine', fwd * 0.45 + breathe, open * 0.2 - lb * 18 * D, leanIn * 0.4 + Math.sin(t * 0.7) * 0.01);
    this.rot('chest', fwd * 0.35 - breathe * 0.5, open * 0.2 - lb * 28 * D, leanIn * 0.3);
    this.rot('upperChest', fwd * 0.2 - breathe, -lb * 14 * D, 0);
    // head: keep gaze on the travel line (yaw toward +x), look back over right shoulder
    const totalYaw = open * 1.0 + 0;
    const headYawFwd = 84 * D - totalYaw;
    const headYaw = lerp(headYawFwd, -72 * D, lb);
    const headPitch = -fwd * 0.55 - 0.06 + w.effort * 0.12 - lb * 0.05 + (this.windLocal.z < -2 ? 0.06 : 0);
    this.rot('neck', headPitch * 0.4, headYaw * 0.45, lb * 9 * D);
    this.rot('head', headPitch * 0.6 + lb * 0.08, headYaw * 0.55, lb * 12 * D + Math.sin(t * 0.6) * 0.02);
    // ---- arms: relaxed, swinging; balance out on tuck/landing; right hand to hair in wind
    const bal = clamp(w.tuck * 0.9 + crouchO * 0.5 + tuckAir * 1.2 + landAbs * 0.8 + Math.abs(this.lean) * 1.2, 0, 1);
    const swing = this.push ? Math.sin(P * Math.PI * 2) * 0.45 * w.push : Math.sin(t * 1.1) * 0.03;
    // ARMS — two poses + an envelope.
    //  rest: hang relaxed by the sides (soft elbows, tiny swing from the body), like someone just riding along;
    //  active: open for balance (lead arm forward-low, trail arm back-low, port-de-bras).
    //  need = how much balance the moment demands; arms rise fast (~0.25 s), then settle down slowly (~1.5 s).
    const hh = w.hair;
    const need = clamp(Math.max(bal, w.push * (0.35 + 0.4 * w.effort), w.effort * 0.6, Math.abs(carve) * 0.95, crouchO * 1.1, tuckAir * 1.2, landAbs, w.tuck * 0.9, (this.gust || 0) * 0.5), 0, 1);
    this.armUp = this.armUp ?? 0;
    if (need > this.armUp) this.armUp = damp(this.armUp, need, 9, dt);           // quick rise
    else { this.armHold = (this.armHold ?? 0) + dt; if (this.armHold > 0.6) this.armUp = damp(this.armUp, need, 1.3, dt); } // linger, then lower
    if (need > this.armUp - 0.02) this.armHold = 0;
    const up = this.armUp;
    const brz = Math.sin(t * 0.73) * 0.05, brz2 = Math.sin(t * 0.57 + 1.3) * 0.06;
    const bodySw = Math.sin(t * 1.6) * 0.04 + this.lean * 0.4;   // passive pendulum with the body
    const A = this.armT || (this.armT = {});
    const rest = { lx: 0.06, ly: -0.12 + bodySw, lz: -72 * D, le: -0.32, lw: -0.12 + brz2 * 0.5,
                   rx: 0.06, ry: 0.12 + bodySw, rz: 72 * D, re: 0.32, rw: 0.12 - brz * 0.5 };
    const act = {
      lx: 0.12 + brz * 0.5, ly: -0.55 - bal * 0.25 + swing * 0.3 - heel * 0.5 + toe * 0.3 - w.tuck * 0.2,
      lz: -22 * D + bal * 12 * D + heel * 10 * D + w.effort * 8 * D + brz,
      le: -0.75 - bal * 0.2 - w.effort * 0.5 - heel * 0.2, lw: -0.3 + brz2,
      rx: 0.1, ry: 0.55 + bal * 0.2 - swing * 0.6 + heel * 0.5 - toe * 0.3 + w.tuck * 0.2,
      rz: 24 * D - bal * 12 * D - heel * 10 * D - w.effort * 8 * D + brz2,
      re: 0.85 + bal * 0.2 + w.effort * 0.5 + heel * 0.2 + Math.max(0, -swing) * 0.4, rw: 0.28 - brz,
    };
    // ollie: arms drop low/back in the wind-up, sweep up through the pop, spread wide at shoulder height in the air
    const sweep = clamp(extend + tuckAir, 0, 1), load = crouchO * (1 - sweep);
    act.lz += (-8 * D) * load + (34 * D) * sweep; act.rz += (8 * D) * load - (34 * D) * sweep;
    act.ly += 0.25 * load - 0.15 * sweep; act.ry += -0.25 * load + 0.15 * sweep;
    act.le *= 1 - 0.45 * sweep; act.re *= 1 - 0.45 * sweep;
    const hair = { rx: -0.2, ry: 1.25, rz: 20 * D, re: 2.3, rw: -0.2 };
    const tgt = {};
    for (const k in rest) { tgt[k] = lerp(rest[k], act[k], up); if (k[0] === 'r' && hair[k] !== undefined) tgt[k] = lerp(tgt[k], hair[k], hh); }
    // follow-through: elbows/wrists lag the upper arm, so the hand trails when the arm rises or falls
    for (const k in tgt) A[k] = A[k] === undefined ? tgt[k] : damp(A[k], tgt[k], k.endsWith('w') ? 2.6 : k.endsWith('e') ? 3.8 : 5.5, dt);
    this.rot('leftShoulder', 0, 0, -0.04 * bal);
    this.rot('leftUpperArm', A.lx, A.ly, A.lz);
    this.rot('leftLowerArm', 0, A.le, 0);
    this.rot('leftHand', 0.25, -0.1, A.lw - 0.15);
    this.rot('rightShoulder', 0, 0, 0.05 * hh);
    this.rot('rightUpperArm', A.rx, A.ry, A.rz);
    this.rot('rightLowerArm', 0, A.re, 0);
    this.rot('rightHand', 0.25 * (1 - hh), lerp(0.1, 0.5, hh), A.rw + 0.15 * (1 - hh));
    // fingers softly curled (graceful hands)
    for (const f of this.fing) {
      const sgn = f.side === 'left' ? -1 : 1;
      const k = f.f === 'Thumb' ? 0.15 : f.seg === 'Proximal' ? 0.25 + (f.f === 'Little' ? 0.15 : 0) : f.seg === 'Metacarpal' ? 0 : 0.3;
      if (f.f === 'Thumb') f.n.quaternion.setFromEuler(new THREE.Euler(0, sgn * -0.25, 0));
      else f.n.quaternion.setFromEuler(new THREE.Euler(0, 0, sgn * k));
      if (this.flip < 0) { f.n.quaternion.x *= -1; f.n.quaternion.z *= -1; }
    }
    // legs get a pre-bend so IK picks the right knee plane
    for (const s of ['left', 'right']) { this.rot(s + 'UpperLeg', -0.25, 0, 0); this.rot(s + 'LowerLeg', 0.5, 0, 0); }
    // expressions
    const E = this.vrm.expressionManager;
    if (E) {
      this.blinkT -= dt;
      let bl = 0; if (this.blinkT < 0.14) bl = Math.sin(clamp(this.blinkT / 0.14, 0, 1) * Math.PI);
      if (this.blinkT <= 0) this.blinkT = 2.5 + Math.random() * 3.5;
      const squint = w.wind * (this.windLocal.z < -1.5 ? 0.35 : 0.12);
      E.setValue('blink', clamp((bl + squint) * (1 - lb * 0.9), 0, 1));
      E.setValue('happy', clamp(lb * 0.32, 0, 1));
      E.setValue('relaxed', clamp(0.22 + lb * 0.1 - w.effort * 0.2, 0, 1));
      E.setValue('ih', lb * 0.12);
      E.setValue('aa', w.effort * (0.1 + 0.1 * Math.max(0, Math.sin(t * 4.2))));
    }
    if (this.vrm.lookAt) this.vrm.lookAt.target = lb > 0.4 && ctx.camera ? ctx.camera : null;
  }
  windSideLean() {
    // lean (model roll) into a crosswind; board frame +x = left
    return clamp(this.windLocal.x * 0.012, -0.08, 0.08);
  }

  // ---------------- IK ----------------
  solveLegs(dt) {
    const B = this.b, bw = (o) => o.getWorldPosition(new V());
    const deck = (x, z, y = DECK_Y + 0.093) => this.deck.localToWorld(new V(x, y, z));
    // feet stance on deck (board frame: z forward): front (left) foot over front bolts, back (right) over tail
    const P = this.push ? this.push.t / this.push.T : 0;
    const pr = this.push ? sstep(0.0, 0.25, P) * (1 - sstep(0.78, 1.0, P)) : 0;
    let lf = deck(0.015, 0.2 + pr * 0.04), rf = deck(-0.01, -0.21);
    let rYaw = -78 * D, lYaw = lerp(-50 * D, -12 * D, pr);
    let rPitch = 0;
    if (this.ollie) { // back foot to the tail during the crouch, front foot slides toward the nose after the pop
      const o = this.ollie.t; const tail = sstep(0.0, 0.3, o) * (1 - sstep(0.6, 0.9, o)), slide = sstep(0.36, 0.55, o) * (1 - sstep(0.75, 1.05, o));
      rf = deck(-0.01, -0.21 - tail * 0.13); lf = deck(0.015, 0.2 + slide * 0.17, DECK_Y + 0.093 + slide * 0.008); rYaw = -80 * D; lYaw = -65 * D;
    }
    if (this.push && !this.ollie) {
      const p = this.push; const c0 = p.c0 ?? 0.3 * p.T, c1 = p.c1 ?? c0 + 0.3; const tt = p.t;
      if (tt < c0) { // lift off deck, swing down beside the front wheels (toe side = -x)
        const u = sstep(0, c0, tt);
        const a = deck(-0.01, -0.21), bpt = this.groundAt(-0.29, 0.1);
        rf = a.clone().lerp(bpt, u); rf.y += Math.sin(u * Math.PI) * 0.06;
        this.footPlant.copy(bpt);
        rYaw = lerp(-78 * D, -5 * D, u);
      } else if (tt < c1 && !p.abort) { // planted: world-stationary
        rf = this.footPlant.clone(); rYaw = -5 * D; rPitch = -0.12 * sstep(c0, c1, tt);
      } else { // recover: lift heel, come back to tail
        if (!p.rec) { p.rec = this.footPlant.clone(); p.recT = tt; }
        const u = sstep(p.recT, p.T * 0.98, tt);
        const back = deck(-0.01, -0.21);
        rf = p.rec.clone().lerp(back, u); rf.y += Math.sin(u * Math.PI) * 0.11; rYaw = lerp(-5 * D, -78 * D, u); rPitch = lerp(-0.35, 0, u);
      }
    }
    const fwdModel = new V(0, 0, this.flip).applyQuaternion(this.vrm.scene.getWorldQuaternion(new Q()));
    for (const [side, target, yaw, pitch] of [['left', lf, lYaw, 0], ['right', rf, rYaw, rPitch]]) {
      const up = B[side + 'UpperLeg'], lo = B[side + 'LowerLeg'], ft = B[side + 'Foot'];
      const hip = bw(up);
      const pole = hip.clone().addScaledVector(fwdModel, 1.0).add(new V(0, -0.4 + (this.oTuck || 0) * 0.5, 0));
      // splay knees slightly outward over their feet
      const along = target.clone().sub(hip); pole.addScaledVector(along.setY(0).normalize(), 0.25);
      twoBoneIK(up, lo, ft, target, pole);
      // foot flat on deck, toes angled
      const qb = this.deck.getWorldQuaternion(new Q());
      const qf = qb.clone().multiply(new Q().setFromEuler(new THREE.Euler(pitch * this.flip, yaw + this.yaw0, 0, 'YXZ')));
      setWorldQuat(ft, qf);
      const toes = B[side + 'Toes']; if (toes) toes.quaternion.identity();
      ft.updateMatrixWorld(true);
    }
  }
  groundAt(x, z) { const p = this.board.localToWorld(new V(x, 0, z)); p.y = this.groundFn ? this.groundFn(p.x, p.z) + 0.093 : this.pos.y - this.air + 0.093; return p; }
  groundY() { return 0; }

  events() {}
}

function setWorldQuat(bone, q) {
  const pq = bone.parent.getWorldQuaternion(new Q());
  bone.quaternion.copy(pq.invert().multiply(q));
}
function aim(bone, child, target) {
  bone.updateMatrixWorld(true);
  const bp = bone.getWorldPosition(new V()), cp = child.getWorldPosition(new V());
  const from = cp.sub(bp).normalize(), to = target.clone().sub(bp).normalize();
  const dq = new Q().setFromUnitVectors(from, to);
  const wq = bone.getWorldQuaternion(new Q());
  setWorldQuat(bone, dq.multiply(wq));
  bone.updateMatrixWorld(true);
}
export function twoBoneIK(up, lo, ft, target, pole) {
  up.updateMatrixWorld(true);
  const A = up.getWorldPosition(new V()), Bp = lo.getWorldPosition(new V()), C = ft.getWorldPosition(new V());
  const a = A.distanceTo(Bp), b = Bp.distanceTo(C);
  let d = A.distanceTo(target); d = clamp(d, 0.05, a + b - 0.004);
  const dir = target.clone().sub(A).normalize();
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const pv = pole.clone().sub(A); const perp = pv.sub(dir.clone().multiplyScalar(pv.dot(dir))).normalize();
  const K = A.clone().addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
  aim(up, lo, K);
  const tgt = A.clone().addScaledVector(dir, d);
  aim(lo, ft, tgt);
}
