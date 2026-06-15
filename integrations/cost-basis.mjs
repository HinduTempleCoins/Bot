// cost-basis.mjs — what the operator ACTUALLY PAID for each held token, from real Hive-Engine
// market history. The trader uses this so it never sells below acquisition cost (not just below the
// market's last price). Inventory is often BOUGHT by the treasury (@kalivankush) and TRANSFERRED to
// the executing account (@angelicalist), so the cost basis must be aggregated across BOTH accounts —
// "what WE paid", regardless of which account holds the bag now.
//
//  READ-ONLY. No execution, no broadcast. Soft-fail: any error → null/empty, never throws.
//
// CLI:
//   node integrations/cost-basis.mjs SPS            # cost basis for one token across the operator accounts
//   node integrations/cost-basis.mjs                # cost basis for every token with a recorded buy
import { historyPage } from './he-client.mjs';
import { fileURLToPath } from 'node:url';

// the treasury + executor: a token bought by either is "ours" at that price.
export const BASIS_ACCOUNTS = (process.env.BASIS_ACCOUNTS || 'angelicalist,kalivankush')
  .split(',').map((s) => s.trim()).filter(Boolean);

const num = (x) => { const v = parseFloat(String(x).replace(/[%,]/g, '')); return Number.isFinite(v) ? v : 0; };

// Walk an account's paginated market history and return every market_buy fill, oldest-or-newest
// irrelevant (we VWAP them all). Injectable getHistory keeps this fully offline in tests.
export async function buyFills(account, { getHistory = historyPage, symbol = null, maxRows = 5000, pageSize = 500 } = {}) {
  const fills = [];
  for (let offset = 0; fills.length < maxRows; offset += pageSize) {
    let page;
    try { page = await getHistory(account, { limit: pageSize, offset, ops: 'market_buy' }); }
    catch { break; }
    if (!Array.isArray(page) || !page.length) break;
    for (const r of page) {
      if (r.operation !== 'market_buy') continue;
      if (symbol && String(r.symbol).toUpperCase() !== String(symbol).toUpperCase()) continue;
      const tokens = num(r.quantityTokens);
      const hive = num(r.quantityHive);
      if (tokens > 0 && hive > 0) fills.push({ symbol: String(r.symbol).toUpperCase(), tokens, hive, timestamp: r.timestamp, account });
    }
    if (page.length < pageSize) break;
  }
  return fills;
}

// Volume-weighted average cost basis for ONE symbol across the operator accounts.
// → { symbol, basisHive, tokensBought, hiveSpent, fills } or null when there is no recorded buy
// (issued/airdropped tokens have no purchase price → the caller must fall back, never blind-sell).
export async function costBasis(symbol, { accounts = BASIS_ACCOUNTS, getHistory = historyPage } = {}) {
  const sym = String(symbol || '').toUpperCase();
  if (!sym) return null;
  let tokensBought = 0, hiveSpent = 0, fills = 0;
  for (const acct of accounts) {
    const f = await buyFills(acct, { getHistory, symbol: sym }).catch(() => []);
    for (const x of f) { tokensBought += x.tokens; hiveSpent += x.hive; fills += 1; }
  }
  if (!(tokensBought > 0) || !(hiveSpent > 0)) return null;
  return { symbol: sym, basisHive: +(hiveSpent / tokensBought).toFixed(8), tokensBought: +tokensBought.toFixed(8), hiveSpent: +hiveSpent.toFixed(8), fills };
}

// Cost basis for MANY symbols at once → Map(symbol → basisHive). Symbols with no recorded buy are
// simply absent from the map (caller treats absent as "no basis → fall back to last-price gate").
export async function costBasisMap(symbols, { accounts = BASIS_ACCOUNTS, getHistory = historyPage } = {}) {
  const out = new Map();
  for (const s of (symbols || [])) {
    const cb = await costBasis(s, { accounts, getHistory }).catch(() => null);
    if (cb) out.set(cb.symbol, cb.basisHive);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sym = process.argv[2];
  if (sym) {
    const cb = await costBasis(sym).catch((e) => ({ error: e.message }));
    if (!cb) console.log(`@${BASIS_ACCOUNTS.join('/@')}: no recorded market_buy for ${sym.toUpperCase()} — no cost basis (issued/airdropped?).`);
    else if (cb.error) console.log('error:', cb.error);
    else console.log(`${cb.symbol}: cost basis ${cb.basisHive} HIVE/token  (${cb.tokensBought} bought for ${cb.hiveSpent} HIVE across ${cb.fills} fills)`);
  } else {
    // every symbol the accounts ever bought
    const all = new Map();
    for (const acct of BASIS_ACCOUNTS) {
      for (const f of await buyFills(acct).catch(() => [])) {
        const e = all.get(f.symbol) || { tokens: 0, hive: 0, fills: 0 };
        e.tokens += f.tokens; e.hive += f.hive; e.fills += 1; all.set(f.symbol, e);
      }
    }
    const rows = [...all.entries()].map(([s, e]) => ({ s, basis: e.hive / e.tokens, e })).sort((a, b) => b.e.hive - a.e.hive);
    console.log(`cost basis across @${BASIS_ACCOUNTS.join(', @')} (${rows.length} tokens with a recorded buy):`);
    for (const r of rows) console.log(`  ${r.s.padEnd(14)} ${r.basis.toFixed(8)} HIVE/token   (${r.e.tokens.toFixed(2)} for ${r.e.hive.toFixed(2)} HIVE)`);
  }
}
