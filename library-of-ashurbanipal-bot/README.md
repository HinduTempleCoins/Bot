# Library of Ashurbanipal - Wiki Generator Bot

Synthesizes wiki articles from the Van Kush Family Research Institute knowledge base.

Named for the ancient Nineveh library where fire baked and preserved the clay tablets.

## How It Works

1. Reads all documents from `/knowledge` folder
2. **Synthesizes** (not copy/paste) information across multiple documents
3. Generates MediaWiki articles starting with core topics
4. Publishes to MediaWiki at http://5.252.53.79/wiki

## Knowledge Flow

```
OILAHUASCA/SPACE PASTE (root)
    ↓
HEADCONES / SHULGIN / AYAHUASCA (primary)
    ↓
HERBS / PSYCHEDELICS / CONSCIOUSNESS (secondary)
    ↓
HISTORY / MYSTERY SCHOOLS / SPIRITUALITY (extended)
```

## Setup

```bash
cd library-of-ashurbanipal-bot
npm install
cp .env.example .env
# Edit .env with your Gemini API key and wiki credentials
```

## Usage

```bash
# Dry run - generate articles but don't publish
npm run generate:dry

# Generate first 3 articles (Oilahuasca, Space Paste, Allylbenzene)
npm run generate:limit

# Generate all articles
npm run generate

# Watch mode - regenerate when knowledge base changes
npm run watch
```

## Article Priority

The bot generates articles in this order:

**Tier 1 (Core):**
- Oilahuasca
- Space Paste
- Allylbenzene Metabolism

**Tier 2 (Primary):**
- Egyptian Wax Headcones
- Kyphi
- Shulgin Ten Essential Oils
- PIHKAL Compounds
- TIHKAL Compounds

**Tier 3+:** Supporting and extended topics

## Adding New Content

When you add new files to the knowledge base (like TIHKAL entries):
1. The bot detects new files in watch mode
2. Identifies which articles need updating
3. Regenerates affected articles with new information

## Deployment (VPS)

```bash
# Install pm2
npm install -g pm2

# Start the bot
pm2 start ecosystem.config.cjs

# View logs
pm2 logs wiki-generator
```
