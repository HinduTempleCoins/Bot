"""hathor_motion.py — real motion for Hathor's animations (not camera pans).

Three engines, best first; each soft-fails so the caller can fall through to the next:

  i2v       a real image-to-video model (Wan 2.2 / Wan 2.1 / LTX-Video) on a free Hugging Face ZeroGPU Space,
            called with gradio_client. People walk, cloth moves, water flows. A daily budget (I2V_DAILY, default
            24 clips) keeps us inside the free quota; set HF_TOKEN for the larger logged-in quota.
  parallax  2.5D on our own CPU: Depth-Anything-V2-Small estimates depth, the picture is split into depth layers
            that move at different speeds as the camera dollies / orbits, holes are inpainted, and dust / mist
            particles drift between the layers. Near things move against far things — real depth, not a zoom.
  (kenburns stays in hathor_animate.py as the last fallback only.)

  python hathor_motion.py i2v      in.png out.mp4 [--prompt "..."] [--secs 3.5]
  python hathor_motion.py parallax in.png out.mp4 [--secs 6] [--cam dolly_in|orbit_left|orbit_right|crane_up]
  python hathor_motion.py budget
"""
import argparse, json, os, random, shutil, subprocess, sys, time

import cv2
import numpy as np

W, H, FPS = 960, 540, 24
STATE = os.environ.get("MOTION_STATE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "motion_budget.json"))
DAILY = int(os.environ.get("I2V_DAILY", "24"))

# Spaces tried in order. Each entry: (space, endpoint, how to build kwargs, how to find the mp4 in the result).
SPACES = [
    ("zerogpu-aoti/wan2-2-fp8da-aoti-faster", "/generate_video", "wan22"),
    ("multimodalart/wan2-1-fast", "/generate_video", "wan21"),
    ("KingNish/wan2-2-fast", "/generate_video", "wan21"),
    ("Lightricks/ltx-video-distilled", "/image_to_video", "ltx"),
]
NEG = "static, frozen, still image, blurry, distorted faces, extra fingers, deformed limbs, text, watermark, nudity"


# ---------- budget ----------
def _today():
    return time.strftime("%Y-%m-%d", time.gmtime())


def budget_load():
    try:
        b = json.load(open(STATE))
    except Exception:
        b = {}
    if b.get("day") != _today():
        b = {"day": _today(), "used": 0, "fails": 0, "cooldown_until": 0}
    return b


def budget_save(b):
    try:
        json.dump(b, open(STATE, "w"))
    except Exception:
        pass


def budget_ok(b):
    return b["used"] < DAILY and time.time() >= b.get("cooldown_until", 0)


# ---------- i2v ----------
def _find_mp4(r):
    if isinstance(r, str) and r.endswith((".mp4", ".webm")):
        return r
    if isinstance(r, dict):
        for k in ("video", "path", "value"):
            p = _find_mp4(r.get(k))
            if p:
                return p
    if isinstance(r, (list, tuple)):
        for x in r:
            p = _find_mp4(x)
            if p:
                return p
    return None


def i2v(img, out, prompt="make this image come alive, natural motion, cinematic", secs=3.5):
    """→ out path, or None (quota / Space down / no client). Never raises."""
    b = budget_load()
    if not budget_ok(b):
        return None
    try:
        from gradio_client import Client, handle_file
    except Exception:
        return None
    tok = os.environ.get("HF_TOKEN") or None
    for space, ep, kind in SPACES:
        try:
            c = Client(space, hf_token=tok, verbose=False) if tok else Client(space, verbose=False)
            if kind == "wan22":
                r = c.predict(input_image=handle_file(img), prompt=prompt, negative_prompt=NEG, duration_seconds=secs, api_name=ep)
            elif kind == "wan21":
                r = c.predict(input_image=handle_file(img), prompt=prompt, api_name=ep)
            else:
                r = c.predict(prompt=prompt, input_image_filepath=handle_file(img), api_name=ep)
            p = _find_mp4(r)
            if p and os.path.exists(p) and os.path.getsize(p) > 10000:
                shutil.copy(p, out)
                b["used"] += 1
                b.setdefault("by", {})[space] = b.get("by", {}).get(space, 0) + 1
                budget_save(b)
                return out
        except Exception as e:
            msg = str(e).lower()
            b["fails"] += 1
            if "quota" in msg or "exceeded" in msg or "limit" in msg:
                b["cooldown_until"] = time.time() + 3600  # ZeroGPU quota refills over time; back off an hour
                budget_save(b)
                return None
            continue
    budget_save(b)
    return None


# ---------- parallax ----------
_DEPTH = None


def depth_of(im):
    """float32 depth in [0,1], 1 = near. Depth-Anything-V2-Small on CPU; falls back to a vertical gradient."""
    global _DEPTH
    try:
        if _DEPTH is None:
            from transformers import pipeline
            _DEPTH = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device=-1)
        from PIL import Image
        d = np.array(_DEPTH(Image.fromarray(cv2.cvtColor(im, cv2.COLOR_BGR2RGB)))["predicted_depth"].squeeze(), dtype=np.float32)
        d = cv2.resize(d, (im.shape[1], im.shape[0]), interpolation=cv2.INTER_CUBIC)
    except Exception:
        d = np.tile(np.linspace(0, 1, im.shape[0], dtype=np.float32)[:, None], (1, im.shape[1]))
    d = (d - d.min()) / max(1e-6, float(d.max() - d.min()))
    return cv2.GaussianBlur(d, (0, 0), 3)


def fit(im, w, h):
    s = max(w / im.shape[1], h / im.shape[0])
    im = cv2.resize(im, (int(im.shape[1] * s + 0.5), int(im.shape[0] * s + 0.5)), interpolation=cv2.INTER_AREA)
    y, x = (im.shape[0] - h) // 2, (im.shape[1] - w) // 2
    return im[y:y + h, x:x + w]


def ease(t):
    return 0.5 - 0.5 * np.cos(np.pi * t)


def parallax_frames(im, d, n, cam="dolly_in", amp=1.0, seed=0):
    """Yield BGR frames. Backward-warp: out(x) = src(x - shift * depth(x)), depth dilated so near objects keep their
    silhouettes; the disoccluded rim is inpainted."""
    h, w = im.shape[:2]
    rng = np.random.default_rng(seed)
    dd = cv2.dilate(d, np.ones((9, 9), np.uint8))  # widen the near layer so edges tear behind it, not through it
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = w / 2, h / 2
    # particles: dust / mist motes living at random depths, drifting and parallaxing with their depth
    P = 140
    px, py = rng.uniform(0, w, P), rng.uniform(0, h, P)
    pz = rng.uniform(0.05, 1.0, P)
    pr = rng.uniform(0.6, 2.2, P)
    vx, vy = rng.normal(0.25, 0.25, P), rng.normal(-0.12, 0.12, P)
    for i in range(n):
        t = ease(i / max(1, n - 1))
        if cam == "orbit_left":
            sx, sy, zoom = -28 * amp * t, 0.0, 1.0 + 0.03 * t
        elif cam == "orbit_right":
            sx, sy, zoom = 28 * amp * t, 0.0, 1.0 + 0.03 * t
        elif cam == "crane_up":
            sx, sy, zoom = 0.0, 22 * amp * t, 1.0 + 0.02 * t
        else:  # dolly_in: near grows faster than far — real perspective, not a flat zoom
            sx, sy, zoom = 6 * amp * np.sin(np.pi * t), 0.0, 1.0
        dz = 0.10 * amp * t if cam == "dolly_in" else 0.0
        scale = zoom * (1.0 + dz * dd)  # per-pixel magnification by depth
        mx = cx + (xs - cx) / scale - sx * dd
        my = cy + (ys - cy) / scale - sy * dd
        f = cv2.remap(im, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        hole = ((mx < 0) | (mx > w - 1) | (my < 0) | (my > h - 1)).astype(np.uint8) * 255
        if hole.any():
            f = cv2.inpaint(f, hole, 3, cv2.INPAINT_TELEA)
        # particles, occluded by nearer scene depth
        ov = np.zeros_like(f, dtype=np.float32)
        qx = (px + vx * i + sx * pz) % w
        qy = (py + vy * i + sy * pz) % h
        for k in range(P):
            xi, yi = int(qx[k]), int(qy[k])
            if d[yi, xi] > pz[k] + 0.05:
                continue
            a = 0.35 * (0.5 + 0.5 * np.sin(i * 0.07 + k))
            cv2.circle(ov, (xi, yi), max(1, int(pr[k] * (0.5 + pz[k]))), (a * 255, a * 245, a * 225), -1, cv2.LINE_AA)
        ov = cv2.GaussianBlur(ov, (0, 0), 1.2)
        yield np.clip(f.astype(np.float32) + ov, 0, 255).astype(np.uint8)


def write_mp4(frames, out, fps=FPS):
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(fps),
                          "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", out],
                         stdin=subprocess.PIPE)
    for f in frames:
        p.stdin.write(f.tobytes())
    p.stdin.close()
    return p.wait() == 0


def parallax(img, out, secs=6.0, cam="dolly_in", amp=1.0, seed=0):
    try:
        im = cv2.imread(img)
        if im is None:
            return None
        im = fit(im, W, H)
        d = depth_of(im)
        ok = write_mp4(parallax_frames(im, d, int(secs * FPS), cam, amp, seed), out)
        return out if ok else None
    except Exception:
        return None


def animate(img, out, prompt="", secs=4.0, cam="dolly_in", seed=0, prefer="i2v"):
    """Best available real motion → (out, engine) or (None, None)."""
    if prefer == "i2v":
        p = i2v(img, out, prompt or "make this image come alive, natural motion, cinematic", min(secs, 5.0))
        if p:
            return p, "i2v"
    p = parallax(img, out, secs, cam, seed=seed)
    return (p, "parallax") if p else (None, None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["i2v", "parallax", "animate", "budget"])
    ap.add_argument("inp", nargs="?")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--prompt", default="")
    ap.add_argument("--secs", type=float, default=4.0)
    ap.add_argument("--cam", default="dolly_in")
    a = ap.parse_args()
    if a.cmd == "budget":
        print(json.dumps(budget_load()))
        return
    if a.cmd == "i2v":
        r = i2v(a.inp, a.out, a.prompt or "make this image come alive, natural motion, cinematic", a.secs)
    elif a.cmd == "parallax":
        r = parallax(a.inp, a.out, a.secs, a.cam)
    else:
        r, eng = animate(a.inp, a.out, a.prompt, a.secs, a.cam)
        print(eng)
    print(r or "FAILED")
    sys.exit(0 if r else 1)


if __name__ == "__main__":
    main()
