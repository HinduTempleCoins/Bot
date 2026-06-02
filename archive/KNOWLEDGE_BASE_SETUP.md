# Knowledge Base Setup Guide

This guide shows how to set up both knowledge bases for token-saving and Discord bot functionality.

---

## Quick Start

### 1. Start Knowledge Base API Server

The Discord bot needs the API server running to query knowledge:

```bash
# On your Google VM
cd ~/Bot

# Start API server with PM2 (stays running)
pm2 start knowledge-base.py --name knowledge-api --interpreter python3 -- --serve --port 8765

# Save PM2 config
pm2 save

# Check it's running
pm2 status
curl http://localhost:8765/search?q=VKBT
```

**API is now accessible at**: `http://localhost:8765`

---

### 2. Import This Claude Code Session

**Purpose**: Save this conversation so future Claude Code sessions have full context (saves 50,000+ tokens!)

```bash
# Export this conversation from Claude Code:
# 1. Click the three dots menu
# 2. Select "Export conversation"
# 3. Save as text file

# On your local machine, save the exported file, then:
cd ~/Bot

# Run the helper script
./import-claude-code-session.sh

# When prompted:
# - Enter the filename (or paste the conversation)
# - Title: "Trading Bot + Knowledge Base - Jan 10 2026"
# - Category: Press Enter for auto-detect (will detect "trading-bot")

# This saves to: datasets/claude_code_context.jsonl
```

**Result**: Next Claude Code session will read this context and know:
- Trading bot architecture
- Capital manager logic
- CURE strategy (1:1 HIVE minimum)
- Paper wall detection
- All the work we did today

---

### 3. Import Discord Bot Knowledge (Optional)

**Purpose**: Let Discord bot answer user questions about Van Kush Family

```bash
# In regular Claude Chat (not Claude Code), have a discussion:
# "Explain Van Kush Family, VKBT token, and CURE token for users"

# Export that conversation, then:
./import-for-discord.sh

# When prompted:
# - Enter filename or paste conversation
# - Title: "Van Kush Family Overview for Users"
# - Auto-categorized as "van-kush-family"

# This saves to: datasets/discord_bot_knowledge.jsonl
```

---

## What Gets Saved Where

### Claude Code Context (`claude_code_context.jsonl`)

✅ **Import**:
- This conversation (trading bot development)
- Technical implementation details
- Architecture decisions
- Problems solved and how
- Timeline and status updates
- Future Claude Code sessions

❌ **Don't Import**:
- User-facing explanations (too simple)
- Public marketing content (not relevant)

### Discord Bot Knowledge (`discord_bot_knowledge.jsonl`)

✅ **Import**:
- Van Kush Family history
- VKBT/CURE token explanations
- Public strategy information
- FAQ answers
- Timeline (simplified for users)

❌ **Don't Import**:
- Technical implementation (too complex)
- Private keys (auto-sanitized anyway)
- Development discussions

---

## API Usage

### Query from Discord Bot

```javascript
// In your Discord bot code:
const axios = require('axios');

async function queryKnowledge(question) {
  const response = await axios.get('http://localhost:8765/query', {
    params: { q: question }
  });

  return response.data.response;
}

// Example:
const answer = await queryKnowledge('what is VKBT');
message.reply(answer);
```

### Search from Command Line

```bash
# Search knowledge base
python3 knowledge-base.py --search "capital manager"

# Query with bot-friendly response
python3 knowledge-base.py --query "how does CURE trading work"

# Filter by category
python3 knowledge-base.py --search "CURE" --category "token-strategy"
```

### API Endpoints

**GET /search**
- Query params: `q` (query), `category` (optional), `limit` (default 10)
- Returns: List of matching documents

**GET /query**
- Query params: `q` (question)
- Returns: Formatted answer string (ready for Discord bot to send)

**GET /stats**
- Returns: Knowledge base statistics (doc count, categories, keywords)

---

## Current Status

### Already Loaded

✅ `vkbt_cure_knowledge.jsonl` - 17 documents about Van Kush Family
- Token information
- Trading strategies
- Capital management
- Future plans (SMT, Polygon)

### Ready to Import

⏳ **This session** → Will become Claude Code context for future sessions
⏳ **Your Claude Chats** → Will become Discord bot knowledge

---

## Security

All knowledge bases are **protected**:

✅ `datasets/` folder in `.gitignore` - never pushed to GitHub
✅ Auto-sanitization removes HIVE keys (5Jxxx...)
✅ API only listens on localhost (127.0.0.1:8765)
✅ `.env` never committed

**Safe to import** any conversation - sensitive data is automatically removed!

---

## Maintenance

### Daily (if developing)

```bash
# End of day: Export and import Claude Code session
./import-claude-code-session.sh
```

### Weekly (for Discord bot)

```bash
# Import new Van Kush discussions from Claude Chat
./import-for-discord.sh
```

### Monitor API

```bash
# Check API status
pm2 logs knowledge-api

# Restart if needed
pm2 restart knowledge-api
```

---

## Example Workflow

### After This Session

```bash
# 1. Export this Claude Code conversation (click menu → export)

# 2. Import it
./import-claude-code-session.sh
# Paste conversation when prompted
# Title: "Trading Bot Development - Jan 10 2026"
# Category: Press Enter (auto-detects "trading-bot")

# 3. Verify
python3 knowledge-base.py --search "CURE strategy"
# Should return info about 1:1 HIVE minimum, paper walls, etc.

# 4. Next Claude Code session will have this context!
```

---

## Benefits

### Token Savings

**Before**: Paste 50,000 tokens of context every session

**After**: Claude Code queries knowledge base
- Query: "How does capital manager work?" (500 tokens)
- Returns: Relevant excerpt (2,000 tokens)
- **Savings**: 47,500 tokens per session!

### Discord Bot Intelligence

**Before**: Hardcoded responses

**After**: Dynamic knowledge queries
- User: "What is VKBT?"
- Bot queries knowledge base
- Returns up-to-date answer
- Can learn new info without code changes!

---

## Next Steps

1. ✅ API server running on port 8765
2. ⏳ Import this conversation
3. ⏳ Test Discord bot queries
4. ⏳ Import Van Kush explanations from Claude Chat

---

**Knowledge base is ready! Start importing to save tokens and power your Discord bot.** 🚀
