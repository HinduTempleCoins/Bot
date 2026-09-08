// indexnow.mjs — tell the non-Google search engines a URL changed, today rather than whenever.
//
// WHY THIS AND NOT "SUBMIT TO GOOGLE". There is no supported programmatic way to ask Google to index an
// arbitrary URL. Google RETIRED the sitemap ping endpoint in 2023 — `/ping?sitemap=` now returns 404 and
// has no effect — and the Indexing API is scoped to JobPosting and BroadcastEvent markup only. Google
// discovers by crawling and by Search Console, and Search Console needs a human to verify the property
// once. Anything claiming otherwise is submitting into a void.
//
// IndexNow is the part that IS automatable, and it is the part that means "worldwide": one POST is
// shared between Microsoft Bing, Yandex, Seznam.cz and Naver. Those are the default engines in, among
// others, Russia, Czechia and South Korea — the markets a Google-only strategy simply does not reach.
// Baidu is NOT in IndexNow and is not reachable this way; it wants its own submission and, in practice,
// an ICP filing for a mainland-hosted site. That is stated here rather than quietly implied.
//
// THE KEY IS THE PROOF OF OWNERSHIP. IndexNow has no accounts. You invent a key and host it as plain
// text at https://<host>/<key>.txt containing exactly the key. The engine fetches that file to confirm
// you control the host before believing anything you submitted. So `keyFile()` is not a helper — it is
// the whole authorization model, and `submit()` refuses to run without a key.
//
// THE RULE THAT BITES. Every URL in one submission must belong to the SAME host as `host`. Mixing hosts
// gets the batch rejected wholesale (HTTP 422), so `partition()` groups by host and `submitAll()` sends
// one request per host. Submitting a URL you do not own is how a key gets distrusted.
//
//   import { keyFile, submit, submitAll, partition, generateKey } from './indexnow.mjs'
//   node integrations/indexnow.mjs --key <key> https://melek.salon/ https://melek.salon/about

import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

let _fetch = (...a) => (globalThis.fetch ? globalThis.fetch(...a) : Promise.reject(new Error('no fetch')));
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

const str = (v) => String(v == null ? '' : v).trim();
const env = (k, d = '') => ((typeof process !== 'undefined' && process.env && process.env[k]) || d);

// Any one of these accepts a submission and shares it with the others. api.indexnow.org is the neutral
// front door and is the right default; the rest are listed because an operator may prefer a direct one.
export const ENDPOINTS = Object.freeze({
  indexnow: 'https://api.indexnow.org/indexnow',
  bing: 'https://www.bing.com/indexnow',
  yandex: 'https://yandex.com/indexnow',
  seznam: 'https://search.seznam.cz/indexnow',
  naver: 'https://searchadvisor.naver.com/indexnow',
});

// Engines that DO share an IndexNow submission, and the ones that do not. Stated so a caller is never
// left believing a POST here reached Google or Baidu.
export const SHARED_WITH = Object.freeze(['Bing', 'Yandex', 'Seznam.cz', 'Naver']);
export const NOT_REACHED = Object.freeze({
  Google: 'does not participate in IndexNow; the sitemap ping endpoint was retired in 2023 and the Indexing API covers only JobPosting/BroadcastEvent. Use Search Console (one-time human verification) and let the sitemap do the rest.',
  Baidu: 'does not participate; submission is via Baidu Ziyuan and in practice needs an ICP filing for mainland hosting.',
});

// The protocol's own ceiling. Over this, the batch is rejected rather than truncated by the engine.
export const MAX_URLS_PER_REQUEST = 10000;

/** A fresh key. Hex, no dashes — the spec allows 8-128 chars of [a-zA-Z0-9-]. */
export const generateKey = () => randomUUID().replace(/-/g, '');

export const isValidKey = (k) => /^[A-Za-z0-9-]{8,128}$/.test(str(k));

/** The file that proves ownership: path + the exact body it must contain. Pure. */
export function keyFile(key) {
  const k = str(key);
  if (!isValidKey(k)) return { ok: false, reason: 'a key must be 8-128 chars of [A-Za-z0-9-]' };
  return { ok: true, path: `/${k}.txt`, body: k, contentType: 'text/plain' };
}

const hostOf = (u) => { try { return new URL(str(u)).host.toLowerCase(); } catch { return ''; } };

/**
 * Serve the ownership file at /<key>.txt. ONE helper every site server calls, rather than a copy of
 * the same six lines in each — the file's whole job is to return the key verbatim, so there is
 * nothing per-site to vary. Returns TRUE if it wrote the response, FALSE if the caller should keep
 * routing (no key configured, or a different path). Never throws.
 *
 * The key comes from the INDEXNOW_KEY env var only. With it unset, this returns false and the host
 * 404s exactly as it does today — a repo that ships a key would be publishing an ownership token
 * for hosts it may not still control.
 *
 *   if (serveKeyFile(req, res)) return;   // first line of the router
 */
export function serveKeyFile(req, res, { key = env('INDEXNOW_KEY', ''), pathname = '' } = {}) {
  try {
    const f = keyFile(key);
    if (!f.ok) return false;
    const p = str(pathname) || new URL(str((req && req.url) || '/') || '/', 'http://localhost').pathname;
    if (p !== f.path) return false;
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' });
    res.end(f.body);
    return true;
  } catch { return false; }
}

/**
 * Group URLs by host and drop what cannot be submitted. Pure.
 * Returns { byHost: Map<host, url[]>, rejected: [{url, why}] }.
 */
export function partition(urls = []) {
  const byHost = new Map(); const rejected = []; const seen = new Set();
  for (const raw of (Array.isArray(urls) ? urls : [])) {
    const u = str(raw);
    if (!u) { rejected.push({ url: u, why: 'empty' }); continue; }
    let parsed;
    try { parsed = new URL(u); } catch { rejected.push({ url: u, why: 'not a URL' }); continue; }
    // http/https only. An engine will not fetch anything else, and a mailto: in a sitemap is a bug
    // upstream that should surface here rather than be silently posted.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') { rejected.push({ url: u, why: `scheme ${parsed.protocol} is not crawlable` }); continue; }
    const norm = parsed.toString();
    if (seen.has(norm)) { rejected.push({ url: u, why: 'duplicate' }); continue; }
    seen.add(norm);
    const h = parsed.host.toLowerCase();
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(norm);
  }
  return { byHost, rejected };
}

/**
 * Submit one host's URLs. Every URL must be on `host` — mismatches are refused here rather than
 * getting the whole batch rejected by the engine.
 * Returns { ok, host, submitted, status, reason?, skipped? }. Never throws.
 */
export async function submit({ host, urls = [], key = env('INDEXNOW_KEY', ''), keyLocation = '', endpoint = ENDPOINTS.indexnow, dryRun = true } = {}) {
  const h = str(host).toLowerCase();
  const k = str(key);
  if (!h) return { ok: false, host: h, submitted: 0, reason: 'host required' };
  if (!isValidKey(k)) return { ok: false, host: h, submitted: 0, reason: 'no valid INDEXNOW_KEY — invent one with generateKey() and host it at /<key>.txt first' };

  const list = (Array.isArray(urls) ? urls : []).map(str).filter(Boolean);
  const mine = []; const foreign = [];
  for (const u of list) (hostOf(u) === h ? mine : foreign).push(u);
  if (!mine.length) return { ok: false, host: h, submitted: 0, reason: 'no URLs on this host', skipped: foreign.length };
  if (mine.length > MAX_URLS_PER_REQUEST) {
    return { ok: false, host: h, submitted: 0, reason: `${mine.length} URLs exceeds the protocol limit of ${MAX_URLS_PER_REQUEST} — split the batch` };
  }

  // Dry run is the default. A submission is a public assertion about a host you claim to own; making
  // that the thing you get by accident is the wrong default.
  if (dryRun) {
    return { ok: true, host: h, submitted: 0, dryRun: true, wouldSubmit: mine.length, skipped: foreign.length, endpoint,
      reason: 'dry run — pass dryRun:false to actually submit' };
  }
  const body = { host: h, key: k, keyLocation: str(keyLocation) || `https://${h}/${k}.txt`, urlList: mine };
  try {
    const r = await _fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    const status = (r && r.status) || 0;
    // 200 accepted; 202 accepted-but-key-not-yet-validated (normal on a first run).
    if (status === 200 || status === 202) {
      return { ok: true, host: h, submitted: mine.length, status, skipped: foreign.length,
        reason: status === 202 ? 'accepted — key not validated yet; the engine will fetch /<key>.txt' : '' };
    }
    const why = {
      400: 'bad request — malformed JSON or URL list',
      403: `key rejected — https://${h}/${k}.txt must return exactly the key`,
      422: 'URLs do not belong to this host, or the key does not match the host',
      429: 'rate limited — too many submissions',
    }[status] || `HTTP ${status}`;
    return { ok: false, host: h, submitted: 0, status, reason: why, skipped: foreign.length };
  } catch (e) {
    return { ok: false, host: h, submitted: 0, status: 0, reason: str((e && e.message) || 'submit failed') };
  }
}

/** Submit a mixed list of URLs: one request per host, because the protocol requires it. */
export async function submitAll(urls = [], opts = {}) {
  const { byHost, rejected } = partition(urls);
  const results = [];
  for (const [host, list] of byHost) {
    // Chunk at the protocol ceiling rather than failing a large sitemap.
    for (let i = 0; i < list.length; i += MAX_URLS_PER_REQUEST) {
      results.push(await submit({ ...opts, host, urls: list.slice(i, i + MAX_URLS_PER_REQUEST) }));
    }
  }
  return {
    results, rejected,
    hosts: byHost.size,
    submitted: results.reduce((n, r) => n + (r.submitted || 0), 0),
    failed: results.filter((r) => !r.ok).length,
    sharedWith: SHARED_WITH, notReached: NOT_REACHED,
  };
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'indexnow',
    sharedWith: SHARED_WITH, notReached: NOT_REACHED,
    maxUrlsPerRequest: MAX_URLS_PER_REQUEST,
    note: 'ownership is proved by hosting /<key>.txt containing exactly the key. Dry run is the default.',
  }, null, 2));
}

export default { ENDPOINTS, SHARED_WITH, NOT_REACHED, MAX_URLS_PER_REQUEST, generateKey, isValidKey, keyFile, serveKeyFile, partition, submit, submitAll, handler, __setFetch };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const ki = args.indexOf('--key');
  const key = ki >= 0 ? args[ki + 1] : env('INDEXNOW_KEY', '');
  const live = args.includes('--submit');
  const urls = args.filter((a, i) => a.startsWith('http') && i !== ki + 1);
  if (!urls.length) { console.error('usage: node integrations/indexnow.mjs [--key K] [--submit] <url>...'); process.exit(1); }
  const out = await submitAll(urls, { key, dryRun: !live });
  console.log(JSON.stringify(out, null, 2));
}
