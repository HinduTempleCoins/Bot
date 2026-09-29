"""batch.py — render every clip job in a folder and write the maps index the documentary pipeline reads.

  python batch.py --clips clips --out /opt/melek-gen/maps/out --data data [--only id1,id2]

Writes <out>/<id>.mp4 (1920x1080), <id>_720.mp4, <id>.jpg (poster) and <out>/index.json:
  { updated, clips: [ { id, title, subtitle, region, bbox, fromYear, toYear, polities, duration, file, file720, poster,
                        licence, credit, tags, renderSeconds } ] }
Skips clips whose mp4 is newer than their job file (re-run after editing a job to re-render it).
"""
import argparse, glob, json, os, time, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_map as rm

ap = argparse.ArgumentParser()
ap.add_argument("--clips", default="clips"); ap.add_argument("--out", default="out"); ap.add_argument("--data", default="data")
ap.add_argument("--only", default="")
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
idx_path = os.path.join(a.out, "index.json")
index = {c["id"]: c for c in (json.load(open(idx_path))["clips"] if os.path.exists(idx_path) else [])}
only = set(x for x in a.only.split(",") if x)
for jf in sorted(glob.glob(os.path.join(a.clips, "*.json"))):
    job = json.load(open(jf)); cid = job.get("id") or os.path.splitext(os.path.basename(jf))[0]
    if only and cid not in only:
        continue
    mp4 = os.path.join(a.out, f"{cid}.mp4")
    if os.path.exists(mp4) and os.path.getmtime(mp4) > os.path.getmtime(jf) and cid in index:
        print(cid, "up to date", flush=True); continue
    t0 = time.time()
    try:
        info = rm.render(job, mp4, os.path.join(a.out, f"{cid}_720.mp4"), a.data, os.path.dirname(os.path.abspath(jf)), os.path.join(a.out, f"{cid}.jpg"))
    except SystemExit as e:
        print(cid, "FAILED", e, flush=True); continue
    fps = job.get("fps", 24)
    index[cid] = dict(id=cid, title=job["title"], subtitle=job.get("subtitle", ""), region=job.get("region", ""), bbox=job["bbox"],
                      fromYear=job["years"][0], toYear=job["years"][1], timeMode=job.get("timeMode", "calendar"), polities=info["polities"],
                      duration=round(info["frames"] / fps, 1), file=f"{cid}.mp4", file720=f"{cid}_720.mp4", poster=f"{cid}.jpg",
                      licence="CC BY 4.0 (territories, Cliopatria) + public domain (Natural Earth)" if "Cliopatria" in info["credit"] else "public domain (Natural Earth) + job data",
                      credit=info["credit"], tags=job.get("tags", []), renderSeconds=round(time.time() - t0, 1))
    json.dump({"updated": int(time.time()), "clips": sorted(index.values(), key=lambda c: c["fromYear"])}, open(idx_path, "w"), indent=1, ensure_ascii=False)
    print(cid, f"ok {index[cid]['duration']}s video in {index[cid]['renderSeconds']}s, {info['layers']} layers", flush=True)
