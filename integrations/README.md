# `integrations/` — watching the trade bot & feeding the AIs

## In one sentence (for Ryan)

These tools **watch what the trade bot actually did** (on the chain, no keys, no trading), **check it against the live market two ways**, find what's bleeding money vs. what's working, and hand a **cleaned-up summary to the annal/brief-writing AIs on Server 4** — so the AIs can talk about the trade bot from real numbers instead of guessing. Nothing here can spend money, place a trade, or touch a private key. It only reads and reports.

What it found on the real account right now: **SWAP.LTC lost ~6,400 HIVE** (pure bleed — stop trading it), while **SWAP.BLURT (+6,280) and SWAP.DOGE (+1,250)** are where the profit came from (keep those). The two coins we issue (VKBT, CURE) are mostly held by us with almost no outside buyers — the "price push" is the bot trading with itself.

---

## The idea: two Ways, one boundary

- **Way 1 — what the bot did.** Reconstruct the account's real on-chain trade history and P&L (`tradebot-forensics.mjs`, `timeline.mjs`).
- **Way 2 — what the market says now.** Live order books, prices, ownership, arbitrage (`hive-engine-market.mjs`, `market-depth.mjs`, `arb-scanner.mjs`, `price-oracle.mjs`).
- **The base chain.** A steemd-style explorer for accounts/blocks/witnesses, ready to point at MELEK (`chain-explorer.mjs`).
- **The boundary.** Raw private data is processed by *our* tools first; only a **sanitized, rounded, secret-scrubbed copy** ever crosses to the external API AIs (`trade-sanitizer.mjs` → `publish-feed.mjs`). The external AIs never see raw balances or anything key-shaped.

```
forensics + market + arb + depth + chain  ──►  analyzer  ──►  digest (RAW, internal)
                                                                   │
                                                          trade-sanitizer (scrub + round)
                                                                   │
                                                          publish-feed  ──►  Server 4 brain
                                                                              (annal/brief AIs read here)
```

## Files

| File | What it does |
|---|---|
| `watchlist.mjs` | One place to set watched tokens / accounts / thresholds (env-overridable). |
| `he-client.mjs` | Resilient HIVE-Engine client (multi-node failover, timeouts). |
| `tradebot-forensics.mjs` | **Way 1**: on-chain P&L reconstruction per token. |
| `timeline.mjs` | Cumulative P&L over time — *when* the bleed/gains happened. |
| `hive-engine-market.mjs` | **Way 2**: live books, fills, supply, holders for any token. |
| `market-depth.mjs` | Whale concentration + buy/sell walls for the issued tokens. |
| `price-oracle.mjs` | Outlier-rejected median USD price across several sources. |
| `arb-scanner.mjs` | Depth-aware arbitrage — only flags edges you can actually execute. |
| `trade-analyzer.mjs` | Fuses it all into ranked findings + concrete suggestions. |
| `chain-explorer.mjs` | Steemd-style base-chain explorer (MELEK-ready). |
| `digest.mjs` | One annal-ready digest combining everything. |
| `trade-sanitizer.mjs` | **The boundary** — scrubs secrets, rounds figures, refuses to leak. |
| `publish-feed.mjs` | Delivers the sanitized feed to the Server 4 brain inbox. |
| `free-apis.mjs` | ~64 keyless public APIs, smoke-tested. |
| `API_CATALOG.md` / `HIVE_STEEM_BOTS.md` | What APIs exist + chain bot-building references. |

## Run it

```bash
npm run trade:feed        # full pipeline: digest → sanitize → publish (the everyday command)

npm run trade:forensics   # Way 1 — what the bot did
npm run trade:market      # Way 2 — live market
npm run trade:arb         # depth-aware arbitrage scan
npm run trade:timeline    # P&L over time
npm run trade:chain account kalivankush   # base-chain explorer
npm run trade:digest      # the combined annal-ready digest
npm run apis              # smoke-test the keyless APIs
npm test                  # the integration tests (boundary + arb logic)
```

## Cadence (how the AIs consume it)

Two firing patterns, same output either way (`[[resource-timing-tiers-annal-brief]]`):

1. **Batch — 1–2× / day before the 12&12 conference.** Run `npm run trade:feed`; the sanitized feed lands in the brain so the briefs are built on fresh diagnostics.
2. **Just-in-time — before annaling a specific file**, fire the one reader that gives data the batch didn't (e.g. `trade:arb` right before writing about arbitrage).

To deliver to the brain, set `BRAIN_SSH` and `BRAIN_INBOX` in your environment (the real host alias + inbox path are operator infra — keep them in `.local`/the shell, not in tracked files). Without them, `publish-feed` stages to `.local/outbox/` only.

## Safety

- **Read-only. No keys. No trading.** Every tool only reads public chain/market data.
- **The boundary is enforced twice** — the sanitizer scrubs and the publisher re-checks, refusing to deliver if any secret shape survived (`[[feedback-zero-wif-in-bot-repo]]`).
- Outputs go to `.local/` (gitignored); only the sanitized feed crosses to the external AIs.
