// company-profiles.test.js — the Crunchbase-style company-profile assembler + its Clarity-style
// confidence/data-quality block (task #195), fully offline via an injected fetch that simulates the
// keyless public-record sources (SEC EDGAR, GLEIF, Wikidata, Wikipedia, USAspending).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyProfile, profileConfidence, __setFetch } from './company-profiles.mjs';
import { invalidate } from './cache.mjs';

const ok = (json) => ({ ok: true, status: 200, json: async () => json });
const notFound = () => ({ ok: false, status: 404, json: async () => ({}) });

// A consistent multi-source fixture for Apple: SEC + GLEIF + Wikidata + Wikipedia + USAspending all
// agree. Routed by URL substring. opts let individual tests perturb a source (contradiction / outlier).
function fixture(opts = {}) {
  const wdEntity = {
    entities: { Q312: {
      descriptions: { en: { value: 'American technology company' } },
      labels: { en: { value: 'Apple' } },
      claims: {
        P571: [{ mainsnak: { datavalue: { value: { time: '+' + (opts.founded || '1976') + '-04-01T00:00:00Z' } } } }],
        P452: [{ mainsnak: { datavalue: { value: { id: 'Q7397' } } } }],   // industry
        P159: [{ mainsnak: { datavalue: { value: { id: 'Q1090' } } } }],   // hq
        P856: [{ mainsnak: { datavalue: { value: 'https://www.apple.com' } } }],
        P169: [{ mainsnak: { datavalue: { value: { id: 'Q19837' } } } }],  // ceo
        P17:  [{ mainsnak: { datavalue: { value: { id: opts.wdCountryId || 'Q30' } } } }], // country
        P1128:[{ mainsnak: { datavalue: { value: { amount: '+' + (opts.employees || '164000') } } } }],
        P249: [{ mainsnak: { datavalue: { value: opts.wdTicker || 'AAPL' } } }],
      },
    } },
  };
  // label-resolution entities (industry/hq/ceo/country) — return a label for any Special:EntityData call.
  const wdLabel = (qid) => ok({ entities: { [qid]: { labels: { en: { value: {
    Q7397: 'software', Q1090: 'Cupertino', Q19837: 'Tim Cook', Q30: 'United States', Q142: 'France',
  }[qid] || qid } } } } });

  return async (url) => {
    const u = String(url);
    if (u.includes('company_tickers.json')) return ok({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } });
    if (u.includes('/submissions/CIK')) return ok({
      name: opts.secName || 'Apple Inc.', tickers: ['AAPL'], exchanges: ['Nasdaq'], sic: '3571',
      sicDescription: 'Electronic Computers', ein: '942404110', fiscalYearEnd: '0930',
      stateOfIncorporation: 'CA', website: null,
      filings: { recent: { form: ['10-K', '8-K'], filingDate: ['2025-11-01', '2025-10-15'], reportDate: ['2025-09-30', ''], primaryDocument: ['aapl.htm', '8k.htm'], accessionNumber: ['0000320193-25-000001', '0000320193-25-000002'] } },
    });
    if (u.includes('api.gleif.org')) return ok({ data: [{ id: 'HWUPKR0MPOU8FGXBT394',
      attributes: { entity: { legalName: { name: opts.gleifName || 'Apple Inc.' }, jurisdiction: 'US-CA',
        legalForm: { id: 'XTIQ' }, status: 'ACTIVE', headquartersAddress: { city: 'Cupertino', region: 'US-CA', country: opts.gleifCountry || 'US' } } } }] });
    if (u.includes('wbsearchentities')) return ok({ search: [{ id: 'Q312' }] });
    if (u.includes('Special:EntityData/Q312')) return ok(wdEntity);
    if (u.includes('Special:EntityData/')) { const m = u.match(/Special:EntityData\/(Q\d+)/); return wdLabel(m[1]); }
    if (u.includes('rest_v1/page/summary')) return ok({ type: 'standard', extract: 'Apple Inc. is an American multinational technology company.', title: 'Apple_Inc.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Apple_Inc.' } } });
    if (u.includes('usaspending.gov')) return ok({ results: [{ 'Award ID': 'C1', 'Recipient Name': 'APPLE INC.', 'Award Amount': 1000000, 'Awarding Agency': 'GSA', 'Start Date': '2024-01-01' }] });
    return notFound();
  };
}

test('companyProfile assembles a dossier from all sources', async () => {
  invalidate(); __setFetch(fixture());
  const p = await companyProfile('apple');
  assert.equal(p.ticker, 'AAPL');
  assert.equal(p.cik, '0000320193');
  assert.equal(p.lei, 'HWUPKR0MPOU8FGXBT394');
  assert.equal(p.founded, '1976');
  assert.equal(p.ceo, 'Tim Cook');
  assert.equal(p.employees, 164000);
  assert.equal(p.tradedStatus, 'public');
  assert.ok(p.traded);
  assert.ok(p.sources.includes('SEC EDGAR') && p.sources.includes('GLEIF') && p.sources.includes('Wikidata'));
  assert.ok(p.secFilings.length >= 2);
  assert.ok(p.completeness >= 70, `completeness ${p.completeness}`);
  __setFetch(null); invalidate();
});

test('companyProfile carries a confidence block: high + confident when sources agree', async () => {
  invalidate(); __setFetch(fixture());
  const p = await companyProfile('apple');
  assert.ok(p.confidence, 'confidence present');
  assert.ok(p.confidence.confident, 'all sources agree → confident');
  assert.ok(p.confidence.score >= 70, `score ${p.confidence.score}`);
  assert.equal(p.confidence.flags.length, 0, 'no contradiction flags');
  assert.ok(p.confidence.sources >= 4);
  __setFetch(null); invalidate();
});

test('contradicting sources lower confidence and surface a flag (never edits the data)', async () => {
  invalidate();
  // GLEIF says the HQ country is France while Wikidata says US → a cross-source contradiction.
  __setFetch(fixture({ gleifCountry: 'FR', wdCountryId: 'Q30' }));
  const p = await companyProfile('apple');
  assert.equal(p.confidence.confident, false, 'contradiction → not confident');
  assert.ok(p.confidence.flags.some((f) => /headquarters country differs/.test(f)), 'flag surfaced');
  // the raw conflicting values are STILL on the profile — we flag, we don't silently overwrite.
  assert.ok(p.country != null);
  __setFetch(null); invalidate();
});

test('an out-of-range founding year is flagged as an outlier', async () => {
  invalidate(); __setFetch(fixture({ founded: '1200' })); // implausibly old for a traded company
  const p = await companyProfile('apple');
  assert.ok(p.confidence.flags.some((f) => /founding year/.test(f)), 'founding-year outlier flagged');
  __setFetch(null); invalidate();
});

test('profileConfidence: a single private-company source is not confident', () => {
  const c = profileConfidence({ sources: ['Wikidata'], founded: '2020', employees: 50 });
  assert.equal(c.confident, false, '<2 sources → unconfirmed');
  assert.ok(c.score < 70);
});

test('profileConfidence: ≥2 sources, nothing to cross-check → confident, neutral consistency', () => {
  const c = profileConfidence({ sources: ['SEC EDGAR', 'Wikipedia'], founded: '1999', employees: 1000 });
  assert.equal(c.confident, true);
  assert.equal(c.crossChecks, 0);
});

test('private company (not in SEC) gets an onboarding block + lower confidence', async () => {
  invalidate();
  // SEC ticker map has no match for this name; everything else 404s too → minimal sources.
  __setFetch(async (url) => {
    const u = String(url);
    if (u.includes('company_tickers.json')) return ok({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } });
    if (u.includes('wbsearchentities')) return ok({ search: [] });
    return notFound();
  });
  const p = await companyProfile('Some Private LLC');
  assert.equal(p.tradedStatus, 'private');
  assert.equal(p.traded, false);
  assert.ok(p.onboarding && Array.isArray(p.onboarding.missing) && p.onboarding.missing.length > 0);
  assert.ok(p.onboarding.melekPath.includes('MELEK'));
  assert.equal(p.confidence.confident, false);
  __setFetch(null); invalidate();
});
