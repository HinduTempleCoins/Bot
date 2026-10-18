// site/fed-bridge/build.mjs — puts MELEK accounts on the Fediverse (Mastodon) and Bluesky through Bridgy Fed
// (https://fed.brid.gy/docs#web-get-started). Bridgy Fed bridges a *website* per *domain*: the home page's h-card
// is the profile, each post is an h-entry page on that domain, and a webmention to fed.brid.gy publishes it.
// So each bridged MELEK account gets its own domain (hathor → hathor.social.melek.salon), configured in accounts.json.
//
// Per account, built from the chain on a timer into OUT_ROOT/<domain>/:
//   index.html               h-card profile + h-feed of recent posts (+ <link rel=alternate> to the feed)
//   posts/<permlink>/index.html   one h-entry per post (title, summary, excerpt, image, date, link to melek.salon)
//   feed.xml                 Atom feed (Bridgy's fallback poller reads it before the first webmention)
//   <avatar>                 profile picture (Bridgy requires one)
// then, with FED_WEBMENTIONS=1, sends Bridgy Fed a webmention for each new or edited post under two weeks old
// (older ones Bridgy drops anyway). State per domain in STATE_DIR/<domain>.json, so each post goes out once.
//
//   FED_RPC=http://127.0.0.1:18091 FED_OUT=/var/www/melek-fed FED_STATE=/var/lib/melek-fed FED_WEBMENTIONS=1 \
//     node site/fed-bridge/build.mjs
//   import { renderHome, renderPost, renderFeed, sendWebmentions } from './build.mjs'   // tests
import { writeFileSync, mkdirSync, renameSync, readFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAdminPosts, firstImage, excerpt, esc } from '../melek-admin/build.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
const MELEK = 'https://melek.salon';
export const BRIDGY = 'https://fed.brid.gy/';
export const BRIDGY_WEBMENTION = 'https://fed.brid.gy/webmention';
export const MAX_AGE_MS = 14 * 24 * 3600 * 1000;   // Bridgy Fed ignores new posts older than two weeks

/** accounts.json → [{ account, domain, name, bio, avatar, links }]. Soft-fail → []. */
export function loadAccounts(file = join(HERE, 'accounts.json'), read = (f) => readFileSync(f, 'utf8')) {
  let raw = {};
  try { raw = JSON.parse(read(file)) || {}; } catch { return []; }
  return Object.entries(raw).filter(([a, c]) => /^[a-z0-9.-]{3,16}$/.test(a) && c && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(c.domain || ''))
    .map(([account, c]) => ({ account, domain: c.domain, name: c.name || account, bio: c.bio || '', avatar: c.avatar || '',
      links: Array.isArray(c.links) ? c.links : [] }));
}

const iso = (t) => { const s = String(t || ''); return s ? (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z') : ''; };
export const home = (a) => `https://${a.domain}/`;
export const postUrl = (a, p) => `https://${a.domain}/posts/${encodeURIComponent(p.permlink)}/`;
export const melekUrl = (p) => `${MELEK}/${encodeURIComponent(p.category || 'melek')}/@${encodeURIComponent(p.author)}/${encodeURIComponent(p.permlink)}`;
/** Body excerpt without a leading copy of the title (posts usually open with "# <title>"). */
export function bodyText(p, n = 400) {
  const title = String(p.title || '').trim(), t = excerpt(p.body, n + title.length + 2);
  const out = title && t.toLowerCase().startsWith(title.toLowerCase()) ? t.slice(title.length).replace(/^[\s:.\-–—]+/, '') : t;
  return out.length > n ? out.slice(0, n).replace(/\s+\S*$/, '') + '…' : out;
}
// Bump when the post HTML changes in a way worth re-sending to Bridgy Fed (it re-bridges as an edit).
export const RENDER_VERSION = 'r2';
const avatarUrl = (a) => (a.avatar ? (/^https?:/.test(a.avatar) ? a.avatar : home(a) + a.avatar) : '');
export function tags(p) {
  try { const m = JSON.parse(p.json_metadata || '{}'); if (Array.isArray(m.tags)) return [...new Set(m.tags.map(String).filter((t) => /^[a-z0-9-]{2,32}$/.test(t)))].slice(0, 5); } catch { /* soft */ }
  return [];
}

const CSS = `:root{--bg:#f7f8fa;--fg:#1a1d24;--mut:#6b7280;--card:#fff;--line:#e5e7eb;--gold:#f5a623}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0f1218;--fg:#e5e7eb;--mut:#9ca3af;--card:#161a22;--line:#2a2f3a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:760px;margin:0 auto;padding:20px 16px}a{color:inherit}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 14px}
.who{display:flex;gap:16px;align-items:center}.who img{width:96px;height:96px;border-radius:50%;object-fit:cover;flex:none}
.who h1{margin:0;font-size:26px}.mut{color:var(--mut);font-size:14px}
.links a{display:inline-block;margin:6px 12px 0 0;font-weight:600}
.follow{border-left:4px solid var(--gold)}.follow code{font-size:14px;word-break:break-all}
.entry h2{font-size:19px;margin:0 0 4px}.entry img.u-photo{width:100%;max-height:360px;object-fit:cover;border-radius:8px;margin:8px 0}
.tags a{margin-right:8px;color:var(--mut)}.small-author img{width:28px;height:28px;border-radius:50%;vertical-align:middle;margin-right:6px}
footer{color:var(--mut);font-size:13px;text-align:center;padding:16px}`;

const head = (title, desc, canonical, extra = '') => `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name=description content="${esc(desc)}"><link rel=canonical href="${esc(canonical)}">${extra}
<style>${CSS}</style></head><body><main>`;

/** The h-card home page: the bridged profile. */
export function renderHome(a, posts = [], { builtAt = new Date() } = {}) {
  const h = home(a), av = avatarUrl(a);
  const fedi = `@${a.domain}@web.brid.gy`, bsky = `${a.domain}.web.brid.gy`;
  const items = posts.map((p) => `<article class="card entry h-entry"><a class=u-url href="${esc(postUrl(a, p))}"><h2 class=p-name>${esc(p.title || '(untitled)')}</h2></a>
<p class=mut><time class=dt-published datetime="${esc(iso(p.created))}">${esc(String(p.created || '').slice(0, 10))}</time> · <a href="${esc(melekUrl(p))}">on MELEK</a></p>
<p>${esc(excerpt(p.body, 200))}</p></article>`).join('\n');
  return head(`${a.name} (@${a.account} on MELEK)`, a.bio, h, `
<link rel=alternate type="application/atom+xml" title="${esc(a.name)}" href="${esc(h)}feed.xml">
<link rel=me href="${esc(MELEK)}/@${esc(a.account)}">${av ? `<meta property="og:image" content="${esc(av)}">` : ''}
<meta property="og:title" content="${esc(a.name)}"><meta property="og:description" content="${esc(a.bio)}">`) + `
<section class="card h-card who">${av ? `<img class=u-photo src="${esc(av)}" alt="${esc(a.name)}">` : ''}
<div><h1><a class="p-name u-url u-uid" href="${esc(h)}">${esc(a.name)}</a></h1>
<p class=mut>@${esc(a.account)} on <a href="${esc(MELEK)}/@${esc(a.account)}">MELEK</a></p>
<p class=p-note>${esc(a.bio)}</p>
<p class=links>${a.links.map((l) => `<a rel=me href="${esc(l.href)}">${esc(l.text || l.href)}</a>`).join('')}</p></div></section>
<section class="card follow"><b>Follow ${esc(a.name)}</b><br>Mastodon / Fediverse: <code>${esc(fedi)}</code><br>Bluesky: <code>@${esc(bsky)}</code>
<br><span class=mut>Bridged by <a href="https://fed.brid.gy/web/${esc(a.domain)}">Bridgy Fed</a>. Posts are written on the MELEK blockchain.</span></section>
<div class=h-feed><h2 class=p-name style="font-size:18px">Posts</h2>
${items || '<p class=mut>No posts yet.</p>'}
</div></main><footer>Built from the MELEK chain · updated ${esc(builtAt.toISOString().slice(0, 16).replace('T', ' '))} UTC · <a href="${esc(h)}feed.xml">Atom feed</a></footer></body></html>`;
}

/**
 * One post as an h-entry. No p-name on the entry: Bridgy Fed then bridges it as a note (Mastodon/Bluesky show the
 * text inline) rather than an article (a bare title link). The title leads the content instead.
 */
export function renderPost(a, p) {
  const h = home(a), av = avatarUrl(a), url = postUrl(a, p), orig = melekUrl(p), img = firstImage(p), t = tags(p);
  const sum = bodyText(p, 400);
  return head(`${p.title || '(untitled)'} — ${a.name}`, excerpt(p.body, 160), orig, `
<link rel=alternate type="application/atom+xml" href="${esc(h)}feed.xml">${img ? `<meta property="og:image" content="${esc(img)}">` : ''}`) + `
<article class="card entry h-entry">
<p class="small-author p-author h-card"><a class=u-url href="${esc(h)}">${av ? `<img class=u-photo src="${esc(av)}" alt="">` : ''}<span class=p-name>${esc(a.name)}</span></a></p>
<h1 style="font-size:24px;margin:6px 0">${esc(p.title || '(untitled)')}</h1>
<p class=mut><a class=u-url href="${esc(url)}"><time class=dt-published datetime="${esc(iso(p.created))}">${esc(String(p.created || '').slice(0, 10))}</time></a>${p.last_update && p.last_update !== p.created ? ` · <time class=dt-updated datetime="${esc(iso(p.last_update))}">updated</time>` : ''}</p>
<div class=e-content><p>${esc(p.title || '(untitled)')}</p>
<p>${esc(sum)}</p>
<p>Read the whole post on MELEK: <a href="${esc(orig)}">${esc(orig)}</a></p>
${t.length ? `<p class=tags>${t.map((x) => `<a href="${esc(MELEK)}/trending/${esc(x)}">#${esc(x)}</a>`).join(' ')}</p>` : ''}</div>
${t.map((x) => `<data class=p-category value="${esc(x)}"></data>`).join('')}
${img ? `<img class=u-photo src="${esc(img)}" alt="">` : ''}
<a class=u-bridgy-fed href="${BRIDGY}" hidden></a>
</article>
<p class=mut><a href="${esc(h)}">← ${esc(a.name)}</a> · <a href="${esc(orig)}">read and comment on MELEK</a></p>
</main></body></html>`;
}

/** Atom feed of the same posts (full links to the h-entry pages). */
export function renderFeed(a, posts = [], { builtAt = new Date() } = {}) {
  const h = home(a), updated = posts[0] ? iso(posts[0].last_update || posts[0].created) : builtAt.toISOString();
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:activity="http://activitystrea.ms/spec/1.0/"><title>${esc(a.name)}</title><subtitle>${esc(a.bio)}</subtitle>
<id>${esc(h)}</id><link rel="alternate" type="text/html" href="${esc(h)}"/><link rel="self" type="application/atom+xml" href="${esc(h)}feed.xml"/>
<updated>${esc(updated)}</updated><author><name>${esc(a.name)}</name><uri>${esc(h)}</uri></author>${a.avatar ? `<icon>${esc(avatarUrl(a))}</icon>` : ''}
${posts.map((p) => `<entry><activity:object-type>http://activitystrea.ms/schema/1.0/note</activity:object-type><title>${esc(p.title || '(untitled)')}</title><id>${esc(postUrl(a, p))}</id><link rel="alternate" type="text/html" href="${esc(postUrl(a, p))}"/>
<published>${esc(iso(p.created))}</published><updated>${esc(iso(p.last_update || p.created))}</updated>
<content type="html">${esc(`<p>${esc(p.title || '(untitled)')}</p><p>${esc(bodyText(p, 400))}</p><p>Read the whole post on MELEK: <a href="${esc(melekUrl(p))}">${esc(melekUrl(p))}</a></p>`)}</content>${tags(p).map((x) => `<category term="${esc(x)}"/>`).join('')}</entry>`).join('\n')}
</feed>`;
}

/**
 * Webmention each new or edited post (under two weeks old) to Bridgy Fed, oldest first. `state` maps
 * permlink → version (last_update); only 2xx marks a post sent, so a failure retries next run. Never throws.
 * Returns { state, sent: [permlink], skipped: [permlink], failed: [permlink] }.
 */
export async function sendWebmentions(a, posts, state = {}, { fetch: f = globalThis.fetch, now = Date.now() } = {}) {
  const out = { state: { ...state }, sent: [], skipped: [], failed: [] };
  for (const p of [...posts].reverse()) {
    const ver = `${p.last_update || p.created || ''}|${RENDER_VERSION}`;
    if (out.state[p.permlink] === ver) continue;
    const age = now - Date.parse(iso(p.created));
    if (!(age >= 0 && age < MAX_AGE_MS)) { out.state[p.permlink] = ver; out.skipped.push(p.permlink); continue; }
    try {
      const r = await f(BRIDGY_WEBMENTION, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ source: postUrl(a, p), target: BRIDGY }).toString() });
      if (r && r.status >= 200 && r.status < 300) { out.state[p.permlink] = ver; out.sent.push(p.permlink); } else out.failed.push(p.permlink);
    } catch { out.failed.push(p.permlink); }
  }
  return out;
}

const writeAtomic = (file, data) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file + '.new', data); renameSync(file + '.new', file); };

/** Build one account's site into outRoot/<domain>/. Returns the posts (empty → nothing written, last good build kept). */
export async function buildAccount(a, { outRoot, rpcUrl, fetch: f, builtAt = new Date() } = {}) {
  const posts = await fetchAdminPosts({ admins: [a.account], rpcUrl, fetch: f, perAccount: 20 });
  if (!posts.length) return posts;
  const dir = join(outRoot, a.domain);
  for (const p of posts) writeAtomic(join(dir, 'posts', p.permlink, 'index.html'), renderPost(a, p));
  writeAtomic(join(dir, 'feed.xml'), renderFeed(a, posts, { builtAt }));
  writeAtomic(join(dir, 'index.html'), renderHome(a, posts, { builtAt }));
  if (a.avatar && !/^https?:/.test(a.avatar)) { try { copyFileSync(join(HERE, a.avatar), join(dir, a.avatar)); } catch { /* soft */ } }
  return posts;
}

if (process.argv[1] && process.argv[1].endsWith('build.mjs') && process.argv[1].includes('fed-bridge')) {
  const outRoot = env('FED_OUT', '/var/www/melek-fed'), stateDir = env('FED_STATE', '/var/lib/melek-fed');
  const rpcUrl = env('FED_RPC', 'https://melek.salon/rpc');
  for (const a of loadAccounts(env('FED_ACCOUNTS_FILE', join(HERE, 'accounts.json')))) {
    const posts = await buildAccount(a, { outRoot, rpcUrl });
    console.log(`[fed-bridge] ${a.account} → ${a.domain}: ${posts.length} posts`);
    if (!posts.length || env('FED_WEBMENTIONS', '') !== '1') continue;
    const sf = join(stateDir, `${a.domain}.json`);
    let state = {}; try { state = JSON.parse(readFileSync(sf, 'utf8')) || {}; } catch { /* first run */ }
    const r = await sendWebmentions(a, posts, state);
    writeAtomic(sf, JSON.stringify(r.state, null, 1));
    console.log(`[fed-bridge] ${a.domain} webmentions: sent ${r.sent.length} [${r.sent.join(' ')}], too old ${r.skipped.length}, failed ${r.failed.length} [${r.failed.join(' ')}]`);
  }
}
