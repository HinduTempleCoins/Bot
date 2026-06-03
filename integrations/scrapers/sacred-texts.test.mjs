// Offline tests for the Sacred-Texts / Theoi corpus scrapers. No real network: fetch is injected with
// canned HTML strings. Run: node --test integrations/scrapers/sacred-texts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSacredText, parseTheoi, cleanText, toJsonl, scrapeUrl, __setFetch, UA, RATE_LIMIT_MS,
} from './sacred-texts.mjs';

// ── canned HTML samples (sacred-texts.com / theoi.com simple static markup) ──
const SACRED_HTML = `<!DOCTYPE html>
<html lang="en"><head>
  <title>The Epic of Gilgamesh: Tablet I | Sacred Texts</title>
  <meta name="author" content="R. Campbell Thompson">
  <style>.nav{color:red}</style>
  <script>var x=1;</script>
</head><body>
  <nav><a href="/index.htm">Home</a> | <a href="/ane/">Ancient Near East</a></nav>
  <header>Sacred-Texts Archive</header>
  <h1>The Epic of Gilgamesh</h1>
  <p>He who saw the deep, the foundation of the country,
     who knew &amp; was wise in all things.</p>
  <p>Gilgamesh, the king, knew the&nbsp;countries of the world.</p>
  <footer>Copyright public domain. Scanned at sacred-texts.com</footer>
</body></html>`;

const THEOI_HTML = `<!DOCTYPE html>
<html lang="en"><head>
  <title>HATHOR - Egyptian Goddess (Theoi)</title>
  <script>analytics();</script>
</head><body>
  <nav>Greek Mythology &gt; Goddesses</nav>
  <h2>APHRODITE</h2>
  <blockquote>"Golden Aphrodite, who stirs sweet passion in the gods." &mdash; Homer</blockquote>
  <p>APHRODITE was the Olympian goddess of love, beauty &amp; pleasure.</p>
  <footer>theoi.com</footer>
</body></html>`;

test('parseSacredText extracts title + body, tags source/license', () => {
  const r = parseSacredText(SACRED_HTML, { url: 'https://www.sacred-texts.com/ane/gilgamesh.htm' });
  assert.equal(r.source, 'sacred-texts');
  assert.equal(r.license, 'public-domain-or-archive');
  assert.equal(r.url, 'https://www.sacred-texts.com/ane/gilgamesh.htm');
  // title: <title> suffix trimmed
  assert.equal(r.title, 'The Epic of Gilgamesh: Tablet I');
  // body: real text present, entities decoded, nav/script/style/footer gone
  assert.match(r.body, /foundation of the country/);
  assert.match(r.body, /wise in all things/);
  assert.match(r.body, /knew the countries/);     // &nbsp; collapsed
  assert.ok(r.body.includes('&'), 'decoded &amp; → &');
  assert.ok(!/var x=1/.test(r.body), 'script stripped');
  assert.ok(!/color:red/.test(r.body), 'style stripped');
  assert.ok(!/Ancient Near East/.test(r.body), 'nav stripped');
  // optional fields
  assert.equal(r.author, 'R. Campbell Thompson');
  assert.equal(r.lang, 'en');
  assert.ok(r.fetchedAt && !Number.isNaN(Date.parse(r.fetchedAt)));
});

test('parseTheoi extracts title + body, tags source theoi', () => {
  const r = parseTheoi(THEOI_HTML, { url: 'https://www.theoi.com/Olympios/Aphrodite.html' });
  assert.equal(r.source, 'theoi');
  assert.equal(r.license, 'public-domain-or-archive');
  assert.equal(r.title, 'HATHOR'); // <title> trimmed at " - " separator
  assert.match(r.body, /Olympian goddess of love/);
  assert.match(r.body, /stirs sweet passion/);        // blockquote captured
  assert.ok(r.body.includes('—'), 'mdash decoded');
  assert.ok(!/analytics\(\)/.test(r.body), 'script stripped');
  assert.equal(r.lang, 'en');
});

test('cleanText strips tags, decodes entities, collapses whitespace', () => {
  const out = cleanText('<p>Hello &amp; <b>world</b>   &mdash;   ok&#39;s</p><script>bad()</script>');
  assert.ok(!/<[^>]+>/.test(out), 'no tags remain');
  assert.ok(!/bad\(\)/.test(out), 'script removed');
  assert.match(out, /Hello & world/);
  assert.match(out, /—/);
  assert.match(out, /ok's/);
  assert.ok(!/ {2,}/.test(out), 'whitespace collapsed');
  assert.equal(cleanText(''), '');
  assert.equal(cleanText(null), '');
});

test('toJsonl round-trips records and handles empty', () => {
  assert.equal(toJsonl([]), '');
  assert.equal(toJsonl(null), '');
  const recs = [
    parseSacredText(SACRED_HTML, { url: 'https://www.sacred-texts.com/a.htm' }),
    parseTheoi(THEOI_HTML, { url: 'https://www.theoi.com/b.html' }),
  ];
  const jsonl = toJsonl(recs);
  const lines = jsonl.split('\n');
  assert.equal(lines.length, 2);
  const parsed = lines.map((l) => JSON.parse(l));
  assert.deepEqual(parsed[0], recs[0]);
  assert.deepEqual(parsed[1], recs[1]);
  // null entries filtered out
  assert.equal(toJsonl([null, recs[0], null]).split('\n').length, 1);
});

test('parsers soft-fail on garbage / empty input', () => {
  assert.equal(parseSacredText('', { url: 'x' }), null);
  assert.equal(parseSacredText(null, {}), null);
  assert.equal(parseTheoi(undefined, {}), null);
  assert.equal(parseSacredText('<html><body></body></html>', {}), null);
});

test('scrapeUrl routes by hostname with injected fetch', async () => {
  __setFetch(async (url) => ({
    ok: true,
    text: async () => (url.includes('theoi') ? THEOI_HTML : SACRED_HTML),
  }));
  const st = await scrapeUrl('https://www.sacred-texts.com/ane/gilgamesh.htm');
  assert.equal(st.source, 'sacred-texts');
  assert.match(st.title, /Gilgamesh/);
  const th = await scrapeUrl('https://www.theoi.com/Olympios/Aphrodite.html');
  assert.equal(th.source, 'theoi');
  // unknown host → null, no fetch needed
  const unk = await scrapeUrl('https://example.com/x');
  assert.equal(unk, null);
  __setFetch(null);
});

test('scrapeUrl soft-fails on thrown fetch and non-OK response', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  assert.equal(await scrapeUrl('https://www.sacred-texts.com/x.htm'), null);
  __setFetch(async () => ({ ok: false, status: 404, text: async () => 'nope' }));
  assert.equal(await scrapeUrl('https://www.theoi.com/x.html'), null);
  __setFetch(null);
});

test('polite + no-secrets sanity: UA string + rate-limit floor present', () => {
  assert.ok(/MELEK-Bot/.test(UA) && /robots\.txt/i.test(UA), 'clear UA mentioning robots');
  assert.ok(typeof RATE_LIMIT_MS === 'number' && RATE_LIMIT_MS >= 1000, 'rate-limit floor >= 1s');
});
