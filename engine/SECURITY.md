# Melek-Engine — Security Posture

Melek-Engine is a Hive-Engine-style L2 token sidechain anchored to the MELEK
Graphene chain. This document maps the implementation to the security study
(`.local/MELEK_ENGINE_SECURITY_STUDY_2026-06-05.md`) checklist §6 and records the
deliberate divergences. **Read the study first.**

## The one rule that matters most: no untrusted code path

Hive-Engine's single biggest lesson was the **vm2 → isolated_vm** mandatory
consensus upgrade (`ivm_v1.0.0`, Feb 2024) — because HE executes **arbitrary
user-uploaded JS contracts**, and vm2 had repeated sandbox-escape CVEs.

**Melek-Engine ships ONLY built-in, first-party contracts** (`tokens`, plus the
two gated PRANA seams). Users cannot deploy contract code. There is therefore
**no untrusted-code execution path at all**, which removes the entire
sandbox-escape bug class by construction — a stronger position than sandboxing.

> If user-deployable contracts are ever added, they MUST run in `isolated_vm`
> (a true V8 isolate), **never vm2**, with memory + CPU caps and no
> network/fs/clock/randomness except a deterministic `api.random()` seeded from
> L1 block data. This is non-negotiable per the study.

## Checklist compliance (§6)

### A. L1 anchoring & issuer auth
1. **Issuer auth from L1 only** — `streamer.extractOps` derives the signer
   strictly from the op's auth arrays (`required_auths`/`required_active_auths`
   for active, `required_posting_auths` for posting). The payload's contents are
   never trusted for identity. Value-moving ops require active auth
   (`engine.ACTIVE_REQUIRED`). *(tested: "signer taken from op, never from payload")*
2. **Pinned, namespaced sidechain id** — `config.sidechainId` =
   `mse-testnet-melek` (mainnet will be `mse-mainnet-melek`); testnet/mainnet
   can't cross-replay.
3. **Failover RPC array + chain-id pin** — `config.rpcNodes` is a list;
   `streamer.verifyChain` refuses to replay if `chain_id` ≠ the pinned value.

### B. Deterministic execution
4. **No untrusted VM** — see above. The engine is pure: no network/clock/random
   inside contract execution.
5. **Single-threaded, in-L1-block-order** — `streamRange` processes blocks
   sequentially; `Engine.process` is synchronous. Double-spend impossible by
   construction. *(tested: "determinism: same op sequence → identical state hash")*
6. **Integer/precision discipline** — all balances are `BigInt` base units
   (`lib/decimal.mjs`); no float ever touches a balance. Precision 0–8;
   maxSupply capped at `Number.MAX_SAFE_INTEGER` whole units. *(tested)*

### C. State integrity & verifiability
7. **State hashing + published checkpoint** — `State.hash()` is a SHA-256 over a
   deterministically-serialised (sorted-key) state; published at `/status`.
   Anyone can replay from genesis and compare. Snapshots are *verifiable*, not
   *trusted*.
8. **Genesis replay tested** — `engine/test/live-broadcast.mjs` replays real L1
   blocks into a fresh engine and asserts the lifecycle; unit tests replay
   op sequences. (Snapshot-restore: the state file is a plain JSON snapshot.)

### D. Witness / verification layer
9. **Round-based hash agreement** — DEFERRED. The single-node testnet publishes
   per-block state hashes so independent replays can already detect divergence;
   the HE-style 9/11 witness attestation is a mainnet item (see Deferred).
10. **Signing key off the hot box** — the engine node **holds no key** and never
    broadcasts. It is read-only against L1. The UI signs **client-side** in the
    browser; the server never sees a WIF. This satisfies the zero-WIF rule and
    diverges on purpose from HE's plaintext-`.env` witness key.

### E. Abuse / DoS
11. **Per-account L1→L2 rate metering** — `config.freeTxPerAccountPerBlock` free,
    then a `resourceFee` burn in APIS, hard ceiling `maxTxPerAccountPerBlock`
    (20, matching HE `he_v2.0.3`). *(tested: "rate metering")*
12. **Public RPC rate limit** — per-IP `rateLimitPerMin` in `api/server.mjs`,
    plus standard security headers; no native deps to CVE.
13. **Fee token with creation-fee burns** — APIS; token creation burns
    `config.tokenCreationFee`. *(tested: "create charges 100 APIS fee")*

### F. Token economics safety
14. **Issuer-only issue + immutable cap option + issuance log** — `tokens.issue`
    is issuer-restricted; `supplyCapImmutable` can never be exceeded; every issue
    appends to `issuanceLog` (the themarkymark fix HE never enforced).
    *(tested: "issuer-only", "DRONE immutable cap")*
15. **Separate supply-control vs operations keys** — engine holds no keys;
    first-party accounts (issuer) manage this at the L1 key level.
16. **Vested/staggered offerings** — DEFERRED (HE's 12-week-airdrop pattern); the
    `stake`/`unstake` buckets and issuance log are the primitives a future
    `airdrops`/`distribution` contract builds on.

### G. Backup / ops
17. **Snapshots** — state is a single JSON file; the systemd deploy backs the
    data dir. (Mainnet: signed snapshots + restore runbook.)
18. **L1 unavailability = liveness event, not state event** — `streamRange`
    breaks on a missing block; `node.mjs` logs "L1 unreachable, will retry" and
    never fabricates sidechain blocks. State only advances on real L1 blocks.

## The two PRANA-DEX seams (study §7) — present but GATED OFF
- **Seam 1 — gateway** (`contracts/seams.mjs`): pegged-asset deposit→mint /
  withdraw→burn bookkeeping. Engine never holds foreign keys.
- **Seam 2 — dexSettlement**: signed-fill settlement/escrow primitive for the
  PRANA matcher. Engine verifies a fill receipt and moves tokens; never runs an
  orderbook or computes a price.
- Both are disabled (`config.seams.*.enabled = false`) and require a
  **registered, revocable, rate-limited capability account**. Melek-Engine runs
  **NO DEX**; PRANA owns all price discovery and matching. *(tested: "seams disabled")*
