# Van Kush Family Bot Ecosystem

## Project Overview

Multi-layered AI bot ecosystem: Discord bot, HIVE-Engine trading bots, knowledge base (231 JSON files, 22 domains), wiki populator (Pywikibot + Ollama/Gemini), and SoapBox.Community infrastructure.

**Tech Stack**: Node.js, Discord.js v14, Gemini 2.5-flash-lite, OpenRouter (Llama 4 Maverick), Ollama (mistral:7b), Python 3, HIVE blockchain (@hiveio/dhive)

**Key Files**:
- `index.js` - Main Discord bot (large file, ~860KB)
- `hive-trading-bot.cjs` - Automated HIVE-Engine trading
- `dialogue-flows.js` - NPC conversation system
- `relationship-tracker.js` - Emotional relationship tracking
- `knowledge/` - 231 JSON files across 22 topic domains
- `wiki-populator/` - Pywikibot wiki population pipeline
- `library-of-ashurbanipal-bot/` - Wiki article generation (Node.js)

**Itineraries**:
- `MASTER_ITINERARY.md` - 12-phase roadmap with technical specs
- `ITINERARY.md` - Practical implementation schedule and progress

## APIs (All Free Tier)

- Gemini 2.5-flash-lite: 1,000 req/day, 15 RPM
- OpenRouter: Free Llama 4 Maverick
- Pollinations.ai: Unlimited image generation
- HIVE-Engine API: Unlimited
- Wikipedia API: Unlimited

## Project Memory System

This project maintains institutional knowledge in `docs/project_notes/` for consistency across sessions.

### Memory Files

- **bugs.md** - Bug log with dates, solutions, and prevention notes
- **decisions.md** - Architectural Decision Records (ADRs) with context and trade-offs
- **key_facts.md** - Project configuration, ports, important URLs
- **issues.md** - Work log with descriptions and status

### Memory-Aware Protocols

**Before proposing architectural changes:**
- Check `docs/project_notes/decisions.md` for existing decisions
- Verify the proposed approach doesn't conflict with past choices

**When encountering errors or bugs:**
- Search `docs/project_notes/bugs.md` for similar issues
- Apply known solutions if found
- Document new bugs and solutions when resolved

**When looking up project configuration:**
- Check `docs/project_notes/key_facts.md` for ports, URLs, service accounts

**When completing work:**
- Log completed work in `docs/project_notes/issues.md`

## Development Notes

- Trading bots use `.cjs` extension (CommonJS)
- Knowledge base uses JSON files with `_keyword_index.json` for search
- Environment variables in `.env` (see `.env.example`)
- Deployed on Railway (Discord bot) and Google VM (trading bots)
- All datasets in `datasets/` directory (gitignored)
