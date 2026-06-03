// tiny-model-handler.mjs — the tiny/small local-model tier for the MELEK stack (queue #93).
//
// PURPOSE: not every job needs a frontier API or even the 7B+ GPU brain. A great deal of the
// always-on housekeeping — routing a message to the right brain, classifying a topic, flagging an
// anomaly in a feed — is bounded, structured work that a *very small* local model does cheaply and
// privately on commodity hardware (CPU box, eventually a phone). This module is the SELECTION layer
// for that tier: it picks the right small model for a task and dispatches to an INJECTED runtime
// (Ollama / llama.cpp HTTP endpoint). It performs NO real inference and holds NO keys. The runtime is
// always passed in, so tests stay fully offline and the module never reaches the network on its own.
//
//   import { MODELS, pickModel, run } from './tiny-model-handler.mjs';
//   const model = pickModel('classify');                 // PURE — deterministic catalog lookup
//   const out   = await run({ task: 'classify', prompt }, { runtime: myOllamaCaller });
//
// DESIGN FLOOR — "1-3B beats <1B on agentic tasks": the sub-1B ultra-tiny models (Qwen2.5-0.5B,
// MobileLLM) are genuinely good ONLY at narrow, bounded jobs — routing, single-label classification,
// anomaly yes/no. The moment a task needs language understanding, parsing into structure, or any
// generation, the floor is the ~3B general small model (SmolLM3-3B). We never route a generative or
// parsing task down to an ultra-tiny model just because it's cheaper; that's the documented failure.
//
// ENERGY NOTE (why this tier exists at all): a ~350M model at 8-bit sips power — it can run all day on
// a phone battery. A 7B model is ~20x that and drains a phone in roughly 2 hours. So the ultra-tiny
// tier is what makes "an AI that lives on the device, always on" physically possible; the 3B general
// model is the comfortable laptop/CPU-box floor; anything heavier belongs on the GPU brain, not here.

// ── Model catalog ─────────────────────────────────────────────────────────────────────────────────
// Two tiers. `general` (3B) is the default workhorse; `ultra-tiny` (<1B) is for bounded jobs only.
// ramGB is a rough resident-set estimate at a sensible quant (≈ 4-bit for the small ones, q8 noted).
export const MODELS = {
  'smollm3-3b': {
    id: 'smollm3-3b',
    tier: 'general',
    params: '3B',
    ramGB: 3,
    useCases: ['language', 'parse', 'generate', 'summarize', 'reason'],
    note: 'General small model. The floor for anything generative/parsing — laptop/CPU-box friendly.',
  },
  'qwen-0.5b': {
    id: 'qwen-0.5b',
    tier: 'ultra-tiny',
    params: '0.5B',
    ramGB: 0.5,
    useCases: ['classify', 'route', 'anomaly'],
    note: 'Qwen2.5-0.5B. Bounded jobs only (routing/classify/anomaly). ~all-day on a phone.',
  },
  mobilellm: {
    id: 'mobilellm',
    tier: 'ultra-tiny',
    params: '350M',
    ramGB: 0.35,
    useCases: ['classify', 'route', 'anomaly'],
    note: 'MobileLLM ~350M. On-device tier. ~350M @ 8-bit ≈ all-day phone; 7B ≈ 2h. Bounded jobs only.',
  },
};

// Default picks per tier (named so the routing logic and tests stay legible).
const GENERAL = 'smollm3-3b';
const ULTRA_TINY = 'qwen-0.5b';

// Tasks an ultra-tiny model is allowed to own. Everything else is escalated to the 3B general model
// per the "1-3B beats <1B on agentic tasks" floor.
const BOUNDED_TASKS = new Set(['classify', 'route', 'routing', 'anomaly', 'detect']);

// ── pickModel(task) — PURE selection ────────────────────────────────────────────────────────────
// Maps a task label to a model id from MODELS. Bounded classify/route/anomaly → ultra-tiny;
// language/parse/generate/everything-else → the 3B general model. Unknown/empty tasks are treated as
// generative (safe default = the more capable model).
export function pickModel(task) {
  const t = typeof task === 'string' ? task.trim().toLowerCase() : '';
  return BOUNDED_TASKS.has(t) ? ULTRA_TINY : GENERAL;
}

// ── run({task, prompt}, {runtime}) — dispatch to an injected runtime ─────────────────────────────
// Chooses the model with pickModel, then calls the injected runtime as
//   runtime({ model, prompt, task }) -> Promise<result>
// SOFT-FAIL: with no runtime (or a non-function), returns a structured { ok:false } envelope rather
// than throwing — the caller decides whether the small tier was even available. A throwing runtime is
// also caught and surfaced as { ok:false, error }.
export async function run({ task, prompt } = {}, { runtime } = {}) {
  const model = pickModel(task);
  if (typeof runtime !== 'function') {
    return { ok: false, model, reason: 'no-runtime' };
  }
  try {
    const output = await runtime({ model, prompt, task });
    return { ok: true, model, output };
  } catch (err) {
    return { ok: false, model, error: err && err.message ? err.message : String(err) };
  }
}

// ── CLI: a worked example (no network — uses a stub runtime) ─────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('tiny-model-handler.mjs')) {
  console.log('catalog:', Object.keys(MODELS).join(', '));
  console.log("pickModel('classify') =", pickModel('classify'));
  console.log("pickModel('generate') =", pickModel('generate'));
  console.log("pickModel('parse')    =", pickModel('parse'));

  const stub = async ({ model, task }) => `[${model}] handled "${task}" (stub — no real inference)`;
  run({ task: 'classify', prompt: 'is this spam?' }, { runtime: stub }).then((r) =>
    console.log('run(classify) =', r),
  );
  run({ task: 'generate', prompt: 'write an intro' }, {}).then((r) =>
    console.log('run(generate, no runtime) =', r),
  );
}
