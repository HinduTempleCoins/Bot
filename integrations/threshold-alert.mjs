// threshold-alert.mjs — price-threshold alert evaluator (backlog 8dfd5cfecb). PURE deterministic
// decision core behind "weekly price alerts" / "token price change -> alert". It evaluates rules
// against a price and DECIDES whether an alert should fire — it sends NOTHING. Delivery is left to
// the existing integrations/notify-bus.mjs and integrations/telegram-bot.mjs.
//
// Pieces:
//   evaluate({rule, price, prev?}) — PURE. One rule vs one price → { fired, reason }.
//   evaluateAll(rules, ctx)        — PURE. Run many rules over a shared {price, prev} → fired results.
//   dedupeFires(fires, {windowMs, now}) — PURE. Collapse repeat fires of the same rule key inside a
//                                          window so a flapping price doesn't spam.
//
// Rule kinds:
//   { kind:'above',     value }            fires when price > value
//   { kind:'below',     value }            fires when price < value
//   { kind:'pctChange', value }            fires when |price-prev|/|prev| >= value (value is a fraction:
//                                            0.1 = 10%). Needs prev. Direction reported in reason.
//   { kind:'crossUp',   value }            fires when prev <= value AND price > value (an actual upward
//                                            crossing — NOT a steady state already above). Needs prev.
//   { kind:'crossDown', value }            fires when prev >= value AND price < value. Needs prev.
//
// Pure: time and price are injected; no Date.now in the decision path (only via a passed `now`); no
// network; soft-fail (a bad/unknown rule or non-finite price → { fired:false }); never throws.
// Follows integrations/notify-bus.mjs house style: ESM, soft-fail, CLI guarded by argv[1].

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

// ── evaluate: PURE. one rule vs one price → { fired, reason } ────────────────────────────────────
export function evaluate({ rule, price, prev } = {}) {
  try {
    if (!rule || typeof rule !== 'object') return { fired: false, reason: 'no rule' };
    const kind = String(rule.kind || '');
    const value = rule.value;
    if (!isNum(price)) return { fired: false, reason: 'price not finite' };
    if (!isNum(value)) return { fired: false, reason: 'rule value not finite' };

    switch (kind) {
      case 'above':
        return price > value
          ? { fired: true, reason: `price ${price} > ${value}` }
          : { fired: false, reason: `price ${price} <= ${value}` };

      case 'below':
        return price < value
          ? { fired: true, reason: `price ${price} < ${value}` }
          : { fired: false, reason: `price ${price} >= ${value}` };

      case 'pctChange': {
        if (!isNum(prev)) return { fired: false, reason: 'pctChange needs prev' };
        if (prev === 0) return { fired: false, reason: 'pctChange prev is 0' };
        const frac = Math.abs(price - prev) / Math.abs(prev);
        if (frac >= value) {
          const dir = price >= prev ? 'up' : 'down';
          const pct = (frac * 100).toFixed(2);
          return { fired: true, reason: `${dir} ${pct}% (>= ${(value * 100).toFixed(2)}%)` };
        }
        return { fired: false, reason: `change ${(frac * 100).toFixed(2)}% < ${(value * 100).toFixed(2)}%` };
      }

      case 'crossUp': {
        if (!isNum(prev)) return { fired: false, reason: 'crossUp needs prev' };
        return prev <= value && price > value
          ? { fired: true, reason: `crossed up through ${value} (${prev} -> ${price})` }
          : { fired: false, reason: `no up-cross of ${value} (${prev} -> ${price})` };
      }

      case 'crossDown': {
        if (!isNum(prev)) return { fired: false, reason: 'crossDown needs prev' };
        return prev >= value && price < value
          ? { fired: true, reason: `crossed down through ${value} (${prev} -> ${price})` }
          : { fired: false, reason: `no down-cross of ${value} (${prev} -> ${price})` };
      }

      default:
        return { fired: false, reason: `unknown kind '${kind}'` };
    }
  } catch (e) {
    return { fired: false, reason: `error: ${e?.message || e}` };
  }
}

// ── ruleKey: stable identity for a rule (used by dedupe and tagging) ─────────────────────────────
export function ruleKey(rule) {
  if (!rule || typeof rule !== 'object') return 'invalid';
  if (rule.id != null) return String(rule.id);
  return `${rule.kind ?? ''}|${rule.value ?? ''}`;
}

// ── evaluateAll: PURE. run many rules over a shared {price, prev} → fired results ─────────────────
// Returns ONLY the rules that fired, each as { rule, key, fired:true, reason }. Soft-fails per rule;
// a bad rule is simply skipped, never throws.
export function evaluateAll(rules = [], ctx = {}) {
  const list = Array.isArray(rules) ? rules : [];
  const { price, prev } = ctx || {};
  const out = [];
  for (const rule of list) {
    const r = evaluate({ rule, price, prev });
    if (r && r.fired) out.push({ rule, key: ruleKey(rule), fired: true, reason: r.reason });
  }
  return out;
}

// ── dedupeFires: PURE. collapse repeat fires of the same rule key inside a window ────────────────
// fires: array of fired results (from evaluateAll), each with a `key` (or a `rule` to derive one).
// Each fire may carry a `ts` (number). Otherwise `now` (a number, or function(fire,i)->number) is
// used; falling back to the array index so it is fully deterministic offline. Repeats of the same
// key whose ts is within windowMs of the last KEPT fire are collapsed (count incremented), so a
// flapping price doesn't spam. Returns the kept fires in input order.
export function dedupeFires(fires = [], { windowMs = 60_000, now } = {}) {
  const list = Array.isArray(fires) ? fires : [];
  const nowAt = (f, i) =>
    typeof f?.ts === 'number' ? f.ts : (typeof now === 'function' ? now(f, i) : (typeof now === 'number' ? now : i));
  const keyOf = (f) => (f?.key != null ? String(f.key) : ruleKey(f?.rule));
  const lastSeen = new Map(); // key → { ts, out }
  const out = [];
  list.forEach((f, i) => {
    const k = keyOf(f);
    const ts = nowAt(f, i);
    const prev = lastSeen.get(k);
    if (prev && ts - prev.ts <= windowMs) {
      prev.out.count = (prev.out.count || 1) + 1;
      prev.out.lastTs = ts;
      prev.ts = ts; // sliding window — chained repeats keep collapsing
      return;
    }
    const kept = { ...f, count: 1, lastTs: ts };
    out.push(kept);
    lastSeen.set(k, { ts, out: kept });
  });
  return out;
}

// ── CLI: tiny offline demo, guarded by argv[1] (no network, no send) ─────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const rules = [
    { id: 'btc-100k', kind: 'above', value: 100_000 },
    { id: 'btc-pct', kind: 'pctChange', value: 0.1 },
    { id: 'btc-cross', kind: 'crossUp', value: 95_000 },
  ];
  const fired = evaluateAll(rules, { price: 101_000, prev: 90_000 });
  const kept = dedupeFires([...fired, ...fired], { windowMs: 60_000, now: 1000 });
  console.log(JSON.stringify({ fired, kept }, null, 2));
}
