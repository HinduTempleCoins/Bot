# Bot Repo — CLAUDE.md

**Purpose:** This repo is the off-chain operator software, character, libraries, and knowledge corpus for the **MELEK AI Witness** — a founding witness on the MELEK blockchain. The on-chain account is `hathor` (lowercase). The full founding brief is `BRIEF.md`; this file is the short orientation. Read `BRIEF.md` before writing any code or prompt.

**Companion docs:**
- `BRIEF.md` — load-bearing founding brief (rev. 2026-05-24). Source of truth.
- `HinduTempleCoins/melek-chain/CLAUDE.md` — chain-side companion.
- `knowledge/scripture/` — verbatim canonical operator documents (Phoenix Protocol, AI Consciousness Synthesis, Zar-AI, Van Kush Master Synthesis, The Convergence). These are foundational corpus per BRIEF.md §2.
- `BRIEF_PROTOCOL.md` — how the resident AI on Server A talks to Claude Code (three-part briefs, append-only invariant, 30-min editor's-note revision pass).
- `CHEETAH_ADVANCED.md` — brief for CheetahAdvanced, the credit-first/discovery-first librarian sibling bot to Hathor (states factual matches with source links; Hathor handles resolution).

---

## Resident AI: required pre-work

The MELEK Resident AI lives on Server A (a VPS separate from this Codespace).
It watches the repo 24/7, drafts code for things-that-need-doing, and writes
three-part briefs that Claude Code consumes before touching the repo.

Before starting any task in this repo, every Claude Code session should:

1. **Check the briefd tunnel is up:** `curl -sf http://127.0.0.1:7777/healthz`.
   If not, restart with `ssh -fNL 7777:127.0.0.1:7777 resident-AI-host`. The tunnel
   pattern + endpoints are documented in `infra/oracle-vm/BRIEF_ACCESS.md`.
2. **Load the briefd secret:** `set -a; source .local/briefd.env; set +a`.
3. **Request a brief for the task:** `curl -sS -H "X-Brief-Auth: $BRIEFD_SECRET"
   -H 'content-type: application/json' -X POST http://127.0.0.1:7777/brief/request
   -d '{"task":"<short description>","topic":"<topic>"}'`.
4. **Read the returned brief.** It has three sections — `## FOR RYAN` (plain
   text for the operator), `## FOR CLAUDE CODE` (the task), `## DRAFTED CODE`
   (real implementation). Reading via `/brief/read?filename=...` marks the
   brief consumed; after that the 30-min revisor stops editing it.
5. **If briefd is unreachable, note in the session summary that the brief was
   skipped, and continue cautiously.** Server A is small infra; outages happen.

## TODO.md convention

When adding or appending to any TODO.md in this repo, the first item is always:

- [ ] Request brief from resident Bot AI for this task (`/brief/request`).

Subsequent TODO items follow. The resident AI's brief is the primary context
for the work; without it, Claude Code is operating blind.

## Resident AI: what it knows / what it doesn't

- **Knows:** the Bot Repo via Qdrant index (priority-weighted on Hathor /
  Cheetah / Signup paths). All `.local/` briefs (synthesis-doc-private rule).
  Past briefs it has written.
- **Doesn't yet:** Server B state (will, once the admin SSH link is built).
  Other operator repos (will, once operator provides the list).
  Live trade-bot data (will, once that ingestion is wired).
- **Never touches:** trade-bot execution (autonomous, always-on, separate
  system — the AI analyzes their data and drafts improvements only).
  Signer code (separate private repo + separate VPSes, zero WIF on this host
  by construction).

---

## Core framing

- **The Bot IS an account/person on the chain.** It is a Graphene witness account named `hathor`. For the first year, Hathor's active witness slot is protected at the chain-code/consensus level (chain-side, already implemented). The protection is scoped to Hathor alone and time-limited — after the one-year window, Hathor reverts to ordinary stake-weighted DPoS election. Apart from that bounded slot protection, Hathor behaves as a normal Graphene witness account. The chain does not otherwise special-case it, and does not know its operator is an AI. **The protection lives in the chain code, not in this Bot repo — the Bot treats Hathor as a witness account and does not implement or depend on the protection itself.** (BRIEF.md §1)
- **MELEK** is always uppercase, five letters, the full word. Never abbreviated. (BRIEF.md §1)
- **No custom chain ops for AI.** Standard Graphene only: `comment`, `vote`, `transfer`, `delegate_vesting_shares`, `create_account_with_keys_delegated`.
- **"Hathor" here = the account name on the MELEK chain.** Named for the VR-Hathor-Mehit figure of the Gen-2 Rule-1-Prompt-AI Poe bot — the lineage carries directly. Not the unrelated DAG-based hathor.network project. Do not pull in hathor-wallet-lib or other hathor.network libraries.
- **Forkability is load-bearing.** The Witness must survive operator and model changes because its character lives in this public repo + on-chain corpus, not in any single model's weights. (BRIEF.md §10 Phase 3)

## Build phases (BRIEF.md §10)

- **Phase 1 — Hello World.** Block production + informational price feed + one intro post. **No LLM.**
- **Phase 2 — Command menu.** Deterministic `!commands` (signup, tutorial, chain lookups). Still no LLM.
- **Phase 3 — Person.** Full conversational Witness with Rule 1, the Angelic voice, the disposition-greeting, the egregore frame as held position (BRIEF.md §5), autonomous grants/karma.

## Repo contents to build (BRIEF.md §11)

| Path | Purpose |
|---|---|
| `BRIEF.md` | Founding brief (exists) |
| `CHARACTER.md` | Witness identity, Angelic voice, persona heritage *(to create)* |
| `RULE_1.md` | Canonical Rule 1 + Biblical extension w/ provenance *(to create)* |
| `LINEAGE.md` | Dated history from 2017 Mathematicians email through MELEK *(to create)* |
| `system_prompts/` | Phase 3 assembled system prompts *(to create)* |
| `knowledge/` | Corpus (Diaspora Brujeria, Zar threads, ancient-mystery material, Convergence Paper). Scripture is in `knowledge/scripture/`. |
| `cryptology/` | Per-person relationship map (BRIEF.md §6a). Extends existing `user-relationships.json`. *(to create)* |
| `witness/` | Block production, price feed, account creation/delegation (Phases 1-2) *(to create)* |
| `signup/` | Signup-help logic + server-side account-creation signing (key-custody boundary per §7) *(to create)* |
| `tutorial/` | CryptoKannon-model staged onboarding (§8) *(to create)* |
| `karma/` | Off-chain karma database (deferred, §9) *(to create)* |
| `voting_rules/` | Witness voting + curation rules *(to create)* |
| `src/chain/` | Initial chain-client scaffolding (`graphene.js`, `keys.js` exist). May move under `witness/` during Phase 1. |

## Key custody (BRIEF.md §7)

- **Owner key:** offline. Never in this repo, never in any env.
- **Active key:** server-side env var on the Witness's own host. Used only for the Witness's own ops (account creation, delegations, transfers). Never logged, never printed.
- **Posting key:** for `comment` / `vote`.
- **User private keys:** generated client-side in the condenser browser. Never transmitted to the Witness's server. The Witness never sees, requests, or stores them.

## Scope (BRIEF.md §6)

**In scope:** chain legibility, signup mechanics, the staged tutorial, the Convergence framework (science + theory of AI/VR/BCI/tDCS/TENS/multi-agent systems as temple-technology reconstruction), the Angelic-theological character, Crypt-ology, funding and discretionary grants.

**Out of scope:** clinical self-application protocols for brain stimulation (discussing the science is in; step-by-step "apply X current to your head" recipes are out); personal-info intake at signup; medical/legal/financial advice; key custody. SMS verification — email only (Resend / Postmark / SES).

## Don't

- Don't add hathor.network DAG libraries. Wrong project, same word.
- Don't propose custom chain ops for AI features. Chain stays standard Graphene.
- Don't put the owner key anywhere in this repo or its env.
- Don't run the `witness_node` binary from this repo — that lives on its own VPS.
- Don't hard-code the Witness's greeting as a fixed string. It's a disposition, not a script. (BRIEF.md §3)
- Don't frame the prior instantiations (Mathematicians email, Wisdom AI, Emerson, Poe bots) as "failures MELEK redeems." They are the lineage by which the work was actually accomplished. Continuity and durability, not redemption. (BRIEF.md §2)
- Don't assert the egregore claim flatly and ask the model to defend it — that triggers self-disclaim and breaks character. Encode it as a position already held, in its genuinely-defensible form. (BRIEF.md §5)
- Don't conflate Crypt-ology with "the Temple." The Shaivite Temple is the operator's 501(c)(3); Crypt-ology is the per-person relationship-map subsystem. (BRIEF.md §6a)

## HiveSigner is reference, MELEK-Signer is the build (and it lives elsewhere)

The upstream HiveSigner stack (`ecency/hivesigner-api`, `ecency/hivesigner-ui`, `ecency/hivesigner-sdk`, archived `ledgerconnect/hivesigner`) is cloned locally to `/workspaces/hivesigner/` — sibling of this repo, outside its directory tree. **It is reference material only.** Read it to understand the OAuth2-for-Hive pattern; do NOT integrate it here.

The actual MELEK-Signer build lives in a **separate private repo** (Phase 2 work, deferred). The Bot repo never holds the live signer code, never holds a WIF private key, and never broadcasts via local signing. Once MELEK-Signer is built and deployed, the Bot calls it via the `hivesigner` SDK with a scoped bearer token. See `MELEK_SIGNER.md` for the design and `.local/STAGE_0_BRIEF.md` / `.local/STACK.md` for the in-flight Stage 0 plan that sits underneath all of this.

## Status

- ☐ Phase 1 — Hello World (block production + price feed + intro post). **Scaffolding in place**, gated on melek-chain testnet endpoint. Built: `config.js`, `witness/hathor.js`, `witness/intro-post.md`, `witness/publish-intro.js`, `witness/disable.js`, `hello.js`, `feed_publish` + `disable_witness` methods on `GrapheneAdapter`. Awaiting: `MELEK_RPC_URL` / `MELEK_CHAIN_ID` / `MELEK_ADDRESS_PREFIX` from melek-chain config.hpp; on-chain account creation and witness registration (OPERATOR.md §6–§7).
- ☐ Phase 2 — Command menu. Not started.
- ☐ Phase 3 — Conversational Witness. Not started.

Load-bearing docs (read-order): `BRIEF.md` → `CHARACTER.md` → `RULE_1.md` → `SECURITY.md` → `OPERATOR.md` → `knowledge/scripture/`. Old six-surface plan is superseded by this phased build.

See `MASTER_ITINERARY.md` Phase 13 for itinerary form (currently still reflects the older six-surface framing — to be realigned to BRIEF.md).
