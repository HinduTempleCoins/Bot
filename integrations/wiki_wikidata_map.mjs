// wiki_wikidata_map.mjs — "WikiEO": link each Library article to the Wikidata item (and English Wikipedia page)
// about the same thing, so search engines and AI answer engines can tie our pages into the knowledge graph
// (schema.org about/sameAs on the page). Writes site/wiki/wikidata-map.json.
//
//   node integrations/wiki_wikidata_map.mjs            # build from the live article list (network)
//   node integrations/wiki_wikidata_map.mjs --dry      # print matches, write nothing
//
// Deliberately conservative — a wrong sameAs is worse than none:
//   - EXACT English-Wikipedia title match only (after Wikipedia's own normalisation + redirects), no fuzzy search;
//   - disambiguation pages and list pages are skipped;
//   - our own coined names (MELEK, PRANA, KULA, SoapBox, Hathor's pages, …) are never linked, because Wikipedia's
//     page of that name is about something else.
// Reads articles only; never modifies one. Injectable fetch, soft-fail.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.join(__dir, '..', 'site', 'wiki', 'wikidata-map.json');
const WP_API = 'https://en.wikipedia.org/w/api.php';
const UA = 'LibraryOfAshurbanipal-WikiEO/1.0 (https://wiki.soapbox.community)';

// our own names / ecosystem terms: never map to Wikipedia's unrelated page of the same name
export const OWN = /\b(melek|prana|kula|soapbox|soapy|hathor|pentecaust|bifrost|cheetah|ashurbanipal|vkbt|cure|mwali|van ?kush|vkfri|witness school|start here|hierophant|shilpa|almanack|melek-engine|kulaswap)\b/i;
// Reviewed by hand 2026-09-29: the same title on Wikipedia is a different or broader subject than our article.
export const EXCLUDE_SLUGS = {
  Remakes: 'ours = Hathor Studio image remakes; Wikipedia = film remakes',
  Mining: 'ours = proof-of-work mining; Wikipedia = mineral extraction',
  Cloning: 'ours = cloning open-source chain code; Wikipedia = biological cloning',
  Dudael: 'ours = the planned MELEK metaverse; Wikipedia = the Enochic place',
  Glossaries: 'ours = the Library glossary section; Wikipedia = the concept of a glossary',
  Recipes: 'ours = the Institute index of preparations; Wikipedia = the concept of a recipe',
  Imphepho: 'ours = several Helichrysum species; Wikipedia match = one species',
  Edgewood_Arsenal: 'redirects to Aberdeen Proving Ground, a broader subject',
  Chelated_Minerals: 'maps to chelation (the chemistry), broader than the supplements',
  Mystery_Schools: 'maps to Greco-Roman mysteries only; ours is broader',
  Brain_Balance: 'Wikipedia match is a company; ours is not about that company',
};
const SKIP_DESC = /disambiguation page|Wikimedia list article|Wikimedia category|Wikimedia template/i;

let _fetch = globalThis.fetch;
export function __setFetch(f) { _fetch = f; }

/** Wikipedia's sentence case for a Title Case title ("Benefit Societies" → "Benefit societies"); acronyms kept. */
export function sentenceCase(t) {
  const w = String(t).split(' ');
  return [w[0], ...w.slice(1).map((x) => (/^[A-Z][a-z]+$/.test(x) ? x.toLowerCase() : x))].join(' ');
}

/** titles → { title: { qid, wikipedia, description } } via the English Wikipedia API (50 per call): follows
 *  Wikipedia's own normalisation + redirects, skips disambiguation pages, reads the page's Wikidata item. */
export async function matchTitles(titles) {
  const out = {};
  const variants = new Map(); // wikipedia query title -> our title (first wins)
  for (const t of titles) for (const v of [t, sentenceCase(t)]) if (!variants.has(v)) variants.set(v, t);
  const qs = [...variants.keys()];
  for (let i = 0; i < qs.length; i += 50) {
    const batch = qs.slice(i, i + 50);
    const u = `${WP_API}?action=query&titles=${encodeURIComponent(batch.join('|'))}&redirects=1&prop=pageprops|description&ppprop=wikibase_item|disambiguation&format=json&formatversion=2`;
    let j;
    try { const r = await _fetch(u, { headers: { 'user-agent': UA } }); if (!r.ok) continue; j = await r.json(); } catch { continue; }
    const q = j.query || {};
    const hop = new Map();
    for (const n of (q.normalized || [])) hop.set(n.from, n.to);
    for (const n of (q.redirects || [])) hop.set(n.from, n.to);
    const pages = new Map((q.pages || []).map((p) => [p.title, p]));
    for (const v of batch) {
      let t = v; for (let k = 0; k < 3 && hop.has(t); k++) t = hop.get(t);
      const p = pages.get(t);
      if (!p || p.missing || !p.pageprops || p.pageprops.disambiguation !== undefined) continue;
      const qid = p.pageprops.wikibase_item;
      const desc = p.description || '';
      if (!/^Q\d+$/.test(qid || '') || SKIP_DESC.test(desc) || /^List of /.test(p.title)) continue;
      const ours = variants.get(v);
      if (!out[ours]) out[ours] = { qid, wikipedia: p.title, description: desc, via: v === ours ? 'exact' : 'sentence-case' };
    }
  }
  return out;
}

export async function build(articles) {
  const cand = articles.filter((a) => !OWN.test(a.title) && !OWN.test(a.slug) && !EXCLUDE_SLUGS[a.slug]);
  const byTitle = await matchTitles(cand.map((a) => a.title));
  const bySlug = {};
  for (const a of cand) if (byTitle[a.title]) bySlug[a.slug] = byTitle[a.title];
  return { built: new Date().toISOString(), method: 'exact English Wikipedia title (or its sentence case), Wikipedia normalisation + redirects, no disambiguation pages, own names excluded', count: Object.keys(bySlug).length, of: articles.length, bySlug };
}

if (process.argv[1] && process.argv[1].endsWith('wiki_wikidata_map.mjs')) {
  const { __listArticles } = await import('../site/wiki/server.mjs');
  const arts = __listArticles();
  const m = await build(arts);
  for (const [slug, v] of Object.entries(m.bySlug)) console.log(`${slug.padEnd(40)} ${v.qid.padEnd(10)} ${v.wikipedia}  — ${v.description}`);
  console.log(`\n${m.count} of ${m.of} articles matched`);
  if (!process.argv.includes('--dry')) { fs.writeFileSync(OUT, JSON.stringify(m, null, 1) + '\n'); console.log(`wrote ${OUT}`); }
}
