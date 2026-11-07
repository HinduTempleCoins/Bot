// site/yoni/gate-web.mjs — the browser side of the age gate: cookies, a signed token, one attestation.
//
// ⭐ WHY THE TOKEN IS THE RECORD, NOT THE SERVER-SIDE MAP.
// integrations/agegate keeps its records in memory, so a dispatcher restart would drop every check a
// visitor had passed and ask them again — and on a paid tier that means paying twice for the same
// person. mintToken/verifyToken exist for exactly this: the HMAC-signed token carries the subject, the
// level and the expiry, so the result survives a restart and the server holds nothing about the visitor.
//
// ⭐ THE SUBJECT IS AN OPAQUE RANDOM ID, AND THAT IS DELIBERATE.
// A visitor has no account here. The subject is 16 random bytes in a cookie: enough to key a gate
// result to one browser, and not a fact about a person. No email, no fingerprint, nothing derived from
// the request. It is meaningless outside this property and worthless if leaked.
//
// ⭐ NO SECRET MEANS NO GATE OPENS.
// YONI_GATE_SECRET signs the tokens. Unset, nothing can be minted and nothing verifies, so every gated
// surface stays closed. That is the correct direction for a missing secret: an unsigned token is worse
// than no token, and a gate that opens because a config value is absent is not a gate.
//
// ⭐ ATTESTATION IS NOT AGE ASSURANCE, AND THE CEILING IS IN THE MODEL.
// A click can mint `attested` and nothing higher. `verified` and `id` need a provider this property has
// not contracted, so those surfaces fail closed here rather than being fudged with a checkbox.
//
// House style: ESM, pure where it can be, soft-fail-never-throw, injectable clock and crypto.

import { randomBytes } from 'node:crypto';
import { mintToken, verifyToken, runCheck, selfAttestation, meets, policyFor, rank, LEVELS }
  from '../../integrations/agegate/model.mjs';

export const SUBJECT_COOKIE = 'ys_s';
export const GATE_COOKIE = 'ys_g';
export const AUDIENCE = 'yonishrine';

/** The highest level a click can ever produce here. Anything above needs a contracted provider. */
export const ATTEST_CEILING = 'attested';

export const secretFrom = (env = process.env) => String(env.YONI_GATE_SECRET || '').trim();

/** Parse a Cookie header. Never throws; an unparseable pair is skipped. */
export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* skip */ }
  }
  return out;
}

export const newSubject = (bytes = randomBytes) => bytes(16).toString('hex');

/** The subject for this browser, minting one if there is none. */
export function subjectFor(req, { bytes = randomBytes } = {}) {
  const have = parseCookies(req && req.headers && req.headers.cookie)[SUBJECT_COOKIE];
  const clean = String(have || '').replace(/[^a-f0-9]/g, '').slice(0, 64);
  return clean.length >= 16 ? { subject: clean, minted: false } : { subject: newSubject(bytes), minted: true };
}

/**
 * What level this request already holds. Reads the signed token only — never the in-memory store, so
 * a restart does not forget. Returns 'none' for anything missing, malformed, expired or mis-signed.
 */
export function levelFor(req, { env = process.env, now } = {}) {
  const secret = secretFrom(env);
  if (!secret) return 'none';
  const tok = parseCookies(req && req.headers && req.headers.cookie)[GATE_COOKIE];
  if (!tok) return 'none';
  const v = verifyToken(tok, secret, { audience: AUDIENCE }, now ? { now } : {});
  if (!v || !v.ok) return 'none';
  const lvl = String(v.level || v.l || 'none');
  return LEVELS.includes(lvl) ? lvl : 'none';
}

/** Does this request satisfy a surface? */
export function satisfies(req, surface, opts = {}) {
  const need = policyFor(surface).level;
  if (need === 'none') return { ok: true, need, have: 'none' };
  const have = levelFor(req, opts);
  return { ok: meets(have, need), need, have };
}

/**
 * Take one attestation. Mints `attested` and nothing higher, even if asked for more.
 * Returns { ok, token, maxAgeSec } or { ok:false, reason }.
 */
export async function attest(subject, { env = process.env, now, store } = {}) {
  const secret = secretFrom(env);
  if (!secret) return { ok: false, reason: 'no signing secret configured — no gate can open' };
  const s = String(subject || '').trim();
  if (!s) return { ok: false, reason: 'no subject' };
  const opts = {}; if (now) opts.now = now; if (store) opts.store = store;
  const rec = await runCheck(selfAttestation, s, { attested: true }, opts);
  if (!rec || !rec.ok) return { ok: false, reason: (rec && rec.reason) || 'attestation declined' };
  const minted = mintToken(s, ATTEST_CEILING, secret, { audience: AUDIENCE }, opts);
  if (!minted || !minted.ok) return { ok: false, reason: (minted && minted.reason) || 'could not mint' };
  const nowMs = now ? now() : Date.now();
  const maxAgeSec = Math.max(0, Math.floor(((minted.expiresAt || rec.expiresAt || nowMs) - nowMs) / 1000));
  return { ok: true, token: minted.token, maxAgeSec, level: ATTEST_CEILING };
}

/** Can a click ever satisfy this surface? If not, no interstitial should pretend otherwise. */
export function clickCanSatisfy(surface) {
  return rank(policyFor(surface).level) <= rank(ATTEST_CEILING);
}

const flags = (secure) => `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

/** Set-Cookie values. `secure` is off only for a plain-http test of the box. */
export function setCookies({ subject, minted, token, maxAgeSec, secure = true } = {}) {
  const out = [];
  if (subject && minted) out.push(`${SUBJECT_COOKIE}=${encodeURIComponent(subject)}; Max-Age=31536000; ${flags(secure)}`);
  if (token) out.push(`${GATE_COOKIE}=${encodeURIComponent(token)}; Max-Age=${Math.max(1, maxAgeSec || 0)}; ${flags(secure)}`);
  return out;
}

export { policyFor, meets, LEVELS };
