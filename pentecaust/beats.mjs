// beats.mjs — HATHOR SANDALPHON BEAT MAKER: make your own beat in the browser, no install, no samples to download.
// Every sound is synthesised live with Web Audio: kit drums (kick, snare, hat, clap), the ancient set (frame-drum doum
// and tek, sistrum, gong, bell), and two melodic rows (lyre by Karplus-Strong pluck, bass) on a chosen key and mode.
// Meters: 4/4, 3/4, 6/8 and the "limping" 7/8. Presets start you off (gospel, hymn, Egyptian maqsum, temple procession,
// gong meditation, aksak). Tempo + swing; save in this browser; share a link (the beat lives in the URL); download a WAV
// (rendered offline, 4 bars); hand the tempo to the Sandalphon song sheet.
// Pure builder: nothing user-supplied is interpolated server-side; the client sets text via textContent only.

import { harpSvg, svgDataUri } from './logos.mjs';

export const METERS = { '4/4': 16, '3/4': 12, '6/8': 12, '7/8': 14 };
export const ROWS = [
  { id: 'kick', name: 'Kick' }, { id: 'snare', name: 'Snare' }, { id: 'hat', name: 'Hi-hat' }, { id: 'clap', name: 'Clap' },
  { id: 'doum', name: 'Frame drum · doum' }, { id: 'tek', name: 'Frame drum · tek' }, { id: 'sistrum', name: 'Sistrum' },
  { id: 'gong', name: 'Gong' }, { id: 'bell', name: 'Bell' }, { id: 'lyre', name: 'Lyre', melodic: true }, { id: 'bass', name: 'Bass', melodic: true },
];
// presets: rows as strings, one char per step; drums 'x' = hit, melodic 1-8 = scale degree, '.' = rest
export const PRESETS = {
  'Gospel stomp (4/4)': { meter: '4/4', bpm: 96, swing: 12, key: 'G', mode: 'major', rows: {
    kick: 'x.......x.x.....', snare: '....x.......x...', clap: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', bass: '1.......5.6.....', lyre: '3...5...6...5...' } },
  'Hymn (3/4)': { meter: '3/4', bpm: 72, swing: 0, key: 'D', mode: 'major', rows: {
    kick: 'x...........', bell: 'x...........', hat: '....x...x...', bass: '1.......5...', lyre: '3...2...1...' } },
  'Maqsum — Egyptian frame drum (4/4)': { meter: '4/4', bpm: 104, swing: 0, key: 'E', mode: 'hijaz', rows: {
    doum: 'x.....x.x.......', tek: '..x.x.....x.x...', sistrum: 'x.x.x.x.x.x.x.x.', lyre: '1.2.3...2.1.....' } },
  'Temple procession (4/4)': { meter: '4/4', bpm: 84, swing: 0, key: 'D', mode: 'dorian', rows: {
    doum: 'x.......x.......', tek: '....x.......x...', gong: 'x...............', bell: '........x.......', bass: '1...........5...', lyre: '1.3.5...4.3.2...' } },
  'Gong meditation (6/8)': { meter: '6/8', bpm: 60, swing: 0, key: 'A', mode: 'pentatonic', rows: {
    gong: 'x...........', bell: '......x.....', doum: 'x.....x.....', lyre: '1.....3...5.' } },
  'Aksak — limping 7/8': { meter: '7/8', bpm: 120, swing: 0, key: 'D', mode: 'minor', rows: {
    doum: 'x...x...x.....', tek: '..x...x...x.x.', hat: 'x.x.x.x.x.x.x.', bass: '1...4...5.....' } },
};
export const MODES = { major: [0, 2, 4, 5, 7, 9, 11, 12], minor: [0, 2, 3, 5, 7, 8, 10, 12], dorian: [0, 2, 3, 5, 7, 9, 10, 12],
  hijaz: [0, 1, 4, 5, 7, 8, 10, 12], pentatonic: [0, 2, 4, 7, 9, 12, 14, 16] };
export const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export function beatsPage() {
  const LOGO = harpSvg(32), ICON = svgDataUri(harpSvg(64));
  const opt = (arr, sel) => arr.map((v) => `<option${v === sel ? ' selected' : ''}>${v}</option>`).join('');
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Beat maker — Hathor Sandalphon · Pentecaust</title><link rel=icon href="${ICON}">
<meta name=description content="Make your own beat in the browser: drums, frame drums, sistrum, gong, bell, lyre and bass, in 4/4, 3/4, 6/8 or 7/8. Share it with a link or download it.">
<style>
:root{--bg:#0f1117;--panel:#171a23;--bd:#2a2f3d;--fg:#e8e6e1;--mut:#9aa0ad;--acc:#8fb4ff;--on:#c9a64a}
@media (prefers-color-scheme:light){:root{--bg:#f6f4ef;--panel:#fff;--bd:#ddd6c8;--fg:#1d1b17;--mut:#6b665c;--acc:#2f5bd3;--on:#a07a12}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
header{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--bd)}header a{color:var(--mut);text-decoration:none}
h1{font-size:20px;margin:0}main{max-width:1180px;margin:0 auto;padding:16px}
.bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;background:var(--panel);border:1px solid var(--bd);border-radius:12px;padding:10px 12px}
select,input,button{font:inherit;color:inherit;background:transparent;border:1px solid var(--bd);border-radius:8px;padding:6px 9px}
button{cursor:pointer}button.go{background:var(--acc);color:#0c1016;border:0;font-weight:700;min-width:90px}
.grid{margin-top:12px;background:var(--panel);border:1px solid var(--bd);border-radius:12px;padding:10px;overflow-x:auto}
.r{display:flex;align-items:center;gap:6px;margin:3px 0}.r .n{width:150px;flex:none;font-size:13px;color:var(--mut)}
.r .cells{display:grid;gap:4px;flex:1;min-width:420px}
.c{height:32px;border-radius:6px;border:1px solid var(--bd);background:transparent;padding:0;font-size:12px;font-weight:700;color:#0c1016}
.c.beat{border-color:var(--mut)}.c.on{background:var(--on);border-color:var(--on)}.c.now{outline:2px solid var(--acc);outline-offset:1px}
.r .vol{width:70px}.mut{color:var(--mut);font-size:13px}label{font-size:13px;color:var(--mut)}
</style></head><body>
<header><a href="/sandalphon">← Hathor Sandalphon</a>${LOGO}<h1>Beat maker</h1><span class=mut>tap the squares · every sound is made live in your browser · Alpha</span><span style="margin-left:auto;display:flex;gap:12px"><a href="https://hathor.live/metronome">🥁 Metronome</a><a href="https://tools.soapbox.community/">🧰 Tools</a><a href="/metatron">Hathor Metatron</a></span></header>
<main>
<div class=bar>
 <button class=go id=play>▶ Play</button>
 <label>Start from <select id=preset><option value="">— a preset —</option>${opt(Object.keys(PRESETS), '')}</select></label>
 <label>Meter <select id=meter>${opt(Object.keys(METERS), '4/4')}</select></label>
 <label>Tempo <input id=bpm type=number min=50 max=200 value=96 style="width:70px"> bpm</label>
 <label>Swing <input id=swing type=range min=0 max=40 value=0></label>
 <label><input id=click type=checkbox> Metronome click</label>
 <label>Key <select id=key>${opt(KEYS, 'D')}</select></label>
 <label>Mode <select id=mode>${opt(Object.keys(MODES), 'major')}</select></label>
</div>
<div class=grid id=grid></div>
<div class=bar style="margin-top:12px">
 <button id=surprise>🎲 Surprise me</button><button id=clear>Clear</button><button id=save>Save</button>
 <button id=share>Copy a share link</button><button id=wav>⬇ Download WAV (4 bars)</button>
 <a id=toSong href="/sandalphon">Use this tempo in a song →</a><span id=msg class=mut></span>
</div>
<p class=mut>Drums: tap to turn a step on. Lyre and bass: each tap moves the note up the scale (1–8), then off. Frame-drum <b>doum</b> is the low centre stroke, <b>tek</b> the sharp edge stroke — the two voices of Middle-Eastern rhythm.</p>
</main>
<script>
(function(){
var METERS=${JSON.stringify(METERS)},ROWS=${JSON.stringify(ROWS)},PRESETS=${JSON.stringify(PRESETS)},MODES=${JSON.stringify(MODES)},KEYS=${JSON.stringify(KEYS)};
function $(id){return document.getElementById(id)}
var S={meter:'4/4',bpm:96,swing:0,key:'D',mode:'major',rows:{},vol:{}};
function steps(){return METERS[S.meter]}
function beatEvery(){return S.meter==='6/8'?6:S.meter==='7/8'?2:4}
function norm(){var n=steps();ROWS.forEach(function(r){var a=S.rows[r.id]||[];a=a.slice(0,n);while(a.length<n)a.push(0);S.rows[r.id]=a;if(S.vol[r.id]==null)S.vol[r.id]=0.8})}
function fromPreset(name){var p=PRESETS[name];if(!p)return;S.meter=p.meter;S.bpm=p.bpm;S.swing=p.swing;S.key=p.key;S.mode=p.mode;S.rows={};
 ROWS.forEach(function(r){var str=p.rows[r.id]||'';S.rows[r.id]=str.split('').map(function(c){return c==='x'?1:(c>='1'&&c<='8'?+c:0)})});norm();sync();build()}
function sync(){$('meter').value=S.meter;$('bpm').value=S.bpm;$('swing').value=S.swing;$('key').value=S.key;$('mode').value=S.mode;$('toSong').href='/sandalphon#bpm='+S.bpm+'&key='+encodeURIComponent(S.key)}
function build(){var g=$('grid');g.textContent='';var n=steps();
 ROWS.forEach(function(r){var row=document.createElement('div');row.className='r';var nm=document.createElement('span');nm.className='n';nm.textContent=r.name;row.appendChild(nm);
  var cells=document.createElement('div');cells.className='cells';cells.style.gridTemplateColumns='repeat('+n+',1fr)';
  for(var i=0;i<n;i++){(function(i){var b=document.createElement('button');b.className='c'+(i%beatEvery()===0?' beat':'');b.dataset.row=r.id;b.dataset.i=i;paint(b,r);
   b.onclick=function(){var v=S.rows[r.id][i];S.rows[r.id][i]=r.melodic?(v>=8?0:v+1):(v?0:1);paint(b,r);if(S.rows[r.id][i])hit(r.id,S.rows[r.id][i],ctx().currentTime+0.01,ctx().destination)};
   cells.appendChild(b)})(i)}
  row.appendChild(cells);var v=document.createElement('input');v.type='range';v.min=0;v.max=1;v.step=0.05;v.value=S.vol[r.id];v.className='vol';v.setAttribute('aria-label',r.name+' volume');
  v.oninput=function(){S.vol[r.id]=+v.value};row.appendChild(v);g.appendChild(row)})}
function paint(b,r){var v=S.rows[r.id][+b.dataset.i];b.classList.toggle('on',!!v);b.textContent=r.melodic&&v?String(v):''}
// ── sound: everything synthesised ──
var AC=null,noiseBuf=null;
function ctx(){if(!AC){AC=new (window.AudioContext||window.webkitAudioContext)()}return AC}
function noise(c){if(noiseBuf&&noiseBuf.sampleRate===c.sampleRate)return noiseBuf;var b=c.createBuffer(1,c.sampleRate,c.sampleRate),d=b.getChannelData(0);for(var i=0;i<d.length;i++)d[i]=Math.random()*2-1;return c===AC?(noiseBuf=b):b}
function env(c,g,t,a,peak,d){g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(peak,t+a);g.gain.exponentialRampToValueAtTime(0.0001,t+a+d)}
function freq(deg,oct){var sc=MODES[S.mode],k=KEYS.indexOf(S.key);var semis=sc[(deg-1)%sc.length]+12*Math.floor((deg-1)/sc.length);return 440*Math.pow(2,(k+semis-9)/12+(oct||0))}
function hit(id,v,t,out){var c=out.context,vol=S.vol[id]==null?0.8:S.vol[id],g=c.createGain();g.connect(out);var o,n,f;
 if(id==='kick'){o=c.createOscillator();o.frequency.setValueAtTime(150,t);o.frequency.exponentialRampToValueAtTime(42,t+0.15);o.connect(g);env(c,g,t,0.003,vol,0.32);o.start(t);o.stop(t+0.4)}
 else if(id==='snare'||id==='clap'||id==='hat'||id==='sistrum'){n=c.createBufferSource();n.buffer=noise(c);f=c.createBiquadFilter();
  f.type=id==='hat'?'highpass':id==='sistrum'?'bandpass':'bandpass';f.frequency.value=id==='hat'?7000:id==='sistrum'?6500:id==='clap'?1500:1800;f.Q.value=id==='sistrum'?6:0.8;
  n.connect(f);f.connect(g);if(id==='clap'){for(var k=0;k<3;k++){g.gain.setValueAtTime(vol,t+k*0.012);g.gain.exponentialRampToValueAtTime(0.01,t+k*0.012+0.01)}g.gain.setValueAtTime(vol*0.8,t+0.036);g.gain.exponentialRampToValueAtTime(0.0001,t+0.2)}
  else env(c,g,t,0.002,vol*(id==='hat'?0.5:id==='sistrum'?0.6:0.8),id==='hat'?0.05:id==='sistrum'?0.18:0.16);
  n.start(t);n.stop(t+0.4);if(id==='snare'){o=c.createOscillator();o.type='triangle';o.frequency.value=190;var g2=c.createGain();o.connect(g2);g2.connect(out);env(c,g2,t,0.002,vol*0.5,0.1);o.start(t);o.stop(t+0.2)}
  if(id==='sistrum'){var lfo=c.createOscillator(),lg=c.createGain();lfo.frequency.value=28;lg.gain.value=0.5;lfo.connect(lg);lg.connect(g.gain);lfo.start(t);lfo.stop(t+0.3)}}
 else if(id==='doum'||id==='tek'){o=c.createOscillator();o.type='sine';o.frequency.setValueAtTime(id==='doum'?110:420,t);o.frequency.exponentialRampToValueAtTime(id==='doum'?70:330,t+0.12);o.connect(g);
  env(c,g,t,0.002,vol*(id==='doum'?0.9:0.5),id==='doum'?0.35:0.08);o.start(t);o.stop(t+0.5);if(id==='tek'){n=c.createBufferSource();n.buffer=noise(c);f=c.createBiquadFilter();f.type='highpass';f.frequency.value=3000;var gn=c.createGain();n.connect(f);f.connect(gn);gn.connect(out);env(c,gn,t,0.001,vol*0.3,0.03);n.start(t);n.stop(t+0.1)}}
 else if(id==='gong'||id==='bell'){var parts=id==='gong'?[[1,1],[1.48,0.6],[2.03,0.45],[2.67,0.3],[3.21,0.2]]:[[1,1],[2.76,0.5],[5.4,0.25]],base=id==='gong'?98:freq(5,0);
  parts.forEach(function(p){var oo=c.createOscillator(),gg=c.createGain();oo.frequency.setValueAtTime(base*p[0]*(id==='gong'?1.02:1),t);if(id==='gong')oo.frequency.exponentialRampToValueAtTime(base*p[0],t+0.6);
   oo.connect(gg);gg.connect(g);env(c,gg,t,id==='gong'?0.03:0.002,p[1]*0.4,id==='gong'?4:1.6);oo.start(t);oo.stop(t+(id==='gong'?4.2:1.8))});g.gain.value=vol}
 else if(id==='lyre'){var fr=freq(v,0),N=Math.round(c.sampleRate/fr),len=Math.round(c.sampleRate*1.6),b=c.createBuffer(1,len,c.sampleRate),d=b.getChannelData(0),ring=new Float32Array(N);
  for(var i=0;i<N;i++)ring[i]=Math.random()*2-1;for(i=0;i<len;i++){var j=i%N,nx=(j+1)%N;d[i]=ring[j];ring[j]=0.996*0.5*(ring[j]+ring[nx])}
  n=c.createBufferSource();n.buffer=b;n.connect(g);g.gain.value=vol*0.7;n.start(t)}
 else if(id==='bass'){o=c.createOscillator();o.type='triangle';o.frequency.value=freq(v,-2);f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=600;o.connect(f);f.connect(g);env(c,g,t,0.01,vol*0.9,0.45);o.start(t);o.stop(t+0.6)}}
function stepDur(){var per=S.meter==='6/8'?3:S.meter==='7/8'?2:4;return 60/S.bpm/(S.meter==='6/8'?per/1.5:per)}
function click(t,accent,out){var c=out.context,o=c.createOscillator(),g=c.createGain();o.frequency.value=accent?1600:1000;o.connect(g);g.connect(out);env(c,g,t,0.001,0.5,0.04);o.start(t);o.stop(t+0.06)}
function schedAt(step,t,out,noClick){ROWS.forEach(function(r){var v=S.rows[r.id][step];if(v)hit(r.id,v,t,out)});if(!noClick&&$('click').checked&&step%beatEvery()===0)click(t,step===0,out)}
// lookahead scheduler
var timer=null,next=0,cur=0,playing=false;
function tick(){var c=ctx();while(next<c.currentTime+0.12){var sw=(cur%2===1)?stepDur()*S.swing/100:0;schedAt(cur,next+sw,c.destination);show(cur,next+sw);next+=stepDur();cur=(cur+1)%steps()}timer=setTimeout(tick,25)}
function show(step,t){setTimeout(function(){document.querySelectorAll('.c.now').forEach(function(b){b.classList.remove('now')});document.querySelectorAll('.c[data-i="'+step+'"]').forEach(function(b){b.classList.add('now')})},Math.max(0,(t-ctx().currentTime)*1000))}
$('play').onclick=function(){var c=ctx();if(c.state==='suspended')c.resume();if(playing){clearTimeout(timer);playing=false;$('play').textContent='▶ Play';document.querySelectorAll('.c.now').forEach(function(b){b.classList.remove('now')});return}
 playing=true;$('play').textContent='■ Stop';cur=0;next=c.currentTime+0.05;tick()};
$('preset').onchange=function(){if(this.value)fromPreset(this.value)};
$('meter').onchange=function(){S.meter=this.value;norm();build()};
$('bpm').oninput=function(){S.bpm=Math.max(50,Math.min(200,+this.value||96));sync()};
$('swing').oninput=function(){S.swing=+this.value};
$('key').onchange=function(){S.key=this.value;sync()};$('mode').onchange=function(){S.mode=this.value};
$('clear').onclick=function(){S.rows={};norm();build()};
$('surprise').onclick=function(){var n=steps(),be=beatEvery();S.rows={};ROWS.forEach(function(r){S.rows[r.id]=[]});
 for(var i=0;i<n;i++){var on=i%be===0;S.rows.kick[i]=(i===0||(on&&Math.random()<0.4))?1:0;S.rows.snare[i]=(i%(be*2)===be)?1:0;S.rows.hat[i]=Math.random()<0.6?1:0;
  S.rows.doum[i]=on&&Math.random()<0.5?1:0;S.rows.tek[i]=!on&&Math.random()<0.3?1:0;S.rows.bass[i]=on&&Math.random()<0.7?[1,4,5,6][Math.floor(Math.random()*4)]:0;
  S.rows.lyre[i]=Math.random()<0.3?1+Math.floor(Math.random()*8):0}S.rows.gong[0]=Math.random()<0.4?1:0;norm();build()};
function enc(){return btoa(unescape(encodeURIComponent(JSON.stringify(S))))}
function dec(h){try{var o=JSON.parse(decodeURIComponent(escape(atob(h))));if(o&&METERS[o.meter]&&o.rows){S=Object.assign(S,o);norm();return true}}catch(e){}return false}
$('save').onclick=function(){try{localStorage.setItem('sandalphon.beat',JSON.stringify(S));$('msg').textContent='Saved in this browser.'}catch(e){$('msg').textContent='Could not save here.'}};
$('share').onclick=function(){var u=location.origin+location.pathname+'#b='+enc();try{navigator.clipboard.writeText(u);$('msg').textContent='Link copied — anyone who opens it hears this beat.'}catch(e){$('msg').textContent=u}};
$('wav').onclick=function(){var bars=4,n=steps(),sr=44100,len=Math.ceil((n*bars*stepDur()+4.5)*sr),oc=new OfflineAudioContext(1,len,sr),t=0;
 for(var b=0;b<bars;b++)for(var i=0;i<n;i++){var sw=(i%2===1)?stepDur()*S.swing/100:0;schedAt(i,t+sw,oc.destination,true);t+=stepDur()}
 $('msg').textContent='Rendering…';oc.startRendering().then(function(buf){var d=buf.getChannelData(0),out=new DataView(new ArrayBuffer(44+d.length*2));
  function w(o,s){for(var i=0;i<s.length;i++)out.setUint8(o+i,s.charCodeAt(i))}w(0,'RIFF');out.setUint32(4,36+d.length*2,true);w(8,'WAVEfmt ');out.setUint32(16,16,true);out.setUint16(20,1,true);out.setUint16(22,1,true);
  out.setUint32(24,sr,true);out.setUint32(28,sr*2,true);out.setUint16(32,2,true);out.setUint16(34,16,true);w(36,'data');out.setUint32(40,d.length*2,true);
  for(var i=0;i<d.length;i++){var s=Math.max(-1,Math.min(1,d[i]*0.9));out.setInt16(44+i*2,s*32767,true)}
  var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([out],{type:'audio/wav'}));a.download='sandalphon-beat-'+S.bpm+'bpm.wav';a.click();$('msg').textContent='Downloaded.'})};
var h=location.hash.match(/^#b=(.+)$/),loaded=false;if(h)loaded=dec(h[1]);
if(!loaded){try{var sv=localStorage.getItem('sandalphon.beat');if(sv){var o=JSON.parse(sv);if(o&&METERS[o.meter]){S=Object.assign(S,o);loaded=true}}}catch(e){}}
if(loaded){norm();sync();build()}else fromPreset('Gospel stomp (4/4)');
})();
</script></body></html>`;
}
