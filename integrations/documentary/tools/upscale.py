"""upscale.py — 4x super-resolution with Real-ESRGAN weights (BSD-3-Clause, xinntao/Real-ESRGAN) loaded by spandrel (MIT).
768x512 → 3072x2048, then optionally resized to a target (e.g. 1920x1080 frames).

  tools-venv/bin/python upscale.py in.png out.png [--model models/RealESRGAN_x4plus.pth] [--tile 256] [--fit 1920x1280]
Prints JSON {ok, seconds}.
"""
import argparse, json, os, time
import numpy as np, torch
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument("src"); ap.add_argument("dst")
ap.add_argument("--model", default=os.path.join(HERE, "models", "RealESRGAN_x4plus.pth"))
ap.add_argument("--tile", type=int, default=256); ap.add_argument("--fit", default="")
ap.add_argument("--threads", type=int, default=6)
a = ap.parse_args()
torch.set_num_threads(a.threads)
t0 = time.time()
from spandrel import ModelLoader
m = ModelLoader().load_from_file(a.model).eval()
img = np.asarray(Image.open(a.src).convert("RGB"), dtype=np.float32) / 255.0
x = torch.from_numpy(img).permute(2, 0, 1)[None]
s, T, pad = m.scale, a.tile, 16
_, _, h, w = x.shape
out = torch.zeros((1, 3, h * s, w * s))
with torch.inference_mode():
    for y0 in range(0, h, T):
        for x0 in range(0, w, T):
            ya, xa = max(0, y0 - pad), max(0, x0 - pad)
            yb, xb = min(h, y0 + T + pad), min(w, x0 + T + pad)
            o = m(x[:, :, ya:yb, xa:xb])
            oy, ox = (y0 - ya) * s, (x0 - xa) * s
            th, tw = min(T, h - y0) * s, min(T, w - x0) * s
            out[:, :, y0 * s:y0 * s + th, x0 * s:x0 * s + tw] = o[:, :, oy:oy + th, ox:ox + tw]
res = Image.fromarray((out[0].clamp(0, 1).permute(1, 2, 0).numpy() * 255).round().astype(np.uint8))
if a.fit:
    W, H = (int(v) for v in a.fit.lower().split("x"))
    res.thumbnail((W, H), Image.LANCZOS)
res.save(a.dst)
print(json.dumps({"ok": True, "seconds": round(time.time() - t0, 2), "size": list(res.size)}))
