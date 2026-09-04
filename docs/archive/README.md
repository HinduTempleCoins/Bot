# docs/archive — recovered pre-re-root material

The repo was re-rooted in early 2026: `main` shares **no common ancestor** with the 19 `origin/claude/*`
branches, so nothing on them is reachable from `main` and none of it survives if those branches are pruned.

A full path-and-basename diff of every `claude/*` branch against `origin/main` (2026-09-04) found **311
paths absent from `main` by path**, but only **30 files absent by basename** — the other 281 are the same
corpus files that were later moved from the repo root into `knowledge/<domain>/`. Those 30 are recovered
here and in `knowledge/`, `docs/project_notes/`.

## What is in this directory

| File | Origin branch | Note |
|---|---|---|
| `EVERYTHING_LIST.md` | `claude/review-itinerary-codebase-P1dsy` | 2026-02-23, 201 action items in 15 categories (A–O). Sections A–F are largely superseded legacy; **G (token/DeFi), I (blockchain/mining) and M (SoapBox infra) are the live ones.** |
| `CRYPTO_ACTION_ITEMS.md` | same | companion action list |
| `SKILLS_REVIEW.md` | same | review of the pre-re-root skill set |
| `legacy-skills/` | same | the 10 skills that existed before the re-root, with their `references/` and `scripts/`. Deliberately **NOT** restored to `.claude/skills/` — they would auto-load beside the 6 current skills and several are stale. Promote individually if wanted. |
| `legacy-code/hive-trading-bot.cjs` | `claude/add-bot-knowledge-document-YC4dX` | preserved for reference only. Per `CLAUDE.md`, trade-bot execution is a separate always-on system the AI does not touch. |

Everything here was scanned for host IPs, private keys, PATs and credentials before commit — clean. The
only IP-shaped string is `10.0.0.5` inside `legacy-skills/project-memory/references/key_facts_template.md`,
where it is a filled-in example in a template.
