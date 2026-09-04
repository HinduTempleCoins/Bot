# EVERYTHING LIST - All Known Action Items Across All Sources

**Generated**: 2026-02-23
**Purpose**: Complete inventory of every known task, TODO, planned feature, and action item found across the entire codebase, documentation, and cryptocurrency knowledge base.
**Status**: FOR REVIEW - Nothing has been added to the itinerary yet.

---

## SUMMARY

| Source | Items |
|--------|-------|
| A. Critical Bugs & Fixes (PROJECT_STATUS, BOT_AUDIT) | 16 |
| B. Trading Bot Gaps (BOT_AUDIT, TRADING_BOT_STATUS) | 18 |
| C. Discord Bot Completion (COMPLETION_SUMMARY, ITINERARY) | 14 |
| D. Infrastructure & Deployment (PLANNING_NEXT_STEPS, PROJECT_STATUS) | 12 |
| E. Knowledge Base & Data (ITINERARY, PLANNING) | 10 |
| F. Social Media & Automation (ITINERARY, MASTER_ITINERARY) | 11 |
| G. Token Launches & DeFi (MASTER_ITINERARY, crypto knowledge) | 22 |
| H. Platform & Marketplace Builds (crypto knowledge) | 12 |
| I. Blockchain & Mining (MASTER_ITINERARY, crypto knowledge) | 14 |
| J. Bot & AI Systems (crypto knowledge, code TODOs) | 15 |
| K. Governance, Legal & Community (crypto knowledge) | 12 |
| L. Cryptology Game & Education (crypto knowledge) | 10 |
| M. SoapBox.Community Infrastructure (ITINERARY) | 14 |
| N. Long-Term Vision (crypto knowledge) | 8 |
| O. Code-Level TODOs (in .js/.cjs/.py files) | 13 |
| **TOTAL** | **201** |

---

## A. CRITICAL BUGS & FIXES (Must Fix)

*Source: PROJECT_STATUS.md, BOT_AUDIT.md, PLANNING_NEXT_STEPS.md*

| # | Item | Source File | Status |
|---|------|-------------|--------|
| A1 | Fix Discord message length errors (truncate Gemini responses to 2000 chars) - index.js:916 and index.js:1381 | PROJECT_STATUS.md | Open |
| A2 | Fix undefined RS3 price data crash (add null checks) - index.js:1180 | PROJECT_STATUS.md | Open |
| A3 | Renew expired Google/Gemini API key | PROJECT_STATUS.md | Open |
| A4 | Fix vankush-price-pusher.cjs line 300-304 - hardcoded 0.00001 HIVE bid price, should look at existing buy orders | BOT_AUDIT.md | Open |
| A5 | Fix vankush-price-pusher.cjs spending 0.01 HIVE when user wants 0.00001 HIVE | BOT_AUDIT.md | Open |
| A6 | Investigate why nudge in vankush-market-maker.cjs "never worked" | BOT_AUDIT.md | Open |
| A7 | Fix hive-token-scanner.js reporting only 1 active token (wrong) - criteria too strict (MIN_24H_VOLUME: 50 HIVE) | BOT_AUDIT.md | Open |
| A8 | Fix vankush-trader.cjs - not integrated with health checker | BOT_AUDIT.md | Open |
| A9 | Verify trading bot is actually running on Google VM (TRADING_BOT_STATUS shows no orders from punicwax) | TRADING_BOT_STATUS.md | Open |
| A10 | Ensure MM_DRY_RUN=false on Google VM for live trading | TRADING_BOT_STATUS.md | Open |
| A11 | Create CURE sell orders manually to kickstart dead market | TRADING_BOT_STATUS.md | Open |
| A12 | Add rate limiting (10 messages/min per user) to Discord bot | PLANNING_NEXT_STEPS.md | Open |
| A13 | Implement daily knowledge base backup to GitHub | PLANNING_NEXT_STEPS.md | Open |
| A14 | Add suspicious activity logging to Discord bot | PLANNING_NEXT_STEPS.md | Open |
| A15 | Create emergency shutdown mechanism for Discord bot | PLANNING_NEXT_STEPS.md | Open |
| A16 | Add transaction logging to trading bots | PROJECT_STATUS.md | Open |

---

## B. TRADING BOT GAPS (Features requested but missing)

*Source: BOT_AUDIT.md, TRADING_BOT_STATUS.md, code TODOs*

| # | Item | Source File | Status |
|---|------|-------------|--------|
| B1 | Build Psychology Tracker Bot - watch WHO responds to price changes, track the "dance" | BOT_AUDIT.md | Open |
| B2 | Add Community Analysis - check HIVE.blog posts, Discord activity for buy support potential | BOT_AUDIT.md | Open |
| B3 | Add SELL logic - know when to take profits at peaks | BOT_AUDIT.md | Open |
| B4 | Add Testing Behavior - place tiny amounts (0.00001 HIVE TOTAL), wait, observe responses | BOT_AUDIT.md | Open |
| B5 | Add BUY WALL analysis to wall-analyzer.cjs (currently only does sell walls) | BOT_AUDIT.md | Open |
| B6 | Add Troll Bot Detection - identify and track troll bot patterns | BOT_AUDIT.md | Open |
| B7 | Add Bearwhale/Bull-Bear understanding - bot needs to understand it's in a WAR | BOT_AUDIT.md | Open |
| B8 | Add "The Dance" Logic - wait for others to bid, outbid them, repeat | BOT_AUDIT.md | Open |
| B9 | Add "Expect Losses" logic - understand dumps will happen, track when to re-engage | BOT_AUDIT.md | Open |
| B10 | Integrate all trading bots: trader + price pusher + psychology tracker working together | BOT_AUDIT.md | Open |
| B11 | Build Forex and Stock trading bots (Phase 2 expansion from bitcointalk_million_dollar_bitcoin.json) | ITINERARY.md / crypto knowledge | Open |
| B12 | Expand trading bot to more tokens (BBH, LEO, POB, etc.) | ITINERARY.md | Open |
| B13 | Build profit tracking system for trading bots | ITINERARY.md | Open |
| B14 | Build monitoring dashboard (web UI showing trades, balance, prices, budget) | PLANNING_NEXT_STEPS.md | Open |
| B15 | Implement buy order management (profit-trading-bot.cjs line 705) | Code TODO | Open |
| B16 | Compare actual profits vs SMA/BB/RSI predictions (profit-trading-bot.cjs line 755) | Code TODO | Open |
| B17 | Check actual arbitrage spread vs external exchanges (profit-trading-bot.cjs line 523) | Code TODO | Open |
| B18 | Implement automated BLURT selling (vankush-price-pusher.cjs line 522) | Code TODO | Open |

---

## C. DISCORD BOT COMPLETION

*Source: BOT_COMPLETION_SUMMARY.md, ITINERARY.md, PLANNING_NEXT_STEPS.md*

| # | Item | Source File | Status |
|---|------|-------------|--------|
| C1 | Deploy Discord bot to Railway with correct model | ITINERARY.md | Open |
| C2 | Connect Discord bot to knowledge base API (localhost:8765) | PLANNING_NEXT_STEPS.md | Open |
| C3 | Test all 50+ dialogue trees | BOT_COMPLETION_SUMMARY.md | Open |
| C4 | Add DeFi/SocialFi dialogue trees to Crypt-ology system | BOT_COMPLETION_SUMMARY.md | Open |
| C5 | Add vankush_tokens dialogue tree (explains Van Kush ecosystem) | BOT_COMPLETION_SUMMARY.md | Open |
| C6 | Add hive_ecosystem dialogue tree (HIVE/STEEM/BLURT forks) | BOT_COMPLETION_SUMMARY.md | Open |
| C7 | Add karma_merit dialogue tree (philosophical framework) | BOT_COMPLETION_SUMMARY.md | Open |
| C8 | Add siring_model subtopic (technical algorithm explanation) | BOT_COMPLETION_SUMMARY.md | Open |
| C9 | Add new dialogue trees: Hannibal Barca, Book of Jude, Mt. Hermon, ForkNote/CryptoNote, ComfyUI, KulaSwap | BOT_COMPLETION_SUMMARY.md | Open |
| C10 | Add interest categories: defi (0-100) and socialfi (0-100) | BOT_COMPLETION_SUMMARY.md | Open |
| C11 | Add conversation triggers for "merit", "karma", "charity", "curation" | BOT_COMPLETION_SUMMARY.md | Open |
| C12 | Add other Discord bots (Seto, MEE6, Wick, Guild.xyz for token-gated roles) | ITINERARY.md | Open |
| C13 | Set up AI backup systems (Gemini CLI + local LLM) for when Gemini API hits limits | MASTER_ITINERARY.md | Open |
| C14 | Add optional Google APIs (Search, Maps, YouTube) | ITINERARY.md | Open |

---

## D. INFRASTRUCTURE & DEPLOYMENT

*Source: PLANNING_NEXT_STEPS.md, PROJECT_STATUS.md, ITINERARY.md*

| # | Item | Source File | Status |
|---|------|-------------|--------|
| D1 | Deploy HIVE bots to Google Cloud VM (full setup: Node.js, PM2, env vars, monitoring) | PROJECT_STATUS.md | Partial |
| D2 | Update bots on Google VM (pull latest code, restart pusher-live) | ITINERARY.md | Open |
| D3 | Merge work from claude/update-todos-9iXhF branch into main | PLANNING_NEXT_STEPS.md | Open |
| D4 | Tag release as v1.0-trading-bot-live | PLANNING_NEXT_STEPS.md | Open |
| D5 | Set up proper logging and alerting (Datadog, Sentry, or similar) | PROJECT_STATUS.md | Open |
| D6 | Add unit tests and integration tests before deploying with real funds | PROJECT_STATUS.md | Open |
| D7 | Get Contabo VPS (~$5-7/month) for SoapBox.Community hosting | ITINERARY.md | Open |
| D8 | Set up Oracle Cloud free tier (24 GB RAM - password reset broken) | ITINERARY.md | Open |
| D9 | Create Van Kush Family GitHub organization | MASTER_ITINERARY.md | Open |
| D10 | Organize all GitHub repos (KulaSwap, ForkNote, Burn Mining, etc.) | MASTER_ITINERARY.md | Open |
| D11 | Set up IPFS/Arweave for permanent storage (books, NFT metadata, datasets) | MASTER_ITINERARY.md | Open |
| D12 | Build SMS/text message failsafe for controlling bots when no internet | MASTER_ITINERARY.md | Open |

---

## E. KNOWLEDGE BASE & DATA COLLECTION

*Source: ITINERARY.md, PLANNING_NEXT_STEPS.md*

| # | Item | Source File | Status |
|---|------|-------------|--------|
| E1 | Import Claude Code sessions into knowledge base (saves 99% tokens) | PLANNING_NEXT_STEPS.md | Open |
| E2 | Build email analyzer (connect to Gmail via IMAP, extract Van Kush Family mentions) | ITINERARY.md | Open |
| E3 | Build/expand web scraper for Sacred-Texts.com | ITINERARY.md | Open |
| E4 | Build/expand web scraper for Theoi.com (Greek mythology) | ITINERARY.md | Open |
| E5 | Build/expand web scraper for Project Gutenberg | ITINERARY.md | Open |
| E6 | Scrape forum posts (Bitcointalk, Reddit) | ITINERARY.md | Open |
| E7 | Create Van Kush Family events timeline from all sources | PLANNING_NEXT_STEPS.md | Open |
| E8 | Format all datasets as JSONL for AI training | ITINERARY.md | Open |
| E9 | Build Book Memory System (ChromaDB + Gemini Embeddings) for user's 607-page book | MASTER_ITINERARY.md | Open |
| E10 | Ingest books: "Our Calendar" (Packer), "Earths In Our Solar System" (Swedenborg) | MASTER_ITINERARY.md | Open |

---

## F. SOCIAL MEDIA & AUTOMATION

*Source: ITINERARY.md, MASTER_ITINERARY.md*

| # | Item | Source File | Status |
|---|------|-------------|--------|
| F1 | Install and set up n8n automation platform (self-hosted) | ITINERARY.md | Open |
| F2 | Build Telegram bot with price alerts, Crypt-ology, tip bot | MASTER_ITINERARY.md | Open |
| F3 | Build Slack bot for team collaboration | MASTER_ITINERARY.md | Open |
| F4 | Create Discord -> Twitter cross-posting workflow | ITINERARY.md | Open |
| F5 | Create Discord -> HIVE/STEEM/BLURT cross-posting workflow | ITINERARY.md | Open |
| F6 | Create scheduled posts (daily wisdom, weekly crypto summary) across platforms | ITINERARY.md | Open |
| F7 | Set up Twitter automation | ITINERARY.md | Open |
| F8 | Build social media bot distribution fleet (resteem/reblog bots, upvote bots, faucet bots) | crypto knowledge | Open |
| F9 | Build resteem/reblog bot network on HIVE | crypto knowledge | Open |
| F10 | Execute DogeCoin-style giveaway/faucet program for VKBT | crypto knowledge | Open |
| F11 | Build coordinated HIVE group voting strategy (systematic mutual upvoting) | crypto knowledge | Open |

---

## G. TOKEN LAUNCHES & DeFi

*Source: MASTER_ITINERARY.md, crypto knowledge base*

| # | Item | Source File | Status |
|---|------|-------------|--------|
| G1 | Deploy PUCO token on TRON (TRC20, 700M supply, 50% locked 900 days) | MASTER_ITINERARY.md | Open |
| G2 | Deploy PUTI token on Steem-Engine (1/min for 64 years, SCOT Bot) | MASTER_ITINERARY.md | Open |
| G3 | Fix and deploy DFB/DFC Burn Mining contracts on Polygon | MASTER_ITINERARY.md | Open |
| G4 | Deploy Burn Mining PoB smart contracts on Polygon | crypto knowledge | Open |
| G5 | Build KulaSwap AMM (PancakeSwap/SunSwap fork on TRON) | MASTER_ITINERARY.md | Open |
| G6 | Create Peggy bridge tokens (HIVE-Engine <-> Polygon <-> TRON) | crypto knowledge | Open |
| G7 | Deploy ERC-20 Van Kush token on Polygon | ITINERARY.md | Open |
| G8 | Create liquidity pools on QuickSwap (Polygon) | ITINERARY.md | Open |
| G9 | Build cross-chain bridges to Ethereum mainnet | ITINERARY.md | Open |
| G10 | Deploy SCOT Bot for PUTI token distribution on HIVE | crypto knowledge | Open |
| G11 | Build SMT-like system on HIVE-Engine | crypto knowledge | Open |
| G12 | Deploy multi-stake contracts (stake QUICK/MATIC to earn Van Kush tokens) | MASTER_ITINERARY.md | Open |
| G13 | Build VKRW (Van Kush Rewards Token) on TRON with Telegram bot | crypto knowledge | Open |
| G14 | Build "Reverse Satoshi" tokenomics model (Coin A massive -> burn for Coin B) | crypto knowledge | Open |
| G15 | Deploy Ethereum smart contracts via EIP-1167 minimal proxy cloning | crypto knowledge | Open |
| G16 | Build Loop Mining system (Token A staked to mine Token B, 20-year structure) | crypto knowledge | Open |
| G17 | Implement HIVE-Engine market making (use VKBT/MATIC profits to buy $SCRAP) | crypto knowledge | Open |
| G18 | Stake 1,000,000+ SCRAP for Terracore supply control | crypto knowledge | Open |
| G19 | Execute exchange listing outreach campaign (12 email addresses, 5 contact forms ready) | crypto knowledge | Open |
| G20 | Implement burn mechanics on VKBT and CURE tokens | crypto knowledge | Open |
| G21 | Launch MATIC token for rewards | crypto knowledge | Open |
| G22 | Build Access Credit token system (MINUTES - studio booth model) | crypto knowledge | Open |

---

## H. PLATFORM & MARKETPLACE BUILDS

*Source: crypto knowledge base, ITINERARY.md*

| # | Item | Source File | Status |
|---|------|-------------|--------|
| H1 | Build SoapBox marketplace (community commerce integrated with burn mining) | crypto knowledge | Open |
| H2 | Build CandleBox marketplace (digital goods) | crypto knowledge | Open |
| H3 | Build AKASHA integration (Ethereum-based decentralized social platform) | crypto knowledge | Open |
| H4 | Build Siring Model algorithm for curation | crypto knowledge | Open |
| H5 | Build precious metals / gold trading integration on HIVE | crypto knowledge | Open |
| H6 | Build Divine Mystical Expressions closed-loop economy (physical spell products for Punic tokens) | crypto knowledge | Open |
| H7 | Build "Global Beauty Economy" platform (matrifocal economy for women) | crypto knowledge | Open |
| H8 | Build "dAppsy" media platform | crypto knowledge | Open |
| H9 | Build DevTome revival (paid wiki model on HIVE with burn mechanics + AI quality auditing) | crypto knowledge | Open |
| H10 | Build COTS no-code token minting tools (anyone can create tokens without programming) | crypto knowledge | Open |
| H11 | Build convention center / stadium DEXs (vendors launch own tokens) | crypto knowledge | Open |
| H12 | Build Punic Wax Network (physical product tokenization / RWA) | crypto knowledge | Open |

---

## I. BLOCKCHAIN & MINING

*Source: MASTER_ITINERARY.md, crypto knowledge base*

| # | Item | Source File | Status |
|---|------|-------------|--------|
| I1 | Fork/clone Graphene social blockchain for Van Kush platform | crypto knowledge | Open |
| I2 | Build custom Condenser frontend (React.js) for own blockchain node | crypto knowledge | Open |
| I3 | Build Twitter clone on Graphene (short posts, retweets via reblog, voting) | crypto knowledge | Open |
| I4 | Build YouTube clone on Graphene (video hosting via IPFS/3Speak/DTube) | crypto knowledge | Open |
| I5 | Build Facebook clone on Graphene (groups-via-tags, rich content) | crypto knowledge | Open |
| I6 | Set up CryptoNote mining pool infrastructure (Forknote) | crypto knowledge | Open |
| I7 | Create Van Kush CryptoNote coin using Forknote | crypto knowledge | Open |
| I8 | Deploy production multi-node witness network (primary, backup, seed, RPC, frontend) | crypto knowledge | Open |
| I9 | Build witness/validator election system (DPoS, top 21 witnesses) | crypto knowledge | Open |
| I10 | Build VKAI blockchain (AI-friendly Steem/BLURT clone) | MASTER_ITINERARY.md | Open |
| I11 | Configure UFW firewall, key security, DDoS protection for production nodes | crypto knowledge | Open |
| I12 | Prepare for exchange listing (30+ days stable, multiple witnesses, block explorer, docs) | crypto knowledge | Open |
| I13 | Build public block explorer for custom chain | crypto knowledge | Open |
| I14 | Build Ethereum clone ("Akasha") for Van Kush ecosystem | crypto knowledge | Open |

---

## J. BOT & AI SYSTEMS

*Source: crypto knowledge, MASTER_ITINERARY.md, code TODOs*

| # | Item | Source File | Status |
|---|------|-------------|--------|
| J1 | Build Egregori/Tulpa AI model for community consciousness | crypto knowledge | Open |
| J2 | Build expert system bots (MYCIN-style if-then decision trees) | crypto knowledge | Open |
| J3 | Build Loop Investment strategy automation bot (dollar-cost averaging across token pairs) | crypto knowledge | Open |
| J4 | Build Neediness Weight analytics dashboard | crypto knowledge | Open |
| J5 | Build comparative blockchain analysis tools | crypto knowledge | Open |
| J6 | Build AI-powered content moderation bot for Graphene chain | crypto knowledge | Open |
| J7 | Build AI curation bot (monitor posts, analyze with AI, auto-vote/comment) | crypto knowledge | Open |
| J8 | Build Bazillion Beings-style evolving bot platform | crypto knowledge | Open |
| J9 | Build vote-timing prediction bot ("predict popular posts and earn STEEM") | crypto knowledge | Open |
| J10 | Fine-tune local LLM on Van Kush knowledge (Llama 3 8B / Mistral 7B / Gemma 2B) | MASTER_ITINERARY.md | Open |
| J11 | Build AI Angel character with ComfyUI (consistent character, expressions, poses) | MASTER_ITINERARY.md | Open |
| J12 | Build LLM-based content auditing for information density | crypto knowledge | Open |
| J13 | Build AI translation and multilingual validation system | crypto knowledge | Open |
| J14 | Check Hive.blog for project updates in intelligent trader (vankush-intelligent-trader.cjs:378) | Code TODO | Open |
| J15 | Track open orders and update profit when filled (vankush-intelligent-trader.cjs:476) | Code TODO | Open |

---

## K. GOVERNANCE, LEGAL & COMMUNITY

*Source: crypto knowledge base*

| # | Item | Source File | Status |
|---|------|-------------|--------|
| K1 | Implement Karma Merit System on Graphene blockchain (C++ code, 99-grade system) | crypto knowledge | Open |
| K2 | Launch DAO 3.0 governance framework (federalist model, Twelve Tribes archetype) | crypto knowledge | Open |
| K3 | Build Social Mining reward system (formalized content creation rewards) | crypto knowledge | Open |
| K4 | Write federalist blockchain governance paper ("competitive document") | crypto knowledge | Open |
| K5 | Establish legal framework for religious/community token protection (RFRA, RLUIPA) | crypto knowledge | Open |
| K6 | Establish Cryptocurrency 501(c)(3) educational organization with Caduceus branding | crypto knowledge | Open |
| K7 | Set up tax-exempt religious organization with FEIN | crypto knowledge | Open |
| K8 | Recruit Ambassadors on HIVE, STEEM, BLURT (curation team) | crypto knowledge | Open |
| K9 | Create press release template system for Eastern audiences | crypto knowledge | Open |
| K10 | Build Alchemical Mystery School (initiation system, Megarian Degrees) | crypto knowledge | Open |
| K11 | Build algorithmic reputation and DAO arbitration system | crypto knowledge | Open |
| K12 | Create meme/viral marketing campaign (learned from DogeCoin success) | crypto knowledge | Open |

---

## L. CRYPTOLOGY GAME & EDUCATION

*Source: crypto knowledge base*

| # | Item | Source File | Status |
|---|------|-------------|--------|
| L1 | Build ARG (Alternate Reality Game) quest system (multi-platform, Discord/HIVE/social) | crypto knowledge | Open |
| L2 | Build unified badge/rank achievement system (100+ achievements across all 34 files) | crypto knowledge | Open |
| L3 | Build lesson module delivery framework (130+ modules and 170+ quizzes already exist as JSON) | crypto knowledge | QUICK WIN |
| L4 | Launch bounty program for community engagement (token bounties for quests, content, recruiting) | crypto knowledge | Open |
| L5 | Build Atlas Earth integration (geo-tagged crypto quests) | crypto knowledge | Open |
| L6 | Build Terracore P2E strategy integration into curriculum | crypto knowledge | QUICK WIN |
| L7 | Build Cryptology game mini-games: "Egregore Builder", "FUD Fighter", "Cycle Surfer" | crypto knowledge | Open |
| L8 | Build town formation / crypto-town curriculum (solar mining, sustainable housing, governance) | crypto knowledge | Open |
| L9 | Build Minecraft server with AI-controlled NPCs (Van Kush themed, Crypt-ology quests) | MASTER_ITINERARY.md | Open |
| L10 | Build Splinterlands-style card game (Van Kush characters, blockchain trading, play-to-earn) | MASTER_ITINERARY.md | Open |

---

## M. SOAPBOX.COMMUNITY INFRASTRUCTURE

*Source: ITINERARY.md Phase 8*

| # | Item | Source File | Status |
|---|------|-------------|--------|
| M1 | Build SoapBox.Community landing page (Shroomery-style organism nav + CoinMarketCap data) | ITINERARY.md | Open |
| M2 | Set up Wiki.SoapBox.Community (MediaWiki install) | ITINERARY.md | Open |
| M3 | Configure Pywikibot and run on first knowledge folder (oilahuasca) | ITINERARY.md | Open |
| M4 | Generate initial 100+ wiki articles from knowledge base | ITINERARY.md | Open |
| M5 | Set up Forums.SoapBox.Community (MyBB install) | ITINERARY.md | Open |
| M6 | Build Pool.SoapBox.Community (CPU mining pool, CryptoNote/ForkNote) | ITINERARY.md | Open |
| M7 | Build Wallet.SoapBox.Community (web wallet interface) | ITINERARY.md | Open |
| M8 | Build Vote.SoapBox.Community (Tomoyan-style delegation for HIVE/Blurt/Steem) | ITINERARY.md | Open |
| M9 | Build Swap.SoapBox.Community (AMM/DEX for internal token pairs) | ITINERARY.md | Open |
| M10 | Point DNS to Contabo VPS | ITINERARY.md | Open |
| M11 | Build VanKushFamily.com (roadmaps, whitepapers, official docs) | ITINERARY.md | Open |
| M12 | Set up Soapy.Blog (future Graphene chain frontend) | ITINERARY.md | Open |
| M13 | Set up self-advertising rotation (VKBT, Temple of Van Kush, Book of Tanit, mining pool) | ITINERARY.md | Open |
| M14 | Library of Ashurbanipal bot - implement article update detection (wikiGenerator.js:382) | Code TODO | Open |

---

## N. LONG-TERM VISION

*Source: crypto knowledge base*

| # | Item | Source File | Status |
|---|------|-------------|--------|
| N1 | Build solar-powered cryptocurrency mining town (25K residents, Earthship housing, geodome greenhouses) | crypto knowledge | Open |
| N2 | Build cloud mining operation (CryptoNight/CryptoNote on AWS/Azure VMs) | crypto knowledge | Open |
| N3 | Build Bitcoin imbued cold storage products (keys engraved in rings, swords, heirloom pieces) | crypto knowledge | Open |
| N4 | Organize cooperative gold mining operation (Ghana target) | crypto knowledge | Open |
| N5 | Build federated hub network (churches, bars, venues, libraries with local currencies) | crypto knowledge | Open |
| N6 | Establish Political Action Committee (PAC) for crypto-friendly local elections | crypto knowledge | Open |
| N7 | Build private cellular/wired-wireless mesh network for community independence | crypto knowledge | Open |
| N8 | Build business rules engine to encode community laws into software (algorithmic governance) | crypto knowledge | Open |

---

## O. CODE-LEVEL TODOs (In source files)

*Source: grep of .js, .cjs, .py files*

| # | Item | File:Line |
|---|------|-----------|
| O1 | Implement buy order management | profit-trading-bot.cjs:705 |
| O2 | Compare actual profits vs SMA/BB/RSI predictions | profit-trading-bot.cjs:755 |
| O3 | Check actual arbitrage spread vs external exchanges | profit-trading-bot.cjs:523 |
| O4 | Implement automated BLURT selling | vankush-price-pusher.cjs:522 |
| O5 | Check last trade time (recentActivity flag) | vankush-intelligent-trader.cjs:337 |
| O6 | Check Hive.blog for project updates | vankush-intelligent-trader.cjs:378 |
| O7 | Check BitcoinTalk rankings from Discord bot | vankush-intelligent-trader.cjs:379 |
| O8 | Check staking APR | vankush-intelligent-trader.cjs:380 |
| O9 | Check community size | vankush-intelligent-trader.cjs:381 |
| O10 | Track open orders and update profit when filled | vankush-intelligent-trader.cjs:476 |
| O11 | Track sell orders and update when filled | vankush-intelligent-trader.cjs:553 |
| O12 | Trade for profit when opportunities exist / Buy tokens to stake if healthy | vankush-intelligent-trader.cjs:594-595 |
| O13 | Implement article update detection in wiki generator | library-of-ashurbanipal-bot/src/wikiGenerator.js:382 |

---

## QUICK WINS (Can start immediately, minimal effort)

These items have content or infrastructure already in place:

1. **L3** - Build lesson module delivery framework (130+ modules and 170+ quizzes already written as JSON in knowledge base)
2. **K4** - Write federalist blockchain governance paper (content already in federalism_vs_anarchy_blockchain.json)
3. **F10** - DogeCoin-style faucet bot for VKBT (simple Discord bot faucet)
4. **L6** - Terracore P2E curriculum integration (game already exists, just needs wrapping)
5. **G19** - Exchange listing outreach (12 email addresses and 5 contact forms already compiled)
6. **E1** - Import Claude Code sessions into knowledge base (scripts already built)
7. **C2** - Connect Discord bot to knowledge base API (API already running on port 8765)

---

## ITEMS THAT ARE DUPLICATED IN ITINERARY BUT NOT DONE

These exist in both ITINERARY.md and MASTER_ITINERARY.md as checked/marked items but evidence suggests they're incomplete:

1. Trading bot "deployed" but TRADING_BOT_STATUS.md shows no open orders
2. "First CURE trade executed" but no evidence of it on-chain
3. Discord bot "95% complete" but critical bugs remain (A1, A2, A3)
4. Knowledge base "operational" but not connected to Discord bot yet

---

## NEW PHASES NEEDED (Don't fit existing 12-phase structure)

1. **RWA / Physical Assets Phase** - Punic Wax tokenization, gold certificates, imbued cold storage, gold mine
2. **Federated Hubs Phase** - Church/venue/library blockchain hubs with local currencies
3. **Legal Framework Phase** - RFRA protection, competitive governance document, 501(c)(3), FEIN
4. **Political/Community Phase** - Local elections, town formation, PAC operations
5. **Solana Phase** - Solana sniper bot (mentioned in PROJECT_STATUS.md as low priority)

---

*This is EVERYTHING found across 7 documentation files, 34 cryptocurrency knowledge JSON files, and 13 code-level TODOs. Total: 201 items.*
