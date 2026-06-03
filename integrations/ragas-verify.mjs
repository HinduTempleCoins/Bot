// ragas-verify.mjs — ragas-style faithfulness / atomic-claim citation verifier (queue #149).
// Decompose an answer into atomic claims and check each is SUPPORTED by the provided context /
// citations. Complements integrations/eval-suite.mjs: that one scores faithfulness/relevance over a
// flat context; this one is citation-aware — it attributes each atomic claim to its best-supporting
// citation and surfaces the unsupported (potentially fabricated) ones for review.
//
// Offline-first and ZERO deps: when no judge LLM is injected, support is scored by deterministic
// LEXICAL token-overlap (a claim is supported if a large share of its content tokens appear in some
// context chunk). Inject a real judge with __setJudge(fn) where fn(claim, context) → 0..1 (sync or
// async) to use a smarter scorer; the lexical path is the always-available floor. No network, no
// secrets, soft-fail (every function returns a sane value instead of throwing to the caller).
//
//   atomizeClaims(answer)               → string[]   atomic claims
//   claimSupport(claim, context)        → 0..1       support score (judge if set, else lexical)
//   faithfulness(answer, context)       → 0..1       mean support across atomic claims
//   verifyCitations(answer, citations)  → { claims, faithfulness, unsupported }
//   report(answer, context)             → string     short human summary
//
//   import { verifyCitations, faithfulness, __setJudge } from './integrations/ragas-verify.mjs'
//   node integrations/ragas-verify.mjs   # offline demo over a tiny fixture

// ── injectable judge ──────────────────────────────────────────────────────────────────────────
// fn(claim, context) → number in [0,1] (or Promise of one). When null, the lexical fallback is used.
let _judge = null;
export function __setJudge(fn) { _judge = typeof fn === 'function' ? fn : null; }

// ── tokenization (mirrors eval-suite.mjs) ──────────────────────────────────────────────────────
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'as', 'at', 'by', 'it', 'its', 'this', 'that', 'these',
  'those', 'with', 'from', 'into', 'than', 'then', 'so', 'but', 'if', 'not', 'no', 'do', 'does',
  'did', 'has', 'have', 'had', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'his',
  'her', 'their', 'they', 'them', 'he', 'she', 'we', 'you', 'i', 'me', 'my', 'our', 'your',
  'what', 'how', 'why', 'who', 'when', 'where', 'which', 'whom', 'about', 'also', 'there', 'here']);

function tokens(s) {
  return String(s == null ? '' : s).toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOP.has(t));
}
function tokenSet(s) { return new Set(tokens(s)); }

const clamp01 = (x) => (Number.isFinite(x) ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0);
const round2 = (x) => Math.round(x * 100) / 100;

// fraction of `a`'s tokens that appear in `b` (recall of a against b).
function coverage(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const t of a) if (b.has(t)) inter++;
  return inter / a.size;
}

// Normalize context (string | string[] | array of {text}) into an array of plain strings.
function chunksOf(context) {
  const arr = Array.isArray(context) ? context : (context == null ? [] : [context]);
  return arr.map((c) => (c && typeof c === 'object' && 'text' in c ? c.text : c))
    .map((c) => String(c == null ? '' : c)).filter((s) => s.trim().length > 0);
}

// ── atomize ─────────────────────────────────────────────────────────────────────────────────────
// Split an answer into atomic claims: sentences, then comma/semicolon/conjunction-joined clauses.
// Each claim is checked independently, so one fabricated clause is caught even when bundled with true
// ones. Empties and content-token-less fragments are dropped.
export function atomizeClaims(answer) {
  const sentences = String(answer == null ? '' : answer)
    .split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const claims = [];
  for (const sent of sentences) {
    const parts = sent.split(/[;]|,\s+(?:and|but|while|whereas|which|who)\s+|,\s+/i)
      .map((p) => p.trim()).filter((p) => tokens(p).length > 0);
    if (parts.length) claims.push(...parts);
    else if (tokens(sent).length) claims.push(sent);
  }
  return claims;
}

// ── per-claim support ───────────────────────────────────────────────────────────────────────────
// Lexical support: best per-chunk coverage of the claim's content tokens. Pure, deterministic.
function lexicalSupport(claim, chunks) {
  const ct = tokenSet(claim);
  if (!ct.size) return 1;             // no content tokens (e.g. "Yes.") → not a factual claim
  let best = 0;
  for (const ch of chunks) best = Math.max(best, coverage(ct, tokenSet(ch)));
  return clamp01(best);
}

/**
 * Support score in [0,1] for one claim against context (string | string[] | {text}[]).
 * Uses the injected judge if set, else the deterministic lexical fallback. Soft-fail: a throwing or
 * non-numeric judge result falls back to lexical so the caller always gets a usable score.
 * Returns a number when lexical, or a Promise<number> when an async judge is active.
 */
export function claimSupport(claim, context) {
  const chunks = chunksOf(context);
  if (!_judge) return lexicalSupport(claim, chunks);
  let res;
  try { res = _judge(claim, chunks); } catch { return lexicalSupport(claim, chunks); }
  if (res && typeof res.then === 'function') {
    return res.then((v) => (Number.isFinite(v) ? clamp01(v) : lexicalSupport(claim, chunks)))
      .catch(() => lexicalSupport(claim, chunks));
  }
  return Number.isFinite(res) ? clamp01(res) : lexicalSupport(claim, chunks);
}

// ── faithfulness ────────────────────────────────────────────────────────────────────────────────
/**
 * Mean support across the answer's atomic claims. Edge-case contract mirrors eval-suite.faithfulness:
 *   no claims → 1 (nothing asserted, nothing to contradict)
 *   claims but empty context → 0 (fully ungrounded)
 * Returns a number, or a Promise<number> when an async judge is active.
 */
export function faithfulness(answer, context = []) {
  const chunks = chunksOf(context);
  const claims = atomizeClaims(answer);
  if (!claims.length) return 1;
  if (!chunks.length) return 0;

  const scores = claims.map((c) => claimSupport(c, chunks));
  if (scores.some((s) => s && typeof s.then === 'function')) {
    return Promise.all(scores).then((vals) => clamp01(vals.reduce((a, b) => a + b, 0) / vals.length));
  }
  return clamp01(scores.reduce((a, b) => a + b, 0) / scores.length);
}

// ── citation verification ───────────────────────────────────────────────────────────────────────
/**
 * Verify an answer against citations [{text, source}]. Each atomic claim is matched to its
 * BEST-supporting citation; `supported` when its score ≥ threshold (default 0.5).
 * Returns { claims:[{claim, supported, score, bestSource}], faithfulness, unsupported:[…] }.
 * Synchronous on the lexical path; returns a Promise of the same shape when an async judge is active.
 */
export function verifyCitations(answer, citations = [], { threshold = 0.5 } = {}) {
  const cites = (Array.isArray(citations) ? citations : [citations])
    .filter((c) => c && (typeof c === 'object' || typeof c === 'string'))
    .map((c) => (typeof c === 'string' ? { text: c, source: null } : { text: String(c.text == null ? '' : c.text), source: c.source ?? null }))
    .filter((c) => c.text.trim().length > 0);
  const claims = atomizeClaims(answer);

  // Score one claim against every citation; keep the best.
  const scoreClaim = (claim) => {
    const perCite = cites.map((c) => claimSupport(claim, c.text));
    const finish = (vals) => {
      let bestI = -1, bestScore = 0;
      vals.forEach((v, i) => { if (v > bestScore) { bestScore = v; bestI = i; } });
      const score = round2(clamp01(bestScore));
      return {
        claim,
        supported: score >= threshold,
        score,
        bestSource: bestI >= 0 ? cites[bestI].source : null,
      };
    };
    if (perCite.some((v) => v && typeof v.then === 'function')) return Promise.all(perCite).then(finish);
    return finish(perCite);
  };

  const scored = claims.map(scoreClaim);
  const assemble = (rows) => {
    const faith = rows.length
      ? round2(clamp01(rows.reduce((a, r) => a + r.score, 0) / rows.length))
      : 1;
    const unsupported = rows.filter((r) => !r.supported).map((r) => r.claim);
    return { claims: rows, faithfulness: faith, unsupported };
  };
  if (scored.some((r) => r && typeof r.then === 'function')) return Promise.all(scored).then(assemble);
  return assemble(scored);
}

// ── human report ────────────────────────────────────────────────────────────────────────────────
/**
 * Short human-readable summary of faithfulness over a flat context (string | string[] | {text}[]).
 * Returns a string, or a Promise<string> when an async judge is active.
 */
export function report(answer, context = []) {
  const claims = atomizeClaims(answer);
  const f = faithfulness(answer, context);
  const fmt = (faith) => {
    const pct = Math.round(clamp01(faith) * 100);
    const supported = Math.round(clamp01(faith) * claims.length);
    return `faithfulness ${pct}% — ${supported}/${claims.length} atomic claim(s) supported`;
  };
  return f && typeof f.then === 'function' ? f.then(fmt) : fmt(f);
}

// ── CLI demo (offline, no deps, no network) ─────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('ragas-verify.mjs')) {
  const citations = [
    { text: 'Alexander Shulgin was an American medicinal chemist born in 1925 in Berkeley, California.', source: 'wiki:Shulgin#bio' },
    { text: 'He authored the books PiHKAL and TiHKAL with his wife Ann Shulgin.', source: 'wiki:Shulgin#books' },
  ];
  const answer = 'Alexander Shulgin was an American chemist. He authored PiHKAL and TiHKAL. He won a Nobel Prize in 1990.';

  console.log('ragas-verify demo (offline)\n' + '─'.repeat(60));
  const v = verifyCitations(answer, citations);
  for (const c of v.claims) {
    console.log(`[${c.supported ? 'OK ' : 'XX '}] ${c.score.toFixed(2)} ${c.bestSource || '(none)'}  — ${c.claim}`);
  }
  console.log('─'.repeat(60));
  console.log(report(answer, citations));
  if (v.unsupported.length) console.log('UNSUPPORTED:', v.unsupported.join(' | '));
}
