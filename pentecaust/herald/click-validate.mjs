// pentecaust/herald/click-validate.mjs — the Herald ad-network BILLABLE-CLICK / fraud-dedup pass.
//
// The shipped click rail (./qr-tracker.mjs) appends EVERY hit to the scan log — it captures the coarse
// signals a dedup needs ({ ts, code, ua, ref } — referer HOST only, no IP, no full URL, no PII) but does
// NOT dedupe. HERALD_AD_NETWORK_DESIGN.md §(d)3 flags this as the current gap: the raw-click roster and
// the billable-click count are two DIFFERENT numbers (the same "verified-only counting" discipline as
// lead-crm.mjs). This module is that missing pass — PURE functions over the existing coarse log:
//
//   1. Window dedup   — same code + ua + refHost inside a window (default 24h) counts ONCE for billing.
//   2. Crawler filter — known bot / preview / empty user-agents are excluded from billable.
//   3. Origin allow-list — a publisher is paid only for clicks whose refHost is one of THEIR registered
//                          origins (the same per-tenant origin list the embed uses). Off-origin → logs, no pay.
//   4. Rate caps      — per-code / per-refHost / per-publisher billable ceilings; overflow is QUARANTINED,
//                       not billed (never dropped from the raw log — quarantine ≠ delete).
//   5. Sybil gate     — payoutEligible() reuses token-programs.sybilGate (provider-agnostic Karma / World ID
//                       / BrightID) to gate whether an influencer's EARNINGS clear to payout. Fail-closed.
//
// House style: ESM, esc() all interpolation, soft-fail-never-throw (shaped returns), injectable everything,
// offline (no network, no bare Date.now in asserted logic — click rows carry their own ts).
//
//   import { classifyClicks, isCrawler, dedupBucketKey, payoutEligible, handler } from './click-validate.mjs'
//   const r = classifyClicks(rawScanRows, { windowMs, originsOf, rateCaps, publisherOf });
//   r.billable  r.dropped{crawler,offOrigin,duplicate,rateCapped}  r.byCode  r.byPublisher  r.billableRows

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { sybilGate } from './token-programs.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DAY_MS = 24 * 60 * 60 * 1000;
const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const clean = (s) => String(s == null ? '' : s).trim();

// ── crawler / bot / preview UA filter (step 2) ───────────────────────────────────────────────────────────
// Known non-human user-agents: search/AI crawlers, link-preview fetchers, scripting clients, headless
// browsers. An EMPTY ua is treated as a bot too — fail-closed for money. Deterministic; no network.
const DEFAULT_BOT_RE = new RegExp([
  'bot', 'crawl', 'spider', 'slurp', 'mediapartners', 'feedfetcher',
  'facebookexternalhit', 'whatsapp', 'telegram', 'twitterbot', 'discord', 'slackbot',
  'embedly', 'redditbot', 'linkedinbot', 'pinterest', 'quora link preview', 'skypeuripreview',
  'curl', 'wget', 'libwww', 'python-requests', 'python-urllib', 'go-http-client', 'java/', 'okhttp',
  'headless', 'phantomjs', 'puppeteer', 'playwright', 'selenium',
  'preview', 'scan', 'monitor', 'uptime', 'pingdom', 'apache-httpclient',
  'gptbot', 'ccbot', 'claudebot', 'anthropic', 'perplexity', 'bytespider', 'petalbot', 'dataforseo',
  'ahrefs', 'semrush', 'mj12bot', 'dotbot', 'yandex', 'baiduspider', 'applebot', 'googlebot', 'bingbot',
].join('|'), 'i');

// isCrawler(ua, extraRe?) — true when the UA looks non-human (or is empty). extraRe (a RegExp) is OR'd in
// so a caller can add its own known bots without editing this file.
export function isCrawler(ua, extraRe) {
  const s = clean(ua);
  if (!s) return true; // empty UA — fail-closed
  if (DEFAULT_BOT_RE.test(s)) return true;
  if (extraRe instanceof RegExp) { try { return extraRe.test(s); } catch { /* soft */ } }
  return false;
}

// Coarse host normalizer — lowercase, strip a leading scheme / www., drop any path/port so a refHost and a
// configured allow-list entry compare cleanly. Never throws.
export function normHost(h) {
  let s = clean(h).toLowerCase();
  if (!s) return '';
  s = s.replace(/^https?:\/\//, '').split('/')[0].split('?')[0];
  s = s.replace(/:\d+$/, '').replace(/^www\./, '');
  return s.slice(0, 160);
}

// A scan row's referer host lives under `refHost` (extended record) or `ref` (the shipped qr-tracker log).
const rowRefHost = (row) => normHost(row && (row.refHost != null ? row.refHost : row.ref));
const rowUa = (row) => clean(row && row.ua);
const rowCode = (row) => clean(row && row.code).toLowerCase();

// dedupBucketKey — the window-dedup identity (step 1). Same code + ua + refHost falling in the same
// windowMs-wide time bucket is ONE billable click. Bucketing (vs a rolling window) is deterministic and
// order-independent, so the same log always yields the same billable count.
export function dedupBucketKey(row, windowMs = DAY_MS) {
  const w = toNum(windowMs) > 0 ? toNum(windowMs) : DAY_MS;
  const bucket = Math.floor(toNum(row && row.ts) / w);
  return `${rowCode(row)}|${rowUa(row)}|${rowRefHost(row)}|${bucket}`;
}

// Resolve the publisher id for a row — an extended record carries `publisherId`; otherwise the code is the
// publisher key (a publisherOf override lets a caller map code → publisher via its placement registry).
function resolvePublisher(row, publisherOf) {
  if (typeof publisherOf === 'function') { try { return clean(publisherOf(row)); } catch { /* soft */ } }
  return clean((row && (row.publisherId != null ? row.publisherId : row.code)));
}

// Resolve a publisher's allowed origins (step 3). `originsOf` may be a function (publisherId → [hosts]) or
// a plain map ({ publisherId: [hosts] }). Returns a normalized host array, or NULL meaning "no allow-list
// configured for this publisher" → origin is NOT enforced (can't fail-closed on an unconfigured publisher
// without breaking every click; the list is enforced only once a publisher actually declares one).
function resolveOrigins(originsOf, publisherId) {
  let list = null;
  if (typeof originsOf === 'function') { try { list = originsOf(publisherId); } catch { list = null; } }
  else if (originsOf && typeof originsOf === 'object') list = originsOf[publisherId];
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.map(normHost).filter(Boolean);
}

/**
 * classifyClicks — turn a raw coarse-click log into a BILLABLE count + a full audit of what was dropped and
 * why. PURE and soft-fail: a malformed input yields a shaped empty result, never a throw.
 *
 * @param {Array} rawClicks  scan rows { ts, code, ua, ref|refHost, publisherId? } (the qr-tracker log shape).
 * @param {object} opts
 *   windowMs    dedup window in ms (default 24h).
 *   extraBotRe  extra RegExp OR'd into the crawler filter.
 *   publisherOf (row) → publisherId  (default: row.publisherId ?? row.code).
 *   originsOf   fn(publisherId)→[hosts] or map { publisherId:[hosts] }. Enforced only where a list exists.
 *   rateCaps    { perCode?, perRefHost?, perPublisher? } billable ceilings; overflow → rateCapped (quarantined).
 * @returns {{ ok, raw, billable, billableRows, dropped, byCode, byPublisher }}
 */
export function classifyClicks(rawClicks, opts = {}) {
  const rows = Array.isArray(rawClicks) ? rawClicks : [];
  const windowMs = toNum(opts.windowMs) > 0 ? toNum(opts.windowMs) : DAY_MS;
  const extraBotRe = opts.extraBotRe instanceof RegExp ? opts.extraBotRe : null;
  const caps = (opts.rateCaps && typeof opts.rateCaps === 'object') ? opts.rateCaps : {};
  const capCode = toNum(caps.perCode) > 0 ? toNum(caps.perCode) : Infinity;
  const capRef = toNum(caps.perRefHost) > 0 ? toNum(caps.perRefHost) : Infinity;
  const capPub = toNum(caps.perPublisher) > 0 ? toNum(caps.perPublisher) : Infinity;

  const dropped = { crawler: 0, offOrigin: 0, duplicate: 0, rateCapped: 0 };
  const byCode = {};
  const byPublisher = {};
  const billableRows = [];
  const seenBuckets = new Set();
  const nCode = {};   // running billable counts (for caps)
  const nRef = {};
  const nPub = {};

  // Deterministic order: ascending ts, then original index — keeps dedup + cap decisions reproducible.
  const ordered = rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => (toNum(a.row && a.row.ts) - toNum(b.row && b.row.ts)) || (a.i - b.i));

  for (const { row } of ordered) {
    if (!row || typeof row !== 'object') continue;
    const code = rowCode(row);
    const refHost = rowRefHost(row);
    const publisherId = resolvePublisher(row, opts.publisherOf);

    // 2. crawler filter (cheapest, clearly non-human) ────────────────────────────────────────────────────
    if (isCrawler(rowUa(row), extraBotRe)) { dropped.crawler += 1; continue; }

    // 3. per-publisher origin allow-list — off-origin logs but does not pay ────────────────────────────────
    const origins = resolveOrigins(opts.originsOf, publisherId);
    if (origins && !origins.includes(refHost)) { dropped.offOrigin += 1; continue; }

    // 1. window dedup — one billable per (code, ua, refHost) per window bucket ─────────────────────────────
    const key = dedupBucketKey(row, windowMs);
    if (seenBuckets.has(key)) { dropped.duplicate += 1; continue; }

    // 4. rate caps — overflow is QUARANTINED (not billed), the raw row is never deleted ────────────────────
    if ((nCode[code] || 0) >= capCode || (nRef[refHost] || 0) >= capRef || (nPub[publisherId] || 0) >= capPub) {
      dropped.rateCapped += 1;
      continue;
    }

    // billable ✓
    seenBuckets.add(key);
    nCode[code] = (nCode[code] || 0) + 1;
    nRef[refHost] = (nRef[refHost] || 0) + 1;
    nPub[publisherId] = (nPub[publisherId] || 0) + 1;
    byCode[code] = (byCode[code] || 0) + 1;
    byPublisher[publisherId] = (byPublisher[publisherId] || 0) + 1;
    billableRows.push({ ts: toNum(row.ts), code, ua: rowUa(row), refHost, publisherId });
  }

  return {
    ok: true,
    raw: rows.length,
    billable: billableRows.length,
    billableRows,
    dropped,
    byCode,
    byPublisher,
  };
}

/**
 * payoutEligible — step 5, the sybil gate on PAYOUT eligibility. Thin, honest reuse of the shipped
 * token-programs.sybilGate (provider-agnostic: Karma / World ID / BrightID). Given an earnings snapshot
 * ([{ account, balance }] or a weight map) and { scoreOf, minScore }, returns only the accounts that clear
 * the humanity/uniqueness threshold. Fail-closed: an account with no score scores 0. Never throws.
 */
export function payoutEligible(snapshot = [], { scoreOf, minScore = 1 } = {}) {
  try { return sybilGate(snapshot, { scoreOf, minScore }); } catch { return []; }
}

// ── optional HTTP surface ─────────────────────────────────────────────────────────────────────────────
const sendJson = (res, code, obj) => {
  try { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); } catch {}
  try { res.end(JSON.stringify(obj)); } catch {}
};

function readJsonBody(req, max = 262144) {
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

// POST /api/click-validate { clicks:[...], windowMs?, rateCaps?, originsMap? } → classification JSON.
// Only JSON-serializable opts are honored over HTTP (functions can't cross the wire); originsMap is the
// plain-object form of the origin allow-list. GET /health → { ok }.
export async function handler(req, res, opts = {}) {
  try {
    const method = ((req && req.method) || 'GET').toUpperCase();
    const raw = String((req && req.url) || '/');
    const path = (raw.split('?')[0] || '/').replace(/\/+$/, '') || '/';

    if (path === '/health' && method === 'GET') return sendJson(res, 200, { ok: true, service: 'herald-click-validate' });
    if (path === '/api/click-validate' && method === 'POST') {
      const body = await readJsonBody(req);
      if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, reason: 'bad-body' });
      const result = classifyClicks(body.clicks, {
        windowMs: body.windowMs,
        rateCaps: body.rateCaps,
        originsOf: body.originsMap && typeof body.originsMap === 'object' ? body.originsMap : opts.originsOf,
      });
      return sendJson(res, 200, result);
    }
    return sendJson(res, 404, { ok: false, reason: 'not-found' });
  } catch {
    return sendJson(res, 500, { ok: false, reason: 'error' });
  }
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const PORT = +(env('PORT', '8164'));
  const HOST = env('HOST', '127.0.0.1');
  createServer((req, res) => handler(req, res)).listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`herald click-validate on http://${HOST}:${PORT}`);
  });
}
