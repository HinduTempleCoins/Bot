# KULA DeFi — lock KULA → borrow wMELEK (the CDP)

**The keystone KULA sink + utility.** To borrow MELEK on PRANA you must *acquire KULA and lock it*.
Locked KULA leaves circulation for as long as the loan is open — so lending demand is a structural,
ongoing buy-and-hold sink for KULA, distinct from the burn/PoL sinks in `kula-econ.mjs`.

This is a CDP (collateralized debt position), the Maker/Aave overcollateralized model — **not** an
algorithmic peg. The safety is the collateral cushion (the borrowed wMELEK is always backed by
worth-more KULA), never a thin token backing loans (the Terra/Luna spiral).

## The flow

1. **Lock** — `approve` the vault to pull KULA, then `CDPVault.deposit(amount)`. KULA is custodied by
   the vault; it leaves your wallet and the circulating float.
2. **Borrow** — `CDPVault.borrow(amount)` mints **wMELEK** to you, up to `maxLTV` of the KULA's
   oracle value. wMELEK is the PRANA-side wrapper of MELEK (`0x4C4a2f8c81640e47606d3fd77B353E87Ba015584`).
3. **Repay** — `approve` the vault for wMELEK, then `CDPVault.repay(amount)`. The vault **burns** the
   wMELEK and reduces your debt. Repay debt + accrued interest to fully clear.
4. **Withdraw** — `CDPVault.withdraw(amount)` returns freed KULA once the remaining debt stays within
   LTV.
5. **Liquidate** — if KULA falls so the position's health factor drops below 1, anyone can liquidate:
   repay (part of) the debt and seize collateral at a bonus. Run by `CollateralLiquidationEngine`
   (Aave-style partial liquidations) on a `CDPVaultV2`, or the base `CDPVault.liquidate(user)`
   (full-close) on the plain vault.

## Parameters (off-chain mirror in `kula-cdp.mjs` → `DEFAULT_CDP`)

| Param | Default | Meaning |
|---|---|---|
| `maxLtv` | 0.50 | Borrow up to 50% of the locked KULA's value. Lock $100 of KULA → borrow ≤ $50 of wMELEK. On-chain: `CDPVault.maxLTV` (1e18-scaled). |
| `liqRatio` | 0.60 | Liquidation threshold. HF crosses 1 once debt value exceeds 60% of collateral value. The gap (0.50→0.60) is the borrower's safety buffer before liquidation. |
| `ratePerYear` | 0.05 | 5% APR stability fee accrued on the wMELEK debt (simple, per-second linear). |
| `liqBonusBps` | 1000 | 10% collateral bonus the liquidator seizes over the repaid value. Enforced by `CollateralLiquidationEngine.liquidationBonusBps`. |

> The base `CDPVault` enforces only `maxLTV` (its `healthFactor` uses `maxBorrow`, i.e. `liqRatio == maxLtv`).
> A distinct, higher `liqRatio` (the buffer) is implemented by deploying the vault's `maxLTV` at the
> **liquidation** ratio and treating the lower `maxLtv` as the borrow-time cap the UI enforces — OR by
> using a vault variant with a separate liquidation threshold. The `kula-cdp.mjs` math takes both as
> explicit params so the UI and the engine can use the buffer model; pick the on-chain wiring to match
> (see Activation).

## The math (`kula-cdp.mjs`, pure, offline, soft-fail)

- `maxBorrow = collateralKula · kulaPrice · maxLtv / melekPrice` (wMELEK borrowable)
- `healthFactor = (collateralKula · kulaPrice · liqRatio) / (debtMelek · melekPrice)` — >1 safe, <1 liquidatable, no debt → ∞
- `liquidationPrice = (debtMelek · melekPrice) / (collateralKula · liqRatio)` — the KULA price at which HF = 1
- `accrueInterest = debt · ratePerYear · seconds / 31,536,000` (simple interest)

**Worked example.** Lock **10,000 KULA** at **$0.05** (collateral value **$500**), wMELEK at **$0.50**,
`maxLtv 0.50`, `liqRatio 0.60`:
- Max borrow = `10000·0.05·0.5 / 0.50` = **500 wMELEK** ($250 — 50% LTV of $500).
- Borrow the full 500 → health factor = `(500·0.6)/(250)` = **1.20** (safe).
- Liquidation KULA price = `(500·0.50)/(10000·0.6)` = **$0.04166667**. If KULA falls to ~$0.0417 the
  position becomes liquidatable.
- 30 days of 5% APR on the 500 wMELEK debt = **2.0548 wMELEK** interest (repay 502.05 to clear).

## Oracle

The vault prices collateral via a `price(address) → uint256` view (1e18-scaled). Two options:

- **`ChainlinkPriceAdapter`** — production. Each token → an AggregatorV3 feed + a per-feed staleness
  window; reads are guarded (positive answer, complete round, not stale). Use when a KULA/USD (and
  wMELEK/USD) feed exists.
- **The KULA/wMELEK AMM pair** (`amm/UniswapV2Pair` via the KulaSwap router/factory) — bootstrap. A
  TWAP over the pair (`TWAPOracle.sol`) gives a manipulation-resistant on-chain price before external
  feeds exist. The liquidation engine reads through an `IStalePriceOracle` (`priceWithTimestamp`) and
  rejects prices older than `maxPriceAge`.

For testnet, `SimplePriceOracle` (role-fed) is the stand-in; swap in the TWAP/Chainlink adapter for
mainnet — same `price()` interface, no vault change.

## How it sinks KULA

- **Locked collateral** is held by the vault for the loan's life — direct, ongoing removal from float.
- **Overcollateralization** (≤50% LTV) means every borrowed wMELEK locks ≥2× its value in KULA.
- Borrowing demand for wMELEK ⇒ demand to acquire-and-lock KULA. This is the *utility* sink (you can't
  borrow without it), complementing the *deflationary* burn sinks (`kula-econ.mjs`).

## On-chain wiring / activation steps

All contracts already exist in `PRANA/contracts/contracts/`. Deploy + configure (PRANA, chainId 108369):

1. **wMELEK as the debt token.** The vault mints/burns its debt token, so wMELEK on PRANA must expose
   `mint(address,uint256)` (`IMintable`) and `ERC20Burnable.burn(uint256)`, and grant the **vault**
   minter authority (e.g. `MINTER_ROLE`). The bridge wrapper at
   `0x4C4a2f8c81640e47606d3fd77B353E87Ba015584` must be the mint/burn-capable wMELEK (confirm it
   exposes mint/burn and that the vault — not just the bridge — can mint, or deploy a CDP-specific
   wMELEK facade the bridge backs). **This is the load-bearing pre-step** — without vault mint rights,
   `borrow` reverts.
3. **Oracle.** Deploy/point a `price()` source for KULA (and for wMELEK if pricing in a third unit).
   Testnet: `SimplePriceOracle` (grant `FEEDER_ROLE`, push prices). Mainnet: `ChainlinkPriceAdapter`
   or the `TWAPOracle` over the KULA/wMELEK KulaSwap pair.
2. **Vault.** Deploy `CDPVault(collateral=KULA, debtToken=wMELEK, oracle, maxLTV)` — or `CDPVaultV2`
   (same + `admin`) for partial liquidations. KULA = `0x4c5859f0F772848b2D91F1D83E2Fe57935348029`.
   Set `maxLTV` to the **liquidation** ratio (0.60e18) if using the buffer model and letting the UI cap
   borrows at 0.50; otherwise set it to 0.50e18 for a single-ratio vault.
4. **Liquidation engine (V2 only).** Deploy `CollateralLiquidationEngine(vault, stalePriceOracle,
   closeFactorBps, liquidationBonusBps=1000, dustThreshold, maxPriceAge)`, then call
   `CDPVaultV2.setLiquidationEngine(engine)` **once** (admin-only, then locked).
5. **Roles.** Grant the vault `MINTER_ROLE` on wMELEK. Grant the oracle feeder role to the price
   keeper. Revoke any deployer mint authority not needed.
6. **Front end.** `kula-cdp.mjs` builds the unsigned descriptors; wire the Borrow tab (below) to hand
   them to Akasha/MetaMask. The UI must enforce the borrow-time `maxLtv` cap (the vault enforces its
   own `maxLTV`; the UI's lower cap is the safety buffer).

## Tx descriptors (`kula-cdp.mjs`)

Unsigned descriptors `{ to, data, value:'0x0', method, chainId:108369 }`. The wallet signs; this repo
never signs or broadcasts. Verified keccak256 selectors:

| Builder | Call | Selector |
|---|---|---|
| `buildApproveTx({token, vault, amountBaseUnits})` | `ERC20.approve(vault, amount)` (to = token) | `0x095ea7b3` |
| `buildOpenVaultTx({vault, amountBaseUnits})` | `CDPVault.deposit(uint256)` | `0xb6b55f25` |
| `buildBorrowTx({vault, amountBaseUnits})` | `CDPVault.borrow(uint256)` | `0xc5ebeaec` |
| `buildRepayTx({vault, amountBaseUnits})` | `CDPVault.repay(uint256)` | `0x371fd8e6` |
| `buildWithdrawTx({vault, amountBaseUnits})` | `CDPVault.withdraw(uint256)` | `0x2e1a7d4d` |

`amountBaseUnits` is wei-scale (apply token decimals in the wallet layer). Deposit needs a prior KULA
approve; repay needs a prior wMELEK approve.

## UI

`renderLendFragment({ collateralKula, kulaPrice, melekPrice, maxLtv, liqRatio, onBorrow })` returns an
HTML string (all interpolation `esc()`'d) for the tokens portal / Akasha "Borrow" tab: a lock-KULA
input, the live max-borrowable wMELEK, health factor (color-coded), and liquidation price, plus a
"Lock & Borrow" button that calls the host's `onBorrow` global to hand the descriptor to the wallet.
