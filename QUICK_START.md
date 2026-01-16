# 🚀 QUICK START - Deploy Trading Bot NOW!

**Status**: ✅ Everything ready to deploy
**Time to Deploy**: 5 minutes
**Risk**: LOW (can start in dry run mode)

---

## Option 1: Deploy on Local Machine (Recommended for Testing)

### Step 1: Install Dependencies
```bash
cd /home/user/Bot
npm install
```

### Step 2: Check Configuration
```bash
# Verify .env has your credentials
cat .env | grep HIVE_USERNAME
cat .env | grep HIVE_ACTIVE_KEY
cat .env | grep MM_DRY_RUN

# Should show:
# HIVE_USERNAME=angelicalist
# HIVE_ACTIVE_KEY=5Jiry4...
# MM_DRY_RUN=true
```

### Step 3: Run Deployment Script
```bash
./DEPLOY.sh
```

Choose option:
- **Option 1**: Portfolio tracker only (safest)
- **Option 2**: Price pusher DRY RUN (recommended first!)
- **Option 5**: Test everything first

### Step 4: Monitor
```bash
# View all running bots
pm2 list

# View logs
pm2 logs

# Check current opportunities
node test-wall-analyzer.cjs
```

---

## Option 2: Deploy to Google VM

### Step 1: SSH into Google VM
```bash
# From your local machine
ssh your-google-vm-ip

# Or use the screenshot method you showed me
```

### Step 2: Clone/Pull Repository
```bash
# If not already cloned
git clone https://github.com/HinduTempleCoins/Bot.git
cd Bot

# If already cloned
cd Bot
git pull origin claude/update-todos-9iXhF
```

### Step 3: Install Dependencies
```bash
npm install
```

### Step 4: Configure .env
```bash
# Create .env file
nano .env

# Add these lines:
HIVE_USERNAME=angelicalist
HIVE_ACTIVE_KEY=5Jiry4HonWcA9JGDraVX7FzUeqrMFT3kpgoZiW29G1v5qSSgtX2
HIVE_POSTING_KEY=5JvcfuzD48YQadVVA45v3MUk4DCZXkQXr2o4Z9dTPEa7RGhtrK6
MM_DRY_RUN=true
HIVE_BOT_DRY_RUN=true
BLURT_PREFERENCE_MULTIPLIER=1.4

# Save: Ctrl+O, Enter, Ctrl+X
```

### Step 5: Run Deployment
```bash
chmod +x DEPLOY.sh
./DEPLOY.sh
```

---

## What Each Bot Does

### 1. Portfolio Tracker
**What**: Monitors your @angelicalist wallet 24/7
**Risk**: ZERO (read-only)
**Cost**: FREE
**Benefit**: Tracks holdings, alerts on changes

**Start with**:
```bash
pm2 start vankush-portfolio-tracker.cjs --name portfolio
pm2 save
pm2 logs portfolio
```

### 2. Price Pusher (DRY RUN)
**What**: Simulates VKBT/CURE price pushing
**Risk**: ZERO (no real trades)
**Cost**: FREE
**Benefit**: See strategy in action, validate logic

**Start with**:
```bash
# Ensure dry run is enabled
echo "MM_DRY_RUN=true" >> .env

pm2 start vankush-price-pusher.cjs --name pusher-dry
pm2 save
pm2 logs pusher-dry
```

**Watch for**:
- "🔒 DRY RUN" messages
- Opportunity detection
- Budget tracking
- Cooldown logic

### 3. Price Pusher (LIVE)
**What**: REAL VKBT/CURE price pushing
**Risk**: LOW ($0.87 per push, max $10/day)
**Cost**: $5-10/week
**Benefit**: Actual price anchoring, holder growth

**Only start after 24h dry run!**
```bash
# Disable dry run
sed -i 's/MM_DRY_RUN=true/MM_DRY_RUN=false/' .env

pm2 start vankush-price-pusher.cjs --name pusher-live
pm2 save
pm2 logs pusher-live --lines 100
```

---

## Recommended Deployment Path

### Day 1: Testing
```bash
# Test all analyzers
node test-wall-analyzer.cjs
node holder-analyzer.cjs
node psychology-tracker.cjs

# If all pass, start portfolio tracker
pm2 start vankush-portfolio-tracker.cjs --name portfolio
pm2 save
```

### Day 2: Dry Run
```bash
# Ensure dry run enabled
grep "MM_DRY_RUN=true" .env

# Start price pusher (dry)
pm2 start vankush-price-pusher.cjs --name pusher-dry
pm2 save

# Monitor for 24 hours
pm2 logs pusher-dry
```

### Day 3: Go Live (Optional)
```bash
# Review dry run results
pm2 logs pusher-dry --lines 500

# If satisfied, enable live trading
sed -i 's/MM_DRY_RUN=true/MM_DRY_RUN=false/' .env

pm2 delete pusher-dry
pm2 start vankush-price-pusher.cjs --name pusher-live
pm2 save

# Monitor CLOSELY for first hour!
pm2 logs pusher-live --lines 50 --follow
```

---

## Monitoring & Analysis

### Real-Time Monitoring
```bash
# View all bot status
pm2 list

# View live logs
pm2 logs

# View specific bot
pm2 logs portfolio
pm2 logs pusher-live

# Restart if needed
pm2 restart all
```

### Daily Analysis
```bash
# Check current opportunities
node test-wall-analyzer.cjs

# Update holder distribution
node holder-analyzer.cjs

# Capture market snapshot
node psychology-tracker.cjs
```

### Weekly Analysis
```bash
# Generate weekly report
node psychology-tracker.cjs --report

# Review:
# - Holder growth (goal: +10%)
# - Sell wall floor rising (goal: +20%)
# - Push cost increasing (good - market solidifying!)
```

---

## Current Live Data

**VKBT Opportunity** (as of 2026-01-10):
```
Cost to push: $0.87 USD ✅ AFFORDABLE
Holders: 986 unique wallets
Market: ALIVE
Recommendation: BUY_UP_WALL
```

**CURE Opportunity**:
```
Holders: 999 unique wallets
Market: READY TO PUSH
Supply: Only 55K exist (EXTREME scarcity!)
```

---

## Troubleshooting

### Bot Won't Start
```bash
# Check logs
pm2 logs --lines 50

# Check .env
cat .env

# Reinstall dependencies
npm install

# Try manual run
node vankush-price-pusher.cjs
```

### No Opportunities Found
```bash
# Check market data
node test-wall-analyzer.cjs

# If shows "Too expensive":
# - Wait for cheaper opportunity
# - Markets fluctuate, check again in 1-2 hours

# If shows "NO_SELL_ORDERS":
# - Market has no sell orders
# - Check again later or manually place orders
```

### Budget Exhausted
```bash
# Check spending
pm2 logs pusher-live | grep "Budget Status"

# If exhausted:
# - Wait for daily reset (24h from last reset)
# - Or increase MAX_DAILY_BUDGET_HIVE in .env
```

---

## Safety Checks

**Before Going Live**:
- ✅ Dry run tested for 24+ hours
- ✅ Logs show correct behavior
- ✅ No errors in dry run
- ✅ Budget limits set in .env
- ✅ HIVE balance sufficient (> 10 HIVE recommended)

**Red Flags** (stop immediately!):
- ❌ Buying at prices above target
- ❌ Spending entire budget in minutes
- ❌ Cooldowns not working
- ❌ API errors repeatedly

**Green Flags** (working correctly):
- ✅ Only buys when < $2 USD
- ✅ Respects cooldowns (6h major, 1h micro)
- ✅ Tracks budget correctly
- ✅ Logs show "Affordable: YES"

---

## PM2 Commands Reference

```bash
# List all bots
pm2 list

# Start a bot
pm2 start vankush-price-pusher.cjs --name pusher

# Stop a bot
pm2 stop pusher

# Restart a bot
pm2 restart pusher

# Delete a bot
pm2 delete pusher

# View logs
pm2 logs pusher
pm2 logs pusher --lines 100
pm2 logs pusher --lines 50 --follow

# Save current setup (survives reboot)
pm2 save

# Setup PM2 to start on boot
pm2 startup

# Stop all bots
pm2 stop all

# Restart all bots
pm2 restart all

# Delete all bots
pm2 delete all
```

---

## Next Steps After Deployment

### Week 1:
- Monitor logs daily
- Check holder-analyzer once/day
- Capture psychology snapshot daily
- Adjust if needed

### Week 2-4:
- Generate weekly reports
- Track holder growth
- Monitor sell wall floor
- Look for price anchoring signs

### Month 2-3:
- Expand to other tokens (BBH, LEO)
- Optimize push frequency
- Consider Coinbase Wallet integration
- Celebrate self-sustainability! 🎉

---

**YOU'RE READY TO DEPLOY!** 🚀

Choose your path:
- **Conservative**: Start with portfolio tracker only
- **Recommended**: Portfolio + price pusher (dry run 24h)
- **Aggressive**: All bots live (after testing)

**Command to start**:
```bash
./DEPLOY.sh
```

Then select your option and let the bot do its magic! 🎯
