// fsis-recalls.test.mjs — offline node:test for the USDA FSIS meat/poultry recalls reader. All network
// is via an injected fetch returning canned FSIS JSON; no real requests are made.
//   node --test integrations/soapbox/fsis-recalls.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, recalls, recentRecalls, byClass, byReason, summary, renderPage, dataNote,
  SOURCE, LICENSE,
} from './fsis-recalls.mjs';

const ok = (json) => () => Promise.resolve({ ok: true, json: async () => json });
const boom = () => Promise.reject(new Error('network down'));

// A canned slice of the FSIS recall feed: an array of records using the verbose "field_*" key shape.
const CANNED = [
  {
    field_title: 'ACME Foods Recalls Ground Beef Products Due to Possible E. coli O157:H7',
    field_recall_date: '2026-03-12T00:00:00',
    field_recall_classification: 'Class I',
    field_recall_reason: 'Product Contamination - E. coli O157:H7',
    field_establishment: 'ACME Foods Inc., Est. 12345',
    field_states: 'CA, NV, AZ',
    field_product_items: '10-lb chubs of Ground Beef',
    field_qty_recovered: '24,000 lbs',
    field_recall_type: 'Active Recall',
    field_url: 'https://www.fsis.usda.gov/recalls/acme-ground-beef',
  },
  {
    field_title: 'PoultryCo Recalls Chicken Strips Due to Undeclared Allergen (Milk)',
    field_recall_date: '2026-01-08T00:00:00',
    field_recall_classification: 'Class II',
    field_recall_reason: 'Misbranding, Undeclared Allergen - Milk',
    field_establishment: 'PoultryCo, Est. P-678',
    field_states: 'TX, OK',
    field_product_items: 'Frozen Chicken Strips',
    field_url: 'https://www.fsis.usda.gov/recalls/poultryco-chicken-strips',
  },
  {
    field_title: 'DeliMeats Recalls Sliced Turkey Due to Possible Listeria',
    field_recall_date: '2026-02-20T00:00:00',
    field_recall_classification: 'Class I',
    field_recall_reason: 'Product Contamination - Listeria monocytogenes',
    field_establishment: 'DeliMeats LLC, Est. 9999',
    field_states: 'NY, NJ, CT',
    field_product_items: 'Sliced Turkey Breast',
    field_url: 'https://www.fsis.usda.gov/recalls/delimeats-turkey',
  },
];

// ── recalls: normalizes a canned response + carries provenance ───────────────────────────────────────
test('recalls normalizes a canned FSIS response with provenance', async () => {
  __setFetch(ok(CANNED));
  const rows = await recalls({});
  __setFetch(null);
  assert.equal(rows.length, 3);
  const r0 = rows[0];
  assert.equal(r0.title, 'ACME Foods Recalls Ground Beef Products Due to Possible E. coli O157:H7');
  assert.equal(r0.date, '2026-03-12');
  assert.equal(r0.recallClass, 'Class I');
  assert.equal(r0.company, 'ACME Foods Inc., Est. 12345');
  assert.equal(r0.states, 'CA, NV, AZ');
  assert.equal(r0.url, 'https://www.fsis.usda.gov/recalls/acme-ground-beef');
  // provenance on every record
  assert.equal(r0.source, SOURCE);
  assert.equal(r0.license, LICENSE);
  assert.equal(LICENSE, 'public-domain');
  assert.ok(typeof r0.fetchedAt === 'string' && r0.fetchedAt.length > 0);
});

test('recalls filters by free-text query (case-insensitive)', async () => {
  __setFetch(ok(CANNED));
  const rows = await recalls({ query: 'turkey' });
  __setFetch(null);
  assert.equal(rows.length, 1);
  assert.ok(/Turkey/.test(rows[0].title));
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

test('recalls tolerates a .results-wrapped payload', async () => {
  __setFetch(ok({ results: CANNED }));
  const rows = await recalls({});
  __setFetch(null);
  assert.equal(rows.length, 3);
});

test('recalls respects the limit cap', async () => {
  __setFetch(ok(CANNED));
  const rows = await recalls({ limit: 2 });
  __setFetch(null);
  assert.equal(rows.length, 2);
});

// ── recentRecalls: sorted by date desc ───────────────────────────────────────────────────────────────
test('recentRecalls returns the most recent recalls (date desc)', async () => {
  __setFetch(ok(CANNED));
  const rows = await recentRecalls({ limit: 2 });
  __setFetch(null);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, '2026-03-12'); // newest first
  assert.equal(rows[1].date, '2026-02-20');
});

// ── byClass / byReason filters ───────────────────────────────────────────────────────────────────────
test('byClass filters recalls to a classification (case-insensitive substring)', async () => {
  __setFetch(ok(CANNED));
  const classII = await byClass('class ii'); // specific: only the Class II record
  const classI = await byClass('class i');   // substring of "Class II" too → all 3 match
  __setFetch(null);
  assert.equal(classII.length, 1);
  assert.ok(/Class II/.test(classII[0].recallClass));
  assert.equal(classI.length, 3);
});

test('byReason filters recalls by pathogen/contaminant substring', async () => {
  __setFetch(ok(CANNED));
  const listeria = await byReason('listeria');
  const allergen = await byReason('Undeclared Allergen');
  __setFetch(null);
  assert.equal(listeria.length, 1);
  assert.ok(/Turkey/.test(listeria[0].title));
  assert.equal(allergen.length, 1);
});

test('byClass soft-fails to [] for an empty class', async () => {
  __setFetch(ok(CANNED));
  const rows = await byClass('');
  __setFetch(null);
  assert.deepEqual(rows, []);
});

// ── summary: counts by classification + provenance ───────────────────────────────────────────────────
test('summary counts recalls by classification and carries provenance', async () => {
  __setFetch(ok(CANNED));
  const s = await summary();
  __setFetch(null);
  assert.equal(s.total, 3);
  assert.equal(s.byClassification['Class I'], 2);
  assert.equal(s.byClassification['Class II'], 1);
  assert.equal(s.source, SOURCE);
  assert.equal(s.license, 'public-domain');
  assert.ok(typeof s.asOf === 'string' && s.asOf.length > 0);
});

// ── renderPage: escapes hostile HTML ─────────────────────────────────────────────────────────────────
test('renderPage escapes hostile HTML in a recall title', () => {
  const html = renderPage({ recalls: [{
    title: '<script>alert("xss")</script>',
    date: '2026-01-01',
    recallClass: 'Class I',
    reason: 'E. coli & salmonella',
    company: "O'Brien Meats & Co",
    states: 'CA',
    url: 'https://x/"onmouseover="evil()',
  }] });
  assert.equal(html.includes('<script>alert'), false);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('E. coli &amp; salmonella'));
  assert.ok(html.includes('O&#39;Brien Meats &amp; Co'));
  assert.equal(html.includes('"onmouseover="evil()'), false);
  assert.ok(html.includes('FSIS'));
});

test('renderPage handles an empty recalls list without throwing', () => {
  const html = renderPage({ recalls: [] });
  assert.ok(html.includes('No recalls found.'));
});

// ── dataNote ─────────────────────────────────────────────────────────────────────────────────────────
test('dataNote includes USDA FSIS source, public domain, and an as-of date', () => {
  const note = dataNote();
  assert.ok(/USDA FSIS/i.test(note));
  assert.ok(/public domain/i.test(note));
  assert.ok(/as of \d{4}-\d{2}-\d{2}/i.test(note));
});
