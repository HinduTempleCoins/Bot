# MELEK — glossary for newcomers

Plain-language terms for the MELEK ecosystem, the chain, and this repo. For the full picture read `BRIEF.md`.

## Core

- **MELEK** — the project and the blockchain. Always uppercase, five letters, never abbreviated. A Graphene-family (BLURT/Hive-lineage) chain.
- **Hathor** — the founding witness account on the MELEK chain (lowercase `hathor` on-chain). Operated by the AI Witness; this repo is its off-chain software. Named for the VR-Hathor-Mehit figure of the Gen-2 Poe bot lineage — **not** the unrelated hathor.network DAG project.
- **The Witness / AI Witness** — Hathor as a person: a Graphene witness account whose operator is an AI. Produces blocks, posts, votes, helps people sign up.
- **Rule 1 ("The Beginning")** — the single load-bearing rule the Witness reasons from (`RULE_1.md`). Egregore/tulpa frame; a held position, not a claim to defend.

## Chain (Graphene)

- **Witness** — a block producer + price-feed publisher, elected by stake-weighted vote (DPoS). Hathor has a one-year slot protection at the chain-code level, then reverts to ordinary election.
- **Condenser** — the web front-end (blog/wallet UI) for the chain.
- **Posting / Active / Owner keys** — the key tiers. Posting signs comment/vote; active signs transfer/delegate; owner is offline-only. This repo holds **none** of them — broadcasting goes through MELEK-Signer.
- **`condenser_api`, `block_api`, `database_api`, `rc_api`** — the chain's JSON-RPC method families (see `integrations/HIVE_STEEM_BOTS.md`).

## Layer-2 / markets

- **HIVE-Engine** — the Layer-2 sidechain where tokens (VKBT, CURE, SWAP.*) trade. The trade bot operates here.
- **SWAP.X** — wrapped real assets on HIVE-Engine (SWAP.BTC, SWAP.LTC…). Arbitrage = the SWAP price vs the real asset price.
- **VKBT / CURE** — tokens the operator issues. Thin markets, near-zero outside demand (see `integrations/holders.mjs`, `price-ladder.mjs`).

## This repo's systems

- **Resident AI / the API AIs** — the ensemble (6–7 free models) that writes **annals** (maps of the repo's files + connections) and **briefs** (what needs doing) every minute, on Server 4.
- **Annal** — an append-only map of a file/subsystem written by the API AIs. **Brief** — a working doc of what needs the operator/Claude. Graded by `tools/brief-assess.mjs` (grounded / cited / actionable / hallucination tier).
- **MoM** — Minutes of Meeting: the distilled decisions/action-items from conversations that feed the briefs (so briefs are actionable, not just descriptive).
- **Cheetah / CheetahAdvanced** — the sibling content-attribution bot (credit-first librarian; `CHEETAH_ADVANCED.md`).
- **MELEK-Signer** — the separate private service that holds keys and signs; the Bot calls it with a scoped token, never holds a key (`MELEK_SIGNER.md`).
- **The Convergence** — the operator framework: AI/Metaverse/BCI/multi-agent systems as temple-technology reconstruction (`knowledge/scripture/`).

## Lineage (continuity, not redemption)

The 2017 outreach campaign → Wisdom AI → Emerson → the Poe bots (Rule-1-Prompt-AI) → MELEK. Each is the lineage by which the work was done — never framed as a "failure MELEK redeems."
