import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadConfig, decodeWithdrawalLog, baseToHeQuantity, deriveRelease,
  readWithdrawals, releaseOp, buildReleases, WITHDRAWAL_TOPIC0,
} from './hive-engine-withdrawal-watcher.mjs';

const VKBT_ID = '0x' + '11'.repeat(32); // stand-in for ethers.id("VKBT")
const CURE_ID = '0x' + '22'.repeat(32);
const UNMAPPED = '0x' + '99'.repeat(32);

const cfg = {
  pranaRpc: 'http://prana.local/rpc',
  bridgeAddress: '0x' + 'bb'.repeat(20),
  custody: 'melekbridge',
  tokenIds: { VKBT: VKBT_ID, CURE: CURE_ID },
  symbolByTokenId: { [VKBT_ID.toLowerCase()]: 'VKBT', [CURE_ID.toLowerCase()]: 'CURE' },
  sscId: 'ssc-mainnet-melek',
  withdrawalTopic0: WITHDRAWAL_TOPIC0,
  lookbackBlocks: 5000,
};

// ---- log construction helpers (no keccak needed) ---------------------------
const num32 = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
const addr32 = (a) => '0x' + '00'.repeat(12) + a.replace(/^0x/, '');
function b32str(s) { let h = ''; for (const c of s) h += c.charCodeAt(0).toString(16).padStart(2, '0'); return '0x' + h.padEnd(64, '0'); }
const wrapped = '0x' + 'cd'.repeat(20);

function makeLog({ nonce, tokenId = VKBT_ID, amountBase, dest = 'alice', topic0 = WITHDRAWAL_TOPIC0, txHash = '0x' + 'ee'.repeat(32) }) {
  return {
    topics: [topic0, num32(nonce), tokenId, addr32('0x' + 'ab'.repeat(20))],
    data: '0x' + addr32(wrapped).slice(2) + num32(amountBase).slice(2) + b32str(dest).slice(2),
    blockNumber: '0x10',
    transactionHash: txHash,
  };
}

test('baseToHeQuantity maps 8dp base units 1:1 to a HE quantity', () => {
  assert.equal(baseToHeQuantity('10000000000'), '100');    // 100.00000000
  assert.equal(baseToHeQuantity('150000000'), '1.5');
  assert.equal(baseToHeQuantity('1'), '0.00000001');
  assert.equal(baseToHeQuantity('0'), '0');
  assert.equal(baseToHeQuantity('nope'), null);
  assert.equal(baseToHeQuantity('-5'), null);
});

test('loadConfig reads env + builds the reverse tokenId map', () => {
  const c = loadConfig({
    PRANA_RPC_URL: 'http://x/rpc', GRAPHENE_BRIDGE_ADDRESS: '0xBEEF',
    HE_BRIDGE_CUSTODY: 'MelekBridge', HE_BRIDGE_TOKEN_IDS: JSON.stringify({ VKBT: VKBT_ID }),
  });
  assert.equal(c.custody, 'melekbridge');
  assert.equal(c.tokenIds.VKBT, VKBT_ID);
  assert.equal(c.symbolByTokenId[VKBT_ID.toLowerCase()], 'VKBT');
  assert.equal(c.sscId, 'ssc-mainnet-melek');
  assert.equal(c.withdrawalTopic0, WITHDRAWAL_TOPIC0.toLowerCase());
});

test('decodeWithdrawalLog + deriveRelease decode a withdrawal correctly', () => {
  const log = makeLog({ nonce: 7, amountBase: '10000000000', dest: 'alice' });
  const rel = deriveRelease(log, cfg);
  assert.ok(rel);
  assert.equal(rel.nonce, '7');
  assert.equal(rel.symbol, 'VKBT');
  assert.equal(rel.amount, '100');
  assert.equal(rel.toAccount, 'alice');
  assert.equal(rel.tokenId, VKBT_ID);
  assert.equal(rel.txHash, '0x' + 'ee'.repeat(32));
});

test('deriveRelease skips an unmapped tokenId', () => {
  assert.equal(deriveRelease(makeLog({ nonce: 1, tokenId: UNMAPPED, amountBase: '5' }), cfg), null);
});

test('deriveRelease soft-fails a bad destinationRef', () => {
  // "AB" is uppercase / too short -> not a valid Graphene/Hive account name
  assert.equal(deriveRelease(makeLog({ nonce: 2, amountBase: '5', dest: 'AB' }), cfg), null);
});

test('deriveRelease rejects a wrong topic0', () => {
  const bad = makeLog({ nonce: 3, amountBase: '5', topic0: '0x' + '00'.repeat(32) });
  assert.equal(deriveRelease(bad, cfg), null);
});

// ---- eth JSON-RPC mock -----------------------------------------------------
function rpcMock({ head, logs, fail = false }) {
  return async (url, opts) => {
    if (fail) throw new Error('network down');
    const body = JSON.parse(opts.body);
    let result = null;
    if (body.method === 'eth_blockNumber') result = '0x' + head.toString(16);
    else if (body.method === 'eth_getLogs') result = logs;
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
  };
}

test('readWithdrawals decodes logs, dedups by nonce, skips unmapped, soft-fails', async () => {
  const logs = [
    makeLog({ nonce: 10, amountBase: '10000000000', dest: 'alice' }),
    makeLog({ nonce: 10, amountBase: '10000000000', dest: 'alice' }),         // dup nonce
    makeLog({ nonce: 11, tokenId: CURE_ID, amountBase: '250000000', dest: 'bob' }),
    makeLog({ nonce: 12, tokenId: UNMAPPED, amountBase: '5', dest: 'carol' }), // unmapped -> skip
  ];
  const rels = await readWithdrawals(cfg, rpcMock({ head: 100, logs }));
  assert.equal(rels.length, 2);
  assert.deepEqual(rels.map((r) => r.nonce), ['10', '11']);
  assert.equal(rels[0].symbol, 'VKBT');
  assert.equal(rels[1].symbol, 'CURE');
  assert.equal(rels[1].amount, '2.5');

  // a thrown fetch soft-fails to []
  assert.deepEqual(await readWithdrawals(cfg, rpcMock({ fail: true })), []);
  // missing config soft-fails to []
  assert.deepEqual(await readWithdrawals({ ...cfg, pranaRpc: '' }, rpcMock({ head: 1, logs: [] })), []);
});

test('buildReleases emits correct unsigned custom_json tokens.transfer ops', async () => {
  const logs = [makeLog({ nonce: 42, amountBase: '5000000000', dest: 'alice' })]; // 50 VKBT
  const ops = await buildReleases(cfg, rpcMock({ head: 100, logs }));
  assert.equal(ops.length, 1);
  const o = ops[0];
  assert.equal(o.unsigned, true);
  assert.equal(o.nonce, '42');
  assert.equal(o.memo, 'bridge-withdraw:42');
  assert.equal(o.op[0], 'custom_json');
  assert.equal(o.op[1].id, 'ssc-mainnet-melek');
  assert.deepEqual(o.op[1].required_auths, ['melekbridge']);
  assert.deepEqual(o.op[1].required_posting_auths, []);
  const payload = JSON.parse(o.op[1].json);
  assert.equal(payload.contractName, 'tokens');
  assert.equal(payload.contractAction, 'transfer');
  assert.deepEqual(payload.contractPayload, {
    symbol: 'VKBT', to: 'alice', quantity: '50', memo: 'bridge-withdraw:42',
  });
});

test('releaseOp is idempotent-per-nonce shaped (stable memo key)', () => {
  const rel = { nonce: '9', symbol: 'CURE', amount: '1.25', toAccount: 'dave', tokenId: CURE_ID };
  const o = releaseOp(rel, cfg);
  assert.equal(o.memo, 'bridge-withdraw:9');
  assert.equal(JSON.parse(o.op[1].json).contractPayload.quantity, '1.25');
});
