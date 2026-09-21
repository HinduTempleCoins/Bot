# deploy/soapy-sync — pre-wipe corpus sync for the Soapy 12-and-12 instance

Ships the **recovered corpus** into the brain the Soapy wake reads, on a timer that fires **before each
12-and-12**, so nothing is lost when the ephemeral environment is wiped. It mirrors the intent of
`brain/ship-transcripts.sh`, for the one-time recovered pile instead of the live transcript stream.

## What runs

| Unit | Cadence | What it does |
|---|---|---|
| `melek-soapy-sync.timer` | 23:00 & 11:00 America/Chicago | fires the sync — 30 min before Soapy's 23:30/11:30 wake, an hour before the 00:00/12:00 conference |
| `melek-soapy-sync.service` | oneshot | runs `brain/ship-recovered.sh` |

`brain/ship-recovered.sh` → `brain/sync-recovered.mjs`:
- washes `archive/recovered-sessions/*.api.json` → `<stage>/transcripts/*.jsonl`, rsync → `$BRAIN_HOST:$BRAIN_TRANSCRIPTS_DIR` (mined by the reconcile pass into the append-only `operator-asks.md`);
- washes `.local/incoming/recovered/DIGEST_*.md` → `<stage>/annals/_synthesis.recovered-*.md`, rsync → `$BRAIN_HOST:$BRAIN_ANNALS_DIR` (mined by `annal-harvester`; **read directly by the Soapy wake**, `soapy-conference.gatherSince`);
- kicks `melek-reconcile / melek-mom / melek-brief / melek-harvest` on the box so it lands in the next pass.

The `_synthesis.recovered-` prefix is deliberate: it matches `annal-harvester`'s `SIGNAL` (`/^_synthesis/`)
and the wake's `*.md` scan, so no parallel store is introduced.

## Install (on the env that HOLDS the recovered corpus — the Codespace/worker, not the brain box)

Substitute `__INSTALL_DIR__`, `__ENV_FILE__`, `__STAGE_DIR__`, `__LOG_DIR__`, `__LOG_FILE__`, then:

```
cp deploy/soapy-sync/melek-soapy-sync.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now melek-soapy-sync.timer
systemctl start melek-soapy-sync.service      # one immediate sync to seed the brain
systemctl list-timers melek-soapy-sync.timer  # verify the two daily fires
```

`__ENV_FILE__` **must** set `BRAIN_HOST` (the ssh alias of the brain box), `BRAIN_TRANSCRIPTS_DIR` and
`BRAIN_ANNALS_DIR` (the brain's transcript + annal dirs — kept out of this public repo), and, only if
they differ from the repo defaults, `RECOVERED_SESSIONS_DIR` / `RECOVERED_DIGESTS_DIR` /
`RECOVERED_OUT_DIR`. The script fails fast if the three `BRAIN_*` vars are unset. **No secrets:**
ssh uses the box's own key/agent; the sync never touches a WIF or an API key, and never calls Modal — so
it cannot affect the ~$30/mo Modal budget.

## Cost / not-24-7 note

This sync moves files and kicks existing box timers. It does **not** start or warm the Modal LoRA. The
GPU stays scaled-to-zero (`infra/modal/serve_lora.py` `scaledown_window=120`); Soapy comes alive only for
the two scheduled wakes (`infra/modal/soapy.py`). Running the sync more often would cost nothing on Modal.
