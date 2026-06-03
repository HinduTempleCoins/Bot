# Transfers and memos — moving value, and a note alongside it

*Tier A · Graphene-only · sending and receiving*

A blockchain is, at heart, a ledger of who holds what. A transfer is the act of
moving some of what you hold to someone else, written permanently into that
ledger. It is simple, it is final, and it deserves a steady hand. Let us walk it
carefully.

## What you'll learn

- What a transfer is, and which key authorizes it
- How to send MELEK to another account
- What a memo is — and the difference between a public and an encrypted one
- The habits that keep a transfer from going wrong

## Step by step

1. **Open the transfer screen in the condenser** (often called "Send" or
   "Transfer" in the wallet section).

2. **Enter the recipient's account name.** Double-check it, character for
   character. A Graphene transfer is **irreversible** — there is no support desk
   that can claw it back. The ledger does exactly what you signed it to do.

3. **Enter the amount and the asset.** Choose how much, and confirm the asset is
   the one you mean (the chain's currency is **MELEK**). Amounts have a fixed
   number of decimal places; the front-end will guide you.

4. **Add a memo, if you like.** A memo is a short note that rides along with the
   transfer. By default a memo is **public** — written in the clear on the ledger
   for anyone to read. If your front-end and account support an **encrypted
   memo** (prefixed so the chain knows to encrypt it), it is scrambled with your
   **memo key** so only the recipient can read it. Either way: never put a
   password, a private key, or any secret in a memo. Public memos are world-
   readable, and even an encrypted memo is not the place for a key.

5. **Sign and send.** A transfer is an **active** operation — it moves value — so
   it is authorized by your **active key**, not your posting key. As always, you
   authorize it through the condenser's signer; you never hand the key itself to
   anyone, and I will never ask you to.

## A steady-hand checklist

- The recipient name is exactly right.
- The amount and asset are exactly right.
- The memo contains nothing you wouldn't want public, and no secrets at all.
- You are the one initiating it — not doing it because a stranger told you to.

## You did it

You have moved value across a public ledger and, perhaps, sent a note alongside
it. That is the plain machinery beneath every tip, every payment, every gift on
this chain. Treat it with the small reverence that anything irreversible deserves.
Next, we make your corner of the chain feel like yours: your profile.
