# GPU runners for the image pool (set up, NOT in use)

Our CPU image workers make one image in ~2–4 minutes. A free or rented GPU makes the same image in seconds. These
runners let a GPU help **without any job moving off our servers for good**: the pool on the worker (`sd_pool.py`,
port 8510) keeps every job; a GPU runner *pulls* a background job, renders it with the identical pipeline
(`genai_cpu_worker.py`, `CPU_SD_DEVICE=cuda`), and posts the picture back — like a miner taking work from a pool.

| Runner | GPU | Cost | How it starts |
|---|---|---|---|
| **Kaggle** notebook (`kaggle_puller.ipynb`) | T4 ×2 / P100 | free, ~30 GPU-hours a week | run the notebook |
| **Colab** notebook (same `.ipynb`) | T4 | free tier, sessions end when idle | run the notebook |
| **Modal** (`modal_sd_puller.py`) | T4 (or bigger) | our account; per-second billing, monthly free credit | `modal run …` |

## Status: switched OFF

* The pool's pull lane is disabled (`SD_POOL_PULL_ENABLED=0`). A runner started now gets `401` and exits.
* Only **background** jobs (`"priority":"low"` — remakes, scenes, skulls) are ever offered to a runner; customer
  (Studio) jobs always stay on our own servers.

## To switch on (when the operator says so)

1. Pool (worker): set `SD_POOL_PULL_ENABLED=1` and a new `SD_POOL_PULL_TOKEN` in the pool's env file on the worker, restart
   `melek-sd-pool`.
2. Public door: add a route on the web host's Caddy, `https://<studio host>/gpu-pool/*` → the worker's `:8510`
   (`/pull` and `/done/*` only), so notebooks can reach it over HTTPS. The worker's firewall already admits the web host.
3. Kaggle / Colab: add secrets `POOL_URL` (`https://<studio host>/gpu-pool`) and `PULL_TOKEN`; turn on the GPU; run
   all cells. Modal: `modal secret create melek-sd-pull POOL_URL=… PULL_TOKEN=…`, then `modal run integrations/gpu/modal_sd_puller.py`.
4. Watch `GET :8510/health` (the pool) — runners appear as they check in.

Runners stop on their own after `MAX_MINUTES` or `IDLE_MINUTES` with nothing to do, so free quota isn't burned idle.
