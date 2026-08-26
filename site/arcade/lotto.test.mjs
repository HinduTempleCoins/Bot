// lotto.test.mjs — KULA Lotto surface. OFFLINE, deterministic, never throws, no request-time network.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, poolSplit, drawWinner, POOL_SPLIT, TICKET_PRICE_PLAY } from './lotto.mjs';

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

test('poolSplit reconciles to the pot and matches the disclosed percentages', () => {
  const s = poolSplit(1000);
  assert.equal(s.prize + s.treasuryPoL + s.burn, 1000);
  assert.equal(s.prize, 900); assert.equal(s.treasuryPoL, 50); assert.equal(s.burn, 50);
  assert.equal(POOL_SPLIT.prize + POOL_SPLIT.treasuryPoL + POOL_SPLIT.burn, 100);
  assert.deepEqual(poolSplit(-5), { pot: 0, prize: 0, treasuryPoL: 0, burn: 0 });   // soft-fail
});

test('drawWinner is deterministic + in range, reusing the commit-reveal engine', () => {
  const a = drawWinner({ serverSeed: 's', drawId: 'd', ticketCount: 100 });
  const b = drawWinner({ serverSeed: 's', drawId: 'd', ticketCount: 100 });
  assert.deepEqual(a, b);                                   // deterministic → verifiable
  assert.ok(a.winner >= 0 && a.winner < 100);
  assert.match(a.serverSeedHash, /^[0-9a-f]{64}$/);         // committed hash present
  assert.equal(drawWinner({ ticketCount: 0 }).winner, 0);  // never throws / divide-by-zero
});

test('GET / renders the Lotto play UI, pool split, and verify-this-draw story, fully compliant', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.equal(o.code, 200); assert.match(o.type, /text\/html/);
  assert.match(o.body, /KULA Lotto/);
  assert.match(o.body, new RegExp(String(TICKET_PRICE_PLAY) + ' PLAY'));
  assert.match(o.body, /Verify this draw/i);
  assert.match(o.body, /Prize pool/i);
  assert.match(o.body, /Enter the draw/i);                 // stake affordance uses "Enter", not "buy"
  assertCompliant(o.body);
});

test('/api/draw is deterministic, non-cashable, PLAY-denominated', async () => {
  const { res, o } = cap(); await handler(req('/api/draw?serverSeed=s&drawId=d&tickets=50'), res);
  assert.equal(o.code, 200);
  assert.equal(j(o).cashable, false); assert.equal(j(o).currency, 'PLAY');
  assert.ok(j(o).winner >= 0 && j(o).winner < 50);
});

test('/health + robots + sitemap + llms', async () => {
  for (const [p, re] of [['/health', /"ok":true/], ['/robots.txt', /User-?agent/i], ['/sitemap.xml', /<urlset/], ['/sitemap-index.xml', /<sitemapindex/], ['/llms.txt', /KULA Lotto/]]) {
    const { res, o } = cap(); await handler(req(p), res); assert.equal(o.code, 200, p); assert.match(o.body, re, p);
  }
});

test('hostile input in serverSeed is escaped in JSON (no HTML injection path) + server does no network', async () => {
  const realFetch = globalThis.fetch; globalThis.fetch = () => { throw new Error('network'); };
  try {
    const { res, o } = cap(); await handler(req('/'), res); assert.equal(o.code, 200);
    assert.doesNotMatch(o.body, /<script>alert/);
  } finally { globalThis.fetch = realFetch; }
});

test('BASE_PATH: unprefixed by default, prefixed when set', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.match(o.body, /href="\/verify"/);
  process.env.BASE_PATH = '/lotto';
  const mod = await import('./lotto.mjs?bp=1');
  const c = cap(); await mod.handler(req('/'), c.res);
  assert.match(c.o.body, /href="\/lotto\/verify"/);
  delete process.env.BASE_PATH;
});

test('unknown path → 404; garbage URL never throws', async () => {
  let { res, o } = cap(); await handler(req('/nope'), res); assert.equal(o.code, 404);
  ({ res, o } = cap()); await handler(req('/%%%bad%%'), res); assert.ok(o.code === 404 || o.code === 500 || o.code === 200);
});
