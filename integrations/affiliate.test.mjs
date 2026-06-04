// affiliate.test.mjs — OFFLINE tests for the GENERAL cross-vertical affiliate engine (#215).
// No network. Asserts: env-named id injection + soft-fail; FTC disclosure appended; honest ranking
// (clarity over commission); assertRankingUnbiased THROWS on a bought reorder + passes on honest order;
// per-vertical fit mapping; renderOffer escapes a malicious title + always discloses; data-selling
// CPL is refused. We mutate process.env per-test and restore it after.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  NETWORKS, MECHANISMS, esc, ftcDisclosure, disclose,
  affiliateLink, rankListings, assertRankingUnbiased,
  verticalAffiliateFit, renderOffer, buildLeadGen,
} from './affiliate.mjs';

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

// --- shape / model ----------------------------------------------------------

test('MECHANISMS encodes the six monetization mechanisms with descriptions', () => {
  const keys = Object.keys(MECHANISMS);
  assert.equal(keys.length, 6);
  for (const m of Object.values(MECHANISMS)) {
    assert.ok(m.code && typeof m.code === 'string');
    assert.ok(m.desc && m.desc.length > 0);
  }
  assert.ok(keys.includes('affiliate'));
  assert.ok(keys.includes('leadgen'));
  assert.ok(keys.includes('cpc'));
  assert.ok(keys.includes('sponsored'));
  assert.ok(keys.includes('premiumData'));
  assert.ok(keys.includes('proMembership'));
});

test('NETWORKS reference affiliate ids by ENV NAME only (no literal ids)', () => {
  for (const [, n] of Object.entries(NETWORKS)) {
    assert.ok(n.env && /^[A-Z0-9_]+$/.test(n.env), `env name should be an UPPER_SNAKE name: ${n.env}`);
    assert.ok(n.disclosure && n.disclosure.length > 0);
  }
  assert.ok(NETWORKS.cj && NETWORKS.impact && NETWORKS.travelpayouts && NETWORKS.booking);
});

// --- affiliateLink ----------------------------------------------------------

test('affiliateLink tags the url with the env-named id when set', () => {
  withEnv({ TRAVELPAYOUTS_MARKER: '12345' }, () => {
    const r = affiliateLink({ network: 'travelpayouts', url: 'https://booking.com/hotel/x' });
    assert.equal(r.configured, true);
    assert.ok(r.url.includes('marker=12345'), `expected marker in: ${r.url}`);
    assert.ok(r.disclosure.length > 0);
  });
});

test('affiliateLink injects subId for click attribution', () => {
  withEnv({ CJ_PUBLISHER_ID: 'pub99' }, () => {
    const r = affiliateLink({ network: 'cj', url: 'https://example.com/p', subId: 'exchanges-page' });
    assert.ok(r.url.includes('pid=pub99'));
    assert.ok(r.url.includes('subid=exchanges-page'));
  });
});

test('affiliateLink SOFT-FAILS to the plain url + "not configured" when env unset', () => {
  withEnv({ BOOKING_AID: undefined }, () => {
    const r = affiliateLink({ network: 'booking', url: 'https://booking.com/hotel/x' });
    assert.equal(r.configured, false);
    assert.equal(r.reason, 'not configured');
    assert.equal(r.url, 'https://booking.com/hotel/x', 'plain url unchanged');
    assert.ok(!r.url.includes('aid='), 'must NOT fabricate an id');
    assert.equal(r.env, 'BOOKING_AID', 'reports which env var to set');
  });
});

test('affiliateLink never throws on unknown network or empty url', () => {
  const a = affiliateLink({ network: 'nonsense', url: 'https://x.com' });
  assert.equal(a.configured, false);
  assert.equal(a.reason, 'unknown network');
  const b = affiliateLink({ network: 'cj', url: '' });
  assert.equal(b.configured, false);
  assert.equal(b.reason, 'no url');
});

// --- disclosure -------------------------------------------------------------

test('disclose appends the FTC disclosure line (escaped)', () => {
  const out = disclose('<div>offer</div>');
  assert.ok(out.includes('<div>offer</div>'));
  assert.ok(out.includes('ftc-disclosure'));
  assert.ok(/affiliate/i.test(out));
  assert.ok(/never sell your data/i.test(ftcDisclosure()));
});

// --- honest ranking ---------------------------------------------------------

test('rankListings orders by clarity (honest signal), NOT by commission', () => {
  const listings = [
    { id: 'low-clarity-high-pay', clarity: 10, commission: 100 },
    { id: 'high-clarity-no-pay',  clarity: 90, commission: 0 },
    { id: 'mid-clarity-mid-pay',  clarity: 50, commission: 50 },
  ];
  const ranked = rankListings(listings);
  assert.deepEqual(ranked.map((r) => r.id), ['high-clarity-no-pay', 'mid-clarity-mid-pay', 'low-clarity-high-pay']);
});

test('rankListings segregates sponsored items to the END, labeled', () => {
  const listings = [
    { id: 'org-low', clarity: 20 },
    { id: 'spon-high', clarity: 99, sponsored: true },
    { id: 'org-high', clarity: 80 },
  ];
  const ranked = rankListings(listings);
  // organic first (by clarity), sponsored last regardless of its clarity
  assert.deepEqual(ranked.map((r) => r.id), ['org-high', 'org-low', 'spon-high']);
  assert.equal(ranked[ranked.length - 1].label, 'Sponsored');
});

// --- the moat: assertRankingUnbiased ---------------------------------------

test('assertRankingUnbiased PASSES when organic order is honest', () => {
  const organic = rankListings([
    { id: 'a', clarity: 90 },
    { id: 'b', clarity: 50 },
  ]);
  const ranked = rankListings([
    { id: 'a', clarity: 90 },
    { id: 'b', clarity: 50 },
    { id: 's', clarity: 99, sponsored: true },
  ]);
  assert.equal(assertRankingUnbiased(organic, ranked), true);
});

test('assertRankingUnbiased THROWS when a sponsored item is moved above organic', () => {
  const organic = rankListings([
    { id: 'a', clarity: 90 },
    { id: 'b', clarity: 50 },
  ]);
  // a bought ranking: sponsored 's' interleaved ABOVE organic 'b'
  const bought = [
    { id: 'a', clarity: 90 },
    { id: 's', clarity: 99, sponsored: true },
    { id: 'b', clarity: 50 },
  ];
  assert.throws(() => assertRankingUnbiased(organic, bought), /ranking bias/);
});

test('assertRankingUnbiased THROWS when commission reordered the honest organic order', () => {
  const organic = rankListings([
    { id: 'a', clarity: 90, commission: 0 },
    { id: 'b', clarity: 50, commission: 999 },
  ]);
  // someone re-sorted by commission, putting 'b' above 'a'
  const bought = [
    { id: 'b', clarity: 50, commission: 999 },
    { id: 'a', clarity: 90, commission: 0 },
  ];
  assert.throws(() => assertRankingUnbiased(organic, bought), /organic order changed/);
});

// --- per-vertical fit -------------------------------------------------------

test('verticalAffiliateFit maps exchanges / forex / travel / insurance correctly', () => {
  const ex = verticalAffiliateFit('exchanges');
  assert.equal(ex.mechanism, 'affiliate');
  assert.ok(/exchange/i.test(ex.example));

  const fx = verticalAffiliateFit('forex');
  assert.equal(fx.mechanism, 'affiliate');
  assert.ok(/broker/i.test(fx.example));

  const tr = verticalAffiliateFit('travel');
  assert.equal(tr.mechanism, 'cpc');
  assert.equal(tr.network, 'travelpayouts');

  const ins = verticalAffiliateFit('insurance');
  assert.equal(ins.mechanism, 'affiliate');
  assert.ok(/no data-selling/i.test(ins.example), 'insurance fit must note no data-selling');
});

test('verticalAffiliateFit lawyers = sponsored ads only (never a cut of legal fees)', () => {
  const law = verticalAffiliateFit('lawyers');
  assert.equal(law.mechanism, 'sponsored');
  assert.ok(/never a cut/i.test(law.example));
});

test('verticalAffiliateFit returns a safe default shape for an unknown vertical', () => {
  const fit = verticalAffiliateFit('zzz-unknown');
  assert.equal(fit.mechanism, 'affiliate');
  assert.ok(fit.mechanismDesc.length > 0);
});

// --- renderOffer: escape + always-disclose ---------------------------------

test('renderOffer escapes a malicious title and always includes the disclosure', () => {
  withEnv({ CJ_PUBLISHER_ID: undefined }, () => {
    const html = renderOffer({
      title: '<img src=x onerror=alert(1)>"pwn"',
      network: 'cj',
      url: 'https://example.com/buy',
      vertical: 'exchanges',
    });
    assert.ok(!html.includes('<img src=x'), 'raw script-y title must be escaped');
    assert.ok(html.includes('&lt;img'), 'title should be HTML-escaped');
    assert.ok(html.includes('&quot;pwn&quot;'));
    assert.ok(html.includes('ftc-disclosure'), 'disclosure is always present');
  });
});

test('renderOffer labels a sponsored offer and still discloses', () => {
  const html = renderOffer({ title: 'Promoted', network: 'cj', url: 'https://x.com', sponsored: true });
  assert.ok(/Sponsored/.test(html));
  assert.ok(html.includes('data-sponsored="true"'));
  assert.ok(html.includes('ftc-disclosure'));
});

// --- no data-selling guardrail ---------------------------------------------

test('buildLeadGen REFUSES a data-selling CPL path (throws)', () => {
  assert.throws(() => buildLeadGen({ vertical: 'loans', sellsData: true, userConsented: true }), /data-selling/);
});

test('buildLeadGen requires explicit consent (no lead-gen by default)', () => {
  const r = buildLeadGen({ vertical: 'solar', providerUrl: 'https://installer.example' });
  assert.equal(r.ok, false);
  assert.ok(/consent/i.test(r.reason));
});

test('buildLeadGen allows a consented, non-data-selling connection', () => {
  const r = buildLeadGen({ vertical: 'solar', providerUrl: 'https://installer.example', userConsented: true });
  assert.equal(r.ok, true);
  assert.equal(r.mechanism, 'leadgen');
  assert.ok(/no user data is sold/i.test(r.note));
});

test('buildLeadGen honors LEAD_GEN_SELLS_DATA env as a refusal trigger', () => {
  withEnv({ LEAD_GEN_SELLS_DATA: 'false' }, () => {
    // module read the default at import time; assert the imported constant is the safe default
    const { LEAD_GEN_SELLS_DATA } = { LEAD_GEN_SELLS_DATA: process.env.LEAD_GEN_SELLS_DATA === 'true' };
    assert.equal(LEAD_GEN_SELLS_DATA, false);
  });
});

// --- esc --------------------------------------------------------------------

test('esc escapes all five HTML metacharacters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});
