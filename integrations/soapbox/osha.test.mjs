// osha.test.mjs — offline node:test for the OSHA / DOL workplace-safety enforcement reader. All network
// is via an injected fetch returning canned DOL-shaped JSON; no real requests are made.
//   node --test integrations/soapbox/osha.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, inspections, byEmployer, byState, summary, renderPage, dataNote,
  SOURCE, LICENSE,
} from './osha.mjs';

const boom = () => Promise.reject(new Error('network down'));
const ok = (json) => () => Promise.resolve({ ok: true, json: async () => json });

// A canned slice of OSHA inspection records in the DOL API shape (lower-snake field names). The reader
// must tolerate this exactly; the second record uses a couple of alternate keys to exercise the picker.
const CANNED = {
  data: [
    {
      activity_nr: '100200300',
      estab_name: 'ACME MANUFACTURING INC',
      site_address: '1 Industrial Way',
      site_city: 'Akron',
      site_state: 'OH',
      site_zip: '44301',
      naics_code: '332710',
      insp_type: 'Complaint',
      open_date: '2026-02-10',
      close_conf_date: '2026-04-01',
      nr_in_violation: '3',
      total_current_penalty: '12500',
    },
    {
      activity_nr: '400500600',
      establishment_name: 'WIDGET WORKS LLC', // alternate key
      site_city: 'Dallas',
      state: 'TX',                            // alternate key
      inspection_type: 'Referral',            // alternate key
      inspection_date: '12/15/2025',          // MM/DD/YYYY
      total_violations: '1',
      current_penalty: '4000',
    },
    {
      activity_nr: '700800900',
      estab_name: 'ACME MANUFACTURING INC',
      site_city: 'Toledo',
      site_state: 'OH',
      insp_type: 'Complaint',
      open_date: '2025-09-05',
      nr_in_violation: '0',
      total_current_penalty: '0',
    },
  ],
};

// ── inspections: normalizes + provenance + tolerant field names ──────────────────────────────────────
test('inspections normalizes DOL-shaped records with provenance', async () => {
  __setFetch(ok(CANNED));
  const rows = await inspections({ query: 'ACME' });
  __setFetch(null);
  assert.equal(rows.length, 3);
  const r0 = rows[0];
  assert.equal(r0.employer, 'ACME MANUFACTURING INC');
  assert.equal(r0.state, 'OH');
  assert.equal(r0.inspectionType, 'Complaint');
  assert.equal(r0.openDate, '2026-02-10');
  assert.equal(r0.violations, 3);
  assert.equal(r0.penalty, 12500);
  assert.equal(r0.source, SOURCE);
  assert.equal(r0.license, 'public-domain');
  assert.ok(r0.fetchedAt);
  // alternate-key record resolves too
  assert.equal(rows[1].employer, 'WIDGET WORKS LLC');
  assert.equal(rows[1].state, 'TX');
  assert.equal(rows[1].inspectionType, 'Referral');
  assert.equal(rows[1].openDate, '2025-12-15'); // MM/DD/YYYY → ISO
});

test('inspections tolerates a bare-array payload', async () => {
  __setFetch(ok(CANNED.data));
  const rows = await inspections({});
  __setFetch(null);
  assert.equal(rows.length, 3);
});

test('inspections soft-fails to [] when fetch throws', async () => {
  __setFetch(boom);
  const rows = await inspections({ query: 'anything' });
  __setFetch(null);
  assert.deepEqual(rows, []);
});

test('inspections soft-fails to [] on a non-ok response', async () => {
  __setFetch(() => Promise.resolve({ ok: false, json: async () => ({}) }));
  const rows = await inspections({});
  __setFetch(null);
  assert.deepEqual(rows, []);
});

test('inspections respects the limit cap', async () => {
  __setFetch(ok(CANNED));
  const rows = await inspections({ limit: 2 });
  __setFetch(null);
  assert.equal(rows.length, 2);
});

// ── byEmployer / byState filters ─────────────────────────────────────────────────────────────────────
test('byEmployer filters to a named employer (case-insensitive)', async () => {
  __setFetch(ok(CANNED));
  const rows = await byEmployer('acme manufacturing');
  __setFetch(null);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => /ACME/.test(r.employer)));
});

test('byState filters to a 2-letter state', async () => {
  __setFetch(ok(CANNED));
  const oh = await byState('oh');
  const tx = await byState('TX');
  __setFetch(null);
  assert.equal(oh.length, 2);
  assert.equal(tx.length, 1);
});

test('byEmployer soft-fails to [] for an empty name', async () => {
  __setFetch(ok(CANNED));
  const rows = await byEmployer('');
  __setFetch(null);
  assert.deepEqual(rows, []);
});

// ── summary: tallies + provenance ────────────────────────────────────────────────────────────────────
test('summary tallies inspections, penalties and types with provenance', async () => {
  __setFetch(ok(CANNED));
  const s = await summary({ query: 'ACME' });
  __setFetch(null);
  assert.equal(s.total, 3);
  assert.equal(s.totalViolations, 4);   // 3 + 1 + 0
  assert.equal(s.totalPenalty, 16500);  // 12500 + 4000 + 0
  assert.equal(s.byType['Complaint'], 2);
  assert.equal(s.byType['Referral'], 1);
  assert.equal(s.source, SOURCE);
  assert.equal(s.license, 'public-domain');
  assert.ok(typeof s.asOf === 'string' && s.asOf.length > 0);
});

// ── renderPage: escapes hostile HTML ─────────────────────────────────────────────────────────────────
test('renderPage escapes hostile HTML in an employer name', () => {
  const html = renderPage({ inspections: [{
    employer: '<script>alert("x")</script>',
    city: "O'Fallon",
    state: 'MO & IL',
    inspectionType: 'Complaint',
    openDate: '2026-01-01',
    violations: 2,
    penalty: 5000,
  }] });
  assert.equal(html.includes('<script>alert'), false);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('O&#39;Fallon'));
  assert.ok(html.includes('MO &amp; IL'));
  assert.ok(html.includes('OSHA'));
});

test('renderPage handles an empty inspections list without throwing', () => {
  const html = renderPage({ inspections: [] });
  assert.ok(html.includes('No inspections found.'));
});

// ── dataNote ─────────────────────────────────────────────────────────────────────────────────────────
test('dataNote includes OSHA/DOL source, public domain, and an as-of date', () => {
  const note = dataNote();
  assert.ok(/OSHA/i.test(note));
  assert.ok(/public domain/i.test(note));
  assert.ok(/as of \d{4}-\d{2}-\d{2}/i.test(note));
});
