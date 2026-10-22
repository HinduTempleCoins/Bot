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
import argparse, json, math, os, random, shutil, subprocess, sys, time

import cv2
import numpy as np

W = int(os.environ.get("ANIM_W", "1280"))
H = int(os.environ.get("ANIM_H", "720"))
FPS = int(os.environ.get("ANIM_FPS", "24"))
X264_PRESET = os.environ.get("ANIM_X264_PRESET", "slow")
X264_CRF = os.environ.get("ANIM_X264_CRF", "19")
STATE = os.environ.get("MOTION_STATE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "motion_budget.json"))
DAILY = int(os.environ.get("I2V_DAILY", "24"))

# Why the last engine call gave up. The callers write this into the clip's recipe so a fallback is never silent.
LAST_ERROR = ""
LAST_DEPTH = ""


def _fail(why):
    global LAST_ERROR
    LAST_ERROR = str(why)[:300]
    return None

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
    global LAST_ERROR
    LAST_ERROR = ""
    b = budget_load()
    if b["used"] >= DAILY:
        return _fail(f"i2v daily budget spent ({b['used']}/{DAILY})")
    if time.time() < b.get("cooldown_until", 0):
        return _fail(f"i2v cooling down for {int(b['cooldown_until'] - time.time())}s after a quota error")
    try:
        from gradio_client import Client, handle_file
    except Exception as e:
        return _fail(f"gradio_client missing: {e}")
    tok = os.environ.get("HF_TOKEN") or None
    tried = []
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
                LAST_ERROR = ""
                return out
            tried.append(f"{space}: no usable mp4 in result")
        except Exception as e:
            msg = str(e).lower()
            b["fails"] += 1
            tried.append(f"{space}: {type(e).__name__} {str(e)[:90]}")
            if "quota" in msg or "exceeded" in msg or "limit" in msg:
                b["cooldown_until"] = time.time() + 3600  # ZeroGPU quota refills over time; back off an hour
                budget_save(b)
                return _fail("; ".join(tried))
            continue
    budget_save(b)
    return _fail("; ".join(tried) or "no spaces configured")


# ---------- parallax ----------
_DEPTH = None


def depth_of(im):
    """float32 depth in [0,1], 1 = near. Depth-Anything-V2-Small on CPU; falls back to a vertical gradient."""
    global _DEPTH, LAST_DEPTH
    try:
        if _DEPTH is None:
            from transformers import pipeline
            _DEPTH = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device=-1)
        from PIL import Image
        d = np.array(_DEPTH(Image.fromarray(cv2.cvtColor(im, cv2.COLOR_BGR2RGB)))["predicted_depth"].squeeze(), dtype=np.float32)
        d = cv2.resize(d, (im.shape[1], im.shape[0]), interpolation=cv2.INTER_CUBIC)
        LAST_DEPTH = "model"
    except Exception as e:
        # A vertical gradient is NOT depth — the clip becomes a shear, not parallax. Say so in the recipe.
        LAST_DEPTH = f"gradient ({type(e).__name__}: {str(e)[:80]})"
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


def parallax_frames(im, d, n, cam="dolly_in", amp=1.0, seed=0, out_size=None):
    """Yield BGR frames. Backward-warp: out(x) = src(x - shift * depth(x)), depth dilated so near objects keep
    their silhouettes. With `out_size` the frames are the middle of an over-scanned plate, so the rim the
    camera drags in is cropped away instead of repaired."""
    h, w = im.shape[:2]
    rng = np.random.default_rng(seed)
    d = np.ascontiguousarray(d, dtype=np.float32)
    dd = cv2.dilate(d, np.ones((9, 9), np.uint8)).astype(np.float32)  # widen the near layer so edges tear behind it
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = w / 2, h / 2
    # particles: dust / mist motes living at random depths, drifting and parallaxing with their depth
    oww, ohh = out_size or (w, h)
    oww, ohh = min(oww, w), min(ohh, h)
    ox, oy = max(0, (w - oww) // 2), max(0, (h - ohh) // 2)
    P = int(140 * (w * h) / (960.0 * 540.0))
    px, py = rng.uniform(0, w, P), rng.uniform(0, h, P)
    pz = rng.uniform(0.05, 1.0, P)
    pr = rng.uniform(0.6, 2.2, P)
    vx, vy = rng.normal(0.25, 0.25, P), rng.normal(-0.12, 0.12, P)
    # The shift per unit depth scales with the frame, so 720p parallaxes as hard as 540p did (it is a camera
    # baseline in pixels, not an absolute one).
    kpx = w / 960.0
    for i in range(n):
        t = float(ease(i / max(1, n - 1)))
        if cam == "orbit_left":
            sx, sy, zoom = -34 * kpx * amp * t, 0.0, 1.0 + 0.03 * t
        elif cam == "orbit_right":
            sx, sy, zoom = 34 * kpx * amp * t, 0.0, 1.0 + 0.03 * t
        elif cam == "crane_up":
            sx, sy, zoom = 0.0, 26 * kpx * amp * t, 1.0 + 0.02 * t
        else:  # dolly_in: near grows faster than far — real perspective, not a flat zoom
            sx, sy, zoom = 8 * kpx * amp * math.sin(math.pi * t), 0.0, 1.0
        dz = 0.12 * amp * t if cam == "dolly_in" else 0.0
        scale = (zoom * (1.0 + dz * dd)).astype(np.float32)  # per-pixel magnification by depth
        # float32 throughout: cv2.remap only accepts CV_32FC1/CV_32FC2/CV_16SC2 maps, and under NumPy 2's
        # NEP-50 promotion a float64 Python/NumPy scalar times a float32 array yields float64 — which used to
        # make every single parallax render raise, silently, and fall back to Ken Burns.
        mx = np.asarray(cx + (xs - cx) / scale - np.float32(sx) * dd, dtype=np.float32)
        my = np.asarray(cy + (ys - cy) / scale - np.float32(sy) * dd, dtype=np.float32)
        # Clamp instead of inpaint. Sampling off the plate used to be repaired with cv2.inpaint, which costs
        # ~0.7s on a 720p frame and fired on 23 frames out of 24 — 95% of an orbit's whole render time. The
        # over-scan in parallax() keeps the delivered window clear of the plate edge, so the clamped rim is
        # cropped away unseen and the repair is not needed at all.
        np.clip(mx, 0, w - 1, out=mx)
        np.clip(my, 0, h - 1, out=my)
        f = cv2.remap(im, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)[oy:oy + ohh, ox:ox + oww]
        # particles, occluded by nearer scene depth. Drawn at half resolution and scaled up: they are blurred
        # motes, nobody can tell, and the blur is 4x cheaper.
        ov = np.zeros(((ohh + 1) // 2, (oww + 1) // 2, 3), np.float32)
        qx = (px + vx * i + sx * pz) % w
        qy = (py + vy * i + sy * pz) % h
        for k in range(P):
            xi, yi = int(qx[k]), int(qy[k])
            if d[yi, xi] > pz[k] + 0.05:
                continue
            cx_, cy_ = xi - ox, yi - oy
            if not (0 <= cx_ < oww and 0 <= cy_ < ohh):
                continue
            a = 0.35 * (0.5 + 0.5 * math.sin(i * 0.07 + k))
            cv2.circle(ov, (cx_ >> 1, cy_ >> 1), max(1, int(pr[k] * (0.5 + pz[k]) * 0.5)),
                       (a * 255, a * 245, a * 225), -1, cv2.LINE_AA)
        ov = cv2.resize(cv2.GaussianBlur(ov, (0, 0), 0.8), (oww, ohh), interpolation=cv2.INTER_LINEAR)
        yield np.clip(f.astype(np.float32) + ov, 0, 255).astype(np.uint8)


def x264_args(out, w=None, h=None, fps=FPS):
    """One encoder recipe for every engine. These are 4-12 second clips: a slower preset and a lower CRF cost
    seconds of CPU and buy visible detail, where the old veryfast/crf-24 was spending ~50 kbps on a 540p pan."""
    return ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
            "-s", f"{w or W}x{h or H}", "-r", str(fps), "-i", "-",
            "-c:v", "libx264", "-preset", X264_PRESET, "-crf", X264_CRF, "-tune", "film",
            "-pix_fmt", "yuv420p", "-profile:v", "high", "-movflags", "+faststart", out]


def write_mp4(frames, out, fps=FPS, size=None):
    w, h = size or (W, H)
    p = subprocess.Popen(x264_args(out, w, h, fps), stdin=subprocess.PIPE)
    for f in frames:
        p.stdin.write(f.tobytes())
    p.stdin.close()
    return p.wait() == 0


def parallax(img, out, secs=6.0, cam="dolly_in", amp=1.0, seed=0, size=None):
    global LAST_ERROR
    LAST_ERROR = ""
    w, h = size or (W, H)
    try:
        im = cv2.imread(img)
        if im is None:
            return _fail(f"unreadable image {os.path.basename(img)}")
        # Render on an over-scanned plate and deliver the middle of it: the camera then moves *inside* the
        # picture instead of dragging an empty rim in behind it, so there is nothing to inpaint and no
        # smeared edge where the far layer used to tear.
        pad = float(os.environ.get("ANIM_PARALLAX_PAD", "1.18"))
        bw, bh = int(w * pad) // 2 * 2, int(h * pad) // 2 * 2
        im = fit(im, bw, bh)
        d = depth_of(im)
        ok = write_mp4(parallax_frames(im, d, int(secs * FPS), cam, amp, seed, out_size=(w, h)), out, size=(w, h))
        if not ok:
            return _fail("ffmpeg returned non-zero")
        return out
    except Exception as e:
        return _fail(f"{type(e).__name__}: {e}")


def normalize_video(src, out, w=None, h=None, fps=FPS):
    """Re-encode a clip produced by somebody else's model to our canvas and frame rate.

    The i2v Spaces hand back whatever they like — the catalogue has `alive` clips at 832x816 @ 16 fps next to
    everything else at 16:9 @ 24 fps. Scale-to-fill and crop (biased up, so heads survive a wide crop) so the
    kind that actually looks best is not also the one that looks like a different show.
    """
    w, h = w or W, h or H
    vf = (f"scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos,"
          f"crop={w}:{h}:(iw-{w})/2:(ih-{h})*0.33,fps={fps}")
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", vf, "-c:v", "libx264", "-preset", X264_PRESET,
           "-crf", X264_CRF, "-tune", "film", "-pix_fmt", "yuv420p", "-profile:v", "high", "-an",
           "-movflags", "+faststart", out]
    try:
        if subprocess.run(cmd, capture_output=True).returncode == 0 and os.path.getsize(out) > 10000:
            return out
    except Exception:
        pass
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
