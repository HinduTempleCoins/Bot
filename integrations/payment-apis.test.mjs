// payment-apis.test.mjs — offline, deterministic. Run: node --test integrations/payment-apis.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYMENT_APIS, AUTH, PCI_SCOPE, CATEGORIES,
  byCategory, pciSafe, goLiveChecklist, find, summary, renderCatalog,
} from './payment-apis.mjs';

const REQUIRED = ['name', 'slug', 'category', 'url', 'auth', 'pciScope', 'notes'];

function assertEntryShape(e) {
  for (const f of REQUIRED) {
    assert.ok(typeof e[f] === 'string' && e[f].length > 0, `entry ${e.slug || '?'} missing/empty field: ${f}`);
  }
  assert.ok(/^[a-z0-9-]+$/.test(e.slug), `entry ${e.slug} slug must be kebab-case`);
  assert.ok(AUTH.includes(e.auth), `entry ${e.slug} has invalid auth: ${e.auth}`);
  assert.ok(PCI_SCOPE.includes(e.pciScope), `entry ${e.slug} has invalid pciScope: ${e.pciScope}`);
  assert.ok(CATEGORIES.includes(e.category), `entry ${e.slug} unknown category: ${e.category}`);
  assert.ok(/^https?:\/\//.test(e.url), `entry ${e.slug} url should be http(s): ${e.url}`);
  assert.ok(Array.isArray(e.goLiveReq) && e.goLiveReq.length > 0, `entry ${e.slug} needs a non-empty goLiveReq`);
  for (const step of e.goLiveReq) {
    assert.ok(typeof step === 'string' && step.length > 0, `entry ${e.slug} has an empty goLiveReq step`);
  }
}

test('registry holds ~100 entries (>=100), each well-formed', () => {
  assert.ok(PAYMENT_APIS.length >= 100, `expected >=100 payment APIs, got ${PAYMENT_APIS.length}`);
  for (const e of PAYMENT_APIS) assertEntryShape(e);
});

test('slugs are unique (no dupes)', () => {
  const slugs = PAYMENT_APIS.map((e) => e.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'duplicate slugs in registry');
});

test('names are unique (no dupes)', () => {
  const names = PAYMENT_APIS.map((e) => e.name);
  assert.equal(new Set(names).size, names.length, 'duplicate names in registry');
});

test('every category is represented, no stray categories', () => {
  const used = new Set(PAYMENT_APIS.map((e) => e.category));
  for (const c of CATEGORIES) assert.ok(used.has(c), `category never used: ${c}`);
  for (const c of used) assert.ok(CATEGORIES.includes(c), `entry uses unknown category: ${c}`);
});

test('covers the named card-processor / wallet / bank / crypto / BNPL staples', () => {
  const slugs = new Set(PAYMENT_APIS.map((e) => e.slug));
  for (const id of [
    'stripe', 'paypal', 'braintree', 'square', 'adyen', 'authorize-net', 'checkout-com',
    'worldpay', 'razorpay', 'paddle', 'lemon-squeezy', '2checkout-verifone', 'mollie', 'helcim',
    'apple-pay', 'google-pay', 'venmo', 'cash-app-pay',
    'plaid', 'stripe-financial-connections', 'mx', 'yodlee', 'finicity', 'truelayer', 'gocardless',
    'coinbase-commerce', 'btcpay-server', 'nowpayments', 'bitpay', 'opennode', 'melek-prana-rails',
    'stripe-connect', 'paypal-payouts', 'wise', 'dwolla',
    'taxjar', 'avalara', 'stripe-tax',
    'stripe-radar', 'sift', 'seon', 'kount',
    'affirm', 'klarna', 'afterpay',
    'impact', 'cj-affiliate', 'shareasale', 'awin', 'skimlinks',
  ]) {
    assert.ok(slugs.has(id), `missing expected payment API: ${id}`);
  }
});

test('byCategory groups every entry into a valid bucket', () => {
  const g = byCategory(PAYMENT_APIS);
  assert.ok(typeof g === 'object' && g !== null);
  for (const [cat, arr] of Object.entries(g)) {
    assert.ok(Array.isArray(arr) && arr.length > 0);
    for (const e of arr) assert.equal(e.category, cat);
  }
  const grouped = Object.values(g).reduce((n, arr) => n + arr.length, 0);
  assert.equal(grouped, PAYMENT_APIS.length, 'grouped count must equal total');
});

test('pciSafe returns only none-hosted entries and is the bulk of the registry', () => {
  const safe = pciSafe(PAYMENT_APIS);
  assert.ok(safe.length > 0, 'expected PCI-safe entries');
  for (const e of safe) assert.equal(e.pciScope, 'none-hosted', `${e.slug} is not none-hosted`);
  // The whole point: nearly everything keeps us out of PCI scope.
  assert.ok(safe.length >= PAYMENT_APIS.length - 5, 'most entries should be PCI-safe (hosted/redirect)');
  // No entry should land us in FULL PCI scope.
  assert.equal(PAYMENT_APIS.filter((e) => e.pciScope === 'full').length, 0, 'no full-PCI-scope entries should be curated in');
});

test('find returns an entry by slug, null on miss', () => {
  assert.equal(find('stripe').name, 'Stripe');
  assert.equal(find('melek-prana-rails').category, 'Crypto Pay');
  assert.equal(find('does-not-exist'), null);
  assert.equal(find(), null);
});

test('goLiveChecklist returns ordered steps led by PCI guidance', () => {
  const c = goLiveChecklist('stripe');
  assert.ok(c && typeof c === 'object');
  assert.equal(c.slug, 'stripe');
  assert.equal(c.name, 'Stripe');
  assert.ok(Array.isArray(c.steps) && c.steps.length >= 2, 'checklist needs at least the PCI step + reqs');
  // first step is the PCI guidance; for a none-hosted entry it must say it keeps us OUT of scope.
  assert.match(c.steps[0], /OUT of PCI scope/);
  // the original goLiveReq steps all appear after the PCI step.
  for (const req of find('stripe').goLiveReq) assert.ok(c.steps.includes(req), `checklist missing req: ${req}`);
  // miss → null
  assert.equal(goLiveChecklist('nope'), null);
  assert.equal(goLiveChecklist(), null);
});

test('goLiveChecklist PCI guidance varies by scope', () => {
  // none-hosted entry
  assert.match(goLiveChecklist('paypal').steps[0], /OUT of PCI scope/);
  // the one SAD-scope entry warns about touching card data
  const sad = PAYMENT_APIS.find((e) => e.pciScope === 'sad');
  if (sad) assert.match(goLiveChecklist(sad.slug).steps[0], /SAQ-A-EP|limited card data/);
});

test('summary counts total, category, auth, pciScope, and pciSafe correctly', () => {
  const s = summary();
  assert.equal(s.total, PAYMENT_APIS.length);
  const sumAuth = s.byAuth.key + s.byAuth.oauth + s.byAuth.partner;
  assert.equal(sumAuth, PAYMENT_APIS.length, 'auth counts must sum to total');
  const sumPci = s.byPciScope['none-hosted'] + s.byPciScope.sad + s.byPciScope.full;
  assert.equal(sumPci, PAYMENT_APIS.length, 'pciScope counts must sum to total');
  const sumCat = Object.values(s.byCategory).reduce((n, v) => n + v, 0);
  assert.equal(sumCat, PAYMENT_APIS.length, 'category counts must sum to total');
  assert.equal(s.pciSafe, pciSafe(PAYMENT_APIS).length);
});

test('NO SECRETS: entries carry names + URLs only, never key-like values', () => {
  // Catalog must not embed secrets. Scan the serialized registry for credential-looking strings.
  const blob = JSON.stringify(PAYMENT_APIS);
  assert.ok(!/sk_live_|sk_test_|pk_live_|rk_live_/.test(blob), 'must not contain Stripe-style live/test keys');
  assert.ok(!/Bearer\s+[A-Za-z0-9._-]{16,}/.test(blob), 'must not contain a bearer token');
  assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(blob), 'must not contain a private key');
  // No entry should declare an env-var-with-value or an apiKey field.
  for (const e of PAYMENT_APIS) {
    assert.equal('apiKey' in e, false, `${e.slug} must not carry an apiKey`);
    assert.equal('secret' in e, false, `${e.slug} must not carry a secret`);
    assert.equal('token' in e, false, `${e.slug} must not carry a token`);
  }
});

test('renderCatalog escapes HTML and never injects markup', () => {
  const evil = [{ name: '<script>alert(1)</script>', slug: 'x', category: 'Card Processor', url: 'https://e.com/?a=1&b=2', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['it\'s <b>bad</b>'], notes: 'a "quoted" & <risky> note' }];
  const html = renderCatalog(evil, 'html');
  assert.ok(!html.includes('<script>'), 'must escape <script>');
  assert.ok(html.includes('&lt;script&gt;'), 'expected escaped script tag');
  assert.ok(html.includes('&amp;'), 'expected escaped ampersand');
  assert.ok(html.includes('&quot;') || html.includes('&#39;'), 'expected escaped quotes');

  const full = renderCatalog(PAYMENT_APIS, 'html');
  assert.ok(full.startsWith('<table'));
  assert.equal((full.match(/<tr>/g) || []).length, PAYMENT_APIS.length + 1); // +1 header row

  const md = renderCatalog(evil, 'md');
  assert.ok(md.includes('| Name |'));
  assert.ok(!md.includes('<script>'));
});

test('accessors soft-fail on bad input', () => {
  assert.deepEqual(byCategory(null), {});
  assert.deepEqual(pciSafe(null), []);
  assert.deepEqual(pciSafe(42), []);
  assert.equal(goLiveChecklist(null), null);
  assert.equal(renderCatalog(null, 'html').includes('<table'), true);
  assert.equal(summary(null).total, 0);
});
