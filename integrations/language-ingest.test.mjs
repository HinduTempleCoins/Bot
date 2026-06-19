// language-ingest.test.mjs — the Language Center scraper. Offline: fetch injected. Dry-run never writes;
// per-source soft-fail; produces real dataset objects from fetched content.
import { test } from 'node:test';
import assert from 'node:assert';
import { ingest, fetchSource, coverage, INGEST_SOURCES, __setFetch } from './language-ingest.mjs';

const ok = (body) => async () => ({ ok: true, status: 200, text: async () => body });
const fail = (status) => async () => ({ ok: false, status });

test('INGEST_SOURCES are all open-licensed + single-file fetchable', () => {
  assert.ok(INGEST_SOURCES.length >= 3);
  for (const s of INGEST_SOURCES) {
    assert.ok(s.id && s.language && s.license, `${s.id} fields`);
    assert.match(s.url, /^https:\/\//, `${s.id} url`);
    assert.match(s.license, /CC|public|open/i, `${s.id} must be openly licensed`);
  }
});

test('fetchSource returns a dataset with provenance + license from the fetched text', async () => {
  __setFetch(ok('一 yī /one/\n二 èr /two/\n'));
  const res = await fetchSource(INGEST_SOURCES[0]);
  assert.equal(res.ok, true);
  assert.equal(res.dataset.id, INGEST_SOURCES[0].id);
  assert.ok(res.dataset.license);
  assert.ok(res.dataset.source.startsWith('https://'));
  assert.ok(res.dataset.bytes > 0);
  assert.match(res.dataset.content, /yī/);
  assert.ok(res.dataset.fetchedAt);
  __setFetch(null);
});

test('dry-run reports what would be written but writes nothing (written:false)', async () => {
  __setFetch(ok('some real grammar content here, long enough to keep'));
  const r = await ingest({ apply: false });
  assert.ok(r.wrote.length >= 1);
  assert.ok(r.wrote.every((w) => w.written === false));
  assert.equal(r.manifest.dryRun, true);
  __setFetch(null);
});

test('a failing/empty source soft-fails (skipped), never throws, others still ingest', async () => {
  let n = 0;
  __setFetch(async () => { n += 1; return n === 1 ? { ok: false, status: 404 } : { ok: true, status: 200, text: async () => 'enough content to be a real dataset' }; });
  const r = await ingest({ apply: false });
  assert.ok(r.skipped.length >= 1, 'the 404 source is skipped');
  assert.ok(r.wrote.length >= 1, 'the others still ingest');
  __setFetch(null);
});

test('too-short content is rejected (not a real dataset)', async () => {
  __setFetch(ok('x'));
  const res = await fetchSource(INGEST_SOURCES[0]);
  assert.equal(res.ok, false);
  assert.match(res.reason, /short|empty/);
  __setFetch(null);
});

test('only=<ids> limits the ingest set', async () => {
  __setFetch(ok('content content content content'));
  const r = await ingest({ apply: false, only: [INGEST_SOURCES[0].id] });
  assert.equal(r.wrote.length, 1);
  assert.equal(r.wrote[0].id, INGEST_SOURCES[0].id);
  __setFetch(null);
});

test('coverage() is honest: open-ingestible vs link-only (no network)', async () => {
  const c = await coverage();
  assert.equal(c.openIngestible, INGEST_SOURCES.length);
  assert.ok(c.note.toLowerCase().includes('copyrighted') || c.note.toLowerCase().includes('link-only'));
});
