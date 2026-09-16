import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRotations, rotateCalldata, __setFetch, signerAddress, sendViaSigner, readSet } from './bridge-rotate-validators.mjs';

const REG = [
  '0x7b3ffad56f6973af1bbc51daf3aee3c458c1d522',
  '0xa78a867988e5acc95906a0461104b056a525fb67',
  '0xe75a81f6d2d6d4757f5add318f45c15e56f9acee',
];
const OURS = ['0x06b30eD5e71227326b9224bdB97632D453bacd87', '0x73669dfb3e78fa4a445eAb11f4652BF9cE6a015b'];

test('the module cannot sign — it imports no crypto and holds no key', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync('brain/bridge-rotate-validators.mjs', 'utf8'));
  for (const banned of ['ethers', 'secp256k1', 'Wallet', 'privateKey', 'PRANA_ATTESTER_KEY', 'vault']) {
    assert.ok(!new RegExp(`\\b${banned}\\b`).test(src.replace(/^\/\/.*$/gm, '')),
      `${banned} must not appear outside comments — this module must be unable to sign`);
  }
});

test('planRotations pairs each unusable validator with one of ours', () => {
  const plan = planRotations(REG, OURS);
  assert.equal(plan.length, 2);
  assert.equal(plan[0].to, OURS[0]);
  assert.equal(plan[1].to, OURS[1]);
  assert.ok(REG.includes(plan[0].from.toLowerCase()));
  assert.notEqual(plan[0].from, plan[1].from, 'never rotate the same seat twice');
});

test('planRotations is idempotent — an address already in the set is not re-added', () => {
  const withOurs = [...REG, OURS[0]];
  const plan = planRotations(withOurs, OURS);
  assert.equal(plan.length, 1, 'only the one not yet seated');
  assert.equal(plan[0].to, OURS[1]);
});

test('planRotations never plans more rotations than there are seats to take', () => {
  const plan = planRotations([REG[0]], OURS);
  assert.equal(plan.length, 1, 'one dead seat, one rotation — not two');
});

test('rotateCalldata encodes the verified selector and both addresses', () => {
  const d = rotateCalldata(REG[0], OURS[0]);
  // Two of four selectors were wrong when hand-guessed; this pins the verified one.
  assert.ok(d.startsWith('0x98bd1ceb'), 'rotateValidator(address,address)');
  assert.equal(d.length, 10 + 128, 'selector plus exactly two 32-byte words');
  assert.ok(d.includes(REG[0].replace(/^0x/, '')));
  assert.ok(d.includes(OURS[0].replace(/^0x/, '').toLowerCase()));
});

test('signerAddress reports the refusal instead of pretending it can act', async () => {
  __setFetch(async () => ({ json: async () => ({ ok: false, error: 'evm: no key for \'hathor\'' }) }));
  const r = await signerAddress();
  assert.equal(typeof r, 'object');
  assert.match(r.error, /no key/);
  __setFetch(null);
});

test('sendViaSigner throws on refusal rather than reporting a phantom success', async () => {
  __setFetch(async () => ({ status: 401, json: async () => ({ ok: false, error: 'invalid or revoked token' }) }));
  await assert.rejects(() => sendViaSigner({ to: '0x0', data: '0x' }), /invalid or revoked token/);
  __setFetch(null);
});

test('sendViaSigner posts a tx object and never a key', async () => {
  let seen = null;
  __setFetch(async (url, init) => { seen = { url, body: JSON.parse(init.body), headers: init.headers }; return { json: async () => ({ ok: true, result: { hash: '0xabc' } }) }; });
  const r = await sendViaSigner({ to: REG[0], data: rotateCalldata(REG[0], OURS[0]), value: '0x0' });
  assert.equal(r.hash, '0xabc');
  assert.match(seen.url, /\/v1\/evm$/);
  assert.deepEqual(Object.keys(seen.body), ['tx'], 'the body carries a tx and nothing else');
  assert.match(seen.headers.authorization, /^Bearer /);
  assert.ok(!JSON.stringify(seen.body).includes('key'));
  __setFetch(null);
});

test('readSet decodes an address array and the threshold', async () => {
  const word = (h) => String(h).replace(/^0x/, '').padStart(64, '0');
  const encoded = '0x' + word('20') + word('2') + word(REG[0]) + word(REG[1]);
  let call = 0;
  __setFetch(async () => ({ json: async () => ({ result: call++ === 0 ? encoded : '0x03' }) }));
  const s = await readSet();
  assert.equal(s.validators.length, 2);
  assert.equal(s.validators[0], '0x' + REG[0].replace(/^0x/, ''));
  assert.equal(s.threshold, 3);
  __setFetch(null);
});
