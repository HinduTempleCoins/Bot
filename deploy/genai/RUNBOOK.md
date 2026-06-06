# Generative AI — deploy runbook (genai.soapbox.community)

The GenAI page is a zero-dependency Node HTTP service in the SoapBox house style (mirrors
`site/hierophant/`). It lets users **make AI images now** — free-first, no login. A prompt box, a
template picker (the CapCut seed), a gallery, and a `POST /api/generate` that runs through the
image-provider failover chain.

**Everything below is a TEMPLATE.** `__DOMAIN__`, the host, the user, and the unit name are
placeholders — fill them in at deploy time on the box itself. Nothing here is committed with real
host/service values (the pre-commit hook blocks hostnames/keys in public commits — keep specifics in
`.local/`).

---

## What runs

- **Entry point:** `site/genai/server.mjs`
- **Port:** `PORT` env (default `8131`)
- **Public base:** `BASE_URL=https://__DOMAIN__`
- **Providers:** `integrations/genai-providers.mjs` — failover **cloudflare → gemini → pollinations**,
  per-provider circuit breaker + per-day budget cap. Pollinations is keyless, so the page works with
  **no keys at all** (it just falls all the way through to the free engine).
- **Templates:** `integrations/genai-templates.mjs` — pure data, no network, no keys.
- **Gallery storage:** images + `<file>.json` metadata are written to `DATA_DIR` (default
  `.data/genai` under the repo). Mount a persistent volume there in production.

### Environment (set on the host, not here)

| Var | Purpose | Default |
|---|---|---|
| `PORT` | listen port | `8131` |
| `HOST` | bind address | `127.0.0.1` |
| `BASE_URL` | public origin (canonical/sitemap) | `http://localhost:$PORT` |
| `DATA_DIR` | where generated images + metadata are stored | `.data/genai` |
| `GENAI_RATE_PER_HOUR` | per-IP generate cap | `10` |
| `CF_ACCOUNT_ID` / `CF_API_TOKEN` | Cloudflare Workers AI (primary engine) — **JIT from vault on the box** | unset → skipped |
| `GEMINI_API_KEY` | Google Gemini image gen (same key the Discord bot uses) — **JIT from vault** | unset → skipped |
| `GENAI_BREAKER_THRESHOLD` | consecutive fails before a provider's breaker opens | `3` |
| `GENAI_BREAKER_COOLDOWN_MS` | how long a tripped breaker stays open | `300000` (5 min) |
| `GENAI_DAILY_CAP` | default per-cost-bearing-provider daily image cap | `200` |
| `GENAI_CF_DAILY_CAP` / `GENAI_GEMINI_DAILY_CAP` | per-provider overrides | falls back to `GENAI_DAILY_CAP` |
| `GENAI_GEMINI_MODEL` | Gemini image model id | `gemini-2.0-flash-preview-image-generation` |

> **Key custody:** the keys live ONLY as env vars on the app host, fetched JIT from the operator vault
> per the 2026-06-06 rule — never written to disk in this repo, never logged. The provider layer scrubs
> key-like material out of any error string before it can be surfaced.
>
> **Cost discipline (RunPod-drain post-mortem):** cost-bearing engines run under a circuit breaker AND a
> daily budget. There is **no auto-retry billing loop** — exactly one attempt per provider per request,
> then fail over. A tripped breaker or an exhausted budget skips that provider until cooldown / next day.

---

## Operator-present steps

1. **Pull + smoke-test offline (any host):**
   ```
   npm test            # full suite, includes the 3 genai test files (39 tests)
   node --test integrations/genai-providers.test.mjs integrations/genai-templates.test.mjs site/genai/server.test.mjs
   ```
2. **Boot locally to eyeball it** (works with zero keys — falls through to Pollinations):
   ```
   PORT=8131 node site/genai/server.mjs
   curl -s localhost:8131/health        # {"ok":true,"templates":12,"providers":[...]}
   ```
3. **Install the systemd unit** (template below), fill placeholders, then:
   ```
   sudo systemctl daemon-reload
   sudo systemctl enable --now genai.service     # placeholder unit name
   curl -s localhost:8131/health
   ```
4. **Add the Caddy site block** (template below), fill `__DOMAIN__` + the upstream port, reload Caddy.
5. **DNS:** point the host at the box. Two mount options:
   - **Subdomain:** `genai.__BASE_DOMAIN__` → its own Caddy block (template below).
   - **Path under an existing site:** reverse-proxy `/genai/*` to `127.0.0.1:8131` from an existing
     vhost (set `BASE_URL=https://__DOMAIN__/genai` and strip the prefix at the proxy, or run it at the
     subdomain — the subdomain is simpler and is the default assumption here).
6. **Verify TLS + routes live:**
   ```
   curl -s https://__DOMAIN__/health
   curl -sI https://__DOMAIN__/ | head
   curl -s https://__DOMAIN__/robots.txt
   ```

---

## systemd unit (TEMPLATE — fill `__USER__`, `__REPO_DIR__`, `__DATA_DIR__`, port)

```ini
# /etc/systemd/system/genai.service
[Unit]
Description=Generative AI (genai.__BASE_DOMAIN__) — make images now
After=network.target

[Service]
Type=simple
User=__USER__
WorkingDirectory=__REPO_DIR__
Environment=PORT=8131
Environment=HOST=127.0.0.1
Environment=BASE_URL=https://__DOMAIN__
Environment=DATA_DIR=__DATA_DIR__
Environment=GENAI_RATE_PER_HOUR=10
# Provider keys: keep them in an EnvironmentFile with tight perms, fetched JIT from the vault.
# NEVER inline a key here. The file is written at deploy time, not committed.
# EnvironmentFile=/etc/genai/keys.env      # CF_ACCOUNT_ID, CF_API_TOKEN, GEMINI_API_KEY
ExecStart=/usr/bin/node site/genai/server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=__DATA_DIR__

[Install]
WantedBy=multi-user.target
```

## Caddy site block (TEMPLATE — fill `__DOMAIN__` + upstream port)

```caddy
__DOMAIN__ {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8131
    header {
        Referrer-Policy strict-origin-when-cross-origin
        X-Content-Type-Options nosniff
    }
}
```

Caddy gets the TLS cert automatically (Let's Encrypt) once DNS resolves to the box. Reload with
`sudo systemctl reload caddy`.

---

## Notes / discipline (Phase 1)

- **Free-first, no login.** The chain always resolves to *some* image because Pollinations is keyless.
  Add the Cloudflare and Gemini keys to upgrade quality/speed; they degrade gracefully if absent.
- **No arbitrary-URL proxy.** `/img/:file` only serves images we generated and stored in `DATA_DIR`
  (path-sanitised, image extensions only). We never fetch-and-reflect a user-supplied URL.
- **esc() everywhere.** Every interpolated value (prompts, slot text, filenames) is HTML-escaped.
- **Honest labels.** Every gallery/result image says which engine made it, and the footer states the
  free-tier posture.

---

## Phase 2 — the growth path (sketch, not yet built)

The Phase-1 page is deliberately the thin end of a wedge. Two extensions are designed but deferred:

### A. ComfyUI on RunPod (on-demand, job-queue)

Heavy/custom generation (ComfyUI workflows, LoRAs, SDXL refiners) runs on a RunPod GPU that is woken
**on demand** and **stopped when idle** — never a 24/7 burn. The page becomes a job queue, not a
synchronous call:

- **New provider** `comfyui-runpod` added to `integrations/genai-providers.mjs`, but it does **not**
  block the request thread. Instead:
  - `POST /api/jobs` → enqueue `{ id, workflow, prompt, params, status:'queued' }` to `DATA_DIR/jobs/`.
  - A worker (separate timer/process) ensures the RunPod pod is **running** (start if stopped), submits
    the ComfyUI workflow via its REST/websocket API, polls for completion, stores the output image into
    the same gallery store, and marks the job `done` (or `error`).
  - `GET /api/jobs/:id` → `{ status, file? }` for the page to poll; the gallery shows finished jobs.
  - **Idle-stop watchdog** stops the pod after N minutes with no queued jobs.
- **Circuit-breaker rule carries over, hard:** the pod-start path is the cost-bearing one. It gets a
  breaker AND a hard cap on wake attempts per window — this is exactly the failure the RunPod-drain
  post-mortem warns about (1455 failed wake-loops). **Never auto-retry a wake in a tight loop;** back
  off, surface the failure, and fall back to the free synchronous engines for that request.
- **Keys:** the RunPod API key is JIT-from-vault on the worker box, same custody rule as the others.

### B. Google-Colab teach layer (tie-in to the tutorial)

For users who want to *learn* rather than one-click, link out to runnable Colab notebooks that teach the
generation stack, wired into the staged `tutorial/`:

- A small registry (`integrations/genai-lessons.mjs`, to build) maps a lesson → a Colab notebook URL +
  the tutorial stage it unlocks under (e.g. "Run SDXL yourself in Colab", "Build a ComfyUI workflow").
- The page surfaces a **Learn** tab linking these notebooks (we host the *notebook*, Colab runs it on
  Google's free GPU — keyless, free-first, in keeping with the rest of the page).
- Completing a lesson can mark the corresponding tutorial stage — the same staged-unlock model the
  19-stage tutorial already uses, so the teach layer is continuous with onboarding rather than bolted on.

Both extensions reuse the Phase-1 seams (the provider registry, the gallery store, the template
registry) — nothing here needs to be rebuilt to grow into them.
```
