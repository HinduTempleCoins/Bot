// rules-engine.mjs — a lightweight, self-contained Business Rules Engine for bounded,
// auditable decisions (queue #91). PURE, no deps, no network. Think json-rules-engine, but
// small enough to need no install: a rule is plain data, and every run yields a TRACE that
// explains exactly which rules fired and why.
//
// Why this exists: the AI-Witness must make some decisions deterministically and be able to
// SHOW ITS WORK — eligibility for a grant, whether a post trips a moderation rule, whether a
// governance threshold is met, whether a trade is allowed. An LLM can phrase the outcome, but
// the decision itself lives here, in inspectable rules, so it is reproducible and auditable.
//
//   import { Engine, eligibilityRules, moderationRules } from './rules-engine.mjs'
//   const e = new Engine(eligibilityRules);
//   const { firedRules, outcomes, trace } = e.run({ accountAgeDays: 40, reputation: 30 });
//   node integrations/rules-engine.mjs        # print a worked example
//
// A rule:
//   {
//     name:     'string id',
//     when:     [ condition, ... ],   // ALL must hold (logical AND); [] always matches
//     then:     <any outcome value>,  // pushed to outcomes when the rule fires
//     priority: <number>,             // higher fires first; default 0
//   }
// A condition:
//   { fact: 'accountAgeDays', op: 'gte', value: 30 }
//   fact may be dotted ('user.reputation') to reach into nested facts.

// ── operators ─────────────────────────────────────────────────────────────────
//
// Each operator is (factValue, ruleValue) -> boolean. They are total: an operator that does not
// apply to the given types returns false rather than throwing, so a malformed fact never crashes
// a run (it just fails to match). Comparisons (gt/gte/lt/lte) coerce to Number and bail to false
// on NaN. `in` checks membership in a rule-supplied array; `contains` checks the reverse — that a
// fact (array OR string) contains the rule value.
export const operators = {
  eq:  (a, b) => a === b,
  neq: (a, b) => a !== b,
  gt:  (a, b) => numCmp(a, b, (x, y) => x > y),
  gte: (a, b) => numCmp(a, b, (x, y) => x >= y),
  lt:  (a, b) => numCmp(a, b, (x, y) => x < y),
  lte: (a, b) => numCmp(a, b, (x, y) => x <= y),
  in:  (a, b) => Array.isArray(b) && b.includes(a),
  contains: (a, b) => {
    if (Array.isArray(a)) return a.includes(b);
    if (typeof a === 'string') return a.includes(String(b));
    return false;
  },
};

function numCmp(a, b, cmp) {
  const x = Number(a);
  const y = Number(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  return cmp(x, y);
}

// Resolve a (possibly dotted) fact path against the facts object. Returns undefined if any
// segment is missing or the chain hits a non-object.
export function resolveFact(facts, path) {
  if (facts == null) return undefined;
  if (!String(path).includes('.')) return facts[path];
  return String(path).split('.').reduce(
    (acc, key) => (acc == null ? undefined : acc[key]),
    facts,
  );
}

// Evaluate a single condition against facts. Returns a trace entry describing the check so the
// caller can show WHY a rule did or didn't fire.
export function evaluateCondition(condition, facts) {
  const { fact, op, value } = condition || {};
  const operator = operators[op];
  const actual = resolveFact(facts, fact);
  let passed = false;
  let error = null;
  if (!operator) {
    error = `unknown operator: ${op}`;
  } else {
    passed = operator(actual, value);
  }
  return { fact, op, value, actual, passed, error };
}

// ── Engine ──────────────────────────────────────────────────────────────────────
export class Engine {
  constructor(rules = []) {
    this.rules = [];
    for (const r of rules) this.addRule(r);
  }

  // Add a rule. Returns the Engine for chaining. Throws on a missing name so audit trails are
  // never anonymous. `when` defaults to [] (always matches), `priority` to 0.
  addRule(rule) {
    if (!rule || typeof rule.name !== 'string' || rule.name === '') {
      throw new Error('rule must have a non-empty string name');
    }
    this.rules.push({
      name: rule.name,
      when: Array.isArray(rule.when) ? rule.when : [],
      then: rule.then,
      priority: Number.isFinite(rule.priority) ? rule.priority : 0,
    });
    return this;
  }

  // Rules sorted highest-priority-first. Ties keep insertion order (stable sort).
  sortedRules() {
    return this.rules
      .map((r, i) => ({ r, i }))
      .sort((a, b) => b.r.priority - a.r.priority || a.i - b.i)
      .map(({ r }) => r);
  }

  // run(facts) → { firedRules, outcomes, trace }
  //   firedRules — names of rules whose every condition passed, in priority order
  //   outcomes   — the `then` value of each fired rule, in the same order
  //   trace      — one entry per rule (fired or not), each listing its condition checks; THIS is
  //                the audit hook: a full, deterministic record of the decision.
  run(facts = {}) {
    const firedRules = [];
    const outcomes = [];
    const trace = [];

    for (const rule of this.sortedRules()) {
      const conditions = rule.when.map((c) => evaluateCondition(c, facts));
      const fired = conditions.every((c) => c.passed);
      trace.push({
        rule: rule.name,
        priority: rule.priority,
        fired,
        conditions,
      });
      if (fired) {
        firedRules.push(rule.name);
        outcomes.push(rule.then);
      }
    }

    return { firedRules, outcomes, trace };
  }
}

// ── prebuilt example rule sets ────────────────────────────────────────────────────
//
// eligibilityRules — example: does an account qualify for an autonomous starter grant? The
// engine returns all fired outcomes; a caller decides policy (e.g. "denied wins over granted").
// Higher priority = evaluated first in the trace, which reads top-down like a decision log.
export const eligibilityRules = [
  {
    name: 'denied:flagged',
    priority: 100,
    when: [{ fact: 'flagged', op: 'eq', value: true }],
    then: { decision: 'denied', reason: 'account is flagged' },
  },
  {
    name: 'denied:too-new',
    priority: 90,
    when: [{ fact: 'accountAgeDays', op: 'lt', value: 7 }],
    then: { decision: 'denied', reason: 'account younger than 7 days' },
  },
  {
    name: 'granted:established',
    priority: 10,
    when: [
      { fact: 'accountAgeDays', op: 'gte', value: 30 },
      { fact: 'reputation', op: 'gte', value: 25 },
      { fact: 'flagged', op: 'neq', value: true },
    ],
    then: { decision: 'granted', reason: 'established account in good standing' },
  },
];

// moderationRules — example: classify a comment/post. `contains` matches a banned term inside the
// text; `in` matches a known-bad category. Outcomes are advisory signals for review, not edits.
export const moderationRules = [
  {
    name: 'block:banned-term',
    priority: 100,
    when: [{ fact: 'text', op: 'contains', value: 'scam-token-xyz' }],
    then: { action: 'block', reason: 'contains banned term' },
  },
  {
    name: 'review:risky-category',
    priority: 50,
    when: [{ fact: 'category', op: 'in', value: ['spam', 'phishing', 'impersonation'] }],
    then: { action: 'review', reason: 'flagged category' },
  },
  {
    name: 'allow:short-and-clean',
    priority: 1,
    when: [{ fact: 'length', op: 'lte', value: 280 }],
    then: { action: 'allow', reason: 'within length limit' },
  },
];

// ── CLI: a worked example ───────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('rules-engine.mjs')) {
  const e = new Engine(eligibilityRules);

  const established = e.run({ accountAgeDays: 40, reputation: 30, flagged: false });
  console.log('established account:', JSON.stringify(established.firedRules), '→', JSON.stringify(established.outcomes));

  const tooNew = e.run({ accountAgeDays: 3, reputation: 50, flagged: false });
  console.log('brand-new account:  ', JSON.stringify(tooNew.firedRules), '→', JSON.stringify(tooNew.outcomes));

  const flagged = e.run({ accountAgeDays: 365, reputation: 99, flagged: true });
  console.log('flagged account:    ', JSON.stringify(flagged.firedRules), '→', JSON.stringify(flagged.outcomes));

  console.log('\naudit trace for the flagged account:');
  for (const t of flagged.trace) {
    console.log(`  ${t.fired ? '✓' : '·'} [p${t.priority}] ${t.rule}`);
    for (const c of t.conditions) {
      console.log(`      ${c.passed ? 'pass' : 'fail'}: ${c.fact} ${c.op} ${JSON.stringify(c.value)} (actual=${JSON.stringify(c.actual)})`);
    }
  }
}
