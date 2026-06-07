// tutorial-logic.mjs — pure, offline-testable logic for the alpha tutorial UI.
// No DOM, no network, no secrets. The browser controller (tutorial-ui.mjs) imports
// these helpers; the tests exercise them directly with plain objects.
//
// Progress lives ENTIRELY in the browser's localStorage as a set of completed stage
// keys. The tutorial is a self-paced checklist — the Witness's real, on-chain detection
// (tutorial/detector.js) is the source of truth for rewards; this UI is just a map the
// newcomer marks for themselves. Soft-fail never throws: a corrupt store reads as empty.

export const STORE_KEY = 'melek_tutorial_progress_v1';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** Parse the stored progress JSON into a Set of completed stage keys. Never throws. */
export function readProgress(storage) {
  try {
    const raw = storage && storage.getItem ? storage.getItem(STORE_KEY) : null;
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((k) => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Persist a Set/array of completed stage keys. Never throws (quota / private mode). */
export function writeProgress(storage, completed) {
  try {
    const arr = Array.from(completed || []);
    if (storage && storage.setItem) storage.setItem(STORE_KEY, JSON.stringify(arr));
    return true;
  } catch {
    return false;
  }
}

/** Toggle one stage key in a completed-set and return the NEW set (does not mutate input). */
export function toggleStage(completed, key, on) {
  const next = new Set(completed || []);
  const want = on === undefined ? !next.has(key) : Boolean(on);
  if (want) next.add(key); else next.delete(key);
  return next;
}

/** A stage is actionable now only if it is not gated on infra that does not yet exist. */
export function isActionable(stage) {
  return !stage.infra_gated && stage.tier === 'A';
}

/** Human status for a stage given the completed-set. */
export function stageStatus(stage, completed) {
  if (completed && completed.has(stage.key)) return 'done';
  if (stage.infra_gated) return 'gated';
  if (stage.tier === 'C') return 'phase3';
  return 'open';
}

/** Summary numbers for the progress bar. "core" = the tier-A actionable spine. */
export function progressSummary(stages, completed) {
  const done = completed || new Set();
  const core = stages.filter(isActionable);
  const coreDone = core.filter((s) => done.has(s.key)).length;
  const total = stages.length;
  const totalDone = stages.filter((s) => done.has(s.key)).length;
  return {
    core: core.length,
    coreDone,
    total,
    totalDone,
    corePct: core.length ? Math.round((coreDone / core.length) * 100) : 0,
  };
}

/** The next open, actionable stage (the one to nudge the newcomer toward), or null. */
export function nextOpenStage(stages, completed) {
  const done = completed || new Set();
  return stages.find((s) => isActionable(s) && !done.has(s.key)) || null;
}

/** Look a stage up by id (number or numeric string), or null. */
export function stageById(stages, id) {
  const n = Number(id);
  return stages.find((s) => s.id === n) || null;
}
