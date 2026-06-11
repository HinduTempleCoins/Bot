// capital-tier-classify.mjs — capital ROLE tier classifier for the token portfolio (queue #199f049fdc).
// PURE logic, NO network. Assigns each holding to one of three CAPITAL ROLE tiers describing what the
// holding is FOR — not whether to stake-vs-trade it (that is staking-decision.mjs). This is the queue's
// "3-tier strategy": premium long-term holds you protect, fuel you spend to operate, and tradeable
// inventory you actively churn.
//
//   premium    — long-term, protected, do-not-spend (VKBT, CURE). The strategic core.
//   fuel       — operational spend: pays for chain ops / signups / gas (BLURT). Keep a working float.
//   tradeable  — active inventory you rotate for return (BBH, POB).
//
// A default registry maps known symbols to tiers; callers can pass their own map and/or fallback tier.
// Unknown symbols fall back (default 'tradeable'). Empty input → zero totals. Never throws, no network.
//
//   node integrations/capital-tier-classify.mjs    # demo against a tiny fixture portfolio
//
// Exports: TIERS, DEFAULT_MAP, classify(), classifyHoldings(), tierTotals(), allocationPct(),
//          advice(), renderMarkdown(), esc().

// ── tiers + default registry ──────────────────────────────────────────────────
export const TIERS = ['premium', 'fuel', 'tradeable'];

export const DEFAULT_MAP = Object.freeze({
  VKBT: 'premium',
  CURE: 'premium',
  BLURT: 'fuel',
  BBH: 'tradeable',
  POB: 'tradeable',
});

// advice tunables (kept here so the rules are legible / testable)
const FUEL_FLOOR_USD = 25;     // below this much fuel value → top up to keep operating
const PREMIUM_MIN_PCT = 40;    // strategic core should be a meaningful share of the book
const TRADEABLE_MAX_PCT = 60;  // too much churn-inventory → over-exposed to active risk

// ── helpers ─────────────────────────────────────────────────────────────────
const num = (x, d = 0) => (Number.isFinite(+x) ? +x : d);
const isTier = (t) => TIERS.includes(t);
const round2 = (x) => +num(x).toFixed(2);

// Minimal HTML escape for any string that lands in markdown/HTML views. Never throws.
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const normSym = (s) => String(s == null ? '' : s).trim().toUpperCase();

// ── classify a single symbol ──────────────────────────────────────────────────
// classify(symbol, { map, fallback }) → tier string. Unknown / garbage → fallback.
export function classify(symbol, { map = DEFAULT_MAP, fallback = 'tradeable' } = {}) {
  const fb = isTier(fallback) ? fallback : 'tradeable';
  const sym = normSym(symbol);
  if (!sym) return fb;
  const m = (map && typeof map === 'object') ? map : DEFAULT_MAP;
  const t = m[sym];
  return isTier(t) ? t : fb;
}

// ── classify a holdings list ───────────────────────────────────────────────────
// classifyHoldings([{symbol, amount, valueUsd?}], opts) → [{symbol, tier, amount, valueUsd}]
export function classifyHoldings(holdings = [], opts = {}) {
  const list = Array.isArray(holdings) ? holdings : [];
  return list
    .map((h) => {
      if (!h || typeof h !== 'object') return null;
      const symbol = normSym(h.symbol);
      if (!symbol) return null;
      return {
        symbol,
        tier: classify(symbol, opts),
        amount: num(h.amount),
        valueUsd: round2(h.valueUsd),
      };
    })
    .filter(Boolean);
}

// ── tier totals ────────────────────────────────────────────────────────────────
// tierTotals(classified) → { premium:{count,valueUsd}, fuel:{...}, tradeable:{...} }
export function tierTotals(classified = []) {
  const out = {};
  for (const t of TIERS) out[t] = { count: 0, valueUsd: 0 };
  const rows = Array.isArray(classified) ? classified : [];
  for (const r of rows) {
    if (!r || !isTier(r.tier)) continue;
    out[r.tier].count += 1;
    out[r.tier].valueUsd += num(r.valueUsd);
  }
  for (const t of TIERS) out[t].valueUsd = round2(out[t].valueUsd);
  return out;
}

// ── allocation percentages (by value) ──────────────────────────────────────────
// allocationPct(classified) → { premium:pct, fuel:pct, tradeable:pct } summing to ~100 (0 when no value).
export function allocationPct(classified = []) {
  const totals = tierTotals(classified);
  const grand = TIERS.reduce((s, t) => s + totals[t].valueUsd, 0);
  const out = {};
  if (grand <= 0) {
    for (const t of TIERS) out[t] = 0;
    return out;
  }
  for (const t of TIERS) out[t] = round2((totals[t].valueUsd / grand) * 100);
  return out;
}

// ── advice (simple rule strings) ───────────────────────────────────────────────
// advice(totals) → ['protect fuel: BLURT below threshold', ...]. Accepts a totals object
// (from tierTotals) OR a classified array (convenience). Always an array, never throws.
export function advice(totals) {
  let t = totals;
  if (Array.isArray(totals)) t = tierTotals(totals);
  if (!t || typeof t !== 'object') t = tierTotals([]);
  const get = (k) => (t[k] && typeof t[k] === 'object') ? t[k] : { count: 0, valueUsd: 0 };
  const premium = get('premium');
  const fuel = get('fuel');
  const tradeable = get('tradeable');
  const grand = num(premium.valueUsd) + num(fuel.valueUsd) + num(tradeable.valueUsd);

  const out = [];

  // fuel floor — you must keep enough operating fuel to actually run ops.
  if (fuel.count === 0) {
    out.push('protect fuel: no fuel-tier holding — acquire BLURT (or fuel token) to pay for chain ops.');
  } else if (num(fuel.valueUsd) < FUEL_FLOOR_USD) {
    out.push(`protect fuel: below $${FUEL_FLOOR_USD} threshold (have $${round2(fuel.valueUsd)}) — top up before ops stall.`);
  }

  // premium core — the strategic hold should be a meaningful share.
  if (grand > 0) {
    const premiumPct = round2((num(premium.valueUsd) / grand) * 100);
    if (premium.count === 0) {
      out.push('grow premium: no premium-tier holding — build a protected core (VKBT/CURE).');
    } else if (premiumPct < PREMIUM_MIN_PCT) {
      out.push(`grow premium: only ${premiumPct}% in protected core (< ${PREMIUM_MIN_PCT}% target) — accumulate premium.`);
    }

    // tradeable exposure — too much active inventory is risk.
    const tradeablePct = round2((num(tradeable.valueUsd) / grand) * 100);
    if (tradeablePct > TRADEABLE_MAX_PCT) {
      out.push(`trim tradeable: ${tradeablePct}% in churn-inventory (> ${TRADEABLE_MAX_PCT}% cap) — rotate gains into premium.`);
    }
  } else {
    out.push('no valued holdings: nothing to allocate — fund the book before tiering.');
  }

  if (out.length === 0) out.push('balanced: premium core, fuel float, and tradeable inventory are all within target.');
  return out;
}

// ── markdown render ─────────────────────────────────────────────────────────────
// renderMarkdown(classified) → a small report (table + allocation + advice). String, never throws.
export function renderMarkdown(classified = []) {
  const rows = Array.isArray(classified) ? classified : [];
  const totals = tierTotals(rows);
  const pct = allocationPct(rows);
  const tips = advice(totals);

  const lines = [];
  lines.push('# Capital Tier Classification');
  lines.push('');
  lines.push('| Symbol | Tier | Amount | Value (USD) |');
  lines.push('|---|---|---:|---:|');
  if (rows.length === 0) {
    lines.push('| _(none)_ | — | 0 | 0 |');
  } else {
    for (const r of rows) {
      lines.push(`| ${esc(r.symbol)} | ${esc(r.tier)} | ${num(r.amount)} | $${round2(r.valueUsd)} |`);
    }
  }
  lines.push('');
  lines.push('## Allocation by value');
  for (const t of TIERS) {
    lines.push(`- **${esc(t)}**: ${totals[t].count} holding(s), $${totals[t].valueUsd} (${pct[t]}%)`);
  }
  lines.push('');
  lines.push('## Advice');
  for (const a of tips) lines.push(`- ${esc(a)}`);
  return lines.join('\n');
}

// ───────────────────────────── CLI ─────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('capital-tier-classify.mjs')) {
  const holdings = [
    { symbol: 'VKBT', amount: 1000, valueUsd: 300 },
    { symbol: 'CURE', amount: 500, valueUsd: 120 },
    { symbol: 'BLURT', amount: 4000, valueUsd: 18 },
    { symbol: 'BBH', amount: 2000, valueUsd: 90 },
    { symbol: 'POB', amount: 300, valueUsd: 60 },
    { symbol: 'MYSTERY', amount: 10, valueUsd: 5 }, // unknown → fallback tier
  ];
  const classified = classifyHoldings(holdings);
  console.log('Capital tier classifier (PURE — no network)');
  console.log('='.repeat(60));
  console.log(renderMarkdown(classified));
}
