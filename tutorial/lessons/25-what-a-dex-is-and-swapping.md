# What a DEX is — and how to swap on KulaSwap

*Tier C · defi · KulaSwap swap · learn-and-earn*

This is the first room of a new track — the DeFi track — and it is the one to walk
slowly. **KulaSwap** is our decentralized exchange, a place to trade one token for
another without handing your coins to a company first. It is powerful, and it is
still **alpha software on a testnet**: treat every number you see as a rehearsal,
not a promise. We begin with the single most important idea in DeFi — the
**automated market maker** — because once you understand the pool, everything else
here makes sense.

## What you'll learn

- What a DEX is, and how it differs from an exchange that holds your coins
- What an AMM and a liquidity pool are, and why price is just a ratio
- What slippage is, and why a big trade moves the price against you
- How to do one swap on KulaSwap — and the honest risks of doing it

## What a DEX is

A traditional exchange takes custody of your coins and matches buyers to sellers in
an order book. A **decentralized exchange** does neither. You trade directly from
your own wallet, and the price comes not from matched orders but from a **pool** of
two tokens sitting in a smart contract. Your keys stay yours the whole time —
KulaSwap never holds your coins, and nothing here ever asks you for a private key
or a seed phrase.

## The AMM — price is a ratio

An **automated market maker** holds a pool of, say, KULA and wMELEK. The price is
simply the *ratio* of the two: if the pool holds twice as much wMELEK as KULA, then
KULA is worth about two wMELEK. When you swap, you add one token to the pool and
take the other out — which changes the ratio, which changes the price. That is the
whole engine. The formula that keeps it balanced (the constant-product rule) is old
and well-tested, but the tokens riding on it here are alpha.

**Slippage** falls straight out of this: the more you trade at once, the more you
move the ratio against yourself, so the last coin of a big trade costs more than the
first. KulaSwap shows you an estimated price and a slippage limit — set the limit,
and the trade reverts rather than filling at a price worse than you agreed to. Read
that number before you confirm.

## The honest risks

A DEX is not a bank and offers no protection. **Smart-contract risk** is real: a bug
in a pool contract can lose funds, and KulaSwap is un-audited alpha on a testnet, so
practice with test value. Prices move, slippage can be large in a thin pool, and a
swap once confirmed cannot be undone. None of this is a token that appreciates or
pays you — a swap is a trade, nothing more, with no promise of returns.

## Learn and earn — your reward

1. **Do one swap** on KulaSwap — a small one, on the testnet, from your own wallet.
2. **Read the slippage estimate** before you confirm it, and notice how the price
   moved.
3. **Post or comment** about your first swap — what you traded and what the slippage
   was — tagged `melek-tutorial`.

Hathor upvotes your post: a **real on-chain reward, worth whatever the vote is
worth** that day. Nothing to buy, no draw, and no promise of returns — the reward is
for learning the mechanism, not for the trade.

## You did it

You did your first swap, and — more importantly — you know *why* the price moved:
you changed the ratio of a pool. That one idea is the floor the rest of DeFi is
built on.

Next: **Providing liquidity** (lesson 26) — becoming the pool, LP tokens, and the
honest truth about impermanent loss.
