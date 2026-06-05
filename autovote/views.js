/**
 * autovote/views.js — server-rendered HTML (chain-agnostic).
 *
 * Pages:
 *   loginPage      — pick a chain + auth method (HiveSigner / WhaleVault / posting key)
 *   dashboardPage  — trails / fanbases / schedules / history; auth-aware
 *                    (WhaleVault = in-browser signing only)
 *   teachPage      — guided setup: install WhaleVault, authorize HiveSigner,
 *                    create/import an account, connect, build bots/trails/fanbases
 *   awarenessPage  — the other Graphene forums exist (Steem/Hive/Blurt); ours is
 *                    MELEK; MELEK-Signer is coming
 */

const STYLE = `<style>
  :root{--bg:#0f1115;--card:#1a1d24;--ink:#e6e6e6;--muted:#9aa0aa;--acc:#4da3ff;--ok:#3ecf8e;--warn:#e0a33e;--bad:#7a1f1f}
  *{box-sizing:border-box}
  body{margin:0;font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--ink)}
  a{color:var(--acc)}
  .wrap{max-width:980px;margin:0 auto;padding:20px}
  h1{font-size:22px;margin:0} h2{font-size:17px;border-bottom:1px solid #2a2e38;padding-bottom:6px;margin-top:28px}
  h3{font-size:15px;margin:18px 0 4px}
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
  .pill.ok{background:var(--ok);color:#001}.pill.err{background:var(--bad)}
  .pill.beta{background:var(--warn);color:#000}.pill.test{background:#2d5a8a;color:#fff}
  .topbar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
  .muted{color:var(--muted)} code{background:#0f1115;padding:1px 5px;border-radius:4px}
  .banner{padding:10px 16px;font-weight:600;text-align:center}
  .banner.test{background:#2d5a8a;color:#fff}
  .banner.beta{background:var(--warn);color:#000}
  .tabs{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
  .tab{padding:7px 12px;border-radius:7px;background:#2a2e38;cursor:pointer;font-size:13px}
  .tab.on{background:var(--acc);color:#001;font-weight:600}
  .hide{display:none}
  .nav{display:flex;gap:14px;font-size:13px;margin:6px 0 14px}
  ol li,ul li{margin:4px 0}
  .note{border-left:3px solid var(--acc);padding:6px 12px;background:#13161c;margin:10px 0;border-radius:0 7px 7px 0}
  .warn{border-left-color:var(--warn)}
</style>`;

const NAV = `<div class=nav><a href="/">Dashboard</a><a href="/teach">Setup guides</a><a href="/about">Other chains &amp; signers</a></div>`;

// ── LOGIN ────────────────────────────────────────────────────────────────────
export function loginPage() {
  return `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">
  <title>MELEK Auto-Vote — Log in</title>${STYLE}</head><body>
  <div class=wrap>
    <h1>MELEK Auto-Vote</h1>
    <p class=muted>A chain-agnostic Hive.Vote-style auto-voting / curation platform. Pick your chain, then connect
      with a signer — keyless wherever the signer supports it. You never have to trust us with your keys.</p>
    ${NAV}
    <div class=card style="max-width:520px">
      <h2 style="margin-top:0;border:0">Log in</h2>
      <label>Chain</label>
      <select id=chain></select>
      <div id=banner></div>

      <div class=tabs id=methodTabs></div>

      <div id=m_hivesigner class=hide>
        <p class=muted>HiveSigner authorizes vote ops with a <b>revocable token</b> — keyless, and it works even
          while you're offline (best for scheduled votes). <a href="/teach/hivesigner">How to set up &rsaquo;</a></p>
        <button id=hsGo>Connect with HiveSigner</button>
        <p id=hsPending class="muted hide" style="margin-top:8px">⏳ HiveSigner app registration is pending —
          this button activates once the operator registers our app. <a href="/teach/hivesigner">Details &rsaquo;</a></p>
      </div>

      <div id=m_whalevault class=hide>
        <p class=muted>WhaleVault signs in your browser. It can only sign while this tab is open, so automated/scheduled
          votes run <b>in-browser</b> (keep the tab open) — we never hold a key. <a href="/teach/whalevault">How to set up &rsaquo;</a></p>
        <label>Username</label><input id=wvUser placeholder="your account">
        <button id=wvGo>Connect with WhaleVault</button>
        <p id=wvMsg class=muted style="margin-top:8px"></p>
      </div>

      <div id=m_postingkey class=hide>
        <p class=muted><b>Least-preferred.</b> Stores your posting key server-side so we can vote on a schedule.
          Use a <b>throwaway testnet key only</b> — never a key that controls value.</p>
        <label>Username</label><input id=pkUser placeholder="account">
        <label>Posting key (WIF, throwaway)</label><input id=pkKey type=password placeholder="5J...">
        <button id=pkGo>Log in with posting key</button>
        <p id=pkMsg class=muted style="margin-top:8px"></p>
      </div>
    </div>
  </div>
  <script>${LOGIN_JS}</script></body></html>`;
}

const LOGIN_JS = `
const $=s=>document.querySelector(s);
let CFG=null;
const METHOD_LABEL={hivesigner:'HiveSigner',whalevault:'WhaleVault',postingkey:'Posting key'};
async function boot(){
  CFG=await (await fetch('/api/config')).json();
  const sel=$('#chain'); sel.innerHTML='';
  for(const c of CFG.chains){const o=document.createElement('option');o.value=c.id;
    o.textContent=c.label;if(c.id===CFG.defaultChain)o.selected=true;sel.appendChild(o);}
  sel.onchange=renderChain; renderChain();
}
function chainCfg(){return CFG.chains.find(c=>c.id===$('#chain').value);}
function renderChain(){
  const c=chainCfg();
  // banner
  let b='';
  if(c.network==='testnet') b='<div class="banner test" style="margin:10px 0;border-radius:7px">TESTNET — '+c.label+'. Safe to experiment with throwaway keys.</div>';
  else b='<div class="banner beta" style="margin:10px 0;border-radius:7px">MAINNET (beta) — '+c.label+'. Real votes. Multi-chain support is present but unverified-live; broadcasting is operator-gated.</div>';
  $('#banner').innerHTML=b;
  // method tabs
  const tabs=$('#methodTabs'); tabs.innerHTML='';
  ['hivesigner','whalevault','postingkey'].forEach(m=>{
    if(!c.authMethods.includes(m)) return;
    const t=document.createElement('div'); t.className='tab'; t.textContent=METHOD_LABEL[m]+(m==='postingkey'?' (least-preferred)':'');
    t.dataset.m=m; t.onclick=()=>selMethod(m); tabs.appendChild(t);
  });
  // default to first non-postingkey method if available
  const pref=c.authMethods.find(m=>m!=='postingkey')||c.authMethods[0];
  selMethod(pref);
  if(c.signerNote) $('#banner').innerHTML+='<p class=muted style="font-size:12px">'+c.signerNote+'</p>';
}
function selMethod(m){
  document.querySelectorAll('#methodTabs .tab').forEach(t=>t.classList.toggle('on',t.dataset.m===m));
  ['hivesigner','whalevault','postingkey'].forEach(x=>$('#m_'+x).classList.toggle('hide',x!==m));
  if(m==='hivesigner'){
    const ok=CFG.hivesigner.configured;
    $('#hsGo').classList.toggle('hide',!ok); $('#hsPending').classList.toggle('hide',ok);
  }
}
$('#hsGo').onclick=()=>{location.href='/hivesigner/login?chain='+encodeURIComponent($('#chain').value);};
$('#wvGo').onclick=async()=>{
  const chain=$('#chain').value, c=chainCfg();
  if(typeof window.whale_vault==='undefined'){
    $('#wvMsg').innerHTML='WhaleVault not detected. <a href="/teach/whalevault">Install it &rsaquo;</a>';return;}
  const user=$('#wvUser').value.trim(); if(!user){$('#wvMsg').textContent='enter a username';return;}
  $('#wvMsg').textContent='requesting signature in WhaleVault…';
  // Prove control by signing a challenge with the posting key (no key leaves the extension).
  const challenge='autovote-login:'+chain+':'+user+':'+Date.now();
  window.whale_vault.requestSignBuffer('autovote',user,challenge,'Posting',async (r)=>{
    if(!r||r.error){$('#wvMsg').textContent='WhaleVault: '+(r&&r.error?r.error:'declined');return;}
    const res=await fetch('/api/login/whalevault',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chain,username:user})});
    if(res.ok)location.href='/'; else $('#wvMsg').textContent='login failed';
  },null,c.label);
};
$('#pkGo').onclick=async()=>{
  $('#pkMsg').textContent='checking key on-chain…';
  const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chain:$('#chain').value,username:$('#pkUser').value,postingKey:$('#pkKey').value})});
  const d=await r.json();
  if(r.ok)location.href='/'; else $('#pkMsg').textContent=d.error||'login failed';
};
boot();
`;

// ── DASHBOARD ────────────────────────────────────────────────────────────────
export function dashboardPage(chain, username) {
  return `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">
  <title>Auto-Vote — ${username}</title>${STYLE}</head><body>
  <div id=topbanner></div>
  <div class=wrap>
    <div class=topbar>
      <h1>Auto-Vote <span class=muted style="font-size:14px">— @${username}</span> <span id=chainpill class=pill></span></h1>
      <div><span id=today class=pill></span> <a href="/teach"><button class="ghost sm">Setup guides</button></a>
        <a href="/logout"><button class="ghost sm">Log out</button></a></div>
    </div>
    <div id=authnote></div>

    <h2>Curation trails <span class=muted style="font-size:12px">— follow another account's upvotes</span></h2>
    <div class=card>
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
    <div class=card>
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
    <div class=card>
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
    <div class=card><div id=history class=muted>loading…</div></div>
  </div>
  <script>${DASH_JS}</script></body></html>`;
}

const DASH_JS = `
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let STATE=null;
async function api(p,m='GET',b){const o={method:m,headers:{'Content-Type':'application/json'}};if(b)o.body=JSON.stringify(b);
  const r=await fetch(p,o);return r.json();}
function pauseBtn(kind,r){return '<button class="ghost sm" onclick="togglePause(\\''+kind+'\\',\\''+r.id+'\\','+(!r.paused)+')">'+(r.paused?'Resume':'Pause')+'</button>';}
function delBtn(kind,r){return '<button class="ghost sm" onclick="del(\\''+kind+'\\',\\''+r.id+'\\')">✕</button>';}
function status(r){return r.paused?'<span class="pill paused">paused</span>':'<span class="pill ok">active</span>';}
async function load(){
  const d=await api('/api/state'); STATE=d;
  $('#chainpill').textContent=d.chainLabel||d.chain;
  $('#chainpill').className='pill '+(d.network==='testnet'?'test':'beta');
  $('#today').textContent=d.votesToday+' votes today';
  // banners
  if(d.network==='testnet') $('#topbanner').innerHTML='<div class="banner test">TESTNET — '+esc(d.chainLabel)+'. Throwaway keys only.</div>';
  else $('#topbanner').innerHTML='<div class="banner beta">MAINNET (beta) — '+esc(d.chainLabel)+'.'+(d.mainnetBlocked?' Broadcasting is operator-gated; votes are recorded but not sent until enabled.':'')+'</div>';
  // auth note
  if(d.inBrowserOnly) $('#authnote').innerHTML='<div class="note warn">You\\'re signed in with <b>WhaleVault</b>. WhaleVault can only sign while this tab is open, so your rules run <b>in-browser</b> — keep this tab open for scheduled/auto votes. For offline automation, use HiveSigner instead. <a href="/teach/whalevault">Learn more &rsaquo;</a></div>';
  else if(d.authMethod==='hivesigner') $('#authnote').innerHTML='<div class="note">Signed in with <b>HiveSigner</b> (keyless, offline-capable). Your scheduled votes fire even when you\\'re away.</div>';
  else if(d.authMethod==='postingkey') $('#authnote').innerHTML='<div class="note warn">Signed in with a stored <b>posting key</b> (least-preferred). Use throwaway keys only. Prefer HiveSigner/WhaleVault where available. <a href="/teach">Setup guides &rsaquo;</a></div>';
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

// ── TEACHING / SETUP GUIDES ──────────────────────────────────────────────────
function teachShell(title, inner) {
  return `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">
  <title>${title}</title>${STYLE}</head><body><div class=wrap>
    <h1>${title}</h1>${NAV}${inner}</div></body></html>`;
}

export function teachPage(topic, opts = {}) {
  if (topic === 'whalevault') {
    return teachShell('Set up WhaleVault', `
    <div class=note>WhaleVault is a browser extension that holds your keys locally and signs for you. The site never
      sees a key. On WhaleVault, signing happens only while this tab is open — perfect for hands-on voting; for
      <i>offline</i> automation use <a href="/teach/hivesigner">HiveSigner</a>.</div>
    <h2>1 — Install the extension</h2>
    <ul>
      <li><a href="https://chromewebstore.google.com/detail/whalevault/decmcccbiclgbjmihfgocmighfgoblom" target=_blank rel=noopener>Chrome / Brave / Edge — WhaleVault on the Chrome Web Store</a></li>
      <li><a href="https://addons.mozilla.org/firefox/addon/whalevault/" target=_blank rel=noopener>Firefox — WhaleVault add-on</a></li>
    </ul>
    <h2>2 — Create or import your account</h2>
    <ol>
      <li>Open WhaleVault, set a strong unlock password.</li>
      <li>Click <b>Add Key</b> → pick the chain (Hive / Steem / Blurt).</li>
      <li>Paste your account's <b>posting key</b> (lowest-privilege key — fine for voting). Import the posting key only.</li>
    </ol>
    <h2>3 — Connect to this site</h2>
    <ol>
      <li>Go to the <a href="/">login page</a>, choose your chain, pick the <b>WhaleVault</b> tab.</li>
      <li>Enter your username and click <b>Connect with WhaleVault</b>.</li>
      <li>Approve the signature request in the WhaleVault popup. That's it — no key ever leaves the extension.</li>
    </ol>
    <h2>4 — Set up bots / trails / fanbases</h2>
    <p>On the dashboard, add curation trails, fanbases, or scheduled votes. <b>Keep this tab open</b> so WhaleVault can
      sign them. For away-from-keyboard automation, switch to HiveSigner.</p>
    <div class=note>You never need the real hive.vote. Your rules live here, and you sign with your own extension.</div>`);
  }

  if (topic === 'hivesigner' || topic === 'hivesigner-pending') {
    const pending = topic === 'hivesigner-pending' || opts.configured === false;
    return teachShell('Set up HiveSigner', `
    <div class=note>HiveSigner (Hive) gives this site a <b>revocable token</b> with only the <code>vote</code> scope —
      no key, and you can revoke it any time at <a href="https://hivesigner.com" target=_blank rel=noopener>hivesigner.com</a>.
      Because it works server-side, your <b>scheduled votes fire even while you're offline</b>.</div>
    ${pending ? `<div class="note warn">⏳ <b>App registration pending.</b> HiveSigner requires us to register this
      site as a HiveSigner app before the "Connect with HiveSigner" button works. The operator is completing that
      registration. Until then, use WhaleVault or a throwaway posting key. This page will activate automatically once
      registration is done.</div>` : ''}
    <h2>1 — You need a Hive account</h2>
    <p>Get one at <a href="https://signup.hive.io" target=_blank rel=noopener>signup.hive.io</a> (or any Hive onboarding
      service). Keep your keys safe; you'll never paste them here.</p>
    <h2>2 — Authorize this app</h2>
    <ol>
      <li>On the <a href="/">login page</a>, choose <b>HIVE</b>, pick the <b>HiveSigner</b> tab.</li>
      <li>Click <b>Connect with HiveSigner</b> — you go to hivesigner.com.</li>
      <li>Log in there (with HiveSigner's own secure login), and approve the <code>vote</code> scope for this app.</li>
      <li>You're redirected back here, logged in. We hold only a revocable vote-only token.</li>
    </ol>
    <h2>3 — Build your automation</h2>
    <p>Add trails / fanbases / scheduled votes on the dashboard. They run on our server using your token — no need to
      keep a tab open.</p>
    <h2>Revoke any time</h2>
    <p>Visit <a href="https://hivesigner.com" target=_blank rel=noopener>hivesigner.com</a> → Apps → revoke. The token
      dies instantly; we can no longer vote for you.</p>`);
  }

  if (topic === 'postingkey') {
    return teachShell('Posting-key login (least-preferred)', `
    <div class="note warn">This stores your posting key on our server so we can vote on a schedule. Prefer
      <a href="/teach/hivesigner">HiveSigner</a> or <a href="/teach/whalevault">WhaleVault</a> — they never give us a
      key. Use posting-key login <b>only</b> with a throwaway/testnet account, never one that controls value.</div>
    <h2>When it's OK</h2>
    <ul><li>MELEK testnet experiments with disposable keys.</li>
      <li>You understand the key is stored server-side and accept that.</li></ul>
    <h2>How</h2>
    <ol><li>Login page → your chain → <b>Posting key</b> tab.</li>
      <li>Enter username + posting WIF. We validate it on-chain, then store it.</li></ol>
    <p>On MELEK, <b>MELEK-Signer</b> will replace stored keys with a scoped, revocable token — same keyless model as
      HiveSigner. <a href="/about">More &rsaquo;</a></p>`);
  }

  // index
  return teachShell('Setup guides', `
    <p class=muted>Set up everything here — your signer, your account, and your auto-voting — so you never need the real
      hive.vote and never trust us with your keys.</p>
    <div class=card><h3><a href="/teach/whalevault">① Install &amp; connect WhaleVault</a></h3>
      <p class=muted>Browser-extension signing (Hive / Steem / Blurt). Keyless. Signs while your tab is open.</p></div>
    <div class=card><h3><a href="/teach/hivesigner">② Authorize with HiveSigner</a></h3>
      <p class=muted>OAuth token for Hive. Keyless and offline-capable — best for scheduled votes.
        ${opts.configured === false ? '<span class="pill beta">app registration pending</span>' : ''}</p></div>
    <div class=card><h3><a href="/teach/postingkey">③ Posting-key login (least-preferred)</a></h3>
      <p class=muted>Server-side key storage. Throwaway / testnet only. MELEK default until MELEK-Signer ships.</p></div>
    <div class=card><h3><a href="/about">Other chains &amp; signers — what exists, and where we fit</a></h3></div>`);
}

// ── AWARENESS ────────────────────────────────────────────────────────────────
export function awarenessPage(chains) {
  const rows = chains.map((c) => `<tr>
    <td><b>${c.label}</b></td>
    <td>${c.network === 'testnet' ? '<span class="pill test">testnet</span>' : '<span class="pill beta">mainnet (beta)</span>'}</td>
    <td>${c.authMethods.join(', ')}</td>
    <td><a href="${c.explorer}" target=_blank rel=noopener>explorer</a></td>
  </tr>`).join('');
  return teachShell('Other chains &amp; signers', `
    <p>The Graphene family has several public social blockchains — they all exist, and you may have accounts on more
      than one:</p>
    <ul>
      <li><b>HIVE</b> — a large active social chain. HiveSigner &amp; WhaleVault both work here.</li>
      <li><b>STEEM</b> — the original; WhaleVault works here.</li>
      <li><b>BLURT</b> — a lighter fork; WhaleVault works here.</li>
      <li><b>MELEK</b> — <b>ours</b> (currently a testnet). Our own signer, <b>MELEK-Signer</b>, is coming; until then
        MELEK uses a throwaway posting key.</li>
    </ul>
    <div class=note>We can't add MELEK to WhaleVault or HiveSigner ourselves (those are maintained by other teams) —
      so we're building <b>MELEK-Signer</b>, the keyless signer for our chain. On Hive/Steem/Blurt you can already use
      the existing signers right here, keylessly.</div>
    <h2>Chains on this platform</h2>
    <div class=card><table><tr><th>Chain</th><th>Status</th><th>Signers</th><th></th></tr>${rows}</table></div>
    <p class=muted style="font-size:12px">Mainnet (Hive/Steem/Blurt) support is present-but-unverified-live and
      broadcasting is operator-gated while we test. We never touch operator keys, and we never broadcast a mainnet
      vote during testing.</p>`);
}
