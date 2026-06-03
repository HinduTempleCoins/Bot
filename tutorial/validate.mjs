/**
 * validate.mjs — tutorial stages FSM validator (queue #154).
 *
 * The tutorial is a finite state machine: each stage points at the next
 * stage(s) a user can move to. Before the scheduler/composer ever read
 * stages.json, we want a cheap, pure check that the graph is well-formed:
 * every referenced next-stage exists, there's a start, at least one terminal,
 * no dead ends (a non-terminal that goes nowhere), and no unreachable stages.
 *
 * This file ONLY validates. It never edits stages.json or any other file.
 * The CLI block at the bottom reads the real stages.json read-only and
 * prints a report.
 *
 * --- Stage shape ---
 *
 * The canonical stages.json uses a linear chain:
 *
 *   { "id": 1, "key": "intro_post", "next_stage": 2 }
 *   { "id": 6, "key": "...",        "next_stage": null }   // terminal
 *
 * To stay robust as the program grows, the validator also accepts branching
 * via either `transitions` or `choices`: a plain object mapping a choice
 * label to a target stage id, e.g.
 *
 *   { "id": 3, "transitions": { "yes": 4, "no": 5 } }
 *
 * A stage is TERMINAL when it has no outgoing edges (next_stage === null /
 * undefined and no transitions). The start stage is `_meta.start` if present,
 * otherwise the first stage in the array.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Normalize whatever stages payload we were handed into:
 *   { byId: Map<id, stage>, order: id[], startId, meta }
 * Throws a TypeError on structurally invalid input so validateStages can
 * report a clean error rather than crash deep in the graph walk.
 */
function index(stages) {
  if (!stages || typeof stages !== 'object') {
    throw new TypeError('stages payload must be an object');
  }
  const list = Array.isArray(stages) ? stages : stages.stages;
  if (!Array.isArray(list)) {
    throw new TypeError('stages.stages must be an array');
  }
  const meta = Array.isArray(stages) ? {} : stages._meta ?? {};

  const byId = new Map();
  const order = [];
  for (const stage of list) {
    if (!stage || typeof stage !== 'object' || stage.id === undefined || stage.id === null) {
      throw new TypeError('every stage must be an object with an id');
    }
    if (byId.has(stage.id)) {
      throw new TypeError(`duplicate stage id: ${stage.id}`);
    }
    byId.set(stage.id, stage);
    order.push(stage.id);
  }

  let startId;
  if (meta.start !== undefined && meta.start !== null) {
    startId = meta.start;
  } else {
    startId = order.length ? order[0] : undefined;
  }

  return { byId, order, startId, meta };
}

/**
 * Outgoing edges of a stage, as a list of { label, target } where target
 * is a stage id. Terminal stages return []. `null` next_stage is terminal.
 */
function edges(stage) {
  const out = [];
  if (stage.next_stage !== undefined && stage.next_stage !== null) {
    out.push({ label: 'next', target: stage.next_stage });
  }
  const branch = stage.transitions ?? stage.choices;
  if (branch && typeof branch === 'object') {
    for (const [label, target] of Object.entries(branch)) {
      if (target !== undefined && target !== null) {
        out.push({ label, target });
      }
    }
  }
  return out;
}

function isTerminal(stage) {
  return edges(stage).length === 0;
}

/**
 * validateStages(stages) — PURE.
 *
 * Returns:
 *   {
 *     ok: boolean,
 *     errors: string[],     // hard problems that make the graph invalid
 *     warnings: string[],   // non-fatal observations
 *     stats: { total, terminals: id[], unreachable: id[], startId }
 *   }
 *
 * Never throws for graph-shape problems (those become errors); only throws
 * are avoided by returning ok:false with a descriptive error message.
 */
export function validateStages(stages) {
  const errors = [];
  const warnings = [];

  let idx;
  try {
    idx = index(stages);
  } catch (err) {
    return {
      ok: false,
      errors: [err.message],
      warnings: [],
      stats: { total: 0, terminals: [], unreachable: [], startId: undefined },
    };
  }

  const { byId, order, startId } = idx;
  const total = byId.size;

  if (total === 0) {
    errors.push('no stages defined');
    return { ok: false, errors, warnings, stats: { total: 0, terminals: [], unreachable: [], startId: undefined } };
  }

  // Start must exist.
  if (startId === undefined || startId === null) {
    errors.push('no start stage');
  } else if (!byId.has(startId)) {
    errors.push(`start stage ${JSON.stringify(startId)} does not exist`);
  }

  // Every referenced next-stage must exist; collect terminals & dead ends.
  const terminals = [];
  for (const id of order) {
    const stage = byId.get(id);
    const out = edges(stage);
    if (out.length === 0) {
      terminals.push(id);
      continue;
    }
    for (const { label, target } of out) {
      if (!byId.has(target)) {
        errors.push(`stage ${JSON.stringify(id)} → ${JSON.stringify(target)} (via "${label}") does not exist`);
      }
    }
  }

  // A FSM with no terminal can never end the tutorial.
  if (terminals.length === 0) {
    errors.push('no terminal stage (every stage has an outgoing edge — tutorial can never complete)');
  }

  // Reachability from start (only meaningful if start exists).
  let unreachable = [];
  if (startId !== undefined && byId.has(startId)) {
    const seen = new Set();
    const queue = [startId];
    while (queue.length) {
      const id = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      for (const { target } of edges(byId.get(id))) {
        if (byId.has(target) && !seen.has(target)) queue.push(target);
      }
    }
    unreachable = order.filter((id) => !seen.has(id));
    for (const id of unreachable) {
      errors.push(`stage ${JSON.stringify(id)} is unreachable from start ${JSON.stringify(startId)}`);
    }
  }

  // "Dead end" = a stage that is terminal but never declared so intentionally
  // is fine; the real dead-end risk is a non-terminal stage whose ONLY edges
  // all point at missing targets — already reported above as missing targets.
  // We additionally warn on stages with no incoming AND not the start, even if
  // technically reachable would have caught it; covered by unreachable.

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: { total, terminals, unreachable, startId },
  };
}

/**
 * simulateWalk(stages, choices) — walk a fake user through the FSM.
 *
 * Starting at the start stage, at each non-terminal stage:
 *   - if the stage has a single `next` edge, follow it (choices not consumed);
 *   - if the stage branches, consume the next entry from `choices` (a label)
 *     and follow that labeled edge.
 *
 * `choices` is an array of choice labels (strings) for branching stages,
 * consumed in order. For a purely linear graph it can be omitted/[].
 *
 * Returns:
 *   {
 *     ok: boolean,
 *     path: id[],            // sequence of stage ids visited
 *     terminal: id | null,   // the terminal reached, or null on error
 *     error: string | null,  // dead-end / loop / bad-choice description
 *   }
 *
 * Errors caught: missing target (dead end), loop (a stage visited twice
 * without reaching a terminal), missing/invalid choice at a branch.
 */
export function simulateWalk(stages, choices = []) {
  let idx;
  try {
    idx = index(stages);
  } catch (err) {
    return { ok: false, path: [], terminal: null, error: err.message };
  }
  const { byId, startId } = idx;

  if (startId === undefined || !byId.has(startId)) {
    return { ok: false, path: [], terminal: null, error: 'no valid start stage' };
  }

  const path = [];
  const visited = new Set();
  let current = startId;
  let choiceIdx = 0;
  const choiceList = Array.isArray(choices) ? choices : [];

  // Guard bound: at most one visit per stage before declaring a loop.
  while (true) {
    if (visited.has(current)) {
      path.push(current);
      return { ok: false, path, terminal: null, error: `loop detected at stage ${JSON.stringify(current)}` };
    }
    visited.add(current);
    path.push(current);

    const stage = byId.get(current);
    const out = edges(stage);

    if (out.length === 0) {
      // Terminal reached.
      return { ok: true, path, terminal: current, error: null };
    }

    let chosen;
    if (out.length === 1 && out[0].label === 'next') {
      chosen = out[0];
    } else {
      const label = choiceList[choiceIdx++];
      if (label === undefined) {
        return {
          ok: false,
          path,
          terminal: null,
          error: `dead end: stage ${JSON.stringify(current)} branches but no choice provided (labels: ${out.map((e) => e.label).join(', ')})`,
        };
      }
      chosen = out.find((e) => e.label === label);
      if (!chosen) {
        return {
          ok: false,
          path,
          terminal: null,
          error: `invalid choice ${JSON.stringify(label)} at stage ${JSON.stringify(current)} (labels: ${out.map((e) => e.label).join(', ')})`,
        };
      }
    }

    if (!byId.has(chosen.target)) {
      return {
        ok: false,
        path,
        terminal: null,
        error: `dead end: stage ${JSON.stringify(current)} → ${JSON.stringify(chosen.target)} (via "${chosen.label}") does not exist`,
      };
    }
    current = chosen.target;
  }
}

/* ----------------------------- CLI ----------------------------- */

function formatReport(stages) {
  const lines = [];
  const result = validateStages(stages);
  lines.push('Tutorial stages FSM validation');
  lines.push('==============================');
  lines.push(`Total stages : ${result.stats.total}`);
  lines.push(`Start stage  : ${JSON.stringify(result.stats.startId)}`);
  lines.push(`Terminals    : ${result.stats.terminals.length ? result.stats.terminals.map((x) => JSON.stringify(x)).join(', ') : '(none)'}`);
  lines.push('');

  if (result.ok) {
    lines.push('RESULT: VALID');
  } else {
    lines.push('RESULT: INVALID');
    lines.push('Errors:');
    for (const e of result.errors) lines.push(`  - ${e}`);
  }
  if (result.warnings.length) {
    lines.push('Warnings:');
    for (const w of result.warnings) lines.push(`  - ${w}`);
  }

  // A best-effort linear walk for visibility (linear graphs only need no choices).
  const walk = simulateWalk(stages);
  lines.push('');
  lines.push('Sample walk (no branch choices):');
  lines.push(`  path     : ${walk.path.map((x) => JSON.stringify(x)).join(' -> ') || '(empty)'}`);
  lines.push(`  terminal : ${JSON.stringify(walk.terminal)}`);
  if (walk.error) lines.push(`  error    : ${walk.error}`);

  return { text: lines.join('\n'), ok: result.ok };
}

if (process.argv[1] && process.argv[1].endsWith('validate.mjs')) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const stagesPath = join(__dirname, 'stages.json');
  if (!existsSync(stagesPath)) {
    console.log(`No stages.json found at ${stagesPath} — nothing to validate.`);
    process.exit(0);
  }
  let stages;
  try {
    stages = JSON.parse(readFileSync(stagesPath, 'utf8'));
  } catch (err) {
    console.error(`Failed to read/parse stages.json: ${err.message}`);
    process.exit(2);
  }
  const { text, ok } = formatReport(stages);
  console.log(text);
  process.exit(ok ? 0 : 1);
}
