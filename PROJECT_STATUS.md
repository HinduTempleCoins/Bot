# Van Kush Bot Project - Status & Itinerary

**Last Updated:** 2026-01-09
**Branch:** `claude/update-todos-9iXhF`
**Repository:** HinduTempleCoins/Bot

---

## 🎯 Project Overview

This repository contains multiple bots and tools for the Van Kush Family ecosystem, including:
- Discord bot with AI capabilities (Gemini integration)
- HIVE-Engine trading and market making bots
- Token health scanner and analysis tools
- Polygon blockchain contracts (Burn Mining)
- Future Solana sniper bot

---

## ✅ COMPLETED WORK

### 1. Market Making Analysis (COMPLETED)
**File:** `vankush-market-maker.js`
**Status:** ✅ Committed (219f675)
**Description:** Implemented Van Kush market maker bot for VKBT and CURE tokens
- Detects competing bot behavior on HIVE-Engine
- Implements incremental price nudging strategy
- Places slightly higher buy orders to trigger bot competition
- Safety limits to prevent triggering sell orders
- Whale holder tracking (100k+ tokens)
- Discord notifications for market activity
- Dry run mode for safe testing
- Environment variables for configuration

**Key Features:**
- `NUDGE_INCREMENT`: Tiny price increment above competing bots
- `MAX_NUDGES_PER_DAY`: Daily limit to prevent overtrading
- `NUDGE_INTERVAL`: Time between nudges (default 1 hour)
- `MAX_PRICE_JUMP`: Safety limit to prevent triggering bot sells
- `BUY_WALL_SIZE`: Size of buy walls (default 50 HIVE)
- Whale tracking for 100k+ token holders

**Environment Variables Required:**
```env
HIVE_USERNAME=your_account
HIVE_ACTIVE_KEY=your_key
MM_DRY_RUN=true  # Set to false for live trading
MM_NUDGE_INCREMENT=0.00000010
MM_MAX_NUDGES_DAY=10
MM_NUDGE_INTERVAL=3600000  # milliseconds
MM_DISCORD_WEBHOOK=webhook_url
```

### 2. Token Health Scanner (COMPLETED)
**File:** `token-health-scanner.js`
**Status:** ✅ Committed (cbb2738)
**Description:** Analyzes buy/sell walls and market health
- Detects buy/sell wall imbalances
- Identifies accumulation vs distribution patterns
- Market maker detection
- Supports 50+ HIVE-Engine tokens

### 3. HIVE-Engine Trading Bot (COMPLETED)
**File:** `hive-engine-bot.js`
**Status:** ✅ Committed (9692059)
**Description:** Automated trading bot for HIVE-Engine
- Paper trading mode for testing
- Technical indicators (RSI, MACD, Bollinger Bands)
- Risk management with stop-loss/take-profit
- Discord notifications

### 4. Knowledge Base Updates (COMPLETED)
**Files:** Various `.txt` files in knowledge base
**Status:** ✅ Committed (f398315, 47d946d)
**Description:**
- Detailed information about Kali Van Kush
- Oracle Cloud setup documentation
- Maritime history content
- Angelic AI framework documentation

---

## 🚧 CRITICAL ISSUES (Need Immediate Fix)

### Issue 1: Discord Bot - Message Length Errors
**Severity:** HIGH
**Error:** `DiscordAPIError[50035]: Invalid Form Body - content[BASE_TYPE_MAX_LENGTH]: Must be 2000 or fewer in length`

**Location:** `index.js:916` and `index.js:1381`
**Problem:** Gemini AI responses are not truncated before sending to Discord
- Discord has a 2000 character limit for message content
- Gemini can return responses >2000 characters
- Currently causing failed interactions in Crypt-ology feature

**Solution Needed:**
```javascript
// Truncate long responses
let response = result.response.text();
if (response.length > 1900) {
  response = response.substring(0, 1900) + '...';
}
```

### Issue 2: Discord Bot - Undefined Price Data
**Severity:** MEDIUM
**Error:** `TypeError: Cannot read properties of undefined (reading 'toLocaleString')`

**Location:** `index.js:1180` (RS3 price command)
**Problem:** RuneScape API returns data without expected `price` or `timestamp` fields
- Code assumes `priceData.price` exists
- API might return null or incomplete data
- Causes bot crash on RS3 price lookups

**Solution Needed:**
```javascript
// Add null checks
if (priceData && priceData.price !== undefined) {
  // Display price
} else {
  // Handle missing data gracefully
}
```

### Issue 3: Expired Google/Gemini API Key
**Severity:** HIGH
**Error:** `API key expired. Please renew the API key.`

**Problem:** Google Generative AI API key in environment variables has expired
- All Gemini features failing
- Affects Crypt-ology system, AI conversations, knowledge queries

**Solution Needed:**
1. Get new API key from Google AI Studio
2. Update `.env` file with `GOOGLE_API_KEY=new_key`
3. Restart bot

---

## 📋 PENDING TASKS

### High Priority

#### 1. Fix Discord Bot Errors
- [ ] Truncate Gemini responses to 2000 characters
- [ ] Add null checks for RS3 price data
- [ ] Renew Google/Gemini API key
- [ ] Test all Discord commands after fixes

#### 2. Test Van Kush Market Maker
- [ ] Verify environment variables are set
- [ ] Run in dry run mode with VKBT
- [ ] Run in dry run mode with CURE
- [ ] Monitor for 24 hours
- [ ] Review nudge strategy effectiveness
- [ ] Switch to live trading after verification

#### 3. Test Token Scanner
- [ ] Run scanner against VKBT token
- [ ] Run scanner against CURE token
- [ ] Verify buy/sell wall detection
- [ ] Build historical database
- [ ] Set up automated daily scans

#### 4. Test HIVE-Engine Trading Bot
- [ ] Configure for VKBT/CURE markets
- [ ] Run paper trading for 48 hours
- [ ] Analyze performance metrics
- [ ] Adjust technical indicator parameters
- [ ] Document optimal settings

### Medium Priority

#### 5. Update Discord Bot Knowledge Base
- [ ] Add VKBT tokenomics documentation
- [ ] Add CURE tokenomics documentation
- [ ] Update Van Kush Family lore
- [ ] Add market making strategy explanations
- [ ] Test knowledge retrieval accuracy

#### 6. Deploy HIVE Bot to Cloud
- [ ] Set up Google Cloud VM instance
- [ ] Install Node.js and dependencies
- [ ] Configure PM2 for auto-restart
- [ ] Set up environment variables
- [ ] Configure logging and monitoring
- [ ] Set up Discord webhook notifications
- [ ] Test failover and restart capabilities

### Low Priority

#### 7. Fix Polygon Burn Mining Contracts
**Files:** DFB/DFC contracts
**Problem:** Unspecified bugs in burn mining contracts
- [ ] Identify specific bugs
- [ ] Test on Polygon testnet
- [ ] Deploy fixes to mainnet
- [ ] Verify burn mechanics working

#### 8. Build Solana Sniper Bot
**Purpose:** Quick trading on Solana DEXs
- [ ] Research Solana APIs (Raydium, Jupiter)
- [ ] Design sniper strategy
- [ ] Implement token detection
- [ ] Add safety checks for rug pulls
- [ ] Test on Solana devnet
- [ ] Deploy to mainnet with limits

---

## 📁 Key Files Reference

### Active Bots & Scripts
- `index.js` - Main Discord bot with Gemini AI integration
- `vankush-market-maker.js` - Market maker for VKBT/CURE
- `token-health-scanner.js` - Market analysis tool
- `hive-engine-bot.js` - Automated trading bot

### Configuration
- `.env` - Environment variables (API keys, webhooks, credentials)
- `package.json` - Node.js dependencies

### Data Files
- `vankush-market-state.json` - Market maker state (auto-generated)
- `relationships.json` - Discord user relationship tracking
- `conversation-history.json` - AI conversation history

### Knowledge Base
- `knowledge-base/*.txt` - Various knowledge documents for AI responses

---

## 🔧 Environment Setup

### Required Environment Variables

```env
# Discord
DISCORD_TOKEN=your_bot_token
DISCORD_APPLICATION_ID=your_app_id
HIVE_DISCORD_WEBHOOK=webhook_for_notifications

# Google/Gemini AI
GOOGLE_API_KEY=your_gemini_key  # ⚠️ EXPIRED - NEEDS RENEWAL

# HIVE Blockchain
HIVE_USERNAME=your_account
HIVE_ACTIVE_KEY=your_active_key
HIVE_POSTING_KEY=your_posting_key

# Market Maker Config
MM_DRY_RUN=true  # Set false for live trading
MM_NUDGE_INCREMENT=0.00000010
MM_MAX_NUDGES_DAY=10
MM_NUDGE_INTERVAL=3600000
MM_BUY_WALL_SIZE=50
MM_SUPPORT_SIZE=25
MM_MIN_WHALE=100000
MM_DISCORD_WEBHOOK=webhook_url

# Trading Bot Config
HIVE_BOT_DRY_RUN=true
HIVE_BOT_MAX_TRADE_SIZE=100
HIVE_BOT_STOP_LOSS=0.05
HIVE_BOT_TAKE_PROFIT=0.15
```

---

## 🚀 Quick Start for New AI Instance

If starting a new AI instance, follow this checklist:

1. **Read this file first** (`PROJECT_STATUS.md`)
2. **Check git status** to see uncommitted changes
3. **Review .env file** to ensure all API keys are valid
4. **Check running processes** (`pm2 list` if using PM2)
5. **Review recent commits** (`git log -5`) to understand latest changes
6. **Read error logs** in console or log files
7. **Update todo list** with TodoWrite tool based on current priorities

### Commands for Context Gathering

```bash
# Check git status
git status
git log -5 --oneline

# Check running bots
pm2 list
pm2 logs

# Test environment variables
node -e "require('dotenv').config(); console.log(process.env.GOOGLE_API_KEY ? 'API key loaded' : 'API key missing')"

# Check dependencies
npm list --depth=0
```

---

## 📊 Project Metrics

### Completed Features: 4
- Market maker bot
- Token health scanner
- HIVE-Engine trading bot
- Knowledge base updates

### Critical Bugs: 3
- Discord message length errors
- Undefined price data crashes
- Expired API key

### Pending Tasks: 8
- Fix Discord bot errors (HIGH)
- Test market maker (HIGH)
- Test token scanner (HIGH)
- Test trading bot (HIGH)
- Update knowledge base (MEDIUM)
- Deploy to cloud (MEDIUM)
- Fix Polygon contracts (LOW)
- Build Solana bot (LOW)

### Estimated Completion: ~80% of core features done, ~20% testing/deployment remaining

---

## 💡 Notes for Future Development

1. **Market Maker Strategy:** The nudge increment approach is novel and should be monitored closely. Consider adding machine learning to optimize nudge timing.

2. **Bot Security:** All bots currently use environment variables for keys. Consider implementing key rotation and encrypted storage for production.

3. **Scalability:** As the project grows, consider microservices architecture with separate bots running independently.

4. **Monitoring:** Set up proper logging and alerting (Datadog, Sentry, or similar) for production deployments.

5. **Testing:** Add unit tests and integration tests before deploying to production with real funds.

6. **Documentation:** Keep this file updated with every major change. It's the source of truth for project status.

---

## 🆘 Emergency Contacts & Resources

- **HIVE-Engine API:** https://hive-engine.com
- **HIVE-Engine Docs:** https://hive-engine.github.io/engine-docs/
- **Discord.js Docs:** https://discord.js.org
- **Google Gemini API:** https://ai.google.dev/
- **RuneScape Wiki API:** https://api.weirdgloop.org/

---

**Remember:** Always test with `DRY_RUN=true` before enabling live trading!
