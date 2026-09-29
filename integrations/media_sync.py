"""media_sync.py — push the CPU worker's finished media to the web host over HTTPS (Video Studio worker token), so new
remakes, animations, documentaries, maps and subtitles appear on the public pages — and so the @shilpa-shastra cycle,
which posts whatever is in those manifests, picks them up — without anyone piping files by hand. No SSH, no inbound port.

  VSTUDIO_BASE=https://<studio> VSTUDIO_WORKER_TOKEN=… python media_sync.py [--only remakes,anims,docs,maps,transcripts] [--dry]

Per target: (re)build the bundle where one is built (remakes: genai_remakes_publish.py; anims: hathor_animate.py publish),
ask the web host which files it has (GET …/sync/<target>/list), PUT what is new or changed — media first, the manifest
LAST (the web host refuses a manifest that would shrink a gallery by more than half). Transcripts: each Whisper output's
.vtt then its job.json (which triggers the ingest into the transcript store on the web host).
Run by video_studio_worker.py every 30 minutes (--sync-every) as a low-priority child process.
Paths default to the directory this file lives in (MELEK_GEN_HOME overrides).
"""
import argparse, glob, json, os, subprocess, sys, tempfile, time, urllib.parse, urllib.request

BASE = os.environ.get("VSTUDIO_BASE", "").rstrip("/")
TOK = os.environ.get("VSTUDIO_WORKER_TOKEN", "")
GEN = os.environ.get("MELEK_GEN_HOME") or os.path.dirname(os.path.abspath(__file__))
PY = os.environ.get("MEDIA_SYNC_PY") or os.path.join(GEN, "face-venv", "bin", "python")
EXTS = (".jpg", ".jpeg", ".png", ".webp", ".mp4", ".json", ".vtt")


def req(method, path, data=None, size=None, timeout=60):
    headers = {"authorization": f"Bearer {TOK}", "user-agent": "hathor-media-sync/1"}
    if data is not None:
        headers["content-type"] = "application/octet-stream"
        if size is not None:
            headers["content-length"] = str(size)
    r = urllib.request.Request(BASE + path, method=method, data=data, headers=headers)
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read() or b"{}")


def remote_list(target):
    try:
        return req("GET", f"/video-studio/api/worker/sync/{target}/list").get("files", {})
    except Exception as e:
        print(f"{target}: list failed: {e}", flush=True)
        return None


def put(target, rel, local, dry=False):
    if dry:
        print(f"  would PUT {target}/{rel} ({os.path.getsize(local)} B)")
        return True
    size = os.path.getsize(local)
    try:
        with open(local, "rb") as fh:
            j = req("PUT", f"/video-studio/api/worker/sync/{target}/{urllib.parse.quote(rel)}", data=fh, size=size, timeout=3600)
        if not j.get("ok"):
            print(f"  {target}/{rel}: refused: {j.get('error')}", flush=True)
        return bool(j.get("ok"))
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read() or b"{}").get("error")
        except Exception:
            msg = str(e)
        print(f"  {target}/{rel}: HTTP {e.code} {msg}", flush=True)
        return False
    except Exception as e:
        print(f"  {target}/{rel}: {e}", flush=True)
        return False


def walk(root, depth=4):
    """{relpath: localpath} for allowed files under root (≤ depth levels, no dotfiles)."""
    out = {}
    root = os.path.realpath(root)
    for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
        rel_dir = os.path.relpath(dirpath, root)
        level = 0 if rel_dir == "." else rel_dir.count(os.sep) + 1
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and level < depth - 1]
        for f in filenames:
            if f.startswith(".") or not f.lower().endswith(EXTS):
                continue
            rel = f if rel_dir == "." else os.path.join(rel_dir, f).replace(os.sep, "/")
            out[rel] = os.path.join(dirpath, f)
    return out


def sync_dir(target, root, manifest, files=None, dry=False):
    """PUT new/changed files from root (or the given {rel: local} map) — manifest last."""
    remote = remote_list(target)
    if remote is None:
        return 0
    local = files if files is not None else walk(root)
    changed = [r for r, p in local.items() if r != manifest and remote.get(r) != os.path.getsize(p)]
    sent = sum(1 for r in sorted(changed) if put(target, r, local[r], dry))
    if manifest and manifest in local and (changed or remote.get(manifest) != os.path.getsize(local[manifest])):
        sent += 1 if put(target, manifest, local[manifest], dry) else 0
    print(f"{target}: {len(local)} local, {len(remote)} on the web, {len(changed)} new/changed, {sent} sent", flush=True)
    return sent


def run(cmd):
    r = subprocess.run(cmd, cwd=GEN, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"build failed: {' '.join(cmd[:3])}…\n{r.stderr[-800:]}", flush=True)
    return r.returncode == 0


def sync_remakes(dry):
    bundle = os.path.join(GEN, "remakes_bundle.sync")
    srcs = ["refs"] + sorted(glob.glob(os.path.join(GEN, "remake_extra", "*/")))
    extras = sorted(glob.glob(os.path.join(GEN, "remake_extra", "*.jsonl")))
    if not run([PY, "genai_remakes_publish.py", "remakes", *srcs, "--out", bundle, "--extra", *extras]):
        return 0
    return sync_dir("remakes", bundle, "manifest.json", dry=dry)


def sync_anims(dry):
    if not run([PY, "hathor_animate.py", "publish", "--out", os.path.join(GEN, "anims"), "--bundle", os.path.join(GEN, "anims_bundle")]):
        return 0
    return sync_dir("anims", os.path.join(GEN, "anims_bundle"), "manifest.json", dry=dry)


def sync_docs(dry):
    out = os.path.join(GEN, "docs_out")
    films, files = [], {}
    for d in sorted(os.listdir(out)) if os.path.isdir(out) else []:
        fj = os.path.join(out, d, "film.json")
        if "." in d or not os.path.exists(fj) or not os.path.exists(os.path.join(out, d, "film.mp4")):
            continue  # skip backups (kush-nile.v1) and half-rendered films
        try:
            f = json.load(open(fj))
        except Exception:
            continue
        f.pop("recipe", None)
        films.append(f)
        for name in ("film.mp4", "poster.jpg", "film.json"):
            p = os.path.join(out, d, name)
            if os.path.exists(p):
                files[f"{d}/{name}"] = p
    if not films:
        return 0
    films.sort(key=lambda f: -(f.get("made") or 0))
    tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump({"updated": int(time.time() * 1000), "films": films}, tmp)
    tmp.close()
    files["manifest.json"] = tmp.name
    try:
        return sync_dir("docs", out, "manifest.json", files=files, dry=dry)
    finally:
        os.unlink(tmp.name)


def sync_maps(dry):
    out = os.path.join(GEN, "maps", "out")
    return sync_dir("maps", out, "index.json", dry=dry) if os.path.isdir(out) else 0


def sync_transcripts(dry):
    work = os.path.join(GEN, "pentecaust", "work")
    remote = remote_list("transcripts")
    if remote is None:
        return 0
    sent = 0
    for vtt in sorted(glob.glob(os.path.join(work, "*", "*", "en.ai-whisper.vtt"))):
        d = os.path.dirname(vtt)
        src, iid = os.path.basename(os.path.dirname(d)), os.path.basename(d)
        job = os.path.join(d, "job.json")
        rel = f"{src}/{iid}"
        if not os.path.exists(job) or remote.get(f"{rel}/job.json") == os.path.getsize(job):
            continue  # not finished yet, or already ingested
        if put("transcripts", f"{rel}/en.ai-whisper.vtt", vtt, dry) and put("transcripts", f"{rel}/job.json", job, dry):
            sent += 2
    print(f"transcripts: {sent // 2} new items sent", flush=True)
    return sent


TARGETS = {"remakes": sync_remakes, "anims": sync_anims, "docs": sync_docs, "maps": sync_maps, "transcripts": sync_transcripts}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=",".join(TARGETS))
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    if not BASE or len(TOK) < 24:
        sys.exit("set VSTUDIO_BASE and VSTUDIO_WORKER_TOKEN")
    t0 = time.time()
    for name in [x.strip() for x in a.only.split(",") if x.strip()]:
        try:
            TARGETS[name](a.dry)
        except Exception as e:
            print(f"{name}: error {e}", flush=True)
    print(f"media sync done in {time.time() - t0:.0f}s", flush=True)
