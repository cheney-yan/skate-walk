# Data sources & licences (Bondi route)

What feeds the baked data, how it is used, and what attribution it needs. Raw downloads are cached in
`tools/cache/` (gitignored); only small derived files are committed (`data/route.json`, `data/landcover.json`,
`data/env.json`).

| Data | Used for | Licence / terms | Attribution |
|---|---|---|---|
| OpenStreetMap (Overpass dump `data/osm_raw.json`) | path, buildings, coast/cliff lines, beaches, parks | ODbL 1.0 | © OpenStreetMap contributors |
| AWS Terrain Tiles (Mapzen/tilezen joerd) | terrain heights | various open (see tilezen joerd attribution) | see joerd attribution |
| **ESA WorldCover 10 m 2021 v200**, tile `S36E150` (`s3://esa-worldcover/v200/2021/map/`, COG range read of the route bbox only) | ground class per terrain vertex (tree / shrub / grass / built / bare / water fractions), tree & shrub density | **CC BY 4.0** — derived products allowed | © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium |
| **Sentinel-2 L2A** true colour (TCI 10 m), Element84 earth-search STAC `sentinel-2-c1-l2a`, tile 56HLH; 10 scenes Oct 2024 – Mar 2025 with < 1 % cloud, per-pixel median | grass green-ness / straw tint per vertex (smoothed, excess-green index) | Copernicus data policy: free, full and open, derived use allowed | Contains modified Copernicus Sentinel data 2024–2025 |
| NSW Spatial Services imagery (`maps.six.nsw.gov.au/.../public/NSW_Imagery/MapServer`) | **display only**: map view "卫星 / 对比" tiles; plus the offline coast-alignment check (`tools/cache/align.py`, numbers reported, nothing baked) | Spatial Services applies **CC BY 4.0** (portal licence text); "derived products must mark the date of extraction"; imagery itself contains third-party (AAM, Jacobs/Ausimage, Airbus SPOT) material | Imagery © Spatial Services NSW, Department of Customer Service (shown in the map) |
| Esri World Imagery (`server.arcgisonline.com/.../World_Imagery`) | **display only**, alternative tile source in the map | Esri terms of use; display with attribution, no data extraction | Esri, Maxar, Earthstar Geographics, and the GIS User Community (shown in the map) |
| Google Maps / Google Earth | **links only** (open the same lat/lon) | Google ToS forbid deriving content from their imagery — never sampled | — |

Decision: the NSW aerial is CC BY 4.0, but it mixes third-party imagery and asks for extraction dates on derived
products, so the bake does NOT derive anything from it; WorldCover + Sentinel-2 are cleanly open and enough at the
8 m terrain-grid resolution. NSW/Esri tiles are only shown side by side for visual comparison.

Re-run: `tools/landcover.py` (needs the venv in `tools/cache/.venv`: rasterio numpy scipy pillow) writes
`data/landcover.json`; `python3 tools/env.py` (stdlib only) reads it. `ENV_NO_LC=1 python3 tools/env.py` reproduces
the old rule-only bake byte-for-byte.
