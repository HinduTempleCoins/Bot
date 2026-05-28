# Van Kush Projects - Complete Itinerary

**Start Date**: 2026-01-09
**Last Updated**: 2026-01-10 (6:20am)
**Most Recent Addition**: 2026-05-28 — MELEK Witness + resident AI ensemble + Cheetah + corpus + sprint mode (new section below; original content preserved).
**Status**: Trading Bot LIVE ✅ (executing real trades on HIVE-Engine), Knowledge Base READY ✅, Discord Bot 95% done
**Status 2026-05-28 addition**: MELEK AI Witness operational scaffolding shipped ✅, Phase 1 chain launch pending.

---

## 🆕 UPDATE 2026-05-28 — MELEK Witness + resident-AI ensemble

The Bot Repo's scope grew significantly between 2026-01 and 2026-05. This section captures what was added; the original January itinerary continues below.

### Platform phases (operator-locked 2026-05-28)

| phase | content | status |
|---|---|---|
| **Phase 1** | MELEK Graphene chain + the AIs (resident AI, Hathor, Cheetah) + SoapBox-as-a-MELEK-app + community/forum + SSO signer | **current** |
| **Phase 2** | PRANA (EVM value/compute chain) + deploy/token factory + AMM + GPU compute + DeFi tools | future |
| **Phase 3** | Full operation: analytics/tribunal, marketplace, mobile, browser extension, conversational Witness | future |
| **Phase 4** | SOAP launches as its own Graphene chain into the live ecosystem | future |
| **Security/Signer** | Hot+cold signer, KMS-wrapped keys, policy engine, watcher — separate private repo | parallel |

**Phase 1 internal sequence:** resident AI ✅ → Cheetah ⏳ → Hathor on Discord ⏳ → MELEK chain launch ⏳ → AI connects to Condenser ⏳ → website goes up.

### Resident AI ensemble (shipped 2026-05-28)

- **resident-AI-host (Server A)** — resident AI VM at `REDACTED-HOST`. Ollama + qwen2.5-coder:1.5b + Qdrant index + briefd HTTP service + autonomous loop (brief-generator, annals-writer, code-walker, brief-lifecycle, reindex-repo). Sprint mode active for ~2 weeks.
- **tiny-LLM-host (tiny-LLM)** — smaller VPS at `REDACTED-HOST`-equivalent (TBD). Ollama + smollm2:360m. Writes annal bodies (signed `tiny-LLM-host`), fast brief summaries for operator on return.
- **(planned) reviewer-host** — Oracle ARM A1.Flex 4-8GB. DeepSeek-Coder 1.3B or 6.7B. Coding-quality reviewer, conversation with tiny-LLM produces MoM, 12h CST summary to Main Repo AI.
- **(planned) Server B** — host server for Bot runtime + MELEK chain + condenser. Admined by Server A over SSH.
- **(planned) signer VPS** — MELEK-Signer service, KMS-wrapped keys. Zero WIF on Bot host.
- **(planned) watcher VPS** — read-only chain observer, alerts on sensitive ops.

### Data artifact layers

- Briefs (working memory, three-part, bounded retention) → `<DATA_DIR>/briefs/` on resident-AI-host
- Annals (long-form per-subject reference, tiny-LLM writes bodies + Main Repo AI appends signed Notes) → `<DATA_DIR>/annals/`
- Long-term notes (one-line takeaways distilled from briefs before deletion) → `<DATA_DIR>/notes/`
- Per-file archive (one record per repo file with purpose / work_items / finished_items) → `<DATA_DIR>/archive/files/`
- Itinerary (this file + MASTER_ITINERARY.md) — shared backlog, AI proposes updates via briefs

### Cheetah build status (sibling bot to Hathor)

- ✅ Spec — `CHEETAH_ADVANCED.md`
- ✅ Steps 1-3 deterministic code shipped: `cheetah/text-detection.js`, `compose.js`, `store.js`, `config.js`, `index.js` orchestrator + CLI
- ✅ Deploy runbook `cheetah/DEPLOY_ORACLE.md` + one-paste `cheetah/bootstrap-oracle.sh`
- ✅ Policing scope `cheetah/policing.md` (CSAM + illegal content; gated on PhotoDNA/NCMEC + counsel)
- ⏳ Oracle box provisioned 2026-05-28 (IP `REDACTED-HOST`, user `opc`); awaits VCN port 22 ingress rule for SSH access
- ⏳ Step 4 (resolution flow with Hathor) — gates on Phase 3
- ⏳ Step 5 (discovery mode) — Phase 2 deterministic but lower priority
- ⏳ Step 6 (image detection) — last, hardest

### Hathor on Discord — MERGE framing

The existing `van-kush-discord-bot` at repo root + `hive-trading-bot.js` + `library-of-ashurbanipal-bot/` + `cryptology-kb-integration.js` are NOT separate from Hathor. They MERGE into the unified Hathor character (CHARACTER.md + BRIEF.md + scripture corpus). The Discord setup, Gemini wiring, Hive RPC code, MediaWiki publishing all become Hathor's surfaces.

**Library of Asherbanipal** (identified 2026-05-28): synthesizes wiki articles via Gemini, publishes to MediaWiki at `http://REDACTED-HOST/wiki`. Needs `GEMINI_API_KEY` + `WIKI_BOT_USERNAME` + `WIKI_BOT_PASSWORD` to be deployed somewhere.

### Datasets corpus (the AI's brain)

Expanded 2026-05-28 from 2 operator JSONLs (~60KB) to **3,500+ files / ~50MB** of openly-licensed reference content:
- `datasets/cookbooks/` — Anthropic + OpenAI + LangChain (MIT)
- `datasets/hive-devportal/` — 292 Graphene-family JS/PHP tutorials (MIT)
- `datasets/chain-libs/dhive/` — dhive client docs (Apache 2.0)
- `datasets/crypto-protocols/` — EIPs, BIPs, Lightning BOLT, Monero research, CryptoNote, devp2p
- `datasets/crypto-books/` — Mastering Bitcoin + Mastering Ethereum (CC-BY-SA-4.0, full books)
- `datasets/ml-libs/` — Hugging Face Transformers docs + HF blog (English only)
- `datasets/ml-courses/` — Microsoft AI-for-Beginners + ML-for-Beginners (English only)

**Still wanted:** BitcoinTalk threads (Headless Bitcoin + sidechain), operator's published research papers (Heterosis AJBSR, Mythology-as-Genealogy CAU), operator's @marsresident / @punicwax Steem posts.

### Sprint mode (2026-05-28 → ~2026-06-11)

The AIs run budget-loop runners (~45-min budget per tick on tiny-LLM-host, ~25-min on resident-AI-host code-walker). Volume over perfection — the 30-min editor's-note revisor refines later. Streaming-to-disk so partial output survives cutoffs (`.partial` files are debug signal, not loss).

### Multi-AI architecture (3-AI ensemble — DeepSeek planned)

Once DeepSeek lands:
1. Tiny-LLM writes annal → alerts DeepSeek
2. DeepSeek reads annal + repo, gives coding advice
3. Tiny-LLM + DeepSeek converse (why / advice) → MoM appended to annal
4. Every 12h CST (UTC 06+18), DeepSeek summarizes to Main Repo AI → fuels next briefs

### Kurdish-language committee (Phase 3 — operator priority)

All AIs participate (resident AI + tiny-LLM + Qwen language tier + DeepSeek + planned multilingual specialists like NLLB-200, Aya Expanse). Register-aware: dialect (Kurmanji / Sorani / Pehlewani-Zaza-Gorani) + register (religious / scholarly / business / colloquial / literary). Analog: "Spanish for Church vs Spanish for Businesses."

### What's gated on operator-side action

- Oracle box VCN port 22 ingress rule (so I can SSH and run bootstrap)
- Server B provisioning (host server for Bot + chain + condenser)
- Hetzner ID verification (fallback for various roles)
- DeepSeek box (Oracle ARM A1.Flex 4-8GB)
- Operator repos list (multi-repo indexing)
- Cheetah web search backend choice (Google CSE / Serper / DDG / none)
- AWS account + KMS verification (for MELEK-Signer)
- Cloudflare DNS (`melek.salon` + `vankushfamily.com`)
- RunPod credit (later GPU work)

### Reference docs added 2026-05-28

- `MELEK_SIGNER.md` — key custody architecture (zero WIF on Bot host)
- `BRIEF_PROTOCOL.md` — resident AI ↔ Claude Code protocol
- `CHEETAH_ADVANCED.md` — full sibling-bot spec
- `cheetah/policing.md` — CSAM + illegal-content scope, gating
- `.local/ARCHITECTURE_OVERVIEW_2026-05-28.md` — AI-facing comprehensive map (private)
- `.local/CURRENT_PRIORITIES_2026-05-28.md` — what every brief should serve (private)
- `.local/CONVERSATION_2026-05-28_SYNTHESIS.md` — operator's load-bearing statements (private)
- `.local/MULTI_AI_ARCHITECTURE_2026-05-28.md` — 3-AI ensemble + DeepSeek plan (private)
- `.local/RIGHT_NOW_2026-05-28.md` — 10-point action list (private)

---

## ⬛ Original January 2026 itinerary continues below

**Rule (operator-locked 2026-05-28):** Itinerary items are NEVER removed, only ADDED. Everything in the original section below remains active. The 2026-05-28 section above ADDS the MELEK Witness + resident-AI ensemble track alongside, not in replacement of, the trading-bot + knowledge-base work. The resident AI analyzes trade-bot data and drafts improvements (additive); it does not trade.

---

---

## 🎯 CURRENT PRIORITIES

**COMPLETED THIS SESSION** ✅:
1. Complete HIVE-Engine trading bot system
2. Wall analyzer with smart buy/sell detection
3. Holder distribution tracking
4. Market psychology metrics
5. Price pusher bot (patient strategy)
6. BLURT capital protection logic
7. Staking APR analyzer
8. Coinbase Wallet integration architecture
9. Trading bot deployed to Google VM ✅
10. Capital manager with 3-tier strategy (VKBT/CURE premium, BLURT fuel, BBH/POB tradeable) ✅
11. HIVE posting bot for daily VKBT/CURE marketing ✅
12. Added HIVE SMT ecosystem plan (build own token/DEX on HIVE blockchain) ✅
13. Added Polygon cross-chain token launch plan (before HIVE SMT) ✅
14. Knowledge base system with dual purpose (Claude Code context + Discord bot knowledge) ✅
15. Web scraping infrastructure (Sacred-Texts, Theoi, crypto news) ✅
16. Curation tool with auto-sanitization (protects HIVE keys) ✅
17. Knowledge base API on port 8765 for Discord bot queries ✅
18. Trading bot LIVE with first CURE buy executed (0.0001 HIVE spent) ✅
19. Fixed CURE paper wall detection (now checks both costUSD AND currentPrice) ✅
20. Fixed CURE target price (0.001 → 1.0 HIVE for 1:1 parity minimum) ✅
21. Competitive bidding system with gradual outbidding (0.00000010 HIVE increments) ✅
22. Troll bot protection (5% max price increase per session, 6h cooldown) ✅
23. Intelligent trading bot with portfolio management (vankush-intelligent-trader.cjs) ✅
24. Health-based stake/sell decision system (analyzes ALL tokens dynamically) ✅
25. Gift processing from @KaliVanKush with strategic selling ✅
26. High-value selling strategy (place at top of market, wait for buyers) ✅
27. Integration ready for VanKushBLURTDelegation curation/delegation bot ✅

**NOTE**: Hashtag/voting resources provided (altcoinstalks.com, bitcointalk.org) could not be fetched automatically (403/SSL errors). Will need manual information to build voting logic based on staked tokens.

**NEXT UP**:
1. ✅ DONE: Deploy trading bot - **LIVE on Google VM! First trade executed!**
2. ✅ DONE: Knowledge base system operational - **API running on port 8765**
3. ✅ DONE: Fixed CURE paper wall detection and target price
4. ✅ DONE: Added competitive bidding with troll bot protection
5. ✅ DONE: Created intelligent trader with portfolio management
6. Update bots on Google VM (pull latest code, restart pusher-live)
7. Optional: Deploy intelligent trader for portfolio management
8. Monitor live trading (24-48 hours, track all trades and costs)
9. Import this Claude Code session into knowledge base (save tokens for future)
10. Connect Discord bot to knowledge base API
11. Email & data extraction for AI training
12. Social media automation (n8n)

---

## ✅ PHASE 5: BLOCKCHAIN TRADING SYSTEM (COMPLETED!)

### 🚀 Delivered Components:

#### 1. **Core Trading Bots** ✅
- `vankush-price-pusher.cjs` - Smart VKBT/CURE price pushing
- `vankush-portfolio-tracker.cjs` - Real-time wallet monitoring
- `vankush-arbitrage-scanner.cjs` - Swap.* opportunity detection
- `vankush-market-maker.cjs` - General market making
- `hive-trading-bot.cjs` - General trading with BLURT protection

#### 2. **Analysis Modules** ✅
- `wall-analyzer.cjs` - Order book depth analysis
  * Calculate exact cost to push prices
  * Find affordable opportunities (< $2 USD)
  * Analyze buy/sell wall liquidity
  * Score opportunities by cost + health

- `holder-analyzer.cjs` - Token ownership distribution
  * Track 986 VKBT holders, 999 CURE holders
  * Calculate Gini coefficient (inequality measure)
  * Detect whale movements
  * Monitor distribution changes over time
  * Validate scarcity advantage (on-chain proof!)

- `psychology-tracker.cjs` - Market psychology metrics
  * Capture complete snapshots (price, holders, walls)
  * Compare trends over weeks/months
  * Track holder growth, floor rising, cost increases
  * Generate weekly reports
  * Assess strategy effectiveness

- `staking-analyzer.cjs` - Staking vs trading decisions
  * Estimate staking APR for tokens
  * Compare staking returns vs trading profits
  * Categorize tokens (stake BBH/DRIP, trade others)
  * Provide smart recommendations

#### 3. **API Integration** ✅
- `hive-engine-api.cjs` - Reliable curl-based wrapper
  * Fixed axios 404 issues
  * 100% reliable API calls
  * Supports all HIVE-Engine endpoints

#### 4. **Documentation** ✅
- `MARKET_PSYCHOLOGY_STRATEGY.md` - Complete economic model (359 lines)
- `STRATEGIC_ADVANTAGE.md` - Competitive analysis (499 lines)
- `PRICE_PUSHER_GUIDE.md` - Usage guide (560 lines)
- `DEPLOYMENT_GUIDE.md` - Setup instructions (574 lines)
- `COINBASE_INTEGRATION.md` - Future Coinbase Wallet bot (553 lines)
- `SESSION_SUMMARY.md` - Development summary
- `OPENROUTER_INTEGRATION.md` - Free AI alternative

### 🎯 Strategy Overview:

**Scarcity Economics** - Proven by on-chain data:
- VKBT: Only 1.9M tokens exist, 986 holders
- CURE: Only 55K tokens exist, 999 holders
- You control 44-58% (can't be dumped on!)
- Wide distribution (1000 people watching price!)
- At 1:1 HIVE: $579K and $16.7K market caps (SUSTAINABLE!)

**Patient Approach** - NOT pump & dump:
- Only push when affordable (< $2 USD)
- Micro-pushes (0.0001 HIVE) maintain anchoring
- Cooldowns prevent spam (6h major, 1h micro)
- Daily budget cap (35 HIVE/day)
- Track metrics over weeks, not days
- Self-sustaining by Month 3 (revenue > costs)

**Capital Protection**:
- BLURT = main fuel (PROTECT it with 1.4x threshold)
- Budget management prevents overspending
- Dry run mode for safe testing
- Market health checks skip dead markets

### 📊 Current Opportunities:

**VKBT** (Live Data):
- Cost to push to 0.001 HIVE: **$0.87 USD** ✅ AFFORDABLE!
- 986 holders, only 1.9M supply
- Market: ALIVE (21 trades/week)
- Ready to deploy!

**CURE** (Live Data):
- 999 holders, only 55K supply (EXTREME scarcity!)
- Market: READY TO PUSH (just need sell orders)
- Even MORE limited supply than VKBT

### 🔧 Deployment Status:

**Ready for Production**:
- ✅ All bots tested with live HIVE-Engine data
- ✅ Dry run mode available for safe testing
- ✅ Budget management and cooldowns protect capital
- ✅ Comprehensive documentation complete
- ✅ Holder distribution validated (on-chain proof)
- ✅ Market psychology metrics ready to track

**Next Steps**:
1. Deploy to Google VM or local PM2
2. Run price pusher in dry mode for 24 hours
3. Enable live trading with small budget ($2-5)
4. Monitor psychology metrics weekly
5. Adjust strategy based on holder growth

### 🌐 Future: Coinbase Wallet Integration

**Architecture Ready** (Month 3+):
- HIVE bot → Bridge → Coinbase Wallet bot
- Reuse wall analyzer, budget manager, psychology tracker
- Trade on Uniswap/Base with same logic
- Coordinate via shared database or API
- Transfer HIVE profits → USDC → ETH trading

**Timeline**:
- Month 1: Finish HIVE bot ✅ DONE
- Month 2: Add profit tracking
- Month 3: Manual bridge + Coinbase bot
- Month 4+: Full automation

---

## ✅ PHASE 5.5: KNOWLEDGE BASE SYSTEM (COMPLETED!)

### 🚀 Delivered Components:

#### 1. **Dual-Purpose Architecture** ✅
- **Claude Code Context**: Save conversation history for future sessions (99% token reduction!)
- **Discord Bot Knowledge**: Public information for user questions
- Separate JSONL files for each purpose
- Auto-categorization and indexing

#### 2. **Core Tools** ✅
- `knowledge-base.py` - Full-text search with keyword indexing
  * 533 keywords indexed across 13 categories
  * Full-text search with AND logic
  * HTTP API on port 8765 for Discord bot
  * Query formatting for bot responses

- `curate-knowledge.py` - Import conversations with security
  * Auto-sanitizes HIVE keys (5Jxxx...)
  * Removes API keys and sensitive data
  * Auto-categorizes content
  * Preview before saving

- `import-claude-code-session.sh` - Interactive import for Claude Code sessions
- `import-for-discord.sh` - Interactive import for Discord bot knowledge

#### 3. **Web Scraping Infrastructure** ✅
- `web-scraper.py` - Mythology and classic texts
  * Sacred-Texts.com support
  * Project Gutenberg support
  * Theoi.com (Greek mythology)
  * PDF extraction with PyPDF2

- `crypto-news-scraper.py` - Auto-updating crypto news
  * CoinTelegraph integration
  * Decrypt media integration
  * Last 48 hours filtering
  * Successfully tested: 61 articles fetched

#### 4. **Current Status** ✅
- ✅ 17 documents loaded (VKBT/CURE knowledge)
- ✅ 533 keywords indexed
- ✅ 13 categories organized
- ✅ API server running on port 8765
- ✅ All scripts executable and tested
- ✅ Security: datasets/ in .gitignore

#### 5. **Documentation** ✅
- `KNOWLEDGE_BASE_SETUP.md` - Complete guide (279 lines)
- `QUICK_START_KNOWLEDGE.md` - 5-minute setup (115 lines)
- `TWO_KNOWLEDGE_BASES.md` - Concept explanation (333 lines)

### 🎯 Benefits:

**Token Savings**:
- Before: Paste 50,000 tokens of context every session
- After: Query knowledge base (500 tokens query → 2,000 tokens result)
- **Savings**: 47,500 tokens per session (99% reduction!)

**Discord Bot Intelligence**:
- Before: Hardcoded responses
- After: Dynamic queries to knowledge base
- Can learn new info without code changes
- User-friendly formatted responses

**Security**:
- All datasets protected in .gitignore
- Auto-sanitization of HIVE keys
- API only on localhost (127.0.0.1:8765)
- Safe to import any conversation

### 📊 API Endpoints:

```
GET /search?q=query&category=optional&limit=10
GET /query?q=question (returns formatted bot response)
GET /stats (knowledge base statistics)
```

### 🔧 Ready for:
- ✅ Discord bot integration
- ✅ Future Claude Code sessions
- ✅ Auto-importing daily crypto news
- ✅ Expanding with user discussions

---

## PHASE 1: DISCORD BOT (Days 1-2) ✅ 95% COMPLETE

### ✅ Completed:
- [x] Bot code with all features
- [x] Gemini model fix (gemini-2.5-flash-lite)
- [x] Wikipedia integration
- [x] YouTube summarization
- [x] Image generation (Pollinations.ai)
- [x] Crypto price tracking (VKBT, CURE)
- [x] RS3 Grand Exchange prices
- [x] Proactive keyword monitoring
- [x] Natural language commands
- [x] Reply tracking
- [x] Welcome system (5 messages)
- [x] Scheduled posts (daily/weekly)
- [x] NPC conversation system (dialogue-flows.js)
- [x] Emotional relationship tracking (relationship-tracker.js)
- [x] OpenRouter AI integration (free Llama 4 Maverick)
- [x] Knowledge base expansion (BitcoinTalk history, crypto memes, VKBT/CURE lore)

### 🔨 To Complete:
- [ ] Deploy to Railway with correct model (or Google VM)
- [ ] Test all features working
- [ ] Add optional Google APIs (Search, Maps, YouTube)
- [ ] Add other bots to Discord (Seto, MEE6, Wick)
- [ ] Monitor for 24 hours to ensure stability

**Timeline**: Complete by end of Day 2

---

## PHASE 2: EMAIL & DATA EXTRACTION (Days 3-5)

### Goal: Create Van Kush Knowledge Database

### Project 1: Email Analysis System
**Tool**: Claude Code + Python

**What It Does**:
- Connects to Gmail via IMAP
- Searches for "Van Kush Family" mentions
- Extracts quotes and context
- Creates timeline of events
- Organizes by date/subject
- Exports to JSON/JSONL for AI training

**Deliverable**: `van_kush_emails_dataset.jsonl`

### Project 2: Web Scraper
**Tool**: Claude Code + Python/Firecrawl

**Targets**:
1. **Sacred-Texts.com**
   - Egyptian mythology
   - Pagan texts
   - Ancient wisdom

2. **Theoi.com**
   - Greek mythology
   - God/goddess information
   - Ancient stories

3. **Your Forum Posts**
   - Bitcointalk mentions (already partially extracted!)
   - Reddit posts
   - Other forums

**What It Does**:
- Respects robots.txt
- Rate limits (2 seconds between requests)
- Converts to JSONL format
- Uploads to GitHub: Van-Kush-Datasets repo
- Tags by source and date

**Deliverable**: `sacred_texts_dataset.jsonl`, `theoi_dataset.jsonl`, `forums_dataset.jsonl`

### Project 3: Robots.txt Blocked Sites
**Approach**:
1. Check if API available
2. Check if content on Archive.org
3. Manual extraction if small amount
4. Respect blocks if large/sensitive

**Timeline**: Complete by end of Day 5

---

## PHASE 3: SOCIAL MEDIA AUTOMATION (Days 6-8)

### Goal: AI-Powered Cross-Platform Presence

### Project 1: n8n Installation & Setup
**Tool**: Claude Code + n8n (self-hosted)

**What It Does**:
- Installs on Hostinger VPS or Google VM
- Creates workflows for:
  - Discord → Twitter cross-posting
  - Discord → Telegram forwarding
  - Blog posts → All platforms
  - Mention monitoring
  - AI-powered responses

**Free Integrations**:
- Twitter API (free tier)
- Telegram Bot API (unlimited)
- Discord Webhooks (built-in)
- RSS feeds (unlimited)

### Project 2: Angel Character Launch
**Goal**: Make AI Angel the face of Van Kush social media

**Steps**:
1. Generate consistent character with ComfyUI
2. Create character backstory/lore
3. Train AI on character personality
4. Launch across all platforms
5. Start posting as "her"

### Project 3: Platform Setup
**To Configure**:
- [ ] Telegram bot (Van Kush Family channel)
- [ ] Slack workspace (team collaboration)
- [ ] Twitter automation
- [ ] Facebook/Instagram (optional)

**Timeline**: Complete by end of Day 8

---

## PHASE 4: DISCORD ENHANCEMENTS (Days 9-12)

### Goal: Advanced Bot Features

### ✅ Already Completed:
- [x] NPC Conversation System (dialogue-flows.js)
- [x] Emotional Relationship Tracking (relationship-tracker.js)
- [x] Free AI integration (OpenRouter Llama 4 Maverick)
- [x] Knowledge base expansion

### 🔨 To Complete:

### Project 1: Security Features
**What It Adds**:
- [ ] Rate limiting (10 messages/min per user)
- [ ] Emergency shutdown (admin DM only)
- [ ] Daily knowledge base backup to GitHub
- [ ] Suspicious activity logging

### Project 2: More Bots Integration
**Add These**:
1. **Seto Chan** - Server architect
   - Creates channels/categories
   - Manages roles
   - Builds server structure

2. **MEE6** - Leveling & moderation
   - XP system
   - Auto-moderation
   - Custom commands

3. **Wick** - Advanced security
   - Anti-raid
   - Auto-ban
   - Verification system

4. **Guild.xyz** - Token-gated roles
   - VKBT holders get special access
   - Crypto wallet verification

**Timeline**: Complete by end of Day 12

---

## PHASE 6: AI TRAINING & FINE-TUNING (Weeks 5-6)

### Goal: Custom Van Kush AI

### Project 1: Dataset Preparation
**Combine All Sources**:
- ✅ BitcoinTalk history (extracted!)
- ✅ VKBT/CURE story and tokenomics (documented!)
- ✅ Crypto meme culture (knowledge base!)
- Email extracts (pending)
- Web scrapes (Sacred-Texts, Theoi) (pending)
- Forum posts (pending)
- Discord conversations (pending)

**Format**: Convert all to JSONL training format

### Project 2: Fine-Tune Tiny-LLM
**Options**:
1. **Llama 3 8B** (Best for local)
   - Fast inference
   - Runs on consumer hardware
   - Good quality

2. **Mistral 7B** (Alternative)
   - Similar performance
   - Different strengths

3. **Gemma 2B** (Lightest)
   - Fastest
   - Lower quality

**What It Learns**:
- Van Kush Family history
- Your writing style
- Spiritual concepts
- Crypto knowledge
- Trading strategy

**Deploy**: Self-hosted on Hostinger VPS or Google VM

**Timeline**: Complete by end of Week 6

---

## PHASE 7: BIG PROJECTS (Weeks 7+)

### These Are Long-Term Goals

### Project 1: AI-Friendly Blockchain (VKAI)
**What It Is**: Steem/BLURT clone modified for AI

**Features**:
- No CAPTCHA
- AI reputation system
- Bot creation tools
- AI-human collaboration spaces
- Native bot SDK

**Timeline**: 2-3 months (complex)

### Project 2: CryptoNote Blockchain
**What It Is**: Privacy coin using ForkNote

**Features**:
- Van Kush coin (VKGLD? VKAI?)
- Privacy transactions
- Mining-based distribution
- Fast setup (1-2 days)

**Timeline**: 1-2 weeks (simpler)

### Project 3: HIVE Ecosystem & Smart Media Token
**What It Is**: Build own token ecosystem on HIVE blockchain (NOT HIVE-Engine)

**Why**: Don't need to pay HIVE-Engine fees - build directly on HIVE blockchain

**Features**:
- Smart Media Token (SMT) on HIVE
- Own token distribution system
- Hashtag-triggered voting/rewards
- Staking mechanics with curation
- Potentially own DEX (like TribalDEX)
- Full ecosystem control

**Prerequisites**:
- [ ] Research HIVE Smart Media Token (SMT) protocol
- [ ] Study TribalDEX architecture
- [ ] Build voting logic based on staked tokens
- [ ] Implement hashtag triggers for token distribution
- [ ] Design tokenomics for Van Kush SMT

**Timeline**:
- After Polygon token (February/March)
- 1-2 months for full ecosystem

**Resources**:
- HIVE blockchain documentation
- SMT whitepaper
- TribalDEX source code
- Existing hashtag bot implementations

### Project 4: Cross-Chain Token Launch (Polygon Focus)
**What It Is**: Launch Van Kush token on Polygon (Ethereum L2)

**Why Polygon**:
- Low gas fees
- Ethereum ecosystem access
- Easy bridges to other chains
- Good DEX support (Uniswap, QuickSwap)

**Features**:
- ERC-20 token on Polygon
- Liquidity pools on QuickSwap
- Bridge to Ethereum mainnet
- Marketing to Polygon community

**Resources to Study**:
- NutBox.io model (cross-chain staking)
- Polygon token deployment
- Uniswap V3 integration
- Cross-chain bridges

**Timeline**:
- February (before HIVE SMT)
- 2-3 weeks for deployment and initial liquidity

### Project 5: ComfyUI Integration
**What It Is**: AI art generation via Discord

**Features**:
- `/generate` uses ComfyUI
- Consistent character generation
- Custom models/LoRAs
- High-quality output

**Timeline**: 1-2 weeks

### Project 6: Minecraft Server
**What It Is**: AI-controlled NPCs

**Features**:
- Van Kush themed world
- AI NPCs that chat
- Blockbench custom mobs
- Discord ↔ Minecraft bridge

**Timeline**: 2-3 weeks

---

## PHASE 8: SOAPBOX.COMMUNITY INFRASTRUCTURE (Target: March 2026)

### Overview
Full Web3 ecosystem for Van Kush Family research, cryptocurrency, and community.

### Domains Owned (on Hostinger - registrar only)

| Domain | Purpose |
|--------|---------|
| SoapBox.Community | Main landing + all subdomains |
| Soapy.Blog | Future Graphene chain (Phase 2) |
| VanKushFamily.com | Roadmaps, whitepapers, official docs |

### Subdomain Architecture

| Subdomain | Function | Software | Priority |
|-----------|----------|----------|----------|
| SoapBox.Community | Landing page (Shroomery-style organism nav, CoinMarketCap-style data) | Static/React | Phase 1 |
| Wiki.SoapBox.Community | Encyclopedia (DevTome-style with contributor rewards) | MediaWiki | Phase 1 - FIRST |
| Forums.SoapBox.Community | BB/PB style forum with token integration | MyBB (free) | Phase 1 |
| Pool.SoapBox.Community | CPU mining pool (CryptoNote/ForkNote) | ForkNote pool software | Phase 2 |
| Wallet.SoapBox.Community | Web wallet interface | Custom | Phase 2 |
| Vote.SoapBox.Community | Tomoyan-style delegation for HIVE/Blurt/Steem | Custom | Phase 2 |
| Swap.SoapBox.Community | AMM/DEX for internal token pairs | Custom | Phase 3 |

### Token Architecture (Multi-Chain)

| Token | Chain | Purpose |
|-------|-------|---------|
| ForkNote Coin | CryptoNote (CPU mineable) | Wiki rewards, base layer |
| SOAP | Graphene (Soapy.Blog) | DPoS social chain - Phase 2 |
| VKBT | HIVE-Engine | Existing token |
| Wrapped versions | Solana, Ethereum, Tron, BSC | Cross-chain presence |

**Core Mechanic: Burn Mining**
- Paywall/subscription content burns tokens
- Deflationary pressure across ecosystem
- Cross-chain burn-to-mint potential

### Hosting

**Contabo VPS (~$5-7/month)**
- Cloud VPS S or M
- 3-4 vCPU, 8GB RAM, 75-100GB NVMe SSD
- Ubuntu 22.04 or 24.04
- Unlimited traffic (fair use)
- Crypto-friendly ToS

**Why NOT Hostinger for Hosting**
- Hostinger ToS prohibits mining activity
- Keep domains there, hosting on Contabo

### Wiki Bot Architecture

**Knowledge Source**
- GitHub: github.com/HinduTempleCoins/Bot/tree/main/knowledge/
- 17+ Topic Folders (ai_technology, ancient_egypt, ayahuasca, consciousness, cryptocurrency, herbs, history, linguistics, media, mystery_schools, oilahuasca, phoenician, psychedelics, revolution, shulgin-pihkal-tihkal, and more)
- 160+ JSON files with structured research data

**Bot Pipeline**
```
GitHub JSON files
      ↓
Bot reads & processes (Python)
      ↓
Extracts: entities, facts, citations
      ↓
Generates MediaWiki markup
      ↓
Pywikibot pushes to wiki
      ↓
Auto-creates stub entries for linked terms
```

**Processing Options**
- Rule-based extraction (free, regex/templates)
- Claude Code (already have access, no extra cost)
- Claude API batches (later, ~$0.01-0.05 per article)

### Content Separation

| Platform | Content Type |
|----------|--------------|
| Wiki | Encyclopedia entries (short, factual, linked, cited) |
| VanKushFamily.com | Long-form research papers, deep articles |
| Forum | Discussion, announcements, community |
| Main Site | Data pages, stats, quick facts (CoinMarketCap style) |

### Topic Connection Web
```
Headcones/Beeswax → Herbs → Oilahuasca → Psychedelics → Ayahuasca
       ↓                                        ↓
   Extraction ← Marijuana ← Shulgin → History/Religion
       ↓                                        ↓
  Phoenicians → Mythology → Egypt → Zar → AI → Egregori
       ↑_____________________________________________↓
                    (full circle)
```
*"There are no 2 subjects" - everything connects.*

### Forum Software Decision

**MyBB (free)** selected over:
- XenForo ($160 license - no budget)
- Discourse (heavy, 2GB+ RAM needed)
- phpBB (weaker editor)

**MyBB features**:
- Built-in reputation system
- SCEditor WYSIWYG
- Good plugin ecosystem
- BB/PB style structure

### Phase 1 Deployment (By March 2026)

**Week 1: Foundation**
- [ ] Get Contabo VPS
- [ ] Point DNS (Wiki.SoapBox.Community)
- [ ] Install MediaWiki

**Week 2: Wiki Population**
- [ ] Configure Pywikibot
- [ ] Run bot on first folder (oilahuasca)
- [ ] Generate initial 100+ articles

**Week 3-4: Expand**
- [ ] Process remaining knowledge folders
- [ ] Set up main landing page skeleton
- [ ] (Optional) Forum setup

**Post-March**
- Mining pool deployment
- Multi-chain token deployments
- Full ecosystem integration
- AMM/DEX

### Self-Advertising Strategy

Rotate internal ads for:
- VKBT / Van Kush Beauty Token
- Temple of Van Kush (RS3 clan)
- Book of Tanit
- Mining pool
- Hathor-Mehit AI content

No external ads - like Ickonic on David Icke Forum.

### Long-Term Vision

**Goal**: Become THE authoritative source for:
- Oilahuasca theory
- Temple Culture Theory
- Punic wax / headcone research
- Allylbenzene metabolism
- Consciousness technology

**Strategy**:
- Google AI pulls from authoritative wikis
- Wikipedia editors cite well-structured sources
- Your definitions become THE definitions
- By 2035: Angelic AI infrastructure, not chatbots

### Immediate Next Steps (SoapBox)
1. Sign up for Contabo VPS (Ubuntu 22.04/24.04)
2. Share IP + credentials when provisioned
3. Run MediaWiki install script (~30-45 min)
4. Begin wiki population

*"There are no 2 subjects. Everything connects."*

---

## QUICK WINS (Anytime)

### These Can Be Done Quickly When Needed

**Document Management**:
- Organize tax documents with AI
- Extract W-2 data from photos
- Calculate deductions
- Format for tax software

**Content Creation**:
- Blog post drafts
- Social media content
- Email newsletters
- Community announcements

**Research**:
- Fact-checking
- Citation finding
- Timeline creation
- Summary generation

**Automation**:
- Email filtering
- Task scheduling
- Reminder systems
- Backup automation

---

## RESOURCES NEEDED

### Free Services (Already Have or Easy to Get):
✅ Railway (Discord bot hosting)
✅ Hostinger / Google VM (VPS for other projects)
✅ GitHub (code & dataset storage)
✅ Gemini API (1,000 req/day)
✅ OpenRouter (FREE Llama 4 Maverick)
✅ Pollinations.ai (unlimited art)
✅ Wikipedia API (unlimited)
✅ HIVE-Engine API (unlimited)
✅ Telegram Bot API (unlimited)

### Optional Free Tiers:
⚠️ Google Search API (100/day)
⚠️ Google Maps API (limited)
⚠️ YouTube API (10,000/day)
⚠️ Oracle Cloud (24 GB RAM free! - password reset broken)
⚠️ n8n (self-hosted free)

### Future Paid (When Needed):
❌ ComfyUI cloud hosting ($)
❌ High-speed Solana RPC ($)
❌ Domain names ($10-15/year)
❌ Premium AI models ($)

---

## SUCCESS METRICS

### Week 1:
- [x] Trading bot system complete
- [x] Wall analyzer working
- [x] Holder tracking validated
- [x] Market psychology metrics implemented
- [ ] Discord bot responding correctly
- [ ] All Discord features tested and working
- [ ] 24+ hours uptime
- [ ] Zero crashes

### Week 2:
- [ ] Email dataset created
- [ ] Web scraper running
- [ ] 1,000+ scraped documents
- [ ] All uploaded to GitHub
- [ ] Trading bot deployed (dry run)

### Week 3:
- [ ] n8n workflows active
- [ ] Cross-posting working
- [ ] Angel character launched
- [ ] Telegram bot live
- [ ] Trading bot live (small budget)

### Month 1:
- [ ] Discord bot fully enhanced
- [ ] All automation running
- [ ] 50+ active Discord users
- [ ] Social media presence growing
- [ ] VKBT/CURE holder count growing (track weekly)

### Month 2:
- [ ] Custom AI trained
- [ ] Blockchain monitoring active
- [ ] Trading bot self-sustaining (revenue > costs)
- [ ] 100+ Discord users
- [ ] VKBT/CURE price floors rising

### Month 3+:
- [ ] Coinbase Wallet bot integrated
- [ ] Major projects launched (VKAI, ComfyUI, etc.)
- [ ] 500+ Discord users
- [ ] Strong social media presence
- [ ] Self-sustaining community

---

## PRIORITY RANKING

**CRITICAL** (Do first):
1. ✅ Complete trading bot system ← **DONE!**
2. ✅ Deploy trading bot (live) ← **DONE! EXECUTING TRADES!**
3. ✅ Knowledge base system ← **DONE! API RUNNING!**
4. Monitor live trading (24-48 hours)
5. Connect Discord bot to knowledge base API
6. Import Claude Code sessions for token savings

**HIGH** (This week):
7. Test all Discord features with knowledge base
8. Email dataset extraction
9. Web scraper expansion (more sources)
10. Social media automation (n8n)
11. Monitor trading bot metrics daily (then weekly)

**MEDIUM** (This month):
8. Discord enhancements (security, rate limiting)
9. AI training with datasets
10. Expand trading bot (BBH, LEO, etc.)

**LOW** (Future):
11. Coinbase Wallet integration (Month 3+)
12. Big projects (VKAI, ForkNote, ComfyUI, Minecraft)

---

## NEXT IMMEDIATE STEPS

**Today** (Jan 10, 2026):
1. ✅ Finish trading bot - **COMPLETE!**
2. ✅ Deploy trading bot to Google VM - **LIVE!**
3. ✅ Knowledge base system operational - **API RUNNING!**
4. ✅ First CURE trade executed - **SUCCESS! (0.0001 HIVE)**
5. ✅ Update itinerary - **DONE!**
6. Monitor live trading bot (check logs every few hours)
7. Import this Claude Code session into knowledge base

**Tomorrow**:
1. Review first 24 hours of live trading (count trades, total spent)
2. Connect Discord bot to knowledge base API
3. Test Discord bot with knowledge queries
4. Start email dataset project

**This Week**:
1. Monitor trading bot daily (holder growth, floor rising, budget usage)
2. Import Claude Code sessions for token savings
3. Complete data extraction (emails, web scrapes)
4. Set up n8n automation
5. Launch Telegram bot
6. Weekly psychology report (Friday)

**Next 30 Days**:
1. HIVE curation automation system
2. Account automation + delegation rewards
3. Research HIVE SMT protocol
4. Plan Polygon token launch (February)

---

**Trading bot is LIVE and executing! Knowledge base ready for Discord bot! Let's monitor performance and continue with Discord enhancements.** 🚀
