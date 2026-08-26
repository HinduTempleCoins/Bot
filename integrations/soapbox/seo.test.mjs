// seo.test.mjs — OFFLINE. The shared <head> helper, focused on the opt-in cookieless pageview beacon.
import { test } from 'node:test';
import assert from 'node:assert';
import { headTags, analyticsBeaconTag } from './seo.mjs';

const opts = { title: 'T', description: 'D', canonical: 'https://x.soapbox.community/p', siteName: 'X' };

test('headTags() emits NO beacon when ANALYTICS_BEACON_URL is unset (default off)', () => {
  const prev = process.env.ANALYTICS_BEACON_URL;
  delete process.env.ANALYTICS_BEACON_URL;
  try {
    const out = headTags(opts);
    assert.doesNotMatch(out, /sendBeacon|<script>\(function/);
  } finally { if (prev === undefined) delete process.env.ANALYTICS_BEACON_URL; else process.env.ANALYTICS_BEACON_URL = prev; }
});

test('default-off output is BYTE-IDENTICAL whether the env var is unset or empty', () => {
  const prev = process.env.ANALYTICS_BEACON_URL;
  try {
    delete process.env.ANALYTICS_BEACON_URL;
    const unset = headTags(opts);
    process.env.ANALYTICS_BEACON_URL = '';
    const empty = headTags(opts);
    assert.equal(unset, empty);
    assert.doesNotMatch(unset, /sendBeacon/);
  } finally { if (prev === undefined) delete process.env.ANALYTICS_BEACON_URL; else process.env.ANALYTICS_BEACON_URL = prev; }
});

test('headTags() appends the beacon ONLY when ANALYTICS_BEACON_URL is set', () => {
  const prev = process.env.ANALYTICS_BEACON_URL;
  process.env.ANALYTICS_BEACON_URL = 'https://analytics.soapbox.community/px';
  try {
    const on = headTags(opts);
    assert.match(on, /navigator\.sendBeacon/);
    assert.match(on, /https:\/\/analytics\.soapbox\.community\/px/);
    // the ON output is exactly the OFF output plus the appended beacon tag
    delete process.env.ANALYTICS_BEACON_URL;
    const off = headTags(opts);
    assert.equal(on, off + '\n' + analyticsBeaconTag('https://analytics.soapbox.community/px'));
  } finally { if (prev === undefined) delete process.env.ANALYTICS_BEACON_URL; else process.env.ANALYTICS_BEACON_URL = prev; }
});

test('analyticsBeaconTag: cookieless, one sendBeacon, fetch fallback, DNT honoured, no cookies', () => {
  const tag = analyticsBeaconTag('https://a.example/px');
  assert.match(tag, /navigator\.sendBeacon/);
  assert.match(tag, /keepalive:true/);        // fetch fallback
  assert.match(tag, /doNotTrack/);            // honours DNT/GPC
  assert.doesNotMatch(tag, /document\.cookie|localStorage/); // cookieless, no storage
  assert.equal(analyticsBeaconTag(''), '');   // falsy url → nothing
});

test('analyticsBeaconTag neutralises a </script> breakout in the url', () => {
  const tag = analyticsBeaconTag('https://a.example/px?x=</script><script>alert(1)</script>');
  assert.doesNotMatch(tag, /<\/script><script>alert/);  // "<" escaped to <
  assert.match(tag, /\\u003c/);
});
