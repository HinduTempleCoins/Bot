// annal-rank.mjs — recency-priority for annals. Operator rule (2026-06-01): newer annals are
// "probably the best information" on a subject. If only old ones exist, use them; if there's a
// plethora, read newest first, older second — or not at all past a read budget (a token-priority
// set). This is the lightweight ranker the consumers (ai-network / conference / Claude) call so
// they don't burn tokens on stale annals.
//
//   node tools/annal-rank.mjs <annals-dir> [subject] [--budget 8]
//   import { rankAnnals } from './annal-rank.mjs'
//
// "recency" = the newest dated marker in the annal: a `## Edit — <ISO>` block (append-only
// annals carry the latest edit at the bottom), else a timestamp in the filename, else mtime.

import fs from 'node:fs';
import path from 'node:path';

const ISO_RE = /(\d{4}-\d{2}-\d{2}[T_ ]\d{2}[:\-]\d{2}[:\-]\d{2})/g;
function recencyOf(file, body) {
  const marks = [...(body.match(/##\s*Edit\s*—\s*([0-9T:\.\-Z]+)/g) || [])]
    .map(m => Date.parse(m.replace(/.*—\s*/, '')) || 0);
  const fileTs = [...path.basename(file).matchAll(ISO_RE)].map(m => Date.parse(m[1].replace(/_/g, 'T').replace(/-(\d{2})-(\d{2})$/, ':$1:$2')) || 0);
  const best = Math.max(0, ...marks, ...fileTs);
  if (best) return best;
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

// rank annal files in `dir` for `subject` (keyword in name/body), newest-first, capped at budget.
export function rankAnnals(dir, subject = '', { budget = 8, scanBody = true } = {}) {
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => path.join(dir, f)); } catch { return { ranked: [], dropped: 0 }; }
  const kw = subject.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = [];
  for (const f of files) {
    let body = ''; if (scanBody) { try { body = fs.readFileSync(f, 'utf8'); } catch {} }
    const hay = (path.basename(f) + ' ' + body).toLowerCase();
    if (kw.length && !kw.every(k => hay.includes(k))) continue;
    scored.push({ file: path.relative(dir, f), recency: recencyOf(f, body) });
  }
  scored.sort((a, b) => b.recency - a.recency); // newest first
  const ranked = scored.slice(0, budget).map((s, i) => ({ ...s, rank: i + 1, tier: i < Math.ceil(budget / 2) ? 'read-first' : 'read-if-needed', when: s.recency ? new Date(s.recency).toISOString().slice(0, 16) : 'unknown' }));
  return { subject, total: scored.length, ranked, dropped: Math.max(0, scored.length - budget) };
}

// a drop-in prompt rule for the API-AI consumers
export const PRIORITY_RULE =
  'ANNAL RECENCY RULE: when multiple annals cover a subject, read the NEWEST first — newer annals ' +
  'are likely the most accurate. Use older annals only to fill gaps the newer ones leave. If only ' +
  'old annals exist, use them. Past the read budget, skip the oldest entirely.';

if (process.argv[1] && process.argv[1].endsWith('annal-rank.mjs')) {
  const dir = process.argv[2];
  const args = process.argv.slice(3);
  const bi = args.indexOf('--budget');
  const budget = bi >= 0 ? +args[bi + 1] : 8;
  const subject = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] === '--budget')).join(' ');
  if (!dir) { console.error('usage: annal-rank.mjs <annals-dir> [subject] [--budget N]'); process.exit(1); }
  const r = rankAnnals(dir, subject, { budget });
  console.log(`Annal recency priority — subject "${subject || '(all)'}" — ${r.total} match(es), reading top ${r.ranked.length}, ${r.dropped} older skipped\n${'─'.repeat(64)}`);
  for (const a of r.ranked) console.log(`  ${String(a.rank).padStart(2)}. [${a.tier}] ${a.when}  ${a.file}`);
  console.log(`\n${PRIORITY_RULE}`);
}
