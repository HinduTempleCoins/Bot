// relevant.mjs — pick the FEW most relevant annals/briefs for a topic, so the writers don't drown
// in the whole pile. Operator 2026-06-01: use the grader/percentiles, but don't give them too much
// to look at — relevant briefs only. Ranks by topic-match (the categorizer) x recency, with an
// optional grader score (from a .score sidecar if the auto-grader wrote one). Returns a small set.
//
//   node tools/relevant.mjs <dir> <topic> [limit]
//   import { selectRelevant, scoreRelevance } from './relevant.mjs'

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { classify, TOPICS } from './categorize.mjs';

// recency weight: newer = closer to 1. Half-life ~7 days. `nowMs`/`mtimeMs` injected for tests.
function recencyWeight(mtimeMs, nowMs) {
  const ageDays = Math.max(0, (nowMs - mtimeMs) / 86400000);
  return Math.pow(0.5, ageDays / 7);
}

// optional grader score: a sibling file "<name>.score" containing a 0..1 number (the auto-grader's
// percentile). Absent -> neutral 0.5 so ungraded items aren't unfairly buried.
function graderScore(path) {
  const p = path + '.score';
  if (!existsSync(p)) return 0.5;
  const n = parseFloat(readFileSync(p, 'utf8'));
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
}

/**
 * Score one item for a topic. relevance = topicMatch(0..1) x recency x grader. topicMatch is the
 * classifier's keyword hits for the requested topic, normalized. Pure given (content, topic, weights).
 */
export function scoreRelevance(content, topic, { recency = 1, grader = 0.5 } = {}) {
  const scores = classify(content).scores;
  const hits = scores[topic] || 0;
  // normalize against the strongest topic so a long doc doesn't always win
  const maxHits = Math.max(1, ...Object.values(scores));
  const topicMatch = hits / maxHits;
  return { score: +(topicMatch * recency * grader).toFixed(4), topicMatch: +topicMatch.toFixed(3), recency: +recency.toFixed(3), grader };
}

/** Rank the .md files in dir for a topic; return the top `limit`, most-relevant first. */
export function selectRelevant(dir, { topic, limit = 8, nowMs } = {}) {
  if (!TOPICS[topic]) throw new Error(`unknown topic "${topic}" (one of: ${Object.keys(TOPICS).join(', ')})`);
  const now = nowMs || Date.now();
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  const ranked = files.map((f) => {
    const path = join(dir, f);
    const content = readFileSync(path, 'utf8');
    const r = scoreRelevance(content, topic, { recency: recencyWeight(statSync(path).mtimeMs, now), grader: graderScore(path) });
    return { file: f, ...r };
  }).filter((r) => r.topicMatch > 0).sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}

if (process.argv[1] && process.argv[1].endsWith('relevant.mjs')) {
  const [dir, topic, limit] = process.argv.slice(2);
  if (!dir || !topic) { console.error(`usage: relevant.mjs <dir> <topic> [limit]\n  topics: ${Object.keys(TOPICS).join(', ')}`); process.exit(1); }
  const picks = selectRelevant(dir, { topic, limit: +(limit || 8) });
  console.log(`Top ${picks.length} "${topic}" items in ${dir} (relevance = topic-match x recency x grade):`);
  for (const p of picks) console.log(`  ${p.score}  ${p.file}  (match ${p.topicMatch}, recency ${p.recency}, grade ${p.grader})`);
}
