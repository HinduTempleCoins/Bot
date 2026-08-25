// site/shop/shop.test.mjs — offline tests for the Seed Shop storefront. node --test, no network.
// Everything reads the REAL farm-items catalog; the buy action must build a signable intent that
// carries NO key and is never auto-broadcast.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handler, esc, homePage, categoryPage, itemPage,
  buildBuyIntent, findItem, priceFor, boostLine, normalizeCategory,
  SHOP_CURRENCY, SHOP_ACCOUNT, CATEGORIES, SITEMAP_PATHS,
} from './server.mjs';
import { shopCatalog, byCategory } from '../../integrations/games/farm-items.mjs';

// minimal mock res that captures a single writeHead + end.
function mockRes() {
  return {
    code: 0, headers: {}, body: '', ended: false,
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(chunk) { if (chunk != null) this.body += chunk; this.ended = true; return this; },
  };
}
async function req(path) { const res = mockRes(); await handler({ url: path, method: 'GET' }, res); return res; }

// ── 1. home lists every category + items from the real catalog ───────────────────────────────────────
test('home lists all categories and items from farm-items', async () => {
  const res = await req('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  for (const c of CATEGORIES) assert.ok(res.body.includes(esc(c.label)), `missing category ${c.label}`);
  // a known seed, a known tool, a known consumable all appear by name
  assert.ok(res.body.includes('Watering Can'));
  assert.ok(res.body.includes('Compost'));
  const anySeed = byCategory().seed[0];
  assert.ok(anySeed && res.body.includes(esc(anySeed.name)), 'a seed should render on home');
});

// ── 2. home renders currency + every catalog symbol ──────────────────────────────────────────────────
test('home shows the in-game currency and does not price in fiat', async () => {
  const res = await req('/');
  assert.ok(res.body.includes(SHOP_CURRENCY));
  assert.ok(!/\$\d/.test(res.body), 'no fiat dollar prices');
  // every item symbol from the real catalog is present somewhere
  for (const it of shopCatalog()) assert.ok(res.body.includes(esc(it.symbol)), `symbol ${it.symbol} missing`);
});

// ── 3. item page renders stats/boosts/price ──────────────────────────────────────────────────────────
test('item page renders stats, boost and price for a tool', async () => {
  const res = await req('/item/golden-hoe');
  assert.equal(res.code, 200);
  assert.ok(res.body.includes('Golden Hoe'));
  assert.ok(res.body.includes('GOLDHOE'));
  assert.ok(res.body.includes('harvest yield'), 'boost line rendered');
  assert.ok(res.body.includes('8000'), 'catalog price rendered');
  assert.ok(res.body.includes(SHOP_CURRENCY));
});

test('item page renders seed grow stats', async () => {
  const seed = byCategory().seed[0];
  const res = await req('/item/' + seed.id);
  assert.equal(res.code, 200);
  assert.ok(res.body.includes(esc(seed.name)));
  assert.ok(res.body.includes('Rarity'));
});

// ── 4. category filter ───────────────────────────────────────────────────────────────────────────────
test('category page filters to that category only', async () => {
  const res = await req('/c/tools');
  assert.equal(res.code, 200);
  assert.ok(res.body.includes('Watering Can'));
  assert.ok(res.body.includes('Golden Hoe'));
  // a seed symbol should NOT appear on the tools page
  const seed = byCategory().seed[0];
  assert.ok(!res.body.includes('/item/' + seed.id), 'seed leaked into tools category');
});

test('category aliases normalize', () => {
  assert.equal(normalizeCategory('seeds'), 'seed');
  assert.equal(normalizeCategory('boosts'), 'consumable');
  assert.equal(normalizeCategory('compost'), 'consumable');
  assert.equal(normalizeCategory('nope'), null);
});

// ── 5. buy action builds a signable intent, no keys, no auto-broadcast ───────────────────────────────
test('buy intent is a signable shop.buy op with the buyer as required_auths and NO key', async () => {
  const res = await req('/api/buy?id=watering-can&qty=2&account=alice');
  assert.equal(res.code, 200);
  const d = JSON.parse(res.body);
  assert.equal(d.ok, true);
  assert.equal(d.item.symbol, 'WATERCAN');
  assert.equal(d.quantity, '2');
  assert.equal(d.currency, SHOP_CURRENCY);
  assert.equal(d.total, String(50 * 2));
  // the op is a custom_json the BUYER signs — buyer in required_auths, and the vendor is the shop
  const [opName, opBody] = d.op;
  assert.equal(opName, 'custom_json');
  assert.deepEqual(opBody.required_auths, ['alice']);
  assert.deepEqual(opBody.required_posting_auths, []);
  const env = JSON.parse(opBody.json);
  assert.equal(env.contractName, 'shop');
  assert.equal(env.contractAction, 'buy');
  assert.equal(env.contractPayload.vendor, SHOP_ACCOUNT);
  // absolutely no key material anywhere in the response
  assert.ok(!/wif|private|posting_key|active_key|5[HJK][1-9A-HJ-NP-Za-km-z]{40,}/i.test(res.body), 'no key material in intent');
  assert.equal(d.signWith, 'active');
});

test('buy intent without an account is still signable (account filled at sign time)', () => {
  const d = buildBuyIntent({ id: 'compost', qty: 3 });
  assert.equal(d.ok, true);
  assert.equal(d.needsAccount, true);
  assert.deepEqual(d.op[1].required_auths, []);
  assert.equal(d.total, String(5 * 3));
});

test('buy intent rejects a bad quantity and an unknown item', () => {
  assert.equal(buildBuyIntent({ id: 'compost', qty: 0 }).ok, false);
  assert.equal(buildBuyIntent({ id: 'compost', qty: 'abc' }).ok, false);
  assert.equal(buildBuyIntent({ id: 'no-such-item' }).ok, false);
});

// ── 6. unknown item → soft 404 / redirect (never a throw) ────────────────────────────────────────────
test('unknown item redirects home (soft 404)', async () => {
  const res = await req('/item/does-not-exist');
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, '/');
});

test('unknown category redirects home', async () => {
  const res = await req('/c/widgets');
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, '/');
});

test('api/buy for unknown item returns ok:false with 404', async () => {
  const res = await req('/api/buy?id=ghost');
  assert.equal(res.code, 404);
  assert.equal(JSON.parse(res.body).ok, false);
});

// ── 7. robots / sitemap / llms ───────────────────────────────────────────────────────────────────────
test('robots.txt, sitemap.xml, sitemap-index.xml and llms.txt render', async () => {
  const robots = await req('/robots.txt');
  assert.equal(robots.code, 200);
  assert.ok(robots.body.includes('Sitemap:'));

  const sm = await req('/sitemap.xml');
  assert.equal(sm.code, 200);
  assert.ok(sm.body.includes('<urlset'));
  assert.ok(sm.body.includes('/item/'), 'item URLs in the sitemap');

  const idx = await req('/sitemap-index.xml');
  assert.equal(idx.code, 200);
  assert.ok(idx.body.includes('<sitemapindex'));

  const llms = await req('/llms.txt');
  assert.equal(llms.code, 200);
  assert.ok(llms.body.includes(SHOP_CURRENCY));
});

test('sitemap paths cover home, categories and every item', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
  for (const c of CATEGORIES) assert.ok(SITEMAP_PATHS.includes('/c/' + c.slug));
  assert.equal(SITEMAP_PATHS.filter((p) => p.startsWith('/item/')).length, shopCatalog().length);
});

test('health reports item count and currency', async () => {
  const res = await req('/health');
  assert.equal(res.code, 200);
  const d = JSON.parse(res.body);
  assert.equal(d.ok, true);
  assert.equal(d.items, shopCatalog().length);
  assert.equal(d.currency, SHOP_CURRENCY);
});

// ── 8. XSS escaping ──────────────────────────────────────────────────────────────────────────────────
test('esc escapes HTML-significant characters', () => {
  assert.equal(esc(`<script>"'&`), '&lt;script&gt;&quot;&#39;&amp;');
});

test('malicious query params never break out of the page markup', async () => {
  // an id with markup must not render an unescaped <script> — it redirects home (unknown item) or escapes
  const res = await req('/item/' + encodeURIComponent('<script>alert(1)</script>'));
  // unknown → redirect; either way no raw injected script tag in any HTML body
  assert.ok(res.code === 302 || !res.body.includes('<script>alert(1)</script>'));
  // api/buy echoes id into an error string as JSON (escaped by JSON), never as HTML
  const api = await req('/api/buy?id=' + encodeURIComponent('<b>x</b>'));
  assert.equal(api.code, 404);
  assert.ok(!/<b>x<\/b>/.test(api.body) || api.headers['content-type'].includes('application/json'));
});

// ── 9. helpers: pricing derivation + boost line ──────────────────────────────────────────────────────
test('priceFor uses the catalog price, deriving only when missing', () => {
  const hoe = findItem('golden-hoe');
  assert.equal(priceFor(hoe), '8000'); // real catalog price
  // synthetic entry with no price → deterministic rarity-floor + boost fallback
  const derived = priceFor({ category: 'tool', rarity: 'rare', boost: { effect: 'yield', bps: 2000 } });
  assert.ok(Number(derived) > 0);
  assert.equal(priceFor({ category: 'tool', rarity: 'rare', boost: { effect: 'yield', bps: 2000 } }), derived); // deterministic
});

test('boostLine formats bps into a percentage', () => {
  assert.equal(boostLine({ effect: 'yield', bps: 2500 }), '+25% harvest yield');
  assert.equal(boostLine({ effect: 'growthSpeed', bps: 1000 }), '+10% grow speed');
  assert.equal(boostLine({ effect: 'seasonExtend', bps: 0 }), 'Enables out-of-season growing');
  assert.equal(boostLine(null), '');
});

test('findItem resolves by id and by symbol (case-insensitive)', () => {
  assert.equal(findItem('watering-can').symbol, 'WATERCAN');
  assert.equal(findItem('WATERCAN').id, 'watering-can');
  assert.equal(findItem('watercan').id, 'watering-can');
  assert.equal(findItem('nope'), null);
});

// ── 10. never throws on garbage input ────────────────────────────────────────────────────────────────
test('handler never throws on odd paths', async () => {
  for (const p of ['', '/', '//', '/item/', '/c/', '/api/buy', '/%', '/item?id=', '/random/deep/path']) {
    const res = await req(p);
    assert.ok(res.ended, `did not end for ${p}`);
    assert.ok(res.code >= 200 && res.code < 600);
  }
});

// ── 11. pages render standalone (importable, no port bind) ───────────────────────────────────────────
test('homePage / categoryPage / itemPage return HTML or null cleanly', () => {
  assert.match(homePage(), /<!doctype html>/i);
  assert.match(categoryPage('seed'), /Seeds/);
  assert.equal(categoryPage('bogus'), null);
  assert.match(itemPage('compost'), /Compost/);
  assert.equal(itemPage('bogus'), null);
});
