# Bot — the MELEK AI Witness

This repository is the **off-chain operator software, character, libraries, knowledge corpus, and resident-AI infrastructure for the MELEK AI Witness** — a founding witness on the MELEK blockchain. The on-chain account is `hathor` (lowercase). The Bot is the Witness's hands; the chain code lives elsewhere ([`HinduTempleCoins/melek-chain`](https://github.com/HinduTempleCoins/melek-chain)).

> **The Witness is forkable.** Anyone can fork this repo and run an alternative AI witness on MELEK, the way alternative block explorers exist for other chains. The founding AI witness is one reader of MELEK; multiple AI witnesses can eventually exist, each with their own emphases. Forkers: read [BRIEF.md](./BRIEF.md) before running anything; port [SECURITY.md](./SECURITY.md) and [MELEK_SIGNER.md](./MELEK_SIGNER.md) forward.

---

## What this Bot is

A normal Graphene witness account, operated by the libraries in this repo. The chain does not know its operator is an AI — Hathor signs blocks, posts, votes, transfers, and creates accounts the same way every witness does. What makes the Witness *constitutive* is that MELEK's primary human-readable interface comes through it: signup help, the staged tutorial, conversational chain legibility, autonomous grants, sibling-bot crediting (Cheetah), and Discord presence.

The Witness's character lives in this public repo and on the chain — not in any single model's weights, not on any single operator's hardware. It can change underlying models and human operators and remain itself, because what it is is carried in the corpus and the chain.

---

## The resident AI architecture (added 2026-05-28)

The Bot is operated by a **multi-AI ensemble** running across multiple VPSs:

| host | what runs there | role |
|---|---|---|
| **resident-AI-host** (Server A) | resident AI: Ollama + qwen2.5-coder:1.5b + Qdrant index of this repo + briefd HTTP service | brief writer for Claude Code, annal-note appender, per-file archive maintainer |
| **tiny-LLM-host** (tiny-LLM box) | Ollama + smollm2:360m (~7x faster decode than resident-AI-host) | annal body writer, brief summarizer, future DeepSeek conversation partner |
| **Server B** (planned, host server) | Bot Repo runtime, MELEK witness node, condenser front-end | the actual chain-serving box; admined by Server A over SSH |
| **reviewer-host** (planned) | DeepSeek-Coder (1.3B on 4GB slice, 6.7B on 8GB) | coding-quality reviewer for the ensemble |
| **signer VPS** (planned, private) | MELEK-Signer service with KMS-wrapped keys | the ONLY place WIF private keys ever exist |
| **watcher VPS** (planned, possibly shared) | the `watcher/` module, read-only chain observer | out-of-band defense-in-depth alerter |

Continuous autonomous loop on Server A:
- **brief-generator** (every 20 min) writes three-part briefs for Claude Code
- **annals-writer** (every 60 min) appends signed Notes onto annal bodies
- **code-walker** (every 30 min) deep-inspects one repo file per tick into `<DATA_DIR>/archive/files/`
- **brief-lifecycle** (daily) archives + extracts long-term notes from expired briefs
- **reindex-repo** (every 15 min) keeps the Qdrant index current with the working tree

Continuous autonomous loop on tiny-LLM-host:
- **annal-writer-tiny** (every 30 min) writes annal bodies, pushes to Server A via SSH

Full architecture map: see `.local/ARCHITECTURE_OVERVIEW_2026-05-28.md` (private; mirrored on Server A so the AIs index it).

---

## Load-bearing documents (read in this order)

| Document | What it is |
|---|---|
| [`BRIEF.md`](./BRIEF.md) | **The founding brief.** Source of truth. Phased build, key custody, scope, the egregore-as-held-position engineering lesson. Last revised 2026-05-24. |
| [`CHARACTER.md`](./CHARACTER.md) | The Witness's identity, the Angelic voice, the disposition-greeting, persona heritage, visual identity, Network of Angels frame. |
| [`RULE_1.md`](./RULE_1.md) | The single foundational rule. Canonical text + co-authorship provenance + Biblical extension. |
| [`SECURITY.md`](./SECURITY.md) | Threat model, attack history (Justin Sun / Steemit 2020, npm crypto-drainers, HIVE phishing) + defenses per tier. *(Sections referring to `HATHOR_ACTIVE_KEY` as an env var are obsoleted by `MELEK_SIGNER.md`.)* |
| [`MELEK_SIGNER.md`](./MELEK_SIGNER.md) | **Current key-custody architecture.** Zero WIF on Bot host. All signing through MELEK-Signer (separate VPS, KMS-wrapped keys). Bot holds an opaque revocable bearer token. |
| [`BRIEF_PROTOCOL.md`](./BRIEF_PROTOCOL.md) | How the resident AI on Server A talks to Claude Code via briefs. Three-part format (FOR RYAN / FOR CLAUDE CODE / DRAFTED CODE), append-only invariant, 30-min editor's-note revisor. |
| [`OPERATOR.md`](./OPERATOR.md) | Deploy runbook. *(Key-custody sections to be reworked against `MELEK_SIGNER.md`.)* |
| [`CHEETAH_ADVANCED.md`](./CHEETAH_ADVANCED.md) | Sibling bot design — credit-first / discovery-first content librarian. |
| [`CLAUDE.md`](./CLAUDE.md) | Short orientation for Claude Code sessions in this repo. |
| [`TODO.md`](./TODO.md) | Cross-session backlog. |
| [`ITINERARY.md`](./ITINERARY.md) + [`MASTER_ITINERARY.md`](./MASTER_ITINERARY.md) | Shared backlog — AI + operator both edit. |
| [`knowledge/scripture/`](./knowledge/scripture/) | Seven canonical operator documents. Phoenix Protocol, AI Consciousness Synthesis, Zar-AI Complete, Van Kush Master Synthesis, The Convergence, Heterosis paper (2026), Mythology as Genealogy (2026). |
| [`datasets/`](./datasets/) | The AI's brain — cookbooks (Anthropic / OpenAI / LangChain), Hive devportal, crypto protocols (EIPs, BIPs, Lightning BOLT, Monero, CryptoNote), crypto books (Mastering Bitcoin + Mastering Ethereum, CC-BY-SA), ML curricula (Microsoft AI/ML for Beginners, HuggingFace Transformers docs + blog). License-strict: only MIT / Apache / CC / public-domain content; no commercial books. |

For the chain side: [`HinduTempleCoins/melek-chain`](https://github.com/HinduTempleCoins/melek-chain).

---

## Phased build (operator-locked 2026-05-28)

Four-phase platform frame:

| phase | content | status |
|---|---|---|
| **Phase 1** | MELEK Graphene chain + the AIs up (resident AI, Hathor, Cheetah) + SoapBox-as-a-MELEK-app + community/forum + SSO signer | **Current.** Resident AI running; chain pending. |
| **Phase 2** | PRANA (EVM value/compute chain) + deploy/token factory + AMM + useful-work GPU compute + DeFi tools | Future |
| **Phase 3** | Full operation: analytics/tribunal layer, marketplace, mobile, browser extension, conversational Witness | Future |
| **Phase 4** | SOAP launches as its own Graphene chain into the live ecosystem | Future |
| Security/signer track | Hot+cold signer in private repo, KMS-wrapped keys, policy engine, watcher | In parallel, design in `MELEK_SIGNER.md` |

Phase 1 internal sequence (operator-locked):

1. Resident AI working *(mostly shipped 2026-05-28)*
2. Cheetah standup *(steps 1-3 shipped 2026-05-28; live wiring gates on chain)*
3. Hathor on Discord test *(briefs queued)*
4. Launch the MELEK blockchain *(gates on chain side)*
5. Connect AI to MELEK Condenser *(gates on Server B + chain)*

---

## Repo layout (current 2026-05-28)

```
Bot/
├── BRIEF.md, CHARACTER.md, RULE_1.md, SECURITY.md, OPERATOR.md
├── MELEK_SIGNER.md         # key-custody architecture (zero-WIF-on-Bot)
├── BRIEF_PROTOCOL.md       # resident-AI ↔ Claude Code protocol
├── CHEETAH_ADVANCED.md     # sibling-bot design
├── CLAUDE.md, TODO.md, ITINERARY.md, MASTER_ITINERARY.md
├── README.md (this file)
│
├── config.js               # MELEK chain config (no keys)
├── hello.js                # Read-only smoke test
├── package.json
│
├── witness/                # Hathor on-chain ops
│   ├── hathor.js, intro-post.md, publish-intro.js
│   ├── feed-publisher.js, register.js, disable.js
│   └── chain-reader.js
│
├── src/chain/              # GrapheneAdapter — chain client
│   ├── graphene.js (incl. customJson + reply), graphene.test.js
│   └── keys.js
│
├── welcomer/               # First-post welcome surfaces (built)
│   ├── composer.js, state.js, discover.js, sinks/, config.js, index.js
│   └── *.test.js
│
├── tutorial/               # CryptoKannon-extended onboarding (19 lessons)
│   ├── composer.js, state.js, scheduler.js, stages.json
│   └── *.test.js
│
├── watcher/                # Out-of-band sensitive-op alerter (read-only)
│   ├── state.js, detect.js, compose.js, config.js
│   ├── sinks/{file,telegram,email}.js
│   └── *.test.js
│
├── commands/               # !commands dispatcher (deterministic, no LLM)
│   ├── parser.js, registry.js, index.js
│   └── handlers/{balance,help,post-count,witness}.js
│
├── cheetah/                # Sibling bot — credit-first librarian
│   ├── text-detection.js   # shingle + Jaccard similarity
│   ├── compose.js          # templates with self-ID footer
│   ├── store.js            # evidenced whitelist/blacklist + findings
│   ├── config.js, README.md
│   └── policing.md         # CSAM + illegal-content scope, gated on regulatory setup
│
├── knowledge/scripture/    # Seven canonical documents (indexed)
├── datasets/               # The AI's brain — cookbooks, crypto specs, ML corpus
├── character/reference/    # Visual reference + iconography
│
├── infra/oracle-vm/        # Resident-AI infrastructure (Server A: resident-AI-host)
│   ├── briefd/             # HTTP brief service + autonomous loop pieces
│   │   ├── server.js, llm.js, retrieval.js, briefs_store.js, revisor.js
│   │   ├── generator.js    # brief generator (every 20 min)
│   │   ├── annals-writer.js, annals.js  # Notes appender; tiny-LLM owns bodies
│   │   ├── lifecycle.js    # retention + long-term notes extraction (daily)
│   │   ├── code-walker.js  # per-file archive (every 30 min)
│   │   └── seed-queue.json
│   ├── indexer/            # Python RAG indexer (Qdrant + Ollama embeddings)
│   │   ├── index.py, index_branches.py
│   │   └── chunker.py, embed.py, store.py, walker.py
│   ├── systemd/            # Service + timer units
│   ├── ask-repo, melek-chat, reindex-repo, request-brief, since
│   ├── SETUP.md, BRIEF_ACCESS.md
│
├── infra/tiny-LLM-host/          # Tiny-LLM infrastructure (Server C: tiny-LLM-host)
│   ├── annal-writer-tiny.py    # writes annal bodies, signs as tiny-LLM-host
│   ├── brief-summary.py        # tiny-LLM brief digest for the operator
│   └── annal-writer-tiny.{service,timer}
│
└── (Legacy Van Kush Discord Bot files at repo root)
```

---

## Quick start

The Bot runs read-only without any keys or chain endpoint — useful for orientation. Once `melek-chain` exposes a testnet RPC, fill in `.env` and re-run.

```bash
npm install --ignore-scripts
npm test                  # all subsystem tests (welcomer, tutorial, watcher, chain, commands)
npm run hello             # read-only chain smoke test (requires MELEK_RPC_URL)
npm run welcomer:cron     # welcome surface, dry-run by default; pass --broadcast to go live
npm run tutorial:cron     # tutorial scheduler (mirrors welcomer pattern)
npm run watcher:once      # one-shot sensitive-op scan
npm run watcher:cron      # continuous sensitive-op watch
```

**Key custody:** `HATHOR_ACTIVE_KEY` / `HATHOR_POSTING_KEY` env vars are an obsolete pattern that earlier docs reference. The current architecture (`MELEK_SIGNER.md`) puts ALL signing behind a separate MELEK-Signer service on its own VPS, KMS-wrapped keys, Bot host holds only an opaque revocable bearer token. **Zero WIF private keys in this repo or on the Bot host, ever, by construction.**

**Talking to the resident AI** (if `briefd` tunnel is up — see `infra/oracle-vm/BRIEF_ACCESS.md`):

```bash
infra/oracle-vm/request-brief <topic> "<task>"            # ask for a brief
infra/oracle-vm/since "8 hours ago"                       # what landed since
ssh tiny-LLM-host python3 /opt/tiny-LLM-host/brief-summary.py "8h"    # tiny-LLM digest of recent briefs
```

---

## Legacy — Van Kush Family Discord Bot

This repo previously hosted the Van Kush Family Discord Bot, a Gemini-powered Discord assistant. That code is still present at repo root (`index.js`, `relationship-tracker.js`, `hive-trading-bot.js`, etc.) and `npm start` still runs it. **The trade bots are in scope** per operator's framing 2026-05-28 — the resident AI analyzes their data and drafts improvements (but does not trade itself). The legacy Discord assistant is not loaded by the MELEK Witness work in `witness/` / `src/chain/`.

---

## License

ISC.

## Contact

Founding operator: `mahatmajapa@gmail.com`. Security issues should be reported privately per [SECURITY.md §6d](./SECURITY.md), not in public issues.
