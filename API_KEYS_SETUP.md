# API Keys Setup Guide

This guide will help you get all the FREE API keys needed for the Van Kush Family Bot's advanced features.

## Required API Keys

### 1. Discord Bot Token ✅ (Already have)
- **Status:** Already configured
- **Cost:** FREE
- **Your token:** Starts with `MTQ1NzcxNjU1...`

### 2. Gemini API Key ✅ (Already have)
- **Status:** Already configured
- **Cost:** FREE (1,500 requests/day)
- **Your key:** Starts with `AIzaSy...`

---

## Optional API Keys (For New Features)

### 3. Google Custom Search API (OPTIONAL)
**Feature:** Bot can search Google and cite sources when answering questions

**Cost:** FREE - 100 searches per day

**Setup Steps:**

1. **Go to Google Cloud Console:**
   - Visit: https://console.cloud.google.com/apis/credentials
   - Sign in with your Google account

2. **Select Your Project:**
   - Use the existing "angelic-intelligence" project
   - Or create a new one

3. **Enable Custom Search API:**
   - Visit: https://console.cloud.google.com/apis/library/customsearch.googleapis.com
   - Click **"Enable"**

4. **Create API Key:**
   - Go to: https://console.cloud.google.com/apis/credentials
   - Click **"Create Credentials"** → **"API Key"**
   - Copy the API key (starts with `AIza...`)
   - (Optional) Click "Restrict Key" → Select "Custom Search API"

5. **Create Custom Search Engine:**
   - Go to: https://programmablesearchengine.google.com/
   - Click **"Add"** or **"Create"**
   - Name: "Van Kush Family Search"
   - What to search: Select **"Search the entire web"**
   - Click **"Create"**
   - Copy your **Search Engine ID** (looks like: `a1b2c3d4e5f6g7h8i`)

6. **Add to .env file:**
   ```
   GOOGLE_SEARCH_API_KEY=your_api_key_here
   GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id_here
   ```

7. **Add to Railway:**
   - Go to Railway → Your project → Variables
   - Add both variables

---

### 4. YouTube Data API (OPTIONAL)
**Feature:** Bot auto-summarizes YouTube videos when URLs are posted

**Cost:** FREE - 10,000 quota points per day (~100 video summaries)

**Setup Steps:**

1. **Enable YouTube Data API:**
   - Visit: https://console.cloud.google.com/apis/library/youtube.googleapis.com
   - Click **"Enable"**

2. **Create API Key:**
   - Go to: https://console.cloud.google.com/apis/credentials
   - Click **"Create Credentials"** → **"API Key"**
   - Copy the API key
   - (Optional) Restrict to "YouTube Data API v3"

3. **Add to .env file:**
   ```
   YOUTUBE_API_KEY=your_youtube_api_key_here
   ```

4. **Add to Railway:**
   - Go to Railway → Variables
   - Add `YOUTUBE_API_KEY`

**Note:** YouTube transcript feature works WITHOUT an API key! The API key just adds metadata.

---

### 5. Price Alert Channel ID
**Feature:** Get Discord alerts when VKBT/CURE prices move >5%

**Cost:** FREE (no API needed)

**Setup Steps:**

1. **Enable Developer Mode in Discord:**
   - Open Discord
   - Go to User Settings (gear icon)
   - App Settings → Advanced
   - Toggle **"Developer Mode"** ON

2. **Get Channel ID:**
   - Right-click the channel where you want price alerts
   - Click **"Copy Channel ID"**

3. **Add to .env file:**
   ```
   PRICE_ALERT_CHANNEL_ID=1234567890123456789
   ```

4. **Add to Railway:**
   - Go to Railway → Variables
   - Add `PRICE_ALERT_CHANNEL_ID`

---

## Current Features Summary

### ✅ Already Working (No extra setup needed):
- AI Conversation with Gemini
- Van Kush Family knowledge base
- `/help` command

### 🆓 FREE - No API needed:
- `/generate [prompt]` - AI art generation (Pollinations.ai)
- `/price [token]` - HIVE-Engine crypto prices
- YouTube video auto-summaries (basic)
- HIVE-Engine price monitoring

### 🔑 Requires Optional API keys:
- Google Search integration → Needs Google Custom Search API
- YouTube metadata → Needs YouTube Data API (optional)
- Price alerts → Needs Discord channel ID

---

## Quick Reference: All Environment Variables

```env
# Required (already have)
DISCORD_TOKEN=your_discord_bot_token
GEMINI_API_KEY=your_gemini_api_key

# Optional (new features)
GOOGLE_SEARCH_API_KEY=your_google_api_key
GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id
YOUTUBE_API_KEY=your_youtube_api_key
PRICE_ALERT_CHANNEL_ID=your_channel_id
```

---

## Testing New Features

### Test AI Art Generation:
```
/generate Hathor goddess with Egyptian symbols vaporwave
```

### Test Crypto Prices:
```
/price VKBT
/price CURE
```

### Test YouTube Summarization:
Post any YouTube URL in chat (works automatically)

### Test Google Search:
```
@VanKushFamilyMod search for information about Phoenician navigation
```

### Test Price Monitoring:
Price alerts happen automatically every 5 minutes if configured!

---

## Cost Breakdown

| Feature | API | Daily Limit | Monthly Cost |
|---------|-----|-------------|--------------|
| AI Chat | Gemini | 1,500 requests | **FREE** |
| AI Art | Pollinations.ai | Unlimited | **FREE** |
| Crypto Prices | HIVE-Engine | Unlimited | **FREE** |
| Price Monitoring | HIVE-Engine | Every 5min | **FREE** |
| Google Search | Custom Search | 100 searches | **FREE** |
| YouTube | Data API v3 | 10,000 quota | **FREE** |

**Total Monthly Cost: $0** 🎉

---

## Troubleshooting

### Google Search not working?
- Make sure you created a **Custom Search Engine** (not just API key)
- Verify you selected "Search the entire web"
- Check both API key AND Engine ID are in .env

### YouTube summaries not working?
- YouTube transcript works WITHOUT API key
- Check if video has captions/transcript available
- API key only needed for metadata (optional)

### Price alerts not showing?
- Verify channel ID is correct (use Developer Mode)
- Make sure bot has permission to post in that channel
- Alerts only trigger on >5% price movement

### Art generation slow?
- Pollinations.ai is FREE but can be slow during peak hours
- Images are generated on-demand
- Try refreshing if image doesn't load

---

## Next Steps

1. Choose which features you want to enable
2. Get the API keys you need (all FREE!)
3. Add them to your `.env` file locally
4. Add them to Railway variables
5. Redeploy (Railway auto-deploys on new variables)
6. Test the features!

**Questions?** Ask the bot! It knows about all these features. 🌿
