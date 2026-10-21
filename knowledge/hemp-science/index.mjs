// knowledge/hemp-science/index.mjs — the registry for the MELEK hemp & cannabinoid SCIENCE section.
//
// WHAT THIS IS. Eleven shelf modules, each a frozen data structure of wiki pages, assembled here into
// one addressable corpus. The web surface (integrations/hemp-science.mjs) renders it; the interaction
// checker (integrations/interactions.mjs) shares its mechanism vocabulary; and `build` emits a flat
// JSON copy of every shelf into this same directory so that corpus-rag (integrations/corpus-rag.mjs)
// and the library index pick the material up with no further registration — corpus-rag keeps .json
// and .md and ignores .mjs, so the generated JSON is how this content reaches Hathor's recall path.
//
// WHY .mjs AS THE SOURCE OF TRUTH AND .json AS THE ARTIFACT. The pages carry structure the readers
// do not need but the renderer does: per-section citations, `contested` flags, evidence grades,
// tables, cross-links. Keeping that in ESM lets the tests enforce it (every cite key must resolve,
// every contested section must carry a caveat, the whole corpus must be free of preparative
// procedure). A hand-maintained JSON copy would drift; a generated one cannot.
//
// THE ONE EDITORIAL RULE THIS SECTION ENFORCES IN CODE. This is a research and harm-reduction
// library, so it teaches separation, purification, formulation, dosing arithmetic and analytics with
// real parameters. It does NOT carry preparative routes to intoxicating cannabinoids — no reagents,
// catalysts, equivalents, conditions or yields for isomerising CBD or homologating a side chain. That
// boundary is narrow, deliberate, and asserted by a test (see hemp-science.test.mjs), not by trust.
//
// House style: ESM, no side effects on import, soft-fail-never-throw, CLI guarded.
//
//   import { SHELVES, shelf, page, search, matrix } from './knowledge/hemp-science/index.mjs';
//   node knowledge/hemp-science/index.mjs build      # regenerate the .json shelves + matrix
//   node knowledge/hemp-science/index.mjs stats

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as botanicals from './botanicals.mjs';
import * as cannabinoids from './cannabinoids.mjs';
import * as coa from './coa.mjs';
import * as cyp450 from './cyp450.mjs';
import * as endocannabinoid from './endocannabinoid.mjs';
import * as formulation from './formulation.mjs';
import * as processing from './processing.mjs';
import * as products from './products.mjs';
import * as regulatory from './regulatory.mjs';
import * as safety from './safety.mjs';
import * as terpenes from './terpenes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The section's own framing. Rendered at the top of the index and in llms.txt. */
export const SECTION = Object.freeze({
  id: 'hemp-science',
  title: 'Hemp & Cannabinoid Science',
  blurb: 'A research reference for the hemp industry: enzyme pharmacology, terpene and cannabinoid '
    + 'chemistry, extraction and purification, formulation and dosing safety, analytics, and the '
    + 'regulatory argument — sourced, cross-linked, and honest about what is not known.',
  posture: 'Education and harm reduction. Not medical, legal or financial advice. Every factual claim '
    + 'carries a source; contested and single-source claims are marked as such on the page.',
  // Stated once, prominently, because it is the section's defining editorial choice.
  boundary: 'This section teaches separation, purification, formulation, dosing arithmetic and '
    + 'analytical chemistry with real parameters, because withholding that detail from someone who '
    + 'will proceed anyway is the harm this library exists to prevent. It does not publish '
    + 'preparative routes for converting one cannabinoid into a more intoxicating one; those are '
    + 'described structurally and cited to the literature, without procedures.',
});

/** MODULES — the shelf modules in reading order. Order is the section's curriculum. */
const MODULES = Object.freeze([
  cannabinoids, terpenes, endocannabinoid, botanicals,
  cyp450, processing, products,
  formulation, safety, coa, regulatory,
]);

/** SHELVES — [{ id, title, blurb, updated, pages, cites }] */
export const SHELVES = Object.freeze(MODULES.map((m) => Object.freeze({
  ...(m.SHELF || {}),
  pages: Object.freeze(Array.isArray(m.PAGES) ? m.PAGES : []),
  cites: Object.freeze({ ...(m.CITES || {}) }),
})));

/** SHELF_IDS — stable ids, useful for tests and sitemaps. */
export const SHELF_IDS = Object.freeze(SHELVES.map((s) => s.id));

const _shelfById = new Map(SHELVES.map((s) => [s.id, s]));

/** shelf(id) — one shelf, or null. Never throws. */
export function shelf(id) {
  return _shelfById.get(String(id == null ? '' : id).trim().toLowerCase()) || null;
}

/** page(shelfId, slug) — one page with its shelf attached, or null. Never throws. */
export function page(shelfId, slug) {
  const s = shelf(shelfId);
  if (!s) return null;
  const want = String(slug == null ? '' : slug).trim().toLowerCase();
  const p = s.pages.find((x) => String(x.slug).toLowerCase() === want);
  return p ? Object.freeze({ ...p, shelfId: s.id, shelfTitle: s.title }) : null;
}

/** allPages() — every page in the section, shelf-tagged, in curriculum order. */
export function allPages() {
  const out = [];
  for (const s of SHELVES) for (const p of s.pages) out.push(Object.freeze({ ...p, shelfId: s.id, shelfTitle: s.title }));
  return Object.freeze(out);
}

/** paths() — every routable path under the section, for sitemaps and link checks. */
export function paths() {
  const out = ['/science', '/science/check', '/science/matrix.json'];
  for (const s of SHELVES) {
    out.push(`/science/${s.id}`);
    for (const p of s.pages) out.push(`/science/${s.id}/${p.slug}`);
  }
  return Object.freeze(out);
}

// ── citations ─────────────────────────────────────────────────────────────────────────────────────

/** cite(shelfId, key) — resolve one citation record from a shelf's own bibliography, or null. */
export function cite(shelfId, key) {
  const s = shelf(shelfId);
  if (!s) return null;
  const c = s.cites[key];
  return c ? Object.freeze({ key, ...c }) : null;
}

/** citeUrl(record) — a resolvable link for a citation, or ''. DOI first, then url, then PubMed. */
export function citeUrl(c) {
  if (!c) return '';
  if (c.doi) return `https://doi.org/${c.doi}`;
  if (c.url) return String(c.url);
  if (c.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/`;
  return '';
}

/**
 * citeText(record) — a one-line rendering. An unverified record is MARKED, always. A citation whose
 * identifier we could not confirm is still worth publishing; passing it off as verified is not.
 */
export function citeText(c) {
  if (!c) return '';
  const bits = [c.authors, c.year ? `(${c.year})` : '', c.title, c.journal].filter(Boolean);
  const line = bits.join(' ').replace(/\s+/g, ' ').trim();
  return c.verified === false ? `${line} [identifier unverified]` : line;
}

/** allCites() — every citation in the section, shelf-tagged. */
export function allCites() {
  const out = [];
  for (const s of SHELVES) for (const [key, rec] of Object.entries(s.cites)) out.push(Object.freeze({ shelfId: s.id, key, ...rec }));
  return Object.freeze(out);
}

// ── search ────────────────────────────────────────────────────────────────────────────────────────

/** pageText(p) — all the searchable prose of a page, flattened. */
export function pageText(p) {
  if (!p) return '';
  const bits = [p.title, p.summary];
  for (const [k, v] of Object.entries(p.facts || {})) bits.push(k, String(v));
  for (const sec of p.sections || []) {
    bits.push(sec.h, sec.body, sec.caveat);
    for (const b of sec.bullets || []) bits.push(b);
    if (sec.table) {
      for (const c of sec.table.cols || []) bits.push(c);
      for (const row of sec.table.rows || []) for (const cell of row) bits.push(String(cell));
    }
  }
  return bits.filter(Boolean).join(' ');
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'not', 'but', 'its', 'has', 'was', 'what', 'which', 'when', 'than', 'into', 'their', 'more', 'also', 'any', 'can', 'how']);

/**
 * search(q, { limit }) — a small term-frequency search over the section. Deliberately simple and
 * fully local: no embeddings, no network, deterministic. Returns [] on anything unusable.
 */
export function search(q, { limit = 20 } = {}) {
  try {
    const terms = String(q == null ? '' : q).toLowerCase().match(/[a-z0-9µβδαγΔβ-]{2,}/g) || [];
    const kept = terms.filter((t) => !STOP.has(t));
    if (!kept.length) return [];
    const scored = [];
    for (const p of allPages()) {
      const hay = pageText(p).toLowerCase();
      const title = String(p.title).toLowerCase();
      let score = 0;
      const matched = [];
      for (const t of kept) {
        const n = hay.split(t).length - 1;
        if (n > 0) { score += n; matched.push(t); }
        if (title.includes(t)) score += 25;
        if (String(p.slug).includes(t)) score += 15;
      }
      if (score > 0) scored.push({ shelfId: p.shelfId, slug: p.slug, title: p.title, summary: p.summary, score, matched: Object.freeze(matched), of: kept.length });
    }
    return Object.freeze(scored.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug)).slice(0, Math.max(1, limit)).map(Object.freeze));
  } catch { return []; }
}

// ── the machine-readable CYP interaction matrix ───────────────────────────────────────────────────

/**
 * matrix() — the published interaction matrix, derived from cyp450.ENZYMES so the data and the pages
 * cannot disagree. Served as /science/matrix.json and written to cyp_interaction_matrix.json.
 *
 * `absenceIsNotSafety` is in the payload and not merely in the docs, because a consumer of this JSON
 * is exactly the reader most likely to treat a missing row as a clean result.
 */
export function matrix() {
  const enzymes = [];
  try {
    for (const [id, e] of Object.entries(cyp450.ENZYMES || {})) {
      const norm = (arr, role) => (Array.isArray(arr) ? arr : []).map((x) => Object.freeze({
        name: x.name, kind: x.kind || 'drug', role, potency: x.potency || 'unclear',
        mechanismBased: !!x.mechanismBased, note: x.note || '',
        cites: Object.freeze((x.cites || []).map((k) => {
          const c = cyp450.CITES?.[k];
          return Object.freeze({ key: k, text: citeText(c ? { key: k, ...c } : null), url: citeUrl(c) });
        })),
      }));
      enzymes.push(Object.freeze({
        id, name: e.name || id, page: `/science/cyp450/${e.slug || id}`,
        substrates: Object.freeze((e.substrates || []).map((x) => Object.freeze({
          name: x.name, nti: !!x.nti, note: x.note || '',
          cites: Object.freeze((x.cites || []).map((k) => String(k))),
        }))),
        inhibitors: Object.freeze(norm(e.inhibitors, 'inhibits')),
        inducers: Object.freeze(norm(e.inducers, 'induces')),
      }));
    }
  } catch { /* soft-fail: an empty matrix is honest, a thrown matrix is a broken page */ }
  return Object.freeze({
    schema: 'melek-hemp-science/cyp-interaction-matrix/1',
    generatedFrom: 'knowledge/hemp-science/cyp450.mjs',
    updated: (cyp450.SHELF && cyp450.SHELF.updated) || '',
    absenceIsNotSafety: true,
    statement: 'A substance or pair absent from this matrix was NOT checked and is NOT thereby safe. '
      + 'This is a curated mechanism table from primary literature and regulatory reference works, not '
      + 'a comprehensive interaction database, and it is not a substitute for a clinician or pharmacist.',
    potencyDefinitions: Object.freeze({
      strong: 'causes a >=5-fold increase in AUC of a sensitive substrate (FDA classification)',
      moderate: 'causes a >=2-fold but <5-fold increase in AUC',
      weak: 'causes a >=1.25-fold but <2-fold increase in AUC',
      variable: 'reported effect differs substantially between studies or preparations',
      unclear: 'direction known, magnitude not established in humans',
    }),
    enzymes: Object.freeze(enzymes),
  });
}

// ── generated artifacts ───────────────────────────────────────────────────────────────────────────

/**
 * shelfJson(shelfId) — a flat, prose-shaped JSON copy of one shelf for the recall path. corpus-rag
 * scores a JSON doc on its VALUES, so this shape deliberately puts the prose in the values and keeps
 * the keys short.
 */
export function shelfJson(shelfId) {
  const s = shelf(shelfId);
  if (!s) return null;
  const out = {
    title: `${SECTION.title} — ${s.title}`,
    section: SECTION.title,
    shelf: s.id,
    blurb: s.blurb,
    updated: s.updated,
    posture: SECTION.posture,
    generatedFrom: `knowledge/hemp-science/${s.id}.mjs`,
    pages: {},
  };
  for (const p of s.pages) {
    const body = [];
    for (const sec of p.sections || []) {
      const parts = [sec.h, sec.body].filter(Boolean);
      for (const b of sec.bullets || []) parts.push(`- ${b}`);
      if (sec.table) {
        parts.push((sec.table.cols || []).join(' | '));
        for (const row of sec.table.rows || []) parts.push(row.join(' | '));
      }
      if (sec.contested) parts.push(`CONTESTED: ${sec.caveat || 'disputed or single-source claim'}`);
      if (sec.evidence) parts.push(`Evidence: ${sec.evidence}`);
      const cites = (sec.cites || []).map((k) => citeText(cite(s.id, k))).filter(Boolean);
      if (cites.length) parts.push(`Sources: ${cites.join('; ')}`);
      body.push(parts.join('\n'));
    }
    out.pages[p.slug] = {
      title: p.title,
      summary: p.summary,
      facts: { ...(p.facts || {}) },
      text: body.join('\n\n'),
      path: `/science/${s.id}/${p.slug}`,
    };
  }
  return out;
}

/** build({ dir }) — write the generated JSON shelves and the matrix. Returns the files written. */
export function build({ dir = HERE } = {}) {
  const written = [];
  for (const s of SHELVES) {
    const f = join(dir, `${s.id}.json`);
    try { writeFileSync(f, `${JSON.stringify(shelfJson(s.id), null, 1)}\n`); written.push(f); } catch { /* soft-fail */ }
  }
  const mf = join(dir, 'cyp_interaction_matrix.json');
  try { writeFileSync(mf, `${JSON.stringify(matrix(), null, 1)}\n`); written.push(mf); } catch { /* soft-fail */ }
  return written;
}

/** stats() — a quick shape report, used by the tests and the CLI. */
export function stats() {
  const pages = allPages();
  const cites = allCites();
  let sections = 0; let contested = 0; let withCites = 0;
  for (const p of pages) for (const sec of p.sections || []) {
    sections += 1;
    if (sec.contested) contested += 1;
    if ((sec.cites || []).length) withCites += 1;
  }
  return Object.freeze({
    shelves: SHELVES.length,
    pages: pages.length,
    sections,
    sectionsWithCites: withCites,
    contestedSections: contested,
    cites: cites.length,
    unverifiedCites: cites.filter((c) => c.verified === false).length,
    words: pages.reduce((a, p) => a + pageText(p).split(/\s+/).filter(Boolean).length, 0),
  });
}

export default { SECTION, SHELVES, SHELF_IDS, shelf, page, allPages, paths, search, matrix, build, stats };

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2] || 'stats';
  if (cmd === 'build') {
    const files = build();
    console.log(`wrote ${files.length} files:`);
    for (const f of files) console.log(`  ${f.replace(`${HERE}/`, '')}`);
  } else if (cmd === 'paths') {
    for (const p of paths()) console.log(p);
  } else {
    console.log(JSON.stringify(stats(), null, 2));
  }
}
