// geogate.test.mjs — geofence scaffolding. OFFLINE, pure, never throws.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  normRegion, blockedRegions, geoMode, isBlocked, regionFromRequest,
  gateDecision, decide, noticeHtml, clientHook, serverGate,
} from './geogate.mjs';

function clearEnv() { delete process.env.ARCADE_BLOCKED_REGIONS; delete process.env.ARCADE_GEO_MODE; }

test('normRegion normalizes case/whitespace', () => {
  assert.equal(normRegion(' us '), 'US');
  assert.equal(normRegion('us-wa'), 'US-WA');
  assert.equal(normRegion(null), '');
});

test('blockedRegions parses the env csv, deduped + normalized', () => {
  clearEnv();
  assert.deepEqual(blockedRegions(), []);            // default: none (allow-with-disclaimer)
  process.env.ARCADE_BLOCKED_REGIONS = 'us, US-WA fr,,';
  assert.deepEqual(blockedRegions(), ['US', 'US-WA', 'FR']);
  clearEnv();
});

test('default mode is disclaimer; block is opt-in', () => {
  clearEnv();
  assert.equal(geoMode(), 'disclaimer');
  process.env.ARCADE_GEO_MODE = 'block';
  assert.equal(geoMode(), 'block');
  clearEnv();
});

test('isBlocked: country block also blocks its sub-regions', () => {
  assert.equal(isBlocked('US-WA', ['US']), true);    // US blocks US-WA
  assert.equal(isBlocked('US', ['US']), true);
  assert.equal(isBlocked('FR', ['US']), false);
  assert.equal(isBlocked('US-WA', ['US-WA']), true); // exact
  assert.equal(isBlocked('', ['US']), false);
});

test('regionFromRequest reads the header seam, no network, empty when unknown', () => {
  assert.equal(regionFromRequest({ headers: { 'cf-ipcountry': 'us' } }), 'US');
  assert.equal(regionFromRequest({ headers: { 'x-vercel-ip-country': 'FR', 'x-vercel-ip-country-region': 'IDF' } }), 'FR-IDF');
  assert.equal(regionFromRequest({ headers: { 'x-arcade-region': 'US-WA' } }), 'US-WA');
  assert.equal(regionFromRequest({ headers: {} }), '');
  assert.equal(regionFromRequest(null), '');         // never throws
});

test('gateDecision: disclaimer mode allows even a blocked region (allow-with-disclaimer)', () => {
  const d = gateDecision({ region: 'US', mode: 'disclaimer', list: ['US'] });
  assert.equal(d.blocked, true);
  assert.equal(d.allowed, true);                     // allow-with-disclaimer
  assert.equal(d.enforce, false);
});

test('gateDecision: block mode hard-denies a blocked region (the wired real-money seam)', () => {
  const d = gateDecision({ region: 'US-WA', mode: 'block', list: ['US'] });
  assert.equal(d.allowed, false);
  assert.equal(d.enforce, true);
});

test('noticeHtml always carries "not available where prohibited"', () => {
  assert.match(noticeHtml(gateDecision({ region: '' })), /not available where prohibited/i);
  assert.match(noticeHtml(gateDecision({ region: 'US', mode: 'block', list: ['US'] })), /not available in your region/i);
  assert.match(noticeHtml(), /not available where prohibited/i);   // default arg, never throws
});

test('clientHook is an inert no-network script string', () => {
  const s = clientHook();
  assert.match(s, /<script>/);
  assert.doesNotMatch(s, /fetch\(|XMLHttpRequest|navigator\.geolocation/);
});

test('serverGate: disclaimer mode never hard-blocks; block mode writes 451', () => {
  clearEnv();
  // disclaimer default → allowed through (returns true, writes nothing)
  let wrote = null;
  const res1 = { writeHead: (c) => { wrote = c; }, end: () => {} };
  assert.equal(serverGate({ headers: { 'cf-ipcountry': 'US' } }, res1), true);
  assert.equal(wrote, null);
  // block mode + blocked region → 451, returns false
  process.env.ARCADE_GEO_MODE = 'block';
  process.env.ARCADE_BLOCKED_REGIONS = 'US';
  let code = 0;
  const res2 = { writeHead: (c) => { code = c; }, end: () => {} };
  assert.equal(serverGate({ headers: { 'cf-ipcountry': 'US' } }, res2), false);
  assert.equal(code, 451);
  clearEnv();
});

test('decide reads the request and never throws on garbage', () => {
  assert.doesNotThrow(() => decide(undefined));
  assert.equal(typeof decide({ headers: {} }).allowed, 'boolean');
});
