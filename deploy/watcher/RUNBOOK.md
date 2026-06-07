# Hathor watcher — out-of-band sensitive-op alerter deploy runbook (carryover #156)

**Status:** PREPARED, not deployed. Server work is operator-present only; the agent
never SSHes anywhere to write. This runbook makes the eventual deploy a single approved
command sequence on the box.

**What this deploys:** the `watcher/` module (`watcher/index.js`) as an oneshot systemd
service fired by a 1-minute `.timer`. It is the **READ-ONLY** out-of-band alerter required
by SECURITY.md §4d: it polls `@hathor`'s `account_history`, detects sensitive ops
(`transfer`, `account_update`/key-rotation, `withdraw_vesting`/power-down,
`delegate_vesting_shares`, `witness_update`), composes an alert, and fans it out to a
file sink (always on) plus optional Telegram + email sinks. **It reads no keys, signs
nothing, broadcasts nothing.** Each event is alerted exactly once (de-dup by history index
in the state file). First run bootstraps — snapshots the current history head and does NOT
alert on backfill.

---

## NOT the same as melek-watchdog

The box already runs `melek-watchdog.service`/`.timer` → `/opt/melek-bot/watchdog.mjs`.
That is a **systemd liveness monitor** (it detects silently-dead MELEK timers/services and
pings Telegram). It is *not* the watcher module and does *not* watch the Hathor account's
on-chain ops. This deploy adds the account-security watcher as a separate unit pair
(`melek-watcher.service` + `melek-watcher.timer`). Both can run; they don't overlap.

---

## Run mode: oneshot + timer (why)

`watcher/index.js` supports `--once` (one tick then exit) and `--cron` (long-running,
schedules itself in-process). The cursor + per-event alert state live in
`WATCHER_STATE_FILE` and survive process exit, so the **oneshot + .timer** form is the
systemd-native fit and matches the repo's other timers (e.g. `melek-decades-pipeline`).
The `.timer` runs `--once` every minute; catch-up/overlapping fires can't double-alert
because de-dup is keyed on the persisted history index.

---

## Files in this bundle

| File | Purpose |
|---|---|
| `melek-watcher.service` | oneshot unit template (`__PLACEHOLDER__`s) running `watcher/index.js --once` |
| `melek-watcher.timer` | 1-min timer that pulls the service |
| `watcher.env.example` | env template — RPC + account + state/log paths + optional sink creds |
| `install.sh` | idempotent on-box installer (substitutes placeholders, never clobbers env) |
| `RUNBOOK.md` | this file |

---

## Deploy (on the box, operator-present, approval required)

From the checked-out Bot repo root on the box, with real paths substituted:

```bash
sudo INSTALL_DIR=<repo-checkout> \
     ENV_FILE=<private-env-path>/watcher.env \
     DATA_DIR=<writable-data-dir> \
     LOG_FILE=/var/log/melek-watcher.log \
     NODE_BIN="$(command -v node)" \
     bash deploy/watcher/install.sh --smoke
```

1. The installer writes `watcher.env` from the example **only if absent**, then stops short
   of enabling. **Edit `watcher.env`:** set `MELEK_RPC_URL` (the local node), confirm
   `HATHOR_ACCOUNT=hathor`, and fill the Telegram/email sink creds if you want network
   alerts (the file sink works regardless).
2. `--smoke` runs one `--once` tick. First run prints `bootstrap: snapshot at history index N`
   — that's correct (no alert on backfill). Re-run `--smoke` to confirm it advances the
   cursor cleanly with no errors.
3. When happy, enable the timer:
   ```bash
   sudo systemctl enable --now melek-watcher.timer
   systemctl list-timers melek-watcher.timer --no-pager
   ```
4. Verify alerts land: `tail -f <DATA_DIR>/alerts.jsonl` and watch the log
   `tail -f /var/log/melek-watcher.log`. To force a real alert end-to-end without a chain
   op, you can temporarily lower the detector window or wait for the next genuine
   transfer/feed-adjacent op — but do NOT broadcast a test op from the active key just to
   trip it.

## Key safety

No WIF, no active key, no posting key, no MELEK-Signer token is referenced anywhere in
`watcher/`. The only secrets in `watcher.env` are alert-DELIVERY creds (Telegram bot token,
Resend API key) and they are optional. Keep `watcher.env` in the operator's private path,
chmod 600, never committed.
