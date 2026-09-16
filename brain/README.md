# brain/ — the feeder for the Briefs & Annals system

Server 4 runs the whole slow-path brain on timers:

| Unit | Cadence | What it does |
|---|---|---|
| `melek-reconcile` | 8 min | mines `brain/transcripts/*.jsonl` → `reconciliation/operator-asks.md` (append-only, never wiped) |
| `melek-mom` | 30 min | distils each session's asks → `.mom.md` Decisions + Action Items |
| `melek-ai-network` | 1 min | API ensemble reads the repo → per-file and subsystem **annals** |
| `melek-brief` | 1 hour | tracker + diagnostics + asks + MoM → the hourly **FOR-RYAN brief** |
| `melek-harvest` | 6 hour | mines annals → a fresh next-action queue |
| `melek-conference` | 12 hour | the coder + security AI conference (MoM) |

**That pipeline had no input.** `/var/melek-bot/brain/transcripts/` was empty, so every brief was
assembled over an asks file last touched in early September. This directory is the missing feeder.

## wash-transcript.mjs

A raw Claude Code transcript is ~100 MB per session, and most of it is tool traffic carrying
credentials, private keys and server IPs. It cannot be shipped as-is into a store that is never
wiped. The washer:

- keeps the **operator's words verbatim** — that is the precedent briefs are built on
- keeps a **short digest** of each assistant turn
- **drops every `tool_use` input and `tool_result` payload** — the bulk and the risk
- **redacts** key blocks, app passwords, WIF/Graphene/EVM keys, high-entropy tokens, and every
  non-loopback IPv4
- **drops harness-injected "user" turns** — compaction summaries, subagent hand-backs, task
  notifications. Those are machine text, and filing them as "the operator's own words" would make a
  subagent's report into precedent it is not.

Measured on the live session: **99.3 MB → 0.9 MB**, 325 operator turns kept, 72 harness-injected
turns dropped, zero non-loopback IPv4 and zero key-shaped tokens surviving in the output.

```
node brain/wash-transcript.mjs <in.jsonl> <out.jsonl>
bash brain/ship-transcripts.sh          # wash all + rsync to the brain + kick reconcile/mom/brief
```

`ship-transcripts.sh` is idempotent and safe on a timer.
