"""Line every circuit up with the real world, so surroundings can come from real map data.

Our track coordinates are circuit-local metres (OpenF1 / MultiViewer x, y) with no latitude or
longitude. OpenStreetMap has the real track. This script finds, per circuit, the similarity
transform (rotation, optional mirror, scale, translation) that puts our centreline on the real
track, and says how good the fit is.

1. Fetch the track from OpenStreetMap around the circuit (cached in raw/osm/): ways tagged
   highway=raceway, and for street circuits the public roads.
2. Project to local metres and build a distance map (metres from the nearest real road, 5 m grid).
3. Search rotations near north (-10 to 10 deg) and positions (25 m grid, 2 km either way of the
   circuit's coordinates),
   scoring how close our centreline lies to real roads; refine the best few, then ICP with scale.
4. Accept a circuit when at least 90% of the centreline lies within 10 m of the real track.
   Raceway-only is tried first; the roads are used when the raceway does not fit.

Writes model_out/alignment.json (the transforms and fit numbers) and docs/alignment/index.html
(the report, with an overlay per circuit).

Map data (c) OpenStreetMap contributors, ODbL. Run: .venv/Scripts/python.exe align.py
"""
import json
import math
import time
from pathlib import Path

import numpy as np
import requests
from scipy.ndimage import distance_transform_edt
from scipy.spatial import cKDTree

ROOT = Path(__file__).parent
WEB = ROOT.parent / "web" / "public" / "data"
CACHE = ROOT / "raw" / "osm"
REPORT = ROOT.parent / "docs" / "alignment"
OVERPASS = "https://overpass-api.de/api/interpreter"

# Approximate centre of each circuit (lat, lon): only a starting point for the search, which
# covers 1.2 km either way.
CENTRES = {
    "Austin": (30.1328, -97.6411),
    "Baku": (40.3725, 49.8533),
    "Catalunya": (41.5700, 2.2611),
    "Hungaroring": (47.5789, 19.2486),
    "Imola": (44.3439, 11.7167),
    "Interlagos": (-23.7036, -46.6997),
    "Jeddah": (21.6319, 39.1044),
    "Kuala Lumpur": (2.7608, 101.7382),
    "Las Vegas": (36.1147, -115.1728),
    "Lusail": (25.4900, 51.4542),
    "Madring": (40.4637, -3.6158),
    "Melbourne": (-37.8497, 144.9680),
    "Mexico City": (19.4042, -99.0907),
    "Miami": (25.9580, -80.2389),
    "Monte Carlo": (43.7347, 7.4206),
    "Montreal": (45.5000, -73.5228),
    "Monza": (45.6156, 9.2811),
    "Sakhir": (26.0325, 50.5106),
    "Shanghai": (31.3389, 121.2200),
    "Silverstone": (52.0786, -1.0169),
    "Singapore": (1.2914, 103.8640),
    "Spa-Francorchamps": (50.4372, 5.9714),
    "Spielberg": (47.2197, 14.7647),
    "Suzuka": (34.8431, 136.5407),
    "Yas Marina Circuit": (24.4672, 54.6031),
    "Zandvoort": (52.3888, 4.5409),
}
ROADS = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|pedestrian|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link"
CELL = 5.0  # metres per distance-map cell
CAP = 40.0  # distances are capped, so roads that are not the track (clutter) cannot dominate


def fetch(name, kind):
    """Ways near the circuit: kind "raceway" or "roads"."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{name.replace(' ', '_')}-{kind}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    lat, lon = CENTRES[name]
    sel = '["highway"="raceway"]' if kind == "raceway" else f'["highway"~"^({ROADS})$"]'
    query = f"[out:json][timeout:120];way{sel}(around:3500,{lat},{lon});out geom;"
    for attempt in range(5):
        r = requests.post(OVERPASS, data={"data": query}, headers={"User-Agent": "blindlap-align/0.1"}, timeout=180)
        if r.status_code == 200:
            data = r.json()
            path.write_text(json.dumps(data), encoding="utf-8")
            time.sleep(4)  # be polite to the public server
            return data
        time.sleep(10 + attempt * 15)
    raise RuntimeError(f"Overpass failed for {name} {kind}: {r.status_code}")


def find_centre(name, location, country, length):
    """Where a circuit not in CENTRES is (a new venue): look up the town with OpenStreetMap's
    Nominatim, then take the group of raceway ways within 25 km whose total length is closest to
    the lap. Cached in raw/osm/centres.json, so each new circuit is looked up once."""
    path = CACHE / "centres.json"
    known = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    if name in known:
        return tuple(known[name])
    CACHE.mkdir(parents=True, exist_ok=True)
    r = requests.get("https://nominatim.openstreetmap.org/search", params={"q": f"{location}, {country}", "format": "json", "limit": 1},
                     headers={"User-Agent": "blindlap-align/0.1"}, timeout=60)
    hits = r.json() if r.status_code == 200 else []
    if not hits:
        raise RuntimeError(f"{name}: no place found for {location}, {country}; add it to CENTRES")
    lat, lon = float(hits[0]["lat"]), float(hits[0]["lon"])
    q = f"[out:json][timeout:120];way[\"highway\"=\"raceway\"](around:25000,{lat},{lon});out geom;"
    data = requests.post(OVERPASS, data={"data": q}, headers={"User-Agent": "blindlap-align/0.1"}, timeout=180).json()
    ways = [w for w in ways_xy(data, lat, lon) if len(w) > 1]
    best = (lat, lon)
    if ways:
        mids = [w.mean(0) for w in ways]
        lens = [float(np.hypot(*np.diff(w, axis=0).T).sum()) for w in ways]
        groups = []  # ways whose middles lie within 1.5 km of a group's first way
        for m, l in zip(mids, lens):
            for g in groups:
                if np.hypot(*(m - g["at"])) < 1500:
                    g["len"] += l
                    g["pts"].append(m)
                    break
            else:
                groups.append({"at": m, "len": l, "pts": [m]})
        g = min(groups, key=lambda g: abs(g["len"] - length))
        c = np.mean(g["pts"], axis=0)
        best = (lat + c[1] / 110540.0, lon + c[0] / (math.cos(math.radians(lat)) * 111320.0))
    known[name] = [round(best[0], 5), round(best[1], 5)]
    path.write_text(json.dumps(known, indent=1), encoding="utf-8")
    print(f"{name}: centre from OpenStreetMap {known[name]}", flush=True)
    time.sleep(2)
    return best


def project(lat, lon, lat0, lon0):
    """Local metres east and north of (lat0, lon0)."""
    return ((lon - lon0) * math.cos(math.radians(lat0)) * 111320.0, (lat - lat0) * 110540.0)


def ways_xy(data, lat0, lon0):
    out = []
    for el in data.get("elements", []):
        g = el.get("geometry")
        if g and len(g) > 1:
            out.append(np.array([project(p["lat"], p["lon"], lat0, lon0) for p in g]))
    return out


def densify(ways, step=2.5):
    pts = []
    for w in ways:
        for a, b in zip(w[:-1], w[1:]):
            n = max(1, int(np.hypot(*(b - a)) / step))
            t = np.linspace(0, 1, n, endpoint=False)[:, None]
            pts.append(a + (b - a) * t)
        pts.append(w[-1:])
    return np.vstack(pts) if pts else np.zeros((0, 2))


def resample(x, y, step):
    """Closed polyline resampled every `step` metres."""
    P = np.c_[np.r_[x, x[0]], np.r_[y, y[0]]]
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(P, axis=0).T))]
    s = np.arange(0, d[-1], step)
    return np.c_[np.interp(s, d, P[:, 0]), np.interp(s, d, P[:, 1])]


class DistanceMap:
    def __init__(self, pts):
        lo = pts.min(axis=0) - 400
        hi = pts.max(axis=0) + 400
        self.lo = lo
        shape = np.ceil((hi - lo) / CELL).astype(int) + 1
        grid = np.ones(shape, dtype=bool)
        idx = np.floor((pts - lo) / CELL).astype(int)
        grid[idx[:, 0], idx[:, 1]] = False
        self.d = np.minimum(distance_transform_edt(grid) * CELL, CAP).astype(np.float32)

    def score(self, pts):
        """Mean capped distance for points of shape (..., 2)."""
        idx = np.floor((pts - self.lo) / CELL).astype(int)
        ix = np.clip(idx[..., 0], 0, self.d.shape[0] - 1)
        iy = np.clip(idx[..., 1], 0, self.d.shape[1] - 1)
        out = self.d[ix, iy]
        outside = (idx[..., 0] < 0) | (idx[..., 1] < 0) | (idx[..., 0] >= self.d.shape[0]) | (idx[..., 1] >= self.d.shape[1])
        return np.where(outside, CAP, out).mean(axis=-1)


def rot(theta):
    c, s = math.cos(theta), math.sin(theta)
    return np.array([[c, -s], [s, c]])


def umeyama(src, dst):
    """Similarity transform (scale, R, t) minimising |s R src + t - dst|."""
    ms, md = src.mean(0), dst.mean(0)
    A, B = src - ms, dst - md
    U, S, Vt = np.linalg.svd(B.T @ A / len(src))
    D = np.eye(2)
    if np.linalg.det(U @ Vt) < 0:
        D[1, 1] = -1
    R = U @ D @ Vt
    scale = np.trace(np.diag(S) @ D) / (A ** 2).sum(1).mean()
    return scale, R, md - scale * R @ ms


def align(track, target):
    """Best transform of `track` (n x 2, centred) onto `target` points. Returns (M, t, fit)."""
    dmap = DistanceMap(target)
    tree = cKDTree(target)
    coarse = track[:: max(1, len(track) // 120)]
    # Search around the circuit's own coordinates (the origin), not the middle of the downloaded
    # roads: in Baku that middle lay 1.6 km from the circuit, outside the search.
    span = np.arange(-2000, 2001, 25.0)
    T = np.stack(np.meshgrid(span, span, indexing="ij"), -1).reshape(-1, 2)
    found = []
    # OpenF1's frame turned out to be east/north at true scale on every circuit that fits
    # unambiguously (rotation under 2 deg, no mirror). A full search found false matches in dense
    # cities (Baku: a mirror image turned 51 deg over the wrong streets), so search near north only.
    for mirror in (False,):
        F = np.diag([1, -1]) if mirror else np.eye(2)
        for deg in range(-10, 11, 1):
            M = rot(math.radians(deg)) @ F
            p = coarse @ M.T
            sc = dmap.score(p[None, :, :] + T[:, None, :])
            k = np.argsort(sc)[:4]
            found += [(sc[i], mirror, deg, T[i]) for i in k]
    found.sort(key=lambda f: f[0])
    best = None
    for _, mirror, deg, t0 in found[:16]:
        F = np.diag([1, -1]) if mirror else np.eye(2)
        # Local search: rotation +-3 deg, position +-40 m.
        local = []
        for d in np.arange(deg - 3, deg + 3.01, 0.5):
            M = rot(math.radians(d)) @ F
            p = track @ M.T
            grid = np.arange(-40, 41, 5.0)
            TT = np.stack(np.meshgrid(grid, grid, indexing="ij"), -1).reshape(-1, 2) + t0
            sc = dmap.score(p[None, :, :] + TT[:, None, :])
            i = int(np.argmin(sc))
            local.append((sc[i], M, TT[i]))
        sc, M, t = min(local, key=lambda x: x[0])
        # ICP with scale: match each point to the nearest real road within 25 m. The mirror is
        # applied first and kept fixed, since the fit itself only finds proper rotations.
        src = track @ F.T
        for _ in range(40):
            p = track @ M.T + t
            dist, j = tree.query(p)
            ok = dist < 25
            if ok.sum() < 0.5 * len(track):
                break
            s, R, tt = umeyama(src[ok], target[j[ok]])
            M, t = s * R @ F, tt
        p = track @ M.T + t
        dist, _ = tree.query(p)
        fit = {
            "rms": float(np.sqrt(np.mean(np.minimum(dist, CAP) ** 2))),
            "p95": float(np.percentile(dist, 95)),
            "within10": float(np.mean(dist < 10)),
            "mean": float(np.mean(np.minimum(dist, CAP))),
        }
        if best is None or fit["mean"] < best[2]["mean"]:
            best = (M, t, fit)
    return best


def svg(name, track_xy, ways_race, ways_road):
    """Overlay: real roads light grey, real raceway dark, our aligned centreline red."""
    pts = track_xy
    lo, hi = pts.min(0) - 120, pts.max(0) + 120
    w, h = hi - lo
    size = 520
    k = size / max(w, h)
    def path(P):
        q = (P - lo) * k
        return "M" + " L".join(f"{x:.1f},{size - y:.1f}" for x, y in q)
    def inside(P):
        return ((P >= lo) & (P <= hi)).all(1).any()
    parts = [f'<svg viewBox="0 0 {size} {size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="{name} overlay">',
             f'<rect width="{size}" height="{size}" fill="var(--paper2)"/>']
    for wy in ways_road:
        if inside(wy):
            parts.append(f'<path d="{path(wy)}" fill="none" stroke="var(--road)" stroke-width="1.2"/>')
    for wy in ways_race:
        if inside(wy):
            parts.append(f'<path d="{path(wy)}" fill="none" stroke="var(--ink)" stroke-width="3.2" stroke-linejoin="round"/>')
    parts.append(f'<path d="{path(np.r_[pts, pts[:1]])}" fill="none" stroke="#e10600" stroke-width="1.6" stroke-linejoin="round"/>')
    parts.append("</svg>")
    return "".join(parts)


def main():
    index = json.loads((WEB / "index.json").read_text(encoding="utf-8"))
    sessions, info = {}, {}
    for s in index["sessions"]:
        sessions.setdefault(s["circuit"], s["key"])  # one session per circuit is enough
        info.setdefault(s["circuit"], s)
    results, cards = {}, []
    for name, key in sorted(sessions.items()):
        s = info[name]
        lat0, lon0 = CENTRES.get(name) or find_centre(name, s["location"], s["country"], s["length"])
        t = json.loads((WEB / "sessions" / f"{key}.json").read_text(encoding="utf-8"))["track"]
        track = resample(np.array(t["x"]), np.array(t["y"]), 5.0)
        offset = track.mean(0)
        track_c = track - offset
        race = ways_xy(fetch(name, "raceway"), lat0, lon0)
        best, source, road = None, None, []
        if race:
            best = align(track_c, densify(race))
            source = "raceway"
        if best is None or best[2]["within10"] < 0.9:
            road = ways_xy(fetch(name, "roads"), lat0, lon0)
            target = densify(race + road)
            if len(target):
                alt = align(track_c, target)
                if best is None or alt[2]["within10"] > best[2]["within10"]:
                    best, source = alt, "raceway + roads" if race else "roads"
        if best is None:
            # Nothing mapped near the centre given: report it rather than guess.
            print(f"{name:>20}: FAIL no track or roads found in OpenStreetMap near {lat0}, {lon0}", flush=True)
            results[name] = {"session": key, "lat0": lat0, "lon0": lon0, "source": None, "ok": False}
            continue
        M, tvec, fit = best
        ok = fit["within10"] >= 0.9
        results[name] = {
            "session": key, "lat0": lat0, "lon0": lon0, "source": source, "ok": ok,
            # world = M @ (track - offset) + t, in metres east/north of (lat0, lon0)
            "M": M.round(6).tolist(), "t": tvec.round(3).tolist(), "offset": offset.round(3).tolist(),
            "scale": float(math.sqrt(abs(np.linalg.det(M)))), "mirror": bool(np.linalg.det(M) < 0),
            "rotation": float(math.degrees(math.atan2(M[1, 0], M[0, 0]))),
            **{k: round(v, 3) for k, v in fit.items()},
        }
        print(f"{name:>20}: {'OK  ' if ok else 'FAIL'} {source:>15}  within 10 m {fit['within10']:.0%}  "
              f"rms {fit['rms']:.1f} m  p95 {fit['p95']:.1f} m  scale {results[name]['scale']:.4f}  "
              f"rot {results[name]['rotation']:.1f}  mirror {results[name]['mirror']}", flush=True)
        aligned = track_c @ M.T + tvec
        cards.append((name, ok, fit, source, results[name], svg(name, aligned, race, road)))
    (ROOT / "model_out").mkdir(exist_ok=True)
    (ROOT / "model_out" / "alignment.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
    write_report(cards)


def write_report(cards):
    REPORT.mkdir(parents=True, exist_ok=True)
    good = sum(1 for c in cards if c[1])
    rows = "".join(
        f"<tr><td>{n}</td><td class='{'ok' if ok else 'bad'}'>{'Fits' if ok else 'Does not fit'}</td><td>{src}</td>"
        f"<td>{f['within10']:.0%}</td><td>{f['rms']:.1f} m</td><td>{f['p95']:.1f} m</td><td>{r['scale']:.3f}</td>"
        f"<td>{r['rotation']:.1f}°{' mirrored' if r['mirror'] else ''}</td></tr>"
        for n, ok, f, src, r, _ in cards)
    figs = "".join(
        f"<figure><figcaption><b>{n}</b><span class='{'ok' if ok else 'bad'}'>{f['within10']:.0%} within 10 m · rms {f['rms']:.1f} m</span></figcaption>{s}</figure>"
        for n, ok, f, src, r, s in cards)
    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Circuit alignment</title><style>
:root{{--paper:#f1f0ec;--paper2:#e6e4de;--ink:#111;--ink3:#5f5d58;--road:#b9b6ae;--green:#11803d;--red:#e10600}}
@media (prefers-color-scheme:dark){{:root{{--paper:#121212;--paper2:#1c1c1b;--ink:#f1f0ec;--ink3:#9a978f;--road:#46443f;--green:#2fb062}}}}
body{{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,sans-serif;padding:16px}}
main{{max-width:1200px;margin:0 auto}} h1{{font-size:2rem;margin:0 0 6px}} p{{color:var(--ink3);max-width:75ch}}
table{{border-collapse:collapse;width:100%;margin:18px 0;font-variant-numeric:tabular-nums}} th,td{{padding:7px 8px;border-top:1px solid var(--road);text-align:left}}
th{{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--ink3)}}
.ok{{color:var(--green);font-weight:700}} .bad{{color:var(--red);font-weight:700}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}}
figure{{margin:0;border:2px solid var(--ink);background:var(--paper2)}} figure svg{{display:block;width:100%;height:auto}}
figcaption{{display:flex;justify-content:space-between;gap:8px;padding:6px 8px;font-size:.8rem;border-bottom:2px solid var(--ink)}}
.key span{{display:inline-block;width:22px;height:4px;vertical-align:middle;margin:0 6px 0 14px}}
.wrap{{overflow-x:auto}}
</style></head><body><main>
<h1>Circuit alignment</h1>
<p>Each circuit's track from the game (circuit-local metres, no map coordinates) fitted onto the real track from OpenStreetMap by rotation, mirror, scale and position. A circuit fits when at least 90% of the track lies within 10 m of the real one. {good} of {len(cards)} fit.</p>
<p class="key">Overlay key:<span style="background:var(--ink)"></span>real raceway (OpenStreetMap)<span style="background:var(--road)"></span>real roads<span style="background:#e10600"></span>our track, aligned</p>
<div class="wrap"><table><thead><tr><th>Circuit</th><th>Result</th><th>Matched against</th><th>Within 10 m</th><th>RMS</th><th>95th pct</th><th>Scale</th><th>Rotation</th></tr></thead><tbody>{rows}</tbody></table></div>
<div class="grid">{figs}</div>
<p>Map data © OpenStreetMap contributors, ODbL.</p>
</main></body></html>"""
    (REPORT / "index.html").write_text(html, encoding="utf-8")
    print("wrote", REPORT / "index.html")


if __name__ == "__main__":
    main()
