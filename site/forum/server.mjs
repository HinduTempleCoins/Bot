// server.mjs — Forum.SoapBox.Community. The MELEK forum vertical as a standalone, zero-dependency HTTP
// service in the SoapBox house style (mirrors site/insurance/server.mjs). It fronts the forum engine
// (integrations/forum/forum-core.mjs): categorised boards, threads, threaded replies, scarce peer-merit
// standing (integrations/peer-merit.mjs), and portable-identity signatures (integrations/persona-card.mjs).
//
//   PORT=8200 BASE_URL=https://forum.soapbox.community node site/forum/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /             portal home — categories + boards + recent threads
//   /b/<board>    a board — its threads ranked by merit + recency, with a "New thread" button
//   /t/<id>       a thread — its posts with author signature + FORUM merit, and a reply form
//   /post         the compose surface — renders a SIGNABLE MELEK-Signer `comment` intent (NO keys held)
//   /search       ?q=… full-text over titles + bodies
//   /health /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ──────────────────────────────────────────────────────────────────────────────────
//   KEYLESS. Posting is a `comment` op broadcast in the BROWSER against MELEK-Signer with a scoped bearer
//   token; this server holds no WIF and signs nothing. Merit is scarce peer-awarded FORUM merit — never
//   bought, never self-minted (enforced in peer-merit). esc() on every interpolated value. Soft-fail:
//   every route renders even when the engine returns nothing.

import { createServer } from 'node:http';

import { createForum, FORUM_TOKEN } from '../../integrations/forum/forum-core.mjs';
import {
  forumRegistry, listCategories, boardsInCategory, categoryName,
  boardSitemapEntries, FLAGSHIP_BOARDS,
} from '../../integrations/forum/boards.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt, submitIndexNow } from '../../integrations/soapbox/crawlers.mjs';
import { headTags, breadcrumbJsonLd } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8200);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
// BASE_PATH lets the forum mount under a sub-path (e.g. /forum) behind a shared gateway. '' by default.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const SIGNER_URL = (process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon').replace(/\/$/, '');
const APP_NAME = process.env.FORUM_APP || 'forum';
const SITE_NAME = 'SoapBox Forum';
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
// IndexNow-on-create ping: opt-in (FORUM_INDEXNOW=1) + fire-and-forget so the render path stays network-free.
const INDEXNOW_ON = process.env.FORUM_INDEXNOW === '1';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// safeHref: only http(s) or same-origin relative paths survive; javascript:/data:/junk → '#'. Then esc().
export const safeHref = (u) => {
  const s = String(u == null ? '' : u).trim();
  if (!s) return '#';
  if (/^https?:\/\//i.test(s) || s.startsWith('/')) return esc(s);
  return '#';
};

// Prefix an app-relative path with BASE_PATH (for hrefs) — canonical URLs use BASE_URL + BASE_PATH.
const P = (p) => `${BASE_PATH}${p.startsWith('/') ? p : `/${p}`}`;
const absUrl = (p) => `${BASE_URL}${P(p)}`;

// ── per-object JSON-LD builders (schema.org). We do NOT edit seo.mjs — we build the forum types here as
// plain objects and hand them to headTags({ jsonld }). BreadcrumbList reuses seo.mjs's breadcrumbJsonLd. ──
function breadcrumbFor(trail) {
  // trail: [{ name, path }] app-relative; converted to absolute for the ListItem items.
  return breadcrumbJsonLd(trail.map((t) => ({ name: t.name, url: absUrl(t.path) })));
}

/** DiscussionForumPosting for a thread (Google's dedicated forum type). */
function discussionForumPostingLd(th, url) {
  const posts = Array.isArray(th.posts) ? th.posts : [];
  const root = posts[0] || {};
  const replies = posts.slice(1);
  const node = {
    '@context': 'https://schema.org',
    '@type': 'DiscussionForumPosting',
    headline: th.title,
    url,
    datePublished: root.ts ? new Date(root.ts).toISOString() : undefined,
    dateModified: th.lastActivityTs ? new Date(th.lastActivityTs).toISOString() : undefined,
    author: { '@type': 'Person', name: th.author, url: absUrl(`/u/${th.author}`) },
    articleBody: root.body || undefined,
    interactionStatistic: [
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction', userInteractionCount: th.replyCount || 0 },
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: th.meritTotal || 0 },
    ],
    comment: replies.slice(0, 50).map((r) => ({
      '@type': 'Comment',
      text: r.body || '',
      author: { '@type': 'Person', name: r.author },
      datePublished: r.ts ? new Date(r.ts).toISOString() : undefined,
    })),
  };
  return node;
}

/** QAPage for qa-kind threads (travel/gaming-help): Question + suggestedAnswer[] (+ acceptedAnswer). */
function qaPageLd(th, url) {
  const posts = Array.isArray(th.posts) ? th.posts : [];
  const root = posts[0] || {};
  const answers = posts.slice(1);
  const asAnswer = (r) => ({
    '@type': 'Answer',
    text: r.body || '',
    upvoteCount: r.merit || 0,
    author: { '@type': 'Person', name: r.author },
    url: `${url}#post-${r.id}`,
  });
  // Phase-1: no accepted-answer mark yet (design §2.2 wires melek_forum_accept later) → all suggested.
  const question = {
    '@type': 'Question',
    name: th.title,
    text: root.body || th.title,
    answerCount: answers.length,
    author: { '@type': 'Person', name: th.author },
    dateCreated: root.ts ? new Date(root.ts).toISOString() : undefined,
  };
  if (answers.length) question.suggestedAnswer = answers.slice(0, 50).map(asAnswer);
  return { '@context': 'https://schema.org', '@type': 'QAPage', mainEntity: question };
}

/** The board's thread-level JSON-LD, chosen by seoType. LocalBusiness is a Phase-2 per-business page. */
function threadJsonLd(meta, th, url) {
  if (meta && meta.seoType === 'QAPage') return qaPageLd(th, url);
  return discussionForumPostingLd(th, url);
}

/** CollectionPage for a board/category index page. */
function collectionPageLd(name, description, url) {
  return { '@context': 'https://schema.org', '@type': 'CollectionPage', name, description, url };
}

// ── the forum instance (in-memory demo seed so the live surface has content) ──────────────────────
// The board network is data-driven: the registry (integrations/forum/boards.mjs) tells the engine which
// board ids are valid (static + programmatic city/game/travel/biz) and their titles. Thread/reply/merit
// logic is untouched — the registry is metadata + routing only.
export const forum = createForum({ registry: forumRegistry() });

// Programmatic boards seeded with real content (for the sitemap + a "flagship renders threads" demo).
export const SEEDED_PROGRAMMATIC = ['city/austin-tx', 'game/minecraft', 'travel/paris'];

let _seeded = false;
export async function seed(now = Date.parse('2026-08-01T00:00:00Z')) {
  if (_seeded) return;
  _seeded = true;
  const HR = 60 * 60 * 1000;
  const DAY = 24 * HR;
  // Bootstrap: give the seed accounts merit so they clear the new-account gate (also demonstrates merit).
  await forum.grantAllotment('hathor', { now });
  await forum.grantAllotment('cheetah', { now });
  await forum.merit.sendMerit('hathor', 'kalivankush', 1, { now });   // kalivankush earns 1 FORUM merit
  await forum.grantAllotment('hathor', { now: now + 30 * DAY });
  const t1 = await forum.createThread({ board: 'announcements', author: 'hathor', title: 'Welcome to the MELEK Forum', body: 'This forum runs on the MELEK chain. Posts are on-chain comments; standing is scarce, peer-awarded FORUM merit — it can never be bought or self-minted.', now });
  const t2 = await forum.createThread({ board: 'economy', author: 'kalivankush', title: 'How FORUM merit differs from stake', body: 'A whale\'s stake buys zero merit here. You can only send merit you were given. Discuss.', now: now + HR });
  await forum.createThread({ board: 'library', author: 'hathor', title: 'Library of Ashurbanipal — scope & safety', body: 'Reference and harm-reduction only: history, ethnobotany, pharmacology, dose ranges, interactions, testing, set/setting/aftercare. No synthesis or extraction recipes.', now: now + 2 * HR });
  if (t1.ok) await forum.reply({ threadId: t1.thread.id, author: 'kalivankush', body: 'Glad to be here. The merit model is the interesting part.', now: now + 3 * HR });
  if (t2.ok) {
    const r = await forum.reply({ threadId: t2.thread.id, author: 'hathor', body: 'Exactly — it is Sybil-resistant and non-plutocratic by construction.', now: now + 4 * HR });
    if (r.ok) await forum.awardMerit({ from: 'kalivankush', postId: r.post.id, amount: 1, now: now + 5 * HR });
  }

  // ── flagship boards end-to-end (design §7.2 Phase-1): a static Crypto board + programmatic City + Game,
  // plus a Travel Q&A board to exercise the QAPage path. Prime authors with received merit (via a sponsor
  // faucet at 14-day-spaced ticks) so they clear the gate and can post freely.
  const authors = ['satoshi', 'austin_local', 'crafter', 'wanderer'];
  for (let i = 0; i < authors.length; i++) await forum.grantAllotment('sponsor', { now: now + i * 15 * DAY });
  for (const a of authors) await forum.merit.sendMerit('sponsor', a, 1, { now });

  // Crypto flagship (static board).
  await forum.createThread({ board: 'crypto/bitcoin', author: 'satoshi', title: 'Self-custody basics: seed phrases done right', body: 'Write it on steel, never a photo, test your restore before funding. What is your setup?', now: now + 6 * HR });
  const btc2 = await forum.createThread({ board: 'crypto/bitcoin', author: 'satoshi', title: 'Lightning vs on-chain for small payments', body: 'When does opening a channel beat an on-chain send? Fees, liquidity, and UX tradeoffs.', now: now + 7 * HR });
  if (btc2.ok) await forum.reply({ threadId: btc2.thread.id, author: 'kalivankush', body: 'Depends on frequency — recurring micro-payments favour a channel.', now: now + 8 * HR });

  // City flagship (programmatic city/<slug>).
  await forum.createThread({ board: 'city/austin-tx', author: 'austin_local', title: 'Moving to Austin — best neighborhoods for families?', body: 'Relocating this fall. Schools, commute, and cost of living matter most. Where would you look?', now: now + 9 * HR });
  await forum.createThread({ board: 'city/austin-tx', author: 'austin_local', title: 'Austin traffic: is the toll road worth it?', body: 'Daily commute from the north. Curious how locals weigh 183A tolls vs surface streets.', now: now + 10 * HR });

  // Game flagship (programmatic game/<slug>, wiki-linkout — discussion + curated external links).
  await forum.createThread({ board: 'game/minecraft', author: 'crafter', title: 'Efficient early-game villager trading hall?', body: 'Looking for a compact, beginner-friendly layout. Sharing link-outs to community guides welcome (no mirrored copyrighted text).', now: now + 11 * HR });
  await forum.createThread({ board: 'game/minecraft', author: 'crafter', title: 'Best seeds for a survival start (Java 1.21)', body: 'Village near spawn, exposed ravine, decent biome spread. Post coordinates.', now: now + 12 * HR });

  // Travel Q&A flagship (programmatic travel/<dest>, qa → QAPage).
  const paris = await forum.createThread({ board: 'travel/paris', author: 'wanderer', title: 'Best time to visit Paris to avoid crowds?', body: 'First trip, 4 days, flexible dates. When are the museums and cafes least packed?', now: now + 13 * HR });
  if (paris.ok) await forum.reply({ threadId: paris.thread.id, author: 'kalivankush', body: 'Late September to early November — mild weather, thinner crowds after the summer peak.', now: now + 14 * HR });

  // IndexNow-on-create seam: submit the flagship boards once at bootstrap (env-gated, fire-and-forget).
  pingIndexNow(['/', ...FLAGSHIP_BOARDS.map((b) => `/b/${b}`), ...SEEDED_PROGRAMMATIC.map((b) => `/b/${b}`)]);
}

// ── theme (shared SoapBox dark) ───────────────────────────────────────────────────────────────────
const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--panel2:#0b0f14;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:11px;background:#d2992233;color:var(--gold);border:1px solid var(--gold);border-radius:8px;padding:1px 8px}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:960px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:18px;margin:18px 0 8px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:16px 18px;margin:12px 0}
  .board{display:flex;justify-content:space-between;gap:12px;border:1px solid var(--line2);border-radius:10px;padding:14px 16px;background:var(--panel);margin:8px 0}
  .board:hover{border-color:var(--blue);text-decoration:none} .board .t{font-weight:700;font-size:16px;color:var(--fg)} .board .d{color:var(--mut);font-size:13px;margin-top:3px}
  .board .stat{color:var(--mut);font-size:13px;text-align:right;white-space:nowrap;min-width:78px}
  .trow{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding:11px 4px}
  .trow .t{font-weight:600;color:var(--fg)} .trow .meta{color:var(--mut);font-size:12px;margin-top:2px}
  .trow .stat{color:var(--mut);font-size:13px;text-align:right;white-space:nowrap}
  .merit{color:var(--gold);font-weight:700}
  .post{border:1px solid var(--line2);border-radius:10px;background:var(--panel);margin:12px 0;overflow:hidden}
  .post .phead{display:flex;justify-content:space-between;gap:10px;padding:9px 14px;border-bottom:1px solid var(--line);background:var(--panel2);font-size:13px}
  .post .pbody{padding:14px 16px;white-space:pre-wrap;word-wrap:break-word}
  .post .pfoot{padding:8px 14px;border-top:1px solid var(--line);display:flex;gap:10px;align-items:center;font-size:13px}
  .forum-sig{margin-top:10px;opacity:.9} .forum-sig svg{max-width:100%;height:auto} .forum-sig-merit{color:var(--gold);font-size:12px;margin-top:4px}
  .btn{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:8px 16px;font-size:14px;display:inline-block}
  .btn:hover{border-color:var(--blue);text-decoration:none} .btn.primary{background:#1f6feb;border-color:#1f6feb;color:#fff}
  form.compose textarea,form.compose input.q{width:100%;background:var(--panel2);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font:15px inherit;padding:11px 14px;margin:6px 0}
  form.compose textarea{min-height:150px;resize:vertical}
  form.hsearch{margin:0 0 14px} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  input.q{background:var(--panel2);border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px;flex:1 1 220px;min-width:160px;max-width:520px}
  input.q:focus,textarea:focus{border-color:var(--blue);outline:none}
  .intent{background:var(--panel2);border:1px solid var(--line2);border-radius:8px;padding:12px 14px;font:12px/1.5 ui-monospace,Menlo,monospace;color:var(--mut);white-space:pre-wrap;word-wrap:break-word;overflow:auto}
  .depth1{margin-left:26px} .depth2{margin-left:52px} .depth3{margin-left:78px}
  .kbadge{font-size:11px;background:#1f6feb22;color:var(--blue);border-radius:8px;padding:1px 7px}
  .toast{position:fixed;left:50%;transform:translateX(-50%);bottom:20px;background:var(--blue);color:#fff;padding:10px 18px;border-radius:999px;font-weight:600;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:9} .toast.show{opacity:1}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7} footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>${esc(SITE_NAME)}</b> — a forum on the MELEK chain. Posts are on-chain <code>comment</code> operations, signed
  in your browser through <b>MELEK-Signer</b>; this site holds no keys. Standing is <b>${esc(FORUM_TOKEN)} merit</b> —
  scarce, peer-awarded, never bought and never self-minted. Alpha / testnet.
  <div style="margin-top:8px"><a href="${P('/')}">Forum</a> · <a href="${safeHref(DATA)}">Data</a></div>
</footer>`;

// ── MELEK-Signer client (keyless): OAuth capture + broadcast(comment/vote) in the browser ─────────
function clientScript() {
  return `<div class=toast id=toast></div><script>
   window.FORUM=(function(){
     var SIGNER=${JSON.stringify(SIGNER_URL)},APP=${JSON.stringify(APP_NAME)};
     var TOKEN=null,ACCT=null;
     try{TOKEN=localStorage.getItem('forum_tok');ACCT=localStorage.getItem('forum_acct');}catch(e){}
     function toast(t){var el=document.getElementById('toast');if(!el)return;el.textContent=t;el.classList.add('show');setTimeout(function(){el.classList.remove('show');},2400);}
     function login(scope){var redir=location.origin+location.pathname+location.search;location.href=SIGNER+'/oauth2/authorize?client_id='+encodeURIComponent(APP)+'&scope='+encodeURIComponent(scope||'comment vote')+'&redirect_uri='+encodeURIComponent(redir);}
     async function broadcast(ops,ref){
       if(!TOKEN){login('comment vote');return {ok:false,login:true};}
       try{var r=await fetch(SIGNER+'/v1/broadcast',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+TOKEN},body:JSON.stringify({ops:ops,client_ref:ref})});
         var j=await r.json().catch(function(){return{};});return r.ok&&j.ok?{ok:true,result:j.result}:{ok:false,error:(j&&j.error)||'broadcast failed'};}
       catch(e){return {ok:false,error:'could not reach the signer'};}
     }
     (async function(){var u=new URL(location.href);var code=u.searchParams.get('code');if(!code)return;
       try{var r=await fetch(SIGNER+'/oauth2/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:code,client_id:APP})});
         var j=await r.json();if(j.access_token){TOKEN=j.access_token;ACCT=(j.account||'').toLowerCase();
           try{localStorage.setItem('forum_tok',TOKEN);localStorage.setItem('forum_acct',ACCT);}catch(e){}
           u.searchParams.delete('code');history.replaceState({},'',u.pathname+(u.search||''));document.dispatchEvent(new Event('forum-auth'));}}catch(e){}
     })();
     return {get token(){return TOKEN;},get acct(){return ACCT;},login:login,broadcast:broadcast,toast:toast};
   })();
  </script>`;
}

// ── page shell ────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description || 'The MELEK forum — categorised boards and threads on the MELEK chain, ranked by scarce peer-awarded FORUM merit. Keyless posting through MELEK-Signer.';
  const canonical = opts.canonical || absUrl('/');
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME,
    robots: opts.robots || 'index,follow,max-image-preview:large',
    site: { url: `${BASE_URL}${BASE_PATH}`, name: SITE_NAME, searchUrlTemplate: `${absUrl('/search')}?q={search_term_string}` },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header class=topbar><a class=brand href="${P('/')}">🗣️ SoapBox <span>forum</span></a><span class=alpha>ALPHA · TESTNET</span>
  <div class=topbar-r><a href="${P('/')}">Home</a><a href="${P('/search')}">Search</a><a href="${P('/post')}">New thread</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}${clientScript()}</body></html>`;
}

function searchForm(q = '') {
  return `<form class=hsearch method=get action="${P('/search')}"><div class=row>
    <input class=q name="q" value="${esc(q)}" placeholder="Search threads…" autocomplete=off aria-label="Search the forum">
    <button class=btn type=submit>Search</button>
  </div></form>`;
}

const fmtAgo = (ts) => {
  const t = Number(ts) || 0;
  if (!t) return '—';
  return esc(new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
};

// ── home ────────────────────────────────────────────────────────────────────────────────────────
export async function homePage() {
  const groups = forum.boards();
  const recent = await forum.recentThreads(12);
  const cats = groups.map((g) => `
    <h2>${g.categoryId ? `<a href="${P(`/c/${g.categoryId}`)}">${esc(g.category)}</a>` : esc(g.category)}${g.comparable ? ` <span class=muted style="font-size:12px;text-transform:none;letter-spacing:0">· like ${esc(g.comparable)}</span>` : ''}</h2>
    ${g.boards.map((b) => `<a class=board href="${P(`/b/${b.id}`)}">
        <div><div class=t>${esc(b.title)}</div><div class=d>${esc(b.desc)}</div></div>
      </a>`).join('')}`).join('');
  const recentRows = recent.length
    ? recent.map((t) => `<div class=trow>
        <div><div class=t><a href="${P(`/t/${t.id}`)}">${esc(t.title)}</a></div>
          <div class=meta>in <a href="${P(`/b/${t.board}`)}">${esc(t.board)}</a> · by @${esc(t.author)}</div></div>
        <div class=stat>${esc(t.replyCount)} replies<br>${fmtAgo(t.lastActivityTs)}</div>
      </div>`).join('')
    : `<p class=muted>No threads yet. <a href="${P('/post')}">Start the first one.</a></p>`;
  const body = `<h1>SoapBox Forum <span class=muted style="font-size:14px">· on the MELEK chain</span></h1>
    <p class=muted>Boards and threads with <b>scarce peer-awarded ${esc(FORUM_TOKEN)} merit</b> — a whale's stake buys
      none of it. Post through MELEK-Signer; we hold no keys.</p>
    ${searchForm()}
    ${cats}
    <h2>Recent activity</h2>
    <div class=card>${recentRows}</div>`;
  return page(`${SITE_NAME} — MELEK community boards`, body, { canonical: absUrl('/') });
}

// ── /c/<category> — a category index (board list + JSON-LD CollectionPage + breadcrumbs) ───────────
export function categoryPage(id) {
  const boards = boardsInCategory(id);
  if (!boards.length) return null;
  const name = categoryName(id);
  const rows = boards.map((b) => `<a class=board href="${P(`/b/${b.id}`)}">
      <div><div class=t>${esc(b.title)}</div><div class=d>${esc(b.desc)}</div></div>
      <div class=stat>${esc(b.kind)}</div>
    </a>`).join('');
  const url = absUrl(`/c/${id}`);
  const desc = `${name} boards on the SoapBox Forum${boards[0] && boards[0].comparable ? ` — like ${boards[0].comparable}` : ''}.`;
  const jsonld = [
    collectionPageLd(name, desc, url),
    breadcrumbFor([{ name: 'Forum', path: '/' }, { name, path: `/c/${id}` }]),
  ];
  const body = `<p class=muted><a href="${P('/')}">← All boards</a></p>
    <h1>${esc(name)}</h1>
    <p class=muted>${esc(desc)}</p>
    ${rows}`;
  return page(`${name} — ${SITE_NAME}`, body, { canonical: url, description: desc, jsonld });
}

// ── /b/<board> ──────────────────────────────────────────────────────────────────────────────────
export async function boardPage(id, { now } = {}) {
  const meta = forum.boardMeta(id);
  if (!meta) return null;

  // Reviews / Classifieds are Phase-2 seams: registered, but no capture UI yet — render a stub (noindex).
  if (meta.kind === 'review' || meta.kind === 'classified') return { meta, html: phase2BoardPage(meta) };

  const threads = await forum.board(id, { now, sort: 'rank' });
  const rows = threads.length
    ? threads.map((t) => `<div class=trow>
        <div><div class=t><a href="${P(`/t/${t.id}`)}">${esc(t.title)}</a></div>
          <div class=meta>by @${esc(t.author)} · ${fmtAgo(t.createdTs)}</div></div>
        <div class=stat><span class=merit>✦ ${esc(t.meritTotal)}</span> · ${esc(t.replyCount)} replies<br>${fmtAgo(t.lastActivityTs)}</div>
      </div>`).join('')
    : `<p class=muted>No threads in this board yet.</p>`;
  const links = (meta.links || []).length
    ? `<p class=muted>Related: ${meta.links.map((l) => `<a href="${safeHref(l.href)}" rel="nofollow noopener">${esc(l.label || l.href)}</a>`).join(' · ')}</p>`
    : '';
  const url = absUrl(`/b/${meta.id}`);
  // noindex an EMPTY programmatic board (no doorway-page penalty); index once it has real content.
  const empty = threads.length === 0;
  const jsonld = [
    collectionPageLd(meta.title, meta.desc, url),
    breadcrumbFor([{ name: 'Forum', path: '/' }, { name: meta.category, path: `/c/${meta.categoryId}` }, { name: meta.title, path: `/b/${meta.id}` }]),
  ];
  const body = `<p class=muted><a href="${P('/')}">← All boards</a> ${meta.categoryId ? `· <a href="${P(`/c/${meta.categoryId}`)}">${esc(meta.category)}</a>` : ''}</p>
    <h1>${esc(meta.title)}</h1>
    <p class=muted>${esc(meta.desc)}</p>
    ${links}
    <p><a class="btn primary" href="${P(`/post?board=${meta.id}`)}">＋ New thread</a></p>
    <div class=card>${rows}</div>`;
  return {
    meta,
    html: page(`${meta.title} — ${SITE_NAME}`, body, {
      canonical: url, description: meta.desc, jsonld,
      robots: empty ? 'noindex,follow' : 'index,follow,max-image-preview:large',
    }),
  };
}

// Phase-2 stub for review/classified boards: 200, noindex, with a breadcrumb — no capture UI yet.
function phase2BoardPage(meta) {
  const url = absUrl(`/b/${meta.id}`);
  const jsonld = [breadcrumbFor([{ name: 'Forum', path: '/' }, { name: meta.category, path: `/c/${meta.categoryId}` }, { name: meta.title, path: `/b/${meta.id}` }])];
  const body = `<p class=muted><a href="${P('/')}">← All boards</a> · <a href="${P(`/c/${meta.categoryId}`)}">${esc(meta.category)}</a></p>
    <h1>${esc(meta.title)}</h1>
    <p class=muted>${esc(meta.desc)}</p>
    <div class=card><p class=muted>This <b>${esc(meta.kind)}</b> section is coming in <b>Phase 2</b>. The board is
      registered; the ${esc(meta.kind === 'review' ? 'review capture + rating' : 'listing lifecycle + geo + contact')}
      UI is not built yet. Facts will be sourced and tagged; user content is never presented as a platform verdict.</p></div>`;
  return page(`${meta.title} — ${SITE_NAME}`, body, { canonical: url, description: meta.desc, robots: 'noindex,follow', jsonld });
}

// ── /t/<id> ─────────────────────────────────────────────────────────────────────────────────────
export async function threadPage(id) {
  const th = await forum.thread(id);
  if (!th) return null;
  const meta = forum.boardMeta(th.board);
  const posts = [];
  for (const p of th.posts) {
    const sig = await forum.signature(p.author, { account: p.author, postCount: null, balances: {} });
    const depthClass = p.depth > 0 ? ` depth${Math.min(3, p.depth)}` : '';
    posts.push(`<div class="post${depthClass}" id="post-${esc(p.id)}">
      <div class=phead><span>@${esc(p.author)}${p.parentId === null ? ' <span class=kbadge>OP</span>' : ''}</span><span>${fmtAgo(p.ts)}</span></div>
      <div class=pbody>${esc(p.body)}${sig}</div>
      <div class=pfoot>
        <span class=merit>✦ ${esc(p.merit)} ${esc(FORUM_TOKEN)} merit</span>
        <button class=btn data-act=merit data-post="${esc(p.id)}" data-author="${esc(p.author)}">Give merit</button>
        <button class=btn data-act=reply data-post="${esc(p.id)}">Reply</button>
      </div></div>`);
  }
  // Related threads (internal-link graph): other threads in the same board, minus this one.
  let related = [];
  try {
    related = (await forum.board(th.board, { sort: 'rank' })).filter((t) => t.id !== th.id).slice(0, 5);
  } catch { related = []; }
  const relatedHtml = related.length
    ? `<div class=card><h2 style="margin-top:0">Related threads</h2>${related.map((t) => `<div class=trow>
        <div><div class=t><a href="${P(`/t/${t.id}`)}">${esc(t.title)}</a></div>
          <div class=meta>by @${esc(t.author)}</div></div>
        <div class=stat>${esc(t.replyCount)} replies</div></div>`).join('')}</div>`
    : '';

  const url = absUrl(`/t/${th.id}`);
  const trail = [{ name: 'Forum', path: '/' }];
  if (meta) trail.push({ name: meta.category, path: `/c/${meta.categoryId}` });
  trail.push({ name: meta ? meta.title : th.board, path: `/b/${th.board}` });
  trail.push({ name: th.title, path: `/t/${th.id}` });
  const jsonld = [threadJsonLd(meta, th, url), breadcrumbFor(trail)];

  const body = `<p class=muted><a href="${P(`/b/${th.board}`)}">← ${esc(meta ? meta.title : th.board)}</a>${meta ? ` · <a href="${P(`/c/${meta.categoryId}`)}">${esc(meta.category)}</a>` : ''}</p>
    <h1>${esc(th.title)}</h1>
    <p class=muted>${esc(th.replyCount)} replies · <span class=merit>✦ ${esc(th.meritTotal)} ${esc(FORUM_TOKEN)} merit</span> · last activity ${fmtAgo(th.lastActivityTs)}</p>
    ${posts.join('')}
    <div class=card><h2 style="margin-top:0">Reply</h2>
      <form class=compose id=replyform data-thread="${esc(th.id)}" data-board="${esc(th.board)}">
        <textarea id=replybody maxlength=20000 placeholder="Write a reply… (posted on-chain via MELEK-Signer)"></textarea>
        <button class="btn primary" type=submit>Sign &amp; post reply</button>
        <span class=muted style="font-size:12px;margin-left:8px">Keyless — signed in your browser.</span>
      </form></div>
    ${relatedHtml}
    ${threadClientScript(th)}`;
  return page(`${th.title} — ${SITE_NAME}`, body, { canonical: url, description: `${th.title} — ${th.replyCount} replies on the ${meta ? meta.title : th.board} board of the SoapBox Forum.`, jsonld });
}

// per-thread client wiring: reply → comment op; give-merit → custom_json intent shown + best-effort vote.
function threadClientScript(th) {
  const TAG = `melek-forum-${th.board}`;
  return `<script>
   (function(){var F=window.FORUM;if(!F)return;
     var form=document.getElementById('replyform');
     if(form)form.addEventListener('submit',async function(e){e.preventDefault();
       var body=(document.getElementById('replybody').value||'').trim();if(!body){F.toast('Write something first');return;}
       if(!F.token){F.toast('Sign in to post');F.login('comment vote');return;}
       var permlink='re-'+Date.now();
       var op=['comment',{parent_author:${JSON.stringify(th.author)},parent_permlink:${JSON.stringify(th.id)},author:F.acct,permlink:permlink,title:'',body:body,json_metadata:JSON.stringify({app:'melek-forum',board:${JSON.stringify(th.board)},tags:[${JSON.stringify(TAG)}]})}];
       F.toast('Signing…');var res=await F.broadcast([op],'forum-reply');
       if(res.ok){F.toast('✓ Posted');setTimeout(function(){location.reload();},1200);}else if(!res.login)F.toast('✕ '+(res.error||'could not post'));
     });
     document.addEventListener('click',async function(e){var b=e.target.closest&&e.target.closest('button[data-act=merit]');if(!b)return;
       var author=b.getAttribute('data-author'),postId=b.getAttribute('data-post');
       if(!F.token){F.toast('Sign in to give merit');F.login('comment vote');return;}
       if(author===F.acct){F.toast('You cannot give merit to your own post');return;}
       // FORUM merit is scarce + peer-awarded: recorded via a signed custom_json intent (the forum indexer applies the peer-merit rules).
       var op=['custom_json',{required_auths:[],required_posting_auths:[F.acct],id:'melek_forum_merit',json:JSON.stringify({from:F.acct,to:author,post:postId,amount:1})}];
       F.toast('Signing merit…');var res=await F.broadcast([op],'forum-merit');
       if(res.ok){F.toast('✦ Merit sent');setTimeout(function(){location.reload();},1200);}else if(!res.login)F.toast('✕ '+(res.error||'could not send merit'));
     });
   })();
  </script>`;
}

// ── /post — the signable compose intent (NO keys) ─────────────────────────────────────────────────
// GET /post?board=<id>&title=&body= renders the exact `comment` op that WILL be broadcast, plus a
// "Sign & post" button that broadcasts it through MELEK-Signer in the browser. This server signs nothing.
export function postIntentPage({ board = 'general', title = '', body = '' } = {}) {
  const meta = forum.boardMeta(board) || forum.boardMeta('general');
  const bid = meta ? meta.id : 'general';
  const boardOptions = forum.boards().flatMap((g) => g.boards)
    .map((b) => `<option value="${esc(b.id)}"${b.id === bid ? ' selected' : ''}>${esc(b.title)}</option>`).join('');
  const TAG = `melek-forum-${bid}`;
  // A representative intent object shown to the user (permlink filled at sign-time in the browser).
  const intent = {
    op: 'comment',
    parent_author: '',
    parent_permlink: TAG,
    author: '<your-account>',
    permlink: 'forum-<timestamp>',
    title: title || '<thread title>',
    body: body || '<thread body>',
    json_metadata: { app: 'melek-forum', board: bid, tags: [TAG] },
  };
  const body_ = `<p class=muted><a href="${P(`/b/${bid}`)}">← ${esc(meta ? meta.title : 'General')}</a></p>
    <h1>New thread</h1>
    <p class=muted>Your post becomes an on-chain <code>comment</code>. It is signed in your browser through
      <b>MELEK-Signer</b> — this site never sees your keys.</p>
    <div class=card>
      <form class=compose id=threadform>
        <label class=muted style="font-size:13px">Board</label>
        <select id=board name=board class=q style="width:100%;margin:6px 0">${boardOptions}</select>
        <label class=muted style="font-size:13px">Title</label>
        <input class=q id=title name=title value="${esc(title)}" maxlength=160 placeholder="A clear title">
        <label class=muted style="font-size:13px">Body</label>
        <textarea id=body name=body maxlength=20000 placeholder="Write your thread…">${esc(body)}</textarea>
        <button class="btn primary" type=submit>Sign &amp; post thread</button>
        <span class=muted style="font-size:12px;margin-left:8px">Keyless — MELEK-Signer.</span>
      </form>
    </div>
    <h2>The exact operation you will sign</h2>
    <div class=intent>${esc(JSON.stringify(intent, null, 2))}</div>
    <script>
     (function(){var F=window.FORUM;if(!F)return;
       var form=document.getElementById('threadform');if(!form)return;
       form.addEventListener('submit',async function(e){e.preventDefault();
         var board=document.getElementById('board').value;
         var title=(document.getElementById('title').value||'').trim();
         var body=(document.getElementById('body').value||'').trim();
         if(!title){F.toast('A title is required');return;}
         if(!body){F.toast('Write a body');return;}
         if(!F.token){F.toast('Sign in to post');F.login('comment vote');return;}
         var tag='melek-forum-'+board;
         var op=['comment',{parent_author:'',parent_permlink:tag,author:F.acct,permlink:'forum-'+Date.now(),title:title,body:body,json_metadata:JSON.stringify({app:'melek-forum',board:board,tags:[tag]})}];
         F.toast('Signing…');var res=await F.broadcast([op],'forum-thread');
         if(res.ok){F.toast('✓ Thread posted');setTimeout(function(){location.href='/b/'+board;},1200);}else if(!res.login)F.toast('✕ '+(res.error||'could not post'));
       });
     })();
    </script>`;
  return page(`New thread — ${SITE_NAME}`, body_, { canonical: absUrl('/post'), robots: 'noindex,follow' });
}

// ── /search ─────────────────────────────────────────────────────────────────────────────────────
export async function searchPage(q) {
  const query = String(q ?? '').trim();
  const results = query ? await forum.search(query) : [];
  const rows = query
    ? (results.length
      ? results.map((t) => `<div class=trow>
          <div><div class=t><a href="${P(`/t/${t.id}`)}">${esc(t.title)}</a></div>
            <div class=meta>in <a href="${P(`/b/${t.board}`)}">${esc(t.board)}</a> · by @${esc(t.author)}</div></div>
          <div class=stat>${esc(t.replyCount)} replies</div></div>`).join('')
      : `<p class=muted>No threads matched “${esc(query)}”.</p>`)
    : `<p class=muted>Type a query to search threads.</p>`;
  const body = `<h1>Search</h1>${searchForm(query)}<div class=card>${rows}</div>`;
  return page(query ? `“${query}” — ${SITE_NAME} search` : `Search — ${SITE_NAME}`, body,
    { canonical: absUrl('/search'), robots: 'noindex,follow' });
}

// ── sharded sitemaps (design §5.3) — one sitemap-index → per-shard urlsets ─────────────────────────
// At forum scale a single sitemap blows the 50k-URL cap, so /sitemap-index.xml is a sitemap INDEX that
// points at shard files: /sitemap-boards.xml (boards + categories) and /sitemap-threads-<n>.xml (threads,
// sharded by count). /sitemap.xml stays a small top-level urlset. All driven by boards.boardSitemapEntries.
const THREAD_SHARD_SIZE = 5000;
const xmlEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

/** All thread paths (`/t/<id>`) in the ledger, newest first. Local-only (ledger), no network. */
async function allThreadPaths() {
  let roots = [];
  try { roots = await forum.recentThreads(1e9); } catch { roots = []; }
  return roots.map((t) => `/t/${t.id}`);
}

function threadShardCount(n) { return Math.max(1, Math.ceil(n / THREAD_SHARD_SIZE)); }

/** The forum sitemap INDEX: boards shard + N thread shards. */
async function forumSitemapIndexXml() {
  const lastmod = new Date().toISOString().slice(0, 10);
  const n = threadShardCount((await allThreadPaths()).length);
  const shards = [`/sitemap-boards.xml`];
  for (let i = 0; i < n; i++) shards.push(`/sitemap-threads-${i}.xml`);
  const rows = shards.map((s) => `  <sitemap><loc>${xmlEsc(absUrl(s))}</loc><lastmod>${lastmod}</lastmod></sitemap>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n</sitemapindex>\n`;
}

/** The boards+categories shard urlset (includes seeded programmatic boards). */
function boardsSitemapXml() {
  const today = new Date().toISOString().slice(0, 10);
  const entries = boardSitemapEntries({ extra: SEEDED_PROGRAMMATIC }).map((e) => ({
    path: P(e.path), lastmod: today, changefreq: e.changefreq, priority: e.priority,
  }));
  return sitemapXml(`${BASE_URL}${BASE_PATH}`, entries);
}

/** One thread shard urlset (bounds-checked; empty urlset for an out-of-range shard). */
async function threadsSitemapXml(shard) {
  const today = new Date().toISOString().slice(0, 10);
  const all = await allThreadPaths();
  const i = Math.max(0, Math.floor(Number(shard) || 0));
  const slice = all.slice(i * THREAD_SHARD_SIZE, (i + 1) * THREAD_SHARD_SIZE);
  const entries = slice.map((p) => ({ path: P(p), lastmod: today, changefreq: 'weekly', priority: '0.6' }));
  return sitemapXml(`${BASE_URL}${BASE_PATH}`, entries);
}

// ── IndexNow-on-create hook (design §5.4) — env-gated (FORUM_INDEXNOW=1), fire-and-forget, soft-fail.
// The render path NEVER calls this; it is fired once at seed-time so the flagship URLs get submitted. Real
// browser-side creates can POST to a future /notify route that calls pingIndexNow — the seam is here.
export function pingIndexNow(paths = []) {
  if (!INDEXNOW_ON) return { ok: false, skipped: 'disabled' };
  const urls = [].concat(paths).filter(Boolean).map((p) => absUrl(p));
  if (!urls.length) return { ok: false, skipped: 'no-urls' };
  try { Promise.resolve(submitIndexNow(`${BASE_URL}${BASE_PATH}`, urls)).catch(() => {}); } catch { /* soft-fail */ }
  return { ok: true, submitted: urls.length };
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}

function sendXml(res, xml) { res.writeHead(200, { 'content-type': 'application/xml' }); res.end(xml); }

export const SITEMAP_PATHS = ['/', '/search',
  ...forum.boards().flatMap((g) => g.boards).map((b) => `/b/${b.id}`),
  ...listCategories().map((c) => `/c/${c.id}`)];

export async function handler(req, res) {
  try {
    await seed();
    const url = new URL(req.url, BASE_URL);
    // BASE_PATH-aware: strip the mount prefix so route matching is prefix-agnostic ('' by default).
    let path = url.pathname;
    if (BASE_PATH && (path === BASE_PATH || path.startsWith(BASE_PATH + '/'))) path = path.slice(BASE_PATH.length) || '/';

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: u === '/' ? 'daily' : 'weekly', priority: u === '/' ? '1.0' : '0.7' }));
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, entries));
    }
    if (path === '/sitemap-index.xml') return sendXml(res, await forumSitemapIndexXml());
    if (path === '/sitemap-boards.xml') return sendXml(res, boardsSitemapXml());
    {
      const m = path.match(/^\/sitemap-threads-(\d+)\.xml$/);
      if (m) return sendXml(res, await threadsSitemapXml(m[1]));
    }
    if (path === '/sitemap-ecosystem.xml') {
      // the cross-site public index (kept available for the broader SoapBox sitemap network).
      return sendXml(res, publicSitemapIndexXml(new Date().toISOString().slice(0, 10)));
    }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: SITE_NAME, baseUrl: BASE_URL,
        summary: 'A forum on the MELEK chain — categorised boards + threads, ranked by scarce peer-awarded FORUM merit (never bought, never self-minted). Keyless posting via MELEK-Signer; on-chain comment ops.',
        links: forum.boards().flatMap((g) => g.boards).map((b) => ({ label: b.title, path: `/b/${b.id}` })),
      }));
    }

    if (path === '/') return sendHtml(res, await homePage());

    if (path === '/post') {
      return sendHtml(res, postIntentPage({
        board: url.searchParams.get('board') || 'general',
        title: url.searchParams.get('title') || '',
        body: url.searchParams.get('body') || '',
      }));
    }

    if (path === '/search') return sendHtml(res, await searchPage(url.searchParams.get('q') || ''));

    if (path.startsWith('/c/')) {
      const html = categoryPage(decodeURIComponent(path.slice(3).replace(/\/$/, '')));
      if (!html) { res.writeHead(302, { location: P('/') }); return res.end(); }
      return sendHtml(res, html);
    }

    if (path.startsWith('/b/')) {
      const view = await boardPage(decodeURIComponent(path.slice(3).replace(/\/$/, '')));
      if (!view) { res.writeHead(302, { location: P('/') }); return res.end(); }
      return sendHtml(res, view.html);
    }

    if (path.startsWith('/t/')) {
      const html = await threadPage(decodeURIComponent(path.slice(3).replace(/\/$/, '')));
      if (!html) { res.writeHead(302, { location: P('/') }); return res.end(); }
      return sendHtml(res, html);
    }

    res.writeHead(302, { location: P('/') });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/forum\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Forum on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
