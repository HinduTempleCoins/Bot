# Van Kush HIVE-Engine Bot Deployment Guide

**Purpose**: Deploy all 4 trading bots to Oracle Cloud Free Tier or local server

**Status**: ✅ Bots ready, deployment instructions complete

---

## 📦 What We're Deploying

You have **4 trading bots** ready to deploy:

1. **Market Maker Bot** (`vankush-market-maker.js`)
   - Creates buy walls for VKBT
   - Nudges price upward gradually
   - Tracks whale activity

2. **Portfolio Tracker** (`vankush-portfolio-tracker.js`)
   - Monitors all token balances
   - Calculates P&L in real-time
   - Sends Discord reports every hour

3. **Arbitrage Scanner** (`vankush-arbitrage-scanner.js`)
   - Finds Swap.* opportunities (BTC, ETH, LTC, DOGE)
   - Calculates net profit after fees
   - Auto-alerts to Discord

4. **General Trading Bot** (`hive-trading-bot.js`)
   - Executes 5-tier token priority strategy
   - BLURT preference logic (1.4x multiplier)
   - Stop-loss protection

---

## 🎯 Deployment Options

### Option 1: Oracle Cloud Free Tier (RECOMMENDED)
**Pros**:
- ✅ **100% FREE forever** (not a trial)
- ✅ 4 ARM CPUs, 24GB RAM
- ✅ 200GB storage
- ✅ 10TB monthly bandwidth
- ✅ Always-on, no electricity cost
- ✅ Static IP included

**Cons**:
- ❌ Requires credit card (not charged on free tier)
- ❌ 15-minute setup process

### Option 2: Local PC + PM2
**Pros**:
- ✅ No cloud account needed
- ✅ Full control
- ✅ 5-minute setup

**Cons**:
- ❌ Computer must run 24/7
- ❌ Electricity cost
- ❌ If PC crashes, bots stop

---

## 🚀 OPTION 1: Oracle Cloud Free Tier Setup

### Step 1: Create Oracle Cloud Account

1. Go to https://www.oracle.com/cloud/free/
2. Click "Start for free"
3. Fill out form:
   - Email
   - Country (United States recommended for best performance)
   - Cloud Account Name (choose something memorable)
4. Verify email
5. Enter payment info (NOT charged on free tier)
6. Wait 5-10 minutes for account activation

### Step 2: Create Virtual Machine

1. Login to Oracle Cloud Console
2. Click "Create a VM instance"
3. **Name**: `vankush-trading-bots`
4. **Image**: Ubuntu 22.04 (default)
5. **Shape**:
   - Click "Change Shape"
   - Select "Ampere" (ARM)
   - Choose "VM.Standard.A1.Flex"
   - **OCPUs**: 4 (maximum free tier)
   - **Memory**: 24 GB (maximum free tier)
   - Click "Select Shape"
6. **Networking**:
   - Leave "Create new virtual cloud network" checked
   - Leave "Assign a public IPv4 address" checked
7. **Add SSH Keys**:
   - Select "Generate SSH key pair"
   - Click "Save Private Key" (downloads .key file)
   - Click "Save Public Key"
   - **IMPORTANT**: Save these files! You'll need them to login
8. Click "Create"
9. Wait 2-3 minutes for VM to provision
10. **Copy the Public IP address** (you'll need this)

### Step 3: Connect to VM

**On Mac/Linux**:
```bash
chmod 400 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@YOUR_PUBLIC_IP
```

**On Windows**:
1. Download PuTTY from https://www.putty.org/
2. Use PuTTYgen to convert .key to .ppk format
3. Open PuTTY, enter IP, load .ppk file under SSH → Auth
4. Click "Open"

### Step 4: Install Node.js and Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 22.x
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should show v22.x.x
npm --version   # Should show 10.x.x

# Install PM2 (process manager)
sudo npm install -g pm2

# Install Git
sudo apt install -y git
```

### Step 5: Clone Your Repository

```bash
# Navigate to home directory
cd ~

# Clone repo (replace with your actual repo URL)
git clone https://github.com/HinduTempleCoins/Bot.git
cd Bot

# Install dependencies
npm install
```

### Step 6: Configure Environment Variables

```bash
# Copy example env file
cp .env.example .env

# Edit with nano
nano .env
```

**Fill in these values**:
```env
# Discord Bot (for notifications)
DISCORD_TOKEN=your_discord_bot_token
HIVE_DISCORD_WEBHOOK=your_discord_webhook_url

# HIVE Blockchain (YOU NEED TO GET THESE)
HIVE_USERNAME=your_hive_account
HIVE_ACTIVE_KEY=5JxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxK
HIVE_POSTING_KEY=5JxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxK

# Market Maker
MM_DRY_RUN=true  # Set to false when ready for live trading
MM_NUDGE_INCREMENT=0.00000010
MM_MAX_NUDGES_DAY=10
MM_BUY_WALL_SIZE=50
MM_SUPPORT_SIZE=25

# Trading Bot
HIVE_BOT_DRY_RUN=true  # Set to false when ready for live trading
HIVE_BOT_MAX_TRADE_SIZE=100
HIVE_BOT_STOP_LOSS=0.05
HIVE_BOT_TAKE_PROFIT=0.15
BLURT_PREFERENCE_MULTIPLIER=1.4

# AI (Optional - for Discord bot features)
OPENROUTER_API_KEY=your_openrouter_key  # Get from https://openrouter.ai
GEMINI_API_KEY=your_gemini_key
```

**Save and exit**:
- Press `Ctrl + O` (save)
- Press `Enter` (confirm)
- Press `Ctrl + X` (exit)

---

## 🔑 Getting HIVE Account and Keys

### Option A: Create New HIVE Account (RECOMMENDED for bots)

1. Go to https://signup.hive.io/
2. Click "Create Account"
3. Choose a username (ex: `vankushtradebot`)
4. Verify with phone or pay 3 HIVE
5. **SAVE ALL KEYS IMMEDIATELY**:
   - Owner Key (NEVER use in bots)
   - Active Key (for trading)
   - Posting Key (for content)
   - Memo Key (for encrypted messages)

**CRITICAL**: Write down keys on paper, store in safe place. If lost, account is gone forever.

### Option B: Use Existing Account

If you already have HIVE account:

1. Go to https://wallet.hive.blog/
2. Login
3. Click username → "Wallet" → "Permissions"
4. Click "Show Private Key" next to "Active" authority
5. Copy Active Key (starts with `5J` or `5K`)
6. **DO NOT share Owner Key with bots**

---

## 📤 Fund the Bot Account

### Get HIVE

1. **Buy on exchange**:
   - Binance: https://www.binance.com/ (BTC → HIVE)
   - Bittrex: https://global.bittrex.com/ (USD → HIVE)
   - Upbit: https://upbit.com/ (KRW → HIVE)

2. **Withdraw to bot account**:
   - Address: `your_hive_username` (ex: `vankushtradebot`)
   - Memo: (leave blank or unique identifier)
   - Amount: Start with 100-500 HIVE ($30-$150 at $0.30/HIVE)

### Buy Initial Tokens

1. Go to https://hive-engine.com/
2. Login with Hive Keychain
3. Buy tokens:
   - **VKBT**: 100-500 tokens to start market making
   - **CURE**: 50-250 tokens for diversification
   - **SWAP.HIVE**: Keep 50-100 HIVE as SWAP.HIVE for liquidity

---

## 🤖 Starting the Bots

### Test Run (Dry Mode)

```bash
# Test Portfolio Tracker (safest, read-only)
pm2 start vankush-portfolio-tracker.js --name portfolio
pm2 logs portfolio

# Should see:
# ✅ Portfolio tracker starting...
# 📊 Monitoring account: your_account
# ✅ Update complete

# Test Arbitrage Scanner (read-only)
pm2 start vankush-arbitrage-scanner.js --name arbitrage
pm2 logs arbitrage

# Test Market Maker (DRY RUN mode)
pm2 start vankush-market-maker.js --name market-maker
pm2 logs market-maker

# Should see:
# ✅ Market maker starting...
# 🔒 DRY RUN MODE - No real trades
```

### Enable Live Trading (WHEN READY)

**IMPORTANT**: Only enable after testing in dry run mode for 24 hours!

```bash
# Stop all bots
pm2 stop all

# Edit .env
nano .env

# Change these lines:
MM_DRY_RUN=false
HIVE_BOT_DRY_RUN=false

# Save and restart
pm2 restart all
pm2 logs
```

### PM2 Commands

```bash
# View all running bots
pm2 list

# View logs
pm2 logs               # All bots
pm2 logs portfolio     # Specific bot
pm2 logs --lines 100   # Last 100 lines

# Restart bots
pm2 restart all
pm2 restart portfolio

# Stop bots
pm2 stop all
pm2 stop market-maker

# Delete bots from PM2
pm2 delete all
pm2 delete portfolio

# Enable auto-start on server reboot
pm2 startup
pm2 save
```

---

## 🛡️ OPTION 2: Local PC + PM2 Setup

### Step 1: Install Node.js

**Windows**:
1. Download from https://nodejs.org/ (LTS version)
2. Run installer
3. Open Command Prompt
4. Verify: `node --version` and `npm --version`

**Mac**:
```bash
brew install node@22
```

**Linux**:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### Step 2: Clone Repository

```bash
cd ~
git clone https://github.com/HinduTempleCoins/Bot.git
cd Bot
npm install
```

### Step 3: Configure .env

(Same as Step 6 in Oracle Cloud setup above)

### Step 4: Install PM2

```bash
npm install -g pm2
```

### Step 5: Start Bots

(Same as "Starting the Bots" section above)

### Step 6: Keep PC Running 24/7

**Windows**:
- Settings → System → Power → "Never" for sleep
- Disable Windows Updates auto-restart

**Mac**:
- System Preferences → Energy Saver → "Never" for sleep
- Consider using `caffeinate` command

**Linux**:
- Already configured for 24/7 operation

---

## 📊 Monitoring & Maintenance

### Discord Alerts

All bots send reports to Discord webhook (if configured in .env):

**Portfolio Tracker**:
- Every hour: Full portfolio report
- Every 5 minutes: Balance updates

**Arbitrage Scanner**:
- Real-time: When profitable opportunity detected
- Every 30 minutes: Status update

**Market Maker**:
- Every nudge: Price change notification
- Whale detection: Large holder movements

**General Trading Bot**:
- Every trade: Entry/exit notifications
- Stop-loss triggers
- Position updates

### Check Bot Status

```bash
# Via PM2
pm2 status
pm2 logs --lines 50

# Via Discord
# Send message in your Discord server:
/bots
# Bot will show status of all trading bots
```

### Update Bots

```bash
# Stop bots
pm2 stop all

# Pull latest code
cd ~/Bot
git pull

# Reinstall dependencies (if needed)
npm install

# Restart
pm2 restart all
```

### Backup Data Files

```bash
# Create backup directory
mkdir -p ~/bot-backups

# Backup important files
cp ~/Bot/.env ~/bot-backups/.env.backup
cp ~/Bot/vankush-portfolio-data.json ~/bot-backups/
cp ~/Bot/vankush-arbitrage-history.json ~/bot-backups/
cp ~/Bot/user-relationships.json ~/bot-backups/

# Create dated backup
DATE=$(date +%Y-%m-%d)
tar -czf ~/bot-backups/bot-backup-$DATE.tar.gz ~/Bot/*.json ~/Bot/.env
```

---

## ⚠️ Safety Checklist

Before enabling live trading:

- [ ] Tested in DRY_RUN mode for 24+ hours
- [ ] Discord alerts working
- [ ] Bot can see wallet balance correctly
- [ ] Stop-loss limits configured
- [ ] Max trade size set appropriately
- [ ] Only using separate trading account (not main holdings)
- [ ] HIVE Active Key secured (not posted publicly)
- [ ] Backup of .env file created
- [ ] PM2 auto-restart enabled
- [ ] Monitoring Discord channel created

---

## 🐛 Troubleshooting

### Bot Won't Start

**Error**: `Error loading .env file`
- **Solution**: Make sure `.env` file exists in Bot directory
- Run: `cp .env.example .env` and fill in values

**Error**: `Cannot find module`
- **Solution**: Run `npm install` in Bot directory

**Error**: `HIVE_ACTIVE_KEY not configured`
- **Solution**: Edit `.env` and add your HIVE active key

### Bot Can't See Wallet

**Symptom**: Portfolio tracker shows 0 balance
- **Solution**: Verify `HIVE_USERNAME` is correct in `.env`
- Check account exists: https://hive-engine.com/?p=balances&account=YOUR_USERNAME

### Trades Not Executing

**Symptom**: Bot says "placing order" but nothing happens
- **Check**: Is `DRY_RUN=true`? Change to `false` for live trading
- **Check**: Does bot have HIVE balance? Need HIVE for transaction fees (0.001 HIVE per trade)
- **Check**: Active key correct? Try logging into wallet.hive.blog with same key

### High CPU Usage

**Symptom**: Server slow, PM2 shows 100% CPU
- **Solution**: Increase update intervals in bot code
- Portfolio: Change from 5 min to 10 min
- Arbitrage: Change from 10 min to 20 min

### Out of Memory

**Symptom**: PM2 shows "Errored" status
- **Solution**: Restart bot: `pm2 restart all`
- **Prevention**: Enable auto-restart: `pm2 startup && pm2 save`

---

## 📞 Support

If you encounter issues:

1. **Check logs**: `pm2 logs --lines 100`
2. **Check Discord**: Bot should send error messages to webhook
3. **Check HIVE-Engine**: https://hive-engine.com/ (is API working?)
4. **Check GitHub**: https://github.com/HinduTempleCoins/Bot/issues

---

## 📈 Performance Expectations

**Market Maker Bot**:
- Nudges VKBT price up by 0.00000010 HIVE per hour
- Creates buy wall of 50 HIVE every 6 hours
- Expected gain: 2-5% price increase per week (if market conditions favorable)

**Portfolio Tracker**:
- Updates every 5 minutes
- Tracks performance vs starting balances
- No direct profit, but provides visibility

**Arbitrage Scanner**:
- Scans every 10 minutes
- Opportunities rare (maybe 1-2 per week)
- Expected gain: 3-8% per successful arbitrage (after fees)

**General Trading Bot**:
- Makes 1-5 trades per day (depending on volatility)
- Stop-loss at 5%, take-profit at 15%
- Expected monthly gain: Highly variable (0% to 30% depending on market)

**IMPORTANT**: No guarantees! Crypto is volatile. You can lose money.

---

## 🎯 Next Steps After Deployment

1. **Monitor for 1 week** in DRY_RUN mode
2. **Enable live trading** with small amounts (100 HIVE max)
3. **Check Discord daily** for bot reports
4. **Gradually increase** trading size as confidence grows
5. **Diversify** across all 4 bots (don't put all eggs in one basket)
6. **Reinvest profits** into VKBT and CURE (Tier 1 priority)

---

**Last Updated**: 2026-01-09
**Status**: Ready for deployment
**Estimated setup time**: 30 minutes (Oracle Cloud) or 10 minutes (local)

---

**Remember**: Start small, test thoroughly, never risk more than you can afford to lose!
