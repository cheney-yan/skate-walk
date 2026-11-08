/* refview.js — lab.html?ref=<move>/<sample> (or ?ref=<move> = that move's best sample): skeleton replay.

   Left panel (inside the WebGL canvas, so rec.mjs / LAB.shot capture it): the reference stick figure (33 joints,
   bones; subject-LEFT side blue, RIGHT side orange, centre white) looping at the skeleton's own fps, seen from the
   source camera (as in the mp4) unless ?refyaw=<deg> turns it; a label + timeline strip (ok frames, main peaks,
   playhead); the mp4 (when present locally — mp4s are .gitignored) in the bottom-left corner.
   Right: the game as usual (the main camera is shifted with setViewOffset so she stays centred in the free part).
   Coordinates come ONLY from js/refskel.js (ref space: x right, y up, z toward the viewer).

   Clock: lab.js calls REFV.step(dt) from step(), so recordings (LAB.adv, 1/30 s) are deterministic.
   API (window.REFV, also LAB.ref()): {R, ref, t, playing, seek(t), play(on), step(dt), sync() -> Promise (waits for the mp4 frame), yaw(deg), info()}
   URL: ?ref=pirouette  ?ref=push/pro_ARCk35WWnbk_20  &refyaw=90  &refspeed=0.5  &refpanel=0.45 (panel width share)
*/
import { load, resolve, BONES, SIDE } from './refskel.js';

const COL = { '-1': 0x4aa3ff, '1': 0xff8a3c, '0': 0xf2f2f2 };

export async function attach({ renderer, camera, THREE, Q }) {
  const ref = Q.get('ref');
  const info = await resolve(ref);
  const R = await load(info.skel);
  const REC = Q.has('rec');
  const st = { R, ref: info, t: R.t0, playing: true, speed: +(Q.get('refspeed') || 1), yawDeg: +(Q.get('refyaw') || 0), panel: +(Q.get('refpanel') || 0.45) };

  /* ---- stick figure scene */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1f2a33);
  const fig = new THREE.Group(); scene.add(fig);
  const lift = -medianOf(R.ok.map((f) => Math.min(...[27, 28, 29, 30, 31, 32].map((k) => f.p[k].y))));   /* hips height so the median lowest foot sits on y = 0 */
  fig.position.y = lift;
  const jGeo = new THREE.SphereGeometry(0.022, 10, 8), bGeo = new THREE.CylinderGeometry(0.014, 0.014, 1, 8, 1);
  bGeo.translate(0, 0.5, 0);
  const mats = Object.fromEntries(Object.entries(COL).map(([k, c]) => [k, new THREE.MeshBasicMaterial({ color: c })]));
  const joints = SIDE.map((s, i) => { const m = new THREE.Mesh(i === 0 ? new THREE.SphereGeometry(0.05, 14, 10) : jGeo, mats[String(s)]); fig.add(m); return m; });
  const bones = BONES.map(([a, b, s]) => { const m = new THREE.Mesh(bGeo, mats[String(s)]); fig.add(m); return { a, b, m }; });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), new THREE.MeshBasicMaterial({ color: 0x3a4a56 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const grid = new THREE.GridHelper(1.8, 6, 0x5c7080, 0x4a5a66); grid.position.y = 0.002; scene.add(grid);
  const cam = new THREE.PerspectiveCamera(30, 0.6, 0.1, 50);

  /* ---- label + timeline (canvas texture, drawn on a screen-space quad) */
  const lc = document.createElement('canvas'); lc.width = 512; lc.height = 96;
  const lctx = lc.getContext('2d'); const ltex = new THREE.CanvasTexture(lc); ltex.colorSpace = THREE.SRGBColorSpace;
  const hud = new THREE.Scene(), hcam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: ltex, transparent: true, depthTest: false })); hud.add(lab);
  const peaks = { knee: R.mainPeak('knee_max'), arm: R.mainPeak('arm_abd_max'), torso: R.mainPeak('torso_lean') };
  const stance = R.stance();
  const meta = R.meta;

  /* ---- mp4 (optional) */
  let video = null, vtex = null, vq = null, vReady = false, vcan = null, vctx = null, vT = -1;
  try {
    const head = Q.get('refvid') === '0' ? { ok: false } : await fetch(info.mp4, { method: 'HEAD' });
    if (head.ok) {
      video = document.createElement('video'); video.src = info.mp4; video.muted = true; video.playsInline = true; video.loop = true; video.preload = 'auto'; video.crossOrigin = 'anonymous';
      await new Promise((res) => { video.addEventListener('loadeddata', res, { once: true }); video.addEventListener('error', res, { once: true }); setTimeout(res, 8000); video.load(); });
      if (video.readyState >= 2 && video.videoWidth > 0) {
        /* the frame is copied through a 2D canvas (simple + cheap). Headless Chrome with ANGLE/Vulkan loses the WebGL context while any <video> decodes on the GPU:
           tools/rec/rec.mjs passes --disable-accelerated-video-decode; ?refvid=0 skips the mp4 entirely */
        vReady = true; vcan = document.createElement('canvas'); vcan.width = video.videoWidth; vcan.height = video.videoHeight; vctx = vcan.getContext('2d');
        vtex = new THREE.CanvasTexture(vcan); vtex.colorSpace = THREE.SRGBColorSpace;
        vq = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: vtex, depthTest: false })); hud.add(vq);
        if (!REC) video.play().catch(() => {});
      }
    }
  } catch (e) { console.warn('refview mp4', e); }

  /* ---- DOM scrubber (hidden in rec mode by body.rec) */
  if (!REC) {
    const d = document.createElement('div');
    d.id = 'refbar';
    d.style.cssText = 'position:fixed;left:8px;bottom:calc(env(safe-area-inset-bottom) + 8px);z-index:25;display:flex;gap:6px;align-items:center;background:rgba(255,250,240,.88);border-radius:14px;padding:4px 8px;font-size:12px;font-weight:600';
    d.innerHTML = '<button id="refPlay" style="border:0;background:none;font-size:15px">⏸</button><input id="refT" type="range" step="0.001" style="width:min(36vw,220px)"><span id="refTt"></span>';
    document.body.appendChild(d);
    const sl = d.querySelector('#refT'), pb = d.querySelector('#refPlay');
    sl.min = R.t0; sl.max = R.t1; sl.value = st.t;
    sl.oninput = () => { api.seek(+sl.value); api.play(false); };
    pb.onclick = () => api.play(!st.playing);
    st.ui = { sl, pb, tt: d.querySelector('#refTt') };
  }

  function pose(t) {
    const F = R.frameAt(t); if (!F) return null;
    for (let i = 0; i < 33; i++) joints[i].position.set(F.p[i].x, F.p[i].y, F.p[i].z);
    const A = new THREE.Vector3(), B = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const b of bones) {
      A.copy(joints[b.a].position); B.copy(joints[b.b].position); const L = A.distanceTo(B);
      b.m.position.copy(A); b.m.scale.set(1, Math.max(1e-4, L), 1);
      b.m.quaternion.setFromUnitVectors(up, B.sub(A).normalize());
    }
    fig.rotation.y = st.yawDeg * Math.PI / 180;
    return F;
  }
  function drawLabel(F) {
    const c = lctx, W = lc.width, H = lc.height;
    c.clearRect(0, 0, W, H); c.fillStyle = 'rgba(16,22,28,0.82)'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#fff'; c.font = 'bold 22px sans-serif';
    c.fillText(`${meta.move} · ${meta.id} · ${meta.user_score}分`, 10, 26);
    c.font = '17px sans-serif'; c.fillStyle = '#cfd8df';
    const fi = F ? (F.u < 0.5 ? F.i0 : F.i1) : -1;
    c.fillText(`t ${st.t.toFixed(2)} s  f${fi}  ${R.frames[fi]?.ok ? 'ok' : 'interp'}  front:${stance.front || '?'}(${stance.method},${Math.round(stance.conf * 100)}%)  knee ${F ? F.ang.knee_L.toFixed(0) + '/' + F.ang.knee_R.toFixed(0) : ''}`, 10, 50);
    /* timeline: grey = ok frames, red = missing, ticks = main peaks, white = playhead, green band = user segment [0,dur] */
    const x0 = 10, x1 = W - 10, y = 66, h = 18, X = (t) => x0 + (x1 - x0) * (t - R.frames[0].t) / Math.max(1e-6, R.frames[R.frames.length - 1].t - R.frames[0].t);
    c.fillStyle = '#2f6b45'; c.fillRect(X(0), y - 3, X(Math.min(R.dur, R.t1)) - X(0), h + 6);
    for (const f of R.frames) { c.fillStyle = f.ok ? '#8a99a5' : '#e0504a'; c.fillRect(X(f.t) - 1.5, y, 3, h); }
    const tick = (p, col) => { if (!p) return; c.fillStyle = col; c.fillRect(X(p.t) - 2, y - 6, 4, h + 12); };
    tick(peaks.knee, '#ffcf4a'); tick(peaks.arm, '#4aa3ff'); tick(peaks.torso, '#c77dff');
    c.fillStyle = '#fff'; c.fillRect(X(st.t) - 2, y - 8, 4, h + 16);
    ltex.needsUpdate = true;
  }

  /* ---- render: main view shifted right, then the panel + HUD on the left */
  const orig = renderer.render.bind(renderer);
  const size = new THREE.Vector2();
  let inPanel = false;
  renderer.render = (sc, ca) => {
    if (inPanel || ca !== camera) return orig(sc, ca);
    renderer.getSize(size); const W = size.x, H = size.y, pw = Math.round(W * st.panel);
    camera.setViewOffset(W, H, -pw / 2, 0, W, H);
    orig(sc, ca);
    camera.clearViewOffset();
    inPanel = true;
    const F = pose(st.t);
    const ac = renderer.autoClear; renderer.autoClear = false;
    renderer.setScissorTest(true);
    /* figure: fit ~2.1 m height in the panel */
    renderer.setViewport(0, 0, pw, H); renderer.setScissor(0, 0, pw, H);
    cam.aspect = pw / H; const fitH = 2.2, fitW = 1.6, dist = Math.max(fitH / 2 / Math.tan(cam.fov * Math.PI / 360), fitW / 2 / Math.tan(cam.fov * Math.PI / 360) / cam.aspect) + 0.6;
    cam.position.set(0, 0.95, dist); cam.lookAt(0, 0.85, 0); cam.updateProjectionMatrix();
    renderer.clear(true, true, true); orig(scene, cam);
    /* HUD (ortho 0..1 in panel pixels) */
    hcam.left = 0; hcam.right = pw; hcam.top = H; hcam.bottom = 0; hcam.updateProjectionMatrix();
    const lh = pw * lc.height / lc.width; lab.scale.set(pw, lh, 1); lab.position.set(pw / 2, H - lh / 2, 0);
    drawLabel(F);
    if (vq && video.readyState >= 2 && (video.currentTime !== vT || !REC)) { vctx.drawImage(video, 0, 0, vcan.width, vcan.height); vtex.needsUpdate = true; vT = video.currentTime; }
    if (vq) { const vw = pw * 0.5, vh = vw * (video.videoHeight || 360) / (video.videoWidth || 202); vq.scale.set(vw, vh, 1); vq.position.set(vw / 2 + 4, vh / 2 + 4, 0); }
    renderer.clearDepth(); orig(hud, hcam);
    renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); renderer.autoClear = ac;
    inPanel = false;
  };

  function vidTime() { return Math.min(Math.max(0, st.t), Math.max(0, (video?.duration || R.dur) - 0.02)); }
  const api = {
    R, ref: info, get t() { return st.t; }, get playing() { return st.playing; }, hasVideo: vReady, stance, peaks,
    seek(t) { st.t = Math.min(R.t1, Math.max(R.t0, t)); if (video && vReady && (!st.playing || REC)) video.currentTime = vidTime(); },
    play(on) { st.playing = on; if (st.ui) st.ui.pb.textContent = on ? '⏸' : '▶'; if (video && vReady && !REC) { if (on) { video.currentTime = vidTime(); video.play().catch(() => {}); } else video.pause(); } },
    yaw(d) { st.yawDeg = d; },
    step(dt) {
      if (!st.playing) return;
      st.t += dt * st.speed; if (st.t > R.t1) st.t = R.t0 + (st.t - R.t1);
      if (video && vReady) {
        if (REC) { if (!video.paused) video.pause(); video.currentTime = vidTime(); }
        else if (Math.abs(video.currentTime - vidTime()) > 0.15) video.currentTime = vidTime();
      }
      if (st.ui) { st.ui.sl.value = st.t; st.ui.tt.textContent = st.t.toFixed(2) + ' s'; }
    },
    /* resolves when the mp4 shows the frame for the current t (rec mode: call before LAB.shot) */
    sync() {
      if (!video || !vReady) return Promise.resolve(false);
      const want = vidTime(); if (Math.abs(video.currentTime - want) > 1e-3) video.currentTime = want;
      if (!video.seeking) return new Promise((r) => requestAnimationFrame(() => r(true)));
      return new Promise((r) => { video.addEventListener('seeked', () => requestAnimationFrame(() => r(true)), { once: true }); setTimeout(() => r(false), 3000); });
    },
    info() { return { id: meta.id, move: meta.move, t: st.t, t0: R.t0, t1: R.t1, dur: R.dur, fps: R.fps, frames: R.frames.length, ok: R.ok.length, hasVideo: vReady, stance, peaks, lift }; },
    /* projected screen positions (canvas px, y down) of joints, for probes */
    screen(idx = [0, 11, 12, 15, 16, 23, 24, 27, 28]) {
      renderer.getSize(size); const pw = Math.round(size.x * st.panel), H = size.y; pose(st.t); fig.updateMatrixWorld(true);
      return idx.map((i) => { const v = joints[i].getWorldPosition(new THREE.Vector3()).project(cam); return { i, x: (v.x + 1) / 2 * pw, y: (1 - v.y) / 2 * H }; });
    },
  };
  st.ui && (st.ui.sl.value = st.t);
  return api;
}

function medianOf(a) { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; }
