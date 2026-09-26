"""genai_remakes_publish.py — build the Shilpa Shastra /remakes gallery bundle from the CPU worker's output.

  python genai_remakes_publish.py <renders_dir> <sources_dir...> --out <bundle_dir>

renders_dir: <scene>/<look>_<people>.png (what remake_batch writes). sources_dir(s): <scene>.<png|jpg>.
Writes <bundle_dir>/<scene>/{src.jpg, <look>_<people>.jpg} at web size + manifest.json (titles, groups, credits).
Only finished looks are listed, so publishing mid-batch is safe; re-run after each pass.
"""
import argparse, json, os, sys, time
from PIL import Image

# key -> (group, title, credit). Operator references are credited to the operator's research posts.
SCENES = {
    "44d39381_1057": ("Headcones & perfume", "Banquet ladies with wax perfume headcones", "Theban tomb painting (18th Dynasty) · operator reference"),
    "5db72396_599": ("Headcones & perfume", "A servant anoints a lady's headcone", "Theban tomb painting · operator reference"),
    "banquet_met_women_row": ("Headcones & perfume", "Guests at a banquet, smelling lotus", "Facsimile, Metropolitan Museum 30.4.105 (CC0)"),
    "banquet_met_anointing": ("Headcones & perfume", "Anointing at the banquet", "Facsimile, Metropolitan Museum 30.4.105 (CC0)"),
    "nebamun_banquet_guests": ("Headcones & perfume", "The banquet of Nebamun", "Tomb of Nebamun, British Museum (Wikimedia, CC BY-SA 4.0)"),
    "lotus_perfume_press_louvre": ("Headcones & perfume", "Women pressing lily perfume", "Relief, Louvre E 11162 (CC0)"),
    "875ab8b1_1467": ("Headcones & perfume", "Procession with headcones", "Egyptian tomb painting · operator reference"),
    "7e5c9055_1416": ("Headcones & perfume", "A couple adoring the sun", "Book of the Dead · operator reference"),
    "3567dfa5_435": ("Nubia", "The Nubian bathhouse", "Illustration · operator reference"),
    "baa23dd7_435": ("Nubia", "The god-king, the incense and the litter", "Illustration · operator reference"),
    "6fc00bec_357": ("Egypt", "Purification with water and soap", "Tomb painting · operator reference"),
    "2a96f01f_273": ("Egypt", "The weighing of the heart", "Papyrus of Hunefer, Book of the Dead · operator reference"),
    "2a96f01f_888": ("Egypt", "Before Osiris", "Papyrus of Hunefer, Book of the Dead · operator reference"),
    "8e4a00e9_571": ("Egypt", "Offering to Osiris", "Book of the Dead · operator reference"),
    "8e4a00e9_1259": ("Egypt", "Osiris, Anubis and Isis", "Book of the Dead · operator reference"),
    "7e5c9055_448": ("Egypt", "Prayer before the jackal shrine", "Book of the Dead · operator reference"),
    "stele_2a63dbc6": ("Egypt", "Stele of the sky goddess", "Painted wooden stele · operator reference"),
    "stele_a7accbc3": ("Egypt", "Offering stele under the winged sun", "Painted wooden stele · operator reference"),
    "stele_16dc0594": ("Egypt", "A woman offers lotus to Ra", "Painted wooden stele · operator reference"),
    "stele_3a6400b1": ("Egypt", "Libation before the falcon god", "Painted wooden stele · operator reference"),
    "stele_fc6a2fb7": ("Egypt", "Worship of Ra-Horakhty", "Painted wooden stele · operator reference"),
    "keftiu_cretans_gifts": ("Minoans", "Keftiu envoys bring gifts to Egypt", "Tomb of Rekhmire facsimile, Metropolitan Museum (CC0)"),
    "minoan_bull_leaping": ("Minoans", "Bull-leaping at Knossos", "Fresco, Heraklion Archaeological Museum (CC0)"),
    "minoan_ladies_blue": ("Minoans", "The Ladies in Blue", "Knossos fresco reproduction, Metropolitan Museum (CC0)"),
    "minoan_prince_lilies": ("Minoans", "The Prince of the Lilies", "Knossos fresco, Heraklion (Wikimedia, CC BY-SA 4.0)"),
    "minoan_saffron_gatherers": ("Minoans", "The saffron gatherers of Thera", "Akrotiri fresco (Wikimedia, CC BY-SA 4.0)"),
}
GROUP_ORDER = ["Headcones & perfume", "Minoans", "Nubia", "Egypt"]
PEOPLE_ORDER = ["egyptian", "minoan", "nubian", "libyan", "levantine", "pale"]
LOOKS = ["1_real", "2_half", "3_full"]


def web_jpg(src, dst, long_side=900):
    im = Image.open(src).convert("RGB")
    k = long_side / max(im.size)
    if k < 1:
        im = im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)
    im.save(dst, "JPEG", quality=84, optimize=True, progressive=True)


def build(renders, sources, out):
    os.makedirs(out, exist_ok=True)
    srcmap = {}
    for d in sources:
        for f in os.listdir(d):
            k, ext = os.path.splitext(f)
            if ext.lower() in (".png", ".jpg", ".jpeg"):
                srcmap[k] = os.path.join(d, f)
    scenes = []
    for key in sorted(os.listdir(renders)):
        sd = os.path.join(renders, key)
        if not os.path.isdir(sd) or key not in SCENES:
            continue
        group, title, credit = SCENES[key]
        od = os.path.join(out, key); os.makedirs(od, exist_ok=True)
        looks = {}
        for f in sorted(os.listdir(sd)):
            if not f.endswith(".png") or "nomelt" in f:
                continue
            look = f[:6]; who = f[7:-4]
            if look not in LOOKS or who not in PEOPLE_ORDER:
                continue
            jpg = f"{look}_{who}.jpg"
            dst = os.path.join(od, jpg)
            if not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(os.path.join(sd, f)):
                web_jpg(os.path.join(sd, f), dst)
            looks.setdefault(look, {})[who] = jpg
        for lk in looks:
            looks[lk] = {p: looks[lk][p] for p in PEOPLE_ORDER if p in looks[lk]}
        source = None
        if key in srcmap:
            web_jpg(srcmap[key], os.path.join(od, "src.jpg"), 900); source = "src.jpg"
        scenes.append({"key": key, "group": group, "title": title, "credit": credit, "source": source, "looks": looks})
    scenes.sort(key=lambda s: (GROUP_ORDER.index(s["group"]) if s["group"] in GROUP_ORDER else 99, s["title"]))
    with open(os.path.join(out, "manifest.json"), "w") as fh:
        json.dump({"updated": int(time.time()), "scenes": scenes}, fh, indent=1)
    return len(scenes), sum(len(v) for s in scenes for v in s["looks"].values())


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("renders"); ap.add_argument("sources", nargs="+"); ap.add_argument("--out", required=True)
    a = ap.parse_args()
    n, imgs = build(a.renders, a.sources, a.out)
    print(f"{n} scenes, {imgs} images -> {a.out}")
