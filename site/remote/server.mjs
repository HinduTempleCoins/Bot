// site/remote/server.mjs — remote.soapbox.community: a TV remote for when the remote is gone.
//
// ⚠️ THE ARCHITECTURAL FACT THIS PAGE IS BUILT AROUND: the TV sits on a private LAN, so no server we
// run can reach it — not this one, not any. The REQUEST HAS TO COME FROM THE BROWSER, because the
// browser is the thing on the same Wi-Fi. So every control action is a `fetch(..., {mode:'no-cors'})`
// fired from the page. The page can be served from anywhere; the PHONE has to be on the TV's network.
//
// ⚠️ And the limit of no-cors: it can SEND but not READ. Roku's ECP returns no CORS headers, so
// /query/apps cannot be read back and the device's real channel list is unavailable to us. The page
// says so instead of silently showing a guess — a stale channel ID launches nothing, which looks like
// a broken app rather than a wrong number.
//
// Roku is first because it is the only major platform with an open, unauthenticated local API. Every
// other brand needs its vendor app or an on-screen pairing step, and the page states that per platform
// rather than implying it works everywhere.
//
// No network from the server, no keys, nothing stored. esc() everywhere, handler exported, CLI guarded.
//
//   PORT=8328 BASE_URL=https://remote.soapbox.community node site/remote/server.mjs

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { robotsTxt, sitemapXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import {
  KEYS, CHANNELS, PLATFORMS, NO_REMOTE_STEPS, ecpBase, keypressUrl, launchUrl,
} from '../../integrations/soapbox/tv-remote.mjs';

const PORT = +(process.env.PORT || 8328);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://remote.soapbox.community').replace(/\/$/, '');

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PAD = ['Up', 'Left', 'Select', 'Right', 'Down'];
const ROW = ['Back', 'Home', 'Play'];
const VOL = ['VolumeDown', 'VolumeMute', 'VolumeUp'];
const INPUTS = KEYS.filter((k) => k.key.startsWith('InputHDMI'));

const STYLE = `<style>
:root{--bg:#0d0f11;--card:#171a1f;--ink:#eef1f4;--dim:#98a0a9;--line:#252a32;--go:#4fd6ae;--warn:#e0b44c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.w{max-width:560px;margin:0 auto;padding:0 16px 64px}
h1{font-size:30px;letter-spacing:-1px;margin:26px 0 6px}
h2{font-size:19px;margin:32px 0 10px}
.lede{color:var(--dim);font-size:16px;margin:0 0 18px}
.ip{display:flex;gap:8px;margin:0 0 6px}
input{flex:1;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink);font:inherit}
.hint{color:var(--dim);font-size:13px;margin:0 0 20px}
button{border:1px solid var(--line);border-radius:14px;background:var(--card);color:var(--ink);font:600 15px/1.1 inherit;padding:16px 10px;cursor:pointer}
button:active{background:var(--ink);color:var(--bg)}
button:disabled{opacity:.4;cursor:not-allowed}
.pad{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:0 0 12px}
.pad .sp{visibility:hidden}
.ok{background:var(--go);color:#062;border-color:var(--go);font-weight:800}
.row{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:0 0 12px}
.pw{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:0 0 16px}
.ch{display:grid;grid-template-columns:repeat(2,1fr);gap:9px}
.ch button{padding:18px 10px;font-size:16px}
.ch .free{border-color:var(--go)}
.ch small{display:block;color:var(--dim);font-weight:400;font-size:11px;margin-top:3px}
.warn{border:1px solid var(--warn);color:var(--warn);border-radius:12px;padding:13px 15px;margin:0 0 18px;font-size:14px;line-height:1.5}
ol{padding-left:20px}ol li{margin:0 0 12px}
ol b{display:block}
ol span{color:var(--dim);font-size:14px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:8px 9px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:var(--dim)}
.yes{color:var(--go);font-weight:700}.no{color:var(--dim)}
#log{color:var(--dim);font-size:13px;min-height:20px;margin:10px 0 0}
.foot{color:var(--dim);font-size:13px;border-top:1px solid var(--line);margin-top:36px;padding-top:16px}
</style>`;

// The client. Kept small and readable: no framework, no build step, nothing stored but the IP.
const APP = `<script>
(function(){
  var $=function(s){return document.querySelector(s)};
  var ipEl=$('#ip'), log=$('#log');
  try{ var saved=localStorage.getItem('rokuIp'); if(saved) ipEl.value=saved; }catch(e){}
  function base(){
    var v=(ipEl.value||'').trim().replace(/^https?:\\/\\//i,'').replace(/\\/+$/,'');
    if(!v) return null;
    if(v.indexOf(':')<0) v=v+':8060';
    return 'http://'+v;
  }
  function say(m){ log.textContent=m; }
  function send(path,label){
    var b=base();
    if(!b){ say('Enter the Roku IP address first.'); return; }
    try{ localStorage.setItem('rokuIp', ipEl.value.trim()); }catch(e){}
    // no-cors: the request IS sent; the response cannot be read. That is fine for a keypress, and it
    // is the only thing that works from a browser against a device that sends no CORS headers.
    fetch(b+path,{method:'POST',mode:'no-cors'})
      .then(function(){ say('Sent '+label+'. If nothing happened, check the IP and that you are on the same Wi-Fi.'); })
      .catch(function(){ say('Could not reach '+b+'. Same Wi-Fi as the TV?'); });
  }
  document.addEventListener('click',function(e){
    var t=e.target.closest('[data-key]'); if(t){ send('/keypress/'+t.dataset.key, t.dataset.key); return; }
    var c=e.target.closest('[data-app]'); if(c){ send('/launch/'+c.dataset.app, c.dataset.name||c.dataset.app); }
  });
})();
</script>`;

export function page() {
  const btn = (k, cls = '') => `<button data-key="${esc(k.key)}" class="${esc(cls)}">${esc(k.label)}</button>`;
  const byKey = Object.fromEntries(KEYS.map((k) => [k.key, k]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TV remote — no remote needed</title>
<meta name="description" content="Control a Roku TV from any phone on the same Wi-Fi, with no app and no account — and the honest list of what to do for every other brand.">
${STYLE}</head><body><div class="w">
<h1>Turn the TV on without the remote</h1>
<p class="lede">If it is a <b>Roku</b>, this page is the remote — no app, no account, no pairing. For every
other brand, the list further down is the real answer.</p>

<div class="warn"><b>Your phone must be on the same Wi-Fi as the TV.</b> The TV is on your private
network, so no website can reach it — the buttons below fire from <i>your browser</i>, which is why this
works at all and why it cannot work from cellular data.</div>

<div class="ip"><input id="ip" placeholder="Roku IP, e.g. 192.168.1.42" inputmode="decimal" autocomplete="off"></div>
<p class="hint">Find it on the TV under <b>Settings → Network → About</b>, or in your router's client list.
It is saved in this browser only.</p>

<div class="pw">${btn(byKey.PowerOn)}${btn(byKey.PowerOff)}</div>

<h2>Go straight to a channel</h2>
<div class="ch">${CHANNELS.map((c) => `<button data-app="${esc(c.id)}" data-name="${esc(c.name)}" class="${c.free ? 'free' : ''}">${esc(c.name)}<small>${c.free ? 'free' : 'subscription'}${c.confidence !== 'high' ? ' · ID unconfirmed' : ''}</small></button>`).join('')}</div>
<p class="hint">Channel IDs are fixed here because a browser cannot read the TV's own list back
(the device sends no CORS headers). <b>An ID that has changed launches nothing rather than the wrong
thing</b> — if a button does nothing, open the channel by hand once and use the pad instead.</p>

<h2>Pad</h2>
<div class="pad">
<span class="sp"></span>${btn(byKey.Up)}<span class="sp"></span>
${btn(byKey.Left)}${btn(byKey.Select, 'ok')}${btn(byKey.Right)}
<span class="sp"></span>${btn(byKey.Down)}<span class="sp"></span>
</div>
<div class="row">${ROW.map((k) => btn(byKey[k])).join('')}</div>
<div class="row">${VOL.map((k) => btn(byKey[k])).join('')}</div>
<div class="row">${INPUTS.map((k) => btn(k)).join('')}</div>
<p id="log"></p>

<h2>No remote, any brand — in the order worth trying</h2>
<ol>${NO_REMOTE_STEPS.map((s) => `<li><b>${esc(s.what)}</b><span>${esc(s.detail)}</span></li>`).join('')}</ol>

<h2>What actually works per platform</h2>
<table><tr><th>Platform</th><th>This page</th><th>How you control it</th></tr>
${PLATFORMS.map((p) => `<tr><td><b>${esc(p.name)}</b></td>
<td class="${p.thisPageWorks ? 'yes' : 'no'}">${p.thisPageWorks ? 'Yes' : 'No'}</td>
<td>${esc(p.how)}${p.note ? `<br><span style="color:var(--warn)">${esc(p.note)}</span>` : ''}</td></tr>`).join('')}
</table>
<p class="hint" style="margin-top:14px"><b>Roku is the only one with an open local API.</b> Every other
brand needs its own app or an on-screen pairing code, and no web page can do that for you.</p>

<p class="foot">Nothing is sent to us. The IP stays in your browser, the button presses go straight from
your phone to your TV, and this server never touches either.</p>
${APP}</div></body></html>`;
}

export const SITEMAP_PATHS = ['/'];

export async function handler(req, res) {
  const url = new URL(req.url, BASE_URL);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const send = (body, type = 'text/html; charset=utf-8', code = 200) => {
    res.statusCode = code; res.setHeader('content-type', type); res.end(body);
  };

  if (path === '/robots.txt') return send(robotsTxt(BASE_URL), 'text/plain; charset=utf-8');
  if (path === '/sitemap.xml') {
    const today = new Date().toISOString().slice(0, 10);
    return send(sitemapXml(BASE_URL, SITEMAP_PATHS.map((p) => ({ path: p, lastmod: today, changefreq: 'monthly', priority: '1.0' }))), 'application/xml; charset=utf-8');
  }
  if (path === '/llms.txt') return send(llmsTxt({
    name: 'TV remote — no remote needed', baseUrl: BASE_URL,
    summary: 'Control a Roku TV from a phone on the same Wi-Fi with no app, no account and no pairing, '
      + 'using Roku ECP on port 8060 — plus the honest per-brand list for Samsung, LG, Vizio, Fire TV, '
      + 'Android TV and Apple TV, none of which can be controlled from a web page.',
    links: [{ label: 'Remote', url: '/' }],
  }), 'text/plain; charset=utf-8');
  if (path === '/healthz') return send(JSON.stringify({ ok: true, keys: KEYS.length, channels: CHANNELS.length }), 'application/json; charset=utf-8');
  // Useful from a machine that IS on the LAN (curl, a script) — the browser cannot read a response.
  if (path === '/api/urls') {
    const b = ecpBase(url.searchParams.get('ip') || '');
    if (!b) return send(JSON.stringify({ ok: false, error: 'bad or missing ip' }), 'application/json; charset=utf-8', 400);
    return send(JSON.stringify({
      ok: true, base: b,
      keys: Object.fromEntries(KEYS.map((k) => [k.key, keypressUrl(b, k.key)])),
      channels: Object.fromEntries(CHANNELS.map((c) => [c.name, launchUrl(b, c.id)])),
    }, null, 2), 'application/json; charset=utf-8');
  }

  if (path === '/') return send(page());
  send('<h1>Not found</h1><p><a href="/">← remote</a></p>', 'text/html; charset=utf-8', 404);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`remote → http://${HOST}:${PORT}`));
}
