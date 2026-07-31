// welcome-grant-queue.test.mjs — offline tests for the LIQUID-SAFE welcome.
// Fully offline: injected deps + in-memory fs + fixed clock. node:test + node:assert/strict.
//   cd /workspaces/Bot && node --test signup/welcome-grant-queue.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  welcomeWithGrant,
  fulfillQueuedGrants,
  getLiquidBalance,
  loadQueue,
  enqueueGrant,
  numericAmount,
  __setFs,
  __setFetch,
  __setClock,
  WELCOME_SYMBOL,
} from './welcome-grant-queue.mjs';

// ── in-memory fs seam ──────────────────────────────────────────────────────────────────────────
function makeMemFs(initial = {}) {
  const files = { ...initial };
  return {
    files,
    fs: {
      readFile: async (p) => {
        if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
        return files[p];
      },
      writeFile: async (p, data) => { files[p] = String(data); },
    },
  };
}

// ── fake chain deps ────────────────────────────────────────────────────────────────────────────
function makeDeps({ balance = 0 } = {}) {
  const calls = { delegate: [], transfer: [], pingWelcome: [] };
  return {
    calls,
    deps: {
      delegate: async (a) => { calls.delegate.push(a); return { id: 'tx-del-1' }; },
      transfer: async (a) => { calls.transfer.push(a); return { id: 'tx-grant-1' }; },
      pingWelcome: async (a) => { calls.pingWelcome.push(a); return { id: 'tx-ping-1' }; },
      getLiquidBalance: async () => balance,
    },
  };
}

const QP = 'queue.json';

beforeEach(() => {
  __setClock(() => 1000); // fixed epoch for deterministic queuedAt
  __setFetch(false);      // no real network
});

// ── unit: numericAmount / getLiquidBalance ───────────────────────────────────────────────────────

test('numericAmount parses asset strings and numbers', () => {
  assert.equal(numericAmount('5.000 TESTS'), 5);
  assert.equal(numericAmount('12.500 MELEK'), 12.5);
  assert.equal(numericAmount(7), 7);
  assert.equal(numericAmount('garbage'), 0);
  assert.equal(numericAmount(null), 0);
});

test('getLiquidBalance uses injected fetch → condenser_api.get_accounts', async () => {
  __setFetch(async () => ({ ok: true, json: async () => ({ result: [{ balance: '42.000 TESTS' }] }) }));
  const b = await getLiquidBalance('hathor', { rpcUrl: 'http://rpc' });
  assert.equal(b, 42);
});

test('getLiquidBalance soft-nulls on transport error / no rpcUrl', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  assert.equal(await getLiquidBalance('hathor', { rpcUrl: 'http://rpc' }), null);
  assert.equal(await getLiquidBalance('hathor', {}), null); // no rpcUrl
});

// ── SUFFICIENT LIQUID: transfer attempted ────────────────────────────────────────────────────────

test('sufficient liquid: delegation + transfer + ping all fire, nothing queued', async () => {
  const { fs, files } = makeMemFs();
  __setFs(fs);
  const { deps, calls } = makeDeps({ balance: 100 });

  const out = await welcomeWithGrant('newbie-tests', deps, { grant: 7, queuePath: QP });

  assert.equal(out.ok, true);
  assert.equal(out.delegated, 'tx-del-1');
  assert.equal(out.granted, 'tx-grant-1');       // transfer WAS attempted
  assert.equal(out.pinged, 'tx-ping-1');
  assert.equal(out.queued, false);
  assert.equal(out.amount, `7.000 ${WELCOME_SYMBOL}`);
  assert.equal(calls.transfer.length, 1);
  assert.equal(calls.transfer[0].amount, `7.000 ${WELCOME_SYMBOL}`);
  assert.equal(files[QP], undefined);            // queue never written
});

// ── INSUFFICIENT LIQUID: transfer SKIPPED, delegation done, intent queued ─────────────────────────

test('insufficient liquid: transfer SKIPPED (not broadcast), delegation still done, intent queued', async () => {
  const { fs } = makeMemFs();
  __setFs(fs);
  const { deps, calls } = makeDeps({ balance: 0 }); // ZERO liquid chain-wide

  const out = await welcomeWithGrant('newbie-tests', deps, { grant: 7, queuePath: QP });

  assert.equal(out.delegated, 'tx-del-1');        // POWER delegation guaranteed
  assert.equal(out.granted, null);                // grant NOT granted
  assert.equal(calls.transfer.length, 0);         // transfer NEVER broadcast (not doomed/dust)
  assert.equal(out.pinged, 'tx-ping-1');          // ping still fires
  assert.equal(out.queued, true);                 // intent recorded
  assert.equal(out.ok, true);                     // guaranteed parts landed → still ok
  assert.ok(out.errors.some((e) => e.includes('skipped-insufficient-liquid')));

  const q = await loadQueue(QP);
  assert.equal(q.length, 1);
  assert.equal(q[0].account, 'newbie-tests');
  assert.equal(q[0].asset, `7.000 ${WELCOME_SYMBOL}`);
  assert.equal(q[0].reason, 'insufficient-liquid');
  assert.equal(q[0].queuedAt, 1000);
});

test('unknown balance (fetch fails): treated as cannot-afford → skip + queue', async () => {
  const { fs } = makeMemFs();
  __setFs(fs);
  __setFetch(async () => { throw new Error('rpc down'); });
  const { deps, calls } = makeDeps();
  delete deps.getLiquidBalance; // force the fetch path

  const out = await welcomeWithGrant('newbie-tests', deps, { grant: 5, rpcUrl: 'http://rpc', queuePath: QP });

  assert.equal(out.balance, null);
  assert.equal(calls.transfer.length, 0);
  assert.equal(out.queued, true);
  assert.ok(out.errors.some((e) => e.includes('balance-unknown')));
});

test('reserve is respected: balance above grant but not above grant+reserve → skip + queue', async () => {
  const { fs } = makeMemFs();
  __setFs(fs);
  const { deps, calls } = makeDeps({ balance: 8 });

  const out = await welcomeWithGrant('newbie-tests', deps, { grant: 5, reserve: 5, queuePath: QP });
  // 8 - 5(reserve) = 3 < 5(grant) → not affordable
  assert.equal(calls.transfer.length, 0);
  assert.equal(out.queued, true);
});

// ── fulfillQueuedGrants ─────────────────────────────────────────────────────────────────────────

test('fulfillQueuedGrants pays a queued grant once balance allows', async () => {
  // Seed a queue with one intent.
  const seeded = JSON.stringify([
    { account: 'newbie-tests', asset: `7.000 ${WELCOME_SYMBOL}`, amount: 7, memo: 'Welcome to MELEK', reason: 'insufficient-liquid', queuedAt: 1000 },
  ]);
  const { fs, files } = makeMemFs({ [QP]: seeded });
  __setFs(fs);
  const { deps, calls } = makeDeps({ balance: 50 }); // liquid now exists

  const out = await fulfillQueuedGrants(deps, { queuePath: QP });

  assert.equal(out.paid.length, 1);
  assert.equal(out.paid[0].account, 'newbie-tests');
  assert.equal(out.paid[0].amount, `7.000 ${WELCOME_SYMBOL}`);
  assert.equal(out.remaining, 0);
  assert.equal(calls.transfer.length, 1);
  assert.deepEqual(await loadQueue(QP), []); // queue drained + persisted
});

test('fulfillQueuedGrants keeps unaffordable intents and only pays what fits (no overspend)', async () => {
  const seeded = JSON.stringify([
    { account: 'aaa-tests', asset: `6.000 ${WELCOME_SYMBOL}`, amount: 6, reason: 'x', queuedAt: 1 },
    { account: 'bbb-tests', asset: `6.000 ${WELCOME_SYMBOL}`, amount: 6, reason: 'x', queuedAt: 2 },
  ]);
  const { fs } = makeMemFs({ [QP]: seeded });
  __setFs(fs);
  const { deps, calls } = makeDeps({ balance: 7 }); // enough for ONE, not both

  const out = await fulfillQueuedGrants(deps, { queuePath: QP });

  assert.equal(out.paid.length, 1);
  assert.equal(out.paid[0].account, 'aaa-tests'); // oldest first
  assert.equal(out.remaining, 1);
  assert.equal(calls.transfer.length, 1);
  const q = await loadQueue(QP);
  assert.equal(q.length, 1);
  assert.equal(q[0].account, 'bbb-tests');
});

test('fulfillQueuedGrants soft-fails a broadcast error, keeping the intent for retry', async () => {
  const seeded = JSON.stringify([
    { account: 'newbie-tests', asset: `7.000 ${WELCOME_SYMBOL}`, amount: 7, reason: 'x', queuedAt: 1 },
  ]);
  const { fs } = makeMemFs({ [QP]: seeded });
  __setFs(fs);
  const deps = { transfer: async () => { throw new Error('boom'); }, getLiquidBalance: async () => 50 };

  const out = await fulfillQueuedGrants(deps, { queuePath: QP });
  assert.equal(out.paid.length, 0);
  assert.equal(out.remaining, 1);
  assert.ok(out.errors.some((e) => e.includes('boom')));
  assert.equal((await loadQueue(QP)).length, 1); // kept
});

test('fulfillQueuedGrants on empty queue is a clean no-op', async () => {
  const { fs } = makeMemFs();
  __setFs(fs);
  const { deps } = makeDeps({ balance: 50 });
  const out = await fulfillQueuedGrants(deps, { queuePath: QP });
  assert.deepEqual(out, { paid: [], remaining: 0, balance: null, errors: [] });
});

// ── soft-fail / edge cases (never throw) ─────────────────────────────────────────────────────────

test('invalid account: clean error report, no deps called', async () => {
  const { fs } = makeMemFs();
  __setFs(fs);
  const { deps, calls } = makeDeps({ balance: 50 });
  const out = await welcomeWithGrant('Bad Name!', deps, { grant: 5, queuePath: QP });
  assert.equal(out.ok, false);
  assert.deepEqual(out.errors, ['invalid-account-name']);
  assert.equal(calls.delegate.length, 0);
  assert.equal(calls.transfer.length, 0);
});

test('missing delegate dep: recorded, ping still fires, never throws', async () => {
  const { fs } = makeMemFs();
  __setFs(fs);
  const deps = { transfer: async () => ({ id: 't' }), pingWelcome: async () => ({ id: 'p' }), getLiquidBalance: async () => 100 };
  const out = await welcomeWithGrant('newbie-tests', deps, { grant: 5, queuePath: QP });
  assert.equal(out.delegated, null);
  assert.equal(out.ok, false); // delegation is a guaranteed part; missing it fails ok
  assert.equal(out.pinged, 'p');
  assert.ok(out.errors.some((e) => e.includes('no-delegate-dep')));
});

test('dust-level grant is skipped, not queued', async () => {
  const { fs } = makeMemFs();
  __setFs(fs);
  const { deps, calls } = makeDeps({ balance: 100 });
  const out = await welcomeWithGrant('newbie-tests', deps, { grant: 0.001, dustMin: 0.01, queuePath: QP });
  assert.equal(calls.transfer.length, 0);
  assert.equal(out.queued, false);
  assert.ok(out.errors.some((e) => e.includes('below-dust-floor')));
});

test('enqueueGrant de-dupes by account (re-run replaces, never double-queues)', async () => {
  const { fs } = makeMemFs();
  __setFs(fs);
  await enqueueGrant({ account: 'newbie-tests', asset: `5.000 ${WELCOME_SYMBOL}` }, { path: QP });
  await enqueueGrant({ account: 'newbie-tests', asset: `9.000 ${WELCOME_SYMBOL}` }, { path: QP });
  const q = await loadQueue(QP);
  assert.equal(q.length, 1);
  assert.equal(q[0].asset, `9.000 ${WELCOME_SYMBOL}`);
});
