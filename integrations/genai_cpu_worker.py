"""genai_cpu_worker.py — OUR image generator for the Studio, on OUR server's CPU (melek-witnesses).

Replaces the JS SD2.1 worker (~15 min/image) with diffusers on CPU:
  Dreamshaper-8 (SD1.5) + LCM-LoRA  -> 6 steps, ~2.5 min for 512x768 on 8 cores
  + IP-Adapter (plus, SD1.5)        -> CHARACTER REFERENCE: a reference image (Hathor's head, or a
                                       customer's character) conditions the render, so the character is
                                       generated INTO the new scene — not pasted.

Same HTTP contract as integrations/genai-cpu-diffusion.mjs, so the Studio's `cpusd` provider is unchanged:
  GET  /health                -> {ok, loaded, busy, queued, model}
  POST /jobs      {prompt, negativePrompt?, steps?, seed?, size?, image?:{base64,mime}, strength?, character?}
                              -> 202 {ok, id, position}
  GET  /jobs/<id>             -> {ok, status: queued|running|done|error, result?}
  POST /generate  (same body) -> blocks until done (kept for compatibility)
Auth: every route except /health needs `Authorization: Bearer $CPU_SD_TOKEN` when CPU_SD_TOKEN is set.
`character: "hathor"` uses Hathor's canonical head (CPU_SD_HATHOR_REF) as the reference when no image is sent.

Run:  PORT=8510 HOST=0.0.0.0 CPU_SD_TOKEN=... python genai_cpu_worker.py
Tests: python -m unittest integrations/test_genai_cpu_worker.py   (fully offline; the pipeline is injected)
"""
import base64, io, json, os, queue, secrets, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE_MODEL = os.environ.get("CPU_SD_BASE", "Lykon/dreamshaper-8")
LCM_LORA = os.environ.get("CPU_SD_LCM_LORA", "latent-consistency/lcm-lora-sdv1-5")
HATHOR_REF = os.environ.get("CPU_SD_HATHOR_REF", "/opt/melek-gen/assets/hathor-head-original.png")
THREADS = int(os.environ.get("CPU_SD_THREADS", "8"))
DEFAULT_NEG = "blurry, low quality, deformed, extra limbs, bad hands, text, watermark"
JOB_TTL = 30 * 60


def _env(k, d=""):
    v = os.environ.get(k)
    return v if v not in (None, "") else d


# ── pipeline (lazy, injectable for tests) ───────────────────────────────────────────────────────
def _load_real_pipeline():
    import torch
    from diffusers import AutoPipelineForText2Image, LCMScheduler
    torch.set_num_threads(THREADS)
    pipe = AutoPipelineForText2Image.from_pretrained(BASE_MODEL, torch_dtype=torch.float32, safety_checker=None)
    pipe.scheduler = LCMScheduler.from_config(pipe.scheduler.config)
    pipe.load_lora_weights(LCM_LORA)
    pipe.fuse_lora()
    pipe.load_ip_adapter("h94/IP-Adapter", subfolder="models", weight_name="ip-adapter-plus_sd15.safetensors")
    return pipe


_loader = _load_real_pipeline
_pipe = None
_pipe_lock = threading.Lock()


def set_loader(fn):
    """Tests inject a fake pipeline loader."""
    global _loader, _pipe
    _loader, _pipe = fn, None


def pipeline():
    global _pipe
    with _pipe_lock:
        if _pipe is None:
            _pipe = _loader()
        return _pipe


# ── job normalisation ───────────────────────────────────────────────────────────────────────────
def norm_job(body):
    body = body or {}
    prompt = " ".join(str(body.get("prompt") or "").split())[:1500]
    neg = str(body.get("negativePrompt") or DEFAULT_NEG)[:600]
    try:
        steps = int(body.get("steps"))
    except (TypeError, ValueError):
        steps = 6
    steps = steps if 2 <= steps <= 8 else 6  # LCM: more steps only costs time
    try:
        seed = int(body.get("seed"))
        if seed < 0:
            raise ValueError
    except (TypeError, ValueError):
        seed = secrets.randbelow(2 ** 31)
    w, h = 512, 768
    size = str(body.get("size") or "")
    if "x" in size:
        try:
            w, h = (max(256, min(768, int(p)) // 8 * 8) for p in size.lower().split("x")[:2])
        except ValueError:
            pass
    try:
        strength = float(body.get("strength"))
    except (TypeError, ValueError):
        strength = 0.6
    strength = strength if 0 < strength <= 1 else 0.6
    image = None
    img = body.get("image")
    if isinstance(img, dict) and img.get("base64"):
        image = str(img["base64"])
    character = str(body.get("character") or "").lower()
    return {"prompt": prompt, "neg": neg, "steps": steps, "seed": seed, "w": w, "h": h,
            "strength": strength, "image_b64": image, "character": character}


def _reference(job):
    from PIL import Image
    if job["image_b64"]:
        return Image.open(io.BytesIO(base64.b64decode(job["image_b64"]))).convert("RGB")
    if job["character"] == "hathor" and os.path.exists(HATHOR_REF):
        return Image.open(HATHOR_REF).convert("RGB")
    return None


def render(job):
    if not job["prompt"]:
        return {"ok": False, "error": "empty prompt"}
    t0 = time.time()
    pipe = pipeline()
    ref = _reference(job)
    try:
        import torch
        gen = torch.Generator().manual_seed(job["seed"])
    except ImportError:  # tests
        gen = job["seed"]
    kwargs = dict(prompt=job["prompt"], negative_prompt=job["neg"], num_inference_steps=job["steps"],
                  guidance_scale=1.5, generator=gen, width=job["w"], height=job["h"])
    if ref is not None:
        pipe.set_ip_adapter_scale(job["strength"])
        kwargs["ip_adapter_image"] = ref
        mode = "character"
    else:
        # IP-Adapter is loaded, so it still expects an image; scale 0 makes it a no-op
        from PIL import Image
        pipe.set_ip_adapter_scale(0.0)
        kwargs["ip_adapter_image"] = Image.new("RGB", (224, 224))
        mode = "txt2img"
    img = pipe(**kwargs).images[0]
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return {"ok": True, "mime": "image/png", "base64": base64.b64encode(buf.getvalue()).decode(),
            "ms": int((time.time() - t0) * 1000), "mode": mode, "seed": job["seed"]}


# ── single-flight queue + async jobs ────────────────────────────────────────────────────────────
_q = queue.Queue()
_jobs = {}
_jobs_lock = threading.Lock()
_state = {"busy": False, "loaded": False}


def _worker_loop():
    while True:
        jid, job, done_evt, holder = _q.get()
        _state["busy"] = True
        with _jobs_lock:
            if jid in _jobs:
                _jobs[jid]["status"] = "running"
        try:
            res = render(job)
        except Exception as e:  # never crash the loop
            res = {"ok": False, "error": f"render failed: {type(e).__name__}"}
        _state["busy"] = False
        _state["loaded"] = _pipe is not None
        with _jobs_lock:
            if jid in _jobs:
                _jobs[jid]["status"] = "done" if res.get("ok") else "error"
                _jobs[jid]["result"] = res
        if holder is not None:
            holder.append(res)
        if done_evt is not None:
            done_evt.set()
        _q.task_done()


_thread = None


def start_worker():
    global _thread
    if _thread is None:
        _thread = threading.Thread(target=_worker_loop, daemon=True)
        _thread.start()


def _sweep():
    now = time.time()
    with _jobs_lock:
        for k in [k for k, v in _jobs.items() if now - v["created"] > JOB_TTL]:
            del _jobs[k]


def submit_job(body):
    start_worker()
    _sweep()
    job = norm_job(body)
    if not job["prompt"]:
        return {"ok": False, "error": "empty prompt"}
    jid = secrets.token_hex(8)
    with _jobs_lock:
        _jobs[jid] = {"status": "queued", "created": time.time(), "result": None}
    position = _q.qsize() + (1 if _state["busy"] else 0)
    _q.put((jid, job, None, None))
    return {"ok": True, "id": jid, "position": position}


def job_status(jid):
    with _jobs_lock:
        rec = _jobs.get(str(jid or ""))
        if not rec:
            return {"ok": False, "error": "unknown job"}
        out = {"ok": True, "id": jid, "status": rec["status"]}
        if rec["status"] in ("done", "error"):
            out["result"] = rec["result"]
        return out


def generate_sync(body, timeout=20 * 60):
    start_worker()
    job = norm_job(body)
    if not job["prompt"]:
        return {"ok": False, "error": "empty prompt"}
    evt, holder = threading.Event(), []
    _q.put((None, job, evt, holder))
    evt.wait(timeout)
    return holder[0] if holder else {"ok": False, "error": "timed out"}


def status():
    return {"ok": True, "loaded": _pipe is not None, "busy": _state["busy"], "queued": _q.qsize(),
            "model": f"{BASE_MODEL}+LCM+IP-Adapter"}


# ── HTTP ────────────────────────────────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def _send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authed(self):
        tok = _env("CPU_SD_TOKEN")
        return (not tok) or self.headers.get("authorization", "") == f"Bearer {tok}"

    def _body(self):
        n = int(self.headers.get("content-length") or 0)
        if n > 12 * 1024 * 1024:
            return None
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return False

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/health":
            return self._send(200, status())
        if not self._authed():
            return self._send(401, {"ok": False, "error": "unauthorized"})
        if path.startswith("/jobs/"):
            out = job_status(path[6:])
            return self._send(200 if out["ok"] else 404, out)
        return self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        path = self.path.split("?")[0]
        if not self._authed():
            return self._send(401, {"ok": False, "error": "unauthorized"})
        body = self._body()
        if body is None:
            return self._send(413, {"ok": False, "error": "body too large"})
        if body is False:
            return self._send(400, {"ok": False, "error": "bad json"})
        if path == "/jobs":
            out = submit_job(body)
            return self._send(202 if out["ok"] else 422, out)
        if path == "/generate":
            out = generate_sync(body)
            return self._send(200 if out.get("ok") else 422, out)
        return self._send(404, {"ok": False, "error": "not found"})


def main():
    port, host = int(_env("PORT", "8510")), _env("HOST", "127.0.0.1")
    start_worker()
    if _env("CPU_SD_PRELOAD", "1") == "1":
        threading.Thread(target=lambda: (pipeline(), print("pipeline loaded", flush=True)), daemon=True).start()
    print(f"cpu worker (python) on http://{host}:{port} ({BASE_MODEL}+LCM+IP-Adapter)", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
