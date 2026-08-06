// move-watchdog-run.mjs — the box runner for the MELEK Move payout alarm. Thin: all detection logic
// lives in move-watchdog.mjs (unit-tested); this fetches a snapshot (move fund + recent move_pay ops +
// the off-chain ledger), runs the analyzer against the previous snapshot, persists the new one, and on
// warn/critical routes a message to Telegram. On CRITICAL it can also trip a circuit breaker that PAUSES
// the settle timer (opt-in via MOVE_WATCHDOG_AUTOPAUSE=1) so a drain can't continue while you sleep.
//
//   MELEK_RPC_URL=… MELEK_CHAIN_ID=… <telegram bot token env> TG_ALLOWED_IDS=123,456 \
//     node integrations/games/move-watchdog-run.mjs [--dry]
// (the bot-token env var name is assembled from parts, per house convention, so no literal appears here)
//
// Soft-fail: any fetch/notify error is reported, never thrown. The PRIMARY alarm (fund draining faster
// than ~150/hr) needs only the fund balance + timestamps, so it works even if the move_pay scan misses.

import { analyzeMove, formatAlerts, DEFAULTS } from './move-watchdog.mjs';
import { readEpoch, epochNow } from './move-ledger.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';

const RPC = process.env.MELEK_RPC_URL || 'http://127.0.0.1:18090';
const CHAIN_ID = (process.env.MELEK_CHAIN_ID || '').trim();
const PREFIX = (process.env.MELEK_ADDRESS_PREFIX || process.env.MELEK_PREFIX || 'MELEK').trim();
const ATTESTER = (process.env.MOVE_ATTESTER || process.env.HATHOR_ACCOUNT || 'hathor').trim();
const STATE = process.env.MOVE_WATCHDOG_STATE || join(process.cwd(), 'data', 'move-watchdog-state.json');
// the bot token is a capability: reference only its env-var NAME, assembled from parts so no literal
// credential name appears in the source (matches integrations/telegram-bot.mjs house convention).
const TG_TOKEN = (process.env[['TELEGRAM', 'BOT', 'TOKEN'].join('_')] || '').trim();
const TG_IDS = (process.env.MOVE_WATCHDOG_CHAT_ID || process.env.TG_ALLOWED_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const AUTOPAUSE = process.env.MOVE_WATCHDOG_AUTOPAUSE === '1';
const DRY = process.argv.includes('--dry');
const CFG = {
  ...DEFAULTS, attester: ATTESTER,
  capPerEpoch: Number(process.env.MOVE_CAP || DEFAULTS.capPerEpoch),
  maxWalkerWeightPerEpoch: Number(process.env.MOVE_MAX_WALKER_WEIGHT || DEFAULTS.maxWalkerWeightPerEpoch),
  maxWalkersPerEpoch: Number(process.env.MOVE_MAX_WALKERS || DEFAULTS.maxWalkersPerEpoch),
};

const num = (v) => { const n = Number(String(v ?? '').split(' ')[0]); return Number.isFinite(n) ? n : 0; };
const readJSON = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const writeJSON = (p, o) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} try { writeFileSync(p, JSON.stringify(o)); } catch {} };

async function rpc(client, method, params) { try { return await client.database.call(method, params); } catch { return null; } }

async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_IDS.length) return { ok: false, reason: 'no telegram token/ids' };
  const results = [];
  for (const chat_id of TG_IDS) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id, text, disable_web_page_preview: true }),
      });
      results.push({ chat_id, ok: r.ok });
    } catch (e) { results.push({ chat_id, ok: false, err: String(e.message || e).slice(0, 80) }); }
  }
  return { ok: results.some((r) => r.ok), results };
}

function pauseSettleTimer() {
  return new Promise((res) => execFile('systemctl', ['stop', 'move-settle.timer'], (err) => res(!err)));
}

(async () => {
  let dhive;
  try { dhive = await import('@hiveio/dhive'); } catch { dhive = await import('/opt/melek-bot/repo/node_modules/@hiveio/dhive/lib/index.js'); }
  const { Client } = dhive.default || dhive;
  const client = new Client(RPC, { chainId: CHAIN_ID || undefined, addressPrefix: PREFIX, timeout: 20000 });

  // ── current snapshot ──────────────────────────────────────────────────────────────────────────────
  const rf = await rpc(client, 'get_reward_fund', ['move']);
  const fund = rf ? num(rf.reward_balance) : NaN;
  const gp = await rpc(client, 'get_dynamic_global_properties', []);
  const ts = gp ? Math.floor(Date.parse((gp.time || '') + 'Z') / 1000) || Math.floor(Date.now() / 1000) : Math.floor(Date.now() / 1000);

  // best-effort: recent move_pay ops from the attester's history (may miss under producer_reward flood;
  // the fund-drain canary does NOT depend on this)
  const movePays = [];
  const hist = await rpc(client, 'get_account_history', [ATTESTER, -1, 1000]);
  if (Array.isArray(hist)) {
    for (const [, he] of hist) {
      const op = he && he.op; if (!Array.isArray(op)) continue;
      if (op[0] === 'custom_json' && op[1] && op[1].id === 'move_pay') {
        try { const j = JSON.parse(op[1].json); if (j && j.pay) movePays.push({ epoch: Number(j.epoch), pay: j.pay, ts: Math.floor(Date.parse((he.timestamp || '') + 'Z') / 1000) }); } catch {}
      }
    }
  }
  // off-chain ledger: the last few epochs' weights
  const ledger = {};
  for (let e = epochNow() - 3; e <= epochNow(); e++) {
    const rec = readEpoch(e);
    if (rec && rec.claims && rec.claims.length) ledger[e] = Object.fromEntries(rec.claims.map((c) => [c.player, c.weight]));
  }
  const lastEpoch = movePays.reduce((m, p) => Math.max(m, p.epoch || 0), 0) || epochNow();

  const prev = readJSON(STATE, null);
  // only count the move_pays that happened SINCE the last snapshot for the burst/concentration checks
  const windowPays = prev && prev.ts ? movePays.filter((p) => (p.ts || ts) > prev.ts) : movePays;
  const current = { fund, epoch: lastEpoch, ts, movePays: windowPays, ledger };

  const result = analyzeMove(current, prev, CFG);
  writeJSON(STATE, { fund, epoch: lastEpoch, ts });   // persist for the next run

  const line = `[${new Date().toISOString()}] move-watchdog ${result.level} — fund ${Number.isFinite(fund) ? fund.toFixed(0) : '?'} MELEK, ${windowPays.length} recent move_pay, ${Object.keys(ledger).length} live ledger epoch(s)`;
  console.log(line);
  if (result.ok) { process.exit(0); }

  const msg = formatAlerts(result, { fund });
  console.log(msg);
  if (DRY) { console.log('(--dry: not sending)'); process.exit(0); }

  const sent = await sendTelegram(msg);
  console.log('telegram:', JSON.stringify(sent));
  if (result.level === 'critical' && AUTOPAUSE) {
    const paused = await pauseSettleTimer();
    console.log('circuit breaker — move-settle.timer stop:', paused ? 'PAUSED' : 'failed');
    if (paused) await sendTelegram('🛑 Move settle timer PAUSED by the watchdog circuit breaker. Investigate before re-enabling.');
  }
  process.exit(result.level === 'critical' ? 2 : 1);
})();
