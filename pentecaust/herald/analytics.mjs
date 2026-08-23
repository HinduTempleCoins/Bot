// pentecaust/herald/analytics.mjs — Herald analytics adapter (self-hosted, Umami-shaped).
//
// A thin, self-hosted analytics layer modeled on Umami (MIT) so Herald campaigns can track
// events / traffic / conversions without a heavy dependency. Everything is in-process: an
// injectable in-memory `storage` holds event rows, an injectable clock `now` stamps them, and
// an injectable `fetch` is the ONLY network seam (used solely by the optional pushUmami mirror).
// Same edge discipline as the rest of herald: soft-fail-never-throw (shaped returns), no bare
// Date.now / Math.random in asserted logic, esc() all HTML interpolation.
//
//   import { createAnalytics, __setFetch } from './analytics.mjs'
//   const a = createAnalytics({ storage, now, fetch });
//   a.track({ event, campaign, source, meta });
//   a.pageview({ path, campaign, source, ref });
//   a.conversion({ campaign, value, source });
//   a.summary({ campaign, sinceMs });   a.funnel(campaign, steps);   a.topSources(campaign, n);
//   await a.pushUmami(payload);          // optional Umami-compatible mirror (soft-fail)
//
//   Optional HTTP:  POST /api/track   GET /api/summary?campaign=   GET /health
//
//   PORT=8162 HERALD_ANALYTICS_UMAMI_URL=https://umami.example/api/send node pentecaust/herald/analytics.mjs

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
const UMAMI_URL = () => env('HERALD_ANALYTICS_UMAMI_URL', '');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (s, n) => String(s == null ? '' : s).slice(0, n);
const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const MAX_EVENTS = Number(env('HERALD_ANALYTICS_MAX', '200000')) || 200000;
const MAX_FIELD = 200;
const MAX_META = 4000;

// ── injectable network seam (module-level default; a per-instance fetch overrides it) ────────────────────
let _fetch = (typeof fetch === 'function' ? fetch : null);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : null; }

// A storage is any object carrying an `events` array. Passing one in makes the store durable to the caller;
// omitting it gives a fresh in-memory store. Never throws — a malformed storage is coerced into shape.
function normStorage(storage) {
  const s = storage && typeof storage === 'object' ? storage : {};
  if (!Array.isArray(s.events)) s.events = [];
  return s;
}

// Clean a meta object to a small, JSON-safe bag (never throws; caps size).
function cleanMeta(meta) {
  if (meta == null) return {};
  try {
    const json = JSON.stringify(meta);
    if (!json || json.length > MAX_META) return {};
    const o = JSON.parse(json);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}

export function createAnalytics(opts = {}) {
  const storage = normStorage(opts.storage);
  const clock = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const instFetch = typeof opts.fetch === 'function' ? opts.fetch : null;
  const umamiUrl = opts.umamiUrl != null ? String(opts.umamiUrl) : UMAMI_URL();

  const ts = () => { try { return toNum(clock()); } catch { return 0; } };

  // ── record one event row ──────────────────────────────────────────────────────────────────────────────
  function track(input = {}) {
    const event = clamp(input.event, MAX_FIELD).trim();
    if (!event) return { ok: false, reason: 'event required' };
    if (storage.events.length >= MAX_EVENTS) return { ok: false, reason: 'event cap reached' };
    const row = {
      ts: ts(),
      event,
      campaign: clamp(input.campaign, MAX_FIELD),
      source: clamp(input.source, MAX_FIELD),
      value: toNum(input.value),
      meta: cleanMeta(input.meta),
    };
    storage.events.push(row);
    return { ok: true, row };
  }

  // ── convenience wrappers ──────────────────────────────────────────────────────────────────────────────
  function pageview(input = {}) {
    return track({
      event: 'pageview',
      campaign: input.campaign,
      source: input.source,
      meta: { path: clamp(input.path, MAX_FIELD), ref: clamp(input.ref, MAX_FIELD) },
    });
  }

  function conversion(input = {}) {
    return track({
      event: 'conversion',
      campaign: input.campaign,
      source: input.source,
      value: toNum(input.value),
      meta: cleanMeta(input.meta),
    });
  }

  // ── selection helper: filter rows by campaign (optional) and a since-timestamp (optional) ───────────────
  function select({ campaign, sinceMs } = {}) {
    const camp = campaign != null ? clamp(campaign, MAX_FIELD) : null;
    const since = sinceMs != null ? toNum(sinceMs) : null;
    return storage.events.filter((r) => {
      if (camp != null && r.campaign !== camp) return false;
      if (since != null && !(r.ts >= since)) return false;
      return true;
    });
  }

  // ── aggregations ──────────────────────────────────────────────────────────────────────────────────────
  function summary(sel = {}) {
    const rows = select(sel);
    const byEvent = {};
    const byCampaign = {};
    const bySource = {};
    let conversions = 0;
    let conversionValue = 0;
    for (const r of rows) {
      byEvent[r.event] = (byEvent[r.event] || 0) + 1;
      const c = r.campaign || '(none)';
      byCampaign[c] = (byCampaign[c] || 0) + 1;
      const s = r.source || '(direct)';
      bySource[s] = (bySource[s] || 0) + 1;
      if (r.event === 'conversion') { conversions += 1; conversionValue += toNum(r.value); }
    }
    return { events: rows.length, byEvent, byCampaign, bySource, conversions, conversionValue };
  }

  // Ordered funnel: for each named step, how many events of that name fired for the campaign.
  function funnel(campaign, steps) {
    const list = Array.isArray(steps) ? steps : [];
    const rows = select({ campaign });
    return list.map((step) => {
      const name = clamp(step, MAX_FIELD).trim();
      return { step: name, count: rows.filter((r) => r.event === name).length };
    });
  }

  function topSources(campaign, n) {
    const rows = select({ campaign });
    const counts = {};
    for (const r of rows) {
      const s = r.source || '(direct)';
      counts[s] = (counts[s] || 0) + 1;
    }
    const limit = Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : Infinity;
    return Object.entries(counts)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count || (a.source < b.source ? -1 : 1))
      .slice(0, limit === Infinity ? undefined : limit);
  }

  // ── optional Umami mirror (the "wrap Umami" seam) — POST via injected fetch, soft-fail ──────────────────
  async function pushUmami(payload) {
    const url = umamiUrl;
    if (!url) return { ok: false, reason: 'no umami endpoint configured' };
    const fn = instFetch || _fetch;
    if (typeof fn !== 'function') return { ok: false, reason: 'no fetch available' };
    try {
      const res = await fn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'event', payload: payload == null ? {} : payload }),
      });
      const ok = !!(res && (res.ok || (res.status >= 200 && res.status < 300)));
      return ok ? { ok: true, status: (res && res.status) || 200 } : { ok: false, reason: 'bad response', status: (res && res.status) || 0 };
    } catch (e) {
      return { ok: false, reason: 'fetch failed' };
    }
  }

  return { track, pageview, conversion, summary, funnel, topSources, pushUmami, select, storage };
}

// ── optional HTTP surface ─────────────────────────────────────────────────────────────────────────────
const sendJson = (res, code, obj) => {
  try { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); } catch {}
  try { res.end(JSON.stringify(obj)); } catch {}
};

// Body reader: accept an already-parsed req.body (tests), else read + JSON.parse the stream. Never throws.
function readJsonBody(req, max = 65536) {
  if (req && req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let d = ''; let over = false;
    try {
      req.on('data', (c) => { d += c; if (d.length > max) { over = true; try { req.destroy(); } catch {} } });
      req.on('end', () => { if (over) return resolve(null); try { resolve(d ? JSON.parse(d) : {}); } catch { resolve(null); } });
      req.on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

// A shared analytics instance for the CLI/HTTP surface (tests call handler with their own via opts.analytics).
let _shared = null;
function shared() { if (!_shared) _shared = createAnalytics(); return _shared; }

export async function handler(req, res, opts = {}) {
  try {
    const a = opts.analytics || shared();
    const method = ((req && req.method) || 'GET').toUpperCase();
    const rawUrl = String((req && req.url) || '/');
    const qi = rawUrl.indexOf('?');
    const path = (qi >= 0 ? rawUrl.slice(0, qi) : rawUrl).replace(/\/+$/, '') || '/';
    const query = new URLSearchParams(qi >= 0 ? rawUrl.slice(qi + 1) : '');

    if (path === '/health' && method === 'GET') {
      return sendJson(res, 200, { ok: true, events: a.storage.events.length });
    }
    if (path === '/api/track' && method === 'POST') {
      const body = await readJsonBody(req);
      if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, reason: 'bad-body' });
      const r = a.track(body);
      return sendJson(res, r.ok ? 200 : 400, r);
    }
    if (path === '/api/summary' && method === 'GET') {
      const campaign = query.get('campaign');
      const sinceMs = query.get('sinceMs');
      const r = a.summary({
        campaign: campaign != null ? campaign : undefined,
        sinceMs: sinceMs != null ? sinceMs : undefined,
      });
      return sendJson(res, 200, { ok: true, summary: r });
    }
    return sendJson(res, 404, { ok: false, reason: 'not-found' });
  } catch {
    return sendJson(res, 500, { ok: false, reason: 'error' });
  }
}

// esc is part of the house-style toolkit even where this surface is JSON-only; export for reuse/tests.
export { esc };

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const PORT = +(env('PORT', '8162'));
  const HOST = env('HOST', '127.0.0.1');
  createServer((req, res) => handler(req, res)).listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`herald analytics on http://${HOST}:${PORT}  (umami=${UMAMI_URL() || 'off'})`);
  });
}
