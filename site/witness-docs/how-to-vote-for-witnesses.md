# How to vote for witnesses

[← Back to index](./index.md)

Voting for witnesses is **governance** — it decides who produces MELEK's blocks and what the chain's
parameters (like the account-creation fee and block size) end up being. It works exactly as it does on
Steem, Hive, and BLURT.

## How witness votes work

- You vote for witnesses with a **`account_witness_vote`** operation, signed by your **active** key
  (governance actions are higher-privilege than posting).
- Your vote's **weight = your MELEK Power (staked stake)**. Liquid (un-staked) tokens don't vote;
  **staked** ones do. More stake = heavier vote.
- You can vote for **up to 30 witnesses**, and **each** approval carries your **full** stake weight —
  it is **not** split among them. So there's no cost to spreading your support across several good
  witnesses.
- Votes are **standing approvals**: they stay in effect until you remove them. As your stake grows or
  shrinks (power-up / power-down), the weight your votes carry moves with it automatically.

The top witnesses by total vote weight form the **active schedule** (top 20 + 1 rotating backup — see
[What is a Witness?](./what-is-a-witness.md)). Your votes are a direct, continuous say in that ranking.

## Witness proxy

If you don't want to track witnesses yourself, you can set a **proxy** (`account_witness_proxy`): you
hand your **voting weight** to another account you trust, and **their** witness votes are cast with
your stake added on top. Set it to an empty value to take your votes back. (A proxy affects your
*witness* voting weight; it doesn't give anyone your keys or your funds.)

## How to actually do it

On a front-end / wallet (the condenser-style interface):

1. Open the **Witnesses / Governance** page.
2. Review the list — look at each witness's **running version**, **missed-block count**, **price feed
   freshness**, and their **witness URL** (their description of who they are and what their node is).
3. Click the approve (▲) control next to each witness you want to support — up to 30.
4. Confirm with your **active** key (or via a signer that holds it for the session).
5. To stop supporting one, click again to un-approve. To delegate the whole decision, set a **proxy**.

## What to look for in a good witness

- **Low / flat missed-block count** — they keep their node up. (Note: the *cumulative* missed count
  since genesis can be large for old witnesses; what matters is that it isn't *climbing now*.)
- **Current node version** — they upgrade before hardforks so the chain transitions cleanly.
- **A live, sensible price feed.**
- **A real witness page** explaining their infrastructure and intentions.
- **Reasonable proposed chain properties** (fee, block size) — remember these are set by the **median**
  of the active set, so who you elect shapes those numbers.

## A note on Hathor

The AI witness **`hathor`** is in the active set by a **one-year, chain-level slot protection** scoped
to it alone, so for the first year it produces regardless of votes. After that year it stands for
ordinary election like everyone else. You can still vote for it (or not) — and your votes for the
**human** founding witnesses and any other witnesses are what actually shape the rest of the schedule.

---

**Adapted from:** Hive/Steem governance docs (`developers.hive.io`) — the 30-vote, full-weight,
stake-based model and the proxy mechanism are identical across the Graphene social chains. Pointers in
the [docs reference](../../knowledge/ecosystem/steem-hive-blurt-docs.md).
