// mycin-router.mjs — a MYCIN-style RULES-FIRST inference front-end for the MELEK stack.
//
// PURPOSE — cut Server-4 Smol-LLM latency without spending a cent. Most inbound jobs are
// bounded enough that a small set of certainty-weighted rules can answer them outright. So we
// try the RULES first (pure, instant, free) and only reach for the model when the rules aren't
// confident enough. The LLM becomes the ESCALATION tier, not the default — the same paradigm as
// paradigm-router.mjs, but with a MYCIN certainty-factor confidence gate on the front.
//
// And it LEARNS. Every answer (rules or model) can be recorded as a case. When the same intent
// has been answered the same way, with high confidence and operator/user acceptance, enough
// times, promoteCases() derives a NEW rule from it. Next time that intent arrives, a rule fires
// and the model is never touched. The system gets faster and cheaper the more it is used.
//
// This composes the existing house parts — it does NOT reimplement them:
//   • certainty.mjs   — combineCF / chainCF / aggregate / toConfidence (the CF algebra + gate)
//   • rules-engine.mjs — Engine: facts → conditions → outcomes + audit trace
//   • paradigm-router  — dispatch(job, handlers): tiny → small → cloud escalation ladder
//
//   import { infer, answerOrEscalate, recordCase, promoteCases } from './mycin-router.mjs';
//   const r = infer({ query, facts, ruleSets });               // pure, no model
//   const o = await answerOrEscalate(job, handlers, opts);     // rules-first, escalate if unsure
//
// DESIGN RULES (shared, load-bearing): ESM .mjs; pure where possible; deps INJECTED so tests run
// fully OFFLINE (no network, no real model — handlers are stubs); SOFT-FAIL / NEVER-THROW at the
// edge; deterministic; no secrets; CLI guarded behind an argv check.

import { combineCF, chainCF, aggregate, toConfidence, clampCF } from './certainty.mjs';
import { Engine } from './rules-engine.mjs';
import { dispatch } from './paradigm-router.mjs';

// ── CF extraction from a fired rule's outcome ─────────────────────────────────────────────────
// A rule's `then` (its outcome) may carry a certainty factor in any of a few ergonomic shapes.
// We read it defensively so rule authors aren't forced into one schema:
//   • a bare number outcome             → that number IS the CF
//   • { cf } or { certainty }           → explicit CF
//   • { ruleCF, premiseCF }             → chainCF(ruleCF, premiseCF): discount by premise belief
//   • anything else                     → DEFAULT_CF (a moderate positive prior)
// Missing/garbage collapses to a sane default rather than throwing.
const DEFAULT_CF = 0.6;

export function outcomeCF(outcome) {
  if (typeof outcome === 'number') return clampCF(outcome);
  if (outcome && typeof outcome === 'object') {
    if (Number.isFinite(outcome.ruleCF)) {
      const premise = Number.isFinite(outcome.premiseCF) ? outcome.premiseCF : 1;
      return chainCF(outcome.ruleCF, premise);
    }
    if (Number.isFinite(outcome.cf)) return clampCF(outcome.cf);
    if (Number.isFinite(outcome.certainty)) return clampCF(outcome.certainty);
  }
  return DEFAULT_CF;
}

// Pull the human-facing answer out of a fired rule's outcome. Strings pass through; objects expose
// `.answer`/`.decision`/`.action`/`.reply`; otherwise we hand back the whole outcome value.
export function outcomeAnswer(outcome) {
  if (typeof outcome === 'string') return outcome;
  if (outcome && typeof outcome === 'object') {
    for (const k of ['answer', 'decision', 'action', 'reply', 'value']) {
      if (outcome[k] !== undefined) return outcome[k];
    }
  }
  return outcome;
}

// ── 1) infer — run the rules, combine CFs, return an answer + confidence. PURE, NO model. ──────
//
// Runs every supplied rule set through the rules-engine over `facts`, collects each fired rule's
// outcome and its certainty factor, and COMBINES the CFs with the MYCIN algebra (combineCF via
// aggregate). The highest-CF fired outcome is the proposed answer; `cf` is the combined certainty
// across ALL fired rules that share that answer (corroborating evidence raises confidence), and
// `confidence` is that mapped to 0..100 via toConfidence. No rules fired → confidence 0.
//
// Returns: { answer, confidence, cf, firedRules, trace, source:'rules', outcomes }
export function infer({ query, facts = {}, ruleSets = [] } = {}) {
  const sets = normalizeRuleSets(ruleSets);
  const firedRules = [];
  const trace = [];
  const outcomes = [];

  // Per distinct answer (by stable key), accumulate the CFs of every fired rule proposing it, so
  // multiple corroborating rules combine into higher confidence for that answer.
  const byAnswer = new Map(); // key -> { answer, cfs: number[], rules: string[] }

  for (const rules of sets) {
    let engine;
    try {
      engine = new Engine(rules);
    } catch {
      continue; // a malformed rule set is skipped, never fatal (soft-fail).
    }
    let res;
    try {
      res = engine.run(facts);
    } catch {
      continue;
    }
    for (const t of res.trace) trace.push(t);
    res.firedRules.forEach((name, i) => {
      const outcome = res.outcomes[i];
      const cf = outcomeCF(outcome);
      const ans = outcomeAnswer(outcome);
      const key = answerKey(ans);
      firedRules.push(name);
      outcomes.push(outcome);
      const slot = byAnswer.get(key) || { answer: ans, cfs: [], rules: [] };
      slot.cfs.push(cf);
      slot.rules.push(name);
      byAnswer.set(key, slot);
    });
  }

  // Pick the answer with the strongest combined certainty.
  let best = null;
  for (const slot of byAnswer.values()) {
    const cf = aggregate(slot.cfs);
    if (best === null || cf > best.cf) best = { answer: slot.answer, cf, rules: slot.rules };
  }

  if (!best) {
    return {
      answer: null,
      confidence: 0,
      cf: 0,
      firedRules,
      trace,
      outcomes,
      source: 'rules',
      query: query ?? null,
    };
  }

  return {
    answer: best.answer,
    confidence: toConfidence(best.cf),
    cf: best.cf,
    firedRules,
    trace,
    outcomes,
    source: 'rules',
    query: query ?? null,
  };
}

// ── 2) answerOrEscalate — the latency-saving core ─────────────────────────────────────────────
//
// Try infer() first. If confidence >= confidentThreshold, RETURN the rules answer immediately —
// no model call, ~0 latency, free. Otherwise escalate via paradigm-router's dispatch(job,handlers)
// (tiny → small → cloud), tagging the result with the rules attempt and WHY we escalated.
//
// SOFT-FAIL: never throws. If handlers are missing/unusable, returns the best rules guess flagged
// low-confidence rather than blowing up — the caller decides what to do with a weak answer.
//
//   job      — paradigm-router job shape, PLUS { query, facts, ruleSets } for the rules attempt.
//   handlers — { rules?, tiny?, small?, cloud? } injected tier executors (stubs in tests).
//   opts     — { confidentThreshold = 80, memo, cacheKey? }
export async function answerOrEscalate(job = {}, handlers = {}, opts = {}) {
  const { confidentThreshold = 80, memo } = opts;
  const { query, facts = {}, ruleSets = [] } = job;

  // 4) Optional memo: identical repeated queries skip even the (already cheap) rule run.
  const key = memo instanceof Map ? cacheKey(query, facts) : null;
  if (key && memo.has(key)) {
    return { ...memo.get(key), cached: true };
  }

  // Rules-first.
  let attempt;
  try {
    attempt = infer({ query, facts, ruleSets });
  } catch {
    attempt = { answer: null, confidence: 0, cf: 0, firedRules: [], trace: [], outcomes: [], source: 'rules', query: query ?? null };
  }

  // Confident enough → answer from rules. No model. This is the latency win.
  if (attempt.confidence >= confidentThreshold && attempt.answer !== null) {
    const out = { ...attempt, escalated: false };
    if (key) memo.set(key, out);
    return out;
  }

  // Not confident → escalate to the model ladder. If no usable handler, soft-fail to the guess.
  const hasHandler = handlers && typeof handlers === 'object' &&
    ['rules', 'tiny', 'small', 'cloud'].some((t) => typeof handlers[t] === 'function');
  if (!hasHandler) {
    const out = {
      ...attempt,
      escalated: false,
      lowConfidence: true,
      reason: 'no handlers available — returning best rules guess',
    };
    if (key) memo.set(key, out);
    return out;
  }

  let modelResult;
  let escalationError = null;
  try {
    modelResult = await dispatch(job, handlers);
  } catch (err) {
    escalationError = err && err.message ? err.message : String(err);
  }

  if (escalationError !== null) {
    // The escalation path failed; fall back to the rules guess, flagged.
    const out = {
      ...attempt,
      escalated: false,
      lowConfidence: true,
      reason: `escalation failed (${escalationError}) — returning best rules guess`,
    };
    if (key) memo.set(key, out);
    return out;
  }

  const out = {
    answer: outcomeAnswer(modelResult),
    raw: modelResult,
    confidence: null, // model tier doesn't carry a CF; confidence is rules-only
    source: 'model',
    escalated: true,
    rulesAttempt: {
      answer: attempt.answer,
      confidence: attempt.confidence,
      cf: attempt.cf,
      firedRules: attempt.firedRules,
    },
    reason: `rules confidence ${attempt.confidence} < threshold ${confidentThreshold} — escalated`,
    query: query ?? null,
  };
  if (key) memo.set(key, out);
  return out;
}

// ── 3) LEARNING layer — case accrual + rule promotion ─────────────────────────────────────────
//
// A "case" is one answered job: { query, facts, answer, confidence, source, accepted }. We accrue
// cases into an injected store. When the SAME intent (normalized query key) has been answered the
// same way, with high confidence and acceptance, enough times, promoteCases() turns it into a
// rules-engine-shaped rule. Fold that rule back into ruleSets and the next identical intent is
// answered by rules — the model is never called again for it. That is the learning loop.

// Normalize a free-text query into a stable INTENT key: lowercase, strip punctuation, collapse
// whitespace, drop a few filler/stop words so "what is the price?" and "whats price" collide.
const STOP_WORDS = new Set(['the', 'a', 'an', 'is', 'are', 'of', 'to', 'do', 'does', 'please', 'me', 'my', 'i']);
export function intentKey(query) {
  const s = typeof query === 'string' ? query : '';
  const words = s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w));
  return words.join(' ');
}

// cacheKey — stable memo key for a (query, facts) pair. Facts are serialized with sorted keys so
// equal-but-reordered fact objects produce the same key. Used by answerOrEscalate's optional memo.
export function cacheKey(query, facts = {}) {
  return intentKey(query) + '|' + stableStringify(facts);
}

// A "store" is either a plain array (in-memory; the default) or an object with a .records array
// plus an optional injected { read, write } pair for file-backed persistence. We never touch the
// filesystem ourselves — persistence is injected so the module stays pure/offline-testable.
export function createCaseStore({ records = [] } = {}) {
  return { records: Array.isArray(records) ? records.slice() : [] };
}

function storeRecords(store) {
  if (Array.isArray(store)) return store;
  if (store && Array.isArray(store.records)) return store.records;
  return null;
}

// recordCase — append one answered case to the store. Soft-fails (returns the store untouched) if
// the store isn't a recognizable shape. Stamps a normalized intent key for cheap grouping later.
export function recordCase(store, kase = {}) {
  const records = storeRecords(store);
  if (!records) return store;
  const { query = '', facts = {}, answer = null, confidence = 0, source = 'rules', accepted = true } = kase;
  records.push({
    intent: intentKey(query),
    query,
    facts,
    answer,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    source,
    accepted: accepted !== false,
    at: kase.at ?? null, // injected timestamp if any; null keeps it deterministic
  });
  return store;
}

// promoteCases — derive candidate rules from repeated, high-confidence, accepted cases.
//
// Groups accepted cases by (intent, answer). Any group seen >= minHits times, all at confidence
// >= minConfidence, becomes a rules-engine-shaped rule: it fires when fact `_intent` matches the
// learned intent key, and emits the learned answer with a CF derived from the observed confidence.
// (Callers tag facts with `_intent: intentKey(query)` — or use the helper inferWithLearning below —
// so the promoted rule has something to match on.) DETERMINISTIC: same store → same rules.
//
// Returns an array of rule objects ready to fold into ruleSets.
export function promoteCases(store, { minHits = 3, minConfidence = 80 } = {}) {
  const records = storeRecords(store);
  if (!records || records.length === 0) return [];

  // group key -> { intent, answer, hits, confidences[] }
  const groups = new Map();
  for (const r of records) {
    if (!r || r.accepted === false) continue;
    if (!Number.isFinite(r.confidence) || r.confidence < minConfidence) continue;
    if (!r.intent) continue;
    const gkey = r.intent + ' ' + answerKey(r.answer);
    const g = groups.get(gkey) || { intent: r.intent, answer: r.answer, hits: 0, confidences: [] };
    g.hits += 1;
    g.confidences.push(r.confidence);
    groups.set(gkey, g);
  }

  const rules = [];
  // Sort group keys for deterministic output ordering.
  for (const gkey of [...groups.keys()].sort()) {
    const g = groups.get(gkey);
    if (g.hits < minHits) continue;
    // CF from the mean observed confidence (0..100 → -1..1), so a learned rule's certainty
    // reflects how confidently the case was answered.
    const meanConf = g.confidences.reduce((a, b) => a + b, 0) / g.confidences.length;
    const cf = clampCF((meanConf / 100) * 2 - 1);
    rules.push({
      name: `learned:${g.intent}`,
      priority: 5, // sits above generic defaults, below hard safety rules
      when: [{ fact: '_intent', op: 'eq', value: g.intent }],
      then: { answer: g.answer, cf, learned: true, hits: g.hits },
    });
  }
  return rules;
}

// inferWithLearning — convenience: stamps facts with `_intent` (so promoted rules can match) and
// runs infer over (ruleSets + any learnedRules). Keeps the learning loop ergonomic for callers.
export function inferWithLearning({ query, facts = {}, ruleSets = [], learnedRules = [] } = {}) {
  const stamped = { ...facts, _intent: intentKey(query) };
  const sets = [...normalizeRuleSets(ruleSets), learnedRules].filter((s) => Array.isArray(s) && s.length);
  return infer({ query, facts: stamped, ruleSets: sets });
}

// ── internal helpers ──────────────────────────────────────────────────────────────────────────

// Accept either a single rule set (array of rules) or an array of rule sets. Returns array-of-sets.
function normalizeRuleSets(ruleSets) {
  if (!Array.isArray(ruleSets)) return [];
  if (ruleSets.length === 0) return [];
  // Array of rules (each has a `name`) vs array of rule-sets (each element is an array).
  const looksLikeRules = ruleSets.every((r) => r && typeof r === 'object' && !Array.isArray(r) && 'name' in r);
  return looksLikeRules ? [ruleSets] : ruleSets.filter((s) => Array.isArray(s));
}

// Stable, deterministic key for an answer value (strings, numbers, objects all collapse sanely).
function answerKey(answer) {
  if (answer === null || answer === undefined) return ' null';
  if (typeof answer === 'string') return 's:' + answer;
  if (typeof answer === 'number' || typeof answer === 'boolean') return 'p:' + String(answer);
  return 'o:' + stableStringify(answer);
}

// Deterministic JSON with sorted keys (so equal objects with reordered keys serialize identically).
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

// ── CLI: a worked example (offline; stub handlers, no real model) ───────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('mycin-router.mjs')) {
  const ruleSets = [
    {
      name: 'price:btc',
      when: [{ fact: 'topic', op: 'eq', value: 'btc-price' }],
      then: { answer: 'BTC price lookup', cf: 0.95 },
    },
  ];

  const confident = infer({ query: 'btc price?', facts: { topic: 'btc-price' }, ruleSets });
  console.log('infer (high-CF rule):', JSON.stringify({ answer: confident.answer, confidence: confident.confidence }));

  const handlers = {
    tiny: async (j) => `[tiny-stub] would classify: ${j.query}`,
    small: async (j) => `[small-stub] would answer: ${j.query}`,
  };

  const escalated = await answerOrEscalate(
    { kind: 'answer', needsLanguage: true, query: 'tell me a story about angels', facts: {}, ruleSets },
    handlers,
  );
  console.log('answerOrEscalate (low-CF → escalate):', JSON.stringify({ source: escalated.source, escalated: escalated.escalated, answer: escalated.answer }));

  // Learning loop: record the same accepted high-confidence case 3x → promote → answered by rules.
  const store = createCaseStore();
  for (let i = 0; i < 3; i++) {
    recordCase(store, { query: 'what is karma', answer: 'Karma is the off-chain reputation ledger.', confidence: 92, source: 'model', accepted: true });
  }
  const learned = promoteCases(store, { minHits: 3, minConfidence: 80 });
  console.log('promoteCases →', learned.length, 'rule(s):', JSON.stringify(learned.map((r) => r.name)));
  const nowRules = inferWithLearning({ query: 'what is karma?', facts: {}, learnedRules: learned });
  console.log('inferWithLearning (now via rules):', JSON.stringify({ answer: nowRules.answer, confidence: nowRules.confidence, source: nowRules.source }));
}
