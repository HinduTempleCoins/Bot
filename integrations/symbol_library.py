"""symbol_library.py — build knowledge/symbols/ (the Religious & Occult Symbol Library) for Hathor Studio + the Hierophant.

Inputs:
  * integrations/symbol-library-spec.mjs        — the symbols (name, traditions, period, meaning, figures, status)
  * <src>/manifest.json + <src>/<id>.svg|png|jpg — what genai-symbol-harvest.mjs pulled from Wikimedia Commons
                                                   (licence-checked) + the Wikipedia source articles it fetched
  * <fonts>/Noto*.ttf                            — Noto (SIL OFL) for symbols that are Unicode characters

Outputs (in <out>):
  <id>.png       512px, black on transparent (every symbol)
  <id>.orig.png  512px coloured original, when the source is meaningfully coloured
  catalog.json   {"notes", "symbols": [{id, name, tradition, period, meaning, figures, sources, image, ...}]}
  sheet.jpg      contact sheet

  python integrations/symbol_library.py build <src_dir> <fonts_dir> <out_dir>
"""
import colorsys, io, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PX = 512

# Schematic drawings, used ONLY where no openly licensed image exists and the form is simple and documented.
# Released CC0 as part of this library; each is marked via:"drawn" in the catalog.
DRAWN = {
    # Nanna/Sin: the lunar crescent, horns up (kudurrus, cylinder seals)
    "crescent-of-sin": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
                       '<path d="M18.4,27.5 A40,40 0 1,0 81.6,27.5 A34,34 0 1,1 18.4,27.5 Z"/></svg>',
    # Punic stelae: a disc above a down-turned crescent
    "crescent-and-disc": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="24" r="15"/>'
                         '<path d="M18.4,58.5 A40,40 0 1,1 81.6,58.5 A34,34 0 1,0 18.4,58.5 Z" transform="translate(0,6)"/></svg>',
    # Ur-Nammu stele / Code of Hammurabi: a ring held with a straight rod
    "rod-and-ring": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="46" y="8" width="8" height="86" rx="3"/>'
                    '<circle cx="50" cy="36" r="22" fill="none" stroke="#000" stroke-width="8"/></svg>',
}


def _circles_svg(rings, outer):
    """Overlapping-circles grid: every hex-lattice point within `rings` steps of the centre, radius = lattice step."""
    import math
    r, pts = 14.0, set()
    for i in range(-rings, rings + 1):
        for j in range(-rings, rings + 1):
            k = -i - j
            if max(abs(i), abs(j), abs(k)) <= rings:
                pts.add((round(50 + r * (i + j / 2), 3), round(50 + r * j * math.sqrt(3) / 2, 3)))
    body = "".join(f'<circle cx="{x}" cy="{y}" r="{r}"/>' for x, y in sorted(pts))
    ring = f'<circle cx="50" cy="50" r="{r * outer}"/>' if outer else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 104 104"><g fill="none" stroke="#000" stroke-width="1.4">'
            f'{body}{ring}</g></svg>')


DRAWN["flower-of-life"] = _circles_svg(2, 3)  # 19 circles in an enclosing circle
DRAWN["seed-of-life"] = _circles_svg(1, 2)    # 7 circles


def load_spec():
    js = "import('./integrations/symbol-library-spec.mjs').then(m=>process.stdout.write(JSON.stringify(m.SYMBOLS.map(s=>({...s,group:m.groupOf(s)})))))"
    out = subprocess.run(["node", "-e", js], cwd=os.path.dirname(HERE), capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def fit(img, px=PX, pad=0.08):
    """Crop to content and centre on a px×px transparent canvas."""
    from PIL import Image
    a = img.getchannel("A").point(lambda v: 255 if v > 8 else 0)
    box = a.getbbox()
    if not box:
        return None
    g = img.crop(box)
    s = (px * (1 - 2 * pad)) / max(g.size)
    g = g.resize((max(1, round(g.width * s)), max(1, round(g.height * s))), Image.LANCZOS)
    out = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    out.paste(g, ((px - g.width) // 2, (px - g.height) // 2), g)
    return out


def inline_entities(data):
    """Illustrator SVGs declare internal <!ENTITY>s, which cairosvg's safe parser refuses. Substitute the internal
    (string) entities ourselves and drop the DOCTYPE — no external entities are ever resolved."""
    import re
    s = data.decode("utf-8", "replace")
    m = re.search(r"<!DOCTYPE[^\[>]*(\[(.*?)\])?\s*>", s, re.S)
    if not m:
        return data
    ents = dict(re.findall(r'<!ENTITY\s+([\w.-]+)\s+"([^"]*)"\s*>', m.group(2) or ""))
    s = s[:m.start()] + s[m.end():]
    for k, v in ents.items():
        s = s.replace(f"&{k};", v)
    return s.encode("utf-8")


def rasterise(path):
    from PIL import Image
    if path.endswith(".svg"):
        import cairosvg
        data = inline_entities(open(path, "rb").read())
        png = cairosvg.svg2png(bytestring=data, output_width=1400)
        img = Image.open(io.BytesIO(png)).convert("RGBA")
        if max(img.size) > 2400:  # very tall SVGs
            img.thumbnail((1400, 1400))
        return img
    img = Image.open(path).convert("RGBA")
    img.thumbnail((1400, 1400))
    return img


def to_ink(img):
    """Black-on-transparent: ink = dark OR saturated pixels; white/very light fills become transparent."""
    import numpy as np
    from PIL import Image
    a = np.asarray(img).astype(np.float32) / 255.0
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    dark = np.clip((0.93 - lum) / 0.3, 0, 1)
    colourful = np.clip((sat - 0.18) / 0.22, 0, 1) * (mx > 0.25)
    ink = np.maximum(dark, colourful) * al
    # Symbol drawn on a solid field (a badge, a flag-like square): if the border is an opaque, uniform colour,
    # that colour is the background — ink is everything that differs from it.
    h, w = al.shape
    bw = max(2, min(h, w) // 50)
    border = np.concatenate([a[:bw].reshape(-1, 4), a[-bw:].reshape(-1, 4), a[:, :bw].reshape(-1, 4), a[:, -bw:].reshape(-1, 4)])
    if (border[:, 3] > 0.8).mean() > 0.85:
        bg = np.median(border[border[:, 3] > 0.8][:, :3], axis=0)
        spread = np.abs(border[:, :3] - bg).max(axis=1)
        if (spread < 0.08).mean() > 0.85:
            dist = np.abs(a[..., :3] - bg).max(axis=2)
            ink = np.clip((dist - 0.08) / 0.2, 0, 1) * al
    out = np.zeros(a.shape, dtype=np.uint8)
    out[..., 3] = (ink * 255).astype(np.uint8)
    colour = float((sat * al).sum() / max(al.sum(), 1))
    return Image.fromarray(out, "RGBA"), colour


def fonts_index(fonts_dir):
    from fontTools.ttLib import TTFont
    idx = []
    for f in sorted(os.listdir(fonts_dir)):
        if f.endswith(".ttf"):
            p = os.path.join(fonts_dir, f)
            idx.append((p, set(TTFont(p).getBestCmap().keys())))
    # prefer Symbols fonts first for shared code points
    idx.sort(key=lambda t: (0 if "Symbols" in t[0] else 1, t[0]))
    return idx


def render_cp(fidx, cp):
    from PIL import Image, ImageDraw, ImageFont
    for path, cmap in fidx:
        if cp in cmap:
            font = ImageFont.truetype(path, 600)
            img = Image.new("RGBA", (1400, 1400), (0, 0, 0, 0))
            ImageDraw.Draw(img).text((300, 200), chr(cp), font=font, fill=(0, 0, 0, 255))
            out = fit(img, pad=0.12)
            if out is not None:
                return out, os.path.basename(path).replace("-Regular.ttf", "")
    return None, None


def build(src, fonts_dir, out):
    os.makedirs(out, exist_ok=True)
    spec = load_spec()
    mf = json.load(open(os.path.join(src, "manifest.json")))
    fidx = fonts_index(fonts_dir)
    cat = []
    for s in spec:
        m = mf.get(s["id"], {})
        rec = {k: s[k] for k in ("id", "name", "tradition", "group", "period", "meaning", "figures", "status", "note")}
        rec["sources"] = [{"title": x["title"], "url": x["url"]} for x in m.get("sources", [])]
        if s.get("cp"):
            rec["unicode"] = f"U+{s['cp']:04X}"
        img_rec, done = None, False
        mi = m.get("image")
        if mi and not s.get("font"):
            try:
                raw = rasterise(os.path.join(src, mi["file"]))
                ink, colour = to_ink(raw)
                black = fit(ink)
                if black is not None:
                    black.save(os.path.join(out, f"{s['id']}.png"), optimize=True)
                    img_rec = {"file": f"{s['id']}.png", "licence": mi["licence"], "author": mi["author"], "source": mi["source"],
                               "title": mi["title"], "via": "wikimedia-commons (genai-symbol-harvest)", "bucket": mi["bucket"]}
                    if mi["file"].endswith(".svg"):
                        img_rec["vector"] = f"src/{mi['file']}"
                    if colour > 0.12:
                        orig = fit(raw)
                        if orig is not None:
                            orig.save(os.path.join(out, f"{s['id']}.orig.png"), optimize=True)
                            img_rec["orig"] = f"{s['id']}.orig.png"
                    done = True
            except Exception as e:  # soft-fail → font fallback
                print("render fail", s["id"], e)
        if not done and s["id"] in DRAWN:
            dp = os.path.join(src, f"{s['id']}.drawn.svg")
            open(dp, "w").write(DRAWN[s["id"]])
            black = fit(to_ink(rasterise(dp))[0])
            black.save(os.path.join(out, f"{s['id']}.png"), optimize=True)
            img_rec = {"file": f"{s['id']}.png", "licence": "CC0 (schematic drawn for this library)", "author": "MELEK Hathor Studio",
                       "source": "integrations/symbol_library.py DRAWN", "via": "drawn", "bucket": "A", "vector": f"src/{s['id']}.drawn.svg"}
            done = True
        if not done and s.get("cp"):
            g, fname = render_cp(fidx, s["cp"])
            if g is not None:
                g.save(os.path.join(out, f"{s['id']}.png"), optimize=True)
                img_rec = {"file": f"{s['id']}.png", "licence": "SIL Open Font License 1.1", "author": "Google / Noto project",
                           "source": f"https://github.com/notofonts/notofonts.github.io ({fname})", "via": "unicode-font",
                           "bucket": "A", "unicode": f"U+{s['cp']:04X}"}
                done = True
        rec["image"] = img_rec
        cat.append(rec)
        print(("OK  " if done else "MISS"), s["id"], (img_rec or {}).get("via", ""), flush=True)
    notes = ("Religious & occult symbol library for Hathor Studio and the Hierophant. Each symbol has a 512px black-on-transparent PNG "
             "(<id>.png), a coloured original where meaningful (<id>.orig.png) and, for Commons SVGs, the source vector in src/. "
             "Images: Wikimedia Commons files kept ONLY if Public Domain / CC0 / CC BY / CC BY-SA (bucket A = PD/CC0, bucket B = "
             "attribution/share-alike required — credit `author` and link `source`), or Unicode characters rendered from Noto fonts "
             "(SIL OFL). `sources` are the Wikipedia articles the harvester fetched for that symbol. `figures` are ids in "
             "integrations/hierophant-entities.mjs, pantheon-map.mjs or divine-attributes.mjs. `status`: attested | disputed | modern — "
             "read `note` before presenting a modern or disputed symbol as ancient. Built by integrations/genai-symbol-harvest.mjs + "
             "integrations/symbol_library.py from integrations/symbol-library-spec.mjs.")
    json.dump({"notes": notes, "count": len(cat), "symbols": cat}, open(os.path.join(out, "catalog.json"), "w"), ensure_ascii=False, indent=1)
    sheet(cat, out)
    return cat


def sheet(cat, out, cell=150, cols=16):
    from PIL import Image, ImageDraw, ImageFont
    items = [c for c in cat if c["image"]]
    rows = (len(items) + cols - 1) // cols
    W, H = cols * cell, rows * cell
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    try:
        f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 11)
    except Exception:
        f = ImageFont.load_default()
    for i, c in enumerate(items):
        x, y = (i % cols) * cell, (i // cols) * cell
        t = Image.open(os.path.join(out, c["image"]["file"])).resize((cell - 40, cell - 40), Image.LANCZOS)
        img.paste(t, (x + 20, y + 4), t)
        tag = c["id"][:22] + {"unicode-font": "*", "drawn": "†"}.get(c["image"]["via"], "")
        d.text((x + 4, y + cell - 30), tag, font=f, fill=(0, 0, 0))
        if c["status"] != "attested":
            d.text((x + 4, y + cell - 16), c["status"], font=f, fill=(170, 40, 40))
    img.save(os.path.join(out, "sheet.jpg"), quality=82)


if __name__ == "__main__":
    if len(sys.argv) >= 5 and sys.argv[1] == "build":
        build(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        print(__doc__)
