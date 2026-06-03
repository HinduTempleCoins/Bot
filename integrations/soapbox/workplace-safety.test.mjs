// workplace-safety.test.mjs — offline tests for the DOL/OSHA/WHD/BLS reader. Injected fetch with
// canned DOL/BLS JSON; no network, no secrets. Run: node --test integrations/soapbox/workplace-safety.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  __setFetch,
  oshaInspections,
  whdViolations,
  injuryRates,
  summary,
  renderPage,
  dataNote,
  esc,
} from './workplace-safety.mjs';

// helper to build a fake Response
const ok = (json) => ({ ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) });
const bad = () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '' });

test('oshaInspections normalizes rows', async () => {
  __setFetch(async () => ok({
    data: [
      { estab_name: 'Acme Foundry', site_city: 'Pittsburgh', site_state: 'PA', open_date: '2025-03-01', nr_violations: 4, total_current_penalty: '12000' },
      { establishment_name: 'Beta Mill', city: 'Erie', state: 'PA', activity_date: '2025-02-01', violations: 0, penalty: 0 },
    ],
  }));
  const rows = await oshaInspections({ state: 'PA', limit: 10 });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { employer: 'Acme Foundry', city: 'Pittsburgh', state: 'PA', date: '2025-03-01', violations: 4, penalty: 12000 });
  assert.equal(rows[1].employer, 'Beta Mill');
  assert.equal(rows[1].penalty, 0);
});

test('oshaInspections soft-fails to [] on a bad response', async () => {
  __setFetch(async () => bad());
  const rows = await oshaInspections({ state: 'TX' });
  assert.deepEqual(rows, []);
});

test('oshaInspections soft-fails to [] when fetch throws', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const rows = await oshaInspections({});
  assert.deepEqual(rows, []);
});

test('whdViolations normalizes back-wages + employees affected', async () => {
  __setFetch(async () => ok({
    results: [
      { legal_name: 'Gamma Diner', cty_nm: 'Austin', st_cd: 'TX', bw_atp_amt: '8500.50', ee_atp_cnt: '6', violtn_cnt: 3 },
    ],
  }));
  const rows = await whdViolations({ state: 'TX' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].employer, 'Gamma Diner');
  assert.equal(rows[0].backWages, 8500.5);
  assert.equal(rows[0].employeesAffected, 6);
  assert.equal(rows[0].violationCount, 3);
});

test('whdViolations soft-fails to []', async () => {
  __setFetch(async () => { throw new Error('boom'); });
  assert.deepEqual(await whdViolations({}), []);
});

test('injuryRates returns a rate from the BLS API', async () => {
  __setFetch(async () => ok({
    status: 'REQUEST_SUCCEEDED',
    Results: { series: [{ seriesID: 'ISU00000000000000031000', data: [{ year: '2023', period: 'A01', value: '2.7' }] }] },
  }));
  const r = await injuryRates({ industry: 'all private industry' });
  assert.equal(r.rate, 2.7);
  assert.equal(r.year, '2023');
  assert.ok(r.series);
});

test('injuryRates soft-fails to rate:null', async () => {
  __setFetch(async () => bad());
  const r = await injuryRates({ industry: 'construction' });
  assert.equal(r.rate, null);
  assert.equal(r.industry, 'construction');
});

test('summary aggregates penalties + back wages', async () => {
  __setFetch(async (url) => {
    const u = String(url);
    if (u.includes('/osha/')) {
      return ok({ data: [
        { estab_name: 'A', site_state: 'OH', nr_violations: 2, total_current_penalty: 1000 },
        { estab_name: 'B', site_state: 'OH', nr_violations: 3, total_current_penalty: 2500 },
      ] });
    }
    if (u.includes('/whd/')) {
      return ok({ data: [
        { legal_name: 'C', st_cd: 'OH', bw_atp_amt: 4000, ee_atp_cnt: 5 },
      ] });
    }
    // BLS
    return ok({ Results: { series: [{ data: [{ year: '2023', value: '3.1' }] }] } });
  });
  const s = await summary({ state: 'oh' });
  assert.equal(s.state, 'OH');
  assert.equal(s.inspectionCount, 2);
  assert.equal(s.totalViolations, 5);
  assert.equal(s.totalPenalties, 3500);
  assert.equal(s.whdActionCount, 1);
  assert.equal(s.totalBackWages, 4000);
  assert.equal(s.employeesAffected, 5);
  assert.equal(s.injuryRate, 3.1);
  assert.ok(s.asOf);
});

test('renderPage escapes a malicious employer name', () => {
  const html = renderPage({
    inspections: [{ employer: '<script>alert("xss")</script>', city: 'X', state: 'CA', date: '2025-01-01', violations: 1, penalty: 500 }],
    whd: [{ employer: "O'Brien & <b>Co</b>", city: 'Y', state: 'CA', backWages: 100, employeesAffected: 2 }],
    injury: { industry: '<i>all</i>', rate: 2.5, year: '2023' },
    summary: { inspectionCount: 1, totalViolations: 1, totalPenalties: 500, totalBackWages: 100, employeesAffected: 2 },
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<b>Co</b>'));
  assert.ok(html.includes('&lt;b&gt;Co&lt;/b&gt;'));
  assert.ok(html.includes('&#39;Brien') || html.includes('O&#39;Brien'));
  assert.ok(html.includes('&lt;i&gt;all&lt;/i&gt;'));
});

test('renderPage handles empty data without throwing', () => {
  const html = renderPage({});
  assert.ok(html.includes('Know Your Workplace'));
  assert.ok(html.includes('No OSHA inspection records'));
});

test('dataNote has sources + not-legal-advice disclaimer', () => {
  const n = dataNote();
  assert.ok(Array.isArray(n.sources) && n.sources.length >= 1);
  assert.ok(n.sources.some((s) => /Labor/i.test(s.name)));
  assert.ok(n.sources.some((s) => /BLS|injury/i.test(s.name)));
  assert.match(n.text, /not legal advice/i);
  assert.match(n.text, /Department of Labor/i);
  assert.equal(n.keyless, true);
  assert.ok(n.asOf);
});

test('esc escapes all five special characters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});
