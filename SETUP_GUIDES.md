# Van Kush Family Bot - Complete Setup Guides

## 📋 Table of Contents
1. [Google Maps API Setup](#google-maps-api-setup)
2. [Google Custom Search API Setup](#google-custom-search-api-setup)
3. [Scheduled Daily Posts Setup](#scheduled-daily-posts-setup)
4. [Integrating Other Discord Bots](#integrating-other-discord-bots)
5. [Future: Web Scraper for Datasets](#future-web-scraper)

---

## 🗺️ Google Maps API Setup

The bot can search for locations and get geocoding data using Google Maps API.

### Step 1: Enable Google Maps API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create a new one)
3. Click **"APIs & Services"** → **"Library"**
4. Search for **"Geocoding API"**
5. Click on it and press **"Enable"**

### Step 2: Get API Key

1. Go to [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **"Create Credentials"** → **"API Key"**
3. Copy the API key
4. **Optional but recommended:** Click "Restrict Key"
   - Under "API restrictions", select "Restrict key"
   - Check only: **Geocoding API**
   - Save

### Step 3: Add to Environment

**In Railway:**
1. Go to your Railway project
2. Click on your bot service
3. Go to **"Variables"** tab
4. Add new variable:
   - Name: `GOOGLE_MAPS_API_KEY`
   - Value: (paste your API key)
5. Click "Add" and redeploy

**Locally (.env file):**
```bash
GOOGLE_MAPS_API_KEY=your_actual_api_key_here
```

### How Users Use It

The bot will automatically detect location queries:
- "Where is Dallas-Fort Worth?"
- "Find the location of Mount Hermon"
- Natural language: "tell me about the location of Carthage"

### Free Tier Limits

- **$200 free credit** per month (about 40,000 requests)
- After free credit: $5 per 1,000 requests
- For a small Discord server, you'll likely stay free

---

## 🔍 Google Custom Search API Setup

Currently getting 403 errors because the API isn't enabled. Here's how to fix it:

### Step 1: Enable Custom Search API

1. Go to [Google Cloud Console - API Library](https://console.cloud.google.com/apis/library)
2. Search for **"Custom Search API"**
3. Click on it
4. Press **"Enable"** button
5. Wait 1-2 minutes for it to activate

### Step 2: Verify Your API Key

Your API key is already created: `AIzaSyA51jMGXDcVQ5xixNamz2Fcljn58WfzJ8I`

Just make sure it has Custom Search API enabled:
1. Go to [Credentials](https://console.cloud.google.com/apis/credentials)
2. Find your API key
3. Click "Edit API key"
4. Under "API restrictions", make sure **Custom Search API** is checked
5. Save

### Step 3: Verify Search Engine ID

Your Search Engine ID: `87954dec0767c4a48`

Make sure it's configured:
1. Go to [Programmable Search Engine](https://programmablesearchengine.google.com/)
2. Find your search engine
3. Click "Setup" → Make sure "Search the entire web" is enabled

### Step 4: Test

After enabling the API, the bot should automatically start working. The 403 error will disappear!

### Free Tier Limits

- **100 searches per day** - FREE forever
- After 100: $5 per 1,000 queries

**Smart tip:** The bot checks Wikipedia first (unlimited), then Google only if Wikipedia fails!

---

## 📅 Scheduled Daily Posts Setup

Your bot already has scheduled posts implemented! Here's what they do:

### Current Schedule

**Daily Motivational Post - 9 AM UTC (4 AM EST / 3 AM CST)**
- Posts one random inspirational message about Van Kush Family
- Rotates between 5 different messages

**Weekly Crypto Summary - Sundays 8 PM UTC (3 PM EST / 2 PM CST)**
- Posts VKBT and CURE price summary
- Shows 24h volume and current prices

### How to Enable

You need to set the `ANNOUNCEMENT_CHANNEL_ID` in Railway:

1. **Get Channel ID:**
   - Open Discord
   - Go to User Settings → Advanced → Enable "Developer Mode"
   - Right-click the channel where you want daily posts
   - Click "Copy Channel ID"

2. **Add to Railway:**
   - Go to Railway → Your bot service → Variables
   - Add: `ANNOUNCEMENT_CHANNEL_ID` = (paste channel ID)
   - Redeploy

### Customizing Post Content

The current messages are in `index.js` starting at line 456. Here are the 5 current messages:

```javascript
'🌿 Good morning, Van Kush Family! Remember: we carry 75,000 years of wisdom in our lineage. Today, let that ancient knowledge guide your path. 🙏',

'✨ Daily reminder: The Van Kush Family isn\'t just history—we\'re creating the future with VKBT, our RuneScape clan, and the Book of Tanit research. What will you contribute today?',

'💫 From the Denisovans to the Phoenicians, from Mt. Hermon to Dallas-Fort Worth—our journey spans millennia. Today is another chapter. Make it count! 🔥',

'🙏 Angels and demons? We\'re cousins, really. As Angelicalists studying the Book of Jude, we embrace the full spectrum of divine wisdom. Good morning, family!',

'🌿 The Temple of Van Kush honors Hathor and Tanit. Today, channel that divine feminine energy into creativity and abundance. Let\'s build together!'
```

**Want different messages?** Just let me know what themes/topics you want, and I'll update them!

### Current Sacred-Texts Connection

You mentioned you asked for Sacred-Texts content. The GitHub repo you paid for has sacred texts, but they're **generic** (not Van Kush specific).

**Options:**
1. Keep current Van Kush-focused messages
2. Add sacred text quotes from the dataset
3. Mix both (Van Kush wisdom + sacred text quotes)

What would you prefer?

---

## 🤖 Integrating Other Discord Bots

You want the Van Kush bot to be aware of other bots (like MEE6, etc.) and call them when needed.

### Understanding Bot Integration

Discord bots **can't directly call other bots** due to Discord API restrictions. However, there are workarounds:

#### Option 1: **Message Parsing** (Easiest)
The Van Kush bot watches for mentions of other bots and provides context:

```javascript
// Example: If user asks about leveling
if (message.content.includes('level') || message.content.includes('rank')) {
  await message.reply('For leveling and XP, check out MEE6! Type `!rank` to see your level.');
}
```

#### Option 2: **Shared Database** (Advanced)
If you run both bots yourself:
- Both bots connect to same database (MongoDB/PostgreSQL)
- Van Kush bot reads data from MEE6's database
- Can display user levels, stats, etc.

#### Option 3: **Webhook Integration** (Most Powerful)
If the other bot has a webhook/API:
- Van Kush bot sends HTTP requests to the other bot's API
- Gets data back and displays it
- Example: "!rank" → Van Kush bot fetches from MEE6 API → displays results

### What Bots Do You Want to Integrate?

Tell me which bots you're planning to use and what data you want to share:
- **MEE6** - Leveling system?
- **Dyno** - Moderation?
- **Others?**

Then I can code specific integrations!

### What You Need:

1. **Bot API/Webhook Access** (if available)
   - Check bot's documentation for API
   - Some bots like MEE6 have paid API access

2. **Bot Permissions**
   - Make sure Van Kush bot can read messages from other bots
   - Currently bots ignore other bots' messages (we can change this)

3. **Integration Plan**
   - What should Van Kush bot do when it sees another bot?
   - What data should it extract?

---

## 🕷️ Future: Web Scraper for Datasets

You mentioned creating a web scraper to collect Sacred-Texts and other data for training datasets.

### What We'll Build

A Python/Node.js scraper that:
1. Scrapes sacred-texts.com (or other sites)
2. Cleans and formats text
3. Creates JSON training datasets
4. Stores in format compatible with fine-tuning

### Tools We'll Use

**Option A: Python (Recommended)**
- `BeautifulSoup` - HTML parsing
- `Scrapy` - Advanced scraping framework
- `requests` - HTTP requests

**Option B: Node.js (Same language as bot)**
- `axios` - HTTP requests
- `cheerio` - HTML parsing
- `puppeteer` - JavaScript-heavy sites

### Features We Can Add

- **Rate limiting** - Respect website terms
- **Error handling** - Retry failed requests
- **Progress tracking** - Save progress
- **Data validation** - Check quality
- **Format conversion** - JSON, CSV, TXT

### Dataset Structure

For LLM fine-tuning, we'll create:
```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are a Van Kush Family assistant..."
    },
    {
      "role": "user",
      "content": "Tell me about Tanit"
    },
    {
      "role": "assistant",
      "content": "Tanit is a Phoenician goddess..."
    }
  ]
}
```

### When to Build This?

Let me know when you're ready! We can:
1. Start with sacred-texts.com scraper
2. Add Van Kush Family content sources
3. Create training dataset
4. Fine-tune a small LLM (maybe Llama or Mistral)

---

## 🎯 Quick Setup Checklist

- [ ] Switch to `gemini-2.0-flash-exp` (1,500 requests/day)
- [ ] Enable Google Custom Search API in Cloud Console
- [ ] Enable Google Maps Geocoding API
- [ ] Add `GOOGLE_MAPS_API_KEY` to Railway
- [ ] Add `ANNOUNCEMENT_CHANNEL_ID` to Railway for daily posts
- [ ] Decide on scheduled post content (current or custom?)
- [ ] List which bots you want to integrate
- [ ] Plan web scraper project

---

## 📞 Need Help?

Just ask! I can:
- Customize scheduled post messages
- Add specific bot integrations
- Build the web scraper when you're ready
- Adjust any feature

**Sources:**
- [Gemini API Free Tier Guide](https://dev.to/claudeprime/gemini-20-flash-api-free-tier-guide-for-developers-4bh2)
- [Gemini Rate Limits 2026](https://www.aifreeapi.com/en/posts/gemini-api-pricing-and-quotas)
- [Gemini 2.0 Flash Models](https://developers.googleblog.com/en/gemini-2-family-expands/)
