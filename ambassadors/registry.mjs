// ambassadors/registry.mjs — the AMBASSADOR enrollment store (Phase A, design (a)).
//
// An ambassador is a MELEK account that has OPTED IN to the growth program and been issued a referral
// `/go` code + a Herald tenant scope. This module is the single record every rail keys off: one row per
// ambassador — { account, status, code, tier, karmaAtEnroll, mailboxConnected, enrolledAt, tenantId }.
//
// It welds together rails that already exist — it does NOT reimplement them:
//   • `/go/{code}` referral code  → registered via pentecaust/herald/qr-tracker.mjs `registerCampaign`.
//   • account validity            → signup/welcome-grant.mjs `validAccountName`.
//   • the karma FLOOR             → a value supplied by the caller (opts.karma) or an injectable
//                                    opts.getKarma(account) fn (karma/karma.mjs in production). No key,
//                                    no chain write, no network — pure/soft-fail, offline-testable.
//
// GATE (design (a), in order): have an account (valid name) → clear a small karma+tenure floor
// (deliberately low, anti-sybil, config constants) → get a referral code (`amb-<account>` or a vanity
// slug, sanitized to the qr-tracker code charset) pointing at the signup landing page with `ref=<code>`.
// Approval is LIGHT (a floor, not a committee) so the funnel stays open; self-apply is the default path.
//
// Rewards/curation/outreach are NOT here — this is enrollment + code issuance + tier only. Token payouts
// are computed as UNSIGNED plans elsewhere (earnings.mjs) and signed by MELEK-Signer later. Zero WIF here.
//
//   import { enroll, getAmbassador, getByCode, listAmbassadors, setStatus, tierFor } from './registry.mjs'

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerCampaign, qrTargetUrl } from '../pentecaust/herald/qr-tracker.mjs';
import { validAccountName } from '../signup/welcome-grant.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

export const DATA_FILE = () => env('AMBASSADORS_DATA', join(process.cwd(), 'data', 'ambassadors.json'));
const BASE_URL = () => (env('BASE_URL', 'https://melek.salon') || 'https://melek.salon').replace(/\/$/, '');
// Deliberately LOW floors — a growth program, not a priesthood — but non-zero so day-one throwaways can't farm.
export const KARMA_FLOOR = () => Number(env('AMBASSADOR_KARMA_FLOOR', '5')) || 0;
export const TENURE_FLOOR_DAYS = () => Number(env('AMBASSADOR_TENURE_FLOOR_DAYS', '3')) || 0;

const now = (o) => (o && o.now != null ? o.now : Date.now());
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const normAcct = (a) => { const s = String(a || '').trim().toLowerCase(); return s || null; };
// Referral codes must satisfy the qr-tracker charset (a-z 0-9 - , <=40). Account names carry dots — fold them.
const CODE_RE = /^[a-z0-9-]{1,40}$/;
function sanitizeCode(raw) {
  const c = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return CODE_RE.test(c) ? c : null;
}
const codeFor = (account) => sanitizeCode(`amb-${account}`);

// ── injectable fs + store ───────────────────────────────────────────────────────────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} writeFileSync(p, s); },
};
function loadStore(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { ambassadors: {} };
  try { const o = JSON.parse(raw); return o && o.ambassadors ? o : { ambassadors: {} }; }
  catch { return { ambassadors: {} }; }
}
const saveStore = (fs, file, s) => (fs.write || realFs.write)(file, JSON.stringify(s));
const ctx = (o = {}) => ({ fs: o.fs || realFs, file: o.file || DATA_FILE() });

// ── tiers (config; results-gated, NEVER buyable) ──────────────────────────────────────────────────────
// Tier is a FUNCTION of earned results (surviving referrals + curation karma), computed, never set by hand.
// It lifts reward multipliers within hard caps and unlocks a bigger curation-budget share.
export const TIERS = [
  { min: 0, tier: 'scout', referralMultiplier: 1.0, curationBudgetShare: 1.0 },
  { min: 3, tier: 'herald', referralMultiplier: 1.25, curationBudgetShare: 1.5 },
  { min: 10, tier: 'envoy', referralMultiplier: 1.5, curationBudgetShare: 2.0 },
];
export function tierFor({ survivingReferrals = 0, curationKarma = 0 } = {}) {
  // Results score: each surviving referral counts 1; curation-karma contributes gently (÷20).
  const score = (Number(survivingReferrals) || 0) + (Number(curationKarma) || 0) / 20;
  let t = TIERS[0];
  for (const x of TIERS) if (score >= x.min) t = x;
  return { ...t, score: Math.round(score * 100) / 100 };
}

async function resolveKarma(who, opts) {
  if (opts.karma != null) return Number(opts.karma) || 0;
  if (typeof opts.getKarma === 'function') { try { return Number(await opts.getKarma(who)) || 0; } catch { return 0; } }
  return 0; // fail-closed: no karma signal → treated as 0 (below any non-zero floor)
}

// ── public, store-free view (safe to hand to a client) ────────────────────────────────────────────────
export function viewAmbassador(row) {
  if (!row) return null;
  return {
    account: row.account, status: row.status, code: row.code, tier: row.tier,
    karmaAtEnroll: row.karmaAtEnroll, mailboxConnected: !!row.mailboxConnected,
    enrolledAt: row.enrolledAt, tenantId: row.tenantId,
    referralLink: qrTargetUrl(row.code),
  };
}

// ── operations ────────────────────────────────────────────────────────────────────────────────────────
/**
 * enroll — an existing MELEK account SELF-APPLIES. Checks the karma + tenure floor, issues a `/go`
 * referral code (registerCampaign → landing page stamped with ?ref=<code>), stores the row.
 * Idempotent: re-enrolling a known active ambassador returns the existing row.
 * @param {string} account
 * @param {object} opts  { karma?, getKarma?, tenureDays?, vanity?, landingUrl?, mailboxConnected?,
 *                         fs?, file?, now?, qr? (opts forwarded to registerCampaign's store) }
 * @returns {Promise<{ok:true, ambassador} | {ok:false, reason}>}
 */
export async function enroll(account, opts = {}) {
  const who = normAcct(account);
  if (!who || !validAccountName(who)) return { ok: false, reason: 'account must be a valid MELEK account name' };

  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const existing = store.ambassadors[who];
  if (existing && existing.status !== 'revoked') return { ok: true, ambassador: viewAmbassador(existing), existing: true };

  // Floor gate (anti-sybil; deliberately low).
  const karma = await resolveKarma(who, opts);
  if (karma < KARMA_FLOOR()) return { ok: false, reason: `karma floor not met (${karma} < ${KARMA_FLOOR()})` };
  const tenureDays = Number(opts.tenureDays ?? opts.tenure ?? 0) || 0;
  if (tenureDays < TENURE_FLOOR_DAYS()) return { ok: false, reason: `tenure floor not met (${tenureDays}d < ${TENURE_FLOOR_DAYS()}d)` };

  // Referral code — vanity slug or amb-<account>, sanitized to the qr-tracker charset; must be unique.
  const code = sanitizeCode(opts.vanity) || codeFor(who);
  if (!code) return { ok: false, reason: 'could not derive a valid referral code' };
  const taken = Object.values(store.ambassadors).find((r) => r.code === code && r.account !== who);
  if (taken) return { ok: false, reason: `referral code '${code}' already taken` };

  // Register the /go campaign whose landing page carries ref=<code> into the signup flow.
  const landing = String(opts.landingUrl || `${BASE_URL()}/signup`);
  const sep = landing.includes('?') ? '&' : '?';
  const landingUrl = `${landing}${sep}ref=${encodeURIComponent(code)}`;
  const reg = registerCampaign(code, { landingUrl, label: `Ambassador ${who}` }, opts.qr || {});
  if (!reg.ok) return { ok: false, reason: `could not register referral code: ${reg.reason}` };

  const row = {
    account: who,
    status: 'active',            // light approval: floor cleared → active (self-apply). 'applied' reserved for future review gate.
    code,
    tier: 'scout',
    karmaAtEnroll: karma,
    mailboxConnected: !!opts.mailboxConnected,
    enrolledAt: now(opts),
    tenantId: `amb-${who}`,       // Herald tenant scope (outreach leg, Phase C)
  };
  store.ambassadors[who] = row;
  saveStore(fs, file, store);
  return { ok: true, ambassador: viewAmbassador(row) };
}

/** Read one ambassador's row (raw), or null. */
export function getAmbassadorRaw(account, opts = {}) {
  const { fs, file } = ctx(opts);
  return loadStore(fs, file).ambassadors[normAcct(account)] || null;
}
/** Read one ambassador (public view), or null. */
export function getAmbassador(account, opts = {}) {
  return viewAmbassador(getAmbassadorRaw(account, opts));
}
/** Resolve a referral `/go` code → the ambassador that owns it (public view), or null. */
export function getByCode(code, opts = {}) {
  const c = sanitizeCode(code);
  if (!c) return null;
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const row = Object.values(store.ambassadors).find((r) => r.code === c);
  return row ? viewAmbassador(row) : null;
}
/** List all ambassadors (public views). */
export function listAmbassadors(opts = {}) {
  const { fs, file } = ctx(opts);
  return Object.values(loadStore(fs, file).ambassadors).map(viewAmbassador);
}

/** Set an ambassador's status: active|paused|revoked. Soft-fail. */
export function setStatus(account, status, opts = {}) {
  const who = normAcct(account);
  const ok = new Set(['active', 'paused', 'revoked']);
  if (!ok.has(status)) return { ok: false, reason: 'status must be active|paused|revoked' };
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const row = store.ambassadors[who];
  if (!row) return { ok: false, reason: 'unknown ambassador' };
  row.status = status;
  saveStore(fs, file, store);
  return { ok: true, ambassador: viewAmbassador(row) };
}

/** Mark the mailbox-connected flag (outreach leg unlock — Phase C). */
export function setMailboxConnected(account, connected, opts = {}) {
  const who = normAcct(account);
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const row = store.ambassadors[who];
  if (!row) return { ok: false, reason: 'unknown ambassador' };
  row.mailboxConnected = !!connected;
  saveStore(fs, file, store);
  return { ok: true, ambassador: viewAmbassador(row) };
}

/**
 * Recompute + persist an ambassador's tier from earned results (surviving referrals + curation karma).
 * Computed, never set by hand. Returns the tier descriptor.
 */
export function refreshTier(account, results = {}, opts = {}) {
  const who = normAcct(account);
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const row = store.ambassadors[who];
  if (!row) return { ok: false, reason: 'unknown ambassador' };
  const t = tierFor(results);
  row.tier = t.tier;
  saveStore(fs, file, store);
  return { ok: true, tier: t };
}

// ── CLI (guarded) — offline demo on a temp store ──────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = `/tmp/ambassadors-demo-${process.pid}.json`;
  const qr = { file: `/tmp/ambassadors-demo-qr-${process.pid}.json` };
  const o = { file, qr, karma: 42, tenureDays: 30 };
  (async () => {
    console.log('MELEK Ambassador registry — offline demo:\n');
    const e = await enroll('alice', o);
    console.log('enroll(alice):', JSON.stringify(e, null, 2));
    console.log('getByCode(amb-alice):', JSON.stringify(getByCode('amb-alice', o)));
    console.log('tierFor(5 surviving):', JSON.stringify(tierFor({ survivingReferrals: 5 })));
    try { const { unlinkSync } = await import('node:fs'); unlinkSync(file); unlinkSync(qr.file); } catch {}
  })();
}
