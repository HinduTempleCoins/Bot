// fed-opportunities.test.mjs — offline tests for the federal-opportunity reader. All network I/O is
// through an injected fetch returning canned JSON; no real key, no real request is ever made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  grants, jobs, contracts, summary, renderPage, dataNote, esc,
  ENDPOINTS, API_KEY_ENV, __setFetch,
} from './fed-opportunities.mjs';

// A minimal Response-like object.
const okJson = (obj) => ({ ok: true, status: 200, json: async () => obj });
const notOk = () => ({ ok: false, status: 500, json: async () => ({}) });

test('grants normalizes a canned Search2 response', async () => {
  let captured = null;
  __setFetch(async (url, opts) => {
    captured = { url, opts };
    return okJson({
      data: {
        oppHits: [
          {
            id: '12345',
            number: 'EPA-WATER-2026',
            title: 'Clean Water Infrastructure Grant',
            agencyName: 'Environmental Protection Agency',
            closeDate: '2026-09-30',
          },
        ],
      },
    });
  });
  const rows = await grants({ keyword: 'water', limit: 5 });
  __setFetch();
  assert.equal(captured.url, ENDPOINTS.grants);
  assert.equal(captured.opts.method, 'POST'); // keyless POST
  assert.equal(rows.length, 1);
  const g = rows[0];
  assert.equal(g.type, 'grant');
  assert.equal(g.title, 'Clean Water Infrastructure Grant');
  assert.equal(g.agency, 'Environmental Protection Agency');
  assert.equal(g.opportunityNumber, 'EPA-WATER-2026');
  assert.equal(g.closeDate, '2026-09-30');
  assert.match(g.url, /grants\.gov/);
});

test('grants soft-fails to [] on non-ok / error', async () => {
  __setFetch(async () => notOk());
  assert.deepEqual(await grants({ keyword: 'x' }), []);
  __setFetch(async () => { throw new Error('boom'); });
  assert.deepEqual(await grants({ keyword: 'x' }), []);
  __setFetch();
});

test('jobs references key + UA by env NAME (no literal) and normalizes', async () => {
  // The module must read credentials by env NAME — not contain them literally.
  const src = await import('node:fs').then((fs) => fs.promises.readFile(
    new URL('./fed-opportunities.mjs', import.meta.url), 'utf8'));
  assert.match(src, /USAJOBS_API_KEY/);
  assert.match(src, /USAJOBS_USER_AGENT/);
  assert.equal(API_KEY_ENV.jobs, 'USAJOBS_API_KEY');
  assert.equal(API_KEY_ENV.jobsUserAgent, 'USAJOBS_USER_AGENT');

  // With neither env set, jobs soft-fails WITHOUT a network call.
  const savedKey = process.env.USAJOBS_API_KEY;
  const savedUa = process.env.USAJOBS_USER_AGENT;
  delete process.env.USAJOBS_API_KEY;
  delete process.env.USAJOBS_USER_AGENT;
  let called = false;
  __setFetch(async () => { called = true; return okJson({}); });
  assert.deepEqual(await jobs({ keyword: 'engineer' }), []);
  assert.equal(called, false, 'no network call when credentials absent');

  // With both env vars set, it calls USAJOBS and normalizes; the header values come from env.
  process.env.USAJOBS_API_KEY = 'TEST-KEY';
  process.env.USAJOBS_USER_AGENT = 'ops@example.com';
  let captured = null;
  __setFetch(async (url, opts) => {
    captured = { url, opts };
    return okJson({
      SearchResult: {
        SearchResultItems: [
          {
            MatchedObjectDescriptor: {
              PositionTitle: 'Hydraulic Engineer',
              OrganizationName: 'Army Corps of Engineers',
              PositionLocationDisplay: ['Sacramento, CA'],
              PositionRemuneration: [{ MinimumRange: '90000', MaximumRange: '120000' }],
              ApplicationCloseDate: '2026-08-15',
              PositionURI: 'https://www.usajobs.gov/job/1',
            },
          },
        ],
      },
    });
  });
  const rows = await jobs({ keyword: 'engineer', location: 'CA' });
  // header values are the injected env values, not literals baked into source
  assert.equal(captured.opts.headers['Authorization-Key'], 'TEST-KEY');
  assert.equal(captured.opts.headers['User-Agent'], 'ops@example.com');
  assert.equal(rows.length, 1);
  const j = rows[0];
  assert.equal(j.type, 'job');
  assert.equal(j.title, 'Hydraulic Engineer');
  assert.equal(j.agency, 'Army Corps of Engineers');
  assert.equal(j.location, 'Sacramento, CA');
  assert.equal(j.salaryMin, 90000);
  assert.equal(j.salaryMax, 120000);
  assert.equal(j.closeDate, '2026-08-15');
  assert.equal(j.url, 'https://www.usajobs.gov/job/1');

  // restore env + fetch
  if (savedKey === undefined) delete process.env.USAJOBS_API_KEY; else process.env.USAJOBS_API_KEY = savedKey;
  if (savedUa === undefined) delete process.env.USAJOBS_USER_AGENT; else process.env.USAJOBS_USER_AGENT = savedUa;
  __setFetch();
});

test('contracts normalizes a canned SAM.gov response (key by env NAME)', async () => {
  assert.equal(API_KEY_ENV.contracts, 'SAM_GOV_API_KEY');
  const saved = process.env.SAM_GOV_API_KEY;

  // No key ⇒ soft-fail, no network call.
  delete process.env.SAM_GOV_API_KEY;
  let called = false;
  __setFetch(async () => { called = true; return okJson({}); });
  assert.deepEqual(await contracts({ keyword: 'sensor' }), []);
  assert.equal(called, false);

  // With key set, normalizes.
  process.env.SAM_GOV_API_KEY = 'SAM-TEST';
  let captured = null;
  __setFetch(async (url) => {
    captured = url;
    return okJson({
      opportunitiesData: [
        {
          title: 'Radar Sensor Procurement',
          fullParentPathName: 'DEPT OF DEFENSE',
          solicitationNumber: 'SOL-2026-99',
          responseDeadLine: '2026-07-01T17:00:00-04:00',
          uiLink: 'https://sam.gov/opp/abc',
        },
      ],
    });
  });
  const rows = await contracts({ keyword: 'sensor', limit: 3 });
  assert.match(captured, /api_key=SAM-TEST/); // key sourced from env
  assert.equal(rows.length, 1);
  const c = rows[0];
  assert.equal(c.type, 'contract');
  assert.equal(c.title, 'Radar Sensor Procurement');
  assert.equal(c.agency, 'DEPT OF DEFENSE');
  assert.equal(c.opportunityNumber, 'SOL-2026-99');
  assert.equal(c.url, 'https://sam.gov/opp/abc');

  if (saved === undefined) delete process.env.SAM_GOV_API_KEY; else process.env.SAM_GOV_API_KEY = saved;
  __setFetch();
});

test('summary counts open opportunities by type', () => {
  const data = {
    grants: [{ type: 'grant' }, { type: 'grant' }],
    jobs: [{ type: 'job' }],
    contracts: [{ type: 'contract' }, { type: 'contract' }, { type: 'contract' }],
  };
  const s = summary(data);
  assert.equal(s.grants, 2);
  assert.equal(s.jobs, 1);
  assert.equal(s.contracts, 3);
  assert.equal(s.total, 6);
  assert.deepEqual(s.byType, { grant: 2, job: 1, contract: 3 });
  assert.match(s.source, /Grants\.gov/);
  assert.ok(s.asOf);

  // also accepts a flat array
  const flat = summary([{ type: 'grant' }, { type: 'job' }]);
  assert.equal(flat.total, 2);
});

test('renderPage escapes a malicious grant title', () => {
  const evil = '<script>alert(1)</script>';
  const html = renderPage({
    grants: [{ type: 'grant', title: evil, agency: 'EPA', opportunityNumber: 'X', closeDate: '2026-01-01', url: 'https://x/"onmouseover="evil()' }],
  });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag must not appear');
  assert.ok(html.includes('&lt;script&gt;'), 'title must be HTML-escaped');
  // a quote-injection in the url attribute must be escaped too
  assert.ok(!html.includes('"onmouseover="evil()'), 'url attribute injection must be escaped');
  assert.ok(html.includes('&quot;onmouseover'));
});

test('renderPage shows empty-state with no rows', () => {
  const html = renderPage({});
  assert.match(html, /No federal opportunities found/);
});

test('dataNote has source + as-of', () => {
  const note = dataNote();
  assert.match(note, /Grants\.gov \/ USAJOBS \/ SAM\.gov/);
  assert.match(note, /as of \d{4}-\d{2}-\d{2}/);
});

test('esc handles all five HTML-significant chars', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});
