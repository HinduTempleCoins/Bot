# Decades-brain pipeline — deploy runbook (Server A, operator-present)

Old-queue **#306**: wire the decades-brain (the layered 1960s→2020s router,
`integrations/decades-brain.mjs`) into the brief/annal pipeline on Server A. This bundle is
the turnkey server step. **Nothing here SSHes anywhere** — every command below is run by the
operator, present at the box.

## What it does

A systemd **timer** fires a **oneshot** runner every 15 min. The runner walks the brief/annal
**queue dir**, and for each new item calls `integrations/decades-pipeline.mjs`:

1. **Route** — the decades-brain (Naive Bayes / TF-IDF, classical-first, ~zero CPU) picks the
   topic/AI the brief belongs to.
2. **Dedup** — nearest-neighbour against the existing **store** answers "have we written this
   annal already?" Dense MiniLM cosine **if** an embedder is wired in, else a pure-JS word-bag
   cosine (the **1-core default** — no npm, no GPU, no model download).
3. **Nearest** — emits the closest existing brief + similarity score (feeds scorecard #225).

Result for each item lands as `<id>.decades.json`: `{ route, isDuplicate, nearestBrief, score,
layer, dedupMethod, ... }`. The runner is **idempotent** — items with a fresh result are skipped.

## Files in this bundle (`deploy/decades/`)

| File | Purpose |
|---|---|
| `run-pipeline.mjs` | server-side runner the timer invokes (walks queue → pipeline → result JSON) |
| `melek-decades-pipeline.service` | oneshot systemd unit (placeholders: `__INSTALL_DIR__`, `__ENV_FILE__`, `__DATA_DIR__`, `__LOG_DIR__`, `__LOG_FILE__`) |
| `melek-decades-pipeline.timer` | every-15-min timer |
| `decades.env.example` | env template (placeholder `__DATA_DIR__`) |
| `install.sh` | idempotent installer (substitutes placeholders, installs units, optional smoke/enable) |

## Operator-present steps

### 1. Get the bundle onto Server A
It ships with the repo. On the box, in the checked-out Bot repo, just `git pull`. (Or copy
`deploy/decades/` over if the repo isn't checked out there.)

### 2. Install (classical-only, 1-core-safe — the default)
Run from the repo root on Server A, substituting **your real paths** for the env vars:

```bash
sudo INSTALL_DIR=/path/to/bot/repo \
     ENV_FILE=/path/to/private/decades.env \
     DATA_DIR=/path/to/data \
     LOG_DIR=/var/log \
     bash deploy/decades/install.sh
```

This creates the data dirs, writes the env file from the example (DATA_DIR substituted),
installs+`daemon-reload`s the unit & timer, and does **NOT** enable yet.

> 8GB box only — to use dense MiniLM dedup, add `--with-embedder` (npm-installs
> `@huggingface/transformers natural`) and set `DECADES_EMBEDDER` in the env file once the
> `integrations/minilm-embedder.mjs` module has landed. **Do not** pass `--with-embedder` on
> the 1-core Server A.

### 3. Review the env file
Open the `ENV_FILE` you chose. Confirm `DECADES_QUEUE_DIR`, `DECADES_STORE_FILE`, and
(optionally) `DECADES_ROUTES_FILE` point at the real brief queue and corpus. Populate
`store.json` (`[{id,text,route?}]`) and `routes.json` (`[{label,examples:[...]}]`) — `install.sh`
seeds both as `[]` so the pipeline runs harmlessly until you fill them.

### 4. Smoke-test (one pass, no timer)
```bash
sudo INSTALL_DIR=/path/to/bot/repo ENV_FILE=/path/to/private/decades.env \
     DATA_DIR=/path/to/data bash deploy/decades/install.sh --smoke
```
Expect a line like:
`[decades] queue=.../brief-queue processed=N skipped=M duplicates=K candidates=C`
and `<id>.decades.json` files in `DECADES_OUT_DIR`.

### 5. Enable the timer
```bash
sudo systemctl enable --now melek-decades-pipeline.timer
systemctl list-timers melek-decades-pipeline.timer --no-pager
```
(Or pass `--enable` to `install.sh` to do steps 2 and 5 together.)

### 6. Verify
```bash
systemctl status melek-decades-pipeline.service --no-pager   # last oneshot run
journalctl -u melek-decades-pipeline.service -n 30 --no-pager
tail -n 20 /var/log/melek-decades-pipeline.log
```

## Rollback

```bash
sudo systemctl disable --now melek-decades-pipeline.timer
sudo rm -f /etc/systemd/system/melek-decades-pipeline.service \
           /etc/systemd/system/melek-decades-pipeline.timer
sudo systemctl daemon-reload
```
Data/results under `DATA_DIR` and the env file are left in place; delete them by hand if you
want a clean slate. No other service depends on this timer, so disabling it is non-destructive.

## Notes

- **Classical-first / 1-core-safe:** default install touches no npm and needs no GPU. The
  word-bag dedup path is exercised by the offline test suite (`integrations/decades-pipeline.test.mjs`).
- **Soft-fail everywhere:** a missing store, broken embedder, or empty queue degrades to a safe
  result and a log line — the timer never crash-loops on bad data.
- **No secrets in the repo:** units & env ship as placeholders; real paths live only in the env
  file the operator writes on the box.
