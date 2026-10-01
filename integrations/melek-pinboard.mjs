// melek-pinboard.mjs — MELEK PINBOARD: the picture side, the way BiFrost is the video side.
//
// WHAT IT IS. Instagram/Vine for what people make, Pinterest for what they find: you post a photo or a
// small album, or you SAVE a picture you came across — from a MELEK blog post or from any website —
// and everything lands in one grid of thumbnails instead of a one-at-a-time column like Steemit or Reddit.
//
// THE TWO KINDS OF PIN, and the difference matters:
//   • made   — a photo or album the poster is publishing. The bytes are ours (HardDrive / the image host).
//   • saved  — a bookmark of someone else's picture: the thumbnail, the title, and A LINK HOME. A saved pin
//              always keeps `sourceUrl` and shows where it came from; we never present it as the poster's
//              own work, and the picture is loaded from its own source, not rehosted.
//
// BOTH DIRECTIONS, which is the point:
//   • a picture in a MELEK blog post → saved to the picture side in one click (pinsFromPost)
//   • a pin → dropped into a MELEK blog post as markdown (markdownFor)
//
// ON THE CHAIN, BUT NOT A BLOG POST. A pin is NOT a `comment`: a few hundred pins would drown somebody's
// blog, and saving a picture is not publishing an article. It is stored as a `custom_json` — the standard
// Graphene op apps use for small records (the same one Hive uses for follows and reblogs). It is signed
// with the POSTING key, carries no payout, and never appears in the blog feed. If the person wants a real
// post about their pictures, they write one; that is a separate act.
// This module is the PURE model + HTML builders: no network, no keys, no chain writes. The server wires
// storage and MELEK-Signer.
//
//   import { makePin, validatePin, pinsFromPost, gridHtml, pinHtml, markdownFor, boardOf } from './melek-pinboard.mjs'

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const IMG_RE = /\.(jpe?g|png|webp|gif|avif)(\?[^\s)]*)?$/i;
export const isImageUrl = (u) => {
  const s = String(u || '');
  if (/^\/img\/[\w.-]+$/.test(s)) return true;                       // our own image host path
  try {
    const x = new URL(s);
    return (x.protocol === 'https:' || x.protocol === 'http:') && IMG_RE.test(x.pathname);
  } catch { return false; }
};

/** http(s) only — never javascript:, data:, file: */
export const safeUrl = (u) => {
  const s = String(u || '');
  if (/^\/img\/[\w.-]+$/.test(s)) return s;
  try { const x = new URL(s); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; } catch { return ''; }
};

export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const rid = () => Math.random().toString(36).slice(2, 8);
const clamp = (s, n) => String(s == null ? '' : s).slice(0, n);

export const KINDS = ['made', 'saved'];
export const MAX_ALBUM = 20;

/**
 * One pin: a single picture, or a small album (up to 20).
 * `images` is [{ url, alt }]; the first is the cover.
 */
export function makePin({ author, title = '', note = '', images = [], kind = 'made', sourceUrl = '', sourceAuthor = '', board = '', tags = [], now = Date.now() } = {}) {
  const a = String(author || 'anon').replace(/[^a-z0-9._-]/gi, '').slice(0, 40) || 'anon';
  const pics = (Array.isArray(images) ? images : [images]).map((i) => (typeof i === 'string' ? { url: i } : i || {}))
    .map((i) => ({ url: safeUrl(i.url), alt: clamp(i.alt, 200) }))
    .filter((i) => isImageUrl(i.url))
    .slice(0, MAX_ALBUM);
  const k = KINDS.includes(kind) ? kind : 'made';
  return {
    id: `${a}/pin-${slug(title) || 'untitled'}-${rid()}`,
    author: a,
    kind: k,
    title: clamp(title, 200),
    note: clamp(note, 2000),
    images: pics,
    cover: pics.length ? pics[0].url : '',
    album: pics.length > 1,
    // where a SAVED pin came from — kept for the life of the pin, shown on the card
    sourceUrl: k === 'saved' ? safeUrl(sourceUrl) : '',
    sourceAuthor: k === 'saved' ? clamp(sourceAuthor, 60) : '',
    board: slug(board),
    tags: (Array.isArray(tags) ? tags : String(tags).split(/[ ,]+/)).map(slug).filter(Boolean).slice(0, 8),
    saves: 0, createdAt: now,
  };
}

export function validatePin(p) {
  const errors = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['no pin'] };
  if (!p.images || !p.images.length) errors.push('a pin needs at least one picture');
  if (p.images && p.images.length > MAX_ALBUM) errors.push(`an album holds at most ${MAX_ALBUM} pictures`);
  if (p.images && p.images.some((i) => !isImageUrl(i.url))) errors.push('every picture must be a real image URL');
  // A saved pin without its source is a picture taken from someone with the credit stripped off.
  if (p.kind === 'saved' && !p.sourceUrl) errors.push('a saved pin must keep the link it came from');
  return { valid: errors.length === 0, errors };
}

/** every image URL in a markdown/HTML body, in order, de-duplicated */
export function imagesIn(body, { limit = MAX_ALBUM } = {}) {
  const out = []; const seen = new Set();
  const add = (u) => { const s = safeUrl(u); if (s && isImageUrl(s) && !seen.has(s)) { seen.add(s); out.push(s); } };
  const text = String(body || '');
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) add(m[1]);       // markdown
  for (const m of text.matchAll(/<img[^>]+src=["']([^"']+)/gi)) add(m[1]);   // html
  for (const m of text.matchAll(/https?:\/\/[^\s)<>"']+/g)) add(m[0]);       // bare links
  return out.slice(0, limit);
}

/**
 * MELEK blog post → saved pins. This is the "share a blog post's photos to the picture side" direction:
 * every picture in the post becomes a pin that links back to the post and keeps the author's name.
 * `one:true` makes a single album pin instead of one pin per picture.
 */
export function pinsFromPost(post = {}, { saver, one = false, baseUrl = 'https://melek.salon', now = Date.now() } = {}) {
  const author = String(post.author || '').replace(/^@/, '');
  const permlink = String(post.permlink || '');
  const url = safeUrl(post.url || (author && permlink ? `${baseUrl}/@${author}/${permlink}` : ''));
  const pics = imagesIn(post.body);
  if (!pics.length) return [];
  const common = { author: saver || author, kind: 'saved', sourceUrl: url, sourceAuthor: author, now };
  if (one) return [makePin({ ...common, title: post.title || '', images: pics.map((u) => ({ url: u })) })];
  return pics.map((u) => makePin({ ...common, title: post.title || '', images: [{ url: u }] }));
}

/** a pin → markdown to paste into a MELEK blog post (the other direction) */
export function markdownFor(pin, { baseUrl = 'https://pin.melek.salon' } = {}) {
  if (!pin || !pin.images || !pin.images.length) return '';
  const title = pin.title || 'A picture';
  const body = pin.images.map((i) => `![${title}](${i.url})`).join('\n');
  const credit = pin.kind === 'saved' && pin.sourceUrl
    ? `\n\nSaved from ${pin.sourceAuthor ? `@${pin.sourceAuthor} — ` : ''}${pin.sourceUrl}`
    : `\n\n[On the pinboard](${baseUrl}/p/${encodeURIComponent(pin.id)})`;
  return `${body}${credit}`;
}

/**
 * The chain record for a pin: a standard Graphene `custom_json`, posting-key signed, no payout, not a post.
 * MELEK-Signer broadcasts it; nothing here holds a key. Kept small on purpose — the picture lives at its
 * own address, and this is the note saying who pinned it and where it came from.
 */
export const PIN_OP_ID = 'melek_pin';
export function pinOp(pin, { account } = {}) {
  if (!pin || !pin.cover) return null;
  const who = String(account || pin.author || '').toLowerCase();
  if (!who) return null;
  return ['custom_json', {
    required_auths: [],
    required_posting_auths: [who],
    id: PIN_OP_ID,
    json: JSON.stringify({
      v: 1,
      id: pin.id,
      kind: pin.kind,
      img: pin.images.map((i) => i.url).slice(0, MAX_ALBUM),
      title: pin.title || undefined,
      src: pin.sourceUrl || undefined,
      by: pin.sourceAuthor || undefined,
      board: pin.board || undefined,
      ts: pin.createdAt,
    }),
  }];
}

/** group a list of pins into boards (a board is just a name a pin was filed under) */
export function boardOf(pins = [], board = '') {
  const b = slug(board);
  return (Array.isArray(pins) ? pins : []).filter((p) => (b ? p.board === b : true));
}

// ── rendering: a grid of thumbnails, not a column of posts ──────────────────────────────────────────
/** one card in the grid */
export function pinHtml(p) {
  if (!p || !p.cover) return '';
  const href = `/p/${encodeURIComponent(p.id)}`;
  const from = p.kind === 'saved' && p.sourceUrl
    ? `<a class=pb-src href="${esc(p.sourceUrl)}" target=_blank rel="noopener noreferrer">${esc(p.sourceAuthor ? '@' + p.sourceAuthor : hostOf(p.sourceUrl))}</a>`
    : `<span class=pb-src>@${esc(p.author)}</span>`;
  return `<article class=pb-card>
<a href="${esc(href)}"><img src="${esc(p.cover)}" alt="${esc((p.images[0] && p.images[0].alt) || p.title)}" loading=lazy></a>
${p.album ? `<span class=pb-album title="${p.images.length} pictures">▣ ${p.images.length}</span>` : ''}
<div class=pb-meta>${p.title ? `<a class=pb-title href="${esc(href)}">${esc(p.title)}</a>` : ''}${from}
<button class=pb-save data-pin="${esc(p.id)}" aria-label="Save this">📌 Save</button></div>
</article>`;
}

/** the Pinterest-style masonry wall */
export function gridHtml(pins = []) {
  const list = (Array.isArray(pins) ? pins : []).filter((p) => p && p.cover);
  if (!list.length) return '<p class=pb-empty>Nothing pinned yet. Post a picture, or save one you found.</p>';
  return `<div class=pb-grid>${list.map(pinHtml).join('')}</div>`;
}

export const PINBOARD_CSS = `<style>
.pb-grid{columns:5 200px;column-gap:14px}
.pb-card{position:relative;break-inside:avoid;margin:0 0 14px;background:var(--panel,#171a23);border:1px solid var(--bd,#2a2f3d);border-radius:14px;overflow:hidden}
.pb-card img{display:block;width:100%;height:auto}
.pb-album{position:absolute;top:8px;right:8px;background:rgba(0,0,0,.65);color:#fff;border-radius:8px;padding:2px 7px;font-size:12px}
.pb-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;font-size:13px}
.pb-title{font-weight:700;text-decoration:none;flex:1 1 100%}
.pb-src{color:var(--mut,#9aa0ad);font-size:12px;text-decoration:none}
.pb-save{margin-left:auto;font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--bd,#2a2f3d);background:transparent;color:inherit;border-radius:8px;padding:3px 9px}
.pb-empty{color:var(--mut,#9aa0ad)}
@media(max-width:700px){.pb-grid{columns:2 140px;column-gap:10px}.pb-card{margin-bottom:10px}}
</style>`;
