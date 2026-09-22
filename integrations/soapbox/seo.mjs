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
  analyticsBeacon = '',
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
  // First-party, cookieless pageview beacon — emitted ONLY when the operator sets ANALYTICS_BEACON_URL.
  // Default is '' → nothing is appended, so headTags() output stays byte-identical for every surface
  // that hasn't opted in (all ~89 servers' tests stay green). See analyticsBeaconTag() for the posture.
  const beaconUrl = analyticsBeacon || ((typeof process !== 'undefined' && process.env && process.env.ANALYTICS_BEACON_URL) || '');
  if (beaconUrl) parts.push(analyticsBeaconTag(beaconUrl));
  return parts.filter(Boolean).join('\n');
}

/**
 * A single, cookieless pageview beacon (navigator.sendBeacon, with a fetch keepalive fallback) that
 * POSTs { p: pathname, r: referrer } to the first-party collector at `url`. NO cookies, NO third-party
 * DNS, fires after parse and never blocks render. Honours Do-Not-Track / GPC client-side (records
 * nothing when set). `url` is operator-configured (env), never user input; it is still JSON-encoded and
 * its "<" neutralised so it can never break out of the <script>. Returns '' for a falsy url.
 */
export function analyticsBeaconTag(url) {
  if (!url) return '';
  const u = JSON.stringify(String(url)).replace(/</g, '\\u003c');
  return '<script>(function(){try{'
    + "if(navigator.doNotTrack=='1'||window.doNotTrack=='1'||navigator.msDoNotTrack=='1')return;"
    + `var u=${u},b=JSON.stringify({p:location.pathname,r:document.referrer});`
    + 'if(navigator.sendBeacon){navigator.sendBeacon(u,b);}'
    + "else if(window.fetch){fetch(u,{method:'POST',body:b,keepalive:true,mode:'no-cors'});}"
    + '}catch(e){}})();</script>';
}

/**
 * BreadcrumbList for a sub-page. `trail` is an ordered [{ name, url }] from the site root to this page.
 * Returns a JSON-LD object ready for jsonLdScript().
 */
export function breadcrumbJsonLd(trail = []) {
  const items = [].concat(trail).filter(Boolean);
  if (!items.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem', position: i + 1, name: it.name, item: it.url,
    })),
  };
}

/**
 * Dataset node for a data / price index page (e.g. the global markets table, a stock index). A
 * "this page IS a structured dataset" signal that helps Google's Dataset Search + AI crawlers.
 */
export function datasetJsonLd({ name, description, url, keywords = [], variableMeasured = [] } = {}) {
  const node = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name,
    description,
    url,
    creator: { '@id': ORG_ID },
    publisher: { '@id': ORG_ID },
  };
  if (keywords.length) node.keywords = [].concat(keywords).filter(Boolean);
  if (variableMeasured.length) {
    node.variableMeasured = [].concat(variableMeasured).filter(Boolean).map((v) =>
      typeof v === 'string' ? v : { '@type': 'PropertyValue', ...v });
  }
  return node;
}

/** Article node for a content page (ecosystem profile, wiki article, news item). */
export function articleJsonLd({ headline, description, url, datePublished, dateModified, image } = {}) {
  const node = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    description,
    url,
    publisher: { '@id': ORG_ID },
  };
  if (datePublished) node.datePublished = datePublished;
  if (dateModified) node.dateModified = dateModified;
  if (image) node.image = image;
  return node;
}

/**
 * Product + AggregateOffer for an honest price-comparison page (hemp flower/seeds, a commodity with
 * multiple sellers). Only emit when there ARE real offers — otherwise prefer datasetJsonLd. `offers`
 * is { count, lowPrice, highPrice, priceCurrency } aggregated across honest sources.
 */
export function productAggregateOfferJsonLd({ name, description, url, image, offers } = {}) {
  const node = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    url,
  };
  if (description) node.description = description;
  if (image) node.image = image;
  const o = offers || {};
  const low = +o.lowPrice, high = +o.highPrice;
  if (Number.isFinite(low) && Number.isFinite(high) && +o.count > 0) {
    node.offers = {
      '@type': 'AggregateOffer',
      offerCount: +o.count,
      lowPrice: low,
      highPrice: high,
      priceCurrency: o.priceCurrency || 'USD',
    };
  }
  return node;
}

/**
 * A general FAQPage node from [{ q, a }] pairs (the listing-seo builder is coin/stock-specific; this one
 * is for any surface). Emit it ONLY when the same Q&A are ALSO visible on the page — Google requires the
 * FAQ text to be present on-page, and an LLM that lifts the answer should be lifting what a human sees.
 * Returns null when there are no usable pairs. Ready for jsonLdScript().
 */
export function faqJsonLd(pairs = []) {
  const items = [].concat(pairs).filter((p) => p && p.q && p.a);
  if (!items.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((p) => ({
      '@type': 'Question',
      name: String(p.q),
      acceptedAnswer: { '@type': 'Answer', text: String(p.a) },
    })),
  };
}

/**
 * A GEO / AI-referenceability citation block. This is the single highest-leverage thing for getting a page
 * quoted by ChatGPT / Claude / Perplexity / Google AI Overviews: a stable, machine-readable "here is how to
 * cite this page" unit that appears BOTH as visible text (so a model lifting the answer lifts the citation
 * too) AND as schema.org JSON-LD (author, publisher, dates, source-of-record). A model that ingests the page
 * gets an unambiguous, reproducible attribution string pointing back at us.
 *
 * @param {object} o
 *   title           - the page/work title
 *   url             - the canonical URL of THIS page (what a citation should point at)
 *   author          - who authored/curated it (default the publisher)
 *   publisher       - the publishing body (default 'SoapBox')
 *   datePublished   - ISO date the page/record was published (optional)
 *   dateModified    - ISO date it was last updated (optional)
 *   sourceOfRecord  - the authoritative upstream source this page surfaces (e.g. 'Caselaw Access Project')
 *   sourceUrl       - the upstream source URL (becomes schema.org isBasedOn)
 *   license         - a license URL/string (e.g. 'https://creativecommons.org/publicdomain/mark/1.0/')
 *   type            - the schema.org @type for the work node (default 'Article')
 *   accessed        - the date the citation is generated/accessed (default today, UTC)
 * @returns {{ html: string, jsonld: object }} - visible block + a schema.org node for jsonLdScript().
 */
export function citationBlock({
  title = '', url = '', author = '', publisher = 'SoapBox', datePublished = '', dateModified = '',
  sourceOfRecord = '', sourceUrl = '', license = '', type = 'Article', accessed = '',
} = {}) {
  const auth = author || publisher || 'SoapBox';
  const acc = accessed || new Date().toISOString().slice(0, 10);
  // A plain, copy-pasteable citation line (author. "title." publisher, date. url).
  const parts = [`${auth}.`];
  if (title) parts.push(`"${title}."`);
  if (publisher && publisher !== auth) parts.push(`${publisher},`);
  if (datePublished) parts.push(`${datePublished}.`);
  if (url) parts.push(url);
  const line = parts.join(' ').replace(/\s+/g, ' ').trim();
  const srcLine = sourceOfRecord
    ? `Source of record: ${sourceOfRecord}${sourceUrl ? ` — ${sourceUrl}` : ''}. `
    : '';

  const html =
    `<aside class="cite-block" style="margin:16px 0;padding:12px 14px;border:1px solid #30363d;border-left:3px solid #58a6ff;border-radius:8px;font-size:13px;line-height:1.6">`
    + `<div style="font-weight:700;margin-bottom:4px">Cite this page</div>`
    + `<cite style="font-style:normal;color:inherit">${esc(line)}</cite>`
    + (srcLine || acc ? `<div style="margin-top:6px;color:#8b949e">${esc(srcLine)}Accessed ${esc(acc)}.</div>` : '')
    + `</aside>`;

  const node = {
    '@context': 'https://schema.org',
    '@type': type,
    headline: title || undefined,
    name: title || undefined,
    url: url || undefined,
    author: { '@type': /,| and /i.test(auth) ? 'Organization' : 'Organization', name: auth },
    publisher: publisher === 'SoapBox' ? { '@id': ORG_ID } : { '@type': 'Organization', name: publisher },
  };
  if (datePublished) node.datePublished = datePublished;
  if (dateModified) node.dateModified = dateModified;
  if (license) node.license = license;
  if (sourceUrl) node.isBasedOn = sourceUrl;
  if (sourceOfRecord && !sourceUrl) node.citation = sourceOfRecord;
  // prune undefined so the JSON-LD stays clean
  for (const k of Object.keys(node)) if (node[k] === undefined) delete node[k];
  return { html, jsonld: node };
}

export const _internal = { ORG_URL, ORG_ID };
