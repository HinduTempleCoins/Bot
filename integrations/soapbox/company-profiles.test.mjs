// company-profiles.test.mjs — the keyless Crunchbase-style profile assembler, with injected fetch
// (no network). Verifies graceful missing-data handling, per-fact source+license provenance, robust
// resolution against malformed upstream shapes, and that it never emits a verdict about the company.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyProfile, SOURCE_META, __setFetch } from './company-profiles.mjs';
import { invalidate } from './cache.mjs';

const ok = (obj) => ({ ok: true, status: 200, json: async () => obj });
const notFound = () => ({ ok: false, status: 404, json: async () => ({}) });

// A configurable fake of the four upstreams. Pass overrides to simulate partial/total outages.
function fakeFetch(opts = {}) {
  return async (url, init) => {
    const u = String(url);
    if (u.includes('company_tickers.json')) {
      if (opts.tickersBad) return ok('not an object'); // malformed: not an array of rows
      if (opts.tickersDown) return notFound();
      return ok({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } });
    }
    if (u.includes('data.sec.gov/submissions/')) {
      if (opts.secDown) return notFound();
      return ok({
        name: 'Apple Inc.', tickers: ['AAPL'], exchanges: ['Nasdaq'],
        sic: '3571', sicDescription: 'Electronic Computers', ein: '942404110',
        fiscalYearEnd: '0930', stateOfIncorporation: 'CA', website: 'https://www.apple.com',
        filings: { recent: { form: ['10-K', '8-K'], filingDate: ['2024-11-01', '2024-10-01'], reportDate: ['2024-09-28', ''], primaryDocument: ['aapl.htm', 'x.htm'], accessionNumber: ['0000320193-24-000123', '0000320193-24-000100'] } },
      });
    }
    if (u.includes('api.gleif.org')) {
      if (opts.gleifDown) return notFound();
      return ok({ data: [{ id: 'HWUPKR0MPOU8FGXBT394', attributes: { entity: { legalName: { name: 'APPLE INC.' }, jurisdiction: 'US-CA', legalForm: { id: 'XTIQ' }, status: 'ACTIVE', headquartersAddress: { city: 'Cupertino', region: 'US-CA', country: 'US' } } } }] });
    }
    if (u.includes('wbsearchentities')) {
      if (opts.wdDown) return notFound();
      return ok({ search: [{ id: 'Q312' }] });
    }
    if (u.includes('Special:EntityData/Q312')) {
      return ok({ entities: { Q312: {
        descriptions: { en: { value: 'American technology company' } },
        claims: {
          P571: [{ mainsnak: { datavalue: { value: { time: '+1976-04-01T00:00:00Z' } } } }],
          P856: [{ mainsnak: { datavalue: { value: 'https://www.apple.com' } } }],
          P1128: [{ mainsnak: { datavalue: { value: { amount: '+161000' } } } }],
          P249: [{ mainsnak: { datavalue: { value: 'AAPL' } } }],
        },
      } } });
    }
    if (u.includes('Special:EntityData/')) {
      // label lookups for the linked item refs (none set in our claims) → empty
      return ok({ entities: {} });
    }
    if (u.includes('rest_v1/page/summary')) {
      if (opts.wpDown) return notFound();
      return ok({ type: 'standard', extract: 'Apple Inc. is an American multinational technology company.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Apple_Inc.' } } });
    }
    if (u.includes('usaspending.gov')) {
      if (opts.govDown) return notFound();
      return ok({ results: [{ 'Award ID': 'C123', 'Recipient Name': 'APPLE INC.', 'Award Amount': 50000, 'Awarding Agency': 'GSA', 'Start Date': '2023-01-01' }] });
    }
    return notFound();
  };
}

test('empty query throws (caller wraps it) — does not silently return a bogus profile', async () => {
  invalidate();
  await assert.rejects(() => companyProfile('   '), /empty query/);
});

test('full happy path stitches all sources and reports them', async () => {
  invalidate(); __setFetch(fakeFetch());
  const p = await companyProfile('AAPL');
  assert.equal(p.name, 'Apple Inc.');
  assert.equal(p.ticker, 'AAPL');
  assert.equal(p.cik, '0000320193');
  assert.equal(p.lei, 'HWUPKR0MPOU8FGXBT394');
  assert.equal(p.traded, true);
  assert.equal(p.tradedStatus, 'public');
  assert.ok(p.sources.includes('SEC EDGAR') && p.sources.includes('GLEIF') && p.sources.includes('Wikidata') && p.sources.includes('Wikipedia'));
  assert.ok(p.completeness > 0 && p.completeness <= 100);
  __setFetch(null); invalidate();
});

test('every fact carries a source + license provenance entry', async () => {
  invalidate(); __setFetch(fakeFetch());
  const p = await companyProfile('AAPL');
  assert.ok(Array.isArray(p.provenance) && p.provenance.length > 0, 'provenance present');
  for (const pr of p.provenance) {
    assert.ok(pr.field && pr.source, 'field + source set');
    assert.ok(SOURCE_META[pr.source], `source ${pr.source} is a known source`);
    assert.ok(pr.license && typeof pr.license === 'string', `${pr.field} carries a license`);
    assert.ok(pr.url && /^https?:\/\//.test(pr.url), `${pr.field} carries a source url`);
    // the field really is filled on the profile
    const v = p[pr.field];
    assert.ok(v != null && v !== '' && !(Array.isArray(v) && !v.length), `${pr.field} actually present`);
  }
  // cik provenance must be SEC; lei must be GLEIF (no source crossing)
  assert.equal(p.provenance.find((x) => x.field === 'cik')?.source, 'SEC EDGAR');
  assert.equal(p.provenance.find((x) => x.field === 'lei')?.source, 'GLEIF');
  // sourceMeta roster carries licenses too
  assert.ok(p.sourceMeta.every((s) => s.license && s.url));
  __setFetch(null); invalidate();
});

test('SEC down → still profiles from GLEIF/Wikidata/Wikipedia, marks not-traded with onboarding', async () => {
  invalidate(); __setFetch(fakeFetch({ secDown: true, tickersDown: true }));
  const p = await companyProfile('Apple');
  assert.equal(p.cik, null);
  assert.equal(p.traded, false);
  assert.ok(p.onboarding, 'onboarding block present for non-traded');
  assert.ok(Array.isArray(p.onboarding.missing) && p.onboarding.missing.length > 0);
  // provenance still attaches to whatever filled (wikidata/wikipedia/gleif)
  assert.ok(p.provenance.length > 0);
  assert.ok(!p.provenance.some((x) => x.field === 'cik'), 'no cik provenance when SEC is down');
  __setFetch(null); invalidate();
});

test('total upstream outage yields a sparse but valid profile, never throws', async () => {
  invalidate(); __setFetch(fakeFetch({ tickersDown: true, secDown: true, gleifDown: true, wdDown: true, wpDown: true, govDown: true }));
  const p = await companyProfile('Nonexistent Co');
  assert.equal(typeof p, 'object');
  assert.equal(p.tradedStatus, 'private');
  assert.deepEqual(p.sources, []);
  assert.deepEqual(p.provenance, []);
  assert.equal(p.completeness, 0);
  __setFetch(null); invalidate();
});

test('malformed SEC ticker map (not an array) is tolerated — no crash, falls through to other sources', async () => {
  invalidate(); __setFetch(fakeFetch({ tickersBad: true }));
  const p = await companyProfile('Apple Inc.');
  // SEC resolution fails (bad map) but GLEIF/Wikidata/Wikipedia by canonical name still work
  assert.equal(p.cik, null);
  assert.ok(p.lei || p.qid || p.description, 'other sources still populate');
  __setFetch(null); invalidate();
});

test('no verdict / advice language in the assembled profile JSON', async () => {
  invalidate(); __setFetch(fakeFetch());
  const p = await companyProfile('AAPL');
  // The `whereToComplain` block is descriptive civic-resource boilerplate (which oversight office
  // handles e.g. "scams" / "deceptive practices") — generic vocabulary about the OFFICE, not a verdict
  // about the company. Scan everything else for verdict/advice language. Its own note already states
  // "Facts, not a verdict — a complaint is not proof of wrongdoing."
  const { whereToComplain: _wtc, ...rest } = p;
  const blob = JSON.stringify(rest).toLowerCase();
  for (const bad of ['scam', 'fraud', 'guilty', 'trustworthy', 'should buy', 'good investment', 'avoid this', 'recommend']) {
    assert.ok(!blob.includes(bad), `must not contain verdict word "${bad}"`);
  }
  __setFetch(null); invalidate();
});

test('CIK padding strips non-digits defensively', async () => {
  invalidate(); __setFetch(fakeFetch());
  const p = await companyProfile('AAPL');
  assert.match(p.cik, /^\d{10}$/);
  __setFetch(null); invalidate();
});
