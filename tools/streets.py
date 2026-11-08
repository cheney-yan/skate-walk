"""Streets, car parks, footpaths and courts near the Bondi -> Bronte route -> data/streets.json (offline, deterministic).

    GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR tools/cache/.venv/bin/python tools/streets.py     # needs shapely (venv)

Input: the OSM Overpass dump tools/cache/osm/raw.json (ODbL; same file as tools/buildings.py).
  * highway=primary/secondary/tertiary/residential/unclassified/living_street/service lines -> carriageway ribbons.
    Width (kerb to kerb): OSM width=* if tagged, else lanes x 3.2 m + parking lanes, else a per-class default
    (residential 8 m = two lanes + kerbside parking, tertiary 9 m, primary 12 m, driveway 3 m, alley 3.6 m ...).
  * amenity=parking polygons (car parks, kerbside parking lanes) -> car-park asphalt.
  * highway=footway/pedestrian/cycleway/steps lines (footway=sidewalk = the footpaths beside the streets) -> 1.8-2.5 m
    concrete strips; highway=pedestrian area=yes polygons -> paved plazas.
  * leisure=pitch / track polygons -> courts (concrete for skate parks).
Priority where they overlap: road > car park > court > plaza > footpath. The game's walking path is NOT a street:
every polygon is cut back to >= PATH_CLEAR m from the browser's smoothed track centre line (the concrete path keeps
its own look and the street never covers it); footpaths are cut back further (FOOT_CLEAR) so the OSM line of the
coastal walk itself does not double the path.
Only what lies within KEEP m of the route is kept (data budget). Rings are simplified (0.3 m).

Output data/streets.json:
  cls    class names, index = class id
  p      per polygon [cls, ring0, ring1, ...]; ring = flat int list, first vertex absolute (dm, route metres x east /
         y north), then deltas (dm); ring0 = outer, others = holes. js/streets.js triangulates, clips the triangles to
         the ground mesh's own triangles (coarse 8 m grid / fine 1 m corridor lattice) and drapes them on it.
"""
import json, math, os
from shapely.geometry import LineString, Polygon, MultiPolygon, box
from shapely.ops import unary_union
import shapely

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = json.load(open(f'{ROOT}/data/route.json')); T = R['terrain']; NX, NY, ST, X0, Y0 = T['nx'], T['ny'], T['step'], T['x0'], T['y0']
H = [v / 10 for v in T['h']]
lat0, lon0 = R['start']; KX = 111320 * math.cos(math.radians(lat0)); KY = 110540
XY = lambda g: ((g['lon'] - lon0) * KX, (g['lat'] - lat0) * KY)
clamp = lambda x, a, b: max(a, min(b, x))
PATH_CLEAR, FOOT_CLEAR, KEEP, SIMP = 1.85, 3.2, 280.0, 0.3
CLS = ['road', 'carpark', 'court', 'plaza', 'foot', 'concrete']

# ---------------- browser track (same port as tools/env.py / tools/buildings.py route_track) ----------------
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
TRACK = LineString(route_track())

# ---------------- OSM -> class geometries ----------------
E = json.load(open(f'{ROOT}/tools/cache/osm/raw.json'))['elements']
DEF_W = {'primary': 12.0, 'secondary': 10.0, 'tertiary': 9.0, 'residential': 8.0, 'unclassified': 7.0, 'living_street': 5.5,
         'primary_link': 6.5, 'secondary_link': 6.5, 'tertiary_link': 6.0, 'service': 4.5}
SERVICE_W = {'driveway': 3.0, 'parking_aisle': 6.0, 'alley': 3.6, 'drive-through': 3.5}
def num(v):
    try: return float(str(v).split(';')[0].replace('m', '').strip())
    except (TypeError, ValueError): return 0.0
def road_width(t):
    hw = t['highway']
    if hw == 'service': return SERVICE_W.get(t.get('service'), DEF_W['service'])
    w = num(t.get('width'))
    if w: return clamp(w, 3, 18)
    lanes = num(t.get('lanes'))
    if lanes:
        park = 0 if hw in ('primary_link', 'tertiary_link', 'secondary_link') else (1 if t.get('oneway') == 'yes' else 2)
        return clamp(lanes * 3.2 + park * 2.2, 4, 18)
    return DEF_W[hw]
G = {c: [] for c in CLS}
UNPAVED = {'dirt', 'grass', 'unpaved', 'sand', 'ground', 'compacted', 'gravel', 'rock', 'wood', 'earth'}
for e in E:
    t = e.get('tags', {}); g = e.get('geometry')
    if e['type'] != 'way' or not g or len(g) < 2: continue
    P = [XY(q) for q in g]; closed = P[0] == P[-1] and len(P) >= 4
    hw = t.get('highway')
    if hw in DEF_W and t.get('area') != 'yes' and t.get('tunnel') != 'yes':
        G['road'].append(LineString(P).buffer(road_width(t) / 2, quad_segs=3))
    elif hw in ('footway', 'pedestrian', 'cycleway', 'steps', 'path'):
        if t.get('surface') in UNPAVED or t.get('footway') == 'crossing': continue
        if t.get('area') == 'yes' and closed: G['plaza'].append(Polygon(P).buffer(0)); continue
        if hw == 'path' and t.get('surface') is None: continue
        w = {'cycleway': 2.5, 'pedestrian': 3.5, 'steps': 1.8}.get(hw, 1.8 if t.get('footway') == 'sidewalk' else 2.0)
        G['foot'].append(LineString(P).buffer(w / 2, quad_segs=3))
    elif t.get('amenity') == 'parking' and closed and t.get('parking') not in ('underground', 'multi-storey', 'rooftop'):
        G['carpark'].append(Polygon(P).buffer(0))
    elif t.get('leisure') in ('pitch', 'track') and closed:
        cls = 'concrete' if t.get('surface') == 'concrete' or t.get('sport') == 'skateboard' else 'court'
        if t.get('surface') in ('grass', 'sand', 'artificial_turf'): continue
        G[cls].append(Polygon(P).buffer(0))
print('OSM pieces', {k: len(v) for k, v in G.items()})

# ---------------- priorities, path clearance, keep-zone ----------------
grid = box(X0 + 1, Y0 + 1, X0 + (NX - 1) * ST - 1, Y0 + (NY - 1) * ST - 1)
zone = TRACK.buffer(KEEP, quad_segs=6).intersection(grid)
path = TRACK.buffer(PATH_CLEAR, quad_segs=4); pathF = TRACK.buffer(FOOT_CLEAR, quad_segs=4)
taken = path
OUT = {}
for c in ('road', 'carpark', 'concrete', 'court', 'plaza', 'foot'):
    U = unary_union(G[c]).intersection(zone) if G[c] else Polygon()
    U = U.simplify(SIMP, preserve_topology=True).buffer(0)          # simplify BEFORE the cut: the clearance stays exact
    U = U.difference(taken if c != 'foot' else unary_union([taken, pathF])).buffer(0)
    taken = unary_union([taken, U])
    OUT[c] = [p for p in (U.geoms if hasattr(U, 'geoms') else [U]) if isinstance(p, Polygon) and p.area >= 1.5]
    print('%-8s polygons %4d  area %7.0f m2' % (c, len(OUT[c]), sum(p.area for p in OUT[c])))
# check: nothing within PATH_CLEAR - 1 cm of the track centre line
worst = min((TRACK.distance(p) for L in OUT.values() for p in L), default=99)
print('min distance street polygon -> track centre line: %.2f m (road half width 1.6 m)' % worst)

# ---------------- write (stable order) ----------------
def ring(coords):
    q = [(round(x * 10), round(y * 10)) for x, y in list(coords)[:-1]]
    out = [q[0][0], q[0][1]]
    for i in range(1, len(q)): out += [q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]]
    return out
# chunk into 32 m tiles aligned to the 8 m terrain grid and split away every hole (cut through it), so the browser
# only ever clips small simple polygons against the ground triangles under them (js/streets.js)
TILE = 32
def no_holes(p):
    if not p.interiors: return [p]
    hx = Polygon(p.interiors[0]).centroid.x; a, b, c_, d = p.bounds; out = []
    for half in (box(a - 1, b - 1, hx, d + 1), box(hx, b - 1, c_ + 1, d + 1)):
        q = p.intersection(half)
        for g in (q.geoms if hasattr(q, 'geoms') else [q]):
            if isinstance(g, Polygon) and g.area >= 0.05: out += no_holes(g)
    return out
def chunks(p):
    a, b, c_, d = p.bounds; out = []
    for i in range(math.floor((a - X0) / TILE), math.floor((c_ - X0) / TILE) + 1):
        for j in range(math.floor((b - Y0) / TILE), math.floor((d - Y0) / TILE) + 1):
            q = p.intersection(box(X0 + i * TILE, Y0 + j * TILE, X0 + (i + 1) * TILE, Y0 + (j + 1) * TILE))
            for g in (q.geoms if hasattr(q, 'geoms') else [q]):
                if isinstance(g, Polygon) and g.area >= 0.05: out += no_holes(g.simplify(0.02, preserve_topology=True))
    return out
polys = []
for ci, c in enumerate(CLS):
    for p in sorted([g for p in OUT.get(c, []) for g in chunks(p)], key=lambda p: (round(p.bounds[1], 1), round(p.bounds[0], 1))):
        p = shapely.geometry.polygon.orient(p, 1.0)
        rs = [ring(p.exterior.coords)] + [ring(r.coords) for r in p.interiors if Polygon(r).area > 0.8]
        if len(rs[0]) >= 6: polys.append([ci] + rs)
D = {'note': 'baked by tools/streets.py from OpenStreetMap (ODbL): carriageways (width from width/lanes tags or class '
             'defaults), amenity=parking, footways/sidewalks, pedestrian areas, pitches; cut back from the walking path. '
             'See its docstring for the format.', 'cls': CLS, 'p': polys}
json.dump(D, open(f'{ROOT}/data/streets.json', 'w'), separators=(',', ':'))
nv = sum(len(r) // 2 for p in polys for r in p[1:])
print('wrote data/streets.json', len(polys), 'polygons', nv, 'vertices', os.path.getsize(f'{ROOT}/data/streets.json') // 1024, 'KB')
