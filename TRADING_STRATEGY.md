# Van Kush Trading Strategy & Bot Architecture

**Version:** 1.0
**Date:** 2026-01-09
**Status:** Strategic Planning Phase

---

## 🎯 Primary Mission

**Raise the price of VKBT and CURE tokens on HIVE-Engine while generating profit**

---

## 📊 Token Priority Hierarchy

### Tier 1: Core Van Kush Tokens (HIGHEST PRIORITY)
- **VKBT** (Van Kush Beauty Token)
- **CURE** (Van Kush Token)

**Goal:** Maximize price appreciation
**Strategy:** Active market making with price nudging
**Current Bot:** `vankush-market-maker.js`

### Tier 2: Strategic Secondary Token
- **BLURT**

**Goal:** Prefer raising BLURT price over other non-Van Kush tokens
**Reason:** BLURT is part of capital base and ecosystem alignment

### Tier 3: Capital Base Tokens
- **HIVE** (Primary capital source)
- **BLURT** (Secondary capital source)

**Goal:** Accumulate more HIVE than starting amount
**Strategy:** Use profits to build HIVE reserves for Van Kush token purchases

### Tier 4: Arbitrage Opportunities
- **Swap.DOGE** - Wrapped Dogecoin
- **Swap.BTC** - Wrapped Bitcoin
- **Swap.LTC** - Wrapped Litecoin
- Other Swap.* tokens

**Goal:** Compare HIVE-Engine prices with external exchanges for arbitrage
**Strategy:** Find price discrepancies between HIVE-Engine and external markets

### Tier 5: Other Tokens
- Portfolio diversification tokens
- Opportunistic trades

---

## 💰 Capital Strategy

### Starting Capital Sources
1. **BLURT** - Secondary capital, also a strategic token
2. **HIVE** - Primary capital, accumulation target
3. **Other tokens** - Portfolio holdings

### Capital Allocation
- Most trading capital comes from BLURT and HIVE
- Profits reinvested to:
  1. Buy more VKBT/CURE (raise prices)
  2. Accumulate HIVE (build reserves)
  3. Strategic BLURT accumulation

### Success Metric
**End HIVE balance > Starting HIVE balance**

While raising VKBT and CURE prices as much as possible.

---

## 🤖 Bot Architecture Requirements

### Phase 1: Current Capabilities ✅
- [x] Market maker for VKBT and CURE
- [x] Price nudging strategy
- [x] Dry run testing mode
- [x] Order book analysis
- [x] Whale tracking

### Phase 2: Portfolio Awareness 🚧 IN PROGRESS
**File:** `portfolio-tracker.js` (to be created)

**Features Needed:**
1. **Wallet Monitoring**
   - Read bot's HIVE-Engine wallet balance
   - Track all token holdings
   - Monitor HIVE balance changes

2. **HIVE Price Tracking**
   - Track HIVE/USD price from external sources (CoinGecko, Binance)
   - Compare current HIVE price to:
     - Yesterday's price
     - Price when bot made first HIVE purchase
     - 7-day moving average
   - Calculate % gain/loss on HIVE holdings

3. **Portfolio Value Calculator**
   - Calculate total portfolio value in HIVE
   - Calculate total portfolio value in USD
   - Track daily P&L

**Data Sources:**
- HIVE-Engine API: Wallet balances
- CoinGecko API: HIVE/USD, BTC/USD, DOGE/USD, LTC/USD
- Binance API: Real-time prices for arbitrage

### Phase 3: Arbitrage Scanner 🔮 PLANNED
**File:** `arbitrage-scanner.js` (to be created)

**Features Needed:**
1. **Price Comparison**
   - Fetch Swap.BTC price on HIVE-Engine (in HIVE)
   - Fetch BTC/USD from Binance/Coinbase
   - Fetch HIVE/USD from external exchange
   - Calculate if arbitrage opportunity exists

2. **Arbitrage Detector**
   ```javascript
   // Example calculation
   const swapBTCPriceInHIVE = 0.5 HIVE;
   const hivePriceUSD = 0.30 USD;
   const swapBTCPriceUSD = swapBTCPriceInHIVE * hivePriceUSD;
   const actualBTCPriceUSD = 95000 USD;

   // If swapBTCPriceUSD < actualBTCPriceUSD, opportunity exists
   ```

3. **Arbitrage Execution**
   - Buy underpriced Swap.* token on HIVE-Engine
   - Unwrap token (convert Swap.BTC → BTC)
   - Sell BTC on external exchange for USD
   - Buy HIVE with USD
   - Deposit HIVE back to HIVE-Engine
   - Profit!

**Challenges:**
- Withdrawal fees
- Swap fees
- Time delays (arbitrage window may close)
- Minimum trade sizes

**Initial Strategy:**
- Only alert on opportunities (don't auto-trade)
- Manual approval for arbitrage trades
- Build confidence with dry runs

### Phase 4: BLURT Preference Engine 🔮 PLANNED
**File:** Update `hive-trading-bot.js`

**Features Needed:**
- When analyzing trading opportunities, apply multiplier to BLURT
- Example: If BLURT opportunity is 5% profit, treat as 7% (apply 1.4x bonus)
- This makes bot prefer BLURT trades over equally profitable alternatives

### Phase 5: Staking/Unstaking (FUTURE) 🌟
**Prerequisites:**
- HIVE posting/voting bot must be created first
- Bot needs HIVE.blog account information
- Curation rewards calculation system

**Why Wait:**
- Staking locks tokens for 13 weeks on HIVE
- Staked HIVE earns curation rewards through voting
- Need to calculate if curation rewards > trading opportunity cost
- Bot must understand its earning potential from content curation

**Future Features:**
1. **Staking Decision Logic**
   ```
   IF (expected_curation_rewards > expected_trading_profits):
       stake_hive()
   ELSE:
       keep_liquid_for_trading()
   ```

2. **Account Coordination**
   - Monitor HIVE account voting power
   - Track curation rewards earned
   - Calculate optimal stake/liquid ratio
   - Power up/down based on trading vs curation strategy

---

## 📈 Trading Logic Flow

### Decision Tree for Each Trading Cycle

```
1. CHECK WALLET
   ├─ Current HIVE balance
   ├─ Current VKBT/CURE holdings
   ├─ Current BLURT balance
   └─ Other token balances

2. CHECK HIVE PRICE
   ├─ Current HIVE/USD
   ├─ HIVE price change since yesterday
   ├─ HIVE price change since bot started
   └─ Trend direction

3. PRIMARY MISSION: VKBT/CURE
   ├─ Check VKBT order book
   ├─ Check CURE order book
   ├─ Execute price nudging (if conditions met)
   └─ Goal: Raise prices

4. ARBITRAGE SCAN
   ├─ Check Swap.BTC vs BTC/USD
   ├─ Check Swap.DOGE vs DOGE/USD
   ├─ Check Swap.LTC vs LTC/USD
   └─ Alert if opportunity > 5% profit after fees

5. BLURT OPPORTUNITIES
   ├─ Check BLURT order book
   ├─ Apply preference multiplier (1.4x)
   └─ Execute if profitable

6. OTHER OPPORTUNITIES
   ├─ Scan all other tokens
   └─ Execute only if highly profitable (>10%)

7. REPORT
   ├─ Update portfolio value
   ├─ Calculate daily P&L
   ├─ Report HIVE accumulation progress
   └─ Send Discord notification
```

---

## 🎮 Bot Interaction & Control

### Commands (Discord or CLI)

```bash
# Portfolio Status
/portfolio          # Show all token balances
/hive-price         # Show current HIVE price and changes
/pnl                # Show profit/loss report

# Trading Status
/vkbt-status        # VKBT market status and bot actions
/cure-status        # CURE market status and bot actions
/arbitrage          # Show current arbitrage opportunities

# Control Commands
/start-trading      # Enable live trading (from dry run)
/stop-trading       # Pause all trading
/emergency-stop     # Emergency stop all orders

# Strategy Adjustments
/set-priority <token> <level>    # Adjust token priority
/set-capital <amount> HIVE       # Set max capital to use
```

---

## 📊 Success Metrics

### Daily Metrics
- [ ] VKBT price increase (% per day)
- [ ] CURE price increase (% per day)
- [ ] HIVE balance increase (vs starting balance)
- [ ] Total portfolio value in USD
- [ ] Successful arbitrage trades executed
- [ ] BLURT balance change

### Weekly Metrics
- [ ] VKBT 7-day price change
- [ ] CURE 7-day price change
- [ ] HIVE accumulation (total added)
- [ ] Trading volume generated
- [ ] Number of successful nudges executed

### Monthly Metrics
- [ ] VKBT monthly price appreciation
- [ ] CURE monthly price appreciation
- [ ] HIVE reserves built
- [ ] Total profit in USD
- [ ] ROI on starting capital

---

## 🔒 Risk Management

### Safety Limits
1. **Max Trade Size**: Never risk more than 5% of portfolio on single trade
2. **Max Daily Loss**: Stop trading if daily loss exceeds 10%
3. **HIVE Reserve**: Always maintain minimum 100 HIVE liquid
4. **Price Impact**: Avoid trades that would move market >3%

### Emergency Conditions
- [ ] If HIVE price drops >20% in 24h → pause all trading
- [ ] If VKBT/CURE volume drops to zero → pause market making
- [ ] If arbitrage opportunity seems "too good to be true" → manual review required

---

## 🚀 Development Roadmap

### Immediate (This Week)
- [ ] Create portfolio tracker bot
- [ ] Implement HIVE price monitoring
- [ ] Test market maker with real credentials (dry run)

### Short Term (This Month)
- [ ] Create arbitrage scanner
- [ ] Add BLURT preference logic
- [ ] Set up Discord command interface
- [ ] Deploy to Oracle Cloud free tier

### Medium Term (Next 3 Months)
- [ ] Build HIVE posting/voting bot
- [ ] Create curation rewards calculator
- [ ] Test arbitrage trades manually
- [ ] Optimize market making strategy based on data

### Long Term (6+ Months)
- [ ] Implement staking/unstaking logic
- [ ] Coordinate trading with content rewards
- [ ] Expand to other DEXs (TribalDEX, LeoDEX)
- [ ] Build Solana sniper bot for cross-chain opportunities

---

## 📚 Reference Materials

### HIVE-Engine Documentation
- API Docs: https://hive-engine.github.io/engine-docs/
- Token List: https://hive-engine.com/tokens
- Market Pairs: https://hive-engine.com/markets

### Arbitrage Resources
- CoinGecko API: https://www.coingecko.com/api/documentation
- Binance API: https://binance-docs.github.io/apidocs/
- HIVE Price Sources: Binance, Upbit, Probit

### Bot Examples
- PIZZA Bot (GitHub)
- HIVE-Engine trade bots
- Crypto arbitrage bot examples

---

## 💡 Strategy Notes

### Why This Approach Works

1. **Primary Mission Alignment**: Focus on VKBT/CURE ensures Van Kush Family benefits
2. **Capital Preservation**: Building HIVE reserves ensures long-term sustainability
3. **Arbitrage Income**: Swap.* tokens provide steady profit opportunities
4. **BLURT Preference**: Supports ecosystem while generating profit
5. **Future Content Integration**: Staking strategy maximizes both trading and curation rewards

### The "Virtuous Cycle"

```
Arbitrage Profits
    ↓
Buy VKBT/CURE (raises prices)
    ↓
Build HIVE Reserves
    ↓
More capital for trading
    ↓
Larger buy walls for VKBT/CURE
    ↓
Attract more traders (volume increases)
    ↓
VKBT/CURE become more liquid
    ↓
Easier to accumulate at good prices
    ↓
More Arbitrage Profits
(Cycle repeats)
```

---

**Remember:** This bot is not just a profit maximizer—it's a strategic tool to raise Van Kush token values while building a sustainable HIVE reserve for the family.
