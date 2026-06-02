// held-asset-scan.mjs — HOLDINGS-AWARE opportunity scanner for the Resource-Center engine (#187,
// extends #186). It STARTS from the REAL Hive-Engine holdings of the operator's accounts
// (angelicalist, kalivankush — angelicalist eventually becomes Hathor), and for every held token
// that ALSO has an external market, computes whether the asset could be moved/rotated to make money:
// the Hive-Engine USD price (HE lastPrice in HIVE × HIVE→USD) vs the real external USD price, and the
// spread between them. Each finding is a plain-English proposal a human can act on.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  ADVISORY ONLY — NO EXECUTION.  This module is READ-ONLY: it reads balances + prices and PROPOSES.
//  It never holds a key, never broadcasts, never trades (zero-WIF rule). This is the low-security
//  advisory phase: the bot proposes, the human executes. Ramp security (signer/policy/limits) when
//  the Hathor wallet lands at MELEK launch — only THEN does any auto-execution become a conversation.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
//   node integrations/held-asset-scan.mjs                       # scan the default operator accounts
//   node integrations/held-asset-scan.mjs angelicalist          # one account
//   import { scanAccounts, heldOpportunities, accountHoldings, SWAP_MAP } from './held-asset-scan.mjs'

import { find } from './he-client.mjs';
import { hiveUsd, priceUsd } from './price-oracle.mjs';
import { crypto } from './free-apis.mjs';
import { usFriendly } from './soapbox/markets-catalog.mjs';

export const DEFAULT_ACCOUNTS = ['angelicalist', 'kalivankush'];

// Externally-tradeable Hive-Engine tokens → their CoinGecko id (the asset's "real" market).
// `pegged` flags ~$1 stable proxies (SWAP.HBD) where the external price is the peg, not a feed.
// `note` carries the wrapping fact (a SWAP.* token redeems 1:1 to the native asset via the HE
// gateway/Beeswap, which is what makes the spread capturable). Ids are CoinGecko canonical ids;
// `hasLivePrice` is filled in at scan time from a live quote so we never assert a market that's dead.
export const SWAP_MAP = {
  'SWAP.HIVE':  { id: 'hive',                   externalAsset: 'HIVE',  native: true },
  'SWAP.HBD':   { id: 'hive_dollar',            externalAsset: 'HBD',   pegged: 1, note: 'HBD ≈ $1 peg' },
  'SWAP.LTC':   { id: 'litecoin',               externalAsset: 'LTC' },
  'SWAP.DOGE':  { id: 'dogecoin',               externalAsset: 'DOGE' },
  'SWAP.BTC':   { id: 'bitcoin',                externalAsset: 'BTC' },
  'SWAP.EOS':   { id: 'eos',                    externalAsset: 'EOS' },
  'SWAP.BCH':   { id: 'bitcoin-cash',           externalAsset: 'BCH' },
  'SWAP.MATIC': { id: 'matic-network',          externalAsset: 'MATIC' },
  'SWAP.BLURT': { id: 'blurt',                  externalAsset: 'BLURT' },
  'BLURT':      { id: 'blurt',                  externalAsset: 'BLURT' },
  'SPS':        { id: 'splintershards',         externalAsset: 'SPS' },
  'DEC':        { id: 'dark-energy-crystals',   externalAsset: 'DEC' },
};

const nz = (x) => { const v = +x; return Number.isFinite(v) ? v : 0; };

// short in-process cache so a single Resource-Center pass that scans both accounts doesn't re-pull
// the same balances/prices twice. Best-effort; cleared each fresh process.
const _cache = new Map();
const CACHE_TTL = +(process.env.HELD_SCAN_TTL_MS || 120000);
async function memo(key, fn) {
  const hit = _cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.v;
  const v = await fn();
  _cache.set(key, { exp: Date.now() + CACHE_TTL, v });
  return v;
}

/** Real Hive-Engine token balances for an account → [{symbol, balance, stake}], non-zero only.
 *  Best-effort: any failure returns []. */
export async function accountHoldings(account) {
  return memo(`bal:${account}`, async () => {
    try {
      const rows = await find('tokens', 'balances', { account }, 1000);
      return (Array.isArray(rows) ? rows : [])
        .map((r) => ({ symbol: r.symbol, balance: nz(r.balance), stake: nz(r.stake) }))
        .filter((r) => r.balance > 0 || r.stake > 0);
    } catch { return []; }
  });
}

// HE USD price for a symbol = its market lastPrice (quoted in HIVE) × HIVE→USD. Best-effort → 0.
async function heUsdPrice(symbol, hUsd) {
  return memo(`he:${symbol}`, async () => {
    try {
      const [m] = await find('market', 'metrics', { symbol }, 1);
      const lastHive = nz(m?.lastPrice);
      return lastHive > 0 ? lastHive * hUsd : 0;
    } catch { return 0; }
  });
}

// External USD price for a SWAP_MAP entry, via the robust multi-source oracle (seeded with a batched
// CoinGecko quote). Pegged proxies (SWAP.HBD) return the peg. Best-effort → 0.
async function externalUsdPrice(map, cgSeed) {
  if (map.pegged) return map.pegged;
  return memo(`ext:${map.id}`, async () => {
    try {
      const p = await priceUsd(map.id, cgSeed ?? null);
      return nz(p?.usd);
    } catch { return nz(cgSeed); }
  });
}

// Pick a plain-English venue suggestion for an external asset, gated on US-availability. We map the
// well-known wrapped assets to a US-friendly CEX that lists them; everything else gets a "US-verify"
// note so the human confirms before routing capital.
const US_VENUE = (() => {
  const usCex = usFriendly('crypto').filter((e) => e.type === 'CEX').map((e) => e.name);
  const has = (n) => usCex.find((x) => x.toLowerCase().startsWith(n.toLowerCase()));
  const pick = (...names) => { for (const n of names) { const m = has(n); if (m) return m; } return null; };
  return {
    HIVE:  null, // native chain asset — withdraw to the Hive L1, no CEX hop needed
    HBD:   null,
    LTC:   pick('Kraken', 'Coinbase', 'Gemini'),
    DOGE:  pick('Kraken', 'Coinbase', 'Crypto.com'),
    BTC:   pick('Coinbase', 'Kraken', 'River'),
    EOS:   pick('Kraken', 'Coinbase'),
    BCH:   pick('Coinbase', 'Kraken'),
    MATIC: pick('Coinbase', 'Kraken'),
    BLURT: null, // niche — no major US CEX; verify
    SPS:   null,
    DEC:   null,
  };
})();

/** Opportunities for ONE account: for each held token that has an external market, compute the
 *  HE-vs-external USD spread and emit a plain-English rotation proposal. Best-effort, never throws. */
export async function heldOpportunities(account) {
  let holdings = [];
  try { holdings = await accountHoldings(account); } catch { holdings = []; }
  const held = holdings.filter((h) => SWAP_MAP[h.symbol]);
  if (!held.length) return [];

  // one batched CoinGecko quote to seed the oracle for every mapped id we hold
  const ids = [...new Set(held.map((h) => SWAP_MAP[h.symbol].id))].join(',');
  const cg = await crypto.coingecko(ids, 'usd').catch(() => ({}));
  const hUsd = await hiveUsd().catch(() => 0);

  const out = [];
  for (const h of held) {
    const map = SWAP_MAP[h.symbol];
    const qty = h.balance + h.stake; // liquid + staked (staked needs unstake first — noted)
    const [heUsd, externalUsd] = await Promise.all([
      heUsdPrice(h.symbol, hUsd),
      externalUsdPrice(map, cg?.[map.id]?.usd),
    ]);
    map.hasLivePrice = externalUsd > 0; // record which mappings actually quote a live external price

    // value the holding at the best price we have (external if live, else HE)
    const valueUsd = (externalUsd > 0 ? externalUsd : heUsd) * qty;
    // spread = how much higher the external market is vs Hive-Engine (positive → redeem/move out to
    // capture; negative → the HE quote is richer, i.e. cheaper to BUY externally and bring in).
    let spreadPct = (heUsd > 0 && externalUsd > 0)
      ? +(((externalUsd - heUsd) / heUsd) * 100).toFixed(2)
      : null;
    // Illiquidity guard: a Hive-Engine `lastPrice` can be a single ancient trade on a dead market
    // (e.g. native BLURT at 0.00000022 HIVE). That yields a nonsense spread (millions of %), not a
    // real arbitrage. If the implied spread is wild (>500% either way), the HE quote is stale — drop
    // it and treat the token as "no reliable HE quote" rather than asserting a phantom edge.
    const staleHe = spreadPct != null && Math.abs(spreadPct) > 500;
    if (staleHe) spreadPct = null;

    const venue = US_VENUE[map.externalAsset];
    const where = venue ? venue : (map.native ? `the ${map.externalAsset} L1 chain` : `${map.externalAsset} market (US-verify)`);
    const v = (x) => x >= 1 ? x.toFixed(2) : x.toPrecision(3);

    let action;
    if (spreadPct == null) {
      const heNote = staleHe ? ` (Hive-Engine last trade $${v(heUsd)} looks stale/illiquid — not a reliable quote)` : '';
      action = externalUsd > 0
        ? `you hold ${qty.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${h.symbol} (~$${v(valueUsd)}); it trades at $${v(externalUsd)} externally as ${map.externalAsset}${heNote} — no reliable Hive-Engine quote to compare, but you could redeem/move it to ${where}`
        : `you hold ${qty.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${h.symbol} — no live external price this pass; re-check before moving`;
    } else {
      const dir = spreadPct >= 0 ? 'redeeming/moving out to capture it' : 'buying externally and bringing it in';
      action = `you hold ${qty.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${h.symbol} (~$${v(valueUsd)}) on Hive-Engine; it trades at $${v(externalUsd)} externally vs $${v(heUsd)} on HE (spread ${spreadPct >= 0 ? '+' : ''}${spreadPct}%) — consider ${dir} via ${where}`;
    }
    if (h.stake > 0) action += ` (note: ${h.stake.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${h.symbol} is staked — unstake first)`;

    out.push({
      account, symbol: h.symbol, balance: h.balance, stake: h.stake,
      valueUsd: +valueUsd.toFixed(2), heUsd: +heUsd.toFixed(8), externalUsd: +externalUsd.toFixed(8),
      spreadPct, staleHe, externalAsset: map.externalAsset, venue: where, action,
    });
  }
  // within an account, surface the biggest |spread| × value first
  return out.sort((a, b) => Math.abs((b.spreadPct || 0) * b.valueUsd) - Math.abs((a.spreadPct || 0) * a.valueUsd));
}

/** Scan all the operator accounts, return every opportunity sorted by |spread| × value.
 *  Best-effort: a failing account contributes nothing and never breaks the others. */
export async function scanAccounts(accounts = DEFAULT_ACCOUNTS) {
  const per = await Promise.all(accounts.map((a) => heldOpportunities(a).catch(() => [])));
  const all = per.flat();
  return all.sort((a, b) => Math.abs((b.spreadPct || 0) * b.valueUsd) - Math.abs((a.spreadPct || 0) * a.valueUsd));
}

if (process.argv[1] && process.argv[1].endsWith('held-asset-scan.mjs')) {
  const accts = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const accounts = accts.length ? accts : DEFAULT_ACCOUNTS;
  console.log('Holdings-aware opportunity scanner (READ-ONLY · advisory · no execution)\n' + '─'.repeat(72));
  for (const a of accounts) {
    const h = await accountHoldings(a);
    const mapped = h.filter((x) => SWAP_MAP[x.symbol]);
    console.log(`\n@${a}: ${h.length} non-zero token balances, ${mapped.length} with an external market.`);
    console.log('  held:', h.map((x) => x.symbol).join(', ') || '(none)');
  }
  const ops = await scanAccounts(accounts);
  console.log('\n' + '─'.repeat(72) + `\nOpportunities (top by |spread| × value), ${ops.length} total:\n`);
  for (const o of ops.slice(0, 20)) {
    console.log(`• @${o.account} ${o.symbol}  $${o.valueUsd}  spread ${o.spreadPct == null ? '—' : (o.spreadPct >= 0 ? '+' : '') + o.spreadPct + '%'}`);
    console.log(`    ${o.action}`);
  }
  console.log('\n*advisory only — proposes, never executes; ramp security at Hathor-wallet / MELEK launch.*');
}
