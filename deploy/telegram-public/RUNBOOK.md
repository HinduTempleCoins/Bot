# Hathor PUBLIC Telegram bot — deploy runbook

**Status:** PREPARED, ready to go live. Server work is operator-present only; the agent
never SSHes anywhere to write. This bundle makes the deploy a single approved command
sequence on the box, and is explicitly designed to be **installed and enabled BEFORE the
bot token exists** — the service simply idles until the token is dropped in.

**What this deploys:** `integrations/soapbox/telegram-public.mjs` as a long-running systemd
service (`Type=simple`). The bot is the **public face** anyone can DM on Telegram. It is a
**read-only** command surface over the shared steemd query layer — it holds no chain keys,
signs nothing, broadcasts nothing.

### Commands the bot answers
| Command | What it returns |
|---|---|
| `/price <SYMBOL>` | Price for a coin / Hive-Engine token (our tokens featured ⭐, all listable). |
| `/clarity <SYMBOL>` | The Clarity Score (transparency from observable facts). |
| `/status` | Testnet/witness status — head block + whether `hathor` is producing. Carries `[TestNet not MELEK]`. |
| `/help` (`/start`) | The command list + site link. |
| `/hathor` `/block` `/witness` `/account <n>` `/feed` | Other read-only MELEK chain lookups (testnet-labeled). |
| `/markets` `/gainers` `/losers` `/trending` `/chains` `/ecosystem` `/ask <q>` | The rest of the steemd menu. |

Every chain/testnet reply carries the permanent `[TestNet not MELEK]` label (the label
travels in the message). Every outbound reply passes the public-output guard
(`integrations/public-guard.mjs`): internal topics are deflected in-voice, and any
operational detail (IPs, paths, unit names, key-shaped strings) is redacted.

---

## Distinct from the other two Telegram surfaces

1. **The watcher's Telegram ALERT sink** (`deploy/watcher/`) — outbound security alerts to
   the operator only. Not a command bot.
2. **The private operator bridge** — admin/ops chat, single-user.

This is the **third, public** surface: its own @BotFather bot + token, open to everyone,
read-only. Use a NEW bot token, not either of the above.

---

## Idle-without-token contract (why you can install first)

If `TELEGRAM_PUBLIC_BOT_TOKEN` is empty/unset, the process logs
`TELEGRAM_PUBLIC_BOT_TOKEN not set, public bot idle.` and **exits 0**. The unit uses
`Restart=on-failure` (not `always`), so a clean exit is **not** restarted — the service sits
installed-and-enabled, idle, in a clean (not failed) state. Drop the token in the env file
and `systemctl restart` to go live. No code change, no crash-loop.

---

## Files in this bundle

| File | Purpose |
|---|---|
| `melek-telegram-public.service` | `Type=simple` long-poll daemon template (`__PLACEHOLDER__`s), `Restart=on-failure` |
| `telegram-public.env.example` | env template — empty bot token (idle) + RPC + network + optional site |
| `install.sh` | idempotent on-box installer (substitutes placeholders, never clobbers env) |
| `RUNBOOK.md` | this file |

---

## Deploy (on the box, operator-present, approval required)

From the checked-out Bot repo root on the box, with real paths substituted:

```bash
sudo INSTALL_DIR=<repo-checkout> \
     ENV_FILE=<private-env-path>/telegram-public.env \
     LOG_FILE=/var/log/melek-telegram-public.log \
     NODE_BIN="$(command -v node)" \
     bash deploy/telegram-public/install.sh --smoke --enable
```

1. The installer writes `telegram-public.env` from the example **only if absent** (empty
   token → idle), installs the unit, and `--smoke` runs the bot for ~2s. With no token the
   smoke run prints the idle line and exits 0 — **that is expected and correct**.
2. `--enable` enables + starts the service. With an empty token it immediately idles (clean
   exit, not restarted). Safe to leave like this indefinitely.
3. Confirm: `systemctl status melek-telegram-public.service` (clean, not failed) and
   `tail -f /var/log/melek-telegram-public.log` (shows the idle line).

## THE ONE STEP TO GO LIVE

Once you have a public bot token from @BotFather (a NEW bot, distinct from the operator/watcher bots):

```bash
# 1) put the token in the private env file (the ONLY secret this bot needs):
#    edit <private-env-path>/telegram-public.env  →  TELEGRAM_PUBLIC_BOT_TOKEN=<token>
# 2) restart:
sudo systemctl restart melek-telegram-public.service
```

The log will switch from the idle line to `Hathor public Telegram bot live: @<botname>`.
DM the bot `/help` to confirm.

## Key safety

No WIF, no active key, no posting key, no MELEK-Signer token is referenced anywhere in this
bot. The only secret in `telegram-public.env` is the Telegram bot token — a chat credential
that cannot sign or broadcast on-chain. Keep the env file chmod 600, in the operator's
private path, never committed. The bot never logs the token.
