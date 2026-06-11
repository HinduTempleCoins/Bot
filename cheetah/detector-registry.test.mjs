// cheetah/detector-registry.test.mjs — OFFLINE tests for the detector bundle.
//
// Runs the REAL detectors (toxicity / scam / impersonation) through the registry
// over sample content. No network, no keys, no clock dependence.
//   cd /workspaces/Bot && node --test cheetah/detector-registry.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DETECTORS,
  registry,
  detectorKinds,
  esc,
} from './detector-registry.mjs';

// ── shape ─────────────────────────────────────────────────────────────────────
test('DETECTORS is a frozen array of {kind, run()}', () => {
  assert.ok(Array.isArray(DETECTORS));
  assert.ok(DETECTORS.length >= 3);
  assert.ok(Object.isFrozen(DETECTORS));
  for (const d of DETECTORS) {
    assert.equal(typeof d.kind, 'string');
    assert.equal(typeof d.run, 'function');
  }
  assert.deepEqual(detectorKinds().sort(), ['impersonation', 'scam', 'toxicity']);
});

// ── happy: each real detector fires on its own obvious sample ──────────────────
test('toxicity detector flags a clear harassment sample', () => {
  const tox = DETECTORS.find((d) => d.kind === 'toxicity');
  const flag = tox.run({ text: 'kill yourself, you worthless pathetic loser' });
  assert.ok(flag, 'expected a flag');
  assert.equal(flag.kind, 'harassment');
  assert.ok(flag.severity >= 1 && flag.severity <= 5);
  assert.equal(typeof flag.reason, 'string');
});

test('scam detector flags a seed-phrase ask (text) and uses links', () => {
  const scam = DETECTORS.find((d) => d.kind === 'scam');
  const flag = scam.run({
    text: 'enter your 12 word seed recovery phrase to validate your wallet',
    links: ['https://metamask-support.example.com'],
  });
  assert.ok(flag, 'expected a flag');
  assert.equal(flag.kind, 'scam');
  assert.ok(flag.severity >= 4); // seed-phrase floor
});

test('impersonation detector flags a homoglyph of a known verified account', () => {
  const imp = DETECTORS.find((d) => d.kind === 'impersonation');
  const flag = imp.run({
    account: 'hath0r',
    displayName: 'Hathor',
    bio: 'the official witness account',
    accountAgeDays: 0,
    knownAccounts: [{ account: 'hathor', displayName: 'Hathor', verified: true }],
  });
  assert.ok(flag, 'expected a flag');
  assert.equal(flag.kind, 'impersonation');
  assert.ok(flag.severity >= 3);
});

// ── happy: benign content yields no flags ──────────────────────────────────────
test('benign content produces no flags from any detector', () => {
  const content = {
    text: 'a perfectly ordinary post about gardening and tomatoes',
    account: 'gardener',
    displayName: 'Gardener',
    bio: 'I grow tomatoes',
    links: ['https://hive.blog/@gardener'],
    knownAccounts: [{ account: 'hathor', verified: true }],
    accountAgeDays: 400,
  };
  for (const d of registry()) {
    assert.equal(d.run(content), null, `${d.kind} should not flag benign content`);
  }
});

// ── bare-string content is accepted as text ────────────────────────────────────
test('a bare string content is treated as text', () => {
  const tox = DETECTORS.find((d) => d.kind === 'toxicity');
  const flag = tox.run('kill yourself you worthless loser');
  assert.ok(flag);
  assert.equal(flag.kind, 'harassment');
});

// ── filtering: only / except ───────────────────────────────────────────────────
test('registry({only}) keeps only the named kinds', () => {
  const list = registry({ only: ['scam'] });
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'scam');
});

test('registry({except}) drops the named kinds', () => {
  const list = registry({ except: ['impersonation'] });
  assert.deepEqual(list.map((d) => d.kind).sort(), ['scam', 'toxicity']);
});

test('registry({only, except}) applies only first then except', () => {
  const list = registry({ only: ['scam', 'toxicity'], except: ['toxicity'] });
  assert.deepEqual(list.map((d) => d.kind), ['scam']);
});

test('registry() with no opts returns all detectors', () => {
  assert.equal(registry().length, DETECTORS.length);
  assert.equal(registry({}).length, DETECTORS.length);
});

test('registry() with unknown only kind returns empty (no match)', () => {
  assert.equal(registry({ only: ['nope'] }).length, 0);
});

test('registry returns a fresh array (filtering does not mutate DETECTORS)', () => {
  const before = DETECTORS.length;
  const list = registry({ only: ['scam'] });
  list.push({ kind: 'x', run: () => null });
  assert.equal(DETECTORS.length, before);
});

// ── edge: missing fields never throw, just yield null ──────────────────────────
test('empty / missing content yields null from every detector, never throws', () => {
  for (const d of registry()) {
    assert.equal(d.run({}), null);
    assert.equal(d.run(undefined), null);
    assert.equal(d.run(null), null);
    assert.equal(d.run(''), null);
  }
});

test('impersonation with no account yields null (no work to do)', () => {
  const imp = DETECTORS.find((d) => d.kind === 'impersonation');
  assert.equal(imp.run({ text: 'hi', displayName: 'x' }), null);
});

test('scam with only links (no text) still runs without throwing', () => {
  const scam = DETECTORS.find((d) => d.kind === 'scam');
  const flag = scam.run({ links: ['https://hivekeychainn.example.com'] });
  // lookalike-domain may or may not clear threshold alone, but it must not throw
  assert.ok(flag === null || flag.kind === 'scam');
});

// ── soft-fail: a detector that throws internally yields null, batch survives ───
test('a detector whose underlying call throws is isolated to null', () => {
  // Build a synthetic content with a getter that throws when text is read by ONE
  // detector path. We simulate by passing a content object whose `text` throws.
  const hostile = {};
  Object.defineProperty(hostile, 'text', { get() { throw new Error('boom'); }, enumerable: true });
  Object.defineProperty(hostile, 'account', { get() { return 'safe'; }, enumerable: true });
  // toxicity/scam read text -> their run catches and returns null
  const tox = DETECTORS.find((d) => d.kind === 'toxicity');
  assert.equal(tox.run(hostile), null);
  // the batch as a whole never throws
  let total = 0;
  assert.doesNotThrow(() => {
    for (const d of registry()) { if (d.run(hostile)) total += 1; }
  });
  assert.equal(typeof total, 'number');
});

// ── esc() ───────────────────────────────────────────────────────────────────────
test('esc() escapes HTML metacharacters and handles null', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

// ── flags carry their kind so a sink can route them ────────────────────────────
test('every produced flag carries a kind, severity, and reason', () => {
  const samples = [
    { text: 'kill yourself worthless loser', account: 'a' },
    { text: 'send your seed recovery phrase to validate wallet', account: 'b', links: [] },
    { account: 'hath0r', displayName: 'Hathor', knownAccounts: [{ account: 'hathor', verified: true }], accountAgeDays: 0 },
  ];
  for (const c of samples) {
    for (const d of registry()) {
      const flag = d.run(c);
      if (!flag) continue;
      assert.equal(typeof flag.kind, 'string');
      assert.ok(flag.kind.length > 0);
      assert.ok(Number.isFinite(flag.severity));
      assert.equal(typeof flag.reason, 'string');
    }
  }
});
