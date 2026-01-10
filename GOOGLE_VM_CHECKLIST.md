# Google VM Trading Bot Checklist

**You're currently SSH'd into the Google VM. Here's what to check:**

---

## ✅ Step 1: Check if Bot is Running

```bash
pm2 list
```

**Expected output:**
```
┌─────┬────────────────────────┬─────────┬─────────┬───────┐
│ id  │ name                   │ mode    │ ↺      │ status │
├─────┼────────────────────────┼─────────┼─────────┼────────┤
│ 0   │ vankush-price-pusher   │ fork    │ 0      │ online │
└─────┴────────────────────────┴─────────┴─────────┴────────┘
```

**If bot is NOT listed:**
```bash
# Start it
pm2 start vankush-price-pusher.cjs --name vankush-price-pusher

# Or if using different file:
pm2 start hive-trading-bot.cjs --name hive-trading-bot
```

---

## ✅ Step 2: Check Bot Logs

```bash
pm2 logs vankush-price-pusher --lines 50
```

**Look for:**
- ✅ "💰 MAJOR PUSH" or "🔹 MICRO PUSH" = Bot is actively trading
- ✅ "⏳ Waiting..." = Bot is running but waiting for conditions
- ❌ Errors or crashes = Need to fix

**Common log messages:**
- `"Too expensive"` = Push costs > $2 USD (normal, bot waits)
- `"Cooldown active"` = Bot waiting between pushes (normal)
- `"Budget exhausted"` = Hit 5 HIVE/day limit (normal safety)
- `"Market not healthy"` = Not enough trades/week (might be issue)

---

## ✅ Step 3: Check .env Configuration

```bash
cat .env
```

**Critical settings:**

```bash
# Must be angelicalist
HIVE_USERNAME=angelicalist

# Must have the active key
HIVE_ACTIVE_KEY=5J...

# Should be false for live trading
MM_DRY_RUN=false
```

**If wrong, edit:**
```bash
nano .env
# Fix the values
# Press Ctrl+X, then Y, then Enter to save
```

---

## ✅ Step 4: Check HIVE Balance

```bash
curl -s -X POST https://api.hive-engine.com/rpc/contracts \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "find",
    "params": {
      "contract": "tokens",
      "table": "balances",
      "query": {"account": "angelicalist", "symbol": "SWAP.HIVE"},
      "limit": 1
    }
  }' | python3 -m json.tool
```

**Check if you have HIVE to trade with!**

---

## ✅ Step 5: Check Current Orders

```bash
# VKBT orders
curl -s -X POST https://api.hive-engine.com/rpc/contracts \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "find",
    "params": {
      "contract": "market",
      "table": "buyBook",
      "query": {"account": "angelicalist", "symbol": "VKBT"},
      "limit": 10
    }
  }' | python3 -m json.tool
```

**If result is `[]`** = No open orders (bot not placing orders)

---

## ✅ Step 6: Restart Bot

**If configuration was wrong:**

```bash
pm2 restart vankush-price-pusher
pm2 logs vankush-price-pusher --lines 100
```

Watch logs to see what bot does on next check cycle (every 15 minutes).

---

## 🎯 What You're Looking For

### ✅ Bot is Working if:
1. `pm2 list` shows bot as "online"
2. Logs show checks every 15 minutes
3. `.env` has `HIVE_USERNAME=angelicalist`
4. `.env` has `MM_DRY_RUN=false`
5. Account has SWAP.HIVE balance

### ❌ Bot is NOT Working if:
1. `pm2 list` shows nothing or "errored"
2. No logs appearing
3. `.env` has wrong account
4. `.env` has `MM_DRY_RUN=true`
5. No HIVE balance to trade with

---

## 🔧 Common Fixes

### Problem: Bot Not in pm2 list
```bash
cd /home/mahatmajapa/Bot  # Or wherever bot code is
pm2 start vankush-price-pusher.cjs
pm2 save
```

### Problem: Bot Crashing
```bash
pm2 logs vankush-price-pusher --lines 100
# Look for error message
# Common: Missing .env file, wrong path, missing npm packages
```

### Problem: Wrong Account
```bash
nano .env
# Change HIVE_USERNAME=angelicalist
pm2 restart vankush-price-pusher
```

### Problem: Dry Run Enabled
```bash
nano .env
# Change MM_DRY_RUN=false
pm2 restart vankush-price-pusher
```

### Problem: No npm packages
```bash
cd /home/mahatmajapa/Bot
npm install
pm2 restart vankush-price-pusher
```

---

## 📊 Expected Bot Behavior

**When working correctly:**

**Every 15 minutes**, bot should:
1. Log: "Checking VKBT and CURE opportunities..."
2. Fetch current prices and sell walls
3. Calculate push costs

**If opportunity found:**
- Log: "💰 MAJOR PUSH" or "🔹 MICRO PUSH"
- Place buy order on HIVE-Engine
- Log transaction ID

**If no opportunity:**
- Log: "⏳ Waiting for better conditions"
- Reasons: Too expensive, cooldown, budget hit, market dead

**After a few hours:**
- You should see open buy orders (check with curl above)
- VKBT/CURE balance increasing
- SWAP.HIVE balance decreasing

---

## 🚨 Critical Notes

1. **Budget is 5 HIVE/day** (~$1.50 USD) - conservative start
2. **Cooldowns:** 6h between major pushes, 1h between micro
3. **Only buys if cheap:** Cost must be < $2 USD
4. **CURE market might be dead:** No sell orders = nothing to buy

---

## 📞 Next Steps After Checking

1. Run through all steps above
2. Note what you find (bot status, errors, configuration)
3. Fix any issues
4. Wait 15-30 minutes for next bot cycle
5. Check again if orders appearing

---

## 💡 Quick Reference

```bash
# Check bot status
pm2 list
pm2 logs vankush-price-pusher

# Check config
cat .env | grep HIVE_USERNAME
cat .env | grep MM_DRY_RUN

# Restart bot
pm2 restart vankush-price-pusher

# Check balance
curl -s -X POST https://api.hive-engine.com/rpc/contracts \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"find","params":{"contract":"tokens","table":"balances","query":{"account":"angelicalist","symbol":"SWAP.HIVE"},"limit":1}}' | python3 -m json.tool
```
