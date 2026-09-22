// serve.mjs — the ad-SERVE half of the market: pick an ad for a slot and render it as our OWN unit.
//
// This is what ad-slot.mjs calls when AdSense is off ("house/sold ad" mode). Two ad sources, in order:
//   1. a SOLD ad — an active, budget-remaining campaign for the slot (model.pickAd)
//   2. a HOUSE ad — one of our own promos (signup / witness / engine / pool), served for free when there
//      is no sold demand, so a slot is never empty and we're always warming inventory. (Phase 1.)
//
// The rendered unit lives inside the SAME `.ad-slot[data-ad-placement]` wrapper the existing tracker
// (ad-slot.adTrackerJs) already watches — so impressions (IntersectionObserver) and clicks (rel=sponsored)
// are measured by the collector we already have, with ZERO new client code. For exact PER-CAMPAIGN
// billing, the creative link is routed through a first-party click endpoint (`clickBase`/serveSlot) that
// meters the click server-side before redirecting; impressions are metered at serve time.
//
// EVERYTHING interpolated goes through esc(). Soft-fail: a render problem returns '' (never breaks a page).
//
//   import { renderSoldAd, pickForSlot, serveSlot, HOUSE_ADS } from './serve.mjs'

import { pickAd, recordServe, getCampaign } from './model.mjs';

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── house ads: our own promos, always available, never billed ──────────────────────────────────────────
// A house ad is the SAME shape as a sold creative ({ headline, body, url }) plus id:'house:*'. These
// point at real MELEK surfaces so an empty slot still does useful work. Add/adjust freely.
export const HOUSE_ADS = Object.freeze([
  { id: 'house:signup', headline: 'Join MELEK', body: 'Claim your on-chain account — free, 60 seconds.', url: 'https://wallet.melek.salon/signup', house: true },
  { id: 'house:witness', headline: 'Witness School', body: 'Learn how the MELEK chain is produced and secured.', url: 'https://witness.melek.salon', house: true },
  { id: 'house:engine', headline: 'Launch a Token', body: 'Create your own token tribe on MELEK-Engine.', url: 'https://engine.melek.salon', house: true },
  { id: 'house:pool', headline: 'Mine in Your Browser', body: 'No install — earn from the MELEK mining pool.', url: 'https://pool.soapbox.community', house: true },
]);

/** Deterministic house-ad pick (rotates by opts.rotate; else the first). Returns a house-ad object. */
export function pickHouseAd(opts = {}) {
  const list = Array.isArray(opts.houseAds) && opts.houseAds.length ? opts.houseAds : HOUSE_ADS;
  const r = Number.isFinite(opts.rotate) ? Math.abs(Math.floor(opts.rotate)) : 0;
  return list[r % list.length];
}

// ── the renderer ────────────────────────────────────────────────────────────────────────────────────────
/**
 * renderSoldAd(ad, opts) — one served ad as an `.ad-slot` unit. `ad` is a campaign view OR a house-ad
 * object ({ id, creative:{headline,body,url,image} } | { id, headline, body, url, house }). opts.placement
 * is stamped as data-ad-placement (the tracking key). opts.clickBase, when set, routes the click through a
 * first-party metering redirect: `${clickBase}?c=<id>&p=<placement>` (server 302s to the real url after
 * billing). Returns HTML, or '' on any problem. NEVER throws.
 */
export function renderSoldAd(ad, opts = {}) {
  try {
    if (!ad) return '';
    const cre = ad.creative && typeof ad.creative === 'object' ? ad.creative : ad;
    const headline = String(cre.headline || '').trim();
    const url = String(cre.url || '').trim();
    if (!headline || !url) return '';
    const body = String(cre.body || '').trim();
    const image = String(cre.image || '').trim();
    const id = String(ad.id || '').slice(0, 96);
    const placement = String(opts.placement || ad.placement || 'slot').slice(0, 64);
    const isHouse = !!ad.house || id.startsWith('house:');

    // click destination: first-party metering redirect when clickBase is set, else the creative url direct.
    let href = url;
    if (opts.clickBase && id) {
      const base = String(opts.clickBase).replace(/\/+$/, '');
      href = `${base}?c=${encodeURIComponent(id)}&p=${encodeURIComponent(placement)}`;
    }

    const label = isHouse ? 'MELEK' : 'Sponsored';           // honest disclosure (FTC): every non-house ad says Sponsored
    const img = image ? `<img class="ad-sold__img" src="${esc(image)}" alt="" loading="lazy">` : '';
    const bodyHtml = body ? `<span class="ad-sold__body">${esc(body)}</span>` : '';
    return `<div class="ad-slot ad-slot--sold${isHouse ? ' ad-slot--house' : ''}" data-ad-placement="${esc(placement)}" data-ad-campaign="${esc(id)}" role="complementary" aria-label="advertisement">`
      + `<a class="ad-sold__link" href="${esc(href)}" rel="sponsored nofollow noopener" target="_blank">`
      + img
      + `<span class="ad-sold__txt"><span class="ad-sold__headline">${esc(headline)}</span>${bodyHtml}</span>`
      + `</a>`
      + `<span class="ad-slot__spon">${esc(label)}</span>`
      + `</div>`;
  } catch { return ''; }
}

/**
 * pickForSlot(store, placement, opts) — choose the ad object to serve: a sold campaign if any, else a
 * house ad (unless opts.house === false, in which case null → nothing/placeholder). Returns { ad, sold }.
 */
export function pickForSlot(store, placement, opts = {}) {
  const sold = store ? pickAd(store, placement, opts) : null;
  if (sold) return { ad: sold, sold: true };
  if (opts.house === false) return { ad: null, sold: false };
  return { ad: pickHouseAd(opts), sold: false };
}

/**
 * serveSlot(store, placement, opts) — the full serve: pick + (optionally) meter one impression + render.
 * opts.meter (default true) records an impression against a SOLD campaign at serve time (house ads are
 * never billed). Returns { html, ad, sold, charged }. NEVER throws — html '' on failure.
 */
export function serveSlot(store, placement, opts = {}) {
  try {
    const { ad, sold } = pickForSlot(store, placement, opts);
    if (!ad) return { html: '', ad: null, sold: false, charged: '0' };
    let charged = '0';
    if (sold && opts.meter !== false && store) {
      const r = recordServe(store, ad.id, { type: 'impression', eventId: opts.eventId });
      if (r && r.ok && r.served) charged = r.charged || '0';
      // if the impression exhausted the budget, fall back to a house ad so the slot still fills.
      if (r && r.ok && !r.served) {
        const h = pickHouseAd(opts);
        return { html: renderSoldAd(h, { placement, clickBase: opts.clickBase }), ad: h, sold: false, charged: '0' };
      }
    }
    return { html: renderSoldAd(ad, { placement, clickBase: opts.clickBase }), ad, sold, charged };
  } catch { return { html: '', ad: null, sold: false, charged: '0' }; }
}

/**
 * meterClick(store, campaignId) — bill one click (CPC) against a sold campaign. House ads / unknown ids
 * are a free no-op. Returns { ok, billed, charged, url } — url is the campaign's creative to redirect to.
 * The click endpoint (server.mjs) calls this then 302s to `url`.
 */
export function meterClick(store, campaignId) {
  const id = String(campaignId || '');
  if (!id || id.startsWith('house:')) {
    const h = HOUSE_ADS.find((a) => a.id === id);
    return { ok: true, billed: false, charged: '0', url: h ? h.url : null };
  }
  const c = store ? getCampaign(store, id) : null;
  if (!c) return { ok: false, billed: false, charged: '0', url: null };
  const r = recordServe(store, id, { type: 'click' });
  return { ok: true, billed: !!(r && r.served && r.charged !== '0'), charged: (r && r.charged) || '0', url: c.creative && c.creative.url };
}

/** The CSS for the sold/house unit — folds into a page's <style> next to ad-slot.slotStyles(). */
export function soldStyles() {
  return `.ad-slot--sold{display:block;position:relative;border:1px solid var(--line2,#30363d);border-radius:10px;background:var(--panel,#161b22);overflow:hidden}
.ad-sold__link{display:flex;gap:12px;align-items:center;padding:12px 14px;text-decoration:none;color:inherit}
.ad-sold__img{width:64px;height:64px;object-fit:cover;border-radius:8px;flex:0 0 auto}
.ad-sold__txt{display:flex;flex-direction:column;gap:2px;min-width:0}
.ad-sold__headline{font-weight:600;color:var(--fg,#e6edf3)}
.ad-sold__body{font-size:13px;color:var(--mut,#8b949e)}
.ad-slot__spon{position:absolute;top:6px;right:8px;font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--mut,#8b949e);opacity:.75}`;
}

// ── CLI — offline demo ──────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('serve.mjs')) {
  console.log('admarket/serve — house + sold ad rendering\n' + '─'.repeat(64));
  console.log('house ad:\n', renderSoldAd(pickHouseAd({ rotate: 0 }), { placement: 'law-top' }));
  console.log('\nsold ad (with click metering redirect):\n', renderSoldAd(
    { id: 'camp_1', creative: { headline: 'Acme Legal', body: 'Fast case lookup', url: 'https://example.com' } },
    { placement: 'law-top', clickBase: 'https://ads.melek.salon/click' }));
}
