// casino.test.mjs — offline tests for the casino dice HTTP surface. node --test, no network.
// Drives handler(req,res) with a tiny fake req/res and asserts on status + body: home renders the
// committed serverSeedHash and the not-real-money/provably-fair banner, /roll settles, /verify
// recomputes, robots/sitemap/llms serve, XSS is escaped, and nothing throws on garbage.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handler, homePage, verifyPage, esc, DEMO_SERVER_SEED, DEMO_SERVER_SEED_HASH, SITEMAP_PATHS,
} from './server.mjs';
import { roll as diceRoll, commit } from '../../integrations/games/dice-provably-fair.mjs';

// Minimal response double capturing status/headers/body.
function mkRes() {
  return {
    statusCode: null, headers: null, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
    end(chunk) { if (chunk != null) this.body += chunk; this.ended = true; },
  };
}
async function get(path) {
  const res = mkRes();
  await handler({ url: path, method: 'GET' }, res);
  return res;
}

test('home 200, shows serverSeedHash + not-real-money + provably-fair banner', async () => {
  const res = await get('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.ok(res.body.includes(DEMO_SERVER_SEED_HASH), 'committed server-seed hash shown');
  assert.match(res.body, /not real money/i);
  assert.match(res.body, /provably fair/i);
  assert.match(res.body, /verify any roll/i);
  assert.match(res.body, /Roll the dice/);
});

test('home shows a responsible-play note', async () => {
  const res = await get('/');
  assert.match(res.body, /Play responsibly/i);
});

test('DEMO_SERVER_SEED_HASH is the SHA256 commitment of the demo seed', () => {
  assert.equal(DEMO_SERVER_SEED_HASH, commit(DEMO_SERVER_SEED));
  assert.equal(DEMO_SERVER_SEED_HASH.length, 64);
});

test('/roll computes a settlement and renders WIN or LOSE', async () => {
  // target 50.00 over, nonce 3 → deterministic outcome.
  const res = await get('/roll?target=50.00&over=over&bet=10&clientSeed=abc&nonce=3');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /WIN|LOSE/);
  // The shown HMAC digest must be the real one for these inputs.
  const expected = diceRoll({ serverSeed: DEMO_SERVER_SEED, clientSeed: 'abc', nonce: 3 });
  assert.ok(res.body.includes(expected.hmac), 'renders the true HMAC digest');
  assert.match(res.body, /Multiplier/);
  assert.match(res.body, /Payout/);
});

test('/roll result is consistent with the engine (win flag)', async () => {
  const clientSeed = 'consistency', nonce = 11;
  const r = diceRoll({ serverSeed: DEMO_SERVER_SEED, clientSeed, nonce });
  const win = r.roll > 5000; // over 50.00
  const res = await get(`/roll?target=50.00&over=over&bet=5&clientSeed=${clientSeed}&nonce=${nonce}`);
  if (win) assert.match(res.body, /WIN/); else assert.match(res.body, /LOSE/);
});

test('/verify recomputes a roll and confirms the commitment', async () => {
  const clientSeed = 'audit-me', nonce = 9;
  const r = diceRoll({ serverSeed: DEMO_SERVER_SEED, clientSeed, nonce });
  const res = await get(`/verify?serverSeed=${encodeURIComponent(DEMO_SERVER_SEED)}&serverSeedHash=${DEMO_SERVER_SEED_HASH}&clientSeed=${clientSeed}&nonce=${nonce}&roll=${r.roll}`);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /MATCHES/);            // commitment good
  assert.match(res.body, /reproduces/i);
  assert.match(res.body, /PROVABLY FAIR/);      // overall verify() passed
});

test('/verify flags a tampered roll as failing', async () => {
  const clientSeed = 'audit-me', nonce = 9;
  const r = diceRoll({ serverSeed: DEMO_SERVER_SEED, clientSeed, nonce });
  const bad = r.roll === 0 ? 1 : r.roll - 1;
  const res = await get(`/verify?serverSeed=${encodeURIComponent(DEMO_SERVER_SEED)}&serverSeedHash=${DEMO_SERVER_SEED_HASH}&clientSeed=${clientSeed}&nonce=${nonce}&roll=${bad}`);
  assert.match(res.body, /FAILED/);
});

test('/verify flags a wrong published hash as not matching', async () => {
  const res = await get(`/verify?serverSeed=${encodeURIComponent(DEMO_SERVER_SEED)}&serverSeedHash=deadbeef&clientSeed=x&nonce=0&roll=0`);
  assert.match(res.body, /DOES NOT MATCH/);
});

test('/health, /robots.txt, /sitemap.xml, /sitemap-index.xml, /llms.txt serve', async () => {
  assert.equal((await get('/health')).body, 'ok');
  const robots = await get('/robots.txt');
  assert.match(robots.headers['content-type'], /text\/plain/);
  assert.match(robots.body, /User-agent|Sitemap/i);
  const sm = await get('/sitemap.xml');
  assert.match(sm.headers['content-type'], /xml/);
  assert.match(sm.body, /<urlset/);
  for (const p of SITEMAP_PATHS) assert.ok(sm.body.includes(p === '/' ? '/</loc>' : p), `sitemap lists ${p}`);
  const smi = await get('/sitemap-index.xml');
  assert.match(smi.body, /<sitemapindex/);
  const llms = await get('/llms.txt');
  assert.match(llms.body, /not real money|NOT real money/i);
});

test('XSS: client seed is escaped in home and verify output', async () => {
  const xss = '<script>alert(1)</script>';
  const res = await get(`/roll?target=50.00&over=over&bet=1&clientSeed=${encodeURIComponent(xss)}&nonce=0`);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'raw script must not appear');
  assert.match(res.body, /&lt;script&gt;/);
  const res2 = await get(`/verify?serverSeed=x&clientSeed=${encodeURIComponent(xss)}&nonce=0&roll=0`);
  assert.ok(!res2.body.includes('<script>alert(1)</script>'));
});

test('unknown path redirects home', async () => {
  const res = await get('/nope');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

test('soft-fail: handler never throws on garbage', async () => {
  await assert.doesNotThrow(async () => { await get('/roll?target=NaN&over=zzz&bet=abc&nonce=xyz&clientSeed='); });
  await assert.doesNotThrow(async () => { await get('/verify?serverSeed=&nonce=notanumber&roll=%%%'); });
  await assert.doesNotThrow(async () => { await get('/roll'); });
  const res = await get('/roll?target=999999&over=over&bet=-5&nonce=-1&clientSeed=x');
  assert.equal(res.statusCode, 200); // clamped, still renders
});

test('homePage()/verifyPage() are pure string renderers', () => {
  assert.match(homePage(), /<!doctype html>/i);
  assert.match(verifyPage(), /Verify a roll/);
  // esc is exported and works
  assert.equal(esc('<a>'), '&lt;a&gt;');
});
