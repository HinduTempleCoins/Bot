// smols-brain.mjs — "Smols Brain": the learning upgrade for the MYCIN rules-first front
// (mycin-router.mjs). It turns the rule-brain from a fallback-that-memorizes-exact-answers into
// one that GENUINELY LEARNS — it tunes its own confidence from experience, FORMS GENERALIZATIONS
// over the features of past cases (so it answers unseen-but-similar inputs), and RETRACTS stale
// beliefs when new facts contradict them.
//
// The distinction this module is built around — "remembers what it was told" vs. "forms its own
// generalizations":
//   • A cache (mycin-router's promoteCases) keys on the exact normalized INTENT and replays the
//     stored answer. It never fires on an input it has not literally seen before.
//   • Smols Brain learns CONDITIONED rules over the FACTS (features) of cases — "when topic=price
//     AND chain=melek → answer X" — so a brand-new query it has never seen, but which shares those
//     features, fires the rule. That is generalization, not recall.
//
// Three real-learning mechanisms (each pure / deterministic / soft-fail):
//   1. reinforce()    — certainty-factor reinforcement: nudge a rule's CF up on accepted
//                       conclusions, down/flip on rejected ones, bounded in [-1,1], asymptotic.
//   2. induceRules()  — ID3/RIPPER-style feature induction: pick highest-information-gain feature
//                       splits over labeled cases and emit rules-engine-shaped CONDITIONED rules.
//   3. truth-maintenance (TMS) — track which learned rules are "in" vs "out"; when an observed
//                       fact contradicts a rule, demote (lower CF) or retract it, and cascade the
//                       retraction to rules that depended on the withdrawn justification.
//
// It COMPOSES the existing house parts, never reimplements them:
//   • certainty.mjs   — clampCF / combineCF / toConfidence (the CF algebra and bounds)
//   • rules-engine.mjs — rule SHAPE ({name,when,then,priority}) + operators (for self-test firing)
//   • mycin-router.mjs — infer() is still the inference core; we just feed it better rule sets
//
//   import { createBrain, reinforce, induceRules, learnStep } from './smols-brain.mjs';
//   const brain = createBrain();
//   learnStep(brain, { query, facts, answer, accepted:true });   // accrue + (periodically) learn
//   const r = brain.infer({ query, facts });                     // answers from SELF-FORMED rules
//
// DESIGN RULES (shared, load-bearing): ESM .mjs; PURE where possible; deps INJECTED so tests run
// fully OFFLINE (no network, no real model — handlers are stubs); SOFT-FAIL / NEVER-THROW at the
// edge; deterministic (NO Math.random — ties break by feature name); no secrets; CLI guarded.

import { clampCF, combineCF, toConfidence } from './certainty.mjs';
import { infer, answerOrEscalate } from './mycin-router.mjs';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1) CERTAINTY-FACTOR REINFORCEMENT
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// reinforce(rule, outcome, opts) — given feedback that a rule's conclusion was ACCEPTED or
// REJECTED, return a NEW rule with its CF nudged. The brain tunes its OWN confidence from
// experience rather than trusting whatever prior the rule was born with.
//
// The update is a bounded, asymptotic move (the classic "learning toward a target" rule):
//   accept →  cf' = cf + rate · (+1 − cf)      // approaches +1, never exceeds it
//   reject →  cf' = cf + rate · (−1 − cf)      // approaches −1, can cross 0 (belief flips to
//                                              //   disbelief under sustained contradiction)
// `rate` ∈ (0,1] is the learning rate (how fast experience overrides the prior). Repeated accepts
// asymptote toward +1; repeated rejects decay through 0 and asymptote toward −1. CF is always
// clamped to [-1,1] via certainty.clampCF, so it can never run away. PURE: returns a new object,
// never mutates the input (the caller folds the result back into its rule set).
//
// `outcome` may be a boolean (true=accept), the string 'accept'/'reject', or {accepted:boolean}.
export const DEFAULT_LEARN_RATE = 0.3;

export function isAccepted(outcome) {
  if (outcome === true || outcome === 'accept' || outcome === 'accepted') return true;
  if (outcome === false || outcome === 'reject' || outcome === 'rejected') return false;
  if (outcome && typeof outcome === 'object') {
    if (typeof outcome.accepted === 'boolean') return outcome.accepted;
    if (typeof outcome.accept === 'boolean') return outcome.accept;
  }
  return true; // default: treat ambiguous feedback as mild confirmation
}

// Pull a CF out of a rule's `then` (mirrors mycin-router's outcome shapes) for reinforcement.
function ruleCF(rule) {
  const then = rule && rule.then;
  if (typeof then === 'number') return clampCF(then);
  if (then && typeof then === 'object' && Number.isFinite(then.cf)) return clampCF(then.cf);
  if (then && typeof then === 'object' && Number.isFinite(then.certainty)) return clampCF(then.certainty);
  return 0;
}

function withCF(rule, cf) {
  const then = rule.then;
  let nextThen;
  if (typeof then === 'number') nextThen = clampCF(cf);
  else if (then && typeof then === 'object') nextThen = { ...then, cf: clampCF(cf) };
  else nextThen = { answer: then, cf: clampCF(cf) };
  return { ...rule, then: nextThen };
}

export function reinforce(rule, outcome, { rate = DEFAULT_LEARN_RATE } = {}) {
  if (!rule || typeof rule !== 'object') return rule; // soft-fail
  const r = Math.max(0, Math.min(1, Number.isFinite(rate) ? rate : DEFAULT_LEARN_RATE));
  const cf = ruleCF(rule);
  const target = isAccepted(outcome) ? 1 : -1;
  const next = clampCF(cf + r * (target - cf));
  const out = withCF(rule, next);
  // Track a small reinforcement count so callers / the TMS can reason about evidence weight.
  const reinforced = (Number.isFinite(rule.reinforced) ? rule.reinforced : 0) + 1;
  return { ...out, reinforced };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2) FEATURE-BASED RULE INDUCTION  (ID3 / RIPPER-flavored, deterministic)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// induceRules(cases, opts) — learn CONDITIONED rules over the FEATURES of labeled cases so the
// brain generalizes. Each case is { facts:{feature:value,...}, answer } (the answer is the label).
// We greedily build, per answer-label, the most-discriminating conjunction of feature tests by
// information gain, exactly like an ID3 split — then keep rules that meet support/confidence floors.
//
// Output rules are rules-engine-shaped and fire on FEATURES, not on a memorized intent:
//   { name, priority, when:[{fact,op:'eq',value},...], then:{ answer, cf, learned:true,
//     support, confidence } }
//
// Generalization (the whole point): a rule like when:[{fact:'topic',value:'price'}] fires on ANY
// future case with topic=price, including queries never seen before. That is forming a rule, not
// caching an answer.
//
// DETERMINISM: no Math.random. When two features tie on information gain we break the tie by
// feature NAME (lexicographic), then by value, so the same cases always induce the same rules.
//
// opts: { minSupport=2, minConfidence=0.6, maxConditions=3 }
//   minSupport    — a rule must be backed by at least this many cases (absolute count).
//   minConfidence — of the cases matching the rule's conditions, this fraction must carry its label.
//   maxConditions — cap the conjunction depth (RIPPER-style greedy rule length limit).
export function induceRules(cases, { minSupport = 2, minConfidence = 0.6, maxConditions = 3 } = {}) {
  const data = (Array.isArray(cases) ? cases : [])
    .map(normalizeCase)
    .filter((c) => c && c.label !== undefined && c.label !== null);
  if (data.length === 0) return [];

  // Rank candidate FEATURES by ID3 information gain (entropy reduction over the label partition):
  // the feature that, when split on, best predicts the label is the one to generalize on. This is
  // the same criterion ID3 uses to pick a decision-tree split. We then emit, per (feature=value),
  // a rule predicting the MAJORITY label of cases with that value — provided it is pure/supported
  // enough. So "topic=price" generalizes to ALL price cases (any chain), instead of memorizing
  // one rule per exact (topic,chain) input.
  const features = rankFeaturesByGain(data); // [{fact, gain}] best-first
  if (features.length === 0) return [];

  const rules = [];
  const seen = new Set();
  // Walk features best-first; for the top features, emit value→majority-label rules. A second
  // condition (next-best feature) is only added when the single-feature rule is impure but a
  // refining split lifts it over the confidence floor (RIPPER-style greedy specialization).
  for (const { fact } of features) {
    const valueGroups = groupBy(data, (c) => (hasFact(c.facts, fact) ? String(c.facts[fact]) : null));
    for (const [vKey, group] of [...valueGroups.entries()].sort()) {
      if (vKey === 'null') continue; // cases missing this feature
      const value = group[0].facts[fact];
      const { label, count } = majorityLabel(group);
      const support = count; // cases supporting the majority label
      const confidence = group.length === 0 ? 0 : count / group.length;

      let conditions = [{ fact, value }];
      let effSupport = support;
      let effConfidence = confidence;
      let matched = group;

      // Specialize: if impure, try adding the next-most-informative DIFFERENT feature to lift purity.
      if (confidence < minConfidence && maxConditions > 1) {
        const refined = refineByGain(group, label, fact, features, maxConditions - 1);
        if (refined) {
          conditions = [{ fact, value }, ...refined.conditions];
          matched = refined.matched;
          effSupport = refined.support;
          effConfidence = refined.confidence;
        }
      }

      if (effSupport < minSupport || effConfidence < minConfidence) continue;

      const name = 'induced:' + labelKey(label) + ':' + conditions.map((c) => `${c.fact}=${c.value}`).join('&');
      if (seen.has(name)) continue;
      seen.add(name);
      // CF derived from observed confidence (purity): [0,1] → [-1,1] (0.5 purity → 0 CF).
      const cf = clampCF(effConfidence * 2 - 1);
      rules.push({
        name,
        priority: 6, // above mycin-router's intent-memorized learned:* rules (priority 5)
        when: conditions.map((c) => ({ fact: c.fact, op: 'eq', value: c.value })),
        then: { answer: label, cf, learned: true, induced: true, support: effSupport, confidence: effConfidence },
      });
    }
  }
  // Deterministic, stable ordering by rule name.
  rules.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rules;
}

// rankFeaturesByGain — ID3 information gain of each feature over the full label distribution.
// Returns features sorted by gain desc, ties broken by feature name (determinism, no Math.random).
function rankFeaturesByGain(data) {
  const base = labelEntropy(data);
  const facts = new Set();
  for (const c of data) for (const k of Object.keys(c.facts || {})) if (!k.startsWith('_')) facts.add(k);

  const scored = [];
  for (const fact of facts) {
    const groups = groupBy(data, (c) => (hasFact(c.facts, fact) ? String(c.facts[fact]) : ' missing'));
    let cond = 0;
    for (const group of groups.values()) cond += (group.length / data.length) * labelEntropy(group);
    scored.push({ fact, gain: base - cond });
  }
  scored.sort((a, b) => (b.gain - a.gain) || (a.fact < b.fact ? -1 : a.fact > b.fact ? 1 : 0));
  return scored;
}

// refineByGain — add up to `budget` further feature=value conditions (best gain first, never
// re-testing `excludeFact`) to purify the subset toward `label`. Returns the refined conjunction
// once it is pure for the label, or null if none helps.
function refineByGain(subset, label, excludeFact, features, budget) {
  let conditions = [];
  let cur = subset;
  for (const { fact } of features) {
    if (budget <= 0) break;
    if (fact === excludeFact || conditions.some((c) => c.fact === fact)) continue;
    // Pick the value of this feature that most purely yields `label`.
    const valueGroups = groupBy(cur, (c) => (hasFact(c.facts, fact) ? String(c.facts[fact]) : null));
    let bestVal = null;
    for (const [vKey, group] of [...valueGroups.entries()].sort()) {
      if (vKey === 'null') continue;
      const correct = group.filter((c) => labelKey(c.label) === labelKey(label)).length;
      const conf = group.length ? correct / group.length : 0;
      if (bestVal === null || conf > bestVal.conf + 1e-12) bestVal = { value: group[0].facts[fact], group, conf, correct };
    }
    if (!bestVal) continue;
    conditions.push({ fact, value: bestVal.value });
    cur = bestVal.group;
    budget--;
    const correct = cur.filter((c) => labelKey(c.label) === labelKey(label)).length;
    const conf = cur.length ? correct / cur.length : 0;
    if (conf >= 1 - 1e-9) {
      return { conditions, matched: cur, support: correct, confidence: conf };
    }
  }
  if (conditions.length === 0) return null;
  const correct = cur.filter((c) => labelKey(c.label) === labelKey(label)).length;
  const conf = cur.length ? correct / cur.length : 0;
  return { conditions, matched: cur, support: correct, confidence: conf };
}

// majorityLabel — the most common label in a group; ties broken by labelKey for determinism.
function majorityLabel(group) {
  const counts = new Map();
  const byKey = new Map();
  for (const c of group) {
    const k = labelKey(c.label);
    counts.set(k, (counts.get(k) || 0) + 1);
    byKey.set(k, c.label);
  }
  let best = null;
  for (const k of [...counts.keys()].sort()) {
    const n = counts.get(k);
    if (best === null || n > best.count) best = { key: k, label: byKey.get(k), count: n };
  }
  return best || { label: null, count: 0 };
}

// labelEntropy — Shannon entropy of the label distribution within a subset (multi-class).
function labelEntropy(subset) {
  const n = subset.length;
  if (n === 0) return 0;
  const counts = new Map();
  for (const c of subset) {
    const k = labelKey(c.label);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let h = 0;
  for (const cnt of counts.values()) {
    const p = cnt / n;
    h -= p * Math.log2(p);
  }
  return h;
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const raw = keyFn(x);
    const k = raw === null ? 'null' : raw;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

function hasFact(facts, fact) {
  return facts && Object.prototype.hasOwnProperty.call(facts, fact);
}

// All (feature,value) pairs present in the subset, sorted deterministically (feature, then value).
function collectFeatureValues(subset) {
  const seen = new Set();
  const out = [];
  for (const c of subset) {
    for (const [fact, value] of Object.entries(c.facts || {})) {
      if (fact.startsWith('_')) continue; // skip control facts like _intent
      const k = fact + ' ' + String(value);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ fact, value });
    }
  }
  out.sort((a, b) => (a.fact < b.fact ? -1 : a.fact > b.fact ? 1 : String(a.value) < String(b.value) ? -1 : String(a.value) > String(b.value) ? 1 : 0));
  return out;
}

function factEq(facts, fact, value) {
  return facts && Object.prototype.hasOwnProperty.call(facts, fact) && facts[fact] === value;
}

function normalizeCase(c) {
  if (!c || typeof c !== 'object') return null;
  const facts = c.facts && typeof c.facts === 'object' ? c.facts : {};
  const label = 'label' in c ? c.label : 'answer' in c ? c.answer : undefined;
  const accepted = c.accepted !== false;
  return { facts, label, accepted, query: c.query };
}

function labelKey(label) {
  if (label === null || label === undefined) return ' null';
  if (typeof label === 'string') return 's:' + label;
  if (typeof label === 'number' || typeof label === 'boolean') return 'p:' + String(label);
  try {
    return 'o:' + JSON.stringify(label);
  } catch {
    return 'o:?';
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3) TRUTH MAINTENANCE SYSTEM (TMS)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// A justification-based TMS: each learned rule is a belief held BECAUSE of a justification — the
// observed facts/label that induced it. When a NEW observed fact CONTRADICTS a rule (the same
// conditions now lead to a DIFFERENT label), that justification is withdrawn: we demote the rule's
// CF (and if it collapses below a floor, mark it "out" — retracted). Then we cascade: any rule that
// depended on the withdrawn rule's conclusion as a premise is itself withdrawn (dependents follow).
//
// "in" = currently believed (fires). "out" = retracted (does not fire). This is what keeps stale
// beliefs from persisting once the world has shown them to be wrong.
//
// applyTruthMaintenance(rules, observation, opts) → { rules, retracted, demoted }
//   rules       — array of (learned) rules, each may carry { status:'in'|'out', then.cf }
//   observation — { facts, answer } : a freshly observed ground truth
//   opts        — { demote=0.4 (contradiction learning rate toward -1), floor=0.0 (CF<=floor → out),
//                   rate (for confirming reinforcement) }
//
// A rule is CONTRADICTED by an observation when the observation matches ALL the rule's conditions
// but its actual answer differs from the rule's conclusion. A rule is CONFIRMED when the conditions
// match AND the answer agrees — confirmation reinforces (CF up) and can bring an "out" rule back
// "in". Contradiction drives the CF DOWN toward -1 (bounded, asymptotic — the same reinforcement
// move as a reject), so sustained contradiction reliably crosses the retract floor; a single
// contradiction merely demotes.
export function applyTruthMaintenance(rules, observation, { demote = 0.4, floor = 0.0, rate = DEFAULT_LEARN_RATE } = {}) {
  const list = Array.isArray(rules) ? rules.map((r) => ({ ...r })) : [];
  const obs = normalizeObservation(observation);
  const retracted = [];
  const demoted = [];

  if (!obs) return { rules: list, retracted, demoted };

  for (let i = 0; i < list.length; i++) {
    const rule = list[i];
    if (!conditionsMatch(rule, obs.facts)) continue;
    const concl = ruleAnswer(rule);
    if (sameAnswer(concl, obs.answer)) {
      // Confirmation: reinforce up; if it was retracted, it may come back "in".
      const r = reinforce(rule, true, { rate });
      r.status = ruleCF(r) > floor ? 'in' : 'out';
      list[i] = r;
    } else {
      // Contradiction: withdraw the justification — drive CF toward -1 (bounded reject move).
      const cf = ruleCF(rule);
      const dr = Math.max(0, Math.min(1, Number.isFinite(demote) ? demote : 0.4));
      const next = clampCF(cf + dr * (-1 - cf));
      const r = withCF(rule, next);
      r.reinforced = (Number.isFinite(rule.reinforced) ? rule.reinforced : 0) + 1;
      if (next <= floor) {
        r.status = 'out';
        retracted.push(r.name);
      } else {
        r.status = 'in';
        demoted.push(r.name);
      }
      list[i] = r;
    }
  }

  // Cascade: any rule justified BY a now-"out" rule (declares dependsOn: [ruleName,...]) is
  // itself withdrawn. Iterate to a fixpoint so chains of dependence all collapse.
  let changed = true;
  while (changed) {
    changed = false;
    const outNames = new Set(list.filter((r) => r.status === 'out').map((r) => r.name));
    for (let i = 0; i < list.length; i++) {
      const rule = list[i];
      if (rule.status === 'out') continue;
      const deps = Array.isArray(rule.dependsOn) ? rule.dependsOn : [];
      if (deps.some((d) => outNames.has(d))) {
        list[i] = { ...rule, status: 'out' };
        retracted.push(rule.name);
        changed = true;
      }
    }
  }

  return { rules: list, retracted, demoted };
}

// Only the rules currently believed ("in"). mycin-router's infer() should run over THESE.
export function activeRules(rules) {
  return (Array.isArray(rules) ? rules : []).filter((r) => r && r.status !== 'out');
}

function normalizeObservation(o) {
  if (!o || typeof o !== 'object') return null;
  const facts = o.facts && typeof o.facts === 'object' ? o.facts : {};
  const answer = 'answer' in o ? o.answer : 'label' in o ? o.label : undefined;
  if (answer === undefined) return null;
  return { facts, answer };
}

function conditionsMatch(rule, facts) {
  const when = Array.isArray(rule && rule.when) ? rule.when : [];
  if (when.length === 0) return false; // an unconditioned rule isn't tied to these facts
  return when.every((c) => c && c.op === 'eq' && factEq(facts, c.fact, c.value));
}

function ruleAnswer(rule) {
  const then = rule && rule.then;
  if (then && typeof then === 'object' && 'answer' in then) return then.answer;
  return then;
}

function sameAnswer(a, b) {
  if (a === b) return true;
  return labelKey(a) === labelKey(b);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4) THE BRAIN — integration with mycin-router's loop
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// createBrain(opts) builds a stateful container that wraps mycin-router.infer / answerOrEscalate
// with the three learning mechanisms. It holds:
//   • baseRuleSets — author-written rules, never mutated by learning.
//   • learnedRules — the rules Smols Brain has FORMED (induced) + reinforced; the part that grows.
//   • cases        — the accrued experience induction learns from.
//   • status (in/out) lives on each learned rule (TMS).
//
// learnStep(brain, caseOutcome) is the per-loop hook mycin-router calls after answering: it accrues
// the case, applies CF reinforcement to whichever learned rule fired, runs truth-maintenance against
// the new observation, and PERIODICALLY (every `induceEvery` cases) re-induces generalized rules.
//
// brain.infer(query) and brain.answerOrEscalate(job, handlers) then run mycin-router over
// (baseRuleSets + the currently-"in" learned rules) — so over time the brain answers more from its
// OWN generalizations, and only escalates to the model when its self-formed confidence is low.
export function createBrain({
  baseRuleSets = [],
  learnedRules = [],
  cases = [],
  induceEvery = 3,
  induce = {},
  reinforceRate = DEFAULT_LEARN_RATE,
  tms = {},
} = {}) {
  return {
    baseRuleSets: Array.isArray(baseRuleSets) ? baseRuleSets.slice() : [],
    learnedRules: Array.isArray(learnedRules) ? learnedRules.slice() : [],
    cases: Array.isArray(cases) ? cases.slice() : [],
    sinceInduce: 0,
    config: {
      induceEvery: Number.isFinite(induceEvery) && induceEvery > 0 ? induceEvery : 3,
      induce: { minSupport: 2, minConfidence: 0.6, maxConditions: 3, ...induce },
      reinforceRate,
      tms: { demote: 0.4, floor: 0.0, ...tms },
    },

    // Build the rule sets infer() should see: base rules + active (in) learned rules.
    ruleSets() {
      const learned = activeRules(this.learnedRules);
      return [...this.baseRuleSets, learned].filter((s) => Array.isArray(s) && s.length);
    },

    // PURE inference over base + self-formed rules. No model.
    infer({ query, facts = {} } = {}) {
      return infer({ query, facts, ruleSets: this.ruleSets() });
    },

    // Rules-first, escalate to model only when self-formed confidence is low.
    async answerOrEscalate(job = {}, handlers = {}, opts = {}) {
      return answerOrEscalate({ ...job, ruleSets: this.ruleSets() }, handlers, opts);
    },
  };
}

// learnStep — the integration point. Apply reinforcement + TMS now, induction periodically.
// caseOutcome: { query, facts, answer, accepted=true }
// Returns the brain (mutated in place) for chaining; soft-fails on a bad brain.
export function learnStep(brain, caseOutcome = {}) {
  if (!brain || typeof brain !== 'object' || !Array.isArray(brain.learnedRules)) return brain;
  const { query = '', facts = {}, answer = null, accepted = true } = caseOutcome;
  const kase = { query, facts: facts && typeof facts === 'object' ? facts : {}, answer, accepted: accepted !== false };

  // (a) Accrue the case as experience for induction.
  brain.cases.push(kase);

  // (b) CF REINFORCEMENT: for every currently-active learned rule whose conditions match this
  //     case's facts, nudge its CF by whether THIS case agrees with the rule's conclusion.
  const obsForReinforce = { facts: kase.facts, answer: kase.answer };
  for (let i = 0; i < brain.learnedRules.length; i++) {
    const rule = brain.learnedRules[i];
    if (rule.status === 'out') continue;
    if (!conditionsMatch(rule, kase.facts)) continue;
    const agrees = sameAnswer(ruleAnswer(rule), kase.answer) && kase.accepted;
    brain.learnedRules[i] = reinforce(rule, agrees, { rate: brain.config.reinforceRate });
  }

  // (c) TRUTH MAINTENANCE: contradicting observations demote/retract; confirming ones may revive.
  //     Only accepted cases count as ground-truth observations for the TMS.
  if (kase.accepted) {
    const tmsRes = applyTruthMaintenance(brain.learnedRules, obsForReinforce, brain.config.tms);
    brain.learnedRules = tmsRes.rules;
  }

  // (d) PERIODIC INDUCTION: every induceEvery cases, re-derive generalized rules from experience
  //     and merge them in (keeping any reinforcement already accrued on existing rules).
  brain.sinceInduce += 1;
  if (brain.sinceInduce >= brain.config.induceEvery) {
    brain.sinceInduce = 0;
    const induced = induceRules(brain.cases.filter((c) => c.accepted !== false), brain.config.induce);
    brain.learnedRules = mergeLearned(brain.learnedRules, induced);
  }

  return brain;
}

// mergeLearned — fold freshly induced rules into the existing set. An induced rule with the same
// name as an existing one is treated as the SAME belief: we keep the existing rule's reinforced CF
// (experience already tuned it) but refresh support/confidence metadata, and keep it "in" unless it
// was explicitly retracted. New induced rules are added "in".
function mergeLearned(existing, induced) {
  const byName = new Map((Array.isArray(existing) ? existing : []).map((r) => [r.name, r]));
  for (const rule of induced) {
    const prior = byName.get(rule.name);
    if (prior) {
      const merged = { ...rule };
      // Preserve experience-tuned CF and reinforcement count.
      if (prior.then && typeof prior.then === 'object' && Number.isFinite(prior.then.cf)) {
        merged.then = { ...rule.then, cf: prior.then.cf };
      }
      if (Number.isFinite(prior.reinforced)) merged.reinforced = prior.reinforced;
      merged.status = prior.status === 'out' ? 'out' : 'in';
      byName.set(rule.name, merged);
    } else {
      byName.set(rule.name, { ...rule, status: 'in' });
    }
  }
  return [...byName.values()];
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CLI: a worked example (offline; no model called) ───────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('smols-brain.mjs')) {
  // 1) Reinforcement: a rule confirmed repeatedly climbs toward +1.
  let rule = { name: 'r', when: [{ fact: 'topic', op: 'eq', value: 'price' }], then: { answer: 'PRICE', cf: 0.2 } };
  const path = [0.2];
  for (let i = 0; i < 6; i++) { rule = reinforce(rule, true); path.push(Number(rule.then.cf.toFixed(3))); }
  console.log('reinforce (repeated accept) CF path:', JSON.stringify(path));

  // 2) Induction → generalization to an unseen case.
  const cases = [
    { facts: { topic: 'price', chain: 'melek' }, answer: 'price-lookup' },
    { facts: { topic: 'price', chain: 'hive' }, answer: 'price-lookup' },
    { facts: { topic: 'price', chain: 'steem' }, answer: 'price-lookup' },
    { facts: { topic: 'weather', chain: 'melek' }, answer: 'unknown' },
  ];
  const induced = induceRules(cases, { minSupport: 2, minConfidence: 0.6 });
  console.log('induced rule(s):', JSON.stringify(induced.map((r) => ({ when: r.when, answer: r.then.answer, cf: r.then.cf }))));
  const brain = createBrain({ learnedRules: induced.map((r) => ({ ...r, status: 'in' })) });
  const novel = brain.infer({ query: 'what is the price on a chain I never saw?', facts: { topic: 'price', chain: 'blurt' } });
  console.log('novel UNSEEN case (topic=price, chain=blurt) →', JSON.stringify({ answer: novel.answer, confidence: novel.confidence, source: novel.source }));

  // 3) Truth maintenance: a contradicting observation retracts the rule.
  const tms = applyTruthMaintenance(induced.map((r) => ({ ...r, status: 'in' })), { facts: { topic: 'price', chain: 'melek' }, answer: 'NOT-price-anymore' });
  console.log('after contradiction — retracted:', JSON.stringify(tms.retracted), 'demoted:', JSON.stringify(tms.demoted));
}
