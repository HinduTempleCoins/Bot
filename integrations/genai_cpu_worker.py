"""genai_cpu_worker.py — OUR image generator for the Studio, on OUR server's CPU (our render server).

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
REMAKE mode: `structure:{base64}` (+ `structureScale` 0.2-1.5, default 0.8) keeps the LAYOUT of a source image
(canny edges -> ControlNet) while the prompt sets the new look. That is how a tomb painting, stele or mural is
re-rendered as a realistic historical scene, then half-vaporwave, then the full MELEK aesthetic — same people,
same poses, same composition. `image` alongside it still works as an IP-Adapter look/character reference.
Auth: every route except /health needs `Authorization: Bearer $CPU_SD_TOKEN` when CPU_SD_TOKEN is set.
`character: "hathor"` uses Hathor's canonical head (CPU_SD_HATHOR_REF) as the reference when no image is sent.

Run:  PORT=8510 HOST=0.0.0.0 CPU_SD_TOKEN=... python genai_cpu_worker.py
Tests: python -m unittest integrations/test_genai_cpu_worker.py   (fully offline; the pipeline is injected)
"""
import base64, io, itertools, json, os, queue, secrets, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
_HOME = os.environ.get("MELEK_GEN_HOME", os.path.dirname(os.path.abspath(__file__)))

BASE_MODEL = os.environ.get("CPU_SD_BASE", "Lykon/dreamshaper-8")
LCM_LORA = os.environ.get("CPU_SD_LCM_LORA", "latent-consistency/lcm-lora-sdv1-5")
HATHOR_REF = os.environ.get("CPU_SD_HATHOR_REF", os.path.join(_HOME, "assets/hathor-head-original.png"))
THREADS = int(os.environ.get("CPU_SD_THREADS", "8"))
# "cpu" on our servers. A user's own copy on a GPU (Modal, Colab, their PC) sets CPU_SD_DEVICE=cuda (or mps).
DEVICE = os.environ.get("CPU_SD_DEVICE", "cpu")
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
    dtype = torch.float16 if DEVICE in ("cuda", "mps") else torch.float32
    pipe = AutoPipelineForText2Image.from_pretrained(BASE_MODEL, torch_dtype=dtype, safety_checker=None)
    pipe.scheduler = LCMScheduler.from_config(pipe.scheduler.config)
    pipe.load_lora_weights(LCM_LORA)
    pipe.fuse_lora()
    pipe.load_ip_adapter("h94/IP-Adapter", subfolder="models", weight_name="ip-adapter-plus_sd15.safetensors")
    return pipe.to(DEVICE)


CONTROLNET_CANNY = os.environ.get("CPU_SD_CANNY", "lllyasviel/control_v11p_sd15_canny")
# SKELETON control: an OpenPose map (body + hands + face, see genai_annotate.py) pins where every limb, hand and finger
# goes, so the render keeps one hand per wrist; editing the skeleton moves the people.
CONTROLNET_POSE = os.environ.get("CPU_SD_OPENPOSE", "lllyasviel/control_v11p_sd15_openpose")
CONTROLNETS = {"canny": CONTROLNET_CANNY, "pose": CONTROLNET_POSE}
_cn_cache = {}


def _load_real_structure_pipeline(base, kinds=("canny",)):
    """ControlNet pipeline (one control, or several at once) that SHARES the base weights — only ControlNets add RAM."""
    from diffusers import ControlNetModel, StableDiffusionControlNetPipeline
    nets = []
    for k in kinds:
        if k not in _cn_cache:
            _cn_cache[k] = ControlNetModel.from_pretrained(CONTROLNETS[k], torch_dtype=base.unet.dtype).to(DEVICE)
        nets.append(_cn_cache[k])
    return StableDiffusionControlNetPipeline.from_pipe(base, controlnet=nets[0] if len(nets) == 1 else nets)


_loader = _load_real_pipeline
_structure_loader = _load_real_structure_pipeline
_spipes = {}
_pipe = None
_pipe_lock = threading.Lock()


def set_loader(fn):
    """Tests inject a fake pipeline loader."""
    global _loader, _pipe
    _loader, _pipe = fn, None


def set_structure_loader(fn):
    """Tests inject fn(base, kinds) -> fake pipeline."""
    global _structure_loader
    _structure_loader = fn
    _spipes.clear()


def structure_pipeline(kinds=("canny",)):
    kinds = tuple(kinds)
    base = pipeline()
    with _pipe_lock:
        if kinds not in _spipes:
            _spipes[kinds] = _structure_loader(base, kinds)
        return _spipes[kinds]


# ── automatic group skeletons: N clean OpenPose figures side by side, so a "many characters" scene gets exactly N
#    people with one body (and two hands) each, instead of the model merging or duplicating them.
_LIMBS = [(1,2),(1,5),(2,3),(3,4),(5,6),(6,7),(1,8),(8,9),(9,10),(1,11),(11,12),(12,13),(1,0),(0,14),(14,16),(0,15),(15,17)]
_COLS = [(255,0,0),(255,85,0),(255,170,0),(255,255,0),(170,255,0),(85,255,0),(0,255,0),(0,255,85),(0,255,170),
         (0,255,255),(0,170,255),(0,85,255),(0,0,255),(85,0,255),(170,0,255),(255,0,255),(255,0,170),(255,0,85)]


def group_pose(n, w, h, seated=False):
    """An OpenPose map with n front-facing figures evenly spaced (standing, or seated at a table height)."""
    from PIL import Image, ImageDraw
    n = max(1, min(6, int(n)))
    img = Image.new("RGB", (w, h), (0, 0, 0)); d = ImageDraw.Draw(img)
    slot = w / n
    s = min(slot / 170.0, h / (330.0 if seated else 560.0))   # figure scale (a seated upper body is shorter)
    for i in range(n):
        if seated:
            # upper bodies behind a table: hips hidden at the table edge, forearms forward on the tabletop, no legs
            cx, top = slot * (i + 0.5), h * 0.14
            P = lambda dx, dy: (cx + dx * s, top + dy * s)
            pts = {0: P(0, 40), 1: P(0, 90), 2: P(-45, 95), 3: P(-62, 170), 4: P(-28, 215), 5: P(45, 95), 6: P(62, 170), 7: P(28, 215),
                   8: P(-25, 255), 11: P(25, 255), 14: P(-10, 32), 15: P(10, 32), 16: P(-22, 38), 17: P(22, 38)}
        else:
            cx, top = slot * (i + 0.5), h * 0.08
            P = lambda dx, dy: (cx + dx * s, top + dy * s)
            pts = {0: P(0, 40), 1: P(0, 90), 2: P(-45, 95), 3: P(-60, 175), 4: P(-50, 250), 5: P(45, 95), 6: P(60, 175), 7: P(50, 250),
                   8: P(-25, 260), 9: P(-28, 400), 10: P(-30, 530), 11: P(25, 260), 12: P(28, 400),
                   13: P(30, 530), 14: P(-10, 32), 15: P(10, 32), 16: P(-22, 38), 17: P(22, 38)}
        lw = max(3, int(8 * s))
        for k, (a, b) in enumerate(_LIMBS):
            if a not in pts or b not in pts: continue
            d.line([pts[a], pts[b]], fill=tuple(int(v * 0.6) for v in _COLS[k]), width=lw)
        for k, (x, y) in pts.items():
            r = max(3, int(5 * s)); d.ellipse([x - r, y - r, x + r, y + r], fill=_COLS[k])
    return img


def edges(img, lo=60, hi=160):
    """Canny edge map of the source (cv2 if present, PIL fallback) — the layout the remake must keep."""
    from PIL import Image, ImageFilter, ImageOps
    try:
        import cv2, numpy as np
        g = np.array(img.convert("L"))
        # paintings/frescoes are full of brush texture and cracks; smoothing first keeps the figures' outlines
        # (the layout) and drops the paint surface, so a realistic remake isn't forced into painted strokes
        g = cv2.bilateralFilter(cv2.GaussianBlur(g, (5, 5), 0), 9, 60, 60)
        e = cv2.Canny(g, lo, hi)
        return Image.fromarray(e).convert("RGB")
    except ImportError:
        return ImageOps.autocontrast(img.convert("L").filter(ImageFilter.FIND_EDGES)).convert("RGB")


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
    # several references at once (Reference Studio: characters + objects) — all steer the same image
    images = [str(x["base64"]) for x in (body.get("images") or [])[:6] if isinstance(x, dict) and x.get("base64")]
    character = str(body.get("character") or "").lower()
    structure = None
    st = body.get("structure")
    if isinstance(st, dict) and st.get("base64"):
        structure = str(st["base64"])
    try:
        sscale = float(body.get("structureScale"))
    except (TypeError, ValueError):
        sscale = 0.8
    sscale = sscale if 0.2 <= sscale <= 1.5 else 0.8
    pose = None
    ps = body.get("pose")
    if isinstance(ps, dict) and ps.get("base64"):
        pose = str(ps["base64"])
    try:
        pscale = float(body.get("poseScale"))
    except (TypeError, ValueError):
        pscale = 1.0
    pscale = pscale if 0.2 <= pscale <= 1.5 else 1.0
    try:
        crowd = int(body.get("crowd") or 0)
    except (TypeError, ValueError):
        crowd = 0
    crowd = crowd if 2 <= crowd <= 6 else 0
    seated = bool(body.get("seated"))
    # which person (left to right) each reference image belongs to, so a face/look stays on its own figure
    slots = body.get("refSlots") if isinstance(body.get("refSlots"), list) else []
    ref_slots = [int(x) for x in slots[:6] if isinstance(x, int) and 0 <= x < 6] if crowd else []
    return {"prompt": prompt, "neg": neg, "steps": steps, "seed": seed, "w": w, "h": h,
            "strength": strength, "image_b64": image, "character": character,
            "structure_b64": structure, "structure_scale": sscale, "pose_b64": pose, "pose_scale": pscale, "sized": "x" in size,
            "images_b64": images, "crowd": crowd, "seated": seated,
            "ref_slots": ref_slots}


def _reference(job):
    from PIL import Image
    if job.get("images_b64"):
        refs = [Image.open(io.BytesIO(base64.b64decode(b))).convert("RGB") for b in job["images_b64"]]
        if job["image_b64"]:
            refs.insert(0, Image.open(io.BytesIO(base64.b64decode(job["image_b64"]))).convert("RGB"))
        return refs if len(refs) > 1 else refs[0]
    if job["image_b64"]:
        return Image.open(io.BytesIO(base64.b64decode(job["image_b64"]))).convert("RGB")
    if job["character"] == "hathor" and os.path.exists(HATHOR_REF):
        return Image.open(HATHOR_REF).convert("RGB")
    return None


def slot_masks(n, slots, w, h):
    """One mask per reference: white over that person's column of the group skeleton, black elsewhere."""
    from PIL import Image, ImageDraw
    out, col = [], w / n
    for i in slots:
        m = Image.new("L", (w, h), 0)
        ImageDraw.Draw(m).rectangle([int(col * i), 0, int(col * (i + 1)), h], fill=255)
        out.append(m)
    return out


def _long_prompt_kwargs(pipe, prompt, neg):
    """SD1.5's CLIP reads only 77 tokens; compel chunks longer prompts so the END of a prompt (often the look /
    aesthetic) is not silently dropped. Falls back to plain strings when compel or a real text encoder is absent."""
    try:
        from compel import Compel
        tok, te = pipe.tokenizer, pipe.text_encoder
    except (ImportError, AttributeError):
        return {"prompt": prompt, "negative_prompt": neg}
    c = Compel(tokenizer=tok, text_encoder=te, truncate_long_prompts=False)
    p, n = c.pad_conditioning_tensors_to_same_length([c(prompt), c(neg)])
    return {"prompt_embeds": p, "negative_prompt_embeds": n}


def render(job):
    if not job["prompt"]:
        return {"ok": False, "error": "empty prompt"}
    t0 = time.time()
    kinds, cimages, cscales = [], [], []
    if job.get("crowd") and not job.get("pose_b64"):          # many characters: one clean skeleton each
        if not job.get("sized"):
            job["w"], job["h"] = 768, 512
        kinds.append("pose"); cimages.append(group_pose(job["crowd"], job["w"], job["h"], job.get("seated"))); cscales.append(0.85)
    if job.get("structure_b64") or job.get("pose_b64"):
        from PIL import Image
        first = Image.open(io.BytesIO(base64.b64decode(job.get("structure_b64") or job["pose_b64"]))).convert("RGB")
        if not job.get("sized"):  # keep the source's proportions, longest side 768
            k = 768 / max(first.size)
            job["w"], job["h"] = (max(256, int(v * k) // 8 * 8) for v in first.size)
        if job.get("structure_b64"):
            kinds.append("canny"); cimages.append(edges(first.resize((job["w"], job["h"])))); cscales.append(job["structure_scale"])
        if job.get("pose_b64"):
            pm = Image.open(io.BytesIO(base64.b64decode(job["pose_b64"]))).convert("RGB")
            kinds.append("pose"); cimages.append(pm.resize((job["w"], job["h"]))); cscales.append(job["pose_scale"])
    structure = cimages or None
    pipe = structure_pipeline(kinds) if kinds else pipeline()
    ref = _reference(job)
    try:
        import torch
        gen = torch.Generator().manual_seed(job["seed"])
    except ImportError:  # tests
        gen = job["seed"]
    kwargs = dict(**_long_prompt_kwargs(pipe, job["prompt"], job["neg"]), num_inference_steps=job["steps"],
                  guidance_scale=1.5, generator=gen, width=job["w"], height=job["h"])
    if kinds:
        kwargs["image"] = cimages[0] if len(kinds) == 1 else cimages
        kwargs["controlnet_conditioning_scale"] = cscales[0] if len(kinds) == 1 else cscales
    if ref is not None:
        pipe.set_ip_adapter_scale(job["strength"])
        # a list = several references for the one IP-Adapter (their features are combined)
        refs = ref if isinstance(ref, list) else [ref]
        if job.get("crowd") and len(job.get("ref_slots") or []) == len(refs):
            # each reference only steers its own person's column (otherwise one face/horns spread to everyone)
            from diffusers.image_processor import IPAdapterMaskProcessor
            mk = IPAdapterMaskProcessor().preprocess(slot_masks(job["crowd"], job["ref_slots"], job["w"], job["h"]),
                                                    height=job["h"], width=job["w"])
            kwargs["ip_adapter_image"] = [refs]
            kwargs["cross_attention_kwargs"] = {"ip_adapter_masks": [mk.reshape(1, mk.shape[0], mk.shape[2], mk.shape[3])]}
            mode = "group"
        else:
            kwargs["ip_adapter_image"] = [ref] if isinstance(ref, list) else ref
            mode = "compose" if isinstance(ref, list) else "character"
    else:
        # IP-Adapter is loaded, so it still expects an image; scale 0 makes it a no-op
        from PIL import Image
        pipe.set_ip_adapter_scale(0.0)
        kwargs["ip_adapter_image"] = Image.new("RGB", (224, 224))
        mode = "txt2img"
    if kinds:
        tag = "+".join({"canny": "remake", "pose": "pose"}[k] for k in kinds)
        mode = tag if mode == "txt2img" else f"{tag}+{mode}"
    img = pipe(**kwargs).images[0]
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return {"ok": True, "mime": "image/png", "base64": base64.b64encode(buf.getvalue()).decode(),
            "ms": int((time.time() - t0) * 1000), "mode": mode, "seed": job["seed"]}


# ── single-flight queue + async jobs ────────────────────────────────────────────────────────────
# Two priorities: customers (0) always run before background production batches (1, body "priority":"low").
# FIFO within a priority. /health reports the customer-visible queue so the Studio can route traffic elsewhere.
_q = queue.PriorityQueue()
_seq = itertools.count()
_counts = {0: 0, 1: 0}
_counts_lock = threading.Lock()


def _prio(body):
    return 1 if str((body or {}).get("priority") or "").lower() == "low" else 0


def _put(prio, item):
    with _counts_lock:
        _counts[prio] += 1
    _q.put((prio, next(_seq), item))
_jobs = {}
_jobs_lock = threading.Lock()
_state = {"busy": False, "loaded": False}


def _worker_loop():
    while True:
        prio, _n, (jid, job, done_evt, holder) = _q.get()
        with _counts_lock:
            _counts[prio] -= 1
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
    prio = _prio(body)
    with _counts_lock:
        ahead = _counts[0] + (_counts[1] if prio == 1 else 0)
    position = ahead + (1 if _state["busy"] else 0)
    _put(prio, (jid, job, None, None))
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
    _put(_prio(body), (None, job, evt, holder))
    evt.wait(timeout)
    return holder[0] if holder else {"ok": False, "error": "timed out"}


def status():
    with _counts_lock:
        cust, bg = _counts[0], _counts[1]
    return {"ok": True, "loaded": _pipe is not None, "busy": _state["busy"], "queued": cust, "background": bg,
            "model": f"{BASE_MODEL}+LCM+IP-Adapter"}


# ── HTTP ────────────────────────────────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def _cors(self):
        """CPU_SD_CORS="*" (or a comma list of origins) lets a browser page call this worker directly — how a
        user's OWN copy (their PC, Colab, Modal GPU) plugs into the Studio with their key held in their browser.
        Unset (our production worker) = no CORS headers; the Studio's server calls it instead."""
        allow = _env("CPU_SD_CORS")
        if not allow:
            return
        origin = self.headers.get("origin", "")
        if allow.strip() == "*":
            self.send_header("access-control-allow-origin", "*")
        elif origin and origin in [o.strip() for o in allow.split(",")]:
            self.send_header("access-control-allow-origin", origin)
            self.send_header("vary", "origin")
        else:
            return
        self.send_header("access-control-allow-headers", "authorization, content-type")
        self.send_header("access-control-allow-methods", "GET, POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("content-length", "0")
        self.end_headers()

    def _send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
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
