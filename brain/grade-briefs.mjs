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

const BRIEFS = process.env.BRIEFS_DIR || '/var/melek-bot/briefs';
const ASKS = process.env.ASKS_FILE || '/var/melek-bot/reconciliation/operator-asks.md';
const OUT = process.env.SCORECARD_FILE || '/var/melek-bot/brief-records/scorecards.jsonl';
const ROLLUP = process.env.ROLLUP_FILE || '/var/melek-bot/brief-records/rollup.md';
const LIMIT = +(process.env.GRADE_LIMIT || 40);

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

export async function gradeAll({ briefsDir = BRIEFS, asksFile = ASKS, out = OUT, rollupFile = ROLLUP, limit = LIMIT } = {}) {
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
  let skipped = 0;

  for (const f of files) {
    let body = '';
    try { body = readFileSync(join(briefsDir, f), 'utf8'); } catch { continue; }
    const id = basename(f, '.md');
    if (seen.has(id)) { skipped++; continue; }
    const card = await scoreBrief(body, { ...ctx, id });
    card.id = card.id || id;
    recordScorecard(card, { store });
    scored.push(card);
  }

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
  return { ok: true, graded: all.length, skipped, rollup: summary };
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const r = await gradeAll();
  if (!r.ok) { console.error(`[grade-briefs] ${r.reason}`); process.exit(1); }
  console.log(`[grade-briefs] graded ${r.graded}, skipped ${r.skipped} already done`);
  if (r.rollup) console.log(JSON.stringify(r.rollup, null, 2));
}
