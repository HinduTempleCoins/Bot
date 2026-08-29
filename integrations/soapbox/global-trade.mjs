// global-trade.mjs — SoapBox "Global Trade" vertical: an honest import/export + ethnobotanical
// marketplace layer, powered by FREE OFFICIAL trade data (the accountability-API play, applied to
// commerce). It unifies the two things the operator pointed at:
//
//   1. RETAIL LISTINGS (bobshop model) — a rich product listing (botanical/scientific name, origin,
//      traditional use, images, price, seller, LEGAL note) — the ethnobotanical seed/plant being the
//      flagship category, cross-linked to the Ashurbanipal plant-medicine library for reference.
//   2. GLOBAL TRADE INTELLIGENCE (TradeAtlas / ImportYeti / Alibaba / IndiaMART model) — every listing
//      carries an HS code, so it plugs into country trade-flow statistics (UN Comtrade / USITC DataWeb)
//      and into a B2B buyer↔supplier lead shape (RFQ). Discovery of who trades what, from where.
//
// WHY OURS IS DIFFERENT: the paid platforms gate customs data behind subscriptions. The AUTHORITATIVE
// numbers — UN Comtrade (global) and USITC DataWeb / US Census (US) — are PUBLIC. We make them legible
// beside a listing, provenance-tagged, instead of reselling them.
//
// DISCIPLINE (inherited from the SoapBox readers):
//   • FACTS + SOURCES, never verdicts. Trade stats carry their source + asOf; we never echo one vendor's
//     price as truth. • The plant-medicine library SERVES UN-GATED: legal-marketplace + reference framing,
//     NO moralizing, NO accusation, NO manufacturing/extraction routes — history/ethnobotany/legal-status
//     only. • Educational + commercial listing info, NOT legal/medical advice. • esc() every interpolation.
//   • Soft-fail-never-throw: injectable fetch (__setFetch), every route renders even when a source is dark.
//
//   import { TRADE_DATA_SOURCES, productListing, HS_CODES, hsLookup, comtradeFlows,
//            buildLead, renderListingPage, renderPage, dataNote } from './global-trade.mjs'
//   PORT/BASE_URL via a site/ surface; CLI: node integrations/soapbox/global-trade.mjs listing helinus

let _fetch = (...a) => globalThis.fetch(...a);
/** Inject fetch (tests). Pass nothing to reset to global fetch. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => (v == null ? '' : String(v));
export function esc(s) {
  return str(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const num = (v) => (Number.isFinite(+v) ? +v : null);

// ── the OFFICIAL free trade-data sources we make legible (facts + endpoints, no keys required) ──────
export const TRADE_DATA_SOURCES = [
  {
    id: 'comtrade', name: 'UN Comtrade', scope: 'global',
    provides: 'Official international trade statistics — imports/exports by reporter/partner country, HS commodity code, year.',
    home: 'https://comtrade.un.org', api: 'https://comtradeapi.un.org/public/v1/preview/C/A/HS',
    keyless: true, note: 'Free public preview tier is keyless; higher volume uses a free registered key.',
  },
  {
    id: 'usitc-dataweb', name: 'USITC DataWeb', scope: 'us',
    provides: 'U.S. imports/exports by HS/HTS number, country, district, and Customs value — the authoritative US series.',
    home: 'https://dataweb.usitc.gov', api: 'https://datawebws.usitc.gov/dataweb', keyless: false,
    note: 'Free account; API token issued in the DataWeb console.',
  },
  {
    id: 'census-trade', name: 'US Census — International Trade', scope: 'us',
    provides: 'Monthly US trade by HS/NAICS, country, and port; the USA Trade Online source.',
    home: 'https://www.census.gov/foreign-trade/', api: 'https://api.census.gov/data/timeseries/intltrade', keyless: false,
    note: 'Free Census API key.',
  },
  {
    id: 'importyeti', name: 'ImportYeti', scope: 'us',
    provides: 'US Customs bill-of-lading records — find a company’s actual overseas suppliers from shipment manifests.',
    home: 'https://www.importyeti.com', api: null, keyless: false,
    note: 'Web tool; supplier discovery from public CBP manifest data. Link-out, not resold.',
  },
  {
    id: 'tradeatlas', name: 'TradeAtlas', scope: 'global', kind: 'platform',
    provides: 'Commercial import/export intelligence — buyers, suppliers, and shipment records across many countries.',
    home: 'https://www.tradeatlas.com', api: null, keyless: false, note: 'Paid aggregator; we link out, and mirror the same facts from the free official series where we can.',
  },
  {
    id: 'volza', name: 'Volza', scope: 'global', kind: 'platform',
    provides: 'Global trade / customs shipment data and buyer-supplier discovery across ~200 countries.',
    home: 'https://www.volza.com', api: null, keyless: false, note: 'Paid aggregator; link-out reference.',
  },
  {
    id: 'tendata', name: 'Tendata', scope: 'global', kind: 'platform',
    provides: 'Commercial import/export customs-data and buyer-supplier intelligence across many countries.',
    home: 'https://www.tendata.com', api: null, keyless: false, note: 'Paid aggregator; link-out reference.',
  },
  {
    id: 'itc-trademap', name: 'ITC Trade Map', scope: 'global',
    provides: 'Trade flows + market access + tariff data by product and market; good for buyer/supplier country shortlists.',
    home: 'https://www.trademap.org', api: null, keyless: false, note: 'Free registration.',
  },
  {
    id: 'itc-export-potential', name: 'ITC Export Potential Map', scope: 'global', kind: 'opportunity',
    provides: 'Identifies products a country could export MORE of and the markets with untapped demand — the opportunity layer, not just historical flows.',
    home: 'https://exportpotential.intracen.org', api: null, keyless: true, note: 'Free ITC tool; answers "what should we sell, and where."',
  },
  {
    id: 'oec', name: 'OEC — Observatory of Economic Complexity', scope: 'global', kind: 'viz',
    provides: 'Trade-flow visualizations and country/product profiles by HS code, with a data API; the clearest picture of what a place trades.',
    home: 'https://oec.world', api: 'https://oec.world/api', keyless: true, note: 'Free tier + API; great for the country/HS explorer.',
  },
  {
    id: 'trade-gov', name: 'ITA / trade.gov (US Commerce)', scope: 'us', kind: 'assistance',
    provides: 'Official US export assistance — trade leads, Country Commercial Guides, market research, and trade-event listings from the International Trade Administration.',
    home: 'https://www.trade.gov', api: null, keyless: false, note: 'Government resource; the export-help counterpart to the raw data series.',
  },
  {
    id: 'exim', name: 'EXIM Bank (US)', scope: 'us', kind: 'financing',
    provides: 'Official US export credit agency — export credit insurance, working-capital guarantees, and buyer financing so a US seller can offer terms and get paid.',
    home: 'https://www.exim.gov', api: null, keyless: false, note: 'Government resource; a listing’s export leg can point here for financing/insurance.',
  },
];

// ── a small HS-code table (extend freely). HS = the global product language every listing speaks. ──
export const HS_CODES = {
  '1209': { label: 'Seeds, fruit and spores, of a kind used for sowing', chapter: 'Ch.12' },
  '1209.99': { label: 'Other seeds for sowing', chapter: 'Ch.12', parent: '1209' },
  '1211': { label: 'Plants/parts used in perfumery, pharmacy, or for insecticidal/fungicidal purposes (incl. many botanicals)', chapter: 'Ch.12' },
  '1211.90': { label: 'Other plants and parts (fresh/dried, whether or not cut/crushed)', chapter: 'Ch.12', parent: '1211' },
  '1302.19': { label: 'Vegetable saps and extracts, other', chapter: 'Ch.13' },
};
/** Resolve an HS code (exact or nearest declared parent) to its label. Soft: unknown → {code,label:''} */
export function hsLookup(code) {
  const c = str(code).trim();
  if (HS_CODES[c]) return { code: c, ...HS_CODES[c] };
  const parent = c.split('.')[0];
  if (HS_CODES[parent]) return { code: c, ...HS_CODES[parent], note: 'nearest heading' };
  return { code: c, label: '', chapter: '' };
}

// ── a normalized product LISTING (bobshop fields), HS-tagged so it plugs into the trade layer ───────
/**
 * Build a clean listing record. NO judgement; legal note is a neutral know-your-jurisdiction line, not
 * a gate. libraryRef cross-links to the Ashurbanipal reference entry (facts/ethnobotany), never a
 * how-to. All fields optional; missing ones simply don't render.
 */
export function productListing(raw = {}) {
  const price = num(raw.price);
  return {
    id: str(raw.id) || str(raw.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    title: str(raw.title),
    scientificName: str(raw.scientificName),
    commonNames: Array.isArray(raw.commonNames) ? raw.commonNames.map(str).filter(Boolean) : [],
    category: str(raw.category) || 'ethnobotanical',
    origin: str(raw.origin),
    hsCode: str(raw.hsCode),
    description: str(raw.description),
    traditionalUse: str(raw.traditionalUse),   // ethnobotany, reference — NOT dosing/how-to
    images: Array.isArray(raw.images) ? raw.images.map(str).filter(Boolean) : [],
    price, currency: str(raw.currency) || 'USD',
    unit: str(raw.unit) || 'each',
    seller: raw.seller && typeof raw.seller === 'object'
      ? { name: str(raw.seller.name), rating: str(raw.seller.rating), url: str(raw.seller.url), ships: str(raw.seller.ships) }
      : null,
    legalNote: str(raw.legalNote),
    libraryRef: str(raw.libraryRef),
    source: raw.source && raw.source.name ? { name: str(raw.source.name), url: str(raw.source.url) } : null,
  };
}

// ── B2B: a buyer↔supplier trade lead / RFQ (Alibaba/TradeAtlas model) ───────────────────────────────
export function buildLead(lead = {}) {
  const side = lead.side === 'supply' ? 'supply' : 'demand'; // demand = buyer RFQ; supply = supplier offer
  return {
    side, product: str(lead.product), hsCode: str(lead.hsCode),
    quantity: num(lead.quantity), unit: str(lead.unit) || 'unit',
    country: str(lead.country), incoterm: str(lead.incoterm), // FOB/CIF/EXW…
    company: str(lead.company), contactPath: str(lead.contactPath), // routed via SoapBox, never scraped PII
    note: str(lead.note),
  };
}

// ── trade flows: pull country import/export totals for an HS code from UN Comtrade (keyless preview) ──
/**
 * comtradeFlows({ hsCode, reporter, flow, year }) → { rows:[{partner, value, qty}], source, asOf } | soft {}.
 * Never throws; on any failure returns { rows:[], source, asOf, error }. reporter/partner use Comtrade
 * area codes ('842'=USA, '0'=World). flow: 'M' imports | 'X' exports.
 */
export async function comtradeFlows({ hsCode = '', reporter = '842', flow = 'M', year = '' } = {}, opts = {}) {
  const src = TRADE_DATA_SOURCES.find((s) => s.id === 'comtrade');
  const out = { rows: [], source: { name: src.name, url: src.home }, asOf: str(year) || 'latest' };
  const cmd = str(hsCode).replace(/\./g, '');
  const period = str(year) || String(new Date().getUTCFullYear() - 1);
  const url = `${src.api}?reporterCode=${encodeURIComponent(reporter)}&period=${encodeURIComponent(period)}`
    + `&flowCode=${encodeURIComponent(flow)}&cmdCode=${encodeURIComponent(cmd || 'TOTAL')}&partnerCode=`;
  try {
    const f = opts.fetch || _fetch;
    const res = await f(url, { headers: { accept: 'application/json' } });
    if (!res || !res.ok) return { ...out, error: `status ${res ? res.status : 'no-response'}` };
    const j = await res.json();
    const data = Array.isArray(j && j.data) ? j.data : [];
    out.rows = data.map((d) => ({
      partner: str(d.partnerDesc || d.ptTitle), value: num(d.primaryValue ?? d.TradeValue), qty: num(d.qty ?? d.NetWeight),
    })).filter((r) => r.partner).sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 15);
    out.asOf = period;
    return out;
  } catch (e) { return { ...out, error: str(e && e.message) || 'fetch failed' }; }
}

export function dataNote() {
  return 'Trade statistics are official public data (UN Comtrade / USITC DataWeb / US Census), provenance-tagged '
    + 'and dated. Listings are marketplace information, not endorsements. Reference material on plants is '
    + 'historical/ethnobotanical and legal-status only — not medical, legal, or cultivation advice.';
}

// ── render: a bobshop-style product page + trade-context panel + library cross-link ─────────────────
function money(l) { return l.price == null ? '' : `${esc(l.currency)} ${esc(l.price.toFixed ? l.price.toFixed(2) : l.price)}`; }

export function renderListing(l) {
  const names = l.commonNames.length ? `<p class="cnames">Also known as: ${l.commonNames.map(esc).join(', ')}</p>` : '';
  const imgs = l.images.length
    ? `<div class="gallery">${l.images.map((s) => `<img src="${esc(s)}" alt="${esc(l.title)}" loading="lazy">`).join('')}</div>` : '';
  const hs = l.hsCode ? (() => { const h = hsLookup(l.hsCode); return `<li><b>HS code:</b> <span class="hs">${esc(l.hsCode)}</span>${h.label ? ` — ${esc(h.label)}` : ''}</li>`; })() : '';
  const seller = l.seller && l.seller.name
    ? `<li><b>Seller:</b> ${l.seller.url ? `<a href="${esc(l.seller.url)}" rel="nofollow noopener">${esc(l.seller.name)}</a>` : esc(l.seller.name)}`
      + `${l.seller.rating ? ` (${esc(l.seller.rating)})` : ''}${l.seller.ships ? ` — ships ${esc(l.seller.ships)}` : ''}</li>` : '';
  const lib = l.libraryRef
    ? `<p class="libref">Reference: <a href="${esc(l.libraryRef)}">Ashurbanipal plant-medicine library entry →</a> (history, ethnobotany, legal status — no how-to)</p>` : '';
  const legal = l.legalNote ? `<p class="legal">${esc(l.legalNote)}</p>` : '';
  return `<article class="listing">
  <h2>${esc(l.title)}</h2>
  ${l.scientificName ? `<p class="sci"><i>${esc(l.scientificName)}</i></p>` : ''}
  ${names}
  ${imgs}
  ${l.price != null ? `<p class="price">${money(l)} <span class="unit">/ ${esc(l.unit)}</span></p>` : ''}
  <ul class="facts">
    ${l.origin ? `<li><b>Origin:</b> ${esc(l.origin)}</li>` : ''}
    ${hs}
    ${seller}
    ${l.category ? `<li><b>Category:</b> ${esc(l.category)}</li>` : ''}
  </ul>
  ${l.description ? `<section class="desc"><h3>Description</h3><p>${esc(l.description)}</p></section>` : ''}
  ${l.traditionalUse ? `<section class="ethno"><h3>Traditional / ethnobotanical use</h3><p>${esc(l.traditionalUse)}</p></section>` : ''}
  ${lib}
  ${legal}
  ${l.source ? `<p class="src">Listing data: <a href="${esc(l.source.url)}" rel="nofollow noopener">${esc(l.source.name)}</a></p>` : ''}
</article>`;
}

/** A full standalone page: the listing + a live trade-context panel (country flows for its HS code). */
export function renderPage({ listing, flows } = {}) {
  const l = listing || {};
  const flowRows = flows && flows.rows && flows.rows.length
    ? `<table><thead><tr><th>Partner country</th><th>Customs value</th></tr></thead><tbody>`
      + flows.rows.map((r) => `<tr><td>${esc(r.partner)}</td><td>${r.value != null ? '$' + esc(Number(r.value).toLocaleString('en-US')) : '—'}</td></tr>`).join('')
      + `</tbody></table><p class="src">Source: <a href="${esc(flows.source.url)}" rel="nofollow noopener">${esc(flows.source.name)}</a> — ${esc(flows.asOf)}</p>`
    : `<p class="empty">Trade-flow data unavailable right now — the official source will fill this panel when reachable.</p>`;
  return `<section class="global-trade">
  ${l.title ? renderListing(l) : ''}
  <section class="trade-context"><h3>Who trades this — official flows${l.hsCode ? ` (HS ${esc(l.hsCode)})` : ''}</h3>
  ${flowRows}</section>
  <p class="note">${esc(dataNote())}</p>
</section>`;
}

// ── seed example: the bobshop flagship — a legal ethnobotanical listing, library-cross-linked ───────
export const SAMPLE_LISTINGS = {
  helinus: productListing({
    id: 'helinus-integrifolius-seeds',
    title: 'Helinus integrifolius seeds — indigenous climber / dream herb',
    scientificName: 'Helinus integrifolius',
    commonNames: ['soap-creeper', 'ubulawu (dream-vine, various traditions)'],
    category: 'ethnobotanical seed',
    origin: 'Southern Africa (indigenous across several provinces)',
    hsCode: '1209.99',
    description: 'Indigenous climbing vine grown from seed. Saponin-rich; traditionally lathered in water. Sold as viable seed for sowing, with germination and care notes.',
    traditionalUse: 'Documented in Southern African traditions as an oneirogenic ("dream") herb associated with vivid dreams and dream recall. Presented here as ethnobotanical/historical reference only.',
    price: 3.50, currency: 'USD', unit: '10 seeds',
    seller: { name: 'independent seed vendor', rating: 'rating shown at source', ships: 'per vendor terms' },
    legalNote: 'Helinus integrifolius is not a controlled substance under US federal law; local rules on plant/seed import vary. Buyers are responsible for their own jurisdiction’s import and cultivation rules.',
    libraryRef: '/library/helinus-integrifolius',
    source: { name: 'listing format after Bob Shop (bobshop.co.za)', url: 'https://www.bobshop.co.za' },
  }),
};

// ── CLI (guarded) ───────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('global-trade.mjs')) {
  const [cmd = 'listing', arg = 'helinus'] = process.argv.slice(2);
  if (cmd === 'sources') {
    for (const s of TRADE_DATA_SOURCES) console.log(`  • ${s.name} [${s.scope}]${s.keyless ? ' (keyless)' : ''} — ${s.provides}\n    ${s.home}`);
  } else if (cmd === 'listing') {
    const l = SAMPLE_LISTINGS[arg];
    if (!l) { console.log('no such sample listing:', arg); }
    else {
      const flows = await comtradeFlows({ hsCode: l.hsCode, reporter: '842', flow: 'M' }).catch(() => ({ rows: [] }));
      console.log(renderPage({ listing: l, flows }));
    }
  } else if (cmd === 'flows') {
    console.log(JSON.stringify(await comtradeFlows({ hsCode: arg, reporter: '842', flow: 'M' }).catch((e) => ({ error: str(e.message) })), null, 2));
  }
  console.log(`\n${dataNote()}`);
}
