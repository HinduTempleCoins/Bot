// our-search.mjs — "our own Google": ONE federated search the local AI, the API AIs, and the
// brief/annal writers call to search everything WE have at once.
//
// Operator (2026-06-09): "All of our Webpages and like Aggregated stuff and Search stuff that is
// like our own Google and Searches our own stuff too, should be used by the APIs and Local AI."
// We had FIVE separate engines and nothing tied them together; the writers called none. This is the
// single front door.
//
// Federates (each is best-effort, soft-fails to [] — a dead source never breaks the search):
//   library     integrations/library-index.catalogLookup  — our committed corpus (instant, no model)
//   librarySem   integrations/library-index.recall          — semantic corpus recall (if vector index built)
//   wiki         integrations/library-rag.retrieve          — Library of Ashurbanipal wiki passages
//   cheetah      integrations/cheetah-search.findSources     — Cheetah's source matcher
//   aggregator   integrations/aggregator-directory.VERTICALS — our SoapBox verticals ("our pages")
//
// Uniform hit shape: { source, title, link, snippet, score, domain? }. score is normalized 0..1 by
// in-source rank so heterogeneous engines merge fairly. READ-ONLY, no keys, never throws.
//
//   import { search } from './our-search.mjs';
//   const { hits, bySource } = await search('graphene witness curation', { k: 8 });
//
// CLI:  node integrations/our-search.mjs "ayahuasca MAOI safety"  [--domain=healer] [--k=8]

// ── injectable sources (tests set fakes; default = the real modules, defensively imported) ──────
let _sources = null;
export function __setSources(obj) { _sources = obj && typeof obj === 'object' ? obj : null; }

function rankNorm(list) {
  // assign score = (n - i) / n by position so each source contributes comparable 0..1 scores.
  const n = list.length || 1;
  return list.map((h, i) => ({ ...h, score: h.score != null ? h.score : (n - i) / n }));
}

// Default federated sources. Each: async (query, opts) => uniform-hit[]. Defensive dynamic imports so
// a missing/broken module is just an empty source, never a crash.
function defaultSources() {
  return {
    library: async (q, { domain = null, k = 6 } = {}) => {
      try {
        const { catalogLookup } = await import('./library-index.mjs');
        return rankNorm(catalogLookup(q, { domain, k }).map((h) => ({
          source: 'library', domain: h.domain, title: h.title,
          link: h.path, snippet: (h.keywords || []).slice(0, 8).join(', '),
        })));
      } catch { return []; }
    },
    librarySem: async (q, { domain = null, k = 6 } = {}) => {
      try {
        const { recall } = await import('./library-index.mjs');
        const hits = await recall(q, { domain, k });
        return (hits || []).map((h) => ({
          source: 'library-semantic', domain: h.domain, title: h.relPath,
          link: h.relPath, snippet: (h.text || '').slice(0, 200), score: h.score,
        }));
      } catch { return []; }
    },
    wiki: async (q, { k = 4 } = {}) => {
      try {
        const { retrieve } = await import('./library-rag.mjs');
        const passages = await retrieve(q, { topK: k });
        return rankNorm((passages || []).map((p) => ({
          source: 'wiki', title: p.title, link: p.url,
          snippet: (p.snippet || p.text || '').slice(0, 200),
        })));
      } catch { return []; }
    },
    cheetah: async (q, { k = 6 } = {}) => {
      try {
        const { findSources } = await import('./cheetah-search.mjs');
        const m = await findSources(q, { max: k });
        return (m || []).map((r) => ({
          source: `cheetah:${r.source || 'web'}`, title: r.title, link: r.url,
          snippet: (r.snippet || '').slice(0, 200), score: r.similarity,
        }));
      } catch { return []; }
    },
    aggregator: async (q, { k = 4 } = {}) => {
      try {
        const mod = await import('./aggregator-directory.mjs');
        const terms = (String(q || '').toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []);
        const scored = (mod.VERTICALS || []).map((v) => {
          const hay = `${v.id} ${v.label}`.toLowerCase();
          const hits = terms.filter((t) => hay.includes(t)).length;
          return { v, hits };
        }).filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits).slice(0, k);
        return rankNorm(scored.map(({ v }) => ({
          source: 'aggregator', title: `${v.label} (our SoapBox vertical)`,
          link: `data.soapbox.community#${v.id}`, snippet: `Our own aggregated ${v.label} page.`,
        })));
      } catch { return []; }
    },
  };
}

/**
 * Search everything we have. Fans out to all sources in parallel, soft-fails per source, merges +
 * dedupes by link||title, returns the top-k merged hits plus a per-source breakdown. Never throws.
 * @param {string} query
 * @param {{ k?: number, domain?: string|null, only?: string[] }} [opts]
 * @returns {Promise<{ query, hits, bySource }>}
 */
export async function search(query, { k = 8, domain = null, only = null } = {}) {
  const q = String(query || '').trim();
  if (!q) return { query: q, hits: [], bySource: {} };
  const sources = _sources || defaultSources();
  const names = Object.keys(sources).filter((n) => !only || only.includes(n));

  const settled = await Promise.all(names.map(async (n) => {
    try { return [n, (await sources[n](q, { domain, k })) || []]; }
    catch { return [n, []]; }
  }));

  const bySource = {};
  const merged = [];
  const seen = new Set();
  for (const [n, hits] of settled) {
    bySource[n] = hits;
    for (const h of hits) {
      const key = (h.link || h.title || '').toString().replace(/\/+$/, '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(h);
    }
  }
  merged.sort((a, b) => (b.score || 0) - (a.score || 0));
  return { query: q, hits: merged.slice(0, k), bySource };
}

/** Plain-text block for prompt injection — what the writers paste into a brief's research context. */
export function formatForPrompt({ hits } = { hits: [] }) {
  return (hits || []).map((h) => `- [${h.source}] ${h.title}${h.link ? ` <${h.link}>` : ''}${h.snippet ? ` — ${h.snippet}` : ''}`).join('\n');
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('our-search.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (name, def) => { const f = argv.find((a) => a.startsWith(`--${name}=`)); return f ? f.split('=')[1] : def; };
  const q = argv.filter((a) => !a.startsWith('--')).join(' ');
  if (!q) { console.error('usage: our-search.mjs "<query>" [--domain=X] [--k=N] [--only=library,wiki]'); process.exit(1); }
  const only = flag('only', null);
  const res = await search(q, { k: Number(flag('k', 8)), domain: flag('domain', null), only: only ? only.split(',') : null });
  console.log(`search "${res.query}" — ${res.hits.length} merged hits:\n`);
  console.log(formatForPrompt(res));
  console.log(`\nby source: ${Object.entries(res.bySource).map(([n, h]) => `${n}:${h.length}`).join('  ')}`);
}
