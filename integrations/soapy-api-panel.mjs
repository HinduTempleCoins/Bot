// soapy-api-panel.mjs — Soapy.Blog coding-AI API picker + quota dashboard.
//
// One job: show, in one place, WHICH coding-AI APIs the repo can call from, whether each one's key is
// present in the environment, and how much of each provider's rate-limit budget is left right now.
// This is the operator-facing "which AIs are live and how much quota is left" panel for Soapy.Blog.
//
// The provider list is NOT invented here — it is derived from the REAL router table in
// ./llm-router.mjs (PROVIDERS: gemini, openrouter, github, groq, pollinations), so this panel and the
// router always agree on what "available" means. The keyless backstop (pollinations) is included and
// reports configured:true with no key, mirroring the router's providerUsable().
//
//   import { listProviders, quotaFor, quotaAll, handler } from './integrations/soapy-api-panel.mjs';
//   const providers = listProviders();                 // [{ id, label, configured }]
//   const q = await quotaFor('groq');                  // { id, remaining, limit, resetAt }
//   const all = await quotaAll();                      // quotaFor over every configured provider
//
// CLI:  node integrations/soapy-api-panel.mjs            (prints listProviders — booleans only)
//       node integrations/soapy-api-panel.mjs --serve    (serves GET /api-panel; auth-gated)
//
// SECURITY: keys are read only to authenticate the (optional) live quota probe. This module NEVER
// prints, logs, or returns any key or any portion of one — `configured` is a boolean, and the HTML
// table shows presence, not values. soft-fail-never-throw throughout: quota probes degrade to
// { remaining:null, error } rather than raising.

import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { PROVIDERS } from './llm-router.mjs';

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot) soapy-api-panel';
const PORT = Number(process.env.PORT || 8149);
const HOST = process.env.HOST || '127.0.0.1';

// ── injected fetch (offline-testable; never touches the network in tests) ──────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

// ── injected auth predicate (default: deny) ────────────────────────────────────────────────────
// handler() is auth-gated: the panel exposes provider names + quota, so it 401s unless the injected
// predicate approves the request. Default denies (fail-closed); a deployment wires __setAuth to its
// real check (bearer token / session). The predicate receives (req) and returns boolean.
let _auth = () => false;
export function __setAuth(fn) { _auth = typeof fn === 'function' ? fn : (() => false); }

// ── esc(): escape ALL interpolation into HTML ──────────────────────────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Provider probe endpoints (usage / rate-limit) ──────────────────────────────────────────────
// Each keyed provider exposes a lightweight endpoint whose *response headers* carry the rate-limit
// budget (x-ratelimit-*). We probe with a HEAD/GET and parse headers generically — we do NOT depend
// on any provider-specific JSON body shape. A provider with no known probe endpoint (or the keyless
// backstop) soft-fails to { remaining:null }. Endpoints kept minimal and overridable via env.
const PROBE = {
  groq: () => ({
    url: process.env.GROQ_PROBE_URL || 'https://api.groq.com/openai/v1/models',
    header: (key) => ({ authorization: `Bearer ${key}` }),
  }),
  openrouter: () => ({
    url: process.env.OPENROUTER_PROBE_URL || 'https://openrouter.ai/api/v1/auth/key',
    header: (key) => ({ authorization: `Bearer ${key}` }),
  }),
  github: () => ({
    url: process.env.GITHUB_PROBE_URL || 'https://models.inference.ai.azure.com/models',
    header: (key) => ({ authorization: `Bearer ${key}` }),
  }),
  gemini: () => ({
    url: process.env.GEMINI_PROBE_URL || 'https://generativelanguage.googleapis.com/v1beta/models',
    header: (key) => ({ 'x-goog-api-key': key }),
  }),
};

/**
 * A friendly label for a provider id (falls back to the id itself).
 */
function labelFor(name) {
  const map = {
    gemini: 'Google Gemini',
    openrouter: 'OpenRouter',
    github: 'GitHub Models',
    groq: 'Groq',
    pollinations: 'Pollinations (keyless)',
  };
  return map[name] || name;
}

/**
 * Is this provider configured (usable) right now? Keyless providers are always configured; keyed
 * ones require their env var to be present and non-empty. Reads presence ONLY — never the value.
 * @param {object} p       a PROVIDERS entry
 * @param {object} env     env map to read from (default process.env)
 */
function isConfigured(p, env) {
  if (p.keyless) return true;
  const v = env[p.env];
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * The coding-AI APIs the repo can call from, with per-provider configured-ness.
 * Derived from the router's PROVIDERS table so the panel and router never disagree.
 *
 * @param {object}   [opts]
 * @param {object}   [opts.env]   env map (default process.env). Read for KEY PRESENCE only.
 * @returns {Array<{ id:string, label:string, configured:boolean }>}
 */
export function listProviders(opts = {}) {
  const env = opts.env || process.env;
  try {
    return PROVIDERS.map((p) => ({
      id: p.name,
      label: labelFor(p.name),
      configured: isConfigured(p, env),
    }));
  } catch {
    return [];
  }
}

/**
 * Generic rate-limit header parse. Providers converge on the x-ratelimit-* convention; we read those
 * plus a couple of common variants, tolerating either seconds or an absolute timestamp for reset.
 * @param {Headers|object} headers  a fetch Headers instance OR a plain object of header pairs.
 * @returns {{ remaining:(number|null), limit:(number|null), resetAt:(string|null) }}
 */
function parseRateLimit(headers) {
  const get = (name) => {
    if (!headers) return null;
    if (typeof headers.get === 'function') return headers.get(name);
    // plain object: case-insensitive lookup
    const hit = Object.keys(headers).find((k) => k.toLowerCase() === name);
    return hit ? headers[hit] : null;
  };

  const remRaw = get('x-ratelimit-remaining') ?? get('x-ratelimit-remaining-requests') ?? get('ratelimit-remaining');
  const limRaw = get('x-ratelimit-limit') ?? get('x-ratelimit-limit-requests') ?? get('ratelimit-limit');
  const resetRaw = get('x-ratelimit-reset') ?? get('x-ratelimit-reset-requests') ?? get('ratelimit-reset');

  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const remaining = num(remRaw);
  const limit = num(limRaw);

  let resetAt = null;
  if (resetRaw != null && resetRaw !== '') {
    const n = Number(resetRaw);
    if (Number.isFinite(n)) {
      // Heuristic: a large value is an absolute epoch (s or ms); a small value is seconds-from-now.
      let ms;
      if (n > 1e12) ms = n;               // epoch millis
      else if (n > 1e9) ms = n * 1000;    // epoch seconds
      else ms = Date.now() + n * 1000;    // seconds from now
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) resetAt = d.toISOString();
    } else {
      // Some providers send a duration string like "60s" or an ISO date; keep as-is if plausible.
      resetAt = String(resetRaw);
    }
  }

  return { remaining, limit, resetAt };
}

/**
 * Query one provider's usage / rate-limit budget. NEVER throws.
 * Reads the provider's key from env only to authenticate the probe (never returned/logged). On any
 * failure — no key, no known probe endpoint, network error, non-ok status — soft-fails to
 * { id, remaining:null, limit:null, resetAt:null, error }.
 *
 * @param {string}  providerId
 * @param {object}  [opts]
 * @param {object}  [opts.env]      env map (default process.env)
 * @param {number}  [opts.timeout]  probe timeout ms (default 10000)
 * @returns {Promise<{ id:string, remaining:(number|null), limit:(number|null), resetAt:(string|null), error?:string }>}
 */
export async function quotaFor(providerId, opts = {}) {
  const env = opts.env || process.env;
  const empty = { id: providerId, remaining: null, limit: null, resetAt: null };
  try {
    const p = PROVIDERS.find((x) => x.name === providerId);
    if (!p) return { ...empty, error: 'unknown provider' };
    if (p.keyless) return { ...empty, error: 'keyless: no quota endpoint' };
    if (!isConfigured(p, env)) return { ...empty, error: 'no key configured' };

    const probeFn = PROBE[providerId];
    if (!probeFn) return { ...empty, error: 'no probe endpoint' };

    const key = env[p.env];
    const { url, header } = probeFn();
    const timeout = Number(opts.timeout) || 10000;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    let r;
    try {
      r = await _fetch(url, {
        method: 'GET',
        headers: { 'user-agent': UA, accept: 'application/json', ...header(key) },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }

    const parsed = parseRateLimit(r && r.headers);
    const out = { id: providerId, remaining: parsed.remaining, limit: parsed.limit, resetAt: parsed.resetAt };
    if (parsed.remaining == null && parsed.limit == null) out.error = 'no rate-limit headers';
    return out;
  } catch (e) {
    return { ...empty, error: (e && e.message) ? e.message : 'probe failed' };
  }
}

/**
 * Query the quota for every configured provider, in parallel. NEVER throws.
 * @param {object} [opts]  passed through to listProviders / quotaFor (env, timeout).
 * @returns {Promise<Array>}  one quotaFor result per configured provider.
 */
export async function quotaAll(opts = {}) {
  try {
    const configured = listProviders(opts).filter((p) => p.configured);
    return await Promise.all(configured.map((p) => quotaFor(p.id, opts)));
  } catch {
    return [];
  }
}

// ── HTML rendering ─────────────────────────────────────────────────────────────────────────────
function renderRow(p, quota) {
  const cfg = p.configured
    ? '<span class="ok">yes</span>'
    : '<span class="no">no</span>';
  const q = quota || {};
  const remaining = q.remaining == null ? '—' : esc(q.remaining);
  const limit = q.limit == null ? '—' : esc(q.limit);
  const reset = q.resetAt == null ? '—' : esc(q.resetAt);
  const note = q.error ? `<span class="err">${esc(q.error)}</span>` : '';
  return `<tr>
    <td>${esc(p.label)} <code>${esc(p.id)}</code></td>
    <td>${cfg}</td>
    <td>${remaining} / ${limit}</td>
    <td>${reset} ${note}</td>
  </tr>`;
}

/**
 * Render the full panel HTML. `quotas` is an array of quotaFor results (matched by id).
 */
export function renderPanel(providers, quotas) {
  const byId = {};
  for (const q of (quotas || [])) byId[q.id] = q;
  const rows = (providers || []).map((p) => renderRow(p, byId[p.id])).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Soapy.Blog — Coding-AI API Panel</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { font-size: 1.3rem; }
  table { border-collapse: collapse; width: 100%; max-width: 760px; }
  th, td { text-align: left; padding: .5rem .7rem; border-bottom: 1px solid #ddd; }
  th { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: #666; }
  code { background: #f2f2f2; padding: 0 .3em; border-radius: 3px; font-size: .85em; }
  .ok { color: #0a7d2c; font-weight: 600; }
  .no { color: #999; }
  .err { color: #b00; font-size: .8em; }
  .badge { position: absolute; top: 8px; left: 8px; font-size: .7rem; background: #eee; padding: 2px 6px; border-radius: 4px; }
</style></head>
<body>
<span class="badge">Alpha</span>
<h1>Coding-AI API Panel</h1>
<p>Which coding-AI APIs Soapy.Blog can call from, and how much rate-limit budget is left.</p>
<table>
  <thead><tr><th>Provider</th><th>Configured?</th><th>Remaining / Limit</th><th>Resets</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
</body></html>`;
}

/**
 * HTTP handler (Node http style). Auth-gated via the injected predicate: 401 unless _auth(req) is true.
 *   GET /api-panel  → renders the provider/quota table (HTML).
 *
 * @param {object} req
 * @param {object} res
 * @param {object} [opts]  { env, timeout } passed through to listProviders/quotaAll.
 */
export async function handler(req, res, opts = {}) {
  const sendText = (code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
  try {
    if (!_auth(req)) {
      return sendText(401, 'text/plain; charset=utf-8', 'unauthorized');
    }
    const path = (req.url || '/').split('?')[0];
    const method = (req.method || 'GET').toUpperCase();

    if (method === 'GET' && (path === '/api-panel' || path === '/' || path === '/index.html')) {
      const providers = listProviders(opts);
      const quotas = await quotaAll(opts);
      return sendText(200, 'text/html; charset=utf-8', renderPanel(providers, quotas));
    }
    return sendText(404, 'text/plain; charset=utf-8', 'not found');
  } catch {
    try { return sendText(500, 'text/plain; charset=utf-8', 'panel unavailable'); } catch { /* noop */ }
  }
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────
const isMain = (() => { try { return process.argv[1] === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) {
  if (process.argv.includes('--serve')) {
    // NOTE: default auth denies; a real deployment must __setAuth() before serving.
    http.createServer((req, res) => {
      handler(req, res).catch(() => { try { res.writeHead(500); res.end('panel unavailable'); } catch { /* noop */ } });
    }).listen(PORT, HOST, () => console.log(`soapy-api-panel on http://${HOST}:${PORT}/api-panel (auth-gated; __setAuth required)`));
  } else {
    // Booleans only — never key values.
    console.log(JSON.stringify(listProviders(), null, 2));
  }
}
