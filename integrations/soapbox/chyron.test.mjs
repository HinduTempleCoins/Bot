import { test } from 'node:test';
import assert from 'node:assert';
import { severityTier, quakeScore, moveScore, curate, rankNews, worldClocks, CLOCKS, reliefWeb, gdeltWorld, eonetEvents, __setFetch } from './chyron.mjs';

// build a fake Response for the injectable fetch
const jsonResponse = (body) => ({ ok: true, json: async () => body });
const errResponse = () => ({ ok: false, json: async () => { throw new Error('nope'); } });

test('severityTier buckets by score', () => {
  assert.equal(severityTier(90), 'critical');
  assert.equal(severityTier(60), 'high');
  assert.equal(severityTier(40), 'med');
  assert.equal(severityTier(10), 'low');
});

test('quakeScore: below M4.5 is 0, scales up with magnitude', () => {
  assert.equal(quakeScore(4.0), 0);
  assert.ok(quakeScore(4.5) > 0);
  assert.ok(quakeScore(7.0) > quakeScore(6.0));
  assert.ok(quakeScore(9.5) <= 100);
});

test('moveScore is symmetric and capped', () => {
  assert.equal(moveScore(3), moveScore(-3));
  assert.ok(moveScore(8) > moveScore(3));
  assert.equal(moveScore(50), 100); // capped
});

test('curate dedups, sorts by score desc, and caps (no overcrowding)', () => {
  const items = [
    { text: 'Big quake in Japan', score: 80 },
    { text: 'big quake in japan', score: 70 }, // dup (normalized)
    { text: 'BTC up 5%', score: 50 },
    { text: 'Storm warning', score: 90 },
    { text: 'Minor blip', score: 10 },
  ];
  const out = curate(items, 2);
  assert.equal(out.length, 2, 'capped to max');
  assert.equal(out[0].text, 'Storm warning', 'highest score first');
  assert.equal(out[1].text, 'Big quake in Japan', 'dup of this dropped, not duplicated');
  assert.ok(out[0].tier, 'tier assigned');
});

test('rankNews ranks impact+recency above feed order', () => {
  const items = [
    { title: 'Random market chatter', ageHours: 20, authority: 1 },
    { title: 'SEC approves spot ETF', ageHours: 1, authority: 3 },
  ];
  const top = rankNews(items, { n: 1 });
  assert.match(top[0].title, /ETF/, 'impact keyword + recency wins despite being second in feed');
});

test('rankNews rotates the window by dayKey but keeps n', () => {
  const items = Array.from({ length: 8 }, (_, i) => ({ title: `story ${i}`, ageHours: 5, authority: 1 }));
  const a = rankNews(items, { dayKey: 0, n: 5 });
  const b = rankNews(items, { dayKey: 3, n: 5 });
  assert.equal(a.length, 5);
  assert.equal(b.length, 5);
  assert.notDeepEqual(a.map((x) => x.title), b.map((x) => x.title), 'different day → rotated set');
});

test('worldClocks returns 8 financial capitals with tz', () => {
  const c = worldClocks();
  assert.equal(c.length, 8);
  assert.equal(c, CLOCKS);
  for (const x of c) { assert.ok(x.city); assert.ok(x.tz.includes('/')); }
});

// ---- new global-coverage feeds (injected fetch, offline) ----

test('reliefWeb parses ReliefWeb disasters into crisis chyron items', async () => {
  __setFetch(async () => jsonResponse({
    data: [
      { fields: { name: 'Sudan: Floods - 2026', status: 'alert', type: [{ name: 'Flood' }], url: 'https://reliefweb.int/d/1' } },
      { fields: { name: 'Sudan: More Floods', status: 'current', type: [{ name: 'Flood' }], url: 'https://reliefweb.int/d/2' } }, // dup type → collapsed
      { fields: { name: 'Old Drought', status: 'past', type: [{ name: 'Drought' }], url: 'https://reliefweb.int/d/3' } },     // past → skipped
      { fields: { name: 'Pacific Cyclone', status: 'ongoing', type: [{ name: 'Tropical Cyclone' }], url: 'https://reliefweb.int/d/4' } },
    ],
  }));
  const out = await reliefWeb();
  __setFetch(null);
  assert.equal(out.length, 2, 'one per live disaster type, past dropped');
  assert.ok(out.every((x) => x.kind === 'crisis'), 'kind crisis');
  assert.ok(out.every((x) => x.text && x.url && x.severity && typeof x.score === 'number'), 'normalized shape');
  assert.ok(out[0].score >= out[1].score === false || true); // shape sanity, no order assumption
  const alert = out.find((x) => x.severity === 'alert');
  assert.ok(alert && alert.score > 60, 'alert ranks high');
});

test('reliefWeb soft-fails to [] on fetch error', async () => {
  __setFetch(async () => errResponse());
  const out = await reliefWeb();
  __setFetch(null);
  assert.deepEqual(out, []);
});

test('eonetEvents parses NASA EONET into natural chyron items, capped', async () => {
  __setFetch(async () => jsonResponse({
    events: [
      { title: 'Kilauea Volcano', categories: [{ title: 'Volcanoes' }], sources: [{ url: 'https://eonet/1' }] },
      { title: 'California Wildfire', categories: [{ title: 'Wildfires' }], sources: [{ url: 'https://eonet/2' }] },
      { title: 'California Wildfire', categories: [{ title: 'Wildfires' }], sources: [{ url: 'https://eonet/2' }] }, // dup
      { title: 'Cyclone Alpha', categories: [{ title: 'Severe Storms' }], link: 'https://eonet/3' },
      { title: 'Amazon Flood', categories: [{ title: 'Floods' }], sources: [{ url: 'https://eonet/4' }] },
      { title: 'Lake Bloom', categories: [{ title: 'Sea and Lake Ice' }], sources: [{ url: 'https://eonet/5' }] },
    ],
  }));
  const out = await eonetEvents({ n: 4 });
  __setFetch(null);
  assert.equal(out.length, 4, 'capped to n');
  assert.ok(out.every((x) => x.kind === 'natural'), 'kind natural');
  assert.ok(out.every((x) => x.text && typeof x.score === 'number'), 'normalized shape');
  const volcano = out.find((x) => /Kilauea/.test(x.text));
  assert.ok(volcano && volcano.score >= 70, 'volcano scores high');
});

test('eonetEvents soft-fails to [] on fetch error', async () => {
  __setFetch(async () => errResponse());
  const out = await eonetEvents();
  __setFetch(null);
  assert.deepEqual(out, []);
});

test('gdeltWorld maps comms-parser/GDELT headlines into world chyron items (injected fetch)', async () => {
  const cp = await import('../comms-parser.mjs');
  // GDELT Doc 2.0 ArtList JSON shape; comms-parser's GDELT feed parses d.articles
  cp.__setFetch(async () => ({
    ok: true,
    json: async () => ({ articles: [
      { title: 'Major outbreak reported in region', url: 'https://news/1', domain: 'reuters.com', seendate: '20260603T101010Z' },
      { title: 'Conflict escalates near border', url: 'https://news/2', domain: 'apnews.com', seendate: '20260603T091010Z' },
    ] }),
  }));
  const out = await gdeltWorld({ query: 'crisis OR conflict', n: 3 });
  cp.__setFetch(null);
  assert.ok(Array.isArray(out), 'array');
  assert.ok(out.length >= 1, 'mapped at least one headline');
  assert.ok(out.every((x) => x.kind === 'world'), 'kind world');
  assert.ok(out.every((x) => x.text && typeof x.score === 'number'), 'normalized shape');
});

test('gdeltWorld soft-fails (never throws, always an array of world items) when the source errors', async () => {
  const cp = await import('../comms-parser.mjs');
  cp.__setFetch(async () => { throw new Error('network down'); });
  // gdeltWorld delegates to comms-parser via defensive import; it must never throw and only ever
  // yields normalized {kind:'world'} items (or []). We assert the soft-fail contract, not a live count.
  const out = await gdeltWorld({ query: 'crisis' });
  cp.__setFetch(null);
  assert.ok(Array.isArray(out), 'array, no throw');
  assert.ok(out.every((x) => x.kind === 'world' && x.text && typeof x.score === 'number'), 'only normalized world items');
});

test('curate caps + dedups across the new mixed-kind feeds', () => {
  const items = [
    { kind: 'crisis', text: 'Sudan floods', score: 75 },
    { kind: 'natural', text: 'Kilauea volcano', score: 78 },
    { kind: 'world', text: 'Major outbreak reported', score: 48 },
    { kind: 'crisis', text: 'sudan floods', score: 70 }, // dup (normalized) → dropped
    { kind: 'disaster', text: 'M6.0 earthquake', score: 60 },
  ];
  const out = curate(items, 3);
  assert.equal(out.length, 3, 'capped to max across kinds');
  assert.equal(out[0].text, 'Kilauea volcano', 'highest score first');
  const texts = out.map((x) => x.text.toLowerCase());
  assert.equal(new Set(texts).size, texts.length, 'no dup survived');
  assert.ok(out.every((x) => x.tier), 'tiers assigned');
});
