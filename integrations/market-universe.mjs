// market-universe.mjs — READ-ONLY view of the ENTIRE HIVE-Engine / TribalDEX token universe.
// Where watchlist.mjs is the small hand-picked set (VKBT/CURE/…), this module pulls EVERY token
// and EVERY market's 24h metrics off the keyless Hive-Engine API, ranks them by volume, and hands
// the propose-trades logic (#169) + the briefs a compact picture of "what's actually moving".
//
// TribalDEX and Hive-Engine trade on the same `market` contract, so this one universe covers both.
//
// No keys, keyless, cached, best-effort: every public fn catches and returns an empty/zeroed shape
// rather than throwing, so an unattended automode loop never dies on a flaky node.
//
//   node integrations/market-universe.mjs top [N]     # N highest-volume markets (default 15)
//   node integrations/market-universe.mjs snapshot     # compact universe summary (for briefs)
//   import { allTokens, allMarketMetrics, topByVolume, marketSnapshot } from './market-universe.mjs'

import { find as realFind } from './he-client.mjs';

// the find() the pager uses. Defaults to the real he-client; tests inject a fake via setFind()
// so the suite needs no network and no experimental module-mock flag.
let _find = realFind;
export function setFind(fn) { _find = fn || realFind; }

const PAGE = +(process.env.HE_UNIVERSE_PAGE || 1000);     // rows per find() call (HE caps ~1000)
const MAX_PAGES = +(process.env.HE_UNIVERSE_MAX_PAGES || 50); // hard stop so a bad cursor can't loop forever
// in-process memo so allTokens()/allMarketMetrics() called twice in one run hit the API once.
// (he-client also has its own opt-in disk cache via HE_CACHE_TTL_MS — this is the cheap layer above it.)
const MEMO_TTL = +(process.env.HE_UNIVERSE_MEMO_TTL_MS || 60000);
const _memo = new Map();
async function memo(key, fn) {
  const hit = _memo.get(key);
  if (hit && hit.exp > Date.now()) return hit.v;
  const v = await fn();
  _memo.set(key, { exp: Date.now() + MEMO_TTL, v });
  return v;
}

// Cursor-page a whole contract table via `_id > last` (HE returns ≤~1000 rows per call, and the
// find() wrapper hardcodes offset:0, so we walk the primary key instead of using offset).
async function pageTable(contract, table) {
  const out = [];
  let last = 0;
  for (let i = 0; i < MAX_PAGES; i++) {
    const rows = await _find(contract, table, { _id: { $gt: last } }, PAGE, [{ index: '_id', descending: false }]);
    if (!Array.isArray(rows) || rows.length === 0) break;
    out.push(...rows);
    last = rows[rows.length - 1]._id;
    if (rows.length < PAGE) break;
  }
  return out;
}

// ── the full token universe (symbol, name, supply, …), cached ────────────────
export async function allTokens() {
  return memo('tokens', async () => {
    try {
      const rows = await pageTable('tokens', 'tokens');
      return rows.map(t => ({
        symbol: t.symbol,
        name: t.name,
        issuer: t.issuer,
        precision: +t.precision || 0,
        supply: +t.supply || 0,
        circulatingSupply: +t.circulatingSupply || +t.supply || 0,
        maxSupply: +t.maxSupply || 0,
        stakingEnabled: !!t.stakingEnabled,
      }));
    } catch { return []; }
  });
}

// ── every market's 24h metrics, joined to the token, ranked by HIVE volume ────
// market.metrics.volume is the rolling 24h volume in HIVE (it carries volumeExpiration).
export async function allMarketMetrics() {
  return memo('metrics', async () => {
    try {
      const [metrics, tokens] = await Promise.all([
        pageTable('market', 'metrics'),
        allTokens(),
      ]);
      const bySym = new Map(tokens.map(t => [t.symbol, t]));
      const rows = metrics.map(m => {
        const tok = bySym.get(m.symbol) || null;
        const lastPrice = +m.lastPrice || 0;
        const supply = tok ? tok.circulatingSupply : 0;
        return {
          symbol: m.symbol,
          name: tok ? tok.name : null,
          volume: +m.volume || 0,                 // 24h volume, HIVE
          lastPrice,
          lowestAsk: +m.lowestAsk || 0,
          highestBid: +m.highestBid || 0,
          lastDayPrice: +m.lastDayPrice || 0,
          priceChangePercent: parseFloat(m.priceChangePercent) || 0, // "0.04%" -> 0.04
          priceChangeHive: +m.priceChangeHive || 0,
          supply,
          marketCap: supply * lastPrice,          // HIVE
        };
      });
      rows.sort((a, b) => b.volume - a.volume);
      return rows;
    } catch { return []; }
  });
}

// ── the N highest-volume markets (the "high-volume markets to watch") ─────────
export async function topByVolume(n = 25) {
  const rows = await allMarketMetrics();
  return rows.filter(r => r.volume > 0).slice(0, Math.max(0, n | 0));
}

// ── compact summary the propose-trades logic (#169) + briefs read ─────────────
// Foundation object: totals + top movers/volume, all derived from one universe pull.
export async function marketSnapshot({ topN = 10 } = {}) {
  const [tokens, metrics] = await Promise.all([allTokens(), allMarketMetrics()]);
  const active = metrics.filter(r => r.volume > 0);
  const totalVolume = active.reduce((a, r) => a + r.volume, 0);

  const topVolume = active.slice(0, topN).map(r => ({
    symbol: r.symbol, volume: r.volume, lastPrice: r.lastPrice, changePct: r.priceChangePercent,
  }));
  // movers: only among markets with real volume, so a 1-fill micro-token can't top the chart
  const movers = active.filter(r => r.volume >= 1);
  const topGainers = [...movers].sort((a, b) => b.priceChangePercent - a.priceChangePercent)
    .slice(0, topN).map(r => ({ symbol: r.symbol, changePct: r.priceChangePercent, volume: r.volume, lastPrice: r.lastPrice }));
  const topLosers = [...movers].sort((a, b) => a.priceChangePercent - b.priceChangePercent)
    .slice(0, topN).map(r => ({ symbol: r.symbol, changePct: r.priceChangePercent, volume: r.volume, lastPrice: r.lastPrice }));

  return {
    ts: new Date().toISOString(),
    totalTokens: tokens.length,
    activeMarkets: active.length,         // markets with >0 24h volume
    totalMarkets: metrics.length,
    totalVolumeHive: +totalVolume.toFixed(3),
    topVolume,
    topGainers,
    topLosers,
  };
}

export default { allTokens, allMarketMetrics, topByVolume, marketSnapshot };

// ── CLI ───────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('market-universe.mjs')) {
  const cmd = (process.argv[2] || 'snapshot').toLowerCase();
  const fmt = (n, d = 2) => (+n || 0).toLocaleString(undefined, { maximumFractionDigits: d });

  if (cmd === 'top') {
    const n = +(process.argv[3]) || 15;
    const rows = await topByVolume(n);
    console.log(`Top ${rows.length} HIVE-Engine / TribalDEX markets by 24h volume (read-only)`);
    console.log('─'.repeat(74));
    console.log('  #  symbol         24h vol (HIVE)     last (HIVE)    %chg   mcap (HIVE)');
    console.log('─'.repeat(74));
    rows.forEach((r, i) => {
      console.log(
        `${String(i + 1).padStart(3)}  ${r.symbol.padEnd(14)} ${fmt(r.volume, 1).padStart(14)} ${fmt(r.lastPrice, 6).padStart(15)} ${(r.priceChangePercent.toFixed(1) + '%').padStart(7)} ${fmt(r.marketCap, 0).padStart(13)}`,
      );
    });
  } else {
    const s = await marketSnapshot({ topN: 10 });
    console.log('HIVE-Engine / TribalDEX market universe snapshot (read-only)');
    console.log('─'.repeat(66));
    console.log(`  tokens:        ${s.totalTokens}`);
    console.log(`  markets:       ${s.totalMarkets} (${s.activeMarkets} with 24h volume)`);
    console.log(`  total 24h vol: ${fmt(s.totalVolumeHive, 1)} HIVE`);
    console.log('\n  TOP 10 BY VOLUME:');
    s.topVolume.forEach((r, i) => console.log(`    ${String(i + 1).padStart(2)}. ${r.symbol.padEnd(14)} ${fmt(r.volume, 1).padStart(12)} HIVE  (${r.changePct.toFixed(1)}%)`));
    console.log('\n  TOP MOVERS UP (vol ≥1):');
    s.topGainers.slice(0, 5).forEach(r => console.log(`    ${r.symbol.padEnd(14)} +${r.changePct.toFixed(1)}%  (${fmt(r.volume, 1)} HIVE)`));
    console.log('\n  TOP MOVERS DOWN (vol ≥1):');
    s.topLosers.slice(0, 5).forEach(r => console.log(`    ${r.symbol.padEnd(14)} ${r.changePct.toFixed(1)}%  (${fmt(r.volume, 1)} HIVE)`));
  }
}
