# Running your own bot — trading and arbitrage, the careful way

*Tier B · opt-in automation · via MELEK-Signer*

The last step of the automation strand is the biggest one: running a bot that
*trades*. Arbitrage between markets, market-making, buying low and selling higher
as a token finds its level — these are things a program can do around the clock,
and MELEK is built so you can run one on your own account without ever giving up
your keys. This lesson is about *how to set that up safely*. It is not trading
advice, and it will not tell you what to buy. It will tell you how to keep the
whole thing from hurting you while you learn.

## What you'll learn

- What kinds of bots people run, in plain terms
- Why our coins can survive strategies that would kill a pure-speculation token
- The safe setup: scoped token, backtest, tiny size, kill-switch
- The honest risks, said plainly

## What these bots do

- **Arbitrage** watches the same asset in two places and captures the gap when one
  is briefly cheaper than the other. It is patient and mechanical.
- **Market-making** posts both a buy and a sell and earns the spread between them,
  providing liquidity so others can trade.
- **Accumulation** — the "buy low, sell high" ratchet — sells into high demand and
  buys back cheaper, keeping a token's price sane while quietly building a
  position. On a coin with *real utility*, that is healthy market motion, not a
  death blow: the coin has a reason to recover, and people make money when it does.
  On a coin whose only use is being traded, the same strategy is corrosive — which
  is exactly why we build coins with utility underneath them.

## The safe setup

1. **Grant a scoped, trade-only token through MELEK-Signer.** As with every bot on
   MELEK, it acts through the Signer under a narrow scope and holds no key of its
   own. Scope it to the specific market actions it needs and nothing wider. Your
   custody never moves; a bug or a bad day can cost you trades, never the account.

2. **Backtest before you arm it.** Run the strategy against past market data first
   and read the result honestly. A strategy that looks clever in your head often
   looks very different against real history. If it does not survive the backtest,
   it does not go live.

3. **Start tiny.** Arm it with an amount you can watch lose without flinching.
   Small size while you learn its behavior is the cheapest tuition you will ever
   pay. Scale up only after it has earned your trust with real, boring
   consistency.

4. **Keep a kill-switch, and watch the early runs.** Revoking the Signer token
   stops the bot instantly — that is your emergency brake, and you should know
   exactly how to pull it before you ever start. Watch the first live sessions
   closely; automation earns trust, it is not owed it.

## The honest risks

A bot does exactly what you told it, including the wrong thing, faster than you can
react. Markets move against strategies without warning. Backtests flatter; live
trading humbles. None of this is a reason not to learn — it is the reason to start
small, keep the kill-switch close, and never automate money you cannot afford to
watch move. This is education in *how to set it up safely*, not a promise of
profit, and certainly not a recommendation of any particular trade.

## You did it

You know the shape of running your own bot now: scoped and keyless through the
Signer, backtested before it is armed, tiny while it learns, and one click from
off. That is the careful way — the only way worth starting. Take it slowly; the
market will still be there tomorrow.
