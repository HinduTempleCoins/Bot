// pets.test.mjs — OFFLINE tests for Critter Keep (drives `handler` with a mock req/res; no port bound,
// no network). Mirrors the assertion style of site/idlegames/idlegames.test.mjs. Verifies: the home page
// 200s with the adopt + daily-care UI; the four care actions are present; the shop renders; the minigame
// faucets link to the Idle-Time Games app; /health is ok JSON; robots/sitemap/sitemap-index/llms serve;
// a hostile <script> echoed into the 404 path is escaped; the up-front copy carries NO crypto pitch (the
// tool copy precedes the first "MELEK"); the opt-in is understated and about SAVING the pet; the handler
// does no request-time network (a throwing global fetch does not break a render, and the source has no
// fetch/http-client call); BASE_PATH defaults unchanged and prefixes self-URLs when set; unknown path is
// a 404 (never a 500); and the handler never throws on garbage.

import { test } from 'node:test';
import assert from 'node:assert';
import { handler, esc, safeHref, POOL, SHOP, FAUCETS, SITEMAP_PATHS } from './server.mjs';

function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}, h = handler) {
  const res = mockRes();
  await h({ url: path, headers: { host: 'pets.test', ...headers } }, res);
  return res;
}

test('home 200 renders the adopt + care UI', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /Adopt a critter/i);        // the tool intro
  assert.match(res.body, /id=adopt/);                 // the adoption picker section
  assert.match(res.body, /Choose your critter/i);
  assert.match(res.body, /id=home/);                  // the pet-home / care section
});

test('all four daily-care actions are present (feed/play/groom/rest)', async () => {
  const body = (await get('/')).body;
  for (const care of ['feed', 'play', 'groom', 'rest']) {
    assert.ok(body.includes(`data-care=${care}`), `missing care action ${care}`);
  }
});

test('the shop renders with buyable items priced in Kibble', async () => {
  const body = (await get('/')).body;
  assert.match(body, /Critter Shop/i);
  assert.match(body, /id=shopgrid/);
  // the shop catalog is serialized into the page for the client
  assert.match(body, /id=shopdata/);
  assert.ok(SHOP.length >= 5, 'shop should carry several items');
  // at least one original pet item name appears in the serialized catalog
  assert.ok(/Kibble Scoop/.test(body), 'expected an original pet-food item in the shop data');
});

test('the minigame faucets link out to the Idle-Time Games app', async () => {
  const body = (await get('/')).body;
  assert.match(body, /Earn Kibble/i);
  // each faucet links to the external idlegames host at its own slug
  for (const f of FAUCETS) {
    assert.ok(body.includes(`idlegames.soapbox.community/${f.slug}`), `missing faucet link for ${f.slug}`);
    assert.ok(body.includes(esc(f.name)), `missing faucet name ${f.name}`);
  }
});

test('the adoption POOL is built server-side from creatures.mjs (original creatures, rarity tiers)', () => {
  assert.ok(POOL.length >= 4, 'expected several adoptable creatures');
  const names = new Set(POOL.map((c) => c.name));
  // original MELEK species from creatures.mjs — never a franchise creature
  assert.ok(names.has('Pyrelisk') || names.has('Mossquill') || names.has('Tidewren') || names.has('Cinderox'));
  for (const c of POOL) {
    assert.ok(c.hue && c.hide && c.aura && c.size, 'each creature carries expressed traits');
    assert.ok(typeof c.rarity === 'string' && c.rarity.length, 'each creature has a rarity tier');
  }
});

test('the pool + shop are embedded as safe JSON (no raw </script> break-out)', async () => {
  const body = (await get('/')).body;
  assert.match(body, /id=pooldata type=application\/json/);
  // the embedded JSON must not contain a raw "<" that could open a tag inside the script element
  const m = body.match(/<script id=pooldata[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(m, 'pool data script present');
  assert.ok(!/</.test(m[1]), 'embedded pool JSON must have every "<" neutralised');
});

test('NO up-front crypto pitch — the tool copy precedes the first "MELEK"', async () => {
  const body = (await get('/')).body;
  const introAt = body.indexOf('Adopt a critter');
  const melekAt = body.indexOf('MELEK');
  assert.ok(introAt >= 0, 'intro copy must be present');
  assert.ok(melekAt === -1 || introAt < melekAt, 'the pet/tool copy must come before any MELEK mention');
  // none of the crypto/earn/account words appear before the intro copy (the opening is pure play)
  const opening = body.slice(0, introAt);
  assert.ok(!/\b(crypto|token|blockchain|wallet|MELEK)\b/i.test(opening), 'the opening must carry no crypto pitch');
});

test('the MELEK opt-in is understated + about SAVING the pet (loss-aversion, not a wallet pitch)', async () => {
  const body = (await get('/')).body;
  assert.match(body, /Save &amp; trade your pet/i);         // the small affordance
  assert.match(body, /free MELEK account/i);                // named only inside the panel
  assert.match(body, /becomes truly yours to keep/i);       // loss-aversion / save framing
  // it starts hidden (revealed by JS only once the pet has leveled up) and is not a token sale
  assert.match(body, /id=optinwrap class="optin hidden"/);
  assert.ok(!/\b(ICO|presale|buy the token|token sale)\b/i.test(body), 'no token-sale language anywhere');
});

test('/health returns {"ok":true}', async () => {
  const res = await get('/health');
  assert.equal(res.code, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});

test('robots.txt, sitemap.xml, sitemap-index.xml, llms.txt all serve', async () => {
  const robots = await get('/robots.txt');
  assert.equal(robots.code, 200);
  assert.match(robots.body, /User-agent/);
  const sm = await get('/sitemap.xml');
  assert.equal(sm.code, 200);
  assert.match(sm.body, /<urlset|<url>/);
  const smi = await get('/sitemap-index.xml');
  assert.equal(smi.code, 200);
  assert.match(smi.body, /sitemapindex/);
  const llms = await get('/llms.txt');
  assert.equal(llms.code, 200);
  assert.match(llms.body, /critter|pet|Kibble/i);
});

test('SITEMAP_PATHS covers the home page', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
});

test('a hostile <script> echoed into the 404 path is escaped (no raw payload)', async () => {
  const res = await get('/' + encodeURIComponent('<script>alert(1)</script>'));
  assert.equal(res.code, 404);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'raw hostile payload must not appear');
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);   // it is escaped instead
});

test('esc() and safeHref() are sound', () => {
  assert.equal(esc('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('data:text/html,x'), '');
  assert.equal(safeHref('https://ok.example/x'), 'https://ok.example/x');
  assert.equal(safeHref(''), '');
});

test('unknown path → 404, never a 500', async () => {
  const res = await get('/does/not/exist');
  assert.equal(res.code, 404);
  assert.match(res.body, /Not found/i);
});

test('never throws on a garbage URL', async () => {
  const res = mockRes();
  await handler({ url: '/%%%bad%%', headers: { host: 'pets.test' } }, res);
  assert.ok(res.code === 404 || res.code === 500 || res.code === 200);
});

test('the handler does NO request-time network — a throwing global fetch does not break a render', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network called at request time'); };
  try {
    const res = await get('/');
    assert.equal(res.code, 200, 'home still renders with a throwing fetch injected');
    assert.match(res.body, /Adopt a critter/i);
  } finally {
    globalThis.fetch = orig;
  }
});

test('the server source has no request-time fetch/http-client call', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.ok(!/\bfetch\s*\(/.test(src), 'server must not call fetch at request time');
  assert.ok(!/https?\.(get|request)\s*\(/.test(src), 'server must not open an outbound http request');
});

test('BASE_PATH defaults to unchanged self-URLs', async () => {
  const body = (await get('/')).body;
  // the brand link is a self-URL; with no BASE_PATH it is bare "/"
  assert.match(body, /class=brand href="\/"/);
});

test('BASE_PATH, when set, prefixes emitted self-URLs (mount under the Tools hub)', async () => {
  const prev = process.env.BASE_PATH;
  process.env.BASE_PATH = '/pets';
  try {
    // fresh module instance re-reads the env (query suffix defeats the ESM cache)
    const mod = await import('./server.mjs?basepath=1');
    const res = await get('/', {}, mod.handler);
    assert.equal(res.code, 200);
    assert.match(res.body, /class=brand href="\/pets\/"/);   // self-URL now prefixed
  } finally {
    if (prev === undefined) delete process.env.BASE_PATH; else process.env.BASE_PATH = prev;
  }
});
