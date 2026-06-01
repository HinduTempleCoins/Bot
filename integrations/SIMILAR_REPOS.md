# Similar Repos + Improvements Survey

**Scope:** A "what's-out-there + what-we-could-borrow" survey for every major module
area of this repo. Researched 2026-06-01 via web search. **Strictly additive** — nothing
here proposes removing existing tech; every entry is a *pattern or library we could fold in
alongside* what we already run.

**Discipline carried over from the rest of `integrations/`:**
- Read-only / data / pattern value only. We do **not** sign or execute trades; broadcasting
  goes through MELEK-Signer, never a local WIF (`MELEK_SIGNER.md`, zero-WIF-on-host rule).
- Keyed services are provisioned separately (key → Server 4 vault), never into this repo.
- Confirm the live `LICENSE` file before vendoring any code — licenses below are recorded
  from each project's repo/docs at survey time and can drift.

**Companion docs already in this folder (don't duplicate — mine them):**
- `HIVE_STEEM_BOTS.md` — Graphene/HIVE RPC surface + libraries + bot refs.
- `CROSSCHAIN_BOTS.md` — Solana / Discord / cross-chain trading + community bots.
- `CROSSCHAIN_APIS.md` — read-only price/market/on-chain data across ~10 chains.
- `API_CATALOG.md` — the callable index (keyless wired vs keyed-by-name).

This file is the **repo-by-module** cut: it covers `integrations/`, `tools/`, `commands/`,
`cheetah/`, `witness/`, `tutorial/` + `welcomer/`, and `knowledge/scripture/`, with the
awesome-lists for each so we can mine links later.

---

## A. `integrations/` — read-only HIVE / HIVE-Engine + multi-chain market/price/arbitrage readers

> Heavily covered already in `HIVE_STEEM_BOTS.md`, `CROSSCHAIN_BOTS.md`, `CROSSCHAIN_APIS.md`.
> This section adds the **awesome-lists** (so we have the link-farms in one place) plus a
> few read-side patterns not already captured there.

### Awesome-lists to mine
| List | URL | License | Why mine it |
|---|---|---|---|
| **botcrypto-io/awesome-crypto-trading-bots** | https://github.com/botcrypto-io/awesome-crypto-trading-bots | CC0-1.0 | Categorized index: bot frameworks, TA libraries, market-data sources, exchange-API wrappers (CCXT et al.), charting. Mine the **market-data** and **exchange-API** rows for read-only price sources to add to `free-apis.mjs`. |
| **o-az/awesome-evm-indexer** | https://github.com/o-az/awesome-evm-indexer | (list) | EVM indexing tools/libraries — for read-only on-chain decode patterns when we extend `chain-explorer.mjs`-style readers to EVM chains. |
| **grandsmarquis/awesome-ethereum-analytics** | https://github.com/grandsmarquis/awesome-ethereum-analytics | (list) | Ethereum analytics projects — wallet-activity / P&L reconstruction patterns analogous to `tradebot-forensics.mjs`. |
| **starton-io/awesome-web3-tools-and-dapps** | https://github.com/starton-io/awesome-web3-tools-and-dapps | (list) | Broad Web3 tools/dApps incl. data APIs. |
| **royyannick/awesome-blockchain-mcps** | https://github.com/royyannick/awesome-blockchain-mcps | (list) | Blockchain/crypto **MCP servers** — AI-agent-facing on-chain read tools. Relevant once an AI consumes our readers as tools. |

### Comparable repos / borrowable patterns
| Repo | URL | What it does | License | Borrowable idea (additive) |
|---|---|---|---|---|
| **ccxt/ccxt** | https://github.com/ccxt/ccxt | Unified API over 120+ CEX/DEX (fetch ticker/order book/OHLCV). JS+Python+more. | MIT | A **normalization layer**: one shared shape for "ticker / order book / trade" across our many keyless sources, so `price-oracle.mjs` / `market-depth.mjs` callers don't special-case each exchange. Use its method *shape* as a template; we don't need the whole dep. |
| **freqtrade/freqtrade** | https://github.com/freqtrade/freqtrade | Full open-source trading bot (Python); strong **backtesting** + analytics. | GPL-3.0 (note: copyleft — patterns only, do not vendor into MIT/ISC code) | The **backtest/replay harness** idea: feed historical order books through our P&L logic to validate `sell-risk.mjs` / `market-scenarios.mjs` against what *would* have happened. Pattern, not code (GPL). |
| **hummingbot/hummingbot** | https://github.com/hummingbot/hummingbot | Market-making + arbitrage; 50+ CEX/DEX connectors. | Apache-2.0 | Its **connector abstraction** (one interface, many venues) is the clean version of what `chains/` is groping toward. Apache-2.0 is vendor-friendly if we ever want real code. |

---

## B. `tools/` — brief grader, annal ranker, citation checker, dataset curator

This is the strongest match area: the LLM-eval and RAG-citation ecosystems map almost
1:1 onto `brief-assess.mjs`, `annal-rank.mjs`, and `citations.mjs`.

### Awesome-lists to mine
| List | URL | License | Why mine it |
|---|---|---|---|
| **Vvkmnn/awesome-ai-eval** | https://github.com/Vvkmnn/awesome-ai-eval | (list) | Curated eval tools/methods/platforms — index for grader/ranker upgrades. |
| **hparreao/Awesome-AI-Evaluation-Guide** | https://github.com/hparreao/Awesome-AI-Evaluation-Guide | (guide) | Implementation-focused guide to evaluating LLMs/RAG/agents — methodology for `brief-assess.mjs`. |
| **kaushikb11/awesome-llm-agents** | https://github.com/kaushikb11/awesome-llm-agents | (list) | Agent frameworks — relevant when tools become agent-invoked. |
| **jihoo-kim/awesome-production-llm** | https://github.com/jihoo-kim/awesome-production-llm | (list) | Production LLM libs (eval, orchestration, serving). |

### Comparable repos / borrowable patterns
| Repo | URL | What it does | License | Borrowable idea (additive) |
|---|---|---|---|---|
| **confident-ai/deepeval** | https://github.com/confident-ai/deepeval | "Pytest for LLMs." Its **G-Eval** is the canonical *rubric-as-judge-prompt* with chain-of-thought structured grading on custom criteria. | Apache-2.0 | Restructure `brief-assess.mjs` scoring around a **G-Eval-style rubric**: explicit criteria → CoT reasoning step → numeric score, instead of an opaque single judgment. Borrow the rubric *shape* and the test-case object model. |
| **explodinggradients/ragas** | https://github.com/explodinggradients/ragas | RAG metrics: **faithfulness**, answer relevance, **context precision/recall**. | Apache-2.0 | "Faithfulness" = is every claim grounded in the cited source — exactly what `citations.mjs` wants. Adopt the **faithfulness decomposition** (split answer into atomic claims, check each against its source). |
| **promptfoo/promptfoo** | https://github.com/promptfoo | Local-first CLI for evaluating prompts/RAG/agents; **weighted assertions**, model-graded rubrics, regression detection, CI gating. | MIT | Add **regression tracking** to `annal-rank.mjs` / `brief-assess.mjs`: store prior scores, flag when a rewrite scores worse. MIT → safe to vendor pieces. The weighted-assertion rollup is a clean ranking model. |
| **rahulanand1103/rag-citation** | https://github.com/rahulanand1103/rag-citation | Auto-generates citations for AI content; offers a **fast non-LLM path** (spaCy NER + semantic similarity) and an LLM path. | MIT (per repo) | A **cheap deterministic citation check** for `citations.mjs` (NER + embedding similarity) before spending an LLM call — fits our keyless-first, cost-aware posture. |
| **llmware-ai/llmware** | https://github.com/llmware-ai/llmware | RAG toolkit incl. **source-citation verification** / evidence verification. | Apache-2.0 | The evidence-verification routine: map each sentence back to the supporting passage and score overlap — a ready model for "does this annal claim actually appear in the source doc." |

---

## C. `commands/` — deterministic `!command` menu (parser, registry, handlers)

Our Phase-2 menu is intentionally **no-LLM, deterministic**. The match here is lightweight
command-parsing libs and the *handler-registry* pattern from chat-bot frameworks — not the
heavy Discord stacks (which we'd only mirror structurally).

### Awesome-lists to mine
| List | URL | License | Why mine it |
|---|---|---|---|
| **discord-united/awesome-discord** | https://github.com/discord-united/awesome-discord | (list) | Open-source Discord bots — mine for **command-handler / registry** structure (slash-command routing tables) even though we're not on Discord. |
| **gillesheinesch/opensource-discordbots** | https://github.com/gillesheinesch/opensource-discordbots | (list) | Curated open-source Discord bots; site at gillesheinesch.github.io/opensource-discordbots. |
| GitHub topic: **slash-commands-handler** | https://github.com/topics/slash-commands-handler | n/a | Live topic feed of handler frameworks. |

### Comparable repos / borrowable patterns
| Repo | URL | What it does | License | Borrowable idea (additive) |
|---|---|---|---|---|
| **Cyral/Command-Parser** | https://github.com/Cyral/Command-Parser | Lightweight command-parsing library for chat-style apps (commands w/ typed params, defaults). | MIT (per repo) | A typed-argument / default-value model for `parser.js` — declare each command's params + types once, get validation + usage text free. |
| **dopsun/chatbot-cli** | https://github.com/dopsun/chatbot-cli | Template-trained command-line chatbot parser (input → command + params). | (check repo) | The **template → command** mapping as a way to accept fuzzy phrasings of a `!command` without an LLM (alias table / template match). |
| **discordjs command-handler templates** (topic) | https://github.com/topics/slash-commands-handler | Discord.js handler templates: per-command file, auto-registered into a registry, permission gates. | mixed (mostly MIT) | The **per-command file auto-loaded into `registry.js`** convention + a **permission/scope gate** per command — directly applicable to our `commands/handlers/` + `registry.js`. |

---

## D. `cheetah/` — content-attribution bot (text-detection, compose, store, policing)

The historical Steem Cheetah and modern plagiarism/attribution detectors are the lineage.
Per `CHEETAH_ADVANCED.md`, ours is **credit-first / discovery-first**, not punitive — so we
borrow detection/matching, not enforcement.

### Awesome-lists / topic feeds to mine
| List | URL | License | Why mine it |
|---|---|---|---|
| GitHub topic: **plagiarism-detection** | https://github.com/topics/plagiarism-detection | n/a | Live feed of detectors — mine for text-similarity + source-matching libs for `text-detection.js`. |
| GitHub topic: **fact-checking** | https://github.com/topics/fact-checking | n/a | Source-attribution + claim-matching projects. |
| GitHub topic: **moderation-bot** | https://github.com/topics/moderation-bot | n/a | Policing/queue patterns for `policing.md` (structure only — ours is non-punitive). |

### Comparable repos / borrowable patterns
| Repo | URL | What it does | License | Borrowable idea (additive) |
|---|---|---|---|---|
| **Kyle6012/plagiarism-detection** (a.k.a. meshackbahati) | https://github.com/Kyle6012/plagiarism-detection | Production-ready plagiarism + AI-content detection; **semantic** matching via pgvector + sentence-transformers; also AI-text detection. | MIT | The **semantic-similarity match path** (embeddings + vector store) for `text-detection.js` to find a *probable source* even when text was reworded — directly serves the "credit-first, here's the likely original" goal. |
| **arthurzaczek/OSPC** | https://github.com/arthurzaczek/OSPC | Open-source plagiarism checker; pairwise file similarity + report generation. | (check repo) | Its **report format** (here's the match, here's the overlapping span, here's a confidence) is a good template for what Cheetah `compose.js` emits — a *findings* object, not a verdict. |
| Steem **Cheetah** (anyx / @cheetah, historical) | https://steemit.com/steemit/@anyx/an-open-letter-to-the-steemit-community-on-content-plagiarism-and-the-cheetah-bot | The original nonbinding source-suggestion bot on Steem. | n/a (reference) | Design precedent: **nonbinding, suggests a source, no authority to punish** — exactly our `CHEETAH_ADVANCED.md` stance. Cite as lineage in `cheetah/README.md`. |

---

## E. `witness/` — Graphene block production, price feed, account creation/delegation

Closest matches are Graphene/Steem/Hive witness tooling and price-feed publishers. Note
the chain-side block production lives on its own VPS (`witness_node`), not in this repo —
so the borrowable parts are the **price-feed publisher** and **witness-monitoring** patterns,
which map to `feed-publisher.js` and `chain-reader.js`.

### Awesome-lists to mine
| List | URL | License | Why mine it |
|---|---|---|---|
| **ecency/awesome-hive** | https://github.com/ecency/awesome-hive | **CC0-1.0** | Hive frameworks/SDKs/tools incl. **witness tools** + "Witness Block Production Schedule" monitoring + price-feed/automation dApps. Primary witness-tooling index. |
| **openhive-network/awesome-hive** | https://github.com/openhive-network/awesome-hive | (list) | Official curated Hive resources (overlaps ecency's; cross-check both). |
| **graphene-foundation/blockchains** | https://github.com/graphene-foundation/blockchains | (info) | References to Graphene-family chains — useful for MELEK-as-Graphene parity. |

### Comparable repos / borrowable patterns
| Repo | URL | What it does | License | Borrowable idea (additive) |
|---|---|---|---|---|
| **dragosroua/steem-witness-toolbox** | https://github.com/dragosroua/steem-witness-toolbox | Node.js **price-feed publisher** for Steem witnesses: updates feed on an interval, manages witness props (account_creation_fee, max_block_size). | (check repo) | The **interval price-feed loop + witness-prop update** is exactly `feed-publisher.js`'s job. Borrow the loop structure + the "compute median from N sources, publish if drift > threshold" logic. (We publish via MELEK-Signer, not a local key.) |
| **holgern/beem** | https://github.com/holgern/beem | Mature Python lib for Hive/Steem; includes witness + feed helpers and broad RPC coverage. | MIT | Reference implementation for **every condenser/database RPC** we call in `chain-reader.js` — when an RPC's params are unclear, beem is the canonical source. (We stay Node/ESM; use it as the spec.) |
| **graphene-blockchain/graphenejs-ws** | https://github.com/graphene-blockchain/graphenejs-ws | Pure-JS websocket interface for Graphene (BitShares). | (check repo) | The **websocket subscribe** pattern for low-latency head-block / witness-schedule reads vs. polling — an upgrade path for `chain-reader.js` when MELEK's node exposes WS. |
| **ali-h/hive-bot** | https://github.com/ali-h/hive-bot | Simple real-time automation framework on Hive (stream blocks → trigger handlers). | (check repo) | The **block-stream → handler** dispatch shape is a clean model for a future witness-side "react to on-chain events" loop, keeping ours read-only. |

---

## F. `tutorial/` + `welcomer/` — staged onboarding (CryptoKannon-model) + welcomer surfaces

Our tutorial is a **staged state machine** (`stages.json`, `state.js`, `scheduler.js`); the
match is conversational FSM / flow frameworks. Welcomer = first-post-comment / transfer-memo
greeters — match is community-onboarding bot patterns.

### Awesome-lists / topic feeds to mine
| List | URL | License | Why mine it |
|---|---|---|---|
| GitHub topic: **chatbot-state-machine** | https://github.com/topics/chatbot-state-machine | n/a | FSM-driven conversation projects for the staged tutorial. |
| **CommunityOne-io/awesome-discord-growth** | https://github.com/CommunityOne-io/awesome-discord-growth | (list) | Tools/bots/playbooks for **growing communities** — onboarding + welcomer patterns. |

### Comparable repos / borrowable patterns
| Repo | URL | What it does | License | Borrowable idea (additive) |
|---|---|---|---|---|
| **dsullivan7/chatbot-flow** | https://github.com/dsullivan7/chatbot-flow | Framework for conversation state flow as an FSM. | (check repo) | A clean **state → allowed-transitions → next-prompt** model to validate `stages.json` transitions and prevent illegal stage jumps in `state.js`. |
| **jsz-05/LLM-State-Machine** | https://github.com/jsz-05/LLM-State-Machine | Conversational agents as an FSM + LLM: named states, prompt templates, transition rules from user input. | (check repo) | The **prompt-template-per-state** structure is the Phase-3 bridge: keep our deterministic stages, but attach a per-stage template so the same FSM can drive the conversational Witness later. Additive — Phase-2 stays no-LLM. |
| **google/bottery** | https://github.com/google/bottery | Syntax + editor + simulator for conversations modeled as FSMs. | Apache-2.0 | The **simulator** idea: a dry-run harness that walks a fake user through every `stages.json` path to catch dead ends before shipping — fits our `--dry-run`-against-fixtures rule. |
| **pipecat-ai/pipecat-flows** | https://github.com/pipecat-ai/pipecat-flows | Structured-conversation framework: predefined paths + dynamic flows, handles state + LLM calls. | BSD-2-Clause | Pattern for mixing **fixed stages with optional dynamic branches** — e.g., tutorial mostly fixed, but one branch adapts to what the user already did on-chain (read via our own readers). |

---

## G. `knowledge/scripture/` — verbatim canonical corpus + `_index.json`

Our corpus is plain Markdown + a JSON index. The match is the **Markdown-knowledge-base /
frontmatter-index / LLM-wiki** ecosystem — for *index validation* and *ingestion-delta*
patterns, not for reorganizing the verbatim docs (those stay canonical per BRIEF.md §2).

### Awesome-lists / reference to mine
| Source | URL | License | Why mine it |
|---|---|---|---|
| Karpathy **LLM Wiki** pattern | https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f | (gist) | The "AI reads any source, files it into a connected Markdown graph" pattern — the philosophy behind several tools below. |
| GitHub topic: **knowledge-base** / Obsidian ecosystem | https://github.com/topics/knowledge-base | n/a | Markdown-KB tooling feed. |

### Comparable repos / borrowable patterns
| Repo | URL | What it does | License | Borrowable idea (additive) |
|---|---|---|---|---|
| **blacksmithgu/obsidian-dataview** | https://github.com/blacksmithgu/obsidian-dataview | Query language over Markdown frontmatter + inline fields. | MIT | A **frontmatter query** model for `_index.json`: instead of hand-maintaining the index, derive it by querying frontmatter across `scripture/*.md` (author, date, source, journal). |
| **intellectronica/mdbasequery** | https://github.com/intellectronica/mdbasequery | CLI + lib to query Markdown-frontmatter bases (Obsidian-compatible). | (check repo) | A **CLI to regenerate / validate `_index.json`** from the docs' frontmatter — catches drift between a doc and its index entry. |
| **caffeinatedwes/markdown-frontmatter-mcp** | https://github.com/caffeinatedwes/markdown-frontmatter-mcp | MCP server querying Markdown by frontmatter (tags, dates). | (check repo) | If/when an AI consumes the corpus as a tool, this is the **read-only MCP** shape: query scripture by tag/date without loading every file. |
| **AgriciDaniel/claude-obsidian** | https://github.com/AgriciDaniel/claude-obsidian | Self-organizing Markdown second-brain; **CI runs frontmatter validation on every PR**. | (check repo) | The **CI frontmatter-validation step** — a GitHub Action that fails the PR if a scripture doc is missing required frontmatter or its `_index.json` entry. Pure guard-rail, touches nothing canonical. |
| **Ar9av/obsidian-wiki** | https://github.com/Ar9av/obsidian-wiki | AI-maintained Markdown wiki; **manifest tracks ingested files, computes delta** to process only new/changed. | (check repo) | The **ingest-delta manifest**: when the operator adds corpus docs, process only the new ones — directly serves the "many more docs incoming" plan (`sequencing-corpus-before-cryptology`). |

---

## Top 10 improvements to bring in (prioritized)

Ordered by value-for-effort against the current build phase. All additive; none remove
existing tech. "Pattern" = borrow the design; "vendor" = could pull MIT/Apache/BSD code.

1. **G-Eval-style rubric scoring in `brief-assess.mjs`** (from `confident-ai/deepeval`, Apache-2.0). Replace the opaque single judgment with explicit criteria → CoT reasoning → numeric score. Highest leverage: the grader is core to the brief pipeline and this is a near drop-in *pattern*.

2. **Faithfulness / claim-decomposition in `citations.mjs`** (from `explodinggradients/ragas`, Apache-2.0 + `llmware`). Split each annal/brief claim into atomic statements and verify each against its cited source — turns "has a citation" into "is actually supported."

3. **Cheap deterministic citation pre-check** (from `rahulanand1103/rag-citation`, MIT — NER + embedding similarity). Run the no-LLM path first in `citations.mjs`; only escalate to an LLM call on ambiguous claims. Fits keyless-first, cost-aware posture.

4. **Regression tracking for grader + ranker** (from `promptfoo`, MIT). Persist prior scores for `brief-assess.mjs` / `annal-rank.mjs`; flag when a rewrite scores *worse* than before. Catches the "Claude overrode good work" failure mode in code form.

5. **Semantic source-match path in `cheetah/text-detection.js`** (from `Kyle6012/plagiarism-detection`, MIT — embeddings + vector store). Find the *probable original* even when text was reworded — the heart of credit-first attribution.

6. **CI frontmatter validation for `knowledge/scripture/`** (from `claude-obsidian`). A GitHub Action that fails the PR when a scripture doc lacks required frontmatter or an `_index.json` entry. Pure guard-rail; touches nothing canonical.

7. **Ingest-delta manifest for the corpus** (from `Ar9av/obsidian-wiki`). Process only new/changed scripture docs as the operator adds "many more" — directly serves the deferred corpus-first sequencing.

8. **Interval price-feed publisher loop in `witness/feed-publisher.js`** (from `dragosroua/steem-witness-toolbox` + `holgern/beem` as RPC spec, MIT). Median-of-N keyless sources, publish only on drift > threshold, via MELEK-Signer (no local key). Concrete Phase-1 win.

9. **Ticker/order-book normalization layer for `integrations/`** (from `ccxt/ccxt` method *shape*, MIT). One shared "ticker / order book / trade" object across our many keyless sources so callers stop special-casing each exchange. Lowers the cost of adding the next price source.

10. **Tutorial FSM validator + dry-run simulator** (from `dsullivan7/chatbot-flow` + `google/bottery`, Apache-2.0). Validate `stages.json` transitions and walk a fake user through every path to catch dead ends before shipping — fits the dry-run-against-fixtures rule and sets up the Phase-3 per-stage-template bridge (`jsz-05/LLM-State-Machine`).

---

*Survey compiled 2026-06-01. Licenses recorded from each project's repo/docs at survey
time; verify the live `LICENSE` before vendoring. GPL/copyleft projects (e.g. Freqtrade)
are listed for **pattern** value only — do not vendor their code into this repo's
MIT/ISC-licensed tree.*
