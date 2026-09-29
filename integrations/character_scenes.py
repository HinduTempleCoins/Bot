"""character_scenes.py — Hathor's CHARACTER SCENES: our characters and objects composited into remake / landscape scenes
and brought to life, as short clips for the animation lab (/animations) and as parts for the documentaries.

  python character_scenes.py --root /opt/melek-gen --out /opt/melek-gen/anims --n 40 [--seed N]

Per clip: a background (a realistic remake or a landscape from the library) → a cut-out of a character (posed, from
library/characters_sais — moved by its own pose keypoints: breathing, head tilt, sway, a raised arm) or of an object
(library/egypt_royal_military, objects, lotus — a slow float) → two layers with parallax (background pushes in, the
figure drifts the other way) → mp4 + poster + recipe (kind 'character-scene'), in the same layout hathor_animate.py
publishes, so media sync and the @shilpa-shastra poster pick them up. Cut-outs use the tools-venv background remover
(integrations/documentary/tools/cutout.py) and are cached. CPU only; run at low priority.
"""
import argparse, glob, hashlib, json, os, random, subprocess, sys, time

import cv2
import numpy as np

W, H, FPS = 960, 540, 24


def cutout(root, src, cache):
    os.makedirs(cache, exist_ok=True)
    dst = os.path.join(cache, hashlib.sha1(src.encode()).hexdigest()[:16] + ".png")
    if not os.path.exists(dst):
        py = os.path.join(root, "tools-venv", "bin", "python")
        tool = os.path.join(root, "tools", "cutout.py")
        r = subprocess.run([py, tool, src, dst], capture_output=True, text=True)
        if r.returncode != 0 or not os.path.exists(dst):
            raise RuntimeError(f"cutout failed for {os.path.basename(src)}: {r.stderr[-200:]}")
    im = cv2.imread(dst, cv2.IMREAD_UNCHANGED)
    if im is None or im.ndim != 3 or im.shape[2] != 4:
        raise RuntimeError("cutout has no alpha")
    return im


def fit_bg(im, zoom=1.12):
    h, w = im.shape[:2]
    s = max(W / w, H / h) * zoom
    return cv2.resize(im, (int(w * s) + 2, int(h * s) + 2), interpolation=cv2.INTER_AREA)


def crop_center(big, t, push):
    """slow push-in over the oversized background; t in [0,1]"""
    z = 1.0 + push * (0.5 - 0.5 * np.cos(np.pi * t))
    bh, bw = big.shape[:2]
    cw, ch = int(W * (bw / (W * 1.12)) / z), int(H * (bh / (H * 1.12)) / z)
    x0, y0 = (bw - cw) // 2, (bh - ch) // 2
    return cv2.resize(big[y0:y0 + ch, x0:x0 + cw], (W, H), interpolation=cv2.INTER_LINEAR)


def over(bg, fg, x, y):
    """alpha-composite fg (BGRA) onto bg (BGR) at top-left x,y (clipped)"""
    h, w = fg.shape[:2]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if x0 >= x1 or y0 >= y1:
        return bg
    f = fg[y0 - y:y1 - y, x0 - x:x1 - x].astype(np.float32)
    a = f[:, :, 3:4] / 255.0
    out = bg.copy()
    region = out[y0:y1, x0:x1].astype(np.float32)
    out[y0:y1, x0:x1] = (f[:, :, :3] * a + region * (1 - a)).astype(np.uint8)
    return out


# IMAGINED SCENES (operator 2026-09-29): short scenes inspired by the texts, labelled on screen as imagined, built only
# from grown assets whose description matches the figure keywords (so they wait until those assets exist).
IMAGINED = [
    {"title": "Archangels descend into the dark prison to speak with the bound Watchers", "refs": "1 Enoch 12–16; Jude 6", "figure": ["archangel", "michael", "gabriel", "raphael", "uriel"], "bg": ["abyss", "chained", "prison", "dark"]},
    {"title": "The angels of the nations watch a war and are told not to intervene", "refs": "Daniel 10:13, 20; Deuteronomy 32:8 (LXX); Revelation 12:7", "figure": ["watcher", "angel", "archangel"], "bg": ["battle", "war", "army", "chariot"]},
    {"title": "A figure burning like a meteor as it falls from heaven", "refs": "Isaiah 14:12; Luke 10:18; Revelation 9:1; 1 Enoch 18:13–16, 21:6", "figure": ["meteor", "fire-descent", "falling", "watcher"], "bg": ["night", "sky", "desert", "mountain"]},
    {"title": "Michael and the dragon", "refs": "Revelation 12:7–9", "figure": ["michael", "archangel"], "bg": ["storm", "sky", "mountain", "battle"]},
    {"title": "The four living creatures and the wheels", "refs": "Ezekiel 1; Ezekiel 10", "figure": ["cherub", "cherubim", "wheels", "living creatures"], "bg": ["river", "storm", "sky", "chebar"]},
    {"title": "The seraphim with six wings", "refs": "Isaiah 6:2", "figure": ["seraph", "seraphim"], "bg": ["temple", "sanctuary", "throne"]},
    {"title": "The Watchers descend on Mount Hermon", "refs": "1 Enoch 6:6", "figure": ["watcher"], "bg": ["hermon", "mountain"]},
    {"title": "Spirits rise from the fallen giants", "refs": "1 Enoch 15:8–12", "figure": ["giant-spirit", "spirits", "giant"], "bg": ["battle", "valley", "desert", "dark"]},
]


def grown_matching(root, words):
    out = []
    for f in sorted(glob.glob(f"{root}/library/grown/*.png")):
        if f.endswith(".pose.png"):
            continue
        try:
            j = json.load(open(f[:-4] + ".json"))
        except Exception:
            j = {}
        text = f"{j.get('desc', '')} {j.get('name', '')} {os.path.basename(f)}".lower()
        if any(w in text for w in words):
            out.append(f)
    return out


def sources(root):
    chars = [f for d in ("characters_sais", "grown") for f in sorted(glob.glob(f"{root}/library/{d}/*.png")) if not f.endswith(".pose.png") and os.path.exists(f[:-4] + ".annot.json")]
    objects = [f for d in ("egypt_royal_military", "objects", "lotus") for f in sorted(glob.glob(f"{root}/library/{d}/*.png")) if not f.endswith(".pose.png")]
    bgs = sorted(glob.glob(f"{root}/remakes/*/1_real_*.png")) + sorted(glob.glob(f"{root}/library/landscapes/*.png"))
    return chars, objects, [b for b in bgs if not b.endswith(".pose.png")]


def title_of(path):
    base = os.path.splitext(os.path.basename(path))[0]
    for p in ("_egyptian", "_nubian", "_libyan", "_levantine", "_pale", "_greek", "_minoan", "_punic", "_depicted", "1_real"):
        base = base.replace(p, "")
    return base.replace("_", " ").replace("-", " ").strip().capitalize() or "A figure"


def make_clip(root, out, fg_src, bg_src, is_char, rng, am, label=None, secs=None, title=None, refs=""):
    fg = cutout(root, fg_src, os.path.join(root, "cutouts"))
    bgimg = cv2.imread(bg_src, cv2.IMREAD_COLOR)
    if bgimg is None:
        raise RuntimeError("unreadable background")
    big = fit_bg(bgimg)
    target_h = int(H * (0.78 if is_char else 0.45))
    s = target_h / fg.shape[0]
    fg = cv2.resize(fg, (max(2, int(fg.shape[1] * s)), target_h), interpolation=cv2.INTER_AREA)
    pose = None
    if is_char:
        p = am.load_pose(fg_src)
        if p:
            # pad with transparent margin so the warp's pinned border sits far from the figure (a tight border bends robes)
            pad = int(fg.shape[0] * 0.25)
            fg = cv2.copyMakeBorder(fg, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(0, 0, 0, 0))
            pose = {k: (x * s + pad, y * s + pad) for k, (x, y) in p.items()}
    motion = rng.choice(["breathe", "head_tilt", "arm_raise", "breathe", "head_tilt"]) if pose else "float"
    padx = (fg.shape[1] - int(fg.shape[1] / 1.5)) // 2 if pose else 0
    side = rng.choice(["left", "centre", "right"])
    x_base = {"left": int(W * 0.18), "centre": (W - fg.shape[1]) // 2, "right": int(W * 0.82) - fg.shape[1]}[side]
    y_base = H - fg.shape[0] - (int(H * 0.02) if is_char else int(H * 0.2))
    if pose:  # the padded canvas extends past the figure: align the figure's feet, not the canvas edge
        y_base += int(target_h * 0.25) - int(H * 0.02)
    secs = secs or rng.choice([6, 7, 8])
    n = secs * FPS
    push = rng.choice([0.06, 0.1])
    drift = rng.choice([-18, 18])
    cid = hashlib.sha1(f"{fg_src}|{bg_src}|{time.time_ns()}".encode()).hexdigest()[:12]
    d = os.path.join(out, cid)
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, "clip.tmp.mp4")
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                           "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp], stdin=subprocess.PIPE)
    poster = None
    for i in range(n):
        t = i / max(1, n - 1)
        frame = crop_center(big, t, push)
        if pose:
            g = am.pose_frame(fg, pose, i / FPS, motion, 0.7)
        else:
            g = fg
        dy = int(6 * np.sin(2 * np.pi * i / (FPS * 4))) if not pose else 0
        frame = over(frame, g, x_base + int(drift * t), y_base + dy)
        if label:
            frame = am.caption(frame, label)
        if i == int(1.5 * FPS):
            poster = frame
        ff.stdin.write(frame.tobytes())
    ff.stdin.close()
    if ff.wait() != 0:
        raise RuntimeError("ffmpeg failed")
    os.replace(tmp, os.path.join(d, "clip.mp4"))
    cv2.imwrite(os.path.join(d, "poster.jpg"), poster if poster is not None else frame, [cv2.IMWRITE_JPEG_QUALITY, 82])
    scene_key = os.path.basename(os.path.dirname(bg_src)) if "/remakes/" in bg_src else os.path.splitext(os.path.basename(bg_src))[0]
    who = title_of(fg_src)
    where = title_of(os.path.dirname(bg_src)) if "/remakes/" in bg_src else title_of(bg_src)
    r = {"id": cid, "kind": "character-scene", "motion": motion, "amplitude": "medium", "camera": "push_in", "pace": "normal", "narrate": "no",
         "scene": scene_key, "title": title or f"{who} — {where}", "group": "Imagined scenes" if label else "Character scenes", "refs": refs, "look": "1_real", "people": "",
         "puppet_title": who, "narration_text": "", "seconds": float(secs), "made": int(time.time()),
         "parts": {"figure": os.path.relpath(fg_src, root), "background": os.path.relpath(bg_src, root), "side": side}}
    json.dump(r, open(os.path.join(d, "recipe.json"), "w"), indent=1)
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/opt/melek-gen")
    ap.add_argument("--out", default="/opt/melek-gen/anims")
    ap.add_argument("--n", type=int, default=40)
    ap.add_argument("--seed", type=int)
    ap.add_argument("--objects", type=float, default=0.3, help="share of clips that feature an object instead of a character")
    ap.add_argument("--imagined", action="store_true", help="also make the imagined scenes whose grown assets exist")
    a = ap.parse_args()
    sys.path.insert(0, a.root)
    import hathor_animate as am  # pose keypoints + the puppet warp
    rng = random.Random(a.seed)
    chars, objects, bgs = sources(a.root)
    if not bgs or not (chars or objects):
        sys.exit("no characters/objects or backgrounds found")
    ok = 0
    for spec in (IMAGINED if a.imagined else []):
        figs = grown_matching(a.root, spec["figure"])
        if not figs:
            print(f"imagined scene waiting for assets: {spec['title']}", flush=True)
            continue
        bgs_m = [b for b in bgs if any(w in b.lower() for w in spec["bg"])] or bgs
        try:
            r = make_clip(a.root, a.out, rng.choice(figs), rng.choice(bgs_m), True, rng, am,
                          label=f"Imagined scene — inspired by {spec['refs']}", secs=20, title=spec["title"], refs=spec["refs"])
            ok += 1
            print(f"{r['id']} imagined  {spec['title'][:70]}", flush=True)
        except Exception as e:
            print(f"FAILED imagined {spec['title'][:40]}: {e}", flush=True)
    for _ in range(a.n):
        is_char = bool(chars) and (not objects or rng.random() >= a.objects)
        fg = rng.choice(chars if is_char else objects)
        bg = rng.choice(bgs)
        t0 = time.time()
        try:
            r = make_clip(a.root, a.out, fg, bg, is_char, rng, am)
            ok += 1
            print(f"{r['id']} {r['motion']:9} {time.time() - t0:.0f}s  {r['title'][:70]}", flush=True)
        except Exception as e:
            print(f"FAILED {os.path.basename(fg)} on {os.path.basename(bg)}: {e}", flush=True)
    print(f"made {ok}/{a.n} character scenes")


if __name__ == "__main__":
    main()
