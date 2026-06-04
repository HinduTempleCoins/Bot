// crawlers.mjs — get indexed everywhere. A comprehensive robots.txt that explicitly welcomes every
// major search + AI crawler, plus IndexNow (instant submission to Bing/Yandex/Seznam) and sitemap
// pings. The sites are read-only public data — we WANT maximal crawling.
//
// Tasks #112 (robots.txt), #113 (IndexNow), #114 (sitemap ping).

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// every crawler we explicitly welcome. `*` already allows all; listing them is an explicit invite
// and lets us welcome AI crawlers by name (some operators block these — we don't).
export const CRAWLERS = [
  // search engines
  'Googlebot', 'Bingbot', 'Slurp', 'DuckDuckBot', 'YandexBot', 'Baiduspider', 'Applebot',
  'SeznamBot', 'Sogou', 'Exabot', 'facebookexternalhit', 'Twitterbot', 'LinkedInBot', 'Pinterestbot',
  // AI / LLM crawlers (welcomed — our content wants to be in the models)
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'anthropic-ai', 'Claude-Web',
  'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'CCBot', 'Amazonbot', 'Applebot-Extended',
  'Bytespider', 'Meta-ExternalAgent', 'cohere-ai', 'Diffbot', 'Timpibot', 'Omgilibot',
];

/**
 * A welcoming robots.txt: an explicit `Allow: /` block for every named crawler, a permissive
 * wildcard, and a Sitemap: line. Takes a base URL (e.g. https://data.soapbox.community) and
 * returns the full robots.txt text.
 */
export function robotsTxt(baseUrl) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const blocks = CRAWLERS.map((ua) => `User-agent: ${ua}\nAllow: /`).join('\n\n');
  return [
    '# The SoapBox ecosystem welcomes all crawlers, including AI/LLM crawlers.',
    '# Read-only public market data — crawl freely.',
    blocks,
    'User-agent: *\nAllow: /',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n\n');
}

// ── IndexNow — instant URL submission to Bing, Yandex, Seznam, Naver (one POST, no account) ──
// The key is a public verification token, NOT a secret. We generate a random hex key once and
// persist it; the same value must be served at https://<host>/<key>.txt so the engines can verify
// ownership. (See SERVER NOTE below — the site server must serve that file; we don't edit it here.)
const KEY_FILE = process.env.INDEXNOW_KEY_FILE || join(HERE, 'data', 'indexnow-key.txt');
const HEX_KEY = /^[a-f0-9]{8,128}$/i;

/** Read the persisted IndexNow key, creating (and persisting) a random one on first use. */
export function getIndexNowKey() {
  if (process.env.INDEXNOW_KEY && HEX_KEY.test(process.env.INDEXNOW_KEY)) return process.env.INDEXNOW_KEY.toLowerCase();
  try {
    if (existsSync(KEY_FILE)) {
      const k = readFileSync(KEY_FILE, 'utf8').trim();
      if (HEX_KEY.test(k)) return k.toLowerCase();
    }
  } catch { /* fall through to generate */ }
  const key = randomBytes(16).toString('hex'); // 32 hex chars
  try {
    mkdirSync(dirname(KEY_FILE), { recursive: true });
    writeFileSync(KEY_FILE, key + '\n', 'utf8');
  } catch { /* read-only fs: still usable in-memory for this run */ }
  return key;
}

// Back-compat: previous callers imported INDEXNOW_KEY as a constant. Resolve it lazily-but-eagerly here.
export const INDEXNOW_KEY = getIndexNowKey();

// ── admin exclusion (soapy.blog) — block EVERYTHING, advertise no sitemap ──────────────────────────
// The admin portal must never be crawled, indexed, or discovered. This is one of the three defence
// layers (the others: the X-Robots-Tag header + the <meta robots noindex> in the admin <head>). A
// Disallow-all robots.txt with NO Sitemap line means a crawler that respects robots never fetches a
// single admin path and is never handed a list of them.
export function robotsTxtDisallowAll() {
  return [
    '# Soapy.blog admin portal — operator-only. Not for crawling or indexing.',
    'User-agent: *',
    'Disallow: /',
    '',
  ].join('\n');
}

// ── sitemap builders (shared, valid <urlset>) ──────────────────────────────────────────────────────
// Each entry: a path or absolute URL, plus optional { lastmod, changefreq, priority }. We resolve
// relative paths against base, escape every loc, and emit a spec-valid urlset. Admin URLs are the
// CALLER's responsibility to keep out — but as a hard backstop, any loc whose host matches a known
// admin host is dropped (defence in depth: soapy.blog can never sneak into a sitemap).
const ADMIN_HOST_RE = /(^|\.)soapy\.blog$/i;

function isAdminUrl(u) {
  try { return ADMIN_HOST_RE.test(new URL(u).host); } catch { return false; }
}

/** Build one site's /sitemap.xml from a base URL + entries. Drops any admin URL as a backstop. */
export function sitemapXml(baseUrl, entries = []) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const rows = [];
  for (const e of entries) {
    const ent = typeof e === 'string' ? { path: e } : (e || {});
    const raw = ent.url || ent.path || ent.loc || '/';
    const loc = /^https?:\/\//i.test(raw) ? raw : `${base}${raw.startsWith('/') ? '' : '/'}${raw}`;
    if (isAdminUrl(loc)) continue; // hard backstop: never list an admin URL
    const bits = [`<loc>${esc(loc)}</loc>`];
    if (ent.lastmod) bits.push(`<lastmod>${esc(ent.lastmod)}</lastmod>`);
    if (ent.changefreq) bits.push(`<changefreq>${esc(ent.changefreq)}</changefreq>`);
    if (ent.priority != null) bits.push(`<priority>${esc(ent.priority)}</priority>`);
    rows.push(`  <url>${bits.join('')}</url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`;
}

/**
 * A top-level sitemap-index linking the per-site sitemaps. `sites` is a list of base URLs (or
 * { url, lastmod }). Admin hosts are dropped as a backstop, so soapy.blog can never appear here.
 */
export function sitemapIndexXml(sites = []) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const rows = [];
  for (const s of sites) {
    const site = typeof s === 'string' ? { url: s } : (s || {});
    const base = String(site.url || '').replace(/\/+$/, '');
    if (!base) continue;
    if (isAdminUrl(base)) continue; // hard backstop
    const loc = `${base}/sitemap.xml`;
    const bits = [`<loc>${esc(loc)}</loc>`];
    if (site.lastmod) bits.push(`<lastmod>${esc(site.lastmod)}</lastmod>`);
    rows.push(`  <sitemap>${bits.join('')}</sitemap>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</sitemapindex>\n`;
}

// ── llms.txt — a simple machine-readable index for AI crawlers (public sites only) ─────────────────
// The emerging llms.txt convention: a markdown file at /llms.txt that tells an LLM what a site is and
// where to look. We never reference the admin portal here. `links` is [{ label, path|url, note? }].
export function llmsTxt({ name, baseUrl, summary = '', links = [] } = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const lines = [`# ${name || 'SoapBox'}`, ''];
  if (summary) { lines.push(`> ${summary}`, ''); }
  if (base) { lines.push(`Site: ${base}`, ''); }
  if (links.length) {
    lines.push('## Key pages', '');
    for (const l of links) {
      const raw = l.url || l.path || '/';
      if (isAdminUrl(raw)) continue; // never advertise an admin URL to AI crawlers
      const href = /^https?:\/\//i.test(raw) ? raw : `${base}${raw.startsWith('/') ? '' : '/'}${raw}`;
      if (isAdminUrl(href)) continue;
      lines.push(`- [${l.label || raw}](${href})${l.note ? `: ${l.note}` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ── the public SoapBox site registry — single source of truth for the sitemap-index ───────────────
// Every PUBLIC subdomain, used to build the top-level sitemap-index. soapy.blog (admin) is
// deliberately ABSENT — it is never crawled and never listed anywhere.
export const PUBLIC_SITES = [
  { slug: 'data', url: 'https://data.soapbox.community', name: 'SoapBox Data' },
  { slug: 'search', url: 'https://search.soapbox.community', name: 'SoapBox Search' },
  { slug: 'stocks', url: 'https://stocks.soapbox.community', name: 'SoapBox Stocks' },
  { slug: 'directory', url: 'https://directory.soapbox.community', name: 'SoapBox Directory' },
  { slug: 'wiki', url: 'https://wiki.soapbox.community', name: 'Library of Ashurbanipal' },
  { slug: 'hemp', url: 'https://hemp.soapbox.community', name: 'SoapBox Hemp' },
  { slug: 'law', url: 'https://law.soapbox.community', name: 'SoapBox Law' },
  { slug: 'politics', url: 'https://politics.soapbox.community', name: 'SoapBox Politics' },
];

/** The top-level sitemap-index over all PUBLIC sites (admin can never appear). */
export function publicSitemapIndexXml(lastmod) {
  return sitemapIndexXml(PUBLIC_SITES.map((s) => ({ url: s.url, lastmod })));
}

export const _adminGuard = { isAdminUrl, ADMIN_HOST_RE };

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

/**
 * Submit a batch of URLs (all on the same host) to IndexNow. Best-effort; never throws.
 * @param {string} host - the host or base URL the URLs live on (e.g. data.soapbox.community).
 * @param {string[]} urls - absolute URLs (or paths, which are resolved against host).
 * @param {object} [opts] - { dryRun } to build the request without sending.
 */
export async function submitIndexNow(host, urls = [], opts = {}) {
  const base = normalizeBase(host);
  const hostname = new URL(base).host;
  const key = getIndexNowKey();
  const urlList = [...new Set(urls)]
    .map((u) => (/^https?:\/\//i.test(u) ? u : `${base}${u.startsWith('/') ? '' : '/'}${u}`))
    .slice(0, 10000);
  if (!urlList.length) return { ok: false, reason: 'no urls' };
  const body = { host: hostname, key, keyLocation: `${base}/${key}.txt`, urlList };
  if (opts.dryRun) return { ok: true, dryRun: true, endpoint: INDEXNOW_ENDPOINT, body, count: urlList.length };
  try {
    const r = await _fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    return { ok: r.ok || r.status === 202, status: r.status, count: urlList.length };
  } catch (e) { return { ok: false, reason: e.message }; }
}

// Back-compat alias for the prior signature submitToIndexNow(baseUrl, urls).
export const submitToIndexNow = (baseUrl, urls = [], opts = {}) => submitIndexNow(baseUrl, urls, opts);

/**
 * Ping the sitemap-ping endpoints. Google deprecated its endpoint (June 2023) and Bing's is
 * legacy too — IndexNow is the real mechanism — but these are harmless GETs, so we fire them
 * best-effort for whatever still listens. Never throws.
 * @param {string} sitemapUrl - the full sitemap URL (e.g. https://data.soapbox.community/sitemap.xml).
 */
export async function pingSitemaps(sitemapUrl, opts = {}) {
  const sm = encodeURIComponent(String(sitemapUrl));
  const targets = [
    { name: 'google', url: `https://www.google.com/ping?sitemap=${sm}` },
    { name: 'bing', url: `https://www.bing.com/ping?sitemap=${sm}` },
  ];
  if (opts.dryRun) return { ok: true, dryRun: true, targets: targets.map((t) => t.url) };
  const results = await Promise.all(targets.map(async (t) => {
    try { const r = await _fetch(t.url); return { name: t.name, ok: r.ok, status: r.status }; }
    catch (e) { return { name: t.name, ok: false, reason: e.message }; }
  }));
  return { ok: results.some((r) => r.ok), results };
}

// Back-compat: prior single-endpoint helper took a base URL and pinged Bing only.
export async function pingSitemap(baseUrl) {
  const base = normalizeBase(baseUrl);
  return pingSitemaps(`${base}/sitemap.xml`);
}

function normalizeBase(input) {
  let s = String(input).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s;
}

// ── CLI ── node crawlers.mjs <subcommand> [base] [urls...]
if (process.argv[1] && process.argv[1].endsWith('crawlers.mjs')) {
  const [, , cmd, baseArg, ...rest] = process.argv;
  const base = baseArg && !baseArg.startsWith('-') ? normalizeBase(baseArg) : 'https://data.soapbox.community';
  const dry = process.argv.includes('--dry-run');
  if (cmd === 'robots') {
    process.stdout.write(robotsTxt(base));
  } else if (cmd === 'key') {
    const key = getIndexNowKey();
    console.log(`IndexNow key: ${key}`);
    console.log(`Key file:     ${KEY_FILE}`);
    console.log(`Must be served at: ${base}/${key}.txt  (plain text containing exactly the key)`);
  } else if (cmd === 'submit') {
    const urls = rest.filter((a) => !a.startsWith('--'));
    console.log(JSON.stringify(await submitIndexNow(base, urls, { dryRun: dry }), null, 2));
  } else if (cmd === 'ping') {
    console.log(JSON.stringify(await pingSitemaps(`${base}/sitemap.xml`, { dryRun: dry }), null, 2));
  } else {
    console.log(`crawlers: ${CRAWLERS.length} crawlers welcomed.

usage: node crawlers.mjs <subcommand> [base] [args]
  robots [base]                  print robots.txt for base
  key    [base]                  print/generate the IndexNow key + where it must be served
  submit [base] <url...> [--dry-run]   submit URLs to IndexNow
  ping   [base] [--dry-run]      ping Google + Bing sitemap endpoints

base defaults to https://data.soapbox.community`);
  }
}
