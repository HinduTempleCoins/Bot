// metatron.mjs — METATRON, the making side of Hathor on Pentecaust: write (the Writing Sandbox — the NaNoWriMo
// successor) and make graphics, then use them in Herald emails, BiFrost videos and posts on our own channels.
//
// Slice 1 (this file): one self-contained page at /metatron —
//   • Writing desk: title, transparency tag (📝 100% Human / 🤖 AI-Assisted Planning / ⚡ AI-Generated), word count,
//     story points (1 point ≈ 500 words), a sprint timer, autosaved drafts (this browser only), copy-out with the tag.
//   • Scene board: Backlog → Writing → Review → Done cards with story points (kanban), saved in this browser.
//   • Graphic maker: a prompt → our own Studio (hathor.soapbox.community /api/generate?format=json, the same CPU
//     image pool) → the picture, a copy-link, and ready-made snippets for a Herald email or a BiFrost thumbnail.
// Next slices: post directly to MELEK through MELEK-Signer, the dwell-and-discussion payout, shared boards.
// Pure builder; nothing user-supplied is interpolated server-side; the client escapes everything it renders.

export const STUDIO_BASE = () => (process.env.METATRON_STUDIO || 'https://hathor.soapbox.community').replace(/\/$/, '');

export function metatronPage(studio = STUDIO_BASE()) {
  const S = JSON.stringify(studio);
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Metatron — write and make · Pentecaust</title>
<meta name=description content="Metatron on Pentecaust: a writing desk with honest human/AI tags, story points and sprints, a scene board, and a graphic maker for your emails, videos and posts.">
<style>
:root{--bg:#0f1117;--panel:#171a23;--bd:#2a2f3d;--fg:#e8e6e1;--mut:#9aa0ad;--acc:#c9a64a}
@media (prefers-color-scheme:light){:root{--bg:#f6f4ef;--panel:#fff;--bd:#ddd6c8;--fg:#1d1b17;--mut:#6b665c;--acc:#8a6a12}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
header{display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--bd)}header a{color:var(--mut);text-decoration:none}
h1{font-size:20px;margin:0}main{max-width:1180px;margin:0 auto;padding:16px;display:grid;gap:16px;grid-template-columns:1fr}
@media(min-width:980px){main{grid-template-columns:1.25fr 1fr}}
.card{background:var(--panel);border:1px solid var(--bd);border-radius:12px;padding:14px}
h2{font-size:16px;margin:0 0 10px}input,select,textarea,button{font:inherit;color:inherit;background:transparent;border:1px solid var(--bd);border-radius:8px;padding:7px 9px}
textarea{width:100%;min-height:300px;resize:vertical}input[type=text]{width:100%}button{cursor:pointer;background:var(--acc);color:#111;border:0}
button.ghost{background:transparent;color:var(--fg);border:1px solid var(--bd)}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}
.mut{color:var(--mut);font-size:13px}.board{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.col{border:1px dashed var(--bd);border-radius:10px;padding:6px;min-height:80px}.col b{font-size:13px}
.sc{background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:6px;margin-top:6px;font-size:13px}
.sc .row{margin:4px 0 0}.sc button{padding:2px 7px;font-size:12px}img#gimg{max-width:100%;border-radius:10px;margin-top:8px;display:none}
code{font-size:12px;word-break:break-all}
</style></head><body>
<header><a href="/">← Pentecaust</a><h1>✍️ Metatron</h1><span class=mut>write and make — for Herald emails, BiFrost videos and our channels · Alpha</span></header>
<main>
<section class=card>
 <h2>Writing desk</h2>
 <input id=title type=text placeholder="Title">
 <div class=row>
  <select id=tag aria-label="How was this written?">
   <option value="📝 100% Human / Handwritten">📝 100% Human / Handwritten</option>
   <option value="🤖 AI-Assisted Planning">🤖 AI-Assisted Planning (brainstorm, outline, edit)</option>
   <option value="⚡ AI-Generated / Co-Written">⚡ AI-Generated / Co-Written</option>
  </select>
  <span id=count class=mut></span>
 </div>
 <textarea id=body placeholder="Write here. Drafts save in this browser as you type."></textarea>
 <div class=row>
  <button id=sprint>Start a 25-minute sprint</button><span id=timer class=mut></span>
  <button class=ghost id=copy>Copy with tag</button>
  <a class=mut href="https://melek.salon/submit.html" target=_blank rel=noopener>Open the MELEK editor ↗</a>
 </div>
 <p class=mut>Honest tags keep readers' trust: readers can choose a human-only feed or a tech-assisted one. Posting straight to MELEK from here comes in the next slice.</p>
</section>
<section class=card>
 <h2>Scene board</h2>
 <div class=row><input id=scene type=text placeholder="New scene card — e.g. 'The ship reaches Gadir'" style="flex:1"><input id=pts type=number min=1 max=13 value=1 style="width:70px" aria-label="story points"><button id=addScene>Add</button></div>
 <div class=board id=board></div>
 <p class=mut>1 story point ≈ 500 words (or ⅛ of a script page). <span id=vel></span></p>
</section>
<section class=card style="grid-column:1/-1">
 <h2>Make a graphic</h2>
 <div class=row><input id=gprompt type=text placeholder="e.g. a gold-and-lapis banner of the Nile at dawn for an email header" style="flex:1">
  <select id=gsize><option value=1024x768>wide</option><option value=1024x1024>square</option><option value=768x1024>tall</option></select>
  <button id=gmake>Make it</button></div>
 <div id=gstatus class=mut></div>
 <img id=gimg alt="">
 <div id=guse class=mut style="display:none">
  <p>Link: <code id=glink></code> <button class=ghost id=gcopy>Copy link</button></p>
  <p>For a <b>Herald</b> email: <code id=gherald></code> <button class=ghost id=gcopyh>Copy</button></p>
  <p>For a <b>BiFrost</b> thumbnail or a post: use the link above.</p>
 </div>
 <p class=mut>Made on our own servers (CPU, a few minutes per picture). Content rules of the Studio apply.</p>
</section>
</main>
<script>
(function(){
var STUDIO=${S};
function $(id){return document.getElementById(id)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function load(k,d){try{var v=localStorage.getItem('metatron.'+k);return v?JSON.parse(v):d}catch(e){return d}}
function save(k,v){try{localStorage.setItem('metatron.'+k,JSON.stringify(v))}catch(e){}}
// writing desk
var d=load('draft',{title:'',body:'',tag:''});$('title').value=d.title||'';$('body').value=d.body||'';if(d.tag)$('tag').value=d.tag;
function words(){var t=$('body').value.trim();return t?t.split(/\\s+/).length:0}
function upd(){var w=words();$('count').textContent=w+' words · '+(Math.round(w/50)/10)+' story points';save('draft',{title:$('title').value,body:$('body').value,tag:$('tag').value})}
['title','body','tag'].forEach(function(id){$(id).addEventListener('input',upd)});upd();
var tEnd=0,tInt=null,tStart=0;
$('sprint').onclick=function(){if(tInt){clearInterval(tInt);tInt=null;$('sprint').textContent='Start a 25-minute sprint';$('timer').textContent='';return}
 tEnd=Date.now()+25*60000;tStart=words();$('sprint').textContent='Stop';tInt=setInterval(function(){var l=Math.max(0,tEnd-Date.now());
 $('timer').textContent=Math.floor(l/60000)+':'+('0'+Math.floor(l%60000/1000)).slice(-2)+' left · '+(words()-tStart)+' words this sprint';
 if(!l){clearInterval(tInt);tInt=null;$('sprint').textContent='Start a 25-minute sprint';var v=load('velocity',[]);v.push(words()-tStart);save('velocity',v.slice(-20));board()}},1000)};
$('copy').onclick=function(){var t=($('title').value?'# '+$('title').value+'\\n\\n':'')+$('body').value+'\\n\\n— '+$('tag').value;
 try{navigator.clipboard.writeText(t);$('copy').textContent='Copied'}catch(e){}};
// scene board
var COLS=['Backlog','Writing','Review','Done'];
function board(){var cards=load('cards',[]);var h='';COLS.forEach(function(c,ci){h+='<div class=col><b>'+c+'</b>';cards.forEach(function(k,i){if(k.col!==ci)return;
 h+='<div class=sc>'+esc(k.text)+' <span class=mut>('+esc(k.pts)+' pt)</span><div class=row>'+(ci>0?'<button class=ghost data-m="'+i+'" data-d="-1">←</button>':'')+(ci<3?'<button class=ghost data-m="'+i+'" data-d="1">→</button>':'')+'<button class=ghost data-x="'+i+'">✕</button></div></div>'});h+='</div>'});
 $('board').innerHTML=h;var v=load('velocity',[]);$('vel').textContent=v.length?'Your recent sprints: about '+Math.round(v.reduce(function(a,b){return a+b},0)/v.length)+' words each.':'';}
$('board').onclick=function(e){var t=e.target,cards=load('cards',[]);if(t.dataset.m!=null){var k=cards[+t.dataset.m];k.col=Math.max(0,Math.min(3,k.col+(+t.dataset.d)));save('cards',cards);board()}
 if(t.dataset.x!=null){cards.splice(+t.dataset.x,1);save('cards',cards);board()}};
$('addScene').onclick=function(){var t=$('scene').value.trim();if(!t)return;var cards=load('cards',[]);cards.push({text:t.slice(0,200),pts:Math.max(1,Math.min(13,+$('pts').value||1)),col:0});save('cards',cards);$('scene').value='';board()};
board();
// graphic maker → our Studio
$('gmake').onclick=function(){var p=$('gprompt').value.trim();if(!p){$('gstatus').textContent='Describe the picture first.';return}
 $('gmake').disabled=true;$('gstatus').textContent='Making it on our servers — this takes a few minutes…';$('guse').style.display='none';$('gimg').style.display='none';
 fetch(STUDIO+'/api/generate?format=json',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'prompt='+encodeURIComponent(p)+'&size='+encodeURIComponent($('gsize').value)})
 .then(function(r){return r.json()}).then(function(j){$('gmake').disabled=false;if(!j.ok){$('gstatus').textContent=j.error||'Could not make it this time.';return}
  $('gstatus').textContent='Done.';$('gimg').src=j.url;$('gimg').style.display='block';$('glink').textContent=j.url;
  $('gherald').textContent='<img src="'+j.url+'" alt="" style="max-width:100%">';$('guse').style.display='block'})
 .catch(function(){$('gmake').disabled=false;$('gstatus').textContent='The studio did not answer — try again in a minute.'})};
$('gcopy').onclick=function(){try{navigator.clipboard.writeText($('glink').textContent)}catch(e){}};
$('gcopyh').onclick=function(){try{navigator.clipboard.writeText($('gherald').textContent)}catch(e){}};
})();
</script></body></html>`;
}
