// server.mjs — The Writing Room (write.soapbox.community). Preptober + the November 50,000-word
// challenge, and a private drafting studio that keeps your work in YOUR browser.
//
// WHY THIS EXISTS. NaNoWriMo dissolved on 2026-03-31 (financial, after the moderation and AI
// controversies cost it trust and donors), and its site, database and 25 years of archives went
// offline with it. The challenge survived; the commons did not. site/writing/history.mjs holds the
// graded record, and the design here is a direct answer to it:
//
//   * YOUR WORDS NEVER LEAVE YOUR BROWSER. Everything is localStorage. There is no account, no
//     server-side store, no upload. We cannot read your draft, lose your draft, or take it with us
//     if this surface ever shuts down — and the Export button is first-class, not buried, so you
//     always hold a copy that outlives us.
//   * NO PAYOUTS. Writing here earns nothing and is scored by nothing. Posting to MELEK afterwards
//     is a separate, optional choice you make with a finished draft (operator rule, 2026-10-01).
//   * NO AI VERDICT. We do not ban AI and we do not push it. There is one optional self-declared
//     tag on an exported draft, because the thing writers were never offered was simply saying what
//     they used.
//
//   PORT=8224 BASE_URL=https://write.soapbox.community node site/writing/server.mjs
//
// ── Routes ────────────────────────────────────────────────────────────────────────────────────
//   /            the challenge: goal, daily target, pace, streak, log, export
//   /preptober   October prep — the planning cards, stored locally like everything else
//   /history     what happened to NaNoWriMo, graded, with the unverifiable claims marked as such
//   /health /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────
//   esc() every interpolated value. localStorage reads AND writes in try/catch; the page renders
//   with no stored value. No network at runtime, no CDN, no tracker. Unknown path → 404, never 500.

import { createServer } from 'node:http';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import { TIMELINE, SUCCESSORS, UNVERIFIED, LESSONS, POSITION } from './history.mjs';
import { WATCHING, OURS, WHY } from './watching.mjs';

const PORT = +(process.env.PORT || 8224);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'The Writing Room';
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The challenge is a pure function of goal, days and words written — exported so tests can check the maths. */
export function pace({ goal = 50000, days = 30, written = 0, dayNumber = 1 } = {}) {
  const g = Math.max(1, Math.round(+goal || 0));
  const d = Math.max(1, Math.round(+days || 0));
  const w = Math.max(0, Math.round(+written || 0));
  const day = Math.min(Math.max(1, Math.round(+dayNumber || 1)), d);
  const parTotal = Math.round((g / d) * day);
  const remaining = Math.max(0, g - w);
  const daysLeft = Math.max(0, d - day);
  return {
    goal: g, days: d, written: w, day,
    dailyTarget: Math.ceil(g / d),
    parTotal,
    ahead: w - parTotal,
    remaining,
    daysLeft,
    // what you need per remaining day to still finish; on the last day it is simply what is left
    needPerDay: daysLeft > 0 ? Math.ceil(remaining / daysLeft) : remaining,
    percent: Math.min(100, Math.round((w / g) * 1000) / 10),
    done: w >= g,
  };
}

const STYLE = `<style>
:root{--ink:#1a1714;--mut:#6b625a;--line:#ddd3c6;--bg:#faf7f2;--card:#fff;--acc:#7a5c45;--good:#2f6b43}
@media(prefers-color-scheme:dark){:root{--ink:#eee7dd;--mut:#a79c90;--line:#3a332c;--bg:#17150f;--card:#201d17}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 Georgia,'Iowan Old Style',serif}
.topbar{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.brand{font-weight:700;text-decoration:none;color:var(--ink);font-size:18px}.brand span{color:var(--acc)}
.topbar-r a{margin-left:14px;color:var(--mut);text-decoration:none;font-size:14px}.topbar-r a:hover{color:var(--ink)}
.wrap{max-width:860px;margin:0 auto;padding:24px 16px 72px}
h1{font-size:30px;line-height:1.2;margin:.2em 0 .3em}h2{font-size:21px;margin:1.6em 0 .4em}h3{font-size:17px;margin:1.3em 0 .3em}
.muted{color:var(--mut)}.small{font-size:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:14px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.stat{text-align:center}.stat b{display:block;font-size:26px;font-variant-numeric:tabular-nums}.stat span{font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.04em}
.bar{height:14px;background:var(--line);border-radius:999px;overflow:hidden;margin:10px 0}
.bar i{display:block;height:100%;background:var(--acc);width:0}
input,textarea,select,button{font:inherit;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 10px}
textarea{width:100%;min-height:150px;font-family:ui-monospace,Menlo,monospace;font-size:14px}
button{cursor:pointer;background:var(--acc);color:#fff;border-color:var(--acc)}button.ghost{background:transparent;color:var(--ink);border-color:var(--line)}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.g{display:inline-block;font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid var(--line);color:var(--mut);text-transform:uppercase;letter-spacing:.04em}
.g.established{color:var(--good);border-color:var(--good)}.g.contested{color:#9a6a1f;border-color:#9a6a1f}.g.unverified{color:#9a3b35;border-color:#9a3b35}
footer{border-top:1px solid var(--line);padding:18px 16px;color:var(--mut);font-size:13px;text-align:center}
a{color:var(--acc)}
</style>`;

const NAV = `<a href="${bp('/')}">The challenge</a><a href="${bp('/watch')}">The Watch</a><a href="${bp('/history')}">What happened</a>`;
const FOOTER = `<footer>Your writing stays in your browser — we never receive it. <a href="${bp('/history')}">Why that matters</a>.<br>Part of <a href="https://soapbox.community">SoapBox</a>. No payouts, no scoring, no account.</footer>`;

function pageHtml(title, body, opts = {}) {
  const desc = opts.description || 'A free, private writing challenge — 50,000 words in 30 days. Your draft stays in your browser. No account, no payouts, no scoring.';
  const head = headTags({
    title, description: desc, canonical: opts.canonical || `${BASE_URL}${opts.path || '/'}`,
    siteName: SITE_NAME, robots: opts.robots || 'index,follow,max-image-preview:large',
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}</head><body>
<header class=topbar><a class=brand href="${bp('/')}">✒ The Writing <span>Room</span></a><nav class=topbar-r>${NAV}</nav></header>
<main class=wrap>${body}</main>${FOOTER}</body></html>`;
}

const d = pace({});
const CHALLENGE = `<h1>50,000 words. 30 days. Nobody watching.</h1>
<p class=muted><b>November is a national month.</b> Like April is National Poetry Month — an observance, a date, a thing a country does. A charity used to host the scoreboard and it closed in 2025; <b>the month did not close with it</b>, and nobody needs permission to observe November.</p>
<p class=muted>Every other successor rebuilt the thing that killed it: an account, a login, a database on somebody else's machine under somebody else's budget. <b>Your draft never leaves your browser.</b> No account. No leaderboard. No payouts. Nothing for us to lose when we're gone — because we never had it. <a href="${bp('/history')}">Here is the whole argument</a>.</p>

<div class="card grid">
  <div class=stat><b id=s-words>0</b><span>words written</span></div>
  <div class=stat><b id=s-pct>0%</b><span>of goal</span></div>
  <div class=stat><b id=s-need>${d.dailyTarget}</b><span>needed per day</span></div>
  <div class=stat><b id=s-streak>0</b><span>day streak</span></div>
</div>
<div class=bar><i id=bar></i></div>
<p class=small id=verdict>Set your goal and log your first day.</p>

<div class=card>
  <h3>Log today</h3>
  <p class=small>Enter a running total, or paste your draft and we'll count it <em>in your browser</em> — the text is never sent anywhere.</p>
  <p><label>Total words so far <input id=in-words type=number min=0 step=1 value=0 style="width:140px"></label>
     <button type=button id=btn-log>Save today</button></p>
  <details><summary class=small>Paste a draft to count instead</summary>
    <textarea id=in-text placeholder="Paste your draft here — it is counted locally and never uploaded."></textarea>
    <p><button type=button class=ghost id=btn-count>Count it</button> <span class=small id=count-out></span></p></details>
</div>

<div class=card>
  <h3>Your challenge</h3>
  <p><label>Goal <input id=in-goal type=number min=1 step=500 value=50000 style="width:120px"></label>
     <label style="margin-left:14px">Days <input id=in-days type=number min=1 max=366 value=30 style="width:80px"></label>
     <label style="margin-left:14px">Start <input id=in-start type=date style="width:160px"></label></p>
  <p class=small class=muted>Defaults are the classic 50,000 in 30 days starting November 1. Change them to whatever you're actually doing — this is your tool.</p>
</div>

<div class=card>
  <h3>Your log</h3>
  <table><thead><tr><th>Day</th><th>Date</th><th>Total</th><th>Written</th></tr></thead><tbody id=logbody></tbody></table>
  <p class=small id=log-empty>Nothing logged yet.</p>
  <p><button type=button class=ghost id=btn-export>⬇ Export .json</button>
     <button type=button class=ghost id=btn-csv>⬇ Export .csv</button>
     <button type=button class=ghost id=btn-clear>Clear everything</button></p>
  <p class=small class=muted><b>Export early and often.</b> NaNoWriMo's archives went offline with the organisation and twenty-five years of writers' records went with them. A file on your own disk is the only copy nobody can switch off.</p>
</div>

<div class=card>
  <h3>The draft is private. The <em>process</em> can pay.</h3>
  <p class=small><b>Nothing you type above is scored, ranked or paid.</b> That is deliberate and it does not change: a first draft should not be an audience performance, and nobody gets money for hitting a word count here.</p>
  <p class=small>But the other half of what the old forums were for — <b>posting a character you just worked out, a scene you are pleased with, the map of your world, what you learned on day 14</b> — that was always the good part, and it was always free labour on somebody else's server. We run a blockchain with a blog on it. <b>If you choose to post that work publicly, it can earn, through the whole month, not just at the end.</b></p>
  <p class=small>It is entirely optional, it is a separate decision from drafting, and <b>we never see a word of your novel unless you post it yourself</b>. Keep the manuscript private and share the process; share nothing at all; or publish the finished thing in December. Your call, every time.</p>
  <p class=small class=muted>Publish on <a href="https://melek.salon">MELEK</a> · build a reader list with <a href="https://pentecaust.com">Pentecaust Herald</a> · <a href="${bp('/history')}">why we think this is the part the others cannot copy</a></p>
</div>

<script>(function(){
  var K='writingroom.v1';
  function load(){try{return JSON.parse(localStorage.getItem(K)||'')||{}}catch(e){return{}}}
  function save(s){try{localStorage.setItem(K,JSON.stringify(s))}catch(e){}}
  var st=load(); st.log=st.log||{}; st.goal=st.goal||50000; st.days=st.days||30;
  if(!st.start){var n=new Date(); st.start=(n.getMonth()>=10? n.getFullYear()+1 : n.getFullYear())+'-11-01';}
  var $=function(i){return document.getElementById(i)};
  function today(){var n=new Date();return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0')}
  function dayNo(){var a=new Date(st.start+'T00:00:00'),b=new Date(today()+'T00:00:00');
    return Math.min(Math.max(1,Math.round((b-a)/86400000)+1), st.days)}
  function words(t){var m=String(t||'').trim().match(/\\S+/g);return m?m.length:0}
  function render(){
    $('in-goal').value=st.goal; $('in-days').value=st.days; $('in-start').value=st.start;
    var keys=Object.keys(st.log).sort(), total=keys.length?st.log[keys[keys.length-1]]:0;
    var day=dayNo(), par=Math.round((st.goal/st.days)*day), left=Math.max(0,st.goal-total),
        dleft=Math.max(0,st.days-day), need=dleft>0?Math.ceil(left/dleft):left,
        pct=Math.min(100,Math.round(total/st.goal*1000)/10);
    $('s-words').textContent=total.toLocaleString(); $('s-pct').textContent=pct+'%';
    $('s-need').textContent=(total>=st.goal?0:need).toLocaleString();
    var streak=0,prev=null;
    for(var i=keys.length-1;i>=0;i--){var c=new Date(keys[i]+'T00:00:00');
      if(prev===null||Math.round((prev-c)/86400000)===1){streak++;prev=c}else break}
    $('s-streak').textContent=streak;
    $('bar').style.width=pct+'%'; $('in-words').value=total;
    var v=$('verdict');
    if(total>=st.goal){v.innerHTML='<b>You finished.</b> Export it, then go do whatever you like with it.';}
    else if(!keys.length){v.textContent='Set your goal and log your first day.';}
    else{var ah=total-par; v.innerHTML= ah>=0
      ? 'Day '+day+' of '+st.days+' — <b>'+ah.toLocaleString()+' words ahead</b> of pace. '+need.toLocaleString()+'/day to finish.'
      : 'Day '+day+' of '+st.days+' — '+Math.abs(ah).toLocaleString()+' behind pace. <b>'+need.toLocaleString()+'/day</b> gets you there.';}
    var tb=$('logbody'); tb.innerHTML='';
    keys.forEach(function(k,i){var prevTot=i>0?st.log[keys[i-1]]:0;
      var a=new Date(st.start+'T00:00:00'),b=new Date(k+'T00:00:00');
      var dn=Math.round((b-a)/86400000)+1;
      var tr=document.createElement('tr');
      [dn,k,st.log[k].toLocaleString(),'+'+(st.log[k]-prevTot).toLocaleString()].forEach(function(c){
        var td=document.createElement('td'); td.textContent=c; tr.appendChild(td)});
      tb.appendChild(tr)});
    $('log-empty').style.display=keys.length?'none':'';
  }
  $('btn-log').onclick=function(){st.log[today()]=Math.max(0,parseInt($('in-words').value,10)||0);save(st);render()};
  $('btn-count').onclick=function(){var w=words($('in-text').value);
    $('count-out').textContent=w.toLocaleString()+' words — click "Save today" to log it.'; $('in-words').value=w};
  ['in-goal','in-days','in-start'].forEach(function(id){$(id).onchange=function(){
    st.goal=Math.max(1,parseInt($('in-goal').value,10)||50000);
    st.days=Math.max(1,parseInt($('in-days').value,10)||30);
    st.start=$('in-start').value||st.start; save(st); render()}});
  function dl(name,type,data){var b=new Blob([data],{type:type}),u=URL.createObjectURL(b),a=document.createElement('a');
    a.href=u;a.download=name;a.click();URL.revokeObjectURL(u)}
  $('btn-export').onclick=function(){dl('writing-room.json','application/json',JSON.stringify(st,null,2))};
  $('btn-csv').onclick=function(){var k=Object.keys(st.log).sort();
    dl('writing-room.csv','text/csv','date,total\\n'+k.map(function(x){return x+','+st.log[x]}).join('\\n'))};
  $('btn-clear').onclick=function(){if(confirm('Delete your log from this browser? Export first — this cannot be undone.')){
    try{localStorage.removeItem(K)}catch(e){} st={log:{},goal:50000,days:30,start:st.start}; render()}};
  render();
})();</script>`;

const PREP = `<h1>The Watch</h1>
<p class=muted><b>October is the watch. November is the writing.</b> You spend a month looking hard at a great deal of work until you find the thing you actually want to write — because ideas do not arrive in an empty room — and then you spend a month writing it badly and fast.</p>
<p class=muted>I keep watch on a blockchain for a living; in October the watch is a different kind. Same job, though: pay attention to what is actually there, for long enough that you start seeing the shape of it.</p>

<h2>What is on in October</h2>
<p class=muted>Other people have been doing this for decades and several are better at it than we are. Pick any of them — the point is the watching, not whose list you use.</p>
<div class=card><table><thead><tr><th>What</th><th>Where</th><th></th></tr></thead><tbody>
${WATCHING.map((w) => `<tr><td><b>${esc(w.name)}</b><br><span class=small style="color:var(--mut)">${esc(w.run)}</span></td><td class=small>${esc(w.where)}</td><td class=small>${esc(w.what)}</td></tr>`).join('')}
</tbody></table></div>

<h2>And the map, which is the part that connects watching to writing</h2>
<div class=card>
${OURS.map((o) => `<p><b><a href="${esc(o.url)}">${esc(o.name)}</a></b> — ${esc(o.what)}</p>`).join('')}
<p class=small class=muted>You do not have to write horror. It is October, so horror is what is on the table — and a map of <em>any</em> genre done properly teaches the same thing: where the walls are, and which ones are only painted on. Browse <a href="https://stream.soapbox.community/films">the films</a>, or <a href="https://hathor.soapbox.community/halloween">make something</a> while you think.</p>
</div>

<h2>How to watch so it counts as work</h2>
<div class=card><table><tbody>
${WHY.map(([h, b]) => `<tr><td style="width:36%"><b>${esc(h)}</b></td><td class=small>${esc(b)}</td></tr>`).join('')}
</tbody></table></div>

<h2>Then put it down</h2>
<p class=muted>Fill in as much or as little as you like — <b>it saves in your browser only</b>, and the Export button hands you the whole thing as a Markdown file.</p>
${[['premise', 'The premise in one sentence', 'A sentence you could say out loud to a stranger. If it takes a paragraph, it is not a premise yet.'],
   ['want', 'What the main character wants, and what stands in the way', 'Want plus obstacle is the engine. Everything else is decoration on top of it.'],
   ['cast', 'The cast', 'Name, what they want, and what they are wrong about. Three lines each is plenty.'],
   ['world', 'Where and when', 'Only the parts that constrain the plot. Nobody needs the currency system unless somebody has to pay for something.'],
   ['beats', 'Ten beats', 'Ten things that happen, in order. Not chapters — events. This is the thing that stops day 14.'],
   ['ending', 'How it ends', 'Write it now, badly. You are allowed to change it. Knowing where you are going is worth more than it being right.'],
   ['rules', 'Your rules for the month', 'When you write, how much, what you do when you miss a day. Decide now, while you are calm.']]
  .map(([k, label, hint]) => `<div class=card><h3>${esc(label)}</h3><p class="small muted">${esc(hint)}</p>
<textarea data-prep="${esc(k)}" placeholder="…"></textarea></div>`).join('')}
<div class=card><p><button type=button class=ghost id=p-export>⬇ Export your prep</button>
 <button type=button class=ghost id=p-clear>Clear</button></p>
<p class=small class=muted>No account, no sync, no server copy. If you want this on another machine, export it and carry the file.</p></div>
<script>(function(){
  var K='writingroom.prep.v1';
  function load(){try{return JSON.parse(localStorage.getItem(K)||'')||{}}catch(e){return{}}}
  var st=load(), areas=[].slice.call(document.querySelectorAll('[data-prep]'));
  areas.forEach(function(a){var k=a.getAttribute('data-prep'); if(st[k])a.value=st[k];
    a.addEventListener('input',function(){st[k]=a.value;try{localStorage.setItem(K,JSON.stringify(st))}catch(e){}})});
  document.getElementById('p-export').onclick=function(){
    var txt=areas.map(function(a){return '## '+a.previousElementSibling.previousElementSibling.textContent+'\\n\\n'+(a.value||'')}).join('\\n\\n');
    var b=new Blob([txt],{type:'text/markdown'}),u=URL.createObjectURL(b),el=document.createElement('a');
    el.href=u;el.download='preptober.md';el.click();URL.revokeObjectURL(u)};
  document.getElementById('p-clear').onclick=function(){if(confirm('Clear your prep from this browser?')){
    try{localStorage.removeItem(K)}catch(e){} areas.forEach(function(a){a.value=''}); st={}}};
})();</script>`;

const HISTORY = `<h1>What happened to NaNoWriMo</h1>
<p class=muted>It ran for twenty-five years, it ended on <b>March 31, 2025</b>, and the usual one-line version — "it died over AI" — is wrong in a way worth correcting. Every claim below carries a grade.</p>
<p class=small><span class="g established">established</span> multiple outlets or the organisation itself &nbsp; <span class="g contested">contested</span> widely repeated, detail or causation not supported &nbsp; <span class="g unverified">unverified</span> we could not confirm it exists</p>

<div class=card style="border-left:5px solid #9a3b35">
  <h3>${esc(POSITION.heading)}</h3>
  <p>${esc(POSITION.body)}</p>
  <p class=small>${esc(POSITION.ours)}</p>
</div>
<div class=card><table><tbody>
${TIMELINE.map((t) => `<tr><td style="white-space:nowrap"><b>${esc(t.when)}</b><br><span class="g ${esc(t.grade)}">${esc(t.grade)}</span></td><td>${esc(t.what)}</td></tr>`).join('')}
</tbody></table></div>

<h2>Where the challenge went</h2>
<p class=muted>The 50,000-word deal outlived the organisation that ran it. These are the successors we could confirm.</p>
<div class=card><table><thead><tr><th>Name</th><th>Run by</th><th>What it is</th></tr></thead><tbody>
${SUCCESSORS.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td class=small>${esc(s.by)}</td><td class=small>${esc(s.what)}</td></tr>`).join('')}
</tbody></table></div>

${UNVERIFIED.length ? `<h2>What we could not confirm</h2>
<p class=small class=muted>These circulate in summaries of the collapse and we could not establish that they exist as described. They are listed rather than quietly dropped, so nobody re-adds them from a stale list:</p>
<div class=card><p class=small>${UNVERIFIED.map((u) => `<span class="g unverified">${esc(u)}</span>`).join(' ')}</p></div>` : `<div class=card><p class=small class=muted><b>A note on how this list was checked.</b> Four of the groups above were briefly marked "unverified" here because one broad search did not surface them. All four are real, with founders, sites and running challenges. Absence from a single search result is not absence from the world — if you see a successor list that is missing PaWriCo, O2W, NaNo 2.0 or Novel 90, it was built the lazy way.</p></div>`}

<h2>What we took from it</h2>
<div class=card><table><tbody>
${LESSONS.map(([h, b]) => `<tr><td style="width:34%"><b>${esc(h)}</b></td><td class=small>${esc(b)}</td></tr>`).join('')}
</tbody></table></div>
<p>That last column is why <a href="${bp('/')}">the challenge here</a> has no account, no server-side copy of your draft, no payout and no score — and why the export button is the most important control on the page.</p>`;

export async function handler(req, res) {
  try {
    const url = new URL(req.url || '/', BASE_URL);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const html = (code, title, body, opts) => {
      res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' });
      res.end(pageHtml(title, body, opts));
    };
    if (p === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
    if (p === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(`${robotsTxt(BASE_URL)}\nSitemap: ${BASE_URL}/sitemap.xml\n`); }
    if (p === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(sitemapXml(BASE_URL, ['/', '/watch', '/history'])); }
    if (p === '/sitemap-index.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(publicSitemapIndexXml()); }
    if (p === '/llms.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(llmsTxt(BASE_URL, SITE_NAME)); }
    if (p === '/') return html(200, '50,000 words in 30 days — The Writing Room', CHALLENGE, { path: '/' });
    // /watch is the name; /october and /preptober are kept because they are what people type in October.
    if (p === '/watch' || p === '/october' || p === '/preptober') {
      return html(200, 'The Watch — a month of horror, then a month of writing', PREP, {
        path: '/watch', canonical: `${BASE_URL}/watch`,
        description: 'October is the watch: 31 nights of horror, a map of the genre, and the seven cards you fill in before November. Everything saves in your browser only.',
      });
    }
    if (p === '/history') return html(200, 'What happened to NaNoWriMo — the graded record', HISTORY, { path: '/history', description: 'NaNoWriMo dissolved on March 31, 2025. The timeline, the confirmed successors, and the claims that do not check out — each one graded.' });
    return html(404, 'Not found — The Writing Room', `<h1>Not found</h1><p class=muted>That page doesn't exist. <a href="${bp('/')}">Start the challenge</a>.</p>`, { robots: 'noindex,follow' });
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/writing\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => console.log(`The Writing Room on ${BASE_URL} (bound ${HOST}:${PORT})`));
}
