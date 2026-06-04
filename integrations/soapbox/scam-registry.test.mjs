// scam-registry.test.mjs — offline coverage for the pure catalog/classify helpers + the
// allowlist path of checkLegit + the early-return of scamSignals. The keyless live lookups
// (urlscan/EDGAR/PAUSE/CryptoScamDB/Chainabuse) hit the network and are NOT exercised here.
// No network is touched by any assertion below.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCAM_SOURCES, KINDS, govSources, queryableSources, keylessSources, byKind,
  classifyQuery, normalizeDomain, checkLegit, scamSignals, summary, LEGIT_ALLOWLIST,
} from './scam-registry.mjs';

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
