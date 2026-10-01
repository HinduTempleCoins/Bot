// player.mjs — the SoapBox standard music player: a small panel like a car-radio face or the old MySpace profile
// player. A display line scrolls the ARTIST — SONG, and instead of level meters or a heart-monitor waveform the
// panel shows the MUSIC: the melody as notes moving across a staff, or as guitar tablature, with a playhead.
//
// One panel per page, plus a playlist: any element with data-sbp-track='{"title":…,"artist":…,"audio":…,"notes":…}'
// loads into the panel when clicked. Notes come from MUSIC_DIR/notes (basic-pitch transcription, Apache-2.0); a song
// with no notes yet says so instead of faking any.
// Server side is pure strings: panelHtml() + PLAYER_CSS + PLAYER_JS. Everything user-visible is set via textContent.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** JSON for a data-sbp-track attribute (escaped for an HTML attribute) */
export function trackAttr(t) {
  return esc(JSON.stringify({ id: t.id, title: t.title, artist: t.artist || '', audio: t.audio, notes: t.notesUrl || '' }));
}

/** The panel. `t` is the first track loaded (optional). */
export function panelHtml(t = null, { compact = false } = {}) {
  return `<div class="sbp${compact ? ' sbp-compact' : ''}" id=sbp${t ? ` data-sbp-first="${trackAttr(t)}"` : ''}>
 <div class=sbp-face>
  <div class=sbp-lcd aria-live=polite><span class=sbp-marquee>SoapBox Music</span></div>
  <canvas class=sbp-staff width=640 height=150 aria-label="The melody as notes on a staff"></canvas>
  <div class=sbp-row>
   <button class=sbp-play aria-label=Play>▶</button>
   <span class=sbp-time>0:00</span>
   <input class=sbp-seek type=range min=0 max=1000 value=0 aria-label=Seek>
   <span class=sbp-dur>0:00</span>
   <span class=sbp-view role=group aria-label="Show as"><button data-v=notes class=on>♪ Notes</button><button data-v=tab>Tab</button></span>
  </div>
 </div>
 <audio class=sbp-audio preload=metadata></audio>
</div>`;
}

export const PLAYER_CSS = `<style>
.sbp{max-width:680px;margin:12px 0;border-radius:16px;padding:10px;background:linear-gradient(180deg,#3a3d45,#1d1f25);box-shadow:inset 0 1px 0 #6a6e78,0 6px 18px rgba(0,0,0,.35)}
.sbp-face{background:#0c1016;border-radius:10px;padding:10px;border:1px solid #000}
.sbp-lcd{overflow:hidden;white-space:nowrap;background:#0f1d2a;border:1px solid #23384b;border-radius:6px;padding:5px 8px;font:600 15px/1.3 ui-monospace,Menlo,Consolas,monospace;color:#bfe3ff;letter-spacing:.06em;text-shadow:0 0 6px rgba(140,200,255,.55)}
.sbp-marquee{display:inline-block;padding-left:100%;animation:sbp-scroll 14s linear infinite}
@keyframes sbp-scroll{from{transform:translateX(0)}to{transform:translateX(-100%)}}
@media (prefers-reduced-motion:reduce){.sbp-marquee{animation:none;padding-left:0}}
.sbp-staff{display:block;width:100%;height:auto;margin-top:8px;background:#f7f2e6;border-radius:6px}
.sbp-row{display:flex;align-items:center;gap:8px;margin-top:8px;color:#c9ced8;font:13px system-ui,sans-serif;flex-wrap:wrap}
.sbp-row button{font:inherit;color:#e8ecf3;background:#2a2e37;border:1px solid #474c57;border-radius:8px;padding:4px 10px;cursor:pointer}
.sbp-play{min-width:44px;font-size:16px!important}.sbp-seek{flex:1;min-width:120px;accent-color:#8fb4ff}
.sbp-view button.on{background:#8fb4ff;color:#0c1016;border-color:#8fb4ff}
[data-sbp-track]{cursor:pointer}
</style>`;

// The client. Kept dependency-free; draws on a canvas every animation frame while playing.
export const PLAYER_JS = `<script>
(function(){
var P=document.getElementById('sbp');if(!P)return;
var A=P.querySelector('.sbp-audio'),C=P.querySelector('.sbp-staff'),X=C.getContext('2d'),M=P.querySelector('.sbp-marquee');
var playB=P.querySelector('.sbp-play'),seek=P.querySelector('.sbp-seek'),tEl=P.querySelector('.sbp-time'),dEl=P.querySelector('.sbp-dur');
var view='notes',notes=null,shift=0,status='',cur=null;
function fmt(s){s=Math.max(0,s|0);return Math.floor(s/60)+':'+('0'+s%60).slice(-2)}
// staff geometry: treble clef, bottom line E4 (midi 64)
var STEP=[0,0,1,1,2,3,3,4,4,5,5,6],SHARP=[0,1,0,1,0,0,1,0,1,0,1,0],GAP=12,BOT=105,PX=70,LEFT=150;
function pos(m){m+=shift;var o=Math.floor(m/12)-1;return (o*7+STEP[m%12])-(4*7+2)}
var TUNE=[64,59,55,50,45,40],TN=['e','B','G','D','A','E'];
function fret(m){while(m<40)m+=12;while(m>76)m-=12;for(var s=0;s<6;s++){var f=m-TUNE[s];if(f>=0&&f<=12)return [s,f]}return null}
function load(t){cur=t;notes=null;status='';A.src=t.audio;M.textContent=(t.artist?t.artist+'  —  ':'')+t.title+'      ♪';
 if(t.notes){status='Reading the notes…';fetch(t.notes).then(function(r){return r.ok?r.json():null}).then(function(j){
  if(!j||!j.melody||!j.melody.length){status='The notes for this song are still being written out.';draw();return}
  notes=j.melody;var ps=notes.map(function(n){return n[2]}).sort(function(a,b){return a-b}),med=ps[ps.length>>1];
  shift=med<62?12*Math.ceil((66-med)/12):med>80?-12*Math.ceil((med-76)/12):0;status='';draw()}).catch(function(){status='The notes could not be loaded.';draw()})}
 else status='The notes for this song are still being written out.';draw()}
function draw(){var W=C.width,H=C.height,t=A.currentTime||0;X.clearRect(0,0,W,H);X.fillStyle='#f7f2e6';X.fillRect(0,0,W,H);
 X.strokeStyle='#3b3a36';X.fillStyle='#1d1b17';X.lineWidth=1;
 var lines=view==='tab'?6:5,top=view==='tab'?28:BOT-4*GAP,gap=view==='tab'?16:GAP;
 for(var i=0;i<lines;i++){var y=top+i*gap;X.beginPath();X.moveTo(8,y);X.lineTo(W-8,y);X.stroke()}
 X.font=view==='tab'?'bold 13px monospace':'64px serif';X.textBaseline='alphabetic';
 if(view==='tab'){for(i=0;i<6;i++)X.fillText(TN[i],12,top+i*gap+4);X.fillText('T',30,top+2*gap-2);X.fillText('A',30,top+3*gap+4);X.fillText('B',30,top+4*gap+10)}
 else X.fillText('𝄞',10,BOT+14);
 // playhead
 X.strokeStyle='rgba(47,91,211,.55)';X.lineWidth=2;X.beginPath();X.moveTo(LEFT,6);X.lineTo(LEFT,H-6);X.stroke();X.lineWidth=1;
 if(!notes){X.fillStyle='#6b665c';X.font='14px system-ui,sans-serif';X.fillText(status||'',LEFT+14,H-10);return}
 for(var k=0;k<notes.length;k++){var n=notes[k],x=LEFT+(n[0]-t)*PX;if(x<LEFT-3*PX-40||x>W+20)continue;
  var on=t>=n[0]&&t<n[0]+n[1];X.fillStyle=on?'#2f5bd3':(n[0]+n[1]<t?'#9a958a':'#1d1b17');X.strokeStyle=X.fillStyle;
  if(view==='tab'){var f=fret(n[2]);if(!f)continue;X.font='bold 14px monospace';var yy=top+f[0]*gap+5;X.fillStyle='#f7f2e6';X.fillRect(x-2,yy-12,f[1]>9?20:11,15);X.fillStyle=on?'#2f5bd3':(n[0]+n[1]<t?'#9a958a':'#1d1b17');X.fillText(String(f[1]),x,yy);continue}
  var p=pos(n[2]),y=BOT-p*GAP/2;
  for(var L=-2;L>=p;L-=2){X.beginPath();X.moveTo(x-9,BOT-L*GAP/2);X.lineTo(x+9,BOT-L*GAP/2);X.stroke()}
  for(L=10;L<=p;L+=2){X.beginPath();X.moveTo(x-9,BOT-L*GAP/2);X.lineTo(x+9,BOT-L*GAP/2);X.stroke()}
  X.beginPath();X.ellipse(x,y,6.2,4.4,-0.35,0,7);if(n[1]>=0.9){X.lineWidth=1.6;X.stroke();X.lineWidth=1}else X.fill();
  X.beginPath();if(p<4){X.moveTo(x+5.6,y-1);X.lineTo(x+5.6,y-30)}else{X.moveTo(x-5.6,y+1);X.lineTo(x-5.6,y+30)}X.stroke();
  if(SHARP[(n[2]+shift)%12]){X.font='15px serif';X.fillText('♯',x-17,y+5)}}}
function loop(){draw();if(!A.paused)requestAnimationFrame(loop)}
A.addEventListener('play',function(){playB.textContent='❚❚';playB.setAttribute('aria-label','Pause');loop()});
A.addEventListener('pause',function(){playB.textContent='▶';playB.setAttribute('aria-label','Play');draw()});
A.addEventListener('loadedmetadata',function(){dEl.textContent=fmt(A.duration)});
A.addEventListener('timeupdate',function(){tEl.textContent=fmt(A.currentTime);if(A.duration)seek.value=Math.round(1000*A.currentTime/A.duration)});
seek.addEventListener('input',function(){if(A.duration){A.currentTime=A.duration*seek.value/1000;draw()}});
playB.addEventListener('click',function(){if(!cur)return;A.paused?A.play():A.pause()});
P.querySelectorAll('.sbp-view button').forEach(function(b){b.addEventListener('click',function(){view=b.dataset.v;P.querySelectorAll('.sbp-view button').forEach(function(o){o.classList.toggle('on',o===b)});draw()})});
document.addEventListener('click',function(e){var el=e.target.closest&&e.target.closest('[data-sbp-track]');if(!el)return;e.preventDefault();
 try{load(JSON.parse(el.getAttribute('data-sbp-track')));A.play()}catch(err){}});
if(location.hash==='#tab'){view='tab';P.querySelectorAll('.sbp-view button').forEach(function(o){o.classList.toggle('on',o.dataset.v==='tab')})}
var first=P.getAttribute('data-sbp-first');if(first){try{load(JSON.parse(first))}catch(e){}}else draw();
})();
</script>`;
