// verticals.mjs — data-driven registry that turns the built "vertical" integration modules
// (energy, weather, cams, …) into Data-site pages from ONE dispatch (queue #125). Each entry
// declares its path/title/nav label + a `kind` and a `render(query?)` that:
//   1. dynamically imports its integration module (soft-fail — a missing/throwing module yields a
//      friendly "temporarily unavailable" card, never an exception),
//   2. calls the module's summary/search function,
//   3. returns the INNER HTML body string (the server wraps it in layout()).
//
// Everything is escaped. No function here throws: render() is wrapped so even an unexpected upstream
// error degrades to the unavailable card. The renderers are intentionally generic — they walk the
// (heterogeneous) data each module returns and present it as escaped cards/tables — so the page keeps
// working as the underlying module shapes evolve.
//
// We reuse render.mjs's `esc`/`card` look. If render.mjs ever stops exporting them this file falls
// back to local equivalents, so it can be unit-tested in isolation without the full layout.

import * as render from './render.mjs';

const esc = typeof render.esc === 'function'
  ? render.esc
  : (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const card = typeof render.card === 'function'
  ? render.card
  : (title, inner) => `<div class=card>${title ? `<h2>${esc(title)}</h2>` : ''}${inner}</div>`;

const muted = (s) => `<span class=muted>${esc(s)}</span>`;

const unavailableCard = (title, why = '') => card(
  `${title} — temporarily unavailable`,
  `<p class=muted>This data source is temporarily unavailable${why ? ` (${esc(why)})` : ''}. It usually needs a free upstream API key or the upstream service to respond — please try again shortly.</p>`,
);

// ── generic value rendering ───────────────────────────────────────────────────────────────────────
// Walk arbitrary JSON (objects/arrays/scalars) and present it as escaped, readable HTML. This is what
// keeps every vertical resilient to module-shape drift: we never assume specific keys.

const titleize = (k) => String(k).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const isUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s.trim());

function scalarHtml(v) {
  if (v == null) return muted('—');
  if (isUrl(v)) return `<a href="${esc(v)}" target=_blank rel="noopener nofollow">${esc(v)}</a>`;
  if (typeof v === 'boolean') return v ? '✓ yes' : '✗ no';
  return esc(v);
}

// One object → a definition-style key/value block (skips empty arrays/objects, caps depth).
function objHtml(obj, depth = 0) {
  const rows = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    rows.push(
      `<div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid var(--line)">`
      + `<span><b>${esc(titleize(k))}</b></span>`
      + `<span style="text-align:right;max-width:70%">${valueHtml(v, depth + 1)}</span></div>`,
    );
  }
  return rows.join('') || muted('No data.');
}

function arrayHtml(arr, depth = 0) {
  if (depth > 4) return muted(`${arr.length} item(s)`);
  const items = arr.slice(0, 50);
  const html = items.map((it) => `<li style="margin:6px 0">${valueHtml(it, depth + 1)}</li>`).join('');
  const more = arr.length > items.length ? `<li class=muted>…and ${arr.length - items.length} more</li>` : '';
  return `<ul style="margin:6px 0;padding-left:18px">${html}${more}</ul>`;
}

function valueHtml(v, depth = 0) {
  if (depth > 6) return muted('…');
  if (v == null) return muted('—');
  if (Array.isArray(v)) return arrayHtml(v, depth);
  if (typeof v === 'object') return objHtml(v, depth);
  return scalarHtml(v);
}

// Render a whole summary object as a set of cards: top-level scalar fields go in a lead card, and each
// sub-object/array becomes its own titled card. Always returns a non-empty string.
function summaryCards(data, fallbackTitle) {
  if (data == null) return unavailableCard(fallbackTitle);
  if (typeof data !== 'object') return card(fallbackTitle, `<p>${scalarHtml(data)}</p>`);
  if (Array.isArray(data)) {
    return data.length ? card(fallbackTitle, valueHtml(data)) : unavailableCard(fallbackTitle);
  }

  const scalars = {};
  const blocks = [];
  for (const [k, v] of Object.entries(data)) {
    if (v != null && typeof v === 'object' && (Array.isArray(v) ? v.length : Object.keys(v).length)) {
      blocks.push([k, v]);
    } else if (v != null) {
      scalars[k] = v;
    }
  }
  const lead = Object.keys(scalars).length ? card(fallbackTitle, objHtml(scalars)) : '';
  const rest = blocks.map(([k, v]) => card(titleize(k), valueHtml(v))).join('');
  const out = lead + rest;
  return out || unavailableCard(fallbackTitle);
}

// ── search form ────────────────────────────────────────────────────────────────────────────────────
function searchForm(path, { placeholder = 'Search…', value = '', label = 'Search' } = {}) {
  return `<form method=get action="${esc(path)}" style="margin:0 0 14px">`
    + `<input class=search name=q placeholder="${esc(placeholder)}" value="${esc(value)}" autocomplete=off aria-label="${esc(label)}" style="max-width:480px">`
    + ` <button class=iconbtn type=submit>${esc(label)}</button></form>`;
}

// Soft dynamic import: returns the module, or null if it can't be loaded.
async function loadModule(spec) {
  try { return await import(spec); } catch { return null; }
}

// Build a summary-vertical render(): import module, call `fn`, render the result as cards. Soft-fails.
function summaryRender({ module, fn, title, args = [] }) {
  return async () => {
    const mod = await loadModule(module);
    if (!mod || typeof mod[fn] !== 'function') return unavailableCard(title, 'module not loaded');
    let data;
    try { data = await mod[fn](...args); } catch (e) { return unavailableCard(title, e?.message); }
    if (data === null || data === undefined || data.available === false) return unavailableCard(title);
    return summaryCards(data, title);
  };
}

// Build a search-vertical render(query): always shows the form; with a query, runs `fn(query)` and
// renders results below. Soft-fails to the unavailable card while keeping the form visible.
function searchRender({ module, fn, title, placeholder, label = 'Search' }) {
  return async (query) => {
    const q = typeof query === 'string' ? query.trim() : '';
    const form = card(title, searchForm(pathFor(title), { placeholder, value: q, label }));
    if (!q) return form;
    const mod = await loadModule(module);
    if (!mod || typeof mod[fn] !== 'function') return form + unavailableCard(`${title}: results`, 'module not loaded');
    let data;
    try { data = await mod[fn](q); } catch (e) { return form + unavailableCard(`${title}: results`, e?.message); }
    if (data == null) return form + card(`${title}: results`, `<p class=muted>No results for “${esc(q)}”.</p>`);
    return form + summaryCards(data, `${title}: “${q}”`);
  };
}

// resolve a path back from a title via the registry (set after VERTICALS is built)
let _pathByTitle = new Map();
const pathFor = (title) => _pathByTitle.get(title) || '/';

// ── the registry ────────────────────────────────────────────────────────────────────────────────────
const REL = '../../integrations/soapbox/';

export const VERTICALS = [
  // ---- summary verticals (no input) ----
  { path: '/energy', title: 'Energy', navLabel: 'Energy', kind: 'summary',
    render: summaryRender({ module: `${REL}energy.mjs`, fn: 'energySummary', title: 'Energy' }) },

  // weather defaults to a major city (New York City) so the page has content without input.
  { path: '/weather', title: 'Weather', navLabel: 'Weather', kind: 'summary',
    render: summaryRender({ module: `${REL}weather.mjs`, fn: 'weatherSummary', title: 'Weather', args: [{ lat: 40.7128, lon: -74.006 }] }) },

  { path: '/cams', title: 'Live Cams', navLabel: 'Cams', kind: 'summary',
    render: summaryRender({ module: `${REL}cams.mjs`, fn: 'camsSummary', title: 'Live Cams' }) },

  { path: '/scanners', title: 'Scanners & SDR', navLabel: 'Scanners', kind: 'summary',
    render: summaryRender({ module: `${REL}scanners.mjs`, fn: 'scannersSummary', title: 'Scanners & SDR' }) },

  { path: '/media', title: 'Radio & Media', navLabel: 'Media', kind: 'summary',
    render: summaryRender({ module: `${REL}media.mjs`, fn: 'topStations', title: 'Radio & Media' }) },

  { path: '/gridcoin', title: 'Distributed Research', navLabel: 'GridCoin', kind: 'summary',
    render: summaryRender({ module: `${REL}gridcoin.mjs`, fn: 'gridcoinSummary', title: 'Distributed Research' }) },

  { path: '/nasa', title: 'NASA — Picture of the Day', navLabel: 'NASA', kind: 'summary',
    render: summaryRender({ module: `${REL}nasa.mjs`, fn: 'apod', title: 'NASA — Picture of the Day' }) },

  { path: '/commodities-goods', title: 'Regulated Goods', navLabel: 'Goods', kind: 'summary',
    render: summaryRender({ module: `${REL}regulated-goods.mjs`, fn: 'regulatedGoodsSummary', title: 'Regulated Goods' }) },

  // public-safety defaults to a single city to render without input.
  { path: '/public-safety', title: 'Public Safety', navLabel: 'Public Safety', kind: 'summary',
    render: summaryRender({ module: `${REL}public-safety.mjs`, fn: 'publicSafetySummary', title: 'Public Safety', args: [{ cities: ['seattle'], perCity: 8 }] }) },

  // ---- search verticals (form + optional results) ----
  { path: '/legal', title: 'Legal', navLabel: 'Legal', kind: 'search',
    render: searchRender({ module: `${REL}legal.mjs`, fn: 'legalSummary', title: 'Legal', placeholder: 'Case law, regulations, statutes…', label: 'Search law' }) },

  { path: '/pharma', title: 'Pharmacology', navLabel: 'Pharma', kind: 'search',
    render: searchRender({ module: `${REL}pharma.mjs`, fn: 'drug', title: 'Pharmacology', placeholder: 'Drug or compound name…', label: 'Look up drug' }) },

  { path: '/biodiversity', title: 'Biodiversity', navLabel: 'Biodiversity', kind: 'search',
    render: searchRender({ module: `${REL}biodiversity.mjs`, fn: 'speciesProfile', title: 'Biodiversity', placeholder: 'Species name (common or scientific)…', label: 'Find species' }) },

  { path: '/vehicle', title: 'Vehicle Lookup', navLabel: 'Vehicle', kind: 'search',
    render: searchRender({ module: `${REL}vehicle.mjs`, fn: 'vehicleSummary', title: 'Vehicle Lookup', placeholder: '17-character VIN…', label: 'Decode VIN' }) },

  // ---- gov / public-data reader verticals (queue #182/#181) ----
  // Each soft-fails to the unavailable card; summary verticals seed a sensible default so the page
  // renders without input. Coordinate defaults use New York City to match the /weather vertical.

  // FDA recalls (food + device) — recent batch, no input.
  { path: '/recalls', title: 'FDA Recalls', navLabel: 'Recalls', kind: 'summary',
    render: summaryRender({ module: `${REL}fda-recalls.mjs`, fn: 'summary', title: 'FDA Recalls', args: [{ limit: 25 }] }) },

  // NOAA tides & coastal — defaults to The Battery, NY (first curated station).
  { path: '/tides', title: 'Tides & Coastal', navLabel: 'Tides', kind: 'summary',
    render: summaryRender({ module: `${REL}noaa-climate.mjs`, fn: 'tides', title: 'Tides & Coastal', args: [{ station: '8518750', days: 2 }] }) },

  // OSHA / workplace safety — defaults to California inspections.
  { path: '/osha', title: 'Workplace Safety', navLabel: 'Workplace', kind: 'summary',
    render: summaryRender({ module: `${REL}workplace-safety.mjs`, fn: 'summary', title: 'Workplace Safety', args: [{ state: 'CA', limit: 25 }] }) },

  // FCC broadband availability — defaults to a New York City location.
  { path: '/broadband', title: 'Broadband Availability', navLabel: 'Broadband', kind: 'summary',
    render: summaryRender({ module: `${REL}fcc-broadband.mjs`, fn: 'broadbandAt', title: 'Broadband Availability', args: [{ lat: 40.7128, lon: -74.006 }] }) },

  // USDA FoodData Central — searchable food/nutrition lookup.
  { path: '/nutrition', title: 'Food & Nutrition', navLabel: 'Nutrition', kind: 'search',
    render: searchRender({ module: `${REL}usda-nutrition.mjs`, fn: 'searchFood', title: 'Food & Nutrition', placeholder: 'Food or ingredient…', label: 'Find food' }) },

  // Treasury fiscal data — national debt, rates, statement — summary, no input.
  { path: '/debt', title: 'Treasury & Debt', navLabel: 'Treasury', kind: 'summary',
    render: summaryRender({ module: `${REL}treasury-fiscal.mjs`, fn: 'summary', title: 'Treasury & Debt' }) },

  // CPSC consumer product recalls — recent batch, no input.
  { path: '/product-recalls', title: 'Consumer Product Recalls', navLabel: 'Product Recalls', kind: 'summary',
    render: summaryRender({ module: `${REL}cpsc-recalls.mjs`, fn: 'summary', title: 'Consumer Product Recalls', args: [{ limit: 25 }] }) },

  // EPA air quality & environment — defaults to a New York City location.
  { path: '/environment', title: 'Air & Environment', navLabel: 'Environment', kind: 'summary',
    render: summaryRender({ module: `${REL}epa-enviro.mjs`, fn: 'airQuality', title: 'Air & Environment', args: [{ lat: 40.7128, lon: -74.006 }] }) },

  // CDC public health — respiratory activity, defaults to California.
  { path: '/health', title: 'Public Health', navLabel: 'Health', kind: 'summary',
    render: summaryRender({ module: `${REL}cdc-health.mjs`, fn: 'respiratoryLevels', title: 'Public Health', args: [{ state: 'CA' }] }) },

  // SEC EDGAR filings — defaults to a well-known CIK (Apple Inc.) so the page renders without input.
  { path: '/edgar', title: 'SEC Filings', navLabel: 'EDGAR', kind: 'summary',
    render: summaryRender({ module: `${REL}sec-edgar.mjs`, fn: 'recentFilings', title: 'SEC Filings', args: [{ cik: '0000320193', limit: 15 }] }) },

  // Federal opportunities — recent posted/forecasted grants, no input.
  { path: '/opportunities', title: 'Federal Opportunities', navLabel: 'Opportunities', kind: 'summary',
    render: summaryRender({ module: `${REL}fed-opportunities.mjs`, fn: 'grants', title: 'Federal Opportunities', args: [{ limit: 15 }] }) },

  // Data.gov open-data catalog — seeded summary of recent datasets (CKAN search takes an object arg,
  // so this seeds a default query rather than using the positional search form).
  { path: '/datasets', title: 'Open Data Catalog', navLabel: 'Datasets', kind: 'summary',
    render: summaryRender({ module: `${REL}datagov-catalog.mjs`, fn: 'searchDatasets', title: 'Open Data Catalog', args: [{ q: 'open data', limit: 25 }] }) },
];

_pathByTitle = new Map(VERTICALS.map((v) => [v.title, v.path]));
const _byPath = new Map(VERTICALS.map((v) => [v.path, v]));

/** Look up a vertical by its path. Returns the entry or undefined. */
export function findVertical(path) {
  return _byPath.get(path);
}

/** Render a vertical's inner HTML body by path. Never throws — unknown paths and any internal error
 *  degrade to the friendly unavailable card. `query` is passed through to search verticals. */
export async function renderVertical(path, query) {
  const v = findVertical(path);
  if (!v) return unavailableCard('Page');
  try {
    const html = await v.render(query);
    return typeof html === 'string' && html ? html : unavailableCard(v.title);
  } catch (e) {
    return unavailableCard(v.title, e?.message);
  }
}

// Exported for tests / the server's nav assembly.
export const verticalPaths = VERTICALS.map((v) => v.path);
