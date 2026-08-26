// geogate.mjs — geofence SCAFFOLDING for the compliant play-token KULA Arcade.
//
// This is the PLUMBING, not a geolocator. It does not do a network lookup and it does NOT claim to
// know precisely where a visitor is. It provides four things the arcade surfaces call:
//   1. an env-configured blocked-region list        (ARCADE_BLOCKED_REGIONS="US,US-WA,FR")
//   2. a server-side header SEAM                     (regionFromRequest — reads a CDN/edge geo header)
//   3. a decision object                             (gateDecision → { blocked, allowed, mode, ... })
//   4. a client hook + a rendered notice             (clientHook / noticeHtml)
//
// COMPLIANCE POSTURE (per .local/RESEARCH_PREDICTION_MARKETS_BETTING.md §5/§6 + memory
// `prana-defi-arcade-compliance-line`): the PLAY-token launch is non-cashable entertainment, so the
// DEFAULT mode is "disclaimer" — allow-with-disclaimer everywhere, and surface a persistent
// "not available where prohibited" notice. The gate is WIRED so a real-money build can later flip
// ARCADE_GEO_MODE=block to hard-deny blocked regions on the same seam — WITHOUT any surface rework.
// It never geolocates over the network and it never throws (house rule: soft-fail).
//
//   import { gateDecision, decide, regionFromRequest, noticeHtml, clientHook } from './geogate.mjs'
//   node integrations/soapbox/geogate.mjs        # tiny self-demo

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Normalize a region token: uppercase, trim, collapse whitespace. 'us' → 'US', 'us-wa' → 'US-WA'.
export function normRegion(s) {
  return String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, '');
}

// The env-configured blocklist. Comma/space separated. Deduped, normalized. Default: none.
// A real-money gate would seed this with US + prohibited states/countries. For the play-token build
// it can stay empty (allow-with-disclaimer) — the plumbing is present either way.
export function blockedRegions() {
  const raw = process.env.ARCADE_BLOCKED_REGIONS || '';
  const out = [];
  for (const part of String(raw).split(/[,\s]+/)) {
    const r = normRegion(part);
    if (r && !out.includes(r)) out.push(r);
  }
  return out;
}

// Gate mode. 'disclaimer' (default) = allow everyone, show the persistent notice (play-token launch).
// 'block' = hard-deny blocked regions (the seam a counsel-approved real-money build flips on).
export function geoMode() {
  const m = String(process.env.ARCADE_GEO_MODE || 'disclaimer').trim().toLowerCase();
  return m === 'block' ? 'block' : 'disclaimer';
}

// isBlocked(region): true if the normalized region matches a blocklist entry, OR its country prefix
// is blocked (so blocking "US" also blocks "US-WA"), OR a blocked "US-WA" matches an exact region.
export function isBlocked(region, list = blockedRegions()) {
  const r = normRegion(region);
  if (!r || !Array.isArray(list) || list.length === 0) return false;
  const country = r.split('-')[0];
  for (const b of list) {
    if (b === r) return true;              // exact (US-WA blocks US-WA)
    if (b === country) return true;        // country block (US blocks US-WA)
    if (b.split('-')[0] === r && !r.includes('-')) return false; // r is broader than a sub-region entry
  }
  return false;
}

// Server SEAM: best-effort region from request headers set by a CDN/edge (Cloudflare, Vercel, etc.).
// NO network call. Returns '' when nothing is known — the honest default. A precise geolocation
// provider bolts on here later; the surfaces don't change.
export function regionFromRequest(req) {
  try {
    const h = (req && req.headers) || {};
    const get = (k) => { const v = h[k]; return normRegion(Array.isArray(v) ? v[0] : v); };
    const country = get('cf-ipcountry') || get('x-vercel-ip-country') || get('x-geo-country') || get('x-country-code');
    const sub = get('x-vercel-ip-country-region') || get('x-geo-region') || get('x-region-code');
    const explicit = get('x-arcade-region');                       // a test/override seam
    if (explicit) return explicit;
    if (country && sub) return `${country}-${sub}`;
    return country || sub || '';
  } catch {
    return '';
  }
}

// gateDecision({ region, mode }) → the object every surface renders from. Soft-fails to an allowed
// disclaimer decision. `allowed` is the ONLY field a hard gate would act on; in the default
// disclaimer mode it is always true (allow-with-disclaimer) even when the region is on the blocklist.
export function gateDecision({ region = '', mode = geoMode(), list = blockedRegions() } = {}) {
  const r = normRegion(region);
  const known = !!r;
  const blocked = isBlocked(r, list);
  const m = mode === 'block' ? 'block' : 'disclaimer';
  const allowed = m === 'block' ? !blocked : true;
  return {
    region: r,
    known,
    blocked,
    mode: m,
    allowed,
    // The scaffolding is always "on" in the sense that the notice always renders; only the
    // enforcement differs by mode. This flag tells a surface whether to hard-stop.
    enforce: m === 'block' && blocked,
    reason: blocked ? (m === 'block' ? 'region blocked' : 'region on advisory blocklist') : 'ok',
  };
}

// decide(req): convenience — read the header seam, then decide. Never throws.
export function decide(req) {
  return gateDecision({ region: regionFromRequest(req) });
}

// The persistent "not available where prohibited" notice. Present on every surface (the scaffolding
// is visible from day one). In hard-block mode + blocked, it reads as a stop; otherwise it is an
// advisory. Always contains the load-bearing phrase "not available where prohibited".
export function noticeHtml(decision = gateDecision()) {
  const d = decision && typeof decision === 'object' ? decision : gateDecision();
  const strong = d.enforce;
  const where = d.known ? ` (region: ${esc(d.region)})` : '';
  const msg = strong
    ? `This play area is <b>not available in your region</b>${where}. KULA Arcade is entertainment only and <b>not available where prohibited</b>.`
    : `KULA Arcade is entertainment only — <b>not available where prohibited</b>. PLAY has no cash value and cannot be cashed out.${where}`;
  return `<div class="arcade-geo${strong ? ' geo-blocked' : ''}" role="note" data-geo-mode="${esc(d.mode)}"${d.known ? ` data-geo-region="${esc(d.region)}"` : ''}>${msg}</div>`;
}

// A client-side hook (a <script> string). It does NOT geolocate over the network — it only keeps the
// disclaimer/notice visible and exposes a stable `window.__arcadeGeo` object a future real gate can
// populate (e.g. from an edge worker). Wrapped in try/catch; inert if scripting is off.
export function clientHook() {
  return `<script>
(function(){try{
  window.__arcadeGeo=window.__arcadeGeo||{mode:${JSON.stringify(geoMode())},blocked:${JSON.stringify(blockedRegions())},resolved:null};
  // SEAM: a real deployment may set window.__arcadeGeo.region from an edge header echo and, in block
  // mode, hide gated controls. The play-token build only ensures the notice stays visible.
  var n=document.querySelector('.arcade-geo'); if(n){n.setAttribute('data-geo-ready','1');}
}catch(e){}})();
</script>`;
}

// serverGate(req,res): the hard-block seam. In 'block' mode with a blocked region it writes a 451 and
// returns false (handled). Otherwise returns true (let the surface render). Play-token default never
// hard-blocks. Never throws.
export function serverGate(req, res) {
  try {
    const d = decide(req);
    if (d.enforce && res && typeof res.writeHead === 'function') {
      res.writeHead(451, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(`<!doctype html><meta charset=utf-8><title>Not available</title><body style="font:16px system-ui;padding:2rem">${noticeHtml(d)}</body>`);
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

// CLI self-demo (guarded)
if (process.argv[1] && process.argv[1].endsWith('geogate.mjs')) {
  console.log('mode:', geoMode(), 'blocked:', blockedRegions());
  console.log('US decision:', gateDecision({ region: 'US' }));
  console.log('US-WA vs US block:', isBlocked('US-WA', ['US']));
  console.log('notice:', noticeHtml(gateDecision({ region: 'US' })));
}
