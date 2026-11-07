// Avatar: VRM body (pixiv sample, modification allowed) restyled into a white-dress girl:
//  - white stockings painted onto the leg UVs of the body texture
//  - shorts / shoes lightened
//  - a verlet-cloth skirt pinned to the hips that reacts to wind + motion and collides with the legs
//  - long-hair spring bones driven by relative air velocity
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '../vendor/three-vrm.module.min.js';

export const OUTFIT = new URLSearchParams(location.search).get('outfit') || 'native';   // Cheney 11/08: the model's own sporty jacket + long hair
export async function loadGirl(url) {
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  vrm.userData = { vrm0: vrm.meta?.metaVersion === '0' };
  if (vrm.userData.vrm0) VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((o) => { o.frustumCulled = false; });
  restyle(vrm);
  if (OUTFIT === 'shirt' || OUTFIT === 'native' || OUTFIT === 'breeze') proportions(vrm);
  return vrm;
}

// longer legs (+6% shin, +4% thigh) — done on the raw skeleton before anything measures the body, so IK, skirt and stance all see the new lengths
function proportions(vrm) {
  const H = vrm.humanoid, K = Number(new URLSearchParams(location.search).get('legs') || 1);
  for (const [n, f] of [['leftLowerLeg', 1.04], ['rightLowerLeg', 1.04], ['leftFoot', 1.06], ['rightFoot', 1.06]]) {
    const b = H.getRawBoneNode(n); if (b) b.position.multiplyScalar(1 + (f - 1) * K);
  }
  vrm.scene.updateMatrixWorld(true);
}
// ---------- texture helpers ----------
function texToCanvas(tex) {
  const img = tex.image, c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}
function canvasTex(c, like) {
  const t = new THREE.CanvasTexture(c);
  t.flipY = like ? like.flipY : false; t.colorSpace = like ? like.colorSpace : THREE.SRGBColorSpace;
  t.wrapS = like ? like.wrapS : THREE.RepeatWrapping; t.wrapT = like ? like.wrapT : THREE.RepeatWrapping;
  t.needsUpdate = true; return t;
}
function lighten(tex, base = 200, k = 0.22, tint = [1, 1, 1]) {
  const c = texToCanvas(tex), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) for (let j = 0; j < 3; j++) p[i + j] = Math.min(255, (base + p[i + j] * k) * tint[j]);
  g.putImageData(d, 0, 0); return canvasTex(c, tex);
}
function paintTris(tex, geom, pick, fill) {
  const c = texToCanvas(tex), g = c.getContext('2d'), W = c.width, H = c.height;
  const pos = geom.attributes.position, uv = geom.attributes.uv, idx = geom.index;
  g.fillStyle = fill; g.strokeStyle = fill; g.lineWidth = 2.5; g.lineJoin = 'round';
  const n = idx ? idx.count : pos.count;
  for (let t = 0; t < n; t += 3) {
    const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, cc = idx ? idx.getX(t + 2) : t + 2;
    const ys = [pos.getY(a), pos.getY(b), pos.getY(cc)];
    const st = pick(ys);
    if (!st) continue;
    if (typeof st === 'string') { g.fillStyle = st; g.strokeStyle = st; } else { g.fillStyle = fill; g.strokeStyle = fill; }
    g.beginPath();
    g.moveTo(uv.getX(a) * W, uv.getY(a) * H); g.lineTo(uv.getX(b) * W, uv.getY(b) * H); g.lineTo(uv.getX(cc) * W, uv.getY(cc) * H);
    g.closePath(); g.fill(); g.stroke();
  }
  return canvasTex(c, tex);
}

// white cotton with pink roses + mint leaves (the reference sundress)
export function floralCanvas(W = 1024, H = 1024, scale = 1, seed = 7) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#fbf8f3'; g.fillRect(0, 0, W, H);
  const N = Math.round(150 * scale * scale);
  const rose = (x, y, r) => {
    const cols = [['#f4a7b4', '#e77f93', '#c95d74'], ['#f7c1c9', '#ef9aaa', '#d77489'], ['#f2b38f', '#e8907a', '#cf6c62']][Math.floor(rnd() * 3)];
    for (let k = 0; k < 3; k++) { // leaves
      const a = rnd() * 6.28; g.fillStyle = rnd() < 0.5 ? '#8fcfbf' : '#6fb7a6';
      g.beginPath(); g.ellipse(x + Math.cos(a) * r * 1.15, y + Math.sin(a) * r * 1.15, r * 0.75, r * 0.32, a, 0, 6.28); g.fill();
    }
    for (let ring = 0; ring < 3; ring++) { const rr = r * (1 - ring * 0.3); g.fillStyle = cols[ring];
      for (let k = 0; k < 6; k++) { const a = k * 1.047 + ring * 0.5 + rnd() * 0.3; g.beginPath(); g.arc(x + Math.cos(a) * rr * 0.45, y + Math.sin(a) * rr * 0.45, rr * 0.55, 0, 6.28); g.fill(); } }
    g.fillStyle = cols[2]; g.beginPath(); g.arc(x, y, r * 0.18, 0, 6.28); g.fill();
  };
  for (let i = 0; i < N; i++) {
    const x = rnd() * W, y = rnd() * H, r = (W / 46) * (0.6 + rnd() * 0.8) / scale;
    if (rnd() < 0.28) { g.fillStyle = rnd() < 0.5 ? '#a9ddd2' : '#f6d0d6'; g.beginPath(); g.arc(x, y, r * 0.3, 0, 6.28); g.fill(); continue; } // tiny buds
    for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) if (Math.abs(dx) + Math.abs(dy) === 0 || x + dx > -r * 2 && x + dx < W + r * 2 && y + dy > -r * 2 && y + dy < H + r * 2) rose(x + dx, y + dy, r);
  }
  return c;
}
function meshesByMat(vrm, key) {
  const out = [];
  vrm.scene.traverse((o) => {
    if (!o.isMesh) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    if (ms.some((m) => (m.name || '').includes(key))) out.push(o);
  });
  return out;
}
function matsByName(vrm, key) {
  const s = new Set();
  vrm.scene.traverse((o) => { if (!o.isMesh) return; (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if ((m.name || '').includes(key)) s.add(m); }); });
  return [...s];
}

export const STOCKING_TOP = 0.80; // metres in bind pose (thigh-high)
function restyle(vrm) {
  if (OUTFIT === 'native') {   // keep the model's own designed clothes (and its own cloth spring bones); only fix what was wrong
    // the stock sneakers have a ~6 cm platform: squash the sole band to ~2.5 cm (feet then sit ON the deck)
    for (const o of [...meshesByMat(vrm, 'Shoes'), ...meshesByMat(vrm, 'Body')]) { const P = o.geometry.attributes.position, Y = 0.058, K = 0.42;
      for (let i = 0; i < P.count; i++) { const y = P.getY(i); if (y < Y) P.setY(i, Y - (Y - y) * K); }
      P.needsUpdate = true; o.geometry.computeBoundingSphere(); }
    for (const m of matsByName(vrm, 'Body')) { if (!/Outline/.test(m.name)) legForm(m); }   // rounded knee / shin shading
    return; }
  if (OUTFIT === 'breeze') return restyleBreeze(vrm);
  if (OUTFIT === 'sundress') return restyleSundress(vrm);
  if (OUTFIT === 'shirt') return restyleShirt(vrm);
  // white stockings: every body triangle fully below the stocking top
  const body = meshesByMat(vrm, 'Body')[0];
  if (body) {
    const pick = (ys) => {
      const hi = Math.max(...ys);
      if (hi < STOCKING_TOP - 0.035) return true;
      if (hi < STOCKING_TOP) return 'rgba(255,255,255,0.97)'; // lace band
      return false;
    };
    for (const m of matsByName(vrm, 'Body')) {
      if (m.map) m.map = paintTris(m.map, body.geometry, pick, 'rgba(250,248,252,0.86)');
      if (m.shadeMultiplyTexture) m.shadeMultiplyTexture = paintTris(m.shadeMultiplyTexture, body.geometry, pick, 'rgba(222,220,236,0.86)');
      m.needsUpdate = true;
    }
  }
  for (const key of ['Bottoms', 'Shoes', 'Tops']) for (const m of matsByName(vrm, key)) {
    const tint = key === 'Shoes' ? [1, 0.97, 0.93] : [1, 1, 1];
    if (key === 'Tops' && m.color) m.color.set('#ffffff');
    if (m.map) m.map = lighten(m.map, key === 'Shoes' ? 185 : 222, 0.2, tint);
    if (m.shadeMultiplyTexture) m.shadeMultiplyTexture = lighten(m.shadeMultiplyTexture, 175, 0.2, tint);
    m.needsUpdate = true;
  }
}

// long pale-blue linen shirt worn loose over a short white pleated skirt; bare legs, white sneakers
// 'breeze' (Cheney's reference photo): powder-blue oversized open shirt + matching puffy mini skirt, white bra top,
// black shorts-length leggings to the hips, bare legs, white socks + sneakers. Built on VRoid AvatarSample_B, whose open
// jacket and skirt already carry cloth spring bones; we re-dye them and lighten the cloth so it flies.
const sstepG = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// thin-fabric flutter: vertices with aFlut>0 ripple and lean with the RELATIVE air (wind minus her own motion), on top of
// the spring bones. Uniforms are shared and updated once per frame by flutterUpdate().
export const FLUTTER = { wind: new THREE.Vector3(), t: { value: 0 } }; const FLUTTER_MESHES = [];
function addFlutter(m, amp) {
  const uW = { value: new THREE.Vector3() }; m.userData.uWind = uW;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => { prev?.call(m, sh, r);
    sh.uniforms.uWindL = uW; sh.uniforms.uTime = FLUTTER.t; sh.uniforms.uFlAmp = { value: amp };
    const hasCuff = !!m.userData.cuff;
    if (hasCuff) sh.fragmentShader = 'varying float vCuff;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.93, 0.96, 1.0) * (0.92 + 0.08 * sin(vCuff * 40.0)), smoothstep(0.15, 0.6, vCuff) * 0.85);
`);
    m.userData.cuffOK = !hasCuff || sh.fragmentShader.includes('vCuff * 40.0');
    sh.vertexShader = 'uniform vec3 uWindL; uniform float uTime; uniform float uFlAmp; attribute float aFlut;\n' + (hasCuff ? 'attribute float aCuff; varying float vCuff;\n' : '') + sh.vertexShader.replace('#include <skinning_vertex>', `#include <skinning_vertex>
      ${hasCuff ? 'vCuff = aCuff; transformed += objectNormal * aCuff * 0.006;' : ''}
      { float f = aFlut * uFlAmp; float sp = length(uWindL); float ph = dot(position, vec3(23.0, 17.0, 11.0));
        float rip = 0.6 * sin(uTime * 8.0 + ph) + 0.4 * sin(uTime * 13.0 + ph * 1.7);
        float sw = 0.75 + 0.25 * sin(uTime * 2.7 + ph * 0.31);
        vec3 wd = sp > 0.05 ? uWindL / sp : vec3(0.0); vec3 up = vec3(0.0, 1.0, 0.0); vec3 sd = normalize(cross(up, wd) + vec3(1e-4));
        float drag = min(sp * sp * 0.00085, 0.034);                 // metres at the hem: ~0 walking, ~2 cm at 5 m/s, 3.4 cm in a gale
        float along = dot(position, wd) * 9.0 + (1.2 - position.y) * 11.0;   // distance from the pinned edge, downwind
        float flap = sin(uTime * 9.5 - along) * 0.55 + sin(uTime * 15.0 - along * 1.6 + 1.3) * 0.25;   // waves run toward the hem
        float lift = 0.5 + 0.5 * sin(uTime * 1.9 + position.x * 3.0);   // gusts lift the hem now and then
        transformed += f * (wd * drag * (0.8 + 0.2 * sw) + sd * drag * 0.45 * flap + up * drag * 0.35 * lift * f); }`);
    m.userData.flutterOK = sh.vertexShader.includes('aFlut * uFlAmp'); };
  m.customProgramCacheKey = () => 'flutter' + amp;
}
export function flutterUpdate(airWorld, t) {
  FLUTTER.t.value = t; const q = new THREE.Quaternion();
  for (const o of FLUTTER_MESHES) { o.getWorldQuaternion(q).invert(); const wl = airWorld.clone().applyQuaternion(q);
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.userData.uWind?.value.copy(wl)); }
}
// leg form: soft darkening toward the silhouette and a gentle front highlight (shin, knee cap, thigh) so the legs read as
// rounded forms in flat toon light. Only below the hips (bind-pose y < 0.9).
function legForm(m) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => { prev?.call(m, sh, r);
    sh.vertexShader = 'varying float vLeg; varying vec3 vNv; varying vec3 vVd;\n' + sh.vertexShader.replace(/(void main\(\) \{[\s\S]*?)(\n\})(?![\s\S]*void main)/, (all, body, end) => body + `
      vLeg = 1.0 - smoothstep(0.82, 0.92, position.y); vNv = normalize(normalMatrix * objectNormal); vVd = normalize(-mvPosition.xyz);` + end);
    m.userData.legV = sh.vertexShader.includes('vLeg = 1.0');
    sh.fragmentShader = 'varying float vLeg; varying vec3 vNv; varying vec3 vVd;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      { float ndv = clamp(dot(normalize(vNv), normalize(vVd)), 0.0, 1.0);
        gl_FragColor.rgb *= 1.0 - vLeg * 0.3 * pow(1.0 - ndv, 1.4);
        gl_FragColor.rgb += vLeg * vec3(1.0, 0.93, 0.88) * 0.1 * pow(ndv, 5.0); }`);
    m.userData.legOK = sh.fragmentShader.includes('vLeg * 0.3') && m.userData.legV; };
  m.customProgramCacheKey = () => 'legform';
}

function restyleBreeze(vrm) {
  const flat = (m, k, rgb, lo, hi, keepLight) => { if (!m[k]) return; const c = texToCanvas(m[k]), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) { const r = p[i], gg = p[i + 1], b = p[i + 2], l = (r + gg + b) / 765, sat = Math.max(r, gg, b) - Math.min(r, gg, b);
      if (keepLight && l > 0.78 && sat < 40 && (i / 4) / c.width < c.height * 0.14) { for (let j = 0; j < 3; j++) p[i + j] = 250 - j * 2; continue; }   // inner top lives in the atlas' top band   // pale inner top -> white bra top
      const s = lo + (hi - lo) * Math.pow(l, 0.35);          // squash the varsity contrast: folds stay, stripes melt into the fabric
      for (let j = 0; j < 3; j++) p[i + j] = rgb[j] * s; }
    g.putImageData(d, 0, 0); m[k] = canvasTex(c, m[k]); m.needsUpdate = true; };
  for (const m of matsByName(vrm, 'Tops')) { flat(m, 'map', [196, 222, 246], 0.9, 1.04, false); flat(m, 'shadeMultiplyTexture', [108, 146, 200], 0.8, 1.0, true); if (m.uniforms?.litFactor) m.uniforms.litFactor.value.set(0.86, 0.92, 1.0); if (m.uniforms?.shadeColorFactor) m.uniforms.shadeColorFactor.value.set(0.62, 0.72, 0.9); m.needsUpdate = true; }
  for (const m of matsByName(vrm, 'Bottoms')) { flat(m, 'map', [168, 206, 246], 0.8, 1.0, false); flat(m, 'shadeMultiplyTexture', [120, 158, 208], 0.82, 1.0, false); if (m.uniforms?.litFactor) m.uniforms.litFactor.value.set(0.86, 0.92, 1.0); if (m.uniforms?.shadeColorFactor) m.uniforms.shadeColorFactor.value.set(0.62, 0.72, 0.9); m.needsUpdate = true; }
  for (const m of matsByName(vrm, 'Shoes')) { if (m.map) m.map = lighten(m.map, 238, 0.35, [1, 1, 1]); m.needsUpdate = true; }
  // the stock sneakers have a ~6 cm platform: squash the sole band to ~2.5 cm (normal sneakers). The rider measures the
  // ankle-to-sole height from the mesh afterwards, so feet sit ON the deck instead of sinking through it.
  for (const o of [...meshesByMat(vrm, 'Shoes'), ...meshesByMat(vrm, 'Body')]) { const P = o.geometry.attributes.position, Y = 0.058, K = 0.42;
    for (let i = 0; i < P.count; i++) { const y = P.getY(i); if (y < Y) P.setY(i, Y - (Y - y) * K); }
    P.needsUpdate = true; o.geometry.computeBoundingSphere(); }
  // the stock coat tails (spring-bone planks) are cut at the waist; real cloth tails with per-triangle aerodynamics are
  // sewn on there (lab.js: Skirt{aero}). Rigid planks on 6 bones could only ever 'float like plastic'.
  for (const o of meshesByMat(vrm, 'Tops')) { const g = o.geometry, P = g.attributes.position, idx = g.index; if (!idx) continue;
    const a = idx.array, out = []; for (let q = 0; q < a.length; q += 3) { if (P.getY(a[q]) < 1.0 && P.getY(a[q + 1]) < 1.0 && P.getY(a[q + 2]) < 1.0) continue; out.push(a[q], a[q + 1], a[q + 2]); }
    g.setIndex(out); o.frustumCulled = false; }
  // THIN SHIRT (Cheney's favourite): the jacket mesh keeps its tailoring (shoulders, collar, open front, tails on spring
  // bones) but becomes sheer powder-blue chiffon: semi-transparent, no outline, sleeves rolled up to mid upper arm.
  for (const o of meshesByMat(vrm, 'Tops')) {
    const g = o.geometry, P = g.attributes.position, idx = g.index;
    const keep = (i) => { const y = P.getY(i), ax = Math.abs(P.getX(i)); return !(y > 1.05 && ax > 0.265); };   // cut sleeves at mid upper arm
    if (idx) { const a = idx.array, out = []; for (let q = 0; q < a.length; q += 3) if (keep(a[q]) && keep(a[q + 1]) && keep(a[q + 2])) out.push(a[q], a[q + 1], a[q + 2]); g.setIndex(out); }
    const fl = new Float32Array(P.count);
    for (let i = 0; i < P.count; i++) { const y = P.getY(i), ax = Math.abs(P.getX(i)), z = P.getZ(i);
      const hem = sstepG(1.0, 0.82, y), sleeve = y > 1.05 ? sstepG(0.18, 0.265, ax) * 0.8 : 0, front = y < 1.2 && z > 0.02 && ax < 0.11 ? 0.35 * sstepG(1.2, 1.0, y) : 0;
      fl[i] = Math.min(1, hem + sleeve + front); }
    g.setAttribute('aFlut', new THREE.BufferAttribute(fl, 1));
    const cuff = new Float32Array(P.count); for (let i = 0; i < P.count; i++) { const y = P.getY(i), ax = Math.abs(P.getX(i)); cuff[i] = y > 1.05 ? sstepG(0.215, 0.255, ax) : 0; }
    g.setAttribute('aCuff', new THREE.BufferAttribute(cuff, 1));
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      if (/Outline/.test(m.name)) { addFlutter(m, 1.0); m.needsUpdate = true; return; }   // outline follows the same flutter
      m.side = THREE.DoubleSide;
      if (m.uniforms?.shadeColorFactor) m.uniforms.shadeColorFactor.value.set(0.74, 0.82, 0.94);   // soft, light cotton shade
      m.userData.cuff = true; addFlutter(m, 1.0); m.needsUpdate = true; });
    FLUTTER_MESHES.push(o);
  }
  // HAIR TIED UP: the long back curtain (cards reaching below the shoulders) is gathered at the nape into a low ponytail —
  // squeezed toward the back midline below the tie and shortened — so it swings as ONE soft tail on its spring chain,
  // while the short side locks and bangs stay loose and flutter. No more flat paper sheet.
  if (new URLSearchParams(location.search).get('tie') === '1') { const long = meshesByMat(vrm, 'HAIR').filter((o) => { const P = o.geometry.attributes.position; for (let i = 0; i < P.count; i++) if (P.getY(i) < 1.05) return true; return false; });
    const TIE = 1.37, band = (y) => Math.round((TIE - y) * 25);
    const zs = {}; for (const o of long) { const P = o.geometry.attributes.position; for (let i = 0; i < P.count; i++) { const y = P.getY(i); if (y < TIE) { const b = band(y); (zs[b] = zs[b] || []).push(P.getZ(i)); } } }
    const zc = {}; for (const b in zs) { const a = zs[b].sort((p, q) => p - q); zc[b] = a[Math.floor(a.length / 2)]; }
    for (const o of long) { const P = o.geometry.attributes.position;
      for (let i = 0; i < P.count; i++) { const y = P.getY(i); if (y >= TIE + 0.03) continue;
        const d = Math.max(0, TIE - y), g = y > TIE ? 1 - 0.7 * (TIE + 0.03 - y) / 0.03 : 0.3 - 0.12 * Math.min(1, d / 0.1) + 0.12 * Math.min(1, d / 0.45);   // pinched at the tie, a little fuller toward the ends
        const c = zc[band(Math.min(y, TIE - 0.001))] ?? P.getZ(i);
        P.setX(i, P.getX(i) * g); P.setZ(i, c + (P.getZ(i) - c) * g);
        if (y < TIE) P.setY(i, TIE - d * 0.78); }   // a bit shorter: the tail ends at mid back
      P.needsUpdate = true; o.geometry.computeVertexNormals(); o.geometry.computeBoundingSphere(); }
    // hair tie: a small band at the gather point
    const head = vrm.humanoid.getRawBoneNode('head'); if (head) { vrm.scene.updateMatrixWorld(true);
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.009, 8, 16), new THREE.MeshStandardMaterial({ color: '#8fb8e4', roughness: 0.6 }));
      const zMid = zc[band(TIE - 0.01)] ?? -0.12, wp = new THREE.Vector3(0, TIE - 0.005, zMid); head.worldToLocal(wp); tie.position.copy(wp); tie.rotation.x = Math.PI / 2 - 0.5; head.add(tie); } }
  // the skirt hem flutters a little too (opaque, smaller so it never cuts the legs)
  for (const o of meshesByMat(vrm, 'Bottoms')) { const P = o.geometry.attributes.position, fl = new Float32Array(P.count);
    for (let i = 0; i < P.count; i++) fl[i] = sstepG(0.9, 0.72, P.getY(i)) * 0.45;
    o.geometry.setAttribute('aFlut', new THREE.BufferAttribute(fl, 1));
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (!/Outline/.test(m.name)) { addFlutter(m, 0.6); m.needsUpdate = true; } });
    FLUTTER_MESHES.push(o); }
  // black leggings to just below the hips: paint the body skin between the crotch line and mid-thigh
  const bodies = meshesByMat(vrm, 'Body');
  for (const m of matsByName(vrm, 'Body')) for (const k of ['map', 'shadeMultiplyTexture']) if (m[k]) {
    const c = texToCanvas(m[k]), g = c.getContext('2d'), W = c.width, H = c.height; g.lineWidth = 2.5; g.lineJoin = 'round'; g.fillStyle = g.strokeStyle = k === 'map' ? '#22232b' : '#15161c';
    for (const body of bodies) { const P = body.geometry.attributes.position, uv = body.geometry.attributes.uv, idx = body.geometry.index; if (!uv) continue; const n = idx ? idx.count : P.count;
      for (let q = 0; q < n; q += 3) { const a = idx ? idx.getX(q) : q, b = idx ? idx.getX(q + 1) : q + 1, cc = idx ? idx.getX(q + 2) : q + 2; const y = (P.getY(a) + P.getY(b) + P.getY(cc)) / 3, ax = Math.abs((P.getX(a) + P.getX(b) + P.getX(cc)) / 3);
        if (y < 0.7 || y > 0.98 || ax > 0.2) continue;
        g.beginPath(); g.moveTo(uv.getX(a) * W, uv.getY(a) * H); g.lineTo(uv.getX(b) * W, uv.getY(b) * H); g.lineTo(uv.getX(cc) * W, uv.getY(cc) * H); g.closePath(); g.fill(); g.stroke(); } }
    m[k] = canvasTex(c, m[k]); m.needsUpdate = true;
  }
  // inner top (painted on the body texture: black graphic crop) -> plain white bra top. Mask the chest triangles, then
  // recolour only the garment pixels inside the mask (dark or saturated), keeping skin.
  for (const m of matsByName(vrm, 'Body')) for (const k of ['map', 'shadeMultiplyTexture']) if (m[k]) {
    const c = texToCanvas(m[k]), g = c.getContext('2d'), W = c.width, H = c.height;
    const mk = document.createElement('canvas'); mk.width = W; mk.height = H; const mg = mk.getContext('2d'); mg.fillStyle = mg.strokeStyle = '#fff'; mg.lineWidth = 3;
    for (const body of bodies) { const P = body.geometry.attributes.position, uv = body.geometry.attributes.uv, idx = body.geometry.index; if (!uv) continue; const n = idx ? idx.count : P.count;
      for (let q = 0; q < n; q += 3) { const a = idx ? idx.getX(q) : q, b = idx ? idx.getX(q + 1) : q + 1, cc = idx ? idx.getX(q + 2) : q + 2; const y = (P.getY(a) + P.getY(b) + P.getY(cc)) / 3, ax = Math.abs((P.getX(a) + P.getX(b) + P.getX(cc)) / 3);
        if (y < 1.0 || y > 1.34 || ax > 0.2) continue;
        mg.beginPath(); mg.moveTo(uv.getX(a) * W, uv.getY(a) * H); mg.lineTo(uv.getX(b) * W, uv.getY(b) * H); mg.lineTo(uv.getX(cc) * W, uv.getY(cc) * H); mg.closePath(); mg.fill(); mg.stroke(); } }
    const d = g.getImageData(0, 0, W, H), p = d.data, mm = mg.getImageData(0, 0, W, H).data, wt = k === 'map' ? [250, 248, 246] : [214, 210, 214];
    for (let i = 0; i < p.length; i += 4) { if (!mm[i]) continue; const r = p[i], gg = p[i + 1], b = p[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (r + gg + b) / 3;
      const skin = r > gg && gg > b && r - b > 25 && r - b < 90 && l > 150;
      if (!skin && (l < 140 || mx - mn > 90 || (b > r && l < 200))) { const s = 0.86 + 0.14 * Math.min(1, l / 120); for (let j = 0; j < 3; j++) p[i + j] = wt[j] * s; } }
    g.putImageData(d, 0, 0); m[k] = canvasTex(c, m[k]); m.needsUpdate = true;
  }
  // legs: softer toon terminator + warm rim so knees, calves and thighs read as rounded forms in any light
  for (const m of matsByName(vrm, 'Body')) { if (!/Outline/.test(m.name)) legForm(m); }
  for (const m of matsByName(vrm, 'Body')) { const u = m.uniforms; if (!u) continue;
    if (u.shadingToonyFactor) u.shadingToonyFactor.value = 0.42; if (u.shadingShiftFactor) u.shadingShiftFactor.value = -0.05;
    if (u.shadeColorFactor) u.shadeColorFactor.value.set(0.86, 0.68, 0.64);
    if (u.parametricRimColorFactor) u.parametricRimColorFactor.value.set(0.55, 0.42, 0.36); if (u.parametricRimFresnelPowerFactor) u.parametricRimFresnelPowerFactor.value = 3.2; if (u.parametricRimLiftFactor) u.parametricRimLiftFactor.value = 0.05; }
}

function restyleShirt(vrm) {
  const SKIN = [248, 218, 199];
  for (const m of matsByName(vrm, 'Body')) for (const k of ['map', 'shadeMultiplyTexture']) if (m[k]) {   // bare legs (stock texture has black tights)
    const c = texToCanvas(m[k]), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height), p = d.data, W = c.width, H = c.height, sk = k === 'map' ? SKIN : [235, 190, 180];
    for (let y = Math.floor(H * 0.6); y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, lum = (p[i] + p[i + 1] + p[i + 2]) / 3; if (lum < 150) { const f = Math.min(1, (150 - lum) / 60); for (let j = 0; j < 3; j++) p[i + j] = p[i + j] * (1 - f) + sk[j] * f; } }
    g.putImageData(d, 0, 0); m[k] = canvasTex(c, m[k]); m.needsUpdate = true;
  }
  const tint = (m, k, rgb, lo) => { const c = texToCanvas(m[k]), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) { const l = (p[i] + p[i + 1] + p[i + 2]) / 765, s = lo + (1 - lo) * Math.min(1, l * 1.5); for (let j = 0; j < 3; j++) p[i + j] = rgb[j] * s; }
    g.putImageData(d, 0, 0); m[k] = canvasTex(c, m[k]); };
  // body regions by bind-pose position (mesh space: +z = front, y = height, arms out along ±x at ~1.25 m)
  // the body is split into several primitives (torso, arms, legs...) that share one texture: paint ALL of them
  const bodies = meshesByMat(vrm, 'Body');
  if (bodies.length) {
    let P;
    const zone = (a, b, c) => { const x = (P.getX(a) + P.getX(b) + P.getX(c)) / 3, y = (P.getY(a) + P.getY(b) + P.getY(c)) / 3, z = (P.getZ(a) + P.getZ(b) + P.getZ(c)) / 3, ax = Math.abs(x);
      if (y > 1.13 && ax > 0.15) {                                  // arm
        if (ax < 0.3) return 'sleeve'; if (ax < 0.345) return 'cuff'; return null; }
      if (y > 0.985 && y < 1.37 && ax <= 0.17) {                   // torso
        const front = z > -0.035;
        if (front && ax < 0.105) return y > 1.15 && y < 1.255 ? 'bandeau' : 'skin';   // open front: bandeau, bare waist + collarbones (the stock texture is blank under the old blouse)
        if (front && y > 1.15 && y < 1.255 && ax < 0.13) return 'bandeau';
        return y < 1.36 ? 'shirt' : null; }
      if (y > 0.66 && y <= 0.985) return 'legging';                 // bike-short leggings under the skirt
      return null; };
    const COL = { map: { skin: '#f8dac7', shirt: '#7fb3e6', sleeve: '#7fb3e6', cuff: '#b9d6f2', bandeau: '#fbf7f2', legging: '#2a3046' },
                  shadeMultiplyTexture: { skin: '#ebbeb4', shirt: '#5f8fc4', sleeve: '#5f8fc4', cuff: '#94b6da', bandeau: '#ddd6d0', legging: '#1d2133' } };
    for (const m of matsByName(vrm, 'Body')) for (const k of ['map', 'shadeMultiplyTexture']) if (m[k]) {
      const c = texToCanvas(m[k]), g = c.getContext('2d'), W = c.width, H = c.height;
      g.lineWidth = 2.5; g.lineJoin = 'round';
      for (const body of bodies) { P = body.geometry.attributes.position; const uv = body.geometry.attributes.uv, idx = body.geometry.index, n = idx ? idx.count : P.count; if (!uv) continue;
      for (let q = 0; q < n; q += 3) { const a = idx ? idx.getX(q) : q, b = idx ? idx.getX(q + 1) : q + 1, cc = idx ? idx.getX(q + 2) : q + 2; const zn = zone(a, b, cc); if (!zn) continue;
        (window.__zones = window.__zones || {})[zn] = (window.__zones[zn] || 0) + 1;
        g.fillStyle = g.strokeStyle = COL[k][zn]; g.beginPath(); g.moveTo(uv.getX(a) * W, uv.getY(a) * H); g.lineTo(uv.getX(b) * W, uv.getY(b) * H); g.lineTo(uv.getX(cc) * W, uv.getY(cc) * H); g.closePath(); g.fill(); g.stroke(); }
      }
      m[k] = canvasTex(c, m[k]); m.needsUpdate = true;
    }
  }
  for (const m of [...matsByName(vrm, 'Tops'), ...matsByName(vrm, 'Accessory')]) { m.visible = false; }   // the stock blouse is replaced by the open shirt
  for (const m of matsByName(vrm, 'Bottoms')) { if (m.uniforms?.litFactor) m.uniforms.litFactor.value.set(0.17, 0.19, 0.27); if (m.color) m.color.set('#2a3046'); m.needsUpdate = true; }
  for (const m of []) { if (m.color) m.color.set('#ffffff'); if (m.uniforms?.litFactor) m.uniforms.litFactor.value.set(0.72, 0.84, 1.0); if (m.uniforms?.shadeColorFactor) m.uniforms.shadeColorFactor.value.set(0.5, 0.62, 0.82); if (m.map) tint(m, 'map', [128, 180, 230], 0.6); if (m.shadeMultiplyTexture) tint(m, 'shadeMultiplyTexture', [128, 168, 205], 0.8); m.needsUpdate = true; }
  for (const m of matsByName(vrm, 'Bottoms')) { if (m.map) m.map = lighten(m.map, 228, 0.15); m.needsUpdate = true; }
  for (const m of matsByName(vrm, 'Shoes')) { if (m.map) m.map = lighten(m.map, 236, 0.12); if (m.shadeMultiplyTexture) m.shadeMultiplyTexture = lighten(m.shadeMultiplyTexture, 205, 0.12); m.needsUpdate = true; }
}
function restyleSundress(vrm) {
  // bare legs: the stock texture paints black tights on the legs -> repaint those regions with the skin tone
  const SKIN = [248, 218, 199];
  for (const m of matsByName(vrm, 'Body')) for (const k of ['map', 'shadeMultiplyTexture']) if (m[k]) {
    const c = texToCanvas(m[k]), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height), p = d.data, W = c.width, H = c.height;
    const sk = k === 'map' ? SKIN : [235, 190, 180];
    for (let y = Math.floor(H * 0.6); y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, lum = (p[i] + p[i + 1] + p[i + 2]) / 3;
      if (lum < 150) { const f = Math.min(1, (150 - lum) / 60); for (let j = 0; j < 3; j++) p[i + j] = p[i + j] * (1 - f) + sk[j] * f; }
    }
    g.putImageData(d, 0, 0); m[k] = canvasTex(c, m[k]);
    // strappy sandals: thin tan leather straps around the ankle + across the instep (bind-pose heights)
    const body = meshesByMat(vrm, 'Body')[0];
    if (body) m[k] = paintTris(m[k], body.geometry, (ys) => { const lo = Math.min(...ys), hi = Math.max(...ys); return (hi > 0.085 && lo < 0.1) || (hi > 0.135 && lo < 0.145) ? true : false; }, k === 'map' ? 'rgb(150,98,62)' : 'rgb(110,70,45)');
    m.needsUpdate = true;
  }
  // floral bodice; tan strappy sandals
  const fl = floralCanvas(1024, 1024, 1.6, 11);
  for (const m of matsByName(vrm, 'Tops')) {
    if (m.color) m.color.set('#ffffff');
    for (const k of ['map', 'shadeMultiplyTexture']) if (m[k]) {
      const c = texToCanvas(m[k]), g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height);
      const f = document.createElement('canvas'); f.width = c.width; f.height = c.height; const fg = f.getContext('2d'); fg.drawImage(fl, 0, 0, c.width, c.height);
      const fd = fg.getImageData(0, 0, c.width, c.height).data, p = d.data;
      for (let i = 0; i < p.length; i += 4) { const lum = (p[i] + p[i + 1] + p[i + 2]) / 765; const sh = k === 'map' ? 0.55 + 0.45 * Math.min(1, lum * 1.6) : 0.82; for (let j = 0; j < 3; j++) p[i + j] = fd[i + j] * sh; }
      g.putImageData(d, 0, 0); m[k] = canvasTex(c, m[k]);
    }
    m.needsUpdate = true;
  }
  for (const m of matsByName(vrm, 'Bottoms')) { if (m.map) m.map = lighten(m.map, 222, 0.2); m.needsUpdate = true; }
  for (const m of matsByName(vrm, 'Shoes')) {
    if (m.map) m.map = lighten(m.map, 120, 0.25, [1.25, 0.92, 0.66]);
    if (m.shadeMultiplyTexture) m.shadeMultiplyTexture = lighten(m.shadeMultiplyTexture, 95, 0.25, [1.2, 0.88, 0.62]);
    m.needsUpdate = true;
  }
}

// ---------- hair wind ----------
export function setupHair(vrm) {
  const joints = [...(vrm.springBoneManager?.joints || [])];
  const hair = joints.filter((j) => /Hair/i.test(j.bone.name));
  const cloth = joints.filter((j) => /Tops|Skirt|Bust|Coat|Jacket|Cloth|Bottoms/i.test(j.bone.name) && !/Bust/i.test(j.bone.name));
  const NAT = OUTFIT === 'native' || OUTFIT === 'breeze';
  if (NAT) cloth.forEach((j) => { j.settings.stiffness *= /CoatSkirt/.test(j.bone.name) ? 0.22 : 0.5; j.settings.dragForce = /CoatSkirt/.test(j.bone.name) ? 0.34 : Math.min(j.settings.dragForce, 0.22); });   // light but with weight: swings, then settles
  // Hair reads as one soft mass only if NEIGHBOURING strands move together. Each strand gets a phase from its azimuth
  // around the head (smooth across neighbours) and a depth along its chain; the wind field is coherent (one gust shape
  // sweeping across the head) with only a little per-strand jitter. Roots are firmer, tips softer.
  const head = vrm.humanoid.getNormalizedBoneNode('head'); vrm.scene.updateMatrixWorld(true);
  const hc = head.getWorldPosition(new THREE.Vector3()), names = new Set(hair.map((j) => j.bone));
  hair.forEach((j, i) => {
    let d = 0, b = j.bone.parent; while (b && names.has(b)) { d++; b = b.parent; }
    { let n = 0, c = j; const kids = (x) => hair.find((k) => k.bone.parent === x.bone); while ((c = kids(c))) n++; j._chainLen = d + n + 1; j._short = j._chainLen <= 3; }
    const p = j.bone.getWorldPosition(new THREE.Vector3()).sub(hc);
    j._az = Math.atan2(p.x, p.z); j._depth = d; j._jit = ((i * 37) % 10) / 10;
    const tip = Math.min(1, d / 3);
    j.settings.stiffness = Math.min(j.settings.stiffness, 0.35) * (0.85 - 0.45 * tip);
    j.settings.dragForce = 0.32 - 0.08 * tip;
  });
  // per-joint constants for the tiered rig: tip = 0 at the root .. 1 at the last joint of its chain
  hair.forEach((j) => { j._tip = j._chainLen > 1 ? j._depth / (j._chainLen - 1) : 1; j._k0 = j.settings.stiffness; });
  // chains (root joint → tip joint) for closed-loop control: the spring bones' rest pull fights the wind, so instead of
  // guessing powers we measure each chain's real direction and steer its gain until it reaches the target direction
  const chains = hair.filter((j) => !names.has(j.bone.parent)).map((r) => { const js = [r]; let c = r; while ((c = hair.find((k) => k.bone.parent === c.bone))) js.push(c); return { js, gain: 1, root: r.bone, tipB: js[js.length - 1].bone }; })
    .filter((c) => c.js.length >= 2);
  for (const c of chains) for (const j of c.js) j._chain = c;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _tgt = new THREE.Vector3();
  const tmp = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), fwd = new THREE.Vector3(), lagLat = new THREE.Vector3(), lagV = { y: 0 };
  const hq = new THREE.Quaternion(), right = new THREE.Vector3(), hfwd = new THREE.Vector3();
  const vn = (t, f, s) => Math.sin(t * f * 6.283 + s) * 0.6 + Math.sin(t * f * 6.283 * 2.13 + s * 1.7) * 0.4;   // cheap smooth noise
  return {
    // air = relative air velocity (wind − body velocity), world space. Spec writes V_rel = V_char − V_wind = −air.
    // o = { dt, fwd: travel direction (world), latAcc: lateral acceleration vector (v²κ toward the turn centre), vAcc: vertical accel }
    update(air, t, o = {}) {
      const dt = o.dt || 1 / 60, sp = air.length(), kmh = sp * 3.6;
      // ---- velocity tiers (smoothly blended): T0 idle 0-5, T1 cruise 5-25, T2 high speed 25-60+
      const w1 = sstepG(3, 8, kmh), w2 = sstepG(22, 32, kmh);
      const pitchDeg = kmh < 5 ? 0 : kmh < 25 ? 35 * (kmh - 5) / 20 : 35 + (78 - 35) * Math.min(1, (kmh - 25) / 35);   // lift from hanging toward horizontal
      const damping = 0.75 - 0.15 * w1 - 0.35 * w2;     // T0 ~0.75, T1 0.6, T2 0.25 (three-vrm dragForce)
      const stiffMul = 1 - 0.0 * w1 - 0.3 * w2;         // T1 root/tip ratio as set up; T2 a little looser so the tail straightens
      // ---- direction matrix in the character frame (yaw of the air relative to her forward)
      fwd.copy(o.fwd || tmp.set(0, 0, 1)).setY(0).normalize(); side.crossVectors(up, fwd);   // side = her left
      const aH = tmp.copy(air).setY(0), aHl = aH.length() || 1e-6, ad = aH.divideScalar(aHl).clone();   // downwind (horizontal)
      const along = ad.dot(fwd);                        // −1 headwind (blows backward), +1 tailwind (blows forward)
      const tail = Math.max(0, along);                  // tailwind → hair goes forward/up over the head: cap the pitch (face colliders are coarse)
      const pitch = THREE.MathUtils.degToRad(Math.min(70, pitchDeg * (1 + 0.4 * tail)));   // tailwind: lighter drag needed to lift it forward; cap at 70° (keep it off the face)
      // ---- carving: lateral (centrifugal) and vertical load act on the hair as pseudo-forces with a first-order lag,
      // so the tail swings to the outside of the turn a beat late and whips back (S-shaped because roots are stiffer)
      const tau = 0.22 + 0.15 * (1 - w2);               // softer lag at cruise, quicker at speed
      const lA = o.latAcc ? tmp.copy(o.latAcc) : tmp.set(0, 0, 0);
      lagLat.lerp(lA, 1 - Math.exp(-dt / tau)); lagV.y += ((o.vAcc || 0) - lagV.y) * (1 - Math.exp(-dt / 0.12));
      head.getWorldQuaternion(hq); right.set(1, 0, 0).applyQuaternion(hq); hfwd.set(0, 0, 1).applyQuaternion(hq);
      // target direction for long chains: hang (down), lifted toward downwind by the tier pitch (side chains share it so the
      // mass stays one tail). Measure → integrate gain (bounded) so stiffness can't eat the wind.
      const pitchR = pitch, crossK = Math.abs(ad.dot(side));
      _tgt.copy(up).multiplyScalar(-Math.cos(pitchR)).addScaledVector(ad, Math.sin(pitchR)).normalize();
      for (const c of chains) { c.root.getWorldPosition(_a); c.tipB.getWorldPosition(_b); const cur = _b.sub(_a).normalize();
        const err = Math.acos(Math.max(-1, Math.min(1, cur.dot(_tgt))));   // radians off target
        const want = err > 0.08 ? 1 : -1;
        c.gain = Math.max(0.6, Math.min(4.5, c.gain * Math.exp(want * dt * 1.4 * Math.min(1, err * 2))));
        c.err = err; }
      for (const j of hair) {
        const tip = j._tip, ph = j._az * 0.8 + j._depth * 0.4;
        // base: down, rotated toward downwind by the tier pitch; roots lift less than tips (stiff root → curve)
        const pj = pitch * (0.75 + 0.35 * tip);
        const d = j.settings.gravityDir.copy(up).multiplyScalar(-Math.cos(pj)).addScaledVector(ad, Math.sin(pj));
        // T0 breathing sway: 0.5 Hz, ±2°
        d.addScaledVector(side, (1 - w1) * 0.035 * vn(t, 0.5, ph));
        // T1 soft wave along the strands (travelling toward the tips)
        d.addScaledVector(side, w1 * (1 - w2) * 0.08 * tip * Math.sin(t * 2.4 - j._depth * 1.3 + j._jit));
        // T2 turbulence: 8-15 Hz tip tearing
        if (w2 > 0) { const a = w2 * 0.22 * tip * tip; d.addScaledVector(side, a * vn(t, 8 + 7 * j._jit, ph)).addScaledVector(up, a * 0.7 * vn(t, 11 + 4 * j._jit, ph + 2)); }
        // carve pseudo-force (outward = −latAcc) and vertical bumps/downhill unloading
        d.addScaledVector(lagLat, -0.06 * (0.5 + tip)).addScaledVector(up, -0.03 * lagV.y * tip);
        // bangs (chains in front of the head): headwind presses them back onto the forehead, tailwind flips them forward
        const front = j._front ?? (j._front = (() => { const p = j.bone.getWorldPosition(new THREE.Vector3()).sub(hc); return p.dot(hfwd) > 0.03; })());
        if (front) d.addScaledVector(hfwd, -(1 - tail * 2) * 0.35 * w1);
        // cohesion: side chains pulled toward the back midline (crosswind: the whole mass leans downwind together)
        d.addScaledVector(right, -Math.sin(j._az) * 0.4 * (1 - 0.6 * crossK));
        d.normalize();
        // power: gravity + air drag ∝ v²; the short locks flicker
        const gust = 1 + 0.1 * Math.sin(t * 2.1 - ph) + (j._short ? 0.2 * Math.sin(t * 9 + j._jit * 7) * w1 : 0);
        j.settings.gravityPower = Math.min(3.5, (0.5 + 0.9 * w1 * (kmh / 25) * (1 - 0.5 * w2) + 0.5 * w2) * gust * (j._chain ? j._chain.gain : 1));
        j.settings.dragForce = damping * (1 - 0.15 * tip);
        j.settings.stiffness = j._k0 * stiffMul;
      }
      // ---- clothing spring bones (coat sleeves/front): drag ∝ v², same direction logic, lighter than hair
      for (const j of cloth) { const k = j._ck ?? (j._ck = 0.85 + Math.random() * 0.3), fl = 1 + 0.25 * Math.sin(t * (3 + k * 2) + k * 9) + (0.12 + 0.3 * w2) * Math.sin(t * (7.3 + 6 * w2) + k * 4);
        const coat = /CoatSkirt/.test(j.bone.name), cd = (coat ? 0.03 : 0.018) * k * fl, sp2 = Math.min(1.8, cd * sp);
        tmp.set(0, -1, 0); if (sp > 0.05) tmp.addScaledVector(air, sp2 / sp * (NAT ? 1 : 0.3));
        tmp.addScaledVector(lagLat, -0.03);
        const m = tmp.length(); j.settings.gravityDir.copy(tmp).divideScalar(m); j.settings.gravityPower = m * (NAT ? 0.55 : 0.2); }
      this.state = { kmh, tier: w2 > 0.5 ? 2 : w1 > 0.5 ? 1 : 0, pitchDeg: THREE.MathUtils.radToDeg(pitch), along, damping, err: chains.map((c) => Math.round(c.err * 57.3)), gain: chains.map((c) => +c.gain.toFixed(2)) };
    },
  };
}

// ---------- cloth skirt ----------
export class Skirt {
  constructor(vrm, scene, opt = {}) {
    this.vrm = vrm; this.R = opt.rows || 14; this.C = opt.cols || 30;
    const hum = vrm.humanoid;
    this.hips = hum.getNormalizedBoneNode(opt.pin || 'hips');   // the bone the top ring is sewn to
    this.opt = opt; this.open = opt.open || 0;
    this.bones = ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'hips', 'spine', 'leftLowerArm', 'leftHand', 'rightLowerArm', 'rightHand'].reduce((o, n) => (o[n] = hum.getNormalizedBoneNode(n), o), {});
    vrm.scene.updateMatrixWorld(true);
    const hipRest = new THREE.Vector3(); this.hips.getWorldPosition(hipRest);
    // measure body radius per angle at heights (bind pose) so the skirt never starts inside the body
    const verts = [];
    vrm.scene.traverse((o) => {
      if (!o.isMesh) return; const n = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => m.name).join();
      if (!/Body|Tops|Bottoms/.test(n)) return;
      const p = o.geometry.attributes.position, v3 = new THREE.Vector3();
      for (let i = 0; i < p.count; i += 1) { v3.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (v3.y > 0.3 && v3.y < 1.08) verts.push(v3.x, v3.y, v3.z); }
    });
    const cx = hipRest.x, cz = hipRest.z;
    // which way is 'front' (bind pose): toes point forward
    const tw = hum.getRawBoneNode('leftToes')?.getWorldPosition(new THREE.Vector3()), fw = hum.getRawBoneNode('leftFoot')?.getWorldPosition(new THREE.Vector3());
    const fa = tw && fw ? Math.atan2(tw.z - fw.z, tw.x - fw.x) : Math.PI / 2;
    const invHips = this.hips.matrixWorld.clone().invert();
    const C = this.C, R = this.R;
    const y0 = opt.top ?? 1.0, y1 = opt.hem ?? 0.40;
    const radAt = (yA, yB) => {
      const r = new Float32Array(C).fill(0.05);
      for (let i = 0; i < verts.length; i += 3) {
        const y = verts[i + 1]; if (y < yA || y > yB) continue;
        const x = verts[i] - cx, z = verts[i + 2] - cz, a = Math.atan2(z, x);
        const k = ((Math.round((a / (Math.PI * 2)) * C) % C) + C) % C, d = Math.hypot(x, z);
        for (const kk of [k - 1, k, k + 1]) { const q = ((kk % C) + C) % C; if (d > r[q]) r[q] = d; }
      }
      return r;
    };
    const rTop = radAt(y0 - 0.03, y0 + 0.03);
    const rWaist = radAt(1.0, 1.12);
    const rHip = radAt(0.78, 0.97);
    this.local = []; // rest positions in hips space
    this.rest = [];
    const N = R * C;
    this.p = new Float32Array(N * 3); this.q = new Float32Array(N * 3);
    for (let r = 0; r < R; r++) {
      const f = r / (R - 1), y = y0 + (y1 - y0) * f;
      for (let c = 0; c < C; c++) {
        // open garments span the arc that leaves a gap of ±open around the front
        const a = this.open ? fa + this.open + (c / (C - 1)) * (Math.PI * 2 - 2 * this.open) : (c / C) * Math.PI * 2;
        let rad = rTop[c] + 0.014;
        if (y < 1.13) rad = Math.max(rad, rWaist[c] + 0.03);
        if (y < 0.97) rad = Math.max(rad, rHip[c] + 0.025);
        rad += Math.max(0, (y0 - y) - 0.05) * (opt.flare ?? 0.42);
        this.local.push(new THREE.Vector3(cx + Math.cos(a) * rad, y, cz + Math.sin(a) * rad).applyMatrix4(invHips));
      }
    }
    // constraints
    const cons = [];
    const id = (r, c) => r * C + ((c + C) % C);
    const d = (a, b) => this.local[a].distanceTo(this.local[b]);
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const a = id(r, c);
      const sb = opt.soft ?? 1, okR = !this.open || c < C - 1, okL = !this.open || c > 0, ok2 = !this.open || c < C - 2, bend = opt.bend ?? 1;
      if (okR) cons.push([a, id(r, c + 1), d(a, id(r, c + 1)), 1]);
      if (r + 1 < R) { cons.push([a, id(r + 1, c), d(a, id(r + 1, c)), 1]); if (okR) cons.push([a, id(r + 1, c + 1), d(a, id(r + 1, c + 1)), 0.5 * sb]); if (okL) cons.push([a, id(r + 1, c - 1), d(a, id(r + 1, c - 1)), 0.5 * sb]); }
      if (r + 2 < R && bend > 0) cons.push([a, id(r + 2, c), d(a, id(r + 2, c)), 0.25 * sb * bend]);
      if (c % 2 === 0 && ok2 && bend > 0) cons.push([a, id(r, c + 2), d(a, id(r, c + 2)), 0.3 * sb * bend]);
    }
    this.cons = cons;
    this.maxDist = this.local.map((v, i) => v.distanceTo(this.local[i % C]) * 1.04);
    // geometry
    const geo = new THREE.BufferGeometry();
    const vC = C + 1; // duplicate seam column for uvs
    this.vpos = new Float32Array(R * vC * 3);
    const uvs = new Float32Array(R * vC * 2), idx = [];
    for (let r = 0; r < R; r++) for (let c = 0; c <= C; c++) { uvs[(r * vC + c) * 2] = c / C; uvs[(r * vC + c) * 2 + 1] = r / (R - 1); }
    for (let r = 0; r < R - 1; r++) for (let c = 0; c < (this.open ? C - 1 : C); c++) { const a = r * vC + c, b = a + 1, e = a + vC, f2 = e + 1; idx.push(a, e, b, b, e, f2); }
    geo.setAttribute('position', new THREE.BufferAttribute(this.vpos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    this.geo = geo; this.vC = vC;
    const grad = new THREE.DataTexture(new Uint8Array([150, 160, 205, 255, 214, 216, 236, 255, 252, 252, 255, 255, 255, 255, 255, 255]), 4, 1);
    grad.minFilter = grad.magFilter = THREE.LinearFilter; grad.needsUpdate = true;
    // hem shading: slightly translucent-looking lower edge via uv-based tint
    this.rimU = { value: new THREE.Color(0, 0, 0) };
    const mat = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: grad, side: THREE.DoubleSide, transparent: true });
    this.style = opt.style || (OUTFIT === 'sundress' ? 'floral' : 'plain');
    this.floral = this.style === 'floral'; this.shirt = this.style === 'shirt'; this.pleat = this.style === 'pleat';
    if (this.shirt) mat.color.set('#7fb3e6');
    if (this.floral) { const ft = new THREE.CanvasTexture(floralCanvas(1024, 512, 1.0, 5)); ft.colorSpace = THREE.SRGBColorSpace; ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(3, 1); ft.anisotropy = 4; mat.map = ft; }
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_pars_vertex>', '#include <uv_pars_vertex>\nvarying vec2 vSk;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvSk = uv;');
      sh.uniforms.uRim = this.rimU; sh.fragmentShader = sh.fragmentShader.replace('#include <uv_pars_fragment>', '#include <uv_pars_fragment>\nvarying vec2 vSk;\nuniform vec3 uRim;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + (this.shirt ?
          // shirt tails: pale blue linen with a faint weave, a slightly darker placket along the open front edges, stitched hem
          ' float wv = 0.97 + 0.03 * sin(vSk.x * 3.14159 * 220.0) * sin(vSk.y * 90.0); gl_FragColor.rgb *= wv; float edge = 1.0 - smoothstep(0.0, 0.035, min(vSk.x, 1.0 - vSk.x)); gl_FragColor.rgb *= 1.0 - 0.1 * edge; gl_FragColor.rgb *= 1.0 - 0.08 * smoothstep(0.93, 0.97, vSk.y);' : '') + (this.pleat ?
          // soft white pleated skirt: knife pleats as light/shadow stripes, deeper at the hem where they open
          ' float pl = 0.84 + 0.16 * abs(sin(vSk.x * 3.14159 * 56.0)) ; gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * pl, 0.4 + 0.6 * vSk.y);' : '') + (this.floral ?
          // sundress: inside (and the last band) is the white ruffled petticoat with a scalloped lace edge
          ' float pet = gl_FrontFacing ? 0.0 : 1.0; float sc = 0.955 + 0.03 * abs(sin(vSk.x * 3.14159 * 72.0)); pet = max(pet, step(sc, vSk.y)); gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.98, 0.97, 0.95) * (0.82 + 0.18 * abs(sin(vSk.x * 3.14159 * 144.0))) * (gl_FrontFacing ? 1.0 : 0.9), pet);' : '') + '\n float hem = smoothstep(0.78, 1.0, vSk.y); gl_FragColor.rgb = mix(gl_FragColor.rgb, min(vec3(1.), gl_FragColor.rgb*vec3(1.02,1.02,1.05)+0.04), hem); gl_FragColor.a = mix(0.97, 0.72, hem); vec3 vd = normalize(vViewPosition); float fr = pow(1.0 - abs(dot(normalize(vNormal), vd)), 2.5); gl_FragColor.rgb += uRim * (fr * 0.9 + hem * 0.35);');
    };
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.tmp = new THREE.Vector3(); this.m = new THREE.Matrix4();
    this.inited = false;
    this.caps = [];
    this.windT = 0; this.aero = opt.aero || null;
    this.cosMax = Math.cos((opt.maxSwing ?? 50) * Math.PI / 180);
    this.airGain = opt.airGain ?? 0.6;
  }
  pinWorld(i, out) { return out.copy(this.local[i]).applyMatrix4(this.hips.matrixWorld); }
  reset() {
    const N = this.R * this.C, v = this.tmp;
    for (let i = 0; i < N; i++) { this.pinWorld(i, v); this.p.set([v.x, v.y, v.z], i * 3); this.q.set([v.x, v.y, v.z], i * 3); }
    this.inited = true;
  }
  setBoard(obj, on) { if (!on) { this.boardBox = null; return; } obj.updateMatrixWorld(true); const m = obj.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.07, 0)); this.boardBox = { m, inv: m.clone().invert(), hx: 0.125, hy: 0.06, hz: 0.5 }; }
  colliders() {
    const B = this.bones, w = (b) => b.getWorldPosition(new THREE.Vector3());
    const hip = w(B.hips), sp = w(B.spine);
    const lU = w(B.leftUpperLeg), lL = w(B.leftLowerLeg), lF = w(B.leftFoot), rU = w(B.rightUpperLeg), rL = w(B.rightLowerLeg), rF = w(B.rightFoot);
    const mid = lU.clone().add(rU).multiplyScalar(0.5);
    return [
      [sp, mid.clone().lerp(hip, 0.2), 0.135],
      [lU.clone().lerp(mid, 0.25), lL, 0.082], [lL, lF, 0.058],
      [rU.clone().lerp(mid, 0.25), rL, 0.082], [rL, rF, 0.058],
      [w(B.leftLowerArm), w(B.leftHand), 0.04], [w(B.rightLowerArm), w(B.rightHand), 0.04],
      ...(this.opt.extraCaps ? this.opt.extraCaps(w, B, mid, hip, sp) : []),
    ];
  }
  // Per-triangle aerodynamics (after NVIDIA NvCloth SwSolverKernel::applyWind): for each triangle, relative air
  // u = wind - v_triangle; with θ the angle between the triangle normal and u,
  //   drag = Cd·|cosθ|·u·|u|   (pushes a face-on panel downwind, ∝ speed²)
  //   lift = Cl·cosθ·sinθ·|u|² along the direction ⟂ u in the (u, n) plane  (what makes an edge-on panel flap)
  // acceleration = ρ_air/σ_cloth · (drag + lift); σ = areal density. The wind itself is a coherent gusty field that
  // travels downwind (a gust front sweeps over her), not per-particle noise.
  clampBulge() {   // cloth stays near the body sideways: it trails BACK (downwind), never sticks out like wings
    const p = this.p, C = this.C, R = this.R, A = this.aero, ax = this._axis; if (!ax) return;
    for (let i = C; i < R * C; i++) { const k = i * 3, dx = p[k] - ax.x, dz = p[k + 2] - ax.z;
      const sx = ax.sx, sz = ax.sz, lat = dx * sx + dz * sz;          // sideways component (her right)
      const lim = A.bulge; if (Math.abs(lat) > lim) { const e = lat - Math.sign(lat) * lim; p[k] -= e * sx * 0.5; p[k + 2] -= e * sz * 0.5; } } }
  applyAero(air, h, t) {
    const p = this.p, q = this.q, C = this.C, R = this.R, A = this.aero, rs = A.rho / A.sigma, cols = this.open ? C - 1 : C;
    const sp = Math.hypot(air.x, air.y, air.z) || 1e-6, wx = air.x / sp, wz = air.z / sp;
    const acc = this.aacc || (this.aacc = new Float32Array(R * C * 3)); acc.fill(0);
    const tri = (a, b, c) => {
      const ka = a * 3, kb = b * 3, kc = c * 3;
      const cx = (p[ka] + p[kb] + p[kc]) / 3, cy = (p[ka + 1] + p[kb + 1] + p[kc + 1]) / 3, cz = (p[ka + 2] + p[kb + 2] + p[kc + 2]) / 3;
      const vx = (p[ka] + p[kb] + p[kc] - q[ka] - q[kb] - q[kc]) / (3 * h), vy = (p[ka + 1] + p[kb + 1] + p[kc + 1] - q[ka + 1] - q[kb + 1] - q[kc + 1]) / (3 * h), vz = (p[ka + 2] + p[kb + 2] + p[kc + 2] - q[ka + 2] - q[kb + 2] - q[kc + 2]) / (3 * h);
      const ph = (cx * wx + cz * wz) * 1.7 - t * 2.4;            // gust fronts moving downwind (~1.4 m/s pattern speed)
      const gst = 1 + A.gust * (0.6 * Math.sin(ph) + 0.4 * Math.sin(ph * 2.3 + 1.7 + cy * 4.0));
      const ux = air.x * gst - vx, uy = air.y * gst - vy, uz = air.z * gst - vz, ul = Math.hypot(ux, uy, uz); if (ul < 1e-4) return;
      const e1x = p[kb] - p[ka], e1y = p[kb + 1] - p[ka + 1], e1z = p[kb + 2] - p[ka + 2], e2x = p[kc] - p[ka], e2y = p[kc + 1] - p[ka + 1], e2z = p[kc + 2] - p[ka + 2];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x; const nl = Math.hypot(nx, ny, nz) || 1e-9; nx /= nl; ny /= nl; nz /= nl;
      const cos = (nx * ux + ny * uy + nz * uz) / ul, sin = Math.sqrt(Math.max(0, 1 - cos * cos));
      // lift direction: ⟂ u, in the plane of u and n  =  (u × n) × û
      let lx = (uy * nz - uz * ny), ly = (uz * nx - ux * nz), lz = (ux * ny - uy * nx); const tx = ly * uz - lz * uy, ty = lz * ux - lx * uz, tz = lx * uy - ly * ux; const tl = Math.hypot(tx, ty, tz) || 1e-9;
      const dk = A.cd * Math.abs(cos) * ul, lk = A.cl * cos * sin * ul * ul / tl;
      const fx = rs * (dk * ux + lk * tx), fy = rs * (dk * uy + lk * ty), fz = rs * (dk * uz + lk * tz);
      for (const k of [ka, kb, kc]) { acc[k] += fx / 3; acc[k + 1] += fy / 3; acc[k + 2] += fz / 3; } };
    for (let r = 0; r < R - 1; r++) for (let c = 0; c < cols; c++) { const a = r * C + c, b = r * C + ((c + 1) % C), e = a + C, f = b + C; tri(a, e, b); tri(b, e, f); }
    const lim = 0.02, h2 = h * h;
    for (let i = C; i < R * C; i++) { const k = i * 3; let dx = acc[k] * h2 * 1.5, dy = acc[k + 1] * h2 * 1.5, dz = acc[k + 2] * h2 * 1.5; const dl = Math.hypot(dx, dy, dz); if (dl > lim) { const f = lim / dl; dx *= f; dy *= f; dz *= f; } p[k] += dx; p[k + 1] += dy; p[k + 2] += dz; }
  }
  // air(world vec3): wind velocity in world; groundY(x,z) for floor collision
  step(dt, air0, t, groundY) {
    const air = this.airv || (this.airv = new THREE.Vector3()); air.copy(air0).multiplyScalar(this.airGain);
    this.hips.updateWorldMatrix(true, false);
    if (!this.inited) this.reset();
    const R = this.R, C = this.C, N = R * C, p = this.p, q = this.q, v = this.tmp;
    const sub = 3, h = Math.min(dt, 1 / 30) / sub, caps = this.colliders();
    const drag = 2.6, g = -9.8;
    for (let s = 0; s < sub; s++) {
      for (let i = C; i < N; i++) {
        const k = i * 3, r = Math.floor(i / C), c = i % C;
        const vx = (p[k] - q[k]) / h, vy = (p[k + 1] - q[k + 1]) / h, vz = (p[k + 2] - q[k + 2]) / h;
        const tt = t + s * h;
        const rr = r / (R - 1), turb = 0.25 + 0.75 * rr, hemF = rr * rr * rr; // flutter concentrates at the hem
        const gx = air.x * (1 + 0.45 * Math.sin(tt * 6.1 + c * 0.9 + r * 0.5) * turb) + Math.sin(tt * 3.7 + c * 1.3) * 0.5 * turb + Math.sin(tt * 11 + c * 2.3) * (0.3 + Math.abs(air.z) * 0.25) * hemF;
        const sp = Math.hypot(air.x, air.z);
        const gy = air.y + Math.sin(tt * 4.9 + c * 0.7 + r) * 0.45 * turb + Math.sin(tt * 13 + c * 1.9 - r * 0.8) * (0.4 + sp * 0.35) * hemF;
        const gz = air.z * (1 + 0.45 * Math.sin(tt * 5.3 + c * 1.1 - r * 0.4) * turb) + Math.cos(tt * 4.1 + c) * 0.5 * turb + Math.cos(tt * 12 + c * 2.1) * (0.3 + Math.abs(air.x) * 0.25) * hemF;
        const dg = this.aero ? 0.15 : drag * (0.8 + 0.5 * rr);   // aero cloth: only light damping here, air acts per triangle below
        const ax = this.aero ? -dg * vx : dg * (gx - vx), ay = g * (1 - 0.25 * rr) + (this.aero ? -dg * vy : dg * (gy - vy)), az = this.aero ? -dg * vz : dg * (gz - vz);
        const nx = p[k] + (p[k] - q[k]) * 0.995 + ax * h * h, ny = p[k + 1] + (p[k + 1] - q[k + 1]) * 0.995 + ay * h * h, nz = p[k + 2] + (p[k + 2] - q[k + 2]) * 0.995 + az * h * h;
        q[k] = p[k]; q[k + 1] = p[k + 1]; q[k + 2] = p[k + 2];
        p[k] = nx; p[k + 1] = ny; p[k + 2] = nz;
      }
      if (this.aero) this.applyAero(air, h, t + s * h);
      if (this.aero && this.aero.bulge) { const e = this.hips.matrixWorld.elements, sl = Math.hypot(e[0], e[2]) || 1;
        this._axis = { x: e[12], z: e[14], sx: e[0] / sl, sz: e[2] / sl }; }
      for (let i = 0; i < C; i++) { this.pinWorld(i, v); const k = i * 3; q[k] = p[k]; q[k + 1] = p[k + 1]; q[k + 2] = p[k + 2]; p[k] = v.x; p[k + 1] = v.y; p[k + 2] = v.z; }
      for (let it = 0; it < 5; it++) {
        if (this._axis) this.clampBulge();
        for (const [a, b, L, st] of this.cons) {
          const ka = a * 3, kb = b * 3;
          const dx = p[kb] - p[ka], dy = p[kb + 1] - p[ka + 1], dz = p[kb + 2] - p[ka + 2];
          const d = Math.hypot(dx, dy, dz) || 1e-6, diff = ((d - L) / d) * 0.5 * st;
          const wa = a < C ? 0 : 1, wb = b < C ? 0 : 1, ws = wa + wb; if (!ws) continue;
          const fa = (diff * 2 * wa) / ws, fb = (diff * 2 * wb) / ws;
          p[ka] += dx * fa; p[ka + 1] += dy * fa; p[ka + 2] += dz * fa;
          p[kb] -= dx * fb; p[kb + 1] -= dy * fb; p[kb + 2] -= dz * fb;
        }
        // long-range attachment (no stretching away from the waistband)
        for (let i = C; i < N; i++) {
          const k = i * 3, kt = (i % C) * 3, dx = p[k] - p[kt], dy = p[k + 1] - p[kt + 1], dz = p[k + 2] - p[kt + 2], d = Math.hypot(dx, dy, dz), m = this.maxDist[i];
          if (d > m) { const f = m / d; p[k] = p[kt] + dx * f; p[k + 1] = p[kt + 1] + dy * f; p[k + 2] = p[kt + 2] + dz * f; }
        }
        // modest skirt: a panel may swing out but never flips above ~50° from hanging (hem stays below the knee line)
        if (!this.aero || this.cosMax > -0.5) for (let i = C; i < N; i++) {
          const k = i * 3, kt = (i % C) * 3, dx = p[k] - p[kt], dy = p[k + 1] - p[kt + 1], dz = p[k + 2] - p[kt + 2];
          const d = Math.hypot(dx, dy, dz) || 1e-6, minDrop = d * this.cosMax;
          if (-dy < minDrop) { const hz = Math.hypot(dx, dz) || 1e-6, want = Math.sqrt(Math.max(0, d * d - minDrop * minDrop)); p[k] = p[kt] + dx / hz * want; p[k + 2] = p[kt + 2] + dz / hz * want; p[k + 1] = p[kt + 1] - minDrop; }
        }
        // body capsules
        for (const [A, B, rad] of caps) {
          const bx = B.x - A.x, by = B.y - A.y, bz = B.z - A.z, bl = bx * bx + by * by + bz * bz || 1e-6;
          const rr = rad + 0.012;
          for (let i = C; i < N; i++) {
            const k = i * 3;
            let u = ((p[k] - A.x) * bx + (p[k + 1] - A.y) * by + (p[k + 2] - A.z) * bz) / bl; u = u < 0 ? 0 : u > 1 ? 1 : u;
            const cx = A.x + bx * u, cy = A.y + by * u, cz = A.z + bz * u;
            const dx = p[k] - cx, dy = p[k + 1] - cy, dz = p[k + 2] - cz, d = Math.hypot(dx, dy, dz);
            if (d < rr && d > 1e-6) { const f = rr / d; p[k] = cx + dx * f; p[k + 1] = cy + dy * f; p[k + 2] = cz + dz * f; }
          }
        }
      }
      if (groundY) for (let i = C; i < N; i++) { const k = i * 3, gy = groundY(p[k], p[k + 2]) + 0.01; if (p[k + 1] < gy) p[k + 1] = gy; }
      // the board (when carried / near her): oriented box, particles inside are pushed out through the nearest face
      const BB = this.boardBox;
      if (BB) for (let i = C; i < N; i++) {
        const k = i * 3; v.set(p[k], p[k + 1], p[k + 2]).applyMatrix4(BB.inv);
        const ex = BB.hx + 0.015 - Math.abs(v.x), ey = BB.hy + 0.02 - Math.abs(v.y), ez = BB.hz + 0.015 - Math.abs(v.z);
        if (ex > 0 && ey > 0 && ez > 0) { if (ey <= ex && ey <= ez) v.y = Math.sign(v.y || 1) * (BB.hy + 0.02); else if (ex <= ez) v.x = Math.sign(v.x || 1) * (BB.hx + 0.015); else v.z = Math.sign(v.z || 1) * (BB.hz + 0.015);
          v.applyMatrix4(BB.m); p[k] = v.x; p[k + 1] = v.y; p[k + 2] = v.z; }
      }
    }
    // write mesh (seam duplicate)
    const vp = this.vpos, vC = this.vC;
    for (let r = 0; r < R; r++) for (let c = 0; c <= C; c++) { const s = (r * C + (c % C)) * 3, d = (r * vC + c) * 3; vp[d] = p[s]; vp[d + 1] = p[s + 1]; vp[d + 2] = p[s + 2]; }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}


// ---------- straw sun hat with ribbon tails ----------
// Sized from the hair mesh at runtime so the crown sits on the hair, not inside it.
export class Hat {
  constructor(vrm, scene) {
    this.vrm = vrm;
    const head = vrm.humanoid.getNormalizedBoneNode('head');
    this.head = head;
    vrm.scene.updateMatrixWorld(true);
    const hp = head.getWorldPosition(new THREE.Vector3());
    // measure hair extent around the head (bind pose, model space == world here)
    let top = hp.y + 0.15, rad = 0.11, cz = hp.z;
    const pts = [];
    vrm.scene.traverse((o) => {
      if (!o.isMesh) return; const n = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => m.name).join();
      if (!/Hair/.test(n) || /Back/.test(n)) return;
      const p = o.geometry.attributes.position, v3 = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) { v3.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (v3.y > hp.y + 0.02) pts.push([v3.x, v3.y, v3.z]); }
    });
    if (pts.length) {
      top = Math.max(...pts.map((q) => q[1]));
      const band = pts.filter((q) => q[1] > top - 0.09 && q[1] < top - 0.05);
      cz = band.reduce((a, q) => a + q[2], 0) / (band.length || 1);
      rad = Math.max(...band.map((q) => Math.hypot(q[0] - hp.x, q[2] - cz)), 0.1);
    }
    const straw = (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
      g.fillStyle = '#efdcae'; g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 256; y += 4) { g.fillStyle = `rgba(150,115,60,${0.10 + Math.random() * 0.08})`; g.fillRect(0, y, 256, 1.4); }
      for (let x = 0; x < 256; x += 6) { g.fillStyle = 'rgba(255,248,225,0.18)'; g.fillRect(x, 0, 2, 256); }
      const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(6, 2); tx.colorSpace = THREE.SRGBColorSpace; return tx;
    })();
    const mat = new THREE.MeshStandardMaterial({ color: '#f0dfb4', map: straw, roughness: 1, metalness: 0, side: THREE.DoubleSide, emissive: '#6b5a36', emissiveIntensity: 0.35 });
    this.root = new THREE.Group();
    // crown: soft dome, brim: wide, gently drooping at the edge
    const cr = rad + 0.012, ch = 0.085;
    const crownPts = []; for (let i = 0; i <= 12; i++) { const a = i / 12; crownPts.push(new THREE.Vector2(cr * (1 - 0.12 * a * a) * Math.cos(a * a * 1.2), ch * Math.sin(a * Math.PI / 2))); }
    crownPts.push(new THREE.Vector2(0.0001, ch));
    const crown = new THREE.Mesh(new THREE.LatheGeometry(crownPts, 40), mat);
    const brimPts = []; const R0 = cr - 0.004, R1 = 0.205;
    for (let i = 0; i <= 10; i++) { const a = i / 10; brimPts.push(new THREE.Vector2(R0 + (R1 - R0) * a, -0.028 * a * a)); }
    this.brimGeo = new THREE.LatheGeometry(brimPts, 64);
    this.brimBase = this.brimGeo.attributes.position.array.slice();
    const brim = new THREE.Mesh(this.brimGeo, mat);
    const ribbonMat = new THREE.MeshLambertMaterial({ color: '#6fb3e0', emissive: '#2c5f86', emissiveIntensity: 0.55, side: THREE.DoubleSide });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(cr * 0.995, cr * 1.0, 0.024, 40, 1, true), ribbonMat); band.position.y = 0.014;
    this.root.add(crown, brim, band);
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    // place relative to head bone: crown base sits ~4.5 cm below hair top, tilted slightly back
    // place in world (model faces +z here), brim level and tipped slightly back, then attach to the head
    // facing from anatomy (robust to VRM0's 180° root): (leftLeg - rightLeg) x up
    const lL = vrm.humanoid.getNormalizedBoneNode('leftUpperLeg').getWorldPosition(new THREE.Vector3());
    const rL = vrm.humanoid.getNormalizedBoneNode('rightUpperLeg').getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3().crossVectors(lL.sub(rL), new THREE.Vector3(0, 1, 0)).normalize();
    const yaw = Math.atan2(fwd.x, fwd.z);
    scene.add(this.root);
    this.root.position.set(hp.x, top - 0.05, cz).addScaledVector(fwd, -0.006);
    this.root.rotation.set(0, yaw, 0); this.root.rotateX(-0.12);
    this.root.updateMatrixWorld(true);
    head.attach(this.root);
    // ribbon tails (two verlet strips, pinned at the back of the band)
    this.tails = [];
    for (const side of [-1, 1]) {
      const N = 26, seg = 0.019, w = 0.05;
      const pts = [], prev = [];
      const g = new THREE.BufferGeometry(); const pos = new Float32Array(N * 2 * 3), idx = [];
      for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
      const m = new THREE.Mesh(g, ribbonMat); m.frustumCulled = false; m.castShadow = true; scene.add(m);
      for (let i = 0; i < N; i++) { pts.push(new THREE.Vector3()); prev.push(new THREE.Vector3()); }
      this.tails.push({ side, N, seg, w, pts, prev, g, pos, anchorLocal: new THREE.Vector3(side * 0.025, 0.0, -cr * 1.02), inited: false });
    }
    this.tmp = new THREE.Vector3();
  }
  step(dt, air, t) {
    this.root.updateMatrixWorld(true);
    const h = Math.min(dt, 1 / 30), wind = air.length();
    // brim flutter: travelling wave around the rim, stronger with relative air speed
    const a = this.brimGeo.attributes.position, b = this.brimBase;
    const amp = Math.min(0.018, 0.002 + wind * 0.0016);
    for (let i = 0; i < a.count; i++) {
      const x = b[i * 3], y = b[i * 3 + 1], z = b[i * 3 + 2], r = Math.hypot(x, z), e = Math.max(0, (r - 0.14) / 0.065);
      a.setY(i, y + Math.sin(Math.atan2(z, x) * 3 - t * (6 + wind)) * amp * e * e);
    }
    a.needsUpdate = true;
    // Ribbon tails: procedural, not free verlet (free strips at this scale tangle into polygons).
    // Base direction lags toward a blend of gravity and downwind; a travelling wave rides along the length.
    const down = new THREE.Vector3(0, -1, 0);
    const wdir = wind > 0.05 ? air.clone().divideScalar(wind) : new THREE.Vector3();
    const k = Math.min(0.7, wind / 8);
    const want = down.clone().multiplyScalar(1 - k).addScaledVector(wdir, k * 1.15).normalize();
    const headQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    const headRight = new THREE.Vector3(1, 0, 0).applyQuaternion(headQ);
    for (const tl of this.tails) {
      const anchor = this.root.localToWorld(tl.anchorLocal.clone());
      tl.base = tl.base || want.clone();
      tl.base.lerp(want, 1 - Math.exp(-h * 3.5)).normalize();
      // wave plane: perpendicular to base, mostly along the head's left-right axis (ribbons flutter sideways)
      const perp = headRight.clone().addScaledVector(tl.base, -headRight.dot(tl.base)); if (perp.lengthSq() < 1e-4) perp.set(0, 0, 1); perp.normalize();
      const perp2 = new THREE.Vector3().crossVectors(tl.base, perp).normalize();
      const amp = 0.35 + Math.min(0.5, wind * 0.06);
      const f = 6 + wind * 1.2;
      const P = anchor.clone();
      for (let i = 0; i < tl.N; i++) {
        tl.pts[i].copy(P);
        const u = i / (tl.N - 1);
        const ph = t * f - i * 0.32 + tl.side * 1.3;
        const d = tl.base.clone()
          .addScaledVector(perp, Math.sin(ph) * amp * u + tl.side * 0.12)
          .addScaledVector(perp2, Math.cos(ph * 0.8) * amp * 0.45 * u).normalize();
        P.addScaledVector(d, tl.seg);
      }
      for (let pass = 0; pass < 2; pass++) for (let i = 1; i < tl.N - 1; i++) tl.pts[i].lerp(tl.pts[i - 1].clone().add(tl.pts[i + 1]).multiplyScalar(0.5), 0.5);
      // width frame: twist slowly along the ribbon, starting flat against the head's side
      for (let i = 0; i < tl.N; i++) {
        const Pi = tl.pts[i], dir = (i < tl.N - 1 ? tl.pts[i + 1].clone().sub(Pi) : Pi.clone().sub(tl.pts[i - 1])).normalize();
        const refv = Math.abs(dir.y) < 0.6 ? new THREE.Vector3(0, 1, 0).cross(dir) : perp2.clone();
        const side = refv.addScaledVector(dir, -refv.dot(dir)); if (side.lengthSq() < 1e-5) side.copy(perp); side.normalize();
        side.applyAxisAngle(dir, Math.sin(t * 4 + i * 0.5 + tl.side) * 0.5 * (i / tl.N));
        const wv = tl.w * 0.5 * (1 - 0.35 * i / tl.N);
        const notch = i === tl.N - 1 ? 0.012 : 0; // swallow-tail cut at the end
        tl.pos.set([Pi.x + side.x * wv + dir.x * notch, Pi.y + side.y * wv + dir.y * notch, Pi.z + side.z * wv + dir.z * notch,
                    Pi.x - side.x * wv + dir.x * notch, Pi.y - side.y * wv + dir.y * notch, Pi.z - side.z * wv + dir.z * notch], i * 6);
      }
      tl.g.attributes.position.needsUpdate = true; tl.g.computeVertexNormals();
    }
  }
}

// ---------- wrist guards (护手板): pale grey palm/back plates + two velcro straps on each forearm/hand ----------
export function addWristGuards(vrm) {
  const H = vrm.humanoid, mat = new THREE.MeshStandardMaterial({ color: '#e9ecef', roughness: 0.75 }), strap = new THREE.MeshStandardMaterial({ color: '#6fb6c9', roughness: 0.8 }), plate = new THREE.MeshStandardMaterial({ color: '#cfd6dc', roughness: 0.4, metalness: 0.1 });
  vrm.scene.updateMatrixWorld(true);
  for (const side of ['left', 'right']) {
    const la = H.getNormalizedBoneNode(side + 'LowerArm'), hd = H.getNormalizedBoneNode(side + 'Hand');
    const raw = H.getRawBoneNode(side + 'Hand'), rawLa = H.getRawBoneNode(side + 'LowerArm');
    const a = rawLa.getWorldPosition(new THREE.Vector3()), h = raw.getWorldPosition(new THREE.Vector3());
    const len = a.distanceTo(h);
    // sleeve: tapered tube over the distal 45% of the forearm, built along the forearm axis in the raw bone's frame
    const g = new THREE.Group(); rawLa.add(g);
    const axisW = h.clone().sub(a).normalize(), inv = rawLa.getWorldQuaternion(new THREE.Quaternion()).invert(), axL = axisW.clone().applyQuaternion(inv);
    const qAlign = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axL);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.029, len * 0.46, 14, 1, true), mat); tube.material.side = THREE.DoubleSide;
    tube.quaternion.copy(qAlign); tube.position.copy(axL.clone().multiplyScalar(len * 0.74)); g.add(tube);
    for (const f of [0.6, 0.88]) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0335, 0.0335, 0.016, 14, 1, true), strap); s.material.side = THREE.DoubleSide; s.quaternion.copy(qAlign); s.position.copy(axL.clone().multiplyScalar(len * f)); g.add(s); }
    // palm plate on the hand
    const hg = new THREE.Group(); raw.add(hg);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.016, 0.06), mat); hand.position.set(0, 0, 0); hg.add(hand);
    const pl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.006, 0.07), plate); pl.position.set(0, -0.012, 0); hg.add(pl);
    // orient hand pad along the hand bone direction (towards middle finger)
    const mid = H.getRawBoneNode(side + 'MiddleProximal');
    if (mid) { const mp = mid.getWorldPosition(new THREE.Vector3()).applyMatrix4(raw.matrixWorld.clone().invert()); const dir = mp.clone().normalize(); hg.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir); hg.position.copy(mp.multiplyScalar(0.45)); }
    [g, hg].forEach((o) => o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } }));
  }
}
