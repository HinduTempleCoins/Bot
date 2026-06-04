// native-node.test.js — Tier-3 native-chain adapter (the moat). Gated behind an RPC URL env var;
// returns null (not a fake price) until a chain's RPC is configured. Injected fetch (no net).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as node from './native-node.mjs';

const jsonRes = (obj) => ({ ok: true, status: 200, json: async () => obj });
const fail = (status = 500) => ({ ok: false, status, json: async () => ({}) });

test('native-node.fetchTokens is empty until a chain is live', async () => {
  assert.deepEqual(await node.fetchTokens(), []);
});

test('native-node.fetchToken returns null when the chain is NOT configured (no fake price)', async () => {
  // RPC.melek is '' in this process (no MELEK_RPC_URL set) -> not configured -> null.
  assert.equal(node.isConfigured('melek'), false);
  node.__setFetch(async () => { throw new Error('should not fetch an unconfigured chain'); });
  assert.equal(await node.fetchToken('node:melek:MELEK'), null);
  node.__setFetch(null);
});

test('native-node.fetchToken returns null for an unknown chain segment', async () => {
  assert.equal(await node.fetchToken('node:doesnotexist:FOO'), null);
});

test('native-node.fetchOHLCV is a stub returning []', async () => {
  assert.deepEqual(await node.fetchOHLCV('node:melek:MELEK'), []);
});

// The RPC.* map is frozen at import-time from env, so we cannot flip a real chain "on" here
// without a live endpoint. To exercise the configured path + normalizer, monkey-patch isConfigured
// is not possible (const fn). Instead we verify the normalizer path indirectly: confirm that when
// isConfigured is false (the only state reachable offline) NO fetch happens and the result is null.
test('native-node never emits a fake price for an unconfigured chain even if a fetch would succeed', async () => {
  let called = false;
  node.__setFetch(async () => { called = true; return jsonRes({ result: [{ symbol: 'MELEK' }] }); });
  const c = await node.fetchToken('node:melek:MELEK');
  assert.equal(c, null);          // unconfigured -> short-circuits before any RPC
  assert.equal(called, false);    // and never touches the network
  node.__setFetch(null);
});

test('native-node.isConfigured reflects the RPC env map (all empty offline)', async () => {
  assert.equal(node.isConfigured('melek'), false);
  assert.equal(node.isConfigured('soap'), false);
  assert.equal(node.isConfigured('prana'), false);
});
