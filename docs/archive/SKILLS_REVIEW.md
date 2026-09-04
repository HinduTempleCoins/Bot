# Skills & Multi-Agent Review - Van Kush Bot Ecosystem

**Date**: 2026-02-05
**Purpose**: Evaluate Claude Code skills ecosystem and determine what we should build
**Sources Reviewed**: 9 GitHub repos, 1 Reddit thread, 1 tutorial article, web research

---

## TL;DR - Should We Make Skills?

**Yes, absolutely.** We should build 4-5 custom Claude Code skills that directly map to our workflow. The skills ecosystem is mature enough to be useful, and our project is complex enough to benefit significantly. Here's why and what.

---

## PART 1: What We Found Across All Sources

### Source Summary

| Source | Type | Key Takeaway |
|--------|------|-------------|
| [Orchestra-Research/AI-research-SKILLs](https://github.com/Orchestra-Research/AI-research-SKILLs) | 82 AI research skills | Best skill format reference; Chroma + RAG patterns directly applicable to our knowledge base |
| [anthropics/skills](https://github.com/anthropics/skills) | 16 official Anthropic skills | **The canonical skill format** - YAML frontmatter, progressive disclosure, <500 line SKILL.md |
| [letta-ai/skills](https://github.com/letta-ai/skills) | 16 agent/tool skills | Three-tier memory model (core/archival/conversation) maps to our relationship tracker / knowledge base / chat history |
| [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) | Curated list (6.6k stars) | `loki-mode` (multi-agent orchestration), `obra/superpowers` (TDD, debugging, root-cause-tracing) |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | Largest list (30.7k stars) | `tapestry` (knowledge interlinking), `outline` (wiki management), `n8n-skills`, `deep-research` |
| [BehiSecc/awesome-claude-skills](https://github.com/BehiSecc/awesome-claude-skills) | Best organized (80+ skills) | `plannotator` (interactive plan review), `linear-claude-skill` (project tracking) |
| [metaskills/skill-builder](https://github.com/metaskills/skill-builder) | Meta-skill builder | 5-step methodology for creating skills; gerund naming convention; description-driven invocation |
| [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) | 48 production skills | Confluence/Jira expert patterns applicable to our wiki + itinerary systems |
| [Spillwave tutorial](https://pub.spillwave.com/build-your-first-claude-code-skill-a-simple-project-memory-system-that-saves-hours-1d13f21aff9e) | How-to guide | Project Memory skill pattern - stores architectural decisions and context across sessions |

### The Official Skill Format (from Anthropic)

```
skill-name/
  SKILL.md           # REQUIRED - YAML frontmatter + instructions (<500 lines)
  scripts/           # Optional - executable code
  references/        # Optional - detailed docs loaded on demand
  assets/            # Optional - templates, data files
```

**SKILL.md structure:**
```yaml
---
name: skill-name          # lowercase + hyphens, gerund form
description: >            # CRITICAL - this triggers automatic invocation
  What it does AND when to use it. Include trigger keywords.
---

# Instructions (markdown body)
Progressive disclosure: overview here, details in references/
```

**Three-layer loading:**
1. **Metadata** (~100 tokens) - always in context for routing
2. **SKILL.md body** (<5000 tokens) - loaded when skill triggers
3. **References/** (unlimited) - loaded only when actively needed

---

## PART 2: Mapping Skills to Our Itinerary Phases

### Phase-by-Phase Skill Applicability

| Our Phase | Status | Applicable Skills/Patterns | Impact |
|-----------|--------|---------------------------|--------|
| **Phase 1: Discord Bot** | 95% Complete | `obra/superpowers` (TDD for testing remaining 5%) | Low - mostly done |
| **Phase 2: Token Optimization** | In Progress | `ship-learn-next` (iterative improvement tracking) | Medium |
| **Phase 5.5: Knowledge Base** | Complete | **`tapestry`** (auto-interlink knowledge), **Chroma + Sentence Transformers** (semantic search to replace keyword index) | **HIGH** |
| **Phase 6: Social Media** | Pending | **`n8n-skills`** (already on our roadmap), `slack` skill pattern for Discord/Telegram | **HIGH** |
| **Phase 7: AI Angel** | Future | `canvas-design`, `algorithmic-art` patterns from Anthropic skills | Medium |
| **Phase 8: Email/Web Scrapers** | Pending | `article-extractor`, `deep-research` (autonomous Gemini research) | **HIGH** |
| **Phase 8: SoapBox Wiki** | Pending | **`outline`** (wiki management), `doc-coauthoring` (3-stage writing workflow) | **HIGH** |
| **Phase 9: Book Memory** | Pending | **Chroma skill from Orchestra** (exact same architecture we planned - ChromaDB + embeddings) | **HIGH** |
| **Phase 12: Minecraft/Games** | Future | Multi-agent patterns from ChatDev/MetaGPT | Medium |

### What We Already Have That Maps to Skill Patterns

| Our Existing System | Skill Pattern Equivalent | Gap |
|---------------------|--------------------------|-----|
| `user-relationships.json` + relationship-tracker.js | Letta's "core memory" tier | No gap - already implemented |
| `knowledge/` (231 JSON files, 22 domains) | Letta's "archival memory" tier | **Gap: keyword search only, no semantic/vector search** |
| Message history in Discord | Letta's "conversation memory" tier | No gap |
| `_keyword_index.json` (533 keywords) | RAG retrieval layer | **Gap: should be Chroma/FAISS vector embeddings** |
| `KNOWLEDGE_BASE_ARCHITECTURE.json` graph | `tapestry` knowledge interlinking | Partial - we have `connects_to` arrays but no auto-discovery |
| `ITINERARY.md` + `MASTER_ITINERARY.md` | `plannotator` / `ship-learn-next` | **Gap: manual markdown editing, no structured tracking** |
| `wiki-populator/` + Pywikibot | `outline` wiki skill | Partial - works but not skill-wrapped |
| `curate-knowledge.py` | Project Memory skill | Partial - curates but doesn't auto-persist across sessions |

---

## PART 3: Recommended Skills to Build

### Skill 1: `managing-knowledge` (HIGHEST PRIORITY)

**Why**: Our knowledge base is the backbone of everything - Discord bot, wiki populator, future AI training. Currently using flat keyword search across 231 JSON files. This skill would orchestrate knowledge operations.

**What it does**:
- Wraps `knowledge-base.py`, `curate-knowledge.py`, and the knowledge API
- Adds semantic search via Chroma (replaces `_keyword_index.json`)
- Auto-categorizes new content into the 22 domain folders
- Triggers on: "knowledge base", "add knowledge", "search knowledge", "curate"

**Maps to Itinerary**: Phase 5.5 (Knowledge Base), Phase 9 (Book Memory), Phase 8 (SoapBox Wiki)

**Structure**:
```
managing-knowledge/
  SKILL.md
  references/
    knowledge-architecture.md    # From KNOWLEDGE_BASE_ARCHITECTURE.json
    domain-catalog.md            # 22 domains with descriptions
  scripts/
    search-knowledge.js          # Wraps the port 8765 API
    ingest-content.js            # Smart ingestion pipeline
```

### Skill 2: `populating-wiki` (HIGH PRIORITY)

**Why**: Wiki population is a multi-step pipeline (JSON -> extract -> synthesize -> MediaWiki markup -> Pywikibot push). Currently requires manual orchestration. A skill wraps this into an automatic workflow.

**What it does**:
- Reads from `knowledge/` folders
- Synthesizes wiki articles via Gemini/Ollama
- Pushes to MediaWiki via Pywikibot
- Auto-creates stub entries for linked terms
- Follows the `doc-coauthoring` 3-stage pattern: gather context -> refine -> verify

**Maps to Itinerary**: Phase 8 (SoapBox Wiki Population)

**Structure**:
```
populating-wiki/
  SKILL.md
  references/
    wiki-article-templates.md    # Templates per article type
    topic-priority-tiers.md      # From existing tier system
  scripts/
    generate-article.js          # Article synthesis
    push-to-wiki.py              # Pywikibot wrapper
```

### Skill 3: `tracking-itinerary` (HIGH PRIORITY)

**Why**: Our itineraries are 900+ line markdown files that require manual editing. A skill could read, update, prioritize, and report on itinerary status automatically.

**What it does**:
- Reads `ITINERARY.md` and `MASTER_ITINERARY.md`
- Updates phase/task status
- Generates progress reports
- Suggests next priorities based on dependencies (Critical Path from Master Itinerary)
- Triggers on: "itinerary", "what's next", "update status", "progress report"

**Maps to Itinerary**: All phases (meta-skill for tracking everything)

**Structure**:
```
tracking-itinerary/
  SKILL.md
  references/
    phase-dependencies.md        # Critical path from MASTER_ITINERARY
    completion-criteria.md       # Success metrics per phase
```

### Skill 4: `researching-topics` (MEDIUM PRIORITY)

**Why**: We constantly need to research new topics for the knowledge base (Sacred-Texts, Theoi, crypto news, academic papers). A skill wrapping `deep-research` + `article-extractor` patterns would automate this.

**What it does**:
- Autonomous multi-step web research
- Extracts article text and metadata
- Formats for knowledge base ingestion
- Respects robots.txt and rate limits
- Triggers on: "research [topic]", "scrape", "find information about"

**Maps to Itinerary**: Phase 2 (Email/Data), Phase 8 (Web Scrapers)

### Skill 5: `orchestrating-agents` (FUTURE - when multi-agent needed)

**Why**: We already run multiple concurrent processes (trading bot, knowledge API, Discord bot, wiki populator, price pusher). As we add Telegram, Slack, n8n workflows, this needs coordination.

**What it does**:
- Monitors process health across all bots
- Coordinates shared resources (API rate limits, database access)
- Routes tasks to appropriate agent/bot
- Based on `loki-mode` and `fleet-management` patterns

**Maps to Itinerary**: Phase 6 (Social Media), Phase 7+ (multi-platform)

---

## PART 4: Existing Skills We Should Install As-Is

These are community skills worth installing directly without building custom versions:

| Skill | Source | Why |
|-------|--------|-----|
| **obra/superpowers** | travisvn list | TDD, systematic debugging, root-cause tracing - critical for live trading bot |
| **tapestry** | ComposioHQ list | Auto-interlinks documents into knowledge networks - exactly what our knowledge graph needs |
| **n8n-skills** | ComposioHQ list | Already on our Phase 6 roadmap for social media automation |
| **Project Memory** (Spillwave) | spillwave.com | Persists architectural decisions across Claude Code sessions - saves massive tokens |
| **skill-creator** | Anthropic official | Meta-skill for building our custom skills properly |

---

## PART 5: Semantic Search Upgrade Path

**Current state**: `_keyword_index.json` with 533 keywords, flat text matching
**Target state**: ChromaDB with Gemini embeddings, semantic vector search

This is the single highest-impact technical improvement. It enables:
- Natural language queries across all 231 knowledge files ("what connects Egyptian headcones to soapmaking?")
- The Book Memory System (Phase 9) which already planned this exact architecture
- Better Discord bot responses (semantic relevance vs keyword matching)
- Auto-discovery of cross-topic connections (what `tapestry` does)

**Implementation matches Phase 9 exactly** - the `BookMemory` class in `MASTER_ITINERARY.md:429-464` already describes the ChromaDB + Gemini embedding architecture. Building the `managing-knowledge` skill with Chroma would simultaneously complete Phase 9.

---

## PART 6: The AI Town / Company Simulator Question

### What You're Remembering: **ChatDev**

**ChatDev** by OpenBMB is the project. It matches all your criteria:

1. **Pokemon Gameboy town visual**: ChatDev 1.0 featured a top-down pixel-art town where sprite characters representing each role walked around and collaborated visually - the iconic retro aesthetic.

2. **Programming company with departments**: Agents play CEO, CTO, Programmer, Reviewer, Tester, Art Designer. Work passes through a waterfall of designing -> coding -> testing -> documenting phases.

3. **You give it a coding project**: One-line natural language description in, working code out. Known for generating small playable games.

4. **Only good for simple things**: Correct - it excelled at self-contained apps and simple games but struggled with complex systems.

- GitHub: [github.com/OpenBMB/ChatDev](https://github.com/OpenBMB/ChatDev)
- **ChatDev 2.0** (Jan 2026) now has a Vue3 drag-and-drop visual console

### Related Projects

| Project | What It Is | Visual? |
|---------|-----------|---------|
| **Stanford Generative Agents / Smallville** | 25 AI characters in a 16-bit pixel town (social simulation, not coding) | Yes - the most iconic Pokemon-style visual |
| **MetaGPT** | AI software company (product manager -> architect -> engineer) | No - CLI/framework only |
| **AgentVerse** (same team as ChatDev) | Multi-agent simulation with Pokemon-style H5 game demo | Yes |
| **AI Town** (a16z) | MIT-licensed starter kit for AI character towns | Yes |

### Building Our Own Multi-Agent Visual System

The current landscape for building this as a product:

| Framework | Visual Interface | Best For |
|-----------|-----------------|----------|
| **ChatDev 2.0** | Vue3 drag-and-drop canvas | Zero-code agent orchestration |
| **CrewAI** | Visual editor + AI copilot | Enterprise multi-agent teams |
| **MetaGPT** | CLI-based | Code-centric dev workflows |
| **OpenAI AgentKit** | Visual builder + connectors | First-party OpenAI agents |

**Key protocols enabling interoperability**:
- **MCP** (Anthropic) - standardizes how agents access tools
- **A2A** (Google) - peer-to-peer agent collaboration
- **ACP** (IBM) - enterprise governance

**Market projection**: $7.84B (2025) -> $52.62B by 2030 at 46.3% CAGR

**Recommendation for our project**: Start with CrewAI or ChatDev 2.0 patterns for coordinating our existing bots (trading, Discord, wiki, knowledge). When ready to productize, build a custom visual frontend using the pixel-art aesthetic (which is proven to capture attention) with MCP + A2A for agent communication. This maps to Phase 12 and could integrate with the Minecraft server vision.

---

## PART 7: Action Items

### Immediate (This Sprint)
1. Install `skill-creator` from Anthropic's official repo
2. Install `Project Memory` from Spillwave (token savings)
3. Build `tracking-itinerary` skill (wraps our markdown itineraries)
4. Build `managing-knowledge` skill (wraps knowledge base + adds Chroma)

### Next Sprint
5. Build `populating-wiki` skill (wraps wiki-populator pipeline)
6. Install `tapestry` for knowledge auto-interlinking
7. Install `obra/superpowers` for debugging live trading bot
8. Install `n8n-skills` for Phase 6 social media automation

### Future
9. Build `researching-topics` skill
10. Build `orchestrating-agents` skill when multi-bot coordination needed
11. Evaluate ChatDev 2.0 / CrewAI for visual multi-agent product

---

## PART 8: Key Patterns to Adopt

### 1. Progressive Disclosure Architecture (PDA)
Load skill content in layers: metadata always -> instructions when triggered -> references on demand. Our 50+ root-level markdown files should be restructured this way.

### 2. Description-Driven Invocation
Skill descriptions determine when Claude automatically invokes them. Write "Use when..." framing with trigger keywords, not just "This skill does X."

### 3. Append-Only Concurrency Safety
Our `user-relationships.json` does full `writeFile` every 5 minutes. In high-traffic scenarios, an event-log pattern (append events, reconstruct on startup) would be safer.

### 4. Three-Tier Memory Model
- **Core**: `userRelationships` (always in context)
- **Archival**: `knowledge/` folders (loaded on demand)
- **Conversation**: Discord message history (ephemeral)

We already implement this pattern implicitly - formalizing it makes it more robust.

### 5. The SKILL.md Format for Our Own Docs
Apply the YAML frontmatter + structured sections + 500-line limit to our operational docs. Makes them both human-readable AND parseable by our bot.

---

*"There are no 2 subjects. Everything connects." - and skills are how we teach Claude to see those connections automatically.*
