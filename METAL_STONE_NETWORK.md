# Metal & Stone Blockchain Network
## Complete Technical Specification & Action Plan

**Created**: 2026-01-09
**Status**: Partial Implementation - Major Components Unfinished
**Naming**: REQUIRES NEW NAME - "Punic" will be replaced throughout

---

## 🎯 VISION & PURPOSE

### Core Concept:
A multi-layered blockchain ecosystem where each **metal** or **stone** represents a specific crypto architecture. By understanding the Metal/Stone currencies, users understand ALL cryptocurrencies.

### Educational Framework:
- **Table of Contents Directory**: Guides users from simple token trading to advanced mining
- **Blockchain Dashboard**: Visual learning system showing relationships between currencies
- **Scaffolding for Communities**: Anyone can fork and launch niche networks

### Physical Integration:
Unlike speculative tokens, these are **actual trade instruments** for:
- Religious commodities (ritual objects, altar materials, Mhurti statues)
- Physical asset backing (precious metals, seeds, land)
- Real-world utility driving value

---

## 🏗️ NETWORK ARCHITECTURE

### LAYER 1: BASE METALS (Functional Currencies)

#### 1. COPPER ~~(PUCO - Punic Copper)~~ → NEW NAME NEEDED
**Current Status**: ✅ Partially Deployed
**Blockchain**: TRON (TRC20)
**Purpose**: High liquidity, easy DEX trading
**Supply**: 700,000,000 tokens
**Lock-up**: 50% (350M) frozen for 900 days (DAO managed)
**DEX**: NewDex, SunSwap
**Use Case**: Entry-level trading, micropayments, bulk airdrop tool

**Unfinished Work**:
- DAO governance structure (how to vote on unlocking)
- Integration with KulaSwap AMM
- Automated market maker for COPPER/TRX pair
- Mobile wallet integration

**Action Items**:
1. Finalize DAO smart contract for 900-day lock
2. Deploy liquidity pools on SunSwap V2
3. Create trading pairs: COPPER/TRX, COPPER/USDT
4. Build price oracle for cross-chain reference

---

#### 2. TIN ~~(PUTI - Punic Tin)~~ → NEW NAME NEEDED
**Current Status**: ✅ Partially Deployed
**Blockchain**: Steem-Engine
**Purpose**: Social media curation, Proof of Brain rewards
**Distribution**: 1 token/minute for 64 years
**Algorithm**: 65% author, 35% curator
**Tags**: #ulogs, #dtube, #punicwax, #projecthope

**Unfinished Work**:
- SCOT Bot optimization (currently has bugs)
- Frontend customization (needs dedicated UI)
- Tag expansion (add more communities)
- Staking rewards mechanism
- Cross-posting automation (HIVE/BLURT integration)

**Action Items**:
1. Debug SCOT Bot using Holgern's steem-scot repo
2. Create custom frontend (DTube clone style)
3. Add tags: #vankush, #cryptology, #karma
4. Implement auto-curation based on Karma Merit algorithm
5. Build Steem-Engine to HIVE-Engine bridge ("Peggy")

---

#### 3. BRONZE ~~(Punic Bronze)~~ → NEW NAME NEEDED
**Current Status**: ❌ NOT STARTED
**Concept**: Cross-chain bridge synthesizing COPPER + TIN
**Purpose**: Unify TRON and Graphene (STEEM/HIVE/BLURT) ecosystems

**Technical Specification**:
- **Mechanism**: Wrapped token bridge
  - Lock COPPER on TRON → Mint wrapped BRONZE on HIVE-Engine
  - Lock TIN on Steem-Engine → Mint BRONZE on TRON
- **Ratio**: 1 COPPER + 1 TIN = 1 BRONZE (or adjustable by oracle)
- **Use Case**: Trade between ecosystems, provide liquidity on both sides

**Technology Stack**:
- **TRON Side**: TRC20 bridge contract
- **HIVE Side**: Hive-Engine Peggy contract
- **Oracle**: Chainlink-style price feed (or custom)
- **Validator Network**: Multi-sig witnesses approve cross-chain transfers

**Action Items**:
1. Research existing bridges: TRON-BSC, HIVE-ETH examples
2. Design multi-sig validator system (7 validators, 5/7 required)
3. Write smart contracts for lock/mint/burn on both chains
4. Build bridge UI (simple send/receive interface)
5. Test on Shasta testnet (TRON) and HIVE testnet
6. Launch with 10,000 BRONZE initial liquidity

**Timeline**: 2-3 weeks after COPPER and TIN are stable

---

### LAYER 2: PRECIOUS METALS (Blockchain Clones)

#### 4. SILVER ~~(Punic Silver)~~ → NEW NAME NEEDED
**Current Status**: ❌ NOT STARTED
**Concept**: Bitcoin clone with Van Kush branding
**Purpose**: Store of value, mining education

**Technical Specification**:
- **Codebase**: Fork Bitcoin Core or Litecoin
- **Algorithm**: Scrypt (ASIC-resistant) or SHA-256 (Bitcoin standard)
- **Block Time**: 2.5 minutes (Litecoin-style) or 10 minutes (Bitcoin-style)
- **Supply**: 21,000,000 SILVER (same as Bitcoin for familiarity)
- **Halving**: Every 840,000 blocks (4 years)

**Features**:
- **SegWit**: Enabled for lower transaction fees
- **Lightning Network**: For instant micropayments
- **Mining Pool**: Self-hosted pool for community miners
- **Block Explorer**: Custom explorer with Van Kush branding

**Mining Pool Requirements**:
- **Software**: MPOS, NOMP, or modern equivalent
- **Stratum Server**: For miner connections
- **Payout System**: PPLNS (Pay Per Last N Shares)
- **Dashboard**: Real-time hashrate, earnings, blocks found

**Action Items**:
1. Choose base: Bitcoin Core vs Litecoin (Scrypt preferred for accessibility)
2. Fork codebase, rebrand to SILVER
3. Configure genesis block with Van Kush message
4. Set up mining pool using NOMP or equivalent
5. Deploy seed nodes (minimum 3 for decentralization)
6. Create mining guide for community
7. Launch testnet for 2 weeks
8. Mainnet launch with pre-mine (1% for development fund)

**Timeline**: 3-4 weeks

---

#### 5. GOLD ~~(Punic Gold)~~ → NEW NAME NEEDED
**Current Status**: ❌ NOT STARTED - **PRIORITY PROJECT**
**Concept**: Ethereum clone for smart contracts and DeFi
**Purpose**: Platform for Van Kush dApps, NFTs, DeFi ecosystem

**Technical Specification**:
- **Codebase**: Fork Ethereum (Geth) or use BSC/Polygon as template
- **Consensus**: Proof of Stake (PoS) or DPoS (like BSC)
- **Block Time**: 3 seconds (fast like BSC)
- **Gas Token**: GOLD (used for transaction fees)
- **Smart Contracts**: Full EVM compatibility

**Features**:
- **Native DEX**: Built-in Uniswap V2 clone
- **NFT Marketplace**: For Van Kush art, AI Angel characters
- **Staking**: Validators stake GOLD to secure network
- **Governance**: DAO voting for network upgrades
- **Bridge**: To Ethereum, BSC, Polygon for liquidity

**Validator System (DPoS)**:
- **21 Active Validators**: Elected by GOLD holders
- **Standby Validators**: 100+ candidates waiting for election
- **Rewards**: Block rewards + transaction fees
- **Slashing**: Validators lose stake for downtime/malicious behavior

**Pre-Deployed Contracts**:
1. **KulaSwap**: DEX for all Metal/Stone tokens
2. **Burn Mining**: Fixed contracts for BRONZE, OBSIDIAN
3. **NFT Standard**: ERC-721 for Mhurti, ritual objects
4. **Stablecoin**: Gold-backed stablecoin (1 GOLDBACK = $1 worth of physical gold)
5. **Karma Contracts**: Siring Model implementation on-chain

**Action Items**:
1. Fork BSC (Binance Smart Chain) codebase as starting point
2. Rebrand to GOLD, customize genesis block
3. Deploy KulaSwap contracts (Uniswap V2 fork)
4. Set up 21 validator nodes (start with 7 for testing)
5. Create staking dApp for validator election
6. Build block explorer (BSCScan fork)
7. Launch testnet for 1 month (bug bounty program)
8. Mainnet launch with pre-sale for validators

**Timeline**: 6-8 weeks (most complex project)

---

### LAYER 3: PRIVACY STONES (Cryptonote/Privacy Focus)

#### 6. OBSIDIAN ~~(Punic Obsidian)~~ → NEW NAME NEEDED
**Current Status**: ❌ NOT STARTED
**Concept**: Monero-style privacy coin
**Purpose**: Anonymous transactions, religious donation privacy

**Technical Specification**:
- **Codebase**: Fork Monero or use ForkNote/Cryptonote
- **Algorithm**: CryptoNight (ASIC-resistant)
- **Privacy**: Ring signatures, stealth addresses, RingCT
- **Block Time**: 2 minutes
- **Supply**: 18,400,000 OBSIDIAN (similar to Monero)

**Features**:
- **Untraceable**: No transaction graph
- **Unlinkable**: Sender/receiver cannot be linked
- **Private by Default**: Unlike optional privacy (Zcash)
- **Burn Mining**: Send OBSIDIAN to burn address to mine GEMSTONES

**Use Cases**:
- Religious donations (privacy for temple offerings)
- Anonymous voting in DAO
- Private transactions for sensitive purchases

**Action Items**:
1. Fork Monero or use ForkNote template
2. Configure CryptoNight algorithm
3. Set up mining pool (separate from SILVER pool)
4. Deploy web wallet (MyMonero-style)
5. Create mobile wallet (Monerujo fork for Android)
6. Launch with privacy-focused marketing

**Timeline**: 4-5 weeks

---

#### 7. GEMSTONES ~~(Punic Gemstones)~~ → NEW NAME NEEDED
**Current Status**: ❌ CONCEPT ONLY
**Concept**: Higher-tier privacy assets mined via OBSIDIAN burning
**Purpose**: Ultra-rare collectibles with privacy features

**Possible Implementations**:
- **Ruby**: Privacy NFTs (art, documents)
- **Sapphire**: Governance tokens for privacy DAO
- **Emerald**: Staking rewards for OBSIDIAN miners
- **Diamond**: Ultimate rarity, mined at 1/1,000,000 rate

**This is a future expansion** - focus on base layers first.

---

## 🔧 TECHNICAL INFRASTRUCTURE (ALL UNFINISHED)

### 1. SocialGraph "Forking Machine"
**Status**: ❌ NOT STARTED
**Purpose**: Allow anyone to snapshot BLURT and create a fork with all wallets intact

**How It Works**:
1. User selects a block number on BLURT
2. SocialGraph exports all account balances at that block
3. User customizes new chain (name, logo, parameters)
4. Fork launches with all original balances
5. Community migrates if they prefer new rules

**Use Cases**:
- Create niche communities (e.g., "Photography BLURT", "Gaming BLURT")
- Test governance changes without risking main chain
- Educational tool for learning blockchain forking

**Technology**:
- **Export Tool**: Reads BLURT blockchain, outputs JSON
- **Genesis Generator**: Creates new genesis block from snapshot
- **Witness Coordinator**: Helps new chain elect initial witnesses

**Action Items**:
1. Research HIVE fork process (2020 fork from STEEM as example)
2. Write snapshot export script (reads RocksDB/LMDB from BLURT node)
3. Create genesis block generator
4. Build web UI for fork customization
5. Document forking process for non-technical users

**Timeline**: 3-4 weeks

---

### 2. DPoWS (Delegated Proof of Work/Stake) System
**Status**: ❌ NOT STARTED
**Concept**: Hybrid consensus where miners do hashing but community votes for witnesses

**Architecture**:
```
Community (Social Layer)
    ↓ (votes for)
Witnesses (Elected Leaders)
    ↓ (coordinate)
Miners (Backend Hashing)
```

**How It Works**:
1. **Witnesses**: Elected by token holders (like HIVE/STEEM)
   - Top 21 witnesses rotate block production
   - Responsible for consensus decisions
   - Can be voted out if they misbehave

2. **Miners**: Provide computational power
   - Submit Proof of Work to witnesses
   - Receive block rewards
   - Work is verified by witnesses before adding to chain

3. **Community**: Stakes tokens to vote
   - 1 token = 1 vote
   - Can delegate votes to trusted community members
   - Vote weight decays over time (encourages active participation)

**Benefits**:
- Separates technical expertise (mining) from governance (community)
- More decentralized than pure PoW (no 51% hash attacks)
- More secure than pure DPoS (requires actual work, not just stake)

**Action Items**:
1. Design hybrid consensus algorithm (combine PoW + DPoS)
2. Implement in SILVER and GOLD chains
3. Create witness voting dApp
4. Set up miner coordination protocol
5. Test with 21 witness testnet

**Timeline**: Integrate with SILVER/GOLD launches (add 2 weeks to those timelines)

---

### 3. Witness Boot Camp
**Status**: ❌ NOT STARTED
**Purpose**: Train community members to run witness nodes

**Curriculum**:
- Week 1: Blockchain basics, running a node
- Week 2: Witness responsibilities, voting system
- Week 3: Server setup (AWS, Oracle Cloud, DigitalOcean)
- Week 4: Monitoring, security, backup strategies
- Week 5: Emergency procedures, fork handling

**Deliverables**:
- Video tutorials
- Written guides
- Discord support channel
- Certification for graduates

**Action Items**:
1. Create witness node setup scripts (one-click deployment)
2. Record video tutorials for each blockchain
3. Build monitoring dashboard
4. Schedule live Q&A sessions
5. Launch pilot program with 10 beta testers

**Timeline**: 3 weeks to create content, ongoing program

---

## 💰 PHYSICAL ASSET BACKING SYSTEM

### Strategy:
1. **Earn from Lesser Tokens**: COPPER, TIN generate trading volume
2. **Buy Higher Tokens**: Use earnings to accumulate SILVER, GOLD, OBSIDIAN
3. **Convert to Physical Assets**:
   - Precious metals (gold, silver bullion)
   - Land (Dallas-Fort Worth area for temple expansion)
   - Seeds (heirloom varieties for food sovereignty)
   - Religious materials (bulk purchase for resale)

### Backing Ratio:
- Target: 10% of GOLD backed by physical gold within 2 years
- Transparent reserves (published quarterly reports)
- Third-party audits (CoinMarketCap-style proof of reserves)

### Action Items:
1. Set up precious metals account (Kitco, APMEX)
2. Create reserve wallet for each token
3. Build reserve proof system (Merkle tree like Kraken)
4. Publish first reserve report

**Timeline**: Ongoing, starts with first token revenues

---

## 🛒 RELIGIOUS COMMODITIES MARKETPLACE

### Products to Trade:
1. **Ritual Objects**:
   - Offering bowls
   - Incense holders
   - Meditation cushions
   - Prayer beads

2. **Altar Materials**:
   - Candles (soy, beeswax)
   - Incense (Nag Champa, Frankincense, Imphepho)
   - Oils (anointing, essential)
   - Fabrics (altar cloths, prayer shawls)

3. **Mhurti (Statues)**:
   - Shiva, Ganesha, Kali (Hindu deities)
   - Egyptian gods (Hathor, Anubis, Thoth)
   - Phoenician deities (Tanit, Ba'al)
   - Custom commissioned pieces

4. **Books**:
   - Book of Tanit (when published)
   - Religious texts
   - Occult literature
   - Grimoires

### Platform:
- **Current**: Etsy (Punic Wax shop)
- **Planned**: Custom e-commerce on GOLD blockchain
  - Smart contract escrow
  - NFT receipts for authenticity
  - GOLD/SILVER/COPPER payment options
  - Reputation system (Karma Merit based)

### Action Items:
1. Design marketplace smart contracts on GOLD
2. Build frontend (Shopify-style but decentralized)
3. Integrate with inventory system
4. Add crypto payment gateway
5. Create NFT authenticity certificates

**Timeline**: 4-6 weeks after GOLD launches

---

## 📚 BLOCKCHAIN DASHBOARD & EDUCATION

### Purpose:
"By understanding the Metal/Stone currencies, you understand ALL cryptocurrencies"

### Dashboard Features:

#### 1. Visual Network Map
- Interactive graph showing all tokens
- Lines connecting bridges (BRONZE)
- Color-coded by layer (Base, Precious, Privacy)
- Click any token to see details

#### 2. Learning Paths
- **Beginner**: Start with COPPER (simple trading)
- **Intermediate**: Move to TIN (social rewards), BRONZE (cross-chain)
- **Advanced**: SILVER (mining), GOLD (smart contracts)
- **Expert**: OBSIDIAN (privacy), GEMSTONES (advanced concepts)

#### 3. Live Statistics
- Price charts for all tokens
- Trading volume
- Network hashrate (SILVER, GOLD, OBSIDIAN)
- Witness voting status
- Burn Mining rates

#### 4. Comparison Table
| Feature | COPPER | TIN | BRONZE | SILVER | GOLD | OBSIDIAN |
|---------|--------|-----|--------|--------|------|----------|
| Blockchain | TRON | Graphene | Bridge | Bitcoin Clone | ETH Clone | Monero Clone |
| Speed | Fast | Fast | Medium | Slow | Fast | Medium |
| Privacy | No | No | No | No | No | **Yes** |
| Smart Contracts | No | No | No | No | **Yes** | No |
| Mining | No | Social | No | **PoW** | **PoS** | **PoW** |

### Action Items:
1. Design dashboard UI/UX
2. Build backend API aggregating all chains
3. Create educational content for each token
4. Add quiz system (earn COPPER for completing lessons)
5. Deploy on GOLD blockchain (decentralized hosting)

**Timeline**: 6 weeks

---

## 🎯 NAMING SYSTEM REPLACEMENT

### Current Problem:
"Punic" is being retired from all token names

### Requirements for New Name:
1. **Heritage Connection**: Should relate to Van Kush Family lineage
2. **Metal/Stone Compatible**: Works with Copper, Tin, Bronze, Silver, Gold, Obsidian
3. **Easy to Remember**: Short, pronounceable
4. **Culturally Respectful**: Doesn't appropriate inappropriately
5. **Scalable**: Can prefix many token names

### Naming Options to Consider:

#### Option 1: **VK** (Van Kush)
- VK Copper (VKCU)
- VK Tin (VKTI)
- VK Bronze (VKBR)
- VK Silver (VKAG)
- VK Gold (VKAU)
- VK Obsidian (VKOB)

**Pros**: Direct branding, clear ownership
**Cons**: Less mystical/educational, very direct

#### Option 2: **Kush** (Cannabis/Heritage)
- Kush Copper (KUCU)
- Kush Tin (KUTI)
- Kush Bronze (KUBR)
- Kush Silver (KUAG)
- Kush Gold (KUAU)
- Kush Obsidian (KUOB)

**Pros**: Connected to family name, recognizable
**Cons**: Cannabis association might limit adoption in some markets

#### Option 3: **Deniso** (Denisovan)
- Deniso Copper (DECU)
- Deniso Tin (DETI)
- Deniso Bronze (DEBR)
- Deniso Silver (DEAG)
- Deniso Gold (DEAU)
- Deniso Obsidian (DEOB)

**Pros**: Educational, links to 75,000-year lineage
**Cons**: Long word, less familiar

#### Option 4: **Phoe** (Phoenix/Phoenician)
- Phoe Copper (PHCU)
- Phoe Tin (PHTI)
- Phoe Bronze (PHBR)
- Phoe Silver (PHAG)
- Phoe Gold (PHAU)
- Phoe Obsidian (PHOB)

**Pros**: Phoenix symbolism (rebirth), Phoenician heritage
**Cons**: Might be confused with "Foe"

#### Option 5: **Tanit** (Goddess)
- Tanit Copper (TACU)
- Tanit Tin (TATI)
- Tanit Bronze (TABR)
- Tanit Silver (TAAG)
- Tanit Gold (TAAU)
- Tanit Obsidian (TAOB)

**Pros**: Connected to Book of Tanit, goddess worship
**Cons**: Similar to "Punic" issue if moving away from that heritage

#### Option 6: **Temple** or **Tem**
- Temple Copper (TECU)
- Temple Tin (TETI)
- Temple Bronze (TEBR)
- Temple Silver (TEAG)
- Temple Gold (TEAU)
- Temple Obsidian (TEOB)

**Pros**: Religious connection, temple culture theme
**Cons**: Generic, might not be unique enough

### DECISION NEEDED:
User must choose new naming system before proceeding with launches.

---

## 📅 IMPLEMENTATION TIMELINE

### Immediate (This Week):
1. ✅ Document complete Metal/Stone Network spec (THIS DOCUMENT)
2. ⏳ Choose new naming system
3. ⏳ Update all documentation with new names
4. ⏳ Finalize COPPER DAO governance
5. ⏳ Fix TIN SCOT Bot bugs

### Phase 1 (Weeks 1-2): Base Layer Completion
- Week 1: COPPER DAO, SunSwap liquidity
- Week 2: TIN SCOT Bot optimization, custom frontend

### Phase 2 (Weeks 3-4): Cross-Chain Bridge
- Week 3: BRONZE bridge contracts
- Week 4: BRONZE testing and launch

### Phase 3 (Weeks 5-8): SILVER Mining
- Week 5-6: SILVER blockchain fork and customization
- Week 7: Mining pool setup
- Week 8: SILVER mainnet launch

### Phase 4 (Weeks 9-16): GOLD Smart Contract Platform
- Week 9-12: GOLD blockchain development
- Week 13-14: KulaSwap and dApp deployment
- Week 15: GOLD testnet
- Week 16: GOLD mainnet launch

### Phase 5 (Weeks 17-21): OBSIDIAN Privacy
- Week 17-20: OBSIDIAN fork and customization
- Week 21: OBSIDIAN mainnet launch

### Phase 6 (Ongoing): Infrastructure
- SocialGraph Forking Machine: Parallel development
- DPoWS System: Integrate with SILVER/GOLD
- Witness Boot Camp: Launch with GOLD
- Marketplace: Launch with GOLD
- Dashboard: Launch after all tokens live

---

## 🔑 CRITICAL DEPENDENCIES

**Before Anything Else:**
1. ✅ Discord bot complete (foundation for community)
2. ⏳ Railway deployment confirmed
3. ⏳ Choose new naming system
4. ⏳ Set up development infrastructure (Oracle Cloud, GitHub org)

**For Each Blockchain:**
- Dedicated server ($40-100/month per chain)
- Domain name for explorer/wallet
- SSL certificates
- Minimum 3 seed nodes for decentralization

**For Mining Pools:**
- High-bandwidth server (100+ Mbps)
- DDoS protection
- Payout wallet with sufficient funds
- Monitoring/alerting system

---

## 💡 PHILOSOPHICAL INTEGRATION

### Karma Merit System:
Each token incorporates Karma principles:
- **COPPER/TIN**: Social tokens reward charitable curation
- **BRONZE**: Bridges communities (literal Karma bridge)
- **SILVER/GOLD**: Mining rewards based on network contribution
- **OBSIDIAN**: Privacy enables true charitable giving

### Physical Grounding:
Unlike pure speculation:
- All tokens tradeable for real goods
- Physical asset backing builds floor price
- Religious use creates steady demand
- Educational purpose ensures longevity

### Temple Culture:
The network itself IS a temple:
- Preserves knowledge (blockchain = permanent record)
- Connects communities (bridges, forks)
- Enables sacred commerce (privacy, trust)
- Teaches future generations (dashboard, boot camp)

---

## ✅ NEXT ACTIONS

### Immediate (User Decision Required):
1. **Choose new naming system** (replace "Punic")
2. Confirm priority order (BRONZE vs SILVER vs GOLD first?)
3. Allocate development budget (hosting, domains, testing)

### This Session (If Continuing):
1. Update knowledge-base.json with Metal/Stone Network
2. Create detailed technical specs for chosen priority project
3. Research existing codebases to fork
4. Draft smart contracts for BRONZE bridge
5. Plan mining pool architecture for SILVER

---

**Status**: Comprehensive specification complete. Ready to choose naming and begin implementation.

**Total Projects**: 7 tokens + 5 infrastructure components + 1 marketplace + 1 dashboard = 14 major deliverables

**Estimated Timeline**: 6 months for full network (can launch incrementally)

**Next Step**: User chooses new name, then we start with highest priority component.
