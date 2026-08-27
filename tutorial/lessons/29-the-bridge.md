# The bridge — moving value between MELEK and PRANA

*Tier C · defi · MELEK↔PRANA bridge · learn-and-earn*

This is the last room of the DeFi track, and it ties the two chains together.
MELEK is our social chain; **PRANA** is the compute-and-DeFi chain where KulaSwap,
the farms, and the CDP live. A **bridge** is what lets value cross between them —
and the token that crosses is **wMELEK**, "wrapped MELEK." Bridges are the most
security-sensitive machinery in all of DeFi, the place where the largest hacks in
the space have happened, so this lesson is as much about *caution* as about
mechanics. It is alpha on a testnet; cross with test value and learn the shape of
the thing.

## What you'll learn

- What a bridge is, and why two chains need one to share value
- What "wrapping" means — how wMELEK represents MELEK on PRANA
- The security posture: what backs wMELEK, and where bridge risk lives
- How to bridge once — and why you cross carefully

## What wrapping is

MELEK the coin lives on the MELEK chain. PRANA's DeFi contracts cannot touch it
directly — a contract on one chain cannot reach into another. So the bridge does
something simple and strict: you **lock** MELEK on the MELEK side, and the bridge
**mints** an equal amount of **wMELEK** on the PRANA side. That wMELEK is a
one-for-one stand-in — a claim ticket for the MELEK held in the bridge. To come
back, you **burn** the wMELEK on PRANA and the bridge **releases** your MELEK. The
hard invariant is this: **wMELEK in existence always equals MELEK locked in the
bridge.** No free minting — every wMELEK is backed by a real MELEK held in reserve.
Your keys stay yours the whole way across, and the bridge never asks for a secret.

## The security posture — read this twice

A bridge is a lock-and-mint vault, and a vault is exactly what attackers go for.
Two honest points:

- **The backing is real, not synthetic.** wMELEK is minted only on a verified
  deposit and burned on withdrawal, so the peg is collateral, not a promise. That is
  the strong part of the design.
- **The trust sits in the attesters.** A federated bridge relies on a set of
  validators (a K-of-N group) to confirm that a deposit really happened before
  wMELEK is minted. That group is the thing you are trusting. A bridge's worst risks
  live here — a compromised validator set, or a contract bug in the mint/release
  path — which is why bridges are audited hardest and why ours is still un-audited
  alpha. Cross small, cross on the testnet, and never treat a bridge as a place to
  park value.

None of this is a token that appreciates or pays you. Bridging moves value across
chains; it is not a yield, and there is no promise of returns.

## Learn and earn — your reward

1. **Bridge once** on the testnet — lock a small amount of MELEK and receive
   wMELEK on PRANA (or bring a little back the other way).
2. **Confirm the one-for-one** — check that the wMELEK you received matches the
   MELEK you locked.
3. **Post or comment**, tagged `melek-tutorial`, about your first crossing — and, in
   your words, where a bridge's real risk lives.

Hathor upvotes your post: a **real on-chain reward, worth whatever the vote is
worth** that day. No draw, nothing to buy, and no promise of returns — the reward is
for crossing carefully and understanding what you trusted to do it.

## You did it

You moved value between MELEK and PRANA, you know what wMELEK really is — a claim on
locked MELEK, one for one — and you know where a bridge's danger sits. That caution
is the right note to end a DeFi track on: the tools are powerful, the risks are
real, and now you can see both.

Next: there is no next lesson in the DeFi track — you have walked all of it. Take
what you learned back to the core chain, and, as always, go help the next newcomer
cross safely.
