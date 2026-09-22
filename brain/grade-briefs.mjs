// grade-briefs.mjs — run the brief grader over the briefs the brain has actually written.
//
// integrations/brief-scorecard.mjs was built to the operator's spec (task #225) and then called from
// nothing but its own test. This is the runner that puts it to work: it reads the real briefs off the
// brain's store, scores each one, appends the result to a durable append-only file, and prints the
// portfolio rollup — avg completion, worst-ignored, most-hallucinated.
//
// WHAT "GRADED" MEANS HERE, because a done/not-done tick is not the ask: every line of a brief lands
// in one of five buckets — completed, left-undone, ignored (never even discussed), unrelated (noise
// the brief carried), or hallucination (a claim that did not hold up). The grade is how the brief
// performed as a brief, not whether the work got done.
//
// EVIDENCE COMES FROM THE OPERATOR'S OWN WORDS. The scorer needs to know what was confirmed and what
// was done, and the honest source for that is the washed transcript: reconcile.mjs has already mined
// the operator's verbatim asks out of it. A brief line that turns up in the asks was discussed; one
// that never appears anywhere was ignored. That is the same evidence a person would use.
//
// APPEND-ONLY, ALWAYS. The module's own contract is that a brief is never deleted — the "Done" folder
// is built by accretion. This runner only ever appends.
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { scoreBrief, recordScorecard, rollup } from '../integrations/brief-scorecard.mjs';
// PRIVACY: briefs carry FOR-RYAN + transcript-derived (MoM) content — PRIVATE. Any LLM scoring must
// run on OUR compute (Modal), never an external API. The deterministic path below needs no model at
// all, so records are still populated (fully offline) when Modal is cold/unset.
import { askModalJson as defaultAskModalJson } from '../integrations/modal-client.mjs';

// Data root comes from the box env (MELEK_DATA_DIR, set in the service unit — see deploy notes);
// no server path is hard-coded in the public repo (pre-commit hook / private-by-default rule).
const DATA = process.env.MELEK_DATA_DIR || '';
const BRIEFS = process.env.BRIEFS_DIR || `${DATA}/briefs`;
const ASKS = process.env.ASKS_FILE || `${DATA}/reconciliation/operator-asks.md`;
const OUT = process.env.SCORECARD_FILE || `${DATA}/brief-records/scorecards.jsonl`;
const ROLLUP = process.env.ROLLUP_FILE || `${DATA}/brief-records/rollup.md`;
const RECORDS = process.env.BRIEF_RECORDS_DIR || `${DATA}/brief-records`;
const LIMIT = +(process.env.GRADE_LIMIT || 40);
// how many historical unassessed per-brief records to back-fill deterministically per run (drains the
// null-record backlog over successive runs without ever calling Modal for the whole history).
const BACKFILL = +(process.env.RECORD_BACKFILL || 250);

const HALL_TIERS = new Set(['none', 'mistaken-structure-corrected', 'absolute-hallucination']);
const pctOf = (n, total) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

/** A file-backed store with the one method recordScorecard requires. Append-only by construction. */
export function fileStore(path) {
  let n = 0;
  try { n = readFileSync(path, 'utf8').split('\n').filter(Boolean).length; } catch {}
  return {
    append(rec) { appendFileSync(path, JSON.stringify(rec) + '\n'); n++; return rec; },
    get size() { return n; },
  };
}

/** Scorecards already written, so a re-run grades only what is new. */
export function alreadyGraded(path) {
  const seen = new Set();
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); if (r.id) seen.add(r.id); } catch {}
    }
  } catch {}
  return seen;
}

/**
 * Turn the operator's verbatim asks into the evidence the scorer wants. Anything he actually raised
 * counts as confirmed; anything he raised in the past tense or with a done-marker counts as done.
 * Crude on purpose — a wrong guess here costs a misgraded line, not a lost brief.
 */
export function evidenceFromAsks(asksText) {
  const lines = String(asksText || '').split('\n').map((l) => l.replace(/^[-*]\s*/, '').trim()).filter((l) => l.length > 12);
  const confirmedItems = lines;
  const doneItems = lines.filter((l) => /\b(done|fixed|shipped|deployed|working|live|resolved|sent|merged|✅|☑)\b/i.test(l));
  return { confirmedItems, doneItems };
}

/**
 * Turn the DETERMINISTIC scorecard (scoreBrief buckets) into the operator's per-brief record shape:
 * pct_completed / pct_undone / pct_ignored / pct_nonsense + hallucination_tier + notes. This is the
 * always-available assessment — it needs no model, so a record is NEVER left null again even offline.
 * (nonsense = the "unrelated" bucket; tier is read off the hallucination items' subflags.)
 */
export function deriveAssessment(card) {
  const total = Number(card && card.total) || 0;
  const b = (card && card.buckets) || {};
  const hall = b.hallucination || 0;
  let tier = 'none';
  if (hall > 0) {
    const hallItems = Array.isArray(card.items) ? card.items.filter((i) => i && i.bucket === 'hallucination') : [];
    const repoOnly = hallItems.length > 0 && hallItems.every((i) => i.subflag === 'repo-structure-mistake');
    tier = repoOnly ? 'mistaken-structure-corrected' : 'absolute-hallucination';
  }
  return {
    pct_completed: pctOf(b.completed || 0, total),
    pct_undone: pctOf(b.leftUndone || 0, total),
    pct_ignored: pctOf(b.ignored || 0, total),
    pct_nonsense: pctOf(b.unrelated || 0, total),
    hallucination_tier: tier,
    notes: `deterministic: ${b.completed || 0} done / ${b.leftUndone || 0} undone / ${b.ignored || 0} ignored / ${b.unrelated || 0} unrelated / ${hall} hallucinated of ${total} lines`,
    source: 'deterministic',
  };
}

/** Validate + clamp a Modal JSON assessment. Returns null when nothing usable came back. */
export function coerceModalAssessment(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 10) / 10)) : null; };
  const pc = num(obj.pct_completed), pu = num(obj.pct_undone), pi = num(obj.pct_ignored), pn = num(obj.pct_nonsense);
  if (pc == null && pu == null && pi == null && pn == null) return null; // no numbers → unusable
  let tier = String(obj.hallucination_tier || 'none').trim();
  if (!HALL_TIERS.has(tier)) tier = 'none';
  return {
    pct_completed: pc ?? 0, pct_undone: pu ?? 0, pct_ignored: pi ?? 0, pct_nonsense: pn ?? 0,
    hallucination_tier: tier,
    notes: String(obj.notes || '').slice(0, 800),
    source: 'modal',
  };
}

/**
 * Ask OUR Modal model (private compute — never an external API) to grade a brief, using the operator's
 * own words as evidence. Returns a coerced assessment, or null on any failure (soft-fail → caller
 * derives deterministically instead, so the record is still populated).
 */
export async function assessViaModal(briefBody, { confirmedItems = [], doneItems = [] } = {}, deps = {}) {
  const ask = deps.askModalJson || defaultAskModalJson;
  const prompt = [
    'You are grading a resident-AI BRIEF for the MELEK project. Classify the brief as PERCENTAGES of its action items across four buckets, using the operator-evidence provided:',
    '- completed: confirmed by the operator AND done.',
    '- undone: valid/discussed but not done.',
    '- ignored: never discussed anywhere.',
    '- nonsense: unrelated / not about anything real.',
    'Also judge hallucination_tier: "none", "mistaken-structure-corrected" (a wrong claim about the repo that was corrected), or "absolute-hallucination" (a fabricated claim).',
    'Return ONLY JSON, no prose: {"pct_completed":N,"pct_undone":N,"pct_ignored":N,"pct_nonsense":N,"hallucination_tier":"none|mistaken-structure-corrected|absolute-hallucination","notes":"one plain-English sentence"}. The four percentages should sum to about 100.',
  ].join('\n');
  const context = [
    { path: 'brief', text: String(briefBody || '').slice(0, 12000) },
    { path: 'operator-confirmed', text: (confirmedItems || []).map((i) => `- ${i && i.text != null ? i.text : i}`).join('\n').slice(0, 4000) },
    { path: 'operator-done', text: (doneItems || []).map((i) => `- ${i && i.text != null ? i.text : i}`).join('\n').slice(0, 4000) },
  ];
  let obj = null;
  try { obj = await ask({ system: 'You are the MELEK brief grader. Reply with JSON only.', prompt, context, retries: 1 }); } catch { obj = null; }
  return coerceModalAssessment(obj);
}

/**
 * Merge an assessment into the per-brief record at RECORDS/<id>.json (the brief-records.mjs schema),
 * flipping status off 'unassessed'. This is the write that was never happening — the 3383 null records
 * are populated here. Soft-fails to null if the record can't be written.
 */
export function writeBriefRecord(id, briefFile, assessment, { recordsDir = RECORDS, now = Date.now } = {}) {
  if (!assessment) return null;
  const recPath = join(recordsDir, `${id}.json`);
  let rec = {};
  try { rec = JSON.parse(readFileSync(recPath, 'utf8')); } catch { rec = {}; }
  const status = assessment.pct_completed >= 100 ? 'done' : 'in-progress';
  const merged = {
    ...rec, id, brief: briefFile || rec.brief || `${id}.md`,
    pct_completed: assessment.pct_completed, pct_undone: assessment.pct_undone,
    pct_ignored: assessment.pct_ignored, pct_nonsense: assessment.pct_nonsense,
    hallucination_tier: assessment.hallucination_tier, status,
    notes: assessment.notes, assessed_at: new Date(now()).toISOString(), assessed_by: assessment.source,
  };
  try { writeFileSync(recPath, JSON.stringify(merged, null, 2)); return merged; } catch { return null; }
}

/** True when a per-brief record is missing or still carries the null 'unassessed' skeleton. */
function recordNeedsAssessment(id, recordsDir) {
  try {
    const r = JSON.parse(readFileSync(join(recordsDir, `${id}.json`), 'utf8'));
    return r.status === 'unassessed' || r.pct_completed == null;
  } catch { return true; } // missing record → needs one
}

/**
 * Drain the historical backlog of unassessed per-brief records DETERMINISTICALLY (no model call):
 * score each brief locally and write the pct fields + tier + notes. Bounded per run so the whole
 * history fills over successive runs. Skips ids already handled this run (the Modal-graded window).
 */
export async function backfillRecords({ briefsDir = BRIEFS, recordsDir = RECORDS, ctx = {}, skip = new Set(), limit = BACKFILL, now = Date.now } = {}) {
  if (!existsSync(briefsDir) || limit <= 0) return 0;
  let files = [];
  try { files = readdirSync(briefsDir).filter((f) => f.startsWith('brief-') && f.endsWith('.md')); } catch { return 0; }
  let filled = 0;
  for (const f of files) {
    if (filled >= limit) break;
    const id = basename(f, '.md');
    if (skip.has(id)) continue;
    if (!recordNeedsAssessment(id, recordsDir)) continue;
    let body = '';
    try { body = readFileSync(join(briefsDir, f), 'utf8'); } catch { continue; }
    const card = await scoreBrief(body, { ...ctx, id });
    if (writeBriefRecord(id, f, deriveAssessment(card), { recordsDir, now })) filled++;
  }
  return filled;
}

export async function gradeAll({ briefsDir = BRIEFS, asksFile = ASKS, out = OUT, rollupFile = ROLLUP, recordsDir = RECORDS, limit = LIMIT, backfill = BACKFILL, useModal = true, deps = {}, now = Date.now } = {}) {
  if (!existsSync(briefsDir)) return { ok: false, reason: `no briefs dir at ${briefsDir}` };

  const asks = existsSync(asksFile) ? readFileSync(asksFile, 'utf8') : '';
  const ctx = evidenceFromAsks(asks);

  const files = readdirSync(briefsDir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => ({ f, t: statSync(join(briefsDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(0, limit)
    .map((x) => x.f);

  const seen = alreadyGraded(out);
  const store = fileStore(out);
  const scored = [];
  const assessedIds = new Set();   // per-brief records written this run (skip in backfill)
  let skipped = 0;
  let recordsWritten = 0;
  let modalUsed = 0;

  for (const f of files) {
    let body = '';
    try { body = readFileSync(join(briefsDir, f), 'utf8'); } catch { continue; }
    const id = basename(f, '.md');

    // 1) DETERMINISTIC scorecard (append-only scorecards.jsonl) — grades only what is new.
    if (!seen.has(id)) {
      const card = await scoreBrief(body, { ...ctx, id });
      card.id = card.id || id;
      recordScorecard(card, { store });
      scored.push(card);

      // 2) PER-BRIEF RECORD (the fix for the null-record bug): Modal assessment first, deterministic
      //    fallback so a record is ALWAYS populated (even when Modal is cold/unset). Newest window only.
      let assessment = useModal ? await assessViaModal(body, ctx, deps) : null;
      if (assessment) modalUsed++; else assessment = deriveAssessment(card);
      if (writeBriefRecord(id, f, assessment, { recordsDir, now })) recordsWritten++;
      assessedIds.add(id);
    }
  }

  // 3) BACKFILL the historical unassessed records deterministically (bounded, no model call).
  const backfilled = await backfillRecords({ briefsDir, recordsDir, ctx, skip: assessedIds, limit: backfill, now });

  const all = scored;
  const summary = all.length ? rollup(all) : null;
  if (summary) {
    const lines = [
      `# Brief scorecard rollup — ${new Date().toISOString()}`,
      '',
      `Graded this run: **${all.length}** (skipped ${skipped} already graded)`,
      '',
      '```json',
      JSON.stringify(summary, null, 2),
      '```',
      '',
      '## This run, worst first',
      '',
      ...all.slice().sort((a, b) => (a.completedPct ?? 0) - (b.completedPct ?? 0)).slice(0, 12)
        .map((c) => `- \`${c.id}\` — ${c.completedPct}% completed · ${c.buckets.ignored} ignored · ${c.buckets.hallucination} hallucinated · ${c.total} lines`),
    ];
    try { writeFileSync(rollupFile, lines.join('\n') + '\n'); } catch {}
  }
  return { ok: true, graded: all.length, skipped, recordsWritten, modalUsed, backfilled, rollup: summary };
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const r = await gradeAll();
  if (!r.ok) { console.error(`[grade-briefs] ${r.reason}`); process.exit(1); }
  console.log(`[grade-briefs] scored ${r.graded} (skipped ${r.skipped}); records: ${r.recordsWritten} written (${r.modalUsed} via Modal), ${r.backfilled} back-filled deterministically`);
  if (r.rollup) console.log(JSON.stringify(r.rollup, null, 2));
}
