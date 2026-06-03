// analytics-selfhost.test.mjs — offline tests (node:test) for the self-hosted, privacy-first analytics.
// Verifies the Plausible privacy model: cookieless, no PII at rest, daily hash stable same-day but
// UNLINKABLE across days, and the summary/helpers count correctly.
//
//   node --test integrations/analytics-selfhost.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyVisitorId, newDailySalt, recordEvent, summary,
  viewsForPath, bounceRate, memStore,
  plausibleConfig, umamiConfig, dayOf, __setNow,
} from './analytics-selfhost.mjs';

const IP = '203.0.113.7';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) Firefox/124.0';

test('dailyVisitorId: stable within a day for the same input', () => {
  const salt = 'fixed-salt-aaa';
  const day = '2026-06-03';
  const h1 = dailyVisitorId({ ip: IP, ua: UA, salt, day });
  const h2 = dailyVisitorId({ ip: IP, ua: UA, salt, day });
  assert.equal(h1, h2, 'same input + same day + same salt = same hash');
  assert.match(h1, /^[0-9a-f]{64}$/, 'is a sha256 hex digest');
});

test('dailyVisitorId: DIFFERENT next day for the same input (cross-day unlinkable)', () => {
  // In a real deploy the salt rotates daily too; here we change BOTH day and salt, the production case.
  const today = dailyVisitorId({ ip: IP, ua: UA, salt: 'salt-day-1', day: '2026-06-03' });
  const tomorrow = dailyVisitorId({ ip: IP, ua: UA, salt: 'salt-day-2', day: '2026-06-04' });
  assert.notEqual(today, tomorrow, 'same person yields a different hash the next day');

  // Even with the SAME salt, rolling only the day must change the hash (the day is in the digest).
  const sameSaltA = dailyVisitorId({ ip: IP, ua: UA, salt: 'k', day: '2026-06-03' });
  const sameSaltB = dailyVisitorId({ ip: IP, ua: UA, salt: 'k', day: '2026-06-04' });
  assert.notEqual(sameSaltA, sameSaltB, 'day alone changes the hash → unlinkable across days');
});

test('dailyVisitorId: never contains / leaks the raw ip or ua', () => {
  const h = dailyVisitorId({ ip: IP, ua: UA, salt: 'whatever', day: '2026-06-03' });
  assert.ok(!h.includes(IP), 'hash does not contain the raw ip');
  assert.ok(!h.toLowerCase().includes('firefox'), 'hash does not contain the raw ua');
  assert.match(h, /^[0-9a-f]{64}$/);
});

test('newDailySalt: high-entropy, different each call', () => {
  const a = newDailySalt();
  const b = newDailySalt();
  assert.notEqual(a, b);
  assert.ok(a.length >= 32);
});

test('recordEvent: stores only the daily hash — NO raw ip/ua/PII', () => {
  const store = memStore();
  const salt = 'd-salt';
  const day = '2026-06-03';
  const visitor = dailyVisitorId({ ip: IP, ua: UA, salt, day });
  recordEvent(store, { path: '/markets?utm=x#frag', visitor, ts: Date.parse(day), ref: 'https://t.co/abc' });

  const ev = store.all()[0];
  assert.equal(store.length, 1);
  assert.equal(ev.visitor, visitor, 'event carries the daily hash');
  assert.equal(ev.path, '/markets', 'query + fragment stripped');
  assert.equal(ev.ref, 't.co', 'referrer reduced to hostname');

  const blob = JSON.stringify(ev);
  assert.ok(!blob.includes(IP), 'stored event has no raw ip');
  assert.ok(!blob.toLowerCase().includes('firefox'), 'stored event has no raw ua');
  assert.ok(!('ip' in ev) && !('ua' in ev), 'no ip/ua keys at all');
});

test('recordEvent: soft-fails on bad store / bad input (never throws)', () => {
  assert.equal(recordEvent(null, { path: '/x' }), null);
  assert.equal(recordEvent({}, { path: '/x' }), null);
  const store = memStore();
  const ev = recordEvent(store, {}); // no path → defaults to '/'
  assert.equal(ev.path, '/');
});

test('recordEvent: injected clock sets ts/day when not provided', () => {
  __setNow(() => Date.parse('2026-06-03T12:00:00Z'));
  const store = memStore();
  const ev = recordEvent(store, { path: '/home', visitor: 'h' });
  assert.equal(ev.day, '2026-06-03');
  assert.equal(dayOf(), '2026-06-03');
  __setNow(null);
});

test('summary: counts pageviews + uniques (two events same visitor same day = 1 unique)', () => {
  const store = memStore();
  const day = '2026-06-03';
  const v1 = dailyVisitorId({ ip: '1.1.1.1', ua: 'A', salt: 's', day });
  const v2 = dailyVisitorId({ ip: '2.2.2.2', ua: 'B', salt: 's', day });

  // v1 visits twice (same day) → 2 pageviews, 1 unique. v2 visits once.
  recordEvent(store, { path: '/markets', visitor: v1, ts: Date.parse(day) });
  recordEvent(store, { path: '/stocks', visitor: v1, ts: Date.parse(day) });
  recordEvent(store, { path: '/markets', visitor: v2, ts: Date.parse(day) });

  const s = summary(store, {});
  assert.equal(s.pageviews, 3, '3 pageviews');
  assert.equal(s.uniques, 2, 'same visitor twice counts once → 2 uniques');

  // topPages: /markets (2) ahead of /stocks (1)
  assert.deepEqual(s.topPages[0], ['/markets', 2]);
  assert.deepEqual(s.topPages.find((r) => r[0] === '/stocks'), ['/stocks', 1]);
});

test('summary: topReferrers + byDay + date filtering', () => {
  const store = memStore();
  const v = 'visitor-hash';
  recordEvent(store, { path: '/a', visitor: v, ts: Date.parse('2026-06-01'), ref: 'https://google.com/q' });
  recordEvent(store, { path: '/b', visitor: v, ts: Date.parse('2026-06-02'), ref: 'https://google.com/x' });
  recordEvent(store, { path: '/c', visitor: v, ts: Date.parse('2026-06-03') }); // direct

  const all = summary(store, {});
  assert.equal(all.pageviews, 3);
  assert.deepEqual(all.topReferrers[0], ['google.com', 2]);
  assert.ok(all.topReferrers.some((r) => r[0] === '(direct)'));
  assert.deepEqual(all.byDay, [['2026-06-01', 1], ['2026-06-02', 1], ['2026-06-03', 1]]);

  const win = summary(store, { from: '2026-06-02', to: '2026-06-03' });
  assert.equal(win.pageviews, 2, 'date window excludes 06-01');
});

test('summary: pure / empty store → zeros, never throws', () => {
  assert.deepEqual(summary(null, {}), { pageviews: 0, uniques: 0, topPages: [], topReferrers: [], byDay: [] });
  assert.deepEqual(summary(memStore(), {}).pageviews, 0);
});

test('viewsForPath: counts pageviews for one path correctly', () => {
  const store = memStore();
  recordEvent(store, { path: '/markets', visitor: 'a', ts: Date.now() });
  recordEvent(store, { path: '/markets', visitor: 'b', ts: Date.now() });
  recordEvent(store, { path: '/stocks', visitor: 'a', ts: Date.now() });
  recordEvent(store, { path: '/markets', type: 'event', visitor: 'c', ts: Date.now() }); // not a pageview

  assert.equal(viewsForPath(store, '/markets'), 2, 'only pageviews count');
  assert.equal(viewsForPath(store, '/markets?x=1'), 2, 'query normalized');
  assert.equal(viewsForPath(store, '/stocks'), 1);
  assert.equal(viewsForPath(store, '/never'), 0, 'never invented');
});

test('bounceRate: single-page daily visitors vs multi-page', () => {
  const store = memStore();
  const day = '2026-06-03';
  // bouncer: one page. engaged: two pages.
  recordEvent(store, { path: '/x', visitor: 'bouncer', ts: Date.parse(day) });
  recordEvent(store, { path: '/x', visitor: 'engaged', ts: Date.parse(day) });
  recordEvent(store, { path: '/y', visitor: 'engaged', ts: Date.parse(day) });

  assert.equal(bounceRate(store), 0.5, '1 of 2 daily-visitors bounced');
  assert.equal(bounceRate(memStore()), 0, 'empty → 0');
});

test('plausibleConfig: env NAMES (no secrets) + cookieless script tag', () => {
  const cfg = plausibleConfig({ domain: 'soapbox.community' });
  assert.equal(cfg.cookieless, true);
  assert.equal(cfg.storesPII, false);
  assert.ok(Array.isArray(cfg.envNames) && cfg.envNames.includes('SECRET_KEY_BASE'));
  // env entries are NAMES (UPPER_SNAKE), not values like "secret=abc123"
  for (const name of cfg.envNames) {
    assert.match(name, /^[A-Z][A-Z0-9_]*$/, `${name} is an env var NAME`);
    assert.ok(!name.includes('='), 'no key=value pairs');
  }
  assert.match(cfg.scriptTag, /<script[^>]*src=/, 'has a script tag');
  assert.match(cfg.scriptTag, /data-domain="soapbox\.community"/);
  // no secret-looking material embedded in the markup
  assert.ok(!/[A-Za-z0-9]{40,}/.test(cfg.scriptTag), 'no embedded long token/secret');
});

test('umamiConfig: env NAMES (no secrets) + cookieless script tag', () => {
  const cfg = umamiConfig({ domain: 'soapbox.community' });
  assert.equal(cfg.cookieless, true);
  assert.equal(cfg.storesPII, false);
  assert.ok(cfg.envNames.includes('APP_SECRET'));
  for (const name of cfg.envNames) {
    assert.match(name, /^[A-Z][A-Z0-9_]*$/);
  }
  assert.match(cfg.scriptTag, /<script[^>]*data-website-id=/, 'has a website-id tracker tag');
  assert.match(cfg.scriptTag, /src="https:\/\/umami\.soapbox\.community\/script\.js"/);
  // the website-id placeholder is not a real secret value
  assert.ok(cfg.scriptTag.includes('UMAMI_WEBSITE_ID'));
});
