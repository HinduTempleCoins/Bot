// sandalphon.mjs — HATHOR SANDALPHON (Sandalphon is Hathor too: the angel of song), the music side on Pentecaust,
// built the way Hathor Metatron's writing desk is: plan the song, write it, arrange it, then make it.
//
// Slice 1 (this file): one self-contained page at /sandalphon —
//   • Song board: Idea → Lyrics → Arrangement → Recording → Released cards, saved in this browser.
//   • Song sheet: title, honest tag (📝 Human / 🤖 AI-Assisted / ⚡ AI-Generated), sections in order
//     ([intro] [verse] [pre-chorus] [chorus] [bridge] [outro]), syllables per line (singability), and the shape of the song.
//   • Sound: genre, tempo, key, mood and instruments — gospel/church first, then the ancient instruments.
//   • Make it: exports the plan as the exact lyrics + style an open song engine takes (ACE-Step format);
//     sending it to our song engine comes when the engine is live on our servers.
// Original songs only — this studio never imports or copies anyone's lyrics.
// Pure builder; nothing user-supplied is interpolated server-side; the client escapes everything it renders.

// Order (operator): Christian-type songs first — a religious tone (the Spirit, God, heaven), not about Hathor and not
// centred on one name — then ancient religious music, then other kinds.
import { harpSvg, svgDataUri } from './logos.mjs';

export const GENRES = ['hymn', 'worship ballad', 'gospel choir', 'southern gospel', 'Christian folk', 'spiritual', 'gospel rock (1970s)',
  'psalm chant', 'ancient temple song', 'Levantine lyre song', 'Egyptian harper song', 'Vedic chant', 'Sufi qawwali'];
export const INSTRUMENTS = {
  church: ['hammond organ', 'pipe organ', 'gospel piano', 'choir', 'handclaps', 'tambourine', 'fuzz guitar', 'acoustic guitar', 'bass guitar', 'drums', 'bells'],
  ancient: ['lyre (kinnor)', 'harp', 'sistrum', 'frame drum', 'aulos (double pipe)', 'shofar', 'trumpet (hatzotzerah)', 'cymbals', 'lute', 'flute', 'bowed lyre', 'temple bells'],
};

export function sandalphonPage() {
  const G = JSON.stringify(GENRES), I = JSON.stringify(INSTRUMENTS);
  const LOGO = harpSvg(34), ICON = svgDataUri(harpSvg(64));
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Hathor Sandalphon — plan and write songs · Pentecaust</title>
<link rel=icon href="${ICON}">
<meta name=description content="Hathor Sandalphon, the angel of song, powered by Hathor: plan, write and arrange original songs — sacred, ancient and beyond.">
<style>
:root{--bg:#0f1117;--panel:#171a23;--bd:#2a2f3d;--fg:#e8e6e1;--mut:#9aa0ad;--acc:#8fb4ff}
@media (prefers-color-scheme:light){:root{--bg:#f6f4ef;--panel:#fff;--bd:#ddd6c8;--fg:#1d1b17;--mut:#6b665c;--acc:#2f5cc4}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
header{display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--bd);flex-wrap:wrap}header a{color:var(--mut);text-decoration:none}
h1{font-size:20px;margin:0}main{max-width:1180px;margin:0 auto;padding:16px;display:grid;gap:16px;grid-template-columns:1fr}
@media(min-width:980px){main{grid-template-columns:1.3fr 1fr}}
.card{background:var(--panel);border:1px solid var(--bd);border-radius:12px;padding:14px}h2{font-size:16px;margin:0 0 10px}
input,select,textarea,button{font:inherit;color:inherit;background:transparent;border:1px solid var(--bd);border-radius:8px;padding:7px 9px}
input[type=text]{width:100%}button{cursor:pointer;background:var(--acc);color:#0b0f1a;border:0}button.ghost{background:transparent;color:var(--fg);border:1px solid var(--bd)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}.mut{color:var(--mut);font-size:13px}
.sec{border:1px solid var(--bd);border-radius:10px;padding:8px;margin:8px 0}.sec textarea{width:100%;min-height:90px}
.sec .lines{font-size:12px;color:var(--mut);white-space:pre}.chips label{display:inline-flex;gap:4px;align-items:center;margin:2px 8px 2px 0;font-size:13px}
.board{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.col{border:1px dashed var(--bd);border-radius:10px;padding:6px;min-height:70px}.col b{font-size:12px}
.sc{background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:6px;margin-top:6px;font-size:12px}.sc button{padding:2px 6px;font-size:11px}
pre{white-space:pre-wrap;font-size:12px;background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:8px}
</style></head><body>
<header><a href="/">← Pentecaust</a>${LOGO}<h1>Hathor Sandalphon</h1><span class=mut>the angel of song — plan, write and arrange original songs · powered by Hathor · Alpha</span><a href="/sandalphon/beats">🎛️ Beat maker</a><a href="https://hathor.live/metronome">🥁 Metronome</a><a href="https://stream.soapbox.community/music">🎵 Music library</a><a href="/metatron">Hathor Metatron →</a></header>
<main>
<section class=card>
 <h2>Song sheet</h2>
 <input id=title type=text placeholder="Song title">
 <div class=row><select id=tag><option>📝 100% Human / Handwritten</option><option>🤖 AI-Assisted Planning</option><option>⚡ AI-Generated / Co-Written</option></select>
  <span id=shape class=mut></span></div>
 <div id=secs></div>
 <div class=row><select id=newsec><option>verse</option><option>pre-chorus</option><option>chorus</option><option>bridge</option><option>intro</option><option>outro</option><option>instrumental</option></select>
  <button id=addsec>Add section</button><button class=ghost id=dupchorus>Repeat the chorus</button></div>
 <p class=mut>Syllable counts help a line sing well: lines in the same section usually match within a syllable or two.</p>
</section>
<section class=card>
 <h2>Sound</h2>
 <div class=row><select id=genre></select><input id=bpm type=number min=40 max=200 value=110 style="width:80px" aria-label=tempo> bpm
  <select id=key><option>C</option><option>D</option><option>E</option><option>F</option><option>G</option><option>A</option><option>B♭</option><option>A minor</option><option>D minor</option><option>E minor</option></select></div>
 <div class=row><input id=mood type=text placeholder="mood — e.g. joyful, hopeful, solemn, triumphant"></div>
 <div class=mut>Church and band</div><div class=chips id=ich></div>
 <div class=mut style="margin-top:6px">Ancient instruments</div><div class=chips id=ian></div>
 <div class=row><select id=voice><option>male lead vocal</option><option>female lead vocal</option><option>duet</option><option>choir</option><option>instrumental (no vocals)</option></select></div>
 <h2 style="margin-top:14px">Make it</h2>
 <div class=row><button id=exp>Prepare for the song engine</button><button class=ghost id=copyexp>Copy</button></div>
 <pre id=out class=mut>The plan, as the exact lyrics and style our song engine takes, appears here.</pre>
 <p class=mut>Our song engine runs on our own servers (CPU — about an hour a song, and shared). Connect your own provider key in <a href="/#integrations">Pentecaust &rarr; Integrations</a> and your songs are made on your own account instead. Original songs only.</p>
</section>
<section class=card style="grid-column:1/-1">
 <h2>Song board</h2>
 <div class=row><input id=idea type=text placeholder="New song idea — e.g. 'a harper's song for the Nile flood'" style="flex:1"><button id=addidea>Add</button><button class=ghost id=fromsheet>Add the current song</button></div>
 <div class=board id=board></div>
</section>
</main>
<script>
(function(){
var GENRES=${G},INSTR=${I};
function $(id){return document.getElementById(id)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function load(k,d){try{var v=localStorage.getItem('sandalphon.'+k);return v?JSON.parse(v):d}catch(e){return d}}
function save(k,v){try{localStorage.setItem('sandalphon.'+k,JSON.stringify(v))}catch(e){}}
function syl(w){w=w.toLowerCase().replace(/[^a-z]/g,'');if(!w)return 0;if(w.length<=3)return 1;w=w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/,'').replace(/^y/,'');var m=w.match(/[aeiouy]{1,2}/g);return m?m.length:1}
function lineSyl(l){return l.split(/\\s+/).reduce(function(a,w){return a+syl(w)},0)}
GENRES.forEach(function(g){var o=document.createElement('option');o.textContent=g;$('genre').appendChild(o)});
function chips(el,list,name){$(el).innerHTML=list.map(function(x,i){return '<label><input type=checkbox data-i="'+esc(x)+'" class='+name+'> '+esc(x)+'</label>'}).join('')}
chips('ich',INSTR.church,'ins');chips('ian',INSTR.ancient,'ins');
var S=load('sheet',{title:'',tag:'',secs:[{kind:'verse',text:''},{kind:'chorus',text:''}],genre:'',bpm:110,key:'C',mood:'',voice:'',ins:[]});
function render(){var h='';S.secs.forEach(function(s,i){var lines=s.text.split('\\n').filter(function(l){return l.trim()});
 h+='<div class=sec><div class=row><b>['+esc(s.kind)+']</b><button class=ghost data-up="'+i+'">↑</button><button class=ghost data-dn="'+i+'">↓</button><button class=ghost data-rm="'+i+'">✕</button></div>'+
 '<textarea data-i="'+i+'" placeholder="Write the '+esc(s.kind)+' here, one line per sung line">'+esc(s.text)+'</textarea><div class=lines>'+lines.map(function(l){return lineSyl(l)+' syllables'}).join('  ·  ')+'</div></div>'});
 $('secs').innerHTML=h;$('shape').textContent=S.secs.map(function(s){return s.kind}).join(' → ');save('sheet',S)}
$('secs').addEventListener('input',function(e){var i=e.target.dataset.i;if(i!=null&&e.target.tagName==='TEXTAREA'){S.secs[+i].text=e.target.value;save('sheet',S);
 var lines=e.target.value.split('\\n').filter(function(l){return l.trim()});e.target.nextSibling.textContent=lines.map(function(l){return lineSyl(l)+' syllables'}).join('  ·  ')}});
$('secs').addEventListener('click',function(e){var d=e.target.dataset,i;if(d.rm!=null){S.secs.splice(+d.rm,1);render()}
 if(d.up!=null&&(i=+d.up)>0){var t=S.secs[i];S.secs[i]=S.secs[i-1];S.secs[i-1]=t;render()}
 if(d.dn!=null&&(i=+d.dn)<S.secs.length-1){var u=S.secs[i];S.secs[i]=S.secs[i+1];S.secs[i+1]=u;render()}});
$('addsec').onclick=function(){S.secs.push({kind:$('newsec').value,text:''});render()};
$('dupchorus').onclick=function(){var c=S.secs.filter(function(s){return s.kind==='chorus'})[0];S.secs.push({kind:'chorus',text:c?c.text:''});render()};
$('title').value=S.title||'';if(S.tag)$('tag').value=S.tag;if(S.genre)$('genre').value=S.genre;$('bpm').value=S.bpm||110;$('key').value=S.key||'C';$('mood').value=S.mood||'';if(S.voice)$('voice').value=S.voice;
Array.prototype.forEach.call(document.querySelectorAll('.ins'),function(c){c.checked=(S.ins||[]).indexOf(c.dataset.i)>=0});
// tempo/key handed over from the beat maker (#bpm=96&key=G)
(function(){var m=location.hash.match(/bpm=(\\d+)/),k=location.hash.match(/key=([^&]+)/);if(m){S.bpm=+m[1];$('bpm').value=S.bpm}
 if(k){var kv=decodeURIComponent(k[1]);for(var i=0;i<$('key').options.length;i++)if($('key').options[i].textContent===kv){S.key=kv;$('key').value=kv}}if(m||k)save('sheet',S)})();
['title','tag','genre','bpm','key','mood','voice'].forEach(function(id){$(id).addEventListener('input',function(){S[id]=$(id).value;save('sheet',S)})});
document.addEventListener('change',function(e){if(e.target.classList.contains('ins')){S.ins=Array.prototype.filter.call(document.querySelectorAll('.ins'),function(c){return c.checked}).map(function(c){return c.dataset.i});save('sheet',S)}});
render();
$('exp').onclick=function(){var lyr=S.secs.filter(function(s){return s.text.trim()||s.kind==='instrumental'}).map(function(s){return '['+s.kind+']\\n'+s.text.trim()}).join('\\n\\n');
 var style=[S.genre||$('genre').value,(S.ins||[]).join(', '),S.voice||$('voice').value,(S.mood||'').trim(),(S.bpm||110)+' bpm','key of '+(S.key||'C')].filter(Boolean).join(', ');
 $('out').textContent='TITLE: '+(S.title||'(untitled)')+'\\nSTYLE: '+style+'\\nTAG: '+(S.tag||$('tag').value)+'\\n\\nLYRICS:\\n'+lyr;$('out').classList.remove('mut')};
$('copyexp').onclick=function(){try{navigator.clipboard.writeText($('out').textContent)}catch(e){}};
// board
var COLS=['Idea','Lyrics','Arrangement','Recording','Released'];
function board(){var cards=load('cards',[]);var h='';COLS.forEach(function(c,ci){h+='<div class=col><b>'+c+'</b>';cards.forEach(function(k,i){if(k.col!==ci)return;
 h+='<div class=sc>'+esc(k.text)+'<div class=row>'+(ci>0?'<button class=ghost data-m="'+i+'" data-d="-1">←</button>':'')+(ci<4?'<button class=ghost data-m="'+i+'" data-d="1">→</button>':'')+'<button class=ghost data-x="'+i+'">✕</button></div></div>'});h+='</div>'});$('board').innerHTML=h}
$('board').onclick=function(e){var t=e.target,cards=load('cards',[]);if(t.dataset.m!=null){var k=cards[+t.dataset.m];k.col=Math.max(0,Math.min(4,k.col+(+t.dataset.d)));save('cards',cards);board()}
 if(t.dataset.x!=null){cards.splice(+t.dataset.x,1);save('cards',cards);board()}};
$('addidea').onclick=function(){var t=$('idea').value.trim();if(!t)return;var c=load('cards',[]);c.push({text:t.slice(0,200),col:0});save('cards',c);$('idea').value='';board()};
$('fromsheet').onclick=function(){var c=load('cards',[]);c.push({text:(S.title||'Untitled song')+' — '+(S.genre||''),col:1});save('cards',c);board()};
board();
})();
</script></body></html>`;
}
