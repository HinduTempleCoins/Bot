// jit-diagnostics.mjs — PER-FILE just-in-time diagnostics (task #224). The per-file COMPLEMENT to the
// 12-and-12 batch (diagnostics-pipeline.mjs), NOT a replacement.
//
// The operator's ask: "a single file passed over by several APIs before the AI looks at it itself."
// Where diagnostics-pipeline.mjs runs ONCE per conference window (~12h) over a market snapshot, this
// module runs at fine granularity (~1/min ceiling per file) on ONE file, RIGHT BEFORE an AI annals it.
// The point is FRESHNESS + RELEVANCE: the per-file pass fires only the readers that matter to THIS
// file and gives data that is newer / different than what the twice-daily batch already captured.
//
//   self-crawl-schedule.mjs   → says WHICH files are due (cadence selector)
//   jit-diagnostics.mjs (THIS)→ for a due file, fires the relevant readers JUST BEFORE annaling it
//   diagnostics-pipeline.mjs  → the batch market-saying-vs-doing digest (reused defensively below)
//
// DESIGN CONTRACT (strict):
//   • ESM .mjs, pure scheduling/selection logic, injectable readers + injectable clock → fully offline.
//   • Soft-fail PER READER: one reader throwing never sinks the others; it returns ok:false with a note.
//   • CLI guarded behind the import.meta check; NO secrets read, no keys, no network of its own.
//   • Results are the AI-readable (annal-writer) tier. Operator-private values must never leak in →
//     redactForAi() strips anything tagged private. (The hard tier boundary lives in
//     integrations/audience-store.mjs — the 'ai' audience can never read the 'operator' tier. This
//     module produces ONLY the 'ai'-tier context block; it must never embed operator-tier material.)
//
//   import { selectReaders, runForFile, shouldFireJIT, annalContext, redactForAi }
//     from './integrations/jit-diagnostics.mjs'
//
//   node integrations/jit-diagnostics.mjs <path>   # demo: select + (soft) run + render context

// Defensive import of the batch pipeline — we REUSE its diagnose/snapshot rather than re-deriving the
// market read, so the per-file pass and the batch agree on shape. Best-effort: if the module is absent
// or fails to load, the JIT pass still works (the chain/he/etc readers are independent of it).
let _batch = null;
try { _batch = await import('./diagnostics-pipeline.mjs'); } catch { _batch = null; }

const MINUTE = 60 * 1000;

// ── per-file rate floor ──────────────────────────────────────────────────────────────────────────
// The operator's "~1/min granularity": a given file may be JIT-diagnosed at most once per this window,
// so a hot file being annaled repeatedly doesn't hammer the readers. Distinct from the batch cadence.
export const JIT_MIN_INTERVAL_MS = 1 * MINUTE;

// If the 12-and-12 batch covered this file very recently, a JIT pass adds little fresh info; only fire
// JIT if the batch is older than this (i.e. JIT exists to be FRESHER than the last batch).
export const BATCH_FRESH_WINDOW_MS = 30 * MINUTE;

// ── reader registry (ids only — the actual reader fns are INJECTED) ──────────────────────────────
// A "reader" is one tool/API that can say something about a file: id → relevance heuristic. The fns
// are supplied by the caller (so this stays offline + secret-free); here we only know which to ASK.
export const READERS = {
  // chain-side readers — fire for chain-client / witness / persona / voting files.
  chain: { label: 'MELEK chain (steemd) — account/witness/props state', match: (p) => /(^|\/)(witness|voting_rules)\/|(^|\/)src\/chain\/|hathor|graphene|keys\.(js|mjs)/i.test(p) },
  // soapbox vertical readers — fire for the soapbox/data-aggregator code + its data files.
  soapbox: { label: 'SoapBox aggregator — clarity/price/markets for this vertical', match: (p) => /(^|\/)integrations\/soapbox\/|soapbox|aggregator|data\/resource-center/i.test(p) },
  // hive-engine market reader — fire for trade / HE / market files.
  hiveEngine: { label: 'Hive-Engine — live market depth/movers for traded symbols', match: (p) => /(^|\/)(trade|market|arb|cex|copy-trade|profit)|he-(client|ingest)|hive-engine/i.test(p) },
  // trade-bot forensics reader — fire for trade-bot/forensics files (read-only history).
  forensics: { label: 'Trade-bot forensics — on-chain history for the bot account', match: (p) => /tradebot|forensic|trade-(analyzer|grant|proposer|sanitizer)/i.test(p) },
  // batch-diagnostics reader — the reused market saying-vs-doing read; relevant to market/trade/soapbox.
  batch: { label: 'Batch diagnostics (reused) — current market saying-vs-doing read', match: (p) => /(^|\/)(trade|market|arb|cex|copy-trade|profit)|soapbox|resource-center|comms-parser|diagnostics/i.test(p) },
  // git/mtime reader — applies to EVERY file: when did it last change, who/what touches it.
  churn: { label: 'File churn — recent mtime / change recency for this file', match: () => true },
  // corpus/scripture reader — fire for knowledge corpus files (citations, cross-refs).
  corpus: { label: 'Corpus cross-ref — related scripture/knowledge for this doc', match: (p) => /(^|\/)knowledge\/|(^|\/)(LINEAGE|CHARACTER|RULE_1)\.md$|scripture/i.test(p) },
};

/**
 * Select which diagnostic readers are RELEVANT to a single file, by path heuristic. Deterministic,
 * pure. Always includes the universal 'churn' reader so every file gets at least one read.
 * @param {string} filePath
 * @returns {string[]} reader ids (stable order, matching READERS key order)
 */
export function selectReaders(filePath) {
  const p = String(filePath || '');
  if (!p) return ['churn'];
  const ids = Object.keys(READERS).filter((id) => {
    try { return !!READERS[id].match(p); } catch { return false; }
  });
  return ids.length ? ids : ['churn'];
}

// Coerce a timestamp (ms | ISO string | Date) to ms, or null. Mirrors the batch/scheduler helper.
function toMs(t) {
  if (t == null) return null;
  if (typeof t === 'number') return Number.isFinite(t) ? t : null;
  if (t instanceof Date) { const v = t.getTime(); return Number.isFinite(v) ? v : null; }
  const v = Date.parse(String(t));
  return Number.isFinite(v) ? v : null;
}

/**
 * Decide whether a JIT pass would ADD VALUE for this file right now:
 *   • refuse a refire within JIT_MIN_INTERVAL_MS of the last JIT pass (the ~1/min-per-file floor);
 *   • otherwise fire if the file hasn't had a recent batch (batch older than BATCH_FRESH_WINDOW_MS,
 *     or no batch at all) — JIT exists to be FRESHER than the batch.
 *
 * @param {string} filePath
 * @param {{ lastBatchAt?:any, lastJitAt?:any, now?:number, minIntervalMs?:number, batchFreshMs?:number }} [opts]
 * @returns {{ fire:boolean, reason:string }}
 */
export function shouldFireJIT(filePath, {
  lastBatchAt = null, lastJitAt = null, now = Date.now(),
  minIntervalMs = JIT_MIN_INTERVAL_MS, batchFreshMs = BATCH_FRESH_WINDOW_MS,
} = {}) {
  const p = String(filePath || '');
  if (!p) return { fire: false, reason: 'no path' };

  // 1) rate floor — never refire the same file faster than the per-file minimum interval.
  const lastJit = toMs(lastJitAt);
  if (lastJit != null && now - lastJit < minIntervalMs) {
    return { fire: false, reason: `rate-floor: last JIT ${Math.round((now - lastJit) / 1000)}s ago (< ${Math.round(minIntervalMs / 1000)}s floor)` };
  }

  // 2) freshness vs batch — if the batch is recent, JIT adds little; skip.
  const lastBatch = toMs(lastBatchAt);
  if (lastBatch != null && now - lastBatch < batchFreshMs) {
    return { fire: false, reason: `batch is fresh (${Math.round((now - lastBatch) / 60000)}m ago) — JIT redundant` };
  }

  return { fire: true, reason: lastBatch == null ? 'no recent batch — JIT provides the only fresh read' : 'batch is stale — JIT provides a fresher per-file read' };
}

// Normalize one reader's raw return into a uniform result record. A reader may return a string, an
// object { summary, data }, or anything truthy; we coerce so the annal block is consistent.
function normalizeResult(id, raw) {
  if (raw == null) return { reader: id, ok: true, summary: '(no data)', data: null };
  if (typeof raw === 'string') return { reader: id, ok: true, summary: raw, data: null };
  if (typeof raw === 'object') {
    return {
      reader: id,
      ok: raw.ok !== false,
      summary: typeof raw.summary === 'string' ? raw.summary : JSON.stringify(raw).slice(0, 200),
      data: 'data' in raw ? raw.data : null,
    };
  }
  return { reader: id, ok: true, summary: String(raw), data: null };
}

/**
 * Fire the selected readers for ONE file and collect their results. Per-reader SOFT-FAIL: a reader
 * that throws (or rejects) yields { ok:false } with the error note; the rest still run.
 *
 * Readers are INJECTED via `readers` — a map { id: async (filePath, ctx) => result }. Any selected id
 * with no injected fn is reported ok:false ('no reader wired') rather than silently dropped. The
 * reused batch reader, when injected as `readers.batch` OR left to default, pulls the batch pipeline's
 * diagnose() so the per-file pass reuses (does not duplicate) the market read.
 *
 * @param {string} filePath
 * @param {{ readers?:Record<string,Function>, ids?:string[], now?:number, ctx?:object }} [opts]
 * @returns {Promise<{ file:string, ranAt:string, ids:string[], results:Array, freshVsBatch:boolean }>}
 */
export async function runForFile(filePath, { readers = {}, ids = null, now = Date.now(), ctx = {} } = {}) {
  const file = String(filePath || '');
  const selected = Array.isArray(ids) && ids.length ? ids : selectReaders(file);
  const ranAt = new Date(now).toISOString();

  // Default 'batch' reader reuses the imported pipeline's diagnose() — no duplication of that logic.
  const defaultBatchReader = async () => {
    if (!_batch || typeof _batch.diagnose !== 'function') return { ok: false, summary: 'batch pipeline unavailable' };
    const snap = (typeof _batch.loadSnapshot === 'function') ? await _batch.loadSnapshot().catch(() => null) : null;
    const diag = _batch.diagnose(snap);
    const sigs = (diag.signals || []).length;
    return { ok: true, summary: `batch read: ${sigs} signal(s), ${(diag.suggestedMoves || []).length} advisory move(s)`, data: { signals: sigs, sources: diag.sources } };
  };

  const results = [];
  for (const id of selected) {
    const fn = readers[id] || (id === 'batch' ? defaultBatchReader : null);
    if (typeof fn !== 'function') {
      results.push({ reader: id, ok: false, summary: 'no reader wired (offline / not injected)', data: null });
      continue;
    }
    try {
      const raw = await fn(file, { ...ctx, now, readerId: id });
      results.push(normalizeResult(id, raw));
    } catch (e) {
      // SOFT-FAIL: capture, keep going. One reader down ≠ no diagnostics.
      results.push({ reader: id, ok: false, summary: `reader failed: ${e && e.message ? e.message : String(e)}`, data: null });
    }
  }

  // freshVsBatch: this per-file pass carries fresher info than the batch when caller said so via ctx,
  // or when any non-batch reader returned ok (i.e. we have a live per-file read the batch wouldn't have).
  const freshVsBatch = ctx.freshVsBatch === true || results.some((r) => r.ok && r.reader !== 'batch');

  return { file, ranAt, ids: selected, results, freshVsBatch };
}

// ── AI-tier redaction ──────────────────────────────────────────────────────────────────────────
// Keys that, if a reader ever attaches them, must NOT reach the AI/annal tier. The real boundary is
// audience-store.mjs (tier='operator' is unreadable by the 'ai' audience); this is belt-and-braces so
// a careless reader payload can't smuggle operator-private values into the annal context block.
const PRIVATE_KEY_RE = /(_private$|^private$|wif|secret|password|app[_-]?password|token|apikey|api[_-]?key|owner[_-]?key|active[_-]?key|posting[_-]?key|credential|operatorTier)/i;
const REDACTED = '[redacted:operator-tier]';

function redactValue(v) {
  if (v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(redactValue);
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (PRIVATE_KEY_RE.test(k) || (val && typeof val === 'object' && val.__tier === 'operator')) {
      out[k] = REDACTED;
    } else {
      out[k] = redactValue(val);
    }
  }
  return out;
}

/**
 * Strip any operator-private-tagged field from reader results so the AI-tier context can never leak
 * operator material. Returns a NEW array (pure — does not mutate input). Redacts: keys matching the
 * private pattern (wif/secret/password/token/owner|active|posting key/credential/_private/operatorTier)
 * and any nested object explicitly tagged { __tier:'operator' }.
 *
 * @param {Array} results
 * @returns {Array} redacted copy
 */
export function redactForAi(results) {
  const list = Array.isArray(results) ? results : [];
  return list.map((r) => {
    if (!r || typeof r !== 'object') return r;
    return { ...r, data: redactValue(r.data) };
  });
}

/**
 * Build the annal-ready markdown context block the AI reads BEFORE writing — "what several tools see
 * about THIS file." Combines the JIT run's per-reader results (redacted to the AI tier). Pure given a
 * pre-computed run, OR it will run the file itself if given deps with readers. Never throws.
 *
 * @param {string} filePath
 * @param {{ run?:object, readers?:Record<string,Function>, now?:number, ctx?:object }} [deps]
 * @returns {Promise<string>} markdown block
 */
export async function annalContext(filePath, deps = {}) {
  const file = String(filePath || '');
  let run = deps.run;
  if (!run) {
    run = await runForFile(file, { readers: deps.readers || {}, now: deps.now, ctx: deps.ctx || {} }).catch(() => null);
  }
  if (!run) return `### JIT diagnostics — ${file || '(unknown file)'}\n_No per-file diagnostics this pass._`;

  const safe = redactForAi(run.results || []);
  const L = [];
  L.push(`### JIT diagnostics — \`${run.file}\``);
  L.push(`*What several tools see about THIS file, fired just before annaling it (per-file complement to the 12-and-12 batch). AI-tier context — operator-private values redacted. Ran ${run.ranAt}.*`);
  L.push('');
  L.push(`**Readers consulted** (${safe.length}): ${run.ids.join(', ')}`);
  L.push(`**Fresher than last batch:** ${run.freshVsBatch ? 'yes' : 'no'}`);
  L.push('');
  for (const r of safe) {
    const mark = r.ok ? '✓' : '✗';
    const label = (READERS[r.reader] && READERS[r.reader].label) || r.reader;
    L.push(`- ${mark} **${r.reader}** (${label}) — ${r.summary}`);
  }
  L.push('');
  L.push(`*Engine: jit-diagnostics.mjs · per-file · advisory · no keys/network of its own · reuses diagnostics-pipeline.mjs.*`);
  return L.join('\n');
}

export default {
  JIT_MIN_INTERVAL_MS, BATCH_FRESH_WINDOW_MS, READERS,
  selectReaders, runForFile, shouldFireJIT, annalContext, redactForAi,
};

// ── CLI (guarded) ──────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('jit-diagnostics.mjs')) {
  const file = process.argv[2] || 'integrations/diagnostics-pipeline.mjs';
  const decision = shouldFireJIT(file, { lastBatchAt: null, lastJitAt: null });
  console.log(`JIT diagnostics — single file: ${file}`);
  console.log(`should fire? ${decision.fire ? 'YES' : 'no'} — ${decision.reason}\n`);
  console.log(`selected readers: ${selectReaders(file).join(', ')}\n`);
  // Demo run with NO injected readers (offline) — every reader soft-fails to 'no reader wired',
  // except 'batch' which reuses the pipeline if present. Shows the soft-fail floor + redaction.
  const block = await annalContext(file, {});
  console.log(block);
}
