// site/melek-admin/build.mjs — the Admin Updates page (https://melek.salon/admin: posts by MELEK's admins) and
// the Witness Updates page (https://melek.salon/witness-updates: posts by the active witnesses, Hathor
// included), newest first. Both carry the site's tab bar: All Posts · Groups · Admin Updates · Witness Updates.
// Signed-out visitors to melek.salon land on Admin Updates (melek-extras.js sends them).
//
// Built from the chain on a timer and written as one static file, so the page costs nothing to serve and
// keeps working if the RPC hiccups (the last good build stays up). Own posts only — reblogs are left out.
//
//   ADMIN_ACCOUNTS=vankushfamily,kalivankush ADMIN_OUT=/var/www/melek-admin/index.html \
//     WITNESS_OUT=/var/www/melek-admin/witness-updates/index.html node site/melek-admin/build.mjs
//   ADMIN_OUT is the home page ("/"); the /admin copy goes to admin/index.html beside it (ADMIN_PAGE_OUT).
//   import { fetchAdminPosts, fetchWitnessAccounts, renderAdminPage } from './build.mjs'   // tests
import { writeFileSync, mkdirSync, renameSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const ADMINS = () => env('ADMIN_ACCOUNTS', 'vankushfamily,kalivankush,angelicalist,vankush,hathor,melek').split(/[\s,]+/).filter(Boolean);
const RPC = () => env('ADMIN_RPC', 'https://melek.salon/rpc');
const SITE = 'https://melek.salon';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** First image in a post: json_metadata.image[0], else the first markdown/html image in the body. */
export function firstImage(p) {
  try { const m = JSON.parse(p.json_metadata || '{}'); if (Array.isArray(m.image) && m.image[0]) return String(m.image[0]); } catch { /* soft */ }
  const b = String(p.body || '');
  const md = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/.exec(b); if (md) return md[1];
  const im = /<img[^>]+src=["'](https?:\/\/[^"']+)/i.exec(b); if (im) return im[1];
  return '';
}

/**
 * A post's video, if it has one: a Bifrost video post (json_metadata.video, with its own thumbnail) or a
 * YouTube link in the body. Returns { thumb, kind } so the card can show the frame with a play mark.
 */
export function firstVideo(p) {
  try {
    const m = JSON.parse(p.json_metadata || '{}');
    if (m && m.video && m.video.url) return { thumb: String(m.video.thumbnail || '') || firstImage(p), kind: 'bifrost' };
  } catch { /* soft */ }
  const b = String(p.body || '');
  const yt = /(?:youtube\.com\/(?:watch\?(?:[^\s)"']*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(b);
  if (yt) return { thumb: `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg`, kind: 'youtube' };
  return null;
}

/** Plain-text excerpt: strip markdown/HTML, collapse whitespace. */
export function excerpt(body, n = 220) {
  const t = String(body || '').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ').replace(/[#*>`|~]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t;
}

/** Each admin's own recent top-level posts, merged newest first. Injectable fetch; soft-fail per account. */
export async function fetchAdminPosts({ admins = ADMINS(), rpcUrl = RPC(), fetch: f = globalThis.fetch, perAccount = 20 } = {}) {
  const all = [];
  for (const a of admins) {
    try {
      const r = await f(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.get_discussions_by_blog', params: [{ tag: a, limit: perAccount }] }) });
      const j = await r.json();
      for (const p of (j && j.result) || []) if (p && p.author === a && !p.parent_author) all.push(p);
    } catch { /* one dead account never empties the page */ }
  }
  const seen = new Set();
  return all.filter((p) => { const k = `${p.author}/${p.permlink}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((x, y) => String(y.created).localeCompare(String(x.created)));
}

/** The active witnesses (top N by vote that have produced blocks), always including hathor. Soft-fail → ['hathor']. */
export async function fetchWitnessAccounts({ rpcUrl = RPC(), fetch: f = globalThis.fetch, limit = 30 } = {}) {
  try {
    const r = await f(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.get_witnesses_by_vote', params: ['', limit] }) });
    const j = await r.json();
    const names = ((j && j.result) || []).filter((w) => w && w.owner && Number(w.last_confirmed_block_num) > 0).map((w) => w.owner);
    return [...new Set(['hathor', ...names])];
  } catch { return ['hathor']; }
}

// Ranks Hathor gives, Bitcointalk-style but shorter. Everyone starts as a Jr. Member (the All Posts feed, not
// stored); Hathor promotes people out of New. Anyone at Member or above shows on the Members tab.
// Stored by account in RANKS_FILE:  { "alice": { "rank": "Member", "by": "hathor", "ts": 1792290000000 }, … }
export const RANKS = ['Member', 'Sr. Member', 'Hero Member', 'Legendary'];
const RANKS_FILE = () => env('RANKS_FILE', '/var/lib/melek-ranks/ranks.json');

/** Ranked users, highest rank first. Soft-fail → {} (the page then says nobody is ranked yet). */
export function loadRanks(file = RANKS_FILE(), read = (f) => readFileSync(f, 'utf8')) {
  let raw = {};
  try { raw = JSON.parse(read(file)) || {}; } catch { return {}; }
  const out = {};
  for (const [acct, v] of Object.entries(raw)) {
    const rank = v && RANKS.includes(v.rank) ? v.rank : null;
    if (rank && /^[a-z0-9.-]{3,16}$/.test(acct)) out[acct] = { rank, by: String(v.by || ''), ts: Number(v.ts) || 0 };
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => RANKS.indexOf(b[1].rank) - RANKS.indexOf(a[1].rank)));
}

// The site's tab bar (same tabs melek-extras.js puts on the condenser): All Posts far left so it's easy to
// reach, then the hierarchy Admin → Witness → Ranked, then Groups.
export const TABS = [
  { id: 'all', label: 'All Posts', href: `${SITE}/trending` },
  { id: 'groups', label: 'Groups', href: 'https://pact.pentecaust.com/#groups' },
  { id: 'admin', label: 'Admin Updates', href: `${SITE}/` },   // the home page
  { id: 'witness', label: 'Witness Updates', href: `${SITE}/witness-updates` },
  { id: 'ranked', label: 'Members', href: `${SITE}/members` },
  { id: 'move', label: 'MELEK Move', href: 'https://move.melek.salon/' },
  { id: 'news', label: 'News', href: 'https://herald.soapbox.community/newsroom' },   // Newsroom + Press Wire
];

const PAGES = {
  admin: { title: 'Admin Updates', path: '/', h1: 'Admin Updates',
    lead: "What MELEK's admins are building, what is live, and what comes next. Sign up to post, vote and earn MELEK.",
    who: 'Posts by' },
  // the home page ("/") carries the same feed and title as /admin
  home: { title: 'Admin Updates — MELEK', fullTitle: true, tab: 'admin',
    path: '/', h1: 'Admin Updates',
    lead: "What MELEK's admins are building, what is live, and what comes next. Sign up to post, vote and earn MELEK.",
    who: 'Posts by' },
  witness: { title: 'Witness Updates', path: '/witness-updates', h1: 'Witness Updates',
    lead: "News from the witnesses who run MELEK's blockchain: upgrades, hardforks, price feeds and what they're working on. Hathor, MELEK's AI witness, posts here too.",
    who: 'Posts by the active witnesses:' },
  ranked: { title: 'Members', path: '/members', h1: 'Members',
    lead: 'Posts from people Hathor has brought up out of New for the quality of what they post. Everyone starts as a Jr. Member; the ranks above are Member, Sr. Member, Hero Member and Legendary. Above the member ranks are MELEK\'s admins and the witnesses who run the chain; their posts have their own tabs, Admin Updates and Witness Updates.',
    who: 'Posts by members:', empty: 'Nobody has been promoted yet. Hathor brings people up out of New as they post.',
    // shown on the Members page always, with or without posts: how to get listed here
    howto: `<section class=howto><h2>How to get listed here</h2>
<p>Members are chosen by Hathor, MELEK's AI witness, from the people who interact with her. Talk to her, use her commands and post well, and she brings you up out of New.</p>
<ol><li><b>Start with her commands.</b> Read <a href="${SITE}/hathor/@hathor/bridges-open-prana-pool-pays-hathor-online-24-7#hathor-247-like-pizza-bot-but-better">Hathor, 24/7: her commands</a> and try <code>!guide</code>, <code>!account</code> or <code>!tokenomics</code>.</li>
<li><b>Talk to her</b> in the comments on <a href="${SITE}/@hathor">her posts</a>, in the MELEK troll-box, or on Discord and Telegram.</li>
<li><b>Post on MELEK.</b> Your posts start in <a href="${SITE}/created">All Posts</a>. Hathor reads them and promotes members from there.</li></ol></section>` },
};

export function renderAdminPage(posts = [], { admins = ADMINS(), builtAt = new Date(), page = 'admin', ranks = {} } = {}) {
  const P = PAGES[page] || PAGES.admin;
  const cards = posts.length ? posts.map((p) => {
    const url = `${SITE}/${encodeURIComponent(p.category || 'melek')}/@${encodeURIComponent(p.author)}/${encodeURIComponent(p.permlink)}`;
    const vid = firstVideo(p);
    const img = (vid && vid.thumb) || firstImage(p);
    const date = String(p.created || '').slice(0, 10);
    const pic = img ? (vid ? `<span class=vthumb><img loading=lazy src="${esc(img)}" alt=""><span class=play aria-label="Video">▶</span></span>` : `<img loading=lazy src="${esc(img)}" alt="">`) : '';
    return `<article class=card><a class=hit href="${esc(url)}">${pic}
<div class=txt><h2>${esc(p.title || '(untitled)')}</h2><p class=meta>@${esc(p.author)}${ranks[p.author] ? ` <span class=rank>${esc(ranks[p.author].rank)}</span>` : ''} · ${esc(date)} · in ${esc(p.category || 'melek')}</p>
<p>${esc(excerpt(p.body))}</p></div></a></article>`;
  }).join('\n') : `<p class=empty>${esc(P.empty || 'No posts yet.')}</p>`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(P.fullTitle ? P.title : `${P.title} — MELEK`)}</title>
<meta name=description content="${esc(P.lead)}">
<link rel=canonical href="${SITE}${P.path}">
<style>
:root{--bg:#f7f8fa;--fg:#1a1d24;--mut:#6b7280;--card:#fff;--line:#e5e7eb;--gold:#f5a623}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0f1218;--fg:#e5e7eb;--mut:#9ca3af;--card:#161a22;--line:#2a2f3a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--card);border-bottom:1px solid var(--line)}
header .brand{font-weight:800;font-size:20px;color:#f39c12;text-decoration:none}
nav a{color:var(--fg);text-decoration:none;margin:0 10px;padding:6px 0;border-bottom:3px solid transparent}
nav a.on{border-bottom-color:var(--gold);font-weight:700}
nav{white-space:nowrap}
@media(max-width:640px){header{padding:10px 12px 0}nav{order:3;width:100%;overflow-x:auto;display:flex;gap:14px;margin:4px -12px 0;padding:0 12px;font-size:14px}nav a{margin:0;padding:8px 0}}
.pill{display:inline-block;margin-right:8px;padding:5px 11px;border:2px solid #eab308;border-radius:6px;color:inherit;text-decoration:none;font-weight:700}
.pill.post{background:#eab308;color:#171f24}
@media(max-width:700px){.acts{order:2;width:100%;display:flex;gap:8px;margin:6px 0 4px}.acts .pill{flex:1;text-align:center;margin:0;padding:7px 0}}
.cta{background:#1a1d24;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:700;border-bottom:3px solid var(--gold)}
main{max-width:860px;margin:0 auto;padding:20px 16px}
h1{margin:6px 0 4px}.lead{color:var(--mut);margin:0 0 18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:0 0 14px;overflow:hidden}
.hit{display:flex;gap:14px;color:inherit;text-decoration:none;padding:12px}
.hit img{width:180px;height:120px;object-fit:cover;border-radius:6px;flex:none}
.vthumb{position:relative;flex:none;display:block}.vthumb .play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:44px;height:44px;border-radius:50%;background:rgba(0,0,0,.65);color:#fff;font-size:18px;display:flex;align-items:center;justify-content:center;padding-left:3px;box-sizing:border-box}
.card h2{font-size:19px;margin:0 0 4px}.meta{color:var(--mut);font-size:13px;margin:0 0 6px}
@media(max-width:600px){.hit{flex-direction:column}.hit img{width:100%;height:180px}.vthumb{width:100%}}
footer{color:var(--mut);font-size:13px;text-align:center;padding:20px 16px}
.empty{color:var(--mut)}
.howto{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--gold);border-radius:10px;padding:12px 16px;margin:0 0 18px}
.howto h2{font-size:18px;margin:0 0 6px}.howto ol{margin:6px 0 0;padding-left:20px}.howto li{margin:4px 0}.howto a{color:inherit}
.rank{display:inline-block;font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px;background:#1a1d24;color:#fff;border-bottom:2px solid var(--gold)}
</style></head><body>
<header><a class=brand href="${SITE}/explore" title="Explore MELEK">MELEK</a><nav>${TABS.map((t) => `<a href="${esc(t.href)}"${t.id === (P.tab || page) ? ' class=on aria-current=page' : ''}>${esc(t.label)}</a>`).join('')}</nav>
<span class=acts><a class="pill post" href="${SITE}/submit.html">Post</a><a class=pill href="https://engine.melek.salon/">Trade</a><a class=pill href="https://wallet.melek.salon/~witnesses">Vote</a></span><span><a href="${SITE}/login.html" style="margin-right:10px;color:inherit">Log in</a><a class=cta href="${SITE}/account/signup.html">Sign up</a></span></header>
<main><h1>${esc(P.h1)}</h1>
<p class=lead>${esc(P.lead)}</p>
${P.howto || ''}
${cards}
</main>
<footer>${esc(P.who)} ${admins.map((a) => '@' + esc(a)).join(', ')} · updated ${esc(builtAt.toISOString().slice(0, 16).replace('T', ' '))} UTC · <a href="${SITE}/created">see everything on MELEK →</a></footer>
<script src="https://pentecaust.com/translate.js" defer></script>
</body></html>`;
}

if (process.argv[1] && process.argv[1].endsWith('build.mjs') && process.argv[1].includes('melek-admin')) {
  const write = (out, html, n, label) => {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out + '.new', html); renameSync(out + '.new', out);
    console.log(`[${label}] ${n} posts -> ${out}`);
  };
  const posts = await fetchAdminPosts();
  const adminOut = env('ADMIN_OUT', '/var/www/melek-admin/index.html');
  if (posts.length) {
    // "/" = home title; "/admin" = admin/index.html beside it, titled "Admin Updates — MELEK"
    write(adminOut, renderAdminPage(posts, { page: 'home' }), posts.length, 'home-page');
    write(env('ADMIN_PAGE_OUT', join(dirname(adminOut), 'admin', 'index.html')), renderAdminPage(posts), posts.length, 'admin-page');
  }
  else console.log('[admin-page] no posts fetched — keeping the last good page');
  const witnesses = await fetchWitnessAccounts();
  const wposts = await fetchAdminPosts({ admins: witnesses });
  if (wposts.length) write(env('WITNESS_OUT', '/var/www/melek-admin/witness-updates/index.html'),
    renderAdminPage(wposts, { admins: witnesses, page: 'witness' }), wposts.length, 'witness-page');
  else console.log('[witness-page] no posts fetched — keeping the last good page');
  // Ranked Users: always written, so the tab never 404s (an empty ladder says so)
  const ranks = loadRanks();
  const ranked = Object.keys(ranks);
  const rposts = ranked.length ? await fetchAdminPosts({ admins: ranked }) : [];
  write(env('RANKED_OUT', '/var/www/melek-admin/members/index.html'),
    renderAdminPage(rposts, { admins: ranked, page: 'ranked', ranks }), rposts.length, 'ranked-page');
}
