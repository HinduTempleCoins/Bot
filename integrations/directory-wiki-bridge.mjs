// directory-wiki-bridge.mjs — make the DIRECTORY bot and the WIKI (Library of Ashurbanipal) bot
// fill each other in (operator task #163). The Directory is a curated map of crypto/data resources;
// the Library is a fact-checked, generated knowledge base. They should be one organism:
//
//   • Topics the Directory implies (its categories + the wikis-catalog reference set) but the Library
//     doesn't cover yet  →  proposed WIKI articles (so the Library grows toward what readers browse).
//   • Live Library articles  →  proposed DIRECTORY rows linking to them (so the wiki is discoverable
//     from the Directory's "Learn" section, not orphaned at wiki.soapbox.community).
//
// This module is ADVISORY ONLY. It NEVER edits directory.mjs and NEVER writes wiki articles — both
// sides stay a human/generator decision (curation is anti-scam; the KB is never auto-edited). It
// emits a plan the operator reviews and the generators consume:
//
//   • proposedWikiTopics  — each entry is BOTH the {title, why, sources} spec form AND a ready-to-paste
//     wikiGenerator topic ({title, searchTerms, primaryDomains, crossReferenceDomains, description}).
//     Drop the topic objects into a #190-style priority array in
//     library-of-ashurbanipal-bot/src/wikiGenerator.js to have the wiki generator produce them.
//   • proposedDirectoryEntries — each is a directory.mjs row ({ name, url, blurb, ours:true }) under a
//     suggested `cat`. Hand-add good ones to the 'Learn' category in directory.mjs.
//
// Coverage is checked against the live wiki /api/search?q= endpoint (WIKI_SITE, default
// https://wiki.soapbox.community); if the wiki is unreachable it falls back to reading the generated
// article titles on disk. Best-effort, cached, never throws.
//
//   node integrations/directory-wiki-bridge.mjs           # print the cross-suggestion plan
//   node integrations/directory-wiki-bridge.mjs --json    # raw plan JSON
//   WIKI_SITE=http://localhost:8090 node integrations/directory-wiki-bridge.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIRECTORY } from '../site/soapbox/directory.mjs';
import { WIKIS, categories as wikiCategories } from './soapbox/wikis-catalog.mjs';
import { cached, TTL } from './soapbox/cache.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));

const WIKI_SITE = (process.env.WIKI_SITE || 'https://wiki.soapbox.community').replace(/\/$/, '');
const ARTICLES_DIR =
  process.env.ARTICLES_DIR ||
  path.join(__dir, '..', 'library-of-ashurbanipal-bot', 'generated-articles');

// ───────────────────────────────────────────────────────────────────────────
// WIKI COVERAGE — what the Library already has
// ───────────────────────────────────────────────────────────────────────────

const PRIVATE = /(_private|secret|operator|\.local|scripture)/i;

// Mirror the wiki server's render.mjs exactly so the links we build resolve to real pages:
//   slugify keeps underscores + case;  titleize turns underscores back into spaces.
const slug = (s) =>
  String(s).trim().replace(/\.wiki$/, '').replace(/[\s_]+/g, '_').replace(/[^A-Za-z0-9_:-]/g, '');
const titleize = (s) => String(s).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

/** Generated wiki article titles read straight off disk (the fallback / offline source of truth). */
function articlesOnDisk() {
  let files = [];
  try {
    files = fs.readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.wiki') && !PRIVATE.test(f));
  } catch {
    return [];
  }
  return files.map((f) => {
    const title = titleize(f.replace(/\.wiki$/, ''));
    return { title, url: `${WIKI_SITE}/wiki/${slug(title)}` };
  });
}

/**
 * Enumerate the LIVE article set by scraping the wiki index page for /wiki/<slug> links. The deployed
 * Library can be ahead of the local generated-articles/ checkout, so when the wiki is reachable this is
 * the authoritative list (and the links are guaranteed to resolve). Returns [{title,url}] or null if
 * the wiki is unreachable (caller falls back to disk). Cached + best-effort.
 */
async function liveArticles() {
  return cached('dwb:live-index', TTL.metadata, async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(`${WIKI_SITE}/`, { signal: ctrl.signal });
      if (!res.ok) return null;
      const html = await res.text();
      const slugs = new Set();
      for (const m of html.matchAll(/\/wiki\/([A-Za-z0-9_:%-]+)/g)) slugs.add(m[1]);
      if (!slugs.size) return null;
      return [...slugs].map((s) => ({
        title: titleize(decodeURIComponent(s)),
        url: `${WIKI_SITE}/wiki/${s}`,
      }));
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  });
}

/**
 * Ask the live wiki whether it has anything for a query. Returns the result rows (possibly empty) or
 * null if the wiki is unreachable. Cached + best-effort; a fetch hiccup serves the last good answer.
 */
async function wikiSearch(q) {
  const query = String(q || '').trim();
  if (!query) return [];
  return cached(`dwb:search:${query.toLowerCase()}`, TTL.metadata, async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(`${WIKI_SITE}/api/search?q=${encodeURIComponent(query)}`, {
        signal: ctrl.signal,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return null;
      const j = await res.json();
      return Array.isArray(j?.results) ? j.results : [];
    } catch {
      return null; // unreachable → caller falls back to disk
    } finally {
      clearTimeout(t);
    }
  });
}

/**
 * Does the Library cover `term`? Tries the live search API first; on null (wiki down) falls back to a
 * substring scan of on-disk article titles. Returns { covered, via, hits }.
 */
async function isCovered(term, diskTitles) {
  const results = await wikiSearch(term);
  if (results === null) {
    // offline fallback: title substring either way
    const tl = String(term).toLowerCase();
    const hits = diskTitles.filter(
      (a) => a.title.toLowerCase().includes(tl) || tl.includes(a.title.toLowerCase()),
    );
    return { covered: hits.length > 0, via: 'disk', hits };
  }
  return { covered: results.length > 0, via: 'api', hits: results };
}

// ───────────────────────────────────────────────────────────────────────────
// 1. DIRECTORY → WIKI : topics the Directory implies that the wiki lacks
// ───────────────────────────────────────────────────────────────────────────

// Seed topics the Directory's *categories* imply — these are evergreen explainer articles a reader
// browsing that category would want the Library to have. Each carries the wikiGenerator (#190) topic
// fields so the proposal is paste-ready. `match` is what we probe wiki coverage with.
const CATEGORY_TOPICS = {
  'Wallets': {
    title: 'Crypto Wallets — Custodial vs Non-Custodial, Hot vs Cold',
    match: 'wallet',
    searchTerms: ['non-custodial wallet', 'hardware wallet cold storage', 'seed phrase security', 'hot vs cold wallet'],
    description: 'How crypto wallets work: custodial vs non-custodial, hot vs cold, seed phrases, and hardware signers.',
  },
  'Browser Extensions': {
    title: 'Wallet Security Browser Extensions — Approvals, Simulation, Phishing',
    match: 'token approval',
    searchTerms: ['token approval revoke', 'transaction simulation wallet', 'web3 phishing protection', 'malicious approval drainer'],
    description: 'Browser-extension defenses for web3: revoking token approvals, simulating transactions, and catching phishing before you sign.',
  },
  'Block Explorers': {
    title: 'Reading a Block Explorer',
    match: 'block explorer',
    searchTerms: ['block explorer transaction', 'read etherscan', 'on-chain transaction lookup', 'contract verification explorer'],
    description: 'How to read a block explorer: transactions, addresses, token transfers, and verifying a contract.',
  },
  'Security & Anti-Scam': {
    title: 'Recognizing Crypto Scam Patterns',
    match: 'scam',
    searchTerms: ['crypto scam patterns', 'approval drainer scam', 'rug pull warning signs', 'phishing wallet drain'],
    description: 'The recurring shapes of crypto scams — drainers, rug pulls, fake faucets, approval phishing — and the red flags that give them away.',
  },
  'Testnet Faucets': {
    title: 'Testnet Faucets and Testnets',
    match: 'testnet faucet',
    searchTerms: ['testnet faucet', 'sepolia testnet', 'test coins no value', 'mainnet faucet scam'],
    description: 'What testnets and faucets are, why test coins have no value, and why "mainnet faucets" are almost always scams.',
  },
  'Portfolio & Tools': {
    title: 'On-Chain Analysis Tools — Portfolios, Holder Clusters, Entity Intelligence',
    match: 'on-chain analysis',
    searchTerms: ['on-chain portfolio tracker', 'token holder concentration', 'wallet clustering analysis', 'on-chain entity intelligence'],
    description: 'On-chain tooling for readers: portfolio trackers, holder-cluster maps that reveal concentration, and entity-intelligence services.',
  },
  'Data & Index Sites': {
    title: 'Crypto Market Data Aggregators — How Prices and TVL Are Computed',
    match: 'market data aggregator',
    searchTerms: ['crypto price aggregator methodology', 'total value locked TVL', 'volume-weighted price', 'market cap circulating supply'],
    description: 'How market-data aggregators compute the numbers readers trust: prices, market cap, circulating supply, and TVL.',
  },
  'Commodity Prices & Data': {
    title: 'Commodities as a Value Anchor for Crypto',
    match: 'commodity',
    searchTerms: ['commodity spot price', 'bullion gold silver', 'commodity-backed token', 'grains softs metals energy markets'],
    description: 'The commodity complex (grains, softs, metals, energy) as a real-world value anchor, and how commodity-backed tokens reference it.',
  },
};

// Default grounding fields shared by Directory-implied topics. They are crypto/legibility explainers,
// so they lean on the scraper for breadth and the in-corpus `cryptocurrency` domain for any prose.
const DIR_TOPIC_DEFAULTS = {
  primaryDomains: ['cryptocurrency'],
  crossReferenceDomains: ['vankush'],
};

/**
 * Scan the DIRECTORY categories + the wikis-catalog reference set and propose wiki article topics the
 * Directory implies but the Library doesn't cover yet. Coverage is checked against the live wiki.
 *
 * @returns {Promise<Array<{title, why, sources, searchTerms, primaryDomains, crossReferenceDomains, description}>>}
 */
export async function directoryTopicsForWiki() {
  const diskTitles = articlesOnDisk();
  const dirCats = new Set(DIRECTORY.map((g) => g.cat));
  const out = [];

  // (a) one explainer per Directory category that has a seed topic and isn't already covered.
  for (const [cat, seed] of Object.entries(CATEGORY_TOPICS)) {
    if (!dirCats.has(cat)) continue; // only propose for categories the Directory actually has
    const cov = await isCovered(seed.match, diskTitles);
    if (cov.covered) continue;
    const examples = (DIRECTORY.find((g) => g.cat === cat)?.items || [])
      .slice(0, 4)
      .map((i) => i.name);
    out.push({
      title: seed.title,
      why:
        `The Directory has a "${cat}" category (${examples.join(', ')}${examples.length ? '…' : ''}) ` +
        `but the Library has no article a reader can land on to understand it ` +
        `(wiki search for "${seed.match}" via ${cov.via} returned no hit).`,
      sources: [`Directory category: ${cat}`, ...examples.map((n) => `Directory entry: ${n}`)],
      // wikiGenerator (#190) topic form — paste-ready:
      searchTerms: seed.searchTerms,
      ...DIR_TOPIC_DEFAULTS,
      description: seed.description,
    });
  }

  // (b) the wikis-catalog (#185) names whole reference DOMAINS (nature/herbal, history/religion,
  //     science/math). Where a domain has reference wikis listed but the Library has no article in
  //     that space, propose a flagship explainer so the Library has its own anchor next to them.
  const domainSeeds = {
    'Nature / herbal / medical': {
      title: 'Medicinal and Edible Plants — Reading a Plant Database',
      match: 'plant',
      searchTerms: ['medicinal plant database', 'edible plant uses', 'permaculture plant guild', 'herbal monograph'],
      description: 'How to read a medicinal/edible plant database, and what a plant monograph records (uses, cautions, habitat).',
    },
    'History / humanities / religion': {
      title: 'Ancient Mystery Religions and Temple Technology',
      match: 'temple',
      searchTerms: ['ancient mystery religion', 'temple ritual technology', 'incense kyphi temple', 'Egyptian ritual practice'],
      description: 'Ancient mystery-religion practice and temple ritual technology as a reconstruction subject — incense, anointing, and rite.',
    },
  };
  const catalogCats = new Set(wikiCategories());
  for (const [cat, seed] of Object.entries(domainSeeds)) {
    if (!catalogCats.has(cat)) continue;
    const cov = await isCovered(seed.match, diskTitles);
    if (cov.covered) continue;
    const refs = WIKIS.filter((w) => w.category === cat).slice(0, 4).map((w) => w.name);
    out.push({
      title: seed.title,
      why:
        `The wikis-catalog lists reference wikis for "${cat}" (${refs.join(', ')}) but the Library has ` +
        `no anchor article of its own in that space (wiki search for "${seed.match}" via ${cov.via} returned no hit).`,
      sources: refs.map((n) => `wikis-catalog: ${n}`),
      searchTerms: seed.searchTerms,
      primaryDomains: ['vankush', 'history'],
      crossReferenceDomains: ['history'],
      description: seed.description,
    });
  }

  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// 2. WIKI → DIRECTORY : a Directory row for each live wiki article
// ───────────────────────────────────────────────────────────────────────────

/**
 * For each live wiki article, propose a Directory entry linking to it so the Library is discoverable
 * from the Directory (under "Learn"). Prefers the live wiki listing; falls back to on-disk titles.
 *
 * Skips any article whose URL is already in the Directory (dedup), so re-runs don't re-propose rows.
 *
 * @returns {Promise<Array<{cat, name, url, blurb, ours, sourceTitle}>>}
 */
export async function wikiArticlesForDirectory() {
  // Prefer the LIVE article set (links guaranteed to resolve; the deployed Library can be ahead of the
  // local checkout). Fall back to on-disk titles only when the wiki is unreachable.
  const live = await liveArticles();
  const articles = live || articlesOnDisk();
  const via = live ? 'live-index' : 'disk';

  // existing Directory URLs (normalized) — don't re-propose what's already linked.
  const have = new Set();
  for (const g of DIRECTORY) for (const i of g.items) have.add(normUrl(i.url));

  const out = [];
  for (const a of articles) {
    if (have.has(normUrl(a.url))) continue; // already linked from the Directory
    out.push({
      cat: 'Learn',
      name: `Library: ${a.title}`,
      url: a.url,
      blurb: `Our fact-checked Library article on ${a.title}.`,
      ours: true,
      sourceTitle: a.title,
      via,
    });
  }
  return out;
}

const normUrl = (u) => {
  try {
    const x = new URL(u);
    return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/$/, '')).toLowerCase();
  } catch {
    return String(u || '').toLowerCase().replace(/\/$/, '');
  }
};

// ───────────────────────────────────────────────────────────────────────────
// 2b. SPEC-NAMED entry points (task #163) — operate on an arbitrary `listings`
//     array or a single `articleTopic`, independent of live-wiki coverage. These
//     are the pure, synchronous surface the Directory's crawler/suggest bot calls
//     directly: feed it whatever rows it just discovered/curated, get back topic
//     suggestions; ask it for the Directory rows that match an article it just
//     generated. Both are read-only and never write to either side.
// ───────────────────────────────────────────────────────────────────────────

/** Flatten the global DIRECTORY ({cat,items}[]) into tagged rows. */
function flattenDirectory() {
  const rows = [];
  for (const g of DIRECTORY) for (const i of g.items) rows.push({ cat: g.cat, ...i });
  return rows;
}

/** Normalize one listing into {cat, name, url, blurb} regardless of which shape the caller passes. */
function asListing(x) {
  if (!x || typeof x !== 'object') return null;
  const name = x.name || x.title || '';
  const url = x.url || x.link || '';
  if (!name && !url) return null;
  return {
    cat: x.cat || x.category || '',
    name: String(name),
    url: String(url),
    blurb: String(x.blurb || x.description || ''),
  };
}

// The same category→explainer seeds the coverage scanner uses, but keyed for direct lookup by
// either a listing's category OR a keyword found in its name/blurb. Lets the suggest-bot turn a
// freshly-discovered row into a concrete wiki-topic proposal without needing the wiki online.
const TOPIC_INDEX = (() => {
  const idx = [];
  for (const [cat, seed] of Object.entries(CATEGORY_TOPICS)) {
    idx.push({ cat, keyword: seed.match, seed });
  }
  return idx;
})();

/**
 * Given a set of Directory listings (rows the crawler/suggest bot discovered or curated — each a
 * {name,url,blurb,cat}-ish object, or a {cat,items} group, or a flat array of either), propose wiki
 * article topics those listings imply. Pure + synchronous; does NOT check live-wiki coverage (use
 * directoryTopicsForWiki() for the coverage-aware, network form). De-dupes by topic title.
 *
 * @param {Array} listings  rows/groups from the Directory (defaults to the whole DIRECTORY catalog)
 * @returns {Array<{title, why, sources, searchTerms, primaryDomains, crossReferenceDomains, description, matchedListings}>}
 */
export function suggestArticlesFromDirectory(listings = flattenDirectory()) {
  // accept: flat rows, {cat,items} groups, or a mix.
  const rows = [];
  for (const item of Array.isArray(listings) ? listings : [listings]) {
    if (item && Array.isArray(item.items)) {
      for (const i of item.items) {
        const r = asListing({ cat: item.cat || item.category, ...i });
        if (r) rows.push(r);
      }
    } else {
      const r = asListing(item);
      if (r) rows.push(r);
    }
  }

  // bucket listings by the topic seed they imply (category match first, then keyword in name/blurb).
  const byTopic = new Map(); // seed.title -> { seed, cat, listings:[] }
  for (const r of rows) {
    let hit = TOPIC_INDEX.find((e) => e.cat && r.cat && e.cat === r.cat);
    if (!hit) {
      const hay = `${r.name} ${r.blurb}`.toLowerCase();
      hit = TOPIC_INDEX.find((e) => hay.includes(e.keyword.toLowerCase()));
    }
    if (!hit) continue;
    const key = hit.seed.title;
    if (!byTopic.has(key)) byTopic.set(key, { seed: hit.seed, cat: hit.cat, listings: [] });
    byTopic.get(key).listings.push(r);
  }

  const out = [];
  for (const { seed, cat, listings: ls } of byTopic.values()) {
    const examples = ls.slice(0, 4).map((l) => l.name).filter(Boolean);
    out.push({
      title: seed.title,
      why:
        `Directory listings under "${cat}" (${examples.join(', ')}${examples.length ? '…' : ''}) ` +
        `imply a reader would want a Library explainer (probe term "${seed.match}").`,
      sources: ls.map((l) => `Directory entry: ${l.name}${l.url ? ` (${l.url})` : ''}`),
      searchTerms: seed.searchTerms,
      ...DIR_TOPIC_DEFAULTS,
      description: seed.description,
      matchedListings: ls.map((l) => ({ name: l.name, url: l.url, cat: l.cat })),
    });
  }
  return out;
}

/**
 * Given a single wiki article topic (a title string, or a topic object with a .title/.searchTerms),
 * return the Directory listings most relevant to it — so a generated wiki article can link out to the
 * curated resources in the Directory ("see also" / further-reading rows). Pure + synchronous, scores by
 * token overlap against each listing's category, name, and blurb. Read-only; never writes the wiki.
 *
 * @param {string|object} articleTopic  a title, or {title, searchTerms?, description?}
 * @param {object} [opts]  { limit=6, directory=DIRECTORY }
 * @returns {Array<{cat, name, url, blurb, score}>}  best-matching Directory rows, highest score first
 */
export function directoryLinksForArticle(articleTopic, opts = {}) {
  const limit = opts.limit ?? 6;
  const rows = opts.directory
    ? (Array.isArray(opts.directory) ? opts.directory : [opts.directory]).flatMap((g) =>
        Array.isArray(g.items) ? g.items.map((i) => ({ cat: g.cat, ...i })) : [g],
      )
    : flattenDirectory();

  // build the query token set from the topic's title + any searchTerms/description.
  const t = typeof articleTopic === 'string' ? { title: articleTopic } : articleTopic || {};
  const queryText = [t.title, ...(t.searchTerms || []), t.description || '']
    .filter(Boolean)
    .join(' ');
  const STOP = new Set(['the', 'and', 'for', 'vs', 'how', 'a', 'an', 'of', 'to', 'on', 'in', 'with', 'crypto']);
  const tokens = (s) =>
    String(s)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w));
  const qset = new Set(tokens(queryText));
  if (!qset.size) return [];

  const scored = [];
  for (const r of rows) {
    const cat = r.cat || '';
    // category tokens weigh 3x (strongest signal), name 2x, blurb 1x.
    let score = 0;
    for (const w of tokens(cat)) if (qset.has(w)) score += 3;
    for (const w of tokens(r.name)) if (qset.has(w)) score += 2;
    for (const w of tokens(r.blurb)) if (qset.has(w)) score += 1;
    if (score > 0) scored.push({ cat, name: r.name, url: r.url, blurb: r.blurb, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// ───────────────────────────────────────────────────────────────────────────
// 3. BRIDGE : run both, return the advisory plan
// ───────────────────────────────────────────────────────────────────────────

/**
 * Run both directions and return the cross-suggestion plan. Best-effort: a failure in either
 * direction yields an empty list for that side rather than throwing.
 *
 * @returns {Promise<{ generatedAt, wikiSite, articlesLive, proposedWikiTopics, proposedDirectoryEntries }>}
 */
export async function bridge() {
  const [proposedWikiTopics, proposedDirectoryEntries, live] = await Promise.all([
    directoryTopicsForWiki().catch(() => []),
    wikiArticlesForDirectory().catch(() => []),
    liveArticles().catch(() => null),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    wikiSite: WIKI_SITE,
    articleSource: live ? 'live-index' : 'disk',
    articlesLive: (live || articlesOnDisk()).length,
    proposedWikiTopics,
    proposedDirectoryEntries,
  };
}

export default bridge;

// ───────────────────────────────────────────────────────────────────────────
// CLI
// ───────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('directory-wiki-bridge.mjs')) {
  const plan = await bridge();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    const line = '─'.repeat(72);
    console.log(line);
    console.log(`DIRECTORY ⇄ WIKI BRIDGE — advisory cross-suggestions (task #163)`);
    console.log(`wiki: ${plan.wikiSite}   live articles: ${plan.articlesLive}`);
    console.log(line);

    console.log(`\n▶ Proposed WIKI topics the Directory implies (${plan.proposedWikiTopics.length})`);
    console.log(`  (paste the topic fields into a #190-style priority array in wikiGenerator.js)`);
    for (const t of plan.proposedWikiTopics) {
      console.log(`\n  • ${t.title}`);
      console.log(`    why: ${t.why}`);
      console.log(`    searchTerms: [${t.searchTerms.map((s) => `'${s}'`).join(', ')}]`);
      console.log(`    sources: ${t.sources.join(' | ')}`);
    }

    console.log(`\n▶ Proposed DIRECTORY rows linking to live wiki articles (${plan.proposedDirectoryEntries.length})`);
    console.log(`  (hand-add good ones under the 'Learn' category in directory.mjs)`);
    for (const e of plan.proposedDirectoryEntries) {
      console.log(`\n  • [${e.cat}] ${e.name}`);
      console.log(`    ${e.url}`);
      console.log(`    ${e.blurb}`);
    }

    console.log(`\n${line}`);
    console.log(
      `${plan.proposedWikiTopics.length} wiki topic(s) + ${plan.proposedDirectoryEntries.length} directory row(s). ` +
        `Advisory only — nothing was written to directory.mjs or the wiki.`,
    );
    console.log(line);
  }
}
