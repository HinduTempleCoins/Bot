// server.mjs — Congress.ink (alpha.congress.ink). A Graphene "Twitter/X clone" — a short-form social
// front-end reading the MELEK TESTNET chain, in the SoapBox house style (mirrors site/hemp, site/witness).
// Timeline is server-rendered from the chain (SSR, SEO-friendly, no key); composing/replying/liking is
// done keylessly through MELEK-Signer ("Login with MELEK") client-side. Read-only server: holds no key,
// signs nothing, broadcasts nothing.
//
//   PORT=8155 BASE_URL=https://alpha.congress.ink node site/congress/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            the timeline — recent short posts under the congress tag (SSR from the testnet) + composer
//   /@:author    a profile: that account's recent posts
//   /post/:author/:permlink  a single post + its replies
//   /health      liveness probe
//   /robots.txt /sitemap.xml
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   ALPHA / TESTNET — every page is badged testnet (no real value). Timeline shows ONLY what the live
//   testnet RPC returns; on an unreachable RPC it says so and never invents a post. esc() on every
//   interpolated value. Compose is keyless via MELEK-Signer — the server never sees a key. Soft-fail:
//   every route renders even when the chain returns nothing.
import { createServer } from 'node:http';

const PORT = +(process.env.PORT || 8155);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://alpha.congress.ink').replace(/\/$/, '');
// MELEK TESTNET RPC (this is the alpha/testnet social clone).
const RPC_URL = process.env.CONGRESS_RPC_URL || 'https://alpha.melek.salon/rpc';
const SIGNER_URL = (process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon').replace(/\/$/, '');
const TAG = process.env.CONGRESS_TAG || 'congress';
const APP_NAME = 'congress';
// Congress private messages (DMs) route through Pentecaust — one MELEK identity, existing PM/DM system.
const PENTECAUST_URL = (process.env.PENTECAUST_URL || 'https://pentecaust.com').replace(/\/$/, '');

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── chain read (soft-fail: null/[] on any problem) ────────────────────────────────────────────────
async function rpc(method, params) {
  try {
    const res = await _fetch(RPC_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res || !res.ok) return null;
    const j = await res.json();
    return j && j.result != null ? j.result : null;
  } catch { return null; }
}

/** Recent posts under the tag (the timeline). Soft-fail to []. */
export async function timeline(tag = TAG, limit = 30) {
  const r = await rpc('condenser_api.get_discussions_by_created', [{ tag, limit }]);
  return Array.isArray(r) ? r : [];
}
/** One account's recent posts. */
export async function byAuthor(author, limit = 30) {
  const r = await rpc('condenser_api.get_discussions_by_blog', [{ tag: author, limit }]);
  return Array.isArray(r) ? r : [];
}
/** A single post + replies. */
export async function thread(author, permlink) {
  const post = await rpc('condenser_api.get_content', [author, permlink]);
  const replies = await rpc('condenser_api.get_content_replies', [author, permlink]);
  return { post: post && post.author ? post : null, replies: Array.isArray(replies) ? replies : [] };
}

// ── render helpers ────────────────────────────────────────────────────────────────────────────────
function ago(iso) {
  const t = Date.parse((iso || '') + 'Z') || Date.parse(iso || '');
  if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return `${s | 0}s`;
  if (s < 3600) return `${(s / 60) | 0}m`;
  if (s < 86400) return `${(s / 3600) | 0}h`;
  return `${(s / 86400) | 0}d`;
}
function body(p) {
  // short-form: strip markdown/html noise, cap length like a microblog.
  let t = String(p.body || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<[^>]+>/g, ' ')
    .replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > 480 ? t.slice(0, 477) + '…' : t;
}
function payout(p) {
  const n = parseFloat(p.pending_payout_value || '0') || 0;
  return n > 0 ? `${n.toFixed(2)} TBD` : '';
}
function postCard(p) {
  const author = esc(p.author);
  const votes = Array.isArray(p.active_votes) ? p.active_votes.length : (p.net_votes || 0);
  return `<article class=post>
    <div class=avatar>${author.slice(0, 2).toUpperCase()}</div>
    <div class=pbody>
      <div class=phead><a class=author href="/@${author}">@${author}</a>
        <span class=dot>·</span><a class=time href="/post/${author}/${esc(p.permlink)}">${esc(ago(p.created))}</a></div>
      ${p.title && p.title.trim() ? `<div class=ptitle>${esc(p.title)}</div>` : ''}
      <div class=ptext>${esc(body(p))}</div>
      <div class=pactions>
        <button class=act data-act=reply data-author="${author}" data-permlink="${esc(p.permlink)}" title="reply">💬 ${p.children || 0}</button>
        <button class=act data-act=like data-author="${author}" data-permlink="${esc(p.permlink)}" title="like">♡ <span class=cnt>${votes}</span></button>
        ${payout(p) ? `<span class=payout title="pending payout">${esc(payout(p))}</span>` : ''}
      </div>
      <div class=replybox hidden></div>
    </div>
  </article>`;
}

const STYLE = `<style>
 :root{--bg:#0b0d12;--panel:#141a24;--panel2:#0f141d;--line:#232c3a;--fg:#e9eef5;--mut:#8896a6;--blue:#1d9bf0;--gold:#d9a441}
 *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
 a{color:inherit;text-decoration:none} .wrap{max-width:620px;margin:0 auto;border-left:1px solid var(--line);border-right:1px solid var(--line);min-height:100vh}
 header.top{position:sticky;top:0;background:rgba(11,13,18,.85);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;align-items:center;gap:10px;z-index:5}
 .brand{font-weight:800;font-size:19px;color:var(--gold)} .brand b{color:var(--fg)}
 .alpha{font-size:11px;font-weight:700;color:#1a1305;background:var(--gold);border-radius:6px;padding:2px 6px;margin-left:2px}
 .sub{color:var(--mut);font-size:12px;margin-left:auto}
 .composer{padding:14px 16px;border-bottom:1px solid var(--line);background:var(--panel2)}
 .composer textarea{width:100%;background:transparent;border:0;color:var(--fg);font:16px/1.4 inherit;resize:vertical;min-height:54px;outline:none}
 .crow{display:flex;align-items:center;gap:10px;margin-top:8px} .crow .mut{color:var(--mut);font-size:12px}
 button.post-btn{margin-left:auto;background:var(--blue);color:#fff;border:0;border-radius:999px;padding:8px 18px;font-weight:700;cursor:pointer}
 button.post-btn:disabled{opacity:.5;cursor:default}
 .post{display:flex;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line)}
 .post:hover{background:#0e131b} .avatar{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#1d9bf0,#d9a441);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex:0 0 auto}
 .pbody{flex:1;min-width:0} .phead{display:flex;align-items:center;gap:6px;font-size:14px} .author{font-weight:700} .time,.dot{color:var(--mut)}
 .ptitle{font-weight:700;margin:2px 0} .ptext{margin-top:2px;white-space:pre-wrap;word-wrap:break-word}
 .pactions{display:flex;gap:20px;margin-top:8px;font-size:13px} .payout{color:var(--gold)}
 button.act{background:none;border:0;color:var(--mut);font:inherit;font-size:13px;cursor:pointer;padding:2px 4px;border-radius:6px}
 button.act:hover{color:var(--blue);background:#0e131b} button.act.liked{color:#f4245e}
 .replybox{margin-top:8px} .replybox textarea{width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:10px;color:var(--fg);font:15px/1.4 inherit;padding:8px;min-height:44px;outline:none}
 .replybox .crow{margin-top:6px}
 .empty{padding:40px 16px;text-align:center;color:var(--mut)} #msg{padding:0 16px;font-size:13px;min-height:16px}
 .backlink{padding:12px 16px;border-bottom:1px solid var(--line)} .backlink a{color:var(--blue)}
 nav.tabs{display:flex;border-bottom:1px solid var(--line);position:sticky;top:49px;background:rgba(11,13,18,.85);backdrop-filter:blur(8px);z-index:4}
 nav.tabs a{flex:1;text-align:center;padding:12px;color:var(--mut);font-weight:700;font-size:14px} nav.tabs a:hover{background:#0e131b;color:var(--fg)} nav.tabs a.on{color:var(--fg);box-shadow:inset 0 -3px 0 var(--blue)}
 form.search{padding:12px 16px;border-bottom:1px solid var(--line)} form.search input{width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:999px;color:var(--fg);font:15px inherit;padding:9px 14px;outline:none}
 .toast{position:fixed;left:50%;transform:translateX(-50%);bottom:20px;background:var(--blue);color:#fff;padding:10px 18px;border-radius:999px;font-weight:600;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:9} .toast.show{opacity:1}
</style>`;

function navBar(active = '') {
  const tab = (href, label, key) => `<a class="${active === key ? 'on' : ''}" href="${href}">${label}</a>`;
  return `<nav class=tabs>${tab('/', 'Home', 'home')}${tab('/search', 'Search', 'search')}${tab(PENTECAUST_URL, 'Messages', 'msg')}</nav>`;
}

// Shared client script on EVERY page: MELEK-Signer session (capture ?code=, exchange, remember) + the
// keyless like / reply actions wired to /v1/broadcast. Compose adds its own bits on top (window.CONGRESS).
function clientScript() {
  return `<div class=toast id=toast></div><script>
   window.CONGRESS=(function(){
     var SIGNER=${JSON.stringify(SIGNER_URL)},APP=${JSON.stringify(APP_NAME)},TAG=${JSON.stringify(TAG)};
     var TOKEN=null,ACCT=null;
     try{TOKEN=localStorage.getItem('congress_tok');ACCT=localStorage.getItem('congress_acct');}catch(e){}
     function toast(t){var el=document.getElementById('toast');if(!el)return;el.textContent=t;el.classList.add('show');setTimeout(function(){el.classList.remove('show');},2200);}
     function login(scope){var redir=location.origin+location.pathname;location.href=SIGNER+'/oauth2/authorize?client_id='+encodeURIComponent(APP)+'&scope='+encodeURIComponent(scope)+'&redirect_uri='+encodeURIComponent(redir);}
     async function broadcast(ops,ref){
       if(!TOKEN){login('vote comment');return {ok:false,login:true};}
       try{var r=await fetch(SIGNER+'/v1/broadcast',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+TOKEN},body:JSON.stringify({ops:ops,client_ref:ref})});
         var j=await r.json().catch(function(){return{};});return r.ok&&j.ok?{ok:true,result:j.result}:{ok:false,error:(j&&j.error)||'broadcast failed'};}
       catch(e){return {ok:false,error:'could not reach the signer'};}
     }
     async function like(author,permlink,btn){
       if(!TOKEN){toast('Sign in to like');login('vote comment');return;}
       toast('Liking…');
       var op=['vote',{voter:ACCT,author:author,permlink:permlink,weight:10000}];
       var res=await broadcast([op],'congress-like');
       if(res.ok){btn.classList.add('liked');var c=btn.querySelector('.cnt');if(c)c.textContent=(+c.textContent+1);toast('♥ Liked');}
       else if(!res.login)toast('✕ '+(res.error||'could not like'));
     }
     async function reply(author,permlink,text,cb){
       if(!text.trim())return;
       if(!TOKEN){toast('Sign in to reply');login('vote comment');return;}
       toast('Replying…');
       var permlink2='re-'+Date.now();
       var op=['comment',{parent_author:author,parent_permlink:permlink,author:ACCT,permlink:permlink2,title:'',body:text,json_metadata:JSON.stringify({app:'congress',tags:[TAG]})}];
       var res=await broadcast([op],'congress-reply');
       if(res.ok){toast('✓ Replied');cb&&cb();}else if(!res.login)toast('✕ '+(res.error||'could not reply'));
     }
     // capture the signer redirect once, anywhere
     (async function(){var u=new URL(location.href);var code=u.searchParams.get('code');if(!code)return;
       try{var r=await fetch(SIGNER+'/oauth2/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:code,client_id:APP})});
         var j=await r.json();if(j.access_token){TOKEN=j.access_token;ACCT=(j.account||'').toLowerCase();
           try{localStorage.setItem('congress_tok',TOKEN);localStorage.setItem('congress_acct',ACCT);}catch(e){}
           history.replaceState({},'',location.pathname);document.dispatchEvent(new Event('congress-auth'));}}catch(e){}
     })();
     // wire like + reply buttons (event delegation, works for every post card)
     document.addEventListener('click',function(e){
       var b=e.target.closest&&e.target.closest('button.act');if(!b)return;
       var a=b.getAttribute('data-author'),p=b.getAttribute('data-permlink');
       if(b.getAttribute('data-act')==='like'){like(a,p,b);return;}
       if(b.getAttribute('data-act')==='reply'){
         var box=b.closest('.pbody').querySelector('.replybox');if(!box)return;
         if(!box.hidden){box.hidden=true;box.innerHTML='';return;}
         box.hidden=false;box.innerHTML='<textarea maxlength=480 placeholder="Post your reply"></textarea><div class=crow><button class="post-btn" data-send>Reply</button></div>';
         var ta=box.querySelector('textarea');ta.focus();
         box.querySelector('[data-send]').onclick=function(){reply(a,p,ta.value,function(){box.hidden=true;box.innerHTML='';setTimeout(function(){location.reload();},1200);});};
       }
     });
     return {get token(){return TOKEN;},get acct(){return ACCT;},login:login,broadcast:broadcast,toast:toast};
   })();
  </script>`;
}

function page(title, inner, { canonical = BASE_URL, description = '', nav = '' } = {}) {
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name=description content="${esc(description || 'Congress — a short-form social network on the MELEK chain (alpha / testnet).')}">
<link rel=canonical href="${esc(canonical)}"><link rel=icon href="/favicon.svg">${STYLE}</head><body><div class=wrap>
<header class=top><a class=brand href="/">⬡ <b>Congress</b></a><span class=alpha>ALPHA · TESTNET</span>
  <a class=sub href="${esc(PENTECAUST_URL)}" title="Private messages run through Pentecaust">✉ Messages</a></header>
${navBar(nav)}
${inner}
${clientScript()}
</div></body></html>`;
}

function composer() {
  return `<div class=composer>
    <textarea id=box maxlength=480 placeholder="What's happening on-chain?"></textarea>
    <div class=crow>
      <span class=mut id=who>Post keylessly via <b>Login with MELEK</b></span>
      <button class=post-btn id=send>Post</button>
    </div>
  </div><p id=msg></p>
  <script>
   // uses the shared window.CONGRESS session (defined by clientScript() at page bottom).
   var TAG=${JSON.stringify(TAG)};
   function setWho(){var C=window.CONGRESS,w=document.getElementById('who');if(!w)return;w.textContent='';var b=document.createElement('b');if(C&&C.acct){w.append('Posting as ');b.textContent='@'+C.acct;w.append(b);}else{w.append('Post keylessly via ');b.textContent='Login with MELEK';w.append(b);}}
   document.addEventListener('congress-auth',setWho);setTimeout(setWho,0);
   document.getElementById('send').onclick=async function(){
     var box=document.getElementById('box'),m=document.getElementById('msg'),C=window.CONGRESS;
     var text=box.value.trim(); if(!text){return;}
     if(!C||!C.token){C&&C.login('vote comment');return;}
     m.style.color='#8896a6';m.textContent='Posting…';
     var op=['comment',{parent_author:'',parent_permlink:TAG,author:C.acct,permlink:'c-'+Date.now(),title:'',body:text,json_metadata:JSON.stringify({app:'congress',tags:[TAG]})}];
     var res=await C.broadcast([op],'congress-post');
     if(res.ok){m.style.color='#1d9bf0';m.textContent='✓ Posted. Refreshing…';setTimeout(function(){location.reload();},1500);}
     else if(!res.login){m.style.color='#f85149';m.textContent='✕ '+(res.error||'could not post');}
   };
  </script>`;
}

// ── pages ─────────────────────────────────────────────────────────────────────────────────────────
export async function homePage() {
  const posts = await timeline();
  const feed = posts.length
    ? posts.map(postCard).join('')
    : `<div class=empty>No posts yet under <b>#${esc(TAG)}</b>.<br>Be the first — compose above.<br><span style="font-size:12px">(or the testnet RPC is unreachable right now)</span></div>`;
  return page('Congress — on-chain social (alpha)', composer() + feed,
    { canonical: BASE_URL, nav: 'home', description: 'Congress: a short-form, on-chain social network on the MELEK chain. Alpha / testnet.' });
}
export async function profilePage(author) {
  const posts = await byAuthor(author);
  const feed = posts.length ? posts.map(postCard).join('') : `<div class=empty>@${esc(author)} has no posts yet.</div>`;
  return page(`@${author} — Congress`, `<div class=backlink><a href="/">← timeline</a></div>
    <div class=composer style="background:transparent"><div class=phead><span class=author style="font-size:18px">@${esc(author)}</span></div></div>${feed}`,
    { canonical: `${BASE_URL}/@${encodeURIComponent(author)}` });
}
/** Search: a query is treated as a tag (Graphene's native index). Empty query → the search box only. */
export async function searchPage(q = '') {
  const query = String(q || '').trim().toLowerCase().replace(/[^a-z0-9\-]/g, '');
  const box = `<form class=search method=get action="/search"><input name=q value="${esc(q)}" placeholder="Search a tag (e.g. politics, beauty, congress)" autocomplete=off></form>`;
  if (!query) return page('Search — Congress', box + `<div class=empty>Search posts by tag.</div>`, { canonical: `${BASE_URL}/search`, nav: 'search' });
  const posts = await timeline(query, 30);
  const feed = posts.length ? posts.map(postCard).join('') : `<div class=empty>No posts found under <b>#${esc(query)}</b>.</div>`;
  return page(`#${query} — Congress`, box + feed, { canonical: `${BASE_URL}/search?q=${encodeURIComponent(query)}`, nav: 'search' });
}
export async function postPage(author, permlink) {
  const { post, replies } = await thread(author, permlink);
  if (!post) return page('Post not found — Congress', `<div class=backlink><a href="/">← timeline</a></div><div class=empty>Post not found.</div>`);
  const repliesHtml = replies.length ? replies.map(postCard).join('') : `<div class=empty>No replies yet.</div>`;
  return page(`@${author} on Congress`, `<div class=backlink><a href="/">← timeline</a></div>${postCard(post)}
    <div class=backlink style="border-top:1px solid var(--line)">Replies</div>${repliesHtml}`,
    { canonical: `${BASE_URL}/post/${encodeURIComponent(author)}/${encodeURIComponent(permlink)}` });
}

function send(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = decodeURIComponent(url.pathname);
    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/favicon.ico' || path === '/favicon.svg') {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0b0d12"/><text x="16" y="23" font-size="22" text-anchor="middle" fill="#d9a441">⬡</text></svg>`;
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public,max-age=86400' });
      return res.end(svg);
    }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(`User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`); }
    if (path === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${BASE_URL}/</loc></url></urlset>`);
    }
    if (path === '/' ) return send(res, await homePage());
    if (path === '/search') return send(res, await searchPage(url.searchParams.get('q') || ''));
    let m;
    if ((m = path.match(/^\/@([a-z0-9.\-]{1,32})$/))) return send(res, await profilePage(m[1]));
    if ((m = path.match(/^\/post\/([a-z0-9.\-]{1,32})\/([a-z0-9\-]{1,255})$/))) return send(res, await postPage(m[1], m[2]));
    return send(res, page('Not found — Congress', `<div class=empty>Not found. <a href="/" style="color:var(--blue)">← timeline</a></div>`), 404);
  } catch (e) {
    return send(res, page('Congress', `<div class=empty>Something went wrong. <a href="/" style="color:var(--blue)">← timeline</a></div>`), 500);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  createServer(handler).listen(PORT, HOST, () => console.log(`congress (alpha/testnet) on http://${HOST}:${PORT}  rpc=${RPC_URL}`));
}
