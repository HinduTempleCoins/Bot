# Van Kush Family Bot - Features Overview

## Commands

### `/generate [prompt]`
Generate AI art using Pollinations.ai

**Examples:**
```
/generate Hathor goddess with Egyptian symbols
/generate Van Kush temple vaporwave aesthetic
/generate Phoenix rising from ashes ancient mystical
```

**Features:**
- Unlimited FREE generations
- Vaporwave/Egyptian aesthetic by default
- Returns beautiful Discord embed with image
- No API key needed!

---

### `/price [token]`
Get real-time HIVE-Engine cryptocurrency prices

**Examples:**
```
/price VKBT
/price CURE
/price DEC
```

**Shows:**
- Last price in HIVE
- 24h trading volume
- 24h price change percentage
- Beautiful Discord embed

**No API key needed!**

---

### `/help`
Shows all available commands with examples

---

## Automatic Features

### 📺 YouTube Video Summarization
**How it works:** Just post a YouTube URL!

The bot will automatically:
1. Detect the YouTube URL
2. Fetch the video transcript
3. Summarize it using Gemini AI
4. Post a 2-3 paragraph summary

**No command needed - works automatically!**

**Example:**
```
User: https://www.youtube.com/watch?v=dQw4w9WgXcQ
Bot: [Posts summary in nice embed]
```

---

### 💰 Price Monitoring & Alerts
**How it works:** Runs automatically every 5 minutes

The bot monitors VKBT and CURE prices and sends alerts when:
- Price moves >5% (up or down)
- Shows current vs previous price
- Shows 24h volume

**Setup Required:**
1. Get your Discord channel ID (see API_KEYS_SETUP.md)
2. Add `PRICE_ALERT_CHANNEL_ID` to .env and Railway

**Example Alert:**
```
📈 VKBT Price Alert!
+7.52% price movement detected

Current Price: 0.00042000 HIVE
Previous Price: 0.00039000 HIVE
24h Volume: 125.50 HIVE
```

---

### 🔍 Google Search Integration
**How it works:** Bot automatically searches when you ask questions

**Trigger Keywords:**
- "search"
- "google"
- "find"
- "look up"
- "what is"
- "who is"
- "when did"
- "where is"

**Example:**
```
@VanKushFamilyMod search for information about Phoenician navigation

Bot: [Searches Google, gets top 3 results, synthesizes answer, cites sources]
```

**Setup Required:**
- Google Custom Search API key
- Custom Search Engine ID
- See API_KEYS_SETUP.md for instructions

---

## Chat Features

### 💬 AI Conversation
**How to chat:**
- Mention the bot: `@VanKushFamilyMod [message]`
- Or send a DM

**Knowledge includes:**
- Van Kush Family history (75,000 years)
- Rev. Ryan and Kali Van Kush
- Cryptocurrency (VKBT, VKRW, PUTI)
- RuneScape 3 clan information
- Book of Tanit research
- Shaivite Temple information
- Angel theology and Angelicalism

**Features:**
- Conversation history per channel
- Warm, wise, knowledgeable responses
- Can search Google for current info (if API configured)
- Can summarize YouTube videos
- Signature: "Angels and demons? We're cousins, really."

---

## API Keys Summary

| Feature | API Needed | Cost | Daily Limit |
|---------|-----------|------|-------------|
| AI Chat | Gemini | FREE | 1,500 requests |
| AI Art | Pollinations.ai | FREE | Unlimited |
| Crypto Prices | HIVE-Engine | FREE | Unlimited |
| Price Monitoring | HIVE-Engine | FREE | Every 5min |
| YouTube Summaries | None! | FREE | Unlimited |
| Google Search | Custom Search (optional) | FREE | 100 searches |

**Total Monthly Cost: $0** 🎉

---

## Feature Status

### ✅ Working Now (No extra setup):
- `/generate` - AI art generation
- `/price` - Crypto prices
- `/help` - Command list
- YouTube video summarization
- AI conversation with knowledge base
- Price monitoring (needs channel ID)

### 🔑 Requires Optional API Keys:
- Google Search integration
- YouTube metadata (optional, not required for summaries)
- Price alerts (needs Discord channel ID only)

---

## Next Features (Phase 2)

### Planned for Future:
1. Trading logic for HIVE-Engine (later phase)
2. Van Kush content playlist curator
3. More RS3 clan integration
4. Custom commands for common questions
5. Multi-language support

---

## Testing Checklist

- [ ] Test `/generate Hathor goddess vaporwave`
- [ ] Test `/price VKBT`
- [ ] Test `/price CURE`
- [ ] Test `/help`
- [ ] Post a YouTube URL and verify summary
- [ ] Mention bot and ask a question
- [ ] Try "search for [topic]" to test Google integration (if configured)
- [ ] Verify price alerts work (if channel ID configured)

---

## Support

For issues or questions:
- Check API_KEYS_SETUP.md for detailed setup instructions
- Verify Railway logs for errors
- Make sure all environment variables are set correctly

**All features are designed to work with FREE APIs!** 🌿
