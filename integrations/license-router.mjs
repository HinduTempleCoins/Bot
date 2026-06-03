// license-router.mjs — the HOST / WINDOW / POINT three-tier LICENSE ROUTER (task #221, v3 §7/§9/§13).
//
// One test, made executable: "is the source itself licensed/open?" Every media asset in the
// ecosystem (a song, a film, a paper, an image, a dataset) is run through this router and comes out
// TAGGED with a posture and a route, so it lands in the right storage tier — and so we NEVER store
// or republish someone else's copyrighted file. Pure, deterministic (the current year is INJECTED,
// never read from the wall clock), no network, no secrets.
//
// Three POSTURES (the load-bearing distinction):
//   host    — public-domain / CC-open / US-federal-gov / user-original / pure-AI output. Ours to
//             keep. Safe permanently, even on an immutable on-chain store.
//   window  — copyrighted or ToS-restricted, but viewable through the OWNER's official surface
//             (an official YouTube/Vimeo embed, the publisher's reader). We DISPLAY, never STORE.
//   point   — copyrighted with no licensed display surface. We store METADATA + a link OUT only.
//
// Three storage TIERS, gated by posture:
//   chain        — immutable. ONLY host-posture assets may go here (anything else is REJECTED).
//   ipfs-pinned  — mutable pin. host + cleanly-licensed assets.
//   embed        — front-end only (an iframe to the owner's surface). window-posture display.
//
//   import { classify, route, canGoOnChain, validateForTier, tagAsset, EMBED_WHITELIST }
//     from './integrations/license-router.mjs'
//   classify(asset, { year })  → { license, posture }
//   route(asset, { year })     → { route, tier, attribution, flags }
//   tagAsset(asset, { year })  → { license, posture, route, tier, attribution?, flags }
//   node integrations/license-router.mjs   # demo with offline fixtures
//
// REUSE: the SoapBox three-bucket copyright model (soapbox/library-buckets.mjs) answers the same
// underlying question for the Library. We import its CC license vocabulary defensively (so this file
// still works standalone if that module moves) rather than duplicating the list.

// ── defensive reuse of the Library's CC vocabulary ────────────────────────────────────────────────
// Import is best-effort: if the sibling module is unavailable we fall back to a local copy so the
// router never hard-depends on another file's location.
let _CC_LICENSES;
try {
  ({ CC_LICENSES: _CC_LICENSES } = await import('./soapbox/library-buckets.mjs'));
} catch {
  _CC_LICENSES = null;
}
const CC_LICENSES = _CC_LICENSES instanceof Set ? _CC_LICENSES : new Set([
  'cc0', 'cc-pdm', 'cc-by', 'cc-by-sa', 'cc-by-nd', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nc-nd',
]);

// ── postures, routes, tiers ───────────────────────────────────────────────────────────────────────
export const POSTURES = Object.freeze({ HOST: 'host', WINDOW: 'window', POINT: 'point' });
export const ROUTES = Object.freeze({ HOST: 'host', WINDOW: 'window', POINT: 'point', REFUSE: 'refuse' });
export const TIERS = Object.freeze({ CHAIN: 'chain', IPFS: 'ipfs-pinned', EMBED: 'embed' });

// ── public-domain timelines (rolling, computed from the INJECTED year) ────────────────────────────
// US copyright is a moving wall. As of 2026, works published on or before these cutoffs are PD:
//   sound recordings  ≤ 1925   (Music Modernization Act schedule; 100-year boundary at 2026)
//   musical compositions / everything-else published works ≤ 1930  (95-year term)
// These are the two distinct boundaries the v3 doc calls out; both advance by one year each Jan 1.
const RECORDING_PD_OFFSET = 101;    // year - 101 → recordings ≤ that are PD (2026-101 = 1925)
const COMPOSITION_PD_OFFSET = 96;   // year - 96  → compositions/other ≤ that are PD (2026-96 = 1930)

function recordingPdCutoff(year) { return year - RECORDING_PD_OFFSET; }
function compositionPdCutoff(year) { return year - COMPOSITION_PD_OFFSET; }

// ── embed whitelist ───────────────────────────────────────────────────────────────────────────────
// Hosts whose OFFICIAL embed players are an owner-sanctioned display surface → window route is OK.
// Anything not on this list (scraper iframes, unofficial mirrors like '2embed'-style hosts) is
// REFUSED outright — we never frame a pirate surface.
export const EMBED_WHITELIST = Object.freeze([
  'youtube', 'youtu.be', 'youtube-nocookie',
  'vimeo',
  'dailymotion', 'dai.ly',
  '3speak',
  'internet-archive', 'archive.org', 'ia',
]);

// Known scraper / unofficial-mirror markers — explicitly refused even before the whitelist test, so
// a deceptive host string can't sneak through.
const REFUSED_EMBED_MARKERS = [
  '2embed', 'vidsrc', 'streamtape', 'fembed', 'mixdrop', 'doodstream', 'gomovies', 'putlocker',
  'mirror', 'unofficial', 'pirate', 'scraper',
];

// ── normalization ─────────────────────────────────────────────────────────────────────────────────
function norm(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

// canonicalize a license string to a comparable token: "CC BY-SA 4.0" → "cc-by-sa".
function canonLicense(license) {
  let s = norm(license);
  if (!s) return '';
  s = s.replace(/\s+/g, '-').replace(/_/g, '-');
  // strip a SEPARATED trailing version (…-4.0, …-3) but NOT a fused code like "cc0".
  s = s.replace(/-\d+(\.\d+)?$/, '').replace(/-(int(ernational)?|deed)$/, '');
  s = s.replace(/-+$/, '').replace(/^-+/, '');
  return s;
}

function isCc(license) { return CC_LICENSES.has(canonLicense(license)); }
function isCcNc(license) { return /(^|-)nc(-|$)/.test(canonLicense(license)); }
function isCcNd(license) { return /(^|-)nd(-|$)/.test(canonLicense(license)); }
function isCcSa(license) { return /(^|-)sa(-|$)/.test(canonLicense(license)); }
function isCcBy(license) {
  const c = canonLicense(license);
  return c === 'cc-by' || /(^|-)by(-|$)/.test(c); // any BY-bearing variant carries attribution
}
function isCc0(license) {
  const c = canonLicense(license);
  return c === 'cc0' || c === 'cc-pdm';
}

// Identify the embed host of an asset (explicit embedHost wins; otherwise sniff a url string).
function embedHostOf(asset) {
  const explicit = norm(asset.embedHost);
  if (explicit) return explicit;
  const src = norm(asset.source);
  if (src && (src.includes('/') || src.includes('.'))) return src; // url-ish source
  return '';
}

function refusedEmbed(host) {
  if (!host) return false;
  return REFUSED_EMBED_MARKERS.some((m) => host.includes(m));
}

function whitelistedEmbed(host) {
  if (!host) return false;
  return EMBED_WHITELIST.some((h) => host.includes(h));
}

// ── classify ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Decide an asset's { license, posture } from its metadata. PURE; `year` is injected.
 *
 * @param {object} asset  {
 *    kind: 'recording'|'composition'|'film'|'text'|'image'|'data',
 *    publishedYear?: number,
 *    license?: 'cc0'|'cc-by'|'cc-by-sa'|'cc-by-nc'|'cc-by-nd'|...,
 *    source?: 'us-gov'|'user-original'|'pure-ai'|<url>,
 *    embedHost?: string,
 *  }
 * @param {{year:number}} ctx  the injected current year (required for PD math)
 * @returns {{ license: string, posture: 'host'|'window'|'point' }}
 */
export function classify(asset = {}, { year } = {}) {
  if (!asset || typeof asset !== 'object') {
    return { license: 'unknown', posture: POSTURES.POINT };
  }
  if (!Number.isFinite(year)) {
    throw new TypeError('classify(asset, { year }): a finite injected `year` is required');
  }

  const source = norm(asset.source);
  const license = canonLicense(asset.license) || 'unknown';
  const kind = norm(asset.kind);
  const pub = Number(asset.publishedYear);

  // 1. US federal government works are ALWAYS public domain → host.
  if (source === 'us-gov' || source === 'us-government' || source === 'usgov') {
    return { license: 'us-gov-pd', posture: POSTURES.HOST };
  }
  // 2. Pure-AI output carries no human authorship → PD (USCO 2025) → host.
  if (source === 'pure-ai' || source === 'ai' || source === 'ai-generated') {
    return { license: 'pure-ai-pd', posture: POSTURES.HOST };
  }
  // 3. User-original (their own rights) → host (the user bears the license).
  if (source === 'user-original' || source === 'user' || source === 'self' || source === 'own') {
    return { license: 'user-original', posture: POSTURES.HOST };
  }

  // 4. Public-domain by year, on the kind-specific rolling timeline.
  if (Number.isFinite(pub) && pub > 0) {
    if (kind === 'recording' && pub <= recordingPdCutoff(year)) {
      return { license: 'pd', posture: POSTURES.HOST };
    }
    // compositions + every other published-work kind use the 95-year boundary.
    if (kind !== 'recording' && pub <= compositionPdCutoff(year)) {
      return { license: 'pd', posture: POSTURES.HOST };
    }
  }

  // 5. Creative Commons.
  if (isCc(asset.license)) {
    // CC-NC clears only NONCOMMERCIAL surfaces. Our surfaces are commercial, so for routing the
    // safe default is WINDOW (display via owner's terms, don't host on a commercial surface).
    if (isCcNc(asset.license)) {
      return { license, posture: POSTURES.WINDOW };
    }
    // CC0 / CC-BY / CC-BY-SA / CC-BY-ND → host (attribution/no-derivative flags handled in route()).
    return { license, posture: POSTURES.HOST };
  }

  // 6. Otherwise: copyrighted/unknown. If it has a viewable owner-surface embed → window; else point.
  const host = embedHostOf(asset);
  if (host && whitelistedEmbed(host) && !refusedEmbed(host)) {
    return { license: license === 'unknown' ? 'copyrighted' : license, posture: POSTURES.WINDOW };
  }
  return { license: license === 'unknown' ? 'copyrighted' : license, posture: POSTURES.POINT };
}

// ── route ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * Route an asset to a storage decision. PURE; `year` injected.
 * @returns {{ route:'host'|'window'|'point'|'refuse', tier:'chain'|'ipfs-pinned'|'embed'|null,
 *             attribution: boolean, flags: string[] }}
 */
export function route(asset = {}, { year } = {}) {
  const flags = [];

  // Refuse scraper / unofficial-mirror embed hosts OUTRIGHT — before any posture math.
  const host = embedHostOf(asset);
  if (refusedEmbed(host)) {
    return { route: ROUTES.REFUSE, tier: null, attribution: false, flags: ['unofficial-embed'] };
  }

  const { posture, license } = classify(asset, { year });

  // CC flags (apply wherever the license carries them).
  if (isCc(asset.license)) {
    if (isCcNc(asset.license)) flags.push('nc');
    if (isCcNd(asset.license)) flags.push('nd');
    if (isCcSa(asset.license)) flags.push('sa');
  }

  // attribution required for any CC-BY-bearing license (and recorded as a flag too).
  const attribution = isCc(asset.license) && isCcBy(asset.license) && !isCc0(asset.license);
  if (attribution) flags.push('attribution');

  if (posture === POSTURES.HOST) {
    // host → prefer immutable chain if explicitly destined there, else the pinned tier.
    return { route: ROUTES.HOST, tier: TIERS.IPFS, attribution, flags };
  }

  if (posture === POSTURES.WINDOW) {
    // window → display only, front-end embed tier. Must be a whitelisted owner surface to embed.
    if (host && whitelistedEmbed(host)) {
      return { route: ROUTES.WINDOW, tier: TIERS.EMBED, attribution, flags };
    }
    // window posture but no embeddable surface (e.g. CC-NC text) → display via owner terms, no tier.
    return { route: ROUTES.WINDOW, tier: null, attribution, flags };
  }

  // point → metadata + link out, nothing stored.
  void license;
  return { route: ROUTES.POINT, tier: null, attribution, flags };
}

// ── canGoOnChain ────────────────────────────────────────────────────────────────────────────────
/**
 * True ONLY for host-posture assets. The immutable chain store may never hold someone else's
 * copyrighted file. PURE; year injected (defaults are not allowed — caller must supply it).
 */
export function canGoOnChain(asset = {}, { year } = {}) {
  if (refusedEmbed(embedHostOf(asset))) return false;
  try {
    return classify(asset, { year }).posture === POSTURES.HOST;
  } catch {
    return false;
  }
}

// ── validateForTier ───────────────────────────────────────────────────────────────────────────────
/**
 * Assert an asset is allowed in a storage tier; THROWS otherwise. PURE; year injected.
 *   chain        → host posture only.
 *   ipfs-pinned  → host posture (cleanly licensed).
 *   embed        → window posture, on a whitelisted owner surface.
 * Returns the route() result on success.
 */
export function validateForTier(asset = {}, tier, { year } = {}) {
  const decision = route(asset, { year });

  if (decision.route === ROUTES.REFUSE) {
    throw new Error('validateForTier: asset refused (unofficial/scraper embed host) — no tier');
  }

  if (tier === TIERS.CHAIN) {
    if (!canGoOnChain(asset, { year })) {
      throw new Error('validateForTier: only host-posture assets may go on the immutable chain tier');
    }
    return decision;
  }

  if (tier === TIERS.IPFS) {
    const posture = classify(asset, { year }).posture;
    if (posture !== POSTURES.HOST) {
      throw new Error('validateForTier: ipfs-pinned tier accepts host-posture assets only');
    }
    return decision;
  }

  if (tier === TIERS.EMBED) {
    if (decision.route !== ROUTES.WINDOW || decision.tier !== TIERS.EMBED) {
      throw new Error('validateForTier: embed tier requires a window-posture asset on a whitelisted surface');
    }
    return decision;
  }

  throw new Error(`validateForTier: unknown tier ${JSON.stringify(tier)}`);
}

// ── tagAsset ──────────────────────────────────────────────────────────────────────────────────────
/**
 * The full provenance tag every asset ends up carrying. PURE; year injected.
 * @returns {{ license, posture, route, tier, attribution?, flags }}
 */
export function tagAsset(asset = {}, { year } = {}) {
  const { license, posture } = classify(asset, { year });
  const decision = route(asset, { year });
  const tag = {
    license,
    posture: decision.route === ROUTES.REFUSE ? null : posture,
    route: decision.route,
    tier: decision.tier,
    flags: decision.flags,
  };
  if (decision.attribution) tag.attribution = true;
  return tag;
}

// ── CLI demo (offline) ──────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('license-router.mjs')) {
  const YEAR = 2026;
  const fixtures = [
    { label: '1924 recording', asset: { kind: 'recording', publishedYear: 1924 } },
    { label: '1928 recording', asset: { kind: 'recording', publishedYear: 1928 } },
    { label: '1929 composition', asset: { kind: 'composition', publishedYear: 1929 } },
    { label: 'US-gov film', asset: { kind: 'film', source: 'us-gov' } },
    { label: 'pure-AI image', asset: { kind: 'image', source: 'pure-ai' } },
    { label: 'CC-BY paper', asset: { kind: 'text', license: 'cc-by' } },
    { label: 'CC-BY-NC song', asset: { kind: 'recording', license: 'cc-by-nc' } },
    { label: 'YouTube official', asset: { kind: 'film', embedHost: 'youtube.com', license: 'copyrighted' } },
    { label: '2embed mirror', asset: { kind: 'film', embedHost: '2embed.to', license: 'copyrighted' } },
    { label: 'modern bestseller', asset: { kind: 'text', publishedYear: 2023, license: 'copyrighted' } },
  ];
  for (const { label, asset } of fixtures) {
    const t = tagAsset(asset, { year: YEAR });
    const chain = canGoOnChain(asset, { year: YEAR }) ? 'chain-OK' : 'no-chain';
    console.log(
      `${label.padEnd(20)} → posture=${String(t.posture).padEnd(7)} route=${t.route.padEnd(7)} ` +
      `tier=${String(t.tier).padEnd(12)} ${chain.padEnd(9)} flags=[${t.flags.join(',')}]`
    );
  }
}
