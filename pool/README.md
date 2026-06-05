# MELEK / SoapBox Mining Pool — Multi-Algo, Multi-Coin (Miningcore)

A **multi-algorithm, multi-coin** mining pool at **https://pool.soapbox.community**.
The platform is **[Miningcore](https://github.com/oliverw/miningcore)** — one daemon
that serves **CryptoNote / RandomX** *and* **Ethash / Etchash** (and many other algos)
side by side, with **one config entry per coin**. This satisfies the operator's hard
requirement (directive 2026-06-05, Addendum 5):

> "make sure You use one that can do CryptoNotes and ETH Type Chains, it's going to be
> a Pool with many Coins to Choose from for Mining, plus ours."

CryptoNote-only pools (the previous `cryptonote-nodejs-pool`) are **disqualified as the
platform** for that reason; the old pool is kept disabled for rollback only.

- **Live frontend:** https://pool.soapbox.community — multi-coin menu (one card per coin),
  per-coin stats, per-coin connect instructions.
- **Stats API:** https://pool.soapbox.community/api → Miningcore REST API. `/api/pools`
  lists every configured coin (this is what powers the menu).
- **Stratum (per coin):**
  - RandomX / CryptoNote (Monero stagenet): `pool.soapbox.community:4444` (CPU/low-end),
    `:4445` (high-end).
  - Ethash / Etchash (ETC **Mordor** testnet): `pool.soapbox.community:5550` (GPU).

> The cutover plan moves RandomX onto the legacy `:3333/:5555` once Miningcore is proven;
> until then the old pool keeps `:3333/:5555` and Miningcore runs on `:4444/:4445/:5550`.
> See **Cutover** below.

## Why Miningcore (vs. the old node pool)

| | cryptonote-nodejs-pool (old) | **Miningcore (this platform)** |
|---|---|---|
| CryptoNote / RandomX | yes | yes |
| Ethash / Etchash (ETH-type) | **no** | **yes** |
| Many coins, one platform | no (one coin per instance) | **yes (one config entry per coin)** |
| Persistence | Redis | PostgreSQL |
| Runtime | Node.js | .NET 6 |

Adding PRANA (the operator's Ethash ETH-clone) at its launch is **one more `pools[]`
entry** — see "Adding a coin (incl. PRANA)" below.

## Two algorithm families proven

**a. CryptoNote / RandomX** — Monero **stagenet** (`sXMR`), a free public RandomX network.
Mined against the existing stagenet `melek-wallet-rpc` (payout wallet, throwaway/zero-value)
plus a **dedicated** stagenet daemon `melek-mc-monerod` (separate from the old pool's
`melek-monerod`, so the old pool is untouched).

> **Why a dedicated local daemon, not the public synced node:** Miningcore (unlike the old
> node-pool) has a hard daemon **peer-connectivity gate** — `AreDaemonsConnectedAsync`
> requires `(outgoing + incoming peers) > 0` before it will start the job manager. The
> public stagenet nodes (`node.monerodevs.org` etc.) run restricted RPC and report
> **0 peers**, so that gate never passes against them. A `--bootstrap-daemon-address`
> node serves templates from the tip immediately but *also* reports 0 P2P peers (bootstrap
> short-circuits P2P), so it fails the same gate. The working answer is a **pure-P2P**
> local daemon pointed at the monerodevs **P2P** ports (`:38080`) as priority nodes — it
> forms real peers (gate passes) and syncs stagenet in the background. Once it reaches the
> tip it serves `get_block_template` and the RandomX pool begins handing out jobs.
> Until then Miningcore correctly reports "Daemon is still syncing… Manager will be started
> once synced" — the same posture as the old pool's local node.

**b. Ethash / Etchash (ETH-type)** — Ethereum Classic **Mordor testnet** via
**core-geth** (`etclabscore/core-geth`, `--mordor`). Miningcore's `ethereum` coin family
drives it through `eth_getWork`. The payout/etherbase is a **freshly generated zero-value
testnet address** (`0xaA0c07a11e4aE6fbe201C7EBE061A86A296f08ab`) — never a mainnet/HIVE/MELEK
key. Etchash needs a **GPU miner** (lolMiner/gminer/ethminer); CPU isn't practical, so the
proof here is the daemon serving valid `eth_getWork` jobs + the pool accepting the stratum
handshake.

## What runs where (all on the public MELEK box, Docker net `melek-pool-net`)

> Host IP, DNS token storage, secrets, and exact steps live in the gitignored deploy
> record `.local/POOL_DEPLOY_2026-06-05.md` (private-by-default rule).

| Container / unit | Image | Ports (host) | Role |
|---|---|---|---|
| `melek-miningcore` / `melek-miningcore.service` | `melek-miningcore:latest` (built from oliverw/miningcore) | `:4444 :4445 :5550` (stratum, public), `127.0.0.1:4000` (API) | Multi-algo stratum + payments + REST API |
| `melek-mc-postgres` / `melek-mc-postgres.service` | `postgres:16-alpine` | `127.0.0.1:5432` | Pool persistence (shares/blocks/balances/payments) |
| `melek-mordor` / `melek-mordor.service` | `etclabscore/core-geth` | `127.0.0.1:8545` (RPC), `30303` (p2p) | ETC **Mordor** testnet node (Etchash daemon) |
| `melek-mc-monerod` / `melek-mc-monerod.service` | `sethsimmons/simple-monerod` | (net-internal `38081`) | Dedicated Monero stagenet daemon for Miningcore (pure-P2P, syncing) |
| `melek-wallet-rpc` (shared w/ old pool) | `sethsimmons/simple-monero-wallet-rpc` | `127.0.0.1:38082` | Monero stagenet payout wallet |
| `melek-monerod` (old pool's own) | `sethsimmons/simple-monerod` | `127.0.0.1:38081` | Old pool's local stagenet daemon (untouched) |
| (Caddy, shared) | system caddy | `:443` | TLS + static frontend + `/api` proxy |

Deploy artifacts in this repo:

- `deploy/miningcore/config.json` — Miningcore config (committed with a `__PG_PASSWORD__`
  placeholder; the live file on the box has the real generated password substituted in).
- `www/` — the multi-coin frontend (`index.html`, `style.css`, `pool.js`). **This is the
  canonical source**; it is rsync-deployed to `/opt/melek-miningcore/www` on the box
  (`rsync -av pool/www/ <box>:/opt/melek-miningcore/www/`). Themed to match the SoapBox
  family (dark `:root` tokens mirroring `site/soapbox/render.mjs`, card/panel pattern, the
  shared family nav with "Pool" added, a light/dark toggle, and the "three doors" landing).
- `deploy/miningcore/systemd/*.service` — units for miningcore, postgres, mordor,
  and the dedicated `melek-mc-monerod`.
- `deploy/miningcore/createdb.sql` — Postgres schema (from upstream
  `Persistence/Postgres/Scripts/createdb.sql`).
- `deploy/miningcore/Caddyfile.block` — the cutover Caddy block (proxies `/api` to `:4000`).
- `deploy/` (legacy) — the old `cryptonote-nodejs-pool` config/systemd, kept for rollback.

## Deploy from scratch (summary)

```bash
# 1. Clone + build the image (nice -19; ~10-15 min, .NET 6 + native crypto libs)
mkdir -p /opt/melek-miningcore && cd /opt/melek-miningcore
git clone --depth 1 https://github.com/oliverw/miningcore.git
cd miningcore && nice -n 19 docker build -t melek-miningcore:latest .

# 2. Postgres on the shared net + schema
PGPASS=$(openssl rand -hex 16); echo -n "$PGPASS" > /opt/melek-miningcore/secrets/.pgpass
docker run -d --name melek-mc-postgres --network melek-pool-net --restart unless-stopped \
  -e POSTGRES_DB=miningcore -e POSTGRES_USER=miningcore -e POSTGRES_PASSWORD="$PGPASS" \
  -v /opt/melek-miningcore/pgdata:/var/lib/postgresql/data -p 127.0.0.1:5432:5432 postgres:16-alpine
docker cp createdb.sql melek-mc-postgres:/tmp/ && \
  docker exec melek-mc-postgres psql -U miningcore -d miningcore -f /tmp/createdb.sql

# 3. ETC Mordor node (Etchash daemon)
docker run -d --name melek-mordor --network melek-pool-net --restart unless-stopped ... (see systemd unit)

# 4. config.json: substitute the postgres password, then run miningcore
sed "s/__PG_PASSWORD__/$PGPASS/" deploy/miningcore/config.json > /opt/melek-miningcore/config.json
cp deploy/miningcore/systemd/*.service /etc/systemd/system/ && systemctl daemon-reload
systemctl enable --now melek-mc-postgres melek-mc-monerod melek-mordor melek-miningcore

# 5. Frontend (rsync the canonical source; pool/www/ is the source of truth)
node pool/www/build-manifest.mjs          # regenerate launcher-manifest.json from wizard.mjs
rsync -av pool/www/ <box>:/opt/melek-miningcore/www/
```

## Frontend / theme (SoapBox family look)

The frontend (`www/`) wears the **SoapBox design language** so the pool reads as part of the
family: dark `:root` tokens (`--bg:#0d1117 --panel:#161b22 --line:#21262d --fg:#e6edf3
--mut:#8b949e --blue:#58a6ff --up:#3fb950 --down:#f85149 --gold:#d29922`, the same set in
`site/soapbox/render.mjs`), the `.card`/panel pattern, muted 12px `.k` labels, monospace
addresses/hashes, ●/▲ status dots, and a **light/dark toggle** (persisted in `localStorage`).
A **static SoapBox family nav** (the equivalent of `integrations/ecosystem-nav.mjs`, with
**Pool** added and marked current) runs across the top. Title is **"Pool — SoapBox"**.

The landing presents the **three doors** (operator's pool-as-wallet design):

- **Mine** — *live*: the coin menu (one card per `/api/pools` entry + honest "coming online"
  cards for configured-but-disabled coins).
- **AI Work** — door present, marked **"opens with PRANA"** (the tasking/switching-engine door).
- **Burn to Mine** — door present, marked **"opens with PRANA"** (the Burn Coin path).

No fake functionality: the two PRANA doors are non-interactive panels with honest labels.

To re-deploy after a theme/frontend change: `rsync -av pool/www/ <box>:/opt/melek-miningcore/www/`
(no service restart needed — Caddy serves the static files directly).

## "Start Mining" wizard (done-for-them setup) + phone mining

Above the honest miner table, each coin's detail view has a **done-for-them wizard**
(`pool/www/wizard.mjs` + UI in `pool.js`). Flow: **pick coin → paste your wallet address
(with a per-coin "don't have one?" wallet-help link) → pick hardware (CPU / AMD GPU /
NVIDIA GPU / Phone)** → the site generates everything **client-side** (the address never
leaves the browser; the pool only sees it as the stratum username at connect):

- **RandomX coins (Monero):** a personalized xmrig `config.json` (address + pool baked in),
  a **download .zip** (config + `start.bat` + `start.sh` + README, built by a dependency-free
  in-browser STORED-zip writer), a **config.json-only** download, and **copy-paste one-liners**
  (Windows PowerShell + Linux/Mac) that download the **official pinned xmrig release** from its
  real upstream GitHub, **verify the SHA256**, then mine. We **never rehost binaries** — pinned
  release URLs + SHA256 live in `MINERS` in `wizard.mjs`.
- **Etchash coins (ETC):** a ready GPU miner invocation (lolMiner + ethminer fallback) with a
  link to lolMiner's official release page.

**Phone mining path** (wizard "Phone" branch, RandomX only):
- **Android via Termux + xmrig ARM:** step list (install Termux from F-Droid →
  `pkg install xmrig` → scan/paste) plus a **QR code** (rendered with the vendored MIT
  `qrcode.mjs`, Kazuhiko Arase) whose payload **is** the self-contained Termux command
  (`xmrig -o host:port -u ADDR -p w -a rx/0 --coin=monero -t 2`) — scan it from the phone and
  run. xmrig ships no prebuilt Linux-ARM release, so on-phone we use the Termux ARM package,
  not a download.
- **Honesty:** a battery/heat warning is shown first ("participation, not profit; mine
  plugged-in only; phones are weak miners; thermal throttling"). **iOS** gets an honest
  "not practically minable" note (Apple blocks background CPU miners).

## SoapBox Miner — universal launcher ("one download, pick inside")

The wizard's **primary card** (above the per-coin menu) offers **one download per OS family**
that lets the user pick the coin *inside* a small text-menu app, and switch coins later without
re-downloading. Operator ask: *"one Download that has all of them, and then they can Select in
the App."* This is the **stage-1 web edition** of the pool-as-wallet app
(`.local/PRANA_MINING_POOL_AS_WALLET_2026-06-05.md` §7); the full wallet + hash↔AI switching
worker comes later from the PRANA repo.

**What the user gets** (generated **client-side**, address(es) baked in — never sent anywhere):
- **Windows:** `SoapBoxMiner-Windows.zip` = `SoapBoxMiner.ps1` (the launcher) + `SoapBoxMiner.bat`
  (double-click shim: `powershell -NoProfile -ExecutionPolicy Bypass -File …` — per-file only, no
  system policy change) + a READ-ME. Interactive numbered menu → pick a coin → it downloads the
  **official pinned miner** from upstream GitHub, **verifies SHA256**, unpacks, writes the
  personalized config, and mines. Re-run to switch coins; last choice remembered in
  `%LOCALAPPDATA%\SoapBoxMiner\soapbox-miner.json`.
- **Linux/macOS:** `soapbox-miner.sh` — same flow (`curl` + `sha256sum`/`shasum`, `python3` to read
  the menu, OS/arch detection incl. Apple-Silicon `macos-arm64`; ETC-GPU-on-mac = honest
  "not supported").

**Dynamic manifest = how new coins reach old downloads.** The launcher fetches
`/launcher-manifest.json` at startup (falling back to a copy frozen into the script at
generation time if the pool is unreachable), so coins we add later (Monero mainnet, OCTA/CAU,
PRANA at launch) appear in the menu of a launcher someone already downloaded — **no re-download**.
That static file is the **one source of truth's** product: `pool/www/build-manifest.mjs` runs
`buildManifest()` over the **same `MINERS` + `COINS`** the per-coin wizard uses. **Regenerate it
before every frontend deploy** (`node pool/www/build-manifest.mjs`; `--check` fails CI/tests if
stale). Manifest entry per coin: `coin, symbol, family, algo, stratum {host,port}, miner,
addrType, configTemplate, hardware[], enabled`; per miner: official `url` + `sha256` + `bin` +
`archive` per OS/arch.

**Security honesty (on the page + in the scripts):** the launcher is plain text and says so at
the top (what it does; address only ever used as the mining username; downloads only the official
upstream URLs in the manifest + checks SHA256). The page documents the **SmartScreen/Defender
warning** — it fires for *any* unsigned `.ps1`/`.bat`, not because anything's wrong — and we do
**not** suggest disabling Defender/SmartScreen beyond the standard per-file bypass shim. lolMiner
has no published per-file SHA256, so its manifest entries carry `sha256:null` and the launcher
says "verify against the official release page" rather than inventing a hash.

Generators live in `wizard.mjs` (`buildManifest`, `genWindowsLauncher`, `genWindowsBat`,
`genPosixLauncher`); UI wiring + client-side download in `pool.js` (`setupLauncher`). Tests in
`pool/www/launcher.test.mjs` (manifest shape + one-source-of-truth with `MINERS`/`COINS` +
enabled flags + static-file sync; address baking + shell-quote escaping per OS; `sh -n`/`bash -n`
parse; shellcheck if installed; manifest pick resolved end-to-end via python3).

### Phone coin decision (researched 2026-06-05)

- **Live phone path today = Monero on ARM** via the existing `xmr-stagenet` RandomX pool —
  **zero new infra**. The wizard exposes it as the phone-ready coin.
- **VerusCoin (VRSC)** is the best *dedicated* phone coin in the abstract (VerusHash 2.2 is
  famously ARM/CPU-efficient; project actively developed in 2026, official Android Verus
  Miner app). **But Miningcore cannot host it:** this build is vanilla `oliverw/miningcore`,
  whose source has **no VerusHash hasher** — the only `veruscoin` entry in `coins.json` is a
  stale Equihash-200,9 definition (`solver.args:[200,9,"Verushash"]`) that predates VerusHash
  2.x and does **not** match the live VRSC network. `oliverw/miningcore` is archived (read-only
  since 2023-10), so no upstream fix is coming. **Therefore nothing fake is staged for Verus** —
  adding real VRSC would need a Miningcore fork with a native VerusHash hasher (out of scope).
  The phone path rides **Monero / RandomX**, which works today.
- **Scala (XLA, Panthera)** — same blocker: no Panthera hasher in Miningcore. Not staged.

Generator logic is unit-tested: `node --test pool/www/wizard.test.mjs` (also in `npm test`)
covers per-coin address validation, generated xmrig config shape, worker-name sanitization,
one-liner SHA256 pinning, Etchash command, phone support gating, and the QR payload.

## Browser mining — "Mine right now" (real RandomX in the page, even on a phone)

The **top section** of the pool landing (operator order, directive Addendum 22: *"we want
Browser Mining Options, up front at the Top, then it Starts Explaining our Download and what
it Provides and for whom"*) is an **opt-in, in-browser RandomX miner** that submits **real,
pool-accepted shares** — no install, works on a laptop, desktop, or an Android/iPhone
**browser**. It is the global zero-barrier door; the launcher (the Download story) sits
directly below it.

**It is real, not a demo.** The miner is the vendored open-source **`randomx.js`**
(`pool/www/vendor/randomx/`, **BSD-3-Clause**, provenance + license in that folder). It JITs
RandomX programs to WebAssembly at runtime (the WASM is base64-inlined; nothing to fetch) and
its hashes are **identical to the reference implementation** — we re-checked it against the
**official RandomX test vector** in `pool/www/browser-mine.test.mjs`
(`key="test key 000", input="This is a test" => 639183aa…0b4e3f`). Because Miningcore
**re-validates every share's proof-of-work**, fake/incorrect hashing cannot pass — the worst
case is *zero* accepted shares (slow hardware), never a fake one.

**Honest physics (stated on the page):** light-mode RandomX in a browser is ~**8–10 H/s per
core** on a desktop CPU (measured in Node on the build box) and a few H/s on a phone — ~10–50×
slower than the native miner. Earnings ≈ **fractions of a cent per day**; the copy says
"participation, and it's real," not a payday. The page also carries the **ad-blocker /
CoinHive note** (opt-in, first-party, button-press only — the opposite of drive-by mining),
a **battery/heat** note for phones, a **throttle slider** (default 50%), and **auto-pause on
tab-hidden** (visibilitychange). We serve **everything first-party** — no third-party hosted
miner script (those are what blockers rightly flag).

**Architecture (browsers can't speak raw TCP stratum):**

```
browser tab                         the pool box
┌───────────────────────┐           ┌──────────────────────────────────────────┐
│ browser-mine.mjs (UI) │           │  Caddy :443  /ws ─► 127.0.0.1:8110        │
│   └ miner.mjs (stratum)│  WSS /ws  │      (melek-pool-bridge.service)          │
│       └ miner-worker   │ ───────►  │  bridge.mjs  WS◄►TCP  ─► 127.0.0.1:4446   │
│         (RandomX WASM, │           │      (Miningcore browser/WASM stratum,     │
│          Web Workers)  │           │       fixed low diff 16)                  │
└───────────────────────┘           └──────────────────────────────────────────┘
```

- **`pool/bridge/bridge.mjs`** — a Node **WebSocket→stratum bridge** (`ws`): one upstream TCP
  stratum connection per WS client, **transparent passthrough** of login/job/submit (it never
  parses stratum semantics, so it can't generate the "junk" Miningcore's `banOnJunkReceive`
  would punish), clean teardown either direction. Public-endpoint rails: **per-IP connection
  cap** (default 4), **per-connection token-bucket message-rate cap**, max message size,
  multiline/binary/non-JSON rejection, idle reaper. No keys, reads nothing from disk.
  Unit `pool/bridge/systemd/melek-pool-bridge.service` (WS bound to `127.0.0.1:8110`).
- **`pool/www/miner.mjs`** — main-thread controller: owns the WSS to `/ws`, speaks Monero
  stratum (login→job→submit), fans jobs to N Web Workers with **distinct nonce lanes**
  (offset+stride), aggregates hashrate, counts accepted shares, never submits a **stale-job**
  share. Pure stratum helpers (`targetToUint32`, `parseJob`, `buildSubmit`…) are unit-tested.
- **`pool/www/miner-worker.mjs`** — the hashing thread (module Web Worker): (re)inits the
  256 MiB RandomX cache only when the epoch **seed_hash** changes, writes the 4-byte nonce at
  the Monero blob offset (39), hashes, compares the hash's top-32-LE word to the compact
  target, posts shares + ~1 Hz hashrate samples, honors the throttle by sleeping between small
  hash slices (keeps the UI thread free).
- **Dedicated browser stratum port `4446`** (Miningcore `config.json`, `xmr-stagenet`):
  **fixed difficulty 16, no varDiff**, bound to `127.0.0.1` (the public path is the WSS bridge,
  not raw TCP). A weak WASM miner lands a share in seconds instead of minutes; native miners
  keep `4444/4445`. The bridge targets `4446` by default
  (`BRIDGE_STRATUM_PORT`).

**Caddy** carries `/ws` in **both** the live block (`deploy/Caddyfile.block`) and the staged
cutover block (`deploy/miningcore/Caddyfile.block`) so it survives the cutover.

**Deploy / restart:**

```bash
rsync -av pool/www/ <box>:/opt/melek-miningcore/www/        # ships vendor/randomx + the page
cp pool/bridge/systemd/melek-pool-bridge.service /etc/systemd/system/ && systemctl daemon-reload
systemctl enable --now melek-pool-bridge                    # WS bridge on 127.0.0.1:8110
# add port 4446 to the miningcore docker run + config.json (already in this repo's deploy files),
# then: systemctl restart melek-miningcore
# Caddy /ws (LOCK PROTOCOL): add the /ws handle to the pool block, validate, reload.
```

**End-to-end proof:** `node pool/bridge/proof-share.mjs <wss-or-ws url> <stagenet-address>`
runs the real protocol (login→job→hash→submit) through the bridge against the pool and exits
0 on **AT LEAST ONE ACCEPTED SHARE**. It only succeeds once the stagenet `melek-mc-monerod`
daemon is **synced** (until then Miningcore can't issue a block template, so stratum has no
jobs — see the sync note above).

**Tests:** `pool/bridge/bridge.test.mjs` (fake stratum: login/job/submit/teardown, per-IP cap,
rate cap, junk-rejection, token bucket), `pool/www/miner.test.mjs` (stratum helpers + worker/WS
glue with mocks: fan-out lanes, accept/reject, stale-job guard, throttle clamp), and
`pool/www/browser-mine.test.mjs` (RandomX test-vector correctness, page **order**
browser→download→doors, required controls/counters, honesty copy). All wired into `npm test`.

## Adding a coin (incl. PRANA) — the "plus ours" step

Every mineable coin is **one object in the `pools[]` array** of `config.json`. To add a coin:

1. Stand up its daemon (and wallet daemon for CryptoNote coins) on `melek-pool-net`.
2. If the coin isn't in Miningcore's built-in `coins.json`, add a coin definition there
   (family `cryptonote` / `ethereum` / `bitcoin` …) and rebuild the image.
3. Append a `pools[]` entry: `id`, `coin`, `address` (a fresh pool/payout address),
   `ports` (a free stratum port), `daemons` (host:port on the net), `paymentProcessing`.
4. `systemctl restart melek-miningcore`. The new coin appears on the menu automatically
   (the frontend reads `/api/pools`).

**PRANA specifically** — when the PRANA Ethash testnet/mainnet daemon exists:

```jsonc
{
  "id": "prana",
  "enabled": true,
  "coin": "prana",            // add a "prana" entry to coins.json, family "ethereum"
  "address": "0x<fresh PRANA pool address>",
  "ports": { "5560": { "listenAddress": "0.0.0.0", "difficulty": 1,
             "name": "PRANA Ethash" } },
  "daemons": [ { "host": "melek-prana-geth", "port": 8545 } ],
  "paymentProcessing": { "enabled": true, "minimumPayment": 0.1,
             "payoutScheme": "PPLNS", "payoutSchemeConfig": { "factor": 2.0 } }
}
```

Per directive Addendum 7, the **PRANA chain hardcodes the pool mechanic** (DevCoin model)
and a **consensus-enforced Hathor Fees Module** takes Hathor's percentage of mining fees on
*all* pools. That enforcement is **chain-side (the PRANA repo)**, not in this off-chain pool
software — this pool is the SoapBox front/operator pool that follows those rules. See
`.local/PRANA_MINING_POOL_AS_WALLET_2026-06-05.md`.

## Monero: stagenet now, mainnet staged

The live RandomX proof is **Monero stagenet** (`xmr-stagenet`, zero-value). A **Monero
mainnet** pool entry (`xmr-mainnet`) ships **fully configured but `"enabled": false`** in
`config.json`, because **the box cannot carry a pruned mainnet node** alongside everything
else: a pruned mainnet `monerod` needs **~80 GB+**, and the box had **~47 GB free** at
provision time (96 GB disk, 52% used; 11 GiB RAM, mostly committed). Starting a mainnet
daemon here would exhaust the disk. So mainnet is **staged, not started**, and the menu
shows **"Monero (mainnet) — coming online"** (a disabled card, honest label).

**One-command enable** (only on a box with the disk/RAM headroom, with a real mainnet wallet):

1. Provision a synced mainnet daemon `melek-mc-monerod-main` on `melek-pool-net`
   (pure-P2P, `--prune-blockchain` so it forms peers and serves `get_block_template`),
   plus a payout wallet `melek-wallet-rpc-main:18082`.
2. Set the `xmr-mainnet` pool `address` to a **real mainnet pool wallet** — a
   **mainnet-value key, which NEVER lives on this box** (operator-held / scoped signer).
3. Flip `"enabled": false` → `true` (and remove the `COMING_SOON` Monero entry in
   `www/pool.js`), then `systemctl restart melek-miningcore`. The mainnet card goes live
   on the menu automatically.

### Wallet posture (non-custodial)

This **is** the non-custodial property, and it is **standard Miningcore behavior**:

- **Per-user payout = the address the miner types at connect** (the stratum username, e.g.
  `xmrig -u YOUR_XMR_ADDRESS`). The pool pays *that* address. It never sees, requests, or
  stores a user's **spend key** — only their receive address. A compromised miner can't drain
  funds because mining never needs the spend key.
- The pool itself runs only a **receive-side payout wallet** for its own operating address
  (`melek-wallet-rpc`, stagenet). **Zero-value / testnet keys only on the box; never mainnet
  value keys** (mainnet value lives behind the operator signer, per the repo's zero-WIF rule).
- This matches the pool-as-wallet design (`.local/PRANA_MINING_POOL_AS_WALLET_2026-06-05.md`):
  one HD seed shared with Akasha, a CurrencyModule per coin, EVM coins on one shared address,
  external coins as **receive-only** mining modules, spend keys kept off the hot miner. The
  one-click / HD-seed wallet layer arrives with PRANA; today's pool is the receive-address
  miner front end for that design.

## Cutover (old pool → Miningcore)

Until proven, the **old `cryptonote-nodejs-pool` keeps `:3333/:5555`** and Miningcore runs
on `:4444/:4445/:5550`. Once an accepted RandomX share is verified through Miningcore:

1. **Caddy** (LOCK PROTOCOL):
   ```bash
   until mkdir /tmp/caddy.lock 2>/dev/null; do sleep 5; done
   # edit ONLY the pool.soapbox.community block: root -> /opt/melek-miningcore/www,
   # /api reverse_proxy -> 127.0.0.1:4000  (see deploy/miningcore/Caddyfile.block)
   caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
   rmdir /tmp/caddy.lock
   ```
2. **Stratum:** stop the old pool (do NOT delete — `systemctl disable --now melek-pool`,
   keep `/opt/melek-pool` + configs for rollback). Optionally move Miningcore's RandomX
   ports onto `:3333/:5555` (edit `config.json` ports, restart) so existing miners keep
   their endpoints.
3. **ufw:** open the Miningcore stratum ports (`4444 4445 5550`, plus `3333/5555` if reused).

## Rollback

1. Caddy block back to `root /opt/melek-pool/www` + `/api` → `127.0.0.1:8117` (lock protocol).
2. `systemctl enable --now melek-pool` (old pool resumes on `:3333/:5555`).
3. `systemctl disable --now melek-miningcore` (Miningcore stops; data persists in Postgres).
   Nothing is deleted; both stacks coexist.

## Verifying

```bash
# All pools (the multi-coin menu source)
curl -s http://127.0.0.1:4000/api/pools | python3 -m json.tool | head -60

# A RandomX miner against the new pool
xmrig -o 127.0.0.1:4444 -u 57kYk4...rv9Kz -p test -a rx/0   # expect "accepted" in miningcore logs

# Etchash daemon serving work (proof of the ETH-type family)
curl -s -X POST 127.0.0.1:8545 -d '{"jsonrpc":"2.0","method":"eth_getWork","params":[],"id":1}'

# Logs
docker logs --tail 60 melek-miningcore
docker logs --tail 30 melek-mordor
```

## Security notes

- **Throwaway keys only.** RandomX payout = Monero *stagenet* wallet (zero value).
  Etchash payout/etherbase = a fresh *Mordor testnet* address (zero value). No
  mainnet/HIVE/MELEK key ever touches this box.
- Postgres password is generated (`secrets/.pgpass`, mode 600, not committed) and
  substituted into the live `config.json` (which is therefore not committed verbatim;
  the committed template carries `__PG_PASSWORD__`).
- Postgres (5432), Mordor RPC (8545), monerod (38081), wallet-rpc (38082) and the
  Miningcore API (4000) are bound to `127.0.0.1`. Only stratum ports and Caddy (443)
  are public.
