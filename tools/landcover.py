"""Open land-cover inputs for the Bondi environment bake (run rarely; env.py only reads the derived file).

    cd ~/code/skate-walk/tools/cache && uv venv .venv && uv pip install --python .venv/bin/python rasterio numpy scipy pillow
    GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR tools/cache/.venv/bin/python tools/landcover.py

Sources (licences in docs/data-sources.md):
  * ESA WorldCover 10 m 2021 v200, tile S36E150 (COG on the public AWS bucket esa-worldcover) — CC BY 4.0
  * Sentinel-2 L2A true colour (TCI, 10 m) via Element84 earth-search STAC (collection sentinel-2-c1-l2a), every
    scene Oct 2024 .. Mar 2025 with < 1 % cloud over the tile; per-pixel MEDIAN = cloud/wave-free composite —
    Copernicus Sentinel data, free & open (attribution "Contains modified Copernicus Sentinel data 2024-2025")
Only a window around the route bbox is range-read; raw windows are cached in tools/cache/ (gitignored).

Output data/landcover.json (derived, compact; read by tools/env.py, NOT by the browser):
  per terrain vertex (same 8 m grid / order as route.terrain: row-major j*nx+i, j north), zlib+base64 of 6 bytes:
    0..3  WorldCover class fractions in a ~12 m radius, 0..255: tree(10), shrub(20)+herb wetland(90), grass(30)+crop(40),
          built(50)  (bare(60) = remainder of land, water(80) separately below)
    4     bare(60) fraction 0..255           5     water(80) fraction 0..255
  plus s2.b64 (zlib+base64): 3 bytes per vertex = median S2 true colour (sRGB 0..255), gaussian-smoothed sigma 1 px.
"""
import json, math, os, zlib, base64
import numpy as np, rasterio
from rasterio.windows import from_bounds
from rasterio.warp import transform_bounds, transform as warp_xy
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = f'{ROOT}/tools/cache'; os.makedirs(CACHE, exist_ok=True)
R = json.load(open(f'{ROOT}/data/route.json')); T = R['terrain']; NX, NY, ST, X0, Y0 = T['nx'], T['ny'], T['step'], T['x0'], T['y0']
lat0, lon0 = R['start']; kx = 111320 * math.cos(math.radians(lat0)); ky = 110540
LON = np.array([[lon0 + (X0 + i * ST) / kx for i in range(NX)] for j in range(NY)])
LAT = np.array([[lat0 + (Y0 + j * ST) / ky for i in range(NX)] for j in range(NY)])
B = (LON.min() - 0.001, LAT.min() - 0.001, LON.max() + 0.001, LAT.max() + 0.001)
print('bbox', [round(v, 5) for v in B])

# ---------------- ESA WorldCover ----------------
WC_URL = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_S36E150_Map.tif'
f_wc = f'{CACHE}/worldcover_window.npz'
if not os.path.exists(f_wc):
    with rasterio.open('/vsicurl/' + WC_URL) as ds:
        w = from_bounds(*B, ds.transform).round_offsets().round_lengths()
        np.savez_compressed(f_wc, a=ds.read(1, window=w), tf=np.array(list(ds.window_transform(w))[:6]))
z = np.load(f_wc); WC, wtf = z['a'], z['tf']
# fractions within ~12 m: per class mask -> gaussian (sigma 0.8 px = 8 m) -> sample bilinear at the vertex
def frac(mask):
    return ndimage.gaussian_filter(mask.astype(np.float32), 0.8, mode='nearest')
col = (LON - wtf[2]) / wtf[0] - 0.5; row = (LAT - wtf[5]) / wtf[4] - 0.5
def samp(F, row, col): return ndimage.map_coordinates(F, [row.ravel(), col.ravel()], order=1, mode='nearest').reshape(row.shape)
FR = {k: samp(frac(np.isin(WC, v)), row, col) for k, v in
      {'tree': [10, 95], 'shrub': [20, 90], 'grass': [30, 40, 100], 'built': [50], 'bare': [60, 70], 'water': [80]}.items()}
print('WorldCover classes in window', dict(zip(*[x.tolist() for x in np.unique(WC, return_counts=True)])))

# ---------------- Sentinel-2 L2A median true colour ----------------
f_s2 = f'{CACHE}/s2_median_window.npz'
if not os.path.exists(f_s2):
    import urllib.request
    q = {'collections': ['sentinel-2-c1-l2a'], 'bbox': list(B), 'datetime': '2024-10-01T00:00:00Z/2025-03-31T23:59:59Z',
         'query': {'eo:cloud_cover': {'lt': 1}}, 'limit': 40}
    req = urllib.request.Request('https://earth-search.aws.element84.com/v1/search', json.dumps(q).encode(), {'Content-Type': 'application/json'})
    feats = sorted(json.load(urllib.request.urlopen(req, timeout=60))['features'], key=lambda f: f['id'])
    stack, ids = [], []
    for f in feats:
        with rasterio.open('/vsicurl/' + f['assets']['visual']['href']) as ds:
            w = from_bounds(*transform_bounds('EPSG:4326', ds.crs, *B), ds.transform).round_offsets().round_lengths()
            a = ds.read(window=w); tf = list(ds.window_transform(w))[:6]; crs = str(ds.crs)
        if stack and a.shape != stack[0].shape: continue
        stack.append(a); ids.append(f['id']); print('  S2', f['id'], f['properties']['eo:cloud_cover'])
    np.savez_compressed(f_s2, a=np.median(np.stack(stack), 0).astype(np.uint8), tf=np.array(tf), crs=crs, ids=np.array(ids))
z = np.load(f_s2); S2, stf, scrs = z['a'], z['tf'], str(z['crs'])
print('S2 composite of', len(z['ids']), 'scenes:', ', '.join(str(i)[4:21] for i in z['ids']))
ex, ny_ = warp_xy('EPSG:4326', scrs, LON.ravel().tolist(), LAT.ravel().tolist())
scol = ((np.array(ex) - stf[2]) / stf[0] - 0.5).reshape(LON.shape); srow = ((np.array(ny_) - stf[5]) / stf[4] - 0.5).reshape(LON.shape)
RGB = [samp(ndimage.gaussian_filter(S2[c].astype(np.float32), 1.0, mode='nearest'), srow, scol) for c in range(3)]

# ---------------- write (grid order j*nx+i, j north = row 0 is the SOUTH edge) ----------------
q8 = lambda F: np.clip(np.round(F * 255), 0, 255).astype(np.uint8)
lc = np.stack([q8(FR['tree']), q8(FR['shrub']), q8(FR['grass']), q8(FR['built']), q8(FR['bare']), q8(FR['water'])], -1)
s2 = np.stack([np.clip(np.round(c), 0, 255).astype(np.uint8) for c in RGB], -1)
out = {'note': 'derived by tools/landcover.py from ESA WorldCover 2021 v200 (CC BY 4.0) and Copernicus Sentinel-2 L2A '
               '(contains modified Copernicus Sentinel data 2024-2025); see docs/data-sources.md',
       'nx': NX, 'ny': NY, 'fields': ['tree', 'shrub', 'grass', 'built', 'bare', 'water'], 's2_scenes': [str(i) for i in z['ids']],
       'lc': base64.b64encode(zlib.compress(lc.tobytes(), 9)).decode(), 's2': base64.b64encode(zlib.compress(s2.tobytes(), 9)).decode()}
json.dump(out, open(f'{ROOT}/data/landcover.json', 'w'), separators=(',', ':'))
print('wrote data/landcover.json', os.path.getsize(f'{ROOT}/data/landcover.json') // 1024, 'KB')
try:
    from PIL import Image
    Image.fromarray(s2[::-1]).resize((NX * 3, NY * 3), Image.NEAREST).save(f'{CACHE}/s2_grid.png')
    pal = {0: (60, 120, 40), 1: (150, 170, 60), 2: (140, 210, 90), 3: (200, 60, 50), 4: (190, 180, 160), 5: (40, 90, 200)}
    am = np.argmax(lc, -1); img = np.zeros((NY, NX, 3), np.uint8)
    for k, c in pal.items(): img[am == k] = c
    Image.fromarray(img[::-1]).resize((NX * 3, NY * 3), Image.NEAREST).save(f'{CACHE}/wc_grid.png')
except ImportError: pass
