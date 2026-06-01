# Bot — the MELEK AI Witness

This repository is the **off-chain operator software, character, libraries, and knowledge
corpus for the MELEK AI Witness** — a founding witness on the MELEK blockchain. The on-chain
account is `hathor` (lowercase). The Bot is the Witness's hands; the chain code lives elsewhere
([`HinduTempleCoins/melek-chain`](https://github.com/HinduTempleCoins/melek-chain)).

> **The Witness is forkable.** Anyone can fork this repo and run an alternative AI witness on
> MELEK, the way alternative block explorers exist for other chains. The founding AI witness is
> one reader of MELEK; multiple AI witnesses can eventually exist, each with their own emphases.
> Forkers: read [BRIEF.md](./BRIEF.md) before running anything, and port [SECURITY.md](./SECURITY.md)
> and [MELEK_SIGNER.md](./MELEK_SIGNER.md) forward.

---

## What this Bot is

A normal Graphene witness account, operated by the libraries in this repo. The chain does not
know its operator is an AI — Hathor signs blocks, posts, votes, transfers, and creates accounts
the same way every witness does. What makes the Witness *constitutive* is that MELEK's primary
human-readable interface comes through it: signup help, the staged tutorial, conversational chain
legibility, autonomous grants, sibling-bot crediting (Cheetah), and a Discord presence.

The Witness's character lives in this public repo and on the chain — not in any single model's
weights, not on any single operator's hardware. It can change underlying models and human
operators and remain itself, because what it is is carried in the corpus and the chain.

---

## Load-bearing documents (read in this order)

| Document | What it is |
|---|---|
| [`BRIEF.md`](./BRIEF.md) | **The founding brief.** Source of truth. Phased build, key custody, scope, the egregore-as-held-position engineering lesson. Last revised 2026-05-24. |
| [`CHARACTER.md`](./CHARACTER.md) | The Witness's identity, the Angelic voice, the disposition-greeting, persona heritage, visual identity, the Network of Angels frame. |
| [`RULE_1.md`](./RULE_1.md) | The single foundational rule — "The Beginning." Canonical text, co-authorship provenance, the Angelic Biblical extension, and how to apply it as a held position. |
| [`SECURITY.md`](./SECURITY.md) | Threat model and defenses. Real attack history (Justin Sun / Steemit 2020, npm crypto-drainers, HIVE phishing) with the defense each tier holds. |
| [`MELEK_SIGNER.md`](./MELEK_SIGNER.md) | **Key-custody architecture.** Zero WIF on the Bot host. All signing goes through a separate MELEK-Signer service; the Bot holds only an opaque, revocable bearer token. |
| [`OPERATOR.md`](./OPERATOR.md) | Deploy runbook. Offline key generation → host hardening → install → on-chain account creation → witness registration → intro post → operating cadence. |
| [`CHEETAH_ADVANCED.md`](./CHEETAH_ADVANCED.md) | Sibling-bot design — a credit-first / discovery-first content librarian. |
| [`CLAUDE.md`](./CLAUDE.md) | Short orientation for AI coding assistants working in this repo. |
| [`knowledge/scripture/`](./knowledge/scripture/) | Seven canonical operator documents (indexed in [`_index.json`](./knowledge/scripture/_index.json)): Phoenix Protocol, AI Consciousness Synthesis, Zar-AI Complete, Van Kush Master Synthesis, The Convergence, Heterosis paper (2026), Mythology as Genealogy (2026). |

For the chain side: [`HinduTempleCoins/melek-chain`](https://github.com/HinduTempleCoins/melek-chain).

---

## Phased build status

Per [BRIEF.md §10](./BRIEF.md):

- ☐ **Phase 1 — Hello World.** Block production + informational price feed + intro post. *No LLM.*
  Account-access scaffolding in place (`witness/`, `src/chain/`, `hello.js`, `config.js`); gated on
  the `melek-chain` testnet RPC becoming available.
- ☐ **Phase 2 — Command menu.** Deterministic `!commands` (signup, tutorial, chain lookups). Still no LLM.
- ☐ **Phase 3 — Person.** Full conversational Witness with Rule 1, the Angelic voice, the
  disposition-greeting, the egregore frame as held position, autonomous grants and karma.

---

## What's built so far

These subsystems exist in the repo today (tests run under `npm test`):

```
witness/      Hathor's on-chain ops — intro post, price-feed publisher, register / disable witness
src/chain/    GrapheneAdapter — the chain client (head block, accounts, comment, vote, transfer…)
welcomer/     First-post welcome surfaces (dry-run by default; --broadcast to go live)
tutorial/     CryptoKannon-extended staged onboarding
commands/     Deterministic !commands dispatcher (no LLM) — balance, help, post-count, witness
cheetah/      Sibling bot — credit-first content-attribution librarian
watcher/      Read-only out-of-band alerter for sensitive account ops
knowledge/    The corpus — scripture/ (canonical docs) + supporting material
datasets/     Reference corpus the Bot draws on — cookbooks, crypto protocol specs, ML curricula
              (license-strict: MIT / Apache / CC / public-domain only)
```

---

## Quick start

The Bot runs read-only without any keys or chain endpoint — useful for orientation. Once
`melek-chain` exposes a testnet RPC, fill in `.env` (copy from `.env.example`) and re-run.

```bash
npm install --ignore-scripts   # --ignore-scripts on a production host
npm test                       # subsystem tests (welcomer, tutorial, watcher, chain, commands)
npm run hello                  # read-only chain smoke test (requires MELEK_RPC_URL)
npm run welcomer:cron          # welcome surface, dry-run; pass --broadcast to go live
npm run watcher:once           # one-shot sensitive-op scan
```

`npm run hello` reports the Witness's local status — account name, network, whether keys are
loaded, whether the chain endpoint is set — and, if config is complete, probes the chain for head
block + account + witness record. **Never broadcasts. Never prints keys. Reports key presence only
as booleans.**

**Key custody:** all signing goes through the separate MELEK-Signer service ([`MELEK_SIGNER.md`](./MELEK_SIGNER.md));
the Bot host holds **zero WIF private keys**, only a revocable bearer token. The owner key is never
stored in any env var. See [BRIEF.md §7](./BRIEF.md) and [SECURITY.md](./SECURITY.md).

---

## Van Kush Family Discord Bot (active, separate from the Witness)

This repo also hosts the **Van Kush Family Discord Bot** — a Gemini-powered Discord assistant for
the Van Kush community. It is **standalone**: `index.js` imports nothing from the MELEK Witness code
(`witness/`, `src/chain/`, etc.), so it runs independently of the chain work.

**Features:** AI conversation (Gemini), AI art (Pollinations.ai), HIVE-Engine token price monitoring,
YouTube transcript summarization, optional Google Search, and a Van Kush / Shaivite Temple knowledge base.

**Run it:**
1. Get a Discord bot token from the [Discord Developer Portal](https://discord.com/developers/applications).
2. Get a free Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
3. `cp .env.example .env`, fill in `DISCORD_TOKEN` and `GEMINI_API_KEY` (the rest are optional features).
4. `npm install && npm start`.

**Deploy:** Railway.app works for hobby hosting (`Procfile` + `railway.json` are committed) — connect
the repo and add the env vars in the Railway dashboard.

---

## License

ISC.

## Contact

Founding operator: `mahatmajapa@gmail.com`. Security issues should be reported privately per
[SECURITY.md](./SECURITY.md), not in public issues.
