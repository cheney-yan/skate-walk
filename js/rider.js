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

export const DECK_Y = 0.118;
export const EMAX = 15000;   // J (metabolic): full stamina bar. Muscle efficiency ~25% -> metabolic = mechanical work / 0.25
const EFF = 0.25, P_AERO = 230;   // W: what her aerobic system refills continuously; above it she spends the bar, below it she refills          // deck top above ground (m)
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
    // rider root lives in the scene: follows the deck while riding, the ground while walking (blend m)
    this.root = new THREE.Group(); scene.add(this.root);
    this.body = new THREE.Group(); this.root.add(this.body);
    this.deckF = new THREE.Object3D(); this.walkF = new THREE.Object3D();
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
    this.mode = 'ride'; this.modeT = 0; this.seq = null; this.m = 0; this.face = 0; this.carry = 0; this.lat = 0; this.phi = 0;
    this.stam = 0.7; this.spin = 0; this.bend = 0; this.armIKw = 0; this.armIKt = new V(); this.footTap = 0; this.tapPt = new V(); this.drag = 0;
  }

  // track: (s) -> {p:V3 ground point, dir:V3 unit forward, up:V3, grade, kappa}
  update(dt, track, ctx) {
    this.t += dt; this.modeT += dt; this.track = this.track || null;
    const tr = track(this.s), grade = tr.grade, kappa = tr.kappa;
    const g = 9.81, m = 52, theta = Math.atan(grade), TAN6 = Math.tan(6 * D);
    // STAMINA (蓄力槽) in joules of spare mechanical work, EMAX = full bar.
    // spent: push work F·v (F = m·a_push), walking uphill m·g·v·sinθ (×0.5, walking is efficient), ollie/trick jump energy;
    // recovered: resting on the board ~40 W (downhill coast 55 W), standing/walking on the flat ~30 W.
    let spend = 0;
    const brake = this.mode === 'off' && this.seq.ph === 'brake';
    if (this.mode === 'ride' || brake) {
      let a = -g * Math.sin(theta) - 0.009 * g * Math.cos(theta) - (0.5 * 1.2 * 0.42 * this.v * this.v) / m;
      if (this.mode === 'ride') {
        const cruise = ctx.cruise ?? 3.0, vmax = ctx.vmax ?? 5.2;
        const holeSoon = (ctx.holes || []).some((h) => h - this.s > 0 && h - this.s < this.v * 0.42 + 0.35 + this.v * 1.3 + 0.5);
        const wantPush = this.stam > 0.02 && !holeSoon && !this.ollie && this.air <= 0 && (this.v < cruise - 1.3 || (grade > 0.025 && this.v < cruise - 0.4));
        if (!this.push && wantPush && this.pushCool <= 0) this.startPush(grade);
        const BASE = 110;   // W metabolic just standing balanced on a rolling board
        if (this.push) { const pa = this.pushAccel(); a += pa; spend += (m * pa * Math.max(this.v, 0.5) / EFF) * dt; }
        spend += (BASE - P_AERO) * dt;
        if (this.v > vmax) a -= 1.6 * (this.v - vmax) + 0.8;          // carve / foot-drag speed check
        this.pushCool -= dt; this.trickCool = (this.trickCool ?? 6) - dt;
        const ahead = Math.max(track(this.s + 1).grade, track(this.s + this.v * 1.6 + 2).grade);
        if (!this.ollie && this.air <= 0 && !this.push) {
          if (ahead > TAN6) this.startOff('steep');
          else if (this.stam <= 0.02 && (grade > 0.02 || this.v < 1.0)) this.startOff('tired');
          else if (!holeSoon && this.v > vmax - 0.05 && grade < -0.02 && this.stam > 0.3 && this.trickCool <= 0) this.startTrick('speed');
          else if (!holeSoon && this.stam >= 0.999 && Math.abs(grade) < 0.03 && this.v > 2.2 && this.trickCool <= 0) this.startTrick('full');
        }
      } else a -= this.seq.decel;
      this.v = Math.max(0, this.v + a * dt);
      this.s += this.v * dt;
      if (this.mode === 'ride' && !this.ollie && ctx.holes) for (const h of ctx.holes) {
        const d = h - this.s, lead = this.v * 0.42 + 0.35;
        if (d > 0 && d < lead + this.v * 0.12 && !this.push) { this.ollie = { t: 0, h }; this.stam -= (m * g * 0.35 / EFF) / EMAX; this.ev.push(['ollie', this.s]); break; }
      }
    } else if (this.mode === 'walk') {
      this.v = damp(this.v, grade > 0.03 ? 1.0 : 1.3, 2, dt); this.s += this.v * dt; this.phi += this.v * dt / 1.1;
      spend += ((m * g * this.v * Math.max(0, Math.sin(theta))) / EFF * 0.6 + 170 - P_AERO) * dt;   // walking ~170 W + climb work (walking up stairs/hills is efficient)
      const ahead = Math.max(grade, track(this.s + 1.5).grade, track(this.s + 5).grade);
      if (ahead < 0.07 && this.modeT > 2.5 && this.stam > (this.offWhy === 'steep' ? 0.05 : 0.25)) this.startOn();
    } else { if (!brake) this.v = this.mode === 'on' ? this.v : 0; spend += (130 - P_AERO) * dt; if (this.mode === 'on') this.s += this.v * dt; }
    this.stam = clamp(this.stam - spend / EMAX, 0, 1);
    this.stepSeq(dt, track);
    const riding = this.mode === 'ride' || (this.mode === 'off' && this.seq?.ph === 'brake');
    // lean from turning physics (only on the board)
    const leanT = riding ? clamp(Math.atan((this.v * this.v * kappa) / g) * 1.6, -30 * D, 30 * D) : 0;
    this.lean = damp(this.lean, leanT, 6, dt);
    this.tilt = clamp(this.lean * 0.8, -19 * D, 19 * D);
    this.steer = damp(this.steer, riding ? clamp(Math.atan(kappa * HALF_WB) + this.tilt * 0.35, -0.32, 0.32) : 0, 10, dt);
    // ollie / shove-it ballistics
    let popPitch = 0; this.spin = 0; this.footLift = 0;
    if (this.ollie) {
      const o = this.ollie, sh = o.kind === 'shove'; o.t += dt;
      if (o.t >= 0.38 && !o.popped) { o.popped = true; this.airV = sh ? 2.5 : 2.75; }
      if (o.popped) {
        this.air += this.airV * dt; this.airV -= g * dt;
        if (this.air <= 0 && this.airV < 0) { this.air = 0; this.airV = 0; if (!o.landT) { o.landT = o.t; if (o.why === 'speed') this.v *= 0.72; } }
      }
      const tp = o.t - 0.38, ps = sh ? 0.45 : 1;
      if (tp > -0.05 && tp <= 0.05) popPitch = sstep(-0.05, 0.04, tp) * 28 * D * ps;
      else if (tp > 0.05 && tp <= 0.13) popPitch = 28 * D * ps;
      else if (tp > 0.13 && tp <= 0.32) popPitch = (1 - sstep(0.13, 0.3, tp)) * 28 * D * ps;
      else if (o.popped && !o.landT && tp > 0.32) popPitch = -2 * D + Math.min(0, this.airV) * -0.012;
      if (sh) { this.spin = (o.dir || 1) * 2 * Math.PI * sstep(0.04, 0.36, tp); this.footLift = Math.sin(clamp((tp - 0.0) / 0.42, 0, 1) * Math.PI) * 0.08; }
      if (o.landT && o.t - o.landT > 0.6) this.ollie = null;
    }
    this.boardPitch = damp(this.boardPitch, popPitch, 40, dt);
    const up = new V(0, 1, 0), yaw = Math.atan2(tr.dir.x, tr.dir.z);
    this.dir.copy(tr.dir);
    this.pitch = damp(this.pitch, riding ? Math.atan(grade) : 0, 12, dt);
    const qY = new Q().setFromAxisAngle(up, yaw + (this.slideYaw || 0));
    if (riding) {
      this.pos.copy(tr.p).addScaledVector(up, this.air);
      const qP = new Q().setFromAxisAngle(new V(1, 0, 0), -this.pitch - this.boardPitch);
      const qR = new Q().setFromAxisAngle(new V(0, 0, 1), -this.tilt);
      this.board.position.copy(this.pos);
      const th = this.boardPitch, tailLift = Math.max(0, 0.49 * Math.sin(th) - 0.105 * (1 - Math.cos(th)) - 0.095);
      this.board.position.y = tr.p.y + Math.max(this.air, tailLift);
      this.board.quaternion.copy(qY).multiply(qP);
      const PIV = new V(0, DECK_Y - 0.05, 0);
      this.deck.quaternion.copy(qR);
      this.deck.position.copy(PIV).sub(PIV.clone().applyQuaternion(qR));
    } else if (this.seq?.bPos && this.boardFixed && !(this.mode === 'off' && this.seq.ph === 'pick' && this.seq.pick === 'kick')) { this.board.position.copy(this.seq.bPos); this.board.quaternion.copy(this.seq.bQ); this.deck.quaternion.identity(); this.deck.position.set(0, 0, 0); }
    this.board.updateMatrixWorld(true);
    this.deck.getWorldPosition(this.deckF.position); this.deck.getWorldQuaternion(this.deckF.quaternion); this.deckF.updateMatrixWorld();
    if (this.spin) { this.board.quaternion.multiply(new Q().setFromAxisAngle(up, this.spin)); this.board.updateMatrixWorld(true); }
    // walking frame: on the ground at s, facing along the path, stepped aside by lat
    const left = new V(Math.cos(yaw), 0, -Math.sin(yaw));
    this.lat = this.mode === 'walk' ? damp(this.lat, 0, 0.8, dt) : this.lat;
    this.walkF.position.copy(tr.p).addScaledVector(left, this.lat);
    if (this.groundFn) this.walkF.position.y = this.groundFn(this.walkF.position.x, this.walkF.position.z);
    this.walkF.quaternion.setFromAxisAngle(up, yaw); this.walkF.updateMatrixWorld();
    this.root.position.lerpVectors(this.deckF.position, this.walkF.position, this.m);
    this.root.quaternion.slerpQuaternions(this.deckF.quaternion, this.walkF.quaternion, this.m);
    if (this.spin || this.ollie?.kind === 'shove') this.root.position.y += 0;
    this.vrm.scene.rotation.y = lerp(-Math.PI / 2, 0, this.face) + this.yaw0;
    this.body.position.y = -DECK_Y * this.m;
    const bq = new Q().setFromEuler(new THREE.Euler(this.pitch + this.boardPitch * 0.85, 0, -(this.lean - this.tilt), 'XYZ'));
    this.body.quaternion.copy(bq).slerp(new Q(), this.m);
    this.root.updateMatrixWorld(true);
    for (const [k, tk] of this.board.userData.trucks.entries()) {
      tk.hanger.rotation.y = (k === 0 ? 1 : -1) * this.steer;
      if (riding) for (const w of tk.wheels) w.rotation.x += (this.v * dt) / WHEEL_R;
    }
    const wind = ctx.wind || new V();
    this.airRel.copy(wind).sub(tr.dir.clone().multiplyScalar(this.v));
    this.windLocal.copy(wind).applyQuaternion(new Q().setFromAxisAngle(up, yaw).invert());
    // ---------------- layer 2: body ----------------
    this.armTargets(track);
    this.stateWeights(dt, grade, ctx);
    this.pose(dt, ctx);
    this.root.updateMatrixWorld(true);
    this.solveLegs(dt);
    this.placeHeldBoard();
    this.events(dt, ctx);
    this.vrm.update(dt);
  }

  // ---------------- mode sequences ----------------
  startOff(why) {
    this.push = null; this.offWhy = why; this.mode = 'off'; this.modeT = 0;
    const r = Math.random(), kind = this.v > 3.2 ? (r < 0.6 ? 'slide' : 'heel') : (r < 0.34 ? 'slide' : r < 0.67 ? 'heel' : 'roll');
    this.seq = { kind, ph: 'brake', t: 0, decel: { slide: 2.6, heel: 1.4, roll: 0.45 }[kind] };
    this.ev.push(['off', this.s, kind, why]);
  }
  startOn() { this.mode = 'on'; this.modeT = 0; const bs = this.s + 0.75; this.seq = { ph: 'drop', t: 0, bs }; this.ev.push(['on', this.s]); }
  startTrick(why) {
    this.ollie = { t: 0, kind: 'shove', dir: Math.random() < 0.5 ? 1 : -1, why }; this.trickCool = why === 'full' ? 14 : 6;
    this.stam = Math.max(0, this.stam - (52 * 9.81 * 0.32 / EFF + 150) / EMAX); this.ev.push(['trick', this.s, why]);
  }
  boardRestQ(s, track) { const tr = track(s), q = new Q().setFromAxisAngle(new V(0, 1, 0), Math.atan2(tr.dir.x, tr.dir.z)); return q.multiply(new Q().setFromAxisAngle(new V(1, 0, 0), -Math.atan(tr.grade))); }
  carryQ() { return this.walkF.quaternion.clone().multiply(new Q().setFromAxisAngle(new V(0, 0, 1), -Math.PI / 2)); }
  stepSeq(dt, track) {
    const S = this.seq; if (!S || (this.mode !== 'off' && this.mode !== 'on')) { this.m = damp(this.m, this.mode === 'walk' ? 1 : 0, 6, dt); this.face = this.m; return; }
    S.t += dt;
    if (this.mode === 'off') {
      if (S.ph === 'brake') {
        // slide: deck swings ~75° across the path, she sinks and leans back against the skid; heel: back heel drags; roll: just coast down
        if (S.kind === 'slide') this.slideYaw = lerp(0, 75 * D, sstep(0, 0.5, S.t)) * (this.slideDir || (this.slideDir = Math.random() < 0.5 ? 1 : -1));
        this.drag = S.kind === 'heel' ? sstep(0, 0.3, S.t) : 0;
        if (this.v < 0.3 || S.t > 6) {
          this.v = 0; S.ph = 'step'; S.t = 0; this.drag = 0;
          this.board.updateMatrixWorld(true); S.bPos = this.board.position.clone(); S.bQ = this.board.quaternion.clone(); this.boardFixed = true;
          this.lat = 0.34; this.ev.push(['step', this.s]);
        }
      } else if (S.ph === 'step') {
        this.m = sstep(0, 0.7, S.t); this.face = sstep(0.05, 0.75, S.t);
        if (S.t > 0.8) { S.ph = 'pick'; S.t = 0; S.pick = S.kind === 'slide' || Math.random() < 0.5 ? 'bend' : 'kick'; this.ev.push(['pick', this.s, S.pick]); }
      } else if (S.ph === 'pick') {
        this.m = 1; this.face = 1;
        if (S.pick === 'bend') {
          this.bend = Math.sin(clamp(S.t / 1.3, 0, 1) * Math.PI) * (S.t < 0.65 ? 1 : 1);
          if (S.t >= 0.62 && !this.hold) this.grab(S.bPos, S.bQ, new V(-0.117, DECK_Y - 0.004, 0), 0.62);
          if (S.t > 1.4) this.toWalk();
        } else {
          // kick-up: step on the tail, the nose shoots up while the board rolls a full turn, catch it by the nose
          const u = sstep(0.3, 0.68, S.t), pitch = 72 * D * u, spin = 2 * Math.PI * sstep(0.36, 0.68, S.t);
          this.kickStep = sstep(0.0, 0.3, S.t) * (1 - sstep(0.4, 0.6, S.t));
          if (!this.hold) {
            const q = S.bQ.clone().multiply(new Q().setFromAxisAngle(new V(1, 0, 0), -pitch)).multiply(new Q().setFromAxisAngle(new V(0, 0, 1), spin));
            const pivL = new V(0, 0, -0.42), pivW = pivL.clone().applyQuaternion(S.bQ).add(S.bPos);
            this.board.quaternion.copy(q); this.board.position.copy(pivW).sub(pivL.clone().applyQuaternion(q)).add(new V(0, 0.22 * sstep(0.4, 0.62, S.t), 0));
            S.kPos = this.board.position.clone(); S.kQ = q.clone();
          }
          if (S.t >= 0.68 && !this.hold) this.grab(S.kPos, S.kQ, new V(0, DECK_Y, 0.44), 0.6);
          if (S.t > 1.3) this.toWalk();
        }
      }
    } else { // mounting
      if (S.ph === 'drop') {
        // lower the board to the path a step ahead, then let go
        if (!S.bPos) { S.bPos = track(S.bs).p.clone(); S.bQ = this.boardRestQ(S.bs, track); }
        if (this.hold) { this.hold.drop = sstep(0.0, 0.7, S.t); }
        if (S.t > 0.75) { this.hold = null; this.carry = 0; this.boardFixed = true; S.ph = 'step'; S.t = 0; S.s0 = this.s; }
      } else {
        const u = sstep(0, 0.8, S.t); this.s = lerp(S.s0, S.bs, u); this.v = 0.9; this.phi += 0.9 / 30 / 1.1;
        this.m = 1 - sstep(0.15, 0.8, S.t); this.face = 1 - sstep(0.05, 0.7, S.t); this.lat = lerp(0.34, 0, u);
        if (S.t > 0.85) { this.mode = 'ride'; this.modeT = 0; this.seq = null; this.boardFixed = false; this.m = 0; this.face = 0; this.lat = 0; this.slideYaw = 0; this.slideDir = 0; this.v = 1.1; this.pushCool = 0; }
      }
    }
    if (this.boardFixed && !this.hold && S.bPos && !(this.mode === 'off' && S.ph === 'pick' && S.pick === 'kick')) { this.board.position.copy(S.bPos); this.board.quaternion.copy(S.bQ); }
  }
  toWalk() { this.mode = 'walk'; this.modeT = 0; this.seq = null; this.boardFixed = false; this.bend = 0; this.kickStep = 0; this.carry = 1; }
  grab(pos, q, gripL, T) { this.hold = { qFrom: q.clone(), gFrom: gripL.clone(), t: 0, T, drop: 0 }; this.carry = 1; }
  // hand targets for the right arm (reach for the board, carry it, hand it down)
  armTargets(track) {
    let w = 0; const S = this.seq;
    if (this.hold || this.mode === 'walk') { w = 1; this.armIKt.copy(this.walkF.localToWorld(new V(-0.2, 0.76, 0.04))); }
    if (S && this.mode === 'off' && S.ph === 'pick' && !this.hold) {
      const tgt = S.pick === 'bend' ? new V(-0.117, DECK_Y, 0).applyQuaternion(S.bQ).add(S.bPos) : new V(0, DECK_Y, 0.44).applyQuaternion(this.board.quaternion).add(this.board.position);
      w = S.pick === 'bend' ? sstep(0.15, 0.55, S.t) : sstep(0.42, 0.66, S.t); this.armIKt.copy(tgt);
    }
    if (this.hold && this.hold.drop > 0) { const gp = new V(-0.117, DECK_Y, 0).applyQuaternion(this.seq.bQ).add(this.seq.bPos); this.armIKt.lerp(gp, this.hold.drop); }
    if (this.mode === 'on' && S?.ph === 'step') w = 0;
    this.armIKw = damp(this.armIKw, w, 14, 1 / 30);
  }
  placeHeldBoard() {
    const H = this.hold; if (!H) return;
    H.t += 1 / 30; const u = sstep(0, H.T, H.t), du = H.drop;
    const hand = this.b.rightHand.getWorldPosition(new V());
    const gTo = new V(-0.117, DECK_Y - 0.004, 0);
    let q = H.qFrom.clone().slerp(this.carryQ().multiply(new Q().setFromAxisAngle(new V(0, 0, 1), Math.sin(this.phi * Math.PI * 2) * 0.05)), u);
    let g = H.gFrom.clone().lerp(gTo, u);
    if (du > 0) { q = q.slerp(this.seq.bQ, du); }
    this.board.quaternion.copy(q); this.board.position.copy(hand).sub(g.clone().applyQuaternion(q));
    if (du > 0.98) { this.board.position.copy(this.seq.bPos); this.board.quaternion.copy(this.seq.bQ); }
    this.board.updateMatrixWorld(true);
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
    w.effort = damp(w.effort, sstep(0.02, 0.055, grade) * (this.mode === 'ride' ? 1 : 0.5) + (this.stam < 0.15 ? 0.3 : 0), 2, dt); this.gradeNow = grade;
    const wl = this.windLocal; const ws = Math.hypot(wl.x, wl.z);
    w.wind = damp(w.wind, sstep(1.5, 6, ws), 1.5, dt);
    // look-back: occasionally turn over the trailing (right) shoulder toward the camera
    this.nextLook -= dt;
    if (!this.look && this.nextLook <= 0 && this.mode !== 'off' && this.mode !== 'on' && !this.push && !this.ollie && Math.abs(this.lean) < 8 * D && w.tuck < 0.3 && w.effort < 0.5) {
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
    const S = this.seq, brk = this.mode === 'off' && S?.ph === 'brake' ? S : null;
    const crouchT = clamp((brk ? (brk.kind === 'slide' ? 0.7 : brk.kind === 'heel' ? 0.45 : 0.1) * sstep(0, 0.3, brk.t) : 0) + heel * 0.38 + toe * 0.3 + w.tuck * 1.05 + crouchO * 1.55 - extend * 0.2 + tuckAir * 1.15 + landAbs * 1.1 + w.effort * 0.25 + reach * 0.15, -0.35, 1.6);
    this.crouch = damp(this.crouch ?? crouchT, crouchT, this.ollie ? 18 : 9, dt);
    const breathe = Math.sin(t * (w.effort > 0.3 ? 4.2 : 1.6)) * (0.012 + w.effort * 0.03);
    // ---- hips placement (vrm model frame: +z facing, +x = board forward)
    const sway = Math.sin(t * 0.9) * 0.008;
    const hipX = 0.0 + reach * 0.1 - w.tuck * 0.02 + this.windLocal.z * -0.002;   // over the front foot when pushing
    this.oTuck = tuckAir;
    this.oDrop = damp(this.oDrop ?? 0, crouchO * 0.16 + tuckAir * 0.27 + landAbs * 0.12, 22, dt);
    const M = this.m, F = this.face, bob = Math.abs(Math.sin(this.phi * Math.PI * 2)) * 0.025 * M;
    const hipDrop = lerp(0.06 + this.oDrop + w.effort * 0.05 + this.crouch * 0.17 + reach * 0.2 + breathe * 0.3, 0.035 - bob + this.bend * 0.42 + (this.kickStep || 0) * 0.03, M);
    const hipZ = 0.015 + reach * 0.06 - w.tuck * 0.03 + w.effort * 0.02 - heel * 0.06 + toe * 0.035;
    b.hips.position.set(this.hipRest.x + hipX * this.flip * (1 - M), this.hipRest.y - hipDrop, this.hipRest.z + (hipZ * (1 - M) - this.bend * 0.12 + sway) * this.flip);
    // ---- torso: open toward the nose; push opens fully; look-back twists the other way
    const open = (30 * D + reach * 34 * D + w.tuck * 6 * D) * (1 - F);
    const lb = w.look;
    const leanIn = -this.windSideLean() ;
    const tw = this.gazeTwist || 0;   // extra torso twist the head could not reach last frame (look-back toward camera)
    this.rot('hips', 0.0 + w.tuck * 0.15, open * 0.6 + tw * 0.15, leanIn * 0.3);
    const walkLean = M * (0.06 + Math.max(0, this.gradeNow || 0) * 2.2) + this.bend * 0.75 + (brk && brk.kind === 'slide' ? -0.12 : 0);
    const fwd = walkLean - 0.02 + heel * 0.28 + toe * 0.05 + w.tuck * 0.48 + w.effort * 0.5 + reach * 0.32 + crouchO * 0.42 + tuckAir * 0.3 - extend * 0.15 + landAbs * 0.35;
    this.rot('spine', fwd * 0.45 + breathe, open * 0.2 + tw * 0.25, leanIn * 0.4 + Math.sin(t * 0.7) * 0.01);
    this.rot('chest', fwd * 0.35 - breathe * 0.5, open * 0.2 + tw * 0.35, leanIn * 0.3);
    this.rot('upperChest', fwd * 0.2 - breathe, tw * 0.25, 0);
    // head: GAZE solver. Riding = eyes on the road a few metres ahead (follows the curve).
    // Look-back = she turns to look into the lens (the player), wherever the camera is.
    this.solveGaze(dt, ctx, lb, fwd, w);
    // ---- arms: relaxed, swinging; balance out on tuck/landing; right hand to hair in wind
    const bal = clamp(w.tuck * 0.9 + crouchO * 0.5 + tuckAir * 1.2 + landAbs * 0.8 + Math.abs(this.lean) * 1.2, 0, 1);
    const swing = this.push ? Math.sin(P * Math.PI * 2) * 0.45 * w.push : Math.sin(t * 1.1) * 0.03;
    // ARMS — two poses + an envelope.
    //  rest: hang relaxed by the sides (soft elbows, tiny swing from the body), like someone just riding along;
    //  active: open for balance (lead arm forward-low, trail arm back-low, port-de-bras).
    //  need = how much balance the moment demands; arms rise fast (~0.25 s), then settle down slowly (~1.5 s).
    const hh = w.hair;
    const need = M > 0.5 ? clamp(this.bend * 0.6 + (brk ? 0.8 : 0), 0, 1) : clamp(Math.max(bal, (brk ? 0.85 : 0), w.push * (0.35 + 0.4 * w.effort), w.effort * 0.6, Math.abs(carve) * 0.95, crouchO * 1.1, tuckAir * 1.2, landAbs, w.tuck * 0.9, (this.gust || 0) * 0.5), 0, 1);
    this.armUp = this.armUp ?? 0;
    if (need > this.armUp) this.armUp = damp(this.armUp, need, 9, dt);           // quick rise
    else { this.armHold = (this.armHold ?? 0) + dt; if (this.armHold > 0.6) this.armUp = damp(this.armUp, need, 1.3, dt); } // linger, then lower
    if (need > this.armUp - 0.02) this.armHold = 0;
    const up = this.armForce ?? this.armUp;
    const brz = Math.sin(t * 0.73) * 0.05, brz2 = Math.sin(t * 0.57 + 1.3) * 0.06;
    const bodySw = Math.sin(t * 1.6) * 0.04 + this.lean * 0.4;   // passive pendulum with the body
    const A = this.armT || (this.armT = {});
    // elbows soft and turned slightly IN toward the body (not winged out): upper-arm x-rotation rolls the elbow back/in,
    // forearm carries the hand forward of the hip, palms face the thighs.
    const wsw = M * Math.sin(this.phi * Math.PI * 2) * 0.35;   // walking arm swing (opposite to legs)
    const AT = this.armTwist ?? 0.2;
    const rest = { lx: AT + wsw, ly: -0.05 + bodySw * (1 - M), lz: -76 * D, le: -0.42, lw: -0.05 + brz2 * 0.5,
                   rx: AT - wsw, ry: 0.05 + bodySw * (1 - M), rz: 76 * D, re: 0.42, rw: 0.05 - brz * 0.5 };
    const act = {
      lx: (this.armTwA ?? -0.7) + brz * 0.5, ly: -0.55 - bal * 0.25 + swing * 0.3 - heel * 0.5 + toe * 0.3 - w.tuck * 0.2,
      lz: (this.armLz ?? -40) * D + bal * 10 * D + heel * 10 * D + w.effort * 8 * D + brz,
      le: (this.armLe ?? -0.45) - bal * 0.12 - w.effort * 0.35 - heel * 0.15, lw: -0.3 + brz2,
      rx: (this.armTwA ?? -0.7), ry: 0.55 + bal * 0.2 - swing * 0.6 + heel * 0.5 - toe * 0.3 + w.tuck * 0.2,
      rz: -(this.armLz ?? -40) * D - bal * 10 * D - heel * 10 * D - w.effort * 8 * D + brz2,
      re: -(this.armLe ?? -0.45) + 0.05 + bal * 0.12 + w.effort * 0.35 + heel * 0.15 + Math.max(0, -swing) * 0.4, rw: 0.28 - brz,
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
    if (this.armIKw > 0.01) {
      this.root.updateMatrixWorld(true);
      const ua = b.rightUpperArm, la = b.rightLowerArm, hd = b.rightHand, sp = ua.getWorldPosition(new V());
      const tgt = sp.clone().lerp(this.armIKt, 1).sub(sp).multiplyScalar(1).add(sp);
      const cur = hd.getWorldPosition(new V()), goal = cur.lerp(tgt, this.armIKw);
      const pole = sp.clone().add(new V(0, -0.5, 0)).addScaledVector(this.walkF.localToWorld(new V(-1, 0, -0.6)).sub(this.walkF.position), 0.4);
      twoBoneIK(ua, la, hd, goal, pole);
      if (this.hold) { this.rot('rightHand', 0, 0, 0); }
    }
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
    if (this.vrm.lookAt) { this.gazeObj.position.copy(this.gazePt); this.gazeObj.updateMatrixWorld(); this.vrm.lookAt.target = this.gazeObj; }
  }
  solveGaze(dt, ctx, lb, fwd, w) {
    const V = THREE.Vector3, b = this.b;
    if (!this.gazeObj) { this.gazeObj = new THREE.Object3D(); this.gazePt = new V(); this.gazeTwist = 0; this.gazeSide = 1; }
    // targets: road point ~7 m ahead on the path (eye height ~0), and the camera
    const road = this.track ? this.track.at(this.s + 7).p.clone() : this.board.position.clone().addScaledVector(this.dir, 7);
    road.y += 0.2;
    const cam = ctx.camera ? ctx.camera.getWorldPosition(new V()) : road;
    const chest = b.upperChest || b.chest; chest.updateWorldMatrix(true, false);
    const headP = b.head.getWorldPosition(new V());
    // blend target DIRECTIONS (not points) so the eyes sweep smoothly from road to lens
    const dR = road.clone().sub(headP).normalize(), dC = cam.clone().sub(headP).normalize();
    const dir = dR.clone().lerp(dC, lb).normalize();
    this.gazePt.copy(headP).addScaledVector(dir, lb > 0.5 ? cam.distanceTo(headP) : 7);
    const inv = new THREE.Quaternion(); chest.getWorldQuaternion(inv).invert();
    // VRM0 models are rotated 180° at load: the face points along the bone's -Z, not +Z
    const F = this.vrm.userData?.vrm0 ? -1 : 1;
    const L = dir.clone().applyQuaternion(inv);
    let yaw = Math.atan2(F * L.x, F * L.z), pitch = -F * Math.atan2(L.y, Math.hypot(L.x, L.z));
    // look-back over one shoulder: keep the chosen side (hysteresis) when the camera is almost straight behind
    if (lb > 0.05 && Math.abs(yaw) > 150 * D && Math.sign(yaw) !== this.gazeSide) yaw += this.gazeSide * 2 * Math.PI;
    if (lb < 0.05) this.gazeSide = Math.sign(yaw) || 1;
    this.gazeDbg = { yaw: +(yaw / D).toFixed(0), side: this.gazeSide };
    const NECK = 90 * D;                                   // neck+head comfortable range; the torso takes the rest
    const over = Math.sign(yaw) * Math.max(0, Math.abs(yaw) - NECK);
    const twWant = lb > 0.05 ? clamp(this.gazeTwist + over, -100 * D, 100 * D) : 0;
    this.gazeTwist = damp(this.gazeTwist, twWant * Math.min(1, lb * 1.4), 6, dt);
    yaw = clamp(yaw, -NECK, NECK); pitch = clamp(pitch, -35 * D, 40 * D);
    const tilt = -yaw * 0.12 * lb;                         // slight head tilt into the glance (cute, not robotic)
    const q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
    b.neck.quaternion.copy(q(pitch * 0.4, yaw * 0.45, tilt * 0.4));
    b.head.quaternion.copy(q(pitch * 0.6, yaw * 0.55, tilt * 0.6 + Math.sin(this.t * 0.6) * 0.02));
    // one refinement pass so the face really points at the target
    b.head.updateWorldMatrix(true, false);
    const hq = b.head.getWorldQuaternion(new THREE.Quaternion());
    const L2 = dir.clone().applyQuaternion(hq.clone().invert());
    const ey = clamp(Math.atan2(F * L2.x, F * L2.z), -20 * D, 20 * D), ep = clamp(-F * Math.atan2(L2.y, Math.hypot(L2.x, L2.z)), -15 * D, 15 * D);
    b.head.quaternion.multiply(q(ep, ey, 0));
    this.gazeErr = (() => { b.head.updateWorldMatrix(true, false); const f = new V(0, 0, F).applyQuaternion(b.head.getWorldQuaternion(new THREE.Quaternion())); return Math.acos(clamp(f.dot(dir), -1, 1)) / D; })();
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
    if (this.ollie && this.m < 0.5) { // back foot to the tail during the crouch, front foot slides toward the nose after the pop
      const o = this.ollie.t; const tail = sstep(0.0, 0.3, o) * (1 - sstep(0.6, 0.9, o)), slide = sstep(0.36, 0.55, o) * (1 - sstep(0.75, 1.05, o));
      rf = deck(-0.01, -0.21 - tail * 0.13); lf = deck(0.015, 0.2 + slide * 0.17, DECK_Y + 0.093 + slide * 0.008); rYaw = -80 * D; lYaw = -65 * D;
    }
    if (this.push && !this.ollie && this.m < 0.5) {
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
    const M = this.m;
    if (M > 0.01) {
      // walking: feet on the ground under the hips, alternating stride ~0.55 m; at a standstill side by side
      const ph = this.phi * Math.PI * 2, st = this.mode === 'walk' || (this.mode === 'on' && this.seq?.ph === 'step') ? 0.27 : 0.0;
      const kick = this.kickStep || 0, bend = this.bend;
      const wf = (side, s) => { const sg = side === 'left' ? 1 : -1, c = Math.sin(ph + (side === 'left' ? 0 : Math.PI));
        const lift = Math.max(0, Math.cos(ph + (side === 'left' ? 0 : Math.PI))) * 0.09 * (st > 0 ? 1 : 0);
        let z = c * st, x = sg * 0.09; if (side === 'left' && kick) { z += kick * 0.25; }
        if (bend) { z += side === 'left' ? 0.12 * bend : -0.1 * bend; }
        const p = this.walkF.localToWorld(new V(x, 0, z)); p.y = (this.groundFn ? this.groundFn(p.x, p.z) : this.walkF.position.y) + 0.093 + lift + (side === 'left' ? kick * 0.04 : 0); return p; };
      const wl = wf('left'), wr = wf('right');
      lf = lf.lerp(wl, M); rf = rf.lerp(wr, M); lYaw = lerp(lYaw, -90 * D, M); rYaw = lerp(rYaw, -90 * D, M); rPitch = lerp(rPitch, 0, M);
    }
    if (this.drag > 0) { const dp = this.groundAt(-0.02, -0.5); rf = rf.lerp(dp, this.drag * 0.8); rPitch = -0.5 * this.drag; }
    if (this.footLift) { lf.y += this.footLift; rf.y += this.footLift; }
    const fwdModel = new V(0, 0, this.flip).applyQuaternion(this.vrm.scene.getWorldQuaternion(new Q()));
    for (const [side, target, yaw, pitch] of [['left', lf, lYaw, 0], ['right', rf, rYaw, rPitch]]) {
      const up = B[side + 'UpperLeg'], lo = B[side + 'LowerLeg'], ft = B[side + 'Foot'];
      const hip = bw(up);
      const pole = hip.clone().addScaledVector(fwdModel, 1.0).add(new V(0, -0.4 + (this.oTuck || 0) * 0.5, 0));
      // splay knees slightly outward over their feet
      const along = target.clone().sub(hip); pole.addScaledVector(along.setY(0).normalize(), 0.25);
      twoBoneIK(up, lo, ft, target, pole);
      // foot flat on deck, toes angled
      const qb = this.deck.getWorldQuaternion(new Q()).slerp(this.walkF.quaternion.clone().multiply(new Q().setFromAxisAngle(new V(0, 1, 0), 90 * D)), this.m);
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
