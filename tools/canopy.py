"""Real tree crowns + low scrub for the Bondi environment bake (run rarely; env.py only reads the derived file).

    GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR tools/cache/.venv/bin/python tools/canopy.py

Sources (licences in docs/data-sources.md):
  * Meta / WRI "High Resolution Canopy Height Maps" v1 (Tolan et al. 2024), 1.2 m CHM tile 311230133 on the public
    bucket s3://dataforgood-fb-data/forests/v1/alsgedi_global_v6_float/chm/ — CC BY 4.0. Window range-read, cached in
    tools/cache/osm/chm_window.npz.
  * data/buildings.json (tools/buildings.py: OSM + Microsoft footprints) — the CHM reads roofs as 'canopy', so every
    footprint (+1 m) is masked out before crowns are detected.
  * OSM natural=tree nodes (tools/cache/osm/raw.json): mapped trees are kept as crowns where the CHM has none nearby;
    leaf_type=needleleaved marks Norfolk Island pines; nodes in straight planted rows are flagged (pine rows).
  * OSM leisure=park/garden polygons: broad crowns of big canopy clusters inside parks are flagged as figs.
Dense canopy: connected components of the smoothed CHM >= 3.5 m; in clusters >= 250 m2 crowns get longer radius rays
and a floor of 0.42 x height; uncovered canopy of clusters >= 150 m2 is filled with extra crowns (largest gap first).
Output data/canopy.json (derived; read by tools/env.py, NOT by the browser):
  crowns  flat [x, y, h, r, f] * n   route metres (x east, y north) in dm ints; h = top height dm, r = crown radius dm,
          f = flags (1 = OSM tree node, 2 = OSM needleleaved, 4 = gap-fill crown inside a dense canopy cluster,
          8 = OSM tree in a planted row, 16 = broad crown in a big park canopy cluster -> fig in env.py)
  low     {x0, y0, step, nx, ny, b64}: 2 m grid (row-major j*nx+i, j north), zlib+base64, 1 byte per cell =
          fraction (0..255) of 1 m pixels with vegetation 0.7-3.5 m tall (heath / scrub / hedges), roofs masked
  tall    same grid, fraction of pixels >= 3.5 m (tree canopy cover)
"""
import json, math, os, zlib, base64
import numpy as np
from scipy import ndimage
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
C = f'{ROOT}/tools/cache/osm'
R = json.load(open(f'{ROOT}/data/route.json')); T = R['terrain']; NX, NY, ST, X0, Y0 = T['nx'], T['ny'], T['step'], T['x0'], T['y0']
lat0, lon0 = R['start']; KX = 111320 * math.cos(math.radians(lat0)); KY = 110540
B = (151.2600, -33.9090, 151.2830, -33.8850)
f_chm = f'{C}/chm_window.npz'
if not os.path.exists(f_chm):
    import rasterio
    from rasterio.windows import from_bounds
    from rasterio.warp import transform_bounds
    with rasterio.open('/vsicurl/https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/311230133.tif') as ds:
        w = from_bounds(*transform_bounds('EPSG:4326', ds.crs, *B), ds.transform).round_offsets().round_lengths()
        np.savez_compressed(f_chm, a=ds.read(1, window=w), tf=np.array(list(ds.window_transform(w))[:6]), crs=str(ds.crs))
z = np.load(f_chm); CH, tf = z['a'].astype(np.float32), z['tf']; RE = 6378137.0

# ---------------- resample the CHM onto a 1 m local grid (route projection) ----------------
gx0, gy0 = X0, Y0; GW, GH = int((NX - 1) * ST), int((NY - 1) * ST)
ys, xs = np.mgrid[0:GH, 0:GW].astype(np.float64)
lon = lon0 + (gx0 + xs + 0.5) / KX; lat = lat0 + (gy0 + ys + 0.5) / KY
mx = np.radians(lon) * RE; my = RE * np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))
col = (mx - tf[2]) / tf[0] - 0.5; row = (my - tf[5]) / tf[4] - 0.5
G = ndimage.map_coordinates(CH, [row, col], order=1, mode='constant', cval=0).astype(np.float32)   # G[j, i], j north
del xs, ys, lon, lat, mx, my, col, row
print('CHM 1 m grid', G.shape, 'pixels >= 3.5 m: %.1f %%' % (100 * (G >= 3.5).mean()))

# ---------------- mask building footprints (+1 m) ----------------
D = json.load(open(f'{ROOT}/data/buildings.json'))
im = Image.new('L', (GW, GH), 0); dr = ImageDraw.Draw(im); o = 0
for n in D['n']:
    x = y = 0; P = []
    for i in range(n): x += D['xy'][(o + i) * 2]; y += D['xy'][(o + i) * 2 + 1]; P.append((x / 10 - gx0, y / 10 - gy0))
    o += n; dr.polygon(P, fill=1)
BM = ndimage.binary_dilation(np.asarray(im, bool), iterations=1)
G[BM] = 0
print('masked roofs: %.1f %% of the grid' % (100 * BM.mean()))

# ---------------- crowns: local maxima of the smoothed CHM, suppressed by a height-dependent crown radius ----------------
S = ndimage.gaussian_filter(G, 1.2)
# connected canopy clusters (smoothed CHM >= 3.5 m): big clusters = park figs / gully woodland whose 1 m CHM shows one
# flat-topped mass, where local maxima under-detect crowns and the 9 m ray cap under-sizes them
CL, ncl = ndimage.label(S >= 3.5)
CLA = ndimage.sum(np.ones_like(S), CL, np.arange(1, ncl + 1))           # component area (m2), index = label - 1
def cl_area(j, i): k = CL[j, i]; return float(CLA[k - 1]) if k else 0.0
# OSM parks / reserves (broad-crowned figs live there; ODbL)
E = json.load(open(f'{C}/raw.json'))['elements']
pk = Image.new('L', (GW, GH), 0); dp = ImageDraw.Draw(pk)
for e in E:
    t = e.get('tags', {})
    if e['type'] == 'way' and e.get('geometry') and (t.get('leisure') in ('park', 'garden') or t.get('landuse') == 'recreation_ground'):
        dp.polygon([((q['lon'] - lon0) * KX - gx0, (q['lat'] - lat0) * KY - gy0) for q in e['geometry']], fill=1)
PK = np.asarray(pk, bool)
peak = (S == ndimage.maximum_filter(S, size=5)) & (S >= 3.2)
pj, pi = np.nonzero(peak); hv = G[pj, pi].copy(); hv = np.maximum(hv, S[pj, pi])
order = np.argsort(-hv); taken = np.zeros(G.shape, bool); crowns = []
for k in order:
    j, i, h = pj[k], pi[k], float(hv[k])
    if taken[j, i]: continue
    big = cl_area(j, i) >= 250
    r = float(np.clip(0.26 * h + 0.9, 1.6, 7.0))
    # crown radius from the canopy itself: mean distance where the CHM stays above half the top height (8 rays;
    # longer rays inside big clusters)
    rr = []; cap = 14 if big else 9
    for a in range(8):
        ca, sa = math.cos(a * math.pi / 4), math.sin(a * math.pi / 4); d = 1
        while d < cap and 0 <= j + int(round(sa * d)) < G.shape[0] and 0 <= i + int(round(ca * d)) < G.shape[1] and G[j + int(round(sa * d)), i + int(round(ca * d))] > 0.5 * h: d += 1
        rr.append(d)
    r = float(np.clip(0.5 * r + 0.5 * np.mean(rr), 1.4, 9.5 if big else 7.5))
    if big: r = max(r, float(np.clip(0.42 * h, 2.5, 8.0)))      # dense masses: crowns touch (figs ~0.5 x height wide)
    s = int(math.ceil(r * 0.85)); taken[max(0, j - s):j + s + 1, max(0, i - s):i + s + 1] |= \
        (np.hypot(*np.mgrid[max(0, j - s) - j:min(G.shape[0], j + s + 1) - j, max(0, i - s) - i:min(G.shape[1], i + s + 1) - i]) <= r * 0.85)
    fl = (16 if big and PK[j, i] and h >= 7 else 0)
    crowns.append([gx0 + i + 0.5, gy0 + j + 0.5, h, r, fl])
n_peak = len(crowns)
# gap fill: canopy pixels of big clusters (>= 150 m2) not under any crown disc get extra crowns, largest gap first
cover = np.zeros(G.shape, bool); yy, xx = np.mgrid[0:G.shape[0], 0:G.shape[1]]
def disc(mask, cx, cy, r):
    j0, j1, i0, i1 = max(0, int(cy - r) - 1), min(G.shape[0], int(cy + r) + 2), max(0, int(cx - r) - 1), min(G.shape[1], int(cx + r) + 2)
    mask[j0:j1, i0:i1] |= (xx[j0:j1, i0:i1] + 0.5 - cx) ** 2 + (yy[j0:j1, i0:i1] + 0.5 - cy) ** 2 <= r * r
for c in crowns: disc(cover, c[0] - gx0, c[1] - gy0, c[3])
want = (S >= 3.5) & (CLA[np.maximum(CL - 1, 0)] >= 150) & (CL > 0)
n_fill = 0
for it in range(12):     # batched: one distance transform per pass, then greedy non-overlapping picks from it
    gap = want & ~cover
    if not gap.any(): break
    dt = ndimage.distance_transform_edt(gap)
    cand = (dt >= 1.8) & (dt == ndimage.maximum_filter(dt, size=5))
    cj, ci = np.nonzero(cand)
    if not len(cj): break
    o = np.argsort(-dt[cj, ci]); added = 0
    for k in o:
        j, i = cj[k], ci[k]
        if cover[j, i]: continue
        d = float(dt[j, i]); r = float(min(d * 1.15, 7.0)); h = float(G[max(0, j - 2):j + 3, max(0, i - 2):i + 3].max())
        if h < 3.5: continue
        big = cl_area(j, i) >= 250
        crowns.append([gx0 + i + 0.5, gy0 + j + 0.5, h, max(r, 1.6), 4 | (16 if big and PK[j, i] and h >= 7 else 0)])
        disc(cover, i + 0.5, j + 0.5, r); n_fill += 1; added += 1
    if not added: break
print('CHM crowns', n_peak, '+ gap-fill', n_fill, ' canopy clusters >= 250 m2:', int((CLA >= 250).sum()),
      ' cover of cluster canopy by crown discs: %.0f %%' % (100 * (want & cover).sum() / max(1, want.sum())))
# OSM tree nodes: keep their position/species hint; add a crown where the CHM found none within 3 m
n_osm = n_pine = 0
cg = {}
for c in crowns: cg.setdefault((int(c[0] // 4), int(c[1] // 4)), []).append(c)
TN = []
for e in E:
    t = e.get('tags', {})
    if e['type'] == 'node' and t.get('natural') == 'tree': TN.append(((e['lon'] - lon0) * KX, (e['lat'] - lat0) * KY, t))
# planted rows (Norfolk Island pines along Campbell Pde / the park edges): an OSM tree with >= 2 OSM neighbours within
# 16 m that lie on one line (PCA linearity) -> flag 8
TA = np.array([[x, y] for x, y, _ in TN]) if TN else np.zeros((0, 2))
def is_row(k):
    d = np.hypot(*(TA - TA[k]).T); nb = TA[(d > 0.5) & (d < 16)]
    if len(nb) < 2: return False
    P = np.vstack([nb, TA[k]]) - np.vstack([nb, TA[k]]).mean(0); ev = np.linalg.eigvalsh(P.T @ P)
    return ev[0] < 0.08 * ev[1]
n_row = 0
for k, (x, y, t) in enumerate(TN):
    if not (gx0 + 2 < x < gx0 + GW - 2 and gy0 + 2 < y < gy0 + GH - 2): continue
    fl = 1 | (2 if t.get('leaf_type') == 'needleleaved' else 0) | (8 if is_row(k) else 0); n_pine += (fl >> 1) & 1; n_row += (fl >> 3) & 1
    best = None
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            for c in cg.get((int(x // 4) + di, int(y // 4) + dj), ()):
                d = math.hypot(c[0] - x, c[1] - y)
                if d < 3.5 and (best is None or d < best[0]): best = (d, c)
    if best: best[1][4] |= fl; continue
    j, i = int(y - gy0), int(x - gx0); h = float(G[max(0, j - 2):j + 3, max(0, i - 2):i + 3].max())
    if BM[j, i]: continue
    h = max(h, 6.0); crowns.append([x, y, h, float(np.clip(0.26 * h + 0.9, 1.6, 6)), fl]); n_osm += 1
print('OSM tree nodes added (no CHM crown within 3.5 m):', n_osm, ' needleleaved nodes:', n_pine, ' in planted rows:', n_row)
print('broad park crowns (flag 16):', sum(1 for c in crowns if c[4] & 16))

# ---------------- low scrub / tall cover fractions on a 2 m grid ----------------
st = 2; LW, LH = GW // st, GH // st
Gc = G[:LH * st, :LW * st].reshape(LH, st, LW, st)
low = ((Gc >= 0.7) & (Gc < 3.5)).mean((1, 3)); tall = (Gc >= 3.5).mean((1, 3))
q8 = lambda F: np.clip(np.round(F * 255), 0, 255).astype(np.uint8)
crowns.sort(key=lambda c: (round(c[1], 1), round(c[0], 1)))
out = {'note': 'derived by tools/canopy.py from the Meta/WRI 1 m Canopy Height Map (CC BY 4.0), roofs masked with '
               'data/buildings.json, plus OSM natural=tree nodes (ODbL); see docs/data-sources.md',
       'crowns': [v for c in crowns for v in (round(c[0] * 10), round(c[1] * 10), round(c[2] * 10), round(c[3] * 10), int(c[4]))],
       'low': {'x0': gx0, 'y0': gy0, 'step': st, 'nx': LW, 'ny': LH, 'b64': base64.b64encode(zlib.compress(q8(low).tobytes(), 9)).decode()},
       'tall': {'b64': base64.b64encode(zlib.compress(q8(tall).tobytes(), 9)).decode()}}
json.dump(out, open(f'{ROOT}/data/canopy.json', 'w'), separators=(',', ':'))
H = np.array([c[2] for c in crowns])
print('crowns total', len(crowns), 'height p10/50/90 %.1f/%.1f/%.1f m' % tuple(np.percentile(H, [10, 50, 90])), '>=14 m:', int((H >= 14).sum()))
print('low-scrub cells (>=40 %%): %d of %d' % ((low >= 0.4).sum(), low.size))
print('wrote data/canopy.json', os.path.getsize(f'{ROOT}/data/canopy.json') // 1024, 'KB')
