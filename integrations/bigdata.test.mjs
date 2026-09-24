import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, KEYLESS_TOOLS, GOOGLE_FREE_NO_GCP } from './bigdata.mjs';
test('catalogs keyless tools + google-free-no-gcp options', () => {
  assert.ok(KEYLESS_TOOLS.find((t) => t.id === 'duckdb'));
  assert.ok(KEYLESS_TOOLS.length >= 5);
  assert.ok(GOOGLE_FREE_NO_GCP.length >= 2);
});
test('query soft-fails on bad input, never throws', async () => {
  const r = await query('');
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(r.ok, false);
});
