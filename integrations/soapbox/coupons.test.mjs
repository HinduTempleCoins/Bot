// coupons.test.mjs — OFFLINE tests for the coupons/cashback vertical. No network: fetch is injected.
// Covers: findCoupons normalization + soft-fail; rankCoupons orders by honest value (a high-commission
// low-value coupon does NOT outrank a high-value one); cashbackCompare returns disclosed windowed
// options; affiliateOut soft-fails to a plain url when env unset; renderPage escapes a malicious store
// name + always shows the disclosure; dataNote present. We mutate process.env per-test and restore it.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  findCoupons,
  rankCoupons,
  couponValue,
  cashbackCompare,
  affiliateOut,
  renderPage,
  dataNote,
  __setImpact,
  impactConfigured,
} from './coupons.mjs';

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

// a fake fetch returning a canned JSON body
function fakeFetch(body, { ok = true } = {}) {
  return async () => ({ ok, json: async () => body });
}

// ---------------------------------------------------------------------------
// findCoupons
// ---------------------------------------------------------------------------
test('findCoupons normalizes canned data into the canonical shape', async () => {
  const raw = [
    { couponCode: 'SAVE20', savings: '20% off', expiry: '2099-01-01', lastVerified: '2099-01-01', url: 'https://x.test/c1' },
    { type: 'cashback', merchant: 'Nike', deal: '8% back', url: 'https://x.test/cb' },
    { discount: '$5 off' }, // a code-type with NO code -> must be dropped
  ];
  const out = await findCoupons({ store: 'Nike' }, { fetch: fakeFetch(raw) });
  assert.equal(out.length, 2, 'the code-less code coupon is dropped');

  const code = out[0];
  assert.equal(code.type, 'code');
  assert.equal(code.code, 'SAVE20');
  assert.equal(code.discount, '20% off');
  assert.equal(code.expires, '2099-01-01');
  assert.equal(code.verifiedAt, '2099-01-01');
  assert.equal(code.sourceUrl, 'https://x.test/c1');
  assert.equal(code.store, 'Nike');

  const cb = out[1];
  assert.equal(cb.type, 'cashback');
  assert.equal(cb.code, '');
  assert.equal(cb.store, 'Nike');

  // every row has all canonical keys
  for (const c of out) {
    for (const k of ['store', 'code', 'discount', 'type', 'expires', 'verifiedAt', 'sourceUrl']) {
      assert.ok(k in c, `missing key ${k}`);
    }
  }
});

test('findCoupons soft-fails to [] on a non-ok response, a throw, and a missing store', async () => {
  assert.deepEqual(await findCoupons({ store: 'Nike' }, { fetch: fakeFetch([], { ok: false }) }), []);
  assert.deepEqual(await findCoupons({ store: 'Nike' }, { fetch: async () => { throw new Error('down'); } }), []);
  assert.deepEqual(await findCoupons({ store: '' }, { fetch: fakeFetch([{ code: 'X' }]) }), []);
  // accepts a {coupons:[...]} envelope too
  const env = await findCoupons({ store: 'A' }, { fetch: fakeFetch({ coupons: [{ code: 'Z', discount: '10% off' }] }) });
  assert.equal(env.length, 1);
  assert.equal(env[0].code, 'Z');
});

// ---------------------------------------------------------------------------
// rankCoupons — the load-bearing guardrail: commission can NEVER reorder honest results
// ---------------------------------------------------------------------------
test('rankCoupons orders by honest value, NOT by commission', () => {
  const now = Date.parse('2099-06-01T00:00:00Z');
  const lowValueHighCommission = {
    store: 'Nike', code: 'MEH', discount: '5% off', type: 'code',
    expires: '2099-12-31', verifiedAt: '2099-05-30', commission: 999,
  };
  const highValueLowCommission = {
    store: 'Nike', code: 'BIG', discount: '50% off', type: 'code',
    expires: '2099-12-31', verifiedAt: '2099-05-30', commission: 0,
  };
  // honest value must put the 50%-off ahead despite its near-zero commission
  assert.ok(couponValue(highValueLowCommission, { now }) > couponValue(lowValueHighCommission, { now }));

  // even when the high-commission one is passed FIRST, ranking puts the high-value one first
  const ranked = rankCoupons([lowValueHighCommission, highValueLowCommission], { now });
  assert.equal(ranked[0].code, 'BIG', 'high value wins regardless of commission or input order');
  assert.equal(ranked[1].code, 'MEH');
});

test('rankCoupons segregates sponsored to the end (never outranks an organic better deal)', () => {
  const now = Date.parse('2099-06-01T00:00:00Z');
  const sponsoredHuge = {
    store: 'Nike', code: 'SPON', discount: '60% off', type: 'code',
    expires: '2099-12-31', verifiedAt: '2099-05-30', sponsored: true, commission: 999,
  };
  const organicSmall = {
    store: 'Nike', code: 'ORG', discount: '10% off', type: 'code',
    expires: '2099-12-31', verifiedAt: '2099-05-30',
  };
  const ranked = rankCoupons([sponsoredHuge, organicSmall], { now });
  assert.equal(ranked[0].code, 'ORG', 'organic comes before sponsored even with a smaller discount');
  assert.equal(ranked[1].code, 'SPON');
  assert.equal(ranked[1].sponsored, true);
  assert.equal(ranked[1].label, 'Sponsored', 'sponsored item is labeled');
});

test('rankCoupons demotes expired coupons below live ones', () => {
  const now = Date.parse('2099-06-01T00:00:00Z');
  const expired = { store: 'A', code: 'OLD', discount: '70% off', type: 'code', expires: '2000-01-01', verifiedAt: '1999-12-31' };
  const live = { store: 'A', code: 'NEW', discount: '15% off', type: 'code', expires: '2099-12-31', verifiedAt: '2099-05-30' };
  const ranked = rankCoupons([expired, live], { now });
  assert.equal(ranked[0].code, 'NEW', 'a live modest deal beats a huge expired one');
});

test('rankCoupons applies a Clarity nudge on the honest side only', () => {
  const now = Date.parse('2099-06-01T00:00:00Z');
  const a = { store: 'Clear', code: 'A', discount: '20% off', type: 'code', expires: '2099-12-31', verifiedAt: '2099-05-30' };
  const b = { store: 'Murky', code: 'B', discount: '20% off', type: 'code', expires: '2099-12-31', verifiedAt: '2099-05-30' };
  const ranked = rankCoupons([b, a], { now, clarityByStore: { Clear: 100, Murky: 0 } });
  assert.equal(ranked[0].code, 'A', 'higher-Clarity store wins the tie');
});

// ---------------------------------------------------------------------------
// cashbackCompare
// ---------------------------------------------------------------------------
test('cashbackCompare returns disclosed, windowed portal options', () => {
  const out = cashbackCompare('Nike');
  assert.ok(out.length >= 3, 'several portals');
  for (const o of out) {
    assert.equal(o.windowed, true, 'rate is windowed (read live at the portal)');
    assert.ok(o.disclosure && /commission|affiliate/i.test(o.disclosure), 'each option carries a disclosure');
    assert.ok(/^https:\/\//.test(o.url), `portal url is https: ${o.url}`);
    assert.ok(o.asOf && !Number.isNaN(Date.parse(o.asOf)), 'as-of timestamp present');
    assert.equal(o.store, 'Nike');
  }
});

// ---------------------------------------------------------------------------
// affiliateOut
// ---------------------------------------------------------------------------
test('affiliateOut soft-fails to a plain url + "not configured" when the env id is unset', () => {
  withEnv({ RAKUTEN_AFFILIATE_ID: undefined }, () => {
    const out = affiliateOut('Nike', { network: 'rakuten', url: 'https://www.rakuten.com/stores/nike' });
    assert.equal(out.configured, false);
    assert.equal(out.reason, 'not configured');
    assert.equal(out.url, 'https://www.rakuten.com/stores/nike', 'plain, untagged url');
    assert.ok(out.disclosure, 'disclosure still present even when unconfigured');
  });
});

test('affiliateOut tags the url when the env id IS set (via affiliate.mjs)', () => {
  withEnv({ RAKUTEN_AFFILIATE_ID: 'TESTID123' }, () => {
    const out = affiliateOut('Nike', { network: 'rakuten', url: 'https://www.rakuten.com/stores/nike' });
    assert.equal(out.configured, true);
    assert.ok(out.url.includes('TESTID123'), 'the env id is injected into the outbound url');
  });
});

test('affiliateOut with no network is a plain unconfigured url', () => {
  const out = affiliateOut('Nike');
  assert.equal(out.configured, false);
  assert.equal(out.reason, 'not configured');
  assert.ok(/^https:\/\//.test(out.url));
});

// ---------------------------------------------------------------------------
// renderPage
// ---------------------------------------------------------------------------
test('renderPage escapes a malicious store name and always shows the disclosure', () => {
  const evil = '<script>alert("xss")</script>';
  const html = renderPage({
    store: evil,
    coupons: [{ store: evil, code: '<b>X</b>', discount: '"50% off"', type: 'code', expires: '2099-01-01', verifiedAt: '2099-01-01', sourceUrl: 'https://x.test' }],
  });
  assert.ok(!html.includes('<script>alert'), 'raw script tag must not appear');
  assert.ok(html.includes('&lt;script&gt;'), 'store name is HTML-escaped');
  assert.ok(html.includes('&lt;b&gt;X&lt;/b&gt;'), 'coupon code is HTML-escaped');
  assert.ok(html.includes('ftc-disclosure'), 'FTC disclosure block always present');
  assert.ok(/commission|affiliate/i.test(html), 'disclosure text present');
  assert.ok(html.includes('no-pay-to-rank'), '"we don\'t take pay-to-rank" note present');
  assert.ok(/As of \d{4}-\d{2}-\d{2}/.test(html), 'as-of timestamp shown');
});

test('renderPage shows an empty state and still discloses when no coupons', () => {
  const html = renderPage({ store: 'Empty' });
  assert.ok(html.includes('No coupons found'), 'empty state');
  assert.ok(html.includes('ftc-disclosure'), 'disclosure even when empty');
});

// ---------------------------------------------------------------------------
// dataNote
// ---------------------------------------------------------------------------
test('dataNote is present with provenance, guardrails, and an as-of', () => {
  const n = dataNote();
  assert.ok(n.source && typeof n.source === 'string');
  assert.ok(Array.isArray(n.guardrails) && n.guardrails.length >= 4);
  assert.ok(n.guardrails.some((g) => /commission can never reorder/i.test(g)));
  assert.ok(n.guardrails.some((g) => /no data-selling/i.test(g)));
  assert.ok(n.asOf && !Number.isNaN(Date.parse(n.asOf)), 'as-of timestamp');
  assert.ok(/affiliate\.mjs/.test(n.affiliateEngine), 'reports it reuses the affiliate engine');
});


// ---------------------------------------------------------------------------
// findCoupons — the Impact.com source
//
// This vertical's only offer source used to be a `.invalid` URL that can never resolve, so it always
// rendered empty. impact-api.listDeals() is now a real source. It is injected here (a stub module),
// so the suite stays fully offline and no credential is ever needed to test the wiring.
// ---------------------------------------------------------------------------
const realImpact = await import('../impact-api.mjs').catch(() => null);
function stubImpact(deals, { configured = true, throws = false } = {}) {
  return {
    configured: () => configured,
    listDeals: async () => { if (throws) throw new Error('impact down'); return deals; },
  };
}
function withImpact(stub, fn) {
  __setImpact(stub);
  try { return fn(); } finally { __setImpact(realImpact); }
}

test('findCoupons pulls approved Impact deals and maps them through the same normalizer', async () => {
  const deals = [
    { id: '1', advertiser: 'Nike, Inc.', name: 'Spring sale', code: 'SPRING20',
      discount: '20% off', expires: '2099-01-01', url: 'https://nike.example/deal' },
    { id: '2', advertiser: 'Adidas', name: 'Other brand', code: 'NOPE20', discount: '20% off' },
  ];
  const out = await withImpact(stubImpact(deals), () => findCoupons({ store: 'Nike' }));
  assert.equal(out.length, 1, 'only the matching advertiser is returned');
  const c = out[0];
  assert.equal(c.code, 'SPRING20');
  assert.equal(c.type, 'code');
  assert.equal(c.discount, '20% off');
  assert.equal(c.store, 'Nike, Inc.');
  assert.equal(c.expires, '2099-01-01');
  assert.equal(c.sourceUrl, 'https://nike.example/deal', 'Impact url maps to sourceUrl');
});

test('Impact advertiser matching tolerates suffixes and punctuation, both directions', async () => {
  const mk = (advertiser) => [{ id: 'x', advertiser, code: 'C1', discount: '5% off' }];
  for (const adv of ['Nike, Inc.', 'NIKE US', 'nike']) {
    const out = await withImpact(stubImpact(mk(adv)), () => findCoupons({ store: 'Nike' }));
    assert.equal(out.length, 1, `should match advertiser ${adv}`);
  }
  const miss = await withImpact(stubImpact(mk('Reebok')), () => findCoupons({ store: 'Nike' }));
  assert.deepEqual(miss, [], 'a different advertiser does not match');
});

test('Impact is never called when unconfigured, and a throw soft-fails to []', async () => {
  let called = false;
  const spy = { configured: () => false, listDeals: async () => { called = true; return [{ id: '1', advertiser: 'Nike', code: 'X', discount: '1% off' }]; } };
  assert.deepEqual(await withImpact(spy, () => findCoupons({ store: 'Nike' })), []);
  assert.equal(called, false, 'unconfigured must not reach out');
  assert.deepEqual(await withImpact(stubImpact([], { throws: true }), () => findCoupons({ store: 'Nike' })), []);
});

test('a deal with no promo code is dropped — we never fabricate one', async () => {
  const deals = [{ id: '1', advertiser: 'Nike', name: 'Just a banner', discount: '', url: 'https://x.example' }];
  assert.deepEqual(await withImpact(stubImpact(deals), () => findCoupons({ store: 'Nike' })), []);
});

test('feed and Impact merge, and the same code from both is deduped once', async () => {
  const deals = [
    { id: '1', advertiser: 'Nike', code: 'SPRING20', discount: '20% off' },
    { id: '2', advertiser: 'Nike', code: 'IMPACTONLY', discount: '30% off' },
  ];
  const feed = [{ store: 'Nike', code: 'SPRING20', discount: '20% off' },
                { store: 'Nike', code: 'FEEDONLY', discount: '15% off' }];
  const out = await withImpact(stubImpact(deals),
    () => findCoupons({ store: 'Nike' }, { fetch: fakeFetch(feed) }));
  const codes = out.map((c) => c.code).sort();
  assert.deepEqual(codes, ['FEEDONLY', 'IMPACTONLY', 'SPRING20']);
});

test('no injected fetch and no COUPON_FEED_URL means the feed is never dialled', async () => {
  // The old code fired at https://coupons.invalid on EVERY render — a guaranteed DNS failure.
  // With no source configured there is now nothing to dial, and the result is honestly empty.
  await withEnv({ COUPON_FEED_URL: undefined }, async () => {
    assert.deepEqual(await withImpact(stubImpact([], { configured: false }),
      () => findCoupons({ store: 'Nike' })), []);
  });
});

test('impactConfigured reflects the adapter and never throws', async () => {
  assert.equal(withImpact(stubImpact([], { configured: true }), () => impactConfigured()), true);
  assert.equal(withImpact(stubImpact([], { configured: false }), () => impactConfigured()), false);
  assert.equal(withImpact({}, () => impactConfigured()), false, 'adapter missing configured() -> false');
  assert.equal(withImpact({ configured: () => { throw new Error('boom'); } }, () => impactConfigured()), false);
});
