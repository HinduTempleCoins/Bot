// video-feed.mjs — READING MELEK video posts off the chain, and rendering one.
//
// This is the other half of the single-video path: video-post.mjs WRITES the metadata (as an unsigned
// intent), this READS it back off the chain and turns it into a page you can actually watch. Between
// them there is one complete loop, and nothing in either of them signs, uploads, pins or broadcasts.
//
// A MELEK video post is an ordinary `comment` tagged `reel` whose json_metadata carries a video
// reference (see video-post.mjs). So the "feed" is just `get_discussions_by_created` with a tag filter
// and a parse — no index, no custom API, no plugin. Posts that do not parse as video are skipped, which
// is also how a foreign DTube or 3Speak post shows up correctly if someone cross-posts one.
//
// ── THE PLAYER, AND WHY IT IS A <video> AND NOT AN <iframe> ────────────────────────────────────────
// The rest of the media hub is POINT posture — we frame the source's own official player and never
// rehost (embed-whitelist.mjs, the Samy-worm rule: zero arbitrary JS origins). A MELEK video is the one
// case where the source IS us: the bytes sit on a backend we chose, addressed by (provider, providerId),
// so we serve a plain <video> element with <source> per rendition. No iframe, no third-party origin, no
// arbitrary JS — strictly safer than the embeds, not looser.
//
// ── CAPTIONS ARE THE POINT ────────────────────────────────────────────────────────────────────────
// Every caption track in the metadata becomes a <track>. The ORIGINAL is always rendered and always
// labelled as the original; the reader's preferred language is the one marked `default`, and when we
// have no track in their language the default falls back to the original (captionFor's contract). The
// original is never dropped, hidden, or replaced — it is Pentecaust's rule applied to video.
//
// Injectable fetch (`__setFetch`), soft-fails to [] / null, escapes every interpolated value, never
// throws to a route.
//
//   import { recentVideos, getVideo, renderVideoList, renderVideoPage, __setFetch } from './video-feed.mjs'
//   node pentecaust/video-feed.mjs @hathor/reel-something     # live read (network)

import { fileURLToPath } from 'node:url';

import {
  parseVideoMetadata, captionFor, originalCaption, captionLanguages, langLabel,
  VIDEO_TAG, PROVIDERS, isProvider,
} from './video-post.mjs';
import { projectCost, renderCostPanel, checkClaim } from './video-cost.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

const RPC_URL = () => String(env('MELEK_RPC_URL', 'https://alpha.melek.salon/rpc')).replace(/\/+$/, '');

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

// ── house-style esc (escapes the single quote too, so attribute interpolation is always safe) ─────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const str = (v) => (v == null ? '' : String(v)).trim();

export const ACCOUNT_RE = /^[a-z][a-z0-9.-]{2,15}$/;
export const PERMLINK_RE = /^[a-z0-9][a-z0-9-]{0,254}$/;

// ── chain reads (soft; a dead node empties the row, it never breaks the page) ─────────────────────
async function rpc(method, params) {
  try {
    const r = await _fetch(RPC_URL(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    });
    if (!r || !r.ok) return null;
    const j = await r.json();
    return j && j.result;
  } catch { return null; }
}

/** One post row → our flat video view, or null when it isn't a video post. */
export function toVideoItem(post) {
  if (!post || typeof post !== 'object') return null;
  const parsed = parseVideoMetadata(post.json_metadata);
  if (!parsed || !parsed.ok) return null;
  const author = str(post.author).toLowerCase() || parsed.author;
  const permlink = str(post.permlink).toLowerCase() || parsed.permlink;
  if (!ACCOUNT_RE.test(author) || !PERMLINK_RE.test(permlink)) return null;
  return {
    ...parsed,
    author,
    permlink,
    title: parsed.title || str(post.title) || '(untitled)',
    body: str(post.body),
    created: str(post.created),
    payout: str(post.pending_payout_value) || str(post.total_payout_value),
    watch: `/media/watch/@${author}/${permlink}`,
  };
}

/**
 * recentVideos — the MELEK video feed: `reel`-tagged posts that parse as video.
 * Soft-fails to [] on a dead node, a bad response, or nothing to show. NEVER throws.
 */
export async function recentVideos({ tag = VIDEO_TAG, limit = 12 } = {}) {
  try {
    const n = Math.max(1, Math.min(50, Number(limit) || 12));
    const posts = await rpc('condenser_api.get_discussions_by_created', [{ tag: str(tag) || VIDEO_TAG, limit: n }]);
    const list = Array.isArray(posts) ? posts : [];
    const out = [];
    for (const p of list) {
      const item = toVideoItem(p);
      if (item) out.push(item);
    }
    return out;
  } catch { return []; }
}

/** getVideo — one post by @author/permlink, parsed. null when missing or not a video. Never throws. */
export async function getVideo({ author, permlink } = {}) {
  const a = str(author).replace(/^@/, '').toLowerCase();
  const p = str(permlink).toLowerCase();
  if (!ACCOUNT_RE.test(a) || !PERMLINK_RE.test(p)) return null;
  try {
    const post = await rpc('condenser_api.get_content', [a, p]);
    if (!post || !str(post.author)) return null;
    return toVideoItem(post);
  } catch { return null; }
}

// ── rendering ────────────────────────────────────────────────────────────────────────────────────
const fmtDuration = (s) => {
  const n = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(n / 3600); const m = Math.floor((n % 3600) / 60); const sec = n % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(sec).padStart(2, '0')}`;
};

/** The list of MELEK video posts for the Watch tab. PURE; renders its own empty state. */
export function renderVideoList(items = []) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const parts = ['<section class="melek-videos"><h2>On MELEK</h2>'];
  if (!list.length) {
    parts.push('<p class="video-empty">No MELEK videos on chain yet. A video post is an ordinary <code>comment</code> '
      + 'tagged <code>reel</code> whose <code>json_metadata</code> carries the video reference — no custom chain op.</p>');
    parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
    return parts.join('');
  }
  parts.push('<ul class="video-list">');
  for (const v of list) {
    const langs = captionLanguages(v.captions);
    const orig = originalCaption(v.captions);
    const cc = langs.length
      ? ` <span class="cc">CC ${esc(langs.length)} language${langs.length === 1 ? '' : 's'}`
        + (orig ? ` · original ${esc(langLabel(orig.lang) || orig.lang)}` : '') + '</span>'
      : ' <span class="linkout">no captions</span>';
    parts.push(`<li><a href="${esc(v.watch)}">${esc(v.title)}</a>`
      + ` <span class="smeta">@${esc(v.author)}</span>`
      + (v.duration ? ` <span class="smeta">${esc(fmtDuration(v.duration))}</span>` : '')
      + ` <span class="playable">▶ playable</span>${cc}`
      + ` <span class="src">${esc(providerLabel(v.provider))}</span></li>`);
  }
  parts.push('</ul>');
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

function providerLabel(p) {
  const key = String(p || '').toLowerCase();
  return isProvider(key) ? PROVIDERS[key].label : (key || 'unknown backend');
}

/** The <source> rows for the player, best rendition first. */
function sourceTags(v) {
  const rows = Array.isArray(v.sourceMap) ? v.sourceMap.filter((r) => r && String(r.type).toLowerCase() === 'video' && /^https:\/\//i.test(String(r.url || ''))) : [];
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(`<source src="${esc(r.url)}" type="${esc(typeForFormat(r.format, v.contentType))}"${r.quality ? ` data-quality="${esc(r.quality)}"` : ''}>`);
  }
  if (!out.length && /^https:\/\//i.test(String(v.url || ''))) {
    out.push(`<source src="${esc(v.url)}" type="${esc(v.contentType || 'video/mp4')}">`);
  }
  return out.join('');
}
function typeForFormat(format, fallback) {
  const f = String(format || '').toLowerCase();
  if (f === 'm3u8') return 'application/x-mpegurl';
  if (f === 'mpd') return 'application/dash+xml';
  if (['mp4', 'webm', 'ogg'].includes(f)) return `video/${f}`;
  return String(fallback || 'video/mp4');
}

/**
 * The caption <track> elements. The ORIGINAL is always present and always labelled as such; the
 * reader's preferred language is `default` (falling back to the original when we have no track for
 * them). crossorigin is set on the <video> because caption files are usually a different origin from
 * the page — without it the browser silently drops every track.
 */
function trackTags(v, lang) {
  const list = Array.isArray(v.captions) ? v.captions.filter(Boolean) : [];
  if (!list.length) return '';
  const chosen = captionFor(list, lang);
  return list.map((t) => {
    const label = `${t.label || langLabel(t.lang) || t.lang}${t.original ? ' (original)' : ''}`;
    return `<track kind="${esc(t.kind || (t.original ? 'captions' : 'subtitles'))}"`
      + ` src="${esc(t.url)}" srclang="${esc(t.lang)}" label="${esc(label)}"`
      + (chosen && t.lang === chosen.lang ? ' default' : '') + '>';
  }).join('');
}

/** The language row under the player — every tongue this video speaks, the original marked. */
function languageRow(v, lang) {
  const list = Array.isArray(v.captions) ? v.captions.filter(Boolean) : [];
  if (!list.length) return '<p class="mut">No caption tracks on this post.</p>';
  const chosen = captionFor(list, lang);
  const links = list.map((t) => {
    const on = chosen && t.lang === chosen.lang;
    return `<a class="lang${on ? ' on' : ''}" href="?lang=${esc(t.lang)}">${esc(t.label || langLabel(t.lang) || t.lang)}`
      + (t.original ? ' <b>· original</b>' : '') + '</a>';
  }).join(' ');
  const orig = originalCaption(list);
  return `<p class="langs">${links}</p>`
    + `<p class="mut">Every reader sees it in their own language; the original`
    + (orig ? ` (${esc(langLabel(orig.lang) || orig.lang)})` : '')
    + ` is always kept and always shown as the original.</p>`;
}

/**
 * renderVideoPage — the single MELEK video: player, captions, provenance, and what it costs to serve.
 * PURE (the cost model is arithmetic, not a lookup). Returns '' for a missing item — never throws.
 */
export function renderVideoPage(v, { lang = '', prices } = {}) {
  if (!v || !v.ok) return '';
  const sources = sourceTags(v);
  const player = sources
    ? `<video controls preload="metadata" crossorigin="anonymous" playsinline`
      + (v.thumbnail ? ` poster="${esc(v.thumbnail)}"` : '')
      + `>${sources}${trackTags(v, lang)}`
      + `<p>Your browser cannot play this video. <a href="${esc(v.url)}" rel="noopener noreferrer">Open the file directly</a>.</p></video>`
    : `<p class="video-empty">This post claims a video that cannot be addressed — nothing to play.</p>`;

  // Price the renditions this post ACTUALLY declares, not a hypothetical ladder — the sourceMap knows.
  const declared = (Array.isArray(v.sourceMap) ? v.sourceMap : [])
    .filter((r) => r && String(r.type).toLowerCase() === 'video')
    .map((r) => parseInt(String(r.quality || ''), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  const cost = projectCost({
    durationSec: v.duration,
    height: v.height || 1080,
    heights: declared.length ? declared : undefined,
    single: !declared.length,
    viewerHours: 0,
    prices,
  });
  const claim = checkClaim({ filesizeBytes: v.filesize, durationSec: v.duration, height: v.height });

  const meta = [
    v.duration ? fmtDuration(v.duration) : '',
    v.height ? `${v.height}p` : '',
    v.lang ? `spoken ${langLabel(v.lang) || v.lang}` : '',
    v.created ? v.created.slice(0, 10) : '',
  ].filter(Boolean).join(' · ');

  return `<article class="melek-video">
    <h1>${esc(v.title)}</h1>
    <p class="smeta">by <b>@${esc(v.author)}</b>${meta ? ` · ${esc(meta)}` : ''}${v.payout ? ` · ${esc(v.payout)}` : ''}</p>
    <div class="player">${player}</div>
    ${languageRow(v, lang)}
    ${v.description ? `<p class="desc">${esc(v.description)}</p>` : ''}
    <details class="provenance"><summary>Where this video lives</summary>
      <p><b>Backend:</b> ${esc(providerLabel(v.provider))}${v.providerId ? ` · <code>${esc(v.providerId)}</code>` : ''}</p>
      <p class="mut">${esc(isProvider(v.provider) ? PROVIDERS[v.provider].custody : 'Unknown backend — nobody has answered who keeps this alive.')}</p>
      <p class="mut">The chain holds the <b>reference</b>, not the bytes: a standard <code>comment</code> op,
        the same 75/25 author/curator pool as any other post. The address is
        <code>(provider, providerId)</code>, so the bytes can move backends without editing a single post.</p>
      ${claim.verdict && claim.verdict !== 'not enough numbers to check' ? `<p class="mut">Claimed filesize check: ${esc(claim.verdict)}.</p>` : ''}
    </details>
    <details class="cost"><summary>What this costs to serve</summary>${renderCostPanel(cost)}</details>
  </article>`;
}

/** Provenance line for the Watch tab. */
export function dataNote() {
  return 'source: the MELEK chain — a video post is a standard `comment` op carrying a video reference in json_metadata; '
    + 'the bytes live off-chain on a swappable backend, and this page never signs, uploads or pins anything';
}

// ── CLI (guarded) — live read: `node pentecaust/video-feed.mjs @hathor/reel-x` ───────────────────
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = String(process.argv[2] || '').replace(/^@/, '');
  if (arg.includes('/')) {
    const [author, permlink] = arg.split('/');
    const v = await getVideo({ author, permlink });
    if (!v) console.log(`no MELEK video at @${author}/${permlink}`);
    else {
      console.log(`${v.title}\n  by @${v.author} · ${fmtDuration(v.duration)} · ${providerLabel(v.provider)}`);
      console.log(`  url        ${v.url}`);
      console.log(`  captions   ${captionLanguages(v.captions).join(', ') || '(none)'} · original ${(originalCaption(v.captions) || {}).lang || '—'}`);
    }
  } else {
    const list = await recentVideos({ limit: 15 });
    console.log(`MELEK video feed — ${list.length} post(s) on #${VIDEO_TAG}`);
    console.log('─'.repeat(70));
    for (const v of list) console.log(`  ${v.title.slice(0, 40).padEnd(42)} @${v.author.padEnd(16)} ${captionLanguages(v.captions).length} lang`);
    console.log(`  ${dataNote()}`);
  }
}
