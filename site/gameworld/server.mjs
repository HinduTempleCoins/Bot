// site/gameworld/server.mjs — the GAME WORLD / FORT hub surface + the modular EMBED SDK.
//
// Renders the buildable fort hub (plots, buildings, the Seed Farm + HUD panels, resource bar, live
// scoreboard) AND serves the drop-in embed so a third-party game can host our Fort/HUD inside THEIR
// world. The embed surface is deliberately small and documented:
//
//   GET /                → the hub page (a seeded demo fort)
//   GET /embed           → the iframe-embeddable fort widget (theme-able via ?theme= query)
//   GET /gameworld.js    → the drop-in loader: defines <melek-fort> web component (iframes /embed,
//                          relays the documented event stream over postMessage)
//   GET /api/world       → the embedManifest JSON (safe state a host reads / syncs to)
//   GET /sdk             → human-readable embed-SDK doc (events, state, theming, state-sync, signer line)
//   GET /health /robots.txt
//
// DISCIPLINE (house style): handler(req,res) exported for tests; PORT/BASE_URL env; esc() ALL
// interpolation; soft-fail-never-throw; ZERO request-time network; ZERO keys. The page renders a
// DEMO fort built in-process from the pure model — no DB, no chain read. Real progression/economy
// state syncs through the documented event stream at the edge (signer boundary respected: no WIF here).

import { createServer } from 'node:http';
import {
  createWorld, apply, reduce, score, embedManifest, themeVars, esc,
  EVENTS, PLOTS, BUILDINGS, SYSTEMS, RESOURCES, ECONOMY_TOKENS, DEFAULT_THEME,
} from './model.mjs';

const PORT = +(process.env.PORT || 8207);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = 'MELEK Fort — Game World';

// env-overridable live surfaces this hub routes out to (never hard-code infra beyond the public domain).
const U = (k, d) => (process.env[k] || d).replace(/\/$/, '');
const URLS = {
  farm: U('FARM_URL', 'https://tribulum.soapbox.community'),
  games: U('GAMES_URL', 'https://games.soapbox.community'),
  move: U('MOVE_URL', 'https://move.soapbox.community'),
  arcade: U('ARCADE_URL', 'https://arcade.soapbox.community'),
  chain: U('MELEK_URL', 'https://melek.salon'),
};

// ── a seeded DEMO fort, built purely from the model, so the page has something to show ──────────────
export function demoWorld() {
  const w = createWorld('hathor', { seedResources: { timber: 26, stone: 22, fiber: 14, essence: 8, spark: 14 } });
  const stream = [
    { type: EVENTS.PLOT_UNLOCK, plot: 'garden' },
    { type: EVENTS.BUILDING_PLACE, building: 'command-centre' },
    { type: EVENTS.SYSTEM_ATTACH, system: 'hud' },
    { type: EVENTS.BUILDING_PLACE, building: 'seed-plot' },
    { type: EVENTS.BUILDING_UPGRADE, building: 'seed-plot' },
    { type: EVENTS.SYSTEM_ATTACH, system: 'seed-farm' },
    { type: EVENTS.PLOT_UNLOCK, plot: 'gate' },
    { type: EVENTS.BUILDING_PLACE, building: 'wayfarers-gate' },
    { type: EVENTS.SYSTEM_ATTACH, system: 'move-gate' },
    { type: EVENTS.TICK },
  ];
  return apply(w, stream).world;
}

const STYLE = (theme) => `<style>
  :root{${themeVars(theme)}}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--acc);text-decoration:none} a:hover{text-decoration:underline}
  .wrap{max-width:1000px;margin:0 auto;padding:20px 16px}
  .alpha{position:fixed;top:8px;left:8px;z-index:20;font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;background:var(--gold);color:#1a1200;border-radius:6px;padding:2px 7px;font-weight:700}
  header.hero{text-align:center;padding:26px 12px 6px}
  header.hero h1{font-size:1.9rem;margin:0 0 6px} header.hero .sub{color:var(--mut);max-width:660px;margin:0 auto}
  .hud{position:sticky;top:0;z-index:10;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin:14px 0;display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between}
  .hud .res{display:flex;gap:10px;flex-wrap:wrap} .hud .r{font-size:.85rem;color:var(--mut)} .hud .r b{color:var(--fg)}
  .hud .score{font-weight:700;color:var(--acc)}
  .hud .tag{font-size:.6rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gold);border:1px solid var(--line);border-radius:10px;padding:1px 7px}
  section{margin:22px 0} section h2{font-size:1.2rem;margin:0 0 4px} section .lead{color:var(--mut);margin:0 0 12px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
  .plot{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}
  .plot.locked{opacity:.55}
  .plot .pn{font-weight:700} .plot .pt{font-size:.72rem;color:var(--mut);float:right}
  .plot .b{margin-top:8px;font-size:.86rem;color:var(--mut)}
  .plot .bld{margin-top:8px;padding-top:8px;border-top:1px solid var(--line);font-size:.9rem}
  .plot .bld .lv{float:right;color:var(--up);font-weight:700}
  .plot .sys{display:inline-block;margin-top:6px;font-size:.66rem;color:var(--acc);border:1px solid var(--line);border-radius:10px;padding:1px 7px}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:10px 0}
  .panel h3{margin:0 0 4px;font-size:1.05rem} .panel .b{color:var(--mut);font-size:.9rem}
  .panel .key{font-size:.72rem;color:var(--gold)}
  code{background:#0006;border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-size:.85em}
  footer{color:var(--mut);font-size:.8rem;text-align:center;padding:24px 16px;margin-top:20px;border-top:1px solid var(--line);line-height:1.7}
</style>`;

// ── the hub page ─────────────────────────────────────────────────────────────────────────────────────
export function hubPage(world = demoWorld()) {
  const sc = score(world);
  const resBar = RESOURCES.map((r) => `<span class=r><b>${world.resources[r] || 0}</b> ${esc(r)}</span>`).join('');
  const plots = Object.entries(PLOTS).map(([id, def]) => {
    const unlocked = !!(world.plots[id] && world.plots[id].unlocked);
    const bld = Object.entries(BUILDINGS).find(([, b]) => b.plot === id);
    let bldHtml = '';
    if (bld) {
      const [bid, bdef] = bld;
      const slot = world.buildings[bid];
      const sysDef = SYSTEMS[bdef.system];
      const sysAttached = world.systems[bdef.system] && world.systems[bdef.system].attached;
      bldHtml = `<div class=bld>${esc(bdef.name)}${slot ? `<span class=lv>Lv ${slot.level}</span>` : '<span class=pt>—</span>'}
        <div><span class=sys>${esc(sysDef.title)}${sysAttached ? ' ✓' : ''}</span></div></div>`;
    }
    return `<div class="plot${unlocked ? '' : ' locked'}"><span class=pt>tier ${def.tier}${unlocked ? '' : ' · locked'}</span>
      <div class=pn>${esc(def.name)}</div><div class=b>${esc(def.blurb)}</div>${bldHtml}</div>`;
  }).join('');

  const seed = SYSTEMS['seed-farm']; const hud = SYSTEMS.hud;
  const body = `
  <header class=hero><h1>${esc(SITE_NAME)}</h1>
    <p class=sub>A buildable home base for the whole ecosystem. Unlock plots, raise buildings, and each one
    hosts one of our systems — the <b>Seed Farm</b> is the garden; the <b>HUD</b> frames the world. Drop it into your own game.</p></header>

  <div class=hud><div class=res>${resBar}</div>
    <div><span class=score>Fort score ${sc.total}</span> <span class=tag>${sc.plots} plots · ${sc.buildingLevels} lvls · ${sc.systems} systems</span></div></div>

  <section><h2>The Fort</h2><p class=lead>Plots you unlock and build up over time. Each building is a station that hosts a system.</p>
    <div class=grid>${plots}</div></section>

  <section><h2>Systems that live in the Fort</h2><p class=lead>The Seed Farm and the HUD attach here as fort features; the rest slot in the same way.</p>
    <div class=panel><h3>🌱 ${esc(seed.title)} <span class=key>garden → Seed Plot</span></h3>
      <div class=b>${esc(seed.blurb)} Attaches at the <code>seed-plot</code> building; harvest yields flow back as <code>resource/grant</code> events. Backed by <code>prana-farm.mjs</code> / <code>prana-seed.mjs</code> (Season/Seed platform). <a href="${esc(URLS.farm)}">Open the farm →</a></div></div>
    <div class=panel><h3>🎛️ ${esc(hud.title)} <span class=key>keep → Command Centre (overlay)</span></h3>
      <div class=b>${esc(hud.blurb)} It is the frame around everything — the sticky resource bar + scoreboard above is the HUD in miniature. Routes players out to each system and pulls state back.</div></div>
    ${['move-gate', 'arcade', 'lantern-hall', 'workshop', 'market'].map((id) => {
      const s = SYSTEMS[id];
      return `<div class=panel><h3>${esc(s.title)}${s.playOnly ? ' <span class=key>play-token · non-cashable</span>' : ''}</h3><div class=b>${esc(s.blurb)}</div></div>`;
    }).join('')}
  </section>

  <section><h2>Embed it in your game</h2><p class=lead>The Fort is a reusable component, not a one-off.</p>
    <div class=panel><div class=b>One tag drops the whole fort into any page:</div>
      <pre><code>&lt;script src="${esc(BASE_URL)}/gameworld.js"&gt;&lt;/script&gt;
&lt;melek-fort owner="yourplayer" theme="light"&gt;&lt;/melek-fort&gt;</code></pre>
      <div class=b>Read the full protocol — events, state, theming, state-sync, the signer boundary — at <a href="/sdk">/sdk</a>. Live state JSON: <a href="/api/world">/api/world</a>.</div></div>
  </section>`;
  return doc(SITE_NAME, body, DEFAULT_THEME);
}

function doc(title, body, theme) {
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${STYLE(theme)}</head>
<body><div class=alpha>Alpha</div><main class=wrap>${body}</main>
<footer>MELEK Fort · a buildable home base across the PRANA/MELEK ecosystem · <a href="${esc(URLS.games)}">all games</a> · <a href="${esc(URLS.chain)}">melek.salon</a><br>
Fort resources are non-cashable play-materials. Arcade/Lantern are play-token entertainment — not real money.</footer></body></html>`;
}

// ── the embeddable widget (compact, iframe-friendly, theme-able via ?theme=light|dark or JSON) ──────
export function embedPage(world = demoWorld(), theme = DEFAULT_THEME) {
  const sc = score(world);
  const resBar = RESOURCES.map((r) => `<span class=r><b>${world.resources[r] || 0}</b> ${esc(r)}</span>`).join('');
  const systems = Object.keys(world.systems).filter((id) => world.systems[id].attached)
    .map((id) => `<span class=sys>${esc(SYSTEMS[id].title)}</span>`).join('');
  const plots = Object.entries(PLOTS).filter(([id]) => world.plots[id] && world.plots[id].unlocked)
    .map(([, def]) => esc(def.name)).join(' · ');
  const body = `
  <div class=hud><div class=res>${resBar}</div><div><span class=score>${sc.total}</span></div></div>
  <div class=embwrap><div class=plots>${plots}</div><div class=syss>${systems}</div></div>
  <div class=note>MELEK Fort embed · <code>rev ${world.rev}</code></div>
  <script>
    // Relay the documented state to the host and accept event pushes (the embed protocol).
    (function(){
      var manifest = ${JSON.stringify(embedManifest(world))};
      function post(type, payload){ try { parent.postMessage({ source:'melek-fort', type:type, payload:payload }, '*'); } catch(e){} }
      post('ready', manifest);
      window.addEventListener('message', function(ev){
        var d = ev.data || {}; if (d.target !== 'melek-fort') return;
        // Host emits documented events; a real deploy validates + syncs at the edge (signer boundary).
        post('event-ack', { type: d.type });
      });
    })();
  </script>`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>MELEK Fort</title>${STYLE(theme)}
<style>body{padding:0}.wrap{padding:10px}.embwrap{margin-top:8px}.plots{font-size:.85rem;color:var(--mut)}.syss{margin-top:6px}.sys{display:inline-block;font-size:.66rem;color:var(--acc);border:1px solid var(--line);border-radius:10px;padding:1px 7px;margin:2px 4px 0 0}.note{margin-top:8px;font-size:.7rem;color:var(--mut)}</style>
</head><body><div class=alpha>Alpha</div><main class=wrap>${body}</main></body></html>`;
}

// ── the drop-in loader: defines <melek-fort>, iframes /embed, relays postMessage events ─────────────
export function loaderJs() {
  return `/* MELEK Fort embed loader — defines <melek-fort>. IP-safe, no external deps, no keys. */
(function(){
  var BASE=${JSON.stringify(BASE_URL)};
  if (customElements.get('melek-fort')) return;
  class MelekFort extends HTMLElement {
    connectedCallback(){
      var owner=this.getAttribute('owner')||'', theme=this.getAttribute('theme')||'';
      var f=document.createElement('iframe');
      f.src=BASE+'/embed?theme='+encodeURIComponent(theme)+'&owner='+encodeURIComponent(owner);
      f.style.cssText='width:100%;min-height:180px;border:0;border-radius:12px;background:#0b0b0f';
      f.setAttribute('title','MELEK Fort'); this._f=f; this.appendChild(f);
      var self=this;
      window.addEventListener('message', function(ev){
        var d=ev.data||{}; if(d.source!=='melek-fort') return;
        // Re-dispatch as DOM CustomEvents so the host game can listen: fort-ready, fort-event-ack.
        self.dispatchEvent(new CustomEvent('fort-'+d.type,{detail:d.payload,bubbles:true}));
      });
    }
    // Host → Fort: push a documented event (plot/unlock, building/place, resource/grant, …).
    emit(type,payload){ if(this._f&&this._f.contentWindow) this._f.contentWindow.postMessage(Object.assign({target:'melek-fort',type:type},payload||{}),'*'); }
  }
  customElements.define('melek-fort', MelekFort);
})();`;
}

// ── the SDK doc page ──────────────────────────────────────────────────────────────────────────────────
export function sdkPage() {
  const events = Object.entries(EVENTS).map(([k, v]) => `<li><code>${esc(v)}</code> — ${esc(k.toLowerCase().replace(/_/g, ' '))}</li>`).join('');
  const tokens = Object.entries(ECONOMY_TOKENS).map(([k, t]) => `<li><b>${esc(k)}</b> — ${esc(t.role)}${t.chainId ? ` (chainId ${t.chainId})` : ''}: ${esc(t.note)}</li>`).join('');
  const body = `
  <header class=hero><h1>Fort Embed SDK</h1><p class=sub>Drop our buildable Fort + HUD into your game. A small, documented state+event surface.</p></header>
  <section><h2>1 · Embed</h2><div class=panel><pre><code>&lt;script src="${esc(BASE_URL)}/gameworld.js"&gt;&lt;/script&gt;
&lt;melek-fort owner="player123" theme="light"&gt;&lt;/melek-fort&gt;</code></pre>
  <div class=b>Or iframe <code>${esc(BASE_URL)}/embed</code> directly. Both post the same protocol.</div></div></section>
  <section><h2>2 · Read state</h2><div class=panel><div class=b>The embed posts <code>{source:'melek-fort', type:'ready', payload:&lt;manifest&gt;}</code> on load, and you can fetch it any time from <code>GET /api/world</code>. The manifest is the SAFE subset — plots, buildings+levels, attached systems, resources, score, and the event list you may emit back. No secrets, no internal journal.</div></div></section>
  <section><h2>3 · Emit events</h2><div class=panel><div class=b>Push documented events to drive progression (host → fort):</div>
  <pre><code>document.querySelector('melek-fort').emit('resource/grant', {resource:'timber', qty:5});</code></pre>
  <ul>${events}</ul></div></section>
  <section><h2>4 · Theming</h2><div class=panel><div class=b>Pass <code>theme="light"</code>/<code>"dark"</code>, or a JSON subset of the CSS vars via <code>/embed?theme=</code>. Overridable keys: ${esc(Object.keys(DEFAULT_THEME).join(', '))}.</div></div></section>
  <section><h2>5 · State sync + the signer boundary</h2><div class=panel><div class=b>The Fort model is an <b>event-sourced reducer</b>: replaying the event stream reproduces the exact state, so a host syncs by shipping events to your edge. <b>The embed never holds a private key.</b> Economy-affecting events (real token grants, on-chain settlement) are <b>validated and broadcast at the signer/edge</b> — the client only proposes them. In-fort resources are non-cashable play-materials.</div></div></section>
  <section><h2>Tokens (framing only — the Fort never moves these)</h2><div class=panel><ul>${tokens}</ul></div></section>`;
  return doc('Fort Embed SDK', body, DEFAULT_THEME);
}

// resolve ?theme= into a theme object (named or JSON subset). Soft-fail to default.
function resolveTheme(raw) {
  const s = String(raw || '').trim();
  if (!s || s === 'dark') return DEFAULT_THEME;
  if (s === 'light') return { ...DEFAULT_THEME, bg: '#f6f6f9', panel: '#ffffff', line: '#e3e3ea', fg: '#1a1a22', mut: '#5b5b66' };
  try { const j = JSON.parse(s); if (j && typeof j === 'object') return { ...DEFAULT_THEME, ...j }; } catch { /* ignore */ }
  return DEFAULT_THEME;
}

function send(res, body, type = 'text/html; charset=utf-8', code = 200) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'public, max-age=300' });
  res.end(body);
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;
    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nAllow: /\n'); }
    if (path === '/gameworld.js') return send(res, loaderJs(), 'application/javascript; charset=utf-8');
    if (path === '/api/world') return send(res, JSON.stringify(embedManifest(demoWorld())), 'application/json; charset=utf-8');
    if (path === '/embed') return send(res, embedPage(demoWorld(), resolveTheme(url.searchParams.get('theme'))));
    if (path === '/sdk') return send(res, sdkPage());
    if (path === '/') return send(res, hubPage());
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/gameworld\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => console.log(`${SITE_NAME} on ${BASE_URL} (bound ${HOST}:${PORT})`));
}
