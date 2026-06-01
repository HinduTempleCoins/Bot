// bot-data.mjs — the UNIVERSAL data-collection method every bot attaches to. Operator 2026-06-01:
// "all the bots need some kind of data collection method attached — a schedule or a log they output
// — that gets fed into the annals and briefs so we can see what's going on." This is that method:
// one call per run writes (1) an append-only JSONL log (the raw record) and (2) a human/AI-readable
// markdown into .local/shared/ which publish-feed delivers to the brain for the annal/brief AIs.
//
//   import { emitBotData } from './bot-data.mjs'
//   await emitBotData('wall-bot', { summary: 'placed VKBT buy wall', data: {...} })

import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SHARED = '.local/shared';
const LOGDIR = '.local/bot-data';

/**
 * Record one bot run. `summary` is a one-line human string; `data` is the structured record.
 * `at` is injected (callers pass a timestamp; defaults to now) so it's deterministic in tests.
 * Returns the paths written. Never throws on a bad bot name — it sanitizes it.
 */
export function emitBotData(bot, { summary = '', data = {}, at } = {}) {
  const name = String(bot).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'bot';
  const stamp = at || new Date().toISOString();
  mkdirSync(SHARED, { recursive: true });
  mkdirSync(LOGDIR, { recursive: true });

  // (1) append-only log — the raw data trail for this bot
  const logPath = join(LOGDIR, `${name}.jsonl`);
  const prior = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  writeFileSync(logPath, prior + JSON.stringify({ at: stamp, summary, data }) + '\n');

  // (2) latest-run markdown for the annal/brief AIs (publish-feed delivers .local/shared/*)
  const mdPath = join(SHARED, `bot-${name}.md`);
  const md = [`# ${name} — latest run`, `_${stamp}_`, '', summary || '(no summary)', '', '```json', JSON.stringify(data, null, 2), '```'].join('\n');
  writeFileSync(mdPath, md);

  return { logPath, mdPath };
}

/** Read the last N records a bot logged (for status / the digest). */
export function recentBotData(bot, n = 20) {
  const name = String(bot).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const logPath = join(LOGDIR, `${name}.jsonl`);
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** Which bots have emitted data (by log presence) — a coverage check for "is every bot reporting?" */
export function reportingBots() {
  if (!existsSync(LOGDIR)) return [];
  return readdirSync(LOGDIR).filter((f) => f.endsWith('.jsonl')).map((f) => f.replace(/\.jsonl$/, ''));
}
