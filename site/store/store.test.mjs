// store.test.mjs — OFFLINE tests for Store.SoapBox.Community (drives `handler` with a mock req/res;
// no port bound, no network). The store POPULATES from Impact via integrations/impact-api.mjs, so we
// inject that module's fetch seam (impact.__setFetch) with canned campaigns/catalogs/items/deals and
// toggle the IMPACT_ACCOUNT_SID/IMPACT_AUTH_TOKEN env so configured() flips. Verifies: real products
// render when Impact is connected; the honest "offers load once Impact is connected" note + curated
// fallback when it is NOT; affiliate-wrapped + rel=sponsored outbound links (and real tagging when the
// publisher id is set); the Impact UTT in <head>; robots/sitemap/sitemap-index/llms; /c/:category
// switching; /deals promo codes; XSS-escaping; unknown route soft-handling; and never-throws-on-garbage.

import { test } from 'node:test';
import assert from 'node:assert';

import { handler, storePage, dealsPage, esc, SITEMAP_PATHS, catMeta, STORE_CATEGORY } from './server.mjs';
import * as impact from '../../integrations/impact-api.mjs';

// --- canned Impact payloads (nothing fabricated by the store; it only renders what Impact returns) ---
const CANNED = {
  campaigns: [{ CampaignId: 'c1', CampaignName: 'Acme General', Category: 'general', TrackingLink: 'https://acme.example/t' }],
  catalogs: [{ Id: 'cat1', Name: 'Main catalog', AdvertiserName: 'Acme', NumberOfItems: 2 }],
  items: [
    { Id: 'p1', Name: 'Widget XL', CurrentPrice: 19.99, Currency: 'USD', Url: 'https://acme.example/widget', ImageUrl: 'https://img.example/w.png', CampaignName: 'Acme' },
    { Id: 'p2', Name: 'Gadget Pro', CurrentPrice: 49.5, Currency: 'USD', Url: 'https://acme.example/gadget', ImageUrl: '', CampaignName: 'Acme' },
  ],
  deals: [
    { Id: 'd1', CampaignName: 'Acme', Name: '20% off everything', CouponCode: 'SAVE20', Discount: '20%', LandingPageUrl: 'https://acme.example/deal', EndDate: '2026-12-31' },
  ],
};

// A canned-fetch factory keyed on the Impact REST path. Returns a fetch-shaped { ok, json() }.
function fetchWith(data = CANNED) {
  return function fakeFetch(url) {
    const u = String(url);
    let body = {};
    if (u.includes('/Deals')) body = { Deals: data.deals || [] };
    else if (/\/Catalogs\/[^/]+\/Items/.test(u)) body = { Items: data.items || [] };
    else if (u.includes('/Catalogs')) body = { Catalogs: data.catalogs || [] };
    else if (u.includes('/Campaigns')) body = { Campaigns: data.campaigns || [] };
    return Promise.resolve({ ok: true, json: async () => body });
  };
}

// Connect Impact: set BOTH server-side credentials (so impact.configured() is true) + inject fetch.
function configure(data) {
  process.env.IMPACT_ACCOUNT_SID = 'SID123';
  process.env.IMPACT_AUTH_TOKEN = 'TOK456';
  impact.__setFetch(fetchWith(data));
}
// Disconnect Impact: clear the credentials + reset the fetch seam back to the real (unused) default.
function unconfigure() {
  delete process.env.IMPACT_ACCOUNT_SID;
  delete process.env.IMPACT_AUTH_TOKEN;
  delete process.env.IMPACT_PARTNER_ID;
  delete process.env.AFFIL_IMPACT_ID;
  impact.__setFetch(null);
}

// --- mock res/req harness (mirrors site/insurance/insurance-site.test.mjs) ---
function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'store.test', ...headers } }, res);
  return res;
}

// ── unconfigured (pre-go-live) ──────────────────────────────────────────────

test('home 200: category strip, FTC disclosure, and — unconfigured — the honest connect note + curated fallback', async () => {
  unconfigure();
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /Shop by category/);              // category strip
  assert.match(res.body, /ftc-disclosure/);                // FTC disclosure block
  // honest "offers load once Impact is connected" note, no fabricated product
  assert.match(res.body, /Live offers load once Impact is connected/i);
  assert.ok(!res.body.includes('class=products'), 'must not render a product grid with no Impact data');
});

test('unconfigured store renders the curated comparison directory as the fallback (no fake products)', async () => {
  unconfigure();
  const html = await storePage('general');
  assert.match(html, /Compare honestly while offers connect/);
  // curated directory pulls real aggregator doorways, never invented products/prices
  assert.match(html, /class=grid|class="grid"/);
});

// ── configured (Impact connected) ───────────────────────────────────────────

test('configured: real Impact catalog PRODUCTS render with name, price, and merchant', async () => {
  configure();
  const html = await storePage('general');
  assert.match(html, /Featured products/);
  assert.match(html, /Widget XL/);
  assert.match(html, /Gadget Pro/);
  assert.match(html, /USD 19\.99/);      // price from CurrentPrice, formatted
  assert.match(html, /USD 49\.50/);
  assert.match(html, /Acme/);            // merchant/advertiser
  assert.ok(!/Live offers load once Impact is connected/i.test(html), 'honest note must vanish once products exist');
  unconfigure();
});

test('configured: approved campaigns render as merchant-partner doorways', async () => {
  configure();
  const html = await storePage('general');
  assert.match(html, /Merchant partners/);
  assert.match(html, /Acme General/);
  unconfigure();
});

test('outbound product links are affiliate-wrapped (rel=sponsored, new tab) and carry the real tag when the publisher id is set', async () => {
  process.env.IMPACT_PARTNER_ID = '99887';   // publisher id present → affiliate.trackedLink tags the URL
  configure();
  const html = await storePage('general');
  assert.match(html, /rel="sponsored nofollow noopener"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /irpid=99887/);          // Impact tag actually applied to the outbound URL
  unconfigure();
});

test('/deals renders live promo codes (code, discount, advertiser) when Impact is connected', async () => {
  configure();
  const res = await get('/deals');
  assert.equal(res.code, 200);
  assert.match(res.body, /SAVE20/);
  assert.match(res.body, /20% off everything/);
  assert.match(res.body, /class=code|class="code"/);
  unconfigure();
});

test('/deals unconfigured → honest note, never an invented promo code', async () => {
  unconfigure();
  const res = await get('/deals');
  assert.equal(res.code, 200);
  assert.match(res.body, /Live offers load once Impact is connected/i);
  assert.ok(!res.body.includes('SAVE20'), 'no fabricated codes when Impact is not connected');
});

// ── the Impact UTT (client-side tracking) is present in <head> ──────────────

test('every page carries the Impact UTT in <head>', async () => {
  unconfigure();
  const home = (await get('/')).body;
  const deals = (await get('/deals')).body;
  for (const html of [home, deals]) {
    assert.match(html, /impactStat\('transformLinks'\)/);
    assert.match(html, /utt\.impactcdn\.com/);
  }
});

// ── crawler surfaces ────────────────────────────────────────────────────────

test('robots.txt, sitemap.xml, sitemap-index.xml, llms.txt all serve', async () => {
  const robots = await get('/robots.txt');
  assert.equal(robots.code, 200);
  const sm = await get('/sitemap.xml');
  assert.equal(sm.code, 200);
  assert.match(sm.body, /<urlset|<url>/);
  assert.match(sm.body, /\/deals/);
  const smi = await get('/sitemap-index.xml');
  assert.equal(smi.code, 200);
  const llms = await get('/llms.txt');
  assert.equal(llms.code, 200);
  assert.match(llms.body, /storefront/i);
});

test('SITEMAP_PATHS covers home, /deals, and other-category doorways', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
  assert.ok(SITEMAP_PATHS.includes('/deals'));
  assert.ok(SITEMAP_PATHS.some((p) => p.startsWith('/c/')));
});

test('health probe', async () => {
  const res = await get('/health');
  assert.equal(res.code, 200);
  assert.equal(res.body, 'ok');
});

// ── category switching (ONE codebase, many doorways) ────────────────────────

test('/c/:category switches the storefront category', async () => {
  unconfigure();
  const res = await get('/c/electronics');
  assert.equal(res.code, 200);
  assert.match(res.body, /Electronics/);
});

test('catMeta title-cases an unknown category and still resolves a group (never throws)', () => {
  const m = catMeta('quantum-widgets');
  assert.equal(m.label, 'Quantum Widgets');
  assert.ok(m.group, 'unknown category still resolves a fallback group');
  assert.ok(typeof STORE_CATEGORY === 'string');
});

// ── XSS escaping ────────────────────────────────────────────────────────────

test('esc() neutralizes markup', () => {
  assert.equal(esc('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
});

test('a hostile product name from Impact is escaped, never reflected as live markup', async () => {
  const evil = '<script>alert(1)</script>';
  configure({
    catalogs: CANNED.catalogs,
    items: [{ Id: 'x1', Name: evil, CurrentPrice: 1, Currency: 'USD', Url: 'https://x/1', ImageUrl: '', CampaignName: evil }],
    campaigns: [], deals: [],
  });
  const html = await storePage('general');
  assert.ok(!html.includes('<script>alert(1)</script>'), 'unescaped script leaked into HTML');
  assert.ok(html.includes(esc(evil)), 'escaped hostile name not present');
  unconfigure();
});

test('a hostile deal name/code from Impact is escaped on /deals', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  configure({ campaigns: [], catalogs: [], items: [], deals: [{ Id: 'd9', Name: evil, CouponCode: evil, CampaignName: 'X', LandingPageUrl: 'https://x/d' }] });
  const res = await get('/deals');
  assert.ok(!res.body.includes('onerror=alert(1)>'), 'unescaped deal markup leaked');
  assert.ok(res.body.includes(esc(evil)), 'escaped deal name not present');
  unconfigure();
});

// ── routing robustness ──────────────────────────────────────────────────────

test('unknown route → 302 redirect home (never a 500)', async () => {
  const res = await get('/no/such/page');
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, '/');
});

test('never throws on garbage: a throwing Impact fetch still renders the home page (falls back honestly)', async () => {
  process.env.IMPACT_ACCOUNT_SID = 'SID123';
  process.env.IMPACT_AUTH_TOKEN = 'TOK456';
  impact.__setFetch(() => { throw new Error('boom'); });
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.body, /Live offers load once Impact is connected/i);
  unconfigure();
});

test('never throws on garbage: a weird /c/ category slug renders soft (title-cased), not a crash', async () => {
  unconfigure();
  const res = await get('/c/%3Cscript%3E');
  assert.equal(res.code, 200);
  assert.ok(!res.body.includes('<script>'), 'category slug must not reflect raw markup');
});

// ── Sign in with MELEK (the store as the first OIDC relying party) ─────────────────────────────
test('logged-out storefront shows the "Sign in with MELEK" button (identity-only)', async () => {
  unconfigure();
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.body, /Sign in with MELEK/);
  assert.match(res.body, /href="\/login"/);
});

test('/why-melek teaches the seed message: one account, minimal permission', async () => {
  const res = await get('/why-melek');
  assert.equal(res.code, 200);
  assert.match(res.body, /One MELEK account/i);
  assert.match(res.body, /minimal permission/i);        // it can never post/spend on your behalf
  assert.match(res.body, /Right of Reply/i);
});

test('/login redirects to the signer authorize URL and sets a CSRF state cookie', async () => {
  const res = await get('/login');
  assert.equal(res.code, 302);
  assert.match(res.headers.location, /\/oauth2\/authorize/);
  assert.match(String(res.headers['set-cookie']), /store_login_state=/);
});

test('/melek/callback rejects a mismatched state (CSRF) without setting a session', async () => {
  const res = await get('/melek/callback?code=abc&state=evil', { cookie: 'store_login_state=real' });
  assert.equal(res.code, 302);
  assert.match(res.headers.location, /login=error/);
  assert.ok(!String(res.headers['set-cookie'] || '').includes('soapbox_session='));
});

test('/logout clears the session cookie', async () => {
  const res = await get('/logout');
  assert.equal(res.code, 302);
  assert.match(String(res.headers['set-cookie']), /soapbox_session=;|Max-Age=0/);
});
