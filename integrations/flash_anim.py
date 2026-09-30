"""flash_anim.py — Flash-style 2D keyframed animation, rendered headless on our own CPU.

Real animation, not camera moves: rigged figures with bones (pelvis → spine → neck → head, shoulders → upper arm →
forearm, hips → thigh → shin), poses keyframed and tweened with easing, procedural cycles (walk, run, row, haul,
march, cheer), choreographed fights with motion trails, impact flashes and camera shake, and props that move with
the figures (sledge and stone block, boat and oars, spears and shields). Flat colours and thick outlines — the
Xiao Xiao / Animator-vs-Animation stick-figure look — drawn in OpenCV at 2× and downsampled for smooth edges.

  python flash_anim.py render <scene.json|builtin-name> out.mp4
  python flash_anim.py builtins                      # list built-in scenes
  python flash_anim.py all <outdir>                  # render every built-in scene

A scene description is JSON: {"scene": "fight"|"pyramid"|"rowing"|"march_map"|"crowd"|"walk_run", "secs": 12,
"title": "...", "caption": "...", "seed": 1, ...scene options}. Pure numpy/OpenCV/PIL + ffmpeg. No GPU, no API.
"""
import json, math, os, random, subprocess, sys

import cv2
import numpy as np

W, H, FPS = 960, 540, 24
SS = 2  # supersampling
FONT = os.environ.get("FLASH_FONT", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")

# bone lengths as a fraction of figure height
L = {"torso": 0.30, "neck": 0.05, "head": 0.075, "uarm": 0.16, "farm": 0.15, "thigh": 0.21, "shin": 0.21}
JOINTS = ("spine", "neck", "lsh", "lel", "rsh", "rel", "lhip", "lkn", "rhip", "rkn")


def ease(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def lerp_pose(a, b, t):
    return {k: a.get(k, 0.0) + (b.get(k, 0.0) - a.get(k, 0.0)) * t for k in set(a) | set(b)}


# ── poses (degrees; limb 0 = hanging straight down, + = toward the way the figure faces) ──────────────
POSES = {
    "stand": {"spine": 0, "neck": 0, "lsh": -6, "lel": 8, "rsh": 6, "rel": 8, "lhip": -3, "lkn": 0, "rhip": 3, "rkn": 0},
    "guard": {"spine": 6, "neck": -4, "lsh": 55, "lel": 95, "rsh": 30, "rel": 120, "lhip": 18, "lkn": 12, "rhip": -16, "rkn": 10},
    "punch": {"spine": 14, "neck": -6, "lsh": 60, "lel": 100, "rsh": 92, "rel": 2, "lhip": 20, "lkn": 10, "rhip": -22, "rkn": 6},
    "kick": {"spine": -18, "neck": 6, "lsh": 40, "lel": 90, "rsh": -30, "rel": 60, "lhip": -6, "lkn": 6, "rhip": 95, "rkn": 0},
    "block": {"spine": -6, "neck": 6, "lsh": 100, "lel": 150, "rsh": 70, "rel": 140, "lhip": 10, "lkn": 18, "rhip": -12, "rkn": 16},
    "hit": {"spine": -28, "neck": 18, "lsh": -40, "lel": 30, "rsh": -60, "rel": 20, "lhip": 14, "lkn": 20, "rhip": -10, "rkn": 30},
    "down": {"spine": -80, "neck": 10, "lsh": -120, "lel": 10, "rsh": -100, "rel": 20, "lhip": 60, "lkn": 20, "rhip": 40, "rkn": 40},
    "cheer": {"spine": 0, "neck": -8, "lsh": 165, "lel": 10, "rsh": 170, "rel": 12, "lhip": -4, "lkn": 0, "rhip": 4, "rkn": 0},
    "haul": {"spine": -24, "neck": 10, "lsh": 70, "lel": 10, "rsh": 76, "rel": 14, "lhip": 22, "lkn": 26, "rhip": -18, "rkn": 8},
    "sit_row_in": {"spine": 38, "neck": -10, "lsh": 88, "lel": 4, "rsh": 84, "rel": 6, "lhip": 90, "lkn": 110, "rhip": 90, "rkn": 110},
    "sit_row_out": {"spine": -22, "neck": 6, "lsh": 40, "lel": 95, "rsh": 36, "rel": 100, "lhip": 90, "lkn": 40, "rhip": 90, "rkn": 40},
}


def walk_pose(phase, run=False):
    """procedural gait; phase in cycles."""
    p = 2 * math.pi * phase
    A = 40 if run else 24
    pose = {"spine": 12 if run else 3, "neck": -6 if run else 0}
    for side, off in (("l", 0.0), ("r", math.pi)):
        s = math.sin(p + off)
        pose[side + "hip"] = A * s
        # knee bends while the leg swings forward (and at push-off)
        pose[side + "kn"] = (70 if run else 38) * max(0.0, math.sin(p + off - 0.9)) + 4
        arm = -A * 0.9 * s
        pose[("r" if side == "l" else "l") + "sh"] = arm
        pose[("r" if side == "l" else "l") + "el"] = (95 if run else 22) + 10 * s
    return pose


def march_pose(phase):
    p = walk_pose(phase)
    p["spine"] = 0
    p["rsh"], p["rel"] = 20, 110  # spear hand held up
    p["lsh"], p["lel"] = 30, 80   # shield arm
    return p


# ── forward kinematics ─────────────────────────────────────────────────────────────────────────────
def _dir(deg):
    """unit vector for angle measured from straight DOWN, + rotating toward +x (screen)."""
    r = math.radians(deg)
    return np.array([math.sin(r), math.cos(r)])


def fk(pose, x, y, h, face=1):
    """→ dict of joint pixel positions. (x, y) is the pelvis; h = figure height in px; face = +1 right / -1 left."""
    g = lambda k: pose.get(k, 0.0) * face
    J = {"pelvis": np.array([x, y], float)}
    up = -_dir(g("spine"))  # spine angle: 0 = upright, + = lean forward
    J["chest"] = J["pelvis"] + up * L["torso"] * h
    nd = -_dir(g("spine") + g("neck"))
    J["neck"] = J["chest"] + nd * L["neck"] * h
    J["head"] = J["neck"] + nd * L["head"] * h
    sp = g("spine")
    for s in ("l", "r"):
        sh = J["chest"] + up * (-0.02 * h)
        J[s + "sh"] = sh
        J[s + "el"] = sh + _dir(sp + g(s + "sh")) * L["uarm"] * h
        J[s + "ha"] = J[s + "el"] + _dir(sp + g(s + "sh") + g(s + "el")) * L["farm"] * h
        J[s + "kn"] = J["pelvis"] + _dir(g(s + "hip")) * L["thigh"] * h
        J[s + "ft"] = J[s + "kn"] + _dir(g(s + "hip") - g(s + "kn")) * L["shin"] * h
    return J


def foot_ground(pose, h):
    """how far below the pelvis the lowest foot sits (so figures stand on the ground)."""
    J = fk(pose, 0, 0, h)
    return max(J["lft"][1], J["rft"][1])


# ── drawing ────────────────────────────────────────────────────────────────────────────────────────
def P(p):
    return (int(round(p[0] * SS)), int(round(p[1] * SS)))


def limb(img, a, b, w, col, outline=(20, 20, 20)):
    cv2.line(img, P(a), P(b), outline, int((w + 3) * SS), cv2.LINE_AA)
    cv2.line(img, P(a), P(b), col, int(w * SS), cv2.LINE_AA)


def draw_figure(img, J, h, col=(30, 30, 30), far_col=None, prop=None):
    """flat stick figure: far limbs darker, near limbs in front; optional hand prop."""
    w = max(3.0, h * 0.045)
    far = far_col or tuple(int(c * 0.6) for c in col)
    for s, c in (("l", far), ("r", col)):
        if s == "r":
            limb(img, J["pelvis"], J["chest"], w * 1.25, col)
        limb(img, J["pelvis"], J[s + "kn"], w, c); limb(img, J[s + "kn"], J[s + "ft"], w, c)
        limb(img, J[s + "sh"], J[s + "el"], w * 0.9, c); limb(img, J[s + "el"], J[s + "ha"], w * 0.9, c)
    limb(img, J["chest"], J["neck"], w, col)
    r = int(L["head"] * h * SS)
    cv2.circle(img, P(J["head"]), r + int(1.5 * SS), (20, 20, 20), -1, cv2.LINE_AA)
    cv2.circle(img, P(J["head"]), r, col, -1, cv2.LINE_AA)
    if prop == "spear":
        a = J["rha"] + np.array([0, h * 0.35]); b = J["rha"] - np.array([0, h * 0.55])
        cv2.line(img, P(a), P(b), (40, 70, 110), int(2.5 * SS), cv2.LINE_AA)
        tip = b - np.array([0, h * 0.06])
        cv2.fillConvexPoly(img, np.array([P(b + np.array([-h * 0.02, 0])), P(b + np.array([h * 0.02, 0])), P(tip)]), (200, 200, 210), cv2.LINE_AA)
    if prop == "shield":
        cv2.circle(img, P(J["lha"]), int(h * 0.11 * SS), (20, 20, 20), -1, cv2.LINE_AA)
        cv2.circle(img, P(J["lha"]), int(h * 0.1 * SS), (40, 110, 190), -1, cv2.LINE_AA)


def shadow(img, x, y, h):
    ov = img.copy()
    cv2.ellipse(ov, P((x, y)), (int(h * 0.16 * SS), int(h * 0.03 * SS)), 0, 0, 360, (0, 0, 0), -1, cv2.LINE_AA)
    cv2.addWeighted(ov, 0.25, img, 0.75, 0, img)


def sky(top, bot, horizon=0.7):
    img = np.zeros((H * SS, W * SS, 3), np.uint8)
    for yy in range(H * SS):
        t = min(1.0, yy / (H * SS * horizon))
        img[yy] = [int(top[i] + (bot[i] - top[i]) * t) for i in range(3)]
    return img


def caption(frame, text, sub=""):
    if not text and not sub:
        return frame
    from PIL import Image, ImageDraw, ImageFont
    im = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(im)
    if text:
        f = ImageFont.truetype(FONT, 24)
        tw = d.textlength(text, font=f)
        d.rectangle([0, H - 50, W, H], fill=(0, 0, 0))
        d.text(((W - tw) / 2, H - 40), text, font=f, fill=(245, 220, 150))
    if sub:
        f2 = ImageFont.truetype(FONT, 15)
        d.text((12, 10), sub, font=f2, fill=(255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0))
    return cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)


def finish(img, shake=(0, 0)):
    f = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
    if shake != (0, 0):
        M = np.float32([[1, 0, shake[0]], [0, 1, shake[1]]])
        f = cv2.warpAffine(f, M, (W, H), borderMode=cv2.BORDER_REPLICATE)
    return f


# ── scenes ─────────────────────────────────────────────────────────────────────────────────────────
def scene_walk_run(o):
    """a figure walks in, breaks into a run, leaps, lands and cheers."""
    n = int(o.get("secs", 8) * FPS)
    h = 200
    gy = 440
    x = -60.0
    for i in range(n):
        t = i / FPS
        img = sky((235, 225, 205), (250, 245, 235))
        cv2.rectangle(img, (0, gy * SS), (W * SS, H * SS), (180, 205, 215), -1)
        if t < 3:
            pose, x = walk_pose(t * 1.1), x + 3.2
            jump = 0
        elif t < 5.5:
            pose, x = walk_pose(t * 1.9, run=True), x + 7.5
            jump = 0
        elif t < 6.3:
            k = (t - 5.5) / 0.8
            pose = lerp_pose(POSES["kick"], {**POSES["cheer"], "lhip": 40, "lkn": 80, "rhip": 70, "rkn": 60}, ease(k))
            x += 6
            jump = math.sin(math.pi * k) * 120
        else:
            k = min(1, (t - 6.3) / 0.5)
            pose = lerp_pose(POSES["stand"], POSES["cheer"], ease(k))
            pose["lsh"] += 10 * math.sin(t * 12); pose["rsh"] -= 10 * math.sin(t * 12)
            jump = abs(math.sin(t * 6)) * 14 * k
        y = gy - foot_ground(pose, h) - jump
        shadow(img, x, gy, h * (1 - jump / 300))
        draw_figure(img, fk(pose, x, y, h), h, (25, 25, 25))
        yield caption(finish(img), o.get("caption", ""), o.get("title", ""))


def scene_fight(o):
    """two stick figures: exchange, block, kick, knock-down — trails, impact flashes, shake."""
    n = int(o.get("secs", 10) * FPS)
    h, gy = 210, 450
    beats = [  # (time, A pose, B pose, A dx, B dx, impact-on)
        (0.0, "stand", "stand", 0, 0, None), (0.8, "guard", "guard", 0, 0, None),
        (1.6, "guard", "guard", 60, -60, None), (2.0, "punch", "block", 80, -60, "B"),
        (2.4, "guard", "guard", 70, -55, None), (3.0, "hit", "punch", 40, -40, "A"),
        (3.4, "guard", "guard", 30, -30, None), (4.2, "kick", "guard", 60, -30, None),
        (4.5, "kick", "hit", 70, 20, "B"), (5.0, "guard", "hit", 60, 60, None),
        (5.6, "guard", "guard", 60, 10, None), (6.2, "block", "kick", 40, 40, "A"),
        (6.8, "punch", "hit", 110, 70, "B"), (7.6, "guard", "down", 110, 160, None),
        (9.0, "cheer", "down", 110, 160, None), (99, "cheer", "down", 110, 160, None)]
    trail = {"A": [], "B": []}
    for i in range(n):
        t = i / FPS
        k = max(j for j in range(len(beats)) if beats[j][0] <= t)
        b0, b1 = beats[k], beats[min(k + 1, len(beats) - 1)]
        u = ease((t - b0[0]) / max(1e-6, b1[0] - b0[0]))
        img = sky((60, 40, 30), (150, 120, 90))
        cv2.rectangle(img, (0, gy * SS), (W * SS, H * SS), (70, 80, 90), -1)
        shake = (0, 0)
        for who, face, base_x, col, pi, di in (("A", 1, 330, (40, 40, 200), 1, 3), ("B", -1, 630, (30, 30, 30), 2, 4)):
            pose = lerp_pose(POSES[b0[pi]], POSES[b1[pi]], u)
            if b0[pi] == "guard" and b1[pi] == "guard":
                pose["spine"] += 3 * math.sin(t * 9)
            x = base_x + b0[di] + (b1[di] - b0[di]) * u
            y = gy - foot_ground(pose, h)
            J = fk(pose, x, y, h, face)
            # motion trail on fast limbs
            trail[who] = (trail[who] + [J])[-4:]
            for m, TJ in enumerate(trail[who][:-1]):
                a = 0.12 * (m + 1)
                ov = img.copy()
                for s in ("rha", "lha", "rft", "lft"):
                    cv2.line(ov, P(TJ[s]), P(J[s]), (255, 255, 255), int(6 * SS), cv2.LINE_AA)
                cv2.addWeighted(ov, a, img, 1 - a, 0, img)
            shadow(img, x, gy, h)
            draw_figure(img, J, h, col)
            hit_on = b0[5]
            if hit_on == who and t - b0[0] < 0.25:
                c = J["chest"]
                r = (1 - (t - b0[0]) / 0.25) * 60 + 20
                pts = [P(c + np.array([math.cos(q) * r * (1.0 if j % 2 else 0.45), math.sin(q) * r * (1.0 if j % 2 else 0.45)]))
                       for j, q in enumerate(np.linspace(0, 2 * math.pi, 17)[:-1])]
                cv2.fillPoly(img, [np.array(pts)], (80, 230, 255), cv2.LINE_AA)
                shake = (random.uniform(-6, 6), random.uniform(-4, 4))
        yield caption(finish(img, shake), o.get("caption", ""), o.get("title", ""))


def scene_pyramid(o):
    """a gang hauls a stone block on a sledge up to the pyramid; one pours water on the sand in front (as painted in
    the tomb of Djehutihotep)."""
    n = int(o.get("secs", 12) * FPS)
    h, gy = 120, 470
    crew = int(o.get("crew", 8))
    for i in range(n):
        t = i / FPS
        img = sky((200, 170, 120), (170, 215, 240), 0.8)
        # pyramid in the distance, courses rising
        px, pw, ph = 690, 420, 260
        cv2.fillConvexPoly(img, np.array([P((px - pw / 2, gy)), P((px + pw / 2, gy)), P((px, gy - ph))]), (120, 175, 205), cv2.LINE_AA)
        for c in range(1, 12):
            yy = gy - ph * c / 12
            half = pw / 2 * (1 - c / 12)
            cv2.line(img, P((px - half, yy)), P((px + half, yy)), (100, 150, 180), int(1 * SS), cv2.LINE_AA)
        cv2.rectangle(img, (0, gy * SS), (W * SS, H * SS), (140, 190, 220), -1)
        adv = t * 14  # the whole gang creeps forward
        # block + sledge
        bx = 120 + adv
        cv2.rectangle(img, P((bx - 70, gy - 12)), P((bx + 70, gy)), (40, 70, 110), -1)
        cv2.rectangle(img, P((bx - 60, gy - 92)), P((bx + 60, gy - 12)), (150, 190, 215), -1)
        cv2.rectangle(img, P((bx - 60, gy - 92)), P((bx + 60, gy - 12)), (60, 90, 120), int(2 * SS))
        # rope
        lead = bx + 90 + crew * 42
        cv2.line(img, P((bx + 70, gy - 10)), P((lead, gy - 58)), (60, 110, 160), int(3 * SS), cv2.LINE_AA)
        for j in range(crew):
            x = bx + 110 + j * 42
            ph_ = t * 0.8 + j * 0.13
            pose = lerp_pose(POSES["haul"], walk_pose(ph_), 0.35)
            pose["spine"] = 28 + 6 * math.sin(2 * math.pi * ph_)  # lean into the pull, rope over the shoulder
            pose["lsh"], pose["rsh"] = -35, -20
            pose["lel"], pose["rel"] = 70, 60
            y = gy - foot_ground(pose, h)
            J = fk(pose, x, y, h, face=-1 if False else 1)
            # hands on the rope
            shadow(img, x, gy, h)
            draw_figure(img, J, h, (40, 60, 120))
        # the water-pourer walks in front of the sledge, tipping a jar
        wx = bx + 88
        pose = dict(POSES["stand"]); pose["spine"] = 18; pose["rsh"] = 70 + 20 * math.sin(t * 3); pose["rel"] = 40
        J = fk(pose, wx, gy - foot_ground(pose, h), h, face=-1)
        draw_figure(img, J, h, (30, 30, 30))
        jar = J["rha"]
        cv2.ellipse(img, P(jar), (int(9 * SS), int(12 * SS)), 30, 0, 360, (70, 120, 170), -1, cv2.LINE_AA)
        for d in range(6):
            yy = jar[1] + 10 + ((t * 120 + d * 12) % 60)
            cv2.circle(img, P((jar[0] - 6 + d % 2 * 3, yy)), int(2 * SS), (230, 200, 120), -1, cv2.LINE_AA)
        yield caption(finish(img), o.get("caption", ""), o.get("title", ""))


def scene_rowing(o):
    """a crew rows a ship across the water: oars dip and sweep, the hull lifts on the swell."""
    n = int(o.get("secs", 10) * FPS)
    h = 110
    rowers = int(o.get("rowers", 7))
    for i in range(n):
        t = i / FPS
        img = sky((210, 160, 110), (235, 210, 190), 0.55)
        wl = 360
        cv2.rectangle(img, (0, wl * SS), (W * SS, H * SS), (140, 100, 40), -1)
        for k in range(14):
            yy = wl + 8 + k * 13
            pts = [P((xx, yy + 3 * math.sin(xx * 0.03 + t * 2 + k))) for xx in range(0, W + 20, 20)]
            cv2.polylines(img, [np.array(pts)], False, (170, 130, 70), int(1 * SS), cv2.LINE_AA)
        bx = -200 + t * 70
        bob = 4 * math.sin(t * 1.7)
        deck = wl - 18 + bob
        hull = [(bx - 40, deck - 20), (bx + 430, deck - 20), (bx + 380, deck + 34), (bx + 20, deck + 34)]
        stroke = (t * 0.55) % 1.0
        catch = 0.5 - 0.5 * math.cos(2 * math.pi * stroke)
        for j in range(rowers):
            x = bx + 40 + j * 50
            pose = lerp_pose(POSES["sit_row_in"], POSES["sit_row_out"], catch)
            J = fk(pose, x, deck - 26, h, face=-1)
            draw_figure(img, J, h, (30, 30, 30))
            # oar: pivots at the gunwale, handle in the hands, blade dips on the drive
            piv = np.array([x - 8, deck - 16])
            hand = J["rha"]
            v = piv - hand
            v = v / (np.linalg.norm(v) + 1e-6)
            blade = piv + v * 150 + np.array([0, 30 * (1 - catch)])
            cv2.line(img, P(hand), P(blade), (40, 80, 130), int(3 * SS), cv2.LINE_AA)
            cv2.ellipse(img, P(blade), (int(10 * SS), int(4 * SS)), math.degrees(math.atan2(v[1], v[0])), 0, 360, (40, 80, 130), -1, cv2.LINE_AA)
            if blade[1] > wl and 0.2 < catch < 0.9:
                cv2.ellipse(img, P((blade[0], wl + 4)), (int(16 * SS), int(3 * SS)), 0, 0, 360, (230, 220, 210), int(1 * SS), cv2.LINE_AA)
        cv2.fillConvexPoly(img, np.array([P(p) for p in hull]), (40, 70, 120), cv2.LINE_AA)
        cv2.line(img, P((bx + 430, deck - 20)), P((bx + 470, deck - 70)), (40, 70, 120), int(8 * SS), cv2.LINE_AA)  # prow
        cv2.line(img, P((bx + 200, deck - 20)), P((bx + 200, deck - 190)), (30, 50, 80), int(4 * SS), cv2.LINE_AA)  # mast
        sail = [(bx + 130, deck - 180 + 4 * math.sin(t)), (bx + 270, deck - 180), (bx + 262, deck - 70), (bx + 138, deck - 70 + 3 * math.sin(t))]
        cv2.fillConvexPoly(img, np.array([P(p) for p in sail]), (225, 235, 240), cv2.LINE_AA)
        yield caption(finish(img), o.get("caption", ""), o.get("title", ""))


def _land(seed):
    rng = np.random.default_rng(seed)
    cx, cy = W * 0.55, H * 0.55
    ang = np.linspace(0, 2 * np.pi, 90, endpoint=False)
    r = 230 + np.convolve(rng.normal(0, 38, 90), np.ones(7) / 7, "same")
    return np.stack([cx + np.cos(ang) * r * 1.5, cy + np.sin(ang) * r * 0.75], 1)


def scene_march_map(o):
    """a column of soldiers marches along a route on a parchment map, the year ticking in the corner."""
    n = int(o.get("secs", 12) * FPS)
    land = _land(o.get("seed", 3))
    route = np.array(o.get("route", [[120, 400], [300, 330], [470, 360], [640, 250], [820, 200]]), float)
    seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(route, axis=0), axis=1))]
    y0, y1 = o.get("years", [-218, -216])

    def along(s):
        s = min(max(s, 0), seg[-1])
        k = min(np.searchsorted(seg, s, side="right") - 1, len(route) - 2)
        u = (s - seg[k]) / max(1e-6, seg[k + 1] - seg[k])
        return route[k] + (route[k + 1] - route[k]) * u, route[k + 1] - route[k]

    for i in range(n):
        t = i / max(1, n - 1)
        img = np.full((H * SS, W * SS, 3), (180, 215, 235), np.uint8)
        cv2.fillPoly(img, [np.array([P(p) for p in land])], (150, 195, 215), cv2.LINE_AA)
        cv2.polylines(img, [np.array([P(p) for p in land])], True, (90, 120, 140), int(2 * SS), cv2.LINE_AA)
        for k in range(len(route) - 1):
            a, b = route[k], route[k + 1]
            for q in np.linspace(0, 1, 18):
                cv2.circle(img, P(a + (b - a) * q), int(2 * SS), (60, 60, 150), -1, cv2.LINE_AA)
        head = seg[-1] * ease(t)
        for j in range(int(o.get("soldiers", 14))):
            s = head - j * 13
            if s < 0:
                continue
            p, d = along(s)
            face = 1 if d[0] >= 0 else -1
            pose = march_pose(i / FPS * 1.6 + j * 0.07)
            hh = 34
            J = fk(pose, p[0], p[1] - foot_ground(pose, hh), hh, face)
            draw_figure(img, J, hh, (40, 40, 160), prop="spear")
        year = int(round(y0 + (y1 - y0) * ease(t)))
        yield caption(finish(img), o.get("caption", ""), f"{o.get('title', '')}   {abs(year)} {'BC' if year < 0 else 'AD'}")


def scene_crowd(o):
    """a crowd waits, then erupts — each figure on its own phase and timing."""
    n = int(o.get("secs", 8) * FPS)
    rng = random.Random(o.get("seed", 7))
    people = [(rng.uniform(40, W - 40), rng.uniform(360, 500), rng.uniform(0.6, 1.0), rng.random(), rng.uniform(2.0, 4.5),
               rng.choice([(30, 30, 30), (40, 40, 180), (40, 120, 60), (140, 60, 40)])) for _ in range(int(o.get("n", 26)))]
    people.sort(key=lambda p: p[1])
    for i in range(n):
        t = i / FPS
        img = sky((120, 90, 60), (200, 170, 140), 0.6)
        cv2.rectangle(img, (0, 330 * SS), (W * SS, H * SS), (110, 140, 160), -1)
        for x, y, s, ph, go, col in people:
            h = 150 * s
            if t < go:
                pose = lerp_pose(POSES["stand"], walk_pose(t * 0.3 + ph), 0.15)
                hop = 0
            else:
                k = ease((t - go) / 0.4)
                pose = lerp_pose(POSES["stand"], POSES["cheer"], k)
                pose["lsh"] += 12 * math.sin(t * 11 + ph * 6); pose["rsh"] -= 12 * math.sin(t * 11 + ph * 6)
                hop = abs(math.sin(t * 7 + ph * 5)) * 16 * s * k
            J = fk(pose, x, y - foot_ground(pose, h) - hop, h)
            shadow(img, x, y, h)
            draw_figure(img, J, h, col)
        yield caption(finish(img), o.get("caption", ""), o.get("title", ""))


SCENES = {"walk_run": scene_walk_run, "fight": scene_fight, "pyramid": scene_pyramid, "rowing": scene_rowing,
          "march_map": scene_march_map, "crowd": scene_crowd}

BUILTINS = {
    "stick-walk-run": {"scene": "walk_run", "secs": 8, "title": "Stick figure test: walk, run, leap", "caption": "Alpha test: keyframed animation"},
    "stick-fight": {"scene": "fight", "secs": 10, "title": "Stick figure test: the fight", "caption": "Alpha test: tweened fight choreography"},
    "pyramid-haulers": {"scene": "pyramid", "secs": 12, "title": "Hauling a block (after the Djehutihotep painting)", "caption": "Water poured on the sand eases the sledge"},
    "rowing-crew": {"scene": "rowing", "secs": 10, "title": "A crew rows out", "caption": "Alpha test: rowing cycle"},
    "hannibal-march": {"scene": "march_map", "secs": 12, "years": [-218, -216], "title": "Hannibal's march", "caption": "Soldiers on the map — Alpha test"},
    "crowd-cheer": {"scene": "crowd", "secs": 8, "title": "The crowd", "caption": "Alpha test: crowd with independent timing"},
}


def write_mp4(frames, out):
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS),
                          "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
                          "-movflags", "+faststart", out], stdin=subprocess.PIPE)
    poster = None
    for k, f in enumerate(frames):
        p.stdin.write(f.tobytes())
        if k == int(2.5 * FPS):
            poster = f
    p.stdin.close()
    ok = p.wait() == 0
    if ok and poster is not None:
        cv2.imwrite(os.path.splitext(out)[0] + ".jpg", poster, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return ok


def render(desc, out):
    random.seed(desc.get("seed", 1))
    return write_mp4(SCENES[desc["scene"]](desc), out)


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ("render", "builtins", "all"):
        sys.exit(__doc__)
    if sys.argv[1] == "builtins":
        print("\n".join(BUILTINS))
    elif sys.argv[1] == "all":
        od = sys.argv[2]
        os.makedirs(od, exist_ok=True)
        for k, d in BUILTINS.items():
            print(k, render(d, os.path.join(od, k + ".mp4")), flush=True)
    else:
        src = sys.argv[2]
        desc = BUILTINS[src] if src in BUILTINS else json.load(open(src))
        sys.exit(0 if render(desc, sys.argv[3]) else 1)
