// site/pact/server.mjs — PACT. Groups and Clubs, at pact.pentecaust.com.
//
// ⭐ WHY THIS IS ITS OWN SERVICE AND NOT PART OF THE MESSENGER.
// Groups were briefly mounted on Pentecaust and that was wrong: Pentecaust is the MESSENGER, and
// .local/GROUPS_SOLUTION_DESIGN.md §2.1 gives it exactly one role in this architecture — the chat
// channel `group:<id>`. The directory, the roster and the feed belong on their own surface. This is it.
//
// A PACT is a binding agreement between people: it has terms (the charter), it has what you pay into
// it (dues), and breaking it has degrees. That is the whole product in one word, and it means the
// charter and the dues do not need names of their own.
//
// IDENTITY comes from Pentecaust by signed ticket — the same handoff Herald uses. Both now sit under
// pentecaust.com, so a cookie scoped to the parent WOULD work and tickets would be unnecessary.
// ⚠️ We keep the tickets anyway: a `.pentecaust.com` cookie is sent to EVERY subdomain including ones
// that do not exist yet, so one XSS anywhere in the family would take all of it. Separate sessions,
// independently revocable, is worth more than the simplification.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { handler as ssoHandler, sessionFromCookie, selfOriginFor } from '../../pentecaust/sso.mjs';
import { handler as groupsHandler } from '../../pentecaust/groups/server.mjs';
import { handler as pagesHandler } from '../../pentecaust/pages/server.mjs';
import { robotsTxt, sitemapXml } from '../../integrations/soapbox/crawlers.mjs';

const PORT = +(process.env.PORT || 8175);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const whoami = (req) => {
  const s = sessionFromCookie((req && req.headers && req.headers.cookie) || '');
  return s && s.account ? s.account : null;
};

const STYLE = `<style>
 :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;
   --flame:#ff8c2b;--ember:#e0453a;--ash:#6b4a8f}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);
   font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:16px}
 .wrap{max-width:820px;margin:0 auto}
 header{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
 .brand{font-size:22px;font-weight:800;display:inline-flex;align-items:center;gap:8px}
 .brand b{background:linear-gradient(95deg,var(--flame),var(--ember) 60%,var(--ash));
   -webkit-background-clip:text;background-clip:text;color:transparent}
 .mark{width:22px;height:22px;filter:drop-shadow(0 0 6px rgba(255,140,43,.45))}
 .authbar{margin-left:auto;display:inline-flex;gap:8px;align-items:center;font-size:13px}
 .btn{padding:8px 12px;border-radius:9px;border:1px solid var(--bd);background:#0e131b;color:var(--fg);
   font:inherit;font-weight:700;cursor:pointer;text-decoration:none;white-space:nowrap}
 .btn.primary{background:var(--flame);color:#1a1006;border-color:var(--flame)}
 .card{background:var(--panel);border:1px solid var(--bd);border-radius:14px;padding:14px;margin-bottom:12px}
 .lead{color:var(--mut);max-width:60ch}
 .row{display:flex;gap:8px;flex-wrap:wrap}.row>input{flex:1;min-width:180px}
 input,select{padding:9px 11px;border:1px solid var(--bd);border-radius:9px;background:#0e131b;
   color:var(--fg);font:inherit}
 .item{display:flex;gap:10px;align-items:center;border:1px solid var(--bd);border-radius:11px;
   padding:10px 12px;margin-top:8px}
 .chip{font-size:11px;border:1px solid var(--bd);border-radius:999px;padding:2px 8px;color:var(--mut)}
 .mut{color:var(--mut)}
 footer{color:var(--mut);font-size:12px;margin-top:22px}
 a{color:var(--gold)}
</style>`;

const MARK = `<svg class=mark viewBox="0 0 24 28" aria-hidden="true"><defs><linearGradient id="fl" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#e0453a"/><stop offset=".55" stop-color="#ff8c2b"/><stop offset="1" stop-color="#ffd76a"/></linearGradient></defs><path fill="url(#fl)" d="M12 0c1.6 5.2-3.1 6.9-3.1 11.2 0 1.6.8 2.9 1.9 3.6-.5-2.6.7-4.4 2.2-5.6-.4 2.7 1.1 3.7 2.4 5.3 1.4 1.7 2.1 3.4 2.1 5.1C17.5 24.2 14.9 28 12 28S6.5 24.2 6.5 19.6c0-2.3.9-4.1 2.1-5.8C6.2 15.1 4 17.9 4 21.1 4 25.4 7.6 28 12 28s8-2.6 8-6.9C20 13.6 12.9 10.4 12 0z"/></svg>`;

function page(who) {
  const auth = who
    ? `<span class=authbar>@${esc(who)} <a class=btn href="/auth/logout">Log out</a></span>`
    : '<span class=authbar><a class="btn primary" href="/auth/login">Sign in with MELEK</a></span>';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Pact — groups and clubs</title>
<meta name=description content="Pact — groups and clubs on MELEK. A pact has terms, members, and what you put into it.">
<meta name=theme-color content="#0b0d12">${STYLE}</head><body><div class=wrap>
<header><span class=brand>${MARK}<b>Pact</b></span>${auth}</header>
<p class=lead>A pact is a binding agreement between people. It has terms, it has members, and it has
what you put into it. A <b>group</b> is a pact anyone can join; a <b>club</b> is one with dues.</p>
<div class=card>
  <div class=row>
    <input id=name placeholder="Name a pact" autocapitalize=off>
    <select id=policy><option value=open>Open</option><option value=apply>Apply</option>
      <option value=invite>Invite only</option><option value=dues>Club — dues</option></select>
    <button class="btn primary" id=make>Create</button>
  </div>
  <div id=list></div>
</div>
<footer>Pact · part of <a href="https://pentecaust.com">Pentecaust</a></footer>
</div>
<script>
const $=id=>document.getElementById(id);
const E=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(p,o)=>{try{const r=await fetch(p,o);return await r.json();}catch(e){return{ok:false,reason:'network'};}};
const SIGNED=${who ? 'true' : 'false'};
async function load(){const j=await api('/groups');const gs=(j&&j.groups)||[];
 const mine=SIGNED?(((await api('/me/groups'))||{}).groups||[]):[];
 const ids=new Set(mine.map(g=>g.id));
 if(!gs.length){$('list').innerHTML='<p class=mut>No pacts yet. Make the first one.</p>';return;}
 $('list').innerHTML=gs.map(g=>{
  const d=g.dues?(' · '+(g.dues.amount/100).toFixed(2)+' '+E(g.dues.currency)+'/'+E(g.dues.period)):'';
  return '<div class=item><div style="flex:1"><b>'+E(g.name)+'</b> <span class=chip>'+E(g.joinPolicy)+'</span>'+d
   +'<br><span class=mut>'+E(g.about||'')+' '+(g.members?g.members.length:0)+' member(s)</span></div>'
   +(ids.has(g.id)?'<span class=chip>joined</span>':'<button class=btn data-j="'+E(g.id)+'">Join</button>')+'</div>';}).join('');
 for(const b of document.querySelectorAll('[data-j]'))b.onclick=async()=>{
  const r=await api('/groups/'+encodeURIComponent(b.dataset.j)+'/join',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  if(r&&r.ok)load();else alert((r&&r.reason)||'could not join');};}
$('make').onclick=async()=>{const name=$('name').value.trim();if(!name)return;
 const r=await api('/groups',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,joinPolicy:$('policy').value})});
 if(r&&r.ok){$('name').value='';load();}else alert((r&&r.reason)||'could not create');};
load();
</script></body></html>`;
}

export async function handler(req, res) {
  try {
    const path = (String((req && req.url) || '/').split('?')[0] || '/').replace(/\/+$/, '') || '/';
    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(sitemapXml([{ loc: `${BASE_URL}/` }])); }

    if (path.startsWith('/auth/')) {
      return ssoHandler(req, res, { selfOrigin: selfOriginFor(req, BASE_URL), idpOrigin: process.env.SSO_IDP_ORIGIN || 'https://pentecaust.com' });
    }
    if (path === '/groups' || path.startsWith('/groups/') || path === '/me/groups') {
      return groupsHandler(req, res, { whoami });
    }
    if (path === '/pages' || path.startsWith('/pages/') || path.startsWith('/p/')) {
      return pagesHandler(req, res, { whoami });
    }
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(page(whoami(req)));
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, reason: 'not-found' }));
  } catch {
    res.writeHead(500, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, reason: 'error' }));
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`Pact on http://${HOST}:${PORT} (${BASE_URL})`));
}
