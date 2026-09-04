---
name: managing-knowledge
description: >
  Search, curate, import, and manage the Van Kush knowledge base (231 JSON
  files across 22 topic domains). Use when the user asks about knowledge base
  content, wants to add new knowledge, search for information, import a session,
  check knowledge base stats, or manage topic domains. Triggers on: "knowledge
  base", "add knowledge", "search knowledge", "curate", "import session",
  "what do we know about", "knowledge stats", "keyword index", file types
  .jsonl or .json in datasets context, or any question about the 22 topic
  domains (oilahuasca, phoenician, cryptocurrency, herbs, consciousness, etc.).
---

# Managing Knowledge

Search, import, and organize the Van Kush knowledge base system.

## Architecture

- **Knowledge files**: `knowledge/` - 22 domain folders, 231 JSON files
- **Keyword index**: `knowledge/_keyword_index.json` - neural-network-style topic discovery
- **Architecture map**: `knowledge/KNOWLEDGE_BASE_ARCHITECTURE.json` - domain connections
- **Datasets**: `datasets/` (gitignored) - imported JSONL/JSON files
- **API server**: `knowledge-base.py --serve` on port 8765

## Operations

### Searching Knowledge

**Option 1: CLI search** (when API not running)
```bash
python3 knowledge-base.py --search "headcones" --category phoenician
```

**Option 2: API search** (when API is running on port 8765)
```
GET http://localhost:8765/search?q=headcones&category=phoenician&limit=10
GET http://localhost:8765/query?q=what are Egyptian wax headcones
```

**Option 3: Direct file read** (for specific topics)
1. Check `knowledge/_keyword_index.json` for keyword-to-folder mapping
2. Read the relevant JSON file from `knowledge/{domain}/`

**Topic discovery**: The `_keyword_index.json` has `folder_keywords` with `primary`, `secondary`, and `connects_to` arrays for each domain. Use these to find related topics across domains.

### Importing Content

**Import a Claude Code session:**
```bash
python3 curate-knowledge.py --file session.txt --title "Session Title" --category trading-bot --preview
```

**Import for Discord bot:**
```bash
python3 curate-knowledge.py --file content.txt --title "Title" --for-discord --preview
```

**Auto-sanitization**: The curate script automatically strips HIVE private keys (5Jxxx...), API keys, and sensitive patterns before saving. Always use `--preview` first to verify.

**Categories for `--category`**: trading-bot, knowledge-base, discord-bot, project-planning, or auto-detected from content keywords.

### Checking Stats

```bash
python3 knowledge-base.py --stats
python3 knowledge-base.py --categories
```

Or via API: `GET http://localhost:8765/stats`

### Starting the API Server

```bash
python3 knowledge-base.py --serve --port 8765
```

For persistent operation: `pm2 start knowledge-base.py --name knowledge-api --interpreter python3 -- --serve`

### Adding New Knowledge Files

1. Determine the correct domain folder from `references/domain-catalog.md`
2. Create a JSON file following existing naming conventions in that folder
3. The keyword index does NOT auto-update - rebuild it if adding new primary topics

### Cross-Domain Discovery

The knowledge base is designed as a neural network where "there are no 2 subjects - everything connects." Use the `connects_to` arrays in `_keyword_index.json` to traverse related domains.

Example: "headcones" -> phoenician -> connects_to: [ancient_egypt, herbs, oilahuasca, consciousness, soapmaking, mystery_schools, shulgin-pihkal-tihkal]

See `references/domain-catalog.md` for all 22 domains with descriptions and connection maps.

## Bot's Favorite Subject

The knowledge base has a designated favorite: **Egyptian Wax Headcones** (`phoenician/wax_headcone_complete_research.json`). The `_keyword_index.json` has a `bot_favorite` field pointing to this.

## Rules

1. **Always preview** before importing (`--preview` flag)
2. **Never commit datasets/** - it's gitignored for security
3. **Sanitization is automatic** but verify sensitive content was caught
4. **Respect the domain structure** - don't dump files in the wrong folder
5. **The keyword index is static** - it was built manually, not auto-generated
