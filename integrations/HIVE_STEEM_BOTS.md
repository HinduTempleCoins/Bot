# HIVE + STEEM APIs & Bot-Building Sources

Reference catalog for building bots on the HIVE and STEEM chains — and, by extension, on **MELEK**, which is a Graphene/BLURT-family fork and speaks the same `condenser_api` JSON-RPC dialect. Everything here is **read-side / reference**; broadcasting on MELEK goes through MELEK-Signer (never a local WIF — see `MELEK_SIGNER.md`).

This is the chain-side companion to `API_CATALOG.md`. The base-layer reader that already uses this surface is `integrations/chain-explorer.mjs`; the HIVE-Engine side is `integrations/hive-engine-market.mjs` + `integrations/he-client.mjs`.

---

## 1. The RPC API surface (Hive & Steem, Graphene)

All of these are POST JSON-RPC 2.0 to a node URL: `{"jsonrpc":"2.0","id":1,"method":"<api>.<method>","params":[...]}`.

### condenser_api (legacy steemd-compatible — the most portable; MELEK supports this)
- `condenser_api.get_dynamic_global_properties` — head block, supply, current witness, time
- `condenser_api.get_accounts` `[[names]]` — balances, keys, vesting, witness votes, post count
- `condenser_api.get_block` `[num]` — full block with transactions/operations
- `condenser_api.get_account_history` `[account, start(-1), limit]` — per-account op log (transfers, votes, etc.)
- `condenser_api.get_ops_in_block` `[num, only_virtual]`
- `condenser_api.get_witness_by_account` `[name]` — witness record, signing key, missed, feed
- `condenser_api.get_witnesses_by_vote` / `lookup_witness_accounts`
- `condenser_api.get_content` `[author, permlink]` / `get_content_replies` (legacy post fetch)
- `condenser_api.get_current_median_history_price` — base/quote price feed
- `condenser_api.get_reward_fund` `["post"]`
- `condenser_api.broadcast_transaction` / `broadcast_transaction_synchronous` — submit a signed tx
- `condenser_api.get_followers` / `get_following` (legacy follow)

### account_history_api (newer, structured)
- `account_history_api.get_account_history`
- `account_history_api.get_ops_in_block`
- `account_history_api.enum_virtual_ops` — author/curation rewards, fills, etc.

### block_api
- `block_api.get_block` `{block_num}`
- `block_api.get_block_range` `{starting_block_num, count}` — efficient block streaming

### database_api (Graphene state)
- `database_api.find_accounts` / `list_accounts`
- `database_api.list_witnesses` / `find_witnesses`
- `database_api.get_dynamic_global_properties`
- `database_api.find_comments` / `list_comments`
- `database_api.list_vesting_delegations`

### bridge (Hive `hivemind` — the social/communities layer; Hive-only, not Steem/MELEK yet)
- `bridge.get_ranked_posts` `{sort, tag, observer}` — feeds (trending/created/hot/payout)
- `bridge.get_account_posts` `{sort, account}` — blog/feed/replies/payout
- `bridge.get_discussion` `{author, permlink}` — a post + its full reply tree
- `bridge.get_post` / `bridge.get_profile`
- `bridge.list_communities` / `bridge.get_community` / `bridge.list_subscribers`
- `bridge.get_follow_list` `{observer, follow_type: 'blacklisted'|'muted'}`

### market_history_api (internal DEX: HIVE↔HBD)
- `market_history_api.get_ticker` / `get_volume`
- `market_history_api.get_order_book` `{limit}`
- `market_history_api.get_trade_history` / `get_recent_trades`
- `market_history_api.get_market_history` `{bucket_seconds, start, end}`

### rc_api (resource credits — the bandwidth model, replaces bandwidth)
- `rc_api.find_rc_accounts` `{accounts}` — RC mana, max_rc (how much an account can transact)

### transaction_status_api / network_broadcast_api
- `transaction_status_api.find_transaction` `{transaction_id}` — confirm inclusion
- `network_broadcast_api.broadcast_transaction`

---

## 2. Public RPC nodes

**Hive** (full + hivemind unless noted):
- `https://api.hive.blog` (official)
- `https://api.deathwing.me`
- `https://api.openhive.network`
- `https://hive-api.arcange.eu`
- `https://rpc.ausbit.dev`
- `https://api.c0ff33a.uk`
- `https://techcoderx.com`
- `https://hived.emre.sh`
- `https://api.hive.blue`
- `https://anyx.io`
- Beacon (live node health/ranking): `https://beacon.peakd.com/api/nodes`

**Steem**:
- `https://api.steemit.com` (official)
- `https://steemd.privex.io`
- `https://api.justyy.com` / `https://api.steemyy.com`
- `https://api.pennsif.net`
- `https://steem.senzen.io`

**MELEK** (when live): set `MELEK_RPC_URL`; `chain-explorer.mjs` will use it and label output MELEK. Until then it runs against Hive for development.

---

## 3. HIVE-Engine (Layer-2 sidechain — tokens, NFTs, the DEX the trade bot uses)

Not Graphene — a separate Steem-Smart-Contracts (SSC) sidechain indexed off Hive. JSON-RPC `find`/`findOne` over contracts/tables.

**Contracts RPC** (`/rpc/contracts`, method `find`):
- `https://api.hive-engine.com/rpc/contracts` (official)
- `https://herpc.dtools.dev/contracts`
- `https://engine.rishipanthee.com/contracts`
- `https://api2.hive-engine.com/rpc/contracts`
- `https://ha.herpc.dtools.dev/contracts`

**Account history**:
- `https://history.hive-engine.com/accountHistory`
- `https://accounts.hive-engine.com/accountHistory`

**Key tables**:
- `market` / `metrics` `{symbol}` — last/bid/ask/volume
- `market` / `buyBook` · `sellBook` `{symbol}` — order book (index `priceDec`)
- `market` / `tradesHistory` `{symbol}` — recent fills
- `tokens` / `tokens` `{symbol}` — supply, issuer, metadata
- `tokens` / `balances` `{account}` or `{symbol}` — holdings / holder list
- `nft` / `*`, `marketpools` (Beeswap AMM), `tokenfunds`, `mining`, `airdrops`

**Front-ends / docs**: Tribaldex (`tribaldex.com`), Hive-Engine UI (`hive-engine.com`), Beeswap (`beeswap.dcity.io`), LeoDex. Docs: `github.com/hive-engine/hivengine` and the SSC primer.

---

## 4. Libraries (the canonical ones)

### JavaScript / TypeScript
- **`@hiveio/dhive`** — the recommended Hive client (used by most modern Hive apps). Typed, broadcast helpers, key handling.
- **`hive-tx`** — lightweight: build/sign/broadcast a transaction without the full client. Good for minimal signers.
- **`@hiveio/hive-js`** — the older steem-js-derived Hive client (still works; condenser-style).
- **`dsteem`** / **`steem`** (steem-js) — Steem equivalents of dhive / hive-js.
- **`sscjs`** — official thin HIVE-Engine JSON-RPC client.
- **`hive-nectar`** — newer JS toolkit; **`hive-keychain`** SDK for browser signing.

### Python
- **`hive-nectar`** — maintained fork of beem; the practical choice today (Hive + Steem).
- **`beem`** — the classic Hive/Steem Python lib (`@holger80`); large but feature-complete.
- **`lighthive`** — minimal, fast Hive client (`@emrebeyler`).
- **`steem-python`** — legacy Steem (unmaintained; reference only).

### Signing / auth (no raw keys in app code)
- **`hivesigner` SDK** — OAuth2-for-Hive; app gets a scoped, revocable bearer token (the MELEK-Signer model is built on this pattern — see `MELEK_SIGNER.md`).
- **Hive Keychain** — browser extension; `requestBroadcast` so the user's keys never touch your code.
- **HAS (Hive Authentication Services)** — QR/mobile signing.
- Other: `hive-php`, `radiator` (Ruby), `condenser` (the reference front-end).

---

## 5. Bot-building references / tutorials

- **developers.hive.io** — official dev portal: API method docs, "Understanding Configuration Values", broadcast ops, the tutorials series. Source: `github.com/hiveio/devportal`.
- **`github.com/openhive-network/hive`** — `hived` node source (the Graphene base MELEK forks from the BLURT line of).
- **`github.com/hive-engine`** — sidechain node + contracts (token/market/nft logic).
- **PeakD tags** `#hive-dev`, `#devs`, `#programming` — working bot write-ups.
- **Authors worth reading**: `@engrave` (dhive, Hive Keychain), `@good-karma` (Ecency/beem ecosystem), `@holger80` (beem), `@emrebeyler` (lighthive), `@howo` (core dev tutorials).
- **Steem**: `developers.steem.io`, `github.com/steemit/steem`, `github.com/steemit/condenser`.
- **Operator's own corpus** (`[[operator-steemit-handles]]`): `@punicwax` witness explainer + mining/SMT/TRC10 guides, `@marsresident` 2017-era Cryptology tutorials — these map onto the tutorial lessons and are first-party bot/chain references.

---

## 6. How this maps to MELEK / this repo

| Need | Use |
|---|---|
| Base-chain account/block/witness view | `chain-explorer.mjs` (condenser_api, multi-node failover) |
| HIVE-Engine market / token data | `hive-engine-market.mjs` + `he-client.mjs` |
| Bot's on-chain P&L | `tradebot-forensics.mjs` (accountHistory + balances) |
| Broadcasting on MELEK | MELEK-Signer + `hivesigner` SDK (scoped token) — **never** a local WIF |
| Block streaming (future) | `block_api.get_block_range` against `MELEK_RPC_URL` |
| Social/communities (future) | `bridge.*` once MELEK runs a hivemind-equivalent |

> MELEK is a Graphene fork: `condenser_api`, `block_api`, `database_api`, `account_history_api`, `rc_api`, and `market_history_api` should all be available; `bridge` (hivemind) depends on whether the social indexer is deployed. Confirm the exact method set against the MELEK node once `MELEK_RPC_URL` is live.
