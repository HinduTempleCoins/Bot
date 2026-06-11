// holder-inequality.mjs — PURE holder-inequality calculator. No network, no keys, no IO seams needed.
//
// holders.mjs only NAMES holders; market-depth.mjs only sums top-holder pct. Neither computes the
// standard inequality measures from a raw balance vector. This module does exactly that, deterministically:
//
//   gini(balances)                      — Gini coefficient, 0 = perfect equality, →1 = one whale holds all
//   nakamotoCoefficient(balances, t)    — min # of holders that together control ≥ t (default 0.51) of supply
//   topNShare(balances, n)              — % of supply held by the top-n holders
//   lorenzPoints(balances)              — [{x,y}] cumulative-population vs cumulative-wealth curve (for plotting)
//   herfindahl(balances)                — HHI: sum of squared shares (0→1; higher = more concentrated)
//   inequality(balances, {issuer})      — combined summary { gini, nakamoto, top10, top1, whaleCount, herfindahl }
//
// Input is an array of numeric balances OR {account,total} / {account,percentOfSupply} objects — both are
// accepted and coerced with Number. Soft-fail: empty/invalid input returns zeros, never throws.
//
//   node integrations/holder-inequality.mjs           — demo against the local holder-history.json whale arrays
//   import { gini, nakamotoCoefficient, topNShare, lorenzPoints, herfindahl, inequality } from './holder-inequality.mjs'

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Coerce a heterogeneous input array into a clean array of finite, non-negative numbers.
// Accepts: plain numbers, numeric strings, or objects with a balance-ish field
// (total / balance / bal / amount / value, or percentOfSupply / pct as a fallback weight).
function toBalances(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const item of input) {
    let v;
    if (item != null && typeof item === 'object') {
      v = item.total ?? item.balance ?? item.bal ?? item.amount ?? item.value
        ?? item.percentOfSupply ?? item.pct;
    } else {
      v = item;
    }
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) out.push(n);
  }
  return out;
}

// Gini coefficient via the standard sorted-cumulative formula.
//   G = (2 * Σ i*x_i) / (n * Σ x_i) - (n + 1) / n     with x sorted ascending, i = 1..n
// 0 = perfect equality; →1 = maximal inequality (one holder has everything).
export function gini(balances) {
  const x = toBalances(balances).sort((a, b) => a - b);
  const n = x.length;
  if (n === 0) return 0;
  const sum = x.reduce((a, b) => a + b, 0);
  if (sum <= 0) return 0; // all-zero vector — treat as perfectly equal
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * x[i];
  const g = (2 * weighted) / (n * sum) - (n + 1) / n;
  // clamp tiny negative float noise (e.g. perfect equality lands at exactly 0 but FP can dip below)
  return g < 0 ? 0 : g;
}

// Nakamoto coefficient: the minimum number of (largest) holders whose combined share reaches `threshold`
// of total supply. The classic decentralization metric — smaller = more capturable.
export function nakamotoCoefficient(balances, threshold = 0.51) {
  const x = toBalances(balances).sort((a, b) => b - a); // descending
  const sum = x.reduce((a, b) => a + b, 0);
  if (sum <= 0 || x.length === 0) return 0;
  const t = Number(threshold);
  const target = (Number.isFinite(t) ? t : 0.51) * sum;
  let acc = 0;
  for (let i = 0; i < x.length; i++) {
    acc += x[i];
    if (acc >= target) return i + 1;
  }
  return x.length;
}

// Percentage of total supply held by the top-n holders.
export function topNShare(balances, n) {
  const x = toBalances(balances).sort((a, b) => b - a);
  const sum = x.reduce((a, b) => a + b, 0);
  if (sum <= 0) return 0;
  const k = Math.max(0, Math.floor(Number(n) || 0));
  const top = x.slice(0, k).reduce((a, b) => a + b, 0);
  return +(top / sum * 100).toFixed(4);
}

// Lorenz-curve points: cumulative share of population (x) vs cumulative share of wealth (y),
// holders sorted ascending. Returns [{x:0,y:0}, ..., {x:1,y:1}]. Useful for plotting the curve
// whose gap from the diagonal IS the Gini area.
export function lorenzPoints(balances) {
  const x = toBalances(balances).sort((a, b) => a - b);
  const n = x.length;
  const points = [{ x: 0, y: 0 }];
  if (n === 0) return points;
  const sum = x.reduce((a, b) => a + b, 0);
  let cum = 0;
  for (let i = 0; i < n; i++) {
    cum += x[i];
    points.push({
      x: +((i + 1) / n).toFixed(6),
      y: sum > 0 ? +(cum / sum).toFixed(6) : +((i + 1) / n).toFixed(6),
    });
  }
  return points;
}

// Herfindahl-Hirschman Index on supply shares: Σ s_i^2 where s_i is holder i's fraction of supply.
// Ranges 1/n (perfectly equal) → 1 (one holder). Higher = more concentrated.
export function herfindahl(balances) {
  const x = toBalances(balances);
  const sum = x.reduce((a, b) => a + b, 0);
  if (sum <= 0) return 0;
  let hhi = 0;
  for (const v of x) { const s = v / sum; hhi += s * s; }
  return +hhi.toFixed(6);
}

// Combined inequality summary. `issuer` (optional) lets a caller exclude the issuer's own holdings
// from the inequality picture — the issuer's treasury is not "concentration among holders".
export function inequality(balances, { issuer } = {}) {
  let arr = Array.isArray(balances) ? balances : [];
  if (issuer) {
    arr = arr.filter(item =>
      !(item != null && typeof item === 'object' && item.account === issuer));
  }
  const x = toBalances(arr);
  const sum = x.reduce((a, b) => a + b, 0);
  // a "whale" here = any holder with > 1% of (post-issuer) supply
  const whaleCount = sum > 0 ? x.filter(v => v / sum > 0.01).length : 0;
  return {
    gini: +gini(x).toFixed(6),
    nakamoto: nakamotoCoefficient(x, 0.51),
    top10: topNShare(x, 10),
    top1: topNShare(x, 1),
    whaleCount,
    herfindahl: herfindahl(x),
    holders: x.length,
  };
}

// ── CLI demo (guarded) ───────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('holder-inequality.mjs')) {
  const here = dirname(fileURLToPath(import.meta.url));
  let data = {};
  try {
    data = JSON.parse(readFileSync(join(here, '..', 'holder-history.json'), 'utf8'));
  } catch (e) {
    console.log('holder-inequality demo — could not read holder-history.json:', e.message);
  }
  console.log('Holder-inequality (pure calculator)\n' + '─'.repeat(64));
  for (const [symbol, snaps] of Object.entries(data)) {
    const latest = Array.isArray(snaps) ? snaps[snaps.length - 1] : null;
    const whales = latest && Array.isArray(latest.whales) ? latest.whales : [];
    if (!whales.length) { console.log(`\n${symbol}: no whale data`); continue; }
    const s = inequality(whales);
    console.log(`\n${symbol} — ${whales.length} whales (from snapshot)`);
    console.log(`  gini ${s.gini}  nakamoto ${s.nakamoto}  HHI ${s.herfindahl}`);
    console.log(`  top1 ${s.top1}%  top10 ${s.top10}%  whales>1% ${s.whaleCount}`);
  }
  console.log('\n→ gini 0 = equal, →1 = one whale owns it all; nakamoto = holders needed to control 51%.');
}
