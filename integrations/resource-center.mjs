// resource-center.mjs — THE 24/7 market-intelligence engine (operator 2026-06-02, priority).
// One pass pulls EVERYTHING we built and fuses it: the Hive-Engine/TribalDEX token universe (all ~1264
// tokens, volume-ranked), macro (gold/silver, US + global indices, oil), forex (major pairs + DXY), and
// the depth-aware trade proposals — then writes a structured snapshot + an append-only history log + a
// brief-ready markdown report. A systemd timer runs `runPass()` on a schedule so it's always current.
//
// It is ADVISORY: it tells us what to make operational on Hive-Engine first, which chains/exchanges to
// add alongside HE (US-aware, for Americans), and surfaces cross-market arbitrage + metals/stock signals.
// It NEVER executes a trade (zero-WIF rule). Start with the Hive-Engine data we have; grow from there.
//
//   node integrations/resource-center.mjs            # one pass → prints the brief, writes the snapshot
//   node integrations/resource-center.mjs --json     # print the raw snapshot JSON

import { writeFile, appendFile, mkdir, readFile } from 'node:fs/promises';
import { marketSnapshot, topByVolume } from './market-universe.mjs';
import { macro, forex } from './soapbox/macro.mjs';
import { scanAccounts } from './held-asset-scan.mjs';

// trade-proposer is optional at load (advisory layer) — import defensively so a single broken dep
// never takes the whole engine down.
let proposeTrades = async () => null, briefBlock = () => '';
try { const tp = await import('./trade-proposer.mjs'); proposeTrades = tp.proposeTrades || proposeTrades; briefBlock = tp.briefBlock || briefBlock; } catch { /* advisory layer absent — engine still runs */ }

const OUT = process.env.RC_OUT || new URL('../data/resource-center', import.meta.url).pathname;
const num = (n, d = 2) => (n == null || !Number.isFinite(+n) ? '—' : (+n).toLocaleString(undefined, { maximumFractionDigits: d }));
const pct = (n) => (n == null || !Number.isFinite(+n) ? '—' : `${n >= 0 ? '+' : ''}${(+n).toFixed(2)}%`);

/** One full intelligence pass. Best-effort: any source that fails is null/empty, the pass still completes. */
export async function runPass() {
  const ts = new Date().toISOString();
  const [he, mac, fx, proposals, holdings] = await Promise.all([
    marketSnapshot({ topN: 15 }).catch(() => null),
    macro().catch(() => ({})),
    forex().catch(() => ({})),
    Promise.resolve().then(() => proposeTrades({})).catch(() => null),
    // holdings-aware rotation scanner (#187): START from the operator's REAL Hive-Engine balances,
    // find held tokens with an external market, compute the move-it-to-make-money spread. Advisory.
    scanAccounts().catch(() => []),
  ]);

  const findM = (cat, label) => (mac[cat] || []).find((x) => x.label?.startsWith(label)) || null;
  const metals = {
    gold: findM('Metals', 'Gold'), silver: findM('Metals', 'Silver'),
    platinum: findM('Metals', 'Platinum'), copper: findM('Metals', 'Copper'),
  };
  const indices = {
    dow: findM('US Indices', 'Dow'), sp500: findM('US Indices', 'S&P'),
    nasdaq: findM('US Indices', 'Nasdaq'), vix: findM('Risk & Currency', 'VIX'),
  };
  const fxMajors = (fx['Major pairs'] || []);
  const dxy = (fx['Dollar strength'] || [])[0] || null;

  // cross-market metrics — the "diagnostics" layer the briefs read
  const metrics = {
    hiveEngine: he ? {
      totalTokens: he.totalTokens, activeMarkets: he.activeMarkets,
      totalVolumeHive: he.totalVolumeHive,
      topVolume: (he.topVolume || []).slice(0, 5).map((r) => ({ symbol: r.symbol, volume: r.volume, change: r.priceChangePercent ?? r.change })),
      topGainers: (he.topGainers || []).slice(0, 3).map((r) => ({ symbol: r.symbol, change: r.priceChangePercent ?? r.change })),
      topLosers: (he.topLosers || []).slice(0, 3).map((r) => ({ symbol: r.symbol, change: r.priceChangePercent ?? r.change })),
    } : null,
    metals: Object.fromEntries(Object.entries(metals).map(([k, v]) => [k, v ? { price: v.price, change: v.change } : null])),
    indices: Object.fromEntries(Object.entries(indices).map(([k, v]) => [k, v ? { price: v.price, change: v.change } : null])),
    forex: fxMajors.map((p) => ({ pair: p.label, rate: p.price, change: p.change })),
    dxy: dxy ? { price: dxy.price, change: dxy.change } : null,
    riskOn: indices.vix?.price != null ? (+indices.vix.price < 20 ? 'risk-on (VIX<20)' : 'risk-off (VIX≥20)') : null,
  };

  const snapshot = { ts, metrics, proposals, holdings, sources: { hiveEngine: !!he, macro: !!Object.keys(mac).length, forex: !!fxMajors.length, proposer: !!proposals, holdings: Array.isArray(holdings) && holdings.length > 0 } };

  // persist: latest + append-only history (for trend/diagnostics)
  try {
    await mkdir(OUT, { recursive: true });
    await writeFile(`${OUT}/latest.json`, JSON.stringify(snapshot, null, 2));
    await appendFile(`${OUT}/history.jsonl`, JSON.stringify({ ts, m: metrics }) + '\n');
    await writeFile(`${OUT}/brief.md`, briefReport(snapshot));
  } catch { /* read-only fs — still return the snapshot */ }
  return snapshot;
}

/** Brief-ready markdown — the section a 12&12 / brief writer drops in. */
export function briefReport(s) {
  const m = s.metrics;
  const L = [];
  L.push(`## Market Intelligence — ${s.ts.slice(0, 16).replace('T', ' ')} UTC\n`);
  if (m.hiveEngine) {
    const he = m.hiveEngine;
    L.push(`**Hive-Engine / TribalDEX** (start here): ${he.totalTokens} tokens, ${he.activeMarkets} active markets, ${num(he.totalVolumeHive, 0)} HIVE 24h volume.`);
    L.push(`  Top volume: ${he.topVolume.map((r) => `${r.symbol} (${num(r.volume, 0)})`).join(', ')}.`);
    L.push(`  Movers: ▲ ${he.topGainers.map((r) => `${r.symbol} ${pct(r.change)}`).join(', ')} · ▼ ${he.topLosers.map((r) => `${r.symbol} ${pct(r.change)}`).join(', ')}.`);
  } else L.push(`**Hive-Engine**: data unavailable this pass.`);
  L.push('');
  L.push(`**Metals**: Gold ${m.metals.gold ? '$' + num(m.metals.gold.price) + ' ' + pct(m.metals.gold.change) : '—'} · Silver ${m.metals.silver ? '$' + num(m.metals.silver.price) + ' ' + pct(m.metals.silver.change) : '—'}.`);
  L.push(`**Indices**: Dow ${m.indices.dow ? pct(m.indices.dow.change) : '—'} · S&P ${m.indices.sp500 ? pct(m.indices.sp500.change) : '—'} · Nasdaq ${m.indices.nasdaq ? pct(m.indices.nasdaq.change) : '—'} · VIX ${m.indices.vix ? num(m.indices.vix.price, 1) : '—'} (${m.riskOn || '—'}).`);
  if (m.forex.length) L.push(`**Forex**: ${m.forex.slice(0, 4).map((p) => `${p.pair} ${num(p.rate, 4)}`).join(' · ')}${m.dxy ? ` · DXY ${num(m.dxy.price)} ${pct(m.dxy.change)}` : ''}.`);
  L.push('');
  // proposals (the actionable part)
  if (s.proposals && briefBlock) {
    const pb = briefBlock(s.proposals);
    if (pb) { L.push(`### Proposed moves (advisory — operator decides)`); L.push(pb); }
  }
  // holdings & rotation opportunities (#187) — START from what we actually hold and could move
  if (Array.isArray(s.holdings) && s.holdings.length) {
    L.push('');
    L.push(`### Holdings & rotation opportunities`);
    L.push(`From the operator's real Hive-Engine balances (angelicalist, kalivankush), held tokens with an external market — could they be moved/rotated to make money:`);
    for (const o of s.holdings.slice(0, 6)) {
      const sp = o.spreadPct == null ? '—' : `${o.spreadPct >= 0 ? '+' : ''}${o.spreadPct}%`;
      L.push(`- **@${o.account} ${o.symbol}** (~$${num(o.valueUsd)}, spread ${sp}): ${o.action}`);
    }
  }
  L.push(`\n*Engine: resource-center.mjs · advisory only, no trades executed · US-jurisdiction-aware.*`);
  return L.join('\n');
}

/** Read the last snapshot (for the site / Hathor / briefs to display without re-running a pass). */
export async function latest() {
  try { return JSON.parse(await readFile(`${OUT}/latest.json`, 'utf8')); } catch { return null; }
}

if (process.argv[1] && process.argv[1].endsWith('resource-center.mjs')) {
  const s = await runPass();
  if (process.argv.includes('--json')) console.log(JSON.stringify(s, null, 2));
  else console.log(briefReport(s));
}
