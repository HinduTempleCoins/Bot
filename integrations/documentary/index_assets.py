"""index_assets.py — every PART we have, indexed for the documentary shot planner (reuse first).

  python index_assets.py --root /opt/melek-gen --out assets.json

Entries: { id, type, path, text, people, era, licence, credit, alpha?: bool (has transparency → can be composited) }
  remake      — /opt/melek-gen/remakes/<scene>/<look>_<people>.png (titles/groups/credits from the published manifest)
  character   — library/characters_sais/* (posed; .annot.json keypoints → puppet motion)
  object      — library/egypt_royal_military, objects, lotus
  landscape   — library/landscapes
  clip        — anims/<id>/clip.mp4 (Hathor's test animations; recipe.json titles)
  still       — horror/*.png
  map         — maps/index.json (fork L's animated historical maps; CC BY credit travels with the clip)
Glyphs (29 scripts) and the Sacred Symbols live on the web host; the planner links them by id for cards.
"""
import argparse, glob, json, os, re

# What an asset DEPICTS (not when it was made): a 19th-century history painting of Dido is an ancient scene; a
# 19th-century view of Cairo, a Nile genre painting or an 1890s ethnographic photo is a MODERN scene — minarets,
# rifles, steamships — and must never appear in a film about antiquity.
MODERN_SOURCE = re.compile(r"David Roberts|Louis Haghe|Bridgman|Goodall|Sargent|Veillon|L[ée]on Belly|Maurand|Foureau|Edwardes|"
                           r"Geiser|Neurdein|Boussuge|Tapir[oó]|Barrow, 18|Melbye|Durand-Brager|Hoefnagel|Torriani|Berthelot|"
                           r"A\. Mayer|Le Monde illustr", re.I)
ANCIENT_SUBJECT = re.compile(r"mummy|dido|aeneas|hannibal|salammb|cleopatra|pharaoh|latona|apollo|hercules|herakles|carthag.*(decline|build)", re.I)
ANACHRONISM = re.compile(r"\b(minarets?|mosques?|cathedrals?|churche?s?|crescent|rifles?|muskets?|pistols?|cannons?|steam(ship|boat)s?|railways?|"
                         r"telegraph|dahabieh|pasha|ottoman|mamluk|bazaars?)\b", re.I)
REGION_OF_GROUP = {"The Nile": "nile", "Egypt": "nile", "Nubia": "nile", "Headcones & perfume": "nile", "Lotus perfume": "nile",
                   "Visitors & the Four Peoples": "nile", "Nefertiti": "nile", "Cleopatra": "nile", "Fayum portraits": "nile",
                   "Egyptian gods & myth": "nile", "Minoans": "aegean", "Greece & Scheria": "aegean", "Hyperborea & Delos": "aegean",
                   "Sais, Athens & Delphi": "aegean", "Greek myth on pottery": "aegean", "Carthage & the Phoenicians": "levant-punic",
                   "The Amazigh": "maghreb-sahara", "Hindu myth: paintings & temple cloths": "india"}


REGION_OF_PREFIX = [("sais_", "nile"), ("lateperiod_", "nile"), ("sahure_", "nile"), ("libyans_tiles", "nile"),
                    ("libyan_chief", "nile"), ("libyan_applique", "nile"), ("vanquished_libyan", "nile"), ("apadana_", "persia"),
                    ("carthage_", "levant-punic"), ("tyre_", "levant-punic"), ("sidon_", "levant-punic"), ("acre_", "levant-punic"),
                    ("jaffa_", "levant-punic"), ("hannibal", "levant-punic"), ("cadiz_", "iberia-atlantic"), ("strait_", "iberia-atlantic"),
                    ("canaries_", "iberia-atlantic"), ("mogador_", "maghreb-sahara"), ("sabratha_", "maghreb-sahara"),
                    ("alexandria_", "nile"), ("nile_", "nile"), ("egypt_", "nile"), ("cleo_", "nile"), ("nef_", "nile"),
                    ("greek_", "aegean"), ("delphi_", "aegean"), ("athens_", "aegean"), ("delos_", "aegean"), ("minoan_", "aegean"),
                    ("hindu_", "india")]


def region_of(key, group):
    for pre, r in REGION_OF_PREFIX:
        if key.startswith(pre):
            return r
    return REGION_OF_GROUP.get(group, "")


def depicts(title, credit, key):
    t = f"{title} {words(key)}"
    if ANACHRONISM.search(t) or ANACHRONISM.search(credit or ""):
        return "modern"
    if MODERN_SOURCE.search(credit or "") and not ANCIENT_SUBJECT.search(t):
        return "modern"
    return "ancient"


def words(s):
    return re.sub(r"[_\-]+", " ", s)

def load_json(p, default=None):
    try:
        return json.load(open(p))
    except Exception:
        return default

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/opt/melek-gen")
    ap.add_argument("--out", default="assets.json")
    a = ap.parse_args()
    R = a.root
    out = []
    # titles/groups/credits: every manifest copy (newest wins) + the scene files the batches read
    meta = {}
    for mf in sorted(glob.glob(f"{R}/remakes_bundle*/manifest.json"), key=lambda f: os.path.getmtime(f)):
        for sc in (load_json(mf, {}) or {}).get("scenes", []):
            meta[sc["key"]] = sc
    for jf in glob.glob(f"{R}/remake_extra/*.jsonl"):
        for line in open(jf):
            try:
                r = json.loads(line)
            except Exception:
                continue
            meta.setdefault(r.get("key", ""), {"key": r.get("key"), "title": r.get("title", ""), "credit": r.get("credit", ""), "group": ""})
    for d in sorted(glob.glob(f"{R}/remakes/*/")):
        key = os.path.basename(d.rstrip("/"))
        m = meta.get(key, {})
        for f in sorted(glob.glob(f"{d}*.png")):
            b = os.path.basename(f)
            mm = re.match(r"(\d_[a-z]+)_([a-z]+)\.png$", b)
            if not mm or b.endswith(".pose.png"):
                continue
            out.append({"id": f"remake:{key}:{mm.group(1)}:{mm.group(2)}", "type": "remake", "path": f,
                        "depicts": depicts(m.get("title", ""), m.get("credit", ""), key), "group": m.get("group", ""),
                        "region": region_of(key, m.get("group", "")),
                        "text": f"{m.get('title', words(key))} {m.get('group', '')} {m.get('credit', '')} {words(key)} {mm.group(1).split('_')[1]}",
                        "people": mm.group(2), "look": mm.group(1), "licence": "Hathor Studio remake", "credit": m.get("credit", "")})
    for sub, typ in (("characters_sais", "character"), ("egypt_royal_military", "object"), ("objects", "object"),
                     ("lotus", "object"), ("landscapes", "landscape"), ("grown", None)):  # grown: typed by its own json
        for f in sorted(glob.glob(f"{R}/library/{sub}/*.png")):
            if f.endswith(".pose.png"):
                continue
            j = load_json(f[:-4] + ".json", {}) or {}
            typ_f = typ or (j.get("kind") if j.get("kind") in ("character", "object", "landscape") else "object")
            name = j.get("name") or j.get("title") or words(os.path.splitext(os.path.basename(f))[0])
            tags = " ".join(str(x) for x in (j.get("tags") or [])) + " " + str(j.get("era", "")) + " " + str(j.get("desc", j.get("description", "")))[:200]
            people = next((p for p in ("nubian", "egyptian", "libyan", "levantine", "pale", "greek", "punic") if p in f), "")
            out.append({"id": f"{typ_f}:{sub}:{os.path.basename(f)[:-4]}", "type": typ_f, "path": f, "text": f"{name} {tags} {words(sub)}",
                        "people": people, "licence": "Hathor Studio render", "credit": "",
                        "posed": os.path.exists(f[:-4] + ".annot.json")})
    for rf in sorted(glob.glob(f"{R}/anims/*/recipe.json")):
        r = load_json(rf, {}) or {}
        clip = os.path.join(os.path.dirname(rf), "clip.mp4")
        if os.path.exists(clip):
            sm = meta.get(r.get("scene", ""), {})
            out.append({"id": f"clip:{r.get('id')}", "type": "clip", "path": clip, "seconds": r.get("seconds", 6),
                        "depicts": depicts(sm.get("title", r.get("title", "")), sm.get("credit", ""), r.get("scene", "")),
                        "group": sm.get("group", r.get("group", "")), "region": region_of(r.get("scene", ""), sm.get("group", r.get("group", ""))),
                        "text": f"{r.get('title', '')} {r.get('group', '')} {r.get('puppet_title', '')} {r.get('kind', '')}",
                        "people": r.get("people", ""), "licence": "Hathor Studio animation", "credit": ""})
    for f in sorted(glob.glob(f"{R}/horror/*.png")):
        out.append({"id": f"still:{os.path.basename(f)[:-4]}", "type": "still", "path": f, "text": words(os.path.basename(f)[:-4]),
                    "people": "", "licence": "Hathor Studio render", "credit": ""})
    mi = load_json(f"{R}/maps/index.json", None)
    for m in (mi or {}).get("clips", mi if isinstance(mi, list) else []) or []:
        p = m.get("file", "")
        p = p if os.path.isabs(p) else f"{R}/maps/{p}"
        if os.path.exists(p):
            out.append({"id": f"map:{m.get('id')}", "type": "map", "path": p, "seconds": m.get("duration", 10),
                        "text": f"map {m.get('title', '')} {m.get('region', '')} {' '.join(m.get('polities', []))} {' '.join(m.get('tags', []))}",
                        "fromYear": m.get("fromYear"), "toYear": m.get("toYear"), "people": "",
                        "licence": m.get("licence", "CC BY 4.0"), "credit": m.get("credit", "Cliopatria (CC BY 4.0); Natural Earth")})
    json.dump(out, open(a.out, "w"))
    from collections import Counter
    print(len(out), "assets", dict(Counter(x["type"] for x in out)))

if __name__ == "__main__":
    main()
