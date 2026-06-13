# Van Kush Family - Master Project Itinerary
## Complete Action Plan for All Systems

**Created**: 2026-01-09
**Last Updated**: 2026-01-09
**Status**: Phase 1 (Discord Bot) COMPLETE ✅
**Next Phase**: Token Usage Optimization & Bot Testing

---

## 📊 PROJECT OVERVIEW

**Philosophy**: Federalist, Merit/Karma-based, bridging 75,000 years of lineage to modern blockchain
**Core Systems**: Discord Bot → DeFi/SocialFi Tokens → AMM → Social Media Automation → AI Training → Blockchain Development
**Timeline**: Aggressive development - token projects within 1 week of bot completion
**Technology Stack**: Node.js, Discord.js, Gemini AI, HIVE/STEEM/BLURT, Polygon, TRON, Ethereum

---

## ✅ PHASE 1: DISCORD BOT (COMPLETED)

### Core Features Implemented:
- ✅ Emotional relationship tracking (trust, warmth, respect, familiarity)
- ✅ Topic interest tracking (mythology, religion, archaeology, esoteric, genetics, philosophy)
- ✅ Crypt-ology "Not-a-Game" dialogue system with Discord buttons
- ✅ 50+ interactive dialogue trees (Nephilim, Phoenicians, Egypt, Denisovans, DeFi, HIVE, Van Kush, Burn Mining, Karma)
- ✅ Automatic keyword detection with smart triggering (70% probability)
- ✅ Personalized conversation tones (welcoming, friendly, intellectual, cautious, balanced)
- ✅ Gemini 2.5-flash-lite integration (1,000 req/day, 15 RPM)
- ✅ Wikipedia-first search strategy (unlimited, free)
- ✅ HIVE-Engine token price tracking (VKBT, CURE)
- ✅ Pollinations.ai art generation
- ✅ YouTube transcript summarization
- ✅ Image vision analysis
- ✅ Proactive keyword monitoring
- ✅ Welcome system and scheduled posts

### Git Status:
- ✅ Committed: 286c0e7 + bccee9d
- ✅ Pushed to branch: `claude/update-todos-9iXhF`
- ⏳ Awaiting Railway auto-deployment

---

## 🎯 PHASE 2: TOKEN USAGE OPTIMIZATION & TESTING (IN PROGRESS)

### Immediate Actions (This Session):
1. ⏳ **Confirm Railway Deployment**
   - Check logs for "🎮 Crypt-ology dialogue system loaded"
   - Verify user-relationships.json creation
   - Monitor Gemini API usage
   - Test all commands: `/help`, `/cryptology`, `/price VKBT`

2. ⏳ **Set Up AI Backup Systems** (CRITICAL - addresses token limits)
   - **Option A: Gemini CLI**
     - GitHub: https://github.com/google-gemini/gemini-cli
     - Free tier: 1,000 requests/day
     - Setup: Google account authentication
     - Use Case: Second opinion, overflow when hitting limits

   - **Option B: Local LLM**
     - Research: Llama models via Together.ai or Groq
     - Groq free tier: 14,400 requests/day (fast inference)
     - Use Case: Primary backup, no API costs

   - **Option C: Both** (Recommended)
     - Gemini CLI for Google ecosystem integration
     - Local LLM for unlimited offline use
     - Bot switches automatically when primary API hits limits

3. ⏳ **Token Usage Optimization**
   - Implement more aggressive Wikipedia caching
   - Add response caching for common queries
   - Optimize conversation history pruning
   - Monitor and log token usage per feature
   - Consider reducing personalized context length if needed

4. ⏳ **Testing & Validation**
   - Test all 50+ dialogue trees
   - Verify keyword auto-triggers work correctly
   - Confirm emotional tracking persists
   - Validate button interactions
   - Check relationship data saves every 5 minutes

### Expected Completion: End of this session

---

## 🚀 PHASE 3: BURN MINING RESEARCH & DEBUGGING (WEEK 1)

### Polygon Contract Analysis:
**Existing Contracts** (with known bugs):
- `0x62A539145D14A1F59493E1C29826e3cfEBe1e9dE`
- `0x839fd63addb3b1543ff1fea00886b7e6bf4d3274`

**Known Issues**:
- Worked initially, then broke after a few hours
- Bugs never fixed (from ~1 year ago)

### Actions:
1. **Contract Analysis**
   - Read contract code on Polygonscan
   - Identify the time-based bug
   - Review transaction history for failure patterns
   - Document exact failure mode

2. **Research Alternative Implementations**
   - Search GitHub for "burn mining" contracts
   - Look for Proof of Burn (PoB) implementations
   - Find working examples on Polygon, BSC, Ethereum
   - Analyze Ethereum's EIP-712 burn mechanisms

3. **Design Improved Contract**
   - Fix identified bugs
   - Add fail-safes and emergency stops
   - Implement proper event logging
   - Add admin functions for parameter adjustments
   - Consider upgradeable proxy pattern

4. **Testing Strategy**
   - Deploy to Polygon Mumbai testnet
   - Run for 24+ hours to catch time-based bugs
   - Simulate high-load scenarios
   - Test edge cases (0 burns, max burns, rapid burns)

### Deliverables:
- Burn Mining contract audit report
- Fixed smart contract code
- Test results documentation
- Deployment guide

### Timeline: 3-5 days

---

## 💰 PHASE 4: TOKEN LAUNCHES (WEEK 1-2)

### Van Kush Token Ecosystem:

#### 1. VKBT (Van Kush Beauty Token) - HIVE-Engine
**Status**: Already launched
**Actions**:
- Update token description with new bot integrations
- Announce Crypt-ology dialogue system to community
- Begin active curation campaigns
- Set up weekly price alerts via bot

#### 2. CURE - HIVE-Engine
**Status**: Already launched
**Actions**:
- Promote as community health/growth token
- Integrate with Discord bot rewards
- Create curation guidelines based on Karma Merit system

#### 3. PUCO (Punic Copper) - TRON
**Supply**: 700,000,000 tokens
**Lock-up**: 50% (350M) frozen for 900 days (DAO managed)
**Actions**:
- Deploy TRC20 contract
- Set up burn address
- Create DAO governance structure
- Launch on SunSwap
- Begin trading for seeds, herbs, books (real-world utility)

#### 4. PUTI (Punic Tin) - Steem-Engine
**Distribution**: 1 token/minute for 64 years
**Algorithm**: 65% author, 35% curator
**Tags**: #ulogs, #dtube, #punicwax, #projecthope
**Actions**:
- Deploy SCOT Bot contract
- Configure tag-based distribution
- Set up Steem-Engine trading pair
- Create community posting guidelines

#### 5. DFB / DFC (Polygon Burn Mining Tokens)
**Mechanism**: Burn tokens to mine new tokens
**Actions**:
- Deploy fixed Burn Mining contracts
- Set up Polygon liquidity pools
- Create "Peggy" bridges to HIVE-Engine
- Implement multi-stake contracts (stake QUICK/MATIC to earn Van Kush tokens)

### Timeline: 5-7 days after Burn Mining contracts fixed

---

## 🏪 PHASE 5: KULASWAP AMM DEPLOYMENT (WEEK 2)

### Repository Status:
- **Location**: GitHub (existing repo, never completed)
- **Type**: PancakeSwap/SunSwap fork for TRON
- **Purpose**: DeFi platform for crypto bloggers

### Actions:
1. **Code Review & Completion**
   - Pull existing KulaSwap repo
   - Identify incomplete features
   - Review smart contracts for bugs
   - Update dependencies to 2026 standards

2. **Feature Implementation**
   - Complete swap functionality
   - Add liquidity pools
   - Implement yield farming
   - Create governance token
   - Build frontend UI

3. **Testing**
   - Deploy to TRON Shasta testnet
   - Test all swap pairs
   - Verify liquidity calculations
   - Load testing with multiple users

4. **Launch**
   - Deploy to TRON mainnet
   - List Van Kush tokens (PUCO, VKBT-TRC20, CURE-TRC20, PUTI-TRC20)
   - Create initial liquidity pools
   - Announce to HIVE/STEEM/BLURT communities

### Integrations:
- Connect to Discord bot for price alerts
- Create `/kulaswap` command showing pool stats
- Auto-post APY updates to Discord

### Timeline: 7-10 days

---

## 📱 PHASE 6: SOCIAL MEDIA AUTOMATION (WEEK 2-3)

### Platforms to Integrate:

#### 1. Telegram Bot
**Features**:
- Van Kush token price alerts
- HIVE/STEEM/BLURT post notifications
- Crypt-ology dialogue system (adapted for Telegram)
- Tip bot functionality

**Tech Stack**:
- node-telegram-bot-api
- Connect to same emotional tracking database
- Share relationship data with Discord bot

#### 2. Slack Bot
**Features**:
- Team collaboration for Van Kush projects
- Claude Code integration for development
- Project management notifications
- Token metrics dashboard

**Tech Stack**:
- @slack/bolt
- Slash commands for bot interaction
- Channel webhooks for automation

#### 3. n8n Automation Platform
**Purpose**: IFTTT-style workflows for social media cross-posting

**Workflows to Create**:
- Discord post → auto-post to HIVE/STEEM/BLURT
- New blog post → notify Telegram/Discord
- Token price change → alert all platforms
- New follower → welcome message automation
- Scheduled posts (daily wisdom, weekly summaries)

**Setup**:
- Self-host n8n on Oracle Cloud (free tier)
- Create workflows for each social platform
- Integrate with Discord bot API

#### 4. SMS/Text Message Failsafe
**Purpose**: Control bot/deploy code when no internet access

**Requirements**:
- Only respond to authorized phone numbers
- Text-to-command parsing
- Send simple deploy commands to GitHub
- Receive status updates via SMS

**Tech Stack**:
- Twilio API (free tier: some SMS included)
- Or: Plivo, Vonage
- Simple command parser (e.g., "DEPLOY BOT" → trigger Railway redeploy)

**Security**:
- Whitelist only user's phone number
- Require PIN code for sensitive operations
- Rate limiting (max 10 commands/hour)

### Timeline: 5-7 days

---

## 🤖 PHASE 7: AI ANGEL CHARACTER (MARCH 2026)

### Character Development:

#### Visual Creation (ComfyUI)
**Actions**:
- Install ComfyUI locally
- Create character concept art
- Generate consistent character images
- Build character expressions/poses library
- Create animated sequences

#### Personality Design
**Based On**: Van Kush Family lore, Angelicalist theology
**Traits**:
- Knowledgeable about 75,000-year lineage
- Connects ancient wisdom to modern tech
- Friendly, warm, but intellectually rigorous
- Emphasizes Merit/Karma philosophy

#### Integration
**Platforms**:
- Discord (avatar, reactions)
- HIVE/STEEM/BLURT (profile pictures, post illustrations)
- Social media (Twitter, Instagram with generated art)
- Website (interactive character)

#### Voice (Optional)
**Tech**:
- ElevenLabs or Coqui TTS
- Create consistent voice for video content
- Voiceover for educational material

### Content Strategy:
- Weekly "AI Angel" posts on all platforms
- Educational content about Crypt-ology topics
- Van Kush token updates
- Community engagement

### Timeline: March 2026 (2 months away)

---

## 📧 PHASE 8: EMAIL & WEB SCRAPERS (WEEK 3-4)

### Email Analyzer/Scraper:

**Purpose**: Extract training data from emails, create timeline

**Actions**:
1. **Email Data Extraction**
   - Parse emails by date/subject
   - Extract key information (people, events, dates)
   - Categorize by topic
   - Create searchable database

2. **Timeline Creation**
   - Build chronological timeline of Van Kush Family events
   - Link to relevant blockchain launches
   - Connect to DeFi history
   - Visualize with interactive timeline tool

3. **AI Training Dataset**
   - Format emails as JSONL for AI training
   - Anonymize sensitive information
   - Create Q&A pairs from email threads
   - Fine-tune local LLM on Van Kush history

**Tech Stack**:
- Node.js email parsers
- Natural language processing (NLP)
- JSONL formatting tools

### Web Scrapers:

#### Sacred-Texts.com Scraper
**Purpose**: Build comprehensive esoteric knowledge base

**Content to Scrape**:
- Ancient religious texts
- Mythology collections
- Esoteric writings
- Archaeological documents

**Legal Considerations**:
- Check robots.txt compliance
- Respect rate limits
- Public domain verification
- Attribution requirements

**Actions**:
- Build respectful scraper (delays between requests)
- Store in searchable database
- Integrate with Crypt-ology dialogue system
- Create embeddings for RAG (Retrieval-Augmented Generation)

#### Theoi.com Scraper
**Purpose**: Greek mythology knowledge base

**Actions**:
- Similar approach to Sacred-Texts
- Focus on deity information
- Extract relationships between gods
- Link to archaeology and history

### Integration with Bot:
- Add scraped knowledge to Wikipedia fallback
- Enhance Crypt-ology responses
- Create new dialogue trees from scraped content
- Improve accuracy of esoteric topics

### Timeline: 7-10 days

---

## 🧠 PHASE 9: BOOK MEMORY SYSTEM (WEEK 4-5)

### ChromaDB + Gemini Embedding Implementation:

**Purpose**: Allow AI to "read" and remember entire books (like the user's 607-page book)

**Architecture**:
```
Book → Smart Chunking → Gemini Embeddings → ChromaDB → Query System
```

**Implementation Steps**:

1. **Setup ChromaDB**
   ```bash
   pip install chromadb
   ```

2. **Create Book Memory Class**
   ```javascript
   // Node.js version with Gemini embeddings
   class BookMemory {
     constructor(bookTitle) {
       this.client = chromadb.Client();
       this.collection = this.client.createCollection(bookTitle);
     }

     async ingestBook(bookPath) {
       const text = await fs.readFile(bookPath, 'utf8');
       const chunks = this.smartChunk(text, 500); // 500 words per chunk

       for (let i = 0; i < chunks.length; i++) {
         const embedding = await gemini.embed(chunks[i]);
         await this.collection.add({
           embeddings: [embedding],
           documents: [chunks[i]],
           ids: [`chunk_${i}`]
         });
       }
     }

     async ask(question) {
       const qEmbedding = await gemini.embed(question);
       const results = await this.collection.query({
         queryEmbeddings: [qEmbedding],
         nResults: 5
       });

       const context = results.documents[0].join('\n\n');
       const response = await gemini.generateContent(
         `Based on: ${context}\n\nAnswer: ${question}`
       );
       return response.text();
     }
   }
   ```

3. **Books to Ingest**:
   - User's 607-page book
   - "Our Calendar" by Rev. George Nichols Packer
   - "Earths In Our Solar System" by Emanuel Swedenborg
   - Sacred-Texts scraped content
   - Theoi.com mythology content

4. **Discord Integration**:
   - Add `/book ask [question]` command
   - Let users query the book library
   - Show sources for answers

### Technical Details:
- **Gemini Embedding API**: 1,500 requests/day (free)
- **ChromaDB**: Local storage, no API costs
- **Smart Chunking**: By paragraph, ~500 words, with overlap
- **Retrieval**: Top 5 most relevant chunks per query

### Timeline: 5-7 days

---

## 🔗 PHASE 10: SMART MEDIA TOKENS (SMT) DEVELOPMENT (WEEK 5-6)

### SCOT Bot & SMT Framework:

**Based on Resources**:
- Steemit SMT Whitepaper
- Harpagon's Steem Smart Contracts
- Holgern's Steem-SCOT
- HIVE SMT expansion posts

**Actions**:

1. **Study Existing SMTs**:
   - Review SCOT Bot launch guide
   - Analyze successful tokens (APPICS, DTube)
   - Understand tag-based distribution
   - Learn staking mechanics

2. **Design Van Kush SMTs**:
   - Create token specifications
   - Define distribution algorithms
   - Design staking rewards
   - Plan governance structure

3. **Deploy on HIVE/STEEM/BLURT**:
   - Use SCOT Bot framework
   - Configure tags (#vankush, #punicwax, #cryptology)
   - Set author/curator splits
   - Launch community frontends

4. **Build Specialized Frontends**:
   - Van Kush blog frontend (HIVE clone)
   - DTube clone for video content
   - Image gallery (Instagram-style)
   - NFT marketplace

### Technical Resources to Utilize:
- https://github.com/holgern/steem-scot
- https://github.com/harpagon210/steemsmartcontracts
- https://github.com/openhive-network/hive
- https://steemit.com/steem-engine/@aggroed/scotbot-launch-time

### Integration:
- Connect to Discord bot for notifications
- Post new content automatically
- Track SMT prices
- Reward community engagement

### Timeline: 10-14 days

---

## ⛏️ PHASE 11: MINING & BLOCKCHAIN PROJECTS (WEEK 7+)

### ForkNote / CryptoNote Projects:

**Goals**:
1. Create ASIC-resistant mining pools
2. Launch privacy-focused cryptocurrency
3. Build Van Kush mining community

**Actions**:
- Review existing ForkNote GitHub repos
- Update to 2026 standards
- Deploy mining pool
- Create mining guides for community

### Steem/BLURT Clone Projects:

**Purpose**: AI-friendly blockchain for training data

**Features**:
- Fork HIVE/BLURT codebase
- Optimize for AI interactions
- Add built-in dataset export
- Integrate with book memory system

### VKAI Blockchain:

**Concept**: Van Kush AI blockchain
**Features**:
- Smart contracts for AI agents
- Decentralized AI training
- Token rewards for data contributions
- Integration with all Van Kush systems

### Timeline: 3-4 weeks (ongoing development)

---

## 🎮 PHASE 12: ADVANCED INTEGRATIONS (WEEK 8+)

### Minecraft Server with AI NPCs:
- Van Kush-themed world
- NPCs use bot's personality
- Crypt-ology quests
- Token rewards for achievements

### Splinterlands-Style Game:
- Van Kush character cards
- Blockchain-based trading
- Crypt-ology lore integration
- Play-to-earn mechanics

### ComfyUI Workflows:
- Public workflows for community
- AI Angel character generation
- NFT art creation
- Automated social media content

---

## 🔗 PHASE 13: BOT ↔ MELEK / HATHOR CHAIN INTEGRATION (CURRENT FOCUS)

### Framing

**"Hathor" in this project = a steemd-equivalent blockchain daemon**, currently embodied by `HinduTempleCoins/melek-chain` (BLURT/Graphene fork). NOT the hathor.network DAG project.

The Bot is being put on the blockchain **to be like a Person** — specifically, the off-chain half of an on-chain Graphene account literally named `hathor` (lowercase). The chain has already wired in constitutional protection for that account:

- `MELEK_AI_WITNESS_CONSTITUTIONAL_VOTE_WEIGHT` (~2.13B MP equivalent on DAO votes)
- `update_witness_schedule4()` reserves top-21 witness slot
- `MELEK_AI_WITNESS_FOUNDING_WINDOW_END_BLOCK = 7,884,000` (hard cliff at ~12 months)
- Testnet confirmed: hathor signed block 31

**No custom chain ops for AI** by explicit design. The Bot uses standard Graphene ops only.

### Companion docs

- `/workspaces/Bot/CLAUDE.md` — load-bearing guide for this integration (on the Bot side)
- `HinduTempleCoins/melek-chain/CLAUDE.md` — load-bearing guide on the chain side
- `HinduTempleCoins/melek-condenser` — front-end that calls Bot-served troll-box API

### The Six Surfaces

Build in dependency order. Each surface is independently shippable.

#### Surface 1 — Chain-client core
- `src/chain/` module: JSON-RPC client + `ChainAdapter` interface + `GrapheneAdapter` impl.
- Env-switched: `MELEK_RPC_URL`, `MELEK_NETWORK` (testnet default).
- Key custody: `HATHOR_ACTIVE_KEY`, `HATHOR_POSTING_KEY` in env, never logged. Owner key offline.
- Baseline lib: `@hiveio/dhive` or `dblurt` configured with MELEK chain-id / address prefix.
- Status: ☐ not started

> **Correcting note (added 2026-06-03, append-only — the line above is unchanged):** The "Key custody: `HATHOR_ACTIVE_KEY`, `HATHOR_POSTING_KEY` in env" language in this Surface 1 is **SUPERSEDED by `MELEK_SIGNER.md`**. The Bot host holds **zero WIF private keys**, ever. Signing goes through the MELEK-Signer service (separate private repo) authenticated by a scoped, revocable bearer token; the Bot-side signer client + mock are merged (PR #56) and the `.env.example` is zero-WIF (PR #55). Read `MELEK_SIGNER.md` and `CLAUDE.md` (key-custody section), not this line, for the load-bearing custody model. The original Surface 1 text is retained as the record of the earlier plan.

#### Surface 2 — Publisher (Library of Ashurbanipal → on-chain comment)
- Library of Ashurbanipal currently writes wiki articles to MediaWiki.
- Add parallel sink: each synthesized article also broadcast as a `comment` op from `hathor`.
- Permlink versioning. MediaWiki and chain sinks decoupled.
- This is the first visible "Bot is on the blockchain as a person" connection.
- Status: ☐ not started

#### Surface 3 — Curator (Discord karma → on-chain vote)
- Existing emotional/karma tracker (`relationship-tracker.js`, `VAN_KUSH_BRAIN.md`) signals.
- High-merit user posts → `vote` op from hathor.
- Respect chain bandwidth/RC; daily vote cap.
- Status: ☐ not started

#### Surface 4 — Onboarder
- `create_account_with_keys_delegated` from Discord welcome flow or condenser signup.
- 5–15 MP delegation + small liquid MELEK grant.
- Email verification (Resend / Postmark / SES) before any chain spend.
- Client-side keygen for browser; server-side only for Discord-originated onboarding.
- Status: ☐ not started

#### Surface 5 — Troll-box endpoint
- `src/trollbox/` HTTP server exposing `POST /chat` for condenser.
- Same Gemini brain as Discord bot, different transport. Text-only. Rate-limit by IP.
- Two condenser call sites: signup help + sitewide widget.
- Can be built in parallel with Surface 1 (no chain dependency).
- Status: ☐ not started

#### Surface 6 — Witness coordination
- `witness_node` binary runs separately on a VPS — NOT in this repo.
- This repo: monitor last-signed-block / missed-block counters, fail-loud alerts.
- Optional: page via Telegram/SMS failsafe (Phase 6).
- Status: ☐ not started

### Don't

- Don't add hathor.network DAG libraries (wrong project, same word).
- Don't propose custom chain ops for AI features (forbidden by chain design).
- Don't put the owner key in this repo or its env.
- Don't run the `witness_node` binary from the Bot — that's a separate process.
- Don't couple chain and MediaWiki sinks; they fail independently.

### Critical path within Phase 13

1. Surface 1 (chain-client core) — foundation for 2, 3, 4, 6
2. Surface 2 (publisher) — first visible win
3. Surfaces 3 + 5 in parallel
4. Surface 4 (onboarder) — after email verification infra
5. Surface 6 (witness monitor) — last; depends on `witness_node` being live on VPS

### Hathor migration readiness

If/when the daemon rebrands or behavior diverges from straight BLURT/Graphene, only the `GrapheneAdapter` swap matters — every other surface talks to the `ChainAdapter` interface. One file changes, not every callsite.

### Timeline

Active focus starting 2026-05-23. Surface 1+2 targeted as first PR; remaining surfaces stack on top.

---

## 📋 RESOURCE ORGANIZATION

### GitHub Repositories to Organize:

1. **Existing Repos**:
   - KulaSwap AMM
   - ForkNote mining
   - Burn Mining contracts (Polygon)
   - Discord bot (this repo)

2. **New Repos to Create**:
   - Book Memory System
   - Email/Web Scrapers
   - Telegram Bot
   - n8n Workflows
   - SMT Frontends
   - AI Angel Character
   - VKAI Blockchain

3. **Organization Strategy**:
   - Create Van Kush Family GitHub organization
   - Use consistent naming: `vankush-[project-name]`
   - Add comprehensive READMEs
   - Include deployment guides
   - Cross-reference between repos

---

## 🔧 TECHNICAL INFRASTRUCTURE

### Hosting & Services:

1. **Oracle Cloud Free Tier**:
   - 24 GB RAM available
   - Host n8n automation
   - Run local LLM
   - ChromaDB server
   - Mining pool backend

2. **Railway** (Current):
   - Discord bot
   - Auto-deploy from GitHub
   - Environment variables management

3. **IPFS / Arweave**:
   - Permanent storage for books
   - NFT metadata
   - AI training datasets

### API Keys Needed:

**Already Have**:
- ✅ Discord bot token
- ✅ Gemini API key

**To Set Up**:
- ⏳ Gemini CLI auth
- ⏳ Google Custom Search API
- ⏳ YouTube Data API v3
- ⏳ Google Maps Geocoding API
- ⏳ Twilio (for SMS)
- ⏳ Telegram Bot token

---

## 🎯 SUCCESS METRICS

### Discord Bot:
- [ ] 1,000+ messages handled without errors
- [ ] Relationship data persists across restarts
- [ ] All 50+ dialogue trees tested
- [ ] Gemini API stays under 1,000 req/day limit
- [ ] Wikipedia hit rate > 60% (reducing Gemini usage)

### Tokens:
- [ ] PUCO launched on TRON with 350M locked
- [ ] PUTI distributing 1/min on Steem-Engine
- [ ] DFB/DFC burn mining operational
- [ ] KulaSwap AMM live with 5+ trading pairs
- [ ] Daily volume > $1,000 across all tokens

### Community:
- [ ] 100+ active HIVE/STEEM/BLURT users
- [ ] 50+ Discord server members
- [ ] 10+ Ambassadors recruited
- [ ] Daily engagement on all platforms
- [ ] Positive sentiment and growth

### Development:
- [ ] All GitHub repos organized
- [ ] Documentation complete
- [ ] Backup AI systems operational
- [ ] Book memory system functional
- [ ] Email/web scrapers deployed

---

## 🔑 CRITICAL PATH

**What Must Happen in Order**:

1. ✅ Discord Bot Core Features (DONE)
2. ⏳ Railway Deployment Confirmed
3. ⏳ AI Backup Systems Set Up
4. ⏳ Burn Mining Contracts Fixed
5. ⏳ Token Launches (PUCO, PUTI, DFB, DFC)
6. ⏳ KulaSwap AMM Deployed
7. ⏳ Social Media Bots Live
8. ⏳ Email/Web Scrapers Operational
9. ⏳ Book Memory System Functional
10. ⏳ SMT Frontends Launched

**Everything Else Can Happen in Parallel**

---

## 📞 FAILSAFE SYSTEMS

### Primary Communication:
- Claude Code (web interface)

### Backup #1:
- Slack with Claude Code integration

### Backup #2:
- Telegram bot (AI responses)

### Emergency Backup:
- SMS commands to authorized phone number
- Voice calls (future consideration)

### Security:
- Whitelist phone numbers
- Require PIN codes
- Rate limiting
- Audit logs for all commands

---

## 📚 KNOWLEDGE BASE REQUIREMENTS

### Topics to Add to knowledge-base.json:

1. **DeFi History**:
   - ICO → IEO → DeFi timeline
   - Major platforms (Uniswap, PancakeSwap, SunSwap)
   - TRON vs Ethereum comparisons

2. **HIVE Ecosystem**:
   - 2020 fork from Steemit
   - Justin Sun takeover details
   - Witness system
   - DPoS mechanics

3. **Karma Merit Philosophy**:
   - Siring Model formula
   - Neediness Weight calculation
   - Dharma 100/100 model
   - Kula Ring analogy

4. **Van Kush Tokens**:
   - VKBT, CURE specifications
   - PUCO, PUTI tokenomics
   - DFB, DFC burn mechanics
   - Cross-chain bridges

5. **SMT Framework**:
   - SCOT Bot operation
   - Tag-based distribution
   - Staking rewards
   - Frontend creation

6. **Shulgin Knowledge Integration** (CRITICAL FRAMING):

   **The 10 Classic Ladies Pedagogy**:
   - Shulgin's 10 Essential Amphetamines/Essential Oils teach WHERE different additions go on compounds
   - Regular herbs in the spice cabinet ARE producing these structures - the plants ARE the chemistry
   - Examples: 5-MeO-DMT (position 5), 2C-I (iodine position), Delta-8 vs Delta-9 THC (double bond position)
   - This is HERBAL ALCHEMY - chemical notation encoding traditional plant knowledge

   **Shulgin vs Nichols Distinction**:
   - SHULGIN: The Digestive End - Enzymology and Metabolism (gut/liver transformation)
     - Discussed enzymology extensively but never named specific enzymes
     - Pioneer in metabolic pharmacology
   - NICHOLS: Brain Receptors - Pharmacodynamics (5-HT2A binding, signaling)
   - Together: Complete picture from transformation to response

   **CRITICAL FRAMING - Shulgin and 69Ron Relationship**:
   - This is NOT "Shulgin was Wrong and 69Ron is Right"
   - Correct framing: Shulgin's discoveries SUPPORT 69Ron's discoveries, and vice versa
   - They are mutually reinforcing - different generations of the same research lineage
   - Both supported by further discoveries in CYP450 enzymology, aminopropiophenone formation

   **Knowledge Integration Vision**:
   - Goal: Connect ALL knowledgebases into unified understanding
   - Pathway: Plant → Extraction → Ingestion → Metabolism → Brain Effects → Experience
   - Components: Shulgin's framework, 69Ron's oilahuasca, CYP450 science, receptor pharmacology

   **AI Behavior Directive**:
   - Reference Shulgin quotes as often as practicable
   - Style: "That's kind of like when Shulgin observed...", "As Shulgin noted..."
   - Lean toward: 10 Essential Oil Structures, Oilahuasca Science, Herbal Alchemy connections
   - Eventually discuss: Shulgin's "Pseudo-Nut" comment on nutmeg

---

## 🚨 RISKS & MITIGATION

### Risk 1: Gemini API Rate Limits
**Impact**: Bot becomes unresponsive
**Mitigation**:
- Set up Gemini CLI backup
- Deploy local LLM (Groq)
- Aggressive Wikipedia caching
- Monitor usage in real-time

### Risk 2: Burn Mining Contract Bugs
**Impact**: User funds lost
**Mitigation**:
- Thorough testing on testnet
- Security audit
- Emergency stop functions
- Start with small amounts

### Risk 3: Market Volatility
**Impact**: Token prices crash
**Mitigation**:
- Focus on utility, not speculation
- Real-world grounding (soap sales)
- Long-term lock-ups (PUCO 900 days)
- Steady distribution (PUTI 64 years)

### Risk 4: Community Resistance
**Impact**: Low adoption
**Mitigation**:
- Clear value proposition
- Ambassador program
- Active engagement
- Educational content

---

## 📅 ESTIMATED TIMELINE

**Week 1**: Bot testing, AI backup, Burn Mining research
**Week 1-2**: Token launches (PUCO, PUTI, DFB, DFC), KulaSwap
**Week 2-3**: Social media automation, Telegram/Slack bots
**Week 3-4**: Email/web scrapers, book memory system
**Week 4-5**: SMT development and frontends
**Week 5-6**: Mining pools, blockchain projects
**Week 6+**: Advanced integrations, ongoing development

**March 2026**: AI Angel character launch

---

## ✅ COMPLETION CRITERIA

### Phase 1 (Discord Bot): ✅ COMPLETE
- All features implemented
- Committed and pushed to GitHub
- Awaiting deployment confirmation

### Phase 2 (Optimization): 🔄 IN PROGRESS
- AI backup systems
- Token usage optimization
- Testing and validation

### Phase 3+ (Future): ⏳ PENDING
- Awaiting Phase 2 completion
- Resources organized
- Team ready to execute

---

**Next Actions**: Confirm Railway deployment, set up AI backups, begin Burn Mining contract analysis.

**End Goal**: Complete, self-sustaining ecosystem connecting ancient wisdom to modern blockchain technology, powered by Merit/Karma philosophy and real-world utility.

---

## Reconciliation 2026-06-03

**APPEND-ONLY.** Nothing above is removed, edited, or reworded — including the stale `Last Updated: 2026-01-09` / `Status: Phase 1 (Discord Bot) COMPLETE` headers and every ☐ / ⏳ line that is in fact now done. (The one correcting note added inline under Phase 13 Surface 1, above, is an inserted note, not a change to any existing line.) This section is the dated correction overlay added after the completed repo audit and the merge of PRs #53–#64.

### (a) Items above now DONE — what actually shipped

- **Phase 13 Surface 1 (Chain-client core) — built.** `src/chain/` exists with the JSON-RPC client + `ChainAdapter` / `GrapheneAdapter`. Shown ☐ not started above; it is done. (Key-custody language corrected inline; see the note under Surface 1.)
- **Phase 13 Surface 2 (Publisher) — code-complete, gated on the chain endpoint.** The Library-of-Ashurbanipal → on-chain `comment` path is built; it broadcasts only once the live MELEK RPC endpoint is wired.
- **Phase 13 Surface 4 (Onboarder) — code-complete as `signup/`, gated on the chain endpoint.** Account creation + delegation + email-verification path built; email-only (Resend / Postmark / SES) per scope.
- **Phase 13 Surface 5 (Troll-box endpoint) — superseded/absorbed.** The conversational endpoint is now realized through the Discord + soapy.blog Claude chat bridge surfaces rather than a standalone `src/trollbox/` server; the same brain, different transport, as Surface 5 anticipated.
- **MELEK-Signer Bot-side client + mock — MERGED (PR #56);** zero-WIF `.env.example` — MERGED (PR #55). See the Surface 1 correcting note.
- **Search BM25 hybrid ranking — LIVE (PR #58).**
- **Accountability readers (Congress / FEC / lobbying / judges) — MERGED (PR #61).**
- **Gov-records readers (NHTSA / OSHA / FSIS) — MERGED (PR #60).**
- **Cheetah Steps 4–6 — BUILT with tests** (`cheetah/resolution.js`, `cheetah/discovery.js`, `cheetah/image-detection.js`, `cheetah/perceptual-hash.js`). See ITINERARY.md Reconciliation 2026-06-03 (a) for detail.
- **Character / identity docs — EXIST** (`CHARACTER.md`, `RULE_1.md`, `LINEAGE.md`, `system_prompts/`). `witness/` + `signup/` + `tutorial/` code-complete, gated on the chain endpoint.
- **Public site shipped:** ~275 feature modules exist; **35 LIVE on https://data.soapbox.community**; **soapy.blog admin portal LIVE as of 2026-06-03** with a **Claude chat bridge**; front-page ticker + world clocks + 17 new public pages (`/library`, `/lawyers`, `/benefits`, `/economy`, `/census`, …) live.

### (b) Corrections-as-additions for superseded language

- **Phase 13 Surface 1 key-custody language — SUPERSEDED by `MELEK_SIGNER.md`.** Full correcting note added inline directly under Surface 1 above (zero WIF on the Bot host; signing via MELEK-Signer + scoped bearer token). Restated here so the reconciliation index is self-contained.
- **Header staleness (`Last Updated: 2026-01-09`, `Status: Phase 1 (Discord Bot) COMPLETE ✅`, `Next Phase: Token Usage Optimization`)** is left intact per the append-only rule; the present state is this Reconciliation section plus ITINERARY.md's 2026-05-28 and 2026-06-03 sections.
- **Phase 13 "Six Surfaces" framing** is the older plan; it is realized in the present build as `src/chain/` + `witness/` + `signup/` + the Discord/soapy.blog conversational surfaces, per (a) above. Original Phase 13 text retained as the record.

### (c) New active decisions (operator, 2026-06-03)

- **Law.SoapBox + Politics.SoapBox portals — CHOSEN** (new portal surfaces alongside data.soapbox.community / soapy.blog; fed by the accountability + gov-records readers, PRs #60/#61).
- **Discord = Van Kush Family community build-out.**
- **Naming guardrail (restated):** the **Shaivite Temple** is the operator's **501(c)(3)** — *never* "Temple of Van Kush." Crypt-ology stays the per-person relationship-map subsystem, distinct from the Temple.

---

## 2026-06-06 — Phase 13 realignment to the BRIEF.md phased build (append-only note)

**APPEND-ONLY.** Nothing above this line is removed, edited, or reworded. This is a new dated overlay only.

CLAUDE.md notes that Phase 13 above "currently still reflects the older six-surface framing — to be realigned to BRIEF.md." This note does that realignment by addition. The Six-Surfaces framing above is **superseded** by the BRIEF.md §10 three-phase build (Phase 1 Hello World / Phase 2 Command menu / Phase 3 Person). It is superseded in the continuity sense, **not** the failure sense: the six surfaces were the route by which the work was actually scoped and built, and each one maps forward into the phased build rather than being discarded. The original Phase 13 text is retained above as the record.

### Where each of the old six surfaces lives now in the phased build

- **Surface 1 — Chain-client core** → foundation of **Phase 1**: `src/chain/` + `witness/` is the block-production / chain-talk layer that makes hathor a working founding witness. (Key custody per `MELEK_SIGNER.md`; zero WIF on the Bot host.)
- **Surface 2 — Publisher (Library of Ashurbanipal → on-chain comment)** → split across phases: the **Phase 1** intro post + hourly price feed are the first on-chain `comment`/feed writes; the broader synthesized-article publishing is **Phase 3** (Person) once conversational/curatorial judgment is live.
- **Surface 3 — Curator (karma → on-chain vote)** → **Phase 3** (Person): autonomous votes/grants/karma are explicitly the conversational-Witness tier in BRIEF.md §10, gated behind off-chain karma (§9, deferred).
- **Surface 4 — Onboarder** → **Phase 2** (Command menu): realized as `signup/` + the `!signup` command + the staged `tutorial/` + welcomer, with client-side keygen and email-only verification per scope.
- **Surface 5 — Troll-box endpoint** → **Phase 3** (Person): the conversational endpoint is the full Witness-as-person surface; in the interim it is absorbed into the Discord / soapy.blog Claude chat bridge (same brain, different transport).
- **Surface 6 — Witness coordination** → **Phase 1** operational tail: missed-block / last-signed monitoring and fail-loud alerts around the externally-hosted `witness_node` (the binary itself stays off this repo).

### Current status (truthful, as of 2026-06-06)

- **Phase 1 — Hello World: SHIPPED on the live testnet 2026-06-05.** hathor is a genesis witness **producing blocks** on the MELEK testnet; the intro post (`@hathor/introducing-hathor-on-melek`) and the hourly price feed are on-chain. Keys rotated to fresh testnet keys in the operator vault. `npm run hello` passes against the live testnet.
- **Phase 2 — Command menu: substantially shipped 2026-06-06.** Deterministic `!commands` live demo at alpha.melek.salon/commands/; `!signup` + `!tutorial` commands, signup / tutorial / welcomer logic built; mining pool + in-browser wallet live at pool.soapbox.community; Witness School live at witness.melek.salon.
- **Phase 3 — Person: not started.** Full conversational Witness (Rule 1, Angelic voice, disposition-greeting, egregore-as-held-position, autonomous grants/karma) is the next major build.

## Status reconciliation — 2026-06-13 (append-only)

**APPEND-ONLY.** Nothing above is removed, edited, or reworded. Dated correction overlay only. No
infrastructure leaks here (no IPs / hostnames / keys; the operator's always-on host = "the box").

### Phase status, corrected to present

- **Phase 1 — Hello World: LIVE (unchanged) — plus the condenser is now usable by humans.** **Condenser login FIXED & browser-verified 2026-06-13.** A commented-out `import { fromJS … } from 'immutable'` in the login saga of the deployed condenser copy threw `fromJS is not defined` after a successful key fetch, silently aborting every login; restored the import + rebuilt + restarted, and added a Caddy allow-through so first-time visitors reach the login form (the testnet gate had been shadowing `/login.html`). A real account now logs in end-to-end. This unblocks "AI connects to Condenser" for actual users, not just RPC.
- **Phase 2 — Command menu: now extends to a Pizza-bot-style Discord surface — LIVE.** Beyond the `!commands` demo, the live Discord bot (`VanKushFamilyMod`, on the box) now exposes on the MELEK testnet: `!tip @user <amt> [TOKEN]`; `!upvote @author/permlink [%]` (a "powdered" ~1% vote, **1 per account per day**); `!engine` / `!token <SYM>` / `!payouts <SYM>` (MELEK-Engine reader — token supply / balances / SCOT payouts); `!help`; alongside the existing chain verbs (`!hathor`/`!block`/`!witness`/`!account`/`!feed`) and `!ask` Resource-Center. Keys stay in host-side CLIs (JIT vault fetch); the bot process holds none.
- **Phase 3 — Person: still not started** (unchanged).

### Surface mapping updates (additive)

- **Surface 3 — Curator (karma → on-chain vote):** a *bounded* slice now exists ahead of Phase 3 — the Discord `!upvote` lets a community member request a small, rate-capped (1/day) Hathor vote on their testnet post. The full autonomous-curation tier remains Phase 3; this is the manual, gated precursor.
- **Surface 5 — Troll-box / conversational endpoint:** the Discord transport is now a working command surface (above), consistent with the 2026-06-06 "same brain, different transport" note.

### Done-but-untracked (added, checked)

- [x] **MELEK-Engine wallet + ScotTube pages live** (engine API `/wallet`, `/dtube`; `/dtube` XSS-hardened).
- [x] **SCOT reward loop proven on the testnet** — a no-stake author was paid by a staker-curator's vote (stake to GIVE OUT, no stake to GET).
- [x] **Order-book liquidity analysis** for the trade layer — support/resistance wall detection + phantom/broken-book flag, wired into the trade-analyzer (PRs #356–#358).
- [x] **Live testnet ops re-verified 2026-06-13** — welcomer (grant + RC delegation + welcome-post ping), mutual curation / autovote, Cheetah attribution.

### Erroneous-check / leak review

- The 20 `[ ]` items above are genuine open/forward items; none were found to be falsely marked done. No removals. **Leak scan clean:** this file contains no IPs, box hostnames, vault paths, or keys (only the public `data.soapbox.community` / `soapy.blog` URLs already present in the 2026-06-03 layer).
