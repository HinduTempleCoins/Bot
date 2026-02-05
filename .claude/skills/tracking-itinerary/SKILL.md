---
name: tracking-itinerary
description: >
  Track, update, and report on project itinerary and roadmap status.
  Use when the user asks about progress, what's next, phase status,
  marking tasks complete, adding new tasks, or wants a progress report.
  Triggers on: "itinerary", "what's next", "update status", "progress",
  "phase", "roadmap", "mark complete", "add to itinerary", "what phase",
  "priorities", "what needs to be done", "status report", "action items".
---

# Itinerary Tracker

Track project progress across the Van Kush Bot Ecosystem's 12-phase roadmap.

## Core Files

**Primary itineraries** (always check both):
- `ITINERARY.md` - Practical schedule with checkboxes and status markers
- `MASTER_ITINERARY.md` - 12-phase technical roadmap with specs and dependencies

**Satellite files** (contain untracked tasks - check when consolidating):
See `references/satellite-files.md` for the full list of files containing action items not yet on the main itineraries.

## Operations

### Reading Status

1. Read `ITINERARY.md` and `MASTER_ITINERARY.md`
2. Identify the current phase by looking for unchecked `[ ]` items after the last `[x]` block
3. Summarize: what's done, what's in progress, what's next
4. If the user asks about a specific phase, find it by heading (e.g., "## PHASE 8")

### Marking Tasks Complete

1. Find the exact checkbox line: `- [ ] Task description`
2. Change to: `- [x] Task description`
3. Add a timestamp comment if the task is a major milestone: `- [x] Task description (completed YYYY-MM-DD)`
4. **NEVER remove lines.** Only change `[ ]` to `[x]`.
5. Commit the change with message: `Update itinerary: mark [task] complete`

### Adding New Tasks

1. Identify which phase the task belongs to (check `references/phase-map.md`)
2. Add the new `- [ ] Task description` under the correct phase heading
3. If the task came from a satellite file, note the source: `- [ ] Task description (from BOT_AUDIT.md)`
4. For tasks that don't fit any phase, add under "## QUICK WINS" in ITINERARY.md
5. **NEVER remove existing items** when adding new ones

### Consolidation Report

When asked to consolidate or find untracked tasks:

1. Read all satellite files listed in `references/satellite-files.md`
2. Compare each action item against ITINERARY.md and MASTER_ITINERARY.md
3. Report items that exist in satellite files but NOT in the main itineraries
4. Ask user which ones to add and where
5. Add approved items to the correct phase

### Progress Report

When asked for a progress report or "where are we":

```
## Progress Report - [date]

**Current Phase**: [phase name and number]
**Overall**: [X of Y] major milestones complete

### Recently Completed
- [items marked [x] with recent dates]

### In Progress
- [items that are partially done or actively being worked]

### Next Up (Priority Order)
1. [highest priority unchecked item]
2. [next]
3. [next]

### Blocked / Needs Discussion
- [items that can't proceed without input]

### Untracked Items Found
- [count] items in satellite files not on main itinerary
```

## Rules

1. **Append-only**: Never delete tasks, phases, or notes. Only add or mark complete.
2. **Preserve formatting**: Keep existing markdown structure, checkbox format, and emoji markers.
3. **Source attribution**: When adding tasks from satellite files, note where they came from.
4. **Phase boundaries**: Don't move tasks between phases without user approval.
5. **Dependencies**: Check `references/phase-map.md` before suggesting what's "next" - some phases depend on others.
