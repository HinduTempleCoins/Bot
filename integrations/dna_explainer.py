"""dna_explainer.py — the DNA & genetics explainer series: vector animation + a neutral narrator on its own track.

No on-screen host (Hathor will host later). Every segment is animated geometry — a rotating double helix, base
pairs, the helix unzipping and copying, a gene read into RNA three letters at a time, the mother-line and
father-line of inheritance — drawn in numpy/OpenCV at 2× and downsampled. Captions carry the claim and its source.

The narration is a free local TTS voice (Piper) written to voice.wav beside the video, so Hathor's voice can replace
it later without re-rendering; clip.mp4 is the muxed preview, captions.srt the subtitles.

  python dna_explainer.py ep1 <outdir> [--voice en_US-lessac-medium.onnx]
  python dna_explainer.py list
"""
import argparse, json, math, os, subprocess, sys, wave

import cv2
import numpy as np

W, H, FPS, SS = 960, 540, 24, 2
FONT = os.environ.get("FLASH_FONT", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
BG = (40, 22, 16)
BASE = {"A": (80, 200, 90), "T": (60, 80, 230), "G": (40, 200, 240), "C": (220, 120, 60), "U": (200, 80, 200)}
PAIR = {"A": "T", "T": "A", "G": "C", "C": "G"}
SEQ = "ATGGCCTTAGCATCGGATACGTTAGCCGATGCATTCGA"


def P(x, y):
    return int(round(x * SS)), int(round(y * SS))


def canvas():
    img = np.zeros((H * SS, W * SS, 3), np.uint8)
    img[:] = BG
    for k in range(60):  # a faint starfield — the "Ancient Aliens" dark
        x, y = (k * 7919) % (W * SS), (k * 104729) % (H * SS)
        cv2.circle(img, (x, y), 1 + k % 2, (90, 70, 60), -1, cv2.LINE_AA)
    return img


def text(img_small, s, y, size=28, col=(245, 230, 190), x=None):
    from PIL import Image, ImageDraw, ImageFont
    im = Image.fromarray(cv2.cvtColor(img_small, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONT, size)
    lines = wrap(d, s, f, W - 80)
    for i, ln in enumerate(lines):
        tw = d.textlength(ln, font=f)
        d.text(((W - tw) / 2 if x is None else x, y + i * (size + 8)), ln, font=f, fill=col[::-1], stroke_width=2, stroke_fill=(0, 0, 0))
    return cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)


def wrap(d, s, f, maxw):
    out, cur = [], ""
    for w in s.split():
        t = (cur + " " + w).strip()
        if d.textlength(t, font=f) > maxw and cur:
            out.append(cur); cur = w
        else:
            cur = t
    return out + ([cur] if cur else [])


def down(img):
    return cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)


def ease(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


# ── segments: each is (narration, caption, source, frame-function(t, dur) -> BGR W×H) ──────────────────
def seg_title(t, dur, title, sub):
    img = canvas()
    k = ease(t / 1.2)
    helix(img, t, cx=W / 2, cy=H / 2 + 40, length=700, radius=60, alpha=0.35 * k, rungs=True)
    f = down(img)
    f = text(f, title, 180, 44)
    return text(f, sub, 250, 22, (200, 200, 200))


def helix(img, t, cx, cy, length, radius, alpha=1.0, rungs=True, turns=3.0, spin=0.9, unzip=None, seq=SEQ, straight=0.0):
    """draw a rotating double helix centred at (cx, cy) horizontally. unzip: x fraction (0..1) left of which the
    strands have separated; straight: 0..1 blend toward a flat ladder."""
    over = img.copy()
    n = len(seq)
    xs = np.linspace(cx - length / 2, cx + length / 2, 220)
    ph = 2 * math.pi * turns * (xs - xs[0]) / length + spin * t
    amp = radius * (1 - straight)
    sep = lambda x: 0.0
    if unzip is not None:
        ux = cx - length / 2 + length * unzip
        sep = lambda x: max(0.0, (ux - x) / 60.0)
    for strand, off, col in ((0, 0.0, (230, 200, 150)), (1, math.pi, (150, 190, 240))):
        pts, depth = [], []
        for x, p in zip(xs, ph):
            y = cy + amp * math.sin(p + off) + (-1 if strand == 0 else 1) * (radius * straight + min(1.0, sep(x)) * 90)
            pts.append(P(x, y)); depth.append(math.cos(p + off))
        for i in range(len(pts) - 1):
            shade = 0.55 + 0.45 * (depth[i] if straight < 0.5 else 1)
            c = tuple(int(v * shade) for v in col)
            cv2.line(over, pts[i], pts[i + 1], c, int(7 * SS), cv2.LINE_AA)
    if rungs:
        for j in range(n):
            x = cx - length / 2 + (j + 0.5) * length / n
            p = 2 * math.pi * turns * (x - (cx - length / 2)) / length + spin * t
            y1 = cy + amp * math.sin(p) - radius * straight
            y2 = cy + amp * math.sin(p + math.pi) + radius * straight
            s = min(1.0, sep(x))
            y1 -= s * 90; y2 += s * 90
            b = seq[j % n]
            mid = (y1 + y2) / 2
            gap = s * 60
            cv2.line(over, P(x, y1), P(x, mid - gap / 2 - 2), BASE[b], int(5 * SS), cv2.LINE_AA)
            cv2.line(over, P(x, mid + gap / 2 + 2), P(x, y2), BASE[PAIR[b]], int(5 * SS), cv2.LINE_AA)
    cv2.addWeighted(over, alpha, img, 1 - alpha, 0, img)


def seg_helix(t, dur):
    img = canvas()
    helix(img, t, W / 2, H / 2 - 20, 820, 90)
    return down(img)


def seg_bases(t, dur):
    img = canvas()
    k = ease(t / 3.0)
    L = 760
    helix(img, t * (1 - k), W / 2, H / 2 - 20, L, 90, straight=k, turns=3 * (1 - k) + 0.001)
    f = down(img)
    if k > 0.95:  # letters on the flat ladder
        from PIL import Image, ImageDraw, ImageFont
        im = Image.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
        d = ImageDraw.Draw(im)
        fo = ImageFont.truetype(FONT, 15)
        n = len(SEQ)
        for j, b in enumerate(SEQ):
            x = W / 2 - L / 2 + (j + 0.5) * L / n - 5
            d.text((x, H / 2 - 20 - 90 - 30), b, font=fo, fill=BASE[b][::-1])
            d.text((x, H / 2 - 20 + 90 + 12), PAIR[b], font=fo, fill=BASE[PAIR[b]][::-1])
        f = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
    return f


def seg_unzip(t, dur):
    img = canvas()
    u = ease(t / (dur * 0.8))
    helix(img, 0, W / 2, H / 2 - 20, 820, 0.001, straight=1.0, turns=0.001, spin=0, unzip=u)
    # new complementary bases docking behind the fork
    L, n = 820, len(SEQ)
    ux = W / 2 - L / 2 + L * u
    for j, b in enumerate(SEQ):
        x = W / 2 - L / 2 + (j + 0.5) * L / n
        if x < ux - 60:
            k = min(1.0, (ux - 60 - x) / 80)
            for sgn, base in ((-1, PAIR[b]), (1, b)):
                y = H / 2 - 20 + sgn * (1 + 90) - sgn * 30 * k
                yy = y - sgn * 140 * (1 - k)
                cv2.circle(img, P(x, yy), int(6 * SS), BASE[base], -1, cv2.LINE_AA)
    return down(img)


def seg_read(t, dur):
    img = canvas()
    L, n = 820, len(SEQ)
    y0 = H / 2 - 60
    x0 = W / 2 - L / 2
    for j, b in enumerate(SEQ):  # the template strand
        x = x0 + (j + 0.5) * L / n
        cv2.line(img, P(x, y0 - 30), P(x, y0), BASE[b], int(5 * SS), cv2.LINE_AA)
    cv2.line(img, P(x0, y0 - 30), P(x0 + L, y0 - 30), (230, 200, 150), int(7 * SS), cv2.LINE_AA)
    pos = ease(t / (dur * 0.7)) * L
    cv2.ellipse(img, P(x0 + pos, y0 + 8), (int(46 * SS), int(34 * SS)), 0, 0, 360, (120, 90, 200), -1, cv2.LINE_AA)  # polymerase
    rna = "".join("U" if PAIR[b] == "T" else PAIR[b] for b in SEQ)
    made = int(pos / (L / n))
    for j in range(made):  # the RNA copy peels away below
        x = x0 + (j + 0.5) * L / n
        cv2.line(img, P(x, y0 + 60), P(x, y0 + 90), BASE[rna[j]], int(5 * SS), cv2.LINE_AA)
    if made:
        cv2.line(img, P(x0, y0 + 90), P(x0 + made * L / n, y0 + 90), (200, 140, 230), int(6 * SS), cv2.LINE_AA)
    # codons → amino-acid beads
    for c in range(made // 3):
        x = x0 + (c * 3 + 1.5) * L / n
        cv2.rectangle(img, P(x - 1.5 * L / n + 2, y0 + 56), P(x + 1.5 * L / n - 2, y0 + 96), (200, 200, 200), int(1 * SS), cv2.LINE_AA)
        cv2.circle(img, P(x, y0 + 140), int(11 * SS), ((c * 70) % 255, 160, (255 - c * 40) % 255), -1, cv2.LINE_AA)
        if c:
            cv2.line(img, P(x - 3 * L / n, y0 + 140), P(x, y0 + 140), (180, 180, 180), int(3 * SS), cv2.LINE_AA)
    return down(img)


def seg_scale(t, dur):
    img = canvas()
    k = ease(t / 4)
    # 23 pairs of chromosomes as X shapes, then the mitochondrial ring
    for i in range(46):
        c, r = i % 12, i // 12
        x, y = 110 + c * 52, 130 + r * 88
        hgt = 18 + (i * 37) % 14
        a = k
        col = (int(150 + 80 * (i % 2)), 170, int(230 - 60 * (i % 2)))
        cv2.line(img, P(x - 6, y - hgt * a), P(x + 6, y + hgt * a), col, int(5 * SS), cv2.LINE_AA)
        cv2.line(img, P(x + 6, y - hgt * a), P(x - 6, y + hgt * a), col, int(5 * SS), cv2.LINE_AA)
    m = ease((t - dur * 0.45) / 3)
    if m > 0:
        cv2.circle(img, P(830, 400), int(70 * m * SS), (80, 200, 240), int(6 * SS), cv2.LINE_AA)
        a = (t * 40) % 360
        cv2.ellipse(img, P(830, 400), (int(70 * m * SS), int(70 * m * SS)), 0, a, a + 40, (255, 255, 255), int(6 * SS), cv2.LINE_AA)
    f = down(img)
    if m > 0.5:
        f = text(f, "mtDNA ring: 16,569 letters, from your mother", 485, 17, x=560)
    return f


EPISODES = {
    "ep1": {
        "title": "DNA — Episode 1: The Double Helix",
        "segments": [
            ("title", "Every living thing carries a message, written in a four letter alphabet. This is how it is written, and how it is read.",
             "", ""),
            ("helix", "DNA is two long strands wound around each other: a double helix. Its shape was worked out in 1953, from Rosalind Franklin's X ray photographs and the model built by James Watson and Francis Crick.",
             "Two strands wound into a double helix", "Watson & Crick 1953; Franklin & Gosling 1953, Nature 171"),
            ("bases", "Straighten the ladder and the rungs are pairs of bases. There are four: A, T, G and C. A always pairs with T, and G always pairs with C.",
             "Four bases: A pairs with T, G pairs with C", "Chargaff's rules, 1950"),
            ("unzip", "To copy itself, the helix unzips. Each strand is a template, and new bases snap onto it by the same pairing rule. Every copy keeps one old strand and one new one.",
             "The helix unzips; each strand is a template", "Meselson & Stahl 1958, PNAS 44"),
            ("read", "A gene is read by an enzyme that travels along the strand, writing a copy in RNA. In RNA the letter U stands in for T. The copy is then read three letters at a time. Each three letter word, a codon, calls for one amino acid, and the chain of amino acids folds into a protein.",
             "A gene is copied into RNA, read three letters at a time", "Crick et al. 1961, Nature 192; Nirenberg & Matthaei 1961"),
            ("scale", "Your cells hold about three billion base pairs, packed into twenty three pairs of chromosomes, one set from each parent. But one small ring of DNA, in the mitochondria, comes only from your mother. That ring is where the story of the mother line begins. That is the next episode.",
             "~3.1 billion base pairs in 23 chromosome pairs; mtDNA from the mother", "Human Genome Project 2003; T2T Consortium 2022, Science 376"),
        ],
    },
}
SEG = {"title": None, "helix": seg_helix, "bases": seg_bases, "unzip": seg_unzip, "read": seg_read, "scale": seg_scale}


def tts(text_, voice, out):
    from piper import PiperVoice
    v = PiperVoice.load(voice)
    with wave.open(out, "wb") as wf:
        v.synthesize_wav(text_, wf)
    with wave.open(out) as wf:
        return wf.getnframes() / wf.getframerate()


def srt_time(s):
    h, m = int(s // 3600), int(s % 3600 // 60)
    return f"{h:02d}:{m:02d}:{int(s % 60):02d},{int(s * 1000 % 1000):03d}"


def build(ep, outdir, voice):
    E = EPISODES[ep]
    os.makedirs(outdir, exist_ok=True)
    tmp = os.path.join(outdir, "tmp")
    os.makedirs(tmp, exist_ok=True)
    durs, wavs = [], []
    for k, (name, narr, cap, src) in enumerate(E["segments"]):
        w = os.path.join(tmp, f"{k:02d}.wav")
        try:
            d = tts(narr, voice, w)
        except Exception:
            d, w = max(6.0, len(narr.split()) / 2.6), None
        durs.append(d + 1.6)
        wavs.append((w, d))
    silent = os.path.join(tmp, "silent.mp4")
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS),
                          "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", silent],
                         stdin=subprocess.PIPE)
    srt, t0, poster = [], 0.0, None
    for k, (name, narr, cap, src) in enumerate(E["segments"]):
        dur = durs[k]
        n = int(dur * FPS)
        for i in range(n):
            t = i / FPS
            if name == "title":
                f = seg_title(t, dur, E["title"], "Alpha — a test of the explainer series. Hathor will host later.")
            else:
                f = SEG[name](t, dur)
                f = text(f, cap, 24, 24)
                if src:
                    f = text(f, "Source: " + src, H - 34, 14, (170, 170, 170))
            fade = min(1.0, i / 8, (n - i) / 8)
            p.stdin.write((f.astype(np.float32) * fade).astype(np.uint8).tobytes())
            if name == "helix" and i == 2 * FPS:
                poster = f
        srt.append(f"{k + 1}\n{srt_time(t0 + 0.5)} --> {srt_time(t0 + 0.5 + wavs[k][1])}\n{narr}\n")
        t0 += dur
    p.stdin.close()
    if p.wait() != 0:
        return None
    # voice track: each segment's narration placed at its segment start (+0.5 s)
    voice_wav = os.path.join(outdir, "voice.wav")
    parts, starts, acc = [], [], 0.0
    for (w, d), dur in zip(wavs, durs):
        if w:
            parts.append(w); starts.append(acc + 0.5)
        acc += dur
    if parts:
        inputs = sum([["-i", w] for w in parts], [])
        filt = ";".join(f"[{i}]adelay={int(s * 1000)}|{int(s * 1000)}[a{i}]" for i, s in enumerate(starts))
        filt += ";" + "".join(f"[a{i}]" for i in range(len(parts))) + f"amix=inputs={len(parts)}:normalize=0,apad=whole_dur={acc}[out]"
        subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", filt, "-map", "[out]", voice_wav], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", silent, "-i", voice_wav, "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
                        "-shortest", "-movflags", "+faststart", os.path.join(outdir, "clip.mp4")], check=True)
    else:
        os.replace(silent, os.path.join(outdir, "clip.mp4"))
    open(os.path.join(outdir, "captions.srt"), "w").write("\n".join(srt))
    if poster is not None:
        cv2.imwrite(os.path.join(outdir, "poster.jpg"), poster, [cv2.IMWRITE_JPEG_QUALITY, 85])
    json.dump({"episode": ep, "title": E["title"], "seconds": round(acc, 1), "voice": os.path.basename(voice),
               "voice_track": "voice.wav", "captions": "captions.srt", "host": "none (narrator only; Hathor to host later)",
               "sources": [s[3] for s in E["segments"] if s[3]]}, open(os.path.join(outdir, "episode.json"), "w"), indent=1)
    return os.path.join(outdir, "clip.mp4")


def to_anims(outdir, anims="/opt/melek-gen/anims"):
    """publish an episode through the animations pipeline (media sync picks up anims/<id>/): clip + poster +
    recipe, plus the separate voice track and captions so Hathor's voice can replace the narrator later."""
    import shutil, time
    e = json.load(open(os.path.join(outdir, "episode.json")))
    rid = "dna-" + e["episode"]
    d = os.path.join(anims, rid)
    os.makedirs(d, exist_ok=True)
    for f in ("clip.mp4", "poster.jpg", "voice.wav", "captions.srt"):
        if os.path.exists(os.path.join(outdir, f)):
            shutil.copy2(os.path.join(outdir, f), os.path.join(d, f))
    json.dump({"id": rid, "kind": "explainer", "motion": "", "amplitude": "", "camera": "still", "pace": "normal", "narrate": "yes",
               "scene": rid, "title": e["title"], "group": "DNA explainers", "look": "", "people": "",
               "narration_text": "Narrated by a neutral placeholder voice; Hathor will host later.", "seconds": e["seconds"],
               "made": int(time.time())}, open(os.path.join(d, "recipe.json"), "w"), indent=1)
    return d


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("ep")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--voice", default="/opt/melek-gen/voices/en_US-lessac-medium.onnx")
    a = ap.parse_args()
    if a.ep == "list":
        print("\n".join(f"{k}: {v['title']}" for k, v in EPISODES.items()))
        sys.exit(0)
    r = build(a.ep, a.out, a.voice)
    if r and os.environ.get("DNA_PUBLISH", "1") == "1" and os.path.isdir("/opt/melek-gen/anims"):
        print("published", to_anims(a.out))
    print(r or "FAILED")
    sys.exit(0 if r else 1)
