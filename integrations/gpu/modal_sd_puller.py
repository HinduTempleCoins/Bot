"""modal_sd_puller.py — the same GPU runner on OUR Modal account (serverless GPU, billed per second; the free monthly
credit covers light use). Not scheduled: nothing runs until someone launches it on purpose.

  modal run integrations/gpu/modal_sd_puller.py            # one runner, stops when idle / at MAX_MINUTES
Secrets: a Modal secret named "melek-sd-pull" holding POOL_URL and PULL_TOKEN (never in the repo).
"""
import os
import modal

HERE = os.path.dirname(os.path.abspath(__file__))
image = (modal.Image.debian_slim(python_version="3.12")
         .pip_install("torch==2.14.0", "diffusers==0.40.0", "transformers==5.17.0", "accelerate==1.15.0", "peft==0.21.0",
                      "safetensors", "opencv-python-headless", "pillow")
         .add_local_file(os.path.join(HERE, "..", "genai_cpu_worker.py"), "/root/genai_cpu_worker.py")
         .add_local_file(os.path.join(HERE, "gpu_puller.py"), "/root/gpu/gpu_puller.py"))
app = modal.App("melek-sd-puller", image=image)
cache = modal.Volume.from_name("melek-hf-cache", create_if_missing=True)   # models downloaded once, reused


@app.function(gpu="T4", timeout=60 * 60, secrets=[modal.Secret.from_name("melek-sd-pull")], volumes={"/root/.cache/huggingface": cache})
def pull(minutes: int = 50):
    import sys
    os.environ.update(CPU_SD_DEVICE="cuda", RUNNER_NAME=os.environ.get("RUNNER_NAME", "modal-t4"), MAX_MINUTES=str(minutes))
    sys.path.insert(0, "/root"); sys.path.insert(0, "/root/gpu")
    import gpu_puller
    gpu_puller.POOL, gpu_puller.TOKEN = os.environ["POOL_URL"].rstrip("/"), os.environ["PULL_TOKEN"]
    gpu_puller.MAX_S = minutes * 60
    return gpu_puller.run()


@app.local_entrypoint()
def main(minutes: int = 50):
    print("images made:", pull.remote(minutes))
