// page-meta.mjs — make any finished HTML page measurable and share-ready, without touching its copy.
//
// Two post-processors over a complete HTML string, used by the web dispatcher, the condenser/wallet
// proxies and the static page builders:
//
//   ensureBeacon(html)       — adds the first-party, cookieless pageview beacon (seo.mjs analyticsBeaconTag,
//                              posting to analytics.soapbox.community/px) when the page does not carry it.
//   ensureSocialMeta(html)   — fills in the link-preview tags Facebook / X / LinkedIn read, using ONLY what the
//                              page already says: og:title from <title>, og:description from the meta
//                              description, og:url from the canonical link, and a 1200x630 share card for
//                              og:image when the page has no image of its own. A tag the page already sets
//                              is never replaced (twitter:card "summary" is upgraded to "summary_large_image"
//                              only when we supplied the large card).
//
// Both are idempotent, soft-fail (anything unexpected returns the input unchanged) and act only when the
// whole <head> is present in the string they are given.

import { analyticsBeaconTag } from './seo.mjs';

export const DEFAULT_BEACON_URL = 'https://analytics.soapbox.community/px';
const beaconUrl = () => (typeof process !== 'undefined' && process.env && process.env.ANALYTICS_BEACON_URL) || DEFAULT_BEACON_URL;

// Share cards: existing logos centred on a 1200x630 canvas (site/melek-og/), served at melek.salon/og/.
const OG = 'https://melek.salon/og/';
export const SHARE_CARDS = {
  melek: { url: `${OG}melek-card.png`, width: 1200, height: 630, alt: 'MELEK' },
  kula: { url: `${OG}kula-card.png`, width: 1200, height: 630, alt: 'KULA' },
  vankush: { url: `${OG}vankush-card.png`, width: 1200, height: 630, alt: 'Van Kush' },
};

/** Which card a host gets when its page has no image. */
export function cardForHost(host = '') {
  const h = String(host).toLowerCase().replace(/^www\./, '');
  if (/(^|\.)kula\.money$/.test(h)) return SHARE_CARDS.kula;
  if (/(^|\.)vankushfamily\.com$/.test(h)) return SHARE_CARDS.vankush;
  return SHARE_CARDS.melek;
}

// header logos that are not share images (wide wordmarks)
export const WEAK_IMAGE = /\/images\/logo\.png(?:[?#]|$)/i;

const attrEsc = (s) => String(s == null ? '' : s).replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decode = (s) => String(s || '').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function headOf(html) {
  const s = html.search(/<head[\s>]/i);
  const e = html.indexOf('</head>');
  if (s < 0 || e < 0 || e < s) return null;
  return { start: s, end: e, head: html.slice(s, e) };
}

// a <meta> carrying property|name = key; returns its content (raw) or null
function metaContent(head, key) {
  const re = new RegExp(`<meta\\b[^>]*\\b(?:property|name)\\s*=\\s*["']?${key.replace(/[.:]/g, '\\$&')}["']?[\\s/>][^>]*>`, 'i');
  const m = re.exec(head);
  if (!m) return null;
  const c = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[0]);
  return c ? (c[1] ?? c[2] ?? c[3] ?? '') : '';
}

/** Add the analytics beacon before </head> unless the page already posts to the collector. */
export function ensureBeacon(html, url = beaconUrl()) {
  try {
    if (typeof html !== 'string' || !url) return html;
    const h = headOf(html);
    if (!h || html.includes(url)) return html;
    return html.slice(0, h.end) + analyticsBeaconTag(url) + html.slice(h.end);
  } catch { return html; }
}

/**
 * Fill in missing Open Graph / Twitter tags from what the page already says.
 * opts: { card?: {url,width,height,alt}, host?: string, siteName?: string, url?: string }
 */
export function ensureSocialMeta(html, opts = {}) {
  try {
    if (typeof html !== 'string') return html;
    let h = headOf(html);
    if (!h) return html;
    // Open Graph is defined on property=; some front ends (the condenser) emit name="og:…", which
    // LinkedIn and Facebook's stricter parsers skip. Same tag, right attribute.
    if (/<meta\b[^>]*\bname\s*=\s*["']og:/i.test(h.head)) {
      const fixed = h.head.replace(/(<meta\b[^>]*?\b)name(\s*=\s*["']og:)/gi, '$1property$2');
      html = html.slice(0, h.start) + fixed + html.slice(h.end);
      h = headOf(html);
    }
    // A site's wide header logo used as og:image (the wallet's 1513x449 /images/logo.png) is cropped badly
    // by every network; those tags are dropped so the 1200x630 card below takes their place.
    const weak = opts.weakImage === undefined ? WEAK_IMAGE : opts.weakImage;
    if (weak) {
      const ogi = metaContent(h.head, 'og:image');
      if (ogi && weak.test(ogi)) {
        const fixed = h.head.replace(/<meta\b[^>]*\b(?:property|name)\s*=\s*["']?(?:og:image(?::(?:width|height|alt|type|secure_url))?|twitter:image)["']?[\s/>][^>]*>/gi, '');
        html = html.slice(0, h.start) + fixed + html.slice(h.end);
        h = headOf(html);
      }
    }
    const head = h.head;
    const card = opts.card || cardForHost(opts.host);
    const titleM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
    const title = titleM ? decode(titleM[1].trim()) : '';
    const desc = metaContent(head, 'description');
    const canonM = /<link\b[^>]*\brel\s*=\s*["']?canonical["']?[^>]*>/i.exec(head);
    const canon = canonM ? ((/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(canonM[0]) || [])).slice(1).find((x) => x != null) : '';
    const url = canon || opts.url || '';
    const add = [];
    const has = (k) => metaContent(head, k) != null;
    const prop = (k, v) => add.push(`<meta property="${k}" content="${attrEsc(v)}">`);
    const name = (k, v) => add.push(`<meta name="${k}" content="${attrEsc(v)}">`);

    const ogTitle = metaContent(head, 'og:title');
    const ogDesc = metaContent(head, 'og:description');
    if (ogTitle == null && title) prop('og:title', title);
    if (ogDesc == null && desc) prop('og:description', decode(desc));
    if (!has('og:type')) prop('og:type', 'website');
    if (!has('og:url') && url) prop('og:url', url);
    if (!has('og:site_name') && opts.siteName) prop('og:site_name', opts.siteName);
    let ogImage = metaContent(head, 'og:image');
    let supplied = false;
    if (!ogImage && card && card.url) {
      supplied = true; ogImage = card.url;
      prop('og:image', card.url);
      prop('og:image:width', String(card.width));
      prop('og:image:height', String(card.height));
      if (card.alt) prop('og:image:alt', card.alt);
    }
    const tc = metaContent(head, 'twitter:card');
    let out = html;
    if (tc == null) name('twitter:card', ogImage ? 'summary_large_image' : 'summary');
    else if (supplied && tc === 'summary') {
      // the page asked for a small card only because it had no image; we gave it a wide one
      const headNew = head.replace(/(<meta\b[^>]*\bname\s*=\s*["']?twitter:card["']?[^>]*\bcontent\s*=\s*["']?)summary(["']?)/i, '$1summary_large_image$2');
      out = html.slice(0, h.start) + headNew + html.slice(h.end);
    }
    if (!has('twitter:title') && (ogTitle || title)) name('twitter:title', ogTitle ? decode(ogTitle) : title);
    if (!has('twitter:description') && (ogDesc || desc)) name('twitter:description', decode(ogDesc || desc));
    if (!has('twitter:image') && ogImage) name('twitter:image', decode(ogImage));
    if (!add.length) return out;
    const end = out.indexOf('</head>');
    return out.slice(0, end) + add.join('') + out.slice(end);
  } catch { return html; }
}

/** Both, in one call: what every public page should get. */
export function finishPage(html, opts = {}) {
  return ensureBeacon(ensureSocialMeta(html, opts), opts.beaconUrl || beaconUrl());
}

/**
 * Patch an http.ServerResponse so a single-shot HTML body (res.end(html)) goes through finishPage().
 * Streaming responses (any res.write() before end), compressed bodies and non-HTML pass through untouched.
 * opts as finishPage; opts.host defaults to the request's Host header when `req` is given.
 */
export function finishHtmlResponses(res, opts = {}, req = null) {
  try {
    if (!res || typeof res.end !== 'function' || res.__pageMeta) return res;
    res.__pageMeta = true;
    const host = opts.host || (req && req.headers && String(req.headers.host || '').split(':')[0]) || '';
    const pathOnly = req && req.url ? String(req.url).split('?')[0] : '';
    const o = { ...opts, host, url: opts.url || (host && pathOnly && !/^(localhost|[\d.]+)$/.test(host) ? `https://${host}${pathOnly}` : '') };
    const wh = res.writeHead.bind(res), w = res.write.bind(res), e = res.end.bind(res);
    let pending = null; // deferred writeHead args
    const typeOf = (hdrs) => {
      let ct = typeof res.getHeader === 'function' ? res.getHeader('content-type') : '';
      let enc = typeof res.getHeader === 'function' ? res.getHeader('content-encoding') : '';
      if (hdrs && typeof hdrs === 'object') for (const [k, v] of Object.entries(hdrs)) {
        if (k.toLowerCase() === 'content-type') ct = v;
        if (k.toLowerCase() === 'content-encoding') enc = v;
      }
      return { html: /text\/html/i.test(String(ct || '')), enc: !!enc };
    };
    const flush = () => { if (pending) { const p = pending; pending = null; wh(...p); } };
    res.writeHead = (...args) => {
      const hdrs = args.find((a, i) => i > 0 && a && typeof a === 'object' && !Array.isArray(a));
      const t = typeOf(hdrs);
      if (t.html && !t.enc) { pending = args; return res; }
      return wh(...args);
    };
    res.write = (...args) => { flush(); return w(...args); };
    res.end = (chunk, ...rest) => {
      const isBody = typeof chunk === 'string' || Buffer.isBuffer(chunk);
      const hdrs = pending ? pending.find((a, i) => i > 0 && a && typeof a === 'object' && !Array.isArray(a)) : null;
      const t = typeOf(hdrs);
      if (isBody && t.html && !t.enc && !res.headersSent) {
        const str = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
        const out = finishPage(str, o);
        if (out !== str) {
          chunk = out;
          if (hdrs) for (const k of Object.keys(hdrs)) if (k.toLowerCase() === 'content-length') hdrs[k] = Buffer.byteLength(out);
          if (typeof res.getHeader === 'function' && res.getHeader('content-length') != null) res.setHeader('content-length', Buffer.byteLength(out));
        }
      }
      flush();
      return e(chunk, ...rest);
    };
  } catch { /* soft-fail: leave the response as it was */ }
  return res;
}
