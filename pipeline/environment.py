"""Real surroundings for every circuit, from OpenStreetMap.

Run after align.py (which fits each circuit onto the real map). For every circuit this fetches
what is really there around the track and exports it in real-world metres; for every session it
fits that session's track and works out whether the session ran at night.

Exported per circuit (web/public/data/env/<circuit>.json), all in metres east/north of the
circuit's lat0/lon0:
- buildings: footprint, height (the height tag, else levels x 3.2 m, else a typical height for
  the building type), min_height for raised roofs, and whether it is a grandstand;
- water: lakes, rivers, marinas, reservoirs, and the sea along mapped coastlines;
- wood and grass areas; trees (inside mapped woods, along tree rows, single mapped trees);
- Ferris wheels (attraction=big_wheel) at their mapped position.
Nothing is placed unless OpenStreetMap maps it. Anything a map shape puts on the track itself
(Monaco's tunnel under the hotel) is cut back from the road, so the car never meets a wall.

web/public/data/env/index.json maps each session to its circuit file, its transform and its
light (day, dusk or night, from the sun's altitude at the circuit 30 minutes into the session).

Map data (c) OpenStreetMap contributors, ODbL. Run: .venv/Scripts/python.exe environment.py
"""
import json
import math
import re
import time
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import requests
from scipy.spatial import cKDTree
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.ops import linemerge, polygonize, unary_union

import align as A

ROOT = Path(__file__).parent
WEB = ROOT.parent / "web" / "public" / "data"
OUT = WEB / "env"
CACHE = ROOT / "raw" / "osm"
REACH = 900  # metres from the track: features further out are not used
MARGIN = 1100  # metres of map fetched around the track
CORRIDOR = 9  # metres either side of the centreline kept clear (road plus kerb)
MAX_BUILDINGS = 4500
MAX_TREES = 7000

FEATURES = """[out:json][timeout:240];
(
  way["building"]({b});
  relation["building"]({b});
  way["natural"~"^(water|wood|coastline|tree_row)$"]({b});
  relation["natural"~"^(water|wood)$"]({b});
  way["waterway"="riverbank"]({b});
  way["landuse"~"^(forest|reservoir|basin|grass|meadow|recreation_ground|village_green)$"]({b});
  relation["landuse"~"^(forest|reservoir|basin|grass|meadow)$"]({b});
  way["leisure"~"^(park|golf_course|marina|pitch)$"]({b});
  relation["leisure"~"^(park|golf_course|marina)$"]({b});
  node["natural"="tree"]({b});
  node["attraction"="big_wheel"]({b});
  way["attraction"="big_wheel"]({b});
);
out geom;"""

# Right beside the track: gravel traps, tarmac run-off, the pit lane, car parks, verges, bleachers.
TRACKSIDE = """[out:json][timeout:240];
(
  way["natural"~"^(sand|scree|shingle|bare_rock|grassland|scrub|heath)$"]({b});
  way["surface"~"^(asphalt|concrete|paved|gravel|fine_gravel|sand|grass|compacted|paving_stones)$"]["area"="yes"]({b});
  way["surface"~"^(asphalt|concrete|paved|gravel|fine_gravel|sand|grass|compacted|paving_stones)$"][!"highway"][!"building"]({b});
  way["area:highway"]({b});
  way["amenity"="parking"]({b});
  relation["amenity"="parking"]({b});
  way["leisure"~"^(bleachers)$"]({b});
  way["raceway"="pit_lane"]({b});
  way["highway"="raceway"]["service"="pit_lane"]({b});
);
out geom;"""
GRAVEL = {"sand", "scree", "shingle", "bare_rock", "gravel", "fine_gravel"}
TARMAC = {"asphalt", "concrete", "paved", "compacted", "paving_stones"}

DEFAULT_HEIGHT = {
    "grandstand": 12, "stadium": 18, "house": 7, "detached": 7, "semidetached_house": 7, "terrace": 8,
    "residential": 10, "apartments": 16, "commercial": 12, "retail": 8, "office": 15, "hotel": 20,
    "industrial": 9, "warehouse": 9, "hangar": 10, "garage": 3, "garages": 3, "shed": 3, "hut": 3,
    "roof": 5, "carport": 3, "kiosk": 3, "service": 4, "transformer_tower": 6, "church": 14,
}


# ---------- colour ----------

NAMED = {
    "white": "#f2f0ea", "black": "#2a2a2a", "grey": "#8f8f8f", "gray": "#8f8f8f", "lightgrey": "#c8c8c8",
    "lightgray": "#c8c8c8", "darkgrey": "#555555", "darkgray": "#555555", "silver": "#c0c0c0", "red": "#b0412e",
    "darkred": "#7a2a20", "brown": "#7b5a3c", "beige": "#d9c9a8", "tan": "#c9ae86", "cream": "#efe4c8",
    "yellow": "#e2c25a", "orange": "#d98a3d", "green": "#5f8f4e", "darkgreen": "#3f6a35", "blue": "#4f74a8",
    "lightblue": "#9cbdd8", "navy": "#2c4087", "teal": "#3f8a8a", "pink": "#d9a0a0", "maroon": "#6b2a2a",
    "olive": "#7d7a45", "sand": "#d8c49a", "terracotta": "#b5643c",
}

# Typical wall and roof colours by building type, when the map gives none. Real towns are mostly
# warm renders, brick and stone with terracotta or slate roofs; offices are pale stone and glass;
# sheds and stands are grey steel.
WALLS = {
    "house": ["#e8dcc6", "#d9c3a0", "#c98f6b", "#efe6d6"], "residential": ["#e4d6bd", "#d6c2a2", "#cfa784", "#ece3d3"],
    "apartments": ["#e6dccb", "#d2c5b0", "#c9b08e", "#dfe0dc"], "commercial": ["#d9d6cf", "#c7ccd1", "#e6e1d6"],
    "office": ["#cfd6dc", "#bcc6cf", "#e2e2dc"], "retail": ["#e3ddd0", "#d4cfc4"], "hotel": ["#e8e0d0", "#d6dbe0"],
    "industrial": ["#a9adb0", "#b8b4aa", "#9fa6a8"], "warehouse": ["#aeb2b4", "#bdb8ad"], "hangar": ["#a7acb0"],
    "grandstand": ["#3d4650"], "stadium": ["#3d4650"], "church": ["#d8cbb0"],
}
ROOFS = {
    "house": ["#a5533a", "#8e4a35", "#5d5f63"], "residential": ["#a5533a", "#6d6f73", "#8e4a35"],
    "apartments": ["#6d6f73", "#8e4a35"], "industrial": ["#8a9094", "#9aa0a3"], "warehouse": ["#8a9094"],
}


def hexcolour(v):
    """An OSM colour tag ('#aabbcc', '#abc', or a name) as '#rrggbb', else None."""
    if not v:
        return None
    v = str(v).strip().lower().replace(" ", "")
    if re.fullmatch(r"#[0-9a-f]{6}", v):
        return v
    if re.fullmatch(r"#[0-9a-f]{3}", v):
        return "#" + "".join(c * 2 for c in v[1:])
    return NAMED.get(v)


def pick(options, seed):
    return options[seed % len(options)]


# ---------- geometry from Overpass ----------

def number(v):
    """'12', '12 m', '12.5m' -> 12.5; anything else -> None."""
    if v is None:
        return None
    m = re.match(r"^\s*([0-9]+(?:\.[0-9]+)?)", str(v))
    return float(m.group(1)) if m else None


def ring(geom, proj):
    return [proj(p["lat"], p["lon"]) for p in geom]


def way_polygon(el, proj):
    g = el.get("geometry") or []
    if len(g) < 4 or (g[0]["lat"], g[0]["lon"]) != (g[-1]["lat"], g[-1]["lon"]):
        return None
    p = Polygon(ring(g, proj))
    return p if p.is_valid else p.buffer(0)


def relation_polygon(el, proj):
    """A multipolygon relation: outer rings minus inner rings, from member geometry."""
    outer, inner = [], []
    for m in el.get("members", []):
        g = m.get("geometry")
        if m.get("type") != "way" or not g or len(g) < 2:
            continue
        (inner if m.get("role") == "inner" else outer).append(LineString(ring(g, proj)))
    if not outer:
        return None
    # Map data is not always clean: repair each piece (buffer(0)) before joining them.
    shape = unary_union([p.buffer(0) for p in polygonize(linemerge(outer))])
    if inner:
        shape = shape.difference(unary_union([p.buffer(0) for p in polygonize(linemerge(inner))]))
    return shape if not shape.is_empty else None


def sea(coast_ways, frame, proj):
    """The sea inside `frame`, from coastline ways (OSM draws coastlines with the water on the
    right). Split the frame by the coastline and keep the pieces on the water side."""
    lines = [LineString(ring(w["geometry"], proj)) for w in coast_ways if len(w.get("geometry") or []) > 1]
    if not lines:
        return None
    merged = unary_union(lines)
    coast = linemerge(merged) if merged.geom_type == "MultiLineString" else merged
    pieces = list(polygonize(unary_union([coast, frame.exterior])))
    segs = []
    for line in getattr(coast, "geoms", [coast]):
        c = list(line.coords)
        segs += list(zip(c[:-1], c[1:]))
    if not segs:
        return None
    mids = np.array([((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in segs])
    tree = cKDTree(mids)
    water = []
    for piece in pieces:
        p = piece.representative_point()
        _, i = tree.query((p.x, p.y))
        (ax, ay), (bx, by) = segs[i]
        if (bx - ax) * (p.y - ay) - (by - ay) * (p.x - ax) < 0:  # right of the coastline
            water.append(piece)
    return unary_union(water) if water else None


def polygons(shape):
    if shape is None or shape.is_empty:
        return []
    if isinstance(shape, Polygon):
        return [shape]
    if isinstance(shape, MultiPolygon):
        return list(shape.geoms)
    return [g for g in getattr(shape, "geoms", []) if isinstance(g, Polygon)]


def flat(coords):
    return [round(v, 1) for xy in coords for v in xy]


def rings_of(poly):
    return [flat(poly.exterior.coords[:-1])] + [flat(r.coords[:-1]) for r in poly.interiors]


# ---------- sun ----------

def sun_altitude(when, lat, lon):
    """Solar altitude in degrees (NOAA approximation, good to about a degree)."""
    doy = when.timetuple().tm_yday
    hour = when.hour + when.minute / 60
    g = 2 * math.pi / 365 * (doy - 1 + (hour - 12) / 24)
    decl = 0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g) \
        + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g)
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g)
                    - 0.040849 * math.sin(2 * g))
    solar_minutes = hour * 60 + eqt + 4 * lon
    ha = math.radians(solar_minutes / 4 - 180)
    la = math.radians(lat)
    sin_alt = math.sin(la) * math.sin(decl) + math.cos(la) * math.cos(decl) * math.cos(ha)
    return math.degrees(math.asin(max(-1, min(1, sin_alt))))


def light(session_key, lat, lon):
    s = json.loads((ROOT / "raw" / str(session_key) / "session.json").read_text(encoding="utf-8"))
    start = datetime.fromisoformat(s["date_start"])
    alt = sun_altitude(start + timedelta(minutes=30), lat, lon)
    return ("night" if alt < -4 else "dusk" if alt < 8 else "day"), round(alt, 1)


# ---------- per-session fit ----------

def refine(track_c, target, M, t):
    """ICP from a known transform; returns (M, t, fit)."""
    tree = cKDTree(target)
    for _ in range(40):
        p = track_c @ M.T + t
        dist, j = tree.query(p)
        ok = dist < 25
        if ok.sum() < 0.5 * len(track_c):
            break
        s, R, tt = A.umeyama(track_c[ok], target[j[ok]])
        M, t = s * R, tt
    dist, _ = tree.query(track_c @ M.T + t)
    return M, t, {"within10": float(np.mean(dist < 10)), "rms": float(np.sqrt(np.mean(np.minimum(dist, 40) ** 2)))}


def fetch_features(name, bbox, query=FEATURES, kind="features"):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{name.replace(' ', '_')}-{kind}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    q = query.replace("{b}", ",".join(f"{v:.6f}" for v in bbox))
    for attempt in range(6):
        r = requests.post(A.OVERPASS, data={"data": q}, headers={"User-Agent": "blindlap-env/0.1"}, timeout=300)
        if r.status_code == 200:
            path.write_text(r.text, encoding="utf-8")
            time.sleep(5)
            return r.json()
        time.sleep(15 + attempt * 20)
    raise RuntimeError(f"Overpass failed for {name}: {r.status_code}")


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def main():
    alignment = json.loads((ROOT / "model_out" / "alignment.json").read_text(encoding="utf-8"))
    index = json.loads((WEB / "index.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    sessions_out = {}
    summary = []
    for name, al in sorted(alignment.items()):
        if not al.get("ok"):
            print(f"{name}: not aligned, skipped")
            continue
        lat0, lon0 = al["lat0"], al["lon0"]
        proj = lambda la, lo: A.project(la, lo, lat0, lon0)
        M0, t0, off0 = np.array(al["M"]), np.array(al["t"]), np.array(al["offset"])

        # The reference session's track, in world metres, defines where features matter.
        ref = json.loads((WEB / "sessions" / f"{al['session']}.json").read_text(encoding="utf-8"))["track"]
        track = A.resample(np.array(ref["x"]), np.array(ref["y"]), 5.0)
        world_track = (track - off0) @ M0.T + t0
        line = LineString(np.r_[world_track, world_track[:1]])
        corridor = line.buffer(CORRIDOR)
        near = line.buffer(REACH)

        # Every session at this circuit gets its own transform (refined from the reference).
        race = A.ways_xy(A.fetch(name, "raceway"), lat0, lon0)
        road = A.ways_xy(A.fetch(name, "roads"), lat0, lon0) if al["source"] != "raceway" else []
        target = A.densify(race + road)
        for s in [x for x in index["sessions"] if x["circuit"] == name]:
            t = json.loads((WEB / "sessions" / f"{s['key']}.json").read_text(encoding="utf-8"))["track"]
            tr = A.resample(np.array(t["x"]), np.array(t["y"]), 5.0)
            off = tr.mean(0)
            M, tv, fit = refine(tr - off, target, M0, t0 + M0 @ (off - off0))
            if fit["within10"] < 0.9:
                M, tv, f2 = A.align(tr - off, target)
                fit = {"within10": f2["within10"], "rms": f2["rms"]}
            lit, alt = light(s["key"], lat0, lon0)
            sessions_out[str(s["key"])] = {
                "env": slug(name), "M": M.round(6).tolist(), "t": tv.round(3).tolist(), "offset": off.round(3).tolist(),
                "light": lit, "sun": alt, "within10": round(fit["within10"], 3),
            }
            print(f"  {name} {s['year']}: fit {fit['within10']:.0%} within 10 m, sun {alt:+.0f} deg -> {lit}", flush=True)

        # Fetch what is around the track.
        lo = world_track.min(0) - MARGIN
        hi = world_track.max(0) + MARGIN
        lat_lo, lat_hi = lat0 + lo[1] / 110540.0, lat0 + hi[1] / 110540.0
        k = math.cos(math.radians(lat0)) * 111320.0
        lon_lo, lon_hi = lon0 + lo[0] / k, lon0 + hi[0] / k
        data = fetch_features(name, (lat_lo, lon_lo, lat_hi, lon_hi))
        frame = box(lo[0], lo[1], hi[0], hi[1])

        buildings, water, wood, grass, trees, wheels, coast = [], [], [], [], [], [], []
        broken = 0
        for el in data.get("elements", []):
            tags = el.get("tags", {})
            if el["type"] == "node":
                pt = proj(el["lat"], el["lon"])
                if tags.get("attraction") == "big_wheel":
                    wheels.append([round(pt[0], 1), round(pt[1], 1), number(tags.get("height")) or 60])
                elif tags.get("natural") == "tree":
                    trees.append(pt)
                continue
            if tags.get("natural") == "coastline":
                coast.append(el)
                continue
            if tags.get("natural") == "tree_row" and el["type"] == "way":
                g = el.get("geometry") or []
                if len(g) > 1:
                    ln = LineString(ring(g, proj))
                    trees += [ln.interpolate(d).coords[0] for d in np.arange(0, ln.length, 8.0)]
                continue
            try:
                shape = way_polygon(el, proj) if el["type"] == "way" else relation_polygon(el, proj)
                if shape is None or shape.is_empty or not shape.intersects(near):
                    continue
            except Exception:
                broken += 1  # one malformed map feature must not stop the circuit
                continue
            # A wheel that is also tagged as a building or grandstand is a mistagged stand (Suzuka has
            # one, named "S"): keep it as a building, not a second wheel.
            if tags.get("attraction") == "big_wheel" and "building" not in tags:
                c = shape.centroid
                wheels.append([round(c.x, 1), round(c.y, 1), number(tags.get("height")) or 60])
            elif "building" in tags:
                kind = tags["building"]
                stand = kind in ("grandstand", "stadium")
                h = number(tags.get("height"))
                if h is None and number(tags.get("building:levels")) is not None:
                    h = number(tags["building:levels"]) * 3.2 + 1
                h = h or DEFAULT_HEIGHT.get(kind, 8)
                minh = number(tags.get("min_height"))
                if minh is None and number(tags.get("building:min_level")) is not None:
                    minh = number(tags["building:min_level"]) * 3.2
                minh = min(minh or 0, h - 1)
                seed = int(el.get("id", 0))
                wall = hexcolour(tags.get("building:colour") or tags.get("colour")) or pick(WALLS.get(kind, WALLS["commercial"]), seed)
                roof = hexcolour(tags.get("roof:colour")) or pick(ROOFS.get(kind, [wall]), seed // 7)
                if shape.intersects(corridor):
                    shape = shape.difference(corridor.buffer(1))
                for poly in polygons(shape):
                    if poly.area >= 15:
                        buildings.append((poly.distance(line), poly.simplify(0.6), round(h, 1), round(minh, 1), stand, wall, roof))
            elif tags.get("natural") == "water" or tags.get("waterway") == "riverbank" or tags.get("landuse") in ("reservoir", "basin") or tags.get("leisure") == "marina":
                water.append(shape)
            elif tags.get("natural") == "wood" or tags.get("landuse") == "forest":
                wood.append(shape)
            else:
                grass.append(shape)

        # Trackside surfaces, kept within 250 m of the track where they matter.
        side = fetch_features(name, (lat_lo, lon_lo, lat_hi, lon_hi), TRACKSIDE, "trackside")
        gravel, tarmac = [], []
        close = line.buffer(250)
        for el in side.get("elements", []):
            tags = el.get("tags", {})
            if tags.get("raceway") == "pit_lane" or tags.get("service") == "pit_lane":
                g = el.get("geometry") or []
                if len(g) > 1:
                    tarmac.append(LineString(ring(g, proj)).buffer(6))
                continue
            try:
                shape = way_polygon(el, proj) if el["type"] == "way" else relation_polygon(el, proj)
            except Exception:
                broken += 1
                continue
            if shape is None or shape.is_empty or not shape.intersects(close):
                continue
            surf = tags.get("surface")
            nat = tags.get("natural")
            if tags.get("leisure") == "bleachers":
                h = number(tags.get("height")) or 5
                for poly in polygons(shape.difference(corridor.buffer(1))):
                    if poly.area >= 15:
                        buildings.append((poly.distance(line), poly.simplify(0.6), round(h, 1), 0, True, "#3d4650", "#c23b30"))
            elif nat in GRAVEL or surf in GRAVEL:
                gravel.append(shape)
            elif surf in TARMAC or "area:highway" in tags or tags.get("amenity") == "parking":
                tarmac.append(shape)
            else:  # grassland, scrub, heath, surface=grass
                grass.append(shape)

        sea_shape = sea(coast, frame, proj)
        if sea_shape is not None:
            water.append(sea_shape)
        clear = corridor.buffer(1)
        water_u = unary_union(water).intersection(frame).difference(clear) if water else None
        wood_u = unary_union(wood).intersection(near).difference(corridor.buffer(5)) if wood else None
        grass_u = unary_union(grass).intersection(near).difference(clear) if grass else None
        if water_u is not None and wood_u is not None:
            wood_u = wood_u.difference(water_u)
        gravel_u = unary_union(gravel).intersection(close).difference(clear) if gravel else None
        tarmac_u = unary_union(tarmac).intersection(close).difference(clear) if tarmac else None

        # Trees inside mapped woods, on a jittered 12 m grid, nearest the track first.
        rng = np.random.default_rng(7)
        for poly in polygons(wood_u):
            x0, y0, x1, y1 = poly.bounds
            gx, gy = np.meshgrid(np.arange(x0, x1, 12.0), np.arange(y0, y1, 12.0))
            pts = np.c_[gx.ravel(), gy.ravel()] + rng.uniform(-4, 4, (gx.size, 2))
            prepared = poly.buffer(-2)
            trees += [tuple(p) for p in pts if prepared.contains(Point(p))]
        trees = [p for p in trees if not clear.buffer(5).contains(Point(p)) and near.contains(Point(p))]
        if len(trees) > MAX_TREES:
            d = np.array([line.distance(Point(p)) for p in trees])
            trees = [trees[i] for i in np.argsort(d)[:MAX_TREES]]

        # A wheel is often mapped twice (a node and its outline): keep one per 40 m, the tallest.
        wheels.sort(key=lambda w: -w[2])
        kept = []
        for w in wheels:
            if all(math.hypot(w[0] - k[0], w[1] - k[1]) > 40 for k in kept):
                kept.append(w)
        wheels = kept
        buildings.sort(key=lambda b: b[0])
        buildings = buildings[:MAX_BUILDINGS]
        env = {
            "circuit": name, "lat0": lat0, "lon0": lon0,
            "attribution": "Map data (c) OpenStreetMap contributors, ODbL",
            "buildings": [[h, minh, 1 if stand else 0, flat(p.exterior.coords[:-1]), wall, roof] for _, p, h, minh, stand, wall, roof in buildings],
            "water": [rings_of(p.simplify(1.5)) for p in polygons(water_u) if p.area > 200],
            "wood": [rings_of(p.simplify(3)) for p in polygons(wood_u) if p.area > 400],
            "grass": [rings_of(p.simplify(3)) for p in polygons(grass_u) if p.area > 300],
            "gravel": [rings_of(p.simplify(1)) for p in polygons(gravel_u) if p.area > 40],
            "tarmac": [rings_of(p.simplify(1)) for p in polygons(tarmac_u) if p.area > 40],
            # A street circuit (matched on public roads) has pavement beside it; a permanent one grass.
            "street": al["source"] != "raceway",
            "trees": flat(trees),
            "wheels": wheels,
        }
        path = OUT / f"{slug(name)}.json"
        path.write_text(json.dumps(env, separators=(",", ":")), encoding="utf-8")
        stands = sum(1 for b in buildings if b[4])
        line_out = (f"{name:>20}: {len(buildings)} buildings ({stands} stands), {len(env['gravel'])} gravel, {len(env['tarmac'])} tarmac, {len(env['water'])} water, "
                    f"{len(env['wood'])} woods, {len(trees)} trees, {len(env['grass'])} grass, {len(wheels)} wheels, "
                    f"{path.stat().st_size // 1024} KB" + (f", {broken} malformed features skipped" if broken else ""))
        print(line_out, flush=True)
        summary.append(line_out)
        # Saved after every circuit, so finished circuits can be checked while the rest download.
        (OUT / "index.json").write_text(json.dumps(sessions_out, separators=(",", ":")), encoding="utf-8")

    (OUT / "index.json").write_text(json.dumps(sessions_out, separators=(",", ":")), encoding="utf-8")
    (OUT / "LICENSE.txt").write_text(
        "The files in this folder are derived from OpenStreetMap data.\n"
        "Map data (c) OpenStreetMap contributors, available under the Open Database Licence (ODbL) 1.0:\n"
        "https://opendatacommons.org/licenses/odbl/1-0/ - https://www.openstreetmap.org/copyright\n"
        "This derived database is made available under the same licence.\n", encoding="utf-8")
    print(f"wrote {len(sessions_out)} sessions, {len(summary)} circuits")


if __name__ == "__main__":
    main()
