# Stablecoin Mechanisms, and the "Dollar-Token Gap" on a Social Chain

*Educational corpus — neutral and sourced. Nothing here is investment advice, a solicitation,
a price prediction, or a promise of return or redemption. It is a primer on how dollar-pegged
tokens are built, why each design succeeds or fails, and where the MELEK ecosystem's missing
stable unit sits in that landscape.*

---

## Why a "dollar token" exists at all

A blockchain's native coin is usually **volatile**: its price against the dollar moves constantly.
That makes it a poor *unit of account* — a bad thing to quote a price in, pay a wage in, or hold
savings in — even if it is a fine speculative or governance asset. A **stablecoin** is a token
engineered to hold a steady value (almost always ~1 US dollar) so people have something stable to
**price, pay, earn, and save** in, without leaving the chain.

The companion article `sbd-the-steem-dollar.md` covers one specific attempt (Steem's SBD). This
article steps back to the general design space so it is clear *why* the MELEK ecosystem should fill
its dollar-token gap with **collateral**, not with SBD's fragile conversion-peg.

## Soft peg vs hard peg

- **Hard peg:** the issuer commits to redeem the token for the reference asset **1:1, on demand, at
  full value**, and holds enough of that asset to do so. A well-run fiat-backed coin approximates a
  hard peg (redeem 1 token → \$1 in a bank). The peg is only as hard as the reserves and the
  redemption right are real.
- **Soft peg:** the protocol only *nudges* the price toward the target with incentives and partial
  guarantees — it may defend one side (a floor) but not the other (a ceiling), or defend both only
  within a solvency band. SBD was a **soft peg with a floor and no ceiling**, which is exactly why it
  spiked far above \$1 in speculative runs.

A soft peg is cheaper and more permissionless to run; a hard peg is stronger but demands real,
auditable backing and usually a regulated redemption path.

## The three families of stablecoin design

### 1. Fiat-backed (custodial reserves)
One dollar (or a cash-equivalent) is held in reserve for each token; the issuer mints on deposit and
redeems on withdrawal. **Strength:** strongest, simplest peg when reserves are genuine and liquid.
**Weakness:** centralized and custodial — the peg depends on the issuer's honesty, its bank, and its
solvency; if reserves are impaired or frozen, the peg breaks (a fiat-backed coin has depegged in
practice when its reserve bank came under stress).<ref>https://www.cnbc.com/2023/03/11/stablecoin-usdc-breaks-dollar-peg-after-firm-reveals-it-has-3point3-billion-in-svb-exposure.html</ref>
**Regulatory reality:** this is money-transmission / e-money territory and requires licensing and
legal review — it is not something a community protocol can casually "turn on."

### 2. Crypto-collateralized (overcollateralized CDP)
The token is minted only against **more than a dollar** of on-chain collateral locked in a smart
contract. The canonical example is a **CDP (Collateralized Debt Position)** / vault system — the
MakerDAO/DAI model: lock, say, \$150+ of crypto, mint up to \$100 of the stable; repay to unlock;
if the collateral value falls toward the debt, the position is **liquidated** to keep the system
solvent. **Strength:** decentralized, transparent, no custodial reserve, and — crucially — a
**hard solvency floor** because every token is over-backed by real locked value. **Weakness:**
capital-inefficient (you must lock more than you mint), exposed to collateral crashes and oracle
failure, and it can wobble in a sharp sell-off if liquidations lag. This is the family SBD *tried*
to approximate (SBD is "backed by STEEM equity") but did **undercollateralized and with a print/
haircut instead of per-position liquidation** — which is why it was fragile.

### 3. Algorithmic / seigniorage (little or no collateral)
The peg is held purely by supply-and-demand incentives and, often, a **paired volatile token** that
absorbs volatility (mint the stable by burning the volatile token, and vice versa). **Strength:**
capital-efficient — no locked reserve. **Weakness — the death spiral:** if confidence drops, the
stable falls below \$1, the mechanism prints ever more of the paired token to defend it, that token's
price collapses, which destroys the very backing the peg relied on, and both go to zero. This is not
hypothetical: a large algorithmic stablecoin and its paired token collapsed from tens of billions of
dollars to near-zero in days in 2022 (the TerraUSD/LUNA failure), the reference case for why
**purely algorithmic pegs are considered structurally unsafe.** SBD is not purely algorithmic — it has
STEEM equity behind it — but it shares the algorithmic family's core hazard: the peg leans on the
market value of another volatile asset the protocol itself influences.

## Where SBD sat, in one line

SBD was a **soft-pegged, chain-equity-backed, undercollateralized token with a conversion floor, no
ceiling, and a solvency haircut** — closer to the algorithmic family in its risks than to a true
overcollateralized CDP, and nowhere near fiat-backed. It solved "a stable unit on a volatile chain"
just well enough to be useful, and just poorly enough to spike to \$12+ and to require constant
witness governance.

## The trade-off table

| Design | Backing | Peg strength | Main failure mode | Decentralized? | Regulatory load |
|---|---|---|---|---|---|
| Fiat-backed | \$1 cash-equiv reserve | Strongest (if reserves real) | Reserve/bank impairment; freeze | No | High (money transmission) |
| Overcollateralized CDP | >\$1 crypto locked per token | Strong solvency floor | Collateral crash + slow liquidation; oracle failure | Yes | Medium — still counsel-dependent |
| Algorithmic / seigniorage | Little/none; paired volatile token | Weakest | **Death spiral** | Yes | High + reputationally toxic |
| SBD (Steem) | Chain equity (STEEM), undercollateralized | Soft floor, no ceiling | Above-peg spikes; haircut on debt | Yes | (n/a — never fiat-redeemable) |

## The MELEK "dollar-token gap"

The MELEK chain (a Blurt-lineage fork) deliberately carries **no SBD-style dollar** — see
`sbd-the-steem-dollar.md`. That is a clean simplification for the social layer, but it leaves the
ecosystem with **no stable unit of account**: no native way to quote a price, pay a predictable
amount, or hold value without riding MELEK's volatility.

The honest conclusion from the design space above: if you are going to reintroduce a dollar unit, the
**overcollateralized CDP family is the right one** — it gives a real solvency floor (unlike SBD's
undercollateralized soft-floor), it is decentralized and transparent (unlike fiat-backed custody), and
it avoids the algorithmic death spiral. It is capital-inefficient and needs a sound oracle and
liquidation engine, but those are *engineering* costs, not *structural* fragility.

How the MELEK/PRANA ecosystem intends to fill this gap — using the KULA CDP that already exists in the
PRANA repo, with an explicit compliance line (utility token, never marketed as an investment or as
"asset-backed/SEC-registered") — is the subject of the private design note
`.local/PRANA_STABLECOIN_SBD_REPLACEMENT.md`.

---

### Sources

- USDC depeg during the SVB bank stress (fiat-backed failure mode) — https://www.cnbc.com/2023/03/11/stablecoin-usdc-breaks-dollar-peg-after-firm-reveals-it-has-3point3-billion-in-svb-exposure.html
- MakerDAO/DAI CDP model — general reference for overcollateralized stablecoins (project note: `kula-defi-token-design`, which mirrors the MakerDAO/SBD model)
- TerraUSD/LUNA 2022 collapse — reference case for the algorithmic "death spiral" (widely documented; cited here as the canonical algorithmic-failure example, general knowledge)
- Companion article: `sbd-the-steem-dollar.md` (SBD mechanism, sources therein)
- @lukestokes, "Should SBD Be a Pegged Asset?" (soft-peg / floor-only discussion) — https://steemit.com/sbd/@lukestokes/should-sbd-be-a-pegged-asset-if-so-when-should-we-peg-it
