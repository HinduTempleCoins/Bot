# MELEK-Signer — Design Brief

**Status:** design only, no code yet. Captures the resolved-as-of-2026-05-27 architecture for how the MELEK AI Witness signs on-chain operations.

**Companion docs:** `BRIEF.md` (the founding brief — load-bearing), `SECURITY.md` (current threat model — the "active key as env var" sections are obsoleted by this brief and need rewriting whenever they're next touched), `OPERATOR.md` (deploy runbook — same).

**One-line summary:** Hathor's keys never live on the Bot host or in this repo. All signing goes through a separate **MELEK-Signer** service that holds the keys behind hardware-tied cloud-KMS encryption. The Bot holds an opaque revocable bearer token, nothing more.

---

## 1. Why this design exists

The MELEK AI Witness (`hathor`) needs to:
- Comment and vote constantly (welcomer, tutorial responses, curation).
- Transfer 5–15 MELEK to every fresh-account signup, at signup volume.
- Vote witnesses and governance with the bulk of its MP (active-authority op on Graphene).
- Periodically replenish operating budget from a treasury.

Doing this naively means a Graphene WIF private key lives in an `.env` file on the Bot's server. That file:

- Has been the source of every key leak the operator has actually suffered. The `angelicalist` Hive account leak (commit `b4c4e55`, 2026-01-10) was a WIF in a markdown file — public for ~4.5 months before anyone noticed.
- Is reachable from: the repo, every clone of the repo (laptop, backup, sync service), every developer who can read the deploy box, the VPS provider, the VPS backup system, anything that reads process env (logs, stack traces, IDE plugins, AI assistants).
- Cannot be made safe by making the repo private. **The file is the problem, not the repo's visibility.** Private repos solve one leak path (random scrapers); the other paths remain.

The operator-side constraint is therefore **stronger than "encrypt the .env" or "small blast radius per key":** the goal is **zero WIF private keys on the Bot host or in this repo, ever, by construction**. If a WIF can't be there, it can't leak from there.

Operator can't keep their laptop online 24/7, so designs that route every signing through their hardware wallet are out of scope for the high-frequency ops. Signing has to be VPS-resident for daily traffic.

## 2. Threat model

Layered, weakest to strongest:

| Scenario | Old design (WIF in `.env`) | This design (MELEK-Signer + KMS) |
|---|---|---|
| This repo accidentally goes public | Total loss (the keys are right there) | Zero loss (no keys in repo) |
| Laptop with a clone is stolen | Total loss | Zero loss |
| Bot host SSH compromised | Total loss | Attacker has the bearer token. Revoke at MELEK-Signer; budget capped at policy limit until then. |
| Bot host disk image leaked / backup leaked | Total loss | Zero loss (no keys on Bot host) |
| MELEK-Signer disk stolen | n/a (single point) | Zero loss (KMS-wrapped blob is opaque; KMS won't unwrap for a different VPS) |
| MELEK-Signer SSH compromised, running memory readable | n/a | **Bounded.** Live key is in memory; policy engine still refuses any op outside the signup-grant envelope; watcher pages operator on any out-of-policy op that does hit the chain. Worst case = one replenishment cycle's worth of grants drained. |
| Cloud KMS provider rogue | n/a | Cloud KMS can unwrap for the configured instance role; would still need to break into MELEK-Signer to use it. Threat assumed lower-probability than per-host compromise. |
| Operator laptop + hardware wallet compromised at the same time | Total loss eventually | Same — this is the irreducible trust root. Owner key paper backup is the break-glass. |

The watcher built into this repo on 2026-05-27 (`watcher/`) is the alerting layer for all of these. It's read-only, holds no keys, and pages the operator within seconds of any sensitive op (`transfer`, `account_update`, `withdraw_vesting`, `delegate_vesting_shares`, `witness_update`) by Hathor.

## 3. Architecture

Three boxes, one job each, no WIFs at rest on any of them in plaintext.

```
┌────────────────────┐     bearer token      ┌─────────────────────┐
│   Bot host         │  ───────────────────► │   MELEK-Signer      │
│   (this repo)      │   "sign these ops"    │   (separate repo,   │
│   - welcomer       │  ◄─────────────────── │    separate VPS)    │
│   - tutorial       │   signed broadcast    │                     │
│   - signup helper  │                       │   - KMS-wrapped key │
│   - chain-reader   │                       │   - policy engine   │
│                    │                       │   - audit log       │
│   NO WIFs.         │                       │                     │
└────────────────────┘                       └──────────┬──────────┘
                                                        │
        ┌───────────────────────────────────────────────┘
        │      KMS unwrap at boot (instance role)
        ▼
┌────────────────────┐                       ┌─────────────────────┐
│   Cloud KMS        │                       │   Watcher           │
│   (AWS / GCP /     │                       │   (this repo,       │
│    Azure / etc.)   │                       │    separate VPS)    │
│                    │                       │                     │
│   - holds master   │                       │   - read-only       │
│     wrap key,      │                       │   - alerts on every │
│     bound to       │                       │     sensitive op    │
│     MELEK-Signer's │                       │   - JSONL + Telegram│
│     instance role  │                       │     + Resend email  │
└────────────────────┘                       └─────────────────────┘
```

### 3a. Hot signer (MELEK-Signer, VPS, always-on)

Holds:
- Hathor's **posting key** — used to sign `comment`, `vote`, `custom_json`.
- A **scoped active key** — used to sign `transfer` ops, but only via the policy engine (see §3c).

Both keys live encrypted at rest. Decrypted into memory at boot via cloud-KMS unwrap that is bound to MELEK-Signer's verified VPS instance role. Stolen disk → opaque blob. Cloned VPS → KMS refuses the unwrap.

Exposes one HTTPS endpoint (mTLS or Wireguard-only from the Bot host):

```
POST /v1/broadcast
Authorization: Bearer <opaque-token-issued-at-setup>
Content-Type: application/json

{ "ops": [["transfer", { ... }]], "client_ref": "signup-grant-alice-2026-05-27" }
```

Returns the signed-and-broadcast result. Token is scoped — e.g., the Bot's signup token can request `transfer` ops but only matching the signup-grant policy below; the Bot's tutorial token can request `comment`/`vote` only.

### 3b. Cold signer (operator's laptop + hardware wallet, only online when invoked)

Holds:
- Hathor's **treasury active key** (replenishes the hot signer's grant budget).
- Hathor's **owner key** (rotates everything on a compromise).

Lives on a hardware wallet (Ledger / YubiKey-FIDO2 / phone Secure Enclave). Operator brings their laptop up only for:
- Replenishing hot signer's MELEK budget (cadence: weekly or whenever it dips).
- Witness updates (changing signing key, URL, props).
- Key rotation in response to a watcher alert.

These ops are rare enough that human-in-the-loop is acceptable.

### 3c. Policy engine (inside MELEK-Signer)

Every incoming request runs through a policy checker *before* the key sees it. The active-key-scoped token enforces, at minimum:

- **Op kind whitelist.** Only `transfer` allowed via this token. Never `account_update`, `withdraw_vesting`, `delegate_vesting_shares`, `transfer_to_savings`, `account_create_with_delegation` (those go through cold signer).
- **Recipient allowlist by behavior, not by name.** The recipient must be an account whose creation block is within the last 24h. (Chain lookup — MELEK-Signer can do this itself, doesn't need the Bot to assert it.)
- **Amount band.** Strictly within `[5.000 MELEK, 15.000 MELEK]`. Outside → rejected, alerted.
- **Per-recipient cap.** One signup grant per `to` account, ever. Replays / second-attempts rejected.
- **Per-day cap.** Configurable — say 100/day for sane signup throughput. Sliding window. Defends the "attacker creates lots of throwaway accounts to drain via legitimate-looking grants" path.
- **Audit log.** Every accepted op AND every rejected op append-logged to a separate file. Watcher and MELEK-Signer's audit log are independent observability paths.

Compromise of MELEK-Signer's running process (root, memory read) → attacker can use the live key to sign — but the policy engine still gatekeeps. Bypassing the policy engine requires changing the running binary, which is a separate attack step and one whose logs the operator can detect.

### 3d. Audit + alerting (the watcher, already built)

The `watcher/` module in this repo (built 2026-05-27, 79 passing tests) is independent of MELEK-Signer. It reads the chain directly and alerts on any sensitive op by Hathor, regardless of who signed it. Two purposes:

1. **Defense in depth.** Even if MELEK-Signer is compromised AND its policy bypassed, an attacker-driven op on chain triggers the watcher and pages the operator within seconds.
2. **Provider trust verification.** If cloud KMS or MELEK-Signer's host provider somehow signed an op without operator authorization, watcher catches it.

Watcher should run on a *third* VPS — not the Bot host, not MELEK-Signer — so compromise of one doesn't silence the other. Operator could also run a watcher on their own laptop for redundancy (read-only, no risk).

## 4. Why cloud KMS, and not "just encrypt the file"

A naïve "encrypt the .env" approach (e.g. age or GPG with a passphrase the operator types at boot) doesn't get us where we want:

- **Operator can't be available for every reboot.** The whole point of the laptop-can't-be-on-24/7 constraint is no manual unlock.
- **Passphrase-derived encryption is brute-forceable** if the encrypted blob ever leaks.
- **No revocation.** If MELEK-Signer's disk is exfiltrated, you can't tell the encryption "don't allow further unwraps." With KMS, you delete the key in the KMS console and existing wrapped blobs become permanently opaque.

Cloud KMS gives us:

- **Hardware-backed root.** AWS KMS, GCP Cloud KMS, Azure Key Vault all back their master keys with HSMs at the provider level. The wrap key is generated and never leaves the HSM.
- **Identity-bound unwrap.** Only the configured VPS instance role can unwrap. Wrong machine → KMS returns AccessDenied. No password to phish.
- **Audit log.** KMS itself logs every unwrap call. If a wrap key gets called for unwrap from a machine that isn't MELEK-Signer, operator sees it.
- **Revocable.** Delete the KMS key, every wrapped blob in existence becomes opaque forever.
- **Cheap.** Single-digit dollars/month at this volume.

Provider-agnostic: AWS KMS is the most battle-tested; GCP Cloud KMS and Azure Key Vault are equivalent. Hetzner / DigitalOcean don't have first-party KMS but you can call AWS KMS from a non-AWS host. Pick whichever fits operator's existing cloud relationships.

## 5. Bootstrap flow (one-time operator action)

1. **Generate hardware-wallet-rooted keys** for `hathor`'s active (treasury-tier) and owner authorities. These never leave the hardware wallet.
2. **Generate the hot-signer keys** — Hathor's posting key and the scoped active key for signup grants — on the operator's laptop, in a single session.
3. **Wrap the hot-signer keys** with cloud KMS, output the opaque blob.
4. **Deploy MELEK-Signer's VPS** with the wrapped blob bundled in the deploy. Configure its instance role to allow the KMS unwrap.
5. **Issue a token** for the Bot's use. Save it in the Bot's `.env` as `MELEK_SIGNER_TOKEN`. Token is opaque, revocable, scope-limited.
6. **Operator closes the laptop.** Daily ops now flow Bot → MELEK-Signer → chain, with no further laptop involvement.

For the cold signer (treasury / owner), the keys never get a "deploy" step — they live on the hardware wallet and the operator brings them online by plugging in the device.

## 6. What this changes about the current Bot repo

Items that need to come out or change as part of implementing MELEK-Signer:

- **`.env.example`**: remove `HATHOR_ACTIVE_KEY` and `HATHOR_POSTING_KEY`. Add `MELEK_SIGNER_URL` and `MELEK_SIGNER_TOKEN`.
- **`BRIEF.md §7`**: the "Active key: server-side env var on the Witness's own host" language is wrong under this design and gets retracted. New language: "All signing is delegated to MELEK-Signer (see `MELEK_SIGNER.md`); the Bot holds only a scoped bearer token."
- **`SECURITY.md §3` (key custody)**: rewritten to match the new model.
- **`OPERATOR.md`**: deploy steps rewritten — no `.env`-WIF step; instead, a "issue and install MELEK-Signer token" step.
- **`src/chain/`** and **`witness/`** broadcast paths: today they do `Client.broadcast.sendOperations(ops, wif)`. They become `melekSigner.broadcast(token, ops)`, where the signer client is a small HTTP wrapper around the MELEK-Signer API.
- **`welcomer/`**, **`signup/`**: any broadcast path replaces local signing with the signer client call.

None of this affects the **read-only** parts of the Bot — chain-reader, tutorial detector, watcher, the welcomer's discovery logic, and the price-feed observer all stay as-is.

## 7. Open decisions for operator

These can be answered in any order before MELEK-Signer's code starts; none block the watcher or the rest of the Bot's read-only work.

1. **Cloud KMS provider** — AWS, GCP, Azure, or "AWS-from-Hetzner" (latter saves on VPS cost). Default recommendation: AWS for KMS, AWS or Hetzner for the VPS itself.
2. **Hot-signer language/runtime** — Node.js (so it can reuse `@hiveio/dhive` for signing) is the cleanest path. Alternatively Rust for stronger memory guarantees. Default: Node.js.
3. **Hardware wallet choice for the cold signer** — Ledger (broad ecosystem, no native Hive/MELEK app), YubiKey + custom signing flow, phone-only with Secure Enclave, or just air-gapped laptop with `cli_wallet` for v1. Affects what the cold-signer flow actually looks like.
4. **MELEK-Signer repo name and visibility** — proposed `melek-signer` as a sibling private repo of this Bot. Operator confirms.
5. **Daily grant cap (`N/day`)** at the policy layer — what's a realistic ceiling for early MELEK signup volume that still bounds drain? Probably 50–200/day at launch; can be raised later.
6. **Signup grant amount policy** — fixed (e.g., always 10 MELEK), or tiered by tutorial progress (5 default → 10 at Lesson 1 → 15 at Lesson 5)? Affects the policy engine's amount-band logic.
7. **Watcher deployment** — third VPS (rigorous), or co-located on the operator's laptop for v1 (cheap; loses some independence)?

## 8. Build phasing

In order, none of these blocked on the others except where noted:

1. **Watcher in production** — done in code; needs deployment when there's a chain to point at. Independent of MELEK-Signer.
2. **MELEK-Signer brief approved by operator** (this doc) — operator reads, raises any objections, and we lock the design.
3. **`melek-signer` repo skeleton** (separate private repo) — HTTP server + KMS unwrap + policy engine + signing via `@hiveio/dhive`. Fixture-tested before deployment.
4. **MELEK-Signer client in this Bot** — small wrapper that replaces `Client.broadcast.sendOperations`. The change is mostly in `src/chain/graphene.js`.
5. **Refactor `witness/`, `signup/`, `welcomer/`** to broadcast via the client.
6. **Retract WIF-related sections of `BRIEF.md` / `SECURITY.md` / `OPERATOR.md`** in the same PR as #4–#5, so they stay in sync with code.
7. **First-time bootstrap** (operator-side): generate keys on laptop with hardware wallet, KMS-wrap, deploy MELEK-Signer's VPS, issue tokens.

The watcher I just shipped (Phase 1 of operator-facing security) is step 0 — already done.

---

*Brief authored 2026-05-27. Will be updated as decisions §7 land and as the MELEK-Signer repo materializes.*
