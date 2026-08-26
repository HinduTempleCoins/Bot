// server.test.mjs — KULA Arcade hub. OFFLINE, never throws, server does zero request-time network.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, loadGames } from './server.mjs';

function cap() {
  const o = { code: 0, type: '', body: '' };
  return { res: { writeHead: (c, h) => { o.code = c; o.type = (h && h['content-type']) || ''; }, end: (b) => { o.body = b == null ? '' : b; } }, o };
}
const req = (path, headers = {}) => ({ url: path, method: 'GET', headers });
const j = (o) => JSON.parse(o.body);

// interactive affordances = link/button texts. None may be a money on/off-ramp.
function affordances(html) {
  const out = []; const re = /<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/gi; let m;
  while ((m = re.exec(html))) out.push(m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
  return out;
}
const BAD = /\b(buy|purchase|deposit|withdraw|cash\s*out|add funds|top ?up|sell|redeem for cash)\b/i;

export function assertCompliant(body) {
  assert.match(body, /Entertainment only/i);                 // the persistent disclaimer
  assert.match(body, /not available where prohibited/i);
  assert.match(body, /no cash value/i);
  assert.match(body, /non-cashable/i);
  assert.match(body, /18\+|18 or older/i);                   // age-gate
  assert.match(body, /alpha-badge/i);                        // alpha badge
  assert.match(body, /arcade-geo/i);                         // geofence scaffolding
  // NO money on/off-ramp affordance anywhere.
  for (const t of affordances(body)) assert.ok(!BAD.test(t), `affordance leaked money copy: "${t}"`);
  assert.doesNotMatch(body, /buy\s+play/i);
}

test('GET / serves the KULA Arcade hub tying together the §6 surfaces + Alpha badge', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.equal(o.code, 200); assert.match(o.type, /text\/html/);
  assert.match(o.body, /KULA<\/b> Arcade/);
  assert.match(o.body, /Daily Spin/);
  assert.match(o.body, /KULA Lotto/);
  assert.match(o.body, /Event Markets/);
  assert.match(o.body, /Provably Fair/i);
  assertCompliant(o.body);
});

test('the hub explains PLAY is non-cashable and the free spin is the AMOE', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.match(o.body, /AMOE/);
  assert.match(o.body, /PLAY is non-cashable/i);
  assert.match(o.body, /Hathor is an educator only/i);
});

test('/api/games lists the registry (all PLAY token)', async () => {
  const { res, o } = cap(); await handler(req('/api/games'), res);
  assert.equal(o.code, 200);
  const ids = j(o).games.map((g) => g.id);
  assert.ok(ids.includes('seed-raffle') && ids.includes('kush-farm'));
  assert.ok(j(o).games.every((g) => g.token === 'PLAY'));
});

test('/api/board returns a season + graceful empty top without a reader; 404 for non-board', async () => {
  const b = loadGames().find((g) => g.gameId);
  let { res, o } = cap(); await handler(req('/api/board?game=' + b.id), res);
  assert.equal(o.code, 200); assert.equal(j(o).ok, true); assert.equal(typeof j(o).season, 'number'); assert.deepEqual(j(o).top, []);
  ({ res, o } = cap()); await handler(req('/api/board?game=seed-raffle'), res);
  assert.equal(o.code, 404);
});

test('/health + robots + sitemap + llms', async () => {
  for (const [p, re] of [['/health', /"ok":true/], ['/robots.txt', /User-?agent/i], ['/sitemap.xml', /<urlset/], ['/sitemap-index.xml', /<sitemapindex/], ['/llms.txt', /KULA Arcade/]]) {
    const { res, o } = cap(); await handler(req(p), res);
    assert.equal(o.code, 200, p); assert.match(o.body, re, p);
  }
});

test('hostile <script> in an injected game name is escaped', async () => {
  const prev = process.env.MELEK_ARCADE_GAMES_JSON;
  process.env.MELEK_ARCADE_GAMES_JSON = JSON.stringify([{ id: 'x', name: '<script>alert(1)</script>', kind: 'coming', token: 'PLAY', blurb: '<img src=x onerror=alert(1)>' }]);
  const { res, o } = cap(); await handler(req('/'), res);
  assert.doesNotMatch(o.body, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(o.body, /<img src=x onerror/);
  assert.match(o.body, /&lt;script&gt;/);
  if (prev == null) delete process.env.MELEK_ARCADE_GAMES_JSON; else process.env.MELEK_ARCADE_GAMES_JSON = prev;
});

test('server does NO request-time network (page still 200s with fetch disabled)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network called'); };
  try { const { res, o } = cap(); await handler(req('/'), res); assert.equal(o.code, 200); }
  finally { globalThis.fetch = realFetch; }
});

test('BASE_PATH: unprefixed by default, prefixed when set (fresh import)', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.match(o.body, /href="\/lotto"/);
  process.env.BASE_PATH = '/arcade';
  const mod = await import('./server.mjs?bp=1');
  const c = cap(); await mod.handler(req('/'), c.res);
  assert.match(c.o.body, /href="\/arcade\/lotto"/);
  delete process.env.BASE_PATH;
});

test('unknown path → 404; garbage URL never throws', async () => {
  let { res, o } = cap(); await handler(req('/nope'), res); assert.equal(o.code, 404);
  ({ res, o } = cap()); await handler(req('/%%%bad%%'), res); assert.ok(o.code === 404 || o.code === 500 || o.code === 200);
});
