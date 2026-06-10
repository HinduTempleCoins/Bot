# MELEK Private Mail — design (task #279)

A private messaging / mail layer for the condenser (alpha.melek.salon). It lets accounts talk
**privately**: first the bots (Cheetah / Hathor) opening a one-to-one follow-up thread off a
moderation flag, then staff↔staff, and — by config — eventually everyone.

Files:
- `integrations/private-mail.mjs` — the transport + access module (compose / read / thread / tier).
- `integrations/private-mail-server.mjs` — a minimal `handler(req,res)` inbox relay (no framework).
- `integrations/private-mail.test.mjs` — offline `node --test` suite (21 tests).

## How privacy works (Graphene-native, no custom op)

A private message is a standard **`custom_json`** op with id **`melek_pm`**. The subject + body are
packed into one JSON blob and **encrypted to the recipient's MEMO public key** using the same ECIES
scheme Steem/HIVE/BLURT memos use (dhive `Memo.encode` / `Memo.decode`). The sender encrypts with
their memo **private** key + the recipient's memo **public** key; only the recipient (holding the
matching memo private key) can decrypt.

The on-chain `json` carries only **routing metadata in the clear** — `from`, `to`, `thread`, `ts`,
and the opaque `ct` (ciphertext). Verified end-to-end against real dhive ECIES, not just the test
stub.

```
{ "v":1, "from":"hathor", "to":"alice", "thread":"pm_…", "ts":"…", "ct":"#<ecies-ciphertext>" }
```

Nothing in this module broadcasts. `composeMessage()` returns the op; broadcasting goes through
MELEK-Signer like every other write (zero WIF on the Bot host).

## The zero-plaintext-on-server rule (load-bearing)

The relay server **never encrypts, decrypts, or sees a private key.** All crypto is client-side (in
the condenser browser, with the user's own memo key):

- **`POST /pm/send`** accepts a message whose body is **already ciphertext** (`ct`). It **rejects**
  any payload that carries a plaintext field (`subject`/`body`/`plaintext`) — that would mean the
  client tried to make the server encrypt, which we refuse by construction. The server stores the
  sealed envelope only.
- **`GET /pm/inbox?account=X`** returns the sealed envelopes addressed to X **as ciphertext**. The
  recipient decrypts in their browser. The server cannot read anything it relays.

This mirrors `signup/server.mjs` custody: zero keys, zero broadcast. The relay store exists so an
offline recipient can still pick up a message; it holds sealed envelopes only — never plaintext,
never keys. Keys are never logged (encrypt failures return a generic `encrypt-failed`, never the
key).

## report → private conversation (`threadFromFlag`)

`threadFromFlag(flagId, { store })` reads a `moderation-flags.mjs` entry (read-only — it does **not**
change the flag's status; that stays the moderator's `resolveReport` action) and derives a stable,
flag-scoped thread id between the agent (default `hathor`) and the user side (the flag's reporter, or
the `@account` parsed from the target). The thread is salted with the flag id, so a second report
opens a distinct thread rather than reusing the first conversation. This is the "report this → Hathor
DMs the user about it" path.

## Tiered access — staff today, everyone by config later

`canMessage(senderRole, recipientRole, { allowAllUsers })` is the one switch that expands the system
from a staff pilot to a public feature **without a code change**:

| sender ↔ recipient | default (staff pilot) | `allowAllUsers: true` |
|---|---|---|
| bot ↔ admin | allowed | allowed |
| admin ↔ admin | allowed | allowed |
| bot ↔ bot | allowed | allowed |
| anything with a plain `user` | **blocked** | allowed |

Roles are `bot` / `admin` / `user`; an unknown role is treated as the least-privileged `user`. The
server reads the flag from `PM_ALLOW_ALL_USERS=1` (default OFF) and maps account→role via an
injectable resolver (`__setRoleResolver`) so production can plug in the real admin allow-list.

**Rollout path:** (1) bots↔admins only — Cheetah/Hathor flag follow-ups; (2) flip the role resolver
to recognize all admins — admin↔admin coordination; (3) set `PM_ALLOW_ALL_USERS=1` — public DMs for
all users. Same module, same op, same crypto throughout.

## Abuse / safety

- `POST /pm/send` is rate-limited per-IP + per-sender (`integrations/rate-limit.mjs`, soft-fails open).
- Subject capped 256, body capped 8192.
- CORS locked to the condenser origin (`PM_ALLOWED_ORIGIN`, default `https://alpha.melek.salon`).
- Everything injectable (store / clock / crypto / rate-limiter / role-resolver) → fully offline tests.

## What still needs live wiring

- Broadcasting the `melek_pm` op to MELEK via MELEK-Signer (deferred with the rest of signing, #266) —
  the on-chain durable copy. The relay store covers the offline-pickup case meanwhile.
- A condenser-side compose/inbox UI that does the client-side `Memo.encode`/`Memo.decode` with the
  user's memo key (the server only ever sees ciphertext).
- A durable relay store (the default is an in-memory ring) and a real account→role resolver.
- Optional: an indexer that reads `melek_pm` custom_json ops off the chain to populate inboxes from
  on-chain history rather than (or alongside) the relay store.
