# brain-serve.py — the NATIVE brain. Our own weights, our own GPU, serving generation on Modal.
#
# This is the front lobe: the thing the operator talks to. The API ensemble (groq/cerebras/mistral/
# cloudflare/github) stops being the voice and moves to the back — checks and balances over the
# briefs, the transcripts and the repo. Renting cognition per call was always the placeholder.
#
# COST DISCIPLINE, which is the whole reason this is shaped the way it is. infra/modal/finetune.py
# already records the rule: "We do NOT serve 24/7 GPU here (that's the budget killer)." So this
# scales to ZERO. No request, no container, no spend. A cold start pays ~40-90s to load weights off
# a Modal Volume (not a fresh HuggingFace pull — that is what the volume is for); after that the
# container stays warm for SCALEDOWN seconds of silence and then dies. Idle cost is $0, not $0.03/hr.
#
# WHY OPENAI-COMPATIBLE. vLLM serves /v1/chat/completions, which means the native brain is a drop-in
# provider for integrations/llm-router.mjs — it goes in at the HEAD of the order and every existing
# caller (hathor-converse, soapy-coder, brief-builder, mom-synth) gets the native model with no code
# change, and falls through to the free APIs automatically when the GPU is cold or capacity is short.
# That is the fast/slow split from BRAIN_ARCHITECTURE.md, wired rather than described.
#
# BASE MODEL matches finetune.py on purpose (Qwen2.5-7B). The LoRA that finetune.py trains into the
# 'hathor-lora' volume is loadable here without re-basing — so the day Hathor's adapter is ready, this
# serves HER, not a stock model. Until then --lora is simply absent.
#
# Deploy:
#   modal deploy infra/modal/brain-serve.py
#   # prints the https://…modal.run base URL -> set MODAL_BRAIN_URL on the boxes
import os
import modal

MODEL = os.environ.get("BRAIN_MODEL", "Qwen/Qwen2.5-7B-Instruct")
GPU = os.environ.get("BRAIN_GPU", "A10G")            # 24 GB; a 7B in bf16 is ~15 GB with room to spare
SCALEDOWN = int(os.environ.get("BRAIN_SCALEDOWN", "300"))   # seconds of silence before the GPU dies
MAX_LEN = int(os.environ.get("BRAIN_MAX_LEN", "16384"))

# Weights live in a Volume so a cold start is a disk read, not a 15 GB download. This is the
# difference between a 60-second wake and a five-minute one.
weights = modal.Volume.from_name("melek-brain-weights", create_if_missing=True)
lora = modal.Volume.from_name("hathor-lora", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("vllm==0.11.2", "huggingface_hub[hf_transfer]==0.36.0", "fastapi[standard]")
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1", "HF_HOME": "/weights/hf", "VLLM_USE_V1": "1"})
)

app = modal.App("melek-brain-serve")

# The shared bearer. Same pattern integrations/modal-compute.mjs already uses for the embed lane.
secret = modal.Secret.from_name("melek-brain", required_keys=["MELEK_BRAIN_TOKEN"])


@app.function(
    image=image,
    gpu=GPU,
    volumes={"/weights": weights, "/lora": lora},
    secrets=[secret],
    scaledown_window=SCALEDOWN,
    timeout=60 * 30,
    min_containers=0,          # <- the line that makes idle free
)
@modal.concurrent(max_inputs=8)
@modal.web_server(port=8000, startup_timeout=15 * 60)
def serve():
    """vLLM's own OpenAI-compatible server, fronted by Modal and gated on a bearer token."""
    import subprocess

    cmd = [
        "vllm", "serve", MODEL,
        "--host", "0.0.0.0", "--port", "8000",
        "--max-model-len", str(MAX_LEN),
        "--served-model-name", "melek-brain", MODEL,
        # vLLM enforces this itself, so an unauthenticated caller never reaches the model.
        "--api-key", os.environ["MELEK_BRAIN_TOKEN"],
        "--download-dir", "/weights/hf",
    ]
    # Serve Hathor's adapter the moment finetune.py has produced one; stay stock until then.
    adapter = "/lora/hathor-languages"
    if os.path.isdir(adapter):
        cmd += ["--enable-lora", "--lora-modules", f"hathor={adapter}"]
    subprocess.Popen(" ".join(cmd), shell=True)


@app.function(image=image, gpu=GPU, timeout=120)
def gpu_check():
    """Cheap smoke test: prove a GPU actually attaches before blaming the serving layer."""
    import subprocess
    return subprocess.run(["nvidia-smi"], capture_output=True, text=True).stdout
