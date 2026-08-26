// markets.test.mjs — KULA Event Markets surface. OFFLINE, never throws, no request-time network.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, marketMath, MARKETS } from './markets.mjs';

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

test('marketMath derives implied probabilities + overround via gambling.mjs helpers', () => {
  const mm = marketMath({ yes: 60, no: 44 });
  assert.equal(mm.impYesPct, '60'); assert.equal(mm.impNoPct, '44');
  assert.ok(parseFloat(mm.marginPct) > 0);                 // 60%+44% = overround
  assert.equal(String(Math.round(parseFloat(mm.fairYesPct) + parseFloat(mm.fairNoPct))), '100'); // de-vigged ≈ 100
});

test('GET / renders binary Yes/No markets, implied-probability education, named sources, compliant', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.equal(o.code, 200); assert.match(o.type, /text\/html/);
  assert.match(o.body, /Event Markets/);
  assert.match(o.body, /implied/i);                        // price ≈ implied probability
  assert.match(o.body, /Overround|margin/i);
  assert.match(o.body, /dispute/i);                        // dispute window
  assert.match(o.body, /Resolves from/i);                  // named reference source
  assert.match(o.body, /Hathor/);                          // educator framing
  assert.match(o.body, /Stake PLAY/i);                     // stake affordance, not "buy"
  assertCompliant(o.body);
});

test('Hathor is framed as educator only, not a line-setter', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.match(o.body, /education, not advice/i);
  assert.match(o.body, /never sets a line/i);
});

test('/api/markets returns PLAY, non-cashable, with the math', async () => {
  const { res, o } = cap(); await handler(req('/api/markets'), res);
  assert.equal(o.code, 200);
  assert.equal(j(o).cashable, false); assert.equal(j(o).currency, 'PLAY');
  assert.equal(j(o).markets.length, MARKETS.length);
  assert.ok(j(o).markets[0].math.impYesPct);
});

test('/health + robots + sitemap + llms', async () => {
  for (const [p, re] of [['/health', /"ok":true/], ['/robots.txt', /User-?agent/i], ['/sitemap.xml', /<urlset/], ['/sitemap-index.xml', /<sitemapindex/], ['/llms.txt', /Event Markets/]]) {
    const { res, o } = cap(); await handler(req(p), res); assert.equal(o.code, 200, p); assert.match(o.body, re, p);
  }
});

test('hostile market copy is escaped + server does no request-time network', async () => {
  const realFetch = globalThis.fetch; globalThis.fetch = () => { throw new Error('network'); };
  try { const { res, o } = cap(); await handler(req('/'), res); assert.equal(o.code, 200); assert.doesNotMatch(o.body, /<script>alert/); }
  finally { globalThis.fetch = realFetch; }
});

test('BASE_PATH: unprefixed by default, prefixed when set', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.match(o.body, /href="\/verify"/);
  process.env.BASE_PATH = '/markets';
  const mod = await import('./markets.mjs?bp=1');
  const c = cap(); await mod.handler(req('/'), c.res);
  assert.match(c.o.body, /href="\/markets\/verify"/);
  delete process.env.BASE_PATH;
});

test('unknown path → 404; garbage URL never throws', async () => {
  let { res, o } = cap(); await handler(req('/nope'), res); assert.equal(o.code, 404);
  ({ res, o } = cap()); await handler(req('/%%%bad%%'), res); assert.ok(o.code === 404 || o.code === 500 || o.code === 200);
});
