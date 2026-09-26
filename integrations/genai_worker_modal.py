"""genai_worker_modal.py — run the Hathor Studio worker on YOUR OWN Modal GPU and plug it into the Studio.

This is the same worker that runs on our servers (genai_cpu_worker.py: Dreamshaper-8 + LCM + IP-Adapter + the
REMAKE ControlNet), unchanged, just on a GPU: ~2 s an image instead of ~2 min. You pay Modal for the GPU seconds
(new accounts get free monthly credit); we never see your token.

  1. pip install modal && modal setup                      # log in to your Modal account
  2. modal secret create hathor-worker CPU_SD_TOKEN=<make up a long random password>
  3. modal deploy genai_worker_modal.py                     # from a folder that also has genai_cpu_worker.py
  4. Modal prints a URL like https://<you>--hathor-studio-worker-serve.modal.run
  5. Studio → Your engines → "My own worker": paste that URL and the password from step 2. Done.

The page calls your worker straight from your browser (CPU_SD_CORS below allows only the Studio's origin),
using the same /jobs API our own servers speak.
"""
import subprocess

import modal

STUDIO_ORIGIN = "https://hathor.soapbox.community"
PORT = 8000

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("torch", "torchvision", "diffusers>=0.30", "transformers", "accelerate", "peft", "compel",
                 "opencv-python-headless", "pillow", "safetensors")
    .env({"HF_HOME": "/cache/hf"})
    .add_local_file("genai_cpu_worker.py", "/root/genai_cpu_worker.py")
)
cache = modal.Volume.from_name("hathor-worker-cache", create_if_missing=True)  # model weights download once

app = modal.App("hathor-studio-worker")


@app.function(gpu="T4", image=image, volumes={"/cache": cache}, secrets=[modal.Secret.from_name("hathor-worker")],
              max_containers=1,          # jobs live in memory: one container keeps submit + poll together
              scaledown_window=300,      # stays warm 5 min after the last image, then scales to zero (no cost)
              timeout=3600)
@modal.concurrent(max_inputs=32)         # polls are answered while an image renders
@modal.web_server(PORT, startup_timeout=900)
def serve():
    subprocess.Popen(["python", "/root/genai_cpu_worker.py"], env={
        **__import__("os").environ, "PORT": str(PORT), "HOST": "0.0.0.0",
        "CPU_SD_DEVICE": "cuda", "CPU_SD_CORS": STUDIO_ORIGIN, "CPU_SD_PRELOAD": "1",
    })
