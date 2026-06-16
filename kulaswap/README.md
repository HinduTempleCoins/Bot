# KulaSwap — frontend (multi-chain swap)

KulaSwap is the MELEK ecosystem's swap UI. The **AMM engine itself is already built** (Uniswap-V2
contracts in the **PRANA** repo: `contracts/contracts/amm/`); this directory is the **front-end** that
talks to it — and to the existing chains' DEXes where the ecosystem's tokens already trade.

> The old contents of this repo (a 2019 tronbox TRON↔BSC bridge, never deployed) are **superseded** by
> PRANA's contracts and are being retired in favor of this front-end. The **name** stays KulaSwap.

## What's here (foundation)
- **`kula-config.mjs`** — multi-chain registry:
  - **EVM** (Uniswap-V2 ABI + cp-amm math apply directly): **PRANA** (KulaSwap, chainId 108369),
    **Ethereum** (Uniswap V2), **Polygon** (QuickSwap), **BSC** (PancakeSwap, 0.25%), **Avalanche** (Trader Joe).
  - **Non-EVM** (need their own adapter): **TRON** (SunSwap, TronWeb), **EOS** (Defibox, eosjs).
  - Only router/factory addresses I'm certain of are hardcoded; the rest are placeholders. `chainReady()`
    refuses to swap on any chain whose addresses aren't verified — **a wrong router address loses funds.**
- **`kula-quote.mjs`** — browser-safe constant-product quote math (vendored from Bot `cp-amm.mjs`):
  `getAmountOut/getAmountIn/spotPrice/priceImpact/quoteSwap`.
- **`kula-quote.test.mjs`** — offline tests (math, multi-chain config, browser-safety guard).

## Still to build
- The swap **UI** (`index.html` + `app.mjs`): wallet connect (MetaMask for EVM), token pickers, live
  quote (reserves → cp-amm), `swapExactTokensForTokens` via the chain's Router, slippage + deadline.
- **PRANA** addresses: fill `router/factory/wnative` after `DeployAmm.s.sol` runs on PRANA.
- **TRON / EOS** adapters (TronWeb / eosjs) — listed but gated until built.
- Liquidity (add/remove) + farms UI (PRANA gauges).

## KULA economics (sinks + PoL floor)
- **`kula-econ.mjs`** + **`KULA_ECON.md`** — turns the emission-only loop (PoL→KULA mint) into a
  net-deflationary, utility-backed loop: every KULA *use* routes to BURN and/or buyback→protocol-owned
  liquidity→permanent lock, so emission is offset/exceeded and a price **floor** grows. Pure model:
  `netKulaFlow`, `applyUsePolicy`, `polFloorPrice`, `isDeflationary`, `simulate`. Wiring + activation
  steps in `KULA_ECON.md`.

## Test
`node --test kulaswap/kula-quote.test.mjs`
`node --test kulaswap/kula-econ.test.mjs`
