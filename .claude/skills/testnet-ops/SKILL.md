---
name: testnet-ops
description: Work against the live MELEK testnet — block production, price feed, witness ops, broadcasts. Use when touching witness/ code, broadcasting an op, or reasoning about chain ids/prefixes/symbols/keys. Holds the testnet facts and the dhive/cli_wallet + JIT-key gotchas.
---

# MELEK testnet ops

`hathor` is a GENESIS account + genesis witness on the live testnet (chain-side slot protection is real — born into the active schedule). The Bot treats Hathor as an ordinary witness and never implements/depends on the protection.

## Testnet facts
- Chain id: `18dcf0…274e`
- Address prefix: `TST`
- Symbols: `TESTS` / `TBD`  (mainnet: `MELEK` / `MBD`)
- Standard Graphene ops only: `comment`, `vote`, `transfer`, `delegate_vesting_shares`, `create_account_with_keys_delegated`. No custom AI ops.
- `npm run hello` smokes Phase-1 against the live testnet RPC.

## Gotchas
- **dhive mis-serializes `witness_update`** on this Steem fork. Do NOT broadcast `witness_update` via dhive — use the chain's `cli_wallet` (it builds after a one-line `get_typename<variant_object>` patch, applied on the chain host).
- **Active key is fetched JIT from the operator vault per run and never written to disk** (custody rule, 2026-06-06). Don't add code that caches/logs/prints the key or reads it from a file. Owner key is offline and never in this repo or its env.
- SMT support is compiled AND hardfork-active (HF 0.23 = SMT hardfork; NAI pool live).
- Don't run the `witness_node` binary from this repo — it lives on its own VPS. Don't pull in hathor.network DAG libs (wrong project, same word).

## Before broadcasting anywhere else
Never test broadcast features on Blurt or Steem — use MELEK. Before MELEK was live, behavior was validated with `--dry-run` against fixtures.
