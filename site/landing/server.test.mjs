// server.test.mjs — offline tests for site/landing. No network: data comes from injected readers /
// passed directly to renderLanding. Asserts both sections render, the empty/not-wired states render,
// and that HTML is escaped (no raw <script>, attributes quoted-safe).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const srv = await import('./server.mjs');
const { handler, renderLanding, esc, __setWelcomeReader, __setCheetahReader, __resetReaders } = srv;

// nasty inputs to prove esc() coverage everywhere
const XSS = '<script>alert(1)</script>';
const fakeWelcome = {
  author: 'hathor', permlink: 'introducing-hathor-on-melek',
  title: `Introducing Hathor ${XSS}`, url: 'https://witness.melek.salon/@hathor/introducing-hathor-on-melek',
  blurb: `A founding witness ${XSS} on MELEK.`, created: '2026-06-05T12:00:00', votes: 42, payout: '0.000 TBD',
};
const fakeCheetah = {
  generatedAt: '2026-06-10T09:30:00Z', source: `cheetah/alpha-report ${XSS}`,
  url: 'https://alpha.melek.salon/cheetah/',
  summary: { scanned: 120, matches: 8, credited: 5, flagged: 3 },
  results: [
    { title: `Reposted thread ${XSS}`, platform: 'hive', status: 'credited', score: 0.93, url: 'https://example.com/a"b', note: `attributed ${XSS}` },
    { title: 'Image lift', platform: 'twitter', status: 'flagged', score: 0.71, note: 'phash near-dup' },
    { title: 'Original', platform: 'melek', status: 'clear', score: 0.02 },
  ],
};

// minimal mock req/res
function mockRes() {
  return {
    statusCode: 0, headers: {}, body: '',
    writeHead(code, h) { this.statusCode = code; if (h) Object.assign(this.headers, h); },
    end(d) { if (d != null) this.body += String(d); this._done = true; },
  };
}
async function call(url = '/') {
  const res = mockRes();
  await handler({ method: 'GET', url, headers: {} }, res);
  return res;
}

test('renderLanding shows the welcome section with title, blurb, and link', () => {
  const html = renderLanding({ welcomePost: fakeWelcome, cheetahResults: null });
  assert.ok(html.includes('Introducing Hathor'), 'welcome title present');
  assert.ok(html.includes('A founding witness'), 'blurb present');
  assert.ok(html.includes('introducing-hathor-on-melek'), 'permlink ref present');
  assert.ok(html.includes('Read the welcome post'), 'CTA present');
});

test('renderLanding shows the cheetah section with summary stats and a results table', () => {
  const html = renderLanding({ welcomePost: null, cheetahResults: fakeCheetah });
  assert.ok(html.includes('Latest Cheetah results'), 'cheetah heading present');
  assert.ok(html.includes('<table'), 'results table rendered');
  assert.ok(html.includes('Reposted thread'), 'a result row title present');
  assert.ok(html.includes('120'), 'scanned stat present');
  assert.ok(html.includes('credited'), 'status pill present');
  assert.ok(html.includes('Open the full Cheetah report'), 'report CTA present');
});

test('HTML is escaped — no raw script tags leak through any field', () => {
  const html = renderLanding({ welcomePost: fakeWelcome, cheetahResults: fakeCheetah });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script must not appear');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped script entity present');
  // the result url has a double-quote which must be escaped in the href attribute
  assert.ok(!html.includes('href="https://example.com/a"b"'), 'unescaped quote must not break the attribute');
  assert.ok(html.includes('a&quot;b'), 'quote escaped inside attribute');
});

test('empty / not-wired state renders gracefully for both sections', () => {
  const html = renderLanding({});
  assert.ok(html.includes("Hathor's Welcome post"), 'welcome empty heading present');
  assert.ok(html.includes('Latest Cheetah results'), 'cheetah empty heading present');
  assert.ok(html.includes('Not wired yet'), 'not-wired messaging present');
  // no table when there are no results
  assert.ok(!html.includes('<table'), 'no table in the empty state');
});

test('cheetah section with zero result rows shows the no-rows message, not a table', () => {
  const html = renderLanding({ cheetahResults: { generatedAt: '2026-06-10T00:00:00Z', results: [] } });
  assert.ok(html.includes('no result rows'), 'empty-results message present');
  assert.ok(!html.includes('<thead>'), 'no table header for empty results');
});

test('handler GET / serves a 200 HTML page using injected readers', async () => {
  __setWelcomeReader(async () => fakeWelcome);
  __setCheetahReader(async () => fakeCheetah);
  const res = await call('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.ok(res.body.includes('Introducing Hathor'));
  assert.ok(res.body.includes('Latest Cheetah results'));
  __resetReaders();
});

test('handler soft-fails when a reader throws — page still renders', async () => {
  __setWelcomeReader(async () => { throw new Error('boom'); });
  __setCheetahReader(async () => { throw new Error('boom'); });
  const res = await call('/');
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('Not wired yet'), 'falls back to empty state on reader error');
  __resetReaders();
});

test('handler /api/landing.json returns injected data as JSON', async () => {
  __setWelcomeReader(async () => fakeWelcome);
  __setCheetahReader(async () => fakeCheetah);
  const res = await call('/api/landing.json');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  const obj = JSON.parse(res.body);
  assert.equal(obj.welcomePost.permlink, 'introducing-hathor-on-melek');
  assert.equal(obj.cheetahResults.summary.scanned, 120);
  __resetReaders();
});

test('handler /health returns ok and unknown paths redirect to /', async () => {
  const h = await call('/health');
  assert.equal(h.statusCode, 200);
  assert.equal(h.body, 'ok');
  const r = await call('/nope');
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, '/');
});

test('esc() escapes the five HTML-significant characters', () => {
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});
