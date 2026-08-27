# The Steem Dollar (SBD): How a Blockchain Tried to Print a Stable Dollar

*Educational corpus — neutral and sourced. Nothing here is investment advice, a price
prediction, or a yield promise. This article describes a historical mechanism on the Steem
blockchain and why the MELEK chain (a Blurt-lineage fork) does not carry it.*

---

## What SBD was

**SBD** stands for **Steem Blockchain Dollar** (earlier and colloquially "Steem Dollars" or
"Steem-Backed Dollars"). It was a second native token on the Steem blockchain, alongside the
volatile base coin **STEEM**, designed to hold a **soft peg of roughly one US dollar**. Its
purpose was to give creators and users a *stable unit of account* on a chain whose base coin
price swings wildly — you could be paid, price things, and hold value in something that aimed
to stay near \$1 rather than riding STEEM's volatility.

SBD was **not** fiat-backed and held no dollars in reserve. It was backed only by the promise
of the blockchain itself to convert it, on demand, into **one dollar's worth of STEEM** — a
claim on the chain's own equity (its STEEM supply). That single design choice is the source of
both its usefulness and every weakness below.

## How SBD was created — from author rewards

SBD did not come from a sale or a mint button. It was **printed as part of post rewards**.

When a Steem post paid out, the reward pool first took a curator cut (historically ~25%; the
rest went to the author).<ref>https://steemit.com/steem/@briggsy/for-dummies-how-steem-post-payout-s-work</ref>
The author's share was then split. The **default option was 50% Steem Power + 50% SBD**: half
the author reward was paid as staked STEEM (Steem Power, vested and locked), and half was paid
as freshly-created SBD.<ref>https://steemit.com/steem-help/@sykochica/answering-common-questions-should-i-use-100-steem-power-or-50-50-payouts-for-my-post</ref>
Authors could instead choose **100% Power Up** (the entire reward as Steem Power, no SBD) or
**Decline Payout** (no reward).<ref>https://steemit.com/steemit/@bigdeej/rewards-and-steemit-100-50-50-or-decline-payment</ref>

So the SBD supply grew every time content paid out under the default split. This ties directly
into the solvency problem: the chain was *manufacturing dollar-denominated debt against itself*
each payout cycle.

## The peg mechanism — a conversion floor at the witness price feed

The peg was maintained by a **one-way conversion right**: any holder could burn 1 SBD and, after
a delay, receive **\$1 worth of STEEM** minted at the blockchain's price.

- **The price feed.** Steem's ~21 elected **witnesses** each publish a STEEM/USD price. The chain
  does not trust any single feed: every 21-block round it takes the **median** of the witnesses'
  feeds, pushes it onto a queue, and uses the **median of that queue** (a median-of-medians) for
  all conversions.<ref>https://www.steem.center/index.php?title=Steem_Dollar_(SBD)</ref>
- **The delay.** Conversion is deliberately slow. It was **7 days** originally
  (`STEEM_CONVERSION_DELAY_PRE_HF_16`) and was shortened at hardfork 16 to **3.5 days**
  (`STEEM_CONVERSION_DELAY = STEEM_FEED_HISTORY_WINDOW hours`, i.e. 84 hours ≈ 3.5 days). The
  delay means an attacker would need to corrupt the median feed for the entire window — roughly
  "51% of witnesses colluding for 3.5 days" — to move the conversion rate meaningfully.<ref>https://raw.githubusercontent.com/steemit/steem/master/libraries/protocol/include/steem/protocol/config.hpp</ref>
- **What conversion does to supply.** The STEEM handed to the converter is **newly minted**, so
  redeeming SBD **dilutes STEEM holders**. SBD is, in effect, a debt STEEM-holders collectively owe.

This is a **floor, not a wall**: it guarantees you can always get *at least* about \$1 of STEEM
out of an SBD, which props the price up when SBD trades below \$1. Nothing in the mechanism does
the reverse.

**Interest.** SBD held in the savings balance earned interest set by witnesses — the code default
was `STEEM_DEFAULT_SBD_INTEREST_RATE = 10% APR`, though witnesses later set it to 0.<ref>https://raw.githubusercontent.com/steemit/steem/master/libraries/protocol/include/steem/protocol/config.hpp</ref>

## The debt-to-ownership ratio and the "haircut"

Because every SBD is a dollar claim against the STEEM market cap, the chain must stay **solvent**:
the total SBD must never grow so large relative to STEEM's value that the chain cannot honor the
\$1 conversions. Steem enforces this with the **debt-to-ownership ratio** — SBD's share of the
"virtual supply" (STEEM market cap plus SBD) — and two throttles measured against it.

The exact constants (from Steem's `config.hpp`), and note they were **loosened across
hardforks**:<ref>https://raw.githubusercontent.com/steemit/steem/master/libraries/protocol/include/steem/protocol/config.hpp</ref><ref>https://www.steem.center/index.php?title=Steem_Dollar_(SBD)</ref>

| Threshold | HF14 era | HF20 era (current) | Behavior |
|---|---|---|---|
| **Start percent** | 2% | **9%** | SBD *print rate* begins throttling down |
| **Stop percent** | 5% | **10%** | SBD printing stops entirely; only STEEM is paid |

- **SBD_PRINT_RATE (the throttle).** Between the start and stop thresholds, the chain scales down
  the fraction of rewards paid as SBD from 100% toward 0, paying the remainder in STEEM/Steem Power
  instead. This is why authors sometimes noticed "less SBD, more STEEM" in payouts.<ref>https://steemit.com/steemit/@ausbitbank/why-am-i-getting-less-steem-dollars-and-more-steem-sbdprintrate-what-it-is-how-to-check-it-how-you-can-help-100-sp</ref>
- **The haircut (above the stop percent).** If the debt ratio still exceeds the stop percent
  (10% in the HF20 era), the chain **stops treating SBD as a full \$1 in conversions**. It caps the
  total SBD liability at that percentage of the STEEM market cap, so a converting holder receives
  **less than \$1 of STEEM** — the "haircut."<ref>https://steemit.com/steempeak/@steempeak/convert-to-steem-feature-aka-the-haircut</ref><ref>https://steemit.com/steem/@tcpolymath/math-of-steem-the-debt-ratio-and-the-haircut</ref>

*(Community write-ups sometimes cite the older 2%/5% figures and sometimes the 9%/10% figures; the
difference is the HF14→HF20 loosening above, not a contradiction. The 20%-of-market-cap "1% forced
conversion" number that circulates in some posts is a separate, more aggressive safety idea and is
flagged here as **not reliably part of the shipped mainnet path** — treat it as uncertain.)*

## The known weaknesses

1. **A floor with no ceiling.** The conversion right props SBD *up* toward \$1 but there is no
   symmetric mechanism to push it *down* to \$1. Steem's own white paper conceded that little could
   be done when SBD traded above \$1.<ref>https://steemit.com/sbd/@lukestokes/should-sbd-be-a-pegged-asset-if-so-when-should-we-peg-it</ref>
2. **Speculative blow-offs.** With only a floor, SBD became a speculative vehicle in bull runs. In
   December 2017 it traded as high as ~\$12–15, wildly detached from its \$1 target — the opposite of
   what a stable unit of account should do.<ref>https://steemit.com/sbd/@biophil/why-sbd-is-trading-so-high-and-how-you-can-help</ref>
3. **Peg fragility / the haircut cuts both ways.** The floor only holds if STEEM has real market
   value and the debt ratio is healthy. Once the debt ratio crosses the stop percent, the \$1 promise
   quietly becomes a *less-than-\$1* promise via the haircut — exactly when holders most want it to hold.
4. **"SBD print" games and governance overhead.** Feed timing, the print-rate throttle, savings-interest
   settings, and repeated "reverse peg" proposals meant SBD demanded constant witness attention and
   invited arbitrage rather than quietly being a dollar.<ref>https://steemit.com/witness-category/@reggaemuffin/witness-discussion-sbd-price-and-reverse-peg</ref>

The single sentence that captures it: **SBD was an algorithmic soft-peg backed by the chain's own
equity, with a floor but no ceiling and a solvency haircut** — not a fully-collateralized or
fiat-backed dollar.

## Why Blurt dropped it — and why MELEK has none

**Blurt**, a Steem/Graphene fork, deliberately **removed the backed-dollar token entirely** (there is
no "BBD"). The stated reasoning: the SBD machinery was needlessly complex, and paying authors only in
the single native **BLURT** coin is simpler and more author-friendly — no second token, no peg to
defend, no print-rate throttle, no haircut.<ref>https://steemit.com/@jacobgadikian</ref><ref>https://blurtwallet.com/faq.html</ref>

**The MELEK chain is a Blurt-lineage fork** (see the project's `melek-chain-no-blurt-fee` note), so it
inherits Blurt's model: it pays creators in the native **MELEK** coin only and carries **no functioning
SBD-style dollar**. A `MBD` symbol string exists in the mainnet config as a Steem-lineage leftover, but
**no SBD-style print/conversion/peg mechanism operates on MELEK** — there is no on-chain stable unit of
account. *(The exact status of the `MBD` symbol on mainnet is a config detail flagged as slightly
uncertain; the operative fact is that the SBD mechanism was not carried forward.)*

That gap — a fast, volatile social coin with **no stable dollar to price, pay, or save in** — is the
thing the MELEK ecosystem chooses to fill *properly*, with collateral instead of a fragile
conversion-peg. See the companion article **`stablecoin-mechanisms-and-the-dollar-token-gap.md`** for
the full menu of ways to build a dollar token and their trade-offs.

---

### Sources

- Steem `config.hpp` (exact constants: start/stop percent, conversion delay, interest rate) — https://raw.githubusercontent.com/steemit/steem/master/libraries/protocol/include/steem/protocol/config.hpp
- Steem Center wiki, "Steem Dollar (SBD)" — https://www.steem.center/index.php?title=Steem_Dollar_(SBD)
- @dantheman, "Introduction to Steem Dollars (SBD)" — https://steemit.com/steem/@dantheman/introduction-to-steem-dollars-sbd
- @steempeak, "CONVERT TO STEEM FEATURE — aka 'The Haircut'" — https://steemit.com/steempeak/@steempeak/convert-to-steem-feature-aka-the-haircut
- @tcpolymath, "Math of Steem: The Debt Ratio and the Haircut" — https://steemit.com/steem/@tcpolymath/math-of-steem-the-debt-ratio-and-the-haircut
- @eonwarped, "SBD Printing Code Walkthrough" — https://steemit.com/steem/@eonwarped/sbd-printing-code-walkthrough
- @ausbitbank, "SBD_PRINT_RATE — what it is, how to check it" — https://steemit.com/steemit/@ausbitbank/why-am-i-getting-less-steem-dollars-and-more-steem-sbdprintrate-what-it-is-how-to-check-it-how-you-can-help-100-sp
- @briggsy, "For Dummies: How Steem Post Payouts Work" — https://steemit.com/steem/@briggsy/for-dummies-how-steem-post-payout-s-work
- @sykochica, "100% Steem Power or 50/50 Payouts" — https://steemit.com/steem-help/@sykochica/answering-common-questions-should-i-use-100-steem-power-or-50-50-payouts-for-my-post
- @biophil, "Why SBD is trading so high" (Dec 2017 spike) — https://steemit.com/sbd/@biophil/why-sbd-is-trading-so-high-and-how-you-can-help
- @lukestokes, "Should SBD Be a Pegged Asset?" — https://steemit.com/sbd/@lukestokes/should-sbd-be-a-pegged-asset-if-so-when-should-we-peg-it
- @reggaemuffin, "Witness Discussion – SBD price and reverse peg" — https://steemit.com/witness-category/@reggaemuffin/witness-discussion-sbd-price-and-reverse-peg
- Blurt wallet FAQ / @jacobgadikian (Blurt's no-backed-dollar rationale) — https://blurtwallet.com/faq.html , https://steemit.com/@jacobgadikian
- Project note: `melek-chain-no-blurt-fee` (MELEK = Blurt-lineage clone; MELEK mainnet launch note: "no MBD")
