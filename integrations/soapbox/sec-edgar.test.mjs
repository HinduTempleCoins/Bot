// sec-edgar.test.mjs — offline tests for the SEC EDGAR reader. Injects a fake fetch that returns canned
// EDGAR JSON keyed by URL substring, and that RECORDS request headers so we can assert the SEC-required
// descriptive User-Agent is set on every request. No network, no keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, lookupCik, recentFilings, companyFacts, fullTextSearch,
  summary, renderPage, dataNote, esc,
} from './sec-edgar.mjs';

const ok = (payload) => ({ ok: true, status: 200, json: async () => payload });

// route a fake fetch by URL substring → canned payload; also capture seen requests (url + headers).
function mockFetch(routes, seen) {
  return async (url, opts = {}) => {
    if (seen) seen.push({ url: String(url), headers: opts.headers || {} });
    const u = String(url);
    for (const [needle, payload] of Object.entries(routes)) {
      if (u.includes(needle)) return ok(payload);
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

const TICKERS = {
  '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  '1': { cik_str: 789019, ticker: 'MSFT', title: 'Microsoft Corporation' },
};

const SUBMISSIONS = {
  cik: '0000320193',
  name: 'Apple Inc.',
  filings: {
    recent: {
      accessionNumber: ['0000320193-23-000106', '0000320193-23-000077', '0000320193-23-000064'],
      form: ['10-K', '10-Q', '8-K'],
      filingDate: ['2023-11-03', '2023-08-04', '2023-05-05'],
      reportDate: ['2023-09-30', '2023-07-01', ''],
      primaryDocument: ['aapl-20230930.htm', 'aapl-20230701.htm', 'aapl-8k.htm'],
      primaryDocDescription: ['10-K', '10-Q', '8-K'],
    },
  },
};

const CONCEPT = {
  cik: 320193,
  taxonomy: 'us-gaap',
  tag: 'Revenues',
  units: {
    USD: [
      { end: '2021-09-25', val: 365817000000, fy: 2021, fp: 'FY', form: '10-K', filed: '2021-10-29' },
      { end: '2022-09-24', val: 394328000000, fy: 2022, fp: 'FY', form: '10-K', filed: '2022-10-28' },
      { end: '2023-09-30', val: 383285000000, fy: 2023, fp: 'FY', form: '10-K', filed: '2023-11-03' },
    ],
  },
};

const FTS_RESULT = {
  hits: {
    total: { value: 2 },
    hits: [
      {
        _id: '0000320193-23-000106:aapl-20230930.htm',
        _source: { file_type: '10-K', file_date: '2023-11-03', cik: ['0000320193'], display_names: ['Apple Inc. (AAPL) (CIK 0000320193)'] },
      },
      {
        _id: '0000789019-23-000010:msft-10q.htm',
        _source: { root_form: '10-Q', file_date: '2023-10-24', cik: '0000789019', display_names: 'Microsoft Corp (MSFT)' },
      },
    ],
  },
};

test('lookupCik resolves a ticker to its padded CIK', async () => {
  __setFetch(mockFetch({ company_tickers: TICKERS }));
  const r = await lookupCik('aapl');
  __setFetch();
  assert.equal(r.cik, '0000320193');
  assert.equal(r.ticker, 'AAPL');
  assert.equal(r.title, 'Apple Inc.');
});

test('lookupCik soft-fails to null for an unknown ticker', async () => {
  __setFetch(mockFetch({ company_tickers: TICKERS }));
  const r = await lookupCik('NOPE');
  __setFetch();
  assert.equal(r, null);
});

test('lookupCik soft-fails to null on fetch error', async () => {
  __setFetch(async () => { throw new Error('network'); });
  const r = await lookupCik('AAPL');
  __setFetch();
  assert.equal(r, null);
});

test('recentFilings normalizes the column-oriented submissions block', async () => {
  __setFetch(mockFetch({ submissions: SUBMISSIONS }));
  const rows = await recentFilings({ cik: '320193' });
  __setFetch();
  assert.equal(rows.length, 3);
  assert.equal(rows[0].form, '10-K');
  assert.equal(rows[0].filingDate, '2023-11-03');
  assert.equal(rows[0].accessionNo, '0000320193-23-000106');
  assert.equal(rows[0].primaryDoc, 'aapl-20230930.htm');
  // URL uses bare CIK + dash-stripped accession + primary doc.
  assert.equal(rows[0].url, 'https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm');
});

test('recentFilings filters by form type', async () => {
  __setFetch(mockFetch({ submissions: SUBMISSIONS }));
  const rows = await recentFilings({ cik: '320193', type: '10-Q' });
  __setFetch();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].form, '10-Q');
});

test('recentFilings soft-fails to [] on non-ok', async () => {
  __setFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  const rows = await recentFilings({ cik: '320193' });
  __setFetch();
  assert.deepEqual(rows, []);
});

test('companyFacts returns a normalized fact series (newest first)', async () => {
  __setFetch(mockFetch({ companyconcept: CONCEPT }));
  const rows = await companyFacts({ cik: '320193', concept: 'Revenues' });
  __setFetch();
  assert.equal(rows.length, 3);
  assert.equal(rows[0].end, '2023-09-30'); // newest first
  assert.equal(rows[0].val, 383285000000);
  assert.equal(rows[0].fy, 2023);
  assert.equal(rows[0].form, '10-K');
});

test('companyFacts falls back to companyfacts blob when companyconcept missing', async () => {
  const BLOB = { facts: { 'us-gaap': { NetIncomeLoss: { units: { USD: [{ end: '2023-09-30', val: 96995000000, fy: 2023, fp: 'FY', form: '10-K' }] } } } } };
  __setFetch(mockFetch({ companyfacts: BLOB })); // companyconcept route 404s → fallback
  const rows = await companyFacts({ cik: '320193', concept: 'NetIncomeLoss' });
  __setFetch();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].val, 96995000000);
});

test('companyFacts soft-fails to [] on error', async () => {
  __setFetch(async () => { throw new Error('x'); });
  const rows = await companyFacts({ cik: '320193', concept: 'Revenues' });
  __setFetch();
  assert.deepEqual(rows, []);
});

test('fullTextSearch normalizes EDGAR FTS hits', async () => {
  __setFetch(mockFetch({ 'search-index': FTS_RESULT }));
  const rows = await fullTextSearch({ q: 'climate risk', forms: '10-K' });
  __setFetch();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].form, '10-K');
  assert.equal(rows[0].accessionNo, '0000320193-23-000106');
  assert.equal(rows[0].cik, '0000320193');
  assert.equal(rows[0].companyName, 'Apple Inc. (AAPL) (CIK 0000320193)');
  assert.equal(rows[0].url, 'https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm');
});

test('fullTextSearch soft-fails to [] on empty query', async () => {
  const rows = await fullTextSearch({ q: '' });
  assert.deepEqual(rows, []);
});

test('summary picks latest 10-K, 10-Q, and a headline fact', async () => {
  __setFetch(mockFetch({ submissions: SUBMISSIONS, companyconcept: CONCEPT }));
  const s = await summary({ cik: '320193' });
  __setFetch();
  assert.equal(s.latest10K.form, '10-K');
  assert.equal(s.latest10Q.form, '10-Q');
  assert.equal(s.headlineFact.concept, 'Revenues');
  assert.equal(s.headlineFact.val, 383285000000);
  assert.ok(s.asOf);
});

test('the SEC descriptive User-Agent is set on every request', async () => {
  const seen = [];
  __setFetch(mockFetch({ company_tickers: TICKERS, submissions: SUBMISSIONS, companyconcept: CONCEPT, 'search-index': FTS_RESULT }, seen));
  await lookupCik('AAPL');
  await recentFilings({ cik: '320193' });
  await companyFacts({ cik: '320193', concept: 'Revenues' });
  await fullTextSearch({ q: 'risk' });
  __setFetch();
  assert.ok(seen.length >= 4);
  for (const req of seen) {
    const ua = req.headers['User-Agent'] || req.headers['user-agent'];
    assert.ok(ua, `missing User-Agent for ${req.url}`);
    assert.match(ua, /SoapBox/i);
    assert.match(ua, /https?:\/\//); // contact URL present
    assert.ok(!/@/.test(ua), 'UA must not contain a personal email');
  }
});

test('renderPage escapes a malicious filing title', () => {
  const html = renderPage({
    company: 'Evil & Co "Holdings"',
    cik: '0000320193',
    filings: [
      { form: '10-K', filingDate: '2023-11-03', accessionNo: '0000320193-23-000106', primaryDoc: 'doc.htm',
        primaryDescription: '<script>alert(1)</script>', url: 'https://x/"><img src=x onerror=alert(1)>' },
    ],
    headlineFact: { concept: 'Revenues', val: 383285000000, end: '2023-09-30' },
    asOf: '2026-06-03',
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&amp;')); // the & in Evil & Co
  assert.ok(html.includes('&quot;'));
  assert.ok(!html.includes('onerror=alert(1)>')); // the raw injected attribute must be escaped
  assert.ok(html.includes('SEC Filings'));
});

test('renderPage handles empty data without throwing', () => {
  const html = renderPage({});
  assert.equal(typeof html, 'string');
  assert.ok(html.includes('<section'));
  assert.ok(html.includes('No filings found'));
});

test('dataNote has source + not-advice', () => {
  const note = dataNote('2026-06-03');
  assert.ok(note.includes('SEC EDGAR'));
  assert.ok(note.includes('as of 2026-06-03'));
  assert.ok(note.includes('not investment advice'));
  const def = dataNote();
  assert.ok(def.includes('as of'));
});

test('esc escapes all five characters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});
