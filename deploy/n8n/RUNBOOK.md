# n8n self-hosted — operator runbook (queue #109)

PREPARE-ONLY bundle. **Server installs are operator-present.** Nothing here is deployed;
this is the turnkey kit. Real domain/host/IP values live in `.local/` or on the box — the
committed files carry placeholders only (`__DOMAIN__`, `__TIMEZONE__`, secret placeholders).

n8n is a self-hosted workflow-automation platform (think "open-source Zapier"): triggers
(cron, webhook, polling) → nodes (HTTP, Telegram, Discord, shell, code) → actions. It
complements the existing MELEK timers/brain by giving the operator a visual, low-code way to
wire alerts and digests without adding more bespoke `.mjs` timers.

Bundle contents (`deploy/n8n/`):
- `docker-compose.yml` — pinned n8n, basic auth, one data volume, loopback-bound, no telemetry, mem limits, healthcheck.
- `Caddyfile.snippet` — reverse-proxy block with `__DOMAIN__` placeholder (Caddy does TLS).
- `.env.template` — every required var with placeholders + comments.
- `smoke-test.sh` — post-deploy verification (container health + loopback + public TLS).
- `RUNBOOK.md` — this file.

---

## 0. Where it should live

A **small CPU box** is the right home — the same class as the brain/timers box (Server 4-style:
a few GB RAM, no GPU). n8n's baseline is light (node + SQLite); the 768M cap in the compose file
leaves room for the box's other services. It is intentionally **not** the chain host (don't add
moving parts next to `melek-testnet.service`) and **not** a GPU box (waste of the GPU).

It complements, not replaces, the existing timers: keep the load-bearing witness ops
(5-min monitor, hourly price feed with JIT-from-vault key) as their hardened `.mjs` timers.
Use n8n for the softer alerting/notification/digest layer where a visual editor is a win.

Prereqs on the box: Docker Engine + Docker Compose v2, Caddy, and a DNS A record for the
chosen domain pointing at the box's public IP (needed before Caddy can get a cert).

## 1. First start (operator-present)

```sh
# On the box, in the directory holding these files:
cp .env.template .env

# Generate the two secrets and paste them into .env:
openssl rand -hex 32        # -> N8N_ENCRYPTION_KEY  (64 hex chars; NEVER change after first start)
openssl rand -base64 24     # -> N8N_BASIC_AUTH_PASSWORD

# Edit .env: set N8N_BASIC_AUTH_USER, the two secrets, N8N_HOST / N8N_EDITOR_BASE_URL /
# WEBHOOK_URL (all the real domain), and GENERIC_TIMEZONE (e.g. America/Chicago).

# Put the Caddy block in place, substituting the real domain for __DOMAIN__:
sudo sed "s/__DOMAIN__/n8n.YOURDOMAIN.tld/g" Caddyfile.snippet | sudo tee -a /etc/caddy/Caddyfile
sudo systemctl reload caddy

# Bring n8n up:
docker compose up -d
docker compose logs -f n8n     # watch until "Editor is now accessible"
```

`N8N_ENCRYPTION_KEY` MUST stay constant forever — it encrypts every stored credential.
Changing or losing it means re-entering all credentials. It lives inside the data volume too,
but pin it explicitly in `.env` so a volume restore on a fresh box still matches.

## 2. First-login hardening

1. Browse to `https://__DOMAIN__/`. Caddy serves TLS; the HTTP basic-auth gate (from `.env`)
   challenges first — enter the basic-auth user/password.
2. n8n shows **owner-account setup** on first run. Create the owner account with a strong,
   unique password (this is the in-app account, separate from the basic-auth gate). Use the
   operator's real email so password reset works.
3. **Disable public signups / lock to invite-only:** Settings → Users. Do not enable public
   sign-up. Only the owner account should exist; add additional users by explicit invite only.
4. Confirm telemetry is off: Settings should show no usage data sharing (the compose file sets
   `N8N_DIAGNOSTICS_ENABLED=false` and friends, so this is belt-and-suspenders).
5. Leave the HTTP basic-auth gate ON even though the owner account exists — two independent
   gates in front of an automation host that can hold credentials is the right posture.

## 3. Smoke test (verify after deploy)

```sh
./smoke-test.sh                       # container health + loopback /healthz
./smoke-test.sh n8n.YOURDOMAIN.tld    # also checks public TLS + that the editor is auth-gated
```

The one-liner the script wraps, for a manual check:

```sh
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5678/healthz   # expect 200
curl -fsS -o /dev/null -w '%{http_code}\n' https://n8n.YOURDOMAIN.tld/healthz  # expect 200
```

`/healthz` is unauthenticated (liveness). The editor `/` returns `401` until you authenticate —
that 401 is the *healthy* answer (it proves the basic-auth gate is active).

## 4. Backup (the one volume)

All state — SQLite DB, encryption key, every workflow and credential — lives in the single
named volume `melek_n8n_data` (`/home/node/.n8n` in-container). Backing that up backs up everything.

```sh
# Cold, consistent snapshot (stops n8n briefly — safest for SQLite):
docker compose stop n8n
docker run --rm -v melek_n8n_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/n8n-backup-$(date +%F).tar.gz -C /data .
docker compose start n8n
# Move n8n-backup-*.tar.gz off-box (operator vault / encrypted storage).
```

Also keep `.env` (it holds the encryption key) in the operator vault — a volume restore on a
fresh box needs the matching `N8N_ENCRYPTION_KEY` to read the restored credentials.
Recommended cadence: daily tarball, retained per the operator's vault policy.

## 5. Update procedure

Pinned by tag (`n8nio/n8n:2.23.4`) on purpose — never float to `:latest` in production.
To bump:

```sh
docker compose pull          # only after editing the tag in docker-compose.yml to the new pin
# ^ edit the image: line first, e.g. n8nio/n8n:2.24.x, then:
docker compose stop n8n      # back up the volume first (section 4) — upgrades migrate the DB
docker compose up -d         # recreate on the new image; DB migrations run on boot
docker compose logs -f n8n   # watch migrations complete
./smoke-test.sh n8n.YOURDOMAIN.tld
```

Read the release notes for breaking changes before bumping across a minor/major. Always take
a fresh backup immediately before an upgrade — DB migrations are one-way.

## 6. Rollback

```sh
docker compose stop n8n
# Restore the pre-upgrade volume snapshot:
docker run --rm -v melek_n8n_data:/data -v "$PWD":/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/n8n-backup-YYYY-MM-DD.tar.gz -C /data"
# Set image: back to the previous pin in docker-compose.yml, then:
docker compose up -d
./smoke-test.sh n8n.YOURDOMAIN.tld
```

Rolling the image back WITHOUT restoring the matching pre-upgrade volume can fail — a newer
DB schema may be unreadable by older n8n. Pair an image rollback with the matching snapshot.

---

## Starter workflows — 5 MELEK automations worth building first

Described, not implemented. Each is a thin trigger→action wire-up in the n8n editor. None
needs a private key (alerting only); webhooks should carry a shared-secret query param so only
the MELEK sources can fire them.

1. **Witness missed-block → Telegram alert.** Schedule node (every ~2 min) hits a read-only
   chain/monitor endpoint for `hathor`'s recent block production; an IF node compares
   `missed_blocks` against the last seen value (stored in a Static Data / data-store node);
   on increase, a Telegram node pings the operator. This is the highest-value alert — the
   existing 5-min monitor stays authoritative; n8n is the loud second pair of eyes.

2. **New brief lands → notify.** Webhook trigger the resident-AI brief pipeline POSTs to when
   it writes a new brief (or a Schedule node that lists the brief-queue dir via a small
   read-only endpoint). On a new brief id, send a Telegram/Discord message with the brief
   title + route so the operator knows there's fresh context before the next Claude Code run.

3. **Pool stratum down → alert.** Schedule node (every ~1 min) does a TCP/HTTP check against
   the mining-pool stratum/stats endpoint (pool.soapbox.community). On connection failure or a
   stats `lastShare` gap beyond a threshold, fire a Telegram alert. Catches a dead pool before
   miners notice and leave.

4. **CI red on `main` → alert.** GitHub webhook (workflow_run / check_suite) trigger, or a
   Schedule node polling the GitHub Actions API for the latest `main` run. On `conclusion ==
   failure`, post the failing job + commit to Discord/Telegram. Keeps a broken `main` from
   sitting unnoticed given the branch→PR→merge ship flow.

5. **Daily digest of annals.** Schedule node (once/day, in `GENERIC_TIMEZONE`) reads the day's
   new annal/brief records (via a read-only endpoint or a mounted read-only path), summarizes
   counts + titles into a single message, and sends one tidy digest to Telegram/email. Turns
   the firehose into a once-a-day skim.

Build order: start with #1 (witness missed-block) — it's the operationally critical one — then
#3 (pool) and #4 (CI), then the softer #2 and #5. Export finished workflows (Workflow → Download)
and keep the JSON in the operator vault so they survive a rebuild.
