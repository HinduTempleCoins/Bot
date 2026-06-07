# Account Recovery Policy — MELEK (Hathor as recovery helper)

**Status:** Live on the MELEK testnet (alpha). Rehearsed end-to-end. Standard Graphene
account-recovery only — no custom chain operations.

When you make a MELEK account, the most important thing you hold is your **owner key**. If
that key is ever lost or stolen, account recovery is the lifeboat: a way to install a new
owner key and lock the thief out — **without ever handing your keys to anyone.**

MELEK uses the same proven account-recovery design as Steem and Hive (often called
"Option A"). The Witness account **`hathor`** acts as the **recovery helper** (the
"recovery partner") for accounts created through MELEK signup.

---

## What "recovery helper" means — and what it does NOT mean

A recovery helper can **propose** a new owner key for your account, but it can **never take
your account.** The chain itself enforces this:

- To actually recover an account, the chain requires a signature from **a recent owner key
  you yourself once held** (your "recent owner authority"), *in addition to* the helper's
  proposal and your brand-new key.
- `hathor` only ever signs the **proposal** (`request_account_recovery`). It never holds,
  sees, or can produce your owner key. So even a fully compromised helper cannot seize an
  account — it can only offer a new key that you must then co-sign with proof you are the
  real owner.

This is why a helper is safe to trust: the math, not our good intentions, is what protects
you.

---

## How recovery works, step by step

1. **You lose or suspect theft of your owner key.** You contact MELEK signup support and
   prove you are the account holder using **the email you signed up with** (email is the
   only identity channel — MELEK never asks for phone numbers or personal documents).

2. **`hathor` opens a recovery request** (`request_account_recovery`). This names your
   account and the **new owner key** you want to install. (Your new key is generated in
   your own browser — the server never sees the private side.)

3. **You finish the recovery** (`recover_account`). Your client signs this with **both**:
   - your **new** owner key, and
   - a **recent (pre-theft) owner key** from your account's key history — the proof that
     you are the legitimate owner.

   The chain checks the request and both signatures, then swaps in your new owner key.
   The thief's stolen key is now dead.

4. **Done.** You control the account again with a key only you hold.

There is a time limit on each step (see the window below). If the request expires before
you complete step 3, the helper simply opens a fresh one.

---

## The recovery window (timings)

The chain enforces two timers. **The testnet runs deliberately compressed (short) timings so
the whole cycle can be rehearsed in seconds; mainnet uses the long, safe production values.**

| Timer | What it bounds | Testnet (alpha, compressed) | Mainnet default |
|---|---|---|---|
| **Recovery period** (`OWNER_AUTH_RECOVERY_PERIOD`) | How far back a "recent" owner key stays valid for recovery; also the delay before a `change_recovery_account` takes effect | **60 seconds** | **30 days** |
| **Request expiration** (`ACCOUNT_RECOVERY_REQUEST_EXPIRATION_PERIOD`) | How long a single open recovery request stays valid before it lapses | **12 seconds** | **24 hours** |

On mainnet the 30-day recovery period is the security buffer: if a thief changes your owner
key, you still have a 30-day window in which your previous (recent) owner key can recover the
account. The 30-day delay on changing your recovery helper exists for the same reason — a
thief who grabs your active key cannot instantly swap your recovery partner out from under you.

---

## Who gets `hathor` as their helper — and who must opt in

- **Accounts created through MELEK signup** are created with **`hathor`** set as their
  `recovery_account` automatically. Nothing to do — recovery is already wired.

- **Self-created accounts** (made outside MELEK signup, e.g. with the CLI wallet) start with
  whatever recovery account their *creator* set — which may be an empty/null partner that can
  never help you. If you want `hathor` as your recovery helper, you must opt in by
  broadcasting a **`change_recovery_account`** op naming `hathor`:

  - Signed with **your own owner key**.
  - It takes effect only **after the recovery period** (30 days on mainnet; 60 seconds on the
    testnet) — this delay is a safety feature, not a bug.

  You can also use `change_recovery_account` to move *away* from `hathor` to any other helper
  at any time, on the same delay. You are never locked in.

---

## What MELEK / `hathor` will and won't do

- **Will:** open a recovery request for an account whose `recovery_account` is `hathor`,
  once you have proven control of the signup email on file.
- **Will not:** ever ask for, accept, see, or store your private keys — owner, active,
  posting, or memo. Your keys are generated and stay in your own browser. (Key-custody rule,
  BRIEF.md §7.)
- **Cannot:** take your account. Recovery always requires a recent owner key only you have
  held.

---

## For developers

The op builders live in [`signup/recovery.mjs`](signup/recovery.mjs) — a zero-WIF module that
**builds** the three standard Graphene ops and hands them to an injected broadcaster; it never
holds a key and never signs:

- `buildRecoveryRequest(account, newOwnerAuthority)` → `request_account_recovery`
  (`recovery_account: hathor`), signed by the helper.
- `buildRecoverAccount(account, newOwnerAuthority, recentOwnerAuthority)` → `recover_account`,
  signed by the user's new + recent owner keys (in the browser).
- `buildChangeRecoveryAccount(account, newRecoveryAccount)` → `change_recovery_account`,
  signed by the account's owner key.

All authorities are validated as **public keys only**; anything private-key-shaped is rejected
hard. The module is testnet-guarded (TST prefix). Offline tests:
[`signup/recovery.test.mjs`](signup/recovery.test.mjs).
