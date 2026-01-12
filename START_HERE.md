# START HERE - Quick Setup Guide

## ⚠️ IMPORTANT CORRECTIONS

**Trading Account**: **Angelicalist** (NOT punicwax)
- Update .env: `HIVE_USERNAME=angelicalist`
- All trading should happen from Angelicalist account

---

## 🚀 Step 1: Import Your Claude Discussions

### A. Create the Folder (IMPORTANT!)

```bash
# On the server (Google VM or wherever):
cd /home/user/Bot
mkdir -p claude_exports
```

You need to create a `claude_exports/` folder where you'll upload your Claude.ai PDFs.

### B. Export Your Claude Discussions

1. Open your Claude.ai conversations
2. For each conversation:
   - Click the **⋮** (three dots) at top right
   - Choose **"Export" → "Download as PDF"**
   - Save to your computer (name them descriptively!)

Example filenames:
- `vkbt-trading-strategy.pdf`
- `temple-history-discussion.pdf`
- `hive-engine-setup.pdf`

### C. Upload PDFs to Server

**Using Google Cloud Console:**
1. Open Google Cloud Console
2. SSH to your VM
3. Click **"Upload file"** button (gear icon → Upload file)
4. Upload to: `/home/user/Bot/claude_exports/`

**OR using SCP (from your computer):**
```bash
scp ~/Downloads/*.pdf user@your-server:/home/user/Bot/claude_exports/
```

### D. Run the Automated Import

```bash
cd /home/user/Bot
python3 claude-discussion-scraper.py --dir claude_exports
```

This will:
- ✅ Find all PDFs in claude_exports/
- ✅ Extract text automatically
- ✅ Import to knowledge base
- ✅ NO PASTING REQUIRED (fixes SSH crash!)

### E. Verify Import Worked

```bash
# Check what was imported
ls -lh datasets/claude_discussions.jsonl

# Test search
python3 knowledge-base.py --search "trading bot"
```

---

## 🤖 Step 2: Check Trading Bot Status

### Current Status: ❌ NOT TRADING

**Account checked**: Angelicalist
- ❌ No open buy orders
- ❌ No recent trades
- ❌ Bot not placing orders

### Why?

Bot might be:
1. Not running on Google VM
2. In dry run mode (MM_DRY_RUN=true)
3. Wrong account configured (was set to punicwax?)
4. Missing credentials

### Check Bot Status:

```bash
# SSH to Google VM, then:
pm2 list
pm2 logs vankush-price-pusher

# Check .env configuration
cat .env | grep HIVE_USERNAME
cat .env | grep MM_DRY_RUN
```

### Fix Configuration:

```bash
# Edit .env file on Google VM
nano .env

# Make sure it says:
HIVE_USERNAME=angelicalist
HIVE_ACTIVE_KEY=your_angelicalist_active_key
MM_DRY_RUN=false

# Save and restart bot
pm2 restart vankush-price-pusher
```

### Monitor Activity:

```bash
# On this machine (not Google VM):
cd /home/user/Bot
node check-bot-orders.cjs
```

This shows:
- Open buy orders
- Recent trades
- Market activity

---

## 💬 Step 3: Update Discord Bot

### A. Make Sure Dependencies Installed

```bash
cd /home/user/Bot
npm install
npm install node-fetch@2
```

### B. Follow Integration Guide

See **`DISCORD_BOT_KB_UPDATE.md`** for complete steps:
1. Add KB integration to index.js
2. Replace hardcoded Cryptology dialogues
3. Connect to knowledge base API
4. Deploy to Railway

### C. Test Locally First

```bash
# Make sure KB API is running
curl localhost:8765/stats

# Test bot
npm start
```

### D. Deploy to Railway

```bash
git add -A
git commit -m "Update Discord bot with KB integration"
git push origin claude/plan-itinerary-knowledge-base-Etb9c
```

Railway will auto-deploy.

---

## 📋 Quick Checklist

### Knowledge Base:
- [ ] Created `claude_exports/` folder
- [ ] Exported Claude discussions as PDFs
- [ ] Uploaded PDFs to server
- [ ] Ran `python3 claude-discussion-scraper.py --dir claude_exports`
- [ ] Verified with `ls datasets/claude_discussions.jsonl`

### Trading Bot:
- [ ] SSH'd to Google VM
- [ ] Checked `pm2 list` (is bot running?)
- [ ] Updated .env: `HIVE_USERNAME=angelicalist`
- [ ] Updated .env: `MM_DRY_RUN=false`
- [ ] Restarted bot with `pm2 restart vankush-price-pusher`
- [ ] Checked logs with `pm2 logs`
- [ ] Verified with `node check-bot-orders.cjs`

### Discord Bot:
- [ ] Ran `npm install`
- [ ] Updated index.js (see DISCORD_BOT_KB_UPDATE.md)
- [ ] Tested locally
- [ ] Pushed to Railway
- [ ] Tested `/cryptology` command

---

## 🎯 Priority Order

**Do this in order:**

1. **FIRST**: Create claude_exports folder and import PDFs
   - This saves 99% tokens in future sessions
   - Takes 5-10 minutes

2. **SECOND**: Fix trading bot account (angelicalist)
   - Check if running
   - Update configuration
   - Restart and monitor

3. **THIRD**: Update Discord bot
   - Connect to knowledge base
   - Deploy to Railway
   - Test in Discord

---

## 📁 Folder Structure

After setup, you should have:

```
/home/user/Bot/
├── claude_exports/          ← CREATE THIS! Upload PDFs here
│   ├── trading-strategy.pdf
│   ├── temple-history.pdf
│   └── ...
├── datasets/
│   ├── vkbt_cure_knowledge.jsonl
│   └── claude_discussions.jsonl  ← Created by scraper
├── claude-discussion-scraper.py  ← Automated import tool
├── check-bot-orders.cjs          ← Check trading activity
└── ...
```

---

## ❓ Problems?

### "SSH console crashes when I paste"
✅ **SOLVED!** Use the file upload method instead.

### "No claude_exports folder"
```bash
mkdir -p /home/user/Bot/claude_exports
```

### "Trading bot not working"
- Check Google VM with `pm2 list`
- Verify account: `cat .env | grep HIVE_USERNAME` should say `angelicalist`

### "Discord bot doesn't know about my discussions"
- Check imports: `ls datasets/claude_discussions.jsonl`
- Restart KB API: `pkill -f knowledge-base.py && python3 knowledge-base.py --serve --port 8765 &`

---

## 🎉 Success Looks Like

**After completing all steps:**

1. **Knowledge Base**:
   - `datasets/claude_discussions.jsonl` exists and has content
   - Can search discussions: `python3 knowledge-base.py --search "your topic"`

2. **Trading Bot**:
   - `node check-bot-orders.cjs` shows open buy orders
   - Bot logs show "💰 MAJOR PUSH" or "🔹 MICRO PUSH"
   - VKBT/CURE balances slowly increasing

3. **Discord Bot**:
   - `/cryptology` command works
   - Shows topics from your Claude discussions
   - Dynamic responses from knowledge base

---

## 📚 Documentation Reference

- **Claude Import**: `CLAUDE_IMPORT_INSTRUCTIONS.md`
- **Discord Bot Update**: `DISCORD_BOT_KB_UPDATE.md`
- **Trading Bot Status**: `TRADING_BOT_STATUS.md`
- **This Session Summary**: `DONE_THIS_SESSION.md`
- **Overall Plan**: `PLANNING_NEXT_STEPS.md`

---

**Questions? Check the docs above or review the itinerary files.**
