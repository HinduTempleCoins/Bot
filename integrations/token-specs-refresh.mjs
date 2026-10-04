#!/usr/bin/env node
// token-specs-refresh.mjs — re-derive the token SPECS from Hive-Engine and print the block to paste
// into integrations/token-specs.mjs. Read-only, no keys, no writes.
//
//   node integrations/token-specs-refresh.mjs [SYMBOL ...]     (default VKBT CURE)
//
// WHY THIS EXISTS. The specs in token-specs.mjs are a DATED SNAPSHOT so the figure renders offline and
// a test never touches the network. A snapshot rots. This script is the thing that un-rots it, and it
// REFUSES to print a number from an incomplete read — the exact failure that put two wrong holder counts
// on the public wiki (a 1,000-row page cap, and an offset-paged read that died at Hive-Engine's
// 10,000-offset ceiling inside a silent catch).
import { find, findAllByCursor, __setFetch as __setHeFetch } from './he-client.mjs';

export const __setFetch = __setHeFetch;
const n = (x) => Number(x || 0);
const fmt = (x) => n(x).toLocaleString('en-US', { maximumFractionDigits: 0 });

/** live specs for one symbol — throws rather than reporting a partial read */
export async function liveSpecs(symbol, { hivePriceUsd = 0 } = {}) {
  const info = (await find('tokens', 'tokens', { symbol }, 1))[0];
  if (!info) return null;
  const metrics = (await find('market', 'metrics', { symbol }, 1))[0] || {};
  const rows = await findAllByCursor('tokens', 'balances', { symbol }, { onTruncate: 'throw' });
  const tot = (r) => n(r.balance) + n(r.stake) + n(r.pendingUnstake);
  const held = rows.filter((r) => tot(r) > 0);
  const tier = (min) => rows.filter((r) => tot(r) >= min).length;
  const issuerRow = rows.find((r) => r.account === info.issuer);
  const issuerAmt = issuerRow ? tot(issuerRow) : 0;
  const supply = n(info.supply);
  const bid = n(metrics.highestBid), ask = n(metrics.lowestAsk);
  return {
    symbol,
    name: info.name,
    issuer: info.issuer,
    maxSupply: n(info.maxSupply),
    supply,
    circulating: n(info.circulatingSupply),
    staked: n(info.totalStaked),
    stakedPct: supply ? +(100 * n(info.totalStaked) / supply).toFixed(1) : 0,
    rows: rows.length,
    holdingAnything: held.length,
    emptyNow: rows.length - held.length,
    dust: held.filter((r) => tot(r) < 1).length,
    ge1: tier(1), ge10: tier(10), ge100: tier(100), ge1000: tier(1000),
    issuerAmt,
    issuerPct: supply ? +(100 * issuerAmt / supply).toFixed(1) : 0,
    lastPriceHive: n(metrics.lastPrice),
    volume24hHive: n(metrics.volume),
    spreadRatio: bid > 0 ? +(ask / bid).toFixed(0) : null,
    capAtParityUsd: hivePriceUsd ? Math.round(supply * hivePriceUsd) : null,
  };
}

/** the current HIVE median price in USD — 0 if it cannot be read (never throws) */
export async function hiveUsd(fetchImpl = globalThis.fetch) {
  try {
    const r = await fetchImpl('https://api.hive.blog', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_current_median_history_price', params: [], id: 1 }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json();
    const b = parseFloat(j.result.base), q = parseFloat(j.result.quote);
    return q ? +(b / q).toFixed(4) : 0;
  } catch { return 0; }
}

if (process.argv[1] && process.argv[1].endsWith('token-specs-refresh.mjs')) {
  const syms = process.argv.slice(2).length ? process.argv.slice(2) : ['VKBT', 'CURE'];
  const price = await hiveUsd();
  console.log(`HIVE median feed: $${price || '(unavailable)'}    capture date: ${new Date().toISOString().slice(0, 10)}\n`);
  for (const s of syms) {
    const d = await liveSpecs(s, { hivePriceUsd: price }).catch((e) => ({ error: e.message }));
    if (!d) { console.log(`${s}: not found`); continue; }
    if (d.error) { console.log(`${s}: INCOMPLETE READ — ${d.error}\n  (no numbers printed; a partial read is how the wrong counts got published)`); continue; }
    console.log(`=== ${d.symbol} — "${d.name}"  (issuer @${d.issuer})`);
    console.log(`  supply ${fmt(d.supply)} of a ${fmt(d.maxSupply)} cap · circulating ${fmt(d.circulating)}`);
    console.log(`  staked ${fmt(d.staked)} (${d.stakedPct}% of supply)`);
    console.log(`  balance rows ${fmt(d.rows)} · holding anything ${fmt(d.holdingAnything)} · empty now ${fmt(d.emptyNow)}`);
    console.log(`  dust (<1) ${fmt(d.dust)} · >=1 ${fmt(d.ge1)} · >=10 ${fmt(d.ge10)} · >=100 ${fmt(d.ge100)} · >=1000 ${fmt(d.ge1000)}`);
    console.log(`  issuer holds ${fmt(d.issuerAmt)} (${d.issuerPct}%)`);
    console.log(`  last ${d.lastPriceHive} HIVE · 24h volume ${d.volume24hHive} HIVE · ask/bid spread ${d.spreadRatio ?? '—'}x`);
    console.log(`  cap at 1:1 HIVE: ${d.capAtParityUsd != null ? '$' + fmt(d.capAtParityUsd) : '—'}\n`);
  }
  console.log('→ paste these into TOKEN_SPECS in integrations/token-specs.mjs and bump CAPTURE.date.');
}
