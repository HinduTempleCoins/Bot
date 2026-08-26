// gambling.mjs — Lottery / Gambling-odds vertical for SoapBox (queue #108). EDUCATION & ANALYTICS
// ONLY — this module never takes a bet, holds a stake, or settles money. It reads public lottery
// results, surfaces sportsbook odds you'd see quoted elsewhere, and computes the PURE math of the
// house edge for fixed table games so a reader can see exactly what the casino keeps.
//
// LEGAL FRAMING: publishing odds, results, and gambling education is ordinary speech and is legal.
// TAKING real-money bets — running a book on sports, operating a lottery, or offering event/prediction
// contracts — requires a licensed sportsbook (state gaming license) or, for event contracts, CFTC
// registration as a DCM. That is explicitly OUT OF SCOPE here. We inform; we do not accept wagers.
//
// Follows macro.mjs conventions: ESM, __setFetch hook, soft-fail (never throw to the caller), CLI
// guard. Live sources soft-fail to [] when their (optional) key is absent. The table-game odds and
// the implied-probability / vig helpers are PURE math with no network dependency.
//
// §4.7 (Mathematical, Gaming & Trading Engines) is now fully covered here as PURE, no-network math:
// odds converters (American ↔ decimal ↔ fractional ↔ implied), vig removal / implied fair probability,
// Expected Value (+EV), arbitrage / surebet detection with the stake split, and triangular ForEx
// arbitrage. Every one computes math or surfaces public odds/results only — none takes a bet, holds a
// stake, or settles money.

import { cached, TTL } from './cache.mjs';

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── PURE MATH: American odds ↔ implied probability, and the vig (overround) ────────────────────────

/**
 * Implied probability of an American moneyline price, as a fraction in (0,1).
 * Negative odds (favorite, e.g. -150): risk |odds| to win 100  →  p = |odds| / (|odds| + 100).
 * Positive odds (underdog, e.g. +130):  risk 100 to win odds    →  p = 100 / (odds + 100).
 * Returns null for non-finite / zero input. The implied probability is gross of the vig — i.e. the
 * book's posted number, which sums to more than 100% across a market (that excess IS the vig).
 */
export function impliedProbability(americanOdds) {
  const o = Number(americanOdds);
  if (!Number.isFinite(o) || o === 0) return null;
  return o < 0 ? (-o) / (-o + 100) : 100 / (o + 100);
}
// alias matching the brief's helper name
export const impliedFromAmerican = impliedProbability;

/**
 * Overround / vig for a two-way market given the two implied probabilities (each in (0,1)).
 * overround = pA + pB − 1 (the book's built-in margin, e.g. 0.0476 = 4.76%).
 * Also returns the margin as a % and the de-vigged "fair" probabilities (normalized to sum to 1).
 * Returns null on bad input. Named per the brief as vig(impliedA, impliedB).
 */
export function vig(impliedA, impliedB) {
  const a = Number(impliedA), b = Number(impliedB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const sum = a + b;
  if (sum <= 0) return null;
  return {
    overround: sum - 1,
    marginPct: (sum - 1) * 100,
    fairA: a / sum,
    fairB: b / sum,
  };
}

/**
 * Overround across an N-way market from a list of American odds (e.g. [-110, -110], or 3-way
 * soccer [+135, +230, +190]). Soft-fails to null on empty/invalid input. Returns the total booked
 * probability, the overround, the margin %, and per-runner fair (de-vigged) probabilities.
 * Named per the brief as vigOverround(list).
 */
export function vigOverround(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const implied = list.map((o) => impliedProbability(o));
  if (implied.some((p) => p == null)) return null;
  const booked = implied.reduce((s, p) => s + p, 0);
  if (booked <= 0) return null;
  return {
    runners: implied.length,
    bookedProbability: booked,
    overround: booked - 1,
    marginPct: (booked - 1) * 100,
    implied,
    fair: implied.map((p) => p / booked),
  };
}

// ── PURE MATH: §4.7 Odds converters ────────────────────────────────────────────────────────────────
// The engine "speaks decimal" internally (§4.7). These convert between the three common quote formats
// and the implied probability. All soft-fail to null on non-finite / out-of-range input. Decimal odds
// are the total return per 1 unit staked (stake included), so a real price is always > 1.

const _round = (x, n = 6) => (Number.isFinite(x) ? Number(x.toFixed(n)) : null);

/**
 * Implied probability of a decimal price: p = 1 / decimalOdds. Decimal odds are total return per unit
 * staked (must be > 1 for a real line). Returns null for non-finite / ≤ 1 input.
 */
export function impliedFromDecimal(decimalOdds) {
  const d = Number(decimalOdds);
  if (!Number.isFinite(d) || d <= 1) return null;
  return _round(1 / d);
}

/**
 * Decimal odds from an American moneyline. Positive (underdog): d = a/100 + 1. Negative (favorite):
 * d = 100/|a| + 1. Rounded to 4 dp. Returns null for zero / non-finite input.
 */
export function decimalFromAmerican(a) {
  const o = Number(a);
  if (!Number.isFinite(o) || o === 0) return null;
  const d = o > 0 ? o / 100 + 1 : 100 / (-o) + 1;
  return _round(d, 4);
}

/**
 * American moneyline from decimal odds. Even money (d = 2.0) → +100. d ≥ 2 → (d−1)·100 (positive);
 * 1 < d < 2 → −100/(d−1) (negative). Rounded to the nearest integer. Returns null for d ≤ 1 / non-finite.
 */
export function americanFromDecimal(d) {
  const dec = Number(d);
  if (!Number.isFinite(dec) || dec <= 1) return null;
  const a = dec >= 2 ? (dec - 1) * 100 : -100 / (dec - 1);
  return Math.round(a);
}

/**
 * Decimal odds from a fractional quote. Accepts '7/2' (string) or [7, 2] (array): the reader wins 7
 * for every 2 staked, so d = 7/2 + 1 = 4.5. Rounded to 4 dp. Returns null for a bad shape, a
 * non-positive / non-finite numerator or denominator, or a zero denominator.
 */
export function decimalFromFractional(frac) {
  let num, den;
  if (Array.isArray(frac) && frac.length === 2) {
    [num, den] = frac.map(Number);
  } else if (typeof frac === 'string' && frac.includes('/')) {
    [num, den] = frac.split('/').map((s) => Number(s.trim()));
  } else {
    return null;
  }
  if (!Number.isFinite(num) || !Number.isFinite(den) || num < 0 || den <= 0) return null;
  return _round(num / den + 1, 4);
}

// ── PURE MATH: §4.7 Expected Value (+EV) ─────────────────────────────────────────────────────────────
// Per §4.7: EV = (P_fair × Payout) − (1 − P_fair), where Payout is the NET profit on a win per unit
// staked (i.e. decimalOdds − 1). Positive ev ⇒ a +EV bet (your fair estimate of the outcome beats the
// price offered). This is analytics — the reader sizes and places any bet themselves, elsewhere.

/**
 * Expected value of a unit-consistent bet. { fairProb, payout, stake = 1 } where payout = net profit on
 * a win per unit stake (decimalOdds − 1). Returns { ev, evPct, edge }:
 *   edge  = per-unit EV  = P·payout − (1 − P)   (the +EV/−EV signal, independent of stake)
 *   ev    = edge × stake                        (EV in stake units)
 *   evPct = edge × 100                          (EV as a % of stake)
 * Validates fairProb ∈ (0,1), payout > 0, stake > 0. Non-finite / out-of-range ⇒ null (never throws).
 */
export function expectedValue({ fairProb, payout, stake = 1 } = {}) {
  const p = Number(fairProb), pay = Number(payout), s = Number(stake);
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null;
  if (!Number.isFinite(pay) || pay <= 0) return null;
  if (!Number.isFinite(s) || s <= 0) return null;
  const edge = p * pay - (1 - p);
  return {
    ev: _round(edge * s),
    evPct: _round(edge * 100),
    edge: _round(edge),
  };
}

/**
 * Convenience wrapper: expected value straight from a decimal price. payout = decimalOdds − 1, then
 * expectedValue({ fairProb, payout, stake }). Returns null on any invalid input.
 */
export function evFromDecimal(decimalOdds, fairProb, stake = 1) {
  const d = Number(decimalOdds);
  if (!Number.isFinite(d) || d <= 1) return null;
  return expectedValue({ fairProb, payout: d - 1, stake });
}

// ── PURE MATH: §4.7 Arbitrage / Surebet detection ───────────────────────────────────────────────────
// Per §4.7: an arbitrage (surebet) exists across a market when Σ (1/decimalOdds) < 1.0 — the combined
// implied probability is under 100%, so a stake split across every outcome locks a profit whichever
// wins. For a target total stake of 1, stake_i = (1/odds_i) / impliedSum, which returns 1/impliedSum on
// every outcome. Non-arb markets carry the bookmaker's positive margin instead. Detection only — SoapBox
// never places these legs; it shows the reader the math on prices quoted elsewhere.

/**
 * Arbitrage / surebet detector over a list of decimal odds (one per mutually-exclusive outcome; handles
 * 2-way and N-way). Returns:
 *   { isArb, impliedSum, marginPct, stakes, guaranteedProfitPct }
 *   impliedSum          = Σ (1/odds_i)
 *   isArb               = impliedSum < 1
 *   marginPct           = (impliedSum − 1) × 100  (the bookmaker margin — positive when NOT an arb)
 *   stakes              = fractional stake split for a total stake of 1 (sums to 1); equal return each way
 *   guaranteedProfitPct = (1/impliedSum − 1) × 100  (positive ⇔ arb; negative ⇒ a guaranteed loss)
 * Soft-fails to null on an empty/non-array list or any odds that is not finite and > 1.
 */
export function arbitrage(decimalOddsList) {
  if (!Array.isArray(decimalOddsList) || decimalOddsList.length === 0) return null;
  const odds = decimalOddsList.map(Number);
  if (odds.some((d) => !Number.isFinite(d) || d <= 1)) return null;
  const inv = odds.map((d) => 1 / d);
  const impliedSum = inv.reduce((s, x) => s + x, 0);
  if (impliedSum <= 0) return null;
  return {
    isArb: impliedSum < 1,
    impliedSum: _round(impliedSum),
    marginPct: _round((impliedSum - 1) * 100),
    stakes: inv.map((x) => _round(x / impliedSum)),
    guaranteedProfitPct: _round((1 / impliedSum - 1) * 100),
  };
}

// ── PURE MATH: §4.7 Triangular ForEx arbitrage ──────────────────────────────────────────────────────
// Per §4.7: three currency legs A→B→C→A. Consistent cross-rates multiply to 1; a deviation beyond fees
// is an arbitrage. Following the doc's EUR/USD × 1/(GBP/USD) × 1/(EUR/GBP): ratio = ab × (1/bc) × (1/ac).
// Pure rate-math — no live FX fetch on this path (a live version can wrap it later).

/**
 * Triangular ForEx arbitrage check over three cross-rates { ab, bc, ac } (all > 0). Computes
 * ratio = ab / (bc × ac) (the doc's ab × 1/bc × 1/ac). The profitable direction uses max(ratio, 1/ratio),
 * then nets out feePct (default 0) applied across the three conversion legs. Returns:
 *   { ratio, isArb, profitPct, cycle }
 *   ratio     = ab / (bc × ac)               (1.0 ⇔ perfectly consistent, no edge)
 *   cycle     = 'A→B→C→A' (ratio ≥ 1) or 'A→C→B→A' (ratio < 1) — the direction to trade
 *   profitPct = net % after fees in that direction
 *   isArb     = profitPct > 0
 * Soft-fails to null if any rate is not finite and > 0, or feePct is negative / non-finite.
 */
export function triangularArb({ ab, bc, ac } = {}, feePct = 0) {
  const a = Number(ab), b = Number(bc), c = Number(ac), fee = Number(feePct);
  if (![a, b, c].every((x) => Number.isFinite(x) && x > 0)) return null;
  if (!Number.isFinite(fee) || fee < 0) return null;
  const ratio = a / (b * c);
  const forward = ratio >= 1;
  const effRatio = forward ? ratio : 1 / ratio;
  const feeMult = (1 - fee / 100) ** 3; // three conversion legs
  const netRatio = effRatio * feeMult;
  const profitPct = (netRatio - 1) * 100;
  return {
    ratio: _round(ratio),
    isArb: profitPct > 0,
    profitPct: _round(profitPct),
    cycle: forward ? 'A→B→C→A' : 'A→C→B→A',
  };
}

// ── PURE MATH: fixed table-game house edges ────────────────────────────────────────────────────────
// House edge = the casino's expected hold as a fraction of the wager. These are textbook values for
// the named common rule sets; real tables vary with rules (deck count, payouts, restrictions), so
// each row notes the assumption. trueOdds = the fair payout that would make the bet break-even.

const ROULETTE = {
  // American wheel: 38 pockets (0, 00, 1–36). Even-money bet wins 18/38.
  'roulette-double-zero': {
    label: 'Roulette (American, 0 and 00)',
    pockets: 38, winning: 18,
    houseEdge: 2 / 38,            // 5.26%
    note: 'Double-zero wheel; every bet (except the 5-number) carries the same 5.26% edge.',
  },
  // European wheel: 37 pockets (single 0). Even-money bet wins 18/37.
  'roulette-single-zero': {
    label: 'Roulette (European, single 0)',
    pockets: 37, winning: 18,
    houseEdge: 1 / 37,            // 2.70%
    note: 'Single-zero wheel; "la partage"/"en prison" rules can halve the edge on even-money bets.',
  },
};

const TABLE_GAMES = {
  // Blackjack with standard liberal rules + correct basic strategy. The edge is rule-sensitive.
  blackjack: {
    label: 'Blackjack (basic strategy)',
    houseEdge: 0.005,            // ~0.5% under typical liberal rules, perfect basic strategy
    trueOddsNote: '3:2 natural blackjack payout assumed; 6:5 tables roughly triple the edge.',
    note: 'Edge depends heavily on rules (decks, dealer hits/stands soft 17, double/split, surrender) and on the player using correct basic strategy. Card counting is a separate, advantage-play topic.',
  },
  // Craps — the headline lines. The free odds bet behind a line is the only zero-edge bet in the house.
  'craps-pass': {
    label: 'Craps — Pass Line',
    houseEdge: 7 / 495,          // 1.41%
    note: 'Pass / Come line. Backing it with free odds dilutes the overall edge toward 0.',
  },
  'craps-dont-pass': {
    label: "Craps — Don't Pass",
    houseEdge: 3 / 220,          // ~1.36%
    note: "Don't Pass / Don't Come; marginally lower edge than the Pass line.",
  },
  'craps-field': {
    label: 'Craps — Field (2 & 12 pay double)',
    houseEdge: 1 / 18,           // 5.56%
    note: 'One-roll bet; edge drops to 2.78% if the 12 (or 2) pays triple.',
  },
};

// canonical alias map so callers can pass friendly names
const GAME_ALIASES = {
  roulette: 'roulette-double-zero',
  'roulette-american': 'roulette-double-zero',
  'roulette-european': 'roulette-single-zero',
  craps: 'craps-pass',
  '21': 'blackjack',
};

/**
 * Pure house-edge / true-odds lookup for a fixed table game. PURE math, no network.
 *   tableGameOdds('blackjack' | 'roulette' | 'roulette-single-zero' | 'craps' | 'craps-dont-pass' | ...)
 * Returns { game, label, houseEdge, houseEdgePct, rtp, note, ... } or null for an unknown game.
 * rtp = return-to-player = 1 − houseEdge. For roulette the trueOdds (fair payout) on the modeled
 * even-money bet is also returned so the reader sees the gap the house keeps.
 */
export function tableGameOdds(game) {
  if (!game || typeof game !== 'string') return null;
  const key = GAME_ALIASES[game.toLowerCase()] || game.toLowerCase();

  if (ROULETTE[key]) {
    const r = ROULETTE[key];
    const losing = r.pockets - r.winning;
    return {
      game: key, label: r.label,
      pockets: r.pockets, winning: r.winning, losing,
      houseEdge: r.houseEdge,
      houseEdgePct: r.houseEdge * 100,
      rtp: 1 - r.houseEdge,
      // fair (true) payout on the even-money bet: lose-to-win ratio. Casino pays 1:1; fair is higher.
      trueOdds: `${losing}:${r.winning} (≈ ${(losing / r.winning).toFixed(3)}:1) — casino pays 1:1`,
      note: r.note,
    };
  }

  if (TABLE_GAMES[key]) {
    const g = TABLE_GAMES[key];
    return {
      game: key, label: g.label,
      houseEdge: g.houseEdge,
      houseEdgePct: g.houseEdge * 100,
      rtp: 1 - g.houseEdge,
      ...(g.trueOddsNote ? { trueOddsNote: g.trueOddsNote } : {}),
      note: g.note,
    };
  }

  return null;
}

/** Every modeled table game, sorted by house edge (lowest = best for the player). PURE. */
export function tableGames() {
  const keys = [...Object.keys(ROULETTE), ...Object.keys(TABLE_GAMES)];
  return keys.map((k) => tableGameOdds(k)).filter(Boolean).sort((a, b) => a.houseEdge - b.houseEdge);
}

// ── LIVE (soft-fail) readers: lottery results & sports odds ─────────────────────────────────────────

// Public lottery feeds. NY Open Data exposes recent winning numbers keylessly (Socrata). magayo is a
// broader multi-game API but requires a free key — we soft-fail to a "key needed" marker when absent.
const LOTTERY_FEEDS = {
  // NY State Open Data — Powerball recent winning numbers (no key).
  powerball: { src: 'ny-opendata', url: 'https://data.ny.gov/resource/d6yy-54nr.json?$order=draw_date%20DESC&$limit=5', label: 'Powerball (multi-state)' },
  // NY State Open Data — Mega Millions recent winning numbers (no key).
  megamillions: { src: 'ny-opendata', url: 'https://data.ny.gov/resource/5xaw-6ayf.json?$order=draw_date%20DESC&$limit=5', label: 'Mega Millions (multi-state)' },
};

const MAGAYO_KEY = () => process.env.MAGAYO_API_KEY || process.env.SOAPBOX_MAGAYO_KEY || '';
const ODDS_API_KEY = () => process.env.ODDS_API_KEY || process.env.SOAPBOX_ODDS_API_KEY || '';

function normalizeNyDraw(row, label) {
  const nums = (row.winning_numbers || '').trim();
  return {
    game: label,
    drawDate: row.draw_date ? String(row.draw_date).slice(0, 10) : null,
    numbers: nums ? nums.split(/\s+/) : [],
    extra: row.mega_ball || row.multiplier || null,
  };
}

/**
 * Recent winning numbers for a lottery game. Soft-fails to [] on any error / unknown game / missing
 * key. game: 'powerball' | 'megamillions' (keyless NY feed), or any magayo game code (needs key).
 * Cached 5 min.
 */
export async function lotteryResults({ game = 'powerball' } = {}) {
  const key = String(game).toLowerCase();
  return cached(`gambling:lottery:${key}`, TTL.ohlcv, async () => {
    const feed = LOTTERY_FEEDS[key];
    try {
      if (feed && feed.src === 'ny-opendata') {
        const r = await _fetch(feed.url, { headers: { 'user-agent': UA } });
        if (!r.ok) return [];
        const rows = await r.json();
        if (!Array.isArray(rows)) return [];
        return rows.map((row) => normalizeNyDraw(row, feed.label));
      }
      // fall through to magayo for non-NY games — needs a key.
      const k = MAGAYO_KEY();
      if (!k) return [];
      const url = `https://www.magayo.com/api/results.php?api_key=${encodeURIComponent(k)}&game=${encodeURIComponent(game)}`;
      const r = await _fetch(url, { headers: { 'user-agent': UA } });
      if (!r.ok) return [];
      const j = await r.json();
      if (!j || j.error !== 0) return [];
      return [{ game, drawDate: j.draw_date || null, numbers: (j.results || '').split(',').map((s) => s.trim()).filter(Boolean), extra: j.additional || null }];
    } catch { return []; }
  }).catch(() => []);
}

/**
 * Current sportsbook odds for a sport via the-odds-api (free key). Soft-fails to [] when the key is
 * absent or the request fails — we never throw. sport = an the-odds-api sport key, e.g.
 * 'americanfootball_nfl', 'basketball_nba', 'soccer_epl'. Cached 5 min. Returns a trimmed shape with
 * the de-vigged fair probabilities computed from the posted moneylines (h2h market).
 */
export async function sportsOdds({ sport = 'americanfootball_nfl' } = {}) {
  return cached(`gambling:odds:${sport}`, TTL.ohlcv, async () => {
    const k = ODDS_API_KEY();
    if (!k) return [];
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/odds/?regions=us&markets=h2h&oddsFormat=american&apiKey=${encodeURIComponent(k)}`;
      const r = await _fetch(url, { headers: { 'user-agent': UA } });
      if (!r.ok) return [];
      const games = await r.json();
      if (!Array.isArray(games)) return [];
      return games.map((g) => {
        const book = g.bookmakers?.[0];
        const h2h = book?.markets?.find((m) => m.key === 'h2h');
        const prices = (h2h?.outcomes || []).map((o) => o.price);
        const v = vigOverround(prices);
        return {
          sport: g.sport_key || sport,
          home: g.home_team, away: g.away_team,
          commence: g.commence_time || null,
          book: book?.title || null,
          outcomes: (h2h?.outcomes || []).map((o, i) => ({
            name: o.name, american: o.price,
            implied: impliedProbability(o.price),
            fair: v ? v.fair[i] : null,
          })),
          vigPct: v ? v.marginPct : null,
        };
      });
    } catch { return []; }
  }).catch(() => []);
}

/**
 * One-call summary for a homepage gambling chip / page header. Always resolves (soft-fail throughout):
 * the modeled table games sorted by house edge, the best/worst of those, latest Powerball draw, and a
 * flag for whether the optional live keys are configured.
 */
export async function gamblingSummary() {
  const games = tableGames();
  const [powerball] = await Promise.all([lotteryResults({ game: 'powerball' }).catch(() => [])]);
  return {
    disclaimer: 'Education and analytics only. SoapBox does not take bets or operate any wager.',
    tableGames: games,
    bestEdge: games[0] || null,
    worstEdge: games[games.length - 1] || null,
    latestPowerball: powerball[0] || null,
    liveKeys: {
      magayo: !!MAGAYO_KEY(),
      oddsApi: !!ODDS_API_KEY(),
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith('gambling.mjs')) {
  console.log('Table games (house edge, lowest first):');
  for (const g of tableGames()) {
    console.log(`  ${g.label.padEnd(34)} edge ${(g.houseEdgePct).toFixed(2)}%  RTP ${(g.rtp * 100).toFixed(2)}%`);
  }
  console.log('\nVig example — two -110 sides:', JSON.stringify(vigOverround([-110, -110])));
  const s = await gamblingSummary();
  console.log('\nSummary disclaimer:', s.disclaimer);
  console.log('Live keys configured:', JSON.stringify(s.liveKeys));
}
