"""video_studio_worker.py — the Video Studio's render worker. It PULLS queued films from the web host over HTTPS
(token), renders them with FFmpeg, and PUTs the film back. No SSH between hosts, no inbound port.

  VSTUDIO_BASE=https://<studio> VSTUDIO_WORKER_TOKEN=… python video_studio_worker.py [--once] [--max-renders 25]

Style (wordless eerie recreation): each shot = a still (reused from the remakes, a URL/data image from the user's
engine, or a new render on the local CPU image worker when only a prompt is given — capped per film), a slow
push-in, dip-to-black transitions, place/era card lower-left, an occasional question centred, a title card and an
end card with the Alpha notice and the sources. Sound: a synthesized ambient drone (brown noise + low sines) —
made here, so there is no third-party recording to license. If VSTUDIO_PIPELINE_CMD is set, the plan is handed to
that command instead (e.g. the documentary pipeline's CLI) and it must write <out>/video.mp4.
"""
import argparse, base64, json, os, shutil, subprocess, sys, tempfile, time, urllib.request

BASE = os.environ.get("VSTUDIO_BASE", "").rstrip("/")
TOK = os.environ.get("VSTUDIO_WORKER_TOKEN", "")
FONT = os.environ.get("VSTUDIO_FONT", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
FONT_B = os.environ.get("VSTUDIO_FONT_BOLD", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
SD = os.environ.get("VSTUDIO_SD", "http://127.0.0.1:8510")
SD_TOK_FILE = os.environ.get("VSTUDIO_SD_TOKEN_FILE", "")  # file with CPU_SD_TOKEN=… (local image worker), kept out of the repo
W, H, FPS = 1280, 720, 24
ALPHA = "Alpha: one of Hathor's first films. The films she makes next are expected to be much better and more accurate."


def api(method, path, body=None, data=None, ctype="application/json", timeout=60):
    req = urllib.request.Request(BASE + path, method=method, data=(json.dumps(body).encode() if body is not None else data),
                                 headers={"authorization": f"Bearer {TOK}", "content-type": ctype, "user-agent": "hathor-vstudio-worker/1"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def put_file(path, local):
    size = os.path.getsize(local)
    with open(local, "rb") as fh:
        req = urllib.request.Request(BASE + path, method="PUT", data=fh, headers={"authorization": f"Bearer {TOK}", "content-type": "application/octet-stream", "content-length": str(size)})
        with urllib.request.urlopen(req, timeout=1800) as r:
            return json.loads(r.read() or b"{}")


def progress(jid, stage, pct):
    try: api("POST", f"/video-studio/api/worker/{jid}/progress", {"stage": stage, "pct": pct}, timeout=20)
    except Exception: pass


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed: {r.stderr[-800:]}")


def fetch_image(shot, dest, renders_left):
    img = shot.get("image") or ""
    if img.startswith("https://"):
        req = urllib.request.Request(img, headers={"user-agent": "hathor-vstudio-worker/1"})
        with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
            shutil.copyfileobj(r, f)
        return True, renders_left
    if img.startswith("data:image/"):
        open(dest, "wb").write(base64.b64decode(img.split(",", 1)[1]))
        return True, renders_left
    if shot.get("prompt") and renders_left > 0:
        if not SD_TOK_FILE or not os.path.exists(SD_TOK_FILE):
            return False, renders_left
        tok = [l.split("=", 1)[1].strip() for l in open(SD_TOK_FILE) if l.startswith("CPU_SD_TOKEN=")][0]
        def sd(m, p, b=None):
            q = urllib.request.Request(SD + p, method=m, data=json.dumps(b).encode() if b else None, headers={"authorization": f"Bearer {tok}", "content-type": "application/json"})
            return json.loads(urllib.request.urlopen(q, timeout=60).read())
        prompt = shot["prompt"] + ", cinematic historical recreation, atmospheric, dramatic light, highly detailed"
        jid = sd("POST", "/jobs", {"prompt": prompt, "negativePrompt": "text, watermark, blurry, deformed", "steps": 6, "size": "768x512", "priority": "low"})["id"]
        while True:
            time.sleep(5)
            st = sd("GET", f"/jobs/{jid}")
            if st["status"] in ("done", "error"):
                break
        res = st.get("result") or {}
        if res.get("ok"):
            open(dest, "wb").write(base64.b64decode(res["base64"]))
            return True, renders_left - 1
    return False, renders_left


def textfile(tmp, name, text):
    p = os.path.join(tmp, name)
    open(p, "w").write(text)
    return p


def shot_clip(src, out, secs, card, question, tmp, i):
    frames = max(2, int(secs * FPS))
    vf = [f"scale={W*2}:{H*2}:force_original_aspect_ratio=increase", f"crop={W*2}:{H*2}",
          f"zoompan=z='min(1+0.0009*on,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={FPS}",
          "eq=saturation=0.85:contrast=1.05"]
    if card:
        vf.append(f"drawtext=fontfile={FONT_B}:textfile={textfile(tmp, f'c{i}.txt', card)}:fontsize=30:fontcolor=white@0.92:x=60:y=h-110:"
                  f"box=1:boxcolor=black@0.35:boxborderw=12:alpha='if(lt(t,1),t,if(lt(t,{secs-1:.2f}),1,max(0,{secs:.2f}-t)))'")
    if question:
        vf.append(f"drawtext=fontfile={FONT}:textfile={textfile(tmp, f'q{i}.txt', question)}:fontsize=40:fontcolor=white@0.9:x=(w-text_w)/2:y=(h-text_h)/2:"
                  f"alpha='if(lt(t,1.5),0,if(lt(t,2.5),t-1.5,if(lt(t,{secs-1:.2f}),1,max(0,{secs:.2f}-t))))'")
    vf.append(f"fade=t=in:st=0:d=0.7,fade=t=out:st={max(0.1, secs-0.7):.2f}:d=0.7")
    run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", src, "-t", f"{secs:.2f}", "-vf", ",".join(vf), "-r", str(FPS),
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", out])


def card_clip(out, lines, secs, tmp, name):
    y0 = H // 2 - 40 * len(lines) // 2
    vf = []
    for k, (text, size) in enumerate(lines):
        vf.append(f"drawtext=fontfile={FONT_B if k == 0 else FONT}:textfile={textfile(tmp, f'{name}{k}.txt', text)}:fontsize={size}:fontcolor=white:x=(w-text_w)/2:y={y0 + k*56}")
    vf.append(f"fade=t=in:st=0:d=0.8,fade=t=out:st={secs-0.8:.2f}:d=0.8")
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=c=black:s={W}x{H}:r={FPS}:d={secs}", "-vf", ",".join(vf),
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", out])


def wrap(s, n=80):
    out, line = [], ""
    for w in s.split():
        if len(line) + len(w) + 1 > n:
            out.append(line); line = w
        else:
            line = (line + " " + w).strip()
    if line: out.append(line)
    return out


def render(job, work, max_renders):
    plan = job["plan"]
    shots = [s for c in plan.get("chapters", []) for s in c.get("shots", [])]
    clips, renders_left = [], max_renders
    tmp = os.path.join(work, "t"); os.makedirs(tmp, exist_ok=True)
    title = plan.get("title") or job["topic"]
    card_clip(os.path.join(work, "c_title.mp4"), [(title, 54), ("Hathor Video Studio", 26), (ALPHA, 20)], 5, tmp, "title")
    clips.append(os.path.join(work, "c_title.mp4"))
    for i, s in enumerate(shots):
        src = os.path.join(tmp, f"s{i}.img")
        try:
            ok, renders_left = fetch_image(s, src, renders_left)
        except Exception:
            ok = False
        if not ok:
            continue
        out = os.path.join(work, f"s{i:04d}.mp4")
        try:
            shot_clip(src, out, float(s.get("secs") or 8), (s.get("card") or "")[:110], (s.get("question") or "")[:90], tmp, i)
            clips.append(out)
        except Exception as e:
            print("shot failed", i, e, flush=True)
        if i % 5 == 0:
            progress(job["id"], f"shots {i+1}/{len(shots)}", 5 + 85 * (i + 1) / max(1, len(shots)))
    if len(clips) < 2:
        raise RuntimeError("no usable shots")
    srcs = (plan.get("sources") or [])[:8]
    end_lines = [("Sources", 34)] + [(x[:90], 18) for x in srcs] + [("Sound: synthesized ambient (no third-party recording)", 18), (ALPHA, 18)]
    card_clip(os.path.join(work, "c_end.mp4"), end_lines, 8, tmp, "end")
    clips.append(os.path.join(work, "c_end.mp4"))
    lst = os.path.join(work, "list.txt")
    open(lst, "w").write("".join(f"file '{c}'\n" for c in clips))
    silent = os.path.join(work, "silent.mp4")
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", silent])
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", silent], capture_output=True, text=True).stdout.strip() or 0)
    progress(job["id"], "sound", 93)
    audio = os.path.join(work, "drone.m4a")
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"anoisesrc=color=brown:amplitude=0.25:d={dur:.2f}", "-f", "lavfi", "-i", f"sine=frequency=55:d={dur:.2f}",
         "-f", "lavfi", "-i", f"sine=frequency=82.4:d={dur:.2f}",
         "-filter_complex", f"[0]lowpass=f=400,volume=0.6[n];[1]volume=0.18,tremolo=f=0.12:d=0.6[a];[2]volume=0.10,tremolo=f=0.1:d=0.7[b];[n][a][b]amix=inputs=3,afade=t=in:d=3,afade=t=out:st={max(0, dur-4):.2f}:d=4",
         "-c:a", "aac", "-b:a", "96k", audio])
    final = os.path.join(work, "video.mp4")
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", silent, "-i", audio, "-c:v", "copy", "-c:a", "copy", "-shortest", "-movflags", "+faststart", final])
    poster = os.path.join(work, "poster.jpg")
    run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(min(8, dur / 2)), "-i", final, "-frames:v", "1", "-q:v", "3", poster])
    return final, poster, dur


WHISPER_PY = os.environ.get("VSTUDIO_WHISPER_PYTHON", sys.executable)  # a Python with faster-whisper installed
WHISPER_SCRIPT = r"""
import sys
from faster_whisper import WhisperModel
src, out, lang = sys.argv[1], sys.argv[2], (sys.argv[3] or None)
m = WhisperModel("small", device="cpu", compute_type="int8", cpu_threads=4)
segs, info = m.transcribe(src, language=lang, vad_filter=True)
def ts(t):
    h = int(t // 3600); mi = int(t % 3600 // 60); se = t % 60
    return f"{h:02d}:{mi:02d}:{se:06.3f}"
with open(out, "w") as f:
    f.write("WEBVTT\n\nNOTE made by Whisper (small, on the Hathor Video Studio worker) - AI-made, please correct\n\n")
    for s in segs:
        f.write(f"{ts(s.start)} --> {ts(s.end)}\n{s.text.strip()}\n\n")
print(info.duration)
"""


def download(url, dest, max_bytes=2 * 1024 ** 3):
    req = urllib.request.Request(url, headers={"user-agent": "hathor-vstudio-worker/1"})
    n = 0
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        while True:
            b = r.read(1 << 20)
            if not b: break
            n += len(b)
            if n > max_bytes: raise RuntimeError("video larger than 2 GB")
            f.write(b)
    return n


def do_subtitles(job, work):
    src = os.path.join(work, "in.media")
    vids = [i for i in job.get("inputs", []) if i["kind"] == "video"]
    url = vids[0]["url"] if vids else (job.get("params") or {}).get("url", "")
    if not url.startswith("https://"): raise RuntimeError("no https video")
    progress(job["id"], "downloading", 5)
    download(url, src)
    progress(job["id"], "transcribing", 20)
    out = os.path.join(work, "subtitles.vtt")
    lang = (job.get("params") or {}).get("lang", "") or ""
    r = subprocess.run(["nice", "-n", "15", WHISPER_PY, "-c", WHISPER_SCRIPT, src, out, lang], capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError("whisper failed: " + r.stderr[-400:])
    dur = float((r.stdout.strip().splitlines() or ["0"])[-1] or 0)
    return out, dur


def animate_plan(job):
    p = job.get("params") or {}
    secs = max(3, min(20, float(p.get("secs") or 8)))
    imgs = [i for i in job.get("inputs", []) if i["kind"] == "image"]
    title = p.get("title") or job.get("topic") or "Your images"
    shots = [{"image": i["url"], "card": "", "question": "", "secs": secs} for i in imgs]
    return {"title": title, "chapters": [{"title": title, "shots": shots}], "sources": [f"Your images ({imgs[0]['licence']})"] if imgs else []}


def one(max_renders):
    r = api("POST", "/video-studio/api/worker/next", {})
    job = r.get("job")
    if not job:
        return False
    t0 = time.time()
    work = tempfile.mkdtemp(prefix=f"vs-{job['id']}-")
    try:
        progress(job["id"], "starting", 2)
        tool = job.get("tool") or "film"
        if tool == "subtitles":
            vtt, dur = do_subtitles(job, work)
            progress(job["id"], "uploading", 97)
            put_file(f"/video-studio/api/worker/{job['id']}/subtitles.vtt", vtt)
            api("POST", f"/video-studio/api/worker/{job['id']}/done", {"durationSecs": round(dur, 1), "renderSecs": round(time.time() - t0)})
            print(f"{job['id']} subtitles done: {dur:.0f}s audio in {time.time()-t0:.0f}s", flush=True)
            return True
        if tool == "animate":
            job = {**job, "plan": animate_plan(job)}
        cmd = os.environ.get("VSTUDIO_PIPELINE_CMD") if tool in ("film", "documentary") else None
        if cmd:
            pf = os.path.join(work, "plan.json"); json.dump(job, open(pf, "w"))
            run(cmd.split() + [pf, work])
            final, poster = os.path.join(work, "video.mp4"), os.path.join(work, "poster.jpg")
            dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", final], capture_output=True, text=True).stdout.strip() or 0)
        else:
            final, poster, dur = render(job, work, max_renders)
        progress(job["id"], "uploading", 97)
        put_file(f"/video-studio/api/worker/{job['id']}/poster.jpg", poster)
        put_file(f"/video-studio/api/worker/{job['id']}/video.mp4", final)
        api("POST", f"/video-studio/api/worker/{job['id']}/done", {"durationSecs": round(dur, 1), "renderSecs": round(time.time() - t0)})
        print(f"{job['id']} done: {dur:.0f}s film in {time.time()-t0:.0f}s", flush=True)
    except Exception as e:
        print(f"{job['id']} FAILED: {e}", flush=True)
        try: api("POST", f"/video-studio/api/worker/{job['id']}/fail", {"error": str(e)[:280]})
        except Exception: pass
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return True


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--max-renders", type=int, default=25)
    ap.add_argument("--idle", type=int, default=30)
    ap.add_argument("--sync-every", type=int, default=1800, help="seconds between media_sync.py runs (0 = off)")
    a = ap.parse_args()
    if not BASE or len(TOK) < 24:
        sys.exit("set VSTUDIO_BASE and VSTUDIO_WORKER_TOKEN")
    sync_child, last_sync = None, 0.0
    sync_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "media_sync.py")
    while True:
        # media sync: push finished remakes/animations/documentaries/maps/subtitles to the web host (HTTPS, same token),
        # as a low-priority child so rendering jobs keep flowing; never two at once.
        if a.sync_every and os.path.exists(sync_script) and (sync_child is None or sync_child.poll() is not None) and time.time() - last_sync >= a.sync_every:
            last_sync = time.time()
            log = open(os.path.join(os.path.dirname(sync_script), "media-sync.log"), "a")
            sync_child = subprocess.Popen(["nice", "-n", "15", sys.executable, sync_script], stdout=log, stderr=subprocess.STDOUT)
            print("media sync started", flush=True)
        try:
            got = one(a.max_renders)
        except Exception as e:
            print("poll error:", e, flush=True); got = False
        if a.once:
            break
        if not got:
            time.sleep(a.idle)
