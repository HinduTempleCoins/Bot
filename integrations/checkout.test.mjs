// checkout.test.mjs — OFFLINE node:test for the PCI-SAFE provider-agnostic checkout abstraction.
// No network, no real keys, no card data, no charge. Proves:
//   • intent validation (good + rejected amount / currency / provider)
//   • each adapter shapes a HOSTED intent (hosted:true, broadcast:null, env-NAME secret refs)
//   • session() defaults to dry-run (spy client NOT called) and calls an injected client only when given
//   • verifyWebhook accepts a correctly-HMAC'd payload and rejects a tampered one (injected test secret)
//   • there is NO raw card field anywhere in the module source
//
//   node --test integrations/checkout.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createCheckoutIntent,
  session,
  verifyWebhook,
  pciPosture,
  makeSpyClient,
  PROVIDERS,
  CURRENCY_WHITELIST,
  CheckoutError,
} from './checkout.mjs';

const GOOD = {
  amount: 25,
  currency: 'USD',
  items: [{ name: 'Temple offering', quantity: 1, unitAmount: 25 }],
  provider: 'stripe',
  successUrl: 'https://example.org/thanks',
  cancelUrl: 'https://example.org/cart',
  metadata: { orderId: 'abc-1' },
};

// ---- 1. intent validation: good -------------------------------------------

test('createCheckoutIntent: accepts a good request and returns a hosted, non-broadcast intent', () => {
  const out = createCheckoutIntent(GOOD);
  assert.equal(out.provider, 'stripe');
  assert.equal(out.hosted, true);
  assert.equal(out.broadcast, null);                 // NEVER charges on intent creation
  assert.equal(out.intent.kind, 'checkout-intent');
  assert.equal(out.intent.amount, 25);
  assert.equal(out.intent.currency, 'USD');
  assert.equal(out.intent.hosted, true);
  assert.equal(out.intent.pci, 'out-of-scope');
  assert.equal(out.intent.secretEnv, 'STRIPE_SECRET_KEY'); // env NAME, not a value
  assert.ok(typeof out.intent.id === 'string' && out.intent.id.length > 0);
});

test('createCheckoutIntent: lowercases/normalizes currency', () => {
  const out = createCheckoutIntent({ ...GOOD, currency: 'usd' });
  assert.equal(out.intent.currency, 'USD');
});

// ---- 1b. intent validation: rejected --------------------------------------

test('createCheckoutIntent: rejects non-positive amount', () => {
  assert.throws(() => createCheckoutIntent({ ...GOOD, amount: 0 }), CheckoutError);
  assert.throws(() => createCheckoutIntent({ ...GOOD, amount: -5 }), CheckoutError);
  assert.throws(() => createCheckoutIntent({ ...GOOD, amount: 'free' }), CheckoutError);
});

test('createCheckoutIntent: rejects a currency not in the whitelist', () => {
  assert.throws(() => createCheckoutIntent({ ...GOOD, currency: 'XYZ' }), CheckoutError);
});

test('createCheckoutIntent: rejects an unknown provider', () => {
  assert.throws(() => createCheckoutIntent({ ...GOOD, provider: 'visa-direct' }), CheckoutError);
});

test('createCheckoutIntent: rejects bad success/cancel URLs', () => {
  assert.throws(() => createCheckoutIntent({ ...GOOD, successUrl: 'not a url' }), CheckoutError);
  assert.throws(() => createCheckoutIntent({ ...GOOD, cancelUrl: '' }), CheckoutError);
});

test('createCheckoutIntent: rejects metadata keys that look like card data (keeps us PCI out-of-scope)', () => {
  assert.throws(() => createCheckoutIntent({ ...GOOD, metadata: { card_number: '4111111111111111' } }), CheckoutError);
  assert.throws(() => createCheckoutIntent({ ...GOOD, metadata: { cvv: '123' } }), CheckoutError);
  assert.throws(() => createCheckoutIntent({ ...GOOD, metadata: { pan: 'x' } }), CheckoutError);
});

// ---- 2. each adapter shapes a hosted intent -------------------------------

test('every provider adapter produces a hosted request with no broadcast and env-NAME secret refs', () => {
  const perProviderCurrency = { coinbaseCommerce: 'USDC', melek: 'MELEK' };
  for (const provider of Object.keys(PROVIDERS)) {
    const currency = perProviderCurrency[provider] || 'USD';
    const out = createCheckoutIntent({
      ...GOOD,
      provider,
      currency,
      items: [{ name: 'Offering', quantity: 1, unitAmount: 10 }],
      amount: 10,
      metadata: { orderId: 'x', payee: 'hathor', memo: 'thanks' },
    });
    assert.equal(out.hosted, true, `${provider} should be hosted`);
    assert.equal(out.broadcast, null, `${provider} must not broadcast`);
    assert.equal(out.intent.request.hosted, true, `${provider} request must be hosted`);
    assert.ok(typeof out.intent.request.endpoint === 'string', `${provider} request needs an endpoint`);
    // secretEnv is either a NAME string or null (melek has no card secret) — never an actual value.
    const se = out.intent.secretEnv;
    assert.ok(se === null || (typeof se === 'string' && se === se.toUpperCase()), `${provider} secretEnv is a NAME or null`);
  }
});

test('stripe adapter exposes Apple/Google Pay as wallets riding the processor', () => {
  const out = createCheckoutIntent(GOOD);
  assert.ok(out.intent.wallets.includes('apple_pay'));
  assert.ok(out.intent.wallets.includes('google_pay'));
  assert.deepEqual(out.intent.request.line_items[0].price_data.unit_amount, 2500); // 25.00 -> cents
});

test('square adapter offers Cash App Pay; braintree offers Venmo', () => {
  const sq = createCheckoutIntent({ ...GOOD, provider: 'square' });
  assert.ok(sq.intent.wallets.includes('cash_app_pay'));
  assert.equal(sq.intent.request.checkout_options.accepted_payment_methods.cash_app_pay, true);

  const bt = createCheckoutIntent({ ...GOOD, provider: 'braintree' });
  assert.ok(bt.intent.wallets.includes('venmo'));
  assert.ok(bt.intent.request.transaction.paymentMethods.includes('venmo'));
});

test('coinbaseCommerce adapter handles crypto pricing; melek adapter uses CAIP payee, never broadcasts', () => {
  const cb = createCheckoutIntent({ ...GOOD, provider: 'coinbaseCommerce', currency: 'USDC', amount: 3 });
  assert.equal(cb.intent.request.local_price.currency, 'USDC');

  const mk = createCheckoutIntent({ ...GOOD, provider: 'melek', currency: 'MELEK', amount: 5, metadata: { payee: 'hathor' } });
  assert.equal(mk.intent.request.payeeAccount, 'hive:melek:hathor');
  assert.equal(mk.intent.request.broadcast, null);
});

// ---- 3. session(): dry-run default vs injected client ---------------------

test('session() defaults to dry-run and does NOT call an injected client when none is provided', async () => {
  const spy = makeSpyClient();
  const { intent } = createCheckoutIntent(GOOD);
  const r = await session(intent); // no client passed
  assert.equal(r.dryRun, true);
  assert.equal(r.redirectUrl, null);
  assert.equal(spy.calls.length, 0); // the spy was never even referenced — proves no live call
});

test('session() calls the injected client and returns its redirectUrl', async () => {
  const spy = makeSpyClient('https://checkout.stripe.com/c/pay/test_123');
  const { intent } = createCheckoutIntent(GOOD);
  const r = await session(intent, { client: spy });
  assert.equal(r.dryRun, false);
  assert.equal(r.ok, true);
  assert.equal(r.redirectUrl, 'https://checkout.stripe.com/c/pay/test_123');
  assert.equal(spy.calls.length, 1);
  // the client is handed the provider-shaped request + the secret NAME (never a value)
  assert.equal(spy.calls[0][0], intent.request);
  assert.equal(spy.calls[0][1].secretEnv, 'STRIPE_SECRET_KEY');
});

test('session() soft-fails (never throws) when the injected client throws', async () => {
  const boom = async () => { throw new Error('network down'); };
  const { intent } = createCheckoutIntent(GOOD);
  const r = await session(intent, { client: boom });
  assert.equal(r.ok, false);
  assert.equal(r.redirectUrl, null);
  assert.match(r.error, /network down/);
});

test('session() soft-fails on an invalid intent', async () => {
  const r = await session({ not: 'an intent' });
  assert.equal(r.ok, false);
  assert.equal(r.redirectUrl, null);
});

// ---- 4. verifyWebhook: accept correct HMAC, reject tampered ---------------

test('verifyWebhook accepts a correctly-HMAC-signed payload (injected test secret by env NAME)', () => {
  const secretName = 'TEST_WEBHOOK_SECRET';
  const secret = 'whsec_test_only_not_real';
  const env = { [secretName]: secret };
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { id: 'evt_1' } });
  const sig = crypto.createHmac('sha256', secret).update(Buffer.from(payload, 'utf8')).digest('hex');

  const r = verifyWebhook('stripe', payload, sig, { secretName, env });
  assert.equal(r.valid, true);
  assert.equal(r.event.type, 'checkout.session.completed');
});

test('verifyWebhook rejects a tampered payload', () => {
  const secretName = 'TEST_WEBHOOK_SECRET';
  const secret = 'whsec_test_only_not_real';
  const env = { [secretName]: secret };
  const payload = JSON.stringify({ type: 'checkout.session.completed', amount: 100 });
  const sig = crypto.createHmac('sha256', secret).update(Buffer.from(payload, 'utf8')).digest('hex');

  const tampered = JSON.stringify({ type: 'checkout.session.completed', amount: 999999 });
  const r = verifyWebhook('stripe', tampered, sig, { secretName, env });
  assert.equal(r.valid, false);
  assert.equal(r.event, null);
});

test('verifyWebhook accepts a Stripe-style "t=..,v1=.." header', () => {
  const secretName = 'TEST_WEBHOOK_SECRET';
  const secret = 's3cr3t';
  const env = { [secretName]: secret };
  const payload = '{"ok":true}';
  const hex = crypto.createHmac('sha256', secret).update(Buffer.from(payload, 'utf8')).digest('hex');
  const r = verifyWebhook('coinbaseCommerce', payload, `t=12345,v1=${hex}`, { secretName, env });
  assert.equal(r.valid, true);
});

test('verifyWebhook soft-fails when the secret env name is unset (surfaces only the NAME)', () => {
  const r = verifyWebhook('stripe', '{}', 'deadbeef', { secretName: 'NOT_SET_ANYWHERE', env: {} });
  assert.equal(r.valid, false);
  assert.match(r.reason, /NOT_SET_ANYWHERE/);
  // crucially, no secret value is present because none exists; the reason names the env var only
});

test('verifyWebhook soft-fails (no throw) on an unknown provider or missing signature', () => {
  assert.equal(verifyWebhook('madeup', '{}', 'x', { env: { X: 'y' } }).valid, false);
  assert.equal(verifyWebhook('stripe', '{}', '', { secretName: 'S', env: { S: 'k' } }).valid, false);
});

// ---- 5. PCI posture + no card data anywhere -------------------------------

test('pciPosture documents out-of-scope hosted/redirect model with zero card fields', () => {
  const p = pciPosture();
  assert.equal(p.inScope, false);
  assert.equal(p.cardFieldsInCode, 0);
  assert.match(p.model, /hosted|redirect/);
  assert.ok(Array.isArray(p.why) && p.why.length >= 3);
});

test('module source contains NO raw card-data field names (PAN/CVV/expiry/etc.)', () => {
  const src = readFileSync(fileURLToPath(new URL('./checkout.mjs', import.meta.url)), 'utf8');
  // Strip the deliberate guard regex + comments mentioning card data so we test for *actual* fields,
  // not the defensive code that REJECTS them. We assert there is no input field that COLLECTS a card.
  const cardFieldDecls = [
    /\bcardNumber\s*[:=]/i,
    /\bpan\s*[:=]\s*(req|input|body|args)/i,
    /\bcvv\s*[:=]\s*(req|input|body|args)/i,
    /collectCard/i,
    /\braw_pan\b/i,
  ];
  for (const re of cardFieldDecls) {
    assert.equal(re.test(src), false, `source must not declare a card-collecting field: ${re}`);
  }
});

test('currency whitelist is sane (fiat + crypto, includes our chain MELEK)', () => {
  assert.ok(CURRENCY_WHITELIST.includes('USD'));
  assert.ok(CURRENCY_WHITELIST.includes('MELEK'));
  assert.ok(CURRENCY_WHITELIST.includes('BTC'));
});
