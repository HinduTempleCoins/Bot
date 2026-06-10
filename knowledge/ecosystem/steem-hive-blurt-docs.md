# Steem / Hive / Blurt — Canonical Docs & Developer Portals

_Consolidated documentation reference for the Graphene/Steem-fork ecosystem MELEK descends from._

This is the **doc-pointer companion** to [`steem-hive-dev-repos.md`](./steem-hive-dev-repos.md) (our index of
79 cloned dev repos) and [`steem-hive-blurt-docs.json`](./steem-hive-blurt-docs.json) (the machine-readable
version of this table). Where the repo index says *what code exists*, this file says *where to learn the
concepts* — the official portals, READMEs, and wikis — and which of our cloned repos covers each.

MELEK is a **Steem HF23 fork** (Graphene family, same lineage as BLURT and Hive). Everything below is
upstream reference; adapt the mechanics, not the hostnames. The reader-facing version of this material,
rewritten for our chain (TST/HF23, 3-second blocks), lives in [`site/witness-docs/`](../../site/witness-docs/).

---

## 1. Hive — developer portals & docs

| Doc / portal | What it teaches | Our cloned repo that covers it |
|---|---|---|
| **developers.hive.io** | The canonical Hive developer portal: tutorials (JS/Python), the apps catalog, the API reference, and the "understanding" guides (accounts, keys, RC, communities). The single best entry point for the whole Graphene social stack. | — (portal; mirrored conceptually by `openhive-network/hive-js`, `openhive-network/dhive`) |
| **hive.io / whitepaper** | The chain's mission, tokenomics (HIVE/HBD), DPoS, and the 3-second-block social-blockchain model. | — |
| **dhive README + typedoc** | The reference TypeScript/JS client: connecting to a node, reading state, building & broadcasting ops (`comment`, `vote`, `transfer`, `custom_json`). What our `src/chain/` scaffolding mirrors. | `openhive-network/dhive` |
| **hive-js README** | The official JS API (older `steem-js` lineage) — broadcast helpers, formatter, auth. | `openhive-network/hive-js` |
| **hive-tx README** | The most lightweight complete JS lib (web + node) — manual tx construction/signing, good for understanding the wire format. | `mahdiyari/hive-tx` |
| **hive-pollen README** | Modern zero-dependency TS SDK; clean reference for op-building and signing without a heavy client. | `srbde/hive-pollen` |
| **HAF README (Hive Application Framework)** | How to build fork-resilient apps on top of a node by indexing the chain into Postgres with automatic undo on forks. The basis of a modern API node. | `openhive-network/haf` |
| **haf_api_node README** | The operational guide to running a full HAF-based API node (Docker compose, Ubuntu sizing, services). Closest upstream to "run a MELEK API node." | `openhive-network/haf_api_node` |
| **hivemind README** | The social "consensus-interpretation" layer: feeds, follows, communities, the `bridge.*` and `condenser_api.*` methods front-ends call. | `openhive-network/hivemind`, `steemit/hivemind` |
| **drone README** | API caching/load layer (Rust/Actix) in front of a node — what sits between front-ends and `hived`. | `openhive-network/drone` |
| **condenser / denser READMEs** | The reference React front-ends (blog, wallet, communities, witness voting). Our alpha condenser descends from this. `denser` is the modern Next.js rewrite. | `openhive-network/condenser`, `openhive-network/denser`, `steemit/condenser` |
| **hive-renderer README** | The canonical post-body renderer (Markdown + sanitization rules) front-ends use, so posts render identically and safely. | `openhive-network/hive-renderer` |
| **wax README** | Calls `hived` C++ code from Python/JS — the low-level protocol/serialization reference. | `openhive-network/wax` |
| **workerbee README** | High-level Hive automation library (watch the chain, react to ops) — bot/observer pattern reference. | `openhive-network/workerbee` |
| **tinman README** | The official **testnet** tooling — snapshot a mainnet, create a testnet, fund accounts. Directly relevant to how MELEK's testnet was stood up. | `openhive-network/tinman` |

## 2. Hive — keys, signing & auth docs

| Doc / portal | What it teaches | Our cloned repo |
|---|---|---|
| **docs.hivesigner.com** | OAuth2-for-Hive: scoped access tokens, sign/broadcast on a user's behalf without holding their keys. The pattern our (separate, private) MELEK-Signer follows. **Reference only.** | `ecency/hivesigner-sdk`, `ecency/hivesigner-api`, `ecency/hivesigner-ui`, `ledgerconnect/hivesigner` |
| **Hive Keychain docs + keychain-sdk README** | Browser-extension key custody: dApps request signatures; keys never leave the extension. The "user holds their own keys" half of auth. | `hive-keychain/hive-keychain-extension`, `hive-keychain/keychain-sdk` |
| **HAS (Hive Authentication Service)** | QR/websocket auth so a phone app signs for a web session without exposing keys. | `brianoflondon/has-python` |
| **beekeeper README** | Standalone wallet daemon (HTTP/WS API) that holds keys and signs — the "signer service" archetype. | `openhive-network/beekeeper` |
| **hive-account-creator README** | The free anonymous account-creation service: operator-funded `create_account` so users self-register without paying a fee. The upstream of our faucet/signup flow. | `openhive-network/hive-account-creator` |
| **hive-key-updater README** | Web tool to rotate account keys safely — the "keys explained / change your password" UX reference. | `TheCrazyGM/hive-key-updater` |

## 3. Hive — witness operator docs

| Doc / portal | What it teaches | Our cloned repo |
|---|---|---|
| **hive-witness-essentials README** | The de-facto witness operator's toolkit (Someguy123): pricefeed, watcher, remote node-switch, CLI. The single best "how to run a witness" reference; our `witness/` is the spiritual port. | `Someguy123/hive-witness-essentials` |
| **hivefeed-js README** | A focused price-feed publisher — what `feed_publish` does and how often to publish. Mirrors our `witness/feed-publisher.mjs`. | `Someguy123/hivefeed-js` |
| **hive-docker / "Hive-in-a-box" README** | Running `hived` (witness/seed node) via Docker — the node-operations baseline. | `Someguy123/hive-docker`, `Someguy123/blurt-docker` |
| **witness-notify README** | Missed-block alerting to chat — the monitoring half of witness ops (our `witness/monitor.mjs`). | `mahdiyari/witness-notify` |
| **witness-monitor / monitorwitness READMEs** | Older but clear witness-health monitors (xeroc, DoctorLai) — failover and missed-block detection patterns. | `xeroc/witness-monitor`, `DoctorLai/monitorwitness` |
| **SteemWitnessAutoSwitch README** | Auto-failover between backup signing nodes if the primary misses blocks. | `DoctorLai/SteemWitnessAutoSwitch` |
| **hived-rpc-scanner README** | Health-check RPC endpoints — what makes a node "up" for a load balancer / API list. | `emre/hived-rpc-scanner` |
| **steem-load-balancer / steem-proxy-cloudflare READMEs** | Spreading API traffic across healthy nodes — front-of-node infrastructure. | `DoctorLai/steem-load-balancer`, `DoctorLai/steem-proxy-cloudflare` |

## 4. Steem — docs & client libraries

| Doc / portal | What it teaches | Our cloned repo |
|---|---|---|
| **developers.steem.io / steem.io whitepaper** | The original Graphene social-blockchain design (rewards pool, DPoS, SP/STEEM/SBD, 3-second blocks). MELEK forks the **Steem HF23** codebase, so this is our nearest upstream spec. | — |
| **steem-js / dsteem READMEs** | The original JS clients Hive's forked from; same op set, useful when reading older tutorials. | `DoctorLai/steem-js`, `DoctorLai/dsteem` |
| **awesome-steem** | A curated link-list of the entire Steem dev ecosystem — a map of what existed and where the docs live. | `DoctorLai/awesome-steem` |
| **piston-lib / python-graphenelib / graphenejs-lib** | The xeroc base-layer libraries — the **Graphene primitives** (transaction format, signatures, object IDs) underneath every Steem/Hive/Blurt lib. Read these to understand the bytes. | `xeroc/piston-lib`, `xeroc/python-graphenelib`, `xeroc/graphenejs-lib` |
| **docs.pygraphenelib.com** | In-depth docs for the Python Graphene base library (tx building, signing, account/asset objects). | `xeroc/python-graphenelib` |

## 5. Blurt — docs

| Doc / portal | What it teaches | Our cloned repo |
|---|---|---|
| **blurt.blog / blurt.foundation docs** | Blurt is the **transfer-and-post, no-curation-rewards** Steem fork — the closest sibling to a single-purpose Graphene social chain. Relevant because MELEK is also a lean Graphene fork. | — |
| **blurt-docker "Hive-in-a-box" README** | Someguy123's Blurt node-in-Docker — same toolkit as Hive, retargeted at Blurt; shows how little changes between forks (which is the point for MELEK). | `Someguy123/blurt-docker` |
| **BlurtWitnessAutoSwitch README** | Witness failover ported to Blurt — confirms the witness-ops pattern is identical across forks. | `ericet/BlurtWitnessAutoSwitch` |

## 6. Python clients (cross-chain) & libraries

| Doc / portal | What it teaches | Our cloned repo |
|---|---|---|
| **beem docs (beem.readthedocs.io)** | The comprehensive Python lib for HIVE **and** STEEM — wallet, ops, witness calls. Notably, beem's serialization is what we leaned on around our `witness_update` serialization gotcha on the fork. | `holgern/beem` |
| **hive-nectar README** | Modern maintained Python lib (beem successor) for Hive. | `srbde/hive-nectar` |
| **lighthive README** | Minimal Python client ("simple and stupid") — easiest read for understanding a single RPC call. | `brianoflondon/lighthive`, `emre/lighthive` |

## 7. Hive Engine / SMT (side-token layer) docs

| Doc / portal | What it teaches | Our cloned repo |
|---|---|---|
| **steemsmartcontracts-wiki / hivesmartcontracts-wiki** | The official Engine developer wiki: system design, the contract API, how `custom_json` ops drive a sidechain of tokens/markets. The reference for our `engine/` (MELEK-Engine). | `hive-engine/steemsmartcontracts-wiki`, `hive-engine/hivesmartcontracts-wiki` |
| **hivesmartcontracts README** | The Engine node itself (the sidechain that watches Hive `custom_json` and maintains token state). | `hive-engine/hivesmartcontracts`, `TheCrazyGM/hivesmartcontracts` |
| **sscjs README** | The light JS client for the Engine JSON-RPC — how a front-end reads token balances/markets. | `hive-engine/sscjs` |
| **scotbot-docs** | SCOT/Nitrous tribe-token reward docs — how a community token piggybacks post rewards. | `hive-engine/scotbot-docs` |
| **nectarengine README** | Modern Python lib for Engine tokens. | `srbde/nectarengine` |

---

_For the people-facing, MELEK-accurate rewrites of the witness/keys/account/RC material above, see
[`site/witness-docs/index.md`](../../site/witness-docs/index.md)._
