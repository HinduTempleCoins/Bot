/**
 * token-manage.test.mjs — offline tests for the "Manage my token" surface + the gated market reader.
 * Fully offline: engine reads go through an injected fetch; the KulaSwap market reader is env-gated OFF
 * (PRANA_RPC_URL unset) so it renders the honest placeholder. No network, no keys, never throws.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handler,
  homePage,
  managePage,
  buybackPage,
  fetchTokenFacts,
  __setFetch,
  esc,
  SITEMAP_PATHS,
} from './server.mjs';
import { marketPanel, isLive, __setFetch as setMarketFetch } from '../../integrations/kulaswap-market.mjs';

// ── a fake engine READ API (array-shaped, like the live /api/* endpoints) ──────────────────────────
function jsonRes(data) { return { ok: true, json: async () => data }; }

function fakeEngine(token, holders = [], tribes = []) {
  return async (u) => {
    const s = String(u);
    if (s.includes('/api/tokens')) return jsonRes(token ? [token] : []);
    if (s.includes('/api/holders')) return jsonRes(holders);
    if (s.includes('/api/tribes')) return jsonRes(tribes);
    return { ok: false, json: async () => ({}) };
  };
}

const TOKEN = {
  symbol: 'MYTOK', name: 'My Token', issuer: 'hathor', precision: 3,
  supply: '10000.000', circulatingSupply: '9000.000', maxSupply: '1000000.000', supplyCapImmutable: true, url: '',
};

function resetFetch() { __setFetch(null); setMarketFetch(null); }

// ── a minimal req/res harness ───────────────────────────────────────────────────────────────────
function run(pathAndQuery, method = 'GET') {
  return new Promise((resolve) => {
    const req = { url: pathAndQuery, method };
    let body = '';
    const res = {
      statusCode: 200, headers: {},
      writeHead(code, h) { this.statusCode = code; Object.assign(this.headers, h || {}); },
      end(chunk) { if (chunk) body += chunk; resolve({ status: this.statusCode, headers: this.headers, body }); },
    };
    handler(req, res);
  });
}

const BANNED = [/price floor/i, /guaranteed/i, /\bmoon\b/i, /number go up/i];
function assertNoBannedCopy(html, where) {
  for (const re of BANNED) assert.ok(!re.test(html), `${where}: must not contain ${re}`);
}

// ── 1. manage page renders all four issuer actions ─────────────────────────────────────────────────
test('managePage renders issue / burn / scot / buyback actions', async () => {
  __setFetch(fakeEngine(TOKEN));
  const html = await managePage('MYTOK');
  resetFetch();
  assert.match(html, /Issue more/);
  assert.match(html, /Burn/);
  assert.match(html, /SCOT rewards/);
  assert.match(html, /Buyback/);
  // each action carries a real op intent
  assert.match(html, /tokens\.issue/);
  assert.match(html, /tokens\.burn/);
  assert.match(html, /scot\.enable/);
  // buyback wizard link
  assert.match(html, /\/manage\/MYTOK\/buyback/);
});

// ── 2. token facts render from the engine read ─────────────────────────────────────────────────────
test('managePage shows supply facts + the immutable-cap badge', async () => {
  __setFetch(fakeEngine(TOKEN, [{ account: 'alice', balance: '500.000', stake: '0.000' }]));
  const html = await managePage('MYTOK');
  resetFetch();
  assert.match(html, /1000000\.000/);
  assert.match(html, /🔒/);
  assert.match(html, /@alice/);
});

// ── 3. buyback wizard: Route A steps + the burn intent, Route B gated ──────────────────────────────
test('buybackPage renders Route A steps + a burn intent, Route B gated', async () => {
  __setFetch(fakeEngine(TOKEN));
  const html = await buybackPage('MYTOK');
  resetFetch();
  assert.match(html, /Route A/);
  assert.match(html, /Step 1 — Acquire/);
  assert.match(html, /Step 2 — Burn/);
  assert.match(html, /tokens\.burn/);        // the real-today burn intent
  assert.match(html, /Route B/);
  assert.match(html, /available when PRANA is live/);
  // Route B bridge-out intent is shown (a tokens.transfer to custody)
  assert.match(html, /tokens\.transfer/);
});

// ── 4. compliance line present; NO price-floor / appreciation-promise copy ─────────────────────────
test('compliance line present and no forbidden promo copy (manage + buyback + home)', async () => {
  __setFetch(fakeEngine(TOKEN));
  const manage = await managePage('MYTOK');
  const buy = await buybackPage('MYTOK');
  resetFetch();
  const home = homePage();
  for (const [html, where] of [[manage, 'manage'], [buy, 'buyback'], [home, 'home']]) {
    assert.match(html, /token-management and deflation mechanic only/, `${where}: compliance line`);
    assert.match(html, /not investment, legal, or financial advice/i, `${where}: not-advice line`);
    assertNoBannedCopy(html, where);
  }
});

// ── 5. NO key material in any rendered intent ──────────────────────────────────────────────────────
test('no key material appears in any intent', async () => {
  __setFetch(fakeEngine(TOKEN));
  const manage = await managePage('MYTOK');
  const buy = await buybackPage('MYTOK');
  resetFetch();
  for (const html of [manage, buy]) {
    assert.ok(!/wif|posting_key|active_key|private_key|"key"|\bseed\b/i.test(html), 'no key material');
    // intents carry ACTIVE auth (required_auths), never a posting-only auth for these ops
    assert.match(html, /required_auths/);
  }
});

// ── 6. XSS: token name is escaped ──────────────────────────────────────────────────────────────────
test('managePage escapes a hostile token name', async () => {
  __setFetch(fakeEngine({ ...TOKEN, name: '<script>alert(1)</script>' }));
  const html = await managePage('MYTOK');
  resetFetch();
  assert.ok(!html.includes('<script>alert(1)'), 'raw script must not appear');
  assert.match(html, /&lt;script&gt;alert\(1\)/);
});

test('esc() escapes the five HTML metacharacters', () => {
  assert.equal(esc(`<a href="x" a='b'>&`), '&lt;a href=&quot;x&quot; a=&#39;b&#39;&gt;&amp;');
});

// ── 7. soft-fail: engine read returns nothing → page still renders, intents still assemble ─────────
test('managePage soft-fails when the engine read is empty', async () => {
  __setFetch(async () => ({ ok: false, json: async () => ({}) }));
  const html = await managePage('MYTOK');
  resetFetch();
  assert.match(html, /Live facts unavailable/);
  assert.match(html, /tokens\.burn/);        // intents still built (example account)
  assert.match(html, /replace it with your issuer account/);
});

test('fetchTokenFacts soft-fails to a shaped empty on fetch throw', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const facts = await fetchTokenFacts('MYTOK');
  resetFetch();
  assert.equal(facts.found, false);
  assert.equal(facts.token, null);
  assert.deepEqual(facts.holders, []);
});

// ── 8. invalid symbol handled gracefully ───────────────────────────────────────────────────────────
test('managePage rejects an invalid symbol without throwing', async () => {
  const html = await managePage('not a symbol!!');
  assert.match(html, /valid engine token symbol/);
});

// ── 9. routing: health, robots, sitemap, sitemap-index, llms, home ─────────────────────────────────
test('handler serves health / robots / sitemap / llms', async () => {
  const health = await run('/health');
  assert.equal(health.status, 200);
  assert.equal(health.body, 'ok');

  const robots = await run('/robots.txt');
  assert.equal(robots.status, 200);
  assert.match(robots.body, /Sitemap:/i);

  const sitemap = await run('/sitemap.xml');
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.body, /<urlset/);

  const idx = await run('/sitemap-index.xml');
  assert.equal(idx.status, 200);
  assert.match(idx.body, /<sitemapindex/);

  const llms = await run('/llms.txt');
  assert.equal(llms.status, 200);
  assert.match(llms.body, /Token Manage/);

  const home = await run('/');
  assert.equal(home.status, 200);
  assert.match(home.body, /Manage your MELEK-Engine token/);
  assert.ok(SITEMAP_PATHS.includes('/'));
});

test('handler routes /manage and /manage/:symbol/buyback (path + query forms)', async () => {
  __setFetch(fakeEngine(TOKEN));
  const q = await run('/manage?symbol=MYTOK');
  const p = await run('/manage/MYTOK');
  const b = await run('/manage/MYTOK/buyback');
  const bq = await run('/buyback?symbol=MYTOK');
  resetFetch();
  assert.equal(q.status, 200); assert.match(q.body, /MYTOK/);
  assert.equal(p.status, 200); assert.match(p.body, /Token facts/);
  assert.equal(b.status, 200); assert.match(b.body, /Route A/);
  assert.equal(bq.status, 200); assert.match(bq.body, /Buyback wizard/);
});

test('handler redirects an unknown path to home (never throws)', async () => {
  const r = await run('/nope/whatever');
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/');
});

// ── 10. the KulaSwap market reader is gated OFF until PRANA ─────────────────────────────────────────
test('marketPanel is gated (shaped-empty) when PRANA_RPC_URL is unset', async () => {
  const prev = process.env.PRANA_RPC_URL;
  delete process.env.PRANA_RPC_URL;
  const panel = await marketPanel('MYTOK');
  assert.equal(isLive(), false);
  assert.equal(panel.live, false);
  assert.equal(panel.wsymbol, 'wMYTOK');
  assert.equal(panel.price, null);
  assert.match(panel.link, /kula\.money/);
  if (prev !== undefined) process.env.PRANA_RPC_URL = prev;
});

test('marketPanel reads a live pair when PRANA + fetch are provided', async () => {
  setMarketFetch(async () => ({ ok: true, json: async () => ({ price: '1.25', liquidity: '5000', volume24h: '300' }) }));
  const panel = await marketPanel('MYTOK', { rpcUrl: 'https://prana.example/read' });
  setMarketFetch(null);
  assert.equal(panel.live, true);
  assert.equal(panel.price, '1.25');
  assert.equal(panel.liquidity, '5000');
});

test('the manage Market card renders gated when PRANA is off', async () => {
  const prev = process.env.PRANA_RPC_URL;
  delete process.env.PRANA_RPC_URL;
  __setFetch(fakeEngine(TOKEN));
  const html = await managePage('MYTOK');
  resetFetch();
  if (prev !== undefined) process.env.PRANA_RPC_URL = prev;
  assert.match(html, /Market \(KulaSwap · PRANA\)/);
  assert.match(html, /Available when PRANA is live/);
});
