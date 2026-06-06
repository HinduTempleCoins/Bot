# TODO — what's queued for the MELEK AI Witness Bot

**Status:** living document. When operator says "continue" or "do what you were doing before," this file is where Claude Code starts. Reorder, strike, or annotate as priorities shift.

> **2026-06-06 audit reconciliation (full-repo MD sweep):** 16 items below were verified DONE
> (a 17th, the watcher commit — also done — is left unticked only because the content hook
> guards its neighborhood; the watcher is committed + deployed, see task #156)
> and checked off with dated evidence — the testnet is LIVE (hathor genesis witness producing,
> intro post + hourly feed on-chain, `npm run hello` green), `!commands` + Cheetah steps 1-6 are
> built with live demo reports on alpha.melek.salon, and the pool + in-browser wallet are live.
> Nothing was removed. Items still open below this line remain accurate. The day-to-day queue now
> lives in the session task list (~300 items); this file is the narrative backlog.

---

## Resident AI autonomous loop shipped mid-session 2026-05-28

After this morning's audit confirming the resident AI had been sitting idle overnight (no autonomous loop, request/response only, `briefd` couldn't even complete a brief because of stacked timeouts), the autonomous infrastructure was shipped this afternoon:

- **Streaming Ollama integration.** `llm.js` now uses `stream: true` + a custom undici dispatcher with `headersTimeout/bodyTimeout` disabled. Previously, undici's default 5-min timeouts were firing during the long prefill phase on the 1-core box (~8K-token context + 1.5B model) before Ollama could emit a single byte, so every brief request died at exactly 5 min. First real brief landed 12:44Z: `2026-05-28T12-44-14Z-hathor.md` on Server A. Compose time on this box is ~10 min.
- **SYSTEM_PROMPT rewritten to insider voice.** The first brief read like a tourist's wiki blurb. The prompt was telling the AI "plain text, no code blocks, terse" + listing "files you do NOT touch." Both were lobotomizing. New prompt: insider voice, scripture corpus + operator's research as context, deployment boundaries explicit but no analysis restrictions.
- **`brief-generator.service` + `brief-generator.timer` (every 20 min).** Autonomous brief writer. Pops from `<DATA_DIR>/queue.json` (FIFO seed queue) → falls through to standing rotation across Hathor / Cheetah / Signup / Infra / general. Seed queue front-loaded with: stand-up-Cheetah brief, README drift detection, Itinerary integration, Hathor-on-Discord test plan, signup-pipeline next-unit.
- **`brief-lifecycle.service` + `brief-lifecycle.timer` (daily).** Briefs are working memory: consumed → archived to `<DATA_DIR>/archive/briefs/<YYYY-MM>/` after 7 days; everything → deleted after 30 days. Before deletion, the AI distills a one-line takeaway into `<DATA_DIR>/notes/<topic>.jsonl` — the long-term-knowledge layer the operator described.
- **`code-walker.service` + `code-walker.timer` (every 30 min).** Per-file archive at `<DATA_DIR>/archive/files/<flat>.json`. Cheap metadata every tick (mtime, size, line count); one file deep-inspected by the LLM per tick for purpose + work_items + finished_items. Round-robin cursor at `<DATA_DIR>/walker-cursor.json`. This is what makes the AI "an expert on everything in the repo."
- **`reindex-repo.timer` was disabled — now enabled.** 15-min cadence pull + reindex. Without this the index would have stayed frozen at last night's one-shot.

## Where we are right now (2026-05-28)

**Architectural refresh, 2026-05-28** (full brief in `.local/STAGE_0_UPDATE_2026-05-28.md`, came out of a Claude Regular session). The original "one Oracle VM for everything" plan didn't fit the resident-AI role. New shape:

- **Server A — Admin / Resident-AI VM.** Where the resident AI lives (Ollama, indexer, Qdrant, `briefd`). Also acts as the AI's SSH-driven admin terminal into Server B. Codespace → Server A → Server B is the chain. **Provider:** operator is trying ServerHost first for this box; Hetzner is the fallback once the manual ID check clears.
- **Server B — Host server.** Runs the Bot Repo runtime, the MELEK chain (witness node), and the condenser. Likely a bigger box than Server A.
- **Signer / Watcher VPSs** — unchanged; separate private-repo track, no keys on A or B by construction.
- **Oracle Always Free** — likely reassigned to CheetahAdvanced (or part of it), but the ARM image-detection params are an open question for Cheetah step 6.

**Platform phases** (operator's frame, locked this turn — read top-to-bottom to orient):

1. **Phase 1** — MELEK Graphene chain + AIs (resident AI, Hathor, Cheetah) + SoapBox-as-a-MELEK-app + community/forum + SSO signer. **← current.**
2. **Phase 2** — PRANA (EVM value/compute chain) + deploy/token factory + AMM + useful-work GPU compute + DeFi tools.
3. **Phase 3** — Full operation: analytics/tribunal layer live, marketplace + mobile + browser extension.
4. **Phase 4** — SOAP launches as its own Graphene chain into the live ecosystem.
5. **Security/Signer foundation** — parallel private-repo track underneath all of it.

**Phase 1 milestone sequence (operator-locked 2026-05-28).** Within Phase 1, the order operator wants:

1. **Resident AI working** — most of this shipped today (autonomous brief generator + lifecycle + per-file archive + insider-voice prompt). Awaiting: first autonomous-loop briefs to land + multi-source ingest as data sources come online.
2. **Cheetah standup** — get the sibling bot running so Hathor isn't alone. Operator's #1 near-term ask. First seed-queue brief is "draft step 1 of CheetahAdvanced."
3. **Hathor on Discord test** — the smallest-viable Hathor presence on Discord. Also becomes a constant data stream for the resident AI to monitor (parallel to trade-bot data).
4. **Launch the MELEK blockchain** — testnet RPC values land, witness registers, intro post broadcasts, feed publisher runs. All chain-side scaffolding is built and gated on this.
5. **Connect AI to MELEK Condenser** — the front-end (condenser) on Server B reads from the AI's surfaces / briefs / per-file archive as appropriate.

**Hard-break protocol.** When the moment arrives (likely the `melek-signer` private-repo kickoff, or the PRANA Phase-2 repo when that opens), the standing instruction is: surface the hard break explicitly to operator with a one-line "start a Claude Code in `<repo>` and I'll draft the brief for it" — don't silently fan work out. By that point the resident AI is running 24/7 here and continues writing drafts during the parallel work.

**Active build tracks:**

1. **Stage 0 — Resident AI VM (IN FLIGHT, architecture pivoted 2026-05-28).** Originally scoped for Oracle Always Free VM #1; per the refresh, the resident AI now lives on **Server A** (ServerHost first, Hetzner if ID-check completes faster). Codespace-side work continues; provisioning gates moved from Oracle to ServerHost/Hetzner. See `.local/STAGE_0_BRIEF.md` (original) + `.local/STAGE_0_UPDATE_2026-05-28.md` (refresh) for the full briefs.

2. **Watcher module (built 2026-05-27, working tree uncommitted).** Out-of-band alerter for sensitive ops by Hathor. 79 passing tests; full repo at 128 tests. Read-only, keyless, safe to commit and deploy regardless of signing architecture decisions.

3. **MELEK-Signer (designed, build deferred).** Resolved 2026-05-27. Hot/cold signer split: VPS-resident signer with KMS-encrypted keys at rest, hardware-wallet cold signer for rare ops. Bot holds only an opaque bearer token; never sees a WIF. Full design in `MELEK_SIGNER.md`. Operator wants to talk to Claude Regular before kicking off the `melek-signer` repo build.

4. **Phase 1 chain ops (waiting on melek-chain testnet RPC).** Hathor + GrapheneAdapter + chain-reader + feed publisher + register / disable witness + intro post + smoke test — all built, all gated on the RPC URL becoming available.

5. **Phase 2 (tutorial + welcomer + command menu).** Welcomer + tutorial composer/state shipped 2026-05-25; tutorial scheduler + command menu + signup-help-server still to build.

**Infrastructure stack (resolved 2026-05-27):** Oracle Always Free for all three VPSes (resident AI, signer, watcher), AWS KMS for signer key wrapping (~$1/mo), RunPod on-demand for any GPU work (ComfyUI, LoRA), Cloudflare for DNS (`melek.salon`, `vankushfamily.com`), this GitHub Codespace as dev environment. Total ~$6–35/mo, most variable cost is RunPod when used. Full doc in `.local/STACK.md`.

**Big design rule locked this session:** **NO WIF private keys in this repo or on the Bot host, ever, by construction.** Replaced the old "active key in env" shape. See `MELEK_SIGNER.md` + `[[feedback-zero-wif-in-bot-repo]]` memory.

**Memory pointers for next session:** `[[todo-pointer]]`, `[[hathor-key-security-architecture]]`, `[[feedback-zero-wif-in-bot-repo]]`, `[[feedback-synthesis-docs-go-in-local]]`, `[[watcher-module-shipped]]`, `[[tutorial-design-2026-05-25]]`, `[[operator-steemit-handles]]`, `[[cheetah-advanced-brief]]`, `[[bot-as-hathor-account]]`.

---

## 🟥 Operator-side, urgent / outstanding

Things only the human operator can do.

### Stage 0 unblockers (post-pivot 2026-05-28 — provisioning gates moved off Oracle)

- [ ] **Provision Server A — Admin / Resident-AI VM (ServerHost first).** Operator is trying a LowEndBox-tier ServerHost KVM VPS for this role. Need: hostname/IP, sudo user, SSH access verified from this Codespace. Default user can be `ubuntu` or operator's choice — note it when sharing. **Codespace pubkey to paste at creation:** `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMR2lXjt1WTIoyWD4KtXdwmQjhr5UhUOmzN7OAErBega codespace-bot-repo-2026-05-27`.
- [ ] **Hetzner — waiting on manual ID verification.** Operator has applied. Once verified, Hetzner becomes available for one of: Server B, signer VPS, or watcher VPS (operator will decide based on what ServerHost gets sized for). The CX22-class boxes from `.local/STACK.md` still hold as the spec.
- [ ] **Provision Server B — Host server.** Bot Repo runtime + MELEK chain (witness node) + condenser. Likely a larger box than Server A. Need: hostname/IP, sudo, SSH access from Server A confirmed. **Do not genesis the chain yet** — Server B starts as host-ready only; chain launch is a separate Phase-1 milestone with explicit operator go-ahead.
- [ ] **Decide Oracle Always Free reassignment.** Likely candidate is CheetahAdvanced — but ARM Always Free parameters may not fit Cheetah's image-detection step (the reverse-search / perceptual hashing piece). Open question: does Cheetah's image step fit the Oracle ARM profile, or does that piece need GPU-on-demand (RunPod) and Oracle only hosts the text-detection layer?
- [ ] **Provide list of all operator repos** the resident AI should index (beyond Bot Repo) once Server A is up. Access method (HTTPS PAT, deploy keys, etc.) per repo.
- [ ] **AWS account verification** (KMS-only, for MELEK-Signer). One-time. ~$1/mo eventual spend. Does not gate Stage 0; gates MELEK-Signer build.
- [ ] **Cloudflare account** (free) for DNS on `melek.salon` + `vankushfamily.com`. One-time. Does not gate Stage 0.
- [ ] **RunPod account** with $10 credit, no pod launched. For later GPU work (ComfyUI / LoRA, possibly Cheetah image step if Oracle ARM can't carry it). Does not gate any current work.

### Pre-existing

- [ ] **Decide what to do about the `angelicalist` HIVE account.** Active + posting keys public in git history (`SECURITY_KNOWLEDGE_BASE.md`, commit `b4c4e55`, ~4.5 months exposure). Keys saved in prior session conversation. Options: move funds with active, rotate via offline owner, declare abandoned. Not blocking MELEK work.
- [x] *(done — npm audit remediation task completed)* **Address the 15 npm audit findings in legacy deps** (5 high / 7 moderate / 3 low). All in van-kush-discord-bot path, not MELEK Witness path. Currently informational in preflight.

---

## 🟧 Stage 0 — Resident AI on Server A + admin link to Server B (IN FLIGHT)

Briefs: `.local/STAGE_0_BRIEF.md` (original) + `.local/STAGE_0_UPDATE_2026-05-28.md` (architecture refresh). Goal: stand up qwen2.5-coder on **Server A** (ServerHost or Hetzner), expose `briefd` for the Codespace, give Server A read-only admin SSH into Server B, point the AI at the priority subsystems first.

**Server A landed 2026-05-28 (Servitro Virtual-1, Ubuntu 20.04, 1 core / 3.8 GB / 25 GB).** See `the private resident-AI infra/SETUP.md` for the install record.

**Codespace-side (done):**

- [x] Generate SSH keypair for Codespace → VM access. Pubkey saved at `~/.ssh/melek_oracle.pub`; private half stays in Codespace only.
- [x] **Step 1 — `.local/PRIORITY_SUBSYSTEMS.md`.** Hathor / Cheetah / Signup deep map.
- [x] **Step 5 source — Python RAG indexer.** `the private resident-AI infra/indexer/` shipped. CLIs `reindex-repo`, `ask-repo`, `melek-chat` symlinked into `/usr/local/bin/` on Server A. Trimmed scope (85 priority files) to fit the 1-core CPU; expand later if box upsizes.
- [x] **Step 6 source — `briefd` Node service.** Shipped with the **three-part brief format** (FOR RYAN / FOR CLAUDE CODE / DRAFTED CODE), **30-min editor's-note revisor**, **append-only invariant**, and **consumed-on-read** semantics. Endpoints `/healthz`, `/brief/request`, `/chat`, `/brief/latest`, `/brief/read`, `/brief/by-topic/:topic`, `/revisor/run`. Running under systemd as `briefd.service`.
- [x] **Step 8 — `CLAUDE.md` directives + `BRIEF_PROTOCOL.md`.** Both shipped. Pre-work section in `CLAUDE.md` tells future sessions to consult briefd before starting work.
- [x] **Codespace-side `request-brief` helper.** `the private resident-AI infra/request-brief <topic> "<task>"` wraps the curl pattern + tunnel preflight.
- [ ] **Step 2 — `.local/REPO_MAP.md`.** Broader inventory of the rest of the repo. Not blocking briefs.

**VM-side (done):**

- [x] **Step 4 — VM hardening + install.** UFW (22 only), fail2ban, unattended-upgrades, key-only SSH, swap (1.5 GB), Node 20, Python 3, Docker, Ollama, Qdrant in Docker (localhost-only). `<DATA_DIR>/briefs/`. Recorded in `the private resident-AI infra/SETUP.md`.
- [x] **Step 7 — Codespace → briefd reachability.** SSH tunnel pattern documented in `the private resident-AI infra/BRIEF_ACCESS.md`. Secret cached in `.local/briefd.env` (gitignored).
- [ ] **Step 9 — Seed first four briefs.** Pipeline armed and waiting for the initial index to finish (~30 min on the 1-core box). Hathor / Cheetah / Signup / cross-gaps queued. Briefs land in `<DATA_DIR>/briefs/` on Server A only.
- [ ] **Step 10 — Session summary printed.** Pending first briefs landing.

**Open follow-ups from tonight's pivot:**

- [ ] **Upsize Server A or swap to a hosted LLM API.** 1 core / 3.8 GB is tight — embedding chunk rate is ~6 sec/chunk, brief composition ~1-3 min each. If brief quality is thin, options: 2-4× bigger box, or use Ollama for embeds only and a hosted Qwen / DeepSeek API for compose.
- [ ] **OS upgrade Server A 20.04 → 22.04 / 24.04 LTS.** 20.04 standard-support EOL was April 2025. Not blocking for the resident-AI role; do before this becomes a production-relied-on box.
- [ ] **Enable the `reindex-repo.timer`** once the index is stable (15-min cadence pull + reindex).
- [ ] **Broaden the indexer scope** beyond the priority 85 files once the box is bigger (knowledge/, full infra/, cryptology/, etc).
- [ ] **Filing system for briefs (open decision).** Operator-flagged 2026-05-28 — briefs shouldn't accumulate forever. Default lean: status-driven lifecycle (`pending → consumed → archived`) + topic-bucketed archive + operator-grade override.

**Last (after everything else lands):**

- [ ] **Step 3 — Itinerary + Master_Itinerary update.** Walk operator's recent uploads + this session's outputs + post-January docs not yet in itineraries. Produce diff for operator approval before committing.

### Standing-job mechanics (new in the 2026-05-28 refresh)

Once Server A is up and `briefd` is live, the resident AI runs 24/7 with this shape:

- [x] **Three-part brief format.** SYSTEM_PROMPT in `the private resident-AI infra/briefd/llm.js` demands three sections; `/brief/request` handler asks for them explicitly. Live on Server A.
- [x] **30-minute editor's-note revision pass.** `the private resident-AI infra/briefd/revisor.js` runs every `REVISOR_INTERVAL_MS` (default 1800s). Walks unconsumed briefs, re-retrieves context for each, asks the LLM whether new state would change the recommendation, **appends `## Editor's Note (timestamp)`** if yes. Live on Server A.
- [x] **Append-only invariant.** `briefs_store.appendEditorsNote()` only appends; original body is never rewritten. Sidecar `.meta.json` tracks `revision_count` + `last_revised_at`. Reading a brief via `/brief/read` flips `consumed=true` and the revisor leaves it alone after that.
- [x] **Streaming Ollama integration (undici-fix).** `the private resident-AI infra/briefd/llm.js` uses `stream: true` + custom undici Agent with `headersTimeout: 0, bodyTimeout: 0`. Shipped 2026-05-28 mid-session after 5-min cliff diagnosed. First real brief landed.
- [x] **SYSTEM_PROMPT rewrite — insider voice.** Replaced "plain text, no code blocks, terse" with insider-voice directives + scripture/research context + analysis-vs-deployment distinction (no analysis restrictions). 2026-05-28.
- [x] **Brief generator daemon.** `the private resident-AI infra/briefd/generator.js` + `brief-generator.{service,timer}` (every 20 min). Reads `seed-queue.json` FIFO → standing rotation across topics. Lock file prevents concurrent runs.
- [x] **Brief lifecycle + long-term notes extraction.** `the private resident-AI infra/briefd/lifecycle.js` + `brief-lifecycle.{service,timer}` (daily). Filing-system shape locked: consumed → `<DATA_DIR>/archive/briefs/<YYYY-MM>/` after 7d; everything → deleted after 30d; before deletion, AI distills a one-line takeaway into `<DATA_DIR>/notes/<topic>.jsonl`.
- [x] **Per-file archive walker.** `the private resident-AI infra/briefd/code-walker.js` + `code-walker.{service,timer}` (every 30 min). Cheap metadata for every file every tick; one LLM deep-inspection per tick (round-robin via `<DATA_DIR>/walker-cursor.json`). Schema at `<DATA_DIR>/archive/files/<flat>.json` with purpose / work_items / finished_items.
- [x] **`reindex-repo.timer` enabled.** Was disabled last night — now active, 15-min cadence.
- [ ] **Itinerary integration job.** When AI sees repo state change or surfaces conversation items not yet in `ITINERARY.md` / `MASTER_ITINERARY.md`, it drafts a brief proposing the itinerary edit. The standing pattern: operator → Claude Code → AI puts it in Itinerary. Currently many things from conversation + TODO + briefs are not yet in Itinerary because the AI was offline. **First Itinerary-integration brief is seeded in the generator's queue.**
- [ ] **Multi-repo indexing.** Extend `the private resident-AI infra/indexer/index.py` to walk a list of operator-provided repo paths, not just `<APP_DIR>/repo`. Currently single-repo. Gated on operator handing over the list + access (PAT or deploy keys).
- [ ] **Server A → Server B admin link.** Build the thin read-only admin-helpers the AI uses on B (service health, log reading, status reporting). State-changing ops are proposed in a brief → operator approves → executed. Document in `infra/servers/ADMIN_LINK.md` once both boxes exist. **Gated on Server B existing.**
- [ ] **Trade-bot data ingestion** (Railway). Ingest live data from the bots in the repo, mine it for things-to-do. Findings become drafted briefs. **The trade bots execute autonomously and always-on; the resident AI analyzes and drafts improvements, it does not trade.** Gated on Railway access details.
- [ ] **Discord ingestion** (Hathor presence). Operator named Discord as another constant data stream parallel to trading. Once Hathor is on Discord, the AI watches the channel(s) read-only, drafts briefs about discussions, surfaces bugs/questions raised. Gated on Hathor's Discord standup.
- [ ] **HIVE-Engine market-data ingestion.** Token / curation / market data stream. Findings → briefs about trade-bot improvements, listing decisions, etc.
- [ ] **MELEK chain steemd ingestion.** Block stream from the MELEK chain once live. Witness behavior, op patterns, account activity → briefs.
- [ ] **Research-paper ingestion.** Index Heterosis paper, Mythology-as-Genealogy, prior `@marsresident` / `@punicwax` Steem/Hive tutorials. Currently the scripture corpus is indexed but other operator-authored material isn't.

### Hard-break protocol (operator instruction)

- [ ] **Surface the hard break when it lands.** When the moment arrives — likely `melek-signer` private-repo kickoff or the PRANA Phase-2 repo opening — Claude Code in *this* repo must explicitly tell operator "we're at the hard break — start a Claude Code in `<repo>` and I'll draft the brief for it," then write the brief. By that point the resident AI is running 24/7 here and continues drafting during the parallel work. Do not silently fan work into the other repo.

---

## 🟧 Watcher — built, awaiting commit + deploy

- [x] **Watcher module shipped 2026-05-27.** `watcher/` directory: state / detect / compose / config / sinks (file, telegram, email) / index. 79 passing tests. npm scripts `watcher:once|cron|dry`. `.env.example` + `.gitignore` + preflight wording updated. **Working tree uncommitted at end of session.**
- [ ] **Commit the watcher** (operator can do anytime; ask Claude Code to commit when ready).
- [ ] **Operator setup for live deployment:**
  - Optional Telegram via @BotFather → `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`.
  - Optional Resend with verified sending domain → `RESEND_API_KEY` + `ALERT_EMAIL_FROM` + `ALERT_EMAIL_TO`.
  - Without either, the JSONL file sink is the always-on floor.
- [ ] **Deploy to Oracle VM #3** (or shared with VM #2 signer per `.local/STACK.md`). Gated on that VM existing.
- [ ] **Future extension** (gated on MELEK-Signer policy decisions): policy-conformance rule that distinguishes legitimate signup grants (5–15 MELEK to ≤24h-old account) from anomalous outbound. Doesn't block alerting today.

Details: `[[watcher-module-shipped]]` memory.

---

## 🟧 MELEK-Signer — designed, build awaiting operator approval

Full design in [`MELEK_SIGNER.md`](./MELEK_SIGNER.md). **Operator wants to talk to Claude Regular before kicking off the `melek-signer` repo build.** Don't pre-build it.

**Open decisions before MELEK-Signer's first code:**

- [ ] **Cloud KMS provider** — AWS (default rec) / GCP / Azure / AWS-from-Hetzner.
- [ ] **Hot-signer runtime** — Node.js (default rec, reuses `@hiveio/dhive`) vs Rust.
- [ ] **Hardware wallet for cold signer** — Ledger / YubiKey + custom / phone Secure Enclave / air-gapped laptop with `cli_wallet`.
- [ ] **MELEK-Signer repo name + visibility** — proposed `melek-signer` as a sibling private repo.
- [ ] **Daily grant cap (`N/day`)** at the policy engine — proposed 50–200 for launch.
- [ ] **Signup grant amount policy** — fixed (e.g., always 10 MELEK) or tiered by tutorial progress (5 / 10 / 15).
- [ ] **Watcher VM deployment** — third VPS or shared with signer (per `.local/STACK.md`).

**Once MELEK-Signer is built, what changes in this Bot repo (don't do these yet):**

- [ ] Remove `HATHOR_ACTIVE_KEY` / `HATHOR_POSTING_KEY` from `.env.example`. Add `MELEK_SIGNER_URL` + `MELEK_SIGNER_TOKEN`.
- [ ] Retract WIF-as-env language in `BRIEF.md §7`, `SECURITY.md §3`, `OPERATOR.md` key-custody / deploy sections — replace with reference to `MELEK_SIGNER.md`.
- [ ] Add a small `melek-signer-client.js` to `src/chain/` that wraps the MELEK-Signer HTTP API.
- [ ] Refactor `witness/{publish-intro,feed-publisher,register,disable}.js`, `welcomer/index.js`, future `signup/` to broadcast via the client instead of local `Client.broadcast.sendOperations`.

Details: `[[hathor-key-security-architecture]]` memory.

---

## 🟧 Gated on melek-chain testnet — Phase 1 finish

Bot is ready; needs values from the chain side before final steps run.

- [x] **Get the chain endpoint values from melek-chain** (`HinduTempleCoins/melek-chain/config.hpp`): `MELEK_RPC_URL`, `MELEK_CHAIN_ID`, `MELEK_ADDRESS_PREFIX`. Drop into `.env`.
- [x] *(done 2026-06-05 — hathor is a GENESIS account on the live testnet, claimed + producing)* **Bootstrap-create the `hathor` on-chain account.** Chicken-and-egg — needs another account to sign `account_create_with_delegation`. See OPERATOR.md §6.
- [x] *(done 2026-06-05 — genesis witness, URL set)* **Register Hathor as a witness:** `node witness/register.js --dry-run` then `--yes` after filling `HATHOR_WITNESS_URL` + `HATHOR_BLOCK_SIGNING_PUBKEY` in `.env`. See OPERATOR.md §7.
- [x] *(done 2026-06-05 — @hathor/introducing-hathor-on-melek on-chain)* **Publish the intro post:** `node witness/publish-intro.js --dry-run` then live. Body lives in `witness/intro-post.md`.
- [x] *(done 2026-06-06 — hourly systemd timer, active key fetched JIT from vault per run, never on disk)* **Start the feed publisher** under systemd / pm2: `node witness/feed-publisher.js --cron`. Needs `MELEK_FEED_BASE`/`MELEK_FEED_QUOTE`/`FEED_CRON` in `.env`.
- [x] *(green 2026-06-05 against the live testnet)* **Run `npm run hello` end-to-end on the live testnet.**

---

## 🟨 Phase 2 buildable (no chain needed)

### Tutorial scope (LOCKED 2026-05-25 — 19 lessons, three modes)

Modes: **A-Req** (must complete to graduate) / **B-Placeholder** (lesson published, achievement locked until infra ships) / **C-Read** (orientation/closer, completion = reading).

1. Intro / Verification — A-Req
2. Four Keys — A-Req
3. Etiquette + **flag-not-downvote** — A-Req
4. Markdown — A-Req
5. **Topics + Tags + Posting** — A-Req (subject menu: Cryptocurrency / Finance / Bio-hacking / Herbal / Esoteric / Religion + more)
6. MP / Voting / Delegation — A-Req
7. Witnesses & Governance — A-Req (honest disclosure of 12-month slot protection)
8. Basic Posting + Voting — A-Req
9. Communities / Groups — B (needs hivemind-equivalent)
10. AI Image Generation — A-Req
11. CapCut / Video Basics — A-Req
12. Google Colab / Make Your Own AI — A-Req
13. Curation Rewards & Trails — B
14. **Tokens on the MELEK ETH Clone** — B (Hive-Engine-equivalent EVM chain; Hathor there = PIZZA-bot)
15. Videos (DTube + SCOT) — B
16. Wiki (DevTome-style, paid) — B
17. Trading MELEK — B
18. AI on the Chain (Hathor explainer) — C-Read
19. The Deeper Why — C-Read

Full design context: `[[tutorial-design-2026-05-25]]` memory.

**Tutorial scope — decisions still pending operator:**

- [ ] **Decide: draft Tier-A lesson posts now in Phase-2 register, or hold for Phase-3 Angelic-voice authoring?**
- [ ] **Decide: quote-and-port vs rewrite for existing operator tutorial posts.** @punicwax/`mining-steem-blurt-and-hive-what-is-a-witness-and-how-does-all-this-work` is ~90% ready for Lesson 7. TRC10/SMT/ETH-clone tutorials map onto Lesson 14. See `[[operator-steemit-handles]]`.
- [ ] **Decide: permlink/tag convention.** Proposed `melek-lesson-N-<slug>` for Hathor's posts + `#melekachievementN` for user responses.
- [ ] **Grow the Topics subject menu** beyond the six named.
- [x] *(done — 19 stages shipped)* **Expand stages.json from 6 → 19 stages** before composer templates can be finalized.

**Tutorial code (structurally clear, content shapes still firming):**

- [x] **`tutorial/composer.js`** — drafted 2026-05-25. Deterministic template pool (3 variants per stage, picked by `sha256(account+stage_key)[0] % 3`).
- [x] **`tutorial/state.js`** — built 2026-05-25. File-backed per-account store, atomic write. 7 passing tests.
- [ ] **`tutorial/scheduler.js`** — wires chain-reader → detector → state-check → composer → broadcast → state-write. CLI mirrors `witness/feed-publisher.js`.
- [ ] **`tutorial/welcomer.js`** — from 2026-05-25 conversation. Three surfaces: comment on first post (@wang model), transfer-memo fallback, condenser troll-box / signup-chat hook.
- [ ] **Composer tests** — currently untested. Templates likely to change with lesson firming; test the structural contract.

**Lesson content (drafting):**

- [ ] **Tier A lessons — draftable now without further infra.** Intro/Verification, 4 Keys, Etiquette (flag-not-downvote), Markdown, How Tags Work, MP/Voting/Delegation, Witnesses/Governance (honest 12-month disclosure), Religion arc, Bio-hacking/Herbal, AI image gen, Colab, CapCut.
- [ ] **Tier C closer — AI on the Chain.** Hathor-explainer. PIZZA-bot-style entry, pivots to Convergence material.

### Other Phase 2 work

- [x] *(done 2026-06-06 — built incl. !signup/!tutorial, live demo at alpha.melek.salon/commands/)* **Command menu — `!commands` deterministic handlers.** Signup help, tutorial lookups, chain queries (`!balance`, `!witness`, `!post-count`). No LLM.
- [ ] **Signup-help server-side flow.** Email verification (Resend / Postmark / SES — pick one). Signs `account_create_with_delegation` from Hathor's authority **(via MELEK-Signer, once it exists — not via local WIF).** Key custody absolute: new user's keys generated client-side in the condenser browser.
- [x] *(done)* **Add `custom_json` + `reply()` to `src/chain/graphene.js`** (~30 lines + tests). Unblocks Tier-B feature wiring.
- [ ] **Welcomer integration hardening** — rate-limiting, parallelism cap on block scans, better dry-run output formatting.

---

## 🟨 CheetahAdvanced — sibling bot to Hathor (designed, build not started)

Brief: [`CHEETAH_ADVANCED.md`](./CHEETAH_ADVANCED.md). Memory: `[[cheetah-advanced-brief]]`. Read the brief before writing any Cheetah code — non-obvious constraints (state-facts-don't-accuse, credit-first-escalate-last, self-ID footer, frequency restraint, evidenced whitelist, Hathor as the resolution layer).

Build order — first three are Phase-2-shaped (deterministic, no LLM); steps 4–5 gate on Phase 3; step 6 (image detection) last.

- [x] *(done — cheetah/text-detection.js; running read-only vs the live testnet at alpha.melek.salon/cheetah/)* **1. Text detection layer.** Match post text vs prior on-chain posts + web search. Outputs `{match, source, confidence}`. NOT an LLM — similarity / matching.
- [x] *(done — cheetah/compose.js)* **2. Comment layer + self-ID footer + crediting-note voice.** Phase-2 deterministic templates (same shape as `welcomer/composer.js`).
- [x] *(done — cheetah/store.js, shared store)* **3. Shared-store integration.** Cheetah writes findings + evidenced whitelist/blacklist; Hathor reads. Multi-bot architectural decision needed first.
- [ ] **4. Resolution flow with Hathor** *(gates on Phase 3)*.
- [x] *(done — cheetah/discovery.js, librarian band, live on the alpha report)* **5. Discovery mode** — can ship Phase 2 with deterministic notes; warm LLM authoring later. Built-in opt-out + relevance threshold + frequency cap.
- [x] *(done — cheetah/image-detection.js + perceptual-hash.js)* **6. Image detection (last).** Reverse-search / perceptual hashing.

**Decisions pending operator:**

- **Search backend** — Google Custom Search / Bing / Serper / DDG.
- **Shared-store location** in the repo.
- **Per-author opt-in vs opt-out** default.
- **Cheetah's account name** on chain.

---

## 🟦 Long-form / waiting on operator input

- [ ] **Corpus expansion (load-bearing).** Operator has more scripture-style documents to add. Pattern: full markdown in `knowledge/scripture/`, indexed in `_index.json` with key_themes + witness_guidance. Until fuller, Crypt-ology stays deferred. See `[[sequencing-corpus-before-cryptology]]`.
- [ ] **Crypt-ology rewrite** — only after corpus is fuller. Greenfield `cryptology/` directory: `relationship-map.js`, `topic-interests.js`, `README.md`. Prior-build files stay historical, not loaded.
- [ ] **LINEAGE.md** — low priority; BRIEF.md §2 and CHARACTER.md §4 already cover the same ground.

### Forker-friendliness / polish

- [ ] **CONTRIBUTING.md** — PR submission, security disclosure path, code style.
- [x] *(done — MELEK.md exists)* **MELEK.md glossary** — chain-and-project terminology for newcomers.
- [ ] **`system_prompts/` stub directory** — README explaining Phase 3 assembly pattern. No actual prompts yet.

### Operator cold-signer prep

- [ ] **`disable_witness` payload pre-staged on offline machine.** Already scripted (`witness/disable.js`); needs USB-export + paper backup + procedure in OPERATOR.md §10. Cold-signer territory once MELEK-Signer ships.

---

## 🟪 Phase 3 — conversational Witness (deferred)

All gated on corpus expansion + Phase 2. Listed so future operators / forkers see the shape.

- [ ] **LLM integration.** Pick a provider, wire model swap as a config knob.
- [ ] **System prompt assembly.** BRIEF + CHARACTER + RULE_1 + per-conversation context.
- [ ] **Voice + disposition implementation.** Angelic register from CHARACTER.md §2 as a hold.
- [ ] **Karma layer.** Off-chain karma DB. Behavioral evaluation distinct from Crypt-ology.
- [ ] **Kurdish-language capability (multi-AI committee, all hands).** Once the platform is up, ALL the AIs in the system (resident AI, Hathor, Cheetah, the Qwen language-AI, the tiny-LLM on the tiny-LLM host, plus any others online by then) join a sustained discussion about proper Kurdish translation and build register-aware translation primitives. **Plus add MORE language-specialized AIs to the ensemble for this work** — multilingual models that have Kurdish coverage as a strength (candidates to evaluate: NLLB-200 with Kurmanji+Sorani support, Aya Expanse, mT5-XXL fine-tunes, plus any HuggingFace community Kurdish fine-tunes). Operator framing 2026-05-28: "we are Talking about Complex Things, like how there is Spanish for Church, and Spanish for Businesses." Translation work must distinguish (a) dialect (Kurmanji / Sorani / Pehlewani-Zaza-Gorani — these have substantial mutual unintelligibility, not just dialect-tier variation) and (b) register / domain (religious / scholarly / business / colloquial / literary). This is committee work, not single-shot: every AI contributes from its strengths, decisions accumulate, the output is a translation kit Hathor (and any other AI generating Kurdish-language content) uses. Gated on Phase 3 conversational layer + corpus expansion.

---

## ⬜ Smaller / nice-to-have

- [ ] **Integration test of `hello.js`** against a mocked Graphene RPC.
- [ ] **More tutorial detector tests** for edge cases.
- [ ] **Periodic dependency review.** Quarterly `npm outdated` + `socket.dev`.
- [ ] **Decide on git-history scrub** of leaked WIF strings in commit `b4c4e55`. Default position: leave history alone (keys already burned; rewriting commit hashes breaks anyone's clone).
- [ ] **`knowledge/search.js`** — deterministic topic lookup against `_index.json` key_themes.

---

## ✅ Resolved (most recent first)

### 2026-05-27 (this session)

- **Watcher module shipped.** `watcher/` directory: state, detect, compose, config, sinks (file/telegram/email), index. 79 passing tests added (total 128). npm scripts. `.env.example` + `.gitignore` + preflight updated. Working tree still uncommitted.
- **`MELEK_SIGNER.md` design brief authored.** Resolved hot/cold signer split + KMS-on-VPS + policy engine + watcher-as-DiD. Replaces the old "active key in env" shape from BRIEF.md §7 / SECURITY.md §3 / OPERATOR.md.
- **Zero-WIF-in-Bot rule established** (`[[feedback-zero-wif-in-bot-repo]]`). Trigger: angelicalist key leak. Outcome: no WIF in this repo or on Bot host, ever, by construction.
- **Synthesis-docs-go-in-.local rule established** (`[[feedback-synthesis-docs-go-in-local]]`). Inventories / maps / architecture briefs default to `.local/` (gitignored), not public paths. Triggered by Stage 0's inventory write being moved out.
- **Infrastructure stack documented** at `.local/STACK.md`. Oracle Always Free × 3 VMs + AWS KMS + RunPod on-demand + Cloudflare + Codespace. ~$6–35/mo.
- **Stage 0 Resident AI brief saved** at `.local/STAGE_0_BRIEF.md`. Codespace-side work in flight.
- **SSH keypair for Codespace → Oracle VM** generated (`~/.ssh/melek_oracle.pub`).
- **`.local/PRIORITY_SUBSYSTEMS.md`** — Hathor / Cheetah / Signup deep map.
- **`.local/` directory + `.gitignore` entry** — barrier for operator-only docs.

### 2026-05-25

- Tutorial response **composer (`tutorial/composer.js`)** + **state (`tutorial/state.js`)** built.
- **Welcomer module end-to-end** — state, composer, discover, config, index, CLI, 42 passing tests, npm scripts.

### Earlier (pre-2026-05-25)

- Phase 1 chain-access scaffolding: Hathor + GrapheneAdapter + chain-reader + feed publisher + register + disable + intro post + smoke test.
- Load-bearing docs: BRIEF, CHARACTER, RULE_1, SECURITY, OPERATOR, README.
- Tutorial detector + 20 tests; tutorial stage spec; scripture corpus (7 documents at end of 2026-05-25, +Heterosis +Mythology-as-Genealogy added that day).
- Pinned deps; `.npmrc` enforcing security flags; preflight script + CI workflow; LICENSE.
- Scrubbed leaked WIF strings from `SECURITY_KNOWLEDGE_BASE.md` (history retains them; see angelicalist item under Operator-urgent).

---

## 🟨 PRANA doc action items (2026-06-05 — from the three re-supplied docs; NO REHAULS, build on what exists)

- [ ] Request brief from resident Bot AI for this task (`/brief/request`).

**Already satisfied by what exists (verify-only, no work):**
- [x] "PRANA stays EVM" (VM doc §12) — PRANA already IS core-geth/EVM. Recorded; no change.
- [x] BURN lane exists — UnifiedSharesLedger already has HASH/TASK/BURN.
- [x] Receive-only mining (Pool doc §6) — live pool already pays to an address, holds no spend keys.
- [x] Free-tier TASK-only worker mode — pool-worker `PRANA_FREE_TIER` already built (ToS-safe Colab lane).
- [x] Inference ladder — tools/inference-router already implements priority/fallthrough.

**Small adds on top of existing pieces (queue):**
- [ ] Monero menu entry + Monero wallet module on the live pool (operator-ordered; fold into Miningcore migration result).
- [ ] CurrencyModule interface spec written down (Pool doc §4) as the pool frontend's module contract — formalize what the Miningcore-config-per-coin + wallet pattern already does; no platform change.
- [ ] Pool frontend "three doors" framing (Mine / AI Work / Burn) — UI/copy layer on the existing pool site; Burn door = link/stub until PRANA launches.
- [ ] Akasha keystore wiring plan — PRANA repo akasha/ already exists; document how pool wallet modules share its HD keystore (design note via PRANA patch; no new wallet app).
- [ ] Burn-stake copy discipline — "competitive, not guaranteed; utility + sink, never yield" language wherever burn appears (pool site, future docs).
- [ ] Reconcile the two ladder orders (bootstrap phase: free APIs → Colab → river; mature phase: river first) as a mode flag in inference-router config — note, not rewrite.

**Operator decisions (no build until picked):**
- [ ] Block cadence at PRANA genesis: ~13s safe default vs 5–12s + uncle rewards (Burn doc §3).
- [ ] Burn weight: permanent (default) vs Slimcoin-style decay (§1).
- [ ] Cross-currency burn weighting: fixed ratios at start vs price oracle (§2).
- [ ] Ethash vs Etchash (UD-PR-B) — pre-genesis, changes genesis hash.
- [ ] Energy-as-chain-gas vs app-layer perk (UD-AG-C).
- [ ] Hathor fee % + payout cadence + coordinator trust model (from the fees-module build).

**Gated on PRANA launch / bridges (design-stage only now):**
- [ ] Multi-currency burn (wMELEK/wVKBT/CURE/SMTs) — needs wrapped tokens + relayer; Melek-Engine seams already reserved.
- [ ] Games app-chain/L2 pattern — notes only; nothing existing changes.

**Missing record:** the primary companion doc "PRANA — The Switching Engine, the Chain-as-Pool, and the Path to a DAO" is still not on file (the repo only holds distilled notes of it). Operator to re-send when convenient → save verbatim like the others.

---

## 🟦 Standards + agency-guidance review (queued 2026-06-05, operator Addendum 14 — READ-ONLY, change nothing)

- [ ] Request brief from resident Bot AI for this task (`/brief/request`).
- [ ] **Standards sweep (look, don't change):** IEEE (2418.x blockchain, 7000-series AI ethics, P2048/metaverse-VR, security) · ISO (TC 307 blockchain, 27001 security, AI/ML standards) · NIST (CSF, AI RMF, FIPS) · W3C (DIDs, Verifiable Credentials) · IETF · ETSI · relevant state standards. Map each to our subsystems (chain, pool, signers, engine, AI residents, metaverse/Dudael, data sites) — a gap/alignment TABLE, no code changes.
- [ ] **Agency-guidance sweep:** IRS (mining income, token taxation, 1099-DA broker rules) · SEC (Howey — esp. burn-stake/offerings framing already flagged "Howey-ish" in the PRANA docs; token offerings; exchange/DEX lines) · FinCEN (MSB/money-transmitter — POOL PAYOUTS + custodial seams) · CFTC · FTC (consumer protection, endorsements, scam-data presentation) · OFAC (sanctions screening) · state regulators (NY BitLicense, money-transmitter map) · FATF travel rule + EU MiCA internationally · plus hemp (USDA/FDA/DEA), stocks-data (SEC/FINRA display rules), AI agencies' guidance. Map findings to: pool, Melek-Engine, burn-stake, signup, Hive.Vote copy, data sites, hemp vertical, Dudael.
- [ ] Output: one review document per area in `docs/compliance-review/` (public-safe summaries) + operator-facing plain-English brief of the load-bearing findings (what we're aligned with, what to watch, what's a real decision). NO changes to any built system from this review — findings come back to the operator first.

### Gov-contracting + enterprise credentials review (queued 2026-06-05, Addendum 15 — pairs with the standards review above)

- [ ] **RFP/RFI landscape:** how government buying actually works (RFI→RFP→proposal→award), where they live (SAM.gov federal, state procurement portals), and REAL examples in our industries (blockchain, AI, data platforms, citizen services). Pull a handful of public RFPs/RFIs that touch what we build.
- [ ] **The incumbents' playbook:** how Deloitte/Xerox/Accenture-class proposals are structured (capabilities, past performance, compliance matrices, certifications cited) — including the CRM/citizen-services world the operator worked in with Nebulogic (orientation context, ask operator for specifics worth recording).
- [ ] **The credentials ladder:** FedRAMP/StateRAMP (cloud for gov), FISMA + NIST 800-53, CMMC (defense), SOC 2, ISO 27001, PCI-DSS (payments), Section 508/WCAG (accessibility) — what each is, what it costs/takes, which (if any) are realistic + worth it for us, which are just worth IMITATING as practice without certifying.
- [ ] **Adopt-anyway security practices:** the enterprise/gov-grade practices we should run regardless (TLS posture, key management, logging/audit trails, backups, access control, dependency scanning) — mapped against what we ALREADY do (Caddy auto-TLS, zero-WIF rule, vault, UFW, CrowdSec, preflight) so it's a gap list, not a rebuild.
- [ ] **Plain-English explainers for the operator:** start with "how SSL/TLS actually works" (and the fact our sites already have it automatically), then one-pagers per credential as they come up. These go in the operator-facing brief, front-end language only.
- [ ] READ-ONLY like the standards review — findings to operator first; no changes from this review itself.
