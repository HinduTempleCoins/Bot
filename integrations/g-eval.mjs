// g-eval.mjs — G-Eval-style rubric scoring for brief-assessment (queue #148). An LLM-as-judge that
// scores text against a NAMED rubric on a 1–5 scale, using chain-of-thought evaluation steps. Used to
// grade the resident-AI three-part briefs and other generated content. Offline-first: when no judge
// LLM is injected, a DETERMINISTIC heuristic scorer stands in (score from simple measurable proxies
// per rubric — length adequacy, presence of required sections/keywords, etc.) so the whole thing runs
// with ZERO network, ZERO deps, NO API, NO secrets. Soft-fail throughout.
//
// The G-Eval pattern (Liu et al. 2023): give the judge a rubric's CRITERIA + explicit STEP-by-step
// evaluation instructions (chain-of-thought), have it emit a single score on a fixed scale. Here each
// rubric carries its steps; the heuristic maps each step to a measurable proxy and averages.
//
//   import { evaluate, scoreBrief, batchEvaluate, RUBRICS, __setJudge } from './integrations/g-eval.mjs'
//   node integrations/g-eval.mjs        # offline demo over a tiny fixture

// ── injectable judge ──────────────────────────────────────────────────────────────────────────────
// A judge is `async (prompt, { rubric, text, context, step }) => string|number`. We parse a numeric
// score (1..5) out of whatever it returns. No judge set → deterministic heuristic below.
let _judge = null;
export function __setJudge(fn) { _judge = typeof fn === 'function' ? fn : null; }

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const round2 = (x) => Math.round(x * 100) / 100;
const str = (s) => String(s == null ? '' : s);

function words(s) { return str(s).split(/\s+/).filter(Boolean); }
function lc(s) { return str(s).toLowerCase(); }

// Count how many of `needles` (strings or regexes) are present in `text` (case-insensitive for strings).
function presentCount(text, needles = []) {
  const hay = lc(text);
  let n = 0;
  for (const needle of needles) {
    if (needle instanceof RegExp) { if (needle.test(text)) n++; }
    else if (hay.includes(lc(needle))) n++;
  }
  return n;
}

// Map a fraction [0,1] onto the rubric scale [min,max]. fraction 0 → min, 1 → max.
function fracToScale(frac, scale) {
  const f = clamp(frac, 0, 1);
  return scale.min + f * (scale.max - scale.min);
}
// Inverse: scale value → normalized [0,1].
function scaleToNorm(score, scale) {
  if (scale.max === scale.min) return 1;
  return clamp((score - scale.min) / (scale.max - scale.min), 0, 1);
}

const SCALE = { min: 1, max: 5 };

// ── heuristic step scorers ────────────────────────────────────────────────────────────────────────
// Each rubric step has a deterministic proxy: (text, context) → fraction in [0,1]. These are the
// "measurable proxies" that stand in for a judge LLM offline. Intentionally lenient/smooth.

// adequate length: ramps from 0 (empty) to 1 at `full` words, with a floor `min` words for any credit.
function lengthAdequacy(text, { min = 8, full = 60 } = {}) {
  const n = words(text).length;
  if (n < min) return n / Math.max(min, 1) * 0.4; // tiny texts get at most partial credit
  return clamp((n - min) / (full - min), 0, 1) * 0.6 + 0.4;
}

// fraction of required sections/keywords present.
function sectionCoverage(text, required = []) {
  if (!required.length) return 1;
  return presentCount(text, required) / required.length;
}

// presence of an actionable imperative / verb-led directive (a brief that tells you what to DO).
function actionability(text) {
  const t = lc(text);
  const cues = [/\bbuild\b/, /\badd\b/, /\bfix\b/, /\bdeploy\b/, /\bcreate\b/, /\bnext\b/,
    /\bshould\b/, /\bneed(?:s|ed)?\b/, /\bto[- ]do\b/, /\btodo\b/, /\brun\b/, /\bwire\b/,
    /\bmerge\b/, /\benable\b/, /\bdecision\b/, /\bapprove\b/];
  const hits = cues.filter((re) => re.test(t)).length;
  return clamp(hits / 3, 0, 1); // 3+ action cues → full credit
}

// plain-English / front-facing phrasing: rewards short sentences + a "for the operator" framing,
// penalizes a wall of backend jargon (file paths, service names, hashes).
function plainEnglish(text) {
  const t = str(text);
  if (!t.trim()) return 0;
  const sentences = t.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
  const avgLen = sentences.length ? words(t).length / sentences.length : 999;
  const lenScore = clamp(1 - (avgLen - 12) / 28, 0, 1); // ~12-word sentences ideal, 40+ bad
  const frontFacing = /\bfor (?:ryan|the operator|you)\b|\bplain[- ]english\b|\bin short\b|\bone[- ]sentence\b/i
    .test(t) ? 1 : 0.5;
  const jargon = (t.match(/\/[\w./-]{6,}|[0-9a-f]{7,40}\b|\.(?:mjs|js|service)\b/g) || []).length;
  const jargonPenalty = clamp(jargon / 12, 0, 0.4); // a little is fine, a wall is not
  return clamp(0.55 * lenScore + 0.45 * frontFacing - jargonPenalty, 0, 1);
}

// drafted-code present: fenced block, or a recognizable code-shaped line.
function draftedCode(text) {
  const t = str(text);
  if (/```/.test(t)) return 1;
  const codey = /(?:function |const |export |import |=>|;\s*$|\{\s*$)/m.test(t);
  return codey ? 0.6 : 0;
}

// groundedness proxy: how much of the text's content overlaps the provided context (lenient token
// coverage). With no context, we can't penalize, so return neutral-high (assume grounded).
function groundedness(text, context) {
  const ctx = Array.isArray(context) ? context.join(' ') : str(context);
  if (!ctx.trim()) return 0.75;
  const ctxTokens = new Set(words(lc(ctx)).filter((w) => w.length > 2));
  const txtTokens = words(lc(text)).filter((w) => w.length > 2);
  if (!txtTokens.length) return 0;
  let hit = 0;
  for (const w of txtTokens) if (ctxTokens.has(w)) hit++;
  return clamp(hit / txtTokens.length, 0, 1);
}

// relevance proxy: token overlap between text and context/topic, symmetric-ish.
function relevanceProxy(text, context) {
  const ctx = Array.isArray(context) ? context.join(' ') : str(context);
  if (!ctx.trim()) return str(text).trim() ? 0.7 : 0;
  const a = new Set(words(lc(text)).filter((w) => w.length > 2));
  const b = new Set(words(lc(ctx)).filter((w) => w.length > 2));
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const w of a) if (b.has(w)) inter++;
  return clamp(inter / Math.min(a.size, b.size), 0, 1);
}

// coherence proxy: penalize fragmentation (too many ultra-short sentences) and reward some structure
// (multiple sentences that flow). Pure surface heuristic.
function coherenceProxy(text) {
  const t = str(text);
  if (!t.trim()) return 0;
  const sentences = t.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
  if (!sentences.length) return 0;
  const wc = words(t).length;
  if (sentences.length === 1) return clamp(wc / 25, 0, 1); // one sentence: ok if substantive
  const avg = wc / sentences.length;
  const lenScore = clamp(1 - Math.abs(avg - 14) / 20, 0, 1); // ~14-word sentences read coherently
  const connectives = presentCount(t, ['because', 'therefore', 'so that', 'which', 'then',
    'while', 'however', 'and', 'but']);
  const flow = clamp(connectives / 3, 0, 1);
  return clamp(0.6 * lenScore + 0.4 * flow, 0, 1);
}

// ── rubric registry ─────────────────────────────────────────────────────────────────────────────
// Each rubric: { name, criteria, steps:[{ key, instruction, proxy(text,context)->[0,1] }], scale }.
// The `instruction` strings are the chain-of-thought evaluation steps fed to a judge LLM; the
// `proxy` fns are the offline deterministic stand-ins.
export const RUBRICS = {
  'brief-quality': {
    name: 'brief-quality',
    criteria: 'A resident-AI brief is high quality when it is ACTIONABLE (says what to do), written in '
      + 'PLAIN ENGLISH with a front-facing "for the operator" framing (not backend jargon), and '
      + 'includes DRAFTED CODE the operator can hand to Claude Code.',
    steps: [
      { key: 'actionable', instruction: 'Read the brief and judge whether it clearly states concrete next actions / decisions to make.', proxy: (t) => actionability(t) },
      { key: 'plain-english', instruction: 'Judge whether the brief leads with plain-English, front-facing phrasing the non-programmer operator can act on, rather than file paths / hashes / service names.', proxy: (t) => plainEnglish(t) },
      { key: 'sections', instruction: 'Check that the brief contains its expected sections (a for-the-operator part, a for-Claude-Code part, and drafted code).', proxy: (t) => sectionCoverage(t, ['for ryan', 'for claude', 'drafted']) },
      { key: 'drafted-code', instruction: 'Check that the brief includes drafted code, not just prose.', proxy: (t) => draftedCode(t) },
      { key: 'length', instruction: 'Judge whether the brief has adequate substance (not a one-liner, not bloated).', proxy: (t) => lengthAdequacy(t, { min: 20, full: 120 }) },
    ],
    scale: SCALE,
  },
  coherence: {
    name: 'coherence',
    criteria: 'The text reads as a coherent, well-structured whole: sentences flow, ideas connect, '
      + 'no fragmented word-salad.',
    steps: [
      { key: 'flow', instruction: 'Judge whether sentences connect logically and the text reads as a coherent whole.', proxy: (t) => coherenceProxy(t) },
      { key: 'substance', instruction: 'Judge whether there is enough content to assess coherence at all.', proxy: (t) => lengthAdequacy(t, { min: 10, full: 50 }) },
    ],
    scale: SCALE,
  },
  relevance: {
    name: 'relevance',
    criteria: 'The text is on-topic and addresses the provided context / question.',
    steps: [
      { key: 'on-topic', instruction: 'Judge how much of the text actually addresses the provided context / topic.', proxy: (t, c) => relevanceProxy(t, c) },
    ],
    scale: SCALE,
  },
  groundedness: {
    name: 'groundedness',
    criteria: 'The claims in the text are supported by (grounded in) the provided context, not '
      + 'fabricated.',
    steps: [
      { key: 'supported', instruction: 'Judge what fraction of the text\'s claims are supported by the provided context.', proxy: (t, c) => groundedness(t, c) },
    ],
    scale: SCALE,
  },
};

export const DEFAULT_PASS_THRESHOLD = 0.6; // normalized (0..1)

// ── score a single step ───────────────────────────────────────────────────────────────────────────
// Build the chain-of-thought prompt for one step, ask the judge if present, else run the proxy.
function buildStepPrompt(rubric, step, text, context) {
  const ctx = Array.isArray(context) ? context.join('\n') : str(context);
  return [
    `You are an impartial evaluator using the "${rubric.name}" rubric.`,
    `Criteria: ${rubric.criteria}`,
    `Evaluation step: ${step.instruction}`,
    ctx.trim() ? `Context:\n${ctx}` : '',
    `Text to evaluate:\n${str(text)}`,
    `Respond with a single integer score from ${rubric.scale.min} to ${rubric.scale.max} for THIS step only.`,
  ].filter(Boolean).join('\n\n');
}

// Parse a number in [min,max] out of a judge's raw return (string or number). Soft: clamps, and on
// total failure returns null so the caller can fall back to the heuristic.
function parseScore(raw, scale) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return clamp(raw, scale.min, scale.max);
  const m = str(raw).match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n)) return null;
  return clamp(n, scale.min, scale.max);
}

async function scoreStep(rubric, step, text, context) {
  if (_judge) {
    try {
      const prompt = buildStepPrompt(rubric, step, text, context);
      const raw = await _judge(prompt, { rubric: rubric.name, text, context, step: step.key });
      const parsed = parseScore(raw, rubric.scale);
      if (parsed != null) return { key: step.key, instruction: step.instruction, score: round2(parsed), source: 'judge' };
    } catch { /* soft-fail to heuristic */ }
  }
  const frac = clamp(Number(step.proxy(text, context)) || 0, 0, 1);
  return { key: step.key, instruction: step.instruction, score: round2(fracToScale(frac, rubric.scale)), source: 'heuristic' };
}

// ── evaluate ────────────────────────────────────────────────────────────────────────────────────
/**
 * Score `text` against a named `rubric` (1–5) with chain-of-thought step sub-scores.
 * @returns { rubric, score, normalized, reasoning:[{key,instruction,score,source}], pass, error? }
 * Unknown rubric soft-fails to a safe, low, non-passing result (never throws).
 */
export async function evaluate({ text = '', rubric = 'brief-quality', context = '' } = {},
  { threshold = DEFAULT_PASS_THRESHOLD } = {}) {
  const def = RUBRICS[rubric];
  if (!def) {
    return { rubric: str(rubric), score: SCALE.min, normalized: 0, reasoning: [], pass: false,
      error: `unknown rubric "${rubric}"` };
  }
  const reasoning = [];
  for (const step of def.steps) {
    reasoning.push(await scoreStep(def, step, text, context));
  }
  const mean = reasoning.length
    ? reasoning.reduce((a, r) => a + r.score, 0) / reasoning.length
    : def.scale.min;
  const score = round2(mean);
  const normalized = round2(scaleToNorm(score, def.scale));
  return { rubric: def.name, score, normalized, reasoning, pass: normalized >= threshold };
}

// ── convenience: score a brief ──────────────────────────────────────────────────────────────────
/** Score a resident-AI brief with the `brief-quality` rubric. */
export async function scoreBrief(briefText, opts = {}) {
  return evaluate({ text: briefText, rubric: 'brief-quality', context: opts.context || '' }, opts);
}

// ── batch ───────────────────────────────────────────────────────────────────────────────────────
/**
 * Evaluate many items against one rubric. `items` are strings or {text,context} objects.
 * @returns { rubric, count, results:[...], aggregate:{ meanScore, meanNormalized, passRate, passed } }
 */
export async function batchEvaluate(items = [], rubric = 'brief-quality', opts = {}) {
  const list = Array.isArray(items) ? items : [items];
  const results = [];
  for (const it of list) {
    const arg = typeof it === 'string' ? { text: it, rubric } : { text: it.text, rubric, context: it.context };
    results.push(await evaluate(arg, opts));
  }
  const n = results.length || 1;
  const meanScore = round2(results.reduce((a, r) => a + (r.score || 0), 0) / n);
  const meanNormalized = round2(results.reduce((a, r) => a + (r.normalized || 0), 0) / n);
  const passed = results.filter((r) => r.pass).length;
  return {
    rubric: str(rubric),
    count: results.length,
    results,
    aggregate: { meanScore, meanNormalized, passRate: round2(passed / n), passed },
  };
}

// ── CLI demo (offline, no deps, no network) ───────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('g-eval.mjs')) {
  const goodBrief = [
    '## FOR RYAN',
    'In short: the Discord bot needs its news feed wired up so it can answer market questions.',
    'Next decision for you: approve restarting the service so the change goes live.',
    '',
    '## FOR CLAUDE CODE',
    'Build the news adapter, add a failover source, and merge it into the !sb command.',
    '',
    '## DRAFTED CODE',
    '```js',
    'export async function fetchNews() { const r = await getFeed(); return dedupCap(r, 10); }',
    '```',
  ].join('\n');
  const badBrief = 'done';

  (async () => {
    console.log('g-eval demo (offline heuristic)\n' + '─'.repeat(60));
    for (const [label, brief] of [['GOOD', goodBrief], ['BAD', badBrief]]) {
      const r = await scoreBrief(brief);
      console.log(`[${label}] score=${r.score}/5 normalized=${r.normalized} → ${r.pass ? 'PASS' : 'FAIL'}`);
      for (const step of r.reasoning) console.log(`   • ${step.key}: ${step.score} (${step.source})`);
      console.log('');
    }
    const batch = await batchEvaluate([goodBrief, badBrief], 'brief-quality');
    console.log('batch aggregate:', JSON.stringify(batch.aggregate));
  })();
}
