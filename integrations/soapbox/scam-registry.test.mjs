// scam-registry.test.mjs — offline coverage for the pure catalog/classify helpers + the
// allowlist path of checkLegit + the early-return of scamSignals. The keyless live lookups
// (urlscan/EDGAR/PAUSE/CryptoScamDB/Chainabuse) hit the network and are NOT exercised here.
// No network is touched by any assertion below.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCAM_SOURCES, KINDS, govSources, queryableSources, keylessSources, byKind,
  classifyQuery, normalizeDomain, checkLegit, scamSignals, summary, LEGIT_ALLOWLIST,
  __setFetch, secPauseList, edgarFullText, urlscanDomain, checkCryptoScamDB,
} from './scam-registry.mjs';
import { invalidate } from './cache.mjs';

// ── Offline live-lookup coverage via the injectable fetch seam. The cache is in-process; we
// invalidate before each injected case + use unique queries so a previous test can't poison a hit. ──

// Build a fake Response that satisfies the {ok, status, json(), text()} surface these readers use.
function fakeResponse({ ok = true, status = 200, json, text } = {}) {
  return {
    ok, status,
    async json() { if (json === undefined) throw new Error('no json'); return json; },
    async text() { return text ?? ''; },
  };
}
// A fetch that throws (network down) — exercises the soft-fail path.
const throwingFetch = () => { throw new Error('network down'); };

test('secPauseList: parses names.txt into a lowercased Set (injected fetch)', async () => {
  invalidate();
  __setFetch(async () => fakeResponse({ ok: true, text: 'Acme Capital\nBETA Trust LLC\n\n  Gamma Fund  \n' }));
  try {
    const set = await secPauseList();
    assert.ok(set instanceof Set);
    assert.ok(set.has('acme capital'));
    assert.ok(set.has('beta trust llc'));
    assert.ok(set.has('gamma fund'));        // trimmed
    assert.ok(!set.has(''));                  // blank line dropped
  } finally { __setFetch(null); invalidate(); }
});

test('secPauseList: soft-fails to empty Set on network error (never throws)', async () => {
  invalidate();
  __setFetch(throwingFetch);
  try {
    const set = await secPauseList();
    assert.ok(set instanceof Set);
    assert.equal(set.size, 0);
  } finally { __setFetch(null); invalidate(); }
});

test('edgarFullText: parses hits + sample display names (injected fetch)', async () => {
  invalidate();
  __setFetch(async () => fakeResponse({ ok: true, json: {
    hits: { total: { value: 3 }, hits: [
      { _source: { display_names: ['ACME CORP (CIK 0001)'] } },
      { _source: { display_names: ['ACME HOLDINGS'] } },
    ] },
  } }));
  try {
    const r = await edgarFullText('acme-edgar-unique-1');
    assert.equal(r.hits, 3);
    assert.equal(r.hasFilings, true);
    assert.deepEqual(r.sample, ['ACME CORP (CIK 0001)', 'ACME HOLDINGS']);
  } finally { __setFetch(null); invalidate(); }
});

test('edgarFullText: non-ok response → null (soft-fail)', async () => {
  invalidate();
  __setFetch(async () => fakeResponse({ ok: false, status: 429 }));
  try {
    assert.equal(await edgarFullText('rate-limited-edgar-unique-2'), null);
  } finally { __setFetch(null); invalidate(); }
});

test('urlscanDomain: counts malicious verdicts (injected fetch)', async () => {
  invalidate();
  __setFetch(async () => fakeResponse({ ok: true, json: {
    total: 4,
    results: [
      { verdicts: { overall: { malicious: true } } },
      { task: { tags: ['phishing'] } },
      { verdicts: { overall: { malicious: false } }, task: { tags: ['benign'] } },
    ],
  } }));
  try {
    const r = await urlscanDomain('evil-unique-1.test');
    assert.equal(r.scans, 4);
    assert.equal(r.malicious, 2);
    assert.equal(r.malicious_seen, true);
  } finally { __setFetch(null); invalidate(); }
});

test('checkCryptoScamDB: reported when result entries present (injected fetch)', async () => {
  invalidate();
  __setFetch(async () => fakeResponse({ ok: true, json: {
    success: true, result: [{ name: 'phish1' }, { name: 'phish2' }],
  } }));
  try {
    const r = await checkCryptoScamDB('scam-unique-1.test');
    assert.equal(r.reported, true);
    assert.equal(r.entries.length, 2);
  } finally { __setFetch(null); invalidate(); }
});

test('scamSignals: aggregates multi-source results + derives riskHint (injected fetch)', async () => {
  invalidate();
  // Route every keyless source to a hit: PAUSE names include the query, urlscan malicious,
  // csdb reported, edgar has filings. A PAUSE listing → riskHint 'high'.
  __setFetch(async (url) => {
    const u = String(url);
    if (u.includes('us_sec_pause/names.txt')) return fakeResponse({ ok: true, text: 'evilcorp\n' });
    if (u.includes('urlscan.io')) return fakeResponse({ ok: true, json: { total: 2, results: [{ verdicts: { overall: { malicious: true } } }] } });
    if (u.includes('cryptoscamdb')) return fakeResponse({ ok: true, json: { success: true, result: [{ name: 'x' }] } });
    if (u.includes('efts.sec.gov')) return fakeResponse({ ok: true, json: { hits: { total: { value: 1 }, hits: [] } } });
    return fakeResponse({ ok: false, status: 404 });
  });
  try {
    const r = await scamSignals('evilcorp.test');
    assert.equal(r.kind, 'domain');
    assert.ok(r.sources.includes('urlscan.io'));
    assert.ok(r.sources.includes('CryptoScamDB'));
    assert.ok(r.sources.includes('SEC EDGAR'));
    assert.ok(r.reports.some((x) => x.source === 'urlscan.io'));
    assert.equal(r.riskHint, 'high');         // listed on PAUSE (substring match) overrides
    assert.ok(r.signals.csdb && r.signals.csdb.reported);
  } finally { __setFetch(null); invalidate(); }
});

test('scamSignals: all sources down → soft-fail, riskHint unknown (never throws)', async () => {
  invalidate();
  __setFetch(throwingFetch);
  try {
    const r = await scamSignals('quiet-unique-domain.test');
    assert.equal(r.kind, 'domain');
    assert.deepEqual(r.reports, []);
    assert.equal(r.riskHint, 'unknown');
  } finally { __setFetch(null); invalidate(); }
});

test('catalog: every source is well-formed', () => {
  assert.ok(Array.isArray(SCAM_SOURCES) && SCAM_SOURCES.length > 0);
  for (const s of SCAM_SOURCES) {
    assert.equal(typeof s.name, 'string');
    assert.ok(KINDS.includes(s.kind), `bad kind: ${s.kind}`);
    assert.equal(typeof s.keyless, 'boolean');
    assert.equal(typeof s.coverage, 'string');
  }
});

test('catalog filters partition correctly', () => {
  assert.deepEqual(govSources(), byKind('gov'));
  assert.ok(queryableSources().every((s) => !!s.api));
  assert.ok(keylessSources().every((s) => s.keyless === true));
});

test('summary counts agree with the catalog', () => {
  const s = summary();
  assert.equal(s.total, SCAM_SOURCES.length);
  assert.equal(s.gov, byKind('gov').length);
  assert.equal(s.queryable, queryableSources().length);
  assert.equal(s.keyless, keylessSources().length);
  assert.equal(s.legit_allowlist, LEGIT_ALLOWLIST.length);
});

test('classifyQuery: recognizes eth/btc addresses, domains, names, empty', () => {
  assert.deepEqual(classifyQuery('0x' + 'a'.repeat(40)), { kind: 'eth-address', value: '0x' + 'a'.repeat(40) });
  assert.equal(classifyQuery('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4').kind, 'btc-address');
  assert.deepEqual(classifyQuery('https://www.Coinbase.com/'), { kind: 'domain', value: 'coinbase.com' });
  assert.deepEqual(classifyQuery('Acme Capital Group'), { kind: 'name', value: 'Acme Capital Group' });
  assert.deepEqual(classifyQuery('  '), { kind: 'empty', value: '' });
});

test('normalizeDomain: strips scheme/www/path and rejects non-domains', () => {
  assert.equal(normalizeDomain('HTTPS://WWW.Example.com/path'), 'example.com');
  assert.equal(normalizeDomain('plain text'), '');
  assert.equal(normalizeDomain(''), '');
});

test('checkLegit: allowlisted domain resolves from the allowlist (no network)', async () => {
  const r = await checkLegit('https://www.coinbase.com/');
  assert.ok(r, 'expected an allowlist hit');
  assert.equal(r.domain, 'coinbase.com');
  assert.equal(r.source, 'allowlist');
});

test('checkLegit: unknown domain returns null (markets-catalog best-effort, never throws)', async () => {
  const r = await checkLegit('some-unknown-domain-xyz.test');
  assert.equal(r, null);
});

test('scamSignals: empty query short-circuits with no network call', async () => {
  const r = await scamSignals('   ');
  assert.equal(r.kind, 'empty');
  assert.deepEqual(r.reports, []);
  assert.deepEqual(r.sources, []);
  assert.equal(r.riskHint, 'unknown');
});
