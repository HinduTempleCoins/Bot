"""dna_episodes2.py — episodes 2–6 of the DNA & genetics explainer series, built on dna_explainer.py's helpers.

Same rules as episode 1: vector animation only, a neutral narrator on its own track (Hathor hosts later), a caption and a
source on every segment. Episodes: 2 mother line & father line; 3 recombination, heterosis and inbreeding (wolf vs
purebred); 4 skin colour and sunlight; 5 viruses in our DNA, spillover and spillback; 6 out of Africa and the archaic
cousins.

  python dna_episodes2.py ep2 /opt/melek-gen/anim_lab/dna_ep2      (publishes to anims/dna-ep2 like ep1)
  python dna_episodes2.py all                                      (every episode here, into anim_lab/dna_epN)
"""
import math, os, sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dna_explainer as D  # noqa: E402
from dna_explainer import P, SS, W, H, canvas, down, text, ease, helix  # noqa: E402

# OpenCV colours are BGR
MUM, DAD, MIX, BAD, OK = (240, 160, 60), (50, 140, 240), (220, 120, 170), (60, 60, 230), (90, 210, 110)


def node(img, x, y, col, r=16, ring=None):
    cv2.circle(img, P(x, y), int(r * SS), col, -1, cv2.LINE_AA)
    if ring:
        cv2.circle(img, P(x, y), int((r + 5) * SS), ring, int(3 * SS), cv2.LINE_AA)


def line(img, a, b, col, w=3):
    cv2.line(img, P(*a), P(*b), col, int(w * SS), cv2.LINE_AA)


# ── episode 2: the mother line and the father line ───────────────────────────────────────────────────
def seg_lines(t, dur):
    """Four generations; the mtDNA ring passes from every mother to all her children, the Y only father to son."""
    img = canvas()
    gens = [[(480, 110, "F")], [(330, 210, "F"), (630, 210, "M")], [(220, 310, "F"), (440, 310, "M"), (560, 310, "F"), (740, 310, "M")],
            [(160, 420, "F"), (280, 420, "M"), (500, 420, "F"), (620, 420, "M"), (700, 420, "F"), (800, 420, "M")]]
    shown = min(len(gens), 1 + int(t / (dur / 4.5)))
    for g in range(1, shown):
        for (x, y, _s) in gens[g]:
            px, py, _ = min(gens[g - 1], key=lambda p: abs(p[0] - x))
            line(img, (px, py + 16), (x, y - 16), (120, 110, 100), 2)
    for g in range(shown):
        for (x, y, s) in gens[g]:
            mt = s == "F" or g > 0  # everyone carries mother's ring
            node(img, x, y, (200, 170, 150) if s == "F" else (150, 150, 180), 15, MUM if mt else None)
            if s == "M" and x > 420:
                cv2.rectangle(img, P(x - 5, y - 6), P(x + 5, y + 6), DAD, -1)
    f = down(img)
    return text(f, "blue ring = mother's mtDNA (to every child) · orange bar = Y (father to son only)", 455, 16)


def seg_mutations(t, dur):
    """One line through time; mutations drop onto it and the line splits into named branches (haplogroups)."""
    img = canvas()
    k = ease(t / (dur * 0.8))
    x0, x1, y = 90, 90 + 780 * k, 270
    line(img, (x0, y), (x1, y), (220, 220, 220), 4)
    branches = [(0.25, "L3", -1), (0.4, "N", 1), (0.55, "R", -1), (0.72, "J", 1), (0.86, "J2", -1)]
    f = None
    labels = []
    for (pos, name, side) in branches:
        if k < pos:
            continue
        bx = 90 + 780 * pos
        by = y + side * 110 * ease((k - pos) / 0.15)
        line(img, (bx, y), (bx + 70, by), MIX, 3)
        cv2.circle(img, P(bx, y), int(8 * SS), (40, 200, 240), -1, cv2.LINE_AA)
        labels.append((bx + 74, by, name))
    f = down(img)
    for (lx, ly, name) in labels:
        f = text(f, name, int(ly) - 12, 20, x=int(lx))
    return text(f, "each yellow dot = one new mutation, inherited by every descendant", 455, 17)


# ── episode 3: recombination, heterosis, inbreeding ─────────────────────────────────────────────────
def seg_recombine(t, dur):
    """Two parent chromosomes cross over and deal out new mixtures to each child."""
    img = canvas()
    k = ease(t / (dur * 0.5))
    for i, col in enumerate((MUM, DAD)):
        y = 150 + i * 60
        line(img, (160, y), (800, y), col, 16)
    cx = 160 + 640 * 0.45
    if k > 0.2:
        cv2.ellipse(img, P(cx, 180), (int(40 * SS), int(40 * SS)), 0, 0, 360, (255, 255, 255), int(2 * SS), cv2.LINE_AA)
    kids = ease((t - dur * 0.45) / (dur * 0.4))
    for j in range(4):
        y = 330 + j * 40
        cut = 160 + 640 * (0.2 + 0.2 * j)
        a, b = (MUM, DAD) if j % 2 == 0 else (DAD, MUM)
        line(img, (160, y), (160 + (cut - 160) * kids, y), a, 12)
        if kids > 0.5:
            line(img, (cut, y), (cut + (800 - cut) * ease((kids - 0.5) * 2), y), b, 12)
    f = down(img)
    return text(f, "crossing over: every child gets a different shuffle of both parents", 455, 17)


def seg_inbreed(t, dur):
    """Left: an outbred group — a hidden harmful variant stays single and masked. Right: inbred — copies double up."""
    img = canvas()
    rng = np.random.default_rng(7)
    k = ease(t / (dur * 0.7))
    for side, x0, rate in ((0, 80, 0.03), (1, 520, 0.28)):
        for i in range(60):
            x, y = x0 + (i % 10) * 36, 140 + (i // 10) * 50
            hidden = rng.random() < 0.3
            doubled = rng.random() < rate * k * 3
            col = BAD if doubled else (OK if not hidden else (80, 170, 200))
            node(img, x, y, col, 11)
    f = down(img)
    f = text(f, "mixed (outbred)", 450, 20, x=150)
    f = text(f, "closed (inbred)", 450, 20, x=590)
    return text(f, "red = two copies of the same harmful variant — rare when lines mix, common when they close", 455, 16)


def seg_wolfdog(t, dur):
    """Wolf vs purebred: a bar of genetic variety shrinking under closed breeding, recovered by crossing."""
    img = canvas()
    k = ease(t / (dur * 0.35))
    m = ease((t - dur * 0.5) / (dur * 0.35))
    bars = [("wolf", 1.0), ("purebred", 1.0 - 0.7 * k), ("mixed breed", 0.3 + 0.55 * m if m > 0 else 0.0)]
    for i, (name, v) in enumerate(bars):
        y = 170 + i * 110
        cv2.rectangle(img, P(300, y), P(300 + 480 * max(0.0, v), y + 44), (OK if i != 1 else BAD), -1)
    f = down(img)
    for i, (name, v) in enumerate(bars):
        f = text(f, name, 170 + i * 110 + 8, 22, x=110)
    return text(f, "genetic variety: closed breeding strips it out; crossing lines brings it back (heterosis)", 455, 16)


# ── episode 4: skin colour and sunlight ──────────────────────────────────────────────────────────────
def seg_sun(t, dur):
    """A latitude slider: strong sun → more melanin; weak sun → less, for vitamin D. The skin swatch follows."""
    img = canvas()
    lat = 60 * (0.5 - 0.5 * math.cos(2 * math.pi * t / dur))
    uv = math.cos(math.radians(lat))
    cx, cy = 200, 140
    cv2.circle(img, P(cx, cy), int(40 * SS), (60, 220, 255), -1, cv2.LINE_AA)
    for a in range(0, 360, 30):
        r0, r1 = 50, 50 + 40 * uv
        line(img, (cx + r0 * math.cos(math.radians(a)), cy + r0 * math.sin(math.radians(a))),
             (cx + r1 * math.cos(math.radians(a)), cy + r1 * math.sin(math.radians(a))), (60, 220, 255), 3)
    tone = int(60 + 170 * (1 - uv) ** 1.2)
    cv2.rectangle(img, P(520, 110), P(800, 330), (tone * 0.75, tone * 0.85, tone), -1)
    for i in range(int(90 * uv)):
        x, y = 530 + (i * 37) % 260, 120 + (i * 53) % 200
        cv2.circle(img, P(x, y), int(4 * SS), (30, 40, 60), -1, cv2.LINE_AA)
    f = down(img)
    f = text(f, f"latitude {lat:0.0f}°", 380, 24, x=140)
    return text(f, "dark dots = melanin granules · more sun, more melanin; tanning is the same system turned up", 455, 16)


def seg_origins(t, dur):
    """Three separate lightening routes appear on a strip map: Europe, East Asia, Melanesia (blond)."""
    img = canvas()
    cv2.rectangle(img, P(60, 120), P(900, 380), (70, 50, 40), -1)
    pts = [(0.18, 460, 200, "Europe: SLC24A5 / SLC45A2"), (0.45, 700, 210, "East Asia: OCA2 (a different route)"), (0.72, 800, 330, "Solomon Is.: TYRP1 blond")]
    f = None
    for (at, x, y, _lab) in pts:
        if t > dur * at:
            r = 10 + 30 * ease((t - dur * at) / 1.5)
            cv2.circle(img, P(x, y), int(r * SS), (120, 220, 250), int(3 * SS), cv2.LINE_AA)
    cv2.circle(img, P(300, 300), int(22 * SS), (40, 120, 200), -1, cv2.LINE_AA)
    f = down(img)
    f = text(f, "Africa: old light and dark variants", 300, 15, x=200)
    for n, (at, x, y, lab) in enumerate(pts):
        if t > dur * at + 0.8:
            f = text(f, "• " + lab, 395 + n * 22, 16, x=80)
    return text(f, "lighter skin evolved more than once, by different genes", 455, 18)


# ── episode 5: viruses in our DNA ────────────────────────────────────────────────────────────────────
def seg_insert(t, dur):
    """A retrovirus writes itself into a chromosome in a germ cell; every descendant inherits the insert."""
    img = canvas()
    k = ease(t / (dur * 0.4))
    line(img, (120, 300), (840, 300), (200, 180, 160), 18)
    vx, vy = 480, 100 + 190 * k
    cv2.circle(img, P(vx, vy), int(26 * SS), BAD, -1, cv2.LINE_AA)
    for a in range(0, 360, 45):
        line(img, (vx + 26 * math.cos(math.radians(a)), vy + 26 * math.sin(math.radians(a))),
             (vx + 38 * math.cos(math.radians(a)), vy + 38 * math.sin(math.radians(a))), BAD, 3)
    if k >= 0.99:
        cv2.rectangle(img, P(440, 291), P(520, 309), BAD, -1)
    m = ease((t - dur * 0.5) / (dur * 0.4))
    for j in range(3):
        y = 360 + j * 40
        if m > j / 3:
            line(img, (120, y), (840, y), (200, 180, 160), 10)
            cv2.rectangle(img, P(440, y - 5), P(520, y + 5), BAD, -1)
    f = down(img)
    return text(f, "an endogenous retrovirus: once in an egg or sperm cell, inherited forever (~8% of our genome)", 455, 16)


def seg_spill(t, dur):
    """The virus hops host to host and changes colour at each hop; spillback returns it changed."""
    img = canvas()
    hosts = [(120, 250, "bat"), (300, 150, "civet"), (480, 250, "human"), (660, 150, "mink"), (840, 250, "human")]
    cols = [(60, 200, 240), (60, 170, 240), (60, 130, 230), (140, 90, 220), (200, 70, 200)]
    for i, (x, y, _n) in enumerate(hosts):
        node(img, x, y, (110, 100, 90), 34)
        if i:
            line(img, hosts[i - 1][:2], (x, y), (90, 90, 90), 2)
    s = (t / dur) * (len(hosts) - 1)
    i = min(int(s), len(hosts) - 2)
    u = ease(s - i)
    (x0, y0, _), (x1, y1, _) = hosts[i], hosts[i + 1]
    cv2.circle(img, P(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u), int(12 * SS), cols[i + (1 if u > 0.5 else 0)], -1, cv2.LINE_AA)
    f = down(img)
    for (x, y, n) in hosts:
        f = text(f, n, y + 44, 16, x=x - 20)
    return text(f, "each new species changes the virus — spillback brings back a different virus (mink, 2020)", 455, 16)


# ── episode 6: out of Africa and the cousins ─────────────────────────────────────────────────────────
def seg_streams(t, dur):
    """Three streams — sapiens, Neanderthal, Denisovan — with small side-channels flowing into sapiens."""
    img = canvas()
    k = ease(t / (dur * 0.8))
    xs = 80 + 800 * k
    for y, col in ((260, (200, 200, 200)), (150, (90, 170, 230)), (380, (230, 150, 90))):
        line(img, (80, y), (min(xs, 700 if y != 260 else 880), y), col, 22 if y == 260 else 12)
    if k > 0.6:
        line(img, (640, 150), (700, 250), (90, 170, 230), 5)
    if k > 0.7:
        line(img, (660, 380), (740, 270), (230, 150, 90), 5)
    f = down(img)
    f = text(f, "Homo sapiens", 228, 18, x=90)
    f = text(f, "Neanderthals", 118, 16, x=90)
    f = text(f, "Denisovans", 400, 16, x=90)
    return text(f, "non-Africans carry ~1–2% Neanderthal DNA; Papuans a few % Denisovan", 455, 17)


SEGS2 = {"lines": seg_lines, "mutations": seg_mutations, "recombine": seg_recombine, "inbreed": seg_inbreed, "wolfdog": seg_wolfdog,
         "sun": seg_sun, "origins": seg_origins, "insert": seg_insert, "spill": seg_spill, "streams": seg_streams,
         "helix": D.seg_helix, "scale": D.seg_scale}

EPISODES2 = {
    "ep2": {"title": "DNA — Episode 2: The Mother Line and the Father Line", "segments": [
        ("title", "Two threads of your ancestry are passed down whole, generation after generation. One comes from your mother's mother's mother. The other only from father to son.", "", ""),
        ("scale", "Most of your DNA is shuffled every generation. But the small ring in your mitochondria comes only from your mother, and she got it from hers.", "mtDNA: from the mother, to every child", "Giles et al. 1980, PNAS 77"),
        ("lines", "Follow the blue ring: every mother passes it to all her children, sons and daughters. Follow the orange bar: the Y chromosome passes only from a father to his sons.", "Mother line (mtDNA) and father line (Y)", "Jobling & Tyler-Smith 2003, Nat Rev Genet 4"),
        ("mutations", "Every so often a copying error, a mutation, appears on one of these lines, and every descendant inherits it. Shared mutations group people into branches of one great family tree. These branches are called haplogroups: L3, N, R, J and many more.", "Shared mutations define haplogroups", "van Oven & Kayser 2009 (PhyloTree); ISOGG Y tree"),
        ("scale", "A haplogroup follows one line out of thousands of ancestors. It is a thread, not the whole cloth. Next time: how the rest of your DNA is shuffled.", "One line, not your whole ancestry", "Mathieson & Scally 2020, PLoS Genet 16"),
    ]},
    "ep3": {"title": "DNA — Episode 3: Shuffling, Mixing and Inbreeding", "segments": [
        ("title", "Why are brothers and sisters different? Why does mixing make populations stronger, and closing them off make them weaker?", "", ""),
        ("recombine", "When eggs and sperm are made, each pair of chromosomes swaps pieces. This is recombination. Every child receives a new shuffle of both parents, so new combinations appear without anyone breeding for them.", "Recombination deals every child a new mixture", "Morgan 1911; Coop & Przeworski 2007, Nat Rev Genet 8"),
        ("inbreed", "Everyone carries a few harmful recessive variants, hidden because the other copy works. When relatives have children, the chance of two identical bad copies rises sharply. When unrelated lines mix, they stay hidden.", "Inbreeding doubles up hidden harmful variants", "Charlesworth & Willis 2009, Nat Rev Genet 10"),
        ("wolfdog", "Wolves find mates outside their pack. Purebred dogs are closed lines, and many breeds are as inbred as parent and child, with more inherited disease. Mixed breed dogs, on average, have fewer. Crossing lines restores variety: hybrid vigour, or heterosis.", "Closed breeding loses variety; crossing restores it", "Bannasch et al. 2021, Canine Med Genet 8; Bellumori et al. 2013, JAVMA 242"),
        ("helix", "Royal families that married within the family, from Tutankhamun's parents to the Habsburgs, paid the same price. The strength is in the mix, not in purity.", "Purity weakens; mixing strengthens", "Hawass et al. 2010, JAMA 303; Vilas et al. 2019"),
    ]},
    "ep4": {"title": "DNA — Episode 4: The Colour of Skin", "segments": [
        ("title", "Skin colour is one of the most visible human differences, and one of the least useful for telling ancestry.", "", ""),
        ("sun", "Melanin shields the skin from ultraviolet light. Where the sun is strong, darker skin protects. Where it is weak, lighter skin makes vitamin D more easily. Tanning is the same system turned up for a season.", "Melanin follows sunlight", "Jablonski & Chaplin 2000, J Hum Evol 39"),
        ("origins", "Many light and dark variants are ancient, and many arose in Africa. Lighter skin then rose more than once, by different genes, in Europe and in East Asia. Blond hair evolved separately in the Solomon Islands.", "Lighter skin evolved more than once", "Crawford et al. 2017, Science 358; Kenny et al. 2012, Science 336"),
        ("helix", "In Europe, the main light-skin variants became common only in the last eight thousand years, with farmers and herders, under strong selection. Ten thousand years ago, Britain's hunter gatherers were dark skinned with blue eyes.", "European light skin is recent", "Mathieson et al. 2015, Nature 528; Brace et al. 2019"),
    ]},
    "ep5": {"title": "DNA — Episode 5: Viruses in Our Genes", "segments": [
        ("title", "About eight percent of your genome was written by viruses. And viruses are still moving between species, changing as they go.", "", ""),
        ("insert", "A retrovirus copies itself into the DNA of the cell it infects. When that cell was an egg or a sperm, the insert was inherited, and it is still in us. Some were put to work: the placenta depends on a gene captured from a virus.", "Endogenous retroviruses: ~8% of the human genome", "Lander et al. 2001, Nature 409; Mi et al. 2000, Nature 403"),
        ("spill", "Viruses live in reservoir animals, like bats and birds, and jump to others: civets, camels, pigs, horses, people. In 2020 people gave the coronavirus to farmed mink. It changed in the mink, and came back to people as a new variant.", "Spillover and spillback", "Oude Munnink et al. 2021, Science 371"),
        ("helix", "Each new host puts the virus under different pressure. What comes back may be milder, or more dangerous, but it is no longer the virus our immunity knows.", "A returning virus is a different virus", "Pickering et al. 2022, Nat Microbiol 7"),
    ]},
    "ep6": {"title": "DNA — Episode 6: Out of Africa, and the Cousins We Met", "segments": [
        ("title", "Every living person descends mainly from people who lived in Africa. But on the way out, our ancestors met other humans.", "", ""),
        ("streams", "Neanderthals lived in Europe and western Asia. Denisovans, known mostly from their DNA, lived across Asia. Our ancestors mixed with both. People outside Africa carry about one to two percent Neanderthal DNA, and Papuans and Aboriginal Australians a few percent Denisovan.", "Neanderthal and Denisovan DNA in us", "Green et al. 2010, Science 328; Reich et al. 2010, Nature 468"),
        ("mutations", "Some of those borrowed genes helped. A Denisovan gene helps Tibetans breathe at altitude. Others shaped our immune systems and our skin.", "Borrowed genes that helped", "Huerta-Sánchez et al. 2014, Nature 512"),
        ("scale", "So no one is pure anything. Every population is a mixture of older populations, and that mixing is written in every genome.", "Every population is a mixture", "Haak et al. 2015, Nature 522; Lazaridis et al. 2014, Nature 513"),
    ]},
}


def install():
    D.EPISODES.update(EPISODES2)
    D.SEG.update(SEGS2)


if __name__ == "__main__":
    install()
    eps = list(EPISODES2) if sys.argv[1] == "all" else [sys.argv[1]]
    voice = "/opt/melek-gen/voices/en_US-lessac-medium.onnx"
    for ep in eps:
        out = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] != "all" else f"/opt/melek-gen/anim_lab/dna_{ep}"
        r = D.build(ep, out, voice)
        if r and os.environ.get("DNA_PUBLISH", "1") == "1" and os.path.isdir("/opt/melek-gen/anims"):
            print("published", D.to_anims(out))
        print(ep, r or "FAILED", flush=True)
