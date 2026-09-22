// seo.test.mjs — OFFLINE. The shared <head> helper, focused on the opt-in cookieless pageview beacon.
import { test } from 'node:test';
import assert from 'node:assert';
import { headTags, analyticsBeaconTag, faqJsonLd, citationBlock, jsonLdScript } from './seo.mjs';

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

// ── faqJsonLd ─────────────────────────────────────────────────────────────────────────────────────
test('faqJsonLd builds a valid FAQPage from {q,a} pairs and skips empties', () => {
  const node = faqJsonLd([{ q: 'What is it?', a: 'A thing.' }, { q: '', a: 'no question' }, null]);
  assert.equal(node['@type'], 'FAQPage');
  assert.equal(node.mainEntity.length, 1);
  assert.equal(node.mainEntity[0].name, 'What is it?');
  assert.equal(node.mainEntity[0].acceptedAnswer.text, 'A thing.');
  // renders to valid JSON inside a guarded <script>
  const parsed = JSON.parse(jsonLdScript(node).replace(/^<script[^>]*>|<\/script>$/g, ''));
  assert.equal(parsed['@type'], 'FAQPage');
});

test('faqJsonLd returns null when there are no usable pairs', () => {
  assert.equal(faqJsonLd([]), null);
  assert.equal(faqJsonLd([{ q: '', a: '' }]), null);
  assert.equal(faqJsonLd('nonsense'), null);
});

// ── citationBlock (GEO) ─────────────────────────────────────────────────────────────────────────
test('citationBlock returns visible html + a citable JSON-LD node with attribution', () => {
  const { html, jsonld } = citationBlock({
    title: 'Brown v. Board of Education', url: 'https://law.soapbox.community/cases',
    author: 'SoapBox Law', publisher: 'SoapBox Law', datePublished: '1954-05-17',
    sourceOfRecord: 'Caselaw Access Project', sourceUrl: 'https://cite.case.law/us/347/483/',
    license: 'https://creativecommons.org/publicdomain/mark/1.0/', type: 'Legislation', accessed: '2026-09-22',
  });
  assert.match(html, /Cite this page/);
  assert.match(html, /<cite/);
  assert.match(html, /Brown v\. Board of Education/);
  assert.match(html, /Accessed 2026-09-22/);
  assert.equal(jsonld['@type'], 'Legislation');
  assert.equal(jsonld.author.name, 'SoapBox Law');
  assert.equal(jsonld.isBasedOn, 'https://cite.case.law/us/347/483/');
  assert.equal(jsonld.license, 'https://creativecommons.org/publicdomain/mark/1.0/');
});

test('citationBlock esc()s the title in the visible block (no HTML injection)', () => {
  const { html } = citationBlock({ title: '<img src=x onerror=alert(1)>', url: 'https://x/', author: 'A' });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
});

test('citationBlock defaults publisher to SoapBox (uses the shared Org @id)', () => {
  const { jsonld } = citationBlock({ title: 'X', url: 'https://x/' });
  assert.ok(jsonld.publisher['@id'], 'default publisher references the shared Organization node');
});
