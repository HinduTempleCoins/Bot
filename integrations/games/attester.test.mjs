// attester.test.mjs — the off-chain PRANA voucher attester. Fully offline (local crypto only),
// deterministic via injected key/now/nonce. Proves the EIP-712 signature round-trips (sign→recover)
// and that the claim tuple matches ArcadeFaucet.claim's argument order. Never throws to the caller.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  attestArcadeRun, attestSteps, attestGeomine, cellIdFor, geoVoucherDigest,
  attesterAddressOf, recoverSigner, scoreRefFor, voucherDigest, signDigest, handler,
} from './attester.mjs';

// anvil account #0 — a well-known throwaway test key (NEVER a real key).
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ADDR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const PLAYER = '0x1111111111111111111111111111111111111111';
const FAUCET = '0x2222222222222222222222222222222222222222';
const FIXED = { key: KEY, faucet: FAUCET, chainId: 108369, now: 1_700_000_000_000, nonce: 42 };

const goodRun = { gameId: 'naga', player: PLAYER, score: 5000, runHash: 'abc', events: 200, elapsedMs: 60_000 };

test('attesterAddressOf derives the correct address from a key', () => {
  assert.equal(attesterAddressOf(KEY), ADDR);
});

test('a valid run yields a signed voucher whose signature recovers to the attester', () => {
  const out = attestArcadeRun(goodRun, FIXED);
  assert.equal(out.ok, true);
  assert.equal(out.signed, true);
  assert.equal(out.payout, 5);                              // floor(5000/1000)
  assert.equal(out.voucher.amount, (5n * 10n ** 18n).toString());
  assert.equal(out.attester, ADDR);
  assert.equal(out.claimArgs.length, 6);                    // player, amount, scoreRef, deadline, nonce, sig
  // the cryptographic proof: the signature recovers to the attester for that exact digest
  assert.equal(recoverSigner(out.digest, out.signature).toLowerCase(), ADDR);
});

test('the claim tuple matches ArcadeFaucet.claim(player, amount, scoreRef, deadline, nonce, signature)', () => {
  const out = attestArcadeRun(goodRun, FIXED);
  const [player, amount, scoreRef, deadline, nonce, sig] = out.claimArgs;
  assert.equal(player, PLAYER);
  assert.equal(amount, out.voucher.amount);
  assert.equal(scoreRef, out.scoreRef);
  assert.equal(nonce, '42');
  assert.match(sig, /^0x[0-9a-f]{130}$/);                   // 65-byte r||s||v
  // and the digest is exactly what hashing that tuple produces
  assert.equal(voucherDigest({ player, amount: BigInt(amount), scoreRef, deadline: BigInt(deadline), nonce: BigInt(nonce) }, FAUCET, 108369n), out.digest);
});

test('anti-cheat: an implausible run is rejected (no signature)', () => {
  const cheat = { ...goodRun, score: 999999, events: 1, elapsedMs: 1000 }; // impossible for the events/time
  const out = attestArcadeRun(cheat, FIXED);
  assert.equal(out.ok, false);
  assert.match(out.reason, /rejected/);
});

test('a score below the reward threshold is not paid', () => {
  const out = attestArcadeRun({ ...goodRun, score: 500 }, FIXED); // payoutFor(500)=0
  assert.equal(out.ok, false);
  assert.match(out.reason, /threshold/);
});

test('a non-0x player is rejected', () => {
  assert.equal(attestArcadeRun({ ...goodRun, player: 'hathor' }, FIXED).ok, false);
});

test('no key → unsigned voucher with the digest (dry-run still useful), never throws', () => {
  const out = attestArcadeRun(goodRun, { faucet: FAUCET, chainId: 108369, now: FIXED.now, nonce: 7, key: '' });
  assert.equal(out.ok, true);
  assert.equal(out.signed, false);
  assert.match(out.reason, /no attester key/);
  assert.ok(out.digest);
});

test('no faucet address → unsigned, with a clear reason', () => {
  const out = attestArcadeRun(goodRun, { key: KEY, faucet: '', now: FIXED.now, nonce: 7 });
  assert.equal(out.signed, false);
  assert.match(out.reason, /faucet address/);
});

test('move-to-earn: steps attest through the same voucher shape (reward floored)', () => {
  const out = attestSteps({ player: PLAYER, steps: 12000, date: '2026-06-18' }, FIXED);
  assert.equal(out.ok, true);
  assert.equal(out.signed, true);
  assert.equal(recoverSigner(out.digest, out.signature).toLowerCase(), ADDR);
  // a tiny step count earns nothing whole → not paid
  assert.equal(attestSteps({ player: PLAYER, steps: 5 }, FIXED).ok, false);
});

const SETTLE = '0x3333333333333333333333333333333333333333';

test('geomining: lat/lng → a signed GeoVoucher that recovers to the attester', () => {
  const out = attestGeomine({ player: PLAYER, lat: 32.7767, lng: -96.7970, epoch: 19676 },
    { key: KEY, settlement: SETTLE, chainId: 108369, now: FIXED.now, nonce: 99 });
  assert.equal(out.ok, true);
  assert.equal(out.signed, true);
  assert.equal(out.epoch, '19676');
  assert.ok(BigInt(out.cellId) > 0n);
  assert.equal(out.claimArgs.length, 7);                   // player, cellId, epoch, amount, nonce, deadline, sig
  assert.equal(recoverSigner(out.digest, out.signature).toLowerCase(), ADDR);
  // digest matches an independent recompute via geoVoucherDigest
  const [player, cellId, epoch, amount, nonce, deadline] = out.claimArgs;
  assert.equal(geoVoucherDigest({ player, cellId: BigInt(cellId), epoch: BigInt(epoch), amount: BigInt(amount), nonce: BigInt(nonce), deadline: BigInt(deadline) }, SETTLE, 108369n), out.digest);
});

test('geomining: an explicit cellId works and is stable; bad input rejected', () => {
  const a = attestGeomine({ player: PLAYER, cellId: 12345, epoch: 1 }, { key: KEY, settlement: SETTLE, now: FIXED.now, nonce: 1 });
  assert.equal(a.cellId, '12345');
  assert.equal(attestGeomine({ player: PLAYER }, FIXED).ok, false);          // no cell/coords
  assert.equal(attestGeomine({ player: 'nope', lat: 1, lng: 1 }, FIXED).ok, false); // bad player
});

test('cellIdFor is deterministic for the same coordinates', () => {
  assert.equal(cellIdFor(32.7767, -96.7970), cellIdFor(32.7767, -96.7970));
});

test('scoreRef is deterministic and 32 bytes', () => {
  const a = scoreRefFor({ gameId: 'naga', player: PLAYER, score: 5000, runHash: 'abc' });
  const b = scoreRefFor({ gameId: 'naga', player: PLAYER, score: 5000, runHash: 'abc' });
  assert.equal(a, b);
  assert.match(a, /^0x[0-9a-f]{64}$/);
});

test('recoverSigner returns empty on a malformed signature (never throws)', () => {
  assert.equal(recoverSigner('0x' + '00'.repeat(32), '0xdead'), '');
});

test('signDigest is deterministic (RFC6979) for the same digest+key', () => {
  const d = voucherDigest({ player: PLAYER, amount: 1n, scoreRef: scoreRefFor({ score: 1 }), deadline: 1n, nonce: 1n }, FAUCET, 108369n);
  assert.equal(signDigest(d, KEY), signDigest(d, KEY));
});

// ── HTTP daemon ──────────────────────────────────────────────────────────────────────────────────
function cap() {
  const o = { code: 0, body: '' };
  return { res: { writeHead: (c) => { o.code = c; }, end: (b) => { o.body = b || ''; } }, o };
}
function req(path, method = 'GET', bodyObj) {
  const h = {};
  const r = { url: path, method, on: (e, fn) => { h[e] = fn; return r; }, destroy: () => {} };
  queueMicrotask(() => { if (bodyObj !== undefined && h.data) h.data(JSON.stringify(bodyObj)); if (h.end) h.end(); });
  return r;
}

test('handler: /health reports config without leaking the key', async () => {
  process.env.ATTESTER_KEY = KEY; process.env.ARCADE_FAUCET_ADDRESS = FAUCET;
  const { res, o } = cap();
  await handler(req('/health'), res);
  assert.equal(o.code, 200);
  const j = JSON.parse(o.body);
  assert.equal(j.hasKey, true);
  assert.equal(j.attester, ADDR);
  assert.ok(!o.body.includes(KEY.slice(2)), 'key must never appear in output');
  delete process.env.ATTESTER_KEY; delete process.env.ARCADE_FAUCET_ADDRESS;
});

test('handler: POST /attest/arcade returns a signed voucher; bad run → 422', async () => {
  process.env.ATTESTER_KEY = KEY; process.env.ARCADE_FAUCET_ADDRESS = FAUCET; process.env.PRANA_CHAIN_ID = '108369';
  let { res, o } = cap();
  await handler(req('/attest/arcade', 'POST', goodRun), res);
  assert.equal(o.code, 200);
  assert.equal(JSON.parse(o.body).signed, true);
  ({ res, o } = cap());
  await handler(req('/attest/arcade', 'POST', { ...goodRun, score: 500 }), res);
  assert.equal(o.code, 422);
  delete process.env.ATTESTER_KEY; delete process.env.ARCADE_FAUCET_ADDRESS; delete process.env.PRANA_CHAIN_ID;
});

test('handler: unknown route → 404', async () => {
  const { res, o } = cap();
  await handler(req('/nope'), res);
  assert.equal(o.code, 404);
});
