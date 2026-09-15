import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyReferrer, DIRECT_TOKENS, trafficSources, byDay, trend, coverage, devices,
  topPaths, topHosts, topReferrers, WIDGETS, WIDGET_IDS, widget, renderWidget, renderBoard, SOURCE_LABELS, hostMatches,
} from './analytics-widgets.mjs';

const ev = (o) => ({ day: '2026-09-14', host: 'plate.soapbox.community', path: '/', ref: '(direct)', device: 'desktop', ...o });

test('a visit with no referrer is DIRECT, not "other"', () => {
  // The collector writes the literal '(direct)'. Treating only '' as direct silently filed every
  // direct visit under "Other sites" — a referral from a site that does not exist.
  for (const t of DIRECT_TOKENS) assert.equal(classifyReferrer(t), 'direct', JSON.stringify(t));
  assert.equal(classifyReferrer('(direct)'), 'direct');
  assert.ok(!topReferrers([ev({ ref: '(direct)' })]).length, 'direct is not a referring SITE');
});

test('AI assistants are classified before search, so Copilot is not filed as Bing', () => {
  assert.equal(classifyReferrer('copilot.microsoft.com'), 'ai-assistant');
  assert.equal(classifyReferrer('gemini.google.com'), 'ai-assistant');
  assert.equal(classifyReferrer('chatgpt.com'), 'ai-assistant');
  assert.equal(classifyReferrer('claude.ai'), 'ai-assistant');
  assert.equal(classifyReferrer('perplexity.ai'), 'ai-assistant');
  assert.equal(classifyReferrer('www.google.com'), 'search');
  assert.equal(classifyReferrer('news.ycombinator.com'), 'social');
});

test('our own hosts are INTERNAL, not a referral we can sell', () => {
  assert.equal(classifyReferrer('plate.soapbox.community', ['soapbox.community']), 'internal');
  assert.equal(classifyReferrer('soapbox.community', ['soapbox.community']), 'internal');
  assert.equal(classifyReferrer('notsoapbox.community', ['soapbox.community']), 'other');
});

test('every source bucket has a human label', () => {
  const buckets = new Set(['search', 'ai-assistant', 'social', 'direct', 'internal', 'other']);
  for (const b of buckets) assert.ok(SOURCE_LABELS[b], `label for ${b}`);
  const got = trafficSources([ev({ ref: 'chatgpt.com' }), ev({ ref: 'google.com' }), ev({})], ['soapbox.community']);
  for (const k of Object.keys(got)) assert.ok(buckets.has(k), `known bucket: ${k}`);
});

test('trend compares real windows and never extrapolates', () => {
  const evs = [
    ...Array(5).fill(0).map(() => ev({ day: '2026-09-14' })),
    ...Array(2).fill(0).map(() => ev({ day: '2026-09-13' })),
  ];
  const t = trend(evs, '2026-09-14');
  assert.equal(t.today, 5);
  assert.equal(t.yesterday, 2);
  assert.equal(t.dayDelta, 3);
  assert.equal(t.last7, 7);
  assert.equal(t.prev7, 0);
  assert.equal(t.measuredDays, 2);
});

test('trend on an empty store is all zeros, never NaN', () => {
  const t = trend([], '2026-09-14');
  for (const v of Object.values(t)) assert.ok(Number.isFinite(v), 'finite');
  assert.equal(t.today, 0);
});

test('coverage names the DARK properties — the actionable half', () => {
  const c = coverage([ev({ host: 'plate.soapbox.community' })],
    ['plate.soapbox.community', 'comms.soapbox.community', 'business.soapbox.community']);
  assert.equal(c.known, 3);
  assert.equal(c.live, 1);
  assert.deepEqual(c.dark.sort(), ['business.soapbox.community', 'comms.soapbox.community']);
});

test('coverage flags a reporting host that is NOT in the registry', () => {
  const c = coverage([ev({ host: 'surprise.soapbox.community' })], ['plate.soapbox.community']);
  assert.deepEqual(c.unknownSeen, ['surprise.soapbox.community']);
});

test('EVERY widget renders a zero-state on an empty store — a zero-state, not a zero', () => {
  for (const id of WIDGET_IDS) {
    const html = renderWidget(id, [], {});
    assert.ok(html.includes(`id="w-${id}"`), `${id} framed`);
    assert.ok(html.length > 60, `${id} rendered something`);
    assert.doesNotMatch(html, /NaN|undefined|\[object/, `${id} has no leaked internals`);
  }
});

test('the crawler-blindness widget states the limitation even with data present', () => {
  const html = renderWidget('crawler-blindness', [ev({ device: 'bot' })], {});
  assert.match(html, /Crawlers do not run JavaScript/i);
  assert.match(html, /wrong in the flattering direction/i);
  assert.match(html, /analytics\.mjs/, 'points at the instrument that CAN answer it');
});

test('a widget that throws shows its error instead of taking the page down', () => {
  // The registry is frozen, so the throw is induced through the DATA — which is the realistic case:
  // one malformed row in a JSONL store must not blank the whole board.
  const hostile = new Proxy([{}], { get(t, k) { if (k === 'length') return 1; if (k === '0') throw new Error('boom'); return t[k]; } });
  const html = renderWidget('devices', hostile, {});
  assert.match(html, /failed to render: boom/);
  assert.match(html, /id="w-devices"/, 'the card is still framed');
});

test('the registry is frozen — a widget cannot be injected at runtime', () => {
  assert.throws(() => { WIDGETS.push({ id: 'x' }); });
});

test('host matching is on label boundaries — soapbox.community is NOT a referral from x.com', () => {
  // The bug this guards: includes("x.com") matches "soapbox.community". It would have shown X as a
  // top referrer forever, and only for our own domains.
  assert.equal(hostMatches('soapbox.community', 'x.com'), false);
  assert.equal(classifyReferrer('notsoapbox.community', ['soapbox.community']), 'other');
  assert.equal(hostMatches('x.com', 'x.com'), true);
  assert.equal(hostMatches('www.x.com', 'x.com'), true);
  assert.equal(hostMatches('evilx.com', 'x.com'), false);
  assert.equal(hostMatches('www.google.co.uk', 'google.'), true, 'family prefix still works');
});

test('hostile host/path/referrer values are escaped, never reflected raw', () => {
  const nasty = '<script>alert(1)</script>';
  const html = renderBoard([ev({ host: nasty, path: nasty, ref: nasty })], { knownHosts: [nasty] });
  assert.ok(!html.includes('<script>alert(1)'), 'no raw script');
  assert.match(html, /&lt;script&gt;/);
});

test('the widget registry is addressable one at a time (embeddable)', () => {
  assert.ok(widget('top-properties'));
  assert.equal(widget('nope'), null);
  const one = renderBoard([ev({})], {}, ['top-properties']);
  assert.equal((one.match(/class="wcard"/g) || []).length, 1);
});

test('rank helpers are stable and bounded', () => {
  const evs = [ev({ path: '/a' }), ev({ path: '/a' }), ev({ path: '/b' })];
  assert.deepEqual(topPaths(evs, 1), [['plate.soapbox.community/a', 2]]);
  assert.equal(topHosts(evs)[0][1], 3);
  assert.equal(byDay(evs).length, 1);
  assert.equal(devices(evs).desktop, 3);
});
