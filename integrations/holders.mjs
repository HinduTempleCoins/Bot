// holders.mjs — READ-ONLY "who actually holds this token besides us?". No keys.
// market-depth.mjs counts outside holders; this NAMES them, so the operator can see whether the
// issued tokens (VKBT, CURE) have any real outside demand or are just airdrop dust + self-holding.
//
//   node integrations/holders.mjs [SYMBOL ...]   (default = ISSUED_TOKENS)
//   import { holders } from './holders.mjs'

import { find, findAll, __setFetch as __setHeFetch } from './he-client.mjs';
import { ISSUED_TOKENS, TRADE_ACCOUNT } from './watchlist.mjs';

// Injectable fetch seam (house pattern). holders has no direct fetch — it reads the chain via
// he-client's find()/findAll(). Re-export he-client's seam so holders' aggregation/threshold logic is
// offline-testable through the same surface (inject a fake fetch → drive find() → exercise holders).
export const __setFetch = __setHeFetch;

// affiliated accounts that aren't "real outside demand" even though they aren't the issuer
const AFFILIATED = new Set([TRADE_ACCOUNT, 'vankushfamily', 'angelica7', 'angelicalist', 'vankush', 'punicwax']);

// holder count / distribution for a Hive-Engine token.
//
// THE "holders: 0" BUG (fixed here): the old code read a single find() of `limit` balance rows sorted
// by the `balance` index DESCENDING. Two faults compounded:
//   1. HE's `balance` index sorts LEXICOGRAPHICALLY (string), not numerically — so the "top" window was
//      not actually the largest holders, and accounts that staked everything (liquid `balance: "0"`)
//      string-sort to the BOTTOM. On CURE that's ~179 of ~585 real holders silently dropped.
//   2. A single find() truncates at `limit` (default 100; HE hard-caps at 1000), so the count reflected
//      a page size, not the real holder count — and for stake-heavy tokens the visible-outside count
//      could collapse toward 0.
// Fix: page through ALL balance rows (findAll, natural order, no broken sort index), fold stake into the
// balance, sort NUMERICALLY in code, and count by total (balance+stake) ≥ 1. `issuer` now also treats
// the token's real on-chain issuer as the issuer (not only TRADE_ACCOUNT), so swap/3rd-party tokens
// classify correctly.
export async function holders(symbol, { issuer = TRADE_ACCOUNT, maxRows = 50000 } = {}) {
  const info = (await find('tokens', 'tokens', { symbol }, 1))[0];
  if (!info) return null;
  const supply = +info.circulatingSupply || +info.supply || 0;
  const issuers = new Set([issuer, info.issuer].filter(Boolean));
  const rows = await findAll('tokens', 'balances', { symbol }, { maxRows });
  const all = rows.map(h => {
    const bal = +h.balance + (+h.stake || 0);
    return { account: h.account, bal, pct: supply ? bal / supply * 100 : 0,
      affiliated: AFFILIATED.has(h.account), issuer: issuers.has(h.account) };
  }).sort((a, b) => b.bal - a.bal); // numeric sort in code — never trust the HE string `balance` index
  const outside = all.filter(h => !h.issuer && h.bal >= 1);
  const realOutside = outside.filter(h => !h.affiliated);
  // `holders` = accounts with a meaningful total balance (≥1 incl. stake) — the headline holder count.
  // `total` stays the raw balance-row count (incl. dust / zero rows) for callers that want it.
  const holderCount = all.filter(h => h.bal >= 1).length;
  return {
    symbol, issuer: info.issuer, supply,
    issuerPct: +(all.filter(h => h.issuer).reduce((a, h) => a + h.pct, 0)).toFixed(2),
    affiliatedPct: +(all.filter(h => h.affiliated && !h.issuer).reduce((a, h) => a + h.pct, 0)).toFixed(2),
    realOutsidePct: +(realOutside.reduce((a, h) => a + h.pct, 0)).toFixed(2),
    counts: { total: all.length, holders: holderCount, outside: outside.length, realOutside: realOutside.length },
    topOutside: outside.slice(0, 12).map(h => ({ account: h.account, bal: +h.bal.toFixed(3), pct: +h.pct.toFixed(3), affiliated: h.affiliated })),
  };
}

if (process.argv[1] && process.argv[1].endsWith('holders.mjs')) {
  const syms = process.argv.slice(2);
  const targets = syms.length ? syms : ISSUED_TOKENS;
  console.log('Token holder reality check (read-only)\n' + '─'.repeat(62));
  for (const s of targets) {
    const h = await holders(s).catch(e => ({ error: e.message }));
    if (!h || h.error) { console.log(`\n${s}: ${h?.error || 'not found'}`); continue; }
    console.log(`\n${s} — supply ${h.supply.toLocaleString()}`);
    console.log(`  issuer ${h.issuerPct}% | affiliated ${h.affiliatedPct}% | REAL outside ${h.realOutsidePct}% (${h.counts.realOutside} accounts ≥1 token)`);
    for (const o of h.topOutside) console.log(`   @${o.account.padEnd(20)} ${o.bal.toLocaleString().padStart(14)}  ${o.pct.toFixed(2)}%${o.affiliated ? '  (affiliated)' : ''}`);
  }
  console.log('\n→ "real outside %" is the only number that means genuine external demand.');
}
