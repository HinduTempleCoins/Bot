// software-reviews.test.mjs — OFFLINE tests with injected fetch. No network. Run:
//   node --test integrations/soapbox/software-reviews.test.mjs
//
// Covers: compareSoftware normalize + soft-fail []; rankByRating ranks by rating NOT commission +
// review-count is only a (capped) tiebreaker + sponsored segregated; vendorOut soft-fail plain url;
// renderPage escapes a malicious vendor name + carries disclosure + no-pay-to-rank; dataNote.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES, compareSoftware, rankByRating, ratingScore, vendorOut, renderPage, dataNote,
  normalizeVendor, escapeHtml, __setFetch, RATING_STEP,
} from './software-reviews.mjs';

// ── fetch fakes ────────────────────────────────────────────────────────────────────────────────────
const okJson = (body) => async () => ({ ok: true, status: 200, json: async () => body });
const fail = () => async () => { throw new Error('network down'); };
const notOk = () => async () => ({ ok: false, status: 500, json: async () => ({}) });

// run a body with a controlled env, restoring originals afterward
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

// ── CATEGORIES ───────────────────────────────────────────────────────────────────────────────────────
test('CATEGORIES has the four required verticals', () => {
  for (const c of ['software-saas', 'web-hosting', 'vpn', 'domains']) {
    assert.ok(Object.prototype.hasOwnProperty.call(CATEGORIES, c), `missing category ${c}`);
    assert.ok(typeof CATEGORIES[c].label === 'string' && CATEGORIES[c].label.length > 0);
  }
});

// ── compareSoftware: normalize + soft-fail ────────────────────────────────────────────────────────────
test('compareSoftware normalizes raw records into the canonical shape', async () => {
  await withEnv({ SOFTWARE_REVIEWS_SOURCE_URL: 'https://feed.test/reviews' }, async () => {
    const body = { vendors: [
      { name: 'Acme SaaS', rating: '4.5', reviews: '1200', pricing: '$12/mo', fit: 0.9, url: 'https://acme.test', commission: 99 },
      { vendor: 'Beta Cloud', stars: 6, reviewCount: -3, plan: 'free', match: 2, link: 'https://beta.test' }, // clamps
    ] };
    const out = await compareSoftware({ category: 'software-saas' }, { fetch: okJson(body) });
    assert.equal(out.length, 2);
    const a = out[0];
    assert.equal(a.name, 'Acme SaaS');
    assert.equal(a.rating, 4.5);
    assert.equal(a.reviews, 1200);
    assert.equal(a.pricing, '$12/mo');
    assert.equal(a.fit, 0.9);
    assert.equal(a.url, 'https://acme.test');
    assert.ok(a.asOf && /^\d{4}-\d{2}-\d{2}$/.test(a.asOf));
    // clamping: rating 0–5, reviews ≥ 0, fit 0–1
    const b = out[1];
    assert.equal(b.name, 'Beta Cloud');
    assert.equal(b.rating, 5);
    assert.equal(b.reviews, 0);
    assert.equal(b.fit, 1);
  });
});

test('compareSoftware soft-fails to [] on unknown category', async () => {
  await withEnv({ SOFTWARE_REVIEWS_SOURCE_URL: 'https://feed.test/reviews' }, async () => {
    const out = await compareSoftware({ category: 'not-a-category' }, { fetch: okJson({ vendors: [{ name: 'X' }] }) });
    assert.deepEqual(out, []);
  });
});

test('compareSoftware soft-fails to [] when no source URL configured', async () => {
  await withEnv({ SOFTWARE_REVIEWS_SOURCE_URL: undefined }, async () => {
    const out = await compareSoftware({ category: 'vpn' }, { fetch: okJson({ vendors: [{ name: 'X' }] }) });
    assert.deepEqual(out, []);
  });
});

test('compareSoftware soft-fails to [] on network error / non-ok / junk', async () => {
  await withEnv({ SOFTWARE_REVIEWS_SOURCE_URL: 'https://feed.test/reviews' }, async () => {
    assert.deepEqual(await compareSoftware({ category: 'vpn' }, { fetch: fail() }), []);
    assert.deepEqual(await compareSoftware({ category: 'vpn' }, { fetch: notOk() }), []);
    assert.deepEqual(await compareSoftware({ category: 'vpn' }, { fetch: okJson({ nope: true }) }), []);
  });
});

test('normalizeVendor drops unusable records (no name)', () => {
  assert.equal(normalizeVendor({ rating: 5 }, 'vpn'), null);
  assert.equal(normalizeVendor(null, 'vpn'), null);
  assert.equal(normalizeVendor('string', 'vpn'), null);
});

// ── rankByRating: rating not commission ──────────────────────────────────────────────────────────────
test('rankByRating ranks by rating, NOT by commission', () => {
  const vendors = [
    { name: 'LowRatingHighPay', rating: 3.0, reviews: 10, commission: 1000 },
    { name: 'TopRatedNoPay',    rating: 4.9, reviews: 10, commission: 0 },
    { name: 'MidRated',         rating: 4.0, reviews: 10, commission: 500 },
  ];
  const ranked = rankByRating(vendors);
  assert.deepEqual(ranked.map((v) => v.name), ['TopRatedNoPay', 'MidRated', 'LowRatingHighPay']);
});

test('review-count is only a TIEBREAKER and cannot flip a clear rating gap', () => {
  // A 4.2 with a huge review count must NOT beat a 4.8 with few reviews.
  const vendors = [
    { name: 'Higher', rating: 4.8, reviews: 5 },
    { name: 'PopularButLower', rating: 4.2, reviews: 1_000_000, fit: 1 },
  ];
  const ranked = rankByRating(vendors);
  assert.equal(ranked[0].name, 'Higher', 'higher rating must win regardless of review volume / fit');
  // and the tiebreaker stays strictly under one rating step
  const gap = ratingScore({ rating: 4.2, reviews: 1e9, fit: 1 }) - 4.2;
  assert.ok(gap < RATING_STEP, `tiebreak bonus ${gap} must be < RATING_STEP ${RATING_STEP}`);
});

test('review-count breaks ties between EQUALLY rated vendors', () => {
  const vendors = [
    { name: 'FewReviews', rating: 4.5, reviews: 3 },
    { name: 'ManyReviews', rating: 4.5, reviews: 5000 },
  ];
  const ranked = rankByRating(vendors);
  assert.equal(ranked[0].name, 'ManyReviews', 'on equal rating, more reviews wins the tiebreak');
});

test('fit breaks ties when rating AND reviews are equal', () => {
  const vendors = [
    { name: 'PoorFit', rating: 4.5, reviews: 100, fit: 0.1 },
    { name: 'GreatFit', rating: 4.5, reviews: 100, fit: 0.95 },
  ];
  const ranked = rankByRating(vendors);
  assert.equal(ranked[0].name, 'GreatFit');
});

test('rankByRating segregates sponsored rows to the END, labeled', () => {
  const vendors = [
    { name: 'SponsoredTop', rating: 5.0, reviews: 9999, sponsored: true },
    { name: 'OrganicMid',   rating: 4.0, reviews: 10 },
    { name: 'OrganicTop',   rating: 4.6, reviews: 10 },
  ];
  const ranked = rankByRating(vendors);
  // organic first, in honest order; sponsored last even though its rating is highest
  assert.deepEqual(ranked.map((v) => v.name), ['OrganicTop', 'OrganicMid', 'SponsoredTop']);
  const sponsored = ranked[ranked.length - 1];
  assert.equal(sponsored.sponsored, true);
  assert.equal(sponsored.label, 'Sponsored');
  // no organic row may appear after a sponsored row
  let seenSponsored = false;
  for (const v of ranked) {
    if (v.sponsored) seenSponsored = true;
    else assert.ok(!seenSponsored, 'organic row appeared after a sponsored row');
  }
});

test('rankByRating does not mutate input and soft-handles non-array', () => {
  const input = [{ name: 'A', rating: 4 }, { name: 'B', rating: 5 }];
  const copy = JSON.parse(JSON.stringify(input));
  rankByRating(input);
  assert.deepEqual(input, copy, 'input must not be mutated');
  assert.deepEqual(rankByRating(null), []);
  assert.deepEqual(rankByRating(undefined), []);
});

// ── vendorOut ────────────────────────────────────────────────────────────────────────────────────────
test('vendorOut soft-fails to plain url + not-configured when env unset', () => {
  withEnv({ IMPACT_PARTNER_ID: undefined }, () => {
    const out = vendorOut('Acme', 'https://acme.test/pricing', { network: 'impact' });
    assert.equal(out.url, 'https://acme.test/pricing', 'unset env → plain url');
    assert.equal(out.configured, false);
    assert.equal(out.reason, 'not configured');
    assert.ok(typeof out.disclosure === 'string' && out.disclosure.length > 0);
  });
});

test('vendorOut tags the url when the affiliate env IS set', () => {
  withEnv({ IMPACT_PARTNER_ID: 'pub-123' }, () => {
    const out = vendorOut('Acme', 'https://acme.test/pricing', { network: 'impact' });
    assert.ok(out.configured, 'configured should be true when env present');
    assert.ok(out.url.includes('pub-123'), `expected affiliate id in tagged url: ${out.url}`);
  });
});

test('vendorOut soft-fails to plain url on bad input', () => {
  const out = vendorOut('Acme', null, { network: 'impact' });
  assert.equal(out.url, '');
  assert.equal(out.configured, false);
});

// ── renderPage ───────────────────────────────────────────────────────────────────────────────────────
test('renderPage ESCAPES a malicious vendor name (XSS-safe)', () => {
  const evil = '<script>alert(1)</script>';
  const html = renderPage({ category: 'vpn', vendors: [{ name: evil, rating: 4.5, reviews: 100, url: 'https://x.test' }] });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag must not appear');
  assert.ok(html.includes(escapeHtml(evil)), 'escaped form should appear');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('renderPage carries the FTC disclosure', () => {
  const html = renderPage({ category: 'web-hosting', vendors: [{ name: 'Host', rating: 4.0, url: 'https://h.test' }] });
  assert.ok(/ftc-disclosure/.test(html));
  assert.ok(/affiliate|commission/i.test(html), 'disclosure text should be present');
  assert.ok(/never sell your data/i.test(html));
});

test('renderPage carries the no-pay-to-rank note', () => {
  const html = renderPage({ category: 'web-hosting', vendors: [{ name: 'Host', rating: 4.0, url: 'https://h.test' }] });
  assert.ok(/no pay-to-rank/i.test(html));
  assert.ok(/sponsored/i.test(html));
});

test('renderPage is safe on empty input', () => {
  const html = renderPage({});
  assert.ok(typeof html === 'string' && html.length > 0);
  assert.ok(/ftc-disclosure/.test(html));
});

test('renderPage labels sponsored rows in the output', () => {
  const html = renderPage({ category: 'vpn', vendors: [
    { name: 'Organic', rating: 4.0, url: 'https://o.test' },
    { name: 'Paid', rating: 5.0, sponsored: true, url: 'https://p.test' },
  ] });
  assert.ok(/badge-sponsored/.test(html));
  // organic vendor must render before the sponsored one in the HTML
  assert.ok(html.indexOf('Organic') < html.indexOf('Paid'), 'organic row should precede sponsored row');
});

// ── dataNote ─────────────────────────────────────────────────────────────────────────────────────────
test('dataNote is a non-empty provenance string mentioning the honest-ranking discipline', () => {
  const d = dataNote();
  assert.equal(typeof d, 'string');
  assert.ok(d.length > 0);
  assert.ok(/G2|Capterra/i.test(d));
  assert.ok(/never by commission/i.test(d));
  assert.ok(/never sell your data/i.test(d));
});
