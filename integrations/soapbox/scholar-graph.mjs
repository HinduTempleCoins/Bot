// scholar-graph.mjs — ORCID author profiles (catalog #50) + OpenCitations citation graph (#51).
// Both keyless, open. The "who wrote it / what cites it" layer beside library-catalog's
// "find it" layer — and the PD citation-graph pattern the Legal Knowledge Graph (synthesis §7.3)
// reuses on the CourtListener side.
//
//   ORCID expanded-search — disambiguated researcher profiles (12M+, institution-verified).
//   OpenCitations (COCI)  — open DOI-to-DOI citation edges: what a paper cites, what cites it.
//
// Pattern mirrors library-catalog.mjs: ESM, __setFetch hook, soft-fail (dead source → []/null,
// never throws), CLI guarded by argv check.

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0; +https://soapbox.community)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

async function getJSON(url) {
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function normDOI(d) {
  if (!d) return '';
  return String(d).toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim();
}

// ── ORCID (researcher profiles) ──────────────────────────────────────────────
/**
 * Search researchers by name (ORCID public expanded-search). Returns
 * [{ orcid, name, otherNames, institutions, url }] — [] when none / unreachable.
 */
export async function searchAuthors(name, { limit = 10 } = {}) {
  const q = String(name || '').trim();
  if (!q) return [];
  const u = `https://pub.orcid.org/v3.0/expanded-search/?q=${encodeURIComponent(q)}&rows=${Math.max(1, Math.min(limit, 50))}`;
  const j = await getJSON(u);
  const results = j?.['expanded-result'] || [];
  return results.map((r) => {
    const orcid = r['orcid-id'] || null;
    const name2 = [r['given-names'], r['family-names']].filter(Boolean).join(' ');
    return {
      orcid,
      name: name2 || null,
      otherNames: Array.isArray(r['other-name']) ? r['other-name'].filter(Boolean) : [],
      institutions: Array.isArray(r['institution-name']) ? r['institution-name'].filter(Boolean) : [],
      url: orcid ? `https://orcid.org/${orcid}` : null,
    };
  }).filter((r) => r.orcid && r.name);
}

// ── OpenCitations COCI (DOI citation graph) ──────────────────────────────────
function cociRows(j) {
  if (!Array.isArray(j)) return [];
  return j.map((e) => ({
    citing: normDOI(e.citing) || null,
    cited: normDOI(e.cited) || null,
    creation: e.creation || null, // publication date of the CITING work
  })).filter((e) => e.citing && e.cited);
}

/** Papers that CITE this DOI (incoming edges). [] when none / unreachable. */
export async function citationsOf(doi, { limit = 50 } = {}) {
  const d = normDOI(doi);
  if (!d) return [];
  const j = await getJSON(`https://opencitations.net/index/coci/api/v1/citations/${encodeURIComponent(d)}`);
  return cociRows(j).slice(0, Math.max(1, limit));
}

/** Papers this DOI CITES (outgoing edges / its reference list). [] when none / unreachable. */
export async function referencesOf(doi, { limit = 50 } = {}) {
  const d = normDOI(doi);
  if (!d) return [];
  const j = await getJSON(`https://opencitations.net/index/coci/api/v1/references/${encodeURIComponent(d)}`);
  return cociRows(j).slice(0, Math.max(1, limit));
}

/** Open citation count for a DOI. null when unknown / unreachable. */
export async function citationCount(doi) {
  const d = normDOI(doi);
  if (!d) return null;
  const j = await getJSON(`https://opencitations.net/index/coci/api/v1/citation-count/${encodeURIComponent(d)}`);
  const n = parseInt(j?.[0]?.count, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * One-call graph card for a DOI: { doi, cited: n|null, citedBy: [...], references: [...] }.
 * Bounded fan-out; soft-fails piecewise (each leg independently degrades).
 */
export async function citationCard(doi, { limit = 10 } = {}) {
  const d = normDOI(doi);
  if (!d) return { doi: null, cited: null, citedBy: [], references: [] };
  const [count, citedBy, refs] = await Promise.all([
    citationCount(d).catch(() => null),
    citationsOf(d, { limit }).catch(() => []),
    referencesOf(d, { limit }).catch(() => []),
  ]);
  return { doi: d, cited: count, citedBy, references: refs };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('scholar-graph.mjs')) {
  const arg = process.argv.slice(2).join(' ') || '10.1038/nature12373';
  if (arg.includes('/')) {
    const card = await citationCard(arg);
    console.log(`\nCitation graph for doi:${card.doi}`);
    console.log(`  open citation count: ${card.cited ?? 'unknown'}`);
    console.log(`  cited by (sample): ${card.citedBy.slice(0, 5).map((e) => e.citing).join(', ') || '—'}`);
    console.log(`  references (sample): ${card.references.slice(0, 5).map((e) => e.cited).join(', ') || '—'}`);
  } else {
    const authors = await searchAuthors(arg);
    console.log(`\nORCID: "${arg}" — ${authors.length} profiles`);
    for (const a of authors.slice(0, 10)) console.log(`  ${a.name}  ${a.url}  ${a.institutions.slice(0, 2).join('; ')}`);
  }
}
