// rakuten-feed.mjs — Rakuten Advertising (LinkSynergy) publisher API: OAuth token mint + coupon/advertiser
// pull, normalized to the coupons.mjs shape. This is what turns the operator's Rakuten creds into actual
// coupons on the site (operator 2026-06-17: "how do you get the coupons on the site though?").
//
// Creds live in the box server env (never the repo): RAKUTEN_CLIENT_ID, RAKUTEN_CLIENT_SECRET, and the
// SID (scope) from RAKUTEN_SID or the digits of RAKUTEN_AFFILIATE_ID. OAuth2 client_credentials →
//   POST https://api.linksynergy.com/token  (Basic base64(id:secret), grant_type=client_credentials, scope=SID)
//   → { access_token, expires_in } → Authorization: Bearer <token> on the data endpoints.
// Token is cached + refreshed before expiry. Injectable fetch, SOFT-FAIL-NEVER-THROW (no creds / API down
// / no approved advertisers → []), so the coupons page + the brief never break on it.

let _fetch = (...a) => (typeof fetch !== 'undefined' ? fetch(...a) : Promise.reject(new Error('no fetch')));
export function __setFetch(fn) { _fetch = fn || ((...a) => fetch(...a)); }
const env = (k) => (typeof process !== 'undefined' && process.env && process.env[k]) || '';
const sid = () => env('RAKUTEN_SID') || (env('RAKUTEN_AFFILIATE_ID').match(/\d+/) || [''])[0];
const b64 = (s) => (typeof Buffer !== 'undefined' ? Buffer.from(s).toString('base64') : btoa(s));

const TOKEN_URL = 'https://api.linksynergy.com/token';
const COUPON_URL = 'https://api.linksynergy.com/coupon/1.0';
const ADV_URL = 'https://api.linksynergy.com/advertisersearch/1.0';

let _tok = { value: '', exp: 0 };
/** token({now}) — cached OAuth bearer (client_credentials, scope=SID). '' on failure. Never throws. */
export async function token({ now = Date.now() } = {}) {
  if (_tok.value && now < _tok.exp - 60000) return _tok.value;
  const id = env('RAKUTEN_CLIENT_ID'), secret = env('RAKUTEN_CLIENT_SECRET');
  if (!id || !secret) return '';
  try {
    const body = new URLSearchParams({ grant_type: 'client_credentials', scope: sid() }).toString();
    const r = await _fetch(TOKEN_URL, {
      method: 'POST',
      headers: { authorization: `Basic ${b64(`${id}:${secret}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!r || !r.ok) return '';
    const j = await r.json();
    if (!j || !j.access_token) return '';
    _tok = { value: j.access_token, exp: now + (Number(j.expires_in) || 3600) * 1000 };
    return _tok.value;
  } catch { return ''; }
}

// tolerant XML field grab (Rakuten data endpoints default to XML) — no XML dep, soft.
function tag(xml, name) { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')); return m ? m[1].trim() : ''; }
function blocks(xml, name) { return (xml.match(new RegExp(`<${name}[^>]*>[\\s\\S]*?</${name}>`, 'ig')) || []); }

/** searchAdvertisers(name) — MIDs for advertisers (200 even when empty for a new account). [] on fail. */
export async function searchAdvertisers(name = '') {
  const t = await token(); if (!t) return [];
  try {
    const url = `${ADV_URL}?merchantname=${encodeURIComponent(name)}`;
    const r = await _fetch(url, { headers: { accept: 'application/xml', authorization: `Bearer ${t}` } });
    if (!r || !r.ok) return [];
    const xml = await r.text();
    const mids = xml.match(/<mid[^>]*>\s*(\d+)\s*<\/mid>/ig) || [];
    const names = xml.match(/<merchantname[^>]*>([\s\S]*?)<\/merchantname>/ig) || [];
    return mids.map((m, i) => ({
      mid: (m.match(/(\d+)/) || [''])[0],
      name: names[i] ? names[i].replace(/<[^>]+>/g, '').trim() : '',
    }));
  } catch { return []; }
}

/**
 * coupons({ category, network } ) — current coupons for advertisers you're partnered with, normalized to
 * the coupons.mjs row shape { store, code, discount, type, expires, sourceUrl, network }. [] for a new
 * account with no approved programs (expected) or on any failure.
 */
export async function coupons({ category = '', network = '' } = {}) {
  const t = await token(); if (!t) return [];
  try {
    const q = new URLSearchParams();
    if (category) q.set('category', category);
    if (network) q.set('network', network);
    const url = q.toString() ? `${COUPON_URL}?${q}` : COUPON_URL;
    const r = await _fetch(url, { headers: { accept: 'application/xml', authorization: `Bearer ${t}` } });
    if (!r || !r.ok) return [];
    const xml = await r.text();
    return blocks(xml, 'link').map((b) => ({
      store: tag(b, 'advertisername') || tag(b, 'merchantname') || tag(b, 'advertiserid'),
      code: tag(b, 'couponcode') || tag(b, 'code'),
      discount: tag(b, 'offerdescription') || tag(b, 'description') || tag(b, 'offer'),
      type: (tag(b, 'couponcode') ? 'code' : 'deal'),
      expires: tag(b, 'offerenddate') || tag(b, 'enddate') || '',
      sourceUrl: tag(b, 'clickurl') || tag(b, 'linkurl') || '',
      network: 'rakuten',
    })).filter((c) => c.store || c.code || c.discount);
  } catch { return []; }
}

/** configured() — are the Rakuten API creds present? */
export function configured() { return { clientId: !!env('RAKUTEN_CLIENT_ID'), clientSecret: !!env('RAKUTEN_CLIENT_SECRET'), sid: !!sid() }; }

if (typeof process !== 'undefined' && process.argv && process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  (async () => { console.log('configured:', JSON.stringify(configured())); console.log('token:', (await token()) ? 'OK' : 'none'); console.log('coupons:', (await coupons()).length); })();
}
