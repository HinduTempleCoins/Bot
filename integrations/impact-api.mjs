// impact-api.mjs — SERVER-SIDE Impact.com Mediapartner API adapter (the "populate from Impact" engine).
//
// The UTT (integrations/impact-utt.mjs) is CLIENT-SIDE — it transforms outbound merchant links once a
// page is loaded. THIS module is the SERVER-SIDE half: it pulls your APPROVED campaigns (advertisers),
// their product CATALOGS, and their DEALS/promo codes from the Impact REST API, so verticals (coupons,
// hotel/travel, insurance, …) can be POPULATED with real, approved offers — not just tagged.
//
// COVERAGE REALITY: Impact is a network of individual advertiser programs. `listCampaigns()` returns
// ONLY the advertisers you've been APPROVED for — that is your true coverage. Anything not there, you
// apply to per-advertiser in the Impact marketplace. This module never invents an offer.
//
// AUTH: HTTP Basic — username = IMPACT_ACCOUNT_SID, password = IMPACT_AUTH_TOKEN (both from Impact →
//   Settings → API / Technical Settings). Neither is ever logged. Unset → configured() is false and
//   every reader SOFT-FAILS to [] (nothing fake, nothing thrown).
//
//   import { configured, listCampaigns, campaignsByCategory, listDeals, catalogItems, offersForVertical } from './impact-api.mjs';
//   const offers = await offersForVertical('hotel');   // [] until the token is set + you're approved
//
// Injectable fetch (__setFetch) so tests run fully offline. Soft-fail-never-throw.

const BASE = () => (process.env.IMPACT_API_BASE || 'https://api.impact.com').replace(/\/$/, '');
const SID = () => process.env.IMPACT_ACCOUNT_SID || '';
const TOKEN = () => process.env.IMPACT_AUTH_TOKEN || '';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

/** True only when BOTH the Account SID and the Auth Token are present (server-side credentials). */
export function configured() { return !!(SID() && TOKEN()); }

// Basic auth header from SID:Token. Never logged. Returns null when unconfigured.
function authHeader() {
  if (!configured()) return null;
  const b64 = Buffer.from(`${SID()}:${TOKEN()}`).toString('base64');
  return `Basic ${b64}`;
}

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const str = (v) => (v == null ? '' : String(v)).trim();

// One authenticated GET → parsed JSON, or null on any failure (unconfigured, HTTP error, throw).
async function get(path, params = {}, timeout = 15000) {
  const auth = authHeader();
  if (!auth) return null;
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE()}/Mediapartners/${encodeURIComponent(SID())}${path}${qs ? `?${qs}` : ''}`;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await _fetch(url, { headers: { authorization: auth, accept: 'application/json' }, signal: ctrl.signal });
    if (!r || (typeof r.ok === 'boolean' && !r.ok)) return null;
    return typeof r.json === 'function' ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}

// ── campaigns (the advertisers you're APPROVED for = your coverage) ──────────────────────────────
/**
 * Your approved advertiser programs. Soft-fails to []. Each normalized:
 *   { id, name, category, trackingLink, contractStatus, allowsDeepLinking }
 */
export async function listCampaigns() {
  const j = await get('/Campaigns', { PageSize: '200' });
  const rows = j && Array.isArray(j.Campaigns) ? j.Campaigns : [];
  return rows.map((c) => ({
    id: str(c.CampaignId || c.Id),
    name: str(c.CampaignName || c.AdvertiserName || c.Name),
    category: str(c.Category || c.CampaignCategory || ''),
    trackingLink: str(c.TrackingLink || c.LandingPageUrl || ''),
    contractStatus: str(c.ContractStatus || c.Status || ''),
    allowsDeepLinking: c.AllowDeepLinking === true || c.AllowDeepLinking === 'true',
  })).filter((c) => c.id || c.name);
}

// Map our verticals to the category keywords an Impact campaign might carry.
const VERTICAL_KEYWORDS = {
  coupons: ['coupon', 'deal', 'cashback', 'retail', 'shopping', 'apparel', 'department'],
  hotel: ['hotel', 'travel', 'lodging', 'vacation', 'booking', 'accommodation', 'flights', 'trip'],
  insurance: ['insurance', 'insurtech', 'auto insurance', 'home insurance', 'life insurance', 'financial'],
};

/** Campaigns whose category matches a vertical's keywords (coupons|hotel|insurance|<any>). */
export async function campaignsByCategory(vertical) {
  const key = str(vertical).toLowerCase();
  const kws = VERTICAL_KEYWORDS[key] || [key];
  const all = await listCampaigns();
  return all.filter((c) => {
    const hay = `${c.name} ${c.category}`.toLowerCase();
    return kws.some((k) => k && hay.includes(k));
  });
}

// ── deals / promo codes (the coupons) ────────────────────────────────────────────────────────────
/**
 * Active deals / promo codes across your campaigns. Soft-fails to []. Each:
 *   { id, campaignId, advertiser, name, code, discount, description, url, starts, expires }
 */
export async function listDeals({ campaignId } = {}) {
  const params = { PageSize: '200' };
  if (campaignId) params.CampaignId = campaignId;
  const j = await get('/Deals', params);
  const rows = j && Array.isArray(j.Deals) ? j.Deals : [];
  return rows.map((d) => ({
    id: str(d.Id || d.DealId),
    campaignId: str(d.CampaignId),
    advertiser: str(d.AdvertiserName || d.CampaignName),
    name: str(d.Name || d.Description),
    code: str(d.CouponCode || d.PromoCode || ''),
    discount: str(d.Discount || d.Value || ''),
    description: str(d.Description || ''),
    url: str(d.LandingPageUrl || d.TrackingLink || ''),
    starts: str(d.StartDate || ''),
    expires: str(d.EndDate || d.ExpirationDate || ''),
  })).filter((d) => d.id || d.code || d.name);
}

// ── product catalogs (for shopping/hotel/product feeds) ──────────────────────────────────────────
/** Your catalogs. Soft-fails to []. Each: { id, name, advertiser, itemCount }. */
export async function listCatalogs() {
  const j = await get('/Catalogs', { PageSize: '100' });
  const rows = j && Array.isArray(j.Catalogs) ? j.Catalogs : [];
  return rows.map((c) => ({
    id: str(c.Id || c.CatalogId), name: str(c.Name),
    advertiser: str(c.AdvertiserName || c.CampaignName), itemCount: num(c.NumberOfItems || c.ItemCount),
  })).filter((c) => c.id);
}

/** Items in a catalog (products/offers). Soft-fails to []. Each: { id, name, price, currency, url, imageUrl }. */
export async function catalogItems(catalogId, { query, pageSize = 50 } = {}) {
  if (!catalogId) return [];
  const params = { PageSize: String(pageSize) };
  if (query) params.Query = query;
  const j = await get(`/Catalogs/${encodeURIComponent(catalogId)}/Items`, params);
  const rows = j && Array.isArray(j.Items) ? j.Items : [];
  return rows.map((it) => ({
    id: str(it.Id || it.CatalogItemId), name: str(it.Name || it.Title),
    price: num(it.CurrentPrice || it.Price), currency: str(it.Currency || 'USD'),
    url: str(it.Url || it.TrackingLink || ''), imageUrl: str(it.ImageUrl || ''),
    advertiser: str(it.CampaignName || it.AdvertiserName || ''),
  })).filter((it) => it.id || it.name);
}

// ── the one call a vertical makes ────────────────────────────────────────────────────────────────
/**
 * The populate entry point a vertical calls: for 'coupons' returns deals from coupon campaigns; for
 * 'hotel'/'insurance' returns the approved campaigns (advertisers) as offers. Soft-fails to [] when
 * unconfigured or unapproved — the vertical then renders its own data + the UTT rail, unchanged.
 *   → { vertical, configured, campaigns[], deals[] }
 */
export async function offersForVertical(vertical) {
  const key = str(vertical).toLowerCase();
  if (!configured()) return { vertical: key, configured: false, campaigns: [], deals: [] };
  const campaigns = await campaignsByCategory(key);
  let deals = [];
  if (key === 'coupons') {
    // pull deals for each approved coupon campaign (bounded)
    const ids = campaigns.slice(0, 20).map((c) => c.id);
    const batches = await Promise.all(ids.map((id) => listDeals({ campaignId: id }).catch(() => [])));
    deals = batches.flat();
    if (!deals.length) deals = await listDeals().catch(() => []); // fallback: all deals
  }
  return { vertical: key, configured: true, campaigns, deals };
}

// ── coverage report (answers "what am I approved for?") ──────────────────────────────────────────
/**
 * A coverage summary across our monetizable verticals — what you're approved for vs. need to apply for.
 * Soft-fails to an unconfigured shape. → { configured, total, byVertical: { coupons, hotel, insurance } }
 */
export async function coverageReport() {
  if (!configured()) return { configured: false, total: 0, byVertical: {}, note: 'Set IMPACT_ACCOUNT_SID + IMPACT_AUTH_TOKEN (Impact → Settings → API).' };
  const all = await listCampaigns();
  const byVertical = {};
  for (const v of ['coupons', 'hotel', 'insurance']) {
    const kws = VERTICAL_KEYWORDS[v];
    byVertical[v] = all.filter((c) => kws.some((k) => `${c.name} ${c.category}`.toLowerCase().includes(k))).map((c) => c.name);
  }
  return { configured: true, total: all.length, byVertical };
}

// CLI: node integrations/impact-api.mjs [coverage|coupons|hotel|insurance]
if (process.argv[1] && process.argv[1].endsWith('impact-api.mjs')) {
  const verb = process.argv[2] || 'coverage';
  if (!configured()) {
    console.log('Impact API not configured. Set IMPACT_ACCOUNT_SID + IMPACT_AUTH_TOKEN (Impact → Settings → API / Technical Settings).');
  } else if (verb === 'coverage') {
    console.log(JSON.stringify(await coverageReport(), null, 2));
  } else {
    console.log(JSON.stringify(await offersForVertical(verb), null, 2));
  }
}
