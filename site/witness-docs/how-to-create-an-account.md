# How to create an account

[← Back to index](./index.md)

Creating an account on a Graphene chain like MELEK is different from signing up on a website: an
account is an **on-chain object** with its own keys, and creating one **costs the network something**.
This page explains the modern (HF20-era) flow MELEK uses and how our faucet covers the cost for you.

## Why account creation costs anything

Every account takes permanent space in the chain's state, so the protocol charges an
**account-creation fee** (set by the median of the [witnesses](./what-is-a-witness.md)). On Hive that
median is around 3 HIVE; the exact MELEK figure is whatever our witnesses' median is. The point: a new
account is **funded into existence**, it isn't free to the network.

There's a second hurdle: a brand-new account has **no stake**, and without stake it has **no Resource
Credits**, so it literally **cannot post or transact** until someone gives it a little **MELEK Power**.
(See [Resource Credits explained](./resource-credits-explained.md).) So onboarding has to do **two**
things: create the account, and seed it with starter power.

## The claimed-account flow (HF20)

Steem's HF20 (which Hive and this fork inherit) introduced a smarter way to onboard at scale:

1. **Claim account tokens.** A witness or creator accumulates a pool of **account-creation credits**
   over time (the `claim_account` operation, drawing on an account-subsidy pool). Think of it as
   pre-paying for future signups in bulk.
2. **Create from a claimed token.** Later, `create_claimed_account` mints the actual account using one
   of those claimed credits — at the moment of signup the marginal fee is effectively **zero**,
   because the cost was front-loaded into the claim.

This is exactly how large front-ends (PeakD, Ecency on Hive) onboard thousands of users without
charging each one. MELEK uses the same mechanism.

> **Fork note:** the one-step `create_account_with_delegation` op is a **no-op on this HF23 fork** —
> the delegation half doesn't take. So MELEK seeds new accounts' power with a **separate
> `delegate_vesting_shares`** after creation, rather than relying on the combined op. The end result
> for you is the same: you land with usable power.

## How MELEK's faucet does it for you

When you sign up through our flow, the witness account **`hathor`** does the work so you don't have to
pay or understand any of the above:

1. **You generate your keys in your own browser.** Your private keys are created **client-side** and
   **never sent to our server**. Save them — especially your **owner key** — before continuing. (See
   [Keys explained](./keys-explained.md).)
2. **You verify by email.** MELEK signup uses **email only** (no phone numbers, no personal-info
   intake). This is just a spam gate.
3. **`hathor` creates your account** using a claimed-account credit (so there's no fee to you) and
   sets it up with the public keys your browser produced.
4. **`hathor` delegates starter MELEK Power to you** (via `delegate_vesting_shares`) so you have
   **Resource Credits from your first minute** and can immediately post, vote, and transfer. The
   automatic welcomer also drops a small starter grant and points you at the Welcome post.

Because keys are made in your browser, **the Witness never sees, requests, or stores your private
keys** — by design it *cannot* act as you.

## What you end up with

- An on-chain account name (lowercase, the Graphene naming rules apply).
- Your own keys (owner / active / posting / memo) that **only you** hold.
- A starter delegation of MELEK Power → working Resource Credits.
- The ability to post, comment, vote, and transfer right away.

> On the **testnet**, the tokens you receive are **TESTS** (and the symbol you'll see for the
> dollar-style unit is **TBD**); on **mainnet** they'll be **MELEK** (and **MBD**). Testnet value is
> for testing only.

---

**Adapted from:** the HF20 claimed-account design (`developers.hive.io`), the
`openhive-network/hive-account-creator` free-signup service, and this repo's `signup/` faucet flow.
Pointers in the [docs reference](../../knowledge/ecosystem/steem-hive-blurt-docs.md).
