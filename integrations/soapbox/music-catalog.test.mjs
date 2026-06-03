// music-catalog.test.mjs — offline tests for the free/open music catalog reader.
// All network calls are stubbed via __setFetch; no live calls, no keys. Run:
//   node --test integrations/soapbox/music-catalog.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  search, ccMixter, freePD, jamendo, isUsableLicense,
  isPDRecording, isPDComposition, PD_RECORDING_CUTOFF, PD_COMPOSITION_CUTOFF,
  renderList, dataNote, __setFetch,
} from './music-catalog.mjs';

function jsonFetch(payload, { ok = true } = {}) {
  return async () => ({ ok, json: async () => payload });
}
function throwingFetch() {
  return async () => { throw new Error('network down'); };
}

// ── license gate (NC exclusion is load-bearing) ────────────────────────────────────────────────────
test('isUsableLicense accepts PD/CC0/CC-BY family, rejects NC + reserved + empty', () => {
  assert.equal(isUsableLicense('CC0'), true);
  assert.equal(isUsableLicense('Public Domain'), true);
  assert.equal(isUsableLicense('CC BY'), true);
  assert.equal(isUsableLicense('CC BY-SA'), true);
  assert.equal(isUsableLicense('Attribution-ShareAlike'), true);
  // excluded:
  assert.equal(isUsableLicense('CC BY-NC'), false);
  assert.equal(isUsableLicense('CC BY-NC-SA'), false);
  assert.equal(isUsableLicense('Attribution NonCommercial'), false);
  assert.equal(isUsableLicense('All Rights Reserved'), false);
  assert.equal(isUsableLicense(''), false);
  assert.equal(isUsableLicense(null), false);
});

// ── public-domain rolling schedule ─────────────────────────────────────────────────────────────────
test('isPDRecording uses the 1925 (as-of-2026) recording cutoff and rolls forward', () => {
  const y2026 = Date.UTC(2026, 5, 1);
  assert.equal(PD_RECORDING_CUTOFF, 1925);
  assert.equal(isPDRecording(1925, y2026), true);
  assert.equal(isPDRecording(1926, y2026), false);
  // rolls forward: in 2030 the cutoff is 1929
  const y2030 = Date.UTC(2030, 0, 2);
  assert.equal(isPDRecording(1929, y2030), true);
  assert.equal(isPDRecording(1930, y2030), false);
  assert.equal(isPDRecording('not a year'), false);
});

test('isPDComposition uses the 1930 (as-of-2026) composition cutoff and rolls forward', () => {
  const y2026 = Date.UTC(2026, 5, 1);
  assert.equal(PD_COMPOSITION_CUTOFF, 1930);
  assert.equal(isPDComposition(1930, y2026), true);
  assert.equal(isPDComposition(1931, y2026), false);
  const y2031 = Date.UTC(2031, 0, 2);
  assert.equal(isPDComposition(1935, y2031), true);
});

// ── ccMixter (keyless) ─────────────────────────────────────────────────────────────────────────────
const ccPayload = [
  { upload_id: 11, upload_name: 'Sunrise', user_name: 'alice', license_name: 'CC BY', file_page_url: 'https://ccmixter.org/files/alice/11', files: [{ download_url: 'https://ccmixter.org/dl/11.mp3' }] },
  { upload_id: 12, upload_name: 'NC Track', user_name: 'bob', license_name: 'CC BY-NC', file_page_url: 'https://ccmixter.org/files/bob/12', files: [] }, // NC → dropped
];

test('ccMixter parses keyless results, drops NC, stamps license + provenance', async () => {
  __setFetch(jsonFetch(ccPayload));
  const r = await ccMixter({ q: 'sun' });
  __setFetch(null);
  assert.equal(r.length, 1);                 // NC track dropped
  assert.equal(r[0].title, 'Sunrise');
  assert.equal(r[0].license, 'CC BY');
  assert.equal(r[0].source, 'ccMixter');
  assert.match(r[0].provenance, /ccMixter/);
  assert.equal(r[0].audio, 'https://ccmixter.org/dl/11.mp3');
});

test('ccMixter soft-fails to [] on network error and on non-array payload', async () => {
  __setFetch(throwingFetch());
  assert.deepEqual(await ccMixter({ q: 'x' }), []);
  __setFetch(jsonFetch({ not: 'an array' }));
  assert.deepEqual(await ccMixter({ q: 'x' }), []);
  __setFetch(null);
});

// ── FreePD (static / keyless) ──────────────────────────────────────────────────────────────────────
test('freePD returns CC0 catalogue entries, name-filterable, all usable-licensed', async () => {
  const all = await freePD({});
  assert.ok(all.length >= 5);
  assert.ok(all.every((t) => t.source === 'FreePD' && isUsableLicense(t.license)));
  const piano = await freePD({ q: 'piano' });
  assert.equal(piano.length, 1);
  assert.equal(piano[0].title, 'Piano');
  assert.match(piano[0].license, /CC0|Public Domain/);
});

// ── Jamendo (keyed; soft-skip) ─────────────────────────────────────────────────────────────────────
test('jamendo soft-skips to [] when JAMENDO_CLIENT_ID is unset', async () => {
  // env var is not set in the test process → soft-skip without any fetch
  __setFetch(throwingFetch()); // proves it never calls fetch
  const r = await jamendo({ q: 'anything' });
  __setFetch(null);
  assert.deepEqual(r, []);
});

// ── search merges keyless sources ──────────────────────────────────────────────────────────────────
test('search merges FreePD + ccMixter (Jamendo soft-skipped), all license-gated', async () => {
  __setFetch(jsonFetch(ccPayload));
  const r = await search({ q: 'piano' });   // FreePD 'piano' (1) + ccMixter Sunrise (1), NC dropped
  __setFetch(null);
  assert.ok(r.length >= 2);
  assert.ok(r.some((t) => t.source === 'FreePD'));
  assert.ok(r.some((t) => t.source === 'ccMixter'));
  assert.ok(r.every((t) => isUsableLicense(t.license)));   // nothing NC slipped through
  assert.ok(r.every((t) => t.provenance && t.license));    // provenance + license on every record
});

// ── rendering ──────────────────────────────────────────────────────────────────────────────────────
test('renderList escapes a malicious title and shows the data note', () => {
  const html = renderList([
    { title: '<script>alert(1)</script>', artist: 'x', license: 'CC0', url: 'https://e.x/1', source: 'FreePD', provenance: 'FreePD (CC0)' },
  ]);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('CC0'));
  assert.ok(html.includes('Free &amp; open music'));
});

test('renderList handles empty list and dataNote names the NC-excluded rule', () => {
  assert.ok(renderList([]).includes('No usable tracks'));
  assert.ok(renderList(null).includes('</section>'));
  assert.match(dataNote(), /NonCommercial \(NC\) excluded/);
  assert.match(dataNote(), /ccMixter/);
});
