# diag-to-tasks — self-fix queue builder deploy runbook (carryover #176)

**Status:** PREPARED, not deployed. Server work is operator-present only; the agent never
SSHes anywhere to write. This runbook makes the eventual deploy a single approved command
sequence on the box. The on-box steps also live in `.local/DIAG_TASKS_RUNBOOK.md`.

**What this deploys:** `integrations/diag-to-tasks.mjs` as a oneshot systemd service fired
by a 15-minute `.timer`, staggered 5 minutes after the existing `melek-alpha-e2e.timer`.
It closes the standing **diagnostics → annals → self-fix tasks** loop on the repo side:
the e2e diagnostics already probe the whole live testnet stack every 15 min and emit a JSON
report; red checks in that report are ephemeral (they vanish once green). This unit folds
each red check into a **durable, deduplicated work item** in a queue file the next Claude
session (or the resident AI) picks up.

Each failing check maps to a task `{ id (stable hash of the check name), severity, summary,
evidence, firstSeen, lastSeen, count, greenStreak, status }`. Tasks accumulate `count` while
red, and **recover** (drop out of the queue) only after `DIAG_RECOVER_AFTER` consecutive
green runs (default 3 ≈ 45 min), so a single flaky probe doesn't churn the queue. Output is
`self-fix-queue.json` plus a sibling `self-fix-queue.md` the annal/brief pipeline ingests.

**Key safety:** no WIF, no active/posting key, no MELEK-Signer token is referenced anywhere
in `diag-to-tasks.mjs`. It re-runs the same read-only probes alpha-e2e does and writes only
the queue file pair. It signs nothing and broadcasts nothing.

---

## NOT the same as alpha-e2e (it consumes it)

`melek-alpha-e2e.*` runs the diagnostics and produces the report. `melek-diag-to-tasks.*`
**consumes** the latest diagnostics and maintains the persistent self-fix queue. Two units,
one feeds the other. Under systemd there is no stdout pipe between them, so this unit
re-runs the same (read-only) probes inline via `diag-to-tasks.mjs once`'s fallback path —
identical surface coverage, just folded straight into the queue. (Ad-hoc, you can still pipe:
`node integrations/alpha-e2e.mjs --json | node integrations/diag-to-tasks.mjs once`.)

---

## Run mode: oneshot + timer (why)

`diag-to-tasks.mjs once` loads the existing queue, merges the latest report, writes the
JSON + markdown, and exits. The queue file (`DIAG_TASKS_PATH`) carries `firstSeen` / `count`
/ `greenStreak` across runs, so the **oneshot + .timer** form is the systemd-native fit and
matches the repo's other timers (e.g. `melek-watcher`, `melek-decades-pipeline`). The merge
is idempotent (de-dup keyed on the stable check-name hash + green-streak recovery), so
catch-up/overlapping fires can't corrupt the queue.

---

## Files in this bundle

| File | Purpose |
|---|---|
| `melek-diag-to-tasks.service` | oneshot unit template (`__PLACEHOLDER__`s) running `diag-to-tasks.mjs once` |
| `melek-diag-to-tasks.timer` | 15-min timer, offset 5 min after the e2e run |
| `diag-to-tasks.env.example` | env template — queue path, recover threshold, probe URLs |
| `install.sh` | idempotent on-box installer (substitutes placeholders, never clobbers env) |
| `RUNBOOK.md` | this file |

---

## Deploy (on the box, operator-present, approval required)

From the checked-out Bot repo root on the box, with real paths substituted:

```bash
sudo INSTALL_DIR=<repo-checkout> \
     ENV_FILE=<private-env-path>/diag-to-tasks.env \
     DATA_DIR=<brain/shared dir> \
     LOG_FILE=/var/log/melek-diag-to-tasks.log \
     NODE_BIN="$(command -v node)" \
     bash deploy/diag-to-tasks/install.sh --smoke
```

1. The installer writes `diag-to-tasks.env` from the example **only if absent**, then stops
   short of enabling. **Edit `diag-to-tasks.env`:** confirm `DIAG_TASKS_PATH` points inside
   `DATA_DIR` (default `<DATA_DIR>/self-fix-queue.json`), set the probe URLs (`MELEK_RPC_URL`,
   `ALPHA_BASE`, `POOL_BASE`) to the live faces, and adjust `DIAG_RECOVER_AFTER` if desired.
2. `--smoke` runs one `once` pass. It prints `diag-to-tasks: N open / M tracked → <path>`.
   Inspect the human-readable render: `cat <DATA_DIR>/self-fix-queue.md`.
3. When happy, enable the timer:
   ```bash
   sudo systemctl enable --now melek-diag-to-tasks.timer
   systemctl list-timers melek-diag-to-tasks.timer --no-pager
   ```
4. Verify the queue stays fresh: `watch -n60 cat <DATA_DIR>/self-fix-queue.md`. Trip a real
   recovery by fixing a red surface and confirming the task flips to `_(recovering)_` then
   disappears after `DIAG_RECOVER_AFTER` green runs.

## Annal/brief integration

`self-fix-queue.md` is written next to the JSON specifically so the annal writers / brief
pipeline can `cat` it straight into a brief. Point the existing annal-collection step at
`<DATA_DIR>/self-fix-queue.md` (it sits alongside the other `brain/shared/` artifacts the
pipeline already scoops up). The JSON is the machine-readable source of truth; the markdown
is the human/LLM-readable render.
