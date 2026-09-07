// wikipedia.mjs — the association mapper between our corpus and Wikipedia.
//
// WHAT IT IS FOR. Our wiki, our sites and our papers carry a dense keyword field — deities, places,
// haplogroups, compounds, concepts. This module asks Wikipedia three questions about that field:
//
//   1. Which articles correspond to our terms?            search() / summary()
//   2. What do those articles link OUT to?                links()
//   3. What links IN to them?                             backlinks()
//
// and then expand() runs (2) and (3) across a whole seed set and RANKS THE RESULT BY HOW MANY OF
// OUR OWN SEEDS TOUCH EACH PAGE. That ranking is the actual product: a page reached from one seed is
// a tangent, a page reached from nine is a hub our corpus is already circling without naming.
//
// NO API KEY. The MediaWiki Action API is public. Wikimedia's policy DOES require a descriptive
// User-Agent identifying the client and a contact — anonymous scripted access gets rate-limited or
// blocked, so UA is set on every request and is not optional.
//
// LICENCE NOTE, load-bearing for anything we republish: Wikipedia text is CC BY-SA 4.0. Quoting it
// into our own pages requires attribution AND share-alike on the derived text. This module returns
// extracts for RESEARCH ORIENTATION — deciding what to write about and what we are missing — not as
// paste material. Attribute anything that ships.
//
// House style: ESM, zero dependencies, injectable fetch so the tests run offline, soft-fail rather
// than throw, CLI guarded by the process.argv[1] check.
//
//   import { search, summary, links, backlinks, expand, __setFetch } from './wikipedia.mjs';

const API = 'https://en.wikipedia.org/w/api.php';
const UA = 'VanKushFamilyResearchInstitute/1.0 (https://wiki.soapbox.community; research mapping)';

let _fetch = globalThis.fetch;
export function __setFetch(f) { _fetch = f; }          // tests inject; never network in CI

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let _lastCall = 0;
const MIN_GAP_MS = 120;                                 // politeness, not a rate limit we were given

function qs(params) {
  const u = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
  return `${API}?${u.toString()}`;
}

// Every call funnels through here: one place for the UA, the spacing, and the soft-fail contract.
async function api(params) {
  const gap = Date.now() - _lastCall;
  if (gap < MIN_GAP_MS) await sleep(MIN_GAP_MS - gap);
  _lastCall = Date.now();
  try {
    const res = await _fetch(qs(params), { headers: { 'User-Agent': UA, accept: 'application/json' } });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch { return null; }                              // soft-fail: a dead network yields no data, not a crash
}

/** Title search. Returns [{title, snippet, wordcount}] — [] on any failure. */
export async function search(query, { limit = 5 } = {}) {
  const d = await api({ action: 'query', list: 'search', srsearch: String(query || ''), srlimit: String(limit) });
  const hits = d?.query?.search;
  if (!Array.isArray(hits)) return [];
  return hits.map((h) => ({
    title: h.title,
    wordcount: h.wordcount ?? 0,
    snippet: String(h.snippet || '').replace(/<[^>]*>/g, ''),
  }));
}

/** Lead-section extract for one or many titles. Returns a Map(title -> extract). */
export async function summary(titles) {
  const list = Array.isArray(titles) ? titles : [titles];
  const out = new Map();
  for (let i = 0; i < list.length; i += 20) {           // API caps multi-title queries
    const d = await api({
      action: 'query', prop: 'extracts', exintro: '1', explaintext: '1',
      redirects: '1', titles: list.slice(i, i + 20).join('|'),
    });
    for (const p of d?.query?.pages || []) {
      if (p.missing) continue;
      out.set(p.title, String(p.extract || '').trim());
    }
  }
  return out;
}

/** Outbound article links (ns 0 only). */
export async function links(title, { limit = 200 } = {}) {
  const d = await api({ action: 'query', prop: 'links', plnamespace: '0', pllimit: String(limit), redirects: '1', titles: title });
  const p = d?.query?.pages?.[0];
  if (!p || p.missing) return [];
  return (p.links || []).map((l) => l.title);
}

/** Inbound links — what Wikipedia thinks this page belongs to. */
export async function backlinks(title, { limit = 100 } = {}) {
  const d = await api({ action: 'query', list: 'backlinks', blnamespace: '0', bllimit: String(limit), bltitle: title });
  const b = d?.query?.backlinks;
  return Array.isArray(b) ? b.map((x) => x.title) : [];
}

/** Categories, which are Wikipedia's own topic map and often better than its prose. */
export async function categories(title) {
  const d = await api({ action: 'query', prop: 'categories', cllimit: '100', clshow: '!hidden', redirects: '1', titles: title });
  const p = d?.query?.pages?.[0];
  if (!p || p.missing) return [];
  return (p.categories || []).map((c) => String(c.title).replace(/^Category:/, ''));
}

/**
 * The association map. Walks out from `seeds` and counts how many DISTINCT seeds reach each page.
 *
 * `hubs` (reached by >= minSeeds of our own topics) is the answer to "pages associated with those
 * pages" — and the count is what makes it useful rather than a link dump.
 */
export async function expand(seeds, { direction = 'both', perSeed = 120, minSeeds = 2 } = {}) {
  const list = (Array.isArray(seeds) ? seeds : [seeds]).filter(Boolean);
  const seedSet = new Set(list);
  const reach = new Map();                              // page -> Set(seed)
  const resolved = [];
  const missing = [];

  for (const s of list) {
    const outward = direction === 'in' ? [] : await links(s, { limit: perSeed });
    const inward = direction === 'out' ? [] : await backlinks(s, { limit: Math.min(perSeed, 100) });
    if (!outward.length && !inward.length) { missing.push(s); continue; }
    resolved.push(s);
    for (const t of [...outward, ...inward]) {
      if (seedSet.has(t)) continue;                     // our own seeds are not discoveries
      if (!reach.has(t)) reach.set(t, new Set());
      reach.get(t).add(s);
    }
  }

  const ranked = [...reach.entries()]
    .map(([title, s]) => ({ title, seeds: [...s].sort(), count: s.size }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));

  return { resolved, missing, hubs: ranked.filter((r) => r.count >= minSeeds), all: ranked };
}

/** Which of our terms Wikipedia has no article for. Absence is a finding, not an error. */
export async function coverage(terms) {
  const have = [];
  const gaps = [];
  for (const t of terms) {
    const hit = await search(t, { limit: 1 });
    if (hit.length && hit[0].title.toLowerCase() === String(t).toLowerCase()) have.push(hit[0].title);
    else gaps.push({ term: t, nearest: hit[0]?.title || null });
  }
  return { have, gaps };
}

export default { search, summary, links, backlinks, categories, expand, coverage, __setFetch };
