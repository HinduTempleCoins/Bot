---
name: populating-wiki
description: >
  Generate and publish wiki articles from the knowledge base to MediaWiki
  using Pywikibot + Ollama or Gemini. Use when the user wants to generate
  wiki articles, publish to the wiki, check wiki status, populate a domain,
  or work with the Library of Ashurbanipal bot. Triggers on: "wiki",
  "generate article", "populate wiki", "publish to wiki", "Library of
  Ashurbanipal", "MediaWiki", "Pywikibot", "wiki article", "stub entries".
---

# Populating Wiki

Generate and publish wiki articles from the Van Kush knowledge base to MediaWiki.

## Two Generation Systems

### 1. Python Pipeline (Pywikibot + Ollama)

**Path**: `wiki-populator/populate_wiki.py`
**AI**: Ollama mistral:7b at `http://127.0.0.1:11434/api/chat`
**Wiki**: `http://5.252.53.79/wiki` via Pywikibot (user: `LibraryBot`)

```bash
# Dry run - generate without publishing
python3 wiki-populator/populate_wiki.py --dry-run

# Process a single domain
python3 wiki-populator/populate_wiki.py --domain=oilahuasca --dry-run

# Limit number of articles
python3 wiki-populator/populate_wiki.py --limit=5 --dry-run

# Live publish (removes --dry-run)
python3 wiki-populator/populate_wiki.py --domain=oilahuasca
```

**Requires**: Ollama running locally, Pywikibot credentials at `wiki-populator/user-password.py`

### 2. Node.js Pipeline (Gemini)

**Path**: `library-of-ashurbanipal-bot/`
**AI**: Google Gemini 2.0-flash-lite
**Wiki**: Same MediaWiki instance via API

```bash
cd library-of-ashurbanipal-bot
npm run generate:dry          # Dry run
npm run generate:limit        # First 3 articles only
npm run generate              # All articles, live publish
npm run watch                 # Watch for knowledge base changes
```

**Requires**: `GEMINI_API_KEY` in `.env`, wiki bot credentials in `.env`

## Workflow

### Step 1: Choose Domain

**Domain priority order** (hardcoded in Python pipeline):
```
oilahuasca > phoenician > shulgin-pihkal-tihkal > ayahuasca >
psychedelics > herbs > consciousness > ancient_egypt > vankush >
history > mystery_schools > spirituality > soapmaking > cryptocurrency
```

**Article priority tiers** (Node.js pipeline):
- Tier 1 (Core): Oilahuasca, Space Paste, Allylbenzene Metabolism
- Tier 2 (Primary): Egyptian Wax Headcones, Kyphi, Shulgin Ten Essential Oils, PIHKAL, TIHKAL
- Tier 3: Phoenician Consciousness Technology, Pharmahuasca, CYP450, VKFRI
- Tier 4: Wadjet Institution, Zar Thread, Temple Economics

### Step 2: Always Dry Run First

Never publish without previewing. Use `--dry-run` (Python) or `npm run generate:dry` (Node.js).

### Step 3: Review Generated Content

- Check MediaWiki markup is valid
- Verify facts against source JSON files
- Ensure cross-links between related articles use `[[wiki links]]`
- Confirm categories are applied

### Step 4: Publish

Remove `--dry-run` flag. Rate limiting is built in (5s delays between articles for Gemini free tier).

### Step 5: Create Stub Entries

After publishing main articles, the system should auto-create stubs for any `[[linked terms]]` that don't have articles yet.

## Which Pipeline to Use

| Scenario | Use |
|----------|-----|
| Ollama is running locally | Python pipeline (free, unlimited) |
| No local GPU / cloud only | Node.js pipeline (Gemini, 1000 req/day) |
| Bulk generation (100+ articles) | Python pipeline (no rate limits) |
| Higher quality / smaller batches | Node.js pipeline (Gemini quality) |
| Watch mode (auto-regenerate on changes) | Node.js pipeline (`npm run watch`) |

## Configuration

**Python pipeline config**: `wiki-populator/user-config.py`
**Node.js env vars**: See `library-of-ashurbanipal-bot/.env.example`
**Wiki family definition**: `wiki-populator/families/ashurbanipal_family.py`

## Rules

1. **Always dry-run first** before publishing any articles
2. **One domain at a time** to review quality before moving on
3. **Check for existing articles** before publishing to avoid overwrites
4. **Rate limit compliance**: Gemini = 15 req/min, Ollama = unlimited
5. **Source attribution**: Generated articles should cite the source JSON files
