// bot-runner.test.mjs — OFFLINE tests for the one job executor with capability plugins.
// No network, no keys. Run ONLY: node --test integrations/bot-runner.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerPlugin,
  runJob,
  PLUGINS,
  tradePlugin,
  miningPlugin,
  watcherPlugin,
  wearablePlugin,
} from './bot-runner.mjs';

test('the four built-in plugins are registered', () => {
  for (const t of ['trade', 'mining', 'watcher', 'wearable']) {
    assert.equal(typeof PLUGINS.get(t), 'function', `plugin "${t}" registered`);
  }
});

test('registerPlugin + runJob routes a job to the right plugin', async () => {
  const calls = [];
  registerPlugin('echo', async (job) => {
    calls.push(job.type);
    return { echoed: job.params?.msg ?? null };
  });
  const out = await runJob({ type: 'echo', capability: 'x', params: { msg: 'hi' } }, {});
  assert.equal(out.ok, true);
  assert.equal(out.type, 'echo');
  assert.deepEqual(calls, ['echo']);
  assert.equal(out.result.echoed, 'hi');
});

test('runJob routes each type to its own plugin', async () => {
  const grants = {
    cap: { ref: 'vault://capabilities/cap', scope: 'test' },
  };
  const trade = await runJob({ type: 'trade', capability: 'cap', params: {} }, grants);
  const mining = await runJob({ type: 'mining', capability: 'cap', params: {} }, grants);
  const watcher = await runJob({ type: 'watcher', capability: 'cap', params: {} }, grants);
  const wearable = await runJob({ type: 'wearable', capability: 'cap', params: {} }, grants);
  assert.equal(trade.result.type, 'trade');
  assert.equal(mining.result.type, 'mining');
  assert.equal(watcher.result.type, 'watcher');
  assert.equal(wearable.result.type, 'wearable');
});

test('the capability (a handle) is passed to the plugin — NOT a secret', async () => {
  let seen;
  registerPlugin('probe', async (_job, capability) => {
    seen = capability;
    return {};
  });
  const grants = {
    'signer:wallet': {
      ref: 'vault://capabilities/signer:wallet',
      scope: 'transfer:capped',
      // a secret intentionally placed on the grant — it must NOT propagate to the plugin
      secret: 'WIF-SHOULD-NEVER-LEAK',
      token: 'bearer-should-never-leak',
    },
  };
  await runJob({ type: 'probe', capability: 'signer:wallet', params: {} }, grants);
  assert.equal(seen.granted, true);
  assert.equal(seen.name, 'signer:wallet');
  assert.equal(seen.ref, 'vault://capabilities/signer:wallet');
  assert.equal(seen.scope, 'transfer:capped');
  // the handle carries no secret material
  assert.equal(seen.secret, undefined);
  assert.equal(seen.token, undefined);
  assert.equal(JSON.stringify(seen).includes('WIF-SHOULD-NEVER-LEAK'), false);
  assert.equal(JSON.stringify(seen).includes('bearer-should-never-leak'), false);
});

test('an ungranted capability yields a not-granted handle', async () => {
  let seen;
  registerPlugin('probe2', async (_job, capability) => {
    seen = capability;
    return {};
  });
  await runJob({ type: 'probe2', capability: 'missing', params: {} }, {});
  assert.equal(seen.granted, false);
  assert.equal(seen.name, 'missing');
});

test('settlement defaults to SIMULATED (no real value moves)', async () => {
  // mining settles to one wallet; with default sign it must be simulated
  const grants = { 'pool:rewards': { ref: 'vault://capabilities/pool:rewards', scope: 'claim' } };
  const out = await runJob(
    { type: 'mining', capability: 'pool:rewards', params: { wallet: 'hathor', amount: 5 } },
    grants,
  );
  assert.equal(out.result.settles, true);
  assert.equal(out.result.settled.simulated, true);
  assert.equal(out.result.settled.broadcast, false);
});

test('wearable settlement is gated — no settle unless the gate passes', async () => {
  const grants = { 'signer:wallet': { ref: 'vault://capabilities/signer:wallet', scope: 'transfer' } };
  const blocked = await runJob(
    { type: 'wearable', capability: 'signer:wallet', params: { wallet: 'hathor', amount: 1, gate: false } },
    grants,
  );
  assert.equal(blocked.result.settled.simulated, true);
  assert.equal(blocked.result.settled.reason, 'gate-not-passed');

  const passed = await runJob(
    { type: 'wearable', capability: 'signer:wallet', params: { wallet: 'hathor', amount: 1, gate: true } },
    grants,
  );
  assert.equal(passed.result.gatePassed, true);
  assert.equal(passed.result.settled.simulated, true); // default sign is still DRY-RUN
});

test('an injected sign grant is used for settlement (still controllable, default simulated)', async () => {
  let signedIntent = null;
  const grants = {
    'pool:rewards': { ref: 'vault://capabilities/pool:rewards', scope: 'claim' },
    sign: async (intent) => {
      signedIntent = intent;
      return { simulated: true, broadcast: false, viaInjectedSign: true };
    },
  };
  const out = await runJob(
    { type: 'mining', capability: 'pool:rewards', params: { wallet: 'hathor', amount: 3, asset: 'MELEK' } },
    grants,
  );
  assert.equal(out.result.settled.viaInjectedSign, true);
  assert.equal(signedIntent.op, 'transfer');
  assert.equal(signedIntent.to, 'hathor');
});

test('trade keeps custody with the user — never settles', async () => {
  const out = await runJob({ type: 'trade', capability: 'exchange:read', params: { market: 'M:H', side: 'buy', amount: 1 } }, {});
  assert.equal(out.result.settles, false);
  assert.equal(out.result.custody, 'user');
  assert.equal(out.result.action.kind, 'trade-intent');
});

test('watcher only notifies — never signs or settles', async () => {
  const out = await runJob({ type: 'watcher', capability: 'alert:telegram', params: { channel: 'telegram', subject: 's', body: 'b' } }, {});
  assert.equal(out.result.settles, false);
  assert.equal(out.result.notify.kind, 'notify-intent');
});

test('unknown job type soft-fails (no throw)', async () => {
  const out = await runJob({ type: 'nope', capability: 'x', params: {} }, {});
  assert.equal(out.ok, false);
  assert.match(out.error, /no plugin registered/);
});

test('plugin stubs are exported and callable directly', async () => {
  assert.equal(typeof tradePlugin, 'function');
  assert.equal(typeof miningPlugin, 'function');
  assert.equal(typeof watcherPlugin, 'function');
  assert.equal(typeof wearablePlugin, 'function');
  const r = await tradePlugin({ params: {} }, { name: 'c', granted: true }, {});
  assert.equal(r.type, 'trade');
});

test('registerPlugin rejects bad input', () => {
  assert.throws(() => registerPlugin('', () => {}));
  assert.throws(() => registerPlugin('x', 'not-a-fn'));
});
