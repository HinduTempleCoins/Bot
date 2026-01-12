# HIVE-Engine Trading Bot

Automated trading bot for HIVE-Engine tokens with Discord notifications.

## Features

- ✅ **Automated Buy/Sell**: Buys when price drops 5%, sells at 2% profit
- ✅ **Stop Loss Protection**: Automatically exits positions at -10% loss
- ✅ **Position Management**: Tracks multiple open positions
- ✅ **Discord Notifications**: Real-time trade alerts via webhook
- ✅ **Paper Trading Mode**: Test strategies without risking real funds
- ✅ **Balance Tracking**: Monitors token and base currency balances
- ✅ **Max Position Size**: Prevents over-exposure to single token

## Strategy

**Buy Signal:**
- Price drops 5% (or more) below the last recorded price
- Sufficient base currency balance available
- Within max position size limit

**Sell Signal (Take Profit):**
- Position shows 2% (or more) profit
- Executes at current market price

**Sell Signal (Stop Loss):**
- Position shows -10% (or worse) loss
- Protects capital from large drawdowns

## Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Configure environment variables:**
```bash
cp .env.example .env
# Edit .env with your credentials
```

Required variables:
```env
# HIVE Account
HIVE_USERNAME=your_hive_username
HIVE_ACTIVE_KEY=your_active_key_here

# Trading Settings
HIVE_TOKEN_PAIR=BEE:SWAP.HIVE
HIVE_DRY_RUN=true  # Set to false for live trading
HIVE_DISCORD_WEBHOOK=your_webhook_url
```

3. **Test in paper trading mode:**
```bash
npm run trade
```

4. **Enable live trading:**
```env
HIVE_DRY_RUN=false
```

## Configuration

### Trading Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `HIVE_TOKEN_PAIR` | `BEE:SWAP.HIVE` | Token pair to trade |
| `HIVE_BUY_THRESHOLD` | `5` | Buy when price drops X% |
| `HIVE_SELL_THRESHOLD` | `2` | Sell at X% profit |
| `HIVE_TRADE_AMOUNT` | `10` | Base currency amount per trade |
| `HIVE_MAX_POSITION` | `100` | Maximum total exposure |
| `HIVE_STOP_LOSS` | `10` | Stop loss at -X% |
| `HIVE_CHECK_INTERVAL` | `60000` | Market check interval (ms) |

### Safety Features

**Dry Run Mode (Default):**
- No real trades executed
- All logic runs normally
- Perfect for testing strategies
- Console shows what trades WOULD be executed

**Max Position Size:**
- Prevents over-allocation to single token
- Configurable limit on total exposure
- Protects against concentration risk

**Stop Loss:**
- Automatically exits losing positions
- Configurable loss threshold
- Prevents catastrophic losses

## Usage

### Start Trading Bot

**Paper trading (safe):**
```bash
npm run trade
```

**Live trading (requires HIVE_DRY_RUN=false):**
```bash
npm run trade
```

**With PM2 (production):**
```bash
pm2 start hive-trading-bot.js --name hive-trader
pm2 save
pm2 startup
```

### Monitor Logs

```bash
# View real-time logs
pm2 logs hive-trader

# Check status
pm2 status

# Restart
pm2 restart hive-trader
```

### Trading State

The bot saves state to `hive-trading-state.json`:
- Open positions
- Total profit/loss
- Trade history count
- Last price tracking

This file persists between restarts.

## Discord Notifications

Configure webhook URL in `.env`:

```env
HIVE_DISCORD_WEBHOOK=https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN
```

**Notification Types:**
- 🚀 Bot startup
- 🟢 Buy orders executed
- 🟢 Sell orders (take profit)
- 🔴 Sell orders (stop loss)
- ❌ Errors and warnings

## Example Output

```
🤖 HIVE-Engine Trading Bot Starting...
📊 Token Pair: BEE:SWAP.HIVE
📉 Buy Threshold: 5% below market
📈 Sell Threshold: 2% profit
💰 Trade Amount: 10 SWAP.HIVE
🛡️ Stop Loss: 10%
🔄 Check Interval: 60s
🧪 DRY RUN MODE

📊 BEE Market Analysis
   Current Price: 0.00145000 SWAP.HIVE
   24h Volume: 1234.56 SWAP.HIVE
   Best Bid: 0.00144500 SWAP.HIVE
   Best Ask: 0.00145500 SWAP.HIVE
   Balance: 150.0000 BEE, 250.0000 SWAP.HIVE

🟢 BUY SIGNAL: Price dropped 5.12%
[DRY RUN] Would BUY 6896.5517 BEE at 0.00145000 SWAP.HIVE

📈 Trading Status:
   Open Positions: 1
   Total Trades: 1
   Total Profit: 0.0000 SWAP.HIVE
```

## Security

⚠️ **IMPORTANT SECURITY PRACTICES:**

1. **Never commit `.env` file** - Already in `.gitignore`
2. **Use dedicated trading account** - Don't use your main HIVE account
3. **Start with small amounts** - Test with minimal funds first
4. **Monitor regularly** - Check Discord notifications
5. **Use paper trading first** - Verify strategy before live trading

## HIVE-Engine API

The bot uses official HIVE-Engine RPC endpoints:
- `https://api.hive-engine.com/rpc/contracts`
- `https://engine.rishipanthee.com`

No API key required - public endpoints.

## Troubleshooting

**Bot not executing trades:**
- Check `HIVE_DRY_RUN=false` for live trading
- Verify HIVE_USERNAME and HIVE_ACTIVE_KEY are correct
- Ensure sufficient balance in your account

**"Insufficient balance" warnings:**
- Check your SWAP.HIVE balance on hive-engine.com
- Reduce `HIVE_TRADE_AMOUNT` if needed

**Price not updating:**
- Check market activity on hive-engine.com
- Verify token pair exists and has volume
- Check console for API errors

**Discord notifications not working:**
- Verify webhook URL is correct
- Test webhook with curl or Postman
- Check channel permissions

## Roadmap

- [ ] Support multiple token pairs simultaneously
- [ ] Technical indicators (RSI, MACD, Bollinger Bands)
- [ ] Trailing stop loss
- [ ] Grid trading strategy
- [ ] Backtesting engine
- [ ] Web dashboard for monitoring
- [ ] Multi-exchange support (HIVE, BLURT, Steem-Engine)

## Support

For issues or questions:
- Discord: Van Kush Family Server
- GitHub: HinduTempleCoins/Bot

## License

ISC License - Van Kush Family 2026
