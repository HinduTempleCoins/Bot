// insurance.test.mjs — OFFLINE tests for the insurance comparison aggregator.
// No network: quote partners are injected. Asserts: line classification, carrier registry (facts only),
// quote aggregation soft-fails when no partner is configured (and aggregates when injected), ranking by
// Clarity (not commission — a high-commission weak carrier must NOT top the list), applyOut soft-fails to
// the plain url, the data-selling lead path is REFUSED, renderPage escapes a malicious carrier name +
// shows the not-advice/not-a-broker banner + the disclosure, dataNote present, and NO data-sell fields
// are emitted in any output shape.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  LINES,
  CARRIERS,
  classifyLine,
  isLine,
  listLines,
  listCarriers,
  amBestStrength,
  getQuotes,
  compareCarriers,
  rankCarriers,
  clarityForCarrier,
  applyOut,
  buildLeadGen,
  renderPage,
  dataNote,
  notAdviceBanner,
} from './insurance.mjs';

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, val] of Object.entries(vars)) {
    if (val === undefined) delete process.env[k];
    else process.env[k] = val;
  }
  return Promise.resolve().then(fn).finally(() => {
    for (const [k, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
  });
}

test('LINES covers the required lines', () => {
  for (const k of ['auto', 'home', 'health', 'life', 'pet', 'travel']) {
    assert.ok(isLine(k), `missing line ${k}`);
  }
  assert.deepEqual(listLines().sort(), ['auto', 'health', 'home', 'life', 'pet', 'travel']);
});

test('classifyLine maps synonyms to known lines, null for unknown', () => {
  assert.equal(classifyLine('car'), 'auto');
  assert.equal(classifyLine('renters'), 'home');
  assert.equal(classifyLine('medical'), 'health');
  assert.equal(classifyLine('term'), 'life');
  assert.equal(classifyLine('dog'), 'pet');
  assert.equal(classifyLine('trip'), 'travel');
  assert.equal(classifyLine('auto'), 'auto');
  assert.equal(classifyLine('spaceship'), null);
  assert.equal(classifyLine(''), null);
});

test('carrier registry is facts-only: carriers have lines + official url + AM Best, never a premium', () => {
  for (const c of CARRIERS) {
    assert.ok(c.name && c.url && Array.isArray(c.lines) && c.lines.length > 0);
    assert.ok(!('premium' in c), `carrier ${c.id} must not carry a premium`);
  }
  const auto = listCarriers('auto');
  assert.ok(auto.length >= 3);
  for (const c of auto) {
    assert.ok(c.lines.includes('auto'));
    assert.equal(c.line, 'auto');
    assert.ok(c.official); // regulator-of-record link present
    assert.equal(c.premium, undefined);
  }
  assert.deepEqual(listCarriers('nope'), []); // unknown line soft-fails to []
});

test('amBestStrength grades A++ highest, unknown -> null', () => {
  assert.ok(amBestStrength('A++') > amBestStrength('A+'));
  assert.ok(amBestStrength('A+') > amBestStrength('A'));
  assert.equal(amBestStrength('Z'), null);
  assert.equal(amBestStrength(''), null);
});

test('getQuotes soft-fails to [] with no partner configured', async () => {
  const q = await getQuotes({ line: 'auto', profile: { state: 'TX' } });
  assert.deepEqual(q, []);
  // unknown line also []
  assert.deepEqual(await getQuotes({ line: 'nope' }, { partners: [async () => [{ carrier: 'X', premium: 1 }]] }), []);
});

test('getQuotes aggregates from injected licensed partners; one failing partner drops out', async () => {
  const good = async ({ line }) => [{ carrier: 'GEICO', line, premium: 120, period: 'month', url: 'https://geico.com/q' }];
  const bad = async () => { throw new Error('partner API down'); };
  const objPartner = { name: 'p2', quote: async () => ({ quotes: [{ carrier: 'Progressive', premium: 135 }] }) };
  const q = await getQuotes({ line: 'auto' }, { partners: [good, bad, objPartner] });
  assert.equal(q.length, 2);
  assert.ok(q.find((x) => x.carrier === 'GEICO' && x.premium === 120));
  assert.ok(q.find((x) => x.carrier === 'Progressive' && x.premium === 135));
});

test('clarityForCarrier scores from observable facts; stronger carrier scores higher', () => {
  const strong = clarityForCarrier({ amBest: 'A++', url: 'https://x', lines: ['auto', 'home', 'life'] });
  const weak = clarityForCarrier({ amBest: 'C', url: 'https://y', lines: ['auto'] });
  assert.ok(strong.value > weak.value);
  assert.ok(['high', 'moderate', 'limited', 'opaque'].includes(strong.band));
  const noRating = clarityForCarrier({ url: 'https://z', lines: ['pet'] });
  assert.ok(noRating.value >= 0); // no published rating -> low but never throws
});

test('rankCarriers ranks by Clarity, NOT commission; sponsored segregated to the end', () => {
  const rows = [
    // weak carrier paying a fat commission, with a sponsored quote — must NOT top the list
    { name: 'WeakPayer', amBest: 'C', amBestStrength: amBestStrength('C'), clarity: clarityForCarrier({ amBest: 'C', url: 'u', lines: ['auto'] }), commission: 999, sponsored: true, premium: 50 },
    { name: 'StrongOrg', amBest: 'A++', amBestStrength: amBestStrength('A++'), clarity: clarityForCarrier({ amBest: 'A++', url: 'u', lines: ['auto', 'home', 'life'] }), commission: 0, sponsored: false, premium: 130 },
    { name: 'MidOrg', amBest: 'A', amBestStrength: amBestStrength('A'), clarity: clarityForCarrier({ amBest: 'A', url: 'u', lines: ['auto'] }), commission: 500, sponsored: false, premium: 110 },
  ];
  const ranked = rankCarriers(rows);
  assert.equal(ranked[0].name, 'StrongOrg', 'highest Clarity organic must be first');
  assert.equal(ranked[ranked.length - 1].name, 'WeakPayer', 'sponsored must be last');
  assert.equal(ranked[ranked.length - 1].label, 'Sponsored');
  // input not mutated
  assert.equal(rows[0].label, undefined);
});

test('compareCarriers returns facts-only when no quotes, layers cheapest quote when present', async () => {
  const factsOnly = await compareCarriers({ line: 'auto' });
  assert.ok(factsOnly.length >= 3);
  assert.ok(factsOnly.every((r) => r.premium === null));
  assert.ok(factsOnly.every((r) => r.clarity && typeof r.clarity.value === 'number'));

  const quotes = [
    { carrier: 'GEICO', line: 'auto', premium: 140, period: 'month', url: 'https://geico/q' },
    { carrier: 'GEICO', line: 'auto', premium: 120, period: 'month', url: 'https://geico/q2' }, // cheaper
  ];
  const withQuotes = await compareCarriers({ line: 'auto' }, { quotes });
  const geico = withQuotes.find((r) => r.name === 'GEICO');
  assert.equal(geico.premium, 120, 'cheapest matching quote is layered in');
  assert.deepEqual(await compareCarriers({ line: 'nope' }), []);
});

test('applyOut soft-fails to the plain url when the affiliate id is unset', async () => {
  await withEnv({ CJ_PUBLISHER_ID: undefined }, () => {
    const out = applyOut('GEICO', 'https://www.geico.com/', { network: 'cj' });
    assert.equal(out.url, 'https://www.geico.com/');
    assert.equal(out.configured, false);
    assert.ok(out.disclosure && out.disclosure.length > 0);
  });
});

test('applyOut tags the url when the affiliate id IS set', async () => {
  await withEnv({ CJ_PUBLISHER_ID: 'PUB123' }, () => {
    const out = applyOut('GEICO', 'https://www.geico.com/', { network: 'cj' });
    assert.ok(out.url.includes('PUB123'));
    assert.equal(out.configured, true);
  });
});

test('buildLeadGen REFUSES data-selling and requires consent (not an unlicensed lead-broker)', async () => {
  assert.throws(() => buildLeadGen({ vertical: 'insurance', sellsData: true }), /data-selling/i);
  const noConsent = buildLeadGen({ vertical: 'insurance' });
  assert.equal(noConsent.ok, false);
  const ok = buildLeadGen({ vertical: 'insurance', userConsented: true, providerUrl: 'https://x' });
  assert.equal(ok.ok, true);
  assert.match(ok.note, /no user data is sold/i);
});

test('renderPage escapes a malicious carrier name + shows not-advice banner + disclosure', () => {
  const evil = '<script>alert(1)</script>';
  const rows = [{ name: evil, amBest: 'A', amBestStrength: amBestStrength('A'), clarity: clarityForCarrier({ amBest: 'A', url: 'u', lines: ['auto'] }), url: 'https://x', premium: null, asOf: '2026-06-04' }];
  const html = renderPage({ line: 'auto', rows });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'must not contain raw script');
  assert.ok(html.includes('&lt;script&gt;'), 'must contain escaped script');
  assert.ok(html.includes('not a licensed insurance broker'));
  assert.ok(/Disclosure:/.test(html));
  assert.ok(html.includes(notAdviceBanner().slice(0, 20)));
});

test('renderPage shows "compare official source" when no live quote', () => {
  const rows = [{ name: 'State Farm', amBest: 'A++', amBestStrength: amBestStrength('A++'), clarity: clarityForCarrier({ amBest: 'A++', url: 'u', lines: ['auto'] }), url: 'https://x', premium: null, asOf: '2026-06-04' }];
  const html = renderPage({ line: 'auto', rows });
  assert.ok(html.includes('Compare official source'));
  assert.ok(html.includes('No live partner quotes configured'));
});

test('NO data-selling fields anywhere in the compare/quote output shape', async () => {
  const banned = ['sellData', 'sellsData', 'sellUserData', 'leadList', 'pii', 'sellEmail', 'brokerList'];
  const rows = await compareCarriers({ line: 'auto' });
  const q = await getQuotes({ line: 'auto' }, { partners: [async ({ line }) => [{ carrier: 'GEICO', line, premium: 100 }]] });
  for (const shape of [...rows, ...q]) {
    for (const b of banned) assert.ok(!(b in shape), `output must not expose ${b}`);
  }
});

test('dataNote states facts/affiliate-only/no-data-selling/not-advice', () => {
  const n = dataNote();
  assert.match(n, /not a licensed/i);
  assert.match(n, /never sell your data/i);
  assert.match(n, /not insurance advice/i);
  assert.match(n, /commission/i);
});
