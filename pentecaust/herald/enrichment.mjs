// pentecaust/herald/enrichment.mjs — Herald LEAD-ENRICHMENT waterfall (the Clay / Hunter.io pattern).
// Given a thin lead ({ name, domain, email }) run an ORDERED list of enrichment providers and merge the
// FIRST non-empty value per field (a "waterfall": cheap/high-confidence providers first, fall through to
// the next only for fields still blank). Verifies the resolved email's format. Pure & offline by default —
// providers are INJECTED; with none configured it soft-fails to { ...input, enriched:false }.
//
//   import { enrichLead, verifyEmail, __setProviders, __setFetch } from './enrichment.mjs'
//   __setProviders([hunterProvider, clayProvider]);           // ordered waterfall
//   const lead = await enrichLead({ name:'Ada Lovelace', domain:'analytical.co' });
//
// House rules: ESM .mjs, esc() any interpolation, injectable fetch (__setFetch) + providers (__setProviders),
// soft-fail-never-throw, fully offline unit tests (no network).

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const clamp = (s, n = 2000) => String(s == null ? '' : s).slice(0, n);
const clean = (s) => clamp(s).trim();

// The fields a provider may resolve. `email`/`title`/`company`/`phone` waterfall (first non-empty wins);
// `verified` is a boolean a provider may assert (e.g. Hunter's deliverability check) and is OR-ed in.
const WATERFALL_FIELDS = ['email', 'title', 'company', 'phone'];

// ── injectable seams ────────────────────────────────────────────────────────────────────────────────────
// A real provider does its own HTTP; we hand it this fetch so tests stay offline. Never called by the core.
let _fetch = (...a) => (globalThis.fetch ? globalThis.fetch(...a) : Promise.reject(new Error('no fetch')));
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

// Ordered provider list. Each provider: async ({ name, domain, email, ...partial }, ctx) → partial lead
// { email?, title?, company?, phone?, verified?, source? } (any subset). Missing/unconfigured providers
// simply return null/{} and the waterfall moves on. Empty list ⇒ enrichLead soft-fails (enriched:false).
let _providers = [];
export function __setProviders(fns) { _providers = Array.isArray(fns) ? fns.filter((f) => typeof f === 'function') : []; }
export function getProviders() { return _providers.slice(); }

// ── deterministic email format check (offline — no MX/SMTP probe) ───────────────────────────────────────
// Same shape rule the sender uses: one @, non-empty local, dotted domain with a 2+ char TLD, no whitespace.
export function verifyEmail(addr) {
  const e = String(addr == null ? '' : addr).trim().toLowerCase();
  if (!e || e.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

// ── the waterfall ───────────────────────────────────────────────────────────────────────────────────────
/**
 * enrichLead({ name, domain, email }) — run providers in order, merging the first non-empty value per field.
 * @returns {Promise<{ name, domain, email, title, company, phone, verified, enriched, sources }>}
 *   `enriched` is true only if at least one provider contributed a field. Never throws (a provider that
 *   throws is contained and skipped). With no providers configured → { ...input, enriched:false }.
 */
export async function enrichLead(input = {}) {
  const lead = {
    name: clean(input && input.name),
    domain: clean(input && input.domain),
    email: clean(input && input.email).toLowerCase(),
  };
  const providers = _providers.slice();
  if (!providers.length) {
    // UNCONFIGURED → soft no-op: hand the input straight back, still format-verifying any given email.
    return { ...lead, title: '', company: '', phone: '', verified: verifyEmail(lead.email), enriched: false, sources: [] };
  }

  const merged = { email: lead.email, title: '', company: '', phone: '', verified: false };
  const sources = [];
  for (const provider of providers) {
    let part = null;
    try { part = await provider({ ...lead, ...merged }, { fetch: _fetch }); }
    catch { part = null; }                                   // a throwing provider is contained (soft-fail)
    if (!part || typeof part !== 'object') continue;
    let contributed = false;
    for (const f of WATERFALL_FIELDS) {
      if (!merged[f] && part[f] != null && String(part[f]).trim() !== '') {
        merged[f] = clean(part[f]);
        contributed = true;
      }
    }
    if (part.verified === true && !merged.verified) { merged.verified = true; contributed = true; }
    if (contributed) sources.push(clean(part.source) || 'provider');
    // Waterfall short-circuit: once every waterfall field is filled there's nothing left to resolve.
    if (WATERFALL_FIELDS.every((f) => merged[f])) break;
  }

  // A provider may assert deliverability; otherwise we fall back to our own deterministic format check.
  const verified = merged.verified || verifyEmail(merged.email);
  return {
    name: lead.name, domain: lead.domain,
    email: merged.email, title: merged.title, company: merged.company, phone: merged.phone,
    verified, enriched: sources.length > 0, sources,
  };
}

// ── HOW A REAL PROVIDER PLUGS IN (reference only — NOT wired, makes NO live calls) ──────────────────────
// A provider is a small async fn that reads the lead, does one HTTP round-trip via the injected ctx.fetch,
// and returns a partial lead. Configure the ordered waterfall with __setProviders([...]). Keys live in env
// (per CLAUDE.md key-custody — never in the repo). Examples, commented so nothing runs offline/in tests:
//
//   // Hunter.io — email-finder + deliverability verify. Docs: https://hunter.io/api-documentation
//   export const hunterProvider = async ({ name, domain }, ctx) => {
//     const key = process.env.HUNTER_API_KEY; if (!key || !domain) return null;
//     const [first = '', last = ''] = String(name || '').split(/\s+/);
//     const u = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}`
//             + `&first_name=${encodeURIComponent(first)}&last_name=${encodeURIComponent(last)}&api_key=${key}`;
//     const r = await ctx.fetch(u); const j = await r.json(); const d = j && j.data;
//     return d ? { email: d.email, title: d.position, company: d.company,
//                  verified: d.verification && d.verification.status === 'valid', source: 'hunter' } : null;
//   };
//
//   // Clay / Apollo-style person-enrichment — richer firmographics + direct dials.
//   export const clayProvider = async ({ email, domain }, ctx) => {
//     const key = process.env.CLAY_API_KEY; if (!key) return null;
//     const r = await ctx.fetch('https://api.clay.com/v1/people/enrich', {
//       method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
//       body: JSON.stringify({ email, domain }) });
//     const j = await r.json(); const p = j && j.person;
//     return p ? { title: p.title, company: p.company_name, phone: p.phone, source: 'clay' } : null;
//   };
//
//   __setProviders([hunterProvider, clayProvider]);   // cheap/high-confidence first, fall through per field.

// ── CLI demo (offline; a fake provider — never touches the network) ─────────────────────────────────────
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  __setProviders([
    async ({ name }) => ({ email: `${String(name).toLowerCase().replace(/\s+/g, '.')}@demo.co`, source: 'guess' }),
    async () => ({ title: 'Founder', company: 'Demo Co', verified: true, source: 'fake-clay' }),
  ]);
  enrichLead({ name: 'Ada Lovelace', domain: 'demo.co' }).then((l) => console.log('enrichLead →', l));
}
