// integrations/agegate/model.mjs — our own age gate, with a level per surface.
//
// ⭐ WHY WE BUILD THIS INSTEAD OF BUYING ONE OUTRIGHT.
// Commercial age verification is charged PER VISITOR, while revenue scales only with the converting
// fraction. At $0.25 a check and 100,000 checks a month that is $25,000/month — plausibly the single
// largest operating cost of an adult property, paid mostly on people who never spend anything. The
// way out is not a cheaper vendor, it is to stop sending everyone to one: gate each surface at the
// level that surface actually requires, and only pay for a hard check at the door of the surfaces
// that need it. This module is that policy engine. A paid provider plugs in underneath as the
// `verified`/`id` backend; it is not the front door.
//
// ⭐ WHAT WE DELIBERATELY DO NOT STORE.
// Never the ID image, never the document number, never the date of birth. A verification produces a
// RECORD — method, provider reference, when it was done, when it expires — and a boolean. Holding ID
// scans turns a routine breach into a catastrophe and is itself a reason regulators come looking.
// `assertNoPII()` enforces that at the boundary rather than trusting the caller.
//
// ⭐ LEVELS ARE ORDERED, AND A SURFACE DECLARES ITS OWN.
//   none      — public. The wiki's editorial and anatomical material sits here.
//   attested  — "I am 18 or over." Nearly worthless as proof, and explicitly NOT sufficient under
//               the state age-verification statutes, which is why it is never the top of the scale.
//   verified  — a commercially reasonable check: facial age estimation, mobile/carrier, or similar.
//   id        — government ID matched to a live selfie. The highest friction and the highest cost.
//
// House style: ESM, pure where it can be, injectable clock and store, soft-fail-never-throw.

import { createHmac, timingSafeEqual } from 'node:crypto';

const now = (opts) => (opts && typeof opts.now === 'function' ? opts.now() : Date.now());
const str = (s) => String(s == null ? '' : s).trim();

export const LEVELS = Object.freeze(['none', 'attested', 'verified', 'id']);
export const rank = (lvl) => Math.max(0, LEVELS.indexOf(str(lvl) || 'none'));
export const meets = (have, need) => rank(have) >= rank(need);

/**
 * What each planned surface requires. The operator's property is not one site — it is a wiki,
 * galleries, user-uploaded video, live cams and more — and treating them all the same is how the
 * verification bill becomes the largest line item.
 */
export const SURFACE_POLICY = Object.freeze({
  wiki:      { level: 'none',     reason: 'editorial and anatomical material; see the lascivious-exhibition analysis' },
  preview:   { level: 'none',     reason: 'clothed or obscured teaser that gates inward — the one place blurring reliably buys something' },
  gallery:   { level: 'verified', reason: 'produced or licensed stills' },
  video:     { level: 'verified', reason: 'user-uploaded video' },
  live:      { level: 'verified', reason: 'live cams' },
  upload:    { level: 'id',       reason: 'anyone PUBLISHING must be identified — this is the 2257 side, not the viewer side' },
  payout:    { level: 'id',       reason: 'anyone being PAID must be identified' },
});

export const policyFor = (surface) => SURFACE_POLICY[str(surface)] || { level: 'id', reason: 'unknown surface — fail closed' };

// ── the record store ────────────────────────────────────────────────────────────────────────────

const fresh = () => ({ records: new Map(), counters: { attested: 0, verified: 0, id: 0, reused: 0 } });
let STORE = fresh();
export function __reset() { STORE = fresh(); }
const store = (opts) => (opts && opts.store) || STORE;

// Matched as SUBSTRINGS, not whole words. An earlier version anchored these with ^…$ and let
// `face_scan` through, because normalising the separator turns it into `facescan` which equals
// neither `face` nor `scan`. A guard that is weaker than it claims is worse than no guard, so this
// one over-refuses by design — the record schema here is tiny and known, and failing closed on an
// unexpected field is the correct direction for a store that must never hold a document.
const PII_SUBSTRINGS = [
  'dob', 'birth', 'ssn', 'socialsecurity', 'passport', 'licence', 'license', 'driver',
  'selfie', 'face', 'scan', 'photo', 'image', 'document', 'idnumber', 'nationalid', 'biometric',
];

/** Refuse to persist anything that looks like identity document data. Enforced, not advisory. */
export function assertNoPII(record) {
  for (const k of Object.keys(record || {})) {
    const flat = k.replace(/[_\s-]/g, '').toLowerCase();
    const hit = PII_SUBSTRINGS.find((p) => flat.includes(p));
    if (hit) {
      return { ok: false, reason: `refusing to store "${k}" (matched "${hit}") — age gates keep a result, never the document` };
    }
  }
  return { ok: true };
}

export const TTL_BY_LEVEL = Object.freeze({ attested: 24 * 3600 * 1000, verified: 180 * 24 * 3600 * 1000, id: 365 * 24 * 3600 * 1000 });

/**
 * Record a completed check. `providerRef` is an opaque receipt from whoever did the work — enough to
 * answer an auditor, not enough to reconstruct the person.
 */
export function record(subject, level, { provider = 'self', providerRef = '', ttlMs = 0 } = {}, opts = {}) {
  const s = str(subject); const lv = str(level);
  if (!s) return { ok: false, reason: 'no subject' };
  if (!LEVELS.includes(lv) || lv === 'none') return { ok: false, reason: 'not a verification level' };
  const rec = { subject: s, level: lv, provider: str(provider), providerRef: str(providerRef).slice(0, 120), at: now(opts) };
  const guard = assertNoPII(rec);
  if (!guard.ok) return guard;
  rec.expiresAt = rec.at + (Number(ttlMs) || TTL_BY_LEVEL[lv] || 0);
  const st = store(opts);
  const prev = st.records.get(s);
  // never downgrade a stronger, still-valid result into a weaker one
  if (prev && prev.expiresAt > rec.at && rank(prev.level) > rank(lv)) return { ok: true, record: { ...prev }, kept: true };
  st.records.set(s, rec);
  st.counters[lv] = (st.counters[lv] || 0) + 1;
  return { ok: true, record: { ...rec } };
}

export function lookup(subject, opts = {}) {
  const r = store(opts).records.get(str(subject));
  if (!r) return null;
  if (r.expiresAt <= now(opts)) return null;
  return { ...r };
}

/** The whole point: what does this person still need to do to enter this surface? */
export function check(subject, surface, opts = {}) {
  const need = policyFor(surface);
  if (need.level === 'none') return { ok: true, allowed: true, need: 'none', have: 'none', paidCheckRequired: false };
  const have = lookup(subject, opts);
  const haveLevel = have ? have.level : 'none';
  if (meets(haveLevel, need.level)) {
    store(opts).counters.reused += 1;
    return { ok: true, allowed: true, need: need.level, have: haveLevel, paidCheckRequired: false, expiresAt: have.expiresAt };
  }
  return {
    ok: true,
    allowed: false,
    need: need.level,
    have: haveLevel,
    // attestation costs nothing; only the real checks spend money, and this is what the cost model counts
    paidCheckRequired: rank(need.level) >= rank('verified'),
    reason: need.reason,
  };
}

/** What the gate has cost so far, so the per-visitor bill is visible rather than discovered. */
export function costReport(pricePerCheck = { attested: 0, verified: 0.25, id: 1.5 }, opts = {}) {
  const c = store(opts).counters;
  const spend = (c.verified || 0) * (pricePerCheck.verified || 0) + (c.id || 0) * (pricePerCheck.id || 0);
  const wouldHaveSpent = ((c.verified || 0) + (c.id || 0) + (c.reused || 0)) * (pricePerCheck.verified || 0);
  return {
    checks: { ...c },
    spend: Number(spend.toFixed(2)),
    savedByReuse: Number(Math.max(0, wouldHaveSpent - spend).toFixed(2)),
    note: 'a cached result is the difference between paying per visitor and paying per person',
  };
}

// ── tokens ──────────────────────────────────────────────────────────────────────────────────────

const b64u = (b) => Buffer.from(b).toString('base64url');

/**
 * A signed, scoped, expiring pass. It carries the LEVEL and the expiry and nothing else — no name,
 * no birth date, nothing that identifies the holder to a surface that does not already know them.
 */
export function mintToken(subject, level, secret, { ttlMs = 0, audience = '' } = {}, opts = {}) {
  const lv = str(level);
  if (!LEVELS.includes(lv) || lv === 'none') return { ok: false, reason: 'not a verification level' };
  if (!str(secret)) return { ok: false, reason: 'no signing secret' };
  const exp = now(opts) + (Number(ttlMs) || TTL_BY_LEVEL[lv] || 0);
  const body = b64u(JSON.stringify({ s: str(subject), l: lv, a: str(audience), e: exp }));
  const sig = b64u(createHmac('sha256', str(secret)).update(body).digest());
  return { ok: true, token: `ag1.${body}.${sig}`, expiresAt: exp };
}

export function verifyToken(token, secret, { audience = '' } = {}, opts = {}) {
  const m = /^ag1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(str(token));
  if (!m) return { ok: false, reason: 'malformed' };
  const want = Buffer.from(b64u(createHmac('sha256', str(secret)).update(m[1]).digest()));
  const got = Buffer.from(m[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: 'bad signature' };
  let body;
  try { body = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
  if (!body || typeof body !== 'object') return { ok: false, reason: 'malformed' };
  if (Number(body.e) <= now(opts)) return { ok: false, reason: 'expired' };
  if (audience && str(body.a) && str(body.a) !== str(audience)) return { ok: false, reason: 'wrong audience' };
  return { ok: true, subject: body.s, level: body.l, audience: body.a, expiresAt: body.e };
}

// ── providers ───────────────────────────────────────────────────────────────────────────────────

/**
 * A provider does the actual checking. Self-attestation is built in because every surface needs a
 * cheap bottom rung; anything stronger is injected, so a vendor can be swapped without touching
 * policy. A provider returns a LEVEL and an opaque reference — never document data.
 */
/**
 * CLICK-TO-REVEAL IS NOT AGE VERIFICATION, and this exists so the codebase can never pretend it is.
 *
 * A blurred thumbnail the viewer clicks to unblur is a CONSENT-TO-VIEW interstitial: it establishes
 * that the person chose to see the thing, which is a real and useful property — it answers
 * "displayed to" framing, it satisfies platform moderation expectations, and it is the one
 * configuration adult ad networks permit on cheaper inventory. It establishes NOTHING about age.
 * Under the state age-verification statutes a click, a checkbox or an "I am 18" interstitial is
 * expressly insufficient.
 *
 * So a reveal records at most `attested`, and `revealOnly()` refuses outright to answer a surface
 * that needs `verified` or better. The ceiling is enforced here rather than left to the caller.
 */
export const REVEAL_MAX_LEVEL = 'attested';

export function reveal(subject, surface, opts = {}) {
  const need = policyFor(surface);
  if (rank(need.level) > rank(REVEAL_MAX_LEVEL)) {
    return {
      ok: false,
      reason: `a reveal click cannot satisfy "${need.level}" — it is consent to view, not age assurance`,
      need: need.level,
    };
  }
  const r = record(subject, REVEAL_MAX_LEVEL, { provider: 'reveal', providerRef: `reveal:${str(surface)}` }, opts);
  return r.ok ? { ...r, consentToView: true, ageAssured: false } : r;
}

/**
 * Whether a blurred preview is a real gate or just a CSS effect. A client-side blur over the
 * full-resolution original is cosmetic — the image is in the page source and in the network tab —
 * so it gates nothing. A real one serves a degraded derivative and fetches the original only after
 * the gate passes. Callers declare which they built; `cosmetic` is reported, not silently accepted.
 */
export function previewMode({ serverSideDerivative = false, originalWithheld = false } = {}) {
  const real = !!serverSideDerivative && !!originalWithheld;
  return {
    mode: real ? 'gated' : 'cosmetic',
    gates: real,
    note: real
      ? 'a degraded derivative is served and the original is withheld until the gate passes'
      : 'CSS blur over the original is cosmetic — the full image is already in the page',
  };
}

export const selfAttestation = {
  id: 'self',
  level: 'attested',
  async check({ attested }) {
    return attested === true
      ? { ok: true, level: 'attested', providerRef: 'self-attested' }
      : { ok: false, reason: 'not attested' };
  },
};

export async function runCheck(provider, subject, input = {}, opts = {}) {
  const p = provider || selfAttestation;
  if (!p || typeof p.check !== 'function') return { ok: false, reason: 'no provider' };
  let out;
  try { out = await p.check(input); } catch (e) { return { ok: false, reason: String((e && e.message) || 'provider failed') }; }
  if (!out || !out.ok) return { ok: false, reason: (out && out.reason) || 'declined' };
  return record(subject, out.level || p.level, { provider: p.id || 'provider', providerRef: out.providerRef }, opts);
}
