// library-buckets.test.mjs — guards for the three-bucket copyright model (queue #84). Pure
// classification; no network. Run: node --test integrations/soapbox/library-buckets.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, isPublicDomain, isOpenAccess, CC_LICENSES, BUCKETS } from './library-buckets.mjs';

const CURRENT_YEAR = new Date().getUTCFullYear();

// ── CC_LICENSES set ───────────────────────────────────────────────────────────────────────────────
test('CC_LICENSES is a Set covering the canonical CC codes', () => {
  assert.ok(CC_LICENSES instanceof Set);
  for (const code of ['cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-nd']) {
    assert.ok(CC_LICENSES.has(code), `expected CC_LICENSES to contain ${code}`);
  }
  assert.ok(!CC_LICENSES.has('all rights reserved'));
});

// ── isPublicDomain ────────────────────────────────────────────────────────────────────────────────
test('isPublicDomain: explicit PD rights, CC0, and old year all read as public domain', () => {
  assert.ok(isPublicDomain({ rights: 'Public Domain' }));
  assert.ok(isPublicDomain({ rights: 'No known copyright' }));
  assert.ok(isPublicDomain({ license: 'CC0 1.0' }));
  assert.ok(isPublicDomain({ license: 'cc-pdm' }));
  assert.ok(isPublicDomain({ year: 1851 }));
  assert.ok(isPublicDomain({ year: CURRENT_YEAR - 100 }));
});

test('isPublicDomain: recent works and in-copyright assertions are NOT public domain', () => {
  assert.ok(!isPublicDomain({ year: CURRENT_YEAR }));
  assert.ok(!isPublicDomain({ year: CURRENT_YEAR - 1 }));
  assert.ok(!isPublicDomain({}));
  // old year but explicitly still in copyright (e.g. restored / new edition) → not PD by heuristic
  assert.ok(!isPublicDomain({ year: 1900, rights: 'All rights reserved' }));
});

// ── isOpenAccess ──────────────────────────────────────────────────────────────────────────────────
test('isOpenAccess: CC + free licenses, OA rights, OA sources, and flags all read as open', () => {
  assert.ok(isOpenAccess({ license: 'CC BY 4.0' }));
  assert.ok(isOpenAccess({ license: 'cc-by-sa' }));
  assert.ok(isOpenAccess({ license: 'MIT' }));
  assert.ok(isOpenAccess({ rights: 'Open Access' }));
  assert.ok(isOpenAccess({ rights: 'freely available' }));
  assert.ok(isOpenAccess({ source: 'gutenberg' }));
  assert.ok(isOpenAccess({ source: 'arXiv' }));
  assert.ok(isOpenAccess({ openAccess: true }));
  assert.ok(isOpenAccess({ oa: 'yes' }));
});

test('isOpenAccess: in-copyright / unknown works are NOT open access', () => {
  assert.ok(!isOpenAccess({ rights: 'All rights reserved' }));
  assert.ok(!isOpenAccess({ license: 'proprietary' }));
  assert.ok(!isOpenAccess({}));
});

// ── classify → HOST_FULL ──────────────────────────────────────────────────────────────────────────
test('classify: public-domain work → HOST_FULL, canHostFile true', () => {
  const r = classify({ title: 'Moby-Dick', source: 'gutenberg', year: 1851 });
  assert.equal(r.bucket, BUCKETS.HOST_FULL);
  assert.equal(r.canHostFile, true);
  assert.match(r.reason, /public domain|open|corpus/i);
});

test('classify: Creative Commons work → HOST_FULL', () => {
  const r = classify({ title: 'OA paper', license: 'CC BY 4.0', source: 'doaj' });
  assert.equal(r.bucket, BUCKETS.HOST_FULL);
  assert.equal(r.canHostFile, true);
  assert.match(r.reason, /commons|cc-by/i);
});

test('classify: open-access source → HOST_FULL', () => {
  const r = classify({ title: 'A preprint', source: 'arxiv' });
  assert.equal(r.bucket, BUCKETS.HOST_FULL);
  assert.equal(r.canHostFile, true);
});

test('classify: OUR own corpus → HOST_FULL', () => {
  for (const owner of ['melek', 'corpus', 'operator', 'soapbox']) {
    const r = classify({ title: 'The Convergence', owner });
    assert.equal(r.bucket, BUCKETS.HOST_FULL, `owner=${owner}`);
    assert.equal(r.canHostFile, true);
  }
});

test('classify: © notice alongside a real CC license still clears to HOST_FULL', () => {
  const r = classify({ title: 'Open textbook', license: 'CC BY-SA 4.0', rights: '© 2024 Author' });
  assert.equal(r.bucket, BUCKETS.HOST_FULL);
  assert.equal(r.canHostFile, true);
});

// ── classify → METADATA_ONLY (the safe-default / never-host-others path) ───────────────────────────
test('classify: in-copyright work → METADATA_ONLY, canHostFile FALSE', () => {
  const r = classify({ title: 'A 2023 novel', year: 2023, rights: 'All rights reserved' });
  assert.equal(r.bucket, BUCKETS.METADATA_ONLY);
  assert.equal(r.canHostFile, false);
  assert.match(r.reason, /never host|borrow|buy|copyright/i);
});

test('classify: missing license / no signal → METADATA_ONLY safe default (never host)', () => {
  const r = classify({ title: 'Mystery scan' });
  assert.equal(r.bucket, BUCKETS.METADATA_ONLY);
  assert.equal(r.canHostFile, false);
  assert.match(r.reason, /safe default|never host/i);
});

test('classify: empty / non-object input → METADATA_ONLY safe default', () => {
  for (const input of [undefined, null, {}, 'a string', 42]) {
    const r = classify(input);
    assert.equal(r.bucket, BUCKETS.METADATA_ONLY, `input=${JSON.stringify(input)}`);
    assert.equal(r.canHostFile, false);
  }
});

test('classify: a recent year with NO rights still defaults to METADATA_ONLY (we never assume PD)', () => {
  const r = classify({ title: 'Recent unknown book', year: CURRENT_YEAR - 5 });
  assert.equal(r.bucket, BUCKETS.METADATA_ONLY);
  assert.equal(r.canHostFile, false);
});

// ── classify → USER_NFT ───────────────────────────────────────────────────────────────────────────
test('classify: user-owned in-copyright work → USER_NFT, host as license-bearing NFT', () => {
  const r = classify({ title: 'My manuscript', userOwned: true, rights: 'in copyright' });
  assert.equal(r.bucket, BUCKETS.USER_NFT);
  assert.equal(r.canHostFile, true);
  assert.match(r.reason, /user|nft/i);
});

test('classify: owner=user / self / uploader all route to USER_NFT', () => {
  for (const owner of ['user', 'self', 'uploader', 'mine']) {
    const r = classify({ title: 'Their work', owner });
    assert.equal(r.bucket, BUCKETS.USER_NFT, `owner=${owner}`);
    assert.equal(r.canHostFile, true);
  }
});

test('classify: a user who uploads a PD/CC work gets HOST_FULL, not USER_NFT (host-full wins)', () => {
  const pd = classify({ title: 'Shakespeare', userOwned: true, year: 1600 });
  assert.equal(pd.bucket, BUCKETS.HOST_FULL);
  const cc = classify({ title: 'Their CC work', userOwned: true, license: 'CC BY 4.0' });
  assert.equal(cc.bucket, BUCKETS.HOST_FULL);
});

// ── the load-bearing invariant ────────────────────────────────────────────────────────────────────
test('INVARIANT: anything not positively cleared (PD/OA/CC/corpus/user) is never hosted by us', () => {
  const restricted = [
    { title: 'in-copyright', rights: 'All rights reserved' },
    { title: 'proprietary license', license: 'proprietary' },
    { title: 'unknown', },
    { title: 'recent', year: CURRENT_YEAR },
    { title: 'copyrighted source', source: 'some-publisher' },
  ];
  for (const w of restricted) {
    const r = classify(w);
    assert.equal(r.bucket, BUCKETS.METADATA_ONLY, `${w.title} must be metadata-only`);
    assert.equal(r.canHostFile, false, `${w.title}: we must NOT host others' copyrighted files`);
  }
});

test('classify always returns the documented shape', () => {
  const r = classify({ source: 'gutenberg', year: 1800 });
  assert.deepEqual(Object.keys(r).sort(), ['bucket', 'canHostFile', 'reason']);
  assert.ok(Object.values(BUCKETS).includes(r.bucket));
  assert.equal(typeof r.reason, 'string');
  assert.equal(typeof r.canHostFile, 'boolean');
});
