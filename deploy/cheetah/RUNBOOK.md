# CheetahAdvanced — read-only testnet watcher deploy runbook (old-queue #265)

**Status:** PREPARED, not deployed. Server work is operator-present only; the agent
never SSHes anywhere. This runbook makes the eventual deploy a single approved command
sequence on the box.

**What this deploys:** a long-running, **READ-ONLY** CheetahAdvanced watcher
(`cheetah/watch.mjs`) on the box, pointed at the **local MELEK testnet RPC**
(`http://127.0.0.1:8090`). It streams recent posts, runs Cheetah's deterministic
detection + discovery engines, records MATCH findings to the shared store, and refreshes
the test-report surface at `alpha.melek.salon/cheetah/`. **It never posts on-chain** in
this phase — resolution conversations are Phase 3 / Hathor's job (CHEETAH_ADVANCED.md §5-6).

---

## How Cheetah watches (the actual mechanism)

`cheetah/watch.mjs` is a thin loop over the engines that already exist in `cheetah/`:

1. **Poll** — `fetchRecentPosts()` (reused from `cheetah/alpha-report.mjs`) calls the
   condenser RPC `condenser_api.get_discussions_by_created` over **HTTP GET-style JSON-RPC
   reads**. No auth, no keys. Soft-fails to `[]` (with `.error`) if the node is down.
2. **Cursor** — an in-process `seen` set keyed by `@author/permlink` so each post is
   processed once across ticks. (This is why the service is long-running, not a timer —
   see below.)
3. **Detect + discover** — `runCheetahOnPosts()` (also reused from `alpha-report.mjs`)
   runs the shingle + Jaccard text engine and the discovery engine over the recent set,
   cross-referencing each post against the others. **No LLM decides anything** — detection
   is deterministic per CHEETAH_ADVANCED.md §3.
4. **Record** — for fresh **MATCH** verdicts, `recordFinding()` writes to the shared store
   namespace `cheetah.findings` (idempotent on post+source) so Hathor can read them.
   SEE-ALSO / discovery and CLEAR verdicts are NOT stored (they're advisory "see also"s,
   shown only on the report page).
5. **Report** — rewrites `index.html` + `report.json` in `CHEETAH_REPORT_DIR` (the same
   artifacts `alpha-report.mjs` produces), so the run is visible at the alpha page.

**READ-ONLY invariant:** the watcher imports nothing that signs or broadcasts. There is no
posting key, no WIF, no MELEK-Signer call anywhere in this path. Findings and discovery
notes are **advisory only** — they land in the store and on the page; nothing is written
to the chain and nothing under `knowledge/**` is touched.

### Why a long-running service, not a oneshot+timer

The watcher keeps the `seen` cursor and frequency state in-process. A `oneshot` fired by a
timer would drop that cursor every fire and re-run the engines over the same recent window.
`recordFinding` is idempotent so a timer would still be *correct* — but the long-running
`--watch` form (with `setInterval` at `CHEETAH_POLL_INTERVAL`, default 5 min) is the fit
for Cheetah's design and the cheaper option. `Restart=always` covers crashes; the loop
itself soft-fails every tick so it won't crash-loop on a down RPC.

---

## Files in this bundle (`deploy/cheetah/`)

| File | Purpose |
|---|---|
| `melek-cheetah-watch.service` | long-running systemd unit (placeholders `__INSTALL_DIR__`, `__ENV_FILE__`, `__DATA_DIR__`, `__REPORT_DIR__`, `__NODE_BIN__`) |
| `cheetah.env.example` | env template (placeholders `__DATA_DIR__`, `__REPORT_DIR__`) — **no keys** |
| `install.sh` | idempotent installer (substitutes placeholders, installs the unit, optional smoke/enable) |
| `RUNBOOK.md` | this file |

The runner itself lives in the module: **`cheetah/watch.mjs`** (+ `cheetah/watch.test.js`).

---

## Prerequisites on the box

- Node resolvable (`which node` → use for `NODE_BIN`).
- The MELEK testnet node running locally, RPC on `127.0.0.1:8090`
  (`systemctl status melek-testnet`). The watcher soft-fails if it's down, but you want it
  up to see real findings.
- The Bot repo checked out on the box (`git pull` to get this bundle).
- A static web root for the report (e.g. the alpha.melek.salon `/cheetah` dir) if you want
  the run visible — otherwise point `REPORT_DIR` anywhere writable.

## 1. Install (operator-present)

From the repo root on the box, substituting your real paths:

```bash
sudo INSTALL_DIR=/path/to/bot/repo \
     ENV_FILE=/path/to/private/cheetah.env \
     DATA_DIR=/path/to/store-data \
     REPORT_DIR=/var/www/alpha-melek-salon/cheetah \
     NODE_BIN="$(command -v node)" \
     bash deploy/cheetah/install.sh
```

This creates the write dirs, writes the env file from the example (paths substituted),
installs + `daemon-reload`s the unit, and does **NOT** enable it yet.

## 2. Review the env file

Open the `ENV_FILE`. Confirm `MELEK_RPC_URL` is the local testnet RPC, and that
`CHEETAH_STORE_ROOT` / `CHEETAH_REPORT_DIR` point at the real store + report dirs. There
are **no keys** to fill — the watcher is read-only.

## 3. Smoke test (one read-only pass, no service) — process one real post end-to-end

```bash
sudo INSTALL_DIR=/path/to/bot/repo ENV_FILE=/path/to/private/cheetah.env \
     DATA_DIR=/path/to/store-data REPORT_DIR=/var/www/alpha-melek-salon/cheetah \
     bash deploy/cheetah/install.sh --smoke
```

Expect a summary line like:

```
[cheetah-watch] scanned=N fresh=N findings+=K → /var/www/alpha-melek-salon/cheetah
```

Then verify the end-to-end output on a real testnet post:

```bash
# 3a. The report page exists and lists the scanned posts:
ls -l "$REPORT_DIR"/index.html "$REPORT_DIR"/report.json
# Open the page (behind the alpha Accept-gate) at https://alpha.melek.salon/cheetah/
# — it shows each recent post with its verdict (ORIGINAL / SEE ALSO / MATCH) and,
#   for matches, the crediting note Cheetah WOULD post (dry-run; never posted).

# 3b. report.json carries the per-post results:
node -e 'const r=require("'"$REPORT_DIR"'/report.json");console.log(r.results.length,"posts; verdicts:",r.results.map(x=>x.verdict).join(","))'

# 3c. If any MATCH was found, it landed in the shared store as a finding:
node -e 'import("./cheetah/store.js").then(async m=>{const f=await m.listFindings({},process.env.CHEETAH_STORE_ROOT);console.log(f.length,"finding(s):",JSON.stringify(f[0]||null,null,2))})'
```

If the testnet has no posts yet, the report says so and `findings+=0` — that's the correct
empty-chain behavior, not a failure.

## 4. Enable the service

```bash
sudo systemctl enable --now melek-cheetah-watch.service
systemctl status melek-cheetah-watch.service --no-pager
```

(Or pass `--enable` to `install.sh` to do steps 1 and 4 together.)

## 5. Verify it's watching

```bash
systemctl is-active melek-cheetah-watch.service                 # -> active
journalctl -u melek-cheetah-watch.service -n 30 --no-pager      # one "[cheetah-watch] scanned=..." line per poll
# After a poll, the report page refreshes; the store grows as matches appear.
```

---

## Rollback

The watcher is read-only and stateless beyond its store/report files — rollback is fast
and safe; **chain data is untouched** (it never wrote any).

```bash
sudo systemctl disable --now melek-cheetah-watch.service
sudo rm -f /etc/systemd/system/melek-cheetah-watch.service
sudo systemctl daemon-reload
```

The findings under `DATA_DIR` and the report under `REPORT_DIR` are left in place (they're
advisory data Hathor may still read); delete them by hand for a clean slate. No other
service depends on this watcher, so disabling it is non-destructive.

## Notes

- **No secrets in the repo:** the unit + env ship as placeholders; real paths live only in
  the env file the operator writes on the box. There is no key material anywhere in this
  bundle (read-only chain access needs none).
- **Soft-fail everywhere:** a down RPC, empty chain, or store hiccup degrades to a safe
  result + a log line — the watch never crash-loops on bad data.
- **Offline-tested:** `cheetah/watch.test.js` exercises the loop with injected readers and a
  temp store (no network) — finding-recording, the cursor, and the RPC-error soft-fail path.
- **Advisory only:** findings/discovery never escalate or post here. The resolution flow
  (CHEETAH_ADVANCED.md §5) is Hathor's, Phase 3.
