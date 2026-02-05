# Phase Map - Van Kush Bot Ecosystem

12-phase roadmap with dependencies. Use this to determine where new tasks belong and what's "next."

## Phase Overview

| Phase | Name | Status | Depends On | Key Deliverable |
|-------|------|--------|------------|-----------------|
| 1 | Discord Bot | COMPLETE | None | Bot live on Railway |
| 2 | Token Optimization & Testing | IN PROGRESS | Phase 1 | AI backups, caching, testing |
| 3 | Burn Mining Research & Debugging | PENDING | Phase 1 | Fixed Polygon contracts |
| 4 | Token Launches (PUCO, PUTI, DFB, DFC) | PENDING | Phase 3 | Tokens on TRON, Steem-Engine, Polygon |
| 5 | KulaSwap AMM Deployment | PENDING | Phase 4 | DEX on TRON |
| 5 (alt) | HIVE Trading System | COMPLETE | Phase 1 | Trading bots on Google VM |
| 5.5 | Knowledge Base System | COMPLETE | Phase 1 | API on port 8765, 231 JSON files |
| 6 | Social Media Automation | PENDING | Phase 1 | n8n, Telegram, cross-posting |
| 7 | AI Angel Character | PENDING | Phase 6 | ComfyUI, character design, March 2026 |
| 8 | Email & Web Scrapers | PENDING | Phase 5.5 | Datasets, scraped content |
| 8 (alt) | SoapBox.Community Wiki | PENDING | Phase 5.5 | MediaWiki + Pywikibot pipeline |
| 9 | Book Memory System | PENDING | Phase 5.5 | ChromaDB + Gemini embeddings |
| 10 | Smart Media Tokens (SMT) | PENDING | Phase 4 | SCOT Bot, tag distribution |
| 11 | Mining & Blockchain Projects | PENDING | Phase 10 | ForkNote, VKAI chain |
| 12 | Advanced Integrations | PENDING | Phase 7+ | Minecraft, Splinterlands, ComfyUI |

## Critical Path (Must Happen In Order)

From MASTER_ITINERARY.md:

1. Discord Bot Core Features (DONE)
2. Railway Deployment Confirmed
3. AI Backup Systems Set Up
4. Burn Mining Contracts Fixed
5. Token Launches (PUCO, PUTI, DFB, DFC)
6. KulaSwap AMM Deployed
7. Social Media Bots Live
8. Email/Web Scrapers Operational
9. Book Memory System Functional
10. SMT Frontends Launched

**Parallel tracks** (can happen alongside critical path):
- HIVE Trading System (Phase 5 alt) - COMPLETE
- Knowledge Base (Phase 5.5) - COMPLETE
- SoapBox Wiki (Phase 8 alt) - needs Contabo VPS
- Skills development - ongoing

## Task Categorization Guide

When a new task needs to be added, use this to decide which phase:

**Discord bot features, commands, dialogue trees** -> Phase 1 or Phase 2
**Trading bot fixes, buy/sell logic, market analysis** -> Phase 5 (HIVE Trading)
**Knowledge base, JSON files, search, curating** -> Phase 5.5
**Polygon contracts, burn mining, DFB/DFC** -> Phase 3
**New token launches, tokenomics** -> Phase 4
**KulaSwap, AMM, DEX** -> Phase 5 (KulaSwap)
**Telegram, Slack, n8n, cross-posting** -> Phase 6
**AI Angel, ComfyUI, character art** -> Phase 7
**Email scraping, web scraping, datasets** -> Phase 8
**Wiki, MediaWiki, Pywikibot, SoapBox** -> Phase 8 (SoapBox)
**ChromaDB, embeddings, book ingestion** -> Phase 9
**SCOT Bot, SMT, tag distribution** -> Phase 10
**ForkNote, CryptoNote, mining pools** -> Phase 11
**Minecraft, games, advanced integrations** -> Phase 12
**Doesn't fit any phase** -> QUICK WINS section in ITINERARY.md

## Status Markers

In ITINERARY.md:
- `[x]` or `✅` = Complete
- `[ ]` = Pending / Not started
- `⏳` = In progress / waiting
- `🔨` = Actively being built

In MASTER_ITINERARY.md:
- `✅ PHASE X: NAME (COMPLETED)` = Done
- `🎯 PHASE X: NAME (IN PROGRESS)` = Active
- `🚀 / 💰 / 📱 / etc. PHASE X: NAME` = Pending
