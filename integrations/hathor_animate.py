"""hathor_animate.py — Hathor's test animations, made on our own CPU from the remakes and her characters.

  python hathor_animate.py make    --root /opt/melek-gen --out anims --n 12 [--feedback feedback.json]
  python hathor_animate.py publish --out anims --bundle anims_bundle

`make` plans N short clips and renders them. Every clip is a RECIPE (kind, source, motion, amplitude, camera,
narration...) saved beside the mp4, so viewer thumbs up / down can be traced back to the choices that made it.
When --feedback is given (the Studio's /animations/feedback.json), each choice is drawn by Thompson sampling
over Beta(1+up, 1+down) of the clips that used it: what people like gets made more, what they dislike less,
and untried choices still get explored.

Kinds:
  kenburns  slow camera push / pan over one image
  looks     one scene morphing realistic -> half vaporwave -> full MELEK aesthetic
  peoples   one scene crossfading through the peoples it was rendered in
  puppet    a character (or the people in a remake) moved by their own pose keypoints: breathing, head tilt,
            sway, a raised arm. Thin-plate-spline warp driven by the annotator's .annot.json (openpose body).
  scene     Hathor's own short scene: establishing shot of a remake, a matching character brought to life,
            then the scene's look morph, with Piper narration built from the titles.

Frames are drawn in numpy/OpenCV and piped to ffmpeg (libx264). No GPU, no rented API.
"""
import argparse, glob, hashlib, json, math, os, random, re, subprocess, sys, tempfile, time, wave

import cv2
import numpy as np

W, H, FPS = 960, 540, 24
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
LOOK_ORDER = ["1_real", "2_half", "3_full"]

# The choices a recipe is made of. Each value is an "arm" that feedback can favour or disfavour.
ARMS = {
    "kind": ["kenburns", "looks", "peoples", "puppet", "scene"],
    "motion": ["breathe", "head_tilt", "sway", "arm_raise", "all"],
    "amplitude": ["subtle", "medium", "strong"],
    "camera": ["push_in", "pull_out", "pan_left", "pan_right", "still"],
    "pace": ["slow", "normal", "quick"],
    "narrate": ["yes", "no"],
}
AMP = {"subtle": 0.6, "medium": 1.0, "strong": 1.6}
PACE = {"slow": 1.35, "normal": 1.0, "quick": 0.7}


# ── sources ────────────────────────────────────────────────────────────────────────────────────────
def load_pose(png):
    """openpose body keypoints (pixels) from <img>.annot.json, or None."""
    a = png[:-4] + ".annot.json"
    try:
        d = json.load(open(a))
        body = d["people"][0]["body"]
        pts = {k: (v["x"], v["y"]) for k, v in body.items() if v.get("x", -1) >= 0 and v.get("y", -1) >= 0}
        return pts if "neck" in pts and ("nose" in pts or "r_eye" in pts) else None
    except Exception:
        return None


def title_from_file(f):
    base = os.path.splitext(os.path.basename(f))[0]
    for p in ("_egyptian", "_nubian", "_libyan", "_levantine", "_pale", "_punic", "_greek", "_minoan", "_depicted"):
        base = base.replace(p, "")
    return re.sub(r"[_-]+", " ", base).strip().capitalize()


def gather(root):
    """scenes from remakes/<key>/<look>_<people>.png (+ titles from the published manifest); characters from
    library/*/ images that carry a person pose."""
    titles = {}
    for mf in (f"{root}/remakes_bundle.new/manifest.json", f"{root}/remakes_bundle/manifest.json"):
        try:
            for s in json.load(open(mf))["scenes"]:
                titles[s["key"]] = (s.get("title") or s["key"], s.get("group") or "Scenes", s.get("credit") or "")
            break
        except Exception:
            continue
    scenes = []
    for d in sorted(glob.glob(f"{root}/remakes/*/")):
        key = os.path.basename(d.rstrip("/"))
        looks = {}
        for f in glob.glob(f"{d}*.png"):
            m = re.match(r"(\d_[a-z]+)_([a-z]+)\.png$", os.path.basename(f))
            if m and not f.endswith(".pose.png"):
                looks.setdefault(m.group(1), {})[m.group(2)] = f
        if looks:
            t = titles.get(key, (key.replace("_", " ").capitalize(), "Scenes", ""))
            scenes.append({"key": key, "title": t[0], "group": t[1], "credit": t[2], "looks": looks})
    chars = []
    for f in sorted(glob.glob(f"{root}/library/*/*.png")):
        if f.endswith(".pose.png") or "rejected" in f:
            continue
        pose = load_pose(f)
        if pose:
            chars.append({"file": f, "set": os.path.basename(os.path.dirname(f)), "title": title_from_file(f)})
    return scenes, chars


# ── feedback → choice ──────────────────────────────────────────────────────────────────────────────
def arm_stats(out, feedback):
    """{param: {value: [up, down]}} from past recipes joined with the Studio's per-clip votes."""
    clips = (feedback or {}).get("clips", {})
    stats = {p: {v: [0, 0] for v in vals} for p, vals in ARMS.items()}
    for rf in glob.glob(f"{out}/*/recipe.json"):
        try:
            r = json.load(open(rf))
        except Exception:
            continue
        c = clips.get(r["id"])
        if not c:
            continue
        for p in ARMS:
            v = r.get(p)
            if v in stats[p]:
                stats[p][v][0] += int(c.get("up", 0))
                stats[p][v][1] += int(c.get("down", 0))
    return stats


def pick(stats, p, rng):
    """Thompson sampling: highest draw from Beta(1+up, 1+down)."""
    return max(ARMS[p], key=lambda v: rng.betavariate(1 + stats[p][v][0], 1 + stats[p][v][1]))


def match_char(scene, chars, rng):
    """a character whose name or set shares words with the scene's group/title; else any."""
    words = set(re.findall(r"[a-z]{4,}", (scene["group"] + " " + scene["title"]).lower()))
    scored = [(len(words & set(re.findall(r"[a-z]{4,}", (c["title"] + " " + c["set"]).lower()))), rng.random(), c) for c in chars]
    scored.sort(key=lambda x: (-x[0], x[1]))
    return scored[0][2] if scored else None


def plan(scenes, chars, stats, n, rng):
    recipes = []
    for _ in range(n):
        r = {p: pick(stats, p, rng) for p in ARMS}
        if r["kind"] == "puppet" and not chars:
            r["kind"] = "kenburns"
        sc = rng.choice(scenes)
        look = rng.choice([l for l in LOOK_ORDER if l in sc["looks"]])
        people = rng.choice(sorted(sc["looks"][look]))
        if r["kind"] == "peoples" and len(sc["looks"][look]) < 3:
            r["kind"] = "kenburns"
        if r["kind"] == "looks" and sum(people in sc["looks"].get(l, {}) for l in LOOK_ORDER) < 2:
            r["kind"] = "kenburns"
        r.update({"scene": sc["key"], "title": sc["title"], "group": sc["group"], "look": look, "people": people})
        if r["kind"] in ("puppet", "scene"):
            # puppet: half the time a remake's own people (if posed), otherwise a character from the library
            own = sc["looks"][look][people]
            if r["kind"] == "puppet" and load_pose(own) and rng.random() < 0.5:
                r["puppet_src"], r["puppet_title"] = own, sc["title"]
            else:
                c = match_char(sc, chars, rng) if r["kind"] == "scene" else rng.choice(chars)
                r["puppet_src"], r["puppet_title"] = c["file"], c["title"]
        r["id"] = hashlib.sha1(json.dumps(r, sort_keys=True).encode() + str(time.time_ns()).encode()).hexdigest()[:12]
        recipes.append(r)
    return recipes


# ── drawing ────────────────────────────────────────────────────────────────────────────────────────
def read(f):
    im = cv2.imread(f, cv2.IMREAD_COLOR)
    if im is None:
        raise RuntimeError(f"unreadable {f}")
    return im


def fit_canvas(im):
    """image fitted into W×H over a blurred, darkened copy of itself (portrait sources stay whole)."""
    h, w = im.shape[:2]
    s = min(W / w, H / h)
    fg = cv2.resize(im, (max(2, int(w * s)), max(2, int(h * s))), interpolation=cv2.INTER_AREA)
    sb = max(W / w, H / h)
    bg = cv2.resize(im, (int(w * sb) + 2, int(h * sb) + 2))
    y0, x0 = (bg.shape[0] - H) // 2, (bg.shape[1] - W) // 2
    bg = cv2.GaussianBlur(bg[y0:y0 + H, x0:x0 + W], (0, 0), 18) * 0.45
    out = bg.astype(np.uint8)
    y, x = (H - fg.shape[0]) // 2, (W - fg.shape[1]) // 2
    out[y:y + fg.shape[0], x:x + fg.shape[1]] = fg
    return out, (s, x, y)


def camera(frame, t, cam, amp):
    """Ken Burns on an already-fitted W×H frame; t in [0,1]."""
    e = 0.5 - 0.5 * math.cos(math.pi * t)  # ease in-out
    z0, z1, dx, dy = 1.0, 1.0, 0.0, 0.0
    k = 0.10 * amp
    if cam == "push_in": z0, z1 = 1.0, 1.0 + k
    elif cam == "pull_out": z0, z1 = 1.0 + k, 1.0
    elif cam == "pan_left": z0 = z1 = 1.0 + k; dx = k * W * 0.45 * (1 - 2 * e)
    elif cam == "pan_right": z0 = z1 = 1.0 + k; dx = -k * W * 0.45 * (1 - 2 * e)
    z = z0 + (z1 - z0) * e
    M = np.float32([[z, 0, (1 - z) * W / 2 + dx], [0, z, (1 - z) * H / 2 + dy]])
    return cv2.warpAffine(frame, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)


def tps_map(src_pts, dst_pts, shape, step=8):
    """backward map for cv2.remap: for each output pixel, where to sample the source (thin-plate spline fitted
    on the displaced control points, evaluated on a coarse grid then upsampled)."""
    h, w = shape
    P, Q = np.asarray(dst_pts, np.float64), np.asarray(src_pts, np.float64)
    n = len(P)
    def U(r2):
        with np.errstate(divide="ignore", invalid="ignore"):
            v = r2 * np.log(r2)
        return np.nan_to_num(v)
    K = U(((P[:, None, :] - P[None, :, :]) ** 2).sum(-1))
    L = np.zeros((n + 3, n + 3))
    L[:n, :n] = K + np.eye(n) * 1e-6
    L[:n, n] = 1; L[:n, n + 1:] = P
    L[n, :n] = 1; L[n + 1:, :n] = P.T
    Y = np.zeros((n + 3, 2)); Y[:n] = Q
    coef = np.linalg.solve(L, Y)
    gy, gx = np.mgrid[0:h:step, 0:w:step]
    G = np.stack([gx.ravel(), gy.ravel()], 1).astype(np.float64)
    Ug = U(((G[:, None, :] - P[None, :, :]) ** 2).sum(-1))
    M = Ug @ coef[:n] + coef[n] + G @ coef[n + 1:]
    mx = cv2.resize(M[:, 0].reshape(gy.shape).astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
    my = cv2.resize(M[:, 1].reshape(gy.shape).astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
    return mx, my


HEAD = ("nose", "r_eye", "l_eye", "r_ear", "l_ear")


def pose_frame(im, pose, t_sec, motion, amp):
    """one frame of a pose-driven puppet: keypoints displaced by the motion, border pinned, TPS warp."""
    h, w = im.shape[:2]
    scale = h / 768.0
    src, dst = [], []
    neck = np.array(pose["neck"])
    hip_y = np.mean([pose[k][1] for k in ("r_hip", "l_hip") if k in pose] or [neck[1] + 200 * scale])
    ph = 2 * math.pi * t_sec
    mot = set(ARMS["motion"][:4]) if motion == "all" else {motion}
    for k, (x, y) in pose.items():
        p = np.array([x, y], float)
        d = np.zeros(2)
        if "breathe" in mot and k in ("neck", "r_shoulder", "l_shoulder") + HEAD:
            d[1] -= 6.0 * amp * scale * (0.5 - 0.5 * math.cos(ph / 3.5))
        if "sway" in mot and y < hip_y:
            d[0] += 10.0 * amp * scale * math.sin(ph / 5.0) * (hip_y - y) / max(1.0, hip_y - neck[1] + 1e-6) * 0.6
        if "head_tilt" in mot and k in HEAD:
            a = math.radians(7.0 * amp) * math.sin(ph / 4.0)
            v = p - neck
            d += np.array([v[0] * math.cos(a) - v[1] * math.sin(a), v[0] * math.sin(a) + v[1] * math.cos(a)]) - v
        if "arm_raise" in mot and k in ("r_elbow", "r_wrist") and "r_shoulder" in pose:
            a = -math.radians(28.0 * amp) * (0.5 - 0.5 * math.cos(ph / 3.0))
            v = p - np.array(pose["r_shoulder"])
            d += np.array([v[0] * math.cos(a) - v[1] * math.sin(a), v[0] * math.sin(a) + v[1] * math.cos(a)]) - v
        src.append(p); dst.append(p + d)
    # pin the border and a ring around the body so only the figure moves
    for gx in np.linspace(0, w - 1, 6):
        for gy in (0, h - 1):
            src.append((gx, gy)); dst.append((gx, gy))
    for gy in np.linspace(0, h - 1, 6)[1:-1]:
        for gx in (0, w - 1):
            src.append((gx, gy)); dst.append((gx, gy))
    for k in ("r_ankle", "l_ankle", "r_hip", "l_hip"):
        if k in pose:
            i = list(pose).index(k); dst[i] = src[i]
    mx, my = tps_map(src, dst, (h, w))
    return cv2.remap(im, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)


def caption(frame, text):
    if not text:
        return frame
    try:
        from PIL import Image, ImageDraw, ImageFont
        im = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        d = ImageDraw.Draw(im)
        f = ImageFont.truetype(FONT, 26)
        tw = d.textlength(text, font=f)
        d.rectangle([0, H - 58, W, H], fill=(0, 0, 0))
        d.text(((W - tw) / 2, H - 46), text, font=f, fill=(245, 220, 150))
        return cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
    except Exception:
        return frame


# ── shots (generators of frames) ───────────────────────────────────────────────────────────────────
def shot_kenburns(f, secs, r, cap=""):
    base, _ = fit_canvas(read(f))
    n = int(secs * FPS)
    for i in range(n):
        yield caption(camera(base, i / max(1, n - 1), r["camera"], AMP[r["amplitude"]]), cap)


def shot_sequence(files, secs_each, r, cap=""):
    """crossfade through several images, camera moving across the whole shot"""
    bases = [fit_canvas(read(f))[0] for f in files]
    per = int(secs_each * FPS)
    xf = int(0.8 * FPS)
    n = per * len(bases)
    for i in range(n):
        j = min(i // per, len(bases) - 1)
        fr = bases[j].astype(np.float32)
        into = i - j * per
        if j + 1 < len(bases) and into > per - xf:
            a = (into - (per - xf)) / xf
            fr = fr * (1 - a) + bases[j + 1].astype(np.float32) * a
        yield caption(camera(fr.astype(np.uint8), i / max(1, n - 1), r["camera"], AMP[r["amplitude"]]), cap)


def shot_puppet(f, secs, r, cap=""):
    im = read(f)
    pose = load_pose(f)
    n = int(secs * FPS)
    amp = AMP[r["amplitude"]]
    for i in range(n):
        warped = pose_frame(im, pose, i / FPS, r["motion"], amp) if pose else im
        base, _ = fit_canvas(warped)
        cam = r["camera"] if r["camera"] in ("push_in", "pull_out", "still") else "push_in"
        yield caption(camera(base, i / max(1, n - 1), cam, amp * 0.5), cap)


def chain(shots):
    """concatenate shot generators with a short crossfade between shots"""
    xf = int(0.6 * FPS)
    prev_tail = []
    for g in shots:
        frames = iter(g)
        head = []
        for _ in range(xf):
            try: head.append(next(frames))
            except StopIteration: break
        if prev_tail:
            for k, (a, b) in enumerate(zip(prev_tail, head)):
                w = (k + 1) / (len(head) + 1)
                yield (a.astype(np.float32) * (1 - w) + b.astype(np.float32) * w).astype(np.uint8)
            head = head[len(prev_tail):]
        yield from head
        buf = []
        for fr in frames:
            buf.append(fr)
            if len(buf) > xf:
                yield buf.pop(0)
        prev_tail = buf
    yield from prev_tail


# ── narration ──────────────────────────────────────────────────────────────────────────────────────
def say(text, voice, out_wav):
    from piper import PiperVoice
    v = PiperVoice.load(voice)
    with wave.open(out_wav, "wb") as wf:
        v.synthesize_wav(text, wf)
    with wave.open(out_wav) as wf:
        return wf.getnframes() / wf.getframerate()


def narration(r):
    if r["kind"] == "scene":
        return f"{r['title']}. And here, {r.get('puppet_title', 'one of them')}, as they might have stood there."
    if r["kind"] == "looks":
        return f"{r['title']}. Realistic, then half vaporwave, then fully in the MELEK aesthetic."
    if r["kind"] == "peoples":
        return f"{r['title']}. The ancient world was many peoples. Here is the same scene in each of them."
    return r.get("puppet_title") or r["title"]


# ── render one recipe ──────────────────────────────────────────────────────────────────────────────
def render(r, scenes_by_key, outdir, voice):
    sc = scenes_by_key[r["scene"]]
    pace = PACE[r["pace"]]
    look, people = r["look"], r["people"]
    main = sc["looks"][look][people]
    cap = r["title"] if r["kind"] != "puppet" else r.get("puppet_title", "")
    if r["kind"] == "kenburns":
        shots = [shot_kenburns(main, 6 * pace, r, cap)]
    elif r["kind"] == "looks":
        files = [sc["looks"][l][people] for l in LOOK_ORDER if people in sc["looks"].get(l, {})]
        shots = [shot_sequence(files or [main], 2.6 * pace, r, cap)]
    elif r["kind"] == "peoples":
        files = [sc["looks"][look][p] for p in sorted(sc["looks"][look])]
        shots = [shot_sequence(files, 2.2 * pace, r, cap)]
    elif r["kind"] == "puppet":
        shots = [shot_puppet(r["puppet_src"], 6 * pace, r, cap)]
    else:  # scene
        files = [sc["looks"][l][people] for l in LOOK_ORDER if people in sc["looks"].get(l, {})]
        shots = [shot_kenburns(main, 3.5 * pace, r, r["title"]),
                 shot_puppet(r["puppet_src"], 4.5 * pace, r, r.get("puppet_title", "")),
                 shot_sequence(files or [main], 2.0 * pace, r, "")]
    d = os.path.join(outdir, r["id"])
    os.makedirs(d, exist_ok=True)
    silent = os.path.join(d, "silent.mp4")
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}",
                           "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
                           "-pix_fmt", "yuv420p", "-movflags", "+faststart", silent], stdin=subprocess.PIPE)
    nframes, poster = 0, None
    for fr in chain(shots):
        ff.stdin.write(fr.tobytes())
        nframes += 1
        if nframes == int(1.5 * FPS):
            poster = fr
    ff.stdin.close()
    if ff.wait() != 0:
        raise RuntimeError("ffmpeg failed")
    if poster is not None:
        cv2.imwrite(os.path.join(d, "poster.jpg"), poster, [cv2.IMWRITE_JPEG_QUALITY, 82])
    final = os.path.join(d, "clip.mp4")
    r["narration_text"] = narration(r) if r["narrate"] == "yes" else ""
    if r["narration_text"] and voice and os.path.exists(voice):
        wav = os.path.join(d, "say.wav")
        say(r["narration_text"], voice, wav)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", silent, "-i", wav, "-c:v", "copy", "-c:a", "aac",
                        "-b:a", "96k", "-af", "adelay=500|500,apad", "-shortest", "-movflags", "+faststart", final], check=True)
        os.remove(wav); os.remove(silent)
    else:
        os.replace(silent, final)
    r["seconds"] = round(nframes / FPS, 1)
    r["made"] = int(time.time())
    json.dump(r, open(os.path.join(d, "recipe.json"), "w"), indent=1)
    return r


def cmd_make(a):
    rng = random.Random(a.seed)
    scenes, chars = gather(a.root)
    if not scenes:
        sys.exit("no remakes found")
    fb = None
    if a.feedback and os.path.exists(a.feedback):
        fb = json.load(open(a.feedback))
    stats = arm_stats(a.out, fb)
    os.makedirs(a.out, exist_ok=True)
    by_key = {s["key"]: s for s in scenes}
    ok = 0
    for r in plan(scenes, chars, stats, a.n, rng):
        t0 = time.time()
        try:
            render(r, by_key, a.out, a.voice)
            ok += 1
            print(f"{r['id']} {r['kind']:8} {r['motion']:9} {r['amplitude']:6} {r['camera']:9} {r['seconds']}s  {time.time() - t0:.0f}s  {r['title'][:50]}", flush=True)
        except Exception as e:
            print(f"FAILED {r['kind']} {r['scene']}: {e}", flush=True)
    print(f"made {ok}/{a.n} clips  ({len(scenes)} scenes, {len(chars)} posed characters available)")


def cmd_publish(a):
    """copy clips + posters + a manifest into a bundle for the web host (the Studio serves it at /animations)"""
    import shutil
    os.makedirs(a.bundle, exist_ok=True)
    clips = []
    for rf in sorted(glob.glob(f"{a.out}/*/recipe.json")):
        r = json.load(open(rf))
        d = os.path.dirname(rf)
        if not os.path.exists(f"{d}/clip.mp4"):
            continue
        od = os.path.join(a.bundle, r["id"])
        os.makedirs(od, exist_ok=True)
        for f in ("clip.mp4", "poster.jpg"):
            if os.path.exists(f"{d}/{f}"):
                shutil.copy2(f"{d}/{f}", f"{od}/{f}")
        pub = {k: r.get(k) for k in ("id", "kind", "motion", "amplitude", "camera", "pace", "narrate", "scene", "title",
                                      "group", "look", "people", "puppet_title", "narration_text", "seconds", "made")}
        clips.append(pub)
    clips.sort(key=lambda c: -(c.get("made") or 0))
    json.dump({"updated": int(time.time()), "arms": ARMS, "clips": clips}, open(os.path.join(a.bundle, "manifest.json"), "w"))
    print(f"{len(clips)} clips -> {a.bundle}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    m = sp.add_parser("make")
    m.add_argument("--root", default="/opt/melek-gen")
    m.add_argument("--out", default="/opt/melek-gen/anims")
    m.add_argument("--n", type=int, default=12)
    m.add_argument("--feedback")
    m.add_argument("--voice", default="/opt/melek-gen/voices/en_GB-alba-medium.onnx")
    m.add_argument("--seed", type=int)
    p = sp.add_parser("publish")
    p.add_argument("--out", default="/opt/melek-gen/anims")
    p.add_argument("--bundle", default="/opt/melek-gen/anims_bundle")
    a = ap.parse_args()
    cmd_make(a) if a.cmd == "make" else cmd_publish(a)
