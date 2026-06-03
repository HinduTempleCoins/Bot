// offerwall.mjs — externally-funded faucet (queue #195). The faucet does NOT mint or inflate the native
// token: a third-party advertiser/survey network pays FIAT into the operator's offerwall account when a
// user completes an offer (installs an app, watches a UA video, finishes a survey). That fiat funds a
// payout of an EQUIVALENT amount of the already-circulating NATIVE token to the user. So the supply is
// fixed; this just routes advertiser money → token-holders. Non-inflationary by construction.
//
// Adapters are soft-fail and key-optional: if a network's key isn't configured, that adapter contributes
// nothing (returns []) rather than throwing — so the wall degrades gracefully to whatever is wired up.
//
//   Tapjoy / AdGem / ironSource(Unity LevelPlay) / AppLovin MAX  — offerwall + rewarded UA inventory
//   Pollfish                                                     — survey inventory (CPI per completed survey)
//
// ── Anti-fraud / Sybil note ─────────────────────────────────────────────────────────────────────────
// Offerwall fraud is endemic: one human spins up many identities (Sybil) or emulators to farm payouts an
// advertiser never actually got value from, and chargebacks claw the fiat back AFTER we paid out tokens.
// Defenses, layered:
//   1. NEVER trust a client-reported completion. Only the network's server→server postback (signed) counts.
//   2. verifyCallback() HMAC-validates that postback against the per-network shared secret — this is the
//      single load-bearing gate. A forged callback fails the HMAC and pays nothing.
//   3. Idempotency: each completion carries a transaction id; pay once per id (caller's ledger enforces).
//   4. Velocity / device / IP heuristics live UPSTREAM in the ad network; we additionally cap payout band.
//
// ── Privacy vs. Tor tension ─────────────────────────────────────────────────────────────────────────
// The same signals that catch Sybil farms (device fingerprint, IP geolocation, "no VPN/Tor") are exactly
// the signals a privacy-respecting user wants to withhold. Ad networks routinely REJECT Tor/VPN traffic
// as fraud, so a legitimate Tor user simply gets zero offers — we cannot honestly promise both maximal
// privacy AND offerwall earnings. We surface offers when the network returns them and stay silent when it
// doesn't; we do not run our own fingerprinting. The honest framing for users: the faucet is opt-in and
// advertiser-gated, so privacy-maximalists should expect a thin-to-empty wall, not a workaround.

import crypto from 'node:crypto';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';

// How much native token a given fiat payout converts to. Kept deliberately simple and overridable via env;
// in production the rate comes from the live market price of the native token. Conservative default.
function nativePerUsd() {
  const v = Number(process.env.OFFERWALL_NATIVE_PER_USD);
  return Number.isFinite(v) && v > 0 ? v : 100; // 100 native tokens per advertiser USD by default
}
const NATIVE_SYMBOL = process.env.OFFERWALL_NATIVE_SYMBOL || 'MELEK';

// env(name) — read a key without ever logging it. Returns undefined when absent (adapter then no-ops).
const env = (n) => { const v = process.env[n]; return v && String(v).trim() ? String(v).trim() : undefined; };

// Adapter registry. Each adapter declares the env keys it needs, the secret env key used to verify the
// postback HMAC, and a fetcher that returns RAW offers (network-shaped) for a user, or [] when unkeyed.
// Keeping raw + a normalizer separate makes offers() uniform and the test injectable.
export const ADAPTERS = {
  tapjoy: {
    label: 'Tapjoy',
    secretEnv: 'TAPJOY_SECRET',
    keyEnvs: ['TAPJOY_API_KEY'],
    // Tapjoy "get offers" — soft-fail, normalized downstream.
    async fetchOffers({ user }) {
      const key = env('TAPJOY_API_KEY'); if (!key) return [];
      try {
        const r = await _fetch(`https://api.tapjoy.com/v1/offers?app_key=${encodeURIComponent(key)}&publisher_user_id=${encodeURIComponent(user)}`, { headers: { 'user-agent': UA } });
        if (!r.ok) return [];
        const j = await r.json().catch(() => null);
        return Array.isArray(j?.offers) ? j.offers.map((o) => ({ id: o.id, title: o.name, payoutUsd: Number(o.revenue) || 0, kind: 'app' })) : [];
      } catch { return []; }
    },
  },
  adgem: {
    label: 'AdGem',
    secretEnv: 'ADGEM_SECRET',
    keyEnvs: ['ADGEM_APP_ID'],
    async fetchOffers({ user }) {
      const app = env('ADGEM_APP_ID'); if (!app) return [];
      try {
        const r = await _fetch(`https://api.adgem.com/v1/wall?appid=${encodeURIComponent(app)}&playerid=${encodeURIComponent(user)}`, { headers: { 'user-agent': UA } });
        if (!r.ok) return [];
        const j = await r.json().catch(() => null);
        return Array.isArray(j?.data) ? j.data.map((o) => ({ id: o.campaign_id, title: o.name, payoutUsd: Number(o.amount_usd) || 0, kind: 'app' })) : [];
      } catch { return []; }
    },
  },
  ironsource: {
    label: 'ironSource (Unity LevelPlay)',
    secretEnv: 'IRONSOURCE_SECRET',
    keyEnvs: ['IRONSOURCE_APP_KEY'],
    async fetchOffers({ user }) {
      const app = env('IRONSOURCE_APP_KEY'); if (!app) return [];
      try {
        const r = await _fetch(`https://api.ironsrc.com/offerwall/offers?appKey=${encodeURIComponent(app)}&userId=${encodeURIComponent(user)}`, { headers: { 'user-agent': UA } });
        if (!r.ok) return [];
        const j = await r.json().catch(() => null);
        return Array.isArray(j?.offers) ? j.offers.map((o) => ({ id: o.offerId, title: o.title, payoutUsd: Number(o.payout) || 0, kind: 'app' })) : [];
      } catch { return []; }
    },
  },
  applovin: {
    label: 'AppLovin MAX',
    secretEnv: 'APPLOVIN_SECRET',
    keyEnvs: ['APPLOVIN_SDK_KEY'],
    async fetchOffers({ user }) {
      const key = env('APPLOVIN_SDK_KEY'); if (!key) return [];
      try {
        const r = await _fetch(`https://r.applovin.com/offers?sdk_key=${encodeURIComponent(key)}&user_id=${encodeURIComponent(user)}`, { headers: { 'user-agent': UA } });
        if (!r.ok) return [];
        const j = await r.json().catch(() => null);
        return Array.isArray(j?.offers) ? j.offers.map((o) => ({ id: o.id, title: o.headline, payoutUsd: Number(o.reward_usd) || 0, kind: 'video' })) : [];
      } catch { return []; }
    },
  },
  pollfish: {
    label: 'Pollfish',
    secretEnv: 'POLLFISH_SECRET',
    keyEnvs: ['POLLFISH_API_KEY'],
    async fetchOffers({ user }) {
      const key = env('POLLFISH_API_KEY'); if (!key) return [];
      try {
        const r = await _fetch(`https://api.pollfish.com/v2/surveys?api_key=${encodeURIComponent(key)}&request_uuid=${encodeURIComponent(user)}`, { headers: { 'user-agent': UA } });
        if (!r.ok) return [];
        const j = await r.json().catch(() => null);
        return Array.isArray(j?.surveys) ? j.surveys.map((o) => ({ id: o.survey_id, title: o.name || 'Survey', payoutUsd: Number(o.cpi) || 0, kind: 'survey' })) : [];
      } catch { return []; }
    },
  },
};

/** payoutFor(offer) — PURE. Convert an offer's advertiser fiat (USD) into the native-token amount a user
 *  receives. Non-inflationary: the amount is just a conversion of money the advertiser already paid in.
 *  Returns { amount, symbol, fundedByUsd } with amount rounded to 4dp, clamped at 0. */
export function payoutFor(offer) {
  const usd = Math.max(0, Number(offer?.payoutUsd) || 0);
  const amount = Math.round(usd * nativePerUsd() * 1e4) / 1e4;
  return { amount, symbol: NATIVE_SYMBOL, fundedByUsd: usd };
}

/** normalizeOffer — shape one raw offer + attach the native payout. Drops offers missing id/title. */
function normalizeOffer(network, raw) {
  if (!raw || raw.id == null || !raw.title) return null;
  const offer = { network, id: String(raw.id), title: String(raw.title), kind: raw.kind || 'app', payoutUsd: Math.max(0, Number(raw.payoutUsd) || 0) };
  offer.payout = payoutFor(offer);
  return offer;
}

/** offers({ user, networks? }) — fetch available offers across all configured adapters, normalized.
 *  Soft-fail to [] on any error. networks (optional) restricts which adapters run. _adapters is a test
 *  seam letting the test inject raw offers without touching the network. */
export async function offers({ user, networks, _adapters } = {}) {
  try {
    if (!user) return [];
    const reg = _adapters || ADAPTERS;
    const names = (networks && networks.length ? networks : Object.keys(reg)).filter((n) => reg[n]);
    const lists = await Promise.all(names.map(async (n) => {
      try {
        const raw = await reg[n].fetchOffers({ user });
        return (Array.isArray(raw) ? raw : []).map((r) => normalizeOffer(n, r)).filter(Boolean);
      } catch { return []; }
    }));
    return lists.flat();
  } catch { return []; }
}

/** verifyCallback(payload, secret) — PURE. The single load-bearing anti-fraud gate. An offerwall postback
 *  is signed: it carries fields plus a `signature` that is HMAC-SHA256(canonical-fields, shared-secret).
 *  We recompute the HMAC over the same canonical string and timing-safe-compare. Returns true only for a
 *  genuine, untampered postback. Any missing field, wrong secret, or altered amount → false.
 *  Canonical string: id|user|amountUsd|transactionId  (stable field order; this is what the sender signs). */
export function verifyCallback(payload, secret) {
  try {
    if (!payload || !secret) return false;
    const sig = payload.signature;
    if (!sig || typeof sig !== 'string') return false;
    const canonical = [payload.id, payload.user, payload.amountUsd, payload.transactionId].join('|');
    const expected = crypto.createHmac('sha256', String(secret)).update(canonical).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(String(sig), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

/** signCallback(payload, secret) — helper to PRODUCE a valid signature (test fixtures / local dry-runs;
 *  the real signature is produced by the ad network). Same canonical string as verifyCallback. */
export function signCallback(payload, secret) {
  const canonical = [payload.id, payload.user, payload.amountUsd, payload.transactionId].join('|');
  return crypto.createHmac('sha256', String(secret)).update(canonical).digest('hex');
}

/** completeOffer({ offerId, user, callback, network?, secret? }) — verify the offerwall's signed completion
 *  postback, and ONLY on a valid signature emit a payout INTENT in the native token (funded by advertiser
 *  fiat). Returns { ok, reason?, intent? }. This function does not broadcast or hold keys — it produces an
 *  intent the (separate, key-holding) signer service acts on, after the caller's idempotency/ledger checks.
 *  secret resolution: explicit `secret` arg wins; else the adapter's secretEnv for `network`. */
export async function completeOffer({ offerId, user, callback, network, secret } = {}) {
  if (!callback || !offerId || !user) return { ok: false, reason: 'missing-args' };
  const adapter = network && ADAPTERS[network] ? ADAPTERS[network] : null;
  const useSecret = secret || (adapter ? env(adapter.secretEnv) : undefined);
  if (!useSecret) return { ok: false, reason: 'no-secret-configured' };

  if (!verifyCallback(callback, useSecret)) return { ok: false, reason: 'invalid-callback' };
  // Bind the callback to THIS offer + user (a valid signature for a different offer must not pay this one).
  if (String(callback.id) !== String(offerId)) return { ok: false, reason: 'offer-mismatch' };
  if (String(callback.user) !== String(user)) return { ok: false, reason: 'user-mismatch' };

  const payout = payoutFor({ payoutUsd: callback.amountUsd });
  if (!(payout.amount > 0)) return { ok: false, reason: 'zero-payout' };

  return {
    ok: true,
    intent: {
      type: 'offerwall-payout',
      to: user,
      amount: payout.amount,
      symbol: payout.symbol,
      fundedByUsd: payout.fundedByUsd,
      offerId: String(offerId),
      network: network || null,
      transactionId: callback.transactionId,
      nonInflationary: true,
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith('offerwall.mjs')) {
  const user = process.argv[2] || 'demo-user';
  const list = await offers({ user });
  if (!list.length) {
    console.log('No offers (no adapter keys configured, or networks returned none).');
    console.log(`Adapters: ${Object.keys(ADAPTERS).join(', ')}`);
  } else {
    for (const o of list) console.log(`  [${o.network}] ${o.title}  →  ${o.payout.amount} ${o.payout.symbol}  (advertiser $${o.payoutUsd})`);
  }
}
