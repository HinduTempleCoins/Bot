// datagov-catalog.mjs — the META-DISCOVERY layer over ALL US open government data. A keyless reader
// over the Data.gov CKAN catalog action API (catalog.data.gov/api/3), which indexes ~300k+
// federal/state/local datasets. Every other gov reader in SoapBox hits ONE source; this one lets a
// user find ANY dataset across the whole government, then follow its (often keyless) resource links.
//
// This is deliberately a SEARCH/DISCOVERY layer, not a per-dataset client: it answers "is there a
// dataset about X, who publishes it, and where do I download it" — then hands off to gov-readers.mjs
// (Socrata/CKAN/etc.) for the actual rows.
//
// CKAN action API (all keyless, GET):
//   /api/3/action/package_search   — full-text dataset search (+ facets, + fq filters)
//   /api/3/action/package_show      — one dataset's full record (resources, formats, org)
//   /api/3/action/organization_list — publishing organizations
//
// Conventions (mirrors gov-readers.mjs / fcc-broadband.mjs):
//   • ESM, injectable fetch (__setFetch), keyless (CKAN needs no key — NO secrets),
//   • SOFT-FAILS to [] / null / {} on any error, non-ok response, or bad shape — NEVER throws,
//   • escapes ALL source-controlled text before HTML, and stamps an as-of date in dataNote().
//
//   import { searchDatasets, datasetDetail, organizations, facets, summary,
//            renderPage, dataNote, escapeHtml } from './datagov-catalog.mjs'
//   node integrations/soapbox/datagov-catalog.mjs search "climate"

const BASE = 'https://catalog.data.gov/api/3/action';
const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const clamp = (v, lo, hi, dflt) => Math.max(lo, Math.min(hi, num(v) || dflt));

// Escape source-controlled text before it lands in HTML. Mirrors the project convention.
export function escapeHtml(s) {
  return str(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// CKAN wraps every result in { success, result }. Pull result out, or null on a failed envelope.
async function ckan(path, params = {}) {
  try {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') p.set(k, String(v));
    }
    const qs = p.toString();
    const url = `${BASE}/${path}${qs ? `?${qs}` : ''}`;
    const r = await _fetch(url, { headers: { ...UA, Accept: 'application/json' } });
    if (!r || !r.ok) return null;
    const j = await r.json();
    if (!j || j.success === false) return null;
    return j.result ?? null;
  } catch { return null; }
}

// Normalize one CKAN package (dataset) into our flat shape.
function normalizePackage(pkg) {
  if (!pkg || typeof pkg !== 'object') return null;
  const resources = (Array.isArray(pkg.resources) ? pkg.resources : []).map((rsrc) => ({
    name: str(rsrc?.name) || str(rsrc?.description) || str(rsrc?.format) || 'resource',
    format: str(rsrc?.format).toUpperCase(),
    url: str(rsrc?.url),
  })).filter((rsrc) => rsrc.url || rsrc.name);
  const formats = [...new Set(resources.map((rsrc) => rsrc.format).filter(Boolean))];
  const org = str(pkg.organization?.title || pkg.organization?.name);
  const name = str(pkg.name);
  return {
    title: str(pkg.title) || name,
    name,
    org,
    notes: str(pkg.notes),
    formats,
    resources,
    url: name ? `https://catalog.data.gov/dataset/${encodeURIComponent(name)}` : '',
  };
}

// ── searchDatasets — full-text search across the whole catalog ───────────────────────────────────────
// q: free text. org: filter to a publishing org (CKAN org "name" slug). format: filter to a resource
// format (e.g. CSV, JSON, API). limit: rows. Soft-fails to [].
export async function searchDatasets({ q = '', org = '', format = '', limit = 25 } = {}) {
  const fq = [];
  if (str(org)) fq.push(`organization:"${str(org)}"`);
  if (str(format)) fq.push(`res_format:"${str(format).toUpperCase()}"`);
  const result = await ckan('package_search', {
    q: str(q),
    fq: fq.join(' '),
    rows: clamp(limit, 1, 100, 25),
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  return rows.map(normalizePackage).filter((p) => p && (p.title || p.name));
}

// ── datasetDetail — one dataset's full record by id/name ─────────────────────────────────────────────
// Returns the normalized package (with all resources) or null.
export async function datasetDetail(id) {
  const key = str(id);
  if (!key) return null;
  const result = await ckan('package_show', { id: key });
  return normalizePackage(result);
}

// ── organizations — publishing orgs (who puts out gov data) ──────────────────────────────────────────
// organization_list returns an array of org "name" slugs. Soft-fails to [].
export async function organizations({ limit = 100 } = {}) {
  const result = await ckan('organization_list', { all_fields: 'false', limit: clamp(limit, 1, 1000, 100) });
  if (!Array.isArray(result)) return [];
  return result.map(str).filter(Boolean).slice(0, clamp(limit, 1, 1000, 100));
}

// ── facets — the format/org/group breakdown for a query, to power filter UI ───────────────────────────
// Asks package_search for facets and normalizes them into { formats:[{name,count}], orgs:[...], groups:[...] }.
export async function facets({ q = '' } = {}) {
  const result = await ckan('package_search', {
    q: str(q),
    rows: 0,
    'facet.field': '["res_format","organization","groups"]',
    'facet.limit': 25,
  });
  const fmap = result?.search_facets || result?.facets || {};
  const pick = (key) => {
    const items = fmap?.[key]?.items;
    if (Array.isArray(items)) {
      return items.map((it) => ({ name: str(it?.display_name || it?.name), count: num(it?.count) || 0 }))
        .filter((it) => it.name);
    }
    // legacy facets shape: { value: count }
    const obj = fmap?.[key];
    if (obj && typeof obj === 'object') {
      return Object.entries(obj).map(([name, count]) => ({ name: str(name), count: num(count) || 0 }))
        .filter((it) => it.name);
    }
    return [];
  };
  return { formats: pick('res_format'), orgs: pick('organization'), groups: pick('groups') };
}

// ── summary — tally a result set: count + top formats + top orgs ─────────────────────────────────────
export function summary(results = []) {
  const rows = Array.isArray(results) ? results : [];
  const fcount = {};
  const ocount = {};
  for (const p of rows) {
    for (const f of (Array.isArray(p?.formats) ? p.formats : [])) {
      if (f) fcount[f] = (fcount[f] || 0) + 1;
    }
    if (p?.org) ocount[p.org] = (ocount[p.org] || 0) + 1;
  }
  const top = (m) => Object.entries(m).sort((a, b) => b[1] - a[1])
    .slice(0, 10).map(([name, count]) => ({ name, count }));
  return { count: rows.length, topFormats: top(fcount), topOrgs: top(ocount) };
}

// ── provenance note ───────────────────────────────────────────────────────────────────────────────────
export function dataNote() {
  const asOf = new Date().toISOString().slice(0, 10);
  return `Source: Data.gov CKAN catalog (catalog.data.gov), as of ${asOf}. ` +
    `A discovery index of ~300,000+ federal, state, and local datasets — listings describe each dataset; ` +
    `download/API links point to the publishing agency, whose own terms and freshness apply.`;
}

// ── renderPage — escaped HTML dataset results list with resource download links ───────────────────────
// data: { results, query, summary } (any optional). EVERY interpolated value is escaped.
export function renderPage(data = {}) {
  const results = Array.isArray(data.results) ? data.results : [];
  const sum = data.summary || summary(results);
  const query = str(data.query);

  const items = results.map((p) => {
    const links = (Array.isArray(p.resources) ? p.resources : []).slice(0, 8).map((rsrc) => {
      const label = `${escapeHtml(rsrc.name)}${rsrc.format ? ` (${escapeHtml(rsrc.format)})` : ''}`;
      return rsrc.url
        ? `<li><a href="${escapeHtml(rsrc.url)}" rel="noopener noreferrer">${label}</a></li>`
        : `<li>${label}</li>`;
    }).join('');
    const titleHtml = p.url
      ? `<a href="${escapeHtml(p.url)}" rel="noopener noreferrer">${escapeHtml(p.title)}</a>`
      : escapeHtml(p.title);
    const formatsLine = (Array.isArray(p.formats) && p.formats.length)
      ? `<p class="formats">Formats: ${p.formats.map(escapeHtml).join(', ')}</p>` : '';
    return `<article class="dataset">
    <h3>${titleHtml}</h3>
    ${p.org ? `<p class="org">Published by ${escapeHtml(p.org)}</p>` : ''}
    ${p.notes ? `<p class="notes">${escapeHtml(p.notes.slice(0, 400))}</p>` : ''}
    ${formatsLine}
    ${links ? `<ul class="resources">${links}</ul>` : ''}
  </article>`;
  }).join('');

  const head = query
    ? `<p class="query">${escapeHtml(sum.count)} dataset(s) for &ldquo;${escapeHtml(query)}&rdquo;.</p>`
    : `<p class="query">${escapeHtml(sum.count)} dataset(s).</p>`;

  return `<section class="datagov-catalog">
  <h2>Find any US government dataset</h2>
  ${head}
  ${items || '<p class="empty">No datasets found.</p>'}
  <p class="note">${escapeHtml(dataNote())}</p>
</section>`;
}

// CLI:  node integrations/soapbox/datagov-catalog.mjs <search|detail|orgs|facets> <arg>
if (process.argv[1] && process.argv[1].endsWith('datagov-catalog.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest.join(' ');
  if (cmd === 'search') {
    const rows = await searchDatasets({ q: arg || 'climate' });
    console.log(`\n== datasets (${rows.length}) for "${arg || 'climate'}" ==`);
    for (const p of rows.slice(0, 15)) {
      console.log(`  • ${p.title}  [${p.org}]  formats: ${p.formats.join(', ') || '—'}`);
    }
    console.log(`\n${dataNote()}`);
  } else if (cmd === 'detail') {
    const p = await datasetDetail(arg);
    console.log(p ? JSON.stringify(p, null, 2) : 'not found');
  } else if (cmd === 'orgs') {
    const orgs = await organizations({ limit: 50 });
    console.log(`\n== orgs (${orgs.length}) ==`);
    for (const o of orgs) console.log('  •', o);
  } else if (cmd === 'facets') {
    console.log(JSON.stringify(await facets({ q: arg }), null, 2));
  } else {
    console.log('usage: datagov-catalog.mjs <search|detail|orgs|facets> <arg>');
  }
}
