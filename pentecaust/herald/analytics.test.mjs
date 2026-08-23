// pentecaust/herald/analytics.test.mjs — offline, deterministic tests for the Herald analytics adapter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalytics, __setFetch, handler } from './analytics.mjs';

// A deterministic clock: monotonically advances by 1000ms per read from a base.
function fakeClock(base = 1_000_000) {
  let t = base;
  return () => (t += 1000);
}

// A fresh in-memory storage per test.
const mkStorage = () => ({ events: [] });

test('track records an event row with injected timestamp', () => {
  const storage = mkStorage();
  const a = createAnalytics({ storage, now: () => 42 });
  const r = a.track({ event: 'click', campaign: 'laundro-03', source: 'qr', meta: { btn: 'signup' } });
  assert.equal(r.ok, true);
  assert.equal(storage.events.length, 1);
  assert.equal(r.row.ts, 42);
  assert.equal(r.row.event, 'click');
  assert.equal(r.row.campaign, 'laundro-03');
  assert.equal(r.row.source, 'qr');
  assert.deepEqual(r.row.meta, { btn: 'signup' });
});

test('track soft-fails (no throw) on missing event', () => {
  const a = createAnalytics({ storage: mkStorage(), now: () => 1 });
  const r = a.track({ campaign: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /event required/);
});

test('pageview is a track wrapper for the pageview event', () => {
  const storage = mkStorage();
  const a = createAnalytics({ storage, now: () => 7 });
  const r = a.pageview({ path: '/home', campaign: 'c1', source: 'qr', ref: 'example.com' });
  assert.equal(r.ok, true);
  assert.equal(r.row.event, 'pageview');
  assert.equal(r.row.meta.path, '/home');
  assert.equal(r.row.meta.ref, 'example.com');
});

test('conversion records a conversion event with a numeric value', () => {
  const storage = mkStorage();
  const a = createAnalytics({ storage, now: () => 9 });
  const r = a.conversion({ campaign: 'c1', value: '12.5', source: 'qr' });
  assert.equal(r.ok, true);
  assert.equal(r.row.event, 'conversion');
  assert.equal(r.row.value, 12.5);
  // non-numeric value coerces to 0, never throws
  const r2 = a.conversion({ campaign: 'c1', value: 'not-a-number' });
  assert.equal(r2.row.value, 0);
});

test('summary counts by event/campaign/source + conversion value', () => {
  const a = createAnalytics({ storage: mkStorage(), now: fakeClock() });
  a.pageview({ path: '/a', campaign: 'c1', source: 'qr' });
  a.pageview({ path: '/b', campaign: 'c1', source: 'email' });
  a.track({ event: 'click', campaign: 'c1', source: 'qr' });
  a.conversion({ campaign: 'c1', value: 10, source: 'qr' });
  a.conversion({ campaign: 'c1', value: 5, source: 'email' });

  const s = a.summary({});
  assert.equal(s.events, 5);
  assert.equal(s.byEvent.pageview, 2);
  assert.equal(s.byEvent.click, 1);
  assert.equal(s.byEvent.conversion, 2);
  assert.equal(s.byCampaign.c1, 5);
  assert.equal(s.bySource.qr, 3);
  assert.equal(s.bySource.email, 2);
  assert.equal(s.conversions, 2);
  assert.equal(s.conversionValue, 15);
});

test('summary filters by campaign and sinceMs', () => {
  const storage = mkStorage();
  const a = createAnalytics({ storage, now: () => 0 });
  storage.events.push({ ts: 100, event: 'pageview', campaign: 'c1', source: 'qr', value: 0, meta: {} });
  storage.events.push({ ts: 300, event: 'pageview', campaign: 'c1', source: 'qr', value: 0, meta: {} });
  storage.events.push({ ts: 300, event: 'pageview', campaign: 'c2', source: 'qr', value: 0, meta: {} });

  const byCamp = a.summary({ campaign: 'c1' });
  assert.equal(byCamp.events, 2);

  const bySince = a.summary({ campaign: 'c1', sinceMs: 200 });
  assert.equal(bySince.events, 1);
});

test('funnel counts events per ordered step', () => {
  const a = createAnalytics({ storage: mkStorage(), now: fakeClock() });
  for (let i = 0; i < 5; i++) a.track({ event: 'view', campaign: 'c1' });
  for (let i = 0; i < 3; i++) a.track({ event: 'signup', campaign: 'c1' });
  for (let i = 0; i < 1; i++) a.track({ event: 'purchase', campaign: 'c1' });
  a.track({ event: 'view', campaign: 'other' }); // different campaign — excluded

  const f = a.funnel('c1', ['view', 'signup', 'purchase']);
  assert.deepEqual(f, [
    { step: 'view', count: 5 },
    { step: 'signup', count: 3 },
    { step: 'purchase', count: 1 },
  ]);
});

test('funnel soft-handles bad steps input (no throw)', () => {
  const a = createAnalytics({ storage: mkStorage(), now: () => 1 });
  assert.deepEqual(a.funnel('c1', null), []);
  assert.deepEqual(a.funnel('c1', undefined), []);
});

test('topSources ranks sources by count and honors n', () => {
  const a = createAnalytics({ storage: mkStorage(), now: fakeClock() });
  for (let i = 0; i < 4; i++) a.track({ event: 'view', campaign: 'c1', source: 'qr' });
  for (let i = 0; i < 2; i++) a.track({ event: 'view', campaign: 'c1', source: 'email' });
  a.track({ event: 'view', campaign: 'c1', source: 'social' });

  const top = a.topSources('c1');
  assert.deepEqual(top, [
    { source: 'qr', count: 4 },
    { source: 'email', count: 2 },
    { source: 'social', count: 1 },
  ]);
  const top2 = a.topSources('c1', 2);
  assert.equal(top2.length, 2);
  assert.equal(top2[0].source, 'qr');
});

test('pushUmami uses the injected fetch and reports ok on 2xx', async () => {
  const calls = [];
  const mockFetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; };
  const a = createAnalytics({ storage: mkStorage(), now: () => 1, fetch: mockFetch, umamiUrl: 'https://umami.test/api/send' });
  const r = await a.pushUmami({ event: 'view', campaign: 'c1' });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://umami.test/api/send');
  assert.equal(calls[0].init.method, 'POST');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.payload.campaign, 'c1');
});

test('pushUmami soft-fails on a bad response (no throw)', async () => {
  const mockFetch = async () => ({ ok: false, status: 500 });
  const a = createAnalytics({ storage: mkStorage(), now: () => 1, fetch: mockFetch, umamiUrl: 'https://umami.test/api/send' });
  const r = await a.pushUmami({ event: 'view' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 500);
});

test('pushUmami soft-fails when fetch throws (no throw to caller)', async () => {
  const mockFetch = async () => { throw new Error('network down'); };
  const a = createAnalytics({ storage: mkStorage(), now: () => 1, fetch: mockFetch, umamiUrl: 'https://umami.test/api/send' });
  const r = await a.pushUmami({ event: 'view' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /fetch failed/);
});

test('pushUmami uses module-level __setFetch when no per-instance fetch', async () => {
  const calls = [];
  __setFetch(async (url) => { calls.push(url); return { ok: true, status: 204 }; });
  const a = createAnalytics({ storage: mkStorage(), now: () => 1, umamiUrl: 'https://umami.test/api/send' });
  const r = await a.pushUmami({ event: 'view' });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  __setFetch(null);
});

test('pushUmami soft-fails when no endpoint configured', async () => {
  const a = createAnalytics({ storage: mkStorage(), now: () => 1, fetch: async () => ({ ok: true }) });
  const r = await a.pushUmami({ event: 'view' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no umami endpoint/);
});

// ── HTTP handler ──────────────────────────────────────────────────────────────────────────────────────
function mockRes() {
  return {
    statusCode: 0, headers: null, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(b) { this.body = b == null ? '' : String(b); },
  };
}

test('handler POST /api/track records via the injected analytics', async () => {
  const a = createAnalytics({ storage: mkStorage(), now: () => 5 });
  const res = mockRes();
  await handler({ method: 'POST', url: '/api/track', body: { event: 'click', campaign: 'c1', source: 'qr' } }, res, { analytics: a });
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.ok, true);
  assert.equal(a.storage.events.length, 1);
});

test('handler POST /api/track soft-fails (400) on bad input', async () => {
  const a = createAnalytics({ storage: mkStorage(), now: () => 5 });
  const res = mockRes();
  await handler({ method: 'POST', url: '/api/track', body: { campaign: 'c1' } }, res, { analytics: a });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).ok, false);
});

test('handler GET /api/summary returns the summary shape', async () => {
  const a = createAnalytics({ storage: mkStorage(), now: fakeClock() });
  a.pageview({ path: '/a', campaign: 'c1', source: 'qr' });
  a.conversion({ campaign: 'c1', value: 9, source: 'qr' });
  const res = mockRes();
  await handler({ method: 'GET', url: '/api/summary?campaign=c1' }, res, { analytics: a });
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.ok, true);
  assert.equal(out.summary.events, 2);
  assert.equal(out.summary.conversionValue, 9);
});

test('handler GET /health reports ok + event count', async () => {
  const a = createAnalytics({ storage: mkStorage(), now: () => 1 });
  a.track({ event: 'view' });
  const res = mockRes();
  await handler({ method: 'GET', url: '/health' }, res, { analytics: a });
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.ok, true);
  assert.equal(out.events, 1);
});

test('handler returns 404 for unknown routes', async () => {
  const res = mockRes();
  await handler({ method: 'GET', url: '/nope' }, res, { analytics: createAnalytics({ storage: mkStorage() }) });
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).ok, false);
});
