# Architectural Decisions

## ADR-001: Use Gemini 2.5-flash-lite as Primary AI (2026-01-09)

**Context:**
- Need free AI API for Discord bot
- Budget is zero for API costs

**Decision:**
- Gemini 2.5-flash-lite as primary (1,000 req/day free)
- OpenRouter Llama 4 Maverick as backup (free tier)
- Wikipedia-first search strategy to reduce AI calls

**Alternatives Considered:**
- OpenAI GPT-4 -> Rejected: paid only
- Claude API -> Rejected: paid only
- Local LLM only -> Rejected: needs beefy server

**Consequences:**
- 1,000 req/day limit requires aggressive caching
- Wikipedia fallback reduces AI usage significantly
- Free tier sufficient for current scale

## ADR-002: JSON File Knowledge Base Over Database (2026-01-09)

**Context:**
- Need knowledge base for Discord bot and wiki generation
- Want simple, git-trackable, no-server-needed solution

**Decision:**
- JSON files in `knowledge/` directory organized by topic domain
- `_keyword_index.json` for search
- HTTP API via `knowledge-base.py` on port 8765

**Alternatives Considered:**
- PostgreSQL -> Rejected: adds hosting complexity
- ChromaDB -> Deferred to Phase 9 (Book Memory System)
- SQLite -> Rejected: harder to edit/review content

**Consequences:**
- Easy to edit and review in Git
- No database server needed
- Keyword search only (no semantic/vector search yet)
- Phase 9 will add ChromaDB for semantic search

## ADR-003: CommonJS for Trading Bots (2026-01-10)

**Context:**
- Trading bots need to run independently from Discord bot
- Some npm packages have CJS/ESM compatibility issues

**Decision:**
- Trading bots use `.cjs` extension (CommonJS)
- Discord bot uses ES modules (index.js with package.json type: module)

**Consequences:**
- Clear separation between bot types
- No import/require conflicts
- Both can run simultaneously on different processes

## ADR-004: Install Claude Code Skills for Project (2026-02-05)

**Context:**
- Project has complex multi-phase itinerary
- Knowledge base needs better tooling
- Content extraction needed for research phases

**Decision:**
- Install project-memory skill (persistent context across sessions)
- Install tapestry skills (content extraction + action planning)
- Skills live in `.claude/skills/` directory
- Create CLAUDE.md for project-level context

**Alternatives Considered:**
- obra/superpowers -> Deferred: install via plugin marketplace when available
- Custom skills only -> Rejected: community skills cover immediate needs
- No skills -> Rejected: losing too much context between sessions

**Consequences:**
- Better context persistence across Claude Code sessions
- Content extraction pipeline for knowledge base population
- YouTube transcript + article extraction available for research phases
