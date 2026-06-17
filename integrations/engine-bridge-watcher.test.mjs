// engine-bridge-watcher.test.mjs — offline. Engine reads via a fake fetch (__setFetch); the PRANA
// attester via a fake recorder. Asserts deriveAttestation maps a deposit correctly and runOnce submits
// only valid, not-yet-seen deposits (idempotent), skipping bad memo/symbol and soft-failing on throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadConfig, fetchDeposits, deriveAttestation, runOnce, makeRunner, watcherManifest, __setFetch,
} from './engine-bridge-watcher.mjs';

const APIS_ID = '0x15291c3579d5fce0385d4e15eb440c23db4c48c8ffe26f3ddcd7d7011a265ed2'; // keccak256("APIS")
const RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

const cfg = () => loadConfig({
  ENGINE_API_URL: 'http://engine.local',
  PRANA_RPC_URL: 'http://prana.local/rpc',
  GRAPHENE_BRIDGE_ADDRESS: '0x04C89607413713Ec9775E14b954286519d836FEf',
  BRIDGE_SYMBOLS: 'APIS',
  BRIDGE_TOKEN_IDS: JSON.stringify({ APIS: APIS_ID }),
  PRANA_ATTESTER_KEY: 'present-only',
});

function installEngine(rows) {
  __setFetch(async (url) => {
    const wantSymbol = new URL(url).searchParams.get('symbol');
    const out = wantSymbol ? rows.filter((r) => r.symbol === wantSymbol) : rows;
    return { json: async () => out };
  });
}

const dep = (over = {}) => ({ txId: 'engtx1', from: 'alice', to: 'melekbridge', symbol: 'APIS', quantity: '12.500', precision: 3, memo: RECIPIENT, block: 10, attested: false, ...over });

test('deriveAttestation maps a deposit to attestDeposit(ref, tokenId, recipient, 18dp amount)', () => {
  const r = deriveAttestation(dep(), cfg());
  assert.equal(r.ok, true);
  assert.equal(r.call.method, 'attestDeposit');
  assert.equal(r.call.args[1], APIS_ID);
  assert.equal(r.call.args[2], RECIPIENT);
  assert.equal(r.call.args[3], '12500000000000000000'); // 12.5 APIS -> 18dp
  assert.match(r.call.args[0], /^0x[0-9a-f]{64}$/);      // depositRef padded to bytes32
});

test('deriveAttestation rejects bad memo / unbridged symbol / bad amount', () => {
  assert.equal(deriveAttestation(dep({ memo: 'not-an-address' }), cfg()).reason, 'bad-recipient-memo');
  assert.equal(deriveAttestation(dep({ symbol: 'TEMPLE' }), cfg()).reason, 'symbol-not-bridged');
  assert.equal(deriveAttestation(dep({ quantity: '0' }), cfg()).reason, 'bad-amount');
  assert.equal(deriveAttestation(null, cfg()).reason, 'bad-row');
});

test('runOnce submits ONE attestation for a valid, unseen deposit', async () => {
  installEngine([dep()]);
  const calls = [];
  const r = await runOnce(cfg(), (call, d) => { calls.push({ call, d }); return { txHash: '0xfeed' }; }, {});
  assert.equal(r.ok, true);
  assert.equal(r.submitted.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(r.submitted[0].symbol, 'APIS');
  assert.equal(r.submitted[0].recipient, RECIPIENT);
});

test('an already-attested deposit is skipped, never submitted', async () => {
  installEngine([dep({ attested: true })]);
  const calls = [];
  const r = await runOnce(cfg(), (c) => { calls.push(c); return 1; }, {});
  assert.equal(calls.length, 0);
  assert.ok(r.skipped.some((s) => s.reason === 'already-attested'));
});

test('a re-run does NOT resubmit the same txId (idempotent)', async () => {
  installEngine([dep()]);
  const calls = [];
  const runner = makeRunner((c) => { calls.push(c); return { ok: true }; }, cfg());
  const r1 = await runner.tick();
  const r2 = await runner.tick();
  assert.equal(r1.submitted.length, 1);
  assert.equal(r2.submitted.length, 0);
  assert.equal(calls.length, 1);
});

test('submit throwing soft-fails: recorded in failed[], txId left UNSEEN for retry', async () => {
  installEngine([dep()]);
  const ctx = {};
  const r1 = await runOnce(cfg(), () => { throw new Error('prana down'); }, ctx);
  assert.equal(r1.ok, true);
  assert.equal(r1.failed.length, 1);
  assert.equal(ctx.seen.has('engtx1'), false);
  const ok = [];
  const r2 = await runOnce(cfg(), (c) => { ok.push(c); return 1; }, ctx);
  assert.equal(r2.submitted.length, 1);
});

test('runOnce soft-fails with no submit fn / engine read error', async () => {
  assert.equal((await runOnce(cfg(), null, {})).reason, 'no-submit-fn');
  __setFetch(async () => { throw new Error('boom'); });
  const r = await runOnce(cfg(), () => 1, {});
  assert.equal(r.ok, true);            // loop didn't crash
  assert.ok(r.skipped.some((s) => /boom/.test(s.reason)));
});

test('fetchDeposits soft-fails with no engine api', async () => {
  const r = await fetchDeposits(loadConfig({}), 'APIS');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-engine-api');
});

test('watcherManifest exposes env names, never the key value', () => {
  const m = watcherManifest();
  assert.equal(m.env.engineApi.name, 'ENGINE_API_URL');
  assert.match(m.boundary, /SIGNS nothing/);
});

test('cleanup', () => { __setFetch(); });
