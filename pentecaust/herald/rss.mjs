// pentecaust/herald/rss.mjs — RSS/Atom as a Herald trigger source.
//
// The single most-used IFTTT trigger of all is "new item in feed", and this repo had OPML parsing
// (integrations/opml-parser.mjs, orphaned) and a trigger engine (ifttt-triggers.mjs) with nothing
// between them. This is the bridge.
//
// ⭐ DESIGN NOTE — why RSS does NOT get its own when-type.
// The trigger grammar is a closed set: tag | velocity | campaign. Adding `rss` would mean touching
// validateRecipe, matchRecipe, the dedupe key and the UI, and would fork the matching logic forever.
// A feed item already HAS categories, so an item becomes ordinary `tag` events and every existing
// recipe, dedupe window and action path works on it unchanged. The bridge is a translation, not a
// new dialect.
//
// ⚠️ A feed URL is user input and gets fetched by the server, so it goes through the same SSRF guard
// the webhook action uses — no localhost, RFC1918, CGNAT, link-local, .internal/.local, or cloud
// metadata endpoints, and no credentials in the URL.
//
// House style: ESM, injectable fetch, soft-fail-never-throw, handler(req,res), CLI guarded.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isSafeWebhookTarget } from './ifttt-executor.mjs';
import { parseOpml } from '../../integrations/opml-parser.mjs';

const env = (k, d = '') => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const DATA_FILE = () => env('HERALD_RSS_DATA', join(process.cwd(), 'data', 'herald-rss.json'));
const MAX_ITEMS_PER_POLL = () => Math.max(1, Number(env('HERALD_RSS_MAX_ITEMS', '25')) || 25);
const MAX_BYTES = () => Math.max(1024, Number(env('HERALD_RSS_MAX_BYTES', '2000000')) || 2000000);

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} writeFileSync(p, s); },
};
const ctx = (o = {}) => ({ fs: o.fs || realFs, file: o.file || DATA_FILE() });
function loadStore(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { feeds: {}, seen: {} };
  try { const o = JSON.parse(raw); return { feeds: o.feeds || {}, seen: o.seen || {} }; } catch { return { feeds: {}, seen: {} }; }
}
const saveStore = (fs, file, s) => (fs.write || realFs.write)(file, JSON.stringify(s));

const decode = (s) => String(s == null ? '' : s)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#0?39;|&apos;/g, "'").replace(/&#x27;/gi, "'")
  .replace(/&amp;/g, '&').trim();

const strip = (s) => decode(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const tagOf = (s) => String(s || '').toLowerCase().replace(/^#/, '').replace(/[^a-z0-9-]/g, '').trim();

function firstMatch(block, ...res) {
  for (const re of res) { const m = block.match(re); if (m) return m[1]; }
  return '';
}

/**
 * parseFeed — RSS 2.0 <item> and Atom <entry>, tolerant of malformed XML by design: a feed you do not
 * control is not guaranteed to be well-formed, and refusing to read a slightly-broken feed is worse
 * than reading it carefully. Returns { title, items[] }; never throws.
 */
export function parseFeed(xml) {
  const out = { title: '', items: [] };
  if (typeof xml !== 'string' || !xml.trim()) return out;
  const head = xml.slice(0, 4000);
  out.title = strip(firstMatch(head, /<title[^>]*>([\s\S]*?)<\/title>/i));

  const blocks = [];
  const itemRe = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let m; let guard = 0;
  while ((m = itemRe.exec(xml)) !== null) { if (++guard > 5000) break; blocks.push(m[2]); }

  for (const b of blocks) {
    const title = strip(firstMatch(b, /<title[^>]*>([\s\S]*?)<\/title>/i));
    let link = decode(firstMatch(b, /<link[^>]*>([\s\S]*?)<\/link>/i));
    if (!link) { const href = b.match(/<link\b[^>]*href=["']([^"']+)["']/i); if (href) link = decode(href[1]); }
    const id = decode(firstMatch(b, /<guid[^>]*>([\s\S]*?)<\/guid>/i, /<id[^>]*>([\s\S]*?)<\/id>/i)) || link || title;
    const published = decode(firstMatch(b, /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i, /<updated[^>]*>([\s\S]*?)<\/updated>/i, /<published[^>]*>([\s\S]*?)<\/published>/i));
    const author = strip(firstMatch(b, /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i, /<author[^>]*>([\s\S]*?)<\/author>/i)).replace(/^@/, '');
    const summary = strip(firstMatch(b, /<description[^>]*>([\s\S]*?)<\/description>/i, /<summary[^>]*>([\s\S]*?)<\/summary>/i)).slice(0, 500);

    const tags = [];
    const catRe = /<category\b([^>]*)>([\s\S]*?)<\/category>|<category\b([^>]*)\/>/gi;
    let c; let g2 = 0;
    while ((c = catRe.exec(b)) !== null) {
      if (++g2 > 200) break;
      const attrs = c[1] || c[3] || '';
      const termAttr = attrs.match(/term=["']([^"']+)["']/i);
      const t = tagOf(termAttr ? termAttr[1] : strip(c[2] || ''));
      if (t && !tags.includes(t)) tags.push(t);
    }
    if (!id && !title) continue;
    out.items.push({ id, title, link, published, author, summary, tags });
  }
  return out;
}

/** One feed item → the ordinary `tag` events the trigger engine already understands. */
export function itemToEvents(item, feedUrl = '') {
  const it = item && typeof item === 'object' ? item : {};
  const tags = Array.isArray(it.tags) ? it.tags.filter(Boolean) : [];
  const base = { type: 'tag', author: it.author || '', title: it.title || '', link: it.link || '', feed: feedUrl, source: 'rss' };
  if (!tags.length) return [{ ...base, tag: '', tags: [] }];
  return tags.map((t) => ({ ...base, tag: t, tags }));
}

/** The feed list. OPML in, feed URLs out — every one SSRF-checked before it is stored. */
export function addFeeds(urls = [], opts = {}) {
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const added = []; const rejected = [];
  for (const raw of Array.isArray(urls) ? urls : [urls]) {
    const u = String(raw || '').trim();
    if (!u) continue;
    const safe = isSafeWebhookTarget(u);
    if (!safe.ok) { rejected.push({ url: u, reason: safe.reason }); continue; }
    if (!store.feeds[u]) { store.feeds[u] = { addedAt: Date.now(), lastPolledAt: 0, title: '' }; added.push(u); }
  }
  saveStore(fs, file, store);
  return { ok: true, added, rejected, total: Object.keys(store.feeds).length };
}

export function importOpml(xml, opts = {}) {
  const doc = parseOpml(String(xml || ''));
  const urls = (doc.feeds || []).map((f) => f && f.xmlUrl).filter(Boolean);
  const r = addFeeds(urls, opts);
  return { ...r, title: doc.title || '', found: urls.length };
}

export const listFeeds = (opts = {}) => {
  const { fs, file } = ctx(opts);
  const s = loadStore(fs, file);
  return Object.entries(s.feeds).map(([url, v]) => ({ url, ...v, seen: (s.seen[url] || []).length }));
};

export function removeFeed(url, opts = {}) {
  const { fs, file } = ctx(opts);
  const s = loadStore(fs, file);
  const u = String(url || '').trim();
  const had = !!s.feeds[u];
  delete s.feeds[u]; delete s.seen[u];
  saveStore(fs, file, s);
  return { ok: had, removed: had ? u : null };
}

/**
 * pollFeed — fetch one feed and return ONLY items not seen before.
 * ⚠️ The first poll of a feed marks everything seen and fires NOTHING. Adding a feed with 200 items
 * must not fan 200 triggers out into someone's inbox; you subscribe to what happens next.
 */
export async function pollFeed(url, opts = {}) {
  const u = String(url || '').trim();
  const safe = isSafeWebhookTarget(u);
  if (!safe.ok) return { ok: false, url: u, reason: safe.reason, items: [] };

  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const known = new Set(store.seen[u] || []);
  const firstRun = !store.seen[u];

  let xml = '';
  try {
    const r = await (opts.fetch || _fetch)(u, { headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }, redirect: 'follow' });
    if (!r || (Number(r.status) || 0) >= 400) return { ok: false, url: u, reason: `feed http ${(r && r.status) || 0}`, items: [] };
    xml = await r.text();
    if (typeof xml === 'string' && xml.length > MAX_BYTES()) xml = xml.slice(0, MAX_BYTES());
  } catch { return { ok: false, url: u, reason: 'feed unreachable', items: [] }; }

  const feed = parseFeed(xml);
  const fresh = [];
  for (const it of feed.items) {
    if (!it.id || known.has(it.id)) continue;
    known.add(it.id);
    if (!firstRun) fresh.push(it);
    if (fresh.length >= MAX_ITEMS_PER_POLL()) break;
  }
  store.feeds[u] = { ...(store.feeds[u] || { addedAt: Date.now() }), lastPolledAt: Date.now(), title: feed.title || '' };
  store.seen[u] = [...known].slice(-500);
  saveStore(fs, file, store);

  return { ok: true, url: u, title: feed.title, firstRun, seeded: firstRun ? feed.items.length : 0, items: fresh };
}

/** pollAll — every stored feed, then flatten to events ready for the trigger engine. */
export async function pollAll(opts = {}) {
  const feeds = listFeeds(opts).map((f) => f.url);
  const results = []; const events = [];
  for (const u of feeds) {
    const r = await pollFeed(u, opts);
    results.push({ url: u, ok: r.ok, firstRun: !!r.firstRun, seeded: r.seeded || 0, newItems: r.items.length, reason: r.reason });
    for (const it of r.items) events.push(...itemToEvents(it, u));
  }
  return { ok: true, feeds: feeds.length, results, events };
}

const sendJson = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
function readBody(req, max = 1048576) {
  if (req && req.body !== undefined) return Promise.resolve(req.body);
  return new Promise((resolve) => {
    try {
      let d = ''; let over = false;
      req.on('data', (c) => { d += c; if (d.length > max) { over = true; try { req.destroy(); } catch {} } });
      req.on('end', () => { if (over) return resolve(null); resolve(d); });
      req.on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

/**
 * handler — GET /api/rss/feeds · POST /api/rss/feeds · POST /api/rss/opml · POST /api/rss/poll
 * `fire` is injected (the ifttt evaluate path), so this module triggers nothing by itself.
 */
export async function handler(req, res, opts = {}) {
  try {
    const method = ((req && req.method) || 'GET').toUpperCase();
    const path = (String((req && req.url) || '/').split('?')[0] || '/').replace(/\/+$/, '') || '/';

    if (method === 'GET' && path === '/api/rss/feeds') return sendJson(res, 200, { ok: true, feeds: listFeeds(opts) });

    if (method === 'POST' && path === '/api/rss/feeds') {
      const raw = await readBody(req);
      let b = raw; if (typeof raw === 'string') { try { b = JSON.parse(raw || '{}'); } catch { b = null; } }
      if (!b || typeof b !== 'object') return sendJson(res, 400, { ok: false, reason: 'bad-body' });
      if (b.remove) return sendJson(res, 200, removeFeed(b.remove, opts));
      return sendJson(res, 200, addFeeds(b.urls || b.url || [], opts));
    }

    if (method === 'POST' && path === '/api/rss/opml') {
      const raw = await readBody(req);
      const xml = typeof raw === 'string' ? raw : (raw && raw.opml) || '';
      if (!xml) return sendJson(res, 400, { ok: false, reason: 'no opml' });
      return sendJson(res, 200, importOpml(xml, opts));
    }

    if (method === 'POST' && path === '/api/rss/poll') {
      const out = await pollAll(opts);
      if (typeof opts.fire === 'function') {
        let fired = 0;
        for (const ev of out.events) { try { const n = await opts.fire(ev); fired += Number(n) || 0; } catch {} }
        return sendJson(res, 200, { ...out, fired });
      }
      return sendJson(res, 200, { ...out, fired: null, note: 'no trigger sink wired — events returned only' });
    }

    return sendJson(res, 404, { ok: false, reason: 'not-found' });
  } catch { return sendJson(res, 500, { ok: false, reason: 'error' }); }
}

export default { parseFeed, itemToEvents, addFeeds, importOpml, listFeeds, removeFeed, pollFeed, pollAll, handler, __setFetch, DATA_FILE };
