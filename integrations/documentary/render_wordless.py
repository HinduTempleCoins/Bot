"""render_wordless.py — Hathor's wordless documentaries: board.json → film.mp4 (+ poster, chapters, on-screen text, recipe).

  nice -n 15 python render_wordless.py board.json --out DIR [--size 1280x720] [--fps 24]

No voice. Each shot is a slow camera move over an image (or a trimmed/looped clip: animations, maps), fading through
black into the next — the eerie "living among the ancients" pace. Cards (place + era, questions, grounded facts with
their kind: historical record / tradition / interpretation) fade in over the picture. A title card and an end card
(sources grouped by kind + credits) carry the ALPHA notice. The soundtrack is an ambient bed synthesized here with
ffmpeg (wind, drone, water) — made by us, released CC0 — so there is nothing to license.
"""
import argparse, hashlib, json, os, subprocess, sys, tempfile, textwrap, time

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
KIND_LABEL = {"record": "Historical record", "tradition": "Tradition / scripture", "interpretation": "The Institute's interpretation"}


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd[:4])}…\n{r.stderr[-1200:]}")


def esc(s):
    return (s or "").replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace("%", "\\%").replace(",", "\\,")


def card_image(path, W, H, title, lines, alpha, bg=None):
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
    if bg and os.path.exists(bg):
        im = Image.open(bg).convert("RGB").resize((W, H)).filter(ImageFilter.GaussianBlur(18))
        im = Image.blend(im, Image.new("RGB", (W, H), (0, 0, 0)), 0.7)
    else:
        im = Image.new("RGB", (W, H), (8, 8, 10))
    d = ImageDraw.Draw(im)
    ft = ImageFont.truetype(FONT_B, int(H * 0.07))
    fl = ImageFont.truetype(FONT, int(H * 0.028))
    fa = ImageFont.truetype(FONT, int(H * 0.024))
    y = int(H * 0.16)
    for t in textwrap.wrap(title, 32):
        w = d.textlength(t, font=ft); d.text(((W - w) / 2, y), t, font=ft, fill=(240, 214, 150)); y += int(H * 0.085)
    y += int(H * 0.03)
    for ln in lines:
        for t in textwrap.wrap(ln, 90) or [""]:
            w = d.textlength(t, font=fl); d.text(((W - w) / 2, y), t, font=fl, fill=(225, 225, 225)); y += int(H * 0.04)
    if alpha:
        for t in textwrap.wrap(alpha, 100):
            w = d.textlength(t, font=fa); d.text(((W - w) / 2, H - int(H * 0.1)), t, font=fa, fill=(224, 161, 27))
    im.save(path)


def shot(src, is_clip, secs, camera, W, H, fps, card, kind, source, out):
    frames = max(1, int(secs * fps))
    fade = min(0.8, secs / 4)
    if is_clip:
        inp = ["-stream_loop", "-1", "-i", src]
        vf = f"[0:v]scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps}"
    else:
        inp = ["-loop", "1", "-i", src]
        z = {"push_in": f"1+0.12*on/{frames}", "pull_out": f"1.12-0.12*on/{frames}", "still": "1.03"}.get(camera, "1.08")
        x = {"pan_left": f"(iw-iw/zoom)*(1-on/{frames})", "pan_right": f"(iw-iw/zoom)*on/{frames}"}.get(camera, "iw/2-(iw/zoom/2)")
        vf = (f"[0:v]scale={int(W*1.25)}:{int(H*1.25)}:force_original_aspect_ratio=increase,crop={int(W*1.25)}:{int(H*1.25)},"
              f"zoompan=z='{z}':x='{x}':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={fps}")
    vf += f",fade=t=in:st=0:d={fade:.2f},fade=t=out:st={secs - fade:.2f}:d={fade:.2f}"
    if card:
        a = f"if(lt(t,0.8),0,if(lt(t,1.6),(t-0.8)/0.8,if(gt(t,{secs-1.4:.2f}),max(0,({secs-0.6:.2f}-t)/0.8),1)))"
        lines = textwrap.wrap(card, 48)[:3]
        yb = H - int(H * 0.14) - (len(lines) - 1) * int(H * 0.055)
        for i, ln in enumerate(lines):
            vf += (f",drawtext=fontfile={FONT_B}:text='{esc(ln)}':fontcolor=white:fontsize={int(H*0.045)}:alpha='{a}':"
                   f"shadowcolor=black@0.8:shadowx=2:shadowy=2:x=(w-text_w)/2:y={yb + i*int(H*0.055)}")
        if kind in KIND_LABEL:
            lab = f"{KIND_LABEL[kind]}" + (f" · {source}" if source else "")
            vf += (f",drawtext=fontfile={FONT}:text='{esc(lab[:110])}':fontcolor=0xE0A11B:fontsize={int(H*0.024)}:alpha='{a}':"
                   f"shadowcolor=black@0.8:shadowx=1:shadowy=1:x=(w-text_w)/2:y={H - int(H*0.075)}")
    run(["ffmpeg", "-y", "-loglevel", "error", *inp, "-filter_complex", vf, "-t", f"{secs:.2f}", "-an",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", out])


def ambient(total, seed, out):
    """Wind (filtered brown noise, slow swell) + a low drone (two detuned sines, slow tremolo) + faint water. CC0, ours."""
    h = int(hashlib.sha1(seed.encode()).hexdigest()[:6], 16)
    base = 48 + h % 16
    graph = (f"anoisesrc=color=brown:amplitude=0.35:seed={h % 9999}:d={total:.1f},lowpass=f=520,highpass=f=40,"
             f"volume='0.55+0.35*sin(2*PI*t/17)':eval=frame[wind];"
             f"sine=f={base}:d={total:.1f},volume=0.22[s1];sine=f={base*1.5+0.7:.1f}:d={total:.1f},volume=0.12[s2];"
             f"[s1][s2]amix=inputs=2:normalize=0,volume='0.6+0.3*sin(2*PI*t/23+1)':eval=frame[drone];"
             f"anoisesrc=color=pink:amplitude=0.08:seed={(h // 7) % 9999}:d={total:.1f},bandpass=f=1800:width_type=o:w=1.5,"
             f"volume='0.5+0.4*sin(2*PI*t/11+2)':eval=frame[water];"
             f"[wind][drone][water]amix=inputs=3:normalize=0,afade=t=in:st=0:d=4,afade=t=out:st={max(0,total-5):.1f}:d=5,"
             f"loudnorm=I=-24:TP=-3:LRA=11[a]")
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-filter_complex",
         graph.replace("[a]", "[a]"), "-map", "[a]", "-t", f"{total:.1f}", "-c:a", "aac", "-b:a", "128k", out])


def build(board, outdir, W, H, fps):
    os.makedirs(outdir, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="doc-")
    t0 = time.time()
    clips, t, chapters, onscreen, recipe_shots = [], 0.0, [], [], []
    alpha = board.get("alpha", "")
    first_img = next((s["image"] for s in board["shots"] if s.get("image") and not s["image"].endswith(".mp4")), None)
    # title card
    tc = os.path.join(tmp, "title.png")
    card_image(tc, W, H, board["title"], [board.get("summary", "")], alpha, first_img)
    shot(tc, False, 7.0, "still", W, H, fps, "", "", "", os.path.join(tmp, "s0000.mp4")); clips.append("s0000.mp4"); t += 7.0
    seq_seen = set()
    for i, s in enumerate(board["shots"]):
        src = s.get("image") or ""
        if not src or not os.path.exists(src):
            continue
        is_clip = src.endswith(".mp4")
        secs = float(s.get("seconds", 8))
        if s.get("sequence") not in seq_seen:
            seq_seen.add(s.get("sequence"))
            chapters.append({"title": board["sequences"][s["sequence"] - 1], "start": round(t, 1)})
        name = f"s{i+1:04d}.mp4"
        try:
            shot(src, is_clip, secs, s.get("camera", "push_in"), W, H, fps, s.get("card", ""), s.get("kind", "none"), s.get("source", ""), os.path.join(tmp, name))
        except RuntimeError as e:
            print("skip shot", i, str(e)[:200], flush=True); continue
        clips.append(name)
        if s.get("card"):
            onscreen.append({"at": round(t, 1), "text": s["card"], "kind": s.get("kind", "none"), "source": s.get("source", "")})
        recipe_shots.append({"at": round(t, 1), "seconds": secs, "asset": s.get("asset", ""), "path": src, "camera": s.get("camera"), "card": s.get("card", ""), "kind": s.get("kind", "none"), "visual": s.get("visual", "")})
        t += secs
        if (i + 1) % 10 == 0:
            print(f"shot {i+1}/{len(board['shots'])} · {t:.0f}s · {time.time()-t0:.0f}s elapsed", flush=True)
    # end card
    src = board.get("sources", {})
    lines = []
    for k, lab in (("record", "Historical record"), ("tradition", "Tradition / scripture"), ("interpretation", "The Institute's interpretation")):
        if src.get(k):
            lines.append(f"{lab}: " + "; ".join(src[k][:8]))
    lines += board.get("credits", [])
    lines.append("Images: Hathor Studio remakes and renders. Ambient sound: synthesized by SoapBox (CC0).")
    ec = os.path.join(tmp, "end.png")
    card_image(ec, W, H, "Sources", lines, alpha, first_img)
    shot(ec, False, 10.0, "still", W, H, fps, "", "", "", os.path.join(tmp, "s9999.mp4")); clips.append("s9999.mp4"); t += 10.0
    with open(os.path.join(tmp, "list.txt"), "w") as f:
        for c in clips:
            f.write(f"file '{c}'\n")
    video = os.path.join(tmp, "video.mp4")
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", os.path.join(tmp, "list.txt"), "-c", "copy", video])
    audio = os.path.join(tmp, "amb.m4a")
    ambient(t, board.get("topic", board["title"]), audio)
    film = os.path.join(outdir, "film.mp4")
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", video, "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "copy",
         "-shortest", "-movflags", "+faststart", film])
    run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "9", "-i", film, "-frames:v", "1", "-q:v", "3", os.path.join(outdir, "poster.jpg")])
    meta = {"id": board.get("id") or board.get("topic"), "topic": board.get("topic"), "title": board["title"], "summary": board.get("summary", ""),
            "seconds": round(t, 1), "chapters": chapters, "onscreen": onscreen, "sources": src, "credits": board.get("credits", []),
            "alpha": alpha, "style": board.get("style", ""), "minutes": board.get("minutes"), "made": int(time.time()),
            "renderSeconds": round(time.time() - t0, 1), "audio": {"track": "synthesized ambient (wind, drone, water)", "licence": "CC0 — made by SoapBox"},
            "missing": board.get("missing", []), "recipe": {"style": board.get("style"), "score": board.get("score"), "shots": recipe_shots,
                       "eraFilter": board.get("eraFilter"), "anachronisms": board.get("anachronisms", []), "note": board.get("recipeNote", "")}}
    json.dump(meta, open(os.path.join(outdir, "film.json"), "w"), indent=1)
    print(f"DONE {film} {t:.0f}s in {time.time()-t0:.0f}s", flush=True)
    return meta


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("board"); ap.add_argument("--out", required=True)
    ap.add_argument("--size", default="1280x720"); ap.add_argument("--fps", type=int, default=24)
    a = ap.parse_args()
    W, H = (int(v) for v in a.size.split("x"))
    build(json.load(open(a.board)), a.out, W, H, a.fps)
