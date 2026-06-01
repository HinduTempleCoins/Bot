# Cross-Chain Crypto Data & Bot APIs — Catalog

**Scope:** read-only price / market / on-chain data across ~10 high-volume chains
(Ethereum, Solana, BSC, Polygon, Base, Arbitrum, Tron, TON, Avalanche, Sui) for the
Node.js repo at `/workspaces/Bot`. This repo already reads HIVE / HIVE-Engine and has a
keyless-API layer at `integrations/free-apis.mjs`.

Each entry is tagged **[KEYLESS]** (no signup, callable today) or **[KEY]** (needs an API
key — provision separately, key → vault, never into `free-apis.mjs`). Free-tier limits and
data scope noted. Endpoints marked ✅ were live-tested during this research (2026-06-01).

> Convention reminder (CLAUDE.md): keyed APIs are provisioned separately; only KEYLESS
> endpoints belong in `free-apis.mjs`. The "wire immediately" list at the bottom is the
> KEYLESS-only shortlist.

---

## 1. DEX aggregators / quotes

| API | Auth | Free tier | Base URL | Data |
|---|---|---|---|---|
| **0x Swap API** | **[KEY]** | Two tiers; key required on *every* call (`0x-api-key` header). v1 sunset 2025-04-11 — use v2 (`0x-version: v2` header). | `https://api.0x.org/swap/allowance-holder/quote` | Aggregated EVM swap quotes + calldata across many DEXs. `taker` required in v2. |
| **1inch** | **[KEY]** | 1 req/s, 100k calls/mo. Register at portal.1inch.dev. | `https://api.1inch.dev/swap/v6.0/{chainId}` | Swap quotes + calldata, spot prices, token lists, balances on major EVM chains. |
| **OpenOcean** | **[KEYLESS]** ✅ | Public, no key. (Higher limits → contact them.) | `https://open-api.openocean.finance/v4/{chain}/quote` | Aggregated quotes across 40+ chains incl. **Solana, Sui** + all the EVM targets. Returns best route, per-DEX breakdown, gas est., price impact. |
| **Jupiter (Solana swap)** | **[KEYLESS]** (lite-api) / **[KEY]** (portal) | Public lite-api free; Pro/Ultra keys at portal.jup.ag for higher limits. Public host adds 0.2% platform fee on swaps. | `https://lite-api.jup.ag/swap/v1/quote` | Solana swap quotes/routing. (Price-only endpoint listed in §5.) |
| **ParaSwap / Velora** | **[KEYLESS]** | Public quote endpoint free; dedicated keys for corporate reliability. | `https://api.paraswap.io/quote` (build tx: `POST /transactions/:network`) | Optimal EVM swap price + tx calldata across many liquidity sources. |
| **KyberSwap Aggregator** | **[KEYLESS]** ✅ | Public; pass `X-Client-Id` header to avoid rate-limiting; higher limits → BD team. | `https://aggregator-api.kyberswap.com/{chain}/api/v1/routes` | Best-route discovery across DEXs per chain (`tokenIn/tokenOut/amountIn`); pool path, gas, USD values. |

Notes:
- OpenOcean + KyberSwap + ParaSwap are the keyless trio for read-only quotes; 0x and 1inch are key-gated.
- For Solana quotes, OpenOcean and Jupiter both work keyless.

---

## 2. Price / market data

| API | Auth | Free tier | Base URL | Data |
|---|---|---|---|---|
| **DefiLlama** | **[KEYLESS]** ✅ | Open, ~500 req / 5 min. Yields/pools require Pro ($300/mo). | `https://api.llama.fi`, `https://coins.llama.fi`, `https://stablecoins.llama.fi`, `https://yields.llama.fi` | TVL per protocol/chain, token prices (`/prices/current/{chain}:{addr}`), DEX volumes, fees/revenue, stablecoins, bridges. `GET https://api.llama.fi/v2/chains` = all chains by TVL (already in repo). |
| **GeckoTerminal** | **[KEYLESS]** ✅ | Public beta, 30 calls/min, no key. (Same data also via CoinGecko Pro `/onchain`.) | `https://api.geckoterminal.com/api/v2` | On-chain DEX data: networks, DEXes, pools, OHLCV, token prices by address. `…/simple/networks/{net}/token_price/{addr}` ✅. Send header `Accept: application/json;version=20230302`. |
| **DEXScreener** | **[KEYLESS]** ✅ | No key, no signup. 300 req/min (pairs/pools), 60 req/min (token profiles). No historical, search caps at 30 results. | `https://api.dexscreener.com` | Pair/token data across all chains: price (native+USD), txns, volume (m5/h1/h6/h24), liquidity, FDV, marketCap. `…/latest/dex/tokens/{addr}` ✅, `…/latest/dex/search?q=` (in repo). |
| **CoinGecko** | **[KEY]** (Demo) | Demo key free: ~30 calls/min (docs also cite 100), 10k calls/mo. A keyless public path exists but is heavily throttled/unstable. | `https://api.coingecko.com/api/v3` (Demo) | Coin prices, market caps, global, trending, OHLC. Repo already calls public `simple/price`, `global`, `search/trending` keyless — fine for low volume; add Demo key for reliability. |
| **Birdeye** | **[KEY]** | All tiers need a key. Standard/Lite ~4.5M CU/mo, 15 RPS. | `https://public-api.birdeye.so` | Solana-first (also multichain): token price, OHLCV, trades, holders, security. `x-chain` header selects chain. |
| **GMGN** | **[KEY]** (Trade API) — some quotation paths reachable but ToS-gated / unofficial | Trade API by application (Google Form → key emailed). | `https://gmgn.ai/defi/quotation/v1/...`, `https://gmgn.ai/defi/router/v1/sol/...` | Meme/trending token ranking, swap routing, token-security flags (`is_honeypot`, `is_blacklist`) on Solana/BSC/Base. Treat public quotation URLs as unofficial/unstable. |

Notes:
- For "price by contract address, any chain, no key": **GeckoTerminal**, **DefiLlama coins**, **DEXScreener** are the three keyless workhorses.
- Birdeye/GMGN add Solana depth but are key-gated.

---

## 3. Multichain RPC providers (free tiers)

| Provider | Auth | Free tier | Endpoint pattern | Notes |
|---|---|---|---|---|
| **Ankr** | **[KEYLESS]** public / **[KEY]** premium | Public endpoints free (rate-limited, no SLA). Freemium key = 200M credits/mo. | `https://rpc.ankr.com/{chain}` (e.g. `/eth`, `/bsc`, `/polygon`, `/avalanche`, `/arbitrum`, `/base`, `/solana`) | 80+ chains. Public path needs no signup; standard EVM JSON-RPC. Solana endpoint exists too. |
| **dRPC** | **[KEYLESS]** public / **[KEY]** free-plan | Public nodes always free (rate-limited per IP, ~120k CU/min normal, min 50.4k under load). Free key = 210M CU / 30 days, every JSON-RPC call = 20 CU. | `https://{chain}.drpc.org` (key: `?dkey=`) | 115+ chains / 200+ networks. |
| **PublicNode** | **[KEYLESS]** ✅ | Free, no key, privacy-first. Limits not published (treat as modest). | `https://{chain}.publicnode.com` (e.g. `ethereum`, `bsc`, `polygon-bor`, `base`, `arbitrum-one`, `avalanche-c-chain`, `solana`, `sui`, `ton`) | 78+ chains incl. several non-EVM. Good keyless fallback layer. |
| **1RPC** | **[KEYLESS]** public / **[KEY]** | Free within fair-use; per-user daily quota resets 00:00 UTC. TEE privacy relay (no metadata logging). | `https://1rpc.io/{chain}` (e.g. `eth`, `bnb`, `matic`, `base`, `arb`, `avax`, `sol`, `ton`, `sui`) | 64+ chains. Privacy-oriented. |
| **LlamaNodes** | **[KEYLESS]** ✅ | Free public RPC, no key; optional key just for usage stats. | `https://{chain}.llamarpc.com` (e.g. `eth`, `base`, `polygon`, `bsc`, `arbitrum`) | EVM-focused (Ethereum, Base, Polygon, BSC, Arbitrum…). DefiLlama's own RPC. |
| **Blast (Bware)** | **DEPRECATED** | — | — | **Shut down end of Oct 2025; acquired by Alchemy.** Migrate to Alchemy. Do not wire. |

Notes:
- Keyless RPC layer worth wiring for read-only on-chain calls: **PublicNode**, **Ankr public**, **LlamaNodes**, **1RPC**, **dRPC public**. Rotate across them for resilience (same pattern the repo's `chains` block already uses).
- Non-EVM coverage (Solana/TON/Sui) is best via PublicNode + 1RPC + Ankr.

---

## 4. Indexers / on-chain data

| API | Auth | Free tier | Base URL | Data |
|---|---|---|---|---|
| **Covalent / GoldRush** | **[KEY]** | 14-day trial 25k credits; free key 100k credits/mo, 5 RPS. | `https://api.covalenthq.com/v1` | 100+ EVM + non-EVM (incl. Solana): balances, token holders, transactions, NFTs, historical prices. Chain slugs like `eth-mainnet`, `matic-mainnet`, `base-mainnet`. |
| **Moralis** | **[KEY]** | Starter free: 40,000 CU/day, up to 1,000 CU/s. | `https://deep-index.moralis.io/api/v2.2` (EVM), `https://solana-gateway.moralis.io` (Solana) | Balances, token/NFT metadata, transfers, prices, DeFi positions across EVM + Solana. |
| **The Graph** | **[KEY]** | 100k free queries/mo on the decentralized network, then $4/100k. | `https://gateway.thegraph.com/api/{api-key}/subgraphs/id/{id}` | Custom subgraph GraphQL queries (per-protocol indexed data). Best when a relevant subgraph exists. |
| **Bitquery** | **[KEY]** | Free trial 100k API points / 1 mo, ~1,000 calls/day. OAuth bearer token. | `https://streaming.bitquery.io/graphql` | GraphQL + WebSocket/Kafka streams: DEX trades, transfers, balances, OHLC across many chains incl. Solana, TON, Tron. |
| **Dune** | **[KEY]** | Free plan: 2,500 credits + API access. | `https://api.dune.com/api/v1` | Run/read SQL query results over indexed multichain data; good for analytics, not low-latency. |
| **Goldsky** | **[KEY]** | Starter (free, no CC): subgraphs + Mirror pipelines + Edge RPC. Key created in Settings. | per-project subgraph GraphQL URL | Hosted subgraphs + Mirror data pipelines (real-time onchain → your DB). |
| **Alchemy** | **[KEY]** | Free tier ~300M CU/mo (some docs cite 30M); no time limit; Supernode + NFT/Transfers APIs. | `https://{network}.g.alchemy.com/v2/{key}` | RPC + enhanced APIs (token balances, transfers, NFT, asset transfers) across ETH, L2s (Base/Arb/Polygon/Optimism), Solana, BSC, Avalanche, more. Successor to Blast. |
| **Etherscan family (V2 multichain)** | **[KEY]** | Free key: ~5 calls/s, 100k calls/day (standard). **One key → 60+ EVM chains.** V1 deprecated 2025-08-15. | `https://api.etherscan.io/v2/api?chainid={id}&...` | Block explorer data: balances, txns, token transfers, logs, contract ABIs/source, gas oracle. Pass `chainid` (1=ETH, 56=BSC, 137=Polygon, 8453=Base, 42161=Arbitrum, 43114=Avalanche, etc.). **Note: Tron uses TronScan/TronGrid, not Etherscan V2.** |

Notes:
- Indexer layer is essentially all **[KEY]**. Etherscan V2 is the highest-leverage single key (one key, all EVM chains in scope). Covalent/Moralis add Solana + richer token/holder data.
- None of these go into `free-apis.mjs`.

---

## 5. Solana-specific

| API | Auth | Free tier | Base URL | Data |
|---|---|---|---|---|
| **Helius** | **[KEY]** | Free: 1M credits, 10 RPS, no CC. | `https://mainnet.helius-rpc.com/?api-key={key}` (+ REST APIs) | Solana RPC + enhanced/DAS APIs: parsed txns, token/NFT metadata, webhooks, priority fees. |
| **Triton One** | **[KEY]** (paid) | No meaningful free tier; dedicated ~$2,900/mo, starter ~$500/mo. | account-issued | Enterprise Solana RPC/gRPC, Yellowstone Geyser streams, Titan swap API. Not for free-tier use. |
| **Solana public RPC** | **[KEYLESS]** | Free, no key. 100 req / 10s per IP (40/10s for a single RPC method). Not for production. | `https://api.mainnet-beta.solana.com` | Standard Solana JSON-RPC: accounts, balances, txns, blocks, token accounts. Good keyless read layer with retry/backoff. |
| **Jupiter Price API** | **[KEYLESS]** ✅ (lite-api) / **[KEY]** (portal) | lite-api public free; Pro keys for higher limits. | `https://lite-api.jup.ag/price/v3?ids={mint}` | USD price per Solana mint: `usdPrice`, `liquidity`, `decimals`, `priceChange24h`, `blockId`. Verified live. |

Notes:
- Keyless Solana read stack: **Solana public RPC** (chain state) + **Jupiter lite-api price** (USD prices) + **GeckoTerminal**/**DEXScreener** (pool/DEX data) + **OpenOcean**/**Jupiter** (quotes).
- Helius is the key-gated upgrade when public RPC limits bite.

---

## Wire into `free-apis.mjs` immediately — KEYLESS only

All verified callable with no key. Suggested home: a new `crosschain` / `dex` export
block alongside the existing `crypto` and `chains` blocks. Exact example URLs:

**Price by contract address (any chain, keyless):**
- DefiLlama coins ✅
  `https://coins.llama.fi/prices/current/ethereum:0xdAC17F958D2ee523a2206206994597C13D831ec7`
  → `{coins: {"ethereum:0x...": {symbol, price, decimals, timestamp, confidence}}}`
- GeckoTerminal token price ✅
  `https://api.geckoterminal.com/api/v2/simple/networks/eth/token_price/0xdac17f958d2ee523a2206206994597c13d831ec7`
  (header `Accept: application/json;version=20230302`)
- DEXScreener token pairs ✅
  `https://api.dexscreener.com/latest/dex/tokens/0xdac17f958d2ee523a2206206994597c13d831ec7`
  → `{pairs:[{priceUsd, liquidity, volume, fdv, chainId, dexId, ...}]}`

**DEX swap quotes (keyless aggregators):**
- OpenOcean v4 quote ✅
  `https://open-api.openocean.finance/v4/eth/quote?inTokenAddress=0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee&outTokenAddress=0xdac17f958d2ee523a2206206994597c13d831ec7&amount=1&gasPrice=5`
  (chain segment swappable: `bsc`, `polygon`, `arbitrum`, `base`, `avax`, `solana`, `sui`, …)
- KyberSwap routes ✅
  `https://aggregator-api.kyberswap.com/ethereum/api/v1/routes?tokenIn=0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee&tokenOut=0xdac17f958d2ee523a2206206994597c13d831ec7&amountIn=1000000000000000000`
  (send `X-Client-Id: MELEK-Bot` header to avoid throttling)
- ParaSwap/Velora quote
  `https://api.paraswap.io/quote` (POST or query per docs)

**Solana (keyless):**
- Jupiter price v3 ✅
  `https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112`
  → `{ "So111…": {usdPrice, liquidity, decimals, priceChange24h, blockId} }`
- Jupiter swap quote
  `https://lite-api.jup.ag/swap/v1/quote?inputMint={mint}&outputMint={mint}&amount={lamports}`
- Solana public RPC (JSON-RPC POST)
  `https://api.mainnet-beta.solana.com` — methods `getBalance`, `getTokenAccountsByOwner`, `getSlot`, etc. (≤100 req/10s/IP)

**Multichain RPC fallbacks (keyless, JSON-RPC POST — same `rpc()` helper already in `free-apis.mjs`):**
- PublicNode: `https://ethereum.publicnode.com`, `https://bsc.publicnode.com`, `https://polygon-bor.publicnode.com`, `https://base.publicnode.com`, `https://arbitrum-one.publicnode.com`, `https://avalanche-c-chain.publicnode.com`, `https://solana.publicnode.com`, `https://sui.publicnode.com`, `https://ton.publicnode.com`
- Ankr public: `https://rpc.ankr.com/eth`, `/bsc`, `/polygon`, `/base`, `/arbitrum`, `/avalanche`, `/solana`
- LlamaNodes: `https://eth.llamarpc.com`, `https://base.llamarpc.com`, `https://polygon.llamarpc.com`, `https://binance.llamarpc.com`, `https://arbitrum.llamarpc.com`
- 1RPC: `https://1rpc.io/eth`, `/bnb`, `/matic`, `/base`, `/arb`, `/avax`, `/sol`, `/ton`, `/sui`

**Already wired (this repo, keyless):** `coins.llama.fi` prices, `api.llama.fi/v2/chains`,
DEXScreener search, GeckoTerminal networks, CoinGecko public simple/price+global+trending.

---

## Gotchas / changes since older docs
- **0x v1 sunset 2025-04-11**; v2 needs `0x-version: v2` header + `taker`. Still **[KEY]**.
- **Etherscan V1 deprecated 2025-08-15** → V2 multichain (one key, `chainid` param).
- **Blast/Bware API shut down end of Oct 2025**; folded into Alchemy. Don't depend on it.
- **CoinGecko** keyless public path is throttled/unstable; Demo key is the supported free route.
- **Tron** is not on Etherscan V2 — use TronGrid/TronScan; covered for prices via GeckoTerminal/DEXScreener/Bitquery.
- GeckoTerminal requires the versioned `Accept` header for stable responses.

## Sources
- 0x: https://0x.org/docs/api , https://0x.org/docs/upgrading/upgrading_to_swap_v2
- 1inch: https://portal.1inch.dev/documentation , https://business.1inch.com/pricing
- OpenOcean: https://apis.openocean.finance/developer/apis/swap-api/api-v4
- Jupiter: https://developers.jup.ag/docs/price , https://portal.jup.ag/api-keys
- ParaSwap/Velora: https://developers.velora.xyz/ , https://help.paraswap.xyz/en/articles/6570059-paraswap-api
- KyberSwap: https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator/aggregator-api-specification
- DefiLlama: https://api-docs.defillama.com/ , https://docs.llama.fi/coin-prices-api
- GeckoTerminal: https://api.geckoterminal.com/docs/index.html , https://apiguide.geckoterminal.com/faq
- DEXScreener: https://docs.dexscreener.com/api/reference
- CoinGecko: https://www.coingecko.com/en/api/pricing , https://support.coingecko.com/hc/en-us/articles/4538771776153
- Birdeye: https://docs.birdeye.so/docs/pricing , https://docs.birdeye.so/docs/rate-limiting
- GMGN: https://docs.gmgn.ai/index/cooperation-api-integrate-gmgn-solana-trading-api , https://github.com/GMGNAI/gmgn-skills
- Ankr: https://www.ankr.com/rpc/ , https://www.ankr.com/docs/rpc-service/service-plans/
- dRPC: https://drpc.org/docs/howitworks/ratelimiting , https://drpc.org/docs/pricing/requests
- PublicNode: https://publicnode.com/
- 1RPC: https://docs.1rpc.io/ , https://docs.1rpc.io/using-the-web3-api/networks
- LlamaNodes: https://llamanodes.com/public-rpc
- Blast: https://blastapi.io/ (deprecation notice)
- Covalent/GoldRush: https://goldrush.dev/docs/skills/goldrush-foundational-api/references/integration-guide/
- Moralis: https://docs.moralis.com/web3-data-api/evm/reference/rate-limits , https://moralis.com/pricing/
- The Graph: https://thegraph.com/docs/en/subgraphs/billing/
- Bitquery: https://bitquery.io/pricing , https://docs.bitquery.io/
- Dune: https://docs.dune.com/api-reference/overview/billing , https://dune.com/pricing
- Goldsky: https://docs.goldsky.com/pricing/summary
- Alchemy: https://www.alchemy.com/pricing , https://www.alchemy.com/support/free-tier-details
- Etherscan V2: https://docs.etherscan.io/v2-migration , https://info.etherscan.com/etherscan-api-v2-multichain/
- Helius: https://www.helius.dev/pricing , https://www.helius.dev/docs/billing/rate-limits
- Triton: https://triton.one/pricing
- Solana public RPC: https://solana.com/docs/references/clusters
