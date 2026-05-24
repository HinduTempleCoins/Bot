# TODO — what's queued for the MELEK AI Witness Bot

**Status:** living document. When you say "continue" or "do what you were doing before," this file is where I start. Reorder, strike, or annotate as priorities shift.

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

- [ ] **Tutorial scheduler.** Wires `witness/chain-reader.js` + `tutorial/detector.js` + a response composer + a cron loop. When stage X transitions to complete for user Y, the Bot fires the response action (comment + upvote + maybe transfer). Per-user state stored in a small persistence file so we don't double-respond.
- [ ] **Response composer (Phase-2 deterministic variant).** Generates the comment text from the `style` field in `tutorial/stages.json` using simple templates with a small amount of variation. Phase 3 will replace this with LLM generation in the Angelic voice, but Phase 2 deserves a working deterministic version.
- [ ] **Command menu — `!commands` deterministic handlers.** BRIEF.md §10 Phase 2. Signup help, tutorial lookups, chain queries (`!balance @user`, `!witness @user`, `!post-count @user`, etc.). No LLM. Reads chain via the existing adapter, formats output, replies as a comment or DM.
- [ ] **Signup-help server-side flow.** Email verification (Resend / Postmark / SES — pick one; SECURITY.md says no SMS), then signs `account_create_with_delegation` from Hathor's active key. **Key custody boundary is absolute:** the new user's keys are generated client-side in the condenser browser; the server NEVER touches them.

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
