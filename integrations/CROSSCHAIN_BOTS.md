# Cross-Chain / Solana / Discord Trading & Community Bot Reference Catalog

Reference catalog of notable, open-source projects for **read-only** market, on-chain, and arbitrage data across high-volume chains. The context: MELEK's `integrations/` already reads HIVE + HIVE-Engine read-only (`chain-explorer.mjs`, `hive-engine-market.mjs`, `arb-scanner.mjs`, `price-oracle.mjs`, `tradebot-forensics.mjs`) and wants to extend the **same read-only pattern** to ~10 high-volume chains.

**Scope discipline (per repo rules):** MELEK does **not** sign or execute. Everything below is catalogued for its **read-side / data / arbitrage-detection** value only. Execution/sniper/copy-trade repos are listed as *patterns to study*, not to integrate — their signing paths are explicitly out of scope (zero-WIF-on-host rule; broadcasting goes through MELEK-Signer, never local keys). Prefer **keyless or free-tier** tools.

This is the cross-chain companion to `HIVE_STEEM_BOTS.md` (Graphene/HIVE side) and `API_CATALOG.md` (raw endpoints).

> Licenses are noted from the projects' own repos/docs where stated; confirm against the live `LICENSE` file before vendoring any code. The throwaway single-purpose sniper repos are MIT/Unlicense/unstated and are listed for pattern value, not code reuse.

---

## 1. Solana trading bots (patterns to study — execution out of scope)

These are how the Solana trading ecosystem fetches quotes, watches new pools, and tracks wallets. MELEK's interest is the **quote/route/pool-watch/wallet-track read paths**, not the swap execution.

| Project | GitHub | What it does | Lang | License | What MELEK could borrow |
|---|---|---|---|---|---|
| **YZYLAB/solana-trade-bot** | https://github.com/YZYLAB/solana-trade-bot | PoC bot trading across Raydium (V4/CPMM/CLMM), Pumpfun, Orca, Moonshot, Jupiter | TypeScript | unstated (treat as reference) | The per-DEX quote-fetch adapters — a map of which RPC/AMM calls give a price on each Solana DEX |
| **mhuzaifah/Auto-Sniper-Sol-Trading-Bot** | https://github.com/mhuzaifah/Auto-Sniper-Sol-Trading-Bot | Discovers new token pools, tracks real-time prices, fires fast trades | TypeScript | unstated | The **new-pool discovery loop** (watching pool-creation events) — useful read-only signal for a "new listings" feed |
| **hexnome/grpc-copy-trading-sniper-bot** | https://github.com/hexnome/grpc-copy-trading-sniper-bot | Multi-DEX (Jupiter/Raydium/Orca/Meteora/Pump.fun) sniper+copy via Yellowstone gRPC | Rust | unstated | The **gRPC (Geyser/Yellowstone) streaming** pattern for low-latency on-chain reads vs. polling RPC |
| **cutupdev/Solana-Copytrading-bot** | https://github.com/cutupdev/Solana-Copytrading-bot | Mirrors target wallets across Raydium/Meteora/Pumpfun/Pumpswap | Rust | unstated | The **wallet-watch** core: subscribe to an address's tx stream and decode swaps — directly analogous to `tradebot-forensics.mjs` but on Solana |
| **keidev-sol/Solana-Copy-Trading-Bot-Rust** | https://github.com/keidev-sol/Solana-Copy-Trading-Bot-Rust | Mirror wallets across DEXs; Pump.fun / LaunchLab / Raydium decoding | Rust | unstated | Swap-instruction decoders per program (how to turn raw Solana ixs into "X bought Y") |
| **hanshaze/solana-sniper-copy-mev-trading-bot** | https://github.com/hanshaze/solana-sniper-copy-mev-trading-bot | Sniper/copy/MEV bot with shredstream, gRPC | Rust | unstated | The MEV/arbitrage **opportunity-detection** logic (the read half before execution) |

**Caveat:** most single-purpose Solana sniper repos are thin, anonymously-authored, and frequently relicensed/abandoned. Use them to learn *which calls return which data*, not as dependencies. The durable building blocks are the **Jupiter SDK** and **@solana/web3.js** in §3.

---

## 2. Discord trading / community bots that surface on-chain or market data

Pattern reference for a future MELEK Discord surface (the Discord bot is already live on Server 4 per repo memory). These show the command shapes and data sources a community price/market bot uses.

| Project | GitHub | What it does | Lang | License | What MELEK could borrow |
|---|---|---|---|---|---|
| **EthyMoney/TsukiBot** | https://github.com/EthyMoney/TsukiBot | Full crypto Discord bot: spot prices, charts, coin details, market stats, per-user watchlists | JavaScript (discord.js) | GPL-3.0 | The **command surface design** (price/chart/watchlist commands) — maps onto MELEK's `watchlist.mjs` + `digest.mjs` |
| **rssnyder/discord-stock-ticker** | https://github.com/rssnyder/discord-stock-ticker | Live stock + crypto prices in the Discord sidebar; on-chain token tracking on ETH/BSC/Polygon | Go | MIT | The **sidebar live-ticker** pattern (nickname/status as a price display) and its on-chain token-by-contract lookups |
| **Purukitto/coinEZ** | https://github.com/Purukitto/coinEZ | Price/volume/market data for 7000+ coins via CoinGecko, plus an economy game | JavaScript | MIT | Clean CoinGecko-backed price command implementation (keyless free tier) |
| **neo3587/discord_cryptobot** | https://github.com/neo3587/discord_cryptobot | Price across listed exchanges, blockchain stats, expected earnings | JavaScript | unstated | Multi-exchange price aggregation display logic |
| **kodycode/CoinMarketBot** | https://github.com/kodycode/CoinMarketBot | (Archived) auto-reports CoinMarketCap updates | Python (discord.py) | MIT | Scheduled push-update loop pattern (analogous to MELEK's `publish-feed.mjs`) |

**Underlying Discord libraries** (the framework layer):
- **discord.js** — https://github.com/discordjs/discord.js — Node.js Discord API library, Apache-2.0. The natural fit for MELEK's existing Node stack.
- **discord.py** — https://github.com/Rapptz/discord.py — Python, MIT.
- **serenity** (+ poise) — https://github.com/serenity-rs/serenity — Rust, ISC.

---

## 3. Cross-chain automation / monitoring frameworks

The load-bearing, well-maintained libraries. These are the ones MELEK should actually depend on for multi-chain read coverage.

| Project | GitHub | What it does | Lang | License | What MELEK could borrow |
|---|---|---|---|---|---|
| **ccxt** | https://github.com/ccxt/ccxt | Unified trading API for 100+ CEXes (ticker/orderbook/OHLCV/trades) | JS/TS/Python/C#/PHP/Go/Java | MIT | **Single biggest win for CEX read data.** Public market methods (`fetchTicker`, `fetchOrderBook`, `fetchOHLCV`, `fetchTrades`) are keyless on most exchanges — instant multi-exchange price/depth for arbitrage detection without per-exchange code |
| **Jupiter SDK / Swap API** | https://github.com/jup-ag/jupiter-swap-api-client (Rust) · https://github.com/jup-ag/jupiter-core-example · docs https://dev.jup.ag | Solana's DEX aggregator; `/swap/v1/quote` returns best route + price impact across all Solana DEXes | Rust / TS / HTTP | Apache-2.0 (clients) | The **Quote API is a keyless read endpoint**: one HTTP call gives the aggregated Solana price for any token pair — ideal arbitrage reference price for Solana |
| **0xTaoDev/jupiter-python-sdk** | https://github.com/0xTaoDev/jupiter-python-sdk | Python wrapper for Jupiter quotes/prices/stats | Python | MIT | Reference for the Jupiter quote/price call shape if a Python helper is ever wanted |
| **hummingbot** | https://github.com/hummingbot/hummingbot | HFT market-making framework; connectors for many CEX + DEX | Python | Apache-2.0 | Its **connector abstraction** (one interface, many venues) is the architecture template for MELEK's multi-chain adapter layer; market-data connectors are read-only |
| **freqtrade** | https://github.com/freqtrade/freqtrade | Mature (49k★, since 2017) crypto bot with backtesting + analytics | Python | GPL-3.0 | The **data-download + backtest pipeline** (built on ccxt) — pattern for historical OHLCV storage and offline analysis. (GPL-3.0 — study patterns, don't vendor into a non-GPL codebase) |
| **1inch SDK / examples** | https://github.com/1inch/sdks-examples | EVM DEX aggregator; quote/swap across many EVM chains | TS (ethers + viem) | MIT (examples) | The **Swap/Quote API gives an aggregated EVM reference price** per chain (Ethereum, BSC, Polygon, Arbitrum, Base…) — EVM counterpart to Jupiter. Quote read needs an API key on current 1inch tiers; 0x below is an alternative |
| **0x Swap API** | docs https://0x.org · examples e.g. https://github.com/benreichman/1Inch-API-Swap (comparison) | EVM aggregator; price+quote across dozens of DEXes with smart order routing | HTTP / any web3 lib | API is a service (clients MIT) | Alternative EVM aggregated-price source; response is web3-lib-agnostic so it drops into a Node fetch helper |
| **ethers.js** | https://github.com/ethers-io/ethers.js | Complete EVM library; `JsonRpcProvider` read calls (balances, logs, contract reads) | TypeScript | MIT | The **read-only `Provider`** for any EVM chain — `getBalance`, `getLogs`, `call`, event filters. Multi-chain by just swapping RPC URL |
| **viem** | https://github.com/wevm/viem | Lightweight modern EVM TS library; **Public Client = read-only** | TypeScript | MIT | The `PublicClient` (`readContract`, `getLogs`, `multicall`) — 35 kB, typed, explicitly separates read (Public) from write (Wallet) clients. Cleanest fit for read-only multi-EVM-chain reads |
| **@solana/web3.js / @solana/kit** | https://github.com/solana-foundation/solana-web3.js · https://github.com/anza-xyz/kit | Official Solana JS SDK; JSON-RPC reads (accounts, balances, tx, logs) | TypeScript | Apache-2.0 (web3.js) / MIT (kit) | The canonical **read-only Solana RPC client** — the base under any Solana data work; pairs with a free RPC for account/tx/balance reads |

---

## 4. On-chain data / indexer libraries (read-only, keyless or free-tier where possible)

Where to get cross-chain prices, pools, TVL, and trades **without paid keys**.

| Source | URL | What it does | Access | License / cost | What MELEK could borrow |
|---|---|---|---|---|---|
| **DefiLlama API** | https://github.com/DefiLlama/docs · API https://api-docs.defillama.com · SDKs https://github.com/DefiLlama/python-sdk , https://github.com/DefiLlama/api-sdk | TVL, prices, yields, volumes, fees, bridges across **350+ chains / 5000+ protocols** | **Keyless** public API, no login | Open-source codebase; free public tier (Pro $300/mo only for high volume) | **Best keyless cross-chain price + TVL source.** `coins.llama.fi/prices/current/...` gives multi-chain token prices in one call — a free reference-price feed for the arbitrage scanner |
| **CoinGecko API** | https://www.coingecko.com/en/api | Prices/market data for 30M+ tokens across 250+ networks | Demo plan **keyless-ish** (free key, 10k calls/mo) | Free Demo tier | Already the kind of source MELEK's `price-oracle.mjs` wants — broad coverage, simple price endpoints |
| **GeckoTerminal API** | https://apiguide.geckoterminal.com | On-chain DEX prices for 6M+ tokens, 200+ chains, 1500+ DEXes (OHLCV, pools, trades) | **Currently keyless/free** | Free (CoinGecko-run) | **DEX-level** (not just CEX) prices + pool data per chain — the on-chain arbitrage reference complementing DefiLlama |
| **DexScreener API** | https://docs.dexscreener.com/api/reference | Real-time DEX pair snapshots across many chains | **No key, no signup** | Free (snapshot only; no historical/WS) | Zero-friction "what's the live DEX price/liquidity of this pair" lookups — good for a quick cross-chain pair scan |
| **The Graph / graph-node** | https://github.com/graphprotocol/graph-node | Indexes chain data, serves GraphQL "subgraphs" | Self-host (keyless) or hosted (key) | Apache-2.0 / MIT | Self-hostable indexer if MELEK ever needs custom historical/event queries on an EVM chain without a paid provider |
| **Ponder** | https://github.com/ponder-sh/ponder | TS framework to build a GraphQL API over any EVM contracts; hot reload, typed | TypeScript | MIT | Lightweight self-host indexer in MELEK's own language — turn raw EVM logs into a queryable read API |
| **reth-indexer** | https://github.com/joshstevens19/reth-indexer | Reads directly from a reth DB, decodes, indexes to Postgres + API, config-driven | Rust | MIT | Pattern for low-cost direct-from-node EVM indexing (if a node is available) |
| **o-az/awesome-evm-indexer** | https://github.com/o-az/awesome-evm-indexer | Curated list of EVM indexing tools/libraries | — | list | Survey map when picking an indexer per chain |
| **Helius** (Solana) | https://www.helius.dev | Solana RPC + enhanced APIs, webhooks, gRPC | Free tier (key) | Freemium | Free-tier Solana RPC/enhanced-tx if public RPC rate limits bite; pairs with @solana/web3.js |

---

## Highest-value adoptions for MELEK (do these first)

- **DefiLlama price API (keyless)** — single biggest, lowest-friction win: one HTTP call returns current token prices across 350+ chains with no key. Wire it into `price-oracle.mjs` / `arb-scanner.mjs` as the cross-chain reference-price feed. (https://api-docs.defillama.com)
- **ccxt (MIT)** — drops in instant read-only CEX market data (`fetchTicker`/`fetchOrderBook`/`fetchOHLCV`) for 100+ exchanges, keyless on public endpoints. This is the CEX leg of any cross-chain arbitrage view, with near-zero per-exchange code. (https://github.com/ccxt/ccxt)
- **Jupiter Quote API (Solana) + 1inch/0x Quote API (EVM)** — aggregated *on-chain* reference prices per ecosystem via plain HTTP. Jupiter is keyless; use 0x (web3-lib-agnostic) for EVM if avoiding 1inch's keyed tier. These are the DEX-side prices that make arbitrage detection real rather than CEX-only. (https://dev.jup.ag, https://0x.org)
- **viem PublicClient (MIT)** — the clean, typed, read-only multi-EVM client: swap the RPC URL to cover Ethereum, BSC, Polygon, Arbitrum, Base, etc. with one library and an explicit read/write separation that fits the zero-signing rule. Pair with **@solana/web3.js** (Apache-2.0) for the Solana read leg. (https://github.com/wevm/viem)
- **hummingbot connector architecture (Apache-2.0) as the design template** — don't vendor it; copy its "one interface, many venues" connector pattern so MELEK's new chains slot into a uniform read-only adapter layer (mirroring how `he-client.mjs` abstracts HIVE-Engine today). (https://github.com/hummingbot/hummingbot)

Sources: [DefiLlama](https://github.com/DefiLlama/docs), [ccxt](https://github.com/ccxt/ccxt), [hummingbot](https://github.com/hummingbot/hummingbot), [freqtrade](https://github.com/freqtrade/freqtrade), [Jupiter](https://github.com/jup-ag/jupiter-swap-api-client), [1inch examples](https://github.com/1inch/sdks-examples), [viem](https://github.com/wevm/viem), [ethers.js](https://github.com/ethers-io/ethers.js), [@solana/web3.js](https://github.com/solana-foundation/solana-web3.js), [TsukiBot](https://github.com/EthyMoney/TsukiBot), [discord-stock-ticker](https://github.com/rssnyder/discord-stock-ticker), [discord.js](https://github.com/discordjs/discord.js), [GeckoTerminal](https://apiguide.geckoterminal.com), [The Graph](https://github.com/graphprotocol/graph-node), [Ponder](https://github.com/ponder-sh/ponder).
