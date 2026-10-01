"""prep3d.py — turn one 2D scene into the layers a 3D scene needs (CPU only).
  depth.png   16-bit depth (Depth-Anything-V2-Small, Apache-2.0), 65535 = nearest
  mask.png    foreground (the near figures/objects), soft edge
  bg.png      the picture with the foreground removed and the hole filled (so the camera can see behind it)
  bgdepth.png depth of the background with the foreground's depth pushed back to its surroundings
  face-venv/bin/python prep3d.py in.png outdir
"""
import os, sys, time
import cv2, numpy as np, torch
from PIL import Image

torch.set_num_threads(int(os.environ.get("PREP3D_THREADS", "6")))
_pipe = None


def depth_of(img):
    global _pipe
    if _pipe is None:
        from transformers import pipeline
        _pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device="cpu")
    d = np.array(_pipe(img)["depth"], dtype=np.float32)
    d = cv2.resize(d, img.size, interpolation=cv2.INTER_CUBIC)
    return (d - d.min()) / max(1e-6, d.max() - d.min())          # 1 = near


def prep(src, out):
    os.makedirs(out, exist_ok=True)
    t0 = time.time()
    img = Image.open(src).convert("RGB")
    if max(img.size) > 1280:
        img.thumbnail((1280, 1280))
    rgb = np.array(img)
    d = depth_of(img)
    d = cv2.bilateralFilter(d, 9, 0.1, 5)
    # foreground = the nearest third, cleaned; at least 4% and at most 45% of the frame
    thr = np.percentile(d, 68)
    m = (d > thr).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m)
    keep = np.zeros_like(m)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] > 0.004 * m.size:
            keep[lab == i] = 255
    frac = keep.mean() / 255
    if frac < 0.04 or frac > 0.45:
        keep[:] = 0                                              # no clear foreground: one layer only
    hole = cv2.dilate(keep, np.ones((21, 21), np.uint8))
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    bg = cv2.inpaint(bgr, hole, 9, cv2.INPAINT_TELEA) if keep.any() else bgr
    # background depth: replace the foreground's depth with the surrounding background depth
    d8 = (d * 255).astype(np.uint8)
    bgd = cv2.inpaint(d8, hole, 15, cv2.INPAINT_TELEA).astype(np.float32) / 255 if keep.any() else d
    cv2.imwrite(os.path.join(out, "src.png"), bgr)
    cv2.imwrite(os.path.join(out, "bg.png"), bg)
    # foreground depth with NO cliff at its border: outside the mask, carry the figure's own nearest-edge depth outward
    # (the mask hides that area anyway) so the mesh never stretches from a near figure down to the far background
    fd = d.copy()
    if keep.any():
        inside = keep > 127
        big = cv2.dilate(np.where(inside, d, 0).astype(np.float32), np.ones((41, 41), np.uint8))
        fd = np.where(inside, d, np.maximum(big, d))
        fd = cv2.GaussianBlur(fd, (0, 0), 2)
    cv2.imwrite(os.path.join(out, "depth.png"), (np.clip(fd, 0, 1) * 65535).astype(np.uint16))
    cv2.imwrite(os.path.join(out, "bgdepth.png"), (np.clip(bgd, 0, 1) * 65535).astype(np.uint16))
    cv2.imwrite(os.path.join(out, "mask.png"), cv2.GaussianBlur(keep, (0, 0), 1.5))
    return {"ok": True, "w": img.size[0], "h": img.size[1], "fg": round(float(frac), 3), "seconds": round(time.time() - t0, 1)}


if __name__ == "__main__":
    print(prep(sys.argv[1], sys.argv[2]), flush=True)
