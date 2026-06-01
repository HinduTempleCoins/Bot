// grade-regression.mjs — flag when a rewrite scores WORSE than what it replaced. This is the
// code-level guard for the operator's central complaint: Claude overriding good work with worse
// work. Every time an annal/brief/doc is graded, record the score; when it's graded again, if the
// new score dropped by more than a threshold, raise a regression so the worse version is caught
// before it ships (promptfoo-style regression tracking).
//
//   import { recordGrade, checkRegression } from './grade-regression.mjs'
//   node tools/grade-regression.mjs <id> <newScore>   # check + record one grade

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';

const HISTORY = '.local/grade-history.jsonl';
const REGRESSION_DROP = parseFloat(process.env.GRADE_REGRESSION_DROP || '0.1'); // a >0.1 drop is a regression

function loadHistory(path = HISTORY) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** Most recent recorded grade for an id, or null. */
export function lastGrade(id, history) {
  const h = history || loadHistory();
  const mine = h.filter((g) => g.id === id);
  return mine.length ? mine[mine.length - 1] : null;
}

/**
 * PURE: did this new score regress vs the prior one? Returns { regressed, drop, prior, ... }.
 * `at` is injected for determinism in tests.
 */
export function checkRegression(id, newScore, history, { drop = REGRESSION_DROP } = {}) {
  const prev = lastGrade(id, history);
  if (!prev) return { id, newScore, prior: null, regressed: false, reason: 'first grade — nothing to compare' };
  const delta = +(newScore - prev.score).toFixed(4);
  const regressed = delta < -drop;
  return { id, newScore, prior: prev.score, delta, regressed, reason: regressed ? `dropped ${(-delta).toFixed(3)} (> ${drop}) vs the prior version — likely overwrote better work` : 'no regression' };
}

/** Record a grade (append-only) after checking. Returns the regression verdict. */
export function recordGrade(id, score, { at, path = HISTORY } = {}) {
  const history = loadHistory(path);
  const verdict = checkRegression(id, score, history);
  mkdirSync('.local', { recursive: true });
  const prior = existsSync(path) ? readFileSync(path, 'utf8') : '';
  writeFileSync(path, prior + JSON.stringify({ id, score, at: at || new Date().toISOString(), regressed: verdict.regressed }) + '\n');
  return verdict;
}

if (process.argv[1] && process.argv[1].endsWith('grade-regression.mjs')) {
  const [id, score] = process.argv.slice(2);
  if (!id || score === undefined) { console.error('usage: grade-regression.mjs <id> <newScore 0..1>'); process.exit(1); }
  const v = recordGrade(id, parseFloat(score));
  console.log(v.regressed ? `🚩 REGRESSION on ${id}: ${v.reason}` : `✓ ${id}: ${v.reason} (now ${v.newScore}${v.prior != null ? `, was ${v.prior}` : ''})`);
}
