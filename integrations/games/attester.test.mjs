// attester.test.mjs — the off-chain PRANA voucher attester. Fully offline (local crypto only),
// deterministic via injected key/now/nonce. Proves the EIP-712 signature round-trips (sign→recover)
// and that the claim tuple matches ArcadeFaucet.claim's argument order. Never throws to the caller.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  attestArcadeRun, attestSteps, attestGeomine, cellIdFor, geoVoucherDigest,
  geoBoostMultiplier, geoDiminish, __resetMines,
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
const GEO = { key: KEY, settlement: SETTLE, chainId: 108369, now: FIXED.now, nonce: 99, mineIndex: 0 };

test('geomining: lat/lng → a signed GeoVoucher that recovers to the attester', () => {
  const out = attestGeomine({ player: PLAYER, lat: 32.7767, lng: -96.7970, epoch: 19676 }, GEO);
  assert.equal(out.ok, true);
  assert.equal(out.signed, true);
  assert.equal(out.epoch, '19676');
  assert.ok(BigInt(out.cellId) > 0n);
  assert.equal(out.claimArgs.length, 7);                   // player, cellId, epoch, amount, nonce, deadline, sig
  assert.equal(recoverSigner(out.digest, out.signature).toLowerCase(), ADDR);
  const [player, cellId, epoch, amount, nonce, deadline] = out.claimArgs;
  assert.equal(geoVoucherDigest({ player, cellId: BigInt(cellId), epoch: BigInt(epoch), amount: BigInt(amount), nonce: BigInt(nonce), deadline: BigInt(deadline) }, SETTLE, 108369n), out.digest);
});

test('geomining: an explicit cellId works; bad input rejected', () => {
  assert.equal(attestGeomine({ player: PLAYER, cellId: 12345, epoch: 1 }, GEO).cellId, '12345');
  assert.equal(attestGeomine({ player: PLAYER }, GEO).ok, false);              // no cell/coords
  assert.equal(attestGeomine({ player: 'nope', lat: 1, lng: 1 }, GEO).ok, false); // bad player
});

test('step boost is exponential by tier (the operator milestones)', () => {
  assert.equal(geoBoostMultiplier(0), 1);
  assert.equal(geoBoostMultiplier(999), 1);
  assert.equal(geoBoostMultiplier(1000), 1.2);
  assert.equal(geoBoostMultiplier(10000), 3);
  assert.equal(geoBoostMultiplier(50000), 15);
  assert.equal(geoBoostMultiplier(999999), 15);   // capped at the top tier
});

test('geo reward = base × step-boost (more steps → bigger mine)', () => {
  const lo = attestGeomine({ player: PLAYER, cellId: 1, epoch: 1, steps: 0 }, GEO);
  const hi = attestGeomine({ player: PLAYER, cellId: 1, epoch: 1, steps: 10000 }, GEO);
  assert.equal(lo.payout, 10);                 // base 10 × 1
  assert.equal(hi.payout, 30);                 // base 10 × 3 (10k-step tier)
  assert.ok(hi.boost > lo.boost);
});

test('diminishing returns: each mine this hour pays less (1, 1/2, 1/3 …)', () => {
  const r0 = attestGeomine({ player: PLAYER, cellId: 1, epoch: 1, steps: 10000 }, { ...GEO, mineIndex: 0 });
  const r1 = attestGeomine({ player: PLAYER, cellId: 1, epoch: 1, steps: 10000 }, { ...GEO, mineIndex: 1 });
  const r2 = attestGeomine({ player: PLAYER, cellId: 1, epoch: 1, steps: 10000 }, { ...GEO, mineIndex: 2 });
  assert.equal(r0.payout, 30);                 // 10×3×1.0
  assert.equal(r1.payout, 15);                 // 10×3×0.5
  assert.equal(r2.payout, 10);                 // 10×3×0.33
  assert.equal(geoDiminish(0), 1);
  assert.equal(geoDiminish(1), 0.5);
});

test('the live tracker diminishes repeated mining within the hour, and resets per epoch', () => {
  __resetMines();
  const opts = { key: KEY, settlement: SETTLE, now: FIXED.now, nonce: 1 }; // no mineIndex → uses tracker
  const a = attestGeomine({ player: PLAYER, cellId: 1, epoch: 1, steps: 10000 }, opts);
  const b = attestGeomine({ player: PLAYER, cellId: 1, epoch: 1, steps: 10000 }, opts);
  assert.ok(b.payout < a.payout, 'second mine this hour pays less');
  // a different epoch (the next hour) is a fresh start
  const c = attestGeomine({ player: PLAYER, cellId: 1, epoch: 2, steps: 10000 }, opts);
  assert.equal(c.payout, a.payout, 'new hour resets the diminishing');
  __resetMines();
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
