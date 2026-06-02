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
