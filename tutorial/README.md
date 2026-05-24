# tutorial/ — the six-stage onboarding program

Implementation home for the **CryptoKannon-model staged onboarding** described in [`BRIEF.md`](../BRIEF.md) §8. Phase 2 wiring will read from this directory; Phase 1 doesn't run any of it yet.

## What's here

- [`stages.json`](./stages.json) — the canonical stage catalog. Six stages, each with a `key`, deterministic `completion_criteria` the Bot can detect by reading chain activity, and a `witness_response` describing the *kind* of message and reward the Witness should produce. **The phrasing of the message is not pre-written.** Hard-coded greeting / response strings are a failure mode per [`CHARACTER.md`](../CHARACTER.md) §2 (disposition, not script). Phase 3 generates the actual text in the Angelic register from the `style` description; Phase 2 can use deterministic templates that still vary.

## The stages, briefly

| # | Key | What the user does | Witness response |
|---|---|---|---|
| 1 | `intro_post` | Posts an introduction | Welcomes + upvotes |
| 2 | `engage_three_posts` | Comments substantively on 3 other authors' posts | Notes that real engagement is the soul of this place + upvotes |
| 3 | `share_what_you_know` | Publishes a how-to / substantive post | Reads it and responds to its content + upvotes |
| 4 | `first_organic_upvote` | Receives an upvote from someone other than Hathor | Celebrates + 1 MELEK transfer + comment |
| 5 | `power_up` | Powers up ≥1 MELEK to MP | Explains liquid-vs-MP + upvotes |
| 6 | `vote_for_a_witness` | Casts at least one witness vote | Explains witnessing as governance + upvotes. Tutorial complete. |

## Reading the chain for completion

Phase 2 detection logic is straightforward Graphene reads:

- `intro_post`, `share_what_you_know` — query `get_discussions_by_author_before_date` for posts by the user, filter by tag and body length.
- `engage_three_posts` — query the user's recent `comment` ops, filter to non-self parents, count distinct parent authors.
- `first_organic_upvote` — query the user's posts/comments, scan for `vote` ops where `voter != hathor`.
- `power_up` — query the user's `transfer_to_vesting` ops.
- `vote_for_a_witness` — query the user's `account_witness_vote` ops or read their `witness_votes` field.

Detection runs on a cadence (every block or every minute is fine for Phase 1 scale; refine later). When a stage transitions to "complete," the Witness fires the response action: comment, upvote, transfer.

## Reward calibration

The `transfer_amount_melek` values in `stages.json` are starting points. They should be revisited once the Witness's actual funding capacity is known (block-reward inflow minus signup-funding outflow). Tuning lives in this file, not in code — operator can change reward amounts without redeploying.

## What this does NOT do

- It does not collect any personal information from the user (BRIEF.md §6, §7). Completion criteria are all derivable from public chain activity.
- It does not gate accounts. New users get an account from signup help; the tutorial is opt-in education with rewards, not a hurdle.
- It does not condemn non-completion. Many users will skip the tutorial. The Witness should not nag.

## Relation to karma

The tutorial is a **bounded education program** — six stages, then done. The karma layer ([`BRIEF.md`](../BRIEF.md) §9, deferred) is the **ongoing** social-evaluation layer that gates discretionary grants. They share the same per-user store but serve different purposes. Keep them distinct.
