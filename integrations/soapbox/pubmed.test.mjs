// pubmed.test.mjs — offline tests for the biomedical-literature reader. Injects a fake fetch that
// returns canned NCBI E-utilities JSON (esearch + esummary) and ClinicalTrials.gov v2 JSON, routed by
// URL substring. No network, no keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, NCBI_API_KEY_ENV, ENDPOINTS, searchPubmed, trials,
  articleDetail, summary, renderPage, dataNote, esc,
} from './pubmed.mjs';
import { invalidate } from './cache.mjs';

// canned esearch result — a list of PMIDs.
const ESEARCH = { esearchresult: { count: '2', idlist: ['11111111', '22222222'] } };

// canned esummary result — numeric-keyed records + a uids order array (the E-utilities shape).
const ESUMMARY = {
  result: {
    uids: ['11111111', '22222222'],
    '11111111': {
      uid: '11111111',
      title: 'Psilocybin for treatment-resistant depression',
      authors: [{ name: 'Carhart-Harris RL' }, { name: 'Goodwin GM' }],
      fulljournalname: 'New England Journal of Medicine',
      source: 'N Engl J Med',
      pubdate: '2024 May 3',
      volume: '390', issue: '18', pages: '1701-1709',
      articleids: [{ idtype: 'doi', value: '10.1056/NEJMoa2032994' }],
      pubtype: ['Randomized Controlled Trial', 'Journal Article'],
    },
    '22222222': {
      uid: '22222222',
      title: 'Microdosing psychedelics: a systematic review',
      authors: [{ name: 'Smith J' }],
      fulljournalname: 'Journal of Psychopharmacology',
      pubdate: '2023',
    },
  },
};

// canned ClinicalTrials.gov v2 studies payload.
const CTGOV = {
  studies: [
    {
      protocolSection: {
        identificationModule: { nctId: 'NCT01234567', briefTitle: 'Psilocybin in Major Depression' },
        statusModule: { overallStatus: 'RECRUITING' },
        designModule: { phases: ['PHASE2'] },
        conditionsModule: { conditions: ['Major Depressive Disorder', 'Depression'] },
      },
    },
    {
      protocolSection: {
        identificationModule: { nctId: 'NCT07654321', briefTitle: 'Psilocybin Long-Term Follow-up' },
        statusModule: { overallStatus: 'COMPLETED' },
        designModule: { phases: ['PHASE1'] },
        conditionsModule: { conditions: ['Depression'] },
      },
    },
  ],
};

// route a fake fetch by URL substring → canned JSON. Records last URL + headers seen.
let lastUrl = null, lastHeaders = null;
function mockFetch(routes) {
  return async (url, opts) => {
    lastUrl = String(url);
    lastHeaders = (opts && opts.headers) || {};
    for (const [needle, body] of Object.entries(routes)) {
      if (lastUrl.includes(needle)) return { ok: true, status: 200, json: async () => body };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}
// fetch that throws — proves the soft-fail catch path.
const throwingFetch = async () => { throw new Error('network down'); };

const reset = () => { invalidate(); lastUrl = null; lastHeaders = null; };

test('searchPubmed does esearch then esummary and normalizes', async () => {
  reset();
  __setFetch(mockFetch({ 'esearch.fcgi': ESEARCH, 'esummary.fcgi': ESUMMARY }));
  const rows = await searchPubmed('psilocybin depression', { limit: 5 });
  assert.equal(rows.length, 2);
  const a = rows[0];
  assert.equal(a.pmid, '11111111');
  assert.equal(a.title, 'Psilocybin for treatment-resistant depression');
  assert.deepEqual(a.authors, ['Carhart-Harris RL', 'Goodwin GM']);
  assert.equal(a.journal, 'New England Journal of Medicine');
  assert.equal(a.year, 2024);
  assert.equal(a.url, 'https://pubmed.ncbi.nlm.nih.gov/11111111/');
  __setFetch();
});

test('searchPubmed soft-fails to [] (no PMIDs, 404, throw, empty query)', async () => {
  reset();
  __setFetch(mockFetch({ 'esearch.fcgi': { esearchresult: { idlist: [] } } }));
  assert.deepEqual(await searchPubmed('nothing'), []);
  reset();
  __setFetch(mockFetch({})); // esearch 404s
  assert.deepEqual(await searchPubmed('boom'), []);
  reset();
  __setFetch(throwingFetch);
  assert.deepEqual(await searchPubmed('throws'), []);
  reset();
  assert.deepEqual(await searchPubmed(''), []); // no I/O for empty query
  __setFetch();
});

test('trials normalizes ClinicalTrials.gov v2 + filters by status + soft-fails', async () => {
  reset();
  __setFetch(mockFetch({ '/studies': CTGOV }));
  const all = await trials({ condition: 'depression', limit: 10 });
  assert.equal(all.length, 2);
  const t = all[0];
  assert.equal(t.nctId, 'NCT01234567');
  assert.equal(t.title, 'Psilocybin in Major Depression');
  assert.equal(t.status, 'RECRUITING');
  assert.deepEqual(t.phase, ['PHASE2']);
  assert.deepEqual(t.conditions, ['Major Depressive Disorder', 'Depression']);
  assert.equal(t.url, 'https://clinicaltrials.gov/study/NCT01234567');

  reset();
  __setFetch(mockFetch({ '/studies': CTGOV }));
  const rec = await trials({ condition: 'depression', status: 'recruiting' });
  assert.equal(rec.length, 1);
  assert.equal(rec[0].nctId, 'NCT01234567');

  reset();
  __setFetch(mockFetch({})); // 404
  assert.deepEqual(await trials({ condition: 'depression' }), []);
  reset();
  __setFetch(throwingFetch);
  assert.deepEqual(await trials({ condition: 'depression' }), []);
  reset();
  assert.deepEqual(await trials({}), []); // no condition
  __setFetch();
});

test('articleDetail returns a fuller single record', async () => {
  reset();
  __setFetch(mockFetch({ 'esummary.fcgi': ESUMMARY }));
  const d = await articleDetail('11111111');
  assert.ok(d, 'returns a record');
  assert.equal(d.pmid, '11111111');
  assert.equal(d.doi, '10.1056/NEJMoa2032994');
  assert.equal(d.doiUrl, 'https://doi.org/10.1056/NEJMoa2032994');
  assert.equal(d.volume, '390');
  assert.equal(d.pages, '1701-1709');
  assert.ok(d.pubTypes.includes('Randomized Controlled Trial'));
  reset();
  __setFetch(mockFetch({})); // 404
  assert.equal(await articleDetail('99999999'), null);
  assert.equal(await articleDetail(''), null);
  __setFetch();
});

test('articleDetail fetches the abstract via efetch and includes it', async () => {
  reset();
  const ABSTRACT = 'BACKGROUND: Psilocybin shows promise. METHODS: An RCT of 233 patients. RESULTS: '
    + 'A single 25-mg dose reduced depression scores at week 3. CONCLUSIONS: Further trials are warranted.';
  // route esummary → JSON, efetch → plain text (the abstract).
  __setFetch(async (url) => {
    const u = String(url);
    if (u.includes('efetch.fcgi')) return { ok: true, status: 200, json: async () => ({}), text: async () => ABSTRACT };
    if (u.includes('esummary.fcgi')) return { ok: true, status: 200, json: async () => ESUMMARY };
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  });
  const d = await articleDetail('11111111');
  assert.ok(d, 'returns a record');
  assert.equal(d.abstract, ABSTRACT, 'abstract captured from efetch');
  assert.equal(d.title, 'Psilocybin for treatment-resistant depression', 'metadata still present');
  __setFetch();
});

test('articleDetail soft-fails the abstract to null but keeps metadata when efetch is unavailable', async () => {
  reset();
  // esummary works; efetch 404s → abstract null, record still returned.
  __setFetch(async (url) => {
    const u = String(url);
    if (u.includes('efetch.fcgi')) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    if (u.includes('esummary.fcgi')) return { ok: true, status: 200, json: async () => ESUMMARY };
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  });
  const d = await articleDetail('11111111');
  assert.ok(d, 'still returns a record');
  assert.equal(d.abstract, null, 'abstract soft-fails to null');
  assert.equal(d.pmid, '11111111');
  __setFetch();
});

test('trials pulls briefSummary + eligibilityCriteria from the already-fetched protocolSection', async () => {
  reset();
  const CTGOV_RICH = {
    studies: [{
      protocolSection: {
        identificationModule: { nctId: 'NCT09990001', briefTitle: 'Psilocybin RCT' },
        statusModule: { overallStatus: 'RECRUITING' },
        designModule: { phases: ['PHASE2'] },
        conditionsModule: { conditions: ['Depression'] },
        descriptionModule: { briefSummary: 'A randomized trial of psilocybin for depression.' },
        eligibilityModule: { eligibilityCriteria: 'Inclusion: adults 18-65 with MDD. Exclusion: psychosis.' },
      },
    }],
  };
  __setFetch(mockFetch({ '/studies': CTGOV_RICH }));
  const rows = await trials({ condition: 'depression' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].briefSummary, 'A randomized trial of psilocybin for depression.');
  assert.equal(rows[0].eligibilityCriteria, 'Inclusion: adults 18-65 with MDD. Exclusion: psychosis.');
  // absent modules → null, never undefined
  reset();
  __setFetch(mockFetch({ '/studies': CTGOV }));
  const plain = await trials({ condition: 'depression' });
  assert.equal(plain[0].briefSummary, null);
  assert.equal(plain[0].eligibilityCriteria, null);
  __setFetch();
});

test('summary tallies counts by year and trial status', () => {
  const articles = [
    { pmid: '1', year: 2024 }, { pmid: '2', year: 2023 }, { pmid: '3', year: 2024 }, { pmid: '4', year: null },
  ];
  const trialRows = [
    { nctId: 'A', status: 'RECRUITING' }, { nctId: 'B', status: 'COMPLETED' }, { nctId: 'C', status: 'RECRUITING' },
  ];
  const s = summary({ articles, trials: trialRows });
  assert.equal(s.articleCount, 4);
  assert.equal(s.trialCount, 3);
  assert.equal(s.byYear['2024'], 2);
  assert.equal(s.byYear['2023'], 1);
  assert.equal(s.byYear['unknown'], 1);
  assert.equal(s.byStatus['RECRUITING'], 2);
  assert.equal(s.byStatus['COMPLETED'], 1);
  assert.equal(s.latestYear, 2024);
  assert.equal(s.earliestYear, 2023);
  assert.ok(s.asOf, 'has an as-of timestamp');
  // empty input is well-formed, not a throw
  const empty = summary({});
  assert.equal(empty.articleCount, 0);
  assert.equal(empty.trialCount, 0);
});

test('renderPage escapes a malicious title', () => {
  const evil = '<script>alert("xss")</script>';
  const html = renderPage({
    articles: [{ pmid: '1', title: evil, authors: [evil], journal: evil, year: 2024, url: 'https://x/' + evil }],
    trials: [{ nctId: 'NCT1', title: evil, status: evil, phase: [evil], url: 'https://y/' + evil }],
  });
  assert.ok(!html.includes('<script>'), 'no raw <script> survives');
  assert.ok(html.includes('&lt;script&gt;'), 'angle brackets are entity-escaped');
  assert.ok(html.includes('&quot;') || html.includes('&#39;'), 'quotes are escaped');
  assert.ok(html.includes('Biomedical Research'), 'renders the section heading');
});

test('dataNote names PubMed and the not-advice disclaimer', () => {
  const note = dataNote('2026-06-03');
  assert.match(note, /PubMed/);
  assert.match(note, /ClinicalTrials\.gov/);
  assert.match(note, /2026-06-03/);
  assert.match(note, /not medical advice/i);
});

test('NCBI key is referenced by env NAME only (no literal token in source)', () => {
  assert.equal(NCBI_API_KEY_ENV, 'NCBI_API_KEY');
  assert.ok(ENDPOINTS.eutils.startsWith('https://eutils.ncbi.nlm.nih.gov'));
});

test('searchPubmed works keyless and only adds api_key when env var is set', async () => {
  const SAVED = process.env[NCBI_API_KEY_ENV];
  delete process.env[NCBI_API_KEY_ENV];
  reset();
  __setFetch(mockFetch({ 'esearch.fcgi': ESEARCH, 'esummary.fcgi': ESUMMARY }));
  const keyless = await searchPubmed('depression');
  assert.equal(keyless.length, 2, 'keyless search still works');

  process.env[NCBI_API_KEY_ENV] = 'TESTKEY123';
  reset();
  let sawKeyOnEsearch = false;
  __setFetch(async (url, opts) => {
    const u = String(url);
    if (u.includes('esearch.fcgi') && u.includes('api_key=TESTKEY123')) sawKeyOnEsearch = true;
    if (u.includes('esearch.fcgi')) return { ok: true, status: 200, json: async () => ESEARCH };
    if (u.includes('esummary.fcgi')) return { ok: true, status: 200, json: async () => ESUMMARY };
    return { ok: false, status: 404, json: async () => ({}) };
  });
  await searchPubmed('depression');
  assert.ok(sawKeyOnEsearch, 'api_key from env NAME is appended when set');

  // restore
  if (SAVED === undefined) delete process.env[NCBI_API_KEY_ENV]; else process.env[NCBI_API_KEY_ENV] = SAVED;
  __setFetch();
});
