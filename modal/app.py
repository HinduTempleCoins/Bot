# app.py — MELEK's PRIVATE brain layer on Modal serverless GPU.
#
# ══════════════════════════════════════════════════════════════════════════════════════════════════
# WHAT THIS IS, AND WHY IT IS NOT A MODEL API.
# ══════════════════════════════════════════════════════════════════════════════════════════════════
# The operator's privacy rule: no external model API ever sees MELEK's private data (chat, transcripts,
# briefs). So the private lane runs OUR OWN open-weight model on GPUs we RENT BY THE SECOND from Modal.
# The weights are ours, the container is ours, the data flows only between our box and our Modal app.
# Modal is the landlord of the hardware; it is not a model provider and never sees a prompt as a
# "provider" would — there is no third-party inference call in this file. That is the whole point.
#
# It does exactly two jobs the operator specified, and nothing stays running between them:
#   (b) a SCHEDULED batch, 2×/day (before noon + before midnight), that runs the private brain jobs —
#       the transcript-reading conference synthesis and the brief-grader scoring — then spins down;
#   (c) an ON-DEMAND chat endpoint for soapy.blog: cold-starts on the first call, serves the admin
#       chat, and idles back to ZERO after `scaledown_window` seconds of silence. Idle cost = $0.
#
# COST DISCIPLINE is the reason for the shape. min_containers=0 means no request → no container → no
# spend. Weights load from a Modal Volume (a disk read, ~30-90s), not a fresh HuggingFace pull. The
# same class serves the endpoint AND the batch, so the model loads once per warm container either way.
#
# The request/response CONTRACT and the auth/clamp logic live in brain_lib.py (pure, offline-tested by
# smoke_test.py). This file is the Modal wiring around it. See README.md for the contract + deploy.
#
# Deploy:  modal deploy modal/app.py     → prints the chat endpoint URL (set MODAL_INFERENCE_URL)
# Prime:   modal run   modal/app.py::download_weights   → one-time: fill the weights Volume
# Probe:   modal run   modal/app.py::gpu_check          → prove a GPU attaches
# Batch:   modal run   modal/app.py::run_batch_now      → fire one batch off-schedule
import os

import modal

import brain_lib as L  # pure contract/auth/clamp logic; Modal mounts this module automatically

# ── configuration (env overrides; secrets are NEVER in code) ─────────────────────────────────────
MODEL = os.environ.get("BRAIN_MODEL", L.DEFAULT_MODEL)          # Qwen/Qwen2.5-7B-Instruct
GPU = os.environ.get("BRAIN_GPU", L.DEFAULT_GPU)               # "A10" (24 GB); "L4" = cheaper lever
SCALEDOWN = int(os.environ.get("BRAIN_SCALEDOWN", str(L.DEFAULT_SCALEDOWN)))
MAX_MODEL_LEN = int(os.environ.get("BRAIN_MAX_LEN", str(L.DEFAULT_MAX_MODEL_LEN)))

app = modal.App("melek-private-brain")

# Weights on a Volume so a cold start is a disk read, not a 15 GB download. download_weights() fills it.
weights = modal.Volume.from_name("melek-brain-weights", create_if_missing=True)

# Two secrets, matching the repo's existing names (infra/modal/brain.py, soapy.py):
#   melek-brain : MELEK_BRAIN_TOKEN  — the shared bearer the endpoint + batch check
#   huggingface : HF_TOKEN           — only needed for gated weights (e.g. Llama); Qwen needs none
BEARER_SECRET = modal.Secret.from_name("melek-brain", required_keys=["MELEK_BRAIN_TOKEN"])
HF_SECRET = modal.Secret.from_name("huggingface", required_keys=["HF_TOKEN"])

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "vllm==0.11.2",
        "huggingface_hub[hf_transfer]==0.36.0",
        "fastapi[standard]",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1", "HF_HOME": "/weights/hf", "VLLM_USE_V1": "1"})
    # ship the pure contract module into the image so run_batch/endpoint can import it
    .add_local_python_source("brain_lib")
)

with image.imports():
    # imported only inside the container (never on the local deploy machine)
    from fastapi import Request
    from fastapi.responses import JSONResponse


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# The brain: our weights, our GPU, scaled to zero. One class = one model load = both jobs.
# ══════════════════════════════════════════════════════════════════════════════════════════════════
@app.cls(
    image=image,
    gpu=GPU,
    volumes={"/weights": weights},
    secrets=[BEARER_SECRET, HF_SECRET],
    scaledown_window=SCALEDOWN,   # idle this long, then die → $0 between calls
    min_containers=0,             # <- the line that makes idle free
    timeout=60 * 30,
)
@modal.concurrent(max_inputs=4)   # a warm GPU can batch a few chat turns at once
class Brain:
    @modal.enter()
    def load(self):
        """Load the model once per warm container, on the GPU. Runs on cold start only."""
        from vllm import LLM
        self.llm = LLM(
            model=MODEL,
            download_dir="/weights/hf",
            max_model_len=MAX_MODEL_LEN,
            gpu_memory_utilization=0.90,
            enforce_eager=False,
        )
        self.model_name = MODEL

    def _generate(self, messages, max_tokens, temperature):
        """The one code path both the endpoint and the batch generate through. Our weights only."""
        from vllm import SamplingParams
        if not messages:
            return "", {}
        params = SamplingParams(
            max_tokens=int(max_tokens),
            temperature=float(temperature),
            top_p=0.95,
        )
        # vLLM's chat() applies the model's own chat template to [{role, content}...]
        outputs = self.llm.chat(messages, params)
        text = ""
        usage = {}
        if outputs:
            out = outputs[0]
            if out.outputs:
                text = out.outputs[0].text or ""
            usage = {
                "prompt_tokens": len(out.prompt_token_ids or []),
                "completion_tokens": len(out.outputs[0].token_ids or []) if out.outputs else 0,
            }
        return text.strip(), usage

    # ── (c) THE ON-DEMAND CHAT ENDPOINT ─────────────────────────────────────────────────────────
    # POST {messages, system?, max_tokens?, temperature?, warmup?}  ->  {ok, text, model, warmup, usage}
    # Bearer auth via `Authorization: Bearer <MELEK_BRAIN_TOKEN>`. Scale-to-zero: idle costs nothing.
    @modal.fastapi_endpoint(method="POST")
    async def chat(self, body: dict, request: Request):
        expected = os.environ.get("MELEK_BRAIN_TOKEN", "")
        auth = request.headers.get("authorization", "")
        if not L.check_bearer(auth, expected):
            return JSONResponse(L.error_response("unauthorized", "unauthorized"), status_code=401)

        req = L.parse_chat_request(body)
        if not req["ok"]:
            return JSONResponse(L.error_response(req["error"], "bad_request"), status_code=400)

        # warmup (or an empty-turn body): the container is already up by the time we're here, which is
        # the whole job. Return immediately, no generation, no tokens billed for output.
        if req["warmup"]:
            return L.shape_response("", model=self.model_name, warmup=True)

        text, usage = self._generate(req["messages"], req["max_tokens"], req["temperature"])
        return L.shape_response(text, model=self.model_name, usage=usage)

    # ── (b) THE 2×/DAY BATCH — private brain jobs, generated on our own model ────────────────────
    @modal.method()
    def run_batch(self):
        """Run the conference synthesis + brief grading against inputs the box holds, on our weights.

        Data location: the transcripts and briefs live on the operator's box (private data dir),
        which Modal cannot read directly. So the box exposes read/write endpoints (BOX_BASE_URL, same
        MELEK_BRAIN_TOKEN bearer); this pulls the raw material, GENERATES here on our GPU, and pushes
        the result back. Nothing leaves our infrastructure and no external model API is touched.

        Soft-fails every step: a scheduled job must return a result, never raise into the scheduler.
        If BOX_BASE_URL is unset the batch no-ops with a clear reason (nothing to do yet).
        """
        box = os.environ.get("BOX_BASE_URL", "").rstrip("/")
        token = os.environ.get("MELEK_BRAIN_TOKEN", "")
        if not box:
            print("[batch] BOX_BASE_URL unset — nothing to pull; skipping")
            return {"ok": False, "reason": "no BOX_BASE_URL", "jobs": {}}

        jobs = {}
        jobs["conference"] = self._job_conference(box, token)
        jobs["briefs"] = self._job_briefs(box, token)
        print(f"[batch] done: {jobs}")
        return {"ok": True, "jobs": jobs}

    def _job_conference(self, box, token):
        """Transcript-reading conference synthesis for the upcoming 12-and-12."""
        data = _box_get(f"{box}/brain/conference/inputs", token) or {}
        items = data.get("items") or []
        if not items:
            return {"synthesized": False, "reason": "no inputs"}
        corpus = "\n\n---\n\n".join(str(x)[:4000] for x in items[:40])
        messages = L.normalize_messages(
            [{"role": "user", "content":
              "Read the half-day's transcripts and briefs below and write a tight synthesis for the "
              "12-and-12: what was decided, what is open, and the one or two things worth raising. "
              "Plain, specific, no filler.\n\n" + corpus}],
            system="You are Hathor, synthesizing the conference record. Speak from your own weights.",
        )
        text, _ = self._generate(messages, max_tokens=900, temperature=0.6)
        ok = _box_post(f"{box}/brain/conference/synthesis", token, {"text": text, "count": len(items)})
        return {"synthesized": bool(text), "posted": bool(ok), "read": len(items)}

    def _job_briefs(self, box, token):
        """Brief-grader scoring: produce the JSON assessment grade-briefs.mjs records (its schema)."""
        data = _box_get(f"{box}/brain/briefs/pending", token) or {}
        briefs = data.get("briefs") or []
        if not briefs:
            return {"graded": 0, "reason": "no pending briefs"}
        graded = 0
        for b in briefs[:40]:
            bid = str(b.get("id", "")).strip()
            body = str(b.get("body", ""))[:12000]
            evidence = str(b.get("evidence", ""))[:4000]
            if not bid or not body:
                continue
            messages = L.normalize_messages(
                [{"role": "user", "content":
                  "Grade this resident-AI BRIEF as PERCENTAGES across four buckets using the operator "
                  "evidence. Return ONLY JSON: {\"pct_completed\":N,\"pct_undone\":N,\"pct_ignored\":N,"
                  "\"pct_nonsense\":N,\"hallucination_tier\":\"none|mistaken-structure-corrected|"
                  "absolute-hallucination\",\"notes\":\"one sentence\"}. The four percentages sum to "
                  "~100.\n\nBRIEF:\n" + body + "\n\nOPERATOR EVIDENCE:\n" + evidence}],
                system="You are the MELEK brief grader. Output strict JSON, no prose.",
            )
            text, _ = self._generate(messages, max_tokens=400, temperature=0.2)
            if _box_post(f"{box}/brain/briefs/grade", token, {"id": bid, "grade_json": text}):
                graded += 1
        return {"graded": graded, "seen": len(briefs)}


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# The scheduler: a cheap CPU function that fires 2×/day and pokes the GPU class. Nothing GPU-backed
# stays up between these — the GPU container lives only for the length of run_batch, then scales down.
# ══════════════════════════════════════════════════════════════════════════════════════════════════
@app.function(
    image=image,
    schedule=modal.Cron(L.BATCH_CRON, timezone=L.BATCH_TZ),   # "30 11,23 * * *" America/Chicago
    secrets=[BEARER_SECRET],
    timeout=60 * 30,
)
def scheduled_batch():
    """Fires before noon and before midnight (America/Chicago). Runs the batch, then everything dies."""
    return Brain().run_batch.remote()


@app.function(image=image, secrets=[BEARER_SECRET], timeout=60 * 30)
def run_batch_now():
    """Manual batch, for testing the path off-schedule: modal run modal/app.py::run_batch_now"""
    return Brain().run_batch.remote()


# ── one-time weight priming + a GPU probe ─────────────────────────────────────────────────────────
@app.function(image=image, volumes={"/weights": weights}, secrets=[HF_SECRET], timeout=60 * 60)
def download_weights():
    """Fill the weights Volume once so every cold start after this is a fast disk read, not a download."""
    from huggingface_hub import snapshot_download
    snapshot_download(MODEL, cache_dir="/weights/hf")
    weights.commit()
    return f"cached {MODEL} to the melek-brain-weights volume"


@app.function(gpu=GPU, image=image, timeout=120)
def gpu_check():
    """Prove a GPU actually attaches before blaming the serving layer."""
    import subprocess
    return subprocess.run(["nvidia-smi"], capture_output=True, text=True).stdout


# ── box IO helpers (stdlib only; soft-fail — a scheduled job never raises into the scheduler) ─────
def _box_get(url, token, timeout=60):
    import json
    import urllib.request
    import urllib.error
    req = urllib.request.Request(url, method="GET",
                                 headers={"authorization": f"Bearer {token}" if token else ""})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except Exception as e:  # noqa: BLE001
        print(f"[batch] GET {url} failed: {e}")
        return None


def _box_post(url, token, payload, timeout=60):
    import json
    import urllib.request
    import urllib.error
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, method="POST", data=data, headers={
        "content-type": "application/json",
        "authorization": f"Bearer {token}" if token else "",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            r.read()
            return True
    except Exception as e:  # noqa: BLE001
        print(f"[batch] POST {url} failed: {e}")
        return False


@app.local_entrypoint()
def main():
    """`modal run modal/app.py` — cheap sanity path: prove the GPU attaches."""
    print("GPU:", gpu_check.remote())
