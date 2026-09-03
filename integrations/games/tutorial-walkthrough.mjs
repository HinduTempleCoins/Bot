// tutorial-walkthrough.mjs — the guided first-run walkthrough engine, plus the Botanica farming one.
//
// PURE + DETERMINISTIC: state in → new state out. No network, no clock, no disk, no DOM. Soft-fail-
// never-throw (house style). The renderer decides how a step LOOKS; this module decides what the
// step IS, when it is satisfied, and who is speaking.
//
// ── The patterns this encodes (what good app walkthroughs actually do) ───────────────────────────
//   * DO IT, DON'T WATCH IT. A step completes when the player performs the real action, not when
//     they press "Next". A walkthrough you can click through without touching the product teaches
//     nothing — so every step here names an `action` the game already emits.
//   * TIME TO FIRST VALUE. The first chapter must end in a real success, not in setup. Chapter 1
//     below ends with a harvest in the player's hands.
//   * THE STEP WAITS, IT NEVER FAILS. Wandering off is not an error. An unrelated event leaves the
//     state untouched; the coach mark is still there when the player comes back.
//   * ALWAYS SKIPPABLE, ALWAYS RESUMABLE. A tutorial that traps you is a bug. `skip()` exits at any
//     point and the state is a plain serialisable object, so it survives a reload.
//   * TWO VOICES, DIFFERENT JOBS. This is the design's own split (.local/BOTANICA_GAME_DESIGN.md §4):
//       - the winged cat = the onboarding buddy, the UI voice — "what to tap now", one short
//         imperative per step;
//       - PHOEBE = the mentor, the diegetic character — "why this matters", one warm beat per
//         chapter, never a click instruction.
//     Hathor is deliberately NOT a speaker here: she is the AI assistant the player pulls up OVER
//     the world at any time, on a different plane from the scripted walkthrough.
//
// ── Exports ──────────────────────────────────────────────────────────────────────────────────────
//   SPEAKERS, FARM_WALKTHROUGH, WALKTHROUGHS
//   walkthroughById(id) / startWalkthrough(id) / currentStep(state) / chapterOf(state)
//   matches(step, event)
//   observe(state, event) / skip(state) / resume(saved) / progress(state) / isComplete(state)
//   esc(s)

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

const id = (v) => String(v == null ? '' : v).trim().toLowerCase();

export const SPEAKERS = Object.freeze({
  cat: { id: 'cat', name: 'the winged cat', role: 'onboarding buddy — what to tap now' },
  phoebe: { id: 'phoebe', name: 'Phoebe', role: 'mentor — why this matters' },
});

// ── The farming walkthrough ──────────────────────────────────────────────────────────────────────
// Actions match what site/botanica/server.mjs already emits: plant, harvest, sell, craft.
// `where` is a plain field-match against the event payload — serialisable, so a saved walkthrough
// never carries a closure. An empty `where` accepts any payload for that action.
export const FARM_WALKTHROUGH = Object.freeze({
  id: 'botanica_farm',
  name: 'Botanica — your first season',
  about: 'Plant, harvest, sell, craft. Ends with something you made and something you earned.',
  chapters: [
    {
      id: 'ground',
      title: 'The Ground',
      // One warm beat from Phoebe per chapter. Never an instruction.
      beat: 'Phoebe is drying herbs when you arrive, and does not look up. "Six beds. They were somebody else\'s last year. Put something in one and we\'ll see what kind of hands you have."',
    },
    { id: 'market', title: 'The Market', beat: 'Phoebe counts your grain into a tin without being asked. "Selling is not the sad part, dear. The sad part is growing something nobody wants. Somebody wanted this."' },
    { id: 'bench', title: 'The Bench', beat: 'She sweeps a space clear with her sleeve. "Raw is worth what it is. Made is worth what you can argue for. That is the whole trade, and everything else is decoration."' },
  ],
  steps: [
    {
      id: 'pick_seed', chapter: 'ground', speaker: 'cat', target: '#seed-shop',
      say: 'Pick a seed from the shop. Wheat is quick — start there.',
      action: 'plant', where: {},
      note: 'Any seed satisfies this; wheat is only the suggestion because it grows fastest.',
    },
    {
      id: 'wait_grow', chapter: 'ground', speaker: 'cat', target: '.plot',
      say: 'Now it grows. Nothing to tap — the plot will tell you when it is ready.',
      action: 'ready', where: {},
    },
    {
      id: 'first_harvest', chapter: 'ground', speaker: 'cat', target: '.plot.ready',
      say: 'Ready. Take it.',
      action: 'harvest', where: {},
      reward: 'first_harvest',
    },
    {
      id: 'sell_materials', chapter: 'market', speaker: 'cat', target: '#sell',
      say: 'Sell what you pulled up. That is your first Grain.',
      action: 'sell', where: {},
      reward: 'first_coin',
    },
    {
      id: 'plant_again', chapter: 'bench', speaker: 'cat', target: '#seed-shop',
      say: 'Craft needs more than one thing. Put two more beds in.',
      action: 'plant', where: {}, repeat: 2,
    },
    {
      id: 'craft_item', chapter: 'bench', speaker: 'cat', target: '#craft',
      say: 'Now make something. Crafted goods sell for more than what went into them.',
      action: 'craft', where: {},
      reward: 'first_craft',
    },
  ],
});

export const WALKTHROUGHS = Object.freeze([FARM_WALKTHROUGH]);
const BY_ID = Object.fromEntries(WALKTHROUGHS.map((w) => [w.id, w]));

export const walkthroughById = (v) => BY_ID[id(v)] || null;

// ── State ────────────────────────────────────────────────────────────────────────────────────────
// A plain serialisable object: { walkthroughId, index, done, skipped, hits, rewards }.
// `hits` counts progress inside a repeating step so `repeat: 2` needs two real actions.
export function startWalkthrough(walkthroughId) {
  const w = walkthroughById(walkthroughId);
  if (!w) return null;
  return { walkthroughId: w.id, index: 0, done: false, skipped: false, hits: 0, rewards: [] };
}

function normalize(state) {
  const w = state && walkthroughById(state.walkthroughId);
  if (!w) return null;
  const total = w.steps.length;
  const index = Math.max(0, Math.min(total, Math.trunc(num(state.index, 0))));
  return {
    walkthroughId: w.id,
    index,
    done: !!state.done || index >= total,
    skipped: !!state.skipped,
    hits: Math.max(0, Math.trunc(num(state.hits, 0))),
    rewards: Array.isArray(state.rewards) ? state.rewards.slice() : [],
  };
}

// resume(saved) → a valid state from anything that was persisted, or null if it names no real
// walkthrough. Out-of-range indexes are clamped rather than trusted.
export const resume = (saved) => normalize(saved);

export function currentStep(state) {
  const s = normalize(state);
  if (!s || s.done || s.skipped) return null;
  const w = walkthroughById(s.walkthroughId);
  const step = w.steps[s.index];
  if (!step) return null;
  const needed = Math.max(1, Math.trunc(num(step.repeat, 1)));
  return { ...step, speakerName: (SPEAKERS[step.speaker] || SPEAKERS.cat).name, needed, hits: s.hits };
}

// chapterOf(state) → the chapter the current step belongs to, including Phoebe's beat. The renderer
// shows the beat once, when the chapter opens.
export function chapterOf(state) {
  const step = currentStep(state);
  if (!step) return null;
  const w = walkthroughById(normalize(state).walkthroughId);
  return w.chapters.find((c) => c.id === step.chapter) || null;
}

// isChapterOpening(state) → true when the current step is the first of its chapter, i.e. the moment
// to play Phoebe's beat rather than only the cat's line.
export function isChapterOpening(state) {
  const s = normalize(state);
  if (!s || s.done || s.skipped) return false;
  const w = walkthroughById(s.walkthroughId);
  const step = w.steps[s.index];
  if (!step) return false;
  const prev = w.steps[s.index - 1];
  return !prev || prev.chapter !== step.chapter;
}

// Does this event satisfy this step? The action must match, and every field named in `where` must
// equal the event payload's field. An empty `where` accepts any payload.
export function matches(step, event) {
  if (!step || !event) return false;
  if (id(event.action) !== id(step.action)) return false;
  const where = step.where && typeof step.where === 'object' ? step.where : {};
  for (const [k, want] of Object.entries(where)) {
    if (String(event[k]) !== String(want)) return false;
  }
  return true;
}

// observe(state, event) → the state after the game reported something happening.
// An unrelated event returns the state UNCHANGED (the step waits, it never fails).
export function observe(state, event) {
  const s = normalize(state);
  if (!s || s.done || s.skipped) return s;
  const w = walkthroughById(s.walkthroughId);
  const step = w.steps[s.index];
  if (!step || !matches(step, event)) return s;

  const needed = Math.max(1, Math.trunc(num(step.repeat, 1)));
  const hits = s.hits + 1;
  if (hits < needed) return { ...s, hits };

  const rewards = step.reward && !s.rewards.includes(step.reward) ? s.rewards.concat([step.reward]) : s.rewards;
  const index = s.index + 1;
  return { ...s, index, hits: 0, rewards, done: index >= w.steps.length };
}

export function skip(state) {
  const s = normalize(state);
  return s ? { ...s, skipped: true } : s;
}

export function isComplete(state) {
  const s = normalize(state);
  return !!(s && s.done && !s.skipped);
}

// progress(state) → what a progress indicator needs. `pct` is 0..100.
export function progress(state) {
  const s = normalize(state);
  if (!s) return null;
  const w = walkthroughById(s.walkthroughId);
  const total = w.steps.length;
  const stepNumber = Math.min(total, s.index + 1);
  const step = w.steps[s.index] || null;
  return {
    total,
    index: s.index,
    stepNumber: s.done ? total : stepNumber,
    pct: total ? Math.round((s.index / total) * 100) : 100,
    chapter: step ? (w.chapters.find((c) => c.id === step.chapter) || null) : null,
    done: s.done,
    skipped: s.skipped,
    rewards: s.rewards.slice(),
  };
}

export default {
  SPEAKERS, FARM_WALKTHROUGH, WALKTHROUGHS,
  walkthroughById, startWalkthrough, currentStep, chapterOf, isChapterOpening, matches,
  observe, skip, resume, progress, isComplete, esc,
};
