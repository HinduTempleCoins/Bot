import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, esc, moonPhase, season, sunSign, greatAge, fireworksAllowed, FW_TYPES, utteranceOfDay, UTTERANCES } from './server.mjs';

// tiny fake response that captures status + body (lets us call handler without a live server)
function fakeRes() {
  return { code: 0, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b || ''; return this; } };
}
async function get(path) { const res = fakeRes(); await handler({ url: path, method: 'GET' }, res); return res; }

test('esc neutralizes HTML', () => {
  assert.equal(esc('<b>"x"&\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;&lt;/b&gt;');
});

test('moonPhase returns a bounded, named phase', () => {
  const mp = moonPhase(new Date(Date.UTC(2000, 0, 6, 18, 14))); // the epoch new moon
  assert.equal(mp.name, 'New Moon');
  assert.ok(mp.illum >= 0 && mp.illum <= 1);
  const full = moonPhase(new Date(Date.UTC(2000, 0, 6 + 14, 18, 14))); // ~half a synodic month later
  assert.ok(full.illum > 0.9, 'about-full moon is mostly illuminated');
});

test('season maps dates to northern-hemisphere seasons', () => {
  assert.equal(season(new Date(Date.UTC(2026, 6, 4))).name, 'Summer');   // July
  assert.equal(season(new Date(Date.UTC(2026, 0, 15))).name, 'Winter');  // Jan
  assert.equal(season(new Date(Date.UTC(2026, 3, 1))).name, 'Spring');   // April
  assert.equal(season(new Date(Date.UTC(2026, 9, 15))).name, 'Autumn');  // Oct
});

test('sunSign resolves known boundaries', () => {
  assert.equal(sunSign(1, 20).name, 'Aquarius');
  assert.equal(sunSign(1, 19).name, 'Capricorn');
  assert.equal(sunSign(7, 4).name, 'Cancer');
  assert.equal(sunSign(12, 25).name, 'Capricorn');
  assert.equal(sunSign(3, 21).name, 'Aries');
});

test('greatAge returns a named age', () => {
  assert.match(greatAge(2026).name, /Pisces|Aquarius/);
});

test('fireworksAllowed: MA total ban is empty, others default to all types', () => {
  assert.deepEqual(fireworksAllowed('MA'), []);
  assert.equal(fireworksAllowed('TX').length, FW_TYPES.length);
});

test('utteranceOfDay is deterministic and drawn from the leaves', () => {
  const d = new Date(Date.UTC(2026, 6, 4));
  assert.equal(utteranceOfDay(d), utteranceOfDay(d), 'same day → same utterance');
  assert.ok(UTTERANCES.includes(utteranceOfDay(d)));
});

test('home binds the whole: cross-links to Hathor, the Library, and 40 Hz', async () => {
  const res = await get('/');
  assert.match(res.body, /hathor\.live/, 'links to Hathor');
  assert.match(res.body, /wiki\.soapbox\.community/, 'links to the Library of Ashurbanipal (the Wiki)');
  assert.match(res.body, /40\s|40&nbsp;Hz|\/40hz/, 'links to the 40 Hz sessions');
  assert.match(res.body, /Spell Book/, 'framed as her Spell Book');
});

test('routes render 200 and escape output', async () => {
  for (const p of ['/', '/sky', '/birthday', '/sibyl', '/ages', '/garden', '/alchemy', '/fireworks']) {
    const res = await get(p);
    assert.equal(res.code, 200, `${p} is 200`);
    assert.match(res.body, /MELEK Almanack/, `${p} renders the shell`);
    assert.ok(!/<script>[^<]*document\.write/.test(res.body));
  }
});

test('birthday computes the sky for a valid date and rejects a bad one', async () => {
  const ok = await get('/birthday?d=1992-01-20');
  assert.equal(ok.code, 200);
  assert.match(ok.body, /Aquarius/); // 1992-01-20 is Aquarius
  const bad = await get('/birthday?d=not-a-date');
  assert.equal(bad.code, 200); // soft-fail: still renders the form, no throw
});

test('birthday reflects user input safely (no raw injection)', async () => {
  const res = await get('/birthday?d=' + encodeURIComponent('"><script>alert(1)</script>'));
  assert.equal(res.code, 200);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'injected script is escaped');
});

test('health, robots, sitemap', async () => {
  assert.equal((await get('/health')).body, 'ok');
  assert.match((await get('/robots.txt')).body, /User-?agent/i);
  assert.match((await get('/sitemap.xml')).body, /<urlset/);
});

test('unknown path soft-fails to 404 shell (no throw)', async () => {
  const res = await get('/nope');
  assert.equal(res.code, 404);
  assert.match(res.body, /Not found/);
});
