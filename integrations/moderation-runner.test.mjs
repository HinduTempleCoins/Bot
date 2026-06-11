// integrations/moderation-runner.test.mjs — OFFLINE tests for the moderation runner.
//
// Coverage: harmful content files flags; clean content files none; bare-string content; injected
// fake flag-pipe; the REAL flag-pipe (in-memory store); injected custom registry; soft-fail on a
// throwing detector / bad registry entry / throwing pipe; dedupe accounting; reporter/target wiring.
// Fully offline: no network, no keys, no chain.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  runModeration,
  __setFlagPipe,
  __setRegistry,
  __getRegistry,
  esc,
} from './moderation-runner.mjs';

import * as flagPipe from './flag-pipe.mjs';

// ── a fake flag-pipe that just records calls (the simplest possible "real flag-pipe" stand-in) ──────
function fakePipe() {
  const calls = [];
  let seq = 0;
  return {
    calls,
    fileFlag(arg) {
      calls.push(arg);
      return { flag: { id: `fake_${seq++}`, ...arg }, deduped: false };
    },
  };
}

// Reset module-level seams + the real pipe's in-memory store between tests.
function resetSeams() {
  __setFlagPipe(null);     // back to the real flag-pipe module
  __setRegistry(null);     // back to the built-in registry
  if (typeof flagPipe.__setStore === 'function' && typeof flagPipe.memoryStore === 'function') {
    flagPipe.__setStore(flagPipe.memoryStore()); // fresh in-memory store
  }
}

test('harmful content (scam seed-phrase) files a flag via an injected fake pipe', async () => {
  resetSeams();
  const pipe = fakePipe();
  const out = await runModeration(
    'Please send me your seed phrase to verify your wallet',
    { flagPipe: pipe, target: '@bob/post', reporter: 'troll-box' },
  );
  assert.ok(out.flagsFiled >= 1, 'at least one flag filed');
  assert.ok(pipe.calls.length >= 1, 'fileFlag was called');
  const scamCall = pipe.calls.find((c) => c.kind === 'scam');
  assert.ok(scamCall, 'a scam flag was filed');
  assert.equal(scamCall.target, '@bob/post');
  assert.match(scamCall.reporter, /troll-box:scam/);
  // results carry the per-detector breakdown
  const scamResult = out.results.find((r) => r.name === 'scam');
  assert.ok(scamResult && scamResult.filed.length >= 1);
});

test('harmful content (toxicity/threat) files a harassment flag', async () => {
  resetSeams();
  const pipe = fakePipe();
  const out = await runModeration('you are worthless, kill yourself, nobody likes you', { flagPipe: pipe });
  const tox = pipe.calls.find((c) => c.kind === 'harassment');
  assert.ok(tox, 'a harassment flag was filed');
  assert.ok(tox.severity >= 1 && tox.severity <= 5);
  assert.ok(out.flagsFiled >= 1);
});

test('clean content files NO flags', async () => {
  resetSeams();
  const pipe = fakePipe();
  const out = await runModeration('Good morning! Lovely day to learn about the MELEK witness.', { flagPipe: pipe });
  assert.equal(out.flagsFiled, 0, 'no flags filed for clean content');
  assert.equal(pipe.calls.length, 0, 'fileFlag never called');
  // every detector ran and reported nothing filed
  assert.ok(out.results.length >= 1);
  for (const r of out.results) assert.equal(r.filed.length, 0);
});

test('works against the REAL flag-pipe (in-memory store) — harmful files, queue grows', async () => {
  resetSeams();
  const out = await runModeration('send 1 ETH get 2 ETH back, claim your free airdrop, dm me now', { target: '@scammer/x' });
  assert.ok(out.flagsFiled >= 1, 'filed into the real pipe');
  const queue = flagPipe.reviewQueue({ status: 'pending' });
  assert.ok(queue.length >= 1, 'real pipe queue has the flag');
  assert.ok(queue.some((f) => f.target === '@scammer/x'));
});

test('REAL flag-pipe: clean content leaves the queue empty', async () => {
  resetSeams();
  const out = await runModeration('Here is a friendly tutorial on staking. Welcome aboard!', { target: '@nice/post' });
  assert.equal(out.flagsFiled, 0);
  assert.equal(flagPipe.reviewQueue({ status: 'pending' }).length, 0);
});

test('bare-string content is treated as text', async () => {
  resetSeams();
  const pipe = fakePipe();
  const out = await runModeration('send me your recovery phrase now', { flagPipe: pipe });
  assert.ok(out.flagsFiled >= 1);
  assert.equal(pipe.calls[0].target, '(unknown-target)'); // no target given → best-effort placeholder
});

test('impersonation detector fires when an account + roster are supplied', async () => {
  resetSeams();
  const pipe = fakePipe();
  const out = await runModeration(
    {
      text: 'the official witness account',
      account: 'hath0r',
      displayName: 'Hathor',
      bio: 'official witness',
      accountAgeDays: 0,
      knownAccounts: [{ account: 'hathor', displayName: 'Hathor', verified: true }],
    },
    { flagPipe: pipe },
  );
  const imp = pipe.calls.find((c) => c.kind === 'impersonation');
  assert.ok(imp, 'an impersonation flag was filed');
  assert.equal(imp.target, '@hath0r'); // derived from account
});

test('injected custom registry: only the given detectors run', async () => {
  resetSeams();
  const pipe = fakePipe();
  const reg = [
    { name: 'always', run: () => ({ kind: 'spam', severity: 2, reason: 'test flag' }) },
    { name: 'never', run: () => null },
  ];
  const out = await runModeration('anything', { flagPipe: pipe, registry: reg, target: '@x/y' });
  assert.equal(out.results.length, 2);
  assert.equal(out.flagsFiled, 1);
  assert.equal(pipe.calls[0].kind, 'spam');
  assert.equal(out.results.find((r) => r.name === 'never').filed.length, 0);
});

test('registry entry returning {flags:[...]} files each flag', async () => {
  resetSeams();
  const pipe = fakePipe();
  const reg = [{
    name: 'multi',
    run: () => ({ flags: [
      { kind: 'spam', severity: 1, reason: 'a' },
      { kind: 'harassment', severity: 3, reason: 'b' },
    ] }),
  }];
  const out = await runModeration('x', { flagPipe: pipe, registry: reg, target: '@t' });
  assert.equal(out.flagsFiled, 2);
  assert.deepEqual(pipe.calls.map((c) => c.kind).sort(), ['harassment', 'spam']);
});

test('soft-fail: a throwing detector is captured, others still run', async () => {
  resetSeams();
  const pipe = fakePipe();
  const reg = [
    { name: 'boom', run: () => { throw new Error('detector exploded'); } },
    { name: 'ok', run: () => ({ kind: 'spam', severity: 2, reason: 'ok' }) },
  ];
  const out = await runModeration('x', { flagPipe: pipe, registry: reg, target: '@t' });
  const boom = out.results.find((r) => r.name === 'boom');
  assert.equal(boom.skipped, true);
  assert.match(boom.error, /exploded/);
  assert.equal(out.flagsFiled, 1, 'the healthy detector still filed');
});

test('soft-fail: an invalid registry entry is recorded, never throws', async () => {
  resetSeams();
  const pipe = fakePipe();
  const reg = [null, { name: 'noRun' }, { name: 'good', run: () => ({ kind: 'spam', severity: 2, reason: 'g' }) }];
  const out = await runModeration('x', { flagPipe: pipe, registry: reg, target: '@t' });
  assert.equal(out.flagsFiled, 1);
  assert.ok(out.results.some((r) => r.error === 'invalid-registry-entry'));
});

test('soft-fail: a throwing fileFlag does not crash the pass', async () => {
  resetSeams();
  const pipe = { fileFlag() { throw new Error('store down'); } };
  const reg = [{ name: 'd', run: () => ({ kind: 'spam', severity: 2, reason: 'x' }) }];
  const out = await runModeration('x', { flagPipe: pipe, registry: reg, target: '@t' });
  assert.equal(out.flagsFiled, 0);
  const d = out.results.find((r) => r.name === 'd');
  assert.match(d.error, /store down/);
});

test('dedupe: a second identical flag is counted as deduped, not filed twice', async () => {
  resetSeams();
  // real pipe so its (target, kind) dedup is exercised
  const reg = [{ name: 'd', run: () => ({ kind: 'spam', severity: 2, reason: 'dup' }) }];
  const a = await runModeration('x', { registry: reg, target: '@dup/post' });
  const b = await runModeration('x', { registry: reg, target: '@dup/post' });
  assert.equal(a.flagsFiled, 1);
  assert.equal(b.flagsFiled, 0, 'second pass files nothing new');
  assert.equal(b.results.find((r) => r.name === 'd').deduped.length, 1);
});

test('null / non-object content does not throw and files nothing', async () => {
  resetSeams();
  const pipe = fakePipe();
  const out1 = await runModeration(null, { flagPipe: pipe });
  const out2 = await runModeration(12345, { flagPipe: pipe });
  assert.equal(out1.flagsFiled, 0);
  assert.equal(out2.flagsFiled, 0);
  assert.equal(pipe.calls.length, 0);
});

test('built-in registry resolves to the shipped cheetah detectors', async () => {
  resetSeams();
  const reg = await __getRegistry();
  assert.ok(Array.isArray(reg));
  const names = reg.map((r) => r.name);
  assert.ok(names.includes('toxicity'));
  assert.ok(names.includes('scam'));
  assert.ok(names.includes('impersonation'));
});

test('esc() escapes HTML', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
});
