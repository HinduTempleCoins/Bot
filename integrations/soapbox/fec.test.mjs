// fec.test.mjs — offline tests for the OpenFEC candidate/committee/totals reader.
// Network stubbed via __setFetch; no live calls. The DEMO_KEY path means no key is required.
// Run: node --test integrations/soapbox/fec.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateSearch, candidate, committeesForCandidate, candidateTotals,
  normalizeCandidate, normalizeCommittee, normalizeTotals,
  renderPage, dataNote, apiKey, __setFetch,
} from './fec.mjs';

const RAW_CANDIDATE = {
  candidate_id: 'S0MA00170', name: 'WARREN, ELIZABETH', party_full: 'DEMOCRATIC PARTY',
  office_full: 'Senate', state: 'MA', district: '00', incumbent_challenge_full: 'Incumbent',
  cycles: [2018, 2024], election_years: [2018, 2024],
};
const RAW_COMMITTEE = {
  committee_id: 'C00540500', name: 'ELIZABETH FOR MA INC', designation_full: 'Principal campaign committee',
  committee_type_full: 'Senate', party_full: 'DEMOCRATIC PARTY',
};
const RAW_TOTALS = [
  { candidate_id: 'S0MA00170', cycle: 2024, receipts: 12345678.9, disbursements: 9876543.21, last_cash_on_hand_end_period: 2469135.69, last_debts_owed_by_committee: 0, coverage_end_date: '2024-09-30' },
  { candidate_id: 'S0MA00170', cycle: 2018, receipts: 35000000, disbursements: 34000000, last_cash_on_hand_end_period: 1000000 },
];

function resultsFetch(results, { ok = true } = {}) {
  return async () => ({ ok, json: async () => ({ results }) });
}
function throwingFetch() { return async () => { throw new Error('network down'); }; }
function captureUrlFetch(sink, results) {
  return async (u) => { sink.url = String(u); return { ok: true, json: async () => ({ results }) }; };
}

test('apiKey falls back to DEMO_KEY when FEC_API_KEY is unset (keyless-first)', () => {
  const had = process.env.FEC_API_KEY;
  delete process.env.FEC_API_KEY;
  assert.equal(apiKey(), 'DEMO_KEY');
  process.env.FEC_API_KEY = 'abc123';
  assert.equal(apiKey(), 'abc123');
  if (had == null) delete process.env.FEC_API_KEY; else process.env.FEC_API_KEY = had;
});

test('candidateSearch always attaches an api_key to the request URL', async () => {
  const had = process.env.FEC_API_KEY;
  delete process.env.FEC_API_KEY;
  const sink = {};
  __setFetch(captureUrlFetch(sink, [RAW_CANDIDATE]));
  await candidateSearch({ q: 'Warren' });
  __setFetch(null);
  if (had == null) delete process.env.FEC_API_KEY; else process.env.FEC_API_KEY = had;
  assert.match(sink.url, /api_key=DEMO_KEY/);
  assert.match(sink.url, /q=Warren/);
});

test('candidateSearch normalizes results with provenance', async () => {
  __setFetch(resultsFetch([RAW_CANDIDATE]));
  const rows = await candidateSearch({ q: 'Warren' });
  __setFetch(null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].candidateId, 'S0MA00170');
  assert.equal(rows[0].office, 'Senate');
  assert.equal(rows[0].source, 'FEC OpenFEC API');
  assert.match(rows[0].license, /public domain/);
  assert.ok(rows[0].fetchedAt);
});

test('candidateSearch soft-fails to [] on empty query, error, and bad shape', async () => {
  assert.deepEqual(await candidateSearch({ q: '' }), []);
  __setFetch(throwingFetch());
  assert.deepEqual(await candidateSearch({ q: 'x' }), []);
  __setFetch(resultsFetch(null));
  assert.deepEqual(await candidateSearch({ q: 'x' }), []);
  __setFetch(null);
});

test('candidate returns the first normalized result or null', async () => {
  __setFetch(resultsFetch([RAW_CANDIDATE]));
  const c = await candidate('S0MA00170');
  __setFetch(null);
  assert.equal(c.name, 'WARREN, ELIZABETH');
  assert.equal(await candidate(''), null);
});

test('committeesForCandidate normalizes authorized committees', async () => {
  __setFetch(resultsFetch([RAW_COMMITTEE]));
  const cms = await committeesForCandidate('S0MA00170');
  __setFetch(null);
  assert.equal(cms.length, 1);
  assert.equal(cms[0].committeeId, 'C00540500');
  assert.equal(cms[0].designation, 'Principal campaign committee');
  assert.deepEqual(await committeesForCandidate(''), []);
});

test('candidateTotals normalizes and sorts newest cycle first', async () => {
  __setFetch(resultsFetch(RAW_TOTALS));
  const totals = await candidateTotals('S0MA00170');
  __setFetch(null);
  assert.equal(totals.length, 2);
  assert.equal(totals[0].cycle, 2024); // sorted descending
  assert.equal(totals[0].receipts, 12345678.9);
  assert.equal(totals[1].cycle, 2018);
  assert.deepEqual(await candidateTotals(''), []);
});

test('normalizeTotals captures the FEC numbers verbatim (facts, not verdicts)', () => {
  const t = normalizeTotals(RAW_TOTALS[0]);
  assert.equal(t.receipts, 12345678.9);
  assert.equal(t.disbursements, 9876543.21);
  assert.equal(t.cashOnHandEnd, 2469135.69);
  assert.equal(t.coverageEnd, '2024-09-30');
  assert.equal(normalizeTotals(null), null);
});

test('normalizeCandidate / normalizeCommittee reject unusable input', () => {
  assert.equal(normalizeCandidate(null), null);
  assert.equal(normalizeCandidate({}), null);
  assert.equal(normalizeCommittee({}), null); // no committee_id
});

test('renderPage renders totals as facts and escapes injection', () => {
  const html = renderPage({
    candidate: { name: '<b>X</b>', party: 'D', office: 'Senate', state: 'MA', candidateId: 'S0MA00170' },
    totals: [{ cycle: 2024, receipts: 12345678.9, disbursements: 9876543.21, cashOnHandEnd: 2469135.69 }],
    committees: [{ name: 'ELIZABETH FOR MA', designation: 'Principal', committeeId: 'C00540500' }],
  });
  assert.ok(!html.includes('<b>X</b>'));
  assert.ok(html.includes('&lt;b&gt;'));
  assert.ok(html.includes('$12.35M')); // compact USD
  assert.ok(html.includes('Campaign finance'));
  assert.ok(html.includes('C00540500'));
  assert.ok(html.includes('source: FEC'));
});

test('renderPage handles missing data without throwing', () => {
  assert.ok(renderPage({}).includes('No totals reported'));
  assert.ok(renderPage({ candidate: {}, totals: [] }).includes('</section>'));
});

test('dataNote names the FEC, public domain, and amended-filing right of reply', () => {
  const n = dataNote();
  assert.match(n, /FEC/);
  assert.match(n, /public domain/);
  assert.match(n, /amended filings/);
});
