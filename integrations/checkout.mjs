// checkout.mjs — a PCI-SAFE, provider-agnostic CHECKOUT abstraction so our sites can take payment via
// PayPal, Apple Pay, Google Pay, Cash App, Venmo, cards, and crypto WITHOUT our servers ever touching
// card data. This is off-chain INTENT-ONLY tooling in the Bot repo: it validates a payment request,
// shapes a provider-specific HOSTED-checkout session request object, and (only with an injected live
// client) asks the provider to create the hosted session — returning the redirect URL the browser goes
// to. The PAN/card is entered on the PROVIDER's hosted page, never on ours.
//
// HARD SECURITY RULES (encoded here; mirrors integrations/token-factory.mjs + angelicalist/dry-run.mjs):
//   • HOSTED / REDIRECT CHECKOUT ONLY. Stripe Checkout, PayPal Smart Buttons/Orders v2, Square hosted,
//     Coinbase Commerce hosted. The card / PAN NEVER reaches our servers → we stay OUT of PCI-DSS scope.
//     There are NO raw card fields anywhere in this module — see pciPosture() and the no-card test.
//   • SECRETS BY ENV NAME ONLY. API keys / webhook secrets are referenced by env NAME (e.g.
//     'STRIPE_SECRET_KEY'), resolved per-call via the vault/grant pattern at runtime. The VALUES are
//     never stored in the repo, never logged, never returned on an intent. We surface only the names.
//   • DRY-RUN / INTENT IS THE DEFAULT. createCheckoutIntent + the adapters build a request object and
//     perform NO network call. session() returns { dryRun:true, redirectUrl:null } unless an injected
//     live `client` is passed; only then is the provider called. broadcast/charge is null by default.
//   • SOFT-FAIL, NEVER THROW on operations. Bad *programmer* input to the constructive validator throws
//     a typed CheckoutError (like defineToken); the network-touching paths (session, verifyWebhook)
//     catch everything and return a structured soft-fail object instead of throwing.
//
//   node integrations/checkout.mjs        # demo: build a hosted intent per provider (no network, no keys)
//   import { createCheckoutIntent, session, verifyWebhook, pciPosture } from './checkout.mjs'
//
// Test (offline, no network, no keys): node --test integrations/checkout.test.mjs

import crypto from 'node:crypto';
import { forHive } from '../src/chain/caip.mjs';

// ---- error type ------------------------------------------------------------

export class CheckoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CheckoutError';
  }
}

// ---- whitelists ------------------------------------------------------------

// ISO-4217 fiat we accept on hosted checkout + the crypto pseudo-currencies Coinbase Commerce / our
// chain understand. Whitelisted so a typo or an unsupported currency is rejected on paper, early.
export const CURRENCY_WHITELIST = Object.freeze([
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'INR',
  'BTC', 'ETH', 'USDC', 'MELEK', // crypto / our chain
]);

// Each provider declares: which env NAME holds its secret, which env NAME (if any) holds its webhook
// secret, and which wallet options ride on it. Apple Pay / Google Pay are NOT processors — they ride a
// processor (Stripe / Braintree / Square), so they appear as `wallets`, never as a `provider`.
export const PROVIDERS = Object.freeze({
  stripe: {
    label: 'Stripe Checkout (hosted)',
    secretEnv: 'STRIPE_SECRET_KEY',
    webhookSecretEnv: 'STRIPE_WEBHOOK_SECRET',
    hosted: true,
    wallets: ['apple_pay', 'google_pay'], // ride Stripe; enabled on the hosted Checkout page
  },
  paypal: {
    label: 'PayPal Orders v2 + Smart Buttons (hosted)',
    secretEnv: 'PAYPAL_CLIENT_SECRET',
    clientIdEnv: 'PAYPAL_CLIENT_ID',
    webhookSecretEnv: 'PAYPAL_WEBHOOK_ID',
    hosted: true,
    wallets: ['paypal'],
  },
  square: {
    label: 'Square hosted checkout (incl. Cash App Pay)',
    secretEnv: 'SQUARE_ACCESS_TOKEN',
    webhookSecretEnv: 'SQUARE_WEBHOOK_SIGNATURE_KEY',
    hosted: true,
    wallets: ['cash_app_pay', 'apple_pay', 'google_pay'],
  },
  braintree: {
    label: 'Braintree Drop-in / hosted (incl. Venmo + Apple/Google Pay)',
    secretEnv: 'BRAINTREE_PRIVATE_KEY',
    publicKeyEnv: 'BRAINTREE_PUBLIC_KEY',
    merchantIdEnv: 'BRAINTREE_MERCHANT_ID',
    webhookSecretEnv: 'BRAINTREE_PRIVATE_KEY', // Braintree webhooks are verified with the private key
    hosted: true,
    wallets: ['venmo', 'apple_pay', 'google_pay', 'paypal'],
  },
  coinbaseCommerce: {
    label: 'Coinbase Commerce (hosted crypto charge)',
    secretEnv: 'COINBASE_COMMERCE_API_KEY',
    webhookSecretEnv: 'COINBASE_COMMERCE_WEBHOOK_SECRET',
    hosted: true,
    wallets: ['crypto'],
  },
  melek: {
    label: 'MELEK chain (hosted pay-to-account memo flow)',
    // our chain has no card flow at all; signing lives in MELEK-Signer (elsewhere), never here.
    secretEnv: null,
    webhookSecretEnv: null,
    hosted: true,
    wallets: ['crypto'],
  },
});

export function isProvider(p) {
  return typeof p === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, p);
}

// ---- helpers ---------------------------------------------------------------

function isPositiveAmount(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}
function isHttpsUrl(v) {
  if (typeof v !== 'string' || v.length === 0) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:'; // http allowed for localhost dev
  } catch {
    return false;
  }
}
const norm = (s) => String(s == null ? '' : s).trim();

// Convert a major-unit amount (e.g. 12.5 USD) to integer minor units (cents) for the processors that
// want them. Crypto currencies keep the decimal string (Coinbase Commerce / our chain take decimals).
const ZERO_DECIMAL = new Set(['JPY']);
function minorUnits(amount, currency) {
  if (ZERO_DECIMAL.has(currency)) return Math.round(amount);
  return Math.round(amount * 100);
}
function isCrypto(currency) {
  return ['BTC', 'ETH', 'USDC', 'MELEK'].includes(currency);
}

// ---- 1. provider-agnostic INTENT ------------------------------------------

/**
 * createCheckoutIntent — validate a payment request and produce a provider-agnostic, hosted-checkout
 * INTENT. PURE: no network, no keys. The actual provider-shaped request lives under intent.request,
 * built by the adapter for the chosen provider. broadcast is ALWAYS null here (no charge is created).
 *
 * @param {object} args
 * @param {number} args.amount     amount in MAJOR units (> 0)
 * @param {string} args.currency   ISO-4217 / crypto code from CURRENCY_WHITELIST
 * @param {Array}  [args.items]    line items [{ name, quantity, unitAmount }]
 * @param {string} args.provider   one of PROVIDERS
 * @param {string} args.successUrl https(s) URL the provider redirects to on success
 * @param {string} args.cancelUrl  https(s) URL the provider redirects to on cancel
 * @param {object} [args.metadata] free-form, non-sensitive metadata (NEVER card data)
 * @returns {{provider:string, intent:object, hosted:true, broadcast:null}}
 */
export function createCheckoutIntent({
  amount,
  currency,
  items = [],
  provider,
  successUrl,
  cancelUrl,
  metadata = {},
} = {}) {
  if (!isPositiveAmount(amount)) {
    throw new CheckoutError(`createCheckoutIntent: amount must be a number > 0 (got ${amount})`);
  }
  const cur = norm(currency).toUpperCase();
  if (!CURRENCY_WHITELIST.includes(cur)) {
    throw new CheckoutError(`createCheckoutIntent: currency "${currency}" is not in the whitelist`);
  }
  if (!isProvider(provider)) {
    throw new CheckoutError(`createCheckoutIntent: unknown provider "${provider}"`);
  }
  if (!isHttpsUrl(successUrl)) {
    throw new CheckoutError('createCheckoutIntent: successUrl must be a valid URL');
  }
  if (!isHttpsUrl(cancelUrl)) {
    throw new CheckoutError('createCheckoutIntent: cancelUrl must be a valid URL');
  }
  if (!Array.isArray(items)) {
    throw new CheckoutError('createCheckoutIntent: items must be an array');
  }
  if (metadata == null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new CheckoutError('createCheckoutIntent: metadata must be a plain object');
  }
  // Defensive: reject any metadata key that smells like card data, so a caller can never smuggle a PAN
  // through us (which would drag us into PCI scope). We do not store, forward, or accept card fields.
  const FORBIDDEN = /(\b|_)(pan|card|cardnumber|card_number|cvv|cvc|cvv2|exp|expiry|expiration|track[12]?)(\b|_)/i;
  for (const k of Object.keys(metadata)) {
    if (FORBIDDEN.test(k)) {
      throw new CheckoutError(`createCheckoutIntent: metadata key "${k}" looks like card data — forbidden (we are PCI out-of-scope)`);
    }
  }

  // Validate + normalize line items (pure shape check; amounts are major units).
  const lineItems = items.map((it, i) => {
    if (!it || typeof it !== 'object') throw new CheckoutError(`createCheckoutIntent: item[${i}] must be an object`);
    const name = norm(it.name);
    if (!name) throw new CheckoutError(`createCheckoutIntent: item[${i}].name is required`);
    const quantity = it.quantity == null ? 1 : it.quantity;
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new CheckoutError(`createCheckoutIntent: item[${i}].quantity must be a positive integer`);
    }
    const unitAmount = it.unitAmount == null ? null : it.unitAmount;
    if (unitAmount !== null && !isPositiveAmount(unitAmount)) {
      throw new CheckoutError(`createCheckoutIntent: item[${i}].unitAmount must be > 0 when given`);
    }
    return Object.freeze({ name, quantity, unitAmount });
  });

  const adapter = ADAPTERS[provider];
  const request = adapter({
    amount,
    currency: cur,
    items: lineItems,
    successUrl,
    cancelUrl,
    metadata,
  });

  const meta = PROVIDERS[provider];
  const intent = Object.freeze({
    kind: 'checkout-intent',
    id: crypto.randomUUID(),
    provider,
    amount,
    currency: cur,
    items: Object.freeze(lineItems),
    successUrl,
    cancelUrl,
    metadata: Object.freeze({ ...metadata }),
    hosted: true,            // ALWAYS hosted — card is entered on the provider's page, not ours
    wallets: Object.freeze([...(meta.wallets || [])]),
    // secret reference is the NAME of the env var only — never the value.
    secretEnv: meta.secretEnv,
    webhookSecretEnv: meta.webhookSecretEnv,
    request,                 // provider-shaped hosted-session request object
    pci: 'out-of-scope',
  });

  return { provider, intent, hosted: true, broadcast: null };
}

// ---- 2. provider adapters (intent-shapers, NO live calls) -----------------
//
// Each adapter takes the validated, normalized fields and returns the provider-specific HOSTED-session
// REQUEST object — the JSON we would POST to the provider to create a hosted checkout. None of these
// makes a network call, reads a key, or touches a card. Apple Pay / Google Pay ride on stripe /
// braintree / square as wallet options (see PROVIDERS[provider].wallets), so they are not adapters.

const ADAPTERS = Object.freeze({
  // Stripe Checkout Session — hosted page at checkout.stripe.com. Wallets (Apple/Google Pay) auto-show.
  stripe({ amount, currency, items, successUrl, cancelUrl, metadata }) {
    const line_items = (items.length
      ? items
      : [{ name: 'Order', quantity: 1, unitAmount: amount }]
    ).map((it) => ({
      quantity: it.quantity,
      price_data: {
        currency: currency.toLowerCase(),
        unit_amount: minorUnits(it.unitAmount ?? amount, currency),
        product_data: { name: it.name },
      },
    }));
    return Object.freeze({
      endpoint: 'POST /v1/checkout/sessions',
      hosted: true,
      mode: 'payment',
      line_items,
      // Apple Pay / Google Pay ride Stripe automatically on the hosted page; cards too.
      payment_method_types: ['card'],
      automatic_payment_methods: { enabled: true },
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
    });
  },

  // PayPal Orders v2 — the Smart Buttons / hosted approval flow. Approver redirects to the approve link.
  paypal({ amount, currency, successUrl, cancelUrl, metadata }) {
    return Object.freeze({
      endpoint: 'POST /v2/checkout/orders',
      hosted: true,
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: { currency_code: currency, value: amount.toFixed(2) },
          custom_id: norm(metadata.orderId) || undefined,
        },
      ],
      application_context: {
        return_url: successUrl,
        cancel_url: cancelUrl,
        user_action: 'PAY_NOW',
      },
      // wallet flavor: PayPal Smart Buttons render on the merchant page, redirect to PayPal-hosted.
      smart_buttons: true,
    });
  },

  // Square hosted Checkout (Payment Links). Cash App Pay is a wallet on the hosted page.
  square({ amount, currency, items, successUrl, cancelUrl }) {
    return Object.freeze({
      endpoint: 'POST /v2/online-checkout/payment-links',
      hosted: true,
      idempotency_key: crypto.randomUUID(),
      quick_pay: {
        name: items.length ? items[0].name : 'Order',
        price_money: { amount: minorUnits(amount, currency), currency },
        // location_id is supplied at call time from env by the injected client, never embedded here.
      },
      checkout_options: {
        redirect_url: successUrl,
        // Cash App Pay + Apple/Google Pay are offered on Square's hosted page.
        accepted_payment_methods: { cash_app_pay: true, apple_pay: true, google_pay: true, card: true },
      },
      // cancel handled by Square's hosted page returning to the merchant; kept for parity.
      cancel_url: cancelUrl,
    });
  },

  // Braintree — server creates a client token; the hosted Drop-in renders Venmo + Apple/Google Pay +
  // card + PayPal. We shape the transaction-sale request that the Drop-in nonce later feeds.
  braintree({ amount, currency, successUrl, cancelUrl, metadata }) {
    return Object.freeze({
      endpoint: 'POST /merchants/{merchantId}/client_token  (then transaction.sale with the nonce)',
      hosted: true,
      // Drop-in is hosted UI; the card never reaches our server, only the tokenized nonce does.
      dropin: true,
      currency,
      transaction: {
        amount: amount.toFixed(2),
        options: { submitForSettlement: true },
        // wallets surfaced by the Drop-in:
        paymentMethods: ['venmo', 'apple_pay', 'google_pay', 'card', 'paypal'],
      },
      redirect: { success_url: successUrl, cancel_url: cancelUrl },
      custom_fields: { order_id: norm(metadata.orderId) || undefined },
    });
  },

  // Coinbase Commerce — hosted crypto charge; customer pays on Coinbase's hosted_url.
  coinbaseCommerce({ amount, currency, items, successUrl, cancelUrl, metadata }) {
    const local = isCrypto(currency)
      ? { amount: String(amount), currency } // crypto: send as-is
      : { amount: amount.toFixed(2), currency };
    return Object.freeze({
      endpoint: 'POST /charges',
      hosted: true,
      name: items.length ? items[0].name : 'Order',
      description: norm(metadata.description) || 'Hosted crypto checkout',
      pricing_type: 'fixed_price',
      local_price: local,
      redirect_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
    });
  },

  // MELEK chain — our own hosted pay-to-account flow. No card path at all. Signing is in MELEK-Signer
  // (elsewhere); this only describes the memo/transfer the payer would approve. Reuses CAIP addressing.
  melek({ amount, currency, successUrl, cancelUrl, metadata }) {
    const to = norm(metadata.payee) || 'hathor';
    return Object.freeze({
      endpoint: 'MELEK-Signer: prepare hosted transfer approval',
      hosted: true,
      chain: 'melek',
      payeeAccount: forHive(to),                 // CAIP-10 account id, e.g. hive:melek:hathor
      asset: currency,                           // e.g. MELEK
      amount: String(amount),
      memo: norm(metadata.memo) || `order:${norm(metadata.orderId) || 'n/a'}`,
      return_url: successUrl,
      cancel_url: cancelUrl,
      // broadcast happens elsewhere via an injected signer; this module never signs or broadcasts.
      broadcast: null,
    });
  },
});

// ---- 3. session() — dry-run by default, live only with injected client ----

// A no-op spy client (mirrors makeSpyBroadcaster / makeSpySigner) so tests can prove the injected
// client is NEVER called in dry-run, and IS called only when provided. The real provider client is
// constructed elsewhere (with the env-resolved secret) and injected here.
export function makeSpyClient(redirectUrl = 'https://provider.example/hosted/test-session') {
  const calls = [];
  const fn = async (...args) => { calls.push(args); return { id: 'spy-session', redirectUrl, simulated: true }; };
  fn.calls = calls;
  return fn;
}

/**
 * session — turn an intent into a hosted-checkout session. DRY-RUN by default: with no injected client
 * it returns { dryRun:true, redirectUrl:null } and performs NO network call. ONLY when a live `client`
 * function is injected is it called to create the hosted session; we then return its redirectUrl.
 * NEVER throws — soft-fail returns a structured error object.
 *
 * The injected client is the SOLE network/secret boundary: it (constructed elsewhere with the
 * env-resolved key) receives the provider-shaped request and returns { redirectUrl }. This module
 * never resolves or sees the secret value.
 *
 * @param {object} intent   from createCheckoutIntent(...).intent
 * @param {object} [opts]
 * @param {function} [opts.client]  INJECTED live provider client; absent → dry-run
 * @returns {Promise<object>} { ok, dryRun, provider, redirectUrl, session?, error? }
 */
export async function session(intent, { client } = {}) {
  if (!intent || intent.kind !== 'checkout-intent') {
    return { ok: false, dryRun: true, redirectUrl: null, error: 'session: invalid checkout intent' };
  }
  // Default path: DRY-RUN. No network, no client touched, no redirect.
  if (typeof client !== 'function') {
    return {
      ok: true,
      dryRun: true,
      provider: intent.provider,
      redirectUrl: null,
      request: intent.request,
      note: 'dry-run: no live client injected — nothing was sent to the provider',
    };
  }
  // A live client was injected. We ONLY call it with the provider-shaped request; we never resolve the
  // secret ourselves. Any failure is soft — we return a structured error, never throw.
  try {
    const created = await client(intent.request, {
      provider: intent.provider,
      secretEnv: intent.secretEnv, // NAME only — the client resolves the value from the vault
    });
    const redirectUrl = created && (created.redirectUrl || created.url || created.hosted_url || null);
    return {
      ok: true,
      dryRun: false,
      provider: intent.provider,
      redirectUrl: redirectUrl || null,
      session: created || null,
    };
  } catch (err) {
    return {
      ok: false,
      dryRun: false,
      provider: intent.provider,
      redirectUrl: null,
      error: `session: provider client failed (${err && err.message ? err.message : 'unknown error'})`,
    };
  }
}

// ---- 4. verifyWebhook — signature-verification SHELL (env-NAME secret) ----

/**
 * verifyWebhook — verify a provider webhook signature using a secret resolved by ENV NAME. This is the
 * HMAC-compare shell for the providers that sign webhooks with a shared secret (Stripe, Coinbase
 * Commerce, Square). The secret VALUE is read from process.env[secretName] at call time (vault/grant
 * pattern) and used only for the constant-time compare — never logged, never returned.
 *
 * NEVER throws — returns { valid:false, ... } on any problem. On a valid signature, returns the parsed
 * event so the caller can act on it.
 *
 * @param {string} provider   one of PROVIDERS
 * @param {string|Buffer} payload  the RAW request body (exactly as received — do not re-stringify)
 * @param {string} sig        the signature header value the provider sent
 * @param {object} [opts]
 * @param {string} [opts.secretName]  ENV NAME holding the webhook secret (defaults to the provider's)
 * @param {object} [opts.env]         env map (defaults to process.env) — test seam, never a value source in repo
 * @returns {{valid:boolean, event:object|null, reason?:string}}
 */
export function verifyWebhook(provider, payload, sig, { secretName, env = process.env } = {}) {
  try {
    if (!isProvider(provider)) {
      return { valid: false, event: null, reason: `unknown provider "${provider}"` };
    }
    const name = norm(secretName) || PROVIDERS[provider].webhookSecretEnv;
    if (!name) {
      return { valid: false, event: null, reason: `no webhook secret env name for provider "${provider}"` };
    }
    const secret = env[name];
    if (!secret) {
      // The secret env var is unset on this host — soft-fail, and surface only the NAME, never a value.
      return { valid: false, event: null, reason: `webhook secret env "${name}" is not set` };
    }
    if (typeof sig !== 'string' || sig.length === 0) {
      return { valid: false, event: null, reason: 'missing signature' };
    }
    const raw = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? ''), 'utf8');

    // HMAC-SHA256 over the raw body — the shape Stripe / Coinbase Commerce / Square share. (Real
    // Stripe also folds a timestamp into the signed payload; that elaboration belongs in the injected
    // production verifier — this shell proves the env-NAME + constant-time-compare boundary.)
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');

    // Some providers hex-encode, some base64; accept a hex signature or one prefixed (t=..,v1=..).
    const provided = extractSignature(sig);
    const valid = timingSafeEqualHex(expected, provided);
    if (!valid) {
      return { valid: false, event: null, reason: 'signature mismatch' };
    }

    let event = null;
    try {
      event = JSON.parse(raw.toString('utf8'));
    } catch {
      event = null;
    }
    return { valid: true, event };
  } catch (err) {
    // Absolutely never throw out of a webhook verifier.
    return { valid: false, event: null, reason: `verify error (${err && err.message ? err.message : 'unknown'})` };
  }
}

// Pull a hex signature out of a header that may be a bare hex string or a "t=..,v1=.." style list.
function extractSignature(sig) {
  const s = norm(sig);
  if (/^[0-9a-f]+$/i.test(s)) return s.toLowerCase();
  // Stripe-style: t=timestamp,v1=hexsig — grab v1.
  const m = s.match(/(?:^|,)\s*v1=([0-9a-f]+)/i);
  if (m) return m[1].toLowerCase();
  return s.toLowerCase();
}

// Constant-time compare of two hex strings; length-mismatch is a fast, safe false.
function timingSafeEqualHex(aHex, bHex) {
  try {
    const a = Buffer.from(aHex, 'hex');
    const b = Buffer.from(bHex, 'hex');
    if (a.length === 0 || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---- 5. PCI posture documentation -----------------------------------------

/**
 * pciPosture — documents WHY this checkout layer is out of PCI-DSS scope. Pure, no I/O. Useful for an
 * /about-payments page, an audit answer, or a startup self-check.
 */
export function pciPosture() {
  return Object.freeze({
    inScope: false,
    model: 'hosted/redirect checkout only',
    why: [
      'The cardholder enters their PAN on the PROVIDER\'s hosted page (Stripe Checkout, PayPal, Square hosted, Coinbase Commerce) — never on our pages or servers.',
      'We never receive, transmit, process, or store any card number, CVV, or expiry. There are no raw card fields anywhere in this code.',
      'Our server only creates a hosted-session request and hands the browser a redirect URL; settlement/charge happens on the provider.',
      'API/webhook secrets are referenced by ENV NAME and resolved at runtime from the vault — never stored in the repo, never logged.',
      'No charge or broadcast occurs without an explicitly injected live client (dry-run/intent is the default).',
    ],
    eligibleSelfAssessment: 'SAQ A (merchants who fully outsource cardholder data handling to PCI-DSS-validated third parties)',
    cardFieldsInCode: 0,
  });
}

// ---- CLI (guarded) ---------------------------------------------------------

function runCli() {
  const lines = [];
  lines.push('checkout — PCI-SAFE, provider-agnostic HOSTED-checkout intents (no card data, no keys, no network).');
  lines.push('');
  const posture = pciPosture();
  lines.push(`PCI scope: ${posture.inScope ? 'IN' : 'OUT'} — model: ${posture.model} (${posture.eligibleSelfAssessment})`);
  lines.push('');
  for (const provider of Object.keys(PROVIDERS)) {
    const currency = provider === 'coinbaseCommerce' ? 'USDC' : provider === 'melek' ? 'MELEK' : 'USD';
    const { intent, hosted, broadcast } = createCheckoutIntent({
      amount: 12.5,
      currency,
      items: [{ name: 'Temple offering', quantity: 1, unitAmount: 12.5 }],
      provider,
      successUrl: 'https://example.org/thanks',
      cancelUrl: 'https://example.org/cart',
      metadata: { orderId: 'demo-1' },
    });
    lines.push(`• ${provider.padEnd(16)} hosted=${hosted} broadcast=${JSON.stringify(broadcast)} wallets=[${intent.wallets.join(', ')}]`);
    lines.push(`    secretEnv=${intent.secretEnv}  webhookSecretEnv=${intent.webhookSecretEnv}  endpoint="${intent.request.endpoint}"`);
  }
  lines.push('');
  lines.push('session() default (no injected client) → dry-run, redirectUrl:null (nothing sent to any provider).');
  console.log(lines.join('\n'));

  const { intent } = createCheckoutIntent({
    amount: 10, currency: 'USD', provider: 'stripe',
    successUrl: 'https://example.org/ok', cancelUrl: 'https://example.org/no',
  });
  session(intent).then((r) => {
    console.log(`    stripe session → dryRun=${r.dryRun} redirectUrl=${JSON.stringify(r.redirectUrl)}`);
    console.log('\nNo PAN/card field exists in this module; secrets are env NAMES only; dry-run is the default.');
  });
}

if (process.argv[1] && process.argv[1].endsWith('checkout.mjs')) {
  runCli();
}
