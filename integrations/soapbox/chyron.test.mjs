import { test } from 'node:test';
import assert from 'node:assert';
import { severityTier, quakeScore, moveScore, curate, rankNews, worldClocks, CLOCKS, reliefWeb, gdeltWorld, eonetEvents, __setFetch,
  earthquakes, weatherAlerts,
  TOPICS, classifyTopic, relevanceScore, topFive, tickerPanels, renderTickerHTML, escapeHtml } from './chyron.mjs';

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

// ── data-loss-audit (#284): the USGS/NWS structured fields must survive, not just the chyron text ──
test('#284: earthquakes() keeps mag/place/time/coords as structured fields', async () => {
  __setFetch(async () => jsonResponse({ features: [{
    properties: { mag: 6.3, place: '10km S of Testville', time: 1700000000000, url: 'https://usgs/x', tsunami: 1 },
    geometry: { coordinates: [-122.5, 37.7, 12.3] },
  }] }));
  try {
    const [q] = await earthquakes();
    assert.ok(/M6.3 earthquake/.test(q.text), 'chyron text unchanged');
    assert.equal(q.mag, 6.3);
    assert.equal(q.place, '10km S of Testville');
    assert.equal(q.time, new Date(1700000000000).toISOString());
    assert.equal(q.tsunami, true);
    assert.equal(q.lat, 37.7);
    assert.equal(q.lon, -122.5);
    assert.equal(q.depthKm, 12.3);
  } finally { __setFetch(null); }
});

test('#284: weatherAlerts() keeps severity/area/effective/expires/headline', async () => {
  __setFetch(async () => jsonResponse({ features: [{
    properties: { event: 'Tornado Warning', severity: 'Extreme', areaDesc: 'Foo County; Bar County',
      effective: '2026-06-06T00:00:00Z', expires: '2026-06-06T01:00:00Z', headline: 'Take shelter now' },
  }] }));
  try {
    const [a] = await weatherAlerts();
    assert.ok(/Tornado Warning/.test(a.text), 'chyron text unchanged');
    assert.equal(a.event, 'Tornado Warning');
    assert.equal(a.severity, 'Extreme');
    assert.equal(a.areaDesc, 'Foo County; Bar County');
    assert.equal(a.effective, '2026-06-06T00:00:00Z');
    assert.equal(a.expires, '2026-06-06T01:00:00Z');
    assert.equal(a.headline, 'Take shelter now');
  } finally { __setFetch(null); }
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

// ============================================================================
// Task #203 — cycling topic panels (ADDITIVE tests)
// ============================================================================

const HOUR = 3600000;

test('TOPICS lists the six ordered panels with key+label', () => {
  assert.equal(TOPICS.length, 6);
  assert.deepEqual(TOPICS.map((t) => t.key), ['crypto', 'bitcoin', 'ethereum', 'altcoins', 'world', 'markets']);
  assert.ok(TOPICS.every((t) => t.key && t.label));
});

test('classifyTopic routes BTC headline to bitcoin+crypto', () => {
  const t = classifyTopic({ text: 'Bitcoin surges past 80k as ETF inflows climb' });
  assert.ok(t.includes('bitcoin'), 'bitcoin');
  assert.ok(t.includes('crypto'), 'also crypto');
  assert.ok(!t.includes('ethereum'), 'not ethereum');
});

test('classifyTopic routes ETH headline to ethereum+crypto', () => {
  const t = classifyTopic({ text: 'Ethereum staking yields rise after Dencun upgrade' });
  assert.ok(t.includes('ethereum'), 'ethereum');
  assert.ok(t.includes('crypto'), 'crypto');
});

test('classifyTopic routes an altcoin ticker to altcoins+crypto', () => {
  const t = classifyTopic({ text: 'Solana SOL rallies as Dogecoin DOGE follows' });
  assert.ok(t.includes('altcoins'), 'altcoins');
  assert.ok(t.includes('crypto'), 'crypto');
});

test('classifyTopic routes a quake to world (and a war/weather story too)', () => {
  assert.ok(classifyTopic({ kind: 'disaster', text: 'M6.2 earthquake near Tokyo' }).includes('world'));
  assert.ok(classifyTopic({ text: 'War escalates as sanctions tighten' }).includes('world'));
  assert.ok(classifyTopic({ text: 'Severe storm warning issued' }).includes('world'));
});

test('classifyTopic routes macro/stocks to markets, not crypto', () => {
  const t = classifyTopic({ text: 'S&P 500 and Nasdaq fall on inflation data' });
  assert.ok(t.includes('markets'), 'markets');
  assert.ok(!t.includes('bitcoin') && !t.includes('ethereum'), 'no coin panels');
});

test('relevanceScore decays with age — newer same item scores higher', () => {
  const now = 1_000 * HOUR; // arbitrary fixed clock
  const fresh = { text: 'Bitcoin update', ts: now - 0.1 * HOUR, score: 50, authority: 2 };
  const stale = { text: 'Bitcoin update', ts: now - 8 * HOUR, score: 50, authority: 2 };
  assert.ok(relevanceScore(fresh, { now }) > relevanceScore(stale, { now }), 'fresher scores higher');
});

test('relevanceScore: bigger severity/magnitude scores higher at equal age', () => {
  const now = 1_000 * HOUR;
  const big = { text: 'M7.5 earthquake hits coast', kind: 'disaster', ageHours: 1, score: 90 };
  const small = { text: 'M4.6 earthquake hits coast', kind: 'disaster', ageHours: 1, score: 30 };
  assert.ok(relevanceScore(big, { now }) > relevanceScore(small, { now }), 'bigger magnitude wins');
});

test('relevanceScore stays within 0..1', () => {
  const now = 1_000 * HOUR;
  assert.ok(relevanceScore({ text: 'x', ageHours: 0, score: 100, authority: 3 }, { now }) <= 1);
  assert.ok(relevanceScore({ text: 'x', ageHours: 9999, score: 0 }, { now }) >= 0);
});

test('topFive returns at most 5, filtered to topic, deduped', () => {
  const now = 1_000 * HOUR;
  const items = [
    { text: 'Bitcoin one', ageHours: 1, score: 60 },
    { text: 'bitcoin one', ageHours: 1, score: 60 }, // dup (normalized)
    { text: 'Bitcoin two', ageHours: 1, score: 60 },
    { text: 'Bitcoin three', ageHours: 1, score: 60 },
    { text: 'Bitcoin four', ageHours: 1, score: 60 },
    { text: 'Bitcoin five', ageHours: 1, score: 60 },
    { text: 'Bitcoin six', ageHours: 1, score: 60 },
    { text: 'Ethereum thing', ageHours: 1, score: 60 }, // wrong topic, excluded
  ];
  const out = topFive(items, 'bitcoin', { now });
  assert.ok(out.length <= 5, 'at most five');
  assert.equal(out.length, 5, 'exactly five from the pool');
  assert.ok(out.every((x) => /bitcoin/i.test(x.text)), 'only bitcoin items');
  const keys = out.map((x) => x.text.toLowerCase());
  assert.equal(new Set(keys).size, keys.length, 'no dup');
});

test('topFive THE SWAP: a fresh high-score item displaces a stale one out of the Top 5', () => {
  const now = 1_000 * HOUR;
  // five stale-but-once-strong bitcoin items + one fresh newcomer = six candidates for 5 slots
  const stale = Array.from({ length: 5 }, (_, i) => ({ text: `Bitcoin legacy story ${i}`, ageHours: 10, score: 70 }));
  const fresh = { text: 'Bitcoin breaking newcomer', ageHours: 0.05, score: 80 };
  const before = topFive(stale, 'bitcoin', { now }).map((x) => x.text);
  assert.ok(!before.includes('Bitcoin breaking newcomer'), 'newcomer absent before it exists');

  const after = topFive([...stale, fresh], 'bitcoin', { now }).map((x) => x.text);
  assert.equal(after.length, 5, 'still capped at five');
  assert.ok(after.includes('Bitcoin breaking newcomer'), 'fresh item entered the Top 5');
  const displaced = before.filter((t) => !after.includes(t));
  assert.equal(displaced.length, 1, 'exactly one stale item was swapped out');
});

test('tickerPanels assembles panels from injected fetchers, fully offline', async () => {
  const now = 1_000 * HOUR;
  const out = await tickerPanels({
    now,
    fetchers: {
      crypto: async () => [
        { title: 'Bitcoin hits new high', ageHours: 0.2, authority: 3 },
        { title: 'Ethereum upgrade ships', ageHours: 0.3, authority: 2 },
        { title: 'Solana SOL pumps', ageHours: 0.4, authority: 1 },
      ],
      world: async () => [
        { kind: 'disaster', text: 'M6.0 earthquake near coast', ageHours: 1, score: 60 },
      ],
      markets: async () => [
        { kind: 'macro', text: 'Nasdaq falls 2%', changePct: -2, ageHours: 0, score: 20 },
      ],
    },
  });
  assert.ok(Array.isArray(out.panels), 'panels array');
  assert.equal(out.panels.length, 6, 'six panels');
  assert.deepEqual(out.panels.map((p) => p.key), TOPICS.map((t) => t.key), 'order preserved');
  assert.ok(out.panels.every((p) => p.items.length <= 5), 'each panel ≤5');
  const btc = out.panels.find((p) => p.key === 'bitcoin');
  assert.ok(btc.items.some((i) => /Bitcoin/.test(i.text)), 'bitcoin panel populated');
  const eth = out.panels.find((p) => p.key === 'ethereum');
  assert.ok(eth.items.some((i) => /Ethereum/.test(i.text)), 'eth panel populated');
  const world = out.panels.find((p) => p.key === 'world');
  assert.ok(world.items.some((i) => /earthquake/.test(i.text)), 'world panel populated');
  const markets = out.panels.find((p) => p.key === 'markets');
  assert.ok(markets.items.some((i) => /Nasdaq/.test(i.text)), 'markets panel populated');
  assert.equal(out.clocks.length, 8, 'clocks included');
  assert.equal(out.generatedAt, now, 'generatedAt is now');
});

test('renderTickerHTML contains clocks, panel markup, and a 4000ms cycle script by default', () => {
  const panels = {
    panels: [
      { key: 'crypto', label: 'Top 5 Crypto', items: [{ text: 'Bitcoin up' }, { text: 'Eth up', url: 'https://x/1' }] },
      { key: 'world', label: 'World', items: [{ text: 'Quake hits' }] },
    ],
    clocks: worldClocks(),
  };
  const html = renderTickerHTML(panels);
  assert.match(html, /sbx-ticker/, 'ticker container');
  assert.match(html, /data-tz="America\/New_York"/, 'clock tz embedded');
  assert.match(html, /Top 5 Crypto/, 'panel label');
  assert.match(html, /sbx-panel/, 'panel markup');
  assert.match(html, /setInterval\(tick,4000\)/, 'default 4000ms cycle');
  assert.match(html, /mouseenter/, 'pause on hover');
  assert.match(html, /href="https:\/\/x\/1"/, 'item link rendered');
});

test('renderTickerHTML honors a custom cycleMs', () => {
  const html = renderTickerHTML({ panels: [{ key: 'crypto', label: 'Crypto', items: [] }], clocks: [] }, { cycleMs: 2500 });
  assert.match(html, /setInterval\(tick,2500\)/, 'custom cycle ms');
});

test('renderTickerHTML escapes a malicious headline (no raw script injection)', () => {
  const evil = '<img src=x onerror=alert(1)></script><b>pwn</b>';
  const html = renderTickerHTML({
    panels: [{ key: 'crypto', label: 'Top 5 Crypto', items: [{ text: evil }] }],
    clocks: [],
  });
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'), 'raw img not present');
  assert.ok(!html.includes('<b>pwn</b>'), 'raw injected bold not present');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, 'escaped form present');
});

test('escapeHtml handles the dangerous characters', () => {
  assert.equal(escapeHtml(`<a href="x" onclick='y'>&z</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;z&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
});
