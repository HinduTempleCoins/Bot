# MELEK Condenser — Deploy Runbook (old-queue #264)

**Status:** PREPARED, not deployed. Server work is operator-present only; SSH writes
are blocked for the agent. This runbook makes the eventual deploy a single approved
command sequence on the box.

**What this deploys:** the Blurt Condenser fork (`/workspaces/melek-condenser`,
GitHub `HinduTempleCoins/melek-condenser`) on **Server 4**, pointed at the **local
MELEK testnet RPC** (`http://127.0.0.1:8090`), served at **alpha.melek.salon** behind
the existing disclaimer **Accept-gate** (`/` → `/trending`).

**Chain facts (MELEK testnet):**
- chain id: `18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e`
- address prefix: `TST`
- symbols: TESTS / TBD (mainnet: MELEK / MBD)
- local RPC: `http://127.0.0.1:8090` (the `melek-testnet.service` node on the box)

> Brief note: the resident-AI brief service (`/brief/request`) was UNREACHABLE during
> prep, so this was built from the repo configs directly. Re-request a brief if one is
> wanted before deploy.

---

## 0. Build verification (already done in the Codespace — for the record)

The production build was verified in the Codespace against `/workspaces/melek-condenser`:

- **Node 22 is REQUIRED.** The system default (Node 24) crashes `config@3.3.2` and the
  SSR child dies silently while webpack reports "listening" (documented in the
  condenser's own DEPLOY.md). Build + run both use Node 22 (`v22.22.1` verified).
- **`npm ci` is required**, not a partial install. The Codespace's pre-existing
  `node_modules` was a production-only tree missing devDeps (e.g. `html-webpack-plugin`),
  which makes `npm run build` fail with `Cannot find module 'html-webpack-plugin'`.
  `npm ci` installs the full tree (2077 packages) and the build then succeeds.
- **`NODE_OPTIONS=--openssl-legacy-provider` is required** on Node ≥17 for this build's
  crypto bindings.
- **Result:** `npm run build` exits **0** — webpack compiles with **zero `ERROR in` /
  `Module not found`** lines (only 9 cosmetic Sass `@elseif` / `!global` deprecation
  warnings from `foundation-sites`), then Babel compiles 274 files. `lib/server/index.js`
  is produced.
- **Boot smoke (verified):** with the env below, `node lib/server/index.js` starts the
  Koa cluster ("Worker process started for port 8085"), loads special posts, and serves
  **HTTP 200 on `/` and `/trending`** (with header `X-Forwarded-Proto: https`).

**No source patches were needed.** `deploy/condenser/patches/` is empty by design — if a
future build on the box does need a fix, store it there as a `.patch` and `git apply` it
on the box (never commit into the condenser repo).

---

## 1. Prerequisites on the box

- Node 22 installed and resolvable (e.g. via nvm: `nvm install 22`).
  Capture its absolute path: `nvm which 22` → use for `__NODE22_BIN__`.
- The MELEK testnet node running locally and serving RPC on `127.0.0.1:8090`
  (`systemctl status melek-testnet`).
- Caddy installed; DNS A record `alpha.melek.salon` → box public IP already resolving
  (needed for Caddy's ACME TLS challenge).
- The condenser checked out on the box (the deploy source of truth is the GitHub repo
  `HinduTempleCoins/melek-condenser`, NOT this Bot repo).

## 2. Build on the box (operator-present)

```sh
cd <INSTALL_DIR>            # the melek-condenser checkout
nvm use 22
export NODE_OPTIONS=--openssl-legacy-provider
npm ci
NODE_ENV=production npm run build
# Expect exit 0, "Successfully compiled NNN files with Babel", lib/server/index.js present.
```

If the build breaks, capture the error and (only if a code fix is required) write it as
`deploy/condenser/patches/NNNN-description.patch` in THIS repo and `git apply` it on the
box — do not commit into the condenser repo.

## 3. Configure env

```sh
cp <BOT_REPO>/deploy/condenser/melek-condenser.env.template <INSTALL_DIR>/.env
# Fill the __PLACEHOLDER__ values:
#   SDC_SESSION_SECRETKEY=$(openssl rand -hex 32)   # >=32 bytes, keep stable
# Public values (RPC=127.0.0.1:8090, chain id, prefix TST) are pre-filled.
chmod 600 <INSTALL_DIR>/.env
```

**RPC exposure decision (read before going live):** `SDC_CLIENT_BLURTD_URL` is used by
the *end-user browser*, not just the server. The template defaults BOTH client and server
to `http://127.0.0.1:8090` — correct only if browsers can reach that (they can't from the
public internet). For a public alpha, either:
- (a) keep `SDC_SERVER_BLURTD_URL=http://127.0.0.1:8090` (SSR, loopback) **and** set
  `SDC_CLIENT_BLURTD_URL=https://alpha.melek.salon/rpc`, with the `/rpc` handler in the
  Caddy block fronting the local node; **or**
- (b) point both at `https://alpha.melek.salon/rpc`.
Option (a) is recommended (SSR stays on the fast loopback; browsers use the TLS-fronted
`/rpc`). The Caddy block ships the `/rpc` reverse-proxy ready for this.

## 4. Install the service

```sh
sudo cp <BOT_REPO>/deploy/condenser/melek-condenser.service \
        /etc/systemd/system/melek-condenser.service
sudo sed -i \
  -e 's#__INSTALL_DIR__#<INSTALL_DIR>#g' \
  -e 's#__RUN_USER__#<RUN_USER>#g' \
  -e 's#__NODE22_BIN__#<NODE22_BIN>#g' \
  /etc/systemd/system/melek-condenser.service
sudo systemctl daemon-reload
sudo systemctl enable --now melek-condenser
sudo systemctl status melek-condenser            # active (running), worker bound to PORT
```

## 5. Install the Caddy front door + Accept-gate

```sh
# Deploy a copy of the holding page so Caddy can serve it at "/".
sudo mkdir -p <HOLDING_DIR>
sudo cp -r <BOT_REPO>/site/melek-holding/* <HOLDING_DIR>/
# Append the block, substitute the holding dir, reload.
sudo sed 's#__HOLDING_DIR__#<HOLDING_DIR>#g' \
  <BOT_REPO>/deploy/condenser/Caddyfile.block | sudo tee -a /etc/caddy/Caddyfile >/dev/null
sudo systemctl reload caddy
```

The gate: bare `/` serves `site/melek-holding/index.html` (the TESTS-is-valueless
disclaimer). Its button sets cookie `melek_tn_ok=1` + localStorage and redirects to
`/trending`, which Caddy proxies to the condenser. All other routes proxy straight
through, so deep links still hit the real app.

## 6. Smoke checks (operator-present)

```sh
# 6a. Service up, no config crash:
sudo systemctl is-active melek-condenser            # -> active
journalctl -u melek-condenser -n 30 --no-pager      # "Worker process started for port 8085", no config throw

# 6b. Accept-gate at "/":
curl -sI https://alpha.melek.salon/ | head -1                       # HTTP 200
curl -s  https://alpha.melek.salon/ | grep -o "I understand — enter the testnet"   # gate present

# 6c. /trending renders through the condenser:
curl -sI https://alpha.melek.salon/trending | head -1              # HTTP 200

# 6d. Chain id matches the testnet (compare RPC <-> intended id):
curl -s --data '{"jsonrpc":"2.0","method":"condenser_api.get_config","params":[],"id":1}' \
  http://127.0.0.1:8090 | grep -o '18dcf0[a-f0-9]*'                # starts 18dcf0...
# Expect: 18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e
# (The condenser bakes chain_id from config/default.json at build + injects it into
#  $STM_Config server-side; it is not a grep-able literal in the "/" HTML shell, so the
#  authoritative check is RPC get_config == the env SDC_CHAIN_ID above.)

# 6e. Signup route responds (account-creation help page):
curl -sI https://alpha.melek.salon/signup | head -1               # HTTP 200 (or 3xx redirect to wallet signup)
```

## 7. TrollBox — how it joins the deploy

The troll-box is **chain-transport based, not an HTTP service** — there is NO separate
port to proxy. `Bot/src/trollbox/chain-connector.mjs` speaks `custom_json` with id
`melek_trollbox` (`CHAT_ID`): each chat line is one posting-auth custom_json op on the
MELEK chain. (See `Bot/src/trollbox/CONDENSER_INTEGRATION.md`.)

- **Read/write path:** the bot runs a small poll loop calling `runOnce({client, broadcaster})`
  every ~3s. `client` reads recent `melek_trollbox` ops from the **same RPC**
  (`http://127.0.0.1:8090`, condenser_api `get_account_history` filtered to the id);
  `broadcaster` signs the bot's replies via **MELEK-Signer** (never a local WIF —
  BRIEF.md §7, zero-WIF-on-host). So the troll-box needs **no env of its own beyond the
  RPC URL** and a MELEK-Signer endpoint/token; it does **not** bind a port and is **not**
  proxied by Caddy.
- **Condenser side (UI, not yet built):** a `TrollBox.jsx` card that polls the chain for
  the latest N `melek_trollbox` ops and, on submit, broadcasts a `custom_json` with the
  logged-in user's posting key **in the browser**. When that component is added to the
  condenser, no deploy change here is needed — it rides the chain + the existing RPC.
- **Deploy action for the troll-box:** none at the condenser/Caddy layer for now. The bot
  poll loop is a separate Bot-repo process (run under its own timer/service on the box,
  pointed at `MELEK_RPC_URL=http://127.0.0.1:8090` and the MELEK-Signer). It is listed
  here only so the operator knows it is decoupled from the condenser web tier.

---

## 8. Rollback

The condenser is a stateless SSR front end — rollback is fast and safe; chain data is
untouched.

```sh
# Stop + disable the service:
sudo systemctl disable --now melek-condenser

# Restore the prior public face at "/" (the holding page already covers "/").
# If the whole site should fall back to the holding page only, comment out the
# `handle { reverse_proxy 127.0.0.1:8085 }` block in /etc/caddy/Caddyfile (or remove the
# whole alpha.melek.salon block) and reload:
sudo systemctl reload caddy

# Roll back code: redeploy the prior known-good commit of the condenser checkout:
cd <INSTALL_DIR> && git checkout <PRIOR_GOOD_SHA> && nvm use 22 \
  && NODE_OPTIONS=--openssl-legacy-provider npm ci \
  && NODE_ENV=production npm run build \
  && sudo systemctl restart melek-condenser
```

Nothing in this deploy holds keys: user keys are generated client-side, the bot signs via
MELEK-Signer, and the only host secret is `SDC_SESSION_SECRETKEY` in the chmod-600 env.
