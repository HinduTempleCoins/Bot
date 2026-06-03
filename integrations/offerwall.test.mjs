import { test } from 'node:test';
import assert from 'node:assert';
import { offers, verifyCallback, signCallback, completeOffer, payoutFor } from './offerwall.mjs';

const SECRET = 'test-shared-secret';

// A fake adapter registry that injects raw, network-shaped offers without any network I/O.
function fakeAdapters() {
  return {
    tapjoy: {
      label: 'Tapjoy', secretEnv: 'TAPJOY_SECRET', keyEnvs: [],
      async fetchOffers({ user }) {
        return [
          { id: 'tj-1', title: 'Install Game X', payoutUsd: 2, kind: 'app' },
          { id: null, title: 'broken (no id)', payoutUsd: 1 }, // should be dropped
        ];
      },
    },
    pollfish: {
      label: 'Pollfish', secretEnv: 'POLLFISH_SECRET', keyEnvs: [],
      async fetchOffers() { return [{ id: 'pf-9', title: 'Survey: shopping habits', payoutUsd: 0.5, kind: 'survey' }]; },
    },
    broken: {
      label: 'Broken', secretEnv: 'X', keyEnvs: [],
      async fetchOffers() { throw new Error('network down'); }, // adapter soft-fails to []
    },
  };
}

test('offers() normalizes injected data and attaches native payout', async () => {
  const out = await offers({ user: 'alice', _adapters: fakeAdapters() });
  // 2 good offers (the no-id one dropped, broken adapter contributes nothing)
  assert.equal(out.length, 2);
  const tj = out.find((o) => o.id === 'tj-1');
  assert.ok(tj);
  assert.equal(tj.network, 'tapjoy');
  assert.equal(tj.title, 'Install Game X');
  assert.equal(tj.payoutUsd, 2);
  assert.equal(tj.payout.symbol, 'MELEK');
  assert.equal(tj.payout.amount, 200); // 2 USD * 100 native/USD default
  assert.equal(tj.payout.fundedByUsd, 2);
  assert.ok(out.find((o) => o.network === 'pollfish' && o.kind === 'survey'));
});

test('offers() soft-fails to [] with no user', async () => {
  assert.deepEqual(await offers({ _adapters: fakeAdapters() }), []);
});

test('payoutFor() is pure and non-negative', () => {
  assert.equal(payoutFor({ payoutUsd: 1 }).amount, 100);
  assert.equal(payoutFor({ payoutUsd: -5 }).amount, 0);
  assert.equal(payoutFor({}).amount, 0);
});

test('verifyCallback accepts a valid HMAC and rejects a forged one', () => {
  const payload = { id: 'tj-1', user: 'alice', amountUsd: 2, transactionId: 'tx-abc' };
  payload.signature = signCallback(payload, SECRET);

  assert.equal(verifyCallback(payload, SECRET), true, 'genuine signature passes');

  // Forged: attacker invents a signature.
  assert.equal(verifyCallback({ ...payload, signature: 'deadbeef' }, SECRET), false);
  // Tampered amount with the original signature must fail.
  assert.equal(verifyCallback({ ...payload, amountUsd: 9999 }, SECRET), false);
  // Wrong secret fails.
  assert.equal(verifyCallback(payload, 'wrong-secret'), false);
  // Missing signature fails.
  assert.equal(verifyCallback({ id: 'x', user: 'y', amountUsd: 1, transactionId: 't' }, SECRET), false);
});

test('completeOffer only pays on a valid callback', async () => {
  const callback = { id: 'tj-1', user: 'alice', amountUsd: 2, transactionId: 'tx-1' };
  callback.signature = signCallback(callback, SECRET);

  const ok = await completeOffer({ offerId: 'tj-1', user: 'alice', callback, secret: SECRET });
  assert.equal(ok.ok, true);
  assert.equal(ok.intent.type, 'offerwall-payout');
  assert.equal(ok.intent.to, 'alice');
  assert.equal(ok.intent.amount, 200);
  assert.equal(ok.intent.symbol, 'MELEK');
  assert.equal(ok.intent.fundedByUsd, 2);
  assert.equal(ok.intent.nonInflationary, true);

  // Forged callback pays nothing.
  const forged = { ...callback, signature: 'deadbeef' };
  assert.deepEqual(await completeOffer({ offerId: 'tj-1', user: 'alice', callback: forged, secret: SECRET }), { ok: false, reason: 'invalid-callback' });

  // Valid signature but for a different offer must not pay this offer.
  assert.equal((await completeOffer({ offerId: 'other-offer', user: 'alice', callback, secret: SECRET })).reason, 'offer-mismatch');

  // Valid signature but different user.
  assert.equal((await completeOffer({ offerId: 'tj-1', user: 'mallory', callback, secret: SECRET })).reason, 'user-mismatch');

  // No secret configured at all.
  assert.equal((await completeOffer({ offerId: 'tj-1', user: 'alice', callback })).reason, 'no-secret-configured');
});
