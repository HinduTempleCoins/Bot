// tradebot-forensics.mjs — READ-ONLY on-chain reconstruction of the Van Kush trade bot's P&L.
// No keys, no trading, no risk. Pulls the account's full HIVE-Engine market history + current
// holdings and computes where it made/lost HIVE. This is "Way 1" (what the bot actually did);
// current market price gives "Way 2" (what the holdings are worth now).
//
//   node integrations/tradebot-forensics.mjs <account> [account2 ...]
//   node integrations/tradebot-forensics.mjs            # probes the candidate accounts

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';
const HISTORY = 'https://history.hive-engine.com/accountHistory';
const RPC = 'https://api.hive-engine.com/rpc/contracts';

async function getJSON(url, opts = {}) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  try { const r = await fetch(url, { headers: { 'user-agent': UA }, signal: ctrl.signal, ...opts }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}
async function rpcFind(contract, table, query, limit = 1000) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'find', params: { contract, table, query, limit } }) });
  const j = await r.json(); return j.result || [];
}

// full paginated market history for an account
export async function marketHistory(account, cap = 2000) {
  const ops = []; let offset = 0;
  while (ops.length < cap) {
    const batch = await getJSON(`${HISTORY}?account=${account}&limit=500&offset=${offset}&ops=market_buy,market_sell,market_placeOrder,market_expire,market_cancel`).catch(() => []);
    if (!batch.length) break;
    ops.push(...batch); offset += batch.length;
    if (batch.length < 500) break;
  }
  return ops;
}

export async function currentHoldings(account) {
  const bals = await rpcFind('tokens', 'balances', { account });
  return bals.filter(b => +b.balance > 0 || +b.stake > 0).map(b => ({ symbol: b.symbol, balance: +b.balance, stake: +b.stake }));
}
async function marketPrice(symbol) {
  const m = await rpcFind('market', 'metrics', { symbol }, 1);
  return m[0] ? +m[0].lastPrice : 0;
}

export function reconstruct(ops) {
  // per-symbol: HIVE spent on fills (buys), HIVE received (sells), tokens net
  const sym = {};
  let fills = 0;
  for (const o of ops) {
    const d = o.data || o;
    const s = d.symbol; if (!s) continue;
    sym[s] ||= { bought: 0, sold: 0, hiveSpent: 0, hiveRecv: 0, buys: 0, sells: 0 };
    const qty = +(d.quantityTokens ?? d.quantity ?? 0);
    const hive = +(d.quantityHive ?? d.quantityHIVE ?? 0);
    if (o.operation === 'market_buy' && hive) { sym[s].bought += qty; sym[s].hiveSpent += hive; sym[s].buys++; fills++; }
    else if (o.operation === 'market_sell' && hive) { sym[s].sold += qty; sym[s].hiveRecv += hive; sym[s].sells++; fills++; }
  }
  return { sym, fills };
}

async function report(account) {
  process.stdout.write(`\n══════════ ${account} ══════════\n`);
  const ops = await marketHistory(account);
  if (!ops.length) { console.log('  no HIVE-Engine market history (not the trader, or no fills).'); return { account, fills: 0 }; }
  const { sym, fills } = reconstruct(ops);
  if (!fills) { console.log(`  ${ops.length} market ops but 0 actual fills (orders placed/expired only).`); return { account, fills: 0 }; }
  const holdings = await currentHoldings(account);
  const hbal = Object.fromEntries(holdings.map(h => [h.symbol, h.balance + h.stake]));

  let netRealized = 0, unrealized = 0;
  console.log(`  ${ops.length} ops, ${fills} fills across ${Object.keys(sym).length} tokens\n`);
  console.log('  token        buys  sells   HIVE spent   HIVE recv    net HIVE   held    held≈HIVE');
  console.log('  ' + '─'.repeat(82));
  const rows = Object.entries(sym).sort((a, b) => (b[1].hiveSpent + b[1].hiveRecv) - (a[1].hiveSpent + a[1].hiveRecv));
  for (const [s, v] of rows) {
    const net = v.hiveRecv - v.hiveSpent; netRealized += net;
    const held = hbal[s] || 0;
    let heldHive = 0;
    if (held > 0) { const p = await marketPrice(s).catch(() => 0); heldHive = held * p; unrealized += heldHive; }
    console.log(`  ${s.padEnd(12)} ${String(v.buys).padStart(4)} ${String(v.sells).padStart(6)} ${v.hiveSpent.toFixed(2).padStart(12)} ${v.hiveRecv.toFixed(2).padStart(11)} ${net.toFixed(2).padStart(11)} ${held.toFixed(0).padStart(7)} ${heldHive.toFixed(2).padStart(11)}`);
  }
  console.log('  ' + '─'.repeat(82));
  console.log(`  REALIZED net HIVE from trading: ${netRealized.toFixed(2)}  (negative = spent more HIVE buying than got back selling)`);
  console.log(`  UNREALIZED value of current holdings: ${unrealized.toFixed(2)} HIVE`);
  console.log(`  NET POSITION (realized + holdings): ${(netRealized + unrealized).toFixed(2)} HIVE`);
  return { account, fills, netRealized, unrealized, net: netRealized + unrealized };
}

if (process.argv[1] && process.argv[1].endsWith('tradebot-forensics.mjs')) {
const args = process.argv.slice(2);
const candidates = args.length ? args : ['angelicalist', 'punicwax', 'vankush', 'kalivankush'];
console.log(`Trade-bot forensics — read-only on-chain P&L reconstruction (HIVE-Engine)`);
const results = [];
for (const a of candidates) { try { results.push(await report(a)); } catch (e) { console.log(`\n  ${a}: error ${e.message}`); } }
const traders = results.filter(r => r && r.fills > 0).sort((a, b) => b.fills - a.fills);
console.log(`\n════════ summary ════════`);
if (!traders.length) console.log('No fills found on any candidate — confirm the trading account name.');
else for (const t of traders) console.log(`  ${t.account.padEnd(14)} ${t.fills} fills | realized ${t.netRealized?.toFixed(1)} + holdings ${t.unrealized?.toFixed(1)} = ${t.net?.toFixed(1)} HIVE`);
}
