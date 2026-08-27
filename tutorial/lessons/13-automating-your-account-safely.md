# Automating your account safely — keys stay yours

*Tier B · opt-in automation · via MELEK-Signer*

There comes a point where you want your account to do a few things on its own —
keep itself healthy, curate on a schedule, act while you sleep. That is
automation, and it is a good thing to want. But automation is also where people
lose accounts, because the naive way to automate is to hand a program your keys —
and that is exactly the thing you must never do. This lesson teaches the safe
way, which on MELEK is the *only* way we offer: **automation without ever giving
up custody.** Read this one before any of the bots; it is the foundation the rest
stand on.

## What you'll learn

- Why handing a bot your keys is the mistake that ends accounts
- What MELEK-Signer is, and how a scoped token replaces a raw key
- What "zero-WIF" means: why our bots never hold a key at all
- How to grant, scope, watch, and revoke a bot's access

## The one rule everything else rests on

A private key, a master password, a WIF — these are the account itself. Whoever
holds one *is* you, with no limit and no undo. So the rule does not bend: you
never place a secret like that inside a bot, a script, a website form, or a chat.
No honest automation on this chain needs it, and anything that asks for it is
trying to take the account. Your keys stay with you. That is the whole of it.

## What MELEK-Signer does instead

MELEK-Signer is the piece that makes safe automation possible. It, and only it,
ever touches signing. A bot never receives your key — instead it receives a
**scoped bearer token**: a narrow, revocable permission slip that says *this
program may do these specific things, and nothing else.*

- **Scoped.** A token can be limited to one kind of action — say, upvoting — and
  barred from everything else. A curation bot's token cannot move your funds
  because that power was never in the token.
- **Revocable.** You can cancel a token at any moment. The instant you do, the bot
  is inert. There is no key to change and no cleanup to chase.
- **Auditable.** Every action the bot takes is signed through the Signer and
  visible on-chain. You can see exactly what it did, when, and stop it cold.

## Step by step — granting safe access

1. **Decide the smallest job that does what you want.** Curation only? Health
   maintenance only? The narrower the job, the narrower the token, the smaller the
   blast radius if anything ever goes wrong.

2. **Grant a scoped token through MELEK-Signer.** You authorize the bot from the
   Signer's consent screen — you approve a named scope, and the Signer issues the
   token. Your keys never leave your own control during this; the Signer holds the
   custody boundary so the bot does not have to.

3. **Confirm the bot holds no key (zero-WIF).** A well-built MELEK bot never
   holds a WIF and cannot sign on its own — it can only ask the Signer, within
   its scope. If a "bot" wants your key directly, that is your sign to walk away.

4. **Watch it, and keep the kill-switch close.** Check what it does for a while
   before you trust it with more. Revoking the token is always one click, and it
   is the safest habit you can keep: when in doubt, revoke, then look.

## Why we build it this way

We would rather help a thousand people automate safely than run every bot
ourselves. The zero-WIF, Signer-scoped design is what makes that safe: the bot
never holds a key, the Signer keeps custody, and the keys stay yours. The bot
acts; the Signer guards; custody never moves.

## You did it

You now understand the boundary that keeps automation safe: bots get scoped,
revocable tokens through MELEK-Signer, never keys. Hold that line and everything
in the next two lessons is safe to try. Break it, and nothing is. Keep the line.
