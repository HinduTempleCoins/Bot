// ad-slot.mjs — the env-gated DISPLAY-AD / AFFILIATE SLOT component for the high-traffic SEO surfaces.
//
// WHY THIS EXISTS (the #1 near-term-dollar finding, SURFACES_USERS_ANALYTICS.md §4):
//   law (~13k unique IPs), stocks (~7.6k), wiki (~7.8k) and the other SEO verticals already pull
//   thousands of genuine organic visitors — and there is NO way to earn a cent on them today: no ad tag,
//   no affiliate rail live. This is the shortest real line to revenue. The affiliate ENGINE already
//   exists (integrations/affiliate.mjs — trackedLink/renderOffer, env-by-name ids, FTC disclosure) and
//   the pageview BEACON already exists (integrations/soapbox/beacon.mjs → soapy.blog). What was missing
//   is the DISPLAY-AD half + a drop-in slot that a page template can place, plus the impression/click
//   instrumentation that lets us actually MEASURE earnings. That is this module.
//
// THE RAIL CHOICE (recommendation encoded here; full comparison in the go-live notes):
//   • Display ads FIRST, via Google AdSense (AD_CLIENT), on the LEGAL/FINANCE surfaces (law, stocks,
//     credentials, directory, data). Rationale: (a) zero traffic threshold to APPLY — AdSense has no
//     minimum, unlike Mediavine (50k sessions) / Raptive (100k PV) / Ezoic (soft ~10k); (b) legal &
//     financial content is high-CPM, brand-safe, and squarely inside AdSense policy; (c) it is a single
//     <script> + per-slot <ins> — the least-effort tag to wire. Expected RPM at this content class is
//     ~$3–$12 / 1k pageviews, so law's real traffic alone is a plausible first dollar within the pay
//     cycle after approval.
//   • Skimlinks / affiliate (already wired in affiliate.mjs) runs ALONGSIDE ads on commerce-ish pages
//     and is the RIGHT primary rail for the harm-reduction / plant-medicine shelves (wiki/hemp), where
//     AdSense policy is a poor fit — those pages should serve contextual affiliate + house sponsorship,
//     not Google display. This module keeps both rails behind the same env gates so a surface can run
//     either or both. See headTags() (loaders) + adSlot() (per-placement display unit).
//
// CONTRACT (house style — esc() everything, soft-fail-never-throw, no-op when disabled, no network):
//   • adSlot(placement, opts) → HTML string for one in-page slot.
//       - disabled / not enabled            → '' (no-op; the page is unchanged)
//       - enabled, AD_CLIENT set            → the real AdSense <ins> unit (+ the per-slot push)
//       - enabled, no publisher id set      → a labeled PLACEHOLDER box (so staging shows slot geometry)
//   • headTags(opts) → the <head>/<body-end> loader block: the AdSense loader (only when AD_CLIENT set),
//       the Skimlinks site script (only when SKIMLINKS_JS / SKIMLINKS_PUBLISHER_ID set), and the tiny
//       first-party impression/click TRACKER that posts ad_impression / ad_click events to our own
//       cookieless collector (soapy.blog/px — the same beacon endpoint). Returns '' when nothing is
//       configured AND tracking is off, so an un-provisioned surface emits nothing.
//   • slotStyles() → the CSS for the slot + placeholder, to fold into a page's <style>.
//
// IDs ARE ENV-BY-NAME ONLY. This file never contains a publisher id and never fabricates one — identical
// discipline to affiliate.mjs. Unset env ⇒ placeholder / plain, never a broken tag.
//
//   import { adSlot, headTags, slotStyles, adsEnabled } from './ad-slot.mjs'
//   node integrations/soapbox/ad-slot.mjs            # offline demo (prints placeholder + configured tag)

import { BEACON_BASE } from './beacon.mjs';
import { renderSoldAd } from '../admarket/serve.mjs';

// ── strict HTML escape (every interpolation goes through this) ───────────────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const truthy = (v) => v != null && /^(1|true|yes|on)$/i.test(String(v).trim());

// ── env readers (BY NAME; never store an id here) ────────────────────────────────────────────────────

/** The AdSense publisher id (ca-pub-…). Read from AD_CLIENT, or ADSENSE_CLIENT as an alias. '' when unset. */
export function adClient(env = process.env) {
  return String(env.AD_CLIENT || env.ADSENSE_CLIENT || '').trim();
}

/**
 * The AdSense ad-unit (slot) id for a placement. A publisher creates one unit per placement in the
 * AdSense dashboard; its numeric id goes in AD_SLOT_<PLACEMENT> (e.g. AD_SLOT_LAW_TOP), or a single
 * AD_SLOT_ID reused across placements (a responsive auto unit works fine reused). '' when unset →
 * the loader still serves Auto ads page-wide, but an explicit unit id is preferred.
 */
export function adUnitId(placement, env = process.env) {
  const key = 'AD_SLOT_' + String(placement || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return String((key && env[key]) || env.AD_SLOT_ID || '').trim();
}

/**
 * The Skimlinks site-wide script URL. Either given directly in SKIMLINKS_JS (the existing convention in
 * site/home/server.mjs), or built from a publisher id in SKIMLINKS_PUBLISHER_ID / SKIMLINKS_ID. '' unset.
 */
export function skimlinksJs(env = process.env) {
  const direct = String(env.SKIMLINKS_JS || '').trim();
  if (direct) return direct;
  const id = String(env.SKIMLINKS_PUBLISHER_ID || env.SKIMLINKS_ID || env.AFFIL_SKIMLINKS_ID || '').trim();
  // Skimlinks publisher ids are "<digits>X<digits>"; only build a URL from a plausible id.
  if (/^[0-9]+X[0-9]+$/i.test(id)) return `https://s.skimresources.com/js/${id}.skimlinks.js`;
  return '';
}

/** The collector base the tracker beacons to (our own cookieless first-party collector). */
export function analyticsBase(env = process.env) {
  return String(env.ANALYTICS_BASE || BEACON_BASE || 'https://soapy.blog').replace(/\/+$/, '');
}

/**
 * Is the ad rail enabled for this render? Global kill switch ADS_DISABLED=1 forces OFF everywhere. Then
 * the per-surface decision comes from the caller (opts.enabled) — a surface passes its own feature flag
 * (e.g. law passes truthy(LAW_ADS)). When opts.enabled is omitted we fall back to a global ADS_ENABLED
 * env so a surface can opt in with zero code. Default: OFF (nothing renders until explicitly enabled).
 */
export function adsEnabled(opts = {}, env = process.env) {
  if (truthy(env.ADS_DISABLED)) return false;
  if (opts.enabled === true) return true;
  if (opts.enabled === false) return false;
  return truthy(env.ADS_ENABLED);
}

// ── the slot component ───────────────────────────────────────────────────────────────────────────────

/**
 * adSlot(placement, opts) — one in-page display-ad slot.
 *   placement : a short, stable name for this slot ('law-top', 'law-mid', …) — used as the tracking key
 *               and the AD_SLOT_<PLACEMENT> env lookup. Escaped into a data-attribute; never reflected raw.
 *   opts:
 *     enabled  : per-surface flag (see adsEnabled). Omit to fall back to ADS_ENABLED.
 *     format   : AdSense data-ad-format (default 'auto', responsive).
 *     label    : text shown on the placeholder (default 'Advertisement').
 *     env      : injectable env (tests).
 * Returns '' when disabled/not-enabled (true no-op), the AdSense unit when AD_CLIENT is set, else a
 * labeled placeholder. NEVER throws.
 */
export function adSlot(placement, opts = {}) {
  try {
    const env = opts.env || process.env;
    if (!adsEnabled(opts, env)) return '';                 // no-op: surface not opted in / globally off

    const place = String(placement || 'slot').slice(0, 64);
    const placeAttr = esc(place);

    // OUR-OWN-ADS seam: when the caller passes a picked sold/house ad (from admarket serve.pickForSlot /
    // serveSlot), render it as our own unit — this is "AdSense off, sell our inventory" mode. Takes
    // precedence over the AdSense unit. opts.adHtml is a pre-rendered unit (server already picked+metered);
    // opts.ad is a campaign/house-ad object we render here. Either keeps the same .ad-slot tracker wrapper.
    if (typeof opts.adHtml === 'string' && opts.adHtml) return opts.adHtml;
    if (opts.ad) { const h = renderSoldAd(opts.ad, { placement: place, clickBase: opts.clickBase }); if (h) return h; }

    const client = adClient(env);

    if (!client) {
      // Placeholder: renders where a real ad WOULD go, so staging shows the geometry and the operator can
      // see the slot before an id exists. Carries the same data-ad-placement so the tracker still counts it.
      const label = esc(opts.label || 'Advertisement');
      return `<div class="ad-slot ad-slot--ph" data-ad-placement="${placeAttr}" role="complementary" aria-label="advertisement">`
        + `<span class="ad-slot__ph-label">${label} · slot <code>${placeAttr}</code></span>`
        + `<span class="ad-slot__ph-hint">set <code>AD_CLIENT</code> to serve</span>`
        + `</div>`;
    }

    // Configured: the real AdSense responsive display unit. client + unit id are escaped into attributes;
    // the per-slot push is a fixed literal (no interpolation).
    const format = esc(opts.format || 'auto');
    const unit = esc(adUnitId(place, env));
    const unitAttr = unit ? ` data-ad-slot="${unit}"` : '';
    return `<div class="ad-slot" data-ad-placement="${placeAttr}" aria-label="advertisement" role="complementary">`
      + `<ins class="adsbygoogle" style="display:block" data-ad-client="${esc(client)}"${unitAttr}`
      + ` data-ad-format="${format}" data-full-width-responsive="true"></ins>`
      + `<script>(adsbygoogle=window.adsbygoogle||[]).push({});</script>`
      + `</div>`;
  } catch { return ''; }   // soft-fail: an ad slot must never break the page
}

// ── head/body-end loaders + the impression/click tracker ─────────────────────────────────────────────

/**
 * The AdSense loader <script> (async), served only when AD_CLIENT is set. The ?client= param scopes Auto
 * ads to our publisher. Empty string when unset.
 */
export function adsenseLoader(env = process.env) {
  const client = adClient(env);
  if (!client) return '';
  return `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(client)}" crossorigin="anonymous"></script>`;
}

/** The Skimlinks site script, served only when a Skimlinks id/URL is configured. Empty when unset. */
export function skimlinksLoader(env = process.env) {
  const src = skimlinksJs(env);
  if (!src) return '';
  return `<script type="text/javascript" src="${esc(src)}"></script>`;
}

/**
 * The first-party impression/click TRACKER (inline, tiny, soft-fail). It posts to OUR OWN cookieless
 * collector (soapy.blog/px) — no ad-network analytics, no cookie, no id. It sends:
 *   • one 'ad_impression' per slot when the slot scrolls into view (IntersectionObserver, once per slot),
 *   • one 'ad_click' when a slot or any disclosed affiliate link (a[rel~=sponsored]) is clicked.
 * The body shape is { t, p, slot } — the collector's /px already parses arbitrary JSON; ingest() maps
 * t→type and slot→slot (see site/analytics/server.mjs). Content-type MUST be text/plain for sendBeacon
 * no-cors (same constraint as beacon.mjs). Returns the <script> string, or '' when tracking is disabled.
 */
export function adTrackerJs(env = process.env) {
  const base = analyticsBase(env);
  // The client script. `__BASE__` is replaced with the JSON-encoded base; everything else is a literal.
  const body = `(function(){try{
var C=__BASE__;
function send(t,slot){try{
var d=JSON.stringify({t:t,p:location.pathname,slot:String(slot||"").slice(0,64)});
if(navigator.sendBeacon&&navigator.sendBeacon(C+"/px",new Blob([d],{type:"text/plain;charset=UTF-8"})))return;
fetch(C+"/px",{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:d,keepalive:true,mode:"no-cors"}).catch(function(){});
}catch(e){}}
function place(el){return (el&&el.getAttribute&&el.getAttribute("data-ad-placement"))||"aff";}
try{var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){send("ad_impression",place(e.target));io.unobserve(e.target);}});},{threshold:0.5});
document.querySelectorAll(".ad-slot[data-ad-placement]").forEach(function(el){io.observe(el);});}catch(e){
document.querySelectorAll(".ad-slot[data-ad-placement]").forEach(function(el){send("ad_impression",place(el));});}
document.addEventListener("click",function(e){try{var t=e.target;var a=t&&t.closest&&t.closest(".ad-slot[data-ad-placement],a[rel~=sponsored]");if(a)send("ad_click",place(a.closest?a.closest(".ad-slot[data-ad-placement]"):null)||place(a));}catch(x){}},true);
}catch(e){}})();`;
  return `<script>${body.replace('__BASE__', JSON.stringify(base))}</script>`;
}

/**
 * headTags(opts) — the whole loader block for a surface, gated. Emits:
 *   • the AdSense loader (only when AD_CLIENT set),
 *   • the Skimlinks loader (only when configured),
 *   • the impression/click tracker (whenever ads are enabled for the surface — measurement runs even
 *     against the placeholder, so a surface's inventory value is measured BEFORE an id is provisioned).
 * Returns '' when the surface is not enabled. Place in <head> (loaders) or before </body> (fine either
 * way — AdSense loader is async; the tracker waits for nothing).
 */
export function headTags(opts = {}) {
  try {
    const env = opts.env || process.env;
    if (!adsEnabled(opts, env)) return '';
    return adsenseLoader(env) + skimlinksLoader(env) + adTrackerJs(env);
  } catch { return ''; }
}

/** The CSS for the slot + placeholder. Neutral, theme-friendly (inherits the dark surface palette). */
export function slotStyles() {
  return `.ad-slot{margin:16px 0;min-height:90px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.ad-slot--ph{border:1px dashed var(--line2,#30363d);border-radius:10px;color:var(--mut,#8b949e);font-size:12px;flex-direction:column;gap:3px;padding:14px;background:var(--panel,#161b22)}
.ad-slot--ph code{background:var(--bg,#0b0f14);border:1px solid var(--line,#21262d);border-radius:4px;padding:0 5px;font-size:11px}
.ad-slot__ph-hint{opacity:.7}`;
}

// ── go-live readiness (read-only, env-presence only — never a secret value) ───────────────────────────

/**
 * A one-glance readiness snapshot for the ad rail: which loaders would fire, which env ids are set. Reads
 * only env-var PRESENCE (booleans), never the values. Soft; for the operator go-live checklist + tests.
 */
export function railStatus(opts = {}) {
  const env = opts.env || process.env;
  return {
    enabled: adsEnabled(opts, env),
    globalKill: truthy(env.ADS_DISABLED),
    adsense: { configured: !!adClient(env), loader: !!adsenseLoader(env), defaultUnit: !!String(env.AD_SLOT_ID || '').trim() },
    skimlinks: { configured: !!skimlinksJs(env) },
    tracker: { collector: analyticsBase(env) },
  };
}

// ── CLI — offline demo (no network) ───────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('ad-slot.mjs')) {
  const on = { enabled: true };
  console.log('ad-slot — env-gated display-ad / affiliate slot\n' + '─'.repeat(64));
  console.log('\n[disabled] adSlot("law-top") →', JSON.stringify(adSlot('law-top')));
  console.log('\n[enabled, no AD_CLIENT] placeholder:\n ', adSlot('law-top', on));
  const cfgEnv = { ...process.env, AD_CLIENT: 'ca-pub-0000000000000000', AD_SLOT_LAW_TOP: '1234567890', ADS_ENABLED: '1' };
  console.log('\n[enabled, AD_CLIENT set] real unit:\n ', adSlot('law-top', { env: cfgEnv }));
  console.log('\nheadTags (configured):\n ', headTags({ env: cfgEnv }).slice(0, 220) + '…');
  console.log('\nrailStatus (current env):', JSON.stringify(railStatus(on)));
}
