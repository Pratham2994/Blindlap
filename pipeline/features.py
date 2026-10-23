"""Per-corner driving-style features.

For every push lap and every corner we measure how the driver attacked it: where they braked,
how long, how slow they went at the apex, when they got back to full throttle, how much they
coasted. Each number is then turned into a z-score against the whole field at that same corner
in that same session, so the model learns "brakes later than the field" rather than
"Monza is fast".
"""
from dataclasses import dataclass

import numpy as np

from track import Lap

FEATURES = [
    "brake_point",    # m before apex where braking starts (negative = earlier). + is later braking
    "brake_length",   # m spent on the brake
    "entry_speed",    # km/h at the moment of braking or peak before the corner
    "apex_speed",     # km/h minimum speed near the apex
    "apex_offset",    # m where the minimum speed happens relative to the apex marker
    "throttle_point", # m after apex until throttle >= 95 %. + is later
    "min_throttle",   # lowest throttle in the zone (lift depth on flat corners)
    "coast",          # m with no throttle and no brake before the apex
    "throttle_ramp",  # m from first throttle (>20 %) after the apex to full throttle. + is a slower squeeze
    "partial_throttle",  # m spent between 20 % and 95 % throttle in the zone (modulation)
]
# Gear at the apex was tried too: it adds about 4 points of accuracy, but it mostly identifies the
# car's gearing rather than the driver, so it is left out.
CORNER_CLASSES = ["slow", "medium", "fast"]


@dataclass
class Corner:
    number: int | str
    s: float
    lo: float  # zone start
    hi: float  # zone end
    angle: float


def corner_zones(corner_s: list[tuple[int | str, float, float]], length: float) -> list[Corner]:
    """Split the lap into one zone per corner: from halfway after the previous corner to halfway before the next."""
    cs = sorted(corner_s, key=lambda c: c[1])
    out = []
    for i, (num, s, ang) in enumerate(cs):
        prev_s = cs[i - 1][1] - (length if i == 0 else 0)
        next_s = cs[(i + 1) % len(cs)][1] + (length if i == len(cs) - 1 else 0)
        lo = max(s - 450, (prev_s + s) / 2)
        hi = min(s + 300, (s + next_s) / 2)
        out.append(Corner(num, s, lo, hi, ang))
    return out


def _cross(s, mask_from, mask_to):
    """Distance of the first transition from mask_from to mask_to, midpoint between samples."""
    for i in range(1, len(s)):
        if mask_from[i - 1] and mask_to[i]:
            return (s[i - 1] + s[i]) / 2
    return np.nan


def corner_features(lap: Lap, c: Corner) -> np.ndarray:
    m = (lap.s >= c.lo) & (lap.s <= c.hi)
    if m.sum() < 3:
        return np.full(len(FEATURES), np.nan)
    s, v, thr, brk = lap.s[m], lap.speed[m], lap.throttle[m], lap.brake[m] > 0

    # Apex: minimum of speed interpolated on a 2 m grid near the marker.
    grid = np.arange(max(c.lo, c.s - 120), min(c.hi, c.s + 120), 2.0)
    if len(grid) < 3:
        grid = np.arange(c.lo, c.hi, 2.0)
    vg = np.interp(grid, s, v)
    ia = int(np.argmin(vg))
    apex_s, apex_v = grid[ia], vg[ia]

    before = s <= apex_s
    on = _cross(s[before], ~brk[before], brk[before]) if before.sum() > 1 else np.nan
    if np.isnan(on) and brk[before].any() and before.sum() > 0 and brk[0]:
        on = s[0]  # already braking when the zone starts
    if not np.isnan(on):
        braking = brk & (s >= on - 1) & (s <= apex_s + 20)
        off = s[braking].max() if braking.any() else on
        brake_len = max(off - on, 0.0)
        entry = float(np.interp(on, s, v))
    else:
        brake_len = 0.0
        entry = float(v[before].max()) if before.any() else float(v[0])

    after = s >= apex_s
    full = _cross(s[after], thr[after] < 95, thr[after] >= 95) if after.sum() > 1 else np.nan
    if np.isnan(full):
        full = s[after][0] if after.any() and thr[after][0] >= 95 else c.hi
    throttle_point = full - apex_s

    coast_mask = before & (thr < 5) & ~brk
    ds = np.diff(s, prepend=s[0])
    coast = float(np.sum(ds[coast_mask]))

    pick_up = next((s_ for s_, t_ in zip(s[after], thr[after]) if t_ > 20), np.nan)
    full_on = next((s_ for s_, t_ in zip(s[after], thr[after]) if t_ >= 95), np.nan)
    ramp = full_on - pick_up if not (np.isnan(pick_up) or np.isnan(full_on)) else np.nan
    partial = float(np.sum(ds[(thr > 20) & (thr < 95)]))

    return np.array([
        (on - c.s) if not np.isnan(on) else np.nan,
        brake_len,
        entry,
        apex_v,
        apex_s - c.s,
        throttle_point,
        float(thr.min()),
        coast,
        ramp,
        partial,
    ])


def corner_class(field_apex_speed: float) -> int:
    if field_apex_speed < 140:
        return 0
    if field_apex_speed < 220:
        return 1
    return 2


def normalise(raw: np.ndarray):
    """raw: laps x corners x features. Robust z-score per corner and feature across the field.

    Brake features at corners where most of the field does not brake are dropped (set to 0).
    Returns z-scores with NaN replaced by 0 (= "like the field"), plus field medians per corner.
    """
    med = np.nanmedian(raw, axis=0)
    mad = np.nanmedian(np.abs(raw - med), axis=0) * 1.4826
    floors = np.array([6.0, 6.0, 2.0, 2.0, 6.0, 8.0, 3.0, 4.0, 6.0, 8.0])  # measurement noise floor per feature
    scale = np.maximum(np.nan_to_num(mad, nan=0.0), floors)
    z = (raw - med) / scale
    braked = np.mean(~np.isnan(raw[:, :, 0]), axis=0) >= 0.5
    z[:, ~braked, 0:3] = 0.0
    z = np.clip(np.nan_to_num(z, nan=0.0), -4, 4)
    return z, med, scale, braked


def expand(z_corner: np.ndarray, cls: int) -> np.ndarray:
    """Place a corner's features into the block for its speed class, so the model can learn
    that a driver behaves differently in hairpins than in fast sweepers."""
    out = np.zeros(len(FEATURES) * len(CORNER_CLASSES))
    out[cls * len(FEATURES):(cls + 1) * len(FEATURES)] = z_corner
    return out
