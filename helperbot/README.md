# helperbot — Hathor's "PRANA PIZZA" helper bot

One deterministic command brain (no LLM) shared by Discord (`index.js`), Telegram
(`integrations/telegram-bot.mjs`) and the troll-box / web chat (`src/trollbox/index.mjs`). The bot helps a
user through each step **without ever taking a password, key or seed**: it only reads public chain state
for a public account name or 0x address.

| Module | What it does |
|---|---|
| `secret-guard.mjs` | Runs **first** on every inbound message: WIF, P5 master password, 64-hex key, xprv, BIP-39 / Monero seed, `password:` style. Refuse, delete where the platform allows, tell the user to rotate. `inboundTrace()` is the only sanctioned inbound log line (no content). |
| `tokenomics.mjs` | `!tokenomics !prana !kula !melek !vkbt !cure !wvkbt !wcure !wmelek !apis`, all figures read live (60 s cache). Protocol parameters from the papers are labelled as such. A failed read prints "unavailable", never a number. |
| `faucet.mjs` | `!faucet`, checked live per call. PRANA testnet drip (dry-run unless `HELPERBOT_FAUCET_LIVE=1`). MELEK = free account creation in the browser. PRANA mainnet gets the Under Construction notice. Per-user and per-address cooldowns, account-age and karma gates, global daily cap. |
| `links.mjs` | `!link 0x…` / `!link @acct` → `!verify`. Keyless ownership proof: an exact dust self-transfer on PRANA, or a memo transfer to @hathor on MELEK. |
| `tip.mjs` | PIZZA pattern: tips come out of **Hathor's tip jar**. The tipper's verified holdings set their daily quota tier. Global daily cap, receipts, `!tips`, `!tipjar`. Default token is native PRANA (mainnet 712217), set by config. Simulated unless treasury, live flag and signer are all set. |
| `guide.mjs` | `!guide <topic>` → `!next`. Covers every WORKS flow in the live site map (`melek.salon/map/flows.json`, with a vendored snapshot as fallback). Steps that leave a chain trace are verified on-chain before the guide advances. NOT FINISHED flows get the one-line 🚧 notice only. |
| `ai-route.mjs` | Fleet-queue seam for AI calls (below). Off by default. |
| `brain.mjs` | Guard → helper commands → `{handled:false}`, so legacy handlers and free chat continue unchanged. |

## One `!tip`, reconciled

Before this branch there were three meanings of `!tip`:
1. `index.js` → `discord-tip-cli.mjs`: Hathor tips any symbol from her stash, with tipper-side caps only.
2. `discord-chain-bridge.mjs`: the tip comes from the tipper's own account. That needs the tipper's key on
   the host, which is a custody violation, so it is retired.
3. `integrations/tipbot.mjs`: an onboarding faucet grant. That is now `!faucet`, not `!tip`.

With `HELPERBOT_ENABLED=1`, `!tip` and `/tip` mean only the PIZZA pattern (`tip.mjs`). Graphene presets
reuse `tipbot.mjs` `execute()` for op building and keep its Clarity firewall. With the flag off, the
legacy handler (1) still answers.

## AI calls → Hathor's fleet queue on PRANA

`ai-route.mjs askAI(prompt, { fallback })` sends free-chat AI through `prana-lanes/lanes/fleetq.py` on the
lanes host:
- `POST /jobs {type:'llm.generate', params:{temperature:0,max_tokens}, input:{prompt}, latency:'interactive', origin:'hathor-helper-bot'}`
  with the producer bearer token.
- It then polls `GET /jobs/<id>` for `served` or `verified`. fleetq serves the first output at once, and
  credits the K-of-N agreeing workers milliWU in the pool's PPLNS log, so answering chat pays PRANA miners.
- If the queue is off, down, returns 401, times out or disputes the job, the call falls back to the
  existing path (Hathor Brain `/perceive`).

Flags: `HATHOR_FLEETQ=1`, `HATHOR_FLEETQ_URL`, `HATHOR_FLEETQ_TOKEN`, `HATHOR_FLEETQ_MODEL`,
`HATHOR_FLEETQ_DEADLINE_MS`. The default is off. The prompt has already passed the secret guard.

## Config (env)

| Var | Default | Meaning |
|---|---|---|
| `HELPERBOT_ENABLED` | off | turn the helper commands on (the guard is always on) |
| `HELPERBOT_TIP_TOKEN` | `PRANA` | `PRANA` (EVM native, 712217) · `MELEK` · `TESTS` · `WMELEK` |
| `HELPERBOT_TIP_AMOUNT` | `0.1` | tokens per tip |
| `HELPERBOT_TIP_TIERS` | `1:1,10:3,100:10,1000:25` | `minHeld:tipsPerDay` |
| `HELPERBOT_TIP_DAILY_CAP` | `25` | global tokens/day out of the jar |
| `HELPERBOT_TIP_TREASURY` | unset | tip-jar address/account. Unset means every tip is simulated |
| `HELPERBOT_TIP_LIVE` | off | `1` allows broadcast, and also needs a signer injected by the host |
| `HELPERBOT_FAUCET_LIVE` | off | `1` lets the bot call the PRANA testnet `/api/drip` |
| `HELPERBOT_FAUCET_*` | 24h / 24h / 7d / 0 / 50 | user cooldown, address cooldown, min account age, min karma, daily drips |
| `HELPERBOT_DATA_DIR` | `.helperbot-data` | state file (links, quotas, receipts, guide sessions). Public data only |
| `HELPERBOT_DISCORD_INVITE` | `discord.gg/Ghz672dW7Z` | permanent invite (no expiry), #welcome |
