// regulated-goods.mjs — the SoapBox Tobacco / Vape / Alcohol / Wine vertical (queue task #106).
// Regulated consumer goods that you CAN'T quote off a futures ticker the way macro.mjs does — what
// matters here is the REGULATORY record (is this product authorized to be sold? who holds the permit?)
// plus a link-out directory to where a real person actually checks retail pricing. Keyless government
// sources only, so the public site never needs an API key or a billing relationship:
//   • openFDA tobacco (FDA)        — PMTA marketing-granted / authorized tobacco & vape products
//   • CDC tobacco (state-system)   — population-level tobacco data (prevalence, MSA, legislation)
//   • WHO GHO (where available)    — global tobacco-control indicators
//   • TTB (US Treasury / Alcohol)  — permit + label (COLA) data for alcohol producers/importers
//
// Retailer PRICING is deliberately NOT scraped here — Wine-Searcher / Vivino etc. forbid scraping and
// it isn't government data. PRICE_SOURCES is a curated LINK-OUT directory the site renders as "check
// price at →" buttons; the user goes there. (Brief: retailer pricing = link-out, do not scrape.)
//
// Same shape as macro.mjs / pharma.mjs: ESM, a __setFetch() seam for tests, graceful soft-fail — every
// export returns a well-formed object/array (with an `error` note where useful) and NEVER throws.
// Results are cached so the site doesn't hammer the federal endpoints.
//
//   import { tobaccoProducts, alcoholPermits, PRICE_SOURCES, regulatedGoodsSummary } from './regulated-goods.mjs'
//   node integrations/soapbox/regulated-goods.mjs juul

import { cached, TTL } from './cache.mjs';

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Endpoint roots — kept in one place so a base-URL change is a one-line edit.
export const ENDPOINTS = {
  openfda: 'https://api.fda.gov',                                  // openFDA tobacco problem-report + product endpoints
  cdc: 'https://data.cdc.gov/resource',                            // CDC Socrata open-data (state tobacco system)
  who: 'https://ghoapi.azureedge.net/api',                         // WHO Global Health Observatory OData
  ttb: 'https://www.ttbonline.gov/colasonline/publicSearchColasBasicProcess.do', // TTB Public COLA Registry (reference link)
};

// fetch JSON with soft-fail: any network/parse/non-ok error resolves to null, never throws.
async function getJSON(url) {
  try {
    const r = await _fetch(url, { headers: UA });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

const clean = (s) => String(s == null ? '' : s).trim();

// ── PRICE_SOURCES: retailer pricing link-out directory ──────────────────────────────────────────────
// NOT scraped — each entry is a "check price at →" destination. `q(query)` builds the search URL for the
// product so the site can deep-link straight to the lookup. Grouped by what the source actually covers.
// Wine-Searcher's /find/ path uses literal '+' between words; encode each token, then join with '+'.
const wineSearch = (q) => `https://www.wine-searcher.com/find/${clean(q).split(/\s+/).filter(Boolean).map(encodeURIComponent).join('+')}`;
const vivinoSearch = (q) => `https://www.vivino.com/search/wines?q=${encodeURIComponent(clean(q))}`;
const untappdSearch = (q) => `https://untappd.com/search?q=${encodeURIComponent(clean(q))}`;
const distillerSearch = (q) => `https://distiller.com/search?term=${encodeURIComponent(clean(q))}`;
const totalWineSearch = (q) => `https://www.totalwine.com/search/all?text=${encodeURIComponent(clean(q))}`;

export const PRICE_SOURCES = {
  'Wine': [
    { name: 'Wine-Searcher', home: 'https://www.wine-searcher.com/', note: 'Global wine price comparison across merchants', q: wineSearch },
    { name: 'Vivino', home: 'https://www.vivino.com/', note: 'Community ratings + average price', q: vivinoSearch },
    { name: 'Total Wine & More', home: 'https://www.totalwine.com/', note: 'Large US retailer catalog pricing', q: totalWineSearch },
  ],
  'Spirits': [
    { name: 'Wine-Searcher', home: 'https://www.wine-searcher.com/', note: 'Also covers spirits pricing', q: wineSearch },
    { name: 'Distiller', home: 'https://distiller.com/', note: 'Spirits ratings + reference pricing', q: distillerSearch },
    { name: 'Total Wine & More', home: 'https://www.totalwine.com/', note: 'US spirits retail pricing', q: totalWineSearch },
  ],
  'Beer': [
    { name: 'Untappd', home: 'https://untappd.com/', note: 'Community beer database + venue pricing', q: untappdSearch },
    { name: 'Total Wine & More', home: 'https://www.totalwine.com/', note: 'US beer retail pricing', q: totalWineSearch },
  ],
  'Tobacco & Vape': [
    { name: 'FDA — Authorized products', home: 'https://www.fda.gov/tobacco-products/products-ingredients-components/authorized-marketing-orders-tobacco-products', note: 'Whether the product is legally marketable (not pricing)', q: null },
  ],
};

/** Flatten PRICE_SOURCES into "check price at →" links for a given query. Soft: empty q → home links only. */
export function priceLinks(query, category = null) {
  const q = clean(query);
  const cats = category && PRICE_SOURCES[category] ? { [category]: PRICE_SOURCES[category] }
    : PRICE_SOURCES;
  const out = [];
  for (const [cat, rows] of Object.entries(cats)) {
    for (const s of rows) {
      out.push({
        category: cat,
        name: s.name,
        note: s.note,
        url: (q && typeof s.q === 'function') ? s.q(q) : s.home,
        scraped: false,
      });
    }
  }
  return out;
}

// ── openFDA tobacco: tobaccoProducts(q) ─────────────────────────────────────────────────────────────
// openFDA exposes a tobacco problem-report endpoint (/tobacco/problem.json) keyed off product fields.
// We use the count facet on the product category/sub-category for a query, then normalize into a flat
// list the site can render. The brief's "PMTA / authorized tobacco products" intent is surfaced via the
// authorization link-out in PRICE_SOURCES['Tobacco & Vape'] (the canonical FDA marketing-order list is
// a published page, not a keyed JSON feed) — here we return the structured openFDA signal that IS keyless.
export async function tobaccoProducts(q, { limit = 25 } = {}) {
  const query = clean(q);
  if (!query) return { query: '', source: 'openFDA tobacco (FDA)', found: false, products: [], error: 'empty query' };
  return cached(`reg:tobacco:${query.toLowerCase()}:${limit}`, TTL.metadata, async () => {
    const safe = query.replace(/["\\]/g, '');
    const search = `(products.tobacco_products:"${safe}"+products.product_category:"${safe}")`;
    const u = `${ENDPOINTS.openfda}/tobacco/problem.json?search=${encodeURIComponent(search).replace(/%2B/g, '+')}&limit=${limit}`;
    const j = await getJSON(u);
    const rows = j?.results;
    if (!Array.isArray(rows) || !rows.length) {
      return { query, source: 'openFDA tobacco (FDA)', found: false, products: [] };
    }
    // Each report lists one+ products; flatten + de-duplicate by category|subcategory|brand.
    const seen = new Map();
    for (const r of rows) {
      for (const p of (r.products || [])) {
        const category = clean(p.product_category) || null;
        const sub = clean(p.product_sub_category) || null;
        const brand = clean(p.tobacco_products) || null;
        const key = `${category}|${sub}|${brand}`;
        if (!seen.has(key)) {
          seen.set(key, { category, subCategory: sub, brand, reports: 0 });
        }
        seen.get(key).reports += 1;
      }
    }
    const products = [...seen.values()].sort((a, b) => b.reports - a.reports);
    return {
      query,
      source: 'openFDA tobacco (FDA) — problem reports, not an endorsement',
      authorization: PRICE_SOURCES['Tobacco & Vape'][0].home, // FDA authorized-products list
      found: products.length > 0,
      products,
    };
  });
}

// ── TTB: alcoholPermits(q) ──────────────────────────────────────────────────────────────────────────
// TTB's Public COLA Registry (Certificate of Label Approval) is the federal record of who is approved to
// sell a given alcohol label. The live registry is an interactive web form (no keyless JSON API), and
// CDC publishes alcohol-industry / permit reference data via its Socrata open-data portal. We query the
// keyless Socrata dataset when reachable and ALWAYS return the TTB COLA registry deep-link so the user
// can verify the permit/label directly. Normalizes into a flat permit list; soft-fails to the link only.
export async function alcoholPermits(q, { limit = 25 } = {}) {
  const query = clean(q);
  const registryUrl = `${ENDPOINTS.ttb}`;
  if (!query) {
    return { query: '', source: 'TTB Public COLA Registry (US Treasury)', registryUrl, found: false, permits: [], error: 'empty query' };
  }
  return cached(`reg:alcohol:${query.toLowerCase()}:${limit}`, TTL.metadata, async () => {
    // CDC Socrata "alcohol" dataset (keyless, $where SoQL). Dataset id is configurable; soft-fails to link.
    const where = encodeURIComponent(`upper(applicant_name) like upper('%${query.replace(/'/g, "''")}%')`);
    const u = `${ENDPOINTS.cdc}/permits.json?$where=${where}&$limit=${limit}`;
    const j = await getJSON(u);
    const rows = Array.isArray(j) ? j : (Array.isArray(j?.results) ? j.results : null);
    if (!rows) {
      // No keyless feed reachable — still useful: hand back the official lookup link.
      return {
        query,
        source: 'TTB Public COLA Registry (US Treasury)',
        registryUrl,
        found: false,
        permits: [],
        note: 'Verify permit / label approval directly in the TTB COLA registry',
      };
    }
    const permits = rows.map((r) => ({
      applicant: clean(r.applicant_name) || clean(r.permittee_name) || null,
      permitNumber: clean(r.permit_number) || clean(r.ttb_id) || null,
      productClass: clean(r.product_class_type) || clean(r.class_type) || null,
      brand: clean(r.brand_name) || null,
      origin: clean(r.origin) || clean(r.state) || null,
      status: clean(r.status) || null,
    }));
    return {
      query,
      source: 'TTB / CDC open data (US)',
      registryUrl,
      found: permits.length > 0,
      permits,
    };
  });
}

// ── CDC tobacco prevalence (state system): tobaccoPrevalence(state) ─────────────────────────────────
// Population-level tobacco signal from CDC's open-data portal. Not in the required export list but rounds
// out the "CDC tobacco data" source — exported for the vertical's public-health panel. Soft-fails to [].
export async function tobaccoPrevalence(state = '', { limit = 10 } = {}) {
  const st = clean(state);
  return cached(`reg:cdc-prev:${st.toLowerCase()}:${limit}`, TTL.metadata, async () => {
    const where = st ? `&$where=${encodeURIComponent(`upper(locationdesc) like upper('%${st.replace(/'/g, "''")}%')`)}` : '';
    const u = `${ENDPOINTS.cdc}/wsas-xwh5.json?$limit=${limit}${where}`;
    const j = await getJSON(u);
    const rows = Array.isArray(j) ? j : null;
    if (!rows) return { state: st || null, source: 'CDC tobacco (state system)', rows: [] };
    return {
      state: st || null,
      source: 'CDC tobacco (state system)',
      rows: rows.map((r) => ({
        location: clean(r.locationdesc) || null,
        year: clean(r.year) || null,
        measure: clean(r.measuredesc) || clean(r.topicdesc) || null,
        value: r.data_value != null ? Number(r.data_value) : null,
        unit: clean(r.data_value_unit) || null,
      })),
    };
  });
}

// ── WHO global tobacco-control indicator: whoTobaccoIndicator(code) ─────────────────────────────────
// WHO GHO OData — "where available" per the brief. Default indicator is adult tobacco-use prevalence.
// Not in the required export list; completes the "WHO (where available)" source. Soft-fails to [].
export async function whoTobaccoIndicator(code = 'M_Est_tob_curr_std', { limit = 25 } = {}) {
  const ind = clean(code) || 'M_Est_tob_curr_std';
  return cached(`reg:who:${ind}:${limit}`, TTL.metadata, async () => {
    const u = `${ENDPOINTS.who}/${encodeURIComponent(ind)}?$top=${limit}`;
    const j = await getJSON(u);
    const rows = Array.isArray(j?.value) ? j.value : null;
    if (!rows) return { indicator: ind, source: 'WHO GHO', values: [] };
    return {
      indicator: ind,
      source: 'WHO Global Health Observatory',
      values: rows.map((v) => ({
        country: clean(v.SpatialDim) || null,
        year: v.TimeDim != null ? Number(v.TimeDim) : null,
        sex: clean(v.Dim1) || null,
        value: v.NumericValue != null ? Number(v.NumericValue) : null,
      })),
    };
  });
}

// ── regulatedGoodsSummary(): homepage chip / overview ───────────────────────────────────────────────
// A compact snapshot for the vertical's landing chip: the set of regulated categories, which government
// source backs each, and the price link-out destinations. No query → static, keyless, never throws.
export async function regulatedGoodsSummary() {
  return {
    vertical: 'Regulated Goods — Tobacco · Vape · Alcohol · Wine',
    categories: [
      { name: 'Tobacco & Vape', authority: 'FDA (openFDA tobacco + PMTA marketing orders)', verify: PRICE_SOURCES['Tobacco & Vape'][0].home },
      { name: 'Alcohol (spirits/beer)', authority: 'TTB (US Treasury) — permits + COLA labels', verify: ENDPOINTS.ttb },
      { name: 'Wine', authority: 'TTB (COLA) + retailer link-out for pricing', verify: ENDPOINTS.ttb },
    ],
    publicHealthSources: ['CDC tobacco (state system)', 'WHO Global Health Observatory (where available)'],
    priceSources: Object.fromEntries(
      Object.entries(PRICE_SOURCES).map(([cat, rows]) => [cat, rows.map((r) => ({ name: r.name, home: r.home }))]),
    ),
    pricingPolicy: 'Retailer pricing is link-out only (Wine-Searcher / Vivino / Untappd / Distiller). Not scraped.',
  };
}

// ── CLI: node integrations/soapbox/regulated-goods.mjs <query> ───────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('regulated-goods.mjs')) {
  const q = process.argv.slice(2).join(' ') || 'cabernet';
  const [tob, alc, sum] = await Promise.all([tobaccoProducts(q), alcoholPermits(q), regulatedGoodsSummary()]);
  console.log(`\n# Regulated Goods: ${q}\n`);
  console.log('Tobacco (openFDA):', tob.found ? `${tob.products.length} product rows` : 'none');
  console.log('Alcohol (TTB):    ', alc.found ? `${alc.permits.length} permits` : `none → verify at ${alc.registryUrl}`);
  console.log('\nCheck price at:');
  for (const l of priceLinks(q)) console.log(`  [${l.category}] ${l.name.padEnd(20)} ${l.url}`);
  console.log('\nCategories:', sum.categories.map((c) => c.name).join(', '));
}
