// financial-products.test.mjs — OFFLINE tests for the financial-products comparison reader (#238).
// No network: fetch is injected. Asserts: normalization + soft-fail, ranking BY TRUE COST (not
// commission — a high-commission high-APR card must NOT top the list), rate context vs a benchmark,
// applyOut soft-fails to the plain url, the data-selling path is REFUSED, renderPage escapes a
// malicious product name + shows the not-advice banner + the disclosure, and dataNote is present.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  CATEGORIES,
  compareProducts,
  rankProducts,
  trueCost,
  rateContext,
  applyOut,
  buildLeadGen,
  renderPage,
  dataNote,
  notAdviceBanner,
  normalizeProduct,
  isCategory,
} from './financial-products.mjs';

// run a body with a controlled env, restoring originals afterward
function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, val] of Object.entries(vars)) {
    if (val === undefined) delete process.env[k];
    else process.env[k] = val;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, val] of Object.entries(saved)) {
        if (val === undefined) delete process.env[k];
        else process.env[k] = val;
      }
    });
}

// a fake fetch returning a fixed JSON product feed
function fetchReturning(json, ok = true) {
  return async () => ({ ok, json: async () => json });
}
const fetchThrows = async () => { throw new Error('network down'); };

test('CATEGORIES covers the required verticals', () => {
  for (const k of ['credit-cards', 'personal-loans', 'mortgages', 'auto-loans', 'savings-cds', 'business-loans', 'tax-software']) {
    assert.ok(isCategory(k), `missing category ${k}`);
  }
});

test('compareProducts normalizes a feed into the canonical shape', async () => {
  await withEnv({ FINPROD_SOURCE_URL: 'https://example.test/feed' }, async () => {
    const feed = {
      products: [
        { provider: 'Acme Bank', product: 'Cash Card', apr: 19.99, annualFee: 0, terms: 'no annual fee', url: 'https://acme.test/apply' },
        { issuer: 'Beta CU', name: 'Rewards Plus', rate: 24.5, fee: 95, link: 'https://beta.test/apply' },
      ],
    };
    const rows = await compareProducts({ category: 'credit-cards' }, { fetch: fetchReturning(feed) });
    assert.equal(rows.length, 2);
    const a = rows[0];
    assert.equal(a.provider, 'Acme Bank');
    assert.equal(a.product, 'Cash Card');
    assert.equal(a.apr, 19.99);
    assert.equal(a.fees, 0);
    assert.equal(a.url, 'https://acme.test/apply');
    assert.ok(a.asOf, 'asOf present');
    // alias fields normalized on the second row
    assert.equal(rows[1].provider, 'Beta CU');
    assert.equal(rows[1].apr, 24.5);
    assert.equal(rows[1].fees, 95);
  });
});

test('compareProducts soft-fails to [] on unknown category, no source, and network error', async () => {
  // unknown category
  assert.deepEqual(await compareProducts({ category: 'nope' }, { fetch: fetchReturning({ products: [] }) }), []);
  // no FINPROD_SOURCE_URL configured
  await withEnv({ FINPROD_SOURCE_URL: undefined }, async () => {
    assert.deepEqual(await compareProducts({ category: 'mortgages' }, { fetch: fetchReturning({ products: [{ provider: 'x' }] }) }), []);
  });
  // network throws
  await withEnv({ FINPROD_SOURCE_URL: 'https://example.test/feed' }, async () => {
    assert.deepEqual(await compareProducts({ category: 'mortgages' }, { fetch: fetchThrows }), []);
  });
});

test('rankProducts orders by TRUE COST, not commission (high-commission high-APR card does NOT top)', () => {
  const products = [
    // pays us the MOST but is the WORST deal — must NOT be first
    { provider: 'PushyBank', product: 'High APR Card', apr: 29.99, fees: 99, commission: 500 },
    // honest best deal, pays us little
    { provider: 'HonestCU', product: 'Low APR Card', apr: 12.5, fees: 0, commission: 5 },
    // middle
    { provider: 'MidBank', product: 'Mid Card', apr: 18.0, fees: 25, commission: 200 },
  ];
  const ranked = rankProducts(products);
  assert.equal(ranked[0].provider, 'HonestCU', 'lowest true cost must top');
  assert.equal(ranked[ranked.length - 1].provider, 'PushyBank', 'highest-commission worst-deal must NOT top');
  // explicitly: the top is NOT the highest-commission one
  assert.notEqual(ranked[0].provider, 'PushyBank');
  // commission is ignored in trueCost
  assert.ok(trueCost(products[1]) < trueCost(products[0]));
});

test('rankProducts segregates sponsored rows to the end, labeled', () => {
  const products = [
    { provider: 'Sponsored Co', product: 'Promoted', apr: 5.0, fees: 0, sponsored: true },
    { provider: 'Organic Co', product: 'Normal', apr: 10.0, fees: 0 },
  ];
  const ranked = rankProducts(products);
  // even though sponsored has the lowest APR, it must come AFTER the organic row
  assert.equal(ranked[0].provider, 'Organic Co');
  assert.equal(ranked[1].provider, 'Sponsored Co');
  assert.equal(ranked[1].label, 'Sponsored');
});

test('rankProducts ranks savings/CDs by highest APY first', () => {
  const products = [
    { provider: 'Low', product: 'Savings', apy: 1.0 },
    { provider: 'High', product: 'CD', apy: 4.5 },
    { provider: 'Mid', product: 'Savings', apy: 2.5 },
  ];
  const ranked = rankProducts(products);
  assert.equal(ranked[0].provider, 'High', 'highest yield first for savings');
  assert.equal(ranked[2].provider, 'Low');
});

test('rateContext compares a sample rate to the FRED benchmark', async () => {
  const fakeFred = { latest: async () => ({ value: 6.5, date: '2026-05-01' }) };
  // mortgage at 6.0% vs a 6.5% benchmark → better than market (below-market is good for borrowing)
  const good = await rateContext('mortgages', { fred: fakeFred, sampleRate: 6.0 });
  assert.equal(good.benchmark, 6.5);
  assert.equal(good.benchmarkSeries, CATEGORIES['mortgages'].benchmark);
  assert.equal(good.verdict, 'below-market'); // below the benchmark = a good borrowing rate
  // a 9% mortgage vs 6.5% → above-market (bad)
  const bad = await rateContext('mortgages', { fred: fakeFred, sampleRate: 9.0 });
  assert.equal(bad.verdict, 'above-market');
  // within 0.25 pts → competitive
  const tie = await rateContext('mortgages', { fred: fakeFred, sampleRate: 6.6 });
  assert.equal(tie.verdict, 'competitive');
});

test('rateContext for savings treats higher-than-benchmark APY as good', async () => {
  const fakeFred = { latest: async () => ({ value: 2.0, date: '2026-05-01' }) };
  const great = await rateContext('savings-cds', { fred: fakeFred, sampleRate: 4.0 });
  assert.equal(great.verdict, 'above-market'); // higher APY than benchmark = good
});

test('rateContext soft-fails when benchmark unavailable', async () => {
  const deadFred = { latest: async () => { throw new Error('no key'); } };
  const r = await rateContext('mortgages', { fred: deadFred, sampleRate: 6.0 });
  assert.equal(r.benchmark, null);
  assert.equal(r.verdict, 'unknown');
});

test('applyOut soft-fails to the plain url when the affiliate id is not configured', async () => {
  await withEnv({
    CJ_PUBLISHER_ID: undefined, IMPACT_PARTNER_ID: undefined, RAKUTEN_AFFILIATE_ID: undefined,
    SHAREASALE_AFFID: undefined, AWIN_PUBLISHER_ID: undefined, BOOKING_AID: undefined,
  }, () => {
    const out = applyOut('HonestCU', 'https://honestcu.test/apply', { network: 'impact' });
    assert.equal(out.url, 'https://honestcu.test/apply', 'plain url returned untagged');
    assert.equal(out.configured, false);
    assert.equal(out.reason, 'not configured');
    assert.ok(out.disclosure && out.disclosure.length > 0, 'disclosure always present');
  });
});

test('applyOut tags the url when the affiliate env id IS configured', async () => {
  await withEnv({ IMPACT_PARTNER_ID: 'PUB123' }, () => {
    const out = applyOut('HonestCU', 'https://honestcu.test/apply', { network: 'impact' });
    assert.ok(out.url.includes('PUB123'), 'env id injected into outbound url');
    assert.equal(out.configured, true);
  });
});

test('a data-selling lead-gen path is REFUSED (throws)', () => {
  // explicit per-call data-selling request is refused regardless of env/import timing
  assert.throws(() => buildLeadGen({ vertical: 'personal-loans', providerUrl: 'https://x.test', sellsData: true, userConsented: true }), /data-selling/i);
  // even with consent given, the data-selling flag overrides and refuses
  assert.throws(() => buildLeadGen({ vertical: 'mortgages', providerUrl: 'https://y.test', sellsData: true }), /data-selling/i);
});

test('buildLeadGen requires explicit consent and otherwise allows a non-data-selling connection', () => {
  const noConsent = buildLeadGen({ vertical: 'personal-loans', providerUrl: 'https://x.test' });
  assert.equal(noConsent.ok, false);
  const ok = buildLeadGen({ vertical: 'personal-loans', providerUrl: 'https://x.test', userConsented: true });
  assert.equal(ok.ok, true);
  assert.match(ok.note, /no user data is sold/i);
});

test('renderPage escapes a malicious product name + shows the not-advice banner + disclosure', () => {
  const evil = '<script>alert(1)</script>';
  const html = renderPage({
    category: 'credit-cards',
    products: [{ provider: evil, product: 'Bad" onmouseover="x', apr: 15, fees: 0, url: 'https://x.test' }],
    context: { benchmark: 18.0, benchmarkSeries: 'TERMCBCCALLNS', note: 'within range' },
  });
  // no raw script tag survives
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script must be escaped');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped form present');
  assert.ok(!html.includes('onmouseover="x'), 'attribute-break payload escaped');
  // banner + disclosure + transparency
  assert.ok(html.includes('not-advice-banner'), 'not-advice banner class present');
  assert.ok(html.toLowerCase().includes('not financial advice'), 'not-advice text present');
  assert.ok(html.includes('ftc-disclosure'), 'disclosure block present');
  assert.ok(html.toLowerCase().includes('true cost'), 'true-cost transparency line present');
});

test('renderPage is safe on empty input', () => {
  const html = renderPage({});
  assert.ok(html.includes('not-advice-banner'));
  assert.ok(html.includes('ftc-disclosure'));
});

test('normalizeProduct returns null on an unusable record', () => {
  assert.equal(normalizeProduct(null, 'credit-cards'), null);
  assert.equal(normalizeProduct({}, 'credit-cards'), null);
});

test('dataNote and notAdviceBanner are present and non-empty', () => {
  assert.ok(dataNote().length > 0);
  assert.match(dataNote(), /not financial advice/i);
  assert.match(notAdviceBanner(), /not financial advice/i);
});
