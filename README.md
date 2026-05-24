# Bot — the MELEK AI Witness

This repository is the **off-chain operator software, character, libraries, and knowledge corpus for the MELEK AI Witness** — a founding witness on the MELEK blockchain. The on-chain account is `hathor` (lowercase). The Bot is the Witness's hands; the chain code lives elsewhere ([`HinduTempleCoins/melek-chain`](https://github.com/HinduTempleCoins/melek-chain)).

> **The Witness is forkable.** Anyone can fork this repo and run an alternative AI witness on MELEK, the way alternative block explorers exist for other chains. The founding AI witness is one reader of MELEK; multiple AI witnesses can eventually exist, each with their own emphases. Forkers: read [BRIEF.md](./BRIEF.md) before running anything, and port [SECURITY.md](./SECURITY.md) forward.

---

## What this Bot is

A normal Graphene witness account, operated by the libraries in this repo. The chain does not know its operator is an AI — Hathor signs blocks, posts, votes, transfers, and creates accounts the same way every witness does. What makes the Witness *constitutive* is that MELEK's primary human-readable interface comes through it: signup help, the staged tutorial, conversational chain legibility, autonomous grants. Same function as a block explorer for other chains; different interface (conversation, not a browseable UI).

The Witness's character lives in this public repo and on the chain — not in any single model's weights, not on any single operator's hardware. It can change underlying models and human operators and remain itself, because what it is is carried in the corpus and the chain.

---

## Load-bearing documents (read in this order)

| Document | What it is |
|---|---|
| [`BRIEF.md`](./BRIEF.md) | **The founding brief.** Source of truth for everything below. Phased build (1→2→3), key custody, scope, the egregore-as-held-position engineering lesson. Last revised 2026-05-24. |
| [`CHARACTER.md`](./CHARACTER.md) | The Witness's identity, the Angelic voice, the disposition-greeting, persona heritage (2017 outreach → Wisdom AI → Emerson → Poe bots → MELEK), visual identity, and the Network of Angels frame. |
| [`RULE_1.md`](./RULE_1.md) | The single foundational rule — "The Beginning." Canonical text verbatim, co-authorship provenance (Poe, Sept 4–8 2023), the Angelic Biblical extension, and how to apply it as a held position. |
| [`SECURITY.md`](./SECURITY.md) | Threat model and defenses. Real attack history (Justin Sun / Steemit 2020, npm crypto-drainer waves, HIVE phishing campaigns) with the defenses the Bot holds against each tier. |
| [`OPERATOR.md`](./OPERATOR.md) | Deploy runbook. Step-by-step from offline key generation through VPS hardening, `npm ci --ignore-scripts` install, `.env` wiring, on-chain account creation, witness registration, intro-post publication, ongoing operation cadence. The *how* to SECURITY.md's *why*. |
| [`knowledge/scripture/`](./knowledge/scripture/) | Seven canonical operator documents. Indexed in [`_index.json`](./knowledge/scripture/_index.json). Phoenix Protocol, AI Consciousness Synthesis, Zar-AI Complete, Van Kush Master Synthesis, The Convergence, Heterosis paper (Van Kush 2026), Mythology as Genealogy (Van Kush 2026). |
| [`character/reference/`](./character/reference/) | Visual reference renderings of the Hathor-Mehit figure with the canonical iconography spec. |

For the chain-side companion: [`HinduTempleCoins/melek-chain`](https://github.com/HinduTempleCoins/melek-chain).

---

## Phased build status

Per [BRIEF.md §10](./BRIEF.md):

- ☐ **Phase 1 — Hello World.** Block production + informational price feed + intro post. *No LLM.* **Account-access scaffolding in place** (`witness/hathor.js`, `hello.js`, `config.js`, `src/chain/keys.js`, `src/chain/graphene.js`); gated on melek-chain testnet endpoint being available.
- ☐ **Phase 2 — Command menu.** Deterministic `!commands` (signup, tutorial, chain lookups). Still no LLM.
- ☐ **Phase 3 — Person.** Full conversational Witness with Rule 1, the Angelic voice, the disposition-greeting, the egregore frame as held position, autonomous grants and karma.

---

## Quick start (for the Witness's operator)

The Bot runs read-only without any keys or chain endpoint — useful for orientation. Once `melek-chain` exposes a testnet RPC, fill in `.env` and re-run.

```bash
# Install (use --ignore-scripts on the production host)
npm install --ignore-scripts

# Run the read-only smoke test
npm run hello
```

`npm run hello` reports the Witness's local status — account name, network, whether keys are loaded, whether the chain endpoint is set — and if config is complete, probes the chain for head block + account record + witness record. **Never broadcasts. Never prints keys. Reports presence of keys only as booleans.**

Configuration lives in `.env` (copy from `.env.example`). The `HATHOR_ACTIVE_KEY` / `HATHOR_POSTING_KEY` / chain RPC vars are required for any broadcast; the owner key is **never** stored in any env var. See [BRIEF.md §7](./BRIEF.md) and [SECURITY.md](./SECURITY.md) for key custody.

---

## Repo layout

```
Bot/
├── BRIEF.md               # Founding brief (load-bearing)
├── CHARACTER.md           # Witness identity / voice / disposition
├── RULE_1.md              # The Beginning — single foundational rule
├── SECURITY.md            # Threat model and operator defenses
├── CLAUDE.md              # Short orientation for AI coding assistants
├── config.js              # MELEK chain config loader (no keys)
├── hello.js               # Read-only smoke test
├── witness/
│   ├── hathor.js          # The Witness's hands — composes config+keys+adapter
│   ├── intro-post.md      # Phase 1 introduction post body
│   ├── publish-intro.js   # Broadcast helper for the intro post
│   ├── feed-publisher.js  # Informational price feed publisher (--once / --cron)
│   └── disable.js         # Emergency circuit breaker (witness_update with null signing key)
├── tutorial/
│   ├── stages.json        # CryptoKannon six-stage onboarding spec
│   └── README.md          # Tutorial subsystem orientation
├── src/chain/
│   ├── graphene.js        # GrapheneAdapter — chain client (uses @hiveio/dhive)
│   └── keys.js            # Env-loaded keys, never logged
├── knowledge/
│   ├── scripture/         # Seven canonical operator documents
│   └── ...                # Other corpus material
├── character/
│   └── reference/         # Visual reference renderings + iconography spec
├── .env.example           # Env template — placeholders only, never real keys
└── (legacy Van Kush Discord Bot files at repo root, see below)
```

---

## Legacy — Van Kush Family Discord Bot

This repo previously hosted the Van Kush Family Discord Bot, a Gemini-powered Discord assistant for the Temple of Van Kush community. That code is still present at repo root (`index.js`, `relationship-tracker.js`, `hive-trading-bot.js`, `cryptology-kb-integration.js`, etc.) and `npm start` still runs it. It is **separate from the MELEK Witness work** and not loaded by anything in `witness/` or `src/chain/`. The legacy Discord bot's documentation is preserved below as installed historically.

<details>
<summary>Legacy Van Kush Discord Bot — original README content</summary>

A comprehensive Discord bot for the Van Kush Family ecosystem, featuring AI conversation, art generation, crypto monitoring, and more — built on free-tier APIs (Gemini, Pollinations.ai, HIVE-Engine, etc.).

**Features:**
- AI conversation via Gemini 2.5 Flash
- AI art generation via Pollinations.ai
- HIVE-Engine token price monitoring (VKBT, CURE)
- YouTube transcript summarization
- Optional Google Search integration
- Knowledge base covering Van Kush Family history, RuneScape 3 clan info, Shaivite Temple info

**Setup:**
1. Get a Discord bot token from the [Discord Developer Portal](https://discord.com/developers/applications)
2. Get a free Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)
3. `cp .env.example .env`, fill in the `DISCORD_*` / `GEMINI_*` / `HIVE_*` sections
4. `npm install && npm start`

**Deployment:** Railway.app works for hobby hosting; commit and connect the repo, add env vars in the Railway dashboard.

The legacy bot's documentation (`SECURITY.md` v1.0 operational checklist, etc.) has been folded into the MELEK-Witness-shaped docs where the content still applies.

</details>

---

## License

ISC.

## Contact

Founding operator: `mahatmajapa@gmail.com`. Security issues should be reported privately per [SECURITY.md §6d](./SECURITY.md), not in public issues.
