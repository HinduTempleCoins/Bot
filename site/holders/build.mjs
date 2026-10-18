// site/holders/build.mjs — the VKBT & CURE holders list at melek.salon/holders.
//
// VKBT and CURE were distributed on Hive-Engine for years, first to the r2cornell community, and many holders
// don't know they have them. This page lists every holder (from the Hive-Engine balances, public chain data),
// their VKBT and CURE, whether the same name exists on STEEM and BLURT, and a link to their Hive-Engine wallet
// so anyone can check. Hathor's announcement posts link here and ask readers to let the people on it know.
//
// Input: the holders CSV produced by the outreach research (account, vkbt, cure, steem_exists, blurt_exists,
// exclude_reason, ...). Our own accounts (operator, issuer, bridge custody, burn, system) are left out.
//   HOLDERS_CSV=… OUT=/var/www/melek-admin/holders/index.html node site/holders/build.mjs
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SITE = 'https://melek.salon';
const OWN = /^(operator|operator\/issuer|bridge custody|burn account|system)$/;
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Minimal CSV parser (quoted fields, commas, doubled quotes). */
export function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** The published rows: [account, vkbt, cure, onSteem, onBlurt], biggest holders first. Pure. */
export function holderRows(records) {
  return records
    .filter((r) => r.account && !OWN.test(r.exclude_reason || '') && (Number(r.vkbt) > 0 || Number(r.cure) > 0))
    .map((r) => [r.account, Number(Number(r.vkbt || 0).toFixed(3)), Number(Number(r.cure || 0).toFixed(3)), r.steem_exists === 'True' ? 1 : 0, r.blurt_exists === 'True' ? 1 : 0])
    .sort((a, b) => (b[1] / 1000 + b[2]) - (a[1] / 1000 + a[2]));
}

export function renderPage(rows, { asOf = new Date().toISOString().slice(0, 10) } = {}) {
  const vk = rows.filter((r) => r[1] > 0).length, cu = rows.filter((r) => r[2] > 0).length;
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>VKBT and CURE holders — MELEK</title><meta name=description content="Every account holding VKBT or CURE on Hive-Engine, with links to check each wallet. Many holders don't know they have them.">
<link rel=canonical href="${SITE}/holders">
<style>:root{--bg:#f7f8fa;--fg:#1a1d24;--mut:#6b7280;--card:#fff;--line:#e5e7eb}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0f1218;--fg:#e5e7eb;--mut:#9ca3af;--card:#161a22;--line:#2a2f3a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header{padding:12px 16px;background:var(--card);border-bottom:1px solid var(--line)}header a{color:#f39c12;font-weight:800;text-decoration:none;font-size:20px}
main{max-width:1000px;margin:0 auto;padding:18px 16px}.mut{color:var(--mut)}a{color:#c47f00}
input{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:inherit;margin:8px 0}
table{width:100%;border-collapse:collapse;font-size:14px;background:var(--card)}th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:inherit;cursor:pointer;margin:10px 0}
@media(max-width:600px){table{display:block;overflow-x:auto;white-space:nowrap}}</style></head><body>
<header><a href="${SITE}/explore">MELEK</a></header>
<main><h1>VKBT and CURE holders</h1>
<p>VKBT and CURE have been handed out on Hive-Engine for years, starting with the r2cornell community. Many of the people below don't know they hold them. If you know someone on this list, let them know: they can check their balance on Hive-Engine and use these tokens with MELEK.</p>
<p class=mut>${rows.length.toLocaleString('en-US')} accounts as of ${esc(asOf)}: ${vk.toLocaleString('en-US')} hold VKBT and ${cu.toLocaleString('en-US')} hold CURE. "On STEEM" and "On BLURT" mean an account with the same name exists there; it may not belong to the same person.</p>
<p><a href="https://he.dtools.dev/">Check a wallet on Hive-Engine</a> · <a href="https://hive-engine.com/">Hive-Engine</a> · <a href="https://kula.money/bridge.html">Bridge VKBT and CURE to PRANA</a> · <a href="https://wiki.soapbox.community/wiki/VKBT_and_CURE">About VKBT and CURE</a></p>
<input id=q type=search placeholder="Find an account" aria-label="Find an account" autocomplete=off>
<p class=mut id=count></p>
<table><thead><tr><th>#</th><th>Account (Hive)</th><th class=n>VKBT</th><th class=n>CURE</th><th>On STEEM</th><th>On BLURT</th></tr></thead><tbody id=rows></tbody></table>
<button id=more type=button>Show more</button>
</main>
<script>
var D=${JSON.stringify(rows)};
var q=document.getElementById('q'),tb=document.getElementById('rows'),cnt=document.getElementById('count'),more=document.getElementById('more'),shown=200,list=D;
function f(n){return n?n.toLocaleString('en-US',{maximumFractionDigits:3}):''}
function e(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function draw(){var h='';for(var i=0;i<Math.min(shown,list.length);i++){var r=list[i];h+='<tr><td>'+(D.indexOf(r)+1)+'</td><td><a href="https://he.dtools.dev/@'+e(r[0])+'" rel=nofollow>'+e(r[0])+'</a></td><td class=n>'+f(r[1])+'</td><td class=n>'+f(r[2])+'</td><td>'+(r[3]?'yes':'')+'</td><td>'+(r[4]?'yes':'')+'</td></tr>'}
tb.innerHTML=h;cnt.textContent=list.length.toLocaleString('en-US')+' accounts'+(q.value?' match':'');more.style.display=shown<list.length?'':'none'}
q.addEventListener('input',function(){var s=q.value.toLowerCase().trim();list=s?D.filter(function(r){return r[0].indexOf(s)>=0}):D;shown=200;draw()});
more.addEventListener('click',function(){shown+=500;draw()});draw();
</script></body></html>`;
}

if (process.argv[1] && process.argv[1].endsWith('holders/build.mjs')) {
  const rows = holderRows(parseCsv(readFileSync(process.env.HOLDERS_CSV || 'holders_chain_activity.csv', 'utf8')));
  const out = process.env.OUT || '/var/www/melek-admin/holders/index.html';
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out + '.new', renderPage(rows, { asOf: process.env.AS_OF })); renameSync(out + '.new', out);
  console.log(`[holders] ${rows.length} accounts -> ${out}`);
}
