"""cutout_anim.py — cutout animation of the people in our remakes (the Flash / South-Park technique, automated).

For every person the annotator found in a remake (<img>.annot.json, openpose body keypoints), the figure is cut
into parts — head, upper arms, forearms (+hands), thighs, shins (+feet) — along its own bones. The places those
parts leave are inpainted on the background plate, then each part is re-composited every frame, rotated about its
joint through a 2-level bone chain (shoulder → elbow, hip → knee). Each person gets their own gesture and timing:
waving, talking with their hands, a nod and head turn, raised arms, a step in place. The limbs visibly move; the
camera stays still.

  python cutout_anim.py <img.png> out.mp4 [--secs 6] [--seed 1]

Pure numpy/OpenCV + ffmpeg. Needs the annotator's .annot.json beside the image.
"""
import argparse, json, math, os, random, subprocess, sys

import cv2
import numpy as np

W, H, FPS = 960, 540, 24
GESTURES = ("wave", "talk", "nod_turn", "raise", "step", "idle")


def load_people(png, scale):
    try:
        d = json.load(open(png[:-4] + ".annot.json"))
    except Exception:
        return []
    out = []
    for p in d.get("people", []):
        b = p.get("body", {})
        pts = {k: np.array([v["x"], v["y"]], float) * scale for k, v in b.items() if v and v.get("x", -1) >= 0 and v.get("y", -1) >= 0}
        if "neck" in pts and ("r_shoulder" in pts or "l_shoulder" in pts):
            out.append(pts)
    return out


def capsule(shape, a, b, r):
    m = np.zeros(shape, np.uint8)
    cv2.line(m, tuple(int(v) for v in a), tuple(int(v) for v in b), 255, max(1, int(2 * r)), cv2.LINE_AA)
    cv2.circle(m, tuple(int(v) for v in a), int(r), 255, -1, cv2.LINE_AA)
    cv2.circle(m, tuple(int(v) for v in b), int(r), 255, -1, cv2.LINE_AA)
    return m


def extend(a, b, k):
    return b + (b - a) * k


def build_rig(img, pts):
    """→ list of parts {name, mask, pivot, parent} for one person, or []"""
    sh = img.shape[:2]
    neck = pts["neck"]
    shw = np.linalg.norm(pts["r_shoulder"] - pts["l_shoulder"]) if "r_shoulder" in pts and "l_shoulder" in pts else 40.0
    r = max(3.0, shw * 0.17)
    parts = []
    head_c = pts.get("nose", neck + np.array([0, -shw * 0.5]))
    hr = max(6.0, np.linalg.norm(head_c - neck) * 1.05)
    hm = np.zeros(sh, np.uint8)
    cv2.circle(hm, tuple(int(v) for v in head_c), int(hr), 255, -1, cv2.LINE_AA)
    parts.append({"name": "head", "mask": hm, "pivot": neck.copy(), "parent": None})
    for s in ("r", "l"):
        S, E, Wr = pts.get(f"{s}_shoulder"), pts.get(f"{s}_elbow"), pts.get(f"{s}_wrist")
        if S is not None and E is not None:
            parts.append({"name": f"{s}_uarm", "mask": capsule(sh, S, E, r), "pivot": S.copy(), "parent": None})
            if Wr is not None:
                parts.append({"name": f"{s}_farm", "mask": capsule(sh, E, extend(E, Wr, 0.3), r * 0.85), "pivot": E.copy(), "parent": f"{s}_uarm"})
        Hp, K, A = pts.get(f"{s}_hip"), pts.get(f"{s}_knee"), pts.get(f"{s}_ankle")
        if Hp is not None and K is not None:
            parts.append({"name": f"{s}_thigh", "mask": capsule(sh, Hp, K, r * 1.15), "pivot": Hp.copy(), "parent": None})
            if A is not None:
                parts.append({"name": f"{s}_shin", "mask": capsule(sh, K, extend(K, A, 0.18), r), "pivot": K.copy(), "parent": f"{s}_thigh"})
    return parts


def angles(g, t, ph, amp):
    """per-part rotation (degrees) for a gesture at time t."""
    s = lambda f, a=1.0: a * math.sin(2 * math.pi * f * t + ph)
    A = {}
    if g == "wave":
        A["r_uarm"] = -110 * amp * min(1, t / 0.6)
        A["r_farm"] = -20 + s(1.6, 35 * amp)
        A["head"] = s(0.4, 6)
    elif g == "talk":
        A["r_farm"] = -35 + s(0.9, 25 * amp)
        A["l_farm"] = 30 + s(0.7, 20 * amp)
        A["r_uarm"] = -15 + s(0.5, 8)
        A["head"] = s(1.3, 7 * amp)
    elif g == "nod_turn":
        A["head"] = s(0.5, 14 * amp)
        A["r_uarm"] = s(0.3, 6)
    elif g == "raise":
        k = 0.5 - 0.5 * math.cos(min(math.pi, t * 1.4))
        A["r_uarm"] = -150 * amp * k
        A["l_uarm"] = 150 * amp * k
        A["r_farm"] = s(0.8, 10)
        A["l_farm"] = -s(0.8, 10)
        A["head"] = -8 * k
    elif g == "step":
        A["r_thigh"] = s(0.9, 16 * amp)
        A["l_thigh"] = -s(0.9, 16 * amp)
        A["r_shin"] = abs(s(0.9, 20 * amp))
        A["l_shin"] = abs(s(0.9, 20 * amp))
        A["r_uarm"] = -s(0.9, 18 * amp)
        A["l_uarm"] = s(0.9, 18 * amp)
    else:  # idle: breathing, small hand drift
        A["head"] = s(0.25, 4)
        A["r_farm"] = s(0.35, 6)
        A["l_farm"] = -s(0.3, 6)
    return A


def rot(p, deg):
    return cv2.getRotationMatrix2D((float(p[0]), float(p[1])), -deg, 1.0)  # + deg = clockwise on screen


def compose(M2, M1):
    """M2 ∘ M1 for 2×3 affine matrices."""
    a = np.vstack([M1, [0, 0, 1]])
    b = np.vstack([M2, [0, 0, 1]])
    return (b @ a)[:2]


def fit(im):
    h, w = im.shape[:2]
    s = min(W / w, H / h)
    return s


def render(png, out, secs=6.0, seed=1, amp=1.0):
    src = cv2.imread(png)
    if src is None:
        return None
    s = min(1.0, 1400 / max(src.shape[:2]))  # work at ≤1400 px
    img = cv2.resize(src, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s < 1 else src.copy()
    people = load_people(png, s)
    if not people:
        return None
    rng = random.Random(seed)
    rigs = []
    for pts in people:
        parts = build_rig(img, pts)
        if parts:
            rigs.append({"parts": parts, "g": rng.choice(GESTURES[:5]) if rng.random() < 0.85 else "idle",
                         "ph": rng.uniform(0, 6.28), "amp": amp * rng.uniform(0.7, 1.1), "delay": rng.uniform(0, 1.2)})
    if not rigs:
        return None
    # background plate: inpaint wherever a moving part used to be (dilated so edges don't ghost)
    hole = np.zeros(img.shape[:2], np.uint8)
    for rg in rigs:
        for p in rg["parts"]:
            hole |= p["mask"]
    hole = cv2.dilate(hole, np.ones((7, 7), np.uint8))
    plate = cv2.inpaint(img, hole, 9, cv2.INPAINT_TELEA)
    # feathered RGBA for each part
    for rg in rigs:
        for p in rg["parts"]:
            a = cv2.GaussianBlur(p["mask"], (0, 0), 1.2).astype(np.float32) / 255.0
            p["rgb"] = img.astype(np.float32)
            p["a"] = a
    h, w = img.shape[:2]
    fs = min(W / w, H / h)
    bg = cv2.GaussianBlur(cv2.resize(img, (W, H)), (0, 0), 18) * 0.45
    n = int(secs * FPS)
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS),
                             "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
                             "-movflags", "+faststart", out], stdin=subprocess.PIPE)
    order = ("l_thigh", "l_shin", "r_thigh", "r_shin", "l_uarm", "l_farm", "head", "r_uarm", "r_farm")
    poster = None
    for i in range(n):
        t = i / FPS
        frame = plate.astype(np.float32)
        for rg in rigs:
            tt = max(0.0, t - rg["delay"])
            A = angles(rg["g"], tt, rg["ph"], rg["amp"])
            M = {}
            parts = {p["name"]: p for p in rg["parts"]}
            for name in order:
                p = parts.get(name)
                if not p:
                    continue
                Mp = M.get(p["parent"]) if p["parent"] else None
                piv = p["pivot"]
                if Mp is not None:
                    piv = Mp @ np.array([piv[0], piv[1], 1.0])
                own = rot(piv, A.get(name, 0.0))
                Mi = compose(own, Mp) if Mp is not None else own
                M[name] = Mi
                if abs(A.get(name, 0.0)) < 0.05 and Mp is None:
                    continue  # unmoved part: already on the plate? no — plate is inpainted, so draw it anyway
            for name in order:
                p = parts.get(name)
                if not p:
                    continue
                Mi = M[name]
                rgb = cv2.warpAffine(p["rgb"], Mi, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
                a = cv2.warpAffine(p["a"], Mi, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)[..., None]
                frame = frame * (1 - a) + rgb * a
        fg = cv2.resize(frame.astype(np.uint8), (int(w * fs), int(h * fs)), interpolation=cv2.INTER_AREA)
        canvas = bg.astype(np.uint8).copy()
        y0, x0 = (H - fg.shape[0]) // 2, (W - fg.shape[1]) // 2
        canvas[y0:y0 + fg.shape[0], x0:x0 + fg.shape[1]] = fg
        proc.stdin.write(canvas.tobytes())
        if i == int(2.5 * FPS):
            poster = canvas
    proc.stdin.close()
    if proc.wait() != 0:
        return None
    if poster is not None:
        cv2.imwrite(os.path.splitext(out)[0] + ".jpg", poster, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("img")
    ap.add_argument("out")
    ap.add_argument("--secs", type=float, default=6.0)
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    r = render(a.img, a.out, a.secs, a.seed)
    print(r or "FAILED")
    sys.exit(0 if r else 1)
