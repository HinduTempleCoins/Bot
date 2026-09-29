"""cutout.py — background removal (rembg, MIT; model u2net / isnet-general-use, Apache-2.0).
Characters cut out of their renders so they can be composited into scenes.

  tools-venv/bin/python cutout.py in.png out.png [--model isnet-general-use]
Writes an RGBA PNG. Prints JSON {ok, seconds}.
"""
import argparse, json, time
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("src"); ap.add_argument("dst")
ap.add_argument("--model", default="isnet-general-use")
a = ap.parse_args()
t0 = time.time()
from rembg import new_session, remove
sess = new_session(a.model)
out = remove(Image.open(a.src).convert("RGB"), session=sess)
out.save(a.dst)
print(json.dumps({"ok": True, "seconds": round(time.time() - t0, 2), "model": a.model}))
