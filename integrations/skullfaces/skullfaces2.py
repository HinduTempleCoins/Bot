"""skullfaces2.py — ROUND 2 of skulls → faces (round 1 stays up as tests; nothing here overwrites it).

Fixes from round 1:
  * conditioning is the skull's OUTER OUTLINE only (segmented silhouette), never hard edges of the bone — the nasal
    aperture, orbits, cracks and sutures were being turned into skin marks and anatomy;
  * the specimen's published sex / age / period drive the prompt; period hair, dress and adornment, never bare skin;
  * "all colours": ONE generated face is recoloured across the full range of skin tones (same face, every colour),
    and a second face varies hair and eye colour, so no single colour is presented as the answer;
  * an explainer card on the history of racial typology and what genetics shows.
Runs on the CPU worker (nice 10). Every generated face is written to review/ first; only faces approved into
approved.json are published (a human/AI looks at each one).

  face-venv/bin/python skullfaces2.py generate [keys...]   # base renders → remakes/<key>/_review/
  face-venv/bin/python skullfaces2.py publish  [keys...]   # approved faces → recolour rows → sheet + jsonl
  face-venv/bin/python skullfaces2.py card                 # explainer card
"""
import json, os, sys, time
import numpy as np
import cv2
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from skullfaces import sd, font, wrap, log  # noqa: E402

GEN = os.environ.get("MELEK_GEN_HOME", ".")
RENDERS = f"{GEN}/remakes"
EXTRA = f"{GEN}/remake_extra"
SRC1 = f"{EXTRA}/skulls_to_faces_16"
SETDIR = f"{EXTRA}/skulls_round2_20"
JSONL = f"{EXTRA}/skulls_round2_20.jsonl"
APPROVED = f"{GEN}/skullfaces2_approved.json"
SET = "skulls_round2"
W, H = 512, 640

NEG = ("nude, naked, nsfw, bare chest, cleavage, breasts, nipples, genitals, vulva, labia, penis, sexual, "
       "tattoo, face paint, cracks, veins, scars, wrinkles pattern, skull visible, bones, skeleton, gore, wounds, "
       "modern clothing, t-shirt, jewelry store, makeup, lipstick, eyeshadow, fashion model, glamour, "
       "cartoon, anime, drawing, painting, text, watermark, blurry, deformed, extra eyes, extra limbs")

SKIN_CAP = "Skin, hair and eye colour are not recorded in bone. Here is the same face in every colour."
SHEET_CAP = ("Round 2 · Alpha. The skull fixes the head's shape; the soft tissue, skin, hair and eyes are guesses. "
             "The top row is one face in every skin colour; the bottom row varies hair and eye colour too.")

# key, round-1 source, crop (x0,y0,x1,y1 fractions), view, title, when/where, sex/age as published, prompt, attire, aDNA note
SKULLS = [
    ("skull2_cheddar_man", "skull_cheddar_man.jpg", (0.02, 0.02, 0.98, 0.93), "front", "Cheddar Man — Mesolithic Briton",
     "c. 10,000 years ago · Gough's Cave, Cheddar Gorge, England", "adult man in his twenties",
     "a Mesolithic hunter-gatherer man of Britain, short dark curly hair, short beard", "a deerskin tunic and a fur cape",
     "aDNA prediction (Brace et al. 2019, Nature Ecology & Evolution): dark to black skin, blue or green eyes, dark curly hair — shown marked; the full range is shown too."),
    ("skull2_qafzeh_6", "skull_qafzeh_6.jpg", (0.02, 0.02, 0.98, 0.98), "front", "Qafzeh 6 — early Homo sapiens",
     "c. 100,000–90,000 years ago · Qafzeh cave, near Nazareth", "adult man",
     "an early modern human man of the Levant, strong brow, broad face, short curly hair", "a hide wrap over the shoulders and a shell bead necklace",
     "No ancient DNA survives for this individual."),
    ("skull2_shanidar", "skull_shanidar.jpg", (0.02, 0.02, 0.98, 0.98), "front", "Shanidar 1 — Neanderthal of the Zagros",
     "c. 60,000–45,000 years ago · Shanidar Cave, Iraqi Kurdistan", "older man (about 40–50)",
     "an older Neanderthal man, very heavy brow ridge, large wide nose, no chin, broad face, short beard", "a heavy fur cloak",
     "Neanderthal pigmentation varied: some carried an MC1R variant linked to pale skin and red hair (Lalueza-Fox et al. 2007, Science); others did not. Not known for this individual."),
    ("skull2_jebel_irhoud", "skull_jebel_irhoud.jpg", (0.02, 0.02, 0.98, 0.98), "front", "Jebel Irhoud 1 — early Homo sapiens",
     "c. 315,000 years ago (Hublin et al. 2017) · Jebel Irhoud, Morocco", "adult (sex not firmly determined; shown as a man)",
     "an early Homo sapiens adult man of North Africa, large face, heavy brow, short tightly curled hair", "a hide cape",
     "No ancient DNA survives for this individual."),
    ("skull2_jericho", "skull_jericho_plastered.jpg", (0.02, 0.02, 0.98, 0.98), "front", "The plastered skull of Jericho",
     "c. 9,000–8,000 years ago (Pre-Pottery Neolithic B) · Jericho", "adult man (British Museum CT study)",
     "a Neolithic Levantine farmer man, dark hair, short beard", "a woven linen tunic",
     "Levantine Neolithic genomes (Lazaridis et al. 2016, Nature) show local ancestry; pigmentation predictions for this individual are not published."),
    ("skull2_la_ferrassie", "skull_la_ferrassie.jpg", (0.02, 0.02, 0.98, 0.98), "profile-left", "La Ferrassie 1 — Neanderthal",
     "c. 45,000–43,000 years ago · La Ferrassie, Dordogne, France", "adult man (about 40–50)",
     "a Neanderthal man, long low skull, heavy brow ridge, large projecting nose, no chin, beard", "a fur cloak",
     "Neanderthal pigmentation varied (Lalueza-Fox et al. 2007); not known for this individual."),
    ("skull2_la_chapelle", "skull_la_chapelle.jpg", (0.0, 0.0, 1.0, 0.64), "profile-right", "La Chapelle-aux-Saints 1 — 'the Old Man'",
     "c. 60,000–47,000 years ago · La Chapelle-aux-Saints, Corrèze, France", "old man, many teeth lost in life",
     "an old Neanderthal man, long low skull, heavy brow ridge, large nose, sunken mouth from lost teeth, grey beard", "a fur cloak",
     "Neanderthal pigmentation varied (Lalueza-Fox et al. 2007); not known for this individual."),
    ("skull2_skhul_v", "skull_skhul_v.jpg", (0.0, 0.0, 1.0, 1.0), "profile-left", "Skhul V — early Homo sapiens of Mount Carmel",
     "c. 120,000–90,000 years ago · Es-Skhul cave, Mount Carmel", "adult man (about 30–40)",
     "an early modern human man, strong brow ridge, projecting face, short beard, curly hair", "a hide wrap and a shell necklace",
     "No ancient DNA survives for this individual."),
]
VIEW_TXT = {"front": "front view, looking at the camera", "profile-left": "side profile view facing left",
            "profile-right": "side profile view facing right"}

# base render: middle of the range, so recolouring goes both ways; alt render: different hair and eyes
BASE_COLOURS = "medium brown skin, dark brown hair, brown eyes"
ALT_COLOURS = {"skull2_cheddar_man": "medium brown skin, blue eyes, dark curly hair"}
ALT_DEFAULT = "medium brown skin, light brown wavy hair, green eyes"

# CIELAB (L*, a*, b*) skin targets, very dark → very light (after Chardon 1991 / Del Bino 2006 ITA ranges)
TONES = [("very dark", 27, 14, 20), ("dark", 35, 15, 23), ("medium dark", 45, 16, 25), ("medium", 55, 15, 24),
         ("light medium", 64, 13, 21), ("light", 72, 11, 18), ("very light", 80, 9, 14)]


def load_src(key):
    for k, f, crop, *_ in SKULLS:
        if k == key:
            im = Image.open(os.path.join(SRC1, f)).convert("RGB")
            x0, y0, x1, y1 = crop
            return im.crop((int(x0 * im.width), int(y0 * im.height), int(x1 * im.width), int(y1 * im.height)))
    raise KeyError(key)


def skull_mask(im):
    """Silhouette of the skull: GrabCut seeded by an inset rectangle; line drawings by threshold + fill."""
    a = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
    h, w = a.shape[:2]
    grey = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY)
    if (grey > 235).mean() > 0.5:  # line drawing on white
        m = (grey < 200).astype(np.uint8) * 255
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    else:
        mask = np.zeros((h, w), np.uint8)
        rect = (int(w * 0.04), int(h * 0.03), int(w * 0.92), int(h * 0.94))
        bg, fg = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
        cv2.grabCut(a, mask, rect, bg, fg, 6, cv2.GC_INIT_WITH_RECT)
        m = np.where((mask == 1) | (mask == 3), 255, 0).astype(np.uint8)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((21, 21), np.uint8))
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cs:
        return None
    c = max(cs, key=cv2.contourArea)
    filled = np.zeros_like(m)
    cv2.drawContours(filled, [c], -1, 255, -1)  # fill: holes (orbits, nose) vanish
    return filled


def outline_image(key):
    """The structure image: the skull's outer outline only, placed where the head sits in a portrait frame."""
    im = load_src(key)
    m = skull_mask(im)
    if m is None:
        return None, None
    ys, xs = np.where(m > 0)
    m = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    view = next(s[3] for s in SKULLS if s[0] == key)
    target_w = int(W * (0.50 if view == "front" else 0.62))
    k = target_w / m.shape[1]
    if m.shape[0] * k > H * 0.60:
        k = H * 0.60 / m.shape[0]
    m = cv2.resize(m, (max(1, int(m.shape[1] * k)), max(1, int(m.shape[0] * k))), interpolation=cv2.INTER_AREA)
    m = cv2.GaussianBlur(m, (9, 9), 0)
    m = (m > 127).astype(np.uint8) * 255
    canvas = np.zeros((H, W), np.uint8)
    x = (W - m.shape[1]) // 2
    y = int(H * 0.07)
    canvas[y:y + m.shape[0], x:x + m.shape[1]] = m
    cs, _ = cv2.findContours(canvas, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    line = np.zeros((H, W, 3), np.uint8)
    cv2.drawContours(line, cs, -1, (255, 255, 255), 4)
    return Image.fromarray(line), im


def gen(out, prompt, structure, seed, scale=0.55):
    if os.path.exists(out):
        return True
    import base64, io
    buf = io.BytesIO(); structure.save(buf, "PNG")
    body = {"prompt": prompt, "negativePrompt": NEG, "steps": 6, "seed": seed, "priority": "low", "size": f"{W}x{H}",
            "structure": {"base64": base64.b64encode(buf.getvalue()).decode()}, "structureScale": scale}
    t0 = time.time()
    try:
        png = sd(body)
    except Exception as e:
        log("  sd fail", out, type(e).__name__, e); return False
    if png:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        open(out, "wb").write(png)
        json.dump({"prompt": prompt, "negativePrompt": NEG, "structureScale": scale, "seed": seed}, open(out[:-4] + ".json", "w"))
    log("  render", os.path.relpath(out, RENDERS), "ok" if png else "error", int(time.time() - t0), "s")
    return bool(png)


def prompt_for(spec, colours):
    key, _f, _c, view, title, when, sexage, desc, attire, _n = spec
    return (f"photorealistic forensic facial reconstruction, museum quality, head and shoulders portrait of {desc}, "
            f"{sexage}, {colours}, wearing {attire}, {VIEW_TXT[view]}, natural skin texture, plain dark grey background, "
            f"soft studio light, 85mm photograph, ancient period appearance")


def generate(keys):
    specs = [sp for sp in SKULLS if not keys or sp[0] in keys]
    lines = {}
    for spec in specs:
        key = spec[0]
        line, src = outline_image(key)
        if line is None:
            log("no outline", key); continue
        rd = f"{RENDERS}/{key}/_review"
        os.makedirs(rd, exist_ok=True)
        line.save(f"{rd}/outline.png"); src.save(f"{rd}/src.jpg", quality=90)
        lines[key] = line
    # pass 1 gives every skull one base + one alt face; pass 2 adds a second seed of each (for choice)
    for n, (sb, sa) in enumerate(((501, 511), (502, 512)), 1):
        for spec in specs:
            key = spec[0]
            if key not in lines:
                continue
            rd = f"{RENDERS}/{key}/_review"
            gen(f"{rd}/base{n}.png", prompt_for(spec, BASE_COLOURS), lines[key], sb)
            gen(f"{rd}/alt{n}.png", prompt_for(spec, ALT_COLOURS.get(key, ALT_DEFAULT)), lines[key], sa)


# ── recolour: one face, every skin tone ──────────────────────────────────────────────────────────────────────────
_SEG = None


def skin_mask(rgb):
    """Skin pixels from MediaPipe's multiclass selfie segmenter (classes: 0 background, 1 hair, 2 body skin,
    3 face skin, 4 clothes, 5 other) — face + body skin only, eye whites excluded; feathered."""
    global _SEG
    import mediapipe as mp
    from mediapipe.tasks import python as mpt
    from mediapipe.tasks.python import vision
    if _SEG is None:
        _SEG = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
            base_options=mpt.BaseOptions(model_asset_path=f"{GEN}/models/selfie_multiclass_256x256.tflite"), output_category_mask=True))
    cat = _SEG.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))).category_mask.numpy_view()
    cat = cat.reshape(cat.shape[0], cat.shape[1])
    m = np.isin(cat, (2, 3))
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    chroma = np.hypot(lab[..., 1] - 128, lab[..., 2] - 128)
    m &= ~((chroma < 5) & (lab[..., 0] > 150))      # eye whites and pure speculars stay as they are
    if m.sum() < 800:
        return None
    m = cv2.morphologyEx(m.astype(np.uint8) * 255, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    return cv2.GaussianBlur(m, (0, 0), 2).astype(np.float32) / 255.0


def recolour(path, tone):
    rgb = np.array(Image.open(path).convert("RGB"))
    mask = skin_mask(rgb)
    if mask is None:
        return None
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    L = lab[..., 0] * 100 / 255; A = lab[..., 1] - 128; B = lab[..., 2] - 128
    sel = mask > 0.5
    # reference = the lit skin, not hair/beard/shadow that the segmenter lets in: upper half of the masked L values
    sel = sel & (L >= np.percentile(L[sel], 50))
    mL, mA, mB = np.median(L[sel]), np.median(A[sel]), np.median(B[sel])
    mask = mask * np.clip((L - (mL - 22)) / 10, 0, 1)   # beard, brows, lashes: much darker than skin -> left alone
    _, tL, tA, tB = tone
    k = min(1.0, 0.4 + 0.6 * tL / max(mL, 1))          # darker targets compress the shading; lighter keep it
    L2 = tL + (L - mL) * k
    L2 = np.where(L2 > 90, 90 + (L2 - 90) * 0.3, L2).clip(0, 100)   # soft ceiling: no blown highlights
    A2 = A - mA + tA; B2 = B - mB + tB
    out = np.stack([L2 * 255 / 100, A2 + 128, B2 + 128], -1).clip(0, 255).astype(np.uint8)
    rgb2 = cv2.cvtColor(out, cv2.COLOR_LAB2RGB).astype(np.float32)
    m = mask[..., None]
    return Image.fromarray((rgb2 * m + rgb.astype(np.float32) * (1 - m)).clip(0, 255).astype(np.uint8))


def row(face, tw, marked=None):
    tiles = []
    for t in TONES:
        im = recolour(face, t)
        if im is None:
            return None
        tiles.append((t[0], im.resize((tw, int(tw * H / W)))))
    return tiles


def sheet(key, faces):
    spec = next(s for s in SKULLS if s[0] == key)
    _k, _f, _c, _v, title, when, sexage, _d, _a, note = spec
    tw = 230
    rows = [r for r in (row(f, tw) for f in faces) if r]
    if not rows:
        return False
    th = rows[0][0][1].height
    src = Image.open(f"{RENDERS}/{key}/_review/src.jpg").convert("RGB")
    sh = 360
    src = src.resize((int(src.width * sh / src.height), sh))
    Wc = 12 + len(TONES) * (tw + 10)
    Hc = 150 + sh + 30 + len(rows) * (th + 40) + 170
    c = Image.new("RGB", (Wc, Hc), (18, 16, 22))
    d = ImageDraw.Draw(c)
    d.text((14, 12), f"{title} — one face, every colour", font=font(30), fill=(235, 205, 130))
    d.text((14, 54), f"{when} · {sexage}", font=font(18), fill=(215, 215, 220))
    y = 82
    for ln in wrap(d, note, font(16), Wc - 28)[:3]:
        d.text((14, y), ln, font=font(16), fill=(170, 200, 230)); y += 21
    y = 150
    c.paste(src, (12, y)); d.text((18, y + 4), "Source: the skull", font=font(16), fill=(255, 255, 255))
    y += sh + 30
    for r in rows:
        x = 12
        for name, im in r:
            c.paste(im, (x, y))
            d.text((x + 4, y + th + 4), name, font=font(15), fill=(230, 230, 235))
            x += tw + 10
        y += th + 40
    for ln in wrap(d, SKIN_CAP + " " + SHEET_CAP, font(19), Wc - 28):
        d.text((14, y), ln, font=font(19), fill=(240, 200, 120)); y += 25
    cred = open(os.path.join(SRC1, _f + ".credit")).read().strip() if os.path.exists(os.path.join(SRC1, _f + ".credit")) else ""
    for ln in wrap(d, "Skull image: " + cred, font(13), Wc - 28)[:3]:
        d.text((14, y), ln, font=font(13), fill=(160, 160, 170)); y += 17
    c = c.crop((0, 0, Wc, y + 10))
    c.save(f"{RENDERS}/{key}/1_real_sheet.png")
    return True


def publish(keys):
    appr = json.load(open(APPROVED)) if os.path.exists(APPROVED) else {}
    os.makedirs(SETDIR, exist_ok=True)
    recs = [json.loads(l) for l in open(JSONL)] if os.path.exists(JSONL) else []
    recs = [r for r in recs if r["key"] not in (keys or [s[0] for s in SKULLS]) or r["key"].endswith("explainer")]
    for spec in SKULLS:
        key = spec[0]
        if keys and key not in keys:
            continue
        faces = [f"{RENDERS}/{key}/_review/{n}.png" for n in appr.get(key, [])]
        faces = [f for f in faces if os.path.exists(f)]
        if not faces:
            continue
        for i, f in enumerate(faces, 1):
            Image.open(f).save(f"{RENDERS}/{key}/1_real_face{i}.png")
        if not sheet(key, faces):
            log("sheet failed", key); continue
        Image.open(f"{RENDERS}/{key}/_review/src.jpg").save(f"{SETDIR}/{key}.jpg", quality=90)
        _k, f1, *_ = spec
        cred = open(os.path.join(SRC1, f1 + ".credit")).read().strip() if os.path.exists(os.path.join(SRC1, f1 + ".credit")) else ""
        recs.append({"key": key, "set": SET, "title": f"{spec[4]} — one face, every colour (round 2)", "credit": f"{spec[5]} · skull image: {cred}",
                     "prerendered": True, "desc": spec[7]})
        log("published", key, len(faces), "faces")
    with open(JSONL, "w") as fh:
        for r in recs:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")


# ── explainer card ───────────────────────────────────────────────────────────────────────────────────────────────
CARD = [
    ("Where the old race categories came from", [
        "Johann Friedrich Blumenbach, 'On the Natural Variety of Mankind' (3rd ed. 1795), sorted people into five 'varieties' — Caucasian, Mongolian, Ethiopian, American, Malay — and named 'Caucasian' after a single skull from Georgia he thought the most beautiful. He himself stressed that the varieties grade into one another.",
        "Samuel George Morton, 'Crania Americana' (1839), filled skulls with seed and shot to rank 'races' by brain size. His collection became the core evidence for American scientific racism.",
        "Carleton Coon, 'The Origin of Races' (1962), argued for Caucasoid, Mongoloid, Congoid, Capoid and Australoid lines evolving separately. Genetics has since overturned that separate-evolution claim.",
        "Nineteenth-century writers also argued from skull and body shape that Iberian, 'Celtic' and African skulls were alike, while 'Anglo-Saxons' were taller and slimmer — John Beddoe's 'The Races of Britain' (1885), with its 'index of nigrescence', called some Irish and Welsh types 'Africanoid'. The ranking was used against the Irish, Spanish and others.",
        "Colonial states measured noses, heights and hair: Belgian authorities issued ethnic ID cards in Rwanda from 1933 using such criteria, and Dutch and Afrikaner race classification (culminating in apartheid's Population Registration Act, 1950) did the same in southern Africa.",
    ]),
    ("What the evidence shows", [
        "Every living human descends from populations in Africa; the oldest Homo sapiens fossils (Jebel Irhoud, c. 315,000 years ago) are African (Hublin et al. 2017, Nature).",
        "Skin colour is an adaptation to sunlight (UV and vitamin D), set by genes such as MC1R, SLC24A5 and SLC45A2. Light skin spread in Europe within roughly the last 8,000 years (Mathieson et al. 2015, Nature); Cheddar Man, 10,000 years ago in Britain, likely had dark skin (Brace et al. 2019).",
        "Neanderthals varied too — some carried an MC1R variant linked to pale skin and red hair (Lalueza-Fox et al. 2007, Science). Denisovan ancestry survives mainly in Asia and Oceania, including the EPAS1 high-altitude gene of Tibetans (Huerta-Sánchez et al. 2014, Nature).",
        "Most human genetic variation lies within any population, not between them (Lewontin 1972; Rosenberg et al. 2002, Science). Skull shape tracks climate, diet and ancestry gradually across the map; it does not divide people into a few separate 'races' (Relethford 2009; Hubbe et al. 2009).",
        "That is why every face on these sheets is shown in every colour: the bone does not tell us, and the history of pretending it did is part of the story.",
    ]),
]


def card():
    card_id = "skull2" + "_explainer"
    Wc = 1400
    c = Image.new("RGB", (Wc, 2400), (18, 16, 22))
    d = ImageDraw.Draw(c)
    d.text((24, 20), "Skulls, colour and 'race' — the history and the evidence", font=font(34), fill=(235, 205, 130))
    y = 80
    for head, paras in CARD:
        y += 10
        d.text((24, y), head, font=font(26), fill=(170, 200, 230)); y += 40
        for p in paras:
            for ln in wrap(d, p, font(19), Wc - 60):
                d.text((34, y), ln, font=font(19), fill=(225, 225, 230)); y += 26
            y += 10
    d.text((24, y + 8), "Round 2 · Alpha · Sources as cited.", font=font(16), fill=(160, 160, 170))
    c = c.crop((0, 0, Wc, y + 40))
    os.makedirs(f"{RENDERS}/{card_id}", exist_ok=True)
    c.save(f"{RENDERS}/{card_id}/1_real_sheet.png")
    recs = [json.loads(l) for l in open(JSONL)] if os.path.exists(JSONL) else []
    recs = [r for r in recs if r["key"] != card_id]
    recs.insert(0, {"key": card_id, "set": SET, "title": "Skulls, colour and 'race': the history and the evidence", "credit": "Text card · sources cited on the card",
                    "prerendered": True, "desc": "explainer"})
    with open(JSONL, "w") as fh:
        for r in recs:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    log("card written")


if __name__ == "__main__":
    cmd, keys = (sys.argv[1] if len(sys.argv) > 1 else "generate"), sys.argv[2:]
    {"generate": lambda: generate(keys), "publish": lambda: publish(keys), "card": card}[cmd]()
    log("done", cmd)
