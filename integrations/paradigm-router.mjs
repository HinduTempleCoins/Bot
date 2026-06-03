// paradigm-router.mjs — Hathor's PARADIGM router (queue #90).
//
// One job: route each unit of work to the CHEAPEST tool that can do it correctly, escalating
// only as far as needed. The ladder, cheapest first:
//
//   RULES     deterministic / bounded decisions       (no model, free)
//   TINY LLM  short classification / routing          (cheap)
//   SMALL LLM language parse / generate               (moderate)
//   CLOUD LLM hard, open-ended, low-confidence work   (expensive)
//
// The whole point: the LLM is the ESCALATION tier, not the default. Most jobs are bounded or
// classifiable and never need a model at all. We only reach for a cloud model when the job is
// genuinely open-ended or the cheaper tiers can't be trusted to get it right.
//
// This module is a PURE routing decision — no network, no env reads, no side effects. It composes
// with llm-router.mjs, which is the actual executor for the 'small'/'cloud' tiers: either import
// it and wire it as the handler, or inject it via dispatch(job, handlers). We never edit it here.
//
//   import { route, classifyJob, dispatch } from './integrations/paradigm-router.mjs';
//   const { tier, reason, estCostTier } = route({ kind: 'classify', tokens: 40 });
//   const out = await dispatch(job, { rules: r, tiny: t, small: s, cloud: c });
//
// CLI:  node integrations/paradigm-router.mjs '{"kind":"summarize","needsLanguage":true}'

// ── Tiers, ordered cheapest → most expensive ─────────────────────────────────────────────────
export const TIERS = ['rules', 'tiny', 'small', 'cloud'];

// Map each tier to a coarse cost band, so callers can budget without knowing provider pricing.
export const COST_TIER = {
  rules: 'free',
  tiny: 'cheap',
  small: 'moderate',
  cloud: 'expensive',
};

// Job kinds that are inherently bounded/deterministic — they should resolve at the RULES tier
// regardless of other hints, because a model would only add cost and nondeterminism.
const BOUNDED_KINDS = new Set([
  'lookup',
  'validate',
  'format',
  'compute',
  'route',
  'dispatch',
  'decision',
]);

// Job kinds that are short classification/labeling — the TINY tier's sweet spot.
const CLASSIFY_KINDS = new Set([
  'classify',
  'label',
  'tag',
  'detect',
  'triage',
  'intent',
]);

// Job kinds that need real language handling (parse free text / generate prose) — SMALL tier,
// unless the job is large or open-ended enough to warrant escalation to CLOUD.
const LANGUAGE_KINDS = new Set([
  'parse',
  'extract',
  'summarize',
  'rewrite',
  'translate',
  'generate',
  'answer',
  'compose',
]);

// Heuristic thresholds. These are deliberately conservative: when in doubt, prefer the cheaper
// tier, and only escalate on a clear signal (long input, declared high complexity, low confidence).
const LONG_TOKEN_THRESHOLD = 2000; // long inputs blow past small-model context/quality → cloud
const TINY_TOKEN_CEILING = 200; // classification jobs above this are too long for the tiny tier
const HIGH_COMPLEXITY = 0.7; // complexity in [0,1]; at/above this, treat as hard → cloud
const LOW_CONFIDENCE = 0.5; // routing confidence below this → escalate one notch toward cloud

// ── classifyJob: PURE heuristic, returns a tier name ─────────────────────────────────────────
// Rules:
//   bounded decision           → 'rules'
//   short classify             → 'tiny'
//   parse / generate language  → 'small'
//   long / open-ended / low-confidence → 'cloud'
export function classifyJob(job = {}) {
  const {
    kind = '',
    bounded,
    needsLanguage,
    complexity,
    tokens,
    confidence,
    openEnded,
  } = job;

  const k = String(kind).toLowerCase();
  const tok = Number.isFinite(tokens) ? tokens : 0;
  const cx = Number.isFinite(complexity) ? complexity : 0;

  // 1) Explicitly bounded, or a known deterministic kind, with no language need → RULES.
  //    An explicit bounded:false overrides the kind table (caller knows it's not bounded).
  const isBounded = bounded === true || (bounded !== false && BOUNDED_KINDS.has(k));
  if (isBounded && !needsLanguage) return 'rules';

  // 2) Anything genuinely hard goes straight to CLOUD: declared open-ended, high complexity,
  //    or a very long input that the small model can't do justice to.
  if (openEnded === true) return 'cloud';
  if (cx >= HIGH_COMPLEXITY) return 'cloud';
  if (tok >= LONG_TOKEN_THRESHOLD) return 'cloud';

  // 3) Short classification / labeling → TINY (only if it's actually short).
  if (CLASSIFY_KINDS.has(k) && !needsLanguage) {
    if (tok <= TINY_TOKEN_CEILING) return 'tiny';
    // A "classify" job with a big payload is really a parse job → fall through to SMALL.
    return 'small';
  }

  // 4) Language parse/generate → SMALL.
  if (needsLanguage === true || LANGUAGE_KINDS.has(k)) {
    // Low confidence in the cheap path → escalate one notch to CLOUD for safety.
    if (Number.isFinite(confidence) && confidence < LOW_CONFIDENCE) return 'cloud';
    return 'small';
  }

  // 5) Nothing matched. If a language need is hinted at all, SMALL; otherwise default to the
  //    cheapest plausible model tier (tiny) rather than burning cloud spend on an unknown.
  if (needsLanguage) return 'small';
  return 'tiny';
}

// ── route: classify + attach reason + cost band ──────────────────────────────────────────────
export function route(job = {}) {
  const tier = classifyJob(job);
  return {
    tier,
    estCostTier: COST_TIER[tier],
    reason: reasonFor(tier, job),
  };
}

function reasonFor(tier, job) {
  const k = String(job.kind || '').toLowerCase();
  switch (tier) {
    case 'rules':
      return `bounded/deterministic job ("${k || 'decision'}") — no model needed`;
    case 'tiny':
      return `short classification ("${k || 'classify'}") — tiny LLM is sufficient`;
    case 'small':
      return `language parse/generate ("${k || 'language'}") — small LLM`;
    case 'cloud':
      if (job.openEnded === true) return 'open-ended job — cloud LLM';
      if (Number.isFinite(job.complexity) && job.complexity >= HIGH_COMPLEXITY)
        return `high complexity (${job.complexity}) — cloud LLM`;
      if (Number.isFinite(job.tokens) && job.tokens >= LONG_TOKEN_THRESHOLD)
        return `long input (${job.tokens} tokens) — cloud LLM`;
      if (Number.isFinite(job.confidence) && job.confidence < LOW_CONFIDENCE)
        return `low confidence (${job.confidence}) — escalated to cloud LLM`;
      return 'hard/open-ended job — cloud LLM';
    default:
      return 'routed';
  }
}

// ── dispatch: thin executor that calls the injected handler for the chosen tier ──────────────
// handlers = { rules?, tiny?, small?, cloud? }. Each is a function (job) => result (sync or async).
// Handlers are INJECTED so this is testable with stubs; in production the 'small'/'cloud' handlers
// are typically backed by llm-router.mjs's complete(). We never call the network here ourselves.
export async function dispatch(job = {}, handlers = {}) {
  const { tier } = route(job);
  const handler = handlers[tier];
  if (typeof handler !== 'function') {
    throw new Error(`paradigm-router: no handler registered for tier "${tier}"`);
  }
  return handler(job);
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('paradigm-router.mjs')) {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: node integrations/paradigm-router.mjs \'{"kind":"...", ...}\'');
    process.exit(1);
  }
  let job;
  try {
    job = JSON.parse(arg);
  } catch {
    console.error('paradigm-router: argument must be a JSON object describing the job');
    process.exit(1);
  }
  console.log(JSON.stringify(route(job), null, 2));
}
