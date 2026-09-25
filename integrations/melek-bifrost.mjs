// melek-bifrost.mjs — MELEK Bifrost: the video platform (dTube-style front end + YouTube/TikTok) that lives
// under Pentecaust. "Bifröst" = the shimmering bridge between the world of humans (Midgard) and the realm
// where the gods dwell (Asgard) — here, the bridge between people and Hathor / the divine.
// A video POST is a chain comment (video URL + thumbnail + tags in metadata, the dTube/3Speak model); the
// bytes ride HardDrive (presigned R2 upload); the GenAI studio is the Creator Studio for thumbnails/intros.
// This module is the pure data model + safe HTML fragment builders (no network); the server wires storage,
// the chain publish (MELEK-Signer), and the routes.
//
//   import { makeVideoPost, validateVideoPost, playerHtml, feedCardHtml, fmtViews, fmtDuration } from './melek-bifrost.mjs'

const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const isImgUrl = (u) => /^(https?:)?\/\/[\w./%-]+\.(jpe?g|png|webp|gif)(\?[\w=&%.-]*)?$/i.test(String(u || '')) || /^\/img\/[\w.-]+\.(jpe?g|png|webp)$/i.test(String(u || ''));
const isVidUrl = (u) => /^https?:\/\/[\w./%:-]+\.(mp4|webm|mov|m4v)(\?[\w=&%.:-]*)?$/i.test(String(u || '')) || /^\/img\/[\w.-]+\.(mp4|webm|mov|m4v)$/i.test(String(u || ''));

export const VIDEO_MODES = { grid: 'grid', scroll: 'scroll' }; // YouTube grid vs TikTok vertical scroll

export function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(+sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
}
export function fmtViews(n) {
  n = Math.max(0, Math.floor(+n || 0));
  if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n % 1e3 ? 1 : 0) + 'K';
  return String(n);
}
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'video';
const rid = () => Math.random().toString(36).slice(2, 8);

// Build a video-post record. permlink is chain-ready (author+permlink identify the on-chain comment).
export function makeVideoPost({ author, title, description = '', videoUrl, thumbUrl = '', durationSec = 0, tags = [], now = Date.now() } = {}) {
  const a = String(author || 'anon').replace(/[^a-z0-9._-]/gi, '').slice(0, 40) || 'anon';
  const permlink = `bifrost-${slug(title)}-${rid()}`;
  return {
    id: `${a}/${permlink}`, author: a, permlink,
    title: String(title || 'Untitled').slice(0, 200),
    description: String(description || '').slice(0, 5000),
    videoUrl: String(videoUrl || ''), thumbUrl: String(thumbUrl || ''),
    durationSec: Math.max(0, Math.floor(+durationSec || 0)),
    tags: (Array.isArray(tags) ? tags : String(tags).split(/[ ,]+/)).map((t) => slug(t)).filter(Boolean).slice(0, 8),
    views: 0, createdAt: now,
  };
}

export function validateVideoPost(p) {
  const errors = [];
  if (!p || typeof p !== 'object') return { valid: false, errors: ['no post'] };
  if (!p.title || !p.title.trim()) errors.push('title required');
  if (!isVidUrl(p.videoUrl)) errors.push('videoUrl must be a real mp4/webm/mov URL');
  if (p.thumbUrl && !isImgUrl(p.thumbUrl)) errors.push('thumbUrl must be an image URL');
  return { valid: errors.length === 0, errors };
}

// The chain op that publishes a video (dTube/3Speak model): a comment carrying the video in json_metadata.
export function toCommentOp(p, { parentPermlink = 'bifrost' } = {}) {
  return ['comment', {
    parent_author: '', parent_permlink: parentPermlink, author: p.author, permlink: p.permlink,
    title: p.title, body: `${p.description}\n\n[▶ Watch on MELEK Bifrost](/pentecaust/bifrost/watch/${p.author}/${p.permlink})`,
    json_metadata: JSON.stringify({ app: 'melek-bifrost/0.1', tags: ['bifrost', ...p.tags], video: { url: p.videoUrl, thumbnail: p.thumbUrl, duration: p.durationSec } }),
  }];
}

// Safe HTML <video> player. Falls back to a message if the URL isn't a valid video.
export function playerHtml(p, { vertical = false } = {}) {
  if (!p || !isVidUrl(p.videoUrl)) return `<div class=card><p class=empty>This video isn’t available.</p></div>`;
  const poster = isImgUrl(p.thumbUrl) ? ` poster="${esc(p.thumbUrl)}"` : '';
  const style = vertical ? 'aspect-ratio:9/16;max-height:80vh' : 'aspect-ratio:16/9;width:100%';
  return `<video controls playsinline preload=metadata${poster} style="${style};background:#000;border-radius:10px" src="${esc(p.videoUrl)}"></video>`;
}

// A feed card (grid tile or a full-screen vertical scroll slide).
export function feedCardHtml(p, { vertical = false, base = '/pentecaust/bifrost' } = {}) {
  const href = `${base}/watch/${esc(p.author)}/${esc(p.permlink)}`;
  const thumb = isImgUrl(p.thumbUrl)
    ? `<img src="${esc(p.thumbUrl)}" alt="" loading=lazy style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px;background:#111">`
    : `<div style="width:100%;aspect-ratio:16/9;border-radius:10px;background:linear-gradient(135deg,#241b3a,#122a3a);display:flex;align-items:center;justify-content:center;color:#5b6">▶</div>`;
  const dur = p.durationSec ? `<span style="position:absolute;right:8px;bottom:8px;background:#000a;padding:1px 6px;border-radius:4px;font-size:12px">${fmtDuration(p.durationSec)}</span>` : '';
  if (vertical) {
    return `<section style="scroll-snap-align:start;min-height:88vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px">
      ${playerHtml(p, { vertical: true })}
      <div style="max-width:520px;text-align:center"><b>${esc(p.title)}</b><div class=muted>@${esc(p.author)} · ${fmtViews(p.views)} views</div></div></section>`;
  }
  return `<a href="${href}" style="text-decoration:none;color:inherit"><div style="position:relative">${thumb}${dur}</div>
    <div style="margin-top:6px"><b style="display:block;line-height:1.3">${esc(p.title)}</b><span class=muted style="font-size:13px">@${esc(p.author)} · ${fmtViews(p.views)} views</span></div></a>`;
}

if (process.argv[1] && process.argv[1].endsWith('melek-bifrost.mjs')) {
  const p = makeVideoPost({ author: 'hathor', title: 'Welcome to MELEK Bifrost', videoUrl: 'https://x/y.mp4', thumbUrl: '/img/t.png', durationSec: 95, tags: 'intro melek' });
  console.log(JSON.stringify(p, null, 2));
  console.log('valid:', validateVideoPost(p));
}
