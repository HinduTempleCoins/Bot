"""render_map.py — Hathor's animated history maps: territories that change over time, a year counter that ticks,
campaign routes that draw themselves, cities that appear and vanish. CPU-only (shapely + pyproj + matplotlib +
Pillow + ffmpeg). The job format is documented in README.md / spec.mjs (validated identically here).

  python render_map.py job.json --out clip.mp4 [--out720 clip_720.mp4] [--data DATA_DIR] [--poster poster.jpg]

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
           maxFeatures=5000, maxRoutePoints=5000)
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
    n = int(round(y))
    if n < 0:
        return f"{-n} BC"
    n = 1 if n == 0 else n
    return f"AD {n}" if n < 1000 else str(n)


def year_at(i, n, y0, y1):
    return y0 if n <= 1 else y0 + (y1 - y0) * (i / (n - 1))


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
    y = j.get("years")
    if not (isinstance(y, list) and len(y) == 2 and all(isinstance(v, int) for v in y) and y[0] < y[1] and y[0] >= LIM["minYear"] and y[1] <= LIM["maxYear"]):
        fail("years must be [from, to] integers, from < to")
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
    return j


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


def base_layer(proj, data_dir, bbox, pal, w, h):
    fig, ax = _fig(w, h)
    fb = box(bbox[0] - 20, max(-89, bbox[1] - 20), bbox[2] + 20, min(89, bbox[3] + 20))
    sea = tuple(c / 255 for c in pal["sea"]); land = tuple(c / 255 for c in pal["land"])
    ax.add_patch(plt.Rectangle((0, 0), w, h, color=sea, zorder=0))
    for f in json.load(open(os.path.join(data_dir, "ne_50m_land.geojson")))["features"]:
        g = shape(f["geometry"]).intersection(fb)
        if not g.is_empty:
            _patch(ax, proj.geom_px(g), facecolor=land, edgecolor=(0, 0, 0, 0.35), linewidth=0.6, zorder=1)
    for f in json.load(open(os.path.join(data_dir, "ne_50m_lakes.geojson")))["features"]:
        g = shape(f["geometry"]).intersection(fb)
        if not g.is_empty:
            _patch(ax, proj.geom_px(g), facecolor=sea, edgecolor="none", zorder=2)
    riv = tuple(c / 255 for c in pal["river"])
    for f in json.load(open(os.path.join(data_dir, "ne_50m_rivers_lake_centerlines.geojson")))["features"]:
        g = shape(f["geometry"]).intersection(fb)
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


def render(job, out, out720=None, data_dir=".", base_dir=".", poster=None):
    j = validate(job)
    w, h = j["size"]; fps = j["fps"]; dur = float(j["duration"]); pal = PALETTES[j["palette"]]
    y0, y1 = j["years"]; bbox = j["bbox"]
    t0 = time.time()
    proj = Proj(bbox, w, h, j.get("projection", "auto"))
    items = territories_for(j, data_dir, bbox)
    routes = [(r, read_route(r, base_dir)) for r in (j.get("routes") or [])]
    base = base_layer(proj, data_dir, bbox, pal, w, h)
    font_scale = w / 1920
    n_map = int(dur * fps); n_title = int(2.5 * fps); n_end = int(3.5 * fps); xfade = max(1, int(0.6 * fps))
    credit = j.get("credit") or (CLIO_CREDIT if (j.get("territories") or {}).get("source", "").startswith("cliopatria") else "Base map: Natural Earth (public domain).")
    title_card = card(w, h, pal, j["title"], j.get("subtitle", f"{format_year(y0)} – {format_year(y1)}"), [])
    end_card = card(w, h, pal, j["title"], "Alpha — Hathor's first maps; later versions will be more accurate.",
                    [credit, "Borders are one scholarly reconstruction; ancient frontiers were uncertain and changed within these years."])
    layers, keyset_at = {}, []
    step = int(j.get("stepYears") or max(1, round((y1 - y0) / 150)))  # territory state resolution (years)
    for i in range(n_map):
        yr = year_at(i, n_map, y0, y1)
        ky = y0 + math.floor((yr - y0) / step) * step
        key = tuple(k for k, it in enumerate(items) if it["frm"] <= ky <= it["to"])
        keyset_at.append(key)
        if key not in layers:
            layers[key] = territory_layer(proj, [items[k] for k in key], pal, w, h, font_scale)
    fy = ImageFont.truetype(SERIF_B, int(118 * font_scale)); ftitle = ImageFont.truetype(SERIF, int(34 * font_scale))
    fsmall = ImageFont.truetype(SANS, int(18 * font_scale)); fcity = ImageFont.truetype(SERIF, int(22 * font_scale))
    fwp = ImageFont.truetype(SERIF_B, int(26 * font_scale))
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-"]
    if out720:
        cmd += ["-filter_complex", "[0:v]split=2[a][b];[b]scale=1280:720[c]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", out, "-map", "[c]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", out720]
    else:
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]
    ff = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    def emit(img):
        ff.stdin.write(img.convert("RGB").tobytes())
    first_map = None
    for i in range(n_title):  # title card, then fade into the map
        a = min(1.0, max(0.0, (i - n_title * 0.6) / (n_title * 0.4)))
        emit(Image.blend(title_card, base, a) if a > 0 else title_card)
    prev_key, change_at = keyset_at[0], -10 ** 9
    for i in range(n_map):
        yr = year_at(i, n_map, y0, y1); key = keyset_at[i]
        if key != prev_key:
            old, prev_key, change_at = layers[prev_key], key, i
        frame = base.copy()
        cur = layers[key]
        if i - change_at < xfade:
            frame.alpha_composite(Image.blend(old, cur, (i - change_at + 1) / xfade))
        else:
            frame.alpha_composite(cur)
        d = ImageDraw.Draw(frame)
        for c in j.get("cities") or []:
            if c.get("from", -10 ** 6) <= yr <= c.get("to", 10 ** 6):
                x, y = proj.px(c["lon"], c["lat"])
                r = 5 * font_scale
                d.ellipse([x - r, y - r, x + r, y + r], fill=(250, 236, 200, 255), outline=(0, 0, 0, 255))
                d.text((x + r * 2, y - r * 2.4), c["name"], font=fcity, fill=pal["label"] + (255,), stroke_width=2, stroke_fill=(0, 0, 0, 220))
        for r, pts in routes:
            if yr < pts[0]["year"]:
                continue
            lat, lon, reached, done = route_at(pts, yr)
            col = hex_rgb(r.get("colour", "#e8c170"))
            xy = [proj.px(p["lon"], p["lat"]) for p in pts[:reached + 1]] + [proj.px(lon, lat)]
            if len(xy) >= 2:
                d.line(xy, fill=col + (255,), width=max(3, int(5 * font_scale)), joint="curve")
            x, y = xy[-1]; rr = 9 * font_scale
            d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=col + (255,), outline=(0, 0, 0, 255), width=2)
            for p in pts[:reached + 1]:
                px_, py_ = proj.px(p["lon"], p["lat"]); d.ellipse([px_ - 3, py_ - 3, px_ + 3, py_ + 3], fill=col + (255,))
            lab = pts[reached]["label"]
            if lab:
                d.text((x + rr * 1.6, y - rr * 2.6), lab, font=fwp, fill=(255, 244, 214, 255), stroke_width=3, stroke_fill=(0, 0, 0, 230))
            if r.get("label"):
                d.text((x + rr * 1.6, y + rr * 0.4), r["label"], font=fsmall, fill=col + (255,), stroke_width=2, stroke_fill=(0, 0, 0, 230))
        ytxt = format_year(yr)
        tw, th = d.textbbox((0, 0), ytxt, font=fy)[2:]
        d.text((w - tw - 48 * font_scale, h - th - 70 * font_scale), ytxt, font=fy, fill=pal["text"] + (255,), stroke_width=4, stroke_fill=(0, 0, 0, 230))
        d.text((40 * font_scale, 32 * font_scale), j["title"], font=ftitle, fill=pal["text"] + (255,), stroke_width=2, stroke_fill=(0, 0, 0, 220))
        d.text((40 * font_scale, h - 34 * font_scale), "Alpha · " + credit[:150], font=fsmall, fill=pal["sub"] + (255,))
        if first_map is None and i == n_map // 2:
            first_map = frame.copy()
        emit(frame)
        last = frame
    for i in range(n_end):
        a = min(1.0, i / (n_end * 0.35))
        emit(Image.blend(last, end_card, a))
    ff.stdin.close()
    if ff.wait() != 0:
        raise SystemExit("ffmpeg failed")
    if poster and first_map is not None:
        first_map.convert("RGB").save(poster, quality=84)
    return {"frames": n_title + n_map + n_end, "layers": len(layers), "seconds": round(time.time() - t0, 1),
            "polities": sorted({items[k]["name"] for key in layers for k in key if not items[k]["context"]}), "credit": credit}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("job"); ap.add_argument("--out", required=True); ap.add_argument("--out720"); ap.add_argument("--poster")
    ap.add_argument("--data", default=os.environ.get("MAPS_DATA", "data"))
    a = ap.parse_args()
    job = json.load(open(a.job))
    info = render(job, a.out, a.out720, a.data, os.path.dirname(os.path.abspath(a.job)), a.poster)
    print(json.dumps(info))
