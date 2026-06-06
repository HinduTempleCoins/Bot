---
name: memory-conventions
description: Manage session memory, handoffs, and where docs live in the MELEK Bot repo. Use when ending a session, writing a handoff, adding to MEMORY.md, or deciding where a synthesis/inventory/architecture doc belongs (public vs .local/). Keeps MEMORY.md index entries one line and synthesis docs private.
---

# Memory + doc-placement conventions

## MEMORY.md index discipline
`MEMORY.md` is an INDEX, not a store. It is currently OVER its size limit.
- Each entry is ONE line, under ~200 chars: a bold linked title + a one-line gist.
- Put detail in the linked topic file, never inline in the index.
- When adding an entry, do not bloat existing ones; prefer tightening over appending prose.

## Session handoff
- Save continuation state via the `remember` skill / `.remember/` handoff at session end so the next session resumes cleanly.
- Handoffs capture: what's in flight, the operator's last words, recent code changes, the next action — not a transcript.

## Where docs go (public vs private)
- **Synthesis / inventory / architecture / map docs → `.local/`** (gitignored), even if a pasted brief says otherwise. Escalation test: "If a stranger read this with attack intent, does it meaningfully shorten their recon?" If yes → `.local/`.
- Hostnames, IPs, server paths, key material, brief endpoints → `.local/` only.
- Operator's private knowledge JSONLs stay gitignored; only the openly-licensed reference corpus subdirs are committed.

## Itineraries are append-only
`ITINERARY.md` and `MASTER_ITINERARY.md` NEVER remove or replace items — only ADD. Keep old lines (including stale `Last-Updated` lines); add new lines underneath. No "superseded"/"evolved" rewrites of past entries.

## Don't auto-edit data records
Never auto-edit `knowledge/**` source files. The fact-checker FLAGS to its own log only; correcting source data is discuss-first.
