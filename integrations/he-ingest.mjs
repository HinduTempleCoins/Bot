// he-ingest.mjs — HIVE-Engine market-data ingestion → brief-ready notes on token movement (task #70).
// Turns two snapshots (a previous baseline + the current pull) into the "### Token movement" section
// the 24/7 brief writers splice, so a brief can say "VKBT moved +12% on rising volume" without the
// writer re-deriving anything from raw RPC.
//
// Reuses the existing READ-ONLY client (hive-engine-market.mjs → he-client.mjs) for the live pull via a
// defensive import — it does NOT reinvent the RPC. The source is injectable (__setSource) so the tests
// run fully offline against canned token snapshots. No keys, no secrets, soft-fails to [] / '' — never
// throws. ADVISORY/observational only: it reads and reports, it places no orders and signs nothing.
//
//   node integrations/he-ingest.mjs                 # print the token-movement brief section
//   node integrations/he-ingest.mjs --json          # raw movement records
//   import { tokenMovement, ingest, briefNotes, watchlist } from './he-ingest.mjs'

// ── default watchlist ──────────────────────────────────────────────────────────────────────────
// The small, documented set of tokens we track for the briefs. Kept short on purpose — the briefs
// want the operator's own tokens (VKBT = Van Kush Beauty token, CURE) plus the few SWAP wrappers that
// actually carried the trade-bot's flow (LTC was the bleed; BLURT/DOGE the arbitrage that worked).
// Env-overridable via HE_INGEST_WATCH so the operator can change it without editing code.
const DEFAULT_WATCH = ['VKBT', 'CURE', 'SWAP.LTC', 'SWAP.BLURT', 'SWAP.DOGE'];

/** The default tokens to track. Env override: HE_INGEST_WATCH="VKBT,CURE,...". */
export function watchlist() {
  const v = (process.env.HE_INGEST_WATCH || '').trim();
  if (!v) return [...DEFAULT_WATCH];
  return v.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

// ── thresholds (env-overridable) ───────────────────────────────────────────────────────────────
// A move is "notable" when |priceChangePct| clears NOTABLE_PCT. Below FLAT_PCT it reads as 'flat'
// (noise, not a move). FLAT sits below NOTABLE so a move is either flat, a direction-only blip, or notable.
const num = (v, d) => (v != null && v !== '' && Number.isFinite(+v) ? +v : d);
const NOTABLE_PCT = num(process.env.HE_NOTABLE_PCT, 5);   // % price change worth flagging
const FLAT_PCT = num(process.env.HE_FLAT_PCT, 0.5);       // % below which a move is "flat" (noise)

// numeric coercion that yields null (not 0) on garbage — so "missing" reads as null, not a real value.
function n(x) { const v = +x; return Number.isFinite(v) ? v : null; }

// percent change from a → b. null if we can't compute it (missing base or zero base).
function changePct(a, b) {
  const x = n(a), y = n(b);
  if (x == null || y == null || x === 0) return null;
  return +(((y - x) / x) * 100).toFixed(2);
}

/**
 * Compare a previous and a current snapshot of ONE token. Pure — no I/O, never throws.
 * Each snapshot is a flat object: { symbol, price, volume24h } (extra fields ignored).
 *
 * @param {{symbol?:string, price?:number, volume24h?:number}} prev
 * @param {{symbol?:string, price?:number, volume24h?:number}} curr
 * @returns {{ symbol:string, price:(number|null), priceChangePct:(number|null),
 *             volumeChangePct:(number|null), direction:'up'|'down'|'flat', notable:boolean }}
 */
export function tokenMovement(prev, curr) {
  const p = prev || {};
  const c = curr || {};
  const symbol = c.symbol || p.symbol || '?';

  const priceChangePct = changePct(p.price, c.price);
  const volumeChangePct = changePct(p.volume24h, c.volume24h);

  // direction off the price move; tiny moves (or unknown) read as 'flat'.
  let direction = 'flat';
  if (priceChangePct != null && Math.abs(priceChangePct) >= FLAT_PCT) {
    direction = priceChangePct > 0 ? 'up' : 'down';
  }

  // notable only when the price move clears the bigger threshold.
  const notable = priceChangePct != null && Math.abs(priceChangePct) >= NOTABLE_PCT;

  return {
    symbol,
    price: n(c.price),
    priceChangePct,
    volumeChangePct,
    direction,
    notable,
  };
}

// ── injectable source ──────────────────────────────────────────────────────────────────────────
// source(symbol) → Promise<{symbol, price, volume24h}> (or null). Default wires to the existing
// read-only market client via a DEFENSIVE import so the RPC isn't reinvented and a missing/broken
// client module can't crash ingestion (it just yields null snapshots → no movements).
async function defaultSource(symbol) {
  let market;
  try { ({ market } = await import('./hive-engine-market.mjs')); }
  catch { return null; }
  if (!market || typeof market.metrics !== 'function') return null;
  try {
    const m = await market.metrics(symbol);
    if (!m) return null;
    return { symbol, price: n(m.lastPrice), volume24h: n(m.volume) };
  } catch { return null; }
}

let _source = defaultSource;
/** Inject the per-token snapshot source (tests pass a canned fn; default = read-only HE client). */
export function __setSource(fn) { _source = fn || defaultSource; }

/**
 * Fetch current snapshots for a watchlist (via the injected source), compare each against the passed-in
 * baseline, and return one movement record per token that had a comparable baseline. Soft-fails to []
 * (a thrown source, bad args — anything) so an unattended brief run never dies here.
 *
 * @param {string[]} tokens             tokens to ingest (defaults to watchlist())
 * @param {object} [opts]
 * @param {function} [opts.source]      override the snapshot source for this call
 * @param {object} [opts.baseline]      map symbol → previous snapshot {price, volume24h} to compare against
 * @returns {Promise<Array>} movement records (see tokenMovement); [] on any failure
 */
export async function ingest(tokens, { source, baseline } = {}) {
  try {
    const list = Array.isArray(tokens) && tokens.length ? tokens : watchlist();
    const src = source || _source;
    const base = baseline || {};

    const out = [];
    for (const symbol of list) {
      // each token's fetch is isolated: one broken token can't sink the batch.
      let curr = null;
      try { curr = await src(symbol); } catch { curr = null; }
      const prev = base[symbol] || null;
      // need a baseline AND a current pull to compute a change; otherwise skip (nothing to report).
      if (!prev || !curr) continue;
      out.push(tokenMovement(prev, curr));
    }
    return out;
  } catch {
    return [];
  }
}

// ── brief rendering ──────────────────────────────────────────────────────────────────────────
const pctStr = (x) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${x}%`);
const ARROW = { up: '▲', down: '▼', flat: '▬' };

/**
 * Render movement records as the brief-ready "### Token movement" markdown section the writers splice.
 * Sorted by magnitude (biggest absolute price move first) so the headline mover leads. Notable moves
 * are bolded and flagged with their volume context. Pure, never throws, '' on no data.
 *
 * @param {Array} movements records from ingest()/tokenMovement()
 * @returns {string} markdown
 */
export function briefNotes(movements) {
  const recs = Array.isArray(movements) ? movements.filter(Boolean) : [];
  const L = [];
  L.push('### Token movement');
  L.push('*HIVE-Engine price/volume vs. the previous snapshot. Observational — no orders, no keys.*');
  L.push('');

  if (!recs.length) {
    L.push('- _No token movement this pass (no comparable baseline / source unavailable)._');
    return L.join('\n');
  }

  // biggest absolute price move first; unknown price-change sinks to the bottom.
  const mag = (r) => (r.priceChangePct == null ? -1 : Math.abs(r.priceChangePct));
  const sorted = [...recs].sort((a, b) => mag(b) - mag(a));

  for (const r of sorted) {
    const arrow = ARROW[r.direction] || ARROW.flat;
    // volume context — "on rising/falling volume" is exactly the phrasing the brief wants.
    let vol = '';
    if (r.volumeChangePct != null) {
      const trend = r.volumeChangePct > FLAT_PCT ? 'rising' : r.volumeChangePct < -FLAT_PCT ? 'falling' : 'flat';
      vol = ` on ${trend} volume (${pctStr(r.volumeChangePct)})`;
    }
    const head = `${arrow} **${r.symbol}** ${pctStr(r.priceChangePct)}${vol}`;
    L.push(r.notable ? `- **${head}** — notable move` : `- ${head}`);
  }

  L.push('');
  L.push(`*Threshold: notable ≥ ${NOTABLE_PCT}% price move. Engine: he-ingest.mjs · read-only.*`);
  return L.join('\n');
}

export default { tokenMovement, ingest, briefNotes, watchlist, __setSource };

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('he-ingest.mjs')) {
  // Live CLI has no stored baseline, so it pulls twice with a short gap to form prev→curr itself.
  const tokens = process.argv.filter((a) => /^[A-Z][A-Z0-9.]*$/.test(a));
  const list = tokens.length ? tokens : watchlist();
  const snap = async () => {
    const m = {};
    for (const s of list) { try { m[s] = await _source(s); } catch { m[s] = null; } }
    return m;
  };
  const baseline = await snap();
  await new Promise((r) => setTimeout(r, num(process.env.HE_INGEST_GAP_MS, 3000)));
  const movements = await ingest(list, { baseline });
  if (process.argv.includes('--json')) console.log(JSON.stringify(movements, null, 2));
  else console.log(briefNotes(movements));
}
