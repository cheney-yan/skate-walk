# 滑板散步 skate-walk (prototype)

**Live demo:**
- 🛹 Character lab (girl + longboard physics, 360° view): https://cheney-yan.github.io/skate-walk/lab.html
  - drag = orbit 360°, pinch/wheel = zoom, double-tap = back behind her. `?outfit=white` = white dress + straw hat.
- 🌊 Same girl on the real Bondi → Bronte coastal walk (OSM path, AWS terrain, OSM buildings as white blocks): https://cheney-yan.github.io/skate-walk/lab.html?route=bondi
- 🗺️ Early route demo (Bondi → Bronte, real OSM + terrain + Wikipedia postcards): https://cheney-yan.github.io/skate-walk/

A calm "skate stroll" toy: she rides by herself along real places, you push occasionally, collect real postcards. Not a thrill game.

Character model: *Sendagaya Shino* (VRoid sample, CC0). three.js r170 + @pixiv/three-vrm (MIT). Skirt cloth, ribbon, hair wind, board physics, gaze = hand-written in `js/`.

---
# 滑板散步 (skate-walk) — prototype

Casual "skate stroll" along the real Bondi → Bronte coastal walk. The girl rides by herself; swipe up = push, swipe down = slow.
She stops at OSM crossings / Notts Ave, carries the board on OSM `steps`, slows on real uphill (AWS terrain).
Calm riding fills 🪶; tricks only unlock in open, non-crowded, flat stretches. Fast downhill = soft sit-down, no penalty.
Real collectibles: Wikipedia geosearch articles + Wikimedia Commons geotagged photos (★ = pre-1960 photos). Postcard share = canvas JPEG + Web Share + `?card=<id>&from=` link.

- Build data: `python3 tools/build_route.py && python3 tools/curate.py && python3 tools/terrain.py` (then the card-cleanup snippets were applied by hand; data/route.json is the source of truth)
- Serve: `python3 server.py` (127.0.0.1:8797) + `tailscale serve --bg --https=13443 http://127.0.0.1:8797`
- Sources/licences: © OpenStreetMap contributors (ODbL); AWS Terrain Tiles (Mapzen/tilezen attribution); Wikipedia CC BY-SA; Commons per-file licence on each card.
