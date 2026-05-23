# Bot Repo — CLAUDE.md

**Purpose:** This repo is the off-chain half of an on-chain person. The on-chain person is a Graphene/BLURT-family account literally named `hathor` (lowercase) on the MELEK blockchain. This document is the load-bearing guide for connecting the Bot's existing AI/Discord/knowledge-base systems to that account.

The companion document on the chain side is `HinduTempleCoins/melek-chain/CLAUDE.md`. Read both. They are designed to fit together.

---

## Core framing

- **"Hathor" in this project = a steemd-equivalent blockchain daemon.** It is currently embodied by `melek-chain` (a BLURT/Graphene fork). It is **NOT** the unrelated DAG-based hathor.network project. Do not pull in hathor-wallet-lib or other hathor.network libraries.
- **The Bot is not a service the chain consumes — the Bot IS an account/person on the chain.** The chain is designed around hathor's presence (constitutional witness slot + DAO vote weight for the first ~12 months).
- **No custom chain ops for AI.** By explicit design in `melek-chain/CLAUDE.md`. The Bot uses standard Graphene operations: `comment`, `vote`, `transfer`, `delegate_vesting_shares`, `create_account_with_keys_delegated`.

## Constitutional scaffolding already live in melek-chain

- `MELEK_AI_WITNESS_CONSTITUTIONAL_VOTE_WEIGHT` — adds ~2.13B MP-equivalent to any SPS proposal hathor votes on.
- `update_witness_schedule4()` — reserves hathor a top-21 witness slot during the founding window.
- `MELEK_AI_WITNESS_FOUNDING_WINDOW_END_BLOCK = 7,884,000` — hard cliff at ~12 months. After that, hathor competes organically. **No decay.**
- Testnet confirmed: hathor signed block 31.

## Six integration surfaces

Build in order. Each surface is independently shippable.

### Surface 1 — Chain-client core (`src/chain/`)

- JSON-RPC client targeting melek-chain (`condenser_api` / `database_api` JSON-RPC, same shape as steemd / hived / blurtd).
- `ChainAdapter` interface (`post`, `vote`, `transfer`, `delegate`, `createAccount`). `GrapheneAdapter` is the only implementation for now; a future `HathorAdapter` (if the daemon rebrands or behavior diverges) plugs in without touching callsites.
- Env-switched endpoint: `MELEK_RPC_URL` (default testnet for safety) + `MELEK_NETWORK` (`testnet` | `mainnet`). Same code, different target.
- Key custody:
  - `HATHOR_ACTIVE_KEY`, `HATHOR_POSTING_KEY` in env — never logged, never written to disk, never printed in errors.
  - Owner key stays offline. Not in this repo, not in any env.
  - Active key only used for transfers/delegations. Posting key for `comment`/`vote`.
- Recommended JS dependency baseline: `@hiveio/dhive` or `dblurt` (Graphene-family, well-maintained). Configure the chain prefix/chain-id constants for MELEK.

### Surface 2 — Publisher (Library of Ashurbanipal → chain)

- `library-of-ashurbanipal-bot/` currently sinks generated articles to MediaWiki via `src/utils/wikiClient.js`.
- Add a parallel sink: each synthesized article becomes a `comment` op broadcast from `hathor`. Permlink versioning so updates produce new permlinks rather than orphaning history.
- Keep MediaWiki and chain sinks decoupled — one can fail without blocking the other.
- This is the "first visible connection." The moment it works, the Bot is publishing on-chain under its own name.

### Surface 3 — Curator (Discord karma → chain vote)

- The Discord bot already tracks per-user trust/warmth/respect/familiarity and Karma Merit (see `relationship-tracker.js`, `VAN_KUSH_BRAIN.md`).
- Translate sufficiently-high merit on a user's on-chain post into a `vote` op from hathor.
- Rate limit: respect the chain's bandwidth/RC system; cap daily votes.
- Curation is the chain's "feedback loop" — this surface is what makes hathor's presence felt by other accounts.

### Surface 4 — Onboarder

- `create_account_with_keys_delegated` for new users from Discord or the condenser signup flow.
- Initial delegation: 5–15 MP + a small liquid MELEK grant per `melek-chain/CLAUDE.md`.
- Email verification (Resend / Postmark / SES) before any chain op spends resources.
- Keygen happens client-side in the browser when via condenser; server-side only for Discord-originated onboarding, with one-time secure delivery to the user.

### Surface 5 — Troll-box endpoint

- Tiny HTTP server in this repo (`src/trollbox/`) exposing `POST /chat` for the condenser to call.
- Same Gemini brain as the Discord bot — shared `openrouter-ai.js` / Gemini client. Different transport.
- Text-only. No file upload, no key handling. Rate-limit by IP.
- Two condenser call sites planned: signup page ("Chat with MELEK AI for signup help") and site-wide widget.
- Can be built in parallel with Surface 1 — it doesn't depend on chain ops.

### Surface 6 — Witness coordination

- `witness_node` runs as a separate binary on a VPS. **It is not part of this repo.**
- This repo just monitors the witness's block-signing health (RPC poll for last signed block, missed-block counter) and alerts loudly when hathor falls behind.
- Optional: auto-page via Telegram / SMS failsafe (already scaffolded in itinerary Phase 6).

## Key file map

| Surface | Files in this repo |
|---|---|
| 1. Chain-client | `src/chain/adapter.js`, `src/chain/graphene.js`, `src/chain/keys.js` *(to create)* |
| 2. Publisher | `library-of-ashurbanipal-bot/src/utils/chainSink.js` *(to create)*, modify `wikiGenerator.js` to fan out |
| 3. Curator | `relationship-tracker.js` + new `src/chain/curator.js` *(to create)* |
| 4. Onboarder | `src/chain/onboarder.js` *(to create)*; hooks from Discord welcome flow + condenser API |
| 5. Troll-box | `src/trollbox/server.js`, `src/trollbox/routes.js` *(to create)* |
| 6. Witness monitor | `src/chain/witnessHealth.js` *(to create)* |

## Don't

- Don't add hathor.network DAG-blockchain libraries. Wrong project, same word.
- Don't propose custom chain ops for AI features. The chain explicitly forbids this design.
- Don't put the owner key in this repo or its env. Active + posting only.
- Don't couple Surfaces 2/3 to a specific MediaWiki state — chain and wiki are independent sinks.
- Don't run the `witness_node` binary from this repo. Bot ≠ witness daemon.

## Status

- ☐ Surface 1 — not started
- ☐ Surface 2 — not started
- ☐ Surface 3 — not started
- ☐ Surface 4 — not started
- ☐ Surface 5 — not started
- ☐ Surface 6 — not started

See `MASTER_ITINERARY.md` Phase 13 for the same plan in itinerary form, and `melek-chain/CLAUDE.md` for the chain-side companion.
