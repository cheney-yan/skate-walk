"""Bake the sea mask + distance-to-shore field from OSM coastline onto the terrain grid (offline, once).
Writes route.json['shore'] = {b64: uint8 grid (0 = land, else metres*4 from the shoreline, capped 255)}."""
import json, base64, math
import numpy as np
R = json.load(open('data/route.json')); T = R['terrain']
segs = [c['line'][:] for c in R['coast'] if c['kind'] == 'coastline']
key = lambda p: (round(p[0], 1), round(p[1], 1))
line = segs.pop(0)
for _ in range(60):
    hit = False
    for i, s in enumerate(segs):
        if key(s[0]) == key(line[-1]): line += segs.pop(i)[1:]; hit = True; break
        if key(s[-1]) == key(line[0]): line = segs.pop(i) + line[1:]; hit = True; break
    if not hit: break
L = np.array(line, float)
poly = np.vstack([L, [[4000, L[-1, 1]], [4000, L[0, 1]]]])
xs = T['x0'] + np.arange(T['nx']) * T['step']; ys = T['y0'] + np.arange(T['ny']) * T['step']
X, Y = np.meshgrid(xs, ys)  # [ny, nx]
inside = np.zeros(X.shape, bool)
for i in range(len(poly)):
    (x1, y1), (x2, y2) = poly[i - 1], poly[i]
    cond = (y1 > Y) != (y2 > Y)
    xint = (x2 - x1) * (Y - y1) / ((y2 - y1) if y2 != y1 else 1e-9) + x1
    inside ^= cond & (X < xint)
d = np.full(X.shape, 1e9)
for i in range(1, len(L)):
    a, b = L[i - 1], L[i]; ab = b - a; l2 = max(ab @ ab, 1e-9)
    u = np.clip(((X - a[0]) * ab[0] + (Y - a[1]) * ab[1]) / l2, 0, 1)
    d = np.minimum(d, np.hypot(X - a[0] - u * ab[0], Y - a[1] - u * ab[1]))
g = np.where(inside, np.clip(np.round(d * 4), 1, 255), 0).astype(np.uint8)
R['shore'] = {'b64': base64.b64encode(g.tobytes()).decode(), 'note': 'row-major [ny][nx], 0=land, else metres*4 to OSM coastline'}
json.dump(R, open('data/route.json', 'w'), separators=(',', ':'))
print('coast pts', len(L), 'sea cells', int(inside.sum()), '/', inside.size, 'chained ways left', len(segs))
