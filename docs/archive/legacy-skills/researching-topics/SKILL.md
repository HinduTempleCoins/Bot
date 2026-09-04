---
name: researching-topics
description: >
  Research topics using web scrapers, news feeds, email analysis, and Claude
  discussion imports. Use when the user wants to scrape websites for content,
  fetch crypto news, import email data, build timelines, or add research
  material to the knowledge base. Triggers on: "research", "scrape",
  "find information about", "sacred texts", "crypto news", "import emails",
  "build timeline", "Gutenberg", "Theoi", "news feed", "web scraper",
  "master scraper", "import discussions".
---

# Researching Topics

Scrape, fetch, and import research content into the knowledge base.

## Available Scrapers

### 1. Web Scraper (mythology, ancient texts)

```bash
# Scrape Project Gutenberg book by ID
python3 web-scraper.py --source gutenberg --book-id "10" --output datasets

# Scrape multiple books
python3 web-scraper.py --source gutenberg --book-id "10,20,30" --output datasets

# Scrape Sacred-Texts.com section
python3 web-scraper.py --source sacred-texts --url "/egy/" --title "Egyptian Texts"

# Scrape Theoi.com (Greek mythology)
python3 web-scraper.py --source theoi --url "/Olympios/" --title "Olympian Gods"

# Scrape Archive.org
python3 web-scraper.py --source archive --url "https://archive.org/..." --max-pages 50
```

**Arguments**: `--source` (sacred-texts|gutenberg|theoi|archive), `--url`, `--book-id`, `--title`, `--max-pages` (default 100), `--output` (default datasets), `--rate-limit` (default 2.0s)

### 2. Crypto News Scraper (RSS feeds)

```bash
# Fetch last 48 hours of crypto news
python3 crypto-news-scraper.py --update-news --hours 48 --output datasets

# Build unified timeline from all news
python3 crypto-news-scraper.py --build-timeline --output datasets

# Both at once
python3 crypto-news-scraper.py --update-news --hours 48 --build-timeline
```

**Sources**: CoinDesk, CoinTelegraph, The Block, Decrypt (via RSS)
**Output**: `datasets/crypto-news-*.json`, `datasets/crypto-timeline.json`

### 3. Claude Discussion Importer

```bash
# Import exported conversations from a directory
python3 claude-discussion-scraper.py --import-dir ./exports --output datasets

# Import single PDF/TXT file
python3 claude-discussion-scraper.py --file conversation.pdf --output datasets

# Watch folder for new exports (auto-import)
python3 claude-discussion-scraper.py --watch ./exports --output datasets
```

### 4. Email Scraper (contact extraction)

```bash
# Scrape emails from URL list
python3 email-scraper.py --file email-urls.txt --max-depth 1 --output datasets

# Scrape single URL
python3 email-scraper.py --url "https://example.com" --max-depth 2 --output datasets

# Search entire domain
python3 email-scraper.py --domain "example.com" --max-pages 20 --output datasets
```

### 5. Master Orchestrator

```bash
# Run ALL scrapers
./master-scraper.sh --all

# Run specific groups
./master-scraper.sh --mythology          # Sacred-Texts, Gutenberg, Theoi
./master-scraper.sh --crypto-news        # RSS feeds
./master-scraper.sh --emails             # From email-urls.txt
./master-scraper.sh --timeline           # Build unified timeline
./master-scraper.sh --update-kb          # Refresh knowledge base stats
./master-scraper.sh --serve              # Start KB API on port 8765
```

## Decision Tree: Which Scraper?

| Content Type | Scraper | Source |
|-------------|---------|--------|
| Ancient/religious texts | `web-scraper.py --source sacred-texts` | Sacred-Texts.com |
| Classic literature | `web-scraper.py --source gutenberg` | Project Gutenberg |
| Greek mythology | `web-scraper.py --source theoi` | Theoi.com |
| Archived pages | `web-scraper.py --source archive` | Archive.org |
| Crypto market news | `crypto-news-scraper.py` | RSS feeds |
| Claude conversations | `claude-discussion-scraper.py` | PDF/TXT exports |
| Email contacts | `email-scraper.py` | Websites |
| Everything at once | `./master-scraper.sh --all` | All sources |

## After Scraping: Import to Knowledge Base

Scraped content lands in `datasets/`. To integrate into the knowledge base:

```bash
# Check what was scraped
python3 knowledge-base.py --stats --datasets-dir datasets

# Import specific content with sanitization
python3 curate-knowledge.py --file datasets/sacred-texts-*.jsonl --title "Egyptian Mythology" --category ancient_egypt --preview
```

## Rules

1. **Respect robots.txt** - all scrapers check compliance
2. **Rate limiting** - default 2 seconds between requests, never reduce below 1
3. **Preview before importing** - scraped content goes to `datasets/` first, then curate into `knowledge/`
4. **Attribution** - record source URLs in output metadata
5. **Legal** - only scrape public domain or openly licensed content
6. **Budget** - `datasets/` is gitignored; don't accidentally commit large scraped files
