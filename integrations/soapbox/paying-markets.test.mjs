import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKETS, ASSETS, byId, asset, marketsFor, unpitched, subjectFor, unverifiedRates, summary,
  MODES, DELIVERY_FAILURES,
} from './paying-markets.mjs';

test('every market is complete enough to act on', () => {
  for (const m of MARKETS) {
    assert.ok(m.id && m.name, 'id and name');
    assert.match(m.url, /^https:\/\//, `${m.id} needs a real url`);
    assert.ok(m.route, `${m.id} needs a submission route`);
    assert.ok(Array.isArray(m.fit) && m.fit.length, `${m.id} must fit at least one finished asset`);
    assert.equal(typeof m.pitched, 'boolean', `${m.id} must record whether it was already pitched`);
  }
});

test('every fit points at an asset that actually exists', () => {
  const ids = new Set(ASSETS.map((a) => a.id));
  for (const m of MARKETS) {
    for (const f of m.fit) assert.ok(ids.has(f), `${m.id} claims to fit unknown asset "${f}"`);
  }
});

test('⚠️ a PITCH subject never begins with Re:, but a NOTICE subject must', () => {
  // Two instruments. A cold pitch to an editor who has never heard from you must stand on its own.
  // A one-way notice thread to a standing list is a real continuing thread, and "Re:" is accurate
  // there — it is not a cold pitch in disguise and must not be rewritten as one.
  const n = subjectFor('derelict', { mode: 'notice' });
  assert.match(n, /^Re: /, 'a notice continues its thread');
  assert.ok(!/^Re: Re:/i.test(subjectFor('derelict', { mode: 'notice', thread: 'Re: The Unresponsive State' })),
    'the prefix is applied once, never stacked');
  for (const a of ASSETS) {
    const s = subjectFor(a.id);
    assert.ok(s.length > 6, `${a.id} produced no subject`);
    assert.ok(!/^re:/i.test(s), `${a.id} subject must not start with Re:`);
    assert.ok(s.includes(a.title), 'the subject should name the piece');
  }
  assert.equal(subjectFor('nope'), '');
});

test('marketsFor puts UNPITCHED outlets first — that is the work queue', () => {
  const r = marketsFor('dea-gao');
  assert.ok(r.length >= 3);
  const firstPitched = r.findIndex((m) => m.pitched);
  if (firstPitched !== -1) {
    assert.ok(r.slice(firstPitched).every((m) => m.pitched), 'unpitched must all come first');
  }
});

test('outlets already contacted are flagged so a re-pitch is deliberate', () => {
  // Editors notice duplicates; an accidental second identical pitch is worse than none.
  const marshall = byId('marshall');
  assert.equal(marshall.pitched, true);
  assert.match(marshall.note, /noreply/i, 'the reason the first attempt failed must be recorded');
  assert.equal(byId('texas-observer').pitched, true);
});

test('⚠️ every unverified rate is marked as such', () => {
  // A wrong rate becomes a wrong expectation and a wasted afternoon.
  for (const m of MARKETS) assert.equal(typeof m.rateVerified, 'boolean', `${m.id} rateVerified`);
  assert.ok(unverifiedRates().length > 0, 'honesty check: rates here have not been verified');
});

test('no market is a generic info@ without saying so', () => {
  for (const m of MARKETS) {
    if (/^info@/i.test(m.route)) assert.ok(m.note, `${m.id} uses info@ and must say it is low-yield`);
  }
});

test('summary counts add up', () => {
  const s = summary();
  assert.equal(s.markets, MARKETS.length);
  assert.equal(s.unpitched + s.alreadyPitched, MARKETS.length);
  assert.equal(s.assets, ASSETS.length);
  assert.equal(unpitched().length, s.unpitched);
});

test('every asset carries a pitch line a human could actually send', () => {
  for (const a of ASSETS) {
    assert.ok(a.pitch.length > 60, `${a.id} pitch is too thin to send`);
    assert.ok(a.beats.length, `${a.id} needs beats`);
  }
});

test('delivery failures are recorded — a bounced notice proves nobody was told', () => {
  assert.ok(DELIVERY_FAILURES.length >= 3);
  const f = DELIVERY_FAILURES.find((x) => x.host === 'frontiersin.net');
  assert.equal(f.count, 18);
  assert.equal(f.kind, 'hard-bounce');
  for (const d of DELIVERY_FAILURES) assert.ok(d.note, `${d.host} needs the reason recorded`);
});

test('both instruments are named', () => {
  assert.deepEqual([...MODES].sort(), ['notice', 'pitch']);
});
