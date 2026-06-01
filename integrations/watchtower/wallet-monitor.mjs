// wallet-monitor.mjs — WATCHTOWER: alert the operator the instant value MOVES out of a watched
// account. Read-only, no keys. Built 2026-06-01 because the angelicalist key was publicly leaked,
// so anyone could try to drain it — this watches for exactly that and pages Telegram immediately.
// It also continuously PROVES nothing is being taken: every check that finds no outflow is logged.
//
// Watches HIVE accounts (transfers + HIVE-Engine token sends, the real drain vector) now; EVM/SOL/
// BTC address webhooks are the next tier (see integrations/SECURITY_MONITORING_APIS.md).
//
//   node integrations/watchtower/wallet-monitor.mjs            # one check of the watched accounts
//   node integrations/watchtower/wallet-monitor.mjs --cron     # poll every WATCH_INTERVAL
//   import { detectNewOutflows } from './watchtower/wallet-monitor.mjs'

import { Client } from '@hiveio/dhive';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import cron from 'node-cron';

const HIVE_NODES = (process.env.HIVE_NODES || 'https://api.hive.blog,https://api.deathwing.me').split(',');
const WATCH_ACCOUNTS = (process.env.WATCH_ACCOUNTS || 'angelicalist').split(',').map((s) => s.trim()).filter(Boolean);
const STATE = '.local/watchtower-state.json';
const ALERTS = '.local/watchtower-alerts.jsonl';
const TG_TOKEN = process.env.TG_BOT_TOKEN || '';
const TG_CHAT = process.env.TG_CHAT_ID || '';
const client = new Client(HIVE_NODES, { timeout: 8000, failoverThreshold: 2 });

// PURE: from raw account history, return OUTGOING value movements newer than lastIndex. Catches
// both native transfers (from === account) and HIVE-Engine token sends (custom_json ssc transfer).
export function detectNewOutflows(history, account, lastIndex = -1) {
  const out = [];
  for (const [index, op] of history) {
    if (index <= lastIndex) continue;
    const [kind, body] = op.op;
    if (kind === 'transfer' && body.from === account) {
      out.push({ index, at: op.timestamp, type: 'transfer', detail: `${body.amount} -> @${body.to}`, memo: body.memo || '' });
    } else if (kind === 'custom_json' && body.id === 'ssc-mainnet-hive' && (body.required_auths || []).includes(account)) {
      let j; try { j = JSON.parse(body.json); } catch { j = null; }
      const acts = Array.isArray(j) ? j : (j ? [j] : []);
      for (const a of acts) {
        if (a?.contractName === 'tokens' && (a.contractAction === 'transfer' || a.contractAction === 'stake')) {
          const p = a.contractPayload || {};
          out.push({ index, at: op.timestamp, type: 'token-' + a.contractAction, detail: `${p.quantity} ${p.symbol} -> @${p.to || account}` });
        }
        if (a?.contractName === 'market' && a.contractAction === 'sell') {
          const p = a.contractPayload || {};
          out.push({ index, at: op.timestamp, type: 'market-sell', detail: `SELL ${p.quantity} ${p.symbol} @ ${p.price}` });
        }
      }
    }
  }
  return out;
}

function loadState() { try { return existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}; } catch { return {}; } }
function saveState(s) { mkdirSync('.local', { recursive: true }); writeFileSync(STATE, JSON.stringify(s, null, 2)); }

async function notify(text) {
  const prior = existsSync(ALERTS) ? readFileSync(ALERTS, 'utf8') : '';
  writeFileSync(ALERTS, prior + JSON.stringify({ at: new Date().toISOString(), text }) + '\n');
  if (TG_TOKEN && TG_CHAT) {
    try { await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: TG_CHAT, text }) }); } catch { /* file alert still written */ }
  }
}

export async function checkAccount(account, state = {}) {
  const history = await client.database.getAccountHistory(account, -1, 300);
  const lastIndex = state[account]?.lastIndex ?? (history.length ? history[history.length - 1][0] - 1 : -1);
  const outflows = detectNewOutflows(history, account, lastIndex);
  const newLast = history.length ? history[history.length - 1][0] : lastIndex;
  return { account, outflows, lastIndex: newLast };
}

export async function checkAll() {
  const state = loadState();
  const results = [];
  for (const account of WATCH_ACCOUNTS) {
    try {
      const r = await checkAccount(account, state);
      state[account] = { lastIndex: r.lastIndex, checkedAt: new Date().toISOString() };
      if (r.outflows.length) {
        const msg = `🚨 MELEK watchtower: ${r.outflows.length} OUTGOING movement(s) on @${account}:\n` + r.outflows.map((o) => `• ${o.at} ${o.type}: ${o.detail}`).join('\n');
        await notify(msg);
      }
      results.push(r);
    } catch (e) { results.push({ account, error: e.message }); }
  }
  saveState(state);
  return results;
}

if (process.argv[1] && process.argv[1].endsWith('wallet-monitor.mjs')) {
  const run = async () => {
    const results = await checkAll();
    for (const r of results) {
      if (r.error) console.log(`@${r.account}: (error: ${r.error})`);
      else if (r.outflows.length) console.log(`@${r.account}: 🚨 ${r.outflows.length} outgoing movement(s) — alerted`);
      else console.log(`@${r.account}: ✓ clear — nothing moved out`);
    }
  };
  if (process.argv.includes('--cron')) {
    const expr = process.env.WATCH_CRON || '*/5 * * * *';
    console.log(`[watchtower] polling ${expr} for outflows on: ${WATCH_ACCOUNTS.join(', ')}`);
    cron.schedule(expr, () => run().catch((e) => console.error('check failed:', e.message)));
    await run();
  } else { await run(); }
}
