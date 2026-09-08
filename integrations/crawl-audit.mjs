// crawl-audit.mjs — is a host actually crawlable, and by whom.
//
// WHY. There are ~114 site verticals in this repo and nearly every one of them builds a robots.txt and a
// sitemap.xml in code. None of that is evidence. A sitemap route that returns 404 in production, a
// robots.txt that advertises a sitemap which does not exist, or a hostname with no DNS record at all are
// all invisible from inside the repo and all mean the same thing: the pages are not being indexed.
//
// So this asks the live host, and it grades the two failures that actually cost indexing:
//
//   • A BROKEN PROMISE — robots.txt carries `Sitemap:` and that URL 404s. This is worse than having no
//     sitemap line at all: a crawler is sent to a dead end on the one file that tells it what to fetch.
//   • A FULL BLOCK — `Disallow: /` with no qualifier. Sometimes correct (a moderation console), which is
//     why this reports it as a state and lets the caller decide, rather than calling it a failure.
//
// It does NOT grade content, rankings, or backlinks. Reachability and permission are prerequisites, and
// prerequisites are the only thing a machine can check honestly.
//
// Read-only: GET only, no crawling of page bodies beyond the three well-known files, and it never
// follows a redirect chain — a redirect is a finding, not something to resolve away.
//
//   import { auditHost, auditAll, grade, robotsFacts } from './crawl-audit.mjs'
//   node integrations/crawl-audit.mjs melek.salon soapbox.community

import { fileURLToPath } from 'node:url';

let _fetch = (...a) => (globalThis.fetch ? globalThis.fetch(...a) : Promise.reject(new Error('no fetch')));
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

const str = (v) => String(v == null ? '' : v).trim();
export const TIMEOUT_MS = 12000;

/** Normalize any of "https://x.com/", "X.com", " x.com " to a bare lowercase host. Junk → ''. */
export function normalizeHost(input) {
  let s = str(input).toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z]+:\/\//, '').split('/')[0].split('?')[0].split('#')[0].replace(/:\d+$/, '');
  // A host has at least one dot and no whitespace. Anything else is not addressable.
  if (!/^[a-z0-9.-]+$/.test(s) || !s.includes('.')) return '';
  return s.replace(/^\.+|\.+$/g, '');
}

async function get(url) {
  try {
    const r = await _fetch(url, {
      redirect: 'manual',
      signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
      headers: { 'user-agent': 'MELEK-crawl-audit/1.0 (+https://melek.salon)' },
    });
    const status = (r && r.status) || 0;
    const body = r && typeof r.text === 'function' ? await r.text().catch(() => '') : '';
    const location = (r && r.headers && typeof r.headers.get === 'function' && r.headers.get('location')) || '';
    return { status, body, location };
  } catch (e) {
    const code = (e && (e.name === 'TimeoutError' ? 'timeout' : (e.cause && e.cause.code) || e.message)) || 'error';
    return { status: 0, body: '', location: '', error: str(code).slice(0, 40) };
  }
}

/**
 * Parse the facts out of a robots.txt body. Pure.
 * `blocksAll` is only true for a bare `Disallow: /` — `Disallow: /admin` is not a site block.
 */
export function robotsFacts(body) {
  const b = str(body);
  const sitemaps = [];
  for (const m of b.matchAll(/^\s*sitemap:\s*(\S+)\s*$/gim)) sitemaps.push(m[1]);
  return {
    blocksAll: /^\s*disallow:\s*\/\s*$/im.test(b),
    sitemaps,
    // A named crawler with its own block. Yandex and Baidu are the ones that matter for "worldwide"
    // and are also the ones most often blocked by a copy-pasted robots.txt.
    namedBlocks: [...b.matchAll(/^\s*user-agent:\s*(\S+)\s*$/gim)].map((m) => m[1]).filter((a) => a !== '*'),
  };
}

/** Grade a completed set of observations into one verdict + the reasons. Pure. */
export function grade(o = {}) {
  const problems = [];
  if (!o.reachable) {
    return { verdict: 'unreachable', problems: [o.rootError === 'ENOTFOUND' ? 'no DNS record for this host' : `host did not answer (${o.rootError || 'no response'})`] };
  }
  if (o.redirect) problems.push(`root redirects to ${o.redirect} — index the destination, not this name`);
  if (o.robotsStatus !== 200) problems.push(`no robots.txt (HTTP ${o.robotsStatus}) — crawlers get no sitemap pointer`);
  if (o.blocksAll) problems.push('robots.txt says Disallow: / — this host is deliberately not indexed');
  // The broken promise. Ranked first because it is the one that actively misleads a crawler.
  if (o.sitemapReferenced && !o.sitemapOk) {
    problems.unshift('robots.txt advertises a Sitemap: URL that does not resolve — a crawler is sent to a dead end');
  }
  if (!o.sitemapReferenced && o.robotsStatus === 200) problems.push('robots.txt names no Sitemap: — discovery is left to luck');
  if (!o.sitemapOk && o.sitemapStatus !== 200) problems.push(`sitemap.xml is not served (HTTP ${o.sitemapStatus})`);
  else if (!o.sitemapOk) problems.push('sitemap.xml is served but is not a valid urlset/sitemapindex');
  else if (o.urlCount === 0) problems.push('sitemap.xml is valid but lists no URLs');

  if (o.blocksAll) return { verdict: 'blocked', problems };
  if (!problems.length) return { verdict: 'ok', problems };
  // A host that serves pages and allows crawling is indexable even with a bad sitemap — it is just slow
  // and incomplete. That is a real distinction and collapsing it would hide which hosts are urgent.
  return { verdict: o.sitemapOk ? 'warn' : 'degraded', problems };
}

/** Audit one host: root, robots.txt, sitemap.xml. Never throws. */
export async function auditHost(host) {
  const h = normalizeHost(host);
  if (!h) return { host: str(host), verdict: 'invalid', problems: ['not a hostname'], reachable: false };

  const root = await get(`https://${h}/`);
  const reachable = root.status > 0;
  if (!reachable) {
    return { host: h, reachable: false, rootStatus: 0, rootError: root.error, ...grade({ reachable: false, rootError: root.error }) };
  }
  const [rob, sm] = await Promise.all([get(`https://${h}/robots.txt`), get(`https://${h}/sitemap.xml`)]);
  const facts = rob.status === 200 ? robotsFacts(rob.body) : { blocksAll: false, sitemaps: [], namedBlocks: [] };
  const sitemapOk = sm.status === 200 && /<urlset|<sitemapindex/i.test(sm.body || '');
  const urlCount = sitemapOk ? (sm.body.match(/<loc>/gi) || []).length : 0;

  const o = {
    host: h, reachable: true,
    rootStatus: root.status,
    redirect: root.status >= 300 && root.status < 400 ? root.location : '',
    robotsStatus: rob.status,
    blocksAll: facts.blocksAll,
    sitemapReferenced: facts.sitemaps.length > 0,
    sitemapsDeclared: facts.sitemaps,
    namedBlocks: facts.namedBlocks,
    sitemapStatus: sm.status,
    sitemapOk, urlCount,
  };
  return { ...o, ...grade(o) };
}

/** Audit many hosts concurrently. Order of the result matches the order given. */
export async function auditAll(hosts = []) {
  const list = (Array.isArray(hosts) ? hosts : []).map(normalizeHost).filter(Boolean);
  const seen = new Set(); const uniq = [];
  for (const h of list) if (!seen.has(h)) { seen.add(h); uniq.push(h); }
  const results = await Promise.all(uniq.map((h) => auditHost(h)));
  const counts = { ok: 0, warn: 0, degraded: 0, blocked: 0, unreachable: 0, invalid: 0 };
  for (const r of results) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  return {
    results, counts,
    indexable: results.filter((r) => r.verdict === 'ok' || r.verdict === 'warn').length,
    total: results.length,
  };
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'crawl-audit',
    checks: ['host answers', 'robots.txt served', 'Disallow: / ', 'Sitemap: referenced', 'sitemap.xml valid', 'URL count'],
    note: 'reachability and permission only — this does not grade content, rankings or links',
  }, null, 2));
}

export default { auditHost, auditAll, grade, robotsFacts, normalizeHost, handler, __setFetch };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const hosts = process.argv.slice(2);
  if (!hosts.length) { console.error('usage: node integrations/crawl-audit.mjs <host> [host...]'); process.exit(1); }
  const out = await auditAll(hosts);
  for (const r of out.results) {
    console.log(`${r.verdict.toUpperCase().padEnd(11)} ${r.host}${r.urlCount ? `  (${r.urlCount} urls)` : ''}`);
    for (const p of r.problems) console.log(`            - ${p}`);
  }
  console.log(`\n${out.indexable}/${out.total} indexable`, JSON.stringify(out.counts));
}
