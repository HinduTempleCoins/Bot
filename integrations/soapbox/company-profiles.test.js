// company-profiles.test.js — the Crunchbase-style company-profile assembler + its Clarity-style
// confidence/data-quality block (task #195), fully offline via an injected fetch that simulates the
// keyless public-record sources (SEC EDGAR, GLEIF, Wikidata, Wikipedia, USAspending).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyProfile, profileConfidence, __setFetch } from './company-profiles.mjs';
import { __setFetch as __setSecFetch } from './sec-edgar.mjs';
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
    if (u.includes('/submissions/CIK')) {
      // 12 filings so we can prove the cap was raised above the old hard 8.
      const N = opts.filingCount || 12;
      const form = [], filingDate = [], reportDate = [], primaryDocument = [], accessionNumber = [];
      for (let i = 0; i < N; i++) {
        form.push(i % 2 ? '8-K' : '10-Q'); filingDate.push('2025-0' + (1 + (i % 9)) + '-01'); reportDate.push('');
        primaryDocument.push('doc' + i + '.htm'); accessionNumber.push('0000320193-25-0000' + (10 + i));
      }
      return ok({
        name: opts.secName || 'Apple Inc.', tickers: ['AAPL'], exchanges: ['Nasdaq'], sic: '3571',
        sicDescription: opts.sicDescription || 'Electronic Computers', ein: '942404110', fiscalYearEnd: '0930',
        stateOfIncorporation: 'CA', website: null,
        filings: { recent: { form, filingDate, reportDate, primaryDocument, accessionNumber } },
      });
    }
    // SEC XBRL companyconcept (headline financials via sec-edgar.companyFacts)
    if (u.includes('/api/xbrl/companyconcept/') && /Revenues\.json/.test(u)) return ok({
      units: { USD: [{ end: '2025-09-30', val: 391035000000, fy: 2025, fp: 'FY', form: '10-K', filed: '2025-11-01' }] },
    });
    if (u.includes('/api/xbrl/companyconcept/') && /NetIncomeLoss\.json/.test(u)) return ok({
      units: { USD: [{ end: '2025-09-30', val: 99803000000, fy: 2025, fp: 'FY', form: '10-K', filed: '2025-11-01' }] },
    });
    if (u.includes('api.gleif.org')) return ok({ data: [{ id: 'HWUPKR0MPOU8FGXBT394',
      attributes: { entity: { legalName: { name: opts.gleifName || 'Apple Inc.' }, jurisdiction: 'US-CA',
        legalForm: { id: 'XTIQ' }, status: 'ACTIVE', headquartersAddress: { city: 'Cupertino', region: 'US-CA', country: opts.gleifCountry || 'US' } } } }] });
    if (u.includes('wbsearchentities')) return ok({ search: [{ id: 'Q312' }] });
    if (u.includes('Special:EntityData/Q312')) return ok(wdEntity);
    if (u.includes('Special:EntityData/')) { const m = u.match(/Special:EntityData\/(Q\d+)/); return wdLabel(m[1]); }
    if (u.includes('rest_v1/page/summary')) return ok({ type: 'standard', extract: 'Apple Inc. is an American multinational technology company.', title: 'Apple_Inc.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Apple_Inc.' } } });
    if (u.includes('usaspending.gov')) return ok({
      results: [{ 'Award ID': 'C1', 'Recipient Name': 'APPLE INC.', 'Award Amount': 1000000, 'Awarding Agency': 'GSA', 'Start Date': '2024-01-01' }],
      page_metadata: { total: 4217 }, // the TRUE match count, far larger than the ≤5 page sample
    });
    return notFound();
  };
}

// route BOTH module fetches (company-profiles + sec-edgar's companyFacts) through one fixture.
function useFixture(opts) { const f = fixture(opts); __setFetch(f); __setSecFetch(f); return f; }
function clearFixtures() { __setFetch(null); __setSecFetch(null); }

test('companyProfile assembles a dossier from all sources', async () => {
  invalidate(); useFixture();
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
  clearFixtures(); invalidate();
});

test('companyProfile carries a confidence block: high + confident when sources agree', async () => {
  invalidate(); useFixture();
  const p = await companyProfile('apple');
  assert.ok(p.confidence, 'confidence present');
  assert.ok(p.confidence.confident, 'all sources agree → confident');
  assert.ok(p.confidence.score >= 70, `score ${p.confidence.score}`);
  assert.equal(p.confidence.flags.length, 0, 'no contradiction flags');
  assert.ok(p.confidence.sources >= 4);
  clearFixtures(); invalidate();
});

test('contradicting sources lower confidence and surface a flag (never edits the data)', async () => {
  invalidate();
  // GLEIF says the HQ country is France while Wikidata says US → a cross-source contradiction.
  useFixture({ gleifCountry: 'FR', wdCountryId: 'Q30' });
  const p = await companyProfile('apple');
  assert.equal(p.confidence.confident, false, 'contradiction → not confident');
  assert.ok(p.confidence.flags.some((f) => /headquarters country differs/.test(f)), 'flag surfaced');
  // the raw conflicting values are STILL on the profile — we flag, we don't silently overwrite.
  assert.ok(p.country != null);
  clearFixtures(); invalidate();
});

test('an out-of-range founding year is flagged as an outlier', async () => {
  invalidate(); useFixture({ founded: '1200' }); // implausibly old for a traded company
  const p = await companyProfile('apple');
  assert.ok(p.confidence.flags.some((f) => /founding year/.test(f)), 'founding-year outlier flagged');
  clearFixtures(); invalidate();
});

// ── A5 data-loss fixes ──────────────────────────────────────────────────────────────────────────
test('A5: SEC filings list is no longer hard-capped at 8 (cap raised to 25)', async () => {
  invalidate(); useFixture({ filingCount: 12 });
  const p = await companyProfile('apple');
  assert.ok(p.secFilings.length > 8, `expected >8 filings, got ${p.secFilings.length}`);
  assert.equal(p.secFilings.length, 12);
  clearFixtures(); invalidate();
});

test('A5: USAspending carries sampleCount AND the real awardTotal (page_metadata.total)', async () => {
  invalidate(); useFixture();
  const p = await companyProfile('apple');
  const c = p.govContracts?.contracts;
  assert.ok(c, 'contracts slice present');
  assert.equal(c.sampleCount, 1, 'sampleCount = rows actually fetched (≤5)');
  assert.equal(c.awardTotal, 4217, 'awardTotal = page_metadata.total, the true match count');
  assert.notEqual(c.sampleCount, c.awardTotal, 'sample size and true total are distinct');
  clearFixtures(); invalidate();
});

test('A5: headline financials (XBRL Revenues/NetIncome) pulled via sec-edgar.companyFacts, soft-fail', async () => {
  invalidate(); useFixture();
  const p = await companyProfile('apple');
  assert.ok(p.financials, 'financials block present');
  assert.equal(p.financials.revenue.value, 391035000000);
  assert.equal(p.financials.netIncome.value, 99803000000);
  clearFixtures(); invalidate();
});

// ── BBB / consumer-protection layer (#288) ────────────────────────────────────────────────────────
test('BBB layer: a known industry routes to the right oversight office(s) with contact fields', async () => {
  invalidate();
  // Electronic Computers SIC → product-safety routing (CPSC etc.); each office carries file-here + phone.
  useFixture({ sicDescription: 'Electronic Computers' });
  const p = await companyProfile('apple');
  assert.ok(p.whereToComplain, 'whereToComplain block present');
  assert.ok(Array.isArray(p.whereToComplain.offices) && p.whereToComplain.offices.length > 0, 'at least one office');
  const o = p.whereToComplain.offices[0];
  assert.ok(o.name, 'office has a name');
  assert.ok('filingUrl' in o, 'office carries its own file-here URL');
  assert.ok('phone' in o, 'office carries a phone field');
  clearFixtures(); invalidate();
});

test('BBB layer: a financial company routes to a money/financial oversight office (CFPB)', async () => {
  invalidate();
  useFixture({ sicDescription: 'National Commercial Banks' });
  const p = await companyProfile('apple');
  const names = (p.whereToComplain.offices || []).map((o) => o.name).join(' | ');
  assert.match(names, /Consumer Financial Protection Bureau|Attorney General|Federal Trade Commission/);
  clearFixtures(); invalidate();
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
