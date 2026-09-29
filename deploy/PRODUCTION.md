# Hathor's production — how it runs, how to pause it, how to stop it

Everything runs on the servers. Nothing depends on a Codespace or a laptop. There is no SSH between the servers: the
worker pulls work over HTTPS with a token, and pushes finished media the same way.

## What runs where

**Posting host** (holds the LLM keys and the MELEK-Signer token)
- `hathor-doc-submit.timer` — every 30 min: the submitter keeps the month-long documentary queue, re-prioritises it
  from viewer votes, plans the next film (topic definition → shot plan) and queues it on the Video Studio
  (capped at 2 open films). Code: `/opt/melek-bot/docmaker` (sparse checkout of this repo, pulled on each run).
  State: `/var/lib/hathor-docs-submit/` (queue.json, state.json, topics/, submit-log.jsonl).
- `shilpa-poster.timer` — every 3 h: @shilpa-shastra posts the next remake set, then the next video set
  (documentaries → character scenes → maps → animations), with the "we are testing these features" line.

**Worker** (the CPU renderer)
- `hathor-vworker.service` — always on: pulls Video Studio jobs and production documentaries, renders them, and runs
  media sync every 30 min (remakes, animations, documentaries, maps and subtitles → the website).
- `hathor-remakes.timer` → `hathor-remakes.service` — the remake batch (mythology first), re-run daily.
- `hathor-media.timer` → `hathor-media.service` — daily: test animations, character scenes, imagined scenes.
- `hathor-assets.timer` → `hathor-assets.service` — daily: renders the parts the films report missing.
- `hathor-whisper.service` — always on, lowest priority: subtitles for the free films (daily rescan).
- Code: `/opt/melek-gen/repo` (sparse checkout of this repo, pulled when the worker service starts).

**Web host**: `/documentaries/status` shows the queue, what was made today, what's next and whether it's paused.
It is read-only; there are no controls on the public web.

## Pause (everything idles; nothing is lost)

```
# on the posting host AND on the worker
sudo touch "$PRODUCTION_PAUSE_FILE"   # the path is set in each host's private production env file (see .local/)
```
The submitter and the poster skip their runs; the worker takes no new jobs and stops publishing; batch jobs are frozen
in place (and resume where they were).

## Resume

```
# on both hosts
sudo rm "$PRODUCTION_PAUSE_FILE"
```

## Status

```
# posting host
systemctl list-timers hathor-doc-submit.timer shilpa-poster.timer
journalctl -u hathor-doc-submit -n 20 --no-pager
sudo node /opt/melek-bot/docmaker/integrations/documentary/submit.mjs --status   # queue counts + next films (needs the env files)
journalctl -u shilpa-poster -n 10 --no-pager                                     # last posts

# worker
systemctl status hathor-vworker hathor-whisper --no-pager
systemctl list-timers 'hathor-*' --no-pager
tail -n 20 /opt/melek-gen/media-sync.log

# anywhere
curl -s https://hathor.soapbox.community/documentaries/status
```

## Full stop

```
# posting host
sudo systemctl disable --now hathor-doc-submit.timer shilpa-poster.timer
# worker
sudo systemctl disable --now hathor-vworker hathor-whisper hathor-remakes.timer hathor-remakes hathor-media.timer hathor-assets.timer
```
Start again with `enable --now` on the same units.

## Files

Unit templates and scripts: `deploy/production/worker/` and `deploy/production/posting/`. Secrets live only in each host's private
config directory (units reference it as `@CONF@`; the private installer in `.local/` fills it in; never in the repo): `vstudio-worker.env` (worker token), `production-worker.env`
(paths), `doc-submit.env` (Video Studio URL + production token), `guest-proxy.env` (LLM keys, posting host only).
