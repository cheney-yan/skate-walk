/* refskel.js — the ONE place that reads motion-reference skeletons (refs/moves/<move>/<sample>.skeleton.json,
   contract: refs/moves/CONTRACT.md, schema 1.x) and converts their coordinates.

   COORDINATES
   - File (MediaPipe pose_world_landmarks): metres, origin = hip centre, +x = image right, +y = DOWN,
     +z = away from the camera. That frame is right-handed (right x down = away).
   - Returned here ("ref space", three.js convention): x' = x, y' = -y, z' = -z.
     This is a 180 deg rotation about x, NOT a mirror: handedness is kept, so the subject's left side stays her
     left side. Seen from a three.js camera on +z looking down -z, the figure looks exactly like the mp4
     (image right = +x, up = +y, toward the viewer = +z). The contract text only says "flip y"; flipping y
     alone would mirror the depth axis (left/right swap when seen from behind), so z is flipped too.
   - Joint names/indices = MediaPipe Pose order (meta.joints). "left_*" = the SUBJECT's left
     (on the image right when she faces the camera).
   - ang: degrees as in the file (knee 0 = straight, torso_lean 0 = upright, arm_abd 0 = arm hanging);
     ankle_dy / ankle_dist / wrist_span / hip_h in metres. Game knee convention (interior, 180 = straight)
     = 180 - knee.
   - Depth (z) from MediaPipe is much noisier than x/y: use z-dependent results as trends only.

   API
     const R = await load('refs/moves/pirouette/pro_ARCk35WWnbk_36.skeleton.json');
     R.meta                      header fields (id, move, label, user_score, view, fps, src_time, ...)
     R.frames                    [{t, t_src, ok, p:[33 {x,y,z}] (ref space) | null, ang | null}]
     R.t0, R.t1                  first/last OK frame time (s, clip time: 0 = user segment start, <0 = pad)
     R.dur                       user segment length = src_time[1]-src_time[0]
     R.frameAt(t)                {t, p:[33 {x,y,z}], ang, ground, i0, i1, u} linearly interpolated between the two
                                 nearest OK frames (non-OK frames are skipped); ground = lowest foot point y
     R.angCurve(name)            [{t, v, i}] over OK frames; name = an ang key, or 'knee_max' / 'arm_abd_max' /
                                 'knee_min' (max/min of L and R)
     R.mainPeak(name, o)         main peak of the curve (contract §4.4: segment bounds are approximate, use the main
                                 peak). o = {min:false, lo, hi, win:5}. Median-5 + mean-3 smoothing kills one-frame
                                 detection spikes. Returns {t, v, raw, i, frame, t0, t1, base} (t0/t1 = half-height
                                 width around the peak; v smoothed, raw = file value at that frame)
     R.peaks(name, o)            all local peaks above o.thr separated by o.gap s (step counting)
     R.stance(o)                 which foot is FORWARD, from the skeleton (not view.stance): see below
     JOINTS, BONES               names and bone index pairs for drawing
*/

export const JOINTS = ['nose', 'left_eye_inner', 'left_eye', 'left_eye_outer', 'right_eye_inner', 'right_eye', 'right_eye_outer', 'left_ear', 'right_ear',
  'mouth_left', 'mouth_right', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist', 'left_pinky', 'right_pinky',
  'left_index', 'right_index', 'left_thumb', 'right_thumb', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
  'left_heel', 'right_heel', 'left_foot_index', 'right_foot_index'];
export const J = Object.fromEntries(JOINTS.map((n, i) => [n, i]));
/* bones: [a, b, side] side: -1 = subject left, 1 = subject right, 0 = centre */
export const BONES = [[11, 12, 0], [23, 24, 0], [11, 23, -1], [12, 24, 1],
  [11, 13, -1], [13, 15, -1], [15, 17, -1], [15, 19, -1], [15, 21, -1], [17, 19, -1],
  [12, 14, 1], [14, 16, 1], [16, 18, 1], [16, 20, 1], [16, 22, 1], [18, 20, 1],
  [23, 25, -1], [25, 27, -1], [27, 29, -1], [29, 31, -1], [27, 31, -1],
  [24, 26, 1], [26, 28, 1], [28, 30, 1], [30, 32, 1], [28, 32, 1],
  [0, 2, 0], [0, 5, 0], [2, 7, -1], [5, 8, 1], [9, 10, 0]];
export const SIDE = JOINTS.map((n) => (n.startsWith('left') ? -1 : n.startsWith('right') ? 1 : 0));
const FOOT = [27, 28, 29, 30, 31, 32];

/* the only coordinate conversion: MediaPipe world (x right, y down, z away) -> ref space (x right, y up, z toward viewer) */
export const toRef = (w) => ({ x: w[0], y: -w[1], z: -w[2] });

const median = (a) => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2])) : NaN; };
export function smooth(v, win = 5) {
  const h = Math.floor(win / 2), m = v.map((_, i) => median(v.slice(Math.max(0, i - h), i + h + 1)));
  return m.map((_, i) => { const a = m.slice(Math.max(0, i - 1), i + 2); return a.reduce((s, x) => s + x, 0) / a.length; });
}

export class RefSkel {
  constructor(json, path = '') {
    const { frames, ...meta } = json;
    this.meta = meta; this.path = path;
    this.frames = frames.map((f, i) => ({ i, t: f.t, t_src: f.t_src, ok: !!f.ok, p: f.ok ? f.world.map(toRef) : null, ang: f.ok ? f.ang : null, vis: f.ok ? f.lm.map((l) => l[3]) : null }));
    this.ok = this.frames.filter((f) => f.ok);
    this.t0 = this.ok.length ? this.ok[0].t : 0; this.t1 = this.ok.length ? this.ok[this.ok.length - 1].t : 0;
    this.dur = meta.src_time ? meta.src_time[1] - meta.src_time[0] : this.t1;
    this.fps = meta.fps || 30;
  }
  get id() { return this.meta.id; }
  /* interpolated pose at clip time t (clamped to the OK range) */
  frameAt(t) {
    const O = this.ok; if (!O.length) return null;
    t = Math.min(this.t1, Math.max(this.t0, t));
    let lo = 0, hi = O.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (O[m].t <= t) lo = m; else hi = m; }
    const a = O[lo], b = O[hi], u = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
    const p = a.p.map((q, k) => ({ x: q.x + (b.p[k].x - q.x) * u, y: q.y + (b.p[k].y - q.y) * u, z: q.z + (b.p[k].z - q.z) * u }));
    const ang = {}; for (const k in a.ang) ang[k] = a.ang[k] + (b.ang[k] - a.ang[k]) * u;
    let ground = Infinity; for (const k of FOOT) ground = Math.min(ground, p[k].y);
    return { t, p, ang, ground, i0: a.i, i1: b.i, u };
  }
  angVal(f, name) {
    const a = f.ang;
    if (name === 'knee_max') return Math.max(a.knee_L, a.knee_R);
    if (name === 'knee_min') return Math.min(a.knee_L, a.knee_R);
    if (name === 'arm_abd_max') return Math.max(a.arm_abd_L, a.arm_abd_R);
    if (name === 'elbow_max') return Math.max(a.elbow_L, a.elbow_R);
    return a[name];
  }
  angCurve(name) { return this.ok.map((f) => ({ t: f.t, v: this.angVal(f, name), i: f.i })); }
  mainPeak(name, o = {}) {
    const C = this.angCurve(name); if (!C.length) return null;
    const sg = o.min ? -1 : 1, S = smooth(C.map((c) => c.v * sg), o.win || 5);
    const lo = o.lo ?? -Infinity, hi = o.hi ?? Infinity;
    let k = -1; for (let i = 0; i < C.length; i++) if (C[i].t >= lo && C[i].t <= hi && (k < 0 || S[i] > S[k])) k = i;
    if (k < 0) return null;
    const base = median(S), half = base + 0.5 * (S[k] - base);
    let a = k, b = k; while (a > 0 && S[a - 1] >= half) a--; while (b < C.length - 1 && S[b + 1] >= half) b++;
    return { t: C[k].t, v: S[k] * sg, raw: C[k].v, i: C[k].i, frame: C[k].i, t0: C[a].t, t1: C[b].t, base: base * sg };
  }
  peaks(name, o = {}) {
    const C = this.angCurve(name), S = smooth(C.map((c) => c.v), o.win || 5), thr = o.thr ?? -Infinity, gap = o.gap ?? 0.25, out = [];
    for (let i = 1; i < C.length - 1; i++) if (S[i] >= S[i - 1] && S[i] > S[i + 1] && S[i] >= thr) {
      const last = out[out.length - 1];
      if (last && C[i].t - last.t < gap) { if (S[i] > last.v) out[out.length - 1] = { t: C[i].t, v: S[i], i: C[i].i }; }
      else out.push({ t: C[i].t, v: S[i], i: C[i].i });
    }
    return out;
  }
  /* Which foot is forward, from the skeleton.
     A rider faces her toe edge, so the board axis ~ her hip line, and she looks toward the nose.
     Method 'travel' (preferred, needs the travel direction in the image; view.travel or o.travel = 'left'|'right'):
       the forward foot is the ankle further along the travel direction in image x (world x).
     Method 'head' (fallback when travel is along the camera axis): the nose points toward the nose of the board;
       the forward foot is the one on the side her face is turned to along the hip axis.
     Returns {front:'L'|'R'|null, conf: share of frames agreeing, method, n}. o.lo/o.hi limit the time window
     (default: the first 0.5 s of the user segment). view.stance from the exporter is a guess and is ignored here. */
  stance(o = {}) {
    const lo = o.lo ?? 0, hi = o.hi ?? Math.min(this.t1, 0.5);
    let fr = this.ok.filter((f) => f.t >= lo && f.t <= hi); if (fr.length < 3) fr = this.ok;
    const tr = o.travel || ((this.meta.view?.travel || '').includes('向画面左') ? 'left' : (this.meta.view?.travel || '').includes('向画面右') ? 'right' : null);
    let votes = [], method;
    if (tr) {
      method = 'travel'; const sg = tr === 'left' ? -1 : 1;
      for (const f of fr) { const d = (f.p[27].x - f.p[28].x) * sg; if (Math.abs(d) > 0.04) votes.push(d > 0 ? 'L' : 'R'); }
    }
    if (!votes.length) {
      method = 'head';
      for (const f of fr) {
        const p = f.p, ax = { x: p[24].x - p[23].x, z: p[24].z - p[23].z }, n = Math.hypot(ax.x, ax.z) || 1;
        const em = { x: (p[7].x + p[8].x) / 2, z: (p[7].z + p[8].z) / 2 }, d = ((p[0].x - em.x) * ax.x + (p[0].z - em.z) * ax.z) / n;
        if (Math.abs(d) > 0.01) votes.push(d > 0 ? 'R' : 'L');
      }
    }
    const nL = votes.filter((v) => v === 'L').length, nR = votes.length - nL;
    return { front: votes.length ? (nL >= nR ? 'L' : 'R') : null, conf: votes.length ? Math.max(nL, nR) / votes.length : 0, method, n: votes.length, travel: tr };
  }
}

export async function load(path) {
  const r = await fetch(path); if (!r.ok) throw new Error('refskel: ' + path + ' ' + r.status);
  return new RefSkel(await r.json(), path);
}
/* 'move/sample' or 'move' (= that move's best sample from its summary) -> skeleton path + index entry */
export async function resolve(ref, root = './refs/moves') {
  const [move, sample] = ref.split('/');
  let id = sample;
  if (!id) { const sm = await (await fetch(`${root}/${move}/${move}.summary.json`)).json(); id = sm.best; }
  let entry = null;
  try { const ix = await (await fetch(`${root}/index.json`)).json(); entry = ix.samples.find((s) => s.id === id) || null; } catch (e) { /* index optional */ }
  const skel = entry?.skeleton ? `${root}/${entry.skeleton}` : `${root}/${move}/${id}.skeleton.json`;
  const mp4 = entry?.clip_mp4 ? `${root}/${entry.clip_mp4}` : `${root}/${move}/${id}.mp4`;
  return { move: entry?.move || move, id, skel, mp4, entry };
}
