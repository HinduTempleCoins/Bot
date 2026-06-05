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
plus a **synced** stagenet daemon. While the local `melek-monerod` finishes syncing, the
pool's daemon endpoint points at the public synced node `node.monerodevs.org:38089`
(same trick the old pool used; flip one line back to `melek-monerod` once local sync
reaches the tip).

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
| `melek-wallet-rpc` (shared w/ old pool) | `sethsimmons/simple-monero-wallet-rpc` | `127.0.0.1:38082` | Monero stagenet payout wallet |
| `melek-monerod` (shared w/ old pool) | `sethsimmons/simple-monerod` | `127.0.0.1:38081` | Local Monero stagenet daemon (syncing) |
| (Caddy, shared) | system caddy | `:443` | TLS + static frontend + `/api` proxy |

Deploy artifacts in this repo:

- `deploy/miningcore/config.json` — Miningcore config (committed with a `__PG_PASSWORD__`
  placeholder; the live file on the box has the real generated password substituted in).
- `deploy/miningcore/www/` — the multi-coin frontend (`index.html`, `style.css`, `pool.js`).
- `deploy/miningcore/systemd/*.service` — units for miningcore, postgres, mordor.
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
systemctl enable --now melek-mc-postgres melek-mordor melek-miningcore

# 5. Frontend
cp -r deploy/miningcore/www/* /opt/melek-miningcore/www/
```

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
