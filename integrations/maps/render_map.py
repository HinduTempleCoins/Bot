"""render_map.py — Hathor's animated history maps: territories that change over time, a year counter that ticks,
campaign routes that draw themselves, cities that appear and vanish. CPU-only (shapely + pyproj + matplotlib +
Pillow + ffmpeg). The job format is documented in README.md / spec.mjs (validated identically here).

  python render_map.py job.json --out clip.mp4 [--out720 clip_720.mp4] [--data DATA_DIR] [--poster poster.jpg] [--segments DIR]

Route STOPS (optional `stops` in the job): at each stop the year pauses, the camera eases in to a sharp close-up map
of that place, cross-fades into the stop's media (images with a slow camera move, or video clips such as depth-
parallax shots), shows a place + date card with its kind (historical record / tradition / debated), then pulls back
to the map and the march continues. --segments writes one clip per stop beside the film.

Data sources (DATA_DIR): cliopatria_polities_only.geojson (Seshat Cliopatria, CC BY 4.0) and Natural Earth
ne_50m_land / ne_50m_rivers_lake_centerlines / ne_50m_lakes (public domain). User GeoJSON / route CSVs come from
the job. Rendering: a static base (sea, land, rivers, graticule) drawn once; one territory layer per distinct
set of active polities (matplotlib), cross-faded when the set changes; year / route / cities / titles composited
per frame with Pillow and piped to ffmpeg.
"""
import argparse, colorsys, csv, hashlib, io, json, math, os, pickle, subprocess, sys, time

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from shapely.geometry import shape, box, Polygon, MultiPolygon, mapping
from shapely.ops import transform as sh_transform
from shapely import wkb
import pyproj
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import PathPatch
from matplotlib.path import Path

SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"
SERIF_B = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
LIM = dict(maxW=3840, maxH=2160, minFps=12, maxFps=60, minDur=5, maxDur=600, minYear=-4000, maxYear=2100,
           minAgo=-3_500_000, logOffset=1000,
           maxFeatures=5000, maxRoutePoints=5000, maxStops=60)
PALETTES = {
    "night": dict(sea=(12, 18, 26), land=(40, 36, 30), river=(58, 92, 120), grid=(30, 38, 48), text=(236, 222, 190),
                  sub=(170, 160, 140), label=(245, 235, 210)),
    "parchment": dict(sea=(196, 184, 156), land=(226, 212, 178), river=(120, 150, 170), grid=(186, 172, 142),
                      text=(52, 36, 20), sub=(96, 76, 52), label=(40, 26, 14)),
}
CLIO_CREDIT = ("Territories: Cliopatria, Seshat Global History Databank (CC BY 4.0, "
               "github.com/Seshat-Global-History-Databank/cliopatria) — simplified and recoloured. "
               "Base map: Natural Earth (public domain).")


# ── pure helpers (mirrored in spec.mjs; tested) ────────────────────────────────────────────────────
def format_year(y):
    # year Y BC runs from -Y up to -Y+1 (month m = -Y + (m-1)/12), so a fractional year belongs to its floor;
    # rounding made July 218 BC (-217.42) read "217 BC". Tiny float noise near an integer is snapped first.
    y = float(y)
    n = int(round(y)) if abs(y - round(y)) < 1e-6 else int(math.floor(y))
    if n < 0:
        return f"{-n} BC"
    n = 1 if n == 0 else n
    return f"AD {n}" if n < 1000 else str(n)


def format_ago(y):
    """deep time: y = -(years before present). Rounded to the scale so the counter ticks cleanly:
    ≥100,000 → nearest 1,000; ≥10,000 → nearest 100; ≥1,000 → nearest 10."""
    a = max(0.0, -float(y))
    step = 1000 if a >= 100_000 else 100 if a >= 10_000 else 10 if a >= 1_000 else 1
    n = int(round(a / step) * step)
    if n == 0:
        return "Today"
    return f"{n:,} year{'s' if n != 1 else ''} ago"


def format_time(y, mode="calendar"):
    return format_ago(y) if mode == "ago" else format_year(y)


def year_at(i, n, y0, y1, scale="linear"):
    if n <= 1:
        return y0
    t = i / (n - 1)
    if scale != "log":
        return y0 + (y1 - y0) * t
    # log-ish: equal screen time per factor of years-ago (300,000 → 100,000 takes as long as 30,000 → 10,000);
    # the offset keeps a run that ends at the present (0) finite.
    c = LIM["logOffset"]; a0, a1 = -y0 + c, -y1 + c
    return -(a0 * (a1 / a0) ** t - c)


def route_at(points, year):
    if not points:
        return None
    if year <= points[0]["year"]:
        return points[0]["lat"], points[0]["lon"], 0, False
    for i in range(1, len(points)):
        a, b = points[i - 1], points[i]
        if year <= b["year"]:
            t = 1.0 if b["year"] == a["year"] else (year - a["year"]) / (b["year"] - a["year"])
            return a["lat"] + (b["lat"] - a["lat"]) * t, a["lon"] + (b["lon"] - a["lon"]) * t, i - 1, False
    last = points[-1]
    return last["lat"], last["lon"], len(points) - 1, True


DISTINCT = [(214, 164, 62), (170, 70, 170), (60, 160, 120), (200, 80, 64), (70, 130, 200), (220, 200, 90),
            (150, 110, 220), (90, 190, 200), (230, 120, 160), (130, 170, 70), (240, 150, 70), (110, 110, 200),
            (190, 120, 80), (80, 200, 150), (200, 60, 120), (160, 190, 230)]


def colour_for(name):
    h = int(hashlib.sha1(name.encode()).hexdigest()[:8], 16)
    hue = (h % 360) / 360.0
    r, g, b = colorsys.hls_to_rgb(hue, 0.52, 0.55)
    return int(r * 255), int(g * 255), int(b * 255)


def hex_rgb(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def fail(msg):
    raise SystemExit(f"map job invalid: {msg}")


def validate(job):
    j = {"size": [1920, 1080], "fps": 24, "duration": 60, "palette": "night", **job}
    if not j.get("title") or len(str(j["title"])) > 120:
        fail("title is required (≤ 120 characters)")
    b = j.get("bbox")
    if not (isinstance(b, list) and len(b) == 4 and b[0] < b[2] and b[1] < b[3] and -180 <= b[0] and b[2] <= 180 and -90 <= b[1] and b[3] <= 90):
        fail("bbox must be [lonMin, latMin, lonMax, latMax] with min < max")
    j.setdefault("timeMode", "calendar"); j.setdefault("timeScale", "linear")
    if j["timeMode"] not in ("calendar", "ago"):
        fail("timeMode must be calendar or ago")
    if j["timeScale"] not in ("linear", "log") or (j["timeScale"] == "log" and j["timeMode"] != "ago"):
        fail("timeScale must be linear, or log (with timeMode ago)")
    lo, hi = (LIM["minAgo"], 0) if j["timeMode"] == "ago" else (LIM["minYear"], LIM["maxYear"])
    y = j.get("years")
    if not (isinstance(y, list) and len(y) == 2 and all(isinstance(v, int) for v in y) and y[0] < y[1] and y[0] >= lo and y[1] <= hi):
        fail(f"years must be [from, to] integers, from < to, within {lo}..{hi}" + (" (negative = years ago)" if j["timeMode"] == "ago" else ""))
    if len(str(j.get("note", ""))) > 200:
        fail("note must be ≤ 200 characters")
    w, h = j["size"]
    if not (320 <= w <= LIM["maxW"] and 240 <= h <= LIM["maxH"] and w % 2 == 0 and h % 2 == 0):
        fail("size must be even, 320x240 .. 3840x2160")
    if not (LIM["minFps"] <= j["fps"] <= LIM["maxFps"]):
        fail("fps must be 12..60")
    if not (LIM["minDur"] <= j["duration"] <= LIM["maxDur"]):
        fail("duration must be 5..600 s")
    if j["palette"] not in PALETTES:
        fail("palette must be night or parchment")
    if not j.get("territories") and not j.get("routes"):
        fail("a job needs territories and/or routes")
    j["stops"] = validate_stops(j.get("stops") or [], j["years"], j["timeMode"])
    return j


STOP_KINDS = ("record", "tradition", "debated", "interpretation", "none")
KIND_TEXT = {"record": "Historical record", "tradition": "Tradition", "debated": "Debated", "interpretation": "Interpretation", "none": ""}


def validate_stops(stops, years, mode="calendar"):
    if not isinstance(stops, list) or len(stops) > LIM["maxStops"]:
        fail(f"stops must be a list of at most {LIM['maxStops']}")
    out, prev = [], None
    for i, st in enumerate(stops):
        where = f"stops[{i}]"
        if not isinstance(st, dict) or not st.get("label") or len(str(st["label"])) > 80:
            fail(f"{where}: label is required (≤ 80 characters)")
        if not (isinstance(st.get("lat"), (int, float)) and -90 <= st["lat"] <= 90 and isinstance(st.get("lon"), (int, float)) and -180 <= st["lon"] <= 180):
            fail(f"{where}: lat/lon out of range")
        y = st.get("year")
        if not isinstance(y, (int, float)) or not (years[0] <= y <= years[1]):
            fail(f"{where}: year must lie within the job's years")
        if prev is not None and y < prev:
            fail(f"{where}: stops must be in time order")
        prev = y
        hold = st.get("hold", 12)
        if not isinstance(hold, (int, float)) or not (2 <= hold <= 180):
            fail(f"{where}: hold must be 2..180 seconds")
        media = st.get("media") or []
        if not isinstance(media, list) or len(media) > 12:
            fail(f"{where}: media must be a list of at most 12")
        norm = []
        for k, m in enumerate(media):
            m = {"src": m} if isinstance(m, str) else m
            if not isinstance(m, dict) or not isinstance(m.get("src"), str) or not m["src"]:
                fail(f"{where}.media[{k}]: needs src (a path or an http(s) URL)")
            rel = m["src"].split(":", 1)[1] if m["src"].split(":", 1)[0] + ":" in ("remake:", "library:", "anim:", "parallax:") else m["src"]
            if not m["src"].startswith(("http://", "https://")) and (".." in rel.split("/") or rel.startswith("/") and m["src"] != rel):
                fail(f"{where}.media[{k}]: '..' is not allowed in paths")
            norm.append({"src": m["src"], "credit": str(m.get("credit", ""))[:300], "caption": str(m.get("caption", ""))[:200]})
        kind = st.get("kind", "none")
        if kind not in STOP_KINDS:
            fail(f"{where}: kind must be one of {', '.join(STOP_KINDS)}")
        z = st.get("zoom", 3.0)
        if not isinstance(z, (int, float)) or not (1.2 <= z <= 12):
            fail(f"{where}: zoom must be 1.2..12")
        out.append({**st, "hold": float(hold), "media": norm, "kind": kind, "zoom": float(z),
                    "date": str(st.get("date") or format_time(y, mode))[:60], "caption": str(st.get("caption", ""))[:300],
                    "source": str(st.get("source", ""))[:200], "chapter": str(st.get("chapter", ""))[:80]})
    return out


# ── data ───────────────────────────────────────────────────────────────────────────────────────────
def load_clio(data_dir):
    """Cliopatria as [(name, from, to, geometry)] — simplified, cached as a pickle beside the GeoJSON."""
    cache = os.path.join(data_dir, "clio_cache_v1.pkl")
    if os.path.exists(cache):
        return pickle.load(open(cache, "rb"))
    src = os.path.join(data_dir, "cliopatria_polities_only.geojson")
    d = json.load(open(src))
    rows = []
    for f in d["features"]:
        p = f["properties"]
        try:
            g = shape(f["geometry"]).buffer(0).simplify(0.02, preserve_topology=True)
        except Exception:
            continue
        if g.is_empty:
            continue
        rows.append((p["Name"], int(p["FromYear"]), int(p["ToYear"]), wkb.dumps(g)))
    pickle.dump(rows, open(cache, "wb"))
    return rows


def territories_for(job, data_dir, frame_bbox):
    t = job.get("territories") or {}
    src = t.get("source")
    out = []  # dicts: name, from, to, geom (lon/lat), colour, context
    fb = box(*frame_bbox)
    if src in ("cliopatria", "cliopatria-bbox"):
        names = set(t.get("names") or [])
        match = [m.lower() for m in (t.get("match") or [])]
        min_area = float(t.get("minArea", 0))
        context = bool(t.get("context", src == "cliopatria"))
        y0, y1 = job["years"]
        for name, a, b, g in load_clio(data_dir):
            if b < y0 or a > y1:
                continue
            geom = wkb.loads(g)
            if not geom.intersects(fb):
                continue
            chosen = name in names or (not name.startswith("(") and any(m in name.lower() for m in match))
            if src == "cliopatria-bbox":
                if name.startswith("("):
                    continue
                chosen = True
            if not chosen and not context:
                continue
            if not chosen and name.startswith("("):
                continue
            out.append(dict(name=name, frm=a, to=b, geom=geom, colour=colour_for(name), context=not chosen, min_area=min_area))
    elif src == "geojson":
        fc = t.get("data") or json.load(open(t["path"]))
        feats = fc.get("features") or []
        if not feats or len(feats) > LIM["maxFeatures"]:
            fail(f"territories needs 1..{LIM['maxFeatures']} features")
        for i, f in enumerate(feats):
            p = f.get("properties") or {}
            if not p.get("name") or not isinstance(p.get("fromYear"), int) or not isinstance(p.get("toYear"), int):
                fail(f"feature {i}: name, fromYear, toYear are required")
            try:
                geom = shape(f["geometry"]).buffer(0)
            except Exception as e:
                fail(f"feature {i} ({p['name']}): invalid geometry: {e}")
            out.append(dict(name=p["name"], frm=p["fromYear"], to=p["toYear"], geom=geom, fixed=bool(p.get("colour")),
                            colour=hex_rgb(p["colour"]) if p.get("colour") else colour_for(p["name"]), context=False, min_area=0))
    # distinct colours per clip, in order of first appearance (user colours win); context polities stay muted
    order = []
    for it in sorted(out, key=lambda x: x["frm"]):
        if not it["context"] and it["name"] not in order and not (src == "geojson" and it.get("fixed")):
            order.append(it["name"])
    for it in out:
        if it["context"]:
            it["colour"] = (120, 110, 96)
        elif src != "geojson" or not it.get("fixed"):
            it["colour"] = DISTINCT[order.index(it["name"]) % len(DISTINCT)] if it["name"] in order else it["colour"]
    return out


def read_route(r, base):
    if r.get("points"):
        pts = r["points"]
    else:
        path = r["path"] if os.path.isabs(r["path"]) else os.path.join(base, r["path"])
        rows = list(csv.DictReader(open(path, newline="")))
        if len(rows) < 2 or len(rows) > LIM["maxRoutePoints"]:
            fail(f"route {r.get('label','')}: needs 2..{LIM['maxRoutePoints']} waypoints")
        pts = [{"label": x.get("label", "").strip(), "lat": float(x["lat"]), "lon": float(x["lon"]), "year": float(x["year"]),
                "note": (x.get("note") or "").strip()} for x in rows]
    for i in range(1, len(pts)):
        if pts[i]["year"] < pts[i - 1]["year"]:
            fail(f"route {r.get('label','')}: years go backwards at waypoint {i + 1}")
    return pts


# ── projection ─────────────────────────────────────────────────────────────────────────────────────
class Proj:
    """Lambert azimuthal equal-area centred on the bbox, fitted into the frame (with margins for titles)."""
    def __init__(self, bbox, w, h, projection="auto"):
        lon0 = (bbox[0] + bbox[2]) / 2; lat0 = (bbox[1] + bbox[3]) / 2
        crs = (f"+proj=eqc +lon_0={lon0} +datum=WGS84 +units=m" if projection == "equirect" or (bbox[2] - bbox[0]) > 150
               else f"+proj=laea +lat_0={lat0} +lon_0={lon0} +datum=WGS84 +units=m")
        self.tr = pyproj.Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        xs, ys = [], []
        for i in range(21):
            for lon, lat in ((bbox[0] + (bbox[2] - bbox[0]) * i / 20, bbox[1]), (bbox[0] + (bbox[2] - bbox[0]) * i / 20, bbox[3]),
                             (bbox[0], bbox[1] + (bbox[3] - bbox[1]) * i / 20), (bbox[2], bbox[1] + (bbox[3] - bbox[1]) * i / 20)):
                x, y = self.tr.transform(lon, lat); xs.append(x); ys.append(y)
        self.x0, self.x1, self.y0, self.y1 = min(xs), max(xs), min(ys), max(ys)
        self.w, self.h = w, h
        s = min(w / (self.x1 - self.x0), h / (self.y1 - self.y0))
        self.s = s
        self.ox = (w - (self.x1 - self.x0) * s) / 2; self.oy = (h - (self.y1 - self.y0) * s) / 2

    def px(self, lon, lat):
        x, y = self.tr.transform(lon, lat)
        return self.ox + (x - self.x0) * self.s, self.h - (self.oy + (y - self.y0) * self.s)

    def geom_px(self, g):
        return sh_transform(lambda x, y, z=None: tuple(np.array(self.px(np.asarray(x), np.asarray(y)))), g)


def _patch(ax, geom, **kw):
    polys = [geom] if isinstance(geom, Polygon) else list(getattr(geom, "geoms", []))
    for p in polys:
        if not isinstance(p, Polygon) or p.is_empty:
            continue
        verts, codes = [], []
        for ring in [p.exterior, *p.interiors]:
            c = list(ring.coords)
            verts += c; codes += [Path.MOVETO] + [Path.LINETO] * (len(c) - 2) + [Path.CLOSEPOLY]
        ax.add_patch(PathPatch(Path(verts, codes), **kw))


def _fig(w, h):
    fig = plt.figure(figsize=(w / 100, h / 100), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, w); ax.set_ylim(h, 0); ax.axis("off")
    fig.patch.set_alpha(0); ax.patch.set_alpha(0)
    return fig, ax


def _to_img(fig):
    buf = io.BytesIO(); fig.savefig(buf, format="png", transparent=True); plt.close(fig)
    buf.seek(0); return Image.open(buf).convert("RGBA")


_NE = {}
def _ne(data_dir, name):
    k = (data_dir, name)
    if k not in _NE:
        _NE[k] = [shape(f["geometry"]) for f in json.load(open(os.path.join(data_dir, name)))["features"]]
    return _NE[k]


def base_layer(proj, data_dir, bbox, pal, w, h):
    fig, ax = _fig(w, h)
    fb = box(bbox[0] - 20, max(-89, bbox[1] - 20), bbox[2] + 20, min(89, bbox[3] + 20))
    sea = tuple(c / 255 for c in pal["sea"]); land = tuple(c / 255 for c in pal["land"])
    ax.add_patch(plt.Rectangle((0, 0), w, h, color=sea, zorder=0))
    for g0 in _ne(data_dir, "ne_50m_land.geojson"):
        g = g0.intersection(fb)
        if not g.is_empty:
            _patch(ax, proj.geom_px(g), facecolor=land, edgecolor=(0, 0, 0, 0.35), linewidth=0.6, zorder=1)
    for g0 in _ne(data_dir, "ne_50m_lakes.geojson"):
        g = g0.intersection(fb)
        if not g.is_empty:
            _patch(ax, proj.geom_px(g), facecolor=sea, edgecolor="none", zorder=2)
    riv = tuple(c / 255 for c in pal["river"])
    for g0 in _ne(data_dir, "ne_50m_rivers_lake_centerlines.geojson"):
        g = g0.intersection(fb)
        for line in ([g] if g.geom_type == "LineString" else list(getattr(g, "geoms", []))):
            if line.geom_type != "LineString" or line.is_empty:
                continue
            xy = np.array([proj.px(x, y) for x, y in line.coords])
            ax.plot(xy[:, 0], xy[:, 1], color=riv, linewidth=1.1, alpha=0.85, zorder=3)
    grid = tuple(c / 255 for c in pal["grid"])
    for lon in range(-180, 181, 10):
        xy = np.array([proj.px(lon, lat) for lat in np.linspace(-80, 80, 80)])
        ax.plot(xy[:, 0], xy[:, 1], color=grid, linewidth=0.5, alpha=0.5, zorder=4)
    for lat in range(-80, 81, 10):
        xy = np.array([proj.px(lon, lat) for lon in np.linspace(-180, 180, 180)])
        ax.plot(xy[:, 0], xy[:, 1], color=grid, linewidth=0.5, alpha=0.5, zorder=4)
    img = _to_img(fig)
    out = Image.new("RGBA", (w, h), pal["sea"] + (255,)); out.alpha_composite(img)
    # vignette for the eerie documentary look
    vig = Image.new("L", (w, h), 0); d = ImageDraw.Draw(vig)
    d.ellipse([-w * 0.25, -h * 0.35, w * 1.25, h * 1.35], fill=255); vig = vig.filter(ImageFilter.GaussianBlur(w // 10))
    dark = Image.new("RGBA", (w, h), (0, 0, 0, 170)); dark.putalpha(Image.eval(vig, lambda v: int((255 - v) * 0.7)))
    out.alpha_composite(dark)
    return out


def territory_layer(proj, items, pal, w, h, font_scale):
    """RGBA layer for one set of active polities: fills, borders, non-overlapping labels."""
    fig, ax = _fig(w, h)
    labels = []
    for it in sorted(items, key=lambda x: (not x["context"], x["geom"].area)):
        g = proj.geom_px(it["geom"])
        if g.is_empty:
            continue
        rgb = tuple(c / 255 for c in it["colour"])
        if it["context"]:
            _patch(ax, g, facecolor=rgb + (0.10,), edgecolor=rgb + (0.30,), linewidth=0.5, zorder=5)
        else:
            _patch(ax, g, facecolor=rgb + (0.42,), edgecolor=rgb + (0.95,), linewidth=1.6, zorder=6)
            if g.area > (w * h) * 0.0006 and g.area >= it.get("min_area", 0):
                labels.append((it["name"], g))
    img = _to_img(fig)
    d = ImageDraw.Draw(img); boxes = []
    for name, g in sorted(labels, key=lambda x: -x[1].area):
        part = max(getattr(g, "geoms", [g]), key=lambda p: p.area)
        pt = part.representative_point()
        size = int(max(14, min(46, math.sqrt(part.area) / 9)) * font_scale)
        f = ImageFont.truetype(SERIF_B, size)
        name = name.strip("()") if name.startswith("(") else name
        text = name if len(name) <= 28 else name[:26] + "…"
        tw, th = d.textbbox((0, 0), text, font=f)[2:]
        bx = [pt.x - tw / 2, pt.y - th / 2, pt.x + tw / 2, pt.y + th / 2]
        if any(not (bx[2] < b[0] or bx[0] > b[2] or bx[3] < b[1] or bx[1] > b[3]) for b in boxes):
            continue
        if bx[0] < 4 or bx[2] > w - 4 or bx[1] < 4 or bx[3] > h - 4:
            continue
        boxes.append(bx)
        d.text((bx[0], bx[1]), text, font=f, fill=pal["label"] + (255,), stroke_width=max(2, size // 12), stroke_fill=(0, 0, 0, 200))
    return img


def card(w, h, pal, title, subtitle, lines):
    img = Image.new("RGBA", (w, h), (6, 8, 12, 255)); d = ImageDraw.Draw(img)
    s = h / 1080
    ft = ImageFont.truetype(SERIF_B, int(72 * s)); fs = ImageFont.truetype(SERIF, int(34 * s)); fl = ImageFont.truetype(SANS, int(24 * s))
    y = h * 0.36
    for text, f, col in [(title, ft, pal["text"] if pal is PALETTES["night"] else (236, 222, 190)), (subtitle, fs, (170, 160, 140))]:
        if text:
            tw = d.textbbox((0, 0), text, font=f)[2]; d.text(((w - tw) / 2, y), text, font=f, fill=col + (255,)); y += f.size * 1.5
    y += 20 * s
    for line in lines:
        for chunk in wrap(line, fl, d, w * 0.8):
            tw = d.textbbox((0, 0), chunk, font=fl)[2]; d.text(((w - tw) / 2, y), chunk, font=fl, fill=(150, 142, 126, 255)); y += fl.size * 1.45
    return img


def wrap(text, font, d, maxw):
    words, out, cur = text.split(), [], ""
    for wd in words:
        t = (cur + " " + wd).strip()
        if d.textbbox((0, 0), t, font=font)[2] > maxw and cur:
            out.append(cur); cur = wd
        else:
            cur = t
    if cur:
        out.append(cur)
    return out


class Fonts:
    def __init__(self, scale):
        self.year = ImageFont.truetype(SERIF_B, int(118 * scale)); self.title = ImageFont.truetype(SERIF, int(34 * scale))
        self.small = ImageFont.truetype(SANS, int(18 * scale)); self.city = ImageFont.truetype(SERIF, int(22 * scale))
        self.wp = ImageFont.truetype(SERIF_B, int(26 * scale)); self.place = ImageFont.truetype(SERIF_B, int(52 * scale))
        self.date = ImageFont.truetype(SERIF, int(34 * scale)); self.cap = ImageFont.truetype(SANS, int(24 * scale))
        self.kind = ImageFont.truetype(SANS, int(19 * scale)); self.ago = ImageFont.truetype(SERIF_B, int(78 * scale))


def draw_overlays(frame, proj, yr, j, routes, stops_seen, pal, F, scale, credit, show_year=True):
    """cities, routes, visited stops, year counter, title and credit — shared by the wide map and the close-ups."""
    w, h = frame.size
    d = ImageDraw.Draw(frame)
    for c in j.get("cities") or []:
        if c.get("from", -10 ** 9) <= yr <= c.get("to", 10 ** 9):
            x, y = proj.px(c["lon"], c["lat"])
            r = 5 * scale
            d.ellipse([x - r, y - r, x + r, y + r], fill=(250, 236, 200, 255), outline=(0, 0, 0, 255))
            d.text((x + r * 2, y - r * 2.4), c["name"], font=F.city, fill=pal["label"] + (255,), stroke_width=2, stroke_fill=(0, 0, 0, 220))
    for st in stops_seen:
        x, y = proj.px(st["lon"], st["lat"])
        r = 6 * scale
        d.ellipse([x - r, y - r, x + r, y + r], outline=(240, 200, 110, 255), width=max(2, int(2 * scale)))
    for r, pts in routes:
        if yr < pts[0]["year"]:
            continue
        lat, lon, reached, done = route_at(pts, yr)
        col = hex_rgb(r.get("colour", "#e8c170"))
        xy = [proj.px(p["lon"], p["lat"]) for p in pts[:reached + 1]] + [proj.px(lon, lat)]
        if len(xy) >= 2:
            d.line(xy, fill=col + (255,), width=max(3, int(5 * scale)), joint="curve")
        x, y = xy[-1]; rr = 9 * scale
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=col + (255,), outline=(0, 0, 0, 255), width=2)
        for p in pts[:reached + 1]:
            px_, py_ = proj.px(p["lon"], p["lat"]); d.ellipse([px_ - 3, py_ - 3, px_ + 3, py_ + 3], fill=col + (255,))
        lab = pts[reached]["label"]
        if lab:
            d.text((x + rr * 1.6, y - rr * 2.6), lab, font=F.wp, fill=(255, 244, 214, 255), stroke_width=3, stroke_fill=(0, 0, 0, 230))
        if r.get("label"):
            d.text((x + rr * 1.6, y + rr * 0.4), r["label"], font=F.small, fill=col + (255,), stroke_width=2, stroke_fill=(0, 0, 0, 230))
    if show_year:
        ytxt = format_time(yr, j.get("timeMode", "calendar"))
        f = F.year if len(ytxt) <= 9 else F.ago
        tw, th = d.textbbox((0, 0), ytxt, font=f)[2:]
        d.text((w - tw - 48 * scale, h - th - 70 * scale), ytxt, font=f, fill=pal["text"] + (255,), stroke_width=4, stroke_fill=(0, 0, 0, 230))
    d.text((40 * scale, 32 * scale), j["title"], font=F.title, fill=pal["text"] + (255,), stroke_width=2, stroke_fill=(0, 0, 0, 220))
    if j.get("note"):
        d.text((40 * scale, 76 * scale), j["note"], font=F.small, fill=pal["sub"] + (255,), stroke_width=2, stroke_fill=(0, 0, 0, 200))
    d.text((40 * scale, h - 34 * scale), "Alpha · " + credit[:150], font=F.small, fill=pal["sub"] + (255,))
    return frame


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def zoom_crop(img, cx, cy, z):
    """the frame zoomed by z around (cx, cy), clamped to stay inside the picture."""
    w, h = img.size
    cw, ch = w / z, h / z
    x0 = min(max(0, cx - cw / 2), w - cw); y0 = min(max(0, cy - ch / 2), h - ch)
    return img.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch))).resize((w, h), Image.LANCZOS)


GEN_HOME = os.environ.get("MELEK_GEN_HOME") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA_SCHEMES = {"remake:": "remakes", "library:": "library", "anim:": "anims", "parallax:": os.path.join("maps", "stops", "parallax")}


def fetch_media(src, base_dir, tmp):
    for pre, sub in MEDIA_SCHEMES.items():  # our own galleries, by name (no server paths in jobs)
        if src.startswith(pre):
            return os.path.join(GEN_HOME, sub, src[len(pre):])
    if src.startswith(("http://", "https://")):
        import urllib.request, urllib.error
        ext = os.path.splitext(src.split("?")[0])[1].lower() or ".jpg"
        cache = os.path.join(GEN_HOME, "maps", "stops", "cache")  # persistent: open-licence art is fetched once, politely
        os.makedirs(cache, exist_ok=True)
        dst = os.path.join(cache, hashlib.sha1(src.encode()).hexdigest()[:16] + ext)
        if not os.path.exists(dst):
            for wait in (0, 8, 30, 90):
                time.sleep(wait)
                try:
                    req = urllib.request.Request(src, headers={"user-agent": "HathorMaps/1.0 (https://hathor.soapbox.community/maps; open-licence art for history films)"})
                    with urllib.request.urlopen(req, timeout=90) as r:
                        data = r.read(60 * 1024 * 1024)
                    with open(dst + ".part", "wb") as f:
                        f.write(data)
                    os.replace(dst + ".part", dst)
                    break
                except urllib.error.HTTPError as e:
                    if e.code not in (429, 503) or wait == 90:
                        raise
        return dst
    return src if os.path.isabs(src) else os.path.join(base_dir, src)


def cover(img, w, h):
    iw, ih = img.size
    s = max(w / iw, h / ih)
    img = img.resize((max(w, int(iw * s + 0.5)), max(h, int(ih * s + 0.5))), Image.LANCZOS)
    x0 = (img.width - w) // 2; y0 = (img.height - h) // 2
    return img.crop((x0, y0, x0 + w, y0 + h))


def media_frames(path, n, w, h, fps, k):
    """n RGBA frames for one media item: a video is decoded (looped if short); an image gets a slow camera move."""
    if path.lower().endswith((".mp4", ".webm", ".mov", ".mkv")):
        p = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-stream_loop", "-1", "-i", path, "-vf",
                              f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},fps={fps}", "-frames:v", str(n),
                              "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
        size = w * h * 3; last = None
        for _ in range(n):
            buf = p.stdout.read(size)
            if len(buf) < size:
                break
            last = Image.frombytes("RGB", (w, h), buf).convert("RGBA")
            yield last
        p.stdout.close(); p.wait()
        return
    src = cover(Image.open(path).convert("RGB"), int(w * 1.12), int(h * 1.12)).convert("RGBA")
    push = k % 2 == 0
    for i in range(n):
        t = i / max(1, n - 1)
        z = 1.0 + 0.10 * (t if push else 1 - t)
        cw, ch = src.width / (1.12 * z / 1.0) , src.height / (1.12 * z / 1.0)
        cx = src.width / 2 + (src.width * 0.03) * (t - 0.5) * (1 if k % 3 else -1)
        cy = src.height / 2
        box_ = (int(cx - cw / 2), int(cy - ch / 2), int(cx + cw / 2), int(cy + ch / 2))
        yield src.crop(box_).resize((w, h), Image.BILINEAR)


def stop_card(frame, st, F, scale, pal, credit_line, alpha=1.0):
    """place + date card over the lower third (with its kind and source), faded by alpha."""
    w, h = frame.size
    over = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(over)
    band_h = int(h * 0.26)
    grad = Image.linear_gradient("L").resize((w, band_h))
    band = Image.new("RGBA", (w, band_h), (0, 0, 0, 255)); band.putalpha(grad.point(lambda v: int(v * 0.82 * alpha)))
    over.alpha_composite(band, (0, h - band_h))
    x = int(64 * scale); y = h - band_h + int(26 * scale)
    a = int(255 * alpha)
    d.text((x, y), st["label"], font=F.place, fill=(240, 214, 150, a), stroke_width=2, stroke_fill=(0, 0, 0, a))
    tw = d.textbbox((0, 0), st["label"], font=F.place)[2]
    d.text((x + tw + int(22 * scale), y + int(14 * scale)), st["date"], font=F.date, fill=(230, 222, 200, a), stroke_width=2, stroke_fill=(0, 0, 0, a))
    y += int(70 * scale)
    if st.get("caption"):
        for line in wrap(st["caption"], F.cap, d, w * 0.84)[:2]:
            d.text((x, y), line, font=F.cap, fill=(225, 225, 225, a), stroke_width=2, stroke_fill=(0, 0, 0, a)); y += int(32 * scale)
    tag = " · ".join(t for t in [KIND_TEXT.get(st["kind"], ""), st.get("source", "")] if t)
    if tag:
        d.text((x, y + int(4 * scale)), tag, font=F.kind, fill=(224, 161, 27, a), stroke_width=1, stroke_fill=(0, 0, 0, a))
    if credit_line:
        cw_ = d.textbbox((0, 0), credit_line[:140], font=F.small)[2]
        d.text((w - cw_ - int(24 * scale), h - int(30 * scale)), credit_line[:140], font=F.small, fill=(170, 160, 140, a))
    frame.alpha_composite(over)
    return frame


def render(job, out, out720=None, data_dir=".", base_dir=".", poster=None, segments_dir=None):
    j = validate(job)
    w, h = j["size"]; fps = j["fps"]; dur = float(j["duration"]); pal = PALETTES[j["palette"]]
    y0, y1 = j["years"]; bbox = j["bbox"]
    t0 = time.time()
    proj = Proj(bbox, w, h, j.get("projection", "auto"))
    t = j.get("territories") or {}
    if t.get("source") == "geojson" and t.get("path") and not os.path.isabs(t["path"]):
        j["territories"] = {**t, "path": os.path.join(base_dir, t["path"])}  # relative to the job file, like routes
    items = territories_for(j, data_dir, bbox)
    routes = [(r, read_route(r, base_dir)) for r in (j.get("routes") or [])]
    base = base_layer(proj, data_dir, bbox, pal, w, h)
    scale = w / 1920
    F = Fonts(scale)
    n_map = int(dur * fps); n_title = int(2.5 * fps); n_end = int(3.5 * fps); xfade = max(1, int(0.6 * fps))
    credit = j.get("credit") or (CLIO_CREDIT if (j.get("territories") or {}).get("source", "").startswith("cliopatria") else "Base map: Natural Earth (public domain).")
    testing = j.get("testing", "")
    mode, tscale = j["timeMode"], j["timeScale"]
    title_card = card(w, h, pal, j["title"], j.get("subtitle", f"{format_time(y0, mode)} – {format_time(y1, mode)}"), ([j["note"]] if j.get("note") else []) + ([testing] if testing else []))
    end_lines = [credit, j.get("endNote") or "Borders are one scholarly reconstruction; ancient frontiers were uncertain and changed within these years."]
    if j["stops"]:
        end_lines.append("Pictures at each stop: remakes and public-domain art — every credit is listed on the film's page.")
    end_card = card(w, h, pal, j["title"], "Alpha — Hathor's first maps; later versions will be more accurate.", end_lines + ([testing] if testing else []))
    layers, keyset_at = {}, []
    step = int(j.get("stepYears") or (1 if tscale == "log" else max(1, round((y1 - y0) / 150))))
    def keyset(yr):
        ky = y0 + math.floor((yr - y0) / step) * step
        return tuple(k for k, it in enumerate(items) if it["frm"] <= ky <= it["to"])
    for i in range(n_map):
        key = keyset(year_at(i, n_map, y0, y1, tscale))
        keyset_at.append(key)
        if key not in layers:
            layers[key] = territory_layer(proj, [items[k] for k in key], pal, w, h, scale)
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-"]
    if out720:
        cmd += ["-filter_complex", "[0:v]split=2[a][b];[b]scale=1280:720[c]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", out, "-map", "[c]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", out720]
    else:
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]
    ff = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    count = [0]
    def emit(img):
        ff.stdin.write(img.convert("RGB").tobytes()); count[0] += 1

    import tempfile
    tmp = tempfile.mkdtemp(prefix="mapstops-")
    stop_info, stops_seen, next_stop = [], [], 0
    first_map = poster_frame = None

    def play_stop(st, wide_frame, yr):
        """zoom in → close-up map → media with the place card → close-up → pull back."""
        nonlocal poster_frame
        start = count[0]
        cx, cy = proj.px(st["lon"], st["lat"])
        z = st["zoom"]
        lon_span = (bbox[2] - bbox[0]) / z; lat_span = (bbox[3] - bbox[1]) / z
        dbox = [max(-180, st["lon"] - lon_span / 2), max(-89, st["lat"] - lat_span / 2), min(180, st["lon"] + lon_span / 2), min(89, st["lat"] + lat_span / 2)]
        dproj = Proj(dbox, w, h, "auto")
        detail = base_layer(dproj, data_dir, dbox, pal, w, h)
        detail.alpha_composite(territory_layer(dproj, [items[k] for k in keyset(yr)], pal, w, h, scale))
        draw_overlays(detail, dproj, yr, j, routes, stops_seen + [st], pal, F, scale, credit)
        dd = ImageDraw.Draw(detail); mx, my = dproj.px(st["lon"], st["lat"]); rr = 14 * scale
        dd.ellipse([mx - rr, my - rr, mx + rr, my + rr], outline=(255, 226, 150, 255), width=max(3, int(4 * scale)))
        n_in = int(1.6 * fps)
        for i in range(n_in):  # ease in on the wide map, cross-fading into the sharp close-up
            e = ease(i / max(1, n_in - 1))
            zz = zoom_crop(wide_frame, cx, cy, 1 + (z - 1) * e)
            a = max(0.0, (e - 0.55) / 0.45)
            emit(Image.blend(zz, detail, a) if a > 0 else zz)
        for i in range(int(0.6 * fps)):
            emit(detail)
        media = [m for m in st["media"]]
        credits_here = []
        last = detail
        if media:
            per = max(2.0, st["hold"] / len(media))
            for k, m in enumerate(media):
                try:
                    path = fetch_media(m["src"], base_dir, tmp)
                except Exception as e:
                    print(f"stop {st['label']}: media skipped ({e})", file=sys.stderr); continue
                credit_line = (m.get("credit") or "")
                if credit_line:
                    credits_here.append(credit_line)
                n = int(per * fps)
                for i, fr in enumerate(media_frames(path, n, w, h, fps, k)):
                    if i < xfade:
                        fr = Image.blend(last, fr, (i + 1) / (xfade + 1))
                    card_a = min(1.0, (i + 1) / (0.8 * fps)) if k == 0 else 1.0
                    stop_card(fr, st, F, scale, pal, credit_line, card_a)
                    if poster_frame is None and k == 0 and i == n // 2:
                        poster_frame = fr.copy()
                    emit(fr); last = fr
        else:
            for i in range(int(st["hold"] * fps)):
                fr = detail.copy(); stop_card(fr, st, F, scale, pal, "", min(1.0, (i + 1) / (0.8 * fps))); emit(fr); last = fr
        for i in range(xfade):
            emit(Image.blend(last, detail, (i + 1) / xfade))
        n_out = int(1.4 * fps)
        for i in range(n_out):  # back out to the wide map
            e = ease(i / max(1, n_out - 1))
            zz = zoom_crop(wide_frame, cx, cy, z - (z - 1) * e)
            a = max(0.0, 1 - e / 0.45)
            emit(Image.blend(zz, detail, a) if a > 0 else zz)
        stops_seen.append(st)
        stop_info.append({"label": st["label"], "date": st["date"], "year": st["year"], "kind": st["kind"], "caption": st["caption"],
                          "source": st.get("source", ""), "chapter": st.get("chapter", ""), "start": start / fps, "frames": count[0] - start,
                          "credits": credits_here})

    for i in range(n_title):
        a = min(1.0, max(0.0, (i - n_title * 0.6) / (n_title * 0.4)))
        emit(Image.blend(title_card, base, a) if a > 0 else title_card)
    prev_key, change_at = keyset_at[0], -10 ** 9
    last = base
    for i in range(n_map):
        yr = year_at(i, n_map, y0, y1, tscale); key = keyset_at[i]
        if key != prev_key:
            old, prev_key, change_at = layers[prev_key], key, i
        frame = base.copy()
        cur = layers[key]
        frame.alpha_composite(Image.blend(old, cur, (i - change_at + 1) / xfade) if i - change_at < xfade else cur)
        draw_overlays(frame, proj, yr, j, routes, stops_seen, pal, F, scale, credit)
        if first_map is None and i == n_map // 2:
            first_map = frame.copy()
        emit(frame)
        last = frame
        while next_stop < len(j["stops"]) and yr >= j["stops"][next_stop]["year"]:
            play_stop(j["stops"][next_stop], frame, yr)
            next_stop += 1
    while next_stop < len(j["stops"]):  # stops dated at the very end
        play_stop(j["stops"][next_stop], last, y1); next_stop += 1
    for i in range(n_end):
        a = min(1.0, i / (n_end * 0.35))
        emit(Image.blend(last, end_card, a))
    ff.stdin.close()
    if ff.wait() != 0:
        raise SystemExit("ffmpeg failed")
    if poster:
        pf = poster_frame or first_map
        if pf is not None:
            pf.convert("RGB").save(poster, quality=84)
    segs = []
    if segments_dir and stop_info:
        os.makedirs(segments_dir, exist_ok=True)
        stem = os.path.splitext(os.path.basename(out))[0]
        for n, sti in enumerate(stop_info, 1):
            seg = os.path.join(segments_dir, f"{stem}-stop{n:02d}.mp4")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{sti['start']:.3f}", "-i", out, "-t", f"{sti['frames'] / fps:.3f}",
                            "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", seg], check=True)
            sti["segment"] = os.path.basename(seg); segs.append(seg)
    return {"frames": count[0], "layers": len(layers), "seconds": round(time.time() - t0, 1),
            "polities": sorted({items[k]["name"].strip("()") for key in layers for k in key if not items[k]["context"]}), "credit": credit,
            "stops": stop_info, "fps": fps}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("job"); ap.add_argument("--out", required=True); ap.add_argument("--out720"); ap.add_argument("--poster")
    ap.add_argument("--data", default=os.environ.get("MAPS_DATA", "data")); ap.add_argument("--segments")
    ap.add_argument("--prefetch", action="store_true", help="only download the stops' media into the cache (3 s apart), then exit")
    a = ap.parse_args()
    job = json.load(open(a.job))
    if a.prefetch:
        base_dir = os.path.dirname(os.path.abspath(a.job)); ok = bad = 0
        for st in validate(job)["stops"]:
            for m in st["media"]:
                try:
                    p = fetch_media(m["src"], base_dir, None); ok += os.path.exists(p); bad += not os.path.exists(p)
                    print(("ok  " if os.path.exists(p) else "MISSING ") + m["src"][:120], flush=True)
                except Exception as e:
                    bad += 1; print(f"FAIL {m['src'][:120]}: {e}", flush=True)
                if m["src"].startswith("http"):
                    time.sleep(3)
        print(json.dumps({"ok": ok, "missing": bad})); raise SystemExit(0 if not bad else 1)
    info = render(job, a.out, a.out720, a.data, os.path.dirname(os.path.abspath(a.job)), a.poster, a.segments)
    print(json.dumps(info))
