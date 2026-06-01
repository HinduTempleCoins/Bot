# API Catalog — what the bots can call

This is the **callable index**: the APIs wired into this repo right now, plus the categories that need a key. It is the practical companion to the full 300+ inventory, which is kept private (`.local/APIS_300_BOT_FLEET.md`) because a complete keyed/infra map shortcuts recon. For HIVE/STEEM/MELEK chain APIs specifically, see `HIVE_STEEM_BOTS.md`.

**Rule:** keyless = wired here in `free-apis.mjs` and smoke-tested. Keyed = listed by name only; the key lives in the Server 4 vault, never in this repo (`[[feedback-zero-wif-in-bot-repo]]`).

---

## Wired & callable now (keyless — `integrations/free-apis.mjs`)

Run `npm run apis` (`node integrations/free-apis.mjs smoke`) to see which are live this minute.

### `crypto` — market data / prices (24)
coingecko · kraken · coinbase · coinpaprika · defillama · dexscreener · geckoterminal · frankfurter · mempoolFees · okx · bitfinex · kucoin · gate · bitstamp · gemini · coincap · coinlore · cryptocompare · binance · bybit · mexc · fearGreed · defillamaTvl · coingeckoGlobal · coingeckoTrending · exchangerateHost

### `chains` — L1 block explorers (8)
btcTipHeight · btcStats · btcTicker · ethBlockcypher · btcBlockcypher · mempoolTip · dogeBlockcypher · ltcBlockcypher

### `hive` — Graphene / HIVE-Engine (8)
globalProps · account · witness · rewardFund · priceFeed · engineTokens · engineBalance · beaconNodes
→ deeper chain + HIVE-Engine surface in `chain-explorer.mjs`, `hive-engine-market.mjs`, `he-client.mjs`.

### `dev` — package registries / tool discovery (5)
github · githubSearch · npm · pypi · crates

### `news` — open knowledge feeds (5)
hackerNewsTop · hackerNewsItem · spaceflight · gutendex · dictionary

### `security` — threat-intel (keyless tiers) (2)
circlCveLast · firstEpss (EPSS scores)

### `knowledge` — reference (10)
wikipedia · wikidata · mediawiki · arxiv · crossref · openlibrary · semanticScholar · restCountries · openMeteo · timeNow · holidays · geocode

### `content` — media / search / util (7)
pollinations (image) · jinaReader · duckduckgo · wikipediaImages · microlink · qrCode

**~64 keyless endpoints live.** A handful (gutendex, arxiv, semanticScholar) are slow / rate-limited and may flap on any given smoke run — they are wired, not broken.

---

## Needs a key (cataloged, not wired — key → Server 4 vault)

These are named in the private master catalog with their categories. They are NOT wired here because that would mean a key in the repo. To enable one: provision the key into the vault on Server 4, register it as a connector, and add a thin client that reads the key from env (never hard-coded).

- **AI / LLM inference & embeddings** — GitHub Models (wired on Server 4 already), OpenRouter, Groq, Together, Fireworks, DeepInfra, Hugging Face Inference, Cohere, Mistral, Cloudflare Workers AI, Voyage/Jina embeddings, vector DBs (Qdrant-local wired, Pinecone/Weaviate/Chroma-cloud keyed).
- **Crypto node/RPC providers** — Alchemy, Infura, QuickNode, Ankr, Etherscan/BscScan family, Blockdaemon, GetBlock.
- **Media** — OpenAI images, Stability, Replicate, ElevenLabs/Deepgram (speech), AssemblyAI, Cloudinary.
- **Comms / social / search** — Discord (wired on Server 4), Telegram (wired), Twitter/X, Reddit OAuth, Resend/Postmark/SES (email), Twilio (SMS), Brave/Serper/Bing/Tavily (search), CryptoPanic/NewsAPI.
- **Infra / monitoring / security** — Sentry, UptimeRobot, BetterStack, VirusTotal, Shodan, AbuseIPDB, GreyNoise, urlhaus (now keyed), have-i-been-pwned.

Full per-API detail, free-tier limits, and provisioning order: `.local/APIS_300_BOT_FLEET.md` (private).

---

## How the AIs use this

- **Trade/market work** — `crypto` + `chains` + `hive` feed `price-oracle.mjs`, `arb-scanner.mjs`, `chain-explorer.mjs` (cross-source prices, depth, base-chain context).
- **Annal/brief context** — `knowledge` + `news` + `dev` give the annal-writing AIs reference and tool-discovery data.
- **Cheetah / defensive** — `security` for CVE/EPSS lookups; keyed threat-intel when provisioned.
- **Cadence** — fire a relevant client just-in-time before annaling a file when it gives data the batch didn't (`[[resource-timing-tiers-annal-brief]]`).
