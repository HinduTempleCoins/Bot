// md-embeds.mjs — the "Widgets in Markdown" bridge: expand shortcodes + auto-embed video links inside
// rendered markdown (posts, forum threads, the blog), safely.
//
// THE GAP THIS CLOSES: today a video link pasted into a post renders as a plain link (the markdown
// sanitizer strips <iframe>), and there is no way to drop a Follow button or a comment box into content.
// This module lets markdown carry our widgets:
//   - a bare first-party video URL on its own  →  a safe in-page player (the oEmbed-style auto-embed)
//   - [follow @account]                        →  a Follow button (hydrated by the widget loader)
//   - [comments ref]                           →  a "Login with MELEK" comment box
//   - [video https://…]                        →  an explicit player
//   - [chat] / [translate]                     →  the existing Soapy widgets
//
// SAFETY: video embeds pass through the SAME allowlist as the rest of the media layer
// (embed-whitelist.mjs → first-party providers only) plus our own hosts; unknown URLs are left as plain
// links, never framed. The output is static HTML with NO inline JS — the page's widget loader
// (soapy-widgets.js) hydrates the `data-*` buttons/boxes. Run AFTER markdown→HTML, BEFORE display.
//
// Pure string transforms, no network, offline-tested.
//   import { expandEmbeds, expandShortcodes, expandVideoLinks, videoEmbedHtml } from './md-embeds.mjs'

import { allowedEmbed } from './soapbox/embed-whitelist.mjs';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only http(s) may become a link href — esc() does NOT neutralize a `javascript:`/`data:` scheme, so a
// bare esc'd href is an XSS. Returns the url for http(s), else '' (caller renders inert escaped text).
const safeHref = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');

// Our own first-party video surfaces — kindred to the allowlisted providers, framed as our own player.
const MELEK_VIDEO_HOSTS = ['engine.melek.salon', 'stream.soapbox.community', 'watch.melek.salon', 'player.soapbox.community'];
function melekEmbed(url) {
  let u; try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.host.toLowerCase();
  if (!MELEK_VIDEO_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return null;
  // our surfaces accept ?embed=1 to render the bare player
  u.searchParams.set('embed', '1');
  return { provider: 'MELEK', embed: u.toString() };
}

/** Responsive, safe iframe for one video URL — first-party providers or our own hosts. null if not allowed. */
export function videoEmbedHtml(url) {
  const ext = allowedEmbed(url);
  const src = ext && ext.ok ? ext.embed : (melekEmbed(url)?.embed);
  const provider = ext && ext.ok ? ext.provider : (melekEmbed(url)?.provider);
  if (!src) return null;
  return `<div class="md-embed md-embed-video" style="position:relative;aspect-ratio:16/9;max-width:720px">`
    + `<iframe src="${esc(src)}" title="${esc(provider)} video" loading="lazy" allowfullscreen`
    + ` referrerpolicy="strict-origin-when-cross-origin"`
    + ` style="position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:8px"></iframe></div>`;
}

// A markdown renderer autolinks a bare URL to <a href="URL">URL</a>. Replace such a link (when its text
// equals its href and the URL is an allowed video) with the player. Leaves ordinary links untouched.
const AUTOLINK_RE = /<a\s+href="(https:\/\/[^"]+)"[^>]*>\1<\/a>/gi;
export function expandVideoLinks(html) {
  return String(html || '').replace(AUTOLINK_RE, (whole, url) => videoEmbedHtml(url) || whole);
}

// ── shortcodes: [name arg] ──────────────────────────────────────────────────────────────────────────
const SHORTCODE_RE = /\[(follow|comments|video|chat|translate)(?:\s+([^\]]+))?\]/gi;

/** Static HTML for a shortcode. Buttons carry data-* for the widget loader to hydrate (no inline JS). */
function shortcodeHtml(name, arg) {
  const a = (arg || '').trim();
  switch (name.toLowerCase()) {
    case 'follow': {
      const acct = a.replace(/^@/, '').toLowerCase();
      if (!/^[a-z0-9.\-]{2,16}$/.test(acct)) return `[follow ?]`;
      return `<button class="melek-widget melek-follow-btn" data-widget="follow" data-account="${esc(acct)}"`
        + ` type="button">Follow @${esc(acct)}</button>`;
    }
    case 'comments': {
      const ref = a || 'thread';
      return `<div class="melek-widget melek-comments" data-widget="comments" data-ref="${esc(ref)}">`
        + `<em>Comments — log in with MELEK to join.</em></div>`;
    }
    case 'video': {
      const html = a && videoEmbedHtml(a);
      if (html) return html;
      const href = safeHref(a);                       // reject javascript:/data:/etc. — no clickable scheme injection
      return href ? `<a href="${esc(href)}" rel="nofollow">${esc(a)}</a>` : esc(a);
    }
    case 'chat':
      return `<div class="melek-widget" data-widget="chat"></div>`;
    case 'translate':
      return `<div class="melek-widget" data-widget="translate"></div>`;
    default:
      return `[${esc(name)}]`;
  }
}
export function expandShortcodes(html) {
  return String(html || '').replace(SHORTCODE_RE, (_w, name, arg) => shortcodeHtml(name, arg));
}

/**
 * expandEmbeds — the full pass: shortcodes first, then bare video-link auto-embed.
 * Run on markdown-rendered HTML, before display. Only whitelisted first-party / MELEK embeds are framed;
 * everything else stays a plain link.
 */
export function expandEmbeds(html) {
  return expandVideoLinks(expandShortcodes(html));
}

/** The list of shortcodes for docs / a picker. */
export const SHORTCODES = ['follow', 'comments', 'video', 'chat', 'translate'];

if (process.argv[1] && process.argv[1].endsWith('md-embeds.mjs')) {
  const demo = `<p><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">https://www.youtube.com/watch?v=dQw4w9WgXcQ</a></p>\n`
    + `<p>Follow me: [follow @hathor] · [video https://engine.melek.salon/dtube/watch/x] · [chat]</p>`;
  console.log(expandEmbeds(demo));
}
