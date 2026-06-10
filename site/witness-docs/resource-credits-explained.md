# Resource Credits explained

[← Back to index](./index.md)

On MELEK you don't pay a gas fee to post, vote, or transfer. Instead, every action spends **Resource
Credits (RC)** — a regenerating allowance you get from holding **staked** stake (MELEK Power). This is
the same system Steem and Hive use, and it's why these chains can offer **fee-less** social actions
without being overrun by spam.

## The core idea

- **RC comes from staked stake.** When you hold **MELEK Power** (staked MELEK, i.e. VESTS), you get a
  pool of RC proportional to it. Liquid tokens don't give RC; **staked** ones do.
- **Every action burns some RC.** A comment, a vote, a transfer, a `custom_json` — each costs RC
  according to how much **bytes/state** it uses. Big actions cost more; a vote costs little.
- **RC regenerates over time.** Your RC "mana bar" refills continuously, back to **full over about 5
  days**. So you have a sustainable rate of activity, not a hard wall — you only get blocked if you
  burn faster than you regenerate.
- **No stake → no RC → you can't act.** A brand-new account with zero power literally cannot post
  until it gets some power. This is the central onboarding fact (see below).

Think of RC as **bandwidth backed by stake**: the more of the network you've staked into, the more of
the network's throughput you may use per day. It's spam-resistance without per-action fees.

## Why a new account is stuck until it's funded

A fresh account has **no stake**, so its RC pool is **empty** — it can't even make its first post.
That's why onboarding has to seed new accounts with starter power. On MELEK, the witness **`hathor`**
**delegates** a little MELEK Power to each new account at signup, which immediately gives it RC to
transact. (See [How to create an account](./how-to-create-an-account.md).)

## Three ways an account gets RC

1. **Hold your own MELEK Power.** Power up (stake) liquid MELEK and your RC pool grows. This is the
   permanent way: your activity budget scales with your stake.
2. **Receive a delegation.** Someone (e.g. `hathor`, or a friend) can **`delegate_vesting_shares`** to
   you — lending you their Power so you get RC **without giving up ownership**. They can take it back
   later; delegations have a short cooldown when returned.
3. **Receive an RC-only delegation.** It's also possible to lend *just RC* (not voting power or
   curation weight) to an account. This is a lightweight way to keep someone able to post without
   handing over real stake.

## Running low on RC

If you try to act and it's rejected for insufficient RC, you have options:

- **Wait** — your bar refills over ~5 days, so within hours you'll have some back.
- **Power up** more MELEK to permanently enlarge your pool.
- **Get a delegation** from someone with spare power.

Heavy automated apps (bots, games) plan around this by holding enough Power, or by receiving RC
delegations sized to their activity.

## Related rate limits (not RC, but you'll meet them)

Two consensus rules sit alongside RC and sometimes get mistaken for it:

- **3-second minimum between comments.** The chain enforces a **3-second** spacing on
  comments/replies from the same account. This is a fixed anti-spam rule, separate from RC. (MELEK
  also has **3-second blocks**, but that's a different "3 seconds" — block cadence, not the comment
  interval.)
- **Voting mana.** Upvoting draws on a voting-power bar that, like RC, refills over ~5 days; full-power
  votes deplete it, so very frequent max-weight voting will shrink each vote's effect until it regens.

## Quick mental model

> **MELEK Power → Resource Credits → the right to transact.** Hold stake, get a daily-ish allowance,
> spend it on actions, and it refills over five days. New accounts get a starter delegation so the
> cycle can begin.

---

**Adapted from:** Hive/Steem Resource Credit docs (`developers.hive.io`, `rc_api`) and verified
against MELEK's testnet (RC drawn from vesting; ~5-day regen; 3-second comment interval; new accounts
bootstrapped by delegation). Pointers in the
[docs reference](../../knowledge/ecosystem/steem-hive-blurt-docs.md).
