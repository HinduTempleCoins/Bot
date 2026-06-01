// categorize.mjs — bucket annals/briefs into TOPIC folders instead of two flat piles.
// Operator 2026-06-01: start organizing annals + briefs into files other than just "Annals" and
// "Briefs", so the writers (and the operator) can pull only the RELEVANT ones. Deterministic
// keyword classifier (no LLM — stable + explainable). Pairs with the relevance filter that then
// reads from a single topic bucket instead of the whole pile.
//
//   node tools/categorize.mjs <dir>            # classify every .md, print topic + count
//   node tools/categorize.mjs <dir> --apply    # move each file into <dir>/<topic>/
//   import { classify, TOPICS } from './categorize.mjs'

import { readdirSync, readFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

// topic -> weighted keywords. First match-richest topic wins; ties break by order here.
export const TOPICS = {
  cheetah:  ['cheetah', 'attribution', 'plagiar', 'credit', 'reverse-image', 'phash', 'whitelist', 'blacklist'],
  trade:    ['trade', 'arbitrage', 'swap.', 'hive-engine', 'angelicalist', 'vkbt', 'cure', 'market', 'bleed', 'sweep', 'order book'],
  hathor:   ['hathor', 'witness', 'rule 1', 'angelic', 'egregore', 'scripture', 'persona', 'voice', 'disposition'],
  soapbox:  ['soapbox', 'aggregator', 'condenser', 'clarity score', 'coingecko', 'coin page', 'prana', 'dapp'],
  chains:   ['multichain', 'evm', 'solana', 'bitcoin', 'litecoin', 'rpc', 'wallet', 'balance', 'portfolio', 'cross-chain'],
  telegram: ['telegram', 'smol', 'captcha', 'bridge', 'receptionist', 'bot token', 'group'],
  briefs:   ['brief', 'annal', 'mom', 'minutes', 'grader', 'percentile', 'citation', 'itinerary', 'recency'],
  infra:    ['server', 'systemd', 'timer', 'gpu', 'qwen', 'ollama', 'vault', 'deploy', 'steward', 'runpod'],
  signer:   ['signer', 'wif', 'key custody', 'kms', 'posting key', 'active key', 'melek-signer'],
};

const TOPIC_ORDER = Object.keys(TOPICS);

/** Classify text into a topic. Returns { topic, score, scores }. Defaults to 'misc' on no signal. */
export function classify(text) {
  const t = String(text || '').toLowerCase();
  const scores = {};
  for (const [topic, words] of Object.entries(TOPICS)) {
    let s = 0;
    for (const w of words) { let i = 0; while ((i = t.indexOf(w, i)) !== -1) { s++; i += w.length; } }
    scores[topic] = s;
  }
  let best = 'misc', bestScore = 0;
  for (const topic of TOPIC_ORDER) { if (scores[topic] > bestScore) { best = topic; bestScore = scores[topic]; } }
  return { topic: best, score: bestScore, scores };
}

/** Classify every .md in dir. With apply=true, move files into dir/<topic>/. */
export function organize(dir, { apply = false } = {}) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.md') && statSync(join(dir, f)).isFile());
  const summary = {};
  for (const f of files) {
    const { topic, score } = classify(readFileSync(join(dir, f), 'utf8'));
    summary[topic] = (summary[topic] || 0) + 1;
    if (apply) {
      const destDir = join(dir, topic);
      mkdirSync(destDir, { recursive: true });
      renameSync(join(dir, f), join(destDir, f));
    }
  }
  return { count: files.length, byTopic: summary };
}

if (process.argv[1] && process.argv[1].endsWith('categorize.mjs')) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: categorize.mjs <dir> [--apply]'); process.exit(1); }
  const apply = process.argv.includes('--apply');
  const { count, byTopic } = organize(dir, { apply });
  console.log(`${apply ? 'Organized' : 'Would organize'} ${count} file(s) in ${dir} by topic:`);
  for (const [t, n] of Object.entries(byTopic).sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(10)} ${n}`);
  if (!apply) console.log('\n(dry-run — re-run with --apply to move files into <dir>/<topic>/)');
}
