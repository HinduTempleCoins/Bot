// embed-whitelist.mjs — the SoapBox video-EMBED safety gate (v3 §7 media layer). The single chokepoint
// that decides whether a given video URL may be turned into an <iframe> on the public site.
//
// THE SAMY-WORM RULE (why this module exists, documented): the 2005 Samy MySpace worm spread because a
// page embedded attacker-controlled markup that could run arbitrary JavaScript in the viewer's session.
// An <iframe> hands the framed origin a script context inside our page's tab; a hostile or scraper embed
// (2Embed, vidsrc, "free movie" iframe farms) can therefore run JS against our visitors, fingerprint
// them, redirect, or pop malware. So the rule is ZERO ARBITRARY JS: we only ever frame OFFICIAL,
// first-party players from a small hard-coded allowlist of well-behaved providers, and we REFUSE
// everything else with a reason. This is an allowlist, never a blocklist — unknown ⇒ refused.
//
// Pattern matches the sibling soapbox modules: ESM, zero deps, pure (no network, no __setFetch needed),
// soft-fail (never throws — bad input ⇒ { ok:false, reason }), guarded CLI.
//
//   import { allowedEmbed, embedUrl, ALLOWED_PROVIDERS } from './embed-whitelist.mjs'
//   allowedEmbed('https://www.youtube.com/watch?v=abc') // → { ok:true, provider:'YouTube', id:'abc', embed:'https://www.youtube-nocookie.com/embed/abc' }
//   allowedEmbed('https://2embed.cc/embed/tt123')       // → { ok:false, reason:'provider not on the official-embed allowlist' }
//   node integrations/soapbox/embed-whitelist.mjs "https://vimeo.com/12345"

// ── the allowlist ──────────────────────────────────────────────────────────────────────────────────
// Each provider: the official host suffixes we accept, a matcher that pulls the video id out of any of
// the provider's URL shapes, and a builder for the canonical OFFICIAL embed URL. Only first-party
// players appear here. Scraper/aggregator iframe hosts are intentionally ABSENT (⇒ refused by default).
export const ALLOWED_PROVIDERS = ['YouTube', 'Vimeo', 'Dailymotion', '3Speak', 'Internet Archive'];

const ID_SAFE = /^[\w.-]{1,64}$/; // ids we'll splice into an embed URL must be conservative (no slashes/JS)

const PROVIDERS = [
  {
    name: 'YouTube',
    hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'],
    id(u) {
      if (u.hostname.endsWith('youtu.be')) return u.pathname.slice(1).split('/')[0];
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2];
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2];
      return u.searchParams.get('v');
    },
    // youtube-nocookie is the privacy-enhanced official embed origin.
    embed: (id) => `https://www.youtube-nocookie.com/embed/${id}`,
  },
  {
    name: 'Vimeo',
    hosts: ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'],
    id(u) {
      if (u.hostname.startsWith('player.')) { const m = u.pathname.match(/\/video\/(\d+)/); return m ? m[1] : null; }
      const m = u.pathname.match(/\/(\d+)/); return m ? m[1] : null;
    },
    embed: (id) => `https://player.vimeo.com/video/${id}`,
  },
  {
    name: 'Dailymotion',
    hosts: ['dailymotion.com', 'www.dailymotion.com', 'dai.ly', 'geo.dailymotion.com'],
    id(u) {
      if (u.hostname.endsWith('dai.ly')) return u.pathname.slice(1).split('/')[0];
      const m = u.pathname.match(/\/video\/([A-Za-z0-9]+)/); return m ? m[1] : null;
    },
    embed: (id) => `https://www.dailymotion.com/embed/video/${id}`,
  },
  {
    name: '3Speak',
    // 3Speak is the HIVE-native video host — kindred to MELEK, first-party player only.
    hosts: ['3speak.tv', 'www.3speak.tv'],
    id(u) {
      // /watch?v=user/permlink  OR  /embed?v=user/permlink
      const v = u.searchParams.get('v');
      if (v) return v;
      const m = u.pathname.match(/\/watch\/([^/]+\/[^/]+)/); return m ? m[1] : null;
    },
    // 3Speak ids are user/permlink (contain a slash) — relax ID_SAFE for this provider via idCheck.
    idCheck: (id) => /^[\w.-]{1,40}\/[\w.-]{1,80}$/.test(id),
    embed: (id) => `https://3speak.tv/embed?v=${id}`,
  },
  {
    name: 'Internet Archive',
    hosts: ['archive.org', 'www.archive.org'],
    id(u) {
      if (u.pathname.startsWith('/embed/')) return u.pathname.slice('/embed/'.length).split('/')[0];
      if (u.pathname.startsWith('/details/')) return u.pathname.slice('/details/'.length).split('/')[0];
      return null;
    },
    embed: (id) => `https://archive.org/embed/${id}`,
  },
];

// host matches a provider's allowed suffix (exact host or a subdomain of an allowed host).
function hostAllowed(hostname, hosts) {
  const h = String(hostname || '').toLowerCase();
  return hosts.some((allowed) => h === allowed || h.endsWith('.' + allowed));
}

/**
 * The gate. Decide whether `url` is an OFFICIAL embed we'll frame.
 * Returns { ok:true, provider, id, embed } for an allowlisted first-party video URL, or
 *         { ok:false, reason } for anything else — bad input, non-https, unknown provider, or no id.
 * PURE and total: never throws.
 */
export function allowedEmbed(url) {
  if (!url || typeof url !== 'string') return { ok: false, reason: 'no url' };
  let u;
  try { u = new URL(url.trim()); } catch { return { ok: false, reason: 'unparseable url' }; }
  // Only https (and the archive/3speak http→https world); refuse javascript:, data:, file:, http:.
  if (u.protocol !== 'https:') return { ok: false, reason: `refused scheme "${u.protocol}" — https only (Samy-worm rule: no arbitrary JS origins)` };

  const provider = PROVIDERS.find((p) => hostAllowed(u.hostname, p.hosts));
  if (!provider) return { ok: false, reason: 'provider not on the official-embed allowlist' };

  let id;
  try { id = provider.id(u); } catch { id = null; }
  if (!id) return { ok: false, reason: `${provider.name}: could not extract a video id` };
  id = String(id);

  const idOk = provider.idCheck ? provider.idCheck(id) : ID_SAFE.test(id);
  if (!idOk) return { ok: false, reason: `${provider.name}: video id failed safety check` };

  return { ok: true, provider: provider.name, id, embed: provider.embed(id) };
}

/** Convenience: the official embed URL string for an allowed url, or null if refused. */
export function embedUrl(url) {
  const r = allowedEmbed(url);
  return r.ok ? r.embed : null;
}

// ── CLI (guarded) ──────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('embed-whitelist.mjs')) {
  const url = process.argv[2] || '';
  const r = allowedEmbed(url);
  console.log(`SoapBox embed gate — ${url || '(no url)'}`);
  console.log('─'.repeat(60));
  if (r.ok) console.log(`  ALLOWED  ${r.provider}  id=${r.id}\n  embed → ${r.embed}`);
  else console.log(`  REFUSED  ${r.reason}`);
  console.log(`  allowlist: ${ALLOWED_PROVIDERS.join(', ')} (official players only — Samy-worm rule: zero arbitrary JS)`);
}
