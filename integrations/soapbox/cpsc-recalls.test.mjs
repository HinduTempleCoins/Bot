// cpsc-recalls.test.mjs — offline node:test for the CPSC SaferProducts.gov consumer-product recalls
// reader. All network is via an injected fetch returning canned CPSC JSON; no real requests are made.
//   node --test integrations/soapbox/cpsc-recalls.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, recalls, recentRecalls, byHazard, summary, renderPage, dataNote,
} from './cpsc-recalls.mjs';

// helper: an injected fetch that returns one canned JSON body for every call.
const ok = (json) => () => Promise.resolve({ ok: true, json: async () => json });
const boom = () => Promise.reject(new Error('network down'));

// A canned slice of the CPSC Recall REST shape: a top-level array of recall records, each with nested
// Products / Manufacturers / Hazards / Remedies arrays.
const CANNED = [
  {
    Title: 'Acme Hoverboards Recalled Due to Fire Hazard',
    RecallDate: '2026-03-10T00:00:00',
    Products: [{ Name: 'Acme X1 Hoverboard' }],
    Manufacturers: [{ Name: 'Acme Mobility Inc.' }],
    Hazards: [{ Name: 'Fire' }, { Name: 'Burn' }],
    Remedies: [{ Name: 'Refund' }],
    URL: 'https://www.cpsc.gov/Recalls/2026/acme-hoverboards',
  },
  {
    Title: 'Tiny Blocks Toy Set Recalled Due to Choking Hazard',
    RecallDate: '2026-01-05T00:00:00',
    Products: [{ Name: 'Tiny Blocks 200pc' }],
    Manufacturers: [{ Name: 'PlayCo' }],
    Hazards: [{ Name: 'Choking' }],
    Remedies: [{ Name: 'Repair' }],
    URL: 'https://www.cpsc.gov/Recalls/2026/tiny-blocks',
  },
  {
    Title: 'Ladder Recalled Due to Fall Hazard',
    RecallDate: '2026-02-20T00:00:00',
    Products: [{ Name: 'SafeStep Ladder' }],
    Manufacturers: [{ Name: 'LadderWorks' }],
    Hazards: [{ Name: 'Fall' }],
    Remedies: [{ Name: 'Replacement' }],
    URL: 'https://www.cpsc.gov/Recalls/2026/ladder',
  },
];

// ── recalls: normalizes a canned response ────────────────────────────────────────────────────────────
test('recalls normalizes a canned CPSC response', async () => {
  __setFetch(ok(CANNED));
  const rows = await recalls({ query: 'hoverboard' });
  __setFetch(null);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    title: 'Acme Hoverboards Recalled Due to Fire Hazard',
    date: '2026-03-10',
    hazard: 'Fire; Burn',
    remedy: 'Refund',
    products: ['Acme X1 Hoverboard'],
    manufacturer: 'Acme Mobility Inc.',
    url: 'https://www.cpsc.gov/Recalls/2026/acme-hoverboards',
  });
});

test('recalls soft-fails to [] when fetch throws', async () => {
  __setFetch(boom);
  const rows = await recalls({ query: 'anything' });
  __setFetch(null);
  assert.deepEqual(rows, []);
});

test('recalls soft-fails to [] when response is not ok', async () => {
  __setFetch(() => Promise.resolve({ ok: false, json: async () => ([]) }));
  const rows = await recalls({});
  __setFetch(null);
  assert.deepEqual(rows, []);
});

test('recalls respects the limit cap', async () => {
  __setFetch(ok(CANNED));
  const rows = await recalls({ limit: 2 });
  __setFetch(null);
  assert.equal(rows.length, 2);
});

// ── recentRecalls: returns the latest, sorted by date desc ───────────────────────────────────────────
test('recentRecalls returns the most recent recalls (date desc)', async () => {
  __setFetch(ok(CANNED));
  const rows = await recentRecalls({ limit: 2 });
  __setFetch(null);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, '2026-03-10'); // newest first
  assert.equal(rows[1].date, '2026-02-20');
});

// ── byHazard: filters to a hazard type ───────────────────────────────────────────────────────────────
test('byHazard filters recalls to the named hazard (case-insensitive)', async () => {
  __setFetch(ok(CANNED));
  const fire = await byHazard('fire');
  const choking = await byHazard('CHOKING');
  __setFetch(null);
  assert.equal(fire.length, 1);
  assert.equal(fire[0].title, 'Acme Hoverboards Recalled Due to Fire Hazard');
  assert.equal(choking.length, 1);
  assert.equal(choking[0].title, 'Tiny Blocks Toy Set Recalled Due to Choking Hazard');
});

test('byHazard soft-fails to [] for an empty hazard', async () => {
  __setFetch(ok(CANNED));
  const rows = await byHazard('');
  __setFetch(null);
  assert.deepEqual(rows, []);
});

// ── summary: counts recent recalls by hazard type ────────────────────────────────────────────────────
test('summary counts recalls by hazard type', async () => {
  __setFetch(ok(CANNED));
  const s = await summary();
  __setFetch(null);
  assert.equal(s.total, 3);
  assert.equal(s.byHazardType['Fire'], 1);
  assert.equal(s.byHazardType['Burn'], 1);
  assert.equal(s.byHazardType['Choking'], 1);
  assert.equal(s.byHazardType['Fall'], 1);
  assert.ok(typeof s.asOf === 'string' && s.asOf.length > 0);
  assert.equal(s.source, 'CPSC SaferProducts.gov');
});

// ── renderPage: escapes a malicious product/title ────────────────────────────────────────────────────
test('renderPage escapes hostile HTML in a product title', () => {
  const html = renderPage({ recalls: [{
    title: '<script>alert("xss")</script>',
    date: '2026-01-01',
    hazard: 'fire & smoke',
    remedy: 'refund',
    products: ["O'Brien Widget"],
    manufacturer: 'A & B Co',
    url: 'https://x/"onmouseover="evil()',
  }] });
  assert.equal(html.includes('<script>alert'), false);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('fire &amp; smoke'));
  assert.ok(html.includes('O&#39;Brien Widget'));
  assert.ok(html.includes('A &amp; B Co'));
  // the hostile URL is escaped too — no raw double-quote breaks out of the href attribute
  assert.equal(html.includes('"onmouseover="evil()'), false);
  // the disclaimer note is rendered too
  assert.ok(html.includes('CPSC'));
});

test('renderPage handles an empty recalls list without throwing', () => {
  const html = renderPage({ recalls: [] });
  assert.ok(html.includes('No recalls found.'));
});

// ── dataNote: includes a source + an as-of date ──────────────────────────────────────────────────────
test('dataNote includes CPSC SaferProducts.gov source and an as-of date', () => {
  const note = dataNote();
  assert.ok(/CPSC SaferProducts\.gov/i.test(note));
  assert.ok(/source/i.test(note));
  assert.ok(/as of \d{4}-\d{2}-\d{2}/i.test(note));
});
