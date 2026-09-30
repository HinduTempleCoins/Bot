"""sd_pool.py — one front door (port 8510) for several CPU image workers with the same HTTP contract as
genai_cpu_worker.py. Every existing client (remakes, scenes, skulls, the Studio) keeps calling :8510 unchanged; the pool
sends each job to the backend with the shortest queue and remembers which backend owns which job id.

Backends come from SD_POOL_BACKENDS (JSON list of {"name","url","token"}), e.g. the worker's own GPU-less worker moved
to 127.0.0.1:8511 and a helper on another host. Customer jobs (no "priority":"low") prefer the first backend (the
strongest) unless it is busy; background jobs go wherever the queue is shortest. A backend that errors is skipped for
60 s. Auth: clients send the pool token (SD_POOL_TOKEN, = the old CPU_SD_TOKEN, so nothing changes for them).

  GET  /health          -> aggregate {ok, loaded, busy, queued, background, model, backends:[…]}
  POST /jobs            -> {ok, id:"<b>~<id>", position}
  GET  /jobs/<b>~<id>   -> forwarded to backend b
  POST /generate        -> forwarded (blocking)

PULL LANE (GPU runners that cannot accept connections — Kaggle, Colab, Modal): OFF unless SD_POOL_PULL_ENABLED=1.
A runner authenticates with SD_POOL_PULL_TOKEN and polls; only background jobs ("priority":"low") are offered to it,
and only while at least one runner has checked in within the last 90 s. A job a runner took but did not finish within
SD_POOL_PULL_TIMEOUT seconds (default 900) goes back on the lane.
  POST /pull   {name}          -> {job:{id, body}} | 204 (nothing to do)   — also the runner's heartbeat
  POST /done/<id> {result}     -> {ok}
  GET  /jobs/p~<id>            -> status of a pull-lane job (clients see ids like any other)
"""
import json, os, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BACKENDS = json.loads(os.environ.get("SD_POOL_BACKENDS", "[]"))
TOKEN = os.environ.get("SD_POOL_TOKEN", "")
PORT, HOST = int(os.environ.get("PORT", "8510")), os.environ.get("HOST", "0.0.0.0")
_down = {}                      # backend index -> time it may be retried
_lock = threading.Lock()
PULL_ON = os.environ.get("SD_POOL_PULL_ENABLED", "0") == "1"
PULL_TOKEN = os.environ.get("SD_POOL_PULL_TOKEN", "")
PULL_WEIGHT = float(os.environ.get("SD_POOL_PULL_WEIGHT", "20"))      # a GPU renders ~50x a CPU core-set
PULL_TIMEOUT = float(os.environ.get("SD_POOL_PULL_TIMEOUT", "900"))
_lane = {"seq": 0, "queue": [], "jobs": {}, "seen": {}}              # jobs: id -> {status, body, taken, result}


def lane_live():
    now = time.time()
    return PULL_ON and any(now - t < 90 for t in _lane["seen"].values())


def lane_requeue():
    now = time.time()
    for jid, j in _lane["jobs"].items():
        if j["status"] == "running" and now - j["taken"] > PULL_TIMEOUT:
            j["status"] = "queued"; _lane["queue"].insert(0, jid)


def lane_submit(body):
    with _lock:
        _lane["seq"] += 1
        jid = str(_lane["seq"])
        _lane["jobs"][jid] = {"status": "queued", "body": body, "taken": 0, "result": None, "at": time.time()}
        _lane["queue"].append(jid)
        return jid, len(_lane["queue"])


def call(b, method, path, body=None, timeout=30):
    req = urllib.request.Request(b["url"].rstrip("/") + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"authorization": f"Bearer {b.get('token', '')}", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read() or b"{}")


def health(i):
    if _down.get(i, 0) > time.time():
        return None
    try:
        _, h = call(BACKENDS[i], "GET", "/health", timeout=5)
        return h if h.get("ok") else None
    except Exception:
        with _lock:
            _down[i] = time.time() + 60
        return None


def load(h):
    return (1 if h.get("busy") else 0) + int(h.get("queued") or 0) + int(h.get("background") or 0)


def pick(customer):
    """a backend index, or "lane" for the GPU pull lane (background jobs only, when a runner is live)"""
    hs = [(i, health(i)) for i in range(len(BACKENDS))]
    if not customer and lane_live():
        best = min(((load(h) + 1) / float(BACKENDS[i].get("weight", 1)) for i, h in hs if h), default=1e9)
        if (len(_lane["queue"]) + 1) / PULL_WEIGHT < best:
            return "lane"
    live = [(i, h) for i, h in hs if h and h.get("loaded", True)]
    if not live:
        live = [(i, h) for i, h in hs if h]
    if not live:
        return None
    if customer and live[0][0] == 0 and not live[0][1].get("busy"):
        return 0
    # weight by capacity: a backend's "weight" (cores-ish) divides its load
    return min(live, key=lambda x: (load(x[1]) + 1) / float(BACKENDS[x[0]].get("weight", 1)))[0]


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(b)))
        self.end_headers(); self.wfile.write(b)

    def authed(self):
        return not TOKEN or self.headers.get("authorization", "") == f"Bearer {TOKEN}"

    def puller(self):
        return PULL_ON and bool(PULL_TOKEN) and self.headers.get("authorization", "") == f"Bearer {PULL_TOKEN}"

    def body(self):
        n = int(self.headers.get("content-length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def do_GET(self):
        if self.path == "/health":
            hs = [health(i) for i in range(len(BACKENDS))]
            live = [h for h in hs if h]
            return self.send(200, {"ok": bool(live), "loaded": any(h.get("loaded") for h in live), "busy": all(h.get("busy") for h in live) if live else True,
                                   "queued": sum(int(h.get("queued") or 0) for h in live), "background": sum(int(h.get("background") or 0) for h in live),
                                   "model": (live[0].get("model") if live else ""), "backends": [
                                       {"name": b["name"], "up": h is not None, "busy": bool(h and h.get("busy")), "queued": (h or {}).get("queued"),
                                        "background": (h or {}).get("background")} for b, h in zip(BACKENDS, hs)]})
        if not self.authed():
            return self.send(401, {"ok": False, "error": "unauthorized"})
        if self.path.startswith("/jobs/p~"):
            j = _lane["jobs"].get(self.path[len("/jobs/p~"):])
            if not j:
                return self.send(404, {"ok": False, "status": "error", "error": "unknown job"})
            return self.send(200, {"ok": True, "status": j["status"], "result": j["result"]})
        if self.path.startswith("/jobs/") and "~" in self.path:
            bi, jid = self.path[len("/jobs/"):].split("~", 1)
            try:
                code, r = call(BACKENDS[int(bi)], "GET", f"/jobs/{jid}")
                return self.send(code, r)
            except Exception as e:
                return self.send(502, {"ok": False, "status": "error", "error": f"backend: {type(e).__name__}"})
        return self.send(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path == "/pull" or self.path.startswith("/done/"):
            if not self.puller():
                return self.send(401, {"ok": False, "error": "pull lane closed or bad token"})
            b = self.body()
            if self.path == "/pull":
                with _lock:
                    _lane["seen"][str(b.get("name") or "runner")[:40]] = time.time()
                    lane_requeue()
                    jid = _lane["queue"].pop(0) if _lane["queue"] else None
                    if jid:
                        _lane["jobs"][jid].update(status="running", taken=time.time())
                if not jid:
                    self.send_response(204); self.end_headers(); return
                return self.send(200, {"ok": True, "job": {"id": jid, "body": _lane["jobs"][jid]["body"]}})
            j = _lane["jobs"].get(self.path[len("/done/"):])
            if not j:
                return self.send(404, {"ok": False, "error": "unknown job"})
            res = b.get("result") or {"ok": False, "error": "no result"}
            j.update(status="done" if res.get("ok") else "error", result=res)
            return self.send(200, {"ok": True})
        if not self.authed():
            return self.send(401, {"ok": False, "error": "unauthorized"})
        body = self.body()
        customer = str(body.get("priority") or "").lower() != "low"
        tried = set()
        while True:
            i = pick(customer)
            if i == "lane" and self.path == "/jobs":
                jid, pos = lane_submit(body)
                return self.send(202, {"ok": True, "id": f"p~{jid}", "position": pos, "backend": "gpu-lane"})
            if i == "lane":
                i = min(range(len(BACKENDS)), key=lambda k: k in tried) if BACKENDS else None
            if i is None or i in tried:
                return self.send(503, {"ok": False, "error": "no image backend available"})
            tried.add(i)
            try:
                if self.path == "/jobs":
                    code, r = call(BACKENDS[i], "POST", "/jobs", body)
                    if r.get("id"):
                        r["id"] = f"{i}~{r['id']}"
                    r["backend"] = BACKENDS[i]["name"]
                    return self.send(code, r)
                if self.path == "/generate":
                    code, r = call(BACKENDS[i], "POST", "/generate", body, timeout=3600)
                    return self.send(code, r)
                return self.send(404, {"ok": False, "error": "not found"})
            except Exception:
                with _lock:
                    _down[i] = time.time() + 60


if __name__ == "__main__":
    print(f"sd pool on http://{HOST}:{PORT} → " + ", ".join(b["name"] for b in BACKENDS), flush=True)
    ThreadingHTTPServer((HOST, PORT), H).serve_forever()
