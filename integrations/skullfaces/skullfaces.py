"""skullfaces.py — ancient skulls → several possible faces; skeletons → several possible bodies; height-scaled lineups;
plus the Neolithic / Bronze Age / Judges-Kings-Chronicles remake sources. Runs on the CPU worker (nice 10), soft-fail per item.
Sources: Wikimedia Commons, open licences only (PD / CC0 / CC BY / CC BY-SA); licence + artist recorded in the credit."""
import base64, io, json, os, re, sys, time, urllib.parse, urllib.request
from PIL import Image, ImageDraw, ImageFont

GEN = os.environ.get("MELEK_GEN_HOME", ".")
TOK_FILE = os.environ.get("CPU_SD_ENV", "cpu-sd.env")  # private env file holding CPU_SD_TOKEN (set on the worker)
TOK = [l.split("=", 1)[1].strip() for l in open(TOK_FILE) if l.startswith("CPU_SD_TOKEN=")][0]
RENDERS = f"{GEN}/remakes"
EXTRA = f"{GEN}/remake_extra"
UA = {"User-Agent": "MELEK-Hathor-remakes/1.0 (research; contact via soapbox.community)"}
OK_LIC = re.compile(r"^(public domain|pd|cc0|cc by(-sa)? [0-9.]+( [a-z]+)?|no restrictions|cc by-sa [0-9.]+ fr)", re.I)
BAD_LIC = re.compile(r"\bnc\b|\bnd\b|non-?commercial|no ?deriv", re.I)
SKULL_CAP = "Several possible faces — the skull fixes the bone structure; skin, hair, eyes and expression are guesses. Alpha."
BODY_CAP = "Bodies reconstructed from the fossils; skin, hair and features are guesses — several shown on purpose. Alpha."
NEG = "cartoon, anime, drawing, illustration, painting, text, watermark, blurry, deformed, extra limbs, extra heads, skull visible, bones, skeleton, gore"


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def http_json(u):
    for a in range(8):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40) as r:
                return json.loads(r.read())
        except Exception as e:
            log("  retry", a, type(e).__name__); time.sleep(15 * (a + 1))
    return None


def commons_find(query, prefer=""):
    """→ (image_url, credit, file_title) for the best open-licence match, or None."""
    params = {"action": "query", "format": "json", "prop": "imageinfo", "iiprop": "url|size|extmetadata", "iiurlwidth": 1400}
    if prefer:
        params["titles"] = "File:" + prefer
    else:
        params.update({"generator": "search", "gsrsearch": "filetype:bitmap " + query, "gsrnamespace": 6, "gsrlimit": 12})
    j = http_json("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params))
    time.sleep(4)
    pages = sorted(((j or {}).get("query", {}).get("pages", {}) or {}).values(), key=lambda p: p.get("index", 0))
    for p in pages:
        ii = (p.get("imageinfo") or [{}])[0]
        m = ii.get("extmetadata", {})
        lic = re.sub("<[^>]+>", "", m.get("LicenseShortName", {}).get("value", ""))
        if not lic or BAD_LIC.search(lic) or not OK_LIC.search(lic.strip()):
            continue
        if min(ii.get("width", 0), ii.get("height", 0)) < 500:
            continue
        artist = re.sub("<[^>]+>", "", m.get("Artist", {}).get("value", "")).strip()[:80]
        title = p["title"][5:]
        return ii.get("thumburl") or ii["url"], f"{title} · {artist + ' · ' if artist else ''}{lic} · Wikimedia Commons", title
    if prefer:
        return commons_find(query)
    return None


def fetch_src(setdir, key, query, prefer=""):
    os.makedirs(setdir, exist_ok=True)
    dst = os.path.join(setdir, key + ".jpg")
    meta = dst + ".credit"
    if os.path.exists(dst) and os.path.exists(meta):
        return dst, open(meta).read()
    f = commons_find(query, prefer)
    if not f:
        log("NO SOURCE", key, query); return None, ""
    url, credit, title = f
    for a in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                Image.open(io.BytesIO(r.read())).convert("RGB").save(dst, "JPEG", quality=92)
            break
        except Exception as e:
            log("  dl retry", key, type(e).__name__); time.sleep(15 * (a + 1))
    else:
        return None, ""
    open(meta, "w").write(credit + f" · https://commons.wikimedia.org/wiki/File:{urllib.parse.quote(title.replace(' ', '_'))}")
    time.sleep(3)
    return dst, open(meta).read()


def sd(body):
    def call(method, path, b=None):
        req = urllib.request.Request(f"http://127.0.0.1:8510{path}", method=method, data=json.dumps(b).encode() if b else None,
                                     headers={"authorization": f"Bearer {TOK}", "content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    jid = call("POST", "/jobs", body)["id"]
    while True:
        time.sleep(5)
        st = call("GET", f"/jobs/{jid}")
        if st["status"] in ("done", "error"):
            res = st.get("result") or {}
            return base64.b64decode(res["base64"]) if res.get("ok") else None


def render(out, prompt, src=None, scale=0.45, seed=1, size=None):
    if os.path.exists(out):
        return True
    os.makedirs(os.path.dirname(out), exist_ok=True)
    body = {"prompt": prompt, "negativePrompt": NEG, "steps": 6, "seed": seed, "priority": "low"}
    if src:
        body["structure"] = {"base64": base64.b64encode(open(src, "rb").read()).decode()}
        body["structureScale"] = scale
    if size:
        body["size"] = size
    t0 = time.time()
    try:
        png = sd(body)
    except Exception as e:
        log("  sd fail", out, type(e).__name__, e); return False
    if png:
        open(out, "wb").write(png)
        json.dump({"prompt": prompt, "structureScale": scale, "seed": seed}, open(out[:-4] + ".json", "w"))
    log("  render", os.path.relpath(out, RENDERS), "ok" if png else "error", int(time.time() - t0), "s")
    return bool(png)


def font(n):
    for f in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, n)
    return ImageFont.load_default()


def wrap(d, text, f, w):
    lines, cur = [], ""
    for word in text.split():
        t = (cur + " " + word).strip()
        if d.textlength(t, font=f) > w and cur:
            lines.append(cur); cur = word
        else:
            cur = t
    return lines + ([cur] if cur else [])


def sheet(out, src, variants, title, lines, caption, credit):
    tiles = [Image.open(p).convert("RGB") for p in ([src] if src else []) + variants if p and os.path.exists(p)]
    if len(tiles) < 2:
        return False
    H = 420
    tiles = [t.resize((int(t.width * H / t.height), H)) for t in tiles]
    W = max(sum(t.width for t in tiles) + 12 * (len(tiles) + 1), 1200)
    canvas = Image.new("RGB", (W, H + 260), (18, 16, 22))
    d = ImageDraw.Draw(canvas)
    d.text((14, 12), title, font=font(30), fill=(235, 205, 130))
    y = 52
    for ln in lines:
        d.text((14, y), ln, font=font(18), fill=(215, 215, 220)); y += 24
    x = 12
    for i, t in enumerate(tiles):
        canvas.paste(t, (x, 120))
        lab = ("Source" if (src and i == 0) else f"Possible {i if src else i + 1}")
        d.text((x + 6, 124), lab, font=font(16), fill=(255, 255, 255))
        x += t.width + 12
    y = 120 + H + 12
    for ln in wrap(d, caption, font(20), W - 28):
        d.text((14, y), ln, font=font(20), fill=(240, 200, 120)); y += 26
    for ln in wrap(d, "Source image: " + credit, font(14), W - 28)[:4]:
        d.text((14, y), ln, font=font(14), fill=(160, 160, 170)); y += 18
    canvas = canvas.crop((0, 0, W, min(canvas.height, y + 10)))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    canvas.save(out)
    return True


# ── skulls ───────────────────────────────────────────────────────────────────────────────────────────────────────────
SKULLS = [
    # key, query, prefer title, title, date/place, face prompt base, variant descriptors
    ("skull_jebel_irhoud", "Jebel Irhoud skull", "Jebel Irhoud-1 NMNH.jpg", "Jebel Irhoud 1 — early Homo sapiens", "c. 300,000 years ago (dated 280–350 ka) · Jebel Irhoud, Morocco",
     "photorealistic forensic facial reconstruction portrait of an early Homo sapiens adult man, broad face, heavy brow, front view, museum studio lighting",
     ["dark brown skin, short tightly curled black hair", "deep brown skin, shaved head, scar on cheek", "medium brown skin, black locks tied back", "dark skin, grey-flecked short hair, older man", "brown skin, short hair, young man, faint ochre on forehead"]),
    ("skull_skhul_v", "Skhul 5 skull", "Skhül skull-5.png", "Skhul V — early Homo sapiens of the Levant", "c. 120,000–90,000 years ago · Es-Skhul cave, Mount Carmel",
     "photorealistic forensic facial reconstruction portrait of an early modern human man of the Levant, strong brow ridge, front view, studio light",
     ["brown skin, curly black beard", "olive-brown skin, long dark hair", "dark brown skin, short hair", "light brown skin, braided hair, shell bead necklace", "brown skin, older, weathered face"]),
    ("skull_qafzeh_6", "Qafzeh 6 skull", "Qafzeh 6 cast.jpg", "Qafzeh 6 — early Homo sapiens", "c. 100,000–90,000 years ago · Qafzeh cave, near Nazareth",
     "photorealistic forensic facial reconstruction portrait of an early modern human adult, front view, studio light",
     ["dark brown skin, short curly hair", "brown skin, long braids, ochre on cheeks", "olive-brown skin, beard", "deep brown skin, shaved head", "medium brown skin, woven headband"]),
    ("skull_la_ferrassie", "La Ferrassie 1 skull", "Ferrassie skull.jpg", "La Ferrassie 1 — Neanderthal", "c. 70,000–50,000 years ago · La Ferrassie, Dordogne, France",
     "photorealistic forensic facial reconstruction portrait of a Neanderthal man, large nose, strong brow ridge, no chin, wide face, front three-quarter view, studio light",
     ["pale skin, red hair and beard, freckles", "light olive skin, dark brown hair", "fair skin, blond messy hair", "tanned skin, black hair, older man", "pale skin, auburn beard, fur collar"]),
    ("skull_la_chapelle", "La Chapelle-aux-Saints skull", "Skull of La Chapelle-aux-saints Man (Mousterian) Wellcome M0015765.jpg", "La Chapelle-aux-Saints 1 — 'the Old Man', Neanderthal",
     "c. 60,000–50,000 years ago · La Chapelle-aux-Saints, Corrèze, France",
     "photorealistic forensic facial reconstruction portrait of an old Neanderthal man with few teeth, heavy brow, big nose, front view, studio light",
     ["pale weathered skin, grey beard", "light brown skin, white hair", "ruddy skin, balding, grey stubble", "tanned skin, long grey hair", "fair skin, reddish grey beard, fur cloak"]),
    ("skull_shanidar", "Shanidar skull Neanderthal", "Shanidar skull.jpg", "Shanidar — Neanderthals of the Zagros", "c. 75,000–45,000 years ago · Shanidar Cave, Iraqi Kurdistan (Shanidar Z found 2018)",
     "photorealistic forensic facial reconstruction portrait of a Neanderthal adult of the Zagros mountains, heavy brow, big nose, front view, studio light",
     ["olive skin, dark hair, woman", "light brown skin, black beard, man", "tanned skin, dark braids, woman in her forties", "pale olive skin, reddish-brown hair", "brown skin, grey hair, older man"]),
    ("skull_cheddar_man", "Cheddar Man skull", "Cheddar man skull.jpg", "Cheddar Man — Mesolithic Briton", "c. 10,000 years ago (Mesolithic) · Gough's Cave, Cheddar Gorge, England",
     "photorealistic forensic facial reconstruction portrait of a Mesolithic hunter-gatherer man, front view, studio light",
     ["dark skin, blue eyes, dark curly hair (as the 2018 genome study suggests)", "dark brown skin, pale blue eyes, short beard", "medium-dark skin, blue eyes, long dark hair", "dark skin, blue-green eyes, curly hair tied back", "olive-brown skin, grey eyes, stubble"]),
    ("skull_jericho_plastered", "Plastered skull from Jericho British Museum", "Plastered skull from Jericho, British Museum.jpg", "The plastered skull of Jericho", "c. 9,000–8,000 years ago (Pre-Pottery Neolithic B) · Jericho",
     "photorealistic forensic facial reconstruction portrait of a Neolithic Levantine man, front view, studio light",
     ["olive skin, dark hair, short beard", "brown skin, black curly hair", "light olive skin, shaved head", "tanned skin, long dark hair tied back", "brown skin, grey hair, older"]),
    ("skull_ain_ghazal", "Plastered face modeled on a human skull Ain Ghazal", "", "The plastered skull of 'Ain Ghazal", "c. 9,000 years ago (Pre-Pottery Neolithic B) · 'Ain Ghazal, Jordan",
     "photorealistic forensic facial reconstruction portrait of a Neolithic Levantine adult, front view, studio light",
     ["olive skin, dark hair, woman", "brown skin, black beard, man", "light brown skin, braided hair, woman", "tanned skin, shaved head, man", "olive skin, grey hair, older woman"]),
    ("skull_natufian", "Human skeleton Rockefeller Museum Natufian", "Human skeleton (Rockefeller Museum).jpg", "A Natufian of the Levant", "c. 15,000–11,500 years ago (Natufian) · southern Levant",
     "photorealistic forensic facial reconstruction portrait of a Natufian forager, front view, studio light",
     ["brown skin, dark curly hair, dentalium shell headdress", "olive-brown skin, beard", "dark brown skin, braids", "light brown skin, shaved head", "brown skin, older woman, grey braids"]),
    ("skull_egyptian_mummy", "Egyptian mummy skull museum", "", "An ancient Egyptian skull", "Dynastic Egypt (dates vary by specimen) · Nile Valley",
     "photorealistic forensic facial reconstruction portrait of an ancient Egyptian adult, front view, studio light",
     ["brown skin, short black wig, kohl eyeliner", "dark brown skin, shaved head, priest", "light brown skin, braided wig, woman", "deep brown skin, gold earrings", "medium brown skin, older man"]),
    ("skull_mycenaean", "Mycenaean skull Grave Circle", "", "A Mycenaean of the grave circles", "c. 1600–1500 BC · Mycenae, Greece (Grave Circle; the 'Mask of Agamemnon' context)",
     "photorealistic forensic facial reconstruction portrait of a Bronze Age Mycenaean Greek man, front view, studio light",
     ["olive skin, long dark hair, beard", "tanned skin, dark curls, clean-shaven", "light olive skin, brown hair, bronze diadem", "olive-brown skin, black beard, older", "fair olive skin, auburn hair"]),
]

# ── skeletons / species ─────────────────────────────────────────────────────────────────────────────────────────────
# key, query, prefer, name, height range (cm lo, hi), dates, body prompt, variants, lineup height (cm)
SPECIES = [
    ("body_afarensis", "Lucy skeleton afarensis", "Lucy blackbg.jpg", "Australopithecus afarensis ('Lucy', AL 288-1)", (105, 151), "c. 3.9–2.9 million years ago · Hadar, Ethiopia",
     "photorealistic full body reconstruction of an Australopithecus afarensis female, small ape-like upright hominin, long arms, body hair, standing on savanna, museum diorama lighting",
     ["dark hair all over, dark skin", "reddish-brown hair, grey face skin", "black short fur, walking pose", "brown fur, carrying a stick"], 110),
    ("body_paranthropus", "Paranthropus boisei skull", "", "Paranthropus boisei", (124, 137), "c. 2.3–1.2 million years ago · East Africa (Olduvai, Koobi Fora)",
     "photorealistic full body reconstruction of Paranthropus boisei, robust upright hominin with a sagittal crest and huge jaws, body hair, standing in grassland",
     ["black fur, dark skin", "brown fur, chewing tubers", "dark hair, male", "reddish hair, female"], 130),
    ("body_erectus", "Turkana Boy at the American Museum of Natural History", "Turkana Boy at the American Museum of Natural History.jpg", "Homo erectus ('Turkana Boy', KNM-WT 15000)", (145, 185),
     "c. 1.5 million years ago (the boy); species c. 1.9 million–110,000 years ago · Nariokotome, Kenya",
     "photorealistic full body reconstruction of a Homo erectus adolescent, tall slender human body, low forehead, heavy brow, standing by a lake",
     ["dark skin, short curly hair, naked", "deep brown skin, holding a hand axe", "dark skin, short hair, animal skin wrap", "brown skin, walking pose"], 165),
    ("body_heidelbergensis", "Sima de los Huesos skull 5", "", "Homo heidelbergensis / Sima de los Huesos people", (157, 175), "c. 430,000 years ago (Sima de los Huesos) · Atapuerca, Spain",
     "photorealistic full body reconstruction of a Middle Pleistocene archaic human (Homo heidelbergensis), heavy brow, muscular, standing in a cave mouth",
     ["light brown skin, dark hair, fur cape", "olive skin, reddish beard", "dark skin, long hair, wooden spear", "pale skin, brown hair, woman"], 166),
    ("body_neanderthal", "Kebara 2 skeleton replica", "Kebara 2 skeleton replica.jpg", "Neanderthal (Kebara 2 / La Ferrassie 1)", (150, 175), "c. 430,000–40,000 years ago · Europe, Near East, Central Asia",
     "photorealistic full body reconstruction of a Neanderthal adult, short barrel chest, muscular, heavy brow, big nose, standing in an ice age landscape",
     ["pale skin, red hair, fur clothing", "olive skin, dark hair, hide cloak", "tanned skin, blond hair, holding a spear", "light brown skin, dark hair, woman with child"], 165),
    ("body_denisovan", "Xiahe mandible Denisovan", "", "Denisovan (speculative)", (160, 175), "c. 285,000–30,000 years ago (and later?) · Denisova Cave (Altai), Baishiya Karst (Tibet), Cobra Cave (Laos)",
     "photorealistic speculative full body reconstruction of a Denisovan archaic human, robust, large teeth, wide jaw, heavy brow, standing on the Tibetan plateau",
     ["dark skin, dark hair, fur clothes", "brown skin, black hair, yak-hide cloak", "dark brown skin, curly hair", "olive-brown skin, long hair, woman"], 165),
    ("body_naledi", "Homo naledi skeletal specimens", "Homo naledi skeletal specimens (cropped).jpg", "Homo naledi (Rising Star)", (137, 150), "c. 335,000–236,000 years ago · Rising Star cave system, South Africa",
     "photorealistic full body reconstruction of Homo naledi, small-brained slender hominin, curved fingers, standing in a cave passage",
     ["dark skin, short dark hair", "deep brown skin, body hair", "dark skin, woman", "brown skin, climbing pose"], 144),
    ("body_floresiensis", "Homo floresiensis LB1 skeleton", "", "Homo floresiensis ('the Hobbit', LB1)", (100, 110), "c. 100,000–50,000 years ago (bones); tools to c. 50,000 · Liang Bua, Flores, Indonesia",
     "photorealistic full body reconstruction of Homo floresiensis, very small archaic human, large feet, standing in tropical forest",
     ["brown skin, dark curly hair", "dark skin, long hair, woman", "brown skin, holding a stone tool", "olive-brown skin, body hair"], 106),
    ("body_sapiens_early", "Jebel Irhoud skull", "Jebel Irhoud 1-Homo Sapiens.jpg", "Early Homo sapiens (Jebel Irhoud / Skhul)", (160, 185), "c. 300,000–90,000 years ago · Morocco, the Levant",
     "photorealistic full body reconstruction of an early Homo sapiens adult, tall lean body, heavy brow, standing in North African steppe",
     ["dark skin, curly hair, hide wrap", "deep brown skin, ochre on body", "brown skin, braids, woman", "dark skin, carrying a spear"], 172),
]
LUZON_NOTE = "Homo luzonensis (Callao Cave, Luzon; c. 67,000–50,000 years ago): known from teeth, finger and toe bones and part of a femur — too little to reconstruct a body; not shown."
MODERN = ("Modern human", (150, 185), 170)


def do_skulls():
    setdir = f"{EXTRA}/skulls_to_faces_16"
    recs = []
    for key, q, pref, title, when, base, vars_ in SKULLS:
        src, credit = fetch_src(setdir, key, q, pref)
        if not src:
            continue
        recs.append({"key": key, "set": "skulls_to_faces", "title": f"{title} — several possible faces", "credit": f"{when} · skull image: {credit}",
                     "prerendered": True, "desc": base})
        write_jsonl(f"{EXTRA}/skulls_to_faces_16.jsonl", recs)
        outs = []
        for i, v in enumerate(vars_, 1):
            o = f"{RENDERS}/{key}/1_real_face{i}.png"
            if render(o, f"{base}, {v}, realistic skin texture, 85mm photograph, neutral grey background", src, 0.45, seed=100 + i):
                outs.append(o)
        sheet(f"{RENDERS}/{key}/1_real_sheet.png", src, outs, title, [when], SKULL_CAP, credit)


def do_bodies():
    setdir = f"{EXTRA}/hominins_full_body_16"
    recs, chosen = [], {}
    for key, q, pref, name, (lo, hi), when, base, vars_, _h in SPECIES:
        src, credit = fetch_src(setdir, key, q, pref)
        spec = key == "body_denisovan"
        note = " No Denisovan skeleton is known: this is a speculative guess from the jaw, teeth and genome." if spec else ""
        cap = f"{name} · height about {lo}–{hi} cm · {when}.{note}"
        recs.append({"key": key, "set": "hominins_full_body", "title": f"{name} — several possible bodies", "credit": f"{cap} · image: {credit or 'none'}",
                     "prerendered": True, "desc": base})
        write_jsonl(f"{EXTRA}/hominins_full_body_16.jsonl", recs)
        outs = []
        for i, v in enumerate(vars_, 1):
            o = f"{RENDERS}/{key}/1_real_body{i}.png"
            # Denisovan: the jaw image is not a body, so no structure — text only, portrait size
            ok = render(o, f"{base}, {v}, full body visible head to feet, realistic, 50mm photograph", None if spec or not src else src,
                        0.35, seed=200 + i, size="512x768" if (spec or not src) else None)
            if ok:
                outs.append(o)
        if outs:
            chosen[key] = outs
        sheet(f"{RENDERS}/{key}/1_real_sheet.png", src, outs, name, [f"Height about {lo}–{hi} cm · {when}" + note], BODY_CAP, credit or "none (speculative)")
    # modern human reference bodies for the lineups
    mouts = []
    for i, v in enumerate(["dark skin, short hair, man", "olive skin, long dark hair, woman", "pale skin, brown hair, man"], 1):
        o = f"{RENDERS}/lineup_hominins/ref_modern{i}.png"
        if render(o, f"photorealistic full body photograph of a modern human adult standing, plain simple clothing, {v}, full body visible head to feet, neutral grey background", None, seed=300 + i, size="512x768"):
            mouts.append(o)
    return chosen, mouts


def cut_figure(p):
    im = Image.open(p).convert("RGB")
    return im


def lineup(out, members, title, subtitle):
    """members: [(label, image_path, height_cm, range_text)] — panels scaled to height on one ground line."""
    members = [m for m in members if m[1] and os.path.exists(m[1])]
    if len(members) < 2:
        return False
    px_per_cm = 3.2
    ground = 120 + int(190 * px_per_cm)
    panels = []
    for lab, p, h, rng in members:
        im = Image.open(p).convert("RGB")
        ph = int(h * px_per_cm)
        pw = int(im.width * ph / im.height)
        panels.append((lab, im.resize((pw, ph)), h, rng))
    W = sum(pn[1].width for pn in panels) + 20 * (len(panels) + 1)
    canvas = Image.new("RGB", (max(W, 1100), ground + 190), (20, 18, 24))
    d = ImageDraw.Draw(canvas)
    d.text((16, 12), title, font=font(30), fill=(235, 205, 130))
    d.text((16, 52), subtitle, font=font(17), fill=(210, 210, 215))
    for cm in range(0, 200, 50):  # height grid
        y = ground - int(cm * px_per_cm)
        d.line([(0, y), (canvas.width, y)], fill=(55, 52, 62), width=1)
        d.text((4, y - 16), f"{cm} cm", font=font(13), fill=(130, 130, 140))
    x = 20
    for lab, im, h, rng in panels:
        canvas.paste(im, (x, ground - im.height))
        yy = ground + 8
        for ln in wrap(d, lab, font(15), im.width + 10)[:3]:
            d.text((x, yy), ln, font=font(15), fill=(240, 240, 240)); yy += 19
        for ln in wrap(d, rng, font(13), im.width + 10)[:4]:
            d.text((x, yy), ln, font=font(13), fill=(170, 170, 180)); yy += 16
        x += im.width + 20
    d.line([(0, ground), (canvas.width, ground)], fill=(200, 170, 110), width=2)
    y = canvas.height - 44
    for ln in wrap(d, BODY_CAP + " Heights and dates are ranges from the fossil record.", font(16), canvas.width - 30)[:2]:
        d.text((16, y), ln, font=font(16), fill=(240, 200, 120)); y += 20
    os.makedirs(os.path.dirname(out), exist_ok=True)
    canvas.save(out)
    log("  lineup", out)
    return True


def do_lineups(chosen, mouts):
    info = {k: (n, lo, hi, when, h) for k, _q, _p, n, (lo, hi), when, _b, _v, h in SPECIES}
    def m(k, i=0):
        n, lo, hi, when, h = info[k]
        outs = chosen.get(k) or []
        return (n, outs[i % len(outs)] if outs else None, h, f"{lo}–{hi} cm · {when.split(' · ')[0]}")
    modern = lambda i=0: (MODERN[0], mouts[i % len(mouts)] if mouts else None, MODERN[2], "150–185 cm · today")
    order = ["body_afarensis", "body_paranthropus", "body_floresiensis", "body_naledi", "body_erectus", "body_heidelbergensis", "body_neanderthal", "body_denisovan", "body_sapiens_early"]
    d = f"{RENDERS}/lineup_hominins"
    lineup(f"{d}/1_real_lineup1.png", [m(k) for k in order] + [modern()], "Human species at height scale", "From Lucy to us, on one ground line. " + LUZON_NOTE)
    lineup(f"{d}/1_real_lineup2.png", [m("body_neanderthal", 1), m("body_denisovan", 1), m("body_sapiens_early", 1), modern(1)], "Neanderthal, Denisovan and Homo sapiens",
           "The three who met and interbred, c. 60,000–40,000 years ago. The Denisovan body is a speculative guess (no skeleton known).")
    lineup(f"{d}/1_real_lineup3.png", [m("body_floresiensis", 1), m("body_naledi", 1), modern(2)], "The little ones: H. floresiensis and H. naledi beside a modern human",
           "Flores 'Hobbit' about 1 m; naledi about 1.4 m; a modern adult about 1.7 m.")
    lineup(f"{d}/1_real_lineup4.png", [m(k, 2) for k in order] + [modern(2)], "Human species at height scale — a second set of guesses",
           "Same fossils, different guesses for skin and hair: several shown on purpose.")
    write_jsonl(f"{EXTRA}/hominins_full_body_16.jsonl", None, extra={"key": "lineup_hominins", "set": "hominins_full_body", "title": "Human species side by side, at height scale",
                "credit": "Composited from our renders; heights and dates are ranges from the fossil literature. " + LUZON_NOTE, "prerendered": True, "desc": "lineup"})


def write_jsonl(path, recs, extra=None):
    cur = []
    if os.path.exists(path):
        cur = [json.loads(l) for l in open(path) if l.strip()]
    by = {r["key"]: r for r in cur}
    for r in (recs or []) + ([extra] if extra else []):
        by[r["key"]] = r
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        for r in by.values():
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


# ── Neolithic / Bronze Age / Judges, Kings, Chronicles — sources for remake_batch (it renders them) ─────────────────────
SCENES = [
    ("neo_catalhoyuk_rooftops", "Catalhoyuk reconstruction houses", "Neolithic Çatalhöyük: the town of rooftops", "neolithic Çatalhöyük, {P} villagers climbing ladders between flat mudbrick rooftops, smoke from ovens, plastered walls, the plain beyond", "levantine"),
    ("neo_catalhoyuk_interior", "Catalhoyuk house interior replica", "Inside a Çatalhöyük house", "inside a Neolithic Çatalhöyük house, a {P} family by the oven, plastered bull horns on the wall, painted red panels, platforms and baskets", "levantine"),
    ("neo_gobekli_feast", "Gobekli Tepe enclosure", "Feasting at Göbekli Tepe", "at Göbekli Tepe, {P} hunter-gatherers feasting and carving the great T-shaped stone pillars with animal reliefs, fires, stone vessels", "levantine"),
    ("neo_skara_brae", "Skara Brae house", "Skara Brae, Orkney", "Neolithic Skara Brae on Orkney, a {P} family inside a stone house with stone dressers and box beds, a hearth, fur and hide", "pale"),
    ("neo_stonehenge_builders", "Stonehenge", "Raising the stones at Stonehenge", "Neolithic Britain, {P} people hauling and raising great sarsen stones with ropes and timber at Stonehenge, crowds and fires", "pale"),
    ("neo_newgrange", "Newgrange entrance stone", "Newgrange at the winter solstice", "Neolithic Ireland, {P} people gathered before the white quartz front and carved spiral entrance stone of Newgrange at winter dawn", "pale"),
    ("neo_jiahu_flute", "Jiahu bone flute", "The bone flutes of Jiahu", "Neolithic China, a {P} musician playing a bone flute beside a village of round houses and rice fields, the oldest playable instruments", "depicted"),
    ("neo_ain_ghazal_statues", "Ain Ghazal statues", "The statues of 'Ain Ghazal", "Neolithic 'Ain Ghazal, {P} villagers shaping tall plaster statues with painted eyes over reed frames, a workshop in a village", "levantine"),
    ("neo_jericho_tower", "Tower of Jericho", "The Neolithic tower of Jericho", "Neolithic Jericho, {P} builders raising the great round stone tower and wall, palm trees, the spring", "levantine"),
    ("neo_tassili_herders", "Tassili n'Ajjer cattle painting", "Herders of the green Sahara", "the green Sahara, {P} herders driving painted cattle past rock shelters, lakes and grass", "nubian"),
    ("neo_varna_gold", "Varna necropolis gold", "The gold of Varna", "Copper Age Varna, a {P} chieftain laid out with gold ornaments, a gold sceptre and copper axes, mourners around the grave", "pale"),
    ("neo_longhouse", "Linear Pottery longhouse reconstruction", "A Neolithic longhouse", "a Neolithic longhouse of the first European farmers, {P} farmers with cattle, timber posts, thatched roof, fields of emmer wheat", "pale"),
    ("bronze_uluburun", "Uluburun shipwreck replica", "The Uluburun ship", "a Late Bronze Age merchant ship like the Uluburun wreck, {P} sailors loading copper oxhide ingots, tin, glass and amphorae at a harbour", "levantine"),
    ("bronze_knossos", "Knossos north entrance", "The palace of Knossos", "the palace of Knossos, {P} Minoans walking through red columns and frescoed porticoes, crowds on the stairs", "minoan"),
    ("bronze_hattusa_lion_gate", "Hattusa Lion Gate", "The Lion Gate of Hattusa", "Hittite Hattusa, {P} Hittite soldiers and chariots passing through the Lion Gate in the great stone walls", "levantine"),
    ("bronze_mycenae_lion_gate", "Lion Gate Mycenae", "The Lion Gate of Mycenae", "Bronze Age Mycenae, {P} Mycenaean warriors with boar's-tusk helmets and tower shields at the Lion Gate", "greek"),
    ("bronze_ugarit", "Ugarit royal palace", "The palace of Ugarit", "Late Bronze Age Ugarit, {P} Canaanite scribes writing on clay tablets in a courtyard of the royal palace", "levantine"),
    ("bronze_sea_peoples", "Medinet Habu Sea Peoples relief", "The Sea Peoples", "the battle against the Sea Peoples from the Medinet Habu reliefs, ships locked together, {P} warriors in feathered helmets", "egyptian"),
    ("bible_deborah_palm", "Deborah Dore", "Deborah under the palm", "Deborah the judge seated under a palm tree, a {P} woman giving judgement to the people of Israel, Barak standing before her", "levantine"),
    ("bible_gideon_trumpets", "Gideon Dore", "Gideon's trumpets and jars", "Gideon's three hundred {P} men at night blowing rams' horn trumpets and smashing jars to reveal torches, the Midianite camp in panic", "levantine"),
    ("bible_samson_dagon", "Samson destroys the temple Dore", "Samson at the temple of Dagon", "Samson, a long-haired {P} man, pushing apart the pillars of the temple of Dagon, the roof collapsing on the Philistines", "levantine"),
    ("bible_david_harp_saul", "David playing the harp before Saul", "David plays the harp before Saul", "the young {P} shepherd David playing a lyre before brooding King Saul on his throne, a spear in Saul's hand", "levantine"),
    ("bible_solomon_dedication", "Dedication of the Temple Tissot", "Solomon dedicates the Temple", "King Solomon dedicating the Temple in Jerusalem, {P} priests with 120 trumpets, singers with harps and cymbals, the cloud filling the house (2 Chronicles 5)", "levantine"),
    ("bible_lachish_siege", "Lachish relief British Museum", "The siege of Lachish (the Assyrian reliefs)", "the Assyrian siege of Lachish, {P} Judahite defenders on the walls, siege ramps and battering rams, captives led away", "depicted"),
    ("bible_ark_philistines", "Ark of the Covenant Philistines Dore", "The Ark among the Philistines", "the Ark of the Covenant carried among the {P} Philistines, the statue of Dagon fallen before it", "levantine"),
    ("bible_ruth_boaz", "Ruth and Boaz painting", "Ruth in the field of Boaz", "Ruth, a {P} woman, gleaning barley in the field of Boaz at harvest, reapers with sickles", "levantine"),
    ("bible_elijah_carmel", "Elijah Mount Carmel Dore", "Elijah on Mount Carmel", "Elijah on Mount Carmel, fire falling from heaven on the altar, the {P} prophets of Baal and the people watching", "levantine"),
    ("bible_queen_sheba", "Queen of Sheba visits Solomon painting", "The Queen of Sheba visits Solomon", "the {P} Queen of Sheba arriving at the court of King Solomon with camels, gold and spices", "nubian"),
    ("bible_jehoshaphat_singers", "Jehoshaphat Dore", "Jehoshaphat sends the singers before the army", "Jehoshaphat's army led by {P} Levite singers praising God (2 Chronicles 20), the enemy armies in the valley below", "levantine"),
    ("bible_hezekiah_tunnel", "Hezekiah's Tunnel", "Hezekiah's tunnel", "{P} workmen digging Hezekiah's tunnel through the rock under Jerusalem by lamplight, two teams meeting", "levantine"),
]


def do_scenes():
    setdir = f"{EXTRA}/neolithic_bronze_bible_17"
    recs = []
    for key, q, title, desc, first in SCENES:
        src, credit = fetch_src(setdir, key, q)
        if not src:
            continue
        r = {"key": key, "set": "neolithic_bronze_bible", "title": title, "credit": credit, "desc": desc, "first": first}
        if first == "depicted":
            r["peoples"] = ["depicted"]
        recs.append(r)
        write_jsonl(f"{EXTRA}/neolithic_bronze_bible_17.jsonl", [r])
    return [r["key"] for r in recs]


if __name__ == "__main__":
    what = sys.argv[1:] or ["scenes", "skulls", "bodies"]
    keys = []
    if "scenes" in what:
        keys = do_scenes()          # sources first (quick), so remake_batch can start on them
        log("scene sources:", len(keys))
    if "skulls" in what:
        do_skulls()
    if "bodies" in what:
        chosen, mouts = do_bodies()
        do_lineups(chosen, mouts)
    if keys and "render-scenes" in what:
        os.system(f"cd {GEN} && face-venv/bin/python remake_batch.py {' '.join(keys)}")
    log("done")
