# TODO — what's queued for the MELEK AI Witness Bot

**Status:** living document. When you say "continue" or "do what you were doing before," this file is where I start. Reorder, strike, or annotate as priorities shift.

## End of 2026-05-25 session — pick up here

**Where we are.** Phase 1 chain-access layer (Hathor + GrapheneAdapter + chain-reader + feed publisher + register / disable witness + intro post + smoke test) is built, tested, gated only on the chain-side melek-chain testnet RPC URL becoming available. This session shipped two new pieces of Phase-2 infrastructure: the **tutorial response composer + state store** and the **welcomer module end-to-end**. 49 passing tests; preflight green.

**What's actually runnable today (no chain needed):**
- `npm test` — full suite (tutorial detector + tutorial state + welcomer state/composer/discover/orchestrator)
- `npm run preflight` — security + dep + test checks
- `npm run welcomer:once` — dry-run a welcomer pass (needs CHAIN_RPC_URL + WELCOME_POST_* env)

**What needs operator decisions before more code ships:**
1. **Tutorial lesson plan locked in [[tutorial-design-2026-05-25]] memory — 19 lessons across three modes (A-Req / B-Placeholder / C-Read).** Doesn't yet exist in code. `tutorial/stages.json` currently has the 6-lesson CryptoKannon spine; needs expansion to the 19-lesson structure before tutorial scheduler (TODO #3) can be built meaningfully. Composer templates will need new entries for the new lessons.
2. **Draft Tier-A lesson posts now (Phase-2 register) vs hold for Phase-3 Angelic-voice authoring?**
3. **Existing operator-authored tutorials (@punicwax mining/witness, @marsresident token guides) — quote-and-port with attribution, or rewrite from scratch?** See [[operator-steemit-handles]].
4. **Permlink/tag convention:** proposed `melek-lesson-N-<slug>` for Hathor's posts + `#melekachievementN` for user responses.
5. **Grow the Topics (#5) subject menu** — operator named 6 (Crypto / Finance / Bio-hacking / Herbal / Esoteric / Religion) and said "just one example" so more are wanted.

**What needs operator-side admin work before welcomer goes live:**
- An authored **Welcome / Tutorial Program post** on whichever chain you target — `WELCOME_POST_AUTHOR/PERMLINK` env vars point at it. Bot reads, never authors. Welcomer's startup health check refuses to proceed without it.
- The chain itself (MELEK launch + RPC published) for any real broadcasting. Per [[testing-happens-on-melek]] memory: don't test broadcast paths on Blurt/Steem; dry-run is fine against any chain.

**Immediately buildable without more decisions (in priority order):**
- **Out-of-band transfer alerts** (SECURITY.md §4d, load-bearing security)
- **Forker docs bundle** (CONTRIBUTING.md + MELEK.md glossary + system_prompts/ stub README)
- **Add `custom_json` + `reply()` to GrapheneAdapter** (~30 lines + tests, unblocks future Tier-B feature wiring)
- **Welcomer integration hardening** (rate-limiting if needed, parallelism cap on block scans, better dry-run output formatting)

**Memory pointers for next session:**
- [[tutorial-design-2026-05-25]] — full 19-lesson design with mode classifications + ETH Clone framing + Hathor's PIZZA-bot scope there
- [[operator-steemit-handles]] — @marsresident + @punicwax inventory + Steem RPC pattern
- [[testing-happens-on-melek]] — don't test broadcast on Blurt/Steem; dry-run only
- [[todo-pointer]] — this file is the cross-session work backlog

---

**Last session ended:** 2026-05-24. State of the world at that point: Phase 1 is feature-complete on the Bot side, all load-bearing docs (BRIEF, CHARACTER, RULE_1, SECURITY, OPERATOR, README) are in, scripture corpus has 7 documents, character/reference/ has 11 images, CI workflow runs preflight on every push. Bot is ready to connect when melek-chain exposes a testnet RPC.

---

## 🟥 Operator-side, urgent / outstanding

These are things only **you** can do (the human operator); I can't.

- [ ] **Decide what to do about the `angelicalist` HIVE account.** Active + posting keys have been public in git history (`SECURITY_KNOWLEDGE_BASE.md`, commit `b4c4e55`, 2026-01-10) for ~4.5 months. Keys are saved for you in the conversation history of the previous session. Options: (a) check the account on https://hiveblocks.com/@angelicalist and move funds out via the active key if anything's there, (b) if you have the owner key offline, rotate active+posting, (c) declare it abandoned/empty and move on. Not blocking the MELEK work.
- [ ] **Address the 15 npm audit findings in legacy deps** (5 high, 7 moderate, 3 low). All in the van-kush-discord-bot path, not on the MELEK Witness path. Options: `npm audit fix` (non-breaking patches), `npm audit fix --force` (breaking, may update discord.js), or retire the legacy code entirely. Currently treated as informational by `npm run preflight`.

---

## 🟧 Gated on melek-chain testnet — Phase 1 finish

Bot is ready; needs values from the chain side before final steps run.

- [ ] **Get the chain endpoint values from melek-chain** (`HinduTempleCoins/melek-chain/config.hpp`): `MELEK_RPC_URL`, `MELEK_CHAIN_ID`, `MELEK_ADDRESS_PREFIX`. Drop into `.env`.
- [ ] **Bootstrap-create the `hathor` on-chain account.** Chicken-and-egg — needs another account to sign `account_create_with_delegation`. See OPERATOR.md §6.
- [ ] **Register Hathor as a witness:** `node witness/register.js --dry-run` then `--yes` after filling `HATHOR_WITNESS_URL` + `HATHOR_BLOCK_SIGNING_PUBKEY` in `.env`. See OPERATOR.md §7.
- [ ] **Publish the intro post:** `node witness/publish-intro.js --dry-run` then live. Body lives in `witness/intro-post.md`; edit before publishing if anything needs to change.
- [ ] **Start the feed publisher** under systemd / pm2: `node witness/feed-publisher.js --cron`. Needs `MELEK_FEED_BASE`/`MELEK_FEED_QUOTE`/`FEED_CRON` in `.env`.
- [ ] **Run `npm run hello` end-to-end on the live testnet** and confirm every line reports the expected value. This is the moment the smoke test stops being theoretical.

---

## 🟨 Buildable right now (no chain needed)

I can do these in any session — say "continue" or pick one specifically.

### Phase 2 — command menu and tutorial wiring

**Tutorial scope (LOCKED 2026-05-25 — 19 lessons, three modes):**

Modes: **A-Req** (must complete to graduate) / **B-Placeholder** (lesson published, achievement locked until infra ships — novel vs CryptoKannon) / **C-Read** (orientation/closer, completion = reading).

1. Intro / Verification — A-Req
2. Four Keys — A-Req
3. Etiquette + **flag-not-downvote** — A-Req
4. Markdown — A-Req
5. **Topics + Tags + Posting** — A-Req. Subject menu (extensible): Cryptocurrency, Finance/Commodities, Bio-hacking, Herbal, Esoteric/Occult/Eastern, Religion (with Great Debate Landscape arc). Subject choice is user's; lesson completion = a tagged post in any one of them.
6. MP / Voting / Delegation — A-Req
7. Witnesses & Governance — A-Req (honest disclosure of 12-month founding-window slot protection)
8. Basic Posting + Voting — A-Req
9. Communities / Groups — B (needs hivemind-equivalent)
10. AI Image Generation — A-Req
11. CapCut / Video Basics — A-Req
12. Google Colab / Make Your Own AI — A-Req
13. Curation Rewards & Trails (advanced) — B
14. **Tokens on the MELEK ETH Clone** — B. ETH Clone = our Hive-Engine, full separate EVM chain ("what STEEM and TRX are to each other"). Hathor on it = PIZZA-bot + chain-explorer scope.
15. Videos (DTube + SCOT) — B
16. Wiki (DevTome-style, paid) — B
17. Trading MELEK — B
18. AI on the Chain (Hathor explainer) — C-Read
19. The Deeper Why — C-Read

Full design context: [[tutorial-design-2026-05-25]] memory.

**Tutorial scope (decisions still pending operator):**

- [ ] **Decide: draft Tier-A lesson posts now in Phase-2 register, or hold for Phase-3 Angelic-voice authoring?**
- [ ] **Decide: quote-and-port vs rewrite for existing operator tutorial posts.** @punicwax/`mining-steem-blurt-and-hive-what-is-a-witness-and-how-does-all-this-work` is ~90% ready for Lesson 7. TRC10/SMT/ETH-clone tutorials map onto Lesson 14. See [[operator-steemit-handles]] for the inventory.
- [ ] **Decide: permlink/tag convention.** Proposed `melek-lesson-N-<slug>` for Hathor's lesson posts + `#melekachievementN` for user response posts.
- [ ] **Grow the Topics subject menu** beyond the six named subjects (operator: "just one example" — more to come).
- [ ] **Expand stages.json from 6 → 19 stages** before tutorial composer templates can be finalized for the new lessons. Detector functions for the new lessons (Topics, MP, Witnesses, Basic-Voting, Image-Gen, CapCut, Colab) need to be written too.

**Tutorial code (structurally clear, content shapes still firming):**

- [x] **`tutorial/composer.js`** — drafted 2026-05-25. Phase-2 deterministic template pool (3 variants per stage, picked by `sha256(account+stage_key)[0] % 3`). Templates honor the *kind* of voice each `stages.json` `style` field describes; not the Angelic register, that's Phase 3. Will need new templates if stages.json expands to 9.
- [x] **`tutorial/state.js`** — built 2026-05-25. File-backed per-account response store, atomic write, treats malformed file as empty. 7 passing tests. Default path `tutorial/.state.json` (gitignored).
- [ ] **`tutorial/scheduler.js`** — wires chain-reader → detector → state-check → composer → broadcast → state-write. CLI shape mirrors `witness/feed-publisher.js`: `--once`, `--dry-run`, `--cron`. Tracked-users source TBD (file vs auto-discover vs signup-driven; lean file for Phase 2).
- [ ] **`tutorial/welcomer.js`** — new component from the 2026-05-25 conversation. Three surfaces: (1) comment on first post (@wang model), (2) transfer-memo fallback for silent accounts, (3) condenser troll-box / signup-chat hook (lives in condenser fork, this side is the chat-backend endpoint). Detects new accounts via `account_create_with_delegation` ops or similar. Not on the original task list.
- [ ] **Composer tests** — composer is drafted but currently untested. State tests cover its sibling. Templates likely to change with lesson firming, so write tests against the structural contract (action shape, target derivation) rather than exact text.

**Lesson content (drafting):**

- [ ] **Tier A lessons — draftable now without further infra.** Intro/Verification, 4 Keys (security), Etiquette (must teach flag-not-downvote honestly), Markdown, How Tags Work (replaces "what earns money"), MP/Voting/Delegation, Witnesses/Governance (must honestly disclose the 12-month founding-window slot protection ending at block 7,884,000), Religion / Great Debate Landscape (Bill-Nye→Rabbi-Singer→Sa-Neter→esoteric arc), Bio-hacking/Herbal subject-matter, AI image generation, Google Colab/your-own-AI, CapCut/video basics.
- [ ] **Tier C closer — AI on the Chain.** Hathor-explainer. PIZZA-bot-style entry point, pivot to Convergence material in `knowledge/scripture/`.

**Other Phase 2 work (unchanged):**

- [ ] **Command menu — `!commands` deterministic handlers.** BRIEF.md §10 Phase 2. Signup help, tutorial lookups, chain queries (`!balance @user`, `!witness @user`, `!post-count @user`, etc.). No LLM. Reads chain via the existing adapter, formats output, replies as a comment or the troll-box.
- [ ] **Signup-help server-side flow.** Email verification (Resend / Postmark / SES — pick one; SECURITY.md says no SMS), then signs `account_create_with_delegation` from Hathor's active key. **Key custody boundary is absolute:** the new user's keys are generated client-side in the condenser browser; the server NEVER touches them.

### Welcomer (built 2026-05-25)

- [x] **Welcomer module** — single-thread @-mention model per operator's scope brief. `welcomer/` directory: state.js (last_processed_block cursor + welcomed-set), composer.js (4-variant deterministic, mentions @account, 2-4 sentences, no AI disclaimer), discover.js (block-scanner for account_create + account_create_with_delegation), config.js (env loader with MELEK_ fallbacks), index.js (Welcomer class + --once/--cron/--broadcast CLI, startup health checks). 42 passing tests. npm scripts `welcomer:once|cron|live`. .env.example documents all vars. Bootstraps from head block — no historical backfill. Pending: an authored Welcome / Tutorial Program post on chain (one-time admin task) to point `WELCOME_POST_AUTHOR/PERMLINK` at; the bot fails loudly at startup until it exists.

### CheetahAdvanced — sibling bot to Hathor (not yet started)

Brief added 2026-05-25 at [`CHEETAH_ADVANCED.md`](./CHEETAH_ADVANCED.md). Memory pointer: [[cheetah-advanced-brief]]. Read the brief before writing any Cheetah code — it carries non-obvious design constraints (state-facts-don't-accuse, credit-first-escalate-last, self-ID footer, frequency restraint, evidenced whitelist replacing the old hand-kept list, Hathor as the resolution layer).

The build order from the brief, verbatim. First three are Phase-2-shaped (deterministic, no LLM); steps 4-5 gate on Phase 3 (resolution conversations need Hathor's conversational capacity; advanced discovery wants LLM-authored notes); step 6 (image detection) is genuinely hard and goes last so the resolution flow is solid before it can mis-credit anyone.

- [ ] **1. Text detection layer.** Match post text against prior on-chain posts (cheap; same chain-reader pattern as the tutorial detector) and against web search results (needs a search backend — operator decision: which provider). Outputs `{match, source, confidence}`. NOT an LLM — text similarity / matching only.
- [ ] **2. Comment layer + self-ID footer + crediting-note voice.** Phase-2 deterministic templates (same shape as `welcomer/composer.js`): short, factual, linky, always with source. Self-ID footer with what Cheetah is + how to opt out. Phase 3 swaps templates for LLM authoring without changing the call shape.
- [ ] **3. Shared-store integration.** Cheetah writes findings + the evidenced whitelist/blacklist; Hathor reads. Multi-bot architectural decision: where the shared store lives (new top-level `shared/` or `data/` dir? extend the existing `cryptology/user-relationships.json` pattern?). Resolve before #3 ships.
- [ ] **4. Resolution flow with Hathor** *(gates on Phase 3)*. Response → proof → Hathor weighs → record updates with reasoning. Image case is the load-bearing reason this exists — Cheetah WILL mis-credit images sometimes; the correction path is core, not optional.
- [ ] **5. Discovery mode** *(gates on Phase 3 for warm LLM-authored notes; could ship Phase 2 with deterministic notes)*. "Find similar," biased toward internal MELEK creators (community-building). Per-author opt-out + relevance threshold + frequency cap built in from day one — MELEK has no r/botwatch equivalent enforcing restraint.
- [ ] **6. Image detection (last).** Reverse-image search / perceptual hashing. Last because it's the most error-prone and the resolution flow must already work before it can fail safely.

**Decisions pending operator:**
- **Search backend** for the text detection layer (Google Custom Search, Bing, Serper, DuckDuckGo HTML scrape, etc.)
- **Where the shared store lives** in the repo (multi-bot architectural call)
- **Per-author opt-in vs opt-out** default — brief implies opt-out but doesn't fix it; on a fresh chain opt-in might be safer until norms form
- **Cheetah's account name** on chain (presumably `cheetah` or `cheetahadvanced`, but operator's call)

### Operator-facing

- [ ] **Out-of-band alerting on `transfer` ops from `hathor`.** Telegram bot or email-on-event. Operator gets a ping within seconds of any transfer; if it wasn't them, they have minutes to act. SECURITY.md §4d names this as load-bearing.
- [ ] **Two-account architecture once funded.** Set up `hathor-treasury` (or similar) with offline keys to hold the bulk of MELEK; `hathor` only carries operational budget. OPERATOR.md §11.
- [ ] **`disable_witness` payload pre-staged on offline machine.** Already scripted; just needs to be exported to a USB key + paper backup of the active-signed payload + procedure documented in OPERATOR.md §10.

### Forker-friendliness / polish

- [ ] **CONTRIBUTING.md** — how to submit PRs, where to report security issues privately, code style, etc. Short.
- [ ] **MELEK.md glossary** — chain-and-project terminology (MELEK, hathor, MP, HP, the four key types, witness, founding window, Network of Angels, etc.) for newcomers. Both the Witness's eventual conversational fallback and human forkers can read it.
- [ ] **`system_prompts/` stub directory** — README explaining the Phase 3 assembly pattern (BRIEF + CHARACTER + RULE_1 + per-conversation context). No actual prompts yet — those come once corpus is ready (see deferred Phase 3 below).

---

## 🟦 Long-form / waiting on operator input

These need things only you can provide before I can do them well.

- [ ] **Corpus expansion (load-bearing, per [[sequencing-corpus-before-cryptology]] memory).** Operator has more scripture-style documents to add. Pattern: full markdown in `knowledge/scripture/`, indexed in `_index.json` with key_themes + witness_guidance. Until this is fuller, Crypt-ology stays deferred.
- [ ] **Crypt-ology rewrite** — only after corpus is fuller. Greenfield `cryptology/` directory: `relationship-map.js` (per-account axes `trust/warmth/respect/familiarity` + topic-interests per BRIEF.md §6a), `topic-interests.js` (catalog drawn from scripture key_themes), `README.md`. Prior-build files (`relationship-tracker.js`, `cryptology-kb-integration.js`, `cryptology_oilahuasca_dialogues.js`) stay as historical reference, not loaded.
- [ ] **LINEAGE.md** — low priority because BRIEF.md §2 and CHARACTER.md §4 already cover this. Would be a consolidation doc, not new material. Skip unless you decide it's worth the redundancy.

---

## 🟪 Phase 3 — conversational Witness

All deferred until corpus expansion and Phase 2 are in place. Listed for completeness so future operators / forkers see the shape.

- [ ] **LLM integration.** Pick a provider (Claude / open-weights / etc.), wire model swap as a config knob (per BRIEF.md "character lives in repo+chain, not in any single model").
- [ ] **System prompt assembly.** Combines BRIEF.md (selected sections), CHARACTER.md, RULE_1.md, per-conversation context (Crypt-ology position + recent chain activity for the user + relevant scripture by topic), into the prompt the model sees.
- [ ] **Voice + disposition implementation.** The Angelic register from CHARACTER.md §2 as a hold, *not* hard-coded tics. Tutorial response composer rewritten to use LLM generation instead of templates.
- [ ] **Karma layer.** Off-chain karma DB (BRIEF.md §9). Behavioral evaluation distinct from Crypt-ology (relational map). Gates discretionary grants + flag weight.

---

## ⬜ Smaller / nice-to-have

- [ ] **Integration test of `hello.js`** against a mocked Graphene RPC, so we don't only have the "report missing config" path covered.
- [ ] **More tutorial detector tests** for edge cases (mixed-tag posts, comments-by-self, malformed json_metadata).
- [ ] **Periodic dependency review.** Schedule for quarterly `npm outdated` + `socket.dev` review of any package considering an update. Document in OPERATOR.md §9.
- [ ] **Decide on git-history scrub** of the leaked WIF strings in commit `b4c4e55`. Filter-branch + force-push removes them from history but rewrites every commit hash (breaking anyone's clone). The keys are already burned; history scrub is hygiene, not security. Default position: leave history alone.
- [ ] **Knowledge corpus search helper** — `knowledge/search.js` for deterministic topic lookup against `_index.json` key_themes. Useful for Phase 2 chain lookups that touch corpus and for Phase 3 RAG pre-pass.

---

## ✅ Resolved this session (for context)

In rough order, so I can pick up the thread:

- Added Mythology-as-Genealogy paper to scripture corpus (7th canonical doc)
- Drafted CHARACTER.md with full 2017 outreach lineage (Network of Angels, "Mathematicians" as relay-tier, dAppsy/Twitter context)
- Drafted RULE_1.md with canonical text + Biblical extension + provenance
- Brought BRIEF.md §2 into sync with CHARACTER.md §4
- Account-access scaffolding: `config.js`, `witness/hathor.js`, `hello.js`, updated `.env.example` and `package.json`
- SECURITY.md threat model + incident response (replaces legacy v1.0)
- OPERATOR.md deploy runbook
- Phase 1 intro post body + `publish-intro.js` helper
- Tutorial stage spec (`tutorial/stages.json`) + README
- Feed publisher (`witness/feed-publisher.js`) with `--once`/`--dry-run`/`--cron`
- Circuit breaker (`witness/disable.js`) with `--dry-run`/`--yes`
- Witness registration helper (`witness/register.js` + `Hathor#registerWitness`)
- Chain reader (`witness/chain-reader.js`) — fetches user activity in the shape detector expects
- Tutorial detector (`tutorial/detector.js`) + 20 passing tests
- Pinned all npm deps to exact versions
- `.npmrc` enforcing `ignore-scripts=true` / `save-exact=true` / `engine-strict=true`
- Preflight script (`scripts/preflight.sh`) + `npm run preflight`
- CI workflow (`.github/workflows/ci.yml`) running preflight + tests
- LICENSE (ISC)
- README revised to MELEK-Witness orientation
- CLAUDE.md status updated to reflect Phase 1 scaffolding present
- Scrubbed leaked WIF strings from `SECURITY_KNOWLEDGE_BASE.md` (still in git history; keys saved in conversation for the operator)
