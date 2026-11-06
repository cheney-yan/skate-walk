import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const R = await (await fetch('./data/route.json')).json();
const P = R.pts, L = R.length;

// ---------- route helpers (x east, y north metres → three: X=x, Z=-y) ----------
function at(s) {
  s = Math.max(0, Math.min(L, s));
  let lo = 0, hi = P.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; (P[m].s <= s ? lo = m : hi = m); }
  const a = P[lo], b = P[hi], t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, e: a.e + (b.e - a.e) * t, i: lo, a, b };
}
function slopeAt(s) { const d = 12; return (at(s + d).e - at(s - d).e) / (2 * d); }
function headingAt(s, d = 4) { const a = at(s - d), b = at(s + d); return Math.atan2(b.x - a.x, b.y - a.y); }
let snapCam = true;
function hwAt(s) { return at(s).b.hw; }
function nameAt(s) { for (let k = at(s).i; k >= 0; k--) if (P[k].name) return P[k].name; return 'Bondi'; }

// terrain
const T = R.terrain;
function terrainH(x, y) {
  const fi = (x - T.x0) / T.step, fj = (y - T.y0) / T.step;
  const i = Math.max(0, Math.min(T.nx - 2, Math.floor(fi))), j = Math.max(0, Math.min(T.ny - 2, Math.floor(fj)));
  const u = Math.min(1, Math.max(0, fi - i)), v = Math.min(1, Math.max(0, fj - j));
  const g = (ii, jj) => Math.max(-4, T.h[jj * T.nx + ii] / 10);
  return g(i, j) * (1 - u) * (1 - v) + g(i + 1, j) * u * (1 - v) + g(i, j + 1) * (1 - u) * v + g(i + 1, j + 1) * u * v;
}

// ---------- three setup ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const SKY = new THREE.Color('#a9d6f0');
scene.background = SKY;
scene.fog = new THREE.Fog('#cfe6f2', 120, 900);
const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 3000);

scene.add(new THREE.HemisphereLight('#dff1ff', '#d9c7a0', 1.5));
const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
sun.position.set(-200, 300, 150); scene.add(sun);

// sky dome gradient + clouds
{
  const g = new THREE.SphereGeometry(2400, 32, 16);
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {}, vertexShader: `varying vec3 p; void main(){p=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 p; float h(vec2 q){return fract(sin(dot(q,vec2(127.1,311.7)))*43758.5);} 
      float n(vec2 q){vec2 i=floor(q),f=fract(q);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
      float fbm(vec2 q){float s=0.,a=.5;for(int k=0;k<5;k++){s+=a*n(q);q*=2.03;a*=.5;}return s;}
      void main(){float y=max(p.y,0.);vec3 top=vec3(.36,.62,.88),hor=vec3(.86,.93,.97);vec3 c=mix(hor,top,pow(y,.55));
        vec2 q=p.xz/(p.y+.12)*1.4; float cl=smoothstep(.52,.78,fbm(q*1.2+3.));
        c=mix(c,vec3(1.),cl*smoothstep(.02,.18,p.y)*.92); gl_FragColor=vec4(c,1.);}` });
  scene.add(new THREE.Mesh(g, m));
}

// ground mesh from real elevation
{
  const geo = new THREE.PlaneGeometry((T.nx - 1) * T.step, (T.ny - 1) * T.step, T.nx - 1, T.ny - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const cx = T.x0 + (T.nx - 1) * T.step / 2, cy = T.y0 + (T.ny - 1) * T.step / 2;
  const sand = new THREE.Color('#ecd9a8'), grass = new THREE.Color('#8fbf6a'), dark = new THREE.Color('#6e9e58'), rock = new THREE.Color('#b8a58a'), wet = new THREE.Color('#c9b78c');
  const c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k) + cx, y = -pos.getZ(k) + cy;
    let h = terrainH(x, y); if (h < 1.3) h = -2.5 + h;
    pos.setXYZ(k, x, h, -y);
    const sl = Math.hypot(terrainH(x + 4, y) - terrainH(x - 4, y), terrainH(x, y + 4) - terrainH(x, y - 4)) / 8;
    if (h < 0.4) c.copy(wet); else if (h < 3.5) c.copy(sand).lerp(grass, Math.max(0, (h - 2) / 1.5));
    else c.copy(grass).lerp(dark, Math.min(1, (h - 8) / 50));
    if (sl > 0.55 && h > 0.5) c.lerp(rock, Math.min(1, (sl - 0.55) * 2));
    col.set([c.r, c.g, c.b], k * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));
}

// sea
const seaMat = new THREE.ShaderMaterial({ transparent: true, fog: true,
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { t: { value: 0 } }]),
  vertexShader: `uniform float t; varying vec2 w; varying float f; #include <fog_pars_vertex>
    void main(){ vec3 p=position; w=p.xz; p.y+=sin(p.x*.05+t*.8)*.15+sin(p.z*.07+t*1.1)*.12;
      vec4 mvPosition=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mvPosition; #include <fog_vertex> }`.replace(/#include <(\w+)>/g, '\n#include <$1>\n'),
  fragmentShader: `uniform float t; varying vec2 w; #include <fog_pars_fragment>
    void main(){ float r=sin(w.x*.31+t*1.3)*sin(w.y*.27-t*.9); vec3 deep=vec3(.08,.42,.62), sh=vec3(.32,.74,.78);
      vec3 c=mix(deep,sh,.35+.15*r); c+=vec3(.9)*smoothstep(.93,1.,r)*.35; gl_FragColor=vec4(c,.93); #include <fog_fragment> }`.replace(/#include <(\w+)>/g, '\n#include <$1>\n') });
{
  const g = new THREE.PlaneGeometry(6000, 6000, 160, 160); g.rotateX(-Math.PI / 2);
  const sea = new THREE.Mesh(g, seaMat); sea.position.y = 0.9; scene.add(sea);
}

// buildings (real OSM footprints + heights)
{
  const mats = ['#f3ede2', '#efe3cf', '#e8d7c3', '#f6f1e8', '#dfe6e8'].map(c => new THREE.MeshLambertMaterial({ color: c }));
  const roof = new THREE.MeshLambertMaterial({ color: '#c97b5a' });
  for (const b of R.buildings) {
    if (b.poly.length < 4) continue;
    const sh = new THREE.Shape(b.poly.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: b.h, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, [b.h < 9 && Math.random() < .5 ? roof : mats[(b.poly.length * 7) % mats.length], mats[(b.poly.length * 3) % mats.length]]);
    m.position.y = b.base - 0.5; scene.add(m);
  }
}

// the path ribbon
{
  const v = [], idx = [], W = 1.6;
  for (let s = 0, k = 0; s <= L; s += 2, k++) {
    const p = at(s), h = headingAt(s), nx = Math.cos(h), ny = -Math.sin(h);
    const y1 = Math.max(p.e, terrainH(p.x + nx * W, p.y + ny * W)) + .08, y2 = Math.max(p.e, terrainH(p.x - nx * W, p.y - ny * W)) + .08;
    v.push(p.x + nx * W, y1, -(p.y + ny * W), p.x - nx * W, y2, -(p.y - ny * W));
    if (k) idx.push(2 * k - 2, 2 * k - 1, 2 * k, 2 * k - 1, 2 * k + 1, 2 * k);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(idx); g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#e7e1d6', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })));
}

// card markers (floating postcards along the path)
const markers = [];
{
  const tex = new THREE.TextureLoader();
  for (const c of R.cards) {
    const p = at(c.s), h = headingAt(c.s);
    const side = (markers.length % 2 ? 1 : -1) * 2.6;
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(1.25, .95), new THREE.MeshBasicMaterial({ color: c.rare ? '#ffd27a' : '#fffaf0', side: THREE.DoubleSide }));
    const t = tex.load(c.local); t.colorSpace = THREE.SRGBColorSpace;
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(1.1, .8), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
    pic.position.z = .01; g.add(frame, pic);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 1.3, 6), new THREE.MeshLambertMaterial({ color: '#8a6a4a' })); pole.position.y = -1.1; g.add(pole);
    g.position.set(p.x + Math.cos(h) * side, p.e + 1.7, -(p.y - Math.sin(h) * side));
    g.userData = { c, base: g.position.y, got: false };
    scene.add(g); markers.push(g);
  }
}

// ---------- the girl ----------
const girl = new THREE.Group(); scene.add(girl);
const rig = {};
{
  const skin = new THREE.MeshLambertMaterial({ color: '#ffd9c2' });
  const dress = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  const hairM = new THREE.MeshLambertMaterial({ color: '#3b2a22' });
  const hatM = new THREE.MeshLambertMaterial({ color: '#f4d58d' });
  const deck = new THREE.MeshLambertMaterial({ color: '#7fc4c9' });
  const wheel = new THREE.MeshLambertMaterial({ color: '#ffe6a8' });
  const board = new THREE.Group();
  const d = new THREE.Mesh(new THREE.BoxGeometry(.22, .03, .8), deck); d.position.y = .09; board.add(d);
  for (const z of [-.28, .28]) for (const x of [-.08, .08]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .03, 12), wheel); w.rotation.z = Math.PI / 2; w.position.set(x, .04, z); board.add(w); }
  rig.board = board; girl.add(board);
  const body = new THREE.Group(); body.position.y = .12; girl.add(body); rig.body = body;
  const legs = []; for (const x of [-.06, .06]) { const l = new THREE.Mesh(new THREE.CapsuleGeometry(.035, .42, 4, 8), skin); l.position.set(x, .27, x > 0 ? .1 : -.1); body.add(l); legs.push(l); }
  rig.legs = legs;
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(.24, .42, 20, 1, true), dress); skirt.position.y = .66; body.add(skirt); rig.skirt = skirt;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.1, .2, 4, 10), dress); torso.position.y = .9; body.add(torso);
  const arms = []; for (const x of [-.15, .15]) { const a = new THREE.Group(); a.position.set(x, 1.0, 0); const m = new THREE.Mesh(new THREE.CapsuleGeometry(.03, .34, 4, 8), skin); m.position.y = -.19; a.add(m); body.add(a); arms.push(a); }
  rig.arms = arms;
  const head = new THREE.Group(); head.position.y = 1.2; body.add(head); rig.head = head;
  head.add(new THREE.Mesh(new THREE.SphereGeometry(.13, 20, 16), skin));
  const hair = new THREE.Mesh(new THREE.SphereGeometry(.142, 20, 16, 0, Math.PI * 2, 0, Math.PI * .62), hairM); hair.rotation.x = -.25; head.add(hair);
  const tail = new THREE.Group(); tail.position.set(0, .02, .12); head.add(tail); rig.tail = tail;
  const tm = new THREE.Mesh(new THREE.CapsuleGeometry(.05, .22, 4, 8), hairM); tm.position.y = -.12; tail.add(tm);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(.26, .27, .02, 28), hatM); hat.position.y = .09; head.add(hat);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(.12, .14, .1, 20), hatM); crown.position.y = .14; head.add(crown);
  const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(.141, .141, .03, 20), new THREE.MeshLambertMaterial({ color: '#ff8a5c' })); ribbon.position.y = .11; head.add(ribbon);
  girl.scale.setScalar(1.15);
}

// ---------- state ----------
const save = JSON.parse(localStorage.getItem('skate-walk') || '{}');
const got = new Set(save.got || []);
const S = { s: 0, v: 0, push: 0, mode: 'ride', modeT: 0, energy: save.energy || 0, wait: 0, stopFor: null, passed: new Set(), resting: false, trickT: 0, fallT: 0, msg: '' };
const CROWD = [[0, 520], [2420, 2600]]; // beach promenades: people around
const isCrowd = (s) => CROWD.some(([a, b]) => s > a && s < b);
// "rules" along the real route: OSM crossings + living street (Notts Ave shares with cars) + steps
const rules = [];
for (const st of R.stops) rules.push({ s: st.s, kind: 'cross' });
let inLiving = false;
for (const p of P) { if (p.hw === 'living_street' && !inLiving) { rules.push({ s: p.s - 3, kind: 'cross', txt: '要过 Notts Avenue，先停一下看看车' }); inLiving = true; } if (p.hw !== 'living_street') inLiving = false; }
rules.sort((a, b) => a.s - b.s);
function persist() { localStorage.setItem('skate-walk', JSON.stringify({ got: [...got], energy: S.energy })); }

// ---------- UI ----------
let hintT = 0;
function hint(t, sec = 3.5) { $('hint').textContent = t; $('hint').classList.add('on'); hintT = sec; }
function updCount() { $('cnt').textContent = `${got.size}/${R.cards.length}`; }
updCount();

let toastT = 0;
function collect(c) {
  const fresh = !got.has(c.id); got.add(c.id); persist(); updCount();
  $('tImg').src = c.local; $('tTitle').textContent = (c.rare ? '★ ' : '') + c.title;
  $('tText').textContent = c.type === 'wiki' ? '维基百科 · 这里的故事' : `${c.year || ''} · ${c.author ? c.author.slice(0, 40) : ''}`;
  $('toast').classList.add('on'); toastT = 4.5; $('toast').onclick = () => openCard(c);
  if (fresh) { S.energy = Math.min(1, S.energy + 0.04); chime(c.rare); }
}

function openCard(c) {
  const lic = c.type === 'wiki' ? '文字与图片来自 Wikipedia（CC BY-SA）' : `摄影：${c.author || '未知'} · ${c.license || ''}${c.date ? ' · ' + c.date : ''}`;
  $('cardBody').innerHTML = `<img src="${c.local}" alt=""><h2>${c.rare ? '★ ' : ''}${esc(c.title)}</h2>
    <p>${esc(c.text || (c.type === 'photo' ? '有人在这里按下了快门。' : ''))}</p>
    <div class="meta">${esc(lic)}<br>📍 ${esc(nameAt(c.s))} · 路线第 ${Math.round(c.s)} 米 · <a href="${c.url}" target="_blank">来源</a></div>
    <canvas id="pc" width="1080" height="1350" style="display:none"></canvas>
    <div class="row"><button id="cBack">收好</button><button class="primary" id="cSend">寄给朋友 ✉️</button></div>`;
  $('cardSheet').classList.add('on');
  $('cBack').onclick = () => $('cardSheet').classList.remove('on');
  $('cSend').onclick = () => sendPostcard(c);
}
const esc = (s) => String(s || '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

async function sendPostcard(c) {
  const cv = $('pc'), g = cv.getContext('2d');
  g.fillStyle = '#fffaf0'; g.fillRect(0, 0, 1080, 1350);
  const img = new Image(); img.src = c.local; await img.decode();
  const W = 960, H = 760, r = Math.max(W / img.width, H / img.height);
  g.save(); g.beginPath(); g.roundRect(60, 60, W, H, 26); g.clip();
  g.drawImage(img, 60 + (W - img.width * r) / 2, 60 + (H - img.height * r) / 2, img.width * r, img.height * r); g.restore();
  // stamp
  g.save(); g.translate(880, 900); g.rotate(-.12); g.strokeStyle = '#ff8a5c'; g.lineWidth = 6; g.setLineDash([10, 8]);
  g.beginPath(); g.arc(0, 0, 110, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#ff8a5c'; g.font = 'bold 34px -apple-system,sans-serif'; g.textAlign = 'center';
  g.fillText('BONDI', 0, -22); g.font = '26px -apple-system,sans-serif'; g.fillText(new Date().toLocaleDateString('zh-CN'), 0, 18); g.fillText('滑板散步 🛹', 0, 54); g.restore();
  g.fillStyle = '#1d2a33'; g.textAlign = 'left'; g.font = 'bold 50px -apple-system,"PingFang SC",sans-serif';
  g.fillText(`我今天滑到 ${nameAt(c.s).replace('Eastern Beaches ', '')} 了`, 60, 920);
  g.font = '38px -apple-system,"PingFang SC",sans-serif'; g.fillStyle = '#4a5964';
  wrap(g, c.rare && c.year ? `这是 ${c.year} 年的这里。` : `路过「${c.title.slice(0, 30)}」`, 60, 990, 700, 50);
  g.font = '24px -apple-system,sans-serif'; g.fillStyle = '#8a8f93';
  wrap(g, c.type === 'wiki' ? 'Wikipedia · CC BY-SA' : `📷 ${c.author || ''} · ${c.license || ''} · Wikimedia Commons`, 60, 1250, 960, 32);
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .9));
  const link = `${location.origin}${location.pathname}?card=${encodeURIComponent(c.id)}&from=${encodeURIComponent(localStorage.getItem('skate-name') || '朋友')}`;
  const file = new File([blob], `postcard-${c.id}.jpg`, { type: 'image/jpeg' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: `我今天滑到 ${nameAt(c.s)} 了 ${link}` }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  try { await navigator.clipboard.writeText(link); hint('明信片已保存，链接已复制'); } catch { hint('明信片已保存'); }
}
function wrap(g, t, x, y, w, lh) { let line = ''; for (const ch of t) { if (g.measureText(line + ch).width > w) { g.fillText(line, x, y); y += lh; line = ch; } else line += ch; } g.fillText(line, x, y); }

function openAlbum() {
  $('grid').innerHTML = R.cards.map(c => got.has(c.id)
    ? `<div class="cell" data-id="${c.id}"><img src="${c.local}" loading="lazy">${c.rare ? '<span class="star">★</span>' : ''}<div class="cap">${esc(c.title.slice(0, 34))}</div></div>`
    : `<div class="cell locked">${c.rare ? '★' : '?'}</div>`).join('');
  $('albumSub').textContent = `收集了 ${got.size} / ${R.cards.length} 张 · 其中 ★ 老照片 ${R.cards.filter(c => c.rare && got.has(c.id)).length} / ${R.cards.filter(c => c.rare).length}`;
  $('album').classList.add('on');
  $('grid').querySelectorAll('.cell[data-id]').forEach(el => el.onclick = () => openCard(R.cards.find(c => c.id === el.dataset.id)));
}
$('albumBtn').onclick = openAlbum;
$('albumClose').onclick = () => $('album').classList.remove('on');
$('restBtn').onclick = () => { S.resting = !S.resting; $('restBtn').textContent = S.resting ? '🛹' : '☕'; hint(S.resting ? '坐下来看会儿海' : '继续出发'); };

// received postcard via link
{
  const q = new URLSearchParams(location.search), cid = q.get('card');
  const c = cid && R.cards.find(c => c.id === cid);
  if (c) {
    $('from').innerHTML = `✉️ <b>${esc(q.get('from') || '朋友')}</b> 从 ${esc(nameAt(c.s))} 给你寄了一张明信片<br><img src="${c.local}" style="width:100%;border-radius:10px;margin-top:10px"><div style="font-size:13px;opacity:.6;margin-top:6px">滑到第 ${Math.round(c.s)} 米就能收到同一张</div>`;
    $('from').style.display = 'block'; $('from').onclick = () => $('from').style.display = 'none';
  }
}

// ---------- input: swipe up = push, swipe down = brake / stop ----------
let touchY = null, touchT = 0;
addEventListener('pointerdown', e => { if (e.target.closest('button,.sheet,.toast,.from')) return; touchY = e.clientY; touchT = performance.now(); });
addEventListener('pointerup', e => {
  if (touchY == null) return; const dy = touchY - e.clientY, dt = performance.now() - touchT; touchY = null;
  if (S.resting) { S.resting = false; $('restBtn').textContent = '☕'; }
  if (dy > 30) { S.push = Math.min(3, S.push + 1.2 + Math.min(1, dy / 300)); kick(); }
  else if (dy < -30) { S.push = 0; S.v *= .4; hint('慢下来～'); }
  else if (dt < 250) { S.push = Math.min(3, S.push + .8); kick(); }
});
$('trick').onclick = () => { if (S.energy >= 1 && S.mode === 'ride') { S.mode = 'trick'; S.modeT = 0; S.energy = 0; persist(); $('trick').classList.remove('on'); whoosh(); } };

// ---------- audio (procedural: waves + soft plucks) ----------
let AC = null, master;
$('sndBtn').onclick = () => {
  if (!AC) {
    AC = new AudioContext(); master = AC.createGain(); master.gain.value = .6; master.connect(AC.destination);
    const len = AC.sampleRate * 4, buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0); let b = 0;
    for (let i = 0; i < len; i++) { b = (b + .02 * (Math.random() * 2 - 1)) / 1.02; d[i] = b * 3.5; }
    const src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const gw = AC.createGain(); gw.gain.value = .25; const lfo = AC.createOscillator(); lfo.frequency.value = .11; const lg = AC.createGain(); lg.gain.value = .18;
    lfo.connect(lg); lg.connect(gw.gain); src.connect(f); f.connect(gw); gw.connect(master); src.start(); lfo.start();
    music();
    $('sndBtn').textContent = '🔊';
  } else if (AC.state === 'running') { AC.suspend(); $('sndBtn').textContent = '🔇'; } else { AC.resume(); $('sndBtn').textContent = '🔊'; }
};
function pluck(freq, t, vol = .12, dur = 2.2) {
  const o = AC.createOscillator(), o2 = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter();
  o.type = 'triangle'; o.frequency.value = freq; o2.type = 'sine'; o2.frequency.value = freq * 2.001;
  f.type = 'lowpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(500, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .006); g.gain.exponentialRampToValueAtTime(.0005, t + dur);
  o.connect(f); o2.connect(f); f.connect(g); g.connect(master); o.start(t); o2.start(t); o.stop(t + dur); o2.stop(t + dur);
}
function music() {
  // Cmaj7 – Am7 – Fmaj7 – G6, gentle fingerpicking, ~66 bpm
  const N = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const prog = [[48, 55, 64, 71, 67], [45, 52, 60, 67, 64], [41, 48, 57, 64, 60], [43, 50, 59, 64, 62]];
  const beat = 60 / 66 / 2; let bar = 0;
  const loop = () => {
    if (!AC) return; const t0 = AC.currentTime + .1, ch = prog[bar % 4];
    const pat = [0, 2, 3, 4, 1, 3, 2, 4];
    pat.forEach((k, i) => { if (Math.random() < .9) pluck(N(ch[k]), t0 + i * beat + Math.random() * .02, k ? .06 : .1, 2.6); });
    bar++; setTimeout(loop, beat * 8 * 1000);
  };
  loop();
}
function chime(rare) { if (!AC || AC.state !== 'running') return; const t = AC.currentTime; [76, 83, rare ? 88 : 79].forEach((m, i) => pluck(440 * Math.pow(2, (m - 69) / 12), t + i * .09, .08, 1.4)); }
function kick() { if (!AC || AC.state !== 'running') return; const t = AC.currentTime, len = .18, b = AC.createBuffer(1, AC.sampleRate * len, AC.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) * .3; const s = AC.createBufferSource(); s.buffer = b; const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; s.connect(f); f.connect(master); s.start(t); }
function whoosh() { if (!AC || AC.state !== 'running') return; const t = AC.currentTime; [72, 76, 79, 84].forEach((m, i) => pluck(440 * Math.pow(2, (m - 69) / 12), t + i * .07, .07, 1.2)); }

// ---------- simulation ----------
const CRUISE = 2.0;     // m/s, a lazy roll (≈7 km/h)
let last = performance.now(), clock = 0;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let started = false;

function step(dt) {
  clock += dt; S.modeT += dt;
  const sl = slopeAt(S.s), hw = hwAt(S.s + 1);
  // upcoming rule?
  const nextRule = rules.find(r => r.s > S.s - .5 && r.s < S.s + 6 && !S.passed.has(r.s));
  if (S.mode === 'ride' && nextRule && S.v < 3.5) { S.mode = 'stop'; S.modeT = 0; S.stopFor = nextRule; hint(nextRule.txt || '路口，停一下看看左右 👀', 4); }
  if (S.mode === 'ride' && hw === 'steps') { S.mode = 'walk'; S.modeT = 0; hint('台阶，抱起滑板走两步'); }
  if (S.mode === 'walk' && hw !== 'steps' && S.modeT > 1) { S.mode = 'ride'; S.modeT = 0; }

  let target;
  if (S.resting || S.mode === 'sit') target = 0;
  else if (S.mode === 'stop') {
    target = 0;
    if (S.modeT > 3.2) { S.passed.add(S.stopFor.s); S.mode = 'ride'; S.modeT = 0; S.energy = Math.min(1, S.energy + .12); hint('好乖 🪶 +1'); }
  } else if (S.mode === 'walk') target = 1.0;
  else if (S.mode === 'fall') { target = 0; if (S.modeT > 4.5) { S.mode = 'ride'; S.modeT = 0; hint('拍拍裙子，继续～'); } }
  else {
    target = CRUISE - sl * 14 + S.push * 1.1;           // uphill slows, downhill rolls
    if (isCrowd(S.s)) target = Math.min(target, 2.4);   // people around: keep it gentle
    target = Math.max(.6, target);
  }
  S.push = Math.max(0, S.push - dt * .35);
  S.v += (target - S.v) * Math.min(1, dt * (target < S.v ? 1.6 : .7));
  // too fast downhill → a soft tumble (no penalty)
  if (S.mode === 'ride' && S.v > 5.6 && sl < -.04) { S.mode = 'fall'; S.modeT = 0; S.v *= .3; S.push = 0; hint('哎呀～坐下看会儿风景'); }
  if (S.mode === 'trick' && S.modeT > 1.4) { S.mode = 'ride'; S.modeT = 0; hint('✨ 好看！'); }
  S.s += S.v * dt;
  if (S.s >= L) { S.s = 0; S.passed.clear(); hint('到 Bronte 啦！再滑一遍？', 5); }
  // calm riding fills energy slowly; not in crowds
  if (S.mode === 'ride' && S.v < 3.2) S.energy = Math.min(1, S.energy + dt * .004);
  const open = !isCrowd(S.s) && hw !== 'steps' && Math.abs(sl) < .05 && !rules.some(r => Math.abs(r.s - S.s) < 25);
  $('trick').classList.toggle('on', S.energy >= 1 && open && S.mode === 'ride');
  if (S.energy >= 1 && !open && S.mode === 'ride' && Math.random() < dt * .02) hint(isCrowd(S.s) ? '人多，先不玩花样' : '🪶 满了，找个空旷的地方');
  $('arc').style.strokeDashoffset = 169.6 * (1 - S.energy);
  // cards
  for (const m of markers) {
    m.position.y = m.userData.base + Math.sin(clock * 1.5 + m.userData.c.s) * .08;
    m.lookAt(camera.position.x, m.position.y, camera.position.z);
    if (!m.userData.got && S.s >= m.userData.c.s - 2) { m.userData.got = true; collect(m.userData.c); m.visible = got.has(m.userData.c.id) && false; }
  }
  if (toastT > 0 && (toastT -= dt) <= 0) $('toast').classList.remove('on');
  if (hintT > 0 && (hintT -= dt) <= 0) $('hint').classList.remove('on');
}

function pose(dt) {
  const p = at(S.s), h = headingAt(S.s), sl = slopeAt(S.s);
  const y = Math.max(p.e, terrainH(p.x, p.y)) + .08;
  girl.position.set(p.x, y, -p.y);
  girl.rotation.set(0, h + Math.PI, 0);
  const B = rig.body, sp = S.v, t = clock;
  const pushing = S.mode === 'ride' && S.push > .3;
  // reset
  B.rotation.set(0, 0, 0); B.position.set(0, .12, 0); rig.board.visible = true; rig.board.position.set(0, 0, 0); rig.board.rotation.set(0, 0, 0);
  rig.legs[0].position.set(-.06, .27, -.1); rig.legs[1].position.set(.06, .27, .1); rig.legs[0].rotation.set(0, 0, 0); rig.legs[1].rotation.set(0, 0, 0);
  rig.head.rotation.set(0, 0, 0);
  // stance: sideways-ish, light, arms floating
  B.rotation.y = .5; rig.head.rotation.y = -.45;
  B.rotation.x = -sl * 2 + (pushing ? .12 : 0);
  B.position.y = .12 + Math.sin(t * 2) * .01;
  rig.arms[0].rotation.set(0, 0, -.35 - Math.sin(t * 1.3) * .08); rig.arms[1].rotation.set(0, 0, .35 + Math.sin(t * 1.1) * .08);
  if (pushing) { const k = Math.sin(t * 5); rig.legs[1].rotation.x = k * .6; rig.legs[1].position.y = .2 + Math.max(0, k) * .05; }
  if (S.mode === 'stop') { rig.head.rotation.y = -.45 + Math.sin(S.modeT * 2.2) * .9; B.rotation.y = .3; }
  if (S.mode === 'walk' || S.mode === 'stop' && false) {}
  if (S.mode === 'walk') {
    B.rotation.y = 0; rig.head.rotation.y = 0; const k = Math.sin(t * 6);
    rig.legs[0].position.z = 0; rig.legs[1].position.z = 0; rig.legs[0].rotation.x = k * .5; rig.legs[1].rotation.x = -k * .5;
    B.position.y = .02 + Math.abs(k) * .03;
    rig.board.position.set(.22, .75, 0); rig.board.rotation.set(Math.PI / 2, 0, 0); rig.arms[1].rotation.z = .1;
  }
  if (S.mode === 'trick') { const k = Math.min(1, S.modeT / 1.2), jump = Math.sin(k * Math.PI);
    girl.position.y += jump * .7; rig.board.rotation.z = k * Math.PI * 2; B.rotation.y = .5 + k * Math.PI * 2;
    rig.arms[0].rotation.z = -1.2 * jump - .35; rig.arms[1].rotation.z = 1.2 * jump + .35; }
  if (S.mode === 'fall' || S.resting) {
    const k = S.mode === 'fall' ? Math.min(1, S.modeT / .8) : 1;
    B.position.y = .12 - .55 * k; B.rotation.x = 0; B.rotation.y = Math.PI / 2 * k; rig.head.rotation.y = -Math.PI / 2 * .7 * k;
    rig.legs[0].rotation.x = -1.4 * k; rig.legs[1].rotation.x = -1.3 * k; rig.legs[0].position.y = rig.legs[1].position.y = .27 + .1 * k;
    rig.board.position.set(.5 * k, 0, .3 * k); rig.board.rotation.y = .6 * k;
    if (S.mode === 'fall' && S.modeT < .8) B.rotation.z = Math.sin(S.modeT * 8) * .3 * (1 - k);
  }
  // hair + skirt in the wind (speed-driven)
  rig.tail.rotation.x = .3 + Math.min(1.1, sp * .22) + Math.sin(t * 7) * .06 * (sp + .3);
  rig.skirt.scale.set(1 + Math.sin(t * 6) * .02 * sp, 1, 1 + Math.min(.25, sp * .05));
  rig.skirt.rotation.x = Math.min(.25, sp * .05);

  // camera: behind and above, wider when resting
  const back = S.resting || S.mode === 'fall' ? 7.5 : 7 + sp * .5, up = S.resting ? 3.4 : 4.2;
  let ch = headingAt(S.s + 4, 14);
  { // lean the view toward the sea (east): keep the coast in frame
    let d = Math.PI / 2 - ch; d = Math.atan2(Math.sin(d), Math.cos(d)); ch += Math.max(-.45, Math.min(.45, d * .35)); }
  if (S.resting || S.mode === 'sit') ch += Math.sin(clock * .12) * 1.2 + 1.3;
  const cx = p.x - Math.sin(ch) * back, cy = p.y - Math.cos(ch) * back;
  const want = new THREE.Vector3(cx, Math.max(y + up, terrainH(cx, cy) + 1.5), -cy);
  const look = new THREE.Vector3(p.x + Math.sin(h) * 4, y + .4, -(p.y + Math.cos(h) * 4));
  if (snapCam || !started || camPos.distanceTo(want) > 30) { camPos.copy(want); camLook.copy(look); snapCam = false; }
  camPos.lerp(want, Math.min(1, dt * 1.6)); camLook.lerp(look, Math.min(1, dt * 3));
  camera.position.copy(camPos); camera.lookAt(camLook);
  // place label
  const nm = nameAt(S.s);
  const near = R.cards.filter(c => Math.abs(c.s - S.s) < 80 && c.type === 'wiki')[0];
  $('place').querySelector('b').textContent = near ? near.title : nm.replace('Eastern Beaches ', '');
  $('sub').textContent = `${nm} · ${Math.round(S.s)} / ${Math.round(L)} m · ${sl > .03 ? '上坡 ↗' : sl < -.03 ? '下坡 ↘' : '平路'} · 海拔 ${Math.round(p.e)} m`;
}

function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 62 : 48; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  seaMat.uniforms.t.value = now / 1000;
  if (started) step(dt);
  pose(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// wake lock so it can sit next to you
async function wake() { try { await navigator.wakeLock?.request('screen'); } catch { } }
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && started && wake());

$('loading').textContent = `真实路线 ${Math.round(L)} m · ${R.buildings.length} 栋房子 · ${R.cards.length} 张明信片`;
$('go').disabled = false;
$('go').onclick = () => { $('start').style.display = 'none'; started = true; wake(); hint('不用管她，想快就往上划', 5); };

// test hooks
window.SW = { S, R, at, camera, girl, terrainH, scene, THREE, jump: (s) => { S.s = s; snapCam = true; }, collect, openAlbum, openCard, sendPostcard, start: () => $('go').click() };
if (new URLSearchParams(location.search).has('autostart')) $('go').click();
