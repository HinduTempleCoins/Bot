import { test } from 'node:test';
import assert from 'node:assert';
import {
  impliedFromDecimal, bookOverround, normalizeOddsApi, normalizeFixtures,
  odds, fixtures, __setFetch,
} from './sports-odds.mjs';

// ── PURE math: implied probability ──────────────────────────────────────────
test('impliedFromDecimal: 1/d for valid decimal odds', () => {
  assert.equal(impliedFromDecimal(2.0), 0.5);
  assert.equal(impliedFromDecimal(4.0), 0.25);
  assert.ok(Math.abs(impliedFromDecimal(1.5) - 0.6666666667) < 1e-6);
});

test('impliedFromDecimal: null for invalid / non-positive', () => {
  assert.equal(impliedFromDecimal(0), null);
  assert.equal(impliedFromDecimal(-1), null);
  assert.equal(impliedFromDecimal('x'), null);
  assert.equal(impliedFromDecimal(undefined), null);
});

// ── PURE math: overround / de-vig ───────────────────────────────────────────
test('bookOverround: fair two-way book has ~0 margin and 50/50 true', () => {
  const ov = bookOverround({ home: 2.0, away: 2.0 });
  assert.equal(ov.sum, 1.0);
  assert.equal(ov.overround, 0);
  assert.equal(ov.marginPct, 0);
  assert.equal(ov.true.home, 0.5);
  assert.equal(ov.true.away, 0.5);
});

test('bookOverround: priced-short two-way book shows positive vig', () => {
  // 1.91/1.91 ≈ the classic ~4.7% hold
  const ov = bookOverround({ home: 1.91, away: 1.91 });
  assert.ok(ov.sum > 1);
  assert.ok(ov.marginPct > 4 && ov.marginPct < 5, `marginPct=${ov.marginPct}`);
  // true probs are de-vigged and sum to 1
  assert.ok(Math.abs(ov.true.home + ov.true.away - 1) < 1e-9);
  assert.ok(Math.abs(ov.true.home - 0.5) < 1e-9);
});

test('bookOverround: three-way (with draw) sums all three outcomes', () => {
  const ov = bookOverround({ home: 2.5, draw: 3.4, away: 3.0 });
  const expected = 1 / 2.5 + 1 / 3.4 + 1 / 3.0;
  assert.ok(Math.abs(ov.sum - expected) < 1e-12);
  assert.ok(ov.overround > 0);
  assert.ok('draw' in ov.true);
  const sumTrue = ov.true.home + ov.true.draw + ov.true.away;
  assert.ok(Math.abs(sumTrue - 1) < 1e-9, 'true probs normalize to 1');
});

test('bookOverround: skips null/absent outcomes, empty book → null margin', () => {
  const ov = bookOverround({ home: 2.0, draw: null, away: 2.0 });
  assert.ok(!('draw' in ov.implied));
  assert.equal(ov.sum, 1.0);
  const empty = bookOverround({});
  assert.equal(empty.sum, 0);
  assert.equal(empty.overround, null);
  assert.equal(empty.marginPct, null);
});

// ── normalization: the-odds-api → { event, books:[{name,home,draw,away}] } ───
const ODDS_FIXTURE = [
  {
    id: 'evt1',
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    bookmakers: [
      {
        key: 'bk1', title: 'BookOne',
        markets: [{
          key: 'h2h',
          outcomes: [
            { name: 'Arsenal', price: 2.1 },
            { name: 'Chelsea', price: 3.4 },
            { name: 'Draw', price: 3.5 },
          ],
        }],
      },
    ],
  },
];

test('normalizeOddsApi: maps to {event, books:[{name,home,draw,away}]}', () => {
  const out = normalizeOddsApi(ODDS_FIXTURE);
  assert.equal(out.length, 1);
  assert.equal(out[0].event, 'Arsenal vs Chelsea');
  assert.equal(out[0].books.length, 1);
  const b = out[0].books[0];
  assert.equal(b.name, 'BookOne');
  assert.equal(b.home, 2.1);
  assert.equal(b.away, 3.4);
  assert.equal(b.draw, 3.5);
});

test('normalizeOddsApi: non-array / missing markets → safe defaults', () => {
  assert.deepEqual(normalizeOddsApi(null), []);
  assert.deepEqual(normalizeOddsApi(undefined), []);
  const out = normalizeOddsApi([{ home_team: 'A', away_team: 'B', bookmakers: [{ title: 'X', markets: [] }] }]);
  assert.equal(out[0].books[0].name, 'X');
  assert.equal(out[0].books[0].home, null);
});

test('odds(): injected fetch is normalized; no key still soft-fails to []', async () => {
  const saved = process.env.ODDS_API_KEY;
  // no key → []
  delete process.env.ODDS_API_KEY;
  __setFetch(() => { throw new Error('should not be called without key'); });
  assert.deepEqual(await odds({ sport: 'soccer_epl' }), []);

  // with key → normalized via injected fetch (no network)
  process.env.ODDS_API_KEY = 'test-key';
  __setFetch(async () => ({ ok: true, json: async () => ODDS_FIXTURE }));
  const out = await odds({ sport: 'soccer_epl' });
  assert.equal(out[0].event, 'Arsenal vs Chelsea');
  assert.equal(out[0].books[0].draw, 3.5);

  // non-ok response → []
  __setFetch(async () => ({ ok: false }));
  assert.deepEqual(await odds({}), []);

  // restore
  __setFetch(null);
  if (saved === undefined) delete process.env.ODDS_API_KEY; else process.env.ODDS_API_KEY = saved;
});

// ── normalization: Football-Data.org → fixtures ─────────────────────────────
const FD_FIXTURE = {
  matches: [
    {
      id: 100, utcDate: '2026-06-10T14:00:00Z', status: 'SCHEDULED',
      competition: { name: 'Premier League', code: 'PL' },
      homeTeam: { name: 'Liverpool' }, awayTeam: { name: 'Everton' },
    },
  ],
};

test('normalizeFixtures: maps Football-Data match shape', () => {
  const out = normalizeFixtures(FD_FIXTURE.matches);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    id: 100, competition: 'Premier League', utcDate: '2026-06-10T14:00:00Z',
    status: 'SCHEDULED', home: 'Liverpool', away: 'Everton',
  });
});

test('normalizeFixtures: non-array → []', () => {
  assert.deepEqual(normalizeFixtures(null), []);
  assert.deepEqual(normalizeFixtures(undefined), []);
});

test('fixtures(): injected fetch normalized; error → []', async () => {
  __setFetch(async () => ({ ok: true, json: async () => FD_FIXTURE }));
  const out = await fixtures({ competition: 'PL' });
  assert.equal(out[0].home, 'Liverpool');
  assert.equal(out[0].competition, 'Premier League');

  __setFetch(async () => { throw new Error('boom'); });
  assert.deepEqual(await fixtures({}), []);

  __setFetch(async () => ({ ok: false }));
  assert.deepEqual(await fixtures({}), []);

  __setFetch(null);
});
