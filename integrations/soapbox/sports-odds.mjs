// sports-odds.mjs — sports odds data feed for SoapBox (queue #124). Feeds the odds-engine + the
// vig-education surface ("true vs implied" / the bookmaker's margin). Two soft-fail sources:
//   • the-odds-api (process.env.ODDS_API_KEY) — live bookmaker odds across sports; no key → []
//   • Football-Data.org (process.env.FOOTBALL_DATA_KEY) — fixtures/competitions; keyless tier
//     exists (the public/keyless tier still returns data, just rate-limited), so we always try.
//
// SCOPE: showing and aggregating publicly-quoted odds is fine (it's market data, like a price feed).
// TAKING BETS is a licensed, regulated activity and is OUT OF SCOPE — this module never accepts,
// places, settles, or brokers a wager. Education only: we surface the books' implied probabilities
// and their overround so a reader can see the margin baked into the line.
//
//   import { odds, fixtures, impliedFromDecimal, bookOverround } from './sports-odds.mjs'
//   node integrations/soapbox/sports-odds.mjs

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };

// ── PURE math (no I/O) — the vig-education layer ────────────────────────────
// A decimal odd d implies probability 1/d. Bookmakers price each outcome a touch short so the
// implied probabilities across all outcomes sum to MORE than 1 — that excess is the overround
// (the "vig" / margin). True (fair) probability ≈ implied / sum(implied).

/** Implied probability (0..1) of a decimal odd. Returns null for non-positive/invalid input. */
export function impliedFromDecimal(d) {
  const n = Number(d);
  if (!Number.isFinite(n) || n <= 0) return null;
  return 1 / n;
}

/**
 * Bookmaker overround for one normalized book row { home, draw?, away } (decimal odds).
 * Sums each outcome's implied probability; the margin is (sum − 1). Returns:
 *   { implied: {home,draw?,away}, sum, overround, marginPct, true: {home,draw?,away} }
 * `true` = de-vigged fair probabilities (implied / sum). Outcomes that are null/absent are skipped.
 */
export function bookOverround(book) {
  const b = book || {};
  const keys = ['home', 'draw', 'away'].filter((k) => b[k] != null);
  const implied = {};
  let sum = 0;
  for (const k of keys) {
    const p = impliedFromDecimal(b[k]);
    if (p == null) continue;
    implied[k] = p;
    sum += p;
  }
  const tru = {};
  if (sum > 0) for (const k of Object.keys(implied)) tru[k] = implied[k] / sum;
  return {
    implied,
    sum,
    overround: sum > 0 ? sum - 1 : null,
    marginPct: sum > 0 ? (sum - 1) * 100 : null,
    true: tru,
  };
}

// ── the-odds-api: live bookmaker odds ───────────────────────────────────────
// Normalizes the-odds-api event shape → { event, books:[{ name, home, draw, away }] }.
// Markets are h2h (moneyline). `home`/`away` matched by team name; `draw` from the "Draw" outcome
// when present (soccer etc.). Soft-fail everywhere → [].
export function normalizeOddsApi(events) {
  if (!Array.isArray(events)) return [];
  return events.map((ev) => {
    const home = ev?.home_team;
    const away = ev?.away_team;
    const label = home && away ? `${home} vs ${away}` : (ev?.id || 'event');
    const books = (ev?.bookmakers || []).map((bk) => {
      const h2h = (bk?.markets || []).find((m) => m?.key === 'h2h');
      const out = { name: bk?.title || bk?.key || 'book', home: null, draw: null, away: null };
      for (const o of (h2h?.outcomes || [])) {
        const price = Number(o?.price);
        if (!Number.isFinite(price)) continue;
        if (o?.name === home) out.home = price;
        else if (o?.name === away) out.away = price;
        else if (/^draw$/i.test(o?.name || '')) out.draw = price;
      }
      return out;
    });
    return { event: label, home, away, books };
  });
}

/**
 * Bookmaker odds for a sport, normalized to { event, books:[{ name, home, draw, away }] }.
 * @param {object} o
 * @param {string} [o.sport='soccer_epl'] the-odds-api sport key (e.g. 'soccer_epl', 'americanfootball_nfl').
 * @param {string} [o.regions='uk,us,eu'] comma-separated bookmaker regions.
 * Soft-fail: no ODDS_API_KEY or any error → [].
 */
export async function odds({ sport = 'soccer_epl', regions = 'uk,us,eu' } = {}) {
  const key = process.env.ODDS_API_KEY;
  if (!key) return [];
  try {
    const u = `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/odds?` +
      `apiKey=${encodeURIComponent(key)}&regions=${encodeURIComponent(regions)}&markets=h2h&oddsFormat=decimal`;
    const r = await _fetch(u, { headers: UA });
    if (!r || !r.ok) return [];
    const j = await r.json();
    return normalizeOddsApi(j);
  } catch { return []; }
}

// ── Football-Data.org: fixtures ─────────────────────────────────────────────
// Normalizes Football-Data.org match shape → { id, competition, utcDate, status, home, away }.
export function normalizeFixtures(matches) {
  if (!Array.isArray(matches)) return [];
  return matches.map((m) => ({
    id: m?.id ?? null,
    competition: m?.competition?.name || m?.competition?.code || '',
    utcDate: m?.utcDate || null,
    status: m?.status || '',
    home: m?.homeTeam?.name || m?.homeTeam?.shortName || '',
    away: m?.awayTeam?.name || m?.awayTeam?.shortName || '',
  }));
}

/**
 * Upcoming fixtures for a competition, normalized.
 * @param {object} o
 * @param {string} [o.competition='PL'] Football-Data competition code (PL, CL, BL1, SA, PD, FL1…).
 * FOOTBALL_DATA_KEY is sent when present; the keyless tier is still attempted (rate-limited).
 * Soft-fail: any error → [].
 */
export async function fixtures({ competition = 'PL' } = {}) {
  try {
    const headers = { ...UA };
    if (process.env.FOOTBALL_DATA_KEY) headers['X-Auth-Token'] = process.env.FOOTBALL_DATA_KEY;
    const u = `https://api.football-data.org/v4/competitions/${encodeURIComponent(competition)}/matches?status=SCHEDULED`;
    const r = await _fetch(u, { headers });
    if (!r || !r.ok) return [];
    const j = await r.json();
    return normalizeFixtures(j?.matches);
  } catch { return []; }
}

if (process.argv[1] && process.argv[1].endsWith('sports-odds.mjs')) {
  const o = await odds({}).catch(() => []);
  console.log(`\n== ODDS (${o.length} events) ==`);
  for (const ev of o.slice(0, 5)) {
    console.log(`  ${ev.event}`);
    for (const b of ev.books.slice(0, 3)) {
      const ov = bookOverround(b);
      const m = ov.marginPct != null ? `  (vig ${ov.marginPct.toFixed(1)}%)` : '';
      console.log(`    ${String(b.name).padEnd(18)} H ${b.home ?? '–'}  D ${b.draw ?? '–'}  A ${b.away ?? '–'}${m}`);
    }
  }
  const f = await fixtures({}).catch(() => []);
  console.log(`\n== FIXTURES (${f.length}) ==`);
  for (const m of f.slice(0, 8)) console.log(`  ${m.utcDate || ''}  ${m.home} vs ${m.away}  [${m.competition}]`);
}
