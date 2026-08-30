// widget-suite.mjs — the Soapy.Blog EMBEDDABLE WIDGET SUITE: one catalog for every drop-in widget
// the ecosystem already ships, with copy-paste embed snippets and a single consistent loader.
//
// THE PROBLEM THIS SOLVES: the repo has grown several genuinely embeddable widgets — Hathor's floating
// chat box (pool/www/hathor-widget.mjs, kulaswap/hathor-widget.mjs), the "Translate this page?" bar
// (pentecaust /translate.js), the MELEK ad generator (site/genai/ad-maker.mjs), the moderation
// report/flag control (src/trollbox/report-widget.mjs). They are scattered, each with its own embed
// convention. This module gathers them into ONE typed catalog + ONE loader so a site owner drops a
// single tag and picks widgets by id — "the Soapy.Blog widget suite."
//
// WHAT THIS IS (pure data + pure functions + a thin handler):
//   WIDGETS               — the typed catalog (id, name, tagline, category, the real source module,
//                           the embed convention, an example config). Data only; owns no markup at load.
//   listWidgets(opts)     — the catalog as plain objects (optionally filtered by category).
//   getWidget(id)         — one descriptor, or null.
//   embedSnippet(id,opts) — the copy-paste HTML embed snippet for one widget (esc()'d, origin-configurable).
//   loaderScript(opts)    — the single unified loader `soapy-widgets.js`: reads window.SoapyWidgets = {…}
//                           (or <script data-widgets="chat,translate">) and mounts each chosen widget.
//   catalogJson(opts)     — the machine-readable catalog (for a picker UI).
//   catalogPage(opts)     — the human gallery page: a card per widget + its live snippet + Alpha badge.
//   handler(req,res,opts) — GET /widgets (gallery), /widgets/loader.js, /widgets/catalog.json.
//
// House style: ESM, esc() ALL interpolation, injectable auth (default-deny — matches the other Soapy
// limbs; the gallery is operator-staged until go-live, when loader.js + catalog.json become public),
// soft-fail-never-throw, no network, no secrets. Fully offline-testable.
//
//   import { listWidgets, embedSnippet, handler } from './integrations/widget-suite.mjs';

import http from 'node:http';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8151);
const HOST = process.env.HOST || '127.0.0.1';

// The default origin the embed snippets point at. On go-live this becomes the public widget host
// (e.g. https://soapy.blog). Overridable per call and via env so staging/prod differ by config only.
export const DEFAULT_ORIGIN = (process.env.SOAPY_WIDGET_ORIGIN || 'https://soapy.blog').replace(/\/+$/, '');

// ── esc(): escape ALL interpolation into HTML ──────────────────────────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── injected auth predicate (default: deny / fail-closed), same shape as the other Soapy limbs ──
let _auth = () => false;
export function __setAuth(fn) { _auth = typeof fn === 'function' ? fn : (() => false); }

// ── THE CATALOG ────────────────────────────────────────────────────────────────────────────────
// Each descriptor is DATA about a widget that already exists in the repo. `mount` names how the loader
// brings it in: 'script' = a plain <script src> that self-mounts; 'module' = an ESM widget; 'iframe' =
// an embedded frame. `config` is the window-global (if any) the widget reads. `source` points a future
// maintainer at the real implementation so this catalog and the widgets never drift apart.
export const WIDGETS = Object.freeze([
  {
    id: 'hathor-chat',
    name: 'Hathor Chat',
    tagline: 'The witness of MELEK as a floating chat bubble on any page.',
    category: 'ai',
    mount: 'module',
    asset: 'hathor-widget.mjs',
    source: 'pool/www/hathor-widget.mjs',
    configGlobal: '__HATHOR_WIDGET',
    exampleConfig: { mode: 'remote', endpoint: '/chat/send' },
    note: 'mode:"local" runs her deterministic brain client-side (no server); mode:"remote" POSTs to a /chat endpoint.',
  },
  {
    id: 'translate',
    name: 'Translate This Page',
    tagline: 'A floating bar that translates the page into the reader\u2019s own language (keyless MyMemory).',
    category: 'utility',
    mount: 'script',
    asset: 'translate.js',
    source: 'pentecaust/server.mjs (/translate.js)',
    configGlobal: null,
    exampleConfig: null,
    note: 'Optional: nothing translates until the reader clicks. The origin of the script tag is where /translate POSTs.',
  },
  {
    id: 'ad-maker',
    name: 'MELEK Ad Maker',
    tagline: 'Generate a branded MELEK ad (SVG/PNG) from a headline + style, inline or as a frame.',
    category: 'content',
    mount: 'iframe',
    asset: '/ads/',
    source: 'site/genai/ad-maker.mjs',
    configGlobal: null,
    exampleConfig: null,
    note: 'Best embedded as an iframe of the ad-maker page; buildAdSvg() can also be called server-side.',
  },
  {
    id: 'report',
    name: 'Report / Flag',
    tagline: 'An honest "send this to a human for review" control for posts, comments, or accounts.',
    category: 'moderation',
    mount: 'module',
    asset: 'report-widget.mjs',
    source: 'src/trollbox/report-widget.mjs',
    configGlobal: '__MELEK_REPORT',
    exampleConfig: { endpoint: '/api/report', target: 'post' },
    note: 'Posts to the real moderation store. Says what a report is (review, not delete) \u2014 not a punish button.',
  },
]);

const BY_ID = Object.fromEntries(WIDGETS.map((w) => [w.id, w]));
export const CATEGORIES = Object.freeze([...new Set(WIDGETS.map((w) => w.category))]);

/** The catalog as plain objects. `opts.category` filters; unknown category → []. Never throws. */
export function listWidgets(opts = {}) {
  try {
    const cat = opts && opts.category;
    const list = cat ? WIDGETS.filter((w) => w.category === cat) : WIDGETS;
    return list.map((w) => ({ ...w, exampleConfig: w.exampleConfig ? { ...w.exampleConfig } : null }));
  } catch { return []; }
}

/** One widget descriptor by id, or null. */
export function getWidget(id) {
  const w = BY_ID[String(id || '')];
  return w ? { ...w, exampleConfig: w.exampleConfig ? { ...w.exampleConfig } : null } : null;
}

// ── normalize an origin (no trailing slash; fall back to DEFAULT_ORIGIN on empty/bad input) ─────
function normOrigin(origin) {
  const o = String(origin == null ? '' : origin).trim().replace(/\/+$/, '');
  return o || DEFAULT_ORIGIN;
}

/**
 * The copy-paste HTML embed snippet for one widget. Origin-configurable (default DEFAULT_ORIGIN).
 * EVERY interpolated value is esc()'d. Unknown id → ''. Never throws.
 *
 * @param {string} id
 * @param {object} [opts]
 * @param {string} [opts.origin]   where the assets are served from (default DEFAULT_ORIGIN)
 * @param {object} [opts.config]   override the example config object baked into the snippet
 * @returns {string}
 */
export function embedSnippet(id, opts = {}) {
  const w = BY_ID[String(id || '')];
  if (!w) return '';
  const origin = normOrigin(opts.origin);
  const cfg = opts.config || w.exampleConfig;
  try {
    if (w.mount === 'iframe') {
      const src = `${origin}${w.asset}`;
      return `<iframe src="${esc(src)}" title="${esc(w.name)}" `
        + `style="width:100%;max-width:640px;height:420px;border:0;border-radius:12px" loading="lazy"></iframe>`;
    }
    // config line (a window global) if the widget reads one
    let configLine = '';
    if (w.configGlobal && cfg) {
      // JSON.stringify then defang </script> so a config value can never break out of the tag.
      const json = JSON.stringify(cfg).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
      configLine = `<script>window.${esc(w.configGlobal)} = ${esc(json)};</script>\n`;
    }
    const src = `${origin}/widgets/${w.asset}`;
    const typeAttr = w.mount === 'module' ? ' type="module"' : '';
    return `${configLine}<script${typeAttr} src="${esc(src)}"></script>`;
  } catch { return ''; }
}

/**
 * The single unified loader served at /widgets/loader.js. A site owner drops ONE tag:
 *
 *   <script src="https://soapy.blog/widgets/loader.js" data-widgets="chat,translate"></script>
 *
 * and this loader injects each chosen widget's real script from the same origin. It also honours
 * window.SoapyWidgets = { widgets:['chat'], origin:'…' } set BEFORE the tag. Self-contained, no deps,
 * CSP-friendly (no eval). The returned string is pure JS (served with a JS content-type). Never throws.
 */
export function loaderScript(opts = {}) {
  const origin = normOrigin(opts.origin);
  // A tiny id→asset map baked in from the catalog so the loader needs no network round-trip to resolve.
  const map = {};
  for (const w of WIDGETS) map[w.id] = { asset: w.asset, mount: w.mount };
  // Also accept a few friendly aliases.
  const aliases = { chat: 'hathor-chat', hathor: 'hathor-chat', flag: 'report' };
  const json = JSON.stringify({ origin, map, aliases }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `/* Soapy.Blog widget suite loader (Alpha). Drop one tag; pick widgets by id. */
(function(){
  if (window.__soapyWidgetsLoaded) return; window.__soapyWidgetsLoaded = true;
  var CAT = ${json};
  var cfg = window.SoapyWidgets || {};
  var origin = cfg.origin || CAT.origin;
  // widgets come from window.SoapyWidgets.widgets or the script tag's data-widgets="a,b" attribute.
  var want = cfg.widgets;
  if (!want) {
    try {
      var s = document.currentScript;
      var d = s && s.getAttribute('data-widgets');
      want = d ? d.split(',') : [];
    } catch (e) { want = []; }
  }
  if (!Array.isArray(want)) want = [];
  function resolve(id){ id = String(id||'').trim(); return CAT.aliases[id] || id; }
  function inject(id){
    id = resolve(id);
    var w = CAT.map[id];
    if (!w || w.mount === 'iframe') return;         // iframes are embedded directly, not via the loader
    if (document.querySelector('script[data-soapy-widget="'+id+'"]')) return;  // idempotent
    var el = document.createElement('script');
    if (w.mount === 'module') el.type = 'module';
    el.src = origin + '/widgets/' + w.asset;
    el.setAttribute('data-soapy-widget', id);
    el.async = true;
    (document.head || document.documentElement).appendChild(el);
  }
  for (var i=0;i<want.length;i++) inject(want[i]);
})();`;
}

/** The machine-readable catalog (for a picker UI). Includes each widget's ready-to-copy snippet. */
export function catalogJson(opts = {}) {
  const origin = normOrigin(opts.origin);
  return {
    origin,
    categories: CATEGORIES,
    widgets: WIDGETS.map((w) => ({
      id: w.id, name: w.name, tagline: w.tagline, category: w.category,
      mount: w.mount, source: w.source, note: w.note,
      snippet: embedSnippet(w.id, { origin }),
    })),
  };
}

// ── the human gallery page ──────────────────────────────────────────────────────────────────────
export function catalogPage(opts = {}) {
  const origin = normOrigin(opts.origin);
  const cards = WIDGETS.map((w) => {
    const snippet = embedSnippet(w.id, { origin });
    return `<div class="w-card">
      <div class="w-head"><h2>${esc(w.name)}</h2><span class="w-cat">${esc(w.category)}</span></div>
      <p class="w-tag">${esc(w.tagline)}</p>
      <p class="w-note muted">${esc(w.note)}</p>
      <label class="muted" for="s-${esc(w.id)}">Embed snippet</label>
      <pre id="s-${esc(w.id)}" class="w-snip"><code>${esc(snippet)}</code></pre>
      <p class="muted w-src">source: <code>${esc(w.source)}</code></p>
    </div>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Soapy.Blog \u2014 Widget Suite</title>
<style>
  :root{--bg:#0f1115;--panel:#171a21;--line:#262b35;--fg:#e6e9ef;--mut:#8a93a3;--accent:#d9a441}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,Segoe UI,Roboto,sans-serif}
  .badge{position:fixed;top:8px;left:8px;font-size:.7rem;background:var(--panel);border:1px solid var(--line);padding:2px 8px;border-radius:6px;color:var(--mut)}
  main{max-width:960px;margin:0 auto;padding:34px 22px}
  h1{font-size:1.5rem;margin:0 0 4px}
  .lead{color:var(--mut);margin:0 0 24px;max-width:70ch}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
  .w-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
  .w-head{display:flex;align-items:center;gap:10px}
  .w-head h2{font-size:1.05rem;margin:0}
  .w-cat{font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:#08101f;background:var(--accent);padding:1px 7px;border-radius:999px}
  .w-tag{margin:.5rem 0 .3rem}
  .w-note{font-size:.85rem;margin:.2rem 0 .6rem}
  .muted{color:var(--mut)}
  label{display:block;font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
  pre.w-snip{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;overflow-x:auto;font-size:12.5px;margin:0 0 .5rem}
  .w-src{font-size:.72rem;margin:.3rem 0 0}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .loader-note{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin-top:20px}
</style></head>
<body>
<span class="badge">Alpha</span>
<main>
  <h1>Soapy.Blog Widget Suite</h1>
  <p class="lead">Drop-in widgets from across the MELEK ecosystem, gathered into one place. Copy a snippet
  onto any site \u2014 or load several at once with the single loader below. Widgets are keyless and
  self-contained; none ever asks a visitor for a private key.</p>
  <div class="grid">
${cards}
  </div>
  <div class="loader-note">
    <h2 style="margin-top:0;font-size:1.05rem">One loader, many widgets</h2>
    <p class="muted">Instead of one tag per widget, load the suite once and pick by id:</p>
    <pre class="w-snip"><code>${esc(`<script src="${origin}/widgets/loader.js" data-widgets="chat,translate"></script>`)}</code></pre>
    <p class="muted" style="font-size:.8rem">Machine catalog: <code>${esc(origin)}/widgets/catalog.json</code></p>
  </div>
</main>
</body></html>`;
}

/**
 * HTTP handler (Node http style). Auth-gated via the injected predicate (default deny), matching the
 * other Soapy limbs. NOTE for go-live: /widgets/loader.js and /widgets/catalog.json must be served
 * PUBLICLY (embeds on third-party sites can't send an admin session) \u2014 the go-live doc moves them
 * to the public widget host. While staged in the admin portal, everything is gated.
 *   GET /widgets              \u2192 gallery page (HTML)
 *   GET /widgets/loader.js    \u2192 the unified loader (JS)
 *   GET /widgets/catalog.json \u2192 the machine catalog (JSON)
 */
export async function handler(req, res, opts = {}) {
  const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  try {
    if (!_auth(req)) return send(401, 'text/plain; charset=utf-8', 'unauthorized');
    const path = (req.url || '/').split('?')[0];
    const method = (req.method || 'GET').toUpperCase();
    const origin = opts.origin;
    if (method === 'GET' && path === '/widgets/loader.js') {
      return send(200, 'application/javascript; charset=utf-8', loaderScript({ origin }));
    }
    if (method === 'GET' && path === '/widgets/catalog.json') {
      return send(200, 'application/json; charset=utf-8', JSON.stringify(catalogJson({ origin })));
    }
    if (method === 'GET' && (path === '/widgets' || path === '/' || path === '/index.html')) {
      return send(200, 'text/html; charset=utf-8', catalogPage({ origin }));
    }
    return send(404, 'text/plain; charset=utf-8', 'not found');
  } catch {
    try { return send(500, 'text/plain; charset=utf-8', 'widget suite unavailable'); } catch { /* noop */ }
  }
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────
const isMain = (() => { try { return process.argv[1] === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) {
  if (process.argv.includes('--serve')) {
    __setAuth(() => true); // local preview only; a real deployment wires requireAdmin
    http.createServer((req, res) => {
      handler(req, res).catch(() => { try { res.writeHead(500); res.end('unavailable'); } catch { /* noop */ } });
    }).listen(PORT, HOST, () => console.log(`widget-suite on http://${HOST}:${PORT}/widgets (preview: auth open)`));
  } else {
    console.log(JSON.stringify(catalogJson(), null, 2));
  }
}
