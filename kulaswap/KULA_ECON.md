# KULA economics — the deflationary loop (sinks + protocol-owned-liquidity floor)

> Operator: **"we don't want KULA to just be an inflation token."** This doc + `kula-econ.mjs`
> turn the one-directional emission loop into a utility-backed loop with real KULA **sinks** and a
> protocol-owned-liquidity (**PoL**) **floor** that grows on its own.
>
> **Naming (2026-06-17):** the LP-reward *token* you earn-then-burn is now **SOMA** (was "PoL"). The
> *floor* concept here — "protocol-owned liquidity (PoL)" — keeps its name; only the token is SOMA. AGNI is
> reserved for the future Burn Mines. veKULA boosts the SOMA-lotto burn on a TerraCore-SCRAP DR curve.

## The problem (the loop today)

```
provide liquidity ──► earn PoL (PoLToken.sol, an emission reward token)
                          │
                          ▼
                   MultiBurnMine.mine(PoL)  ──► burns PoL, MINTS KULA   (kulaOut = polIn·num/den)
```

PoL is burned, but **KULA is only ever minted** — there is no matching KULA sink. Net KULA supply
only goes up. That is pure inflation. Burning PoL does nothing for KULA's supply; PoL is just the
emission rail.

## The fix — make every KULA *use* a sink, and route value into a locked floor

Net circulating-supply change per epoch:

```
Δ KULA(circulating) = EMITTED − BURNED − BOUGHT_BACK_AND_LOCKED
```

- **EMITTED** — `MultiBurnMine` (PoL→KULA) + any farm/gauge emission.
- **BURNED** — KULA destroyed by uses: swap fees (`FeeCollectorBurner`), app/usage (`UsageBurn`),
  community buyback in BURN mode (`CommunityBuybackVault`), receipts (`ProofOfBurnRegistry`).
- **BOUGHT_BACK_AND_LOCKED** — `CommunityBuybackVault` buys KULA on the AMM and LPs it into
  **protocol-owned liquidity**, then `LiquidityLocker` locks the LP **permanently**. Not destroyed,
  but removed from float forever — and it builds a price floor.

When `BURNED + BOUGHT_BACK ≥ EMITTED`, KULA is **flat or deflationary** and **utility-backed**, not
inflationary. The model (`kula-econ.mjs`) proves this and lets you tune the percentages first.

### The PoL floor

The protocol owns locked KULA/quote liquidity. The conservative floor each circulating KULA can
claim against the protocol's **own** quote reserves:

```
floor = polReserveQuote / circulatingKula
```

Locked liquidity can't be rugged, and buyback+lock keeps **adding** quote-backed liquidity while
burns **shrink** circulating supply — so the floor compounds upward from both sides.

## Sample simulation (from `kula-econ.mjs`, proven in tests)

12 epochs, start 2,000,000 KULA circulating. Emit 100k KULA/epoch (PoL→KULA). Each epoch ~250k KULA
of *uses* flow through the policy: **50% burn / 30% buyback+lock / 20% treasury** → 125k burned +
75k locked = **200k sinks vs 100k emission** → **−100k net/epoch**.

| epoch | circulating supply | PoL floor (quote/KULA) |
|------:|-------------------:|-----------------------:|
| 1     | 1,900,000          | 0.0039 |
| 6     | 1,400,000          | 0.0321 |
| 12    | 800,000            | 0.1125 |

End: supply **2.0M → 0.8M** (deflationary, −1.2M), floor **~$0.004 → ~$0.11** (grew ~28×).
With **no sinks** the same emission takes supply to **3.2M** with a **$0 floor** — exactly the
inflation token to avoid.

## Contract wiring — which role/call connects to what

```
                          ┌─────────────────────────────────────────────┐
   swap fees (KULA) ─────►│ FeeCollectorBurner.sweep()  → KULA.burn()    │ ── BURN
   app/usage (KULA) ─────►│ UsageBurn.use(amt,ref)      → burnFrom       │ ── BURN
   burn receipts   ─────►│ ProofOfBurnRegistry.recordBurn → burnFrom    │ ── BURN
                          └─────────────────────────────────────────────┘
   curation/witness/fee
   revenue (tokenIn) ───► CommunityBuybackVault.buyback(path,minOut,dl)
                              │  swapExactTokensForTokens on UniswapV2Router (PRANA AMM)
                              │  ─ BURN mode      → KULA.burn(amountOut)            ── BURN
                              │  ─ DISTRIBUTE mode→ send KULA to PoL adder, then:
                              ▼
                          Router.addLiquidity(KULA, quote) ──► LP tokens
                              │
                              ▼
                          LiquidityLocker.lock(LP, amount, farFutureUnlock, owner)  ── PoL FLOOR (permanent)

   PoL token ───► MultiBurnMine.mine(PoL)  → KULA.mint  (EMISSION — the only mint into KULA)
```

Roles / calls to connect:

| Connection | Role / call |
|---|---|
| `MultiBurnMine` mints KULA | `KULA.grantRole(MINTER_ROLE, MultiBurnMine)` — the **only** KULA minter besides the (timelock) admin |
| `FeeCollectorBurner` burns KULA | constructed with `token = KULA`; KULA fees routed to its address; anyone calls `sweep()` (it `burn`s its own balance — no role needed, KULA is ERC20Burnable) |
| `UsageBurn` burns KULA | constructed with `token = KULA`; user `approve`s it, then `use(amount, ref)` (`burnFrom`) |
| `ProofOfBurnRegistry` burns KULA | user `approve`s it, then `recordBurn(KULA, amount, ref)` (`burnFrom`) |
| `CommunityBuybackVault` (BURN mode) | `tokenOut = KULA` (ERC20Burnable); `KEEPER_ROLE` → keeper bot/DAO; `buyback()` swaps revenue→KULA then `burn`s it |
| `CommunityBuybackVault` (DISTRIBUTE→PoL) | DISTRIBUTE to a PoL adder that `addLiquidity(KULA, quote)` then `LiquidityLocker.lock(...)` with a far-future unlock |
| `KULA` mint guardrail | `DEFAULT_ADMIN_ROLE` + `PAUSER_ROLE` → DAO timelock/multisig; revoke admin's standalone `MINTER_ROLE` so emission is policy-only |

### Recommended params (testnet starting point — tune in `kula-econ.mjs` first)

- **Use-policy split:** `burnBps = 5000` (50% burn), `buybackBps = 3000` (30% buyback+lock),
  remainder 20% to treasury. This is the proven net-deflationary point in the sim.
- **MultiBurnMine PoL→KULA ratio:** size `num/den` so per-epoch KULA emission ≤ expected per-epoch
  use volume × (burnBps+buybackBps). Sim guidance: keep `emitted ≤ 0.8 × (burned+boughtBack)` for a
  durable downtrend with headroom.
- **Lock duration:** `LiquidityLocker` unlock time = effectively permanent (e.g. 100 years); the PoL
  floor is only credible if it can't be withdrawn. Extend-only by design.
- **Buyback cadence:** keeper triggers `buyback()` each epoch with a slippage-guarded `minOut` from
  `quoteBuyback(path)`.
- **KULA cap:** keep `ERC20Capped` cap finite; with net-deflation the cap is a ceiling never approached.

## Activation steps (on-chain, concise)

Existing on PRANA testnet: `KULA 0x4c58…8029`, `PoL 0x5FbD…0aa3`, `MultiBurnMine 0x1291…C274`,
Router `0xCf7E…0Fc9`, Factory `0x9fE4…fa6e0` (`kula-config.mjs`).

1. **Deploy the sinks** (constructor arg = KULA address, ERC20Burnable):
   `FeeCollectorBurner(KULA)`, `UsageBurn(KULA)`, `ProofOfBurnRegistry()` (token passed per call).
2. **Deploy `CommunityBuybackVault`**(`admin=timelock`, `keeper=keeperBot`, `router=PRANA Router`,
   `tokenIn=revenue token`, `tokenOut=KULA`, `mode=Burn` to start, `communityRecipient=PoL adder`).
3. **Deploy `LiquidityLocker`** (no args) for permanent PoL locks.
4. **Roles:** `KULA.grantRole(MINTER_ROLE, MultiBurnMine)`; set `DEFAULT_ADMIN_ROLE`/`PAUSER_ROLE`
   to the DAO timelock; **revoke** the deployer's standalone `MINTER_ROLE` so KULA can only be
   minted by the burn-mine policy.
5. **Route KULA fees** to `FeeCollectorBurner` (AMM/protocol fee sink) and wire app usage to
   `UsageBurn`. Schedule a keeper to call `FeeCollectorBurner.sweep()` and
   `CommunityBuybackVault.buyback()` each epoch.
6. **Seed PoL:** first `buyback()` runs in DISTRIBUTE→`addLiquidity(KULA,quote)`→`LiquidityLocker.lock`
   with a far-future unlock, establishing the initial floor.
7. **Tune** `burnBps`/`buybackBps`/MultiBurnMine ratio with `simulate(...)` until
   `summary.deflationary === true` and `summary.floorGrew === true` at expected volumes, then pin the
   on-chain ratios.

## Files

- `kula-econ.mjs` — `netKulaFlow`, `applyUsePolicy`, `polFloorPrice`, `isDeflationary`, `simulate`.
- `kula-econ.test.mjs` — proves sinks → flat/deflationary supply + a growing PoL floor (13 tests).
- `kula-farm.mjs` — emission split / APR / ve-lock / burn-PoL→KULA (the emission side this offsets).
