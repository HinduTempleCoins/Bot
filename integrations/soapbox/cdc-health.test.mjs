// cdc-health.test.mjs — offline tests for the CDC public-health reader. Injects a fake fetch that
// returns canned Socrata JSON (a plain array of rows) keyed by resource id. No network, no keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, APP_TOKEN_ENV, dataset, respiratoryLevels, leadingCauses,
  vaccination, summary, renderPage, dataNote, esc,
} from './cdc-health.mjs';
import { invalidate } from './cache.mjs';

const RESP = [
  { geographic_name: 'California', activity_level_label: 'High', week_end: '2026-05-30' },
];
const CAUSES = [
  { year: '2026', state: 'California', cause_name: 'All causes', deaths: '250000', aadr: '700.0' },
  { year: '2026', state: 'California', cause_name: 'Heart disease', deaths: '60000', aadr: '160.5' },
  { year: '2026', state: 'California', cause_name: 'Cancer', deaths: '55000', aadr: '140.2' },
];
const VAX = [
  { geography: 'California', vaccine: 'Influenza', group_name: 'Adults 18+', coverage_estimate: '48.3', season_survey_year: '2025-26' },
  { geography: 'California', vaccine: 'COVID-19', group_name: 'Adults 18+', coverage_estimate: '22.1', season_survey_year: '2025-26' },
];

// route a fake fetch by URL substring (resource id) → canned rows array. Records last headers seen.
let lastHeaders = null;
function mockFetch(routes) {
  return async (url, opts) => {
    lastHeaders = (opts && opts.headers) || {};
    const u = String(url);
    for (const [needle, rows] of Object.entries(routes)) {
      if (u.includes(needle)) return { ok: true, status: 200, json: async () => rows };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

const reset = () => { invalidate(); lastHeaders = null; };

test('respiratoryLevels normalizes a canned row', async () => {
  reset();
  __setFetch(mockFetch({ 'kvib-3txy': RESP }));
  const r = await respiratoryLevels({ state: 'California' });
  assert.equal(r.state, 'California');
  assert.equal(r.level, 'High');
  assert.equal(r.week, '2026-05-30');
  assert.ok(r.asOf, 'has an as-of timestamp');
  __setFetch();
});

test('respiratoryLevels soft-fails to null', async () => {
  reset();
  __setFetch(mockFetch({})); // 404 for everything
  assert.equal(await respiratoryLevels({ state: 'California' }), null);
  reset();
  __setFetch(mockFetch({ 'kvib-3txy': [] })); // empty result
  assert.equal(await respiratoryLevels({ state: 'California' }), null);
  assert.equal(await respiratoryLevels({}), null); // no state
  __setFetch();
});

test('leadingCauses normalizes + drops the "All causes" aggregate', async () => {
  reset();
  __setFetch(mockFetch({ '9bhg-hcku': CAUSES }));
  const list = await leadingCauses({ state: 'California', year: 2026 });
  assert.equal(list.length, 2, 'All-causes row dropped');
  assert.deepEqual(list[0], { cause: 'Heart disease', deaths: 60000, rate: 160.5 });
  assert.equal(list[1].cause, 'Cancer');
  __setFetch();
});

test('dataset() builds a Socrata query with where + limit', async () => {
  reset();
  let seenUrl = '';
  __setFetch(async (url, opts) => {
    seenUrl = String(url);
    lastHeaders = opts.headers;
    return { ok: true, status: 200, json: async () => [{ a: 1 }] };
  });
  const rows = await dataset('abcd-1234', { where: "state='CA'", limit: 7 });
  assert.deepEqual(rows, [{ a: 1 }]);
  assert.ok(seenUrl.includes('data.cdc.gov/resource/abcd-1234.json'));
  assert.ok(seenUrl.includes('%24limit=7') || seenUrl.includes('$limit=7'), 'limit in querystring');
  assert.ok(seenUrl.includes('where='), 'where in querystring');
  __setFetch();
});

test('dataset() soft-fails to [] on error and on non-array', async () => {
  reset();
  __setFetch(async () => { throw new Error('network down'); });
  assert.deepEqual(await dataset('abcd-1234', {}), []);
  reset();
  __setFetch(async () => ({ ok: true, status: 200, json: async () => ({ not: 'an array' }) }));
  assert.deepEqual(await dataset('abcd-1234', {}), []);
  reset();
  __setFetch();
  assert.deepEqual(await dataset(''), []); // empty resource id
});

test('summary aggregates the gathered data', async () => {
  const s = summary({
    respiratory: { state: 'California', level: 'High' },
    causes: [{ cause: 'Heart disease', deaths: 60000, rate: 160.5 }, { cause: 'Cancer', deaths: 55000, rate: 140.2 }],
    vaccinations: [{ vaccine: 'Influenza', coverage: 48.3 }, { vaccine: 'COVID-19', coverage: 22.1 }],
  });
  assert.equal(s.respiratoryLevel, 'High');
  assert.equal(s.causeCount, 2);
  assert.equal(s.totalDeaths, 115000);
  assert.equal(s.topCause, 'Heart disease');
  assert.equal(s.vaccinationCount, 2);
  assert.equal(s.avgCoverage, 35.2); // (48.3+22.1)/2 = 35.2
  assert.ok(s.asOf);
});

test('renderPage escapes a malicious cause label', async () => {
  const evil = '<script>alert(1)</script>';
  const html = renderPage({
    respiratory: { state: 'CA', level: 'High' },
    causes: [{ cause: evil, deaths: 10, rate: 1 }],
    vaccinations: [],
  });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script not present');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped form present');
  assert.ok(html.includes('not medical advice'), 'carries the disclaimer note');
});

test('dataNote has source + not-medical-advice', () => {
  const note = dataNote('2026-06-03');
  assert.match(note, /CDC \(data\.cdc\.gov\)/);
  assert.match(note, /as of 2026-06-03/);
  assert.match(note, /not medical advice/i);
});

test('vaccination filters by name + normalizes', async () => {
  reset();
  __setFetch(mockFetch({ 'vh55-3he6': VAX }));
  const flu = await vaccination({ state: 'California', vaccine: 'flu' });
  assert.equal(flu.length, 1);
  assert.equal(flu[0].vaccine, 'Influenza');
  assert.equal(flu[0].coverage, 48.3);
  const all = await vaccination({ state: 'California' });
  assert.equal(all.length, 2);
  __setFetch();
});

test('app token is referenced by env NAME only (no literal in source)', async () => {
  // The exported env NAME is what we read process.env by; there is no literal token value.
  assert.equal(APP_TOKEN_ENV, 'SOCRATA_APP_TOKEN');

  // when the env var is UNSET, no X-App-Token header is sent (keyless still works)
  reset();
  const prev = process.env[APP_TOKEN_ENV];
  delete process.env[APP_TOKEN_ENV];
  __setFetch(mockFetch({ 'abcd-1234': [{ a: 1 }] }));
  await dataset('abcd-1234', {});
  assert.equal(lastHeaders['X-App-Token'], undefined, 'no token header when env unset');

  // when SET (by name), the value is forwarded — proving we read the env, not a literal
  reset();
  process.env[APP_TOKEN_ENV] = 'env-injected-token';
  __setFetch(mockFetch({ 'abcd-1234': [{ a: 1 }] }));
  await dataset('abcd-1234', {});
  assert.equal(lastHeaders['X-App-Token'], 'env-injected-token');

  if (prev === undefined) delete process.env[APP_TOKEN_ENV]; else process.env[APP_TOKEN_ENV] = prev;
  __setFetch();

  // the source file must not contain a hard-coded token literal
  const src = await (await import('node:fs/promises')).readFile(new URL('./cdc-health.mjs', import.meta.url), 'utf8');
  assert.ok(!/['"]SOCRATA[_A-Z]*['"]\s*[:=]\s*['"][A-Za-z0-9]{8,}/.test(src), 'no literal token assignment');
});
