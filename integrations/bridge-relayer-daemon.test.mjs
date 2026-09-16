import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSignerSubmit } from './bridge-relayer-daemon.mjs';

const CALL = {
  args: [
    '0x' + '11'.repeat(32),                                  // depositRef
    '0x' + '22'.repeat(32),                                  // tokenId
    '0x026d69cB54B82a805b6aaE60718C4877124D8d11',            // recipient
    123456789n,                                              // amount
  ],
};
const BRIDGE = '0xf8245a4c9A8af47760C45D8393A74Ea8EEF1E505';

test('the signer submit sends calldata and never a key', async () => {
  let seen = null;
  const submit = makeSignerSubmit({
    signerUrl: 'https://signer.example/', signerToken: 'tok', bridgeAddress: BRIDGE,
    fetchImpl: async (u, i) => { seen = { u, body: JSON.parse(i.body), headers: i.headers }; return { json: async () => ({ ok: true, result: { hash: '0xdeadbeef' } }) }; },
  });
  const hash = await submit(CALL);
  assert.equal(hash, '0xdeadbeef');
  assert.equal(seen.u, 'https://signer.example/v1/evm');
  assert.deepEqual(Object.keys(seen.body), ['tx'], 'body carries a tx and nothing else');
  assert.equal(seen.body.tx.to, BRIDGE);
  assert.match(seen.headers.authorization, /^Bearer tok$/);
  // attestDeposit(bytes32,bytes32,address,uint256) — selector plus four 32-byte words.
  assert.equal(seen.body.tx.data.length, 10 + 4 * 64);
  const blob = JSON.stringify(seen);
  for (const bad of ['privateKey', 'PRANA_ATTESTER_KEY', 'wif']) assert.ok(!blob.includes(bad));
});

test('the calldata carries every argument the bridge needs', async () => {
  let data = null;
  const submit = makeSignerSubmit({ signerUrl: 'https://s', signerToken: 't', bridgeAddress: BRIDGE,
    fetchImpl: async (u, i) => { data = JSON.parse(i.body).tx.data; return { json: async () => ({ ok: true, result: { hash: '0x1' } }) }; } });
  await submit(CALL);
  assert.ok(data.includes('11'.repeat(32)), 'depositRef');
  assert.ok(data.includes('22'.repeat(32)), 'tokenId');
  assert.ok(data.toLowerCase().includes('026d69cb54b82a805b6aae60718c4877124d8d11'), 'recipient');
  assert.ok(data.endsWith((123456789).toString(16).padStart(64, '0')), 'amount');
});

test('a signer refusal THROWS, so the runner records a failure and not a phantom attestation', async () => {
  const submit = makeSignerSubmit({ signerUrl: 'https://s', signerToken: 't', bridgeAddress: BRIDGE,
    fetchImpl: async () => ({ status: 401, json: async () => ({ ok: false, error: 'invalid or revoked token' }) }) });
  await assert.rejects(() => submit(CALL), /invalid or revoked token/);
});

test('a non-JSON response is a refusal, not a success', async () => {
  const submit = makeSignerSubmit({ signerUrl: 'https://s', signerToken: 't', bridgeAddress: BRIDGE,
    fetchImpl: async () => ({ status: 502, json: async () => { throw new Error('not json'); } }) });
  await assert.rejects(() => submit(CALL), /HTTP 502/);
});

test('either transactionHash or hash is accepted from the signer', async () => {
  const submit = makeSignerSubmit({ signerUrl: 'https://s', signerToken: 't', bridgeAddress: BRIDGE,
    fetchImpl: async () => ({ json: async () => ({ ok: true, result: { transactionHash: '0xabc' } }) }) });
  assert.equal(await submit(CALL), '0xabc');
});

test('the daemon no longer demands a key when the signer is configured', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync('integrations/bridge-relayer-daemon.mjs', 'utf8'));
  assert.match(src, /!useSigner && !attesterKey/, 'the key is required only on the legacy path');
  assert.match(src, /new ethers\.Wallet\(attesterKey\)\.address.*local key/s,
    'a Wallet is constructed only when there is actually a local key to construct it from');
});
