"""Bake the Bondi route environment (offline, deterministic): ground classes, trees/shrubs, road decals.

    cd ~/code/skate-walk && python3 tools/env.py            # writes data/env.json (+ data/cache/env_debug.png if PIL)

Inputs (data/route.json): terrain heights, sea mask/shore distance (tools/shore.py), path polyline, buildings,
coast lines (beach polygons, cliffs) and OSM park polygons (data/osm_raw.json, optional).
Pure stdlib (PIL only for the optional debug map). Same seed -> byte-identical output.

Output data/env.json:
  ground.b64   per terrain vertex (row-major j*nx+i, same grid as route.terrain), 2 bytes = four 4-bit weights
               byte0 = sand<<4 | rock, byte1 = dirt<<4 | green (0..15). green: 0 = dry straw .. 15 = lush mown.
  trees        {pine|gum|banksia|shrub: flat [x, y, z, scale, rotY, leanX, leanZ, tint, nX, nZ] * n}
               three.js coords (x east, y up, z = -north); y = ground mesh height at the foot; n = ground normal xz.
  decals       [[s, off, kind, size, rot]]  s = metres along the browser's smoothed track (same maths as
               lab.js routeTrack), off = metres to the left of travel (+ = left lane), kind 0 bike, 1 pedestrian,
               2 arrow, 3 stain, 4 bike+pedestrian pair; rot = 0 faces +s, 1 faces -s (for stains: any angle).
  kerb         flat [x, y, z, yaw, length, height, width, tint] * n  rounded sandstone blocks lining the road edge
               where the ground beside it rises above the road (cut banks); y = block base (slightly sunk).
  corridor     {fs, cells, dcm}: 8 m terrain cells near the road (k = j*(nx-1)+i, sorted) that lab.js draws as an
               fs x fs fine lattice instead; dcm = int16 LE per fine vertex (first-encounter order over cells, rows
               b then columns a) = height change in cm vs the bilinear coarse surface (cut under/beside the road,
               embankment fill so the road always sits on land). See 'ground mesh height' below.
"""
import json, base64, math, os, random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = 20261108
R = json.load(open(f'{ROOT}/data/route.json'))
T = R['terrain']; NX, NY, ST, X0, Y0 = T['nx'], T['ny'], T['step'], T['x0'], T['y0']
H = [v / 10 for v in T['h']]
SH = base64.b64decode(R['shore']['b64'])
clamp = lambda x, a, b: max(a, min(b, x))
def sstep(a, b, x):
    t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3 - 2 * t)

# ---------------- value noise (seeded, deterministic) ----------------
_rng = random.Random(SEED); PERM = list(range(1024)); _rng.shuffle(PERM); GR = [_rng.random() for _ in range(1024)]
def _h(i, j, o): return GR[PERM[(PERM[(i + o * 131) & 1023] + j * 7 + o * 17) & 1023]]
def vnoise(x, y, o=0):
    i, j = math.floor(x), math.floor(y); u, v = x - i, y - j; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v)
    a, b, c, d = _h(i, j, o), _h(i + 1, j, o), _h(i, j + 1, o), _h(i + 1, j + 1, o)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
def fbm(x, y, o=0, oct=3):
    s, a, n = 0.0, 0.5, 0.0
    for k in range(oct): s += a * vnoise(x, y, o + k * 3); n += a; x = x * 2.03 + 5.3; y = y * 2.03 - 1.7; a *= 0.5
    return s / n

# ---------------- browser track (exact port of lab.js terrainFn + routeTrack) ----------------
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
    P, L = R['pts'], R['length']; k = 0; D = []
    s = 0.0
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
        pts.append({'s': s, 'x': a[0] + (b[0] - a[0]) * u, 'z': a[1] + (b[1] - a[1]) * u, 'y': a[2] + (b[2] - a[2]) * u}); s += 0.25
    n = len(pts)
    for i in range(n):
        a, b = pts[max(0, i - 4)], pts[min(n - 1, i + 4)]; pts[i]['yaw'] = math.atan2(b['x'] - a['x'], b['z'] - a['z'])
    for i in range(n):
        a, b = pts[max(0, i - 8)], pts[min(n - 1, i + 8)]; ds = (b['s'] - a['s']) or 1
        dy = b['yaw'] - a['yaw']; dy = (dy + math.pi) % (2 * math.pi) - math.pi
        pts[i]['kap'] = dy / ds; pts[i]['gr'] = (b['y'] - a['y']) / ds
    return pts, total
TP, TOTAL = route_track()
print('track', len(TP), 'pts, total %.1f m' % TOTAL)

# spatial hash of track points (three coords x,z) for distance queries
PH = {}
for q in TP[::4]:
    PH.setdefault((math.floor(q['x'] / 8), math.floor(q['z'] / 8)), []).append(q)
def path_near(x, z, rad=16):
    """nearest track point within ~rad m -> (dist, point) or (1e9, None)"""
    best, bq = 1e18, None; r = int(rad // 8) + 1; ci, cj = math.floor(x / 8), math.floor(z / 8)
    for di in range(-r, r + 1):
        for dj in range(-r, r + 1):
            for q in PH.get((ci + di, cj + dj), ()):
                d = (q['x'] - x) ** 2 + (q['z'] - z) ** 2
                if d < best: best, bq = d, q
    return (math.sqrt(best), bq) if bq else (1e9, None)

# ---------------- grid fields ----------------
idx = lambda i, j: j * NX + i
SEA = [b > 0 for b in SH]
# distance-to-sea for land cells (two-pass chamfer 3-4-5 style, metres), then sea cells = 0
INF = 1e9; DS = [0.0 if SEA[k] else INF for k in range(NX * NY)]
c1, c2 = ST, ST * math.sqrt(2)
for _ in range(2):
    for j in range(NY):
        for i in range(NX):
            k = idx(i, j); v = DS[k]
            if i > 0: v = min(v, DS[k - 1] + c1)
            if j > 0:
                v = min(v, DS[k - NX] + c1)
                if i > 0: v = min(v, DS[k - NX - 1] + c2)
                if i < NX - 1: v = min(v, DS[k - NX + 1] + c2)
            DS[k] = v
    for j in range(NY - 1, -1, -1):
        for i in range(NX - 1, -1, -1):
            k = idx(i, j); v = DS[k]
            if i < NX - 1: v = min(v, DS[k + 1] + c1)
            if j < NY - 1:
                v = min(v, DS[k + NX] + c1)
                if i < NX - 1: v = min(v, DS[k + NX + 1] + c2)
                if i > 0: v = min(v, DS[k + NX - 1] + c2)
            DS[k] = v
def slope_at(i, j):
    a, b = H[idx(min(NX - 1, i + 1), j)] - H[idx(max(0, i - 1), j)], H[idx(i, min(NY - 1, j + 1))] - H[idx(i, max(0, j - 1))]
    return math.hypot(a, b) / (2 * ST)
SL = [slope_at(i, j) for j in range(NY) for i in range(NX)]

def poly_contains(P, x, y):
    c = False; n = len(P); j = n - 1
    for i in range(n):
        if (P[i][1] > y) != (P[j][1] > y) and x < (P[j][0] - P[i][0]) * (y - P[i][1]) / ((P[j][1] - P[i][1]) or 1e-9) + P[i][0]: c = not c
        j = i
    return c
def bbox(P): xs = [p[0] for p in P]; ys = [p[1] for p in P]; return (min(xs), max(xs), min(ys), max(ys))
BEACH = [(c['line'], bbox(c['line'])) for c in R['coast'] if c['kind'] == 'beach']
CLIFF = [c['line'] for c in R['coast'] if c['kind'] == 'cliff']
BLD = [(b['poly'], bbox(b['poly'])) for b in R['buildings'] if len(b['poly']) >= 4]
PARK = []
try:   # OSM parks (lawns): Bondi Park, Marks Park, Tamarama/Bronte Park ...
    lat0, lon0 = R['start']; kx = 111320 * math.cos(math.radians(lat0)); ky = 110540
    for e in json.load(open(f'{ROOT}/data/osm_raw.json'))['elements']:
        if e['type'] == 'way' and e.get('tags', {}).get('leisure') == 'park' and e.get('geometry'):
            P = [((g['lon'] - lon0) * kx, (g['lat'] - lat0) * ky) for g in e['geometry']]
            if len(P) > 3: PARK.append((P, bbox(P)))
except FileNotFoundError: pass
def inside_any(L, x, y, m=0.0):
    for P, (a, b, c, d) in L:
        if a - m <= x <= b + m and c - m <= y <= d + m and poly_contains(P, x, y): return True
    return False
def near_building(x, y, m):
    for P, (a, b, c, d) in BLD:
        if a - m <= x <= b + m and c - m <= y <= d + m:
            if poly_contains(P, x, y): return True
            for k in range(len(P) - 1):   # distance to edges
                (x1, y1), (x2, y2) = P[k], P[k + 1]; ex, ey = x2 - x1, y2 - y1; l2 = ex * ex + ey * ey or 1e-9
                u = clamp(((x - x1) * ex + (y - y1) * ey) / l2, 0, 1)
                if (x1 + ex * u - x) ** 2 + (y1 + ey * u - y) ** 2 < m * m: return True
    return False
# distance to OSM cliff lines (metres, capped)
def cliff_dist(x, y, cap=40.0):
    best = cap
    for L in CLIFF:
        for k in range(len(L) - 1):
            (x1, y1), (x2, y2) = L[k], L[k + 1]
            if min(x1, x2) - cap > x or max(x1, x2) + cap < x or min(y1, y2) - cap > y or max(y1, y2) + cap < y: continue
            ex, ey = x2 - x1, y2 - y1; l2 = ex * ex + ey * ey or 1e-9; u = clamp(((x - x1) * ex + (y - y1) * ey) / l2, 0, 1)
            best = min(best, math.hypot(x1 + ex * u - x, y1 + ey * u - y))
    return best
# bilinear field sampler on the grid (route coords x east, y north)
def field(F, x, y):
    fi, fj = (x - X0) / ST, (y - Y0) / ST; i = max(0, min(NX - 2, math.floor(fi))); j = max(0, min(NY - 2, math.floor(fj)))
    u, v = clamp(fi - i, 0, 1), clamp(fj - j, 0, 1)
    return F[idx(i, j)] * (1 - u) * (1 - v) + F[idx(i + 1, j)] * u * (1 - v) + F[idx(i, j + 1)] * (1 - u) * v + F[idx(i + 1, j + 1)] * u * v

# ---------------- ground classification per terrain vertex ----------------
SAND, ROCK, DIRT, GREEN, PARKF = ([0.0] * (NX * NY) for _ in range(5))
for j in range(NY):
    for i in range(NX):
        k = idx(i, j); x, y = X0 + i * ST, Y0 + j * ST
        if SEA[k]:
            SAND[k] = 1.0 if H[k] > -6 else 0.6; continue      # under water: sand shelf (only seen through the shallows)
        h, sl, ds = H[k], SL[k], DS[k]
        nz = (fbm(x / 55, y / 55, 1) - 0.5) * 2             # -1..1 breaks up iso-contours
        dse = ds + 22 * nz
        park = 1.0 if inside_any(PARK, x, y) else 0.0; PARKF[k] = park
        beach = inside_any(BEACH, x, y)
        # sand: flat, low land right next to the sea (and the OSM beach polygons)
        s = sstep(75, 30, dse) * sstep(7.5, 3.5, h + 1.5 * nz) * sstep(0.38, 0.18, sl)
        if beach: s = max(s, sstep(9, 5, h))
        s *= 1 - 0.85 * park * (0 if beach else 1)
        # rock: high or steep land next to the sea (sandstone headlands/cliffs), OSM cliffs, very steep outcrops
        cd = cliff_dist(x, y)
        r = sstep(62, 22, dse) * max(sstep(8, 15, h + 3 * nz), sstep(0.32, 0.68, sl))
        r = max(r, sstep(26, 6, cd + 8 * nz) * sstep(2, 6, h), 0.85 * sstep(0.85, 1.4, sl))
        if park: r *= sstep(30, 10, ds)       # park lawns run to the cliff edge, rock only on the edge itself
        r *= 1 - s
        # dirt: worn patches (noise clusters), steep banks, a bit more on dry seaward ground
        dn = fbm(x / 26 + 40, y / 26, 7)
        d = sstep(0.66, 0.8, dn) * 0.85 + sstep(0.45, 0.85, sl) * 0.4 + sstep(110, 40, ds) * 0.1
        d *= (1 - 0.65 * park) * (1 - s) * (1 - r)
        # green-ness: Aussie coastal grass = mix of green / olive / straw; parks are watered and mown
        g = 0.5 + 0.55 * (fbm(x / 70, y / 70, 13) - 0.5) * 2 + 0.35 * park - 0.25 * sstep(110, 35, ds) - 0.15 * sstep(0.25, 0.6, sl)
        SAND[k], ROCK[k], DIRT[k], GREEN[k] = clamp(s, 0, 1), clamp(r, 0, 1), clamp(d, 0, 1), clamp(g, 0, 1)
q4 = lambda v: int(round(clamp(v, 0, 1) * 15))
gb = bytearray()
for k in range(NX * NY):
    gb.append(q4(SAND[k]) << 4 | q4(ROCK[k])); gb.append(q4(DIRT[k]) << 4 | q4(GREEN[k]))
print('ground: sand %.0f%% rock %.0f%% of land' % tuple(100 * sum(1 for k in range(NX * NY) if not SEA[k] and F[k] > 0.5) / max(1, SEA.count(False)) for F in (SAND, ROCK)))

# ---------------- ground mesh height (replicates lab.js: hSea shelf, low-land sink, fine road corridor) ----------------
# Coarse 8 m grid = raw terrain (per vertex: hSea, clamp -4, land below 1.3 m sunk by 2.5 m). Every 8 m cell within
# CORR m of the road is NOT drawn coarse; it is replaced by a 1 m lattice ("corridor") whose heights are baked here:
#   cap   : within SHOULDER m of the centre line the ground stays >= CLEAR below the road surface (1 m triangles,
#           diameter 1.41 m, so 1.6 + 1.41 < SHOULDER guarantees no triangle reaches above the road), then may rise
#           at BANK slope (cut bank -> lined with a stone kerb, see below)
#   floor : the road always sits on land: verge at road - 0.2 m out to FLOOR_W, then a 1:1 embankment / seawall,
#           and the ground within SEA_W of the centre stays above the water where the road itself is above it
# Cells on the corridor rim keep the coarse surface (delta 0) so both meshes meet without cracks.
HS = [min(H[k], (-10 - min(SH[k] / 4, 60) * 2.5) / 10) if SH[k] else H[k] for k in range(NX * NY)]
RAWV = []
for k in range(NX * NY):
    g = max(-4, HS[k]); RAWV.append(g - 2.5 if g < 1.3 else g)
def base_h(x, y):           # bilinear of the coarse vertex heights (== the coarse triangles along every cell edge)
    return field(RAWV, x, y)
CLEAR, BANK, BANK0 = 0.08, 0.8, 2.1          # road clearance; cut-bank slope rising from BANK0 m off the centre line
ROADW, TRI_R = 1.6, 0.71                     # road half width; farthest point of a 1 m right triangle from its nearest vertex
FLOOR_W, FLOOR_DROP, SEA_W = 2.6, 1.0, 4.6
CORR, FS = 7.0, 8                            # corridor radius (m), fine subdivisions per 8 m cell
for k, q in enumerate(TP): q['k'] = k
TQ = TP[::2]
PA = {}
for q in TQ: PA.setdefault((math.floor(q['x'] / 4), math.floor(q['z'] / 4)), []).append(q)
def near_info(x, z, R=2):
    """-> (distance to road centre, road cap, free-bank cap, embankment floor) for a three-coords point"""
    dmin, rc, bc, f = 1e9, 1e9, 1e9, -1e9
    ci, cj = math.floor(x / 4), math.floor(z / 4); L = []
    for di in range(-R, R + 1):
        for dj in range(-R, R + 1):
            for q in PA.get((ci + di, cj + dj), ()):
                d = math.sqrt((q['x'] - x) ** 2 + (q['z'] - z) ** 2); L.append((d, q['k']))
                if d < dmin: dmin = d
                bc = min(bc, q['y'] - CLEAR + max(0.0, d - BANK0) * BANK)
                fl = q['y'] - 0.2 - max(0.0, d - FLOOR_W) * FLOOR_DROP
                if d < SEA_W and q['y'] > 0.6: fl = max(fl, min(q['y'] - 0.2, 0.3))
                f = max(f, fl)
    # road surface at the vertex's own projection onto the centre line (segment-interpolated; on hairpins any
    # branch nearly as close counts too). Ground and road are near-planar per metre, so capping each vertex at its
    # own projection keeps the whole 1 m triangle under the slab even on 40% stairs.
    KN = [k for d, k in L if d < dmin + 1.2]
    for k0 in KN:
        for k in range(max(0, k0 - 3), min(len(TP) - 1, k0 + 3)):
            a, b = TP[k], TP[k + 1]; ex, ez = b['x'] - a['x'], b['z'] - a['z']; l2 = ex * ex + ez * ez or 1e-9
            u = clamp(((x - a['x']) * ex + (z - a['z']) * ez) / l2, 0, 1)
            d = math.hypot(a['x'] + ex * u - x, a['z'] + ez * u - z)
            if d < dmin + 0.35: rc = min(rc, a['y'] + (b['y'] - a['y']) * u - CLEAR)
    return dmin, rc, bc, f
# corridor cells: any point of the cell within CORR of a track point
CELLS = set()
for q in TQ:
    x, y = q['x'], -q['z']
    for i in range(math.floor((x - CORR - X0) / ST), math.floor((x + CORR - X0) / ST) + 1):
        for j in range(math.floor((y - CORR - Y0) / ST), math.floor((y + CORR - Y0) / ST) + 1):
            if not (0 <= i < NX - 1 and 0 <= j < NY - 1) or (i, j) in CELLS: continue
            cx_, cy_ = clamp(x, X0 + i * ST, X0 + (i + 1) * ST), clamp(y, Y0 + j * ST, Y0 + (j + 1) * ST)
            if (cx_ - x) ** 2 + (cy_ - y) ** 2 < CORR * CORR: CELLS.add((i, j))
CELL_LIST = sorted(j * (NX - 1) + i for i, j in CELLS)
# fine lattice vertices in first-encounter order (lab.js rebuilds the same order)
FV = {}; FORDER = []
for ck in CELL_LIST:
    i, j = ck % (NX - 1), ck // (NX - 1)
    for b_ in range(FS + 1):
        for a_ in range(FS + 1):
            key = (i * FS + a_, j * FS + b_)
            if key not in FV: FV[key] = len(FORDER); FORDER.append(key)
def rim(I, J):   # lattice point on an edge shared with a coarse (non-corridor) cell -> must equal the coarse surface
    if I % FS and J % FS: return False
    i0, j0 = I // FS, J // FS
    for ci in ((i0 - 1, i0) if I % FS == 0 else (i0,)):
        for cj in ((j0 - 1, j0) if J % FS == 0 else (j0,)):
            if (ci, cj) not in CELLS: return True
    return False
INFO = {}
for (I, J) in FORDER:
    x, y = X0 + I * ST / FS, Y0 + J * ST / FS; INFO[(I, J)] = (base_h(x, y),) + near_info(x, -y)
# a fine triangle can touch the road only if its nearest vertex is within ROADW + TRI_R: cap ALL its vertices at the road
ROADV = set()
for ck in CELL_LIST:
    i, j = ck % (NX - 1), ck // (NX - 1)
    for b_ in range(FS):
        for a_ in range(FS):
            I, J = i * FS + a_, j * FS + b_
            for tri in (((I, J), (I + 1, J), (I + 1, J + 1)), ((I, J), (I + 1, J + 1), (I, J + 1))):
                if min(INFO[v][1] for v in tri) < ROADW + TRI_R: ROADV.update(tri)
FH = {}; FD = []; nfill = ncut = 0
for (I, J) in FORDER:
    b0, d, rc, bc, f = INFO[(I, J)]
    if rim(I, J): h = b0
    else: h = min(max(b0, f), rc if (I, J) in ROADV else bc)
    dc = int(round((h - b0) * 100)); dc = max(-32768, min(32767, dc))
    if (I, J) in ROADV and b0 + dc / 100 > rc: dc = math.floor((rc - b0) * 100)    # rounding must never lift it above
    if dc > 0: nfill += 1
    if dc < 0: ncut += 1
    FD.append(dc); FH[(I, J)] = b0 + dc / 100
print('corridor cells', len(CELL_LIST), 'fine verts', len(FORDER), 'road-capped', len(ROADV), 'filled', nfill, 'cut', ncut)
def mesh_h(x, y):
    fi, fj = (x - X0) / ST, (y - Y0) / ST; i = max(0, min(NX - 2, math.floor(fi))); j = max(0, min(NY - 2, math.floor(fj)))
    if (i, j) in CELLS:     # fine lattice, same diagonal as lab.js (a,b,d)/(b,c,d) with b = next row
        gi, gj = (x - X0) / ST * FS, (y - Y0) / ST * FS; I, J = math.floor(gi), math.floor(gj); u, v = gi - I, gj - J
        g = lambda a_, b_: FH.get((I + a_, J + b_), base_h(X0 + (I + a_) * ST / FS, Y0 + (J + b_) * ST / FS))
        h00, h10, h01, h11 = g(0, 0), g(1, 0), g(0, 1), g(1, 1)
        return h00 + (h10 - h00) * u + (h11 - h10) * v if u >= v else h00 + (h11 - h01) * u + (h01 - h00) * v
    u, v = clamp(fi - i, 0, 1), clamp(fj - j, 0, 1)
    h00, h10, h01, h11 = RAWV[idx(i, j)], RAWV[idx(i + 1, j)], RAWV[idx(i, j + 1)], RAWV[idx(i + 1, j + 1)]
    return h00 + (h10 - h00) * u + (h11 - h10) * v if u >= v else h00 + (h11 - h01) * u + (h01 - h00) * v
ground_h = mesh_h
# verify-and-fix: sample the road slab densely (0.25 m along, 0.1 m across) and push down any fine triangle that
# still reaches above road - 0.02 m (tight bends / stair kinks where the per-vertex projection cap is not enough)
def fine_tri(x, y):
    gi, gj = (x - X0) / ST * FS, (y - Y0) / ST * FS; I, J = math.floor(gi), math.floor(gj)
    return [(I, J), (I + 1, J), (I + 1, J + 1)] if gi - I >= gj - J else [(I, J), (I + 1, J + 1), (I, J + 1)]
FIDX = {key: n for n, key in enumerate(FORDER)}
for it in range(6):
    nfix = 0
    for q in TP:
        lx, lz = math.cos(q['yaw']), -math.sin(q['yaw'])
        for o10 in range(-16, 17):
            o = o10 / 10; x, y = q['x'] + lx * o, -(q['z'] + lz * o)
            ex = mesh_h(x, y) - (q['y'] - 0.02)
            if ex <= 0: continue
            for v in fine_tri(x, y):
                if v in FH and not rim(*v): FH[v] -= ex + 0.03; FD[FIDX[v]] = int(math.floor((FH[v] - INFO[v][0]) * 100)); FH[v] = INFO[v][0] + FD[FIDX[v]] / 100
            nfix += 1
    print('road clearance fix pass', it, 'violations', nfix)
    if not nfix: break
def mesh_n(x, y):
    e = 1.0; gx = (mesh_h(x + e, y) - mesh_h(x - e, y)) / (2 * e); gy = (mesh_h(x, y + e) - mesh_h(x, y - e)) / (2 * e)
    n = math.sqrt(gx * gx + gy * gy + 1); return -gx / n, gy / n          # three xz of the normal (z = -north)

# ---------------- trees & shrubs ----------------
rng = random.Random(SEED + 1)
TREES = {'pine': [], 'gum': [], 'banksia': [], 'shrub': []}
MIND = {'pine': 10.0, 'gum': 6.5, 'banksia': 4.2, 'shrub': 1.7}
RAD = {'pine': 3.0, 'gum': 3.5, 'banksia': 2.2, 'shrub': 0.8}   # trunk/crown clearance against others
occ = {}
def free(x, y, sp):
    m = MIND[sp]; ci, cj = math.floor(x / 10), math.floor(y / 10)
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            for (ox, oy, osp) in occ.get((ci + di, cj + dj), ()):
                dd = MIND[sp] if osp == sp else (RAD[sp] + RAD[osp]) * 0.8
                if (ox - x) ** 2 + (oy - y) ** 2 < dd * dd: return False
    return True
def ok_site(x, y, sp, clear):
    if not (X0 + 2 < x < X0 + (NX - 1) * ST - 2 and Y0 + 2 < y < Y0 + (NY - 1) * ST - 2): return False
    if field(SEAF, x, y) > 0.01: return False
    if field(SAND, x, y) > (0.25 if sp != 'shrub' else 0.15): return False
    rk = field(ROCK, x, y)
    if rk > (0.55 if sp == 'shrub' else 0.4 if sp == 'banksia' else 0.25): return False
    if field(SL, x, y) > (0.9 if sp == 'shrub' else 0.7): return False
    if mesh_h(x, y) < 1.0: return False
    d, _ = path_near(x, -y, clear + 8)
    if d < clear: return False
    if near_building(x, y, 2.5 if sp != 'shrub' else 1.2): return False
    return True
SEAF = [1.0 if s else 0.0 for s in SEA]
def add(sp, x, y, scale, lean=0.0, tint=None):
    hy = ground_h(x, y); nx_, nz_ = mesh_n(x, y)
    lx = lz = 0.0
    if lean:   # lean away from the sea breeze (down the sea-distance gradient = inland)
        gx = field(DS, x + 4, y) - field(DS, x - 4, y); gy = field(DS, x, y + 4) - field(DS, x, y - 4); gl = math.hypot(gx, gy) or 1
        lx, lz = lean * gx / gl, -lean * gy / gl
    TREES[sp].append([round(x, 2), round(hy, 2), round(-y, 2), round(scale, 3), round(rng.random() * 6.283, 2), round(lx, 3), round(lz, 3),
                      round(tint if tint is not None else rng.random(), 2), round(nx_, 3), round(nz_, 3)])
    occ.setdefault((math.floor(x / 10), math.floor(y / 10)), []).append((x, y, sp))

# 1) Norfolk Island pines: the rows behind the beaches (promenade / park edge facing the sea), plus park scatter
for q in TP[::8]:
    x, y = q['x'], -q['z']
    if field(DS, x, y) > 140: continue
    left = (math.cos(q['yaw']), math.sin(q['yaw']))      # three left (cos, -sin) -> route coords (cos, +sin)
    for sd in (-1, 1):
        off = sd * (7.5 + 1.5 * rng.random()); px, py = x + left[0] * off, y + left[1] * off
        # row only on the landward side of a sandy beach / in a park near the sea
        near_sand = max(field(SAND, px + dx, py + dy) for dx, dy in ((14, 0), (-14, 0), (0, 14), (0, -14), (25, 0), (0, 25), (-25, 0), (0, -25)))
        inpark = inside_any(PARK, px, py)
        if not (near_sand > 0.5 or (inpark and field(DS, px, py) < 120)): continue
        if field(DS, px, py) < field(DS, x, y) - 2: continue    # landward side only
        if rng.random() < 0.3 or not ok_site(px, py, 'pine', 5.5) or not free(px, py, 'pine'): continue
        add('pine', px, py, 15 + rng.random() * 9)
for P, (a, b, c, d) in PARK:
    for _ in range(int((b - a) * (d - c) / 900) + 1):
        x, y = a + rng.random() * (b - a), c + rng.random() * (d - c)
        if not poly_contains(P, x, y) or field(DS, x, y) > 220 or rng.random() < 0.5: continue
        if ok_site(x, y, 'pine', 6) and free(x, y, 'pine'): add('pine', x, y, 13 + rng.random() * 10)

# 2) gums, banksias, shrubs: jittered candidates near the path, clumped by noise into groves with open grass between
xs = [q['x'] for q in TP]; ys = [-q['z'] for q in TP]
def candidates(cell, maxd):
    out = []
    gx0, gx1 = math.floor((min(xs) - maxd) / cell), math.ceil((max(xs) + maxd) / cell)
    gy0, gy1 = math.floor((min(ys) - maxd) / cell), math.ceil((max(ys) + maxd) / cell)
    for gi in range(gx0, gx1):
        for gj in range(gy0, gy1):
            out.append(((gi + rng.random()) * cell, (gj + rng.random()) * cell))
    rng.shuffle(out); return out
def pathdist(x, y, cap):
    d, _ = path_near(x, -y, cap); return d
for x, y in candidates(7.0, 230):
    d = pathdist(x, y, 230)
    if d > 230 or d < 4.5: continue
    ds, h = field(DS, x, y), mesh_h(x, y)
    grove = sstep(0.42, 0.68, fbm(x / 48, y / 48, 21))
    dens = (0.55 if d < 45 else 0.32 if d < 120 else 0.2) * grove
    exposed = sstep(140, 50, ds)                       # salt wind near the sea: gums give way to banksia/heath
    park = inside_any(PARK, x, y)
    if park: dens *= 0.35                              # parks are mostly open lawn
    if rng.random() > dens: continue
    sp = 'banksia' if rng.random() < 0.25 + 0.6 * exposed else 'gum'
    if not ok_site(x, y, sp, 4.5 if sp == 'gum' else 5.5) or not free(x, y, sp): continue
    if sp == 'gum': add('gum', x, y, (8 + rng.random() * 8) * (1 - 0.35 * exposed))
    else: add('banksia', x, y, 3.2 + rng.random() * 2.8, lean=0.08 + 0.12 * exposed)
for x, y in candidates(2.6, 70):
    d = pathdist(x, y, 70)
    if d > 70 or d < 2.4: continue
    ds = field(DS, x, y); rk = field(ROCK, x, y)
    heath = sstep(0.4, 0.7, fbm(x / 22 + 9, y / 22, 31))
    dens = (0.12 + 0.55 * sstep(160, 40, ds) * heath + 0.35 * sstep(0.1, 0.35, rk) * (1 - sstep(0.45, 0.6, rk))) * (1.0 if d < 25 else 0.55)
    if inside_any(PARK, x, y): dens *= 0.25
    if rng.random() > dens: continue
    sc = 0.6 + rng.random() * 1.0    # shrub crown radius ~0.85*scale: keep it off the road + 0.6 m and behind the kerb
    if ok_site(x, y, 'shrub', 2.6 + 0.85 * sc) and free(x, y, 'shrub'): add('shrub', x, y, sc, lean=0.1)
print('trees', {k: len(v) for k, v in TREES.items()})

# ---------------- stone kerb along cut banks ----------------
# where the ground beside the road rises above it (cut bank), a low row of rounded sandstone blocks lines the road edge
rng = random.Random(SEED + 3)
KERB = []; kerb_stats = {}
for sd in (1, -1):                    # +1 = left of travel
    step = 2; need = []               # every 0.5 m (TP is 0.25 m)
    for i in range(0, len(TP), step):
        q = TP[i]; lx, lz = math.cos(q['yaw']), -math.sin(q['yaw'])
        bank = max(ground_h(q['x'] + lx * sd * d, -(q['z'] + lz * sd * d)) for d in (2.5, 3.0, 3.6, 4.3)) - q['y']
        need.append(bank)
    m = [b > 0.14 for b in need]; n = len(m)
    m = [any(m[max(0, k - 5):k + 6]) for k in range(n)]                     # bridge short gaps (~2.5 m)
    k = 0; runs = []
    while k < n:
        if m[k]:
            e = k
            while e < n and m[e]: e += 1
            if e - k >= 6: runs.append((k, e))                                 # >= 3 m long, else skip
            k = e
        else: k += 1
    kerb_stats['left' if sd > 0 else 'right'] = round(sum(e - k for k, e in runs) * 0.5)
    cov = [False] * n
    for a_, b_ in runs:
        for k in range(a_, b_): cov[k] = True
    kerb_stats['uncovered>0.2m_' + ('left' if sd > 0 else 'right')] = sum(1 for k in range(n) if need[k] > 0.2 and not cov[k])
    for k0, k1 in runs:
        s0, s1 = TP[k0 * step]['s'], TP[min(len(TP) - 1, (k1 - 1) * step)]['s']; s = s0 + rng.random() * 0.2
        while s < s1:
            L = 0.5 + rng.random() * 0.3; W = 0.32 + rng.random() * 0.12
            i = min(len(TP) - 1, int((s + L / 2) / 0.25)); q = TP[i]; lx, lz = math.cos(q['yaw']), -math.sin(q['yaw'])
            b = need[min(n - 1, i // step)]
            Hh = 0.2 + 0.08 * clamp(b / 1.2, 0, 1) + rng.random() * 0.07           # visible height above the road
            d = sd * (1.6 + 0.05 + W / 2 + rng.random() * 0.04); cx_, cz_ = q['x'] + lx * d, q['z'] + lz * d
            # seat the block in the ground: base = lowest ground under its footprint (minus 5 cm), never floating
            fx, fz = math.sin(q['yaw']), math.cos(q['yaw'])
            gmin = min(ground_h(cx_ + lx * a * W / 2 + fx * c * L / 2, -(cz_ + lz * a * W / 2 + fz * c * L / 2)) for a in (-1, 0, 1) for c in (-1, 0, 1))
            base = min(q['y'] - 0.07, gmin - 0.05)
            KERB.append([round(cx_, 2), round(base, 2), round(cz_, 2), round(q['yaw'] + (rng.random() - 0.5) * 0.18, 3),
                         round(L, 2), round(q['y'] + Hh - base, 2), round(W, 2), round(rng.random(), 2)])
            s += L * (0.7 + rng.random() * 0.1)           # rounded ends overlap: a continuous dry-stone row, no gaps
print('kerb stones', len(KERB), 'metres', kerb_stats)

# ---------------- road decals: painted symbols (bike / pedestrian / arrow) + stains ----------------
rng = random.Random(SEED + 2)
def calm(s, half):   # straight-ish, not too steep -> where a council would paint a symbol
    a, b = int(max(0, s - half) / 0.25), int(min(TOTAL, s + half) / 0.25)
    return all(abs(TP[i]['kap']) < 0.06 and abs(TP[i]['gr']) < 0.07 for i in range(a, min(b, len(TP) - 1)))
DEC = []
s = 25 + rng.random() * 40
while s < TOTAL - 20:
    if calm(s, 3):
        r = rng.random()
        if r < 0.38: DEC.append([round(s, 2), 0.78, 4, 1.0, 0])                     # bike + pedestrian pair in the forward (left) lane
        elif r < 0.6: DEC.append([round(s, 2), 0.78, 0, 1.0, 0]); DEC.append([round(s + 0.0, 2), -0.78, 0, 1.0, 1])   # bike symbol, both lanes
        elif r < 0.78: DEC.append([round(s, 2), 0.78, 1, 1.0, 0])
        else: DEC.append([round(s, 2), 0.78, 2, 1.0, 0]); DEC.append([round(s + 6, 2), -0.78, 2, 1.0, 1])     # direction arrows
        s += 70 + rng.random() * 110
    else: s += 6
n_sym = len(DEC)
s = 3 + rng.random() * 8
while s < TOTAL - 2:
    DEC.append([round(s, 2), round((rng.random() * 2 - 1) * 1.25, 2), 3, round(0.35 + rng.random() ** 2 * 1.3, 2), round(rng.random() * 6.283, 2)])
    s += 6 + rng.random() * 22
print('decals: symbols', n_sym, 'stains', len(DEC) - n_sym)

ENV = {'note': 'baked by tools/env.py (seed %d); see its docstring for the format' % SEED, 'seed': SEED,
       'ground': {'nx': NX, 'ny': NY, 'b64': base64.b64encode(bytes(gb)).decode()},
       'road': {'width': 3.2, 'joint': 2.4, 'trackTotal': round(TOTAL, 2)},
       'trees': {k: [v for t in L for v in t] for k, L in TREES.items()},
       'decals': DEC,
       'kerb': [v for t in KERB for v in t],
       'corridor': {'fs': FS, 'cells': CELL_LIST, 'dcm': base64.b64encode(b''.join(int(v).to_bytes(2, 'little', signed=True) for v in FD)).decode()}}
json.dump(ENV, open(f'{ROOT}/data/env.json', 'w'), separators=(',', ':'))
print('wrote data/env.json', os.path.getsize(f'{ROOT}/data/env.json') // 1024, 'KB')

# ---------------- optional debug map ----------------
try:
    from PIL import Image, ImageDraw
    im = Image.new('RGB', (NX, NY)); px = im.load()
    for j in range(NY):
        for i in range(NX):
            k = idx(i, j)
            if SEA[k]: c = (40, 110, 160)
            else:
                g = GREEN[k]; c = (int(185 - 80 * g), int(175 - 20 * g), int(110 - 40 * g))
                for w, cc in ((DIRT[k], (160, 130, 95)), (ROCK[k], (150, 135, 115)), (SAND[k], (236, 215, 160))):
                    c = tuple(int(a + (b - a) * w) for a, b in zip(c, cc))
            px[i, NY - 1 - j] = c
    im = im.resize((NX * 4, NY * 4), Image.NEAREST); dr = ImageDraw.Draw(im)
    P = lambda x, y: ((x - X0) / ST * 4, (NY - 1 - (y - Y0) / ST) * 4)
    dr.line([P(q['x'], -q['z']) for q in TP[::8]], fill=(250, 250, 250), width=2)
    for sp, col in (('pine', (10, 60, 20)), ('gum', (90, 120, 60)), ('banksia', (60, 90, 40)), ('shrub', (110, 130, 70))):
        for t in TREES[sp]:
            a, b = P(t[0], -t[2]); r = 3 if sp == 'pine' else 2 if sp != 'shrub' else 1
            dr.ellipse((a - r, b - r, a + r, b + r), fill=col)
    im.save(f'{ROOT}/data/cache/env_debug.png'); print('debug map data/cache/env_debug.png')
except ImportError: pass
