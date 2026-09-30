"""gpu_puller.py — a GPU runner for the image pool's PULL LANE (Kaggle, Colab, Modal, or any GPU box).

Free GPU notebooks cannot accept incoming connections, so this works like a mining client: it asks the pool for the
next background image job, renders it on the GPU with the SAME pipeline our CPU workers use (genai_cpu_worker.py with
CPU_SD_DEVICE=cuda: Dreamshaper-8 + LCM + ControlNet structure + IP-Adapter), and posts the picture back. It never
sees any secret beyond its pull token, and it only receives background production jobs (never customer jobs).

The pool's lane is OFF by default (SD_POOL_PULL_ENABLED=0 on the pool); a runner started while it is off gets 401 and
exits. Stops by itself after MAX_MINUTES, or after IDLE_MINUTES with nothing to do — so free quota is not burned idle.

  POOL_URL=https://…/gpu-pool PULL_TOKEN=… RUNNER_NAME=kaggle-1 python gpu_puller.py
Env: POOL_URL, PULL_TOKEN (required); RUNNER_NAME, MAX_MINUTES (default 540), IDLE_MINUTES (default 15).
"""
import json, os, sys, time, urllib.error, urllib.request

POOL = os.environ.get("POOL_URL", "").rstrip("/")
TOKEN = os.environ.get("PULL_TOKEN", "")
NAME = os.environ.get("RUNNER_NAME", "gpu-runner")
MAX_S = float(os.environ.get("MAX_MINUTES", "540")) * 60
IDLE_S = float(os.environ.get("IDLE_MINUTES", "15")) * 60


def post(path, body, timeout=60):
    req = urllib.request.Request(POOL + path, method="POST", data=json.dumps(body).encode(),
                                 headers={"authorization": f"Bearer {TOKEN}", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, (json.loads(r.read() or b"{}") if r.status != 204 else None)


def run(render_fn=None, norm_fn=None, clock=time.time, sleep=time.sleep):
    """the loop; render_fn/norm_fn injectable for offline tests. Returns the number of images made."""
    if not POOL or not TOKEN:
        print("set POOL_URL and PULL_TOKEN", flush=True); return 0
    if render_fn is None:
        os.environ.setdefault("CPU_SD_DEVICE", "cuda")
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")
        import genai_cpu_worker as W
        W.pipeline()                                 # load once, before taking any job
        render_fn, norm_fn = W.render, W.norm_job
    start = last_work = clock(); made = 0
    while clock() - start < MAX_S and clock() - last_work < IDLE_S:
        try:
            code, r = post("/pull", {"name": NAME})
        except urllib.error.HTTPError as e:
            if e.code == 401:
                print("pull lane is closed (or bad token) — exiting", flush=True); return made
            sleep(10); continue
        except Exception:
            sleep(10); continue
        if code == 204 or not r or not r.get("job"):
            sleep(5); continue
        job = r["job"]
        try:
            res = render_fn(norm_fn(job["body"]))
        except Exception as e:
            res = {"ok": False, "error": f"gpu render failed: {type(e).__name__}"}
        try:
            post(f"/done/{job['id']}", {"result": res}, timeout=120)
        except Exception:
            pass                                     # the pool re-queues untaken results after its timeout
        made += 1 if res.get("ok") else 0; last_work = clock()
        print(f"{NAME}: job {job['id']} {'ok' if res.get('ok') else 'error'} ({res.get('ms', 0)} ms)", flush=True)
    print(f"{NAME}: stopping — {made} images", flush=True)
    return made


if __name__ == "__main__":
    run()
