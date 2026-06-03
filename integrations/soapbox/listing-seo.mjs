// listing-seo.mjs — programmatic per-listing SEO for SoapBox detail pages (coins / companies / stocks).
// Queue #126. PURE functions, NO network. Given one record, produce title/description/H1, a canonical
// URL, the on-page + schema.org FAQ pairs, and a full JSON-LD payload (Dataset + FAQPage + BreadcrumbList).
//
// The point is programmatic SEO that ISN'T thin-duplicate: every description and FAQ answer is woven from
// record-specific facts (price, market cap, rank, symbol, kind) so each of thousands of generated pages
// carries unique, query-matching text. The FAQ questions mirror the real long-tail search patterns people
// type — "[token] price", "[token] to USD", "[token] chart", "[token] market cap", "how to buy [token]".
//
//   import { seoTitle, seoDescription, seoH1, canonical, faqPairs, structuredData } from './listing-seo.mjs'
//   node integrations/soapbox/listing-seo.mjs            # demo with a sample record

const DEFAULT_BASE = 'https://data.soapbox.community';

// ---- record shape (all optional except name/symbol-ish) ----
// rec = { name, symbol, slug?, kind?('crypto'|'stock'|'company'), price?, priceCurrency?('USD'),
//         marketCap?, rank?, change24h?, supply?, category?, exchange? }

/** HTML-attribute / text-safe escape (matches the table the SoapBox servers + seo.mjs use). */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---- small pure formatters (never throw, never network) ----

const KIND_LABEL = { crypto: 'cryptocurrency', stock: 'stock', company: 'company', etf: 'ETF', index: 'index' };
function kindLabel(rec) { return KIND_LABEL[String(rec?.kind || '').toLowerCase()] || 'asset'; }

/** Asset display name; falls back to symbol so we never emit "undefined". */
export function displayName(rec) {
  const n = String(rec?.name || '').trim();
  const s = String(rec?.symbol || '').trim().toUpperCase();
  return n || s || 'Asset';
}

/** URL slug for the canonical path: explicit slug, else slugified name, else lowercased symbol. */
export function slugFor(rec) {
  const raw = String(rec?.slug || rec?.name || rec?.symbol || '').toLowerCase().trim();
  const s = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'asset';
}

/** Currency-ish formatting for prices / market caps. Returns null when not a finite number. */
export function fmtMoney(n, currency = 'USD') {
  if (n == null || !Number.isFinite(+n)) return null;
  const v = +n;
  const sym = currency === 'USD' ? '$' : '';
  const abs = Math.abs(v);
  let body;
  if (abs >= 1e12) body = `${(v / 1e12).toFixed(2)}T`;
  else if (abs >= 1e9) body = `${(v / 1e9).toFixed(2)}B`;
  else if (abs >= 1e6) body = `${(v / 1e6).toFixed(2)}M`;
  else if (abs >= 1) body = v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  else body = v.toLocaleString('en-US', { maximumSignificantDigits: 4 });
  return currency === 'USD' ? `${sym}${body}` : `${body} ${currency}`;
}

/** "+2.41%" / "-1.10%" or null. */
export function fmtPct(n) {
  if (n == null || !Number.isFinite(+n)) return null;
  const v = +n;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

// ---- the four head fields ----

/** "Bitcoin (BTC) Price, Chart & Market Cap" */
export function seoTitle(rec) {
  const name = displayName(rec);
  const sym = String(rec?.symbol || '').trim().toUpperCase();
  const label = sym && sym !== name.toUpperCase() ? `${name} (${sym})` : name;
  return `${label} Price, Chart & Market Cap`;
}

/**
 * Record-specific meta description (anti thin-duplicate): folds in the live price, 24h change, market cap
 * and rank when present so no two listing pages share boilerplate.
 */
export function seoDescription(rec) {
  const name = displayName(rec);
  const sym = String(rec?.symbol || '').trim().toUpperCase();
  const ccy = rec?.priceCurrency || 'USD';
  const label = sym && sym !== name.toUpperCase() ? `${name} (${sym})` : name;
  const facts = [];
  const price = fmtMoney(rec?.price, ccy);
  if (price) facts.push(`live price ${price}`);
  const chg = fmtPct(rec?.change24h);
  if (chg) facts.push(`${chg} in 24h`);
  const cap = fmtMoney(rec?.marketCap, ccy);
  if (cap) facts.push(`market cap ${cap}`);
  if (rec?.rank != null && Number.isFinite(+rec.rank)) facts.push(`ranked #${+rec.rank}`);
  const factStr = facts.length ? ` — ${facts.join(', ')}.` : '.';
  return `${label} ${kindLabel(rec)} ${price ? 'price' : 'data'}, interactive chart and market cap on SoapBox${factStr} `
    + `See how to buy ${name}, supply, and ${ccy} conversion with a Clarity transparency score.`;
}

/** "Bitcoin (BTC) Price" — the visible page heading. */
export function seoH1(rec) {
  const name = displayName(rec);
  const sym = String(rec?.symbol || '').trim().toUpperCase();
  const label = sym && sym !== name.toUpperCase() ? `${name} (${sym})` : name;
  return `${label} Price`;
}

/** Absolute canonical URL for this listing under the right section of baseUrl. */
export function canonical(rec, baseUrl = DEFAULT_BASE) {
  const base = String(baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  const section = { crypto: 'coins', stock: 'stocks', etf: 'stocks', index: 'stocks', company: 'companies' }[String(rec?.kind || '').toLowerCase()] || 'assets';
  return `${base}/${section}/${slugFor(rec)}`;
}

// ---- FAQ: the real long-tail query patterns, answered with record facts ----

/**
 * Q&A pairs that (a) mirror the actual searches — price / to USD / chart / market cap / how to buy —
 * and (b) answer with this record's facts so the copy is unique per page. Used both on-page and in the
 * FAQPage schema, so they stay in sync by construction.
 */
export function faqPairs(rec) {
  const name = displayName(rec);
  const sym = String(rec?.symbol || '').trim().toUpperCase();
  const ccy = rec?.priceCurrency || 'USD';
  const price = fmtMoney(rec?.price, ccy);
  const cap = fmtMoney(rec?.marketCap, ccy);
  const chg = fmtPct(rec?.change24h);
  const label = sym ? `${name} (${sym})` : name;

  const pairs = [
    {
      q: `What is the price of ${name} today?`,
      a: price
        ? `${label} is trading at ${price}${chg ? `, ${chg} over the last 24 hours` : ''}. The live ${name} price updates on this page.`
        : `The live ${label} price is shown at the top of this page and updates continuously.`,
    },
    {
      q: `How much is ${sym || name} to USD?`,
      a: price
        ? `1 ${sym || name} is worth about ${price}. Use the converter on this page for any ${sym || name}-to-USD amount.`
        : `Use the ${name} to USD converter on this page to see the current value of any amount of ${sym || name}.`,
    },
    {
      q: `Where can I see the ${name} chart?`,
      a: `The interactive ${name} price chart is on this page, with intraday, daily, and historical ranges for ${label}.`,
    },
    {
      q: `What is the market cap of ${name}?`,
      a: cap
        ? `${label} has a market cap of ${cap}${rec?.rank != null && Number.isFinite(+rec.rank) ? `, ranking it #${+rec.rank}` : ''}.`
        : `${label}'s market cap is shown in the stats panel on this page alongside supply and volume.`,
    },
    {
      q: `How do I buy ${name}?`,
      a: `You can buy ${label} on supported exchanges. This page lists where ${name} trades; always verify the asset's Clarity score and do your own research before buying.`,
    },
  ];
  return pairs;
}

// ---- JSON-LD: Dataset + FAQPage + BreadcrumbList in one @graph ----

/** A <script type="application/ld+json"> block from a plain object. Guards the </script> sequence. */
export function jsonLdScript(obj) {
  if (!obj) return '';
  const json = JSON.stringify(obj).replace(/<\/(script)/gi, '<\\/$1');
  return `<script type="application/ld+json">${json}</script>`;
}

function datasetNode(rec, url) {
  const name = displayName(rec);
  const sym = String(rec?.symbol || '').trim().toUpperCase();
  const node = {
    '@type': 'Dataset',
    '@id': `${url}#dataset`,
    name: `${sym ? `${name} (${sym})` : name} price & market data`,
    description: seoDescription(rec).trim(),
    url,
    keywords: [name, sym, `${name} price`, `${name} chart`, `${name} market cap`, `how to buy ${name}`].filter(Boolean),
    variableMeasured: [
      { '@type': 'PropertyValue', name: 'Price', value: rec?.price != null && Number.isFinite(+rec.price) ? +rec.price : undefined, unitText: rec?.priceCurrency || 'USD' },
      { '@type': 'PropertyValue', name: 'Market Cap', value: rec?.marketCap != null && Number.isFinite(+rec.marketCap) ? +rec.marketCap : undefined, unitText: rec?.priceCurrency || 'USD' },
      { '@type': 'PropertyValue', name: '24h Change', value: rec?.change24h != null && Number.isFinite(+rec.change24h) ? +rec.change24h : undefined, unitText: 'PERCENT' },
    ].map((v) => { if (v.value === undefined) delete v.value; return v; }),
    creator: { '@type': 'Organization', name: 'SoapBox', url: 'https://soapbox.community' },
  };
  return node;
}

function faqNode(rec, url) {
  return {
    '@type': 'FAQPage',
    '@id': `${url}#faq`,
    mainEntity: faqPairs(rec).map((p) => ({
      '@type': 'Question',
      name: p.q,
      acceptedAnswer: { '@type': 'Answer', text: p.a },
    })),
  };
}

function breadcrumbNode(rec, url, baseUrl) {
  const base = String(baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  const sectionLabel = { crypto: 'Coins', stock: 'Stocks', etf: 'Stocks', index: 'Stocks', company: 'Companies' }[String(rec?.kind || '').toLowerCase()] || 'Assets';
  const sectionPath = { crypto: 'coins', stock: 'stocks', etf: 'stocks', index: 'stocks', company: 'companies' }[String(rec?.kind || '').toLowerCase()] || 'assets';
  return {
    '@type': 'BreadcrumbList',
    '@id': `${url}#breadcrumb`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'SoapBox', item: base },
      { '@type': 'ListItem', position: 2, name: sectionLabel, item: `${base}/${sectionPath}` },
      { '@type': 'ListItem', position: 3, name: seoTitle(rec), item: url },
    ],
  };
}

/** Full JSON-LD object (one @graph: Dataset + FAQPage + BreadcrumbList) ready for jsonLdScript(). */
export function structuredData(rec, baseUrl = DEFAULT_BASE) {
  const url = canonical(rec, baseUrl);
  return {
    '@context': 'https://schema.org',
    '@graph': [datasetNode(rec, url), faqNode(rec, url), breadcrumbNode(rec, url, baseUrl)],
  };
}

/** Convenience: the assembled <head> SEO fragment for one listing (string of tags). */
export function listingHead(rec, baseUrl = DEFAULT_BASE) {
  const url = canonical(rec, baseUrl);
  const title = esc(seoTitle(rec));
  const desc = esc(seoDescription(rec).trim());
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${desc}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta name="twitter:card" content="summary">`,
    jsonLdScript(structuredData(rec, baseUrl)),
  ].join('\n');
}

// CLI
if (process.argv[1] && process.argv[1].endsWith('listing-seo.mjs')) {
  const sample = { name: 'Bitcoin', symbol: 'BTC', kind: 'crypto', price: 67000.42, marketCap: 1.32e12, rank: 1, change24h: 2.41, priceCurrency: 'USD' };
  console.log('title      :', seoTitle(sample));
  console.log('h1         :', seoH1(sample));
  console.log('canonical  :', canonical(sample));
  console.log('description:', seoDescription(sample).trim());
  console.log('\nFAQ pairs:');
  for (const p of faqPairs(sample)) console.log(`  Q: ${p.q}\n  A: ${p.a}\n`);
  console.log('JSON-LD:');
  console.log(JSON.stringify(structuredData(sample), null, 2));
}
