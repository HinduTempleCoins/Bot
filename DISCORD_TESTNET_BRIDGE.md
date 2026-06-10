# Discord ↔ MELEK-testnet Bridge (PIZZA-Bot pattern)

A bidirectional bridge between a Discord channel and the **MELEK testnet**, modeled on HIVE's
**PIZZA bot**: a Discord command like `!tip @user 5` triggers a real on-chain token action, and
on-chain events (tips, Hathor welcomes, POWER delegations) surface back into the Discord channel.

- **Module:** `integrations/discord-chain-bridge.mjs`
- **Tests:** `integrations/discord-chain-bridge.test.mjs` (`node --test`, fully offline)
- **Phase:** sits on the Phase-2/Phase-3 line. The command-mapping + guards are deterministic
  (Phase 2); the `!welcome` reply text uses Hathor's Phase-3 disposition-greeting when available.

---

## What it does

### Discord → chain (commands)

| Command | Maps to | Signed by | Notes |
|---|---|---|---|
| `!tip @user <amt>` | `transfer` (TESTS) | the **tipper** | rate-limited + capped (anti-drain) |
| `!welcome @user` | `delegate_vesting_shares` + `transfer` (+ `comment` ping) | **hathor** | the proven welcomer path |
| `!balance [@user]` | *(no chain op)* | — | answered via `commands/menu.mjs` (read-only) |
| `!witness [@user]` | *(no chain op)* | — | answered via `commands/menu.mjs` (read-only) |
| `!price [symbol]` | *(no chain op)* | — | answered via `commands/menu.mjs` (read-only) |

Both `!`-prefix and `/`-slash forms parse. Unknown commands soft-fail with a pointer to `!help`.

### chain → Discord (events)

`fromChainEvent(op)` turns a relevant op (or op-history row) into a Discord line:

```
💸 @alice tipped @bob 5.000 TESTS — Discord tip from @alice
🎁 Hathor granted 10.000 TESTS to @newbie — welcome to MELEK!
⚡ Hathor delegated POWER to @newbie (Resource Credits to get started).
👋 Hathor welcomed @newbie on the chain.
```

It ignores anything not tied to our flows (non-TESTS transfers, votes, etc.) and soft-fails to
`null` on garbage.

---

## Design guarantees (custody + safety)

- **Zero keys, zero broadcast in this module.** `toChainOp()` returns the Graphene op array;
  the **host** broadcasts it via the JIT-vault key / MELEK-Signer. The bridge never holds, reads,
  or logs a private key (BRIEF.md §7, CLAUDE.md "Zero WIF on host").
- **Everything is injected.** The live Discord client and the chain broadcaster are passed in at
  the edge (`makeBridge`). Offline tests inject stubs — no Discord socket, no RPC.
- **Anti-drain guards** (PIZZA's daily-limit equivalent), all enforced *before* an op is built:
  - per-tip max-amount cap (`maxTip`, default 25 TESTS) — a hard floor even with no ledger,
  - per-tipper rate-limit (`rateLimitSec`, default 30s),
  - per-tipper daily total cap (`dailyCapPerUser`, default 100 TESTS).
- **Testnet-only symbol.** Tips are denominated in `TESTS`; the bridge does not denominate in any
  other symbol here. (Mainnet symbol is MELEK; flip via `rules.symbol` only with a mainnet signer.)
- **Soft-fail everywhere.** A broadcaster error becomes a friendly Discord reply, never a throw
  into the Discord client.

Tunable knobs live in `BRIDGE_DEFAULTS` (override per-call via `rules`):
`maxTip`, `dailyCapPerUser`, `rateLimitSec`, `welcomeDelegation`, `welcomeGrant`,
`welcomePostAuthor`, `welcomePostPermlink`, `hathor`.

---

## API

```js
import {
  parseCommand, toChainOp, fromChainEvent, runCommand, makeBridge, makeTipLedger,
  BRIDGE_DEFAULTS, SYMBOL,
} from './integrations/discord-chain-bridge.mjs';

parseCommand('!tip @alice 5');          // { cmd:'tip', to:'alice', amount:5, raw:[...] }
toChainOp({cmd:'tip',to:'alice',amount:5}, { from:'tipper', ledger });
                                        // { ok, ops:[['transfer',{...}]], needs:['tipper'], reply }
fromChainEvent(['transfer', {...}]);    // a Discord string, or null
await runCommand('!balance @hathor', { deps });        // read → menu.mjs
await runCommand('!tip @alice 5', { from:'tipper', broadcast });  // write → broadcaster
```

`runCommand` is the host's one-call entry: read-only commands route to the deterministic menu,
write commands build the op(s) and call the injected `broadcast({ ops, needs })` (or dry-run when
no broadcaster is wired).

---

## Run the offline tests / demo

```bash
node --test integrations/discord-chain-bridge.test.mjs   # 26 tests, fully offline
node integrations/discord-chain-bridge.mjs               # CLI demo: parse + map + render events
node -c integrations/discord-chain-bridge.mjs            # syntax check
```

---

## Running it LIVE (the PIZZA-style demo)

The module is the pure core. To run it live you wire three things at the host edge — **none of
which live in this repo**:

1. **Discord bot token** — from the operator vault (never committed, never an env in this repo).
   Use `discord.js` (or any client) to produce the thin message shape the bridge expects:
   `{ content, authorId, reply(text) }`. Also expose `discord.send(channelId, text)` for the
   chain→Discord direction.

2. **Testnet RPC** — the live MELEK testnet (chain id `18dcf0…274e`, prefix `TST`, symbols
   TESTS/TBD). Used by:
   - the **read deps** (`getAccount` / `getWitness` / `getPrice`) the bridge passes to
     `commands/menu.mjs` — wire these to `GrapheneAdapter` (`src/chain/graphene.js`) /
     the price oracle;
   - the **event poller** — poll account/op history, hand each op to `bridge.onChainEvent(op)`.

3. **Broadcaster (JIT key / MELEK-Signer)** — the only component that signs. It receives
   `{ ops, needs }` from the bridge. `needs` tells it *whose* key to use:
   - `['hathor']` for `!welcome` (Hathor's active + posting keys, fetched JIT from the vault
     per the operator custody rule — never stored on disk);
   - `[tipper]` for `!tip` (the tipper's active key). For a self-custody UX the tipper signs in
     their own browser/wallet via MELEK-Signer; the bridge only *prepares* the op.

### Sketch of the host wiring

```js
import { makeBridge } from './integrations/discord-chain-bridge.mjs';

const bridge = makeBridge({
  discord,                 // { onMessage(cb), send(channelId, text) }  — your discord.js adapter
  channelId: TESTNET_CHANNEL_ID,
  deps: { getAccount, getWitness, getPrice },   // wired to GrapheneAdapter + oracle (read-only)
  broadcast: async ({ ops, needs }) => signer.broadcast(ops, { as: needs }), // MELEK-Signer
  resolveAccount: async (discordId) => linkMap.get(discordId),  // Discord user → MELEK account
  rules: { welcomePostPermlink: 'introducing-hathor-on-melek' },
});

// chain → Discord: feed the poller's ops in
for await (const op of pollTestnetOps()) await bridge.onChainEvent(op);
```

### What the live demo looks like

In the testnet Discord channel:

```
user>  !tip @alice 5
bot>   @bob → @alice: 5.000 TESTS sent on the MELEK testnet.
       (a moment later, surfaced from chain:)
bot>   💸 @bob tipped @alice 5.000 TESTS — Discord tip from @bob

user>  !welcome @newbie
bot>   Hathor welcomes @newbie — POWER delegated, 10.000 TESTS granted, and a ping on the welcome post.
bot>   ⚡ Hathor delegated POWER to @newbie (Resource Credits to get started).
bot>   🎁 Hathor granted 10.000 TESTS to @newbie — welcome to MELEK!

user>  !tip @alice 999
bot>   ⚠ tip 999 exceeds the per-tip cap of 25 TESTS

user>  !tip @alice 5    (immediately again)
bot>   ⚠ rate-limited — wait 27s between tips

user>  !price btc
bot>   BTC: $65000.00 (3 sources)
```

The chain→Discord lines confirm the op actually landed on the testnet (the bridge surfaces the
broadcast op, closing the PIZZA loop).

---

## Reuse / relationships

- `commands/menu.mjs` — the deterministic `!balance` / `!witness` / `!price` handlers (no LLM).
- `integrations/hathor-discord.mjs` — the disposition-greeting used for the `!welcome` ping body.
- `witness/welcomer.mjs` — the proven delegate-+-grant-+-ping welcome path the `!welcome` op mirrors.
- `integrations/tipbot.mjs` — the stake-gated onboarding faucet (task #141). The bridge's `!tip` is
  the *peer-to-peer* tip (tipper→recipient); tipbot is the *faucet* (Hathor→newcomer). Different
  flows, same anti-drain spirit.
- `src/chain/graphene.js` — the canonical op shapes (`transfer` / `comment` / `custom_json`).
