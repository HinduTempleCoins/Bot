# MELEK Brief Protocol

The MELEK Resident AI lives on Server A (a VPS separate from this repo's
Codespace and from Server B which hosts the Bot runtime + chain + condenser).
It reads the Bot Repo via a local Qdrant index, watches for things-that-need-
doing, and writes **briefs** that Claude Code consumes before touching the
repo.

This document is the public-facing protocol. Private install detail lives in
`infra/oracle-vm/SETUP.md` and `infra/oracle-vm/BRIEF_ACCESS.md`.

## The three-part brief format

Every brief the resident AI writes has exactly three sections, in order:

### `## FOR RYAN`
Plain text for the operator. What this is, why it matters, what it does.
Peer register — no walkthroughs, no condescension. Operator reads this section
first.

### `## FOR CLAUDE CODE`
The task to implement. File paths, where the drafted code goes, how to test,
any gotchas. References the drafted code in the section below.

### `## DRAFTED CODE`
Real implementation in fenced blocks with the target path as the first-line
comment. Complete enough that Claude Code can ship it with minimal edits.
If the brief is pure research (no code), the AI says so and omits this section.

Claude Code's workflow becomes: retrieve brief → give operator the FOR RYAN
plain-text list → on approval, apply the DRAFTED CODE per the FOR CLAUDE CODE
instructions. The work is mostly done before Claude Code touches it.

## Append-only invariant + the 30-minute editor's-note revision pass

Once a brief is **published** to `<DATA_DIR>/briefs/` on Server A, the
original body is **immutable**. The AI never rewrites it.

Every 30 minutes the AI walks all briefs that **Claude Code hasn't yet
consumed**. For each, it re-retrieves repo context for the brief's original
task and asks itself: would new information change the recommendation? If yes,
it **appends** an `## Editor's Note (ISO timestamp)` block to the brief stating
what changed and what the reader should know now.

This means Claude Code reads one coherent document with the AI's latest
thinking baked in — instead of reconciling brief #1's "do X" against brief #5's
"actually undo X" later. The history of the AI's thinking stays visible
alongside its current take; cryptographic-style discipline, not silent
rewriting.

## Consumed semantics

When Claude Code retrieves a brief via `GET /brief/read`, the brief is marked
**consumed** in its sidecar metadata. From that point on:

- The 30-minute revisor leaves it alone — further changes start a **new** brief
  instead of editing the old one.
- The brief is still available for re-reading; consumption is a one-way flag.
- The `?peek=1` query param reads without marking consumed (the revisor uses
  this internally).

## Where briefs live

`<DATA_DIR>/briefs/` on Server A. **Never** committed to this repo,
**never** pushed, **never** on Server B. Filename pattern
`YYYY-MM-DDTHH-MM-SSZ-<topic>.md`, with a sidecar `<filename>.meta.json` for
status (consumed, revision count, original task).

This is intentional: synthesized maps of the repo + the AI's drafted code
trees shortcut attacker recon work, so they don't get committed. See
`feedback-synthesis-docs-go-in-local` in operator memory for the rule.

## Boundaries

- **The AI drafts code; it does not commit.** Commit/deploy stays with Claude
  Code + operator. The AI proposes, the humans dispose.
- **The AI has no key access.** Signer/watcher VPSes are separate and hold
  Hathor's keys under KMS-wrapping (private signer-repo track). Server A
  reaches Server B over SSH for admin only, not for signing.
- **Server A is read-only against the repo.** It indexes; it doesn't write
  back to the repo or push anywhere. Its writes go to `<DATA_DIR>/` only.
- **No trading from the resident AI.** The trade bots execute autonomously
  always-on; the resident AI analyzes their data and drafts improvements to
  them. Two distinct systems.

## Topics

Briefs are tagged by topic. Current set:

- `hathor` — the MELEK AI Witness account, `witness/`, `src/chain/`, voice work.
- `cheetah` — the planned credit-first/discovery-first sibling bot.
- `signup` — welcomer + tutorial detector/composer + future signup-help server.
- `trades` — trade-bot data analysis + drafted bot improvements.
- `infra` — Server A/B/signer/watcher, deploy, observability, indexer/briefd itself.
- `general` — anything else.

Topics are how `/brief/by-topic/:topic` filters listings.

## Endpoints

See `infra/oracle-vm/BRIEF_ACCESS.md` for the full API + auth + tunneling
detail.
