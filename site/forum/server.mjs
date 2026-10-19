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
//   /health /health.json /robots.txt /sitemap.xml /sitemap-index.xml /sitemap-boards.xml
//   /sitemap-threads-<n>.xml (n from 1) /llms.txt
//
// ── Content ─────────────────────────────────────────────────────────────────────────────────────
//   Three layers, read together through site/forum/store.mjs:
//     • the Hathor-authored seed set (site/forum/seed-threads.mjs + seed/*.mjs) — read-only, never written;
//     • the chain mirror (integrations/forum/chain-mirror.mjs) — @hathor and @melek posts, and every post in a
//       melek-forum-<board> category, read from MELEK RPC in the background (never on the render path);
//     • local entries appended through the engine, persisted as JSONL at FORUM_DATA (with mirrored entries,
//       so the mirror renders on boot even when the RPC is down).
//   Env: FORUM_DATA (JSONL path), FORUM_MIRROR (1/0; default on when NODE_ENV=production),
//        FORUM_RPC_URL (default https://melek.salon/rpc — it needs the tags/discussion APIs, which a
//        bare witness node may not serve, so MELEK_RPC_URL is deliberately not used).
//
// ── DISCIPLINE ──────────────────────────────────────────────────────────────────────────────────
//   KEYLESS. Posting is a `comment` op broadcast in the BROWSER against MELEK-Signer with a scoped bearer
//   token; this server holds no WIF and signs nothing. Merit is scarce peer-awarded FORUM merit — never
//   bought, never self-minted (enforced in peer-merit). esc() on every interpolated value. Soft-fail:
//   every route renders even when the engine returns nothing.

import { createServer } from 'node:http';
import * as nodeFs from 'node:fs';

import { createForum, FORUM_TOKEN } from '../../integrations/forum/forum-core.mjs';
import {
  forumRegistry, listCategories, boardsInCategory, categoryName,
  boardSitemapEntries, FLAGSHIP_BOARDS, resolveBoard, listBoards,
} from '../../integrations/forum/boards.mjs';
import { createChainMirror, tagForBoard, DEFAULT_RPC } from '../../integrations/forum/chain-mirror.mjs';
import { createForumStore } from './store.mjs';
import { seedEntries, seedBoards, LEGACY_IDS, SEED_AUTHOR } from './seed-threads.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt, submitIndexNow } from '../../integrations/soapbox/crawlers.mjs';
import { headTags, breadcrumbJsonLd } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8200);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
// BASE_PATH lets the forum mount under a sub-path (e.g. /forum) behind a shared gateway. '' by default.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const SIGNER_URL = (process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon').replace(/\/$/, '');

// ── Launch gating ────────────────────────────────────────────────────────────────────────────────
// Set FORUM_LOCKED=1 in the environment to run the LOCKED launch phase: only Hathor's seeded posts
// show, the banner appears, and nobody can sign in or post (compose/reply/merit hidden, /post gated).
// The DEPLOYED forum sets FORUM_LOCKED=1; unset (the default) is the fully-open forum, as tests expect.
const READONLY = process.env.FORUM_LOCKED === '1' || process.env.FORUM_LOCKED === 'true';
// Content is the Hathor seed set + the chain mirror + persisted local entries. There is no demo seed: no
// invented accounts are ever shown, in production or anywhere else.
const FORUM_DATA = process.env.FORUM_DATA || '';
const MIRROR_ON = process.env.FORUM_MIRROR === '1'
  || (process.env.FORUM_MIRROR !== '0' && process.env.NODE_ENV === 'production');
const RPC_URL = process.env.FORUM_RPC_URL || DEFAULT_RPC;
const APP_NAME = process.env.FORUM_APP || 'forum';
const SITE_NAME = 'SoapBox Forum';
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const DISCORD_INVITE = process.env.DISCORD_INVITE || 'https://discord.gg/Ghz672dW7Z';
// IndexNow-on-create ping: opt-in (FORUM_INDEXNOW=1) + fire-and-forget so the render path stays network-free.
const INDEXNOW_ON = process.env.FORUM_INDEXNOW === '1';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// jsScript: JSON for embedding inside an inline <script> — '<', '>', '&' and the JS line separators are
// \u-escaped so a value containing "</script>" can never close the script element.
export const jsScript = (v) => JSON.stringify(v === undefined ? null : v)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

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
    author: { '@type': 'Person', name: th.author, url: `https://melek.salon/@${encodeURIComponent(th.author)}` },
    articleBody: root.body || undefined,
    sameAs: root.chain && root.chain.url ? root.chain.url : undefined,
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

// ── the forum instance ────────────────────────────────────────────────────────────────────────────
// The board network is data-driven: the registry (integrations/forum/boards.mjs) tells the engine which
// board ids are valid (static + programmatic city/game/travel/biz) and their titles. Thread/reply/merit
// logic is untouched — the registry is metadata + routing only. The store layers seed + chain + local.
const SEED = seedEntries();

/** Every board whose melek-forum-<board> category the mirror reads (static boards + seeded programmatic). */
function boardTagList() {
  const ids = listBoards().filter((b) => b.kind !== 'review' && b.kind !== 'classified').map((b) => b.id);
  for (const id of seedBoards()) if (!ids.includes(id) && resolveBoard(id)) ids.push(id);
  return ids.map((board) => ({ board, tag: tagForBoard(board) }));
}

export const mirror = createChainMirror({
  rpcUrl: RPC_URL, boardTags: boardTagList, resolveBoard,
  onNew: (entries) => store.persistChain(entries),
});
export const store = createForumStore({ file: FORUM_DATA, fs: FORUM_DATA ? nodeFs : null, seed: () => SEED, mirror });
mirror.load(store.persistedChain());
export const forum = createForum({ store, registry: forumRegistry() });

// Programmatic boards that carry seeded content (for the sitemap + IndexNow).
export const SEEDED_PROGRAMMATIC = seedBoards().filter((id) => { const m = resolveBoard(id); return !!(m && m.programmatic); });

// Seeding is layered (seed-threads.mjs), so it is idempotent by construction; seed() only primes Hathor's
// merit allotment and fires the one-time IndexNow ping. Kept as an export for callers and tests.
let _seeded = false;
export async function seed(now = Date.parse('2026-08-01T00:00:00Z')) {
  if (_seeded) return;
  _seeded = true;
  try { await forum.grantAllotment(SEED_AUTHOR, { now }); } catch { /* soft-fail */ }
  pingIndexNow(['/', ...FLAGSHIP_BOARDS.map((b) => `/b/${b}`), ...SEEDED_PROGRAMMATIC.map((b) => `/b/${b}`)]);
}

// The chain mirror refreshes in the background (never on the render path). Started by the first request in
// production; tests drive mirror.refresh() directly with an injected fetch.
let _mirrorStarted = false;
export function startMirror() {
  if (_mirrorStarted || !MIRROR_ON) return false;
  _mirrorStarted = true;
  try { mirror.start(); } catch { /* soft-fail */ }
  return true;
}

// ── post bodies: plain text, escaped, with bare URLs linked and "## " lines as subheadings ─────────────
function linkify(escaped) {
  return escaped.replace(/https?:\/\/[^\s<>]+/g, (raw) => {
    let u = raw;
    let tail = '';
    const stop = u.search(/&(quot|#39|lt|gt);/);
    if (stop >= 0) { tail = u.slice(stop); u = u.slice(0, stop); }
    // trailing punctuation is prose, not URL — except a ')' that closes a '(' inside the URL (wiki slugs)
    for (;;) {
      const last = u.slice(-1);
      if (!last || !'.,;:!?)'.includes(last) || /&[a-z#0-9]+;$/i.test(u)) break;
      if (last === ')' && (u.match(/\(/g) || []).length >= (u.match(/\)/g) || []).length) break;
      tail = last + tail; u = u.slice(0, -1);
    }
    if (!/^https?:\/\/[^/]/.test(u)) return raw;
    return `<a href="${u}" rel="nofollow noopener">${u}</a>${tail}`;
  });
}
export function renderBody(text) {
  return String(text == null ? '' : text).split('\n').map((line) => {
    const h = line.match(/^##\s+(.+)$/);
    return h ? `<span class=ph>${linkify(esc(h[1]))}</span>` : linkify(esc(line));
  }).join('\n');
}

// ── compose templates (FORUM_BOARD_DESIGN §3b): a form that asks for structure produces structure ───────
export const TEMPLATES = {
  method: '## What I made\nOne line, and the image or file.\n\n## The route\nWhich surface and which settings.\n\n## The exact inputs\nPrompt, negative prompt, seed, steps, sampler, CFG, size, and any reference or control image.\n\n## What it got wrong, and the fix\nThe failed attempts are the content. Show at least one.\n\n## Reproduce it\nThe smallest set of steps for someone else to get close.\n\n## Open question\nWhere you are stuck.\n',
  case: '## What was taken\nSubstance or preparation, form, amount, route. Say "unmeasured" if it was unmeasured.\n\n## What else was in the system\nEverything: prescriptions, caffeine, alcohol, nicotine, grapefruit, supplements, and anything long-acting from the previous 72 hours.\n\n## Timeline\nClock times from first dose: onset, peak, turns, resolution, next day.\n\n## What happened\nEffects, and separately, your interpretation of them.\n\n## What would have been worth checking first\nWhich interaction, which test. https://wiki.soapbox.community/wiki/Cytochrome_P450_System_Inhibition_and_Induction\n\n## What I would change\nOne line.\n',
  local: '## Question, scoped\nPlace, and the constraint that matters (budget, commute, season, accessibility, kids, no car).\n\n## As of\nMonth and year.\n\n## The answer\nSpecific: streets, lines, names, numbers, hours.\n\n## Sourced\nWhat this rests on, including "I have lived here since" if that is the source.\n\n## What would change this answer\nThe thing that would make it wrong next year.\n',
};
export function templateFor(meta) {
  if (!meta) return '';
  if (meta.categoryId === 'make' || ['studio', 'development', 'beauty', 'fashion'].includes(meta.id)) return TEMPLATES.method;
  if (['case-reports', 'herb', 'nootropics'].includes(meta.id)) return TEMPLATES.case;
  if (meta.categoryId === 'local' || meta.categoryId === 'travel') return TEMPLATES.local;
  return '';
}
const templateKey = (meta) => {
  const t = templateFor(meta);
  return Object.keys(TEMPLATES).find((k) => TEMPLATES[k] === t) || '';
};

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
  .pbody .ph{display:block;font-weight:700;font-size:16px;margin-top:4px}
  .norms{font-size:14px} .norms div{margin:3px 0} .asof{border-color:#d2992255}
  .kbadge{font-size:11px;background:#1f6feb22;color:var(--blue);border-radius:8px;padding:1px 7px}
  .toast{position:fixed;left:50%;transform:translateX(-50%);bottom:20px;background:var(--blue);color:#fff;padding:10px 18px;border-radius:999px;font-weight:600;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:9} .toast.show{opacity:1}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7} footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>${esc(SITE_NAME)}</b> — a forum on the MELEK chain. Posts are on-chain <code>comment</code> operations, signed
  in your browser through <b>MELEK-Signer</b>; this site holds no keys. Standing is <b>${esc(FORUM_TOKEN)} merit</b> —
  scarce, peer-awarded, never bought and never self-minted. MELEK mainnet.
  <div style="margin-top:8px"><a href="${P('/')}">Forum</a> · <a href="${safeHref(DATA)}">Data</a> · <a href="${safeHref(DISCORD_INVITE)}">Discord</a></div>
</footer>`;

// ── MELEK-Signer client (keyless): OAuth capture + broadcast(comment/vote) in the browser ─────────
function clientScript() {
  return `<div class=toast id=toast></div><script>
   window.FORUM=(function(){
     var SIGNER=${jsScript(SIGNER_URL)},APP=${jsScript(APP_NAME)};
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
<header class=topbar><a class=brand href="${P('/')}">🗣️ SoapBox <span>forum</span></a>
  <div class=topbar-r><a href="${P('/')}">Home</a><a href="${P('/search')}">Search</a>${READONLY ? '' : `<a href="${P('/post')}">New thread</a>`}</div></header>
${READONLY ? `<div style="background:#1f2a1f;border-bottom:1px solid #2f4f2f;color:#cdeacd;padding:8px 16px;font-size:14px;text-align:center">📖 The Forum is in its opening phase — these posts are from <b>Hathor</b> while sign-in &amp; public posting are being prepared. Reading is open to all; posting opens soon.</div>` : ''}
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

// Threads pinned at the top of the home page.
const PINNED = ['welcome-to-the-melek-forum', 'melek-prana-and-kula-what-each-one-is', 'the-library-of-ashurbanipal-is-open-on-the-forum'];

// ── home ────────────────────────────────────────────────────────────────────────────────────────
export async function homePage() {
  const groups = forum.boards();
  const all = await forum.recentThreads(1e9);
  const recent = all.slice(0, 15);
  const counts = new Map();
  for (const t of all) counts.set(t.board, (counts.get(t.board) || 0) + 1);
  const cats = groups.map((g) => `
    <h2>${g.categoryId ? `<a href="${P(`/c/${g.categoryId}`)}">${esc(g.category)}</a>` : esc(g.category)}${g.comparable ? ` <span class=muted style="font-size:12px;text-transform:none;letter-spacing:0">· like ${esc(g.comparable)}</span>` : ''}</h2>
    ${g.boards.map((b) => `<a class=board href="${P(`/b/${b.id}`)}">
        <div><div class=t>${esc(b.title)}</div><div class=d>${esc(b.desc)}</div></div>
        <div class=stat>${esc(counts.get(b.id) || 0)} threads</div>
      </a>`).join('')}`).join('');
  const recentRows = recent.length
    ? recent.map((t) => `<div class=trow>
        <div><div class=t><a href="${P(`/t/${t.id}`)}">${esc(t.title)}</a></div>
          <div class=meta>in <a href="${P(`/b/${t.board}`)}">${esc(t.board)}</a> · by @${esc(t.author)}</div></div>
        <div class=stat>${esc(t.replyCount)} replies<br>${fmtAgo(t.lastActivityTs)}</div>
      </div>`).join('')
    : `<p class=muted>No threads here yet.${READONLY ? '' : ` <a href="${P('/post')}">Start the first one.</a>`}</p>`;
  const pinned = [];
  for (const id of PINNED) { const th = await forum.thread(id); if (th) pinned.push(th); }
  const pinnedHtml = pinned.length
    ? `<div class=card><h2 style="margin-top:0">Start here</h2>${pinned.map((t) => `<div class=trow>
        <div><div class=t><a href="${P(`/t/${t.id}`)}">${esc(t.title)}</a></div>
          <div class=meta>in <a href="${P(`/b/${t.board}`)}">${esc(t.board)}</a> · by @${esc(t.author)}</div></div>
        <div class=stat>${esc(t.replyCount)} replies</div></div>`).join('')}</div>`
    : '';
  const body = `<h1>SoapBox Forum <span class=muted style="font-size:14px">· on the MELEK chain</span></h1>
    <p class=muted>${esc(all.length)} threads. Making things with AI and graphics, local and travel answers with a
      date on them, and pharmacology and tradition cited for the same question. The method is in the post.
      Standing is <b>scarce peer-awarded ${esc(FORUM_TOKEN)} merit</b> — a whale's stake buys none of it. Post through
      MELEK-Signer; we hold no keys.</p>
    ${searchForm()}
    ${pinnedHtml}
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
    ${meta.belongs || meta.elsewhere ? `<div class="card norms">${meta.belongs ? `<div><b>Belongs here:</b> ${esc(meta.belongs)}</div>` : ''}${meta.elsewhere ? `<div><b>Goes elsewhere:</b> ${esc(meta.elsewhere)}</div>` : ''}</div>` : ''}
    ${links}
    ${READONLY ? '' : `<p><a class="btn primary" href="${P(`/post?board=${encodeURIComponent(meta.id)}`)}">＋ New thread</a></p>`}
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
      <div class=pbody>${renderBody(p.body)}${sig}</div>
      <div class=pfoot>
        <span class=merit>✦ ${esc(p.merit)} ${esc(FORUM_TOKEN)} merit</span>
        ${READONLY ? '' : `<button class=btn data-act=merit data-post="${esc(p.id)}" data-author="${esc(p.author)}">Give merit</button>
        <button class=btn data-act=reply data-post="${esc(p.id)}"${p.chain ? ` data-ca="${esc(p.chain.author)}" data-cp="${esc(p.chain.permlink)}"` : ''}>Reply</button>`}
        ${p.chain && p.chain.url ? `<a class=muted href="${safeHref(p.chain.url)}" rel="noopener">on chain ↗</a>` : ''}
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
  const root = th.posts[0] || {};
  const source = root.chain && root.chain.url
    ? `<p class=muted>Posted on the MELEK chain by @${esc(root.author)} — <a href="${safeHref(root.chain.url)}" rel="noopener">read it on melek.salon</a>.</p>`
    : '';
  // Place boards: date the newest answer (FORUM_BOARD_DESIGN §3f) — local facts rot, so say how old this is.
  let asOf = '';
  if (meta && (meta.categoryId === 'local' || meta.categoryId === 'travel') && th.lastActivityTs) {
    const days = Math.max(0, Math.floor((Date.now() - th.lastActivityTs) / 86400000));
    asOf = `<div class="card asof muted">Newest answer: ${esc(new Date(th.lastActivityTs).toISOString().slice(0, 10))} (${esc(days)} day${days === 1 ? '' : 's'} old). Local facts change — if something here is out of date, reply with what is true now and the month you checked.</div>`;
  }

  const body = `<p class=muted><a href="${P(`/b/${th.board}`)}">← ${esc(meta ? meta.title : th.board)}</a>${meta ? ` · <a href="${P(`/c/${meta.categoryId}`)}">${esc(meta.category)}</a>` : ''}</p>
    <h1>${esc(th.title)}</h1>
    <p class=muted>${esc(th.replyCount)} replies · <span class=merit>✦ ${esc(th.meritTotal)} ${esc(FORUM_TOKEN)} merit</span> · last activity ${fmtAgo(th.lastActivityTs)}</p>
    ${source}${asOf}
    ${posts.join('')}
    ${READONLY ? '' : `<div class=card><h2 style="margin-top:0">Reply</h2>
      <form class=compose id=replyform data-thread="${esc(th.id)}" data-board="${esc(th.board)}">
        <textarea id=replybody maxlength=20000 placeholder="Write a reply… (posted on-chain via MELEK-Signer)"></textarea>
        <button class="btn primary" type=submit>Sign &amp; post reply</button>
        <span class=muted style="font-size:12px;margin-left:8px">Keyless — signed in your browser.</span>
      </form></div>`}
    ${relatedHtml}
    ${threadClientScript(th, root)}`;
  const lead = String(root.body || '').replace(/^##\s+/gm, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  const description = lead ? `${lead.slice(0, 155)}${lead.length > 155 ? '…' : ''}` : `${th.title} — on the ${meta ? meta.title : th.board} board of the SoapBox Forum.`;
  return page(`${th.title} — ${SITE_NAME}`, body, { canonical: url, description, jsonld });
}

// per-thread client wiring: reply → comment op; give-merit → custom_json intent shown + best-effort vote.
// A thread mirrored from chain gets a true chain reply (parent = that post). A thread that is not on chain
// (a seed thread) gets a post in the board's category carrying json_metadata.reply_to, which the chain
// mirror attaches back under the thread.
function threadClientScript(th, root) {
  const TAG = tagForBoard(th.board);
  const onChain = root && root.chain ? { author: root.chain.author, permlink: root.chain.permlink } : null;
  return `<script>
   (function(){var F=window.FORUM;if(!F)return;
     var ON=${jsScript(onChain)},TID=${jsScript(th.id)},BOARD=${jsScript(th.board)},TAG=${jsScript(TAG)},TITLE=${jsScript(th.title)};
     var PARENT=null;
     var form=document.getElementById('replyform');
     if(form)form.addEventListener('submit',async function(e){e.preventDefault();
       var body=(document.getElementById('replybody').value||'').trim();if(!body){F.toast('Write something first');return;}
       if(!F.token){F.toast('Sign in to post');F.login('comment vote');return;}
       var permlink='re-'+Date.now();
       var meta={app:'melek-forum',board:BOARD,tags:[TAG]};
       var pa='',pp=TAG,title='Re: '+TITLE;
       if(PARENT&&PARENT.ca){pa=PARENT.ca;pp=PARENT.cp;title='';}
       else if(ON){pa=ON.author;pp=ON.permlink;title='';}
       else{meta.reply_to=TID;if(PARENT&&PARENT.id)meta.reply_parent=PARENT.id;}
       var op=['comment',{parent_author:pa,parent_permlink:pp,author:F.acct,permlink:permlink,title:title,body:body,json_metadata:JSON.stringify(meta)}];
       F.toast('Signing…');var res=await F.broadcast([op],'forum-reply');
       if(res.ok){F.toast('✓ Posted — it appears here once the chain mirror next reads it');setTimeout(function(){location.reload();},2500);}else if(!res.login)F.toast('✕ '+(res.error||'could not post'));
     });
     document.addEventListener('click',async function(e){
       var rb=e.target.closest&&e.target.closest('button[data-act=reply]');
       if(rb){PARENT={id:rb.getAttribute('data-post'),ca:rb.getAttribute('data-ca'),cp:rb.getAttribute('data-cp')};var ta=document.getElementById('replybody');if(ta){ta.focus();ta.scrollIntoView({block:'center'});}return;}
       var b=e.target.closest&&e.target.closest('button[data-act=merit]');if(!b)return;
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
  const TAG = tagForBoard(bid);
  const startBody = body || templateFor(meta);
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
        <textarea id=body name=body maxlength=20000 placeholder="Write your thread…">${esc(startBody)}</textarea>
        <p class=muted style="font-size:12px;margin:0">${meta && meta.belongs ? `Belongs here: ${esc(meta.belongs)} ` : ''}The template is a prompt, not a rule — delete what does not fit.</p>
        <button class="btn primary" type=submit>Sign &amp; post thread</button>
        <span class=muted style="font-size:12px;margin-left:8px">Keyless — MELEK-Signer.</span>
      </form>
    </div>
    <h2>The exact operation you will sign</h2>
    <div class=intent>${esc(JSON.stringify(intent, null, 2))}</div>
    <script>
     (function(){var F=window.FORUM;if(!F)return;
       var form=document.getElementById('threadform');if(!form)return;
       var TPL=${jsScript(TEMPLATES)},KEY=${jsScript(Object.fromEntries(forum.boards().flatMap((g) => g.boards).map((b) => [b.id, templateKey(b)])))};
       var sel=document.getElementById('board'),ta=document.getElementById('body');
       if(sel&&ta)sel.addEventListener('change',function(){var cur=(ta.value||'').trim();var isTpl=!cur||Object.keys(TPL).some(function(k){return TPL[k].trim()===cur;});if(isTpl)ta.value=TPL[KEY[sel.value]]||'';});
       form.addEventListener('submit',async function(e){e.preventDefault();
         var board=document.getElementById('board').value;
         var title=(document.getElementById('title').value||'').trim();
         var body=(document.getElementById('body').value||'').trim();
         if(!title){F.toast('A title is required');return;}
         if(!body){F.toast('Write a body');return;}
         if(!F.token){F.toast('Sign in to post');F.login('comment vote');return;}
         var tag='melek-forum-'+board.replace(/\//g,'-');
         var op=['comment',{parent_author:'',parent_permlink:tag,author:F.acct,permlink:'forum-'+Date.now(),title:title,body:body,json_metadata:JSON.stringify({app:'melek-forum',board:board,tags:[tag]})}];
         F.toast('Signing…');var res=await F.broadcast([op],'forum-thread');
         if(res.ok){F.toast('✓ Thread posted — it appears on the board once the chain mirror next reads it');setTimeout(function(){location.href=${jsScript(P('/b/'))}+board;},2500);}else if(!res.login)F.toast('✕ '+(res.error||'could not post'));
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

/** Every thread in the ledger (seed + chain mirror + local), newest first: { path, lastmod }. No network. */
async function allThreads() {
  let roots = [];
  try { roots = await forum.recentThreads(1e9); } catch { roots = []; }
  return roots.map((t) => ({
    path: `/t/${t.id}`,
    lastmod: new Date(Number(t.lastActivityTs) || Date.now()).toISOString().slice(0, 10),
  }));
}

function threadShardCount(n) { return Math.max(1, Math.ceil(n / THREAD_SHARD_SIZE)); }

/** The forum sitemap INDEX: boards shard + N thread shards, numbered from 1. */
async function forumSitemapIndexXml() {
  const lastmod = new Date().toISOString().slice(0, 10);
  const n = threadShardCount((await allThreads()).length);
  const shards = [`/sitemap-boards.xml`];
  for (let i = 1; i <= n; i++) shards.push(`/sitemap-threads-${i}.xml`);
  const rows = shards.map((sh) => `  <sitemap><loc>${xmlEsc(absUrl(sh))}</loc><lastmod>${lastmod}</lastmod></sitemap>`).join('\n');
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

/** One thread shard urlset. Shards are numbered from 1; shard 0 is kept as an alias of shard 1 (older
 *  links), and an out-of-range shard is an empty urlset. */
async function threadsSitemapXml(shard) {
  const all = await allThreads();
  const n = Math.max(1, Math.floor(Number(shard) || 0));
  const slice = all.slice((n - 1) * THREAD_SHARD_SIZE, n * THREAD_SHARD_SIZE);
  const entries = slice.map((t) => ({ path: P(t.path), lastmod: t.lastmod, changefreq: 'weekly', priority: '0.6' }));
  return sitemapXml(`${BASE_URL}${BASE_PATH}`, entries);
}

/** /sitemap.xml — the one the web tier's master index points at, so it carries every board AND thread. */
async function mainSitemapXml() {
  const today = new Date().toISOString().slice(0, 10);
  const entries = SITEMAP_PATHS.map((u) => ({ path: P(u), lastmod: today, changefreq: u === '/' ? 'daily' : 'weekly', priority: u === '/' ? '1.0' : '0.7' }));
  for (const id of SEEDED_PROGRAMMATIC) entries.push({ path: P(`/b/${id}`), lastmod: today, changefreq: 'weekly', priority: '0.6' });
  for (const t of (await allThreads()).slice(0, 45000)) entries.push({ path: P(t.path), lastmod: t.lastmod, changefreq: 'weekly', priority: '0.6' });
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
    startMirror();
    const url = new URL(req.url, BASE_URL);
    // BASE_PATH-aware: strip the mount prefix so route matching is prefix-agnostic ('' by default).
    let path = url.pathname;
    if (BASE_PATH && (path === BASE_PATH || path.startsWith(BASE_PATH + '/'))) path = path.slice(BASE_PATH.length) || '/';

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/health.json') {
      const threads = await forum.recentThreads(1e9);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true, threads: threads.length,
        seedThreads: SEED.filter((e) => e.parentId === null).length,
        chainThreads: mirror.entries().filter((e) => e.parentId === null).length,
        persisted: !!FORUM_DATA, mirror: { on: MIRROR_ON, started: _mirrorStarted, ...mirror.status },
      }));
    }
    if (path === '/sitemap.xml') return sendXml(res, await mainSitemapXml());
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
      if (READONLY) {
        return sendHtml(res, page(`Posting opens soon — ${SITE_NAME}`,
          `<h1>Posting opens soon</h1>
           <p class=muted>The MELEK Forum is in its opening phase. Right now it carries <b>Hathor</b>'s posts while sign-in and keyless posting are being prepared. Public posting will open here soon — until then, browse and read.</p>
           <p><a class=btn href="${P('/')}">← Back to the forum</a></p>`,
          { canonical: absUrl('/post'), robots: 'noindex,follow' }));
      }
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
      const tid = decodeURIComponent(path.slice(3).replace(/\/$/, ''));
      const html = await threadPage(tid);
      if (!html) {
        // the launch threads' original addresses (/t/t0…t7) move permanently to their slugs
        if (Object.prototype.hasOwnProperty.call(LEGACY_IDS, tid)) { res.writeHead(301, { location: P(`/t/${LEGACY_IDS[tid]}`) }); return res.end(); }
        res.writeHead(302, { location: P('/') }); return res.end();
      }
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
