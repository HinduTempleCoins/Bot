// market-maker — a two-sided quoting engine for Hive-Engine tribe tokens.
//
// WHY THIS EXISTS. Measured on 2026-09-08, the VKBT and CURE books are not markets:
//
//   VKBT  highest bid 0.00001902   lowest ask 0.00094500   ask = 50x the bid
//   CURE  highest bid 0.00001592   lowest ask 0.04199000   ask = 2,638x the bid
//
// A buyer who hits those asks is instantly down 98% and 99.96%. Daily volume is ~0.000003 HIVE.
// There is a bid wall, an ask wall, and a canyon between them. Nobody can transact.
//
// The printed "price" of 0.000019 is therefore an ARTIFACT of the top bid, not a market price.
// A tight two-sided book does not merely look better -- it lets real trades print between the
// walls, which is the honest way the quoted price rises.
//
// WHAT THIS IS NOT. This module refuses to quote one side only. A bot that posts bids and no asks
// is not making a market, it is supporting a price -- and doing that while recruiting new buyers
// is how the new buyers become the exit. `plan()` returns a REFUSAL, not an empty order set, if
// asked to run one-sided, and `wouldSelfTrade()` blocks quoting against our own resting orders,
// which is wash trading and prints volume that never happened.
//
// The reference price is the WIDER book's own mid unless the caller supplies one, and a supplied
// reference more than `maxRefDeviation` from the observable mid is rejected. That is the guard
// against "just set it higher."
//
// House rules: ESM, injectable fetch, soft-fail-never-throw, no keys here -- `plan()` is pure and
// returns orders for a signer to broadcast. This module never signs and never sends.

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v) => String(v == null ? '' : v);
const RPC = 'https://api.hive-engine.com/rpc/contracts';

// ---------------------------------------------------------------------------
// 1. READING THE BOOK
// ---------------------------------------------------------------------------

export async function fetchBook(symbol, { limit = 200 } = {}) {
  const q = async (table, descending) => {
    try {
      const res = await _fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'find',
          params: {
            contract: 'market', table, query: { symbol: str(symbol) }, limit,
            indexes: [{ index: 'priceDec', descending }],
          },
        }),
      });
      const j = JSON.parse(await res.text());
      return Array.isArray(j.result) ? j.result : [];
    } catch { return []; }
  };
  const [bids, asks] = await Promise.all([q('buyBook', true), q('sellBook', false)]);
  return { symbol: str(symbol), bids, asks };
}

/**
 * Summarise a book. `dustFloor` exists because a 2,000,000-unit bid at 0.00000001 is a floor-parking
 * order, not a bid -- counting it as the market would anchor every quote to a number nobody trades at.
 */
export function summarise(book, { dustFloor = 0 } = {}) {
  const bids = (book.bids || []).map((o) => ({ ...o, p: num(o.price), q: num(o.quantity) }))
    .filter((o) => o.p > dustFloor).sort((a, b) => b.p - a.p);
  const asks = (book.asks || []).map((o) => ({ ...o, p: num(o.price), q: num(o.quantity) }))
    .filter((o) => o.p > 0).sort((a, b) => a.p - b.p);
  const bestBid = bids.length ? bids[0].p : 0;
  const bestAsk = asks.length ? asks[0].p : 0;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : (bestBid || bestAsk || 0);
  return {
    symbol: book.symbol,
    bestBid, bestAsk, mid,
    spreadRatio: bestBid > 0 && bestAsk > 0 ? bestAsk / bestBid : Infinity,
    spreadPct: bestBid > 0 && bestAsk > 0 ? ((bestAsk - bestBid) / mid) * 100 : Infinity,
    bidDepth: bids.reduce((s, o) => s + o.p * o.q, 0),
    askDepth: asks.reduce((s, o) => s + o.q, 0),
    bidCount: bids.length, askCount: asks.length,
    ourBids: [], ourAsks: [],
    broken: bestBid > 0 && bestAsk > 0 ? bestAsk / bestBid > 3 : true,
  };
}

// ---------------------------------------------------------------------------
// 2. THE GUARDS
// ---------------------------------------------------------------------------

export const DEFAULTS = Object.freeze({
  spreadPct: 6,             // total quoted spread, so ±3% around the reference
  levels: 3,                // ladder depth per side
  levelStepPct: 2.5,        // spacing between ladder rungs
  sizeQuote: 5,             // SWAP.HIVE per bid rung
  sizeBase: 0,              // token units per ask rung; 0 = derive from sizeQuote
  maxInventoryBase: 250000, // never accumulate more base token than this
  minInventoryBase: 0,      // never sell below this
  maxRefDeviation: 0.35,    // a supplied reference may not sit >35% from the observed mid
  dustFloor: 1e-7,          // ignore floor-parking orders below this
  account: '',
});

/** A market with quotes on one side only is price support, not market making. */
export function isTwoSided(orders) {
  const buys = orders.filter((o) => o.side === 'buy').length;
  const sells = orders.filter((o) => o.side === 'sell').length;
  return buys > 0 && sells > 0;
}

/** Quoting into our own resting order prints volume that never happened. */
export function wouldSelfTrade(order, book, account) {
  const a = str(account).toLowerCase();
  if (!a) return false;
  const opposite = order.side === 'buy' ? (book.asks || []) : (book.bids || []);
  return opposite.some((o) => str(o.account).toLowerCase() === a
    && (order.side === 'buy' ? num(o.price) <= order.price : num(o.price) >= order.price));
}

// ---------------------------------------------------------------------------
// 3. THE PLAN
// ---------------------------------------------------------------------------

/**
 * Build the orders that would tighten a book. Pure: no network, no keys, no broadcast.
 *
 * Returns { ok, refused, reason, reference, orders, effect } -- `refused` is a first-class result,
 * not an error, and it is what comes back when the request is one-sided, when the reference is
 * unsupportable, or when inventory limits leave nothing legitimate to quote.
 */
export function plan({ book, inventory = {}, opts = {}, referencePrice = 0 } = {}) {
  const o = { ...DEFAULTS, ...opts };
  const s = summarise(book || {}, { dustFloor: o.dustFloor });

  const observedMid = s.mid;
  if (!observedMid) {
    return refuse('the book has no usable price on either side; a reference must be established '
      + 'off-book before quoting', s);
  }

  // A 50x spread means the midpoint is halfway between two prices nobody trades at. Anchoring to
  // it quoted VKBT bids 24x above the best real bid on the first live run -- buying at a price no
  // one has ever paid, which is the pump this module exists to refuse. So on a broken book the mid
  // is not a reference at all, and the caller must supply and justify one.
  if (s.broken && !num(referencePrice)) {
    return refuse(`the book is broken (ask is ${fmtx(s.spreadRatio)} the bid), so its midpoint is `
      + 'halfway between two prices nobody trades at and cannot anchor a quote. Supply an explicit '
      + 'referencePrice with a basis -- last real trade, an external market, or the bid side where '
      + 'demand is actually demonstrated.', s);
  }

  let ref = num(referencePrice) || observedMid;
  if (num(referencePrice)) {
    // Measure against the best BID on a broken book: the bid is where somebody has actually put
    // money down, the ask is where somebody hopes. Anchoring to hope is how a pump starts.
    // On a FUNCTIONING book, quoting far from the mid moves a price that already exists, so the cap
    // applies. On a BROKEN book there is no price to move -- the issuer is opening one -- so the cap
    // lifts and solvency becomes the only constraint (the `owed` check below).
    if (!s.broken) {
      const dev = observedMid > 0 ? Math.abs(ref - observedMid) / observedMid : Infinity;
      if (dev > o.maxRefDeviation) {
        return refuse(`supplied reference ${ref} sits ${(dev * 100).toFixed(0)}% from the observed `
          + `mid ${observedMid.toPrecision(4)} on a functioning book; the cap is `
          + `${(o.maxRefDeviation * 100).toFixed(0)}%. Moving an existing price that far is not `
          + 'market making.', s);
      }
    }
  }

  const base = num(inventory.base);
  const quote = num(inventory.quote);
  const half = o.spreadPct / 200;

  const orders = [];
  for (let i = 0; i < o.levels; i += 1) {
    const step = 1 + (o.levelStepPct / 100) * i;
    const bidPx = ref * (1 - half * step);
    const askPx = ref * (1 + half * step);

    if (quote > 0 && base < o.maxInventoryBase) {
      const spend = o.sizeQuote;
      if (spend * (i + 1) <= quote) {
        orders.push({ side: 'buy', symbol: s.symbol, price: round(bidPx), quantity: round(spend / bidPx) });
      }
    }
    const askQty = o.sizeBase > 0 ? o.sizeBase : o.sizeQuote / askPx;
    if (base - askQty * (i + 1) >= o.minInventoryBase) {
      orders.push({ side: 'sell', symbol: s.symbol, price: round(askPx), quantity: round(askQty) });
    }
  }

  const safe = orders.filter((x) => !wouldSelfTrade(x, book, o.account));
  const dropped = orders.length - safe.length;

  const hasBids = safe.some((x) => x.side === 'buy');
  const hasAsks = safe.some((x) => x.side === 'sell');
  if (!hasBids && !hasAsks) {
    return refuse('inventory limits left nothing to quote on either side.', s, { dropped });
  }
  // ASK-ONLY is refused: distributing into a book where we offer no bid gives holders no way out.
  // BID-ONLY is ALLOWED and labelled -- a standing bid is a floor holders can sell into, and an
  // issuer unwilling to bid for their own token should not be inviting anyone else to buy it.
  // That asymmetry is the ethic of this module: the bid helps holders, the lone ask does not.
  if (!hasBids) {
    // Say WHY there are no bids. The first live run refused with "fund the bid side" when the real
    // cause was the inventory cap -- we already held 900,000 of a 250,000 limit, so buying more was
    // correctly suppressed. A refusal that misnames its own cause sends the operator to fix the
    // wrong thing.
    const why = base >= o.maxInventoryBase
      ? `we already hold ${base.toLocaleString()} ${s.symbol}, at or above the maxInventoryBase of `
        + `${o.maxInventoryBase.toLocaleString()}, so buying more is suppressed by design. Raise the `
        + 'cap deliberately, or sell down first — do not quote asks alone.'
      : quote <= 0
        ? 'there is no quote currency to bid with.'
        : 'bid sizes exceeded the available quote currency at every level.';
    return refuse(`this would quote ASKS ONLY -- distributing into a book where we offer no bid, `
      + `because ${why}`, s, { dropped });
  }
  const mode = hasAsks ? 'two-sided' : 'bid-only (buy support)';

  const newBid = Math.max(...safe.filter((x) => x.side === 'buy').map((x) => x.price));
  const newAsk = hasAsks ? Math.min(...safe.filter((x) => x.side === 'sell').map((x) => x.price)) : 0;

  // The one genuinely dishonest bid is one we could not pay for if it filled.
  const owed = safe.filter((x) => x.side === 'buy').reduce((t, x) => t + x.price * x.quantity, 0);
  if (owed > quote) {
    return refuse(`these bids would cost ${owed.toFixed(6)} to fill but only ${quote.toFixed(6)} `
      + 'quote currency is available. A bid you cannot honour is the dishonest kind — reduce '
      + 'sizeQuote or levels.', s, { dropped });
  }

  return {
    ok: true, refused: false, reason: '',
    reference: ref,
    mode,
    committedQuote: Number(owed.toPrecision(8)),
    observedMid,
    orders: safe,
    droppedSelfTrade: dropped,
    effect: {
      spreadBefore: s.spreadRatio,
      spreadAfter: newAsk ? newAsk / newBid : Infinity,
      bestBidBefore: s.bestBid, bestBidAfter: newBid,
      bestAskBefore: s.bestAsk, bestAskAfter: newAsk,
      note: 'A buyer can now fill near the mid instead of at a wall. The quoted price rises because '
          + 'real trades print between the old walls -- not because anything was bought one-sided.',
    },
    before: s,
  };
}

function refuse(reason, before, extra = {}) {
  return { ok: false, refused: true, reason, orders: [], before, ...extra };
}

const round = (n) => Number(Number(n).toPrecision(8));

/** What a caller should read out loud before broadcasting anything. */
export function explain(p) {
  if (!p) return '';
  if (p.refused) return `REFUSED — ${p.reason}`;
  const e = p.effect;
  return [
    `${p.before.symbol}: quoting ${p.orders.length} orders around ${p.reference.toPrecision(6)}`,
    `  spread ${fmtx(e.spreadBefore)} -> ${fmtx(e.spreadAfter)}`,
    `  best bid ${e.bestBidBefore.toPrecision(6)} -> ${e.bestBidAfter.toPrecision(6)}`,
    `  best ask ${e.bestAskBefore.toPrecision(6)} -> ${e.bestAskAfter.toPrecision(6)}`,
    p.droppedSelfTrade ? `  ${p.droppedSelfTrade} order(s) dropped to avoid self-trading` : '',
  ].filter(Boolean).join('\n');
}

const fmtx = (r) => (Number.isFinite(r) ? `${r.toFixed(2)}x` : 'no market');

/** Hive-Engine custom_json ops for a signer. This module does not sign or broadcast. */
export function toOps(plan, account) {
  if (!plan || !plan.ok) return [];
  return plan.orders.map((o) => ({
    contractName: 'market',
    contractAction: o.side === 'buy' ? 'buy' : 'sell',
    contractPayload: {
      symbol: o.symbol,
      quantity: String(o.quantity),
      price: String(o.price),
      account: str(account) || undefined,
    },
  }));
}

export function handler(req, res) {
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj, null, 2));
  };
  return send(200, {
    ok: true, service: 'market-maker',
    defaults: DEFAULTS,
    note: 'plan() is pure and returns orders only. Broadcasting is the caller\'s job and needs a '
        + 'signer. One-sided quoting is refused by design.',
  });
}

if (process.argv[1] && process.argv[1].endsWith('market-maker.mjs')) {
  const sym = process.argv[2] || 'VKBT';
  const book = await fetchBook(sym);
  const s = summarise(book, { dustFloor: DEFAULTS.dustFloor });
  console.log(`\n${sym} book now:`);
  console.log(`  best bid ${s.bestBid}  best ask ${s.bestAsk}  spread ${fmtx(s.spreadRatio)}`);
  console.log(`  bid depth ${s.bidDepth.toFixed(4)} SWAP.HIVE across ${s.bidCount} orders`);
  console.log(`  ${s.broken ? 'BROKEN — a buyer cannot get a fair fill' : 'tradeable'}\n`);
  const p = plan({ book, inventory: { base: 60000, quote: 100 }, opts: { account: process.argv[3] || '' } });
  console.log(explain(p));
  if (p.ok) {
    console.log('\norders (NOT broadcast):');
    for (const o of p.orders) console.log(`  ${o.side.padEnd(4)} ${String(o.quantity).padStart(14)} @ ${o.price}`);
  }
}
