// verify.test.mjs — KULA Provably-Fair verifier surface. OFFLINE, never throws, no request-time network.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, topVerifiers, __setLeaderboardReader } from './verify.mjs';
import * as dice from '../../integrations/games/dice-provably-fair.mjs';

function cap() {
  const o = { code: 0, type: '', body: '' };
  return { res: { writeHead: (c, h) => { o.code = c; o.type = (h && h['content-type']) || ''; }, end: (b) => { o.body = b == null ? '' : b; } }, o };
}
const req = (path, headers = {}) => ({ url: path, method: 'GET', headers });
const j = (o) => JSON.parse(o.body);
function affordances(html) { const out = []; const re = /<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/gi; let m; while ((m = re.exec(html))) out.push(m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()); return out; }
const BAD = /\b(buy|purchase|deposit|withdraw|cash\s*out|add funds|top ?up|sell|redeem for cash)\b/i;
function assertCompliant(body) {
  assert.match(body, /Entertainment only/i);
  assert.match(body, /not available where prohibited/i);
  assert.match(body, /no cash value/i);
  assert.match(body, /non-cashable/i);
  assert.match(body, /18\+|18 or older/i);
  assert.match(body, /alpha-badge/i);
  assert.match(body, /arcade-geo/i);
  for (const t of affordances(body)) assert.ok(!BAD.test(t), `affordance leaked money copy: "${t}"`);
  assert.doesNotMatch(body, /buy\s+play/i);
}

test('GET / renders the provably-fair explainer, verifier widget, per-surface links, compliant', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.equal(o.code, 200); assert.match(o.type, /text\/html/);
  assert.match(o.body, /Provably Fair/i);
  assert.match(o.body, /commit/i);
  assert.match(o.body, /serverSeedHash/);
  assert.match(o.body, /Recompute/);                       // client verifier widget
  assert.match(o.body, /leaderboard/i);
  assertCompliant(o.body);
});

test('leaderboard is graceful without a reader, and renders rows when one is wired', async () => {
  __setLeaderboardReader(null);
  assert.deepEqual(await topVerifiers(), []);
  const { res, o } = cap(); await handler(req('/'), res);
  assert.match(o.body, /No verifications recorded yet/i);
  __setLeaderboardReader(async () => [{ player: 'hathor', count: 42 }]);
  const c = cap(); await handler(req('/'), c.res);
  assert.match(c.o.body, /hathor/);
  assert.match(c.o.body, /42/);
  __setLeaderboardReader(null);
});

test('/api/verify reuses the pure engine and confirms a genuine commit-reveal', async () => {
  const serverSeed = 'epoch-seed-x';
  const serverSeedHash = dice.commit(serverSeed);
  const r = dice.roll({ serverSeed, clientSeed: 'abc', nonce: 3 }).roll;
  const { res, o } = cap();
  await handler(req(`/api/verify?serverSeed=${serverSeed}&serverSeedHash=${serverSeedHash}&clientSeed=abc&nonce=3&roll=${r}`), res);
  assert.equal(o.code, 200); assert.equal(j(o).verified, true);
  // tampered roll → false
  const c = cap();
  await handler(req(`/api/verify?serverSeed=${serverSeed}&serverSeedHash=${serverSeedHash}&clientSeed=abc&nonce=3&roll=${(r + 1) % 10000}`), c.res);
  assert.equal(j(c.o).verified, false);
});

test('the client verifier widget uses browser Web Crypto, not an external library', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.match(o.body, /crypto\.subtle/);                  // built-in Web Crypto for the recompute
  // no external JS library is imported for the verifier logic (the impact analytics beacon aside)
  assert.doesNotMatch(o.body, /unpkg|jsdelivr|cdnjs|require\(|from ['"]https?:\/\//i);
});

test('/health + robots + sitemap + llms', async () => {
  for (const [p, re] of [['/health', /"ok":true/], ['/robots.txt', /User-?agent/i], ['/sitemap.xml', /<urlset/], ['/sitemap-index.xml', /<sitemapindex/], ['/llms.txt', /Provably Fair/i]]) {
    const { res, o } = cap(); await handler(req(p), res); assert.equal(o.code, 200, p); assert.match(o.body, re, p);
  }
});

test('server does no request-time network', async () => {
  const realFetch = globalThis.fetch; globalThis.fetch = () => { throw new Error('network'); };
  try { const { res, o } = cap(); await handler(req('/'), res); assert.equal(o.code, 200); }
  finally { globalThis.fetch = realFetch; }
});

test('BASE_PATH: unprefixed by default, prefixed when set', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.match(o.body, /href="\/lotto"/);
  process.env.BASE_PATH = '/verify';
  const mod = await import('./verify.mjs?bp=1');
  const c = cap(); await mod.handler(req('/'), c.res);
  assert.match(c.o.body, /href="\/verify\/lotto"/);
  delete process.env.BASE_PATH;
});

test('unknown path → 404; garbage URL never throws', async () => {
  let { res, o } = cap(); await handler(req('/nope'), res); assert.equal(o.code, 404);
  ({ res, o } = cap()); await handler(req('/%%%bad%%'), res); assert.ok(o.code === 404 || o.code === 500 || o.code === 200);
});
