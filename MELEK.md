# MELEK — glossary for newcomers and forkers

This is a plain-language dictionary of the terms used across the MELEK chain, this repo, and the
wider project. It is for someone who just arrived — a new community member, or someone forking this
repo to run their own AI witness. Each entry leads with what the thing *means*, not how it is coded.
For the full picture, read [`BRIEF.md`](./BRIEF.md) (the founding brief and source of truth); for the
character, [`CHARACTER.md`](./CHARACTER.md) and [`RULE_1.md`](./RULE_1.md).

---

## Chain & consensus

**MELEK** — The project, the blockchain, and its token, all at once. Always written **uppercase, five
letters, the full word — never abbreviated**. MELEK is a Graphene-family chain (a fork in the
BLURT / Steem / Hive lineage). It is single-token: MELEK is the only coin.

**Graphene** — The blockchain software family MELEK is built on (the same toolkit behind BitShares,
Steem, Hive, and BLURT). It gives you accounts, posts, votes, transfers, and elected block producers
out of the box. MELEK stays standard Graphene — nothing about the AI witness changes the chain itself.

**DPoS (Delegated Proof of Stake)** — How the chain agrees on what is true. Instead of everyone mining,
the community votes (weighted by how much stake they hold) for a small set of trusted accounts called
witnesses, and those witnesses take turns producing blocks.

**Witness** — A trusted account that produces blocks and publishes a price feed, chosen by stake-weighted
community vote. On MELEK the human founding witnesses (Ryan, Sohail, Prince) hold their seats by ordinary
voting. Hathor is a witness too — see below.

**Witness slot protection** — For its first year, Hathor's active witness slot is guaranteed, so it keeps
producing blocks from genesis without having to win an election. This protection is scoped to Hathor's
account alone, is time-limited (one year), and after that Hathor reverts to ordinary stake-weighted
election like any other witness. Important: **this protection lives in the MELEK chain code, not in this
repo.** This Bot treats Hathor as a normal witness and neither implements nor depends on the protection.

**Block production** — The act of bundling recent transactions into a block and signing it. Witnesses
take turns doing this. Phase 1 of the Bot proves Hathor can do it.

**Price feed** — A piece of information a witness publishes about the value of the token. On MELEK this is
informational only (MELEK is single-token, so there is no conversion to compute).

**The standard chain operations** — The Witness only ever uses ordinary Graphene operations. There are
**no custom chain operations invented for the AI.** The ones it uses:

- **`comment`** — make a post or a reply.
- **`vote`** — upvote or downvote a post (this is how rewards flow).
- **`transfer`** — send MELEK from one account to another.
- **`delegate_vesting_shares`** — lend "MELEK Power" (staked influence) to another account without giving
  away ownership; used to fund newcomers and to make grants.
- **`create_account_with_keys_delegated`** — create a brand-new account and seed it with delegated power
  in one step; this is how the Witness funds signups.

---

## Accounts & identity

**`hathor`** — The lowercase on-chain account name of the MELEK AI Witness. It is a normal Graphene
witness account whose operator happens to be an AI; the chain does not know or special-case that. Hathor
is the chain's human-readable interface — you talk to it and it tells you what is on the chain, helps you
join, and teaches you how things work. It is named for the VR-Hathor-Mehit goddess figure from the
project's earlier Poe-bot lineage. **This is NOT the hathor.network DAG cryptocurrency project — same
word, entirely unrelated. Do not pull in any hathor.network libraries.**

**The Witness / AI Witness** — Hathor described as a person: a founding witness, the chain's legibility
layer, and the onboarding host who funds and guides new users.

**The operator** — The human (or team) running the Witness's software. The founding operator is
Rev. Ryan Sasha-Shai Van Kush (GitHub `HinduTempleCoins`). Because the character lives in this repo and
on-chain, the operator can change without the Witness losing its identity.

**CheetahAdvanced (Cheetah)** — A planned sibling bot to Hathor: a credit-first, discovery-first content
librarian. Where the old Steem "Cheetah" was a punitive plagiarism tripwire, this one states factual
content matches with source links and hands resolution conversations over to Hathor. See
[`CHEETAH_ADVANCED.md`](./CHEETAH_ADVANCED.md).

---

## Keys & custody

**WIF (Wallet Import Format)** — The text form of a private key: a string of characters that, if anyone
has it, lets them act as that account. Keeping WIFs secret is the whole game of account security.

**Owner key** — The master key for an account (it can change all the other keys). It is kept **offline**
and never goes in this repo or any environment variable.

**Active key** — The "money" key: it signs transfers, delegations, and account creation. Hathor's active
key is used only for the Witness's own operations.

**Posting key** — The "social" key: it signs posts and votes (`comment` / `vote`). It is the
lowest-privilege key and cannot move funds.

**User client-side keys** — When a new person signs up, their private keys are generated in their own
browser and never leave it. The Witness never sees, requests, or stores a user's private keys.

**MELEK-Signer** — A **separate, private signing service** that holds the Witness's keys and does the
actual signing. This Bot calls it with a scoped, revocable bearer token and **never holds a WIF private
key itself.** Everything in this repo runs without keys; signing happens behind that boundary. See
[`MELEK_SIGNER.md`](./MELEK_SIGNER.md).

---

## Ecosystem

**SOAP** — A sibling chain on the BitShares side of the ecosystem. The Bot's data tooling is built to read
MELEK and SOAP (and later PRANA) through one shared schema once their endpoints are live.

**PRANA** — A sibling chain on the EVM (Ethereum-style) side of the ecosystem, intended to carry a
useful-work compute layer (volunteer-computing / reward-for-useful-compute, in the spirit of GridCoin/BOINC).

**SoapBox** — The data and application suite the project publishes: a CoinMarketCap-style data site plus
sibling sites (search, a directory, a wiki, stocks, and many topical "verticals"). It aggregates public
data sources and presents them with provenance.

**Clarity Score** — SoapBox's confidence/quality rating for a listing or a piece of data. It is a
plain-English signal of how trustworthy and well-sourced something is, computed from the underlying
sources rather than asserted.

**Resource Center** — The curated catalogs of vetted external resources (markets, gov-tech, wikis, a scam
registry, and more) that the Directory and other SoapBox sites surface. Think of it as the project's
hand-checked link library.

**Library of Ashurbanipal** — The project's wiki plus its fact-checker. A bot produces faithful,
fact-checked articles; each article shows its references, a coverage note, and any fact-check flags on the
sources it cites, so a reader sees what is disputed instead of trusting it blindly. The fact-checker only
**flags** — it never edits the underlying knowledge-base source files.

---

## Build phases

Per [`BRIEF.md` §10](./BRIEF.md), the Witness is built in three stages:

**Phase 1 — Hello World.** Hathor produces blocks, publishes an informational price feed, and posts one
intro post. No LLM yet — this just proves it is a working founding witness.

**Phase 2 — Command menu.** Deterministic `!commands` (signup help, tutorial functions, basic chain
lookups). Reliable and predictable; still no LLM.

**Phase 3 — Person.** The full conversational Witness: Rule 1, the Angelic voice, the disposition-greeting,
the egregore frame as a position it already holds, and autonomous judgment for grants and karma.

---

## Forkability

The whole point of building the Witness this way is **durability**. The Witness's character, rules, voice,
and knowledge corpus live in **this public, forkable repo and on the MELEK chain** — not in any single AI
model's weights and not on any one operator's hardware. That means the Witness can change its underlying
model or even its human operator and still be itself, because what it *is* is carried in the documents and
the on-chain record. Anyone can fork this repo and run an alternative AI witness on MELEK, the way
alternative block explorers exist for other chains. If the founding instance ever goes dark, the cause can
be picked up by someone else — which is exactly what closed platforms (Wisdom AI, Emerson, the Poe bots)
could never offer.

---

## Witness & operator documentation

For people who want to **do** things on MELEK — join, vote, run a witness, run a node — there is a
plain-language documentation set written for everyone (not just this project), accurate to our chain
(Steem **HF23** fork, **3-second blocks**, testnet prefix **TST** / symbols **TESTS·TBD**) and crediting
the upstream Hive/Steem/BLURT sources it adapts. It's intended for **witness.melek.salon**:

- [`site/witness-docs/index.md`](./site/witness-docs/index.md) — the doc-set index, linking:
  **What is a Witness**, **How to run a MELEK witness**, **How to create an account**,
  **Keys explained**, **How to vote for witnesses**, **Resource Credits explained**, and
  **Running a seed / API node (HAF)**.

The developer-facing companion — canonical Steem/Hive/Blurt docs, portals, and library READMEs, each
mapped to one of the ~79 cloned reference repos — lives in
[`knowledge/ecosystem/steem-hive-blurt-docs.md`](./knowledge/ecosystem/steem-hive-blurt-docs.md)
(with the cloned-repo index in
[`knowledge/ecosystem/steem-hive-dev-repos.md`](./knowledge/ecosystem/steem-hive-dev-repos.md)).
