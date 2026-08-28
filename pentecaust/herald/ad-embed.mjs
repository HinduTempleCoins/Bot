// pentecaust/herald/ad-embed.mjs — the Herald ad-network PUBLIC LAYER: the embeddable AD UNIT.
//
// This is the AdSense-style front the engine (./ad-network.mjs) never had: the self-contained ad unit a
// publisher drops on their site / video description / their Herald-built page, plus the copy-paste <iframe>
// snippet that loads it. It sits ON TOP of the green rails — it invents no ranking, holds no key, moves no
// funds, signs nothing. HERALD_AD_NETWORK_DESIGN.md §(b) "the external embed (MELEK-optional)".
//
//   • unitSize(fmt)                         → normalize a format keyword → { name, w, h } (IAB-ish sizes).
//   • unitHtml(creative, { pub, baseUrl })  → the ad card: creative headline/body, the required "Ad"
//                                             disclosure label, click-through on the /go/{code} rail carrying
//                                             the publisher id for rev-share attribution. esc() everything.
//   • unitDoc(bodyHtml, { fmt })            → wrap a unit body in a minimal self-contained HTML document for
//                                             an <iframe> (no third-party JS; sandbox-friendly).
//   • snippet(publisherId, slot, { size })  → the copy-paste <iframe> embed code a publisher pastes anywhere.
//   • handler(req, res, opts)               → GET /embed/unit?pub=&slot=&fmt= → the served unit document. The
//                                             `select` + `originsOf` seams are injected by the mounting server
//                                             (site/herald/server.mjs binds the ad-network singleton).
//
// Privacy (matches qr-tracker's rule): the only signal read from a request is the referer HOST — never the
// full URL, never an IP, never PII. The origin allow-list is enforced host-to-host, exactly like the
// billable-click fraud pass (click-validate step 3): a publisher that has declared origins is served a paid
// unit only on those hosts; a publisher with no declared origins is not host-gated (can't fail-closed on an
// unconfigured publisher without breaking every embed — the money gate is click-validate, not this render).
//
// House style: ESM, esc() all interpolation, soft-fail-never-throw, injectable seams, offline.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const envv = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const clean = (s) => String(s == null ? '' : s).trim();
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isId = (s) => ID_RE.test(clean(s).toLowerCase());
const BASE_URL = () => (envv('BASE_URL', 'https://melek.salon') || 'https://melek.salon').replace(/\/$/, '');

// ── ad-unit sizes (IAB-ish standard slots) ─────────────────────────────────────────────────────────────
// Keyed by a friendly keyword AND its WxH form, so `fmt=mrec` and `fmt=300x250` both resolve. Unknown →
// the safe default (medium rectangle). Never throws.
const SIZES = {
  leaderboard: { name: 'leaderboard', w: 728, h: 90 },
  banner: { name: 'banner', w: 468, h: 60 },
  mobile: { name: 'mobile', w: 320, h: 50 },
  mrec: { name: 'mrec', w: 300, h: 250 },
  medium: { name: 'mrec', w: 300, h: 250 },
  rectangle: { name: 'mrec', w: 300, h: 250 },
  halfpage: { name: 'halfpage', w: 300, h: 600 },
  sidebar: { name: 'halfpage', w: 300, h: 600 },
  square: { name: 'square', w: 250, h: 250 },
};
const SIZE_BY_WH = Object.values(SIZES).reduce((m, s) => { m[`${s.w}x${s.h}`] = s; return m; }, {});

// unitSize — normalize a format keyword/dimension into a { name, w, h }. Default: mrec (300×250).
export function unitSize(fmt) {
  const k = clean(fmt).toLowerCase();
  return SIZES[k] || SIZE_BY_WH[k] || SIZES.mrec;
}

// The generic disclosure label every unit carries (FTC / platform-policy "this is an ad").
export const AD_LABEL = 'Ad';

/**
 * unitHtml — render ONE ad unit body (escaped). The creative comes from the engine's select(); this layer
 * owns the click-through so it can carry the publisher id for rev-share attribution:
 *   href = {baseUrl}/go/{code}?pub={publisherId}
 * The /go/{code} rail (qr-tracker) logs a coarse row + 301-redirects to the landing URL; the `pub` param
 * threads the attribution the settlement snapshot splits on (design-only — no funds move here). The "Ad"
 * disclosure label is ALWAYS present. If there is no fillable creative, a house/placeholder unit is returned
 * (still a valid, disclosed slot) so the iframe never renders broken.
 */
export function unitHtml(creative, { pub, baseUrl } = {}) {
  const base = clean(baseUrl) || BASE_URL();
  const pubId = isId(pub) ? clean(pub).toLowerCase() : '';
  const label = `<span class="ad-label" aria-label="Advertisement">${esc(AD_LABEL)}</span>`;
  const c = creative && typeof creative === 'object' ? creative : null;
  const code = c ? clean(c.code).toLowerCase() : '';

  if (!c || !code) {
    // House/placeholder unit — no fill. Still labeled and inert (no click-through to fabricate).
    return `<div class="herald-unit house">${label}`
      + `<div class="ad-headline">Advertise here</div>`
      + `<div class="ad-body">This slot is part of the Herald ad network.</div></div>`;
  }

  const q = pubId ? `?pub=${encodeURIComponent(pubId)}` : '';
  const href = `${base}/go/${encodeURIComponent(code)}${q}`;
  return `<div class="herald-unit"${pubId ? ` data-pub="${esc(pubId)}"` : ''} data-code="${esc(code)}">${label}`
    + `<a class="ad-cta" href="${esc(href)}" rel="sponsored nofollow noopener" target="_blank">`
    + `<span class="ad-headline">${esc(c.headline || 'Sponsored')}</span>`
    + (c.body ? `<span class="ad-body">${esc(c.body)}</span>` : '')
    + `</a></div>`;
}

const UNIT_STYLE = `*{box-sizing:border-box}html,body{margin:0;padding:0}`
  + `body{font:13px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#fff;color:#111}`
  + `.herald-unit{position:relative;width:100%;height:100%;border:1px solid #e3e3e3;border-radius:8px;`
  + `padding:10px 12px;overflow:hidden;display:flex;flex-direction:column;justify-content:center}`
  + `.ad-label{position:absolute;top:4px;right:5px;font-size:9px;font-weight:700;letter-spacing:.04em;`
  + `text-transform:uppercase;color:#555;background:#f2f2f2;border:1px solid #e0e0e0;border-radius:3px;padding:0 4px}`
  + `.ad-cta{display:block;text-decoration:none;color:inherit}`
  + `.ad-headline{display:block;font-weight:700;font-size:15px;margin:2px 0 4px;color:#0a58ca}`
  + `.ad-body{display:block;color:#333;font-size:12px}`
  + `.house .ad-headline{color:#666}`;

/**
 * unitDoc — wrap a unit body into a full, self-contained HTML document for an <iframe> body. No third-party
 * JS, no network fetch — everything needed is inline, so it renders inside a sandboxed frame.
 */
export function unitDoc(bodyHtml, { fmt } = {}) {
  const size = unitSize(fmt);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="robots" content="noindex,nofollow">`
    + `<title>${esc(AD_LABEL)}</title><style>${UNIT_STYLE}</style></head>`
    + `<body>${bodyHtml == null ? '' : bodyHtml}</body></html>`;
}

/**
 * snippet — the copy-paste embed code a publisher pastes on their site, in a video description link-out, or
 * on their Herald-built page. A plain <iframe> (no third-party JS to trust), sandboxed to allow only the
 * click-out popup. esc() on every interpolated value.
 *   snippet('melek-salon', 'sponsored', { size: 'mrec' })
 */
export function snippet(publisherId, slot, { size, baseUrl } = {}) {
  const base = (clean(baseUrl) || BASE_URL()).replace(/\/$/, '');
  const pub = isId(publisherId) ? clean(publisherId).toLowerCase() : '';
  const sl = clean(slot).toLowerCase() || 'sponsored';
  const sz = unitSize(size);
  const src = `${base}/embed/unit?pub=${encodeURIComponent(pub)}&slot=${encodeURIComponent(sl)}&fmt=${encodeURIComponent(sz.name)}`;
  return `<iframe src="${esc(src)}" width="${sz.w}" height="${sz.h}" `
    + `style="border:0;overflow:hidden" scrolling="no" frameborder="0" loading="lazy" `
    + `sandbox="allow-popups allow-popups-to-escape-sandbox" `
    + `title="${esc('Advertisement')}"></iframe>`;
}

// resolveOrigins — a publisher's declared origin hosts, via an `originsOf` seam that may be a function
// (publisherId → [hosts]) or a plain map. NULL means "no allow-list declared" → not host-gated here.
function resolveOrigins(originsOf, publisherId) {
  let list = null;
  if (typeof originsOf === 'function') { try { list = originsOf(publisherId); } catch { list = null; } }
  else if (originsOf && typeof originsOf === 'object') list = originsOf[publisherId];
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.map(normHost).filter(Boolean);
}

// Coarse host normalizer — lowercase, strip scheme/www./port/path. Matches click-validate.normHost so the
// embed gate and the billable gate agree on what an "origin" is.
export function normHost(h) {
  let s = clean(h).toLowerCase();
  if (!s) return '';
  s = s.replace(/^https?:\/\//, '').split('/')[0].split('?')[0];
  s = s.replace(/:\d+$/, '').replace(/^www\./, '');
  return s.slice(0, 160);
}

// The referer HOST only — the sole request signal we read (no full URL, no IP, no PII).
function refererHost(req) {
  const raw = (req && req.headers && (req.headers.referer || req.headers.referrer)) || '';
  if (!raw) return '';
  try { return normHost(new URL(String(raw)).host); } catch {}
  return normHost(raw);
}

const sendHtml = (res, sc, html) => {
  try {
    res.writeHead(sc, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // The unit is meant to be framed by publishers — do NOT send X-Frame-Options/frame-ancestors:none.
      'x-robots-tag': 'noindex, nofollow',
    });
  } catch {}
  try { res.end(html == null ? '' : html); } catch {}
};

/**
 * handler — GET /embed/unit?pub=&slot=&fmt= → the served ad-unit document (for an <iframe>). Soft-fail:
 * always returns 200 with a valid, disclosed unit; on any refusal (bad pub / off-origin / no fill) it serves
 * a house placeholder rather than a broken frame, and drops a hidden HTML comment naming the reason.
 *
 * @param opts.select    fn({ slot, publisherId }) → { ok, creative, html }  (the ad-network engine's select).
 * @param opts.originsOf fn(publisherId)→[hosts] or map — the per-publisher origin allow-list.
 * @param opts.baseUrl   override the /go rail base (defaults to BASE_URL env).
 */
export async function handler(req, res, opts = {}) {
  try {
    const method = ((req && req.method) || 'GET').toUpperCase();
    const rawUrl = String((req && req.url) || '/');
    const qi = rawUrl.indexOf('?');
    const path = (qi >= 0 ? rawUrl.slice(0, qi) : rawUrl).replace(/\/+$/, '') || '/';
    const query = new URLSearchParams(qi >= 0 ? rawUrl.slice(qi + 1) : '');

    if (path === '/embed/health' && method === 'GET') {
      return sendHtml(res, 200, '<!-- herald-ad-embed ok -->');
    }
    if (path !== '/embed/unit' || method !== 'GET') {
      return sendHtml(res, 404, unitDoc(`${unitHtml(null, {})}<!-- herald embed: not-found -->`, {}));
    }

    const pub = query.get('pub') || '';
    const slot = query.get('slot') || 'sponsored';
    const fmt = query.get('fmt') || 'mrec';
    const baseUrl = opts.baseUrl;

    const houseDoc = (reason) => unitDoc(`${unitHtml(null, { pub, baseUrl })}<!-- herald embed: ${esc(reason)} -->`, { fmt });

    if (!isId(pub)) return sendHtml(res, 200, houseDoc('invalid-publisher'));

    // Origin allow-list (host-to-host, referer HOST only). Enforced only where the publisher declared one.
    const origins = resolveOrigins(opts.originsOf, clean(pub).toLowerCase());
    if (origins) {
      const host = refererHost(req);
      // A declared allow-list + a referer that isn't on it → refuse a paid unit (serve house instead).
      if (host && !origins.includes(host)) return sendHtml(res, 200, houseDoc('origin-not-allowed'));
    }

    // Pull the creative from the engine. No select seam / no fill → house unit (still disclosed).
    let picked = null;
    if (typeof opts.select === 'function') {
      try { picked = opts.select({ slot, publisherId: clean(pub).toLowerCase() }); } catch { picked = null; }
    }
    if (!picked || !picked.ok || !picked.creative) return sendHtml(res, 200, houseDoc('no-fill'));

    const body = unitHtml(picked.creative, { pub, baseUrl });
    return sendHtml(res, 200, unitDoc(body, { fmt }));
  } catch {
    // Never throw across the frame boundary — a valid empty unit is always better than a 500 in an iframe.
    try { return sendHtml(res, 200, unitDoc(unitHtml(null, {}), {})); } catch { return; }
  }
}

// ── CLI (guarded) — print a sample snippet + a rendered unit doc (no disk, no network) ───────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const PORT = +(envv('PORT', '8166'));
  const HOST = envv('HOST', '127.0.0.1');
  if (envv('EMBED_DEMO')) {
    // eslint-disable-next-line no-console
    console.log(snippet('melek-salon', 'sponsored', { size: 'mrec' }));
    // eslint-disable-next-line no-console
    console.log(unitDoc(unitHtml({ code: 'offer-01', headline: 'Try the offer', body: 'A real deal.' }, { pub: 'melek-salon' }), { fmt: 'mrec' }));
  } else {
    createServer((req, res) => handler(req, res)).listen(PORT, HOST, () => {
      // eslint-disable-next-line no-console
      console.log(`herald ad-embed on http://${HOST}:${PORT}  (BASE_URL=${BASE_URL()})`);
    });
  }
}
