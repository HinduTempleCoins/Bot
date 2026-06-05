# MELEK Ecosystem Mining Pool

A CryptoNote (RandomX) mining pool, live and operational, fronting toward the
**pool-as-wallet** design in
`.local/PRANA_MINING_POOL_AS_WALLET_2026-06-05.md`. The MVP mines a CryptoNote /
RandomX coin **now** and is architected so PRANA (the operator's Ethash ETH-clone)
slots in later as one more currency module — a config/module switch, not a rebuild.

- **Live frontend:** https://pool.soapbox.community
- **Stats API:** https://pool.soapbox.community/api (reverse-proxied to the pool app)
- **Stratum:** `pool.soapbox.community:3333` (low-diff / CPU) and `:5555` (high-end)

## What coin it mines (and the swap story)

The pool currently mines **Monero stagenet** (`sXMR`), a free public RandomX /
CryptoNote network. Stagenet is throwaway-money by design: the pool's payout wallet
is a freshly generated **stagenet** wallet (no mainnet value, satisfies the
"testnet/throwaway keys only — never a mainnet/HIVE/MELEK key" rule).

Why Monero stagenet and not the operator's heritage coin tonight: the heritage
`HinduTempleCoins/cryptonote` is the classic CryptoNote reference (GCC 4.7 / Boost
1.55 era) and `HinduTempleCoins/configs` are Forknote configs — neither builds
cleanly on a modern Ubuntu 24.04 toolchain without a substantial porting effort.
The deliverable was "the pool app demonstrably operational end-to-end," so we mine a
robust public RandomX network and treat the coin as **config-only**.

**Swapping the coin is config, not code.** To point the pool at a different
CryptoNote/RandomX daemon (the heritage coin once its daemon builds, a Forknote
binary + their config, Monero testnet, Wownero, etc.):

1. Run that coin's daemon + `*-wallet-rpc` (or equivalent) and create a pool wallet.
2. In `/opt/melek-pool/config.json` set: `coin`, `symbol`, `coinUnits`,
   `coinDecimalPlaces`, `coinDifficultyTarget`, `daemonType`, `cnAlgorithm`,
   `cnVariant`, `cnBlobType`, `poolAddress`, and the `daemon`/`wallet` host:port.
3. In `/opt/melek-pool/www/config.js` set `parentCoin`, `blockchainExplorer`, etc.
4. `systemctl restart melek-pool` (and the daemon/wallet units). Done.

## The PRANA switch (design-doc §7 build order)

The design doc's premise: *one-click mining of a currency is inseparable from
holding a wallet for that currency* — so each mineable currency is a **CurrencyModule**
(chain + wallet + miner + settlement) and the whole pool is a multi-currency
wallet/miner/switcher behind one HD seed shared with Akasha. Build order, and where
tonight's MVP sits in it:

| Step | Design-doc §7 item | Status |
|---|---|---|
| 1 | Shared HD keystore = Akasha's keystore (one seed, non-custodial) | deferred (Akasha) |
| 2 | PRANA module end-to-end (one-click → wallet → payout → worker → balance) | deferred to PRANA launch |
| 3 | Ecosystem currencies (wrapped tokens + MELEK) as modules | deferred |
| 4 | Formalize the `CurrencyModule` interface | deferred |
| 5 | **External taught coins as receive-only mining modules (standard miner + wallet receive address)** | **DONE in spirit — this MVP _is_ a step-5 module: a standard CryptoNote miner pointed at a coin, paying to a wallet receive address.** |
| 6 | Hardening — hardware-wallet support, watch-only mining, per-module audits | deferred |

When PRANA launches: stand up its Ethash daemon and add an Ethash pool path. The
design doc flags **MiningCore** as the strong fit there because one MiningCore
daemon supports **both** CryptoNote (RandomX) **and** Ethash — so the long-term move
is to migrate this stratum layer to MiningCore and add PRANA as a second algo/coin,
or run an open-ethereum-pool-style Ethash pool alongside. The wallet/receive layer,
the frontend, the Caddy/DNS wiring, and the ops model here all carry over.

## What runs where (the public MELEK box, x86 Ubuntu, under systemd + Docker)

> Host IP, DNS token storage, and exact deploy steps live in the gitignored deploy
> record (`.local/POOL_DEPLOY_2026-06-05.md`), per the repo's private-by-default rule.

Everything is Docker containers on a shared user-defined network `melek-pool-net`,
each owned by a systemd unit (auto-restart). State lives under `/opt/melek-pool`.

| Container / unit | Image | Ports | Role |
|---|---|---|---|
| `melek-monerod` / `melek-pool-monerod.service` | `sethsimmons/simple-monerod` | `127.0.0.1:38081` (RPC) | Monero **stagenet** daemon (the mined coin) |
| `melek-wallet-rpc` / `melek-pool-walletrpc.service` | `sethsimmons/simple-monero-wallet-rpc` | `127.0.0.1:38082` (RPC) | Pool payout wallet (stagenet, throwaway) |
| `melek-pool-redis` / `melek-pool-redis.service` | `redis:7-alpine` | `127.0.0.1:6379` | Share/stat store |
| `melek-pool` / `melek-pool.service` | `melek-pool:latest` (built from `cryptonote-nodejs-pool`) | `:3333`, `:5555` (stratum, public), `127.0.0.1:8117` (API) | Stratum server + payments + stats API |
| (Caddy, shared) | system caddy | `:443` | TLS + static frontend + `/api` proxy for `pool.soapbox.community` |

- Pool source + Dockerfile: `/opt/melek-pool/cryptonote-nodejs-pool` (the upstream
  `dvandal/cryptonote-nodejs-pool`, with the Dockerfile pinned to
  `node:16-bullseye-slim`, a git `insteadOf` https rewrite, and the **dead**
  `turtlecoin-multi-hashing` dep removed — that repo is gone; RandomX hashing comes
  from `cryptonight-hashing`, which is what the Monero config uses).
- Pool config: `/opt/melek-pool/config.json` (template committed at
  `pool/deploy/config.json`).
- Frontend (static): `/opt/melek-pool/www` (config committed at
  `pool/deploy/frontend/config.js`).
- DNS: `pool.soapbox.community` A record points at the public box, set via the
  operator's DNS API tooling (details in the `.local` deploy record).

### Daemon source: a synced daemon is required to issue jobs

The pool can only hand out mining jobs when its `daemon` can serve
`get_block_template` — which a *syncing* node refuses (`"Core is busy"`). The local
`melek-monerod` syncs stagenet (~2.13M blocks) on first run, so until it reaches the
tip the pool's `config.json` `daemon` is pointed at a public **synced** stagenet RPC
node (e.g. `node.monerodevs.org:38089`) so the pool is functional immediately. Once
the local daemon is synced (`get_info` → `"synchronized": true`), set
`daemon` back to `{ "host": "melek-monerod", "port": 38081 }` and
`systemctl restart melek-pool`. The payout wallet is always the local one.

## Ops commands

```bash
# Status of the whole stack
docker ps --filter name=melek-monerod --filter name=melek-wallet-rpc \
          --filter name=melek-pool-redis --filter name=melek-pool

# Daemon sync / height
curl -s http://127.0.0.1:38081/get_info -d '{}' | python3 -m json.tool | grep -E 'height|synchronized'

# Pool stats API (also behind https://pool.soapbox.community/api)
curl -s http://127.0.0.1:8117/stats | python3 -m json.tool | head -40

# Pool wallet address / balance (stagenet)
curl -s http://127.0.0.1:38082/json_rpc -d '{"jsonrpc":"2.0","id":"0","method":"get_address","params":{"account_index":0}}'
curl -s http://127.0.0.1:38082/json_rpc -d '{"jsonrpc":"2.0","id":"0","method":"get_balance","params":{"account_index":0}}'

# Restart the pool app after a config edit
systemctl restart melek-pool        # if systemd units are installed
#   or, Docker restart-policy mode:
docker restart melek-pool

# Logs
docker logs --tail 50 melek-pool
docker logs --tail 50 melek-monerod
```

### Installing the systemd units (optional — containers already carry `--restart unless-stopped`)

The containers were created with Docker's `--restart unless-stopped` policy, so they
already survive reboots (dockerd is itself a systemd service). To make systemd the
single source of truth instead, copy the units and let them recreate the containers:

```bash
cp pool/deploy/systemd/*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now melek-pool-redis melek-pool-monerod melek-pool-walletrpc melek-pool
```

(The units use `docker run --rm` so each start recreates a clean container against
the persistent volumes under `/opt/melek-pool`.)

## Connecting a miner (RandomX / xmrig)

```bash
xmrig -o pool.soapbox.community:3333 \
      -u 57kYk4iMy9SCMyeRctNW6QUpCVKnRp1682BiYnxUqMVDjhAVABfQJbUTC5oTvfRruNVVxqGK6MEz3QoQLnV2NPGxBArv9Kz \
      -p worker1 --coin monero
```

Use any valid Monero **stagenet** address as `-u` to mine to your own balance.
(Finding an actual block requires the daemon to be fully synced to the stagenet tip;
share acceptance does not.)

## Security notes

- **Throwaway keys only.** The payout wallet is a Monero *stagenet* wallet — zero
  real value. No mainnet/HIVE/MELEK key touches this box. Wallet password is in
  `/opt/melek-pool/wallet/.wallet-pass` (mode 600, not committed).
- The daemon RPC (38081), wallet RPC (38082), Redis (6379) and the pool API (8117)
  are bound to `127.0.0.1` only. Just stratum (`3333`/`5555`) and Caddy (`443`) are
  public; the stratum ports are opened in `ufw`.
- The pool API admin password in the committed config is a demo placeholder
  (`melek-pool-admin`); rotate it for any non-stagenet use.
