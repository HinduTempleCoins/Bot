// seo.mjs — one shared SEO helper for the SoapBox subdomains (Data, Search, Stocks).
// Emits valid <head> meta (title, description, canonical), Open Graph + Twitter card, and JSON-LD
// using the RIGHT schema.org type per page. Vanilla Node, no deps. Read-only — pure string builders.
//
// Tasks #115 (structured data + technical SEO) + part of #114 (sitemap/robots helpers).
//
// Design notes:
//   • SearchAction: only emit it for a subdomain that has a REAL GET HTML results URL. The
//     {search_term_string} token MUST appear inside a urlTemplate (e.g. ".../?q={search_term_string}")
//     so Google substitutes the query — NOT as standalone visible text. A past bug emitted the literal
//     placeholder into a path ("/coins/{search_term_string}") which crawlers fetched verbatim → 404s.
//     `webSiteJsonLd()` puts the token only inside `potentialAction.target.urlTemplate`, never elsewhere.
//   • Org is shared across all subdomains (one brand, one @id). Each subdomain is its own WebSite node.
//   • Coin/stock detail pages get a FinancialProduct + an isPartOf Dataset hint (a price-data product).

const ORG_URL = 'https://soapbox.community';
const ORG_ID = `${ORG_URL}/#org`;

/** HTML-attribute-safe escape (same table the servers use). */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** A <script type="application/ld+json"> block from a plain object (or array → one block). */
export function jsonLdScript(obj) {
  if (!obj) return '';
  // JSON.stringify already escapes the dangerous characters for a script context except "</script>";
  // guard the closing-tag sequence so a name/description can never break out of the script element.
  const json = JSON.stringify(obj).replace(/<\/(script)/gi, '<\\/$1');
  return `<script type="application/ld+json">${json}</script>`;
}

/** The shared Organization node. Stable @id so every subdomain references the same brand. */
export function organization() {
  return {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: 'SoapBox',
    url: ORG_URL,
    description: 'A crypto + markets data aggregator with a Clarity transparency score and right-of-reply.',
  };
}

/**
 * A WebSite node for one subdomain. Pass `searchUrlTemplate` ONLY when the site has a GET HTML
 * results page; the literal "{search_term_string}" token must be embedded in that template string.
 * @param {object} o
 * @param {string} o.url   - the subdomain root (e.g. https://search.soapbox.community)
 * @param {string} o.name  - the site name (e.g. "SoapBox Search")
 * @param {string} [o.searchUrlTemplate] - e.g. "https://search.soapbox.community/?q={search_term_string}"
 */
export function webSiteJsonLd({ url, name, searchUrlTemplate } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  const node = {
    '@type': 'WebSite',
    '@id': `${base}/#website`,
    url: base,
    name,
    publisher: { '@id': ORG_ID },
  };
  if (searchUrlTemplate && searchUrlTemplate.includes('{search_term_string}')) {
    node.potentialAction = {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: searchUrlTemplate },
      // schema.org spec: the input is named in 'query-input', matched to the token by name.
      'query-input': 'required name=search_term_string',
    };
  }
  return node;
}

/** Org + WebSite as a single @graph object, ready for jsonLdScript(). */
export function siteGraph(opts) {
  return { '@context': 'https://schema.org', '@graph': [organization(), webSiteJsonLd(opts)] };
}

/**
 * FinancialProduct node for a coin or stock detail page. A lightweight "this page IS a priced
 * financial data product" signal. `category` distinguishes Cryptocurrency vs Stock/ETF/Index.
 */
export function financialProductJsonLd({ name, symbol, url, description, category = 'Cryptocurrency', price, priceCurrency = 'USD' } = {}) {
  const node = {
    '@context': 'https://schema.org',
    '@type': 'FinancialProduct',
    name: symbol ? `${name} (${symbol})` : name,
    category,
    url,
    description: description || `${name}${symbol ? ` (${symbol})` : ''} live price and market data on SoapBox.`,
    provider: { '@id': ORG_ID },
  };
  if (price != null && Number.isFinite(+price)) {
    // an Offer carries the current price as a real, machine-readable number.
    node.offers = { '@type': 'Offer', price: +price, priceCurrency };
  }
  return node;
}

/**
 * Build the SEO <head> fragment shared by Search + Stocks (servers that don't use Data's render.mjs
 * layout). Returns a string of <meta>/<link>/<script> tags to splice into <head>.
 * @param {object} o
 * @param {string} o.title        - page title (already the full, human title)
 * @param {string} o.description  - meta description / OG description
 * @param {string} o.canonical    - absolute canonical URL for THIS page
 * @param {string} o.siteName     - OG site_name (e.g. "SoapBox Search")
 * @param {string} [o.ogType]     - default 'website'
 * @param {string} [o.image]      - absolute OG/Twitter image URL (optional)
 * @param {string} [o.robots]     - default 'index,follow,max-image-preview:large'
 * @param {object|object[]} [o.jsonld] - extra JSON-LD object(s) appended after the site graph
 * @param {object} [o.site]       - { url, name, searchUrlTemplate } for the site graph (Org+WebSite)
 */
export function headTags({
  title, description = '', canonical = '', siteName = 'SoapBox',
  ogType = 'website', image = '', robots = 'index,follow,max-image-preview:large',
  jsonld = null, site = null,
} = {}) {
  const desc = esc(description);
  const t = esc(title);
  const parts = [
    `<meta name="description" content="${desc}">`,
    canonical ? `<link rel="canonical" href="${esc(canonical)}">` : '',
    `<meta name="robots" content="${esc(robots)}">`,
    `<meta property="og:type" content="${esc(ogType)}">`,
    `<meta property="og:site_name" content="${esc(siteName)}">`,
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${desc}">`,
    canonical ? `<meta property="og:url" content="${esc(canonical)}">` : '',
    image ? `<meta property="og:image" content="${esc(image)}">` : '',
    image ? `<meta name="twitter:image" content="${esc(image)}">` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${t}">`,
    `<meta name="twitter:description" content="${desc}">`,
  ];
  if (site) parts.push(jsonLdScript(siteGraph(site)));
  if (jsonld) for (const j of [].concat(jsonld)) parts.push(jsonLdScript(j));
  return parts.filter(Boolean).join('\n');
}

export const _internal = { ORG_URL, ORG_ID };
