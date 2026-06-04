// elections-civic.test.mjs — offline tests for the §6A.3 elections & civic-info reader.
// node:test, injected fetch, deterministic clock. Asserts the three HARD RULES are enforced in code:
//   official-only actionable voting info (+ honest pointer fallback), no race-calling, auto-expiry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  officeholders, whatsOnBallot, whereToVote, candidates, resultsStatus,
  localElectionOfficePointer, isExpired, normalizeFederalOfficeholder,
  renderPage, dataNote, esc, __setFetch,
} from './elections-civic.mjs';

// ── fetch stub helpers ────────────────────────────────────────────────────────────────────────────
function stubJson(payload, ok = true) {
  __setFetch(async () => ({ ok, json: async () => payload }));
}
function stubByUrl(map) {
  __setFetch(async (u) => {
    const url = String(u);
    for (const [needle, payload] of Object.entries(map)) {
      if (url.includes(needle)) return { ok: true, json: async () => payload };
    }
    return { ok: false, json: async () => ({}) };
  });
}
function restore() { __setFetch(null); }

const FIXED_NOW = Date.UTC(2026, 9, 1); // 2026-10-01 — before a 2026-11-03 election, after a 2024 one

// ── officeholders: normalize congress-legislators JSON ─────────────────────────────────────────────
test('officeholders normalizes @unitedstates/congress-legislators JSON (federal, keyless)', async () => {
  stubJson([
    {
      id: { bioguide: 'C001098', fec: ['S6TX00362'] },
      name: { first: 'Ted', last: 'Cruz', official_full: 'Ted Cruz' },
      terms: [{ type: 'sen', state: 'TX', party: 'Republican', start: '2019-01-03', end: '2025-01-03' }],
    },
    {
      id: { bioguide: 'X000000' },
      name: { first: 'Other', last: 'Person' },
      terms: [{ type: 'rep', state: 'CA', party: 'Democrat' }],
    },
  ]);
  const rows = await officeholders({ state: 'TX', level: 'federal' });
  restore();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Ted Cruz');
  assert.equal(rows[0].chamber, 'Senate');
  assert.equal(rows[0].state, 'TX');
  assert.equal(rows[0].party, 'Republican');
  assert.equal(rows[0].source, '@unitedstates/congress-legislators');
  assert.ok(rows[0].sourceUrl.includes('legislators-current.json'));
  assert.ok(rows[0].asOf);
});

test('normalizeFederalOfficeholder returns null on junk', () => {
  assert.equal(normalizeFederalOfficeholder(null), null);
  assert.equal(normalizeFederalOfficeholder({}), null);
});

// ── whatsOnBallot: official-tagged contests ────────────────────────────────────────────────────────
test('whatsOnBallot returns official-tagged contests only', async () => {
  process.env.VIP_API_KEY = 'k';
  stubJson({
    election: { electionDay: '2026-11-03', name: 'General' },
    contests: [
      { office: 'US Senate', type: 'General', candidates: [{ name: 'A', party: 'D' }, { name: 'B', party: 'R' }], sources: [{ name: 'TX Secretary of State', official: true }] },
      { office: 'Unofficial Office', type: 'General', candidates: [{ name: 'C' }] }, // NO sources → must be dropped
    ],
  });
  const r = await whatsOnBallot({ address: '1 Main St, Austin TX', nowMs: FIXED_NOW });
  restore(); delete process.env.VIP_API_KEY;
  assert.ok(Array.isArray(r.contests));
  assert.equal(r.contests.length, 1, 'only the official-sourced contest survives');
  assert.equal(r.contests[0].office, 'US Senate');
  assert.equal(r.contests[0].official, true);
  assert.ok(r.contests[0].source.includes('Secretary of State'));
  assert.ok(r.contests[0].asOf);
});

test('whatsOnBallot returns null contests + honest pointer when no official source', async () => {
  // no VIP key set → cannot fetch official data → honest pointer, never a guess
  delete process.env.VIP_API_KEY; delete process.env.GOOGLE_CIVIC_API_KEY;
  const r = await whatsOnBallot({ address: '1 Main St', electionDate: '2026-11-03', nowMs: FIXED_NOW });
  assert.equal(r.contests, null);
  assert.ok(r.pointer);
  assert.equal(r.pointer.official, true);
  assert.match(r.pointer.note, /local election office/i);
});

test('whatsOnBallot drops contests with no official source → honest pointer', async () => {
  process.env.VIP_API_KEY = 'k';
  stubJson({ election: { electionDay: '2026-11-03' }, contests: [{ office: 'X', candidates: [{ name: 'Y' }] }] }); // no sources
  const r = await whatsOnBallot({ address: '1 Main St', nowMs: FIXED_NOW });
  restore(); delete process.env.VIP_API_KEY;
  assert.equal(r.contests, null);
  assert.match(r.pointer.note, /local election office/i);
});

// ── whereToVote: official-only ─────────────────────────────────────────────────────────────────────
test('whereToVote returns only locations carrying an official VIP source', async () => {
  process.env.VIP_API_KEY = 'k';
  stubJson({
    election: { electionDay: '2026-11-03' },
    pollingLocations: [
      { name: 'Lib', address: { line1: '5 Oak', city: 'Austin', state: 'TX', zip: '78701' }, pollingHours: '7-7', sources: [{ name: 'Travis County Clerk', official: true }] },
      { name: 'No-source site', address: { line1: '9 Elm' } }, // dropped — not official
    ],
    earlyVoteSites: [],
    dropOffLocations: [],
  });
  const r = await whereToVote({ address: '1 Main St, Austin TX', nowMs: FIXED_NOW });
  restore(); delete process.env.VIP_API_KEY;
  assert.equal(r.official, true);
  assert.equal(r.polling.length, 1);
  assert.equal(r.polling[0].name, 'Lib');
  assert.equal(r.polling[0].official, true);
  assert.ok(r.polling[0].source.includes('Travis County'));
});

test('whereToVote with no key → null + honest local-office pointer', async () => {
  delete process.env.VIP_API_KEY; delete process.env.GOOGLE_CIVIC_API_KEY;
  const r = await whereToVote({ address: '1 Main St', electionDate: '2026-11-03', nowMs: FIXED_NOW });
  assert.equal(r.polling, null);
  assert.ok(r.pointer);
  assert.equal(r.pointer.official, true);
  assert.match(r.pointer.note, /local election office/i);
});

// ── AUTO-EXPIRY: expired election yields no stale voter info ────────────────────────────────────────
test('isExpired gates on the end of election day', () => {
  assert.equal(isExpired('2024-11-05', FIXED_NOW), true, 'a 2024 election is expired in 2026');
  assert.equal(isExpired('2026-11-03', FIXED_NOW), false, 'a future election is not expired');
  assert.equal(isExpired('', FIXED_NOW), false, 'unparseable date → cannot prove stale');
});

test('expired election date yields NO stale voter info (ballot + where)', async () => {
  process.env.VIP_API_KEY = 'k';
  // Even with a fully-populated official payload, a past election must NOT surface.
  stubJson({
    election: { electionDay: '2024-11-05' },
    contests: [{ office: 'Old Race', sources: [{ name: 'SoS', official: true }], candidates: [{ name: 'Z' }] }],
    pollingLocations: [{ name: 'Stale Site', sources: [{ name: 'Clerk', official: true }] }],
  });
  const ballot = await whatsOnBallot({ address: '1 Main St', electionDate: '2024-11-05', nowMs: FIXED_NOW });
  const where = await whereToVote({ address: '1 Main St', electionDate: '2024-11-05', nowMs: FIXED_NOW });
  restore(); delete process.env.VIP_API_KEY;
  assert.equal(ballot.contests, null, 'no stale ballot');
  assert.ok(ballot.pointer);
  assert.equal(where.polling, null, 'no stale polling place');
  assert.ok(where.pointer);
});

// ── NO RACE-CALLING: resultsStatus refuses uncertified ─────────────────────────────────────────────
test('resultsStatus refuses to call an uncertified race (certified:false → no winner)', () => {
  const r = resultsStatus({ certified: false, winner: 'Somebody', source: 'rumor feed' });
  assert.equal(r.certified, false);
  assert.equal(r.winner, null, 'NEVER name a winner from an uncertified count');
  assert.match(r.note, /not certified/i);
  assert.match(r.note, /do not (project|call)/i);
});

test('resultsStatus default (no arg) is uncertified and calls nothing', () => {
  const r = resultsStatus();
  assert.equal(r.certified, false);
  assert.equal(r.winner, null);
});

test('resultsStatus surfaces a winner ONLY when certified === true', () => {
  const r = resultsStatus({ certified: true, winner: 'Jane Doe', source: 'TX SoS certified canvass', sourceUrl: 'https://sos.texas.gov' });
  assert.equal(r.certified, true);
  assert.equal(r.winner, 'Jane Doe');
  assert.match(r.note, /certified/i);
});

// ── candidates (FEC shape) ─────────────────────────────────────────────────────────────────────────
test('candidates normalizes FEC candidate search results', async () => {
  stubByUrl({ '/candidates/search/': { results: [
    { name: 'DOE, JANE', candidate_id: 'S6TX00362', office_full: 'Senate', party_full: 'DEMOCRATIC PARTY', state: 'TX', district: '00', cycles: [2024, 2026] },
  ] } });
  const rows = await candidates({ office: 'Senate', cycle: 2026 });
  restore();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].candidateId, 'S6TX00362');
  assert.equal(rows[0].office, 'Senate');
  assert.equal(rows[0].state, 'TX');
  assert.ok(rows[0].source.includes('FEC'));
});

// ── render escapes hostile input ───────────────────────────────────────────────────────────────────
test('renderPage escapes a malicious candidate name', () => {
  const html = renderPage([{
    name: '<script>alert("xss")</script>', candidateId: 'X', office: 'Senate', party: 'D', state: 'TX',
  }]);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('renderPage escapes a malicious officeholder name', () => {
  const html = renderPage([{ name: '"><img src=x onerror=alert(1)>', chamber: 'Senate', state: 'TX', party: 'R', level: 'federal' }]);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
});

test('renderPage on a ballot result with malicious contest office escapes it', () => {
  const html = renderPage({ electionDate: '2026-11-03', contests: [{ office: '<b>x</b>', candidates: [{ name: '<i>y</i>' }], official: true, source: 'SoS' }] });
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(!html.includes('<i>y</i>'));
});

test('renderPage on an uncertified resultsStatus never shows a winner', () => {
  const html = renderPage(resultsStatus({ certified: false, winner: 'NoOne' }));
  assert.ok(!html.includes('NoOne'));
  assert.match(html, /No winner called/);
});

// ── pointer + dataNote present ─────────────────────────────────────────────────────────────────────
test('localElectionOfficePointer is official and links a real URL', () => {
  const p = localElectionOfficePointer();
  assert.equal(p.official, true);
  assert.match(p.sourceUrl, /^https?:\/\//);
  assert.ok(p.asOf);
});

test('dataNote is present and states the official-only / no-race / expiry caveats', () => {
  const n = dataNote();
  assert.ok(n.length > 0);
  assert.match(n, /official/i);
  assert.match(n, /certif/i);
  assert.match(n, /expire/i);
});

test('esc escapes all five HTML metacharacters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});
