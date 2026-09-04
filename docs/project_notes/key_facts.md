# Key Facts - Van Kush Bot Ecosystem

## Hosting & Deployment

**Discord Bot:**
- Platform: Railway (auto-deploy from GitHub)
- Entry point: `index.js`
- Process: `node index.js`

**Trading Bots:**
- Platform: Google VM
- Files: `vankush-price-pusher.cjs`, `hive-trading-bot.cjs`, `vankush-intelligent-trader.cjs`
- Process manager: PM2

**Wiki (Future):**
- Target: Contabo VPS (~$5-7/month)
- Domain: Wiki.SoapBox.Community
- Software: MediaWiki + Pywikibot

## API Endpoints

**Knowledge Base API:**
- Local: `http://127.0.0.1:8765`
- Routes: `/search?q=`, `/query?q=`, `/stats`
- Script: `knowledge-base.py`

## Blockchain Accounts

**HIVE:**
- Username: configured in `.env` as `HIVE_USERNAME`
- Keys: `.env` (`HIVE_ACTIVE_KEY`, `HIVE_POSTING_KEY`)

**Tokens:**
- VKBT: ~1.9M supply, 986 holders
- CURE: ~55K supply, 999 holders

## Trading Bot Configuration

- Daily budget: 35 HIVE/day
- Troll bot protection: 5% max price increase per session, 6h cooldown
- BLURT preference multiplier: 1.4x
- Dry run mode: `HIVE_BOT_DRY_RUN=true`
- Stop loss: -10%, Take profit: 15%

## Knowledge Base

- Location: `knowledge/` (22 domain folders, 231 JSON files)
- Index: `knowledge/_keyword_index.json` (533 keywords)
- Architecture: `knowledge/KNOWLEDGE_BASE_ARCHITECTURE.json`

## Domains Owned

- SoapBox.Community (main + subdomains)
- Soapy.Blog (future Graphene chain)
- VanKushFamily.com (roadmaps, whitepapers)

## Important URLs

- GitHub: https://github.com/HinduTempleCoins/Bot
- HIVE-Engine: https://hive-engine.com
- Knowledge source: `knowledge/` directory on main branch
