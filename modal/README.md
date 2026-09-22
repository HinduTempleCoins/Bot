# MELEK Private Brain — Modal serverless-GPU inference

Our own open-weight model, on GPUs we rent by the second. **This is not a model API.** The operator's
privacy rule is that no external model provider ever sees MELEK's private data (chat, transcripts,
briefs). So the private lane runs *our* weights inside *our* container on Modal's rented hardware —
Modal is the landlord of the GPU, not an inference provider. No third-party model call exists in this
app. Data flows only between the operator's box and this Modal app, both ours.

It does exactly the two things the operator specified, and **nothing runs between them** (`min_containers=0`,
idle cost = $0):

1. **2×/day batch** — before noon and before midnight (`Cron("30 11,23 * * *", America/Chicago`):
   spins up, runs the private brain jobs (transcript-reading **conference synthesis** + **brief-grader
   scoring**) on our model, writes the results back to the box, spins down.
2. **On-demand chat** for `soapy.blog` — the admin flips it ON, the endpoint cold-starts, serves the
   interactive chat, and idles back to zero after `scaledown_window` (default 300s). Cold start tolerated.

## Files

| File | What it is |
|---|---|
| `app.py` | The `modal.App`: the `Brain` GPU class (model load + chat endpoint + batch method), the `Cron` scheduler, weight-priming + GPU probe. |
| `brain_lib.py` | **Pure** contract/auth/clamp logic — no `modal`/`vllm` imports. Single source of truth for the request/response shape. Modal mounts it automatically. |
| `smoke_test.py` | Offline validation of the contract + auth (stdlib only, no GPU, no network). `python3 modal/smoke_test.py`. |
| `requirements.txt` | Local deploy tooling only (`modal`). GPU deps live in the image in `app.py`. |

## Model + GPU choice

**Model: `Qwen/Qwen2.5-7B-Instruct`** (open weights, no gated-download / no HF token needed). Strong at
both jobs this layer has — multi-turn admin chat and long-context summarization/grading — and it is the
same base the repo's fine-tune path targets (`infra/modal/finetune.py`, `brain/modal/brain-serve.py`),
so the day Hathor's LoRA is ready it rebases onto this without a model swap. *Alternative:* `meta-llama/
Llama-3.1-8B-Instruct` — comparable quality but **gated** (needs the `huggingface` secret's `HF_TOKEN`
and a one-time license accept); Qwen avoids that friction.

**GPU: `A10` (24 GB), `$0.000306/sec ≈ $1.10/hr.`** A 7B in bf16 is ~15 GB, leaving room for the KV
cache — comfortably one GPU. It's the balanced pick for interactive chat latency + batch throughput.
**Budget lever:** set `BRAIN_GPU=L4` (`$0.000222/sec ≈ $0.80/hr`, also 24 GB) — ~27% cheaper, a bit
slower; fine if chat latency isn't tight. Go up to `A100-40GB` only if we later serve a larger model
or need higher concurrency.

## THE ENDPOINT CONTRACT (match this in `modal-client.mjs`)

`POST` to `MODAL_INFERENCE_URL` (the `.modal.run` URL that `modal deploy` prints for `Brain.chat`).

**Auth:** `Authorization: Bearer <MELEK_BRAIN_TOKEN>` header. If no token is configured server-side the
gate is open (dev only); in production it must match exactly, else `401`.

**Request body (JSON):**
```json
{
  "messages":    [{"role": "user", "content": "…"}, {"role": "assistant", "content": "…"}],
  "system":      "optional system prompt string",
  "max_tokens":  512,
  "temperature": 0.7,
  "warmup":      false
}
```
- `messages` — required for a real turn. Roles: `system` / `user` / `assistant` (unknown → `user`).
  A `system` string and/or an in-list system turn are merged into one leading system message.
- `system` — optional convenience; prepended as the system turn.
- `max_tokens` — optional, default **512**, clamped to **[1, 4096]**.
- `temperature` — optional, default **0.7**, clamped to **[0.0, 2.0]**.
- `warmup` — optional. `true` (or an empty `messages`) wakes the container and returns immediately with
  no generation. Use it as the soapy.blog "turn it on" ping so the first real message skips the cold start.

**Response body (JSON), HTTP 200:**
```json
{ "ok": true, "text": "…model output…", "model": "Qwen/Qwen2.5-7B-Instruct", "warmup": false,
  "usage": { "prompt_tokens": 123, "completion_tokens": 45 } }
```
**Error:** HTTP `401` (auth) or `400` (bad body), body `{ "ok": false, "text": "", "error": "…", "code": "…" }`.

The `.mjs` client keys on `ok`. Minimal caller:
```js
const r = await fetch(process.env.MODAL_INFERENCE_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json',
             authorization: `Bearer ${process.env.MELEK_BRAIN_TOKEN}` },
  body: JSON.stringify({ messages, system, max_tokens: 512 }),
});
const j = await r.json();               // { ok, text, model, usage }
```

### Batch ↔ box contract (for the box side the parent wires)

The batch can't read the box's disk, so the box exposes four endpoints (same bearer). All soft-fail; if
`BOX_BASE_URL` is unset the batch no-ops cleanly.
- `GET  {BOX}/brain/conference/inputs`  → `{ "items": ["transcript/brief text", …] }`
- `POST {BOX}/brain/conference/synthesis` ← `{ "text": "…", "count": N }`
- `GET  {BOX}/brain/briefs/pending`      → `{ "briefs": [{ "id", "body", "evidence" }, …] }`
- `POST {BOX}/brain/briefs/grade`        ← `{ "id", "grade_json": "{pct_completed:…}" }` (the JSON
  schema `brain/grade-briefs.mjs` already records — `coerceGateAssessment` parses it).

## The soapy.blog ON/OFF toggle (melek-admin change — spec, not built here)

Because the endpoint is scale-to-zero, "ON" just means *the UI starts hitting it*; "OFF" means it stops
and Modal drops to zero on its own after `scaledown_window`. No server-side on/off state is needed.

The small `melek-admin` change (for the parent / .mjs side):
1. A toggle in the admin portal (`melek-admin`), persisted in local UI state — e.g. `brainChatEnabled`.
2. **On flip → ON:** fire **one warm-up POST** to `MODAL_INFERENCE_URL` with `{ "warmup": true }` (and the
   bearer). This starts the cold start *now* so the operator's first real message lands on a warm GPU.
   Show a "waking… (~60–90s)" state until it returns `{ ok: true, warmup: true }`.
3. **While ON:** each chat message is a normal `POST { messages, system, max_tokens }` to the same URL.
4. **On flip → OFF:** stop sending. Nothing to tear down — the GPU idles out to zero and bills $0.

No new secret on the admin side beyond `MODAL_INFERENCE_URL` + `MELEK_BRAIN_TOKEN` in its env.

## Cost model

A10 = **$0.000306/sec** ($1.10/hr). Weights load from the Volume (~30–90s cold; the first-ever run
downloads once via `download_weights`).

| Item | Rough wall time | Cost | Notes |
|---|---|---|---|
| **Batch run** (cold start + synthesis + grading) | ~3–6 min | **~$0.06–$0.11** | 2×/day = **~$3.6–$6.6/mo** |
| **Chat session** (cold start + ~15 min interactive, then idle-out) | ~16–20 min billed | **~$0.29–$0.37** | idle after = $0 |
| **Idle** | — | **$0** | `min_containers=0` |

At ~2 batches/day + a handful of chat sessions/day this lands **well under Modal's $30/mo Starter free
credit** — realistically ~$5–$15/mo of the credit, $0 out of pocket at this cadedence. The raised budget
covers spikes (longer chats, more briefs, or moving `BRAIN_GPU` up). `L4` shaves ~27% off every row.

## Deploy — what the OPERATOR must do (no account exists yet; nothing here has been deployed)

```bash
# 1. Account + CLI auth (one time)
pip install -r modal/requirements.txt
modal token new                         # opens the browser to create/link a Modal account

# 2. Secrets (NEVER in the repo). The bearer is a random string you also put in the box env.
modal secret create melek-brain MELEK_BRAIN_TOKEN=$(openssl rand -hex 32)
#    Only if you switch to a GATED model (e.g. Llama); Qwen needs no HF token:
modal secret create huggingface HF_TOKEN=hf_xxx

# 3. Prime the weights Volume once (fast cold starts thereafter), then prove a GPU attaches
modal run   modal/app.py::download_weights
modal run   modal/app.py::gpu_check

# 4. Deploy — prints the https://…modal.run URL for Brain.chat and installs the 2×/day Cron
modal deploy modal/app.py

# 5. Fire one batch by hand to confirm the box round-trip (optional, needs BOX_BASE_URL set)
modal run   modal/app.py::run_batch_now
```

Then on the **box** (`.env` / `.local`, never committed), set for the `.mjs` side:
```
MODAL_INFERENCE_URL=https://<your-app>--brain-chat.modal.run   # from step 4
MELEK_BRAIN_TOKEN=<same value as the melek-brain secret>
BOX_BASE_URL=<the box's own base URL the batch calls back>     # for the batch jobs
```
Set `BOX_BASE_URL` as an env on the Modal side too (add it to the `melek-brain` secret, or a new
secret) so `scheduled_batch` knows where to pull inputs / push results.

## Verify

- **Offline (now):** `python3 modal/smoke_test.py` — 21 tests, contract + auth + schedule, no network. ✅
- **After deploy (operator, on Modal):** `modal run modal/app.py::gpu_check` for the GPU; then
  `curl -s -XPOST "$MODAL_INFERENCE_URL" -H "authorization: Bearer $MELEK_BRAIN_TOKEN" \
   -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"say hi"}],"max_tokens":16}'`.

## Notes

- **Do not run `import modal` from the repo root** — a bare dir named `modal/` can shadow the pip package
  as a namespace package. `modal deploy modal/app.py` is unaffected (the CLI imports the real package
  first). `smoke_test.py` imports only `brain_lib`, so it's safe anywhere.
- This app is deliberately separate from the existing `infra/modal/` (`brain.py` embeddings lane,
  `soapy.py` alarm-clock, `serve_lora.py`/`finetune.py` LoRA path) and `brain/modal/brain-serve.py`
  (vLLM OpenAI-compatible serve). It reuses their conventions — the `melek-brain`/`MELEK_BRAIN_TOKEN`
  secret, scale-to-zero, weights-on-a-Volume — as the operator-spec'd single private-brain build.
