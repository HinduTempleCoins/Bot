// pentecaust/notifications-page.mjs — the Pentecaust Notifications page (GET /notifications).
//
// Reached from the ✉ letter icon in the nav bar, which carries the unread count. Lists one row per
// unread DM thread, newest first; clicking a row marks that thread read and opens it in the
// messenger via the deep link the messenger already understands (`/?dm=<account>`).
//
// All data comes from GET /notifications/feed (session-cookie authenticated). Nothing is rendered
// from a URL parameter, and every value from the feed is escaped client-side before it reaches the
// DOM — a message body is user-supplied text.
//
// House style: one exported page function returning a complete HTML document, no build step.

export function notificationsPage() {
  return `<!doctype html><html lang=en><head>
<meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Notifications — Pentecaust</title>
<meta name=robots content="noindex">
<style>
 :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;--green:#36c08a;--blue:#4c8dff;
   --flame:#ff8c2b;--ember:#e0453a;--ash:#6b4a8f}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:14px}
 .wrap{max-width:880px;margin:0 auto}
 header{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}
 .brand{font-size:20px;font-weight:800;display:inline-flex;align-items:center;gap:8px}.brand b{color:var(--gold)}
 .mark{width:22px;height:22px;flex:0 0 22px;filter:drop-shadow(0 0 6px rgba(255,140,43,.45))}
 .card{background:var(--panel);border:1px solid var(--bd);border-radius:14px;padding:14px}
 .btn{padding:9px 12px;border-radius:9px;border:1px solid var(--bd);background:#0e131b;color:var(--fg);font:inherit;font-weight:700;cursor:pointer;white-space:nowrap}
 .btn.primary{background:var(--gold);color:#1a1306;border-color:var(--gold)}
 .btn:disabled{opacity:.5}
 .top{display:flex;align-items:center;gap:10px;justify-content:space-between;margin:10px 0 14px;flex-wrap:wrap}
 h1{font-size:18px;margin:0;display:inline-flex;align-items:center;gap:8px}
 .pill{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 7px;border-radius:999px;background:var(--ember);color:#fff;font-size:12px;font-weight:800}
 ul{list-style:none;margin:0;padding:0}
 li.n{display:flex;gap:11px;align-items:flex-start;padding:12px;border:1px solid var(--bd);border-radius:12px;background:#0e131b;margin-bottom:9px;cursor:pointer}
 li.n:hover{border-color:var(--gold)}
 .av{flex:0 0 36px;width:36px;height:36px;border-radius:50%;background:var(--ash);display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;text-transform:uppercase}
 .body{flex:1 1 auto;min-width:0}
 .who{font-weight:800;color:var(--gold)}
 .txt{color:var(--fg);overflow-wrap:anywhere;margin-top:2px}
 .meta{color:var(--mut);font-size:12px;margin-top:3px}
 .side{flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
 .empty{color:var(--mut);text-align:center;padding:26px 10px}
 a.back{color:var(--blue);text-decoration:none;font-weight:700}
 /* same line-drawn letter as the nav tab — stroke only, no filled-in colour glyph */
 .ico{width:17px;height:17px;vertical-align:-3px;margin-right:7px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round}
 @media(max-width:520px){ body{padding:10px} li.n{padding:10px} }
</style></head><body><div class=wrap>

<header>
 <span class=brand><svg class=mark viewBox="0 0 24 28" aria-hidden="true"><defs><linearGradient id="fl" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#e0453a"/><stop offset=".55" stop-color="#ff8c2b"/><stop offset="1" stop-color="#ffd76a"/></linearGradient></defs><path fill="url(#fl)" d="M12 0c1.6 5.2-3.1 6.9-3.1 11.2 0 1.6.8 2.9 1.9 3.6-.5-2.6.7-4.4 2.2-5.6-.4 2.7 1.1 3.7 2.4 5.3 1.4 1.7 2.1 3.4 2.1 5.1C17.5 24.2 14.9 28 12 28S6.5 24.2 6.5 19.6c0-2.3.9-4.1 2.1-5.8C6.2 15.1 4 17.9 4 21.1 4 25.4 7.6 28 12 28s8-2.6 8-6.9C20 13.6 12.9 10.4 12 0z"/></svg><b>Pentecaust</b> Notifications</span>
</header>

<div class=top>
 <h1><svg class=ico viewBox="0 0 24 24" aria-hidden=true><path d="M2.5 6.5h19v11h-19z"/><path d="M3.2 7.2 12 13.8 20.8 7.2"/></svg>Unread <span class=pill id=count>0</span></h1>
 <div style="display:flex;gap:8px">
  <a class=back href="/">← Messenger</a>
  <button class=btn id=allBtn disabled>Mark all read</button>
 </div>
</div>

<div class=card>
 <ul id=list></ul>
 <div class=empty id=empty>Loading…</div>
</div>

<script>
const $=(id)=>document.getElementById(id);
const E=(s)=>String(s==null?'':s).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// A dev/deep-link hint only; the server trusts the session cookie, not this.
const hintMe=()=>{try{return new URLSearchParams(location.search).get('me')||localStorage.getItem('melek_me')||'';}catch(e){return '';}};
const qs=()=>{const m=hintMe();return m?('?account='+encodeURIComponent(m)):'';};

function ago(ts){
 const s=Math.max(0,Math.floor((Date.now()-Number(ts||0))/1000));
 if(s<60)return s+'s ago'; if(s<3600)return Math.floor(s/60)+'m ago';
 if(s<86400)return Math.floor(s/3600)+'h ago'; return Math.floor(s/86400)+'d ago';
}

async function open_(it){
 try{
  await fetch('/notifications/read'+qs(),{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({channel:it.channel,seq:it.seq})});
 }catch(e){}
 // Only ever a messenger deep link built from the account name, never a URL from the message body.
 location.href='/?dm='+encodeURIComponent(it['with']);
}

function render(d){
 const n=Number(d&&d.unread||0);
 $('count').textContent=n>99?'99+':String(n);
 $('allBtn').disabled=!n;
 const items=(d&&d.items)||[];
 $('list').innerHTML='';
 if(!items.length){ $('empty').textContent=(d&&d.ok===false)?'Sign in to see your notifications.':'Nothing unread. You are all caught up.'; $('empty').style.display=''; return; }
 $('empty').style.display='none';
 const frag=document.createDocumentFragment();
 for(const it of items){
  const li=document.createElement('li'); li.className='n';
  const who=String(it['with']||it.from||'');
  const bits=[];
  if(it.game)bits.push('from '+E(it.game));
  if(it.surface)bits.push(E(it.surface));
  bits.push(ago(it.ts));
  li.innerHTML='<div class=av>'+E(who.slice(0,1))+'</div>'+
   '<div class=body><div class=who>@'+E(who)+'</div>'+
   '<div class=txt>'+E(it.text)+'</div>'+
   '<div class=meta>'+bits.join(' · ')+'</div></div>'+
   '<div class=side><span class=pill>'+E(it.count)+'</span></div>';
  li.onclick=()=>open_(it);
  frag.appendChild(li);
 }
 $('list').appendChild(frag);
}

async function load(){
 try{
  const r=await fetch('/notifications/feed'+qs(),{headers:{accept:'application/json'}});
  render(await r.json());
 }catch(e){ $('empty').textContent='Could not load notifications.'; }
}

$('allBtn').onclick=async()=>{
 $('allBtn').disabled=true;
 try{ await fetch('/notifications/read-all'+qs(),{method:'POST'}); }catch(e){}
 load();
};

load();
setInterval(load,15000);
</script>
</div></body></html>`;
}
