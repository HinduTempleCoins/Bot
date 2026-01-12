# Van Kush Portfolio Tracker Bot

**Purpose**: Monitor HIVE-Engine wallet balances and calculate portfolio value in real-time.

**Status**: ✅ Ready for testing

---

## Features

### Core Functionality
- ✅ Fetches all token balances from HIVE-Engine account
- ✅ Calculates portfolio value in HIVE and USD
- ✅ Tracks HIVE price from CoinGecko with 24h changes
- ✅ Monitors priority tokens (VKBT, CURE, BLURT, SWAP.HIVE)
- ✅ Records starting balances for performance comparison
- ✅ Saves historical data to JSON file
- ✅ Generates periodic reports (console + optional Discord)

### Performance Metrics
- **HIVE Balance Change**: Track if you're accumulating or depleting HIVE
- **HIVE Price Change**: Monitor HIVE/USD price movement since bot start
- **Token Holdings Change**: Track VKBT/CURE accumulation
- **Portfolio Value**: Total value in HIVE and USD

### Data Persistence
- All updates saved to `vankush-portfolio-data.json`
- Keeps last 1000 updates (prevents file bloat)
- Survives bot restarts (loads historical data on startup)
- Graceful shutdown saves final state (Ctrl+C)

---

## Configuration

### Environment Variables

Required:
```env
HIVE_USERNAME=your_hive_account
```

Optional:
```env
HIVE_DISCORD_WEBHOOK=your_discord_webhook_url
```

### Bot Settings

Edit these in the file if needed:
```javascript
UPDATE_INTERVAL: 300000,     // 5 minutes (in milliseconds)
REPORT_EVERY: 12,            // Full report every 12 updates (1 hour)
PRIORITY_TOKENS: ['VKBT', 'CURE', 'BLURT', 'SWAP.HIVE']
```

---

## Installation & Usage

### 1. Install Dependencies

Already installed if you ran `npm install` for the main bot:
- axios
- dotenv

### 2. Configure Environment

Edit `.env`:
```env
HIVE_USERNAME=your_actual_hive_account
HIVE_DISCORD_WEBHOOK=https://discord.com/api/webhooks/...
```

### 3. Test Run

```bash
node vankush-portfolio-tracker.js
```

You should see:
```
💎 Van Kush Portfolio Tracker Starting...
📊 Monitoring account: your_account
⏱️  Update interval: 300 seconds
📢 Report every: 12 updates

⏰ Portfolio update #1 - 1/9/2026, 10:30:00 AM
📡 Fetching account balances...
📡 Fetching HIVE price...
📡 Fetching token metrics...
💹 Calculating portfolio value...

============================================================
💎 VAN KUSH PORTFOLIO REPORT
============================================================

📊 HIVE Price: $0.3250
   24h Change: +2.35%

💰 Total Portfolio Value:
   1,234.56 HIVE
   $401.23 USD

🎯 Priority Tokens:
   VKBT: 10,000.0000 (25.00 HIVE / $8.13)
   CURE: 5,000.0000 (15.00 HIVE / $4.88)
   BLURT: 2,500.0000 (100.00 HIVE / $32.50)
   SWAP.HIVE: 1,000.0000 (1000.00 HIVE / $325.00)

============================================================

✅ Portfolio tracker is running. Press Ctrl+C to stop.
```

### 4. Deploy to Cloud (Optional)

**Oracle Cloud Free Tier** (recommended):

```bash
# Install PM2 for process management
npm install -g pm2

# Start portfolio tracker
pm2 start vankush-portfolio-tracker.js --name vankush-portfolio

# Enable auto-restart on server reboot
pm2 startup
pm2 save

# View logs
pm2 logs vankush-portfolio
```

---

## Output Examples

### Console Update (Every 5 minutes)
```
⏰ Portfolio update #5 - 1/9/2026, 11:00:00 AM
📡 Fetching account balances...
📡 Fetching HIVE price...
📡 Fetching token metrics...
💹 Calculating portfolio value...
✅ Update complete. Total value: 1,234.56 HIVE ($401.23)
```

### Full Report (Every hour)
```
============================================================
💎 VAN KUSH PORTFOLIO REPORT
============================================================

📊 HIVE Price: $0.3250
   24h Change: +2.35%

💰 Total Portfolio Value:
   1,250.00 HIVE
   $406.25 USD

📈 Performance Since Start:
   HIVE Balance: +1.25%
   HIVE Price: +0.50%
   VKBT Holdings: +5.00%
   CURE Holdings: +3.50%

🎯 Priority Tokens:
   VKBT: 10,500.0000 (26.25 HIVE / $8.53)
   CURE: 5,175.0000 (15.53 HIVE / $5.05)
   BLURT: 2,500.0000 (100.00 HIVE / $32.50)
   SWAP.HIVE: 1,012.50 (1012.50 HIVE / $329.06)

📦 Top 5 Other Holdings:
   LEO: 1,234.5678 ($12.34)
   PIZZA: 100.0000 ($5.50)
   BEE: 50.0000 ($3.25)
   WORKERBEE: 10.0000 ($45.00)
   UTOPIS: 5.0000 ($2.50)

============================================================
```

### Discord Webhook Report

When `HIVE_DISCORD_WEBHOOK` is configured, sends rich embed:

**Van Kush Portfolio Update**
```
📊 HIVE Price: $0.3250 (+2.35% 24h)
💰 Portfolio Value: 1,250.00 HIVE / $406.25 USD

VKBT: 10,500.0000 / $8.53
CURE: 5,175.0000 / $5.05
BLURT: 2,500.0000 / $32.50
SWAP.HIVE: 1,012.50 / $329.06

📈 Performance: HIVE: +1.25% | Price: +0.50%
```

---

## Data File Structure

**vankush-portfolio-data.json**:
```json
{
  "startTime": "2026-01-09T15:30:00.000Z",
  "startingBalances": {
    "VKBT": {
      "amount": 10000,
      "valueHive": 25,
      "valueUSD": 8.125
    },
    "CURE": {
      "amount": 5000,
      "valueHive": 15,
      "valueUSD": 4.875
    }
  },
  "startingHivePrice": 0.325,
  "updates": [
    {
      "timestamp": "2026-01-09T15:30:00.000Z",
      "totalValueHive": 1234.56,
      "totalValueUSD": 401.23,
      "hivePrice": 0.325,
      "priorityTokens": { ... }
    }
  ],
  "dailySnapshots": []
}
```

---

## Integration with Trading Bots

This portfolio tracker provides critical data for:

1. **Market Maker Bot** (`vankush-market-maker.js`)
   - Confirm VKBT/CURE accumulation is working
   - Monitor HIVE reserve levels

2. **Arbitrage Scanner** (planned)
   - Track if arbitrage trades are increasing HIVE balance
   - Calculate net profit after fees

3. **BLURT Preference Engine** (planned)
   - Verify BLURT preference multiplier is working
   - Monitor BLURT accumulation vs other tokens

4. **Discord Bot** (`index.js`)
   - Add `/portfolio` command to query current balances
   - Add `/pnl` command to show performance metrics

---

## Troubleshooting

### "Error fetching account balances"
- Check HIVE_USERNAME is correct in .env
- Verify HIVE-Engine API is accessible: https://engine.rishipanthee.com

### "Could not fetch HIVE price"
- CoinGecko API may be rate-limited (free tier)
- Bot will skip update and retry in 5 minutes
- Consider upgrading to CoinGecko Pro for higher limits

### "No priority tokens found"
- Account may have zero balances
- Verify account exists on HIVE-Engine
- Check token symbols are correct (case-sensitive)

### Data file too large
- Bot automatically keeps only last 1000 updates
- Can manually delete `vankush-portfolio-data.json` to reset
- Starting balances will be re-recorded on next run

---

## Roadmap

### Phase 2.1 (Current) ✅
- [x] Basic wallet monitoring
- [x] HIVE price tracking
- [x] Portfolio value calculation
- [x] Historical data persistence
- [x] Discord webhook reporting

### Phase 2.2 (Next)
- [ ] Daily snapshot summaries
- [ ] 7-day moving averages
- [ ] Price alerts (>5% change)
- [ ] Whale transaction detection
- [ ] CSV export for analysis

### Phase 2.3 (Future)
- [ ] Web dashboard (React + Vite)
- [ ] Real-time charts (Plotly)
- [ ] Token performance ranking
- [ ] Profit/loss attribution by token
- [ ] Tax reporting exports

---

## Related Files

- **TRADING_STRATEGY.md**: Complete Van Kush trading strategy (this bot implements Phase 2)
- **vankush-market-maker.js**: Market making bot (Phase 1)
- **hive-token-scanner.js**: Token health analysis
- **.env.example**: Environment variable template
- **TEST_RESULTS.md**: Testing documentation

---

## Notes

- Bot uses **CoinGecko free tier** (rate limited but sufficient for 5-minute updates)
- **HIVE-Engine API is free** and unlimited
- All calculations are **real-time** based on current market prices
- **No trading execution** - this is purely a monitoring/reporting tool
- Safe to run 24/7 - very low resource usage

---

**Built with**: Node.js, axios, dotenv
**Tested on**: Node v22.21.1
**Author**: Claude Code
**Date**: 2026-01-09
