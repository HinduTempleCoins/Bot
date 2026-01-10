# Van Kush Family - Knowledge Base System Guide

**Comprehensive guide to the token-saving knowledge base system**

---

## 🎯 Overview

This system solves a major problem: **wasting tokens by dumping data into context**.

Instead of sending large amounts of information to Claude or Discord bot every time, we:
1. Scrape and store information ONCE
2. Query the knowledge base when needed
3. Save thousands of tokens per conversation

### What's Included:

- **Web Scraper**: Sacred-Texts, Theoi, Project Gutenberg
- **Crypto News Scraper**: CoinDesk, CoinTelegraph, Decrypt
- **Email Scraper**: Contact profiling system
- **Claude Archive Importer**: Your PDF/text discussions
- **Knowledge Base**: Searchable database with API
- **Timeline Builder**: Chronological organization

---

## 📚 Quick Start

### 1. Initial Setup

```bash
# Make scripts executable
chmod +x master-scraper.sh web-scraper.py crypto-news-scraper.py knowledge-base.py

# Create datasets directory
mkdir -p datasets

# Load existing VKBT/CURE knowledge
# (already created in datasets/vkbt_cure_knowledge.jsonl)
```

### 2. Scrape Crypto News

```bash
# Get last 48 hours of crypto news
python3 crypto-news-scraper.py --update-news --hours 48

# Output: datasets/crypto_news_timeline.jsonl
```

### 3. Import Your Claude Discussions

```bash
# Import a text file
python3 web-scraper.py --source archive \
  --file "my-claude-discussion.txt" \
  --title "VKBT Trading Strategy Discussion"

# Import a PDF
python3 web-scraper.py --source archive \
  --file "van-kush-history.pdf" \
  --title "Van Kush Family History"

# Output: datasets/claude_archives_dataset.jsonl
```

### 4. Query the Knowledge Base

```bash
# Load and search
python3 knowledge-base.py --datasets-dir datasets --search "VKBT"

# Get statistics
python3 knowledge-base.py --datasets-dir datasets --stats

# List categories
python3 knowledge-base.py --datasets-dir datasets --categories
```

### 5. Start API Server (for Discord bot)

```bash
# Start knowledge base API
python3 knowledge-base.py --datasets-dir datasets --serve --port 8765

# Test it:
# http://localhost:8765/search?q=VKBT
# http://localhost:8765/query?q=what+is+CURE
# http://localhost:8765/stats
```

---

## 🔧 Detailed Usage

### Scraping Mythology Topics

The system is configured to scrape information about:
- **Metatron** (archangel, scribe of God)
- **Zar** (possession spirits)
- **Phoenicians** (ancient civilization)
- **Egyptian gods** (Ra, Osiris, Isis, etc.)
- **Sumerian mythology** (Enki, Enlil, Gilgamesh)
- **Kabbalah** (Jewish mysticism)

**Sacred-Texts.com** (mythology, ancient texts):
```bash
# Note: Check robots.txt first!
python3 web-scraper.py --source sacred-texts \
  --url "https://www.sacred-texts.com/egy/" \
  --max-pages 50
```

**Theoi.com** (Greek mythology):
```bash
python3 web-scraper.py --source theoi \
  --url "https://www.theoi.com/Ouranios/Aither.html"
```

**Project Gutenberg** (classic texts):
```bash
# The Bible (book ID 10)
python3 web-scraper.py --source gutenberg --book-id "10"

# Multiple books (comma-separated)
python3 web-scraper.py --source gutenberg --book-id "10,2600,1342"

# Find more book IDs at: https://www.gutenberg.org/
```

### Scraping Emails for Contact Profiles

```bash
# Single URL
python3 email-scraper.py --urls https://example.com

# Multiple URLs
python3 email-scraper.py --urls https://site1.com https://site2.com

# From file (one URL per line)
echo "https://bitcointalk.org/index.php?topic=123" > email-urls.txt
echo "https://cryptoforums.com/members/vankush" >> email-urls.txt
python3 email-scraper.py --file email-urls.txt --max-depth 2

# Output: datasets/email_contacts.json
```

### Crypto News Updates

```bash
# Update with last 24 hours
python3 crypto-news-scraper.py --update-news --hours 24

# Update with last week
python3 crypto-news-scraper.py --update-news --hours 168

# Build unified timeline from all datasets
python3 crypto-news-scraper.py --build-timeline

# Outputs:
# - datasets/crypto_news_timeline.jsonl
# - datasets/crypto_news_summary.json
# - datasets/unified_timeline.jsonl
```

### Building Timelines

All datasets can be organized chronologically:

```bash
# Build unified timeline from ALL datasets
python3 crypto-news-scraper.py --build-timeline

# This creates: datasets/unified_timeline.jsonl
# Includes: crypto news, mythology, archives, emails - all sorted by date!
```

### Master Scraper (Run Everything)

```bash
# Run all scrapers
./master-scraper.sh --all

# Run specific scrapers
./master-scraper.sh --crypto-news --timeline
./master-scraper.sh --mythology --update-kb

# Start API server
./master-scraper.sh --serve
```

---

## 🤖 Discord Bot Integration

### Example: Query Knowledge Base from Discord

Add this to your Discord bot:

```javascript
// discord-bot-knowledge-base.js
const axios = require('axios');

const KNOWLEDGE_BASE_URL = 'http://localhost:8765';

async function queryKnowledgeBase(question) {
  try {
    const response = await axios.get(`${KNOWLEDGE_BASE_URL}/query`, {
      params: { q: question }
    });

    return response.data.response;
  } catch (error) {
    console.error('Knowledge base query failed:', error.message);
    return null;
  }
}

async function searchKnowledgeBase(query, category = null) {
  try {
    const params = { q: query, limit: 5 };
    if (category) params.category = category;

    const response = await axios.get(`${KNOWLEDGE_BASE_URL}/search`, { params });

    return response.data.results;
  } catch (error) {
    console.error('Knowledge base search failed:', error.message);
    return [];
  }
}

// Usage in Discord bot:
client.on('messageCreate', async (message) => {
  if (message.content.toLowerCase().includes('what is vkbt')) {
    const answer = await queryKnowledgeBase('VKBT token');

    if (answer) {
      message.reply(answer);
    } else {
      message.reply('Sorry, I couldn\'t find information about that.');
    }
  }

  if (message.content.startsWith('!search ')) {
    const query = message.content.substring(8);
    const results = await searchKnowledgeBase(query);

    if (results.length > 0) {
      let response = `Found ${results.length} results:\n\n`;
      results.forEach((result, i) => {
        response += `${i + 1}. **${result.title}** (${result.source})\n`;
        response += `   ${result.content.substring(0, 150)}...\n\n`;
      });
      message.reply(response);
    }
  }
});

module.exports = { queryKnowledgeBase, searchKnowledgeBase };
```

### Integration Steps:

1. **Start knowledge base API**:
   ```bash
   python3 knowledge-base.py --datasets-dir datasets --serve --port 8765
   ```

2. **Add to Discord bot**:
   ```javascript
   const { queryKnowledgeBase } = require('./discord-bot-knowledge-base');

   // When user asks about VKBT/CURE
   const info = await queryKnowledgeBase('VKBT');
   message.reply(info);
   ```

3. **Run with PM2** (keep API running 24/7):
   ```bash
   pm2 start knowledge-base.py --name kb-api -- --datasets-dir datasets --serve
   pm2 save
   ```

---

## 🔄 Automated Updates

### Cron Job for Daily Updates

Create a cron job to update crypto news daily:

```bash
# Edit crontab
crontab -e

# Add this line (update news every 6 hours)
0 */6 * * * cd /path/to/Bot && python3 crypto-news-scraper.py --update-news --hours 6 && python3 crypto-news-scraper.py --build-timeline

# Update knowledge base stats daily at midnight
0 0 * * * cd /path/to/Bot && python3 knowledge-base.py --datasets-dir datasets --stats > /tmp/kb-stats.log
```

### PM2 Automated Scraping

```bash
# Create scraping script
cat > auto-scrape.sh << 'EOF'
#!/bin/bash
while true; do
    python3 crypto-news-scraper.py --update-news --hours 6
    python3 crypto-news-scraper.py --build-timeline
    sleep 21600  # 6 hours
done
EOF

chmod +x auto-scrape.sh

# Run with PM2
pm2 start auto-scrape.sh --name crypto-news-updater
pm2 save
```

---

## 📊 Knowledge Base Statistics

```bash
# Get full statistics
python3 knowledge-base.py --datasets-dir datasets --stats

# Output example:
{
  "total_documents": 145,
  "total_keywords": 12847,
  "categories": {
    "vkbt-token": 5,
    "cure-token": 4,
    "crypto-news": 87,
    "mythology": 23,
    "claude-discussion": 12,
    "email-contacts": 14
  },
  "sources": {
    "van-kush-family": 17,
    "CoinDesk": 42,
    "CoinTelegraph": 31,
    "sacred-texts.com": 15,
    "gutenberg.org": 8
  }
}
```

---

## 🎓 Export for AI Fine-Tuning

Export knowledge base in format suitable for training custom AI models:

```bash
# Export all data
python3 knowledge-base.py --datasets-dir datasets --export fine_tuning_all.jsonl

# Export specific category
python3 knowledge-base.py --datasets-dir datasets \
  --export vkbt_training.jsonl --category vkbt-token

# Use this to fine-tune:
# - Llama models
# - Mistral models
# - GPT models
# - Discord bot personality
```

Format:
```jsonl
{"prompt": "Question about vkbt-token: What is VKBT Token", "completion": "VKBT (Van Kush Bot Token) is a cryptocurrency token on the HIVE-Engine blockchain..."}
{"prompt": "Question about cure-token: What is CURE Token", "completion": "CURE is an extremely scarce cryptocurrency token..."}
```

---

## 🔍 Search Examples

```bash
# Search for VKBT information
python3 knowledge-base.py --datasets-dir datasets --search "VKBT"

# Search with category filter
python3 knowledge-base.py --datasets-dir datasets \
  --search "trading" --category "vkbt-token"

# Search mythology
python3 knowledge-base.py --datasets-dir datasets \
  --search "Metatron" --category "angelology"

# Search crypto news
python3 knowledge-base.py --datasets-dir datasets \
  --search "Bitcoin" --category "crypto-news"
```

---

## 💡 Token Savings

### Before (dumping data into context):

**User**: "What is VKBT?"

**Claude**: *Reads 50,000 tokens of documentation dumped into context*

**Cost**: ~50,000 input tokens

### After (using knowledge base):

**User**: "What is VKBT?"

**Discord Bot**: *Queries knowledge base API*

**Response**: "VKBT (Van Kush Bot Token) is a cryptocurrency token on HIVE-Engine..."

**Cost**: ~500 tokens total (query + response)

**Savings: 99% reduction in token usage!**

---

## 🚀 Advanced Usage

### Custom Scrapers

Add your own scrapers to `web-scraper.py`:

```python
class CustomScraper(WebScraper):
    def scrape_custom_site(self, url):
        response = self.fetch_url(url)
        soup = BeautifulSoup(response.content, 'html.parser')

        # Your custom scraping logic
        content = soup.find('div', class='content')

        return {
            'source': 'custom-site',
            'url': url,
            'content': content.get_text(),
            'category': 'custom',
            'scraped_at': datetime.now().isoformat()
        }
```

### API Endpoints

When running `--serve`, these endpoints are available:

- **GET /search?q=query&category=cat&limit=10**
  - Search knowledge base
  - Returns JSON with results array

- **GET /query?q=question**
  - Bot-friendly query
  - Returns formatted response string

- **GET /categories**
  - List all categories
  - Returns JSON array

- **GET /stats**
  - Get statistics
  - Returns JSON with counts

---

## 📁 File Structure

```
Bot/
├── web-scraper.py              # Main web scraper
├── crypto-news-scraper.py      # Crypto news + timeline
├── email-scraper.py            # Email + contact profiling
├── knowledge-base.py           # Knowledge base + API
├── master-scraper.sh           # Orchestration script
├── scraping-targets.json       # Configuration
├── datasets/
│   ├── vkbt_cure_knowledge.jsonl
│   ├── crypto_news_timeline.jsonl
│   ├── email_contacts.json
│   ├── claude_archives_dataset.jsonl
│   ├── unified_timeline.jsonl
│   └── ... (other datasets)
└── KNOWLEDGE_BASE_GUIDE.md     # This file
```

---

## ✅ Next Steps

1. **Import Your Claude Discussions**:
   - Export PDFs from Claude chat
   - Run: `python3 web-scraper.py --source archive --file discussion.pdf --title "Topic"`

2. **Start Daily News Updates**:
   - Run: `./master-scraper.sh --crypto-news --timeline`
   - Set up cron job for automation

3. **Connect Discord Bot**:
   - Start API: `./master-scraper.sh --serve`
   - Add knowledge base queries to Discord bot

4. **Build Timeline**:
   - Run: `./master-scraper.sh --timeline`
   - View: `datasets/unified_timeline.jsonl`

5. **Monitor and Expand**:
   - Add more scraping targets to `scraping-targets.json`
   - Create custom scrapers for specific sites
   - Export for AI fine-tuning

---

**This system saves tokens, organizes information chronologically, and makes all bots smarter without context bloat!** 🚀
