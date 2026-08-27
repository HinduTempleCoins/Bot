# KULA, the CDP, and the dollar-stable — MELEK's missing MBD

*Tier C · defi · KULA CDP · learn-and-earn*

Every other lesson in this track has been about trading. This one is about
*money* — specifically, the dollar-stable unit that MELEK is missing, and how
**KULA** and a **CDP** can supply it honestly. To see why it matters, we have to
tell a little chain history: the story of the Steem Dollar, why Blurt threw it away,
and why MELEK — a Blurt fork — has no dollar of its own. Then we will look at the
fix. This is design still being built on alpha infrastructure; treat the specific
numbers as unsettled and hold to the concepts.

## What you'll learn

- What SBD was on Steem, and how its ~$1 peg actually worked
- Why Blurt removed it, and why MELEK therefore has no MBD
- What a CDP is: locking KULA collateral to mint a dollar-stable
- Why collateral-backed money beats SBD's fragile conversion-peg — honestly

## A little history: SBD, and the missing MBD

Steem had two coins. STEEM, the volatile one — and **SBD**, the Steem Blockchain
Dollar, meant to hold about **one US dollar**. SBD was minted from author rewards,
and its soft peg worked by a promise: the chain would let you convert 1 SBD into a
dollar's worth of STEEM, at the witnesses' median price feed, over a few days. A
**debt-to-ownership "haircut"** protected the chain — once SBD owed too much against
STEEM's market value, the chain quietly paid rewards in STEEM instead of SBD to stop
over-issuing. It half-worked. The peg was soft with no hard ceiling, so in bull runs
SBD floated *far above* a dollar on pure speculation, and the whole mechanism was
fragile.

**Blurt** — the fork MELEK is built from — looked at that fragility and deliberately
**removed the dollar token** to keep things simple and author-friendly. So Blurt has
no BBD, and **MELEK, as a Blurt fork, has no MBD.** MELEK has no on-chain dollar, no
stable unit of account. That is a real gap, and it is the one this lesson fills.

## The fix: a CDP, backed by KULA collateral

Rather than revive SBD's fragile conversion-peg, the plan is to mint a dollar-stable
the modern, collateral-backed way — the MakerDAO pattern — using **KULA** as
collateral in a **CDP** (a collateralized debt position). The idea, in plain terms:

- You **lock KULA** (or other approved collateral) into a vault, and against it you
  **mint** a stable unit — a claim on real, locked value, not a promise from a price
  feed.
- The position is **overcollateralized**: you lock more value than you mint, so the
  backing survives a price dip.
- If your collateral falls too far, the position is **liquidated** — sold to cover
  the debt — which is what keeps every unit of the stable fully backed. That is the
  central risk to you as a borrower: **you can be liquidated**, so you watch your
  ratio.
- A **protocol-owned-liquidity floor** (the "PoL floor") stands underneath KULA
  itself, so the collateral has real support rather than pure emission.

Because every stable unit is backed by locked collateral that can be liquidated to
defend it, this is sturdier than SBD's soft feed-and-haircut peg — money backed by
what is actually locked, not by a conversion the chain merely promises.

## The honest line

The specific ratios, fees, and which token carries the stable are **still being
settled** — take no number here as final. And a hard rule: KULA and this stable are
**utility mechanisms**, never an investment. We do not, and you should not, call
them "asset-backed" or "SEC-registered" or anything that sounds like a return — that
is the Unicoin mistake, and regulators judge the substance, not the wrapper. There
is **no promise of returns** here: a CDP is a tool for minting a stable unit against
collateral you might lose, not a yield.

## Learn and earn — your reward

1. **Do one CDP action** on the testnet — lock a little KULA and mint a small amount
   of the stable, or just open the vault and read your collateral ratio.
2. **Note your liquidation price** — the level where the position would be sold.
3. **Post or comment**, tagged `melek-tutorial`, explaining in your own words why
   collateral-backed beats SBD's conversion-peg — and that a CDP can be liquidated.

Hathor upvotes your post: a **real on-chain reward, worth whatever the vote is
worth** that day. No draw, nothing to buy, and no promise of returns — the reward is
for understanding the mechanism, liquidation risk and all.

## You did it

You now know the one thing most MELEK users never learn: *why* the chain has no
dollar, and how collateral-backed money could give it one without SBD's fragility.
That is real monetary literacy, not just button-pushing.

Next: **The bridge** (lesson 29) — moving value between MELEK and PRANA, what
wrapping is, and the security posture of wMELEK.
