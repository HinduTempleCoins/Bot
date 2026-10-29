// metals-alert.test.mjs — OFFLINE. Injected fetch and fs, no network.
import { test } from 'node:test';
import assert from 'node:assert';
import { assess, composePost, alreadyPosted, fetchQuotes, tick, __setFetch,
         THRESHOLD_PCT, loadState, saveState } from './metals-alert.mjs';

const memFs = () => { const f = {}; return { files: f, fs: { read: (p) => (p in f ? f[p] : null), write: (p, s) => { f[p] = s; return true; } } }; };
const quotes = (g, s) => ({ gold: g.map((c, i) => ({ price: 4000 + i, changePct: c })), silver: s.map((c) => ({ price: 54, changePct: c })) });

test('a quiet day is not an alert', () => {
  const v = assess(quotes([0.3, 0.4], [-0.6]));
  assert.equal(v.alert, false);
  assert.match(v.reason, /inside the 5% threshold/);
});

test('gold moving hard, both proxies agreeing, alerts', () => {
  const v = assess(quotes([6.1, 6.4], [0.2]));
  assert.equal(v.alert, true);
  assert.equal(v.metal, 'gold');
  assert.ok(Math.abs(v.changePct - 6.25) < 1e-9);
});

test('a big DOWN move alerts too', () => {
  const v = assess(quotes([-7.2, -7.0], [0.1]));
  assert.equal(v.alert, true);
  assert.ok(v.changePct < 0);
});

test('⚠ gold proxies that DISAGREE do not alert — that is a token problem, not a gold move', () => {
  // PAXG depegs 8% while XAUT barely moves: gold has not done anything
  const v = assess(quotes([8.0, 0.2], [0.1]));
  assert.equal(v.alert, false);
  assert.match(v.reason, /token problem/);
});

test('⚠ a single gold proxy is never enough to fire', () => {
  const v = assess({ gold: [{ price: 4000, changePct: 9 }], silver: [] });
  assert.equal(v.alert, false);
  assert.match(v.reason, /only one gold proxy/);
});

test('⚠ a silver alert is marked UNCONFIRMED — one proxy cannot rule out a depeg', () => {
  const v = assess(quotes([0.1, 0.1], [7.0]));
  assert.equal(v.alert, true);
  assert.equal(v.metal, 'silver');
  assert.equal(v.confirmed, false, 'single-source, and it must say so');
  assert.match(v.reason, /single source/);
});

test('gold, confirmed by two proxies, is marked confirmed', () => {
  const v = assess(quotes([6.1, 6.2], [0.1]));
  assert.equal(v.confirmed, true);
});

test('when BOTH metals move hard, gold wins the post — it is the confirmed one', () => {
  const v = assess(quotes([7.0, 7.0], [7.0]));
  assert.equal(v.alert, true);
  assert.equal(v.metal, 'gold');
});

test('⚠ an unconfirmed post tells the reader it is single-source', () => {
  const p = composePost({ metal: 'silver', changePct: 7.1, price: 58, confirmed: false });
  assert.match(p.body, /single tokenised-metal source/);
  assert.match(p.body, /cannot rule out that the token moved rather than the metal/);
  const g = composePost({ metal: 'gold', changePct: 6.1, price: 4300, confirmed: true });
  assert.match(g.body, /two independent sources/);
});

test('exactly at the threshold counts as a move', () => {
  assert.equal(assess(quotes([5.0, 5.0], [0])).alert, true);
  assert.equal(assess(quotes([4.99, 4.99], [0])).alert, false);
});

test('the same move is not posted twice in a day', () => {
  const now = 1_700_000_000_000;
  const st = { 'gold:up': now - 3600_000 };
  assert.equal(alreadyPosted(st, 'gold', 6, { now }), true);
  assert.equal(alreadyPosted(st, 'gold', -6, { now }), false, 'the other direction is a different event');
  assert.equal(alreadyPosted(st, 'silver', 6, { now }), false);
  assert.equal(alreadyPosted(st, 'gold', 6, { now: now + 21 * 3600_000 }), false, 'a day later it may post again');
});

test('the post states the move and refuses to explain it', () => {
  const p = composePost({ metal: 'gold', changePct: 6.4, price: 4310.5 });
  assert.match(p.title, /Gold up 6\.4%/);
  assert.match(p.body, /6\.40% up/);
  assert.match(p.body, /does \*\*not\*\* do is tell you why/);
  assert.doesNotMatch(p.title, /!/, 'no exclamation marks — the number is the drama');
  assert.ok(p.tags.includes('gold'));
});

test('a down move reads as down', () => {
  const p = composePost({ metal: 'silver', changePct: -8.2, price: 49.1 });
  assert.match(p.title, /Silver down 8\.2%/);
});

// ── the reader ────────────────────────────────────────────────────────────────────────────────────
test('fetchQuotes parses both metals', async () => {
  __setFetch(async () => ({ json: async () => ({
    'pax-gold': { usd: 4066.14, usd_24h_change: 0.14 },
    'tether-gold': { usd: 4059.84, usd_24h_change: 0.15 },
    'kinesis-silver': { usd: 53.91, usd_24h_change: -0.54 },
  }) }));
  const q = await fetchQuotes();
  assert.equal(q.gold.length, 2);
  assert.equal(q.silver[0].price, 53.91);
  __setFetch(null);
});

test('⚠ a dead feed returns null and the bot stays silent', async () => {
  __setFetch(async () => { throw new Error('ENOTFOUND'); });
  assert.equal(await fetchQuotes(), null);
  assert.equal((await tick({})).ok, false);
  __setFetch(async () => ({ json: async () => ({}) }));
  assert.equal(await fetchQuotes(), null, 'an empty body is null, not a 0% move');
  __setFetch(null);
});

test('a malformed quote is dropped rather than read as zero', async () => {
  __setFetch(async () => ({ json: async () => ({
    'pax-gold': { usd: 'oops', usd_24h_change: 6 },
    'tether-gold': { usd: 4059.84, usd_24h_change: 6.1 },
    'kinesis-silver': { usd: 53.91 },
  }) }));
  const q = await fetchQuotes();
  assert.equal(q.gold.length, 1, 'the bad gold quote is dropped');
  assert.equal(q.silver.length, 0, 'a quote with no change field is dropped');
  __setFetch(null);
});

test('tick publishes once and records it', async () => {
  const m = memFs();
  __setFetch(async () => ({ json: async () => ({
    'pax-gold': { usd: 4300, usd_24h_change: 6.2 },
    'tether-gold': { usd: 4295, usd_24h_change: 6.3 },
    'kinesis-silver': { usd: 54, usd_24h_change: 0.1 },
  }) }));
  const sent = [];
  const post = async (d) => { sent.push(d); return { id: 'tx1' }; };
  const r1 = await tick({ post, fs: m.fs, file: 'st' });
  assert.equal(r1.posted, true);
  assert.equal(sent.length, 1);
  const r2 = await tick({ post, fs: m.fs, file: 'st' });
  assert.equal(r2.posted, false, 'the second pass does not repeat it');
  assert.equal(sent.length, 1);
  __setFetch(null);
});

test('with no publisher it returns a draft instead of posting', async () => {
  __setFetch(async () => ({ json: async () => ({
    'pax-gold': { usd: 4300, usd_24h_change: 6.2 },
    'tether-gold': { usd: 4295, usd_24h_change: 6.3 },
  }) }));
  const r = await tick({ fs: memFs().fs, file: 'st' });
  assert.equal(r.posted, false);
  assert.ok(r.draft && r.draft.title);
  __setFetch(null);
});

test('a publisher that throws is caught, and nothing is marked as posted', async () => {
  const m = memFs();
  __setFetch(async () => ({ json: async () => ({
    'pax-gold': { usd: 4300, usd_24h_change: 6.2 },
    'tether-gold': { usd: 4295, usd_24h_change: 6.3 },
  }) }));
  const r = await tick({ post: async () => { throw new Error('chain down'); }, fs: m.fs, file: 'st' });
  assert.equal(r.ok, false);
  assert.equal(loadState({ fs: m.fs, file: 'st' })['gold:up'], undefined, 'a failed publish must be retried');
  __setFetch(null);
});

test('state round-trips', () => {
  const m = memFs();
  saveState({ 'gold:up': 123 }, { fs: m.fs, file: 'st' });
  assert.equal(loadState({ fs: m.fs, file: 'st' })['gold:up'], 123);
  assert.deepEqual(loadState({ fs: { read: () => 'not json' }, file: 'st' }), {});
});
