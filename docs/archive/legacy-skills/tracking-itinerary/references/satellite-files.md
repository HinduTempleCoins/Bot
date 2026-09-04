# Satellite Files - Untracked Task Sources

These files contain action items, bugs, and TODOs that may not be reflected in the main ITINERARY.md or MASTER_ITINERARY.md. Check them during consolidation.

## Critical Priority

### BOT_AUDIT.md
- Trading bot analysis with critical fixes
- Price pusher BROKEN (hardcoded bid price, overspending)
- Missing: buy wall analysis, sell logic, psychology tracking, troll bot detection
- 10+ missing features the user requested but were never built
- **~12 untracked items**

### PROJECT_STATUS.md
- 3 critical bugs: Discord message truncation, RS3 null checks, expired API key
- Pending bot tests and cloud deployment tasks
- Success metrics definitions
- **~8 untracked items**

## High Priority

### PLANNING_NEXT_STEPS.md
- 48-hour action plan (monitor bot, import sessions, connect KB)
- Weekly goals and 30-day roadmap
- Critical questions needing answers
- **~15 items, partial overlap with ITINERARY.md**

### TRADING_BOT_STATUS.md
- CURE market status (was dead at time of writing)
- VM debugging steps
- Bot health monitoring checklist
- **~6 untracked items**

### BOT_COMPLETION_SUMMARY.md
- 6+ dialogue trees to add (defi, karma_merit, hannibal_barca, etc.)
- Knowledge base expansion tasks
- Railway deployment verification checklist
- **~15 untracked items**

## Medium Priority

### PRIORITY_ACTION_PLAN.md
- Hour-by-hour 48-hour plan
- Some items done, some not checked off
- **~8 items, high overlap**

### SESSION_SUMMARY.md
- Deploy portfolio tracker, test price pusher
- Build analyzers (psychology, staking APR)
- **~6 items, partial overlap**

### UPDATE_SUMMARY.md
- Railway deployment, API keys, feature testing
- **~5 items, high overlap**

### CURRENT_STATUS.md
- Connect Discord bot to KB API
- Import sessions
- **~3 items, mostly duplicated elsewhere**

## Code-Level TODOs

### vankush-intelligent-trader.cjs
- Line 337: Check last trade time
- Line 378-381: Check Hive.blog, BitcoinTalk, staking APR, community size
- Line 476: Track open orders and update profit
- Line 553: Track and update when filled
- Line 594-595: Trade for profit, buy tokens to stake

### profit-trading-bot.cjs
- Line 523: Check arbitrage spread vs external exchanges
- Line 705: Implement buy order management
- Line 755: Compare profits vs SMA/BB/RSI

### vankush-price-pusher.cjs
- Line 522: Implement automated BLURT selling

### library-of-ashurbanipal-bot/src/wikiGenerator.js
- Line 382: Identify which articles need updating
- Line 399: Regenerate only affected articles

## Future (Not Active)

### COINBASE_INTEGRATION.md
- Full cross-chain bridge architecture
- Not started, Month 3+ timeline
