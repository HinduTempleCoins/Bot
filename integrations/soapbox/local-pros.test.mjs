// local-pros.test.mjs — OFFLINE tests for the local & professional services + pet supplies + books
// vertical. No network: fetch is INJECTED and the book module is INJECTED as a fake. Asserts:
//   • findPros normalizes the feed + soft-fails to [] on dead/garbage sources;
//   • ranking is by RATING, not commission (commission never survives normalization);
//   • requestQuote refuses no-consent / data-selling / multi-buyer, allows consented single-provider;
//   • petSupplies returns a comparison list (one row per retailer) + env-named affiliate tagging;
//   • books reuses the injected book module (buyLinks + ftcDisclosure);
//   • renderPage escapes a malicious provider name + always carries a disclosure;
//   • dataNote is a non-empty honest string.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  PRO_CATEGORIES, isProCategory, findPros, requestQuote,
  petSupplies, petAffiliateOut, PET_RETAILERS, books,
  renderPage, dataNote, escapeHtml,
} from './local-pros.mjs';

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────
// A fake fetch returning a fixed JSON body with an ok flag.
function fakeFetch(body, { ok = true } = {}) {
  return async () => ({ ok, json: async () => body });
}
// A fetch that throws (dead source).
const deadFetch = async () => { throw new Error('network down'); };

// run a body with a controlled env, restoring originals afterward.
function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, val] of Object.entries(vars)) {
    if (val === undefined) delete process.env[k];
    else process.env[k] = val;
  }
  try { return fn(); }
  finally {
    for (const [k, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
  }
}

// A fake book module standing in for soapbox/affiliate.mjs.
const fakeBookModule = {
  buyLinks: (book) => [
    { vendor: 'bookshop', url: `https://bookshop.org/book/${book.isbn || book.title}`, kind: 'buy' },
    { vendor: 'openlibrary', url: `https://openlibrary.org/${book.isbn || book.title}`, kind: 'borrow' },
  ],
  ftcDisclosure: () => 'FAKE-BOOK-DISCLOSURE: we earn from qualifying purchases; borrowing is free.',
};

// ── catalog / predicate ─────────────────────────────────────────────────────────────────────────────
test('PRO_CATEGORIES contains the six required categories', () => {
  const ids = PRO_CATEGORIES.map((c) => c.id);
  for (const want of ['wedding', 'childcare', 'gyms', 'salons', 'accountants', 'tutors']) {
    assert.ok(ids.includes(want), `missing category: ${want}`);
  }
});

test('isProCategory true for known, false for unknown', () => {
  assert.equal(isProCategory('tutors'), true);
  assert.equal(isProCategory('nonsense'), false);
  assert.equal(isProCategory(''), false);
});

// ── findPros: normalize + soft-fail ─────────────────────────────────────────────────────────────────
test('findPros normalizes a feed into {name,rating,area,url,asOf}', async () => {
  const feed = { providers: [
    { name: 'Alpha Tutoring', rating: 4.5, area: 'Austin, TX', url: 'https://alpha.example' },
    { company: 'Beta Learning', stars: 4.9, website: 'https://beta.example' },
  ] };
  const rows = await findPros({ category: 'tutors', area: 'Austin, TX' }, { fetch: fakeFetch(feed) });
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.ok(typeof r.name === 'string' && r.name.length);
    assert.ok('rating' in r && 'area' in r && 'url' in r);
    assert.match(r.asOf, /^\d{4}-\d{2}-\d{2}$/);
  }
  // Beta (4.9) ranks above Alpha (4.5) — rating order.
  assert.equal(rows[0].name, 'Beta Learning');
});

test('findPros soft-fails to [] on dead fetch, bad category, and garbage body', async () => {
  assert.deepEqual(await findPros({ category: 'tutors', area: 'X' }, { fetch: deadFetch }), []);
  assert.deepEqual(await findPros({ category: 'not-a-cat', area: 'X' }, { fetch: fakeFetch({ providers: [{ name: 'Z' }] }) }), []);
  assert.deepEqual(await findPros({ category: 'gyms', area: 'X' }, { fetch: fakeFetch('not-json-shaped') }), []);
  assert.deepEqual(await findPros({ category: 'gyms', area: 'X' }, { fetch: fakeFetch(null, { ok: false }) }), []);
});

// ── rank by rating, NEVER commission ─────────────────────────────────────────────────────────────────
test('ranking is by rating, not commission — and commission never survives normalize', async () => {
  const feed = { providers: [
    { name: 'PaysUsMost', rating: 3.0, commission: 1000, payout: 999, bid: 50 },
    { name: 'BestRated', rating: 5.0, commission: 0 },
    { name: 'MidRated', rating: 4.0, commission: 500 },
  ] };
  const rows = await findPros({ category: 'salons', area: 'NYC' }, { fetch: fakeFetch(feed) });
  // Order is purely by rating descending — the big payer sinks to the bottom.
  assert.deepEqual(rows.map((r) => r.name), ['BestRated', 'MidRated', 'PaysUsMost']);
  // Commission/payout/bid must NOT have survived normalization anywhere.
  for (const r of rows) {
    assert.ok(!('commission' in r), 'commission leaked into normalized row');
    assert.ok(!('payout' in r), 'payout leaked into normalized row');
    assert.ok(!('bid' in r), 'bid leaked into normalized row');
  }
  // And serializing the whole result set never mentions a commission value.
  assert.ok(!/commission|payout|"bid"/i.test(JSON.stringify(rows)));
});

test('findPros: missing rating sorts last, ties break alphabetically', async () => {
  const feed = { providers: [
    { name: 'NoRating' },
    { name: 'Zeta', rating: 4.2 },
    { name: 'Apex', rating: 4.2 },
  ] };
  const rows = await findPros({ category: 'gyms', area: 'X' }, { fetch: fakeFetch(feed) });
  assert.deepEqual(rows.map((r) => r.name), ['Apex', 'Zeta', 'NoRating']);
});

// ── requestQuote: refusals + the one allowed path ────────────────────────────────────────────────────
test('requestQuote refuses without consent', () => {
  const r = requestQuote({ category: 'wedding', provider: 'Acme Venue', user: { name: 'Pat' }, consent: false });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-consent');
});

test('requestQuote refuses data-selling intent', () => {
  const r = requestQuote({ category: 'wedding', provider: 'Acme Venue', user: { name: 'Pat' }, consent: true, intent: 'resell my info to brokers' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'refused-data-selling');
});

test('requestQuote refuses multi-buyer (lead-mill) requests', () => {
  const r = requestQuote({ category: 'childcare', provider: 'Nanny Co', consent: true, user: { name: 'Pat', recipients: ['Other Co', 'Third Co'] } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'refused-multi-buyer');
});

test('requestQuote allows a consented single-provider routing record with sold:false', () => {
  const r = requestQuote({
    category: 'accountants', provider: 'CPA Partners',
    user: { name: 'Pat', email: 'pat@example.com', phone: '555-0100', area: '78701' },
    consent: true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.record.sold, false);
  assert.equal(r.record.consent, true);
  assert.equal(r.record.routedTo, 'CPA Partners');
  assert.equal(r.record.provider, 'CPA Partners');
  assert.equal(r.record.contact.email, 'pat@example.com');
});

test('requestQuote refuses unknown category + missing provider', () => {
  assert.equal(requestQuote({ category: 'nope', provider: 'X', consent: true }).reason, 'unknown-category');
  assert.equal(requestQuote({ category: 'gyms', provider: '', consent: true }).reason, 'no-provider');
});

// ── pet supplies ─────────────────────────────────────────────────────────────────────────────────────
test('petSupplies returns a comparison row per retailer', async () => {
  const rows = await petSupplies({ query: 'dog food' }, { fetch: deadFetch });
  assert.equal(rows.length, PET_RETAILERS.length);
  for (const r of rows) {
    assert.ok(r.retailer && r.label);
    assert.match(r.url, /^https:\/\//);
    assert.ok('configured' in r);
  }
  // query is encoded into the link.
  assert.ok(rows.every((r) => r.url.includes('dog+food') || r.url.includes('dog%20food') || r.url.includes('dog')));
});

test('petSupplies soft-fails to [] on empty query', async () => {
  assert.deepEqual(await petSupplies({ query: '' }, {}), []);
  assert.deepEqual(await petSupplies({}, {}), []);
});

test('petAffiliateOut tags by env NAME only, soft-falls to plain when env unset', () => {
  const chewy = PET_RETAILERS.find((r) => r.id === 'chewy');
  const plain = 'https://www.chewy.com/s?query=dog';
  withEnv({ [chewy.env]: undefined }, () => {
    const out = petAffiliateOut('chewy', plain);
    assert.equal(out.configured, false);
    assert.equal(out.url, plain);
    assert.ok(!out.url.includes(chewy.param + '='));
  });
  withEnv({ [chewy.env]: 'AFF-123' }, () => {
    const out = petAffiliateOut('chewy', plain);
    assert.equal(out.configured, true);
    assert.ok(out.url.includes(`${chewy.param}=AFF-123`), `expected tag in ${out.url}`);
  });
});

test('PET_RETAILERS never hard-code an affiliate id (env NAME only)', () => {
  for (const r of PET_RETAILERS) {
    assert.ok(typeof r.env === 'string' && /[A-Z]/.test(r.env), `retailer ${r.id} must reference an env var NAME`);
  }
});

// ── books: reuse the injected book module ────────────────────────────────────────────────────────────
test('books reuses the injected book module (buyLinks + ftcDisclosure)', async () => {
  const out = await books({ isbn: '9780140449136' }, { bookModule: fakeBookModule });
  assert.equal(out.links.length, 2);
  assert.ok(out.links.some((l) => l.kind === 'buy'));
  assert.ok(out.links.some((l) => l.kind === 'borrow'), 'borrow link from the book module must be present');
  assert.equal(out.disclosure, fakeBookModule.ftcDisclosure());
});

test('books accepts a title and soft-fails on empty/broken module', async () => {
  const byTitle = await books({ title: 'The Republic' }, { bookModule: fakeBookModule });
  assert.ok(byTitle.links.length >= 1);
  assert.deepEqual(await books({}, { bookModule: fakeBookModule }), { links: [], disclosure: '' });
  assert.deepEqual(await books({ isbn: '123' }, { bookModule: { notBuyLinks: true } }), { links: [], disclosure: '' });
});

// ── renderPage: escapes hostile input + ALWAYS discloses ─────────────────────────────────────────────
test('renderPage escapes a malicious provider name and always shows a disclosure', () => {
  const evil = '<script>alert(1)</script>';
  const html = renderPage({
    category: 'tutors',
    pros: [{ name: evil, rating: 5, area: 'X', url: 'https://x.example' }],
  });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script must not appear');
  assert.ok(html.includes('&lt;script&gt;'), 'name must be HTML-escaped');
  // disclosure is ALWAYS present even when none passed in.
  assert.ok(/class="disclosure"/.test(html));
  assert.ok(/affiliate|commission|sell your data/i.test(html));
});

test('renderPage carries the book-data disclosure + escapes a hostile pet label/url', () => {
  const html = renderPage({
    category: 'salons',
    pets: [{ label: '"><img src=x onerror=alert(1)>', url: 'https://shop.example?q=1' }],
    books: { links: [{ vendor: 'bookshop', url: 'https://bookshop.org/x', kind: 'buy' }], disclosure: 'BOOK-DISCLOSURE-HERE' },
  });
  assert.ok(!html.includes('onerror=alert(1)>'), 'hostile pet label must be escaped');
  assert.ok(html.includes('BOOK-DISCLOSURE-HERE'), 'book disclosure should surface when no explicit disclosure given');
});

// ── dataNote ─────────────────────────────────────────────────────────────────────────────────────────
test('dataNote is a non-empty honest string', () => {
  const n = dataNote();
  assert.equal(typeof n, 'string');
  assert.ok(n.length > 0);
  assert.match(n, /never (sold|by what they pay)|ranked by honest/i);
});

// ── escapeHtml sanity ────────────────────────────────────────────────────────────────────────────────
test('escapeHtml handles all five entities', () => {
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(escapeHtml(null), '');
});
