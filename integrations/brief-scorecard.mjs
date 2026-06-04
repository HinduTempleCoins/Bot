// brief-scorecard.mjs — task #225. A SCORECARD for the resident-AI briefs, so the AIs can reflect and
// improve. The operator's ask: don't just score a brief done/not-done — score it by HOW MUCH of it was
// actually completed when we confirmed + did the work, how much was left undone, how much was ignored
// (never even discussed), how much was unrelated, and how much was a hallucination (a claim that didn't
// hold up). Eventually each scored brief lands in a "Done" folder with ✓/✗ marks — so this module only
// ever APPENDS to a brief-records store; it NEVER deletes a brief.
//
// The flow this sits at the end of:
//   brief-assembler.mjs   (composes the brief)
//      → operator + Claude Code confirm items + do the work  (→ confirmedItems / doneItems)
//      → diagnostics-pipeline.mjs  (flags mistaken claims about the repo — "repo-structure mistakes")
//      → scoreBrief()    (THIS — classify each brief line into a bucket; compute % completed)
//      → recordScorecard() (append-only → the future "Done" folder)
//      → rollup()        (portfolio view: avg completion, worst-ignored, most-hallucinated)
//
// CONVENTIONS (match the rest of integrations/):
//   • PURE / DETERMINISTIC — no clocks except an INJECTABLE one (opts.now); same inputs → same output.
//   • INJECTABLE STORE — recordScorecard takes { store }; tests pass an in-memory store and run OFFLINE.
//   • DEFENSIVE IMPORT — g-eval is reused for a quality sub-score when present, soft-failing to a local
//     deterministic proxy so this module never depends on g-eval being importable.
//   • SOFT-FAIL — a malformed brief / item never throws; it scores to a safe empty/zero result.
//   • NO SECRETS, NO KEYS, READ-ONLY over the data it's given. CLI is guarded.
//
//   import { scoreBrief, classifyItem, recordScorecard, rollup, renderScorecard, BUCKETS }
//     from './integrations/brief-scorecard.mjs'
//   node integrations/brief-scorecard.mjs        # offline demo over a tiny fixture

// ── buckets ─────────────────────────────────────────────────────────────────────────────────────────
// The five top-level categories a brief line falls into, plus one hallucination sub-flag. Ordered by the
// operator's framing: what got done → what's still open → what we never touched → noise → wrong.
export const BUCKETS = Object.freeze({
  COMPLETED: 'completed',         // matched a done item — the work happened
  LEFT_UNDONE: 'left-undone',     // confirmed/discussed but the work didn't happen
  IGNORED: 'ignored',             // never referenced anywhere — never even discussed
  UNRELATED: 'unrelated',         // off-topic to the work at hand (noise the brief carried)
  HALLUCINATION: 'hallucination', // a claim that didn't hold up
});

// sub-flag of HALLUCINATION: a mistaken claim about the REPO that diagnostics corrected.
export const HALLUCINATION_SUBFLAG_REPO = 'repo-structure-mistake';

// the marks that render against each line in the future "Done" folder.
const MARK = Object.freeze({
  DONE: '✓',     // completed
  NOT: '✗',      // left-undone / ignored / hallucination — did NOT land as a finished, correct item
  PARTIAL: '~',  // unrelated — carried but neither a win nor a failure of the actual work
});

// which bucket gets which mark.
function markFor(bucket) {
  if (bucket === BUCKETS.COMPLETED) return MARK.DONE;
  if (bucket === BUCKETS.UNRELATED) return MARK.PARTIAL;
  return MARK.NOT; // left-undone, ignored, hallucination
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────
const str = (s) => String(s == null ? '' : s);
const round2 = (x) => Math.round(x * 100) / 100;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// normalize a free-text line for fuzzy matching: lowercase, strip markdown checkbox/bullet/heading
// noise + punctuation, collapse whitespace. Used to compare a brief line to confirmed/done item text.
function norm(s) {
  return str(s)
    .toLowerCase()
    .replace(/^\s*[-*+]\s*\[[ x~✓✗]?\]\s*/i, '') // "- [ ] " / "- [x] " checkbox prefixes
    .replace(/^\s*[-*+#>]+\s*/g, '')             // bullets / headings / quotes
    .replace(/[`*_#>]/g, ' ')                     // inline markdown
    .replace(/[^a-z0-9\s]/g, ' ')                 // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

// content tokens (length > 2) of a normalized string, as a Set.
function tokenSet(s) {
  return new Set(norm(s).split(' ').filter((w) => w.length > 2));
}

// token-overlap similarity in [0,1]: |A∩B| / |smaller set|. Lenient + symmetric-ish, mirrors g-eval's
// relevanceProxy so "did the brief mention this item" reads consistently across the stack.
function similarity(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

// does `line` match ANY entry in `list` at or above `threshold`? Returns the best score (0 if none).
function bestMatch(line, list = [], threshold = 0.5) {
  let best = 0;
  for (const item of list) {
    const s = similarity(line, item && item.text != null ? item.text : item);
    if (s > best) best = s;
  }
  return best >= threshold ? best : 0;
}

// ── extract the lines of a brief ──────────────────────────────────────────────────────────────────
// A brief may arrive as: a string (markdown — we pull bullet/checkbox/heading-led action lines), an
// array of strings, or an object with .items / .lines / .text. Always → a flat array of line strings.
export function briefLines(brief) {
  if (Array.isArray(brief)) return brief.map(str).filter((l) => l.trim());
  if (brief && typeof brief === 'object') {
    if (Array.isArray(brief.items)) return brief.items.map((i) => str(i && i.text != null ? i.text : i)).filter((l) => l.trim());
    if (Array.isArray(brief.lines)) return brief.lines.map(str).filter((l) => l.trim());
    if (typeof brief.text === 'string') return briefLines(brief.text);
    return [];
  }
  const t = str(brief);
  if (!t.trim()) return [];
  // markdown: keep lines that look like action items (bullets / checkboxes), drop prose + fences.
  const out = [];
  let inFence = false;
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (!line) continue;
    if (/^[-*+]\s+/.test(line) || /^[-*+]\s*\[[ x~✓✗]?\]/i.test(line) || /^\d+[.)]\s+/.test(line)) {
      out.push(line);
    }
  }
  // if no bullets at all, treat each non-empty, non-heading line as a candidate item.
  if (!out.length) {
    for (const raw of t.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || /^#{1,6}\s/.test(line) || /^```/.test(line)) continue;
      out.push(line);
    }
  }
  return out;
}

const briefId = (brief, fallback) => {
  if (brief && typeof brief === 'object' && brief.id != null) return str(brief.id);
  return str(fallback || 'brief');
};

// ── classify a single item ────────────────────────────────────────────────────────────────────────
/**
 * Classify ONE brief line into a bucket.
 *
 * Heuristics (in priority order):
 *   1. flagged by diagnostics as a repo-structure mistake → HALLUCINATION (+ subflag repo-structure-mistake)
 *   2. matched a DONE item                                → COMPLETED
 *   3. in CONFIRMED but not done                          → LEFT_UNDONE
 *   4. flagged unrelated / off-topic                      → UNRELATED
 *   5. not referenced ANYWHERE (confirmed/done/flags)     → IGNORED
 *
 * @param {string} item   the brief line text
 * @param {{confirmedItems?:Array, doneItems?:Array, repoFlags?:Array, unrelated?:Array, threshold?:number}} ctx
 * @returns {{ text:string, bucket:string, mark:string, subflag?:string, score:number }}
 */
export function classifyItem(item, ctx = {}) {
  const text = str(item);
  const {
    confirmedItems = [],
    doneItems = [],
    repoFlags = [],          // diagnostics-flagged repo-structure mistakes (strings or {text})
    unrelated = [],          // explicitly-off-topic lines (strings or {text})
    threshold = 0.5,
  } = ctx || {};

  // 1) diagnostics caught a mistaken claim about the repo → hallucination (repo-structure subflag).
  if (bestMatch(text, repoFlags, threshold)) {
    return { text, bucket: BUCKETS.HALLUCINATION, subflag: HALLUCINATION_SUBFLAG_REPO,
      mark: markFor(BUCKETS.HALLUCINATION), score: 0 };
  }

  // 2) matched something we actually did → completed.
  const doneScore = bestMatch(text, doneItems, threshold);
  if (doneScore) {
    return { text, bucket: BUCKETS.COMPLETED, mark: markFor(BUCKETS.COMPLETED), score: round2(doneScore) };
  }

  // 3) confirmed/discussed but no matching done item → left undone.
  const confScore = bestMatch(text, confirmedItems, threshold);
  if (confScore) {
    return { text, bucket: BUCKETS.LEFT_UNDONE, mark: markFor(BUCKETS.LEFT_UNDONE), score: round2(confScore) };
  }

  // 4) explicitly off-topic to the work → unrelated (noise the brief carried).
  if (bestMatch(text, unrelated, threshold)) {
    return { text, bucket: BUCKETS.UNRELATED, mark: markFor(BUCKETS.UNRELATED), score: 0 };
  }

  // 5) never referenced anywhere → ignored (never even discussed).
  return { text, bucket: BUCKETS.IGNORED, mark: markFor(BUCKETS.IGNORED), score: 0 };
}

// ── optional quality sub-score (reuses g-eval where natural) ─────────────────────────────────────────
// Defensive import: if g-eval is present we reuse its brief-quality rubric for a 0..1 quality read of
// the whole brief; if not, we fall back to a tiny deterministic proxy. Either way: never throws.
async function qualityScore(brief) {
  const text = Array.isArray(brief) ? brief.join('\n')
    : (brief && typeof brief === 'object' && typeof brief.text === 'string') ? brief.text
      : str(brief);
  if (!text.trim()) return 0;
  try {
    const mod = await import('./g-eval.mjs');
    if (typeof mod?.scoreBrief === 'function') {
      const r = await mod.scoreBrief(text);
      if (r && Number.isFinite(r.normalized)) return clamp(r.normalized, 0, 1);
    }
  } catch { /* soft-fail to local proxy */ }
  // local proxy: substance (word count) lightly capped. Deterministic, dependency-free.
  const words = norm(text).split(' ').filter(Boolean).length;
  return clamp(words / 120, 0, 1);
}

// ── score a whole brief ─────────────────────────────────────────────────────────────────────────────
/**
 * Score one brief: % completed (done / confirmed) + per-line bucket classification.
 *
 * % completed is the operator's headline number: of the items we CONFIRMED, how many got DONE. When no
 * confirmed count is available we fall back to (completed lines / total lines) so the number is never NaN.
 *
 * @param {string|string[]|object} brief
 * @param {{confirmedItems?:Array, doneItems?:Array, repoFlags?:Array, unrelated?:Array,
 *          threshold?:number, now?:()=>number, quality?:number}} ctx
 * @returns {Promise<{ id, total, completedPct, quality,
 *   buckets:{completed,leftUndone,ignored,unrelated,hallucination},
 *   items:Array<{text,bucket,mark,subflag?,score}>, ts }>}
 */
export async function scoreBrief(brief, ctx = {}) {
  const c = ctx || {};
  const lines = briefLines(brief);
  const items = lines.map((line) => classifyItem(line, c));

  const buckets = { completed: 0, leftUndone: 0, ignored: 0, unrelated: 0, hallucination: 0 };
  for (const it of items) {
    if (it.bucket === BUCKETS.COMPLETED) buckets.completed++;
    else if (it.bucket === BUCKETS.LEFT_UNDONE) buckets.leftUndone++;
    else if (it.bucket === BUCKETS.IGNORED) buckets.ignored++;
    else if (it.bucket === BUCKETS.UNRELATED) buckets.unrelated++;
    else if (it.bucket === BUCKETS.HALLUCINATION) buckets.hallucination++;
  }

  // % completed = doneItems / confirmedItems (the operator's "how much was actually completed when we
  // confirmed + did the work"). Falls back to completed-lines / total-lines when counts are absent.
  const confirmedCount = Array.isArray(c.confirmedItems) ? c.confirmedItems.length : 0;
  const doneCount = Array.isArray(c.doneItems) ? c.doneItems.length : 0;
  let completedPct;
  if (confirmedCount > 0) {
    completedPct = round2(clamp(doneCount / confirmedCount, 0, 1) * 100);
  } else if (lines.length > 0) {
    completedPct = round2((buckets.completed / lines.length) * 100);
  } else {
    completedPct = 0;
  }

  const quality = typeof c.quality === 'number' ? clamp(c.quality, 0, 1) : await qualityScore(brief);
  const now = typeof c.now === 'function' ? c.now : null;
  const ts = now ? new Date(now()).toISOString() : null;

  return {
    id: briefId(brief, c.id),
    total: lines.length,
    completedPct,
    quality: round2(quality),
    buckets,
    items,
    ts,
  };
}

// ── append-only records store (the future "Done" folder) ────────────────────────────────────────────
/**
 * A default in-memory append-only store. Tests can pass their own object with the same shape; nothing
 * here writes the filesystem unless an external store does. Records are NEVER deleted.
 */
export function createScorecardStore() {
  const records = [];
  return {
    append(rec) { records.push(rec); return rec; },
    list() { return records.slice(); }, // copy — callers can't mutate the backing array
    get size() { return records.length; },
  };
}

/**
 * Append a scorecard to a brief-records store (append-only). NEVER deletes; the future "Done" folder is
 * built by accreting these records. Soft-fails to false if the store can't accept the record.
 *
 * @param {object} scorecard  a scoreBrief() result
 * @param {{store?:object, now?:()=>number}} opts  store.append(rec) is the only required method
 * @returns {{ ok:boolean, record?:object, size?:number }}
 */
export function recordScorecard(scorecard, { store, now } = {}) {
  if (!scorecard || typeof scorecard !== 'object') return { ok: false };
  if (!store || typeof store.append !== 'function') return { ok: false };
  const recordedAt = scorecard.ts || (typeof now === 'function' ? new Date(now()).toISOString() : null);
  const record = { ...scorecard, recordedAt };
  try {
    store.append(record);
    const size = typeof store.size === 'number' ? store.size
      : (typeof store.list === 'function' ? store.list().length : undefined);
    return { ok: true, record, size };
  } catch {
    return { ok: false };
  }
}

// ── portfolio rollup ────────────────────────────────────────────────────────────────────────────────
/**
 * Roll many scorecards into a portfolio view the AIs reflect on: average completion %, total counts per
 * bucket, and the standouts — the brief with the most IGNORED lines and the one with the most
 * HALLUCINATION lines (so the AIs know where to improve first). Pure, never throws.
 *
 * @param {Array} scorecards
 * @returns {{ count, avgCompletedPct, avgQuality,
 *   buckets:{completed,leftUndone,ignored,unrelated,hallucination},
 *   worstIgnored:{id,count}|null, mostHallucinated:{id,count}|null }}
 */
export function rollup(scorecards = []) {
  const list = Array.isArray(scorecards) ? scorecards.filter((s) => s && typeof s === 'object') : [];
  const buckets = { completed: 0, leftUndone: 0, ignored: 0, unrelated: 0, hallucination: 0 };
  let pctSum = 0;
  let qSum = 0;
  let worstIgnored = null;
  let mostHallucinated = null;

  for (const s of list) {
    const b = s.buckets || {};
    buckets.completed += b.completed || 0;
    buckets.leftUndone += b.leftUndone || 0;
    buckets.ignored += b.ignored || 0;
    buckets.unrelated += b.unrelated || 0;
    buckets.hallucination += b.hallucination || 0;
    pctSum += Number(s.completedPct) || 0;
    qSum += Number(s.quality) || 0;

    const ig = b.ignored || 0;
    if (ig > 0 && (!worstIgnored || ig > worstIgnored.count)) worstIgnored = { id: str(s.id), count: ig };
    const ha = b.hallucination || 0;
    if (ha > 0 && (!mostHallucinated || ha > mostHallucinated.count)) mostHallucinated = { id: str(s.id), count: ha };
  }

  const n = list.length || 1;
  return {
    count: list.length,
    avgCompletedPct: round2(pctSum / n),
    avgQuality: round2(qSum / n),
    buckets,
    worstIgnored,
    mostHallucinated,
  };
}

// ── render ──────────────────────────────────────────────────────────────────────────────────────────
const BUCKET_LABEL = {
  [BUCKETS.COMPLETED]: 'completed',
  [BUCKETS.LEFT_UNDONE]: 'left undone',
  [BUCKETS.IGNORED]: 'ignored',
  [BUCKETS.UNRELATED]: 'unrelated',
  [BUCKETS.HALLUCINATION]: 'hallucination',
};

/**
 * Render a scorecard as markdown — a ✓/✗/~ mark per line, the % completed headline, and the per-bucket
 * summary. This is the "Done folder with checkmarks/Xs" surface. Pure, never throws.
 * @param {object} scorecard  a scoreBrief() result
 * @returns {string}
 */
export function renderScorecard(scorecard) {
  const s = scorecard || {};
  const b = s.buckets || { completed: 0, leftUndone: 0, ignored: 0, unrelated: 0, hallucination: 0 };
  const L = [];
  L.push(`### Brief scorecard — ${str(s.id) || 'brief'}`);
  L.push(`**${Number(s.completedPct) || 0}% completed** · ${s.total || 0} item(s)`
    + (s.quality != null ? ` · quality ${s.quality}` : ''));
  L.push('');
  L.push('**Items:**');
  if (Array.isArray(s.items) && s.items.length) {
    for (const it of s.items) {
      const sub = it.subflag ? ` (${it.subflag})` : '';
      L.push(`- ${it.mark || '~'} _[${BUCKET_LABEL[it.bucket] || it.bucket || 'unknown'}${sub}]_ ${str(it.text)}`);
    }
  } else {
    L.push('- _No items in this brief._');
  }
  L.push('');
  L.push('**Buckets:** '
    + `✓ completed ${b.completed || 0} · `
    + `✗ left-undone ${b.leftUndone || 0} · `
    + `ignored ${b.ignored || 0} · `
    + `unrelated ${b.unrelated || 0} · `
    + `hallucination ${b.hallucination || 0}`);
  L.push('');
  L.push('*Scored read-only by brief-scorecard.mjs · append-only records (no brief is ever deleted).*');
  return L.join('\n');
}

export default {
  BUCKETS,
  HALLUCINATION_SUBFLAG_REPO,
  briefLines,
  classifyItem,
  scoreBrief,
  createScorecardStore,
  recordScorecard,
  rollup,
  renderScorecard,
};

// ── CLI (guarded, offline demo) ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('brief-scorecard.mjs')) {
  const brief = [
    '- [ ] Wire the Discord news feed into the !sb command',
    '- [ ] Add a failover price source to the oracle',
    '- [ ] Refactor the watcher to use the new sink interface',
    '- [ ] Add a quantum entanglement module to the chain',   // ignored/unrelated noise
    '- [ ] The repo has a src/quantum/ directory to extend',  // repo-structure hallucination
  ];
  const ctx = {
    confirmedItems: [
      { text: 'Wire the Discord news feed into the !sb command' },
      { text: 'Add a failover price source to the oracle' },
      { text: 'Refactor the watcher to use the new sink interface' },
    ],
    doneItems: [
      { text: 'Wire the Discord news feed into the !sb command' },
      { text: 'Add a failover price source to the oracle' },
    ],
    repoFlags: [{ text: 'The repo has a src/quantum directory to extend' }],
  };
  const store = createScorecardStore();
  const card = await scoreBrief(brief, ctx);
  recordScorecard(card, { store, now: () => Date.parse('2026-06-04T00:00:00Z') });
  // eslint-disable-next-line no-console
  console.log(renderScorecard(card));
  // eslint-disable-next-line no-console
  console.log('\nrollup:', JSON.stringify(rollup(store.list()), null, 2));
}
