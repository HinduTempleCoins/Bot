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
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8200);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SIGNER_URL = (process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon').replace(/\/$/, '');
const APP_NAME = process.env.FORUM_APP || 'forum';
const SITE_NAME = 'SoapBox Forum';
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── the forum instance (in-memory demo seed so the live surface has content) ──────────────────────
export const forum = createForum({});
let _seeded = false;
export async function seed(now = Date.parse('2026-08-01T00:00:00Z')) {
  if (_seeded) return;
  _seeded = true;
  const HR = 60 * 60 * 1000;
  // Bootstrap: give the seed accounts merit so they clear the new-account gate (also demonstrates merit).
  await forum.grantAllotment('hathor', { now });
  await forum.grantAllotment('cheetah', { now });
  await forum.merit.sendMerit('hathor', 'kalivankush', 1, { now });   // kalivankush earns 1 FORUM merit
  await forum.grantAllotment('hathor', { now: now + 30 * 24 * HR });
  const t1 = await forum.createThread({ board: 'announcements', author: 'hathor', title: 'Welcome to the MELEK Forum', body: 'This forum runs on the MELEK chain. Posts are on-chain comments; standing is scarce, peer-awarded FORUM merit — it can never be bought or self-minted.', now });
  const t2 = await forum.createThread({ board: 'economy', author: 'kalivankush', title: 'How FORUM merit differs from stake', body: 'A whale\'s stake buys zero merit here. You can only send merit you were given. Discuss.', now: now + HR });
  await forum.createThread({ board: 'library', author: 'hathor', title: 'Library of Ashurbanipal — scope & safety', body: 'Reference and harm-reduction only: history, ethnobotany, pharmacology, dose ranges, interactions, testing, set/setting/aftercare. No synthesis or extraction recipes.', now: now + 2 * HR });
  if (t1.ok) await forum.reply({ threadId: t1.thread.id, author: 'kalivankush', body: 'Glad to be here. The merit model is the interesting part.', now: now + 3 * HR });
  if (t2.ok) {
    const r = await forum.reply({ threadId: t2.thread.id, author: 'hathor', body: 'Exactly — it is Sybil-resistant and non-plutocratic by construction.', now: now + 4 * HR });
    if (r.ok) await forum.awardMerit({ from: 'kalivankush', postId: r.post.id, amount: 1, now: now + 5 * HR });
  }
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
  <div style="margin-top:8px"><a href="/">Forum</a> · <a href="${esc(DATA)}">Data</a></div>
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
  const canonical = opts.canonical || `${BASE_URL}/`;
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME,
    robots: opts.robots || 'index,follow,max-image-preview:large',
    site: { url: BASE_URL, name: SITE_NAME, searchUrlTemplate: `${BASE_URL}/search?q={search_term_string}` },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header class=topbar><a class=brand href="/">🗣️ SoapBox <span>forum</span></a><span class=alpha>ALPHA · TESTNET</span>
  <div class=topbar-r><a href="/">Home</a><a href="/search">Search</a><a href="/post">New thread</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}${clientScript()}</body></html>`;
}

function searchForm(q = '') {
  return `<form class=hsearch method=get action="/search"><div class=row>
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
  const recent = await forum.recentThreads(8);
  const cats = groups.map((g) => `
    <h2>${esc(g.category)}</h2>
    ${g.boards.map((b) => `<a class=board href="/b/${esc(b.id)}">
        <div><div class=t>${esc(b.title)}</div><div class=d>${esc(b.desc)}</div></div>
      </a>`).join('')}`).join('');
  const recentRows = recent.length
    ? recent.map((t) => `<div class=trow>
        <div><div class=t><a href="/t/${esc(t.id)}">${esc(t.title)}</a></div>
          <div class=meta>in <a href="/b/${esc(t.board)}">${esc(t.board)}</a> · by @${esc(t.author)}</div></div>
        <div class=stat>${esc(t.replyCount)} replies<br>${fmtAgo(t.lastActivityTs)}</div>
      </div>`).join('')
    : `<p class=muted>No threads yet. <a href="/post">Start the first one.</a></p>`;
  const body = `<h1>SoapBox Forum <span class=muted style="font-size:14px">· on the MELEK chain</span></h1>
    <p class=muted>Boards and threads with <b>scarce peer-awarded ${esc(FORUM_TOKEN)} merit</b> — a whale's stake buys
      none of it. Post through MELEK-Signer; we hold no keys.</p>
    ${searchForm()}
    ${cats}
    <h2>Recent activity</h2>
    <div class=card>${recentRows}</div>`;
  return page(`${SITE_NAME} — MELEK community boards`, body, { canonical: `${BASE_URL}/` });
}

// ── /b/<board> ──────────────────────────────────────────────────────────────────────────────────
export async function boardPage(id, { now } = {}) {
  const meta = forum.boardMeta(id);
  if (!meta) return null;
  const threads = await forum.board(id, { now, sort: 'rank' });
  const rows = threads.length
    ? threads.map((t) => `<div class=trow>
        <div><div class=t><a href="/t/${esc(t.id)}">${esc(t.title)}</a></div>
          <div class=meta>by @${esc(t.author)} · ${fmtAgo(t.createdTs)}</div></div>
        <div class=stat><span class=merit>✦ ${esc(t.meritTotal)}</span> · ${esc(t.replyCount)} replies<br>${fmtAgo(t.lastActivityTs)}</div>
      </div>`).join('')
    : `<p class=muted>No threads in this board yet.</p>`;
  const body = `<p class=muted><a href="/">← All boards</a></p>
    <h1>${esc(meta.title)}</h1>
    <p class=muted>${esc(meta.desc)}</p>
    <p><a class="btn primary" href="/post?board=${esc(meta.id)}">＋ New thread</a></p>
    <div class=card>${rows}</div>`;
  return { meta, html: page(`${meta.title} — ${SITE_NAME}`, body, { canonical: `${BASE_URL}/b/${meta.id}`, description: esc(meta.desc) }) };
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
  const body = `<p class=muted><a href="/b/${esc(th.board)}">← ${esc(meta ? meta.title : th.board)}</a></p>
    <h1>${esc(th.title)}</h1>
    <p class=muted>${esc(th.replyCount)} replies · <span class=merit>✦ ${esc(th.meritTotal)} ${esc(FORUM_TOKEN)} merit</span> · last activity ${fmtAgo(th.lastActivityTs)}</p>
    ${posts.join('')}
    <div class=card><h2 style="margin-top:0">Reply</h2>
      <form class=compose id=replyform data-thread="${esc(th.id)}" data-board="${esc(th.board)}">
        <textarea id=replybody maxlength=20000 placeholder="Write a reply… (posted on-chain via MELEK-Signer)"></textarea>
        <button class="btn primary" type=submit>Sign &amp; post reply</button>
        <span class=muted style="font-size:12px;margin-left:8px">Keyless — signed in your browser.</span>
      </form></div>
    ${threadClientScript(th)}`;
  return page(`${th.title} — ${SITE_NAME}`, body, { canonical: `${BASE_URL}/t/${th.id}` });
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
  const body_ = `<p class=muted><a href="/b/${esc(bid)}">← ${esc(meta ? meta.title : 'General')}</a></p>
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
  return page(`New thread — ${SITE_NAME}`, body_, { canonical: `${BASE_URL}/post`, robots: 'noindex,follow' });
}

// ── /search ─────────────────────────────────────────────────────────────────────────────────────
export async function searchPage(q) {
  const query = String(q ?? '').trim();
  const results = query ? await forum.search(query) : [];
  const rows = query
    ? (results.length
      ? results.map((t) => `<div class=trow>
          <div><div class=t><a href="/t/${esc(t.id)}">${esc(t.title)}</a></div>
            <div class=meta>in <a href="/b/${esc(t.board)}">${esc(t.board)}</a> · by @${esc(t.author)}</div></div>
          <div class=stat>${esc(t.replyCount)} replies</div></div>`).join('')
      : `<p class=muted>No threads matched “${esc(query)}”.</p>`)
    : `<p class=muted>Type a query to search threads.</p>`;
  const body = `<h1>Search</h1>${searchForm(query)}<div class=card>${rows}</div>`;
  return page(query ? `“${query}” — ${SITE_NAME} search` : `Search — ${SITE_NAME}`, body,
    { canonical: `${BASE_URL}/search`, robots: 'noindex,follow' });
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/', '/search', ...forum.boards().flatMap((g) => g.boards).map((b) => `/b/${b.id}`)];

export async function handler(req, res) {
  try {
    await seed();
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: u === '/' ? 'daily' : 'weekly', priority: u === '/' ? '1.0' : '0.7' }));
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, entries));
    }
    if (path === '/sitemap-index.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10)));
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

    if (path.startsWith('/b/')) {
      const view = await boardPage(decodeURIComponent(path.slice(3).replace(/\/$/, '')));
      if (!view) { res.writeHead(302, { location: '/' }); return res.end(); }
      return sendHtml(res, view.html);
    }

    if (path.startsWith('/t/')) {
      const html = await threadPage(decodeURIComponent(path.slice(3).replace(/\/$/, '')));
      if (!html) { res.writeHead(302, { location: '/' }); return res.end(); }
      return sendHtml(res, html);
    }

    res.writeHead(302, { location: '/' });
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
