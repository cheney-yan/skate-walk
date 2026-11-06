#!/usr/bin/env python3
"""Build data/route.json from real open data:
- OSM (Overpass dump data/osm_raw.json): walkable graph -> shortest path Bondi -> Bronte,
  crossings / traffic signals / steps on the route, nearby buildings, coastline.
- AWS Terrain Tiles (terrarium, z15): elevation along the route.
- Wikipedia geosearch + Wikimedia Commons geosearch: collectible cards along the route.
"""
import json, math, heapq, io, os, urllib.request, urllib.parse, time
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "skate-walk-demo/0.1 (cheney personal prototype)"}
START = (-33.8913, 151.2752)   # south end of Bondi Beach promenade
END = (-33.9030, 151.2681)     # Bronte Beach

import hashlib
CACHE = f"{ROOT}/data/cache"; os.makedirs(CACHE, exist_ok=True)
def get(url, binary=False):
    f = f"{CACHE}/{hashlib.md5(url.encode()).hexdigest()}"
    if os.path.exists(f):
        b = open(f, "rb").read(); return b if binary else json.loads(b)
    req = urllib.request.Request(url, headers=UA)
    for i in range(6):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                b = r.read()
                open(f, "wb").write(b)
                time.sleep(1.5)
                return b if binary else json.loads(b)
        except Exception as e:
            print("retry", url[:80], e); time.sleep(5 * (i + 1))
    raise RuntimeError(url)

def hav(a, b):
    R = 6371000
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2-la1)/2)**2 + math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
    return 2*R*math.asin(math.sqrt(h))

els = json.load(open(f"{ROOT}/data/osm_raw.json"))["elements"]
WALK = {"footway", "path", "pedestrian", "cycleway", "steps", "residential", "living_street", "service", "tertiary", "unclassified"}
graph = {}; coord = {}; edge_tag = {}
for e in els:
    t = e.get("tags", {})
    if e["type"] != "way" or t.get("highway") not in WALK: continue
    nodes, geom = e["nodes"], e["geometry"]
    for n, g in zip(nodes, geom): coord[n] = (g["lat"], g["lon"])
    cost_mul = {"footway": 1.0, "pedestrian": 1.0, "path": 1.1, "cycleway": 1.1, "steps": 1.6, "living_street": 1.3}.get(t["highway"], 2.0)
    if "Coastal Walk" in t.get("name", "") or "romenade" in t.get("name", ""): cost_mul *= 0.6
    for a, b in zip(nodes, nodes[1:]):
        d = hav(coord[a], coord[b])
        graph.setdefault(a, []).append((b, d*cost_mul)); graph.setdefault(b, []).append((a, d*cost_mul))
        edge_tag[(a, b)] = edge_tag[(b, a)] = t

near = lambda p: min(coord, key=lambda n: hav(coord[n], p) if n in graph else 1e9)
s, g = near(START), near(END)
dist = {s: 0}; prev = {}; pq = [(0, s)]
while pq:
    d, u = heapq.heappop(pq)
    if u == g: break
    if d > dist[u]: continue
    for v, w in graph[u]:
        if d+w < dist.get(v, 1e18): dist[v] = d+w; prev[v] = u; heapq.heappush(pq, (d+w, v))
path = [g]
while path[-1] != s: path.append(prev[path[-1]])
path.reverse()

# local metric frame (x east, z south -> we use x east, y north in metres)
lat0, lon0 = START
def xy(p): return ((p[1]-lon0)*111320*math.cos(math.radians(lat0)), (p[0]-lat0)*110540)

# elevation from terrarium tiles
Z = 15; tiles = {}
def tile_px(lat, lon):
    n = 2**Z; x = (lon+180)/360*n
    y = (1-math.log(math.tan(math.radians(lat))+1/math.cos(math.radians(lat)))/math.pi)/2*n
    return x, y
def elev(lat, lon):
    x, y = tile_px(lat, lon); tx, ty = int(x), int(y)
    if (tx, ty) not in tiles:
        b = get(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png", True)
        tiles[(tx, ty)] = Image.open(io.BytesIO(b)).convert("RGB")
    px = tiles[(tx, ty)].getpixel((min(255, int((x-tx)*256)), min(255, int((y-ty)*256))))
    return px[0]*256 + px[1] + px[2]/256 - 32768

pts = []; s_acc = 0
for i, n in enumerate(path):
    p = coord[n]
    if i: s_acc += hav(coord[path[i-1]], p)
    t = edge_tag.get((path[i-1], n), {}) if i else {}
    x, y = xy(p)
    pts.append({"lat": p[0], "lon": p[1], "x": round(x, 2), "y": round(y, 2), "s": round(s_acc, 1),
                "e": round(max(0, elev(*p)), 1), "hw": t.get("highway", ""), "name": t.get("name", "")})
# smooth elevation (terrain tiles are ~5m pixels, noisy at cliffs)
es = [p["e"] for p in pts]
for i, p in enumerate(pts):
    w = [es[j] for j in range(len(es)) if abs(pts[j]["s"]-p["s"]) < 25]
    p["e"] = round(sum(w)/len(w), 1)

route_nodes = {n: pts[i]["s"] for i, n in enumerate(path)}
stops = []
for e in els:
    if e["type"] == "node" and e["id"] in route_nodes:
        h = e.get("tags", {}).get("highway")
        if h in ("crossing", "traffic_signals"):
            stops.append({"s": route_nodes[e["id"]], "kind": "signals" if h == "traffic_signals" or e["tags"].get("crossing") == "traffic_signals" else "crossing"})
# also: where the route crosses a road (route node shared with a car road)
car = {"residential", "tertiary", "secondary", "primary", "unclassified"}
road_nodes = set()
for e in els:
    if e["type"] == "way" and e.get("tags", {}).get("highway") in car: road_nodes.update(e["nodes"])
for n, sv in route_nodes.items():
    if n in road_nodes and pts[0]["s"] < sv and not any(abs(st["s"]-sv) < 15 for st in stops):
        stops.append({"s": sv, "kind": "road"})
stops.sort(key=lambda a: a["s"])

def dist_to_route(p):
    return min(hav(p, (q["lat"], q["lon"])) for q in pts[::2])

buildings = []
for e in els:
    t = e.get("tags", {})
    if e["type"] == "way" and "building" in t:
        g = [(q["lat"], q["lon"]) for q in e["geometry"]]
        c = (sum(a for a, _ in g)/len(g), sum(b for _, b in g)/len(g))
        if dist_to_route(c) > 220: continue
        h = float(t.get("height", 0) or 0) or (float(t.get("building:levels", 0) or 0)*3.2) or 7
        buildings.append({"poly": [list(map(lambda v: round(v, 1), xy(q))) for q in g], "h": round(h, 1), "base": round(max(0, elev(*c)), 1)})

coast = []
for e in els:
    t = e.get("tags", {})
    if e["type"] == "way" and t.get("natural") in ("coastline", "beach", "cliff"):
        coast.append({"kind": t["natural"], "line": [list(map(lambda v: round(v, 1), xy((q["lat"], q["lon"])))) for q in e["geometry"]]})

# collectibles: Wikipedia articles + Commons photos near route
cards = {}
for q in pts[::max(1, len(pts)//8)]:
    w = get("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "generator": "geosearch", "ggscoord": f"{q['lat']}|{q['lon']}", "ggsradius": 350, "ggslimit": 10,
        "prop": "extracts|pageimages|coordinates", "exintro": 1, "explaintext": 1, "exsentences": 3, "piprop": "thumbnail", "pithumbsize": 640, "format": "json"}))
    for p in w.get("query", {}).get("pages", {}).values():
        if "coordinates" not in p or "shooting" in p["title"].lower(): continue
        c = (p["coordinates"][0]["lat"], p["coordinates"][0]["lon"])
        cards.setdefault("w"+str(p["pageid"]), {"type": "wiki", "title": p["title"], "text": p.get("extract", "")[:420],
            "img": p.get("thumbnail", {}).get("source"), "lat": c[0], "lon": c[1], "url": f"https://en.wikipedia.org/?curid={p['pageid']}"})
    c = get("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "generator": "geosearch", "ggscoord": f"{q['lat']}|{q['lon']}", "ggsradius": 250, "ggsnamespace": 6, "ggslimit": 12,
        "prop": "imageinfo|coordinates", "iiprop": "url|user|extmetadata", "iiurlwidth": 640,
        "iiextmetadatafilter": "LicenseShortName|DateTimeOriginal|ImageDescription|Artist", "format": "json"}))
    for p in c.get("query", {}).get("pages", {}).values():
        if "coordinates" not in p: continue
        ii = p["imageinfo"][0]; m = ii.get("extmetadata", {})
        import re
        clean = lambda s: re.sub(r"<[^>]+>", "", s or "").strip()
        title = p["title"][5:].rsplit(".", 1)[0]
        if not ii.get("thumburl") or not ii["thumburl"].lower().split("?")[0].endswith((".jpg", ".jpeg", ".png")): continue
        cards.setdefault("c"+str(p["pageid"]), {"type": "photo", "title": title, "text": clean(m.get("ImageDescription", {}).get("value"))[:300],
            "img": ii["thumburl"], "author": clean(m.get("Artist", {}).get("value")) or ii.get("user"),
            "license": m.get("LicenseShortName", {}).get("value"), "date": clean(m.get("DateTimeOriginal", {}).get("value"))[:30],
            "lat": p["coordinates"][0]["lat"], "lon": p["coordinates"][0]["lon"], "url": ii.get("descriptionurl")})
    time.sleep(0.3)

# project each card onto the route (arc-length s) and keep ones within 180 m
out_cards = []
for k, c in cards.items():
    j = min(range(len(pts)), key=lambda i: hav((c["lat"], c["lon"]), (pts[i]["lat"], pts[i]["lon"])))
    d = hav((c["lat"], c["lon"]), (pts[j]["lat"], pts[j]["lon"]))
    if d > 180: continue
    year = None
    import re
    m = re.search(r"(18|19|20)\d\d", (c.get("date") or "") + " " + c["title"])
    if m: year = int(m.group(0))
    c.update({"id": k, "s": pts[j]["s"], "d": round(d), "year": year,
              "rare": bool(year and year < 1960)})
    out_cards.append(c)
out_cards.sort(key=lambda c: c["s"])

json.dump({"start": START, "end": END, "length": pts[-1]["s"], "pts": pts, "stops": stops, "buildings": buildings,
           "coast": coast, "cards": out_cards,
           "sources": ["© OpenStreetMap contributors (ODbL)", "Elevation: AWS Terrain Tiles / Mapzen (various, see tilezen joerd attribution)",
                       "Wikipedia (CC BY-SA)", "Wikimedia Commons (per-file licence shown on card)"]},
          open(f"{ROOT}/data/route.json", "w"), ensure_ascii=False)
print("route m", pts[-1]["s"], "pts", len(pts), "stops", len(stops), "bldg", len(buildings), "cards", len(out_cards),
      "wiki", sum(c["type"] == "wiki" for c in out_cards), "rare", sum(c["rare"] for c in out_cards))
print("elev min/max", min(p["e"] for p in pts), max(p["e"] for p in pts))
print([ (round(s["s"]), s["kind"]) for s in stops])
