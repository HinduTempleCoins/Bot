// bot-checker.test.mjs — OFFLINE tests for the read-only bot-checker harness (#228).
// No network, no real secrets, no live bots. Every probe is an injected offline fake; the clock is
// injected. Run: node --test integrations/bot-checker.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';

import {
  CHECKS,
  runChecks,
  health,
  BOT_CHECK_APIS,
  renderReport,
  dataNote,
  recordToOperatorTier,
  assertReadOnly,
} from './bot-checker.mjs';

const FIXED_NOW = Date.UTC(2026, 5, 4, 12, 0, 0);

// All-green probe set (every probeKey present, all return healthy).
function greenProbes(callLog) {
  const ok = (k) => (ctx) => { if (callLog) callLog.push(k); return { ok: true }; };
  return {
    telegramResponds: ok('telegramResponds'),
    telegramOperatorLock: ok('telegramOperatorLock'),
    tradebotDryRun: ok('tradebotDryRun'),
    tradebotBleedGuard: ok('tradebotBleedGuard'),
    witnessProducing: ok('witnessProducing'),
    discordUp: ok('discordUp'),
  };
}

// ── runChecks ─────────────────────────────────────────────────────────────────────────────────────
test('runChecks runs every probe and returns one result per check', async () => {
  const calls = [];
  const results = await runChecks({ probes: greenProbes(calls), now: FIXED_NOW });
  assert.equal(results.length, CHECKS.length);
  assert.ok(results.every((r) => r.ok), 'all green');
  // each result has the expected shape
  for (const r of results) {
    assert.equal(typeof r.check, 'string');
    assert.equal(typeof r.ok, 'boolean');
    assert.equal(typeof r.detail, 'string');
    assert.equal(typeof r.ms, 'number');
  }
  // every probe was actually called
  assert.equal(calls.length, CHECKS.length);
});

test('runChecks soft-fails a probe that throws (never throws out)', async () => {
  const probes = greenProbes();
  probes.tradebotDryRun = () => { throw new Error('boom'); };
  const results = await runChecks({ probes, now: FIXED_NOW });
  const r = results.find((x) => x.check === 'tradebot-dry-run-executes');
  assert.equal(r.ok, false);
  assert.match(r.detail, /probe threw: boom/);
  // the rest still pass
  assert.ok(results.filter((x) => x.check !== 'tradebot-dry-run-executes').every((x) => x.ok));
});

test('runChecks handles a missing probe as a failed check', async () => {
  const probes = greenProbes();
  delete probes.discordUp;
  const results = await runChecks({ probes, now: FIXED_NOW });
  const r = results.find((x) => x.check === 'discord-up');
  assert.equal(r.ok, false);
  assert.match(r.detail, /no probe supplied/);
});

test('runChecks treats a falsy/unhealthy probe result as a failed check', async () => {
  const probes = greenProbes();
  probes.witnessProducing = () => ({ producing: false, detail: 'missed 3 blocks' });
  const results = await runChecks({ probes, now: FIXED_NOW });
  const r = results.find((x) => x.check === 'witness-producing');
  assert.equal(r.ok, false);
  assert.match(r.detail, /missed 3 blocks/);
});

test('runChecks awaits async probes and accepts a bare boolean', async () => {
  const probes = greenProbes();
  probes.telegramResponds = async () => true;
  const results = await runChecks({ probes, now: FIXED_NOW });
  assert.ok(results.find((x) => x.check === 'telegram-responds').ok);
});

// ── health roll-up ──────────────────────────────────────────────────────────────────────────────────
test('health rolls up GREEN when all checks are up', async () => {
  const results = await runChecks({ probes: greenProbes(), now: FIXED_NOW });
  const h = health(results);
  assert.equal(h.status, 'green');
  assert.equal(h.up, h.total);
  assert.deepEqual(h.failing, []);
});

test('health rolls up AMBER and lists the failing checks', async () => {
  const probes = greenProbes();
  probes.tradebotBleedGuard = () => ({ ok: false });
  const results = await runChecks({ probes, now: FIXED_NOW });
  const h = health(results);
  assert.equal(h.status, 'amber');
  assert.ok(h.up < h.total && h.up > 0);
  assert.deepEqual(h.failing, ['tradebot-bleed-guard-active']);
});

test('health rolls up RED when every check fails', () => {
  const results = CHECKS.map((c) => ({ check: c.name, ok: false }));
  const h = health(results);
  assert.equal(h.status, 'red');
  assert.equal(h.up, 0);
  assert.equal(h.failing.length, CHECKS.length);
});

test('health is RED on empty/missing results', () => {
  assert.equal(health([]).status, 'red');
  assert.equal(health(undefined).status, 'red');
  assert.equal(health(null).total, 0);
});

// ── BOT_CHECK_APIS catalog ────────────────────────────────────────────────────────────────────────
test('BOT_CHECK_APIS has ~10 entries each with name+url+access', () => {
  assert.ok(Array.isArray(BOT_CHECK_APIS));
  assert.ok(BOT_CHECK_APIS.length >= 10, `expected ~10 monitor APIs, got ${BOT_CHECK_APIS.length}`);
  for (const a of BOT_CHECK_APIS) {
    assert.equal(typeof a.name, 'string');
    assert.ok(a.name.length > 0);
    assert.match(a.url, /^https?:\/\//);
    assert.equal(typeof a.access, 'string');
    assert.ok(a.access.length > 0);
  }
});

test('BOT_CHECK_APIS access is keyless or an ENV-VAR NAME — never a value/secret literal', () => {
  // An access value must be exactly 'keyless' OR an UPPER_SNAKE env-var NAME. It must NEVER look like a
  // secret value: no long base64/hex blobs, no flat literal that is itself a token-name-shaped secret.
  for (const a of BOT_CHECK_APIS) {
    if (a.access === 'keyless') continue;
    // env-var NAME shape: UPPER_SNAKE_CASE, assembled at runtime in source via .join('_')
    assert.match(a.access, /^[A-Z][A-Z0-9_]+$/, `${a.name}: access should be an env NAME, got '${a.access}'`);
    // sanity: not an obvious secret value (no spaces, not absurdly long, not base64-ish payload)
    assert.ok(a.access.length <= 64, `${a.name}: access NAME implausibly long (looks like a value)`);
    assert.ok(!/[a-z]/.test(a.access), `${a.name}: env NAME should be upper-case only`);
  }
});

// ── renderReport ────────────────────────────────────────────────────────────────────────────────────
test('renderReport shows status header and per-check lines', async () => {
  const results = await runChecks({ probes: greenProbes(), now: FIXED_NOW });
  const md = renderReport(results);
  assert.match(md, /### Bot-checker/);
  assert.match(md, /Status: GREEN/);
  assert.match(md, /Telegram bot responds/);
});

test('renderReport escapes probe-supplied detail (no markdown/link injection)', async () => {
  const probes = greenProbes();
  probes.discordUp = () => ({ ok: false, detail: '[pwn](http://evil.example) `code` *bold*' });
  const results = await runChecks({ probes, now: FIXED_NOW });
  const md = renderReport(results);
  // the raw markdown link/backtick/asterisk must be escaped — none of the structural chars survive raw
  assert.ok(!md.includes('[pwn](http://evil.example)'), 'link must be escaped');
  assert.ok(md.includes('\\[pwn\\]'), 'brackets escaped');
  assert.ok(md.includes('\\`code\\`'), 'backticks escaped');
});

test('renderReport on empty results is RED with a no-results note', () => {
  const md = renderReport([]);
  assert.match(md, /Status: RED/);
  assert.match(md, /no results/);
});

// ── read-only invariant ────────────────────────────────────────────────────────────────────────────
test('read-only: runChecks only ever calls the injected probe fns', async () => {
  // Sentinel object whose ONLY method, if reached, would record a forbidden side-effect. We give it as
  // ctx — the harness must never invoke methods on ctx or on a probe object; it only calls probe fns.
  const forbidden = [];
  const tripwire = {
    sendMessage: () => forbidden.push('sendMessage'),
    placeOrder: () => forbidden.push('placeOrder'),
    execute: () => forbidden.push('execute'),
  };
  const seen = [];
  const probes = greenProbes(seen);
  const results = await runChecks({ probes, now: FIXED_NOW, ctx: { client: tripwire } });
  assert.equal(forbidden.length, 0, 'no side-effecting method was ever called');
  assert.equal(seen.length, CHECKS.length, 'every injected probe fn was called exactly once');
  assert.ok(results.every((r) => r.ok));
});

test('assertReadOnly accepts an all-function probe map and returns its keys', () => {
  const keys = assertReadOnly(greenProbes());
  assert.deepEqual(keys.sort(), [
    'discordUp', 'telegramOperatorLock', 'telegramResponds',
    'tradebotBleedGuard', 'tradebotDryRun', 'witnessProducing',
  ].sort());
});

test('assertReadOnly throws on a non-function probe value', () => {
  assert.throws(() => assertReadOnly({ telegramResponds: { client: 'wired-up' } }), /not a function/);
  assert.throws(() => assertReadOnly({ x: 'some-string-not-a-fn' }), /not a function/);
  assert.throws(() => assertReadOnly(null), /must be an object map/);
  assert.throws(() => assertReadOnly([() => {}]), /must be an object map/);
});

// ── recordToOperatorTier ────────────────────────────────────────────────────────────────────────────
// Offline fake of the audience-store diagnostics surface, separated by tier namespace.
function fakeAudienceStore() {
  const buckets = new Map(); // tier -> Map(name -> data)
  return {
    diagnosticsStore(audience) {
      const tier = audience === 'operator' ? 'operator' : 'ai';
      const ns = `diagnostics:${tier}`;
      if (!buckets.has(tier)) buckets.set(tier, new Map());
      const m = buckets.get(tier);
      return {
        audience, tier, namespace: ns,
        write(name, data) { m.set(name, data); return { ok: true, namespace: ns, name }; },
        read(name) { return m.has(name) ? { ok: true, data: m.get(name) } : { ok: false, notFound: true }; },
        list() { return Array.from(m.keys()); },
      };
    },
    _bucket: (tier) => buckets.get(tier),
  };
}

test('recordToOperatorTier writes to the OPERATOR namespace only', async () => {
  const store = fakeAudienceStore();
  const results = await runChecks({ probes: greenProbes(), now: FIXED_NOW });
  const r = recordToOperatorTier(results, { store, now: FIXED_NOW });
  assert.equal(r.ok, true);
  assert.equal(r.namespace, 'diagnostics:operator');
  // it landed in the operator bucket and NOT in the ai bucket
  const opBucket = store._bucket('operator');
  assert.ok(opBucket && opBucket.size === 1);
  assert.equal(store._bucket('ai'), undefined, 'nothing written to the ai tier');
  // payload carries the rolled-up status
  const [, payload] = Array.from(opBucket.entries())[0];
  assert.equal(payload.status, 'green');
  assert.equal(payload.total, CHECKS.length);
});

test('recordToOperatorTier accepts a diagnosticsStore handle directly', async () => {
  const store = fakeAudienceStore();
  const handle = store.diagnosticsStore('operator');
  const results = await runChecks({ probes: greenProbes(), now: FIXED_NOW });
  const r = recordToOperatorTier(results, { store: handle, now: FIXED_NOW });
  assert.equal(r.ok, true);
  assert.equal(store._bucket('operator').size, 1);
});

test('recordToOperatorTier refuses to write to a non-operator tier', async () => {
  const store = fakeAudienceStore();
  const aiHandle = store.diagnosticsStore('ai'); // wrong tier on purpose
  const results = await runChecks({ probes: greenProbes(), now: FIXED_NOW });
  const r = recordToOperatorTier(results, { store: aiHandle, now: FIXED_NOW });
  assert.equal(r.ok, false);
  assert.match(r.reason, /non-operator tier/);
});

test('recordToOperatorTier soft-fails (no throw) when no store is available', async () => {
  const results = await runChecks({ probes: greenProbes(), now: FIXED_NOW });
  const r = recordToOperatorTier(results, {}); // no store, none injected
  assert.equal(r.ok, false);
  assert.match(r.reason, /no operator diagnostics store/);
});

// ── dataNote ────────────────────────────────────────────────────────────────────────────────────────
test('dataNote describes the read-only, operator-tier posture', () => {
  const n = dataNote();
  assert.equal(typeof n, 'string');
  assert.match(n, /READ-ONLY/);
  assert.match(n, /operator/i);
});
