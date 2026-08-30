// shared.mjs — the compliance-first shell every KULA Arcade surface (hub, lotto, markets, verify)
// renders through. It bakes the load-bearing safety copy into ONE place so it cannot drift between
// surfaces: the persistent disclaimer, the age-gate, the geofence notice + client hook, the Alpha /
// testnet framing, and the PLAY-is-non-cashable explainer.
//
// House style: ESM, esc() every interpolation, safeHref() every emitted link, BASE_PATH-aware
// self-URLs, shared crawlers/seo, soft-fail (never throws to the caller). The server does ZERO
// request-time network — this module only builds strings.
//
// Compliance references: .local/RESEARCH_PREDICTION_MARKETS_BETTING.md §5/§6, .local/KULA_LOTTO_DESIGN.md,
// memory `prana-defi-arcade-compliance-line`. PLAY is non-cashable: no fiat on/off-ramp, no "buy PLAY",
// no cash-out anywhere. Hathor (if referenced) is an educator only — never sets lines / gives advice.

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';
import * as geo from '../../integrations/soapbox/geogate.mjs';

export { geo };

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// safeHref: only same-origin absolute paths ("/..."), full http(s) URLs, and mailto: pass. Anything
// else (javascript:, data:, protocol-relative, junk) → '' so a bad link is inert, never an injection.
export function safeHref(u) {
  const s = String(u == null ? '' : u).trim();
  if (!s) return '';
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^mailto:[^\s<>"']+$/i.test(s)) return s;
  return '';
}

// Network label — the same code serves testnet (default) and mainnet. It follows the canonical
// PRANA_NET switch (integrations/chains/prana-network.mjs), so ONE flip — `PRANA_NET=mainnet` — cuts
// both the on-chain reader (live.mjs) and every surface's framing over to mainnet. ARCADE_NET_LABEL
// still wins if a service wants to override just the wording. Kept a plain word for the disclaimer copy.
export const NET_LABEL = (String(process.env.ARCADE_NET_LABEL || process.env.PRANA_NET || 'testnet').toLowerCase().replace(/[^a-z]/g, '') || 'testnet');

// Responsible-play help. The KULA Arcade is free + non-cashable, but the load-bearing compliance rule
// (memory `gambling-education-center`, `prana-defi-arcade-compliance-line`) is that EVERY gambling-adjacent
// surface carries prominent responsible-gambling help — helpline, self-exclusion, and a link to the
// education center. The primary US line is the National Problem Gambling Helpline (NCPG): reachable as
// 1-800-522-4700 and as 1-800-GAMBLER, text 800GAM, 24/7 chat.
export const HELPLINE_TEL = '1-800-522-4700';
export const HELPLINE_ALT = '1-800-GAMBLER';
export const HELPLINE_CHAT = 'https://www.ncpgambling.org/chat/';
export const EDU_URL = safeHref(process.env.GAMBLING_EDU_URL || 'https://gambling.soapbox.community') || 'https://gambling.soapbox.community';

// ── shared dark theme (same palette family as casino/spin/insurance) ──────────────────────────────
export const STYLE = `<style>
 :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--green:#3fb950;--purple:#a371f7;--red:#f85149}
 *{box-sizing:border-box}body{font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
 a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
 .alpha-badge{position:fixed;top:6px;left:6px;z-index:30;background:#d2992233;color:var(--gold);border:1px solid var(--gold);border-radius:7px;font-size:11px;font-weight:700;padding:1px 7px}
 header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
 .brand{font-weight:800;font-size:18px;color:var(--fg)}.brand b{color:var(--gold)}.brand span{color:var(--mut);font-weight:400;font-size:13px}
 .topbar-r{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
 .topbar-r a{color:var(--fg);font-weight:700;font-size:13px;border:1px solid var(--line2);border-radius:8px;padding:6px 11px;white-space:nowrap}
 .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
 .arcade-disclaimer{background:#d299220f;border-bottom:1px solid var(--gold);color:var(--gold);font-size:12.5px;padding:8px 20px;text-align:center;line-height:1.5}
 .arcade-help{background:#f851490d;border:1px solid var(--red);border-radius:9px;color:#f8b3ad;font-size:12.5px;padding:9px 14px;margin:14px 0;line-height:1.55}
 .arcade-help a{color:#ff9d94;font-weight:700}
 .arcade-help .rg-tools{margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
 .arcade-help button.rg-break{font:inherit;font-size:11.5px;font-weight:700;border:1px solid var(--red);background:#0b0f14;color:#ff9d94;border-radius:7px;padding:4px 9px;cursor:pointer}
 .arcade-excluded{background:#0b0f14;border:1px solid var(--gold);border-radius:10px;color:var(--gold);padding:16px 18px;margin:16px 0;font-size:13.5px;line-height:1.6}
 .arcade-geo{background:#0b0f14;border:1px solid var(--line2);color:var(--mut);font-size:12px;padding:7px 14px;border-radius:8px;margin:12px 0}
 .arcade-geo.geo-blocked{border-color:var(--red);color:var(--red)}
 .wrap{max-width:900px;margin:0 auto;padding:20px}
 h1{margin:0 0 6px;font-size:26px}h2{font-size:19px;margin:18px 0 10px}h3{font-size:15px;margin:0 0 6px}
 .muted{color:var(--mut)}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
 .card{background:var(--panel);border:1px solid var(--line2);border-radius:12px;padding:16px 18px;display:flex;flex-direction:column}
 .card .blurb{color:var(--fg);font-size:13.5px;margin:8px 0;flex:1}
 .tag{font-size:10px;font-weight:700;border:1px solid var(--line2);border-radius:999px;padding:2px 8px;color:var(--mut);white-space:nowrap}
 .tag.free{color:var(--green);border-color:var(--green)}.tag.play{color:var(--purple);border-color:var(--purple)}
 .btn{align-self:flex-start;font:inherit;font-weight:700;border-radius:9px;padding:9px 15px;border:1px solid var(--line2);background:#0b0f14;color:var(--fg);cursor:pointer;text-decoration:none;margin-top:6px}
 .btn.primary{background:var(--gold);color:#0d1117;border-color:var(--gold)}
 .btn:hover{border-color:var(--blue);text-decoration:none}
 .play-note{color:var(--gold);background:#d2992211;border:1px solid var(--gold);border-radius:8px;padding:9px 13px;font-size:12.5px;margin:14px 0}
 .agebox{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:12px 16px;margin:14px 0;font-size:13px}
 table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0}th,td{border:1px solid var(--line2);padding:6px 9px;text-align:left}th{color:var(--mut);font-weight:600}
 .fair-note{color:var(--mut);font-size:12px;margin-top:8px;word-break:break-word}
 code{background:#0b0f14;border:1px solid var(--line2);border-radius:5px;padding:1px 5px;font-size:12px}
 footer{color:var(--mut);font-size:12px;text-align:center;padding:24px 20px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
 footer a{color:var(--blue)}
</style>`;

// ── the load-bearing safety copy ──────────────────────────────────────────────────────────────────
// ONE persistent disclaimer, present on every surface. This exact sentence carries all the required
// phrases: entertainment-only, not gambling/investment, no cash value, cannot be purchased, cannot be
// cashed out, not available where prohibited, plus the alpha/testnet + age framing.
export const DISCLAIMER = `<div class="arcade-disclaimer" role="note">
 <b>Entertainment only</b> — a game, not gambling or investment. PLAY has no cash value, cannot be purchased, and cannot be cashed out. Not available where prohibited. Alpha · ${esc(NET_LABEL)} · 18+.
</div>`;

// Responsible-play help band — server-rendered on EVERY surface (via the shell). Carries the helpline
// (call/text/chat), a self-exclusion "take a break" control, and a link to the education center. Copy is
// harm-reduction, never promotion. The "take a break" button is a per-viewer localStorage timer (see
// SELF_EXCLUDE_SCRIPT) — it needs no server + no account, so it works on a static, non-cashable arcade.
export const RESPONSIBLE_HELP = `<div class="arcade-help" role="note">
 <b>Play for fun — know your limits.</b> KULA Arcade is free and nothing here can be cashed out, but if play
 stops feeling like a game (for you or someone you know), help is free, confidential, and 24/7: call or text
 <a href="tel:18005224700"><b>${esc(HELPLINE_TEL)}</b></a> (${esc(HELPLINE_ALT)}), text <b>800GAM</b>, or
 <a href="${esc(HELPLINE_CHAT)}" target=_blank rel=noopener>chat now</a>.
 <div class="rg-tools">
   <span class="muted">Set your own limits · take a break at any time:</span>
   <button type="button" class="rg-break" data-days="1">Pause 24h</button>
   <button type="button" class="rg-break" data-days="30">Self-exclude 30d</button>
   <a href="${esc(EDU_URL)}/help" target=_blank rel=noopener>More help &amp; self-exclusion tools &rarr;</a>
 </div>
</div>`;

// Self-exclusion / cool-off: a per-viewer break the player sets themselves. Stored in localStorage
// (wrapped in try/catch — storage may throw or be unavailable). While active, every arcade surface shows
// a "you're on a break" notice instead of the play area, with the helpline and an explicit end-break
// action. This is the self-exclusion control the compliance line requires, done client-side so it needs
// no account and works on the non-cashable play arcade.
export const SELF_EXCLUDE_SCRIPT = `<script>
(function(){try{
 var K='kula-arcade-break-until';
 function now(){return Date.now();}
 function until(){var v=null;try{v=localStorage.getItem(K);}catch(e){}var n=v?parseInt(v,10):0;return (n&&n>now())?n:0;}
 function fmt(ts){try{return new Date(ts).toLocaleString();}catch(e){return String(ts);}}
 function show(u){
   var main=document.querySelector('main.wrap');if(!main)return;
   Array.prototype.forEach.call(main.children,function(el){el.style.display='none';});
   var box=document.createElement('div');box.className='arcade-excluded';box.setAttribute('role','note');
   box.innerHTML='<b>You are taking a break from KULA Arcade.</b><br>Your self-set break is active until <b>'+
     fmt(u)+'</b>. Nothing here can be cashed out, and this break is entirely your choice. If gambling is a '+
     'problem, call or text <a href="tel:18005224700"><b>${esc(HELPLINE_TEL)}</b></a> (${esc(HELPLINE_ALT)}) — free, 24/7.';
   var end=document.createElement('button');end.className='rg-break';end.style.marginTop='12px';
   end.textContent='End my break now';
   end.onclick=function(){try{localStorage.removeItem(K);}catch(e){}location.reload();};
   box.appendChild(document.createElement('br'));box.appendChild(end);main.appendChild(box);
 }
 var u=until();if(u){show(u);return;}
 Array.prototype.forEach.call(document.querySelectorAll('button.rg-break'),function(b){
   b.onclick=function(){
     var d=parseInt(b.getAttribute('data-days')||'1',10);if(!(d>0))d=1;
     var t=now()+d*86400000;try{localStorage.setItem(K,String(t));}catch(e){}
     show(t);window.scrollTo(0,0);
   };
 });
}catch(e){}})();
</script>`;

// Age-gate: always in the DOM (server-rendered, so tests + no-JS users see it); the script upgrades it
// to a one-time confirm stored per-viewer in localStorage (wrapped in try/catch — storage may throw).
export const AGE_GATE = `<div class="agebox" id="arcade-agegate" role="note">
 <b>You must be 18 or older</b> to play. KULA Arcade is a free, provably-fair, play-token arcade —
 there is no wagering of money and nothing here can be cashed out. By playing you confirm you are 18+
 and that this kind of play area is permitted where you are.
</div>`;

export const AGE_GATE_SCRIPT = `<script>
(function(){try{
 var k='kula-arcade-age-ok';var box=document.getElementById('arcade-agegate');if(!box)return;
 var ok=null;try{ok=localStorage.getItem(k);}catch(e){}
 if(ok==='1'){box.style.display='none';return;}
 var b=document.createElement('button');b.className='btn primary';b.style.marginTop='8px';b.textContent='I am 18 or older — enter';
 b.onclick=function(){try{localStorage.setItem(k,'1');}catch(e){}box.style.display='none';};
 box.appendChild(document.createElement('br'));box.appendChild(b);
}catch(e){}})();
</script>`;

// PLAY explainer — describes the internal, non-cashable token. Deliberately uses "non-cashable",
// "earned free", "spent inside" — never "buy", "purchase", "cash out", "withdraw", "deposit".
export const PLAY_EXPLAINER = `<div class="play-note">
 <b>PLAY is the arcade's internal points token.</b> You earn it free — from the free Daily Spin, from
 Move/GeoMiner activity, and from the faucet — and you spend it only inside the arcade (lotto entries,
 event-market stakes, cosmetics). It is <b>non-cashable</b>: it holds no cash value, has no fiat on-ramp,
 and there is no path to convert it to money or a tradeable token. That is what keeps this a game, not gambling.
</div>`;

// ── the shell ─────────────────────────────────────────────────────────────────────────────────────
// shell({ title, description, canonical, body, nav, basePath, baseUrl, geoDecision, siteName })
// Emits the full HTML: head + Alpha badge + disclaimer + topbar + geo notice + (body) + footer +
// geo client hook + age-gate script. Every self-URL runs through bp()+safeHref().
export function shell({
  title = 'KULA Arcade', description = '', canonical = '', body = '', nav = [],
  basePath = '', baseUrl = '', geoDecision = geo.gateDecision(), siteName = 'KULA Arcade',
} = {}) {
  const bp = (p) => safeHref(basePath + p) || '/';
  const head = headTags({
    title, description: description || 'KULA Arcade — a free, provably-fair, play-token arcade. Entertainment only; PLAY has no cash value and cannot be cashed out.',
    canonical: canonical || `${baseUrl}${basePath}/`, siteName, robots: 'index,follow,max-image-preview:large',
    site: { url: baseUrl || basePath || '', name: siteName },
  });
  const navHtml = (Array.isArray(nav) ? nav : []).map((n) => {
    const href = safeHref(n.external ? n.href : basePath + n.href);
    if (!href) return '';
    const ext = n.external ? ' target=_blank rel=noopener' : '';
    return `<a href="${esc(href)}"${ext}>${esc(n.label)}</a>`;
  }).join('');
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<div class="alpha-badge">Alpha</div>
${DISCLAIMER}
<header class=topbar><a class=brand href="${esc(bp('/'))}"><b>KULA</b> Arcade <span>· play-token · provably fair</span></a>
 <div class=topbar-r>${navHtml}</div></header>
<main class=wrap>
 ${geo.noticeHtml(geoDecision)}
 ${RESPONSIBLE_HELP}
 ${body}
</main>
<footer>
 <b>KULA Arcade is entertainment, not gambling or investment.</b> PLAY points have no cash value,
 cannot be purchased, and cannot be cashed out — there is no fiat on-ramp and no withdrawal. Draws and
 spins are provably fair; verify them yourself. Alpha · PRANA ${esc(NET_LABEL)} · 18+ · not available where prohibited.
 <div style="margin-top:8px">Gambling a problem? Call or text <a href="tel:18005224700"><b>${esc(HELPLINE_TEL)}</b></a>
  (${esc(HELPLINE_ALT)}) — free, confidential, 24/7 · <a href="${esc(EDU_URL)}/help" target=_blank rel=noopener>get help &amp; self-exclusion tools</a></div>
 <div style="margin-top:8px">${navHtml || ''}</div>
</footer>
${geo.clientHook()}
${AGE_GATE_SCRIPT}
${SELF_EXCLUDE_SCRIPT}
</body></html>`;
}

// ── shared crawler / SEO routes ───────────────────────────────────────────────────────────────────
// commonRoutes(req,res,path,cfg): handles /health, /robots.txt, /sitemap.xml, /sitemap-index.xml,
// /llms.txt uniformly. Returns true if it handled the request. Zero request-time network.
export function commonRoutes(req, res, path, cfg = {}) {
  const { baseUrl = '', name = 'KULA Arcade', summary = '', sitemapPaths = ['/'], links = [], health = {} } = cfg;
  try {
    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, ...health })); return true;
    }
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' }); res.end(robotsTxt(baseUrl)); return true;
    }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = sitemapPaths.map((u) => ({ path: u, lastmod: today, changefreq: 'daily', priority: u === '/' ? '1.0' : '0.6' }));
      res.writeHead(200, { 'content-type': 'application/xml' }); res.end(sitemapXml(baseUrl, entries)); return true;
    }
    if (path === '/sitemap-index.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10))); return true;
    }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(llmsTxt({ name, baseUrl, summary, links })); return true;
    }
    return false;
  } catch {
    try { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error'); } catch {}
    return true;
  }
}

export function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}
export function sendJson(res, obj, code = 200) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
