"""glyph_library.py — real ancient scripts as OBJECTS for Hathor Studio: every letter/sign of each script rendered from
its Unicode font (Noto, SIL Open Font License) as its own transparent PNG, with a catalog. Image models invent fake
letters; the Studio uses these instead (and `inscription()` sets real text in a script).

  python glyph_library.py build <fonts_dir> <out_dir>          # all scripts → <out>/<script>/<cp>.png + catalog.json
  python glyph_library.py text <fonts_dir> <script> "text" out.png

Scripts not in Unicode (Phrygian, Proto-Sinaitic / Proto-Canaanite) are NOT here — they need drawn sign tables.
"""
import json, os, sys, unicodedata

# id: (font file stem, [(start, end)...], display name, group, note)
SCRIPTS = {
    "phoenician": ("NotoSansPhoenician", [(0x10900, 0x1091F)], "Phoenician (also Paleo-Hebrew)", "Semitic & Canaanite",
                   "The Phoenician alphabet; the same letters were used to write early (Paleo-)Hebrew, Moabite and Aramaic."),
    "ugaritic": ("NotoSansUgaritic", [(0x10380, 0x1039F)], "Ugaritic", "Semitic & Canaanite", "Cuneiform alphabet of Ugarit."),
    "aramaic": ("NotoSansImperialAramaic", [(0x10840, 0x1085F)], "Imperial Aramaic", "Semitic & Canaanite", ""),
    "samaritan": ("NotoSansSamaritan", [(0x0800, 0x083F)], "Samaritan", "Semitic & Canaanite", "Descends from Paleo-Hebrew."),
    "nabataean": ("NotoSansNabataean", [(0x10880, 0x108AF)], "Nabataean", "Semitic & Canaanite", ""),
    "palmyrene": ("NotoSansPalmyrene", [(0x10860, 0x1087F)], "Palmyrene", "Semitic & Canaanite", ""),
    "old_south_arabian": ("NotoSansOldSouthArabian", [(0x10A60, 0x10A7F)], "Old South Arabian (Sabaean)", "Semitic & Canaanite", ""),
    "old_north_arabian": ("NotoSansOldNorthArabian", [(0x10A80, 0x10A9F)], "Old North Arabian", "Semitic & Canaanite", ""),
    "cuneiform": ("NotoSansCuneiform", [(0x12000, 0x123FF), (0x12400, 0x1247F), (0x12480, 0x1254F)], "Cuneiform (Sumerian, Akkadian, Hittite)",
                  "Mesopotamia & Anatolia", "Unicode cuneiform signs as used for Sumerian, Akkadian and Hittite."),
    "anatolian_hieroglyphs": ("NotoSansAnatolianHieroglyphs", [(0x14400, 0x1467F)], "Anatolian (Luwian) hieroglyphs", "Mesopotamia & Anatolia", ""),
    "carian": ("NotoSansCarian", [(0x102A0, 0x102DF)], "Carian", "Mesopotamia & Anatolia", ""),
    "lycian": ("NotoSansLycian", [(0x10280, 0x1029F)], "Lycian", "Mesopotamia & Anatolia", ""),
    "lydian": ("NotoSansLydian", [(0x10920, 0x1093F)], "Lydian", "Mesopotamia & Anatolia", ""),
    "egyptian_hieroglyphs": ("NotoSansEgyptianHieroglyphs", [(0x13000, 0x1342F)], "Egyptian hieroglyphs", "Egypt, Kush & North Africa", ""),
    "meroitic": ("NotoSansMeroitic", [(0x10980, 0x1099F), (0x109A0, 0x109FF)], "Meroitic (Kush) — hieroglyphic and cursive", "Egypt, Kush & North Africa", ""),
    "tifinagh": ("NotoSansTifinagh", [(0x2D30, 0x2D7F)], "Tifinagh (Amazigh)", "Egypt, Kush & North Africa",
                 "Unicode Tifinagh, largely Neo-Tifinagh forms; related to the ancient Libyco-Berber script."),
    "runic": ("NotoSansRunic", [(0x16A0, 0x16FF)], "Runes (Elder & Younger Futhark, Anglo-Saxon Futhorc)", "Indo-European carved scripts", ""),
    "ogham": ("NotoSansOgham", [(0x1680, 0x169F)], "Ogham (Old Irish)", "Indo-European carved scripts", ""),
    "gothic": ("NotoSansGothic", [(0x10330, 0x1034F)], "Gothic", "Indo-European carved scripts", ""),
    "old_italic": ("NotoSansOldItalic", [(0x10300, 0x1032F)], "Old Italic (Etruscan, Oscan, Umbrian…)", "Indo-European carved scripts", ""),
    "linear_b": ("NotoSansLinearB", [(0x10000, 0x100FF)], "Linear B (Mycenaean Greek)", "Indo-European carved scripts", ""),
    "cypriot": ("NotoSansCypriot", [(0x10800, 0x1083F)], "Cypriot syllabary", "Indo-European carved scripts", ""),
    "old_persian": ("NotoSansOldPersian", [(0x103A0, 0x103DF)], "Old Persian cuneiform", "Indo-European carved scripts", ""),
    "avestan": ("NotoSansAvestan", [(0x10B00, 0x10B3F)], "Avestan", "Indo-European carved scripts", ""),
    "pahlavi": ("NotoSansInscriptionalPahlavi", [(0x10B60, 0x10B7F)], "Inscriptional Pahlavi", "Indo-European carved scripts", ""),
    "parthian": ("NotoSansInscriptionalParthian", [(0x10B40, 0x10B5F)], "Inscriptional Parthian", "Indo-European carved scripts", ""),
    "brahmi": ("NotoSansBrahmi", [(0x11000, 0x1107F)], "Brahmi (Ashoka's edicts)", "Indo-European carved scripts", ""),
    "kharoshthi": ("NotoSansKharoshthi", [(0x10A00, 0x10A5F)], "Kharosthi", "Indo-European carved scripts", ""),
    "old_turkic": ("NotoSansOldTurkic", [(0x10C00, 0x10C4F)], "Old Turkic (Orkhon runes)", "Steppe", "Carved stelae of the Orkhon valley."),
}


def font_path(fonts_dir, script):
    return os.path.join(fonts_dir, SCRIPTS[script][0] + "-Regular.ttf")


def cmap(path):
    from fontTools.ttLib import TTFont
    return set(TTFont(path).getBestCmap().keys())


def render_glyph(font, ch, px=512, pad=0.12):
    """One glyph, black on transparent, centred and scaled to fill px x px with padding."""
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (px * 2, px * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.text((px // 2, px // 2), ch, font=font, fill=(0, 0, 0, 255))
    box = img.getbbox()
    if not box:
        return None
    g = img.crop(box)
    s = (px * (1 - 2 * pad)) / max(g.size)
    g = g.resize((max(1, int(g.width * s)), max(1, int(g.height * s))), Image.LANCZOS)
    out = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    out.paste(g, ((px - g.width) // 2, (px - g.height) // 2), g)
    return out


def build(fonts_dir, out_dir, only=None):
    from PIL import ImageFont
    index = []
    for sid, (stem, ranges, name, group, note) in SCRIPTS.items():
        if only and sid not in only:
            continue
        fp = font_path(fonts_dir, sid)
        if not os.path.exists(fp):
            print(f"skip {sid}: no font"); continue
        have = cmap(fp)
        font = ImageFont.truetype(fp, 400)
        sd = os.path.join(out_dir, sid); os.makedirs(sd, exist_ok=True)
        glyphs = []
        for a, b in ranges:
            for cp in range(a, b + 1):
                if cp not in have:
                    continue
                ch = chr(cp)
                uname = unicodedata.name(ch, f"U+{cp:04X}")
                if unicodedata.category(ch) in ("Cc", "Cf", "Zs", "Mn") and "SIGN" not in uname:
                    continue
                img = render_glyph(font, ch)
                if img is None:
                    continue
                fn = f"{cp:05X}.png"
                img.save(os.path.join(sd, fn), optimize=True)
                glyphs.append({"cp": f"U+{cp:04X}", "char": ch, "name": uname, "file": f"{sid}/{fn}"})
        cat = {"id": sid, "name": name, "group": group, "note": note, "font": stem + " (SIL Open Font License)", "count": len(glyphs), "glyphs": glyphs}
        json.dump(cat, open(os.path.join(sd, "catalog.json"), "w"), ensure_ascii=False, indent=0)
        index.append({k: cat[k] for k in ("id", "name", "group", "note", "font", "count")})
        print(f"{sid}: {len(glyphs)} glyphs", flush=True)
    json.dump({"scripts": index}, open(os.path.join(out_dir, "index.json"), "w"), ensure_ascii=False, indent=1)
    return index


def inscription(fonts_dir, script, text, out, px=160, color=(0, 0, 0, 255)):
    """Set real text in an ancient script (for carving/painting into a scene). Right-to-left scripts are reversed."""
    from PIL import Image, ImageDraw, ImageFont
    rtl = script in ("phoenician", "aramaic", "samaritan", "nabataean", "palmyrene", "old_south_arabian", "old_north_arabian",
                     "kharoshthi", "avestan", "pahlavi", "parthian", "old_turkic", "lydian", "meroitic")
    font = ImageFont.truetype(font_path(fonts_dir, script), px)
    s = text[::-1] if rtl else text
    tmp = Image.new("RGBA", (px * (len(s) + 2), px * 3), (0, 0, 0, 0))
    ImageDraw.Draw(tmp).text((px, px), s, font=font, fill=color)
    box = tmp.getbbox()
    (tmp.crop(box) if box else tmp).save(out)
    return out


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "build":
        build(sys.argv[2], sys.argv[3], set(sys.argv[4:]) or None)
    elif len(sys.argv) >= 6 and sys.argv[1] == "text":
        print(inscription(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]))
    else:
        print(__doc__)
