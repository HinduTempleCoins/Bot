# Keys explained

[← Back to index](./index.md)

On MELEK (like Steem, Hive, and BLURT) your account has **four keys**, each with a different power.
This is one of the most important things to understand, because **whoever holds a key can act with
that key's power** — there is no "forgot password" button on a blockchain. This page explains the four
keys and how to keep them safe.

## The four keys, from most to least powerful

| Key | What it can do | Where it should live |
|---|---|---|
| **Owner** | The master key. It can **change all your other keys** — including itself — and recover the account. It is the keys to the kingdom. | **Offline.** Written down / in cold storage. Never in an app, never on a server, never pasted into a site. Use it only to rotate keys or recover. |
| **Active** | The "money" key. Signs **transfers**, **power-up/power-down**, **delegations**, **witness ops**, and **account creation**. | Only where you actually move funds. Keep it out of casual apps. |
| **Posting** | The "social" key. Signs **posts, comments, votes, follows, reblogs** — and **cannot move funds**. | This is the one you log into front-ends with day-to-day. Lowest risk. |
| **Memo** | Encrypts/decrypts the optional private memo on a transfer. It does **not** authorize anything by itself. | Wherever you read/write encrypted memos. |

The golden rule: **use the lowest-privilege key that can do the job.** Log into a blog front-end with
your **posting** key, not your active key. Touch your **owner** key only to change keys.

## How the keys relate

Your **owner** key sits above the others and can replace any of them. So if your **posting** or even
**active** key is ever exposed, your owner key lets you rotate the compromised keys and lock the
attacker out — *as long as your owner key itself is still secret*. That's why the owner key goes
**offline and stays there**: it is your last line of defense.

> On most Graphene front-ends you'll also see a **"master password."** That's not a fifth key — it's a
> seed that **deterministically derives** the four keys above. Anyone with your master password has
> **all four keys**, including owner. Treat it like the owner key: offline, never shared, never typed
> into a random site.

## WIF — what the key actually looks like

A private key is stored as a **WIF** (Wallet Import Format) string — a long run of letters and digits.
If someone has your WIF, they *are* that key. There is no second factor on the chain itself. So:

- Never paste a private WIF into a website you don't fully trust.
- Never put a private WIF in a screenshot, a chat, an email, or a public repo.
- Prefer tools that **keep the key in your browser/extension** and only send a **signature**, not the
  key (this is what Hive Keychain and the HiveSigner/MELEK-Signer pattern do).

## How MELEK handles keys (so you can trust the flow)

- **At signup, your keys are generated in your own browser.** They are **never transmitted** to the
  Witness's server. The Witness never sees, requests, or stores your private keys — it literally
  cannot act as you. (See [How to create an account](./how-to-create-an-account.md).)
- **The Witness's own keys** follow the same discipline it asks of you: its **owner key is offline**;
  its working keys are handled through a separate signer boundary and never committed to this public
  repo.

## If a key is exposed

1. If a **posting/active** key leaked but your **owner** key is safe: use the owner key (or your
   master password) to **rotate** the exposed keys immediately. The attacker's copy becomes useless.
2. If your **owner** key / master password leaked: act fast — whoever has it can change everything.
   This is the worst case and the reason the owner key lives offline. Account-recovery mechanisms exist
   (a designated recovery account can help within a recovery window), but prevention beats recovery.

The web tool pattern for rotating keys safely is shown upstream in `TheCrazyGM/hive-key-updater`.

---

**Adapted from:** the Graphene multi-key authority model (`developers.hive.io`, `xeroc` base
libraries), Hive Keychain's "keys never leave the client" pattern, and this repo's key-custody rules
in [`MELEK.md`](../../MELEK.md). Pointers in the
[docs reference](../../knowledge/ecosystem/steem-hive-blurt-docs.md).
