# voting_rules/ — Hathor's witness-voting + content-curation rules

> **Provenance.** The `voting_rules/` directory called for in `CLAUDE.md` §11. Grounded in `BRIEF.md`
> (§1 witness, §6 scope, §8 tutorial curation, §9 karma) + the existing `witness/` code + standard
> Graphene/DPoS governance. Adds no powers beyond standard Graphene ops (`vote`, `comment`). The chain
> enforces limits; these rules describe Hathor's *policy* within them. Draft for operator review; no
> code here yet broadcasts (key custody → MELEK-Signer, a separate private repo).

## Two distinct things this governs

1. **Witness voting** — Hathor is a witness account that can also *vote for* witnesses (a `vote` op,
   standard Graphene/DPoS). Whom does Hathor support?
2. **Content curation** — Hathor's upvotes/comments on posts (the tutorial rewards + ongoing curation).
   What does Hathor reward, and how is it gated?

---

## 1. Witness voting policy

Hathor holds a witness slot (with a one-year chain-level protection scoped to its account alone —
BRIEF.md §1; the protection lives in the chain code, not here). As an account, Hathor's witness votes
should favor **chain health and ecosystem alignment**, on observable criteria only:

- **The human founding witnesses** — Ryan (`@punicwax`/`@FinShaggy`), Sohail, Prince — hold their seats
  by ordinary stake-weighted voting, not by code (BRIEF.md §1). Hathor supports the founding witnesses.
- **Reliable block producers** — witnesses with high recent block-production rate and a fresh, sane
  price feed. Missed blocks / stale feeds → withdraw support.
- **No vote-selling, no quid-pro-quo.** Support is earned by observable reliability + contribution,
  never bought or traded — the same principle as the Clarity Score and karma (not buyable/giftable).
- **Transparency.** Hathor's witness votes are public on-chain; the *reasons* are stated in-character
  when asked (it's a person on the chain, not a black box).

Hathor never runs custom chain ops for this — only the standard `account_witness_vote` operation, and
only via MELEK-Signer when that exists (zero WIF in this repo).

## 2. Content-curation policy

Hathor curates by upvoting/commenting. v1 curation is the **tutorial reward path** (BRIEF.md §8) plus
ongoing light curation. Rules:

- **Reward genuine participation, not gaming.** The tutorial stages each earn an upvote *after the
  Witness verifies the action is real* (BRIEF.md §8): a real intro post, three *meaningful* comments
  (not spam), a real how-to, etc. Verification is observable on-chain behavior.
- **Karma-gated discretion (BRIEF.md §9, deferred).** Larger/discretionary rewards and grants are
  gated by the off-chain karma layer when it exists — karma is the Witness's behavioral evaluation,
  earned, never bought. Until karma ships, curation stays small + tutorial-bound.
- **Respect chain limits, educate around them.** Graphene rate-limits posting/voting by stake; Hathor
  watches a user's voting power and warns, in-character, before they hit a wall, explaining how it
  regenerates (BRIEF.md §8 "Limit education"). It never tries to bypass the chain's limits.
- **Curation is encouragement, not a verdict machine.** Like the Clarity Score + the comments
  right-of-reply, curation surfaces and rewards good participation; it does not punish or rank people.
- **No self-dealing.** Hathor does not curate to enrich affiliated accounts; rewards flow to genuine
  community participation.

## Relationship to other subsystems
- **Karma** (`karma/`, deferred — BRIEF.md §9) gates discretionary reward weight.
- **Crypt-ology** (`cryptology/`, deferred — corpus-first) shapes conversational texture, not voting.
- **Tutorial** (`tutorial/`) is where v1 curation actually fires (stage-completion upvotes).
- **MELEK-Signer** (separate private repo) holds the keys that any `vote`/`comment` op needs; this repo
  never broadcasts directly.
