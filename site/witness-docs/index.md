# MELEK Witness & Operator Documentation

Plain-language documentation for **everyone** on the MELEK chain — new members, witnesses, node
operators, and anyone forking this work to run their own chain. MELEK is a Graphene-family chain in
the **Steem / Hive / BLURT** lineage (a Steem **HF23** fork), so most of what is true on Hive and
Steem is true here. Where we adapt their tooling we say so and link the upstream source.

> **Our chain's facts** (used throughout these docs): MELEK is a Steem **HF23** fork; **3-second
> blocks**; **single token** (MELEK; no second "dollar" token). The public **testnet** uses the
> address prefix **`TST`** and the symbols **TESTS / TBD** (mainnet will use **MELEK / MBD**). The AI
> witness account is **`hathor`** (lowercase).

## Pages

1. [What is a Witness?](./what-is-a-witness.md) — DPoS, the 21-slot schedule, what witnesses do and why.
2. [How to run a MELEK witness](./how-to-run-a-witness.md) — block production, the price feed, `witness_update`, monitoring.
3. [How to create an account](./how-to-create-an-account.md) — the claimed-account flow and the faucet.
4. [Keys explained](./keys-explained.md) — owner / active / posting / memo, and how to stay safe.
5. [How to vote for witnesses](./how-to-vote-for-witnesses.md) — governance: who produces your blocks.
6. [Resource Credits explained](./resource-credits-explained.md) — why posting is "free," and how RC works.
7. [Running a seed / API node (HAF)](./running-a-node.md) — seed nodes, API nodes, and the HAF stack.

## Credits & upstream sources

These docs adapt the public work of the Hive, Steem, and BLURT communities. Heaviest debts:

- **Someguy123** — `hive-witness-essentials`, `hivefeed-js`, `hive-docker` (the witness-operator playbook).
- **Hive core teams** — `developers.hive.io`, HAF, hivemind, condenser/denser, the account-creator service.
- **xeroc** — the Graphene base libraries that define the transaction/key format every fork shares.
- **DoctorLai, mahdiyari, emre, ericet** — witness monitoring, failover, and RPC-health tooling.

Developer-side pointers (libraries, READMEs, portals) are catalogued in
[`knowledge/ecosystem/steem-hive-blurt-docs.md`](../../knowledge/ecosystem/steem-hive-blurt-docs.md),
with the cloned-repo index in
[`knowledge/ecosystem/steem-hive-dev-repos.md`](../../knowledge/ecosystem/steem-hive-dev-repos.md).

For chain terminology, see the [MELEK glossary](../../MELEK.md). For the project's founding brief,
[`BRIEF.md`](../../BRIEF.md).

_These are public docs: they intentionally contain no hostnames, IPs, server paths, or key material.
Operational specifics live in the operator's private notes._
