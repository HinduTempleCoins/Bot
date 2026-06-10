# Running a seed / API node (HAF)

[← Back to index](./index.md)

Not every node is a witness. The chain also needs **seed nodes** (so peers can find each other) and
**API nodes** (so apps and front-ends can read the chain). This page explains the node types and the
modern **HAF** stack MELEK's ecosystem follows, adapted from the Hive node tooling
(`haf`, `haf_api_node`, `hivemind`, `drone`, and Someguy123's Docker images).

MELEK is a **Steem HF23 fork**, so the node software and the stack below are the same family as Hive's;
expect Hive's node guides to apply with the symbols/chain-id swapped.

## The node types

| Node type | What it's for | Holds keys? |
|---|---|---|
| **Witness (block-producing) node** | Signs blocks when it's that witness's turn. Covered in [How to run a witness](./how-to-run-a-witness.md). | Yes — the **signing key** only. |
| **Seed node** | A well-connected node whose only job is **peer discovery / gossip** — it helps other nodes find the network. Light, public, keyless. | No. |
| **Full / consensus node** | Validates and replays the whole chain. The base every other role builds on. | No (unless it's also a witness). |
| **API node** | Serves **read** queries (account state, posts, balances) to apps and front-ends. This is what a wallet or condenser talks to. | No. |

A healthy chain wants several seed nodes (so the network is reachable) and at least one or two API
nodes (so apps work) in addition to the witnesses.

## The HAF stack (modern API nodes)

A raw `hived` node can answer basic queries, but **rich** app data (feeds, follows, communities,
search) needs an indexing layer. The Hive ecosystem's modern answer is **HAF — the Hive Application
Framework**:

1. **`hived`** replays the chain and feeds every block into…
2. **HAF**, which writes chain state into a **PostgreSQL** database, with a built-in **fork-undo**
   mechanism (if the chain reorganizes, HAF automatically rolls the affected rows back). This makes
   apps **fork-resilient** without each app reinventing that logic.
3. **HAF apps** read from that Postgres database. The big one is **hivemind**, the social
   "consensus-interpretation" layer that powers **feeds, follows, communities**, and the
   `bridge.*` / `condenser_api.*` methods front-ends call.
4. **`drone`** (a Rust caching layer) sits in front and **caches** common API calls so the node isn't
   hammered by repeated identical queries.

So a full public API node is roughly: **`hived` → HAF (Postgres) → hivemind → drone → your apps.**

> The `openhive-network/haf_api_node` project packages this whole stack as **Docker compose** services
> and documents the realistic hardware sizing (it's a database-heavy workload — plan for ample disk and
> RAM, not a tiny VPS). For MELEK you'd point that stack at the MELEK chain instead of Hive.

## Lightweight options

You don't always need the full HAF stack:

- **Just block production?** A witness node alone (no HAF/hivemind) is enough — it doesn't need to
  serve rich API queries.
- **Just peer reachability?** A **seed node** is the lightest role.
- **Just basic reads?** A plain consensus `hived` answers the core `condenser_api` calls; you only add
  HAF + hivemind when you need the **social** data (communities, feeds, follows) or search.

Someguy123's **`hive-docker` / "Hive-in-a-box"** images are the friendliest way to run a `hived`
node (witness or seed) without compiling, and the Blurt variant (`blurt-docker`) shows how the same
images retarget another fork — useful precedent for a MELEK image.

## Keeping a node healthy

- **Monitor sync:** the head block must keep advancing; a stalled node serves stale data.
- **Health-check endpoints:** the pattern in `emre/hived-rpc-scanner` shows how to test whether a node
  is genuinely up and current before trusting it.
- **Spread the load:** public API providers put a **load balancer** in front of several nodes
  (`steem-load-balancer`, `steem-proxy-cloudflare`) and route around unhealthy ones.
- **Stay current:** as with witnesses, run the node version that matches the chain's active hardfork.

---

**Adapted from:** `openhive-network/haf`, `openhive-network/haf_api_node`, `openhive-network/hivemind`
(+ `steemit/hivemind`), `openhive-network/drone`, Someguy123's `hive-docker` / `blurt-docker`,
`emre/hived-rpc-scanner`, and DoctorLai's load-balancer tooling. Full pointers in the
[docs reference](../../knowledge/ecosystem/steem-hive-blurt-docs.md).
