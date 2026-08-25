// iptv-channels.mjs — the SoapBox STREAMING "Live TV" adapter over the iptv-org public playlists.
//
// Source: iptv-org (https://github.com/iptv-org/iptv) — the community-maintained, KEYLESS directory of
// publicly-listed, free-to-air / openly-broadcast TV channels. Every entry is an M3U row pointing at a
// channel's OWN public HLS (.m3u8) stream. We POINT at the broadcaster's own stream (free-to-air posture)
// and NEVER rehost or re-encode. Distributed as .m3u playlists at:
//   https://iptv-org.github.io/iptv/index.m3u                 (everything)
//   https://iptv-org.github.io/iptv/categories/<cat>.m3u      (news, movies, music, …)
//   https://iptv-org.github.io/iptv/countries/<cc>.m3u        (us, gb, …)
//
// LICENSING BASIS (why this is legal to surface): iptv-org lists channels that broadcasters/streamers
// make publicly available free-to-air — the same streams any browser could open directly. It is NOT a
// piracy index. We are still conservative: this adapter only emits a channel when its stream is an
// http(s) URL AND it is not flagged non-free / adult / geo-blocked (isFreeChannel). Anything that fails
// that test is DROPPED — the surface never lists it. Each tile carries a `license` of "Free-to-air".
//
// House style: ESM, zero deps, __setFetch hook, keyless, soft-fail-never-throw (→ []), esc() on HTML,
// guarded CLI. Pattern matches radio.mjs.
//
//   import { fetchChannels, parseM3U, isFreeChannel, __setFetch } from './iptv-channels.mjs'
//   node integrations/soapbox/iptv-channels.mjs news

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxStream/1.0 (+https://stream.soapbox.community)', accept: 'audio/x-mpegurl, application/vnd.apple.mpegurl, text/plain, */*' };
export const IPTV_BASE = (process.env.IPTV_BASE || 'https://iptv-org.github.io/iptv').replace(/\/$/, '');

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Categories/countries that route to iptv-org's own sub-playlists.
export const CATEGORY_PLAYLISTS = ['news', 'movies', 'music', 'entertainment', 'documentary', 'science', 'general'];

// Markers that make a channel NON-free / unsuitable — dropped outright (never listed).
const NON_FREE_MARKERS = [
  'xxx', 'adult', 'porn', 'geo-blocked', 'geoblocked', '[not 24/7]', 'timeshift',
];

function attrOf(line, key) {
  const m = line.match(new RegExp(`${key}="([^"]*)"`, 'i'));
  return m ? m[1].trim() : '';
}

/** True if a shaped channel is genuinely free-to-air & directly playable. */
export function isFreeChannel(ch) {
  if (!ch || !ch.streamUrl) return false;
  let u;
  try { u = new URL(ch.streamUrl); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false; // only real web streams
  // Explicit license attribute, if present, must not be a non-free one.
  const licTok = String(ch.licenseToken || '').toLowerCase();
  if (licTok && !/(free-to-air|public-domain|cc)/.test(licTok)) return false;
  const hay = `${ch.title || ''} ${ch.group || ''} ${ch.rawExtinf || ''}`.toLowerCase();
  return !NON_FREE_MARKERS.some((m) => hay.includes(m));
}

/**
 * Parse an M3U/M3U8 playlist body → shaped channels. PURE; soft-handles junk → [].
 * Only free-to-air, directly-playable channels are kept (isFreeChannel).
 */
export function parseM3U(text, { limit = 60, keepAll = false } = {}) {
  const body = String(text == null ? '' : text);
  if (!body) return [];
  const n = Math.max(1, Math.min(500, +limit || 60));
  const lines = body.split(/\r?\n/);
  const out = [];
  const seen = new Set();
  let pending = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXTINF/i.test(line)) {
      // #EXTINF:-1 tvg-id="X" tvg-logo="url" group-title="News" tvg-country="US" license="...",Name
      const nameMatch = line.match(/,(.*)$/);
      const name = nameMatch ? nameMatch[1].trim() : '';
      const licAttr = attrOf(line, 'license') || attrOf(line, 'tvg-license');
      pending = {
        id: attrOf(line, 'tvg-id') || '',
        title: name || attrOf(line, 'tvg-name') || 'Channel',
        thumb: attrOf(line, 'tvg-logo') || '',
        group: attrOf(line, 'group-title') || '',
        country: (attrOf(line, 'tvg-country') || '').toUpperCase(),
        rawExtinf: line,
        licenseToken: licAttr ? licAttr.toLowerCase() : 'free-to-air',
      };
      continue;
    }
    if (line.startsWith('#')) continue; // other directives (#EXTVLCOPT etc.) ignored
    // a URL line: completes the pending EXTINF into a channel.
    const streamUrl = line;
    const ch = {
      ...(pending || { title: 'Channel', group: '', country: '', rawExtinf: '', licenseToken: 'free-to-air' }),
      id: (pending && pending.id) || streamUrl,
      kind: 'live',
      streamUrl,
      license: 'Free-to-air',
      source: 'iptv-org',
      attribution: 'iptv-org (community, free-to-air listing)',
      posture: 'point', // owner's own public stream; we point/play, never rehost
    };
    pending = null;
    if (!keepAll && !isFreeChannel(ch)) continue;
    if (seen.has(ch.streamUrl)) continue;
    seen.add(ch.streamUrl);
    out.push(ch);
    if (out.length >= n) break;
  }
  return out;
}

/** Fetch a playlist (index, a category, or a country) → free channels. Soft-fail → []. */
export async function fetchChannels({ category = '', country = '', limit = 60 } = {}) {
  let path = '/index.m3u';
  if (category && CATEGORY_PLAYLISTS.includes(String(category).toLowerCase())) {
    path = `/categories/${String(category).toLowerCase()}.m3u`;
  } else if (country) {
    path = `/countries/${String(country).toLowerCase()}.m3u`;
  }
  try {
    const r = await _fetch(`${IPTV_BASE}${path}`, { headers: UA });
    if (!r || !r.ok) return [];
    const text = await r.text();
    return parseM3U(text, { limit });
  } catch { return []; }
}

// ── SECURITY: verify a URL is a REAL listed free-to-air channel ─────────────────────────────────────
// The /watch route must never trust a raw request URL. This resolves the live iptv-org free-channel set
// (cached) and returns true ONLY if `url` is an exact member — so an attacker cannot pass an arbitrary
// stream URL and have it treated as free-to-air/license-cleared.
let _freeSet = null;
let _freeSetAt = 0;
export function __clearFreeCache() { _freeSet = null; _freeSetAt = 0; }
export async function isListedFreeStream(url, { ttlMs = 600000, now = Date.now() } = {}) {
  const target = String(url == null ? '' : url).trim();
  if (!target) return false;
  if (!_freeSet || (now - _freeSetAt) > ttlMs) {
    const set = new Set();
    // index + each category playlist; every entry is already free-filtered by parseM3U/isFreeChannel.
    for (const cat of ['', ...CATEGORY_PLAYLISTS]) {
      try {
        const chans = await fetchChannels({ category: cat, limit: 5000 });
        for (const c of chans) if (c && c.streamUrl && isFreeChannel(c)) set.add(String(c.streamUrl).trim());
      } catch { /* one playlist down never breaks the check */ }
    }
    // only cache a non-empty result so a transient failure doesn't lock in an empty (deny-all) set
    if (set.size) { _freeSet = set; _freeSetAt = now; }
    else return false;
  }
  return _freeSet.has(target);
}

export function dataNote() {
  return 'Live TV via the iptv-org public directory (keyless, community-maintained). We list only '
    + 'free-to-air, publicly-broadcast channels and point at each broadcaster\'s own HLS stream — never a rehost or a piracy source.';
}

// ── CLI (guarded) ──────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('iptv-channels.mjs')) {
  const cat = (process.argv[2] || '').trim();
  const chans = await fetchChannels({ category: cat, limit: 20 });
  console.log(`SoapBox Stream · Live TV (iptv-org) — "${cat || 'index'}" — ${chans.length} free channel(s)`);
  console.log('─'.repeat(66));
  for (const c of chans) console.log(`  ${(c.title || '').slice(0, 40).padEnd(42)} ${c.country || '--'}  [${c.group || 'general'}]`);
  console.log('  ' + dataNote());
}
