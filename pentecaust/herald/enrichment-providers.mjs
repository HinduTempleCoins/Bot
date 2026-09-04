// pentecaust/herald/enrichment-providers.mjs — REAL provider adapters for the Herald enrichment waterfall.
//
// The waterfall in ./enrichment.mjs is provider-agnostic: __setProviders([...]) takes an ordered list of
// async fns `provider(lead, ctx) → partial{ email?, title?, company?, phone?, verified?, source? }`, and the
// core hands each one an injected `ctx.fetch` so tests stay offline. This file supplies the real adapters —
// Hunter.io, Clearbit, Clay — as FACTORIES you configure once and drop into that list:
//
//   import { enrichLead, __setProviders } from './enrichment.mjs';
//   import { hunterProvider, clearbitProvider, clayProvider } from './enrichment-providers.mjs';
//   __setProviders([ hunterProvider({ apiKey: process.env.HUNTER_API_KEY }),   // cheap/high-confidence first
//                    clearbitProvider(),                                       // key pulled from env
//                    clayProvider() ]);                                        // fall through per field
//   const lead = await enrichLead({ name: 'Ada Lovelace', domain: 'analytical.co' });
//
// Each factory `xProvider({ apiKey })` returns an async `provider(lead, ctx)`:
//   • env-gated — key = cfg.apiKey || process.env.<NAME>, resolved at CALL time so env can be set late.
//   • soft-fail to null when no key is configured, or on any HTTP / parse error (NEVER throws — the core
//     also contains throws, but we contain them here so an unconfigured provider is a clean no-op).
//   • injectable fetch — uses ctx.fetch (what the waterfall passes) if present, else this module's _fetch
//     (settable via __setFetch), else globalThis.fetch. Unit tests inject a fake fetch; no network offline.
//
// House rules: ESM .mjs, esc() any interpolation, injectable fetch, soft-fail-never-throw, offline tests.
// Key custody (CLAUDE.md §7): keys live in the Witness host env, never in this repo. Endpoints below are the
// documented public APIs — no key material is committed here.

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── injectable fetch seam ───────────────────────────────────────────────────────────────────────────────
// The waterfall passes ctx.fetch to every provider; this module-level fetch is the fallback for direct use
// (calling a provider fn without a ctx, e.g. in isolation tests). __setFetch overrides it offline.
let _fetch = (...a) => (globalThis.fetch ? globalThis.fetch(...a) : Promise.reject(new Error('no fetch')));
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }
const pickFetch = (ctx) => (ctx && typeof ctx.fetch === 'function' ? ctx.fetch : _fetch);

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────
const s = (v) => String(v == null ? '' : v).trim();
const enc = encodeURIComponent;
// Resolve a config-or-env key at call time. Returns '' when neither is set (→ provider soft-fails to null).
const resolveKey = (cfgKey, envName) => s(cfgKey) || s(process.env[envName]);
// Split a full name into { first, last } — everything after the first token is the surname.
function splitName(name) {
  const parts = s(name).split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') || '' };
}
// Read a partial as JSON, tolerating a fetch that returns { json() } or a plain object; never throws.
async function readJson(res) {
  try {
    if (res && typeof res.json === 'function') return await res.json();
    return res && typeof res === 'object' ? res : null;
  } catch { return null; }
}
// Drop blank/undefined fields so the waterfall's "first non-empty wins" merge isn't polluted with ''.
function prune(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (k === 'verified') { if (v === true) out.verified = true; continue; }
    if (v != null && s(v) !== '') out[k] = s(v);
  }
  return out;
}

// ── Hunter.io — email-finder + deliverability verify ────────────────────────────────────────────────────
// Docs: https://hunter.io/api-documentation  ·  GET https://api.hunter.io/v2/email-finder
// Params: domain, first_name, last_name, api_key. Response: { data:{ email, position, company,
// verification:{ status } } } — status 'valid' ⇒ deliverable. Needs a domain + a name to guess the address.
export function hunterProvider(cfg = {}) {
  return async function hunter(lead = {}, ctx) {
    const key = resolveKey(cfg.apiKey, 'HUNTER_API_KEY');
    const domain = s(lead.domain);
    if (!key || !domain) return null;                        // env-gated / needs a domain — soft no-op
    const { first, last } = splitName(lead.name);
    const url = 'https://api.hunter.io/v2/email-finder'
      + `?domain=${enc(domain)}&first_name=${enc(first)}&last_name=${enc(last)}&api_key=${enc(key)}`;
    try {
      const res = await pickFetch(ctx)(url);
      const j = await readJson(res);
      const d = j && j.data;
      if (!d) return null;
      return prune({
        email: d.email,
        title: d.position,
        company: d.company,
        verified: d.verification && d.verification.status === 'valid',
        source: 'hunter',
      });
    } catch { return null; }                                 // HTTP / parse error → soft-fail
  };
}

// ── Clearbit — Person + Company (combined) enrichment ───────────────────────────────────────────────────
// Docs: https://dashboard.clearbit.com/docs#enrichment-api  ·  GET https://person.clearbit.com/v2/combined/find
// Auth: Authorization: Bearer <key>. Query: email (required). Response: { person:{ email,
// employment:{ title }, phone }, company:{ name } }. Keyed off the lead's email, so it enriches TITLE/COMPANY/
// PHONE for a lead that already resolved an address (place it AFTER hunter in the waterfall).
export function clearbitProvider(cfg = {}) {
  return async function clearbit(lead = {}, ctx) {
    const key = resolveKey(cfg.apiKey, 'CLEARBIT_API_KEY');
    const email = s(lead.email);
    if (!key || !email) return null;                         // env-gated / needs an email — soft no-op
    const url = `https://person.clearbit.com/v2/combined/find?email=${enc(email)}`;
    try {
      const res = await pickFetch(ctx)(url, { headers: { authorization: `Bearer ${key}` } });
      const j = await readJson(res);
      const p = j && j.person;
      const c = j && j.company;
      if (!p && !c) return null;
      return prune({
        email: p && p.email,
        title: p && p.employment && p.employment.title,
        company: c && c.name,
        phone: p && p.phone,
        source: 'clearbit',
      });
    } catch { return null; }
  };
}

// ── Clay / Apollo-style — person enrichment (richer firmographics + direct dials) ───────────────────────
// Docs: https://www.clay.com/university/guide/clay-api  ·  POST https://api.clay.com/v1/people/enrich
// Auth: Authorization: Bearer <key>, content-type: application/json. Body: { email, domain }. Response:
// { person:{ title, company_name, phone, email } }. Deepest/most-expensive lookup → last in the waterfall.
export function clayProvider(cfg = {}) {
  return async function clay(lead = {}, ctx) {
    const key = resolveKey(cfg.apiKey, 'CLAY_API_KEY');
    const email = s(lead.email);
    const domain = s(lead.domain);
    if (!key || (!email && !domain)) return null;            // env-gated / needs a handle — soft no-op
    try {
      const res = await pickFetch(ctx)('https://api.clay.com/v1/people/enrich', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ email, domain }),
      });
      const j = await readJson(res);
      const p = j && j.person;
      if (!p) return null;
      return prune({
        email: p.email,
        title: p.title,
        company: p.company_name,
        phone: p.phone,
        source: 'clay',
      });
    } catch { return null; }
  };
}

// Convenience: the standard ordered waterfall (cheap/high-confidence → deep/expensive). Any unconfigured
// provider is a clean no-op, so this is safe to pass to __setProviders even with zero keys in the env.
export function defaultProviders(cfg = {}) {
  return [
    hunterProvider({ apiKey: cfg.hunterKey }),
    clearbitProvider({ apiKey: cfg.clearbitKey }),
    clayProvider({ apiKey: cfg.clayKey }),
  ];
}

// ── CLI demo (offline; a fake fetch — never touches the network) ────────────────────────────────────────
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  __setFetch(async (url) => ({
    json: async () => (String(url).includes('hunter')
      ? { data: { email: 'ada@analytical.co', position: 'Founder', company: 'Analytical Engines',
                  verification: { status: 'valid' } } }
      : { person: { employment: { title: 'CEO' }, phone: '+1-555-0100' }, company: { name: 'Analytical Engines' } }),
  }));
  const hunter = hunterProvider({ apiKey: 'demo' });
  hunter({ name: 'Ada Lovelace', domain: 'analytical.co' }).then((p) => console.log('hunterProvider →', p));
}
