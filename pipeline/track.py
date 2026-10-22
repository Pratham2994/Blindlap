"""Turn raw OpenF1 samples into laps measured in metres along a shared reference line.

OpenF1 gives car telemetry (~3.7 Hz) and car position (~4 Hz) on separate clocks and no lap
distance. We build one smooth centreline per circuit from the fastest lap, then project every
position sample onto it. That gives every sample a distance `s` that means the same spot on track
for every driver, which is what the corner features need.
"""
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

RAW = Path(__file__).parent / "raw"


def ts(date: str) -> float:
    return datetime.fromisoformat(date).timestamp()


def load(sk: int, name: str):
    p = RAW / str(sk) / f"{name}.json"
    return json.loads(p.read_text()) if p.exists() else []


@dataclass
class Channels:
    t: np.ndarray
    speed: np.ndarray
    throttle: np.ndarray
    brake: np.ndarray
    gear: np.ndarray
    rpm: np.ndarray
    drs: np.ndarray


@dataclass
class Positions:
    t: np.ndarray
    xyz: np.ndarray  # metres


def driver_channels(sk: int, num: int) -> Channels | None:
    raw = load(sk, f"car_data_{num}")
    if not raw:
        return None
    raw.sort(key=lambda r: r["date"])
    col = lambda k: np.array([r[k] if r[k] is not None else 0 for r in raw], dtype=float)
    return Channels(
        t=np.array([ts(r["date"]) for r in raw]),
        speed=col("speed"), throttle=np.clip(col("throttle"), 0, 100), brake=col("brake"),
        gear=col("n_gear"), rpm=col("rpm"), drs=col("drs"),
    )


def driver_positions(sk: int, num: int) -> Positions | None:
    raw = [r for r in load(sk, f"location_{num}") if r["x"] or r["y"]]
    if not raw:
        return None
    raw.sort(key=lambda r: r["date"])
    return Positions(
        t=np.array([ts(r["date"]) for r in raw]),
        xyz=np.array([[r["x"], r["y"], r["z"]] for r in raw], dtype=float) / 10.0,
    )


def catmull_rom_closed(pts: np.ndarray, per_seg: int = 12) -> np.ndarray:
    """Centripetal Catmull-Rom through a closed loop of points."""
    n = len(pts)
    out = []
    for i in range(n):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        def tj(ti, a, b):
            return ti + max(np.linalg.norm(b - a), 1e-3) ** 0.5
        t0 = 0.0; t1 = tj(t0, p0, p1); t2 = tj(t1, p1, p2); t3 = tj(t2, p2, p3)
        for u in np.linspace(t1, t2, per_seg, endpoint=False):
            a1 = (t1 - u) / (t1 - t0) * p0 + (u - t0) / (t1 - t0) * p1
            a2 = (t2 - u) / (t2 - t1) * p1 + (u - t1) / (t2 - t1) * p2
            a3 = (t3 - u) / (t3 - t2) * p2 + (u - t2) / (t3 - t2) * p3
            b1 = (t2 - u) / (t2 - t0) * a1 + (u - t0) / (t2 - t0) * a2
            b2 = (t3 - u) / (t3 - t1) * a2 + (u - t1) / (t3 - t1) * a3
            out.append((t2 - u) / (t2 - t1) * b1 + (u - t1) / (t2 - t1) * b2)
    return np.array(out)


class Centreline:
    """Dense closed polyline with arc length, built from one lap of position samples."""

    def __init__(self, loop_xyz: np.ndarray, step: float = 1.0):
        # Drop near-duplicate points (car crawling or repeated samples) before the spline.
        keep = [0]
        for i in range(1, len(loop_xyz)):
            if np.linalg.norm(loop_xyz[i] - loop_xyz[keep[-1]]) > 4.0:
                keep.append(i)
        pts = loop_xyz[keep]
        if np.linalg.norm(pts[-1] - pts[0]) < 4.0:
            pts = pts[:-1]
        dense = catmull_rom_closed(pts)
        seg = np.linalg.norm(np.diff(np.vstack([dense, dense[:1]]), axis=0), axis=1)
        s = np.concatenate([[0], np.cumsum(seg)])
        self.length = float(s[-1])
        grid = np.arange(0, self.length, step)
        closed = np.vstack([dense, dense[:1]])
        self.s = grid
        self.xyz = np.stack([np.interp(grid, s, closed[:, k]) for k in range(3)], axis=1)
        # Light smoothing to remove spline wobble from noisy samples (circular moving average).
        k = 9
        pad = np.vstack([self.xyz[-k:], self.xyz, self.xyz[:k]])
        kernel = np.ones(2 * k + 1) / (2 * k + 1)
        self.xyz = np.stack([np.convolve(pad[:, j], kernel, mode="same")[k:-k] for j in range(3)], axis=1)
        self.tree3 = cKDTree(self.xyz)
        self.tree2 = cKDTree(self.xyz[:, :2])

    def project(self, xyz: np.ndarray) -> np.ndarray:
        _, idx = self.tree3.query(xyz)
        return self.s[idx]

    def project2d(self, xy: np.ndarray) -> np.ndarray:
        _, idx = self.tree2.query(xy)
        return self.s[idx]

    def rotate_start(self, s0: float):
        """Re-base arc length so the timing line sits at s = 0."""
        shift = int(round(s0)) % len(self.s)
        self.xyz = np.roll(self.xyz, -shift, axis=0)
        self.tree3 = cKDTree(self.xyz)
        self.tree2 = cKDTree(self.xyz[:, :2])


@dataclass
class Lap:
    driver: int
    lap_number: int
    lap_time: float
    t0: float
    t: np.ndarray       # seconds from lap start, telemetry clock
    s: np.ndarray       # metres along centreline
    speed: np.ndarray
    throttle: np.ndarray
    brake: np.ndarray
    gear: np.ndarray
    rpm: np.ndarray
    drs: np.ndarray


def unwrap(s: np.ndarray, length: float) -> np.ndarray:
    out = s.copy()
    jumps = np.diff(s)
    out[1:] += np.cumsum(np.where(jumps < -length / 2, length, np.where(jumps > length / 2, -length, 0)))
    return out


def build_lap(cl: Centreline, ch: Channels, pos: Positions, lap: dict) -> Lap | None:
    t0 = ts(lap["date_start"])
    t1 = t0 + lap["lap_duration"]
    pm = (pos.t > t0 - 4) & (pos.t < t1 + 4)
    cm = (ch.t > t0 - 2) & (ch.t < t1 + 2)
    if pm.sum() < 30 or cm.sum() < 30:
        return None
    ps = unwrap(cl.project(pos.xyz[pm]), cl.length)
    pt = pos.t[pm]
    # Anchor: the position sample nearest the official lap start should sit near s = 0.
    i0 = int(np.argmin(np.abs(pt - t0)))
    ps -= round((ps[i0] - 0) / cl.length) * cl.length
    # Find exact crossing times of s = 0 and s = L by interpolation, refine lap window from track.
    mono = np.maximum.accumulate(ps)
    start = float(np.interp(0.0, mono, pt))
    end = float(np.interp(cl.length, mono, pt))
    if not (abs(start - t0) < 3 and abs((end - start) - lap["lap_duration"]) < 3):
        return None
    if np.any(np.diff(ps) < -60):  # going backwards = spin or bad projection
        return None
    ps = np.maximum.accumulate(ps)
    ct = ch.t[cm]
    cs = np.interp(ct, pt, ps)
    keep = (cs >= -30) & (cs <= cl.length + 30)
    return Lap(
        driver=lap["driver_number"], lap_number=lap["lap_number"], lap_time=lap["lap_duration"],
        t0=start, t=ct[keep] - start, s=cs[keep],
        speed=ch.speed[cm][keep], throttle=ch.throttle[cm][keep], brake=ch.brake[cm][keep],
        gear=ch.gear[cm][keep], rpm=ch.rpm[cm][keep], drs=ch.drs[cm][keep],
    )


def push_laps(laps: list[dict], own: float = 1.025, field: float = 1.07) -> list[dict]:
    """Flying laps: within 2.5% of the driver's own best (drops out-, in- and cool-down laps) and
    inside the 107% rule. Judging against each driver's own best keeps slower teams in the data."""
    timed = [l for l in laps if l.get("lap_duration") and not l.get("is_pit_out_lap")]
    if not timed:
        return []
    best = min(l["lap_duration"] for l in timed)
    own_best = {}
    for l in timed:
        n = l["driver_number"]
        own_best[n] = min(own_best.get(n, 1e9), l["lap_duration"])
    return [l for l in timed
            if l["lap_duration"] <= own_best[l["driver_number"]] * own and l["lap_duration"] <= best * field]


def session_centreline(sk: int, laps: list[dict]):
    """Centreline from the fastest lap that has clean position data."""
    for lap in sorted(push_laps(laps), key=lambda l: l["lap_duration"]):
        pos = driver_positions(sk, lap["driver_number"])
        if pos is None:
            continue
        t0 = ts(lap["date_start"])
        m = (pos.t >= t0) & (pos.t <= t0 + lap["lap_duration"])
        if m.sum() < 0.8 * lap["lap_duration"] * 3.5:
            continue
        cl = Centreline(pos.xyz[m])
        # Put s = 0 at the car position closest to the lap start time.
        i0 = int(np.argmin(np.abs(pos.t - t0)))
        cl.rotate_start(float(cl.project(pos.xyz[i0:i0 + 1])[0]))
        return cl, lap
    return None, None
