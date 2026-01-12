# Van Kush Infrastructure Quick Start Guide

**Complete setup for $0/month development infrastructure**

This guide helps you set up the **entire Van Kush development infrastructure** for free, including:
- ✅ 24GB RAM cloud server (Oracle Cloud Free Tier)
- ✅ Free AI coding assistants (Gemini CLI + DeepSeek Coder)
- ✅ Automatic GitHub sync
- ✅ Remote access from anywhere (phone, Slack, Telegram)
- ✅ Discord bot deployment
- ✅ Unlimited coding capacity

**Total Monthly Cost**: **$0** 🎉

---

## 🖥️ **IMPORTANT: GUI Coding Interfaces (Not Terminal!)**

**You want Claude Code-like interfaces** (GUI, chat, file editing) - **NOT terminal commands!**

✅ **Continue.dev** - Works EXACTLY like Claude Code (in VS Code)
✅ **Code-Server** - VS Code in your browser (access from phone)
✅ **Open WebUI** - ChatGPT-style interface for DeepSeek

**📖 See**: `GUI_CODING_INTERFACES.md` for complete setup

**These give you text-to-code with GUI interfaces, not terminal!**

---

## 📋 Table of Contents

1. [Current Status](#current-status)
2. [Setup Order](#setup-order)
3. [Quick Reference](#quick-reference)
4. [Troubleshooting](#troubleshooting)
5. [Next Steps](#next-steps)

---

## Current Status

### ✅ Completed
- Discord bot deployed on Railway (temporary)
- Bot features:
  - 🎮 Crypt-ology dialogue system (50+ trees)
  - 💚 Emotional relationship tracking
  - 🔘 Discord button navigation
  - 🧠 DeFi, SocialFi, Karma Merit knowledge
  - 📚 Complete Van Kush Family timeline
  - 📊 HIVE-Engine price tracking
  - 🎨 AI image generation
  - 📺 YouTube video summaries

### ⏳ Next Priority
1. Set up Oracle Cloud Free Tier server
2. Install AI coding tools (Gemini CLI + DeepSeek)
3. Configure auto-push to GitHub
4. Set up remote access (Termux/Telegram)
5. Migrate bot from Railway to Oracle Cloud

### 📝 Saved for Later
- Fix YouTube transcript feature
- Research and fix Burn Mining contracts
- Extract SMT action items
- Token launches (VKBT, CURE, PUCO, PUTI)
- KulaSwap AMM completion
- Book memory system (ChromaDB + RAG)

---

## Setup Order

**Follow these guides in order:**

### Phase 1: Cloud Infrastructure (30 minutes)

**📖 Guide**: `ORACLE_CLOUD_SETUP.md`

**What you'll do**:
1. Create Oracle Cloud account
2. Deploy 24GB RAM ARM server (free forever)
3. Open firewall ports
4. Connect via SSH
5. Install Node.js, Git, PM2, Python, Docker

**Result**: Your own FREE cloud server with more power than Railway!

**Test**:
```bash
ssh -i ~/.ssh/oracle_ssh_key ubuntu@YOUR_ORACLE_IP
free -h  # Should show 24GB RAM
```

---

### Phase 2: Free AI Coding Tools (20 minutes)

#### 2A: Gemini CLI (10 minutes)

**📖 Guide**: `GEMINI_CLI_SETUP.md`

**What you'll do**:
1. Get Gemini API key (you already have one)
2. Install Google Generative AI SDK
3. Create helper scripts (chat, code gen, file analysis)
4. Set up shell aliases

**Result**: 1,000 free AI requests per day!

**Test**:
```bash
gchat  # Start interactive chat
gcode "write a python function to check if number is prime"
```

#### 2B: DeepSeek Coder (20 minutes)

**📖 Guide**: `DEEPSEEK_CODER_SETUP.md`

**What you'll do**:
1. Install Ollama (LLM runtime)
2. Download DeepSeek-Coder-V2-Lite (16B model)
3. Create CLI wrapper scripts
4. Set up shell aliases

**Result**: UNLIMITED free AI coding (runs locally)!

**Test**:
```bash
ds  # Start interactive chat
dcode "write a bash script to monitor CPU usage"
```

---

### Phase 3: GUI Coding Interfaces (10 minutes) ⭐ **RECOMMENDED**

**📖 Guide**: `GUI_CODING_INTERFACES.md`

**⚠️ IMPORTANT**: If you don't like terminal commands, START HERE instead!

**What you'll do**:
1. Install Continue.dev extension in VS Code (2 minutes)
2. Configure for Gemini API or DeepSeek
3. (Optional) Install Code-Server for browser access
4. (Optional) Install Open WebUI for ChatGPT-style interface

**Result**: Claude Code-like GUI interface (chat, file editing) for FREE!

**Test**:
1. Open VS Code
2. Click Continue icon in sidebar
3. Chat: "Explain what index.js does"
4. AI reads file and explains!

**This is the TEXT-TO-CODE interface you want!** 🎉

---

### Phase 4: Auto-Push to GitHub (15 minutes)

**📖 Guide**: `AUTO_PUSH_GITHUB.md`

**What you'll do**:
1. Set up GitHub Personal Access Token (PAT)
2. Install inotify-tools for file watching
3. Create auto-push script with AI-generated commit messages
4. Run with PM2 for 24/7 operation

**Result**: Every code change automatically commits and pushes to GitHub!

**Test**:
```bash
pm2 start ~/auto-push.sh --name auto-push -- ~/Bot claude/update-todos-9iXhF
# Make a change to any file
# Watch it auto-commit and push!
```

---

### Phase 4: Remote Access (30 minutes)

**📖 Guide**: `REMOTE_CODING_SETUP.md`

**What you'll do**:
1. Install Termux on Android (or Blink Shell on iOS)
2. Copy SSH key to phone
3. Create Telegram bot for server control
4. (Optional) Set up SMS gateway

**Result**: Full coding access from your phone!

**Test**:
```bash
# From phone:
ssh -i ~/.ssh/oracle_ssh_key ubuntu@YOUR_ORACLE_IP
pm2 status  # Check bot from your phone!
```

---

### Phase 5: Deploy Bot to Oracle Cloud (10 minutes)

**What you'll do**:
1. Clone Bot repository on Oracle Cloud
2. Create `.env` file with tokens
3. Install dependencies
4. Start with PM2
5. Stop Railway deployment (save $5/month)

**Commands**:
```bash
ssh -i ~/.ssh/oracle_ssh_key ubuntu@YOUR_ORACLE_IP

cd ~
git clone https://github.com/HinduTempleCoins/Bot.git
cd Bot
git checkout claude/update-todos-9iXhF

npm install

nano .env
# Paste:
# DISCORD_TOKEN=your_discord_token
# GEMINI_API_KEY=your_gemini_key
# (Save with Ctrl+O, Enter, Ctrl+X)

pm2 start index.js --name vankush-bot
pm2 save
pm2 startup  # Run the command it gives you

pm2 logs vankush-bot  # Verify it's working
```

**Result**: Bot runs 24/7 on FREE server instead of Railway!

---

## Quick Reference

### SSH to Oracle Cloud

```bash
ssh -i ~/.ssh/oracle_ssh_key ubuntu@YOUR_ORACLE_IP
```

### Check Bot Status

```bash
pm2 status
pm2 logs vankush-bot
```

### Update Bot Code

```bash
cd ~/Bot
git pull origin claude/update-todos-9iXhF
npm install
pm2 restart vankush-bot
```

### AI Coding Commands

```bash
# Gemini CLI (1,000/day free)
gchat                           # Interactive chat
gcode "your prompt"             # Quick code generation
gfile file.js "explain this"    # Analyze file

# DeepSeek Coder (unlimited free)
ds                              # Interactive chat
dcode "your prompt"             # Quick code generation
dfile file.js "explain this"    # Analyze file
```

### Auto-Push Commands

```bash
# Start auto-push
pm2 start ~/auto-push.sh --name auto-push -- ~/Bot claude/update-todos-9iXhF

# Check auto-push logs
pm2 logs auto-push

# Stop auto-push
pm2 stop auto-push
```

### Telegram Bot Commands (from phone)

```
/status    - Check bot status
/logs      - View recent logs
/restart   - Restart bot
/deploy    - Pull latest code and restart
/ram       - Check RAM usage
/disk      - Check disk space
/shell <command> - Run shell command
```

---

## Troubleshooting

### Oracle Cloud Issues

**Problem**: Can't SSH to server

**Fix**:
1. Check instance is "Running" in Oracle dashboard
2. Verify public IP is correct
3. Check security list has port 22 open
4. Check SSH key file permissions: `chmod 600 ~/.ssh/oracle_ssh_key`

---

**Problem**: Server is slow

**Check resource usage**:
```bash
free -h    # RAM usage
top        # CPU usage
df -h      # Disk space
```

**Common causes**:
- DeepSeek model using too much RAM → Use smaller model: `ollama pull qwen2.5-coder:7b`
- Too many PM2 processes → `pm2 delete unused-app`

---

### AI Coding Issues

**Problem**: Gemini API "Rate limit exceeded"

**You've hit 1,000 requests/day limit**

**Solutions**:
1. Wait until midnight PST for reset
2. Use DeepSeek Coder instead (unlimited!)
3. Check usage: https://aistudio.google.com/app/apikey

---

**Problem**: DeepSeek is slow

**Fixes**:
1. Use smaller model: `ollama pull qwen2.5-coder:7b` (2x faster)
2. Check RAM: `free -h` (should have free RAM)
3. Close other apps: `pm2 stop all` except what you need

---

### Bot Issues

**Problem**: Bot won't start

**Debug**:
```bash
pm2 logs vankush-bot --lines 100

# Common issues:
# 1. Missing .env file
cat .env  # Should show DISCORD_TOKEN and GEMINI_API_KEY

# 2. Port already in use
sudo lsof -i :3000

# 3. Missing dependencies
cd ~/Bot && npm install
```

---

**Problem**: Bot crashes repeatedly

**Check logs**:
```bash
pm2 logs vankush-bot --err --lines 50
```

**Common causes**:
- Invalid API keys → Verify in `.env`
- Memory leak → Restart: `pm2 restart vankush-bot`
- Code error → Check recent commits: `git log --oneline -5`

---

### Auto-Push Issues

**Problem**: Not committing changes

**Debug**:
```bash
pm2 logs auto-push --lines 50

# Check if file matches watch patterns
# Default: *.js *.json *.md *.py *.sh
```

---

**Problem**: Push fails with 403

**Your GitHub PAT expired or is invalid**

**Fix**:
1. Create new PAT: https://github.com/settings/tokens
2. Update credentials:
```bash
cd ~/Bot
git pull  # Enter username and NEW PAT when prompted
```

---

## Next Steps

### After Infrastructure Setup

1. **Migrate bot from Railway to Oracle Cloud** (saves $5/month)
2. **Set up Fiverr gigs** to earn money for Claude Pro subscription
3. **Deploy other projects**:
   - Telegram bot
   - Website
   - Burn Mining contracts
   - Token launches

### Future Enhancements

**Phase 2 Projects** (from MASTER_ITINERARY.md):
- Book memory system (ChromaDB + RAG)
- Email/web scrapers for training data
- Social media automation (n8n workflows)
- KulaSwap AMM deployment
- SMT frontend development

**All can run on your Oracle Cloud server!**

---

## Cost Summary

### Before (Railway)

| Service | Cost |
|---------|------|
| Railway | $5/month (after trial) |
| Claude Pro | $20/month |
| **Total** | **$25/month** |

### After (Oracle + Free Tools)

| Service | Cost |
|---------|------|
| Oracle Cloud | **$0/month** ✅ |
| Gemini CLI | **$0/month** ✅ |
| DeepSeek Coder | **$0/month** ✅ |
| Telegram Bot | **$0/month** ✅ |
| Auto-Push | **$0/month** ✅ |
| Claude Pro | $20/month (optional) |
| **Total** | **$0-20/month** 💰 |

**Savings**: **$5-25/month** ($60-300/year!)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Oracle Cloud Free Tier                   │
│                     (24GB RAM, 4 CPU cores)                  │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Discord Bot  │  │ Telegram Bot │  │  Auto-Push   │     │
│  │    (PM2)     │  │    (PM2)     │  │    (PM2)     │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Gemini CLI  │  │  DeepSeek    │  │   ChromaDB   │     │
│  │ (1K req/day) │  │  (Unlimited) │  │   (Future)   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │              Git Auto-Sync to GitHub               │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │
                    ┌─────────┴─────────┐
                    │                   │
            ┌───────▼──────┐    ┌──────▼───────┐
            │   Termux     │    │   Telegram   │
            │  (Android)   │    │     Bot      │
            └──────────────┘    └──────────────┘
                   │                    │
                   └────────┬───────────┘
                           │
                    ┌──────▼──────┐
                    │  You (Phone) │
                    │Code Anywhere!│
                    └──────────────┘
```

---

## Final Checklist

Before you're fully set up, verify:

- [ ] Oracle Cloud account created
- [ ] VM instance running (24GB RAM)
- [ ] SSH access working from computer
- [ ] Node.js, Git, PM2, Python installed
- [ ] Gemini CLI configured and tested
- [ ] DeepSeek Coder downloaded and tested
- [ ] Bot cloned and running on Oracle Cloud
- [ ] Auto-push script running with PM2
- [ ] Termux installed on phone with SSH key
- [ ] Telegram bot created and running
- [ ] Railway deployment stopped (if migrated)

---

## Support Resources

### Documentation

- **Oracle Cloud Free Tier**: https://www.oracle.com/cloud/free/
- **Ollama (DeepSeek)**: https://ollama.com/library/deepseek-coder-v2
- **Gemini API**: https://ai.google.dev/
- **PM2**: https://pm2.keymetrics.io/docs/usage/quick-start/
- **Termux**: https://wiki.termux.com/

### Van Kush Project Docs

- `MASTER_ITINERARY.md` - Complete project roadmap
- `METAL_STONE_NETWORK.md` - 7-token blockchain spec
- `BOOK_MEMORY_SYSTEM.md` - RAG implementation guide
- `BOT_COMPLETION_SUMMARY.md` - Phase 1 status
- `knowledge-base.json` - Complete Van Kush history

---

## You're Ready!

Follow the guides in order, and you'll have:

✅ **FREE forever infrastructure** ($0/month)
✅ **Unlimited AI coding** (DeepSeek Coder)
✅ **Automatic GitHub sync**
✅ **Code from anywhere** (phone, Slack, Telegram)
✅ **Professional development setup**

**Start with**: `ORACLE_CLOUD_SETUP.md`

**Good luck! 🚀**
