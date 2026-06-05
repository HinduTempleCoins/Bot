/**
 * autovote/views.js — server-rendered HTML.
 *
 * Two pages: login and dashboard. Dashboard fetches /api/state and renders
 * trails / fanbases / schedules / history with add + pause/resume + delete.
 */

const BANNER = `<div style="background:#7a1f1f;color:#fff;padding:10px 16px;font-weight:600;text-align:center">
  ⚠ TESTNET ONLY — use throwaway posting keys. This service stores your key
  server-side to vote on schedule. Never enter a mainnet key. (OAuth + MELEK-Signer replaces this later.)
</div>`;

const STYLE = `<style>
  :root{--bg:#0f1115;--card:#1a1d24;--ink:#e6e6e6;--muted:#9aa0aa;--acc:#4da3ff;--ok:#3ecf8e;--warn:#e0a33e}
  *{box-sizing:border-box}
  body{margin:0;font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--ink)}
  a{color:var(--acc)}
  .wrap{max-width:980px;margin:0 auto;padding:20px}
  h1{font-size:22px;margin:0} h2{font-size:17px;border-bottom:1px solid #2a2e38;padding-bottom:6px;margin-top:28px}
  .card{background:var(--card);border:1px solid #2a2e38;border-radius:10px;padding:16px;margin:12px 0}
  label{display:block;font-size:13px;color:var(--muted);margin:8px 0 2px}
  input,select{width:100%;padding:8px;border-radius:7px;border:1px solid #2a2e38;background:#0f1115;color:var(--ink)}
  .row{display:flex;gap:12px;flex-wrap:wrap}.row>div{flex:1;min-width:120px}
  button{background:var(--acc);color:#001;border:0;border-radius:7px;padding:9px 14px;font-weight:600;cursor:pointer;margin-top:10px}
  button.sm{padding:4px 9px;font-size:12px;margin:0}
  button.ghost{background:#2a2e38;color:var(--ink)}
  table{width:100%;border-collapse:collapse;font-size:13px}
  td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #232733}
  .pill{font-size:11px;padding:1px 7px;border-radius:20px;background:#2a2e38}
  .pill.paused{background:var(--warn);color:#000}
  .pill.ok{background:var(--ok);color:#001}.pill.err{background:#7a1f1f}
  .topbar{display:flex;justify-content:space-between;align-items:center}
  .muted{color:var(--muted)} code{background:#0f1115;padding:1px 5px;border-radius:4px}
</style>`;

export function loginPage() {
  return `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">
  <title>MELEK Auto-Vote — Login</title>${STYLE}</head><body>${BANNER}
  <div class="wrap">
    <h1>MELEK Auto-Vote</h1>
    <p class="muted">A Hive.Vote-style auto-voting / curation platform for the MELEK testnet.</p>
    <div class="card" style="max-width:420px">
      <h2 style="margin-top:0;border:0">Log in</h2>
      <label>Testnet username</label><input id=u placeholder="e.g. initminer">
      <label>Posting key (WIF, throwaway)</label><input id=k type=password placeholder="5J...">
      <button id=go>Log in</button>
      <p id=msg class=muted style="margin-top:10px"></p>
      <p class=muted style="font-size:12px">Your key is validated against the account on the testnet,
      then held server-side so the engine can vote on your rules. Testnet only.</p>
    </div>
  </div>
  <script>
    const $=s=>document.querySelector(s);
    $('#go').onclick=async()=>{
      $('#msg').textContent='checking key on-chain…';
      const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({username:$('#u').value,postingKey:$('#k').value})});
      const d=await r.json();
      if(r.ok){location.href='/'}else{$('#msg').textContent=d.error||'login failed'}
    };
    $('#k').addEventListener('keydown',e=>{if(e.key==='Enter')$('#go').click()});
  </script></body></html>`;
}

export function page(username) {
  return `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">
  <title>MELEK Auto-Vote — ${username}</title>${STYLE}</head><body>${BANNER}
  <div class="wrap">
    <div class="topbar">
      <h1>Auto-Vote <span class=muted style="font-size:14px">— @${username}</span></h1>
      <div><span id=today class=pill></span> <a href="/logout"><button class="ghost sm">Log out</button></a></div>
    </div>

    <h2>Curation trails <span class=muted style="font-size:12px">— follow another account's upvotes</span></h2>
    <div class="card">
      <div class=row>
        <div><label>Leader account</label><input id=t_target placeholder="account to follow"></div>
        <div><label>Weight %</label><input id=t_weight type=number value=100></div>
        <div><label>Delay (sec)</label><input id=t_delay type=number value=5></div>
        <div><label>Daily cap (0=∞)</label><input id=t_cap type=number value=0></div>
      </div>
      <button onclick="addTrail()">Add trail</button>
    </div>
    <div id=trails></div>

    <h2>Fanbase <span class=muted style="font-size:12px">— auto-vote authors' new posts</span></h2>
    <div class="card">
      <div class=row>
        <div><label>Authors (comma/space separated)</label><input id=f_authors placeholder="alice bob"></div>
        <div><label>Weight %</label><input id=f_weight type=number value=100></div>
        <div><label>Delay (sec)</label><input id=f_delay type=number value=10></div>
        <div><label>Max / day (0=∞)</label><input id=f_max type=number value=0></div>
      </div>
      <button onclick="addFanbase()">Add fanbase</button>
    </div>
    <div id=fanbases></div>

    <h2>Scheduled votes <span class=muted style="font-size:12px">— vote a specific post at a time</span></h2>
    <div class="card">
      <div class=row>
        <div><label>Author</label><input id=s_author></div>
        <div><label>Permlink</label><input id=s_perm></div>
        <div><label>Weight %</label><input id=s_weight type=number value=100></div>
        <div><label>Vote at (blank=now)</label><input id=s_when type=datetime-local></div>
      </div>
      <button onclick="addSchedule()">Schedule vote</button>
    </div>
    <div id=schedules></div>

    <h2>Vote history</h2>
    <div class="card"><div id=history class=muted>loading…</div></div>
  </div>
  <script>${CLIENT_JS}</script></body></html>`;
}

const CLIENT_JS = `
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function api(p,m='GET',b){const o={method:m,headers:{'Content-Type':'application/json'}};if(b)o.body=JSON.stringify(b);
  const r=await fetch(p,o);return r.json();}
function pauseBtn(kind,r){return '<button class="ghost sm" onclick="togglePause(\\''+kind+'\\',\\''+r.id+'\\','+(!r.paused)+')">'+(r.paused?'Resume':'Pause')+'</button>';}
function delBtn(kind,r){return '<button class="ghost sm" onclick="del(\\''+kind+'\\',\\''+r.id+'\\')">✕</button>';}
function status(r){return r.paused?'<span class="pill paused">paused</span>':'<span class="pill ok">active</span>';}
async function load(){
  const d=await api('/api/state');
  $('#today').textContent=d.votesToday+' votes today';
  $('#trails').innerHTML = d.trails.length? d.trails.map(r=>'<div class=card>'+status(r)+' follow <b>@'+esc(r.target)+'</b> at '+r.weight+'% · delay '+(r.delayMs/1000)+'s · cap '+(r.dailyCap||'∞')+' &nbsp; '+pauseBtn('trails',r)+' '+delBtn('trails',r)+'</div>').join('') : '<p class=muted>no trails</p>';
  $('#fanbases').innerHTML = d.fanbases.length? d.fanbases.map(r=>'<div class=card>'+status(r)+' authors <b>'+r.authors.map(esc).join(', ')+'</b> at '+r.weight+'% · delay '+(r.delayMs/1000)+'s · max/day '+(r.maxPerDay||'∞')+' &nbsp; '+pauseBtn('fanbases',r)+' '+delBtn('fanbases',r)+'</div>').join('') : '<p class=muted>no fanbases</p>';
  $('#schedules').innerHTML = d.schedules.length? d.schedules.map(r=>'<div class=card>'+(r.done?'<span class="pill ok">done</span>':status(r))+' @'+esc(r.author)+'/'+esc(r.permlink)+' w='+r.weight+' at '+new Date(r.voteAt).toLocaleString()+' &nbsp; '+(r.done?'':pauseBtn('schedules',r)+' ')+delBtn('schedules',r)+'</div>').join('') : '<p class=muted>no scheduled votes</p>';
  $('#history').innerHTML = d.votes.length? '<table><tr><th>when</th><th>post</th><th>w</th><th>rule</th><th>tx</th></tr>'+d.votes.map(v=>'<tr><td>'+new Date(v.at).toLocaleTimeString()+'</td><td>@'+esc(v.author)+'/'+esc(v.permlink).slice(0,28)+'</td><td>'+v.weight+'</td><td>'+esc(v.rule)+'</td><td>'+(v.ok?'<code>'+esc((v.txId||'').slice(0,10))+'</code>':'<span class="pill err">'+esc((v.error||'fail').slice(0,30))+'</span>')+'</td></tr>').join('')+'</table>' : '<span class=muted>no votes yet</span>';
}
async function addTrail(){await api('/api/trail','POST',{target:$('#t_target').value,weight:$('#t_weight').value,delaySec:$('#t_delay').value,dailyCap:$('#t_cap').value});$('#t_target').value='';load();}
async function addFanbase(){await api('/api/fanbase','POST',{authors:$('#f_authors').value,weight:$('#f_weight').value,delaySec:$('#f_delay').value,maxPerDay:$('#f_max').value});$('#f_authors').value='';load();}
async function addSchedule(){await api('/api/schedule','POST',{author:$('#s_author').value,permlink:$('#s_perm').value,weight:$('#s_weight').value,voteAt:$('#s_when').value||null});$('#s_author').value='';$('#s_perm').value='';load();}
async function togglePause(kind,id,paused){await api('/api/pause','POST',{kind,id,paused});load();}
async function del(kind,id){if(confirm('Delete this rule?')){await api('/api/delete','POST',{kind,id});load();}}
load();setInterval(load,5000);
`;
