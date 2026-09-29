"""depth_parallax.py — 2.5D parallax camera move from a single image.
Depth: Depth-Anything-V2-Small (Apache-2.0, depth-anything/Depth-Anything-V2-Small-hf) via transformers.
Then each frame shifts pixels by depth (near moves more than far) = a slow dolly/orbit.

  face-venv/bin/python depth_parallax.py in.png out.mp4 [--seconds 6] [--move orbit|dolly|pan] [--strength 18]
Prints JSON {ok, seconds, depthSeconds}.
"""
import argparse, json, subprocess, time
import numpy as np, cv2, torch
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("src"); ap.add_argument("dst")
ap.add_argument("--seconds", type=float, default=6); ap.add_argument("--fps", type=int, default=24)
ap.add_argument("--move", default="orbit", choices=["orbit", "dolly", "pan"])
ap.add_argument("--strength", type=float, default=18.0)
ap.add_argument("--save-depth", default="")
a = ap.parse_args()
torch.set_num_threads(4)
t0 = time.time()
from transformers import pipeline
pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device="cpu")
img = Image.open(a.src).convert("RGB")
d = np.array(pipe(img)["depth"], dtype=np.float32)
d = cv2.resize(d, img.size, interpolation=cv2.INTER_CUBIC)
d = (d - d.min()) / max(1e-6, d.max() - d.min())  # 1 = near
d = cv2.GaussianBlur(d, (0, 0), 3)
t_depth = time.time() - t0
if a.save_depth:
    cv2.imwrite(a.save_depth, (d * 255).astype(np.uint8))
src = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
h, w = src.shape[:2]
W, H = w - w % 2, h - h % 2
gy, gx = np.mgrid[0:h, 0:w].astype(np.float32)
ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(a.fps), "-i", "-",
                       "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", a.dst], stdin=subprocess.PIPE)
n = int(a.seconds * a.fps)
for i in range(n):
    t = i / max(1, n - 1)
    e = 0.5 - 0.5 * np.cos(np.pi * t)
    if a.move == "orbit":
        dx, dy, z = a.strength * (e - 0.5) * 2, a.strength * 0.25 * np.sin(np.pi * t), 1.0
    elif a.move == "pan":
        dx, dy, z = a.strength * (e - 0.5) * 2, 0.0, 1.0
    else:
        dx, dy, z = 0.0, 0.0, 1.0 + 0.06 * e
    zoom = 1.04 * z  # hide edges
    cx, cy = w / 2, h / 2
    mx = (gx - cx) / zoom + cx - dx * d
    my = (gy - cy) / zoom + cy - dy * d - (z - 1) * (gy - cy) * d
    fr = cv2.remap(src, mx.astype(np.float32), my.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    ff.stdin.write(fr[:H, :W].tobytes())
ff.stdin.close(); ff.wait()
print(json.dumps({"ok": ff.returncode == 0, "seconds": round(time.time() - t0, 2), "depthSeconds": round(t_depth, 2), "frames": n}))
