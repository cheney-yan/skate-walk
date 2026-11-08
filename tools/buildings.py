"""Bake every building footprint near the Bondi -> Bronte route into data/buildings.json (offline, deterministic).

    cd ~/code/skate-walk && python3 tools/buildings.py          # stdlib only; reads the cached raw downloads below

Inputs (raw downloads cached in tools/cache/osm/, gitignored; fetch commands in docs/data-sources.md):
  * raw.json     OSM Overpass dump of the bbox (-33.9075,151.2625,-33.8865,151.2815): building=* ways with tags
                 (height, building:levels, roof:shape ...), plus natural/landuse/leisure polygons (beach, park, rock).
  * ms_bbox.json Microsoft Global ML Building Footprints (quadkey 311230133, release 2026-02-03), cut to the same bbox.
OSM wins; a Microsoft footprint is added only where OSM has no building (>= 25 % of its area not already covered)
and it is not on a beach / in the sea / on rock platforms (ML false positives on bright sand at Bondi).

Heights: OSM height, else building:levels * 3.0 m + 1 m, else a deterministic estimate from footprint area and type
(houses 1-2 storeys 5.5-8 m, apartment blocks 3-6 storeys by size, sheds/garages 3 m). Roofs: small, nearly rectangular
houses get a hipped roof (oriented bounding box, 23 deg pitch, ridge along the long side); everything else is flat.
The road stays clear: every footprint is kept >= ROAD_HW + 0.6 m from the browser's smoothed track centre line
(vertices pushed out; a building the path runs through is dropped).

Output data/buildings.json (positions in decimetres, local metres x east / y north, same projection as route.json):
  n     vertex count per building (ring, not closed)
  xy    flat int list, per building: first vertex absolute (dm), then deltas (dm)
  z     per building [base, top] in dm (base = lowest ground under the footprint minus a sink; top = wall top)
  roof  per building 0 flat | 1 hipped
  hip   per hipped building [cx, cy (dm), angle (mrad, long axis from +x), L, W (dm), ridge rise (dm)]
  t     per building tint 0..99 (palette choice + slight variation), src 0 OSM | 1 Microsoft
"""
import json, math, os, random, base64, hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
C = f'{ROOT}/tools/cache/osm'
R = json.load(open(f'{ROOT}/data/route.json'))
T = R['terrain']; NX, NY, ST, X0, Y0 = T['nx'], T['ny'], T['step'], T['x0'], T['y0']
H = [v / 10 for v in T['h']]
SH = base64.b64decode(R['shore']['b64'])
lat0, lon0 = R['start']; KX = 111320 * math.cos(math.radians(lat0)); KY = 110540
XY = lambda lat, lon: ((lon - lon0) * KX, (lat - lat0) * KY)
clamp = lambda x, a, b: max(a, min(b, x))
ROAD_HW, CLEAR = 1.6, 0.6

# ---------------- browser track (same port as tools/env.py route_track) ----------------
def terrain_fn(h):
    def f(x, y):
        fi, fj = (x - X0) / ST, (y - Y0) / ST
        i = max(0, min(NX - 2, math.floor(fi))); j = max(0, min(NY - 2, math.floor(fj)))
        u = min(1, max(0, fi - i)); v = min(1, max(0, fj - j))
        g = lambda ii, jj: max(-4, h[jj * NX + ii])
        return g(i, j) * (1 - u) * (1 - v) + g(i + 1, j) * u * (1 - v) + g(i, j + 1) * (1 - u) * v + g(i + 1, j + 1) * u * v
    return f
tH = terrain_fn(H)
def route_track():
    P, L = R['pts'], R['length']; k = 0; D = []; s = 0.0
    while s <= L:
        while k < len(P) - 2 and P[k + 1]['s'] < s: k += 1
        a, b = P[k], P[k + 1]; u = clamp((s - a['s']) / (b['s'] - a['s']), 0, 1) if b['s'] > a['s'] else 0
        x, y, e = a['x'] + (b['x'] - a['x']) * u, a['y'] + (b['y'] - a['y']) * u, a['e'] + (b['e'] - a['e']) * u
        D.append([x, -y, max(e, tH(x, y)) + 0.08]); s += 0.5
    def blur(ci, r, passes):
        for _ in range(passes):
            src = [d[ci] for d in D]; n = len(D)
            for i in range(n):
                lo, hi = max(0, i - r), min(n - 1, i + r); D[i][ci] = sum(src[lo:hi + 1]) / (hi - lo + 1)
    blur(0, 8, 3); blur(1, 8, 3); blur(2, 16, 3)
    cum = [0.0]
    for i in range(1, len(D)): cum.append(cum[-1] + math.hypot(D[i][0] - D[i - 1][0], D[i][1] - D[i - 1][1]))
    total = cum[-1]; pts = []; k = 0; s = 0.0
    while s <= total:
        while k < len(D) - 2 and cum[k + 1] < s: k += 1
        u = (s - cum[k]) / ((cum[k + 1] - cum[k]) or 1); a, b = D[k], D[k + 1]
        pts.append((a[0] + (b[0] - a[0]) * u, -(a[1] + (b[1] - a[1]) * u))); s += 0.25
    return pts
TP = route_track()
PH = {}
for p in TP: PH.setdefault((math.floor(p[0] / 6), math.floor(p[1] / 6)), []).append(p)
def path_near(x, y, rad=12):
    """nearest track point (route coords) -> (dist, (px, py))"""
    best, bp = 1e18, None; r = int(rad // 6) + 1; ci, cj = math.floor(x / 6), math.floor(y / 6)
    for di in range(-r, r + 1):
        for dj in range(-r, r + 1):
            for p in PH.get((ci + di, cj + dj), ()):
                d = (p[0] - x) ** 2 + (p[1] - y) ** 2
                if d < best: best, bp = d, p
    return (math.sqrt(best), bp) if bp else (1e9, None)

# ---------------- geometry helpers ----------------
def area(P):
    return 0.5 * sum(P[i][0] * P[(i + 1) % len(P)][1] - P[(i + 1) % len(P)][0] * P[i][1] for i in range(len(P)))
def contains(P, x, y):
    c = False; n = len(P); j = n - 1
    for i in range(n):
        if (P[i][1] > y) != (P[j][1] > y) and x < (P[j][0] - P[i][0]) * (y - P[i][1]) / ((P[j][1] - P[i][1]) or 1e-9) + P[i][0]: c = not c
        j = i
    return c
def bbox(P): xs = [p[0] for p in P]; ys = [p[1] for p in P]; return (min(xs), max(xs), min(ys), max(ys))
def simplify(P, eps=0.35):
    """Douglas-Peucker on a closed ring (keeps the two farthest-apart vertices as anchors)"""
    if len(P) <= 4: return P
    def dp(pts):
        if len(pts) < 3: return pts
        (x1, y1), (x2, y2) = pts[0], pts[-1]; ex, ey = x2 - x1, y2 - y1; L = math.hypot(ex, ey) or 1e-9
        dm, im = -1, 0
        for i in range(1, len(pts) - 1):
            d = abs((pts[i][0] - x1) * ey - (pts[i][1] - y1) * ex) / L
            if d > dm: dm, im = d, i
        return dp(pts[:im + 1])[:-1] + dp(pts[im:]) if dm > eps else [pts[0], pts[-1]]
    k = max(range(len(P)), key=lambda i: (P[i][0] - P[0][0]) ** 2 + (P[i][1] - P[0][1]) ** 2)
    a = dp(P[:k + 1]); b = dp(P[k:] + [P[0]])
    out = a[:-1] + b[:-1]
    return out if len(out) >= 3 else P
def obb(P):
    """minimum-area oriented rectangle over the polygon edges' directions -> (cx, cy, ang, L, W)"""
    best = None
    for i in range(len(P)):
        (x1, y1), (x2, y2) = P[i], P[(i + 1) % len(P)]; a = math.atan2(y2 - y1, x2 - x1); c, s = math.cos(a), math.sin(a)
        us = [x * c + y * s for x, y in P]; vs = [-x * s + y * c for x, y in P]
        A = (max(us) - min(us)) * (max(vs) - min(vs))
        if best is None or A < best[0]: best = (A, a, min(us), max(us), min(vs), max(vs))
    A, a, u0, u1, v0, v1 = best; c, s = math.cos(a), math.sin(a); uc, vc = (u0 + u1) / 2, (v0 + v1) / 2
    L, W = u1 - u0, v1 - v0
    if W > L: L, W, a = W, L, a + math.pi / 2
    a = (a + math.pi / 2) % math.pi - math.pi / 2
    return uc * c - vc * s, uc * s + vc * c, a, L, W, A
def rawv(x, y):       # coarse ground mesh height (lab.js rawH: sea shelf, clamp -4, low land sunk 2.5 m), bilinear
    HS = lambda k: min(H[k], (-10 - min(SH[k] / 4, 60) * 2.5) / 10) if SH[k] else H[k]
    fi, fj = (x - X0) / ST, (y - Y0) / ST; i = max(0, min(NX - 2, math.floor(fi))); j = max(0, min(NY - 2, math.floor(fj)))
    u, v = clamp(fi - i, 0, 1), clamp(fj - j, 0, 1)
    def g(ii, jj):
        h = max(-4, HS(jj * NX + ii)); return h - 2.5 if h < 1.3 else h
    return g(i, j) * (1 - u) * (1 - v) + g(i + 1, j) * u * (1 - v) + g(i, j + 1) * (1 - u) * v + g(i + 1, j + 1) * u * v
# fine road-corridor ground (env.json 'corridor', baked by tools/env.py; independent of buildings): near the road the
# drawn ground is cut below the road, so a building there must reach down to that ground, not the coarse surface
FH = {}; CELLS = set(); FS = 8
try:
    _C = json.load(open(f'{ROOT}/data/env.json'))['corridor']; FS = _C['fs']
    _raw = base64.b64decode(_C['dcm']); _dc = [int.from_bytes(_raw[2 * k:2 * k + 2], 'little', signed=True) for k in range(len(_raw) // 2)]
    _n = 0
    for ck in _C['cells']:
        i, j = ck % (NX - 1), ck // (NX - 1); CELLS.add((i, j))
        for b_ in range(FS + 1):
            for a_ in range(FS + 1):
                key = (i * FS + a_, j * FS + b_)
                if key not in FH: FH[key] = rawv(X0 + key[0] * ST / FS, Y0 + key[1] * ST / FS) + _dc[_n] / 100; _n += 1
except (FileNotFoundError, KeyError): pass
def ground(x, y):
    fi, fj = (x - X0) / ST, (y - Y0) / ST; i, j = math.floor(fi), math.floor(fj)
    if (i, j) not in CELLS: return rawv(x, y)
    gi, gj = fi * FS, fj * FS; I, J = math.floor(gi), math.floor(gj); u, v = gi - I, gj - J
    g = lambda a, b: FH.get((I + a, J + b), rawv(X0 + (I + a) * ST / FS, Y0 + (J + b) * ST / FS))
    h00, h10, h01, h11 = g(0, 0), g(1, 0), g(0, 1), g(1, 1)
    return h00 + (h10 - h00) * u + (h11 - h10) * v if u >= v else h00 + (h11 - h01) * u + (h01 - h00) * v
def sea_at(x, y):
    i, j = round((x - X0) / ST), round((y - Y0) / ST)
    return not (0 <= i < NX and 0 <= j < NY) or SH[j * NX + i] > 0

# ---------------- inputs ----------------
E = json.load(open(f'{C}/raw.json'))['elements']
NOBUILD = []        # OSM polygons where an ML footprint is not trusted (sand, rock, lawn, sea pools)
for e in E:
    t = e.get('tags', {}); g = e.get('geometry')
    if e['type'] != 'way' or not g or len(g) < 4: continue
    if t.get('natural') in ('beach', 'bare_rock', 'rocks', 'sand', 'cliff', 'water', 'scrub', 'wood') or t.get('leisure') in ('pitch', 'swimming_pool', 'swimming_area', 'park', 'playground') \
       or t.get('landuse') == 'grass' or t.get('amenity') == 'parking':
        P = [XY(q['lat'], q['lon']) for q in g]; NOBUILD.append((P, bbox(P)))
def in_nobuild(x, y):
    return any(a <= x <= b and c <= y <= d and contains(P, x, y) for P, (a, b, c, d) in NOBUILD)

LMIN, LMAX = X0 + 8, X0 + (NX - 1) * ST - 8
BMIN, BMAX = Y0 + 8, Y0 + (NY - 1) * ST - 8
def inside_grid(P): return all(LMIN < x < LMAX and BMIN < y < BMAX for x, y in P)
HOUSE = {'house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'residential'}
def hsh(s): return int(hashlib.md5(str(s).encode()).hexdigest()[:8], 16) / 0xffffffff
def num(v):
    try: return float(str(v).split(';')[0].replace('m', '').strip())
    except ValueError: return 0.0

B = []     # dicts: P (ccw ring, route metres), kind, h (m or None), levels, src, id
for e in E:
    t = e.get('tags', {})
    if e['type'] != 'way' or 'building' not in t or not e.get('geometry'): continue
    P = [XY(q['lat'], q['lon']) for q in e['geometry']]
    if P[0] == P[-1]: P = P[:-1]
    if len(P) < 3 or not inside_grid(P): continue
    kind = t['building']
    if kind in ('construction', 'demolished', 'no'): continue
    h = num(t.get('height', 0)); lv = num(t.get('building:levels', 0))
    B.append({'P': P, 'kind': kind, 'h': h or None, 'lv': lv or None, 'src': 0, 'id': 'w%d' % e['id'], 'roof': t.get('roof:shape')})
n_osm = len(B)
# OSM coverage raster (1 m cells) for the Microsoft dedupe
OCC = set()
for b in B:
    a, bb, c, d = bbox(b['P'])
    for i in range(math.floor(a), math.ceil(bb) + 1):
        for j in range(math.floor(c), math.ceil(d) + 1):
            if contains(b['P'], i + 0.5, j + 0.5): OCC.add((i, j))
n_ms = n_ms_dup = n_ms_bad = 0
for f in json.load(open(f'{C}/ms_bbox.json')):
    ring = f['geometry']['coordinates'][0]
    P = [XY(la, lo) for lo, la in ring]
    if P[0] == P[-1]: P = P[:-1]
    if len(P) < 3 or not inside_grid(P): continue
    A = abs(area(P))
    if A < 10: continue
    a, bb, c, d = bbox(P); tot = cov = 0
    for i in range(math.floor(a), math.ceil(bb) + 1):
        for j in range(math.floor(c), math.ceil(d) + 1):
            if contains(P, i + 0.5, j + 0.5):
                tot += 1; cov += (i, j) in OCC
    if tot and cov / tot > 0.25: n_ms_dup += 1; continue
    cx, cy = sum(p[0] for p in P) / len(P), sum(p[1] for p in P) / len(P)
    if in_nobuild(cx, cy) or sea_at(cx, cy): n_ms_bad += 1; continue
    n_ms += 1
    B.append({'P': P, 'kind': 'yes', 'h': None, 'lv': None, 'src': 1, 'id': 'm%.1f,%.1f' % (cx, cy), 'roof': None})
print('footprints: OSM', n_osm, '+ Microsoft', n_ms, '(skipped: %d already in OSM, %d on beach/rock/lawn/sea)' % (n_ms_dup, n_ms_bad))

# ---------------- shape, height, roof, road clearance ----------------
MINC = ROAD_HW + CLEAR + 0.05
out = []; n_push = n_drop = n_hip = 0; hs = []
for b in B:
    P = simplify(b['P'])
    if area(P) < 0: P = P[::-1]
    A = area(P)
    if A < 8: continue
    # road clearance: push offending vertices out along the track normal, then verify the edges
    moved = 0; Q = []
    for x, y in P:
        d, p = path_near(x, y)
        if d < MINC and p:
            if d < 1e-3: Q = None; break
            k = MINC / d; x, y = p[0] + (x - p[0]) * k, p[1] + (y - p[1]) * k; moved += 1
        Q.append((x, y))
    if Q is None or moved > len(P) / 2: n_drop += 1; continue
    ok = True
    for i in range(len(Q)):
        (x1, y1), (x2, y2) = Q[i], Q[(i + 1) % len(Q)]; m = max(1, int(math.hypot(x2 - x1, y2 - y1) / 0.4))
        for s in range(m + 1):
            if path_near(x1 + (x2 - x1) * s / m, y1 + (y2 - y1) * s / m)[0] < ROAD_HW + CLEAR: ok = False; break
        if not ok: break
    cx, cy = sum(p[0] for p in Q) / len(Q), sum(p[1] for p in Q) / len(Q)
    if not ok or contains(Q, *path_near(cx, cy, 40)[1] or (1e9, 1e9)): n_drop += 1; continue
    if moved: n_push += 1
    P = Q; A = area(P)
    r = hsh(b['id']); r2 = hsh(b['id'] + 'b')
    kind = b['kind']
    if b['h']: h = b['h']
    elif b['lv']: h = b['lv'] * 3.0 + 1.0
    elif kind in ('roof', 'shed', 'garage', 'garages', 'hut', 'toilets', 'kiosk', 'service'): h = 3.0 + r
    elif kind in HOUSE or (kind == 'yes' and A < 260):
        h = (3.4 if A < 45 else 5.5 + 2.5 * r if A < 180 else 6.5 + 2.0 * r)      # sheds / 1-2 storey houses
    elif kind == 'apartments' or (kind == 'yes' and A >= 260):
        h = (9.5 + 3 * r if A < 500 else 12 + 4 * r if A < 1200 else 14 + 6 * r)   # 3-6 storey walk-ups / blocks
    elif kind in ('church', 'synagogue', 'school', 'commercial', 'retail'): h = 8 + 4 * r
    else: h = 7 + 2 * r
    # ground: lowest corner (walls go below it, never float), top relative to the mean ground
    # ground under the walls: every vertex + edge midpoints (fine corridor lattice where it exists)
    samp = P + [((P[i][0] + P[(i + 1) % len(P)][0]) / 2, (P[i][1] + P[(i + 1) % len(P)][1]) / 2) for i in range(len(P))]
    gs = [ground(x, y) for x, y in samp] + [ground(cx, cy)]
    base = min(gs) - 0.5; top = max(sum(gs) / len(gs) + h, max(gs) + min(h, 2.6))
    roof = 0; hip = None
    if (b['roof'] in ('hipped', 'gabled') or b['roof'] is None) and (kind in HOUSE or kind == 'yes') and 30 < A < 320 and h < 9.5:
        ox, oy, ang, L, W, Aobb = obb(P)
        if A / Aobb > 0.78 and W > 4 and L < 3.5 * W:
            roof = 1; n_hip += 1; rise = W / 2 * math.tan(math.radians(23))
            hip = [round(ox * 10), round(oy * 10), round(ang * 1000), round(L * 10), round(W * 10), round(rise * 10)]
            top -= 0.4 * rise      # the eaves sit lower than a flat-roofed block of the same height
    hs.append(top - sum(gs) / len(gs))
    out.append({'P': P, 'z': [round(base * 10), round(top * 10)], 'roof': roof, 'hip': hip, 't': int(r2 * 100) % 100, 'src': b['src']})
print('kept', len(out), 'pushed off the road', n_push, 'dropped (road through it)', n_drop, 'hipped roofs', n_hip)
hs.sort(); print('height above ground: median %.1f m, p90 %.1f m, max %.1f m' % (hs[len(hs) // 2], hs[int(len(hs) * 0.9)], hs[-1]))

# ---------------- write (stable order: by y then x of the first vertex) ----------------
out.sort(key=lambda b: (round(b['P'][0][1], 1), round(b['P'][0][0], 1)))
N, XYL, Z, RF, HIP, TT, SRC = [], [], [], [], [], [], []
for b in out:
    q = [(round(x * 10), round(y * 10)) for x, y in b['P']]
    dd = [q[0]] + [(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]) for i in range(1, len(q))]
    N.append(len(q)); XYL += [v for p in dd for v in p]; Z += b['z']; RF.append(b['roof']); TT.append(b['t']); SRC.append(b['src'])
    if b['hip']: HIP += b['hip']
D = {'note': 'baked by tools/buildings.py from OSM (ODbL) + Microsoft Global ML Building Footprints (ODbL); see its docstring',
     'count': len(out), 'osm': sum(1 for s in SRC if s == 0), 'ms': sum(1 for s in SRC if s == 1),
     'n': N, 'xy': XYL, 'z': Z, 'roof': RF, 'hip': HIP, 't': TT, 'src': SRC}
json.dump(D, open(f'{ROOT}/data/buildings.json', 'w'), separators=(',', ':'))
print('wrote data/buildings.json', len(out), 'buildings,', os.path.getsize(f'{ROOT}/data/buildings.json') // 1024, 'KB')
