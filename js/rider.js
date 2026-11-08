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
export const EMAX = 15000;
// cross-step to the nose, Peter Pan (back leg floats behind), cross-step back — after the Terri O reference
const DANCE_K = [[0, 0.2, -0.21, 0, 0, 0.015, -0.01], [0.5, 0.2, -0.21, 0, 0, 0.015, -0.01], [1.1, 0.2, 0.31, 0, 0, 0.015, 0.03], [1.7, 0.42, 0.31, 0, 0, -0.01, 0.03],
  [2.2, 0.42, 0.31, 0, 0, -0.01, 0.03], [2.7, 0.42, 0.02, 0, 0.24, -0.01, -0.02], [4.2, 0.42, 0.0, 0, 0.26, -0.01, -0.02], [4.7, 0.42, 0.22, 0, 0, -0.01, 0.0],
  [5.3, 0.2, 0.22, 0, 0, 0.015, 0.0], [5.9, 0.2, -0.21, 0, 0, 0.015, -0.01], [6.4, 0.2, -0.21, 0, 0, 0.015, -0.01]];
const DANCE_T = 6.4;
const PUSH_F = 165;   // N, a strong but unhurried kick
export const MASS = 60;   // Cheney (corrected): more INERTIA — each push takes real force, but once rolling she keeps her speed (same friction/drag force, more mass -> slower decay)   // J (metabolic): full stamina bar. Muscle efficiency ~25% -> metabolic = mechanical work / 0.25
const EFF = 0.25, P_AERO = 230, CRR = 0.0030, CDA = 0.25;   // slicker than reality on purpose: long glides   // W: what her aerobic system refills continuously; above it she spends the bar, below it she refills          // deck top above ground (m)
const WHEEL_R = 0.035, HALF_WB = 0.36, DECK_L = 1.12;
let ANK = 0.093;   // ankle (foot bone) height above the shoe sole — measured per model in the Rider constructor

// DECK SHAPE + FLEX (Cheney: a longboard deck is a concave bridge; it only bends under the load of her feet).
//  - concave: across the width the rails are higher than the centre line (~8 mm), fading out at nose/tail,
//  - flex: a beam on two supports (the trucks) loaded by the two feet. Between the trucks it sags under the load (max
//    under/between the feet), beyond the trucks the unloaded nose/tail stay STRAIGHT on the beam's end slope — they tilt
//    up a little, they never curl down. Uneven load (front/back foot) shifts where it sags most.
//  - a sideways lean (heel/toe) twists the deck a bit: the loaded rail sinks a few mm more.
export const CONCAVE = 0.008, DECK_W = 0.235;
export const DECKLOAD = { a: 0.2, b: -0.21, wa: 0.5, twist: 0 };   // foot positions along the deck (m) and front-foot share
function beamDefl(z, f, a, b, wa) {
  // simply supported span [-H, H], point loads at a (front foot) and b (back foot); deflection normalised so the larger of
  // the two foot points sags by f. Closed form for a point load P at c: y(z) = P·(H+z)(H−c)... (standard formula).
  const H = HALF_WB, Lw = 2 * H;
  const one = (z, c) => { const x = z + H, cc = c + H, bb = Lw - cc; return x <= cc ? bb * x * (Lw * Lw - bb * bb - x * x) / (6 * Lw) : cc * (Lw - x) * (Lw * Lw - cc * cc - (Lw - x) * (Lw - x)) / (6 * Lw); };
  const zc = Math.max(-H, Math.min(H, z)), y = (zz) => wa * one(zz, a) + (1 - wa) * one(zz, b);
  const peak = Math.max(y(a), y(b), y((a + b) / 2), 1e-9);
  if (Math.abs(z) <= H) return f * y(zc) / peak;
  const s = Math.sign(z), e = 1e-3, dy = (y(s * H) - y(s * (H - e))) / e;   // dy/d|z| at the support (<0: sag falls to 0)
  return f * dy * (Math.abs(z) - H) / peak;                                      // straight overhang continuing that line: rises (negative = up)
}
export function flexAt(z, f, x = 0) {
  const L = DECKLOAD; return beamDefl(z, f, L.a, L.b, L.wa) + L.twist * (x / (DECK_W / 2)) * 0.004 * Math.min(1, Math.max(0, 1 - Math.abs(z) / (HALF_WB + 0.1)));
}
export function concaveAt(x, z) { const u = Math.min(1, Math.abs(x) / (DECK_W / 2)), along = 1 - Math.pow(Math.min(1, Math.abs(z) / (DECK_L / 2)), 4); return CONCAVE * u * u * along; }
export function buildLongboard() {
  const g = new THREE.Group();
  const L = DECK_L, W = 0.235;
  const sh = new THREE.Shape();
  // pintail-ish cruiser outline (x = width, y = length)
  sh.moveTo(0, -L / 2);
  sh.bezierCurveTo(W * 0.42, -L / 2, W / 2, -L * 0.3, W / 2, -L * 0.1);
  sh.lineTo(W / 2, L * 0.18);
  sh.bezierCurveTo(W / 2, L * 0.38, W * 0.36, L / 2, 0, L / 2);
  sh.bezierCurveTo(-W * 0.36, L / 2, -W / 2, L * 0.38, -W / 2, L * 0.18);
  sh.lineTo(-W / 2, -L * 0.1);
  sh.bezierCurveTo(-W / 2, -L * 0.3, -W * 0.42, -L / 2, 0, -L / 2);
  // half-width of the outline along the length (sampled from the shape), so the deck can be a real tessellated slab:
  // the outline-only Shape/Extrude geometries had NO interior vertices, so any bend (flex, concave) became huge flat
  // triangles hinging across the board — it looked like the two halves folding down.
  const outline = sh.getSpacedPoints(400), halfW = (zz) => { let best = 0; for (let i = 0; i < outline.length; i++) { const a = outline[i], b = outline[(i + 1) % outline.length];
      if ((a.y - zz) * (b.y - zz) <= 0 && a.y !== b.y) { const u = (zz - a.y) / (b.y - a.y); best = Math.max(best, Math.abs(a.x + (b.x - a.x) * u)); } } return best; };
  const NZ = 72, NX = 14;
  const slab = (th, edgeR) => {   // closed slab: top grid (y=+th/2), bottom grid (y=-th/2), rounded side wall
    const pos = [], idx = [], zs = [], rowW = [];
    for (let j = 0; j <= NZ; j++) { const v = j / NZ, zz = -L / 2 + 0.0015 + (L - 0.003) * (0.5 - 0.5 * Math.cos(Math.PI * v)); zs.push(zz); rowW.push(Math.max(0.004, halfW(zz))); }
    const grid = (y, flip) => { const base = pos.length / 3;
      for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) { const u = -1 + 2 * i / NX; pos.push(u * rowW[j], y, -zs[j]); }
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const a = base + j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d); }
      return base; };
    const top = grid(th / 2, false), bot = grid(-th / 2, true);
    const ring = (base, j, i) => base + j * (NX + 1) + i;
    const wall = (i) => { for (let j = 0; j < NZ; j++) { const a = ring(top, j, i), b = ring(top, j + 1, i), c = ring(bot, j, i), d = ring(bot, j + 1, i); if (i === 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c); } };
    wall(0); wall(NX);
    for (const j of [0, NZ]) for (let i = 0; i < NX; i++) { const a = ring(top, j, i), b = ring(top, j, i + 1), c = ring(bot, j, i), d = ring(bot, j, i + 1); if (j === 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; };
  const sheet = (sc) => { const pos = [], idx = [];   // single tessellated top sheet (grip tape / graphic)
    for (let j = 0; j <= NZ; j++) { const v = j / NZ, zz = (-L / 2 + 0.003 + (L - 0.006) * (0.5 - 0.5 * Math.cos(Math.PI * v))); const w = Math.max(0.003, halfW(zz)) * sc;
      for (let i = 0; i <= NX; i++) pos.push((-1 + 2 * i / NX) * w, 0, -zz); }
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; };
  const deckGeo = slab(0.013); deckGeo.translate(0, 0.0065, 0);
  const wood = new THREE.MeshStandardMaterial({ color: '#e2c79c', roughness: 0.6 });
  const deck = new THREE.Mesh(deckGeo, wood); deck.position.y = DECK_Y - 0.013; deck.castShadow = true; g.add(deck);
  const gripGeo = sheet(0.97);
  // GRIP TAPE: black-grey sandpaper — fine random grit (canvas noise) as colour + bump, fully matte
  const gripTex = (() => { const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'), im = x.createImageData(N, N);
    for (let i = 0; i < N * N; i++) { const r = Math.random(), sp = r > 0.985 ? 70 : r > 0.93 ? 22 : 0, v = 34 + Math.random() * 22 + sp; im.data[i * 4] = v; im.data[i * 4 + 1] = v + 1; im.data[i * 4 + 2] = v + 3; im.data[i * 4 + 3] = 255; }
    x.putImageData(im, 0, 0); const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(3, 12); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; return tx; })();
  { const a = gripGeo.attributes.position, uv = []; for (let i = 0; i < a.count; i++) uv.push(a.getX(i) / 0.24 + 0.5, a.getZ(i) / 1.12 + 0.5); gripGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); }
  const grip = new THREE.Mesh(gripGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', map: gripTex, bumpMap: gripTex, bumpScale: 1.2, roughness: 1.0, metalness: 0, side: THREE.DoubleSide }));
  grip.position.y = DECK_Y + 0.0006; g.add(grip);
  // bottom graphic: soft wave stripe
  const artGeo = sheet(0.7); { const a = artGeo.attributes.position; for (let i = 0; i < a.count; i++) a.setZ(i, a.getZ(i) * 0.55); a.needsUpdate = true; }
  const art = new THREE.Mesh(artGeo, new THREE.MeshStandardMaterial({ color: '#8fd3d6', roughness: 0.5, side: THREE.DoubleSide }));
  art.rotation.x = Math.PI; art.position.y = DECK_Y - 0.0145; g.add(art);
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
  // flex: bendable deck meshes (CPU, ~1k verts): between the trucks it sags like a loaded beam, beyond them it rises
  // bake the concave into all deck layers (rails up), then keep that as the rest shape for flexing
  for (const m of [deck, grip, art]) { const a = m.geometry.attributes.position, arr = a.array, sgn = Math.cos(m.rotation.x) < 0 ? -1 : 1, sx = m.scale.x || 1, sz = m.scale.z || 1;
    for (let i = 0; i < arr.length; i += 3) arr[i + 1] += sgn * concaveAt(arr[i] * sx, arr[i + 2] * sz) / (m.scale.y || 1);
    a.needsUpdate = true; m.geometry.computeVertexNormals(); }
  const flexMeshes = [deck, grip, art].map((m) => ({ m, base: m.geometry.attributes.position.array.slice() }));
  g.userData = { trucks, deck: deckG, chassis, flexMeshes };
  return g;
}

const BONES = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'];
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];

// RIDER PROFILE (Cheney): who she is & what she prefers — data/rider_profile.json, loaded by lab.js -> rider.applyProfile()
export const PROFILE = { energy: { barJ: 24000, walkCostMul: 1, sitRestW: 4800, getUpAt: 0.6, restGradeDeg: 6, walkRestW: 1200, rideRestW: 1200, restFullKmh: 20, noRestKmh: 30, minSitS: 6 }, skill: { pumpGain: 1, pushForceN: 165, pushBelowKmh: 10 },
  preference: { speedFloorKmh: 20, chargeBeforeClimbKmh: 31, vmaxKmh: 30, trickMinStamina: 0.7, trickMinKmh: 9.4, autoDance: false, lookBack: 0.6, hairTouch: 0.5, carving: 0.7 },
  mind: { lookAheadM: 150, planEveryS: 0.5, foresight: 0.8, caution: 0.5 } };
export class Rider {
  applyProfile(P) { if (!P) return; const ph = P.physical || P; for (const k of ['energy', 'skill']) Object.assign(PROFILE[k], ph[k] || {}); Object.assign(PROFILE.preference, P.preference || {}); Object.assign(PROFILE.mind, P.mind || {}); this.profile = P; }
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
    /* THROWDOWN (running mount) params — data/moves/throwdown.json 'game' overrides them (lab.js) */
    this.TD = { run: 1.3, runV: 3.6, lat: 0.32, dragPhi: 55, set: 0.25, setPhi: 15, beside: 0.45, step: 0.5, boardV: 2.1, settle: 0.12, absorbIn: 0.1, absorbOut: 0.45, crouch: 0.55, grabT: 0.4 };
    this.swingK = 0; this.mount = null;
    this.stam = 0.7; this.pump = null; this.pumpHipYaw = 0; this.pumpYaw = 0; this.pumpLat = 0; this.pumpDrop = 0; this.spin = 0; this.bend = 0; this.armIKw = 0; this.armIKt = new V(); this.footTap = 0; this.tapPt = new V(); this.drag = 0;
  }

  // track: (s) -> {p:V3 ground point, dir:V3 unit forward, up:V3, grade, kappa}
  update(dt, track, ctx) {
    this.t += dt; this.modeT += dt; this.track = this.track || null;
    const tr = track(this.s), grade = tr.grade, kappa = tr.kappa;
    const g = 9.81, m = MASS, theta = Math.atan(grade), TAN6 = Math.tan(6 * D);
    // STAMINA (蓄力槽) in joules of spare mechanical work, EMAX = full bar.
    // spent: push work F·v (F = m·a_push), walking uphill m·g·v·sinθ (×0.5, walking is efficient), ollie/trick jump energy;
    // recovered: resting on the board ~40 W (downhill coast 55 W), standing/walking on the flat ~30 W.
    let spend = 0;
    const brake = this.mode === 'off' && this.seq.ph === 'brake';
    if (this.mode === 'ride' || brake) {
      let a = -g * Math.sin(theta) - CRR * g * Math.cos(theta) * (52 / m) - (0.5 * 1.2 * CDA * this.v * this.v) / m;   // same resisting force, more mass -> she keeps her speed
      if (this.mode === 'ride') {
        const gdeg = Math.atan(grade) / D, cruise = (ctx.cruise ?? 3.0) * (gdeg > 2 ? clamp(1 - (gdeg - 2) * 0.1, 0.6, 1) : 1), vmax = PROFILE.preference.vmaxKmh / 3.6;
        const holeSoon = (ctx.holes || []).some((h) => h - this.s > 0 && h - this.s < this.v * 0.42 + 0.35 + this.v * 1.3 + 0.5);
        const carrying = this.plan?.kind === 'carry' && grade > 0.02;
        const pc0 = this.plan, climbAhead = pc0 && pc0.climbAt !== undefined && pc0.climbAt !== null && pc0.climbAt < 60;
        const PF = PROFILE.preference, vFloor = (climbAhead && grade < 0.02 && PROFILE.mind.foresight > 0.5 ? PF.chargeBeforeClimbKmh : PF.speedFloorKmh) / 3.6; this.vFloor = vFloor; this.vTarget = vFloor;   /* climb ahead: charge to ~31 km/h on the run-in */   /* Cheney: below ~20 km/h she works (pump / push) to bring it back */
        const needGo = !this.dance && this.stam > 0.02 && !holeSoon && !this.ollie && this.air <= 0 && (this.v < vFloor - 0.15 || (carrying && this.v < cruise));
        // PUMP (S-carve): rhythmic weight shifts through the turns convert body work into forward speed. Real pumping needs
        // speed to work (~>7 km/h) and is less efficient than a push, but feet stay on the board: she prefers it on the flat
        // and on gentle climbs (<3.5°) when she already rolls; below that speed (or steeper) she pushes.
        const canPump = this.v > PROFILE.skill.pushBelowKmh / 3.6 && grade < (carrying ? 0.12 : 0.06) && Math.abs(kappa) < 0.4 && !this.push && !this.ollie && this.air <= 0 && !this.dance && this.stam > 0.05 && !holeSoon;   /* pumping through bends too (carving IS the pump) */
        // The body steers the board: shoulders turn first, the hips follow, the board follows the hips. Intensity I sets the
        // style: elegant = slow, small, upright, rhythmic (gliding on the flat / downhill, I≈0.15); power = faster & bigger
        // when she needs speed (I→1). Steep climbs are never elegant: she pushes or walks.
        const pumpGo = canPump && (needGo || (this.pump && this.v < vFloor + 0.4));   /* keep pumping until a little above the floor */
        this.pumpHold = Math.max(0, (this.pumpHold || 0) - dt);
        const wantPump = pumpGo || (this.pumpHold > 0 && canPump && this.stam > 0.03);   // no idle pumping: when she has speed she stands tall and GLIDE-CARVES with her centre of mass
        const carveGo = !pumpGo && !this.push && !this.ollie && this.air <= 0 && this.v > 2.0 && Math.abs(kappa) < 0.08 && !holeSoon && grade < 0.04;
        this.glideA = damp(this.glideA || 0, carveGo ? 1 : 0, 0.8, dt); this.glidePh = (this.glidePh || 0) + 2 * Math.PI * 0.125 * dt;   // slow: one S every 8 s
        const Itgt = pumpGo ? clamp(0.35 + (vFloor - this.v) * 0.45 + Math.max(0, grade) * 9, 0.35, 1) : 0.15;   /* further below the floor / steeper -> harder, faster pumping */
        if (wantPump && !this.pump) { this.pump = { t: 0, ph: 0, I: Itgt, A: 0 }; this.decide(carrying ? '借冲坡的速度上坡 + pump' : 'pump 补速度'); }
        if (this.pump) { const P = this.pump; P.t += dt; P.I = damp(P.I, Itgt, 0.8, dt); P.ph += 2 * Math.PI * (0.42 + 0.5 * P.I) * dt;
          P.A = damp(P.A, wantPump ? 1 : 0, 1.6, dt); if (!wantPump && P.A < 0.05) this.pump = null; }
        if (!this.push && !(this.pump && pumpGo) && needGo && this.v < PROFILE.skill.pushBelowKmh / 3.6 + 0.2 && this.pushCool <= 0) { this.pump = null; this.startPush(grade); }   /* push only below ~10 km/h, kick after kick; above that she pumps */
        if (this.pump) { const P = this.pump, ph = Math.sin(P.ph - 1.1) ** 2;   // propulsion peaks as the board loads mid-carve, twice per S
          const def = Math.max(0, (this.vFloor || 5.5) - this.v);
          const pa = PROFILE.skill.pumpGain * P.A * P.I * (0.25 + 0.35 * ph) * (0.6 + 0.5 * Math.min(1, def)) * clamp((this.v - 1.2) / 1.2, 0, 1) + P.A * P.I * Math.max(0, g * Math.sin(theta)) * 0.9; a += pa;   /* ~0.3-0.5 m/s² on the flat: 14->20 km/h in ~5 s; uphill adds what the slope takes away (and bills it) */   /* uphill she also pumps against the slope (costs proportionally more) */ spend += (m * pa * this.v / (EFF * 0.6)) * dt; }
        const BASE = 110;   // W metabolic just standing balanced on a rolling board
        if (this.push) { const pa = this.pushAccel(); a += pa; spend += (m * pa * Math.max(this.v, 0.5) / EFF) * dt; }
        /* RECOVERY ON THE BOARD (Cheney): standing still on a rolling board — gliding, looking around, small graceful moves
           (dance steps, hair, look-back) — recovers, fast. Not when it's fast (>= noRestKmh you're working to stay balanced;
           full rate at <= restFullKmh). Pushing / pumping / spins cost as before. */
        const EN = PROFILE.energy, kmhN = this.v * 3.6, calm = !this.push && !this.pump && !this.ollie && this.air <= 0;
        const rideRest = calm ? (EN.rideRestW ?? EN.walkRestW) * clamp((EN.noRestKmh - kmhN) / (EN.noRestKmh - EN.restFullKmh), 0, 1) : 0;
        /* Cheney: standing on the board doing nothing costs NOTHING; at normal speeds it recovers exactly like walking on the flat
           (rideRestW defaults to walkRestW). Only very fast (>= noRestKmh) the recovery fades to zero — never a cost. */
        if (calm) spend -= rideRest * dt;
        else spend += (BASE - P_AERO + Math.max(0, theta - EN.restGradeDeg * D) / D * 30) * dt;   /* gliding above the 6° line costs a little */   // gliding = resting   // rolling downhill is the best rest: the bar fills fastest there
        this.ctxV = vmax; const pc = this.plan, upSoon = pc && pc.climbAt !== undefined && pc.climbAt !== null && pc.climbAt < 12 + this.v * 8;
        const vCap = upSoon ? vmax + 2.2 : vmax;   /* a climb ahead: keep the speed, she'll spend it going up */
        if (this.v > vCap) a -= (this.pump ? 1.1 : 1.6) * (this.v - vCap) + (this.pump ? 0.35 : 0.8);   // carving (or foot-drag) checks speed
        this.trickReady = this.mode === 'ride' && !holeSoon && this.stam >= PROFILE.preference.trickMinStamina && grade < 0.035 && grade > -0.09 && this.v > PROFILE.preference.trickMinKmh / 3.6 && this.v < vmax + 1.2 && !this.ollie && !this.push && this.air <= 0 && !this.dance && (this.trickCool ?? 0) <= 0;
        this.trickProg = { stam: this.stam, speed: clamp(this.v / (PROFILE.preference.trickMinKmh / 3.6), 0, 1), fast: this.v >= vmax + 1.2, ready: this.trickReady };
        if (this.trickReady && !this._trWas) this.decide('蓄力够 + 速度合适：等你点转板'); this._trWas = this.trickReady;
        if (upSoon && this.v > vmax && !this._upWas) this.decide('前方上坡：不刹车，留着速度冲上去'); this._upWas = upSoon && this.v > vmax;
        if (this.trickReq) { this.trickReq = false; if (this.trickReady) { this.startTrick('full'); this.look = null; } }
        this.pushCool -= dt; this.trickCool = (this.trickCool ?? 6) - dt; this.danceCool = (this.danceCool ?? 10) - dt;
        if (this.dance) { this.dance.t += dt * 0.75; if (this.dance.t > DANCE_T) { this.dance = null; this.danceCool = 14 + Math.random() * 8; } }
        if (!this.planT || this.t - this.planT > PROFILE.mind.planEveryS) { this.plan = this.planClimb(track); this.planT = this.t; }
        const pl = this.plan, stopDist = this.v * this.v / (2 * 2.6) + this.v * 0.6 + 1.5;   // room to stop before it
        this.slowT = this.v < 0.9 ? (this.slowT || 0) + dt : 0;
        if (!this.ollie && this.air <= 0 && (this.slowT > 2.2 || (pl.kind === 'walk' && pl.start <= stopDist))) { if (this.push) this.push = null; }
        if (!this.ollie && this.air <= 0 && !this.push) {
          if (pl.kind === 'walk' && pl.start <= stopDist) this.startOff('steep');
          /* simulation says riding + pumping won't make it over: ride up as far as the run-in carries, then step off
             smoothly just before the predicted stall point (never stall dead, never get off early) */
          else if (pl.kind === 'pushThenWalk' && pl.start <= stopDist + 2) { this.decide(`模拟：一直滑+pump 也过不去这个坡，${pl.start}m 后会停住 → 下板走`); this.startOff('long'); }   /* only real too-steep ramps make her step off in advance; otherwise she rides until she truly stalls */
          else if (this.slowT > 2.2) this.startOff('slow');
          else if (this.stam <= 0.02 && (grade > 0.02 || this.v < 1.0) && !this.lookAhead(track, 25).down) this.startOff('tired');   // spent and it won't roll on its own
          // too fast: no trick (unsafe) — she tucks and carves/foot-drags to check speed (see vmax drag); the player can trick
          // while the speed is still in the window, which bleeds speed on long descents
          // full-bar trick is now PLAYER-triggered (tap / Space / Enter): she only gets READY and looks at us
          else if (!this.dance && !holeSoon && this.stam > 0.35 && Math.abs(grade) < 0.035 && Math.abs(kappa) < 0.06 && this.v > 2.0 && (this.danceCool ?? 6) <= 0 && pl.kind !== 'walk' && PROFILE.preference.autoDance) this.startDance();   // Cheney: no tricks on her own (dance kept for later, player-triggered)
        }
      } else a -= this.seq.decel;
      this.v = Math.max(0, this.v + a * dt);
      this.s += this.v * dt;
      if (this.mode === 'ride' && !this.ollie && ctx.holes) for (const h of ctx.holes) {
        const d = h - this.s, lead = this.v * 0.42 + 0.35;
        if (d > 0 && d < lead + this.v * 0.12 && !this.push) { this.ollie = { t: 0, h }; this.stam -= (m * g * 0.35 / EFF) / EMAX; this.ev.push(['ollie', this.s]); break; }
      }
    } else if (this.mode === 'walk') {
      this.updateRest(dt);
      this.v = this.rest ? damp(this.v, 0, 6, dt) : damp(this.v, grade > 0.03 ? 1.0 : grade < -0.08 ? 0.9 : 1.3, 2, dt); this.s += this.v * dt; this.phi += this.v * dt / (1.1 * (1 - Math.min(0.3, Math.max(0, grade) * 1.6)));
      const E = PROFILE.energy, R6 = E.restGradeDeg * D, cl = (th) => (m * g * this.v * Math.max(0, Math.sin(th))) / EFF * 0.6;
      /* WALKING ENERGY (Cheney): restGradeDeg (6°) is the line. Steeper than that she spends (climb work above what a 6° walk costs);
         gentler than that she slowly recovers (most on the flat / downhill, nothing right at 6°). Sitting recovers fastest. */
      spend += this.rest ? -(this.rest.sit ? E.sitRestW : 60) * dt : E.walkCostMul * (theta > R6 ? cl(theta) - cl(R6) : -E.walkRestW * (1 - Math.max(0, theta) / R6)) * dt;
      if (!this.planT || this.t - this.planT > PROFILE.mind.planEveryS) { this.plan = this.planClimb(track); this.planT = this.t; }
      // REMOUNT decision (Cheney): look at 1) fatigue, 2) speed, 3) what the next stretch of road does.
      //  - a downhill or flat ahead that she can ROLL (no walk-only climb within ~25 m) -> get back on, even when tired
      //    (rolling rests her); a gentle downhill (≤ ~10°) is the best place to hop on; steeper than that she walks down
      //    a few metres until it eases (hopping onto a steep descent is not safe);
      //  - a climb ahead that needs pushing -> only remount if she has the energy for it, otherwise keep walking.
      const ahead = this.lookAhead(track, 30), pl = this.plan;
      const canRoll = grade < 0.03 && grade > -Math.tan(10 * D) && track(this.s + 2).grade < 0.03 && track(this.s + 2).grade > -Math.tan(10 * D);
      const climbSoon = pl.kind === 'walk' && pl.start <= 25, pushSoon = false;
      const energyOK = this.stam > 0.12 || ahead.down;
      if (this.rest) { /* sitting: handled by rest logic */ }
      else if (this.modeT > 1.8 && canRoll && !climbSoon && energyOK && (!pushSoon || this.stam > pl.need / EMAX)) this.startOn();
      else if (this.stam <= 0.005 && grade < 0.05 && this.modeT > 1) this.startRest();   // spent: sit down at the roadside
    } else { if (!brake) this.v = this.mode === 'on' ? this.v : 0; spend += (130 - P_AERO) * dt; }
    this.stam = clamp(this.stam - spend / PROFILE.energy.barJ, 0, 1);
    this.stepSeq(dt, track);
    const riding = this.mode === 'ride' || (this.mode === 'off' && this.seq?.ph === 'brake');
    // lean from turning physics (only on the board)
    if (this.pump && this.mode !== 'ride') { this.pump.A = damp(this.pump.A, 0, 3, dt); this.pump.ph += 2 * Math.PI * 0.5 * dt; if (this.pump.A < 0.02) this.pump = null; }
    const PI_ = this.pump?.I ?? 0, pw = this.pump && riding ? this.pump.A * (0.45 + 0.55 * PI_) : 0, ph0 = this.pump ? this.pump.ph : 0;
    // kinetic chain (she cannot just sway): 1. twist at the waist turns the shoulders -> 2. the hips are wound after them
    // -> 3. the wind-up tips the whole body into a diagonal lean over the edge -> 4. the board, loaded on that edge, turns.
    const pa0 = this.pump ? this.pump.A * (riding ? 1 : 0.999) : 0;
    const sh = Math.sin(ph0), hy = Math.sin(ph0 - 0.75), hp = Math.sin(ph0 - 1.25), bd = Math.sin(ph0 - 1.7), turn = Math.abs(bd);
    this.pumpTwist = pa0 * (0.5 + 0.25 * PI_) * sh;             // 1. waist twist -> shoulders ±29° (elegant) .. ±43° (power)
    this.pumpHipYaw = pa0 * (0.16 + 0.1 * PI_) * hy;            // 2. hips follow the shoulders, smaller
    this.pumpCs = pw * hp;                                      // 3. body tips diagonally over the toe / heel edge
    this.pumpTurn = pw * turn;
    this.pumpFA = pw * Math.sin(2 * (ph0 - 1.25) - 0.6);        // weight onto the front foot entering each carve, back foot leaving it
    const fq = 0.42 + 0.5 * PI_;
    this.pumpDrop = pw * (0.008 + 0.055 * PI_ * (0.5 - 0.5 * Math.cos(2 * (ph0 - 1.25))));   // elegant: stands tall; power: a soft settle into each carve
    // ---- CENTRE OF MASS DRIVES THE BOARD (one physical chain, no separately animated parts):
    //  1. she leans her CoM sideways by λ (pumping: the lean is wound up by the shoulder->hip twist, phase hp);
    //  2. a lean is only balanced by a lateral acceleration a = g·tanλ  -> the path must curve with κ = a / v²;
    //  3. the board makes that curve by rolling onto its edge: per-truck steer δ = atan(κ·WB/2), deck roll φ = δ / KT
    //     (longboard trucks steer ~0.6 rad per rad of roll);
    //  4. heading ψ' = v·κ, sideways drift y' = v·sinψ: the S-line on the road follows from the lean, a quarter cycle later.
    // She also steers back to her line (lean feedback on drift & heading), slower than the pump so it doesn't cancel it.
    { const vv = Math.max(this.v, 0.8), w0 = 2 * Math.PI * fq, KT = 0.42;   // soft dancer bushings: a lean rolls the deck a lot
      const psiAmp = (0.12 + 0.11 * PI_) * clamp((this.v - 1.2) / 1.5, 0, 1);         // heading swing: ±7° elegant .. ±13° power
      const lamAmp = Math.atan(Math.min(Math.tan(20 * D), psiAmp * vv * w0 / 9.81));   // the lean that produces that swing at this speed
      // GLIDE CARVE / DANCE: no pumping — she just shifts her centre of mass a few degrees, slowly; with speed that is enough
      // for a wide, long arc (lean λ -> a = g·tanλ -> κ = a/v²). Dance arcs follow her steps (lean toward the stepping side).
      const gA = riding ? (this.glideA || 0) * (1 - pa0) : 0, dA = riding && this.dance ? (this.dn || 0) : 0;
      const lamG = (gA * (1 - dA) * 5 * Math.sin(this.glidePh || 0) + dA * 6 * Math.sin((this.dance?.t || 0) * 2 * Math.PI / 4.2)) * D;
      const lamP = riding ? pa0 * lamAmp * hp + lamG : 0;
      if (!riding) { this.pPsi = damp(this.pPsi || 0, 0, 3, dt); this.pLat = damp(this.pLat || 0, 0, 2, dt); }
      const psi = this.pPsi || 0, y = this.pLat || 0;
      const fbK = 1 - 0.35 * Math.max((this.glideA || 0) * (1 - pa0), this.dance ? 1 : 0);
      const aFb = riding ? -fbK * (1.1 * y + 1.5 * vv * Math.sin(psi)) - (1 - fbK) * (0.35 * y + 0.6 * vv * Math.sin(psi)) : 0;   // steer back to the line (gently when gliding: long arcs)
      const aP = 9.81 * Math.tan(lamP) + aFb, kP = aP / (vv * vv);
      if (riding) { this.pPsi = clamp(psi + this.v * kP * dt, -0.45, 0.45); this.pLat = clamp(y + this.v * Math.sin(this.pPsi) * dt, -0.45, 0.45); }
      this.pumpYaw = this.pPsi || 0; this.pumpLat = this.pLat || 0;
      const aLat = riding ? this.v * this.v * kappa + aP : 0;                                 // total sideways acceleration
      this.aLat = aLat;
      const leanT = clamp(Math.atan(aLat / 9.81), -30 * D, 30 * D);                           // the CoM lean that balances it
      this.lean = damp(this.lean, leanT, 5, dt);   // a heavier body leans slowly
      const kTot = riding ? kappa + kP : 0;
      this.steerT = Math.atan(kTot * HALF_WB); this.tiltT = clamp(this.steerT / KT, -24 * D, 24 * D); }
    { const onB = riding && this.air <= 0 && this.m < 0.5, dyn = (this.pumpTurn || 0) * 0.02 + (this.landFlex || 0);
      const tgt = onB ? 0.007 + dyn * 0.55 : 0;   /* a 52 kg rider on a dancer deck: ~7 mm static, ~1.5-2 cm at the pump peaks */ this.flexV = (this.flexV || 0) + ((tgt - (this.flex || 0)) * 230 - (this.flexV || 0) * 6.5) * dt; this.flex = (this.flex || 0) + this.flexV * dt;   // springy deck: under-damped
      this.landFlex = Math.max(0, (this.landFlex || 0) - dt * 0.12); }
    if (this.air > 0) this.wasAir = true; else if (this.wasAir) { this.wasAir = false; this.landFlex = 0.03; }
    this.tilt = damp(this.tilt, this.tiltT || 0, 16, dt);          // deck roll = what the trucks need for this curve
    this.steer = damp(this.steer, riding ? clamp(this.steerT || 0, -0.32, 0.32) : 0, 16, dt);
    // ollie / shove-it ballistics
    let popPitch = 0; this.spin = 0; this.footLift = 0;
    if (this.ollie) {
      const o = this.ollie, sh = o.kind === 'shove'; o.t += dt;
      if (o.t >= 0.38 && !o.popped) { o.popped = true; this.airV = sh ? 2.5 : 2.75; }
      if (o.popped) {
        this.air += this.airV * dt; this.airV -= g * dt;
        if (this.air <= 0 && this.airV < 0) { this.air = 0; this.airV = 0; if (!o.landT) { o.landT = o.t; this.v *= o.why === 'speed' ? 0.72 : 0.82;   /* landing a spin scrubs speed: tricks are how she sheds speed on a long descent */ } }
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
    const qY = new Q().setFromAxisAngle(up, yaw + (this.slideYaw || 0) + (riding ? this.pumpYaw || 0 : 0));
    if (riding) {
      this.pos.copy(tr.p).addScaledVector(up, this.air).addScaledVector(new V(Math.cos(yaw), 0, -Math.sin(yaw)), this.pumpLat || 0);
      const qP = new Q().setFromAxisAngle(new V(1, 0, 0), -this.pitch - this.boardPitch);
      const qR = new Q().setFromAxisAngle(new V(0, 0, 1), -this.tilt);
      this.board.position.copy(this.pos);
      const th = this.boardPitch, tailLift = Math.max(0, (DECK_L / 2) * Math.sin(th) - 0.105 * (1 - Math.cos(th)) - 0.095);
      this.board.position.y = tr.p.y + Math.max(this.air, tailLift);
      this.board.quaternion.copy(qY).multiply(qP);
      const PIV = new V(0, DECK_Y - 0.05, 0);
      this.deck.quaternion.copy(qR);
      this.deck.position.copy(PIV).sub(PIV.clone().applyQuaternion(qR));
    } else if (this.seq?.bPos && this.boardFixed && !(this.mode === 'off' && this.seq.ph === 'pick' && this.seq.pick === 'kick')) { this.board.position.copy(this.seq.bPos); this.board.quaternion.copy(this.seq.bQ); this.deck.quaternion.identity(); this.deck.position.set(0, 0, 0); }
    { const f = this.flex || 0, L = DECKLOAD, key = f + L.a * 3 + L.b * 7 + L.wa * 11 + L.twist * 13; if (Math.abs(key - (this.flexDrawn || 0)) > 0.0003) { this.flexDrawn = key;
        // bend in the BOARD's frame: the bottom graphic is rotated 180° about x (its local y points down), so its sign flips —
        // before, it bent the opposite way, poked up through the grip at the ends (wrong colour) and looked like the edges curling down.
        // Normals are recomputed so the bent deck shades correctly.
        for (const { m, base } of this.board.userData.flexMeshes) { const a = m.geometry.attributes.position, arr = a.array, sgn = Math.cos(m.rotation.x) < 0 ? -1 : 1;
          const sx = m.scale.x || 1, sz = m.scale.z || 1;
          for (let i = 0; i < arr.length; i += 3) arr[i + 1] = base[i + 1] - sgn * flexAt(base[i + 2] * sz, f, base[i] * sx) / (m.scale.y || 1);
          a.needsUpdate = true; m.geometry.computeVertexNormals(); } } }
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
    this.placeHeldBoard(); this.restBoard(track);
    this.events(dt, ctx);
    this.vrm.update(dt);
  }

  // ---------------- climb planner ----------------
  // Looks up to 150 m ahead for the next climb (contiguous stretch with grade > 1%). Prices riding it:
  //   E_ride = (m·g·Δh + m·g·Crr·L + ½ρCdA·v²·L − ½m·v0²) / eff     (momentum pays first, legs pay the rest)
  // and decides: momentum carries it -> just roll; bar covers it (with 25% margin) and it is not too steep
  // FOR ITS LENGTH -> push up; otherwise -> get off before it and walk.
  planClimb(track) {
    // FORWARD SIMULATION over everything she can see ahead (PROFILE.mind.lookAheadM): ride it in 1 m steps with real
    // physics (gravity, rolling, air) and her own effort: pumps when below her speed floor (power limited by what is left
    // in the bar), checks speed on descents only down to what the NEXT climb needs (keeps the run-in, Cheney), never above
    // the safe max. She gets off only where this simulation says she would really stall (v < walking pace) or the ramp
    // is too steep to ride for its length. Result drives everything else.
    const m = MASS, g = 9.81, LA = PROFILE.mind.lookAheadM, PF = PROFILE.preference, vmaxS = PF.vmaxKmh / 3.6 + 2.0, floor = PF.speedFloorKmh / 3.6;
    const pumpW = 260 * PROFILE.skill.pumpGain;   // sustainable pumping power into the board [W]
    let v = Math.max(this.v, 0.5), E = this.stam * PROFILE.energy.barJ, stallAt = null, steepAt = null, used = 0;
    let start = null, end = null, dh = 0, maxG = 0;
    const G = []; for (let d = 0; d <= LA; d++) G.push(track(this.s + d).grade);
    // is the climb ahead too steep for its length? (a short ramp can be pumped at ~10°, a long hill only up to ~6°)
    /* judge each >6° stretch by its WHOLE length (not how far into it she is): short ramp ≤6 m may be ridden up to 10°, ≤15 m up to 8°, longer only up to 6° */
    let run = 0; for (let d = 0; d <= LA && steepAt === null; d++) { if (G[d] <= Math.tan(6 * D)) continue; let e = d, mx = 0; while (e <= LA && G[e] > Math.tan(6 * D)) { mx = Math.max(mx, G[e]); e++; } run = e - d; const lim = run <= 6 ? 10 : run <= 15 ? 8 : 6; if (mx > Math.tan(lim * D)) steepAt = d; d = e; }
    for (let d = 0; d < LA; d++) {
      const gr = G[d], th = Math.atan(gr);
      if (gr > 0.01) { if (start === null) start = d; dh += gr; maxG = Math.max(maxG, gr); end = d + 1; } else if (start !== null && end !== null && d - end > 3 && end - start > 3) { /* first climb measured */ }
      // the next climb within reach decides how much run-in to keep
      let a = -g * Math.sin(th) - CRR * g * Math.cos(th) * (52 / m) - 0.5 * 1.2 * CDA * v * v / m;
      if (v < floor + 0.3 && E > 300) { const P = Math.min(pumpW, E * 0.5); const ap = P / (m * Math.max(v, 1.5)); a += ap; const cost = P / EFF * (1 / Math.max(v, 0.5)); E -= cost; used += cost; }
      v = Math.sqrt(Math.max(0, v * v + 2 * a * 1));
      if (v > vmaxS) v = vmaxS;
      if (steepAt !== null && d >= steepAt - 1) break;
      if (v < 1.0) { stallAt = d; break; }
    }
    if (start === null && steepAt === null && stallAt === null) return { kind: 'flat', sim: true, vEnd: +(v * 3.6).toFixed(0) };
    const L = (end ?? start ?? 0) - (start ?? 0), have = this.stam * PROFILE.energy.barJ;
    let kind, stopAt;
    if (steepAt !== null) { kind = 'walk'; stopAt = steepAt; }
    else if (stallAt !== null) { kind = 'pushThenWalk'; stopAt = stallAt; }
    else kind = used < 200 ? 'coast' : 'carry';
    const pstart = kind === 'walk' || kind === 'pushThenWalk' ? stopAt : (start ?? 0);
    return { kind, start: pstart, climbAt: start, L, dh, maxG, need: used, have, steepLen: run, hCarry: +((v * v) / (2 * g)).toFixed(1), vEnd: +(v * 3.6).toFixed(0), sim: true };
  }
  decide(msg) { const L = this.dlog || (this.dlog = []); if (L.length && L[L.length - 1].msg === msg) return; L.push({ t: this.t, s: this.s, msg }); if (L.length > 40) L.shift(); }
  lookAhead(track, L) { let up = 0, down = 0; for (let d = 2; d <= L; d += 2) { const gr = track(this.s + d).grade; if (gr > 0.03) up += 2; if (gr < -0.02) down += 2; } return { up: up > L * 0.3, down: down > L * 0.4 }; }
  // REST (Cheney): energy at zero -> she stops at the roadside, puts the board down and sits on it; resting refills
  // fastest; she gets up at ~60% and carries on (walking, or back on the board if the road allows).
  startRest() { this.decide('体力 0：路边坐下休息'); this.rest = { t: 0, sit: false, s0: this.s }; this.ev.push(['rest', this.s]); }
  updateRest(dt) { const R = this.rest; if (!R) return; R.t += dt;
    const up = PROFILE.energy.getUpAt; const keep = this.stam < up || R.t < PROFILE.energy.minSitS; R.sit = R.t > 1.2 && keep; this.sitW = damp(this.sitW || 0, R.t > 1.0 && keep ? 1 : 0, 2.2, dt);
    if (this.stam >= up && R.t < PROFILE.energy.minSitS) this.sitW = Math.max(this.sitW, 0.99);   /* sit at least a few seconds even if the bar is back */
    if (this.stam >= up && this.sitW < 0.05) { this.rest = null; this.modeT = 0; } }
  restBoard(track) { const R = this.rest; if (!R || !this.hold) return; const k = sstep(0.3, 1.0, R.t) * (this.stam < 0.6 ? 1 : 1 - sstep(0, 0.8, (R.t2 = (R.t2 || 0) + 1 / 30)));
    if (k <= 0.001) return; const tr = track(R.s0), l = new V(Math.cos(tr.yaw), 0, -Math.sin(tr.yaw)); const p = tr.p.clone().addScaledVector(l, this.lat || 0); const q = this.boardRestQ(R.s0, track);
    this.board.position.lerp(p, k); this.board.quaternion.slerp(q, k); this.board.updateMatrixWorld(true); }
  // ---------------- mode sequences ----------------
  startOff(why) {
    this.decide('下板：' + ({ steep: '前面太陡（>6°）', long: '前面长坡，体力不够推', slow: '速度没了', tired: '体力耗尽' }[why] || why));
    this.push = null; this.dance = null;   /* pump keeps decaying smoothly through the brake, never frozen */ this.offWhy = why; this.mode = 'off'; this.modeT = 0;
    const r = Math.random(), kind = this.v > 3.2 ? (r < 0.6 ? 'slide' : 'heel') : (r < 0.34 ? 'slide' : r < 0.67 ? 'heel' : 'roll');
    this.seq = { kind, ph: 'brake', t: 0, decel: { slide: 2.6, heel: 1.4, roll: 0.45 }[kind] };
    this.ev.push(['off', this.s, kind, why]);
  }
  startOn() { this.decide('上板：前面能滑（体力 ' + Math.round(this.stam * 100) + '%）'); 
    /* THROWDOWN (Cheney's refs: Alina Ruess tQNzYSUsJdk 73.4-74.8 s side, 1MQl0CZNdls 0.07-1.5 s back): she jogs with the NOSE in her
       right hand while the TAIL WHEELS ROLL on the path beside her right leg, presses the nose down (pivot = rear axle, still
       rolling), lets go, runs a step or two on its left, then steps on foot by foot (front foot onto the bolts, back foot swings
       onto the tail). No toss, no two-foot jump, only a light absorb. */
    this.mode = 'on'; this.modeT = 0; this.slowT = 0; this.seq = { ph: 'run', t: 0, lat0: this.lat };
    this.board.updateMatrixWorld(true); this.seq.bFrom = this.board.position.clone(); this.seq.qFrom = this.board.quaternion.clone();
    this.hold = { qFrom: this.board.quaternion.clone(), gFrom: new V(), t: 0, T: this.TD.grabT, drop: 0 }; this.carry = 1; this.carryStyle = 'drag'; this.clampQ = null;
    this.dragPhi = this.TD.dragPhi * D; this.ev.push(['on', this.s]);
  }
  jogPh() { const S = this.seq; return this.mode === 'on' && !!S && (S.ph === 'run' || S.ph === 'set' || S.ph === 'beside'); }
  requestTrick() { this.trickReq = true; return !!this.trickReady; }
  startTrick(why) {
    this.ollie = { t: 0, kind: 'shove', dir: Math.random() < 0.5 ? 1 : -1, why }; this.trickCool = why === 'full' ? 6 : 20;   /* player-triggered: short cooldown, the 70% bar is the real limit */
    this.stam = Math.max(0, this.stam - (MASS * 9.81 * 0.32 / EFF + 450) / EMAX);   /* a trick costs ~1.3 kJ (≈9% bar) */ this.ev.push(['trick', this.s, why]);
  }
  boardRestQ(s, track) { const tr = track(s), q = new Q().setFromAxisAngle(new V(0, 1, 0), Math.atan2(tr.dir.x, tr.dir.z)); return q.multiply(new Q().setFromAxisAngle(new V(1, 0, 0), -Math.atan(tr.grade))); }
  carryQ() {
    // board on edge, long axis along her walking direction, deck facing her leg (grip tape inward)
    const q = this.walkF.quaternion.clone().multiply(new Q().setFromAxisAngle(new V(0, 0, 1), Math.PI / 2));
    if (this.carryStyle === 'under') q.multiply(new Q().setFromAxisAngle(new V(0, 0, 1), -0.5));   // tilted: bottom edge out, rests on the forearm
    if (this.carryStyle === 'clamp') q.multiply(new Q().setFromAxisAngle(new V(0, 0, 1), 0.12));   // CLAMP: board on edge against her hip, top rail leaning in a touch
    return q;
  }
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
        if (S.t > 0.8) { S.ph = 'pick'; S.t = 0; S.pick = this.forcePick || 'bend';   /* Cheney: the kick-up looked odd; bend & pick for now */ this.ev.push(['pick', this.s, S.pick]); }
      } else if (S.ph === 'pick') {
        this.m = 1; this.face = 1;
        if (S.pick === 'bend') {
          this.bend = Math.sin(clamp(S.t / 1.3, 0, 1) * Math.PI) * (S.t < 0.65 ? 1 : 1);
          if (S.t >= 0.62 && !this.hold) this.grab(S.bPos, S.bQ, new V(-0.117, DECK_Y - 0.004, 0), 0.62);
          if (S.t > 1.4) this.toWalk();
        } else {
          // kick-up (real technique): back foot stomps the tail -> board pivots on the tail wheels up to ~80°,
          // the nose rises straight into the waiting right hand at hip height; no free flight, no mystery spin.
          // Variant 'twirl' (her flourish): after the catch she spins it once around its long axis in the hand.
          this.kickStep = sstep(0.0, 0.25, S.t) * (1 - sstep(0.55, 0.75, S.t));
          if (!this.hold) {
            const u = sstep(0.22, 0.52, S.t), pitch = 80 * D * u;
            const q = S.bQ.clone().multiply(new Q().setFromAxisAngle(new V(1, 0, 0), -pitch));
            const pivL = new V(0, WHEEL_R - 0.0 - (DECK_Y - 0.014) + 0.0, -HALF_WB);      // rear axle line
            const pivW = pivL.clone().applyQuaternion(S.bQ).add(S.bPos);
            this.board.quaternion.copy(q); this.board.position.copy(pivW).sub(pivL.clone().applyQuaternion(q));
            S.kPos = this.board.position.clone(); S.kQ = q.clone();
          }
          if (S.t >= 0.5 && !this.hold) { this.grab(S.kPos, S.kQ, new V(0, DECK_Y - 0.004, 0.44), 0.55); this.hold.twirl = S.twirl ?? (S.twirl = Math.random() < 0.5); }
          if (S.t > 1.3) this.toWalk();
        }
      }
    } else { // mounting = THROWDOWN (see startOn). The board is placed from its REAR AXLE (S.ax = track s of the axle, rolling
      // on the path's centre line) and its nose-up angle phi; she jogs TD.lat to the left of that line, right hand on the nose.
      const TD = this.TD;
      const jog = (vT) => { this.v = damp(this.v, vT, 2.6, dt);   /* a real accelerating run */ this.s += this.v * dt; this.phi += this.v * dt / 1.25; this.stam = Math.max(0, this.stam - (260 * dt) / EMAX); this.m = 1; this.face = 1; };
      const zN = (ph) => 0.8 * Math.cos(ph) - (DECK_Y - WHEEL_R) * Math.sin(ph);   /* rear axle -> nose grip, along the path */
      if (S.ax === undefined) { S.phi = TD.dragPhi * D; S.ax = this.s + 0.12 - zN(S.phi); S.bl = S.lat0 - TD.lat; }   /* board line TD.lat to her right (she keeps her own line: no sideways foot slip) */
      if (S.ph === 'run') {   /* tail wheels roll beside her right leg; she leans into the run and drifts left of the board line */
        jog(TD.runV); S.ax += this.v * dt; S.ax = lerp(S.ax, this.s + 0.12 - zN(S.phi), 0.25);
        this.swingK = sstep(0, 0.4, S.t);
        if (S.t > TD.run) { S.ph = 'set'; S.t = 0; S.vAx = this.v; }
      } else if (S.ph === 'set') {   /* presses the nose down: the board pivots on the rolling rear axle; the nose swings forward-down */
        jog(TD.runV); S.ax += S.vAx * dt; const u = sstep(0, TD.set, S.t); this.swingK = 1 + 0.35 * u;
        /* the deck follows her hand down (it cannot go lower than she reaches): pivot height from last frame's hand */
        const hy = this.b.rightHand.getWorldPosition(new V()).y - (this.groundFn ? this.groundFn(this.board.position.x, this.board.position.z) : 0) - WHEEL_R - 0.03;
        S.phi = Math.min(S.phiPrev ?? TD.dragPhi * D, Math.max(lerp(TD.dragPhi, TD.setPhi, u) * D, Math.asin(clamp(hy / 0.81, 0, 1)) - 0.04)); S.phiPrev = S.phi;   /* only ever pressed down */
        if (S.t > TD.set) { this.hold = null; this.carry = 0; this.swingK = 0; S.ph = 'beside'; S.t = 0; S.phiR = S.phi; this.ev.push(['set', this.s]); }
      } else if (S.ph === 'beside') {   /* lets go: the last few degrees drop flat, the board rolls on a bit slower; she runs a step beside it */
        jog(lerp(TD.runV, TD.boardV + 0.15, sstep(0, TD.beside, S.t))); S.vAx = damp(S.vAx, TD.boardV, 3, dt); S.ax += S.vAx * dt;
        S.phi = S.phiR * (1 - sstep(0, Math.max(TD.settle, 0.2 * S.phiR / (30 * D)), S.t));   /* falls flat about the rear axle */ this.swingK = 0.6 * (1 - sstep(0, TD.beside, S.t));
        if (S.t > TD.beside) { S.ph = 'step'; S.t = 0; S.s0 = this.s; S.lat1 = this.lat; S.v0 = this.v; this.ev.push(['step-on', this.s]); }
      } else {   /* step: per-foot HOP-ON paths in solveLegs (front foot onto the bolts, back foot swings onto the tail) */
        S.vAx = damp(S.vAx, TD.boardV, 3, dt); S.ax += S.vAx * dt; S.phi = 0; const u = sstep(0, TD.step, S.t), bs = S.ax + HALF_WB;
        this.s = lerp(S.s0, bs, u); this.v = lerp(S.v0, S.vAx, u); this.phi += this.v * dt / 1.25 * (1 - u); this.lat = lerp(S.lat1, S.bl, u);
        this.m = 1 - sstep(0.0, TD.step, S.t); this.face = 1 - sstep(0.05, TD.step, S.t);
        if (S.t > TD.step + 0.02) {
          this.s = bs; this.mode = 'ride'; this.modeT = 0; this.seq = null; this.boardFixed = false; this.m = 0; this.face = 0; this.lat = 0; this.slideYaw = 0; this.slideDir = 0; this.swingK = 0;
          this.v = S.vAx; this.pushCool = 0.8; this.mount = { t: 0 }; this.pump = { t: 0, ph: 0, I: 0.8, A: 0.3 }; this.pumpHold = 3.0; this.decide('上板了，马上 pump 提速'); this.pLat = this.pumpLat = S.bl; this.pPsi = 0;   /* rides from the board's line, carves gently back to the path line */
          this.ev.push(['hop-on', this.s]); return;
        }
      }
      this.placeDrag(track); this.boardFixed = true;
      if (S.ph !== 'run' || S.t > 0.05) for (const w of this.board.userData.trucks[1].wheels) w.rotation.x += (S.vAx ?? this.v) * dt / WHEEL_R;
      if (!this.hold) for (const w of this.board.userData.trucks[0].wheels) w.rotation.x += (S.vAx ?? this.v) * dt / WHEEL_R;
    }
    if (this.boardFixed && !this.hold && S.bPos && !(this.mode === 'off' && S.ph === 'pick' && S.pick === 'kick')) { this.board.position.copy(S.bPos); this.board.quaternion.copy(S.bQ); }
  }
  // THROWDOWN board pose: rear wheels ON the path (axle at track s = S.ax, path centre line), deck nose-up by S.phi (+ the slope)
  placeDrag(track) {
    const S = this.seq, tr = track(S.ax), A = tr.p.clone().addScaledVector(new V(tr.dir.z, 0, -tr.dir.x).normalize(), S.bl || 0); if (this.groundFn) A.y = this.groundFn(A.x, A.z);
    A.y += WHEEL_R; const yaw = Math.atan2(tr.dir.x, tr.dir.z), ph = S.phi + Math.atan(tr.grade);
    const q = new Q().setFromAxisAngle(new V(0, 1, 0), yaw).multiply(new Q().setFromAxisAngle(new V(1, 0, 0), -ph));
    S.bQ = q; S.bPos = A.sub(new V(0, WHEEL_R, -HALF_WB).applyQuaternion(q));
    /* nose-up: the tail (it reaches 0.2 m behind the rear axle) swings DOWN and would sink. Lift the whole board so the
       lowest of {rear wheels, tail tip underside} sits on the road: steep -> rolls on the tail tip/kicktail, shallow -> on the wheels */
    let low = 0; for (const lp of [new V(0, DECK_Y - 0.0145, -DECK_L / 2), new V(0.1, DECK_Y - 0.0145, -DECK_L / 2 + 0.06), new V(-0.1, DECK_Y - 0.0145, -DECK_L / 2 + 0.06)]) {
      const w = lp.applyQuaternion(q).add(S.bPos), gy = this.groundFn ? this.groundFn(w.x, w.z) : tr.p.y; low = Math.min(low, w.y - gy); }
    if (low < 0) S.bPos.y -= low;
  }
  toWalk() { this.mode = 'walk'; this.modeT = 0; this.seq = null; this.boardFixed = false; this.bend = 0; this.kickStep = 0; this.carry = 1; }
  grab(pos, q, gripL, T) { this.hold = { qFrom: q.clone(), gFrom: gripL.clone(), t: 0, T, drop: 0 }; this.carry = 1; this.carryStyle = this.forceCarry || 'clamp'; }
  // hand targets for the right arm (reach for the board, carry it, hand it down)
  armTargets(track) {
    let w = 0; const S = this.seq;
    if (this.hold && this.carryStyle === 'drag' && S?.bQ) { w = 1;   /* THROWDOWN: right hand on the nose (top of the deck, near the tip) */
      const nose = new V(0, DECK_Y + 0.02, 0.43).applyQuaternion(S.bQ).add(S.bPos), u = sstep(0, this.hold.T, this.hold.t);
      this.armIKt.copy(this.walkF.localToWorld(new V(-0.235, 0.715, 0.04)).lerp(nose, u)); }
    else if (this.hold || this.mode === 'walk') { w = 1;
      // top: arm hangs nearly straight by the side, hand just outside the hip; board top rail at hand height -> hangs low beside the leg
      // under: elbow bent ~90°, hand at hip height further out, forearm outside the board
      this.armIKt.copy(this.walkF.localToWorld(this.carryStyle === 'clamp' ? new V(-0.235, 0.715, 0.04) : this.carryStyle === 'under' ? new V(-0.37, 0.86, 0.12) : new V(-0.25, 0.70, 0.02))); }
    if (S && this.mode === 'off' && S.ph === 'pick' && !this.hold) {
      const tgt = S.pick === 'bend' ? new V(-0.117, DECK_Y, 0).applyQuaternion(S.bQ).add(S.bPos) : new V(0, DECK_Y, 0.44).applyQuaternion(this.board.quaternion).add(this.board.position);
      if (S.pick === 'kick') { const nose = new V(0, DECK_Y, 0.44).applyQuaternion(S.bQ.clone().multiply(new Q().setFromAxisAngle(new V(1, 0, 0), -80 * D))).add(S.bPos.clone().add(new V(0, 0, 0))); tgt.copy(nose); }
      w = S.pick === 'bend' ? sstep(0.15, 0.55, S.t) : sstep(0.15, 0.45, S.t); this.armIKt.copy(tgt);
    }
    if (this.hold && this.hold.drop > 0) { const gp = new V(-0.117, DECK_Y, 0).applyQuaternion(this.seq.bQ).add(this.seq.bPos); this.armIKt.lerp(gp, this.hold.drop); }
    if (this.mode === 'on' && S?.ph === 'step') w = 0;
    this.armIKw = damp(this.armIKw, w, this.mode === 'on' && w < this.armIKw ? 4 : 14, 1 / 30);   /* throwdown release: the hand leaves the nose softly */
  }
  // NO CLIPPING while carrying: sample the skinned vertices of her right arm, hips, thighs, skirt; any that fall inside the
  // deck slab (or within 8 mm of it) push the board out along its deck normal, away from her body. The hand's own fingers
  // are allowed to wrap the rail. Smoothed so the board doesn't jitter.
  // CLAMP HAND: palm turned up under the bottom rail, fingers pointing in toward her body so they hook round the rail
  // (fingers can only curl one way: toward the palm). Solved geometrically from the hand's own finger bones, so it does
  // not depend on the rig's bone axes: align finger direction, then roll about it so the palm faces up.
  clampHand() {
    // Solve the wanted hand orientation ONCE per frame as a full frame (finger dir + palm normal -> rotation), in the
    // forearm's local space, then slerp toward it. The old two-step solve (aim fingers, then roll palm) was evaluated on
    // the pose it had just written, so it flipped between two answers each frame (hand jittered up to 50°/frame and the
    // cuff, skinned partly to the hand, shook with it).
    const H = this.vrm.humanoid, hd = this.b.rightHand, la = this.b.rightLowerArm;
    const mp = H.getRawBoneNode('rightMiddleProximal'), ip = H.getRawBoneNode('rightIndexProximal'), lp = H.getRawBoneNode('rightLittleProximal');
    if (!mp || !ip || !lp) return;
    const w = (this.hold ? sstep(0, this.hold.T, this.hold.t) : 1) * (1 - (this.hold?.drop || 0));
    if (w <= 0.01) { this.clampQ = null; return; }
    // hand-local axes, measured once from the rest pose of the finger bones
    if (!this.handAx) { const F = mp.position.clone().normalize(), S = ip.position.clone().sub(lp.position).normalize(); const N = F.clone().cross(S).normalize(); S.copy(N.clone().cross(F)).normalize();
      this.handAx = new THREE.Matrix4().makeBasis(F, S, N); }
    this.root.updateMatrixWorld(true);
    const inward = new V(1, 0, 0).applyQuaternion(this.walkF.quaternion).normalize(), fw = new V(0, 0, 1).applyQuaternion(this.walkF.quaternion), up = new V(0, 1, 0);
    const fT = inward.clone().multiplyScalar(0.8).addScaledVector(up, 0.25).addScaledVector(fw, 0.25).normalize();
    const nT = up.clone().addScaledVector(inward, 0.35).normalize().multiplyScalar(-1);   // palm faces up -> back-of-hand normal points down
    nT.addScaledVector(fT, -nT.dot(fT)).normalize(); const sT = nT.clone().cross(fT).normalize();
    const want = new Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(fT, sT, nT)).multiply(new Q().setFromRotationMatrix(this.handAx).invert());   // world quat of the hand
    const parentQ = la.getWorldQuaternion(new Q()), wantL = parentQ.clone().invert().multiply(want);
    // pick the sign of the palm normal that is closer to the current pose (avoids a 180° flip if the rig's axes differ)
    const alt = parentQ.clone().invert().multiply(new Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(fT, sT.clone().negate(), nT.clone().negate())).multiply(new Q().setFromRotationMatrix(this.handAx).invert()));
    const tgtL = (this.clampSign ?? (hd.quaternion.angleTo(wantL) <= hd.quaternion.angleTo(alt) ? (this.clampSign = 1) : (this.clampSign = -1))) > 0 ? wantL : alt;
    this.clampQ = this.clampQ ? this.clampQ.slerp(tgtL, 0.25) : hd.quaternion.clone().slerp(tgtL, 0.25);
    hd.quaternion.copy(hd.quaternion.clone().slerp(this.clampQ, w)); hd.updateMatrixWorld(true);
  }
  // BOARD vs BODY while carrying. The board is clamped BETWEEN her forearm (outside) and her hip/coat (inside):
  //  - any forearm/upper-arm vertex inside the deck slab moves the board toward her body (the arm never goes through it);
  //  - the board is then pressed ~12 mm into her side; the coat/skirt/skin under it is flattened onto the deck face by the
  //    PRESS vertex shader (clothes visibly squashed by the board instead of the board vanishing into them).
  clearBoard() {
    const V3 = THREE.Vector3, vrm = this.vrm;
    if (!this._clr) { this._clr = []; vrm.scene.traverse((o) => { if (!o.isSkinnedMesh || !o.visible) return; const sk = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight, idx = [], arm = [];
        for (let i = 0; i < o.geometry.attributes.position.count; i += 3) { let bi = sk.getX(i), bw = sw.getX(i); for (const c of ['getY', 'getZ', 'getW']) if (sw[c](i) > bw) { bw = sw[c](i); bi = sk[c](i); }
          const n = o.skeleton.bones[bi].name; if (/Hand|Index|Middle|Ring|Little|Thumb|Hair|Face|Head|Neck/.test(n)) continue;
          if (/R_LowerArm|R_UpperArm/.test(n)) { idx.push(i); arm.push(1); } else if (/Hips|R_UpperLeg|Skirt|Spine|Chest/.test(n)) { idx.push(i); arm.push(0); } }
        if (idx.length) this._clr.push({ o, idx, arm }); }); this.setupPress(); }
    const MID = DECK_Y - 0.0065, HALF = 0.0075, PRESS = 0.012;
    let sb = 1;
    for (let it = 0; it < 4; it++) {
      this.board.updateMatrixWorld(true); const inv = this.board.matrixWorld.clone().invert(), v = new V3();
      sb = this.b.hips.getWorldPosition(new V3()).applyMatrix4(inv).y > MID ? 1 : -1;   // which deck face looks at her
      let armNeed = 0, gap = 1;
      for (const { o, idx, arm } of this._clr) for (let k = 0; k < idx.length; k++) { o.getVertexPosition(idx[k], v); v.applyMatrix4(o.matrixWorld).applyMatrix4(inv);
        const hw = 0.125 * Math.min(1, 1.6 * (1 - Math.abs(v.z) / 0.57) + 0.3); if (Math.abs(v.z) > 0.57 || Math.abs(v.x) > hw) continue;
        const d = (v.y - MID) * sb;   // + = toward her body
        if (arm[k]) { if (d > -HALF - 0.004 && d < 0.05) armNeed = Math.max(armNeed, d + HALF + 0.004); }   // arm must stay beyond the OUTER face
        else if (d > -0.06) gap = Math.min(gap, d - HALF); }
      const move = clamp(Math.max(armNeed, gap < 1 ? gap + PRESS : 0), -0.03, 0.03);
      if (Math.abs(move) < 0.0008) break;
      this.board.position.addScaledVector(new V3(0, sb, 0).applyQuaternion(this.board.quaternion), move);
    }
    this.board.updateMatrixWorld(true);
    const U = this.pressU; if (U) { U.uBInv.value.copy(this.board.matrixWorld).invert(); U.uB.value.copy(this.board.matrixWorld); U.uSide.value = sb; U.uOn.value = 1; }
  }
  // PRESS shader: after skinning, coat/skirt/skin vertices that are on her side of the carried deck but would be inside it
  // are moved onto the deck face (+2 mm). Arm vertices are excluded (aPress = 0) — they stay outside the board.
  setupPress() {
    if (this.pressU) return;
    const U = this.pressU = { uBInv: { value: new THREE.Matrix4() }, uB: { value: new THREE.Matrix4() }, uSide: { value: 1 }, uOn: { value: 0 }, uMid: { value: DECK_Y - 0.0065 }, uHalf: { value: 0.0075 + 0.002 } };
    this.vrm.scene.traverse((o) => {
      if (!o.isSkinnedMesh || /Hair|Face/.test(o.name)) return;
      const g = o.geometry, sk = g.attributes.skinIndex, sw = g.attributes.skinWeight, n = g.attributes.position.count, a = new Float32Array(n);
      for (let i = 0; i < n; i++) { let armW = 0; for (const [c, cw] of [['getX', 'getX'], ['getY', 'getY'], ['getZ', 'getZ'], ['getW', 'getW']]) { const bn = o.skeleton.bones[sk[c](i)]?.name || ''; if (/Arm|Hand|Index|Middle|Ring|Little|Thumb|Shoulder/.test(bn)) armW += sw[cw](i); } a[i] = armW < 0.3 ? 1 : 0; }
      g.setAttribute('aPress', new THREE.BufferAttribute(a, 1));
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (m.userData.press) continue; m.userData.press = true;
        const prev = m.onBeforeCompile, key0 = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
        m.onBeforeCompile = (sh, r) => { prev?.call(m, sh, r); Object.assign(sh.uniforms, U);
          sh.vertexShader = 'attribute float aPress; uniform mat4 uBInv; uniform mat4 uB; uniform float uSide, uOn, uMid, uHalf;\n' + sh.vertexShader.replace('#include <project_vertex>', `
          if (uOn > 0.5 && aPress > 0.5) { vec4 wp = modelMatrix * vec4(transformed, 1.0); vec3 bl = (uBInv * wp).xyz;
            float hw = 0.13 * min(1.0, 1.6 * (1.0 - abs(bl.z) / 0.58) + 0.3);
            if (abs(bl.z) < 0.58 && abs(bl.x) < hw) { float d = (bl.y - uMid) * uSide;
              if (d < uHalf && d > -0.09) { bl.y = uMid + uSide * (uHalf + max(0.0, -d - uHalf) * 0.04); transformed = (inverse(modelMatrix) * (uB * vec4(bl, 1.0))).xyz; } } }
          #include <project_vertex>`);   /* after skinning AND cloth flutter; cloth that flared past the outer face is tucked back to her side */
          m.userData.pressOK = sh.vertexShader.includes('aPress > 0.5') && sh.vertexShader.includes('uBInv * wp'); };
        m.customProgramCacheKey = () => key0() + '+press'; m.needsUpdate = true; }
    });
  }
  placeHeldBoard() {
    const H = this.hold; if (!H) { if (this.pressU) this.pressU.uOn.value = 0; return; }
    if (this.carryStyle === 'drag') { const S = this.seq; if (this.pressU) this.pressU.uOn.value = 0; if (!S?.bQ) return;   /* THROWDOWN: from the clamp carry down to the rolling drag pose */
      H.t += 1 / 30; const u = sstep(0, H.T, H.t); this.board.quaternion.copy(S.qFrom.clone().slerp(S.bQ, u)); this.board.position.copy(S.bFrom.clone().lerp(S.bPos, u)); this.board.updateMatrixWorld(true); return; }
    H.t += 1 / 30; const u = sstep(0, H.T, H.t), du = H.drop;
    const hand = this.b.rightHand.getWorldPosition(new V());
    // grip point in board-local coords. top: fingers over the UPPER rail (x=-rail after the 90° roll -> up), board hangs from the hand.
    // under: hand cups the LOWER rail from below, forearm runs along the outside of the deck.
    const gTo = this.carryStyle === 'clamp' ? new V(0.128, DECK_Y - 0.022, -0.02) : this.carryStyle === 'under' ? new V(0.117, DECK_Y - 0.03, 0.05) : new V(-0.117, DECK_Y - 0.004, 0);   // clamp: palm cups the BOTTOM rail from below/outside, fingers hook round it toward her body   // carry frame: board +x points UP. top: fingers hook over the UPPER rail, board hangs below the hand; under: hand cups the LOWER rail
    const tw = H.twirl ? 2 * Math.PI * sstep(0.1, 0.9, H.t / (H.T + 0.5)) : 0;
    const sw = (this.mode === 'walk' ? 1 : 0.4) * (this.carryStyle === 'clamp' ? 0.35 : 1), ph2 = this.phi * Math.PI * 2;
    let q = H.qFrom.clone().slerp(this.carryQ().multiply(new Q().setFromAxisAngle(new V(0, 0, 1), Math.sin(ph2) * 0.05 * sw)).multiply(new Q().setFromAxisAngle(new V(0, 1, 0), Math.sin(ph2 - 0.7) * 0.07 * sw)).multiply(new Q().setFromAxisAngle(new V(1, 0, 0), Math.sin(2 * ph2 - 0.9) * 0.03 * sw)), u).multiply(new Q().setFromAxisAngle(new V(0, 0, 1), tw));
    let g = H.gFrom.clone().lerp(gTo, u);
    if (du > 0) { q = q.slerp(this.seq.bQ, du); }
    this.board.quaternion.copy(q); this.board.position.copy(hand).sub(g.clone().applyQuaternion(q));
    if (du < 0.5 && u > 0.3) this.clearBoard(); else if (this.pressU) this.pressU.uOn.value = 0;
    if (du > 0.98) { this.board.position.copy(this.seq.bPos); this.board.quaternion.copy(this.seq.bQ); }
    this.board.updateMatrixWorld(true);
  }

  startDance() {
    this.pump = null; this.dance = { t: 0 }; this.stam = Math.max(0, this.stam - 300 / EMAX); this.ev.push(['dance', this.s]); }
  // foot keyframes on the deck (z along board, + = nose; x across, + = her toe side is -x): [t, lz, rz, liftL, liftR, lx, rx]
  danceFeet() {
    const u = this.dance.t, K = DANCE_K; let i = 0; while (i < K.length - 2 && K[i + 1][0] <= u) i++;
    const a = K[i], b = K[i + 1], f = sstep(a[0], b[0], u);
    const L = (j) => lerp(a[j], b[j], f), arc = (j) => (a[j] !== b[j] ? Math.sin(f * Math.PI) * 0.07 : 0);
    return { lz: L(1), rz: L(2), ly: arc(1) + L(3), ry: arc(2) + L(4), lx: L(5), rx: L(6), k: i };
  }
  startPush(grade) { this.decide(grade > 0.03 ? '上坡推板' : '速度低，推板');
    const T = grade > 0.03 ? 1.0 : 1.3;
    this.push = { t: 0, T, contact: null };
    this.pushCount++;
  }
  pushAccel() {
    const p = this.push;
    // contact window inside the cycle
    const c0 = 0.3 * p.T, c1 = c0 + clamp(0.6 / Math.max(this.v, 0.6), 0.22, 0.45);   // a long stroke: the foot stays on the road while the body rolls past
    p.c0 = c0; p.c1 = c1;
    const gr = this.gradeNow || 0, def = Math.max(0, (this.vFloor || 5.5) - this.v), F = clamp(PROFILE.skill.pushForceN + 70 * def + MASS * 9.81 * Math.max(0, Math.sin(Math.atan(gr))) * 1.6, 120, 380);
    p.F = F; return p.t > c0 && p.t < c1 && !p.abort ? F / MASS : 0;   /* harder kick when slower / uphill; the work F·v is billed to the stamina bar */
  }

  stateWeights(dt, grade, ctx) {
    const w = this.w;
    if (this.push) {
      this.push.t += dt;
      if (this.push.t >= this.push.T) {
        this.push = null; this.pushCool = this.v < 10 / 3.6 ? 0.05 : 0.7;   /* still slow: next kick straight away (蹬蹬蹬) */
      }
    }
    w.push = damp(w.push, this.push ? 1 : 0, 7, dt);
    w.tuck = damp(w.tuck, sstep(-0.02, -0.06, grade) * sstep(2.6, 4.2, this.v) * (1 - (this.pump?.A || 0)), 2.5, dt);
    w.effort = damp(w.effort, sstep(0.02, 0.055, grade) * (this.mode === 'ride' ? 1 : 0.5) + (this.stam < 0.15 ? 0.3 : 0), 2, dt); this.gradeNow = grade;
    const wl = this.windLocal; const ws = Math.hypot(wl.x, wl.z);
    w.wind = damp(w.wind, sstep(1.5, 6, ws), 1.5, dt);
    // look-back: occasionally turn over the trailing (right) shoulder toward the camera
    this.nextLook -= dt;
    if (this.trickReady && !this.look && !this.ollie) this.nextLook = Math.min(this.nextLook, 0);
    if (!this.look && this.nextLook <= 0 && this.mode !== 'off' && this.mode !== 'on' && !this.push && !this.ollie && Math.abs(this.lean) < 8 * D && w.tuck < 0.3 && w.effort < 0.5) {
      this.look = { t: 0, T: 2.6 }; this.ev.push(['look', this.s]);
    }
    if (this.nextLook <= 0 && !this.look) this.nextLook = 0.5;
    let lk = 0;
    if (this.look) {
      this.look.t += dt; const u = this.look.t;
      lk = sstep(0, 0.55, u) * (1 - sstep(this.look.T - 0.6, this.look.T, u));
      if (this.trickReady && u > 0.8 && u < this.look.T - 0.7) this.look.t = Math.min(this.look.t, 1.2);   // ready: she holds her gaze on us, waiting
      if (u > this.look.T) { this.look = null; const lb = Math.max(0.05, PROFILE.preference.lookBack); this.nextLook = ctx.lookEvery ?? ((14 + Math.random() * 8) * 0.6 / lb); }
    }
    w.look = lk;
    // hand tucks hair in sustained wind
    this.nextHair -= dt;
    if (!this.hairHand && !this.pump && w.wind > 0.55 && this.nextHair <= 0 && !this.push && !this.look && !this.ollie && w.tuck < 0.3) { this.hairHand = { t: 0, T: 2.0 }; this.ev.push(['hair', this.s]); }
    let hh = 0;
    if (this.hairHand) { this.hairHand.t += dt; const u = this.hairHand.t; hh = sstep(0, 0.45, u) * (1 - sstep(this.hairHand.T - 0.5, this.hairHand.T, u)); if (u > this.hairHand.T) { this.hairHand = null; this.nextHair = 9; } }
    w.hair = hh;
  }

  rot(name, x, y, z) { const b = this.b[name]; if (!b) return; b.quaternion.setFromEuler(new THREE.Euler(x, y, z, 'YXZ')); if (this.flip < 0) { b.quaternion.x *= -1; b.quaternion.z *= -1; } }

  pose(dt, ctx) {
    const w = this.w, t = this.t, b = this.b;
    const P = this.push ? this.push.t / this.push.T : 0;
    // push sub-phase envelope: down (0..0.3 reach), contact, recover
    const reach = this.push ? 0.55 * sstep(0.05, 0.32, P) * (1 - sstep(0.7, 0.98, P)) : 0;   // a woman's push: long spine, a soft knee bend, not a hunched dig
    const ol = this.ollie ? this.ollie.t : -1;
    // ollie body phases (from longboard-ollie reference: deep ~90° knee wind-up, explosive extension with arms
    // sweeping up, knees pulled toward chest in the air, then reach down and absorb on landing)
    const OP = 0.38;
    const crouchO = ol >= 0 ? (ol < OP ? sstep(0, OP * 0.9, ol) : 0) : 0;                 // wind-up
    const extend = ol >= OP && ol < OP + 0.12 ? Math.sin(((ol - OP) / 0.12) * Math.PI) : 0; // explosive extension
    const tuckAir = ol >= OP + 0.08 && this.air > 0 ? sstep(OP + 0.08, OP + 0.2, ol) * (1 - sstep(0.75, 1, -this.airV / 2.75)) : 0;
    const landAbs = this.ollie && this.ollie.landT ? Math.sin(Math.min(1, (ol - this.ollie.landT) / 0.18) * Math.PI / 2) * (1 - sstep(0.18, 0.6, ol - this.ollie.landT)) : 0;
    const pA = this.pump?.A || 0, carve = clamp(this.lean / 0.16, -1, 1) * (1 - 0.75 * pA), heel = Math.max(0, carve), toe = Math.max(0, -carve);
    this.carve = carve;
    const S = this.seq, brk = this.mode === 'off' && S?.ph === 'brake' ? S : null;
    const tallG = Math.max((this.glideA || 0) * (1 - pA), this.dance ? 1 : 0);   // gliding / dancing: she stands tall
    /* throwdown: light absorb right after the step-on (refs: knees 15-30°, torso upright), arms open while stepping on */
    if (this.mount) { this.mount.t += dt; if (this.mount.t > this.TD.absorbOut + 0.6) this.mount = null; }
    const mt = this.mount ? this.mount.t : -1, mountAbs = mt >= 0 ? Math.sin(Math.min(1, mt / this.TD.absorbIn) * Math.PI / 2) * (1 - sstep(this.TD.absorbIn, this.TD.absorbOut, mt)) : 0;
    const stepOn = this.mode === 'on' && this.seq?.ph === 'step' ? sstep(0, 0.2, this.seq.t) : 0, swingK = this.swingK || 0;
    const crouchT = clamp((brk ? (brk.kind === 'slide' ? 0.7 : brk.kind === 'heel' ? 0.45 : 0.1) * sstep(0, 0.3, brk.t) : 0) + (heel * 0.38 + toe * 0.3) * (1 - 0.75 * tallG) + w.tuck * 1.05 + crouchO * 1.55 - extend * 0.2 + tuckAir * 1.15 + landAbs * 1.1 + w.effort * 0.25 + reach * 0.15, -0.35, 1.6);
    this.crouch = damp(this.crouch ?? crouchT, crouchT + mountAbs * this.TD.crouch, this.ollie || this.mount ? 18 : 9, dt);
    const breathe = Math.sin(t * (w.effort > 0.3 ? 4.2 : 1.6)) * (0.012 + w.effort * 0.03);
    // ---- hips placement (vrm model frame: +z facing, +x = board forward)
    const sway = Math.sin(t * 0.9) * 0.008;
    const hipX = 0.0 + (this.pumpFA || 0) * 0.045 + reach * 0.1 - w.tuck * 0.02 + this.windLocal.z * -0.002;   // over the front foot when pushing
    this.oTuck = tuckAir;
    this.oDrop = damp(this.oDrop ?? 0, crouchO * 0.16 + tuckAir * 0.27 + landAbs * 0.12 + (this.pumpDrop || 0), 22, dt);
    const dn = this.dance ? sstep(0.2, 0.9, this.dance.t) * (1 - sstep(5.5, 6.3, this.dance.t)) : 0, DF = this.dance ? this.danceFeet() : null;
    this.dn = dn;
    const runB = this.jogPh(), gB = this.mode === 'walk' || runB, uB = ((this.phi % 1) + 1) % 1, SFB = runB ? 0.42 : 0.56;
    const M = this.m, F = this.face, bob = gB ? (0.5 + 0.5 * Math.cos(4 * Math.PI * (uB - SFB / 2))) * (runB ? 0.05 : 0.045) * M : Math.abs(Math.sin(this.phi * Math.PI * 2)) * 0.025 * M;
    const sitD = (this.sitW || 0) * 0.62;   /* sitting on the board at the roadside */
    const hipDrop = sitD + lerp(0.008 * (1 - 0.8 * (tallG || 0)) + this.oDrop + w.effort * 0.05 * (1 - M) + this.crouch * 0.17 + reach * 0.2 + breathe * 0.3, 0.014 - bob * 0.45 + this.bend * 0.42 + (this.kickStep || 0) * 0.03 + swingK * 0.05 + Math.max(0, swingK - 1) * 0.25, M);   // walking: nearly straight knees (a lady's walk), small bob
    const hipZ = 0.015 + (this.pumpCs || 0) * 0.06 + reach * 0.06 - w.tuck * 0.03 + w.effort * 0.02 - heel * 0.06 + toe * 0.035;
    const dHip = DF ? ((DF.ry > 0.15 ? DF.lz : (DF.lz + DF.rz) / 2) - 0.0) * dn : 0;
    // model walk: hips shift a little over the standing foot each step (pelvis side sway ~1.6 cm) — in the walk frame the
    // model's +x is her LEFT when facing forward (F=1); stance foot alternates with phi (left planted around phi≈0.28)
    const walkW = this.mode === 'walk' ? M * F : 0, hsw = walkW * 0.011 * Math.sin(this.phi * Math.PI * 2 - 0.3);
    this.hipSw = walkW * Math.sin(this.phi * Math.PI * 2 - 0.3);
    b.hips.position.set(this.hipRest.x + (hipX * (1 - M) + dHip) * this.flip + hsw, this.hipRest.y - hipDrop, this.hipRest.z + (hipZ * (1 - M) - this.bend * 0.12 + sway) * this.flip);
    // ---- torso: open toward the nose; push opens fully; look-back twists the other way
    const open = (30 * D + reach * 34 * D + w.tuck * 6 * D + dn * 45 * D) * (1 - F);
    const lb = w.look;
    const leanIn = -this.windSideLean() ;
    const tw = this.gazeTwist || 0;   // extra torso twist the head could not reach last frame (look-back toward camera)
    const tall = 1 - 0.6 * (this.pump?.A || 0);
    // pelvis: swing-side hip drops a touch (~3°) and rotates forward with the swinging leg (~5°); the chest counters it
    const hsW = this.hipSw || 0, pYaw = (this.mode === 'walk' ? M * F : 0) * Math.cos(this.phi * Math.PI * 2) * 3 * D;
    this.rot('hips', 0.0 + w.tuck * 0.15, open * 0.6 + tw * 0.15 + (this.pumpHipYaw || 0) + pYaw, leanIn * 0.3 + hsW * 1.8 * D);
    const walkLean = M * (-0.03 + Math.min(0.1, Math.max(0, this.gradeNow || 0) * 0.8)) + this.bend * 0.75 + (brk && brk.kind === 'slide' ? -0.12 : 0) + swingK * (this.TD.lean ?? 0.4) + stepOn * 0.1;
    const fwd = walkLean - 0.02 - this.dn * 0.06 + heel * 0.28 + toe * 0.05 + w.tuck * 0.48 + w.effort * 0.5 * (1 - M) + reach * 0.32 + crouchO * 0.42 + tuckAir * 0.3 - extend * 0.15 + landAbs * 0.35;
    const ptw = this.pumpTwist || 0;
    this.rot('spine', fwd * 0.45 * tall + breathe - M * 0.12, open * 0.2 + tw * 0.25 + ptw * 0.3, leanIn * 0.4 + Math.sin(t * 0.7) * 0.01);
    this.rot('chest', fwd * 0.35 * tall - breathe * 0.5, open * 0.2 + tw * 0.35 + ptw * 0.4, leanIn * 0.3);
    const gaitTw = (this.mode === 'walk' ? 1 : 0) * M * Math.cos(this.phi * Math.PI * 2) * 0.07;   // shoulders counter the hips
    this.rot('upperChest', fwd * 0.2 - breathe + M * 0.02, tw * 0.25 + ptw * 0.3 + gaitTw, 0);   // walking: chest lifted (sternum up), shoulders back
    // head: GAZE solver. Riding = eyes on the road a few metres ahead (follows the curve).
    // Look-back = she turns to look into the lens (the player), wherever the camera is.
    this.solveGaze(dt, ctx, lb, fwd, w);
    // ---- arms: relaxed, swinging; balance out on tuck/landing; right hand to hair in wind
    const bal = clamp(w.tuck * 0.9 + crouchO * 0.5 + tuckAir * 1.2 + landAbs * 0.8 + Math.abs(this.lean) * 1.2 * (1 - 0.8 * (this.pump?.A || 0)) + stepOn * 0.6 + mountAbs * 0.6, 0, 1);
    const swing = this.push ? Math.sin(P * Math.PI * 2) * 0.22 * w.push : Math.sin(t * 1.1) * 0.03;   // arms barely swing on a push
    // ARMS — two poses + an envelope.
    //  rest: hang relaxed by the sides (soft elbows, tiny swing from the body), like someone just riding along;
    //  active: open for balance (lead arm forward-low, trail arm back-low, port-de-bras).
    //  need = how much balance the moment demands; arms rise fast (~0.25 s), then settle down slowly (~1.5 s).
    const hh = w.hair;
    const need = dn > 0.05 ? 1 : M > 0.5 ? clamp(this.bend * 0.6 + (brk ? 0.8 : 0), 0, 1) : clamp(Math.max(bal, (brk ? 0.85 : 0), w.push * (0.12 + 0.3 * w.effort), w.effort * 0.45, Math.abs(carve) * 0.45 * (1 - (this.pump?.A || 0)), crouchO * 1.1, tuckAir * 1.2, landAbs, w.tuck * 0.9, (this.gust || 0) * 0.5), 0, 1);
    this.armUp = this.armUp ?? 0;
    const need0 = Math.max(need, stepOn * 0.85, mountAbs * 0.85);   /* throwdown: arms open on the step-on */
    if (need0 > this.armUp) this.armUp = damp(this.armUp, need0, stepOn || mountAbs ? 7 : 3, dt);           // unhurried rise (quicker on the step-on)
    else { this.armHold = (this.armHold ?? 0) + dt; if (this.armHold > 0.6) this.armUp = damp(this.armUp, need0, 1.3, dt); } // linger, then lower
    if (need0 > this.armUp - 0.02) this.armHold = 0;
    const pmA = this.pump?.A || 0, pmI = this.pump?.I ?? 0, glide = M < 0.5 && !this.push ? (0.16 + 0.08 * Math.sin(t * 0.45)) * (1 - pmA * (0.85 - 0.5 * pmI)) : 0;   // gliding: arms low and soft beside her
    const up = this.armForce ?? Math.max(this.armUp, glide);
    const brz = Math.sin(t * 0.73) * 0.05, brz2 = Math.sin(t * 0.57 + 1.3) * 0.06;
    const bodySw = Math.sin(t * 1.6) * 0.04 + this.lean * 0.4;   // passive pendulum with the body
    const A = this.armT || (this.armT = {});
    // elbows soft and turned slightly IN toward the body (not winged out): upper-arm x-rotation rolls the elbow back/in,
    // forearm carries the hand forward of the hip, palms face the thighs.
    // walking arm swing, OPPOSITE to the legs: the free (left) arm is furthest back when the left foot is furthest forward
    // (gait: left foot forward-most at phase 0). Measured: +lx swings the arm back.
    const wsw = M * Math.cos(this.phi * Math.PI * 2) * 0.35;
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
    // dance: wings at chest height, elbows soft, wrists leading; arm on the stepping side reaches a beat early
    if (dn > 0) { const pp = DF && DF.ry > 0.15 ? 1 : 0, sw = Math.sin(this.dance.t * 2.2) * 0.12;
      act.lz = lerp(act.lz, (-28 + pp * 6) * D, dn); act.rz = lerp(act.rz, (28 - pp * 6) * D, dn);
      act.ly = lerp(act.ly, -0.25 + sw, dn); act.ry = lerp(act.ry, 0.25 + sw, dn);
      act.le = lerp(act.le, -0.35, dn); act.re = lerp(act.re, 0.35, dn); act.lw = lerp(act.lw, -0.35, dn); act.rw = lerp(act.rw, 0.35, dn);
      // arm raise (Cheney: 手举起来, using the lean): follows the dance arc slowly; outside arm lifts above the shoulder,
      // elbow soft, the inside arm floats low — never both straight up
      const arc = Math.sin(this.dance.t * 2 * Math.PI / 4.2 - 0.5), upL = dn * Math.max(0, arc), upR = dn * Math.max(0, -arc);
      const eL = upL * upL * (3 - 2 * upL), eR = upR * upR * (3 - 2 * upR);   // smoothstep: slow in, slow out
      act.lz += eL * 30 * D; act.le = lerp(act.le, -0.7, eL); act.ly += eL * 0.35; act.lw += eL * 0.35;
      act.rz -= eR * 30 * D; act.re = lerp(act.re, 0.7, eR); act.ry -= eR * 0.35; act.rw -= eR * 0.35; }
    // ollie: arms drop low/back in the wind-up, sweep up through the pop, spread wide at shoulder height in the air
    const sweep = clamp(extend + tuckAir, 0, 1), load = crouchO * (1 - sweep);
    act.lz += (-8 * D) * load + (34 * D) * sweep; act.rz += (8 * D) * load - (34 * D) * sweep;
    act.ly += 0.25 * load - 0.15 * sweep; act.ry += -0.25 * load + 0.15 * sweep;
    act.le *= 1 - 0.45 * sweep; act.re *= 1 - 0.45 * sweep;
    { const ps = (this.pumpTwist || 0), pa = this.pump?.A || 0; act.ly += ps * 0.12; act.ry += ps * 0.12; act.lz -= pa * 14 * D; act.rz += pa * 14 * D; }   // pumping: arms calm and low, a soft swing with the shoulders
    const hair = { rx: -0.2, ry: 1.25, rz: 20 * D, re: 2.3, rw: -0.2 };
    const tgt = {};
    for (const k in rest) { tgt[k] = lerp(rest[k], act[k], up); if (k[0] === 'r' && hair[k] !== undefined) tgt[k] = lerp(tgt[k], hair[k], hh); }
    // follow-through: elbows/wrists lag the upper arm, so the hand trails when the arm rises or falls
    for (const k in tgt) A[k] = A[k] === undefined ? tgt[k] : damp(A[k], tgt[k], k.endsWith('w') ? 2.6 : k.endsWith('e') ? 3.8 : 5.5, dt);
    this.rot('leftShoulder', 0, -0.08 * M, -0.04 * bal);   // shoulder blades back: no rounded shoulders
    this.rot('leftUpperArm', A.lx, A.ly, A.lz);
    this.rot('leftLowerArm', 0, A.le, 0);
    this.rot('leftHand', 0.25, -0.1, A.lw - 0.15);
    this.rot('rightShoulder', 0, 0.08 * M, 0.05 * hh);
    this.rot('rightUpperArm', A.rx, A.ry, A.rz);
    this.rot('rightLowerArm', 0, A.re, 0);
    this.rot('rightHand', 0.25 * (1 - hh), lerp(0.1, 0.5, hh), A.rw + 0.15 * (1 - hh));
    if (this.armIKw > 0.01) {
      this.root.updateMatrixWorld(true);
      const ua = b.rightUpperArm, la = b.rightLowerArm, hd = b.rightHand, sp = ua.getWorldPosition(new V());
      const tgt = sp.clone().lerp(this.armIKt, 1).sub(sp).multiplyScalar(1).add(sp);
      const cur = hd.getWorldPosition(new V()), goal = cur.lerp(tgt, this.armIKw);
      const cl = this.carryStyle === 'clamp' && this.hold, un = this.carryStyle === 'under' && this.hold;
      const out = this.walkF.localToWorld(new V(-1, 0, un ? -1.2 : cl ? -0.35 : -0.6)).sub(this.walkF.position);
      const pole = sp.clone().add(new V(0, -0.5, 0)).addScaledVector(out, un ? 0.9 : cl ? 0.7 : 0.4);
      twoBoneIK(ua, la, hd, goal, pole);
      if (this.hold) { if (this.carryStyle === 'under') this.rot('rightHand', -0.5, 0.3, 0.6); else if (this.carryStyle !== 'clamp') this.rot('rightHand', 0, 0, 0.15); }
      if (this.hold && this.carryStyle === 'clamp') this.clampHand();
    }
    // fingers softly curled (graceful hands)
    for (const f of this.fing) {
      const sgn = f.side === 'left' ? -1 : 1;
      const k = f.f === 'Thumb' ? 0.15 : f.seg === 'Proximal' ? 0.25 + (f.f === 'Little' ? 0.15 : 0) : f.seg === 'Metacarpal' ? 0 : 0.3;
      const grip = f.side === 'right' && this.hold ? 1 : 0, kk = k + grip * (f.seg === 'Metacarpal' ? 0 : 0.9);
      if (f.f === 'Thumb') f.n.quaternion.setFromEuler(new THREE.Euler(0, sgn * (-0.25 - grip * 0.5), grip * sgn * 0.3));
      else f.n.quaternion.setFromEuler(new THREE.Euler(0, 0, sgn * kk));
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
    const NECK = 70 * D;                                   // neck+head comfortable range (~70°); torso adds a little; eyes do the rest
    const over = Math.sign(yaw) * Math.max(0, Math.abs(yaw) - NECK);
    const twWant = lb > 0.05 ? clamp(this.gazeTwist + over, -35 * D, 35 * D) : 0;
    const reach = NECK + 35 * D + 25 * D;              // what head+torso+eyes can cover
    if (this.look && Math.abs(yaw) > reach && !this.look.short) { this.look.short = true; this.look.T = Math.min(this.look.T, this.look.t + 0.6); }   // can't see the lens: a quick glance, then back
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
    const deck = (x, z, y = DECK_Y + ANK) => this.deck.localToWorld(new V(x, y + concaveAt(x, z) - flexAt(z, this.flex || 0, x), z));
    // feet stance on deck (board frame: z forward): front (left) foot over front bolts, back (right) over tail
    const P = this.push ? this.push.t / this.push.T : 0;
    const pr = this.push ? sstep(0.0, 0.25, P) * (1 - sstep(0.78, 1.0, P)) : 0;
    let lf = deck(0.015, 0.2 + pr * 0.04), rf = deck(-0.01, -0.21);
    const toeRise = (side) => this['fs_' + side + 'Rise'] || 0;
    let rYaw = -78 * D, lYaw = lerp(-50 * D, -12 * D, pr);
    let rPitch = 0;
    if (this.dance && this.m < 0.5) {
      const F = this.danceFeet();
      lf = deck(F.lx, F.lz, DECK_Y + ANK + F.ly); rf = deck(F.rx, F.rz, DECK_Y + ANK + F.ry);
      if (F.ry > 0.15) rf = deck(F.rx - 0.05, F.rz - 0.25, DECK_Y + ANK + F.ry);   // Peter Pan: back leg extends behind and up
      const fw = sstep(0.4, 1.0, this.dance.t) * (1 - sstep(5.4, 6.2, this.dance.t));
      lYaw = lerp(lYaw, -12 * D, fw); rYaw = lerp(rYaw, -20 * D, fw);   // toes point toward the nose while walking the board
    }
    if (this.ollie && this.m < 0.5) { // back foot to the tail during the crouch, front foot slides toward the nose after the pop
      const o = this.ollie.t; const tail = sstep(0.0, 0.3, o) * (1 - sstep(0.6, 0.9, o)), slide = sstep(0.36, 0.55, o) * (1 - sstep(0.75, 1.05, o));
      rf = deck(-0.01, -0.21 - tail * 0.13); lf = deck(0.015, 0.2 + slide * 0.17, DECK_Y + ANK + slide * 0.008); rYaw = -80 * D; lYaw = -65 * D;
    }
    if (this.push && !this.ollie && this.m < 0.5) {
      const p = this.push; const c0 = p.c0 ?? 0.3 * p.T, c1 = p.c1 ?? c0 + 0.3; const tt = p.t;
      if (tt < c0) { // lift off deck, swing down beside the front wheels (toe side = -x)
        // reach down to where the foot WILL touch the road at c0 (a world-fixed point ahead, at the board's speed), so the
        // foot arrives with zero ground speed — it used to ride along with the board and freeze instantly at contact (a jump)
        const u = sstep(0, c0, tt);
        const a = deck(-0.01, -0.21), here = this.groundAt(-0.29, 0.1), fwdW = new V(0, 0, 1).applyQuaternion(this.board.quaternion).setY(0).normalize();
        if (!p.plantW || tt < (p.lastT ?? 0)) p.plantW = here.clone().addScaledVector(fwdW, this.v * Math.max(0, c0 - tt));
        p.lastT = tt;
        rf = a.clone().lerp(p.plantW, u); rf.y += Math.sin(u * Math.PI) * 0.05;
        this.footPlant.copy(p.plantW);
        rYaw = lerp(-78 * D, -5 * D, u);
      } else if (tt < c1 && !p.abort) { // planted: world-stationary
        rf = this.footPlant.clone(); rYaw = -5 * D; rPitch = -0.12 * sstep(c0, c1, tt);
      } else { // recover: lift heel, come back to tail
        if (!p.rec) { p.rec = this.footPlant.clone(); p.recT = tt; }
        const u0 = clamp((tt - p.recT) / Math.max(0.05, p.T * 0.98 - p.recT), 0, 1), u = 0.5 - 0.5 * Math.cos(Math.PI * u0);   // sine ease: no velocity spike
        const back = deck(-0.01, -0.21);
        rf = p.rec.clone().lerp(back, u); rf.y += Math.sin(u0 * Math.PI) * 0.055; rYaw = lerp(-5 * D, -78 * D, u); rPitch = lerp(-0.35, 0, u);
      }
    }
    { // load the deck where the feet actually are: front/back positions and weight share (pumping shifts weight fore/aft,
      // a foot lifted off the deck carries nothing); a heel/toe lean twists the deck toward the loaded rail
      const inv = this.deck.matrixWorld.clone().invert(), lz = lf.clone().applyMatrix4(inv), rz = rf.clone().applyMatrix4(inv);
      const onL = lz.y < DECK_Y + ANK + 0.05, onR = rz.y < DECK_Y + ANK + 0.05, fa = this.pumpFA || 0;
      const L = DECKLOAD, wa = onL && onR ? clamp(0.5 + 0.22 * fa, 0.15, 0.85) : onL ? 1 : onR ? 0 : 0.5;
      L.a = clamp(lz.z, -HALF_WB + 0.02, HALF_WB - 0.02); L.b = clamp(rz.z, -HALF_WB + 0.02, HALF_WB - 0.02); if (L.a < L.b) { const tmp = L.a; L.a = L.b; L.b = tmp; }
      L.wa = damp(L.wa, wa, 12, dt); L.twist = damp(L.twist, clamp(-(this.tilt || 0) / (12 * D), -1, 1), 10, dt); }
    const M = this.m;
    if (M > 0.01) {
      // walking: feet on the ground under the hips, alternating stride ~0.55 m; at a standstill side by side
      const ph = this.phi * Math.PI * 2, st = this.mode === 'walk' ? 0.27 : this.jogPh() ? 0.42 : (this.mode === 'on' && this.seq?.ph === 'step') ? 0.2 : 0.0;
      const kick = this.kickStep || 0, bend = this.bend;
      // gait: per foot cycle u∈[0,1): STANCE (u<SF) the foot is planted — it moves back in the body frame at exactly the
      // walking speed, so it never slides on the ground; SWING it lifts, travels forward fast and sets down heel first.
      // stance length = SF·L (L = metres per foot cycle; phi advances v/L per second) => z runs +SF·L/2 .. -SF·L/2.
      const runPh = this.jogPh(), gaitOn = this.mode === 'walk' || runPh;
      const gUp = Math.max(0, this.gradeNow || 0), L = runPh ? 1.25 : 1.1 * (1 - Math.min(0.3, gUp * 1.6)), SF = runPh ? 0.42 : 0.56, half = SF * L / 2;
      const gait = (off) => { const u = ((this.phi + off) % 1 + 1) % 1;
        if (u < SF) { const k = u / SF; return { z: half * (1 - 2 * k), lift: 0, pitch: 0.42 * Math.max(0, 1 - k / 0.2) ** 2 - 0.5 * Math.max(0, (k - 0.72) / 0.28) ** 2 }; }   // heel strike → flat → heel rises (toe-off)
        const w = (u - SF) / (1 - SF), e = 0.5 - 0.5 * Math.cos(Math.PI * w);
        return { z: -half + 2 * half * e, lift: Math.sin(Math.PI * w) * (runPh ? 0.11 : 0.07), pitch: lerp(-0.5, 0.42, sstep(0.1, 0.95, w)) }; };
      const wf = (side, s) => { const sg = side === 'left' ? 1 : -1, c = Math.sin(ph + (side === 'left' ? 0 : Math.PI));
        const G = gaitOn ? gait(side === 'left' ? 0 : 0.5) : null;
        const lift = G ? G.lift : Math.max(0, Math.cos(ph + (side === 'left' ? 0 : Math.PI))) * 0.09 * (st > 0 ? 1 : 0);
        // MODEL WALK (catwalk line): each foot lands on the centre line (a hair across it), not in two hip-wide tracks —
        // from behind the legs close into a slim line instead of a bow-legged straddle. During swing the foot passes close
        // by the standing ankle (x ≈ 3 cm) and reaches across to land. Toes point straight ahead / a touch out (~4°).
        let z = G ? G.z : c * st, x = sg * 0.09;
        if (G && this.mode === 'walk') { const u = ((this.phi + (side === 'left' ? 0 : 0.5)) % 1 + 1) % 1, w = u < SF ? 0 : (u - SF) / (1 - SF);
          const land = 0.045, pass = 0.055;   /* composed, confident: feet in two close tracks (~9 cm apart), never crossing */ x = sg * (u < SF ? land : lerp(land, pass, Math.sin(Math.PI * w)) ); }
        if (side === 'left' && kick) { z += kick * 0.25; }
        if (bend) { z += side === 'left' ? 0.12 * bend : -0.1 * bend; }
        const p = this.walkF.localToWorld(new V(x, 0, z)); p.y = (this.groundFn ? this.groundFn(p.x, p.z) : this.walkF.position.y) + ANK + lift + (side === 'left' ? kick * 0.04 : 0); return p; };
      const wl = wf('left'), wr = wf('right');
      const deckL = lf.clone(), deckR = rf.clone();
      lf = lf.lerp(wl, M); rf = rf.lerp(wr, M); const tOut = this.mode === 'walk' ? 6 * D : 0; lYaw = lerp(lYaw, -90 * D - tOut * this.flip, M); rYaw = lerp(rYaw, -90 * D + tOut * this.flip, M);
      // HOP-ON: the feet used to be a blend of two unrelated poses (gait feet -> deck feet) while the run gait switched off,
      // so they jumped. Now each foot has its own path from where it really is: the front foot steps up onto the front
      // bolts first (0-0.28 s, small arc); the back foot pushes off the road (stays planted, heel rising) and swings onto
      // the tail (0.14-0.48 s). Sine-eased, so no velocity jumps; both land exactly on the deck targets.
      const S2 = this.seq;
      if (this.mode === 'on' && S2?.ph === 'step') {
        if (!S2.f0) S2.f0 = { l: (this._lfLast || lf).clone(), r: (this._rfLast || rf).clone() };
        const tt = S2.t, ez = (a, b) => { const x = clamp((tt - a) / (b - a), 0, 1); return [0.5 - 0.5 * Math.cos(Math.PI * x), x]; };
        const [ul, xl] = ez(0.0, 0.28), [ur, xr] = ez(0.14, 0.48);
        lf = S2.f0.l.clone().lerp(deckL, ul); lf.y += Math.sin(Math.PI * xl) * 0.07;
        rf = S2.f0.r.clone().lerp(deckR, ur); rf.y += Math.sin(Math.PI * xr) * 0.09;
        lYaw = lerp(-90 * D, lYaw, ul); rYaw = lerp(-90 * D, -78 * D, ur);
        rPitch = xr <= 0 ? -0.35 * sstep(0, 0.14, tt) : lerp(-0.35, 0, ur);   // push-off: heel up before the back foot leaves
      }
      const gL = gaitOn ? gait(0).pitch : 0, gR = gaitOn ? gait(0.5).pitch : 0;   // + toes up (heel strike), - heel up (toe-off)
      /* SLOPE (Cheney: shoes sink into the hill): the sole follows the ground's slope along her heading (toes up uphill,
         down downhill), and the ankle sits a sole-thickness higher on a slope so neither toe nor heel digs in */
      const slopeP = Math.atan(this.gradeNow || 0) * (this.face < 0.5 ? 0 : 1) * this.flip;
      rPitch = lerp(rPitch, -gR + slopeP, M); this.lPitch = (-gL + slopeP) * M;   // foot-bone pitch sign is the opposite (measured)
      const soleLift = Math.abs(Math.atan(this.gradeNow || 0)) * 0.06 + 0.004; lf.y += soleLift * M; rf.y += soleLift * M;
      // heel strike / toe-off: lifting the heel raises the ankle (pivot on the toes), toes-up keeps the heel on the ground
      const ank = (pt) => (pt < 0 ? -pt * 0.12 : pt * 0.03); lf.y += ank(gL) * M; rf.y += ank(gR) * M;
    }
    if (this.drag > 0) { const dp = this.groundAt(-0.02, -0.5); rf = rf.lerp(dp, this.drag * 0.8); rPitch = -0.5 * this.drag; }
    if (this.footLift) { lf.y += this.footLift; rf.y += this.footLift; }
    this._lfLast = lf.clone(); this._rfLast = rf.clone();
    const fwdModel = new V(0, 0, this.flip).applyQuaternion(this.vrm.scene.getWorldQuaternion(new Q()));
    for (const [side, target, yaw, pitch] of [['left', lf, lYaw, this.m > 0.01 ? (this.lPitch || 0) : 0], ['right', rf, rYaw, rPitch]]) {
      const up = B[side + 'UpperLeg'], lo = B[side + 'LowerLeg'], ft = B[side + 'Foot'];
      const hip = bw(up);
      // knee points the same way as the toes (knee over the second toe), so the leg reads straight and relaxed, not twisted
      const qbP = this.deck.getWorldQuaternion(new Q()).slerp(this.walkF.quaternion.clone().multiply(new Q().setFromAxisAngle(new V(0, 1, 0), 90 * D)), this.m);
      const toeDir = new V(0, 0, this.flip).applyQuaternion(qbP.clone().multiply(new Q().setFromEuler(new THREE.Euler(0, yaw + this.yaw0, 0, 'YXZ')))).setY(0).normalize();
      const kdir = fwdModel.clone().setY(0).normalize().lerp(toeDir, 0.75).normalize();
      const pole = hip.clone().addScaledVector(kdir, 1.0).add(new V(0, -0.4 + (this.oTuck || 0) * 0.5, 0));
      twoBoneIK(up, lo, ft, target, pole);
      // foot flat on deck, toes angled
      const qb = this.deck.getWorldQuaternion(new Q()).slerp(this.walkF.quaternion.clone().multiply(new Q().setFromAxisAngle(new V(0, 1, 0), 90 * D)), this.m);
      // ---- FOOT STATE (Cheney): every foot is in ONE explicit state, chosen by what it is doing —
      //  FLAT   bearing weight on deck/ground: sole follows the surface.
      //  TOE    heel up, ball of the foot pressing (垫脚尖): walking/push toe-off, popping the tail in an ollie.
      //  HOOK   dorsiflexed (勾脚), ankle ~75°: the foot is WORKING — dragging the nose in an ollie, kicking/catching the
      //         board, reaching to land (heel strike / setting the foot back on the deck).
      //  HANG   relaxed in the air (耷拉), ankle ~125°: gravity drops the toes, nothing held.
      //  POINT  for beauty (脚尖弄平), ankle ~160°, foot continuing the shin line, no sickling: Peter Pan / Titanic back
      //         leg, dance extensions.
      // Ankle angle = angle between (ankle→knee) and (ankle→toes); 90° = neutral.
      let lift = 0;
      if (this.m < 0.5) { const upv = new V(0, 1, 0).applyQuaternion(this.deck.getWorldQuaternion(new Q())); lift = target.clone().sub(this.deck.localToWorld(new V(0, DECK_Y, 0))).dot(upv) - ANK; }
      else lift = target.y - ((this.groundFn ? this.groundFn(target.x, target.z) : this.walkF.position.y) + ANK);
      const key = 'fs_' + side, prevLift = this[key + 'L'] ?? lift, vLift = (lift - prevLift) / Math.max(dt, 1e-3); this[key + 'L'] = lift;
      const air = sstep(0.015, 0.06, lift);                     // 0 = on the surface .. 1 = clearly in the air
      let state = 'flat', A = 90, toeUp = 0;
      const o = this.ollie, dnc = this.dance && this.m < 0.5 ? this.danceFeet() : null, isBack = side === 'right';
      if (air > 0.01) {
        state = 'hang'; A = 125;
        if (dnc && ((isBack && dnc.ry > 0.15) || (!isBack && dnc.ly > 0.15))) { state = 'point'; A = 160; }     // Peter Pan / extension
        if (this.mode === 'walk' || this.jogPh()) state = 'gait';               // gait pitch handles swing
        if (o && !isBack && o.t > 0.36 && o.t < 0.6) { state = 'hook'; A = 72; }                                   // ollie: front foot drags the nose up
        if (state === 'hang' && vLift < -0.25 && lift < 0.07) { state = 'hook'; A = lerp(125, 85, sstep(0.07, 0.02, lift)); }   // reaching down to land: toes up, heel first
        if (this.seq?.pick === 'kick' && isBack) { state = 'hook'; A = 75; }                                        // kicking/catching the board
      } else {
        if (o && isBack && o.t > 0.28 && o.t < 0.42) { state = 'toe'; toeUp = 0.45; }                               // ollie pop: press the tail with the ball of the foot
        const p = this.push; if (p && isBack && !p.abort) { const c1 = p.c1 ?? (p.c0 ?? 0.3 * p.T) + 0.3; if (p.t > c1 - 0.15 && p.t < c1 + 0.15) { state = 'toe'; toeUp = 0.5 * sstep(c1 - 0.15, c1, p.t) * (1 - sstep(c1 + 0.03, c1 + 0.15, p.t)); } }   // push toe-off: heel rises, then rolls off the toes
      }
      const sickle = state === 'hang' ? air * 0.08 * (side === 'left' ? 1 : -1) : 0;   // a hanging foot inverts a touch; a pointed foot never sickles
      const qf = qb.clone().multiply(new Q().setFromEuler(new THREE.Euler(pitch * this.flip, yaw + this.yaw0, sickle, 'YXZ')));
      setWorldQuat(ft, qf);
      if (state === 'toe' && toeUp > 0) { /* heel up pivots on the ball of the foot: the ankle rises */ }
      if (state === 'toe') { A = lerp(105, 135, toeUp / 0.5); }                    // tiptoe: plantar-flexed, heel up
      const drive = state === 'toe' ? Math.min(1, toeUp * 2) : air;
      if ((air > 0.01 || state === 'toe') && state !== 'gait') {
        ft.updateMatrixWorld(true); const toesB = B[side + 'Toes'];
        if (toesB) { const kp = bw(lo), ap = bw(ft), tp = bw(toesB), up2 = kp.clone().sub(ap).normalize(), fd = tp.clone().sub(ap).normalize();
          const fperp = fd.clone().addScaledVector(up2, -fd.dot(up2)); if (fperp.lengthSq() < 1e-6) fperp.set(0, 0, 1).applyQuaternion(qf); fperp.normalize();
          const alive = state === 'hang' ? 4 * Math.sin(this.t * 1.7 + (isBack ? 1.3 : 0)) : 0;
          const Ar = (A + alive) * D, want = up2.clone().multiplyScalar(Math.cos(Ar)).addScaledVector(fperp, Math.sin(Ar)).normalize();
          const cur = fd, tgt = cur.clone().lerp(want, drive).normalize();
          setWorldQuat(ft, new Q().setFromUnitVectors(cur, tgt).multiply(ft.getWorldQuaternion(new Q()))); } }
      this['footHang_' + side] = state === 'hang' ? air : 0; this['footState_' + side] = state; this['fsAir_' + side] = state === 'toe' ? 1 : air;
      const toes = B[side + 'Toes']; if (toes) toes.quaternion.setFromAxisAngle(new V(1, 0, 0), (state === 'toe' ? -toeUp * 1.4 : state === 'hook' ? -0.25 * air : state === 'hang' ? 0.2 * air : 0) * this.flip);   // toes bend up when on tiptoe / hooked, curl a touch when hanging, straight when pointed
      // no snapping between foot states: the foot's rotation relative to the shin follows its target with a short time
      // constant (~50 ms) — state changes (tiptoe -> flat, flat -> hang, hang -> hook) used to jump up to 80° in one frame
      { const kq = 'fq_' + side, tgt = ft.quaternion.clone();
        if (!this[kq] || this.t - (this[kq + 't'] ?? -1) > 0.2) this[kq] = tgt.clone();
        else this[kq].slerp(tgt, 1 - Math.exp(-dt * 12));
        this[kq + 't'] = this.t; ft.quaternion.copy(this[kq]); }
      ft.updateMatrixWorld(true);
    }
  }
  // calibrate the ankle height from the skinned shoe: after a frame on the deck, lift/lower the feet so the lowest sole
  // vertex sits on the grip tape (models differ; a squashed platform sole changes it too)
  calibrateFeet() {
    // ankle height = left foot bone minus the lowest skinned shoe vertex near that foot (independent of where the feet are)
    let sh = null; this.vrm.scene.traverse((o) => { if (!sh && o.isMesh && (Array.isArray(o.material) ? o.material : [o.material]).some((m) => /Shoes/.test(m.name || ''))) sh = o; });
    if (!sh) return 0; this.vrm.scene.updateMatrixWorld(true); sh.skeleton?.update();
    const fp = this.b.leftFoot.getWorldPosition(new V()), v = new V(), P = sh.geometry.attributes.position; let mn = 9;
    for (let i = 0; i < P.count; i++) { sh.getVertexPosition(i, v); sh.localToWorld(v); if (v.distanceTo(fp) < 0.2) mn = Math.min(mn, v.y); }
    if (mn > 8) return 0; const a = clamp(fp.y - mn + 0.004, 0.03, 0.3), d = a - ANK; ANK = a; this.ankle = ANK; return d;
  }
  groundAt(x, z) { const p = this.board.localToWorld(new V(x, 0, z)); p.y = this.groundFn ? this.groundFn(p.x, p.z) + ANK : this.pos.y - this.air + ANK; return p; }
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
  // soft reach limit: the knee can straighten to ~175° (beautiful stance line) but never pops/locks — the last cm of
  // reach is eased with tanh instead of a hard clamp (the old 4 mm clamp held every stance knee at ~168°)
  let d = A.distanceTo(target); const K0 = a + b - 0.012; if (d > K0) d = K0 + 0.0105 * Math.tanh((d - K0) / 0.0105); d = Math.max(d, 0.05);
  const dir = target.clone().sub(A).normalize();
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const pv = pole.clone().sub(A); const perp = pv.sub(dir.clone().multiplyScalar(pv.dot(dir))).normalize();
  const K = A.clone().addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
  aim(up, lo, K);
  const tgt = A.clone().addScaledVector(dir, d);
  aim(lo, ft, tgt);
}
