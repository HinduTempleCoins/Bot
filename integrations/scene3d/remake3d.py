"""remake3d.py — every remake-gallery picture that says more as a moving scene → a 5-second real-3D camera shot
(prep3d.py layers + scene3d_blender.py), published to the animations page as kind "3d-scene" (id 3d-<key>).
Order: imagined scenes and gods-on-pottery first (krater, amphora, hydria, kylix, vase, Delos …), then tombs,
carvings and reliefs, then everything else. Skips finished clips; one scene at a time at low priority.
  face-venv/bin/python remake3d.py [--limit N] [keys…]
"""
import json, os, re, shutil, subprocess, sys, time

GEN = "/opt/melek-gen"; HERE = f"{GEN}/scene3d"; REM = f"{GEN}/remakes"; ANIMS = f"{GEN}/anims"
MOVES = ["orbit", "dolly", "crane"]
FIRST = re.compile(r"krater|amphora|hydria|kylix|lekythos|vase|pottery|delos|imagined|claude|god|apollo|artemis|zeus|athena|hera|dionysus|poseidon|hermes|leto", re.I)
SECOND = re.compile(r"tomb|relief|carving|mural|fresco|stele|sarcoph|mosaic|cave|temple", re.I)


def rid(key):
    s = re.sub(r"[^a-z0-9-]", "-", key.lower()); s = re.sub(r"-+", "-", s).strip("-")
    return ("3d-" + s)[:40].rstrip("-")


def pick_image(key):
    d = f"{REM}/{key}"
    fs = sorted(f for f in os.listdir(d) if f.startswith("1_real") and f.endswith((".png", ".jpg")) and "sheet" not in f and "face" not in f)
    return os.path.join(d, fs[0]) if fs else None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 10 ** 9
    keys = args or sorted(k for k in os.listdir(REM) if os.path.isdir(f"{REM}/{k}") and not k.startswith(("skull", "lineup")))
    keys.sort(key=lambda k: (0 if FIRST.search(k) else 1 if SECOND.search(k) else 2, k))
    done = 0
    for n, key in enumerate(keys):
        if done >= limit:
            break
        out_id = rid(key); dst = f"{ANIMS}/{out_id}"
        if os.path.exists(f"{dst}/clip.mp4"):
            continue
        src = pick_image(key)
        if not src:
            continue
        work = f"{HERE}/work/{key}"; t0 = time.time()
        r = subprocess.run([f"{GEN}/face-venv/bin/python", f"{HERE}/prep3d.py", src, work], capture_output=True, text=True)
        if r.returncode:
            print(key, "prep failed", r.stderr[-200:], flush=True); continue
        mp4 = f"{work}/clip.mp4"; move = MOVES[n % 3]
        r = subprocess.run(["/opt/blender/blender", "-b", "-P", f"{HERE}/scene3d_blender.py", "--", work, mp4, "5", move, "8"], capture_output=True, text=True)
        if "SCENE3D_OK" not in r.stdout:
            print(key, "render failed", r.stdout[-300:], flush=True); continue
        os.makedirs(dst, exist_ok=True)
        shutil.copy2(mp4, f"{dst}/clip.mp4")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "3", "-i", mp4, "-frames:v", "1", f"{dst}/poster.jpg"])
        title = key.replace("_", " ").title()
        json.dump({"id": out_id, "kind": "3d-scene", "motion": move, "amplitude": "", "camera": move, "pace": "normal", "narrate": "no",
                   "scene": key, "title": f"{title} — in 3D", "group": "3D scenes", "look": "1_real", "people": "",
                   "narration_text": "", "seconds": 5, "made": int(time.time()),
                   "note": "Built from the 2D remake: depth → 3D layers → a real camera move (CPU, Blender). Alpha."},
                  open(f"{dst}/recipe.json", "w"), indent=1)
        shutil.rmtree(work, ignore_errors=True)
        done += 1
        print(f"{key} → {out_id} ({move}) {int(time.time() - t0)} s", flush=True)


if __name__ == "__main__":
    main()
