"""route_film.py — a map-with-stops job → a published documentary + a maps clip + one clip per stop.

  python route_film.py clips/hannibal-across-the-map.json --data data --maps-out out --docs-out ../docs_out

1. renders the film with render_map.py (the march pauses at each stop: zoom in, pictures, place card, pull back),
   1080p for /maps and 720p for /documentaries, plus <id>-stopNN.mp4 segments;
2. lays our synthesized ambient bed under the documentary cut (documentary/render_wordless.ambient — CC0, ours);
3. writes <docs-out>/<id>/{film.mp4, poster.jpg, film.json} in the documentaries format (chapters from the stops'
   chapters, on-screen cards with their kind and source, grouped sources, every picture credit, the Alpha +
   testing notice, the missing-assets list for the asset-growth queue);
4. adds/updates the clip in <maps-out>/index.json (with its per-stop segments).
The worker's media sync publishes both folders (no SSH between servers); the @shilpa-shastra poster picks them up.
"""
import argparse, json, os, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import render_map as rm  # noqa: E402

ALPHA = "Alpha — Hathor is still being trained; her next documentaries will be much better and more accurate."


def ambient(total, seed, out):
    sys.path.insert(0, os.path.join(rm.GEN_HOME, "documentary"))
    try:
        import render_wordless as rw
        rw.ambient(total, seed, out)
        return True
    except Exception as e:
        print(f"ambient bed skipped: {e}", file=sys.stderr)
        return False


def film_json(job, info, seconds, render_seconds):
    stops = info["stops"]
    chapters, seen = [], set()
    for st in stops:
        ch = st.get("chapter") or ""
        if ch and ch not in seen:
            seen.add(ch); chapters.append({"title": ch, "start": round(max(0.0, st["start"] - 1.6), 1)})
    onscreen = [{"at": round(st["start"], 1), "text": f"{st['label']} · {st['date']}", "kind": st["kind"] if st["kind"] != "debated" else "interpretation",
                 "source": st.get("source", "")} for st in stops]
    credits = []
    for c in [c for st in stops for c in st["credits"]] + [info["credit"], "Soundtrack: synthesized ambient (wind, drone, water) — CC0, made by SoapBox"]:
        if c and c not in credits:
            credits.append(c)
    src = job.get("sources") or {}
    sources = {k: list(src.get(k, [])) for k in ("record", "tradition", "interpretation")}
    for st in stops:  # every card's own reference, grouped by its kind
        k = {"record": "record", "tradition": "tradition", "debated": "interpretation", "interpretation": "interpretation"}.get(st["kind"])
        if k and st.get("source") and st["source"] not in sources[k]:
            sources[k].append(st["source"])
    return {"id": job["id"], "topic": job["id"], "title": job["title"], "summary": job.get("subtitle", ""), "seconds": round(seconds, 1),
            "chapters": chapters, "onscreen": onscreen, "sources": sources, "credits": credits, "alpha": ALPHA,
            "testing": job.get("testing", ""), "style": "mapRoute", "minutes": max(1, round(seconds / 60)), "made": int(time.time()),
            "renderSeconds": round(render_seconds, 1), "audio": {"track": "synthesized ambient (wind, drone, water)", "licence": "CC0 — made by SoapBox"},
            "missing": [{"sequence": 0, "visual": m} for m in job.get("missing", [])], "stops": [{k: st[k] for k in ("label", "date", "kind", "source", "caption", "start")} for st in stops]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("job"); ap.add_argument("--data", default="data"); ap.add_argument("--maps-out", default="out")
    ap.add_argument("--docs-out", default=os.path.join(rm.GEN_HOME, "docs_out"))
    a = ap.parse_args()
    job = json.load(open(a.job)); cid = job["id"]
    os.makedirs(a.maps_out, exist_ok=True)
    t0 = time.time()
    mp4 = os.path.join(a.maps_out, f"{cid}.mp4"); mp720 = os.path.join(a.maps_out, f"{cid}_720.mp4"); poster = os.path.join(a.maps_out, f"{cid}.jpg")
    info = rm.render(job, mp4, mp720, a.data, os.path.dirname(os.path.abspath(a.job)), poster, a.maps_out)
    fps = info["fps"]; seconds = info["frames"] / fps
    # the documentary cut: 720p with the ambient bed
    ddir = os.path.join(a.docs_out, cid); os.makedirs(ddir, exist_ok=True)
    film = os.path.join(ddir, "film.mp4"); tmp_audio = os.path.join(ddir, "ambient.m4a")
    if ambient(seconds, cid, tmp_audio):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp720, "-i", tmp_audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "copy",
                        "-shortest", "-movflags", "+faststart", film + ".part.mp4"], check=True)
        os.replace(film + ".part.mp4", film); os.unlink(tmp_audio)
    else:
        shutil.copyfile(mp720, film)
    shutil.copyfile(poster, os.path.join(ddir, "poster.jpg"))
    fj = film_json(job, info, seconds, time.time() - t0)
    json.dump(fj, open(os.path.join(ddir, "film.json"), "w"), indent=1, ensure_ascii=False)
    # the maps clip + its stop segments
    idx_path = os.path.join(a.maps_out, "index.json")
    index = {c["id"]: c for c in (json.load(open(idx_path))["clips"] if os.path.exists(idx_path) else [])}
    index[cid] = dict(id=cid, title=job["title"], subtitle=job.get("subtitle", ""), region=job.get("region", ""), bbox=job["bbox"],
                      fromYear=job["years"][0], toYear=job["years"][1], polities=info["polities"], duration=round(seconds, 1),
                      file=f"{cid}.mp4", file720=f"{cid}_720.mp4", poster=f"{cid}.jpg",
                      licence="CC BY 4.0 (territories, Cliopatria) + public domain (Natural Earth); pictures: see credits",
                      credit=info["credit"], tags=job.get("tags", []), renderSeconds=round(time.time() - t0, 1), kind="route-with-stops",
                      documentary=f"/documentaries/{cid}",
                      segments=[{"label": st["label"], "date": st["date"], "file": st.get("segment"), "start": round(st["start"], 1),
                                 "duration": round(st["frames"] / fps, 1)} for st in info["stops"] if st.get("segment")])
    json.dump({"updated": int(time.time()), "clips": sorted(index.values(), key=lambda c: c["fromYear"])}, open(idx_path + ".part", "w"), indent=1, ensure_ascii=False)
    os.replace(idx_path + ".part", idx_path)
    print(json.dumps({"id": cid, "seconds": round(seconds, 1), "stops": len(info["stops"]), "renderSeconds": round(time.time() - t0, 1), "film": film}))


if __name__ == "__main__":
    main()
