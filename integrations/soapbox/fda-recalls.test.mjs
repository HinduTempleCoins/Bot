// fda-recalls.test.mjs — offline node:test for the openFDA food/device/cosmetic recalls reader.
// All network is via an injected fetch returning canned openFDA JSON; no real requests are made.
//   node --test integrations/soapbox/fda-recalls.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, foodRecalls, deviceRecalls, foodAdverseEvents,
  summary, renderPage, dataNote, API_KEY_ENV,
} from './fda-recalls.mjs';

// helper: an injected fetch that returns one canned JSON body for every call.
const ok = (json) => () => Promise.resolve({ ok: true, json: async () => json });
const boom = () => Promise.reject(new Error('network down'));

// ── foodRecalls: normalizes a canned enforcement response ────────────────────────────────────────────
test('foodRecalls normalizes a canned /food/enforcement response', async () => {
  __setFetch(ok({
    results: [{
      product_description: 'Organic Peanut Butter, 16oz jars',
      reason_for_recall: 'Potential Salmonella contamination',
      classification: 'Class I',
      recalling_firm: 'Acme Foods Inc.',
      state: 'CA',
      recall_initiation_date: '20260115',
      status: 'Ongoing',
    }],
  }));
  const rows = await foodRecalls({ query: 'peanut' });
  __setFetch(null);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    product: 'Organic Peanut Butter, 16oz jars',
    reason: 'Potential Salmonella contamination',
    classification: 'Class I',
    company: 'Acme Foods Inc.',
    state: 'CA',
    date: '2026-01-15',
    status: 'Ongoing',
  });
});

test('foodRecalls soft-fails to [] when fetch throws', async () => {
  __setFetch(boom);
  const rows = await foodRecalls({ query: 'anything' });
  __setFetch(null);
  assert.deepEqual(rows, []);
});

test('foodRecalls soft-fails to [] when response is not ok', async () => {
  __setFetch(() => Promise.resolve({ ok: false, json: async () => ({}) }));
  const rows = await foodRecalls({});
  __setFetch(null);
  assert.deepEqual(rows, []);
});

// ── deviceRecalls: normalizes ────────────────────────────────────────────────────────────────────────
test('deviceRecalls normalizes a canned /device/recall response', async () => {
  __setFetch(ok({
    results: [{
      product_description: 'Infusion Pump Model X',
      reason_for_recall: 'Battery may fail under load',
      product_res_number: 'Z-1234-2026',
      recalling_firm: 'MedDevice Corp',
      state: 'MA',
      event_date_initiated: '20260220',
      recall_status: 'Open',
    }],
  }));
  const rows = await deviceRecalls({ query: 'pump' });
  __setFetch(null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].product, 'Infusion Pump Model X');
  assert.equal(rows[0].company, 'MedDevice Corp');
  assert.equal(rows[0].classification, 'Z-1234-2026');
  assert.equal(rows[0].date, '2026-02-20');
  assert.equal(rows[0].status, 'Open');
});

test('deviceRecalls soft-fails to [] when fetch throws', async () => {
  __setFetch(boom);
  const rows = await deviceRecalls({ query: 'x' });
  __setFetch(null);
  assert.deepEqual(rows, []);
});

// ── foodAdverseEvents: strips / omits any PII ────────────────────────────────────────────────────────
test('foodAdverseEvents normalizes and omits all consumer PII', async () => {
  __setFetch(ok({
    results: [{
      report_number: '123456',
      // consumer block carries PII that must NEVER appear in the normalized row:
      consumer: { age: '47', age_unit: 'year(s)', gender: 'Female' },
      date_started: '20260301',
      reactions: ['NAUSEA', 'VOMITING'],
      outcomes: ['Non-Serious Injuries/ Illness'],
      products: [{ name_brand: 'BrandX Supplement', role: 'Suspect' }],
    }],
  }));
  const rows = await foodAdverseEvents({ query: 'BrandX' });
  __setFetch(null);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.deepEqual(row.products, ['BrandX Supplement']);
  assert.deepEqual(row.reactions, ['NAUSEA', 'VOMITING']);
  assert.deepEqual(row.outcomes, ['Non-Serious Injuries/ Illness']);
  assert.equal(row.date, '2026-03-01');
  // PII assertions: no consumer demographics or identifiers leak through.
  const serialized = JSON.stringify(row);
  assert.equal('consumer' in row, false);
  assert.equal(serialized.includes('47'), false);
  assert.equal(serialized.includes('Female'), false);
  assert.equal(serialized.includes('123456'), false);
  assert.deepEqual(Object.keys(row).sort(), ['date', 'outcomes', 'products', 'reactions']);
});

test('foodAdverseEvents soft-fails to [] when fetch throws', async () => {
  __setFetch(boom);
  const rows = await foodAdverseEvents({ query: 'x' });
  __setFetch(null);
  assert.deepEqual(rows, []);
});

// ── summary: counts recent recalls by classification ─────────────────────────────────────────────────
test('summary counts recalls by classification across food + device', async () => {
  // food endpoint hit first, then device — return different canned bodies per URL.
  __setFetch((url) => {
    if (String(url).includes('/food/enforcement')) {
      return Promise.resolve({ ok: true, json: async () => ({ results: [
        { product_description: 'A', classification: 'Class I' },
        { product_description: 'B', classification: 'Class II' },
        { product_description: 'C', classification: 'Class I' },
      ] }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ results: [
      { product_description: 'D', product_res_number: 'Class II' },
    ] }) });
  });
  const s = await summary();
  __setFetch(null);
  assert.equal(s.foodRecalls, 3);
  assert.equal(s.deviceRecalls, 1);
  assert.equal(s.total, 4);
  assert.equal(s.byClassification['Class I'], 2);
  assert.equal(s.byClassification['Class II'], 2);
  assert.ok(typeof s.asOf === 'string' && s.asOf.length > 0);
});

// ── renderPage: escapes a malicious product name ─────────────────────────────────────────────────────
test('renderPage escapes hostile HTML in a product name', () => {
  const html = renderPage({ recalls: [{
    product: '<script>alert("xss")</script>',
    reason: 'a & b',
    classification: 'Class I',
    company: "O'Brien Foods",
    state: 'NY',
    date: '2026-01-01',
    status: 'Ongoing',
  }] });
  assert.equal(html.includes('<script>alert'), false);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('a &amp; b'));
  assert.ok(html.includes('O&#39;Brien Foods'));
  // the disclaimer note is rendered too
  assert.ok(html.includes('openFDA'));
});

test('renderPage handles an empty recalls list without throwing', () => {
  const html = renderPage({ recalls: [] });
  assert.ok(html.includes('No recalls found.'));
});

// ── dataNote: includes a source + an as-of date ──────────────────────────────────────────────────────
test('dataNote includes source openFDA, an as-of date, and "not medical advice"', () => {
  const note = dataNote();
  assert.ok(/openFDA/i.test(note));
  assert.ok(/as of \d{4}-\d{2}-\d{2}/i.test(note));
  assert.ok(/not medical advice/i.test(note));
});

// ── keyless + key-by-env-name: the api_key is only attached when the env var is set ──────────────────
test('requests are keyless by default and only attach api_key when env NAME is set', async () => {
  const seen = [];
  const spy = (url) => { seen.push(String(url)); return ok({ results: [] })(); };

  delete process.env[API_KEY_ENV];
  __setFetch(spy);
  await foodRecalls({ query: 'milk' });
  assert.equal(seen[0].includes('api_key'), false, 'no api_key when env unset (keyless)');

  process.env[API_KEY_ENV] = 'SECRET-RAISES-LIMIT';
  await foodRecalls({ query: 'milk' });
  assert.ok(seen[1].includes('api_key=SECRET-RAISES-LIMIT'), 'api_key appended from env when set');

  delete process.env[API_KEY_ENV];
  __setFetch(null);
});
