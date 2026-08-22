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
        <span title="likes">♡ ${votes}</span>
        <span title="replies">💬 ${p.children || 0}</span>
        ${payout(p) ? `<span class=payout title="pending payout">${esc(payout(p))}</span>` : ''}
      </div>
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
 .pactions{display:flex;gap:20px;margin-top:8px;color:var(--mut);font-size:13px} .payout{color:var(--gold)}
 .empty{padding:40px 16px;text-align:center;color:var(--mut)} #msg{padding:0 16px;font-size:13px;min-height:16px}
 .backlink{padding:12px 16px;border-bottom:1px solid var(--line)} .backlink a{color:var(--blue)}
</style>`;

function page(title, inner, { canonical = BASE_URL, description = '' } = {}) {
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name=description content="${esc(description || 'Congress — a short-form social network on the MELEK chain (alpha / testnet).')}">
<link rel=canonical href="${esc(canonical)}">${STYLE}</head><body><div class=wrap>
<header class=top><a class=brand href="/">⬡ <b>Congress</b></a><span class=alpha>ALPHA · TESTNET</span>
  <a class=sub href="${esc(PENTECAUST_URL)}" title="Private messages run through Pentecaust">✉ Messages</a></header>
${inner}
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
   var SIGNER=${JSON.stringify(SIGNER_URL)},APP=${JSON.stringify(APP_NAME)},TAG=${JSON.stringify(TAG)};
   var TOKEN=null,ACCT=null;
   try{TOKEN=localStorage.getItem('congress_tok');ACCT=localStorage.getItem('congress_acct');}catch(e){}
   function setWho(){var w=document.getElementById('who');w.textContent='';var b=document.createElement('b');if(ACCT){w.append('Posting as ');b.textContent='@'+ACCT;w.append(b);}else{w.append('Post keylessly via ');b.textContent='Login with MELEK';w.append(b);}}
   setWho();
   document.getElementById('send').onclick=async function(){
     var box=document.getElementById('box'),m=document.getElementById('msg');
     var text=box.value.trim(); if(!text){return;}
     if(!TOKEN){ // send them to Login with MELEK, come back with a scoped comment token
       var redir=location.origin+'/';
       location.href=SIGNER+'/oauth2/authorize?client_id='+encodeURIComponent(APP)+'&scope=comment&redirect_uri='+encodeURIComponent(redir);
       return;
     }
     m.style.color='#8896a6';m.textContent='Posting…';
     var permlink='c-'+Date.now();
     var op=['comment',{parent_author:'',parent_permlink:TAG,author:ACCT,permlink:permlink,title:'',body:text,json_metadata:JSON.stringify({app:'congress',tags:[TAG]})}];
     try{
       var r=await fetch(SIGNER+'/v1/broadcast',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+TOKEN},body:JSON.stringify({ops:[op],client_ref:'congress-post'})});
       var j=await r.json().catch(function(){return{};});
       if(r.ok&&j.ok){m.style.color='#1d9bf0';m.textContent='✓ Posted. Refreshing…';setTimeout(function(){location.reload();},1500);}
       else{m.style.color='#f85149';m.textContent='✕ '+(j.error||'could not post');}
     }catch(e){m.style.color='#f85149';m.textContent='✕ could not reach the signer';}
   };
   // capture ?code= from the signer redirect -> exchange for a token
   (async function(){var u=new URL(location.href);var code=u.searchParams.get('code');if(!code)return;
     try{var r=await fetch(SIGNER+'/oauth2/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:code,client_id:APP})});
       var j=await r.json();if(j.access_token){TOKEN=j.access_token;ACCT=(j.account||'').toLowerCase();
         try{localStorage.setItem('congress_tok',TOKEN);localStorage.setItem('congress_acct',ACCT);}catch(e){}
         setWho();history.replaceState({},'',location.pathname);}}catch(e){}
   })();
  </script>`;
}

// ── pages ─────────────────────────────────────────────────────────────────────────────────────────
export async function homePage() {
  const posts = await timeline();
  const feed = posts.length
    ? posts.map(postCard).join('')
    : `<div class=empty>No posts yet under <b>#${esc(TAG)}</b>.<br>Be the first — compose above.<br><span style="font-size:12px">(or the testnet RPC is unreachable right now)</span></div>`;
  return page('Congress — on-chain social (alpha)', composer() + feed,
    { canonical: BASE_URL, description: 'Congress: a short-form, on-chain social network on the MELEK chain. Alpha / testnet.' });
}
export async function profilePage(author) {
  const posts = await byAuthor(author);
  const feed = posts.length ? posts.map(postCard).join('') : `<div class=empty>@${esc(author)} has no posts yet.</div>`;
  return page(`@${author} — Congress`, `<div class=backlink><a href="/">← timeline</a></div>
    <div class=composer style="background:transparent"><div class=phead><span class=author style="font-size:18px">@${esc(author)}</span></div></div>${feed}`,
    { canonical: `${BASE_URL}/@${encodeURIComponent(author)}` });
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
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(`User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`); }
    if (path === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${BASE_URL}/</loc></url></urlset>`);
    }
    if (path === '/' ) return send(res, await homePage());
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
