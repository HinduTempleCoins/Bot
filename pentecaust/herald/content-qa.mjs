// pentecaust/herald/content-qa.mjs — Herald CONTENT-QA / AI-DETECTION gate (Proofademic-class).
// Deterministic, offline heuristics that score how "AI-written" a passage reads and suggest humanizing edits,
// so Herald doesn't ship robotic slop into the backlink network / SEO verticals. NOT a plagiarism checker.
//   import { scoreText, gate } from './content-qa.mjs'
//   scoreText(text) -> { aiScore: 0-100, signals: [...], humanize: [suggestions] }
//   gate(text, { max = 60 }) -> { ok, aiScore, reasons }
//
// House rules: ESM, esc() all interpolation, soft-fail (never throw), pure + unit-testable, no network/keys.

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// ── tokenization helpers ─────────────────────────────────────────────────────────────────────────────────
function sentences(text) {
  return String(text == null ? '' : text)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“‘])/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function words(text) {
  return String(text == null ? '' : text).toLowerCase().match(/[a-z0-9']+/g) || [];
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
}

// ── AI tell-tale phrase catalog (case-insensitive, substring) ────────────────────────────────────────────
export const AI_CLICHES = [
  'in the ever-evolving', 'ever-evolving', 'in today’s fast-paced', "in today's fast-paced",
  'delve into', 'delving into', 'it is important to note', "it's important to note",
  'it is worth noting', 'it should be noted', 'in conclusion', 'in summary',
  'a testament to', 'plays a crucial role', 'plays a vital role', 'plays a pivotal role',
  'navigating the', 'the world of', 'a rich tapestry', 'tapestry of', 'realm of',
  'unlock the', 'unleash the', 'harness the power', 'at the end of the day',
  'when it comes to', 'first and foremost', 'last but not least', 'needless to say',
  'in essence', 'furthermore', 'moreover', 'additionally', 'notably',
  'game-changer', 'game changer', 'cutting-edge', 'state-of-the-art', 'seamless',
  'robust', 'leverage', 'foster', 'underscore', 'paramount', 'multifaceted',
  'holistic', 'synergy', 'paradigm', 'elevate your', 'take your', 'to the next level',
  'dive deeper', 'let’s explore', "let's explore", 'embark on a journey', 'ensure that',
];

// hedging / softener terms — AI over-hedges relative to a human with a point of view
export const HEDGES = [
  'may', 'might', 'could', 'perhaps', 'possibly', 'generally', 'typically', 'often',
  'usually', 'somewhat', 'relatively', 'arguably', 'tends to', 'tend to', 'can be',
  'in some cases', 'to some extent', 'it depends',
];

// ── individual signal scorers — each returns { score 0-100, label, detail? } ─────────────────────────────
// Burstiness: humans vary sentence length wildly; AI tends toward uniform length → low variation → high AI score.
function burstinessSignal(sents) {
  if (sents.length < 3) return null;
  const lens = sents.map((s) => (words(s).length));
  const m = mean(lens);
  const cv = m > 0 ? stdev(lens) / m : 0; // coefficient of variation
  // human prose CV commonly 0.4–0.8; very uniform (<0.25) reads machine-made.
  const score = clamp(Math.round((0.5 - cv) / 0.5 * 100), 0, 100);
  return { key: 'burstiness', score, label: `low burstiness (sentence-length CV ${cv.toFixed(2)})`, cv: Math.round(cv * 1000) / 1000 };
}

function clicheSignal(text, wordCount) {
  const low = String(text == null ? '' : text).toLowerCase();
  const hits = [];
  for (const p of AI_CLICHES) if (low.includes(p)) hits.push(p);
  if (!hits.length) return { key: 'cliches', score: 0, label: 'no stock AI phrases', hits: [] };
  // density per 100 words, each cliche ~ +18 points, capped.
  const per100 = wordCount > 0 ? (hits.length / wordCount) * 100 : hits.length;
  const score = clamp(Math.round(hits.length * 18 + per100 * 20), 0, 100);
  return { key: 'cliches', score, label: `${hits.length} stock AI phrase(s): ${hits.slice(0, 6).join(', ')}`, hits };
}

function emDashSignal(text, sents) {
  const s = String(text == null ? '' : text);
  const emCount = (s.match(/—/g) || []).length + (s.match(/\s-\s/g) || []).length;
  if (!sents.length) return null;
  const perSentence = emCount / sents.length;
  // more than ~0.6 em-dashes/sentence is a strong LLM tell.
  const score = clamp(Math.round((perSentence / 0.8) * 100), 0, 100);
  return { key: 'emdash', score, label: `em-dash density ${perSentence.toFixed(2)}/sentence (${emCount} total)`, count: emCount };
}

function hedgingSignal(wds) {
  if (!wds.length) return null;
  let hits = 0;
  const joined = ' ' + wds.join(' ') + ' ';
  for (const h of HEDGES) {
    if (h.includes(' ')) { if (joined.includes(' ' + h + ' ')) hits++; }
    else hits += wds.filter((w) => w === h).length;
  }
  const per100 = (hits / wds.length) * 100;
  // >4 hedges/100 words reads noncommittal & machine-safe.
  const score = clamp(Math.round((per100 / 6) * 100), 0, 100);
  return { key: 'hedging', score, label: `hedging density ${per100.toFixed(1)}/100 words (${hits} hedges)`, per100: Math.round(per100 * 10) / 10 };
}

// Repetition: AI reuses connective openers ("Additionally,", "Moreover,") and repeats lemma-ish tokens.
function repetitionSignal(sents, wds) {
  if (sents.length < 3 || !wds.length) return null;
  const openers = sents.map((s) => (words(s)[0] || '')).filter(Boolean);
  const openerCounts = {};
  for (const o of openers) openerCounts[o] = (openerCounts[o] || 0) + 1;
  const repeatedOpeners = Object.values(openerCounts).filter((c) => c > 1).reduce((a, b) => a + (b - 1), 0);
  const openerScore = openers.length ? (repeatedOpeners / openers.length) * 100 : 0;
  // type-token ratio: low unique/total on long text → repetitive.
  const unique = new Set(wds).size;
  const ttr = unique / wds.length;
  const ttrScore = wds.length >= 40 ? clamp((0.5 - ttr) / 0.5 * 100, 0, 100) : 0;
  const score = clamp(Math.round(openerScore * 0.6 + ttrScore * 0.4), 0, 100);
  return { key: 'repetition', score, label: `repeated sentence openers ${repeatedOpeners}, type-token ratio ${ttr.toFixed(2)}`, ttr: Math.round(ttr * 1000) / 1000 };
}

// weightings — sum to 1. Cliches + burstiness are the strongest discriminators.
const WEIGHTS = { cliches: 0.30, burstiness: 0.25, hedging: 0.15, emdash: 0.15, repetition: 0.15 };

// map a signal key → a concrete humanizing suggestion when that signal fires hot.
const HUMANIZE = {
  cliches: 'Cut stock AI phrases (e.g. "delve into", "it is important to note", "in the ever-evolving") — say the thing plainly.',
  burstiness: 'Vary sentence length: mix a few short, punchy sentences in with the long ones. Uniform rhythm reads machine-made.',
  hedging: 'Take a position. Replace "may/might/generally/tends to" hedges with direct claims where you actually mean them.',
  emdash: 'Reduce em-dashes — recast some as separate sentences or commas; over-use is a strong LLM tell.',
  repetition: 'Stop opening sentences with the same connective ("Additionally", "Moreover") and vary word choice.',
};

/**
 * scoreText(text) -> { aiScore, signals, humanize, stats }
 * Higher aiScore = reads more AI-generated. Pure, deterministic, offline.
 */
export function scoreText(text) {
  const raw = String(text == null ? '' : text);
  const sents = sentences(raw);
  const wds = words(raw);
  const wordCount = wds.length;

  if (wordCount < 8) {
    return {
      aiScore: 0,
      signals: [{ key: 'too-short', score: 0, label: `only ${wordCount} words — too short to score` }],
      humanize: [],
      stats: { words: wordCount, sentences: sents.length },
    };
  }

  const candidates = [
    clicheSignal(raw, wordCount),
    burstinessSignal(sents),
    hedgingSignal(wds),
    emDashSignal(raw, sents),
    repetitionSignal(sents, wds),
  ].filter(Boolean);

  // weighted blend over the signals that were computable; renormalize weights over present keys.
  let wSum = 0, acc = 0;
  for (const sig of candidates) {
    const w = WEIGHTS[sig.key] || 0;
    wSum += w;
    acc += w * sig.score;
  }
  const aiScore = wSum > 0 ? clamp(Math.round(acc / wSum), 0, 100) : 0;

  const signals = candidates.sort((a, b) => b.score - a.score);
  const humanize = signals
    .filter((s) => s.score >= 40 && HUMANIZE[s.key])
    .map((s) => HUMANIZE[s.key]);

  return {
    aiScore,
    signals,
    humanize,
    stats: {
      words: wordCount,
      sentences: sents.length,
      avgSentenceWords: Math.round(mean(sents.map((s) => words(s).length)) * 10) / 10,
    },
  };
}

/**
 * gate(text, { max = 60 }) -> { ok, aiScore, reasons }
 * ok=true when the passage scores at or below `max` (i.e. reads human enough to ship).
 */
export function gate(text, { max = 60 } = {}) {
  const m = Number.isFinite(Number(max)) ? clamp(Number(max), 0, 100) : 60;
  const { aiScore, signals, humanize } = scoreText(text);
  const ok = aiScore <= m;
  const reasons = ok
    ? []
    : [
        `aiScore ${aiScore} exceeds max ${m}`,
        ...signals.filter((s) => s.score >= 50).map((s) => s.label),
      ];
  return { ok, aiScore, max: m, reasons, humanize };
}

// CLI: `node content-qa.mjs "some text"` or pipe stdin — prints the score report.
async function main() {
  const arg = process.argv.slice(2).join(' ').trim();
  let text = arg;
  if (!text && !process.stdin.isTTY) {
    text = await new Promise((res) => {
      let buf = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (d) => (buf += d));
      process.stdin.on('end', () => res(buf));
    });
  }
  const report = scoreText(text || '');
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
