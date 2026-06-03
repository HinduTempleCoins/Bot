// patents.test.mjs — offline tests for the PatentsView reader. Injects a fake fetch that returns canned
// PatentsView JSON keyed by request shape, and that RECORDS request headers/bodies so we can assert the
// API key is sent only by ENV NAME (never a literal) and the page output is HTML-escaped. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, searchPatents, patentDetail, byAssignee,
  summary, renderPage, dataNote, esc,
} from './patents.mjs';

const ok = (payload) => ({ ok: true, status: 200, json: async () => payload });

// route a fake fetch; the canned payload can depend on the parsed request body. Captures seen requests.
function mockFetch(payloadFor, seen) {
  return async (url, opts = {}) => {
    let body = {};
    try { body = JSON.parse(opts.body || '{}'); } catch { /* ignore */ }
    if (seen) seen.push({ url: String(url), headers: opts.headers || {}, body });
    const payload = typeof payloadFor === 'function' ? payloadFor(body, String(url)) : payloadFor;
    if (payload == null) return { ok: false, status: 404, json: async () => ({}) };
    return ok(payload);
  };
}

const SEARCH_RESULT = {
  error: false,
  count: 2,
  total_hits: 2,
  patents: [
    {
      patent_id: '10000000',
      patent_title: 'Coherent ladar using intra-pixel quadrature detection',
      patent_date: '2018-06-19',
      patent_abstract: 'A coherent ladar system.',
      assignees: [{ assignee_organization: 'Acme Corp' }],
      inventors: [
        { inventor_name_first: 'Jane', inventor_name_last: 'Doe' },
        { inventor_name_first: 'John', inventor_name_last: 'Smith' },
      ],
    },
    {
      patent_id: '9999999',
      patent_title: 'Method of widget folding',
      patent_date: '2017-03-14',
      patent_abstract: 'Folds widgets.',
      assignees: [{ assignee_organization: 'Acme Corp' }],
      inventors: [{ inventor_name_first: 'Ada', inventor_name_last: 'Lovelace' }],
    },
  ],
};

const DETAIL_RESULT = {
  error: false,
  count: 1,
  patents: [
    {
      patent_id: '10000000',
      patent_title: 'Coherent ladar',
      patent_date: '2018-06-19',
      patent_abstract: 'Abstract here.',
      patent_type: 'utility',
      assignees: [{ assignee_organization: 'Acme Corp' }],
      inventors: [{ inventor_name_first: 'Jane', inventor_name_last: 'Doe' }],
      cpc_current: [
        { cpc_group_id: 'G01S7/491', cpc_group: 'Details of systems' },
        { cpc_group_id: 'G01S17/32', cpc_group: 'Systems using continuous waves' },
      ],
      us_patent_citations: [
        { citation_patent_id: '8000000' },
        { citation_patent_id: '8500000' },
        { citation_patent_id: '8700000' },
      ],
      claims: [{ claim_sequence: 0 }, { claim_sequence: 1 }, { claim_sequence: 2 }, { claim_sequence: 3 }],
    },
  ],
};

test('searchPatents normalizes a canned PatentsView response', async () => {
  __setFetch(mockFetch(SEARCH_RESULT));
  const rows = await searchPatents({ keyword: 'ladar' });
  __setFetch();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].patentId, '10000000');
  assert.equal(rows[0].title, 'Coherent ladar using intra-pixel quadrature detection');
  assert.equal(rows[0].date, '2018-06-19');
  assert.equal(rows[0].assignee, 'Acme Corp');
  assert.deepEqual(rows[0].inventors, ['Jane Doe', 'John Smith']);
  assert.equal(rows[0].abstract, 'A coherent ladar system.');
});

test('searchPatents soft-fails to [] with no criteria', async () => {
  const rows = await searchPatents({});
  assert.deepEqual(rows, []);
});

test('searchPatents soft-fails to [] when fetch throws', async () => {
  __setFetch(async () => { throw new Error('network'); });
  const rows = await searchPatents({ keyword: 'x' });
  __setFetch();
  assert.deepEqual(rows, []);
});

test('searchPatents soft-fails to [] on non-ok response', async () => {
  __setFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  const rows = await searchPatents({ keyword: 'x' });
  __setFetch();
  assert.deepEqual(rows, []);
});

test('patentDetail returns a full record with claims/citations/CPC counts', async () => {
  __setFetch(mockFetch(DETAIL_RESULT));
  const d = await patentDetail('10000000');
  __setFetch();
  assert.equal(d.patentId, '10000000');
  assert.equal(d.type, 'utility');
  assert.equal(d.claimsCount, 4);
  assert.equal(d.citationsCount, 3);
  assert.deepEqual(d.citations, ['8000000', '8500000', '8700000']);
  assert.equal(d.cpc.length, 2);
  assert.equal(d.cpc[0].id, 'G01S7/491');
});

test('patentDetail soft-fails to null on empty id + on error', async () => {
  assert.equal(await patentDetail(''), null);
  __setFetch(async () => { throw new Error('x'); });
  assert.equal(await patentDetail('10000000'), null);
  __setFetch();
});

test('byAssignee filters by organization (sends an assignee query)', async () => {
  const seen = [];
  __setFetch(mockFetch(SEARCH_RESULT, seen));
  const rows = await byAssignee('Acme Corp', { limit: 5 });
  __setFetch();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.assignee === 'Acme Corp'));
  // the request body must target the assignee_organization field with the given name.
  const sentJson = JSON.stringify(seen[0].body);
  assert.ok(sentJson.includes('assignee_organization'));
  assert.ok(sentJson.includes('Acme Corp'));
});

test('summary tallies counts by year + top assignees', () => {
  const s = summary([
    { date: '2018-06-19', assignee: 'Acme Corp' },
    { date: '2018-01-02', assignee: 'Acme Corp' },
    { date: '2017-03-14', assignee: 'Widget Inc' },
    { date: '', assignee: '' },
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.byYear['2018'], 2);
  assert.equal(s.byYear['2017'], 1);
  assert.equal(s.topAssignees[0].assignee, 'Acme Corp');
  assert.equal(s.topAssignees[0].count, 2);
  assert.equal(summary(null).total, 0);
});

test('renderPage escapes a malicious patent title', () => {
  const html = renderPage({
    query: 'Evil & Co "search"',
    patents: [
      {
        patentId: '10000000',
        title: '<script>alert(1)</script>',
        date: '2018-06-19',
        assignee: 'Acme & "Sons"',
        inventors: ['<img src=x onerror=alert(1)>'],
        abstract: 'A & B <b>bold</b>',
      },
    ],
    asOf: '2026-06-03',
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&amp;'));
  assert.ok(html.includes('&quot;'));
  assert.ok(!html.includes('onerror=alert(1)>'));
  assert.ok(html.includes('Patent Search'));
});

test('renderPage handles empty data without throwing', () => {
  const html = renderPage({});
  assert.equal(typeof html, 'string');
  assert.ok(html.includes('<section'));
  assert.ok(html.includes('No patents found'));
});

test('dataNote names PatentsView + as-of date', () => {
  const note = dataNote('2026-06-03');
  assert.ok(note.includes('PatentsView'));
  assert.ok(note.includes('USPTO'));
  assert.ok(note.includes('as of 2026-06-03'));
  const def = dataNote();
  assert.ok(def.includes('as of'));
});

test('API key is referenced by ENV NAME only — no literal key, header sent only when env set', async () => {
  // the source file must not contain a hard-coded key; it must reference the env var by name.
  const src = await (await import('node:fs/promises')).readFile(new URL('./patents.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('PATENTSVIEW_API_KEY'));
  assert.ok(!/X-Api-Key['"]?\s*[:=]\s*['"][A-Za-z0-9]{8,}/.test(src), 'no literal key assignment');

  // with the env var unset, no key header is sent.
  const seen = [];
  delete process.env.PATENTSVIEW_API_KEY;
  __setFetch(mockFetch(SEARCH_RESULT, seen));
  await searchPatents({ keyword: 'x' });
  assert.equal(seen[0].headers['X-Api-Key'], undefined);

  // with the env var set, the header carries exactly that value (env-sourced, not literal).
  seen.length = 0;
  process.env.PATENTSVIEW_API_KEY = 'env-sourced-token';
  await searchPatents({ keyword: 'x' });
  __setFetch();
  delete process.env.PATENTSVIEW_API_KEY;
  assert.equal(seen[0].headers['X-Api-Key'], 'env-sourced-token');
});

test('esc escapes all five characters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});
