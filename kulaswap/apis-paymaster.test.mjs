// apis-paymaster.test.mjs — offline. No network: the PRANA read goes through a fake fetch (__setFetch);
// the verifying-signer goes through a fake (__setSigner). Asserts quote math (BigInt, no float), the exact
// abi.encodePacked sponsorship preimage, PaidInToken parsing, payment verification, nonce idempotency, and
// the full issueSponsorship pipeline soft-fails on every bad path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, isAddress, isTxHash, toBig, quoteGasInApis, buildSponsorshipPacked, nonceFromRef,
  parsePaidInToken, verifyPayment, planSponsorship, loadConfig, paymasterManifest,
  fetchReceipt, issueSponsorship, handler, PAID_IN_TOKEN_TOPIC0, __setFetch, __setSigner, WAD,
} from './apis-paymaster.mjs';

const PAYMASTER = '0x04C89607413713Ec9775E14b954286519d836FEf';
const APIS = '0xFD471836031dc5108809D173A067e8486B9047A3';
const USER = '0x1111111111111111111111111111111111111111';
const TXH = '0x' + 'ab'.repeat(32);

const cfg = (over = {}) => loadConfig({
  PRANA_RPC_URL: 'http://prana.local/rpc',
  PRANA_CHAIN_ID: '108369',
  VERIFYING_PAYMASTER_ADDRESS: PAYMASTER,
  APIS_TOKEN_ADDRESS: APIS,
  APIS_PER_PRANA_WEI: '2000000000000000000', // 2 APIS per PRANA
  PAYMASTER_MARGIN_BPS: '500',               // 5%
  CONFIRMATIONS: '2',
  ...over,
});

test('esc neutralizes html', () => { assert.equal(esc('<b>"x"'), '&lt;b&gt;&quot;x&quot;'); });

test('isAddress / isTxHash gate shapes', () => {
  assert.equal(isAddress(USER), true);
  assert.equal(isAddress('0x123'), false);
  assert.equal(isTxHash(TXH), true);
  assert.equal(isTxHash('0xdead'), false);
});

test('toBig parses dec/hex, rejects garbage and negatives', () => {
  assert.equal(toBig('10'), 10n);
  assert.equal(toBig('0xff'), 255n);
  assert.equal(toBig(5), 5n);
  assert.equal(toBig('abc'), null);
  assert.equal(toBig(-1), null);
  assert.equal(toBig(1.5), null);
});

test('quoteGasInApis: maxCost × rate / 1e18 × (1+margin), all BigInt', () => {
  // 1 PRANA gas budget, 2 APIS/PRANA, 5% margin -> 2 × 1.05 = 2.1 APIS
  const q = quoteGasInApis({ maxCostWei: WAD.toString(), apisPerPranaWei: '2000000000000000000', marginBps: 500 });
  assert.equal(q.ok, true);
  assert.equal(q.apisAmount, '2100000000000000000'); // 2.1 APIS
  // zero margin -> exactly 2 APIS
  assert.equal(quoteGasInApis({ maxCostWei: WAD.toString(), apisPerPranaWei: '2000000000000000000' }).apisAmount, '2000000000000000000');
});

test('quoteGasInApis soft-fails on bad input', () => {
  assert.equal(quoteGasInApis({ maxCostWei: 'x', apisPerPranaWei: '1' }).ok, false);
  assert.equal(quoteGasInApis({ maxCostWei: '1', apisPerPranaWei: '0' }).reason, 'bad-rate');
  assert.equal(quoteGasInApis({ maxCostWei: '1', apisPerPranaWei: '1', marginBps: 200000 }).reason, 'bad-margin');
});

test('buildSponsorshipPacked is exactly 136 bytes in the contract field order', () => {
  const p = buildSponsorshipPacked({ chainId: 108369, paymaster: PAYMASTER, user: USER, maxCost: '1000', nonce: '7' });
  assert.match(p, /^0x[0-9a-f]{272}$/); // 136 bytes = 272 hex
  const hex = p.slice(2);
  assert.equal(hex.slice(0, 64), (108369).toString(16).padStart(64, '0'));     // chainId uint256
  assert.equal(hex.slice(64, 104), PAYMASTER.toLowerCase().slice(2));          // paymaster 20 bytes
  assert.equal(hex.slice(104, 144), USER.toLowerCase().slice(2));              // user 20 bytes
  assert.equal(hex.slice(144, 208), (1000).toString(16).padStart(64, '0'));    // maxCost uint256
  assert.equal(hex.slice(208, 272), (7).toString(16).padStart(64, '0'));       // nonce uint256
  assert.equal(buildSponsorshipPacked({ chainId: 1, paymaster: 'bad', user: USER, maxCost: '1', nonce: '1' }), null);
});

test('nonceFromRef derives a deterministic low-128 nonce; rejects non-hex', () => {
  assert.equal(nonceFromRef('0x' + 'ab'.repeat(32)), BigInt('0x' + 'ab'.repeat(16)).toString());
  assert.equal(nonceFromRef('deadbeef'), BigInt('0xdeadbeef').toString());
  assert.equal(nonceFromRef('zzz'), null);
  assert.equal(nonceFromRef(''), null);
});

test('parsePaidInToken reads ethers-decoded and raw-log shapes', () => {
  const dec = parsePaidInToken({ args: { user: USER, token: APIS, amount: '5' } });
  assert.deepEqual(dec, { user: USER.toLowerCase(), token: APIS.toLowerCase(), amount: '5' });
  const raw = parsePaidInToken({
    topics: [PAID_IN_TOKEN_TOPIC0, '0x'.padEnd(26, '0') + USER.slice(2), '0x'.padEnd(26, '0') + APIS.slice(2)],
    data: '0x05',
  }, { topic0: PAID_IN_TOKEN_TOPIC0 });
  assert.equal(raw.user, USER.toLowerCase());
  assert.equal(raw.amount, '5');
  assert.equal(parsePaidInToken({ topics: ['0xwrong', 'a', 'b'], data: '0x1' }, { topic0: PAID_IN_TOKEN_TOPIC0 }), null);
  assert.equal(parsePaidInToken(null), null);
});

test('verifyPayment matches paymaster+user+token and enforces minAmount', () => {
  const receipt = { status: 1, logs: [{ address: PAYMASTER, args: { user: USER, token: APIS, amount: '2100000000000000000' } }] };
  assert.equal(verifyPayment(receipt, { paymaster: PAYMASTER, user: USER, token: APIS, minAmount: '2100000000000000000' }).ok, true);
  assert.equal(verifyPayment(receipt, { paymaster: PAYMASTER, user: USER, token: APIS, minAmount: '2100000000000000001' }).reason, 'amount-too-low');
  assert.equal(verifyPayment({ status: 0, logs: [] }, {}).reason, 'tx-reverted');
  assert.equal(verifyPayment({ logs: [] }, { paymaster: PAYMASTER }).reason, 'no-matching-payment');
  assert.equal(verifyPayment(null, {}).reason, 'no-receipt');
});

test('planSponsorship is once-per-nonce (Set and array state)', () => {
  assert.equal(planSponsorship({ nonce: '7' }, {}).action, 'sign');
  assert.equal(planSponsorship({ nonce: '7' }, { signedNonces: new Set(['7']) }).action, 'skip');
  assert.equal(planSponsorship({ nonce: '7' }, { signedNonces: ['7'] }).reason, 'already-signed');
  assert.equal(planSponsorship(null, {}).action, 'skip');
});

test('paymasterManifest exposes env names + boundary, never the key', () => {
  const m = paymasterManifest();
  assert.equal(m.env.paymaster.name, 'VERIFYING_PAYMASTER_ADDRESS');
  assert.match(m.boundary, /SIGNS nothing/);
  assert.equal(JSON.stringify(m).includes('PAYMASTER_SIGNER_KEY') && JSON.stringify(m).includes('key'), true);
});

function installFakeChain({ receipt, head = '0x64' } = {}) {
  __setFetch(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    let result = null;
    if (body.method === 'eth_getTransactionReceipt') result = receipt;
    else if (body.method === 'eth_blockNumber') result = head;
    return { json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
  });
}

test('fetchReceipt computes confirmations; soft-fails when not mined', async () => {
  installFakeChain({ receipt: { blockNumber: '0x62', logs: [] }, head: '0x64' });
  const r = await fetchReceipt(cfg(), TXH);
  assert.equal(r.ok, true);
  assert.equal(r.confirmations, 2);
  installFakeChain({ receipt: null });
  assert.equal((await fetchReceipt(cfg(), TXH)).reason, 'not-mined');
  __setFetch();
  assert.equal((await fetchReceipt(cfg(), 'nope')).reason, 'bad-txhash');
});

test('issueSponsorship: end-to-end signs once for a confirmed, sufficient payment', async () => {
  // 1 PRANA budget @ 2 APIS/PRANA + 5% = 2.1 APIS required; pay exactly that, 2 confs deep.
  const paid = '2100000000000000000';
  installFakeChain({
    receipt: { status: 1, blockNumber: '0x62', logs: [{ address: PAYMASTER, args: { user: USER, token: APIS, amount: paid } }] },
    head: '0x64',
  });
  let signedPacked = null;
  __setSigner(async (packed) => { signedPacked = packed; return '0xSIG'; });
  const state = { signedNonces: new Set() };
  const r = await issueSponsorship(cfg(), { txHash: TXH, user: USER, maxCostWei: WAD.toString() }, state);
  assert.equal(r.ok, true);
  assert.equal(r.signature, '0xSIG');
  assert.equal(r.maxCost, WAD.toString());
  assert.equal(r.nonce, nonceFromRef(TXH));
  assert.equal(r.apisQuoted, paid);
  assert.equal(signedPacked, buildSponsorshipPacked({ chainId: 108369, paymaster: PAYMASTER, user: USER, maxCost: WAD.toString(), nonce: r.nonce }));
  // idempotent: same tx -> already-signed
  const r2 = await issueSponsorship(cfg(), { txHash: TXH, user: USER, maxCostWei: WAD.toString() }, state);
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'already-signed');
  __setSigner(); __setFetch();
});

test('issueSponsorship soft-fails: unconfirmed, underpaid, no-signer, bad user', async () => {
  const paid = '2100000000000000000';
  // unconfirmed (0 confs)
  installFakeChain({ receipt: { status: 1, blockNumber: '0x64', logs: [{ address: PAYMASTER, args: { user: USER, token: APIS, amount: paid } }] }, head: '0x64' });
  __setSigner(async () => '0xSIG');
  let r = await issueSponsorship(cfg(), { txHash: TXH, user: USER, maxCostWei: WAD.toString() }, {});
  assert.equal(r.reason, 'unconfirmed');
  // underpaid
  installFakeChain({ receipt: { status: 1, blockNumber: '0x62', logs: [{ address: PAYMASTER, args: { user: USER, token: APIS, amount: '1' } }] }, head: '0x64' });
  r = await issueSponsorship(cfg(), { txHash: TXH, user: USER, maxCostWei: WAD.toString() }, {});
  assert.match(r.reason, /payment:amount-too-low/);
  // no signer
  __setSigner();
  installFakeChain({ receipt: { status: 1, blockNumber: '0x62', logs: [{ address: PAYMASTER, args: { user: USER, token: APIS, amount: paid } }] }, head: '0x64' });
  r = await issueSponsorship(cfg(), { txHash: TXH, user: USER, maxCostWei: WAD.toString() }, {});
  assert.equal(r.reason, 'no-signer');
  // bad user
  r = await issueSponsorship(cfg(), { txHash: TXH, user: 'nope', maxCostWei: WAD.toString() }, {});
  assert.equal(r.reason, 'bad-user');
  __setFetch();
});

// ── handler ─────────────────────────────────────────────────────────────────────────────────────────────
function mockRes() {
  return { code: 0, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b || ''; } };
}
function mockReq(method, url, payload) {
  const raw = payload == null ? '' : JSON.stringify(payload);
  return { method, url, async *[Symbol.asyncIterator]() { yield Buffer.from(raw); } };
}
const ENV = {
  PRANA_RPC_URL: 'http://prana.local/rpc', PRANA_CHAIN_ID: '108369',
  VERIFYING_PAYMASTER_ADDRESS: PAYMASTER, APIS_TOKEN_ADDRESS: APIS,
  APIS_PER_PRANA_WEI: '2000000000000000000', PAYMASTER_MARGIN_BPS: '500', CONFIRMATIONS: '2',
};

test('GET / serves the paymaster page', async () => {
  const res = mockRes();
  await handler(mockReq('GET', '/'), res, ENV);
  assert.equal(res.code, 200);
  assert.match(res.body, /APIS Paymaster/);
  assert.match(res.body, /pay your gas in APIS/i);
});

test('POST /api/quote returns the APIS amount + addresses', async () => {
  const res = mockRes();
  await handler(mockReq('POST', '/api/quote', { maxCostWei: WAD.toString() }), res, ENV);
  assert.equal(res.code, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.apisAmount, '2100000000000000000');
  assert.equal(j.paymaster, PAYMASTER);
  assert.equal(j.apisToken, APIS);
});

test('POST /api/quote bad body -> 400', async () => {
  const res = mockRes();
  await handler(mockReq('POST', '/api/quote', { maxCostWei: 'x' }), res, ENV);
  assert.equal(res.code, 400);
  assert.equal(JSON.parse(res.body).ok, false);
});

test('cleanup', () => { __setFetch(); __setSigner(); });
