# Run a MELEK Witness

MELEK is a DPoS (delegated proof-of-stake) chain: the community votes for the witnesses that
produce blocks. Anyone can run one. This is the full recipe. The live version of this page is at
**https://witness.melek.salon/run**.

## Network parameters (mainnet)

| | |
|---|---|
| **Chain id** | `907959e559e253f0db275e467363425cc2cf4f20f7721699914d248a5547ad8b` |
| **Address prefix** | `MELEK` |
| **Coin symbol** | `MELEK` (single token — no backed dollar) |
| **Block interval** | 3 seconds |
| **Seed node** | `seed.melek.salon:2001` |
| **Public RPC** | `https://rpc.melek.salon` |

## 1. Get a box

A small Linux VPS is enough while the chain is young — 4 GB RAM / 2 vCPU / 80 GB disk. Ubuntu 22.04.
(Requirements grow with chain history; plan to scale disk over time.)

## 2. Build the node

MELEK is a BLURT-family Graphene fork. Build the witness node from source with the **mainnet** flag:

```bash
# deps: build-essential cmake libboost-all-dev libssl-dev libsnappy-dev liblzma-dev libbz2-dev
git clone <the MELEK chain repo>   # ask in Discord for the current source URL
cd melek-chain
cmake -DBUILD_STEEM_TESTNET=OFF -DLOW_MEMORY_NODE=ON -DCMAKE_BUILD_TYPE=Release .
make -j$(nproc) steemd cli_wallet
```

`BUILD_STEEM_TESTNET=OFF` bakes the mainnet chain id + `MELEK` prefix into the binary. Do not pass a
testnet flag.

## 3. Make a witness account + a signing key

- Create a MELEK account (sign up at **melek.salon**) — this is your witness's identity.
- Generate a dedicated **block-signing key pair** (never reuse your owner/active key):
  ```bash
  ./cli_wallet   # suggest_brain_key  → gives you a wif_priv_key / pub_key pair
  ```
  Keep the private key on the node only. Keep your **owner key offline** (paper/hardware).

## 4. config.ini

In your data directory's `config.ini`:

```ini
p2p-endpoint = 0.0.0.0:2001
seed-node = seed.melek.salon:2001
witness = "youraccount"
private-key = <your block-signing WIF>
# public API/RPC (optional — only if you want to serve RPC):
# webserver-http-endpoint = 0.0.0.0:8090
# plugin = webserver p2p json_rpc witness account_by_key condenser_api
```

Start it (systemd unit recommended) and let it sync from the seed node.

## 5. Register your witness

Once synced, publish an `update_witness` (via `cli_wallet` — it handles the chain id automatically
when built for mainnet):

```
update_witness "youraccount" "https://youraccount.example/witness" \
  "MELEK<your-signing-pubkey>" \
  {"account_creation_fee":"0.030 MELEK","maximum_block_size":65536,"sbd_interest_rate":0} true
```

Your witness is now registered with its signing key and properties.

## 6. Get voted in

Witnesses produce in stake-weighted order. Campaign for votes:

- Post an introduction on-chain (tag `witness-category`).
- Ask MELEK stakeholders to vote you with `account_witness_vote "voter" "youraccount" true`.
- Watch your rank at **witness.melek.salon** and your block production once you enter the schedule.

## 7. Stay up

Missed blocks hurt your rank and the chain's finality. Run under systemd with auto-restart, monitor
head-block lag, and **never restart a node whose last-irreversible-block is frozen** — bring peers up
first. Questions: the Witness School and Discord.

---

*MELEK mainnet launched 7:12 on 7/12/2026. Hathor is the founding witness; helper witnesses provide
finality. This document is public and forkable — the network survives any single operator.*
