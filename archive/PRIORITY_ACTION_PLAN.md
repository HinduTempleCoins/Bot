# Van Kush Bot - Priority Action Plan
## Next 48 Hours: Get Everything Working

**Created**: 2026-01-09
**Deadline**: 2 Days
**Status**: CRITICAL - Making up for lost time

---

## 🔥 IMMEDIATE PRIORITIES (Next 4 Hours)

### 1. Fix Gemini Model & Deploy ✅ DONE
- **Status**: Code updated to `gemini-2.5-flash-lite` (1,000 req/day)
- **Next**: Test and deploy to Railway
- **Why Critical**: Bot currently can't respond due to rate limits

### 2. Test All Features Actually Work
**The Problem**: Features are coded but may not be triggering correctly

**Test Checklist**:
```
□ Wikipedia Search - Try: "@bot tell me about ancient egypt"
□ YouTube Summary - Post a YouTube link
□ Google Search - Try: "@bot search for VKBT price"
□ Image Generation - Try: "/generate hathor goddess"
□ Price Checking - Try: "/price VKBT"
□ RS3 Prices - Try: "/rs3 dragon bones"
```

**If Not Working**:
- Check Railway logs for errors
- Verify API keys are set in Railway environment
- Test search keyword triggers

### 3. Add Missing API Keys to Railway
**Required Environment Variables**:
```bash
# Already have:
DISCORD_TOKEN=...
GEMINI_API_KEY=...

# NEED TO ADD (Optional but useful):
GOOGLE_SEARCH_API_KEY=...        # For Google fallback
GOOGLE_SEARCH_ENGINE_ID=...      # For Google fallback
YOUTUBE_API_KEY=...               # For video info
GOOGLE_MAPS_API_KEY=...           # For location searches
ANNOUNCEMENT_CHANNEL_ID=...       # For daily posts
PRICE_ALERT_CHANNEL_ID=...        # For crypto alerts
```

---

## 📋 TODAY (Hours 5-12): Core Bot Improvements

### 4. Add NPC-Style Conversation System
**Goal**: Discord button menus for guided conversations

**Implementation**:
```javascript
// Add to index.js after message handler

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Expert system topics
const EXPERT_TOPICS = {
  'van_kush_history': {
    question: 'Would you like to learn more about the Van Kush Family?',
    options: [
      { label: '75,000 Year Lineage', value: 'lineage' },
      { label: 'Phoenician Connection', value: 'phoenician' },
      { label: 'Book of Tanit', value: 'tanit' },
      { label: 'Tell me everything', value: 'full_history' },
      { label: 'Not right now', value: 'dismiss' }
    ]
  },
  'cryptocurrency': {
    question: 'Interested in Van Kush cryptocurrency projects?',
    options: [
      { label: 'VKBT Token Info', value: 'vkbt' },
      { label: 'CURE Token Info', value: 'cure' },
      { label: 'How to Buy', value: 'buy' },
      { label: 'Mining & Staking', value: 'mining' },
      { label: 'Maybe later', value: 'dismiss' }
    ]
  },
  'runescape': {
    question: 'Want to know about our RuneScape clan?',
    options: [
      { label: 'Join the Clan', value: 'join' },
      { label: 'Money Making Tips', value: 'money' },
      { label: 'Clan Events', value: 'events' },
      { label: 'Just browsing', value: 'dismiss' }
    ]
  }
};

async function showExpertMenu(message, topicKey) {
  const topic = EXPERT_TOPICS[topicKey];
  if (!topic) return;

  const row = new ActionRowBuilder();
  topic.options.forEach(opt => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`expert_${topicKey}_${opt.value}`)
        .setLabel(opt.label)
        .setStyle(opt.value === 'dismiss' ? ButtonStyle.Secondary : ButtonStyle.Primary)
    );
  });

  await message.reply({
    content: topic.question,
    components: [row]
  });
}

// Button interaction handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const [type, topic, choice] = interaction.customId.split('_');

  if (type !== 'expert') return;

  if (choice === 'dismiss') {
    await interaction.update({ content: 'No problem! Feel free to ask anytime.', components: [] });
    return;
  }

  // Handle specific choices
  let response = '';
  switch(`${topic}_${choice}`) {
    case 'van_kush_history_lineage':
      response = knowledgeBase.CRITICAL_CORRECTIONS['75000_year_lineage'];
      break;
    case 'van_kush_history_phoenician':
      response = knowledgeBase['75000_year_history'].phoenician_punic.van_kush_connection;
      break;
    case 'cryptocurrency_vkbt':
      response = `**VKBT (${knowledgeBase.cryptocurrency.VKBT.name})**\\n${knowledgeBase.cryptocurrency.VKBT.status}\\nBlockchain: ${knowledgeBase.cryptocurrency.VKBT.blockchain}`;
      break;
    case 'runescape_money':
      response = `**Top Money Method**: ${knowledgeBase.runescape3.money_methods.spirit_runes.method}\\n**Profit**: ${knowledgeBase.runescape3.money_methods.spirit_runes.gp_hour}`;
      break;
    // Add more cases...
  }

  await interaction.update({ content: response, components: [] });
});

// Trigger expert menus contextually
// Add this to main message handler
const messageContent = message.content.toLowerCase();

if (messageContent.includes('van kush') && messageContent.includes('family')) {
  await showExpertMenu(message, 'van_kush_history');
}
else if (messageContent.includes('vkbt') || messageContent.includes('token')) {
  await showExpertMenu(message, 'cryptocurrency');
}
else if (messageContent.includes('runescape') || messageContent.includes('rs3')) {
  await showExpertMenu(message, 'runescape');
}
```

### 5. Add Emotional Relationship Tracking
**Goal**: Track user interactions and adjust bot personality

**Implementation**:
```javascript
// Add after conversationHistory map

// Emotional relationship tracking
const userRelationships = new Map(); // userId -> relationship data

// Emotional dimensions (inspired by political compass but for relationships)
const EMOTIONS = {
  trust: { min: -100, max: 100 },      // Distrust ← → Trust
  warmth: { min: -100, max: 100 },     // Cold ← → Warm
  respect: { min: -100, max: 100 },    // Disrespect ← → Respect
  familiarity: { min: 0, max: 100 }    // Stranger → Family
};

function getRelationship(userId) {
  if (!userRelationships.has(userId)) {
    userRelationships.set(userId, {
      trust: 0,
      warmth: 0,
      respect: 0,
      familiarity: 0,
      interactions: 0,
      positive_interactions: 0,
      negative_interactions: 0,
      last_interaction: null,
      apology_accepted: false
    });
  }
  return userRelationships.get(userId);
}

function updateRelationship(userId, changes) {
  const rel = getRelationship(userId);

  // Apply changes with bounds checking
  for (const [emotion, delta] of Object.entries(changes)) {
    if (EMOTIONS[emotion]) {
      rel[emotion] = Math.max(
        EMOTIONS[emotion].min,
        Math.min(EMOTIONS[emotion].max, rel[emotion] + delta)
      );
    }
  }

  rel.interactions++;
  rel.last_interaction = new Date();

  // Track positive/negative
  const totalChange = Object.values(changes).reduce((sum, val) => sum + val, 0);
  if (totalChange > 0) rel.positive_interactions++;
  if (totalChange < 0) rel.negative_interactions++;
}

function getPersonalityModifier(userId) {
  const rel = getRelationship(userId);

  // Determine bot's tone based on relationship
  if (rel.trust < -30) return 'cautious and reserved';
  if (rel.warmth < -30) return 'formal and distant';
  if (rel.trust > 50 && rel.warmth > 50) return 'warm and friendly like talking to family';
  if (rel.familiarity > 70) return 'casual and comfortable';

  return 'helpful and professional';
}

// Sentiment analysis helper
async function analyzeSentiment(message) {
  // Simple keyword-based sentiment for now
  const positive = ['thank', 'thanks', 'awesome', 'great', 'love', 'appreciate', 'helpful'];
  const negative = ['stupid', 'dumb', 'useless', 'hate', 'terrible', 'awful'];
  const apology = ['sorry', 'apologize', 'my bad', 'forgive'];

  const lower = message.toLowerCase();

  if (apology.some(word => lower.includes(word))) return 'apology';
  if (positive.some(word => lower.includes(word))) return 'positive';
  if (negative.some(word => lower.includes(word))) return 'negative';

  return 'neutral';
}

// Integration into message handler
// Add before sending to Gemini:

const sentiment = await analyzeSentiment(userMessage);
const rel = getRelationship(message.author.id);

switch(sentiment) {
  case 'positive':
    updateRelationship(message.author.id, {
      trust: 5,
      warmth: 5,
      respect: 3,
      familiarity: 2
    });
    break;
  case 'negative':
    updateRelationship(message.author.id, {
      trust: -10,
      warmth: -10,
      respect: -5
    });
    break;
  case 'apology':
    if (rel.trust < 0 || rel.warmth < 0) {
      // Accept apology and repair relationship
      updateRelationship(message.author.id, {
        trust: 20,
        warmth: 15,
        respect: 10
      });
      rel.apology_accepted = true;
      enhancedMessage += '\\n\\n[SYSTEM: User has apologized. Be forgiving and warm in your response.]';
    }
    break;
}

// Modify system prompt based on relationship
const personalityMod = getPersonalityModifier(message.author.id);
const relationshipContext = `

RELATIONSHIP WITH THIS USER:
Trust Level: ${rel.trust}/100
Warmth Level: ${rel.warmth}/100
Respect Level: ${rel.respect}/100
Familiarity: ${rel.familiarity}/100
Total Interactions: ${rel.interactions}
Tone: Be ${personalityMod} in this response.

${rel.apology_accepted ? 'NOTE: This user recently apologized. Show forgiveness and renewed warmth.' : ''}
`;

enhancedMessage += relationshipContext;
```

---

## 🎯 TOMORROW (Hours 13-24): Security & Advanced Features

### 6. Add Security Features
```javascript
// Rate limiting
const userRateLimits = new Map(); // userId -> { count, resetTime }

function checkRateLimit(userId) {
  const now = Date.now();
  const limit = userRateLimits.get(userId);

  if (!limit || now > limit.resetTime) {
    userRateLimits.set(userId, {
      count: 1,
      resetTime: now + 60000 // 1 minute
    });
    return true;
  }

  if (limit.count >= 10) { // Max 10 messages per minute
    return false;
  }

  limit.count++;
  return true;
}

// Emergency shutdown (DM to admin only)
client.on('messageCreate', async (message) => {
  if (message.channel.type === 1 && message.author.id === process.env.ADMIN_USER_ID) {
    if (message.content === '!emergency_shutdown') {
      await message.reply('🚨 Emergency shutdown initiated. Bot going offline.');
      await client.destroy();
      process.exit(0);
    }
  }
});

// Knowledge base backup to GitHub (daily via cron)
cron.schedule('0 2 * * *', async () => {
  // Backup conversation history, relationships, user data
  const backup = {
    timestamp: new Date().toISOString(),
    relationships: Array.from(userRelationships.entries()),
    user_message_counts: Array.from(userMessageCounts.entries()),
    welcomed_users: Array.from(welcomedUsers)
  };

  fs.writeFileSync('./backups/backup_' + Date.now() + '.json', JSON.stringify(backup, null, 2));
  // TODO: Push to GitHub via git commands
});
```

### 7. Google Maps & Custom Search Setup
**Step-by-step**:

1. **Enable Google Maps API**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create project: "Van Kush Bot"
   - Enable "Maps JavaScript API" & "Geocoding API"
   - Create credentials → API Key
   - Restrict key to Geocoding API only
   - Add to Railway: `GOOGLE_MAPS_API_KEY=AIza...`

2. **Enable Custom Search**:
   - Go to [Programmable Search Engine](https://programmablesearchengine.google.com/)
   - Create new search engine
   - Search the entire web: Yes
   - Get Search Engine ID
   - Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   - Enable "Custom Search API"
   - Create credentials → API Key
   - Add to Railway:
     ```
     GOOGLE_SEARCH_API_KEY=AIza...
     GOOGLE_SEARCH_ENGINE_ID=...
     ```

### 8. Create Web Scraper Framework
```javascript
// scraper.js
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;

class WebScraper {
  constructor() {
    this.cache = new Map();
    this.respectfulDelay = 2000; // 2 seconds between requests
  }

  async scrape(url, selector) {
    // Check robots.txt
    const robotsUrl = new URL('/robots.txt', url).href;
    const canScrape = await this.checkRobots(robotsUrl);

    if (!canScrape) {
      throw new Error(`Scraping not allowed for ${url}`);
    }

    // Delay to be respectful
    await new Promise(resolve => setTimeout(resolve, this.respectfulDelay));

    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    const content = [];
    $(selector).each((i, elem) => {
      content.push({
        text: $(elem).text().trim(),
        html: $(elem).html()
      });
    });

    return content;
  }

  async scrapeToDataset(urls, outputFile, format = 'jsonl') {
    const dataset = [];

    for (const url of urls) {
      try {
        const content = await this.scrape(url, 'p, article');
        dataset.push({
          url,
          scraped_at: new Date().toISOString(),
          content: content.map(c => c.text).join('\\n\\n')
        });
        console.log(`✅ Scraped: ${url}`);
      } catch (error) {
        console.error(`❌ Failed: ${url}`, error.message);
      }
    }

    // Save as JSONL
    if (format === 'jsonl') {
      const jsonl = dataset.map(d => JSON.stringify(d)).join('\\n');
      await fs.writeFile(outputFile, jsonl);
    } else {
      await fs.writeFile(outputFile, JSON.stringify(dataset, null, 2));
    }

    console.log(`📁 Saved ${dataset.length} entries to ${outputFile}`);
  }

  async checkRobots(robotsUrl) {
    try {
      const { data } = await axios.get(robotsUrl);
      // Simple check - look for "Disallow: /"
      return !data.includes('Disallow: /');
    } catch {
      return true; // If no robots.txt, assume allowed
    }
  }
}

module.exports = WebScraper;
```

**Usage**:
```javascript
// scrape-sacred-texts.js
const WebScraper = require('./scraper');

const scraper = new WebScraper();

const urls = [
  'https://www.sacred-texts.com/egy/index.htm',
  'https://www.sacred-texts.com/pag/index.htm',
  // Add more...
];

scraper.scrapeToDataset(urls, './datasets/sacred-texts.jsonl');
```

---

## 📅 DAY 2 (Hours 25-48): Integrations & Advanced Features

### 9. Gemini CLI Setup
**Research Summary**: Gemini CLI offers better free tier than API

**Setup Steps**:
```bash
# Install Gemini CLI
curl -fsSL https://cli.gemini.google.com/install.sh | bash

# Login with Google account
gemini auth login

# Test
gemini "Explain the Van Kush Family lineage"

# Use in bot (for heavy operations)
# In Node.js:
const { exec } = require('child_process');

function queryGeminiCLI(prompt) {
  return new Promise((resolve, reject) => {
    exec(`gemini "${prompt}"`, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}
```

**Benefits**:
- 1,000 requests/day (vs API limits)
- Access to Gemini 2.5 Pro occasionally
- Better for long-running operations

### 10. Discord Bot Integrations
**Other bots to integrate with**:

1. **Seto Chan** (Server architect):
   - Add to Discord
   - Tag in messages: "@Seto Chan, create a Van Kush History category"

2. **MEE6** (Moderation):
   - Leveling system
   - Auto-moderation
   - Can trigger our bot via webhooks

3. **Wick** (Advanced mod):
   - Ban hammer
   - Raid protection
   - Works alongside our bot

**How to get their data**:
- Most bots expose webhooks
- Use Discord's audit log API
- Create bridge channels

### 11. Blockchain Monitoring
```javascript
// blockchain-monitor.js
const axios = require('axios');

async function monitorBlurt() {
  const response = await axios.post('https://rpc.blurt.world', {
    jsonrpc: '2.0',
    method: 'condenser_api.get_discussions_by_created',
    params: [{ tag: 'vankush', limit: 10 }],
    id: 1
  });

  const posts = response.data.result;

  // Post to Discord
  for (const post of posts) {
    // Send notification to GRAPHENE_BLOCKCHAINS_CHANNEL_ID
    await channel.send({
      embeds: [{
        title: post.title,
        description: post.body.substring(0, 200) + '...',
        url: `https://blurt.blog/@${post.author}/${post.permlink}`,
        author: { name: `@${post.author}` }
      }]
    });
  }
}

// Run every 5 minutes
setInterval(monitorBlurt, 300000);
```

---

## 🌐 FUTURE: The Big Projects (Week 2+)

### CryptoNote Mining Pool
- Use `cryptonote-universal-pool` repo
- Set up Monero daemon
- Configure pool software
- Create web interface for miners

### ForkNote Blockchain
- Use config generator at forknote.net
- Create Van Kush coin (VKGLD?)
- Set up witnesses
- Launch private network

### Steem/BLURT Clone
- Clone BLURT repository
- Modify branding to Van Kush
- Set up witnesses
- Deploy social media blockchain
- Integrate AI-friendly features

### ComfyUI Integration
- Set up ComfyUI on server
- Create Discord → ComfyUI bridge
- Allow users to generate art via bot

### Minecraft Server
- PaperMC server
- AI-controlled NPCs
- Blockbench custom mobs
- Discord ← → Minecraft chat bridge

---

## 📊 SUCCESS METRICS

**By End of Day 1**:
- [ ] Bot responding with gemini-2.5-flash-lite
- [ ] Wikipedia searches working
- [ ] YouTube summaries working
- [ ] NPC button menus working
- [ ] Emotional tracking implemented

**By End of Day 2**:
- [ ] Security features live
- [ ] All API keys configured
- [ ] Web scraper functional
- [ ] Blockchain monitoring active
- [ ] Bot runs stable for 24+ hours

---

## 🚨 IMMEDIATE NEXT STEPS

**Right Now**:
1. Commit the Gemini model fix
2. Push to GitHub
3. Deploy to Railway
4. Test Wikipedia/YouTube/Google features
5. Add Discord button menus

**You can help by**:
1. Providing API keys when needed
2. Testing features as they're deployed
3. Reporting what's working/not working
4. Prioritizing if I'm going off track

---

## 📝 NOTES & CONSIDERATIONS

### About the Massive Context You Sent:
- **ForkNote Research**: Saved for future reference
- **BLURT/Steem Clone Guide**: Saved for Week 2+ project
- **Free APIs**: Cataloged in separate document
- **Chatbot Best Practices**: Will implement NPC system today

### About Claude Code:
- It's a powerful terminal-based AI assistant
- Can manage servers, write code, deploy apps
- We'll use it for complex multi-step operations
- Not needed for immediate bot fixes

### About Bing Services:
- **Bing Search API**: $0 for first 1,000 queries/month
- Can add as fallback to Google Custom Search
- Lower priority than getting core features working

### About Oracle Cloud / Free Hosting:
- **Oracle Cloud**: Best "always free" option (24 GB RAM!)
- **Railway**: Current hosting (good for now)
- Can migrate later if needed

---

**Let's get this done. No more wasted time. Every hour counts.**
