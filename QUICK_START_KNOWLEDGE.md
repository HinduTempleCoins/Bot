# Knowledge Base - Quick Start

## On Your Google VM (5 minutes)

### 1. Start the API Server

```bash
cd ~/Bot

# Start knowledge base API
pm2 start knowledge-base.py --name knowledge-api --interpreter python3 -- --serve --port 8765

# Save PM2 config
pm2 save

# Verify it's running
pm2 status
curl http://localhost:8765/stats
```

**Done!** Discord bot can now query at `http://localhost:8765/query?q=what+is+VKBT`

---

### 2. Import This Session (Optional, Saves Tokens)

```bash
# Export this conversation from Claude Code:
# Menu → Export conversation → Save as text file

# Copy file to VM, then:
cd ~/Bot
./import-claude-code-session.sh

# Prompts:
# - Filename: jan10-session.txt (or paste)
# - Title: "Trading Bot Development - Jan 10 2026"
# - Category: Press Enter (auto-detects)
```

**Result**: Next Claude Code session will have full context of today's work!

---

## Current Status

### Already Working

✅ **17 documents loaded** from `vkbt_cure_knowledge.jsonl`
✅ **533 keywords indexed** across 13 categories
✅ **Full-text search** ready
✅ **API endpoints** ready for Discord bot

### Test It

```bash
# Search from command line
python3 knowledge-base.py --search "VKBT"

# Test API
curl "http://localhost:8765/search?q=VKBT"
curl "http://localhost:8765/query?q=what+is+CURE"
```

---

## For Discord Bot Integration

### In your Discord bot code:

```javascript
const axios = require('axios');

// Query knowledge base
async function askKnowledge(question) {
  const response = await axios.get('http://localhost:8765/query', {
    params: { q: question }
  });

  return response.data.response;
}

// Use it
client.on('messageCreate', async message => {
  if (message.content.startsWith('!ask ')) {
    const question = message.content.slice(5);
    const answer = await askKnowledge(question);
    message.reply(answer);
  }
});
```

**Your Discord bot can now answer questions dynamically!**

---

## Security

✅ All datasets in `.gitignore` - never pushed
✅ API only on localhost (127.0.0.1:8765)
✅ Auto-sanitizes HIVE keys (5Jxxx...)
✅ `.env` never committed

**Safe to import any conversation!**

---

## Full Documentation

See `KNOWLEDGE_BASE_SETUP.md` for complete details.
See `TWO_KNOWLEDGE_BASES.md` for concept explanation.

---

**That's it! 5 minutes to enable intelligent Discord bot and token-saving context.** 🚀
