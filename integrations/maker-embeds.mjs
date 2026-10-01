// integrations/maker-embeds.mjs — ONE embed layer for the things people make here.
//
// Somebody makes a song in Hathor Sandalphon, a picture or a chart in Hathor Metatron, a map, a diagram,
// a beat, a video. Today they can copy a link. This module turns that link into a CARD that renders the
// same way everywhere it is pasted:
//
//   • Pentecaust messages and group chat   • Herald emails   • Pact (groups and clubs) feeds   • MELEK posts
//
// TWO RULES, BOTH LOAD-BEARING.
//   1. OUR OWN HOSTS ONLY. An embed is an <iframe> or a <video>; pointing one at an arbitrary host is how
//      a chat becomes a drive-by. Only the surfaces in HOSTS below can ever be framed. Anything else from
//      a message stays a plain, escaped LINK (never auto-framed), which is also what email needs.
//   2. EMAIL CANNOT RUN ANYTHING. Herald gets a picture + a link, never an iframe or a script — mail
//      clients strip them, and an email that depends on one arrives broken. `render(…, { for: 'email' })`.
//
// Custom emoji / stickers ride the same path: `:name:` in text resolves against a per-account or per-group
// set of small images (the Discord/Slack model), through the same escaping and the same host allowlist.
//
//   import { parseEmbed, render, findEmbeds, renderText, EMOJI_RE } from './maker-embeds.mjs'

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// The only hosts whose pages may be framed. Env-overridable for staging; never user-supplied.
const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const HOSTS = (env('EMBED_HOSTS', [
  'stream.soapbox.community',     // SoapBox Music + Stream
  'hathor.soapbox.community',     // Studio pictures, animations, remakes
  'pentecaust.com', 'pact.pentecaust.com',
  'tools.soapbox.community',      // diagram maker, charts, calculators
  'wiki.soapbox.community', 'hathor.live', 'melek.salon',
].join(','))).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const hostAllowed = (h) => {
  const x = String(h || '').toLowerCase();
  return HOSTS.some((d) => x === d || x.endsWith('.' + d));
};

/** http(s) only, and only our hosts — everything else is refused here and stays a plain link. */
function ourUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return hostAllowed(u.hostname) ? u : null;
  } catch { return null; }
}

/**
 * What kind of made thing is this link?
 * @returns {{kind,title,url,embed?,image?,audio?,video?}|null}
 */
export function parseEmbed(raw) {
  const u = ourUrl(raw);
  if (!u) return null;
  const h = u.hostname.toLowerCase();
  const p = u.pathname.replace(/\/+$/, '');
  const abs = (path) => `${u.protocol}//${u.host}${path}`;

  // a song in SoapBox Music → the standard player panel
  let m = p.match(/^\/music\/(?:t|embed)\/([a-z0-9-]+)$/);
  if (m) return { kind: 'song', title: 'A song on SoapBox Music', url: abs(`/music/t/${m[1]}`), embed: abs(`/music/embed/${m[1]}`), height: 300 };

  // a film / video on SoapBox Stream
  if (/^\/watch$/.test(p) && u.searchParams.get('id')) return { kind: 'video', title: 'A video on SoapBox Stream', url: u.href, embed: u.href, height: 420 };
  m = p.match(/^\/watch\/([a-z]+)\/(.+)$/);
  if (m) return { kind: 'video', title: 'A video on SoapBox Stream', url: u.href, embed: u.href, height: 420 };

  // a picture made in the Studio, or a clip from the animation lab
  if (/^\/img\/[\w.-]+$/.test(p)) return { kind: 'image', title: 'A picture made here', url: u.href, image: u.href };
  if (/^\/p\/[\w.-]+$/.test(p)) return { kind: 'image', title: 'A picture made here', url: u.href, image: abs(p.replace('/p/', '/img/')) };
  if (/^\/animations\/media\/[\w.-]+$/.test(p)) return { kind: 'video', title: 'A test animation', url: u.href, video: `${u.href.replace(/\/$/, '')}/clip.mp4`, poster: `${u.href.replace(/\/$/, '')}/poster.jpg` };
  if (/\.(mp4|webm)$/i.test(p)) return { kind: 'video', title: 'A video made here', url: u.href, video: u.href };
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(p)) return { kind: 'image', title: 'A picture made here', url: u.href, image: u.href };
  if (/\.(mp3|ogg|opus|m4a|wav)$/i.test(p)) return { kind: 'audio', title: 'A recording made here', url: u.href, audio: u.href };

  // a beat from the beat maker (the beat itself lives in the link)
  if (h.endsWith('pentecaust.com') && /^\/(sandalphon\/)?beats$/.test(p) && /^#?b=/.test(u.hash.replace('#', '#'))) {
    return { kind: 'beat', title: 'A beat to play', url: u.href, embed: u.href, height: 260 };
  }
  // a diagram, chart or map from Tools
  if (h === 'tools.soapbox.community' && /^\/(diagram|map|chart)\b/.test(p)) {
    return { kind: 'chart', title: 'A diagram made in Tools', url: u.href, embed: u.href, height: 420 };
  }
  // a Pact group or a wiki page → a plain card, no frame
  if (/^\/groups\/[a-z0-9-]+$/.test(p)) return { kind: 'group', title: 'A group on Pact', url: u.href };
  if (/^\/wiki\/[\w%().,'-]+$/.test(p)) return { kind: 'page', title: 'A page in the Library', url: u.href };
  return { kind: 'link', title: u.href.replace(/^https?:\/\//, ''), url: u.href };
}

/**
 * One card. `for:'email'` never emits a frame, a script or a <video> — a picture and a link instead.
 */
export function render(e, { for: where = 'web' } = {}) {
  if (!e || !e.url) return '';
  const link = esc(e.url);
  const title = esc(e.title || e.url);
  const open = `<a class=me-open href="${link}" target=_blank rel="noopener noreferrer">${title}</a>`;
  if (where === 'email') {
    const pic = e.image || e.poster;
    return `<div class=me-card>${pic ? `<a href="${link}"><img src="${esc(pic)}" alt="" style="max-width:100%;border-radius:10px"></a><br>` : ''}${open}</div>`;
  }
  if (e.image) return `<div class=me-card><a href="${link}" target=_blank rel="noopener noreferrer"><img src="${esc(e.image)}" alt="${title}" loading=lazy style="max-width:100%;border-radius:10px"></a></div>`;
  if (e.audio) return `<div class=me-card><audio controls preload=none src="${esc(e.audio)}"></audio><br>${open}</div>`;
  if (e.video) return `<div class=me-card><video controls preload=metadata playsinline${e.poster ? ` poster="${esc(e.poster)}"` : ''} src="${esc(e.video)}" style="max-width:100%;border-radius:10px"></video><br>${open}</div>`;
  if (e.embed) {
    return `<div class=me-card><iframe src="${esc(e.embed)}" title="${title}" height="${Number(e.height) || 300}" loading=lazy`
      + ` referrerpolicy=no-referrer sandbox="allow-scripts allow-same-origin allow-popups"`
      + ` style="width:100%;border:0;border-radius:10px"></iframe><br>${open}</div>`;
  }
  return `<div class=me-card>${open}</div>`;
}

/** every embeddable link in a piece of text, in order, de-duplicated (at most `limit`) */
export function findEmbeds(text, { limit = 3 } = {}) {
  const out = []; const seen = new Set();
  for (const m of String(text || '').matchAll(/https?:\/\/[^\s<>"')]+/g)) {
    const e = parseEmbed(m[0]);
    if (!e || e.kind === 'link' || seen.has(e.url)) continue;
    seen.add(e.url); out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

export const EMOJI_RE = /:([a-z0-9_+-]{2,32}):/gi;

/**
 * Escape a message, turn `:name:` into the group's / account's custom emoji, link bare URLs, and append
 * a card for each embeddable link. `emoji` is a { name: imageUrl } map; an unknown name stays as typed,
 * and an emoji URL must be on one of our hosts or it is left as text.
 */
export function renderText(text, { emoji = {}, for: where = 'web', limit = 3 } = {}) {
  let html = esc(text);
  html = html.replace(/(https?:\/\/[^\s<>"')]+)/g, (u) => `<a href="${u}" target=_blank rel="noopener noreferrer">${u.replace(/^https?:\/\//, '')}</a>`);
  html = html.replace(EMOJI_RE, (whole, name) => {
    const src = emoji[String(name).toLowerCase()];
    const ok = src && ourUrl(src);
    return ok ? `<img class=me-emoji src="${esc(src)}" alt=":${esc(name)}:" title=":${esc(name)}:" style="height:1.4em;vertical-align:-0.25em">` : whole;
  });
  const cards = findEmbeds(text, { limit }).map((e) => render(e, { for: where })).join('');
  return cards ? `${html}${cards}` : html;
}

export const EMBED_CSS = `<style>
.me-card{margin:6px 0;max-width:460px}.me-card img,.me-card video{display:block}
.me-open{font-size:12px;opacity:.8}.me-emoji{height:1.4em;vertical-align:-0.25em}
</style>`;
