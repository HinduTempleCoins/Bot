# Providing liquidity — becoming the pool, and impermanent loss

*Tier C · defi · KulaSwap liquidity · learn-and-earn*

In the last lesson you traded *against* a pool. In this one you become *part* of
one. **Providing liquidity** means depositing a pair of tokens into a KulaSwap pool
so that other people can swap against them — and earning a share of the swap fees
for the service. It is one of the real ways to earn in DeFi. It also carries a risk
that gets glossed over far too often, so we are going to look straight at it:
**impermanent loss**. This is still alpha software on a testnet; learn the shape of
it here, with test value, before it ever matters with real value.

## What you'll learn

- What a liquidity provider does, and where the fees come from
- What LP tokens are — your receipt for a share of the pool
- What **impermanent loss** is, honestly, and when it bites
- How to add liquidity once — and weigh the risk before you do

## Becoming the pool

When you add liquidity you deposit *both* tokens of a pair — say KULA and wMELEK —
in the pool's current ratio. In return the pool mints you **LP tokens**: a receipt
that says you own a slice of this pool. Every time someone swaps against it, a small
fee is added to the pool, and because you own a slice, your slice grows. Redeem your
LP tokens later and you withdraw your share of the pool, fees included. Your keys
never leave you; the LP token simply records what the pool owes you.

## Impermanent loss — the honest part

Here is the risk nobody should skip. If the two tokens' prices drift apart after you
deposit, the pool automatically rebalances — selling the one that rose and buying
the one that fell — so you end up holding **less of the winner and more of the
loser** than if you had simply kept the two tokens in your wallet. That gap is
**impermanent loss**. It is called "impermanent" because if the prices drift back
together it fades — but if they don't, it becomes permanent when you withdraw. The
fees you earn are meant to make up for it, but they do not always. It is entirely
possible to provide liquidity, collect fees, and still come out behind simply
holding. That is the trade you are actually making, and you should make it with eyes
open.

Add to this the ordinary hazards: **smart-contract risk** in an un-audited alpha
pool, and thin pools that swing hard. Providing liquidity is not a savings account
and is not a token that appreciates — there is no promise of returns here.

## Learn and earn — your reward

1. **Add liquidity once** to a KulaSwap pool on the testnet — deposit the pair, and
   receive your LP tokens.
2. **Find your LP balance** and note the impermanent-loss warning the interface
   shows you.
3. **Post or comment** about it — the pair you chose and, in your own words, what
   impermanent loss means — tagged `melek-tutorial`.

Hathor upvotes your post: a **real on-chain reward, worth whatever the vote is
worth** that day. No draw, nothing to buy, and no promise of returns — the upvote
rewards understanding the risk, not taking it.

## You did it

You became the pool, held an LP token, and — the part that matters — you can now
explain impermanent loss to someone else. That single honest idea will protect you
in every yield product you ever meet.

Next: **Farming and yield** (lesson 27) — staking those LP tokens for rewards, and
why yield is never free money.
