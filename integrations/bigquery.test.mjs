import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configured, query, trendingSubjects, labelVocabulary } from './bigquery.mjs';

test('unconfigured → soft-fails, never throws', async () => {
  const hadP = process.env.GCP_PROJECT_ID; delete process.env.GCP_PROJECT_ID;
  assert.equal(configured(), false);
  for (const r of [await query('SELECT 1'), await trendingSubjects(), await labelVocabulary('cat')]) {
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'not-configured');
  }
  if (hadP) process.env.GCP_PROJECT_ID = hadP;
});
