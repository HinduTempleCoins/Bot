# welcomer/ — meeting new accounts on the chain

When a new account is created on the chain, the bot posts **one comment on the canonical Welcome / Tutorial Program post** mentioning the new user by handle (`@<newuser>`). The mention generates the user's wallet notification — that's how they find out. The notification leads them back to the Welcome post, where they see a comment addressed to them asking one easy question and pointing at the tutorial. They can reply directly in that thread, which becomes their first piece of on-chain content.

## Why a single shared thread

| Pattern | Failure mode |
|---|---|
| DM the new user | Graphene has no DMs |
| Post on the new user's profile | Their profile is empty; the welcome lands in a lonely place |
| Comment on the new user's first post (@wang model) | Many users never make a first post — they get no welcome |
| **Single shared Welcome thread, @-mention each new user** ✓ | Users converge in one place, see each other's interactions, replying is the cheapest possible "first post" |

The thread becomes the chain's front porch. Veterans can scroll it to find arrivals to engage with; newcomers can see they're not alone.

## CLI

```bash
node welcomer/index.js --once             # one tick, exit (dry-run by default)
node welcomer/index.js --cron             # schedule recurring ticks (dry-run by default)
node welcomer/index.js --once --broadcast # one tick, actually post
node welcomer/index.js --cron --broadcast # production mode
```

Default behavior **without** `--broadcast` is dry-run: scans blocks, composes what it would post, logs to stdout, marks accounts as welcomed-in-dry-run in state so they don't re-print every tick. Safe to point at any chain (Blurt, MELEK testnet, anything) for behavior validation. Only pass `--broadcast` when you want real chain writes.

## Env vars

| Var | Fallback | Purpose |
|---|---|---|
| `CHAIN_RPC_URL` | `MELEK_RPC_URL` | RPC endpoint |
| `CHAIN_ID` | `MELEK_CHAIN_ID` | Chain id (network discriminator) |
| `CHAIN_ADDRESS_PREFIX` | `MELEK_ADDRESS_PREFIX` | Public-key address prefix |
| `BOT_ACCOUNT` | `MELEK_ACCOUNT` (or `hathor`) | Account that posts the welcomes |
| `BOT_POSTING_KEY` | `HATHOR_POSTING_KEY` | WIF — only required for `--broadcast` |
| `WELCOME_POST_AUTHOR` | — | Author of the canonical Welcome post |
| `WELCOME_POST_PERMLINK` | — | Permlink of the canonical Welcome post |
| `TUTORIAL_LINK` | `BRIEF.md` on GitHub | URL the welcome comment links to |
| `LAST_BLOCK_FILE` | `welcomer/.state.json` | Discovery-cursor + welcomed-set storage |
| `SKIP_ACCOUNTS` | `BOT_ACCOUNT` | Comma/space-separated accounts to ignore |
| `WELCOMER_CRON` | `*/2 * * * *` | Cron schedule (cron-mode only) |
| `WELCOMER_BATCH_BLOCKS` | `50` | Max blocks to scan per tick |

## Startup health checks

Before any tick runs, the welcomer verifies:
1. The chain RPC responds.
2. `BOT_ACCOUNT` exists on the configured chain.
3. `WELCOME_POST_AUTHOR/PERMLINK` resolves to a real post.

If any check fails, the process exits with a descriptive error. This catches the most common misconfig — wrong RPC, wrong account, missing Welcome post — at startup instead of at first broadcast.

## Modules

| File | Role |
|---|---|
| [`state.js`](./state.js) | Per-account welcome state (file-backed JSON, atomic write). `last_processed_block` cursor + per-account `welcomed` mark. |
| [`composer.js`](./composer.js) | Phase-2 deterministic message templates. Three variants picked by `sha256(account+'welcome')[0] % 3`. Phase 3 swaps for LLM in the Angelic register without changing the call shape. |
| [`discover.js`](./discover.js) | Block scanner. Finds `account_create` + `account_create_with_delegation` ops in a given block range. |
| [`config.js`](./config.js) | Env-var loader with MELEK_* / HATHOR_* fallbacks. |
| [`index.js`](./index.js) | `Welcomer` class + CLI orchestrator. Bootstraps from head block on first run (no historical backfill — would mass-welcome existing accounts). |

## First-run bootstrap behavior

On the very first run with empty state, the welcomer **starts the cursor at the current head block**. It does NOT backfill the chain's entire history of account creations — that would post a welcome comment for every account ever created, which is the opposite of what we want. Only accounts created from this moment forward get welcomed.

If you ever need to reset the welcomer (re-test against fresh state, switch chains, etc.), just delete `welcomer/.state.json` and restart.

## Phase 2 vs Phase 3

Phase 2 ships deterministic templates that vary per account. Same user → same welcome, every run; different users → different variants from a small pool. The user only ever sees their own one comment, so it doesn't feel canned to them; the thread doesn't read as identical spam to readers scrolling it.

Phase 3 replaces `composer.js` with LLM generation in Hathor's Angelic register (CHARACTER.md §2). Everything else carries over unchanged — state, discovery, orchestration, CLI.

## Conventions to honor

- **No "I am a bot" disclaimer in the welcome comment.** MELEK policy (CLAUDE.md): accounts aren't labeled AI vs human by default.
- **Welcome the bot's skip-list, not by account type.** Don't filter on whether the new account looks AI or human — welcome everyone equally.
- **No CAPTCHA-style friction.** One welcome per new account, no challenges, no throttles beyond `WELCOMER_BATCH_BLOCKS`.
- **The Welcome post itself is an admin task**, not the bot's job. Author it manually, get its `author/permlink`, drop those in env. The bot reads from it; it does not author or maintain it.
