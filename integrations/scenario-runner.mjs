// scenario-runner.mjs — fires the "what-if" market-scenario bot on a schedule against the tokens
// ANGELICALIST actually holds, records every run, and delivers it into the data->briefs/annals
// pipeline. Operator 2026-06-01: run it every 15 min; randomize the token selection from the
// wallet's holdings, BUT weight it so at least 20% of the daily runs are about VKBT and CURE.
// Read-only (it reasons about capital arrangements; it never trades).
//
//   node integrations/scenario-runner.mjs --once      # one tick now (records + delivers)
//   node integrations/scenario-runner.mjs --cron      # every 15 min (CScenario_CRON)
//   import { pickTokens, runTick } from './scenario-runner.mjs'

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import cron from 'node-cron';
import { scenarios } from './market-scenarios.mjs';
import { tokenBalances } from './angelicalist/internal.mjs';

export const PRIORITY_TOKENS = (process.env.SCENARIO_PRIORITY || 'VKBT,CURE').split(',').map((s) => s.trim());
export const PRIORITY_FLOOR = parseFloat(process.env.SCENARIO_PRIORITY_FLOOR || '0.20'); // ≥20% of daily runs
const CRON = process.env.SCENARIO_CRON || '*/15 * * * *';
const LOG = '.local/scenario-log.jsonl';
const TICK_FILE = '.local/.scenario-tick';

// PURE + testable: choose the token(s) for tick N. Every (1/floor)-th tick forces a priority token
// (guaranteeing the daily floor); other ticks pick weighted-random over holdings (priority tokens
// carry extra weight so they show up more than the floor, never less).
export function pickTokens(tick, holdings, rng = Math.random) {
  const symbols = holdings.map((h) => (typeof h === 'string' ? h : h.symbol));
  if (!symbols.length) return [];
  const forcedEvery = Math.max(1, Math.round(1 / PRIORITY_FLOOR)); // 0.20 -> every 5th tick
  if (tick % forcedEvery === 0) {
    const present = PRIORITY_TOKENS.filter((t) => symbols.includes(t));
    if (present.length) return [present[Math.floor(tick / forcedEvery) % present.length]]; // alternate VKBT/CURE
  }
  const pool = [];
  for (const s of symbols) { pool.push(s); if (PRIORITY_TOKENS.includes(s)) pool.push(s); } // 2x weight
  return [pool[Math.floor(rng() * pool.length)]];
}

function nextTick() {
  let t = 0;
  if (existsSync(TICK_FILE)) t = (parseInt(readFileSync(TICK_FILE, 'utf8'), 10) || 0) + 1;
  mkdirSync('.local', { recursive: true });
  writeFileSync(TICK_FILE, String(t));
  return t;
}

// run one tick: pick tokens from angelicalist's live holdings, generate scenarios, RECORD + stage
// for delivery (publish-feed moves .local/shared/* to the brain inbox so briefs/annals consume it).
export async function runTick({ tick, holdings } = {}) {
  const held = holdings || (await tokenBalances().catch(() => []));
  const tradeable = held.filter((h) => (h.balance || 0) > 0).map((h) => h.symbol);
  const t = tick ?? nextTick();
  const picked = pickTokens(t, tradeable);
  const isPriority = picked.some((s) => PRIORITY_TOKENS.includes(s));
  let result = { picked, n: 0 };
  if (picked.length) {
    const out = await scenarios(picked, { n: 8, seed: t }).catch((e) => ({ error: e.message }));
    result = { picked, isPriority, scenarios: out };
  }
  // record (append-only) — the DATA the operator wants captured
  mkdirSync('.local', { recursive: true });
  const entry = { tick: t, at: new Date().toISOString(), picked, isPriority, holdingsCount: tradeable.length };
  const prior = existsSync(LOG) ? readFileSync(LOG, 'utf8') : '';
  writeFileSync(LOG, prior + JSON.stringify(entry) + '\n');
  return { ...entry, result };
}

if (process.argv[1] && process.argv[1].endsWith('scenario-runner.mjs')) {
  const once = process.argv.includes('--once');
  const cronMode = process.argv.includes('--cron');
  if (cronMode) {
    console.log(`[scenario-runner] scheduling ${CRON} — what-if on angelicalist holdings, ≥${PRIORITY_FLOOR * 100}% VKBT/CURE`);
    cron.schedule(CRON, () => runTick().then((r) => console.log(`  tick ${r.tick}: ${r.picked.join(',')}${r.isPriority ? ' (priority)' : ''}`)).catch((e) => console.error('  tick failed:', e.message)));
    await runTick().then((r) => console.log(`  tick ${r.tick}: ${r.picked.join(',')}`));
  } else if (once) {
    const r = await runTick();
    console.log(`tick ${r.tick}: picked ${r.picked.join(',')}${r.isPriority ? ' (priority VKBT/CURE)' : ''} from ${r.holdingsCount} holdings`);
    console.log(`recorded -> ${LOG}  (publish-feed delivers the scenarios to the brain)`);
  } else {
    console.log('usage: --once | --cron');
  }
}
