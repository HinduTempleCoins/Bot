# Van Kush Family Trading Bot System

Complete HIVE-Engine trading automation with intelligent capital management and HIVE.blog marketing.

**Status**: ✅ DEPLOYED and RUNNING (12hr dry run on Google VM)

---

## 🎯 What This System Does

### 1. **Price Pusher Bot** (`vankush-price-pusher.cjs`)
Implements patient market psychology strategy for VKBT & CURE:
- Buys gradually when price < $2 USD
- Micro-pushes for price anchoring
- Budget management (35 HIVE/day max)
- 6-hour cooldown between major pushes
- **Capital Manager Integration**: Automatically checks liquidity needs every 15 minutes

### 2. **Capital Manager** (`capital-manager.cjs`)
3-tier intelligent fund management:
- **Tier 1 - Premium** (VKBT, CURE): Strategic selling only, never dump
- **Tier 2 - Fuel** (BLURT): Gradual top-order selling for HIVE, 1h cooldown
- **Tier 3 - Tradeable** (BBH, POB): Sell freely for operations/profit
- **Power-Up System**: Auto-recommends HIVE→HIVE POWER when reserves hit tiers (50/100/200 HIVE)

### 3. **HIVE Content Bot** (`hive-content-bot.cjs`)
Daily HIVE.blog marketing automation:
- Posts once daily at 14:00 UTC about VKBT/CURE
- 3 rotating content templates (scarcity, psychology, daily updates)
- Requests tips: !PIZZA !BEER !LUV !WINEX !HUG !hivebits !GM
- Builds awareness and community engagement

### 4. **Analysis Tools**
- **Wall Analyzer**: Smart buy/sell detection, cost-to-target calculations
- **Holder Analyzer**: On-chain ownership distribution tracking
- **Psychology Tracker**: Weekly/monthly market metrics and trends
- **Staking Analyzer**: APR calculations for HIVE-Engine tokens

---

## 🚀 Quick Start (Google VM)

### 1. Deploy Bots
```bash
chmod +x DEPLOY.sh
./DEPLOY.sh
```

**Options**:
1. Portfolio Tracker (Read-only, safe)
2. Price Pusher (DRY RUN - recommended first)
3. Price Pusher (LIVE - real trades!)
4. HIVE Content Bot (Daily marketing)
5. All bots (Portfolio + Pusher + Content)
6. Test bots (One-time run, no PM2)

### 2. Monitor
```bash
pm2 list              # View all bots
pm2 logs pusher-dry   # View price pusher logs
pm2 logs hive-content # View content bot logs
```

---

## 💰 Capital Management Strategy

### Token Tiers

**Premium Tokens (VKBT, CURE)**:
- Strategic selling only - never dump
- Hold for long-term value
- Current: 50K VKBT, 1.5K CURE

**Fuel Token (BLURT)**:
- Main capital: 344 SWAP.BLURT
- Gradual selling: TOP order only, 1h cooldown
- Reserve: Always keep 50 BLURT
- Accepts market price (BLURT needs our work to rise)

**Tradeable Tokens (BBH, POB)**:
- Sell freely for operations/profit
- Current: 928 BBH, 939 POB

### HIVE Liquidity

- **Critical**: 5 HIVE → sell BLURT immediately
- **Low**: 10 HIVE → sell BLURT soon (75% urgency)
- **Target**: 25 HIVE → operations funded
- **Reserve Tiers**: 50/100/200 HIVE → power up 50% of excess

### The Flywheel

```
Trading → HIVE → Operations → Power-Up → Curation → More Capital → Compound! 🚀
```

---

## 📊 Current Status (Jan 10, 2026)

**Deployed**:
- ✅ Price pusher on Google VM (12hr dry run)
- ✅ Capital manager integrated
- ✅ 50,000 VKBT + 1,500 CURE transferred
- ✅ 344 SWAP.BLURT + 928 BBH available

**Market**:
- VKBT: 0.0007 HIVE, 986 holders, $0.87 to push
- CURE: 0.0555 HIVE, 999 holders (already above target!)
- HIVE: 6.58 (LOW - needs replenishment)
- BBH: Can sell 464 → 0.84 HIVE

---

## 📁 Key Files

```
Trading Bots
├── vankush-price-pusher.cjs      # Main price pusher
├── hive-content-bot.cjs          # Daily HIVE.blog posts
└── capital-manager.cjs            # 3-tier fund management

Analysis Tools
├── wall-analyzer.cjs              # Buy/sell wall analysis
├── holder-analyzer.cjs            # Ownership distribution
└── psychology-tracker.cjs         # Market metrics

Deployment
├── DEPLOY.sh                      # Interactive deployment
└── .env                           # Credentials (gitignored)
```

---

## 📞 Monitoring Commands

```bash
# Status
pm2 list
pm2 status

# Logs
pm2 logs pusher-dry --lines 50
pm2 logs hive-content

# Control
pm2 restart pusher-dry
pm2 stop all
pm2 delete all

# Update
git pull
pm2 restart all
```

---

## 🎯 Success Metrics

**This Week**:
- [ ] 12hr dry run validated
- [ ] Live trading enabled
- [ ] First HIVE blog post published
- [ ] No crashes for 24h+

**This Month**:
- [ ] VKBT/CURE floors rising
- [ ] 100+ HIVE POWER built
- [ ] Daily blog posts live
- [ ] Tip income started

**3 Months**:
- [ ] Self-sustaining (revenue > costs)
- [ ] 1,000+ HIVE POWER
- [ ] Active HIVE community
- [ ] VKBT approaching 1:1 with HIVE

---

**Built with ❤️ by the Van Kush Family**

*Building value through scarcity, patience, and community* 🚀
