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
