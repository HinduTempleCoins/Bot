// coin-socials.mjs — turn a coin's scattered link fields into a clean, typed set of social
// presences, and render them on the coin page: an embedded live Twitter/X timeline plus
// buttons for Discord / Telegram / Reddit / YouTube / Facebook / GitHub / website.
//
// Two inputs feed it:
//   1) the coin object the adapters already build (coin.links.social[], coin.official.{reddit,chats,repos})
//   2) a small CURATED override map for major chains — adapter data is often stale or missing
//      the Discord/Telegram, and for the headline coins we want it exactly right.
//
// PURE + soft-fail. No network here. The Twitter timeline is a client-side widget (the official
// platform.twitter.com/widgets.js), so the server only emits markup; nothing is fetched here.
//
//   import { socialsFor, renderSocials } from './coin-socials.mjs'
//   const s = socialsFor(coin);            // { twitter, discord, telegram, reddit, ... }
//   const html = renderSocials(coin);      // a ready-to-drop card body (timeline + buttons)
//
//   node integrations/soapbox/coin-socials.mjs bitcoin   # print the resolved socials

// ---- platform classification -------------------------------------------------

// order matters: more specific hosts first
const PLATFORMS = [
  { key: 'twitter',   label: 'Twitter / X', icon: '𝕏',  hosts: ['twitter.com', 'x.com'] },
  { key: 'discord',   label: 'Discord',     icon: '🎮', hosts: ['discord.gg', 'discord.com', 'discordapp.com'] },
  { key: 'telegram',  label: 'Telegram',    icon: '✈️', hosts: ['t.me', 'telegram.me', 'telegram.org'] },
  { key: 'reddit',    label: 'Reddit',      icon: '👽', hosts: ['reddit.com'] },
  { key: 'youtube',   label: 'YouTube',     icon: '▶️', hosts: ['youtube.com', 'youtu.be'] },
  { key: 'facebook',  label: 'Facebook',    icon: '📘', hosts: ['facebook.com', 'fb.com'] },
  { key: 'instagram', label: 'Instagram',   icon: '📷', hosts: ['instagram.com'] },
  { key: 'linkedin',  label: 'LinkedIn',    icon: '💼', hosts: ['linkedin.com'] },
  { key: 'github',    label: 'GitHub',      icon: '🐙', hosts: ['github.com'] },
  { key: 'medium',    label: 'Medium',      icon: '✍️', hosts: ['medium.com'] },
  { key: 'mastodon',  label: 'Mastodon',    icon: '🐘', hosts: ['mastodon.', 'mas.to'] },
  { key: 'bitcointalk', label: 'Bitcointalk', icon: '💬', hosts: ['bitcointalk.org'] },
];

function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return String(url || '').toLowerCase(); }
}

// classify a single URL → { key, label, icon, url } or null
export function classify(url) {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return null;
  const h = host(u);
  for (const p of PLATFORMS) {
    if (p.hosts.some((x) => x.endsWith('.') ? h.startsWith(x) : (h === x || h.endsWith(`.${x}`)))) {
      return { key: p.key, label: p.label, icon: p.icon, url: u };
    }
  }
  return null;
}

// pull the bare twitter handle (no @) out of a twitter/x URL
export function twitterHandle(url) {
  const c = classify(url);
  if (!c || c.key !== 'twitter') return null;
  try {
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, '');
    const seg = path.split('/')[0];
    if (!seg || /^(home|search|hashtag|i|intent|share)$/i.test(seg)) return null;
    return seg.replace(/^@/, '');
  } catch { return null; }
}

// ---- curated overrides for the headline coins (adapter data is often stale) ---
// Keyed by coingecko id OR uppercase symbol. Only the things adapters commonly miss.
export const CURATED = {
  bitcoin:  { reddit: 'https://reddit.com/r/Bitcoin', twitter: 'https://twitter.com/Bitcoin', bitcointalk: 'https://bitcointalk.org', github: 'https://github.com/bitcoin/bitcoin' },
  ethereum: { reddit: 'https://reddit.com/r/ethereum', twitter: 'https://twitter.com/ethereum', discord: 'https://discord.gg/ethereum-org', github: 'https://github.com/ethereum' },
  solana:   { twitter: 'https://twitter.com/solana', discord: 'https://discord.gg/solana', reddit: 'https://reddit.com/r/solana', github: 'https://github.com/solana-labs' },
  cardano:  { twitter: 'https://twitter.com/Cardano', reddit: 'https://reddit.com/r/cardano', discord: 'https://discord.gg/cardano' },
  ripple:   { twitter: 'https://twitter.com/Ripple', reddit: 'https://reddit.com/r/Ripple' },
  dogecoin: { twitter: 'https://twitter.com/dogecoin', reddit: 'https://reddit.com/r/dogecoin', github: 'https://github.com/dogecoin/dogecoin' },
  litecoin: { twitter: 'https://twitter.com/litecoin', reddit: 'https://reddit.com/r/litecoin', telegram: 'https://t.me/Litecoin' },
  polkadot: { twitter: 'https://twitter.com/Polkadot', reddit: 'https://reddit.com/r/dot', discord: 'https://discord.gg/polkadot' },
  chainlink:{ twitter: 'https://twitter.com/chainlink', reddit: 'https://reddit.com/r/Chainlink', discord: 'https://discord.gg/chainlink' },
  // MELEK-ecosystem / Graphene relatives — point at the real communities where they exist
  blurt:    { twitter: 'https://twitter.com/blurtofficial', discord: 'https://discord.gg/yMxqgZj' },
  hive:     { twitter: 'https://twitter.com/hiveblocks', reddit: 'https://reddit.com/r/Hive_io', discord: 'https://discord.gg/hive' },
  steem:    { twitter: 'https://twitter.com/steemnetwork', reddit: 'https://reddit.com/r/steemit' },
};

function curatedFor(coin) {
  if (!coin) return {};
  const byId = coin.id && CURATED[String(coin.id).toLowerCase()];
  const bySym = coin.symbol && CURATED[String(coin.symbol).toLowerCase()];
  return { ...(bySym || {}), ...(byId || {}) };
}

// ---- resolve a coin → one typed socials object -------------------------------

// Returns { twitter, twitterHandle, discord, telegram, reddit, youtube, facebook,
//           instagram, linkedin, github, medium, mastodon, bitcointalk, website, all:[...] }
export function socialsFor(coin) {
  const out = {};
  if (!coin || typeof coin !== 'object') return { all: [] };

  // candidate URLs from every place the adapters stash links
  const candidates = [];
  const push = (u) => { if (u && typeof u === 'string') candidates.push(u); };

  for (const s of (coin.links?.social || [])) push(s);
  const o = coin.official || {};
  push(o.reddit);
  push(o.forum);          // often Bitcointalk
  push(o.announcement);
  for (const c of (o.chats || [])) push(c);   // Discord / Telegram official chats
  for (const r of (o.repos || [])) push(r);   // GitHub

  // classify everything; first URL wins per platform (adapter order = priority)
  for (const url of candidates) {
    const c = classify(url);
    if (c && !out[c.key]) out[c.key] = url;
  }

  // curated overrides take precedence for the platforms they specify
  const cur = curatedFor(coin);
  for (const [k, v] of Object.entries(cur)) if (v) out[k] = v;

  // website is special (not a social platform but always shown)
  if (coin.links?.website) out.website = coin.links.website;

  out.twitterHandle = out.twitter ? twitterHandle(out.twitter) : null;

  // build an ordered, de-duplicated list for rendering
  const all = [];
  for (const p of PLATFORMS) {
    if (out[p.key]) all.push({ key: p.key, label: p.label, icon: p.icon, url: out[p.key] });
  }
  out.all = all;
  return out;
}

// ---- rendering ---------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

// the live Twitter/X timeline embed (client-side widget; degrades to a plain link if JS is off)
export function twitterTimelineHTML(handle, { name = '', height = 500 } = {}) {
  if (!handle) return '';
  const h = esc(handle);
  return `<div class="x-timeline" style="max-width:100%;min-height:120px">`
    + `<a class="twitter-timeline" data-height="${Number(height) || 500}" data-dnt="true" data-theme="dark" `
    + `href="https://twitter.com/${h}?ref_src=twsrc%5Etfw">Tweets by @${h}${name ? ` (${esc(name)})` : ''}</a>`
    + `<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>`
    + `</div>`;
}

// a row of pill buttons for every non-twitter social (twitter gets the embed above)
export function socialButtonsHTML(socials) {
  const list = (socials?.all || []);
  if (!list.length && !socials?.website) return '';
  const pill = (icon, label, url) => `<a href="${esc(url)}" rel="noopener" target="_blank" `
    + `style="display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border:1px solid var(--line2);`
    + `border-radius:999px;text-decoration:none;font-size:14px">${icon} ${esc(label)}</a>`;
  const buttons = [];
  if (socials.website) buttons.push(pill('🌐', 'Website', socials.website));
  for (const s of list) {
    if (s.key === 'twitter') continue;       // shown as a timeline, not a button
    buttons.push(pill(s.icon, s.label, s.url));
  }
  return buttons.length ? `<div style="display:flex;flex-wrap:wrap;gap:10px">${buttons.join('')}</div>` : '';
}

// full card body: timeline (if a handle resolves) + the button row. Returns '' when truly empty,
// so the caller can decide whether to render the surrounding card at all.
export function renderSocials(coin, opts = {}) {
  const s = socialsFor(coin);
  const parts = [];
  const tl = twitterTimelineHTML(s.twitterHandle, { name: coin?.name, height: opts.height });
  if (tl) parts.push(tl);
  // if we have a twitter URL but no usable handle, still give them the button
  if (!s.twitterHandle && s.twitter) {
    parts.push(`<a href="${esc(s.twitter)}" rel="noopener" target="_blank">𝕏 Twitter / X</a>`);
  }
  const buttons = socialButtonsHTML(s);
  if (buttons) parts.push(buttons);
  return parts.join('<div style="height:14px"></div>');
}

// does a coin have ANY social presence worth a card?
export function hasSocials(coin) {
  const s = socialsFor(coin);
  return !!(s.all.length || s.website);
}

// ---- CLI (guarded) -----------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('coin-socials.mjs')) {
  const id = process.argv[2] || 'bitcoin';
  const sym = (process.argv[3] || id).toUpperCase();
  const demo = {
    id, symbol: sym, name: id,
    links: { website: 'https://example.org', social: ['https://twitter.com/' + id] },
    official: { reddit: 'https://reddit.com/r/' + id, chats: ['https://discord.gg/abc', 'https://t.me/' + id], repos: ['https://github.com/' + id + '/' + id] },
  };
  const s = socialsFor(demo);
  console.log(JSON.stringify({ resolved: s, hasSocials: hasSocials(demo) }, null, 2));
  console.log('\n--- card body ---\n' + renderSocials(demo).slice(0, 600));
}
