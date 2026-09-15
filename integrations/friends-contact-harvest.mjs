// friends-contact-harvest — find a contact route for the people in the operator's own seed list, and
// refuse every address that is not actually theirs.
//
// ⭐ WHY THIS IS A DIFFERENT PROBLEM FROM THE HOLDER HARVEST, AND WHY IT IS THE ONE WORTH DOING.
// The holder file is 17,784 Graphene accounts — crypto natives, the audience the operator explicitly
// does NOT want on the site. This file is 123 people he actually knows, and 39 of them run or work at
// a business that publishes a contact address ON PURPOSE. A business contact page exists so people
// will use it. That is the whole difference between outreach and spam, and it is why this list gets
// crawled and that one does not.
//
// ⚠️ The attribution rule is imported, not rewritten. holder-contact-harvest.mjs already learned the
// expensive lesson — its 325 "holder emails" included read.cash/contact 18 times and an amzn.to
// affiliate link, i.e. a support desk and a footer ad, and mailing those is what put the operator's
// Hive accounts in front of Spaminator. Same rule, same refusals, one implementation.
//
// ⛔ SEGMENTS THAT NEVER REACH THIS MODULE. friends-ingest.mjs removes family, personal history
// (incl. justice-involved) and identity-disputed rows before anything becomes a lead. This module
// consumes that output, so a removed row cannot acquire a contact route by a side door.
//
// Nothing here sends. It reads public pages at a throttle and produces rows for Herald's gate.

import { attribution, siteHost, confersNothing } from './holder-contact-harvest.mjs';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
const THROTTLE_MS = () => Math.max(0, Number(env('FRIENDS_CRAWL_THROTTLE_MS', '1500')) || 1500);
const MAX_BYTES = () => Math.max(2048, Number(env('FRIENDS_CRAWL_MAX_BYTES', '400000')) || 400000);
const MAX_PAGES_PER_PERSON = () => Math.max(1, Number(env('FRIENDS_CRAWL_MAX_PAGES', '3')) || 3);

/** Pages a small site publishes contact details on, in the order worth trying. */
export const CONTACT_PATHS = Object.freeze(['/contact', '/about', '/contact-us', '/about-us']);

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Every http(s) URL a seed row points at, deduped, hubs and platform apexes dropped. */
export function urlsFor(person) {
  const p = person && typeof person === 'object' ? person : {};
  const e = p.enrichment && typeof p.enrichment === 'object' ? p.enrichment : {};

  // ⚠️ `enrichment.links` is an OBJECT — { linkedin, instagram, website, other: [] } — not an array.
  // Treating it as one silently yielded zero URLs across the whole file while reporting success, which
  // is the worst possible failure for a harvester: it looks like "nobody has a website".
  const flat = [];
  const push = (v) => {
    if (!v) return;
    if (typeof v === 'string') { flat.push(v); return; }
    if (Array.isArray(v)) { for (const x of v) push(x); return; }
    if (typeof v === 'object') { for (const x of Object.values(v)) push(x); }
  };
  push(e.links); push(e.sources); push(e.website); push(p.website); push(p.url);

  // A person's OWN site ranks above a profile page: an address on their own domain is attributable,
  // one scraped off a directory listing is not.
  const own = []; const rest = [];
  for (const u of flat) {
    if (!/^https?:\/\//i.test(u)) continue;
    if (confersNothing(u)) continue;            // a hub or a platform apex is nobody's own site
    const host = siteHost(u);
    if (!host) continue;
    (PROFILE_HOSTS.has(host) ? rest : own).push(u);
  }
  const out = [];
  for (const u of [...own, ...rest]) if (!out.includes(u)) out.push(u);
  return out;
}

/** Profile pages on somebody else's platform: worth reading last, never worth ranking first. */
export const PROFILE_HOSTS = Object.freeze(new Set([
  'www.linkedin.com', 'linkedin.com', 'www.instagram.com', 'instagram.com',
  'www.facebook.com', 'facebook.com', 'www.idealist.org', 'idealist.org',
  'twitter.com', 'x.com', 'www.youtube.com', 'youtube.com',
]));

/** Addresses on one page, each run through the shared attribution rule. */
export function harvestPage(html, { site = '', foundOn = '' } = {}) {
  const found = new Map();
  for (const m of String(html || '').matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase().replace(/\.$/, '');
    if (found.has(e)) continue;
    found.set(e, attribution(e, { site: site || foundOn, foundOn: foundOn || site }));
  }
  return [...found.entries()].map(([email, verdict]) => ({ email, ...verdict }));
}

async function readPage(url) {
  try {
    const r = await _fetch(url, { redirect: 'follow', headers: { accept: 'text/html,*/*' } });
    if (!r || (Number(r.status) || 0) >= 400) return { ok: false, status: (r && r.status) || 0, html: '' };
    let html = await r.text();
    if (typeof html === 'string' && html.length > MAX_BYTES()) html = html.slice(0, MAX_BYTES());
    return { ok: true, status: r.status, html };
  } catch { return { ok: false, status: 0, html: '' }; }
}

/**
 * Crawl one person's own sites for a contact route they published.
 * ⚠️ Never throws; a dead site is a result, not an error.
 */
export async function harvestPerson(person, opts = {}) {
  const name = (person && (person.name || person.id)) || '';
  const urls = urlsFor(person);
  const sleep = typeof opts.sleep === 'function' ? opts.sleep : (ms) => new Promise((r) => setTimeout(r, ms));
  const results = []; const kept = []; const rejected = [];
  let pages = 0;

  for (const base of urls) {
    const host = siteHost(base);
    const candidates = [base, ...CONTACT_PATHS.map((p) => {
      try { return new URL(p, base).toString(); } catch { return ''; }
    }).filter(Boolean)];
    for (const url of candidates) {
      if (pages >= MAX_PAGES_PER_PERSON()) break;
      pages++;
      const r = await readPage(url);
      results.push({ url, ok: r.ok, status: r.status });
      if (!r.ok) { if (THROTTLE_MS()) await sleep(THROTTLE_MS()); continue; }
      for (const hit of harvestPage(r.html, { site: base, foundOn: url })) {
        const row = { ...hit, person: name, host, foundOn: url };
        if (hit.ok) { if (!kept.some((k) => k.email === hit.email)) kept.push(row); }
        else rejected.push(row);
      }
      if (kept.length) break;                       // one good address per person is enough
      if (THROTTLE_MS()) await sleep(THROTTLE_MS());
    }
    if (kept.length) break;
  }
  return { person: name, urls: urls.length, pagesRead: pages, kept, rejected, results };
}

/** Crawl a whole segment. Sequential on purpose — a burst at 39 small sites is a scrape, not a visit. */
export async function harvestAll(people = [], opts = {}) {
  const list = Array.isArray(people) ? people : [];
  const out = [];
  for (const p of list) out.push(await harvestPerson(p, opts));
  const kept = out.flatMap((r) => r.kept);
  const rejected = out.flatMap((r) => r.rejected);
  const byReason = {};
  for (const r of rejected) byReason[r.verdict || 'unknown'] = (byReason[r.verdict || 'unknown'] || 0) + 1;
  return {
    people: list.length,
    withASite: out.filter((r) => r.urls > 0).length,
    pagesRead: out.reduce((n, r) => n + r.pagesRead, 0),
    kept, rejectedCount: rejected.length, rejectedByReason: byReason, rejected,
    results: out,
  };
}

export function handler(req, res, summary = null) {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(summary || {
    ok: true, service: 'friends-contact-harvest',
    contactPaths: CONTACT_PATHS,
    rule: 'attribution() from holder-contact-harvest — an address counts only if it is on a domain the '
        + 'person controls, or was published on a page of their own site. Everything else is dropped with a reason.',
    note: 'reads public pages at a throttle; sends nothing; consumes friends-ingest output so removed rows never appear',
  }, null, 2));
}

export default { urlsFor, harvestPage, harvestPerson, harvestAll, handler, CONTACT_PATHS, __setFetch };
